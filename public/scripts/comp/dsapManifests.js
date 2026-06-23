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
    registerDsap({
        url: MEMORIES_DSAP_MANIFEST_URL,
        aliases: [
            `dsap://${MEMORIES_DSAP_MANIFEST_URL}`,
            'en.grimoire.jp/applets/memories',
            'applet.grimoire.jp/memories'
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
            text: 'Novels',
            appMenu: false,
            launch() {
                const wsId = typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default';
                openDsapInGrimoire(`dsap://${NOVELS_DSAP_MANIFEST_URL}/${encodeURIComponent(wsId)}`);
            }
        }
    });
}

registerDsapManifests();

// Global compatibility shim (runs at startup). The applet script also installs one when loaded.
(function installMemoriesDsapShim() {
    if (typeof window.openKnowledgeMemoriesModal === 'function') return; // already provided by old script or applet
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
})();
