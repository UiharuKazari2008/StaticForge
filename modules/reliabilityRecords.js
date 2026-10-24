/**
 * Reliability Monitor's records (Yozora #632; apps/perfmon): what Vista's RACAgent gathers for the
 * System Stability Chart, kept for Melaton. Read by the admin-only `perfmon_reliability` packet.
 *
 *   software   Melaton packages: installedAt / a later updatedAt (Application Install), a package
 *              gone from the store since it was last seen (Application Uninstall); a new git HEAD at
 *              server start (Melaton Update Install)
 *   app        program fault reports (data/fault-reports): every occurrence is "Stopped working"
 *   windows    the server exiting with a non-zero code (OS Stopped working)
 *   misc       a server start whose previous run never exited at all (Disruptive Shutdown: killed,
 *              out of memory, power lost), dated at that run's last heartbeat
 *   hardware   none read on Linux
 *
 * data/reliability/events.jsonl holds what can not be read back later (updates, uninstalls,
 * failures of the server itself); data/reliability/state.json the running marker and what was seen.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'reliability');
const EVENTS = path.join(DIR, 'events.jsonl');
const STATE = path.join(DIR, 'state.json');
const FAULTS = path.join(ROOT, 'data', 'fault-reports');
const HEARTBEAT_MS = 5 * 60 * 1000;
const KEEP_MS = 400 * 24 * 3600 * 1000;

let started = false;
let state = null;

function readJson(p, fallback) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}

function writeState() {
    try {
        fs.mkdirSync(DIR, { recursive: true });
        fs.writeFileSync(STATE, JSON.stringify(state));
    } catch (err) {
        console.warn('[reliability] state not saved:', err.message);
    }
}

function append(ev) {
    try {
        fs.mkdirSync(DIR, { recursive: true });
        fs.appendFileSync(EVENTS, `${JSON.stringify(ev)}\n`);
    } catch (err) {
        console.warn('[reliability] event not saved:', err.message);
    }
}

function gitHead() {
    try {
        const head = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim();
        if (!head.startsWith('ref: ')) return head;
        const ref = head.slice(5);
        try { return fs.readFileSync(path.join(ROOT, '.git', ref), 'utf8').trim(); } catch (_) { /* packed */ }
        const packed = fs.readFileSync(path.join(ROOT, '.git', 'packed-refs'), 'utf8');
        const m = new RegExp(`^([0-9a-f]{40}) ${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').exec(packed);
        return m ? m[1] : '';
    } catch (_) {
        return '';
    }
}

function version() {
    return readJson(path.join(ROOT, 'package.json'), {}).version || '';
}

/** Once per server: the previous run's ending, a new HEAD, the running marker and its heartbeat. */
function start() {
    if (started) return;
    started = true;
    state = readJson(STATE, {}) || {};
    const now = new Date().toISOString();
    if (state.running) {
        append({ t: state.running.alive || state.running.since, cat: 'misc', type: 'Disruptive Shutdown', detail: 'The computer was not shut down properly.', version: state.running.version || '' });
    }
    const head = gitHead();
    if (head && state.head && head !== state.head) {
        append({ t: now, cat: 'software', name: `Melaton Update (${head.slice(0, 8)})`, version: version(), activity: 'Melaton Update Install', status: 'Success' });
    }
    if (head) state.head = head;
    state.firstSeen = state.firstSeen || now;
    state.running = { pid: process.pid, since: now, alive: now, version: version() };
    writeState();
    const beat = setInterval(() => { state.running.alive = new Date().toISOString(); writeState(); }, HEARTBEAT_MS);
    if (beat.unref) beat.unref();
    process.on('exit', (code) => {
        if (code) append({ t: new Date().toISOString(), cat: 'windows', type: 'OS Stopped working', detail: `The server exited with code ${code}.`, version: state.running.version || '' });
        state.running = null;
        writeState();
    });
}

/** Packages installed, reinstalled and gone, against what was seen last time. */
function packageEvents(store) {
    const out = [];
    let pkgs = [];
    try { pkgs = store ? store.list() : []; } catch (_) { pkgs = []; }
    const seen = state.packages || {};
    const next = {};
    pkgs.forEach((p) => {
        const name = p.title || p.id;
        next[p.id] = { name, version: p.version || '' };
        if (p.installedAt) out.push({ t: p.installedAt, cat: 'software', name, version: p.version || '', activity: 'Application Install', status: 'Success' });
        if (p.updatedAt && p.installedAt && Date.parse(p.updatedAt) - Date.parse(p.installedAt) > 60000) {
            out.push({ t: p.updatedAt, cat: 'software', name, version: p.version || '', activity: 'Application Install', status: 'Success' });
        }
    });
    Object.keys(seen).forEach((id) => {
        if (!next[id]) append({ t: new Date().toISOString(), cat: 'software', name: seen[id].name, version: seen[id].version, activity: 'Application Uninstall', status: 'Success' });
    });
    if (JSON.stringify(seen) !== JSON.stringify(next)) { state.packages = next; writeState(); }
    return out;
}

/** Every "has stopped working" the desktop showed (the program fault reports' occurrences). */
function faultEvents() {
    const out = [];
    let names = [];
    try { names = fs.readdirSync(FAULTS).filter((n) => n.endsWith('.json')); } catch (_) { return out; }
    names.forEach((n) => {
        const r = readJson(path.join(FAULTS, n), null);
        if (!r) return;
        const occ = Array.isArray(r.recent) && r.recent.length ? r.recent : [r.latest || { at: r.lastSeen, program: r.program }];
        occ.forEach((o) => {
            const prog = (o && o.program) || r.program || {};
            out.push({ t: (o && o.at) || r.lastSeen, cat: 'app', name: prog.name || prog.key || 'Unknown', version: version(), type: 'Stopped working' });
        });
    });
    return out;
}

/** All records, oldest first, and when records began (the chart's first day). */
function records(store) {
    if (!started) start();
    const logged = [];
    try {
        fs.readFileSync(EVENTS, 'utf8').split('\n').forEach((l) => {
            if (!l) return;
            try { logged.push(JSON.parse(l)); } catch (_) { /* torn line */ }
        });
    } catch (_) { /* none yet */ }
    const now = Date.now();
    const events = logged.concat(packageEvents(store), faultEvents())
        .filter((e) => e && e.t && now - Date.parse(e.t) < KEEP_MS)
        .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    const first = events.length ? Math.min(Date.parse(events[0].t), Date.parse(state.firstSeen)) : Date.parse(state.firstSeen);
    return { first: new Date(first).toISOString(), now: new Date(now).toISOString(), events };
}

module.exports = { start, records };
