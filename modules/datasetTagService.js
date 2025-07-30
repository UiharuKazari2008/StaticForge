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
                results: results.slice(0, 20), 
                mainTags: mainTags.slice(0, 50) // Limit main tags to prevent overwhelming the UI
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
}

module.exports = DatasetTagService; 