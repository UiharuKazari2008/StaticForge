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
        this.isEditMode = false;
        this.originalMemory = null;
        
        // Cache DOM elements
        this.cacheElements();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Setup dropdowns
        this.setupCategoryDropdown();
        this.setupDeleteDropdown();
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
        this.detailsNameDisplay = document.getElementById('memoryDetailsNameDisplay');
        this.detailsNameInput = document.getElementById('memoryDetailsNameInput');
        this.detailsNameEdit = document.getElementById('memoryDetailsNameEdit');
        this.detailsDescription = document.getElementById('memoryDetailsDescription');
        this.detailsDescriptionEdit = document.getElementById('memoryDetailsDescriptionEdit');
        this.detailsCategory = document.getElementById('memoryDetailsCategory');
        this.detailsCategoryEdit = document.getElementById('memoryDetailsCategoryEdit');
        this.detailsConfidence = document.getElementById('memoryDetailsConfidence');
        this.detailsConfidenceEdit = document.getElementById('memoryDetailsConfidenceEdit');
        this.detailsUsageCount = document.getElementById('memoryDetailsUsageCount');
        this.detailsLastUsed = document.getElementById('memoryDetailsLastUsed');
        this.detailsEntities = document.getElementById('memoryDetailsEntities');
        this.detailsRelations = document.getElementById('memoryDetailsRelations');
        this.detailsObservations = document.getElementById('memoryDetailsObservations');
        this.deleteMemoryBtn = document.getElementById('deleteMemoryBtn');
        this.editMemoryBtn = document.getElementById('editMemoryBtn');
        this.saveMemoryBtn = document.getElementById('saveMemoryBtn');
        this.cancelEditMemoryBtn = document.getElementById('cancelEditMemoryBtn');
        this.addEntityBtn = document.getElementById('addEntityBtn');
        this.addRelationBtn = document.getElementById('addRelationBtn');
        this.addObservationBtn = document.getElementById('addObservationBtn');
        
        // Stats display
        this.statsDisplay = document.getElementById('memoryStatsDisplay');
        
        // Delete dropdown
        this.deleteDropdown = document.getElementById('memoryDeleteDropdown');
        this.deleteBtn = document.getElementById('memoryDeleteBtn');
        this.deleteMenu = document.getElementById('memoryDeleteMenu');
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
        
        // Edit mode buttons
        if (this.editMemoryBtn) {
            this.editMemoryBtn.addEventListener('click', () => this.enterEditMode());
        }
        
        if (this.saveMemoryBtn) {
            this.saveMemoryBtn.addEventListener('click', () => this.saveMemory());
        }
        
        if (this.cancelEditMemoryBtn) {
            this.cancelEditMemoryBtn.addEventListener('click', () => this.exitEditMode(true));
        }
        
        // Add buttons
        if (this.addEntityBtn) {
            this.addEntityBtn.addEventListener('click', () => this.addEntity());
        }
        
        if (this.addRelationBtn) {
            this.addRelationBtn.addEventListener('click', () => this.addRelation());
        }
        
        if (this.addObservationBtn) {
            this.addObservationBtn.addEventListener('click', () => this.addObservation());
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
    
    setupDeleteDropdown() {
        if (!this.deleteDropdown || !this.deleteBtn || !this.deleteMenu) {
            return;
        }
        
        setupDropdown(
            this.deleteDropdown,
            this.deleteBtn,
            this.deleteMenu,
            (selectedValue) => this.renderDeleteDropdown(selectedValue),
            () => null,
            { preventFocusTransfer: true }
        );
    }
    
    renderDeleteDropdown(selectedValue) {
        if (!this.deleteMenu) return;
        
        const options = [
            { value: 'low_confidence', name: 'Low Confidence' },
            { value: 'old_usage', name: '>30 Days Usage' },
            { value: 'never_used', name: 'Never Used' },
            { value: 'everything', name: 'Everything' }
        ];
        
        if (typeof renderSimpleDropdown === 'function') {
            renderSimpleDropdown(
                this.deleteMenu,
                options,
                'value',
                'name',
                (value) => this.handleDeleteOption(value),
                () => closeDropdown(this.deleteMenu, this.deleteBtn),
                selectedValue,
                { preventFocusTransfer: true }
            );
        }
    }
    
    async handleDeleteOption(option) {
        try {
            // First, get the count from the server
            const countResponse = await window.wsClient.sendMessage('count_knowledge_memories_by_filter', {
                filterType: option
            });
            
            if (!countResponse || !countResponse.success) {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('error', null, 'Failed to count memories');
                }
                return;
            }
            
            const count = countResponse.count || 0;
            const description = countResponse.description || option;
            
            if (count === 0) {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('info', null, `No memories found matching "${description}"`);
                }
                return;
            }
            
            // Show confirmation dialog
            const confirmed = await showConfirmationDialog(
                `Are you sure you want to delete ${count} memor${count === 1 ? 'y' : 'ies'} matching "${description}"? This action cannot be undone.`,
                [
                    { text: 'Delete', value: true, className: 'btn-danger' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ]
            );
            
            if (!confirmed) return;
            
            // Send delete request with filter type
            const deleteResponse = await window.wsClient.sendMessage('delete_knowledge_memories_by_filter', {
                filterType: option
            });
            
            if (deleteResponse && deleteResponse.success) {
                const deletedCount = deleteResponse.deletedCount || 0;
                
                // Reload memories to update the list and stats
                await this.loadMemories();
                
                // Show toast notification
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', null, `Successfully deleted ${deletedCount} memor${deletedCount === 1 ? 'y' : 'ies'}`);
                }
            } else {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('error', null, 'Failed to delete memories');
                }
            }
        } catch (error) {
            console.error('Error deleting memories:', error);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, 'Error deleting memories');
            }
        }
    }
    
    async openModal() {
        if (!this.modal) return;
        
        // Show modal
        openModal(this.modal);
        
        // Load memories
        await this.loadMemories();
    }
    
    async closeModal() {
        if (!this.modal) return;
        await closeModal(this.modal);
        
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
        
        // Basic info - display mode
        if (this.detailsName) this.detailsName.textContent = memory.name;
        if (this.detailsNameDisplay) this.detailsNameDisplay.textContent = memory.name;
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
        
        // Update edit mode UI
        this.updateEditModeUI();
    }
    
    enterEditMode() {
        if (!this.currentMemory) return;
        
        this.isEditMode = true;
        this.originalMemory = JSON.parse(JSON.stringify(this.currentMemory));
        
        // Populate edit fields
        if (this.detailsNameEdit) {
            this.detailsNameEdit.value = this.currentMemory.name || '';
        }
        if (this.detailsDescriptionEdit) {
            this.detailsDescriptionEdit.value = this.currentMemory.description || '';
        }
        if (this.detailsCategoryEdit) {
            this.detailsCategoryEdit.value = this.currentMemory.category || '';
        }
        if (this.detailsConfidenceEdit) {
            this.detailsConfidenceEdit.value = (this.currentMemory.confidence || 0).toString();
        }
        
        // Re-render in edit mode
        this.renderMemoryDetails();
        
        // Auto-resize all textareas after rendering
        // Use setTimeout to ensure DOM is fully updated
        setTimeout(() => {
            this.autoResizeAllTextareas();
        }, 0);
    }
    
    autoResizeAllTextareas() {
        // Resize description textarea
        if (this.detailsDescriptionEdit && !this.detailsDescriptionEdit.classList.contains('hidden')) {
            this.autoResizeTextarea(this.detailsDescriptionEdit);
        }
        
        // Resize all entity attribute textareas
        if (this.detailsEntities) {
            const entityTextareas = this.detailsEntities.querySelectorAll('.entity-attributes-input');
            entityTextareas.forEach(textarea => {
                this.autoResizeTextarea(textarea);
            });
        }
        
        // Resize all observation content textareas
        if (this.detailsObservations) {
            const observationTextareas = this.detailsObservations.querySelectorAll('.observation-content-input');
            observationTextareas.forEach(textarea => {
                this.autoResizeTextarea(textarea);
            });
        }
    }
    
    exitEditMode(revert = false) {
        this.isEditMode = false;
        
        if (revert && this.originalMemory) {
            this.currentMemory = JSON.parse(JSON.stringify(this.originalMemory));
            this.renderMemoryDetails();
        }
        
        this.originalMemory = null;
        this.updateEditModeUI();
    }
    
    updateEditModeUI() {
        const isEdit = this.isEditMode;
        
        // Toggle visibility of display vs edit elements
        if (this.detailsName) this.detailsName.classList.toggle('hidden', isEdit);
        if (this.detailsNameDisplay) this.detailsNameDisplay.classList.toggle('hidden', isEdit);
        if (this.detailsNameEdit) this.detailsNameEdit.classList.toggle('hidden', !isEdit);
        if (this.detailsDescription) this.detailsDescription.classList.toggle('hidden', isEdit);
        if (this.detailsDescriptionEdit) {
            this.detailsDescriptionEdit.classList.toggle('hidden', !isEdit);
            if (isEdit) {
                // Apply auto-height to description textarea
                this.autoResizeTextarea(this.detailsDescriptionEdit);
            }
        }
        if (this.detailsCategory) this.detailsCategory.classList.toggle('hidden', isEdit);
        if (this.detailsCategoryEdit) this.detailsCategoryEdit.classList.toggle('hidden', !isEdit);
        if (this.detailsConfidence) this.detailsConfidence.classList.toggle('hidden', isEdit);
        if (this.detailsConfidenceEdit) this.detailsConfidenceEdit.classList.toggle('hidden', !isEdit);
        
        // Toggle buttons
        if (this.editMemoryBtn) this.editMemoryBtn.classList.toggle('hidden', isEdit);
        if (this.saveMemoryBtn) this.saveMemoryBtn.classList.toggle('hidden', !isEdit);
        if (this.cancelEditMemoryBtn) this.cancelEditMemoryBtn.classList.toggle('hidden', !isEdit);
        if (this.deleteMemoryBtn) this.deleteMemoryBtn.classList.toggle('hidden', isEdit);
        
        // Toggle add buttons
        if (this.addEntityBtn) this.addEntityBtn.classList.toggle('hidden', !isEdit);
        if (this.addRelationBtn) this.addRelationBtn.classList.toggle('hidden', !isEdit);
        if (this.addObservationBtn) this.addObservationBtn.classList.toggle('hidden', !isEdit);
    }
    
    autoResizeTextarea(textarea) {
        if (!textarea) return;
        
        // Reset height to auto to get the correct scrollHeight
        textarea.style.height = 'auto';
        
        // Set height to scrollHeight
        textarea.style.height = textarea.scrollHeight + 'px';
        
        // Add input event listener if not already added
        if (!textarea.dataset.autoResizeListener) {
            textarea.dataset.autoResizeListener = 'true';
            textarea.addEventListener('input', () => {
                textarea.style.height = 'auto';
                textarea.style.height = textarea.scrollHeight + 'px';
            });
        }
    }
    
    renderEntities(entities) {
        if (!this.detailsEntities) return;
        
        this.detailsEntities.innerHTML = '';
        
        if (entities.length === 0 && !this.isEditMode) {
            this.detailsEntities.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">No entities</div>';
            return;
        }
        
        entities.forEach((entity, index) => {
            const entityEl = this.createEntityElement(entity, index);
            this.detailsEntities.appendChild(entityEl);
        });
    }
    
    createEntityElement(entity, index) {
        const entityEl = document.createElement('div');
        entityEl.className = 'knowledge-memory-entity';
        entityEl.dataset.index = index;
        
        if (this.isEditMode) {
            const attributesJson = entity.attributes && Object.keys(entity.attributes).length > 0
                ? JSON.stringify(entity.attributes, null, 2)
                : '{}';
            
            entityEl.innerHTML = `
                <div class="form-row">
                    <div class="form-group" style="flex: 1;">
                        <label>Name</label>
                        <input type="text" class="form-control entity-name-input" value="${this.escapeHtml(entity.name || '')}" placeholder="Entity name">
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>Type</label>
                        <input type="text" class="form-control entity-type-input" value="${this.escapeHtml(entity.type || '')}" placeholder="Entity type">
                    </div>
                    <div class="form-group" style="flex: 0 0 auto; align-self: flex-end;">
                        <button type="button" class="btn-danger btn-small remove-entity-btn" title="Remove entity">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="form-group">
                    <label>Attributes (JSON)</label>
                    <textarea class="form-control entity-attributes-input" placeholder='{"key": "value"}' style="font-family: var(--font-mono); font-size: 0.9em; resize: none; overflow: hidden;">${this.escapeHtml(attributesJson)}</textarea>
                </div>
            `;
            
            const removeBtn = entityEl.querySelector('.remove-entity-btn');
            if (removeBtn) {
                removeBtn.addEventListener('click', () => this.removeEntity(index));
            }
            
            // Apply auto-height to attributes textarea
            const attributesTextarea = entityEl.querySelector('.entity-attributes-input');
            if (attributesTextarea) {
                this.autoResizeTextarea(attributesTextarea);
            }
        } else {
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
        }
        
        return entityEl;
    }
    
    addEntity() {
        if (!this.currentMemory) return;
        
        if (!this.currentMemory.entities) {
            this.currentMemory.entities = [];
        }
        
        this.currentMemory.entities.push({
            name: '',
            type: '',
            attributes: {}
        });
        
        this.renderEntities(this.currentMemory.entities);
        
        // Auto-resize the newly added entity's textarea
        setTimeout(() => {
            const entityTextareas = this.detailsEntities.querySelectorAll('.entity-attributes-input');
            if (entityTextareas.length > 0) {
                this.autoResizeTextarea(entityTextareas[entityTextareas.length - 1]);
            }
        }, 0);
    }
    
    removeEntity(index) {
        if (!this.currentMemory || !this.currentMemory.entities) return;
        
        this.currentMemory.entities.splice(index, 1);
        this.renderEntities(this.currentMemory.entities);
    }
    
    renderRelations(relations) {
        if (!this.detailsRelations) return;
        
        this.detailsRelations.innerHTML = '';
        
        if (relations.length === 0 && !this.isEditMode) {
            this.detailsRelations.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">No relations</div>';
            return;
        }
        
        relations.forEach((relation, index) => {
            const relationEl = this.createRelationElement(relation, index);
            this.detailsRelations.appendChild(relationEl);
        });
    }
    
    createRelationElement(relation, index) {
        const relationEl = document.createElement('div');
        relationEl.className = 'knowledge-memory-relation';
        relationEl.dataset.index = index;
        
        if (this.isEditMode) {
            relationEl.innerHTML = `
                <div class="form-row">
                    <div class="form-group" style="flex: 1;">
                        <label>From</label>
                        <input type="text" class="form-control relation-from-input" value="${this.escapeHtml(relation.from || '')}" placeholder="From entity">
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>Type</label>
                        <input type="text" class="form-control relation-type-input" value="${this.escapeHtml(relation.type || '')}" placeholder="Relation type">
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>To</label>
                        <input type="text" class="form-control relation-to-input" value="${this.escapeHtml(relation.to || '')}" placeholder="To entity">
                    </div>
                    <div class="form-group" style="flex: 0 0 100px;">
                        <label>Weight</label>
                        <input type="number" class="form-control relation-weight-input" value="${relation.weight !== undefined ? relation.weight : 1.0}" step="0.01" min="0" max="1" placeholder="1.0">
                    </div>
                    <div class="form-group" style="flex: 0 0 auto; align-self: flex-end;">
                        <button type="button" class="btn-danger btn-small remove-relation-btn" title="Remove relation">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
            
            const removeBtn = relationEl.querySelector('.remove-relation-btn');
            if (removeBtn) {
                removeBtn.addEventListener('click', () => this.removeRelation(index));
            }
        } else {
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
        }
        
        return relationEl;
    }
    
    addRelation() {
        if (!this.currentMemory) return;
        
        if (!this.currentMemory.relations) {
            this.currentMemory.relations = [];
        }
        
        this.currentMemory.relations.push({
            from: '',
            type: '',
            to: '',
            weight: 1.0
        });
        
        this.renderRelations(this.currentMemory.relations);
    }
    
    removeRelation(index) {
        if (!this.currentMemory || !this.currentMemory.relations) return;
        
        this.currentMemory.relations.splice(index, 1);
        this.renderRelations(this.currentMemory.relations);
    }
    
    renderObservations(observations) {
        if (!this.detailsObservations) return;
        
        this.detailsObservations.innerHTML = '';
        
        if (observations.length === 0 && !this.isEditMode) {
            this.detailsObservations.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">No observations</div>';
            return;
        }
        
        observations.forEach((observation, index) => {
            const observationEl = this.createObservationElement(observation, index);
            this.detailsObservations.appendChild(observationEl);
        });
    }
    
    createObservationElement(observation, index) {
        const observationEl = document.createElement('div');
        observationEl.className = 'knowledge-memory-observation';
        observationEl.dataset.index = index;
        
        if (this.isEditMode) {
            observationEl.innerHTML = `
                <div class="form-group">
                    <label>Content</label>
                    <textarea class="form-control observation-content-input" placeholder="Observation content" style="resize: none; overflow: hidden;">${this.escapeHtml(observation.content || '')}</textarea>
                </div>
                <div class="form-row">
                    <div class="form-group" style="flex: 1;">
                        <label>Importance (0.0 - 1.0)</label>
                        <input type="number" class="form-control observation-importance-input" value="${observation.importance !== undefined ? observation.importance : 0.5}" step="0.01" min="0" max="1" placeholder="0.5">
                    </div>
                    <div class="form-group" style="flex: 0 0 auto; align-self: flex-end;">
                        <button type="button" class="btn-danger btn-small remove-observation-btn" title="Remove observation">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
            
            const removeBtn = observationEl.querySelector('.remove-observation-btn');
            if (removeBtn) {
                removeBtn.addEventListener('click', () => this.removeObservation(index));
            }
            
            // Apply auto-height to observation content textarea
            const contentTextarea = observationEl.querySelector('.observation-content-input');
            if (contentTextarea) {
                this.autoResizeTextarea(contentTextarea);
            }
        } else {
            observationEl.innerHTML = `
                <div class="knowledge-memory-observation-content">${this.escapeHtml(observation.content)}</div>
                ${observation.importance !== undefined ? `<div class="knowledge-memory-observation-importance">Importance: ${(observation.importance * 100).toFixed(0)}%</div>` : ''}
            `;
        }
        
        return observationEl;
    }
    
    addObservation() {
        if (!this.currentMemory) return;
        
        if (!this.currentMemory.observations) {
            this.currentMemory.observations = [];
        }
        
        this.currentMemory.observations.push({
            content: '',
            importance: 0.5
        });
        
        this.renderObservations(this.currentMemory.observations);
        
        // Auto-resize the newly added observation's textarea
        setTimeout(() => {
            const observationTextareas = this.detailsObservations.querySelectorAll('.observation-content-input');
            if (observationTextareas.length > 0) {
                this.autoResizeTextarea(observationTextareas[observationTextareas.length - 1]);
            }
        }, 0);
    }
    
    removeObservation(index) {
        if (!this.currentMemory || !this.currentMemory.observations) return;
        
        this.currentMemory.observations.splice(index, 1);
        this.renderObservations(this.currentMemory.observations);
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
        if (this.isEditMode) {
            this.exitEditMode(true);
        }
    }
    
    showDetailsView() {
        if (this.listContainer) this.listContainer.classList.add('hidden');
        if (this.detailsContainer) this.detailsContainer.classList.remove('hidden');
    }
    
    collectEditFormData() {
        if (!this.currentMemory) return null;
        
        const data = {
            name: this.currentMemory.name, // Original name for lookup
            updates: {}
        };
        
        // Basic fields
        if (this.detailsNameEdit) {
            const newName = this.detailsNameEdit.value.trim();
            if (newName) {
                data.updates.name = newName;
            }
        }
        
        if (this.detailsDescriptionEdit) {
            data.updates.description = this.detailsDescriptionEdit.value.trim();
        }
        
        if (this.detailsCategoryEdit) {
            data.updates.category = this.detailsCategoryEdit.value.trim() || null;
        }
        
        if (this.detailsConfidenceEdit) {
            const confidence = parseFloat(this.detailsConfidenceEdit.value);
            if (!isNaN(confidence) && confidence >= 0 && confidence <= 1) {
                data.updates.confidence = confidence;
            }
        }
        
        // Collect entities
        const entityElements = this.detailsEntities.querySelectorAll('.knowledge-memory-entity');
        const entities = [];
        entityElements.forEach((el, index) => {
            const nameInput = el.querySelector('.entity-name-input');
            const typeInput = el.querySelector('.entity-type-input');
            const attributesInput = el.querySelector('.entity-attributes-input');
            
            if (nameInput && nameInput.value.trim()) {
                const entity = {
                    name: nameInput.value.trim(),
                    type: typeInput ? typeInput.value.trim() : '',
                    attributes: {}
                };
                
                if (attributesInput && attributesInput.value.trim()) {
                    try {
                        entity.attributes = JSON.parse(attributesInput.value.trim());
                    } catch (e) {
                        console.error('Invalid JSON for entity attributes:', e);
                    }
                }
                
                entities.push(entity);
            }
        });
        data.updates.entities = entities;
        
        // Collect relations
        const relationElements = this.detailsRelations.querySelectorAll('.knowledge-memory-relation');
        const relations = [];
        relationElements.forEach((el) => {
            const fromInput = el.querySelector('.relation-from-input');
            const typeInput = el.querySelector('.relation-type-input');
            const toInput = el.querySelector('.relation-to-input');
            const weightInput = el.querySelector('.relation-weight-input');
            
            if (fromInput && typeInput && toInput && 
                fromInput.value.trim() && typeInput.value.trim() && toInput.value.trim()) {
                const relation = {
                    from: fromInput.value.trim(),
                    type: typeInput.value.trim(),
                    to: toInput.value.trim(),
                    weight: weightInput ? parseFloat(weightInput.value) || 1.0 : 1.0
                };
                relations.push(relation);
            }
        });
        data.updates.relations = relations;
        
        // Collect observations
        const observationElements = this.detailsObservations.querySelectorAll('.knowledge-memory-observation');
        const observations = [];
        observationElements.forEach((el) => {
            const contentInput = el.querySelector('.observation-content-input');
            const importanceInput = el.querySelector('.observation-importance-input');
            
            if (contentInput && contentInput.value.trim()) {
                const observation = {
                    content: contentInput.value.trim(),
                    importance: importanceInput ? parseFloat(importanceInput.value) || 0.5 : 0.5
                };
                observations.push(observation);
            }
        });
        data.updates.observations = observations;
        
        return data;
    }
    
    async saveMemory() {
        if (!this.currentMemory) return;
        
        try {
            const formData = this.collectEditFormData();
            if (!formData) {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('error', null, 'Failed to collect form data');
                }
                return;
            }
            
            // Validate name (required)
            const newName = formData.updates.name || this.currentMemory.name;
            if (!newName || !newName.trim()) {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('error', null, 'Memory name is required');
                }
                return;
            }
            
            // Send update request via WebSocket
            const response = await window.wsClient.sendMessage('update_knowledge_memory', {
                name: this.currentMemory.name, // Original name for lookup
                updates: formData.updates
            });
            
            if (response && response.success) {
                // Store original name for lookup
                const originalName = this.currentMemory.name;
                
                // Update local memory data
                if (formData.updates.name) {
                    this.currentMemory.name = formData.updates.name;
                }
                if (formData.updates.description !== undefined) {
                    this.currentMemory.description = formData.updates.description;
                }
                if (formData.updates.category !== undefined) {
                    this.currentMemory.category = formData.updates.category;
                }
                if (formData.updates.confidence !== undefined) {
                    this.currentMemory.confidence = formData.updates.confidence;
                }
                if (formData.updates.entities !== undefined) {
                    this.currentMemory.entities = formData.updates.entities;
                }
                if (formData.updates.relations !== undefined) {
                    this.currentMemory.relations = formData.updates.relations;
                }
                if (formData.updates.observations !== undefined) {
                    this.currentMemory.observations = formData.updates.observations;
                }
                
                // If name changed, update in memories list
                if (formData.updates.name && formData.updates.name !== originalName) {
                    const memoryIndex = this.memories.findIndex(m => m.name === originalName);
                    if (memoryIndex !== -1) {
                        this.memories[memoryIndex].name = formData.updates.name;
                    }
                }
                
                // Exit edit mode and refresh display
                this.exitEditMode(false);
                this.renderMemoryDetails();
                
                // Show success toast
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', null, 'Memory updated successfully');
                }
            } else {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('error', null, response?.error || 'Failed to update memory');
                }
            }
        } catch (error) {
            console.error('Error saving memory:', error);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, 'Error saving memory: ' + error.message);
            }
        }
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

