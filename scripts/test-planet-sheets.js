#!/usr/bin/env node
// Planet switcher sprite sheets (modules/planetSheets.js): builds a tinted strip from preview files.
// Run: node scripts/test-planet-sheets.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { PlanetSheetService, clampTile, sanitizeColor, overlaySvg, SHEET_ROUTE } = require('../modules/planetSheets.js');

let passed = 0;
async function test(name, fn) {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
}

(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planet-sheets-'));
    const previews = path.join(root, 'previews');
    const cache = path.join(root, 'cache');
    fs.mkdirSync(previews, { recursive: true });
    const colours = [{ r: 220, g: 40, b: 40 }, { r: 40, g: 200, b: 60 }, { r: 40, g: 80, b: 220 }];
    for (let i = 0; i < colours.length; i++) {
        await sharp({ create: { width: 320 + i * 40, height: 240, channels: 3, background: colours[i] } })
            .webp().toFile(path.join(previews, `img_${i}.webp`));
    }
    const service = new PlanetSheetService({ getPath: (kind) => (kind === 'previews' ? previews : cache) });

    await test('tile and colour inputs are clamped and sanitised', () => {
        assert.strictEqual(clampTile(50), 128);
        assert.strictEqual(clampTile(999), 256);
        assert.strictEqual(clampTile('abc'), 192);
        assert.strictEqual(sanitizeColor('#ABCDEF'), '#abcdef');
        assert.strictEqual(sanitizeColor('#fa0'), '#ffaa00');
        assert.strictEqual(sanitizeColor('red"/><script>'), '#6366f1');
        assert.ok(overlaySvg(192, '#ff0000').includes('fill="#ff0000"'));
    });

    let sheet;
    await test('register describes the strip and skips bad base names', () => {
        sheet = service.register('ws1', [{ base: 'img_0' }, { base: '../etc' }, { base: 'img_1' }, { base: 'missing' }, { base: 'img_2' }], '#ff8800', 192);
        assert.ok(sheet);
        assert.strictEqual(sheet.count, 4, 'missing files are only known at build time');
        assert.strictEqual(sheet.tile, 192);
        assert.strictEqual(sheet.url, `${SHEET_ROUTE}/${sheet.key}.webp`);
        assert.ok(/^[a-f0-9]{20}$/.test(sheet.key));
        assert.strictEqual(service.register('ws1', [], '#fff', 192), null);
    });

    await test('ensure builds a webp strip of tile-sized squares and caches it', async () => {
        const t0 = Date.now();
        const file = await service.ensure(sheet.key);
        assert.ok(file && fs.existsSync(file));
        const meta = await sharp(file).metadata();
        assert.strictEqual(meta.format, 'webp');
        assert.strictEqual(meta.height, 192);
        assert.strictEqual(meta.width, 192 * 3, 'three usable slides, the missing one dropped');
        const built = Date.now() - t0;
        const t1 = Date.now();
        const again = await service.ensure(sheet.key);
        assert.strictEqual(again, file);
        assert.ok(Date.now() - t1 < Math.max(20, built), 'second ensure is a cache hit');
        // tint check: the centre of the first tile (red source) carries the orange tint and is desaturated
        const { data } = await sharp(file).extract({ left: 96, top: 96, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
        assert.ok(data[0] > data[2], 'still warm');
        assert.ok(data[1] > 20, 'green channel lifted by the tint/desaturation');
    });

    await test('same recipe reuses the key; unknown keys 404', async () => {
        const same = service.register('ws1', [{ base: 'img_0' }, { base: '../etc' }, { base: 'img_1' }, { base: 'missing' }, { base: 'img_2' }], '#ff8800', 192);
        assert.strictEqual(same.key, sheet.key);
        const other = service.register('ws1', [{ base: 'img_0' }], '#ff8800', 192);
        assert.notStrictEqual(other.key, sheet.key);
        assert.strictEqual(await service.ensure('0123456789abcdef0123'), null);
        assert.strictEqual(await service.ensure('nope'), null);
        const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; }, setHeader() {}, sendFile() { this.sent = true; } };
        await service.serve({ params: { key: 'ffffffffffffffffffff' } }, res);
        assert.strictEqual(res.code, 404);
        const res2 = { status(code) { this.code = code; return this; }, json() {}, headers: {}, setHeader(k, v) { this.headers[k] = v; }, sendFile(f) { this.sent = f; } };
        await service.serve({ params: { key: sheet.key } }, res2);
        assert.strictEqual(res2.sent, service.filePath(sheet.key));
        assert.strictEqual(res2.headers['Content-Type'], 'image/webp');
    });

    fs.rmSync(root, { recursive: true, force: true });
    console.log(`\n${passed} planet sheet tests passed`);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
