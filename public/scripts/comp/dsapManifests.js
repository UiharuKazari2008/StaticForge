/**
 * DSAP manifest stubs — lightweight registry entries loaded at startup.
 * Implementation scripts/CSS load on first navigation via dsapRegistry.js.
 *
 * Core Grimoire domains (en.grimoire.jp family, wiki sources, static docs) are registered
 * in grimoireCoreDomains.js using the same registerDsap mechanism so the browser router
 * stays thin and all routing is name/alias driven.
 *
 * See public/scripts/comp/dsapRegistry.js and grimoireCoreDomains.js
 */

const QUIPS_DSAP_MANIFEST_URL = 'quips.dyna.dreamscape.jp';
const MEMORIES_DSAP_MANIFEST_URL = 'memories.dyna.dreamscape.jp';
const SECURITY_DSAP_MANIFEST_URL = 'security.dreamscape.jp';
const SECURITY_DSAP_MANIFEST_URL_LEGACY = 'security.dyna.dreamscape.jp';
const ISPY_DSAP_MANIFEST_URL = 'ispy.dreamscape.jp';
const OMEGASEARCH_DSAP_MANIFEST_URL = 'omegasearch.dyna.dreamscape.jp';
const DATA_DSAP_MANIFEST_URL = 'data.dreamscape.jp';
const AUTOFILL_DSAP_MANIFEST_URL = 'autofill.dreamscape.jp';
const EXPLORE_DSAP_MANIFEST_URL = 'explore.novelai.net';
const WIKI_DSAP_MANIFEST_URL = 'wiki.dyna.dreamscape.jp';

/** Melaton's Vista desktop (not Windows Classic, not the phone): the MMC consoles stand in for DSAP pages there. */
function dsapIsVistaDesktop() {
    const body = document.body;
    return body.classList.contains('desktop-mode') && window.uiTheme.is('vista');
}

/**
 * Melaton Mobile (#831): Image Search is the phone's Search Pictures program (wmSearchPictures.js,
 * a lazy program: wmShell's stand-in loads it). opts as openImageSearchWindow's. true when it opened.
 */
/**
 * The phone (#831): the old pages that have a phone version are Settings pages there (wmSettingsSystem.js
 * Workspaces, wmSettingsDreamscape.js Director > Persona / Static Rules). true when the phone took it.
 */
function dsapPhoneSettings(page, tab) {
    const s = window.uiShell === 'mobile' ? window.wmSettings : null;
    if (!s || typeof s.open !== 'function') return false;
    if (s.open(page, tab)) return true;
    // the Director's page is there once the Director has started (director.js initializeDirector)
    if (page !== 'director' || typeof initializeDirector !== 'function') return false;
    Promise.resolve().then(initializeDirector).catch(() => {}).then(() => s.open(page, tab));
    return true;
}

function dsapPhoneSearchPictures(opts) {
    if (window.uiShell !== 'mobile' || !window.wmSearchPictures || typeof window.wmSearchPictures.open !== 'function') return false;
    void window.wmSearchPictures.open(opts || {});
    return true;
}

/**
 * Data Management's old addresses and launchers (#831: the DSAP page is retired): Computer Management
 * (mmcDataManagement.js) on every client, the phone included (wmHost.js hosts the console); tabId 'search'
 * is the Image Search program's (Search Pictures on the phone).
 */
function openDataManagementDsap(tabId) {
    if (tabId === 'search') {
        void openImageSearchWindow();
        return;
    }
    // the phone: Settings > System > Workspaces, Data Management's quick tasks
    if (dsapPhoneSettings('workspaces')) return;
    void openDataManagementSnapin(tabId);
}

/**
 * Image Search (#828): the program (public/scripts/comp/imageSearchApp.js) on every non-phone client
 * (#831: the Global Search DSAP page is retired). opts: { url } (a dsap://ispy.dreamscape.jp/?... URL),
 * { params } or the old openIspyDsap params ({ blocks, view, viewType, workspaceId, filters, file, frame ... }).
 * featureLoader 'image_search' loads its search library (omegasearchDsapApplet.js, 'image_search_lib') first.
 */
async function openImageSearchWindow(opts) {
    // the phone: its own program, Search Pictures (#831: public/scripts/comp/wmSearchPictures.js)
    if (dsapPhoneSearchPictures(opts)) return null;
    await featureLoader.loadFeature('image_search');
    if (typeof window.openImageSearch !== 'function') return null;
    if (opts && !opts.url && !opts.params && Object.keys(opts).length) return window.openImageSearch({ params: opts });
    return window.openImageSearch(opts || {});
}

/** The old Global Search DSAP's opener (vistaSidebar.js and others still call it): the Image Search program. */
function openIspyDsap(params = {}) {
    void openImageSearchWindow({ params: params || {} });
}

/**
 * Security Center's old opener (#831: the DSAP page is retired): Melaton Defender (windowsDefender.js) on
 * that page, Dreamscape CardSpace (cplAuthentication.js) for 'auth', Key Manager for 'appkeys' / 'keys'.
 */
async function openSecurityCenterDsap(view) {
    const v = String(view || 'home').split('?')[0].replace(/^\/+|\/+$/g, '').toLowerCase() || 'home';
    if (v === 'appkeys' || v === 'keys') {
        void openKeyManagerConsole(v === 'keys' ? 'svc' : 'issued');
        return;
    }
    await featureLoader.loadFeature('control_panel');
    if (['auth', 'authentication', 'pins', 'approved-ips', 'approvedips', 'ips'].includes(v)) {
        if (window.cplAuthentication) window.cplAuthentication.open();
        return;
    }
    const page = { blocked: 'quarantine', honeypot: 'honeypot', paths: 'honeypot', scraped: 'honeypot', telemetry: 'history', approved: 'allowed' }[v] || 'home';
    if (window.windowsDefender) window.windowsDefender.open(page);
}

/** Dynamic Quips' old launcher (#831: the DSAP page is retired): the MMC snap-in (mmcQuips.js). */
function openDynamicQuipsDsap(workspaceId) {
    void openDynamicQuipsSnapin(workspaceId);
}

/** Dynamic Quips (#828), loading the MMC snap-ins first; view: 'status' | 'phrasebook' | 'settings'. */
async function openDynamicQuipsSnapin(workspaceId, view) {
    await featureLoader.loadFeature('mmc_snapins');
    // openDynamicQuipsConsole: public/scripts/comp/mmcQuips.js
    if (typeof openDynamicQuipsConsole === 'function') return openDynamicQuipsConsole(workspaceId, view);
    return null;
}

/** Autofill Ranking (#828), loading the MMC snap-ins first. */
async function openAutofillRankingSnapin(node) {
    await featureLoader.loadFeature('mmc_snapins');
    // openAutofillRankingConsole: public/scripts/comp/mmcAutofillRanking.js
    if (typeof openAutofillRankingConsole === 'function') return openAutofillRankingConsole(node);
    return null;
}

/** Data Management (#828), loading the MMC snap-ins first; node: a console node or an old tab id / dsap path. */
async function openDataManagementSnapin(node) {
    await featureLoader.loadFeature('mmc_snapins');
    // openDataManagementConsole: public/scripts/comp/mmcDataManagement.js
    if (typeof openDataManagementConsole === 'function') return openDataManagementConsole(node);
    return null;
}

/**
 * Wiki Caches (#831), the Wiki Manager's MMC snap-in, loading the MMC snap-ins first. It lives in
 * Computer Management under Storage (mmcDataManagement.js hosts it), so this opens that console at it;
 * node: 'root' | 'sites' | 'imports'; opts.wizard starts New Import... (the old Import tab). Only when
 * Computer Management did not host it does it open in its own window.
 */
async function openWikiCachesSnapin(node, opts = {}) {
    await featureLoader.loadFeature('mmc_snapins');
    const sub = ['sites', 'imports'].includes(node) ? node : 'root';
    let c = null;
    // openDataManagementConsole: public/scripts/comp/mmcDataManagement.js
    if (typeof openDataManagementConsole === 'function') {
        c = await openDataManagementConsole(`wiki::${sub}`);
        if (c && typeof c.node === 'string' && !c.node.startsWith('wiki::')) c = null;
    }
    // openWikiManagerConsole: public/scripts/comp/mmcWikiManager.js
    if (!c && typeof openWikiManagerConsole === 'function') return openWikiManagerConsole(sub, opts);
    if (c && opts.wizard && window.mmcWikiManager) window.mmcWikiManager.newImport(c);
    return c;
}

/** Wiki Caches in its own window (Administrative Tools, Run wikicaches.msc). */
async function openWikiCachesConsole(node) {
    await featureLoader.loadFeature('mmc_snapins');
    if (typeof openWikiManagerConsole === 'function') return openWikiManagerConsole(node);
    return null;
}

/**
 * Key Manager (#831): application keys (their home; CardSpace links here) and service keys, loading
 * the MMC snap-ins first; node: 'root' | 'app' | 'issued' | 'pending' | 'failed' | 'revoked' | 'log' |
 * 'svc' | 'svc:<service id>'.
 */
async function openKeyManagerConsole(node) {
    await featureLoader.loadFeature('mmc_snapins');
    // openKeyManager: public/scripts/comp/mmcAppKeys.js
    if (typeof openKeyManager === 'function') return openKeyManager(node);
    return null;
}

/** Front Gate (#828), loading the MMC snap-ins first (featureLoader 'mmc_snapins'). */
async function openFrontGateConsole(node) {
    await featureLoader.loadFeature('mmc_snapins');
    // openFrontGate: public/scripts/comp/mmcFrontGate.js
    if (typeof openFrontGate === 'function') return openFrontGate(node);
    return null;
}

/**
 * Server Manager (#831 slice 5): the console that holds every other console in one tree, loading the
 * MMC snap-ins first; node: a console node or a role / tool key ('frontgate', 'eventvwr', 'storage' ...).
 */
async function openServerManagerConsole(node) {
    await featureLoader.loadFeature('mmc_snapins');
    // openServerManager: public/scripts/comp/mmcServerManager.js
    if (typeof openServerManager === 'function') return openServerManager(node);
    return null;
}

/** Print Management (#831): the generation backends as printers; printerId selects one under Printers. */
async function openPrintManagementSnapin(printerId) {
    await featureLoader.loadFeature('mmc_snapins');
    // mmcPrintManagement.open: public/scripts/comp/mmcPrintManagement.js
    if (window.mmcPrintManagement) return window.mmcPrintManagement.open(printerId);
    return null;
}

/**
 * Exchange Management Console (#831), loading the MMC snap-ins first; node: a console node or an old
 * Exchange Server DSAP tab ('mailboxes', 'aliases', 'toggles', 'signatures', 'relay', 'spam').
 */
async function openExchangeConsole(node) {
    await featureLoader.loadFeature('mmc_snapins');
    // openExchangeManagementConsole: public/scripts/comp/mmcExchange.js
    if (typeof openExchangeManagementConsole === 'function') return openExchangeManagementConsole(node);
    return null;
}

/**
 * Enshutsuka (#828), loading the MMC snap-ins first; node: 'root' | 'memories' | 'default' | 'private' |
 * 'ruleset' | 'director' | 'feedback' | 'profile' (the old ids mem, obl, rules, persona still work).
 */
async function openEnshutsukaSnapin(node, opts) {
    await featureLoader.loadFeature('mmc_snapins');
    // openEnshutsukaConsole: public/scripts/comp/mmcEnshutsuka.js
    if (typeof openEnshutsukaConsole === 'function') return openEnshutsukaConsole(node, opts);
    return null;
}

/** Spellbook (#828), loading the MMC snap-ins first; node: 'root' | 'presets' | 'groups'. */
async function openSpellbookSnapin(node, opts) {
    await featureLoader.loadFeature('mmc_snapins');
    // openSpellbookConsole: public/scripts/comp/mmcSpellbook.js
    if (typeof openSpellbookConsole === 'function') return openSpellbookConsole(node, opts);
    return null;
}

/** Text Expanders (#828), loading the MMC snap-ins first; node: 'root' | 'global' | 'favorites'. */
async function openTextExpandersSnapin(node, opts) {
    await featureLoader.loadFeature('mmc_snapins');
    // openTextExpandersConsole: public/scripts/comp/mmcExpanders.js
    if (typeof openTextExpandersConsole === 'function') return openTextExpandersConsole(node, opts);
    return null;
}

/** Character Database (#831), loading the MMC snap-ins first; node: 'root' | a copyright's name. */
async function openCharacterDbSnapin(node, opts) {
    await featureLoader.loadFeature('mmc_snapins');
    // openCharacterDbConsole: public/scripts/comp/mmcCharacterDb.js
    if (typeof openCharacterDbConsole === 'function') return openCharacterDbConsole(node, opts);
    return null;
}

/** "Characters": the Character Database console on the Vista desktop, the old window elsewhere
 *  (characterDbApplet.js; on phones wmCharacters.js replaces it). */
async function manageCharacterDb(node, opts) {
    if (dsapIsVistaDesktop()) return openCharacterDbSnapin(node, opts);
    await featureLoader.loadFeature('character_db');
    // characterDbApplet: public/scripts/comp/characterDbApplet.js
    if (typeof characterDbApplet !== 'undefined') characterDbApplet.open();
    return null;
}

/** "Manage presets": the Spellbook console on the Vista desktop, the old Spellbook window elsewhere
 *  (showPresetManager: presetManager.js; on phones wmSpellbook.js replaces it). */
function manageSpellbook(node, opts) {
    if (dsapIsVistaDesktop()) return openSpellbookSnapin(node, opts);
    if (typeof showPresetManager === 'function') return showPresetManager();
    return null;
}

/** "Manage expanders": the Text Expanders console on the Vista desktop, the old window elsewhere
 *  (showTextReplacementManager: textReplacementManager.js; on phones wmExpanders.js replaces it). */
function manageTextExpanders(node, opts) {
    if (dsapIsVistaDesktop()) return openTextExpandersSnapin(node, opts);
    if (typeof showTextReplacementManager === 'function') return showTextReplacementManager();
    return null;
}

/** Enshutsuka: the MMC console (#828) on every client (#831: the Knowledge Memories DSAP page is retired). */
function openEnshutsuka(node) {
    // the phone: the persona and the static rules are Director Settings tabs there
    const n = String(node || '');
    if (/^(profile|persona|linkxi)$/.test(n) && dsapPhoneSettings('director', 'dirx-persona')) return;
    if (/^(ruleset|director|rules|static_rules)$/.test(n) && dsapPhoneSettings('director', 'dirx-rules')) return;
    void openEnshutsukaSnapin(node || 'default');
}

function registerDsapManifests() {
    // registerDsap: public/scripts/comp/dsapRegistry.js
    if (typeof registerDsap !== 'function') return;

    registerDsap({
        url: QUIPS_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${QUIPS_DSAP_MANIFEST_URL}`,
            'en.grimoire.jp/applets/quips',
            'applet.grimoire.jp/quips'
        ],
        type: 'dsap',
        title: 'Dynamic Quips',
        // the page is retired (#831): every address is the MMC snap-in's (#828, mmcQuips.js), on the same
        // workspace and view (<workspace>[/phrasebook|/settings], ?workspace=)
        opensApp(match) {
            const [pathPart, query = ''] = String((match && match.displayPath) || '').split('?');
            const base = QUIPS_DSAP_MANIFEST_URL;
            const segs = pathPart.startsWith(base)
                ? pathPart.slice(base.length).split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (_) { return x; } })
                : [];
            const view = segs.includes('phrasebook') ? 'phrasebook' : segs.includes('settings') ? 'settings' : 'status';
            const params = new URLSearchParams(query);
            const wsId = segs[0] && segs[0] !== 'phrasebook' && segs[0] !== 'settings' ? segs[0] : (params.get('workspace') || params.get('ws') || null);
            void openDynamicQuipsSnapin(wsId, view);
            return true;
        },
        menuEntry: {
            launchId: 'dynamic-quips',
            icon: 'fas fa-comment-heart',
            imageIcon: 'vista-dynamic-quips.png',
            text: 'Dynamic Quips',
            appMenu: false,
            startMenu: false,
            startMenuIndex: 6,
            launch() {
                // getActiveWorkspaceIdForQuips: public/scripts/comp/generationQuipsTray.js
                const wsId = typeof getActiveWorkspaceIdForQuips === 'function'
                    ? getActiveWorkspaceIdForQuips()
                    : null;
                void openDynamicQuipsSnapin(wsId);
            }
        }
    });

    // Knowledge Memories + the LinkXi persona: the pages are retired (#831); every address is the Enshutsuka
    // MMC snap-in's (mmcEnshutsuka.js). Its launchers (memories, enshutsuka-rules, linkxi-persona) are in modalUtils.js.
    const LINKXI_DSAP_MANIFEST_URL = 'xi.dyna.dreamscape.jp/persona';
    registerDsap({
        url: MEMORIES_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${MEMORIES_DSAP_MANIFEST_URL}`,
            'en.grimoire.jp/applets/memories',
            'applet.grimoire.jp/memories',
            LINKXI_DSAP_MANIFEST_URL,
            `dsap://${LINKXI_DSAP_MANIFEST_URL}`,
            'en.grimoire.jp/applets/linkxi',
            'applet.grimoire.jp/linkxi'
        ],
        type: 'dsap',
        title: 'Knowledge Memories',
        // every address is the Enshutsuka MMC snap-in's (#828): /rules[/feedback], /view/<name>,
        // /delete[?filter=], the LinkXi persona, and the list's ?store= / search / category / page / perPage /
        // sort / view
        opensApp(match) {
            const [pathPart, query = ''] = String((match && match.displayPath) || '').split('?');
            const params = new URLSearchParams(query);
            const dec = (x) => { try { return decodeURIComponent(x); } catch (_) { return x; } };
            const segs = pathPart.split('/').filter(Boolean).map(dec);
            const host = segs.shift() || '';
            // en.grimoire.jp/applets/memories/... and applet.grimoire.jp/memories/...
            if (/grimoire\.jp$/.test(host) && segs.includes('memories')) segs.splice(0, segs.indexOf('memories') + 1);
            const store = params.get('store') === 'obliterated' ? 'private' : 'default';
            if (host.startsWith('xi.dyna') || segs[0] === 'persona' || segs.includes('linkxi')) {
                void openEnshutsukaSnapin('profile');
            } else if (segs[0] === 'rules' || segs[0] === 'static_rules') {
                void openEnshutsukaSnapin(segs[1] === 'feedback' ? 'feedback' : 'director');
            } else if (segs[0] === 'view' && segs[1]) {
                void openEnshutsukaSnapin(store, { memory: segs[1] });
            } else if (segs[0] === 'delete' || segs[0] === 'bulk-delete') {
                void openEnshutsukaSnapin(store, { bulk: params.get('filter') || params.get('type') || true });
            } else {
                const opts = {};
                ['search', 'category', 'sort', 'view'].forEach((k) => { if (params.has(k)) opts[k] = params.get(k); });
                if (params.get('page')) opts.page = Number(params.get('page')) || 1;
                if (params.get('perPage')) opts.perPage = Number(params.get('perPage')) || 25;
                void openEnshutsukaSnapin(store, Object.keys(opts).length ? opts : undefined);
            }
            return true;
        }
    });

    const NOVELS_DSAP_MANIFEST_URL = 'novels.dyna.dreamscape.jp';
    registerDsap({
        url: NOVELS_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${NOVELS_DSAP_MANIFEST_URL}`,
            'en.grimoire.jp/applets/novels',
            'applet.grimoire.jp/novels'
        ],
        type: 'dsap',
        title: 'Novels',
        assets: {
            scripts: ['scripts/comp/novelsDsapApplet.js']
        },
        menuEntry: {
            launchId: 'novels',
            icon: 'fas fa-book-open',
            imageIcon: 'novel.png',
            text: 'Novels',
            appMenu: false,
            launch() {
                const wsId = typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default';
                openDsapInGrimoire(`dsap://${NOVELS_DSAP_MANIFEST_URL}/${encodeURIComponent(wsId)}`);
            }
        }
    });

    registerDsap({
        url: SECURITY_DSAP_MANIFEST_URL,
        aliases: [
            SECURITY_DSAP_MANIFEST_URL_LEGACY,
            `dsap://${SECURITY_DSAP_MANIFEST_URL}`,
            `dsap://${SECURITY_DSAP_MANIFEST_URL_LEGACY}`,
            'en.grimoire.jp/applets/security',
            'applet.grimoire.jp/security'
        ],
        type: 'dsap',
        title: 'Security Center',
        // the page is retired (#831): every address is Melaton Defender's on that page (/auth: Dreamscape
        // CardSpace, /appkeys and /keys: Key Manager); openSecurityCenterDsap above
        opensApp(match) {
            const path = String((match && match.displayPath) || '').split('?')[0].split('/').filter(Boolean);
            void openSecurityCenterDsap(path[1] || 'home');
            return true;
        },
        menuEntry: {
            launchId: 'security-center',
            icon: 'fas fa-shield-halved',
            imageIcon: 'vista-defender.png',
            text: 'Melaton Defender',
            appMenu: false,
            startMenu: false,
            desktopOnly: true,
            adminOnly: true,
            launch() {
                void openSecurityCenterDsap('home');
            }
        }
    });

    registerDsap({
        url: DATA_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${DATA_DSAP_MANIFEST_URL}`,
            'en.grimoire.jp/applets/data',
            'applet.grimoire.jp/data'
        ],
        type: 'dsap',
        title: 'Data Management',
        // the page is retired (#831): its addresses open Computer Management (#828: mmcDataManagement.js)
        // on that page (/replication/progress: Operation Progress). The console's library
        // (dataManagementDsapApplet.js, replication*) loads as featureLoader 'data_mgmt_lib'.
        opensApp(match) {
            void openDataManagementSnapin(String((match && match.displayPath) || ''));
            return true;
        },
        menuEntry: {
            launchId: 'data-management',
            icon: 'fas fa-database',
            imageIcon: 'vista-computer-management.png',
            text: 'Data Management',
            startMenuIndex: 0,
            appMenuLocation: 'tools',
            launch() {
                void openDataManagementSnapin();
            }
        }
    });

    registerDsap({
        url: AUTOFILL_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${AUTOFILL_DSAP_MANIFEST_URL}`,
            'en.grimoire.jp/applets/autofill',
            'applet.grimoire.jp/autofill'
        ],
        type: 'dsap',
        title: 'SmartText Ranking',
        // the page is retired (#831): the ranking is the Autofill Ranking MMC snap-in's (#828)
        opensApp() {
            void openAutofillRankingSnapin();
            return true;
        },
        menuEntry: {
            launchId: 'autofill-ranking',
            icon: 'fas fa-arrow-down-wide-short',
            imageIcon: 'vista-autofill-ranking.png',
            text: 'Autofill Ranking',
            appMenu: false,
            startMenu: false,
            desktopOnly: true,
            adminOnly: true,
            launch() {
                // public/scripts/comp/mmcAutofillRanking.js
                void openAutofillRankingSnapin();
            }
        }
    });

    registerDsap({
        url: ISPY_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${ISPY_DSAP_MANIFEST_URL}`,
            `dsap://${OMEGASEARCH_DSAP_MANIFEST_URL}`,
            'en.grimoire.jp/applets/ispy',
            'en.grimoire.jp/applets/omegasearch',
            'applet.grimoire.jp/ispy',
            'applet.grimoire.jp/omegasearch'
        ],
        type: 'dsap',
        title: 'Image Search',
        // the page is retired (#831): a link's search (blocks, filters, view, file, frame) opens in the
        // Image Search program (#828: imageSearchApp.js; Search Pictures on the phone)
        opensApp(match) {
            const path = String((match && match.displayPath) || '');
            const q = path.indexOf('?');
            void openImageSearchWindow({ url: `dsap://${ISPY_DSAP_MANIFEST_URL}/${q >= 0 ? path.slice(q) : ''}` });
            return true;
        },
        menuEntry: {
            launchId: 'ispy',
            icon: 'fas fa-search',
            imageIcon: 'vista-search.png',
            text: 'Image Search',
            appMenu: false,
            startMenuIndex: 1,
            launch() {
                void openImageSearchWindow();
            }
        }
    });

    registerDsap({
        url: EXPLORE_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${EXPLORE_DSAP_MANIFEST_URL}`,
            'novelai.net/explore/gallery',
            'novelai.net/explore',
            'applet.novelai.net/explore',
            'en.grimoire.jp/applets/explore',
            'applet.grimoire.jp/explore'
        ],
        type: 'dsap',
        title: 'Agora',
        assets: {
            scripts: ['scripts/comp/blurhashUtil.js', 'scripts/comp/exploreDsapApplet.js']
        },
        menuEntry: {
            launchId: 'explore-gallery',
            icon: 'fas fa-landmark',
            imageIcon: 'agora.png',
            text: 'Agora',
            appMenu: false,
            startMenuIndex: 7,
            launch() {
                // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
                openDsapInGrimoire(`dsap://${EXPLORE_DSAP_MANIFEST_URL}/`);
            }
        }
    });


    const PANTRY_DSAP_MANIFEST_URL = 'pantry.dyna.dreamscape.jp';
    const PANTRY_DSAP_MANIFEST_URL_LEGACY = 'menma.dyna.dreamscape.jp';
    registerDsap({
        url: PANTRY_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${PANTRY_DSAP_MANIFEST_URL}`,
            'pantry.nyti.ne.jp',
            'dsap://pantry.nyti.ne.jp',
            PANTRY_DSAP_MANIFEST_URL_LEGACY,
            `dsap://${PANTRY_DSAP_MANIFEST_URL_LEGACY}`,
            'en.grimoire.jp/applets/pantry',
            'applet.grimoire.jp/pantry',
            'en.grimoire.jp/applets/menma',
            'applet.grimoire.jp/menma'
        ],
        type: 'dsap',
        title: 'Pantry',
        assets: {
            scripts: ['scripts/comp/menmaDsapApplet.js']
        },
        menuEntry: {
            launchId: 'pantry',
            icon: 'fas fa-cake-candles',
            text: 'Pantry',
            fullName: 'Pantry Progress',
            desktopOnly: true,
            appMenu: false,
            startMenu: false,
            launch() {
                // openDsapInStandaloneWindow: public/scripts/comp/dsapRegistry.js
                openDsapInStandaloneWindow(`dsap://${PANTRY_DSAP_MANIFEST_URL}/status`);
            }
        }
    });

    registerDsap({
        url: WIKI_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${WIKI_DSAP_MANIFEST_URL}`,
            'en.grimoire.jp/applets/wiki',
            'applet.grimoire.jp/wiki'
        ],
        type: 'dsap',
        title: 'Wiki Manager',
        // the page is retired (#831): the Wiki Manager is Wiki Caches, under Storage in Computer Management
        // (mmcWikiManager.js); /import starts New Import..., /library (and the rest) opens the snap-in
        opensApp(match) {
            const pathPart = String((match && match.displayPath) || '').split('?')[0];
            const segs = pathPart.split('/').filter(Boolean);
            void openWikiCachesSnapin('root', { wizard: segs.includes('import') });
            return true;
        },
        menuEntry: {
            launchId: 'wiki-manager',
            icon: 'fas fa-books',
            imageIcon: 'vista-wiki-caches.png',
            text: 'Wiki Manager',
            appMenu: false,
            startMenu: false,
            startMenuIndex: 8,
            launch() {
                void openWikiCachesSnapin('root');
            }
        }
    });

    const EXCHANGE_DSAP_MANIFEST_URL = 'exchange.dreamscape.jp';
    registerDsap({
        url: EXCHANGE_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${EXCHANGE_DSAP_MANIFEST_URL}`,
            'en.grimoire.jp/applets/exchange',
            'applet.grimoire.jp/exchange'
        ],
        type: 'dsap',
        title: 'Dreamscape Exchange Server',
        // the page is retired (#831): the Exchange Management Console (mmcExchange.js) opens on that
        // tab's node (/mailboxes, /aliases, /spam ...)
        opensApp(match) {
            void openExchangeConsole(String((match && match.displayPath) || ''));
            return true;
        },
        menuEntry: {
            launchId: 'exchange',
            icon: 'fas fa-building-columns',
            imageIcon: 'vista-exchange-management-console.png',
            text: 'Exchange Management Console',
            appMenu: false,
            startMenu: false,
            adminOnly: true,
            launch() {
                void openExchangeConsole();
            }
        }
    });

    const SITE_HOMEPAGE_DSAP_URL = 'site.dreamscape.jp';
    registerDsap({
        url: SITE_HOMEPAGE_DSAP_URL,
        aliases: [
            `dsap://${SITE_HOMEPAGE_DSAP_URL}`,
            `dsap://${SITE_HOMEPAGE_DSAP_URL}/`
        ],
        type: 'dsap',
        title: 'Front Gate',
        // Front Gate, an MMC console, replaced the page (#828: public/scripts/comp/mmcFrontGate.js)
        opensApp() {
            void openFrontGateConsole();
            return true;
        },
        menuEntry: {
            launchId: 'site-homepage',
            icon: 'fas fa-globe',
            text: 'Front Gate',
            appMenu: false,
            startMenu: false,
            adminOnly: true,
            launch() {
                void openFrontGateConsole();
            }
        }
    });

    // the Server Manager dashboard (dsap://dreamscape.jp/, a link list) is retired (#831): its addresses
    // open the Server Manager console (mmcServerManager.js), which holds every other console
    const DREAMSCAPE_HOME_URL = 'dreamscape.jp';
    registerDsap({
        url: DREAMSCAPE_HOME_URL,
        aliases: [
            'dreamscape.jp/',
            'www.dreamscape.jp',
            'www.dreamscape.jp/',
            'dyna.dreamscape.jp',
            'dyna.dreamscape.jp/',
            `dsap://${DREAMSCAPE_HOME_URL}`,
            `dsap://${DREAMSCAPE_HOME_URL}/`
        ],
        type: 'core',
        title: 'Server Manager',
        opensApp() {
            void openServerManagerConsole();
            return true;
        },
        menuEntry: {
            // not the desktop's Control Panel: the server's administration home (Yukimi, Nov 10); its
            // own id since #831 ('control-panel' is Control Panel: modalUtils.js buildToolsSubmenuItems)
            launchId: 'server-manager',
            icon: 'fas fa-gauge',
            imageIcon: 'vista-server-manager.png',
            text: 'Server Manager',
            fullName: 'Dreamscape Server Manager',
            appMenu: false,
            startMenu: true,
            startMenuIndex: 5,
            launch() {
                void openServerManagerConsole();
            }
        }
    });

    const MCP_DSAP_MANIFEST_URL = 'mcp.dreamscape.jp';
    registerDsap({
        url: MCP_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${MCP_DSAP_MANIFEST_URL}`,
            `dsap://${MCP_DSAP_MANIFEST_URL}/`,
            'en.grimoire.jp/applets/mcp',
            'applet.grimoire.jp/mcp'
        ],
        type: 'dsap',
        title: 'MCP Connector',
        // the page is retired (#831): the connector is Remote Access Properties' MCP Connector tab (#828:
        // remoteAccessProperties.js). The server keeps the mcp.dreamscape.jp Grimoire domain: that tab
        // reads it (resolve_grimoire_url, modules/grimoireDomainRegistry.js).
        opensApp() {
            // openRemoteAccessSettingsModal: public/scripts/comp/modalUtils.js
            if (typeof openRemoteAccessSettingsModal !== 'function') return false;
            void openRemoteAccessSettingsModal('mcp');
            return true;
        }
    });

    const SIMILAR_DSAP_MANIFEST_URL = 'zanzou.dyna.dreamscape.jp';
    registerDsap({
        url: SIMILAR_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${SIMILAR_DSAP_MANIFEST_URL}`,
            'similar.dyna.dreamscape.jp',
            'dsap://similar.dyna.dreamscape.jp',
            'review.dyna.dreamscape.jp',
            'dsap://review.dyna.dreamscape.jp',
            'en.grimoire.jp/applets/similar',
            'applet.grimoire.jp/similar'
        ],
        type: 'dsap',
        title: 'Zanzou',
        assets: {
            scripts: ['scripts/comp/similarImageDsapApplet.js']
        },
        menuEntry: {
            launchId: 'zanzou',
            icon: 'fas fa-clone',
            text: 'Zanzou',
            fullName: 'Zanzou — afterimage review',
            appMenu: false,
            startMenu: false,
            launch() {
                openDsapInGrimoire(`dsap://${SIMILAR_DSAP_MANIFEST_URL}/`);
            }
        }
    });
}

registerDsapManifests();

// Global compatibility shims (runs at startup) for the retired Knowledge Memories / LinkXi pages (#831).
(function installMemoriesDsapShims() {
    // node: an Enshutsuka console node ('default' memories by default, 'director', 'profile', ...; the
    // old 'mem', 'rules', 'persona' too): openEnshutsuka above
    if (typeof window.openKnowledgeMemoriesModal !== 'function') {
        window.openKnowledgeMemoriesModal = function (node) {
            openEnshutsuka(typeof node === 'string' ? node : 'default');
        };
    }
    if (typeof window.openLinkXiPersonaDsap !== 'function') {
        window.openLinkXiPersonaDsap = function () {
            openEnshutsuka('profile');
        };
    }
})();
