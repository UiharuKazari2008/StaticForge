const fs = require('fs');
const path = require('path');
const https = require('https');
const { browserRequest } = require('./browserHttp');
let __runtimeGr = null;
function bindRuntimeGlobalResources(globalResources) { __runtimeGr = globalResources; }

// Import modules
const { 
    getImageDimensions
} = require('./imageTools');
const { generateMobilePreviews } = require('./previewUtils');

async function resolveUpscaleRatio(upscaledBuffer, srcWidth, requestedScale, upscaler) {
    const requested = requestedScale === true ? 4 : (Number(requestedScale) || 4);
    const fallback = (upscaler === 'esrgan') ? requested : 2;
    try {
        const { width: outW } = await getImageDimensions(upscaledBuffer);
        if (srcWidth > 0 && outW > 0) {
            const r = outW / srcWidth;
            if (Math.abs(r - 2) < 0.2) return 2;
            if (Math.abs(r - 4) < 0.2) return 4;
            return Math.round(r * 100) / 100;
        }
    } catch (_) {}
    return fallback;
}

const upscaleImageCore = async (globalResources, imageBuffer, scale = 4, width, height, upscaler = 'novelai', ws = null, handler = null, requestId = null) => {
    bindRuntimeGlobalResources(globalResources);
    const actualScale = scale === true ? 4 : scale;
    if (actualScale <= 1) {
        console.log('📏 No upscaling needed (scale <= 1)');
        return undefined;
    }

    // Simple delay for upscaling requests (1 second)
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
        if (upscaler === 'esrgan') {
            // ESRGAN via RunPod (pass ws, handler, requestId for keep-alive during polling)
            return await upscaleWithESRGAN(imageBuffer, actualScale, width, height, upscaler, ws, handler, requestId);
        } else {
            // Default to NovelAI
            return await upscaleWithNovelAI(imageBuffer, actualScale, width, height);
        }
    } catch (error) {
        console.error('❌ Upscaling failed:', error.message);
        throw error;
    }
};

const upscaleWithNovelAI = async (imageBuffer, scale, width, height) => {
    const apiKeyManager = __runtimeGr.getApiKeyManager();
    const apiKey = apiKeyManager.getActiveApiKey('novelai');
    if (!apiKey) {
        throw new Error('NovelAI API key is not configured. Add one to secure.config.json or set NOVELAI_API_KEY.');
    }
    // Tripwire: block the outbound call while the service is locked.
    if (apiKeyManager.isServiceLocked('novelai')) {
        throw new Error('NovelAI is temporarily locked after repeated API errors. An admin must review the Service Key in the Security Center to unlock it.');
    }

    // Official /ai/upscale: image.novelai.net/ai/upscale, model nai-diffusion-5-curated, declared_blur_sigma 0.
    // Do not send scale; do not retarget api.novelai.net. Live contract scale is 2 (2026-08-28 quality scaler).
    // Width/height are inferred from the PNG.
    const payload = {
        image: imageBuffer.toString('base64'),
        model: 'nai-diffusion-5-curated',
        declared_blur_sigma: 0
    };

    const postData = JSON.stringify(payload);
    // browserRequest: modules/browserHttp.js
    const res = await browserRequest({
        hostname: 'image.novelai.net',
        port: 443,
        path: '/ai/upscale',
        method: 'POST',
        headers: {
            accept: '*/*',
            authorization: `Bearer ${apiKey}`,
            'x-initiated-at': new Date().toISOString(),
            'sec-gpc': '1'
        }
    }, Buffer.from(postData), { acceptResType: 'json', timeoutMs: 120000 });

    if (res.statusCode !== 200) {
        const raw = res.body ? res.body.toString() : '';
        let errorResponse = null;
        try {
            errorResponse = JSON.parse(raw);
        } catch (_) {
            errorResponse = null;
        }
        const detail = (errorResponse && (errorResponse.message || errorResponse.error))
            || (raw && raw.slice(0, 300))
            || 'Unknown error';
        const code = (errorResponse && (errorResponse.statusCode || errorResponse.status)) || res.statusCode;
        apiKeyManager.recordApiFailure('novelai', res.statusCode, detail);
        throw new Error(`NovelAI Upscale API error: HTTP ${code} ${detail}`);
    }

    apiKeyManager.recordApiSuccess('novelai');
    const zipBuffer = res.body;

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();
    const pngEntry = zipEntries.find((entry) => {
        const name = String(entry.entryName || '').split('/').pop();
        return name.startsWith('image') && name.endsWith('.png');
    }) || zipEntries[0];

    if (!pngEntry) {
        throw new Error('ZIP file is empty');
    }

    return pngEntry.getData();
};

const upscaleWithESRGAN = async (imageBuffer, scale, width, height, upscaler, ws = null, handler = null, requestId = null) => {
    const runpodConfig = __runtimeGr.getSecureConfig({ path: 'runpod' }) || {};
    const endpointId = runpodConfig.esrganWorkerId;
    const apiKey = __runtimeGr.getApiKeyManager().getActiveApiKey('runpod');

    if (!endpointId || !apiKey) {
        throw new Error('ESRGAN RunPod configuration is incomplete. Please configure runpod.esrganWorkerId and runpod keys in secure.config.json.');
    }

    // Prepare payload in RunPod's expected format
    // Worker expects 'source_image' field
    const payload = {
        input: {
            source_image: imageBuffer.toString('base64'),
            scale: scale,
            model: 'RealESRGAN_x4plus'
        }
    };

    // Helper function to make HTTP requests
    const makeRequest = (options, postData = null) => {
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = [];
                res.on('data', chunk => data.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(data);
                    if (res.statusCode === 200 || res.statusCode === 201) {
                        resolve(buffer);
                    } else {
                        reject(new Error(`ESRGAN API error: HTTP ${res.statusCode}: ${buffer.toString()}`));
                    }
                });
            });

            req.on('error', error => reject(error));
            if (postData) {
                req.write(postData);
            }
            req.end();
        });
    };

    // Step 1: Submit async job using /run
    console.log('📤 Submitting ESRGAN job to RunPod...');
    const postData = JSON.stringify(payload);
    const submitOptions = {
        hostname: 'api.runpod.ai',
        port: 443,
        path: `/v2/${endpointId}/run`,
        method: 'POST',
        headers: {
            "accept": "application/json",
            "authorization": `Bearer ${apiKey}`,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(postData)
        }
    };

    const submitBuffer = await makeRequest(submitOptions, postData);
    const submitResponse = JSON.parse(submitBuffer.toString());
    
    if (!submitResponse.id) {
        throw new Error('ESRGAN job submission failed: No job ID returned');
    }

    const jobId = submitResponse.id;
    console.log(`✅ ESRGAN job submitted: ${jobId}`);

    // Step 2: Poll /status/{jobId} until completion
    const maxAttempts = 450; // 450 attempts * 2 seconds = 15 minutes max
    const pollInterval = 2000; // 2 seconds between polls
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
        const statusOptions = {
            hostname: 'api.runpod.ai',
            port: 443,
            path: `/v2/${endpointId}/status/${jobId}`,
            method: 'GET',
            headers: {
                "accept": "application/json",
                "authorization": `Bearer ${apiKey}`
            }
        };

        const statusBuffer = await makeRequest(statusOptions);
        const statusResponse = JSON.parse(statusBuffer.toString());
        
        console.log(`⏳ ESRGAN job status (attempt ${attempt}/${maxAttempts}): ${statusResponse.status}`);

        // Send keep-alive/progress update to client
        if (ws && handler && requestId) {
            const progress = Math.min(Math.round((attempt / maxAttempts) * 100), 99); // Cap at 99% until complete
            const statusMessage = statusResponse.status === 'IN_PROGRESS' 
                ? `Upscaling image (${progress}%)...` 
                : statusResponse.status === 'IN_QUEUE'
                ? `Waiting in queue (attempt ${attempt}/${maxAttempts})...`
                : `Processing (${statusResponse.status})...`;
            
            try {
                handler.sendKeepAlive(ws, requestId, 'progress', progress, statusMessage);
            } catch (e) {
                console.warn('Failed to send keep-alive:', e.message);
            }
        }

        if (statusResponse.status === 'COMPLETED') {
            console.log('✅ ESRGAN job completed');
            
            // Extract the output
            if (statusResponse?.output && statusResponse?.output?.image) {
                return Buffer.from(statusResponse.output.image, 'base64');
            } else {
                console.error('ESRGAN response structure:', Object.keys(statusResponse));
                if (statusResponse.output) {
                    console.error('Output object keys:', Object.keys(statusResponse.output));
                }
                throw new Error('ESRGAN job completed but returned no output image. The worker may need to be reconfigured.');
            }
        } else if (statusResponse.status === 'FAILED') {
            throw new Error(`ESRGAN job failed: ${statusResponse.error || 'Unknown error'}`);
        } else if (statusResponse.status === 'CANCELLED') {
            throw new Error('ESRGAN job was cancelled');
        }
        // Continue polling if status is IN_QUEUE or IN_PROGRESS
    }

    // Timeout after max attempts
    throw new Error(`ESRGAN job timed out after ${maxAttempts * pollInterval / 1000} seconds`)
};

// Main upscaling function
async function upscaleImage(globalResources, filename, workspaceId, req, res, upscaler = 'novelai', scale = 4) {
    bindRuntimeGlobalResources(globalResources);
    // Check if user is read-only
    if (req.userType === 'readonly') {
        return res.status(403).json({ error: 'Non-Administrator Login: This operation is not allowed for read-only users' });
    }
    try {
        const filePath = path.join(__runtimeGr.getPath("images"), filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Image not found' });
        }

        // Read the image
        const imageBuffer = fs.readFileSync(filePath);

        // Get image dimensions
        const { width, height } = await getImageDimensions(imageBuffer);

        // Upscale the image
        const upscaledBuffer = await upscaleImageCore(globalResources, imageBuffer, scale, width, height, upscaler);

        // Copy origin Comment onto the upscaled PNG (copyMetadataToImage was previously unbound here).
        const ratio = await resolveUpscaleRatio(upscaledBuffer, width, scale, upscaler);
        const upscaledForgeData = {
            upscale_ratio: ratio,
            upscaled_at: Date.now(),
            generation_type: 'upscaled',
            upscaler_provider: upscaler
        };
        const updatedUpscaledBuffer = __runtimeGr.getPngMetadata().copyMetadataToImage(imageBuffer, upscaledBuffer, upscaledForgeData);

        // Save upscaled image
        const upscaledFilename = filename.replace('.png', '_upscaled.png');
        const upscaledPath = path.join(__runtimeGr.getPath("images"), upscaledFilename);
        fs.writeFileSync(upscaledPath, updatedUpscaledBuffer);
        console.log(`💾 Saved upscaled: ${upscaledFilename}`);

        // Add upscaled file to workspace
        const targetWorkspaceId = workspaceId || __runtimeGr.getWorkspaceManager().getActiveWorkspace(req.session?.id);
        __runtimeGr.getWorkspaceManager().addToWorkspaceArray('files', upscaledFilename, targetWorkspaceId);
        
        // Generate preview for the base image (if not exists)
        const baseName = __runtimeGr.getPngMetadata().getBaseName(filename);
        const previewFile = `${baseName}.webp`
        const previewPath = path.join(__runtimeGr.getPath("previews"), previewFile);
        
        if (!fs.existsSync(previewPath)) {
            const previewResult = await generateMobilePreviews(upscaledPath, baseName);
            if (previewResult?.blurhash) {
                await __runtimeGr.getMetadataDatabase().setImageBlurhash(upscaledFilename, previewResult.blurhash);
            }
            console.log(`📸 Generated mobile previews for ${baseName}`);
        }
        
        // Return the upscaled image
        res.setHeader('Content-Type', 'image/png');
        res.send(updatedUpscaledBuffer);
        
    } catch (error) {
        console.error('Upscaling error:', error);
        res.status(500).json({ error: error.message });
    }
}

// WebSocket-native upscaling function
async function upscaleImageWebSocket(globalResources, filename, workspaceId, userType, sessionId, upscaler = 'novelai', scale = 4, ws = null, handler = null, requestId = null) {
    bindRuntimeGlobalResources(globalResources);
    // Check if user is read-only
    if (userType === 'readonly') {
        throw new Error('Non-Administrator Login: This operation is not allowed for read-only users');
    }
    
    try {
        const filePath = path.join(__runtimeGr.getPath("images"), filename);
        
        if (!fs.existsSync(filePath)) {
            throw new Error('Image not found');
        }
        
        // Read the image
        const imageBuffer = fs.readFileSync(filePath);
        
        // Get image dimensions
        const { width, height } = await getImageDimensions(imageBuffer);

        // Upscale the image (pass ws, handler, requestId for keep-alive)
        const upscaledBuffer = await upscaleImageCore(globalResources, imageBuffer, scale, width, height, upscaler, ws, handler, requestId);

        // Copy origin Comment/signed_hash onto the upscaled PNG instead of overwriting via updateMetadata.
        const ratio = await resolveUpscaleRatio(upscaledBuffer, width, scale, upscaler);
        const upscaledForgeData = {
            upscale_ratio: ratio,
            upscaled_at: Date.now(),
            generation_type: 'upscaled',
            upscaler_provider: upscaler
        };
        const updatedUpscaledBuffer = __runtimeGr.getPngMetadata().copyMetadataToImage(imageBuffer, upscaledBuffer, upscaledForgeData);
        
        // Save upscaled image
        const upscaledFilename = filename.replace('.png', '_upscaled.png');
        const upscaledPath = path.join(__runtimeGr.getPath("images"), upscaledFilename);
        fs.writeFileSync(upscaledPath, updatedUpscaledBuffer);
        console.log(`💾 Saved upscaled: ${upscaledFilename}`);

        // Add upscaled file to workspace
        const targetWorkspaceId = workspaceId || __runtimeGr.getWorkspaceManager().getActiveWorkspace(sessionId);
        __runtimeGr.getWorkspaceManager().addToWorkspaceArray('files', upscaledFilename, targetWorkspaceId);
        
        // Generate preview for the base image (if not exists)
        const baseName = __runtimeGr.getPngMetadata().getBaseName(filename);
        const previewFile = `${baseName}.webp`
        const previewPath = path.join(__runtimeGr.getPath("previews"), previewFile);
        
        if (!fs.existsSync(previewPath)) {
            const previewResult = await generateMobilePreviews(upscaledPath, baseName);
            if (previewResult?.blurhash) {
                await __runtimeGr.getMetadataDatabase().setImageBlurhash(upscaledFilename, previewResult.blurhash);
            }
            console.log(`📸 Generated previews for ${baseName}`);
        }
        
        // Get metadata for the response
        let responseMetadata = null;
        try {
            const metadataDatabase = __runtimeGr.getMetadataDatabase();
            responseMetadata = await metadataDatabase.getImageMetadata(upscaledFilename, __runtimeGr.getPath('images'));
            if (responseMetadata) {
                responseMetadata = await __runtimeGr.getPngMetadata().extractRelevantFields(
                    responseMetadata.metadata || responseMetadata,
                    upscaledFilename,
                    responseMetadata.blurhash
                );
            }
        } catch (metadataError) {
            console.warn('⚠️ Failed to get metadata for upscaled image:', metadataError);
        }

        // Return the result object instead of sending HTTP response
        return {
            buffer: updatedUpscaledBuffer,
            filename: upscaledFilename,
            width: width * scale,
            height: height * scale,
            metadata: responseMetadata
        };
        
    } catch (error) {
        console.error('WebSocket upscaling error:', error);
        throw error;
    }
}

module.exports = {
    upscaleImage,
    upscaleImageWebSocket,
    upscaleImageCore,
    resolveUpscaleRatio
};
