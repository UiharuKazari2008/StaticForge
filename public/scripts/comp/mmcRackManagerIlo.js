/**
 * Rack Manager, part 1: the iLO Console node. The live iLO KVM (canvas on WS /rack/<server>/ilo/ws, protocol in
 * ~/ilo-console/README.md), keyboard capture, key combinations, typed text, virtual media, screenshot and the boot progress.
 * The decoder-side client code (video rectangles, key and mouse messages, status messages) is ilo-console's own
 * public/index.html, copied by script and fitted to this window. The socket is open only while the Console node is shown
 * and the window is not minimised. Part of window.mmcRack (mmcRackManager.js).
 */
(function (root) {
    'use strict';

    const R = root.mmcRack;
    if (!R) return;
    const { esc, ITEMS, VI } = R;
    const doc = root.document;
    const K = { view: null };   // the one open KVM view of the window

    const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

    /** The KVM view in a pane; returns { close, send, ... }. */
    function kvmOpen(c, server, pane) {
        const ac = new AbortController();
        const $ = (id) => pane.querySelector(`[data-k="${id}"]`);
        const cv = $('cv'), ctx = cv.getContext('2d');
        let sock = null, queue = Promise.resolve(), buttons = 0, retry = null, capture = true, wanted = true, tries = 0, closed = false;
        const view = { server, cv, setCapture: (on) => { capture = on; cv.classList.toggle('is-capturing', on); if (on) cv.focus(); }, get capture() { return capture; } };
        // the connection, power, health, screen size and POST stage live in the status bar (R.statusX.console, drawn by R.panes.console)
        const X = R.statusX.console = { cs: 'wait', ct: 'connecting', power: null, hs: '', ht: '', size: '', post: '' };
        const paint = () => { try { c.renderStatus(); } catch (_) { /* window gone */ } };
        function setConn(state, text) { X.cs = state; X.ct = text; paint(); }
        function setPower(on) { X.power = on; paint(); }
        function setHealth(h) { X.hs = { green: 'on', yellow: 'warn', red: 'bad' }[h] || ''; X.ht = { green: 'Good', yellow: 'Degraded', red: 'Failed' }[h] || h || ''; paint(); }
        function msg(t) { $('msg').textContent = t || ''; $('msg').style.display = t ? '' : 'none'; }
        function send(o) { if (sock && sock.readyState === 1) sock.send(JSON.stringify(o)); }
        async function inflate(bytes) {
          const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          return new Uint8Array(await new Response(s).arrayBuffer());
        }
        function onBinary(buf) {
          const d = new DataView(buf), type = d.getUint8(0);
          if (type === 1) {
            queue = queue.then(() => { cv.width = d.getUint16(1, true); cv.height = d.getUint16(3, true); msg(''); X.size = `${cv.width}×${cv.height}`; paint(); });
          } else if (type === 2) {
            const x = d.getUint16(1, true), y = d.getUint16(3, true), w = d.getUint16(5, true), h = d.getUint16(7, true);
            const data = new Uint8Array(buf, 9);
            queue = queue.then(async () => {
              const rgb = await inflate(data), img = ctx.createImageData(w, h), px = img.data;
              for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) { px[j] = rgb[i]; px[j + 1] = rgb[i + 1]; px[j + 2] = rgb[i + 2]; px[j + 3] = 255; }
              ctx.putImageData(img, x, y);
            }).catch(e => console.error(e));
          }
        }
        function onText(o) {
          if (o.connecting) { setConn('wait', 'connecting'); msg('Logging in to the iLO…'); }
          if (o.connected) { setConn('on', 'connected'); msg(cv.width > 640 ? '' : 'Waiting for video…'); }
          if ('power' in o) setPower(o.power);
          if (o.health) setHealth(o.health);
          if (o.video === false) msg('No video signal');
          if (o.error) { setConn('off', 'error'); msg(o.error); }
          if (o.closed) { setConn('off', 'closed'); msg('Console closed: ' + o.closed); }
          if (o.post && !o.postIgnored) {
            const bar = $('postbar'); bar.style.display = 'block'; clearTimeout(bar.hideT);
            const pct = o.postPct;
            $('postfill').style.width = (pct == null ? 100 : pct) + '%';
            $('postfill').classList.toggle('unknown', pct == null);
            const mmss = s => s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
            X.post = o.postDone ? 'POST complete, booting from disk' : `${o.postStage || 'POST'} ${o.post}${pct != null ? ` ${pct}%` : ''}`;
            $('posttxt').textContent = o.postDone ? 'POST complete — booting from disk'
              : `${o.postStage || 'POST'} · ${o.post}` + (pct != null ? ` · ${pct}% · ~${mmss(o.postEta)} left` : ` · ${mmss(o.postElapsed || 0)} (first boot: learning the timing)`);
            paint();
            $('postbar').title = `POST code ${o.post}${o.postElapsed != null ? `, ${o.postElapsed} s since power-on` : ''}. Progress is based on the timing of previous boots, up to the hand-off to the boot disk.`;
            if (o.postDone) bar.hideT = setTimeout(() => { bar.style.display = 'none'; X.post = ''; c.renderStatus(); }, 8000);
          }
          if (o.text) { X.note = o.text; paint(); }
          if (o.log) console.log(o.log);
        }

        const kmsg = (e, down) => ({ t: 'key', code: e.code, key: e.key, down, rep: e.repeat, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey });
        cv.addEventListener('keydown', e => { if (!capture) return; e.preventDefault(); send(kmsg(e, true)); });
        cv.addEventListener('keyup', e => { if (!capture) return; e.preventDefault(); send(kmsg(e, false)); });
        cv.addEventListener('blur', () => send({ t: 'release' }));
        function pos(e) { const r = cv.getBoundingClientRect(); return { x: Math.round((e.clientX - r.left) * cv.width / r.width), y: Math.round((e.clientY - r.top) * cv.height / r.height) }; }
        let lastMove = 0;
        cv.addEventListener('mousemove', e => { const n = performance.now(); if (n - lastMove < 15) return; lastMove = n; send({ t: 'mouse', ...pos(e), b: buttons }); });
        const btnBit = b => b === 0 ? 1 : b === 2 ? 2 : b === 1 ? 4 : 0;
        cv.addEventListener('mousedown', e => { cv.focus(); buttons |= btnBit(e.button); send({ t: 'mouse', ...pos(e), b: buttons }); e.preventDefault(); });
        window.addEventListener('mouseup', e => { if (!buttons) return; buttons &= ~btnBit(e.button); send({ t: 'mouse', ...pos(e), b: buttons }); }, { signal: ac.signal });
        cv.addEventListener('contextmenu', e => e.preventDefault());

        function connect() {
            clearTimeout(retry);
            if (sock) { sock.onclose = null; sock.close(); sock = null; }
            if (!wanted || closed) return;
            sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/rack/${encodeURIComponent(server)}/ilo/ws`);
            sock.binaryType = 'arraybuffer';
            sock.onmessage = e => { tries = 0; return typeof e.data === 'string' ? onText(JSON.parse(e.data)) : onBinary(e.data); };
            // a dropped console is opened again with a growing wait (3 s to a minute), only while it is shown
            sock.onclose = () => { setConn('off', 'disconnected'); if (wanted && !closed) { retry = setTimeout(connect, Math.min(60000, 3000 * 2 ** Math.min(tries++, 4))); } };
            setConn('wait', 'connecting'); setPower(null);
        }
        view.open = () => { wanted = true; if (!sock) connect(); };
        view.shut = () => { wanted = false; clearTimeout(retry); if (sock) { sock.onclose = null; sock.close(); sock = null; } setConn('off', 'closed'); msg('The console is closed while this window is minimised.'); };
        view.send = send;
        view.close = () => { closed = true; view.shut(); ac.abort(); };
        view.fit = () => { cv.classList.toggle('actual'); return cv.classList.contains('actual'); };
        // the window minimised or hidden: the socket goes; back again: it opens
        const watch = new MutationObserver(() => { const away = c.modal.classList.contains('minimised') || c.modal.classList.contains('hidden'); if (away && sock) view.shut(); else if (!away && wanted === false && !closed) view.open(); });
        watch.observe(c.modal, { attributes: true, attributeFilter: ['class'] });
        ac.signal.addEventListener('abort', () => watch.disconnect());
        cv.classList.add('is-capturing');
        connect();
        return view;
    }

    // ---- the page --------------------------------------------------------------------------------------------

    const COMBOS = [['cad', 'Ctrl+Alt+Del'], ['cab', 'Ctrl+Alt+Backspace'], ['caf1', 'Ctrl+Alt+F1'], ['caf2', 'Ctrl+Alt+F2'], ['caf3', 'Ctrl+Alt+F3'], ['caf4', 'Ctrl+Alt+F4'], ['caf5', 'Ctrl+Alt+F5'], ['caf6', 'Ctrl+Alt+F6'], ['caf7', 'Ctrl+Alt+F7']];

    R.pages.console = (c, n) => {
        const html = `<div class="mmc-page-title"><b>Console</b><span>${esc(n.meta.label)}</span></div>
            <div class="rm-kvm" data-mmc-scroll>
                <div class="rm-kvm-bar">
                    ${R.btnHtml('kvm-cad', 'Ctrl+Alt+Del')}${R.btnHtml('kvm-type', 'Type Text...')}${R.btnHtml('kvm-media', 'Virtual Media...')}${R.btnHtml('kvm-shot', 'Screenshot')}${R.btnHtml('kvm-fit', 'Actual Size')}
                    <label class="rm-check"><input type="checkbox" data-rm-input="kvm-capture" checked> Capture keyboard</label>
                </div>
                <div class="rm-post" data-k="postbar" hidden><div class="rm-post-fill" data-k="postfill"></div><span data-k="posttxt"></span></div>
                <div class="rm-kvm-screen"><canvas class="rm-kvm-cv" data-k="cv" width="640" height="400" tabindex="0"></canvas><div class="rm-kvm-msg" data-k="msg">Connecting...</div></div>
            </div>`;
        return {
            html,
            mount: (pane) => {
                if (K.view) { K.view.close(); K.view = null; }
                K.view = kvmOpen(c, n.server, pane);
            },
            unmount: () => { if (K.view) { K.view.close(); K.view = null; } }
        };
    };
    R.panes.console = () => {
        const X = R.statusX.console;
        if (!X) return [];
        const pw = X.power;
        const out = [{ icon: R.lightSrc(X.cs), text: X.ct ? X.ct.replace(/^./, (ch) => ch.toUpperCase()) : '', title: 'Console connection' },
            { icon: R.lightSrc(pw === true ? 'on' : 'off'), text: `Power: ${pw === true ? 'on' : pw === false ? 'off' : 'unknown'}` },
            { icon: R.lightSrc(X.hs || 'off'), text: `Health: ${X.ht || 'unknown'}` }];
        if (X.size) out.push({ text: `Screen ${X.size}` });
        if (X.note) out.push({ text: X.note });
        if (X.post) out.push({ icon: R.lightSrc('warn'), text: X.post, title: 'POST stage' });
        return out;
    };
    R.hooks.close.push(() => { if (K.view) { K.view.close(); K.view = null; } });

    R.commands.console = () => [
        { text: 'Ctrl+Alt+Del', action: 'kvm-combo:cad' },
        { text: 'Type Text...', action: 'kvm-type' },
        { text: 'Virtual Media...', action: 'kvm-media', icon: `${ITEMS}/autoplay-16.png` },
        { text: 'Take Screenshot', action: 'kvm-shot' },
        { text: 'Refresh Video', action: 'kvm-refresh' },
        { separator: true },
        ...COMBOS.slice(1).map(([id, t]) => ({ text: t, action: `kvm-combo:${id}` }))
    ];

    R.inputs['kvm-capture'] = (on) => { if (K.view) K.view.setCapture(!!on); };

    const A = R.actions;
    A['kvm-cad'] = () => { if (K.view) { K.view.send({ t: 'combo', name: 'cad' }); K.view.cv.focus(); } };
    A['kvm-combo'] = (c, id) => { if (K.view) { K.view.send({ t: 'combo', name: id }); K.view.cv.focus(); } };
    A['kvm-refresh'] = () => { if (K.view) K.view.send({ t: 'refresh' }); };
    A['kvm-fit'] = (c) => { if (!K.view) return; const actual = K.view.fit(); const b = c.el('.mmc-result [data-act="kvm-fit"]'); if (b) b.textContent = actual ? 'Fit to Window' : 'Actual Size'; };

    A['kvm-type'] = (c) => {
        R.dialog(c, {
            id: 'typetext', title: 'Type Text', w: 400, h: 250,
            html: '<p>The text is typed into the server as key presses, as if it came from the keyboard.</p><textarea data-rm="text" class="rm-textarea" rows="6" spellcheck="false"></textarea><div class="rm-hint" data-rm-count>0 characters</div>',
            okText: 'Type',
            init: (ctx) => { const t = ctx.content.querySelector('[data-rm="text"]'); t.addEventListener('input', () => { ctx.content.querySelector('[data-rm-count]').textContent = `${t.value.length} characters`; }); },
            ok: (ctx) => { const text = R.val(ctx, 'text'); if (!text) { R.err(ctx, 'Type some text first.'); return false; } if (K.view) { K.view.send({ t: 'type', text }); K.view.cv.focus(); } return true; }
        });
    };

    A['kvm-shot'] = (c, p, n) => {
        const url = `/rack/${encodeURIComponent(n.server)}/ilo/screenshot.png?t=${Date.now()}`;
        R.dialog(c, {
            id: 'shot', title: `Screenshot: ${n.meta.label}`, w: 700, h: 560, okText: 'Close', noCancel: true,
            html: `<div class="rm-shot"><img src="${url}" alt="The server's console"></div><p class="rm-hint"><a href="${url}" download="${esc(n.server)}-console.png">Save the picture</a></p>`
        });
    };

    // ---- virtual media ---------------------------------------------------------------------------------------

    function mounted(s) {
        const cd = arr(s && s.options).find((o) => /cd/i.test(o.device || '')) || arr(s && s.options)[1] || {};
        return cd.vm_url_connected || cd.vm_connected ? (cd.vm_url || cd.image_url || 'yes') : '';
    }
    const fmtSize = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`);

    A['kvm-media'] = async (c, p, n) => {
        const server = n.server;
        let isos = [];
        let media = null;
        let readErr = '';
        const stateHtml = () => { const m = mounted(media); return m ? `Mounted: <b>${esc(m)}</b>` : 'Nothing is mounted.'; };
        R.dialog(c, {
            id: 'media', title: `Virtual Media: ${n.meta.label}`, w: 520, h: 430, okText: 'Close', noCancel: true,
            html: `<div class="rm-field is-wide"><span>Virtual CD/DVD-ROM</span><b data-rm-state>${stateHtml()}</b></div>
                <div class="rm-field is-wide"><span>ISO library</span><div class="rm-isolist" data-rm-isos></div></div>
                <div class="rm-row">${R.btnHtml('m-mount', 'Mount Selected', null, ' data-rm-mount')}${R.btnHtml('m-eject', 'Eject')}${R.chk('bootOnce', 'Boot from it once (next restart)', false)}</div>
                ${R.field('Mount from a URL', R.inp('url', '', 'placeholder="http://..."'), true)}
                <div class="rm-row">${R.btnHtml('m-url', 'Mount URL')}${R.btnHtml('m-upload', 'Upload ISO...')}<input type="file" accept=".iso" data-rm="file" hidden><span class="rm-hint" data-rm-prog></span></div>`,
            init: (ctx) => {
                const q = (s) => ctx.content.querySelector(s);
                let pick = null;
                let loading = true;
                const paint = () => {
                    q('[data-rm-isos]').innerHTML = isos.length ? isos.map((i) => `<div class="rm-isorow${i.name === pick ? ' is-selected' : ''}" data-iso="${esc(i.name)}"><span>${esc(i.name)}</span><i>${fmtSize(i.size)}</i></div>`).join('') : `<div class="rm-hint">${loading ? 'Reading data, please wait...' : readErr ? esc(readErr) : 'No ISO images are uploaded yet.'}</div>`;
                    q('[data-rm-state]').innerHTML = stateHtml();
                };
                paint();
                // the dialog is up at once; the iLO can take seconds to answer
                void Promise.all([R.ilo(server, 'isos').then((x) => { isos = arr(x); }, (e) => { readErr = (e && e.message) || ''; }), R.ilo(server, 'media').then((x) => { media = x; }, (e) => { readErr = readErr || (e && e.message) || ''; })]).then(() => { loading = false; pick = isos[0] && isos[0].name; if (ctx.content.isConnected) paint(); });
                const mount = async (b) => {
                    R.err(ctx, '');
                    try { media = await R.iloAct(server, 'media', Object.assign({ device: 'CDROM', bootOnce: R.val(ctx, 'bootOnce') }, b)); paint(); } catch (e) { R.err(ctx, (e && e.message) || 'The request failed.'); }
                };
                ctx.content.addEventListener('click', (ev) => {
                    const row = ev.target.closest('[data-iso]');
                    if (row) { pick = row.dataset.iso; paint(); return; }
                    const b = ev.target.closest('[data-act]');
                    if (!b) return;
                    ev.stopPropagation();
                    const a = b.dataset.act;
                    if (a === 'm-mount' && pick) void mount({ iso: pick });
                    else if (a === 'm-eject') void mount({ action: 'eject' });
                    else if (a === 'm-url') { const u = (R.val(ctx, 'url') || '').trim(); if (u) void mount({ url: u }); }
                    else if (a === 'm-upload') q('[data-rm="file"]').click();
                });
                q('[data-rm="file"]').addEventListener('change', (ev) => {
                    const f = ev.target.files[0];
                    if (!f) return;
                    const x = new XMLHttpRequest();
                    x.open('POST', `/rack/${encodeURIComponent(server)}/ilo/iso-upload?name=${encodeURIComponent(f.name)}`);
                    x.upload.onprogress = (e) => { q('[data-rm-prog]').textContent = `${Math.round((e.loaded / e.total) * 100)}%`; };
                    x.onload = async () => { q('[data-rm-prog]').textContent = x.status === 200 ? 'Uploaded' : `Failed: ${x.responseText || x.status}`; if (x.status === 200) { try { isos = arr(await R.ilo(server, 'isos')); paint(); } catch (_) { /* kept */ } } };
                    x.onerror = () => { q('[data-rm-prog]').textContent = 'The upload failed.'; };
                    x.send(f);
                });
            }
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
