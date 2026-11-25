// #1150: a turn whose CLI wrote its terminal `result` ends on the server even when the process
// lingers; a run with no result yet is left alone.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xi-turn-end-'));
process.env.HOME = home;
process.env.XI_TURN_END_GRACE_MS = '600';
const xi = require('../modules/xiDirector');
const busy = require('../modules/busyStatus');
const t = xi._test;
const L = t.layout();
fs.mkdirSync(L.runs, { recursive: true });
fs.mkdirSync(L.chats, { recursive: true });
fs.mkdirSync(path.join(home, 'images'), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const packets = [];
const fakeGr = {
    initialized: true,
    getPath: () => path.join(home, 'images'),
    getConfig: () => ({ xi: { enabled: true } }),
    getWebSocketServer: () => ({ broadcast: (p) => packets.push(p) })
};
t.setBoundGr(fakeGr);

function fakeAgent(log, writeResult) {
    // appends one assistant line, optionally the terminal result line, then sleeps for good
    const lines = [{ type: 'assistant', message: { content: [{ type: 'text', text: 'All done.' }] } }];
    if (writeResult) lines.push({ type: 'result', subtype: 'success', is_error: false, result: 'All done.', duration_ms: 12, num_turns: 1 });
    const code = `const fs=require('fs');const log=${JSON.stringify(log)};`
        + `${JSON.stringify(lines)}.forEach((l)=>fs.appendFileSync(log,JSON.stringify(l)+'\\n'));setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ['-e', code], { detached: true, stdio: 'ignore' });
    child.unref();
    return child.pid;
}

function seedChat(id, draftId) {
    const index = t.readIndex();
    index.chats.push({ id, name: 'Turn end', runtime: 'claude', messages: [{ id: draftId, role: 'assistant', content: '', data: { Description: '' } }], inflight: { draftId } });
    t.writeIndex(index);
}

function startRun(id, withResult) {
    const draftId = `d-${id}`;
    const log = path.join(home, `${id}.log`);
    fs.writeFileSync(log, '');
    seedChat(id, draftId);
    const pid = fakeAgent(log, withResult);
    const metaPath = path.join(L.runs, `${id}.json`);
    const meta = { pid, sessionId: id, log, draftId, name: 'Turn end', runtime: 'claude', requestId: `req-${id}`, metaPath };
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    t.startTail(meta);
    return { pid, metaPath, draftId };
}

async function waitFor(fn, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (fn()) return true;
        await sleep(50);
    }
    return fn();
}

function dump(label, id, metaPath) {
    const chat = t.readIndex().chats.find((c) => c.id === id);
    const wire = packets
        .filter((p) => ['director_message_response', 'director_send_message_response', 'director_computer_status', 'director_message_error'].includes(p.type))
        .map((p) => p.type === 'director_computer_status'
            ? { type: p.type, 'data.running': p.data.running, 'data.xi': p.data.xi }
            : { type: p.type, data: p.data, requestId: p.requestId });
    console.log(`--- ${label}`);
    console.log(`server  runs/*.json count : ${fs.readdirSync(L.runs).filter((n) => n.endsWith('.json')).length} (${fs.existsSync(metaPath) ? 'record present' : 'record removed'})`);
    console.log(`server  chat.inflight     : ${JSON.stringify(chat.inflight || null)}`);
    console.log(`server  listXiRuns()      : ${JSON.stringify(xi.listActiveRuns())}`);
    console.log(`server  busyStatus xi     : ${JSON.stringify(busy.collect({ generation: { processing: false } }).reasons.filter((r) => r.startsWith('xi:')))}`);
    console.log(`server  runtimeStatus()   : ${JSON.stringify(xi.runtimeStatus())}`);
    console.log(`page    packets told      : ${JSON.stringify(wire, null, 1)}`);
}

(async () => {
    const settled = [];
    xi.onRunSettled((s) => settled.push(s));

    // (a) result written, process lingers
    const a = startRun('chat-a', true);
    assert(t.pidAlive(a.pid), 'fake agent started');
    assert(xi.listActiveRuns().length === 1, 'run is active at the start');
    const ended = await waitFor(() => !fs.existsSync(a.metaPath), 3000);
    assert(ended, 'run record removed within 3 s');
    await waitFor(() => { const c = t.readIndex().chats.find((x) => x.id === 'chat-a'); return !c.inflight && packets.some((p) => p.type === 'director_message_response'); }, 2000);
    await sleep(700); // broadcastDirectorStatus is async
    assert.strictEqual(xi.listActiveRuns().length, 0, 'listActiveRuns empty');
    assert.strictEqual(xi.runtimeStatus().running, false, 'runtimeStatus not running');
    assert(!t.readIndex().chats.find((c) => c.id === 'chat-a').inflight, 'inflight cleared');
    assert.strictEqual(settled.length, 1);
    assert.strictEqual(settled[0].failed, false, 'settled as success, not failure/timeout');
    assert.strictEqual(settled[0].error, null);
    assert(await waitFor(() => !t.pidAlive(a.pid), 2000), 'leftover pid is dead');
    const response = packets.find((p) => p.type === 'director_message_response');
    assert(response && response.data.success && response.data.response.Description === 'All done.', 'reply text kept from the log');
    assert(!packets.some((p) => p.type === 'director_message_error'), 'no error packet');
    const status = packets.filter((p) => p.type === 'director_computer_status').pop();
    assert(status && status.data.xi.running === false, 'status says xi.running false');
    const saved = t.readIndex().chats.find((c) => c.id === 'chat-a').messages.find((m) => m.id === a.draftId);
    assert.strictEqual(saved.data.Description, 'All done.', 'draft saved with the reply');
    dump('(c) server state vs page state at the turn end (chat-a)', 'chat-a', a.metaPath);

    // (b) alive, no result: stays active well past the grace
    const b = startRun('chat-b', false);
    await sleep(2200);
    assert(fs.existsSync(b.metaPath), 'record still there');
    assert.strictEqual(xi.listActiveRuns().length, 1, 'still active');
    assert.strictEqual(xi.runtimeStatus().running, true);
    assert(t.pidAlive(b.pid), 'agent untouched');
    assert(t.readIndex().chats.find((c) => c.id === 'chat-b').inflight, 'inflight kept');
    process.kill(-b.pid, 'SIGKILL');
    await waitFor(() => xi.listActiveRuns().length === 0, 2000);

    // busyStatus: a settled row is not busy
    const rows = busy.collect({ xi: [{ sessionId: 'x', settled: true }, { sessionId: 'y', settled: false }], generation: { processing: false } });
    assert.deepStrictEqual(rows.reasons.filter((r) => r.startsWith('xi:')), ['xi:y']);
    console.log('ok');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
