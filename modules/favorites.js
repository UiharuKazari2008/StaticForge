const fs = require('fs');
const path = require('path');
const { loadPromptConfig, savePromptConfig } = require('./textReplacements');

class FavoritesManager {
    constructor() {
        this.favoritesFilePath = path.join(__dirname, '..', '.cache', 'favorites.json');
        this.ensureDataDirectory();
    }

    ensureDataDirectory() {
        const dataDir = path.dirname(this.favoritesFilePath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    loadFavorites() {
        try {
            if (fs.existsSync(this.favoritesFilePath)) {
                const data = fs.readFileSync(this.favoritesFilePath, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading favorites:', error);
        }
        
        // Return default structure if file doesn't exist or can't be read
        return {
            tags: [],
            textReplacements: []
        };
    }

    saveFavorites(favorites) {
        try {
            fs.writeFileSync(this.favoritesFilePath, JSON.stringify(favorites, null, 2), 'utf8');
            return true;
        } catch (error) {
            console.error('Error saving favorites:', error);
            return false;
        }
    }

    addFavorite(type, item) {
        // Handle text replacements specially - save to prompt config
        if (type === 'textReplacements') {
            return this.addTextReplacementToConfig(item);
        }

        const favorites = this.loadFavorites();
        
        if (!favorites[type]) {
            favorites[type] = [];
        }

        // Check if already exists
        const exists = favorites[type].some(fav => 
            fav.name === item.name && fav.type === item.type
        );

        if (!exists) {
            const favoriteItem = {
                ...item,
                dateAdded: new Date().toISOString(),
                id: this.generateId()
            };
            
            favorites[type].push(favoriteItem);
            
            if (this.saveFavorites(favorites)) {
                return { success: true, item: favoriteItem };
            }
        } else {
            return { success: false, error: 'Item already in favorites' };
        }
        
        return { success: false, error: 'Failed to save favorites' };
    }

    addTextReplacementToConfig(item) {
        try {
            const config = loadPromptConfig();
            
            if (!config.text_replacements) {
                config.text_replacements = {};
            }

            const placeholder = item.placeholder || item.name;
            const replacementValue = item.replacementValue || item.description;

            // Add to config
            config.text_replacements[placeholder] = replacementValue;

            // Save config
            if (savePromptConfig(config)) {
                // Also save to favorites for tracking
                const favorites = this.loadFavorites();
                if (!favorites.textReplacements) {
                    favorites.textReplacements = [];
                }

                const favoriteItem = {
                    ...item,
                    placeholder: placeholder,
                    dateAdded: new Date().toISOString(),
                    id: this.generateId()
                };

                favorites.textReplacements.push(favoriteItem);
                this.saveFavorites(favorites);

                return { success: true, item: favoriteItem };
            } else {
                return { success: false, error: 'Failed to save text replacement to config' };
            }
        } catch (error) {
            console.error('Error adding text replacement to config:', error);
            return { success: false, error: 'Failed to add text replacement' };
        }
    }

    removeFavorite(type, itemId) {
        // Handle text replacements specially - remove from prompt config
        if (type === 'textReplacements') {
            return this.removeTextReplacementFromConfig(itemId);
        }

        const favorites = this.loadFavorites();
        
        if (!favorites[type]) {
            return { success: false, error: 'Invalid favorite type' };
        }

        const originalLength = favorites[type].length;
        favorites[type] = favorites[type].filter(fav => fav.id !== itemId);
        
        if (favorites[type].length < originalLength) {
            if (this.saveFavorites(favorites)) {
                return { success: true };
            }
        }
        
        return { success: false, error: 'Item not found or failed to save' };
    }

    removeTextReplacementFromConfig(itemId) {
        try {
            const favorites = this.loadFavorites();
            
            if (!favorites.textReplacements) {
                return { success: false, error: 'No text replacement favorites found' };
            }

            // Find the item to remove
            const itemToRemove = favorites.textReplacements.find(fav => fav.id === itemId);
            if (!itemToRemove) {
                return { success: false, error: 'Text replacement favorite not found' };
            }

            // Remove from prompt config
            const config = loadPromptConfig();
            if (config.text_replacements && config.text_replacements[itemToRemove.placeholder]) {
                delete config.text_replacements[itemToRemove.placeholder];
                
                if (savePromptConfig(config)) {
                    // Also remove from favorites
                    favorites.textReplacements = favorites.textReplacements.filter(fav => fav.id !== itemId);
                    this.saveFavorites(favorites);
                    
                    return { success: true };
                } else {
                    return { success: false, error: 'Failed to save config' };
                }
            } else {
                // Item not in config, just remove from favorites
                favorites.textReplacements = favorites.textReplacements.filter(fav => fav.id !== itemId);
                this.saveFavorites(favorites);
                return { success: true };
            }
        } catch (error) {
            console.error('Error removing text replacement from config:', error);
            return { success: false, error: 'Failed to remove text replacement' };
        }
    }

    getFavorites(type = null) {
        const favorites = this.loadFavorites();
        
        if (type) {
            return favorites[type] || [];
        }
        
        return favorites;
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // Utility method to create a favorite item from autocomplete result
    createFavoriteFromResult(result, customName = null) {
        const favoriteItem = {
            name: customName || result.name || result.placeholder,
            originalName: result.name || result.placeholder,
            type: result.type,
            description: result.description || result.replacementValue || '',
        };

        // Add type-specific data
        if (result.type === 'tag') {
            favoriteItem.count = result.count;
            favoriteItem.model = result.model;
            favoriteItem.confidence = result.confidence;
        } else if (result.type === 'textReplacement') {
            favoriteItem.placeholder = result.placeholder;
            favoriteItem.displayName = result.displayName;
            favoriteItem.replacementValue = result.replacementValue || result.description;
        }

        return favoriteItem;
    }
}

module.exports = FavoritesManager;