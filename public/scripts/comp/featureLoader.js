/**
 * Dynamic Feature and Asset Loader Core
 * Registers and asynchronously loads component scripts, styles, and HTML templates.
 */

const FEATURE_MANIFEST = {
    notepad: {
        html: 'templates/notepad.html',
        styles: [
            'css/notepad.css',
            'css/spellbook.css',
            'css/spell-check.css',
            'css/autocomplete.css'
        ],
        scripts: [
            'scripts/comp/notepadManager.js',
            'scripts/comp/spellbookModal.js'
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
        styles: ['css/log-viewer.css'],
        scripts: ['scripts/comp/logViewerApplet.js']
    },
    run: {
        styles: ['css/run-applet.css'],
        scripts: ['scripts/comp/runApplet.js']
    },
    nax_vibes: {
        scripts: ['scripts/comp/naxVibesApplet.js']
    },
    grimoire: {
        styles: ['css/tag-wiki-search.css'],
        scripts: ['scripts/comp/tagWikiSearchModal.js']
    },
    character_search: {
        depends: ['grimoire'],
        scripts: ['scripts/comp/characterSearchModal.js']
    },
    explorer: {
        styles: ['css/explorer.css'],
        // vfsClient / vfsVirtualGrid / routers stay sync — desktop + inbound use them without Cartograph
        scripts: ['scripts/comp/explorerApplet.js']
    },
    naxt: {
        styles: ['css/naxt-shell.css'],
        scripts: ['scripts/comp/naxtApplet.js']
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
        styles: ['css/image-prompt-inspector.css'],
        scripts: ['scripts/comp/imagePromptInspector.js']
    },
    tag_sets: {
        scripts: ['scripts/comp/tagSets.js']
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
                    this._injectStylesheet(style);
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

    _injectStylesheet(href) {
        const cleanHref = href.startsWith('/') ? href : `/${href}`;
        // Prevent duplicate link elements
        if (document.querySelector(`link[href^="${cleanHref}"]`)) return;

        const el = document.createElement('link');
        el.rel = 'stylesheet';
        // Add cache buster or dynamic sha if query string is omitted
        el.href = cleanHref;
        document.head.appendChild(el);
    }

    _loadScript(src) {
        return new Promise((resolve, reject) => {
            const cleanSrc = src.startsWith('/') ? src : `/${src}`;
            if (document.querySelector(`script[src^="${cleanSrc}"]`)) {
                resolve();
                return;
            }

            const el = document.createElement('script');
            el.src = cleanSrc;
            el.async = false; // Execute sequentially
            el.onload = () => resolve();
            el.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.body.appendChild(el);
        });
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

async function openGrimoireApplet(initialQuery) {
    await featureLoader.loadFeature('grimoire');
    tagWikiSearchModal.open(initialQuery || '');
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
    bracketGenerationApplet.open(options);
}
