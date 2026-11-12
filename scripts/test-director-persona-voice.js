/**
 * Director persona voices: carrying, kicks and the amp ladder (Yozora #768, Yukimi 2026-11-12).
 *
 * The three voice blocks in modules/directorPersonaVoice.js are the system message each persona
 * speaks from. They must match the sprites: the stage order, the point thresholds and the
 * in-between sizes come from the manifests, and the kick talk is only allowed where the manifest
 * actually has a kicky pose. This pins the text to the art so neither can drift.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const voice = require('../modules/directorPersonaVoice');

const MASCOT_DIR = path.join(__dirname, '..', 'public/static_images/director-mascots');
const PERSONAS = ['wren', 'kabuki', 'xi'];

const CARRY_RE = /\b(belly|kick|kicks|kicking|carry|carrying|heavy|weight|movement)\b/i;

function manifest(persona) {
    return JSON.parse(fs.readFileSync(path.join(MASCOT_DIR, persona, 'manifest.json'), 'utf8'));
}

// behaviour.growth.steps is per stage; flattened and sorted that is every in-between size the
// sprite has, in the order the points reach them.
function manifestSteps(growth) {
    const flat = [];
    Object.keys(growth.steps || {}).forEach((stage) => {
        (growth.steps[stage] || []).forEach((step) => flat.push(step.at));
    });
    return flat.sort((a, b) => a - b);
}

PERSONAS.forEach((persona) => {
    const cfg = voice.PERSONA_VOICES[persona];
    const m = manifest(persona);
    const growth = (m.behaviour || {}).growth;

    assert.ok(cfg, `${persona} has a voice block`);
    assert.ok(growth, `${persona} manifest has behaviour.growth`);

    // 1. The text can never disagree with the sprite about the ladder.
    assert.deepStrictEqual(cfg.order, growth.order, `${persona}: stage order matches the manifest`);
    assert.deepStrictEqual(cfg.points, growth.points, `${persona}: thresholds match the manifest`);
    assert.deepStrictEqual(cfg.steps, manifestSteps(growth), `${persona}: in-between sizes match the manifest`);

    // 2. Every stage she can be on has something to see and something to say.
    cfg.order.forEach((stage) => {
        assert.ok(cfg.looks[stage], `${persona}: ${stage} has a look line`);
        assert.ok(cfg.stages[stage], `${persona}: ${stage} has a stage line`);
        assert.ok(CARRY_RE.test(cfg.looks[stage]), `${persona}: ${stage} look carries the belly`);
        assert.ok(CARRY_RE.test(cfg.stages[stage]), `${persona}: ${stage} stage line carries the belly`);
    });

    // 3. She is carrying in her own description, not only at the rungs.
    assert.ok(CARRY_RE.test(cfg.self), `${persona}: self describes the body she carries`);
    assert.ok(/kick|mov/i.test(cfg.self), `${persona}: self says the weight is moving`);

    // 4. Kicks are claimed only where the manifest has a kicky pose: Chiyo from her second stage,
    //    Yozora from her first, and Yumiya's load shifts instead (her art has no kicky body).
    const kicky = (m.behaviour || {}).kicky;
    if (kicky) {
        assert.ok(/kick/i.test(cfg.stages[kicky.stage]), `${persona}: kicks are spoken from the stage the sprite kicks in (${kicky.stage})`);
    } else {
        assert.ok(/shift|settle|lump|movement/i.test(cfg.looks.bigger + cfg.looks.stuffed), `${persona}: movement is described without a kicky pose`);
    }

    // 5. What she is carrying, said straight (Yukimi 2026-11-12): the work, never a child, and Yumiya's
    //    is vore - she is the one who is not carrying anything tender.
    assert.ok(cfg.carry, `${persona}: says what she is carrying`);
    assert.ok(/not a (child|baby)|never (call it|say it is)/i.test(cfg.carry), `${persona}: the carry line rules out a child`);
    assert.ok(/straight/i.test(cfg.carry), `${persona}: the carry line is played straight`);
    assert.ok(/never (wink|explain|let a line suggest)/i.test(cfg.carry), `${persona}: and is never explained or winked at`);
    if (persona === 'wren') {
        assert.ok(/vore/i.test(cfg.carry) && /vore/i.test(cfg.self), 'Yumiya is the vore one, in her carry line and in who she is');
        assert.ok(!/solemnity of a woman well along/.test(cfg.self), 'Yumiya is not framed as expecting');
    } else {
        assert.ok(/solemnity of a woman well along/.test(cfg.self), `${persona}: carries like a woman well along`);
    }
});

// 5. The body-sense line reaches every persona's prompt, and no stage forgives a promised kick.
PERSONAS.forEach((persona) => {
    const out = voice.personaVoiceLines(persona, { stage: voice.PERSONA_VOICES[persona].order[0], points: 0, nextAt: 20 }, {});
    const joined = out.join('\n');
    assert.ok(joined.includes('You feel your own size from the inside'), `${persona}: prompt has the body-sense line`);
    assert.ok(joined.includes('never promise a kick on cue'), `${persona}: prompt forbids kicks on cue`);
    assert.ok(/amp the picture and the closeness|amp the picture, the belly and the closeness|bigger belly than the last/.test(joined), `${persona}: prompt has the amp ladder`);
});

// 6. Turned all the way up on purpose, and never over into explicit (Yukimi 2026-11-12). Every prompt
//    for every stage of every persona is checked, so a later edit cannot quietly push it over.
const EXPLICIT_RE = /\b(sex|sexual|sexy|aroused|arousal|nipples?|breasts?|tits|penis|cock|pussy|vagina|cum|orgasm|climax|erotic|erotica|lewd|naked|nude|undress(ed|ing)?|strip(tease|ped)|fuck(ing|ed)?|moan(s|ing)?|sexy)\b/i;
PERSONAS.forEach((persona) => {
    const cfg = voice.PERSONA_VOICES[persona];
    const fields = [cfg.direction, cfg.self, cfg.want, cfg.carry, cfg.bond, cfg.stages, cfg.looks, cfg.near];
    const all = JSON.stringify(fields);
    assert.ok(!EXPLICIT_RE.test(all), `${persona}: nothing explicit in the voice block`);
    cfg.order.forEach((stage) => {
        const at = cfg.points[cfg.order.indexOf(stage)];
        const prompt = voice.personaVoiceLines(persona, { stage, points: at, nextAt: cfg.points[cfg.order.indexOf(stage) + 1] }, {}).join('\n');
        assert.ok(!EXPLICIT_RE.test(prompt), `${persona}/${stage}: nothing explicit in the built prompt`);
        assert.ok(prompt.includes('Do not tone any of this down'), `${persona}/${stage}: the tone line rides on every turn`);
        assert.ok(prompt.includes('never being explicit'), `${persona}/${stage}: and states the ceiling`);
        assert.ok(prompt.includes('never step outside the character to admit what this is'), `${persona}/${stage}: she never breaks to wink at it`);
    });
});

// 7. The in-between sizes are read off the points she is actually on.
assert.ok(/none of this stage's 2 in-between sizes yet, and the next one is 7 points away/
    .test(voice.inBetweenLine(voice.PERSONA_VOICES.kabuki, { stage: 'base', points: 0 })), 'base at 0 points: nothing taken yet');
assert.ok(/she has taken 1 of 2 in-between sizes inside this stage, and the next one is 6 points away/
    .test(voice.inBetweenLine(voice.PERSONA_VOICES.kabuki, { stage: 'base', points: 7 })), 'base at 7 points: one size taken');
assert.ok(/she has taken 2 of 2 in-between sizes inside this stage\./
    .test(voice.inBetweenLine(voice.PERSONA_VOICES.kabuki, { stage: 'base', points: 13 })), 'base at 13 points: both taken, none named');
assert.ok(/none of this stage's 2 in-between sizes yet, and the next one is 12 points away/
    .test(voice.inBetweenLine(voice.PERSONA_VOICES.xi, { stage: 'bigger', points: 20 })), 'Yozora at 20 points, next at 32');
assert.ok(/she has taken 2 of 2 in-between sizes/.test(
    voice.inBetweenLine(voice.PERSONA_VOICES.xi, { stage: 'bigger', points: 44 })), 'Yozora at 44 points, both taken');
assert.strictEqual(voice.inBetweenLine(voice.PERSONA_VOICES.xi, { stage: 'stuffed', points: 5 }), '', 'a stage she does not have reports nothing');

// 8. The stage she is on is the only one she may speak from, and the state line still counts her up.
const kabukiBase = voice.personaVoiceLines('kabuki', { stage: 'base', points: 0, nextAt: 20 }, {}).join('\n');
assert.ok(kabukiBase.includes('Growth stage: 1/3 "base"'), 'base is stated');
assert.ok(kabukiBase.includes('exactly at this stage and no further'), 'base is capped');
assert.ok(kabukiBase.includes(voice.PERSONA_VOICES.kabuki.looks.base), 'her own look is in the prompt');
assert.ok(!kabukiBase.includes(voice.PERSONA_VOICES.kabuki.looks.bigger2), 'a later stage is not described as hers');
assert.ok(kabukiBase.includes('next stage at 20'), 'the state line carries the next rung');

const kabukiStray = voice.personaVoiceLines('kabuki', { stage: 'stuffed', points: 50, nextAt: 50 }, {}).join('\n');
assert.ok(kabukiStray.includes('the stage the client sent is not one this persona has'), 'another persona\'s stage is not accepted');
assert.ok(kabukiStray.includes('speak from Stage 1 of 3'), 'and she falls back to her first stage');

// 9. Yozora (the coding agent) gets the coding ladder, not the print one.
const xi = voice.personaVoiceLines('xi', { stage: 'bigger', points: 20, nextAt: 20 }, { coding: true }).join('\n');
assert.ok(xi.includes('The code, the facts and the commands stay exact'), 'Yozora keeps the coding ladder');
assert.ok(!xi.includes('amp the picture and the closeness'), 'Yozora does not get the print amp line');
assert.ok(xi.includes('There is no stage after this one'), 'her last stage is announced as the last');
assert.ok(xi.includes('2 of 2 in-between sizes') === false, 'no in-between claim at the exact rung');

console.log('test-director-persona-voice: ok');
