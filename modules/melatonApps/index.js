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
            shared.store.installFromDirectory(dir, { system: true });
        } catch (err) {
            console.error(`[melaton apps] system package ${name} not installed: ${err.message}`);
        }
    }
}

/** The shared store + runner if apps were used in this server, else null (no side effects). */
getMelatonApps.peek = () => shared;

module.exports = { getMelatonApps, SYSTEM_APPS_DIR };
