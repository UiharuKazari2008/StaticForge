// start_director_session (#1068): create / dedupe by source / reuse by thread and sessionId,
// busy fallback, review brief, attachments. Runs on a throwaway HOME; the send is faked
// (no CLI is spawned).
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dirstart-'));
process.env.HOME = home;

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

    await assert.rejects(ds.startDirectorSession(gr, { persona: 'Yozora' }), /prompt is required/);

    // new chat, review brief, title kept, tagged
    const a = await ds.startDirectorSession(gr, {
        persona: 'Yozora', task: 'review', source: 'plaud:rec1', thread: 'plaud-reviews',
        title: 'Review: Test', prompt: 'Action items: A, B', attachments: [{ name: 't.md', text: 'transcript' }]
    });
    assert.strictEqual(a.created, true);
    assert.strictEqual(a.persona, 'xi');
    assert.strictEqual(a.engine, 'tokenrouter');
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

    // get_director_session
    const got = ds.getDirectorSession(gr, { sessionId: a.sessionId });
    assert.strictEqual(got.status, 'idle');
    assert.deepStrictEqual(got.sources, ['plaud:rec1', 'plaud:rec3']);
    assert.ok(Array.isArray(got.issues));
    assert.throws(() => ds.getDirectorSession(gr, { sessionId: 'nope' }), /not found/);

    // disabled Yozora
    await assert.rejects(ds.startDirectorSession({ getConfig: () => ({}) }, { persona: 'Yozora', prompt: 'p' }), (err) => err.code === 'XI_DISABLED');

    // tool + scope wiring
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
