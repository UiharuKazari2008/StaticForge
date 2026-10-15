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

console.log('test-director-live-paint: ok');
