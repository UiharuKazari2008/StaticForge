const assert = require('assert');
const {
    DEFAULT_IMAGE_GENERATION_SETTINGS,
    normalizeImageGenerationSettings,
    mergeImageGenerationSettingsPatch
} = require('../modules/imageGenerationSettings');

assert.deepStrictEqual(
    normalizeImageGenerationSettings(null),
    DEFAULT_IMAGE_GENERATION_SETTINGS
);

assert.strictEqual(normalizeImageGenerationSettings({ hideQuickstartGallery: true }).hideQuickstartGallery, true);
assert.strictEqual(normalizeImageGenerationSettings({ hideQuickstartGallery: 'yes' }).hideQuickstartGallery, false);
assert.strictEqual(normalizeImageGenerationSettings({ imageFormat: 'WebP Lossless' }).imageFormat, 'webp');
assert.strictEqual(normalizeImageGenerationSettings({ imageFormat: 'PNG' }).imageFormat, 'png');
assert.strictEqual(normalizeImageGenerationSettings({ alphaMode: 'Premultiplied' }).alphaMode, 'premultiplied');
assert.strictEqual(normalizeImageGenerationSettings({ transparencyBackground: 'checkerboard' }).transparencyBackground, 'checker-dark');
assert.strictEqual(normalizeImageGenerationSettings({ transparencyCustomColor: '#abc' }).transparencyCustomColor, '#aabbcc');

const merged = mergeImageGenerationSettingsPatch(
    { streamImageGeneration: true, hideQuickstartGallery: false },
    { hideQuickstartGallery: true, imageFormat: 'webp' }
);
assert.strictEqual(merged.hideQuickstartGallery, true);
assert.strictEqual(merged.imageFormat, 'webp');
assert.strictEqual(merged.streamImageGeneration, true);
assert.strictEqual(merged.persistHistory, true);

const ignored = mergeImageGenerationSettingsPatch(DEFAULT_IMAGE_GENERATION_SETTINGS, { hideQuickstartGallery: 'nope' });
assert.strictEqual(ignored.hideQuickstartGallery, false);

const historyOff = mergeImageGenerationSettingsPatch(DEFAULT_IMAGE_GENERATION_SETTINGS, {
    persistHistory: false,
    automaticDownload: true,
    alphaMode: 'premultiplied',
    streamImageGeneration: false
});
assert.strictEqual(historyOff.persistHistory, false);
assert.strictEqual(historyOff.automaticDownload, true);
assert.strictEqual(historyOff.alphaMode, 'premultiplied');
assert.strictEqual(historyOff.streamImageGeneration, false);

console.log('test-image-generation-settings: ok');
