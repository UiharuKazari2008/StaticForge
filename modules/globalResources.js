/**
 * Global Resource Manager
 * Centralized initialization and access to large datasets and services
 * Loads once at server startup and provides global access
 */

const path = require('path');
const AnimeTagSearch = require('./animeTagSearch');
const FurryTagSearch = require('./furryTagSearch');
const FastTagSearch = require('./fastTagSearch');
const SpellChecker = require('./spellChecker');
const t5TokenizerService = require('./t5-tokenizer-service');
const knowledgeMemoryDb = require('./knowledgeMemoryDatabase');
const config = require('../config');

class GlobalResources {
    constructor() {
        this.initialized = false;
        this.initStartTime = null;
        this.initEndTime = null;
        
        // Tag search services
        this.animeTagSearch = null;
        this.furryTagSearch = null;
        this.fastTagSearch = null;
        
        // Other services
        this.spellChecker = null;
        this.t5Tokenizer = null;
        this.searchService = null; // Lazy-loaded to avoid circular dependency
        this.knowledgeMemoryDb = null;
        
        // Character data for auto-complete
        this.characterDataArray = null;
        
        // Initialization status
        this.initializationProgress = {
            animeTagSearch: false,
            furryTagSearch: false,
            fastTagSearch: false,
            spellChecker: false,
            t5Tokenizer: false,
            searchService: false,
            characterData: false,
            knowledgeMemoryDb: false
        };
    }
    
    /**
     * Initialize all global resources at server startup
     * @param {Object} options - Initialization options
     * @returns {Promise<boolean>} - Success status
     */
    async initialize(options = {}) {
        if (this.initialized) {
            console.log('⚠️ Global resources already initialized');
            return true;
        }
        
        this.initStartTime = Date.now();
        console.log('🚀 Initializing global resources...');
        
        try {
            // Initialize T5 tokenizer first (shared by many services)
            await this.initializeT5Tokenizer();
            
            // Initialize spell checker
            await this.initializeSpellChecker();
            
            // Initialize knowledge memory database
            this.initializeKnowledgeMemoryDb();
            
            // Load character data for auto-complete
            await this.loadCharacterData();
            
            // Initialize tag search services (very large - 380MB+)
            const { loadTagSearchServices = !!config?.preloadTags || false} = options;
            if (loadTagSearchServices) {
                await this.initializeTagSearchServices();
            } else {
                console.log('⏭️  Skipping tag search services (saves ~380MB memory)');
                console.log('   They will lazy-load if needed');
            }
            
            this.initialized = true;
            this.initEndTime = Date.now();
            
            const initTime = ((this.initEndTime - this.initStartTime) / 1000).toFixed(2);
            console.log(`✅ Global resources initialized in ${initTime}s`);
            console.log('📊 Initialization status:', this.initializationProgress);
            
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize global resources:', error);
            return false;
        }
    }
    
    /**
     * Initialize T5 tokenizer (shared by all services)
     */
    async initializeT5Tokenizer() {
        console.log('  🔤 Loading T5 tokenizer...');
        
        try {
            if (!t5TokenizerService.initialized) {
                await t5TokenizerService.initialize();
            }
            this.t5Tokenizer = t5TokenizerService;
            this.initializationProgress.t5Tokenizer = true;
            console.log('    ✓ T5 Tokenizer loaded');
        } catch (error) {
            console.error('  ❌ Failed to load T5 tokenizer:', error);
            throw error;
        }
    }
    
    /**
     * Initialize tag search services (AnimeTagSearch, FurryTagSearch, FastTagSearch)
     */
    async initializeTagSearchServices() {
        console.log('  📚 Loading tag search services...');
        
        try {
            // AnimeTagSearch loads dataset_tags.json + indexes
            this.animeTagSearch = new AnimeTagSearch();
            this.initializationProgress.animeTagSearch = true;
            console.log('    ✓ AnimeTagSearch loaded');
            
            // FurryTagSearch loads dataset_tags_furry.json + indexes
            this.furryTagSearch = new FurryTagSearch();
            this.initializationProgress.furryTagSearch = true;
            console.log('    ✓ FurryTagSearch loaded');
            
            // FastTagSearch wraps both
            this.fastTagSearch = new FastTagSearch(this.animeTagSearch, this.furryTagSearch);
            this.initializationProgress.fastTagSearch = true;
            console.log('    ✓ FastTagSearch initialized');
        } catch (error) {
            console.error('  ❌ Failed to load tag search services:', error);
            throw error;
        }
    }
    
    /**
     * Initialize spell checker
     */
    async initializeSpellChecker() {
        console.log('  📝 Loading spell checker...');
        
        try {
            this.spellChecker = new SpellChecker();
            this.initializationProgress.spellChecker = true;
            console.log('    ✓ SpellChecker loaded');
        } catch (error) {
            console.error('  ❌ Failed to load spell checker:', error);
            throw error;
        }
    }
    
    /**
     * Load character data for auto-complete
     */
    async loadCharacterData() {
        console.log('  👥 Loading character data...');
        
        try {
            const fs = require('fs');
            const characterDataPath = path.join(__dirname, '../characters.json');
            
            if (fs.existsSync(characterDataPath)) {
                const data = JSON.parse(fs.readFileSync(characterDataPath, 'utf8'));
                this.characterDataArray = data.data || [];
                this.initializationProgress.characterData = true;
                console.log(`    ✓ Loaded ${this.characterDataArray.length} characters`);
            } else {
                console.log('    ⚠️  characters.json not found');
                this.characterDataArray = [];
                this.initializationProgress.characterData = true;
            }
        } catch (error) {
            console.error('  ❌ Failed to load character data:', error);
            this.characterDataArray = [];
            this.initializationProgress.characterData = true;
        }
    }
    
    /**
     * Initialize knowledge memory database
     */
    initializeKnowledgeMemoryDb() {
        console.log('  🧠 Loading knowledge memory database...');
        
        try {
            // Ensure database is initialized (may have been called in web_server.js, but ensure it's done)
            const { initializeKnowledgeMemoryDatabase } = knowledgeMemoryDb;
            const initialized = initializeKnowledgeMemoryDatabase();
            
            if (!initialized) {
                throw new Error('Failed to initialize knowledge memory database');
            }
            
            // Store a reference to the module for global access
            this.knowledgeMemoryDb = knowledgeMemoryDb;
            this.initializationProgress.knowledgeMemoryDb = true;
            console.log('    ✓ Knowledge memory database ready');
        } catch (error) {
            console.error('  ❌ Failed to load knowledge memory database:', error);
            throw error;
        }
    }
    
    /**
     * Get AnimeTagSearch instance (lazy-loads if not already loaded)
     */
    async getAnimeTagSearch() {
        if (!this.initialized) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        
        if (!this.animeTagSearch) {
            console.log('⚡ Lazy-loading AnimeTagSearch (first use)...');
            await this.initializeTagSearchServices();
        }
        
        return this.animeTagSearch;
    }
    
    /**
     * Get FurryTagSearch instance (lazy-loads if not already loaded)
     */
    async getFurryTagSearch() {
        if (!this.initialized) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        
        if (!this.furryTagSearch) {
            console.log('⚡ Lazy-loading FurryTagSearch (first use)...');
            await this.initializeTagSearchServices();
        }
        
        return this.furryTagSearch;
    }
    
    /**
     * Get FastTagSearch instance (lazy-loads if not already loaded)
     */
    async getFastTagSearch() {
        if (!this.initialized) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        
        if (!this.fastTagSearch) {
            console.log('⚡ Lazy-loading FastTagSearch (first use)...');
            await this.initializeTagSearchServices();
        }
        
        return this.fastTagSearch;
    }
    
    /**
     * Get SpellChecker instance
     */
    getSpellChecker() {
        if (!this.initialized || !this.spellChecker) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.spellChecker;
    }
    
    /**
     * Get T5 Tokenizer instance
     */
    getT5Tokenizer() {
        if (!this.initialized || !this.t5Tokenizer) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.t5Tokenizer;
    }
    
    /**
     * Get character data array for auto-complete
     */
    getCharacterData() {
        if (!this.initialized) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.characterDataArray || [];
    }
    
    /**
     * Get Knowledge Memory Database instance
     */
    getKnowledgeMemoryDb() {
        if (!this.initialized || !this.knowledgeMemoryDb) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.knowledgeMemoryDb;
    }
    
    /**
     * Get SearchService instance (lazy-loaded to avoid circular dependency)
     */
    getSearchService() {
        if (!this.initialized) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        
        // Lazy-load SearchService to avoid circular dependency with textReplacements.js
        if (!this.searchService) {
            console.log('  🔍 Lazy-loading SearchService...');
            const { SearchService } = require('./textReplacements');
            this.searchService = new SearchService();
            
            // Replace its internal instances with our global ones  
            if (this.searchService.animeTagSearch) {
                this.searchService.animeTagSearch = this.animeTagSearch;
            }
            if (this.searchService.furryTagSearch) {
                this.searchService.furryTagSearch = this.furryTagSearch;
            }
            if (this.searchService.spellChecker) {
                this.searchService.spellChecker = this.spellChecker;
            }
            
            this.initializationProgress.searchService = true;
            console.log('    ✓ SearchService loaded (lazy)');
        }
        
        return this.searchService;
    }
    
    /**
     * Check if resources are initialized
     */
    isInitialized() {
        return this.initialized;
    }
    
    /**
     * Get initialization progress
     */
    getInitializationProgress() {
        return {
            initialized: this.initialized,
            progress: this.initializationProgress,
            initTime: this.initEndTime && this.initStartTime 
                ? ((this.initEndTime - this.initStartTime) / 1000).toFixed(2) + 's'
                : null
        };
    }
}

// Export singleton instance
const globalResources = new GlobalResources();

module.exports = globalResources;

