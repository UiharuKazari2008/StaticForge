/**
 * Rack Manager, part 7: Android devices you can see and touch, and work that runs outside Rack Manager.
 *  - "Device Connection": one window per device (like Hyper-V's Virtual Machine Connection). H.264 from scrcpy (rackd lib/scrcpy.js) comes over
 *    WS /rack/<server>/android/<name>/screen and is decoded with WebCodecs onto a canvas; pointer, wheel and keys become touch, scroll and key
 *    messages. The socket is open only while the window is open and not minimised. A lane instance someone holds opens view only; Control
 *    asks for the input channel (an administrator in this console may). Never any sound: the stream carries no audio.
 *  - "Screens": a grid of every running emulator's picture on the Virtual Android Devices page. rackd screencaps every 5 s only while this
 *    page shows it (thumbs on / off) and pushes a `thumb` event per picture: the picture is a file with an address (never a data: string).
 *  - "Running outside Rack Manager": the warning section of the server summary (processes rackd found that nothing there started or explains).
 * Part of window.mmcRack (mmcRackManager.js).
 */
(function (root) {
    'use strict';

    const R = root.mmcRack;
    if (!R) return;
    const { esc, VI } = R;
    const doc = root.document;
    const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const TH = new Map();            // 'server:name' -> { file, at, error }
    const SC = { server: null, at: 0 };     // the server whose thumbnails are switched on
    const KEYS = { Enter: 'ENTER', Backspace: 'DEL', Delete: 'FORWARD_DEL', Tab: 'TAB', Escape: 'BACK', ArrowUp: 'DPAD_UP', ArrowDown: 'DPAD_DOWN', ArrowLeft: 'DPAD_LEFT', ArrowRight: 'DPAD_RIGHT', Home: 'MOVE_HOME', End: 'MOVE_END', PageUp: 'PAGE_UP', PageDown: 'PAGE_DOWN' };

    const avdsOf = (n) => arr(R.dataOf(n, 'android').avds);
    const thumbUrl = (server, file) => R.shotUrl(server, file);
    const BOOT = { booting: 'Starting', ready: 'Ready' };

    // ---- the Screens grid ---------------------------------------------------------------------------------------------

    R.screensGrid = (c, n, d) => {
        const run = arr(d.avds).filter((a) => a.running);
        if (!run.length) return '<p class="mmc-hint">No emulator is running. Start one to see its screen here.</p>';
        return `<div class="rm-screens">${run.map((a) => {
            const t = TH.get(`${n.server}:${a.name}`);
            const bad = a.manageable === false;
            const holder = a.lane && a.lane.holder ? `held by ${esc(a.lane.holder)}` : a.lane ? 'free' : '';
            const img = t && t.file ? `<img src="${esc(thumbUrl(n.server, t.file))}" alt="Screen of ${esc(a.name)}">` : `<span class="rm-screen-wait">${t && t.error ? esc(t.error) : 'Waiting for the first picture...'}</span>`;
            return `<div class="rm-screen${bad ? ' is-warn' : ''}" data-dev="${esc(a.name)}" tabindex="0" title="Double-click to open Device Connection">`
                + `<div class="rm-screen-img" data-thumb="${esc(a.name)}">${img}</div>`
                + `<div class="rm-screen-cap"><b>${esc(a.name)}</b><span>${esc(BOOT[a.boot] || a.boot)}${holder ? ` - ${holder}` : ''}</span>`
                + (bad ? `<span class="rm-screen-bad"><img src="${VI}/warning-16.png" alt=""> Not manageable: ${esc(arr(a.missing).join('; '))}</span>` : '') + '</div></div>';
        }).join('')}</div><p class="mmc-hint">Pictures are taken every 5 seconds while this page is open. Double-click one to open its Device Connection.</p>`;
    };

    function screens(c, server, on) {
        if (!on && SC.server !== server) return;
        if (on && SC.server === server && Date.now() - SC.at < 5 * 60e3) return;   // renewed every 5 minutes (rackd lets a silent viewer lapse after 15)
        SC.at = Date.now();
        if (SC.server && SC.server !== server) R.act(SC.server, 'android', 'thumbs', { on: false }).catch(() => {});
        SC.server = on ? server : null;
        R.act(server, 'android', 'thumbs', { on }).catch(() => { if (on) SC.server = null; });
    }
    R.hooks.ensure.push((c, n) => {
        if (n.kind === 'role' && n.role === 'android') { if (avdsOf(n).some((a) => a.running)) screens(c, n.server, true); else screens(c, n.server, false); }
    });
    R.hooks.leave.push((c, from) => { if (from.kind === 'role' && from.role === 'android' && from.server) screens(c, from.server, false); });
    R.hooks.close.push(() => { if (SC.server) screens(null, SC.server, false); });
    R.hooks.open.push((c) => {
        c.modal.addEventListener('dblclick', (ev) => {
            const t = ev.target.closest && ev.target.closest('[data-dev]');
            const n = R.here ? R.here(c) : null;
            if (t && n && n.server) openDevice(c, n.server, t.dataset.dev);
        });
    });
    // a pushed picture replaces the one in its tile in place (the page is not painted again: scroll and selection stay)
    R.hooks.event.push((c, ev) => {
        if (ev.role === 'rackd' && ev.kind === 'state') SC.at = 0;   // rackd restarted: ask for the pictures again at the next paint
        if (ev.role !== 'android' || ev.kind !== 'thumb' || !ev.data) return false;
        const d = ev.data;
        TH.set(`${ev.server}:${d.name}`, { file: d.file || (TH.get(`${ev.server}:${d.name}`) || {}).file, at: d.at, error: d.error });
        const box = c.modal.querySelector(`[data-thumb="${CSS.escape(d.name)}"]`);
        if (!box) return false;
        if (d.file) {
            let im = box.querySelector('img');
            if (!im) { box.innerHTML = '<img alt="">'; im = box.querySelector('img'); }
            im.src = thumbUrl(ev.server, d.file); im.alt = `Screen of ${d.name}`;
        } else if (!box.querySelector('img')) box.innerHTML = `<span class="rm-screen-wait">${esc(d.error || '')}</span>`;
        return true;
    });
    R.actions['av-connect'] = (c, p, n) => { const a = avdsOf(n).find((x) => x.name === c.sel); if (a && a.running) openDevice(c, n.server, a.name); };

    // ---- Device Connection ----------------------------------------------------------------------------------------

    function avcCodec(u8) {   // 'avc1.PPCCLL' from the first SPS NAL (type 7) of an Annex B access unit
        for (let i = 0; i + 6 < u8.length; i++) {
            if (u8[i] === 0 && u8[i + 1] === 0 && (u8[i + 2] === 1 || (u8[i + 2] === 0 && u8[i + 3] === 1))) {
                const s = i + (u8[i + 2] === 1 ? 3 : 4);
                if ((u8[s] & 31) === 7) return `avc1.${[u8[s + 1], u8[s + 2], u8[s + 3]].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
            }
        }
        return null;
    }

    function openDevice(c, server, name) {
        const a = avdsOf({ server, ss: R.ss(server) }).find((x) => x.name === name) || {};
        const lane = !!a.lane;
        const holder = a.lane && a.lane.holder ? a.lane.holder : null;
        const fold = /fold/i.test(name);
        const w = fold ? 760 : 420;
        const h = Math.min(fold ? 640 : 800, Math.max(420, root.innerHeight - 70));
        const id = `devconn_${name.replace(/\W/g, '_')}`;
        const btn = (k, t, title) => `<button type="button" class="btn-standard rm-dev-btn" data-k="${k}" title="${esc(title || t)}">${esc(t)}</button>`;
        const ctx = R.dialog(c, {
            id, title: `${name} - Device Connection`, w, h, okText: 'Close', noCancel: true, modeless: true,
            html: `<div class="rm-dev"><div class="rm-kvm-bar">${btn('back', 'Back')}${btn('home', 'Home')}${btn('recents', 'Recents')}${btn('power', 'Power')}${btn('vdown', 'Vol -')}${btn('vup', 'Vol +')}${btn('rotate', 'Rotate')}${btn('notif', 'Notifications')}${btn('shot', 'Screenshot')}</div>`
                + `<div class="rm-kvm-status"><img class="rm-lt" data-k="cdot" src="${R.lightSrc('wait')}" alt=""><span data-k="ctxt">connecting</span><label class="rm-check rm-grow"><input type="checkbox" data-k="ctl"${lane ? '' : ' checked'}> Control${lane ? ` (instance of the test lane${holder ? `, held by ${esc(holder)}` : ''})` : ''}</label></div>`
                + `<div class="rm-kvm-screen"><canvas class="rm-kvm-cv" data-k="cv" width="270" height="600" tabindex="0"></canvas><div class="rm-kvm-msg" data-k="msg">Connecting...</div></div><div class="rm-dev-foot" data-k="foot"></div></div>`,
            init: (cx) => wire(cx, c, server, name, lane)
        });
        return ctx;
    }

    function wire(cx, c, server, name, lane) {
        const root0 = cx.content;
        const $ = (k) => root0.querySelector(`[data-k="${k}"]`);
        const modal = root0.closest('.modal');
        const cv = $('cv'), g = cv.getContext('2d');
        let sock = null, dec = null, codec = '', needKey = true, retry = null, tries = 0, closed = false, pend = null, raf = 0, ctl = $('ctl').checked, last = 0;
        const conn = (st, t) => { $('cdot').src = R.lightSrc(st); $('ctxt').textContent = t; };
        const msg = (t) => { $('msg').textContent = t || ''; };
        const setCtl = () => { root0.querySelectorAll('.rm-dev-btn').forEach((b) => { b.disabled = b.dataset.k === 'shot' ? false : !ctl; }); cv.style.cursor = ctl ? 'pointer' : 'default'; };
        setCtl();
        const send = (o) => { if (sock && sock.readyState === 1 && ctl) sock.send(JSON.stringify(o)); };
        const paint = () => { raf = 0; const f = pend; pend = null; if (!f) return; if (cv.width !== f.displayWidth || cv.height !== f.displayHeight) { cv.width = f.displayWidth; cv.height = f.displayHeight; } g.drawImage(f, 0, 0); f.close(); $('foot').textContent = `${cv.width} x ${cv.height}${ctl ? '' : ' - view only'}`; };
        const startDecoder = (cc) => {
            if (dec && dec.state !== 'closed') { try { dec.close(); } catch (_) { /* closed */ } }
            codec = cc; needKey = true;
            dec = new root.VideoDecoder({ output: (f) => { if (pend) pend.close(); pend = f; if (!raf) raf = root.requestAnimationFrame(paint); }, error: () => { needKey = true; codec = ''; } });
            dec.configure({ codec: cc, optimizeForLatency: true, avc: { format: 'annexb' } });
        };
        function onFrame(buf) {
            const d = new DataView(buf); const flags = d.getUint8(0), pts = d.getFloat64(1);
            const data = new Uint8Array(buf, 9);
            const key = !!(flags & 2);
            if (key) { const cc = avcCodec(data); if (cc && cc !== codec) startDecoder(cc); }
            if (!dec || dec.state !== 'configured' || (needKey && !key)) return;
            needKey = false;
            if (dec.decodeQueueSize > 8 && !key) return;
            try { dec.decode(new root.EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: pts, data })); } catch (_) { needKey = true; }
        }
        function connect() {
            clearTimeout(retry);
            if (sock) { sock.onclose = null; sock.close(); sock = null; }
            if (closed) return;
            if (!root.VideoDecoder) { conn('bad', 'unsupported'); msg('This browser has no WebCodecs video decoder.'); return; }
            const q = new URLSearchParams({ maxSize: '1280' }); if (ctl) q.set('control', '1');
            sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/rack/${encodeURIComponent(server)}/android/${encodeURIComponent(name)}/screen?${q}`);
            sock.binaryType = 'arraybuffer';
            conn('wait', 'connecting'); msg('Connecting...');
            sock.onmessage = (e) => {
                tries = 0;
                if (typeof e.data !== 'string') { msg(''); conn('on', ctl ? 'connected (control)' : 'connected (view only)'); return onFrame(e.data); }
                let o; try { o = JSON.parse(e.data); } catch (_) { return; }
                if (o.t === 'meta') { cv.width = o.w || cv.width; cv.height = o.h || cv.height; msg('Waiting for video...'); }
                if (o.t === 'error') { conn('bad', 'error'); msg(o.error || 'The device did not answer.'); }
            };
            sock.onclose = () => { conn('off', 'disconnected'); if (!closed && !hidden()) retry = root.setTimeout(connect, Math.min(60000, 3000 * 2 ** Math.min(tries++, 4))); };
        }
        const hidden = () => modal.classList.contains('minimised') || modal.classList.contains('hidden');
        const shut = () => { clearTimeout(retry); if (sock) { sock.onclose = null; sock.close(); sock = null; } if (dec && dec.state !== 'closed') { try { dec.close(); } catch (_) { /* closed */ } } dec = null; codec = ''; conn('off', 'closed'); msg('The connection is closed while this window is minimised.'); };
        const watch = new MutationObserver(() => { if (hidden()) { if (sock) shut(); } else if (!sock && !closed) connect(); });
        watch.observe(modal, { attributes: true, attributeFilter: ['class'] });
        const gone = new MutationObserver(() => { if (!doc.body.contains(modal)) { closed = true; shut(); watch.disconnect(); gone.disconnect(); if (raf) root.cancelAnimationFrame(raf); if (pend) pend.close(); } });
        gone.observe(doc.body, { childList: true });

        $('ctl').addEventListener('change', (ev) => { ctl = ev.target.checked; setCtl(); if (sock) { sock.onclose = null; sock.close(); sock = null; } if (dec && dec.state !== 'closed') { try { dec.close(); } catch (_) { /* closed */ } } dec = null; codec = ''; connect(); });
        const keyBtn = { back: 'BACK', home: 'HOME', recents: 'APP_SWITCH', power: 'POWER', vdown: 'VOLUME_DOWN', vup: 'VOLUME_UP' };
        root0.querySelectorAll('.rm-dev-btn').forEach((b) => b.addEventListener('click', async () => {
            const k = b.dataset.k;
            if (keyBtn[k]) send({ t: 'key', name: keyBtn[k] });
            else if (k === 'rotate') send({ t: 'rotate' });
            else if (k === 'notif') send({ t: 'notifications', open: true });
            else if (k === 'shot') { try { const r = await R.act(server, 'android', 'screenshot', { name }); const f = (r.result || r).file; if (f) { const an = doc.createElement('a'); an.href = R.shotUrl(server, f); an.download = `${name}.png`; doc.body.appendChild(an); an.click(); an.remove(); } } catch (e) { msg((e && e.message) || 'Screenshot failed'); } }
            cv.focus();
        }));
        // pointer: touch down / move / up in video pixels
        const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: Math.round((e.clientX - r.left) * cv.width / r.width), y: Math.round((e.clientY - r.top) * cv.height / r.height), w: cv.width, h: cv.height }; };
        cv.addEventListener('pointerdown', (e) => { if (!ctl) return; cv.focus(); cv.setPointerCapture(e.pointerId); send({ t: 'touch', a: 'down', ...pos(e) }); e.preventDefault(); });
        cv.addEventListener('pointermove', (e) => { if (!ctl || !cv.hasPointerCapture(e.pointerId)) return; const nw = performance.now(); if (nw - last < 16) return; last = nw; send({ t: 'touch', a: 'move', ...pos(e) }); });
        const up = (e) => { if (!ctl || !cv.hasPointerCapture(e.pointerId)) return; send({ t: 'touch', a: 'up', ...pos(e) }); cv.releasePointerCapture(e.pointerId); };
        cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
        cv.addEventListener('wheel', (e) => { if (!ctl) return; send({ t: 'scroll', ...pos(e), dx: -e.deltaX / 100, dy: -e.deltaY / 100 }); e.preventDefault(); }, { passive: false });
        cv.addEventListener('contextmenu', (e) => e.preventDefault());
        cv.addEventListener('keydown', (e) => {
            if (!ctl || e.ctrlKey || e.metaKey || e.altKey) return;
            if (KEYS[e.key]) send({ t: 'key', name: KEYS[e.key] });
            else if (e.key.length === 1) send({ t: 'text', text: e.key });
            else return;
            e.preventDefault();
        });
        connect();
        void lane;
    }

    // ---- Running outside Rack Manager ------------------------------------------------------------------------------

    R.unmanagedSection = (c, n) => {
        const info = n.ss && n.ss.info;
        const idleU = n.ss && n.ss.power && n.ss.power.idle && n.ss.power.idle.unmanaged;
        const list = arr((info && info.unmanaged) || idleU);
        if (!list.length) return null;
        const rows = list.map((u) => ({ key: String(u.pid), data: u }));
        const l = c.listView([
            { t: 'PID', w: 60, num: true, key: 'p', value: (u) => u.pid, text: (u) => u.pid },
            { t: 'User', w: 70, key: 'u', text: (u) => u.user || '' },
            { t: 'What', w: 300, key: 'c', text: (u) => u.cmd || '' },
            { t: 'Why it is listed', w: 220, key: 'w', text: (u) => u.why || '' }
        ], rows, { sortId: 'rm-unmanaged', fit: true, empty: '' });
        return { id: 'rm-unmanaged', title: 'Running outside Rack Manager', body: `<p class="rm-warn"><img src="${VI}/warning-16.png" alt=""> ${list.length === 1 ? '1 process runs' : `${list.length} processes run`} on this host that Rack Manager did not start and nothing there explains. Nobody can see or drive ${list.length === 1 ? 'it' : 'them'}, and ${list.length === 1 ? 'it keeps' : 'they keep'} the host from shutting down by itself.</p>${l}`
            + '<p class="mmc-hint">To adopt one: stop it and start it again as a rackd job or a terminal exec, in a tmux session (Terminal, New session) so its output is visible, as a container, or as a rack service (Services, Define). A stray VM is created again through Virtual Machines; an emulator through Virtual Android Devices.</p>' };
    };
}(typeof window !== 'undefined' ? window : globalThis));
