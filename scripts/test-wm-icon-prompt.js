const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const wm = require('../modules/wmIconGenerator');

const prompt = wm.buildWmIconPrompt({ input: 'glass globe on a stand', from: 'Teleport', extra: 'no stand' });
assert.ok(prompt.includes('glass globe on a stand'));
assert.ok(prompt.includes('Windows Mobile 6.1'));
assert.ok(prompt.includes('"Teleport"'));
assert.ok(/no logos, flags or trademarks/i.test(prompt), 'prompt must forbid company logos');
assert.ok(/no text, letters or numbers/i.test(prompt));
assert.ok(/Transparent background/.test(prompt));
assert.ok(/drop shadow/.test(prompt));
assert.ok(prompt.trim().endsWith('no stand'), 'user direction comes last');
assert.ok(!/white background/i.test(prompt));
const bare = wm.buildWmIconPrompt({ input: 'brass key' });
assert.ok(!bare.includes('phone version of'));
const refs = wm.buildWmIconPrompt({ input: 'brass key', referenceCount: 2 });
assert.ok(refs.includes('Reference images are attached in order (2)'));
const small = wm.buildWmIconPrompt({ input: 'brass key', small: true, referenceCount: 1 });
assert.ok(small.includes('16 x 16 pixel frame'));
assert.ok(small.includes('icon to simplify'));
assert.throws(() => wm.buildWmIconPrompt({ input: ' ' }), /--input is required/);

assert.strictEqual(wm.artName('Teleport'), 'app-teleport');
assert.strictEqual(wm.artName('app-teleport'), 'app-teleport');
assert.strictEqual(wm.artName('app-teleport-lg@2x.png'), 'app-teleport');
assert.strictEqual(wm.artName('remote-desktop-mobile'), 'app-remote-desktop-mobile');
assert.throws(() => wm.artName('../x'), /--name must/);
assert.throws(() => wm.artName(''), /--name must/);

assert.deepStrictEqual(wm.SIZES.map((s) => s.suffix + ':' + s.size), ['>:16', '@2x:32', '@4x:64', '-lg:32', '-lg@2x:64', '-lg@4x:128'].map((s) => s.replace('>', '')));

const entries = wm.manifestEntries('app-x', { hasSmall: true, from: 'X' });
assert.deepStrictEqual(entries['app-x']['1x'].size, [16, 16]);
assert.deepStrictEqual(entries['app-x-lg']['4x'].size, [128, 128]);
assert.ok(entries['app-x'].flags.includes('generated'));
assert.ok(entries['app-x'].flags.includes('1x-own-16px-frame'));

async function run() {
    // a 200 x 100 opaque bar in a 1024 canvas with faint haze: crop is square around the bar
    const bar = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 40, g: 120, b: 220, alpha: 1 } } }).png().toBuffer();
    const haze = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.05 } } }).png().toBuffer();
    const master = await sharp(haze).composite([{ input: bar, left: 400, top: 500 }]).png().toBuffer();
    const crop = await wm.autoCrop(master, 0.03);
    assert.ok(Math.abs(crop.size - Math.round(200 / 0.94)) <= 1, `crop size ${crop.size}`);
    assert.ok(Math.abs(crop.x + crop.size / 2 - 500) <= 1);
    const square = await wm.squareFromCrop(master, crop);
    const corner = await sharp(square).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    assert.strictEqual(corner[3], 0, 'haze is cleared');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-icon-test-'));
    try {
        fs.mkdirSync(wm.originalsDir(root), { recursive: true });
        fs.writeFileSync(path.join(wm.originalsDir(root), 'app-bar.png'), master);
        const out = path.join(root, 'out');
        const saved = await wm.saveWmIcon({ projectRoot: root, name: 'bar', outDir: out });
        assert.strictEqual(saved.written.length, 6);
        assert.strictEqual(saved.manifest, null, 'outDir writes never touch the manifest');
        for (const s of wm.SIZES) {
            const meta = await sharp(path.join(out, `app-bar${s.suffix}.png`)).metadata();
            assert.strictEqual(meta.width, s.size);
            assert.strictEqual(meta.height, s.size);
            assert.ok(meta.hasAlpha);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
    console.log('test-wm-icon-prompt: ok');
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
