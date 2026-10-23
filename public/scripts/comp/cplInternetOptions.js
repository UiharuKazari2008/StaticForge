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
 *   Registry only: tabbed browsing, pop-up blocker exceptions, languages, fonts, colors,
 *     accessibility, AutoComplete, feeds, advanced privacy
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
        if (!what.cache && !what.cookies) return true;
        const res = await fetch('/api/grimoire-browser/clear-data', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cache: !!what.cache, cookies: !!what.cookies })
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

    /** inetcpl's Yes / No confirmations (Delete Files, Delete Cookies, ...): resolves true on Yes. */
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
                    6: (ctx) => { answered = true; resolve(true); ctx.close(); },
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
            if (tplKey && !(await confirm(tplKey, owner))) return;
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

    function historySettings(owner) {
        return regDialog({
            id: 'cplInetHistorySettings',
            tplKey: 'inetcpl:700',
            key: KEY.cache,
            owner,
            fields: [
                { radios: { 618: 'visit', 613: 'start', 615: 'auto', 614: 'never' }, name: 'SyncMode', def: 'auto' },
                { id: 611, name: 'CacheLimitMB', type: 'num', def: 50, min: 8, max: 1024 },
                { id: 1492, key: KEY.history, name: 'DaysToKeep', type: 'num', def: 20, min: 0, max: 999 }
            ],
            overrides: { 605: { disabled: true }, 1533: { disabled: true } },
            init(ctx) {
                ctx.text(625, 'Current location:');
                ctx.text(608, 'Alchemy keeps its cache on the Dreamscape server.');
                [[626, 8, 1024], [1493, 0, 999]].forEach(([id, min, max]) => {
                    const h = ctx.holder(id);
                    if (h) { h.dataset.min = String(min); h.dataset.max = String(max); }
                });
                ctx.on(609, 'click', () => {
                    if (typeof root.grimoireOpenUrl === 'function') root.grimoireOpenUrl(root.GRIMOIRE_HISTORY_URL || 'dsap://history.grimoire.jp');
                });
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

    async function search(owner) {
        const s = await alchemySettings();
        let chosen = s.searchProvider || 'grimoire';
        const fill = (ctx) => ctx.options(101, SEARCH_PROVIDERS.map((p) => ({ value: p.id, text: p.id === chosen ? `${p.label} (Default)` : p.label })), ctx.get(101) || chosen);
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
                if (chosen !== s.searchProvider) {
                    try { await saveAlchemy({ searchProvider: chosen }); } catch (_) { toast('error', 'Could not save the search provider'); }
                }
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

    function popups(owner) {
        const list = () => Object.keys((R() && R().getKey(KEY.allow)) || {}).sort();
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

    function languages(owner) {
        const browser = (root.navigator && root.navigator.languages && root.navigator.languages.length) ? root.navigator.languages.join(',') : 'en-US';
        let order = String(reg(KEY.intl, 'AcceptLanguage', browser)).split(',').map((s) => s.trim()).filter(Boolean);
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
            }
        });
    }

    const FONTS = ['Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Lucida Console', 'Lucida Sans Unicode', 'Meiryo', 'MS Gothic', 'MS Mincho', 'Palatino Linotype', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

    function fonts(owner) {
        return regDialog({
            id: 'cplInetFonts',
            tplKey: 'inetcpl:1000',
            key: KEY.scripts,
            owner,
            fields: [
                { id: 1002, name: 'Script', type: 'select', def: 'Latin based', options: ['Latin based', 'Japanese', 'Chinese Simplified', 'Chinese Traditional', 'Korean', 'Cyrillic', 'Greek', 'Arabic', 'Hebrew', 'Thai'] },
                { id: 1005, name: 'IEPropFontName', type: 'list', def: 'Times New Roman', options: FONTS },
                { id: 1007, name: 'IEFixedFontName', type: 'list', def: 'Courier New', options: FONTS.filter((f) => /Courier|Consolas|Lucida Console|MS Gothic/.test(f)) }
            ]
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
            overrides[id] = { html: `<label class="cpl-inet-swatch"><span>${V().label(label)}</span><input type="color" value="${esc(values[id])}"></label>` };
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
                const sync = () => {
                    const sys = !!ctx.get(107);
                    [108, 109].forEach((id) => { const i = ctx.holder(id).querySelector('input'); if (i) i.disabled = sys; });
                    const hover = ctx.holder(112).querySelector('input');
                    if (hover) hover.disabled = !ctx.get(1524);
                };
                ctx.on(107, 'change', sync);
                ctx.on(1524, 'change', sync);
                sync();
            },
            async ok(ctx) {
                const patch = {};
                Object.entries(SW).forEach(([id, [name]]) => {
                    const i = ctx.holder(Number(id)).querySelector('input');
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

    function autoComplete(owner) {
        return regDialog({
            id: 'cplInetAutoComplete',
            tplKey: 'inetcpl:750',
            key: KEY.main,
            owner,
            fields: [
                { id: 756, name: 'Use AutoComplete', type: 'check', def: true },
                { id: 757, name: 'Use FormSuggest', type: 'check', def: false },
                { id: 759, name: 'FormSuggest Passwords', type: 'check', def: false },
                { id: 761, name: 'FormSuggest PW Ask', type: 'check', def: true }
            ],
            init(ctx) {
                const sync = () => ctx.enable(761, !!ctx.get(759));
                ctx.on(759, 'change', sync);
                sync();
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

    function privacyAdvanced(owner) {
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
                const sync = () => { const on = !!ctx.get(5321); [5331, 5322, 5323, 5324, 5332, 5325, 5326, 5327, 5328].forEach((id) => ctx.enable(id, on)); };
                ctx.on(5321, 'change', sync);
                sync();
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

    /** Manage Add-ons (ieframe.dll, not in the dump): the extensions Alchemy loaded, in inetcpl's metrics. */
    const ADDONS_TPL = { t: 'Manage Add-ons', w: 300, h: 196, f: ['MS Shell Dlg', 8], s: 0x80C800C0, c: [
        [-1, 'S', 7, 7, 286, 16, 0x50020000, 'View and manage the add-ons Alchemy has loaded. Add-ons are installed with Alchemy on the Dreamscape server.', 0],
        [101, 'SysListView32', 7, 27, 286, 140, 0x5001000D, '', 0x200],
        [1, 'B', 243, 175, 50, 14, 0x50010001, 'Close', 0]
    ] };

    async function addons(owner) {
        const res = await fetch('/api/grimoire-browser/extensions', { credentials: 'same-origin' }).catch(() => null);
        const data = res && res.ok ? await res.json().catch(() => ({})) : {};
        const list = data.extensions || [];
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
                lv.querySelector('.vdt-lv-header').innerHTML = cols.map((c) => `<span class="vdt-lv-col" style="width:${c.w}px">${esc(c.t)}</span>`).join('');
                lv.querySelector('.vdt-lv-body').innerHTML = list.length
                    ? list.map((e) => `<div class="vdt-lv-row"><span style="width:170px">${esc(e.name || e.id)}</span><span style="width:70px">${esc(e.version || '')}</span><span style="width:70px">Enabled</span><span style="width:110px">Browser Extension</span></div>`).join('')
                    : '<div class="vdt-lv-row"><span style="width:420px">Alchemy has no add-ons loaded.</span></div>';
            }
        });
    }

    root.cplInternetOptions = {
        alchemySettings, saveAlchemy, currentPage, clearBrowsingData, SEARCH_PROVIDERS, ALCHEMY_ADVANCED, ALCHEMY_DEFAULTS, KEY,
        open: { deleteHistory, historySettings, search, tabs, popups, languages, fonts, colors, accessibility, autoComplete, feeds, privacyAdvanced, reset, addons }
    };
})(typeof window !== 'undefined' ? window : globalThis);
