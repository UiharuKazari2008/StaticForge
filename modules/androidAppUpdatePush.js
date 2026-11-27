/**
 * Android app updates pushed to the phones (Yozora #821, part 2: the server's delivery side).
 *
 * A build of the Dreamscape app (modules/androidBuilds.js) is a Release. A phone running an older build
 * gets the new APK sent to it and staged through Melaton Updates. The server never asks for an install here:
 * apps.update asks the phone to check and stage the file, and the app installs a staged update itself, silently
 * (the page's Restart Now, or on its own, see below; that may happen before apps.update is answered).
 *
 * Triggers (events only, no timers, no polling, no retry loops: rules server-push-not-polling and
 * phone-power-server):
 *   - a phone's hello (activeSync.onDeviceHello): its `app` string is `Dreamscape/<versionName>+<versionCode>`;
 *     the version is recorded (androidBuilds.recordDeviceVersion), a delivery the phone has caught up with
 *     becomes 'installed', and the newest release is offered when the phone is behind it;
 *   - androidBuilds.events 'release': every online phone that is behind it;
 *   - the phone's as_event apps.updateWaiting with state 'resend' (below).
 *
 * Delivery: the APK goes to the phone's temporary folder with the ActiveSync transfer machinery
 * (sendServerFile below: stream.receive temp, the phone pulls it), then op apps.update
 * { temp, name, versionCode, versionName, sha256, size, buildId, sha } asks the phone to check and stage it.
 * Pushed only when: not held, the phone is online with a connection and permits files and control, its background
 * service answers apps.update (the hello's ops), its reported versionCode is > 0 and < the release's (an app without
 * +<code> is an old build with no apps.update), and no delivery for this versionCode is staged / sending (and running) /
 * waiting / installed. One at a time per phone, at most MAX_ATTEMPTS per versionCode (a resend starts the attempts
 * again). A 'failed' delivery is tried again at the phone's next hello, the next release or a resend, nothing else.
 *
 * The app never opens Android's installer (StaticForge #1309): when no silent route (Shizuku, local ADB 5555) is up, or
 * every route failed, the install does not happen. The app tells the server why (as_event apps.updateWaiting, state
 * 'waiting'): the delivery becomes 'waiting' with the reason, and Fleet is told quietly, once per phone + versionCode +
 * reason (fleetNotices kind appUpdate: the Supervisor's manager note; the phone only when that switch is on in Fleet
 * Manager). An older app build keeps the staged file and installs it by itself when a route is back.
 *
 * A newer app build leaves no APK on the phone (StaticForge #1332): the file is removed as soon as its install answers.
 * So when a silent route is back it sends apps.updateWaiting with state 'resend' (why ''): the delivery is recorded
 * 'failed' with no attempts ("asked again") and the latest release is offered under the same rules as above; the app
 * installs it by itself once staged. Ignored when the phone is already at that versionCode or newer, while its delivery
 * is 'sending' or 'installed', and after MAX_RESENDS per phone + versionCode (the count lives in the delivery record's detail). The record of a newer or of the latest
 * release is never rewritten for a resend of another versionCode. No Fleet notice for a resend. A 'waiting' report (or
 * a resend) that arrives while apps.update is being answered wins over that answer. The phone's hello at the new
 * versionCode makes the delivery 'installed'.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const activeSync = require('./activeSync');

const APPS_UPDATE = 'apps.update';
const MAX_ATTEMPTS = 3;                 // per phone and versionCode, kept in the delivery record (a new release starts again)
const UPDATE_TIMEOUT_MS = 120000;       // the phone checks size + sha256 of the file and moves it
const MAX_RESENDS = 6;                  // per phone and versionCode: how often the phone may ask for the file again
const DETAIL_MAX = 300;                 // androidBuilds.recordDelivery cuts a longer detail, and cut JSON loses its counts
const APP_RE = /^Dreamscape\/(.*)\+(\d{1,10})$/;

const tappedOn = new WeakSet();         // onDeviceHello has no unregister: the tap stays (once per activeSync) and checks ctx
let ctx = null;                         // { globalResources, builds, as, sendFile, log }
const inflight = new Set();             // deviceId with a delivery running
const supports = new Set();             // deviceId whose background service said it answers apps.update
const askedAgain = new Set();           // deviceId that asked for the file again while its delivery was still running
const capTold = new Set();              // `${deviceId}|${versionCode}` whose resend cap was logged

/** `Dreamscape/<name>+<code>` -> { versionName, versionCode }; an app without +<code> is an old build (code 0). */
function parseApp(app) {
    const s = String(app == null ? '' : app).trim();
    const m = APP_RE.exec(s);
    if (!m) return { versionName: s.replace(/^Dreamscape\//, ''), versionCode: 0 };
    return { versionName: m[1], versionCode: Number(m[2]) };
}

function answersUpdate(ops) {
    const list = Array.isArray(ops) ? ops : [];
    return list.includes(APPS_UPDATE) || list.includes('apps.*');
}

function short(v) {
    let s;
    try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch (_) { s = String(v); }
    return String(s == null ? '' : s).slice(0, 300);
}

function record(deviceId, versionCode, state, detail) {
    try { ctx.builds.recordDelivery(deviceId, versionCode, state, detail == null ? '' : short(detail)); } catch (error) { ctx.log(`delivery not recorded: ${error.message}`); }
}

/**
 * The counts live in the delivery record's detail (a JSON text, androidBuilds keeps it as a string and it
 * survives a restart): { attempts, gaveUp?, resends?, info } or, for a wait, { attempts, resends?, why }
 * ('installed' is plain text unless there were resends). A record in any other form counts as nothing.
 */
function detailOf(prior) {
    let d = prior && prior.detail;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = null; } }
    return d && typeof d === 'object' ? d : {};
}

function countOf(prior, code, key) {
    if (!prior || prior.versionCode !== code) return 0;
    return Math.max(0, Number(detailOf(prior)[key]) || 0);
}

function deliveryOf(deviceId) {
    try { return ctx.builds.deliveryOf(deviceId); } catch (_) { return null; }
}

/** The detail text: the counts and one text field, the text shortened until the JSON fits (escapes make it longer). */
function packDetail(counts, key, text) {
    let t = text.slice(0, 150);
    let out = JSON.stringify({ ...counts, [key]: t });
    while (out.length > DETAIL_MAX && t) {
        t = t.slice(0, -Math.ceil((out.length - DETAIL_MAX) / 6));      // one character is at most 6 in JSON
        out = JSON.stringify({ ...counts, [key]: t });
    }
    return out;
}

/** The resend count, carried into every later record of the same versionCode. */
function keptResends(deviceId, code) {
    const resends = countOf(deliveryOf(deviceId), code, 'resends');
    return resends ? { resends } : {};
}

/** Record one step of a delivery with its attempt count; info is cut so the whole detail stays small. */
function recordAttempt(deviceId, code, state, attempts, info, gaveUp) {
    const d = { attempts };
    if (gaveUp) d.gaveUp = true;
    Object.assign(d, keptResends(deviceId, code));
    record(deviceId, code, state, packDetail(d, 'info', short(info)));
}

/**
 * The phone's app version: the device row's app string when it carries +<code>, else what its background service
 * reported at its last hello. The row holds whichever socket said hello last, and the page's hello says only
 * "Dreamscape", so a release built while the page was the last to speak would otherwise find version 0 and skip it.
 */
function versionOf(deviceId) {
    const row = ctx.as.deviceRow(ctx.globalResources, deviceId);
    const have = parseApp(row && row.app);
    if (have.versionCode > 0) return have;
    let kept = null;
    try { kept = typeof ctx.builds.deviceVersionOf === 'function' ? ctx.builds.deviceVersionOf(deviceId) : null; } catch (_) { kept = null; }
    return kept || have;
}

// ---------------------------------------------------------------- the APK to the phone's temporary folder

/*
 * Sending a file that lives on this server through the ActiveSync transfer machinery
 * (modules/activeSyncTransfers.js): the file is linked (else copied) into the transfers folder under a new id
 * with a committed description, which is all GET /api/activesync/transfer/:id/data needs (it reads the .json
 * from disk when it is not in memory), then the phone is asked stream.receive { temp: true } and pulls it.
 * Resolves with the transfer id once the phone confirmed, and the server's copy is removed (the phone keeps
 * its own in the app's temporary folder under the id, which apps.update names).
 * TODO: this belongs in activeSyncTransfers.js (sendServerFile there is preferred when it exists); it is
 * here because that file was claimed by another agent while #821 was built.
 */
async function sendServerFile(globalResources, deviceId, filePath, opts = {}) {
    const transfers = require('./activeSyncTransfers');
    const base = globalResources && typeof globalResources.getPath === 'function' ? globalResources.getPath('databases') : path.resolve(__dirname, '..', '.cache');
    const folder = path.join(base, 'activesync-transfers');
    await fs.promises.mkdir(folder, { recursive: true });
    const st = await fs.promises.stat(filePath);
    if (!st.isFile()) throw Object.assign(new Error('Not a file.'), { code: 'ENOENT' });
    const id = crypto.randomBytes(16).toString('hex');
    const name = String(opts.name || path.basename(filePath)).replace(/[\u0000-\u001f\u007f/\\]+/g, ' ').trim().slice(0, 255);
    const data = path.join(folder, id);
    const meta = path.join(folder, `${id}.json`);
    const description = { id, deviceId, name, size: st.size, received: st.size, created: Date.now(), committed: true, root: 'internal', dir: '/ActiveSync', conflict: 'replace', mtime: null, mkdirs: false, push: false };
    const drop = async () => {
        try { transfers._test && transfers._test.metas && transfers._test.metas.delete(id); } catch (_) { /* none */ }
        for (const f of [data, meta]) await fs.promises.unlink(f).catch(() => { /* gone */ });
    };
    try {
        try { await fs.promises.link(filePath, data); } catch (_) { await fs.promises.copyFile(filePath, data); }
        await fs.promises.writeFile(meta, JSON.stringify(description));
        // the phone pulls at its own pace: a generous minute per 10 MB, at least two minutes
        const timeoutMs = Math.max(120000, Math.ceil(st.size / (10 * 1024 * 1024)) * 60000);
        await activeSync.serverCall(globalResources, null, deviceId, 'stream.receive', {
            transferId: id, root: description.root, dir: description.dir, name, size: st.size, conflict: 'replace', mtime: null, temp: opts.temp !== false
        }, { timeoutMs, maxTimeoutMs: 6 * 3600 * 1000 });
        return id;
    } finally {
        await drop();
    }
}

/**
 * The hold (Yukimi, Nov 26 2026: "Shizuku is running, why am I being asked to install the app through the Android installer"):
 * while the installed app cannot install silently, every release an agent builds reaches the phone and pops the installer.
 * coord setting 'androidUpdates' { hold: true } stops all deliveries until it is lifted (Fleet / a work item that proved the
 * silent install on the emulator lane lifts it). Default: held.
 */
function isTest(deviceId) {
    try { return require('./testDevices').isTestDevice(deviceId); } catch (_) { return false; }
}

function held(deviceId) {
    if (process.env.ANDROID_UPDATES_TEST_UNHELD === '1') return false; // the delivery tests; never set in the server
    // a marked test device (the emulator lane, modules/testDevices.js) is never held: the lane proves the real delivery path
    // and the silent install on emulators, and no person's phone is in it (#1309)
    if (deviceId && isTest(deviceId)) return false;
    try { const s = require('./agentCoord/store').getSetting('androidUpdates'); return !(s && s.hold === false); } catch (_) { return true; }
}

/** What this round's outcome must not overwrite: the phone's own newer word on this versionCode. */
function overtaken(deviceId, code) {
    if (askedAgain.has(deviceId)) return true;
    // the record was set to 'sending' when this round began: 'waiting' or 'installed' now arrived during it
    const now = deliveryOf(deviceId);
    return !!now && now.versionCode === code && (now.state === 'waiting' || now.state === 'installed');
}

/** The latest release to a phone again, after an event that is not a hello or a release. */
function offerLatest(deviceId) {
    if (!ctx) return;
    const { log, builds } = ctx;
    let latest = null;
    try { latest = builds.latestRelease(); } catch (_) { latest = null; }
    consider(deviceId, latest).catch((error) => log(error.message));
}

/**
 * Offer a release to one phone when the rules say so. Resolves with 'sent' | 'failed' | null (nothing to do).
 */
async function consider(deviceId, release) {
    if (!ctx || !release || !deviceId || inflight.has(deviceId)) return null;
    if (held(deviceId)) return null;
    const have = versionOf(deviceId);
    const code = Number(release.versionCode) || 0;
    if (!(have.versionCode > 0 && have.versionCode < code)) return null;
    if (!supports.has(deviceId)) return null;
    // a connection the owner has not yet chosen (pending) cannot take calls; guest or partner can
    const online = ctx.as.deviceOnline(ctx.globalResources, null, deviceId);
    if (!online || online === 'pending') return null;
    // the owner's permissions: files (the transfer) and control (apps.update); without them nothing is tried
    if (typeof ctx.as.devicePermits === 'function' && !(ctx.as.devicePermits(ctx.globalResources, null, deviceId, 'files') && ctx.as.devicePermits(ctx.globalResources, null, deviceId, 'control'))) return null;
    const prior = deliveryOf(deviceId);
    // 'sending' with nothing running here is a delivery cut by a restart: not a reason to stop
    if (prior && prior.versionCode === code && (prior.state === 'staged' || prior.state === 'waiting' || prior.state === 'installed')) return null;
    // at most MAX_ATTEMPTS per versionCode (a 'sending' cut by a restart was counted when it began)
    const before = countOf(prior, code, 'attempts');
    if (before >= MAX_ATTEMPTS) {
        if (!detailOf(prior).gaveUp) recordAttempt(deviceId, code, 'failed', before, detailOf(prior).info || 'cut', true);
        return null;
    }
    const attempts = before + 1;

    inflight.add(deviceId);
    recordAttempt(deviceId, code, 'sending', attempts, `build ${release.id}`);
    const name = `dsapp-${code}.apk`;
    try {
        const transferId = await ctx.sendFile(ctx.globalResources, deviceId, ctx.builds.releaseApkPath(release), { name, temp: true });
        const answer = await ctx.as.serverCall(ctx.globalResources, null, deviceId, APPS_UPDATE, {
            temp: transferId, name, versionCode: code, versionName: release.versionName, sha256: release.sha256, size: release.size, buildId: release.id, sha: release.sha
        }, { timeoutMs: UPDATE_TIMEOUT_MS });
        const staged = !!answer && answer.state === 'staged';
        // a newer app may install the staged file and report the outcome before this answer is here
        if (!overtaken(deviceId, code)) recordAttempt(deviceId, code, staged ? 'staged' : 'failed', attempts, answer, !staged && attempts >= MAX_ATTEMPTS);
        return staged ? 'sent' : 'failed';
    } catch (error) {
        if (!overtaken(deviceId, code)) recordAttempt(deviceId, code, 'failed', attempts, `${error.code || 'ERROR'}: ${error.message}`, attempts >= MAX_ATTEMPTS);
        return 'failed';
    } finally {
        inflight.delete(deviceId);
        if (askedAgain.delete(deviceId)) offerLatest(deviceId);
    }
}

// ---------------------------------------------------------------- the update that waits for a silent route (#1309)

const OWN_PACKAGE = 'jp.net.seventhreeseven.dreamscape';
const WAITING_EVENT = 'apps.updateWaiting';
const noticed = new Set();              // `${deviceId}|${versionCode}|${why}` already told to Fleet in this process (the delivery record covers a restart)

/** One line of the app's reason: single spaced, cut. */
function cleanWhy(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 150); }

/**
 * The app's report on an update it could not install (as_event apps.updateWaiting { package, versionCode, versionName,
 * state: 'waiting' | 'resend', why, tries }). 'resend' goes to onResend. 'waiting': the delivery is recorded 'waiting'
 * with the reason, and Fleet is told ONCE per phone + versionCode + reason: the app repeats the report whenever its link
 * comes back, so a report equal to the stored one (or already told by this process) is not told again.
 * @returns {'told'|'recorded'|'asked'|'offered'|null}
 */
function onWaiting(name, detail, me) {
    if (!ctx || name !== WAITING_EVENT || !me || !me.id || !detail || typeof detail !== 'object') return null;
    if (detail.package !== OWN_PACKAGE || (detail.state !== 'waiting' && detail.state !== 'resend')) return null;
    const code = Number(detail.versionCode) || 0;
    const resend = detail.state === 'resend';
    const why = cleanWhy(detail.why);
    if (code <= 0 || (!resend && !why)) return null;
    const deviceId = me.id;
    // a phone already at this version (installed) is not waiting any more: a late report changes nothing
    if (versionOf(deviceId).versionCode >= code) return null;
    if (resend) return onResend(deviceId, code);
    const prior = deliveryOf(deviceId);
    const next = packDetail({ attempts: countOf(prior, code, 'attempts'), ...keptResends(deviceId, code) }, 'why', why);
    const same = !!prior && prior.versionCode === code && prior.state === 'waiting' && detailOf(prior).why === detailOf({ detail: next }).why;
    const key = `${deviceId}|${code}|${why}`;
    if (!same) record(deviceId, code, 'waiting', next);
    if (same || noticed.has(key)) return 'recorded';
    noticed.add(key);
    if (noticed.size > 500) noticed.clear();
    tellFleet(deviceId, code, why, detail.versionName);
    return 'told';
}

/**
 * The phone no longer holds the APK of versionCode `code` and a silent route is back: send it again (#1332). No notice.
 * What is sent is always the latest release, under all of consider()'s rules.
 *   - the record is of another versionCode that is newer, or is the latest release's: it is not rewritten (its counts
 *     stay), and consider() decides as at a hello: nothing when it is staged / waiting / installed, another try within
 *     its own attempts when it 'failed' (or its 'sending' was cut by a restart).
 *   - else (this versionCode, an older record that is not the latest's, or none, e.g. the server lost its data): the
 *     record becomes this versionCode 'failed' with no attempts, one more resend counted.
 * @returns {'asked'|'offered'|null}
 */
function onResend(deviceId, code) {
    const prior = deliveryOf(deviceId);
    let latest = null;
    try { latest = ctx.builds.latestRelease(); } catch (_) { latest = null; }
    if (prior && prior.versionCode !== code && (prior.versionCode > code || (latest && prior.versionCode === Number(latest.versionCode)))) {
        offerLatest(deviceId);
        return 'offered';
    }
    if (prior && prior.versionCode === code && (prior.state === 'sending' || prior.state === 'installed')) return null;
    const resends = countOf(prior, code, 'resends');
    if (resends >= MAX_RESENDS) {
        const key = `${deviceId}|${code}`;
        if (!capTold.has(key)) {
            if (capTold.size >= 500) capTold.clear();
            capTold.add(key);
            ctx.log(`${deviceId.slice(0, 8)} asked for ${code} again after ${MAX_RESENDS} resends: ignored`);
        }
        return null;
    }
    record(deviceId, code, 'failed', packDetail({ attempts: 0, resends: resends + 1 }, 'info', 'asked again by the phone: it no longer holds the file'));
    // a delivery still running (the phone installed, failed and asked before apps.update was answered) sends it when it ends
    if (inflight.has(deviceId)) askedAgain.add(deviceId); else offerLatest(deviceId);
    return 'asked';
}

/**
 * ONE quiet Fleet notice (fleetNotices.routine kind 'appUpdate', switch appUpdate in Fleet Manager, default off): the Supervisor
 * hears of it in the Manager Session's inbox; the phone / desktop only when she switched the kind on. No sound (alert false).
 * Its tap opens the Devices page (data.page 'devices', like the phone consent notices).
 */
function tellFleet(deviceId, code, why, versionName) {
    let name = deviceId.slice(0, 8);
    try { const r = ctx.as.deviceRow(ctx.globalResources, deviceId); if (r && r.name) name = String(r.name).slice(0, 60); } catch (_) { /* the id */ }
    try {
        // notice: app-update-waiting
        require('./fleetNotices').routine('appUpdate', {
            id: `app-update-waiting:${deviceId}:${code}`, alert: false,
            title: `${name}: update ${versionName || code} waits`,
            text: `${why}. It installs by itself when Shizuku or ADB 5555 is back.`,
            data: { app: 'claudedesk', kind: 'app-update-waiting', deviceId, versionCode: code, page: 'devices' }, ttlMs: 4 * 3600 * 1000
        });
    } catch (error) { ctx.log(`waiting notice: ${error.message}`); }
}

/** A phone said hello (the tap in activeSync.hello runs after its row holds the hello's app string). */
async function onHello(d) {
    if (!ctx || !d || !d.id) return null;
    const deviceId = d.id;
    // only the app's background service answers apps.update; the page's hello says nothing about it
    if (d.speaker === 'service') { if (answersUpdate(d.ops)) supports.add(deviceId); else supports.delete(deviceId); }
    const have = versionOf(deviceId);
    if (have.versionCode > 0) {
        try { ctx.builds.recordDeviceVersion(deviceId, { versionCode: have.versionCode, versionName: have.versionName, name: d.name || '' }); } catch (error) { ctx.log(`version not recorded: ${error.message}`); }
        // the new build's hello: what was delivered has landed
        try {
            const prior = ctx.builds.deliveryOf(deviceId);
            if (prior && prior.versionCode > 0 && prior.versionCode <= have.versionCode && prior.state !== 'installed') {
                const kept = keptResends(deviceId, prior.versionCode);
                const info = `reported ${have.versionCode}`;
                record(deviceId, prior.versionCode, 'installed', kept.resends ? packDetail(kept, 'info', info) : info);
            }
        } catch (_) { /* no delivery */ }
    }
    let latest = null;
    try { latest = ctx.builds.latestRelease(); } catch (_) { latest = null; }
    return consider(deviceId, latest);
}

/** A release was built: every online phone behind it. */
async function onRelease(release) {
    if (!ctx) return [];
    let latest = release;
    try { latest = ctx.builds.latestRelease() || release; } catch (_) { latest = release; }
    if (!latest) return [];
    let devices = [];
    try { devices = ctx.as.list(ctx.globalResources, null).devices || []; } catch (_) { devices = []; }
    const jobs = [];
    for (const dev of devices) {
        if (!dev.online || dev.platform === 'cafeready') continue;
        jobs.push(consider(dev.deviceId, latest));
    }
    return Promise.all(jobs);
}

/** What the server delivered, for an admin view: one entry per phone that has a delivery. */
function deliveriesSnapshot() {
    if (!ctx) return [];
    let devices = [];
    try { devices = ctx.as.list(ctx.globalResources, null).devices || []; } catch (_) { devices = []; }
    const out = [];
    for (const dev of devices) {
        let d = null;
        try { d = ctx.builds.deliveryOf(dev.deviceId); } catch (_) { d = null; }
        if (!d) continue;
        out.push({ deviceId: dev.deviceId, name: dev.name, app: dev.app || '', online: !!dev.online, reportedVersionCode: parseApp(dev.app).versionCode, ...d });
    }
    return out;
}

/**
 * Register the two taps. deps are for tests (activeSync, androidBuilds, sendFile); a server without the
 * builds module (or without the transfer helper) starts nothing.
 */
function start(globalResources, deps = {}) {
    if (ctx) return ctx.handle;
    let builds = deps.androidBuilds;
    if (!builds) { try { builds = require('./androidBuilds'); } catch (_) { return null; } }
    const as = deps.activeSync || activeSync;
    const sendFile = deps.sendFile || ((...args) => {
        const t = require('./activeSyncTransfers');
        return (typeof t.sendServerFile === 'function' ? t.sendServerFile : sendServerFile)(...args);
    });
    const log = (m) => console.warn(`[androidAppUpdatePush] ${m}`);
    const guard = (p) => { Promise.resolve(p).catch((error) => log(error.message)); };
    const helloTap = (d) => { setImmediate(() => guard(onHello(d))); };
    const releaseTap = (release) => { setImmediate(() => guard(onRelease(release))); };
    if (!tappedOn.has(as)) {
        tappedOn.add(as);
        as.onDeviceHello(helloTap);
        // the app's report that an update waits for Shizuku / 5555, or must be sent again (the tap checks ctx: it has no unregister)
        if (typeof as.onDeviceEvent === 'function') as.onDeviceEvent((name, detail, me) => { try { onWaiting(name, detail, me); } catch (error) { log(error.message); } });
    }
    builds.events.on('release', releaseTap);
    const handle = { stop() { builds.events.off('release', releaseTap); ctx = null; } };
    ctx = { globalResources, builds, as, sendFile, log, handle };
    return handle;
}

function resetForTests() {
    ctx = null;
    inflight.clear();
    supports.clear();
    noticed.clear();
    askedAgain.clear();
    capTold.clear();
}

module.exports = { start, deliveriesSnapshot, parseApp, sendServerFile, _test: { onHello, onRelease, consider, onWaiting, resetForTests } };
