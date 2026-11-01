'use strict';
// #688 Director mascot: server cue rules and the client stage machine (real manifests, fake clock).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ---- server cues ----
const cues = require('../modules/directorMascot');
cues.resetMascotCues();
let c = cues.mascotCue('s', { rows: [{ type: 'tool', name: 'apply_studio_changes', result: '' }] }, 1000);
assert.deepStrictEqual([c.expression, c.action], ['smug', 'nod']);
assert.strictEqual(cues.mascotCue('s', { rows: [{ type: 'tool', name: 'apply_studio_changes', result: '' }] }, 1300), null, 'same rows, inside the gap: no cue');
c = cues.mascotCue('s', { rows: [{ type: 'tool', name: 'apply_studio_changes', result: '' }, { type: 'tool', name: 'get_generated_image', result: 'Error: failed to read' }] }, 5000);
assert.strictEqual(c.expression, 'frustrated');
c = cues.mascotCue('s', { rows: [{ type: 'tool', name: 'apply_studio_changes', result: '' }, { type: 'tool', name: 'get_generated_image', result: 'Error: failed to read' }], live: { type: 'thinking', text: 'Perfect, that nailed the hips.' } }, 9000);
assert.strictEqual(c.expression, 'happy');
assert.strictEqual(cues._test.toolCue({ name: 'await_generation_job', result: '' }).expression, 'thinking');
assert.ok(cues._test.toolCue({ name: 'await_generation_job', result: '' }).holdMs >= 7000, 'a generation wait holds the thinking face');
assert.strictEqual(cues._test.wordCue('hmm, let me think about the pose').expression, 'thinking');
assert.strictEqual(cues._test.toolCue({ name: 'unknown_tool', result: '' }), null);

// Real thinking lines (Yukimi's Director / Xi sessions). See docs/research/director-mascot-cues.md.
assert.strictEqual(cues._test.wordCue('Hmm, I should be careful not to churn. The user\'s directive is posture and anatomy.').expression, 'thinking');
assert.deepStrictEqual(
    [cues._test.wordCue('Good, the GPU screencast works, so I\'ll leave that window as is.').expression,
        cues._test.wordCue('Good, the GPU screencast works, so I\'ll leave that window as is.').action],
    ['happy', 'bounce']
);
assert.strictEqual(cues._test.wordCue('But something\'s off: maybe the job is queued on the server and slow.').expression, 'frustrated', 'something\'s off beats maybe');
assert.strictEqual(cues._test.wordCue('I realize restarting the server now would kill my current turn').expression, 'surprised');
assert.strictEqual(cues._test.wordCue('Ah, the displayed view is scaled down. My earlier click missed because of that.').expression, 'surprised', 'ah / click missed is surprise, not the frustrated "missed"');
assert.strictEqual(cues._test.wordCue('she looks... actually similarly scaled?'), null, 'actually is not surprise');
assert.strictEqual(cues._test.wordCue('not perfect'), null, 'not perfect is not happy');
assert.strictEqual(cues._test.wordCue('wasteful but not broken'), null, 'not broken is not frustrated');
assert.strictEqual(cues._test.wordCue('not bad').expression, 'happy');
assert.strictEqual(cues._test.wordCue('Let me check the pose details').expression, 'focused');
assert.strictEqual(cues._test.wordCue('So target: a bit bigger than that, e.g. belly reaching just past her knees', 'kabuki').expression, 'smug');
assert.strictEqual(cues._test.wordCue('So target: a bit bigger than that', 'xi'), null, 'Xi does not take the size swagger');
// A look tool and a judgment in the same update: the judgment wins. A tool error still wins over praise.
c = cues.mascotCue('look', {
    persona: 'kabuki',
    rows: [{ type: 'tool', name: 'get_generated_image', result: 'a saved print' }],
    live: { type: 'thinking', text: 'But something\'s off: maybe the job is queued on the server and slow.' }
}, 1000);
assert.strictEqual(c.expression, 'frustrated');
c = cues.mascotCue('errface', {
    rows: [{ type: 'tool', name: 'Read', result: 'Error: failed to read' }],
    live: { type: 'thinking', text: 'Good, the GPU screencast works.' }
}, 1000);
assert.strictEqual(c.expression, 'frustrated');
// Same mood refreshes on SAME_KEY_MS, not on the shorter gap.
assert.ok(cues.mascotCue('steady', { live: { type: 'thinking', text: 'Hmm, careful.' } }, 1000));
assert.strictEqual(cues.mascotCue('steady', { live: { type: 'thinking', text: 'Hmm, still careful.' } }, 5000), null);
assert.strictEqual(cues.mascotCue('steady', { live: { type: 'thinking', text: 'Hmm, still careful.' } }, 9000).expression, 'thinking');
c = cues.mascotCue('swap', { live: { type: 'thinking', text: 'Hmm, careful.' } }, 1000);
c = cues.mascotCue('swap', { live: { type: 'thinking', text: 'Good, that landed.' } }, 5000);
assert.strictEqual(c.expression, 'happy', 'a different expression can land once the gap has passed');

// ---- client stage machine ----
const { DirectorMascot } = require('../public/scripts/comp/directorMascot.js');
let now = 1_000_000;
const realNow = Date.now;
Date.now = () => now;
global.document = { hidden: false };
global.localStorage = { getItem: () => null, setItem: () => {} };
const pending = [];
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms) => { pending.push({ at: now + (ms || 0), fn }); return pending.length; };
global.clearTimeout = () => {};
const run = (ms) => {
    const end = now + ms;
    while (true) {
        pending.sort((a, b) => a.at - b.at);
        const next = pending[0];
        if (!next || next.at > end) break;
        pending.shift();
        now = next.at;
        next.fn();
    }
    now = end;
};
const load = (persona) => {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public/static_images/director-mascots', persona, 'manifest.json'), 'utf8'));
    const m = new DirectorMascot();
    m.persona = persona;
    m.manifest = DirectorMascot.normalize(raw, persona);
    m.resetStage();
    return m;
};

// Kabuki: base -> (60 s of work) -> bigger with kicks -> (60 s after the first kick) -> bigger2, with in-betweens.
const k = load('kabuki');
assert.strictEqual(k.debugState().stage, 'base');
assert.strictEqual(k.currentBodyId(), 'base');
k.setWorking(true);
for (let i = 0; i < 59; i++) { now += 1000; k.tick(); }
assert.strictEqual(k.debugState().stage, 'base', 'not before 60 s of work');
now += 1500; k.tick();
assert.strictEqual(k.debugState().stage, 'bigger', 'straight to bigger (crossfade, no in-betweens)');
assert.strictEqual(k.currentBodyId(), 'bigger');
Math.random = () => 0;             // kicks as early as possible, no rubs (chance check)
k.stageState.nextKickAt = 0;
for (let i = 0; i < 25 && !k.stageState.firstKickAt; i++) { now += 1000; k.tick(); }
assert.ok(k.stageState.firstKickAt, 'a kick happened');
assert.ok(['bigger_kicky', 'bigger_rub_kicky'].includes(k.currentBodyId()), 'kicky body during a kick (with or without a rub)');
Math.random = () => 0.99;          // no further rubs
k.stageState.gestureUntil = 0;
now += 4000; k.tick();
assert.strictEqual(k.currentBodyId(), 'bigger', 'kick ends');
for (let i = 0; i < 60 && k.debugState().stage === 'bigger'; i++) { now += 1000; k.tick(); }
assert.strictEqual(k.debugState().stage, 'bigger2');
// One framing for every pose (no shrink or shift between stages): her starting pose's refCamera.
const camB2 = k.camera(); k.stageState.stage = 'bigger'; const camB = k.camera(); k.stageState.stage = 'bigger2';
assert.deepStrictEqual(camB2, camB, 'same camera in every stage');
assert.deepStrictEqual(camB, k.manifest.refCamera, 'the reference framing');
assert.ok(camB[0] >= 0 && camB[1] >= 0 && camB[0] + camB[2] <= k.manifest.size[0] + 1 && camB[1] + camB[3] <= k.manifest.size[1] + 1, 'inside the canvas');
// Reset after 10 minutes idle.
k.setWorking(false);
now += 601000; k.tick();
assert.strictEqual(k.debugState().stage, 'base');
// Rub: gesture body while active.
const k2 = load('kabuki'); k2.stageState.stage = 'bigger'; Math.random = () => 0.001;
k2.tick();
assert.strictEqual(k2.currentBodyId(), 'bigger_rub');

// Xi: kicks in base lead to bigger 60 s after the first kick; kon gestures.
const x = load('xi'); Math.random = () => 0;
assert.strictEqual(x.manifest.anchor, 'left');
for (let i = 0; i < 25 && !x.stageState.firstKickAt; i++) { now += 1000; x.tick(); }
assert.strictEqual(x.currentBodyId(), 'kon_kicky', 'gesture plus kick');
Math.random = () => 0.99;
for (let i = 0; i < 70 && x.debugState().stage === 'base'; i++) { now += 1000; x.tick(); }
assert.strictEqual(x.debugState().stage, 'bigger');

// Wren: work-driven advance; faces fall back to neutral for a missing expression.
const w = load('wren');
assert.strictEqual(w.manifest.anchor, 'left');
w.setWorking(true); now += 61000; w.tick(); run(420 * 4);
assert.strictEqual(w.debugState().stage, 'bigger');
w.expression = 'nope'; w.expressionUntil = now + 1000;
assert.ok(w.faceSet().expressions.neutral);

// Wren (Yumiya): the vore belly after a print sinks in (bigger), wings when a turn lands; both time out.
const y = load('wren'); y.stageState.stage = 'bigger';
y.showFor('printed', 6);
assert.strictEqual(y.currentBodyId(), 'bigger_vore');
run(6100);
assert.strictEqual(y.currentBodyId(), 'bigger');
y.onTurnEnd(true);
assert.strictEqual(y.currentBodyId(), 'mask_wings_bigger');
run(3100);
assert.strictEqual(y.currentBodyId(), 'bigger');
y.onTurnEnd(false);
assert.strictEqual(y.currentBodyId(), 'bigger', 'no wings on a failed turn');
assert.ok(y.manifest.faceSets.base.expressions.satisfied, 'satisfied face for after a print');

// v1 manifest still works.
const v1 = DirectorMascot.normalize({ size: [100, 200], layers: { body: 'b.webp', head: 'h.webp' }, expressions: { neutral: 'n.webp' } }, 'wren');
assert.deepStrictEqual(Object.keys(v1.bodies), ['main']);

// Every file a manifest names exists.
for (const persona of ['wren', 'kabuki', 'xi']) {
    const dir = path.join(__dirname, '..', 'public/static_images/director-mascots', persona);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const files = new Set();
    Object.values(m.bodies).forEach((b) => { files.add(b.body); if (b.head) files.add(b.head); });
    Object.values(m.faceSets).forEach((f) => { Object.values(f.expressions).forEach((e) => files.add(e)); if (f.blink) files.add(f.blink); if (f.mouth) files.add(f.mouth.talk); });
    Object.values(m.transitions || {}).forEach((t) => { t.frames.forEach((fr) => assert.ok(m.bodies[fr], `${persona} transition frame ${fr}`)); if (t.via) assert.ok(m.bodies[t.via]); });
    files.forEach((f) => assert.ok(fs.existsSync(path.join(dir, f)), `${persona}/${f}`));
}

Date.now = realNow;
global.setTimeout = realSetTimeout;
console.log('test-director-mascot: ok');
