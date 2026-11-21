#!/usr/bin/env node
/**
 * Today's Social item (Yukimi, Nov 21 2026): public/scripts/comp/wmSocial.js in a fake page, with a fake
 * AndroidSocialNotifications (the app's store), wmShell, wmTitanium (the band it lends the bar), wmAndroidApps and
 * textMessaging. Checks:
 * - "Show all notifications by date": a page per notification, newest first; "Page per App": a page per social app in
 *   the Options' order, its newest notification (or "No new notifications");
 * - each page's right soft key is named after its app and opens it;
 * - a Messaging account (#885) is never a social app: offered greyed "(in Messaging)", left out of the pages and of
 *   what the app is told to take in;
 * - the chosen apps go to the app (setApps) at start and when the option changes, not again when nothing changed;
 * - a tap on a page opens the app's bar at that notification (selected, scrolled to), the soft key is the app's;
 *   left / right pages between the social apps; a tap on a notification fires it and puts the bar away;
 * - the bar keeps the band's height (82 units) open, paging, updated and closing: no frame animates a height;
 * - the app's push ('androidsocialnotifications') redraws the item and the open bar, with no timer and no request;
 * - the app's decision (DSApp SocialNotifications.kt removable / posted): a notification with no PendingIntent, or one
 *   that cannot be cleared, stays in the shade; Messaging accounts are not taken in (read from the Kotlin source when
 *   the DSApp tree is there: DSAPP_TREE, default ~/.cache/claude-run/dsapp-social).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/wmSocial.js'), 'utf8');

// ---------------------------------------------------------------- a small fake DOM (only what wmSocial.js touches)

function makeDom() {
    let ROW_H = 40;
    class El {
        constructor(tag) {
            this.tagName = String(tag).toUpperCase();
            this.children = [];
            this.parentNode = null;
            this.style = {};
            this.dataset = {};
            this.attrs = {};
            this.listeners = {};
            this.anims = [];
            this._cls = new Set();
            this._html = undefined;
            this.innerHTMLValue = '';
            this.hidden = false;
            this.scrollTop = 0;
            this.textContent = '';
            const self = this;
            this.classList = {
                add: (...c) => c.forEach((x) => self._cls.add(x)),
                remove: (...c) => c.forEach((x) => self._cls.delete(x)),
                contains: (c) => self._cls.has(c),
                toggle: (c, on) => { const v = on === undefined ? !self._cls.has(c) : !!on; if (v) self._cls.add(c); else self._cls.delete(c); return v; }
            };
        }
        get className() { return [...this._cls].join(' '); }
        set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
        set innerHTML(v) { this.innerHTMLValue = String(v); this.children.forEach((c) => { c.parentNode = null; }); this.children = [new El('div')]; this.children[0].parentNode = this; }
        get innerHTML() { return this.innerHTMLValue; }
        get firstChild() { return this.children[0] || null; }
        get firstElementChild() { return this.children[0] || null; }
        get nextSibling() { if (!this.parentNode) return null; const s = this.parentNode.children; return s[s.indexOf(this) + 1] || null; }
        get offsetTop() { return this.parentNode ? this.parentNode.children.indexOf(this) * ROW_H : 0; }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; }
        insertBefore(c, ref) {
            if (c.parentNode) c.remove();
            c.parentNode = this;
            const i = ref ? this.children.indexOf(ref) : -1;
            if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
            return c;
        }
        remove() { if (!this.parentNode) return; const s = this.parentNode.children; s.splice(s.indexOf(this), 1); this.parentNode = null; }
        contains(x) { for (let n = x; n; n = n.parentNode) if (n === this) return true; return false; }
        matches(sel) { return sel.split(',').some((s) => { s = s.trim(); return s.startsWith('.') ? s.slice(1).split('.').every((c) => this._cls.has(c)) : this.tagName === s.toUpperCase(); }); }
        closest(sel) { for (let n = this; n; n = n.parentNode) if (n.matches && n.matches(sel)) return n; return null; }
        querySelector(sel) {
            if (/\s/.test(sel.trim())) return null; // descendant selectors reach into innerHTML, which this DOM does not parse
            const walkFind = (n) => { for (const c of n.children) { if (c.matches(sel)) return c; const f = walkFind(c); if (f) return f; } return null; };
            return walkFind(this);
        }
        addEventListener(t, fn) { (this.listeners[t] || (this.listeners[t] = [])).push(fn); }
        animate(frames, opts) { const a = { frames, opts, cancelled: false, cancel() { this.cancelled = true; }, finished: Promise.resolve() }; this.anims.push(a); return a; }
        focus() { doc.activeElement = this; }
    }
    const doc = {
        activeElement: null,
        hidden: false,
        listeners: {},
        documentElement: new El('html'),
        createElement: (t) => new El(t),
        querySelectorAll: () => [],
        addEventListener(t, fn) { (this.listeners[t] || (this.listeners[t] = [])).push(fn); },
        dispatch(t, e) { (this.listeners[t] || []).forEach((fn) => fn(e)); }
    };
    doc.documentElement.classList.add('ui-mobile');
    /** A click on [target] bubbling up from it (stopPropagation stops it). */
    function click(target, extra) {
        let stopped = false;
        const e = Object.assign({ target, type: 'click', stopPropagation() { stopped = true; }, preventDefault() {} }, extra || {});
        for (let n = target; n && !stopped; n = n.parentNode) (n.listeners.click || []).forEach((fn) => fn(e));
    }
    return { El, doc, click, setRowHeight: (h) => { ROW_H = h; } };
}

// ---------------------------------------------------------------- the page

const NOW = Date.now();
const DISCORD = 'com.discord';
const INSTA = 'com.instagram.android';
const SIGNAL = 'org.thoughtcrime.securesms';

function note(id, pkg, app, title, text, ago, extra) {
    return Object.assign({ id, package: pkg, app, title, text, time: NOW - ago, canOpen: true, inShade: false }, extra || {});
}

function page(opts) {
    const { El, doc, click } = makeDom();
    const winListeners = {};
    const calls = { setApps: [], open: [], dismiss: [], action: [], launch: [], refresh: [], clear: [], softKeys: 0 };
    let store = (opts.notes || []).slice();
    let appsInApp = opts.appsInApp || [];
    const B = {
        access: () => true,
        apps: () => JSON.stringify(appsInApp),
        setApps: (j) => { calls.setApps.push(j); appsInApp = JSON.parse(j); return true; },
        list: () => JSON.stringify(store),
        open: (id) => { calls.open.push(id); return true; },
        action: (id, i, reply) => { calls.action.push([id, i, reply]); return true; },
        dismiss: (id) => { calls.dismiss.push(id); return true; },
        clear: (pkg) => { calls.clear.push(pkg); return true; }
    };
    const options = { social: Object.assign({}, opts.options || {}) };
    let item = null;
    const wmShell = {
        version: '6.5',
        todayOptionsKey: 'wmTodayOptions',
        registerTodayItem: (w) => { item = w; },
        refreshTodayItem: (id) => calls.refresh.push(id),
        refreshSoftKeys: () => { calls.softKeys += 1; },
        // wmShell.todayOption: the stored value, else the option's own default
        todayOption: (id, key) => {
            const v = options[id] && options[id][key];
            const def = item && item.options.find((o) => o.key === key);
            if (v != null) return v;
            return def ? def.value : null;
        }
    };
    const host = new El('div');
    host.classList.add('wm-ti');
    const list = new El('div');
    host.appendChild(list);
    let overlay = null;
    const U = 2;
    const BAND_TOP = 118;
    const wmTitanium = {
        bandBar: () => ({
            host, list, unit: U, bandTop: BAND_TOP * U, art: 'art', arrows: { prev: 'p', next: 'n' }, frost: null, frostTransform: '',
            pageHtml: (p, pg) => `${p.icon}|${pg.title}|${pg.line2}|${pg.line3}`,
            busy: () => !!overlay
        }),
        setOverlay: (o) => { overlay = o || null; }
    };
    const progs = [
        { id: `${DISCORD}/.Main`, package: DISCORD, label: 'Discord', icon: '//icons/discord' },
        { id: `${INSTA}/.Main`, package: INSTA, label: 'Instagram', icon: '//icons/insta' },
        { id: `${SIGNAL}/.Main`, package: SIGNAL, label: 'Signal', icon: '//icons/signal' }
    ];
    const messaging = new Set(opts.messaging || []);
    const window = {
        uiShell: 'mobile',
        wmShell,
        wmTitanium,
        AndroidSocialNotifications: B,
        wmAndroidApps: { list: () => progs.slice(), wmIcon: () => null },
        wmAndroidLaunch: (id, label) => { calls.launch.push([id, label]); return Promise.resolve(true); },
        textMessaging: { androidPackages: () => messaging, on() {}, off() {} },
        addEventListener: (t, fn) => { (winListeners[t] || (winListeners[t] = [])).push(fn); }
    };
    const timers = [];
    const ctx = {
        window, document: doc,
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout: () => {},
        Intl, Date, Promise, JSON, Map, Set, String, Number, Array, Object, Math, console
    };
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx, { filename: 'wmSocial.js' });
    assert.ok(item, 'the Social item registers on 6.5');
    return {
        item, B, calls, host, doc, click, U, BAND_TOP, timers, options,
        overlay: () => overlay,
        setNotes: (n) => { store = n.slice(); },
        push: () => (winListeners.androidsocialnotifications || []).forEach((fn) => fn({})),
        settingsChanged: () => doc.dispatch('wmSettingsChange', { detail: { keys: ['wmTodayOptions'] } }),
        bar: () => host.children.find((c) => c.classList.contains('is-bar')) || null
    };
}

const findCls = (el, cls) => { if (el.classList.contains(cls)) return el; for (const c of el.children) { const f = findCls(c, cls); if (f) return f; } return null; };
const rowsOf = (barEl) => findCls(barEl, 'wm-ti-super-notes').children.filter((c) => c.classList.contains('wm-ti-super-note'));
const heightFramesOf = (el) => el.anims.filter((a) => a.frames.some((f) => 'height' in f));

const NOTES = [
    note('d2', DISCORD, 'Discord', 'Mika', 'see you at 8', 1000, { large: '//appassets.androidplatform.net/social-image/a.png', actions: [{ index: 0, title: 'Reply', reply: true, label: 'Message #general' }, { index: 1, title: 'Mark as read', reply: false }] }),
    note('i1', INSTA, 'Instagram', 'yuki_k', 'liked your photo', 5000, { picture: '//appassets.androidplatform.net/social-image/b.jpg' }),
    note('d1', DISCORD, 'Discord', 'Rin', 'hello', 9000, { conversation: 'Night Owls', messages: [{ sender: 'Rin', text: 'hello', time: NOW - 9000 }] })
];

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1; };
const tick = () => new Promise((r) => setImmediate(r));

(async () => {

// ---------------------------------------------------------------- 1. paging by date
{
    const p = page({ notes: NOTES, options: { apps: `${DISCORD},${INSTA}` } });
    const panel = p.item.titanium();
    ok(panel.pages.length === 3, 'by date: a page per notification');
    ok(panel.pages.map((pg) => pg.noteId).join() === 'd2,i1,d1', 'by date: newest first');
    ok(panel.pages[0].title === 'Mika' && panel.pages[2].title === 'Night Owls', 'a page names the sender, or the conversation');
    ok(panel.pages[2].line2 === 'Rin: hello', "a group conversation's line names its sender");
    ok(panel.pages[0].image === NOTES[0].large && panel.pages[1].image === NOTES[1].picture, "the sender's face, else the picture");
    ok(panel.count === '3', 'the count is every social notification');
    // soft keys: named after the page's app, opening it
    ok(panel.pages.map((pg) => pg.softKey.label).join() === 'Discord,Instagram,Discord', "each page's soft key is its app's name");
    panel.pages[1].softKey.action();
    ok(p.calls.launch.length === 1 && p.calls.launch[0][0] === `${INSTA}/.Main` && p.calls.launch[0][1] === 'Instagram', 'the soft key opens its app');
    ok(panel.pages.every((pg) => pg.inPlace), 'a tap works in place (the list does not drop away for the bar)');
    // the apps went to the app at start
    ok(p.calls.setApps.length === 1 && p.calls.setApps[0] === JSON.stringify([DISCORD, INSTA]), 'the chosen apps go to the app at start');
    p.settingsChanged();
    ok(p.calls.setApps.length === 1, 'not again while they are the same');
    p.options.social.apps = INSTA;
    p.settingsChanged();
    ok(p.calls.setApps.length === 2 && p.calls.setApps[1] === JSON.stringify([INSTA]), 'a change in Options goes to the app');
    ok(p.calls.refresh.includes('social'), 'and redraws the item');
    ok(p.timers.length === 0, 'no timer');
}

// ---------------------------------------------------------------- 2. a page per app
{
    const p = page({ notes: NOTES, options: { apps: `${INSTA},${DISCORD},${SIGNAL}`, paging: 'app' }, appsInApp: [DISCORD, INSTA, SIGNAL].sort() });
    ok(p.calls.setApps.length === 0, 'the app already had this list: nothing is sent');
    const panel = p.item.titanium();
    ok(panel.pages.length === 3, 'page per app: one page per social app');
    ok(panel.pages.map((pg) => pg.pkg).join() === [INSTA, DISCORD, SIGNAL].join(), "in the Options' order");
    ok(panel.pages[1].noteId === 'd2' && /2 new/.test(panel.pages[1].line3), "an app's page is its newest notification, with how many it has");
    ok(panel.pages[2].title === 'Signal' && panel.pages[2].line2 === 'No new notifications', 'an app with none says so');
    ok(panel.pages.map((pg) => pg.softKey.label).join() === 'Instagram,Discord,Signal', 'each soft key is its app');
}

// ---------------------------------------------------------------- 3. Messaging accounts are not social apps
{
    const p = page({ notes: NOTES, options: { apps: `${DISCORD},${INSTA}` }, messaging: [DISCORD] });
    const panel = p.item.titanium();
    ok(panel.pages.every((pg) => pg.pkg === INSTA), "a Messaging account's notifications are not Social's");
    ok(p.calls.setApps[0] === JSON.stringify([INSTA]), 'nor is it sent to the app to take in');
    const choices = p.item.options.find((o) => o.key === 'apps').choices;
    const d = choices.find((c) => c[0] === DISCORD);
    ok(d && d[3] === true && /\(in Messaging\)$/.test(d[1]), 'Options offers it greyed, "(in Messaging)"');
    ok(choices.find((c) => c[0] === INSTA)[3] !== true, 'other programs can be checked');
    const paging = p.item.options.find((o) => o.key === 'paging');
    ok(paging.type === 'combo' && paging.choices.map((c) => c[1]).join('|') === 'Show all notifications by date|Page per App', 'the left / right drop-down');
}

// ---------------------------------------------------------------- 4. the bar
{
    const p = page({ notes: NOTES, options: { apps: `${DISCORD},${INSTA}` } });
    const panel = p.item.titanium();
    const d1 = panel.pages.find((pg) => pg.noteId === 'd1');
    d1.onTap();
    const bar = p.bar();
    await tick(); // the card has risen
    ok(bar, 'a tap opens the bar over Today');
    ok(p.overlay(), 'the home screen hands it the keys');
    ok(p.host.classList.contains('is-super'), 'the band is hidden under its card');
    const card = findCls(bar, 'wm-ti-super-card');
    const U = p.U;
    ok(card.style.height === `${82 * U}px`, 'the card is the band: 82 units high');
    ok(heightFramesOf(card).length === 0, 'and no frame changes its height (it does not grow)');
    const rise = card.anims[0].frames;
    ok(rise[0].transform === `translateY(${p.BAND_TOP * U}px)` && rise[1].transform === `translateY(${-9 * U}px)`, 'it rises from the band to the top');
    // its app, its notifications, the one tapped
    const sk = p.overlay().softKeys({ left: 'L' });
    // the right key is a Menu: Open App, Clear All (Yukimi, Nov 21 2026)
    ok(sk.left === 'L' && sk.right.label === 'Menu' && typeof sk.right.menu === 'function', "the bar's right key is Menu");
    const items = sk.right.menu();
    ok(items.map((x) => x.label).join() === 'Open App,Clear All', 'with Open App and Clear All');
    items[1].action();
    ok(p.calls.clear.join() === 'com.discord', "Clear All clears the bar's app");
    const rows = rowsOf(bar);
    ok(rows.map((r) => r.dataset.id).join() === 'd2,d1', "the list is the app's notifications, newest first");
    const sel = rows.filter((r) => r.classList.contains('is-sel'));
    ok(sel.length === 1 && sel[0].dataset.id === 'd1', 'the notification tapped is selected');
    const body = findCls(bar, 'wm-ti-super-body');
    ok(body.scrollTop === rows[1].offsetTop - 4 * U, 'and the list jumped to it');
    const head = findCls(bar, 'wm-ti-super-panel');
    ok(/Discord\|2 notifications/.test(head.innerHTML), "the glass shows the app and how many it has");
    ok(/Reply/.test(rows[0].innerHTML) && /Mark as read/.test(rows[0].innerHTML), 'its buttons are there');
    ok(/social-image\/a\.png/.test(rows[0].innerHTML), "the sender's face is the app's picture file");

    // left / right: the other social app
    ok(p.overlay().key({ key: 'ArrowRight', target: null }) === true, 'right pages');
    ok(/Instagram\|/.test(head.innerHTML), 'to the next app');
    ok(rowsOf(bar).map((r) => r.dataset.id).join() === 'i1', "its notifications");
    ok(/Instagram\|1 notification\|/.test(head.innerHTML), 'its name on the glass');
    p.overlay().key({ key: 'ArrowRight', target: null });
    ok(/Discord\|/.test(head.innerHTML), 'the pages go round');
    // a swipe on the glass
    const fire = (el, t, e) => (el.listeners[t] || []).forEach((fn) => fn(Object.assign({ stopPropagation() {}, preventDefault() {} }, e)));
    fire(card, 'pointerdown', { clientX: 300, clientY: 50 });
    fire(card, 'pointermove', { clientX: 300 - 23 * U, clientY: 52 });
    ok(/Instagram\|/.test(head.innerHTML), 'a swipe on the glass pages');
    p.click(card);
    ok(p.bar(), 'the click after a swipe does not put it away');
    p.overlay().key({ key: 'ArrowLeft', target: null });

    // the app's push: a new notification shows on the open bar and on the item
    p.setNotes([note('d3', DISCORD, 'Discord', 'Aoi', 'new!', 10)].concat(NOTES));
    const before = p.calls.refresh.length;
    p.push();
    ok(p.calls.refresh.length === before + 1, 'the push redraws the item');
    ok(rowsOf(bar).map((r) => r.dataset.id).join() === 'd3,d2,d1', 'and the open bar');
    ok(card.style.height === `${82 * U}px` && heightFramesOf(card).length === 0, 'the card keeps the band height');
    p.push();
    ok(p.calls.refresh.length === before + 1, 'an unchanged list draws nothing');

    // a tap on a notification fires it and puts the bar away
    const row = rowsOf(bar).find((r) => r.dataset.id === 'd2');
    const target = { dataset: { act: 'open' }, classList: { contains: () => false }, parentNode: row, listeners: {}, closest(s) { return s.includes('[data-act]') ? this : row.closest(s); } };
    p.click(target);
    ok(p.calls.open.join() === 'd2', 'a tap on a notification opens it (its content intent, in the app)');
    ok(!p.bar() && !p.overlay() && !p.host.classList.contains('is-super'), 'and the bar goes');
    ok(p.timers.length === 0, 'no timer, no request');
}

// ---------------------------------------------------------------- 5. Back closes with the band's height
{
    const p = page({ notes: NOTES, options: { apps: `${DISCORD}` } });
    p.item.titanium().pages[0].onTap();
    const bar = p.bar();
    await tick();
    const card = findCls(bar, 'wm-ti-super-card');
    const one = findCls(bar, 'wm-ti-arrow');
    ok(one.hidden === true, 'one social app: no arrows');
    ok(p.overlay().key({ key: 'Escape', target: null }) === true, 'Escape puts it away');
    ok(heightFramesOf(card).length === 0, 'closing animates no height either');
}

// ---------------------------------------------------------------- 6. the app's decision (Kotlin)
{
    const tree = process.env.DSAPP_TREE || path.join(os.homedir(), '.cache/claude-run/dsapp-social');
    const kt = path.join(tree, 'app/src/main/java/jp/net/seventhreeseven/dreamscape/SocialNotifications.kt');
    if (!fs.existsSync(kt)) console.log(`(skipped the app's half: no ${kt})`);
    else {
        const src = fs.readFileSync(kt, 'utf8');
        // mirrored only (Yukimi, Nov 21 2026: "then leave them in the notification shade")
        ok(/val leaves = false/.test(src), 'take() never takes one out of the shade');
        ok(!/cancel\(sbn\.key\)/.test(src), 'nothing posted is cleared from the shade');
        const posted = src.slice(src.indexOf('fun posted('), src.indexOf('fun removed('));
        ok(/isMessagingApp/.test(posted) && /isMessagingApp/.test(src.slice(src.indexOf('fun setApps('), src.indexOf('fun connected('))), 'a Messaging account is neither taken in nor kept as a social app');
        const setApps = src.slice(src.indexOf('fun setApps('), src.indexOf('fun connected('));
        ok(/val dropped = before - set/.test(setApps) && /entries\.remove/.test(setApps), 'an app taken out of Social drops what it stored');
        const removed = src.slice(src.indexOf('fun removed('), src.indexOf('fun list('));
        ok(/it\.inShade/.test(removed) && /entries\.remove\(key\)/.test(removed), 'it leaves Social when it leaves the shade (the app cleared it)');
    }
}

// ---------------------------------------------------------------- 7. the home screen's half (wmTitanium.js)
{
    const ti = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/wmTitanium.js'), 'utf8');
    ok(/bandBar: \(\) => bandBar\(\), setOverlay: \(o\) => setOverlay\(o\)/.test(ti), 'wmTitanium lends the band (bandBar / setOverlay)');
    ok(/if \(overlay\) \{ try \{ return overlay\.softKeys\(keys\)/.test(ti), "the bar's soft keys replace the panel's while it is up");
    // the clock's Super Bar leaves the social apps' notifications to Social (Yukimi, Nov 21 2026)
    ok(/!social\.has\(n\.package\)/.test(ti) && /window\.wmSocial\.apps\(\)/.test(ti), "the Super Bar leaves social apps out");
    ok(/if \(overlay\) \{ let done = false; try \{ done = !!overlay\.key\(e\)/.test(ti), 'it takes the keys');
    ok(/now !== 'today' && overlay\) \{ try \{ overlay\.close\(true\)/.test(ti), 'another program puts it away');
    ok(/function home\(opts\) \{\s*\/\/[^\n]*\n\s*if \(overlay\) \{ try \{ overlay\.close\(true\)/.test(ti), 'Home puts it away');
    ok(/superOpen \|\| superBusy \|\| overlay \|\|/.test(ti), 'the Super Bar never opens over it');
}

console.log(`today social: ok (${checks} checks)`);
})().catch((err) => { console.error(err); process.exit(1); });
