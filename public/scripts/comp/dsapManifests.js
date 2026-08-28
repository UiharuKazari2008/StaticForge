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

function openDataManagementDsap(tabId) {
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

function openDynamicQuipsDsap(workspaceId) {
    const wsPart = workspaceId ? `${encodeURIComponent(workspaceId)}` : '';
    const path = wsPart
        ? `dsap://${QUIPS_DSAP_MANIFEST_URL}/${wsPart}`
        : `dsap://${QUIPS_DSAP_MANIFEST_URL}/`;
    // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
    openDsapInGrimoire(path);
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
        menuEntry: {
            launchId: 'security-center',
            icon: 'fas fa-shield-halved',
            imageIcon: 'secu.png',
            text: 'Security Center',
            appMenu: false,
            startMenu: false,
            desktopOnly: true,
            adminOnly: true,
            launch() {
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
        menuEntry: {
            launchId: 'data-management',
            icon: 'fas fa-database',
            imageIcon: 'planet.png',
            text: 'Data Management',
            startMenuIndex: 0,
            appMenuLocation: 'tools',
            launch() {
                const path = `dsap://${DATA_DSAP_MANIFEST_URL}/`;
                openDsapInGrimoire(path);
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
        menuEntry: {
            launchId: 'autofill-ranking',
            icon: 'fas fa-arrow-down-wide-short',
            imageIcon: 'slider.png',
            text: 'SmartText Ranking',
            appMenu: false,
            startMenu: false,
            desktopOnly: true,
            adminOnly: true,
            launch() {
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
        menuEntry: {
            launchId: 'ispy',
            icon: 'fas fa-search',
            imageIcon: 'search.png',
            text: 'Image Search',
            appMenu: false,
            startMenuIndex: 1,
            launch() {
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


    const MENMA_DSAP_MANIFEST_URL = 'menma.dyna.dreamscape.jp';
    registerDsap({
        url: MENMA_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${MENMA_DSAP_MANIFEST_URL}`,
            'en.grimoire.jp/applets/menma',
            'applet.grimoire.jp/menma'
        ],
        type: 'dsap',
        title: 'Menma',
        assets: {
            scripts: ['scripts/comp/menmaDsapApplet.js']
        },
        menuEntry: {
            launchId: 'menma',
            icon: 'fas fa-cake-candles',
            text: 'Menma',
            fullName: 'Menma Progress',
            desktopOnly: true,
            appMenu: false,
            startMenu: false,
            launch() {
                // openDsapInStandaloneWindow: public/scripts/comp/dsapRegistry.js
                openDsapInStandaloneWindow(`dsap://${MENMA_DSAP_MANIFEST_URL}/status`);
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
}

registerDsapManifests();

// Global compatibility shims (runs at startup). The applet script also installs one when loaded.
(function installMemoriesDsapShims() {
    if (typeof window.openKnowledgeMemoriesModal !== 'function') {
        window.openKnowledgeMemoriesModal = function () {
            const target = `dsap://${MEMORIES_DSAP_MANIFEST_URL}`;
            if (typeof openDsapInGrimoire === 'function') {
                openDsapInGrimoire(target);
                return;
            }
            let tries = 0;
            const t = setInterval(() => {
                tries += 1;
                if (typeof openDsapInGrimoire === 'function') {
                    clearInterval(t);
                    openDsapInGrimoire(target);
                } else if (tries > 20) {
                    clearInterval(t);
                }
            }, 60);
        };
    }
    if (typeof window.openLinkXiPersonaDsap !== 'function') {
        window.openLinkXiPersonaDsap = function () {
            const target = 'dsap://xi.dyna.dreamscape.jp/persona';
            if (typeof openDsapInGrimoire === 'function') {
                openDsapInGrimoire(target);
                return;
            }
            let tries = 0;
            const t = setInterval(() => {
                tries += 1;
                if (typeof openDsapInGrimoire === 'function') {
                    clearInterval(t);
                    openDsapInGrimoire(target);
                } else if (tries > 20) {
                    clearInterval(t);
                }
            }, 60);
        };
    }
})();
