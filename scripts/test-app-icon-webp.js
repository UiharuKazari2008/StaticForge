#!/usr/bin/env node
/**
 * App icon webp is a lossless re-encode of the resized PNG (same canvas).
 * PNG stays on disk so an old client can still request it.
 * modules/appIconRuntimeAssets.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const icons = require('../modules/appIconRuntimeAssets');

function rawEqual(a, b) {
    assert.strictEqual(a.info.width, b.info.width);
    assert.strictEqual(a.info.height, b.info.height);
    assert.strictEqual(a.data.length, b.data.length);
    for (let i = 0; i < a.data.length; i++) {
        if (a.data[i] !== b.data[i]) {
            throw new Error(`pixel ${i} ${a.data[i]} != ${b.data[i]}`);
        }
    }
}

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-webp-'));
    const dir = path.join(root, 'public', 'static_images', 'app_icons');
    fs.mkdirSync(dir, { recursive: true });
    const raw = Buffer.alloc(64 * 64 * 4, 0);
    for (let y = 8; y < 56; y++) {
        for (let x = 8; x < 56; x++) {
            const i = (y * 64 + x) * 4;
            raw[i] = 200;
            raw[i + 1] = 40;
            raw[i + 2] = 90;
            raw[i + 3] = 255;
        }
    }
    const png = await sharp(raw, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer();
    fs.writeFileSync(path.join(dir, 'fixture.png'), png);

    const result = await icons.compileAppIcons(root, { force: true });
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.compiled, 1);

    for (const size of icons.ICON_SIZES) {
        const base = path.join(root, '.cache', 'runtime-assets', 'static_images', 'app_icons', String(size));
        const pngRaw = await sharp(path.join(base, 'fixture.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const webpRaw = await sharp(path.join(base, 'fixture.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.strictEqual(pngRaw.info.width, size);
        assert.strictEqual(pngRaw.info.height, size);
        rawEqual(pngRaw, webpRaw);
    }

    const webpPath = icons.resolveServedAppIconPath(root, '/static_images/app_icons/fixture.webp', false);
    const pngPath = icons.resolveServedAppIconPath(root, '/static_images/app_icons/fixture.png', false);
    assert.ok(webpPath.endsWith(`${path.sep}fixture.webp`));
    assert.ok(pngPath.endsWith(`${path.sep}fixture.png`));
    const debugMaster = icons.resolveServedAppIconPath(root, '/static_images/app_icons/fixture.png', true);
    assert.strictEqual(debugMaster, path.join(dir, 'fixture.png'));

    const parsed = icons.parseAppIconWebPath('/static_images/app_icons/32/fixture.webp');
    assert.strictEqual(parsed.filename, 'fixture.webp');
    assert.strictEqual(parsed.size, 32);

    const manifest = icons.listOptimisedAppIconManifestEntries(root);
    assert.ok(manifest.some((entry) => entry.path === '/static_images/app_icons/fixture.webp'));
    assert.ok(manifest.every((entry) => entry.path.endsWith('.webp')));
    assert.ok(fs.existsSync(pngPath), 'png fallback file stays on disk');

    console.log('app icon webp pixel match ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
