// start_director_session (#1068): create / dedupe by source / reuse by thread and sessionId,
// busy fallback, review brief, attachments. Runs on a throwaway HOME; the send is faked
// (no CLI is spawned).
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dirstart-'));
process.env.HOME = home;

// apiKeyHealth's cached key health, kept away from the repo's own cache (#1145). The file is
// written before the module is first used: it reads it once and keeps what it found.
const healthFile = path.join(home, 'api-key-health.json');
process.env.API_KEY_HEALTH_CACHE = healthFile;
const fpOf = (service, slot, secret) => require('crypto').createHash('sha256')
    .update(`${service}\n${slot}\n${secret}`).digest('hex').slice(0, 24);
fs.writeFileSync(healthFile, JSON.stringify({
    version: 1,
    entries: {
        [fpOf('tokenrouter', 'apiKey', 'tr-key')]: { state: 'fail', message: 'refused', checkedAt: Date.now() }
    }
}));
// A key manager holding one service and one key, for the engine health read.
const keyGr = (service, apiKey) => ({
    getApiKeyManager: () => ({
        SERVICE_METADATA: { [service]: {} },
        getServiceKeys: () => [{ apiKey }],
        credentialSecret: () => apiKey
    })
});

const xi = require('../modules/xiDirector');
const ds = require('../modules/directorStart');

const gr = {
    getConfig: () => ({ xi: { enabled: true } }),
    getSecureConfig: () => ({}),
    getWebSocketServer: () => null
};

const sent = [];
const busy = new Set();
xi.handleDirectorSendMessage = async (handler, ws, message) => {
    if (busy.has(message.sessionId)) {
        handler.sendError(ws, 'Yozora is still working on the last request', 'DIRECTOR_BUSY');
        return;
    }
    sent.push(message);
};
xi.runOutput = () => ({ otherRows: 1, text: '' }); // the fake engine always takes the turn
const realBriefs = xi.listChatBriefs;
xi.listChatBriefs = () => realBriefs().map((c) => Object.assign(c, { running: busy.has(c.id) }));

async function main() {
    const t = ds._test;
    assert.strictEqual(t.resolvePersona('Yozora'), 'xi');
    assert.strictEqual(t.resolvePersona('chiyo'), 'kabuki');
    assert.throws(() => t.resolvePersona('Bob'), /Unknown persona/);
    const att = t.normalizeAttachments([{ name: 'tran/script.md', text: 'hallo' }, { vfsFileId: 'abcdefgh12' }]);
    assert.strictEqual(att[0].source, 'client');
    assert.strictEqual(Buffer.from(att[0].data, 'base64').toString(), 'hallo');
    assert.ok(!att[0].name.includes('/'));
    assert.deepStrictEqual(att[1], { source: 'vfs', fileId: 'abcdefgh12' });
    assert.throws(() => t.normalizeAttachments([{ name: 'x' }]), /text or vfsFileId/);
    assert.ok(t.reviewBrief('X', 'plaud:1').includes('plaud:1'));
    assert.ok(/to Yukimi[^.]*in English/.test(t.reviewBrief('X')), 'chat with Yukimi is in English');

    // default engine (#1145): DeepInfra, and an engine a cached check refused is not inherited
    assert.strictEqual(t.XI_DEFAULT_ENGINE, 'custom:deepinfra');
    assert.strictEqual(t.xiStartChoice([], {}, undefined, gr).runtime, 'custom:deepinfra', 'a new chat defaults to DeepInfra');
    const lastChat = [{ runtime: 'tokenrouter', updated_at: '2026-11-24T00:00:00Z' }];
    assert.strictEqual(t.xiStartChoice(lastChat, {}, undefined, gr).runtime, 'tokenrouter',
        'an engine nothing is known about is still inherited');
    assert.strictEqual(t.engineRefused(gr, 'tokenrouter'), false, 'no key manager: nothing known counts as usable');
    const refusedGr = keyGr('tokenrouter', 'tr-key');
    assert.strictEqual(t.engineRefused(refusedGr, 'tokenrouter'), true, 'the cached refusal is read');
    assert.strictEqual(t.xiStartChoice(lastChat, {}, undefined, refusedGr).runtime, 'custom:deepinfra',
        'a refused engine is not inherited: no wasted refused start');
    assert.strictEqual(t.xiStartChoice(lastChat, { engine: 'tokenrouter' }, undefined, refusedGr).runtime, 'tokenrouter',
        'an engine asked for by name is kept');

    await assert.rejects(ds.startDirectorSession(gr, { persona: 'Yozora' }), /prompt is required/);

    // new chat, review brief, title kept, tagged
    const a = await ds.startDirectorSession(gr, {
        persona: 'Yozora', task: 'review', source: 'plaud:rec1', thread: 'plaud-reviews',
        title: 'Review: Test', prompt: 'Action items: A, B', attachments: [{ name: 't.md', text: 'transcript' }]
    });
    assert.strictEqual(a.created, true);
    assert.strictEqual(a.persona, 'xi');
    assert.strictEqual(a.engine, 'custom:deepinfra');
    assert.strictEqual(sent.length, 1);
    assert.ok(sent[0].content.startsWith('Task: turn the review'));
    assert.ok(sent[0].content.endsWith('Action items: A, B'));
    assert.strictEqual(sent[0].attachments.length, 1);
    let brief = xi.listChatBriefs().find((c) => c.id === a.sessionId);
    assert.deepStrictEqual(brief.sources, ['plaud:rec1']);
    assert.strictEqual(brief.thread, 'plaud-reviews');
    assert.strictEqual(brief.name, 'Review: Test');
    assert.strictEqual(brief.startedVia, ds.STARTED_VIA);

    // same source: deduped, nothing sent
    const again = await ds.startDirectorSession(gr, { persona: 'Yozora', source: 'plaud:rec1', prompt: 'again' });
    assert.strictEqual(again.deduped, true);
    assert.strictEqual(again.sessionId, a.sessionId);
    assert.strictEqual(sent.length, 1);

    // concurrent same source: one chat, one send
    const [c1, c2] = await Promise.all([
        ds.startDirectorSession(gr, { persona: 'Yozora', source: 'plaud:rec2', prompt: 'p' }),
        ds.startDirectorSession(gr, { persona: 'Yozora', source: 'plaud:rec2', prompt: 'p' })
    ]);
    assert.strictEqual(c1.sessionId, c2.sessionId);
    assert.strictEqual([c1, c2].filter((r) => r.deduped).length, 1);
    assert.strictEqual(sent.length, 2);

    // thread reuse: new source goes into the thread's chat
    const b = await ds.startDirectorSession(gr, { persona: 'Yozora', source: 'plaud:rec3', thread: 'plaud-reviews', prompt: 'more' });
    assert.strictEqual(b.created, false);
    assert.strictEqual(b.reusedBy, 'thread');
    assert.strictEqual(b.sessionId, a.sessionId);
    brief = xi.listChatBriefs().find((c) => c.id === a.sessionId);
    assert.deepStrictEqual(brief.sources, ['plaud:rec1', 'plaud:rec3']);

    // thread chat busy: a new chat in the same thread
    busy.add(a.sessionId);
    const d = await ds.startDirectorSession(gr, { persona: 'Yozora', source: 'plaud:rec4', thread: 'plaud-reviews', prompt: 'busy' });
    assert.strictEqual(d.created, true);
    assert.notStrictEqual(d.sessionId, a.sessionId);
    assert.strictEqual(xi.listChatBriefs().find((c) => c.id === d.sessionId).thread, 'plaud-reviews');

    // explicit sessionId busy: refused
    await assert.rejects(ds.startDirectorSession(gr, { persona: 'Yozora', sessionId: a.sessionId, prompt: 'x' }), (e) => e.code === 'DIRECTOR_BUSY');
    busy.delete(a.sessionId);
    const e = await ds.startDirectorSession(gr, { persona: 'Yozora', sessionId: a.sessionId, prompt: 'x' });
    assert.strictEqual(e.reusedBy, 'sessionId');
    await assert.rejects(ds.startDirectorSession(gr, { persona: 'Yozora', sessionId: 'xi_nope', prompt: 'x' }), (err) => err.code === 'SESSION_NOT_FOUND');

    // a failed send gives the source back, so the retry runs
    xi.handleDirectorSendMessage = async (handler, ws) => { handler.sendError(ws, 'spawnSync /bin/sh E2BIG', 'E2BIG'); };
    await assert.rejects(ds.startDirectorSession(gr, { persona: 'Yozora', source: 'plaud:rec9', thread: 'plaud-reviews', prompt: 'x' }), (err) => err.code === 'E2BIG');
    assert.ok(!xi.listChatBriefs().some((c) => c.sources.includes('plaud:rec9')));
    xi.handleDirectorSendMessage = async (handler, ws, message) => { sent.push(message); };
    const retry = await ds.startDirectorSession(gr, { persona: 'Yozora', source: 'plaud:rec9', thread: 'plaud-reviews', prompt: 'x' });
    assert.strictEqual(retry.deduped, false);
    assert.strictEqual(retry.reusedBy, 'thread');

    // engine fallback (#1072): TokenRouter refuses at once -> DeepInfra; the failed chat is deleted
    const listeners = new Set();
    xi.onRunSettled = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
    const engineOf = (id) => (xi.listChatBriefs().find((c) => c.id === id) || {}).runtime;
    let refuse = new Set(['tokenrouter']);
    // a refusing engine writes the 403 as assistant text before the turn settles (as the CLI does)
    xi.runOutput = (id) => (refuse.has(engineOf(id))
        ? { otherRows: 0, text: 'Failed to authenticate. API Error: 403 TokenRouter 403: Forbidden.' }
        : { otherRows: 1, text: '' });
    xi.handleDirectorSendMessage = async (handler, ws, message) => {
        sent.push(message);
        if (refuse.has(engineOf(message.sessionId))) {
            setTimeout(() => listeners.forEach((fn) => fn({ sessionId: message.sessionId, failed: true, cancelled: false,
                error: 'Failed to authenticate. API Error: 403 TokenRouter 403: Forbidden.' })), 50);
        }
    };
    const before = xi.listChatBriefs().length;
    const fb = await ds.startDirectorSession(gr, { persona: 'Yozora', engine: 'tokenrouter', source: 'plaud:fb1', prompt: 'fb' });
    assert.strictEqual(fb.engine, 'custom:deepinfra');
    assert.strictEqual(fb.fallbackFrom.length, 1);
    assert.strictEqual(fb.fallbackFrom[0].engine, 'tokenrouter');
    assert.strictEqual(engineOf(fb.sessionId), 'custom:deepinfra');
    assert.strictEqual(xi.listChatBriefs().length, before + 1, 'the refused chat is deleted');
    assert.deepStrictEqual(xi.listChatBriefs().find((c) => c.id === fb.sessionId).sources, ['plaud:fb1']);
    // both refuse -> SloProxy
    refuse = new Set(['tokenrouter', 'custom:deepinfra']);
    const fb2 = await ds.startDirectorSession(gr, { persona: 'Yozora', engine: 'tokenrouter', source: 'plaud:fb2', prompt: 'fb' });
    assert.strictEqual(fb2.engine, 'custom:sloproxy');
    assert.strictEqual(fb2.fallbackFrom.length, 2);
    // all refuse -> the last error, source free
    refuse = new Set(['tokenrouter', 'custom:deepinfra', 'custom:sloproxy']);
    await assert.rejects(ds.startDirectorSession(gr, { persona: 'Yozora', engine: 'tokenrouter', source: 'plaud:fb3', prompt: 'fb' }),
        (err) => err.code === 'ENGINE_REFUSED' && err.fallbackFrom.length === 2);
    assert.ok(!xi.listChatBriefs().some((c) => c.sources.includes('plaud:fb3')));
    // fallback:false and a pinned sessionId do not fall back
    const pinned = await ds.startDirectorSession(gr, { persona: 'Yozora', engine: 'tokenrouter', fallback: false, prompt: 'fb' });
    assert.strictEqual(pinned.engine, 'tokenrouter');
    assert.strictEqual(pinned.fallbackFrom, undefined);
    refuse = new Set();
    xi.runOutput = () => ({ otherRows: 1, text: '' });

    // get_director_session
    const got = ds.getDirectorSession(gr, { sessionId: a.sessionId });
    assert.strictEqual(got.status, 'idle');
    assert.deepStrictEqual(got.sources, ['plaud:rec1', 'plaud:rec3']);
    assert.ok(Array.isArray(got.issues));
    assert.throws(() => ds.getDirectorSession(gr, { sessionId: 'nope' }), /not found/);

    // disabled Yozora
    await assert.rejects(ds.startDirectorSession({ getConfig: () => ({}) }, { persona: 'Yozora', prompt: 'p' }), (err) => err.code === 'XI_DISABLED');

    // tool + scope wiring (loading the facade catches a syntax slip in the tool text, as on Nov 23)
    const facadeTools = require('../modules/mcpAgentFacade')._test;
    assert.ok(facadeTools, 'mcpAgentFacade loads');
    const facadeSrc = fs.readFileSync(path.join(__dirname, '../modules/mcpAgentFacade.js'), 'utf8');
    assert.ok(facadeSrc.includes("name: 'start_director_session'") && facadeSrc.includes("name: 'get_director_session'"));
    const reg = require('../modules/mcpModuleRegistry');
    assert.ok(reg.scopesAllowModuleTool(['sfapp_director_start'], 'start_director_session'));
    assert.ok(!reg.scopesAllowModuleTool(['chat'], 'start_director_session'));
    const auth = require('../modules/applicationAuthManager');
    assert.ok(auth.AVAILABLE_SCOPES.some((s) => s.id === 'sfapp_director_start'));

    console.log('test-director-start: ok');
}

main().then(() => {
    fs.rmSync(home, { recursive: true, force: true });
    process.exit(0);
}, (err) => {
    console.error(err);
    fs.rmSync(home, { recursive: true, force: true });
    process.exit(1);
});
