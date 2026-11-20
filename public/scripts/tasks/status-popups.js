/*
 * CafeTasks.lib.statusPopups: the popup of every registered status icon, as portable task code (Yukimi, Nov 18 2026,
 * HARD rule status-icons-registered-only: "it has to have its portable code for its display, handler, etc."). The
 * Android app's status-bar task builds them from the server's snapshot and the phone's own state, so a tap on any
 * icon shows its popup drawn by the app itself - page asleep, killed or never opened, and Melaton never opens for it
 * (Nov 18: a tap opened the desktop on DeX). The page's own richer drawing (melaton-bars-native-layouts) is used first
 * when the app holds one; this is the registration's guaranteed popup.
 *
 * A popup is NativeBubble's description: { title, role, sec: [ { t: 'text', s, b, first } | { t: 'pair', l, r: [{ s, b }],
 * bars } | { t: 'links', s, links: [label], right } | { t: 'rule' } ], foot: [label], buttons: [{ text }] }. A link or foot
 * label is done where the page's popup does it (the app opens Melaton on the screen tapped, with role and label).
 *
 * Inputs: f = the status snapshot's fields, n = the phone's own state (status-bar task native + sys: battery,
 * bluetooth, cell, wifi, airplane, ringer, sent by the app when a popup of the phone's own icons opens), now = Date.
 */
(function (root) {
    'use strict';
    const C = root.CafeTasks || (root.CafeTasks = { lib: {} });
    if (!C.lib) C.lib = {};

    const text = (s, b) => ({ t: 'text', s: String(s), b: !!b, first: true });
    const links = (labels, right) => ({ t: 'links', s: '', links: labels, right: !!right, first: true });
    const pop = (role, title, sec, foot) => ({ title, role, sec, foot: foot || [], buttons: [{ text: 'Hide' }] });
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const hhmm = (ms) => { const d = new Date(ms); return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`; };

    /**
     * Whether the phone itself is online, from its own readings (sys): false with Flight Mode or no Wi-Fi and no mobile
     * data, true with either, null when the app sent none (Yukimi, Nov 20 2026: say the real issue, not "no internet").
     */
    function nsOnline(n) {
        const s = n && n.sys;
        if (!s) return null;
        if (s.airplane) return false;
        const w = s.wifi;
        const c = s.cell;
        if (!w && !c) return null;
        return !!((w && w.connected) || (c && /^connected/i.test(String(c.state || ''))));
    }
    const nsDown = (n) => {
        const on = nsOnline(n);
        if (on === false) return 'No Internet access.';
        if (on) return 'Cannot connect to the Nightshade server.';
        return 'Not connected.';
    };

    const builders = {
        // the "..." group: the app's own tray of waiting notices and folded icons (MelatonBars.showNoticeTray); this is
        // its popup when neither is there
        notify(f) {
            const list = (f.notices && f.notices.list) || [];
            if (!list.length) return pop('notify', 'Notifications', [text('No notifications.')]);
            return pop('notify', 'Notifications', list.slice(0, 4).map((n) => text(n.title || 'Dreamscape', true)).concat([links(['Open'])]));
        },
        mail(f) {
            const m = f.mail || {};
            const lines = [text(m.fresh > 0 ? plural(m.fresh, 'new message', 'new messages') : m.unread > 0 ? plural(m.unread, 'unread message', 'unread messages') : 'No new messages.')];
            return pop('mail', 'Messages', lines.concat([links(['Open'])]));
        },
        sms(f) {
            const m = f.sms || {};
            const lines = [text(m.fresh > 0 ? plural(m.fresh, 'new text message', 'new text messages') : m.unread > 0 ? plural(m.unread, 'unread text message', 'unread text messages') : 'No new text messages.')];
            return pop('sms', 'Text Messages', lines.concat([links(['Open'])]));
        },
        chat(f) {
            const n = (f.chat && f.chat.fresh) || 0;
            return pop('chat', 'Dreamscape Messenger', [text(n ? plural(n, 'new reply', 'new replies') : 'No new replies.'), links(['Open'])]);
        },
        director(f) {
            const d = f.director || {};
            return pop('director', 'Director', [text(d.running ? 'The Director is working.' : 'The Director is idle.'), links(['Open'])]);
        },
        prints(f) {
            const n = (f.prints && f.prints.phone) || 0;
            return pop('prints', 'Prints', [text(n ? `${plural(n, 'print', 'prints')} from this phone queued or running.` : 'No prints running.'), links(['Open'])]);
        },
        wxalert(f) {
            const w = f.weather || {};
            const lines = (w.alertLines || []).map((l) => text(l, true));
            if (!lines.length) lines.push(text(w.alerts ? plural(w.alerts, 'weather alert', 'weather alerts') + ' at Home / Work.' : 'No weather alerts.'));
            return pop('wxalert', 'Weather Alert', lines.concat([links(['View Alerts'])]));
        },
        rain(f) {
            const w = f.weather || {};
            const lines = (w.rainLines || []).map((l) => text(l));
            if (!lines.length) lines.push(text(w.rain ? 'Rain is due.' : 'No rain due.'));
            return pop('rain', 'Rain Alarm', lines.concat([links(['Open Weather'])]));
        },
        carkey(f, n, now) {
            const lines = [];
            const until = (f.lapis && f.lapis.until) || 0;
            if (until > now.getTime()) lines.push(text(`Remote start: running until ${hhmm(until)}.`, true));
            if (n.driving) lines.push(text('Driving.'));
            else if (n.carKey) lines.push(text('The car key sees the car.'));
            const t = f.traffic;
            const sb = C.lib.statusBar;
            const dir = t && sb && sb.leaveWindow ? sb.leaveWindow(t, now) : null;
            if (dir) {
                const d = dir === 'work' ? t.delayWork : t.delayHome;
                lines.push(text(`To ${dir === 'work' ? 'Work' : 'Home'}${d != null ? (d >= 60 ? `: ${Math.round(d / 60)} min late` : ': on time') : ''}.`));
            }
            if (!lines.length) lines.push(text('Nothing running.'));
            return pop('carkey', 'Car', lines.concat([links(['Open'])]));
        },
        received(f) {
            const k = (f.received && f.received.unseen) || 0;
            return pop('received', 'ActiveSync', [text(k ? `${plural(k, 'item', 'items')} received.` : 'Nothing new received.'), links(['Open'])]);
        },
        update() {
            return { title: 'Updates', role: 'update', sec: [text('Updates are waiting to install.')], foot: [], buttons: [{ text: 'Install Now' }, { text: 'Later' }] };
        },
        continuity(f, n) {
            return pop('continuity', 'Continuity PC', [text(n.dex ? (n.dexReady === false ? 'The DeX window is starting.' : 'This phone carries the DeX window.') : 'No DeX window.')]);
        },
        nightshade(f, n) {
            return pop('nightshade', 'Nightshade Network', [text(n.link === false ? `${nsDown(n)} The phone shows what it last had.` : 'Connected.'), links(['Reconnect'])], ['Settings']);
        },
        // the phone's own icons, from what the app sends as their popup opens (sys)
        data(f, n) {
            const s = n.sys || {};
            const sec = [links(['Wireless Manager'], true), { t: 'rule', first: true }];
            if (s.bluetooth != null) sec.push(text(`Bluetooth: ${!s.bluetooth ? 'Power Off' : s.bluetoothConnected ? 'Connected' : 'On'}`));
            const w = s.wifi;
            if (w) sec.push({ t: 'pair', l: `Wi-Fi: ${w.on === false ? 'Power Off' : w.connected ? (w.ssid || 'Connected') : 'Disconnected'}`, lb: false, r: [], bars: w.connected && Number.isFinite(w.level) ? Math.max(0, Math.min(4, w.level)) : null, first: true });
            const c = s.cell;
            if (c) sec.push({ t: 'pair', l: `Mobile Broadband: ${c.state || 'Available'}`, lb: false, r: c.type ? [{ s: c.type, b: true }] : [], bars: Number.isFinite(c.level) ? Math.max(0, Math.min(5, c.level)) : null, first: true });
            if (n.link === false) sec.push(text(`Nightshade: ${nsOnline(n) === false ? 'No Internet access' : nsOnline(n) ? 'Cannot connect to the server' : 'Not connected'}`));
            return pop('data', 'Connectivity', sec, ['Settings']);
        // the notification standard (wmShell noteSoftKeys, Yukimi Nov 20 2026): what can be done is Install Now | Later,
        // never a link; Install Now is done in Melaton (its updater: Restart Now when the restart installs them), Later
        // closes the popup like Hide and the updates keep waiting on the icon
        },
        signal(f, n) {
            const s = n.sys || {};
            const c = s.cell || {};
            const line = s.airplane ? 'Flight Mode' : c.radioOn === false ? 'Phone off' : c.sim === 'absent' ? 'No SIM' : c.operator ? `${c.operator}${c.roaming ? ' (Roaming Service)' : ''}` : 'No Service';
            return pop('signal', 'Phone', [text(line), links(['Wireless Manager'], true)], ['Settings']);
        },
        bluetooth(f, n) {
            const s = n.sys || {};
            const lines = [text(s.bluetooth ? 'Bluetooth: On' : 'Bluetooth: Off')];
            if (s.bluetooth && s.bluetoothConnected != null) lines.push(text(s.bluetoothConnected ? 'A device is connected.' : 'No device is connected.'));
            lines.push(links(['Wireless Manager']));
            return pop('bluetooth', 'Bluetooth', lines, ['Settings']);
        },
        battery(f, n) {
            const b = (n.sys || {}).battery;
            if (!b) return pop('battery', 'Power', [text('Main battery: unknown')], ['Settings']);
            const via = { ac: 'external power', usb: 'USB', wireless: 'wireless charger', dock: 'dock' }[b.plugged];
            const lines = [text(`Main battery: ${b.level}%`), { t: 'progress', blocks: Math.round((b.level / 100) * 18), first: false }];
            if ((b.charging || via) && b.level >= 100) lines.push(text(`Fully charged${via ? `, on ${via}` : ''}.`));
            else if (b.charging) lines.push(text(`Charging${via ? ` from ${via}` : ''}.`));
            else if (via) lines.push(text(`On ${via}, not charging.`));
            else lines.push(text('On battery.'));
            return pop('battery', 'Power', lines, ['Settings']);
        },
        volume(f, n) {
            const r = (n.sys || {}).ringer;
            return pop('volume', 'Volume', [text(r === 'vibrate' ? 'Vibrate' : r === 'off' ? 'Off' : 'On')], ['Settings']);
        }
    };
    // one popup for the icons that share it
    const SAME = { roaming: 'signal', cell: 'signal', traffic: 'carkey', lapis: 'carkey' };

    C.lib.statusPopups = {
        roles: Object.keys(builders),
        has: (role) => !!builders[SAME[role] || role],
        /** The popup for a role, or null (an unregistered role has none and never shows). */
        build(role, f, n, now) {
            const b = builders[SAME[role] || role];
            if (!b) return null;
            try { return b(f || {}, n || {}, now || new Date()); } catch (_) { return null; }
        }
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
