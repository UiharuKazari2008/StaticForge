/**
 * The Android app's phone storage bridge (DSApp-Kotlin, window.AndroidPhoneStorage), Yozora #698.
 * Exists only inside the app on this origin: everything here is a no-op in a browser
 * (phoneStorage.available === false).
 *
 *   phoneStorage.call(op, args)       Promise of the op's result; rejects with { code, message }
 *   phoneStorage.hello()              the bridge state ({ version, enabled, access, locked, roots, baseUrl, features });
 *                                     cached until a 'config' event, never persisted (baseUrl holds a per-launch token)
 *   phoneStorage.fileUrl(root, path, { thumb, download })   the app's local URL for a file
 *   phoneStorage.on(event, fn)        'config' | 'changed' | 'state' (hello re-read); returns an off()
 *   phoneStorage.write(root, dir, file, { name, conflict, mtime, signal, onProgress })
 *                                     a Blob/File into a phone folder: writeBegin, binary chunks
 *                                     (at most 4 unacknowledged), writeEnd; writeAbort on cancel / error
 *   phoneStorage.watch(root, path) / unwatch(root, path)   reference counted, ≤32 folders on the phone
 */
(function (root) {
    'use strict';

    const bridge = root.AndroidPhoneStorage || null;
    const MAX_IN_FLIGHT = 4;
    const MAX_WATCHES = 32;

    let seq = 0;
    const pending = new Map();
    const listeners = new Map();
    const uploads = new Map();      // upload id -> { onChunk(seq, ok, written) }
    let helloPromise = null;
    let state = null;

    function emit(event, data) {
        (listeners.get(event) || []).slice().forEach((fn) => {
            try { fn(data); } catch (err) { console.warn('[phoneStorage] listener failed:', err); }
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

    function onEvent(m) {
        if (m.event === 'chunk') {
            const up = uploads.get(m.upload);
            if (up) up.onChunk(m.seq, m.ok !== false, m.written);
            return;
        }
        if (m.event === 'config') {
            // sharing, access or the roots changed: read hello again, then tell the drive
            helloPromise = null;
            hello().then(() => emit('config', state), () => emit('config', state));
            return;
        }
        if (m.event) emit(m.event, m);
    }

    if (bridge) {
        bridge.onmessage = (e) => {
            let m = null;
            try { m = JSON.parse(typeof e === 'string' ? e : e.data); } catch (_err) { return; }
            if (!m) return;
            if (m.id != null && pending.has(m.id)) {
                const done = pending.get(m.id);
                pending.delete(m.id);
                done(m);
            } else {
                onEvent(m);
            }
        };
    }

    function error(code, message) {
        return { code: code || 'io', message: message || code || 'Phone storage error' };
    }

    function call(op, args = {}) {
        if (!bridge) return Promise.reject(error('disabled', 'Phone storage is only available in the Android app'));
        return new Promise((ok, fail) => {
            const id = ++seq;
            pending.set(id, (m) => (m.ok ? ok(m.result) : fail(m.error && m.error.code ? m.error : error('io', m.error && m.error.message))));
            try {
                bridge.postMessage(JSON.stringify({ id, op, args }));
            } catch (err) {
                pending.delete(id);
                fail(error('io', err && err.message));
            }
        });
    }

    function hello() {
        if (!helloPromise) {
            helloPromise = call('hello').then((result) => {
                state = result || null;
                emit('state', state);
                return state;
            }, (err) => {
                helloPromise = null;
                throw err;
            });
        }
        return helloPromise;
    }

    /** /DCIM/Camera/a.jpg -> DCIM/Camera/a.jpg, each segment encoded. */
    function encodePath(path) {
        return String(path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
    }

    function fileUrl(rootId, path, opts = {}) {
        if (!state || !state.baseUrl) return '';
        let url = `${state.baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(rootId)}/${encodePath(path)}`;
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

    // ---- watches: the phone keeps ≤32; several Explorer windows can show one folder ----
    const watches = new Map(); // "root\npath" -> count

    function watch(rootId, path) {
        const key = `${rootId}\n${path}`;
        const n = watches.get(key) || 0;
        watches.set(key, n + 1);
        if (n === 0) {
            if (watches.size > MAX_WATCHES) return Promise.resolve(false);
            return call('watch', { root: rootId, path }).then(() => true, () => false);
        }
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

    // ---- writing a Blob into a phone folder ----

    /** One binary chunk: bytes 0-3 upload id, 4-7 seq (big-endian int32), then the data. */
    function binaryChunk(upload, chunkSeq, bytes) {
        const buf = new ArrayBuffer(8 + bytes.byteLength);
        const view = new DataView(buf);
        view.setInt32(0, upload, false);
        view.setInt32(4, chunkSeq, false);
        new Uint8Array(buf, 8).set(new Uint8Array(bytes));
        return buf;
    }

    function base64(bytes) {
        const u8 = new Uint8Array(bytes);
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
    }

    /**
     * file: Blob/File. opts: { name, conflict: fail|replace|rename, mtime (ms), signal (AbortSignal),
     * onProgress(bytesWritten, total) }. Resolves with the written entry.
     */
    async function write(rootId, dir, file, opts = {}) {
        const st = await hello();
        const name = opts.name || file.name;
        const total = file.size;
        const mtime = opts.mtime != null ? opts.mtime : (file.lastModified || undefined);
        const begun = await call('writeBegin', { root: rootId, dir, name, size: total, conflict: opts.conflict || 'fail', mtime });
        const upload = begun.upload;
        const chunkSize = Math.max(16 * 1024, begun.chunkSize || (st.features && st.features.chunkSize) || 256 * 1024);
        const binary = !!(st.features && st.features.binaryWrite) && typeof bridge.postMessage === 'function';
        const signal = opts.signal || null;
        const chunks = Math.ceil(total / chunkSize);
        let sent = 0;
        let acked = 0;
        let written = 0;
        let failed = null;
        let wake = null;
        const nudge = () => { if (wake) { const w = wake; wake = null; w(); } };
        const ack = (ok, bytes) => {
            if (!ok) failed = failed || error('io', 'The phone could not write a part of the file');
            acked += 1;
            if (typeof bytes === 'number') written = Math.max(written, bytes);
            if (opts.onProgress) opts.onProgress(Math.min(total, written || acked * chunkSize), total);
            nudge();
        };
        // binary chunks are acknowledged by 'chunk' events; a writeChunk call by its own reply
        uploads.set(upload, {
            onChunk(_seq, ok, bytes) {
                if (!binary) return;
                ack(ok, bytes);
            }
        });
        const onAbort = () => nudge();
        if (signal) signal.addEventListener('abort', onAbort);
        try {
            while (acked < chunks) {
                if (signal && signal.aborted) throw error('aborted', 'Cancelled');
                if (failed) throw failed;
                if (sent < chunks && sent - acked < MAX_IN_FLIGHT) {
                    const start = sent * chunkSize;
                    const bytes = await file.slice(start, Math.min(total, start + chunkSize)).arrayBuffer();
                    if (binary) {
                        bridge.postMessage(binaryChunk(upload, sent, bytes));
                    } else {
                        const reply = await call('writeChunk', { upload, seq: sent, data: base64(bytes) });
                        ack(true, reply && typeof reply.written === 'number' ? reply.written : (sent + 1) * chunkSize);
                    }
                    sent += 1;
                    continue;
                }
                await new Promise((resolve) => { wake = resolve; });
            }
            if (failed) throw failed;
            const entry = await call('writeEnd', { upload });
            if (opts.onProgress) opts.onProgress(total, total);
            return entry;
        } catch (err) {
            call('writeAbort', { upload }).catch(() => {});
            throw err;
        } finally {
            uploads.delete(upload);
            if (signal) signal.removeEventListener('abort', onAbort);
        }
    }

    const api = {
        available: !!bridge,
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
        binaryChunk
    };
    root.phoneStorage = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
