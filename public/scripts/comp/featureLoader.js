/**
 * Dynamic Feature and Asset Loader Core
 * Registers and asynchronously loads component scripts, styles, and HTML templates.
 */

const FEATURE_MANIFEST = {
    spellbook: {
        styles: ['css/spellbook.css'],
        scripts: ['scripts/comp/spellbookModal.js']
    },
    notepad: {
        html: 'templates/notepad.html',
        styles: [
            'css/notepad.css',
            'css/spell-check.css',
            'css/autocomplete.css',
            'css/vista-atelier.css'
        ],
        scripts: [
            'scripts/comp/notepadManager.js'
        ]
    },
    chat: {
        html: 'templates/chat.html',
        styles: ['css/chat-modal.css'],
        scripts: ['scripts/comp/chatSystem.js']
    },
    config_editor: {
        styles: ['css/config-editor.css'],
        scripts: ['scripts/comp/configEditorApplet.js']
    },
    character_db: {
        styles: ['css/character-db-applet.css'],
        scripts: ['scripts/comp/characterDbApplet.js']
    },
    server_management: {
        scripts: [
            'scripts/comp/serverManagement.js',
            'scripts/comp/ipManagement.js'
        ]
    },
    log_viewer: {
        depends: ['server_management'],
        styles: ['css/log-viewer.css', 'css/websocket-requests.css'],
        scripts: ['scripts/comp/websocketRequestsModal.js', 'scripts/comp/logViewerApplet.js']
    },
    run_index: {
        scripts: ['scripts/comp/runCommandIndex.js']
    },
    run: {
        depends: ['run_index'],
        styles: ['css/run-applet.css'],
        scripts: ['scripts/comp/runApplet.js']
    },
    nax_vibes: {
        scripts: ['scripts/comp/naxVibesApplet.js']
    },
    grimoire: {
        styles: ['css/tag-wiki-search.css'],
        scripts: ['scripts/comp/grimoireRemoteBrowser.js', 'scripts/comp/grimoireIeChrome.js', 'scripts/comp/grimoireTabs.js', 'scripts/comp/tagWikiSearchModal.js']
    },
    character_search: {
        depends: ['grimoire'],
        scripts: ['scripts/comp/characterSearchModal.js']
    },
    explorer: {
        styles: ['css/explorer.css', 'css/vista-file-progress.css'],
        // vfsClient / vfsVirtualGrid / routers stay sync — desktop + inbound use them without Cartograph
        scripts: ['scripts/comp/explorerVistaChrome.js', 'scripts/comp/fileOperationProgress.js', 'scripts/comp/explorerApplet.js']
    },
    naxt: {
        styles: ['css/naxt-shell.css', 'css/spellbook.css', 'css/vista-atelier.css'],
        scripts: ['scripts/comp/naxtVistaChrome.js', 'scripts/comp/naxtApplet.js']
    },
    bracket_gen: {
        styles: ['css/bracket-generation.css'],
        scripts: ['scripts/comp/bracketGenerationApplet.js']
    },
    dataset_tag_toolbar: {
        scripts: ['scripts/comp/datasetTagToolbar.js']
    },
    compiled_prompt_inspector: {
        styles: ['css/compiled-prompt-lcd.css'],
        scripts: ['scripts/comp/compiledPromptInspector.js']
    },
    image_prompt_inspector: {
        // vista-atelier.css: the Vista menu bar
        styles: ['css/image-prompt-inspector.css', 'css/vista-atelier.css'],
        scripts: ['scripts/comp/imagePromptInspector.js']
    },
    tag_sets: {
        scripts: ['scripts/comp/tagSets.js']
    },
    planet_switcher: {
        styles: ['css/planet-switcher.css'],
        scripts: ['scripts/comp/planetSwitcher.js']
    },
    calculator: {
        styles: ['css/vista-calculator.css'],
        scripts: ['scripts/comp/desktop-apps/calculator.js']
    },
    media_player: {
        styles: ['css/desktop-apps/mediaPlayer.css'],
        scripts: ['scripts/comp/desktop-apps/mediaPlayer.js']
    },
    alarm: {
        scripts: ['scripts/comp/desktop-apps/alarmPomodoro.js']
    },
    remote_desktop: {
        scripts: ['scripts/comp/desktop-apps/guacRemote.js']
    },
    // Remote Desktop Connection: Vista's mstsc dialog; sessions open in remote_desktop's window
    remote_desktop_connection: {
        depends: ['remote_desktop'],
        styles: ['css/taskbar-properties.css', 'css/desktop-apps/remoteDesktopConnection.css'],
        scripts: ['scripts/comp/desktop-apps/remoteDesktopConnection.js']
    },
    emotion: {
        styles: ['css/desktop-apps/emotion.css'],
        scripts: ['scripts/comp/desktop-apps/emotion.js']
    },
    exchange: {
        styles: ['css/desktop-apps/exchange.css'],
        scripts: [
            'scripts/comp/desktop-apps/exchange.js',
            'scripts/comp/exchangeDsapApplet.js'
        ]
    },
    // Windows Vista's games (Yozora #609): the shared engine, then one feature per game
    vista_games: {
        styles: ['css/desktop-apps/vista-games.css'],
        scripts: ['scripts/comp/desktop-apps/vista-games/vistaGameEngine.js']
    },
    vista_minesweeper: {
        depends: ['vista_games'],
        scripts: ['scripts/comp/desktop-apps/vista-games/minesweeper.js']
    },
    vista_cards: {
        depends: ['vista_games'],
        scripts: ['scripts/comp/desktop-apps/vista-games/cardEngine.js']
    },
    vista_solitaire: {
        depends: ['vista_cards'],
        scripts: ['scripts/comp/desktop-apps/vista-games/solitaire.js']
    },
    vista_spider: {
        depends: ['vista_cards'],
        scripts: ['scripts/comp/desktop-apps/vista-games/spider.js']
    },
    vista_freecell: {
        depends: ['vista_cards'],
        scripts: ['scripts/comp/desktop-apps/vista-games/freecell.js']
    },
    vista_hearts: {
        depends: ['vista_cards'],
        scripts: ['scripts/comp/desktop-apps/vista-games/hearts.js']
    },
    vista_mahjong: {
        depends: ['vista_cards'],
        scripts: ['scripts/comp/desktop-apps/vista-games/mahjong.js']
    },
    vista_chess: {
        depends: ['vista_games'],
        scripts: [
            'scripts/comp/desktop-apps/vista-games/chessEngine.js',
            'scripts/comp/desktop-apps/vista-games/chessRender.js',
            'scripts/comp/desktop-apps/vista-games/chess.js'
        ]
    },
    vista_inkball: {
        depends: ['vista_games'],
        scripts: ['scripts/comp/desktop-apps/vista-games/inkball.js']
    },
    vista_purble: {
        // vista_cards for its status bar (VG.Cards.statusBar)
        depends: ['vista_cards'],
        scripts: [
            'scripts/comp/desktop-apps/vista-games/purbleRules.js',
            'scripts/comp/desktop-apps/vista-games/purble.js',
            'scripts/comp/desktop-apps/vista-games/purblePairs.js',
            'scripts/comp/desktop-apps/vista-games/purbleCakes.js',
            'scripts/comp/desktop-apps/vista-games/purbleShop.js'
        ]
    },
    vista_blockdrop: {
        depends: ['vista_games'],
        scripts: ['scripts/comp/desktop-apps/vista-games/blockdrop.js']
    },
    vista_brickbreaker: {
        depends: ['vista_games'],
        scripts: ['scripts/comp/desktop-apps/vista-games/brickbreaker.js']
    },
    // JezzBall (Win 3.x Entertainment Pack): a 16-bit program's classic window on the Vista desktop
    vista_jezzball: {
        depends: ['vista_games'],
        styles: ['css/desktop-apps/vista-jezzball.css'],
        scripts: [
            'scripts/comp/desktop-apps/vista-games/jezzballReal.js',
            'scripts/comp/desktop-apps/vista-games/jezzballCore.js',
            'scripts/comp/desktop-apps/vista-games/jezzballHelp.js',
            'scripts/comp/desktop-apps/vista-games/jezzball.js'
        ]
    },
    vista_explorer: {
        depends: ['vista_games'],
        styles: ['css/desktop-apps/vista-games-explorer.css'],
        scripts: ['scripts/comp/desktop-apps/vista-games/gamesExplorer.js']
    },
    start_menu_organizer: {
        scripts: ['scripts/comp/desktop-apps/startMenuOrganizer.js']
    },
    // Desktop Icon Settings and Change Icon (Personalize, a desktop shortcut's Change Icon...);
    // drawn with Taskbar Properties' Vista controls (tbp-*)
    desktop_icon_dialogs: {
        styles: ['css/taskbar-properties.css', 'css/desktop-icon-dialogs.css'],
        scripts: ['scripts/comp/desktopIconDialogs.js']
    },
    // Dovecote Express's Tools > Options (and Control Panel's Mail item): drawn with Taskbar
    // Properties' Vista controls (tbp-*); desktop-apps/dovecote.js openDovecoteMailOptions
    mail_options: {
        styles: ['css/taskbar-properties.css', 'css/mail-options.css'],
        scripts: ['scripts/comp/mailOptions.js']
    },
    // Taskbar and Start Menu Properties (public/scripts/comp/taskbarSettings.js openProperties)
    taskbar_properties: {
        styles: ['css/taskbar-properties.css'],
        scripts: ['scripts/comp/taskbarProperties.js']
    },
    control_panel: {
        // Remote Access Properties draws with Taskbar Properties' Vista controls (tbp-*)
        styles: ['css/desktop-settings.css', 'css/vista-defender.css', 'css/cpl-system.css',
            'css/taskbar-properties.css', 'css/remote-access-properties.css', 'css/cpl-personalization.css'],
        scripts: [
            'scripts/comp/melatonControlPanel.js',
            'scripts/comp/experienceIndex.js',
            'scripts/comp/cplSystem.js',
            'scripts/comp/remoteAccessProperties.js',
            'scripts/comp/cplAuthentication.js',
            'scripts/comp/cplUpdate.js',
            'scripts/comp/cplUserAccounts.js',
            'scripts/comp/windowsDefender.js',
            'scripts/comp/cplSearch.js',
            'scripts/comp/cplMail.js',
            'scripts/comp/cplDesktopBackground.js',
            // Personalization's hub and Window Color page, then the Screen Saver and Sound dialogs
            'scripts/comp/cplPersonalization.js',
            'scripts/comp/personalizationDialogs.js'
        ]
    }
};

class FeatureLoader {
    constructor() {
        this.loadedFeatures = new Set();
        this.loadingPromises = new Map();
    }

    /**
     * Dynamically loads a feature's CSS, HTML templates, and JS scripts.
     * @param {string} name - Name of the feature in the manifest
     * @returns {Promise<boolean>}
     */
    async loadFeature(name) {
        if (this.loadedFeatures.has(name)) return true;
        if (this.loadingPromises.has(name)) return this.loadingPromises.get(name);

        const promise = (async () => {
            const feature = FEATURE_MANIFEST[name];
            if (!feature) {
                console.warn(`Feature loader: unknown feature "${name}"`);
                return false;
            }

            if (Array.isArray(feature.depends)) {
                for (const dep of feature.depends) {
                    await this.loadFeature(dep);
                }
            }

            console.log(`📦 Loading feature "${name}"...`);

            // 1. Inject Stylesheets
            if (Array.isArray(feature.styles)) {
                for (const style of feature.styles) {
                    await this._injectStylesheet(style);
                }
            }

            // 2. Inject HTML Template Markup
            if (feature.html) {
                try {
                    const htmlText = await fetch(`/${feature.html}`).then(r => {
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        return r.text();
                    });
                    document.body.insertAdjacentHTML('beforeend', htmlText);
                } catch (err) {
                    console.error(`❌ Failed to load HTML template for "${name}":`, err);
                    throw err;
                }
            }

            // 3. Inject scripts sequentially (to preserve execution order / dependency chain)
            if (Array.isArray(feature.scripts)) {
                for (const script of feature.scripts) {
                    await this._loadScript(script);
                }
            }

            this.loadedFeatures.add(name);
            this.loadingPromises.delete(name);
            console.log(`✅ Feature "${name}" successfully loaded.`);
            return true;
        })();

        this.loadingPromises.set(name, promise);
        return promise;
    }

    isLoaded(name) {
        return this.loadedFeatures.has(name);
    }

    async _versionedAssetUrl(src) {
        const clean = src.startsWith('/') ? src : `/${src}`;
        const pathOnly = clean.split('?')[0];
        let hash = null;
        // hashForStaticPath: public/scripts/comp/serviceWorkerManager.js
        if (typeof serviceWorkerManager !== 'undefined' && serviceWorkerManager
            && typeof serviceWorkerManager.hashForStaticPath === 'function') {
            try {
                hash = await serviceWorkerManager.hashForStaticPath(pathOnly);
            } catch (_) {
                hash = null;
            }
        }
        if (!hash) return pathOnly;
        // buildShaBustUrl: public/scripts/comp/serviceWorkerManager.js
        // Same ?sha= the service worker's manifest hash uses. sw.js matches the
        // pathname (ignoreSearch), so this hits the precached row instead of a second fetch.
        return buildShaBustUrl(pathOnly, hash);
    }

    async _injectStylesheet(href) {
        const url = await this._versionedAssetUrl(href);
        const pathOnly = url.split('?')[0];
        if (document.querySelector(`link[href^="${pathOnly}"]`)) return;

        const el = document.createElement('link');
        el.rel = 'stylesheet';
        el.href = url;
        document.head.appendChild(el);
    }

    _loadScript(src) {
        return this._versionedAssetUrl(src).then((url) => new Promise((resolve, reject) => {
            const pathOnly = url.split('?')[0];
            if (document.querySelector(`script[src^="${pathOnly}"]`)) {
                resolve();
                return;
            }

            const el = document.createElement('script');
            el.src = url;
            el.async = false;
            el.onload = () => resolve();
            el.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.body.appendChild(el);
        }));
    }
}

window.featureLoader = new FeatureLoader();

/** Cartograph entry — loads explorerApplet.js then opens. */
async function openExplorerApplet(path) {
    await featureLoader.loadFeature('explorer');
    // wireStudioVfsDrop / initializeExplorerApplet: public/scripts/comp/explorerApplet.js
    wireStudioVfsDrop();
    const app = initializeExplorerApplet();
    if (app) app.open(path);
}

/** The Notepad manager, loading notepadManager.js first if nothing has opened Notepad yet. */
async function loadNotepadManager() {
    await featureLoader.loadFeature('notepad');
    return window.notepadManager || null;
}

async function openGrimoireApplet(initialQuery) {
    await featureLoader.loadFeature('grimoire');
    // a search from elsewhere is a new tab (grimoireOpenInTab: public/scripts/comp/grimoireTabs.js)
    const query = String(initialQuery || '').trim();
    if (query && grimoireOpenInTab({ address: 'edtx://en.grimoire.jp/search?q=' + encodeURIComponent(query) })) return;
    tagWikiSearchModal.open(initialQuery || '');
}

// Alchemy Home until the local homepage lands (Yozora #318)
const ALCHEMY_HOME_URL = 'https://www.bing.com/';

// http(s) lands in Alchemy, Grimoire's remote browser (TagWikiSearchModal.navigate)
async function openGrimoireUrl(url) {
    await featureLoader.loadFeature('grimoire');
    // a new tab in the Grimoire window (grimoireOpenInTab: public/scripts/comp/grimoireTabs.js)
    if (grimoireOpenInTab({ address: url })) return;
    tagWikiSearchModal.open('', { skipInitialHome: true });
    tagWikiSearchModal.navigate(url);
}

// A web link from anywhere in the app opens as an Alchemy tab instead of a browser tab.
// Same-origin and non-web URLs, and a Grimoire that will not load, keep the browser's new tab.
// Sign-in flows that need the user's own browser cookies (NovelAI Explore, Cursor login) call open() directly.
function openWebUrl(url) {
    let parsed = null;
    try { parsed = new URL(url, location.href); } catch (_) { /* not a URL */ }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin === location.origin) {
        open(url, '_blank', 'noopener,noreferrer');
        return Promise.resolve();
    }
    return openGrimoireUrl(parsed.href).catch(() => {
        open(parsed.href, '_blank', 'noopener,noreferrer');
    });
}

// Every web <a> in the app (Grimoire articles, references, applets) goes through openWebUrl on a
// left or middle click. Handlers that own their links (Grimoire search links, the DSAP leave dialog,
// Director chat) preventDefault first. Ctrl/Shift/Alt/Meta-click and data-browser-tab keep the browser.
function catchWebLinkClick(e) {
    if (e.defaultPrevented || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    if (e.button !== 0 && e.button !== 1) return;
    const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download') || link.hasAttribute('data-browser-tab')) return;
    let url;
    try { url = new URL(link.href); } catch (_) { return; }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin === location.origin) return;
    e.preventDefault();
    void openWebUrl(url.href);
}
document.addEventListener('click', catchWebLinkClick);
document.addEventListener('auxclick', catchWebLinkClick);

// New standalone Alchemy window (wikiWindowManager), not the main Grimoire tab.
// grimoireOpenStandaloneWindow: public/scripts/comp/grimoireRemoteBrowser.js
async function openGrimoireStandaloneUrl(url, windowTitle) {
    await featureLoader.loadFeature('grimoire');
    // a tab in the Grimoire window when it has the tab strip (grimoireOpenInTab: public/scripts/comp/grimoireTabs.js)
    if (grimoireOpenInTab({ url })) return;
    grimoireOpenStandaloneWindow(url, null, windowTitle);
}

// Start a Vista game by id (minesweeper, solitaire ...): its feature, then the game's open()
// from the VistaGames registry (public/scripts/comp/desktop-apps/vista-games/vistaGameEngine.js)
async function openVistaGame(id) {
    await featureLoader.loadFeature('vista_' + id);
    const game = window.VistaGames && VistaGames.list().find((entry) => entry.id === id);
    if (!game) throw new Error('Game not found: ' + id);
    return game.open();
}

async function openSpellbookApplet() {
    await featureLoader.loadFeature('spellbook');
    // initializeSpellbookModalManager: public/scripts/comp/spellbookModal.js
    const manager = initializeSpellbookModalManager();
    if (manager) manager.openModal();
    return manager;
}

async function openNaxtApplet() {
    await featureLoader.loadFeature('naxt');
    // initializeNaxtBagTray: public/scripts/comp/naxtApplet.js
    initializeNaxtBagTray();
    return naxtApplet.open();
}

async function openBracketGenerationApplet(options) {
    await featureLoader.loadFeature('bracket_gen');
    // initializePhasewalkerTray: public/scripts/comp/bracketGenerationApplet.js
    initializePhasewalkerTray();
    return bracketGenerationApplet.open(options);
}

function phasewalkerSubmenuItems(build) {
    // buildPhasewalkerContextSubmenuItems: public/scripts/comp/runCommandIndex.js
    if (typeof buildPhasewalkerContextSubmenuItems === 'function') return build();
    void featureLoader.loadFeature('run_index').then(() => {
        // refreshSubmenu: public/scripts/comp/contextMenu.js
        if (typeof contextMenu !== 'undefined' && contextMenu && typeof contextMenu.refreshSubmenu === 'function') {
            contextMenu.refreshSubmenu();
        }
    });
    return [{ text: 'Loading...', disabled: true }];
}

async function ensureRunCommandIndex() {
    await featureLoader.loadFeature('run_index');
}

// Weather styles are not on the first paint. Idle, after first paint.
const WEATHER_IDLE_STYLES = [
    'css/weather-location.css',
    'css/weather-cards.css',
    'css/weather-lcd.css',
    'dist/fonts/weather-icons.min.css'
];

function registerAssetPreloadStepStub() {
    if (typeof isDesktop === 'undefined' || !isDesktop) return;
    if (typeof wsClient === 'undefined' || !wsClient || wsClient._assetPreloadStepsStubbed) return;
    wsClient._assetPreloadStepsStubbed = true;
    wsClient.registerInitStep(12.2, 'Loading wallpaper', function () {
        return assetPreload.preloadWallpaperStage();
    });
    wsClient.registerInitStep(18.2, 'Loading desktop icons', function () {
        return assetPreload.preloadDesktopIconsStage();
    });
    wsClient.registerInitStep(18.4, 'Loading desktop assets', function () {
        return assetPreload.preloadDesktopAssetsStage();
    });
}

registerAssetPreloadStepStub();

// scheduleAfterFirstPaint: public/scripts/comp/serviceWorkerManager.js
if (typeof scheduleAfterFirstPaint === 'function') {
    scheduleAfterFirstPaint(() => {
        // loadAssetPreloadScript: public/app.html (head stand-in)
        loadAssetPreloadScript().catch((err) => {
            console.warn('Asset preload idle load failed:', err);
        });
        WEATHER_IDLE_STYLES.forEach((href) => {
            void featureLoader._injectStylesheet(href);
        });
    });
}
