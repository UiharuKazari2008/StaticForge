'use strict';

// #352: a Rentan turn cannot hold the generation FIFO for the Director's 30 minutes.
// #367: an idle Director and Wren computer stop, and the next turn starts them again.

const assert = require('assert');
const { spawn } = require('child_process');
const director = require('../modules/cursorDirector');
const t = director._test;

assert.strictEqual(t.DYNAGEN_IDLE_MS, 2 * 60 * 1000);
assert.strictEqual(t.DYNAGEN_HARD_MS, 3 * 60 * 1000);
assert.strictEqual(t.RENTAN_REVIEW_HARD_MS, 8 * 60 * 1000);
assert.ok(t.DYNAGEN_HARD_MS < t.RUN_HARD_MS);
assert.ok(t.RENTAN_REVIEW_HARD_MS < t.RUN_HARD_MS);
assert.strictEqual(t.RUN_IDLE_MS, 12 * 60 * 1000);
assert.strictEqual(t.RUN_HARD_MS, 30 * 60 * 1000);

const limits = t.dynagenTurnLimits(false);
assert.strictEqual(limits.idleMs, t.DYNAGEN_IDLE_MS);
assert.strictEqual(limits.hardMs, t.DYNAGEN_HARD_MS);
assert.strictEqual(t.turnDeadline(limits.idleMs - 1, 0, 0, limits), null);
assert.strictEqual(t.turnDeadline(limits.idleMs, 0, 0, limits).reason, 'idle');
assert.strictEqual(t.turnDeadline(limits.hardMs, 0, limits.hardMs - 1, limits).reason, 'hard');
assert.strictEqual(t.turnDeadline(limits.hardMs - 1, 0, limits.hardMs - limits.idleMs, limits), null, 'output resets the idle clock');

const reviewLimits = t.dynagenTurnLimits(true);
assert.strictEqual(reviewLimits.idleMs, t.DYNAGEN_IDLE_MS);
assert.strictEqual(reviewLimits.hardMs, t.RENTAN_REVIEW_HARD_MS);
assert.strictEqual(t.turnDeadline(t.RUN_HARD_MS, 0, t.RUN_HARD_MS, null).reason, 'hard');
assert.strictEqual(t.turnDeadline(t.RUN_IDLE_MS, 0, 0, null).reason, 'idle');

const prompt = t.dynagenTurnPrompt(true, { review: { chatId: 'abc' }, chatId: 'abc', reason: 'stale' });
assert.ok(prompt.includes('await_rentan_attempt'));
assert.ok(prompt.includes('finish_rentan'));
assert.ok(!prompt.includes('summary line only'));
const plain = t.dynagenTurnPrompt(true, { chatId: 'abc', reason: 'stale' });
assert.ok(plain.includes('summary line only'));
assert.ok(plain.includes('deliver_rentan'));

function exited(child) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('child was not killed')), 3000);
        child.on('close', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

async function main() {
    const hung = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    t.killAgentChild(hung);
    await exited(hung);

    assert.strictEqual(t.readIdleShutdownMinutes({ getConfig: () => ({ director: { idleShutdownMinutes: 4 } }) }), 4);
    assert.strictEqual(t.readIdleShutdownMinutes({ getConfig: () => ({ director: { idleShutdownMinutes: 0 } }) }), 0);
    assert.strictEqual(t.readIdleShutdownMinutes({ getConfig: () => ({}) }), 15);

    const browser = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    t.setBrowserChild(browser);
    t.noteDirectorActivity(Date.now() - 16 * 60 * 1000);
    const stopped = t.tickIdleShutdown(Date.now(), { minutes: 15, running: false });
    assert.strictEqual(stopped.stopped, true);
    assert.strictEqual(stopped.dreamscapeRestart, false);
    assert.deepStrictEqual(stopped.pids, [browser.pid]);
    await exited(browser);
    const down = t.idleShutdownState();
    assert.strictEqual(down.computerStopped, true);
    assert.strictEqual(down.code, 'DIRECTOR_IDLE_SHUTDOWN');

    t.wakeDirectorComputer();
    assert.strictEqual(t.idleShutdownState().computerStopped, false);
    t.noteDirectorActivity(Date.now() - 16 * 60 * 1000);
    const busy = t.tickIdleShutdown(Date.now(), { minutes: 15, running: true });
    assert.strictEqual(busy.stopped, false);
    assert.strictEqual(busy.reason, 'busy');
    assert.strictEqual(busy.dreamscapeRestart, false);
    assert.strictEqual(t.idleShutdownState().computerStopped, false);

    t.noteDirectorActivity(Date.now());
    const active = t.tickIdleShutdown(Date.now(), { minutes: 15, running: false });
    assert.strictEqual(active.reason, 'active');
    assert.strictEqual(t.tickIdleShutdown(Date.now(), { minutes: 0, running: false }).reason, 'disabled');

    console.log('test-dynagen-turn-limits: ok');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
