/**
 * Task Manager's view of the host (Yozora #632; apps/taskmgr): what Vista's taskmgr.exe shows of a
 * machine, read from Linux. Read-only: nothing here starts or stops anything.
 *
 *   cpu        total and per core, from /proc/stat deltas between snapshots (like taskmgr's sampling)
 *   memory     /proc/meminfo: Total / Cached / Free (Physical Memory), Paged / Nonpaged (Kernel, from
 *              SReclaimable / SUnreclaim), the page file (swap); handles = open files (file-nr)
 *   processes  ps: pid, user, %cpu, rss (KB), threads, image name, the command line (short)
 *   network    /proc/net/dev byte deltas per interface over its link speed (/sys/class/net/<if>/speed)
 *   services   the pm2 processes (pm2Service.listProcesses)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

let lastCpu = null;
let lastNet = null;
// Every Task Manager shares one baseline: a poll that lands right after another one's would
// measure a few jiffies and read 0 % or a spike, so a short gap reuses the last result.
const MIN_SAMPLE_MS = 450;
let cpuAt = 0;
let cpuLast = null;
let netAt = 0;
let netLast = null;

function readFile(p) {
    try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; }
}

function cpuTimes() {
    const out = [];
    for (const line of readFile('/proc/stat').split('\n')) {
        const m = /^cpu(\d*)\s+(.+)$/.exec(line);
        if (!m) continue;
        const v = m[2].trim().split(/\s+/).map(Number);
        const idle = (v[3] || 0) + (v[4] || 0);
        const total = v.slice(0, 8).reduce((a, b) => a + b, 0);
        out.push({ id: m[1] === '' ? 'all' : Number(m[1]), idle, total });
    }
    return out;
}

function cpuUsage() {
    if (cpuLast && Date.now() - cpuAt < MIN_SAMPLE_MS) return cpuLast;
    cpuAt = Date.now();
    cpuLast = cpuSample();
    return cpuLast;
}

function cpuSample() {
    const now = cpuTimes();
    const prev = lastCpu;
    lastCpu = now;
    if (!prev) return { total: 0, cores: now.filter((c) => c.id !== 'all').map(() => 0) };
    const pct = (a, b) => { const dt = a.total - b.total; return dt > 0 ? Math.max(0, Math.min(100, (1 - (a.idle - b.idle) / dt) * 100)) : 0; };
    const byId = new Map(prev.map((c) => [c.id, c]));
    const total = now.find((c) => c.id === 'all');
    return {
        total: total && byId.get('all') ? pct(total, byId.get('all')) : 0,
        cores: now.filter((c) => c.id !== 'all').map((c) => (byId.get(c.id) ? pct(c, byId.get(c.id)) : 0))
    };
}

function memory() {
    const kv = {};
    readFile('/proc/meminfo').split('\n').forEach((l) => { const m = /^(\w+):\s+(\d+)/.exec(l); if (m) kv[m[1]] = Number(m[2]) * 1024; });
    const fileNr = readFile('/proc/sys/fs/file-nr').trim().split(/\s+/).map(Number);
    return {
        total: kv.MemTotal || os.totalmem(),
        free: kv.MemFree || os.freemem(),
        available: kv.MemAvailable || os.freemem(),
        cached: (kv.Cached || 0) + (kv.Buffers || 0),
        paged: kv.SReclaimable || 0,
        nonpaged: kv.SUnreclaim || 0,
        swapTotal: kv.SwapTotal || 0,
        swapFree: kv.SwapFree || 0,
        commit: kv.Committed_AS || 0,
        handles: fileNr[0] || 0
    };
}

function network() {
    if (netLast && Date.now() - netAt < MIN_SAMPLE_MS) return netLast;
    netAt = Date.now();
    netLast = networkSample();
    return netLast;
}

function networkSample() {
    const now = { t: Date.now(), ifs: {} };
    readFile('/proc/net/dev').split('\n').slice(2).forEach((l) => {
        const m = /^\s*([^:]+):\s*(.+)$/.exec(l);
        if (!m) return;
        const name = m[1].trim();
        if (name === 'lo') return;
        const v = m[2].trim().split(/\s+/).map(Number);
        now.ifs[name] = { rx: v[0], tx: v[8] };
    });
    const prev = lastNet;
    lastNet = now;
    return Object.keys(now.ifs).map((name) => {
        const speedMb = Number(readFile(`/sys/class/net/${name}/speed`).trim()) || 0;
        const state = readFile(`/sys/class/net/${name}/operstate`).trim() || 'unknown';
        let util = 0;
        let bps = 0;
        if (prev && prev.ifs[name]) {
            const dt = (now.t - prev.t) / 1000;
            const bytes = (now.ifs[name].rx - prev.ifs[name].rx) + (now.ifs[name].tx - prev.ifs[name].tx);
            bps = dt > 0 ? (bytes * 8) / dt : 0;
            util = speedMb > 0 ? Math.min(100, (bps / (speedMb * 1e6)) * 100) : 0;
        }
        return { name, speedMbps: speedMb > 0 ? speedMb : null, state, utilization: util, bitsPerSecond: bps };
    });
}

function processes() {
    return new Promise((resolve) => {
        execFile('ps', ['-eo', 'pid=,user=,pcpu=,rss=,nlwp=,comm=,args=', '--sort=-pcpu'], { maxBuffer: 4 * 1024 * 1024, timeout: 4000 }, (err, stdout) => {
            if (err) { resolve([]); return; }
            const list = [];
            for (const line of String(stdout).split('\n')) {
                const m = /^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
                if (!m) continue;
                list.push({ pid: Number(m[1]), user: m[2], cpu: Number(m[3]), memKB: Number(m[4]), threads: Number(m[5]), name: m[6], command: m[7].slice(0, 160) });
                if (list.length >= 400) break;
            }
            resolve(list);
        });
    });
}

async function snapshot(opts = {}) {
    const [procs, services] = await Promise.all([
        processes(),
        (async () => { try { return await require('./pm2Service').listProcesses(); } catch (_) { return []; } })()
    ]);
    const cpu = cpuUsage();
    return {
        host: os.hostname(),
        uptimeSec: Math.floor(os.uptime()),
        cpu,
        cpuCount: os.cpus().length,
        cpuModel: (os.cpus()[0] && os.cpus()[0].model) || '',
        memory: memory(),
        processes: procs,
        threads: procs.reduce((s, p) => s + p.threads, 0),
        network: network(),
        services: opts.services === false ? [] : services
    };
}

module.exports = { snapshot };
