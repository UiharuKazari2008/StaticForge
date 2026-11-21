/**
 * Text Messaging: Android app accounts (Yozora #885). Yukimi, Nov 16 2026: "add support to messaging to
 * add a android app where it will appear in texts today item and will show its notifications as messages
 * on the list, if they support quick reply handle sending replys aswell as the other actions on the
 * notifications. example app is discord".
 *
 * An account names one Android package (Discord = com.discord). The partnered phone relays its
 * notifications over ActiveSync when "Send notifications" is on (DSApp ActiveSyncNotifications,
 * events notify.posted / notify.removed). A posted notification of that package becomes messages in a
 * conversation of the account:
 *
 *   conversation   the notification's MessagingStyle conversation (its shortcut id, else its conversation
 *                  title), else the notification's title. One chat each, kept in textmessaging.db.
 *   messages       each MessagingStyle line (sender, text, time; a line with no sender is yours), else the
 *                  notification's own title / text. The same line posted again is the same message.
 *   quick reply    the notification's RemoteInput action: send() calls the device op notify.reply
 *                  { key, action, text } on the phone that posted it, while the phone still shows it.
 *   actions        every other action of the notification (Mark as read, Mute, ...) is listed on the
 *                  chat (chat.actions) and run with action() = device op notify.action { key, action }.
 *   open           open() fires what a tap on the conversation's newest notification opens (its
 *                  contentIntent, device op notify.open; the phone keeps it after the notification is
 *                  gone), else starts the app (apps.manage open). chat.open { key, device } lets the
 *                  phone that posted it do the same itself (AndroidActiveSync.openNotification).
 *   read           markRead() runs the app's own Mark as read action, else dismisses the notification.
 *                  A notification removed on the phone (read in the app, swiped) marks the chat read.
 *
 * The phone already shows the app's own notification, so these accounts never post Android notifications
 * of their own (textMessagingPhone / the inbox skip kind 'android'), and the shell's New Text Message
 * notice is off unless the account's Notify switch is on.
 *
 * Every app that posted a notification lately is remembered (recentApps(): package, label, icon) so an
 * account can be added from a list. State beside the store: .cache/textmessaging-android.json and
 * .cache/textmessaging-android/<package>.png (app icons), <account>/<chat>.png (conversation pictures),
 * <account>/img/<chat>/<message>.jpg (message pictures).
 *
 * Channels (Yukimi, Nov 18: "separate server messages and direct messages ... via their notification channel"):
 * an account can be limited to some of the app's notification channels (account.channels, the channel ids the
 * phone sends with each notification). A notification goes to the account of its package that lists its channel,
 * else to the one with no list, else to the first (its id sorts first). The channels each app used are remembered
 * (channelsOf) for the settings page.
 *
 * Communities (Yukimi, Nov 20, #978: "group Discord and Discord servers into a single account ... the servers as a
 * folder named Communities whose subfolders are the servers"): Discord is one account again. Its direct messages
 * are the Inbox; a conversation from a server channel (COMMUNITIES: the channel ids the Fold's Discord posts server
 * messages on) is a community conversation: normalizeChat gives it community { id, server, serverId, channel,
 * channelId } from the conversation's title ("<server> #<channel>", an event's "... in <server>"), and the
 * Inbox / Unknown Senders folders leave it out (textMessaging.listChats folder 'community[:server[:channel]]').
 * The two accounts made by the old split (Nov 18) are merged into one at start (textMessaging.mergeSplits).
 *
 * Pictures (Yukimi, Nov 18: "an image like for 'Sent a video' ... show it inline"): a MessagingStyle line's
 * picture (line.image) or the notification's big picture (d.picture) comes once from the phone as a small JPEG;
 * it is kept as the message's attachment and served by downloadAttachment.
 *
 * Username (Yukimi, Nov 18: "allow setting the account's username ... so that you can identify multiple
 * accounts"): account.username, else the app's signed-in user from the notification (MessagingStyle's user,
 * conv.me), names the account beside the app.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PACKAGE_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/;
const MAX_RECENT = 60;
const RECENT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const LOCAL_MATCH_MS = 10 * 60 * 1000;
const SEMANTIC_MARK_AS_READ = 2;
const CALL_MS = 15000;
const MAX_CHANNELS = 40;
const CHANNEL_RE = /^[^\u0000-\u001f]{1,200}$/;
const GENERIC_ME = /^(you|me|myself|自分)$/i;

/**
 * The old default split of an app into accounts by notification channel (Nov 18): only to find and merge the
 * accounts it made (#978). New accounts are no longer split.
 */
const DEFAULT_SPLITS = {
    'com.discord': [
        { suffix: '', label: 'Discord', channels: ['directMessages'] },
        { suffix: '-servers', label: 'Discord servers', channels: ['messages', 'forumThreadCreated', 'guildEventLive', 'stageLive', 'polls', 'other'] }
    ]
};

/**
 * Apps whose server / community conversations are a folder of the account (#978): the notification channels
 * those come on, and the folder's name. A conversation of another channel (Discord's directMessages) is the Inbox.
 */
const COMMUNITIES = {
    'com.discord': { label: 'Communities', channels: ['messages', 'forumThreadCreated', 'guildEventLive', 'stageLive', 'polls', 'other'] }
};

/** Channel names where the phone cannot send them (a listener reads names only as a companion device). */
const CHANNEL_NAMES = {
    'com.discord': {
        directMessages: 'Direct messages', messages: 'Messages', forumThreadCreated: 'Forum notifications', guildEventLive: 'Event notifications',
        stageLive: 'Stage notifications', polls: 'Polls', other: 'Other server notifications', reactions: 'Reaction Notifications',
        missed_messages_default: 'Missed Messages', missed_messages_low: 'Missed Messages', friendRequests: 'Friend requests', calls: 'Incoming calls',
        social: 'Friend Activity', systemMessages: 'Discord system messages', default: 'Other'
    }
};

/** An account's channel list: unique channel ids, or [] (every channel no other account of the app lists). */
function cleanChannels(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map((c) => String(c == null ? '' : c).trim()).filter((c) => CHANNEL_RE.test(c)))].slice(0, MAX_CHANNELS);
}

const providers = new Set();
const caughtUp = new Set(); // device ids read with notify.list since this server started
let tapped = false;
let gr = null;
let cacheDir = null;
let recent = null; // { pkg: { label, at, icon: bool } }
let recentTimer = null;

function resources() {
    if (!gr) gr = require('./globalResources');
    return gr;
}

function activeSync() { return require('./activeSync'); }

function dir() {
    if (cacheDir) return cacheDir;
    let d = null;
    try { d = resources().getPath('cache'); } catch (_) { d = null; }
    cacheDir = d || path.join(__dirname, '..', '.cache');
    return cacheDir;
}

const hash = (s, n = 20) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, n);
const str = (v, max) => String(v == null ? '' : v).slice(0, max);

function dataUrlBytes(url) {
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ''));
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    return buf.length && buf.length < 256 * 1024 ? buf : null;
}

function writeFileQuiet(file, buf) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buf);
        return true;
    } catch (error) {
        console.warn(`[textMessaging:android] ${path.basename(file)}: ${error.message}`);
        return false;
    }
}

// ---------------------------------------------------------------- apps that posted lately

function recentFile() { return path.join(dir(), 'textmessaging-android.json'); }
function iconFile(pkg) { return path.join(dir(), 'textmessaging-android', `${pkg}.png`); }

function loadRecent() {
    if (recent) return recent;
    try {
        const d = JSON.parse(fs.readFileSync(recentFile(), 'utf8'));
        recent = d && typeof d.apps === 'object' && d.apps ? d.apps : {};
    } catch (_) { recent = {}; }
    return recent;
}

function saveRecent() {
    clearTimeout(recentTimer);
    recentTimer = setTimeout(() => {
        try { fs.writeFileSync(recentFile(), JSON.stringify({ apps: recent })); } catch (error) { console.warn(`[textMessaging:android] recent save failed: ${error.message}`); }
    }, 3000);
    if (recentTimer.unref) recentTimer.unref();
}

function noteApp(d) {
    const pkg = String(d.package || '');
    const r = loadRecent();
    const label = str(d.app || pkg, 80);
    const was = r[pkg];
    let icon = !!(was && was.icon);
    if (d.icon) { const buf = dataUrlBytes(d.icon); if (buf && writeFileQuiet(iconFile(pkg), buf)) icon = true; }
    // the channels it posts on (for an account's channel list) and its signed-in user (the account's default name)
    const channels = Object.assign({}, (was && was.channels) || {});
    const ch = typeof d.channel === 'string' && CHANNEL_RE.test(d.channel) ? d.channel : '';
    const newChannel = !!ch && !channels[ch];
    if (newChannel) {
        channels[ch] = Date.now();
        const ids = Object.keys(channels).sort((a, b) => channels[b] - channels[a]);
        ids.slice(MAX_CHANNELS).forEach((k) => delete channels[k]);
    }
    const meRaw = d.conv && typeof d.conv === 'object' ? str(d.conv.me, 80).trim() : '';
    const me = meRaw && !GENERIC_ME.test(meRaw) ? meRaw : ((was && was.me) || '');
    if (!newChannel && was && was.label === label && was.icon === icon && (was.me || '') === me && Date.now() - was.at < 60 * 60 * 1000) return;
    r[pkg] = Object.assign({ label, at: Date.now(), icon, channels, me }, was && was.acct ? { acct: was.acct } : {});
    const keys = Object.keys(r);
    const now = Date.now();
    keys.forEach((k) => { if (now - r[k].at > RECENT_KEEP_MS) delete r[k]; });
    const left = Object.keys(r).sort((a, b) => r[b].at - r[a].at);
    left.slice(MAX_RECENT).forEach((k) => delete r[k]);
    saveRecent();
}

/** Apps that posted a notification lately, newest first: [{ package, label, at, icon }]. */
function recentApps() {
    const r = Object.assign({}, loadRecent());
    // Melaton Videos (#861) keeps every app that posted lately too: its list fills ours (before our first post)
    try {
        const v = JSON.parse(fs.readFileSync(path.join(dir(), 'videos-sources.json'), 'utf8'));
        const seen = (v && v.seenApps) || {};
        Object.keys(seen).forEach((pkg) => {
            if (!r[pkg] && PACKAGE_RE.test(pkg) && seen[pkg] && Date.now() - Number(seen[pkg].at) < RECENT_KEEP_MS) r[pkg] = { label: str(seen[pkg].label || pkg, 80), at: Number(seen[pkg].at) || 0, icon: fs.existsSync(iconFile(pkg)) };
        });
    } catch (_) { /* no Videos state */ }
    return Object.keys(r).sort((a, b) => r[b].at - r[a].at)
        .map((pkg) => ({ package: pkg, label: r[pkg].label, at: r[pkg].at, icon: r[pkg].icon ? `/api/textmessaging/android-icon/${encodeURIComponent(pkg)}` : '' }));
}

// a label that is only the package name is no name (the phone could not read it: an app in the Work profile, #892)
function realLabel(label, pkg) { const l = String(label || '').trim(); return l && l !== pkg && !PACKAGE_RE.test(l) ? l : ''; }
/** What the phone said of an app outside a notification (apps.icon): its name when real, its icon. */
function learnApp({ package: pkg, label, icon } = {}) {
    if (!PACKAGE_RE.test(String(pkg || ''))) return;
    const l = realLabel(label, pkg);
    const r = loadRecent();
    const was = r[pkg];
    noteApp({ package: pkg, app: l || (was && realLabel(was.label, pkg)) || pkg, icon: icon || undefined });
}
function appLabel(pkg) { const r = loadRecent()[pkg]; return r ? realLabel(r.label, pkg) : ''; }
/** The app's signed-in user as its notifications name it (MessagingStyle's user), or ''. */
function appUser(pkg) { const r = loadRecent()[pkg]; return (r && r.me) || ''; }
/** The app's account on the phone as Android lists it (AccountManager / dumpsys account, #978), or ''. */
function appAccount(pkg) { const r = loadRecent()[pkg]; return (r && r.acct) || ''; }

// ---------------------------------------------------------------- the apps' accounts on the phone (#978)
//
// Yukimi, Nov 20: the "Android app" line under an app account becomes the user's own name in that app. The
// notifications' MessagingStyle user (appUser) names most messengers; the rest come from Android's account
// list: the phone's apps.accounts op (DSApp ActiveSyncAccounts: AccountManager, then dumpsys account through
// Shizuku / its own ADB), else the server's Remote Commands (device.adbShell) when the phone allows them.
// Asked once per phone per server start, and again after ACCOUNTS_EVERY_MS at the next connection.

const ACCOUNTS_EVERY_MS = 12 * 60 * 60 * 1000;
const ACCOUNTS_CMD = "dumpsys account | grep -E 'Account \\{|AuthenticatorDescription'";
const accountsAsked = new Map(); // device id -> ms

/** `dumpsys account` lines -> [{ name, type, package }] (package: the account type's authenticator). */
function parseDumpsysAccounts(text) {
    const owners = new Map();
    const seen = new Map();
    for (const line of String(text || '').split('\n')) {
        const a = /AuthenticatorDescription \{type=([^}]+)\}, ComponentInfo\{([^/}]+)\//.exec(line);
        if (a && !owners.has(a[1].trim())) owners.set(a[1].trim(), a[2].trim());
        if (!/^\s*Account \{/.test(line)) continue;
        const m = /Account \{name=(.*), type=([^}\s]+)\}/.exec(line);
        if (m && m[1].trim()) seen.set(`${m[2]}|${m[1].trim()}`, { name: m[1].trim(), type: m[2] });
    }
    return [...seen.values()].map((x) => Object.assign(x, owners.has(x.type) ? { package: owners.get(x.type) } : {}));
}

/** The name an account of [pkg] shows as the user: not the app's own name ("Signal"), not a bare number id. */
function accountNameFor(pkg, list) {
    const own = (Array.isArray(list) ? list : []).filter((a) => a && a.package === pkg && typeof a.name === 'string');
    const label = String(appLabel(pkg) || '').toLowerCase();
    const good = own.map((a) => a.name.trim()).filter((n) => n && n.length <= 120 && n.toLowerCase() !== label && !/^\d{1,6}$/.test(n));
    return good[0] || '';
}

/** Read the phone's accounts and keep each listed app's user name (recent[pkg].acct). Returns the packages that changed. */
async function learnAccounts(deviceId) {
    const id = String(deviceId || '');
    if (!id || Date.now() - (accountsAsked.get(id) || 0) < ACCOUNTS_EVERY_MS) return [];
    accountsAsked.set(id, Date.now());
    let list = null;
    try {
        const res = await activeSync().serverCall(resources(), null, id, 'apps.accounts', {}, { timeoutMs: 30000 });
        if (res && Array.isArray(res.accounts) && res.accounts.length) list = res.accounts;
    } catch (_) { list = null; }
    if (!list) {
        try {
            const res = await require('./deviceAdb').shell(resources(), id, ACCOUNTS_CMD);
            if (res && res.output) list = parseDumpsysAccounts(res.output);
        } catch (_) { list = null; }
    }
    if (!list) { accountsAsked.set(id, Date.now() - ACCOUNTS_EVERY_MS + 30 * 60 * 1000); return []; }
    const r = loadRecent();
    const pkgs = new Set(list.map((a) => a && a.package).filter((p) => PACKAGE_RE.test(String(p || ''))));
    const changed = [];
    for (const pkg of new Set([...pkgs, ...Object.keys(r)])) {
        if (!r[pkg] && ![...providers].some((p) => p.pkg === pkg)) continue;
        const name = accountNameFor(pkg, list);
        const was = r[pkg] ? r[pkg].acct || '' : '';
        if (name === was) continue;
        if (!r[pkg]) r[pkg] = { label: appLabel(pkg) || pkg, at: Date.now(), icon: hasAppIcon(pkg), channels: {}, me: '' };
        if (name) r[pkg].acct = name; else delete r[pkg].acct;
        changed.push(pkg);
    }
    if (changed.length) saveRecent();
    return changed;
}

/**
 * A conversation's community (#978): { id, server, serverId, channel, channelId } when it comes from one of the
 * app's server channels (COMMUNITIES), else null. Its title names the server and the channel ("Midwest Safety
 * Squad #daily-polls"); an event's ("Your event is starting in Asmongold") only the server. A conversation
 * stored before its channel was kept: the merged servers account's are marked community, the rest go by the title.
 */
function communityOf(pkg, c) {
    const spec = COMMUNITIES[pkg];
    if (!spec || !c) return null;
    const title = String(c.title || '').trim();
    const ch = String(c.channel || '');
    const at = title.lastIndexOf(' #');
    const event = /\bin (.+)$/.exec(title);
    const on = ch ? spec.channels.includes(ch) : (c.community === true || at > 0 || /^your event\b/i.test(title));
    if (!on) return null;
    let server = '';
    let channel = '';
    if (at > 0) { server = title.slice(0, at).trim(); channel = title.slice(at + 1).trim(); }
    else if (event && (/^(guildEventLive|stageLive)$/.test(ch) || /^your event\b/i.test(title))) server = event[1].trim();
    else server = String(c.sub || '').trim() || title || 'Other';
    const serverId = hash(server.toLowerCase(), 10);
    const channelId = channel ? hash(channel.toLowerCase(), 10) : '';
    return { id: channelId ? `${serverId}:${channelId}` : serverId, server, serverId, channel, channelId };
}

/** The folder a community conversation is in for a folder id 'community', 'community:<server>' or 'community:<server>:<channel>'. */
function inCommunityFolder(community, folder) {
    if (!community) return false;
    const f = String(folder || '');
    if (f === 'community') return true;
    const [, sid, cid] = f.split(':');
    if (!sid || community.serverId !== sid) return false;
    return !cid || community.channelId === cid;
}

/** An app's communities folder name ('Communities'), or '' when the app has none. */
function communitiesLabel(pkg) { return COMMUNITIES[pkg] ? COMMUNITIES[pkg].label : ''; }
/** The app's notification channels: the ones it posted on lately and the known ones, [{ id, name, seen }]. */
function channelsOf(pkg) {
    const r = loadRecent()[pkg];
    const seen = (r && r.channels) || {};
    const names = CHANNEL_NAMES[pkg] || {};
    const ids = [...new Set(Object.keys(seen).concat(Object.keys(names)))];
    return ids.map((id) => ({ id, name: names[id] || id, seen: !!seen[id] }))
        .sort((a, b) => (b.seen - a.seen) || a.name.localeCompare(b.name));
}

/**
 * The provider a notification of [pkg] on [channel] belongs to: the one listing the channel, else the one with
 * no list, else the first by id (the account made first: app-discord before app-discord-servers).
 */
function routeOf(pkg, channel) {
    const mine = [...providers].filter((p) => p.pkg === pkg).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!mine.length) return null;
    const ch = String(channel || '');
    return (ch && mine.find((p) => p.channels.includes(ch))) || mine.find((p) => !p.channels.length) || mine[0];
}

/** Whether the phone has sent the app's icon. */
function hasAppIcon(pkg) { return PACKAGE_RE.test(String(pkg || '')) && fs.existsSync(iconFile(pkg)); }

/** The app's icon (PNG bytes) or null. */
function appIcon(pkg) {
    if (!PACKAGE_RE.test(String(pkg || ''))) return null;
    try { return fs.readFileSync(iconFile(pkg)); } catch (_) { return null; }
}

// ---------------------------------------------------------------- the phone's events

function tap() {
    if (tapped) return;
    tapped = true;
    // a phone that (re)connects: what it shows now, once its link is up (a restart, an app update)
    const as = activeSync();
    if (typeof as.onDeviceHello === 'function') {
        as.onDeviceHello((d) => {
            if (!d || d.speaker !== 'service' || d.session !== 'partner') return;
            // a test device's notifications (the emulator's test posts) are not the household's messages
            if (d.test) return;
            caughtUp.add(d.id);
            const t = setTimeout(() => { for (const p of providers) p.syncDevice(d.id, d.name); }, 5000);
            if (t.unref) t.unref();
        });
    }
    as.onDeviceEvent((name, detail, device) => {
        // the first news from a phone since this server started: it may have connected before the
        // accounts listened (a restart race), so what it shows now is read once
        const id = device && device.id;
        // a test device (modules/testDevices.js) is never read into the household's accounts
        if (id && (() => { try { return require('./testDevices').isTestDevice(id); } catch (_) { return false; } })()) return;
        if (id && !caughtUp.has(id)) {
            caughtUp.add(id);
            for (const p of providers) void p.syncDevice(id, device.name);
        }
        if (!detail || typeof detail !== 'object') return;
        if (name === 'notify.posted' && PACKAGE_RE.test(String(detail.package || ''))) {
            noteApp(detail);
            const p = routeOf(detail.package, detail.channel);
            if (p) p.take(detail, device && device.id, device && device.name);
        } else if (name === 'notify.removed' && detail.key) {
            for (const p of providers) p.removed(String(detail.key));
        }
    });
}

// ---------------------------------------------------------------- the provider

class AndroidAppProvider {
    constructor(account, hooks) {
        this.id = account.id;
        this.pkg = String(account.package || '');
        this.ownLabel = realLabel(account.label, this.pkg);
        this.channels = cleanChannels(account.channels);
        this.ownUsername = str(account.username, 80).trim();
        this.learnedLabel = '';
        this.hooks = hooks || {};
        this.status = 'connecting';
        this.error = '';
        this.device = '';
        this.deviceName = '';
        this.store = null;
        // the account's switches (#885, Nov 21 2026: communityUnread, communityNotify); a save restarts the provider
        this.settings = Object.assign({}, account.settings || {});
        // notifications this provider dismissed itself (communityNotify off): their removal is not a read
        this.selfDismissed = new Set();
    }

    /** The app's name: the account's own, else what the phone said (it can arrive later, #892), else the package. */
    get label() { return String(this.ownLabel || this.learnedLabel || appLabel(this.pkg) || this.pkg); }
    set label(v) { this.learnedLabel = realLabel(v, this.pkg); }

    get kind() { return 'android'; }

    identity() { return this.deviceName || ''; }

    /** Who is signed in to the app: the account's own name for it, else what the app's notifications say, else Android's account list. */
    get username() { return this.ownUsername || appUser(this.pkg) || appAccount(this.pkg); }

    features() {
        // reply = a reply to one message (threads); quickReply = the notification's own reply
        return { privateApi: false, attachments: false, tapbacks: false, edit: false, unsend: false, reply: false, quickReply: true, typing: false, readReceipts: false, newChat: false, effects: false, pairing: false, deleteChat: true, actions: true };
    }

    log(m) { if (this.hooks.log) this.hooks.log(m); else console.warn(`[textMessaging:android] ${m}`); }

    emit(event, payload) { if (this.hooks.emit) this.hooks.emit(event, Object.assign({ accountId: this.id }, payload || {})); }

    async start() {
        if (!PACKAGE_RE.test(this.pkg)) { this.status = 'error'; this.error = 'No Android app was chosen for this account.'; return; }
        tap();
        providers.add(this);
        this.status = 'connected';
        this.emit('account', {});
        // what the phone shows now (a reply the server missed while it restarted)
        const t = setTimeout(() => this.startSync(), 8000);
        if (t.unref) t.unref();
    }

    stop() { providers.delete(this); }

    /** What the partnered phones show now (notify.list), taken like new posts. */
    startSync() {
        if (this.syncing || !providers.has(this)) return;
        this.syncing = true;
        (async () => {
            let links = [];
            try { links = activeSync().partnerLinks(resources(), null); } catch (_) { links = []; }
            for (const l of links) await this.syncDevice(l.deviceId, l.name);
        })().finally(() => { this.syncing = false; });
    }

    /** Send/Receive (#978): every partnered phone's notifications of this app now, waited for. */
    async sendReceive() {
        let links = [];
        try { links = activeSync().partnerLinks(resources(), null); } catch (_) { links = []; }
        if (!links.length) throw Object.assign(new Error('No phone is connected to send this app\'s notifications.'), { code: 'NO_DEVICE' });
        for (const l of links) await this.syncDevice(l.deviceId, l.name);
        return { ok: true };
    }

    /**
     * One phone's notifications of this app now. Lines that are new count as arrivals (the server or
     * the phone was away when they came); what is already stored is not announced again.
     */
    async syncDevice(deviceId, deviceName) {
        if (!providers.has(this)) return;
        try {
            const res = await activeSync().serverCall(resources(), null, deviceId, 'notify.list', {}, { timeoutMs: CALL_MS });
            for (const n of (res && res.notifications) || []) if (n && n.package === this.pkg && routeOf(this.pkg, n.channel) === this) this.take(n, deviceId, deviceName);
        } catch (_) { /* that phone does not send notifications */ }
        await this.learnFrom(deviceId);
    }

    /**
     * The app's name and icon when they are not known yet (an app in the Work profile used to come without
     * either, #892): asked from the phone (apps.icon, which answers the label too from DSApp builds after
     * Nov 17), instead of waiting for its next notification.
     */
    async learnFrom(deviceId) {
        // the apps' users from the phone's account list (#978): once per phone for every app account
        learnAccounts(deviceId).then((changed) => {
            for (const p of providers) if (changed.includes(p.pkg)) p.emit('account', {});
        }, (error) => this.log(`accounts: ${error.message}`));
        if (this.ownLabel && hasAppIcon(this.pkg)) return;
        if (appLabel(this.pkg) && hasAppIcon(this.pkg)) return;
        try {
            const res = await activeSync().serverCall(resources(), null, deviceId, 'apps.icon', { package: this.pkg, size: 48 }, { timeoutMs: CALL_MS });
            if (!res) return;
            learnApp({ package: this.pkg, label: res.label, icon: res.icon });
            if (!this.ownLabel) { const l = realLabel(res.label, this.pkg); if (l) this.label = l; }
        } catch (error) { this.log(`apps.icon: ${error.message}`); }
    }

    // ---- taking a notification ----

    chatGuidOf(d) {
        const c = d.conv && typeof d.conv === 'object' ? d.conv : {};
        const basis = c.shortcut || c.title || d.title || d.app || this.pkg;
        return `a${hash(`${this.pkg}|${basis}`)}`;
    }

    rawChat(guid) {
        const r = this.store && this.store.getChat(this.id, guid);
        return r ? r.raw : null;
    }

    putChat(raw) {
        if (!this.store) return;
        try { this.store.putChats(this.id, [{ guid: raw.guid, raw, lastDate: raw.lastDate || 0 }]); } catch (error) { this.log(`store write failed: ${error.message}`); }
    }

    /** The lines in a posted notification: [{ text, time, sender, senderKey, me }], oldest first. */
    linesOf(d) {
        const out = [];
        if (Array.isArray(d.messages) && d.messages.length) {
            for (const m of d.messages.slice(-25)) {
                if (!m || typeof m !== 'object') continue;
                const text = str(m.text, 2000).trim();
                const image = typeof m.image === 'string' ? m.image : '';
                if (!text && !image) continue;
                out.push({ text, time: Number(m.time) || Number(d.time) || Date.now(), sender: str(m.sender, 120), senderKey: str(m.senderKey || m.sender, 200), me: m.me === true, styled: true, image });
            }
        }
        if (!out.length) {
            const text = str(d.text, 2000).trim();
            const title = str(d.title, 200).trim();
            if (!text && !title) return out;
            out.push({ text: text || title, time: Number(d.time) || Date.now(), sender: text ? title : '', senderKey: text ? title : '', me: false, styled: false, key: String(d.key || ''), image: typeof d.picture === 'string' ? d.picture : '' });
        }
        return out;
    }

    take(d, deviceId, deviceName, { old = false } = {}) {
        if (!this.store) return;
        // notify.list sends every app's icon again: the catch-up keeps it like a live post does
        if (d.icon) noteApp(d);
        // the app's real name arrived (a build that reads the Work profile, #892): the account takes it unless it was named
        if (!this.ownLabel) { const l = realLabel(d.app, this.pkg); if (l && l !== this.label) this.label = l; }
        const guid = this.chatGuidOf(d);
        const prev = this.rawChat(guid);
        const conv = d.conv && typeof d.conv === 'object' ? d.conv : {};
        const isGroup = conv.group === true;
        const lines = this.linesOf(d);
        if (!lines.length) return;
        const actions = (Array.isArray(d.actions) ? d.actions : []).filter((a) => a && Number.isInteger(a.i) && a.title).slice(0, 8)
            .map((a) => ({ i: a.i, title: str(a.title, 60), reply: a.reply === true, semantic: Number(a.semantic) || 0 }));
        const replyAction = actions.find((a) => a.reply);
        const chat = Object.assign({ readAt: 0, lastDate: 0 }, prev || {}, {
            guid,
            package: this.pkg,
            app: str(realLabel(d.app, this.pkg) || this.label, 80),
            title: str(conv.title || (isGroup ? '' : (lines.find((l) => !l.me) || {}).sender) || d.title || realLabel(d.app, this.pkg) || this.label, 200),
            sub: str(d.sub, 120),
            isGroup,
            // the notification channel it came on: a community conversation or the Inbox (#978)
            channel: typeof d.channel === 'string' && CHANNEL_RE.test(d.channel) ? d.channel : ((prev && prev.channel) || ''),
            key: str(d.key, 300),
            device: String(deviceId || (prev && prev.device) || ''),
            actions,
            reply: replyAction ? replyAction.i : null
        });
        // what a tap opens: kept after the notification is gone (the phone keeps its intent too)
        if (d.opens && d.key) { chat.openKey = str(d.key, 300); chat.openDevice = String(deviceId || chat.device || ''); }
        if (deviceId) { this.device = String(deviceId); if (deviceName) this.deviceName = String(deviceName); }
        if (d.avatar) {
            const buf = dataUrlBytes(d.avatar);
            if (buf && writeFileQuiet(this.avatarFile(guid), buf)) chat.photo = Date.now();
        }

        // the lines not stored yet
        const rows = lines.map((l) => {
            const id = l.styled ? `${guid}|${l.time}|${l.senderKey}|${l.text}` : `${guid}|${l.key}|${l.text}`;
            return Object.assign({ guid: `a${hash(id, 24)}` }, l);
        });
        const have = this.store.getMessages(this.id, rows.map((r) => r.guid));
        const fresh = rows.filter((r) => !have.has(r.guid));
        // your reply from here comes back in the app's next notification: it is the one already shown
        const kept = [];
        for (const r of fresh) {
            if (r.me) {
                const local = this.localMatch(guid, r);
                if (local) continue;
            }
            kept.push(r);
        }
        const msgs = kept.map((r) => {
            const m = { guid: r.guid, chatGuid: guid, text: r.text, date: r.time, fromMe: r.me, sender: r.me ? 'Me' : r.sender, senderKey: r.me ? '' : r.senderKey };
            // its picture, sent once by the phone: kept beside the store as the message's attachment
            const pic = r.image ? this.keepImage(guid, r.guid, r.image) : null;
            if (pic) m.images = [pic];
            return m;
        });
        if (msgs.length) {
            try { this.store.putMessages(this.id, msgs.map((m) => ({ guid: m.guid, chatGuid: guid, date: m.date, text: m.text, raw: m }))); } catch (error) { this.log(`store write failed: ${error.message}`); }
        }
        const newest = msgs.reduce((a, m) => (!a || m.date >= a.date ? m : a), null);
        if (newest && newest.date >= (chat.lastDate || 0)) {
            chat.lastDate = newest.date;
            chat.lastText = newest.text || (newest.images ? 'Picture' : '');
            chat.lastFromMe = newest.fromMe;
            chat.lastSender = newest.sender;
            chat.lastGuid = newest.guid;
        }
        // a notification shown again after it was read is a new arrival only for lines newer than the read
        this.putChat(chat);
        if (!prev) this.emit('chat', { chatGuid: guid });
        for (const m of msgs.sort((a, b) => a.date - b.date)) {
            if (old || (chat.readAt && m.date <= chat.readAt)) continue;
            this.emit('message', { chatGuid: guid, message: this.normalizeMessage(m), chat });
        }
        if (prev && (prev.key !== chat.key || JSON.stringify(prev.actions) !== JSON.stringify(chat.actions))) this.emit('chat', { chatGuid: guid });
        // Communities notifications off (Yukimi, Nov 21 2026: "an option on discord in accounts ... to not show notifications for
        // communities"): the server channel's message is kept here, and the app's own notification for it goes from the phone
        if (!old && this.settings.communityNotify === false && chat.key && chat.device && communityOf(this.pkg, chat)) this.dismissOwn(chat);
    }

    /** Take the app's notification for this conversation off the phone without counting it as read (removed() skips it). */
    dismissOwn(chat) {
        const key = chat.key;
        this.selfDismissed.add(key);
        if (this.selfDismissed.size > 200) this.selfDismissed.delete(this.selfDismissed.values().next().value);
        activeSync().serverCall(resources(), null, chat.device, 'notify.dismiss', { key }, { timeoutMs: CALL_MS }).catch((error) => { this.selfDismissed.delete(key); this.log(`notify.dismiss: ${error.message}`); });
    }

    localMatch(chatGuid, r) {
        const rows = this.store.listMessages(this.id, chatGuid, { limit: 20 });
        return rows.find((m) => m.local && m.fromMe && m.text === r.text && Math.abs((m.date || 0) - r.time) < LOCAL_MATCH_MS) || null;
    }

    /** The phone no longer shows that notification: read in the app, swiped, or answered. */
    removed(key) {
        if (!this.store) return;
        for (const row of this.store.listChats(this.id, { limit: 200 })) {
            const c = row.raw;
            if (!c || c.key !== key) continue;
            c.key = '';
            c.reply = null;
            c.actions = [];
            // taken off the phone by this provider (Communities notifications off): the conversation stays unread
            if (this.selfDismissed.delete(key)) { this.putChat(c); this.emit('chat', { chatGuid: c.guid }); continue; }
            const wasUnread = this.isUnread(c);
            if (wasUnread) c.readAt = Math.max(c.lastDate || 0, Date.now());
            this.putChat(c);
            this.emit(wasUnread ? 'read' : 'chat', { chatGuid: c.guid, read: true });
        }
    }

    // ---- shapes ----

    avatarFile(chatGuid) { return path.join(dir(), 'textmessaging-android', this.id, `${String(chatGuid).replace(/[^a-z0-9]/gi, '')}.png`); }

    imageDir(chatGuid) { return path.join(dir(), 'textmessaging-android', this.id, 'img', String(chatGuid).replace(/[^a-z0-9]/gi, '')); }

    /** A message's picture (a JPEG / PNG / WEBP data URL from the phone) written once: { id, mime, size } or null. */
    keepImage(chatGuid, msgGuid, url) {
        const m = /^data:image\/(png|jpeg|webp);/.exec(String(url || ''));
        const buf = m ? dataUrlBytes(url) : null;
        if (!buf) return null;
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const id = `${String(chatGuid).replace(/[^a-z0-9]/gi, '')}.${String(msgGuid).replace(/[^a-z0-9]/gi, '')}.${ext}`;
        if (!writeFileQuiet(path.join(this.imageDir(chatGuid), id.slice(id.indexOf('.') + 1)), buf)) return null;
        return { id, mime: `image/${m[1]}`, size: buf.length };
    }

    attachmentOf(img) {
        const base = `/api/textmessaging/${encodeURIComponent(this.id)}/attachment/${encodeURIComponent(img.id)}`;
        return { guid: img.id, name: 'Picture', mime: img.mime, size: img.size || 0, width: null, height: null, sticker: false, url: base, thumbUrl: null };
    }

    contactAvatar(key) {
        if (key === 'app') return appIcon(this.pkg);
        try { return fs.readFileSync(this.avatarFile(key)); } catch (_) { return null; }
    }

    isUnread(c) { return !!c && !c.lastFromMe && (c.lastDate || 0) > (c.readAt || 0); }

    normalizeMessage(m) {
        return {
            guid: m.guid,
            chatGuid: m.chatGuid,
            text: m.text || '',
            subject: '',
            fromMe: !!m.fromMe,
            sender: m.fromMe ? { address: '', name: 'Me', me: true } : { address: m.senderKey || m.sender || '', name: m.sender || '', me: false },
            date: m.date || 0,
            dateDelivered: null,
            dateRead: null,
            dateEdited: null,
            retracted: false,
            error: 0,
            service: this.label,
            replyTo: null,
            effect: null,
            groupEvent: null,
            attachments: Array.isArray(m.images) ? m.images.map((x) => this.attachmentOf(x)) : [],
            reactions: []
        };
    }

    normalizeChat(c) {
        if (!c) return null;
        const base = `/api/textmessaging/${encodeURIComponent(this.id)}/avatar/`;
        const photo = c.photo ? `${base}${encodeURIComponent(c.guid)}?v=${c.photo}` : (hasAppIcon(this.pkg) ? `${base}app` : null);
        const name = c.title || realLabel(c.app, this.pkg) || this.label;
        const last = c.lastDate ? {
            guid: c.lastGuid || '', chatGuid: c.guid, text: c.lastText || '', fromMe: !!c.lastFromMe,
            sender: { address: '', name: c.lastFromMe ? 'Me' : (c.lastSender || ''), me: !!c.lastFromMe }, date: c.lastDate, attachments: [], reactions: []
        } : null;
        const unread = this.isUnread(c);
        return {
            guid: c.guid,
            identifier: c.sub || realLabel(c.app, this.pkg) || this.label,
            title: name,
            photo,
            named: true,
            isGroup: !!c.isGroup,
            participants: [{ address: c.guid, display: name, name, service: this.label, photo }],
            service: this.label,
            archived: false,
            spam: false,
            last,
            unread,
            readSince: unread ? (c.readAt || 0) : null,
            // what the notification on the phone offers now (gone with the notification)
            canReply: c.reply != null && !!c.key,
            actions: c.key ? (c.actions || []).filter((a) => !a.reply).map((a) => ({ id: a.i, title: a.title })) : [],
            sub: c.sub || '',
            // Open in <app> (#885): the notification's own tap target on the phone that posted it, else the app
            package: this.pkg,
            app: realLabel(c.app, this.pkg) || this.label,
            open: c.openKey ? { key: c.openKey, device: c.openDevice || c.device || '' } : null,
            // a server channel's conversation (#978): in the account's Communities folder, not its Inbox
            community: communityOf(this.pkg, c)
        };
    }

    // ---- reads ----

    async listChats({ limit = 50, offset = 0 } = {}) {
        if (!this.store) return [];
        return this.store.listChats(this.id, { limit, offset }).map((r) => this.normalizeChat(r.raw));
    }

    async getChat(chatGuid) { return this.normalizeChat(this.rawChat(chatGuid)); }

    async listMessages(chatGuid, { limit = 50, before = null } = {}) {
        if (!this.store) return { messages: [], more: false, cursor: null };
        const b = before != null && /^\d+$/.test(String(before)) ? Number(before) : null;
        const rows = this.store.listMessages(this.id, chatGuid, { limit: limit + 1, before: b });
        const page = rows.slice(0, limit);
        const out = page.map((m) => this.normalizeMessage(m)).sort((a, c) => a.date - c.date);
        const oldest = page.length ? Math.min(...page.map((m) => m.date || 0)) : null;
        return { messages: out, more: rows.length > limit, cursor: oldest ? String(oldest) : null };
    }

    async countIncoming(chatGuid, since) {
        return this.store.listMessages(this.id, chatGuid, { limit: 99 }).filter((m) => !m.fromMe && (m.date || 0) > (Number(since) || 0)).length;
    }

    async searchMessages(q, { limit = 40 } = {}) {
        if (!this.store) return [];
        return this.store.search(q, { account: this.id, limit }).map((r) => this.normalizeMessage(r.raw)).filter((m) => m.text);
    }

    // ---- writes ----

    deviceOf(c) {
        const id = (c && c.device) || this.device;
        if (!id) throw Object.assign(new Error(`${this.label} has not sent a notification from the phone yet.`), { code: 'NO_DEVICE' });
        return id;
    }

    async sendText({ chatGuid, addresses, text, tempGuid }) {
        if (!chatGuid) {
            void addresses;
            throw Object.assign(new Error(`New conversations cannot be started here. Start it in ${this.label} on the phone.`), { code: 'UNSUPPORTED' });
        }
        const c = this.rawChat(chatGuid);
        if (!c) throw Object.assign(new Error('That conversation is not here any more.'), { code: 'NOT_FOUND' });
        if (c.reply == null || !c.key) throw Object.assign(new Error(`${this.label} does not offer a reply to this conversation now. Reply in ${this.label} on the phone.`), { code: 'NO_REPLY' });
        const body = String(text || '').trim();
        if (!body) throw Object.assign(new Error('Type a message.'), { code: 'EMPTY' });
        await activeSync().serverCall(resources(), null, this.deviceOf(c), 'notify.reply', { key: c.key, action: c.reply, text: body }, { timeoutMs: CALL_MS });
        const now = Date.now();
        const m = { guid: `l${hash(`${chatGuid}|${now}|${body}`, 24)}`, chatGuid, text: body, date: now, fromMe: true, sender: 'Me', senderKey: '', local: true };
        try { this.store.putMessages(this.id, [{ guid: m.guid, chatGuid, date: now, text: body, raw: m }]); } catch (error) { this.log(`store write failed: ${error.message}`); }
        Object.assign(c, { lastDate: now, lastText: body, lastFromMe: true, lastSender: 'Me', lastGuid: m.guid, readAt: now });
        this.putChat(c);
        const message = this.normalizeMessage(m);
        this.emit('message', { chatGuid, message, chat: c });
        return { tempGuid: tempGuid || m.guid, chatGuid, message };
    }

    async sendAttachment() { throw Object.assign(new Error(`Pictures and files cannot be sent to ${this.label} from here.`), { code: 'UNSUPPORTED' }); }

    /** One of the notification's own actions (chat.actions[].id). */
    async action({ chatGuid, action }) {
        const c = this.rawChat(chatGuid);
        const a = c && c.key && (c.actions || []).find((x) => x.i === Number(action));
        if (!a) throw Object.assign(new Error('The notification on the phone no longer offers that.'), { code: 'NO_ACTION' });
        await activeSync().serverCall(resources(), null, this.deviceOf(c), 'notify.action', { key: c.key, action: a.i }, { timeoutMs: CALL_MS });
        if (a.semantic === SEMANTIC_MARK_AS_READ && this.isUnread(c)) {
            c.readAt = Date.now();
            this.putChat(c);
            this.emit('read', { chatGuid, read: true });
        }
        return { ok: true };
    }

    /**
     * Open in <app>: on the phone that posted it, what a tap on the conversation's newest notification
     * opens (Discord at that channel); when the phone no longer knows it, the app itself.
     * { opened: 'notification' | 'app' }.
     */
    async open({ chatGuid }) {
        const c = this.rawChat(chatGuid);
        if (!c) throw Object.assign(new Error('That conversation is not here any more.'), { code: 'NOT_FOUND' });
        const device = c.openDevice || this.deviceOf(c);
        if (c.openKey) {
            let ok = false;
            try { ok = (await activeSync().serverCall(resources(), null, device, 'notify.open', { key: c.openKey }, { timeoutMs: CALL_MS })) === true; } catch (error) { this.log(`notify.open: ${error.message}`); }
            if (ok) return { opened: 'notification' };
        }
        try {
            await activeSync().serverCall(resources(), null, device, 'apps.manage', { package: this.pkg, action: 'open' }, { timeoutMs: CALL_MS });
        } catch (error) {
            throw Object.assign(new Error(`${this.label} could not be opened on the phone. ${error.message || ''}`.trim()), { code: error.code || 'OPEN_FAILED' });
        }
        return { opened: 'app' };
    }

    async markRead({ chatGuid }) {
        const c = this.rawChat(chatGuid);
        if (!c) return { ok: false };
        const was = this.isUnread(c);
        c.readAt = Math.max(Date.now(), c.lastDate || 0);
        this.putChat(c);
        // the phone follows: the app's own Mark as read, else its notification goes
        if (was && c.key && c.device) {
            const mark = (c.actions || []).find((x) => x.semantic === SEMANTIC_MARK_AS_READ);
            const op = mark ? 'notify.action' : 'notify.dismiss';
            const args = mark ? { key: c.key, action: mark.i } : { key: c.key };
            activeSync().serverCall(resources(), null, c.device, op, args, { timeoutMs: CALL_MS }).catch((error) => this.log(`${op}: ${error.message}`));
        }
        return { ok: true };
    }

    async markUnread() { return { ok: true }; }

    async typing() { return { ok: true }; }

    async react() { throw Object.assign(new Error('Reactions cannot be sent to an Android app from here.'), { code: 'UNSUPPORTED' }); }

    async edit() { throw Object.assign(new Error('Messages cannot be edited here.'), { code: 'UNSUPPORTED' }); }

    async unsend() { throw Object.assign(new Error('Messages cannot be unsent here.'), { code: 'UNSUPPORTED' }); }

    async deleteChat({ chatGuid }) {
        if (this.store) this.store.deleteChat(this.id, chatGuid);
        try { fs.unlinkSync(this.avatarFile(chatGuid)); } catch (_) { /* none */ }
        fs.promises.rm(this.imageDir(chatGuid), { recursive: true, force: true }).catch(() => {});
        return { ok: true };
    }

    /** The account is deleted: its pictures go with it. */
    forget() { fs.promises.rm(path.join(dir(), 'textmessaging-android', this.id), { recursive: true, force: true }).catch(() => {}); }

    /** A message's picture (attachment guid <chat>.<message>.<ext>), the face of a fetch Response. */
    async downloadAttachment(guid) {
        const m = /^([a-z0-9]+)\.([a-z0-9]+)\.(jpg|png|webp)$/i.exec(String(guid || ''));
        if (!m) throw Object.assign(new Error('Unknown attachment.'), { code: 'NOT_FOUND', status: 404 });
        let buf;
        try { buf = await fs.promises.readFile(path.join(this.imageDir(m[1]), `${m[2]}.${m[3]}`)); } catch (_) {
            throw Object.assign(new Error('Unknown attachment.'), { code: 'NOT_FOUND', status: 404 });
        }
        const type = m[3] === 'jpg' ? 'image/jpeg' : `image/${m[3]}`;
        return {
            headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? type : null) },
            arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)
        };
    }

    async test() { return { ok: true }; }
}

function _reset() { providers.clear(); caughtUp.clear(); accountsAsked.clear(); recent = null; cacheDir = null; tapped = false; }

module.exports = {
    AndroidAppProvider, recentApps, appIcon, hasAppIcon, appLabel, appUser, appAccount, channelsOf, cleanChannels, DEFAULT_SPLITS, COMMUNITIES, realLabel, learnApp, PACKAGE_RE,
    communityOf, inCommunityFolder, communitiesLabel, parseDumpsysAccounts, accountNameFor, learnAccounts,
    _reset, _setCacheDir: (d) => { cacheDir = d; }
};
