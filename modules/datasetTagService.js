const fs = require('fs');
const path = require('path');

/**
 * Dataset Tag Service
 * 
 * Handles dataset tag operations including:
 * - Loading dataset tag groups from JSON file
 * - Searching through hierarchical tag structure
 * - Navigating nested tag categories
 */
class DatasetTagService {
    constructor() {
        this.datasetTagGroups = null;
        this.datasetTagGroupsPath = path.join(__dirname, '../dataset_tag_groups.json');
        this.tagToPathIndex = null;
        this.tagToPathIndexPath = path.join(__dirname, '../.cache/tag_to_path_index.json');
    }

    /**
     * Load dataset tag groups from JSON file
     */
    async loadDatasetTagGroups() {
        try {
            if (!fs.existsSync(this.datasetTagGroupsPath)) {
                console.warn('Dataset tag groups file not found:', this.datasetTagGroupsPath);
                return false;
            }

            const data = fs.readFileSync(this.datasetTagGroupsPath, 'utf8');
            this.datasetTagGroups = JSON.parse(data);
            return true;
        } catch (error) {
            console.error('Error loading dataset tag groups:', error);
            return false;
        }
    }

    /**
     * Search for dataset tags based on query and path
     * @param {string} query - Search query
     * @param {Array} path - Current path in hierarchy
     * @returns {Object} Search results with metadata and main tags
     */
    async searchDatasetTags(query, path = []) {
        try {
            // Load dataset tag groups if not already loaded
            if (!this.datasetTagGroups) {
                const loaded = await this.loadDatasetTagGroups();
                if (!loaded) {
                    return { results: [], mainTags: [] };
                }
            }

            const results = [];
            const mainTags = [];
            const searchQuery = query.toLowerCase();

            // Navigate to the current path in the hierarchy
            let currentLevel = this.datasetTagGroups;
            for (const pathItem of path) {
                if (currentLevel[pathItem] && typeof currentLevel[pathItem] === 'object') {
                    currentLevel = currentLevel[pathItem];
                } else {
                    return { results: [], mainTags: [] };
                }
            }

            // First, check if the current level itself has a "main" key
            if (typeof currentLevel === 'object' && !Array.isArray(currentLevel)) {
                const currentLevelKeys = Object.keys(currentLevel).filter(k => k !== '_metadata');
                if (currentLevelKeys.includes('main') && Array.isArray(currentLevel.main)) {
                    // Extract main tags from the current level
                    currentLevel.main.forEach(tag => {
                        mainTags.push({
                            name: tag,
                            prettyName: tag,
                            description: '',
                            hasChildren: false,
                            path: [...path, 'main'],
                            icon: 'fas fa-tag',
                            isTagArray: false,
                            itemCount: 1,
                            isMainTag: true,
                            originalGroup: path.length > 0 ? path[path.length - 1] : 'root'
                        });
                    });
                }
            }
            
            // Search in current level
            for (const [key, value] of Object.entries(currentLevel)) {
                // Skip _metadata entries
                if (key === '_metadata') continue;
                
                // Skip the "main" key if we've already extracted its tags
                if (key === 'main' && mainTags.length > 0) continue;
                
                // Handle wildcard query or normal search
                if (searchQuery === '*' || key.toLowerCase().includes(searchQuery)) {
                    let hasChildren = false;
                    let description = '';
                    let itemCount = 0;
                    let prettyName = key;

                    if (Array.isArray(value)) {
                        // It's an array of tags
                        hasChildren = false;
                        itemCount = value.length;
                        
                        // Check if parent has metadata for this array key
                        if (currentLevel._metadata && currentLevel._metadata.arrayNames && currentLevel._metadata.arrayNames[key]) {
                            prettyName = currentLevel._metadata.arrayNames[key];
                        }
                    } else if (typeof value === 'object') {
                        // Check if it's a group with metadata
                        if (value._metadata && value._metadata.prettyName) {
                            prettyName = value._metadata.prettyName;
                        }
                        
                        // Get non-metadata keys
                        const nonMetadataKeys = Object.keys(value).filter(k => k !== '_metadata');
                        
                        // Determine if this group has children (excluding the main key)
                        const nonMainKeys = nonMetadataKeys.filter(k => k !== 'main');
                        hasChildren = nonMainKeys.length > 0;
                        itemCount = nonMainKeys.length;
                    }

                    results.push({
                        name: key,
                        prettyName: prettyName,
                        description,
                        hasChildren,
                        path: [...path, key],
                        icon: value._metadata && value._metadata.icon ? value._metadata.icon : null,
                        isTagArray: Array.isArray(value),
                        itemCount: itemCount
                    });
                }
            }

            return { 
                results: results, 
                mainTags: mainTags // Limit main tags to prevent overwhelming the UI
            };
        } catch (error) {
            console.error('Dataset tag search error:', error);
            return { results: [], mainTags: [] };
        }
    }

    /**
     * Get all available top-level categories
     * @returns {Array} Array of top-level category objects with name and prettyName
     */
    async getTopLevelCategories() {
        try {
            if (!this.datasetTagGroups) {
                const loaded = await this.loadDatasetTagGroups();
                if (!loaded) {
                    return [];
                }
            }

            return Object.keys(this.datasetTagGroups).map(key => {
                const value = this.datasetTagGroups[key];
                let prettyName = key;
                
                // Check if it's a group with metadata
                if (typeof value === 'object' && value._metadata && value._metadata.prettyName) {
                    prettyName = value._metadata.prettyName;
                }
                
                return {
                    name: key,
                    prettyName: prettyName,
                    icon: value._metadata && value._metadata.icon ? value._metadata.icon : null
                };
            });
        } catch (error) {
            console.error('Error getting top-level categories:', error);
            return [];
        }
    }

    /**
     * Get tags for a specific path
     * @param {Array} path - Path to the tag array
     * @returns {Array} Array of tags
     */
    async getTagsForPath(path) {
        try {
            if (!this.datasetTagGroups) {
                const loaded = await this.loadDatasetTagGroups();
                if (!loaded) {
                    return [];
                }
            }

            // Navigate to the path
            let currentLevel = this.datasetTagGroups;
            for (const pathItem of path) {
                if (currentLevel[pathItem] && typeof currentLevel[pathItem] === 'object') {
                    currentLevel = currentLevel[pathItem];
                } else {
                    return [];
                }
            }

            // Return tags if it's an array
            if (Array.isArray(currentLevel)) {
                return currentLevel;
            }

            return [];
        } catch (error) {
            console.error('Error getting tags for path:', error);
            return [];
        }
    }

    /**
     * Validate if a path exists in the dataset tag groups
     * @param {Array} path - Path to validate
     * @returns {boolean} True if path exists
     */
    async validatePath(path) {
        try {
            if (!this.datasetTagGroups) {
                const loaded = await this.loadDatasetTagGroups();
                if (!loaded) {
                    return false;
                }
            }

            let currentLevel = this.datasetTagGroups;
            for (const pathItem of path) {
                if (currentLevel[pathItem] && typeof currentLevel[pathItem] === 'object') {
                    currentLevel = currentLevel[pathItem];
                } else {
                    return false;
                }
            }

            return true;
        } catch (error) {
            console.error('Error validating path:', error);
            return false;
        }
    }

    /**
     * Build tag-to-path index for fast lookups
     * @returns {Object} Map of tag names to arrays of paths
     */
    async buildTagToPathIndex() {
        try {
            if (!this.datasetTagGroups) {
                const loaded = await this.loadDatasetTagGroups();
                if (!loaded) {
                    return {};
                }
            }

            const tagToPathIndex = {};
            
            // Recursively build the index
            const buildIndexRecursive = (currentLevel, currentPath) => {
                if (typeof currentLevel === 'object' && !Array.isArray(currentLevel)) {
                    // Check if this level has a "main" key with tags
                    if (currentLevel.main && Array.isArray(currentLevel.main)) {
                        for (const tag of currentLevel.main) {
                            if (!tagToPathIndex[tag]) {
                                tagToPathIndex[tag] = [];
                            }
                            tagToPathIndex[tag].push([...currentPath, 'main']);
                        }
                    }
                    
                    // Recursively process all other keys
                    for (const [key, value] of Object.entries(currentLevel)) {
                        if (key !== '_metadata' && key !== 'main') {
                            if (Array.isArray(value)) {
                                // This is an array of tags
                                for (const tag of value) {
                                    if (!tagToPathIndex[tag]) {
                                        tagToPathIndex[tag] = [];
                                    }
                                    tagToPathIndex[tag].push([...currentPath, key]);
                                }
                            } else {
                                // This is a nested object, recurse into it
                                buildIndexRecursive(value, [...currentPath, key]);
                            }
                        }
                    }
                }
            };

            buildIndexRecursive(this.datasetTagGroups, []);
            return tagToPathIndex;
        } catch (error) {
            console.error('Error building tag-to-path index:', error);
            return {};
        }
    }

    /**
     * Load tag-to-path index from file
     * @returns {Object} Map of tag names to arrays of paths
     */
    async loadTagToPathIndex() {
        try {
            if (!fs.existsSync(this.tagToPathIndexPath)) {
                console.log('Tag-to-path index file not found, building new index...');
                return null;
            }

            const data = fs.readFileSync(this.tagToPathIndexPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error loading tag-to-path index:', error);
            return null;
        }
    }

    /**
     * Save tag-to-path index to file
     * @param {Object} index - The index to save
     */
    async saveTagToPathIndex(index) {
        try {
            const data = JSON.stringify(index, null, 2);
            fs.writeFileSync(this.tagToPathIndexPath, data, 'utf8');
            console.log('Tag-to-path index saved successfully');
        } catch (error) {
            console.error('Error saving tag-to-path index:', error);
        }
    }

    /**
     * Get tag-to-path index (loads from file or builds if missing)
     * @returns {Object} Map of tag names to arrays of paths
     */
    async getTagToPathIndex() {
        if (!this.tagToPathIndex) {
            // Try to load from file first
            this.tagToPathIndex = await this.loadTagToPathIndex();
            
            // If file doesn't exist, build and save it
            if (!this.tagToPathIndex) {
                this.tagToPathIndex = await this.buildTagToPathIndex();
                await this.saveTagToPathIndex(this.tagToPathIndex);
            }
        }
        return this.tagToPathIndex;
    }

    /**
     * Refresh the tag-to-path index (useful after dataset updates)
     */
    async refreshTagToPathIndex() {
        this.tagToPathIndex = null;
        const newIndex = await this.buildTagToPathIndex();
        await this.saveTagToPathIndex(newIndex);
        this.tagToPathIndex = newIndex;
        return this.tagToPathIndex;
    }

    /**
     * Initialize the service (load dataset and build index if needed)
     */
    async initialize() {
        console.log('Initializing DatasetTagService...');
        
        // Load dataset tag groups
        const loaded = await this.loadDatasetTagGroups();
        if (!loaded) {
            console.error('Failed to load dataset tag groups');
            return false;
        }
        
        // Initialize tag-to-path index
        await this.getTagToPathIndex();
        
        console.log('DatasetTagService initialized successfully');
        return true;
    }

    /**
     * Search for tags matching a query and return their paths
     * @param {string} query - Search query
     * @param {boolean} singleMatch - If true, return only exact matches
     * @returns {Array} Array of matching tags with their paths
     */
    async searchTags(query, singleMatch = false) {
        try {
            // Get the tag-to-path index
            const tagToPathIndex = await this.getTagToPathIndex();
            const results = [];
            const searchQuery = query.toLowerCase();
            
            for (const [tag, paths] of Object.entries(tagToPathIndex)) {
                if (singleMatch) {
                    // For single match, only return exact matches
                    if (tag.toLowerCase() === searchQuery) {
                        return [{
                            tag: tag,
                            paths: paths
                        }];
                    }
                } else {
                    // For regular search, include partial matches
                    if (tag.toLowerCase().includes(searchQuery)) {
                        results.push({
                            tag: tag,
                            paths: paths
                        });
                    }
                }
            }
            
            if (singleMatch) {
                return []; // No exact match found
            }
            
            // Sort by relevance (exact match first, then starts with, then contains)
            results.sort((a, b) => {
                const aTag = a.tag.toLowerCase();
                const bTag = b.tag.toLowerCase();
                
                if (aTag === searchQuery) return -1;
                if (bTag === searchQuery) return 1;
                if (aTag.startsWith(searchQuery) && !bTag.startsWith(searchQuery)) return -1;
                if (bTag.startsWith(searchQuery) && !aTag.startsWith(searchQuery)) return 1;
                
                return aTag.localeCompare(bTag);
            });
            
            // Limit results
            return results.slice(0, 50);
        } catch (error) {
            console.error('Error searching tags:', error);
            return [];
        }
    }
}

module.exports = DatasetTagService; 