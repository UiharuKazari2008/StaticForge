// File Search Module
// Handles tag-based file search functionality with autofill suggestions and image previews

class FileSearch {
    constructor() {
        this.searchInput = document.getElementById('fileSearchInput');
        this.clearSearchBtn = document.getElementById('clearSearchBtn');
        
        this.currentQuery = '';
        this.searchResults = [];
        this.tagSuggestions = [];
        this.isSearching = false;
        this.searchTimeout = null;
        this.suggestionsTimeout = null;
        this.debounceDelay = 300; // 300ms debounce for suggestions
        this.searchDebounceDelay = 500; // 500ms debounce for actual search
        this.cacheInitialized = false;
        this.cacheViewType = null;
        this.autofillVisible = false;
        
        // Keyboard navigation state
        this.selectedIndex = -1;
        this.expandedResults = false;
        this.initialDisplayLimit = 5;
        
        // Create autofill overlay
        this.createAutofillOverlay();
        this.init();
    }
    
    init() {
        if (!this.searchInput) {
            console.error('File search input not found');
            return;
        }
        
        this.setupEventListeners();
    }
    
    createAutofillOverlay() {
        // Remove existing overlay if any
        const existingOverlay = document.getElementById('fileSearchAutofill');
        if (existingOverlay) {
            existingOverlay.remove();
        }
        
        // Create new autofill overlay using the same structure as main autocomplete
        this.autofillOverlay = document.createElement('div');
        this.autofillOverlay.id = 'fileSearchAutofill';
        this.autofillOverlay.className = 'character-autocomplete-overlay hidden';
        
        // Create the list container (same as main autocomplete)
        this.autofillList = document.createElement('div');
        this.autofillList.className = 'character-autocomplete-list';
        this.autofillList.id = 'fileSearchAutofillList';
        
        this.autofillOverlay.appendChild(this.autofillList);
        document.body.appendChild(this.autofillOverlay);
    }
    
    setupEventListeners() {
        // Search input events
        this.searchInput.addEventListener('input', (e) => {
            this.handleSearchInput(e.target.value);
        });
        
        // Listen for when search input is manually cleared
        this.searchInput.addEventListener('change', (e) => {
            if (!e.target.value || e.target.value.trim().length === 0) {
                this.clearSearch(true, false);
            }
        });
        
        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (this.selectedIndex >= 0 && this.tagSuggestions[this.selectedIndex]) {
                    // Insert selected suggestion
                    this.insertSuggestion(this.tagSuggestions[this.selectedIndex]);
                } else {
                    // Perform search with current query
                    this.performSearch(e.target.value);
                    this.unfocusInput();
                }
            } else if (e.key === 'Escape') {
                if (this.currentQuery.length === 0) {
                    this.clearSearch(true, true);
                    // Close search container to return to main menu mode
                    window.closeSearchContainer();
                } else {
                    this.hideAutofill();
                    this.unfocusInput();
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                // Always flip for bottom-up layout (overlay appears above search)
                this.navigateSuggestions(-1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                // Always flip for bottom-up layout (overlay appears above search)
                this.navigateSuggestions(1);
            } else if (e.key === 'PageDown') {
                e.preventDefault();
                // Always flip for bottom-up layout
                this.handlePageNavigation(-1);
            } else if (e.key === 'PageUp') {
                e.preventDefault();
                // Always flip for bottom-up layout
                this.handlePageNavigation(1);
            } else if (e.key === 'Home') {
                e.preventDefault();
                // Always flip for bottom-up layout
                this.handleHomeEndNavigation(false);
            } else if (e.key === 'End') {
                e.preventDefault();
                // Always flip for bottom-up layout
                this.handleHomeEndNavigation(true);
            }
            // Don't intercept left/right arrows - allow text navigation
        });
        
        // Focus events
        this.searchInput.addEventListener('focus', () => {
            this.searchInput.parentElement.classList.add('focused');
            clearTimeout(this.clearTimeout);
            this.clearTimeout = null;
            
            this.showAutofill();
            this.initializeSearchIfNeeded();
        });
        
        this.clearTimeout = null;
        this.searchInput.addEventListener('blur', () => {
            this.searchInput.parentElement.classList.remove('focused');
            // Delay hiding to allow clicking on suggestions
            setTimeout(() => this.hideAutofill(), 200);
            this.clearTimeout = setTimeout(() => {
                if (this.currentQuery.length === 0) {
                    this.clearSearch(true, false);
                }
            }, 15000);
        });
        
        // Clear search button
        if (this.clearSearchBtn) {
            this.clearSearchBtn.addEventListener('click', () => {
                this.clearSearch(true, true);
                // Close search container and return to main menu mode
                window.closeSearchContainer();
            });
        }
        
        // Handle view changes to reset cache
        if (window.galleryToggleGroup) {
            window.galleryToggleGroup.addEventListener('click', (e) => {
                if (e.target.classList.contains('gallery-toggle-btn')) {
                    const newView = e.target.getAttribute('data-view');
                    if (newView && newView !== this.cacheViewType) {
                        this.cacheInitialized = false;
                        this.cacheViewType = null;
                    }
                }
            });
        }
        
        // Listen for workspace changes to reset cache
        document.addEventListener('workspaceChanged', () => {
            this.cacheInitialized = false;
            this.cacheViewType = null;
        });
        
        // Listen for gallery data updates to refresh original data
        document.addEventListener('galleryDataUpdated', () => {
            if (this.searchResults && this.searchResults.length > 0) {
                this.ensureOriginalGalleryData();
            }
        });
        
        // Listen for gallery view changes to clear search system
        if (window.galleryToggleGroup) {
            window.galleryToggleGroup.addEventListener('click', (e) => {
                if (e.target.classList.contains('gallery-toggle-btn') && !e.target.classList.contains('active')) {
                    // Gallery view is changing, clear search system
                    this.clearSearch(false, true);
                }
            });
        }
        

    }
    
    async initializeSearchIfNeeded() {
        if (this.cacheInitialized && this.cacheViewType === this.getCurrentViewType()) {
            return;
        }
        
        try {
            // Show initialization banner
            this.showInitializationBanner();
            
            await this.initializeSearchWithGalleryData(this.getCurrentViewType());
            
            // Hide banner and show top results
            this.hideInitializationBanner();
            this.showTopResults();
        } catch (error) {
            console.error('Failed to initialize search:', error);
            this.hideInitializationBanner();
            this.showSearchError('Failed to initialize search system');
        }
    }
    
    showInitializationBanner() {
        const banner = document.createElement('div');
        banner.id = 'fileSearchInitBanner';
        banner.className = 'search-status-display';
        banner.innerHTML = `
            <div class="search-status-header">
                <i class="fas fa-cog fa-spin"></i>
                <span class="search-status-text">Initializing search system...</span>
            </div>
            <div class="search-service-indicators">
                <div class="search-service-icon status-searching">
                    <i class="fas fa-spinner fa-spin"></i>
                </div>
            </div>
        `;
        
        // Insert at the top of the autocomplete list
        if (this.autofillList) {
            this.autofillList.insertBefore(banner, this.autofillList.firstChild);
        }
    }
    
    hideInitializationBanner() {
        const banner = document.getElementById('fileSearchInitBanner');
        if (banner) {
            banner.remove();
        }
    }
    
    // Please wait banner while fetching initial/top results or suggestions
    showPleaseWaitBanner() {
        if (!this.autofillList) return;
        if (document.getElementById('fileSearchWaitBanner')) return;
        const banner = document.createElement('div');
        banner.id = 'fileSearchWaitBanner';
        banner.className = 'search-status-display';
        banner.innerHTML = `
            <div class="search-status-header">
                <i class="fas fa-spinner fa-spin"></i>
                <span class="search-status-text">Please wait...</span>
            </div>
        `;
        this.autofillList.insertBefore(banner, this.autofillList.firstChild);
    }

    hidePleaseWaitBanner() {
        const banner = document.getElementById('fileSearchWaitBanner');
        if (banner) banner.remove();
    }

    // No results banner in overlay when suggestions are empty
    showNoResultsBanner() {
        if (!this.autofillList) return;
        if (document.getElementById('fileSearchNoResults')) return;
        const banner = document.createElement('div');
        banner.id = 'fileSearchNoResults';
        banner.className = 'search-status-display';
        banner.innerHTML = `
            <div class="search-status-header">
                <i class="fas fa-circle-exclamation"></i>
                <span class="search-status-text">No results</span>
            </div>
        `;
        this.autofillList.insertBefore(banner, this.autofillList.firstChild);
    }

    hideNoResultsBanner() {
        const banner = document.getElementById('fileSearchNoResults');
        if (banner) banner.remove();
    }
    
    async showTopResults() {
        if (!this.cacheInitialized) {
            return;
        }
        
        try {
            // Check if we have any tags in the current query
            const enteredTags = this.currentQuery.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
            
            if (enteredTags.length > 0) {
                // Use enhanced search when we have tags, even for blank query
                await this.requestEnhancedSuggestions();
                return;
            }
            
            // Get top results (empty query with no tags returns top suggestions)
            this.showPleaseWaitBanner();
            this.hideNoResultsBanner();
            const result = await window.wsClient.getTagSuggestions('', this.getCurrentViewType());
            this.hidePleaseWaitBanner();
            
            if (result && result.tagSuggestions) {
                this.tagSuggestions = result.tagSuggestions;
                this.displayPreviewImages();
                this.displayTagSuggestions();
                if (this.tagSuggestions.length === 0) {
                    this.showNoResultsBanner();
                }
                this.showAutofill();
            } else {
                this.showNoResultsBanner();
                console.warn('⚠️ No top results:', result);
            }
        } catch (error) {
            this.hidePleaseWaitBanner();
            console.error('Failed to get top results:', error);
            this.showNoResultsBanner();
        }
    }
    
    getCurrentViewType() {
        if (window.galleryToggleGroup) {
            const activeBtn = window.galleryToggleGroup.querySelector('.gallery-toggle-btn.active');
            if (activeBtn) {
                return activeBtn.getAttribute('data-view') || 'images';
            }
        }
        return 'images';
    }
    
    handleSearchInput(query) {
        this.currentQuery = query.trim();
        
        // Clear previous timeouts
        if (this.suggestionsTimeout) {
            clearTimeout(this.suggestionsTimeout);
        }
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }
        
        // Show suggestions for any input (including single letters)
        if (this.currentQuery.length === 0) {
            this.showTopResults();
        } else if (this.currentQuery.length < 3) {
            // Show suggestions immediately for short queries
            this.updateTagSuggestions(this.currentQuery);
        } else {
            // Debounce suggestions for longer queries
            this.suggestionsTimeout = setTimeout(() => {
                this.updateTagSuggestions(this.currentQuery);
            }, this.debounceDelay);
        }
    }
    
    async updateTagSuggestions(query) {
        if (!this.cacheInitialized) {
            return;
        }
        
        try {
            this.showPleaseWaitBanner();
            this.hideNoResultsBanner();
            const result = await window.wsClient.getTagSuggestions(query, this.getCurrentViewType());
            this.hidePleaseWaitBanner();
            
            if (result && result.tagSuggestions) {
                this.tagSuggestions = result.tagSuggestions;
                this.displayPreviewImages();
                this.displayTagSuggestions();
                if (this.tagSuggestions.length === 0) {
                    this.showNoResultsBanner();
                }
                this.showAutofill();
            } else {
                this.showNoResultsBanner();
                console.warn('⚠️ No tag suggestions in result:', result);
            }
        } catch (error) {
            this.hidePleaseWaitBanner();
            console.error('Failed to get tag suggestions:', error);
            this.showNoResultsBanner();
        }
    }
    
    getBaseName(filename) {
        return filename
            .replace(/_upscaled(?=\.)/, '')  // Remove _upscaled suffix
            .replace(/_pipeline(?=\.)/, '')  // Remove _pipeline suffix
            .replace(/_pipeline_upscaled(?=\.)/, '')  // Remove _pipeline_upscaled suffix
            .replace(/_blur(?=\.)/, '')  // Remove _blur suffix
            .replace(/\.(png|jpg|jpeg)$/i, '');  // Remove file extension
    }

    displayTagSuggestions() {
        const suggestionsList = this.autofillList;
        
        if (!suggestionsList) return;
        
        // Remove existing suggestions (but keep preview section)
        const existingSuggestions = suggestionsList.querySelectorAll('.character-autocomplete-item, .more-indicator');
        existingSuggestions.forEach(item => item.remove());
        
        // Determine how many to show based on expansion state
        const allResults = this.tagSuggestions || [];
        const displayCount = this.expandedResults ? allResults.length : Math.min(this.initialDisplayLimit, allResults.length);
        const displayResults = allResults.slice(0, displayCount);
        
        const getCategoryBadgeClass = (type) => {
            switch (type) {
                case 'tag': return 'general-badge';
                case 'full_text': return 'meta-badge';
                case 'preset': return 'meta-badge';
                case 'character': return 'character-badge';
                case 'model': return 'meta-badge';
                default: return 'general-badge';
            }
        };
        
        // Compute max weight once for dot intensity
        const maxWeight = Math.max(0, ...allResults.map(s => Math.abs(s.totalWeight || 0)));
        
        // Add tag suggestions using the same structure as main autocomplete
        displayResults.forEach((suggestion, index) => {
            const suggestionElement = document.createElement('div');
            suggestionElement.className = 'character-autocomplete-item';
            suggestionElement.dataset.index = index;
            suggestionElement.dataset.type = suggestion.type;
            
            // Determine display text based on suggestion type
            let displayText = suggestion.originalTag;
            
            if (suggestion.type === 'full_text' && suggestion.fullText) {
                const words = suggestion.fullText.split(/\s+/);
                const wordIndex = words.findIndex(word => 
                    word.toLowerCase().includes((suggestion.tag || '').toLowerCase())
                );
                if (wordIndex >= 0) {
                    const start = Math.max(0, wordIndex - 2);
                    const end = Math.min(words.length, wordIndex + 3);
                    displayText = words.slice(start, end).join(' ');
                }
            }
            
            // Weight dot
            const weightOpacity = maxWeight > 0 ? Math.min(1, Math.abs(suggestion.totalWeight || 0) / maxWeight) : 0;
            const weightLightness = 15 + (weightOpacity * 75);
            const weightDots = suggestion.totalWeight !== 0 ? `
                <div class="tag-count-dots" title="Weight: ${suggestion.totalWeight > 0 ? '+' : ''}${(suggestion.totalWeight || 0).toFixed(1)}">
                    <div class="count-dot weight-dot" style="background: hsl(120, 100%, ${weightLightness}%, ${weightOpacity});"></div>
                </div>
            ` : '';
            
            // Category badge
            const categoryBadgeClass = getCategoryBadgeClass(suggestion.type);
            const categoryBadge = `<span class="tag-category-badge ${categoryBadgeClass}">${suggestion.type}</span>`;
            
            // Right-side badge
            const badge = `${suggestion.occurrenceCount || 0}`;
            const label = suggestion.type === 'preset' ? 'Preset' : 'Prompt';
            
            suggestionElement.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">${displayText}
                        ${weightDots}
                        ${categoryBadge}
                    </span>
                    <span class="character-copyright">
                        ${badge ? `<span class="badge">${badge}</span>` : ''} ${label}
                    </span>
                </div>
            `;
            
            suggestionElement.addEventListener('click', () => {
                this.insertSuggestion(suggestion);
            });
            
            suggestionsList.appendChild(suggestionElement);
        });
        
        // Add "show more" indicator if there are more results and not expanded
        if (!this.expandedResults && allResults.length > this.initialDisplayLimit) {
            const moreItem = document.createElement('div');
            moreItem.className = 'character-autocomplete-item more-indicator';
            moreItem.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">Press <i class="fas fa-arrow-up" style="margin: 0 4px; font-size: 0.85em;"></i> to show all ${allResults.length} results</span>
                </div>
            `;
            moreItem.addEventListener('click', () => {
                this.expandResults();
            });
            suggestionsList.appendChild(moreItem);
        }
        
        // Update keyboard navigation state
        this.updateKeyboardNavigation();
    }
    
    displayPreviewImages() {
        if (!this.autofillList) return;
        
        // Remove existing preview section if any
        const existingPreviewSection = this.autofillList.querySelector('.preview-images-section');
        if (existingPreviewSection) {
            existingPreviewSection.remove();
        }
        
        let previewImages = [];
        let headerText = '';
        let headerIcon = '';
        
        if (this.currentQuery && this.currentQuery.trim().length > 0) {
            // For specific queries: show top 10 images from search results
            headerText = `Search Results`;
            headerIcon = 'fas fa-images';
            
            for (const suggestion of this.tagSuggestions) {
                if (suggestion.files && Array.isArray(suggestion.files)) {
                    for (const fileInfo of suggestion.files) {
                        if (previewImages.length >= 10) break;
                        
                        const filename = fileInfo.filename || fileInfo.original || fileInfo.upscaled;
                        if (filename && !previewImages.find(img => img.filename === filename)) {
                            previewImages.push({
                                filename: filename,
                                metadata: fileInfo.metadata || fileInfo,
                                sourceTag: suggestion.originalTag,
                                rank: previewImages.length + 1
                            });
                        }
                    }
                }
                if (previewImages.length >= 10) break;
            }
        } else {
            // For blank queries: show top images from highest ranked tags
            headerText = 'Top Images';
            headerIcon = 'fas fa-star';
            
            // Get images from the highest ranked tags (first 5 suggestions)
            const topSuggestions = this.tagSuggestions.slice(0, 5);
            
            for (const suggestion of topSuggestions) {
                if (suggestion.files && Array.isArray(suggestion.files)) {
                    // Get up to 2 images from each top suggestion
                    let imagesFromSuggestion = 0;
                    for (const fileInfo of suggestion.files) {
                        if (previewImages.length >= 10 || imagesFromSuggestion >= 2) break;
                        
                        const filename = fileInfo.filename || fileInfo.original || fileInfo.upscaled;
                        if (filename && !previewImages.find(img => img.filename === filename)) {
                            previewImages.push({
                                filename: filename,
                                metadata: fileInfo.metadata || fileInfo,
                                sourceTag: suggestion.originalTag,
                                rank: previewImages.length + 1
                            });
                            imagesFromSuggestion++;
                        }
                    }
                }
                if (previewImages.length >= 10) break;
            }
        }
        
        // Only show preview section if we have images
        if (previewImages.length > 0) {
            // Create preview section (similar to spell check section)
            const previewSection = document.createElement('div');
            previewSection.className = 'preview-images-section';
            previewSection.innerHTML = `
                <div class="preview-images-header">
                    <i class="${headerIcon}"></i>
                    <span>${headerText}</span>
                </div>
                <div class="preview-images-grid">
                    ${previewImages.map(fileInfo => `
                        <div class="preview-image-item" data-filename="${fileInfo.filename}" title="${fileInfo.sourceTag}">
                            <img src="/previews/${encodeURIComponent(this.getBaseName(fileInfo.filename))}.jpg" 
                                 alt="${fileInfo.filename}" 
                                 loading="lazy"
                                 onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                            <div class="preview-image-fallback" style="display: none;">
                                <i class="fas fa-image"></i>
                            </div>
                            <div class="preview-image-rank hidden">#${fileInfo.rank}</div>
                        </div>
                    `).join('')}
                </div>
            `;
            
            // Insert preview section at the top of the autocomplete list
            this.autofillList.insertBefore(previewSection, this.autofillList.firstChild);
            
            // Add click events to preview images
            previewSection.querySelectorAll('.preview-image-item').forEach(item => {
                item.addEventListener('click', () => {
                    const filename = item.dataset.filename;
                    this.scrollToImageInGallery(filename);
                });
            });
        }
    }
    
    scrollToImageInGallery(filename) {
        // Find the image element in the current gallery
        const galleryItems = document.querySelectorAll('.gallery-item img, .gallery-item .gallery-image');
        
        for (const img of galleryItems) {
            const imgSrc = img.src || img.getAttribute('data-src') || '';
            if (imgSrc.includes(encodeURIComponent(filename)) || imgSrc.includes(filename)) {
                // Scroll to the image
                img.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Add a highlight effect
                const galleryItem = img.closest('.gallery-item');
                if (galleryItem) {
                    galleryItem.classList.add('highlighted');
                    setTimeout(() => {
                        galleryItem.classList.remove('highlighted');
                    }, 2000);
                }
                break;
            }
        }
        
        // Fallback: try to find by filename in data attributes
        if (!document.querySelector('.gallery-item.highlighted')) {
            const galleryItemsByData = document.querySelectorAll('.gallery-item[data-filename]');
            for (const item of galleryItemsByData) {
                const itemFilename = item.getAttribute('data-filename');
                if (itemFilename === filename || itemFilename.includes(filename)) {
                    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    item.classList.add('highlighted');
                    setTimeout(() => {
                        item.classList.remove('highlighted');
                    }, 2000);
                    break;
                }
            }
        }
    }
    
    showAutofill() {
        if (this.autofillVisible) return;
        
        this.autofillOverlay.classList.remove('hidden');
        this.autofillVisible = true;
        
        // Position the overlay directly above the search input
        const rect = this.searchInput.getBoundingClientRect();
        
        this.autofillOverlay.style.left = rect.left + 'px';
        this.autofillOverlay.style.width = Math.max(rect.width, 300) + 'px';
        this.autofillOverlay.style.bottom = (window.innerHeight - rect.top + 5) + 'px';
        this.autofillOverlay.style.top = 'auto';
        this.autofillOverlay.style.maxHeight = '400px';
        
        // Always use bottom-up for floating bar layout
        this.autofillOverlay.classList.add('bottom-up');
        this.autofillOverlay.classList.remove('top-down');
    }
    
    hideAutofill() {
        if (!this.autofillVisible) return;
        
        this.autofillOverlay.classList.add('hidden');
        this.autofillOverlay.classList.remove('bottom-up', 'top-down');
        this.autofillVisible = false;
        
        this.selectedIndex = -1;

        // Clean any banners when hiding
        this.hidePleaseWaitBanner();
        this.hideNoResultsBanner();
    }
    
    async performSearch(query) {
        if (!query || query.trim() === '') {
            this.clearSearch(false, false);
            return;
        }
        
        if (!this.cacheInitialized) {
            try {
                await this.initializeSearchWithGalleryData(this.getCurrentViewType());
            } catch (error) {
                console.error('Failed to initialize search:', error);
                this.showSearchError('Failed to initialize search system');
                return;
            }
        }
        
        this.isSearching = true;
        
        try {
            // Use the full query for gallery search results
            const fullQuery = this.searchInput.value.trim();
            const result = await window.wsClient.searchFiles(fullQuery, this.getCurrentViewType());
            
            if (result && result.status === 'complete') {
                this.searchResults = result.results || [];
                this.tagSuggestions = result.tagSuggestions || [];
                
                // Always filter gallery to handle both results and no-results cases
                this.filterGallery();
                
                if (this.searchResults.length === 0) {
                    // Also show no-results in overlay for consistency
                    this.showNoResultsBanner();
                }
            } else {
                throw new Error('Unexpected response format');
            }
        } catch (error) {
            console.error('Search failed:', error);
            this.showSearchError('Search failed: ' + error.message);
        } finally {
            this.isSearching = false;
        }
    }
    
    showSearchError(message) {
        console.error('Search error:', message);
        // You can implement a more sophisticated error display here
    }
    
    filterGallery() {
        // Create a set of matching filenames for fast lookup
        const matchingFilenames = new Set((this.searchResults || []).map(result => result.filename));
        
        // Get the original gallery data
        const originalImages = window.originalAllImages || allImages || [];
        
        if (this.searchResults && this.searchResults.length > 0) {
            // Filter images based on search results
            const filteredImages = originalImages.filter(img => {
                if (typeof img === 'object' && img !== null) {
                    return (img.original && matchingFilenames.has(img.original)) ||
                           (img.upscaled && matchingFilenames.has(img.upscaled)) ||
                           (img.filename && matchingFilenames.has(img.filename));
                }
                return matchingFilenames.has(img);
            });
            
            // Create mapping of filtered images to their original indices
            const originalIndices = filteredImages.map(img => {
                const originalIndex = originalImages.findIndex(originalImg => 
                    (originalImg.original && originalImg.original === img.original) ||
                    (originalImg.upscaled && originalImg.upscaled === img.upscaled) ||
                    (originalImg.filename && originalImg.filename === img.filename)
                );
                return originalIndex !== -1 ? originalIndex : 0;
            });
            
            // Update the gallery with filtered results and original indices mapping
            if (typeof window.applyFilteredImages === 'function') {
                window.applyFilteredImages(filteredImages, originalIndices);
            } else if (typeof switchGalleryView === 'function') {
                const currentView = window.currentGalleryView || 'images';
                switchGalleryView(currentView, true);
            }
        } else {
            // No results - show empty gallery
            if (typeof window.applyFilteredImages === 'function') {
                window.applyFilteredImages([], []);
            } else if (typeof switchGalleryView === 'function') {
                const currentView = window.currentGalleryView || 'images';
                switchGalleryView(currentView, true);
            }
        }
    }
    
    async initializeSearchWithGalleryData(viewType) {
        // Execute cache initialization and gallery data request in parallel
        const [cacheResult, galleryResp] = await Promise.all([
            window.wsClient.initializeSearchCache(viewType),
            window.wsClient.requestGalleryData(viewType).catch(error => {
                console.warn('⚠️ Could not get fresh gallery data, using current:', error.message);
                return null;
            })
        ]);
        
        // Normalize gallery response shape
        const galleryData = galleryResp && (galleryResp.gallery ? galleryResp : (galleryResp.data || {}));
        const galleryArray = galleryData.gallery || galleryData.images || null;
        
        // Handle cache initialization result
        if (cacheResult && cacheResult.status === 'cache_ready') {
            this.cacheInitialized = true;
            this.cacheViewType = viewType;
            if (Array.isArray(galleryArray)) {
                window.originalAllImages = [...galleryArray];
            } else if (allImages && allImages.length > 0) {
                window.originalAllImages = [...allImages];
            } else {
                window.originalAllImages = [];
            }
        } else {
            throw new Error('Cache initialization failed - unexpected response');
        }
    }
    
    clearSearch(reload = false, closeAutofill = false) {
        // Clear search input
        if (this.searchInput) {
            this.searchInput.value = '';
        }
        this.currentQuery = '';
        this.searchResults = [];
        this.tagSuggestions = [];
        this.isSearching = false;
        
        if (window.originalAllImages) {
            delete window.originalAllImages;
        }
        if (window.filteredImageIndices) {
            delete window.filteredImageIndices;
        }
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }
        if (this.suggestionsTimeout) {
            clearTimeout(this.suggestionsTimeout);
        }

        if (reload) {
            const currentView = window.currentGalleryView || 'images';
            switchGalleryView(currentView, true);
            // Clear filtered indices when reloading
            if (window.filteredImageIndices) {
                delete window.filteredImageIndices;
            }
        }
        
        // Clear search UI
        if (closeAutofill) {
            this.hideAutofill();
            this.unfocusInput();
        }
        
        // Clean up search cache on server
        if (this.cacheInitialized && window.wsClient) {
            window.wsClient.cleanupSearchCache().catch(error => {
                console.warn('Failed to cleanup search cache:', error);
            });
        }
        
        // Clear filtered indices mapping
        if (window.filteredImageIndices) {
            delete window.filteredImageIndices;
        }
        
        this.cacheInitialized = false;
        this.cacheViewType = null;
    }
    
    ensureOriginalGalleryData() {
        if (!window.originalAllImages && allImages && allImages.length > 0) {
            window.originalAllImages = [...allImages];
            // Clear filtered indices when ensuring original data
            if (window.filteredImageIndices) {
                delete window.filteredImageIndices;
            }
        }
    }
    
    expandResults() {
        this.expandedResults = true;
        this.displayTagSuggestions();
        
        // Add expanded CSS class for proper sizing
        if (this.autofillOverlay) {
            this.autofillOverlay.classList.add('expanded');
        }
    }
    
    collapseResults() {
        this.expandedResults = false;
        this.displayTagSuggestions();
        
        // Remove expanded CSS class
        if (this.autofillOverlay) {
            this.autofillOverlay.classList.remove('expanded');
        }
    }
    
    updateKeyboardNavigation() {
        // Reset selection if out of bounds
        if (this.selectedIndex >= this.tagSuggestions.length) {
            this.selectedIndex = this.tagSuggestions.length - 1;
        }
        if (this.selectedIndex < -1) {
            this.selectedIndex = -1;
        }
        
        // Update visual selection
        this.updateSelectionHighlight();
    }
    
    updateSelectionHighlight() {
        // Remove previous selection
        const items = this.autofillList.querySelectorAll('.character-autocomplete-item');
        items.forEach((item, index) => {
            item.classList.remove('selected');
            if (index === this.selectedIndex) {
                item.classList.add('selected');
                this.scrollToSelectedItem(item);
            }
        });
    }
    
    scrollToSelectedItem(selectedItem) {
        if (!selectedItem || !this.autofillList) return;
        
        // Center the selected item in the visible area
        selectedItem.scrollIntoView({ 
            block: 'center', 
            behavior: 'smooth',
            inline: 'nearest'
        });
    }
    
    navigateSuggestions(direction) {
        const maxIndex = this.tagSuggestions.length - 1;
        
        if (direction > 0) {
            // Down arrow
            if (this.selectedIndex === -1) {
                // First movement: select first and expand to show all
                this.expandResults();
                this.selectedIndex = 0;
            } else if (this.selectedIndex < maxIndex) {
                this.selectedIndex++;
            } else if (this.selectedIndex === maxIndex && !this.expandedResults) {
                // If somehow limited, expand and keep selection at end
                this.expandResults();
                this.selectedIndex = Math.min(this.selectedIndex, this.tagSuggestions.length - 1);
            }
        } else {
            // Up arrow
            if (this.selectedIndex === 0 && this.expandedResults) {
                // On first item: collapse and clear selection
                this.collapseResults();
                this.selectedIndex = -1;
            } else if (this.selectedIndex > 0) {
                this.selectedIndex--;
            } else if (this.selectedIndex > -1) {
                this.selectedIndex--;
            }
        }
        
        this.updateKeyboardNavigation();
    }
    
    handlePageNavigation(direction) {
        if (direction > 0) {
            // PageDown
            if (this.selectedIndex === -1) {
                this.expandResults();
                this.selectedIndex = 0;
            } else {
                this.selectedIndex = Math.min(this.selectedIndex + 10, this.tagSuggestions.length - 1);
            }
        } else {
            // PageUp
            if (this.selectedIndex <= 10) {
                this.collapseResults();
                this.selectedIndex = -1;
            } else {
                this.selectedIndex = Math.max(this.selectedIndex - 10, 0);
            }
        }
        
        this.updateKeyboardNavigation();
    }
    
    handleHomeEndNavigation(isHome) {
        if (isHome) {
            // Home key
            if (this.expandedResults) {
                this.collapseResults();
            }
            this.selectedIndex = -1;
        } else {
            // End key
            this.expandResults();
            this.selectedIndex = this.tagSuggestions.length - 1;
        }
        
        this.updateKeyboardNavigation();
    }
    
    async insertSuggestion(suggestion) {
        // Get current cursor position
        const cursorPos = this.searchInput.selectionStart;
        const currentValue = this.searchInput.value;
        
        // Find the current tag being edited (text before cursor, stopping at comma)
        let currentTagStart = cursorPos;
        while (currentTagStart > 0 && currentValue[currentTagStart - 1] !== ',') {
            currentTagStart--;
        }
        
        // Extract the part before the current tag
        const beforeTag = currentValue.substring(0, currentTagStart);
        
        // Extract the part after the cursor
        const afterCursor = currentValue.substring(cursorPos);
        
        // Build new value - always add comma and space after the tag
        let newValue = beforeTag + suggestion.originalTag + ', ';
        
        // Add any content that was after the cursor
        if (afterCursor.trim()) {
            newValue += afterCursor;
        }
        
        // Update input value
        this.searchInput.value = newValue;
        this.currentQuery = newValue;
        
        // Set cursor position at the end of the text entry
        const newCursorPos = newValue.length;
        this.searchInput.setSelectionRange(newCursorPos, newCursorPos);
        
        // Focus the input
        this.searchInput.focus();
        
        // Perform the search for full results
        await this.performSearch(newValue);
        
        // If there are fewer than 15 resulting items, unfocus and close autofill
        if ((this.searchResults || []).length < 15) {
            this.unfocusInput();
            this.hideAutofill();
        } else {
            // Otherwise, request enhanced suggestions based on entered tags
            this.requestEnhancedSuggestions();
        }
        
        this.selectedIndex = -1;
        this.updateSelectionHighlight();
    }
    
    unfocusInput() {
        if (this.searchInput) {
            this.searchInput.blur();
        }
    }
    
    async requestEnhancedSuggestions() {
        if (!this.cacheInitialized) return;
        
        try {
            // Get the current entered tags for context
            const enteredTags = this.currentQuery.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
            
            if (enteredTags.length > 0) {
                // Request suggestions with context from entered tags
                this.showPleaseWaitBanner();
                this.hideNoResultsBanner();
                const result = await window.wsClient.getTagSuggestions('', this.getCurrentViewType(), enteredTags);
                this.hidePleaseWaitBanner();
                
                if (result && result.tagSuggestions) {
                    this.tagSuggestions = result.tagSuggestions;
                    this.displayPreviewImages();
                    this.displayTagSuggestions();
                    if (this.tagSuggestions.length === 0) {
                        this.showNoResultsBanner();
                    }
                    this.showAutofill();
                } else {
                    this.showNoResultsBanner();
                }
            } else {
                // No tags entered, show top results
                this.showTopResults();
            }
        } catch (error) {
            this.hidePleaseWaitBanner();
            console.error('Failed to get enhanced suggestions:', error);
            this.showNoResultsBanner();
        }
    }
    
    getCurrentTagText() {
        const cursorPos = this.searchInput.selectionStart;
        const currentValue = this.searchInput.value;
        
        // If cursor is at the beginning or there's no text, return empty
        if (cursorPos === 0 || !currentValue.trim()) {
            return '';
        }
        
        // Find the current tag being edited (text before cursor, stopping at comma)
        let currentTagStart = cursorPos;
        while (currentTagStart > 0 && currentValue[currentTagStart - 1] !== ',') {
            currentTagStart--;
        }
        
        // Extract the current tag text
        const currentTag = currentValue.substring(currentTagStart, cursorPos).trim();
        
        // If we're at the beginning of a tag (after comma), return empty
        if (currentTag === '' && currentValue[cursorPos - 1] === ',') {
            return '';
        }
        
        return currentTag;
    }
    
    handleSearchInput(query) {
        // Clear existing timeouts
        if (this.suggestionsTimeout) {
            clearTimeout(this.suggestionsTimeout);
        }
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }
        
        this.currentQuery = query;
        
        // For empty queries, show top results (which will use enhanced search if tags exist)
        if (!query || query.trim().length === 0) {
            this.showTopResults();
            return;
        }
        
        // For non-empty queries, get current tag text and search
        const currentTagText = this.getCurrentTagText();
        
        if (currentTagText.length > 0) {
            // Debounced search for current tag
            this.suggestionsTimeout = setTimeout(() => {
                this.updateTagSuggestions(currentTagText);
            }, this.debounceDelay);
        } else {
            // No current tag text, show top results (which will use enhanced search if tags exist)
            this.showTopResults();
        }
    }
}

// Initialize file search when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.fileSearch = new FileSearch();
});
