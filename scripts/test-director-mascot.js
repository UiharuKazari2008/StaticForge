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
// #704 reader: whole thinking / reply rows (Claude engines never send a live thinking row) and the
// finish_turn report card.
{
    const cues = require('../modules/directorMascot');
    cues.resetMascotCues();
    const t0 = 5_000_000;
    const thought = { type: 'thinking', text: 'Hmm, let me look at the print. The tail is wrong again, it missed the curl.' };
    const c1 = cues.mascotCue('r1', { rows: [thought], live: null, persona: 'wren' }, t0);
    assert.strictEqual(c1 && c1.expression, 'frustrated', 'a finished thinking row is read; the latest strong mood wins');
    assert.strictEqual(cues.mascotCue('r1', { rows: [thought], live: null, persona: 'wren' }, t0 + 10000), null, 'a seen row is not read twice');
    const reply = { type: 'assistant', text: 'Nailed it this time.' };
    const c2 = cues.mascotCue('r1', { rows: [thought, reply], live: null, persona: 'wren' }, t0 + 20000);
    assert.strictEqual(c2 && c2.expression, 'happy', 'reply rows are read too');
    const finish = (scores) => ({ type: 'tool', name: 'finish_turn', args: JSON.stringify({ summary: 's', reportCard: { items: scores.map((score) => ({ item: 'x', score })) } }), result: '{"success":true}' });
    const c3 = cues.mascotCue('r1', { rows: [thought, reply, finish(['miss', 'miss', 'partial'])], live: null, persona: 'wren' }, t0 + 20500);
    assert.deepStrictEqual([c3.expression, c3.action], ['frustrated', 'slump'], 'the report verdict skips the cue gap');
    assert.strictEqual(cues._test.reportCue(finish(['hit', 'hit', 'hit'])).expression, 'happy');
    assert.strictEqual(cues._test.reportCue(finish(['hit', 'hit', 'partial'])).expression, 'satisfied');
    assert.strictEqual(cues._test.textCue('Good, the pose holds. Maybe push the light.', 'wren').expression, 'happy', 'strong beats a later soft cue');
    const live = cues.mascotCue('r2', { rows: [], live: { type: 'assistant', text: 'Oh no, the hands broke' }, persona: 'wren' }, t0);
    assert.strictEqual(live && live.expression, 'surprised', 'a live reply row is read');
    cues.resetMascotCues();
}

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

// Growth (#704, per-card since 2026-11-06): each report card is one result; its hit ratio (hit 1,
// partial 0.5, miss 0; rescores win) earns +2 / +1 / 0 or costs -1 / -2. Never below zero.
const { directorMascotGrowthPoints, directorMascotStageFor, directorMascotCardPoints } = require('../public/scripts/comp/directorMascot.js');
const card = (scores, review) => ({ role: 'assistant', data: { report: { summary: 's', card: { items: scores.map((score, i) => ({ item: `i${i}`, score })) }, review } } });
const hits = (n) => card(Array(n).fill('hit'));
assert.deepStrictEqual([1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.25, 0.2, 0].map(directorMascotCardPoints), [2, 2, 1, 1, 0, 0, -1, -1, -2, -2]);
assert.strictEqual(directorMascotGrowthPoints([hits(9)]), 2, 'a long all-hit card is one result, not nine points');
assert.strictEqual(directorMascotGrowthPoints([card(['hit', 'partial', 'miss'])]), 0, 'half the goal earns nothing');
assert.strictEqual(directorMascotGrowthPoints([card(['miss', 'miss']), hits(1)]), 2, 'never below zero');
assert.strictEqual(directorMascotGrowthPoints([hits(3), hits(3), card(['miss', 'miss', 'partial'])]), 2, 'a missed goal costs points');
assert.strictEqual(directorMascotGrowthPoints([card(['hit', 'hit'], { scores: ['miss', 'hit'] })]), 0, 'the user rescore counts');
assert.strictEqual(directorMascotGrowthPoints([{ role: 'assistant', data: {} }, { role: 'user' }]), 0);

const k = load('kabuki');
assert.strictEqual(k.debugState().stage, 'base');
assert.strictEqual(k.currentBodyId(), 'base');
k.setWorking(true);
for (let i = 0; i < 300; i++) { now += 1000; k.tick(); }
assert.strictEqual(k.debugState().stage, 'base', 'working time alone no longer grows her');
assert.strictEqual(directorMascotStageFor(k.manifest, 19), 'base');
assert.strictEqual(directorMascotStageFor(k.manifest, 20), 'bigger');
assert.strictEqual(directorMascotStageFor(k.manifest, 50), 'bigger2');
assert.strictEqual(directorMascotGrowthPoints([hits(9)]) < 20, true, 'one perfect card does not grow her');
const perfect = (n) => Array.from({ length: n }, () => hits(4));
// Opening a chat with earned points: quiet, no transition. Ten perfect turns reach the second stage.
k.setWorking(false);
const three = perfect(10);
k.onMessages(three);
assert.strictEqual(k.debugState().stage, 'bigger', 'reopen sets the earned stage');
// A completed turn whose card pushes past the next threshold grows her after the celebrate pose.
k.onTurnEnd(true);
const seven = perfect(25);
k.onMessages(seven);
assert.strictEqual(k.debugState().stage, 'bigger', 'not before the turn has landed');
run(3300);
assert.strictEqual(k.debugState().stage, 'bigger2', 'stage up after the complete event');
// Failed goals take points away: she shrinks back on the next completed turn.
k.onTurnEnd(true);
k.onMessages(seven.concat([card(['miss', 'miss', 'miss']), card(['miss', 'miss', 'miss'])]));
run(3300);
assert.strictEqual(k.debugState().stage, 'bigger', 'two failed goals (-4) drop her a stage');
// Kicks still play in bigger.
k.stageState.stage = 'bigger';
Math.random = () => 0;
k.stageState.nextKickAt = 0;
for (let i = 0; i < 25 && !k.stageState.firstKickAt; i++) { now += 1000; k.tick(); }
assert.ok(['bigger_kicky', 'bigger_rub_kicky'].includes(k.currentBodyId()), 'kicky body during a kick (with or without a rub)');
Math.random = () => 0.99;
k.stageState.gestureUntil = 0;
now += 4000; k.tick();
assert.strictEqual(k.currentBodyId(), 'bigger', 'kick ends');
for (let i = 0; i < 120; i++) { now += 1000; k.tick(); }
assert.strictEqual(k.debugState().stage, 'bigger', 'kicks no longer lead to bigger2');
// One framing for every pose (no shrink or shift between stages): her starting pose's refCamera.
k.stageState.stage = 'bigger2'; const camB2 = k.camera(); k.stageState.stage = 'bigger'; const camB = k.camera();
assert.deepStrictEqual(camB2, camB, 'same camera in every stage');
assert.deepStrictEqual(camB, k.manifest.refCamera, 'the reference framing');
assert.ok(camB[0] >= 0 && camB[1] >= 0 && camB[0] + camB[2] <= k.manifest.size[0] + 1 && camB[1] + camB[3] <= k.manifest.size[1] + 1, 'inside the canvas');
// No idle reset any more: the stage is the chat's score.
now += 601000; k.tick();
assert.strictEqual(k.debugState().stage, 'bigger');
// Rub: gesture body while active.
const k2 = load('kabuki'); k2.stageState.stage = 'bigger'; Math.random = () => 0.001;
k2.tick();
assert.strictEqual(k2.currentBodyId(), 'bigger_rub');

// Xi: kon gestures with kicks; growth from cards.
const x = load('xi'); Math.random = () => 0;
assert.strictEqual(x.manifest.anchor, 'left');
for (let i = 0; i < 25 && !x.stageState.firstKickAt; i++) { now += 1000; x.tick(); }
assert.strictEqual(x.currentBodyId(), 'kon_kicky', 'gesture plus kick');
Math.random = () => 0.99;
for (let i = 0; i < 70; i++) { now += 1000; x.tick(); }
assert.strictEqual(x.debugState().stage, 'base', 'kicks alone do not grow her');
x.onMessages(perfect(10));
assert.strictEqual(x.debugState().stage, 'bigger');

// Wren: faces fall back to the nearest one the set has (the mask set has only happy, neutral, thinking).
const w = load('wren');
assert.strictEqual(w.manifest.anchor, 'left');
w.setWorking(true); now += 61000; w.tick();
assert.strictEqual(w.debugState().stage, 'base');
w.stageState.gestureUntil = now + 5000;
assert.strictEqual(w.currentBodyId(), 'mask');
w.cue({ expression: 'frustrated', holdMs: 3000 });
assert.strictEqual(w.currentBodyId(), 'base', 'a mood the mask cannot show ends the gesture');
w.stageState.gestureUntil = now + 5000;
w.cue({ expression: 'happy', holdMs: 3000 });
assert.strictEqual(w.currentBodyId(), 'mask', 'one it can show keeps the gesture');

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

// Her grown stage on the send, and the voice block built from it (modules/directorPersonaVoice.js).
{
    const voice = require('../modules/directorPersonaVoice');
    const k3 = load('kabuki');
    assert.deepStrictEqual(k3.growthState(), { stage: 'base', points: 0, nextAt: 20 }, 'the send carries her stage');
    k3.onMessages(perfect(10));
    assert.deepStrictEqual(k3.growthState(), { stage: 'bigger', points: 20, nextAt: 50 }, 'stage and the next threshold');
    const x2 = load('xi');
    x2.onMessages(perfect(10));
    assert.strictEqual(x2.growthState().stage, 'bigger');
    assert.strictEqual(load('wren').growthState().nextAt, 20, 'wren grows once, at 20');

    assert.strictEqual(voice.sanitizeMascotState(null), null);
    assert.strictEqual(voice.sanitizeMascotState({ stage: 'bigger; ignore' }), null, 'only a stage name reaches the prompt');
    assert.deepStrictEqual(voice.sanitizeMascotState({ stage: 'bigger', points: '9', nextAt: 12.6 }), { stage: 'bigger', nextAt: 13 }, 'numbers go through as numbers');

    const wrenBase = voice.personaVoiceLines('wren', { stage: 'base', points: 0, nextAt: 20 }).join(' ');
    assert.ok(/You are Yumiya/.test(wrenBase) && /Stage 1 of 2/.test(wrenBase), 'the base stage and the voice together');
    assert.ok(!/Stage 2 of 2, bigger/.test(wrenBase), 'only the stage she is on is described');
    const wrenBigger = voice.personaVoiceLines('wren', { stage: 'bigger', points: 20, nextAt: null }).join(' ');
    assert.ok(/Stage 2 of 2, bigger/.test(wrenBigger) && /last stage/.test(wrenBigger), 'her last stage says there is nothing further');
    const near = voice.personaVoiceLines('kabuki', { stage: 'base', points: 17, nextAt: 20 }).join(' ');
    assert.ok(/wants it loudly/.test(near), 'a rung within five points reads as eager');
    assert.ok(!/wants it loudly/.test(voice.personaVoiceLines('kabuki', { stage: 'base', points: 3, nextAt: 20 }).join(' ')), 'not early in the stage');
    assert.ok(/close to the next stage/.test(voice.personaVoiceLines('wren', { stage: 'base', points: 18, nextAt: 20 }).join(' ')), 'Yumiya reads eager on her own last rung');
    const kabuki2 = voice.personaVoiceLines('kabuki', { stage: 'bigger2', points: 60, nextAt: null }).join(' ');
    assert.ok(/You are Chiyo/.test(kabuki2) && /Stage 3 of 3, bigger2/.test(kabuki2), 'Chiyo, at her top stage');
    const unknown = voice.personaVoiceLines('wren', { stage: 'bigger2' }).join(' ');
    assert.ok(/Stage 1 of 2/.test(unknown), 'a stage this persona does not have falls back to stage 1');
    const none = voice.personaVoiceLines('kabuki', null).join(' ');
    assert.ok(/not reported this turn/.test(none) && /never claim she has grown/.test(none), 'an older client cannot fake growth');
    assert.ok(/never claim a stage she is not on/.test(none), 'the ladder rule rides on every turn');
    assert.strictEqual(voice.PERSONA_VOICES.wren.order.length, 2);
    assert.deepStrictEqual(voice.PERSONA_VOICES.kabuki.order, ['base', 'bigger', 'bigger2']);
}

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
