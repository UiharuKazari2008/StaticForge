/**
 * Melaton app runner (Yozora #638): the server halves of running .msaz / .mapz apps.
 *
 * Every launch is an *instance* owned by one client tab (its WebSocket). An app's server half runs
 * in its own Node process inside the sandbox (sandboxPreload.js + sandboxBootstrap.js):
 *   - runner 'session': one process per instance. It ends with the instance: when the app's last
 *     window closes (app_terminate), when the app calls exit, or when the owning tab disconnects.
 *   - runner 'service': one process per package, shared by its instances and kept running when
 *     none is attached. It ends on stopService (app_service_stop), uninstall / disable, or shutdown.
 * Apps without a server half still get an instance (so app_list shows them), with no process.
 *
 * The process can read its package and read / write .cache/packages/.data/<id>/, nothing else
 * (Node permission model); the network and process modules are taken away (sandboxPreload.js).
 * It is reached only over IPC. Host services it may call: readLaunchFile(name) and
 * listLaunchFolder(), answered from the instance's launch context (the folder or archive the
 * launched VFS file sits in), so an app can read its data the way a Windows program reads .\*.
 *
 * Docs: docs/client-api/melaton-apps.md. WS: modules/ws/handlers/245-melatonAppsHandler.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');

const HERE = __dirname;
const PRELOAD = path.join(HERE, 'sandboxPreload.js');
const BOOTSTRAP = path.join(HERE, 'sandboxBootstrap.js');

const LIMITS = {
    processes: 24,
    instancesPerOwner: 12,
    memoryMB: { min: 16, max: 512, default: 96 },
    stopGraceMs: 2000,
    killGraceMs: 1000,
    pingEveryMs: 15000,
    pingTimeoutMs: 45000,
    messageBytes: 8 * 1024 * 1024,
    logLines: 200
};

function newId(prefix) {
    return `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
}

function approxSize(value) {
    if (value == null) return 0;
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof value === 'string') return value.length * 2;
    try { return Buffer.byteLength(JSON.stringify(value)); } catch (_) { return LIMITS.messageBytes + 1; }
}

class MelatonAppError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'MelatonAppError';
        this.code = code || 'APP_ERROR';
    }
}

class MelatonAppRunner {
    /**
     * @param {object} options
     * @param {string} options.dataRoot  parent of the per-package data dirs
     * @param {function} [options.log]   (level, text) => void
     */
    constructor(options) {
        const opts = options || {};
        if (!opts.dataRoot) throw new MelatonAppError('dataRoot is required', 'APP_ROOT');
        this.dataRoot = path.resolve(opts.dataRoot);
        this.log = opts.log || ((level, text) => console[level === 'error' ? 'error' : 'log'](text));
        this.nodePath = opts.nodePath || process.execPath;
        this.instances = new Map(); // instanceId -> instance
        this.procs = new Map(); // procId -> proc
        this.services = new Map(); // packageId -> proc
    }

    // ---- launch / end ------------------------------------------------------------------------

    /**
     * Start an instance of a package for one client.
     * pkg: { id, dir, manifest } (manifest from validateManifest; server: { entry, runner, memoryMB })
     * owner: { key, clientId, sessionId } - key identifies the tab (the ws object)
     * launch: { file, folder, readFile(name) -> Promise<Buffer>, list() -> Promise<[]> } or null
     * deliver(msg): sends a push to the owning client ({ type, data })
     */
    launch({ pkg, owner, launch, deliver }) {
        if (!pkg || !pkg.id || !pkg.dir || !pkg.manifest) throw new MelatonAppError('package is required', 'APP_PACKAGE');
        if (!owner || owner.key == null) throw new MelatonAppError('owner is required', 'APP_OWNER');
        const owned = Array.from(this.instances.values()).filter((i) => i.owner.key === owner.key).length;
        if (owned >= LIMITS.instancesPerOwner) throw new MelatonAppError('Too many programs are running in this window', 'APP_LIMIT');

        const instance = {
            id: newId('app'),
            packageId: pkg.id,
            title: pkg.manifest.title,
            // a .msaz run from the VFS: its tree under .cache/packages/.run/ stays while it runs
            runSha: pkg.runSha || null,
            runner: pkg.manifest.server ? pkg.manifest.server.runner : null,
            owner,
            launch: launch || null,
            deliver: typeof deliver === 'function' ? deliver : () => {},
            proc: null,
            startedAt: Date.now()
        };

        if (pkg.manifest.server) {
            let proc = instance.runner === 'service' ? this.services.get(pkg.id) : null;
            if (!proc) proc = this._spawn(pkg, instance.runner);
            instance.proc = proc;
            proc.instances.add(instance.id);
            this._post(proc, {
                t: 'attach',
                instance: instance.id,
                launch: launch ? { file: launch.file || null, folder: launch.folder || null } : null
            });
        }
        this.instances.set(instance.id, instance);
        return { instanceId: instance.id, runner: instance.runner, server: !!instance.proc };
    }

    /** A client message for the instance's server half. */
    message(instanceId, data, ownerKey) {
        const instance = this._own(instanceId, ownerKey);
        if (!instance.proc) throw new MelatonAppError('This program has no server part', 'APP_NO_SERVER');
        if (approxSize(data) > LIMITS.messageBytes) throw new MelatonAppError('Message too large', 'APP_MESSAGE_SIZE');
        this._post(instance.proc, { t: 'msg', instance: instance.id, data });
    }

    /** End one instance (its window closed, or the app exited on the client). */
    terminate(instanceId, ownerKey, reason) {
        const instance = this._own(instanceId, ownerKey);
        this._end(instance, reason || 'closed', false);
        return { instanceId, ended: true };
    }

    /** The owning tab went away: every instance it owned ends. */
    ownerGone(ownerKey) {
        let n = 0;
        for (const instance of Array.from(this.instances.values())) {
            if (instance.owner.key !== ownerKey) continue;
            this._end(instance, 'disconnected', false);
            n++;
        }
        return n;
    }

    /** Stop a package's service process (and end the instances attached to it). */
    stopService(packageId) {
        const proc = this.services.get(packageId);
        if (!proc) return { packageId, stopped: false };
        this._stop(proc, 'stopped');
        return { packageId, stopped: true };
    }

    /** End everything of a package (uninstall / disable). */
    stopPackage(packageId) {
        for (const instance of Array.from(this.instances.values())) {
            if (instance.packageId === packageId) this._end(instance, 'stopped', false);
        }
        this.stopService(packageId);
    }

    list() {
        const procs = Array.from(this.procs.values()).map((p) => ({
            procId: p.id,
            packageId: p.packageId,
            runner: p.runner,
            runSha: p.runSha,
            pid: p.child ? p.child.pid : null,
            ready: p.ready,
            startedAt: new Date(p.startedAt).toISOString(),
            instances: Array.from(p.instances)
        }));
        const instances = Array.from(this.instances.values()).map((i) => ({
            instanceId: i.id,
            packageId: i.packageId,
            title: i.title,
            runner: i.runner,
            clientId: i.owner.clientId || null,
            procId: i.proc ? i.proc.id : null,
            startedAt: new Date(i.startedAt).toISOString()
        }));
        return { instances, processes: procs };
    }

    logsOf(packageId) {
        const proc = this.services.get(packageId) || Array.from(this.procs.values()).find((p) => p.packageId === packageId);
        return proc ? proc.logs.slice() : [];
    }

    shutdown() {
        for (const proc of Array.from(this.procs.values())) this._stop(proc, 'shutdown');
    }

    // ---- internals ---------------------------------------------------------------------------

    _own(instanceId, ownerKey) {
        const instance = this.instances.get(instanceId);
        if (!instance) throw new MelatonAppError('Program is not running', 'APP_NOT_RUNNING');
        if (ownerKey !== undefined && instance.owner.key !== ownerKey) throw new MelatonAppError('Program belongs to another window', 'APP_NOT_OWNER');
        return instance;
    }

    _end(instance, reason, fromProcExit) {
        if (!this.instances.has(instance.id)) return;
        this.instances.delete(instance.id);
        const proc = instance.proc;
        if (proc && !fromProcExit) {
            proc.instances.delete(instance.id);
            if (proc.runner === 'session') this._stop(proc, reason);
            else this._post(proc, { t: 'detach', instance: instance.id });
        }
    }

    _spawn(pkg, runner) {
        if (this.procs.size >= LIMITS.processes) throw new MelatonAppError('Too many program processes are running', 'APP_LIMIT');
        const server = pkg.manifest.server;
        const pkgDir = path.resolve(pkg.dir);
        const entry = path.resolve(pkgDir, server.entry);
        if (!entry.startsWith(pkgDir + path.sep) || !fs.existsSync(entry)) {
            throw new MelatonAppError(`Missing server.entry: ${server.entry}`, 'APP_SERVER_ENTRY');
        }
        const dataDir = path.join(this.dataRoot, pkg.id);
        fs.mkdirSync(dataDir, { recursive: true });
        const mem = Math.max(LIMITS.memoryMB.min, Math.min(LIMITS.memoryMB.max, Number(server.memoryMB) || LIMITS.memoryMB.default));
        const execArgv = [
            '--experimental-permission',
            '--disable-warning=ExperimentalWarning',
            `--allow-fs-read=${pkgDir}`,
            `--allow-fs-read=${HERE}`,
            `--allow-fs-read=${dataDir}`,
            `--allow-fs-write=${dataDir}`,
            '-r', PRELOAD,
            `--max-old-space-size=${mem}`
        ];
        const child = fork(BOOTSTRAP, [path.relative(pkgDir, entry), dataDir, runner, pkg.id], {
            cwd: pkgDir,
            execPath: this.nodePath,
            execArgv,
            env: { NODE_ENV: 'production', LANG: 'C.UTF-8', TZ: process.env.TZ || '' },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            serialization: 'advanced'
        });
        const proc = {
            id: newId('proc'),
            packageId: pkg.id,
            title: pkg.manifest.title,
            runSha: pkg.runSha || null,
            runner,
            child,
            ready: false,
            queue: [],
            instances: new Set(),
            startedAt: Date.now(),
            lastPong: Date.now(),
            pingN: 0,
            stopping: null,
            logs: []
        };
        this.procs.set(proc.id, proc);
        if (runner === 'service') this.services.set(pkg.id, proc);

        const note = (level, text) => {
            const line = `[app ${pkg.id}] ${text}`;
            proc.logs.push({ at: new Date().toISOString(), level, text: String(text).slice(0, 4000) });
            if (proc.logs.length > LIMITS.logLines) proc.logs.shift();
            this.log(level, line);
        };
        for (const [stream, level] of [[child.stdout, 'info'], [child.stderr, 'error']]) {
            if (!stream) continue;
            stream.setEncoding('utf8');
            stream.on('data', (chunk) => {
                for (const l of String(chunk).split('\n')) if (l.trim()) note(level, l.slice(0, 2000));
            });
        }
        child.on('message', (msg) => this._fromApp(proc, msg, note));
        child.on('error', (err) => note('error', `process error: ${err.message}`));
        child.on('exit', (code, signal) => this._exited(proc, code, signal, note));

        proc.pinger = setInterval(() => {
            if (!proc.ready) return;
            if (Date.now() - proc.lastPong > LIMITS.pingTimeoutMs) {
                note('error', 'not responding; ending it');
                proc.hung = true;
                this._kill(proc);
                return;
            }
            this._send(proc, { t: 'ping', n: ++proc.pingN });
        }, LIMITS.pingEveryMs);
        if (proc.pinger.unref) proc.pinger.unref();
        return proc;
    }

    _send(proc, msg) {
        if (!proc.child || !proc.child.connected) return;
        try {
            proc.child.send(msg);
        } catch (err) {
            this.log('error', `[app ${proc.packageId}] send failed: ${err.message}`);
        }
    }

    /** Deliver to the app, queued until its start(app) resolved. */
    _post(proc, msg) {
        if (proc.ready) this._send(proc, msg);
        else proc.queue.push(msg);
    }

    _fromApp(proc, msg, note) {
        if (!msg || typeof msg !== 'object') return;
        switch (msg.t) {
            case 'ready':
                proc.ready = true;
                proc.lastPong = Date.now();
                for (const queued of proc.queue.splice(0)) this._send(proc, queued);
                break;
            case 'pong':
                proc.lastPong = Date.now();
                break;
            case 'log':
                note(['warn', 'error'].includes(msg.level) ? msg.level : 'info', msg.text);
                break;
            case 'send': {
                if (approxSize(msg.data) > LIMITS.messageBytes) {
                    note('error', 'message to client too large; dropped');
                    break;
                }
                const targets = msg.instance ? [msg.instance] : Array.from(proc.instances);
                for (const id of targets) {
                    const instance = this.instances.get(id);
                    if (!instance || instance.proc !== proc) continue;
                    instance.deliver({ type: 'app_message', data: { instanceId: id, data: msg.data } });
                }
                break;
            }
            case 'call':
                this._hostCall(proc, msg).then(
                    (value) => this._send(proc, { t: 'result', id: msg.id, ok: true, value }),
                    (err) => this._send(proc, { t: 'result', id: msg.id, ok: false, error: err.message, code: err.code })
                );
                break;
            default:
                break;
        }
    }

    async _hostCall(proc, msg) {
        const instance = msg.instance ? this.instances.get(msg.instance) : null;
        if (!instance || instance.proc !== proc) throw new MelatonAppError('No such client instance for this call', 'APP_CALL_INSTANCE');
        const launch = instance.launch;
        switch (msg.method) {
            case 'readLaunchFile': {
                if (!launch || typeof launch.readFile !== 'function') throw new MelatonAppError('This program was not started from a file', 'APP_NO_LAUNCH');
                const name = String((msg.args || [])[0] || '');
                if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new MelatonAppError('A file name in the launch folder is required', 'APP_CALL_ARGS');
                const buf = await launch.readFile(name);
                if (!Buffer.isBuffer(buf)) throw new MelatonAppError(`File not found: ${name}`, 'APP_FILE_NOT_FOUND');
                if (buf.length > LIMITS.messageBytes * 4) throw new MelatonAppError('File too large', 'APP_FILE_SIZE');
                return buf;
            }
            case 'listLaunchFolder':
                if (!launch || typeof launch.list !== 'function') return [];
                return launch.list();
            default:
                throw new MelatonAppError(`Unknown host call: ${msg.method}`, 'APP_CALL_UNKNOWN');
        }
    }

    _stop(proc, reason) {
        if (proc.stopping || !proc.child || proc.child.exitCode != null) return;
        proc.stopping = reason || 'stopped';
        // the app gets its onStop handlers, then the signals
        if (proc.ready) this._send(proc, { t: 'stop' });
        else this._kill(proc);
        proc.stopTimer = setTimeout(() => this._kill(proc), LIMITS.stopGraceMs);
        if (proc.stopTimer.unref) proc.stopTimer.unref();
    }

    _kill(proc) {
        if (!proc.child || proc.child.exitCode != null || proc.child.signalCode) return;
        try { proc.child.kill('SIGTERM'); } catch (_) { /* gone */ }
        proc.killTimer = setTimeout(() => {
            try { proc.child.kill('SIGKILL'); } catch (_) { /* gone */ }
        }, LIMITS.killGraceMs);
        if (proc.killTimer.unref) proc.killTimer.unref();
    }

    _exited(proc, code, signal, note) {
        clearInterval(proc.pinger);
        clearTimeout(proc.stopTimer);
        clearTimeout(proc.killTimer);
        this.procs.delete(proc.id);
        if (this.services.get(proc.packageId) === proc) this.services.delete(proc.packageId);
        const expected = !!proc.stopping;
        note(expected ? 'info' : 'error', `exited (${signal || code})${expected ? ` after ${proc.stopping}` : ''}`);
        for (const id of Array.from(proc.instances)) {
            const instance = this.instances.get(id);
            if (!instance) continue;
            this._end(instance, 'exited', true);
            instance.deliver({
                type: 'app_exited',
                data: {
                    instanceId: id,
                    packageId: proc.packageId,
                    code,
                    signal,
                    // a crash, a hang or a start failure: the client shows "<app> has stopped working"
                    fault: !expected && (code !== 0 || !!signal || proc.hung === true),
                    reason: proc.hung ? 'not-responding' : (expected ? proc.stopping : 'exited'),
                    log: proc.logs.slice(-5).map((l) => l.text)
                }
            });
        }
        proc.instances.clear();
    }
}

module.exports = { MelatonAppRunner, MelatonAppError, LIMITS };
