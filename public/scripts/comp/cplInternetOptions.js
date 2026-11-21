/**
 * Internet Properties' own dialogs (Yozora #632; the sheet is cplDialogs2.js): inetcpl's templates
 * driving Grimoire and Alchemy for real where the browser has the setting, Melaton's registry where
 * it does not.
 *
 *   Grimoire / Alchemy (userGlobalSettings.alchemy, modules/grimoireBrowserBridge.js)
 *     home page, search provider, sounds, Alchemy's picture quality and frame rates
 *     Delete Browsing History: Alchemy's cache and cookies (POST /api/grimoire-browser/clear-data),
 *     Grimoire's History (grimoireHistoryDsap.js); Days to keep pages in history prunes it
 *     Reset: those settings back to their defaults, the browsing data deleted, Alchemy restarted
 *     Manage add-ons: the extensions Alchemy loaded
 *   Alchemy's Chromium (StaticForge, Yukimi Nov 21 2026: "move as much as the chrome settings into the
 *   Internet Options"; services/grimoire-browser/chromeSettings.js over /api/grimoire-browser/chrome-settings):
 *     General: home page, Delete Browsing History (history, cache, cookies, form data, passwords, add-on data),
 *       disk space for the cache, search engine (Web Search), languages, fonts per script
 *     Security: each zone's level and Custom level (JavaScript, pop-ups, mixed content, downloads, notifications,
 *       location, camera, microphone, sound), Trusted / Restricted sites (per-site rules), Protected Mode (sandbox)
 *     Privacy: the cookie slider and Advanced, per-site cookie rules (Sites), Pop-up Blocker and its exceptions
 *     Content: AutoComplete (forms, passwords), Certificates (Chromium's certificate manager)
 *     Connections: LAN settings (proxy: automatic, script, server, exceptions)
 *     Programs: Manage add-ons (enable, disable, remove)
 *     Advanced: Phishing Filter (Safe Browsing), Suggested Sites, Show pictures, and Alchemy's own rows
 *   Registry only: tabbed browsing, colors, accessibility, feeds, the rest of Advanced
 *
 *   root.cplInternetOptions = { alchemySettings, saveAlchemy, SEARCH_PROVIDERS, ALCHEMY_ADVANCED,
 *                               open: { deleteHistory, historySettings, search, tabs, popups,
 *                                       languages, fonts, colors, accessibility, autoComplete,
 *                                       feeds, privacyAdvanced, reset, addons } }
 */
(function (root) {
    'use strict';

    const V = () => root.vistaDialogTemplate;
    const R = () => root.melatonRegistry;

    const IE = 'HKCU\\Software\\Xyridian\\Grimoire';
    const SETTINGS = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Internet Settings';
    const KEY = {
        main: `${IE}\\Main`,
        tabs: `${IE}\\TabbedBrowsing`,
        popups: `${IE}\\New Windows`,
        allow: `${IE}\\New Windows\\Allow`,
        intl: `${IE}\\International`,
        scripts: `${IE}\\International\\Scripts`,
        colors: `${IE}\\Settings`,
        styles: `${IE}\\Styles`,
        feeds: `${IE}\\Feeds`,
        history: `${SETTINGS}\\Url History`,
        cache: `${SETTINGS}\\Cache`,
        privacy: `${SETTINGS}\\Zones\\3`
    };

    // Grimoire's Search ▾ (grimoireIeChrome.js SEARCH_PROVIDERS; the bridge keeps the same ids)
    const SEARCH_PROVIDERS = [
        { id: 'grimoire', label: 'Grimoire Search' },
        { id: 'danbooru', label: 'Danbooru Wiki' },
        { id: 'e621', label: 'e621 Wiki' },
        { id: 'web', label: 'Web Search' }
    ];

    const ALCHEMY_DEFAULTS = { homePage: '', searchProvider: 'grimoire', jpegQuality: 55, minFps: 10, maxFps: 30, regionQuality: 78, audioEnabled: true, audioVolume: 100, audioBackground: false };

    // Internet Properties > Advanced: Alchemy's own group, radios over its settings
    const ALCHEMY_ADVANCED = [
        { sub: 'Picture quality', key: 'jpegQuality', choices: [[40, 'Low'], [55, 'Medium'], [70, 'High'], [85, 'Highest']] },
        { sub: 'Highest frame rate', key: 'maxFps', choices: [[15, '15 frames a second'], [24, '24 frames a second'], [30, '30 frames a second'], [45, '45 frames a second'], [60, '60 frames a second']] },
        { sub: 'Lowest frame rate', key: 'minFps', choices: [[5, '5 frames a second'], [10, '10 frames a second'], [15, '15 frames a second'], [20, '20 frames a second']] },
        { sub: 'Compression of changed areas', key: 'regionQuality', choices: [[40, 'Low'], [60, 'Medium'], [78, 'High']] },
        { check: 'Play sounds when the window is in the background', key: 'audioBackground' }
    ];

    // Internet Properties > Advanced: Alchemy performance (#756; userGlobalSettings.alchemy.performance, sent to the
    // service at once). "*" rows relaunch Chromium (the dialog asks first); invert: the row reads the other way round.
    const PERFORMANCE_ADVANCED = [
        { sub: 'Maximum memory per tab', key: 'tabMemoryMb', choices: [[0, 'No limit'], [256, '256 MB'], [512, '512 MB'], [1024, '1 GB'], [2048, '2 GB'], [4096, '4 GB']] },
        { check: 'Give each computer and phone its own browser window', key: 'isolateClients' },
        { check: 'Give each Grimoire window its own browser window', key: 'isolateWindows', needs: 'isolateClients' },
        { check: 'Pause pages nobody is watching', key: 'pauseUnwatched' },
        { sub: 'Suspend background tabs after', key: 'suspendMinutes', choices: [[0, 'Never'], [5, '5 minutes'], [10, '10 minutes'], [20, '20 minutes'], [60, '1 hour']] },
        { sub: 'Open Alchemy pages at most', key: 'maxTabs', choices: [[2, '2 pages'], [4, '4 pages'], [6, '6 pages'], [8, '8 pages'], [12, '12 pages'], [16, '16 pages']] },
        // the sandbox is Security > Enable Protected Mode
        { check: 'Keep each website in a process of its own (site isolation)*', key: 'siteIsolation', relaunch: true },
        { sub: 'Page processes at most*', key: 'rendererLimit', relaunch: true, choices: [[0, 'Automatic'], [2, '2'], [4, '4'], [8, '8'], [16, '16']] },
        { check: 'Use the graphics card when Alchemy has no display*', key: 'headlessGpu', relaunch: true },
        { check: 'Let Alchemy update its components*', key: 'componentUpdate', relaunch: true }
    ];
    const PERFORMANCE_DEFAULTS = { tabMemoryMb: 0, isolateClients: true, isolateWindows: true, pauseUnwatched: true, suspendMinutes: 20, maxTabs: 4, sandbox: false, siteIsolation: true, rendererLimit: 0, headlessGpu: true, componentUpdate: true };

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /** "Internet Explorer" reads Grimoire, an access key inside it included ("Let &Internet Explorer decide"). */
    function grimoire(text) {
        return String(text || '').replace(/(?:<u>I<\/u>|I)nternet Explorer/g, (m) => (m.startsWith('<u>') ? '<u>G</u>rimoire' : 'Grimoire'));
    }

    // child windows carry Internet Properties' own icon (window-icon-policy)
    const ICON = '/static_images/vista-cpl/items/internet-options-32.png';
    const titleOf = (key, title) => grimoire(title || ((root.vistaDialogTemplates || {})[key] || {}).t || '');

    function reg(key, name, def) {
        const r = R();
        return r ? r.get(key, name, def) : def;
    }

    function toast(kind, text) {
        if (typeof root.showGlassToast === 'function') root.showGlassToast(kind, null, text, false, 4000);
    }

    // ---- Grimoire / Alchemy settings -----------------------------------------------------------

    /** userGlobalSettings.alchemy, through grimoireRemoteBrowser.js when it is loaded (it caches them). */
    async function alchemySettings() {
        if (typeof root.grimoireLoadAlchemySettings === 'function') return { ...ALCHEMY_DEFAULTS, ...(await root.grimoireLoadAlchemySettings()) };
        const ws = root.wsClient;
        const data = ws && typeof ws.getUserGlobalSettings === 'function' ? await ws.getUserGlobalSettings() : null;
        return { ...ALCHEMY_DEFAULTS, ...((data && data.settings && data.settings.alchemy) || {}) };
    }

    /** Saves a patch, then hands it to every open Grimoire window and Alchemy page. */
    async function saveAlchemy(patch) {
        if (!patch || !Object.keys(patch).length) return null;
        let saved = null;
        if (typeof root.grimoireSaveAlchemySettings === 'function') saved = await root.grimoireSaveAlchemySettings(patch);
        else {
            const ws = root.wsClient;
            const data = ws ? await ws.updateUserGlobalSettings({ alchemy: patch }) : null;
            saved = data && data.settings ? data.settings.alchemy : null;
        }
        if (!saved) return null;
        // the IE chrome of each window (grimoireIeChrome.js applySettings), each Alchemy viewer (grimoireApplyAlchemySetting)
        const windows = typeof root.grimoireAllWindows === 'function' ? root.grimoireAllWindows() : [];
        (windows || []).forEach((w) => { if (w && w.ieChrome && typeof w.ieChrome.applySettings === 'function') w.ieChrome.applySettings(saved); });
        if (typeof root.grimoireRemoteShells === 'function' && typeof root.grimoireRemoteFrame === 'function') {
            root.grimoireRemoteShells().forEach((shell) => {
                const frame = root.grimoireRemoteFrame(shell);
                if (frame && frame.contentWindow && shell._grimoireRemoteSessionId) frame.contentWindow.postMessage({ type: 'grimoire-browser-settings', settings: saved }, '*');
            });
        }
        if (typeof root.grimoireSyncAudio === 'function') root.grimoireSyncAudio();
        return saved;
    }

    /** The page the focused Grimoire window shows (General > Use current). */
    function currentPage() {
        const host = typeof root.grimoireFocusWindow === 'function' ? root.grimoireFocusWindow() : null;
        const shell = host && host.activePane && host.activePane !== host ? host.activePane : host;
        const addr = (shell && (shell._currentAddress || shell.currentAddress)) || (host && host.currentAddress);
        return (addr && addr.fullUrl) || '';
    }

    // ---- Alchemy's Chromium (chromeSettings.js) ---------------------------------------------------

    let chromeCache = null;

    /** Chromium's settings as Internet Options shows them; null when Alchemy is not running. */
    async function chromeRead(opts) {
        const res = await fetch('/api/grimoire-browser/chrome-settings' + (opts && opts.fonts ? '?fonts=1' : ''), { credentials: 'same-origin' }).catch(() => null);
        if (!res || !res.ok) return null;
        chromeCache = await res.json().catch(() => null);
        return chromeCache;
    }

    /** { prefs, content, exceptions: [{ type, pattern, setting|null }], searchEngine, launch } -> the settings read back. */
    async function chromeWrite(patch) {
        if (!patch || !Object.keys(patch).length) return chromeCache;
        const res = await fetch('/api/grimoire-browser/chrome-settings', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch)
        }).catch(() => null);
        if (!res || !res.ok) throw new Error('Alchemy did not take the settings');
        chromeCache = await res.json().catch(() => null);
        if (chromeCache && chromeCache.failed && chromeCache.failed.length) console.warn('Internet Options: Alchemy refused', chromeCache.failed);
        return chromeCache;
    }

    /** One combined write for a dialog's OK; a toast when Alchemy did not take it. */
    async function chromeSave(patch) {
        try {
            return await chromeWrite(patch);
        } catch (_) {
            toast('error', 'Alchemy could not save the settings');
            return null;
        }
    }

    /** Settings Alchemy only takes at its next start (proxy, pop-up blocker, cache size, add-ons): restart now? */
    async function offerRelaunch(saved) {
        if (!saved || !saved.pendingRelaunch) return;
        const ask = root.browsingRestore && typeof root.browsingRestore.confirm === 'function' ? root.browsingRestore.confirm : null;
        const now = ask ? await ask('Alchemy has to restart to use the new settings. Open webpages reload. Restart Alchemy now?') : false;
        if (now) await fetch('/api/grimoire-browser/restart', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    }

    /** "www.example.com", "http://x.y/z" -> Chromium's site pattern "[*.]example.com" (https:// only: "https://[*.]...") */
    function sitePattern(text, httpsOnly) {
        const raw = String(text || '').trim().toLowerCase();
        if (!raw) return '';
        const m = /^(?:(https?):\/\/)?(?:\*\.)?([a-z0-9.-]+|\[[0-9a-f:]+\])(?::(\d+))?(?:\/.*)?$/.exec(raw.replace(/^\[\*\.\]/, ''));
        if (!m) return '';
        const host = m[2].replace(/^www\./, '');
        if (!host.includes('.') && host !== 'localhost' && !host.startsWith('[')) return '';
        return (httpsOnly ? 'https://' : '') + '[*.]' + host;
    }

    /** "[*.]example.com" / "https://[*.]example.com:443" -> "example.com" / "https://example.com" for the lists */
    function siteLabel(pattern) {
        return String(pattern || '').replace('[*.]', '').replace(/:443$|:80$/, '');
    }

    // Security zones over Chromium's content settings: what each level sets for the Internet zone, and what a site in
    // Trusted / Restricted sites gets as its own rules
    const ZONE_PRESETS = {
        0: { javascript: 'allow', popups: 'allow', 'mixed-script': 'allow', 'multiple-automatic-downloads': 'allow', notifications: 'ask', location: 'ask', 'media-stream-camera': 'ask', 'media-stream-mic': 'ask', sound: 'allow', images: 'allow' },
        1: { javascript: 'allow', popups: 'block', 'mixed-script': 'block', 'multiple-automatic-downloads': 'allow', notifications: 'ask', location: 'ask', 'media-stream-camera': 'ask', 'media-stream-mic': 'ask', sound: 'allow', images: 'allow' },
        2: { javascript: 'allow', popups: 'block', 'mixed-script': 'block', 'multiple-automatic-downloads': 'ask', notifications: 'ask', location: 'ask', 'media-stream-camera': 'ask', 'media-stream-mic': 'ask', sound: 'allow', images: 'allow' },
        3: { javascript: 'allow', popups: 'block', 'mixed-script': 'block', 'multiple-automatic-downloads': 'ask', notifications: 'ask', location: 'ask', 'media-stream-camera': 'ask', 'media-stream-mic': 'ask', sound: 'allow', images: 'allow' },
        4: { javascript: 'block', popups: 'block', 'mixed-script': 'block', 'multiple-automatic-downloads': 'block', notifications: 'block', location: 'block', 'media-stream-camera': 'block', 'media-stream-mic': 'block', sound: 'allow', images: 'allow' }
    };
    const SITE_RULES = {
        trusted: { javascript: 'allow', popups: 'allow', cookies: 'allow', 'multiple-automatic-downloads': 'allow', 'mixed-script': 'allow', sound: 'allow' },
        restricted: { javascript: 'block', popups: 'block', cookies: 'block', 'multiple-automatic-downloads': 'block', notifications: 'block', location: 'block', 'media-stream-camera': 'block', 'media-stream-mic': 'block' }
    };

    /** The sites of a zone, read from Chromium's rules: trusted sites allow JavaScript and pop-ups, restricted block JavaScript. */
    function zoneSites(chrome, zone) {
        const ex = (chrome && chrome.exceptions) || {};
        const js = ex.javascript || [];
        if (zone === 'restricted') return js.filter((e) => e.setting === 'block').map((e) => e.pattern);
        if (zone !== 'trusted') return [];
        const pop = new Set((ex.popups || []).filter((e) => e.setting === 'allow').map((e) => e.pattern));
        return js.filter((e) => e.setting === 'allow' && pop.has(e.pattern)).map((e) => e.pattern);
    }

    function siteRules(pattern, zone, on) {
        return Object.entries(SITE_RULES[zone] || {}).map(([type, setting]) => ({ type, pattern, setting: on ? setting : null }));
    }

    // the privacy slider (0 Accept All ... 5 Block All) <-> Chromium's cookie settings
    function privacyToChrome(level) {
        const p = {};
        const content = {};
        if (level >= 5) content.cookies = 'block';
        else content.cookies = level === 4 ? 'session_only' : 'allow';
        p['profile.cookie_controls_mode'] = level <= 0 ? 0 : (level === 1 ? 1 : 2);
        return { prefs: p, content };
    }

    function privacyFromChrome(chrome, fallback) {
        if (!chrome) return fallback;
        const cookies = chrome.content && chrome.content.cookies;
        const mode = Number(chrome.prefs && chrome.prefs['profile.cookie_controls_mode']);
        if (cookies === 'block') return 5;
        if (cookies === 'session_only') return 4;
        const fits = { 0: mode === 0, 1: mode === 1, 2: mode === 2, 3: mode === 2 };
        if (fits[fallback]) return fallback;
        return mode === 0 ? 0 : (mode === 1 ? 1 : 2);
    }

    /** Open a page in the focused Grimoire window (Content > Certificates: Chromium's certificate manager). */
    function openInGrimoire(url) {
        if (typeof root.grimoireOpenUrl === 'function') root.grimoireOpenUrl(url);
    }

    async function clearBrowsingData(what) {
        if (what.history) {
            if (root.grimoireHistoryLog) root.grimoireHistoryLog.clear();
            else try { root.localStorage.removeItem('grimoireHistory'); } catch (_) { /* private mode */ }
        }
        const r = R();
        const stamp = new Date().toISOString();
        if (r) {
            const marks = {};
            Object.keys(what).forEach((k) => { if (what[k]) marks[`LastCleared_${k}`] = stamp; });
            await r.set(KEY.cache, marks);
        }
        // Alchemy's Chromium clears its own (history, cache, cookies and site data, form data, passwords, add-on data)
        if (!what.cache && !what.cookies && !what.history && !what.forms && !what.passwords && !what.addons) return true;
        const res = await fetch('/api/grimoire-browser/clear-data', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cache: !!what.cache, cookies: !!what.cookies, history: !!what.history, forms: !!what.forms, passwords: !!what.passwords, addons: !!what.addons })
        }).catch(() => null);
        // 503: Alchemy is not set up on this server, so it has nothing stored
        return !!res && (res.ok || res.status === 503);
    }

    // ---- a plain inetcpl dialog bound to registry values -----------------------------------------

    /**
     * fields: { id, name, type: 'check' | 'num' | 'text' | 'select', def, options }
     *         { radios: { id: value }, name, def }
     */
    function regDialog({ id, key, tplKey, owner, fields = [], init, ok, buttons, overrides, title }) {
        return V().openDialog({
            id,
            key: tplKey,
            title: titleOf(tplKey, title),
            icon: ICON,
            owner,
            overrides,
            buttons,
            init(ctx) {
                fields.forEach((f) => {
                    const v = reg(f.key || key, f.name, typeof f.def === 'function' ? f.def() : f.def);
                    if (f.radios) Object.entries(f.radios).forEach(([rid, val]) => ctx.set(Number(rid), String(val) === String(v)));
                    else if (f.type === 'check') ctx.set(f.id, !!v);
                    else {
                        if (f.options) ctx.options(f.id, f.options, v);
                        else ctx.set(f.id, v);
                    }
                });
                ctx.content.querySelectorAll('.vdt-static .vdt-st-text, .vdt-check label span, .tbp-group-label, button.vdt-button').forEach((n) => {
                    if (/Internet Explorer/.test(n.textContent)) n.innerHTML = grimoire(n.innerHTML);
                });
                if (init) init(ctx);
            },
            async ok(ctx) {
                const r = R();
                const byKey = {};
                fields.forEach((f) => {
                    let v;
                    if (f.radios) {
                        const hit = Object.keys(f.radios).find((rid) => ctx.get(Number(rid)));
                        v = hit === undefined ? f.def : f.radios[hit];
                    } else if (f.type === 'check') v = !!ctx.get(f.id);
                    else if (f.type === 'num') v = Math.max(f.min || 0, Math.min(f.max || 99999, Number(ctx.get(f.id)) || 0));
                    else v = ctx.get(f.id);
                    (byKey[f.key || key] = byKey[f.key || key] || {})[f.name] = v;
                });
                if (r) await Promise.all(Object.entries(byKey).map(([k, values]) => r.set(k, values)));
                if (ok) return ok(ctx, byKey);
                return undefined;
            }
        });
    }

    /** inetcpl's Yes / No confirmations (Delete Files, Delete Cookies, ...): resolves true on Yes (Delete all:
     *  { addons } with its "Also delete files and settings stored by add-ons" box). */
    function confirm(tplKey, owner) {
        return new Promise((resolve) => {
            let answered = false;
            V().openDialog({
                id: `cplInet${tplKey.split(':')[1]}`,
                key: tplKey,
                owner,
                icon: ICON,
                title: titleOf(tplKey),
                init(ctx) {
                    ctx.content.querySelectorAll('.vdt-static .vdt-st-text').forEach((n) => { n.innerHTML = grimoire(n.innerHTML); });
                },
                buttons: {
                    6: (ctx) => { answered = true; resolve(tplKey === 'inetcpl:6404' ? { addons: !!ctx.get(1449) } : true); ctx.close(); },
                    7: (ctx) => { answered = true; resolve(false); ctx.close(); }
                },
                cancel() { if (!answered) resolve(false); }
            });
        });
    }

    function ownerOf(ctx) {
        return ctx && ctx.modal ? ctx.modal : null;
    }

    // ---- General ---------------------------------------------------------------------------------

    function deleteHistory(owner) {
        const run = async (what, tplKey, done) => {
            const yes = tplKey ? await confirm(tplKey, owner) : true;
            if (!yes) return;
            if (yes.addons) what.addons = true;
            const ok = await clearBrowsingData(what);
            if (!ok) toast('error', 'Alchemy could not delete its browsing data');
            else if (done) toast('success', done);
        };
        return V().openDialog({
            id: 'cplInetDeleteHistory',
            key: 'inetcpl:5500',
            owner,
                icon: ICON,
                title: titleOf('inetcpl:5500'),
            init(ctx) {
                ctx.content.querySelectorAll('.vdt-link').forEach((a) => a.addEventListener('click', () => {
                    if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('internet-options');
                }));
            },
            buttons: {
                624: () => run({ cache: true }, 'inetcpl:4451', 'Temporary files deleted'),
                627: () => run({ cookies: true }, 'inetcpl:4869', 'Cookies deleted'),
                1489: () => run({ history: true }, 'inetcpl:6401', 'History deleted'),
                5532: () => run({ forms: true }, 'inetcpl:6402', 'Form data deleted'),
                5533: () => run({ passwords: true }, 'inetcpl:6403', 'Passwords deleted'),
                5534: () => run({ cache: true, cookies: true, history: true, forms: true, passwords: true }, 'inetcpl:6404', 'Browsing history deleted'),
                5536: (ctx) => ctx.close()
            }
        });
    }

    async function historySettings(owner) {
        const chrome = chromeCache || await chromeRead().catch(() => null);
        const cacheMb = chrome && chrome.launch && chrome.launch.diskCacheMb;
        return regDialog({
            id: 'cplInetHistorySettings',
            tplKey: 'inetcpl:700',
            key: KEY.cache,
            owner,
            fields: [
                { radios: { 618: 'visit', 613: 'start', 615: 'auto', 614: 'never' }, name: 'SyncMode', def: 'auto' },
                // Alchemy's disk cache (--disk-cache-size; 0 = Chromium sizes it itself, shown as 250)
                { id: 611, name: 'CacheLimitMB', type: 'num', def: cacheMb || 250, min: 8, max: 1024 },
                { id: 1492, key: KEY.history, name: 'DaysToKeep', type: 'num', def: 20, min: 0, max: 999 }
            ],
            overrides: { 605: { disabled: true }, 1533: { disabled: true } },
            init(ctx) {
                if (cacheMb) ctx.set(611, cacheMb);
                ctx.store.cacheShown = Number(ctx.get(611));
                ctx.text(625, 'Current location:');
                ctx.text(608, 'Alchemy keeps its cache on the Dreamscape server.');
                [[626, 8, 1024], [1493, 0, 999]].forEach(([id, min, max]) => {
                    const h = ctx.holder(id);
                    if (h) { h.dataset.min = String(min); h.dataset.max = String(max); }
                });
                ctx.on(609, 'click', () => {
                    if (typeof root.grimoireOpenUrl === 'function') root.grimoireOpenUrl(root.GRIMOIRE_HISTORY_URL || 'dsap://history.grimoire.jp');
                });
            },
            async ok(ctx, byKey) {
                const mb = Number((byKey[KEY.cache] || {}).CacheLimitMB);
                if (!chrome || !mb || mb === ctx.store.cacheShown) return;
                await offerRelaunch(await chromeSave({ launch: { diskCacheMb: mb } }));
            }
        });
    }

    /** IE7's Change Search Defaults lives in ieframe.dll, which the VM dump does not have: the same
     *  layout in inetcpl's metrics (MS Shell Dlg 8) over Grimoire's providers. */
    const SEARCH_TPL = { t: 'Change Search Defaults', w: 262, h: 150, f: ['MS Shell Dlg', 8], s: 0x80C800C0, c: [
        [-1, 'S', 7, 7, 248, 8, 0x50020000, 'Search providers', 0],
        [101, 'L', 7, 18, 184, 104, 0x50A10101, '', 0],
        [102, 'B', 197, 18, 58, 14, 0x50010000, 'Set &Default', 0],
        [103, 'B', 197, 36, 58, 14, 0x58010000, '&Remove', 0],
        [1, 'B', 151, 129, 50, 14, 0x50010001, 'OK', 0],
        [2, 'B', 205, 129, 50, 14, 0x50010000, 'Cancel', 0]
    ] };

    /** Grimoire's own providers, and Alchemy's search engines as the Web Search ones ("web:<Chromium id>"). */
    async function search(owner) {
        const s = await alchemySettings();
        const chrome = await chromeRead().catch(() => null);
        const engines = ((chrome && chrome.engines) || []).filter((e) => (e.isDefault || e.canBeDefault) && /^https?:/.test(e.url || ''));
        const current = engines.find((e) => e.isDefault);
        let chosen = s.searchProvider === 'web' && current ? `web:${current.id}` : (s.searchProvider || 'grimoire');
        const list = () => SEARCH_PROVIDERS.filter((p) => p.id !== 'web' || !engines.length).map((p) => ({ value: p.id, text: p.label }))
            .concat(engines.map((e) => ({ value: `web:${e.id}`, text: e.name })));
        const fill = (ctx) => ctx.options(101, list().map((o) => ({ value: o.value, text: o.value === chosen ? `${o.text} (Default)` : o.text })), ctx.get(101) || chosen);
        return V().openDialog({
            id: 'cplInetSearch',
            tpl: SEARCH_TPL,
            owner,
                icon: ICON,
                title: SEARCH_TPL.t,
            init(ctx) { fill(ctx); },
            buttons: {
                102: (ctx) => { chosen = ctx.get(101) || chosen; fill(ctx); }
            },
            async ok() {
                const web = /^web:(\d+)$/.exec(chosen);
                const engine = web ? engines.find((e) => String(e.id) === web[1]) : null;
                const provider = web ? 'web' : chosen;
                try {
                    if (engine && !engine.isDefault) await chromeWrite({ searchEngine: engine.id });
                    const patch = {};
                    if (provider !== s.searchProvider) patch.searchProvider = provider;
                    if (engine && engine.url !== s.webSearchUrl) patch.webSearchUrl = engine.url;
                    if (Object.keys(patch).length) await saveAlchemy(patch);
                } catch (_) { toast('error', 'Could not save the search provider'); }
            }
        });
    }

    function tabs(owner) {
        const defaults = { 6101: true, 6108: true, 6102: false, 6103: true, 6109: false, 6110: true, 6111: false };
        return regDialog({
            id: 'cplInetTabs',
            tplKey: 'inetcpl:6100',
            key: KEY.tabs,
            owner,
            fields: [
                { id: 6101, name: 'Enabled', type: 'check', def: true },
                { id: 6108, name: 'WarnOnClose', type: 'check', def: true },
                { id: 6102, name: 'OpenInForeground', type: 'check', def: false },
                { id: 6103, name: 'QuickTabsEnabled', type: 'check', def: true },
                { id: 6109, name: 'OpenFirstHomePageOnly', type: 'check', def: false },
                { id: 6110, name: 'OpenAdjacent', type: 'check', def: true },
                { id: 6111, name: 'NewTabPageShow', type: 'check', def: false },
                { radios: { 6104: 0, 6105: 1, 6106: 2 }, name: 'PopupsUseNewWindow', def: 0 },
                { radios: { 6112: 0, 6113: 1, 6114: 2 }, name: 'ShortcutBehavior', def: 1 }
            ],
            init(ctx) {
                const sync = () => [6108, 6102, 6103, 6109, 6110, 6111, 6104, 6105, 6106, 6112, 6113, 6114].forEach((id) => ctx.enable(id, !!ctx.get(6101)));
                ctx.on(6101, 'change', sync);
                sync();
                ctx.on(6107, 'click', () => {
                    Object.entries(defaults).forEach(([id, v]) => ctx.set(Number(id), v));
                    ctx.set(6104, true); ctx.set(6113, true);
                    sync();
                });
            }
        });
    }

    async function popups(owner) {
        // the allowed sites are Alchemy's pop-up rules (Chromium's popups exceptions) when it is running
        const chrome = await chromeRead().catch(() => null);
        const chromeSites = chrome ? ((chrome.exceptions && chrome.exceptions.popups) || []).filter((e) => e.setting === 'allow').map((e) => e.pattern) : null;
        const list = () => (chromeSites ? chromeSites.map(siteLabel) : Object.keys((R() && R().getKey(KEY.allow)) || {})).sort();
        return regDialog({
            id: 'cplInetPopups',
            tplKey: 'inetcpl:5402',
            key: KEY.popups,
            owner,
            overrides: { 5403: { disabled: false }, 5406: { disabled: false }, 5413: { disabled: false } },
            fields: [
                { id: 5407, name: 'PlaySound', type: 'check', def: true },
                { id: 5417, name: 'UseHooks', type: 'check', def: true },
                { id: 5416, name: 'BlockUserInit', type: 'select', def: 1, options: [{ value: 0, text: 'Low: Allow pop-ups from secure sites' }, { value: 1, text: 'Medium: Block most automatic pop-ups' }, { value: 2, text: 'High: Block all pop-ups (Ctrl+Alt to override)' }] }
            ],
            init(ctx) {
                const lv = ctx.holder(5405);
                const sites = new Set(list());
                const draw = () => {
                    lv.classList.add('is-report', 'no-header');
                    lv.querySelector('.vdt-lv-body').innerHTML = [...sites].map((site) => `<div class="vdt-lv-row" data-site="${esc(site)}"><span>${esc(site)}</span></div>`).join('');
                };
                draw();
                ctx.store.sites = sites;
                ctx.on(5403, 'click', () => {
                    const v = String(ctx.get(5404) || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
                    if (!v) return;
                    sites.add(v);
                    ctx.set(5404, '');
                    draw();
                });
                ctx.on(5406, 'click', () => {
                    const row = lv.querySelector('.vdt-lv-row.is-selected');
                    if (row) { sites.delete(row.dataset.site); draw(); }
                });
                ctx.on(5413, 'click', () => { sites.clear(); draw(); });
            },
            async ok(ctx) {
                const r = R();
                if (!r) return;
                const before = list();
                const patch = {};
                before.forEach((s) => { if (!ctx.store.sites.has(s)) patch[s] = null; });
                ctx.store.sites.forEach((s) => { patch[s] = 0; });
                await r.set(KEY.allow, patch);
                if (!chromeSites) return;
                const exceptions = [];
                chromeSites.forEach((p) => { if (!ctx.store.sites.has(siteLabel(p))) exceptions.push({ type: 'popups', pattern: p, setting: null }); });
                ctx.store.sites.forEach((site) => {
                    const pattern = sitePattern(site);
                    if (pattern && !chromeSites.includes(pattern)) exceptions.push({ type: 'popups', pattern, setting: 'allow' });
                });
                if (exceptions.length) await chromeSave({ exceptions });
            }
        });
    }

    const LANGUAGES = [
        ['en-US', 'English (United States)'], ['en-GB', 'English (United Kingdom)'], ['ja', 'Japanese'], ['ja-JP', 'Japanese (Japan)'],
        ['zh-CN', 'Chinese (People\'s Republic of China)'], ['zh-TW', 'Chinese (Taiwan)'], ['ko', 'Korean'], ['fr', 'French'],
        ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian'], ['pt-BR', 'Portuguese (Brazil)'], ['ru', 'Russian'],
        ['nl', 'Dutch'], ['pl', 'Polish'], ['sv', 'Swedish'], ['fi', 'Finnish'], ['ar', 'Arabic'], ['he', 'Hebrew'], ['th', 'Thai']
    ];
    const langLabel = (code) => {
        const hit = LANGUAGES.find(([c]) => c.toLowerCase() === code.toLowerCase());
        return `${hit ? hit[1] : code} [${code}]`;
    };

    async function languages(owner) {
        const browser = (root.navigator && root.navigator.languages && root.navigator.languages.length) ? root.navigator.languages.join(',') : 'en-US';
        // Alchemy's own list (Chromium's Accept-Language) when it is running
        const chrome = await chromeRead().catch(() => null);
        const own = chrome && chrome.prefs && (chrome.prefs['intl.selected_languages'] || chrome.prefs['intl.accept_languages']);
        let order = String(own || reg(KEY.intl, 'AcceptLanguage', browser)).split(',').map((s) => s.trim()).filter(Boolean);
        return regDialog({
            id: 'cplInetLanguages',
            tplKey: 'inetcpl:4448',
            key: KEY.main,
            owner,
            fields: [
                { id: 1482, name: 'NoWwwPrefix', type: 'check', def: false },
                { id: 1480, key: KEY.intl, name: 'URLSuffix', type: 'text', def: 'com' }
            ],
            init(ctx) {
                const draw = (sel) => ctx.options(1441, order.map((c) => ({ value: c, text: langLabel(c) })), sel);
                draw(order[0]);
                const move = (d) => {
                    const c = ctx.get(1441);
                    const i = order.indexOf(c);
                    const j = i + d;
                    if (i < 0 || j < 0 || j >= order.length) return;
                    [order[i], order[j]] = [order[j], order[i]];
                    draw(c);
                };
                ctx.on(1442, 'click', () => move(-1));
                ctx.on(1443, 'click', () => move(1));
                ctx.on(1445, 'click', () => {
                    const c = ctx.get(1441);
                    if (order.length > 1) { order = order.filter((x) => x !== c); draw(order[0]); }
                });
                ctx.on(1444, 'click', () => V().openDialog({
                    id: 'cplInetAddLanguage',
                    key: 'inetcpl:4449',
                    owner: ctx.modal,
                icon: ICON,
                title: titleOf('inetcpl:4449'),
                    init(sub) { sub.options(1446, LANGUAGES.filter(([c]) => !order.includes(c)).map(([c, n]) => ({ value: c, text: `${n} [${c}]` }))); },
                    ok(sub) {
                        const own = String(sub.get(1447) || '').trim();
                        const pick = own || sub.get(1446);
                        if (pick && !order.includes(pick)) { order.push(pick); draw(pick); }
                    }
                }));
            },
            async ok() {
                if (R()) await R().set(KEY.intl, { AcceptLanguage: order.join(',') });
                if (chrome) await chromeSave({ prefs: { 'intl.accept_languages': order.join(','), 'intl.selected_languages': order.join(',') } });
            }
        });
    }

    const FONTS = ['Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Lucida Console', 'Lucida Sans Unicode', 'Meiryo', 'MS Gothic', 'MS Mincho', 'Palatino Linotype', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

    // the language scripts of the Fonts dialog and Chromium's script codes (webkit.webprefs.fonts.<kind>.<code>)
    const FONT_SCRIPTS = [['Latin based', 'Zyyy'], ['Japanese', 'Jpan'], ['Chinese Simplified', 'Hans'], ['Chinese Traditional', 'Hant'],
        ['Korean', 'Hang'], ['Cyrillic', 'Cyrl'], ['Greek', 'Grek'], ['Arabic', 'Arab'], ['Hebrew', 'Hebr']];

    async function fonts(owner) {
        const chrome = await chromeRead({ fonts: true }).catch(() => null);
        const all = chrome && chrome.fontList && chrome.fontList.length ? chrome.fontList : FONTS;
        const fixedLike = all.filter((f) => /mono|courier|consol|console|gothic|fixed|code/i.test(f));
        const chosen = {};
        FONT_SCRIPTS.forEach(([, code]) => { chosen[code] = Object.assign({}, (chrome && chrome.fonts && chrome.fonts[code]) || {}); });
        const codeOf = (label) => (FONT_SCRIPTS.find(([l]) => l === label) || FONT_SCRIPTS[0])[1];
        return regDialog({
            id: 'cplInetFonts',
            tplKey: 'inetcpl:1000',
            key: KEY.scripts,
            owner,
            fields: [
                { id: 1002, name: 'Script', type: 'select', def: 'Latin based', options: FONT_SCRIPTS.map(([l]) => l) },
                { id: 1005, name: 'IEPropFontName', type: 'list', def: 'Times New Roman', options: all },
                { id: 1007, name: 'IEFixedFontName', type: 'list', def: 'Courier New', options: fixedLike.length ? fixedLike : all }
            ],
            init(ctx) {
                if (!chrome) return;
                // each script shows Alchemy's own fonts; a change is kept per script until OK
                let code = codeOf(ctx.get(1002));
                const show = () => {
                    const c = chosen[code] || {};
                    if (c.standard) ctx.set(1005, c.standard);
                    if (c.fixed) ctx.set(1007, c.fixed);
                };
                const keep = () => { chosen[code] = { standard: ctx.get(1005), fixed: ctx.get(1007) }; };
                show();
                ctx.on(1005, 'change', keep);
                ctx.on(1007, 'change', keep);
                ctx.on(1002, 'change', () => { code = codeOf(ctx.get(1002)); show(); });
            },
            async ok() {
                if (!chrome) return;
                const prefs = {};
                FONT_SCRIPTS.forEach(([, code]) => {
                    const was = (chrome.fonts && chrome.fonts[code]) || {};
                    const now = chosen[code] || {};
                    if (now.standard && now.standard !== was.standard) prefs[`webkit.webprefs.fonts.standard.${code}`] = now.standard;
                    if (now.fixed && now.fixed !== was.fixed) prefs[`webkit.webprefs.fonts.fixed.${code}`] = now.fixed;
                });
                if (Object.keys(prefs).length) await chromeSave({ prefs });
            }
        });
    }

    /** Colors: the swatch buttons (BS_OWNERDRAW 108-112) pick through the browser's colour well. */
    function colors(owner) {
        const SW = { 108: ['Text Color', '#000000'], 109: ['Background Color', '#ffffff'], 111: ['Anchor Color Visited', '#800080'], 110: ['Anchor Color', '#0000ff'], 112: ['Anchor Color Hover', '#ff0000'] };
        const values = {};
        Object.entries(SW).forEach(([id, [name, def]]) => { values[id] = reg(KEY.colors, name, def); });
        const overrides = {};
        Object.entries(SW).forEach(([id]) => {
            const label = { 108: '&Text:', 109: '&Background:', 111: 'V&isited:', 110: 'U&nvisited:', 112: 'H&over:' }[id];
            overrides[id] = { html: `<label class="cpl-inet-swatch"><span>${V().label(label)}</span>${V().colorWellHtml({ value: values[id] })}</label>` };
        });
        return regDialog({
            id: 'cplInetColors',
            tplKey: 'inetcpl:102',
            key: KEY.colors,
            owner,
            overrides,
            fields: [
                { id: 1524, name: 'Use Anchor Hover Color', type: 'check', def: false },
                { id: 107, name: 'Use System Colors', type: 'check', def: true }
            ],
            init(ctx) {
                Object.keys(SW).forEach((id) => { const w = ctx.holder(Number(id)).querySelector('.vdt-colorwell'); if (w) V().colorWell(w); });
                const sync = () => {
                    const sys = !!ctx.get(107);
                    [108, 109].forEach((id) => { const i = ctx.holder(id).querySelector('.vdt-colorwell'); if (i) i.disabled = sys; });
                    const hover = ctx.holder(112).querySelector('.vdt-colorwell');
                    if (hover) hover.disabled = !ctx.get(1524);
                };
                ctx.on(107, 'change', sync);
                ctx.on(1524, 'change', sync);
                sync();
            },
            async ok(ctx) {
                const patch = {};
                Object.entries(SW).forEach(([id, [name]]) => {
                    const i = ctx.holder(Number(id)).querySelector('.vdt-colorwell');
                    if (i) patch[name] = i.value;
                });
                if (R()) await R().set(KEY.colors, patch);
            }
        });
    }

    function accessibility(owner) {
        return regDialog({
            id: 'cplInetAccessibility',
            tplKey: 'inetcpl:4457',
            key: KEY.main,
            owner,
            fields: [
                { id: 1498, key: KEY.colors, name: 'Always Use My Colors', type: 'check', def: false },
                { id: 1499, key: KEY.colors, name: 'Always Use My Font Face', type: 'check', def: false },
                { id: 1500, key: KEY.colors, name: 'Always Use My Font Size', type: 'check', def: false },
                { id: 1012, key: KEY.styles, name: 'Use My Stylesheet', type: 'check', def: false },
                { id: 1529, key: KEY.styles, name: 'User Stylesheet', type: 'text', def: '' }
            ],
            init(ctx) {
                const sync = () => { const on = !!ctx.get(1012); [4730, 1529, 1525].forEach((id) => ctx.enable(id, on)); };
                ctx.on(1012, 'change', sync);
                sync();
                ctx.on(1525, 'click', () => {
                    if (typeof root.studioOpenFolderDialog !== 'function') return;
                    root.studioOpenFolderDialog('open', { host: { title: 'Open', typeLabel: 'Style Sheets (*.css)', acceptItem: (it) => /\.css$/i.test(it.name || ''), onOpen: (item, folder) => ctx.set(1529, `${folder || ''}/${item.name}`.replace(/^\/+/, '/')) } });
                });
            }
        });
    }

    async function autoComplete(owner) {
        // Forms: Chromium's autofill (addresses and cards); User names and passwords: its password manager
        const chrome = await chromeRead().catch(() => null);
        const pr = (chrome && chrome.prefs) || null;
        return regDialog({
            id: 'cplInetAutoComplete',
            tplKey: 'inetcpl:750',
            key: KEY.main,
            owner,
            fields: [
                { id: 756, name: 'Use AutoComplete', type: 'check', def: true },
                { id: 757, name: 'Use FormSuggest', type: 'check', def: pr ? pr['autofill.profile_enabled'] !== false : false },
                { id: 759, name: 'FormSuggest Passwords', type: 'check', def: pr ? pr.credentials_enable_service !== false : false },
                { id: 761, name: 'FormSuggest PW Ask', type: 'check', def: true }
            ],
            init(ctx) {
                if (pr) {
                    ctx.set(757, pr['autofill.profile_enabled'] !== false);
                    ctx.set(759, pr.credentials_enable_service !== false);
                }
                const sync = () => ctx.enable(761, !!ctx.get(759));
                ctx.on(759, 'change', sync);
                sync();
            },
            async ok(ctx) {
                if (!pr) return;
                const forms = !!ctx.get(757);
                const passwords = !!ctx.get(759);
                const prefs = {};
                if (forms !== (pr['autofill.profile_enabled'] !== false)) Object.assign(prefs, { 'autofill.profile_enabled': forms, 'autofill.credit_card_enabled': forms });
                if (passwords !== (pr.credentials_enable_service !== false)) prefs.credentials_enable_service = passwords;
                if (Object.keys(prefs).length) await chromeSave({ prefs });
            }
        });
    }

    function feeds(owner) {
        return regDialog({
            id: 'cplInetFeeds',
            tplKey: 'inetcpl:772',
            key: KEY.feeds,
            owner,
            overrides: { 775: { disabled: false } },
            fields: [
                { id: 774, name: 'SyncStatus', type: 'check', def: true },
                { id: 775, name: 'SyncInterval', type: 'select', def: 1440, options: [{ value: 15, text: '15 minutes' }, { value: 30, text: '30 minutes' }, { value: 60, text: '1 hour' }, { value: 240, text: '4 hours' }, { value: 1440, text: '1 day' }, { value: 10080, text: '1 week' }] },
                { id: 785, name: 'AutoMarkAsReadOnView', type: 'check', def: false },
                { id: 776, name: 'TurnOnFeedReadingView', type: 'check', def: true },
                { id: 773, name: 'PlaySoundOnFeedFound', type: 'check', def: false }
            ],
            init(ctx) {
                const sync = () => { const on = !!ctx.get(774); ctx.enable(777, on); ctx.enable(775, on); };
                ctx.on(774, 'change', sync);
                sync();
            }
        });
    }

    async function privacyAdvanced(owner) {
        const chrome = await chromeRead().catch(() => null);
        return regDialog({
            id: 'cplInetPrivacyAdvanced',
            tplKey: 'inetcpl:5320',
            key: KEY.privacy,
            owner,
            fields: [
                { id: 5321, name: 'OverrideCookies', type: 'check', def: false },
                { radios: { 5322: 'accept', 5323: 'block', 5324: 'prompt' }, name: 'FirstParty', def: 'accept' },
                { radios: { 5325: 'accept', 5326: 'block', 5327: 'prompt' }, name: 'ThirdParty', def: 'accept' },
                { id: 5328, name: 'AlwaysAllowSession', type: 'check', def: false }
            ],
            init(ctx) {
                if (chrome && chrome.content) {
                    const first = chrome.content.cookies === 'block' ? 'block' : 'accept';
                    const third = Number(chrome.prefs['profile.cookie_controls_mode']) === 0 ? 'accept' : 'block';
                    if (ctx.get(5321)) {
                        ctx.set(first === 'block' ? 5323 : 5322, true);
                        ctx.set(third === 'block' ? 5326 : 5325, true);
                        ctx.set(5328, chrome.content.cookies === 'session_only');
                    }
                }
                const sync = () => { const on = !!ctx.get(5321); [5331, 5322, 5323, 5324, 5332, 5325, 5326, 5327, 5328].forEach((id) => ctx.enable(id, on)); };
                ctx.on(5321, 'change', sync);
                sync();
            },
            async ok(ctx) {
                if (!chrome || !ctx.get(5321)) return;
                // first party: accept, or block (session cookies still allowed: Chromium's "clear on exit");
                // third party: accept, or block (Prompt counts as block)
                const firstBlock = !!(ctx.get(5323) || ctx.get(5324));
                const thirdBlock = !!(ctx.get(5326) || ctx.get(5327));
                const cookies = firstBlock ? (ctx.get(5328) ? 'session_only' : 'block') : 'allow';
                await chromeSave({ content: { cookies }, prefs: { 'profile.cookie_controls_mode': thirdBlock ? 2 : 0 } });
            }
        });
    }

    /** Privacy > Sites: Per Site Privacy Actions, Chromium's cookie rules for sites (allow / block). */
    const PER_SITE_TPL = {"t":"Per Site Privacy Actions","w":290,"h":268,"f":["MS Shell Dlg",8],"s":2160591040,"c":[[65535,"B",7,7,275,234,1342177287,"Manage Sites",0],[5335,"S",13,17,21,20,1342177283,"#1307",0],[65535,"S",41,19,235,19,1342308352,"You can specify which websites are always or never allowed to use cookies, regardless of their privacy policy.",0],[65535,"S",16,40,257,25,1342308352,"Type the exact address of the website you want to manage, and then click Allow or Block.",0],[65535,"S",16,63,257,18,1342308352,"To remove a site from the list of managed sites, select the name of the website and click the Remove button.",0],[65535,"S",17,87,100,9,1342308352,"Address of &website:",0],[5374,"E",16,98,201,14,1350631552,"",0],[5376,"B",224,98,50,14,1342242817,"&Block",0],[5375,"B",224,116,50,14,1342242816,"&Allow",0],[65535,"S",17,133,95,9,1342308352,"Managed web&sites:",0],[5378,"SysListView32",16,145,201,86,1350631437,"Managed websites",0],[5377,"B",224,145,50,14,1476460544,"&Remove",0],[5379,"B",224,163,50,15,1476460544,"Re&move all",0],[1,"B",232,247,50,14,1342242816,"OK",0]]};

    async function perSitePrivacy(owner) {
        const chrome = await chromeRead().catch(() => null);
        if (!chrome) { toast('error', 'Alchemy is not running'); return null; }
        const rules = new Map(((chrome.exceptions && chrome.exceptions.cookies) || []).filter((e) => !e.embedding).map((e) => [e.pattern, e.setting]));
        const before = new Map(rules);
        return V().openDialog({
            id: 'cplInetPerSite',
            key: 'inetcpl:5371',
            tpl: PER_SITE_TPL,
            owner,
            icon: ICON,
            title: PER_SITE_TPL.t,
            init(ctx) {
                const lv = ctx.holder(5378);
                lv.classList.add('is-report');
                lv.querySelector('.vdt-lv-header').innerHTML = '<span class="vdt-lv-col cpl-inet-w200">Domain</span><span class="vdt-lv-col cpl-inet-w90">Setting</span>';
                const draw = () => {
                    lv.querySelector('.vdt-lv-body').innerHTML = [...rules.entries()].sort().map(([p, v]) => `<div class="vdt-lv-row" data-site="${esc(p)}"><span class="cpl-inet-w200">${esc(siteLabel(p))}</span><span class="cpl-inet-w90">${v === 'block' ? 'Always Block' : 'Always Allow'}</span></div>`).join('');
                    ctx.enable(5379, rules.size > 0);
                    ctx.enable(5377, false);
                };
                draw();
                lv.addEventListener('click', () => ctx.enable(5377, !!lv.querySelector('.vdt-lv-row.is-selected')));
                const add = (setting) => {
                    const pattern = sitePattern(ctx.get(5374));
                    if (!pattern) { toast('error', 'Type a website address, for example www.example.com'); return; }
                    rules.set(pattern, setting);
                    ctx.set(5374, '');
                    draw();
                };
                ctx.on(5376, 'click', () => add('block'));
                ctx.on(5375, 'click', () => add('allow'));
                ctx.on(5377, 'click', () => { const row = lv.querySelector('.vdt-lv-row.is-selected'); if (row) { rules.delete(row.dataset.site); draw(); } });
                ctx.on(5379, 'click', () => { rules.clear(); draw(); });
            },
            async ok() {
                const exceptions = [];
                before.forEach((v, p) => { if (!rules.has(p)) exceptions.push({ type: 'cookies', pattern: p, setting: null }); });
                rules.forEach((v, p) => { if (before.get(p) !== v) exceptions.push({ type: 'cookies', pattern: p, setting: v }); });
                if (exceptions.length) await chromeSave({ exceptions });
            }
        });
    }

    /** Reset: Grimoire's settings to their defaults, all browsing data deleted, Alchemy restarted. */
    function reset(owner, done) {
        return V().openDialog({
            id: 'cplInetReset',
            key: 'inetcpl:6600',
            owner,
                icon: ICON,
                title: titleOf('inetcpl:6600'),
            init(ctx) {
                ctx.content.querySelectorAll('.vdt-static .vdt-st-text').forEach((n) => { n.innerHTML = grimoire(n.innerHTML); });
            },
            async ok() {
                const s = await alchemySettings().catch(() => ({}));
                const keep = { bookmarks: s.bookmarks };
                try {
                    await saveAlchemy({ ...ALCHEMY_DEFAULTS, ...keep });
                    await clearBrowsingData({ cache: true, cookies: true, history: true, forms: true, passwords: true });
                    // Alchemy's Chromium: the Internet zone at Medium-high, cookies at Medium, Safe Browsing on, no proxy
                    const pc = privacyToChrome(2);
                    await chromeWrite({
                        content: Object.assign({}, ZONE_PRESETS[3], pc.content),
                        prefs: Object.assign({ 'safebrowsing.enabled': true, 'safebrowsing.enhanced': false }, pc.prefs),
                        launch: { popupBlocker: false, diskCacheMb: 0, proxyMode: 'direct', proxyServer: '', proxyBypass: '', proxyBypassLocal: false, proxyPacUrl: '' }
                    }).catch(() => null);
                    const r = R();
                    if (r) await Promise.all([KEY.tabs, KEY.popups, KEY.intl, KEY.colors, KEY.styles, `${KEY.main}\\Advanced`].map((k) => r.set(k, null)));
                    await fetch('/api/grimoire-browser/restart', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
                    toast('success', 'Grimoire settings were reset');
                    if (done) done();
                } catch (_) {
                    toast('error', 'Grimoire settings could not be reset');
                }
            }
        });
    }


    // ---- Security: the zones' sites and Custom level -----------------------------------------------

    /** Security > Sites for Trusted sites / Restricted sites (inetcpl 101): each site's Chromium rules (SITE_RULES). */
    const ZONE_SITES_TPL = {"t":"","w":252,"h":191,"f":["MS Shell Dlg",8],"s":2160591048,"c":[[1518,"S",9,11,20,20,1342177283,"",0],[-1,"S",37,11,206,17,1342308352,"You can add and remove websites from this zone. All websites in this zone will use the zone's security settings.",0],[-1,"S",9,47,150,8,1342308352,"A&dd this website to the zone:",0],[1010,"E",9,57,177,12,1350631552,"",0],[1028,"B",193,56,50,14,1476460544,"&Add",0],[-1,"S",9,78,98,8,1342308352,"&Websites:",0],[1026,"SysListView32",9,88,177,49,1353826333,"Websites:",0],[1003,"B",193,88,50,14,1342242816,"&Remove",0],[1023,"B",9,142,234,10,1342242819,"Require &server verification (https:) for all sites in this zone",0],[2,"B",193,168,50,14,1342242817,"&Close",0]]};

    async function zoneSitesDialog(owner, zone, icon, done) {
        const chrome = await chromeRead().catch(() => null);
        if (!chrome) { toast('error', 'Alchemy is not running'); return null; }
        const sites = zoneSites(chrome, zone);
        const title = zone === 'trusted' ? 'Trusted sites' : 'Restricted sites';
        return V().openDialog({
            id: `cplInetZoneSites-${zone}`,
            tpl: Object.assign({}, ZONE_SITES_TPL, { t: title }),
            owner,
            icon: ICON,
            title,
            overrides: { 1518: { html: `<img src="${esc(icon)}" alt="" width="32" height="32">` } },
            init(ctx) {
                const lv = ctx.holder(1026);
                lv.classList.add('is-report', 'no-header');
                // Trusted sites asks for https by default, as IE does
                ctx.set(1023, zone === 'trusted' && !sites.some((p) => !p.startsWith('https://')));
                const draw = () => {
                    lv.querySelector('.vdt-lv-body').innerHTML = sites.slice().sort().map((p) => `<div class="vdt-lv-row" data-site="${esc(p)}"><span>${esc(p.startsWith('https://') ? siteLabel(p) : `*.${siteLabel(p)}`)}</span></div>`).join('');
                };
                draw();
                const write = async (patch) => {
                    const saved = await chromeSave({ exceptions: patch });
                    if (saved && done) done(saved);
                };
                ctx.on(1010, 'input', () => ctx.enable(1028, !!String(ctx.get(1010) || '').trim()));
                ctx.on(1028, 'click', async () => {
                    const pattern = sitePattern(ctx.get(1010), !!ctx.get(1023));
                    if (!pattern) { toast('error', 'Type a website address, for example https://www.example.com'); return; }
                    if (sites.includes(pattern)) return;
                    // a site is in one zone at a time
                    const other = zone === 'trusted' ? 'restricted' : 'trusted';
                    await write(siteRules(pattern, other, false).concat(siteRules(pattern, zone, true)));
                    sites.push(pattern);
                    ctx.set(1010, '');
                    ctx.enable(1028, false);
                    draw();
                });
                ctx.on(1003, 'click', async () => {
                    const row = lv.querySelector('.vdt-lv-row.is-selected');
                    if (!row) return;
                    await write(siteRules(row.dataset.site, zone, false));
                    sites.splice(sites.indexOf(row.dataset.site), 1);
                    draw();
                });
            }
        });
    }

    /** Security > Custom level (inetcpl 118): the Internet zone's Chromium defaults, as IE's settings tree. */
    const CUSTOM_LEVEL_TPL = {"t":"Security Settings - Internet Zone","w":274,"h":275,"f":["MS Shell Dlg",8],"s":2160591048,"c":[[-1,"B",8,6,258,193,1342177287,"Settings",0],[1024,"SysTreeView32",18,19,236,166,1350631444,"Tree1",0],[-1,"S",18,187,216,10,1342308352,"*Takes effect after you restart Alchemy",0],[1514,"B",8,204,258,37,1342177287,"Reset custom settings",0],[-1,"S",14,216,30,8,1342308352,"&Reset to:",0],[1022,"C",56,216,132,43,1344340995,"",0],[1020,"B",202,215,52,14,1342242816,"R&eset...",0],[1,"B",152,248,53,14,1342242817,"OK",0],[2,"B",211,248,53,14,1342242816,"Cancel",0]]};
    // [group, [label, content type, [[choice label, setting], ...]]]
    const CUSTOM_ROWS = [
        ['Downloads', [['Automatic prompting for file downloads', 'multiple-automatic-downloads', [['Disable', 'block'], ['Enable', 'ask']]]]],
        ['Miscellaneous', [
            ['Display mixed content', 'mixed-script', [['Disable', 'block'], ['Enable', 'allow']]],
            ['Use Pop-up Blocker', 'popups', [['Disable', 'allow'], ['Enable', 'block']]]
        ]],
        ['Scripting', [['Active scripting', 'javascript', [['Disable', 'block'], ['Enable', 'allow']]]]],
        // what Chromium asks a site's user for, which IE did not have
        ['Website permissions', [
            ['Camera', 'media-stream-camera', [['Disable', 'block'], ['Prompt', 'ask']]],
            ['Location', 'location', [['Disable', 'block'], ['Prompt', 'ask']]],
            ['Microphone', 'media-stream-mic', [['Disable', 'block'], ['Prompt', 'ask']]],
            ['Notifications', 'notifications', [['Disable', 'block'], ['Prompt', 'ask']]],
            ['Sound', 'sound', [['Disable', 'block'], ['Enable', 'allow']]]
        ]]
    ];
    const LEVEL_NAMES = ['Low', 'Medium-low', 'Medium', 'Medium-high', 'High'];

    async function customLevel(owner, done) {
        const chrome = await chromeRead().catch(() => null);
        if (!chrome) { toast('error', 'Alchemy is not running'); return null; }
        const values = Object.assign({}, chrome.content);
        const tree = () => {
            let n = 0;
            return CUSTOM_ROWS.map(([group, rows]) => [`<div class="tbp-tree-row is-node"><span>${esc(group)}</span></div>`, ...rows.map(([label, type, choices]) => [
                `<div class="tbp-tree-row is-child cpl-fo-sub"><img src="/static_images/vista-icons/explorer/folder-16.png" alt="" onerror="this.remove()"><span>${esc(label)}</span></div>`,
                ...choices.map(([text, setting]) => {
                    n += 1;
                    return `<div class="tbp-tree-row is-child cpl-fo-radio"><input type="radio" name="cpl-cl-${type}" id="cpl-cl-${n}" data-cl="${type}" value="${setting}"${values[type] === setting ? ' checked' : ''}><label for="cpl-cl-${n}">${esc(text)}</label></div>`;
                })
            ].join(''))].join('')).join('');
        };
        return V().openDialog({
            id: 'cplInetCustomLevel',
            key: 'inetcpl:118',
            tpl: CUSTOM_LEVEL_TPL,
            owner,
            icon: ICON,
            title: CUSTOM_LEVEL_TPL.t,
            overrides: { 1024: { html: '', cls: 'tbp-tree cpl-ia-tree' } },
            init(ctx) {
                const holder = ctx.holder(1024);
                holder.innerHTML = tree();
                holder.addEventListener('change', (ev) => { if (ev.target.dataset.cl) values[ev.target.dataset.cl] = ev.target.value; });
                ctx.options(1022, LEVEL_NAMES.map((l, i) => ({ value: String(i), text: `${l}${i === 3 ? ' (default)' : ''}` })).reverse(), '3');
                ctx.on(1020, 'click', () => {
                    Object.assign(values, ZONE_PRESETS[Number(ctx.get(1022))] || ZONE_PRESETS[3]);
                    holder.innerHTML = tree();
                });
            },
            async ok() {
                const content = {};
                CUSTOM_ROWS.forEach(([, rows]) => rows.forEach(([, type]) => { if (values[type] && values[type] !== chrome.content[type]) content[type] = values[type]; }));
                const saved = Object.keys(content).length ? await chromeSave({ content }) : null;
                if (done) done(saved, values);
            }
        });
    }

    // ---- Connections: LAN settings and the proxy ----------------------------------------------------

    /** LAN Settings (inetcpl 4452 without its dial-up group, as inetcpl shows it for the LAN): Alchemy's proxy. */
    const LAN_TPL = {"t":"Local Area Network (LAN) Settings","w":252,"h":187,"f":["MS Shell Dlg",8],"s":2160591048,"c":[[1611,"B",7,7,238,79,1342308359,"Automatic configuration",0],[-1,"S",14,18,224,16,1342308352,"Automatic configuration may override manual settings.  To ensure the use of manual settings, disable automatic configuration.",0],[1573,"B",14,39,218,10,1342373891,"&Automatically detect settings",0],[1569,"B",14,52,208,10,1342242819,"Use automatic configuration &script",0],[1572,"S",26,68,33,8,1342308352,"Add&ress",0],[1571,"E",62,65,123,14,1350631552,"",0],[1586,"B",7,88,238,72,1342177287,"Proxy server",0],[1570,"B",14,100,224,20,1342382083,"Use a pro&xy server for your LAN (These settings will not apply to dial-up or VPN connections).",0],[1471,"S",26,126,31,8,1342308352,"Addr&ess:",0],[1460,"E",62,124,58,12,1350631552,"",0],[1410,"S",130,126,18,8,1342177280,"Por&t:",0],[1461,"E",153,124,32,12,1350639744,"",0],[1555,"B",188,124,50,14,1342373888,"Advan&ced",0],[1119,"B",26,140,177,11,1342373891,"&Bypass proxy server for local addresses",0],[1,"B",139,166,50,14,1342373889,"OK",0],[2,"B",195,166,50,14,1342242816,"Cancel",0]]};

    /** "host:port" or "http=a:1;https=b:2" (Chromium's --proxy-server) <-> the Proxy Settings rows */
    function parseProxy(server) {
        const out = { http: '', https: '', ftp: '', socks: '', same: true };
        const list = String(server || '').split(';').filter(Boolean);
        if (!list.length) return out;
        if (list.length === 1 && !list[0].includes('=')) {
            const one = list[0].replace(/^socks5?:\/\//, '');
            out.http = out.https = out.ftp = one;
            if (/^socks/.test(list[0])) { out.socks = one; out.http = out.https = out.ftp = ''; out.same = false; }
            return out;
        }
        out.same = false;
        list.forEach((part) => {
            const [scheme, value] = part.split('=');
            if (scheme === 'socks') out.socks = String(value || '').replace(/^socks5?:\/\//, '');
            else if (out[scheme] !== undefined) out[scheme] = value || '';
        });
        return out;
    }

    function proxyString(p) {
        if (p.same && p.http) return p.http;
        return [['http', p.http], ['https', p.https], ['ftp', p.ftp], ['socks', p.socks ? `socks5://${p.socks}` : '']].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(';');
    }

    const hostPort = (v) => { const m = /^(.*?)(?::(\d+))?$/.exec(String(v || '')); return [m[1] || '', m[2] || '']; };

    async function lanSettings(owner) {
        const chrome = await chromeRead().catch(() => null);
        if (!chrome) { toast('error', 'Alchemy is not running'); return null; }
        const launch = Object.assign({}, chrome.launch);
        let proxy = parseProxy(launch.proxyServer);
        let bypass = launch.proxyBypass || '';
        return V().openDialog({
            id: 'cplInetLan',
            key: 'inetcpl:4452',
            tpl: LAN_TPL,
            owner,
            icon: ICON,
            title: LAN_TPL.t,
            init(ctx) {
                ctx.set(1573, launch.proxyMode === 'auto');
                ctx.set(1569, launch.proxyMode === 'pac');
                ctx.set(1571, launch.proxyPacUrl || '');
                ctx.set(1570, launch.proxyMode === 'fixed');
                const [h, port] = hostPort(proxy.same ? proxy.http : '');
                ctx.set(1460, h);
                ctx.set(1461, port);
                ctx.set(1119, !!launch.proxyBypassLocal);
                const sync = () => {
                    const pac = !!ctx.get(1569);
                    ctx.enable(1572, pac); ctx.enable(1571, pac);
                    const on = !!ctx.get(1570);
                    const one = proxy.same;
                    [1471, 1460, 1410, 1461].forEach((id) => ctx.enable(id, on && one));
                    ctx.enable(1555, on);
                    ctx.enable(1119, on);
                };
                [1573, 1569, 1570].forEach((id) => ctx.on(id, 'change', sync));
                sync();
                ctx.on(1555, 'click', () => {
                    if (proxy.same) { const a = String(ctx.get(1460) || '').trim(); const pt = String(ctx.get(1461) || '').trim(); proxy.http = a ? (pt ? `${a}:${pt}` : a) : ''; proxy.https = proxy.ftp = proxy.http; }
                    proxyAdvanced(ctx.modal, proxy, bypass, (next, nextBypass) => {
                        proxy = next; bypass = nextBypass;
                        const [hh, pp] = hostPort(proxy.same ? proxy.http : '');
                        ctx.set(1460, proxy.same ? hh : ''); ctx.set(1461, proxy.same ? pp : '');
                        sync();
                    });
                });
            },
            async ok(ctx) {
                if (proxy.same) {
                    const a = String(ctx.get(1460) || '').trim();
                    const pt = String(ctx.get(1461) || '').trim();
                    proxy.http = proxy.https = proxy.ftp = a ? (pt ? `${a}:${pt}` : a) : '';
                }
                // Chromium takes one: a script, else detection, else the proxy server
                const mode = ctx.get(1569) && String(ctx.get(1571) || '').trim() ? 'pac' : (ctx.get(1573) ? 'auto' : (ctx.get(1570) && proxyString(proxy) ? 'fixed' : 'direct'));
                const next = { proxyMode: mode, proxyPacUrl: String(ctx.get(1571) || '').trim(), proxyServer: proxyString(proxy), proxyBypass: bypass, proxyBypassLocal: !!ctx.get(1119) };
                const changed = Object.keys(next).some((k) => String(next[k]) !== String(launch[k]));
                if (changed) await offerRelaunch(await chromeSave({ launch: next }));
            }
        });
    }

    /** LAN Settings > Advanced: Proxy Settings (inetcpl 1100), per-protocol servers and the exceptions. */
    function proxyAdvanced(owner, proxy, bypass, done) {
        const rows = [['http', 1101, 1102], ['https', 1103, 1104], ['ftp', 1105, 1106], ['socks', 1109, 1110]];
        return V().openDialog({
            id: 'cplInetProxy',
            key: 'inetcpl:1100',
            owner,
            icon: ICON,
            title: titleOf('inetcpl:1100'),
            init(ctx) {
                rows.forEach(([k, a, b]) => { const [h, p] = hostPort(proxy[k]); if (ctx.el(a)) ctx.set(a, h); if (ctx.el(b)) ctx.set(b, p); });
                ctx.set(1118, !!proxy.same);
                ctx.set(1107, String(bypass || '').split(';').filter(Boolean).join(';'));
                const sync = () => {
                    const same = !!ctx.get(1118);
                    rows.slice(1).forEach(([, a, b]) => { ctx.enable(a, !same); ctx.enable(b, !same); });
                };
                ctx.on(1118, 'change', sync);
                sync();
            },
            ok(ctx) {
                const next = { same: !!ctx.get(1118) };
                rows.forEach(([k, a, b]) => {
                    const h = String((ctx.el(a) && ctx.get(a)) || '').trim();
                    const p = String((ctx.el(b) && ctx.get(b)) || '').trim();
                    next[k] = h ? (p ? `${h}:${p}` : h) : '';
                });
                if (next.same) { next.https = next.ftp = next.http; next.socks = ''; }
                done(next, String(ctx.get(1107) || '').split(/[;,\s]+/).filter(Boolean).join(';'));
            }
        });
    }

    /** Manage Add-ons (ieframe.dll, not in the dump): Alchemy's extensions in inetcpl's metrics, IE7's layout (the
     *  list, then Settings: Enable / Disable, and Delete), applied at Alchemy's next start. */
    const ADDONS_TPL = { t: 'Manage Add-ons', w: 300, h: 236, f: ['MS Shell Dlg', 8], s: 0x80C800C0, c: [
        [-1, 'S', 7, 7, 286, 16, 0x50020000, 'View and manage the add-ons Alchemy has. Add-ons are installed with Alchemy on the Dreamscape server.', 0],
        [101, 'SysListView32', 7, 27, 286, 120, 0x5001000D, '', 0x200],
        [-1, 'B', 7, 152, 140, 56, 0x50000007, 'Settings', 0],
        [-1, 'S', 14, 163, 126, 18, 0x50020000, 'Click an add-on name above and then click Enable or Disable.', 0],
        [102, 'B', 14, 184, 60, 10, 0x50030009, '&Enable', 0],
        [103, 'B', 78, 184, 60, 10, 0x50010009, '&Disable', 0],
        [-1, 'B', 153, 152, 140, 56, 0x50000007, 'Delete add-on', 0],
        [-1, 'S', 160, 163, 126, 18, 0x50020000, 'Click the name of an add-on above and then click Delete.', 0],
        [104, 'B', 236, 186, 50, 14, 0x58010000, 'De&lete', 0],
        [105, 'SysLink', 7, 219, 150, 10, 0x50010000, '<a>Open Alchemy\'s extensions page</a>', 0],
        [1, 'B', 243, 215, 50, 14, 0x50010001, 'OK', 0]
    ] };

    async function addons(owner) {
        let res = await fetch('/api/grimoire-browser/addons', { credentials: 'same-origin' }).catch(() => null);
        let list = null;
        if (res && res.ok) list = ((await res.json().catch(() => ({}))).addons) || [];
        else {
            // an older Dreamscape without the add-ons call: the loaded ones, read only
            res = await fetch('/api/grimoire-browser/extensions', { credentials: 'same-origin' }).catch(() => null);
            list = ((res && res.ok ? await res.json().catch(() => ({})) : {}).extensions || []).map((e) => Object.assign({ enabled: true, readOnly: true }, e));
        }
        let changed = false;
        const send = async (body) => {
            const r = await fetch('/api/grimoire-browser/addons', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
            if (!r || !r.ok) { toast('error', 'Alchemy could not change the add-on'); return false; }
            list = ((await r.json().catch(() => ({}))).addons) || list;
            changed = true;
            return true;
        };
        return V().openDialog({
            id: 'cplInetAddons',
            tpl: ADDONS_TPL,
            owner,
            icon: ICON,
            title: ADDONS_TPL.t,
            init(ctx) {
                const lv = ctx.holder(101);
                lv.classList.add('is-report');
                const cols = [{ t: 'Name', w: 170 }, { t: 'Version', w: 70 }, { t: 'Status', w: 70 }, { t: 'Type', w: 110 }];
                lv.querySelector('.vdt-lv-header').innerHTML = cols.map((c) => `<span class="vdt-lv-col cpl-inet-w${c.w}">${esc(c.t)}</span>`).join('');
                const selected = () => { const row = lv.querySelector('.vdt-lv-row.is-selected'); return row ? list.find((e) => e.id === row.dataset.id) : null; };
                const sync = () => {
                    const ext = selected();
                    const can = !!ext && !ext.readOnly;
                    [102, 103, 104].forEach((id) => ctx.enable(id, can));
                    ctx.set(102, !!ext && ext.enabled);
                    ctx.set(103, !!ext && !ext.enabled);
                };
                const draw = (keep) => {
                    lv.querySelector('.vdt-lv-body').innerHTML = list.length
                        ? list.map((e) => `<div class="vdt-lv-row${e.id === keep ? ' is-selected' : ''}" data-id="${esc(e.id)}"><span class="cpl-inet-w170">${e.icon16 ? `<img src="${esc(e.icon16)}" alt="" width="16" height="16">` : ''}${esc(e.name || e.id)}</span><span class="cpl-inet-w70">${esc(e.version || '')}</span><span class="cpl-inet-w70">${e.enabled ? 'Enabled' : 'Disabled'}</span><span class="cpl-inet-w110">Browser Extension</span></div>`).join('')
                        : '<div class="vdt-lv-row"><span class="cpl-inet-w420">Alchemy has no add-ons.</span></div>';
                    sync();
                };
                draw();
                lv.addEventListener('click', () => setTimeout(sync, 0));
                const toggle = async (enabled) => {
                    const ext = selected();
                    if (!ext || ext.enabled === enabled) return;
                    if (await send({ id: ext.id, enabled })) draw(ext.id);
                };
                ctx.on(102, 'click', () => toggle(true));
                ctx.on(103, 'click', () => toggle(false));
                ctx.on(104, 'click', async () => {
                    const ext = selected();
                    if (!ext) return;
                    const ask = root.browsingRestore && typeof root.browsingRestore.confirm === 'function' ? root.browsingRestore.confirm : null;
                    if (ask && !(await ask(`Delete ${ext.name || 'this add-on'} from Alchemy? Its folder is kept aside on the Dreamscape server.`))) return;
                    if (await send({ id: ext.id, remove: true })) draw();
                });
                ctx.content.querySelectorAll('.vdt-link').forEach((a) => a.addEventListener('click', () => openInGrimoire('chrome://extensions/')));
            },
            async ok() {
                if (changed) await offerRelaunch({ pendingRelaunch: true });
            }
        });
    }

    root.cplInternetOptions = {
        alchemySettings, saveAlchemy, currentPage, clearBrowsingData, SEARCH_PROVIDERS, ALCHEMY_ADVANCED, ALCHEMY_DEFAULTS, KEY,
        PERFORMANCE_ADVANCED, PERFORMANCE_DEFAULTS,
        chrome: { read: chromeRead, write: chromeWrite, save: chromeSave, offerRelaunch, privacyToChrome, privacyFromChrome, ZONE_PRESETS, openInGrimoire },
        open: { deleteHistory, historySettings, search, tabs, popups, languages, fonts, colors, accessibility, autoComplete, feeds, privacyAdvanced, reset, addons,
            perSitePrivacy, zoneSites: zoneSitesDialog, customLevel, lanSettings }
    };
})(typeof window !== 'undefined' ? window : globalThis);
