/**
 * Entry point of a Melaton app's server half (Yozora #638). The runner (modules/melatonApps/runner.js)
 * forks this file inside the sandbox (sandboxPreload.js) with argv [entry, dataDir, runner, id].
 *
 * The package's server.entry exports start(app) (module.exports = start, or { start }). `app` is
 * the only way out of the process:
 *   app.id / app.runner ('session' | 'service') / app.dataDir (read-write) / app.packageDir
 *   app.onMessage((data, instanceId) => ...)   a message from one of the app's client windows
 *   app.send(data, instanceId?)                to one client instance, or to all attached ones
 *   app.onAttach(fn) / app.onDetach(fn)        client instances coming and going (services see many)
 *   app.instances()                            the attached instance ids
 *   await app.call(method, ...args)            host services: readLaunchFile(name), listLaunchFolder()
 *   await app.callFor(instance, method, ...)   the same for one instance (services with several)
 *   app.onStop(fn)                             runs before the runner ends the process
 *   app.log(...) / app.exit(code)
 * A session runner has exactly one instance; it ends when that instance ends. A service keeps
 * running with none attached.
 *
 * IPC, host -> app: {t:'attach'|'detach', instance, launch?}, {t:'msg', instance, data},
 *   {t:'result', id, ok, value, error}, {t:'stop'}, {t:'ping', n}
 * app -> host: {t:'ready'}, {t:'send', instance|null, data},
 *   {t:'call', id, instance, method, args}, {t:'log', level, text}, {t:'pong', n}
 */
'use strict';

const path = require('path');

const [entryArg, dataDir, runner, appId] = process.argv.slice(2);
const packageDir = process.cwd();

const handlers = { message: [], attach: [], detach: [], stop: [] };
const instances = new Set();
const launches = new Map();
const pending = new Map();
let callSeq = 0;

function post(msg) {
    if (process.connected) process.send(msg);
}

function fmt(args) {
    return args.map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch (_) { return String(a); } })())).join(' ').slice(0, 4000);
}

const app = Object.freeze({
    id: appId,
    runner,
    dataDir,
    packageDir,
    onMessage: (fn) => { handlers.message.push(fn); },
    onAttach: (fn) => { handlers.attach.push(fn); },
    onDetach: (fn) => { handlers.detach.push(fn); },
    onStop: (fn) => { handlers.stop.push(fn); },
    instances: () => Array.from(instances),
    launchOf: (instance) => launches.get(instance) || null,
    send: (data, instance) => post({ t: 'send', instance: instance || null, data }),
    // host services act for one client instance (its launch folder): a session's only one, or callFor's
    call: (method, ...args) => app.callFor(instances.size === 1 ? Array.from(instances)[0] : null, method, ...args),
    callFor: (instance, method, ...args) => new Promise((resolve, reject) => {
        const id = ++callSeq;
        pending.set(id, { resolve, reject });
        post({ t: 'call', id, instance: instance || null, method: String(method), args });
    }),
    log: (...args) => post({ t: 'log', level: 'info', text: fmt(args) }),
    exit: (code) => { setImmediate(() => process.exit(Number(code) || 0)); }
});

// console goes to the host's log, tagged with the app
for (const level of ['log', 'info', 'warn', 'error']) {
    console[level] = (...args) => post({ t: 'log', level, text: fmt(args) });
}

async function emit(list, ...args) {
    for (const fn of list) {
        try {
            await fn(...args);
        } catch (err) {
            post({ t: 'log', level: 'error', text: `handler failed: ${err && err.stack || err}` });
        }
    }
}

process.on('message', async (msg) => {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
        case 'attach':
            instances.add(msg.instance);
            launches.set(msg.instance, msg.launch || null);
            await emit(handlers.attach, msg.instance, msg.launch || null);
            break;
        case 'detach':
            instances.delete(msg.instance);
            launches.delete(msg.instance);
            await emit(handlers.detach, msg.instance);
            break;
        case 'msg':
            await emit(handlers.message, msg.data, msg.instance);
            break;
        case 'result': {
            const p = pending.get(msg.id);
            if (!p) break;
            pending.delete(msg.id);
            if (msg.ok) p.resolve(msg.value);
            else p.reject(Object.assign(new Error(msg.error || 'host call failed'), { code: msg.code }));
            break;
        }
        case 'ping':
            post({ t: 'pong', n: msg.n });
            break;
        case 'stop':
            await emit(handlers.stop);
            process.exit(0);
            break;
        default:
            break;
    }
});

process.on('disconnect', () => process.exit(0));
process.on('uncaughtException', (err) => {
    post({ t: 'log', level: 'error', text: `uncaught: ${err && err.stack || err}` });
    process.exit(70);
});
process.on('unhandledRejection', (err) => {
    post({ t: 'log', level: 'error', text: `unhandled rejection: ${err && err.stack || err}` });
    process.exit(70);
});

(async () => {
    const entry = path.resolve(packageDir, entryArg);
    if (!entry.startsWith(packageDir + path.sep)) throw new Error('server.entry is outside the package');
    const mod = require(entry);
    const start = typeof mod === 'function' ? mod : (mod && typeof mod.start === 'function' ? mod.start : null);
    if (!start) throw new Error('server.entry must export start(app)');
    await start(app);
    post({ t: 'ready' });
})().catch((err) => {
    post({ t: 'log', level: 'error', text: `start failed: ${err && err.stack || err}` });
    process.exit(71);
});
