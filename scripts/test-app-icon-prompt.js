const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const appIconGenerator = require('../modules/appIconGenerator');

const prompt = appIconGenerator.buildAppIconPrompt({
    input: 'leather notebook with sticky notes and a pen',
    from: 'Notepad',
    extra: 'yellow, cyan, and green notes'
});

assert.ok(prompt.includes('leather notebook with sticky notes and a pen'));
assert.ok(prompt.includes('Notepad'));
assert.ok(prompt.includes('Required user direction'));
assert.ok(prompt.trim().endsWith('yellow, cyan, and green notes'));
assert.ok(prompt.indexOf('Required user direction') > prompt.indexOf('No text'));
const withRefs = appIconGenerator.buildAppIconPrompt({
    input: 'glass cube',
    extra: 'matte black metal',
    referenceCount: 2
});
assert.ok(withRefs.includes('Reference images are attached in order (2)'));
assert.ok(withRefs.indexOf('matte black metal') > withRefs.indexOf('Reference images'));
assert.strictEqual(appIconGenerator.assertReferenceCount(0), 0);
assert.throws(() => appIconGenerator.assertReferenceCount(9), /Up to 8/);
assert.ok(prompt.includes('Windows Vista'));
assert.ok(prompt.includes('Frutiger Aero'));
assert.ok(!/white background/i.test(prompt), 'prompt must not ask for a white plate');
assert.ok(/transparent/i.test(prompt));

const bare = appIconGenerator.buildAppIconPrompt({ input: 'brass weather vane' });
assert.ok(!bare.includes('stands in for'));
assert.ok(!bare.includes('Additional styling'));

assert.throws(() => appIconGenerator.buildAppIconPrompt({ input: '   ' }), /--input is required/);

assert.strictEqual(appIconGenerator.assertTransparentModel('gpt-image-2.5-sunburst'), 'gpt-image-2.5-sunburst');
assert.strictEqual(appIconGenerator.assertTransparentModel('gpt-image-2.5-flare'), 'gpt-image-2.5-flare');
assert.strictEqual(appIconGenerator.assertTransparentModel(''), 'gpt-image-2.5-sunburst');
assert.throws(() => appIconGenerator.assertTransparentModel('dall-e-3'), /not a transparent/);
assert.throws(() => appIconGenerator.assertTransparentModel('gpt-image-2'), /not a transparent/);
assert.ok(/labels, signs, and markings/.test(prompt));

assert.strictEqual(appIconGenerator.iconBasename('Notebook'), 'notebook.png');
assert.strictEqual(appIconGenerator.iconBasename('event_viewer.png'), 'event_viewer.png');
assert.throws(() => appIconGenerator.iconBasename('../secret'), /--name must/);
assert.throws(() => appIconGenerator.iconBasename(''), /--name must/);

async function checkAlpha() {
    const png = await sharp({
        create: {
            width: 4,
            height: 2,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    }).png().toBuffer();
    const summary = await appIconGenerator.alphaSummary(png);
    assert.strictEqual(summary.width, 4);
    assert.strictEqual(summary.height, 2);
    assert.ok(summary.transparentRatio > 0.9);
}

async function checkCrop() {
    const source = await sharp({
        create: { width: 80, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite([{
        input: await sharp({
            create: { width: 40, height: 40, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } }
        }).png().toBuffer(),
        left: 20,
        top: 20
    }]).png().toBuffer();

    const padding = await appIconGenerator.measurePadding(source);
    assert.ok(padding.body.left > 0.2 && padding.body.left < 0.3);
    assert.ok(padding.body.top > 0.2);

    const scaled = await appIconGenerator.cropAndScale(source, { x: -10, y: -10, size: 100 }, 384);
    const meta = await sharp(scaled).metadata();
    assert.strictEqual(meta.width, 384);
    assert.strictEqual(meta.height, 384);
    const raw = await sharp(scaled).ensureAlpha().raw().toBuffer();
    assert.strictEqual(raw[3], 0, 'padding outside the source stays transparent');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-crop-'));
    const masters = path.join(dir, 'masters');
    const originals = path.join(dir, 'originals');
    fs.mkdirSync(masters);
    const saved = await appIconGenerator.saveFinalIcon({
        projectRoot: path.join(__dirname, '..'),
        name: 'sample',
        mastersDir: masters,
        originalsDir: originals,
        sourceBuffer: source,
        crop: { x: 0, y: 0, size: 80 },
        compile: false
    });
    assert.strictEqual(saved.storedOriginal, true);
    assert.strictEqual(saved.outputSize, 384);
    const originalBytes = fs.readFileSync(saved.originalPath);
    assert.deepStrictEqual(originalBytes, source);
    const masterMeta = await sharp(fs.readFileSync(saved.masterPath)).metadata();
    assert.strictEqual(masterMeta.width, 384);
    const again = await appIconGenerator.saveFinalIcon({
        projectRoot: path.join(__dirname, '..'),
        name: 'sample',
        mastersDir: masters,
        originalsDir: originals,
        sourceBuffer: source,
        crop: { x: 10, y: 10, size: 40 },
        compile: false
    });
    assert.strictEqual(again.storedOriginal, false);
    assert.deepStrictEqual(fs.readFileSync(saved.originalPath), source);
    fs.rmSync(dir, { recursive: true, force: true });
}

checkAlpha()
    .then(() => checkCrop())
    .then(() => {
        console.log('app icon prompt checks passed');
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
