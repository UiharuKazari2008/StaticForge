/**
 * Melaton Mobile: the notification inbox client (Yozora #845). The server keeps a durable inbox of the
 * notices producers raise (Lapis Remote, Traffic, ...); this shows what was missed while the app was
 * not running, and keeps the state in step so a notice seen or cleared here (or on another device, or
 * by the native Android notification) does not show again.
 *
 * - While the app is open and in the foreground, the producing app already shows each notice live
 *   (lapis_notice, traffic_report); this module only marks those 'seen' so they do not reappear.
 * - When the app is opened or comes back to the foreground, it lists the inbox and shows the notices
 *   that arrived while it was away and have not been cleared or acted on; each is a WM notification with
 *   a View key that opens the app it came from. Showing one marks it 'seen'; dismissing it 'cleared'.
 * - A notice cleared or acted on elsewhere (the server pushes inbox_updated) closes here too.
 *
 * The native app (DreamScapeForegroundService) reads the same inbox to post Android notifications while
 * the WebView is paused; nothing is mirrored to Android while the shell is up (toastManager keeps the
 * bridge off on the phone), so there is no double notification.
 */
(function () {
    'use strict';

    const MOBILE = window.uiShell === 'mobile' && document.documentElement.classList.contains('ui-mobile');
    if (!MOBILE) return;

    const connectedAt = Date.now();
    let ws = null;
    let wired = false;
    const shownNotes = new Map(); // inbox id -> the appNote handle
    const seenAcked = new Set(); // inbox ids this session has already acked 'seen'

    const canUse = () => { try { return /^(admin|dev_admin)$/.test(localStorage.getItem('userType') || ''); } catch (_) { return false; } };
    const client = () => (window.wsClient && (!window.wsClient.isConnected || window.wsClient.isConnected()) ? window.wsClient : null);
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    async function ask(type, payload, ms = 15000) {
        const c = client();
        if (!c) throw new Error('Not connected');
        const r = await Promise.race([
            c.sendMessage(type, payload || {}, false),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), ms)),
        ]);
        return r && r.data && typeof r.data === 'object' ? r.data : r;
    }

    function ack(id, state) {
        if (!id) return;
        if (state === 'seen') { if (seenAcked.has(id)) return; seenAcked.add(id); }
        try { const c = client(); if (c) c.sendMessage('inbox_ack', { id, state }, false); } catch (_) { /* offline: the server state stands */ }
    }

    /** Open the app a notice came from (its data.open names the app's own layer / direction). */
    function openFor(notice) {
        const d = notice.data || {};
        const app = d.app || notice.app;
        if (app === 'lapis' && window.wmLapis) { window.wmLapis.open(d.open || undefined); return; }
        if (app === 'traffic' && window.wmTraffic) { window.wmTraffic.open(d.open || undefined); return; }
        if (window.wmShell && app) { try { window.wmShell.open(app); return; } catch (_) { /* no such app */ } }
    }

    /** Show one missed notice as a WM notification; View opens its app, Dismiss clears it. */
    function show(notice) {
        if (!ws || typeof ws.appNote !== 'function' || shownNotes.has(notice.id)) return;
        const note = ws.appNote({
            title: notice.title,
            html: esc(notice.text || ''),
            icon: notice.data && notice.data.app === 'traffic' ? 'app-traffic' : notice.data && notice.data.app === 'lapis' ? 'app-lapis' : 'app-programs',
            event: notice.cls || 'notification',
            softKeys: () => ({
                left: { label: 'View', action: () => { ack(notice.id, 'acted'); close(notice.id); openFor(notice); } },
                right: { label: 'Dismiss', action: () => { ack(notice.id, 'cleared'); close(notice.id); } },
            }),
        });
        if (!note) return;
        shownNotes.set(notice.id, note);
        ack(notice.id, 'seen');
    }

    function close(id) {
        const note = shownNotes.get(id);
        if (note) { try { note.close(); } catch (_) { /* gone */ } shownNotes.delete(id); }
    }

    /** List the inbox and show what arrived while the app was away (state 'new'); mark the rest seen. */
    async function catchUp() {
        if (!canUse() || !client() || document.hidden) return;
        let notices = [];
        try { notices = (await ask('inbox_list', {})).notices || []; } catch (_) { return; }
        for (const n of notices) {
            if (n.state === 'cleared' || n.state === 'acted') { close(n.id); continue; }
            // arrived while the app was away: show it. Arrived live (while we were here): the producing
            // app already showed it, so only mark it seen.
            if (n.state === 'new' && n.createdAt < connectedAt) show(n);
            else ack(n.id, 'seen');
        }
    }

    function onUpdated(pk) {
        const d = (pk && (pk.data || pk)) || {};
        if (d.reason === 'ack' && (d.state === 'cleared' || d.state === 'acted')) { close(d.id); return; }
        if (d.reason === 'new' && d.notice) {
            // live and in the foreground: the producing app shows it; just keep it from reappearing.
            // not in the foreground (a background tick): leave it 'new' so it shows on resume.
            if (!document.hidden) ack(d.notice.id, 'seen');
        }
    }

    function wire() {
        const c = window.wsClient;
        if (wired || !c || typeof c.on !== 'function') return !!wired;
        wired = true;
        c.on('inbox_updated', onUpdated);
        c.on('connected', () => catchUp());
        catchUp();
        return true;
    }

    function register() {
        ws = window.wmShell;
        document.addEventListener('visibilitychange', () => { if (!document.hidden) catchUp(); });
        if (!wire()) { let n = 0; const t = setInterval(() => { if (wire() || ++n > 120) clearInterval(t); }, 1000); }
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
