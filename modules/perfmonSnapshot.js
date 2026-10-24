/**
 * Reliability and Performance Monitor's Resource View (Yozora #632; apps/perfmon): what Vista's
 * wdc.dll shows of a machine, read from Linux. Read-only.
 *
 *   cpu        total, per process (ps %cpu now, a 60 s average kept here), threads, the command line
 *   disk       /proc/diskstats whole disks: bytes/s and the busiest disk's active time (io_ticks);
 *              per process /proc/<pid>/io read/write bytes a minute and the file it has open last
 *   network    /proc/net/dev bits/s over link speed; per connection `ss -tinp` bytes a minute
 *   memory     /proc/vmstat pgmajfault (hard faults/s), per process /proc/<pid>/{stat,status}:
 *              hard faults a minute, commit (VmData + VmStk), working set (VmRSS), shareable
 *              (RssFile + RssShmem), private (RssAnon)
 * A process the server's user may not read keeps its ps figures and blank counters.
 */
'use strict';

const fs = require('fs');
const { execFile } = require('child_process');
const taskManagerSnapshot = require('./taskManagerSnapshot');

const MIN_SAMPLE_MS = 450;
let last = null;
let lastAt = 0;
let lastResult = null;
const cpuHistory = new Map(); // pid -> [{t, cpu}]
// Resource View's lists count the last minute (B/min, Hard Faults/min): counters sampled per key
const windows = new Map(); // key -> [{t, v: [..counters]}]

/** Per-minute rates of a key's counters over the last 60 s (the oldest sample still in the minute). */
function perMinute(key, now, vals) {
    const w = windows.get(key) || [];
    w.push({ t: now, v: vals });
    while (w.length > 2 && now - w[1].t >= 60000) w.shift();
    windows.set(key, w);
    w.seen = now;
    const first = w[0];
    const secs = (now - first.t) / 1000;
    if (secs <= 0) return vals.map(() => 0);
    return vals.map((v, i) => (v === null || first.v[i] === null || v < first.v[i] ? 0 : Math.round(((v - first.v[i]) / secs) * 60)));
}

function read(p) {
    try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; }
}

function diskTotals() {
    const out = {};
    read('/proc/diskstats').split('\n').forEach((l) => {
        const v = l.trim().split(/\s+/);
        if (v.length < 14) return;
        const name = v[2];
        // whole disks only (nvme0n1, sda, vda), not partitions or loop / ram devices
        if (!/^(nvme\d+n\d+|[shv]d[a-z]+|xvd[a-z]+|mmcblk\d+)$/.test(name)) return;
        out[name] = { read: Number(v[5]) * 512, write: Number(v[9]) * 512, ticks: Number(v[12]) };
    });
    return out;
}

function majorFaults() {
    const m = /pgmajfault\s+(\d+)/.exec(read('/proc/vmstat'));
    return m ? Number(m[1]) : 0;
}

function procCounters(pid) {
    const io = read(`/proc/${pid}/io`);
    const status = read(`/proc/${pid}/status`);
    const stat = read(`/proc/${pid}/stat`);
    const kv = (txt, k) => { const m = new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(txt); return m ? Number(m[1]) : null; };
    let majflt = null;
    let ticks = null;
    const close = stat.lastIndexOf(')');
    if (close > 0) {
        const f = stat.slice(close + 2).split(' ');
        majflt = Number(f[9]) || 0;
        ticks = (Number(f[11]) || 0) + (Number(f[12]) || 0); // utime + stime
    }
    return {
        readBytes: io ? kv(io, 'read_bytes') : null,
        writeBytes: io ? kv(io, 'write_bytes') : null,
        majflt,
        ticks,
        rss: kv(status, 'VmRSS'),
        anon: kv(status, 'RssAnon'),
        shared: (kv(status, 'RssFile') || 0) + (kv(status, 'RssShmem') || 0),
        commit: (kv(status, 'VmData') || 0) + (kv(status, 'VmStk') || 0)
    };
}

/** The regular file a process touched last among its open ones (the Disk list's File column). */
function lastFile(pid) {
    let best = null;
    let names = [];
    try { names = fs.readdirSync(`/proc/${pid}/fd`); } catch (_) { return ''; }
    for (const fd of names.slice(0, 256)) {
        let target = '';
        try { target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch (_) { continue; }
        if (!target.startsWith('/') || target.startsWith('/dev/') || target.startsWith('/proc/')) continue;
        try {
            const st = fs.statSync(target);
            if (st.isFile() && (!best || st.mtimeMs > best.t)) best = { f: target, t: st.mtimeMs };
        } catch (_) { /* gone */ }
    }
    return best ? best.f : '';
}

function connections() {
    return new Promise((resolve) => {
        execFile('ss', ['-tinpH'], { maxBuffer: 8 * 1024 * 1024, timeout: 4000 }, (err, stdout) => {
            if (err) { resolve([]); return; }
            const out = [];
            const lines = String(stdout).split('\n');
            for (let i = 0; i < lines.length; i += 1) {
                const head = lines[i];
                const m = /^\S+\s+\d+\s+\d+\s+(\S+)\s+(\S+)\s+users:\(\("([^"]+)",pid=(\d+)/.exec(head);
                if (!m) continue;
                const info = lines[i + 1] || '';
                const sent = /bytes_sent:(\d+)/.exec(info) || /bytes_acked:(\d+)/.exec(info);
                const recv = /bytes_received:(\d+)/.exec(info);
                const peer = m[2].replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
                out.push({ key: `${m[1]}>${m[2]}`, pid: Number(m[4]), image: m[3], address: peer, sent: sent ? Number(sent[1]) : 0, recv: recv ? Number(recv[1]) : 0 });
            }
            resolve(out);
        });
    });
}

async function snapshot() {
    if (lastResult && Date.now() - lastAt < MIN_SAMPLE_MS) return lastResult;
    const now = Date.now();
    const [base, conns] = await Promise.all([taskManagerSnapshot.snapshot({ services: false }), connections()]);
    const disks = diskTotals();
    const faults = majorFaults();
    const procs = base.processes.map((p) => ({ ...p, c: procCounters(p.pid) }));
    const prev = last;
    last = { t: now, disks, faults, procs: new Map(procs.map((p) => [p.pid, p.c])), conns: new Map(conns.map((c) => [c.key, c])) };
    const dt = prev ? (now - prev.t) / 1000 : 0;

    // disk: bytes/s over every disk, the busiest disk's active time
    let diskBps = 0;
    let active = 0;
    if (prev) {
        Object.entries(disks).forEach(([n, d]) => {
            const p = prev.disks[n];
            if (!p) return;
            diskBps += ((d.read - p.read) + (d.write - p.write)) / dt;
            active = Math.max(active, Math.min(100, ((d.ticks - p.ticks) / (dt * 1000)) * 100));
        });
    }
    const hardFaults = prev && dt > 0 ? Math.max(0, (faults - prev.faults) / dt) : 0;

    // the CPU list's Average CPU: the last 60 s of this process
    const alive = new Set();
    const processes = procs.map((p) => {
        alive.add(p.pid);
        const was = prev && prev.procs.get(p.pid);
        const c = p.c;
        // CPU now: the process's ticks over the interval, as a share of every CPU (Windows' figure)
        const cpuNow = was && dt > 0 && c.ticks !== null && was.ticks !== null ? Math.max(0, Math.min(100, ((c.ticks - was.ticks) / 100 / dt / (base.cpuCount || 1)) * 100)) : 0;
        const h = cpuHistory.get(p.pid) || [];
        if (prev) h.push({ t: now, cpu: cpuNow });
        while (h.length && now - h[0].t > 60000) h.shift();
        cpuHistory.set(p.pid, h);
        return {
            pid: p.pid, name: p.name, user: p.user, command: p.command, threads: p.threads, cpu: cpuNow,
            avgCpu: h.length ? h.reduce((s, x) => s + x.cpu, 0) / h.length : 0,
            ...(() => { const [read, write, hardFaults] = perMinute(`p${p.pid}`, now, [c.readBytes, c.writeBytes, c.majflt]); return { read, write, hardFaults }; })(),
            commitKB: c.commit, workingKB: c.rss, shareKB: c.shared, privateKB: c.anon
        };
    });
    [...cpuHistory.keys()].forEach((pid) => { if (!alive.has(pid)) cpuHistory.delete(pid); });
    // the Disk list: processes reading or writing, with the file they have open last
    processes.filter((p) => p.read || p.write).slice(0, 60).forEach((p) => { p.file = lastFile(p.pid); });

    const network = conns.map((c) => {
        const [send, recv] = perMinute(`c${c.key}`, now, [c.sent, c.recv]);
        return { pid: c.pid, image: c.image, address: c.address, send, recv, total: send + recv };
    });
    // a process or connection gone for a minute leaves the lists
    windows.forEach((w, k) => { if (now - w.seen > 60000) windows.delete(k); });

    lastAt = now;
    lastResult = {
        host: base.host,
        cpu: base.cpu,
        cpuCount: base.cpuCount,
        memory: base.memory,
        adapters: base.network,
        disk: { bytesPerSec: diskBps, activeTime: active },
        hardFaults,
        processes,
        connections: network
    };
    return lastResult;
}

module.exports = { snapshot };
