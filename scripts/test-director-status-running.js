'use strict';
// #1150: the typing indicator follows the server's real run state for the open chat. A Yozora (xi) chat is not kept
// "running" by the cursor Director's run (status.running); a status that lists no run for the chat ends the page's
// turn (after the short arm grace); a chat the server still runs keeps its indicator. Server side: the status
// lists every running Yozora session (runningSessions) and the dormant-hold key follows that list.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/director.js'), 'utf8');
const hs = src.indexOf('const STATUS_ARM_GRACE_MS');
const he = src.indexOf('function directorPersonaName(persona) {');
assert.ok(hs >= 0 && he > hs, 'helper present');
const cs = src.indexOf('class Director {');
const ce = src.indexOf('\n}\n', cs);
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(`${src.slice(hs, he)}\n${src.slice(cs, ce + 2)}\nthis.Director = Director; this.serves = directorServerRunsSession; this.GRACE = STATUS_ARM_GRACE_MS;`, ctx);

// helper truth table
const xiRun = (ids) => ({ running: false, xi: { enabled: true, running: ids.length > 0, runningSessions: ids, sessionId: ids.length === 1 ? ids[0] : null } });
assert.strictEqual(ctx.serves(xiRun(['a']), 'a', true), true, 'xi chat with its run');
assert.strictEqual(ctx.serves(xiRun(['b']), 'a', true), false, 'xi chat, another xi chat runs');
assert.strictEqual(ctx.serves(xiRun([]), 'a', true), false, 'xi chat, nothing runs');
assert.strictEqual(ctx.serves({ running: true, sessionId: 'w', xi: { running: false, runningSessions: [] } }, 'a', true), false, 'cursor Director run does not keep a xi chat');
assert.strictEqual(ctx.serves({ running: true, sessionId: 'w', xi: { running: false } }, 'w', false), true, 'director chat keeps its own run');
assert.strictEqual(ctx.serves({ running: false, xi: { running: true, runningSessions: ['a'] } }, 'w', false), false, 'xi run does not keep a director chat');

function page(persona, sid, armedMsAgo) {
    const d = Object.create(ctx.Director.prototype);
    d.persona = persona;
    d.currentSession = { id: sid };
    d._running = true;
    d._runningSessionId = sid;
    d._runningArmedAt = Date.now() - armedMsAgo;
    d.finished = [];
    d.finishTurn = function (id) { this.finished.push(id); this._running = false; };
    ['updateTrayChrome', 'noteCursorLogin', 'showTypingIndicator', 'loadDirectorSessions', 'continueAfterReconnect'].forEach((k) => { d[k] = () => {}; });
    d.noteXiEnabled = () => false;
    return d;
}

// 1. turn ended on the server while the cursor Director runs another chat: the Yozora indicator drops at once
let d = page('xi', 'a', ctx.GRACE + 1000);
d.applyDirectorStatus({ running: true, sessionId: 'w', xi: { enabled: true, running: false, runningSessions: [], sessionId: null } });
assert.deepStrictEqual(d.finished, ['a'], 'xi chat ends although the cursor Director runs');

// 2. nothing runs anywhere: ends (a client that was hidden during the turn gets this status on waking)
d = page('xi', 'a', 60000);
d.applyDirectorStatus(xiRun([]));
assert.deepStrictEqual(d.finished, ['a'], 'ends when no run');

// 3. the agent is genuinely working: the indicator stays
d = page('xi', 'a', 60000);
d.applyDirectorStatus(xiRun(['a']));
assert.deepStrictEqual(d.finished, [], 'working chat keeps the indicator');
d = page('xi', 'a', 60000);
d.applyDirectorStatus(xiRun(['a', 'b']));
assert.deepStrictEqual(d.finished, [], 'two runs: both keep theirs');

// 4. the first seconds of a turn this page just started: a status that predates the run does not end it
d = page('xi', 'a', 500);
d.applyDirectorStatus(xiRun([]));
assert.deepStrictEqual(d.finished, [], 'grace at the start of a turn');

// 5. a Director (cursor) chat is unchanged
d = page('wren', 'w', 60000);
d.applyDirectorStatus({ running: true, sessionId: 'w', xi: { running: false, runningSessions: [] } });
assert.deepStrictEqual(d.finished, [], 'director run keeps its chat');
d = page('wren', 'w', 60000);
d.applyDirectorStatus({ running: false, xi: { running: false, runningSessions: [] } });
assert.deepStrictEqual(d.finished, ['w'], 'director chat ends when idle');

// server side: the Xi status lists every running session; the dormant-hold key follows the list
process.env.HOME = fs.mkdtempSync(path.join(require('os').tmpdir(), 'xi-status-'));
const xi = require('../modules/xiDirector');
const rs = xi.runtimeStatus();
assert.deepStrictEqual(rs.runningSessions, [], 'no run: empty list');
assert.strictEqual(rs.running, false);
const wsSrc = fs.readFileSync(path.join(__dirname, '../modules/websocket.js'), 'utf8');
assert.ok(/runningSessions\.join\(','\)/.test(wsSrc), 'directorRunKey keys on every running Xi session');

console.log('test-director-status-running: ok');
process.exit(0);
