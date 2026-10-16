#!/usr/bin/env node
/**
 * App options chunks (Yozora #517): get_app_options { lean: true } leaves out the wildcards,
 * their expander token counts and the workspace's files; get_app_options_chunk returns them.
 * The client merges chunks into window.optionsData in place (never replaces it), loads each once,
 * refreshes after changes, and keeps loaded chunks across a loadOptions() retry.
 * modules/ws/handlers/160-quipsHandler.js, public/scripts/comp/appBootstrap.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

// ---- server: lean payload and chunks ----
async function serverChecks() {
    const handlerPath = path.join(root, 'modules/ws/handlers/160-quipsHandler.js');
    const registry = require(path.join(root, 'modules/ws/wsPacketRegistry'));
    const registered = {};
    const original = registry.registerWsPacket;
    registry.registerWsPacket = (type, fn) => { registered[type] = fn; };
    try {
        require(handlerPath).registerPackets({});
    } finally {
        registry.registerWsPacket = original;
    }
    assert.ok(registered.get_app_options && registered.get_app_options_chunk, 'both packets registered');

    const promptConfig = {
        presets: { Alpha: { model: 'V4_5', steps: 28 } },
        text_replacements: { Forest: 'forest, trees', EATING_FOOD: ['ramen', 'curry'] },
        datasets: [], quality_presets: {}, uc_presets: {}, nsfw_presets: {}, text_tags: {}
    };
    const sent = [];
    const service = (o) => o;
    const gr = {
        getPromptConfig: () => promptConfig,
        refreshBalance: async () => {},
        getNekoAiService: () => ({ A: 1 }),
        getPngMetadata: () => ({ getModelDisplayName: (k) => k }),
        getImageCounter: () => ({ getCount: () => 3 }),
        getAccountData: () => ({ ok: true }),
        getAccountBalance: () => ({}),
        getAccountClientFields: () => ({}),
        getNovelAiStatusMonitor: () => null,
        getWorkspaceManager: () => ({
            getActiveWorkspace: () => 'ws1',
            getActiveWorkspaceData: () => ({ name: 'Home', vibeImages: ['a.png'], cacheFiles: ['b.png'], sidebar: { x: 1 } })
        }),
        getOpusUsage: () => null,
        getQueue: () => ({ getStatus: () => ({}) }),
        getPresetTokenCounts: () => ({ expanders: { Forest: 3 }, uc: { v4: [] } }),
        getModelFeaturesMap: () => ({}),
        getGrokService: () => ({ getDefaultGrokModel: () => null }),
        bootCycleId: 'b1'
    };
    void service;
    const handlers = {
        globalResources: gr,
        sendToClient: (_ws, msg) => sent.push(msg),
        sendError: (_ws, a, b) => sent.push({ error: a, detail: b })
    };
    const call = (type, message) => registered[type]({ handlers, ws: {}, message: { requestId: 'r', ...message }, clientInfo: { sessionId: 's' }, wsServer: {} });

    await call('get_app_options', {});
    const full = sent.pop().data;
    assert.ok(full.textReplacements && full.textReplacements.Forest, 'full payload keeps the wildcards');
    assert.ok(full.preset_token_counts.expanders, 'full payload keeps expander counts');
    assert.ok(full.activeWorkspace.data.vibeImages, 'full payload keeps the workspace files');
    assert.strictEqual(full.lazyChunks, undefined);

    await call('get_app_options', { lean: true });
    const lean = sent.pop().data;
    assert.strictEqual(lean.textReplacements, undefined, 'lean: no wildcards');
    assert.strictEqual(lean.preset_token_counts.expanders, undefined, 'lean: no expander counts');
    assert.deepStrictEqual(lean.preset_token_counts.uc, { v4: [] }, 'lean: other counts stay');
    assert.deepStrictEqual(lean.activeWorkspace, { id: 'ws1', data: { name: 'Home' } }, 'lean: workspace id + name');
    assert.deepStrictEqual(lean.lazyChunks, ['text_replacements', 'presets']);
    assert.strictEqual(lean.presets[0].name, 'Alpha', 'lean: presets stay');

    await call('get_app_options_chunk', { chunk: 'text_replacements' });
    const tr = sent.pop();
    assert.strictEqual(tr.type, 'get_app_options_chunk_response');
    assert.deepStrictEqual(tr.data.textReplacements, promptConfig.text_replacements);
    assert.deepStrictEqual(tr.data.expanders, { Forest: 3 });

    await call('get_app_options_chunk', { chunk: 'presets' });
    assert.strictEqual(sent.pop().data.presets[0].name, 'Alpha');

    await call('get_app_options_chunk', { chunk: 'nope' });
    assert.ok(sent.pop().error, 'unknown chunk is an error');
}

// ---- client: loader in appBootstrap.js ----
async function clientChecks() {
    // objects built inside the vm context have another realm's prototypes
    const same = (actual, expected, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected, msg);
    const src = fs.readFileSync(path.join(root, 'public/scripts/comp/appBootstrap.js'), 'utf8');
    const start = src.indexOf('const appOptionsChunkLoads');
    const end = src.indexOf('// Load options from server with retry logic');
    assert.ok(start > 0 && end > start, 'chunk loader block found');
    const events = [];
    const listeners = {};
    const calls = [];
    let reply = null;
    const ctx = {
        console,
        Map,
        Promise,
        Object,
        Array,
        Number,
        setTimeout,
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
        document: {
            dispatchEvent: (e) => events.push(e),
            addEventListener: (t, fn) => { listeners[t] = fn; }
        },
        window: {}
    };
    ctx.window.wsClient = {
        isConnected: () => true,
        sendMessage: async (type, data) => { calls.push([type, data.chunk]); return reply(data.chunk); }
    };
    vm.createContext(ctx);
    vm.runInContext(src.slice(start, end) + '\nthis.api = { ensureAppOptionsChunk, refreshAppOptionsChunk, carryAppOptionsChunks };', ctx);
    const { api } = ctx;

    const options = { lazyChunks: ['text_replacements', 'presets'], presets: [{ name: 'A' }], preset_token_counts: { uc: {} } };
    ctx.window.optionsData = options;
    reply = (chunk) => ({ ok: true, chunk, textReplacements: { Forest: 'forest' }, expanders: { Forest: 2 } });

    assert.strictEqual(await api.ensureAppOptionsChunk('text_replacements'), true);
    assert.strictEqual(ctx.window.optionsData, options, 'merged in place, same object');
    same(options.textReplacements, { Forest: 'forest' });
    same(options.preset_token_counts, { uc: {}, expanders: { Forest: 2 } });
    assert.strictEqual(options._cacheVersion, 1, 'cache version bumped');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].detail.chunk, 'text_replacements');

    await api.ensureAppOptionsChunk('text_replacements');
    assert.strictEqual(calls.length, 1, 'loaded once');

    reply = () => ({ ok: true, chunk: 'presets', presets: [{ name: 'A' }, { name: 'B' }] });
    await api.refreshAppOptionsChunk('presets');
    same(options.presets.map((p) => p.name), ['A', 'B'], 'presets chunk refreshed');
    assert.strictEqual(ctx.window.optionsData, options, 'still the same object');

    // a failed load is retried by the next caller
    const fresh = { lazyChunks: ['text_replacements'] };
    ctx.window.optionsData = fresh;
    reply = () => { throw new Error('timeout'); };
    // reset the loader's cache for this object
    vm.runInContext('appOptionsChunkLoads.clear()', ctx);
    assert.strictEqual(await api.ensureAppOptionsChunk('text_replacements'), false);
    reply = () => ({ ok: true, textReplacements: { X: 'x' }, expanders: {} });
    assert.strictEqual(await api.ensureAppOptionsChunk('text_replacements'), true, 'retried after a failure');

    // non-lean (full) payload: nothing to fetch
    const callsBefore = calls.length;
    ctx.window.optionsData = { textReplacements: { A: 'a' }, preset_token_counts: { expanders: {} } };
    vm.runInContext('appOptionsChunkLoads.clear()', ctx);
    assert.strictEqual(await api.ensureAppOptionsChunk('text_replacements'), true);
    assert.strictEqual(calls.length, callsBefore, 'full payload: no request');

    // a loadOptions() retry keeps loaded chunks
    const prev = { textReplacements: { A: 'a' }, preset_token_counts: { expanders: { A: 1 } } };
    const next = { lazyChunks: ['text_replacements'], preset_token_counts: { uc: {} } };
    api.carryAppOptionsChunks(prev, next);
    same(next.textReplacements, { A: 'a' });
    same(next.preset_token_counts, { uc: {}, expanders: { A: 1 } });

    assert.ok(typeof listeners.desktopBootDone === 'function', 'idle prefetch after the desktop');

    // callers no longer reload the whole options object after preset changes
    for (const file of ['presetManager.js', 'generationOrchestrator.js', 'studioSession.js']) {
        const text = fs.readFileSync(path.join(root, 'public/scripts/comp', file), 'utf8');
        assert.ok(!/await loadOptions\(\)/.test(text), `${file} must refresh the presets chunk, not loadOptions()`);
    }
    const ws = fs.readFileSync(path.join(root, 'public/scripts/websocket.js'), 'utf8');
    assert.ok(/sendMessage\('get_app_options', \{ lean: true \}\)/.test(ws), 'web client asks for the lean payload');
}

(async () => {
    await serverChecks();
    await clientChecks();
    console.log('test-app-options-chunks: ok');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
