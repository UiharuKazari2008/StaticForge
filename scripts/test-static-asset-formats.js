#!/usr/bin/env node
/**
 * Noto Sans woff2 is the first src, workin.webp matches the gif canvas and timing,
 * and the 5-10 MB splash PNGs keep their dimensions.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');

function pngSize(file) {
    const buf = Buffer.alloc(24);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    assert.strictEqual(buf.toString('ascii', 12, 16), 'IHDR');
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const fonts = fs.readFileSync(path.join(ROOT, 'public/css/fonts.css'), 'utf8');
const firstFace = fonts.slice(0, fonts.indexOf("@font-face", 1));
const woffAt = firstFace.indexOf("NotoSans-VariableFont_wdth,wght.woff2') format('woff2')");
const ttfAt = firstFace.indexOf("NotoSans-VariableFont_wdth,wght.ttf') format('truetype')");
assert.ok(woffAt > 0 && ttfAt > woffAt, 'Noto Sans woff2 is listed before the ttf fallback');

const woff2 = path.join(ROOT, 'public/dist/fonts/NotoSans-VariableFont_wdth,wght.woff2');
const ttf = path.join(ROOT, 'public/dist/fonts/NotoSans-VariableFont_wdth,wght.ttf');
const woff2Bytes = fs.readFileSync(woff2);
assert.strictEqual(woff2Bytes.subarray(0, 4).toString('ascii'), 'wOF2');
assert.ok(woff2Bytes.length < fs.statSync(ttf).size, 'subset woff2 is smaller than the variable ttf');

const splashDims = {
    'apple-splash-1242x2688.png': [1242, 2688],
    'apple-splash-1284x2778.png': [1284, 2778],
    'apple-splash-1290x2796.png': [1290, 2796],
    'apple-splash-1536x2048.png': [1536, 2048],
    'apple-splash-1668x2388.png': [1668, 2388],
    'apple-splash-2048x2732.png': [2048, 2732],
    'apple-splash-2388x1668.png': [2388, 1668],
    'apple-splash-2732x2048.png': [2732, 2048],
    'splash.png': [2252, 2944],
    'splash_bg1.png': [2363, 1536]
};
for (const [name, [width, height]] of Object.entries(splashDims)) {
    const size = pngSize(path.join(ROOT, 'public/static_images', name));
    assert.deepStrictEqual([size.width, size.height], [width, height], name);
}

async function main() {
    const gif = path.join(ROOT, 'public/static_images/workin.gif');
    const webp = path.join(ROOT, 'public/static_images/workin.webp');
    assert.ok(fs.statSync(webp).size < fs.statSync(gif).size, 'workin.webp is smaller than the gif');
    const gifMeta = await sharp(gif, { animated: true }).metadata();
    const webpMeta = await sharp(webp, { animated: true }).metadata();
    assert.strictEqual(webpMeta.width, gifMeta.width);
    assert.strictEqual(webpMeta.pageHeight, gifMeta.pageHeight);
    assert.strictEqual(webpMeta.pages, gifMeta.pages);
    assert.deepStrictEqual(webpMeta.delay, gifMeta.delay);
    const html = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
    assert.ok(html.includes('srcset="/static_images/workin.webp"'), 'webp is the preferred source');
    assert.ok(html.includes('src="/static_images/workin.gif"'), 'gif stays as the fallback');
    console.log('static asset formats ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
