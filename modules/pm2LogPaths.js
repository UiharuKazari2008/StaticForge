/**
 * Resolve PM2 stdout/stderr log file paths for the log viewer.
 * modules/globalResources.js (getConfig)
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

let globalResourcesInstance = null;
let cachedPm2Paths = undefined;

function setGlobalResources(gr) {
    globalResourcesInstance = gr;
    cachedPm2Paths = undefined;
}

function getConfig() {
    if (globalResourcesInstance) {
        return globalResourcesInstance.getConfig();
    }
    try {
        return require('../config.json');
    } catch (_) {
        return {};
    }
}

function getPm2Home() {
    return process.env.PM2_HOME || path.join(os.homedir(), '.pm2');
}

function getPm2LogsDir() {
    return path.join(getPm2Home(), 'logs');
}

function isRunningUnderPm2() {
    return process.env.pm_out_log_path != null || process.env.pm_id != null;
}

function resolvePm2LogPaths() {
    if (process.env.pm_out_log_path) {
        const out = path.resolve(process.env.pm_out_log_path);
        const err = process.env.pm_err_log_path
            ? path.resolve(process.env.pm_err_log_path)
            : out.replace(/-out\.log$/, '-error.log');
        return {
            out,
            err,
            processName: process.env.name || getConfig().pm2_process_name || 'Dreamscape'
        };
    }

    const configName = getConfig().pm2_process_name;
    const candidates = [
        configName,
        process.env.name,
        'Dreamscape',
        'staticforge'
    ].filter(Boolean);

    const seen = new Set();
    const logsDir = getPm2LogsDir();
    for (const name of candidates) {
        if (seen.has(name)) continue;
        seen.add(name);
        const out = path.join(logsDir, `${name}-out.log`);
        const err = path.join(logsDir, `${name}-error.log`);
        if (fs.existsSync(out) || fs.existsSync(err)) {
            return { out, err, processName: name };
        }
    }

    return null;
}

function getPm2LogPaths() {
    if (cachedPm2Paths !== undefined) {
        return cachedPm2Paths;
    }
    cachedPm2Paths = resolvePm2LogPaths();
    return cachedPm2Paths;
}

function validatePm2LogFilePath(filePath) {
    if (!filePath || typeof filePath !== 'string') return null;
    const resolved = path.resolve(filePath);
    const pm2Paths = getPm2LogPaths();
    if (pm2Paths) {
        if (resolved === path.resolve(pm2Paths.out) || resolved === path.resolve(pm2Paths.err)) {
            return resolved;
        }
    }
    const logsDir = path.resolve(getPm2LogsDir());
    if (!resolved.startsWith(logsDir + path.sep)) return null;
    const base = path.basename(resolved);
    if (!/^[a-zA-Z0-9._-]+-(out|error)\.log$/.test(base)) return null;
    return resolved;
}

function resolvePm2LogSource(source) {
    const pm2Paths = getPm2LogPaths();
    if (!pm2Paths) return null;
    if (source === 'pm2:out' || source === 'pm2-out') {
        return validatePm2LogFilePath(pm2Paths.out);
    }
    if (source === 'pm2:err' || source === 'pm2-err') {
        return validatePm2LogFilePath(pm2Paths.err);
    }
    return null;
}

module.exports = {
    setGlobalResources,
    getPm2LogPaths,
    isRunningUnderPm2,
    resolvePm2LogSource,
    validatePm2LogFilePath,
    getPm2LogsDir
};
