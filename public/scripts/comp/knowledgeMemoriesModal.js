// Knowledge Memories Modal Manager
// Handles viewing and managing knowledge memories from the dynamic generation system

class KnowledgeMemoriesModalManager {
    constructor() {
        this.modal = null;
        this.memories = [];
        this.filteredMemories = [];
        this.currentMemory = null;
        this.selectedCategory = null;
        this.searchQuery = '';
        
        // Cache DOM elements
        this.cacheElements();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Setup dropdown
        this.setupCategoryDropdown();
    }
    
    cacheElements() {
        // Modal elements
        this.modal = document.getElementById('knowledgeMemoriesModal');
        this.closeBtn = document.getElementById('closeKnowledgeMemoriesModalBtn');
        this.refreshBtn = document.getElementById('refreshKnowledgeMemoriesBtn');
        this.toggleSearchBtn = document.getElementById('toggleMemorySearchBtn');
        
        // Search and filter
        this.searchSection = document.querySelector('.knowledge-memories-search-section');
        this.searchInput = document.getElementById('memorySearchInput');
        this.categoryFilterDropdown = document.getElementById('memoryCategoryFilterDropdown');
        this.categoryFilterBtn = document.getElementById('memoryCategoryFilterBtn');
        this.categoryFilterMenu = document.getElementById('memoryCategoryFilterMenu');
        
        // List view elements
        this.listContainer = document.getElementById('knowledgeMemoriesListContainer');
        this.loadingElement = document.getElementById('knowledgeMemoriesLoading');
        this.listElement = document.getElementById('knowledgeMemoriesList');
        this.emptyElement = document.getElementById('knowledgeMemoriesEmpty');
        
        // Details view elements
        this.detailsContainer = document.getElementById('knowledgeMemoryDetailsContainer');
        this.backToListBtn = document.getElementById('backToMemoriesListBtn');
        this.detailsName = document.getElementById('memoryDetailsName');
        this.detailsDescription = document.getElementById('memoryDetailsDescription');
        this.detailsCategory = document.getElementById('memoryDetailsCategory');
        this.detailsConfidence = document.getElementById('memoryDetailsConfidence');
        this.detailsUsageCount = document.getElementById('memoryDetailsUsageCount');
        this.detailsLastUsed = document.getElementById('memoryDetailsLastUsed');
        this.detailsEntities = document.getElementById('memoryDetailsEntities');
        this.detailsRelations = document.getElementById('memoryDetailsRelations');
        this.detailsObservations = document.getElementById('memoryDetailsObservations');
        this.deleteMemoryBtn = document.getElementById('deleteMemoryBtn');
        
        // Stats display
        this.statsDisplay = document.getElementById('memoryStatsDisplay');
    }
    
    setupEventListeners() {
        // Modal close handler
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.closeModal());
        }
        
        // Refresh button
        if (this.refreshBtn) {
            this.refreshBtn.addEventListener('click', () => this.refreshMemories());
        }
        
        // Toggle search button
        if (this.toggleSearchBtn) {
            this.toggleSearchBtn.addEventListener('click', () => this.toggleSearch());
        }
        
        // Search input
        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.filterMemories();
            });
        }
        
        // Back to list button
        if (this.backToListBtn) {
            this.backToListBtn.addEventListener('click', () => this.showListView());
        }
        
        // Delete memory button
        if (this.deleteMemoryBtn) {
            this.deleteMemoryBtn.addEventListener('click', () => this.deleteCurrentMemory());
        }
    }
    
    setupCategoryDropdown() {
        if (!this.categoryFilterDropdown || !this.categoryFilterBtn || !this.categoryFilterMenu) {
            return;
        }
        
        setupDropdown(
            this.categoryFilterDropdown,
            this.categoryFilterBtn,
            this.categoryFilterMenu,
            (selectedValue) => this.renderCategoryDropdown(selectedValue),
            () => this.selectedCategory,
            { preventFocusTransfer: true }
        );
    }
    
    renderCategoryDropdown(selectedValue) {
        if (!this.categoryFilterMenu) return;
        
        // Get unique categories from memories
        const categories = ['All Categories', ...new Set(
            this.memories
                .map(m => m.category)
                .filter(c => c)
                .sort()
        )];
        
        const options = categories.map(cat => ({
            value: cat === 'All Categories' ? null : cat,
            name: cat
        }));
        
        renderSimpleDropdown(
            this.categoryFilterMenu,
            options,
            'value',
            'name',
            (value) => this.selectCategory(value),
            () => closeDropdown(this.categoryFilterMenu, this.categoryFilterBtn),
            selectedValue,
            { preventFocusTransfer: true }
        );
    }
    
    selectCategory(category) {
        this.selectedCategory = category;
        this.filterMemories();
    }
    
    async openModal() {
        if (!this.modal) return;
        
        // Show modal
        openModal(this.modal);
        
        // Load memories
        await this.loadMemories();
    }
    
    closeModal() {
        if (!this.modal) return;
        closeModal(this.modal);
        
        // Reset view to list
        this.showListView();
    }
    
    async loadMemories() {
        try {
            this.showLoading();
            
            // Request memories list via WebSocket
            const response = await window.wsClient.sendMessage('list_knowledge_memories', {});
            
            if (response && response.success && response.memories) {
                this.memories = response.memories;
                this.filterMemories();
                this.updateStats(response.stats);
            } else {
                this.showError('Failed to load memories');
            }
        } catch (error) {
            console.error('Error loading memories:', error);
            this.showError('Error loading memories');
        }
    }
    
    async refreshMemories() {
        await this.loadMemories();
    }
    
    filterMemories() {
        this.filteredMemories = this.memories.filter(memory => {
            // Filter by category
            if (this.selectedCategory && memory.category !== this.selectedCategory) {
                return false;
            }
            
            // Filter by search query
            if (this.searchQuery) {
                const nameMatch = memory.name.toLowerCase().includes(this.searchQuery);
                const descMatch = memory.description.toLowerCase().includes(this.searchQuery);
                return nameMatch || descMatch;
            }
            
            return true;
        });
        
        this.renderMemoriesList();
    }
    
    showLoading() {
        if (this.loadingElement) this.loadingElement.classList.remove('hidden');
        if (this.listElement) this.listElement.classList.add('hidden');
        if (this.emptyElement) this.emptyElement.classList.add('hidden');
    }
    
    showError(message) {
        if (this.loadingElement) this.loadingElement.classList.add('hidden');
        if (this.listElement) this.listElement.classList.add('hidden');
        if (this.emptyElement) {
            this.emptyElement.classList.remove('hidden');
            this.emptyElement.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
        }
    }
    
    renderMemoriesList() {
        if (!this.listElement) return;
        
        // Hide loading
        if (this.loadingElement) this.loadingElement.classList.add('hidden');
        
        // Show list or empty state
        if (this.filteredMemories.length === 0) {
            this.listElement.classList.add('hidden');
            if (this.emptyElement) {
                this.emptyElement.classList.remove('hidden');
                this.emptyElement.innerHTML = '<i class="fas fa-info-circle"></i> No memories found';
            }
            return;
        }
        
        this.listElement.classList.remove('hidden');
        if (this.emptyElement) this.emptyElement.classList.add('hidden');
        
        // Render memory items
        this.listElement.innerHTML = '';
        
        this.filteredMemories.forEach(memory => {
            const item = this.createMemoryItem(memory);
            this.listElement.appendChild(item);
        });
    }
    
    createMemoryItem(memory) {
        const item = document.createElement('div');
        item.className = 'knowledge-memory-item';
        
        const lastUsedText = memory.last_used_at 
            ? this.formatDate(memory.last_used_at) 
            : 'Never';
        
        item.innerHTML = `
            <div class="knowledge-memory-item-header">
                <div class="knowledge-memory-item-name">${this.escapeHtml(memory.name)}</div>
                <div class="knowledge-memory-item-badges">
                    ${memory.category ? `<span class="knowledge-memory-badge category-badge">${this.escapeHtml(memory.category)}</span>` : ''}
                    <span class="knowledge-memory-badge">${memory.usage_count || 0} uses</span>
                </div>
            </div>
            <div class="knowledge-memory-item-description">
                ${this.escapeHtml(memory.description)}
            </div>
            <div class="knowledge-memory-item-stats">
                <div class="knowledge-memory-item-stat">
                    <i class="fas fa-star"></i>
                    <span>Confidence: ${(memory.confidence * 100).toFixed(0)}%</span>
                </div>
                <div class="knowledge-memory-item-stat">
                    <i class="fas fa-clock"></i>
                    <span>Last used: ${lastUsedText}</span>
                </div>
            </div>
        `;
        
        item.addEventListener('click', () => this.viewMemoryDetails(memory.name));
        
        return item;
    }
    
    async viewMemoryDetails(memoryName) {
        try {
            // Show loading state
            this.showDetailsLoading();
            
            // Request full memory details via WebSocket
            const response = await window.wsClient.sendMessage('get_knowledge_memory', {
                name: memoryName
            });
            
            if (response && response.success && response.memory) {
                this.currentMemory = response.memory;
                this.renderMemoryDetails();
                this.showDetailsView();
            } else {
                this.showError('Failed to load memory details');
            }
        } catch (error) {
            console.error('Error loading memory details:', error);
            this.showError('Error loading memory details');
        }
    }
    
    showDetailsLoading() {
        if (this.detailsName) this.detailsName.textContent = 'Loading...';
    }
    
    renderMemoryDetails() {
        if (!this.currentMemory) return;
        
        const memory = this.currentMemory;
        
        // Basic info
        if (this.detailsName) this.detailsName.textContent = memory.name;
        if (this.detailsDescription) this.detailsDescription.textContent = memory.description;
        if (this.detailsCategory) this.detailsCategory.textContent = memory.category || 'Uncategorized';
        if (this.detailsConfidence) this.detailsConfidence.textContent = `${((memory.confidence || 0) * 100).toFixed(0)}%`;
        if (this.detailsUsageCount) this.detailsUsageCount.textContent = memory.usage_count || 0;
        if (this.detailsLastUsed) {
            const lastUsedText = memory.last_used_at 
                ? this.formatDate(memory.last_used_at) 
                : 'Never';
            this.detailsLastUsed.textContent = lastUsedText;
        }
        
        // Entities
        this.renderEntities(memory.entities || []);
        
        // Relations
        this.renderRelations(memory.relations || []);
        
        // Observations
        this.renderObservations(memory.observations || []);
    }
    
    renderEntities(entities) {
        if (!this.detailsEntities) return;
        
        if (entities.length === 0) {
            this.detailsEntities.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">No entities</div>';
            return;
        }
        
        this.detailsEntities.innerHTML = '';
        
        entities.forEach(entity => {
            const entityEl = document.createElement('div');
            entityEl.className = 'knowledge-memory-entity';
            
            const attributesHtml = entity.attributes && Object.keys(entity.attributes).length > 0
                ? `<div class="knowledge-memory-entity-attributes">${this.escapeHtml(JSON.stringify(entity.attributes, null, 2))}</div>`
                : '';
            
            entityEl.innerHTML = `
                <div class="knowledge-memory-entity-header">
                    <div class="knowledge-memory-entity-name">${this.escapeHtml(entity.name)}</div>
                    <div class="knowledge-memory-entity-type">${this.escapeHtml(entity.type)}</div>
                </div>
                ${attributesHtml}
            `;
            
            this.detailsEntities.appendChild(entityEl);
        });
    }
    
    renderRelations(relations) {
        if (!this.detailsRelations) return;
        
        if (relations.length === 0) {
            this.detailsRelations.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">No relations</div>';
            return;
        }
        
        this.detailsRelations.innerHTML = '';
        
        relations.forEach(relation => {
            const relationEl = document.createElement('div');
            relationEl.className = 'knowledge-memory-relation';
            
            relationEl.innerHTML = `
                <div class="knowledge-memory-relation-content">
                    <span class="knowledge-memory-relation-from">${this.escapeHtml(relation.from)}</span>
                    <span class="knowledge-memory-relation-arrow">→</span>
                    <span class="knowledge-memory-relation-type">${this.escapeHtml(relation.type)}</span>
                    <span class="knowledge-memory-relation-arrow">→</span>
                    <span class="knowledge-memory-relation-to">${this.escapeHtml(relation.to)}</span>
                    ${relation.weight !== undefined && relation.weight !== 1.0 ? `<span style="color: var(--text-muted);">(${relation.weight.toFixed(2)})</span>` : ''}
                </div>
            `;
            
            this.detailsRelations.appendChild(relationEl);
        });
    }
    
    renderObservations(observations) {
        if (!this.detailsObservations) return;
        
        if (observations.length === 0) {
            this.detailsObservations.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">No observations</div>';
            return;
        }
        
        this.detailsObservations.innerHTML = '';
        
        observations.forEach(observation => {
            const observationEl = document.createElement('div');
            observationEl.className = 'knowledge-memory-observation';
            
            observationEl.innerHTML = `
                <div class="knowledge-memory-observation-content">${this.escapeHtml(observation.content)}</div>
                ${observation.importance !== undefined ? `<div class="knowledge-memory-observation-importance">Importance: ${(observation.importance * 100).toFixed(0)}%</div>` : ''}
            `;
            
            this.detailsObservations.appendChild(observationEl);
        });
    }
    
    toggleSearch() {
        if (!this.searchSection) return;
        
        const isHidden = this.searchSection.classList.contains('hidden');
        
        if (isHidden) {
            this.searchSection.classList.remove('hidden');
            // Focus search input when showing
            if (this.searchInput) {
                setTimeout(() => this.searchInput.focus(), 100);
            }
        } else {
            this.searchSection.classList.add('hidden');
        }
    }
    
    showListView() {
        if (this.listContainer) this.listContainer.classList.remove('hidden');
        if (this.detailsContainer) this.detailsContainer.classList.add('hidden');
        this.currentMemory = null;
    }
    
    showDetailsView() {
        if (this.listContainer) this.listContainer.classList.add('hidden');
        if (this.detailsContainer) this.detailsContainer.classList.remove('hidden');
    }
    
    async deleteCurrentMemory() {
        if (!this.currentMemory) return;
        
        const confirmed = await showConfirmationDialog(
            `Are you sure you want to delete the memory "${this.currentMemory.name}"? This action cannot be undone.`,
            [
                { text: 'Delete', value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );
        
        if (!confirmed) return;
        
        try {
            const response = await window.wsClient.sendMessage('delete_knowledge_memory', {
                name: this.currentMemory.name
            });
            
            if (response && response.success) {
                // Remove from local array
                this.memories = this.memories.filter(m => m.name !== this.currentMemory.name);
                
                // Show toast notification
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', null, 'Memory deleted successfully');
                }
                
                // Go back to list view
                this.showListView();
                this.filterMemories();
            } else {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('error', null, 'Failed to delete memory');
                }
            }
        } catch (error) {
            console.error('Error deleting memory:', error);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, 'Error deleting memory');
            }
        }
    }
    
    updateStats(stats) {
        if (!this.statsDisplay || !stats) return;
        
        this.statsDisplay.innerHTML = `
            <div class="memory-stat-item">
                <i class="fas fa-lightbulb-on"></i>
                <span>${stats.totalMemories || 0} memories</span>
            </div>
            <div class="memory-stat-item">
                <i class="fas fa-cubes"></i>
                <span>${stats.totalEntities || 0} entities</span>
            </div>
            <div class="memory-stat-item">
                <i class="fas fa-project-diagram"></i>
                <span>${stats.totalRelations || 0} relations</span>
            </div>
        `;
    }
    
    formatDate(timestamp) {
        // Handle both Unix timestamp (seconds) and JS timestamp (milliseconds)
        const date = new Date(timestamp < 10000000000 ? timestamp * 1000 : timestamp);
        
        // Check if date is valid
        if (isNaN(date.getTime())) {
            return 'Invalid date';
        }
        
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        
        return date.toLocaleDateString();
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the manager when DOM is ready
let knowledgeMemoriesManager;

// Function to open the knowledge memories modal
function openKnowledgeMemoriesModal() {
    if (!knowledgeMemoriesManager) {
        knowledgeMemoriesManager = new KnowledgeMemoriesModalManager();
    }
    knowledgeMemoriesManager.openModal();
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        knowledgeMemoriesManager = new KnowledgeMemoriesModalManager();
    });
} else {
    knowledgeMemoriesManager = new KnowledgeMemoriesModalManager();
}

