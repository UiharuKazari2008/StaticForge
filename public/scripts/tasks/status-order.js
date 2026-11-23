/*
 * CafeTasks.lib.statusOrder (StaticForge #907): the status bar's icon table, one copy for the Melaton Mobile page
 * (wmShell.js fitStatusNow, loaded by app.html) and the Android app's CaféReady status-bar task (status-fit.js), so
 * both bars order and fold the same way. Shipped with a server deploy (the app fetches task files; no app build).
 *
 * Yukimi, Nov 17 2026:
 *   display   left to right ("..." first, the battery last). Car stands for the car key, remote start and the
 *             commute (one icon). Android's own tray icon is gone (the notification shade always pulls down).
 *   fold      the icons that may fold into "...", by how much each should be shown over another (first = shown
 *             longest, last = folds first). An icon not listed never folds.
 *   displace  the short-lived icons worth more than the volume and battery icons: to keep one of them out, those
 *             two step aside (as Settings > Screen > Sound Icon / Power Icon allow) before it folds. The rest fold
 *             first.
 *   system    the icons that step aside for a displacing icon, in that order.
 */
(function (root) {
    'use strict';
    const C = root.CafeTasks || (root.CafeTasks = { lib: {} });
    if (!C.lib) C.lib = {};

    // xmrec: XM Radio recording on the server (the tape; Yukimi, Nov 21 2026: before prints, folds before rain, does not
    // displace volume / battery)
    const display = ['notify', 'carkey', 'rain', 'wxalert', 'chat', 'mail', 'sms', 'xmrec', 'prints', 'director', 'received', 'update',
        'continuity', 'nightshade', 'bluetooth', 'data', 'cell', 'roaming', 'signal', 'volume', 'battery'];
    const fold = ['wxalert', 'update', 'prints', 'director', 'xmrec', 'rain', 'sms', 'chat', 'mail', 'carkey', 'received'];
    const displace = ['wxalert', 'update', 'prints', 'director', 'sms', 'chat'];
    const system = ['volume', 'battery'];

    /*
     * The registration (Yukimi, Nov 18 2026, HARD rule status-icons-registered-only): every icon either bar may draw,
     * as its WM 1-bit white glyph (public/static_images/wm61/<glyph>.png). A role or notice kind missing here draws
     * nothing; a notice never brings a picture of its own (an app's colour icon in the bar was the Lapis bug).
     */
    const glyphs = {
        notify: 'status-notify-many', reminder: 'status-reminder', error: 'status-error', warning: 'status-warning',
        carkey: 'status-traffic', traffic: 'status-traffic', lapis: 'status-lapis', caralert: 'status-car-alert',
        rain: 'status-rain-alarm', wxalert: 'status-weather-alert', chat: 'status-messenger', mail: 'status-mail',
        sms: 'status-sms', prints: 'status-prints', director: 'status-director', received: 'status-activesync',
        update: 'status-update', continuity: 'status-continuity', nightshade: 'status-nightshade',
        batterylow: 'status-battery-low', xmrec: 'status-tape'
    };
    const glyphNames = new Set(Object.values(glyphs));
    // the phone's own icons: WM's ROM glyph families in the status atlas (each state its own glyph)
    const systemGlyphs = {
        bluetooth: 'status-bluetooth', data: 'status-data-*', cell: 'status-data-*', roaming: 'status-roaming',
        signal: 'status-signal-*', volume: 'status-volume|status-vibrate|status-volume-off', battery: 'status-battery-*'
    };
    /*
     * The notification holder's pictures (Yukimi, Nov 22 2026, #1026): in WM 6.5 the "..." opens 6.5.1's notification
     * holder (6.5.3's status drawer under the title bar) and 6.5.1's drawer lists the same, every role and notice kind by
     * a large colour icon - the ROM's where it has one (the drawer's shellres.192 groups 4946-4958 as v651-drawer-*, the
     * Start screen's Start_Icon_* as start-*, the message box icons), else the program's own large icon. Never the 1-bit
     * bar glyph. Paths under /static_images/ without the extension; each has 1x / @2x / @4x files (32 / 64 / 128 px,
     * the Start icons 45 / 90 / 180). The page draws them and sends them to the app in the bar's kit.
     */
    const holder = {
        notify: 'wm61/msgbox-info', reminder: 'wm65/start-calendar', error: 'wm61/msgbox-error', warning: 'wm61/msgbox-warning',
        // (carkey, the Car: a car, not Traffic's road and light - Yukimi, Nov 23 2026: "converted from being the traffic
        // icon to a car icon"; scripts/build-wm65-holder-kind-icons.py car)
        carkey: 'wm65/holder-car', traffic: 'wm65/start-traffic', lapis: 'wm65/start-lapis', caralert: 'wm65/start-lapis',
        rain: 'wm61/app-weather-lg', wxalert: 'wm61/app-weather-lg', chat: 'wm65/start-messenger', mail: 'wm65/start-msg',
        sms: 'wm65/start-sms', prints: 'wm65/start-photos', director: 'wm61/app-director-lg', received: 'wm65/start-async',
        update: 'wm65/start-update', continuity: 'wm65/start-pccon', nightshade: 'wm61/set-nightshade',
        batterylow: 'wm65/v651-drawer-battery-low', xmrec: 'wm65/start-xmradio',
        bluetooth: 'wm65/v651-drawer-bluetooth', data: 'wm65/v651-drawer-connectivity', cell: 'wm65/v651-drawer-phone',
        roaming: 'wm65/v651-drawer-roaming', signal: 'wm65/v651-drawer-phone', volume: 'wm65/v651-drawer-volume',
        battery: 'wm65/v651-drawer-battery'
    };
    /*
     * The holder's picture per notification KIND (Yukimi, Nov 22 2026, #1056): several notices of one app showed the same
     * app icon in the holder, so one could not tell what each was for. A notice's kind (holderKind) is finer than its
     * role: new mail vs a mail account that stopped, a text vs a missed call vs voicemail, a reminder vs a meeting vs a
     * task, a print vs a failed print, an update vs a failed install, each car alert by its type, and an Android app's
     * notification by the category Android gives it. ROM art first (the Titanium panel icons, the message box icons),
     * else the ROM's pieces combined: the program's icon with a message box badge, or the kind's ROM picture with the
     * program's Start icon as a small badge (scripts/build-wm65-holder-kind-icons.py). Same paths and sizes as holder.
     */
    const holderKinds = {
        'mail-error': 'wm65/holder-mail-error', email: 'wm65/holder-email',
        message: 'wm65/holder-message', 'sms-error': 'wm65/holder-sms-error',
        call: 'wm65/holder-call', 'call-missed': 'wm65/holder-call-missed', voicemail: 'wm65/holder-voicemail',
        meeting: 'wm65/holder-meeting', task: 'wm65/start-tasks', alarm: 'wm65/holder-alarm',
        'print-error': 'wm65/holder-print-error', 'update-failed': 'wm65/holder-update-failed', progress: 'wm65/holder-progress',
        question: 'wm61/msgbox-question', emotion: 'wm61/app-emotion-lg', 'emotion-error': 'wm65/holder-emotion-error',
        'api-key': 'wm65/holder-api-key', videos: 'wm65/start-youtube',
        'lapis-unlocked': 'wm65/holder-lapis-unlocked', 'lapis-health': 'wm65/holder-lapis-health', 'lapis-fuel': 'wm65/holder-lapis-fuel',
        'lapis-service': 'wm65/holder-lapis-service', 'lapis-failed': 'wm65/holder-lapis-failed', 'lapis-run-left': 'wm65/holder-lapis-run-left',
        // the phone's own battery notices (wmShell batteryLowCheck / batteryFullCheck, #1061): 6.5.1's drawer battery
        // pictures from the ROM (shellres.192), the full battery and the empty one with the warning badge
        'battery-full': 'wm65/v651-drawer-battery', 'battery-low': 'wm65/v651-drawer-battery-low',
        // weather (Nov 22 2026): rain due or falling, a weather alert, a severe one - each its own picture
        'rain-alarm': 'wm65/holder-rain-alarm', 'weather-alert': 'wm65/holder-weather-alert', 'weather-severe': 'wm65/holder-weather-severe'
    };
    // the page's own notices name their glyph (appNote icon), not a kind: the glyphs that stand for a holder kind (#1061)
    const ICON_KIND = { 'status-battery-full': 'battery-full', 'status-battery-low': 'battery-low', 'status-camera': 'traffic',
        'status-receive': 'received' };
    // Lapis' notice kinds (lapisService notice()) -> the holder's
    const LAPIS_KIND = { unlocked: 'lapis-unlocked', health: 'lapis-health', refuel: 'lapis-fuel', 'low-fuel': 'lapis-fuel',
        service: 'lapis-service', command: 'lapis-failed', 'run-left': 'lapis-run-left' };
    // Android's notification categories (Notification.CATEGORY_*, relayed with a phone app's notification) -> the holder's
    const ANDROID_CATEGORY = { msg: 'message', social: 'message', email: 'email', call: 'call', missed_call: 'call-missed',
        voicemail: 'voicemail', alarm: 'alarm', reminder: 'reminder', event: 'meeting', progress: 'progress', err: 'error',
        stopwatch: 'alarm', navigation: 'traffic', transport: 'notify', status: 'notify', sys: 'notify', service: 'notify',
        promo: 'notify', recommendation: 'notify', workout: 'notify', location_sharing: 'notify' };

    /**
     * A notice's holder kind (#1056): what it is about, for its picture in the holder (holderArt). The notice as the server's
     * inbox holds it ({ id, cls, data }) or as the page holds it ({ id, type }); unknown ones fall back to noteKind.
     */
    function holderKind(n) {
        const id = String((n && n.id) || '');
        const d = (n && n.data) || {};
        const cls = String((n && n.cls) || '');
        const dk = String(d.kind || '');
        if (n && n.icon && ICON_KIND[n.icon]) return ICON_KIND[n.icon];
        if (/^lapis:/.test(id) || d.app === 'lapis') {
            const k = dk || (/^lapis:([a-z-]+):/.exec(id) || [])[1] || (id === 'lapis:run-left' ? 'run-left' : '');
            return LAPIS_KIND[k] || 'caralert';
        }
        // weather: the alert's severity (the inbox notice's class, the page's own notice's event), rain on its own
        if (/^wx:/.test(id)) return cls === 'weather-severe' || (n && n.event === 'weather-severe') || d.severe ? 'weather-severe' : 'weather-alert';
        if (/^rain:/.test(id)) return 'rain-alarm';
        if (/^rem:task:/.test(id) || (/^rem:/.test(id) && d.task)) return 'task';
        if (/^rem:/.test(id)) return d.meeting ? 'meeting' : 'reminder';
        if (/^print/.test(id)) return cls === 'print-error' || d.failed ? 'print-error' : 'prints';
        if (/^update/.test(id)) return d.failed || (n && n.type === 'error') ? 'update-failed' : 'update';
        if (/^tm-signin:/.test(id) || dk === 'tm-signin' || dk === 'sms-error') return 'sms-error';
        if (/^mail-(error|signin):/.test(id) || dk === 'mail-error') return 'mail-error';
        if (/^question:/.test(id)) return 'question';
        if (/^emotion:/.test(id)) return d.ok === false ? 'emotion-error' : 'emotion';
        if (/^api-key:/.test(id)) return 'api-key';
        if (/^videos:/.test(id)) return 'videos';
        if (/^system:/.test(id)) return d.level === 'error' ? 'error' : 'warning';
        // a phone's call, missed call or voicemail (their source names the kind), else Android's category
        if (dk === 'call' || dk === 'call-missed' || dk === 'voicemail') return dk;
        const cat = String(d.category || (n && n.category) || '');
        if (cat && ANDROID_CATEGORY[cat]) {
            // a voicemail is a call app's notification on its voicemail channel (Android has no category for it)
            if (/voice\s*mail/i.test(String(d.channel || ''))) return 'voicemail';
            if (ANDROID_CATEGORY[cat] !== 'notify') return ANDROID_CATEGORY[cat];
        }
        return noteKind(n);
    }

    // a glyph name (status-mail) back to its role, for callers that hold the glyph
    const glyphRole = new Map(Object.entries(glyphs).map(([r, g]) => [g, r]));
    // what a tap does: its popup (status-popups.js), drawn by the app or the page; "..." opens the tray of what waits
    const taps = { notify: 'tray' };
    const NOTE_CLS = { mail: 'mail', sms: 'sms', chat: 'chat', print: 'prints', 'print-error': 'prints', director: 'director',
        'weather-alert': 'wxalert', 'weather-severe': 'wxalert', 'rain-alarm': 'rain', reminder: 'reminder' };

    /** A notice's registered kind: its id's source first, then its app, its class, its type; else the plain notice. */
    function noteKind(n) {
        const id = String((n && n.id) || '');
        const d = (n && n.data) || {};
        if (/^rem:/.test(id)) return 'reminder';
        if (/^lapis:/.test(id) || d.app === 'lapis') return 'caralert';
        if (/^traffic:/.test(id) || d.app === 'traffic') return 'traffic';
        if (/^wx:/.test(id)) return 'wxalert';
        if (/^rain:/.test(id)) return 'rain';
        if (/^print/.test(id)) return 'prints';
        if (/^update/.test(id)) return 'update';
        if (n && NOTE_CLS[n.cls]) return NOTE_CLS[n.cls];
        if (n && (n.type === 'error' || n.type === 'warning' || n.type === 'reminder')) return n.type;
        return 'notify';
    }

    const foldRank = new Map(fold.map((r, i) => [r, i]));
    const displacing = new Set(displace);

    /**
     * The order the shown foldable roles fold in (first folds first): those that do not displace the system icons,
     * least wanted first, then the displacing ones, least wanted first. nonDisplacing = how many lead the list.
     */
    function foldSequence(roles) {
        const can = roles.filter((r) => foldRank.has(r)).sort((a, b) => foldRank.get(b) - foldRank.get(a));
        const lead = can.filter((r) => !displacing.has(r));
        return { seq: lead.concat(can.filter((r) => displacing.has(r))), nonDisplacing: lead.length };
    }

    C.lib.statusOrder = {
        display, fold, displace, system,
        canFold: (r) => foldRank.has(r),
        displaces: (r) => displacing.has(r),
        foldSequence,
        glyphs,
        /** The registered glyph for a role or kind, or null (then nothing is drawn). */
        glyph: (r) => glyphs[r] || null,
        /** A glyph name the registration carries. */
        isGlyph: (name) => glyphNames.has(name),
        noteKind,
        noteGlyph: (n) => glyphs[noteKind(n)],
        holder,
        holderKinds,
        holderKind,
        /** The holder's large colour picture for a role, notice kind, holder kind or glyph name (a path under /static_images/), or null. */
        holderArt: (r) => holderKinds[r] || holderKinds[ICON_KIND[r]] || holder[ICON_KIND[r]] || holder[r] || holder[glyphRole.get(r)] || null,
        /** A notice's holder picture (#1056): its holder kind's, else its role's, else the plain notice's. */
        noteHolderArt(n) {
            const k = holderKind(n);
            return holderKinds[k] || holder[k] || holder.notify;
        },
        systemGlyphs,
        /** What a tap on the role does: 'tray' (the "..." group) or 'popup'. */
        tap: (r) => taps[r] || 'popup',
        /**
         * The registration of a role: { glyph, popup, tap } when complete, else null - an incomplete role never shows
         * (scripts/check-status-registry.js fails the commit for one in the display table).
         */
        registration(r) {
            const glyph = glyphs[r] || systemGlyphs[r] || null;
            const pl = C.lib.statusPopups;
            const popup = !!(pl && pl.has(r));
            return glyph && popup ? { glyph, popup, tap: taps[r] || 'popup' } : null;
        }
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
