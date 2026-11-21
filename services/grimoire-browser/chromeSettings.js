'use strict';
/**
 * Alchemy's Chromium settings for Grimoire's Internet Options (StaticForge, Yukimi Nov 21 2026: "move as much as
 * the chrome settings into the Internet Options"). Chromium keeps them in its own profile (Preferences, content
 * settings, history, form data, passwords), so they survive every Alchemy restart without a copy here; only what
 * Chromium takes on its command line (proxy, pop-up blocker, disk cache size, add-ons left out) is kept in
 * alchemy-chrome-launch.json and applies at the next launch.
 *
 * How: chrome://settings is opened in a background tab marked #alchemy-quiet (never shown to a viewer, adoptOrphan
 * leaves it alone) and its own APIs do the work: chrome.settingsPrivate for preferences, the site settings handler
 * for content settings and per-site rules, the search engines handler, the clear browsing data handler (history,
 * cache, cookies and site data, form data, passwords: what Chromium's own dialog clears). The tab closes after
 * IDLE_MS without a call. A hidden target (Target.createTarget hidden) crashes SettingsUI: it needs a tab.
 *
 *   GET  /browser/chrome-settings[?fonts=1]   snapshot()
 *   POST /browser/chrome-settings             { prefs, content, exceptions, searchEngine, launch } -> snapshot()
 *   POST /browser/chrome-clear                { history, cache, cookies, forms, passwords, addons }
 *   GET  /browser/addons                      every add-on in the extensions folder, enabled or not
 *   POST /browser/addons                      { id, enabled } | { id, remove: true } (applies at the next launch)
 */
const fs = require('fs');
const path = require('path');

const SETTINGS_URL = 'chrome://settings/';
const IDLE_MS = 30 * 1000;

// the preferences Internet Options reads and writes (all on chrome.settingsPrivate's allowlist)
const PREFS = [
    'homepage', 'homepage_is_newtabpage', 'intl.accept_languages', 'intl.selected_languages',
    'autofill.profile_enabled', 'autofill.credit_card_enabled', 'credentials_enable_service', 'credentials_enable_autosignin',
    'safebrowsing.enabled', 'safebrowsing.enhanced', 'profile.cookie_controls_mode', 'generated.cookie_default_content_setting',
    'https_only_mode_enabled', 'net.network_prediction_options', 'search.suggest_enabled', 'browser.enable_spellchecking',
    'translate.enabled', 'dns_over_https.mode', 'enable_do_not_track', 'alternate_error_pages.enabled',
    'webkit.webprefs.default_font_size', 'webkit.webprefs.minimum_font_size'
];
// Internet Options > Fonts' scripts (Chromium's per-script font prefs: webkit.webprefs.fonts.<family>.<script>)
const FONT_SCRIPTS = ['Zyyy', 'Jpan', 'Hans', 'Hant', 'Hang', 'Cyrl', 'Grek', 'Arab', 'Hebr'];
const CONTENT = ['cookies', 'javascript', 'popups', 'notifications', 'location', 'media-stream-camera', 'media-stream-mic',
    'images', 'multiple-automatic-downloads', 'mixed-script', 'sound'];
const SETTINGS = new Set(['allow', 'block', 'ask', 'session_only']);
// the defaults each kind takes: Chromium CHECKs a wrong one and the whole browser goes down
const ASK_BLOCK = ['ask', 'block'];
const ALLOW_BLOCK = ['allow', 'block'];
const DEFAULTS_ALLOWED = {
    cookies: ['allow', 'block', 'session_only'], javascript: ALLOW_BLOCK, popups: ALLOW_BLOCK, images: ALLOW_BLOCK,
    sound: ALLOW_BLOCK, 'mixed-script': ALLOW_BLOCK, notifications: ASK_BLOCK, location: ASK_BLOCK,
    'media-stream-camera': ASK_BLOCK, 'media-stream-mic': ASK_BLOCK, 'multiple-automatic-downloads': ['allow', 'ask', 'block']
};
const EXCEPTION_TYPES = new Set(CONTENT);
// what Chromium's Clear browsing data calls each kind (browsing_data::GetDataTypeFromDeletionPreference)
const CLEAR = {
    history: ['browser.clear_data.browsing_history', 'browser.clear_data.download_history'],
    cache: ['browser.clear_data.cache'],
    cookies: ['browser.clear_data.cookies'],
    forms: ['browser.clear_data.form_data'],
    // not site_settings: those are Internet Options' own per-site rules (zones, cookies, pop-ups)
    addons: ['browser.clear_data.hosted_apps_data']
};
const LAUNCH_DEFAULTS = Object.freeze({
    popupBlocker: false, diskCacheMb: 0,
    proxyMode: 'direct', proxyServer: '', proxyBypass: '', proxyBypassLocal: false, proxyPacUrl: '',
    disabledAddons: []
});
const PROXY_MODES = new Set(['direct', 'auto', 'pac', 'fixed']);

function normalizeLaunch(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = Object.assign({}, LAUNCH_DEFAULTS);
    out.popupBlocker = typeof src.popupBlocker === 'boolean' ? src.popupBlocker : LAUNCH_DEFAULTS.popupBlocker;
    out.diskCacheMb = Math.max(0, Math.min(4096, Math.round(Number(src.diskCacheMb) || 0)));
    out.proxyMode = PROXY_MODES.has(src.proxyMode) ? src.proxyMode : 'direct';
    // host[:port] lists, or scheme=host:port;... as Chromium takes them; nothing that could start another switch
    const clean = (v, max) => String(v || '').replace(/[\s"'`\\]/g, '').replace(/^-+/, '').slice(0, max);
    out.proxyServer = clean(src.proxyServer, 512);
    out.proxyBypass = clean(src.proxyBypass, 2048).replace(/,/g, ';');
    out.proxyBypassLocal = !!src.proxyBypassLocal;
    out.proxyPacUrl = /^(https?|file|data):/i.test(String(src.proxyPacUrl || '')) ? clean(src.proxyPacUrl, 2048) : '';
    out.disabledAddons = Array.isArray(src.disabledAddons) ? [...new Set(src.disabledAddons.filter((id) => /^[a-p]{32}$/.test(id)))] : [];
    return out;
}

/**
 * deps: { dataDir, getBrowserClient(), ensureBrowser(), readExtensions(), extensionsDir, quietUrl }
 */
module.exports = function createChromeSettings(deps) {
    const LAUNCH_FILE = path.join(deps.dataDir, 'alchemy-chrome-launch.json');
    let launch = (() => {
        try { return normalizeLaunch(JSON.parse(fs.readFileSync(LAUNCH_FILE, 'utf8'))); } catch (_) { return normalizeLaunch({}); }
    })();
    let launched = null;
    let tab = null;            // { targetId, session }
    let idleTimer = null;
    let chain = Promise.resolve();
    // content settings as last read, for the server's own grants (grantCapture: camera / microphone)
    const known = { content: {}, exceptions: {} };

    function saveLaunch(next) {
        launch = normalizeLaunch(next);
        fs.mkdirSync(path.dirname(LAUNCH_FILE), { recursive: true });
        fs.writeFileSync(LAUNCH_FILE, JSON.stringify(launch));
    }

    /** Chromium switches for the launch options; launchBrowser adds them and calls launchedWith(). */
    function launchArgs() {
        const args = [];
        if (!launch.popupBlocker) args.push('--disable-popup-blocking');
        if (launch.diskCacheMb) args.push('--disk-cache-size=' + launch.diskCacheMb * 1024 * 1024);
        if (launch.proxyMode === 'pac' && launch.proxyPacUrl) args.push('--proxy-pac-url=' + launch.proxyPacUrl);
        else if (launch.proxyMode === 'auto') args.push('--proxy-auto-detect');
        else if (launch.proxyMode === 'fixed' && launch.proxyServer) {
            args.push('--proxy-server=' + launch.proxyServer);
            const bypass = [launch.proxyBypass, launch.proxyBypassLocal ? '<local>' : ''].filter(Boolean).join(';');
            if (bypass) args.push('--proxy-bypass-list=' + bypass);
        }
        launched = JSON.stringify(launch);
        return args;
    }

    const pendingRelaunch = () => launched !== null && launched !== JSON.stringify(launch);
    const addonEnabled = (id) => !launch.disabledAddons.includes(id);

    // ---- the quiet chrome://settings tab ----

    async function closeTab() {
        const t = tab;
        tab = null;
        if (!t) return;
        const client = deps.getBrowserClient();
        if (client) await client.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
    }

    function armIdle() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { chain = chain.then(closeTab, closeTab); }, IDLE_MS);
        if (idleTimer.unref) idleTimer.unref();
    }

    async function openTab() {
        await deps.ensureBrowser();
        const client = deps.getBrowserClient();
        if (!client) throw Object.assign(new Error('Alchemy is not running'), { status: 503 });
        if (tab && tab.client === client) return tab;
        tab = null;
        const { targetId } = await client.send('Target.createTarget', { url: deps.quietUrl, background: true });
        const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
        const session = client.connection().session(sessionId);
        if (!session) throw new Error('could not attach to the settings tab');
        await session.send('Page.navigate', { url: SETTINGS_URL });
        // the page's own modules (cr.js, settingsPrivate) are there once it has loaded
        for (let i = 0; i < 50; i++) {
            const r = await session.send('Runtime.evaluate', { expression: 'location.href.startsWith("chrome://settings") && document.readyState === "complete" && !!(window.chrome && chrome.settingsPrivate)', returnByValue: true }).catch(() => null);
            if (r && r.result && r.result.value === true) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        tab = { targetId, session, client };
        return tab;
    }

    /** Runs fn(args) in chrome://settings: an async function's source, with cr (cr.js) and pref helpers in scope. */
    function inSettings(fn, args) {
        const run = async () => {
            const t = await openTab();
            const expression = `(async () => {
                const cr = await import('chrome://resources/js/cr.js');
                const getPref = (key) => new Promise((resolve) => chrome.settingsPrivate.getPref(key, (p) => resolve(p ? p.value : undefined)));
                const setPref = (key, value) => new Promise((resolve) => chrome.settingsPrivate.setPref(key, value, '', (ok) => resolve(ok)));
                return (${fn})(${JSON.stringify(args || {})}, { cr, getPref, setPref });
            })()`;
            const r = await t.session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 20000 });
            if (r.exceptionDetails) throw new Error('settings: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
            return r.result.value;
        };
        const p = chain.then(run, run);
        chain = p.then(() => armIdle(), async () => { await closeTab(); });
        return p;
    }

    // ---- reading and writing ----

    async function snapshot(opts) {
        const page = await inSettings(async (a, { cr, getPref }) => {
            const prefs = {};
            for (const k of a.prefs) prefs[k] = await getPref(k);
            const fonts = {};
            for (const s of a.scripts) {
                fonts[s] = { standard: await getPref('webkit.webprefs.fonts.standard.' + s), fixed: await getPref('webkit.webprefs.fonts.fixed.' + s) };
            }
            const content = {};
            const exceptions = {};
            for (const t of a.content) {
                content[t] = ((await cr.sendWithPromise('getDefaultValueForContentType', t)) || {}).setting;
                exceptions[t] = ((await cr.sendWithPromise('getExceptionList', t)) || [])
                    .filter((e) => e.source === 'preference' && !e.incognito)
                    .map((e) => ({ pattern: e.origin, embedding: e.embeddingOrigin || '', setting: e.setting }));
            }
            const list = await cr.sendWithPromise('getSearchEnginesList').catch(() => null);
            const engines = list ? [...(list.defaults || []), ...(list.actives || []), ...(list.others || [])]
                .map((e) => ({ id: e.id, name: e.name, keyword: e.keyword, url: e.url, isDefault: !!e.default, canBeDefault: !!e.canBeDefault })) : [];
            const fontList = a.fontList ? ((await cr.sendWithPromise('fetchFontsData').catch(() => null)) || {}).fontList || [] : undefined;
            return { prefs, fonts, content, exceptions, engines, fontList: fontList ? fontList.map((f) => f[0]) : undefined };
        }, { prefs: PREFS, scripts: FONT_SCRIPTS, content: CONTENT, fontList: !!(opts && opts.fonts) });
        known.content = page.content || {};
        known.exceptions = page.exceptions || {};
        return Object.assign(page, { launch, pendingRelaunch: pendingRelaunch() });
    }

    function checkedPatch(body) {
        const prefs = {};
        const allowed = new Set(PREFS.concat(FONT_SCRIPTS.flatMap((s) => ['webkit.webprefs.fonts.standard.' + s, 'webkit.webprefs.fonts.fixed.' + s])));
        for (const [k, v] of Object.entries((body && body.prefs) || {})) {
            if (!allowed.has(k) || !['boolean', 'number', 'string'].includes(typeof v)) continue;
            prefs[k] = typeof v === 'string' ? v.slice(0, 2048) : v;
        }
        const content = {};
        for (const [k, v] of Object.entries((body && body.content) || {})) {
            if (DEFAULTS_ALLOWED[k] && DEFAULTS_ALLOWED[k].includes(v)) content[k] = v;
        }
        const exceptions = [];
        for (const e of Array.isArray(body && body.exceptions) ? body.exceptions.slice(0, 500) : []) {
            if (!e || !EXCEPTION_TYPES.has(e.type)) continue;
            const pattern = String(e.pattern || '').trim().slice(0, 300);
            if (!pattern || /[\s"'\\]/.test(pattern)) continue;
            if (e.setting !== null && !(e.setting === 'allow' || e.setting === 'block' || (e.type === 'cookies' && e.setting === 'session_only'))) continue;
            exceptions.push({ type: e.type, pattern, setting: e.setting });
        }
        const searchEngine = Number.isInteger(body && body.searchEngine) ? body.searchEngine : null;
        return { prefs, content, exceptions, searchEngine };
    }

    async function write(body) {
        const patch = checkedPatch(body);
        if (body && body.launch && typeof body.launch === 'object') saveLaunch(Object.assign({}, launch, body.launch));
        const failed = await inSettings(async (a, { cr, setPref }) => {
            const bad = [];
            for (const [k, v] of Object.entries(a.prefs)) {
                if (!(await setPref(k, v))) bad.push(k);
            }
            for (const [t, v] of Object.entries(a.content)) chrome.send('setDefaultValueForContentType', [t, v]);
            for (const e of a.exceptions) {
                if (e.setting === null) chrome.send('resetCategoryPermissionForPattern', [e.pattern, '', e.type, false]);
                else chrome.send('setCategoryPermissionForPattern', [e.pattern, '', e.type, e.setting, false]);
            }
            // 1: ChoiceMadeLocation::kSearchSettings (anything else is a CHECK)
            if (a.searchEngine !== null) chrome.send('setDefaultSearchEngine', [a.searchEngine, 1, null]);
            // chrome.send has no answer: one round trip through the same handler queue before reading back
            await cr.sendWithPromise('getDefaultValueForContentType', 'cookies');
            return bad;
        }, patch);
        const snap = await snapshot();
        if (failed && failed.length) snap.failed = failed;
        return snap;
    }

    /** Delete Browsing History: Chromium's own clear browsing data for all time. */
    async function clear(what) {
        const types = [];
        for (const [k, list] of Object.entries(CLEAR)) if (what && what[k] === true) types.push(...list);
        const passwords = !!(what && what.passwords === true);
        if (!types.length && !passwords) return { ok: true, cleared: [] };
        // passwords are not Clear browsing data's any more (a NOTREACHED there): the password manager's own removal
        const removed = await inSettings(async (a, { cr }) => {
            // the handler CHECKs that the page called initialize first (it allows its JavaScript callbacks)
            if (a.types.length) {
                await cr.sendWithPromise('initializeClearBrowsingData');
                await cr.sendWithPromise('clearBrowsingData', a.types, 4);
            }
            if (!a.passwords) return 0;
            const list = await new Promise((resolve) => chrome.passwordsPrivate.getSavedPasswordList(resolve));
            for (const c of list || []) chrome.passwordsPrivate.removeCredential(c.id, c.storedIn);
            return (list || []).length;
        }, { types, passwords });
        return { ok: true, cleared: types, passwordsRemoved: passwords ? removed : undefined };
    }

    // ---- add-ons (Programs > Manage add-ons) ----

    function addons() {
        return deps.readExtensions().map((e) => {
            let version = '';
            let description = '';
            try {
                const m = JSON.parse(fs.readFileSync(path.join(e.dir, 'manifest.json'), 'utf8'));
                version = String(m.version || '');
                description = String(m.description || '').startsWith('__MSG_') ? '' : String(m.description || '').slice(0, 300);
            } catch (_) {}
            return { id: e.id, name: e.name, version, description, icon16: e.icon16, icon32: e.icon32, enabled: addonEnabled(e.id) };
        });
    }

    function setAddon(body) {
        const id = String((body && body.id) || '');
        const list = deps.readExtensions();
        const ext = list.find((e) => e.id === id);
        if (!ext) throw Object.assign(new Error('no such add-on'), { status: 404 });
        if (body.remove === true) {
            // kept aside, not deleted: the folder moves to .removed/ and a later copy can come back
            const dest = path.join(deps.extensionsDir, '.removed', path.basename(ext.dir) + '-' + Date.now());
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.renameSync(ext.dir, dest);
            saveLaunch(Object.assign({}, launch, { disabledAddons: launch.disabledAddons.filter((x) => x !== id) }));
        } else if (typeof body.enabled === 'boolean') {
            const off = new Set(launch.disabledAddons);
            if (body.enabled) off.delete(id); else off.add(id);
            saveLaunch(Object.assign({}, launch, { disabledAddons: [...off] }));
        }
        // the extensions Chromium loads are fixed at launch: a change counts from the next one
        return { addons: addons(), pendingRelaunch: true };
    }

    // ---- the server's own grants ----

    /** false when Internet Options blocked camera or microphone for this origin (or everywhere). */
    function mediaAllowed(origin, kind) {
        const type = kind === 'microphone' ? 'media-stream-mic' : 'media-stream-camera';
        const rules = known.exceptions[type] || [];
        let host = '';
        try { host = new URL(origin).hostname; } catch (_) { return true; }
        const hit = rules.find((r) => {
            const p = String(r.pattern || '');
            if (p.startsWith('[*.]')) { const d = p.slice(4); return host === d || host.endsWith('.' + d); }
            try { return new URL(p).hostname === host; } catch (_) { return false; }
        });
        if (hit) return hit.setting !== 'block';
        return known.content[type] !== 'block';
    }

    // ---- HTTP ----

    async function handle(req, res, pathname, url, readBody, sendJson) {
        if (pathname === '/browser/chrome-settings' && req.method === 'GET') {
            sendJson(res, 200, await snapshot({ fonts: url.searchParams.get('fonts') === '1' }));
            return true;
        }
        if (pathname === '/browser/chrome-settings' && req.method === 'POST') {
            sendJson(res, 200, await write((await readBody(req)) || {}));
            return true;
        }
        if (pathname === '/browser/chrome-clear' && req.method === 'POST') {
            sendJson(res, 200, await clear((await readBody(req)) || {}));
            return true;
        }
        if (pathname === '/browser/addons' && req.method === 'GET') {
            sendJson(res, 200, { addons: addons(), pendingRelaunch: pendingRelaunch() });
            return true;
        }
        if (pathname === '/browser/addons' && req.method === 'POST') {
            sendJson(res, 200, setAddon((await readBody(req)) || {}));
            return true;
        }
        return false;
    }

    /** Alchemy is restarting or closing: the tab goes with it. */
    function forget() {
        clearTimeout(idleTimer);
        tab = null;
    }

    return { handle, launchArgs, pendingRelaunch, addonEnabled, mediaAllowed, snapshot, write, clear, forget, launchOptions: () => launch };
};

module.exports.normalizeLaunch = normalizeLaunch;
