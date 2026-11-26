/**
 * The name of the app behind a phone notification (Yozora #1097): always its real name, never its package
 * (com.google.android.gm). One resolver for the phone shell, the DeX Bell and the ActiveSync computer page.
 *
 *   melatonAppName.resolve(pkg, sentLabel)  -> the name to show (never the package)
 *   melatonAppName.isPackageName(text, pkg) -> true for "com.google.android.gm" or the package itself
 *   melatonAppName.humane(pkg)              -> the table's name, else the last meaningful segment, title-cased
 *   melatonAppName.iconSrc(pkg)             -> the phone's /notification-icon/<pkg> address (a file, never base64)
 *   melatonAppName.genericIcon(px)          -> the theme's generic program icon (an app with no icon of its own)
 *
 * Order: the label the app sent (unless it is only the package) -> the installed program's label (the phone's
 * Programs list: wmAndroidApps, or the DeX Start menu's: melatonAndroidPrograms; read once and kept until the
 * programs change, never a bridge call per notification) -> the known table -> a humane name from the package.
 * Loads in node too (scripts/test-android-notify-names.js).
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.melatonAppName = api;
}(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    /** Common apps by package (the household's); everything else is named from its package. */
    const KNOWN = {
        'com.google.android.gm': 'Gmail',
        'com.samsung.android.email.provider': 'Samsung Email',
        'com.samsung.android.messaging': 'Messages',
        'com.google.android.apps.messaging': 'Messages',
        'com.android.mms': 'Messages',
        'com.discord': 'Discord',
        'com.whatsapp': 'WhatsApp',
        'com.whatsapp.w4b': 'WhatsApp Business',
        'org.telegram.messenger': 'Telegram',
        'org.thunderdog.challegram': 'Telegram X',
        'com.Slack': 'Slack',
        'com.slack': 'Slack',
        'com.google.android.youtube': 'YouTube',
        'com.android.chrome': 'Chrome',
        'com.google.android.dialer': 'Phone',
        'com.samsung.android.dialer': 'Phone',
        'com.samsung.android.incallui': 'Phone',
        'com.google.android.calendar': 'Calendar',
        'com.samsung.android.calendar': 'Calendar',
        'com.sec.android.app.clockpackage': 'Clock',
        'com.google.android.deskclock': 'Clock',
        'com.google.android.apps.maps': 'Maps',
        'com.google.android.apps.photos': 'Google Photos',
        'com.google.android.googlequicksearchbox': 'Google',
        'com.google.android.gms': 'Google Play services',
        'com.android.vending': 'Play Store',
        'com.android.systemui': 'System UI',
        'android': 'Android System',
        'com.reddit.frontpage': 'Reddit',
        'com.twitter.android': 'X',
        'com.instagram.android': 'Instagram',
        'com.spotify.music': 'Spotify',
        'org.mozilla.firefox': 'Firefox',
        'com.microsoft.office.outlook': 'Outlook',
        'com.android.settings': 'Settings'
    };

    // package segments that name a vendor or a kind, not the app
    const SKIP = new Set(['com', 'org', 'net', 'io', 'me', 'app', 'apps', 'android', 'google', 'samsung', 'sec', 'mobile', 'client',
        'free', 'lite', 'pro', 'main', 'release', 'provider', 'service', 'services', 'dev', 'co', 'jp', 'de', 'uk', 'www', 'debug', 'beta', 'alpha', 'test', 'dev', 'release', 'prod', 'staging', 'internal']);

    const looksPackage = (s) => /^[A-Za-z][\w-]*(\.[A-Za-z_][\w-]*)+$/.test(s);

    function isPackageName(text, pkg) {
        const t = String(text == null ? '' : text).trim();
        if (!t) return true; // nothing is as good as a package: the next step is tried
        if (pkg && t.toLowerCase() === String(pkg).trim().toLowerCase()) return true;
        return looksPackage(t);
    }

    const titleCase = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);

    function humane(pkg) {
        const p = String(pkg == null ? '' : pkg).trim();
        if (!p) return 'Notification';
        if (KNOWN[p]) return KNOWN[p];
        const segs = p.split('.').filter(Boolean);
        let pick = null;
        for (let i = segs.length - 1; i >= 0; i--) {
            if (!SKIP.has(segs[i].toLowerCase()) && segs[i].length > 2) { pick = segs[i]; break; }
        }
        if (!pick) pick = segs[segs.length - 1] || p;
        const words = pick.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean);
        const out = words.map(titleCase).join(' ');
        return out || 'Notification';
    }

    // installed programs by package, read once from the page's lists and dropped when they change
    let installed = null;
    function readInstalled() {
        const m = new Map();
        const w = typeof window !== 'undefined' ? window : null;
        if (!w) return m;
        try {
            const list = w.wmAndroidApps && typeof w.wmAndroidApps.list === 'function' ? w.wmAndroidApps.list() : [];
            for (const a of list) if (a && a.package && a.label && !m.has(a.package)) m.set(a.package, String(a.label));
        } catch (_) { /* list not ready */ }
        try {
            const P = w.melatonAndroidPrograms;
            const items = P && typeof P.items === 'function' ? P.items() : [];
            for (const it of items) {
                const mt = /^android:([^/]+)\//.exec(String(it && it.launchId || ''));
                if (mt && it.text && !m.has(mt[1])) m.set(mt[1], String(it.text));
            }
        } catch (_) { /* programs not ready */ }
        return m;
    }
    function installedLabel(pkg) {
        if (!installed) { const m = readInstalled(); if (!m.size) return ''; installed = m; } // none yet: asked again next time
        return installed.get(pkg) || '';
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
        const drop = () => { installed = null; };
        const seg = window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' ? window.melatonSegments.callerSignal() : undefined;
        window.addEventListener('androidapps', drop, { signal: seg });
        document.addEventListener('wmAppsChanged', drop, { signal: seg });
        document.addEventListener('melaton:android-programs', drop, { signal: seg });
    }

    /** installedMap: tests pass { pkg: label }; the page reads its own lists. */
    function resolve(pkg, sent, installedMap) {
        const p = String(pkg == null ? '' : pkg).trim();
        const s = String(sent == null ? '' : sent).trim();
        if (s && !isPackageName(s, p)) return s;
        const inst = installedMap ? installedMap[p] : installedLabel(p);
        if (inst && !isPackageName(inst, p)) return String(inst).trim();
        return humane(p);
    }

    const iconSrc = (pkg) => (pkg ? `/notification-icon/${encodeURIComponent(String(pkg))}` : '');

    /** The theme's generic program icon (Vista's), for an app whose own icon is missing or fails to load. */
    const genericIcon = (px) => `/static_images/vista-icons/generic-exe-${px <= 16 ? 16 : (px <= 32 ? 32 : 48)}.png`;

    return { resolve, isPackageName, humane, iconSrc, genericIcon, KNOWN };
}));
