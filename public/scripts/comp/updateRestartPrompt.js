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
 *   window.melatonRestartPrompt = { schedule(delayMs), show(), cancel(), settings(), save(settings) }
 *   settings: localStorage melatonUpdateAutoRestart { auto, warnMin 1 | 5 | 15 }
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const KEY = 'melatonUpdateAutoRestart';
    const WARN = [1, 5, 15];
    // wucltux.dll.mui 1109 / 92 / 88 / 89: Remind me in 10 minutes, 1 hour, 4 hours (the last is Vista's default)
    const REMIND = [{ value: '10', text: '10 minutes' }, { value: '60', text: '1 hour' }, { value: '240', text: '4 hours' }];
    const ICON = '/static_images/vista-icons/windows-update-32.png';

    // Segoe UI 9 dialog units (x * 7/4, y * 15/8): 230 x 106 is Vista's 403 x 199 px dialog
    const TPL = {
        t: 'Melaton Update',
        w: 230,
        h: 106,
        f: ['Segoe UI', 9],
        s: 0x80C800C8,
        c: [
            [200, 'S', 9, 9, 18, 17, 0x50000003, '', 0],
            [101, 'S', 34, 8, 188, 18, 0x50020000, 'Restart your computer to finish installing important updates', 0],
            [102, 'S', 34, 30, 188, 26, 0x50020000, "Melaton can't update important files and services while the system is using them. Make sure to save your files before restarting.", 0],
            [103, 'S', 34, 58, 188, 9, 0x50020000, 'Restarting in: 5 min, 0 sec', 0],
            [104, 'S', 34, 73, 52, 9, 0x50020000, '&Remind me in:', 0],
            [105, 'C', 88, 71, 70, 60, 0x50210003, '', 0],
            [1, 'B', 108, 87, 58, 14, 0x50010001, 'Restart &now', 0],
            [2, 'B', 170, 87, 52, 14, 0x50010000, '&Postpone', 0]
        ]
    };

    function settings() {
        let v = null;
        try { v = JSON.parse(root.localStorage.getItem(KEY) || 'null'); } catch (_) { v = null; }
        const warnMin = v && WARN.includes(Number(v.warnMin)) ? Number(v.warnMin) : 5;
        return { auto: !v || v.auto !== false, warnMin };
    }

    function save(next) {
        const s = Object.assign(settings(), next || {});
        try { root.localStorage.setItem(KEY, JSON.stringify({ auto: !!s.auto, warnMin: s.warnMin })); } catch (_) { /* private mode */ }
        return s;
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

    function clearTimers() {
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

    /** The dialog (one at a time). The countdown runs only with the automatic restart on. */
    async function show() {
        if (ctx || !eligible()) return;
        const V = await kit();
        if (!V || typeof V.openDialog !== 'function' || ctx || !eligible()) return;
        const auto = settings().auto;
        let remind = '240';
        ctx = V.openDialog({
            id: 'melatonUpdateRestartDialog',
            tpl: TPL,
            icon: ICON,
            bareCaption: true,
            overrides: { 200: { image: ICON } },
            init: (c) => {
                const head = c.el(101);
                if (head) head.classList.add('vdt-main-instruction');
                c.options(105, REMIND, remind);
                c.on(105, 'change', () => { remind = String(c.get(105) || remind); });
                const line = c.el(103);
                if (!auto) {
                    if (line) line.hidden = true;
                    return;
                }
                deadline = Date.now() + settings().warnMin * 60 * 1000;
                c.text(103, countdownText(deadline - Date.now()));
                // the restart at the deadline (one timeout: it holds with the screen off, as Vista's does) ...
                deadlineTimer = setTimeout(() => restartNow(true), deadline - Date.now());
                // ... and the second tick of the text, drawn only while the page is seen
                tickTimer = setInterval(() => {
                    if (doc.hidden || doc.documentElement.dataset.screenOff !== undefined) return;
                    c.text(103, countdownText(deadline - Date.now()));
                }, 1000);
            },
            // Restart now (IDOK) / Postpone (IDCANCEL, also the caption's close)
            ok: () => { restartNow(false); },
            cancel: () => { const r = remind; ctx = null; clearTimers(); postpone(r); }
        });
        if (ctx && ctx.modal && typeof root.bringModalToFront === 'function') root.bringModalToFront(ctx.modal);
    }

    /** The updates are gone (installed live, or the restart runs): no prompt, no reminder. */
    function cancel() {
        clearTimers();
        if (ctx) { const c = ctx; ctx = null; try { c.close(); } catch (_) { /* gone */ } }
    }

    root.melatonRestartPrompt = { schedule, show, cancel, settings, save };
})(typeof window !== 'undefined' ? window : globalThis);
