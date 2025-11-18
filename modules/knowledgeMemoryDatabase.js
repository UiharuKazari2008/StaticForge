/**
 * Global Knowledge Memory Database
 * Stores persistent, context-independent knowledge graphs accessible to all users
 * Based on MCP Memory Server concepts adapted for StaticForge
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Database file path
const dbPath = path.join(__dirname, '..', '.cache', 'knowledge_memory.db');

// Ensure cache directory exists
const cacheDir = path.dirname(dbPath);
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

let db = null;

/**
 * Initialize the SQLite database for knowledge memory
 */
function initializeKnowledgeMemoryDatabase() {
    try {
        // If already initialized, return true
        if (db !== null) {
            return true;
        }
        
        // Open database (creates if doesn't exist)
        db = new Database(dbPath);
        
        // Enable WAL mode for better concurrency
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('cache_size = 10000');
        db.pragma('temp_store = MEMORY');
        
        // Create tables if they don't exist
        createKnowledgeMemoryTables();
        
        return true;
    } catch (error) {
        logger.error('Error initializing knowledge memory database:', error.message);
        return false;
    }
}

/**
 * Create database tables for knowledge memory
 */
function createKnowledgeMemoryTables() {
    // Knowledge memories table - stores named memory graphs
    db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE, -- Unique name for the memory (e.g., "pregnancy_rendering_techniques")
            description TEXT NOT NULL, -- Human-readable description of what this memory contains
            category TEXT, -- Category for organization (e.g., "technique", "style", "anatomy")
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            usage_count INTEGER DEFAULT 0, -- How many times this memory has been retrieved
            last_used_at INTEGER, -- Last time this memory was used
            confidence REAL DEFAULT 0.1 -- Confidence level (0-1) starts at 10%, increases by up to 25% per refinement
        )
    `);

    // Entities table - stores entities within knowledge graphs
    db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_entities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER NOT NULL,
            entity_id TEXT NOT NULL, -- Unique ID within the memory (e.g., "preg_belly_render")
            type TEXT NOT NULL, -- Entity type (concept, technique, style, character, location, effect)
            name TEXT NOT NULL, -- Human-readable name
            attributes TEXT, -- JSON object of attributes
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (memory_id) REFERENCES knowledge_memories (id) ON DELETE CASCADE,
            UNIQUE(memory_id, entity_id)
        )
    `);

    // Relations table - stores relationships between entities
    db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_relations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER NOT NULL,
            from_entity_id TEXT NOT NULL, -- Source entity ID
            to_entity_id TEXT NOT NULL, -- Target entity ID
            relation_type TEXT NOT NULL, -- Type of relationship (enhances, conflicts_with, requires, etc.)
            weight REAL DEFAULT 1.0, -- Relationship strength (0-1)
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (memory_id) REFERENCES knowledge_memories (id) ON DELETE CASCADE
        )
    `);

    // Observations table - stores specific notes/observations about entities
    db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER NOT NULL,
            entity_id TEXT NOT NULL, -- Entity this observation is about
            content TEXT NOT NULL, -- Observation content
            importance REAL DEFAULT 0.5, -- Importance level (0-1)
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (memory_id) REFERENCES knowledge_memories (id) ON DELETE CASCADE
        )
    `);

    // Create indexes for better performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_knowledge_memories_name ON knowledge_memories (name);
        CREATE INDEX IF NOT EXISTS idx_knowledge_memories_category ON knowledge_memories (category);
        CREATE INDEX IF NOT EXISTS idx_knowledge_entities_memory_id ON knowledge_entities (memory_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_entities_entity_id ON knowledge_entities (memory_id, entity_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_relations_memory_id ON knowledge_relations (memory_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_observations_memory_id ON knowledge_observations (memory_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_observations_entity_id ON knowledge_observations (memory_id, entity_id);
    `);
    
    logger.bootSubStep('Knowledge memory database ready');
}

/**
 * Close database connection
 */
function closeKnowledgeMemoryDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

/**
 * List all available knowledge memories
 * @returns {Array} Array of memory objects with name, description, category, usage stats
 */
function listKnowledgeMemories() {
    if (!db) {
        throw new Error('Knowledge memory database not initialized');
    }

    const stmt = db.prepare(`
        SELECT 
            name,
            description,
            category,
            usage_count,
            last_used_at,
            confidence,
            created_at,
            updated_at
        FROM knowledge_memories
        ORDER BY usage_count DESC, updated_at DESC
    `);

    return stmt.all();
}

/**
 * Get a specific knowledge memory by name
 * @param {string} name - Memory name
 * @param {boolean} incrementUsage - Whether to increment usage count (default: true for AI access, false for UI viewing)
 * @returns {Object|null} Memory object with entities, relations, and observations
 */
function getKnowledgeMemory(name, incrementUsage = true) {
    if (!db) {
        throw new Error('Knowledge memory database not initialized');
    }

    // Get memory metadata
    const memoryStmt = db.prepare(`
        SELECT * FROM knowledge_memories WHERE name = ?
    `);
    const memory = memoryStmt.get(name);

    if (!memory) {
        return null;
    }

    // Get entities
    const entitiesStmt = db.prepare(`
        SELECT entity_id, type, name, attributes FROM knowledge_entities WHERE memory_id = ?
    `);
    const entities = entitiesStmt.all(memory.id).map(e => ({
        id: e.entity_id,
        type: e.type,
        name: e.name,
        attributes: e.attributes ? JSON.parse(e.attributes) : {}
    }));

    // Get relations
    const relationsStmt = db.prepare(`
        SELECT from_entity_id, to_entity_id, relation_type, weight FROM knowledge_relations WHERE memory_id = ?
    `);
    const relations = relationsStmt.all(memory.id).map(r => ({
        from: r.from_entity_id,
        to: r.to_entity_id,
        type: r.relation_type,
        weight: r.weight
    }));

    // Get observations
    const observationsStmt = db.prepare(`
        SELECT entity_id, content, importance FROM knowledge_observations WHERE memory_id = ?
    `);
    const observations = observationsStmt.all(memory.id).map(o => ({
        entity_id: o.entity_id,
        content: o.content,
        importance: o.importance
    }));

    // Update usage stats only if requested (for AI access, not UI viewing)
    let usageCount = memory.usage_count;
    let lastUsedAt = memory.last_used_at;
    
    if (incrementUsage) {
        const updateStmt = db.prepare(`
            UPDATE knowledge_memories 
            SET usage_count = usage_count + 1, last_used_at = strftime('%s', 'now')
            WHERE id = ?
        `);
        updateStmt.run(memory.id);
        usageCount = memory.usage_count + 1;
        lastUsedAt = Date.now();
    } else {
        // Convert timestamp to milliseconds if it's in seconds
        lastUsedAt = memory.last_used_at < 10000000000 ? memory.last_used_at * 1000 : memory.last_used_at;
    }

    return {
        name: memory.name,
        description: memory.description,
        category: memory.category,
        confidence: memory.confidence,
        entities,
        relations,
        observations,
        usage_count: usageCount,
        last_used_at: lastUsedAt
    };
}

/**
 * Create or update a knowledge memory
 * @param {string} name - Unique memory name
 * @param {string} description - Human-readable description
 * @param {string} category - Memory category
 * @param {Array} entities - Array of entity objects
 * @param {Array} relations - Array of relation objects
 * @param {Array} observations - Array of observation objects
 * @param {number} confidence - Confidence level (0-1)
 * @returns {Object} Created/updated memory
 */
function saveKnowledgeMemory(name, description, category, entities = [], relations = [], observations = [], confidence = 0.1) {
    if (!db) {
        throw new Error('Knowledge memory database not initialized');
    }

    // Start transaction
    const transaction = db.transaction(() => {
        // Check if memory already exists
        const existingStmt = db.prepare('SELECT id FROM knowledge_memories WHERE name = ?');
        const existing = existingStmt.get(name);

        let memoryId;
        if (existing) {
            // Update existing memory
            const updateStmt = db.prepare(`
                UPDATE knowledge_memories 
                SET description = ?, category = ?, confidence = ?, updated_at = strftime('%s', 'now')
                WHERE name = ?
            `);
            updateStmt.run(description, category, confidence, name);
            memoryId = existing.id;

            // Delete existing entities, relations, and observations (cascade will clean up)
            db.prepare('DELETE FROM knowledge_entities WHERE memory_id = ?').run(memoryId);
            db.prepare('DELETE FROM knowledge_relations WHERE memory_id = ?').run(memoryId);
            db.prepare('DELETE FROM knowledge_observations WHERE memory_id = ?').run(memoryId);
        } else {
            // Create new memory
            const insertStmt = db.prepare(`
                INSERT INTO knowledge_memories (name, description, category, confidence)
                VALUES (?, ?, ?, ?)
            `);
            const result = insertStmt.run(name, description, category, confidence);
            memoryId = result.lastInsertRowid;
        }

        // Insert entities
        const entityStmt = db.prepare(`
            INSERT INTO knowledge_entities (memory_id, entity_id, type, name, attributes)
            VALUES (?, ?, ?, ?, ?)
        `);
        entities.forEach(entity => {
            entityStmt.run(
                memoryId,
                entity.id,
                entity.type,
                entity.name,
                JSON.stringify(entity.attributes || {})
            );
        });

        // Insert relations
        const relationStmt = db.prepare(`
            INSERT INTO knowledge_relations (memory_id, from_entity_id, to_entity_id, relation_type, weight)
            VALUES (?, ?, ?, ?, ?)
        `);
        relations.forEach(relation => {
            relationStmt.run(
                memoryId,
                relation.from,
                relation.to,
                relation.type,
                relation.weight || 1.0
            );
        });

        // Insert observations
        const observationStmt = db.prepare(`
            INSERT INTO knowledge_observations (memory_id, entity_id, content, importance)
            VALUES (?, ?, ?, ?)
        `);
        observations.forEach(observation => {
            observationStmt.run(
                memoryId,
                observation.entity_id,
                observation.content,
                observation.importance || 0.5
            );
        });

        return memoryId;
    });

    // Execute transaction
    const memoryId = transaction();

    return {
        name,
        description,
        category,
        entities,
        relations,
        observations,
        confidence
    };
}

/**
 * Delete a knowledge memory by name
 * @param {string} name - Memory name
 * @returns {boolean} Success
 */
function deleteKnowledgeMemory(name) {
    if (!db) {
        throw new Error('Knowledge memory database not initialized');
    }

    const stmt = db.prepare('DELETE FROM knowledge_memories WHERE name = ?');
    const result = stmt.run(name);
    return result.changes > 0;
}

/**
 * Search for memories by category or keyword
 * Searches across multiple dimensions: memory name/description, entities, observations, and relations
 * Breaks down query into components for more comprehensive matching
 * @param {string} query - Search query (will be split into components)
 * @param {string} category - Optional category filter
 * @returns {Array} Matching memory names with descriptions, sorted by relevance
 */
function searchKnowledgeMemories(query, category = null) {
    if (!db) {
        throw new Error('Knowledge memory database not initialized');
    }

    // Split query into components (words), filter out empty strings and very short words
    const queryComponents = query
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 1); // Filter out single characters and empty strings

    if (queryComponents.length === 0) {
        // Fallback to original query if no valid components
        queryComponents.push(query.toLowerCase());
    }

    // Build search conditions for each component across multiple dimensions
    // We'll search in: memory name, description, entity names, entity types, observation content, relation types
    
    // Build WHERE clause: match if ANY component matches in ANY dimension
    let whereConditions = [];
    const whereParams = [];
    const relevanceParams = [];
    
    // Build relevance score calculation: count occurrences and number of matching components
    let relevanceScoreParts = [];
    let componentMatchCounts = []; // Track which components match for bonus calculation
    
    for (let i = 0; i < queryComponents.length; i++) {
        const component = queryComponents[i].toLowerCase();
        const componentPattern = `%${component}%`;
        const componentLength = component.length;
        
        // WHERE condition for this component (matches in any dimension)
        whereConditions.push(`(
            LOWER(km.name) LIKE ? OR LOWER(km.description) LIKE ?
            OR EXISTS (
                SELECT 1 FROM knowledge_entities ke 
                WHERE ke.memory_id = km.id 
                AND (LOWER(ke.name) LIKE ? OR LOWER(ke.type) LIKE ? OR LOWER(ke.attributes) LIKE ?)
            )
            OR EXISTS (
                SELECT 1 FROM knowledge_observations ko 
                WHERE ko.memory_id = km.id 
                AND LOWER(ko.content) LIKE ?
            )
            OR EXISTS (
                SELECT 1 FROM knowledge_relations kr 
                WHERE kr.memory_id = km.id 
                AND LOWER(kr.relation_type) LIKE ?
            )
        )`);
        
        // Add parameters for WHERE clause (7 per component)
        whereParams.push(componentPattern); // name
        whereParams.push(componentPattern); // description
        whereParams.push(componentPattern); // entity name
        whereParams.push(componentPattern); // entity type
        whereParams.push(componentPattern); // entity attributes
        whereParams.push(componentPattern); // observation content
        whereParams.push(componentPattern); // relation type
        
        // Helper function to count occurrences: (LENGTH(text) - LENGTH(REPLACE(text, component, ''))) / LENGTH(component)
        // We'll use this to count how many times the component appears
        
        // Memory name matches - count occurrences (weight: 10 per occurrence, max 30)
        relevanceScoreParts.push(`(CASE 
            WHEN LOWER(km.name) LIKE ? THEN 
                (CASE WHEN 10 * ((LENGTH(LOWER(km.name)) - LENGTH(REPLACE(LOWER(km.name), ?, ''))) / ?) > 30 
                    THEN 30 
                    ELSE 10 * ((LENGTH(LOWER(km.name)) - LENGTH(REPLACE(LOWER(km.name), ?, ''))) / ?) 
                END)
            ELSE 0 
        END)`);
        
        // Description matches - count occurrences (weight: 8 per occurrence, max 24)
        relevanceScoreParts.push(`(CASE 
            WHEN LOWER(km.description) LIKE ? THEN 
                (CASE WHEN 8 * ((LENGTH(LOWER(km.description)) - LENGTH(REPLACE(LOWER(km.description), ?, ''))) / ?) > 24 
                    THEN 24 
                    ELSE 8 * ((LENGTH(LOWER(km.description)) - LENGTH(REPLACE(LOWER(km.description), ?, ''))) / ?) 
                END)
            ELSE 0 
        END)`);
        
        // Entity matches - count occurrences across all entities (weight: 6 per occurrence, max 18)
        relevanceScoreParts.push(`(CASE 
            WHEN EXISTS (
                SELECT 1 FROM knowledge_entities ke 
                WHERE ke.memory_id = km.id 
                AND (LOWER(ke.name) LIKE ? OR LOWER(ke.type) LIKE ? OR LOWER(ke.attributes) LIKE ?)
            ) THEN (
                SELECT (CASE WHEN 6 * (
                    COALESCE(SUM((LENGTH(LOWER(ke2.name)) - LENGTH(REPLACE(LOWER(ke2.name), ?, ''))) / ?), 0) +
                    COALESCE(SUM((LENGTH(LOWER(ke2.type)) - LENGTH(REPLACE(LOWER(ke2.type), ?, ''))) / ?), 0) +
                    COALESCE(SUM((LENGTH(LOWER(ke2.attributes)) - LENGTH(REPLACE(LOWER(ke2.attributes), ?, ''))) / ?), 0)
                ) > 18 
                    THEN 18 
                    ELSE 6 * (
                        COALESCE(SUM((LENGTH(LOWER(ke2.name)) - LENGTH(REPLACE(LOWER(ke2.name), ?, ''))) / ?), 0) +
                        COALESCE(SUM((LENGTH(LOWER(ke2.type)) - LENGTH(REPLACE(LOWER(ke2.type), ?, ''))) / ?), 0) +
                        COALESCE(SUM((LENGTH(LOWER(ke2.attributes)) - LENGTH(REPLACE(LOWER(ke2.attributes), ?, ''))) / ?), 0)
                    )
                END)
                FROM knowledge_entities ke2
                WHERE ke2.memory_id = km.id
                AND (LOWER(ke2.name) LIKE ? OR LOWER(ke2.type) LIKE ? OR LOWER(ke2.attributes) LIKE ?)
            )
            ELSE 0 
        END)`);
        
        // Observation matches - count occurrences (weight: 5 per occurrence, max 15)
        relevanceScoreParts.push(`(CASE 
            WHEN EXISTS (
                SELECT 1 FROM knowledge_observations ko 
                WHERE ko.memory_id = km.id 
                AND LOWER(ko.content) LIKE ?
            ) THEN (
                SELECT (CASE WHEN 5 * COALESCE(SUM((LENGTH(LOWER(ko2.content)) - LENGTH(REPLACE(LOWER(ko2.content), ?, ''))) / ?), 0) > 15 
                    THEN 15 
                    ELSE 5 * COALESCE(SUM((LENGTH(LOWER(ko2.content)) - LENGTH(REPLACE(LOWER(ko2.content), ?, ''))) / ?), 0) 
                END)
                FROM knowledge_observations ko2
                WHERE ko2.memory_id = km.id
                AND LOWER(ko2.content) LIKE ?
            )
            ELSE 0 
        END)`);
        
        // Relation type matches - count occurrences (weight: 3 per occurrence, max 9)
        relevanceScoreParts.push(`(CASE 
            WHEN EXISTS (
                SELECT 1 FROM knowledge_relations kr 
                WHERE kr.memory_id = km.id 
                AND LOWER(kr.relation_type) LIKE ?
            ) THEN (
                SELECT (CASE WHEN 3 * COALESCE(SUM((LENGTH(LOWER(kr2.relation_type)) - LENGTH(REPLACE(LOWER(kr2.relation_type), ?, ''))) / ?), 0) > 9 
                    THEN 9 
                    ELSE 3 * COALESCE(SUM((LENGTH(LOWER(kr2.relation_type)) - LENGTH(REPLACE(LOWER(kr2.relation_type), ?, ''))) / ?), 0) 
                END)
                FROM knowledge_relations kr2
                WHERE kr2.memory_id = km.id
                AND LOWER(kr2.relation_type) LIKE ?
            )
            ELSE 0 
        END)`);
        
        // Track if this component matches anywhere (for bonus calculation)
        componentMatchCounts.push(`(CASE 
            WHEN LOWER(km.name) LIKE ? OR LOWER(km.description) LIKE ?
            OR EXISTS (
                SELECT 1 FROM knowledge_entities ke 
                WHERE ke.memory_id = km.id 
                AND (LOWER(ke.name) LIKE ? OR LOWER(ke.type) LIKE ? OR LOWER(ke.attributes) LIKE ?)
            )
            OR EXISTS (
                SELECT 1 FROM knowledge_observations ko 
                WHERE ko.memory_id = km.id 
                AND LOWER(ko.content) LIKE ?
            )
            OR EXISTS (
                SELECT 1 FROM knowledge_relations kr 
                WHERE kr.memory_id = km.id 
                AND LOWER(kr.relation_type) LIKE ?
            )
            THEN 1 ELSE 0 END)`);
        
        // Add parameters for relevance score calculation
        // Name: pattern (LIKE), component (REPLACE), length (division), component (REPLACE in ELSE), length (division in ELSE)
        relevanceParams.push(componentPattern, component, componentLength, component, componentLength);
        // Description: same as name
        relevanceParams.push(componentPattern, component, componentLength, component, componentLength);
        // Entities: pattern, pattern, pattern (EXISTS), component, length, component, length, component, length (calculation),
        //           component, length, component, length, component, length (ELSE), pattern, pattern, pattern (WHERE)
        relevanceParams.push(
            componentPattern, componentPattern, componentPattern, // EXISTS
            component, componentLength, component, componentLength, component, componentLength, // calculation
            component, componentLength, component, componentLength, component, componentLength, // ELSE
            componentPattern, componentPattern, componentPattern // WHERE
        );
        // Observations: pattern (EXISTS), component, length (calculation), component, length (ELSE), pattern (WHERE)
        relevanceParams.push(componentPattern, component, componentLength, component, componentLength, componentPattern);
        // Relations: same as observations
        relevanceParams.push(componentPattern, component, componentLength, component, componentLength, componentPattern);
        // Note: componentMatchCount parameters are added separately for componentMatchBonus
    }
    
    // Calculate bonus for matching multiple components (5 points per matching component, max 25)
    // Note: componentMatchCounts are used twice (in CASE WHEN and ELSE), so we need to duplicate the params
    const componentMatchBonus = `(CASE WHEN 5 * (${componentMatchCounts.join(' + ')}) > 25 THEN 25 ELSE 5 * (${componentMatchCounts.join(' + ')}) END)`;
    
    // Add parameters for componentMatchBonus (used twice in SQL, so we need to add them twice)
    const componentMatchBonusParams = [];
    for (let i = 0; i < queryComponents.length; i++) {
        const componentPattern = `%${queryComponents[i].toLowerCase()}%`;
        // Each componentMatchCount has 7 placeholders, and it's used twice
        componentMatchBonusParams.push(componentPattern, componentPattern, componentPattern, componentPattern, componentPattern, componentPattern, componentPattern); // First use
        componentMatchBonusParams.push(componentPattern, componentPattern, componentPattern, componentPattern, componentPattern, componentPattern, componentPattern); // Second use (in ELSE)
    }
    
    // Combine parameters: relevance score params, component match bonus params (twice), then WHERE params
    const params = [...relevanceParams, ...componentMatchBonusParams, ...whereParams];
    
    let sql = `
        SELECT DISTINCT
            km.name,
            km.description,
            km.category,
            km.usage_count,
            km.confidence,
            -- Calculate relevance score: sum of occurrence counts + bonus for matching multiple components
            (${relevanceScoreParts.join(' + ')} + ${componentMatchBonus}) as relevance_score
        FROM knowledge_memories km
        WHERE (${whereConditions.join(' OR ')})
    `;
    
    if (category) {
        sql += ' AND km.category = ?';
        params.push(category);
    }
    
    // Order by relevance score (descending), then usage count, then updated date
    sql += ' ORDER BY relevance_score DESC, km.usage_count DESC, km.updated_at DESC';

    // Debug: Verify parameter count matches placeholder count
    const placeholderCount = (sql.match(/\?/g) || []).length;
    if (placeholderCount !== params.length) {
        logger.error(`Parameter count mismatch in searchKnowledgeMemories: SQL has ${placeholderCount} placeholders but ${params.length} parameters provided`);
        logger.error(`Query components: ${queryComponents.join(', ')}`);
        throw new Error(`SQL parameter count mismatch: expected ${placeholderCount} parameters, got ${params.length}`);
    }

    const stmt = db.prepare(sql);
    const results = stmt.all(...params);
    
    // Threshold for high relevance - return full memory if score >= this
    // New scoring system:
    //   - Occurrence-based: name=10/occurrence (max 30), description=8/occurrence (max 24),
    //     entity=6/occurrence (max 18), observation=5/occurrence (max 15), relation=3/occurrence (max 9)
    //   - Component match bonus: 5 points per matching query component (max 25)
    // Threshold of 30 means multiple occurrences or strong multi-component matches
    const HIGH_RELEVANCE_THRESHOLD = 30;
    
    // Process results: return full memory for high relevance, matching components for lower relevance
    return results.map(r => {
        const relevanceScore = r.relevance_score || 0;
        
        // Extract matching section from description
        const trimmedDescription = extractMatchingDescriptionSection(r.description, queryComponents);
        
        const result = {
            name: r.name,
            description: trimmedDescription,
            category: r.category,
            usage_count: r.usage_count,
            confidence: r.confidence,
            relevance_score: relevanceScore
        };
        
        if (relevanceScore >= HIGH_RELEVANCE_THRESHOLD) {
            // High relevance: return full memory
            const fullMemory = getKnowledgeMemory(r.name, false); // Don't increment usage on search
            if (fullMemory) {
                result.entities = fullMemory.entities;
                result.relations = fullMemory.relations;
                result.observations = fullMemory.observations;
                result.full_memory = true;
            }
        } else {
            // Lower relevance: return only matching components
            const matchingComponents = getMatchingComponents(r.name, queryComponents);
            result.entities = matchingComponents.entities;
            result.observations = matchingComponents.observations;
            result.relations = matchingComponents.relations;
            result.full_memory = false;
        }
        
        return result;
    });
}

/**
 * Extract the matching section from a description based on query components
 * Returns a snippet around the matches, or the full description if no match found
 * @param {string} description - Full description text
 * @param {Array<string>} queryComponents - Array of query component strings to search for
 * @param {number} contextLength - Number of characters to include before and after match (default: 100)
 * @returns {string} Trimmed description with matching section
 */
function extractMatchingDescriptionSection(description, queryComponents, contextLength = 100) {
    if (!description || !queryComponents || queryComponents.length === 0) {
        return description || '';
    }
    
    const descLower = description.toLowerCase();
    const matches = [];
    
    // Find all matches and their positions
    for (const component of queryComponents) {
        const componentLower = component.toLowerCase();
        let searchIndex = 0;
        while (true) {
            const index = descLower.indexOf(componentLower, searchIndex);
            if (index === -1) break;
            
            // Check if it's a word boundary match (not part of a larger word)
            const beforeChar = index > 0 ? description[index - 1] : ' ';
            const afterChar = index + component.length < description.length ? description[index + component.length] : ' ';
            const isWordBoundary = /[\s\W]/.test(beforeChar) && /[\s\W]/.test(afterChar);
            
            if (isWordBoundary || component.length >= 3) { // Allow short words or word boundary matches
                matches.push({
                    index: index,
                    length: component.length,
                    component: component
                });
            }
            
            searchIndex = index + 1;
        }
    }
    
    // If no match found, return first part of description
    if (matches.length === 0) {
        return description.length > 200 ? description.substring(0, 200) + '...' : description;
    }
    
    // Sort matches by position
    matches.sort((a, b) => a.index - b.index);
    
    // Find the range that covers all matches (or the first cluster if they're far apart)
    let minIndex = matches[0].index;
    let maxIndex = matches[0].index + matches[0].length;
    
    // Group nearby matches (within 2*contextLength of each other)
    for (let i = 1; i < matches.length; i++) {
        const match = matches[i];
        const distance = match.index - maxIndex;
        
        if (distance <= contextLength * 2) {
            // Extend range to include this match
            maxIndex = Math.max(maxIndex, match.index + match.length);
        } else {
            // Too far apart, stop at first cluster
            break;
        }
    }
    
    // Extract context around the matches
    const start = Math.max(0, minIndex - contextLength);
    const end = Math.min(description.length, maxIndex + contextLength);
    
    let snippet = description.substring(start, end);
    
    // Add ellipsis if we truncated from the start
    if (start > 0) {
        snippet = '...' + snippet;
    }
    
    // Add ellipsis if we truncated from the end
    if (end < description.length) {
        snippet = snippet + '...';
    }
    
    return snippet;
}

/**
 * Get matching components (entities, observations, relations) for a memory based on query components
 * @param {string} memoryName - Memory name
 * @param {Array<string>} queryComponents - Array of query component strings
 * @returns {Object} Object with matching entities, observations, and relations
 */
function getMatchingComponents(memoryName, queryComponents) {
    if (!db) {
        throw new Error('Knowledge memory database not initialized');
    }
    
    // Get memory ID
    const memoryStmt = db.prepare('SELECT id FROM knowledge_memories WHERE name = ?');
    const memory = memoryStmt.get(memoryName);
    
    if (!memory) {
        return { entities: [], observations: [], relations: [] };
    }
    
    const memoryId = memory.id;
    const matchingEntities = [];
    const matchingObservations = [];
    const matchingRelations = [];
    
    // Build search patterns for all components
    const searchPatterns = queryComponents.map(comp => `%${comp}%`);
    
    // Find matching entities
    if (searchPatterns.length > 0) {
        let entitySql = `
            SELECT DISTINCT entity_id, type, name, attributes
            FROM knowledge_entities
            WHERE memory_id = ? AND (
        `;
        const entityParams = [memoryId];
        
        for (let i = 0; i < searchPatterns.length; i++) {
            if (i > 0) entitySql += ' OR ';
            entitySql += '(LOWER(name) LIKE ? OR LOWER(type) LIKE ? OR LOWER(attributes) LIKE ?)';
            entityParams.push(searchPatterns[i], searchPatterns[i], searchPatterns[i]);
        }
        entitySql += ')';
        
        const entityStmt = db.prepare(entitySql);
        const entities = entityStmt.all(...entityParams);
        matchingEntities.push(...entities.map(e => ({
            id: e.entity_id,
            type: e.type,
            name: e.name,
            attributes: e.attributes ? JSON.parse(e.attributes) : {}
        })));
    }
    
    // Find matching observations
    if (searchPatterns.length > 0) {
        let obsSql = `
            SELECT DISTINCT entity_id, content, importance
            FROM knowledge_observations
            WHERE memory_id = ? AND (
        `;
        const obsParams = [memoryId];
        
        for (let i = 0; i < searchPatterns.length; i++) {
            if (i > 0) obsSql += ' OR ';
            obsSql += 'LOWER(content) LIKE ?';
            obsParams.push(searchPatterns[i]);
        }
        obsSql += ')';
        
        const obsStmt = db.prepare(obsSql);
        const observations = obsStmt.all(...obsParams);
        matchingObservations.push(...observations.map(o => ({
            entity_id: o.entity_id,
            content: o.content,
            importance: o.importance
        })));
    }
    
    // Find matching relations (by relation type)
    if (searchPatterns.length > 0) {
        let relSql = `
            SELECT DISTINCT from_entity_id, to_entity_id, relation_type, weight
            FROM knowledge_relations
            WHERE memory_id = ? AND (
        `;
        const relParams = [memoryId];
        
        for (let i = 0; i < searchPatterns.length; i++) {
            if (i > 0) relSql += ' OR ';
            relSql += 'LOWER(relation_type) LIKE ?';
            relParams.push(searchPatterns[i]);
        }
        relSql += ')';
        
        const relStmt = db.prepare(relSql);
        const relations = relStmt.all(...relParams);
        matchingRelations.push(...relations.map(r => ({
            from: r.from_entity_id,
            to: r.to_entity_id,
            type: r.relation_type,
            weight: r.weight
        })));
    }
    
    return {
        entities: matchingEntities,
        observations: matchingObservations,
        relations: matchingRelations
    };
}

/**
 * Get database statistics
 * @returns {Object} Stats about the knowledge memory database
 */
function getKnowledgeMemoryStats() {
    if (!db) {
        throw new Error('Knowledge memory database not initialized');
    }

    const memoryCount = db.prepare('SELECT COUNT(*) as count FROM knowledge_memories').get().count;
    const entityCount = db.prepare('SELECT COUNT(*) as count FROM knowledge_entities').get().count;
    const relationCount = db.prepare('SELECT COUNT(*) as count FROM knowledge_relations').get().count;
    const observationCount = db.prepare('SELECT COUNT(*) as count FROM knowledge_observations').get().count;

    const categoriesStmt = db.prepare(`
        SELECT category, COUNT(*) as count 
        FROM knowledge_memories 
        WHERE category IS NOT NULL 
        GROUP BY category
    `);
    const categories = categoriesStmt.all();

    return {
        totalMemories: memoryCount,
        totalEntities: entityCount,
        totalRelations: relationCount,
        totalObservations: observationCount,
        categories
    };
}

module.exports = {
    initializeKnowledgeMemoryDatabase,
    closeKnowledgeMemoryDatabase,
    listKnowledgeMemories,
    getKnowledgeMemory,
    saveKnowledgeMemory,
    deleteKnowledgeMemory,
    searchKnowledgeMemories,
    getKnowledgeMemoryStats
};

