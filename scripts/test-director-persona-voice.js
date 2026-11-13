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

    // 5. What she is carrying, said straight (Yukimi 2026-11-12), and never a rule she holds the user
    //    to (Yukimi 2026-11-13, #812): the two failing sessions had her quoting this line back as a veto.
    assert.ok(cfg.carry, `${persona}: says what she is carrying`);
    assert.ok(/straight/i.test(cfg.carry), `${persona}: the carry line is played straight`);
    assert.ok(/never (wink|explain)/i.test(cfg.carry), `${persona}: and is never explained or winked at`);
    assert.ok(/their word/i.test(cfg.carry), `${persona}: takes the user's word for it`);
    assert.ok(/not a rule she holds|only her own way of saying it|a way of talking and nothing more/.test(cfg.carry),
        `${persona}: the framing is hers, not a rule for them`);
    assert.ok(!/never let a line suggest|never say it is|never call it one|not a child and no partner/i.test(cfg.carry),
        `${persona}: the veto wording that caused the refusals is gone`);
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

        // 7. No premise-policing (#812). Every stage must carry the rules that stop the lectures: take
        //    their word, never veto the scene, never spend a turn on a refusal, answer warmth, vary the
        //    openers. Asserted per stage so a stage line cannot quietly drop them.
        assert.ok(prompt.includes('Never argue with their reading of the scene'), `${persona}/${stage}: no arguing with their reading`);
        assert.ok(prompt.includes('never refuse the same direction twice'), `${persona}/${stage}: no second refusal`);
        assert.ok(prompt.includes('steer, never veto'), `${persona}/${stage}: steers instead of vetoing`);
        assert.ok(prompt.includes('is a failed turn - no print, no report card'), `${persona}/${stage}: a refused turn is a failed turn`);
        assert.ok(prompt.includes('answer it. In your own register'), `${persona}/${stage}: warmth is answered`);
        assert.ok(prompt.includes('never with a count of how many times they have said it'), `${persona}/${stage}: affection is not counted at them`);
        assert.ok(prompt.includes('Vary how you open'), `${persona}/${stage}: the openers vary`);
        assert.ok(!/that is not what this is/.test(prompt) || prompt.includes('Never say "that is not what this is"'),
            `${persona}/${stage}: the phrase is only ever forbidden, never instructed`);
    });
});

// 7b. The in-between sizes are read off the points she is actually on.
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

// 8. The points are the little ones, and a kick is the good news (#813, Yukimi 2026-11-13).
PERSONAS.forEach((persona) => {
    const cfg = voice.PERSONA_VOICES[persona];
    const occupants = cfg.occupants || voice.personaVoiceLines(persona, { stage: cfg.order[0], points: 0, nextAt: 20 }, {}).join('\n');
    assert.ok(/one of them in you|one for every point/.test(occupants), `${persona}: the points are the ones inside her`);
    assert.ok(/the work is what makes more of them/.test(occupants), `${persona}: work makes more of them`);
    assert.ok(/kick|turning over|load moves/.test(occupants), `${persona}: she reads the movement inside her`);
    if (persona === 'wren') {
        assert.ok(/bu+r+p/i.test(occupants), 'Yumiya burps and it is pride, not embarrassment');
        assert.ok(/not an embarrassment/.test(occupants), 'and she does not apologize for it');
        assert.ok(/bu+r+p/i.test(cfg.direction), 'the burp is in her own examples too');
    } else {
        assert.ok(/safe and sound/.test(occupants), `${persona}: a kick means everyone inside is safe and sound`);
        assert.ok(!/bu+r+p/i.test(occupants), `${persona}: the burp belongs to Yumiya, not to her`);
    }

    // The state line opens every turn on her size and the distance to the next one, and the edge line
    // tells her to want it out loud.
    const mid = voice.personaVoiceLines(persona, { stage: cfg.order[0], points: 3, nextAt: 20 }, {}).join('\n');
    assert.ok(/^\[Your state\][^\n]*That is 3 of them carried inside you/.test(mid), `${persona}: opens on how many of them she carries`);
    assert.ok(/17 more before you grow again/.test(mid), `${persona}: and on how far the next size is`);
    assert.ok(/Every turn tells you how many of them you are carrying/.test(mid), `${persona}: the edge line rides on every turn`);

    const close = voice.personaVoiceLines(persona, { stage: cfg.order[0], points: 18, nextAt: 20 }, {}).join('\n');
    assert.ok(/this turn starts right against it/.test(close), `${persona}: within five points she starts against the edge`);

    const last = cfg.order[cfg.order.length - 1];
    const topped = voice.personaVoiceLines(persona, { stage: last, points: 99, nextAt: null }, {}).join('\n');
    assert.ok(/no size after this one/.test(topped), `${persona}: her last stage says there is no further`);
});

// 9. One streak each, and only hers (#814, Yukimi 2026-11-13): Yumiya silly, Chiyo possessive, Yozora
//    proud - each with its guardrail in the same line, and riding on every stage's prompt.
const QUIRKS = {
    wren: {
        has: /silly and a bit childish/i,
        guard: /never stupid/i,
        others: [/attached to them past good sense/i, /Your pride is in the work/i]
    },
    kabuki: {
        has: /attached to them past good sense/i,
        guard: /never land on them|affection, not control/i,
        others: [/silly and a bit childish/i, /Your pride is in the work/i]
    },
    xi: {
        has: /Your pride is in the work/i,
        guard: /check the edge nobody asked about|the reason the ones inside you come out perfect/i,
        others: [/silly and a bit childish/i, /attached to them past good sense/i]
    }
};
PERSONAS.forEach((persona) => {
    const cfg = voice.PERSONA_VOICES[persona];
    const q = QUIRKS[persona];
    assert.ok(cfg.quirk, `${persona}: has her own streak`);
    assert.ok(q.has.test(cfg.quirk), `${persona}: the streak is the one she was given`);
    assert.ok(q.guard.test(cfg.quirk), `${persona}: and it carries its guardrail`);
    q.others.forEach((re) => assert.ok(!re.test(cfg.quirk), `${persona}: no other persona's streak is grafted on`));
    cfg.order.forEach((stage) => {
        const at = cfg.points[cfg.order.indexOf(stage)];
        const prompt = voice.personaVoiceLines(persona, { stage, points: at, nextAt: cfg.points[cfg.order.indexOf(stage) + 1] }, {}).join('\n');
        assert.ok(prompt.includes(cfg.quirk), `${persona}/${stage}: the streak rides on the turn`);
    });
});
// Yozora is the one who says the fond thing out loud rather than only showing it.
assert.ok(/say it plainly|says it plainly/.test(voice.PERSONA_VOICES.xi.quirk), 'Yozora says it plainly');

const kabukiBase = voice.personaVoiceLines('kabuki', { stage: 'base', points: 0, nextAt: 20 }, {}).join('\n');
assert.ok(kabukiBase.includes('Growth stage: 1/3 "base"'), 'base is stated');
assert.ok(kabukiBase.includes('exactly at this stage and no further'), 'base is capped');
assert.ok(kabukiBase.includes(voice.PERSONA_VOICES.kabuki.looks.base), 'her own look is in the prompt');
assert.ok(!kabukiBase.includes(voice.PERSONA_VOICES.kabuki.looks.bigger2), 'a later stage is not described as hers');
assert.ok(kabukiBase.includes('next stage at 20'), 'the state line carries the next rung');

const kabukiStray = voice.personaVoiceLines('kabuki', { stage: 'stuffed', points: 50, nextAt: 50 }, {}).join('\n');
assert.ok(kabukiStray.includes('the stage the client sent is not one this persona has'), 'another persona\'s stage is not accepted');
assert.ok(kabukiStray.includes('speak from Stage 1 of 3'), 'and she falls back to her first stage');

// 10. Yozora (the coding agent) gets the coding ladder, not the print one.
const xi = voice.personaVoiceLines('xi', { stage: 'bigger', points: 20, nextAt: 20 }, { coding: true }).join('\n');
assert.ok(xi.includes('The code, the facts and the commands stay exact'), 'Yozora keeps the coding ladder');
assert.ok(!xi.includes('amp the picture and the closeness'), 'Yozora does not get the print amp line');
assert.ok(xi.includes('There is no stage after this one'), 'her last stage is announced as the last');
assert.ok(xi.includes('2 of 2 in-between sizes') === false, 'no in-between claim at the exact rung');

console.log('test-director-persona-voice: ok');
