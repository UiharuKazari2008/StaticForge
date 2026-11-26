/**
 * Android app updates pushed to the phones (Yozora #821, part 2: the server's delivery side).
 *
 * A build of the Dreamscape app (modules/androidBuilds.js) is a Release. A phone running an older build
 * gets the new APK staged in its own app folder through Melaton Updates; it is never installed from here
 * (the page's Restart Now does that on the phone, see the contract: apps.update NEVER installs).
 *
 * Triggers (events only, no timers, no polling, no retry loops: rules server-push-not-polling and
 * phone-power-server):
 *   - a phone's hello (activeSync.onDeviceHello): its `app` string is `Dreamscape/<versionName>+<versionCode>`;
 *     the version is recorded (androidBuilds.recordDeviceVersion), a delivery the phone has caught up with
 *     becomes 'installed', and the newest release is offered when the phone is behind it;
 *   - androidBuilds.events 'release': every online phone that is behind it.
 *
 * Delivery: the APK goes to the phone's temporary folder with the ActiveSync transfer machinery
 * (sendServerFile below: stream.receive temp, the phone pulls it), then op apps.update
 * { temp, name, versionCode, versionName, sha256, size, buildId, sha } asks the phone to check and stage it.
 * Pushed only when: the phone is online with a connection, its background service answers apps.update (the
 * hello's ops), its reported versionCode is > 0 and < the release's (an app without +<code> is an old build
 * with no apps.update), and no delivery for this versionCode is staged / sending / installed. One at a time
 * per phone. A 'failed' delivery is tried again at the phone's next hello or the next release, nothing else.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const activeSync = require('./activeSync');

const APPS_UPDATE = 'apps.update';
const MAX_ATTEMPTS = 3;                 // per phone and versionCode, kept in the delivery record (a new release starts again)
const UPDATE_TIMEOUT_MS = 120000;       // the phone checks size + sha256 of the file and moves it
const APP_RE = /^Dreamscape\/(.*)\+(\d{1,10})$/;

const tappedOn = new WeakSet();         // onDeviceHello has no unregister: the tap stays (once per activeSync) and checks ctx
let ctx = null;                         // { globalResources, builds, as, sendFile, log }
const inflight = new Set();             // deviceId with a delivery running
const supports = new Set();             // deviceId whose background service said it answers apps.update

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
 * The attempt count lives in the delivery record's detail (a JSON text, androidBuilds keeps it as a string and
 * it survives a restart): { attempts, gaveUp?, info }. A record in any other form counts as no attempts.
 */
function detailOf(prior) {
    let d = prior && prior.detail;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = null; } }
    return d && typeof d === 'object' ? d : {};
}

function attemptsOf(prior, code) {
    if (!prior || prior.versionCode !== code) return 0;
    return Math.max(0, Number(detailOf(prior).attempts) || 0);
}

/** Record one step of a delivery with its attempt count; info is cut so the whole detail stays small. */
function recordAttempt(deviceId, code, state, attempts, info, gaveUp) {
    const d = { attempts };
    if (gaveUp) d.gaveUp = true;
    d.info = short(info).slice(0, 150);
    record(deviceId, code, state, JSON.stringify(d));
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
 * Offer a release to one phone when the rules say so. Resolves with 'sent' | 'failed' | null (nothing to do).
 */
async function consider(deviceId, release) {
    if (!ctx || !release || !deviceId || inflight.has(deviceId)) return null;
    const have = versionOf(deviceId);
    const code = Number(release.versionCode) || 0;
    if (!(have.versionCode > 0 && have.versionCode < code)) return null;
    if (!supports.has(deviceId)) return null;
    // a connection the owner has not yet chosen (pending) cannot take calls; guest or partner can
    const online = ctx.as.deviceOnline(ctx.globalResources, null, deviceId);
    if (!online || online === 'pending') return null;
    // the owner's permissions: files (the transfer) and control (apps.update); without them nothing is tried
    if (typeof ctx.as.devicePermits === 'function' && !(ctx.as.devicePermits(ctx.globalResources, null, deviceId, 'files') && ctx.as.devicePermits(ctx.globalResources, null, deviceId, 'control'))) return null;
    let prior = null;
    try { prior = ctx.builds.deliveryOf(deviceId); } catch (_) { prior = null; }
    // 'sending' with nothing running here is a delivery cut by a restart: not a reason to stop
    if (prior && prior.versionCode === code && (prior.state === 'staged' || prior.state === 'installed')) return null;
    // at most MAX_ATTEMPTS per versionCode (a 'sending' cut by a restart was counted when it began)
    const before = attemptsOf(prior, code);
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
        recordAttempt(deviceId, code, staged ? 'staged' : 'failed', attempts, answer, !staged && attempts >= MAX_ATTEMPTS);
        return staged ? 'sent' : 'failed';
    } catch (error) {
        recordAttempt(deviceId, code, 'failed', attempts, `${error.code || 'ERROR'}: ${error.message}`, attempts >= MAX_ATTEMPTS);
        return 'failed';
    } finally {
        inflight.delete(deviceId);
    }
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
            if (prior && prior.versionCode > 0 && prior.versionCode <= have.versionCode && prior.state !== 'installed') record(deviceId, prior.versionCode, 'installed', `reported ${have.versionCode}`);
        } catch (_) { /* no delivery */ }
    }
    if (d.test) return null;
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
        if (!dev.online || dev.platform === 'cafeready' || dev.test) continue;
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
    if (!tappedOn.has(as)) { tappedOn.add(as); as.onDeviceHello(helloTap); }
    builds.events.on('release', releaseTap);
    const handle = { stop() { builds.events.off('release', releaseTap); ctx = null; } };
    ctx = { globalResources, builds, as, sendFile, log, handle };
    return handle;
}

function resetForTests() {
    ctx = null;
    inflight.clear();
    supports.clear();
}

module.exports = { start, deliveriesSnapshot, parseApp, sendServerFile, _test: { onHello, onRelease, consider, resetForTests } };
