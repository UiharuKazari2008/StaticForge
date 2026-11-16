/**
 * Melaton apps (Yozora #638): the package store and the app runner, one of each per server.
 *
 * System packages ship unpacked in the repo under apps/<id>/ (SoraTan, ...). They are installed
 * into .cache/packages/<id>/ (marked system) the first time apps are used after a start, and again
 * whenever their tree changed, so their opens[] rules answer VFS launches like any installed app.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createMelatonPackageStore } = require('../melatonPackageStore');
const { MelatonAppRunner } = require('./runner');

const SYSTEM_APPS_DIR = path.resolve(__dirname, '..', '..', 'apps');

let shared = null;
const updateListeners = new Set();

/** fn({ id, version, title, treeHash, previous }) whenever an installed system package's tree changes (#872). */
function onPackageUpdated(fn) {
    if (typeof fn === 'function') updateListeners.add(fn);
    return () => updateListeners.delete(fn);
}

/** installFromDirectory, telling the listeners when the installed tree changed. */
function installSystem(dir) {
    let id = null;
    try { id = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).id; } catch (_) { id = null; }
    let before = null;
    try {
        const row = id ? shared.store.get(String(id)) : null;
        before = row ? row.treeHash || '' : null;
    } catch (_) { before = null; }
    const rec = shared.store.installFromDirectory(dir, { system: true });
    // a first install (before === null) is not an update: no tab can run the package yet
    if (rec && before !== null && rec.treeHash !== before) {
        const change = { id: rec.id, version: rec.version, title: rec.title, treeHash: rec.treeHash, previous: before };
        for (const fn of updateListeners) {
            try { fn(change); } catch (err) { console.error('[melaton apps] update listener failed:', err.message); }
        }
        return Object.assign({ changed: change }, { record: rec });
    }
    return { changed: null, record: rec };
}

function getMelatonApps(globalResources, extra) {
    if (shared) return shared;
    const store = createMelatonPackageStore(globalResources, extra);
    const runner = new MelatonAppRunner({
        dataRoot: store.dataRoot,
        log: (level, text) => (level === 'error' ? console.error : console.log)(text)
    });
    shared = { store, runner, systemSynced: false };
    syncSystemPackages();
    // a run tree nobody launched for a day goes; the ones in use stay
    const sweep = setInterval(() => {
        try {
            const inUse = new Set(runner.list().processes.map((p) => p.runSha).filter(Boolean));
            for (const i of runner.instances.values()) if (i.runSha) inUse.add(i.runSha);
            store.sweepRuns(inUse);
        } catch (err) {
            console.error('[melaton apps] run sweep failed:', err.message);
        }
    }, 6 * 3600 * 1000);
    if (sweep.unref) sweep.unref();
    process.once('exit', () => runner.shutdown());
    return shared;
}

function syncSystemPackages() {
    if (!shared || shared.systemSynced) return;
    shared.systemSynced = true;
    if (!fs.existsSync(SYSTEM_APPS_DIR)) return;
    for (const name of fs.readdirSync(SYSTEM_APPS_DIR)) {
        const dir = path.join(SYSTEM_APPS_DIR, name);
        if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
        try {
            installSystem(dir);
        } catch (err) {
            console.error(`[melaton apps] system package ${name} not installed: ${err.message}`);
        }
    }
}

/**
 * A system package edited in apps/<id>/ since the server started: installed again before it is
 * launched or described (installFromDirectory skips the copy when its tree is unchanged), so a
 * change to a built-in app needs no server restart.
 */
function refreshSystemPackage(id) {
    if (!shared || !id || !/^[a-z0-9][a-z0-9._-]*$/i.test(String(id))) return null;
    const dir = path.join(SYSTEM_APPS_DIR, String(id));
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) return null;
    try {
        return installSystem(dir).record;
    } catch (err) {
        console.error(`[melaton apps] system package ${id} not refreshed: ${err.message}`);
        return null;
    }
}

/**
 * Install every system package again whose apps/<id>/ tree changed (#872, the notify refresh runs
 * this). Returns the packages that changed: [{ id, version, title, treeHash, previous }].
 */
function resyncSystemPackages() {
    if (!shared || !fs.existsSync(SYSTEM_APPS_DIR)) return [];
    const changed = [];
    for (const name of fs.readdirSync(SYSTEM_APPS_DIR)) {
        const dir = path.join(SYSTEM_APPS_DIR, name);
        if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
        try {
            const r = installSystem(dir);
            if (r.changed) changed.push(r.changed);
        } catch (err) {
            console.error(`[melaton apps] system package ${name} not installed: ${err.message}`);
        }
    }
    return changed;
}

/** The shared store + runner if apps were used in this server, else null (no side effects). */
getMelatonApps.peek = () => shared;

module.exports = { getMelatonApps, refreshSystemPackage, resyncSystemPackages, onPackageUpdated, SYSTEM_APPS_DIR };
