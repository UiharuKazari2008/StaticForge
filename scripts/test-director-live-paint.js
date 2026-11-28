'use strict';
// #511: director_streaming_update paints the live turn at most every
// DIRECTOR_LIVE_PAINT_MS with the latest payload, waits while the chat is out
// of sight, and drops a pending paint once the turn settles. setDirectorText
// edits the one text node in place instead of swapping it (#510).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/director.js'), 'utf8');
const helpersStart = src.indexOf('const DIRECTOR_LIVE_PAINT_MS');
const helpersEnd = src.indexOf('\n}\n', src.indexOf('function setDirectorText'));
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'live paint constants and setDirectorText');
const start = src.indexOf('class Director {');
const end = src.indexOf('\n}\n', start);
assert.ok(start >= 0 && end > start, 'Director class');

let clock = 1000000;
let timers = [];
let nextId = 1;
function advance(ms) {
    const until = clock + ms;
    for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const due = timers[0];
        if (!due || due.at > until) break;
        timers.shift();
        clock = due.at;
        due.fn();
    }
    clock = until;
}

const ctx = {
    window: { currentSession: { id: 'chat-1' } },
    document: { hidden: false },
    Node: { TEXT_NODE: 3 },
    Date: { now: () => clock },
    setTimeout: (fn, ms) => { const id = nextId++; timers.push({ id, at: clock + Math.max(0, ms || 0), fn }); return id; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
    console
};
vm.createContext(ctx);
vm.runInContext(`${src.slice(helpersStart, helpersEnd + 2)}\n${src.slice(start, end + 2)}\nthis.Director = Director;\nthis.setDirectorText = setDirectorText;\nthis.PAINT_MS = DIRECTOR_LIVE_PAINT_MS;`, ctx);
const PAINT_MS = ctx.PAINT_MS;

function make() {
    const d = Object.create(ctx.Director.prototype);
    const painted = [];
    Object.assign(d, {
        _running: true,
        _runningSessionId: 'chat-1',
        _visible: true,
        directorChatVisible() { return this._visible; },
        renderLiveTrace(payload) { painted.push(payload.seq); },
        updateTypingIndicator(text) { painted.push(`typing:${text}`); }
    });
    return { d, painted };
}
const update = (seq) => ({ sessionId: 'chat-1', seq, rows: [{ type: 'thinking', text: `t${seq}` }], live: null });

// Leading paint right away, then one trailing paint with the newest payload.
{
    timers = [];
    const { d, painted } = make();
    d.queueLivePaint(update(1));
    advance(0);
    assert.deepStrictEqual(painted, [1], 'first update paints at once');
    for (let seq = 2; seq <= 4; seq++) { advance(160); d.queueLivePaint(update(seq)); }
    assert.deepStrictEqual(painted, [1], 'updates inside the window wait');
    advance(PAINT_MS);
    assert.deepStrictEqual(painted, [1, 4], 'one trailing paint with the latest payload');
    advance(PAINT_MS * 4);
    assert.deepStrictEqual(painted, [1, 4], 'nothing left to paint');
}

// Out of sight: no paint until the chat shows again, then the latest one.
{
    timers = [];
    clock += PAINT_MS * 10;
    const { d, painted } = make();
    d._visible = false;
    d.queueLivePaint(update(1));
    d.queueLivePaint(update(2));
    advance(PAINT_MS * 3);
    assert.deepStrictEqual(painted, [], 'hidden chat is not painted');
    d._visible = true;
    advance(1000);
    assert.deepStrictEqual(painted, [2], 'shown chat gets the latest payload');
}

// The turn settles while a paint waits: nothing paints after it.
{
    timers = [];
    clock += PAINT_MS * 10;
    const { d, painted } = make();
    d.queueLivePaint(update(1));
    advance(0);
    d.queueLivePaint(update(2));
    d._running = false;
    d._runningSessionId = null;
    d.dropLivePaint();
    advance(PAINT_MS * 3);
    assert.deepStrictEqual(painted, [1], 'settled turn drops the pending paint');
    assert.strictEqual(timers.length, 0, 'no timer left behind');
}

// Another chat opened while the paint waited: dropped.
{
    timers = [];
    clock += PAINT_MS * 10;
    const { d, painted } = make();
    d.queueLivePaint(update(1));
    advance(0);
    d.queueLivePaint(update(2));
    ctx.window.currentSession = { id: 'chat-2' };
    advance(PAINT_MS);
    assert.deepStrictEqual(painted, [1], 'paint for a chat that is no longer open is dropped');
    ctx.window.currentSession = { id: 'chat-1' };
}

// Text-only updates go to the typing indicator.
{
    timers = [];
    clock += PAINT_MS * 10;
    const { d, painted } = make();
    d.queueLivePaint({ sessionId: 'chat-1', fullContent: 'hello' });
    advance(0);
    assert.deepStrictEqual(painted, ['typing:hello']);
}

// setDirectorText keeps the text node and only edits its data.
{
    const node = { nodeType: 3, data: 'old', nextSibling: null };
    const el = { firstChild: node, textContent: 'old' };
    ctx.setDirectorText(el, 'new');
    assert.strictEqual(el.firstChild, node, 'same text node');
    assert.strictEqual(node.data, 'new');
    ctx.setDirectorText(el, 42);
    assert.strictEqual(node.data, '42');
    const empty = { firstChild: null, textContent: '' };
    ctx.setDirectorText(empty, 'first');
    assert.strictEqual(empty.textContent, 'first', 'falls back to textContent when there is no single text node');
    ctx.setDirectorText(null, 'x');
}

// A streaming update for the open chat can come before the status that arms its turn (the server sends the run's update
// with the chat's messages): it is kept, with no timer, and painted once the status arms the turn. A settled turn, another
// chat, a status that does not run the turn and an update older than Director.LIVE_HOLD_MS drop it.
{
    const HOLD_MS = ctx.Director.LIVE_HOLD_MS;
    assert.ok(HOLD_MS > 0, 'a hold limit exists');
    const unarmed = () => {
        timers = [];
        clock += PAINT_MS * 10;
        ctx.window.currentSession = { id: 'chat-1' };
        const { d, painted } = make();
        Object.assign(d, {
            persona: 'xi',
            currentSession: { id: 'chat-1' },
            _running: false,
            _runningSessionId: null,
            _settledSessionId: null,
            updateTrayChrome() {},
            noteCursorLogin() {},
            noteXiEnabled() { return false; },
            showTypingIndicator() { this.typing = (this.typing || 0) + 1; }
        });
        return { d, painted };
    };
    const runs = (ids) => ({ running: false, xi: { enabled: true, running: ids.length > 0, runningSessions: ids, sessionId: ids.length === 1 ? ids[0] : null } });

    // queued while unarmed: the flush keeps it (no drop, no timer), the arming status paints it once
    {
        const { d, painted } = unarmed();
        d.queueLivePaint(update(1));
        advance(0);
        assert.deepStrictEqual(painted, [], 'nothing paints before the turn is armed');
        assert.ok(d._livePayload, 'the payload is kept');
        assert.strictEqual(timers.length, 0, 'kept without a timer or poll');
        advance(PAINT_MS * 10);
        assert.deepStrictEqual(painted, [], 'still waiting');
        d.applyDirectorStatus(runs(['chat-1']));
        assert.strictEqual(d._running, true, 'the status armed the turn');
        assert.strictEqual(d._runningSessionId, 'chat-1');
        assert.deepStrictEqual(painted, [1], 'the kept update paints when the status arms the turn');
        assert.strictEqual(d._livePayload, null, 'painted once, then released');
        d.applyDirectorStatus(runs(['chat-1']));
        assert.deepStrictEqual(painted, [1], 'a second status paints nothing more');
        assert.strictEqual(timers.length, 0, 'no timer left behind');
    }

    // held by holdLivePaint (the update the stale status refused to arm): newest wins, painted at the arming
    {
        const { d, painted } = unarmed();
        d.holdLivePaint(update(1));
        d.holdLivePaint(update(2));
        assert.deepStrictEqual(painted, [], 'held, not painted');
        assert.strictEqual(timers.length, 0, 'holding sets no timer');
        d.applyDirectorStatus(runs(['chat-1']));
        assert.deepStrictEqual(painted, [2], 'the latest held update paints at the arming');
    }

    // rows changed in a skipped update stay changed in the one that follows (the fold of queueLivePaint)
    {
        const { d } = unarmed();
        d.holdLivePaint({ sessionId: 'chat-1', seq: 1, rowsFrom: 1, rows: [], live: null });
        const next = { sessionId: 'chat-1', seq: 2, rowsFrom: 3, rows: [], live: null };
        d.holdLivePaint(next);
        assert.strictEqual(next.rowsFrom, 1, 'rowsFrom folds to the first changed row');
    }

    // the turn settled: dropped, the later arming paints nothing
    {
        const { d, painted } = unarmed();
        d.queueLivePaint(update(1));
        advance(0);
        d.dropLivePaint();
        d.applyDirectorStatus(runs(['chat-1']));
        assert.deepStrictEqual(painted, [], 'a dropped (settled) update is not painted');
        const second = unarmed();
        second.d._settledSessionId = 'chat-1';
        second.d.queueLivePaint(update(1));
        advance(0);
        assert.strictEqual(second.d._livePayload, null, 'a settled turn drops the update at the flush');
        second.d.holdLivePaint(update(2));
        assert.strictEqual(second.d._livePayload, null, 'a settled turn is not held');
    }

    // another chat opened: dropped
    {
        const { d, painted } = unarmed();
        d.queueLivePaint(update(1));
        advance(0);
        ctx.window.currentSession = { id: 'chat-2' };
        d.currentSession = { id: 'chat-2' };
        d.applyDirectorStatus(runs(['chat-1']));
        assert.strictEqual(d._livePayload, null, 'the held update of the chat that closed is dropped');
        ctx.window.currentSession = { id: 'chat-1' };
        d.currentSession = { id: 'chat-1' };
        d.applyDirectorStatus(runs(['chat-1']));
        assert.deepStrictEqual(painted, [], 'it does not come back when the chat opens again');
    }

    // a status that does not run the turn drops it; a later run does not paint the old update
    {
        const { d, painted } = unarmed();
        d.queueLivePaint(update(1));
        advance(0);
        d.applyDirectorStatus(runs([]));
        assert.strictEqual(d._livePayload, null, 'a status that lists no run drops the held update');
        d.applyDirectorStatus(runs(['chat-1']));
        assert.deepStrictEqual(painted, [], 'the old update is not painted for the next run');
        assert.strictEqual(d._running, true);
    }

    // too old: a turn that started minutes later does not paint the earlier update
    {
        const { d, painted } = unarmed();
        d.queueLivePaint(update(1));
        advance(0);
        advance(HOLD_MS + 1000);
        d.applyDirectorStatus(runs(['chat-1']));
        assert.deepStrictEqual(painted, [], 'an update older than the hold limit is not painted');
        assert.strictEqual(d._livePayload, null);
    }

    // the page's own new turn (armed by a send) does not paint an update kept long before
    {
        const { d, painted } = unarmed();
        d.queueLivePaint(update(1));
        advance(0);
        advance(HOLD_MS + 1000);
        d._running = true;
        d._runningSessionId = 'chat-1';
        d.wakeLivePaint();
        assert.deepStrictEqual(painted, [], 'a stale held update is not painted as the new turn');
        assert.strictEqual(d._livePayload, null);
    }

    // an armed turn is unchanged: queue, wait for sight, paint
    {
        const { d, painted } = unarmed();
        d._running = true;
        d._runningSessionId = 'chat-1';
        d._visible = false;
        d.queueLivePaint(update(1));
        advance(PAINT_MS * 3);
        advance(HOLD_MS * 2);
        d._visible = true;
        advance(2000);
        assert.deepStrictEqual(painted, [1], 'an armed update waits for sight however long, then paints');
    }
    ctx.window.currentSession = { id: 'chat-1' };
}

console.log('test-director-live-paint: ok');
