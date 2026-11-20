/**
 * ActiveSync: which of a phone's notifications reach the computers (Yozora #979).
 *
 * Yukimi, Nov 20 2026: "Add an option in Mobile Device Center to Enable/Disable Apps/Channel notifications that we
 * don't want to manage, as well as a toggle for whether they should notify in the tray ... a list of apps that we do
 * not need to send and ones we don't need to notify for, as well as apps that are already handled by other apps."
 *
 * Per partnership, kept on the server:
 *
 *   catalog    the phone's apps and their Android notification channels as they show up (as_notify_apps): every
 *              notify.posted the phone relays, and notify.seen for the ones its filter keeps on the phone (the app
 *              says each new app / channel once, with the channel's name and importance, never the words).
 *   defaults   classify(): system noise (Android System, System UI, charging, Device care, Play services ...) and
 *              status / background / promotion channels are not sent; apps another Melaton path already handles
 *              (Text Messaging's iMessage / RCS accounts, Messenger's Android app accounts, the mail accounts in
 *              Samsung Email, Lapis Remote, Melaton Videos' Kick bells) are not sent either and say "Handled by";
 *              a silent channel (Low importance on the phone) is sent without a balloon; the rest is sent with one.
 *   overrides  what the user changed in Device Center (as_notify_prefs), per app and per channel: send, tray.
 *
 * Out of those the server compiles
 *
 *   the phone's filter   { v, d, keep, p, c } pushed to the app's background link (device op notify.filter, only when
 *                        the phone's copy - the hello's nfv - differs): the app drops a notification ON THE PHONE before
 *                        it is described or sent (DSApp ActiveSyncNotifications). keep: packages a server module reads
 *                        whatever the computers show (Messenger's Android app accounts, Melaton Videos' apps).
 *   the computers' map   { v, apps: { pkg: { s, t, ch: { id: [s, t] } } } } for activeSyncNotifications.js (as_event
 *                        notify.filter from the server on every change, and as_notify_settings { compact }).
 *
 * and filters what is relayed (activeSync.setRelayFilter): a notify.posted the computers do not get stops at the
 * server, the rest carry tray: true / false; notify.seen never leaves the server.
 */
'use strict';

const crypto = require('crypto');

const PACKAGE_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/;
const CHANNEL_RE = /^[^\u0000-\u001f]{1,200}$/;
const MAX_APPS_PER_DEVICE = 400;
const MAX_CHANNELS_PER_APP = 120;
const TOUCH_MS = 60 * 60 * 1000;       // last_seen is written at most hourly per channel
const CONTEXT_MS = 60 * 1000;          // the other programs' accounts are read again at most once a minute
const PUSH_DEBOUNCE_MS = 2000;

/**
 * System noise: the phone's own status, charging, updates, other forwarders and background helpers. Nothing a person
 * reads on a computer. The phone's filter carries these from the start, seen or not.
 */
const NOISE = {
    android: 'System notices (USB, developer options)',
    'com.android.systemui': 'Battery, screenshots, storage, Do not disturb',
    'com.android.bluetooth': 'Battery status, car audio, sharing',
    'com.android.vending': 'Updates and installs',
    'com.android.providers.downloads': 'Download progress',
    'com.android.shell': 'Bug reports and test posts',
    'com.google.android.gms': 'Account and device notices',
    'com.google.android.as': 'System suggestions',
    'com.google.android.packageinstaller': 'Installs',
    'com.samsung.android.lool': 'Battery, memory, storage',
    'com.samsung.sdm': 'Software updates',
    'com.wssyncmldm': 'Software updates',
    'com.samsung.android.app.smartcapture': 'Screenshots and screen recording',
    'com.samsung.android.app.routines': 'Modes and routines running',
    'com.samsung.accessory.paranmgr': 'Earbud status',
    'com.samsung.android.dkey': 'Car detection and key status',
    'com.samsung.android.mdecservice': 'Call & text on other devices',
    'com.samsung.android.smartsuggestions': 'Suggestions',
    'com.samsung.android.game.gamehome': 'Gaming Hub',
    'com.sec.android.app.launcher': 'Home screen',
    'com.samsung.android.providers.media': 'Media storage',
    'com.samsung.android.scloud': 'Cloud sync',
    'com.samsung.android.da.daagent': 'Dual Messenger',
    'com.microsoft.appmanager': 'Forwards notifications itself',
    'moe.shizuku.privileged.api': 'Service status',
    'net.dinglisch.android.taskerm': 'Running tasks',
    'com.termux': 'Sessions',
    'com.termux.tasker': 'Running tasks',
    'net.typeblog.shelter': 'Work profile service',
    'co.adityarajput.notifilter': 'Its own filter alerts',
    'br.com.zetabit.ios_standby': 'Charging screen',
    'com.mynexdock.companion': 'Dock battery and alerts',
    'com.markmurphy94.hourly_chime': 'Clock chimes',
    'jp.net.seventhreeseven.dreamscape': 'Melaton\'s own'
};

// a channel by its name or id: status, background work, transfers, media controls - not something to read
const NOISE_CHANNEL = /foreground|background|\bsync\b|sync service|download|upload|progress|playback|now playing|media control|lock screen media|\bongoing\b|persistent|\bservice\b|monitor|running|location|widget|connection|recorder|charging|clipboard|\bstatus\b|sensor|battery|silent_?push|keep.?alive|\bvpn\b|processing|\bsending\b/i;
// promotions and the app's own news
const PROMO_CHANNEL = /promot|marketing|\boffers?\b|deals|recommend|product updates|\bnews\b|\btips\b|coupon|cash ?back|exclusive|suggestion|streak|wishlist|leagues|feedback|survey/i;

// per app and channel, where the rules above choose wrongly (from the Fold's own channel list, Nov 20 2026)
const CHANNEL_DEFAULTS = {
    'com.sec.android.app.clockpackage': {
        notification_channel_upcoming_alarm: { send: true, tray: false, why: 'Upcoming alarms: listed, no balloon' },
        notification_channel_stopwatch: { send: false, tray: false, why: 'Stopwatch (running)' },
        notification_channel_timer: { send: true, tray: true, why: '' }
    },
    'com.samsung.android.email.provider': {
        email_channel_4_foreground: { send: false, tray: false, why: 'Email sync' },
        email_channel_3_miscellaneous: { send: false, tray: false, why: 'Other notifications' }
    }
};

let gr = null;
let tapped = false;
const cache = new Map();       // deviceId -> { rows: Map(key -> row), prefs, built: null | { view, phone, eff } }
const pushTimers = new Map();  // deviceId -> timer
let ctxCache = null;           // { at, key, handled: Map, keep: Set }

function resources() {
    if (!gr) gr = require('./globalResources');
    return gr;
}
function activeSync() { return require('./activeSync'); }
function db() { return activeSync().db(resources()); }

function ensureTables() {
    const d = db();
    if (d.__notifyFilterTables) return d;
    d.exec(`
        CREATE TABLE IF NOT EXISTS as_notify_apps (
            device_id TEXT NOT NULL,
            package TEXT NOT NULL,
            channel TEXT NOT NULL DEFAULT '',
            app TEXT NOT NULL DEFAULT '',
            channel_name TEXT NOT NULL DEFAULT '',
            importance INTEGER,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            posts INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (device_id, package, channel)
        );
        CREATE TABLE IF NOT EXISTS as_notify_prefs (
            device_id TEXT PRIMARY KEY,
            prefs TEXT NOT NULL DEFAULT '{}',
            updated INTEGER NOT NULL
        );
    `);
    Object.defineProperty(d, '__notifyFilterTables', { value: true });
    return d;
}

const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const isBool = (v) => v === true || v === false;

/** Java's String.hashCode: Samsung Email names an account's New emails channel by its address's hash. */
function javaHash(s) {
    let h = 0;
    for (const c of String(s)) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
    return h;
}

// ---------------------------------------------------------------- what other Melaton programs already handle

function config(path) {
    try { return resources().getConfig({ path }) || null; } catch (_) { return null; }
}

/**
 * pkg -> { by, keep, channel?(id) -> bool }: apps whose notifications another Melaton program already brings to this
 * computer. keep: the server reads the app's notifications itself (they still leave the phone).
 */
function handledContext() {
    if (ctxCache && Date.now() - ctxCache.at < CONTEXT_MS) return ctxCache;
    const handled = new Map();
    const keep = new Set();
    const tm = config('textMessaging');
    for (const a of (tm && Array.isArray(tm.accounts) ? tm.accounts : [])) {
        if (!a || a.enabled === false) continue;
        if (a.kind === 'bluebubbles') handled.set('com.bluebubbles.messaging', { by: 'Melaton Messenger (iMessage)' });
        if (a.kind === 'rcs') {
            handled.set('com.google.android.apps.messaging', { by: 'Melaton Messenger (RCS)' });
            handled.set('com.samsung.android.messaging', { by: 'Melaton Messenger (RCS)' });
        }
        if (a.kind === 'android' && PACKAGE_RE.test(String(a.package || ''))) {
            // an account named only by its package takes the app's own name from the catalog (build)
            const label = str(a.label && !PACKAGE_RE.test(a.label) ? a.label : '', 60);
            handled.set(a.package, { by: label ? `Melaton Messenger (${label})` : 'Melaton Messenger', named: !!label, keep: true });
            keep.add(a.package);
        }
    }
    // the mail accounts: Samsung Email's "New emails" channel of the same address
    const mail = config('mailAccounts');
    const hashes = new Map();
    for (const a of (mail && Array.isArray(mail.accounts) ? mail.accounts : [])) {
        if (!a || a.enabled === false || !a.email) continue;
        hashes.set(String(javaHash(String(a.email).toLowerCase())), String(a.email));
    }
    if (hashes.size) {
        const of = (id) => { const m = /^email_channel_new_emails_\d+_(-?\d+)$/.exec(String(id)); return m ? hashes.get(m[1]) || '' : ''; };
        handled.set('com.samsung.android.email.provider', { by: '', channel: (id) => { const e = of(id); return e ? `Dovecote Express (${e})` : ''; } });
    }
    // Lapis Remote is the car's remote (#835): it raises its own notices
    if (config('lapis')) {
        handled.set('com.stationdm.bluelink', { by: 'Lapis Remote' });
        handled.set('com.hyundai.bluelink', { by: 'Lapis Remote' });
    }
    // Melaton Videos: Kick channels with the bell on are told by the server itself (Kick's API); the apps it imports
    // from notifications have to keep coming from the phone
    try {
        const v = require('./videosSources').view();
        if ((v.kick || []).some((c) => c.notify)) handled.set('com.kick.mobile', { by: 'Melaton Videos (Kick)' });
        for (const a of v.apps || []) if (a && PACKAGE_RE.test(String(a.package || ''))) keep.add(a.package);
    } catch (_) { /* no Videos state */ }
    const key = JSON.stringify([[...handled].map(([p, h]) => [p, h.by, !!h.keep, !!h.channel]), [...keep].sort(), [...hashes.keys()].sort()]);
    const changed = ctxCache && ctxCache.key !== key;
    ctxCache = { at: Date.now(), key, handled, keep };
    if (changed) { for (const c of cache.values()) c.built = null; for (const id of cache.keys()) schedulePush(id); }
    return ctxCache;
}

// ---------------------------------------------------------------- the defaults

/** The app as a whole: { kind: 'noise' | 'handled' | 'real', why, handledBy, keep, send, tray }. */
function classifyApp(pkg, ctx) {
    if (NOISE[pkg]) return { kind: 'noise', why: NOISE[pkg], handledBy: '', keep: ctx.keep.has(pkg), send: false, tray: false };
    const h = ctx.handled.get(pkg);
    if (h && h.by) return { kind: 'handled', why: '', handledBy: h.by, keep: ctx.keep.has(pkg), send: false, tray: false };
    return { kind: 'real', why: '', handledBy: '', keep: ctx.keep.has(pkg), send: true, tray: true };
}

/** One channel of an app: { kind, why, handledBy, send, tray }. */
function classifyChannel(pkg, row, app, ctx) {
    if (app.kind !== 'real') return { kind: app.kind, why: app.why, handledBy: app.handledBy, send: false, tray: false };
    const id = row.channel;
    const h = ctx.handled.get(pkg);
    const by = h && h.channel ? h.channel(id) : '';
    if (by) return { kind: 'handled', why: '', handledBy: by, send: false, tray: false };
    const fixed = CHANNEL_DEFAULTS[pkg] && CHANNEL_DEFAULTS[pkg][id];
    if (fixed) return { kind: fixed.send ? 'real' : 'noise', why: fixed.why || '', handledBy: '', send: fixed.send, tray: fixed.tray };
    const words = `${id} ${row.channel_name || ''}`;
    if (id && NOISE_CHANNEL.test(words)) return { kind: 'noise', why: 'Status or background notices', handledBy: '', send: false, tray: false };
    if (id && PROMO_CHANNEL.test(words)) return { kind: 'noise', why: 'Promotions and news', handledBy: '', send: false, tray: false };
    const imp = row.importance;
    // Android's own importance: None / Min never show in the status bar, Low shows without a sound
    if (imp != null && imp <= 1) return { kind: 'noise', why: 'Hidden on the phone (Min importance)', handledBy: '', send: false, tray: false };
    if (imp === 2) return { kind: 'real', why: 'Silent on the phone: listed, no balloon', handledBy: '', send: true, tray: false };
    return { kind: 'real', why: '', handledBy: '', send: true, tray: true };
}

// ---------------------------------------------------------------- state per device

function state(deviceId) {
    let c = cache.get(deviceId);
    if (c) return c;
    const d = ensureTables();
    const rows = new Map();
    for (const r of d.prepare('SELECT * FROM as_notify_apps WHERE device_id = ?').all(deviceId)) rows.set(`${r.package}\u0001${r.channel}`, r);
    const p = d.prepare('SELECT prefs FROM as_notify_prefs WHERE device_id = ?').get(deviceId);
    let prefs = {};
    try { prefs = p ? JSON.parse(p.prefs) || {} : {}; } catch (_) { prefs = {}; }
    c = { rows, prefs: cleanPrefs(prefs), built: null };
    cache.set(deviceId, c);
    return c;
}

/** { apps: { pkg: { send?, tray?, ch: { id: { send?, tray? } } } } }: only booleans, valid names, bounded. */
function cleanPrefs(raw) {
    const out = { apps: {} };
    const apps = raw && typeof raw.apps === 'object' && raw.apps ? raw.apps : {};
    for (const pkg of Object.keys(apps).slice(0, MAX_APPS_PER_DEVICE)) {
        if (!PACKAGE_RE.test(pkg)) continue;
        const a = apps[pkg] || {};
        const o = {};
        if (isBool(a.send)) o.send = a.send;
        if (isBool(a.tray)) o.tray = a.tray;
        const ch = a.ch && typeof a.ch === 'object' ? a.ch : {};
        for (const id of Object.keys(ch).slice(0, MAX_CHANNELS_PER_APP)) {
            if (!CHANNEL_RE.test(id)) continue;
            const x = ch[id] || {};
            const co = {};
            if (isBool(x.send)) co.send = x.send;
            if (isBool(x.tray)) co.tray = x.tray;
            if (Object.keys(co).length) { o.ch = o.ch || {}; o.ch[id] = co; }
        }
        if (Object.keys(o).length) out.apps[pkg] = o;
    }
    return out;
}

const iconOf = (pkg) => {
    try { return require('./textMessagingAndroid').hasAppIcon(pkg) ? `/api/textmessaging/android-icon/${encodeURIComponent(pkg)}` : ''; } catch (_) { return ''; }
};

/** Everything Device Center shows, and the two compiled filters. */
function build(deviceId) {
    const c = state(deviceId);
    const ctx = handledContext();
    if (c.built) return c.built;
    const byPkg = new Map();
    for (const r of c.rows.values()) {
        if (!byPkg.has(r.package)) byPkg.set(r.package, []);
        byPkg.get(r.package).push(r);
    }
    const apps = [];
    for (const [pkg, rows] of byPkg) {
        const def = classifyApp(pkg, ctx);
        const pref = c.prefs.apps[pkg] || {};
        const send = isBool(pref.send) ? pref.send : def.send;
        const tray = isBool(pref.tray) ? pref.tray : def.tray;
        const label = rows.reduce((best, r) => (r.last_seen > best.at && r.app ? { at: r.last_seen, app: r.app } : best), { at: -1, app: '' }).app || pkg;
        const h = ctx.handled.get(pkg);
        if (def.kind === 'handled' && h && h.named === false && label !== pkg) def.handledBy = `${h.by} (${label})`;
        const channels = rows.filter((r) => r.channel).map((r) => {
            const cd = classifyChannel(pkg, r, def, ctx);
            const cp = (pref.ch && pref.ch[r.channel]) || {};
            return {
                id: r.channel,
                name: r.channel_name || '',
                importance: r.importance,
                kind: cd.kind, why: cd.why, handledBy: cd.handledBy,
                def: { send: cd.send, tray: cd.tray },
                send: isBool(cp.send) ? cp.send : cd.send,
                tray: isBool(cp.tray) ? cp.tray : cd.tray,
                posts: r.posts,
                lastSeen: r.last_seen
            };
        }).sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        apps.push({
            package: pkg, app: label, icon: iconOf(pkg),
            kind: def.kind, why: def.why, handledBy: def.handledBy, keep: def.keep,
            def: { send: def.send, tray: def.tray }, send, tray,
            lastSeen: rows.reduce((m, r) => Math.max(m, r.last_seen), 0),
            channels
        });
    }
    apps.sort((a, b) => a.app.localeCompare(b.app));

    // the computers' map: an app's s / t, each channel's [s, t] already ANDed with the app's
    const effApps = {};
    for (const a of apps) {
        const e = { s: a.send ? 1 : 0, t: a.send && a.tray ? 1 : 0 };
        if (a.channels.length) {
            e.ch = {};
            for (const ch of a.channels) {
                const s = a.send && ch.send ? 1 : 0;
                e.ch[ch.id] = [s, s && a.tray && ch.tray ? 1 : 0];
            }
        }
        effApps[a.package] = e;
    }
    // the phone's filter: packages not sent (seen, or known noise), and the channels that differ from their app
    const p = {};
    const ch = {};
    for (const pkg of Object.keys(NOISE)) p[pkg] = 0;
    for (const a of apps) {
        if (!a.send) { p[a.package] = 0; continue; }
        delete p[a.package];
        for (const x of a.channels) {
            if (x.send) continue;
            ch[a.package] = ch[a.package] || {};
            ch[a.package][x.id] = 0;
        }
    }
    const phone = { d: 1, keep: [...ctx.keep].sort(), p, c: ch };
    phone.v = crypto.createHash('sha1').update(JSON.stringify(phone)).digest('hex').slice(0, 12);
    const eff = { apps: effApps };
    eff.v = crypto.createHash('sha1').update(JSON.stringify(eff)).digest('hex').slice(0, 12);
    c.built = { apps, phone, eff };
    return c.built;
}

/** Whether a notification of pkg / channel goes to the computers, and with a balloon. */
function decide(deviceId, pkg, channel) {
    const e = build(deviceId).eff.apps[pkg];
    if (!e) {
        // not in the catalog yet (learn() runs first, so only a malformed post): the app's rule decides
        const def = classifyApp(pkg, handledContext());
        return { send: def.send, tray: def.tray };
    }
    const c = channel && e.ch && e.ch[channel];
    if (c) return { send: !!c[0], tray: !!c[1] };
    return { send: !!e.s, tray: !!e.t };
}

// ---------------------------------------------------------------- learning the catalog

/** A posted (or, kept on the phone, seen) notification's app and channel. Returns true when it was new. */
function learn(deviceId, detail, posted) {
    const pkg = String(detail.package || '');
    if (!PACKAGE_RE.test(pkg)) return false;
    const channel = typeof detail.channel === 'string' && CHANNEL_RE.test(detail.channel) ? detail.channel : '';
    const c = state(deviceId);
    const key = `${pkg}\u0001${channel}`;
    const now = Date.now();
    const app = str(detail.app, 80);
    const name = str(detail.channelName, 120);
    const imp = Number.isInteger(detail.importance) && detail.importance >= -1 && detail.importance <= 5 ? detail.importance : null;
    const d = ensureTables();
    const was = c.rows.get(key);
    if (!was) {
        if (c.rows.size >= MAX_APPS_PER_DEVICE * 4) return false;
        const row = { device_id: deviceId, package: pkg, channel, app, channel_name: name, importance: imp, first_seen: now, last_seen: now, posts: posted ? 1 : 0 };
        d.prepare('INSERT OR IGNORE INTO as_notify_apps (device_id, package, channel, app, channel_name, importance, first_seen, last_seen, posts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(deviceId, pkg, channel, app, name, imp, now, now, row.posts);
        c.rows.set(key, row);
        c.built = null;
        return true;
    }
    if (posted) was.posts += 1;
    const relabel = (app && app !== was.app) || (name && name !== was.channel_name) || (imp != null && imp !== was.importance);
    if (relabel) {
        if (app) was.app = app;
        if (name) was.channel_name = name;
        if (imp != null) was.importance = imp;
        c.built = null;
    }
    if (relabel || now - was.last_seen > TOUCH_MS) {
        was.last_seen = now;
        d.prepare('UPDATE as_notify_apps SET app = ?, channel_name = ?, importance = ?, last_seen = ?, posts = ? WHERE device_id = ? AND package = ? AND channel = ?')
            .run(was.app, was.channel_name, was.importance, now, was.posts, deviceId, pkg, channel);
    }
    return relabel;
}

// ---------------------------------------------------------------- pushes

/** The phone's copy (op notify.filter on its background link) and the computers' map, once things settle. */
function schedulePush(deviceId) {
    if (pushTimers.has(deviceId)) return;
    const t = setTimeout(() => { pushTimers.delete(deviceId); push(deviceId); }, PUSH_DEBOUNCE_MS);
    if (t.unref) t.unref();
    pushTimers.set(deviceId, t);
}

const sentEff = new Map(); // deviceId -> v the computers last got

function push(deviceId, opts = {}) {
    const b = build(deviceId);
    if (sentEff.get(deviceId) !== b.eff.v) {
        sentEff.set(deviceId, b.eff.v);
        try { activeSync().tellComputers(resources(), null, 'notify.filter', { deviceId, eff: b.eff }); } catch (err) { console.warn('[activeSync notify filter] computers:', err.message); }
    }
    void pushPhone(deviceId, opts.nfv);
}

async function pushPhone(deviceId, phoneHas) {
    const b = build(deviceId);
    if (phoneHas !== undefined && phoneHas === b.phone.v) return false;
    try {
        const res = await activeSync().serverCall(resources(), null, deviceId, 'notify.filter', b.phone, { timeoutMs: 15000, fromName: 'Melaton Mobile Device Center' });
        return !!res;
    } catch (err) {
        // an older app (no notify.filter), the device away, or notifications not granted: it gets it at its next hello
        if (!['UNSUPPORTED', 'OFFLINE', 'NOT_PERMITTED', 'NOT_CONNECTED'].includes(err.code)) console.warn(`[activeSync notify filter] phone ${deviceId}: ${err.message}`);
        return false;
    }
}

// ---------------------------------------------------------------- settings from Device Center

/** Device Center's page: the catalog with defaults, the user's choices and who handles what. */
function settings(deviceId) {
    const b = build(deviceId);
    return { deviceId, apps: b.apps, v: b.eff.v };
}

function compact(deviceId) {
    return build(deviceId).eff;
}

/**
 * The user's choices (Device Center's page sends them whole): stored as differences from the defaults only, so a
 * default that changes later (a new Messenger account) still applies where the user chose nothing.
 */
function save(deviceId, raw) {
    const c = state(deviceId);
    const b = build(deviceId);
    const want = cleanPrefs(raw).apps;
    const out = { apps: {} };
    for (const a of b.apps) {
        const w = want[a.package];
        if (!w) continue;
        const o = {};
        if (isBool(w.send) && w.send !== a.def.send) o.send = w.send;
        if (isBool(w.tray) && w.tray !== a.def.tray) o.tray = w.tray;
        for (const ch of a.channels) {
            const x = w.ch && w.ch[ch.id];
            if (!x) continue;
            const co = {};
            if (isBool(x.send) && x.send !== ch.def.send) co.send = x.send;
            if (isBool(x.tray) && x.tray !== ch.def.tray) co.tray = x.tray;
            if (Object.keys(co).length) { o.ch = o.ch || {}; o.ch[ch.id] = co; }
        }
        if (Object.keys(o).length) out.apps[a.package] = o;
    }
    ensureTables().prepare('INSERT INTO as_notify_prefs (device_id, prefs, updated) VALUES (?, ?, ?) ON CONFLICT (device_id) DO UPDATE SET prefs = excluded.prefs, updated = excluded.updated')
        .run(deviceId, JSON.stringify(out), Date.now());
    c.prefs = out;
    c.built = null;
    push(deviceId);
    return settings(deviceId);
}

function forgetDevice(deviceId) {
    try {
        const d = ensureTables();
        d.prepare('DELETE FROM as_notify_prefs WHERE device_id = ?').run(deviceId);
        d.prepare('DELETE FROM as_notify_apps WHERE device_id = ?').run(deviceId);
    } catch (err) { console.warn('[activeSync notify filter] forget:', err.message); }
    cache.delete(deviceId);
    sentEff.delete(deviceId);
}

// ---------------------------------------------------------------- wiring

function tap(globalResources) {
    if (globalResources) gr = globalResources;
    if (tapped) return;
    tapped = true;
    const as = activeSync();
    as.onDeviceEvent((name, detail, device) => {
        if (!device || !device.id || !detail || typeof detail !== 'object') return;
        if (name !== 'notify.posted' && name !== 'notify.seen') return;
        try {
            // a filtered app's icon comes with its first notify.seen: kept where the posted ones' are
            if (name === 'notify.seen' && detail.icon) { try { require('./textMessagingAndroid').learnApp({ package: detail.package, label: detail.app, icon: detail.icon }); } catch (_) { /* no icon store */ } }
            if (learn(device.id, detail, name === 'notify.posted')) schedulePush(device.id);
        } catch (err) { console.warn('[activeSync notify filter] learn:', err.message); }
    });
    as.setRelayFilter((g, me, name, detail) => {
        if (name === 'notify.seen') return undefined;
        if (name !== 'notify.posted' || !detail || typeof detail !== 'object') return detail;
        const r = decide(me.id, String(detail.package || ''), typeof detail.channel === 'string' ? detail.channel : '');
        if (!r.send) return undefined;
        return Object.assign({}, detail, { tray: r.tray });
    });
    // the background link says which filter it holds: a different one goes out once the hello is answered
    as.onDeviceHello((d) => {
        if (!d || d.speaker !== 'service' || d.session !== 'partner' || !Array.isArray(d.ops) || !d.ops.includes('notify.filter')) return;
        const t = setTimeout(() => {
            try { void pushPhone(d.id, d.nfv || ''); } catch (err) { console.warn('[activeSync notify filter] hello push:', err.message); }
        }, 1000);
        if (t.unref) t.unref();
    });
    as.onPartnershipEnded((deviceId) => forgetDevice(deviceId));
}

function _reset() {
    cache.clear();
    sentEff.clear();
    for (const t of pushTimers.values()) clearTimeout(t);
    pushTimers.clear();
    ctxCache = null;
    tapped = false;
    gr = null;
}

module.exports = {
    tap, settings, compact, save, decide, learn, forgetDevice, classifyApp, classifyChannel, javaHash, NOISE,
    _reset, _setResources: (r) => { gr = r; }, _phone: (id) => build(id).phone
};
