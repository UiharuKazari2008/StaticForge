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
    return body.classList.contains('desktop-mode') && !body.classList.contains('windows-classic-theme');
}

function openDataManagementDsap(tabId) {
    // the Data Management MMC snap-in on the desktop (#828: public/scripts/comp/mmcDataManagement.js);
    // Search is the Image Search program's now
    if (dsapIsVistaDesktop()) {
        if (tabId === 'search') {
            void openImageSearchWindow();
            return;
        }
        void openDataManagementSnapin(tabId);
        return;
    }
    let target;
    if (!tabId || tabId === 'status') {
        target = `dsap://${DATA_DSAP_MANIFEST_URL}/`;
    } else if (tabId === 'search') {
        target = `dsap://${ISPY_DSAP_MANIFEST_URL}/`;
    } else {
        target = `dsap://${DATA_DSAP_MANIFEST_URL}/${tabId}`;
    }
    // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
    openDsapInGrimoire(target);
}

/**
 * Image Search (#828): the desktop program (public/scripts/comp/imageSearchApp.js) on the Vista
 * desktop, the DSAP elsewhere. opts: { url } (a dsap://ispy.dreamscape.jp/?... URL) or the
 * DSAP's openIspyDsap params ({ blocks, view, viewType, workspaceId, filters, file, frame ... }).
 * The DSAP's script loads first: the program uses its search helpers and sessions.
 */
async function openImageSearchWindow(opts) {
    const entry = resolveDsap(`dsap://${ISPY_DSAP_MANIFEST_URL}/`);
    // loadDsapEntryAssets: public/scripts/comp/dsapRegistry.js
    if (entry) await loadDsapEntryAssets(entry.entry);
    if (!dsapIsVistaDesktop()) {
        // openIspyDsap: public/scripts/comp/omegasearchDsapApplet.js
        if (opts && opts.url) openDsapInGrimoire(opts.url);
        else openIspyDsap((opts && opts.params) || opts || {});
        return null;
    }
    await featureLoader.loadFeature('image_search');
    if (typeof window.openImageSearch !== 'function') return null;
    if (opts && !opts.url && !opts.params && Object.keys(opts).length) return window.openImageSearch({ params: opts });
    return window.openImageSearch(opts || {});
}

function openDynamicQuipsDsap(workspaceId) {
    // the Dynamic Quips MMC snap-in on the desktop (#828: public/scripts/comp/mmcQuips.js)
    if (dsapIsVistaDesktop()) {
        void openDynamicQuipsSnapin(workspaceId);
        return;
    }
    const wsPart = workspaceId ? `${encodeURIComponent(workspaceId)}` : '';
    const path = wsPart
        ? `dsap://${QUIPS_DSAP_MANIFEST_URL}/${wsPart}`
        : `dsap://${QUIPS_DSAP_MANIFEST_URL}/`;
    // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
    openDsapInGrimoire(path);
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

/** Front Gate (#828), loading the MMC snap-ins first (featureLoader 'mmc_snapins'). */
async function openFrontGateConsole(node) {
    await featureLoader.loadFeature('mmc_snapins');
    // openFrontGate: public/scripts/comp/mmcFrontGate.js
    if (typeof openFrontGate === 'function') return openFrontGate(node);
    return null;
}

/** Enshutsuka (#828), loading the MMC snap-ins first; node: 'root' | 'mem' | 'obl' | 'rules' | 'feedback' | 'persona'. */
async function openEnshutsukaSnapin(node, opts) {
    await featureLoader.loadFeature('mmc_snapins');
    // openEnshutsukaConsole: public/scripts/comp/mmcEnshutsuka.js
    if (typeof openEnshutsukaConsole === 'function') return openEnshutsukaConsole(node, opts);
    return null;
}

/** Enshutsuka's page off the desktop: the Knowledge Memories DSAP's address for a console node. */
function enshutsukaDsapUrl(node) {
    if (node === 'persona') return 'dsap://xi.dyna.dreamscape.jp/persona';
    if (node === 'rules') return `dsap://${MEMORIES_DSAP_MANIFEST_URL}/rules`;
    if (node === 'feedback') return `dsap://${MEMORIES_DSAP_MANIFEST_URL}/rules/feedback`;
    if (node === 'obl') return `dsap://${MEMORIES_DSAP_MANIFEST_URL}/?store=obliterated`;
    return `dsap://${MEMORIES_DSAP_MANIFEST_URL}/`;
}

/** Enshutsuka: the MMC console on the desktop (#828), the Knowledge Memories DSAP elsewhere. */
function openEnshutsuka(node) {
    if (document.body.classList.contains('desktop-mode')) {
        void openEnshutsukaSnapin(node || 'mem');
        return;
    }
    // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
    openDsapInGrimoire(enshutsukaDsapUrl(node));
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
        assets: {
            scripts: ['scripts/comp/quipsDsapApplet.js']
        },
        // on the desktop every Dynamic Quips page is the MMC snap-in's (#828), on the same workspace and
        // view (<workspace>[/phrasebook|/settings], ?workspace=); elsewhere the page stays
        opensApp(match) {
            if (!dsapIsVistaDesktop()) return false;
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
            imageIcon: 'quips.png',
            text: 'Dynamic Quips',
            appMenu: false,
            startMenu: false,
            startMenuIndex: 6,
            launch() {
                // getActiveWorkspaceIdForQuips: public/scripts/comp/generationQuipsTray.js
                const wsId = typeof getActiveWorkspaceIdForQuips === 'function'
                    ? getActiveWorkspaceIdForQuips()
                    : null;
                openDynamicQuipsDsap(wsId);
            }
        }
    });

    // Memories DSAP (converted from the old modal viewer, now a first-class grimoire applet)
    // Note: memories menu entry is provided statically in modalUtils.js to preserve original start menu ordering (after Favorites, before Rules).
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
        assets: {
            scripts: ['scripts/comp/memoriesDsapApplet.js']
        },
        // on the desktop every page is the Enshutsuka MMC snap-in's (#828): /rules[/feedback], /view/<name>,
        // /delete[?filter=], the LinkXi persona, and the list's ?store= / search / category / page / perPage /
        // sort / view; elsewhere the page stays
        opensApp(match) {
            if (!document.body.classList.contains('desktop-mode')) return false;
            const [pathPart, query = ''] = String((match && match.displayPath) || '').split('?');
            const params = new URLSearchParams(query);
            const dec = (x) => { try { return decodeURIComponent(x); } catch (_) { return x; } };
            const segs = pathPart.split('/').filter(Boolean).map(dec);
            const host = segs.shift() || '';
            // en.grimoire.jp/applets/memories/... and applet.grimoire.jp/memories/...
            if (/grimoire\.jp$/.test(host) && segs.includes('memories')) segs.splice(0, segs.indexOf('memories') + 1);
            const store = params.get('store') === 'obliterated' ? 'obl' : 'mem';
            if (host.startsWith('xi.dyna') || segs[0] === 'persona' || segs.includes('linkxi')) {
                void openEnshutsukaSnapin('persona');
            } else if (segs[0] === 'rules' || segs[0] === 'static_rules') {
                void openEnshutsukaSnapin(segs[1] === 'feedback' ? 'feedback' : 'rules');
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
        assets: {
            scripts: ['scripts/comp/securityCenterDsapApplet.js']
        },
        // On the Vista desktop every Security Center page is Melaton Defender's now (#828): its links
        // open Defender on that page (/auth: Dreamscape CardSpace). Elsewhere the page stays.
        opensApp(match) {
            const body = document.body;
            if (!body.classList.contains('desktop-mode') || body.classList.contains('windows-classic-theme')) return false;
            const path = String((match && match.displayPath) || '').split('?')[0].split('/').filter(Boolean);
            const view = path[1] || 'home';
            const page = { blocked: 'quarantine', honeypot: 'honeypot', telemetry: 'history', approved: 'allowed', home: 'home' }[view] || 'home';
            void featureLoader.loadFeature('control_panel').then(() => {
                if (view === 'auth' && window.cplAuthentication) window.cplAuthentication.open();
                else if (window.windowsDefender) window.windowsDefender.open(page);
            });
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
                // Security Center is Windows Defender on the Vista desktop: public/scripts/comp/windowsDefender.js
                const body = document.body;
                if (body.classList.contains('desktop-mode') && !body.classList.contains('windows-classic-theme')) {
                    void featureLoader.loadFeature('control_panel').then(() => {
                        if (window.windowsDefender) window.windowsDefender.open('home');
                    });
                    return;
                }
                // openSecurityCenterDsap: public/scripts/comp/securityCenterDsapApplet.js
                if (typeof openSecurityCenterDsap === 'function') {
                    openSecurityCenterDsap('home');
                } else {
                    openDsapInGrimoire(`dsap://${SECURITY_DSAP_MANIFEST_URL}/`);
                }
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
        assets: {
            scripts: [
                'scripts/comp/dataManagementDsapApplet.js',
                'scripts/comp/replicationDsapSeparation.js',
                'scripts/comp/replicationDsapCargo.js',
                'scripts/comp/replicationDsapSync.js'
            ],
            styles: ['css/replication-dsap.css']
        },
        // On the Vista desktop Data Management is an MMC console (#828: mmcDataManagement.js): its
        // addresses open the console on that page (/replication/progress: Operation Progress)
        opensApp(match) {
            if (!dsapIsVistaDesktop()) return false;
            void openDataManagementSnapin(String((match && match.displayPath) || ''));
            return true;
        },
        menuEntry: {
            launchId: 'data-management',
            icon: 'fas fa-database',
            imageIcon: 'planet.png',
            text: 'Data Management',
            startMenuIndex: 0,
            appMenuLocation: 'tools',
            launch() {
                openDataManagementDsap();
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
        assets: {
            scripts: ['scripts/comp/autofillConfigDsapApplet.js']
        },
        // on the desktop the ranking is the Autofill Ranking MMC snap-in (#828); elsewhere the page stays
        opensApp() {
            if (!dsapIsVistaDesktop()) return false;
            void openAutofillRankingSnapin();
            return true;
        },
        menuEntry: {
            launchId: 'autofill-ranking',
            icon: 'fas fa-arrow-down-wide-short',
            imageIcon: 'slider.png',
            text: 'Autofill Ranking',
            appMenu: false,
            startMenu: false,
            desktopOnly: true,
            adminOnly: true,
            launch() {
                // the Autofill Ranking MMC snap-in on the desktop: public/scripts/comp/mmcAutofillRanking.js
                if (dsapIsVistaDesktop()) {
                    void openAutofillRankingSnapin();
                    return;
                }
                // openAutofillRankingDsap: public/scripts/comp/autofillConfigDsapApplet.js
                if (typeof openAutofillRankingDsap === 'function') {
                    openAutofillRankingDsap();
                } else {
                    openDsapInGrimoire(`dsap://${AUTOFILL_DSAP_MANIFEST_URL}/`);
                }
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
        assets: {
            scripts: ['scripts/comp/omegasearchDsapApplet.js']
        },
        // the Image Search program on the Vista desktop (#828: public/scripts/comp/imageSearchApp.js):
        // a link's search (blocks, filters, view, file, frame) opens in it; elsewhere the page stays
        opensApp(match) {
            if (!dsapIsVistaDesktop()) return false;
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
                if (dsapIsVistaDesktop()) {
                    void openImageSearchWindow();
                    return;
                }
                openDsapInGrimoire(`dsap://${ISPY_DSAP_MANIFEST_URL}/`);
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
        assets: {
            scripts: ['scripts/comp/fandomWikiManagerDsapApplet.js']
        },
        menuEntry: {
            launchId: 'wiki-manager',
            icon: 'fas fa-books',
            imageIcon: 'fandom.png',
            text: 'Wiki Manager',
            appMenu: false,
            startMenu: false,
            startMenuIndex: 8,
            launch() {
                openDsapInGrimoire(`dsap://${WIKI_DSAP_MANIFEST_URL}/`);
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
        theme: 'dsap-smf',
        assets: {
            scripts: [
                'scripts/comp/desktop-apps/exchange.js',
                'scripts/comp/exchangeDsapApplet.js'
            ],
            styles: ['css/desktop-apps/exchange.css']
        },
        menuEntry: {
            launchId: 'exchange',
            icon: 'fas fa-building-columns',
            imageIcon: 'vista-mail.png',
            text: 'Exchange Server',
            appMenu: false,
            startMenu: false,
            adminOnly: true,
            launch() {
                // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
                openDsapInGrimoire(`dsap://${EXCHANGE_DSAP_MANIFEST_URL}/`);
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
        assets: {
            scripts: ['scripts/comp/mcpConnectorDsapApplet.js']
        },
        // the connector moved to Remote Access Properties' MCP Connector tab (#828:
        // remoteAccessProperties.js); on the desktop its page opens that tab, elsewhere (the app) the page stays
        opensApp() {
            if (!document.body.classList.contains('desktop-mode')) return false;
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

// Global compatibility shims (runs at startup). The applet script also installs one when loaded.
(function installMemoriesDsapShims() {
    // node: an Enshutsuka console node ('mem' by default, 'rules', 'persona', ...): openEnshutsuka above
    if (typeof window.openKnowledgeMemoriesModal !== 'function') {
        window.openKnowledgeMemoriesModal = function (node) {
            openEnshutsuka(typeof node === 'string' ? node : 'mem');
        };
    }
    if (typeof window.openLinkXiPersonaDsap !== 'function') {
        window.openLinkXiPersonaDsap = function () {
            openEnshutsuka('persona');
        };
    }
})();
