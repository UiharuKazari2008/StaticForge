#!/usr/bin/env node
/**
 * Phone consent on the desktop (Yozora #1305): public/scripts/comp/deviceConsentDesktop.js in a fake desktop page.
 *
 * Replays the server's inbox pushes (modules/deviceConsentNotices.js: device-ask:<lease>, device-hold:<device>) and checks:
 * - one balloon per ask id, on Device Center's tray icon, with Allow and Deny buttons and the notice's own words (escaped);
 * - the Notify sound plays once, only when the push says alert true; never for a repeat, a quiet ask or a ask found on connect;
 * - no balloon (and no sound) for the in-use notice device-hold:*;
 * - Allow sends device_consent_answer { id, answer: 'allow' }; a scripted (untrusted) click sends nothing;
 * - the balloon closes on the server's answer (ok) and when the server's clear arrives (answered on the phone);
 * - ok false is told in the balloon (warning look) and the clear that follows does not take it down; it goes by itself;
 * - a send that never arrived keeps the keys; the balloon's click opens Fleet's Device Queue;
 * - several asks: one balloon at a time, the next one comes up when the first is answered;
 * - Notifications settings switching the balloons off: nothing shows or sounds.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/deviceConsentDesktop.js'), 'utf8');
const PHONE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/wmNotificationInbox.js'), 'utf8');

// the phone's box (wmNotificationInbox answerKeys): the same ask on Melaton Mobile, answered with the soft keys
function phone(reply) {
    const handlers = new Map();
    const notes = [];
    const timers = [];
    const sent = [];
    const wsClient = {
        isConnected: () => true,
        on: (t, fn) => { handlers.set(t, fn); },
        sendMessage: (type, payload) => {
            sent.push({ type, payload });
            if (type === 'device_consent_answer') return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
            return Promise.resolve({});
        },
    };
    const wmShell = {
        appNote: (opts) => {
            const n = { opts, updates: [], open: true, update(o) { this.updates.push(o); }, close() { this.open = false; } };
            notes.push(n);
            return n;
        },
    };
    const window = { uiShell: 'mobile', wsClient, wmShell, addEventListener: () => {} };
    const ctx = {
        window,
        document: { hidden: false, documentElement: { classList: { contains: (c) => c === 'ui-mobile' } }, querySelectorAll: () => [], addEventListener: () => {}, getElementById: () => null },
        localStorage: { getItem: (k) => (k === 'userType' ? 'admin' : null) },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},
        Date, Promise, JSON, Map, Set, String, Number, Array, Object, Math, Error, console,
    };
    vm.createContext(ctx);
    vm.runInContext(PHONE_SRC, ctx, { filename: 'wmNotificationInbox.js' });
    return {
        notes, timers, sent,
        push: (notice) => handlers.get('inbox_updated')({ type: 'inbox_updated', data: { reason: 'new', notice } }),
        clear: (id) => handlers.get('inbox_updated')({ type: 'inbox_updated', data: { reason: 'ack', id, state: 'cleared' } }),
    };
}

function page(opts = {}) {
    const handlers = new Map();
    const docHandlers = new Map();
    const sent = [];
    const sounds = [];
    const launched = [];
    const balloons = []; // every showPopover: { type, title, message, options }
    const hides = [];
    let listed = [];
    let replies = [];
    const cls = new Set(['hidden']);
    const anchor = {
        id: 'activeSyncTrayIcon', isConnected: true,
        classList: { contains: (c) => cls.has(c), add: (c) => cls.add(c), remove: (c) => cls.delete(c) },
    };
    const document = {
        hidden: false,
        getElementById: (id) => (id === 'activeSyncTrayIcon' ? anchor : null),
        addEventListener: (t, fn) => { docHandlers.set(t, fn); },
    };
    const wsClient = {
        isConnected: () => true,
        on: (t, fn) => { handlers.set(t, fn); },
        sendMessage: (type, payload) => {
            sent.push({ type, payload });
            if (type === 'inbox_list') return Promise.resolve({ notices: listed, total: listed.length });
            const r = replies.length ? replies.shift() : { ok: true };
            return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
        },
    };
    // PopoverManager as the tray standard behaves: one balloon on the icon, updated in place, hide() runs its onHide
    const active = new Map();
    const PopoverManager = {
        activePopovers: active,
        trayBusy: () => false,
        whenTrayFree: () => {},
        showPopover(el, type, title, message, progress, timeout, icon, buttons, options) {
            balloons.push({ type, title, message, icon, timeout, options });
            const popover = { querySelector: (sel) => (sel.split(',').some((s) => (s.trim() === '[data-dcd-id]' && /data-dcd-id=/.test(message)) || (s.trim() === '[data-dcd-error]' && /data-dcd-error=/.test(message))) ? {} : null) };
            active.set(el, { popover, onHide: options.onHide });
            return popover;
        },
        hide(el) {
            const d = active.get(el);
            if (!d) return;
            hides.push(el.id);
            active.delete(el);
            if (d.onHide) d.onHide(d.popover, el);
        },
    };
    const window = {
        uiShell: 'desktop', location: { search: '' }, wsClient, PopoverManager,
        desktopSounds: { play: (e) => sounds.push(e) },
        melatonApps: { launch: (o) => { launched.push(o); return Promise.resolve(); } },
        trayNotePopup: () => {},
        trayPopupHidden: () => !!opts.popupsOff,
        revealTrayIconElement: (el) => el.classList.remove('hidden'),
        addEventListener: () => {},
    };
    const ctx = {
        window, document, URLSearchParams,
        localStorage: { getItem: (k) => (k === 'userType' ? 'admin' : null) },
        Date, Promise, JSON, Map, Set, String, Number, Array, Object, Math, Error, console,
    };
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx, { filename: 'deviceConsentDesktop.js' });
    const buttonsOf = (b) => {
        const out = {};
        for (const m of String(b.message).matchAll(/<button[^>]*data-dcd-id="([^"]*)"[^>]*data-dcd-answer="([^"]*)"([^>]*)>([^<]*)<\/button>/g)) out[m[2]] = { id: m[1].replace(/&amp;/g, '&'), disabled: /disabled/.test(m[3]), label: m[4] };
        return out;
    };
    return {
        window, sent, sounds, launched, balloons, hides, anchor, active,
        push: (notice) => handlers.get('inbox_updated')({ type: 'inbox_updated', data: { reason: 'new', notice } }),
        clear: (id) => handlers.get('inbox_updated')({ type: 'inbox_updated', data: { reason: 'ack', id, state: 'cleared' } }),
        connect: () => handlers.get('connected')(),
        setList: (l) => { listed = l; },
        reply: (...r) => { replies = r; },
        buttonsOf,
        up: () => active.size > 0,
        // a real click on one of the balloon's buttons (the document's capture listener answers it)
        click: (b, answer, trusted = true) => {
            const btn = { dataset: { dcdId: b[answer].id, dcdAnswer: answer }, disabled: false };
            btn.closest = (sel) => (sel === '[data-dcd-answer]' ? btn : null);
            const ev = { target: btn, isTrusted: trusted, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
            docHandlers.get('click')(ev);
            return ev;
        },
    };
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const flush = () => new Promise((r) => setImmediate(r));
const ask = (lease, extra = {}) => Object.assign({
    id: `device-ask:${lease}`, app: 'claudedesk', cls: 'notification', state: 'new', alert: true, createdAt: 1000, updatedAt: 1000,
    title: 'Claude F24C wants the Galaxy A53', text: 'For up to 15 min. Why: checking the lock screen.',
    data: { app: 'claudedesk', kind: 'device-ask', leaseId: lease, device: 'a53', buttons: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }], answerType: 'device_consent_answer', page: 'devices' },
}, extra);
const hold = () => ({
    id: 'device-hold:a53', app: 'claudedesk', cls: 'notification', state: 'new', alert: false, title: 'Galaxy A53 is in use by Claude F24C', text: 'Until 14:30.',
    data: { app: 'claudedesk', kind: 'device-hold', device: 'a53', leaseId: '7', buttons: [{ id: 'end', label: 'End' }], answerType: 'device_consent_answer' },
});

(async () => {
    // an ask: one balloon, its words, Allow and Deny, one sound
    let p = page();
    await flush();
    p.push(ask('7'));
    assert.strictEqual(p.balloons.length, 1, 'one balloon for the ask');
    let b = p.balloons[0];
    assert.strictEqual(b.title, 'Claude F24C wants the Galaxy A53', 'the notice title');
    assert.ok(b.message.includes('For up to 15 min. Why: checking the lock screen.'), 'the notice text');
    assert.deepStrictEqual(plain(Object.keys(p.buttonsOf(b))), ['allow', 'deny'], 'Allow and Deny');
    assert.strictEqual(p.buttonsOf(b).allow.label, 'Allow');
    assert.strictEqual(p.buttonsOf(b).deny.label, 'Deny');
    assert.ok(/class="btn-standard"/.test(b.message), 'the desktop push button class');
    assert.strictEqual(b.options.popupId, 'device-consent', 'switchable in Notifications settings');
    assert.strictEqual(b.options.position, 'top');
    assert.strictEqual(b.options.arrowPosition, 'bottom-right');
    assert.strictEqual(typeof b.options.onClick, 'function', 'a click action (tray-balloons)');
    assert.ok(!p.anchor.classList.contains('hidden'), 'the icon shows for the balloon');
    assert.deepStrictEqual(plain(p.sounds), ['notify'], 'the desktop Notify sound, once');
    // the same ask again (a repeat push, alert true): updated in place, no second balloon, no second sound
    p.push(ask('7'));
    p.push(ask('7'));
    assert.strictEqual(p.balloons.length, 1, 'a repeat is not a second balloon');
    assert.deepStrictEqual(plain(p.sounds), ['notify'], 'never a second sound');
    // the balloon's click opens Fleet on its Device Queue
    b.options.onClick();
    assert.deepStrictEqual(plain(p.launched), [{ packageId: 'claudedesk', args: { page: 'devices' } }], 'opens Fleet at the Device Queue');

    // the in-use notice is never a balloon, never a sound
    p = page();
    await flush();
    p.push(hold());
    p.push(Object.assign(hold(), { alert: true }));
    assert.strictEqual(p.balloons.length, 0, 'no balloon for device-hold');
    assert.deepStrictEqual(plain(p.sounds), [], 'no sound for device-hold');

    // alert false: the balloon, no sound
    p = page();
    await flush();
    p.push(ask('8', { alert: false }));
    assert.strictEqual(p.balloons.length, 1, 'a quiet ask still shows');
    assert.deepStrictEqual(plain(p.sounds), [], 'a quiet ask does not sound');

    // Allow: the right packet, from a real click only; the balloon closes on ok
    p = page();
    await flush();
    p.push(ask('9'));
    b = p.balloons[0];
    let ev = p.click(p.buttonsOf(b), 'allow', false);
    await flush();
    assert.ok(ev.stopped, 'the balloon never sees the button click (it would close and open Fleet)');
    assert.strictEqual(p.sent.filter((s) => s.type === 'device_consent_answer').length, 0, 'a scripted click answers nothing');
    p.reply({ ok: true });
    ev = p.click(p.buttonsOf(b), 'allow', true);
    await flush();
    const answers = p.sent.filter((s) => s.type === 'device_consent_answer');
    assert.deepStrictEqual(plain(answers.map((a) => a.payload)), [{ id: 'device-ask:9', answer: 'allow' }], 'Allow sends the notice id and "allow"');
    assert.ok(!p.up(), 'the balloon closed on ok');
    p.clear('device-ask:9'); // the server's clear after the answer: nothing more to do
    assert.ok(!p.up());
    // Deny sends deny
    p.push(ask('10'));
    p.reply({ ok: true });
    p.click(p.buttonsOf(p.balloons[p.balloons.length - 1]), 'deny');
    await flush();
    assert.deepStrictEqual(plain(p.sent.filter((s) => s.type === 'device_consent_answer').pop().payload), { id: 'device-ask:10', answer: 'deny' }, 'Deny sends "deny"');

    // answered on the phone: the server's clear closes the balloon
    p = page();
    await flush();
    p.push(ask('11'));
    assert.ok(p.up(), 'balloon up');
    p.clear('device-ask:11');
    assert.ok(!p.up(), 'the balloon closes on the clear');
    assert.strictEqual(p.hides.length, 1, 'hidden once');
    assert.strictEqual(p.window.deviceConsentDesktop._state().asks.size, 0, 'nothing waits');

    // ok false: told in the balloon (warning look), stays through the clear, goes by itself
    p = page();
    await flush();
    p.push(ask('12'));
    p.reply({ ok: false, error: 'That ask is no longer pending' });
    p.click(p.buttonsOf(p.balloons[0]), 'allow');
    await flush();
    assert.strictEqual(p.buttonsOf(p.balloons[1]).allow.disabled, true, 'the keys are off while the answer is on its way');
    const err = p.balloons[p.balloons.length - 1];
    assert.strictEqual(err.type, 'warning', 'the Vista warning look');
    assert.ok(err.icon.includes('warning-32.png'), 'Vista\'s warning image');
    assert.ok(err.message.includes('That ask is no longer pending'), 'the server\'s error in the balloon');
    assert.ok(!/data-dcd-answer/.test(err.message), 'no keys on the error');
    p.clear('device-ask:12'); // the server clears it after any answer
    assert.ok(p.up(), 'the clear does not take the error down');
    err.options.onHide(p.active.get(p.anchor).popover, p.anchor); // its time ran out
    assert.strictEqual(p.window.deviceConsentDesktop._state().view, null, 'the balloon state is clean');

    // a send that never arrived: the keys stay, to press again
    p = page();
    await flush();
    p.push(ask('13'));
    p.reply(new Error('Timed out'));
    p.click(p.buttonsOf(p.balloons[0]), 'allow');
    await flush();
    assert.ok(p.up(), 'the balloon stays');
    const again = p.balloons[p.balloons.length - 1];
    assert.ok(again.message.includes('Not sent. Try again.'), 'says it did not arrive');
    assert.strictEqual(p.buttonsOf(again).allow.disabled, false, 'the keys work again');
    p.reply({ ok: true });
    p.click(p.buttonsOf(again), 'allow');
    await flush();
    assert.ok(!p.up(), 'then it goes');

    // several asks: one balloon at a time; the next comes up when the first is answered
    p = page();
    await flush();
    p.push(ask('20'));
    p.push(ask('21', { title: 'Claude B1 wants the Galaxy Z Fold' }));
    assert.strictEqual(p.balloons.length, 2, 'the second ask redraws the same balloon (one icon, one balloon)');
    assert.strictEqual(p.balloons[1].title, 'Claude F24C wants the Galaxy A53', 'the oldest stays on top');
    assert.ok(p.balloons[1].message.includes('1 more question waits in Fleet.'), 'says another waits');
    assert.strictEqual(p.sounds.length, 2, 'each new ask sounded once (alert true each)');
    p.reply({ ok: true });
    p.click(p.buttonsOf(p.balloons[1]), 'allow');
    await flush();
    const next = p.balloons[p.balloons.length - 1];
    assert.strictEqual(next.title, 'Claude B1 wants the Galaxy Z Fold', 'the next question comes up');
    assert.strictEqual(p.sounds.length, 2, 'and does not sound again');

    // found on connect: shown, silent; a repeat list changes nothing; one answered meanwhile goes
    p = page();
    await flush();
    p.setList([ask('30'), ask('31', { state: 'cleared' }), hold()]);
    p.connect();
    await flush();
    assert.strictEqual(p.balloons.length, 1, 'one waiting ask found, the cleared one and the hold are not');
    assert.deepStrictEqual(plain(p.sounds), [], 'a question found on connect is silent');
    p.connect();
    await flush();
    assert.strictEqual(p.balloons.length, 1, 'listing again draws nothing new');
    p.setList([]);
    p.connect();
    await flush();
    assert.ok(!p.up(), 'answered while the page was away: the balloon goes');

    // the user's words are never markup
    p = page();
    await flush();
    p.push(ask('40', { title: '<img src=x onerror=alert(1)> wants it', text: '"><script>bad()</script>' }));
    assert.ok(!p.balloons[0].title.includes('<img') && !p.balloons[0].message.includes('<script'), 'title and text are escaped');

    // Notifications settings switched the balloon off: nothing shows, nothing sounds
    p = page({ popupsOff: true });
    await flush();
    p.push(ask('50'));
    assert.strictEqual(p.balloons.length, 0, 'no balloon');
    assert.deepStrictEqual(plain(p.sounds), [], 'no sound');

    // not on the phone shell
    p = page();
    p.window.uiShell = 'mobile';
    p.push(ask('60'));
    assert.strictEqual(p.balloons.length, 0, 'the phone shell has its own box');

    // the phone's box (P6): closes when the server answered ok; a refusal is read in the box, the clear that follows does not
    // take it down, then it goes; a send that never arrived leaves the keys up
    let ph = phone({ ok: true });
    ph.push(ask('70'));
    await flush();
    assert.strictEqual(ph.notes.length, 1, 'the phone box is up');
    let keys = ph.notes[0].opts.softKeys();
    assert.deepStrictEqual(plain([keys.left.label, keys.right.label]), ['Allow', 'Deny'], 'Allow | Deny keys');
    keys.left.action();
    await flush();
    assert.deepStrictEqual(plain(ph.sent.filter((s) => s.type === 'device_consent_answer').map((s) => s.payload)), [{ id: 'device-ask:70', answer: 'allow' }], 'the phone sends the same packet');
    assert.strictEqual(ph.notes[0].open, false, 'ok: the box closes');

    ph = phone({ ok: false, error: 'Already answered' });
    ph.push(ask('71'));
    await flush();
    ph.notes[0].opts.softKeys().right.action();
    await flush();
    assert.strictEqual(ph.notes[0].open, true, 'refused: the box stays to be read');
    assert.strictEqual(ph.notes[0].updates.length, 1, 'its text becomes the error');
    assert.ok(ph.notes[0].updates[0].html.includes('Already answered'), 'the error is in the box');
    ph.clear('device-ask:71'); // the server clears the notice after any answer
    assert.strictEqual(ph.notes[0].open, true, 'the clear does not take the message down');
    const last = ph.timers[ph.timers.length - 1];
    assert.ok(last && last.ms >= 2000 && last.ms <= 6000, 'it goes after a few seconds');
    last.fn();
    assert.strictEqual(ph.notes[0].open, false, 'then the box closes');

    ph = phone(new Error('Timed out'));
    ph.push(ask('72'));
    await flush();
    ph.notes[0].opts.softKeys().left.action();
    await flush();
    assert.strictEqual(ph.notes[0].open, true, 'never arrived: the box stays');
    ph.notes[0].opts.softKeys().left.action();
    await flush();
    assert.strictEqual(ph.sent.filter((s) => s.type === 'device_consent_answer').length, 2, 'and its keys press again');

    console.log('device consent desktop: ok');
})().catch((e) => { console.error(e); process.exit(1); });
