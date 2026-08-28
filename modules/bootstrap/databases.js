/**
 * Database and tag-index bootstrap for GlobalResources.
 * Bodies live here; GlobalResources keeps thin wrappers for call-site compatibility.
 */

const fs = require('fs');
const path = require('path');
const AnimeTagSearch = require('../animeTagSearch');
const FurryTagSearch = require('../furryTagSearch');
const FastTagSearch = require('../fastTagSearch');
const knowledgeMemoryDb = require('../knowledgeMemoryDatabase');
const tagSearchDatabase = require('../tagSearchDatabase');
const naxTagsDatabase = require('../naxTagsDatabase');
const NaxTagGenerationService = require('../naxTagGeneration');
const naxVibesGallery = require('../naxVibesGallery');
const novelaiExploreGallery = require('../novelaiExploreGallery');
const applicationAuthDatabase = require('../applicationAuthDatabase');
const telemetryDatabase = require('../telemetryDatabase');
const { ApplicationAuthManager } = require('../applicationAuthManager');
const ReferenceMetadataDatabase = require('../referenceMetadataDatabase');
const GenerationQuipsDatabase = require('../generationQuipsDatabase');
const CharactersDatabase = require('../charactersDatabase');
const metadataDatabase = require('../metadataDatabase');
const chatDatabase = require('../chatDatabase');
const directorDatabase = require('../directorDatabase');
const notesDatabase = require('../notesDatabase');
const vfsDatabase = require('../vfsDatabase');
const { VfsManager } = require('../vfsManager');
const TagLookup = require('../tag-lookup');
const { asyncSQLiteManager } = require('../sqliteAsyncWrapper');
const { createApplicationAuthEarlyMiddleware } = require('../auth');

function initializeAsyncSQLiteManager(gr) {
    try {
        asyncSQLiteManager.initialize();
        gr.asyncSQLiteManager = asyncSQLiteManager;
        console.log('✓ SQLite Manager ready');
    } catch (error) {
        console.error('  ❌ Failed to initialize async SQLite manager:', error);
        throw error;
    }
}

function initializeApplicationAuthManager(gr) {
    if (gr.applicationAuthManager) {
        return;
    }
    try {
        gr.applicationAuthManager = new ApplicationAuthManager(gr);
        gr.applicationAuthEarlyMiddleware = createApplicationAuthEarlyMiddleware(gr);
        console.log('✓ Application auth manager initialized');
    } catch (error) {
        console.error('  ❌ Failed to initialize application auth manager:', error);
        throw error;
    }
}

async function initializeDatabases(gr) {
    try {
        initializeAsyncSQLiteManager(gr);

        const databasesPath = gr.getPath('databases');
        await metadataDatabase.initializeDatabase(databasesPath, gr.pngMetadata);
        gr.metadataDatabase = metadataDatabase;
        gr.initializationProgress.metadataDatabase = true;
        console.log('✓ ForgeData and Sidechannel (Metadata) database ready');

        if (chatDatabase.initializeChatDatabase) {
            const success = await chatDatabase.initializeChatDatabase(databasesPath);
            if (!success) {
                throw new Error('Failed to initialize chat database - check logs above for details');
            }
        }
        gr.chatDatabase = chatDatabase;
        gr.initializationProgress.chatDatabase = true;
        console.log('✓ Persona Chat (LinkXi) database ready');

        if (directorDatabase.initializeDirectorDatabase) {
            const success = await directorDatabase.initializeDirectorDatabase(databasesPath);
            if (!success) {
                throw new Error('Failed to initialize director database - check logs above for details');
            }
        }
        gr.directorDatabase = directorDatabase;
        gr.initializationProgress.directorDatabase = true;
        console.log('✓ Enshutsuka Sessions (Image Director) database ready');

        if (notesDatabase.initializeNotesDatabase) {
            const success = await notesDatabase.initializeNotesDatabase(databasesPath);
            if (!success) {
                throw new Error('Failed to initialize notes database - check logs above for details');
            }
        }
        gr.notesDatabase = notesDatabase;
        gr.initializationProgress.notesDatabase = true;
        console.log('✓ Notes database ready');

        if (applicationAuthDatabase.initializeApplicationAuthDatabase) {
            const appAuthOk = await applicationAuthDatabase.initializeApplicationAuthDatabase(databasesPath);
            if (!appAuthOk) {
                throw new Error('Failed to initialize application auth database - check logs above for details');
            }
        }
        gr.applicationAuthDatabase = applicationAuthDatabase;
        gr.initializationProgress.applicationAuthDatabase = true;
        console.log('✓ Application auth database ready');

        if (telemetryDatabase.initializeTelemetryDatabase) {
            const telemetryOk = await telemetryDatabase.initializeTelemetryDatabase(databasesPath);
            if (!telemetryOk) {
                throw new Error('Failed to initialize telemetry database - check logs above for details');
            }
        }
        gr.telemetryDatabase = telemetryDatabase;
        gr.initializationProgress.telemetryDatabase = true;
        console.log('✓ Telemetry database ready');

        if (vfsDatabase.initializeVfsDatabase) {
            const vfsOk = await vfsDatabase.initializeVfsDatabase(databasesPath);
            if (!vfsOk) {
                throw new Error('Failed to initialize VFS database - check logs above for details');
            }
        }
        gr.vfsDatabase = vfsDatabase;
        gr.vfsManager = new VfsManager(gr);
        const userFilesPath = gr.getPath('userFiles');
        if (!fs.existsSync(userFilesPath)) {
            fs.mkdirSync(userFilesPath, { recursive: true });
        }
        gr.initializationProgress.vfsDatabase = true;
        console.log('✓ VFS database ready');

        const tagLookup = new TagLookup(gr);
        await tagLookup.initializeDatabase(databasesPath);
        // modules/autofillRankingSettings.js — global autofill ranking config (config.autofillRanking)
        tagLookup.setRankingConfig(gr.getConfig()?.autofillRanking);
        gr.tagDatabase = tagLookup;
        gr.initializationProgress.tagDatabase = true;
        console.log('✓ Tag Wiki database ready');

        initializeApplicationAuthManager(gr);
    } catch (error) {
        console.error('  ❌ Failed to initialize databases:', error);
        console.error('  Full error stack:', error.stack);
        throw error;
    }
}

function initializeKnowledgeMemoryDb(gr) {
    try {
        const { initializeKnowledgeMemoryDatabase } = knowledgeMemoryDb;
        const initialized = initializeKnowledgeMemoryDatabase(gr.getPath('databases'));

        if (!initialized) {
            throw new Error('Failed to initialize knowledge memory database');
        }

        gr.knowledgeMemoryDb = knowledgeMemoryDb;
        gr.initializationProgress.knowledgeMemoryDb = true;
        console.log('✓ Knowledge memory database ready');
    } catch (error) {
        console.error('  ❌ Failed to load knowledge memory database:', error);
        throw error;
    }
}

function initializeTagSearchDatabase(gr) {
    try {
        const { initializeTagSearchDatabase: initTagSearchDb } = tagSearchDatabase;
        const initialized = initTagSearchDb(gr.getPath('databases'));

        if (!initialized) {
            throw new Error('Failed to initialize tag search database');
        }

        gr.tagSearchDatabase = tagSearchDatabase;
        gr.initializationProgress.tagSearchDatabase = true;
        console.log('✓ Tag search database ready');

        const wikiPath = path.join(gr.getPath('databases'), 'tag_wiki.db');
        if (fs.existsSync(wikiPath)) {
            const applied = tagSearchDatabase.applyCachedNovelCounts(wikiPath);
            if (applied.filled > 0) {
                console.log(`✓ Filled ${applied.filled} missing tag n_count values from NovelAI search cache`);
            }
        }
    } catch (error) {
        console.error('  ❌ Failed to load tag search database:', error);
        throw error;
    }
}

function initializeNaxVibesGallery(gr) {
    naxVibesGallery.initNaxVibesGallery(gr.getPath('cache'));
    gr.naxVibesGallery = naxVibesGallery;
    console.log('✓ NAX vibes gallery proxy ready');
}

function initializeNovelaiExploreGallery(gr) {
    novelaiExploreGallery.initNovelaiExploreGallery(gr.getPath('cache'), {
        getApiKey: () => {
            try {
                return gr.getApiKeyManager()?.getActiveApiKey('novelai') || null;
            } catch {
                return null;
            }
        }
    });
    gr.novelaiExploreGallery = novelaiExploreGallery;
    console.log('✓ NovelAI Explore (Agora) gallery proxy ready');
}

function initializeNaxTagsDatabase(gr) {
    try {
        const ok = naxTagsDatabase.initializeNaxTagsDatabase(gr.getPath('naxTagsDb'));
        if (!ok) {
            throw new Error('Failed to initialize NAX tags database');
        }
        gr.naxTagsDatabase = naxTagsDatabase;
        gr.initializationProgress.naxTagsDatabase = true;
        console.log('✓ NAX tags database ready');
    } catch (error) {
        console.error('  ❌ Failed to load NAX tags database:', error);
        throw error;
    }
}

function initializeNaxTagGeneration(gr) {
    try {
        gr.naxTagGeneration = new NaxTagGenerationService(gr);
        try {
            gr.naxTagGeneration.loadConfig();
            console.log('✓ NAX tag generation config loaded');
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            if (msg.includes('not found')) {
                console.log('   - NAX generation config not found (optional); custom tag previews disabled');
            } else {
                console.warn('   ⚠️ NAX generation config invalid:', msg);
            }
        }
        gr.initializationProgress.naxTagGeneration = true;
    } catch (error) {
        console.error('  ❌ Failed to initialize NAX tag generation:', error);
        throw error;
    }
}

function initializeReferenceMetadataDatabase(gr) {
    try {
        gr.referenceMetadataDatabase = new ReferenceMetadataDatabase(gr);
        gr.initializationProgress.referenceMetadataDatabase = true;
        console.log('✓ Reference metadata database ready');
    } catch (error) {
        console.error('  ❌ Failed to initialize reference metadata database:', error);
        throw error;
    }
}

function initializeGenerationQuipsDatabase(gr) {
    try {
        gr.generationQuipsDatabase = new GenerationQuipsDatabase(gr);
        gr.initializationProgress.generationQuipsDatabase = true;
        console.log('✓ Generation quips database ready');
    } catch (error) {
        console.error('  ❌ Failed to initialize generation quips database:', error);
        throw error;
    }
}

function initializeCharactersDatabase(gr) {
    try {
        gr.charactersDatabase = new CharactersDatabase(gr);
        gr.initializationProgress.charactersDatabase = true;
        console.log('✓ Characters database ready');
    } catch (error) {
        console.error('  ❌ Failed to initialize characters database:', error);
        throw error;
    }
}

async function initializeTagSearchServices(gr) {
    try {
        gr.animeTagSearch = new AnimeTagSearch(gr);
        gr.initializationProgress.animeTagSearch = true;
        console.log('✓ AnimeTagSearch loaded');

        gr.furryTagSearch = new FurryTagSearch(gr);
        gr.initializationProgress.furryTagSearch = true;
        console.log('✓ FurryTagSearch loaded');

        gr.fastTagSearch = new FastTagSearch(gr);
        gr.initializationProgress.fastTagSearch = true;
        console.log('✓ FastTagSearch initialized');
    } catch (error) {
        console.error('  ❌ Failed to load tag search services:', error);
        throw error;
    }
}

module.exports = {
    initializeAsyncSQLiteManager,
    initializeApplicationAuthManager,
    initializeDatabases,
    initializeKnowledgeMemoryDb,
    initializeTagSearchDatabase,
    initializeNaxVibesGallery,
    initializeNovelaiExploreGallery,
    initializeNaxTagsDatabase,
    initializeNaxTagGeneration,
    initializeReferenceMetadataDatabase,
    initializeGenerationQuipsDatabase,
    initializeCharactersDatabase,
    initializeTagSearchServices,
};
