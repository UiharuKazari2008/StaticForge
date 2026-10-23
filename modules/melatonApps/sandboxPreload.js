/**
 * Preload for a Melaton app's server half (Yozora #638), loaded with -r before the app's code.
 *
 * The process already runs under Node's permission model (--experimental-permission): it can read
 * its own package and the runner files, read and write its data dir, and nothing else; it cannot
 * spawn processes, start workers or load addons. Node 20's permission model does not cover the
 * network, so this preload takes away the ways to reach it (and a few ways around the rules): the
 * network and process modules, fetch / WebSocket, process.binding, and process.kill for other pids.
 * This is defence in depth for admin-run packages, not a boundary for hostile code.
 */
'use strict';

const Module = require('module');

const BLOCKED = new Set([
    'net', 'http', 'https', 'http2', 'tls', 'dgram', 'dns', 'dns/promises',
    'child_process', 'worker_threads', 'cluster', 'inspector', 'inspector/promises',
    'vm', 'repl', 'module', 'v8', 'wasi', 'trace_events', 'diagnostics_channel'
]);

const load = Module._load;
Module._load = function melatonAppLoad(request) {
    const name = String(request || '').replace(/^node:/, '');
    if (BLOCKED.has(name)) {
        const err = new Error(`Module "${name}" is not available to Melaton apps`);
        err.code = 'ERR_MELATON_APP_BLOCKED';
        throw err;
    }
    return load.apply(this, arguments);
};
Object.freeze(Module);

for (const name of ['fetch', 'WebSocket', 'EventSource', 'Request', 'Response', 'Headers']) {
    try { delete globalThis[name]; } catch (_) { /* non-configurable: leave it */ }
}

const denied = (what) => () => {
    const err = new Error(`${what} is not available to Melaton apps`);
    err.code = 'ERR_MELATON_APP_BLOCKED';
    throw err;
};
process.binding = denied('process.binding');
process._linkedBinding = denied('process._linkedBinding');
process.dlopen = denied('process.dlopen');
const ownKill = process.kill.bind(process);
process.kill = (pid, signal) => {
    if (Number(pid) !== process.pid) denied('process.kill')();
    return ownKill(pid, signal);
};
process.chdir = denied('process.chdir');
