/**
 * ActiveSync: a connected phone's storage on the desktop (Yozora #747).
 *
 * Explorer's phone drive (explorerPhoneDrive.js) talks to window.phoneStorage, which inside the
 * Android app is the app's own bridge (phoneStorageBridge.js). On a desktop this file is that
 * object: the same calls go to the phone through ActiveSync (storage.* operations), file bodies
 * come and go over HTTP through the server (modules/activeSyncTransfers.js), and what changes on
 * the phone arrives as events. So the phone shows in Computer and the navigation pane with its
 * drives, thumbnails, copy and paste, exactly as it does on the phone itself.
 *
 *   phoneStorage.available     a device with the files permission is connected
 *   phoneStorage.deviceId / deviceName   the device shown (one at a time)
 *   phoneStorage.select(deviceId)        show another connected device
 *   phoneStorage.devices()               [{ deviceId, name }] that could be shown
 *
 * Not offered from a computer: the app's settings and its storage permission prompt (openSettings,
 * requestAccess) and Android's share sheet; they answer { code: 'unsupported' }.
 * Desktop tabs only (activeSync.kind === 'computer').
 */
(function (root) {
    'use strict';

    const as = root.activeSync;
    if (!as || as.kind !== 'computer' || root.phoneStorage) return;

    const REMOTE_OPS = new Set(['hello', 'list', 'stat', 'mkdir', 'rename', 'delete', 'trash', 'trashList', 'restore', 'move', 'copy', 'open', 'watch', 'unwatch']);
    const listeners = new Map();
    const progress = new Map(); // transfer id -> onProgress
    const watches = new Map(); // "root\npath" -> count
    let chosen = null;          // the device the user picked, while it stays usable
    let current = null;         // { deviceId, name } in use
    let state = null;
    let helloPromise = null;

    function error(code, message) {
        return { code: code || 'io', message: message || code || 'Phone storage error' };
    }

    function emit(event, data) {
        (listeners.get(event) || []).slice().forEach((fn) => {
            try { fn(data); } catch (err) { console.warn('[activeSync storage] listener failed:', err); }
        });
    }

    function on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(fn);
        return () => {
            const list = listeners.get(event) || [];
            const i = list.indexOf(fn);
            if (i >= 0) list.splice(i, 1);
        };
    }

    function usable() {
        return as.state().devices.filter((d) => d.online && (d.session === 'guest' || d.session === 'partner') && d.permissions.includes('files'));
    }

    function pick() {
        const list = usable();
        return list.find((d) => d.deviceId === chosen) || list[0] || null;
    }

    /** The device in use follows what is connected; a change is a 'config' for Explorer. */
    function sync() {
        const d = pick();
        const next = d ? { deviceId: d.deviceId, name: d.name } : null;
        const changed = (current && current.deviceId) !== (next && next.deviceId);
        const renamed = !changed && current && next && current.name !== next.name;
        current = next;
        if (changed) {
            state = null;
            helloPromise = null;
            watches.clear();
            if (current) hello().then(() => emit('config', state), () => emit('config', state));
            else emit('config', null);
        } else if (renamed) {
            emit('state', state);
        }
    }

    function call(op, args = {}) {
        if (!current) return Promise.reject(error('disabled', 'No device is connected'));
        if (!REMOTE_OPS.has(op)) return Promise.reject(error('unsupported', 'This is done on the device itself'));
        return as.call(current.deviceId, `storage.${op}`, args, { timeoutMs: 60000 })
            .catch((e) => { throw error(e && e.code, e && e.message); });
    }

    function hello() {
        if (!helloPromise) {
            const dev = current;
            helloPromise = call('hello').then((result) => {
                if (!current || !dev || current.deviceId !== dev.deviceId) return state;
                // file URLs are this server's, relayed from the phone
                state = Object.assign({}, result || {}, { baseUrl: `/api/activesync/file/${dev.deviceId}` });
                emit('state', state);
                return state;
            }, (err) => {
                helloPromise = null;
                throw err;
            });
        }
        return helloPromise;
    }

    function encodePath(path) {
        return String(path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
    }

    function fileUrl(rootId, path, opts = {}) {
        if (!current) return '';
        let url = `/api/activesync/file/${current.deviceId}/${encodeURIComponent(rootId)}/${encodePath(path)}`;
        const q = [];
        if (opts.thumb) q.push(`thumb=${Math.max(32, Math.min(1024, Math.round(opts.thumb)))}`);
        if (opts.download) q.push('download=1');
        if (q.length) url += `?${q.join('&')}`;
        return url;
    }

    function joinPath(dir, name) {
        const base = String(dir || '/').replace(/\/+$/, '');
        return `${base}/${name}`.replace(/^\/*/, '/');
    }

    function parentPath(path) {
        const parts = String(path || '/').split('/').filter(Boolean);
        parts.pop();
        return '/' + parts.join('/');
    }

    function baseName(path) {
        const parts = String(path || '').split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    }

    function watch(rootId, path) {
        const key = `${rootId}\n${path}`;
        const n = watches.get(key) || 0;
        watches.set(key, n + 1);
        if (n === 0) return call('watch', { root: rootId, path }).then((ok) => ok !== false, () => false);
        return Promise.resolve(true);
    }

    function unwatch(rootId, path) {
        const key = `${rootId}\n${path}`;
        const n = watches.get(key) || 0;
        if (n <= 1) {
            watches.delete(key);
            if (n === 1) return call('unwatch', { root: rootId, path }).catch(() => {});
        } else {
            watches.set(key, n - 1);
        }
        return Promise.resolve();
    }

    async function post(url, body, signal, json) {
        const res = await fetch(url, {
            method: 'POST', credentials: 'same-origin', signal: signal || undefined,
            headers: { 'Content-Type': json ? 'application/json' : 'application/octet-stream' },
            body: json ? JSON.stringify(body) : body
        });
        let data = null;
        try { data = await res.json(); } catch (_) { /* no body */ }
        return { status: res.status, data: data || {} };
    }

    function transferId() {
        const bytes = new Uint8Array(16);
        root.crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * A Blob/File into a phone folder: to the server in chunks, then the phone pulls it. The first
     * half of the progress is the way to the server, the second the phone writing it.
     * opts: { name, conflict, mtime, signal, onProgress(bytes, total), queue, deviceId, install }.
     * queue: an offline partner gets it when it next connects ({ queued: true }).
     * install: an .apk is then offered to Android's installer (#795); the answer carries install.
     */
    async function write(rootId, dir, file, opts = {}) {
        const deviceId = opts.deviceId || (current && current.deviceId);
        if (!deviceId) throw error('disabled', 'No device is connected');
        const total = file.size;
        const signal = opts.signal || null;
        const note = (bytes) => { if (opts.onProgress) opts.onProgress(Math.max(0, Math.min(total, Math.round(bytes))), total); };
        const id = transferId();
        const begun = await post(`/api/activesync/upload/${deviceId}/begin`, {
            id, root: rootId, dir, name: opts.name || file.name, size: total,
            conflict: opts.conflict || 'fail', mtime: opts.mtime != null ? opts.mtime : (file.lastModified || undefined)
        }, signal, true);
        if (begun.status !== 200) throw error(begun.data.code, begun.data.error);
        const chunkSize = begun.data.chunkSize || 4 * 1024 * 1024;
        const giveUp = () => { fetch(`/api/activesync/upload/${id}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {}); };
        try {
            let offset = 0;
            let retries = 0;
            while (offset < total) {
                if (signal && signal.aborted) throw error('aborted', 'Cancelled');
                let sent;
                try {
                    sent = await post(`/api/activesync/upload/${id}/chunk?offset=${offset}`, file.slice(offset, Math.min(total, offset + chunkSize)), signal, false);
                } catch (e) {
                    if (signal && signal.aborted) throw error('aborted', 'Cancelled');
                    // a dropped connection: ask again where the file stands, a few times
                    retries += 1;
                    if (retries > 5) throw error('io', 'The connection to the server was lost');
                    await new Promise((r) => setTimeout(r, 1000 * retries));
                    sent = { status: 0, data: {} };
                }
                if (sent.status === 200 || sent.status === 409) {
                    if (typeof sent.data.received !== 'number') throw error(sent.data.code, sent.data.error);
                    offset = sent.data.received;
                    if (sent.status === 200) retries = 0;
                } else if (sent.status !== 0) {
                    throw error(sent.data.code, sent.data.error);
                }
                note(offset / 2);
            }
            progress.set(id, (written) => note(total / 2 + written / 2));
            const done = await post(`/api/activesync/upload/${id}/commit`, { queue: !!opts.queue, install: !!opts.install }, null, true);
            if (done.status !== 200) throw error(done.data.code, done.data.error);
            note(total);
            if (opts.install) return { queued: !!done.data.queued, entry: done.data.entry || null, install: done.data.install || (done.data.queued ? 'queued' : null) };
            return done.data.queued ? { queued: true } : done.data.entry;
        } catch (err) {
            giveUp();
            throw err;
        } finally {
            progress.delete(id);
        }
    }

    as.on('state', sync);
    as.on('event', (e) => {
        if (!e || !e.from || e.from.kind !== 'device') return;
        if (e.event === 'stream.progress' && e.detail && progress.has(e.detail.transferId)) {
            progress.get(e.detail.transferId)(Number(e.detail.written) || 0);
            return;
        }
        if (!current || e.from.id !== current.deviceId) return;
        if (e.event === 'storage.changed') emit('changed', e.detail || {});
        else if (e.event === 'storage.config') {
            helloPromise = null;
            hello().then(() => emit('config', state), () => emit('config', state));
        }
    });

    // Device Center's File Management (apps/activesync; tasks queue until it loads)
    const mas = (root.melatonActiveSync = root.melatonActiveSync || {});
    const addTask = (tile, task) => (typeof mas.addTask === 'function' ? mas.addTask(tile, task) : (mas.pending = mas.pending || []).push([tile, task]));
    addTask('files', {
        id: 'browse', text: 'Browse the contents of your device', icon: 'explore-32.png',
        when: (d) => d.online && d.permissions.includes('files'),
        run: (d) => {
            root.phoneStorage.select(d.deviceId);
            // openExplorerApplet: public/scripts/comp/featureLoader.js
            return typeof root.openExplorerApplet === 'function' ? root.openExplorerApplet('phone://') : undefined;
        }
    });

    // Programs and Services: an Android program (.apk) from this computer to the phone (Yukimi, Nov 13,
    // #795). It goes to Download on the phone and Android's installer opens there, or a notification
    // waits for a tap when the app is in the background; the user confirms on the phone. A partner
    // that is away gets it, and the install, when it next connects.
    addTask('programs', {
        id: 'install-apk', text: 'Install a program on your device', icon: 'add-programs-32.png',
        when: (d) => d.partner && d.permissions.includes('files') && d.permissions.includes('control'),
        run: (d) => new Promise((resolve) => {
            const pick = document.createElement('input');
            pick.type = 'file';
            pick.accept = '.apk,application/vnd.android.package-archive';
            pick.addEventListener('change', async () => {
                const file = pick.files && pick.files[0];
                if (!file) { resolve(); return; }
                const name = d.name || 'your device';
                const box = (html, title = 'Melaton Mobile Device Center') => (typeof root.showConfirmationDialog === 'function'
                    ? root.showConfirmationDialog(html, [{ text: 'OK', value: true, className: 'btn-primary' }], null, { title })
                    : Promise.resolve());
                const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
                try {
                    const r = await write('internal', '/Download', file, { deviceId: d.deviceId, conflict: 'replace', install: true, queue: true });
                    const st = r && r.install && (r.install.state || r.install);
                    const msg = r && r.queued ? `${esc(name)} is not connected. ${esc(file.name)} will be copied and offered for installation when it connects.`
                        : st === 'prompted' ? `${esc(file.name)} was copied to ${esc(name)}. Confirm the installation on the device.`
                            : st === 'notified' ? `${esc(file.name)} was copied to ${esc(name)}. Tap the notification on the device to install it.`
                                : st === 'needs_permission' ? `${esc(file.name)} was copied to ${esc(name)}, but the device does not allow Dreamscape to install programs yet. Allow it on the device, then try again.`
                                    : `${esc(file.name)} was copied to the Download folder of ${esc(name)}, but it could not be offered for installation${r && r.install && r.install.error ? `: ${esc(r.install.error)}` : '.'}`;
                    await box(msg);
                } catch (err) {
                    await box(`${esc(file.name)} could not be sent to ${esc(name)}.<br>${esc((err && err.message) || '')}`);
                }
                resolve();
            }, { once: true });
            pick.click();
        })
    });

    root.phoneStorage = {
        get available() { return !!current; },
        get deviceId() { return current ? current.deviceId : null; },
        get deviceName() { return current ? current.name : null; },
        remote: true,
        call,
        hello,
        state: () => state,
        on,
        fileUrl,
        encodePath,
        joinPath,
        parentPath,
        baseName,
        watch,
        unwatch,
        write,
        devices: () => usable().map((d) => ({ deviceId: d.deviceId, name: d.name })),
        select(deviceId) { chosen = deviceId || null; sync(); return !!(current && current.deviceId === deviceId); }
    };
    sync();
})(typeof window !== 'undefined' ? window : globalThis);
