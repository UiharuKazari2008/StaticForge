/**
 * Melaton Update's restart prompt (#945): Vista's automatic updates restart dialog (wuauclt; the words are
 * wucltux.dll.mui's, Windows -> Melaton): "Restart your computer to finish installing important updates", the
 * reason, "Restarting in: 4 min, 59 sec" while an automatic restart counts down, "Remind me in:" (10 minutes,
 * 1 hour, 4 hours) and Restart now / Postpone.
 *
 * When updates that need a restart are ready (serviceWorkerManager.showUpdateCompleteToast('restart') calls
 * schedule()):
 *   automatic restart on (Melaton Update > Change settings, the default, as Vista recommends): the dialog opens with
 *     the countdown; at 0 Melaton restarts through serviceWorkerManager.forceRestart (the per-window plans and
 *     the Continuity order, then winlogon, whose "programs still running" screen still stops for unsaved work)
 *   off: the balloon only (the tray's Melaton Update icon and the page's Restart now), as Vista's "let me choose"
 * Postpone closes it and asks again after the chosen time (one timer, not a poll). The prompt goes when the updates
 * are applied or the restart runs (serviceWorkerManager.resetPendingUpdateFuse -> cancel()).
 * Desktops only: Melaton Mobile keeps its notification (the phone owns the restart of a Continuity pair, and its
 * DeX window prompts for both); agent tabs never.
 *
 * The window (#945, Yukimi: 1:1 and at the bottom right): Vista's task dialog as captured (408 x 230: the shield-warning
 * banner with the main instruction, the reason, the countdown area of wucltux.dll UIFILE 127 - bold "Restarting in:"
 * over a progress bar - "Remind me in:" right-aligned, and the grey command area with Restart now and Postpone, the
 * default). No caption buttons. It opens in the bottom-right corner of the work area, by the notification area, and
 * stays there as the screen changes; it does not take the keyboard focus from the window in use.
 *
 *   window.melatonRestartPrompt = { schedule(delayMs), show(), cancel(), settings(), save(settings) }
 *   settings: melatonUpdateSettings (serviceWorkerManager.js): { mode notify | download | auto, auto, warnMin 1 | 5 | 15 }
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const KEY = 'melatonUpdateAutoRestart';
    const WARN = [1, 5, 15];
    // wucltux.dll.mui 1109 / 92 / 88 / 89: Remind me in 10 minutes, 1 hour, 4 hours (the last is Vista's default)
    const REMIND = [{ value: '10', text: '10 minutes' }, { value: '60', text: '1 hour' }, { value: '240', text: '4 hours' }];
    // the task bar's icon; the banner's is TD_SHIELD_WARNING_ICON (imageres.dll 101, as Vista draws it)
    const ICON = '/static_images/vista-icons/windows-update-32.png';
    const SHIELD = '/static_images/vista-defender/shield-warning-32.png';
    // wucltux.dll.mui 221, 1110, 222, 1109, 223, 224 (Windows -> Melaton)
    const S = {
        title: 'Melaton Update',
        instruction: 'Restart your computer to finish installing important updates',
        reason: "Melaton can't update important files and services while the system is using them. Make sure to save your files before restarting."
    };
    // the kit gives the combo ("Remind me in:"); the task dialog around it is drawn here (css/update-restart.css)
    const TPL = {
        t: S.title,
        w: 231,
        h: 109,
        f: ['Segoe UI', 9],
        s: 0x80C800C8,
        c: [[105, 'C', 0, 0, 86, 60, 0x50210003, '', 0]]
    };
    const COMBO_ID = 'melatonUpdateRestartDialog-105';

    let cssDone = false;
    function styles() {
        if (cssDone || !doc) return;
        cssDone = true;
        ['/css/themes/vista/update-restart.css', '/css/update-restart.css'].forEach((href) => {
            const link = doc.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            doc.head.appendChild(link);
        });
    }

    /** The bottom-right corner of the work area (above a bottom task bar), as Vista puts it by the notification area. */
    function place(m) {
        if (!m || !m.isConnected) return;
        const r = m.getBoundingClientRect();
        const bar = doc.getElementById('desktopTaskbar') || doc.getElementById('taskbar');
        const b = bar ? bar.getBoundingClientRect() : null;
        const bottom = b && b.height && b.top > root.innerHeight / 2 ? b.top : root.innerHeight;
        const x = Math.max(0, Math.round(root.innerWidth - r.width - 10));
        const y = Math.max(0, Math.round(bottom - r.height - 10));
        if (typeof root.setModalOffsetsFromViewportTopLeft === 'function') root.setModalOffsetsFromViewportTopLeft(m, x, y);
    }

    // Melaton Update's setting (#951; serviceWorkerManager.js melatonUpdateSettings): the countdown is the automatic
    // mode's; with the others the dialog only offers the restart (opened from Melaton Update or the tray)
    function settings() {
        const u = root.melatonUpdateSettings;
        if (u && typeof u.get === 'function') return u.get();
        let v = null;
        try { v = JSON.parse(root.localStorage.getItem(KEY) || 'null'); } catch (_) { v = null; }
        const warnMin = v && WARN.includes(Number(v.warnMin)) ? Number(v.warnMin) : 5;
        return { mode: v && v.mode ? v.mode : 'notify', auto: !!(v && v.mode === 'auto'), warnMin };
    }

    function save(next) {
        const u = root.melatonUpdateSettings;
        if (u && typeof u.save === 'function') return u.save(next);
        return settings();
    }

    function manager() { return root.serviceWorkerManager || null; }

    /** A desktop with updates waiting that only a restart installs. */
    function eligible() {
        const sw = manager();
        if (!doc || !root.isDesktop || root.uiShell === 'mobile' || !sw || sw.agentSession) return false;
        if (!sw.pendingUpdateFuse || sw.pendingUpdateKind !== 'restart') return false;
        const ws = root.wsClient;
        if (!ws || !ws.initializationCompleted) return false;
        // a power sequence already on its way down
        // winlogonPowerRunning: public/scripts/comp/winlogonPower.js (a script-level flag)
        // eslint-disable-next-line no-undef
        if (root.melatonRestarting || (typeof winlogonPowerRunning !== 'undefined' && winlogonPowerRunning)) return false;
        return true;
    }

    let remindTimer = 0;
    let tickTimer = 0;
    let deadlineTimer = 0;
    let ctx = null;
    let deadline = 0;
    let started = 0;
    let placing = null; // the resize listener while the prompt is up

    // the countdown waits for the person to be at the computer (PopoverManager.presence, as the tray balloons do)
    let presenceWait = null;
    function clearTimers() {
        if (placing) { placing.abort(); placing = null; }
        if (presenceWait) { presenceWait(); presenceWait = null; }
        clearTimeout(remindTimer);
        remindTimer = 0;
        clearInterval(tickTimer);
        tickTimer = 0;
        clearTimeout(deadlineTimer);
        deadlineTimer = 0;
    }

    /** Ask after delayMs (0: now). Only the automatic restart opens the dialog by itself. */
    function schedule(delayMs) {
        clearTimeout(remindTimer);
        remindTimer = setTimeout(() => { remindTimer = 0; if (settings().auto) void show(); }, Math.max(0, Number(delayMs) || 0));
    }

    // Install updates automatically (#951, Yukimi Nov 20 2026): updates installed by themselves restart an hour later,
    // the countdown starting when the person is at the computer. One timer, not a poll.
    const AUTO_RESTART_AFTER_MS = 60 * 60 * 1000;
    function scheduleAuto() {
        if (!settings().auto) return;
        schedule(AUTO_RESTART_AFTER_MS);
    }

    /**
     * The person installed the updates (Melaton Update's Install updates): the restart warning follows at once, with
     * its countdown, whatever the mode - Vista's "Restart your computer to finish installing important updates" after
     * the install finishes. Postpone keeps its Remind me in choices.
     */
    function afterInstall() {
        clearTimeout(remindTimer);
        remindTimer = setTimeout(() => { remindTimer = 0; void show({ countdown: true }); }, 1500);
    }

    function kit() {
        const fl = root.featureLoader;
        const ready = fl && typeof fl.loadFeature === 'function' ? fl.loadFeature('vista_dialog_templates') : Promise.resolve();
        return Promise.resolve(ready).then(() => root.vistaDialogTemplate || null);
    }

    function countdownText(ms) {
        const s = Math.max(0, Math.ceil(ms / 1000));
        // wucltux.dll.mui 222: "Restarting in: %1!d! min, %2!d! sec"
        return `Restarting in: ${Math.floor(s / 60)} min, ${s % 60} sec`;
    }

    /** Restart for the updates: the dialog closes (closeIt: the countdown ran out), then forceRestart. */
    function restartNow(closeIt) {
        const c = ctx;
        ctx = null;
        clearTimers();
        if (closeIt && c) { try { c.close(); } catch (_) { /* gone */ } }
        const sw = manager();
        // confirmed: the person (or the countdown) chose it here; forceRestart still plans each Continuity window
        setTimeout(() => { if (sw && typeof sw.forceRestart === 'function') sw.forceRestart({ confirmed: true }); }, 0);
    }

    function postpone(minutes) {
        const m = Number(minutes) || 240;
        if (ctx) { const c = ctx; ctx = null; try { c.close(); } catch (_) { /* gone */ } }
        clearTimers();
        remindTimer = setTimeout(() => { remindTimer = 0; void show(); }, m * 60 * 1000);
    }

    /** The dialog (one at a time). The countdown runs with the automatic restart on, or when the person installed. */
    async function show(opts = {}) {
        if (ctx || !eligible()) return;
        const auto = settings().auto || opts.countdown === true;
        // a countdown starts only with the person at the computer: away, the dialog waits and opens when they are back
        const pm = root.PopoverManager;
        if (auto && pm && pm.presence && typeof pm.presence.present === 'function' && !pm.presence.present()) {
            if (!presenceWait) presenceWait = pm.presence.whenPresent(() => { presenceWait = null; void show(opts); });
            return;
        }
        const V = await kit();
        if (!V || typeof V.openDialog !== 'function' || ctx || !eligible()) return;
        styles();
        const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        let remind = '240';
        // the window in use keeps the keyboard (Vista shows the prompt without taking the focus)
        const had = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
        ctx = V.openDialog({
            id: 'melatonUpdateRestartDialog',
            tpl: TPL,
            icon: ICON,
            bareCaption: true,
            init: (c) => {
                const content = c.content;
                const combo = content.querySelector(`[data-vdt-id="105"]`);
                const wrap = doc.createElement('div');
                wrap.className = 'wur';
                wrap.innerHTML = `
                    <div class="wur-banner"><img class="wur-icon" src="${SHIELD}" alt="" draggable="false"><div class="wur-instruction">${esc(S.instruction)}</div></div>
                    <div class="wur-content">
                        <div class="wur-text">${esc(S.reason)}</div>
                        ${auto ? '<div class="wur-countdown"><div class="wur-count-text"></div><div class="wur-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div></div></div></div>' : ''}
                        <div class="wur-postpone"><label class="wur-remind" for="${COMBO_ID}"><u>R</u>emind me in:</label></div>
                    </div>
                    <div class="wur-footer">
                        <button type="button" class="tbp-ctl tbp-button" data-wur="restart">Restart <u>n</u>ow</button>
                        <button type="button" class="tbp-ctl tbp-button" data-wur="postpone" data-dialog-primary="1"><u>P</u>ostpone</button>
                    </div>`;
                content.appendChild(wrap);
                if (combo) wrap.querySelector('.wur-postpone').appendChild(combo);
                c.options(105, REMIND, remind);
                c.on(105, 'change', () => { remind = String(c.get(105) || remind); });
                // Restart now / Postpone (the default: Enter), Esc postpones; Alt+N, Alt+P, Alt+R (the combo)
                wrap.addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-wur]');
                    if (!b) return;
                    if (b.dataset.wur === 'restart') restartNow(true);
                    else postpone(remind);
                });
                c.modal.addEventListener('keydown', (ev) => {
                    const k = String(ev.key || '').toLowerCase();
                    if (ev.altKey && k === 'n') { ev.preventDefault(); restartNow(true); return; }
                    if (ev.altKey && k === 'p') { ev.preventDefault(); postpone(remind); return; }
                    if (ev.altKey && k === 'r') { ev.preventDefault(); const sel = doc.getElementById(COMBO_ID); if (sel) sel.focus(); return; }
                    if (ev.key === 'Escape') { ev.preventDefault(); postpone(remind); return; }
                    if (ev.key === 'Enter' && !(ev.target.closest && ev.target.closest('button, select'))) { ev.preventDefault(); postpone(remind); }
                });
                if (!auto) return;
                const total = settings().warnMin * 60 * 1000;
                started = Date.now();
                deadline = started + total;
                const line = wrap.querySelector('.wur-count-text');
                const bar = wrap.querySelector('.wur-bar');
                const paint = () => {
                    const left = deadline - Date.now();
                    if (line.textContent !== countdownText(left)) line.textContent = countdownText(left);
                    const done = Math.max(0, Math.min(100, Math.round(((total - left) / total) * 100)));
                    bar.style.setProperty('--wur-done', `${done}%`);
                    bar.setAttribute('aria-valuenow', String(done));
                };
                paint();
                // the restart at the deadline (one timeout: it holds with the screen off, as Vista's does) ...
                deadlineTimer = setTimeout(() => restartNow(true), total);
                // ... and the second tick of the text and bar, drawn only while the page is seen
                tickTimer = setInterval(() => {
                    if (doc.hidden || doc.documentElement.dataset.screenOff !== undefined) return;
                    paint();
                }, 1000);
            },
            // the kit's own cancel (its close paths): postponed, as Vista's Postpone
            cancel: () => { const r = remind; ctx = null; clearTimers(); postpone(r); }
        });
        if (!ctx || !ctx.modal) return;
        const m = ctx.modal;
        // the bottom-right corner, after the kit's own centring (next frame), and again whenever the screen changes
        placing = new AbortController();
        root.addEventListener('resize', () => place(m), { signal: placing.signal });
        // its own size settles after the styles and fonts land: placed again then (the corner is its bottom-right)
        if (typeof root.ResizeObserver === 'function') {
            // (a frame later: the window manager keeps a growing window on screen first, flush to the edge)
            const ro = new root.ResizeObserver(() => root.requestAnimationFrame(() => place(m)));
            ro.observe(m);
            placing.signal.addEventListener('abort', () => ro.disconnect(), { once: true });
        }
        root.requestAnimationFrame(() => root.requestAnimationFrame(() => {
            place(m);
            if (had && had.isConnected && typeof had.focus === 'function') { try { had.focus({ preventScroll: true }); } catch (_) { /* gone */ } }
        }));
        setTimeout(() => place(m), 120);
        setTimeout(() => place(m), 600);
    }

    /** The updates are gone (installed live, or the restart runs): no prompt, no reminder. */
    function cancel() {
        clearTimers();
        if (ctx) { const c = ctx; ctx = null; try { c.close(); } catch (_) { /* gone */ } }
    }

    /**
     * A restart's confirmation in the same task dialog (#951: the Continuity "this will restart both" question):
     * { instruction, reason, devices: [{ icon, name, note }], ok = 'Restart Now', later = 'Later' }. Centred over the
     * desktop, as a task dialog that answers a click. Resolves true for the restart, false for Later / Esc.
     */
    let confirmCtx = null;
    async function confirmRestart(o = {}) {
        if (confirmCtx) { try { confirmCtx.close(); } catch (_) { /* gone */ } confirmCtx = null; }
        const V = await kit();
        if (!V || typeof V.openDialog !== 'function') return true;
        styles();
        const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        return new Promise((resolve) => {
            let settled = false;
            const done = (v) => { if (settled) return; settled = true; const c = confirmCtx; confirmCtx = null; if (c) { try { c.close(); } catch (_) { /* gone */ } } resolve(v); };
            confirmCtx = V.openDialog({
                id: 'melatonContinuityRestartDialog',
                tpl: { t: o.title || S.title, w: 231, h: 109, f: ['Segoe UI', 9], s: 0x80C800C8, c: [] },
                icon: ICON,
                bareCaption: true,
                init: (c) => {
                    const wrap = doc.createElement('div');
                    wrap.className = 'wur';
                    const rows = (o.devices || []).map((d) => `<div class="wur-device"><img src="${esc(d.icon)}" alt="" draggable="false"><div><div class="wur-device-name">${esc(d.name)}</div><div class="wur-device-note">${esc(d.note)}</div></div></div>`).join('');
                    wrap.innerHTML = `
                        <div class="wur-banner"><img class="wur-icon" src="${SHIELD}" alt="" draggable="false"><div class="wur-instruction">${esc(o.instruction || 'Restart to finish installing updates')}</div></div>
                        <div class="wur-content">
                            <div class="wur-text">${esc(o.reason || S.reason)}</div>
                            ${rows ? `<div class="wur-devices">${rows}</div>` : ''}
                        </div>
                        <div class="wur-footer">
                            <button type="button" class="tbp-ctl tbp-button" data-wur="ok" data-dialog-primary="1">${esc(o.ok || 'Restart Now')}</button>
                            <button type="button" class="tbp-ctl tbp-button" data-wur="later">${esc(o.later || 'Later')}</button>
                        </div>`;
                    c.content.appendChild(wrap);
                    wrap.addEventListener('click', (ev) => {
                        const b = ev.target.closest('[data-wur]');
                        if (b) done(b.dataset.wur === 'ok');
                    });
                    c.modal.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); done(false); } });
                },
                cancel: () => done(false)
            });
            if (!confirmCtx) resolve(true);
        });
    }

    root.melatonRestartPrompt = { schedule, scheduleAuto, afterInstall, show, cancel, settings, save, confirmRestart };
})(typeof window !== 'undefined' ? window : globalThis);
