const { buildOptions, handleGeneration, upscaleImage } = require('../web_server');
const { getDimensionsFromResolution, processDynamicImage, resizeMaskWithCanvas, generateAndPadMask } = require('./imageTools');

// Main pipeline executor
async function executePipeline(pipelineConfig, presets, options = {}) {
  const { resolution, layers } = pipelineConfig;
  if (!layers || !Array.isArray(layers) || layers.length === 0) throw new Error('Pipeline must have layers');
  if (!resolution) throw new Error('Pipeline must have a resolution');

  let lastImage = null;
  let lastPreset = null;
  let lastResult = null;
  let lastMask = null;
  let lastSeed = options.seed || null;
  const targetDims = getDimensionsFromResolution(resolution);
  if (!targetDims) throw new Error(`Invalid resolution: ${resolution}`);

  for (let i = 0; i < layers.length; ++i) {
    const layer = layers[i];
    // Special: enhance layer
    if (layer.enhance_strength !== undefined || layer.enhance_noise !== undefined) {
      if (!lastImage || !lastPreset) throw new Error('Enhance layer must follow a preset layer');
      const strength = layer.enhance_strength ?? 0.8;
      const noise = layer.enhance_noise ?? 0.1;
      const opts = await buildOptions(lastPreset.model, {
        no_save: (i !== layers.length - 1),
        upscale: false,
        resPreset: targetDims,
        image: lastImage,
        strength,
        noise
      }, lastPreset, options.queryParams || {});
      lastResult = await handleGeneration(opts, true, lastPreset.name || 'enhance', options.workspaceId);
      lastImage = lastResult.buffer.toString('base64');
      continue;
    }
    // Special: upscale layer
    if (layer.upscale) {
      if (!lastImage) throw new Error('Upscale layer must follow a preset or enhance layer');
      const scale = layer.upscale;
      const imageBuffer = Buffer.from(lastImage, 'base64');
      const upscaledBuffer = await upscaleImage(imageBuffer, scale, targetDims.width * scale, targetDims.height * scale);
      lastImage = upscaledBuffer.toString('base64');
      lastResult = { buffer: upscaledBuffer };
      continue;
    }
    // Normal preset layer
    let preset = layer.preset ? presets[layer.preset] : null;
    if (!preset) throw new Error(`Preset not found: ${layer.preset}`);
    lastPreset = preset;
    // If first layer, generate from prompt or img2img if preset has image
    if (i === 0) {
      const opts = await buildOptions(preset.model, {
        no_save: true,
        upscale: false,
        resPreset: targetDims,
      }, preset, options.queryParams || {});
      if (!opts.width && !opts.height) opts.resPreset = targetDims;
      lastResult = await handleGeneration(opts, true, layer.preset, options.workspaceId);
      lastImage = lastResult.buffer.toString('base64');
      lastSeed = lastResult.seed;
      continue;
    }
    // For subsequent layers, use previous image as base, and mask if provided
    let maskBuffer = null;
    let maskCompressed = null;
    if (layer.mask) {
      // Mask is compressed base64
      const inputMaskBuffer = Buffer.from(layer.mask, 'base64');
      const processedMaskBuffer = await resizeMaskWithCanvas(inputMaskBuffer, targetDims.width, targetDims.height);
      maskBuffer = processedMaskBuffer.toString('base64');
      maskCompressed = layer.mask;
    } else {
        // Throw error if no mask is provided
        throw new Error('No mask provided');
    }
    const opts = await buildOptions(preset.model, {
        no_save: (i !== layers.length - 1),
        upscale: false,
        resPreset: targetDims,
        image: lastImage,
        mask: maskBuffer,
        mask_compressed: maskCompressed,
    }, preset, options.queryParams || {});
    opts.strength = preset.strength ?? 1;
    opts.noise = preset.noise ?? 0.1;
    lastResult = await handleGeneration(opts, true, layer.preset, options.workspaceId);
    lastImage = lastResult.buffer.toString('base64');
    // After each generation except the last layer, add a random delay (12-30s)
    if (i < layers.length - 1) {
      const delayMs = 12000 + Math.floor(Math.random() * (30000 - 12000 + 1));
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  // Return the final image buffer and metadata
  return lastResult;
}

module.exports = { executePipeline }; 