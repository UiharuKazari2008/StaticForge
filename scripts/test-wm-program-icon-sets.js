'use strict';

/**
 * Program Icons: the brief's treatment rules, the measured check, and the sets a kept icon writes
 * (Windows Mobile 6.1, 6.5 Start, Windows Vista), with the image and brief models stubbed.
 * node scripts/test-wm-program-icon-sets.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
// Done recompiles the runtime assets: not in a test
require.cache[require.resolve(path.join(ROOT, 'modules', 'runtimeAssetService'))] = { exports: { recompileAndRefresh: async () => ({ compiled: 0 }) } };
const P = require(path.join(ROOT, 'modules', 'wmProgramIconPrompt'));
const icons = require(path.join(ROOT, 'modules', 'wmProgramIcons'));
const t = icons._test;

const svg = (body) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${body}</svg>`)).png().toBuffer();
const alphaOf = async (buf) => { const { data, info } = await sharp(buf).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };

(async () => {
    // ---- the brief: code picks the treatment
    const white = P.normaliseBrief({ archetype: 'mark', subject: 'A rounded face with two eye holes.', colours: [{ part: 'face', hex: '#FFFFFF' }, { part: 'eyes', hex: '#5865f2' }], tile: '#5865F2' });
    assert.strictEqual(white.cutout, true, 'white on a coloured tile is drawn in the tile colour');
    assert.deepStrictEqual(white.colours.map((c) => c.hex), ['#ffffff'], 'the tile colour is not one of the subject\'s');
    const mascot = P.normaliseBrief({ archetype: 'character', subject: 'A cat silhouette in a ring', colours: [{ part: 'cat', hex: '#f8f8f8' }], tile: '#1a1d21' });
    assert.strictEqual(mascot.archetype, 'mark', 'a one-colour mascot is a mark');
    assert.strictEqual(mascot.cutout, true);
    const green = P.normaliseBrief({ archetype: 'mark', subject: 'Four letters', colours: [{ part: 'letters', hex: '#1ce783' }], tile: '#0f1c24', lettering: 'hulu' });
    assert.strictEqual(green.cutout, false, 'a coloured mark keeps its colour');
    const girl = P.normaliseBrief({ archetype: 'character', subject: 'A smiling girl', colours: [{ part: 'hair', hex: '#a8d8f0' }, { part: 'skin', hex: '#ffe0d0' }], tile: '' });
    assert.strictEqual(girl.archetype, 'character');
    assert.strictEqual(P.normaliseBrief({ archetype: 'mark' }), null, 'no subject, no brief');

    // ---- the texts are fixed: the same brief gives the same words, and both styles name the same subject
    const wmText = P.renderPrompt('wm', 'Test', white, { brandRefs: 1, styleCount: 3 });
    assert.strictEqual(wmText, P.renderPrompt('wm', 'Test', white, { brandRefs: 1, styleCount: 3 }));
    const vistaText = P.renderPrompt('vista', 'Test', white, { brandRefs: 1, styleCount: 3 });
    assert.ok(wmText.includes(white.subject) && vistaText.includes(white.subject));
    assert.ok(wmText.includes('Windows Mobile 6.5') && vistaText.includes('Windows Vista'));
    assert.ok(/#5865f2 and stands alone/.test(wmText), 'the cut-out rule is in the text');
    for (const style of P.STYLES) for (const a of P.ARCHETYPES) for (const rel of P.styleRefs(style, a)) assert.ok(fs.existsSync(path.join(ROOT, 'public', 'static_images', rel)), `style reference ${rel}`);

    // ---- the period design: the classifier answers a row, the words are the table's
    assert.strictEqual(P.parsePeriod({ row: 1 }), P.PERIOD_OBJECTS[0]);
    assert.strictEqual(P.parsePeriod({ row: 0 }), null);
    assert.strictEqual(P.parsePeriod({ row: 999 }), undefined);
    assert.strictEqual(P.parsePeriod({}), undefined);
    assert.strictEqual(P.withPeriod(girl, P.PERIOD_OBJECTS[0]), girl, 'a character keeps its treatment');
    assert.strictEqual(P.withPeriod(white, null), white, 'no row: the symbol itself');
    assert.ok(P.periodPrompt('Test', {}).includes(`${P.PERIOD_OBJECTS.length}. `));
    // variants: the object the fewest other icons show
    const film = P.PERIOD_OBJECTS.find((r) => /^films/.test(r.use));
    assert.strictEqual(P.pickVariant(film, []).object, film.object);
    assert.strictEqual(P.pickVariant(film, [film.object]).object, film.alts[0].object);
    assert.strictEqual(P.pickVariant(film, [film.object, film.alts[0].object, film.alts[1].object, film.alts[2].object, film.object]).object, film.alts[0].object);
    for (const r of P.PERIOD_OBJECTS) for (const v of P.variants(r)) assert.ok(v.object && v.tint && v.badgeAt, r.use);

    // ---- the measured check
    const disc = await svg('<circle cx="512" cy="512" r="380" fill="#3050e0"/>');
    const tile = await svg('<rect x="110" y="110" width="804" height="804" rx="180" fill="#102030"/>');
    const cut = await svg('<circle cx="512" cy="512" r="560" fill="#3050e0"/>');
    const at = async (buf, brief) => { const a = await alphaOf(buf); return P.checkMaster(a.data, a.w, a.h, brief); };
    assert.strictEqual(await at(disc, white), null);
    assert.strictEqual(await at(tile, white), 'plate');
    assert.strictEqual(await at(tile, { archetype: 'object' }), null, 'a square object is not a tile');
    assert.strictEqual(await at(cut, white), 'clipped');

    // ---- a batch with stubbed models: a tile first, so each style is drawn twice
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-icon-sets-'));
    fs.mkdirSync(path.join(root, 'public', 'static_images'), { recursive: true });
    for (const d of ['wm65', 'app_icons']) fs.symlinkSync(path.join(ROOT, 'public', 'static_images', d), path.join(root, 'public', 'static_images', d));
    t.setRoot(root);
    const asked = [];
    const prompts = [];
    t.stub({
        route: { provider: 'test', model: 'test-image', apiModel: 'test-image' },
        period: async () => P.PERIOD_OBJECTS[0],
        brief: async (name, refs, opts) => { asked.push(['brief', refs.length, opts.characters]); return { archetype: 'mark', subject: 'A round disc', colours: [{ part: 'disc', hex: '#3050e0' }], tile: '' }; },
        request: async (route, prompt, refs) => { prompts.push(prompt); asked.push([/Windows Vista/.test(prompt) ? 'vista' : 'wm', refs.length, /previous drawing/.test(prompt)]); return asked.filter((x) => x[0] !== 'brief').length % 2 === 1 ? tile : disc; }
    });
    const ref = `data:image/png;base64,${(await sharp(disc).resize(96, 96).png().toBuffer()).toString('base64')}`;
    const job = await t.createJob({ items: [{ id: 'com.example.app/com.example.Main', label: 'Example', icon: ref }] }, null);
    for (let i = 0; i < 200 && job.items.some((it) => it.state === 'queued' || it.state === 'working'); i++) await new Promise((r) => setTimeout(r, 50));
    const it = job.items[0];
    assert.strictEqual(it.state, 'ready', it.error || '');
    assert.deepStrictEqual(asked, [['brief', 1, true], ['wm', 4, false], ['vista', 4, false]], 'one brief, one drawing per style (an object may be square)');
    assert.strictEqual(it.note, null, 'the second drawings passed');
    // a symbol is drawn as its period object, the symbol a small emblem on it
    assert.ok(prompts[0].includes(P.PERIOD_OBJECTS[0].object) && /One small raised emblem, white, sits centred on the front balloon, .*: A round disc\./.test(prompts[0]), prompts[0]);
    assert.strictEqual(it.briefs.detailed.object, P.PERIOD_OBJECTS[0].object);
    const pub = t.publicJob(job).items[0].preview;
    assert.deepStrictEqual(Object.keys(pub).sort(), ['128', '16', '32', '65', 'vista']);

    // Regenerate: another draw of the same brief (no second brief)
    asked.length = 0;
    t.stub({ route: { provider: 'test', model: 'test-image', apiModel: 'test-image' }, brief: async () => { throw new Error('asked again'); }, period: async () => { throw new Error('asked again'); }, request: async () => disc });
    await t.runItem(job, it);
    assert.strictEqual(it.state, 'ready', it.error || '');

    // Done: the three sets and the manifest
    const saved = await t.finish(job, [it.key]);
    assert.deepStrictEqual(saved, ['com.example.app/com.example.Main']);
    const store = path.join(root, 'public', 'static_images', 'wm-android');
    const m = JSON.parse(fs.readFileSync(path.join(store, 'manifest.json'), 'utf8'));
    const e = m.icons['com.example.app/com.example.Main'];
    assert.ok(e && e.wm65 === true && e.vista === true);
    const size = async (f) => (await sharp(path.join(store, f)).metadata());
    for (const [suffix, px] of [['', 16], ['@2x', 32], ['@4x', 64], ['-lg', 32], ['-lg@2x', 64], ['-lg@4x', 128], ['-65', 45], ['-65@2x', 90], ['-65@4x', 180]]) assert.strictEqual((await size(`${e.name}${suffix}.png`)).width, px, suffix);
    for (const px of [16, 24, 32, 48, 64, 96, 128, 256]) assert.strictEqual((await size(`${e.name}-vista-${px}.png`)).width, px);
    assert.strictEqual(fs.readdirSync(store).filter((n) => n.startsWith(e.name)).length, 17);
    // 6.1: the ROM's format (a palette)
    assert.ok((await size(`${e.name}@4x.png`)).paletteBitDepth, 'the 6.1 frames are palette pictures');
    // 6.5: the art inside the ROM's 80-of-90 box, the shadow under it
    const a65 = await alphaOf(fs.readFileSync(path.join(store, `${e.name}-65@2x.png`)));
    let top = 90; let bottom = -1; let last = -1;
    for (let y = 0; y < 90; y++) for (let x = 0; x < 90; x++) { const a = a65.data[y * 90 + x]; if (a > 200) { top = Math.min(top, y); bottom = Math.max(bottom, y); } if (a > 8) last = Math.max(last, y); }
    assert.ok(top >= 4 && top <= 7 && bottom >= 80 && bottom <= 84, `6.5 art rows ${top}..${bottom}`);
    assert.ok(last > bottom && last <= 88, `6.5 shadow ends at ${last}`);
    const pm = icons.publicManifest().icons['com.example.app/com.example.Main'];
    assert.ok(pm.wm65 && pm.vista && /^\/static_images\/wm-android\/[a-z0-9_-]+$/.test(pm.icon));

    // ---- programs still without a Vista icon
    m.icons['com.old.app'] = { name: 'com-old-app-aaaaaa-x', package: 'com.old.app', label: 'Old', updatedAt: '2026-11-12T00:00:00Z' };
    fs.writeFileSync(path.join(store, 'manifest.json'), JSON.stringify(m));
    t.stub({ route: { provider: 'test', model: 'test-image', apiModel: 'test-image' }, brief: async () => ({ archetype: 'mark', subject: 'x', colours: [], tile: '' }), period: async () => null, request: async () => disc });
    const missing = await t.missingJob(null);
    assert.ok(missing && missing.left === 0);
    assert.deepStrictEqual(missing.job.items.map((x) => x.id), ['com.old.app']);
    for (let i = 0; i < 200 && missing.job.items.some((x) => x.state === 'queued' || x.state === 'working'); i++) await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(await t.missingJob(null), null, 'a program in an open batch is not asked for twice');

    t.stub(null);
    fs.rmSync(root, { recursive: true, force: true });
    console.log('wm program icon sets: ok');
})().catch((err) => { console.error(err); process.exit(1); });
