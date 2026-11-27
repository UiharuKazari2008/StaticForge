#!/usr/bin/env node
'use strict';

/**
 * Melaton Mobile Device Center keeps a row for every device that has ever said hello (`as_devices`), and a row only
 * goes when its partnership is ended by hand. That is how the list filled up with dead and fake devices (Yukimi,
 * Nov 26 2026, #1299: "how do we delete the massive list of dead devices and fake devices in mobile device center").
 *
 * This lists them and, with --apply, removes the junk through the same call Device Center's own removal uses
 * (`activeSync.forget`: the device row, its queue, its log, its kept icons, its primary flag), and then the
 * per-device tables Device Center's own removal leaves behind (received items, its notification catalog and
 * overrides). A test device is also unmarked from the test lane (modules/testDevices.js) so the fence does not
 * keep a name for a device that is gone.
 *
 * Alone it changes nothing: run it with no arguments to see the list.
 *
 *   node scripts/prune-activesync-devices.js                     # what is there, and what --apply would remove
 *   node scripts/prune-activesync-devices.js --apply             # remove the fake (emulator) and never-set-up ones
 *   node scripts/prune-activesync-devices.js --apply --dreamos   # ... and the DreamOS machines (platform cafeready)
 *   node scripts/prune-activesync-devices.js --apply --dead 30   # ... and anything not seen for 30 days
 *   node scripts/prune-activesync-devices.js --keep "Galaxy Fold" --keep f409...   # never touch these (name or id)
 *   node scripts/prune-activesync-devices.js --apply --force     # also a device seen in the last 5 minutes
 *
 * What is never removed without being named: the devices set up on this computer (a partnership), unless --dead says
 * their age. A device seen in the last 5 minutes is probably connected right now: it is listed and skipped unless
 * --force (its app re-registers on its next hello, so nothing is lost by waiting until it is away).
 */

const path = require('path');
const fs = require('fs');

const EMU_SHAPE = require('../modules/testDevices').isEmulatorShape;

const ONLINE_MS = 5 * 60 * 1000;

function parseArgs(argv) {
    const out = { apply: false, dreamos: false, dead: null, keep: [], force: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--apply') out.apply = true;
        else if (a === '--dreamos') out.dreamos = true;
        else if (a === '--force') out.force = true;
        else if (a === '--dead') { out.dead = Number(argv[++i]); if (!Number.isFinite(out.dead)) { console.error('--dead wants a number of days'); process.exit(2); } }
        else if (a === '--keep') { const v = argv[++i]; if (!v) { console.error('--keep wants a name or a device id'); process.exit(2); } out.keep.push(String(v).toLowerCase()); }
        else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('/**')[1].trim()); process.exit(0); }
        else { console.error(`unknown option: ${a} (try --help)`); process.exit(2); }
    }
    return out;
}

/** The databases folder of the live server, without booting it (the trick modules/testDevices.js uses). */
function databasesDir() {
    try {
        const loaded = require.cache[require.resolve('../modules/globalResources')];
        if (loaded && loaded.exports && typeof loaded.exports.getPath === 'function') return loaded.exports.getPath('databases');
    } catch (_e) { /* not loaded: the default below */ }
    return process.env.ACTIVESYNC_DB_DIR || path.join(__dirname, '..', '.cache');
}

const day = (ms) => (ms ? `${((Date.now() - ms) / 86400000).toFixed(1)}d ago` : 'never');
const now = () => Date.now();

function main() {
    const opts = parseArgs(process.argv.slice(2));
    const dir = databasesDir();
    const dbPath = path.join(dir, 'activesync.db');
    if (!fs.existsSync(dbPath)) { console.error(`no ActiveSync database at ${dbPath}`); process.exit(1); }

    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    const rows = db.prepare('SELECT device_id, name, model, platform, partner, first_seen, last_seen FROM as_devices ORDER BY last_seen DESC').all();
    const kept = (r) => opts.keep.some((k) => k === String(r.device_id).toLowerCase() || String(r.name || '').toLowerCase() === k);

    const verdict = (r) => {
        if (kept(r)) return { remove: false, why: 'kept (--keep)' };
        const seen = r.last_seen || 0;
        if (now() - seen < ONLINE_MS && !opts.force) return { remove: false, why: 'seen in the last 5 minutes (probably connected)' };
        if (EMU_SHAPE(r.device_id, r.model, r.name)) return { remove: true, why: 'an emulator (the test lane\'s leftover)' };
        if (!r.partner) return { remove: true, why: 'never set up here' };
        if (r.platform === 'cafeready') return { remove: !!opts.dreamos, why: opts.dreamos ? 'a DreamOS machine' : 'a DreamOS machine (--dreamos to remove)' };
        if (opts.dead != null && now() - seen > opts.dead * 86400000) return { remove: true, why: `not seen for ${opts.dead} days` };
        return { remove: false, why: 'set up on this computer' };
    };

    const todo = [];
    console.log(`\nMelaton Mobile Device Center: ${rows.length} device${rows.length === 1 ? '' : 's'} in ${dbPath}\n`);
    console.log('  what                   set up  last seen   name / model                                        verdict');
    for (const r of rows) {
        const v = verdict(r);
        const kind = EMU_SHAPE(r.device_id, r.model, r.name) ? 'emulator' : (r.partner ? 'device' : 'not set up');
        console.log(`  ${kind.padEnd(11)} ${String(r.partner ? 'yes' : 'no').padEnd(6)}  ${day(r.last_seen).padStart(8)}   ${String(r.name || r.device_id).slice(0, 24).padEnd(24)} ${String(r.model || '').slice(0, 18).padEnd(18)} ${v.why}`);
        if (v.remove) todo.push(r);
    }
    db.close();

    if (!todo.length) { console.log('\nNothing to remove.\n'); return; }
    console.log(`\n${todo.length} to remove${opts.apply ? '' : ' (dry run: nothing was changed)'}: ${todo.map((r) => r.name || r.device_id).join(', ')}`);

    if (!opts.apply) { console.log('\nRun again with --apply to remove them.\n'); return; }

    // the removal Device Center itself uses, so nothing here diverges from it
    const as = require('../modules/activeSync');
    const testDevices = require('../modules/testDevices');
    const gr = { getPath: () => dir };
    let done = 0;
    for (const r of todo) {
        const id = r.device_id;
        let ok = false;
        try { ok = as.forget(gr, null, id); } catch (err) { console.error(`  ${r.name || id}: ${err.message}`); continue; }
        // what forget() does not reach: the tables that keep this device's own rows
        try {
            const d = new Database(dbPath);
            d.pragma('journal_mode = WAL');
            for (const t of ['as_received', 'as_notify_apps', 'as_notify_prefs']) {
                try { d.prepare(`DELETE FROM ${t} WHERE device_id = ?`).run(id); } catch (_e) { /* table not there */ }
            }
            d.close();
        } catch (_e) { /* the row is gone either way */ }
        try { if (testDevices.isTestDevice(id)) testDevices.unmark(id); } catch (_e) { /* no fence file */ }
        done += ok ? 1 : 0;
        console.log(`  removed: ${r.name || id}`);
    }
    console.log(`\n${done} of ${todo.length} removed from Device Center.\n`);
}

main();
