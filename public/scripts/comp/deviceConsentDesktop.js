/**
 * Phone consent on the desktop (Yozora #1305, StaticForge #1284): an agent asks to use one of Yukimi's phones and she
 * answers Allow or Deny here as well as on the phone. The question is the server's inbox notice device-ask:<lease>
 * (cls 'notification', app 'claudedesk', data.buttons Allow / Deny, data.answerType 'device_consent_answer'); this file
 * shows each pending one as a tray balloon on Melaton Mobile Device Center's icon (the phones' own icon; the desktop has
 * no Fleet icon), with Allow and Deny as Vista push buttons inside it.
 *
 *   events    inbox_updated {reason 'new', notice} raises or updates one, {reason 'ack', id, state 'cleared'} takes it
 *             down (also when it was answered on the phone); inbox_list once at connect (and at each reconnect) for the
 *             ones already waiting. No timer, no polling.
 *   balloon   one per notice id, one at a time on the icon (the oldest waiting first; "N more wait" under it). Its sound is
 *             the desktop scheme's Notify, once per notice, only when the server says alert true on a live push (a
 *             question found on connect is silent: it sounded where it arrived). A click on the balloon opens Fleet's
 *             Device Queue (page 'devices'); the X, a click or its time only close it: the question stays on that page.
 *   answer    Allow / Deny send device_consent_answer { id, answer } on a real user click only (an untrusted, scripted
 *             click is ignored: the server refuses answers an agent drove). ok closes the balloon; ok false is told in
 *             the balloon (Vista's warning look) and it closes by itself; a send that never arrived keeps the buttons.
 *   in use    the notice device-hold:<device> is not a balloon (silent status): it is on the Device Queue page.
 *
 * Desktop tabs only (not the phone shell, the Android app or an agent tab). Everything from a notice is escaped.
 * Notifications settings can switch the balloons off ('device-consent', trayPopupHidden): then nothing shows or sounds.
 * Test: scripts/test-device-consent-desktop.js.
 */
(function (root) {
    'use strict';
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    if (typeof document === 'undefined') return;

    const ASK = 'device-ask:';
    const ANCHOR_ID = 'activeSyncTrayIcon';
    const POPUP_ID = 'device-consent';
    const ASK_ART = '/static_images/activesync/activesync-32.png';
    const WARN_ART = '/static_images/vista-icons/warning-32.png';
    const ASK_MS = 45000; // a question stays up longer than a plain balloon (counted in the user's presence)
    const ERROR_MS = 8000;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** A desktop tab: not the phone shell, the Android app or an agent tab (activeSyncAgent's rule). */
    function isDesktopTab() {
        if (root.uiShell === 'mobile') return false;
        if (root.activeSync && root.activeSync.kind !== 'computer') return false;
        try { if (new URLSearchParams(root.location.search).get('agent') === '1') return false; } catch (_) { /* no location */ }
        return root.isDesktop !== false;
    }
    // the household's own notices (the server sends the inbox to admins only)
    const canUse = () => { try { return /^(admin|dev_admin)$/.test(localStorage.getItem('userType') || ''); } catch (_) { return false; } };
    const popupsOn = () => { try { return !(typeof root.trayPopupHidden === 'function' && root.trayPopupHidden(POPUP_ID)); } catch (_) { return true; } };

    const asks = new Map(); // notice id -> { notice, hidden, busy, note } (hidden: its balloon was closed; the question stays on the Device Queue)
    const sounded = new Set(); // notice ids that already sounded: never twice
    let view = null; // what the balloon shows now: { id, kind: 'ask' | 'error' }
    let revealed = false; // the tray icon was hidden and shown for a balloon
    let wired = false;

    const client = () => (root.wsClient && (typeof root.wsClient.isConnected !== 'function' || root.wsClient.isConnected()) ? root.wsClient : null);
    async function request(type, payload) {
        const c = client();
        if (!c || typeof c.sendMessage !== 'function') throw new Error('Not connected to Dreamscape');
        // this file shows a server error itself: no desktop "Unhandled exception" window as well (wsClient.handlesErrors)
        const r = await (typeof c.handlesErrors === 'function' ? c.handlesErrors(() => c.sendMessage(type, payload || {}, false)) : c.sendMessage(type, payload || {}, false));
        return r && r.ok === undefined && r.data && typeof r.data === 'object' ? r.data : (r || {});
    }

    function openFleet() {
        if (root.melatonApps && typeof root.melatonApps.launch === 'function') void root.melatonApps.launch({ packageId: 'claudedesk', args: { page: 'devices' } });
    }

    function anchor() {
        const el = document.getElementById(ANCHOR_ID);
        return el && el.isConnected ? el : null;
    }
    function reveal(el) {
        if (!el.classList.contains('hidden')) return;
        revealed = true;
        if (typeof root.revealTrayIconElement === 'function') root.revealTrayIconElement(el); else el.classList.remove('hidden');
    }
    /** The icon the balloon showed is put away again when Device Center has no phone of its own to show. */
    function restoreIcon() {
        if (!revealed || view) return;
        revealed = false;
        const el = anchor();
        if (!el) return;
        let known = 0;
        try { known = root.activeSync && typeof root.activeSync.state === 'function' ? ((root.activeSync.state().devices || []).filter((d) => d && (d.online || d.partner) && d.platform !== 'cafeready').length) : 0; } catch (_) { known = 0; }
        if (!known && !el.classList.contains('hidden')) el.classList.add('hidden');
    }

    /** The popover a balloon of this file is in (the icon's popover can be another program's balloon too). */
    function mine(el) {
        const pm = root.PopoverManager;
        const data = pm && pm.activePopovers && pm.activePopovers.get(el);
        return data && data.popover && data.popover.querySelector && data.popover.querySelector('[data-dcd-id], [data-dcd-error]') ? data : null;
    }

    function closeBalloon() {
        const el = anchor();
        const data = el && mine(el);
        view = null;
        if (data && root.PopoverManager) root.PopoverManager.hide(el); // (onHide ignores it: view is already null)
        restoreIcon();
    }

    const pick = () => { for (const e of asks.values()) if (!e.hidden) return e; return null; };

    function buttonsOf(e) {
        const list = Array.isArray(e.notice.data && e.notice.data.buttons) ? e.notice.data.buttons.filter((b) => b && b.id) : [];
        const buttons = list.length ? list : [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }];
        return buttons.slice(0, 3).map((b) => `<button type="button" class="btn-standard" data-dcd-id="${esc(e.notice.id)}" data-dcd-answer="${esc(b.id)}"${e.busy ? ' disabled' : ''}>${esc(b.label || b.id)}</button>`).join('&nbsp;');
    }

    /** Draw the balloon for one waiting question (in place when it is already up). */
    function draw(e) {
        const el = anchor();
        const pm = root.PopoverManager;
        if (!el || !pm || typeof pm.showPopover !== 'function' || !popupsOn()) return;
        const boot = root.desktopBoot;
        // not while the taskbar is hidden (logon, boot), not while another icon's balloon is up or a presentation holds them:
        // drawn from the current state when its turn comes, never from what it was when it queued
        if (boot && typeof boot.isTaskbarVisible === 'function' && !boot.isTaskbarVisible() && typeof boot.whenTaskbarVisible === 'function') { boot.whenTaskbarVisible(POPUP_ID, render); return; }
        const held = !!(root.melatonPresentation && typeof root.melatonPresentation.holdsBalloons === 'function' && root.melatonPresentation.holdsBalloons());
        if ((held || (typeof pm.trayBusy === 'function' && pm.trayBusy(el))) && typeof pm.whenTrayFree === 'function') { pm.whenTrayFree(POPUP_ID, render); return; }
        reveal(el);
        // notice: device-ask
        if (typeof root.trayNotePopup === 'function') root.trayNotePopup(POPUP_ID, 'Phone consent questions');
        const more = Array.from(asks.values()).filter((x) => !x.hidden && x !== e).length;
        const lines = String(e.notice.text || '').split('\n').filter(Boolean).map(esc);
        if (e.note) lines.push(esc(e.note));
        if (more) lines.push(esc(`${more} more ${more === 1 ? 'question waits' : 'questions wait'} in Fleet.`));
        const body = `${lines.join('<br>')}<br>${buttonsOf(e)}`;
        view = { id: e.notice.id, kind: 'ask' };
        // notice: device-ask
        pm.showPopover(el, 'info', esc(e.notice.title || 'An agent wants a phone'), body, false, ASK_MS,
            `<img src="${ASK_ART}" alt="" width="32" height="32" draggable="false">`, null,
            { popupId: POPUP_ID, position: 'top', arrowPosition: 'bottom-right', onClick: openFleet, onHide: (pop) => balloonHidden(pop, e) });
    }

    /** ok false from the server (already answered, lapsed): told in the balloon, which goes by itself. */
    function drawError(e, error) {
        const el = anchor();
        const pm = root.PopoverManager;
        if (!el || !pm || typeof pm.showPopover !== 'function' || !popupsOn()) { render(); return; }
        view = { id: e.notice.id, kind: 'error' };
        // notice: device-ask
        pm.showPopover(el, 'warning', esc(e.notice.title || 'Phone consent'), `<span data-dcd-error="1">${esc(error || 'The answer was not taken.')}</span>`, false, ERROR_MS,
            `<img src="${WARN_ART}" alt="" width="32" height="32" draggable="false">`, null,
            { popupId: POPUP_ID, position: 'top', arrowPosition: 'bottom-right', onClick: openFleet, onHide: (pop) => balloonHidden(pop, e) });
    }

    /** The balloon went (its time, the X, a click on it): that question is not drawn again; the next one comes up. */
    function balloonHidden(pop, e) {
        if (!view || view.id !== e.notice.id) return; // closed by this file, or another program's balloon took the icon
        if (pop && pop.querySelector && !pop.querySelector('[data-dcd-id], [data-dcd-error]')) return;
        const wasAsk = view.kind === 'ask';
        view = null;
        if (wasAsk && asks.get(e.notice.id) === e) e.hidden = true;
        restoreIcon();
        render();
    }

    /** What the balloon shows is the oldest question still waiting that was not closed. */
    function render() {
        if (!isDesktopTab() || !canUse()) return;
        if (view && view.kind === 'error') return; // its message is up until it goes by itself
        const e = pick();
        if (!e) { if (view) closeBalloon(); return; }
        draw(e);
    }

    function sound(id) {
        if (sounded.has(id)) return;
        sounded.add(id);
        if (sounded.size > 200) sounded.delete(sounded.values().next().value);
        // the desktop's own Notify (Personalization > Sounds can set it to None); once per question
        // notice: device-ask
        if (root.desktopSounds && typeof root.desktopSounds.play === 'function') root.desktopSounds.play('notify');
    }

    /** A question came (live: a push, so it may sound) or was found waiting (silent). */
    function take(notice, live) {
        const id = String((notice && notice.id) || '');
        if (!id.startsWith(ASK)) return;
        const kind = notice.data && notice.data.kind;
        if (kind && kind !== 'device-ask') return;
        if (notice.state === 'cleared' || notice.state === 'acted') { drop(id); return; }
        let e = asks.get(id);
        const changed = !!e && (e.notice.title !== notice.title || e.notice.text !== notice.text);
        if (e) e.notice = notice;
        else { e = { notice, hidden: false, busy: false, note: '' }; asks.set(id, e); }
        // the server's alert flag is the only thing that sounds; a switched-off balloon is a switched-off notice
        if (live && notice.alert === true && popupsOn() && isDesktopTab() && canUse() && !e.hidden) sound(id);
        if (!e.hidden && (!view || view.id !== id || changed)) render();
    }

    /** The question is dealt with (answered here or on the phone, lapsed): its balloon goes. */
    function drop(id) {
        if (!asks.delete(id)) return;
        // an error message in the balloon stays until it goes by itself
        if (view && view.id === id && view.kind === 'ask') { closeBalloon(); render(); } else if (!view) render();
    }

    async function answer(id, choice) {
        const e = asks.get(id);
        if (!e || e.busy) return;
        e.busy = true;
        e.note = '';
        draw(e);
        let reply = null;
        let failed = null;
        try { reply = await request('device_consent_answer', { id, answer: choice }); } catch (err) { failed = err; }
        e.busy = false;
        if (failed) {
            // it never arrived (no link, timed out): the keys stay, to press again
            e.note = 'Not sent. Try again.';
            if (asks.get(id) === e) draw(e);
            return;
        }
        if (reply && reply.ok === true) { drop(id); return; }
        // refused: the server clears the notice itself; the balloon says why and goes by itself
        asks.delete(id);
        drawError(e, reply && reply.error);
    }

    /** A click on Allow / Deny anywhere (the balloon's own click, which would close it and open Fleet, never sees it). */
    function onClick(ev) {
        const t = ev && ev.target;
        const b = t && typeof t.closest === 'function' ? t.closest('[data-dcd-answer]') : null;
        if (!b) return;
        ev.stopPropagation();
        ev.preventDefault();
        // a real click only: never a scripted one (the server refuses an answer an agent drove)
        if (ev.isTrusted !== true || b.disabled) return;
        void answer(String(b.dataset.dcdId || ''), String(b.dataset.dcdAnswer || ''));
    }

    async function list() {
        if (!canUse() || !isDesktopTab() || !client()) return;
        let r = null;
        try { r = await request('inbox_list', {}); } catch (_) { return; }
        const notices = ((r && r.notices) || []).filter((n) => n && String(n.id || '').startsWith(ASK) && n.state !== 'cleared' && n.state !== 'acted');
        const live = new Set(notices.map((n) => n.id));
        // answered or lapsed while this page was not linked
        Array.from(asks.keys()).forEach((id) => { if (!live.has(id)) drop(id); });
        notices.forEach((n) => take(n, false));
    }

    function onUpdated(pk) {
        if (!isDesktopTab() || !canUse()) return;
        const d = (pk && (pk.data || pk)) || {};
        if (d.reason === 'ack') {
            if ((d.state === 'cleared' || d.state === 'acted') && String(d.id || '').startsWith(ASK)) drop(String(d.id));
            return;
        }
        if (d.reason === 'new' && d.notice) take(d.notice, true);
    }

    function wire() {
        const c = root.wsClient;
        if (wired || !c || typeof c.on !== 'function') return !!wired;
        wired = true;
        c.on('inbox_updated', onUpdated, { signal: appScopeSignal });
        c.on('connected', () => { void list(); }, { signal: appScopeSignal });
        document.addEventListener('click', onClick, { capture: true, signal: appScopeSignal });
        // the first look after the desktop shows (the taskbar is visible), never before: the boot waits for nothing here
        const boot = root.desktopBoot;
        if (boot && typeof boot.whenTaskbarVisible === 'function') boot.whenTaskbarVisible('device-consent-list', () => { void list(); }); else void list();
        return true;
    }

    if (isDesktopTab()) {
        // websocket.js (window.wsClient) loads before this file; should it not have, every script has run by 'load'
        if (!wire()) root.addEventListener('load', () => { wire(); }, { once: true, signal: appScopeSignal });
    }

    root.deviceConsentDesktop = { list, _state: () => ({ asks, view, sounded }) };
})(typeof window !== 'undefined' ? window : globalThis);
