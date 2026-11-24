// #1150: a dead run record and a stale chat.inflight are cleaned at start.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xi-stale-'));
process.env.HOME = home;
const xi = require('../modules/xiDirector');
const t = xi._test;
const L = t.layout();
fs.mkdirSync(L.runs, { recursive: true });
fs.mkdirSync(L.chats, { recursive: true });
fs.writeFileSync(path.join(L.runs, 'a.json'), JSON.stringify({ sessionId: 'a', pid: 999999999, log: path.join(home, 'a.log'), draftId: 'd1' }));
fs.writeFileSync(path.join(L.runs, 'junk.json'), '{nope');
const index = t.readIndex();
index.chats.push({ id: 'a', messages: [], inflight: { draftId: 'd1' } }, { id: 'b', messages: [], inflight: { draftId: 'd2' } });
t.writeIndex(index);
(async () => {
    xi._test.reattachAll();
    await t.sweepAbortedRuns();
    await new Promise((r) => setTimeout(r, 300));
    assert.deepStrictEqual(fs.readdirSync(L.runs), [], 'run records gone');
    assert.strictEqual(xi.listActiveRuns().length, 0);
    const chats = t.readIndex().chats;
    ['a', 'b'].forEach((id) => {
        const c = chats.find((x) => x.id === id);
        assert(!c.inflight, `${id} inflight cleared`);
    });
    assert(chats.find((x) => x.id === 'b').messages[0].aborted, 'draft marked aborted');
    console.log('ok');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
