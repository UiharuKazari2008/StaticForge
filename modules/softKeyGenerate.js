'use strict';

/**
 * AI-generated soft key profiles (StaticForge #1414). The phone reads an Android app's own activities, link filters,
 * shortcuts and keyboard shortcuts (the DSApp bridge) and sends only that; this module asks a chat model on THIS server to
 * build the app's soft keys from it, then checks every answer itself: the model is never trusted, and no button that would do
 * nothing reaches the profile (it goes to `problems`, with its reason, and the page shows it).
 *
 * A profile is { left, center, right }, each { action, label, menu?: [{ label, action } | { label: '-', action: 'sep' }] }
 * (public/scripts/comp/wmSettingsPersonal.js skRender; DSApp SoftKeys.kt). New here: uri:<link>, an Android Intent that opens a
 * target INSIDE the app from outside (a deep link). Every kept action carries how it works (`via`):
 *   'link'    uri:  - opens the target from outside, through a deep link / intent the app declares
 *   'keys'    key:/combo: - the app is DRIVEN with key events
 *   'builtin' back, home, recents, tasks ... and the app's own program (open:android:<pkg>), do:<row>
 *
 * One model call per generation (90 s timeout, no polling, no timer left running). It does not use the Supervisor's settings or
 * its background budget. The API key and the probe's text are never logged.
 *
 * Pure parts (validateAction, link matching, buildPrompt, parseModelAnswer, assemble) run without network; the model call goes
 * through fetchFn (exports._setFetch).
 */

const os = require('os');
const path = require('path');
const keycodes = require('./androidKeycodes');

const CALL_TIMEOUT_MS = 90 * 1000;
const MAX_TOKENS = 16000;
const CAPS = { activities: 200, links: 150, shortcuts: 60, keyboardShortcuts: 60, notes: 20, routes: 10, str: 300, wish: 2000, label: 100 };
const LIMITS = { keyLabel: 24, menuLabel: 40, menuRows: 24, uri: 600 };
const SIDES = ['left', 'center', 'right'];
const SIMPLE = ['back', 'menu', 'home', 'recents', 'tasks', 'start', 'today', 'notifications', 'quicksettings', 'keyboard', 'none', 'ownmenu'];
const DO_ROWS = ['taskmanager', 'maximize', 'minimize', 'close', 'split', 'windowed', 'flashlight', 'screenshot'];
const VIA = ['link', 'keys', 'builtin'];
const PKG_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

let fetchFn = (...a) => fetch(...a);
/** Tests give a stand-in for fetch. */
function _setFetch(fn) { fetchFn = typeof fn === 'function' ? fn : ((...a) => fetch(...a)); }

// ---------------------------------------------------------------- small helpers

const clampStr = (v, n = CAPS.str) => (v == null ? '' : String(typeof v === 'object' ? '' : v)).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
const asArr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** What a key shows when its label is blank (DSApp SoftKeys.defaultLabel): '' means the key would show nothing. */
function defaultLabel(action) {
    const a = String(action || '');
    if (a === 'back') return 'Back';
    if (a === 'menu' || a === 'ownmenu') return 'Menu';
    if (a === 'home') return 'Home';
    if (a === 'recents') return 'Recent';
    if (a === 'tasks') return 'Running Programs'; // the center button is drawn as the running programs' own icon
    if (a === 'start') return 'Start';
    if (a === 'today') return 'Today';
    if (a === 'notifications') return 'Notification';
    if (a === 'quicksettings') return 'Settings';
    if (a === 'keyboard') return 'Keyboard';
    if (a.startsWith('key:')) return a.slice(4).replace(/^KEYCODE_/, '').toLowerCase();
    if (a.startsWith('combo:')) return a.slice(6).split('+').map((k) => k.replace(/^KEYCODE_/, '').toLowerCase()).join('+');
    return '';
}

// ---------------------------------------------------------------- the probe (what the phone read)

const asList = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));

/** The probe as received, tolerant and capped: at most 200 activities, 150 links, 60 shortcuts, 60 keyboard shortcuts, strings of 300 characters. */
function sanitizeProbe(raw, pkgFallback) {
    const p = isObj(raw) ? raw : {};
    const out = {
        pkg: clampStr(p.pkg || pkgFallback, 200),
        label: clampStr(p.label, CAPS.label),
        versionName: clampStr(p.versionName, 60),
        routes: asArr(p.routes).slice(0, CAPS.routes).filter(isObj).map((r) => ({ route: clampStr(r.route, 40), ok: r.ok === true, error: clampStr(r.error, 160) })),
        activities: asArr(p.activities).slice(0, CAPS.activities).map((a) => (isObj(a)
            ? { name: clampStr(a.name, 200), exported: a.exported === true, label: clampStr(a.label, 80) }
            : { name: clampStr(a, 200), exported: false, label: '' })).filter((a) => a.name),
        links: [],
        shortcuts: asArr(p.shortcuts).slice(0, CAPS.shortcuts).filter(isObj).map((s) => ({
            id: clampStr(s.id, 120), shortLabel: clampStr(s.shortLabel, 80), longLabel: clampStr(s.longLabel, 120), intent: clampStr(s.intent, CAPS.str)
        })),
        keyboardShortcuts: asArr(p.keyboardShortcuts).slice(0, CAPS.keyboardShortcuts).filter(isObj).map((k) => ({ label: clampStr(k.label, 120), keys: clampStr(k.keys, 80) })),
        notes: asArr(p.notes).slice(0, CAPS.notes).map((n) => clampStr(n, CAPS.str)).filter(Boolean)
    };
    // a link record may list several schemes / hosts: one row each, the 150 cap counting rows
    for (const l of asArr(p.links)) {
        if (!isObj(l)) continue;
        const schemes = asList(l.scheme).map((s) => clampStr(s, 60).toLowerCase().replace(/:$/, '')).slice(0, 6);
        const hosts = asList(l.host).map((s) => clampStr(s, 200).toLowerCase().replace(/:\d+$/, '')).slice(0, 6);
        const base = {
            activity: clampStr(l.activity, 200),
            actions: asList(l.actions).map((a) => clampStr(a, 200)).filter(Boolean).slice(0, 10),
            path: clampStr(l.path), pathPrefix: clampStr(l.pathPrefix), pathPattern: clampStr(l.pathPattern),
            pathAdvancedPattern: clampStr(l.pathAdvancedPattern), pathSuffix: clampStr(l.pathSuffix),
            intent: clampStr(l.intent)
        };
        for (const scheme of (schemes.length ? schemes : [''])) {
            for (const host of (hosts.length ? hosts : [''])) {
                if (out.links.length >= CAPS.links) break;
                out.links.push(Object.assign({ scheme, host }, base));
            }
        }
        if (out.links.length >= CAPS.links) break;
    }
    return out;
}

// ---------------------------------------------------------------- link matching

/** Android's pathPattern: a simple glob where . is any one character and * repeats the character before it (".*" is anything). */
function globToRegExp(glob) {
    let re = '';
    const s = String(glob);
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\' && i + 1 < s.length) { re += s[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
        if (c === '.' || c === '*') { re += c; continue; }
        re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`);
}

const hostMatches = (linkHost, uriHost) => {
    const lh = String(linkHost || '').toLowerCase();
    if (!lh || lh === '*') return true;
    const uh = String(uriHost || '').toLowerCase();
    if (lh.startsWith('*.')) return uh.endsWith(lh.slice(1)) && uh.length > lh.length - 1;
    return lh === uh;
};

/** Does the path satisfy the link's path rule (any of path / pathPrefix / pathPattern / pathAdvancedPattern / pathSuffix; none = any path)? */
function pathMatches(link, uriPath) {
    const rules = ['path', 'pathPrefix', 'pathPattern', 'pathAdvancedPattern', 'pathSuffix'].filter((k) => link[k]);
    if (!rules.length) return true;
    let p = String(uriPath || '/');
    try { p = decodeURI(p); } catch (_) { /* keep as written */ }
    return rules.some((k) => {
        try {
            if (k === 'path') return p === link.path;
            if (k === 'pathPrefix') return p.startsWith(link.pathPrefix);
            if (k === 'pathSuffix') return p.endsWith(link.pathSuffix);
            if (k === 'pathPattern') return globToRegExp(link.pathPattern).test(p);
            return new RegExp(`^(?:${link.pathAdvancedPattern})$`).test(p);
        } catch (_) { return false; }
    });
}

/** Is { scheme, host, path } accepted by some link filter of the probe? Returns the link or null. */
function matchLink(links, scheme, host, uriPath) {
    return asArr(links).find((l) => {
        const ls = String(l.scheme || '').toLowerCase();
        if (ls) { if (ls !== scheme) return false; } else {
            // a filter with no scheme and no host is an action-only filter: no link reaches it. One with a host but no scheme
            // (the phone read it loosely) is taken as the web schemes
            if (!l.host || (scheme !== 'https' && scheme !== 'http')) return false;
        }
        return hostMatches(l.host, host) && pathMatches(l, uriPath);
    }) || null;
}

// ---------------------------------------------------------------- uri: parsing and checking

const DENIED_SCHEMES = /^(javascript|file|content|data|market|http|ftp|mailto|tel|sms|vnd\.android\.cursor\.[a-z.]+):/i;
const INTENT_KEYS = ['action', 'category', 'scheme', 'package', 'type'];
const CATEGORIES = ['android.intent.category.BROWSABLE', 'android.intent.category.DEFAULT'];
const ACTION_RE = /^[A-Za-z][A-Za-z0-9_.]{0,199}$/;

/** { ok, reason } or { ok: true, kind, scheme, host, path, action, pkg } for a uri: body. Never throws. */
function parseLink(raw, pkg) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return { ok: false, reason: 'the link is empty' };
    if (s.length > LIMITS.uri) return { ok: false, reason: `the link is longer than ${LIMITS.uri} characters` };
    if (/[\s\u0000-\u001f\u007f]/.test(s)) return { ok: false, reason: 'a link cannot contain spaces or control characters' };
    if (DENIED_SCHEMES.test(s)) return { ok: false, reason: `links of that kind (${s.split(':')[0].toLowerCase()}:) are never allowed; only intent: or https:` };
    if (/^https:/i.test(s)) {
        let u;
        try { u = new URL(s); } catch (_) { return { ok: false, reason: 'the https link does not parse' }; }
        if (u.protocol !== 'https:' || !u.hostname) return { ok: false, reason: 'the https link has no host' };
        if (u.username || u.password) return { ok: false, reason: 'an https link cannot carry a user name or password' };
        return { ok: true, kind: 'https', scheme: 'https', host: u.hostname.toLowerCase(), path: u.pathname || '/', action: '', pkg: '' };
    }
    if (!/^intent:/i.test(s)) return { ok: false, reason: 'a link must start with intent: or https:' };
    if (/component=/i.test(s)) return { ok: false, reason: 'an intent link cannot name a component (component=)' };
    const body = s.slice(7);
    const at = body.indexOf('#Intent;');
    if (at < 0) return { ok: false, reason: 'not an Android intent link (the form is intent://host/path#Intent;scheme=https;package=<pkg>;end)' };
    const head = body.slice(0, at);
    const tail = body.slice(at + 8).split(';');
    if (tail[tail.length - 1] !== 'end') return { ok: false, reason: 'the intent link does not end with ;end' };
    tail.pop();
    const kv = {};
    for (const part of tail) {
        if (!part) continue;
        if (part === 'SEL' || /^SEL[.=]/.test(part)) return { ok: false, reason: 'an intent link cannot carry a selector (SEL;)' };
        const eq = part.indexOf('=');
        const key = eq < 0 ? part : part.slice(0, eq);
        if (eq < 0 || !INTENT_KEYS.includes(key)) return { ok: false, reason: `the intent part "${key.slice(0, 30)}" is not allowed (only ${INTENT_KEYS.join(', ')})` };
        if (key in kv) return { ok: false, reason: `the intent names ${key} twice` };
        kv[key] = part.slice(eq + 1);
    }
    if (!kv.package) return { ok: false, reason: `the intent must carry package=${pkg || '<the app package>'}` };
    if (pkg && kv.package !== pkg) return { ok: false, reason: `the intent targets another package (${kv.package.slice(0, 60)}), not ${pkg}` };
    if (kv.category && !CATEGORIES.includes(kv.category)) return { ok: false, reason: `the intent category ${kv.category.slice(0, 60)} is not allowed` };
    if (kv.action && !ACTION_RE.test(kv.action)) return { ok: false, reason: 'the intent action is not a valid action name' };
    let host = '';
    let uriPath = '';
    if (head) {
        if (!head.startsWith('//')) return { ok: false, reason: 'the intent data must be written //host/path' };
        const rest = head.slice(2);
        const end = rest.search(/[/?]/);
        const hostPart = end < 0 ? rest : rest.slice(0, end);
        host = hostPart.toLowerCase().replace(/:\d+$/, '');
        const afterHost = end < 0 ? '' : rest.slice(end);
        uriPath = afterHost.split('?')[0] || '/';
        if (!host) return { ok: false, reason: 'the intent data has no host' };
        if (/[@]/.test(hostPart)) return { ok: false, reason: 'the intent data cannot carry a user name' };
        if (!kv.scheme) return { ok: false, reason: 'an intent link with a host needs scheme= (scheme=https)' };
    }
    if (kv.scheme && !/^[a-z][a-z0-9+.-]{0,40}$/i.test(kv.scheme)) return { ok: false, reason: 'the intent scheme is not valid' };
    if (!head && !kv.action) return { ok: false, reason: 'the intent has neither data (//host/path) nor an action' };
    return { ok: true, kind: 'intent', scheme: (kv.scheme || '').toLowerCase(), host, path: uriPath, action: kv.action || '', pkg: kv.package };
}

/** { ok, why? , reason? } for a parsed link against what the phone read. */
function checkLinkAgainstProbe(parsed, probe) {
    const links = asArr(probe && probe.links);
    const shortcuts = asArr(probe && probe.shortcuts);
    const hasData = !!parsed.host;
    // a shortcut the app publishes names this target itself
    const viaShortcut = shortcuts.find((sc) => sc.intent && (hasData ? sc.intent.includes(`${parsed.host}${parsed.path === '/' ? '' : parsed.path}`) : (parsed.action && sc.intent.includes(parsed.action))));
    if (!links.length) {
        if (viaShortcut) return { ok: true, why: `matches the app's own shortcut "${viaShortcut.shortLabel || viaShortcut.id}"` };
        return { ok: true, why: 'unverified: the phone read no link filters' };
    }
    if (hasData) {
        const l = matchLink(links, parsed.scheme, parsed.host, parsed.path);
        if (l) return { ok: true, why: `the app declares this link (${l.activity ? l.activity.split('.').pop() : 'a filter'}: ${l.scheme || '*'}://${l.host || '*'}${l.path || l.pathPrefix || l.pathPattern || ''})` };
        if (viaShortcut) return { ok: true, why: `matches the app's own shortcut "${viaShortcut.shortLabel || viaShortcut.id}"` };
        return { ok: false, reason: `the app declares no link filter for this host/path (${parsed.host}${parsed.path === '/' ? '' : parsed.path})` };
    }
    const act = links.find((l) => asArr(l.actions).includes(parsed.action));
    if (act) return { ok: true, why: `the app declares the action ${parsed.action}` };
    if (viaShortcut) return { ok: true, why: `matches the app's own shortcut "${viaShortcut.shortLabel || viaShortcut.id}"` };
    return { ok: false, reason: `the app declares no intent filter for the action ${parsed.action}` };
}

// ---------------------------------------------------------------- one action

/**
 * { ok, via, action, reason?, note? } for one action string. `probe` is what the phone read (null: nothing); opts.pkg the target
 * app, opts.menu true for a menu row (no 'ownmenu' inside a menu). `action` comes back as it will be saved.
 */
function validateAction(action, probe, opts = {}) {
    const o = opts || {};
    const pkg = o.pkg || (probe && probe.pkg) || '';
    const a = String(action == null ? '' : action).trim();
    const bad = (reason) => ({ ok: false, via: '', action: a, reason });
    if (!a) return bad('no action');
    if (a.length > 700) return bad('the action is too long');
    if (a === 'none') return bad('"none" does nothing; a key that does nothing is never saved');
    if (a === 'sep') return bad('a divider is not an action');
    if (SIMPLE.includes(a)) {
        if (a === 'ownmenu' && o.menu) return bad('a menu row cannot open a menu');
        return { ok: true, via: 'builtin', action: a };
    }
    if (a.startsWith('open:')) {
        const id = a.slice(5);
        const own = `android:${pkg}`;
        if (pkg && (id === own || id.startsWith(`${own}/`)) && /^android:[A-Za-z0-9_.$@/]{1,250}$/.test(id)) return { ok: true, via: 'builtin', action: a };
        return bad(pkg ? `open: is only for this app's own program (android:${pkg}); program ids are not invented` : 'open: needs the app package');
    }
    if (a.startsWith('do:')) {
        const row = a.slice(3);
        return DO_ROWS.includes(row) ? { ok: true, via: 'builtin', action: a } : bad(`do:${row.slice(0, 30)} is not a known row (${DO_ROWS.join(', ')})`);
    }
    if (a.startsWith('key:')) {
        const name = a.slice(4).trim();
        if (!name) return bad('key: names no key');
        const code = keycodes.keyCode(name);
        if (code == null) return bad(`${name.slice(0, 50)} is not an Android KEYCODE name`);
        if (keycodes.isBlocked(name)) return bad(`${keycodes.nameOf(code)} would lock, power off the phone or end a call`);
        return { ok: true, via: 'keys', action: /^\d+$/.test(name) ? `key:${code}` : `key:${keycodes.nameOf(code)}` };
    }
    if (a.startsWith('combo:')) {
        const names = a.slice(6).split('+').map((x) => x.trim());
        if (names.length < 2 || names.length > 5 || names.some((x) => !x)) return bad('a combo is 2 to 5 keys joined with +');
        const out = [];
        for (const n of names) {
            const code = keycodes.keyCode(n);
            if (code == null) return bad(`${n.slice(0, 50)} is not an Android KEYCODE name`);
            if (keycodes.isBlocked(n)) return bad(`${keycodes.nameOf(code)} would lock, power off the phone or end a call`);
            out.push(/^\d+$/.test(n) ? String(code) : keycodes.nameOf(code));
        }
        return { ok: true, via: 'keys', action: `combo:${out.join('+')}` };
    }
    if (a.startsWith('uri:')) {
        const p = parseLink(a.slice(4), pkg);
        if (!p.ok) return bad(p.reason);
        const chk = checkLinkAgainstProbe(p, probe);
        if (!chk.ok) return bad(chk.reason);
        // a plain https link goes to whatever handler Android picks (a browser when the app is not the verified one); written as an
        // intent link that names the app it opens in the app, and the stored action says so
        let link = a.slice(4).trim();
        if (p.kind === 'https' && pkg && !/#/.test(link)) {
            const rest = link.slice('https://'.length);
            const asIntent = `intent://${rest}#Intent;scheme=https;package=${pkg};end`;
            if (asIntent.length <= LIMITS.uri && parseLink(asIntent, pkg).ok) link = asIntent;
        }
        return { ok: true, via: 'link', action: `uri:${link}`, note: chk.why };
    }
    return bad(`"${a.slice(0, 40)}" is not an action the soft keys know`);
}

// ---------------------------------------------------------------- the profile

const isSepRow = (r) => !isObj(r) ? false : (r.sep === true || r.action === 'sep' || (r.label === '-' && !r.action));
const labelOf = (v, n) => clampStr(v, 400).slice(0, n);

/**
 * Checks the model's { left, center, right } (each { action, label, why, menu? }) and the unmapped list, and builds the answer's
 * { profile, items, problems }. ctx: { probe, pkg, design, unmapped }. Never throws.
 * menuIndex is the row's index in the menu as it was written (the design's in the pre-design way, else the model's);
 * an item also carries profileIndex, its index in the saved menu.
 */
function assemble(raw, ctx = {}) {
    const probe = ctx.probe || null;
    const pkg = ctx.pkg || (probe && probe.pkg) || '';
    const design = isObj(ctx.design) ? ctx.design : null;
    const model = isObj(raw) ? raw : {};
    const unmapped = new Map();
    const unmappedList = asArr(ctx.unmapped).filter(isObj).map((u) => ({ label: labelOf(u.label, 80), reason: clampStr(u.reason, 240) || 'the AI could not map it' })).filter((u) => u.label);
    unmappedList.forEach((u) => { if (!unmapped.has(norm(u.label))) unmapped.set(norm(u.label), u.reason); });
    const profile = {};
    const items = [];
    const problems = [];
    const seenLabels = new Set(); // labels already shown as an item or a problem (the unmapped list adds only new ones)
    const seen = (label) => { if (label) seenLabels.add(norm(label)); };

    for (const side of SIDES) {
        const m = isObj(model[side]) ? model[side] : null;
        const d = design && isObj(design[side]) ? design[side] : null;
        const dLabel = d && d.label != null ? labelOf(d.label, 200) : '';
        const sideItems = [];
        const sideProblems = [];
        const sidePush = (list, row) => list.push(Object.assign({ side }, row));
        let key = null;

        // the key's own label: hers in the pre-design way, else the model's
        let keyLabel = dLabel || labelOf(m && m.label, 200);
        let menuSrc = [];
        let designRows = false;
        if (d && asArr(d.menu).length) { menuSrc = asArr(d.menu).slice(0, 200); designRows = true; } else if (m) menuSrc = asArr(m.menu).slice(0, 200);
        const hasMenu = menuSrc.some((r) => !isSepRow(r) && isObj(r) && (r.label || r.action));
        const modelRows = asArr(m && m.menu).filter(isObj);
        const usedModelRows = new Set();

        if (hasMenu) {
            const kept = [];
            menuSrc.forEach((src, i) => {
                if (isSepRow(src)) { kept.push({ sep: true, i }); return; }
                if (!isObj(src)) { sidePush(sideProblems, { menuIndex: i, label: '', action: '', reason: 'the menu row is not an entry' }); return; }
                const label = labelOf(src.label, 200);
                let rowAction = src.action;
                let why = src.why;
                if (designRows) {
                    // her label is the entry; the model's row with the same label tells the action
                    const at = modelRows.findIndex((r, j) => !usedModelRows.has(j) && norm(r.label) === norm(label));
                    if (at >= 0) { usedModelRows.add(at); rowAction = modelRows[at].action; why = modelRows[at].why; } else rowAction = '';
                }
                if (!label && !designRows) { sidePush(sideProblems, { menuIndex: i, label: '', action: String(rowAction || ''), reason: 'the menu row has no label' }); return; }
                if (!rowAction) {
                    sidePush(sideProblems, { menuIndex: i, label: label.slice(0, LIMITS.menuLabel), action: '', reason: unmapped.get(norm(label)) || 'the AI gave no action for this label' });
                    seen(label);
                    return;
                }
                if (kept.filter((k) => !k.sep).length >= LIMITS.menuRows) {
                    sidePush(sideProblems, { menuIndex: i, label: label.slice(0, LIMITS.menuLabel), action: String(rowAction), reason: `a menu holds at most ${LIMITS.menuRows} rows` });
                    seen(label);
                    return;
                }
                const v = validateAction(rowAction, probe, { pkg, menu: true });
                if (!v.ok) { sidePush(sideProblems, { menuIndex: i, label: label.slice(0, LIMITS.menuLabel), action: String(rowAction).slice(0, 700), reason: v.reason }); seen(label); return; }
                if (opensWrongScreen(label, v.action, ctx.appLabel)) { sidePush(sideProblems, { menuIndex: i, label: label.slice(0, LIMITS.menuLabel), action: v.action, reason: `no link or shortcut of the app reaches "${label.slice(0, 40)}": the only action found just starts the app on its own screen` }); seen(label); return; }
                if (!label && !defaultLabel(v.action)) { sidePush(sideProblems, { menuIndex: i, label: '', action: v.action, reason: 'the row would show no text: it needs a label' }); return; }
                const shown = (label || defaultLabel(v.action)).slice(0, LIMITS.menuLabel);
                const cut = (label || '').length > LIMITS.menuLabel ? ` (label shortened to ${LIMITS.menuLabel} characters)` : '';
                kept.push({ i, label: shown, action: v.action, via: v.via, why: whyText(v, why) + cut });
                seen(label);
            });
            // dividers: none at the ends, never two in a row
            const rows = [];
            kept.forEach((r) => {
                if (r.sep) { if (rows.length && !rows[rows.length - 1].sep) rows.push(r); return; }
                rows.push(r);
            });
            while (rows.length && rows[rows.length - 1].sep) rows.pop();
            const real = rows.filter((r) => !r.sep);
            if (!real.length) {
                sidePush(sideProblems, { menuIndex: null, label: keyLabel.slice(0, LIMITS.keyLabel), action: 'ownmenu', reason: 'every row of the menu was rejected, so the key has nothing to open' });
            } else {
                const menu = [];
                rows.forEach((r) => {
                    if (r.sep) { menu.push({ label: '-', action: 'sep' }); return; }
                    sidePush(sideItems, { menuIndex: r.i, profileIndex: menu.length, label: r.label, action: r.action, via: r.via, why: r.why });
                    menu.push({ label: r.label, action: r.action });
                });
                key = { action: 'ownmenu', label: keyLabel.slice(0, LIMITS.keyLabel), menu };
                const cut = keyLabel.length > LIMITS.keyLabel ? ` (label shortened to ${LIMITS.keyLabel} characters)` : '';
                sidePush(sideItems, { menuIndex: null, label: key.label || 'Menu', action: 'ownmenu', via: 'builtin', why: `opens this key's own menu${cut}` });
                seen(keyLabel);
            }
        } else {
            const action = m ? String(m.action == null ? '' : m.action).trim() : '';
            if (!action) {
                if (side === 'center' && !dLabel) {
                    // the default, with nothing asked for
                    key = { action: 'tasks', label: '' };
                    sidePush(sideItems, { menuIndex: null, label: 'Running Programs', action: 'tasks', via: 'builtin', why: 'the default for the center button' });
                } else {
                    sidePush(sideProblems, { menuIndex: null, label: keyLabel.slice(0, LIMITS.keyLabel), action: '', reason: unmapped.get(norm(keyLabel)) || (m ? 'the AI gave no action for this key' : 'the AI gave no key for this side') });
                    seen(keyLabel);
                }
            } else if (action === 'ownmenu') {
                sidePush(sideProblems, { menuIndex: null, label: keyLabel.slice(0, LIMITS.keyLabel), action, reason: 'ownmenu with no menu rows opens nothing' });
                seen(keyLabel);
            } else {
                const v = validateAction(action, probe, { pkg });
                if (!v.ok) { sidePush(sideProblems, { menuIndex: null, label: keyLabel.slice(0, LIMITS.keyLabel), action: action.slice(0, 700), reason: v.reason }); seen(keyLabel); } else if (opensWrongScreen(keyLabel, v.action, ctx.appLabel)) {
                    sidePush(sideProblems, { menuIndex: null, label: keyLabel.slice(0, LIMITS.keyLabel), action: v.action, reason: `no link or shortcut of the app reaches "${keyLabel.slice(0, 40)}": the only action found just starts the app on its own screen` });
                    seen(keyLabel);
                } else if (!keyLabel && !defaultLabel(v.action)) {
                    sidePush(sideProblems, { menuIndex: null, label: '', action: v.action, reason: 'the key would show no text: it needs a label' });
                } else {
                    const cut = keyLabel.length > LIMITS.keyLabel ? ` (label shortened to ${LIMITS.keyLabel} characters)` : '';
                    key = { action: v.action, label: keyLabel.slice(0, LIMITS.keyLabel) };
                    sidePush(sideItems, { menuIndex: null, label: key.label || defaultLabel(v.action), action: v.action, via: v.via, why: whyText(v, m && m.why) + cut });
                    seen(keyLabel);
                }
            }
        }

        // the center button is never left empty: its default stays when what was asked failed (the problem is reported)
        if (!key && side === 'center') {
            key = { action: 'tasks', label: '' };
            sidePush(sideItems, { menuIndex: null, label: 'Running Programs', action: 'tasks', via: 'builtin', why: 'the default for the center button (what was asked for could not be used)' });
        }
        if (key) { profile[side] = key; items.push(...sideItems); }
        problems.push(...sideProblems);
    }

    // what the model said it could not map: kept in the answer, never dropped
    for (const u of unmappedList) {
        if (seenLabels.has(norm(u.label))) continue;
        problems.push({ side: '', menuIndex: null, label: u.label.slice(0, LIMITS.menuLabel), action: '', reason: u.reason });
    }
    return { profile, items, problems };
}

/**
 * open:android:<pkg> starts the app on whatever it shows: it is the right action for "Home" or "Open <app>", never for another
 * screen (Subscriptions, History). A label that names another screen is a problem, not a button that only starts the app.
 */
function opensWrongScreen(label, action, appLabel) {
    if (!String(action || '').startsWith('open:')) return false;
    const l = norm(label);
    if (!l) return false;
    if (/^(home|start|open|launch|main|app|program)\b/.test(l) || /\b(open|launch|start)\b/.test(l)) return false;
    const a = norm(appLabel);
    return !(a && l === a);
}

function whyText(v, modelWhy) {
    const w = clampStr(modelWhy, 300).replace(/[.;\s]+$/, '');
    const parts = [];
    if (w) parts.push(w);
    else if (v.via === 'keys') parts.push('drives the app with key events: no link or built-in action reaches it');
    if (v.note) parts.push(v.note);
    return parts.join('; ');
}

/** The model's { left, center, right } checked as a profile: { profile, items, problems }. */
function validateProfile(raw, probe, opts = {}) {
    const o = opts || {};
    return assemble(raw, { probe, pkg: o.pkg || (probe && probe.pkg) || '', design: o.design || null, unmapped: isObj(raw) ? raw.unmapped : [], appLabel: o.appLabel || '' });
}

// ---------------------------------------------------------------- the prompt

const GRAMMAR = [
    'back, menu (the global Soft Key Menu), home, recents, tasks (running programs), start, today, notifications, quicksettings, keyboard (show/hide), none (never use it: a key that does nothing is rejected), ownmenu (this key opens its own menu)',
    'open:android:<package> (ONLY this app\'s own package, never invent program ids; it just STARTS the app on its own screen: use it only for Home or Open <app>, never for another screen)',
    `do:${DO_ROWS.join(' | do:')}`,
    'key:KEYCODE_X (one real android.view.KeyEvent name written in full upper case, e.g. key:KEYCODE_ESCAPE; the app is DRIVEN with that key event)',
    'combo:KEYCODE_A+KEYCODE_B (2 to 5 real KEYCODE names, modifiers first, e.g. combo:KEYCODE_CTRL_LEFT+KEYCODE_F)',
    'uri:<link> (opens a target INSIDE the app from outside: a deep link)'
];

/** The facts the phone read, as short lines (the model needs the shape, not every word). */
function probeText(probe) {
    const L = [];
    const routes = asArr(probe.routes).map((r) => `${r.route}:${r.ok ? 'ok' : `failed${r.error ? ` (${r.error})` : ''}`}`).join(', ');
    L.push(`Read by the phone through: ${routes || 'unknown'}`);
    if (probe.versionName) L.push(`Version: ${probe.versionName}`);
    L.push(`Activities (${probe.activities.length}; x = exported):`);
    probe.activities.forEach((a) => L.push(`- ${a.name.startsWith(`${probe.pkg}.`) ? a.name.slice(probe.pkg.length) : a.name}${a.exported ? ' x' : ''}${a.label ? ` "${a.label}"` : ''}`));
    L.push(`Link filters (${probe.links.length}):`);
    probe.links.forEach((l) => {
        const path = [l.path && `path=${l.path}`, l.pathPrefix && `pathPrefix=${l.pathPrefix}`, l.pathPattern && `pathPattern=${l.pathPattern}`, l.pathAdvancedPattern && `pathRegex=${l.pathAdvancedPattern}`, l.pathSuffix && `pathSuffix=${l.pathSuffix}`].filter(Boolean).join(' ');
        L.push(`- ${l.scheme || '*'}://${l.host || '*'} ${path} actions=[${l.actions.join(',')}] activity=${l.activity || '?'}${l.intent ? ` intent=${l.intent}` : ''}`);
    });
    L.push(`Shortcuts the app publishes (${probe.shortcuts.length}):`);
    probe.shortcuts.forEach((s) => L.push(`- ${s.id}: "${s.shortLabel}"${s.longLabel ? ` / "${s.longLabel}"` : ''}${s.intent ? ` intent=${s.intent}` : ''}`));
    L.push(`Keyboard shortcuts the app declares (${probe.keyboardShortcuts.length}):`);
    probe.keyboardShortcuts.forEach((k) => L.push(`- ${k.label}: ${k.keys}`));
    if (probe.notes.length) { L.push('Notes from the phone:'); probe.notes.forEach((n) => L.push(`- ${n}`)); }
    return L.join('\n');
}

function designText(design) {
    const L = [];
    SIDES.forEach((side) => {
        const d = design && design[side];
        if (!isObj(d)) return;
        L.push(`${side}: "${labelOf(d.label, 200)}"`);
        asArr(d.menu).slice(0, 60).forEach((r, i) => L.push(isSepRow(r) ? `  [${i}] (divider)` : `  [${i}] "${labelOf(r && r.label, 200)}"`));
    });
    return L.join('\n');
}

/** { system, user } for one generation. `probe` must be sanitized (sanitizeProbe). */
function buildPrompt({ pkg, label, probe, wish, design }) {
    const hasDesign = isObj(design) && SIDES.some((s) => isObj(design[s]) && (design[s].label || asArr(design[s].menu).length));
    const system = [
        'You build the soft keys of one Android app for the Melaton Mobile soft key bar. Answer with one JSON object and nothing else.',
        '',
        'A soft key bar has three keys: left, center, right. Each key does one ACTION, and a key whose action is ownmenu opens a menu of rows, each row its own ACTION.',
        '',
        'The allowed ACTIONS, exactly:',
        ...GRAMMAR.map((g) => `- ${g}`),
        '',
        'Rules:',
        '- Prefer a uri: deep link whenever the app declares a link filter that reaches the target. A uri: must be an Android intent link of the form',
        `  intent://<host><path>#Intent;scheme=https;package=${pkg};end   (or, for a target reached by a custom action, intent:#Intent;action=<action>;package=${pkg};end)`,
        '  or an https:// URL. Its scheme, host and path must be accepted by a link filter in "Link filters" below (an intent link also needs package=' + pkg + '). Never use component=, extras, SEL; or any other package.',
        '- You may use your own knowledge of the app ONLY for URL patterns (which path opens which screen); every link is then checked against the link filters, and one the app does not declare is rejected.',
        '- A target that no link reaches and that is only reachable by driving the app must be key: or combo: (for example a keyboard shortcut the app declares) with an honest "why" saying so. Never guess a key.',
        '- If you cannot map an entry to a real action, do NOT guess: put it in "unmapped" with the reason. An unmapped entry is shown to the user; a guessed action that does nothing is worse.',
        '- A key with a menu has action "ownmenu". A menu row never has action ownmenu. A divider in a menu is { "sep": true }. A menu has at most 24 rows.',
        '- Key labels are at most 24 characters, menu row labels at most 40. Labels are short, in English, the screen\'s own name (Home, Shorts, Subscriptions).',
        '- The center button is { "action": "tasks", "label": "" } unless the request asks for something else.',
        '- "why" is one short honest sentence: how the action reaches the target.',
        hasDesign
            ? '- PRE-DESIGN: the user wrote the key labels and the menu entries first. Keep every label exactly as written, in the same order, and find the matching action for each. Answer every written label either with an action or in "unmapped".'
            : '- Choose the keys and menu that serve this app best (what a person reaches for most): usually a left key for the most used screen and a right key with a menu of the app\'s main screens.',
        '',
        'The JSON answer:',
        '{ "left": { "action": "...", "label": "...", "why": "..." },',
        '  "center": { "action": "tasks", "label": "", "why": "..." },',
        '  "right": { "action": "ownmenu", "label": "...", "why": "...", "menu": [ { "label": "...", "action": "...", "why": "..." }, { "sep": true } ] },',
        '  "unmapped": [ { "label": "...", "reason": "..." } ],',
        '  "notes": "optional text for the user" }'
    ].join('\n');
    const user = [
        `App: ${clampStr(label, CAPS.label) || pkg} (package ${pkg})`,
        '',
        'What the phone read from the app itself:',
        probeText(probe),
        '',
        hasDesign ? `The user's design (labels she wrote first; find the actions):\n${designText(design)}\n` : '',
        wishText(wish),
        'Answer with the JSON object only.'
    ].filter((x) => x !== '').join('\n');
    return { system, user };
}

const wishText = (wish) => { const w = clampStr(wish, CAPS.wish); return w ? `The user's request: ${w}\n` : ''; };

// ---------------------------------------------------------------- the model's answer

/** The JSON object in the model's text: plain, fenced (```json) or with text around it; null when there is none. */
function parseModelAnswer(text) {
    let s = String(text == null ? '' : text);
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
    const tryParse = (t) => { try { const v = JSON.parse(t); return isObj(v) ? v : null; } catch (_) { return null; } };
    const direct = tryParse(s.trim());
    if (direct) return direct;
    const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
    let f;
    while ((f = fence.exec(s))) { const v = tryParse(f[1].trim()); if (v) return v; }
    // the first balanced { ... } (strings respected)
    for (let start = s.indexOf('{'); start >= 0; start = s.indexOf('{', start + 1)) {
        let depth = 0;
        let inStr = false;
        for (let i = start; i < s.length; i++) {
            const c = s[i];
            if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
            if (c === '"') inStr = true;
            else if (c === '{') depth++;
            else if (c === '}' && --depth === 0) { const v = tryParse(s.slice(start, i + 1)); if (v) return v; break; }
        }
    }
    return null;
}

// ---------------------------------------------------------------- engines

const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
const supervisor = () => require('./agentSupervisor');
let engineSource = null;
/** Tests give the engine rows ({ id, name, defaultModel, ready }); the server uses the Director's list (agentSupervisor.engines). */
function _setEngineSource(fn) { engineSource = typeof fn === 'function' ? fn : null; }
const engineRows = (gr) => (engineSource ? engineSource(gr) : supervisor().engines(gr));
const tokenRouterDefaultModel = () => { try { return supervisor().DEFAULT_MODEL || 'deepseek/deepseek-v4.1-flash'; } catch (_) { return 'deepseek/deepseek-v4.1-flash'; } };

const engineId = (v) => String(v || '').trim().replace(/^custom:/, '');

/** Is the custom provider row DeepSeek's own API (api.deepseek.com)? */
function isDeepSeekRow(gr, id) {
    try { const row = require('./customModelProviders').lookup(gr, id); return !!(row && row.kind === 'deepseek'); } catch (_) { return false; }
}

/**
 * Yukimi's saved default ({ engine, model }, config key softKeyGen) when its engine still exists, else DeepSeek: a ready direct
 * DeepSeek provider (customModelProviders kind 'deepseek'), else TokenRouter with its DeepSeek default model, else a ready
 * provider whose default model is a DeepSeek one, else the first ready engine ('' / '' when none is ready).
 */
function resolveDefault(gr) {
    const rows = engineRows(gr);
    let saved = null;
    try { const c = gr && gr.getConfig && gr.getConfig(); saved = c && isObj(c.softKeyGen) ? c.softKeyGen : null; } catch (_) { saved = null; }
    if (saved && saved.engine) {
        const row = rows.find((r) => r.id === engineId(saved.engine));
        if (row) return { engine: row.id, model: clampStr(saved.model, 200) || row.defaultModel || '', isSaved: true };
    }
    const ready = rows.filter((r) => r.ready);
    const ds = ready.find((r) => r.id !== 'tokenrouter' && isDeepSeekRow(gr, r.id));
    if (ds) return { engine: ds.id, model: ds.defaultModel || 'deepseek-chat', isSaved: false };
    const tr = ready.find((r) => r.id === 'tokenrouter');
    if (tr) return { engine: tr.id, model: tr.defaultModel || tokenRouterDefaultModel(), isSaved: false };
    const dsModel = ready.find((r) => /deepseek/i.test(r.defaultModel || ''));
    if (dsModel) return { engine: dsModel.id, model: dsModel.defaultModel, isSaved: false };
    const first = ready[0];
    return first ? { engine: first.id, model: first.defaultModel || '', isSaved: false } : { engine: '', model: '', isSaved: false };
}

/** Model ids of one engine from the catalogs the Director already keeps (a stale one is fetched again, at most once in 10 minutes). */
async function modelsOf(gr, row) {
    const guard = (p) => new Promise((resolve) => {
        const t = setTimeout(() => resolve([]), 8000);
        if (t.unref) t.unref();
        Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve([]); });
    });
    if (!row.ready) return [];
    try {
        let families;
        if (row.id === 'tokenrouter') {
            families = await guard(require('./tokenRouterBridge').listModels({ cacheFile: path.join(os.homedir(), '.cache', 'dreamscape-director', 'tokenrouter-models.json') }));
        } else {
            families = await guard(require('./customModelProviders').listModels(gr, row.id));
        }
        const ids = asArr(families).map((f) => clampStr(f && f.id, 200)).filter(Boolean);
        return Array.from(new Set(ids)).slice(0, 400);
    } catch (_) { return []; }
}

/**
 * The engine list the Director's picker uses (TokenRouter plus every custom provider) with each one's models, and the saved
 * default: { engines: [{ id, name, defaultModel, ready, models }], saved: { engine, model } }.
 */
async function engines(gr) {
    const rows = engineRows(gr);
    const lists = await Promise.all(rows.map((r) => modelsOf(gr, r)));
    const out = rows.map((r, i) => {
        const models = lists[i].slice();
        if (r.defaultModel && !models.includes(r.defaultModel)) models.unshift(r.defaultModel);
        return { id: r.id, name: r.name, defaultModel: r.defaultModel || '', ready: !!r.ready, models };
    });
    const d = resolveDefault(gr);
    return { engines: out, saved: { engine: d.engine, model: d.model } };
}

/** Saves Yukimi's default (config key softKeyGen). Returns { engine, model } as saved; throws Error with .code on a bad pick. */
async function saveDefault(gr, input) {
    const rows = engineRows(gr);
    const id = engineId(input && input.engine);
    const row = rows.find((r) => r.id === id);
    if (!row) { const e = new Error('Unknown engine'); e.code = 'SOFTKEYS_ENGINE'; throw e; }
    const model = clampStr(input && input.model, 200) || row.defaultModel || '';
    if (!model) { const e = new Error(`${row.name} has no default model: choose one`); e.code = 'SOFTKEYS_MODEL'; throw e; }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(model)) { const e = new Error('That model id is not valid'); e.code = 'SOFTKEYS_MODEL'; throw e; }
    if (!gr || typeof gr.modifyConfig !== 'function') { const e = new Error('Config is not writable'); e.code = 'CONFIG_READONLY'; throw e; }
    await gr.modifyConfig('config').assign(['softKeyGen'], { engine: row.id, model });
    return { engine: row.id, model };
}

// ---------------------------------------------------------------- the model call

const tokenRouterBase = () => String(process.env.TOKENROUTER_BASE_URL || 'https://api.tokenrouter.com').trim().replace(/\/+$/, '').replace(/\/v1$/, '');

/** { url, key, model, name, gated } for the engine; throws Error with .code when it cannot be used. */
function endpointFor(gr, engine, model) {
    if (engine === 'tokenrouter') {
        let key = '';
        try { key = gr.getApiKeyManager().getActiveApiKey('tokenrouter') || ''; } catch (_) { key = ''; }
        if (!key) { const e = new Error('TokenRouter has no API key (Security Center > API keys)'); e.code = 'SOFTKEYS_NO_KEY'; throw e; }
        return { url: `${tokenRouterBase()}/v1/chat/completions`, key, model: model || tokenRouterDefaultModel(), name: 'TokenRouter', gated: true };
    }
    const cmp = require('./customModelProviders');
    let row;
    try { row = cmp.requireReady(gr, engine); } catch (err) { const e = new Error(err.message); e.code = 'SOFTKEYS_NO_KEY'; throw e; }
    const m = model || cmp.preferredModel(row);
    if (!m) { const e = new Error(`${row.name} has no default model: choose one`); e.code = 'SOFTKEYS_MODEL'; throw e; }
    return { url: row.chatUrl, key: row.apiKey, model: m, name: row.name, gated: row.kind === 'tokenrouter' };
}

/**
 * One chat-completions call (JSON mode: the word json is in the prompt, DeepSeek through TokenRouter answers 400 otherwise).
 * TokenRouter calls take their ticket at the shared gate (interactive lane: it waits out 429s); other providers get one retry
 * after a 429 (Retry-After, at most 10 s). A 400 that names response_format is asked once more without it. 90 s in all.
 * Returns { content, model, name, ms }.
 */
async function callEngine(gr, { engine, model }, messages, opts = {}) {
    const ep = endpointFor(gr, engine, model);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || CALL_TIMEOUT_MS);
    const started = Date.now();
    const scrub = (t) => String(t || '').split(ep.key).join('<key>').replace(/\s+/g, ' ').slice(0, 200);
    try {
        const post = (withFormat) => {
            const send = () => fetchFn(ep.url, {
                method: 'POST', signal: ctl.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.key}` },
                body: JSON.stringify(Object.assign({ model: ep.model, temperature: 0, max_tokens: MAX_TOKENS, messages }, withFormat ? { response_format: { type: 'json_object' } } : {}))
            });
            return ep.gated ? require('./tokenRouterGate').run(send, { lane: 'interactive', label: 'soft key generation', signal: ctl.signal }) : send();
        };
        let res = await post(true);
        let body = await res.text();
        if (!res.ok && res.status === 429 && !ep.gated) {
            const ra = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : NaN);
            await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10000) : 4000);
            res = await post(true);
            body = await res.text();
        }
        if (!res.ok && res.status === 400 && /response_format|json_object/i.test(body)) {
            res = await post(false);
            body = await res.text();
        }
        if (!res.ok) {
            const e = new Error(`${ep.name} answered ${res.status}: ${scrub(body)}`);
            e.code = res.status === 429 ? 'SOFTKEYS_RATE_LIMIT' : 'SOFTKEYS_UPSTREAM';
            throw e;
        }
        let j;
        try { j = JSON.parse(body); } catch (_) { const e = new Error(`${ep.name} answered something that is not JSON`); e.code = 'SOFTKEYS_UPSTREAM'; throw e; }
        const choice = (asArr(j.choices)[0]) || {};
        return { content: String((choice.message || {}).content || ''), finish: choice.finish_reason || '', model: ep.model, name: ep.name, ms: Date.now() - started };
    } catch (err) {
        if (err && (err.name === 'AbortError' || ctl.signal.aborted)) { const e = new Error(`${ep.name} did not answer within ${Math.round((opts.timeoutMs || CALL_TIMEOUT_MS) / 1000)} s`); e.code = 'SOFTKEYS_TIMEOUT'; throw e; }
        if (err && !err.code) { const e = new Error(`${ep.name} could not be reached: ${scrub(err.message)}`); e.code = 'SOFTKEYS_UPSTREAM'; throw e; }
        throw err;
    } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------- generate

function cleanDesign(raw) {
    if (!isObj(raw)) return null;
    const out = {};
    for (const side of SIDES) {
        const d = raw[side];
        if (!isObj(d)) continue;
        const label = labelOf(d.label, 200);
        const menu = side === 'right' || d.menu ? asArr(d.menu).slice(0, 60).map((r) => (isSepRow(r) ? { sep: true } : { label: labelOf(isObj(r) ? r.label : r, 200) })).filter((r) => r.sep || r.label) : [];
        if (!label && !menu.length) continue;
        out[side] = menu.length ? { label, menu } : { label };
    }
    return Object.keys(out).length ? out : null;
}

/**
 * The generation: { pkg, label, probe, wish, design, engine, model } -> { profile, items, problems, notes, engine, model, ms }.
 * Throws Error with .code (SOFTKEYS_BAD_REQUEST, SOFTKEYS_NO_ENGINE, SOFTKEYS_NO_KEY, SOFTKEYS_TIMEOUT, SOFTKEYS_UPSTREAM,
 * SOFTKEYS_RATE_LIMIT, SOFTKEYS_BAD_ANSWER) when no answer can be made; the message is for the user.
 */
async function generate(gr, req) {
    const started = Date.now();
    const r = isObj(req) ? req : {};
    const pkg = clampStr(r.pkg || (isObj(r.probe) && r.probe.pkg), 200);
    if (!PKG_RE.test(pkg)) { const e = new Error('No valid app package'); e.code = 'SOFTKEYS_BAD_REQUEST'; throw e; }
    const probe = sanitizeProbe(r.probe, pkg);
    probe.pkg = pkg;
    const label = clampStr(r.label || probe.label, CAPS.label) || pkg;
    const design = cleanDesign(r.design);
    let engine = engineId(r.engine);
    let model = clampStr(r.model, 200);
    if (!engine) { const d = resolveDefault(gr); engine = d.engine; model = model || d.model; }
    const row = engineRows(gr).find((x) => x.id === engine);
    if (!engine || !row) { const e = new Error('No engine is ready: add an API key (Security Center > API keys) or a model provider'); e.code = 'SOFTKEYS_NO_ENGINE'; throw e; }
    if (!row.ready) { const e = new Error(`${row.name} has no API key`); e.code = 'SOFTKEYS_NO_KEY'; throw e; }
    if (!model) model = row.defaultModel || (engine === 'tokenrouter' ? tokenRouterDefaultModel() : '');
    const { system, user } = buildPrompt({ pkg, label, probe, wish: r.wish, design });
    const call = await callEngine(gr, { engine, model }, [{ role: 'system', content: system }, { role: 'user', content: user }]);
    const parsed = parseModelAnswer(call.content);
    if (!parsed || !SIDES.some((s) => isObj(parsed[s]))) {
        const e = new Error(`${call.name} ${call.model} did not answer with soft keys${call.finish === 'length' ? ' (its answer was cut off: try another model)' : ''}`);
        e.code = 'SOFTKEYS_BAD_ANSWER';
        throw e;
    }
    const out = assemble(parsed, { probe, pkg, design, unmapped: parsed.unmapped, appLabel: label });
    const notes = clampStr(typeof parsed.notes === 'string' ? parsed.notes : asArr(parsed.notes).map((n) => clampStr(n, 200)).join(' '), 600);
    return Object.assign(out, { notes, engine, model: call.model, ms: Date.now() - started });
}

module.exports = {
    CAPS, LIMITS, SIDES, SIMPLE, DO_ROWS, VIA,
    sanitizeProbe, parseLink, matchLink, globToRegExp, checkLinkAgainstProbe,
    validateAction, validateProfile, assemble, defaultLabel,
    buildPrompt, parseModelAnswer,
    engines, resolveDefault, saveDefault, endpointFor, callEngine, generate, cleanDesign,
    _setFetch, _setEngineSource
};

require('./hotReload').mark(module);
