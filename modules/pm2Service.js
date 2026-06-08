/**
 * PM2 process control for admin log viewer.
 * modules/pm2LogPaths.js (process name / log paths)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const pm2 = require('pm2');
const pm2LogPaths = require('./pm2LogPaths');

const HOST_DISK_CACHE_MS = 60000;
let hostDiskCache = null;
let hostDiskCacheAt = 0;

function withPm2(fn) {
    return new Promise((resolve, reject) => {
        pm2.connect((err) => {
            if (err) return reject(err);
            Promise.resolve(fn(pm2))
                .then(resolve)
                .catch(reject)
                .finally(() => {
                    try {
                        pm2.disconnect();
                    } catch (_) { /* ignore */ }
                });
        });
    });
}

function getProcessName() {
    const paths = pm2LogPaths.getPm2LogPaths();
    return paths?.processName || null;
}

function isPm2Available() {
    return pm2LogPaths.getPm2LogPaths() != null;
}

function readFilesystemBytes(targetPath) {
    const projectRoot = path.resolve(targetPath || path.join(__dirname, '..'));
    try {
        const dfOutput = execSync(`df -B1 "${projectRoot}"`, { encoding: 'utf8' });
        const lines = dfOutput.trim().split('\n');
        if (lines.length < 2) return null;
        const header = lines[0].split(/\s+/);
        const data = lines[1].split(/\s+/);
        let totalIndex = -1;
        let usedIndex = -1;
        let availIndex = -1;
        header.forEach((col, idx) => {
            if (col === '1B-blocks' || col === '1K-blocks' || col === 'Size' || col.toUpperCase() === 'SIZE') {
                totalIndex = idx;
            }
            if (col === 'Used' || col.toUpperCase() === 'USED') usedIndex = idx;
            if (col === 'Avail' || col === 'Available' || col.toUpperCase() === 'AVAIL'
                || col.toUpperCase() === 'AVAILABLE') availIndex = idx;
        });
        if (totalIndex === -1) totalIndex = 1;
        if (usedIndex === -1) usedIndex = 2;
        if (availIndex === -1) availIndex = 3;
        const totalBytes = parseInt(data[totalIndex], 10);
        const usedBytes = parseInt(data[usedIndex], 10);
        const freeBytes = parseInt(data[availIndex], 10);
        if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes)) return null;
        return {
            totalBytes,
            usedBytes: Number.isFinite(usedBytes) ? usedBytes : Math.max(0, totalBytes - freeBytes),
            freeBytes
        };
    } catch (_) {
        return null;
    }
}

function getCachedFilesystemBytes() {
    const now = Date.now();
    if (hostDiskCache && (now - hostDiskCacheAt) < HOST_DISK_CACHE_MS) {
        return hostDiskCache;
    }
    hostDiskCache = readFilesystemBytes();
    hostDiskCacheAt = now;
    return hostDiskCache;
}

function getHostMetrics() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = Math.max(0, totalMem - freeMem);
    const cpuCount = Math.max(1, os.cpus().length);
    const load = os.loadavg();
    const disk = getCachedFilesystemBytes();
    const diskTotalBytes = disk?.totalBytes || 0;
    const diskFreeBytes = disk?.freeBytes || 0;
    const diskUsedBytes = disk?.usedBytes || 0;
    const diskUsedPercent = diskTotalBytes > 0 ? (diskUsedBytes / diskTotalBytes) * 100 : 0;
    const cpuPercent = Math.min(100, (load[0] / cpuCount) * 100);
    const ramPercent = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;

    return {
        hostUptimeMs: Math.floor(os.uptime() * 1000),
        loadAverage: {
            one: load[0],
            five: load[1],
            fifteen: load[2]
        },
        hostCpuPercent: cpuPercent,
        hostRamPercent: ramPercent,
        hostRamUsedBytes: usedMem,
        hostRamTotalBytes: totalMem,
        diskFreeBytes,
        diskTotalBytes,
        diskUsedBytes,
        diskUsedPercent
    };
}

function getPm2DiskUsageBytes() {
    const paths = pm2LogPaths.getPm2LogPaths();
    if (!paths) return 0;
    let total = 0;
    for (const filePath of [paths.out, paths.err]) {
        if (!filePath || !fs.existsSync(filePath)) continue;
        try {
            total += fs.statSync(filePath).size;
        } catch (_) { /* ignore */ }
    }
    return total;
}

function getProcessStatus() {
    const name = getProcessName();
    if (!name) {
        return Promise.resolve(null);
    }
    return withPm2((pm2lib) => new Promise((resolve, reject) => {
        pm2lib.describe(name, (err, procs) => {
            if (err) return reject(err);
            const proc = procs && procs[0];
            if (!proc) {
                return reject(new Error(`PM2 process "${name}" not found`));
            }
            const pmUptime = proc.pm2_env?.pm_uptime || null;
            resolve({
                processName: name,
                pm2Id: proc.pm2_env?.pm_id ?? null,
                pid: proc.pid,
                status: proc.pm2_env?.status || 'unknown',
                cpu: typeof proc.monit?.cpu === 'number' ? proc.monit.cpu : 0,
                memory: typeof proc.monit?.memory === 'number' ? proc.monit.memory : 0,
                uptime: pmUptime,
                applicationUptimeMs: pmUptime ? Math.max(0, Date.now() - pmUptime) : null,
                restarts: proc.pm2_env?.restart_time || 0,
                diskUsageBytes: getPm2DiskUsageBytes(),
                ...getHostMetrics()
            });
        });
    }));
}

function flushLogs() {
    const name = getProcessName();
    if (!name) {
        return Promise.reject(new Error('PM2 not available'));
    }
    return withPm2((pm2lib) => new Promise((resolve, reject) => {
        pm2lib.flush(name, (err) => {
            if (err) return reject(err);
            resolve({ processName: name, flushed: true });
        });
    }));
}

function restartProcess() {
    const name = getProcessName();
    if (!name) {
        return Promise.reject(new Error('PM2 not available'));
    }
    return withPm2((pm2lib) => new Promise((resolve, reject) => {
        pm2lib.reset(name, (resetErr) => {
            if (resetErr) return reject(resetErr);
            pm2lib.restart(name, (err) => {
                if (err) return reject(err);
                resolve({ processName: name, restarted: true });
            });
        });
    }));
}

module.exports = {
    isPm2Available,
    getPm2DiskUsageBytes,
    getHostMetrics,
    getProcessStatus,
    flushLogs,
    restartProcess
};
