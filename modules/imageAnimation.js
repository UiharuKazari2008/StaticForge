const fs = require('fs');
const path = require('path');
const { generateMobilePreviews } = require('./previewUtils');
const { animateBufferWithLocalWorker } = require('./localUpscaleWorker');

let __runtimeGr = null;
function bindRuntimeGlobalResources(globalResources) { __runtimeGr = globalResources; }

const RESULT_EXTENSIONS = { gif: '.gif', mp4: '.mp4', webp: '.webp' };

async function animateWithLocalWorker(imageBuffer, options, ws, handler, requestId) {
    return await animateBufferWithLocalWorker(__runtimeGr, imageBuffer, {
        motionPrompt: options.motionPrompt,
        frames: options.frames,
        fps: options.fps,
        loop: options.loop,
        backend: options.backend,
        onProgress: (progress, status, jobId) => {
            if (!ws || !handler || !requestId) return;
            const message = status === 'queued'
                ? 'Waiting for Ruiko (job ' + jobId + ')...'
                : 'Animating on Ruiko (job ' + jobId + ')...';
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

    try {
        const imagesDir = __runtimeGr.getPath('images');
        const filePath = path.join(imagesDir, filename);
        if (!fs.existsSync(filePath)) {
            throw new Error('Image not found');
        }
        const imageBuffer = fs.readFileSync(filePath);

        const jobResult = await animateWithLocalWorker(imageBuffer, options, ws, handler, requestId);

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
        throw error;
    }
}

module.exports = {
    animateImageWebSocket
};
