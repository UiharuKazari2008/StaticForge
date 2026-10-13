'use strict';

// Rentan server-side resolver (#422). One structured TokenRouter call (default DeepSeek
// V4.1 Flash, the `normal` lane of the #418 gate) answers the scene with the same JSON
// deliver_rentan takes, so Studio waits seconds instead of an agent turn. The scene
// rules, job lines, and checks are the agent's own (modules/cursorDirector.js), so both
// engines resolve to the same contract. Cursor and Claude stay as agent engines for when
// the TokenRouter balance is low but subscription usage is free.

const tokenRouter = require('./tokenRouterBridge');

const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';
// Thinking off: the #422 replay resolved 19/19 recorded jobs at a 7 s median and about
// $0.001 each, against about 30 s with thinking on low and 73 s for the agent turn.
const DEFAULT_EFFORT = 'none';
// Control -> the dg_ expander it must produce (checked on the server resolve only).
const REQUIRED_EXPANDERS = [['tod', 'dg_time'], ['weather', 'dg_weather'], ['season', 'dg_season']];
const MAX_TOKENS = 6000;

function director() {
    return require('./cursorDirector');
}

// One fixed system prompt for the server resolve: short numbered rules, hard rules first,
// every control explained once. Identical on every call, so TokenRouter's prefix cache covers
// it; the job only says which controls are on. (Yukimi #422: a non-thinking model follows a
// clear, ordered, concise prompt; the agent's tool-turn rules were too long for it.)
const SYSTEM_PROMPT = [
    'You are Rentan. You fit a NovelAI image prompt to the moment it is printed in: time of day, weather, season, holiday, place. Reply with one JSON object only. No questions, no prose.',
    '',
    'OUTPUT',
    '{"expanders":[{"prefix":"dg_time","value":"tags","reason":"what in the context drove it"}],"prompt":"full base prompt, only if you changed it","uc":"only if changed","characters":[{"index":0,"prompt":"only slots you changed"}],"applied":{"<control id>":"one line: what you changed and why"},"summary":"one line"}',
    '- expanders lists every dg_ expander to keep.',
    '- applied has one line for each id under "Controls on", keyed by that id.',
    '',
    'HARD RULES',
    '1. No numbers in dg_ values or scene tags: no clock times, dates, temperatures, percentages, or speeds. Write what the camera sees ("low morning sun", not "07:40").',
    '2. dg_ values are short comma-separated NovelAI tags: present tense, visible things only.',
    '3. Everything agrees: each dg_ value, each scene tag in the prompt, and the context. No fog or mist under a clear midday sky, no sun or hard shadows under overcast, no stars by day, plants that match the season.',
    '4. The prompt carries !dg_<name> where that expander belongs (add a missing one once). Never paste an expander value into the prompt.',
    '5. Keep who the characters are, their bodies, and the artist. Change outfit or pose only when a control allows it.',
    '6. Emphasis 1.1 to 1.4::tags:: for the strongest context, never above 1.5.',
    '',
    'EXPANDERS',
    '- dg_time: the light of context.period (sun up or down, its phase, how much light).',
    '- dg_weather: sky, cloud, rain or snow, and wind as visible things (sky color, wet ground, puddles, moving hair and cloth, haze, frost). Recent rain still shows on surfaces.',
    '- dg_season: foliage, ground cover, seasonal props.',
    '- dg_holiday: only when context.holiday is present: its decorations and colors, stronger as intensity rises.',
    '- dg_action: only when action is on: how the character reacts to this light, air, and season, as pose tags.',
    '- dg_scene: place, composition, and any creative flourish.',
    'context.period and context.season tables are guidance: pick what fits this frame, reword it, drop the rest. A Directive is the creative ask: fold it into dg_scene and the prompt.',
    '',
    'EDITING THE PROMPT',
    '- You may edit the prompt, UC, and character prompts where the scene needs it: remove or reword tags that contradict the context (sunny sky at night, snow in summer, a stale place), fix broken syntax, move scene details into dg_ expanders.',
    '- Bodies and outfits decide reactions. Read each character\'s body state (size, pregnancy, fatigue, wet or cold skin) and clothes first. A heavy belly is braced, not bent over; wind presses a tight bodysuit flat; long hair and loose sleeves blow, bound hair does not. Weather lands on the body (sun on skin, flushed cheeks, damp fabric clinging).',
    '',
    'CONTROLS (only those under "Controls on" apply; a value after an id, like weather: "rain", is fixed by the user)',
    '- tod: write dg_time. Low warm light near sunrise and sunset, overhead and hard at midday, no sun at night.',
    '- weather: write dg_weather.',
    '- season: write dg_season. Scene plants match it.',
    '- observeHoliday: write dg_holiday when context.holiday is present.',
    '- guidance: carry the context.period lighting and atmosphere tags, heaviest rows at 1.1 to 1.4. Put period.uc tags in the UC.',
    '- clothing: adapt the outfit to weather, season, and activity; keep identity items (signature accessories, colors). When off: do not change the outfit.',
    '- action: write dg_action and put !dg_action next to the pose tags. Keep the core pose; swap a pose tag only where it conflicts. When off: keep pose and action tags, no dg_action.',
    '- creative: light = one flourish in dg_scene. medium = an idea for the frame in the same place: composition (angle, distance, layers, where the light falls), a small moment the context allows, a visible mood. high = reframe the shot and pick a striking moment; you may move to a place that suits the time, weather, and season. Every level also tightens the prompt: drop duplicate or weak tags, fix tags that fight the context, and turn what the camera cannot see (backstory, feelings, counts) into visible tags or drop it.',
    '- optimize: tighten the prompt. Drop duplicate, weak, or contradicting tags.',
    '- lockSubject: do not edit subject, body, outfit, or action tags. Only scene, light, and weather change.',
    'When Why names a control that changed, apply that change now, even if the context did not.',
    '',
    'REDUCED CONTEXT (only when the job says "Setting: indoor" or "Setting: outdoor" and gives no prompt)',
    '- Write only dg_ expanders, as additions for that setting. Do not return prompt, uc, or characters; the user cleans up their own prompt.',
    '- indoor: light as it falls inside (window light, lamps), weather through the windows or carried in (rain on the glass, a wet umbrella), the season in decor, plants, and the view outside. No open sky overhead, no wind on the body.',
    '- outdoor: the open sky, weather on the ground, air on bodies and clothes, foliage and seasonal props in the scene.',
    '- dg_action, when action is on: a reaction that fits the setting (warming hands by a window indoors, shading eyes outdoors).',
    '',
    'BEFORE YOU ANSWER',
    'Check: no numbers in any dg_ value; every control under "Controls on" has its expander and its applied line; nothing contradicts dg_time or dg_weather.'
].join('\n');

function systemPrompt() {
    return SYSTEM_PROMPT;
}

// Control order as the Studio sends them (modules/dynagenWren.js rentanControls).
const CONTROL_ORDER = ['tod', 'weather', 'season', 'observeHoliday', 'guidance', 'clothing', 'action', 'creative', 'optimize', 'lockSubject'];

function controlLines(controls) {
    const c = controls || {};
    const on = [];
    const off = [];
    CONTROL_ORDER.forEach((key) => {
        const value = c[key];
        if (value === false || value === undefined || value === null) {
            off.push(key);
        } else if (value === true) {
            on.push(key);
        } else {
            on.push(`${key}: ${JSON.stringify(value)}`);
        }
    });
    const lines = [`Controls on: ${on.length ? on.join(', ') : 'none'}`];
    if (off.length) lines.push(`Controls off: ${off.join(', ')}`);
    if (c.disable_holiday) lines.push('Holidays are disabled: no dg_holiday.');
    return lines;
}

// The job: why, which controls are on, the context, and the prompt as it stands.
function jobMessage(job) {
    const j = job || {};
    const lines = [`Why: ${j.reason || 'context refresh'}`];
    lines.push(...controlLines(j.controls));
    lines.push(`Context: ${JSON.stringify(j.context || null)}`);
    if (j.directive) lines.push(`Directive: ${j.directive}`);
    if (j.reducedContext) {
        // Reduced Prompt Context (#432): the model never sees the prompt.
        lines.push(`Setting: ${j.reducedContext}`);
        lines.push('No prompt is given (reduced context). Write dg_ expanders only.');
    } else {
        lines.push(`Prompt:\n${j.prompt || ''}`);
        if (j.uc) lines.push(`UC:\n${j.uc}`);
        if (Array.isArray(j.characters) && j.characters.length) lines.push(`Characters: ${JSON.stringify(j.characters)}`);
        lines.push(`Current dg_ expanders: ${JSON.stringify(j.expanders || [])}`);
    }
    // Spell out exactly what this answer must contain; the checks reject anything less.
    const c = j.controls || {};
    const expanders = REQUIRED_EXPANDERS.filter(([key]) => c[key]).map(([, prefix]) => prefix);
    if (c.action && !c.lockSubject) expanders.push('dg_action');
    const keys = director().dynagenRequiredControls(c);
    if (expanders.length || keys.length) {
        lines.push(`Your answer must include: ${[
            expanders.length ? `expanders ${expanders.join(', ')}` : '',
            keys.length ? `applied keys ${keys.join(', ')}` : ''
        ].filter(Boolean).join('; ')}.`);
    }
    return lines.join('\n');
}

// Backstop for hard rule 1: digits outside emphasis weights (1.2::tags::) are a clock, date, or reading.
function rejectNumbers(change) {
    const bad = change.expanders
        .map((e) => ({ prefix: e.prefix, hit: e.value.replace(/\d+(?:\.\d+)?::/g, '').match(/[^,]*\d[^,]*/) }))
        .filter((row) => row.hit);
    if (bad.length) {
        const error = new Error(`Hard rule 1: no numbers in dg_ values. Rewrite ${bad.map((row) => `"${row.hit[0].trim()}" in ${row.prefix}`).join(', ')} as what the camera sees.`);
        error.code = 'RENTAN_RULE_BROKEN';
        throw error;
    }
}

function requireControlExpanders(change, controls) {
    const have = new Set(change.expanders.map((e) => e.prefix.toLowerCase()));
    const missing = REQUIRED_EXPANDERS
        .filter(([key, prefix]) => controls && controls[key] && !have.has(prefix))
        .map(([, prefix]) => prefix);
    if (missing.length) {
        const error = new Error(`Missing ${missing.join(', ')}: each control that is on needs its own dg_ expander.`);
        error.code = 'RENTAN_CONTROLS_UNAPPLIED';
        throw error;
    }
}

function parseAnswer(text) {
    const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('The answer was not a JSON object');
    return JSON.parse(raw.slice(start, end + 1));
}

// { change, model, usage, ms, tries }. Throws RENTAN_SERVER_FAILED after the retry.
async function resolveScene(gr, job, agent) {
    const choice = agent || {};
    const model = choice.model || DEFAULT_MODEL;
    const effort = choice.effort || DEFAULT_EFFORT;
    const messages = [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: jobMessage(job) }
    ];
    if (typeof job.onThought === 'function') {
        job.onThought(`Resolving the scene on ${model.split('/').pop()}...`, 'rentan-server');
    }
    let lastError = null;
    const usage = { prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 };
    const started = Date.now();
    for (let tries = 1; tries <= 2; tries++) {
        let reply;
        try {
            reply = await tokenRouter.chatCompletion({ model, messages, max_tokens: MAX_TOKENS }, {
                gr, json: true, effort, lane: 'normal', label: 'rentan', timeoutMs: 120000
            });
        } catch (error) {
            lastError = error;
            if (error.code === 'TOKENROUTER_KEY_MISSING') break;
            continue;
        }
        if (reply.usage) {
            usage.prompt_tokens += Number(reply.usage.prompt_tokens) || 0;
            usage.completion_tokens += Number(reply.usage.completion_tokens) || 0;
            usage.cached_tokens += Number(reply.usage.prompt_tokens_details && reply.usage.prompt_tokens_details.cached_tokens) || 0;
            usage.reasoning_tokens = (usage.reasoning_tokens || 0) + (Number(reply.usage.completion_tokens_details && reply.usage.completion_tokens_details.reasoning_tokens) || 0);
        }
        try {
            const change = director().additionsOnly(director().normalizeDynagenAnswer(parseAnswer(reply.text)), job.reducedContext);
            director().validateDynagenChange(change, job.controls, 'answer again with the full JSON');
            requireControlExpanders(change, job.controls);
            rejectNumbers(change);
            return { change, model, usage, ms: Date.now() - started, tries };
        } catch (error) {
            lastError = error;
            console.warn(`Rentan ${model}: answer ${tries} rejected (${String(error.message).slice(0, 160)})`);
            // The model sees what was wrong and answers once more.
            messages.push({ role: 'assistant', content: reply.text || '(empty)' });
            messages.push({ role: 'user', content: `That answer was rejected: ${error.message} Answer again with the full JSON object.` });
        }
    }
    const error = new Error(`Rentan on ${model} failed: ${lastError ? lastError.message : 'no answer'}`);
    error.code = lastError && lastError.code === 'TOKENROUTER_KEY_MISSING' ? 'TOKENROUTER_KEY_MISSING' : 'RENTAN_SERVER_FAILED';
    throw error;
}

module.exports = {
    DEFAULT_MODEL,
    DEFAULT_EFFORT,
    resolveScene,
    systemPrompt,
    jobMessage,
    _test: { parseAnswer, requireControlExpanders, rejectNumbers, controlLines }
};
