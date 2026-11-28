#!/usr/bin/env node
// The Remote Access notice (#1199): the desktop tray balloon, and on Melaton Mobile one phone notification (appNote).
// Loads the real public/scripts/comp/mcpActivityClient.js in a vm context with stubs.
// Run: node scripts/test-remote-access-notice.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'scripts', 'comp', 'mcpActivityClient.js'), 'utf8');

function element() {
    const classes = new Set();
    return {
        dataset: {},
        title: '',
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c)
        },
        addEventListener() {}
    };
}

/** A fresh page: uiShell is 'mobile' or undefined; withShell gives it a wmShell whose appNote records its calls. */
function page({ uiShell, withShell }) {
    const calls = { popovers: [], appNotes: [], updates: [], closes: [], timers: 0, unbinds: 0 };
    const up = new Set(); // the ids of phone notes still in the DOM
    const indicator = element();
    let next = 0;
    const doc = {
        readyState: 'complete',
        addEventListener() {},
        getElementById(id) {
            if (id === 'mcpActivityIndicator') return indicator;
            if (up.has(id)) return element();
            return null;
        }
    };
    const window = {
        uiShell,
        isAgentSessionBound: () => false,
        agentSessionUnbindRequest: () => { calls.unbinds++; return Promise.resolve({ unbound: true }); }
    };
    if (withShell) {
        window.wmShell = {
            appNote(opts) {
                const id = `note-${++next}`;
                up.add(id);
                calls.appNotes.push(opts);
                return {
                    id,
                    update: (o) => calls.updates.push({ id, ...o }),
                    close: () => { up.delete(id); calls.closes.push(id); },
                    shown: () => up.has(id)
                };
            }
        };
    }
    const context = {
        window,
        document: doc,
        console,
        setTimeout: () => 0,
        clearTimeout() {},
        Promise,
        registerWsInboundHandler() {},
        contextMenu: null,
        showPopover: (...args) => calls.popovers.push(args),
        startPopoverAutoHideTimer: () => { calls.timers++; },
        updateImageGenerationIndicator() {}
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(SOURCE, context, { filename: 'mcpActivityClient.js' });
    return { calls, window, up, notice: window.showAgentSessionTrayNotice };
}

// the coalescing window compares Date.now(): move it ahead so each case below starts a new notice
async function withClock(fn) {
    const real = Date.now;
    let t = 1000000;
    Date.now = () => t;
    try { return await fn(() => { t += 60000; }); } finally { Date.now = real; }
}

withClock(async (tick) => {
    // 1. desktop: the balloon, with the escaped message; no phone note
    {
        const p = page({ uiShell: undefined, withShell: true });
        p.notice('update', { actorName: 'Claude Code' });
        assert.strictEqual(p.calls.popovers.length, 1, 'desktop shows one balloon');
        const args = p.calls.popovers[0];
        assert.strictEqual(args[1], 'info');
        assert.strictEqual(args[2], 'Remote Access');
        assert.strictEqual(args[3], 'Studio was updated by "Claude Code"');
        assert.strictEqual(args[8].popupId, 'remote-access');
        assert.strictEqual(p.calls.timers, 1, 'the balloon auto-hide runs');
        assert.strictEqual(p.calls.appNotes.length, 0, 'no phone note on the desktop');
        tick();
        // markup in a name is text in the balloon
        p.notice('update', { actorName: '<img src=x onerror=alert(1)>' });
        assert.strictEqual(p.calls.popovers[1][3], 'Studio was updated by "&lt;img src=x onerror=alert(1)&gt;"');
    }

    // DeX: a desktop shell on the phone (uiShell not 'mobile') keeps the balloon even with a wmShell around
    {
        const p = page({ uiShell: 'desktop', withShell: true });
        p.notice('open', { actorName: 'Claude Code' });
        assert.strictEqual(p.calls.popovers.length, 1);
        assert.strictEqual(p.calls.appNotes.length, 0);
    }

    // 2. Melaton Mobile: one silent note, escaped, updated in place, a new one after it is gone
    {
        const p = page({ uiShell: 'mobile', withShell: true });
        p.notice('update', { actorName: '<img src=x onerror=alert(1)>' });
        assert.strictEqual(p.calls.appNotes.length, 1, 'one phone note');
        const note = p.calls.appNotes[0];
        assert.strictEqual(note.title, 'Remote Access');
        assert.strictEqual(note.silent, true, 'N7: no sound');
        assert.strictEqual(note.event, 'notification', 'the class Other notifications (its Display message on screen)');
        assert.strictEqual(note.html, 'Studio was updated by "&lt;img src=x onerror=alert(1)&gt;"');
        assert.ok(!/<img/i.test(note.html), 'no markup from a name reaches the note');
        assert.strictEqual(p.calls.popovers.length, 0, 'no balloon on the phone');
        assert.strictEqual(p.calls.timers, 0);

        tick();
        // the same agent again while it is up: its words change in place, no new note (N9)
        p.notice('open', { actorName: '<img src=x onerror=alert(1)>' });
        assert.strictEqual(p.calls.appNotes.length, 1, 'a second notice from the same agent while it is up is no new note (N9)');
        assert.deepStrictEqual(p.calls.updates, [{ id: 'note-1', html: 'Studio was opened by "&lt;img src=x onerror=alert(1)&gt;"' }]);

        // a burst from the same actor inside the coalescing window changes nothing
        p.notice('open', { actorName: '<img src=x onerror=alert(1)>' });
        assert.strictEqual(p.calls.updates.length, 1, 'coalesced');

        // another agent takes the session while the note is up: news, so its note replaces the first and pops
        tick();
        p.notice('open', { actorName: 'Fleet access "Fix the tray"' });
        assert.strictEqual(p.calls.appNotes.length, 2, 'another agent gets its own note');
        assert.strictEqual(p.calls.appNotes[1].html, 'Studio was opened by Fleet access "Fix the tray"');
        assert.deepStrictEqual(p.calls.closes, ['note-1'], 'the first note is closed (one at a time)');
        assert.strictEqual(p.calls.updates.length, 1, 'no update for another agent');

        // the note is gone (Dismiss): the next notice, same agent, makes a new one
        p.up.delete('note-2');
        tick();
        p.notice('read', { actorName: 'Fleet access "Fix the tray"' });
        assert.strictEqual(p.calls.appNotes.length, 3, 'a new note after the last is gone');
        assert.strictEqual(p.calls.appNotes[2].html, 'Studio was read by Fleet access "Fix the tray"');
        assert.deepStrictEqual(p.calls.closes, ['note-1', 'note-2'], 'the old note is closed before the new one');
        assert.strictEqual(p.calls.popovers.length, 0, 'showPopover is never called on the phone');
    }

    // 3. wording
    {
        const p = page({ uiShell: 'mobile', withShell: true });
        // the words now on the phone: the last note made, or the last update to it (another agent makes a new note)
        let seen = 0;
        const say = (action, data) => {
            tick();
            const notes = p.calls.appNotes.length;
            p.notice(action, data);
            if (p.calls.appNotes.length > notes) { seen = p.calls.updates.length; return p.calls.appNotes[p.calls.appNotes.length - 1].html; }
            assert.ok(p.calls.updates.length > seen, 'same agent: updated in place');
            seen = p.calls.updates.length;
            return p.calls.updates[p.calls.updates.length - 1].html;
        };
        assert.strictEqual(say('read', { actorName: 'Fleet access "x"' }), 'Studio was read by Fleet access "x"');
        assert.strictEqual(say('read', { actorName: 'Fleet access, work item #3 "y"' }), 'Studio was read by Fleet access, work item #3 "y"');
        assert.strictEqual(say('update', { actorName: 'Claude Code' }), 'Studio was updated by "Claude Code"');
        assert.strictEqual(say('physics', { actorName: 'Fleet access "x"' }), 'Your location was accessed by Fleet access "x"');
        assert.strictEqual(say('windows', { actorName: 'Claude Code' }), 'Your session was accessed by "Claude Code"');
    }

    // the Fleet label is shown as it is, on the desktop too (no quotes added around it)
    {
        const p = page({ uiShell: undefined, withShell: false });
        p.notice('read', { actorName: 'Fleet access "x"' });
        assert.strictEqual(p.calls.popovers[0][3], 'Studio was read by Fleet access "x"');
        tick();
        p.notice('read', { actorName: 'Fleet access, work item #3 "y"' });
        assert.strictEqual(p.calls.popovers[1][3], 'Studio was read by Fleet access, work item #3 "y"');
    }

    // Disconnect is an action only while an agent is bound; it unbinds this client and closes the note
    {
        const p = page({ uiShell: 'mobile', withShell: true });
        p.notice('read', { actorName: 'Claude Code' });
        const actions = p.calls.appNotes[0].actions;
        assert.strictEqual(typeof actions, 'function');
        assert.deepStrictEqual(Array.from(actions()), [], 'nothing bound: Hide | Dismiss only');
        tick();
        p.notice('bound', { actorName: 'Claude Code' });
        const list = Array.from(actions());
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0].text, 'Disconnect');
        list[0].action();
        await new Promise((resolve) => setImmediate(resolve));
        assert.strictEqual(p.calls.unbinds, 1, 'agent_session_unbind is asked for');
        assert.deepStrictEqual(p.calls.closes, ['note-1'], 'the note goes after the unbind');
    }
}).then(() => {
    console.log('remote access notice: ok');
}, (err) => {
    console.error(err);
    process.exit(1);
});
