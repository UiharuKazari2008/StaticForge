#!/usr/bin/env node
'use strict';

// Rentan server-side resolver (#422): prompt, retry, and engine routing. No network:
// tokenRouterBridge.chatCompletion is stubbed.
//   node scripts/test-rentan-resolver.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rentan-resolver-'));
process.env.HOME = scratch;
delete process.env.TOKENROUTER_API_KEY;

const tokenRouter = require('../modules/tokenRouterBridge');
const resolver = require('../modules/rentanResolver');
const director = require('../modules/cursorDirector');

const controls = { tod: true, weather: true, season: true, observeHoliday: false, guidance: true, clothing: false, action: true, creative: 'medium', optimize: false, lockSubject: false, disable_holiday: false };
const job = {
    workspaceId: 'ws1',
    reason: 'context refresh',
    controls,
    context: { when: 'Monday October 12 2026, 07:10', period: { name: 'sunrise' } },
    prompt: '1girl, standing on a bridge, !dg_time',
    uc: 'lowres',
    characters: [{ index: 0, prompt: 'girl, red scarf' }],
    expanders: [{ prefix: 'dg_time', value: 'noon' }]
};
const good = {
    expanders: [
        { prefix: 'dg_time', value: 'sunrise, low warm sun, long shadows', reason: 'sunrise period' },
        { prefix: 'dg_weather', value: 'clear sky, light breeze', reason: 'clear' },
        { prefix: 'dg_season', value: 'autumn leaves', reason: 'October' },
        { prefix: 'dg_action', value: 'shading eyes', reason: 'low sun in her face' }
    ],
    applied: { tod: 'sunrise light', weather: 'clear', season: 'autumn', guidance: 'period tags', action: 'shading eyes', creative: 'low angle' },
    summary: 'Sunrise on the bridge'
};

(async () => {
    try {
        // ---- prompt ----
        const system = resolver.systemPrompt();
        assert.ok(system.includes('dg_ expanders'), 'carries the scene rules');
        ['deliver_rentan', 'advanced_tools', 'count_prompt_tokens', 'search_autofill', 'chat id'].forEach((tool) => {
            assert.ok(!system.includes(tool), `no agent tool text: ${tool}`);
        });
        assert.strictEqual(system, resolver.systemPrompt(), 'identical every call (prefix cache)');
        const message = resolver.jobMessage(job);
        assert.ok(message.startsWith('Why: context refresh'));
        assert.ok(message.includes('Controls on: tod, weather, season, guidance, action, creative: "medium"'));
        assert.ok(message.includes('Controls off: observeHoliday, clothing, optimize, lockSubject'));
        assert.ok(message.length < 700, 'the job carries ids, not control paragraphs');
        assert.ok(message.endsWith('Your answer must include: expanders dg_time, dg_weather, dg_season, dg_action; applied keys tod, weather, season, guidance, action, creative.'));
        const order = ['OUTPUT', 'HARD RULES', 'EXPANDERS', 'EDITING THE PROMPT', 'CONTROLS', 'BEFORE YOU ANSWER'].map((h) => system.indexOf(h));
        assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), 'sections in order');
        assert.ok(system.indexOf('1. No numbers') < system.indexOf('2. dg_ values'), 'numbers rule first');

        // ---- resolve: first answer rejected, the retry passes ----
        const calls = [];
        tokenRouter.chatCompletion = async (request, options) => {
            calls.push({ request: JSON.parse(JSON.stringify(request)), options });
            const answer = calls.length === 1 ? { ...good, applied: { 'time of day': 'x' } } : good;
            return { text: JSON.stringify(answer), usage: { prompt_tokens: 1500, completion_tokens: 900, prompt_tokens_details: { cached_tokens: 1200 } }, finish: 'stop' };
        };
        const thoughts = [];
        const result = await resolver.resolveScene(null, { ...job, onThought: (t, id) => thoughts.push([t, id]) }, { engine: 'tokenrouter', model: 'deepseek/deepseek-v4.1-flash', effort: 'low' });
        assert.strictEqual(result.tries, 2);
        assert.strictEqual(result.change.expanders.length, 4);
        assert.strictEqual(result.usage.cached_tokens, 2400);
        assert.strictEqual(calls[0].options.lane, 'normal', 'Rentan rides the normal gate lane');
        assert.strictEqual(calls[0].options.json, true);
        assert.strictEqual(calls[0].options.effort, 'low', 'an explicit pick wins over the default');
        assert.strictEqual(calls[1].request.messages.length, 4, 'retry carries the rejected answer and the reason');
        assert.ok(/applied is missing a line for: tod/.test(calls[1].request.messages[3].content));
        assert.ok(thoughts[0][0].includes('deepseek-v4.1-flash'));

        // ---- the server resolve also needs one expander per scene control that is on ----
        assert.throws(() => resolver._test.requireControlExpanders({ expanders: [{ prefix: 'dg_weather', value: 'x' }] }, { tod: true, weather: true }), /Missing dg_time/);
        resolver._test.requireControlExpanders({ expanders: [{ prefix: 'dg_weather', value: 'x' }] }, { tod: false, weather: true });
        assert.ok(resolver.systemPrompt().includes('No fog or mist under a clear midday sky'));
        // ---- hard rule 1 backstop: digits outside emphasis weights are rejected ----
        assert.throws(() => resolver._test.rejectNumbers({ expanders: [{ prefix: 'dg_time', value: 'midday, 13:44' }] }), /"13:44" in dg_time/);
        assert.throws(() => resolver._test.rejectNumbers({ expanders: [{ prefix: 'dg_weather', value: 'clear, 18°C air' }] }), /18°C air/);
        resolver._test.rejectNumbers({ expanders: [{ prefix: 'dg_time', value: '1.3::low warm sun::, long shadows' }] });
        assert.deepStrictEqual(resolver._test.controlLines({ tod: true, disable_holiday: true }), ['Controls on: tod', 'Controls off: weather, season, observeHoliday, guidance, clothing, action, creative, optimize, lockSubject', 'Holidays are disabled: no dg_holiday.']);
        assert.strictEqual(resolver.DEFAULT_EFFORT, 'none', 'thinking off by default');

        // ---- Reduced Prompt Context (#432): context only, additions only ----
        assert.ok(resolver.systemPrompt().includes('REDUCED CONTEXT'));
        const reducedJob = { ...job, reducedContext: 'indoor', prompt: '', uc: '', characters: [], expanders: [] };
        const reducedMessage = resolver.jobMessage(reducedJob);
        assert.ok(reducedMessage.includes('Setting: indoor'));
        assert.ok(!reducedMessage.includes('Prompt:') && !reducedMessage.includes('Characters:') && !reducedMessage.includes('Current dg_ expanders'), 'no prompt in reduced mode');
        tokenRouter.chatCompletion = async () => ({ text: JSON.stringify({ ...good, prompt: 'rewritten prompt', uc: 'new uc', characters: [{ index: 0, prompt: 'changed' }] }), usage: null });
        const reduced = await resolver.resolveScene(null, reducedJob, {});
        assert.strictEqual(reduced.change.prompt, undefined, 'prompt edits dropped');
        assert.strictEqual(reduced.change.uc, undefined);
        assert.deepStrictEqual(reduced.change.characters, []);
        assert.strictEqual(reduced.change.expanders.length, 4, 'the additions land');
        const wren = require('../modules/dynagenWren')._test;
        assert.strictEqual(wren.rentanControls({ reduced_context: 'outdoor' }).reduced_context, 'outdoor');
        assert.strictEqual(wren.rentanControls({ reduced_context: 'attic' }).reduced_context, false);
        assert.ok(/reduced_context "indoor"/.test(wren.changedControls(wren.rentanControls({}), wren.rentanControls({ reduced_context: 'indoor' }))), 'a switch resolves again');
        const view = wren.rentanPromptView({ prompt: '1girl, rain', uc: 'x', allCharacterPrompts: [{ prompt: 'girl' }] }, null, { reduced_context: 'outdoor' });
        assert.deepStrictEqual(view, { reducedContext: 'outdoor', prompt: '', uc: '', characters: [] });
        assert.strictEqual(wren.rentanPromptView({ prompt: '1girl' }, null, {}).prompt, '1girl');
        const agentPrompt = director._test.dynagenTurnPrompt(true, { ...reducedJob, chatId: 'dirc_x' });
        assert.ok(agentPrompt.includes('Setting: indoor (reduced context)') && !agentPrompt.includes('Prompt:'), 'the agent turn gets the same reduced job');
        assert.deepStrictEqual(director.additionsOnly({ expanders: [1], prompt: 'p', uc: 'u', characters: [2] }, 'outdoor'), { expanders: [1], characters: [] });

        // ---- both answers rejected: a clean failure the caller can fall back on ----
        tokenRouter.chatCompletion = async () => ({ text: '{"summary":"no expanders"}', usage: null });
        await assert.rejects(resolver.resolveScene(null, job, {}), (error) => error.code === 'RENTAN_SERVER_FAILED' && /no dg_ expanders/.test(error.message));
        tokenRouter.chatCompletion = async () => { const e = new Error('No TokenRouter API key'); e.code = 'TOKENROUTER_KEY_MISSING'; throw e; };
        await assert.rejects(resolver.resolveScene(null, job, {}), (error) => error.code === 'TOKENROUTER_KEY_MISSING');

        // ---- routing ----
        const route = director.rentanRoute;
        assert.deepStrictEqual(route(null, {}).agent.engine, 'cursor', 'no key, no default: Cursor as before');
        assert.strictEqual(route(null, { agent: { engine: 'tokenrouter', model: 'x/y' } }).server, false, 'TokenRouter pick without a key falls back');
        assert.strictEqual(route(null, { agent: { engine: 'tokenrouter', model: 'x/y' } }).agent.engine, 'cursor');
        process.env.TOKENROUTER_API_KEY = 'sk-test';
        const builtIn = route(null, {});
        assert.deepStrictEqual({ engine: builtIn.agent.engine, model: builtIn.agent.model, server: builtIn.server },
            { engine: 'tokenrouter', model: 'deepseek/deepseek-v4.1-flash', server: true }, 'built-in default: DeepSeek on the server');
        assert.strictEqual(route(null, { agent: { engine: 'claude', model: 'claude-opus-5-5' } }).server, false, 'Claude stays an agent turn');
        assert.strictEqual(route(null, { agent: { engine: 'cursor' } }).agent.engine, 'cursor', 'Cursor stays an agent turn (cost saving)');
        director._test.saveRentanAgentDefault({ engine: 'cursor', effort: 'low' });
        assert.strictEqual(route(null, {}).agent.engine, 'cursor', 'a saved default beats the built-in one');
        fs.unlinkSync(director._test.rentanAgentPath());

        // ---- runDynagenTurn on the server route: no Director chat, model recorded ----
        tokenRouter.chatCompletion = async () => ({ text: JSON.stringify(good), usage: { prompt_tokens: 10, completion_tokens: 5 } });
        const turned = await director.runDynagenTurn(null, { ...job });
        assert.strictEqual(turned.sessionId, null);
        assert.deepStrictEqual(turned.resolvedBy, { engine: 'tokenrouter', model: 'deepseek/deepseek-v4.1-flash' });
        assert.strictEqual(turned.change.summary, 'Sunrise on the bridge');

        console.log('rentan resolver: ok');
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
    process.exit(0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
