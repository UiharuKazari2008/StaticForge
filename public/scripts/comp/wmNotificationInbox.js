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
 *
 * Since #876 the server also raises mail, text messages, Dreamscape Messenger, Director, prints and
 * weather (modules/notificationInboxSources.js) with the ids the apps use themselves (mail:<account>:
 * <folder>:<uid>, sms:<account>:<chat>, chat:<chatId>, wx:/rain:<place>...). A missed one of those goes
 * into its app's own grouped notification (wmMessaging / wmChatApp inboxAdopt: the same title, lines,
 * icon and sound class), and the apps clear the id when their note is dismissed or the item is read.
 *
 * Calendar and task reminders (#876) have no page app that raises them: the server's reminder
 * scheduler (modules/reminderScheduler.js) publishes a 'reminder' notice when one comes due, and this
 * module shows it, live or on resume, as Windows Mobile's reminder notification - the one wmLock65
 * draws for alarms ("12:03 | Reminder", the subject in bold over its time and location, Dismiss |
 * Menu with Dismiss All, Remind 5 mins before, the Snooze items and View Item), with the Reminders
 * sound class. A reminder stays until it is dismissed (it shows again on resume while it is not):
 * Dismiss clears it (the phones' Android copy goes too), Snooze asks the server to bring it back later
 * (reminder_snooze), View Item opens the appointment or the task.
 */
(function () {
    'use strict';

    const MOBILE = window.uiShell === 'mobile' && document.documentElement.classList.contains('ui-mobile');
    if (!MOBILE) return;
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    const connectedAt = Date.now();
    let ws = null;
    let wired = false;
    const shownNotes = new Map(); // inbox id -> the appNote handle
    const seenAcked = new Set(); // inbox ids this session has already acked 'seen'
    // #890 W2: after the first full list, inbox_list { since } returns only the rows created or changed
    // after the newest one held (a server that answers with `total` does; others get the full list)
    let listedUpTo = 0;
    let sinceOk = false;
    const reminders = new Map(); // reminder id -> notice, while it is not dismissed (shown again when not up)

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
        // gone from the server's list: the title bar's "waiting" goes with it now, not at the status task's next refresh
        if (state === 'cleared' || state === 'acted') { try { if (ws && typeof ws.noticeGone === 'function') ws.noticeGone(); } catch (_) { /* no shell */ } }
    }

    /** Open the app a notice came from (its data.open names the app's own layer / direction). */
    function openFor(notice) {
        const d = notice.data || {};
        const app = d.app || notice.app;
        if (app === 'lapis' && window.wmLapis) { window.wmLapis.open(d.open || undefined); return; }
        if (app === 'traffic' && window.wmTraffic) { window.wmTraffic.open(d.open || undefined); return; }
        // Melaton Videos: a channel went live (data.open = 'kick:<channel>'): the program, on that stream
        if (app === 'youtube' && window.wmYouTube) { window.wmYouTube.open(d.open || undefined); return; }
        if (app === 'weather' && window.wmWeather && typeof window.wmWeather.open === 'function') { window.wmWeather.open(); return; }
        if (window.wmShell && app) { try { window.wmShell.open(app); return; } catch (_) { /* no such app */ } }
    }

    /** The app that groups this kind of notice in a notification of its own (mail, texts, Messenger). */
    function adopter(notice) {
        const kind = notice.data && notice.data.kind;
        if (kind === 'mail' && window.wmMessaging && typeof window.wmMessaging.inboxAdopt === 'function') return window.wmMessaging;
        if ((kind === 'sms' || kind === 'chat') && window.wmChatApp && typeof window.wmChatApp.inboxAdopt === 'function') return window.wmChatApp;
        return null;
    }

    const ICON_BY_CLASS = {
        mail: 'status-mail', sms: 'status-sms', chat: 'status-messenger', director: 'status-director', print: 'status-prints', 'print-error': 'status-prints',
        'weather-alert': 'status-weather-alert', 'weather-severe': 'status-weather-alert', 'rain-alarm': 'status-rain-alarm'
    };
    // the title bar glyph: the registration's (status-order.js, HARD rule status-icons-registered-only), never an app's picture
    function iconFor(notice) {
        const tbl = window.CafeTasks && window.CafeTasks.lib && window.CafeTasks.lib.statusOrder;
        if (tbl && tbl.noteGlyph) return tbl.noteGlyph(notice);
        return ICON_BY_CLASS[notice.cls] || 'status-notify-many';
    }

    // ---- reminders (#876) ----------------------------------------------------------------------

    const isReminder = (n) => !!n && n.cls === 'reminder' && /^rem:/.test(String(n.id || ''));

    /** View Item: the appointment's summary in Calendar, the task's in Tasks. */
    async function openReminderItem(notice) {
        const d = notice.data || {};
        if (d.app === 'tasks' || d.task) { if (window.wmTasks && typeof window.wmTasks.open === 'function') window.wmTasks.open(d.uid); return; }
        const cal = window.wmCalendar;
        if (!cal) { openFor(notice); return; }
        try { await cal.reload(); } catch (_) { /* shown as it is */ }
        const at = Number(d.start) || 0;
        const hit = (cal.occurrences(new Date(at - 60000), new Date(at + 60000)) || []).find((o) => o.ev && o.ev.uid === d.uid && +o.start === at);
        cal.openEvent(hit || null);
    }

    function snooze(notice, opts) {
        close(notice.id);
        const c = client();
        if (!c) return;
        try { c.sendMessage('reminder_snooze', Object.assign({ id: notice.id }, opts), false); } catch (_) { /* offline: it stays as the server holds it */ }
    }

    /** The reminder's Menu, as the device lists it (wmLock65 alarmMenu, with the item to open). */
    function reminderMenu(notice) {
        const d = notice.data || {};
        const before = !d.task && !d.allDay && Number(d.start) ? Number(d.start) - 5 * 60000 : 0;
        const later = (label, minutes) => ({ label, action: () => snooze(notice, { minutes }) });
        return [
            { label: 'Dismiss All', action: () => [...shownNotes.keys()].filter((id) => /^rem:/.test(id)).forEach((id) => { ack(id, 'cleared'); close(id); }) },
            before > Date.now() ? { label: 'Remind 5 mins before', action: () => snooze(notice, { at: before }) } : { label: 'Remind 5 mins before', disabled: true },
            later('Snooze 5 minutes', 5), later('Snooze 10 minutes', 10), later('Snooze 15 minutes', 15),
            later('Snooze 1 hour', 60), later('Snooze 1 day', 1440),
            '-',
            { label: 'View Item', action: () => { ack(notice.id, 'acted'); close(notice.id); openReminderItem(notice); } }
        ];
    }

    /** A notice's Menu (melatonBars NOTE_MENU has the same rows for the app's own box). */
    function noticeMenu(notice) {
        const later = (label, minutes) => ({ label, action: () => snooze(notice, { minutes }) });
        return [
            { label: 'View', action: () => { ack(notice.id, 'acted'); close(notice.id); openFor(notice); } },
            { label: 'Hide', action: () => close(notice.id) },
            '-',
            later('Snooze 5 minutes', 5), later('Snooze 15 minutes', 15), later('Snooze 1 hour', 60), later('Snooze 1 day', 1440)
        ];
    }

    /** Windows Mobile's reminder notification for a calendar / task reminder. */
    function showReminder(notice, opts = {}) {
        if (!ws || typeof ws.appNote !== 'function' || shownNotes.has(notice.id)) return;
        const d = notice.data || {};
        const lines = String(notice.text || '').split('\n');
        const subject = d.subject || lines[0] || 'No Subject';
        const rest = [d.when, d.location].filter(Boolean);
        const more = rest.length ? rest : lines.slice(1);
        const note = ws.appNote({
            title: notice.title || 'Reminder',
            // the hidden mark keeps two reminders of the same minute and subject two notifications ("1 of 2")
            html: `<span class="wm-alarm651-note"><b>${esc(subject)}</b>${more.map((l) => `<br>${esc(l)}`).join('')}<span hidden>${esc(notice.id)}</span></span>`,
            icon: 'status-reminder',
            event: 'reminder',
            silent: !!opts.quiet,
            softKeys: () => ({
                left: { label: 'Dismiss', icon: 'dismiss', action: () => { ack(notice.id, 'cleared'); close(notice.id); } },
                right: { label: 'Menu', icon: 'menu', menu: () => reminderMenu(notice) }
            })
        });
        if (!note) return;
        shownNotes.set(notice.id, note);
        pageShown(notice.id);
        ack(notice.id, 'seen');
    }

    /**
     * This page showed the notice (its own note, or the producing app's): the Android app does not post it too. The app
     * posts any notice a page in front does not confirm within seconds (#908: a frozen page never swallows a notice).
     */
    // notices only the server raises (no page app shows its own live note for them): the inbox shows them itself
    // test: the test lane's notices (modules/testDevices.js, the emulator harness) have no page producer either
    // director: the turn-finished notice (wmShell no longer posts one of its own: it was a second notification, #997)
    const SERVER_ONLY_KINDS = new Set(['dovecote', 'system', 'question', 'emotion', 'api-key', 'test', 'director']);

    let iconPrefsSent = '';
    function sendIconPrefs() {
        const c = window.wsClient;
        if (!canUse() || !c || typeof c.sendMessage !== 'function') return;
        let mailAll = false; let smsAll = false;
        try { mailAll = localStorage.getItem('wmMailIconAll') === '1'; smsAll = localStorage.getItem('wmSmsIconAll') === '1'; } catch (_) { /* defaults */ }
        const key = `${mailAll}|${smsAll}`;
        if (key === iconPrefsSent) return;
        iconPrefsSent = key;
        void Promise.resolve(c.sendMessage('phone_status_prefs', { mailAll, smsAll }, false)).catch(() => { iconPrefsSent = ''; });
    }

    function pageShown(id) {
        try { const A = window.AndroidInbox; if (A && typeof A.shown === 'function') A.shown(String(id)); } catch (_) { /* no app */ }
    }

    /** Show one missed notice as a WM notification; View opens its app, Dismiss clears it. */
    function show(notice, opts = {}) {
        if (isReminder(notice)) { showReminder(notice, opts); return; }
        if (!ws || typeof ws.appNote !== 'function' || shownNotes.has(notice.id)) return;
        // its app's own grouped notification (it clears the id when dismissed or read)
        const app = adopter(notice);
        if (app) {
            let taken = false;
            // live: no page app raised it (a snoozed text back at its time): its app's note sounds, also in the Android app
            try { taken = app.inboxAdopt(notice, { live: !!opts.live }) !== false; } catch (_) { taken = false; }
            if (taken) {
                shownNotes.set(notice.id, { close() { try { if (typeof app.inboxDrop === 'function') app.inboxDrop(notice); } catch (_) { /* gone */ } } });
                pageShown(notice.id);
                ack(notice.id, 'seen');
                return;
            }
        }
        const note = ws.appNote({
            title: notice.title,
            html: esc(notice.text || '').replace(/\n/g, '<br>'),
            icon: iconFor(notice),
            event: notice.cls || 'notification',
            // asked for (the notification icon's tap): shown without its sound - it is no news
            silent: !!opts.quiet,
            // 6.5.1's reminder keys on every notice (Yukimi, Nov 18): Dismiss | Menu, the Menu with View, Hide and the
            // reminder's Snooze times (the server brings the notice back then, sounding); the app's own box has the same
            softKeys: () => ({
                left: { label: 'Dismiss', icon: 'dismiss', action: () => { ack(notice.id, 'cleared'); close(notice.id); } },
                right: { label: 'Menu', icon: 'menu', menu: () => noticeMenu(notice) },
            }),
        });
        if (!note) return;
        shownNotes.set(notice.id, note);
        pageShown(notice.id);
        ack(notice.id, 'seen');
    }

    // the page's notification boxes (showGlassToast ids toast-<n>): the newest number, and whether one carries a title
    function toastSeq() {
        let n = 0;
        document.querySelectorAll('[id^="toast-"]').forEach((e) => { const v = parseInt(e.id.slice(6), 10); if (v > n) n = v; });
        return n;
    }
    function toastTitled(title) {
        const t = String(title || '').trim();
        return !!t && [...document.querySelectorAll('[id^="toast-"] .toast-title')].some((e) => e.textContent.trim() === t);
    }

    /**
     * A notice whose page app raises its own live note (Lapis, Traffic, Messaging...): told to the Android app as shown only
     * once a note is really up - one with its title (the app's broadcast usually comes just before the inbox's), or a new one
     * within PRODUCER_MS, or its app adopting it. Else the page's app did not show it (not loaded, no live note for that
     * source) and it is shown here; before, it was confirmed unseen and the Android app, told it was shown, posted nothing
     * either (StaticForge #913). Within the app's PAGE_MS (4 s): a page that answers nothing still gets it posted natively.
     */
    const PRODUCER_MS = 1500;
    // the notices a page app was seen to show itself (producerShows): only those count as shown without this module
    const producerShown = new Set();
    function producerShows(notice) {
        const before = toastSeq();
        setTimeout(() => {
            if (document.hidden || shownNotes.has(notice.id)) return;
            if (toastTitled(notice.title) || toastSeq() > before) { producerShown.add(notice.id); pageShown(notice.id); ack(notice.id, 'seen'); return; }
            show(notice, { live: true });
        }, PRODUCER_MS);
    }

    function close(id) {
        const note = shownNotes.get(id);
        if (note) { try { note.close(); } catch (_) { /* gone */ } shownNotes.delete(id); }
    }

    /**
     * List the inbox and show what arrived while the app was away (state 'new'); mark the other new ones
     * seen (a notice already seen is not acked again: #890, every 'seen' row was re-acked at each boot).
     * After the first list only what changed since the newest row held comes (#890 W2).
     */
    async function catchUp() {
        if (!canUse() || !client() || document.hidden) return;
        let r = null;
        try { r = await ask('inbox_list', sinceOk && listedUpTo ? { since: listedUpTo } : {}); } catch (_) { return; }
        const notices = (r && r.notices) || [];
        if (r && typeof r.total === 'number') sinceOk = true;
        for (const n of notices) {
            const at = Number(n.updatedAt) || Number(n.createdAt) || 0;
            if (at > listedUpTo) listedUpTo = at;
            if (n.state === 'cleared' || n.state === 'acted') { reminders.delete(n.id); close(n.id); continue; }
            // a reminder stays until it is dismissed: shown again whenever it is not up
            if (isReminder(n)) { reminders.set(n.id, n); showReminder(n); continue; }
            // arrived while the app was away: show it. Arrived live (while we were here): seen only when its app was seen
            // to show it - a page asleep in the background showed nothing, and its notices were marked seen unseen (the
            // Lapis notices never came up, Nov 18)
            if (n.state === 'new' && n.createdAt < connectedAt) show(n);
            else if (n.state === 'new') { if (producerShown.has(n.id) || shownNotes.has(n.id)) ack(n.id, 'seen'); else show(n); }
        }
        // reminders listed before and still not dismissed (a delta leaves them out): up again when not up
        reminders.forEach((n) => showReminder(n));
    }

    function onUpdated(pk) {
        const d = (pk && (pk.data || pk)) || {};
        if (d.reason === 'ack' && (d.state === 'cleared' || d.state === 'acted')) { reminders.delete(d.id); close(d.id); return; }
        if (d.reason === 'new' && d.notice) {
            // a new event under an id already used (the next turn's director:<session>:turn, the next text in a chat): the
            // server set it back to new, so it is acked seen again and its app must be seen to show it again. Kept from the
            // last one, the ack was skipped and the notice stayed new, to show again at the next resume or reconnect
            if (d.notice.alert) { seenAcked.delete(d.notice.id); producerShown.delete(d.notice.id); }
            // a reminder has no page app to raise it: shown here, live (also in the background, so it
            // is up on resume; the app does not post it while this page is connected)
            if (isReminder(d.notice)) { reminders.set(d.notice.id, d.notice); showReminder(d.notice); return; }
            // live and in the foreground: the producing app shows it; just keep it from reappearing.
            // not in the foreground (a background tick): leave it 'new' so it shows on resume.
            // a kind no page app raises live (the household mailbox, server notices, #908): shown here
            const kind = d.notice.data && d.notice.data.kind;
            // a class shown without a message (Display message on screen off) is stored seen: nothing to show
            if (!document.hidden && SERVER_ONLY_KINDS.has(kind)) { if (!d.notice.state || d.notice.state === 'new') show(d.notice); return; }
            if (!document.hidden) producerShows(d.notice);
        }
    }

    function wire() {
        const c = window.wsClient;
        if (wired || !c || typeof c.on !== 'function') return !!wired;
        wired = true;
        c.on('inbox_updated', onUpdated, { signal: appScopeSignal });
        // Messaging's "icon for any unread" choices, for the status icons the server works out (#908): once per link
        c.on('connected', sendIconPrefs, { signal: appScopeSignal });
        sendIconPrefs();
        c.on('connected', () => catchUp(), { signal: appScopeSignal });
        catchUp();
        return true;
    }

    function register() {
        ws = window.wmShell;
        // awake again (back from an Android program, the tab shown, the screen on): what changed while the
        // page slept - a sleeping page is not sent other devices' acks (#890 W7), it lists what changed
        document.addEventListener('wmawake', (e) => { if (e.detail && e.detail.awake) catchUp(); }, { signal: appScopeSignal });
        // websocket.js (window.wsClient) loads before this file; should it not have, every script has run by 'load'
        if (!wire()) window.addEventListener('load', () => { wire(); }, { once: true, signal: appScopeSignal });
    }

    window.wmNotificationInbox = {
        /** Re-list the inbox and show what was missed (also runs on connect and on resume). */
        catchUp,
        /** An app's notice is done with (read, opened or dismissed): cleared here, elsewhere and on Android. */
        clear: (id) => { if (!id) return; shownNotes.delete(id); ack(String(id), 'cleared'); },
        /** An app's notice was used (View / Reply). */
        acted: (id) => { if (!id) return; shownNotes.delete(id); ack(String(id), 'acted'); },
        shown: () => [...shownNotes.keys()],
        /**
         * Snooze from an app's own grouped note (Text Messages, Dreamscape Messenger: 6.5.1's reminder rows on every
         * notification, Nov 18): each notice goes now and the server's reminder scheduler publishes it again, sounding,
         * in `minutes` (reminder_snooze; the page holds no timer, the phone's app posts it when the page is asleep).
         */
        snooze: (ids, minutes) => {
            const c = client();
            if (!c) return false;
            for (const id of new Set([].concat(ids || []).map(String).filter(Boolean))) {
                shownNotes.delete(id);
                try { c.sendMessage('reminder_snooze', { id, minutes }, false); } catch (_) { /* offline: it stays as the server holds it */ }
            }
            return true;
        },
        /**
         * The notices still waiting on the server (new, or put away with Hide; not mail / texts / Messenger / Director,
         * which have icons of their own) shown again as notifications: the title bar's notification icon stands for them
         * (the app's status task), and a tap on it opened nothing while this page held none (Nov 18). Resolves the count.
         */
        showWaiting: async () => {
            let r = null;
            try { r = await ask('inbox_list', {}); } catch (_) { return 0; }
            // the same as the phones' "..." count (phoneStatus): not seen yet, or seen within the last day
            const dayAgo = Date.now() - 24 * 3600 * 1000;
            const waiting = ((r && r.notices) || []).filter((n) => (n.state === 'new' || (n.state === 'seen' && (Number(n.updatedAt) || Number(n.createdAt) || 0) >= dayAgo)) && !/^(mail|dmail|sms|chat|director):/.test(n.id));
            for (const n of waiting) {
                // asked for: each comes up again, also one shown before and put away (its old handle kept it from showing;
                // the tap then opened nothing, Nov 18 Fold)
                close(n.id);
                if (isReminder(n)) { reminders.set(n.id, n); showReminder(n, { quiet: true }); continue; }
                show(n, { quiet: true });
            }
            return waiting.length;
        },
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
