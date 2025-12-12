class FavoritesManager {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('FavoritesManager requires globalResources instance and shoudl only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
    }

    addFavorite(type, item) {
        // Handle text replacements specially - save to prompt config
        if (type === 'textReplacements') {
            return this.addTextReplacementToConfig(item);
        }

        const favoriteArray = this.globalResources.getFavorites({ path: type }) || [];

        // Check if already exists
        const exists = favoriteArray.some(fav => 
            fav.name === item.name && fav.type === item.type
        );

        if (!exists) {
            const favoriteItem = {
                ...item,
                dateAdded: new Date().toISOString(),
                id: this.generateId()
            };
            
            if (this.globalResources.modifyConfig('favorites').append(type, favoriteItem)) {
                return { success: true, item: favoriteItem };
            }
        } else {
            return { success: false, error: 'Item already in favorites' };
        }
        
        return { success: false, error: 'Failed to save favorites' };
    }

    addTextReplacementToConfig(item) {
        try {
            const placeholder = item.placeholder || item.name;
            const replacementValue = item.replacementValue || item.description;

            if (this.globalResources.modifyConfig('promptConfig').assign(['text_replacements', placeholder], replacementValue)) {
                const favoriteItem = {
                    ...item,
                    placeholder: placeholder,
                    dateAdded: new Date().toISOString(),
                    id: this.generateId()
                };

                this.globalResources.modifyConfig('favorites').append('textReplacements', favoriteItem);

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

        const favoriteArray = this.globalResources.getFavorites({ path: type });
        
        if (!favoriteArray || !Array.isArray(favoriteArray)) {
            return { success: false, error: 'Invalid favorite type' };
        }

        if (!favoriteArray.some(fav => fav.id === itemId)) {
            return { success: false, error: 'Item not found' };
        }
        
        if (this.globalResources.modifyConfig('favorites').delete(type, fav => fav.id === itemId)) {
            return { success: true };
        }
        
        return { success: false, error: 'Failed to save' };
    }

    removeTextReplacementFromConfig(itemId) {
        try {
            const textReplacements = this.globalResources.getFavorites({ path: 'textReplacements' });
            const itemToRemove = textReplacements.find(fav => fav.id === itemId);
            
            if (!itemToRemove) {
                return { success: false, error: 'Text replacement favorite not found' };
            }

            const promptTextReplacements = this.globalResources.getPromptConfig({ path: 'text_replacements' });
            
            if (promptTextReplacements && promptTextReplacements[itemToRemove.placeholder]) {
                this.globalResources.modifyConfig('promptConfig').delete(['text_replacements', itemToRemove.placeholder]);
            }
            
            this.globalResources.modifyConfig('favorites').delete('textReplacements', fav => fav.id === itemId);
            
            return { success: true };
        } catch (error) {
            console.error('Error removing text replacement from config:', error);
            return { success: false, error: 'Failed to remove text replacement' };
        }
    }

    getFavorites(type = null) {
        const favorites = this.globalResources.getFavorites();
        
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