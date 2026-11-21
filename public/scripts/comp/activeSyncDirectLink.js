/**
 * ActiveSync direct link, the computer's side (Yozora #1006, docs/activesync-direct-link.md): a WebRTC data channel to a
 * phone on the same LAN, so its files move across the LAN instead of through the server. The server introduces the two
 * (as_link_offer: a token for the phone, the phone's key for us); DTLS encrypts it; host candidates only, so it never
 * leaves the LAN. Everything falls back to the server path when there is no link.
 *
 *   activeSyncDirectLink.live(deviceId)            the open link, or null
 *   activeSyncDirectLink.ensure(deviceId)          opens one when the phone can take it (background; never throws)
 *   link.call(op, args) / link.get(params) / link.put(meta, blob, opts)
 *
 * The service worker answers /api/activesync/file/<device>/... from a live link (sw.js aslink-get): every thumbnail,
 * picture, video (Range) and download a page shows comes over the LAN with no caller changed.
 * Desktop tabs only (activeSync.kind === 'computer'); the phone's side runs in the app's service, never in a page.
 */
(function (root) {
    'use strict';

    const as = root.activeSync;
    if (!as || as.kind !== 'computer' || root.activeSyncDirectLink || typeof root.RTCPeerConnection !== 'function') return;

    const FRAME = 64 * 1024;            // data message size (4-byte stream id + payload)
    const HIGH_WATER = 1024 * 1024;     // pause sending above this much buffered
    const LOW_WATER = 256 * 1024;
    const IDLE_CLOSE_MS = 10 * 60 * 1000;
    const PING_AFTER_MS = 60 * 1000;
    const GATHER_MS = 2000;
    const OPEN_MS = 8000;
    const BACKOFF_MS = [2000, 10000, 60000];
    const MAX_GETS = 8;
    const LAN_TYPES = new Set(['wifi', 'ethernet', 'usb']);

    const links = new Map();    // deviceId -> Link (open or opening)
    const failures = new Map(); // deviceId -> { step, until, netKey }

    const enc = new TextEncoder();
    const sdpFingerprint = (sdp) => {
        const m = /^a=fingerprint:sha-256 ([0-9A-Fa-f:]{95})\s*$/m.exec(String(sdp || ''));
        return m ? m[1].toUpperCase() : null;
    };
    const b64ToBytes = (b64) => Uint8Array.from(atob(String(b64).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

    /** An ECDSA DER signature as WebCrypto's raw r||s (32 + 32 bytes). */
    function derToRaw(der) {
        let i = 2;
        if (der[1] & 0x80) i += der[1] & 0x7f;
        const read = () => {
            if (der[i] !== 0x02) throw new Error('bad signature');
            const len = der[i + 1];
            let v = der.subarray(i + 2, i + 2 + len);
            i += 2 + len;
            while (v.length > 32 && v[0] === 0) v = v.subarray(1);
            const out = new Uint8Array(32);
            out.set(v, 32 - v.length);
            return out;
        };
        const r = read();
        const s = read();
        const raw = new Uint8Array(64);
        raw.set(r, 0);
        raw.set(s, 32);
        return raw;
    }

    function deviceOf(deviceId) {
        const st = typeof as.state === 'function' ? (as.state() || {}) : {};
        return (st.devices || []).find((d) => d.deviceId === deviceId) || null;
    }

    const isPrivate4 = (a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
    const netKey = (net) => JSON.stringify(((net && net.interfaces) || []).map((i) => [i.name, (i.v4 || []).map((a) => a.addr), (i.v6 || []).map((a) => a.addr)]));

    /** The phone takes links and has a LAN address (section 2). */
    function eligible(dev) {
        if (!dev || !dev.online || !(dev.permissions || []).includes('files')) return false;
        const net = dev.status && dev.status.net;
        if (!net || !net.link || !net.link.ready) return false;
        return (net.interfaces || []).some((i) => i.up && LAN_TYPES.has(i.type)
            && ((i.v4 || []).some((a) => isPrivate4(a.addr)) || (i.v6 || []).length > 0));
    }

    function backedOff(deviceId, dev) {
        const f = failures.get(deviceId);
        if (!f) return false;
        // a change of the phone's networks starts over
        if (f.netKey !== netKey(dev && dev.status && dev.status.net)) { failures.delete(deviceId); return false; }
        return f.until === Infinity || Date.now() < f.until;
    }

    function noteFailure(deviceId, dev) {
        const f = failures.get(deviceId) || { step: 0 };
        f.netKey = netKey(dev && dev.status && dev.status.net);
        f.until = f.step < BACKOFF_MS.length ? Date.now() + BACKOFF_MS[f.step] : Infinity;
        f.step += 1;
        failures.set(deviceId, f);
    }

    // ---------------------------------------------------------------- a link

    class Link {
        constructor(deviceId) {
            this.deviceId = deviceId;
            this.pc = null;
            this.dc = null;
            this.open = false;
            this.closed = false;
            this.ops = new Set();
            this.features = {};
            this.next = 1;              // odd stream ids from the computer
            this.pending = new Map();   // id -> { resolve, reject, kind, ... }
            this.gets = 0;
            this.getQueue = [];
            this.last = Date.now();
            this.timer = 0;
            this.waiters = [];
        }

        async start() {
            const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
            this.pc = pc;
            const dc = pc.createDataChannel('aslink', { ordered: true });
            dc.binaryType = 'arraybuffer';
            dc.bufferedAmountLowThreshold = LOW_WATER;
            this.dc = dc;
            dc.onmessage = (e) => this.onMessage(e.data);
            dc.onbufferedamountlow = () => { const w = this.waiters.splice(0); w.forEach((fn) => fn()); };
            dc.onclose = () => this.close('closed');
            pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this.close(pc.connectionState); };
            await pc.setLocalDescription(await pc.createOffer());
            await new Promise((resolve) => {
                if (pc.iceGatheringState === 'complete') { resolve(); return; }
                const t = setTimeout(resolve, GATHER_MS);
                pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } });
            });
            const sdp = pc.localDescription.sdp;
            const mine = sdpFingerprint(sdp);
            const ws = root.wsClient;
            if (!ws || typeof ws.sendMessage !== 'function') throw new Error('offline');
            const res = await ws.sendMessage('as_link_offer', { deviceId: this.deviceId, sdp }, false);
            if (!res || !res.success) throw Object.assign(new Error((res && res.error) || 'The phone did not take the link'), { code: res && res.code });
            // the phone proves itself: its certificate key (vouched for by the server) signed both fingerprints
            const theirs = sdpFingerprint(res.sdp);
            if (!mine || !theirs) throw new Error('No fingerprint');
            const key = await crypto.subtle.importKey('spki', b64ToBytes(res.phoneKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
            const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(b64ToBytes(res.sig)),
                enc.encode(`aslink-v1\n${res.nonce}\n${mine}\n${theirs}`));
            if (!ok) throw Object.assign(new Error('The phone could not prove itself'), { code: 'BAD_PROOF' });
            await pc.setRemoteDescription({ type: 'answer', sdp: res.sdp });
            await new Promise((resolve, reject) => {
                if (dc.readyState === 'open') { resolve(); return; }
                const t = setTimeout(() => reject(new Error('The link did not open')), OPEN_MS);
                dc.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
                dc.addEventListener('close', () => { clearTimeout(t); reject(new Error('The link closed')); }, { once: true });
            });
            // hello, hello
            const hello = new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('The phone did not say hello')), 4000);
                this.pending.set('hello', { resolve: (m) => { clearTimeout(t); resolve(m); }, reject });
            });
            this.sendJson({ t: 'hello', v: 1, name: (typeof as.state === 'function' && as.state() && as.state().name) || 'Melaton' });
            const h = await hello;
            this.ops = new Set(Array.isArray(h.ops) ? h.ops : []);
            this.features = h.features || {};
            this.open = true;
            this.touch();
            return this;
        }

        touch() {
            this.last = Date.now();
            if (this.timer) return;
            const tick = () => {
                this.timer = 0;
                if (this.closed) return;
                const idle = Date.now() - this.last;
                if (idle >= IDLE_CLOSE_MS && !this.pending.size) { this.close('idle'); return; }
                if (idle >= PING_AFTER_MS) this.sendJson({ t: 'ping' });
                this.timer = setTimeout(tick, PING_AFTER_MS);
            };
            this.timer = setTimeout(tick, PING_AFTER_MS);
        }

        sendJson(o) {
            if (!this.dc || this.dc.readyState !== 'open') throw new Error('The link is closed');
            this.dc.send(JSON.stringify(o));
        }

        async drain() {
            if (this.dc.bufferedAmount <= HIGH_WATER) return;
            await new Promise((resolve) => this.waiters.push(resolve));
        }

        onMessage(data) {
            this.touch();
            if (typeof data !== 'string') {
                const view = new DataView(data);
                const id = view.getUint32(0);
                const p = this.pending.get(id);
                if (p && p.controller) p.controller.enqueue(new Uint8Array(data, 4));
                return;
            }
            let m = null;
            try { m = JSON.parse(data); } catch (_) { return; }
            if (!m || !m.t) return;
            if (m.t === 'hello') { const h = this.pending.get('hello'); this.pending.delete('hello'); if (h) h.resolve(m); return; }
            if (m.t === 'ping') { try { this.sendJson({ t: 'pong' }); } catch (_) { /* closing */ } return; }
            const p = this.pending.get(m.id);
            if (!p) return;
            if (m.t === 'error') {
                this.pending.delete(m.id);
                const err = Object.assign(new Error(m.message || m.code || 'Phone error'), { code: m.code || 'io' });
                if (p.controller) { try { p.controller.error(err); } catch (_) { /* done */ } this.doneGet(); }
                p.reject(err);
            } else if (m.t === 'result') {
                this.pending.delete(m.id);
                p.resolve(m.result);
            } else if (m.t === 'head') {
                p.resolve(m);
            } else if (m.t === 'end') {
                this.pending.delete(m.id);
                if (p.controller) { try { p.controller.close(); } catch (_) { /* cancelled */ } }
                this.doneGet();
            } else if (m.t === 'ready') {
                if (p.ready) p.ready(m);
            } else if (m.t === 'ack') {
                // a put's credit: the phone wrote this much (it cannot slow a data channel otherwise)
                p.acked = Math.max(p.acked || 0, Number(m.bytes) || 0);
                const w = p.ackWaiters || [];
                p.ackWaiters = [];
                w.forEach((fn) => fn());
            }
        }

        call(op, args) {
            const id = this.next; this.next += 2;
            return new Promise((resolve, reject) => {
                this.pending.set(id, { resolve, reject });
                try { this.sendJson({ t: 'call', id, op, args: args || {} }); } catch (err) { this.pending.delete(id); reject(err); }
            });
        }

        /** A file body: { head, body } where body is a ReadableStream of its bytes. */
        get(params) {
            return new Promise((resolve, reject) => {
                const run = () => {
                    this.gets += 1;
                    const id = this.next; this.next += 2;
                    let controller = null;
                    const body = new ReadableStream({
                        start: (c) => { controller = c; },
                        cancel: () => {
                            if (this.pending.has(id)) { this.pending.delete(id); this.doneGet(); try { this.sendJson({ t: 'cancel', id }); } catch (_) { /* closed */ } }
                        }
                    });
                    this.pending.set(id, { resolve: (head) => resolve({ head, body }), reject, controller });
                    try { this.sendJson(Object.assign({ t: 'get', id }, params)); } catch (err) { this.pending.delete(id); this.doneGet(); reject(err); }
                };
                if (this.gets < MAX_GETS) run(); else this.getQueue.push(run);
            });
        }

        doneGet() {
            this.gets = Math.max(0, this.gets - 1);
            const next = this.getQueue.shift();
            if (next) next();
        }

        /** A Blob into a phone folder: meta { root, dir, name, conflict, mtime, mkdirs }; opts { signal, onProgress }. */
        async put(meta, blob, opts = {}) {
            const id = this.next; this.next += 2;
            const signal = opts.signal || null;
            let readyFn = null;
            const ready = new Promise((r) => { readyFn = r; });
            const entry = { resolve: null, reject: null, ready: readyFn, acked: 0, ackWaiters: [] };
            const result = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; this.pending.set(id, entry); });
            result.catch(() => {});
            this.sendJson(Object.assign({ t: 'put', id, size: blob.size }, meta));
            const go = await Promise.race([ready, result]);
            // the phone's credit window: no more than this unacknowledged (its ready says how much; 4 MiB)
            const windowBytes = Math.max(FRAME, Number(go && go.window) || 4 * 1024 * 1024);
            const header = new ArrayBuffer(4);
            new DataView(header).setUint32(0, id);
            let offset = 0;
            const step = FRAME - 4;
            while (offset < blob.size) {
                if (signal && signal.aborted) { try { this.sendJson({ t: 'cancel', id }); } catch (_) { /* closed */ } this.pending.delete(id); throw Object.assign(new Error('Cancelled'), { code: 'aborted' }); }
                if (this.closed) throw Object.assign(new Error('The link closed'), { code: 'closed' });
                while (offset - entry.acked >= windowBytes && !this.closed && this.pending.has(id)) {
                    await new Promise((r) => entry.ackWaiters.push(r));
                }
                if (!this.pending.has(id)) return result;
                const part = new Uint8Array(await blob.slice(offset, offset + step).arrayBuffer());
                const frame = new Uint8Array(4 + part.length);
                frame.set(new Uint8Array(header), 0);
                frame.set(part, 4);
                await this.drain();
                this.dc.send(frame);
                offset += part.length;
                this.touch();
                if (opts.onProgress) opts.onProgress(offset, blob.size);
            }
            this.sendJson({ t: 'putEnd', id });
            return result;
        }

        close(why) {
            if (this.closed) return;
            this.closed = true;
            this.open = false;
            clearTimeout(this.timer);
            const err = Object.assign(new Error('The link closed'), { code: 'closed' });
            for (const p of this.pending.values()) {
                if (p.ackWaiters) p.ackWaiters.splice(0).forEach((fn) => fn());
                if (p.controller) { try { p.controller.error(err); } catch (_) { /* done */ } }
                try { p.reject(err); } catch (_) { /* done */ }
            }
            this.pending.clear();
            this.getQueue = [];
            this.waiters.splice(0).forEach((fn) => fn());
            try { if (this.dc) this.dc.close(); } catch (_) { /* gone */ }
            try { if (this.pc) this.pc.close(); } catch (_) { /* gone */ }
            if (links.get(this.deviceId) === this) links.delete(this.deviceId);
            tellWorker();
            if (why && why !== 'idle' && why !== 'gone') console.info(`[aslink] ${this.deviceId}: closed (${why})`);
        }
    }

    // ---------------------------------------------------------------- the links

    function live(deviceId) {
        const l = links.get(deviceId);
        return l && l.open && !l.closed ? l : null;
    }

    /** Open a link to the phone if it can take one; resolves the link or null (never rejects). */
    function ensure(deviceId) {
        const have = links.get(deviceId);
        if (have) return have.open ? Promise.resolve(have) : have.starting;
        const dev = deviceOf(deviceId);
        if (!eligible(dev) || backedOff(deviceId, dev)) return Promise.resolve(null);
        const link = new Link(deviceId);
        links.set(deviceId, link);
        link.starting = link.start().then(() => {
            failures.delete(deviceId);
            tellWorker();
            console.info(`[aslink] ${deviceId}: direct link open`);
            return link;
        }, (err) => {
            link.close('failed');
            noteFailure(deviceId, dev);
            console.info(`[aslink] ${deviceId}: no direct link (${(err && (err.code || err.message)) || err})`);
            return null;
        });
        return link.starting;
    }

    // the device left, its networks changed or it no longer shares files: its link goes
    let lastNet = new Map();
    function onState() {
        const st = typeof as.state === 'function' ? (as.state() || {}) : {};
        const devices = new Map((st.devices || []).map((d) => [d.deviceId, d]));
        for (const [id, link] of links) {
            const d = devices.get(id);
            if (!d || !d.online || !(d.permissions || []).includes('files')) { link.close('gone'); continue; }
            const k = netKey(d.status && d.status.net);
            if (lastNet.has(id) && lastNet.get(id) !== k) link.close('network changed');
        }
        lastNet = new Map([...devices].map(([id, d]) => [id, netKey(d.status && d.status.net)]));
    }
    if (typeof as.on === 'function') as.on('state', onState);

    // ---------------------------------------------------------------- the service worker's file requests

    function liveIds() {
        return [...links.values()].filter((l) => l.open && !l.closed).map((l) => l.deviceId);
    }

    function tellWorker() {
        const sw = root.navigator && root.navigator.serviceWorker;
        const c = sw && sw.controller;
        if (c) { try { c.postMessage({ type: 'aslink-live', devices: liveIds() }); } catch (_) { /* no worker */ } }
    }

    /** /api/activesync/file/<device>/<root>/<path>[?thumb=N][&download=1] -> get params, or null. */
    function parseFileUrl(href) {
        let u = null;
        try { u = new URL(href, root.location.href); } catch (_) { return null; }
        const m = /^\/api\/activesync\/file\/([0-9a-f]{16,32})\/([^/]+)(\/.*)?$/.exec(u.pathname);
        if (!m) return null;
        const path = (m[3] || '/').split('/').map((s) => { try { return decodeURIComponent(s); } catch (_) { return s; } }).join('/') || '/';
        const rootId = decodeURIComponent(m[2]);
        const thumb = Number(u.searchParams.get('thumb')) || 0;
        // on the LAN the server's caps are gone (Yukimi, Nov 21 2026): thumbnails up to the phone's limit, a full-size
        // JPEG of a picture the browser cannot decode (?jpeg=1)
        const link = links.get(m[1]);
        const thumbMax = (link && link.features && Number(link.features.thumbMax)) || 2048;
        const jpeg = u.searchParams.get('jpeg') === '1';
        return {
            deviceId: m[1],
            params: Object.assign({ root: rootId, path }, rootId === 'media' ? { media: true } : {},
                thumb ? { thumb: Math.max(32, Math.min(thumbMax, thumb)) } : {}, jpeg && !thumb ? { jpeg: true } : {}),
            download: u.searchParams.get('download') === '1',
            name: path.split('/').pop()
        };
    }

    async function answerWorker(data, port) {
        const want = parseFileUrl(data.url);
        const link = want && live(want.deviceId);
        if (!link) { port.postMessage({ ok: false }); return; }
        // taken: the worker waits for the phone now (a thumbnail can take it a moment to make)
        port.postMessage({ ack: true });
        try {
            const params = Object.assign({}, want.params);
            if (data.range && !params.thumb && !params.jpeg) params.range = data.range;
            const { head, body } = await link.get(params);
            const headers = { 'Content-Type': head.type || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-ActiveSync-Link': 'direct' };
            if (head.length != null) headers['Content-Length'] = String(head.length);
            if (head.range) headers['Content-Range'] = head.range;
            if (head.mtime) headers['Last-Modified'] = new Date(Number(head.mtime)).toUTCString();
            if (want.download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(want.name)}`;
            port.postMessage({ ok: true, status: Number(head.status) || 200, headers, body }, [body]);
        } catch (err) {
            port.postMessage({ ok: false, error: (err && err.code) || 'io' });
        }
    }

    const swc = root.navigator && root.navigator.serviceWorker;
    if (swc) {
        swc.addEventListener('message', (e) => {
            const d = e.data;
            if (!d || typeof d !== 'object') return;
            if (d.type === 'aslink-get' && e.ports && e.ports[0]) void answerWorker(d, e.ports[0]);
            else if (d.type === 'aslink-query') tellWorker();
        });
        swc.addEventListener('controllerchange', tellWorker);
    }

    /**
     * What a live link lifts (Yukimi, Nov 21 2026: "when locally connectable override the limit on files and image sizes"):
     * { thumbMax, jpeg } for URL builders, or null with no link (the server's caps then: 1024 px, no JPEG).
     */
    function limits(deviceId) {
        const l = live(deviceId);
        if (!l) return null;
        const f = l.features || {};
        return { thumbMax: Number(f.thumbMax) || 2048, jpeg: f.jpeg !== false };
    }

    root.activeSyncDirectLink = { live, ensure, limits, eligible: (id) => eligible(deviceOf(id)), liveIds, _parseFileUrl: parseFileUrl };
})(typeof window !== 'undefined' ? window : globalThis);
