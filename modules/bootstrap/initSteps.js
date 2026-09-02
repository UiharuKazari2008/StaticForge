/**
 * Declarative GlobalResources boot pipeline.
 * Order is the dependency order; `when` skips optional steps; `afterReady` runs after gr.initialized = true.
 */

const databases = require('./databases');
const { initializeAccountSubscriptionSnapshot } = require('../accountSubscriptionSnapshot');

/**
 * @typedef {object} InitStep
 * @property {string} id
 * @property {string} label
 * @property {boolean} [sync]
 * @property {boolean} [afterReady]
 * @property {(gr: object, options: object) => boolean} [when]
 * @property {string} [skipMessage]
 * @property {(gr: object, options: object) => (void|Promise<void>)} run
 */

/** @type {InitStep[]} */
const INIT_STEPS = [
    {
        id: 'gr_configs',
        label: 'Loading configuration',
        sync: true,
        run: (gr) => {
            if (!gr.configManager) {
                gr.initializeConfigs();
            }
        },
    },
    {
        id: 'gr_logger',
        label: 'Starting logger',
        sync: true,
        run: (gr) => {
            if (!gr.logger) {
                gr.initializeLogger();
            }
        },
    },
    {
        id: 'gr_lru_cache',
        label: 'Initializing LRU caches',
        sync: true,
        run: (gr) => {
            gr.initializeLRUCaches();
        },
    },
    {
        id: 'gr_api_keys',
        label: 'Initializing API key manager',
        sync: true,
        run: (gr) => {
            gr.initializeApiKeyManager();
        },
    },
    {
        id: 'gr_polymodules',
        label: 'Registering polymorphic modules',
        sync: true,
        run: (gr) => {
            gr.initializePolymodules();
        },
    },
    {
        id: 'gr_html_markdown',
        label: 'Initializing HTML to Markdown converter',
        run: (gr) => gr.initializeHtmlMarkdown(),
    },
    {
        id: 'gr_t5_tokenizer',
        label: 'Loading T5 tokenizer',
        run: (gr) => gr.initializeT5Tokenizer(),
    },
    {
        id: 'gr_spell_checker',
        label: 'Loading spell checker',
        run: (gr) => gr.initializeSpellChecker(),
    },
    {
        id: 'gr_word_lookup',
        label: 'Loading dictionary service',
        run: (gr) => gr.initializeWordLookupService(),
    },
    {
        id: 'gr_auxiliary',
        label: 'Loading auxiliary services',
        run: (gr) => gr.initializeAuxiliaryServices(),
    },
    {
        id: 'gr_databases',
        label: 'Setting up databases',
        run: (gr) => databases.initializeDatabases(gr),
    },
    {
        id: 'gr_replication',
        label: 'Initializing replication stack',
        run: (gr) => gr.initializeReplicationStack(),
    },
    {
        id: 'gr_knowledge_memory',
        label: 'Initializing knowledge memory database',
        sync: true,
        run: (gr) => databases.initializeKnowledgeMemoryDb(gr),
    },
    {
        id: 'gr_tag_search_db',
        label: 'Initializing tag search database',
        sync: true,
        run: (gr) => databases.initializeTagSearchDatabase(gr),
    },
    {
        id: 'gr_nax_tags',
        label: 'Initializing NAX tags database',
        sync: true,
        run: (gr) => databases.initializeNaxTagsDatabase(gr),
    },
    {
        id: 'gr_nax_vibes',
        label: 'Initializing NAX vibes gallery',
        sync: true,
        run: (gr) => databases.initializeNaxVibesGallery(gr),
    },
    {
        id: 'gr_novelai_explore',
        label: 'Initializing NovelAI Explore gallery',
        sync: true,
        run: (gr) => databases.initializeNovelaiExploreGallery(gr),
    },
    {
        id: 'gr_nax_generation',
        label: 'Loading NAX tag generation config',
        sync: true,
        run: (gr) => databases.initializeNaxTagGeneration(gr),
    },
    {
        id: 'gr_reference_metadata',
        label: 'Initializing reference metadata database',
        sync: true,
        run: (gr) => databases.initializeReferenceMetadataDatabase(gr),
    },
    {
        id: 'gr_generation_quips_db',
        label: 'Initializing generation quips database',
        sync: true,
        run: (gr) => databases.initializeGenerationQuipsDatabase(gr),
    },
    {
        id: 'gr_characters_db',
        label: 'Initializing characters database',
        sync: true,
        run: (gr) => databases.initializeCharactersDatabase(gr),
    },
    {
        id: 'gr_singleton_managers',
        label: 'Initializing AI and memory managers',
        sync: true,
        run: (gr) => {
            gr.initializeSingletonManagers();
        },
    },
    {
        id: 'gr_workspace',
        label: 'Loading workspace system',
        sync: true,
        run: (gr) => {
            gr.initializeWorkspace();
        },
    },
    {
        id: 'gr_generation_quips_mgr',
        label: 'Initializing generation quips manager',
        sync: true,
        run: (gr) => {
            gr.initializeGenerationQuipsManager();
        },
    },
    {
        id: 'gr_novel_handlers',
        label: 'Initializing novel handlers',
        sync: true,
        run: (gr) => {
            gr.initializeNovelHandlers();
        },
    },
    {
        id: 'gr_queue',
        label: 'Initializing queue',
        sync: true,
        run: (gr) => {
            gr.initializeQueue();
        },
    },
    {
        id: 'gr_favorites',
        label: 'Initializing favorites manager',
        sync: true,
        run: (gr) => {
            gr.initializeFavoritesManager();
        },
    },
    {
        id: 'gr_checkpoint',
        label: 'Initializing checkpoint manager',
        sync: true,
        run: (gr) => {
            gr.initializeGlobalCheckpointManager();
        },
    },
    {
        id: 'gr_dataset_tags',
        label: 'Loading dataset tag service',
        run: (gr) => gr.initializeDatasetTagService(),
    },
    {
        id: 'gr_custom_resolutions',
        label: 'Loading custom resolutions',
        sync: true,
        run: (gr) => {
            gr.initializeCustomResolutions();
        },
    },
    {
        id: 'gr_master_clients',
        label: 'Initializing API clients',
        run: (gr) => gr.initializeMasterClients(),
    },
    {
        id: 'gr_character_data',
        label: 'Loading character data',
        run: (gr) => gr.loadCharacterData(),
    },
    {
        id: 'gr_tag_search_services',
        label: 'Loading tag search services',
        // Config is loaded earlier in the pipeline; honor explicit option or preloadTags.
        when: (gr, options) => (
            options.loadTagSearchServices != null
                ? !!options.loadTagSearchServices
                : !!gr.getConfig()?.preloadTags
        ),
        skipMessage: 'Skipping tag search services (lazy-load)',
        run: (gr) => databases.initializeTagSearchServices(gr),
    },
    {
        id: 'gr_system_info',
        label: 'Initializing system info cache',
        sync: true,
        run: (gr) => {
            gr.initializeSystemInfoCache();
        },
    },
    {
        id: 'gr_novelai_status',
        label: 'Starting NovelAI status monitor',
        sync: true,
        run: (gr) => {
            gr.initializeNovelAiStatusMonitor();
        },
    },
    {
        id: 'gr_account_snapshot',
        label: 'Initializing account subscription snapshot',
        sync: true,
        run: (gr) => {
            initializeAccountSubscriptionSnapshot(gr);
        },
    },
    {
        id: 'gr_runpod_pods',
        label: 'Starting managed RunPod watcher',
        afterReady: true,
        sync: true,
        run: (gr) => {
            gr.getRunpodPodManager().start();
        },
    },
    {
        id: 'gr_nai_prompt_guide',
        label: 'Refreshing Docubase wiki',
        afterReady: true,
        run: (gr) => {
            const naiPromptGuideSync = require('../naiPromptGuideSync');
            const cacheDir = gr.getPath('cache');
            setImmediate(() => {
                Promise.resolve(naiPromptGuideSync.syncNaiPromptGuide(cacheDir)).then((result) => {
                    const built = naiPromptGuideSync.materializeDocubaseWiki(cacheDir);
                    if (gr.logger?.bootSubStep) {
                        const syncBit = result.ok
                            ? (result.cloned ? 'cloned' : 'hard-reset')
                            : `git skipped (${result.error})`;
                        const buildBit = built && built.ok ? `${built.pages} wiki pages` : (built && built.error) || 'no pages';
                        gr.logger.bootSubStep(`Docubase ${syncBit}, ${buildBit}`);
                    }
                }).catch((err) => {
                    try {
                        naiPromptGuideSync.materializeDocubaseWiki(cacheDir);
                    } catch (_) { /* */ }
                    if (gr.logger?.bootSubStep) {
                        gr.logger.bootSubStep(`Docubase skipped: ${err.message}`);
                    }
                });
            });
        },
    },
    {
        id: 'gr_workspace_sync',
        label: 'Syncing workspace files',
        afterReady: true,
        run: (gr) => {
            if (!gr.workspace) {
                return;
            }
            setImmediate(() => {
                gr.workspace.syncWorkspaceFiles().then(() => {
                    if (gr.metadataDatabase?.ensureGalleryOwnershipFromWorkspaces) {
                        const workspaces = gr.getWorkspacesConfig();
                        gr.metadataDatabase.ensureGalleryOwnershipFromWorkspaces(workspaces).then(() => {
                            gr.workspace?.stripGalleryArraysFromWorkspacesCache?.();
                        }).catch((err) => {
                            console.error('[init] Gallery ownership reconcile failed:', err.message || err);
                        });
                    }
                }).catch((error) => {
                    console.error('[init] Failed to sync workspace files after initialization:', error.message);
                });
            });
        },
    },
];

module.exports = {
    INIT_STEPS,
    databases,
};
