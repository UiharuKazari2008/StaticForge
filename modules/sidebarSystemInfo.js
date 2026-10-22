/**
 * The machine the hosted Sidebar gadgets read (Yozora #629): Dreamscape's own server, as the CPU
 * Meter already shows it. vistaGadgetHost.js turns this into System.Machine, System.Shell.drive
 * and the WMI classes gadgets query (Win32_Processor, Win32_PerfRawData_Tcpip_NetworkInterface ...).
 *
 *   sidebar_system_info -> getSystemInfo()
 *     cpu       { name, mhz, cores: [percent per logical CPU], total }
 *     memory    { totalBytes, freeBytes }
 *     uptimeSec
 *     disks     [{ letter, label, mount, totalBytes, freeBytes, readBps, writeBps, busy }]  (block devices only)
 *     network   [{ name, rxBps, txBps, rxBytes, txBytes, speedBps, ip, mac }]          (no loopback)
 *     processes [{ pid, name, cpu, memBytes }]                                         (top 12 by CPU)
 *
 * One sample serves every gadget and tab: taken at most once a second, processes every 3 s.
 */
const fs = require('fs');
const os = require('os');

const SAMPLE_MS = 1000;
const PROCESS_MS = 3000;
const MAX_PROCESSES = 12;

let current = null;
let currentAt = 0;
let sampling = null;
let prev = null; // { at, cpu: [{ idle, total }], net: Map(name -> { rx, tx }), disk: Map(dev -> { rd, wr, ticks }) }
let processes = { at: 0, list: [], pending: null };

function readText(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch (_e) {
        return '';
    }
}

function cpuTimes() {
    return os.cpus().map((c) => {
        const t = c.times;
        return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
    });
}

function netCounters() {
    const out = new Map();
    readText('/proc/net/dev').split('\n').slice(2).forEach((line) => {
        const m = /^\s*([^:]+):\s*(.*)$/.exec(line);
        if (!m) return;
        const f = m[2].trim().split(/\s+/).map(Number);
        out.set(m[1].trim(), { rx: f[0] || 0, tx: f[8] || 0 });
    });
    return out;
}

function diskCounters() {
    const out = new Map();
    readText('/proc/diskstats').split('\n').forEach((line) => {
        const f = line.trim().split(/\s+/);
        if (f.length < 14) return;
        // sectors read (5), sectors written (9), ms doing I/O (12)
        out.set(f[2], { rd: Number(f[5]) * 512, wr: Number(f[9]) * 512, ticks: Number(f[12]) });
    });
    return out;
}

/** Mounted block devices (no loop, network or pseudo filesystems), the root first: C:, D:, ... */
function blockMounts() {
    const seen = new Set();
    const mounts = [];
    readText('/proc/mounts').split('\n').forEach((line) => {
        const [dev, mount, type] = line.split(' ');
        if (!dev || !dev.startsWith('/dev/') || dev.startsWith('/dev/loop') || seen.has(dev)) return;
        if (/^(squashfs|iso9660|vfat)$/.test(type) && mount !== '/') return;
        seen.add(dev);
        mounts.push({ dev: dev.replace('/dev/', '').replace(/^mapper\//, ''), mount, type });
    });
    mounts.sort((a, b) => (a.mount === '/' ? -1 : b.mount === '/' ? 1 : a.mount.localeCompare(b.mount)));
    return mounts.slice(0, 6);
}

function linkSpeedBps(name) {
    const mbps = Number(readText(`/sys/class/net/${name}/speed`).trim());
    return Number.isFinite(mbps) && mbps > 0 ? mbps * 1e6 : 0;
}

/**
 * Current CPU per process: utime + stime ticks from /proc/<pid>/stat between two reads (ps gives
 * the lifetime average). Memory is the resident set.
 */
const CLOCK_TICKS = 100;
const PAGE_BYTES = 4096;
let procPrev = null; // { at, ticks: Map(pid -> ticks) }

function readProcStats() {
    const out = new Map();
    let names = [];
    try {
        names = fs.readdirSync('/proc');
    } catch (_e) {
        return out;
    }
    for (const name of names) {
        if (!/^\d+$/.test(name)) continue;
        const stat = readText(`/proc/${name}/stat`);
        const close = stat.lastIndexOf(')');
        if (close < 0) continue;
        const f = stat.slice(close + 2).split(' ');
        out.set(Number(name), {
            name: stat.slice(stat.indexOf('(') + 1, close),
            ticks: Number(f[11]) + Number(f[12]),
            rss: Number(f[21]) * PAGE_BYTES
        });
    }
    return out;
}

function refreshProcesses() {
    if (Date.now() - processes.at < PROCESS_MS) return;
    const now = Date.now();
    const stats = readProcStats();
    const secs = procPrev ? Math.max(0.001, (now - procPrev.at) / 1000) : 0;
    const list = [];
    stats.forEach((p, pid) => {
        const before = procPrev && procPrev.ticks.get(pid);
        const cpu = before !== undefined && secs ? Math.max(0, ((p.ticks - before) / CLOCK_TICKS) / secs * 100) : 0;
        list.push({ pid, name: p.name, cpu: Math.round(cpu * 10) / 10, memBytes: p.rss });
    });
    procPrev = { at: now, ticks: new Map([...stats].map(([pid, p]) => [pid, p.ticks])) };
    list.sort((a, b) => b.cpu - a.cpu || b.memBytes - a.memBytes);
    processes = { at: now, list: list.slice(0, MAX_PROCESSES), pending: null };
}

function sample() {
    const now = Date.now();
    const cpu = cpuTimes();
    const net = netCounters();
    const disk = diskCounters();
    const secs = prev ? Math.max(0.001, (now - prev.at) / 1000) : 0;

    const cores = cpu.map((c, i) => {
        const p = prev && prev.cpu[i];
        const total = p ? c.total - p.total : c.total;
        const idle = p ? c.idle - p.idle : c.idle;
        return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : 0;
    });

    const addrs = os.networkInterfaces();
    const network = [];
    net.forEach((c, name) => {
        if (name === 'lo') return;
        const p = prev && prev.net.get(name);
        const v4 = (addrs[name] || []).find((a) => a.family === 'IPv4' || a.family === 4);
        network.push({
            name,
            rxBps: p && secs ? Math.max(0, (c.rx - p.rx) / secs) : 0,
            txBps: p && secs ? Math.max(0, (c.tx - p.tx) / secs) : 0,
            rxBytes: c.rx,
            txBytes: c.tx,
            speedBps: linkSpeedBps(name),
            ip: v4 ? v4.address : '',
            mac: v4 ? v4.mac : ((addrs[name] || [])[0] || {}).mac || ''
        });
    });

    const letters = 'CDEFGH';
    const disks = blockMounts().map((m, i) => {
        let totalBytes = 0;
        let freeBytes = 0;
        try {
            const s = fs.statfsSync(m.mount);
            totalBytes = s.blocks * s.bsize;
            freeBytes = s.bavail * s.bsize;
        } catch (_e) { /* unreadable mount */ }
        const base = m.dev.replace(/p?\d+$/, '');
        const c = disk.get(m.dev) || disk.get(base);
        const p = prev && (prev.disk.get(m.dev) || prev.disk.get(base));
        return {
            letter: letters[i] + ':',
            label: m.mount === '/' ? 'Local Disk' : (m.mount.split('/').pop() || 'Local Disk'),
            mount: m.mount,
            totalBytes,
            freeBytes,
            readBps: c && p && secs ? Math.max(0, (c.rd - p.rd) / secs) : 0,
            writeBps: c && p && secs ? Math.max(0, (c.wr - p.wr) / secs) : 0,
            busy: c && p && secs ? Math.max(0, Math.min(100, Math.round((c.ticks - p.ticks) / (secs * 10)))) : 0
        };
    });

    prev = { at: now, cpu, net, disk };
    refreshProcesses();
    const info = os.cpus()[0] || {};
    return {
        cpu: {
            name: info.model || 'Processor',
            mhz: info.speed || 0,
            cores,
            total: cores.length ? Math.round(cores.reduce((a, b) => a + b, 0) / cores.length) : 0
        },
        memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
        uptimeSec: Math.floor(os.uptime()),
        disks,
        network,
        processes: processes.list,
        at: now
    };
}

/** The current sample; the first call primes the counters and samples again a moment later. */
async function getSystemInfo() {
    if (current && Date.now() - currentAt < SAMPLE_MS) return current;
    if (!sampling) {
        sampling = (async () => {
            if (!prev) {
                sample();
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
            current = sample();
            currentAt = Date.now();
            sampling = null;
            return current;
        })();
    }
    return sampling;
}

module.exports = { getSystemInfo };
