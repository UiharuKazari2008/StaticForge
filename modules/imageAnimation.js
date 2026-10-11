const fs = require('fs');
const path = require('path');
const { generateMobilePreviews } = require('./previewUtils');
const { animateBufferWithLocalWorker } = require('./localUpscaleWorker');

let __runtimeGr = null;
function bindRuntimeGlobalResources(globalResources) { __runtimeGr = globalResources; }

const RESULT_EXTENSIONS = { gif: '.gif', mp4: '.mp4', webp: '.webp', webm: '.webm' };

// eMotion resume state: the current/most recent animate job per user session, so a client
// that reloads or reconnects can restore its UI (emotion_current_job). In-memory only; a
// server restart forgets it (the finished GIF is still in the gallery).
const emotionJobs = new Map(); // ownerKey -> job state
const EMOTION_JOB_TTL_MS = 6 * 60 * 60 * 1000;

function emotionOwnerKey(sessionId) {
    return sessionId ? String(sessionId) : 'anonymous';
}

function getEmotionJob(sessionId) {
    const job = emotionJobs.get(emotionOwnerKey(sessionId));
    if (!job) return null;
    if (job.status !== 'running' && Date.now() - job.updatedAt > EMOTION_JOB_TTL_MS) {
        emotionJobs.delete(emotionOwnerKey(sessionId));
        return null;
    }
    return job;
}

// Public view; previewBase64 only when the caller's known seq is stale (it is ~10-30 KB).
function publicEmotionJob(job, knownPreviewSeq = -1) {
    if (!job) return null;
    const { previewBase64, ...rest } = job;
    const out = { ...rest };
    if (previewBase64 && Number(knownPreviewSeq) < job.previewSeq) out.previewBase64 = previewBase64;
    return out;
}

async function animateWithLocalWorker(imageBuffer, options, ws, handler, requestId, jobState) {
    return await animateBufferWithLocalWorker(__runtimeGr, imageBuffer, {
        onJobId: (jobId) => { if (jobState) jobState.workerJobId = jobId; },
        motionPrompt: options.motionPrompt,
        frames: options.frames,
        fps: options.fps,
        loop: options.loop,
        backend: options.backend,
        onProgress: (rawProgress, status, jobId, detail = {}) => {
            // Monotonic: the worker can restart a stage (e.g. 1% "starting" after queueing);
            // never relay a lower number than already sent.
            const progress = Math.max(jobState ? jobState.progress : 0, Number(rawProgress) || 0);
            const stage = status === 'queued' ? 'queued' : (detail.stage || 'generating');
            const stepText = detail.step != null && detail.totalSteps ? ' ' + detail.step + '/' + detail.totalSteps : '';
            const message = stage === 'queued'
                ? 'Waiting for Ruiko...'
                : stage.charAt(0).toUpperCase() + stage.slice(1) + stepText;
            if (jobState) {
                jobState.progress = progress;
                jobState.stage = stage;
                jobState.step = detail.step != null ? detail.step : null;
                jobState.totalSteps = detail.totalSteps || null;
                jobState.message = message;
                jobState.updatedAt = Date.now();
                if (detail.previewBase64) {
                    jobState.previewBase64 = detail.previewBase64;
                    jobState.previewSeq = (jobState.previewSeq || 0) + 1;
                }
            }
            if (!ws || !handler || !requestId) return;
            try {
                handler.sendToClient(ws, {
                    type: 'image_animation_progress',
                    requestId,
                    data: publicEmotionJob(jobState, -1),
                    timestamp: new Date().toISOString()
                });
            } catch (_err) {
                // socket gone; resume via emotion_current_job
            }
            try {
                handler.sendKeepAlive(ws, requestId, 'progress', progress, message);
            } catch (err) {
                console.warn('Failed to send keep-alive:', err.message);
            }
        }
    });
}

// WebSocket-native animate function. The source image is read from the gallery,
// animated on Ruiko, and the GIF is saved as the primary gallery file (MP4/WebP
// alongside it). Unlike upscale, there is no PNG to embed forge_data into, so
// job parameters ride in a DB-only receipt via addReceiptMetadata (forgeData=null).
async function animateImageWebSocket(globalResources, filename, workspaceId, userType, sessionId, options = {}, ws = null, handler = null, requestId = null) {
    bindRuntimeGlobalResources(globalResources);
    if (userType === 'readonly') {
        throw new Error('Non-Administrator Login: This operation is not allowed for read-only users');
    }

    let jobState = null;
    try {
        const imagesDir = __runtimeGr.getPath('images');
        const filePath = path.join(imagesDir, filename);
        if (!fs.existsSync(filePath)) {
            throw new Error('Image not found');
        }
        const imageBuffer = fs.readFileSync(filePath);

        jobState = {
            requestId,
            status: 'running',
            sourceFilename: filename,
            workspace: workspaceId || null,
            motionPrompt: options.motionPrompt || '',
            backend: options.backend || null,
            frames: options.frames,
            fps: options.fps,
            loop: options.loop,
            progress: 0,
            stage: 'queued',
            step: null,
            totalSteps: null,
            message: 'Starting...',
            previewSeq: 0,
            previewBase64: null,
            result: null,
            error: null,
            startedAt: Date.now(),
            updatedAt: Date.now()
        };
        emotionJobs.set(emotionOwnerKey(sessionId), jobState);

        const jobResult = await animateWithLocalWorker(imageBuffer, options, ws, handler, requestId, jobState);

        const sourceBase = __runtimeGr.getPngMetadata().getBaseName(filename);
        const outputBase = sourceBase + '_animate_' + jobResult.jobId.slice(0, 8);

        const savedFiles = {};
        for (const [format, buffer] of Object.entries(jobResult.buffers)) {
            const outFilename = outputBase + RESULT_EXTENSIONS[format];
            fs.writeFileSync(path.join(imagesDir, outFilename), buffer);
            savedFiles[format] = outFilename;
        }
        const primaryFilename = savedFiles.gif;
        console.log(`💾 Saved animate output: ${primaryFilename} (+ ${Object.keys(savedFiles).filter((f) => f !== 'gif').join(', ')})`);

        const targetWorkspaceId = workspaceId || __runtimeGr.getWorkspaceManager().getActiveWorkspace(sessionId);
        __runtimeGr.getWorkspaceManager().addToWorkspaceArray('files', primaryFilename, targetWorkspaceId);

        const receiptData = {
            type: 'animate',
            generation_type: 'animated',
            animate_provider: 'local',
            animate_backend: jobResult.backend,
            motion_prompt: jobResult.motionPrompt,
            frames: jobResult.frames,
            fps: jobResult.fps,
            loop: jobResult.loop,
            local_job_id: jobResult.jobId,
            source_filename: filename,
            formats: savedFiles,
            date: Date.now()
        };
        const metadata = await __runtimeGr.getMetadataDatabase().addReceiptMetadata(
            primaryFilename, imagesDir, receiptData, null
        );

        const previewResult = await generateMobilePreviews(path.join(imagesDir, primaryFilename), outputBase);
        if (previewResult?.blurhash) {
            await __runtimeGr.getMetadataDatabase().setImageBlurhash(primaryFilename, previewResult.blurhash);
        }

        if (jobState) {
            jobState.status = 'completed';
            jobState.progress = 100;
            jobState.stage = 'done';
            jobState.message = 'Done';
            jobState.result = { filename: primaryFilename, formats: savedFiles };
            jobState.updatedAt = Date.now();
        }

        return {
            filename: primaryFilename,
            formats: savedFiles,
            metadata,
            jobId: jobResult.jobId,
            backend: jobResult.backend,
            motionPrompt: jobResult.motionPrompt,
            frames: jobResult.frames,
            fps: jobResult.fps,
            loop: jobResult.loop
        };
    } catch (error) {
        console.error('WebSocket animate error:', error);
        if (jobState) {
            jobState.status = 'failed';
            jobState.error = error.message || 'Animate failed';
            jobState.updatedAt = Date.now();
        }
        throw error;
    }
}

module.exports = {
    animateImageWebSocket,
    getEmotionJob,
    publicEmotionJob
};
