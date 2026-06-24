// Character Search Modal
// Handles searching and displaying character details and enhancers

class CharacterSearchModal extends WikiDisplayBase {
    constructor() {
        super();
        this.modal = null;
        this.searchInput = null;
        this.resultsList = null;
        this.displayArea = null;
        this.closeBtn = null;

        this.characters = [];
        this.currentSearchResults = [];
        this.isLoaded = false;

        this.init();
    }

    async init() {
        if (this._initWired) {
            return;
        }
        this._initWired = true;

        this.modal = document.getElementById('characterSearchModal');
        if (!this.modal) return;

        this.searchInput = document.getElementById('characterSearchInput');
        this.resultsList = document.getElementById('characterSearchResultsList');
        this.displayArea = document.getElementById('characterSearchDisplay');
        this.closeBtn = document.getElementById('closeCharacterSearchModalBtn');

        this.setupEventListeners();
        this.setupContextMenu();

        // Load data when first opened if not already loaded
        this._openObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'class') {
                    const isVisible = !this.modal.classList.contains('hidden');
                    if (isVisible && !this.isLoaded) {
                        this.loadCharacterData();
                    }
                }
            });
        });
        this._openObserver.observe(this.modal, { attributes: true });
    }

    async loadCharacterData() {
        if (this.isLoaded) return;

        try {
            const response = await fetch('/characters.json');
            const data = await response.json();
            this.characters = data.data || [];
            this.isLoaded = true;

            // Show initial list (maybe some popular ones or just the beginning)
            this.renderResults(this.characters.slice(0, 50));
        } catch (error) {
            console.error('Failed to load character data:', error);
            if (this.resultsList) {
                this.resultsList.innerHTML = '<div class="error-state">Failed to load characters.</div>';
            }
        }
    }

    setupEventListeners() {
        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => {
                this.performSearch();
            });
            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch();
                }
            });
        }

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => {
                if (window.closeModal) {
                    window.closeModal(this.modal);
                } else {
                    this.modal.classList.add('hidden');
                }
            });
        }
    }

    setupContextMenu() {
        if (this.displayArea && contextMenu) {
            const displayMenuConfig = {
                sections: [
                    {
                        type: 'list',
                        items: [
                            {
                                text: 'Add Base Prompt',
                                icon: 'fas fa-plus',
                                action: 'char-add-base-prompt',
                                disabled: () => !document.getElementById('manualModal') || document.getElementById('manualModal').classList.contains('hidden')
                            }
                        ]
                    }
                ],
                onAction: (action) => {
                    if (action === 'char-add-base-prompt') {
                        if (this.currentSelectedCharacter) {
                            this.addToPrompt(this.currentSelectedCharacter.prompt);
                        }
                    }
                }
            };
            contextMenu.attachToElement(this.displayArea, displayMenuConfig);
        }
    }

    performSearch() {
        const query = this.searchInput.value.toLowerCase().trim();
        if (!query) {
            this.renderResults(this.characters.slice(0, 50));
            return;
        }

        const results = this.characters.filter(char => {
            const nameMatch = char.name && char.name.toLowerCase().includes(query);
            const copyrightMatch = char.copyright && char.copyright.toLowerCase().includes(query);
            return nameMatch || copyrightMatch;
        });

        // Sort results: prioritize exact name starts, then inclusion
        results.sort((a, b) => {
            const aName = a.name.toLowerCase();
            const bName = b.name.toLowerCase();
            const aStarts = aName.startsWith(query);
            const bStarts = bName.startsWith(query);

            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return aName.localeCompare(bName);
        });

        this.renderResults(results);
    }

    renderResults(results) {
        if (!this.resultsList) return;
        this.resultsList.innerHTML = '';

        if (results.length === 0) {
            this.resultsList.innerHTML = '<div class="no-results">No characters found.</div>';
            return;
        }

        results.forEach(char => {
            const item = document.createElement('div');
            item.className = 'tag-wiki-result-item';
            item.innerHTML = `
                <div class="result-name">${this.escapeHtml(char.name)}</div>
                <div class="result-type">${this.escapeHtml(char.copyright || 'Original')}</div>
            `;
            item.addEventListener('click', () => {
                // Remove active class from others
                this.resultsList.querySelectorAll('.tag-wiki-result-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                this.renderCharacterDetails(char);
            });
            this.resultsList.appendChild(item);
        });
    }

    renderCharacterDetails(char) {
        if (!this.displayArea) return;
        this.currentSelectedCharacter = char;

        let enhancersHtml = '';
        if (char.enhancers && char.enhancers.length > 0) {
            enhancersHtml = `
                <div class="tag-wiki-section">
                    <div class="tag-wiki-section-title">Enhancers / Outfits</div>
                    <div class="character-enhancers-list">
                        ${char.enhancers.map((enhancerGroup, groupIndex) => `
                            <div class="enhancer-group">
                                ${enhancerGroup.map(enhancer => {
                const cleanEnhancer = enhancer.startsWith('--') ? enhancer.substring(2) : enhancer;
                const isNegated = enhancer.startsWith('--');
                return `
                                        <div class="enhancer-item ${isNegated ? 'negated' : ''}" 
                                             data-text="${this.escapeHtml(enhancer)}"
                                             title="${isNegated ? 'Removes from prompt' : 'Adds to prompt'}">
                                            ${this.escapeHtml(cleanEnhancer)}
                                        </div>
                                    `;
            }).join('')}
                            </div>
                        `).join('<div class="enhancer-group-divider"></div>')}
                    </div>
                </div>
            `;
        }

        const html = `
            <div class="tag-wiki-page">
                <div class="tag-wiki-page-title">${this.escapeHtml(char.name)}</div>
                <div class="tag-wiki-body-source">
                    <div class="tag-wiki-body-source-label">Copyright</div>
                    <div class="tag-wiki-body-content">${this.escapeHtml(char.copyright || 'Original')}</div>
                </div>
                <div class="tag-wiki-section">
                    <div class="tag-wiki-section-title">Base Prompt</div>
                    <div class="tag-wiki-body-content character-base-prompt-click" title="Click to add to prompt">
                        <code>${this.escapeHtml(char.prompt)}</code>
                    </div>
                </div>
                ${enhancersHtml}
            </div>
        `;

        this.displayArea.innerHTML = html;

        // Add click handlers for prompt and enhancers
        const basePromptEl = this.displayArea.querySelector('.character-base-prompt-click');
        if (basePromptEl) {
            basePromptEl.addEventListener('click', () => {
                this.addToPrompt(char.prompt);
            });
        }

        this.displayArea.querySelectorAll('.enhancer-item').forEach(item => {
            item.addEventListener('click', () => {
                const text = item.dataset.text;
                this.addToPrompt(text);

                // Visual feedback
                item.classList.add('clicked');
                setTimeout(() => item.classList.remove('clicked'), 200);
            });
        });

        // Update scrollbar if available
        if (window.customScrollbar && window.customScrollbar.updateScrollbar) {
            const scrollContainer = this.displayArea.closest('.form-section-scroll');
            if (scrollContainer) {
                window.customScrollbar.updateScrollbar(scrollContainer);
            }
        }
    }

    addToPrompt(text) {
        if (!text) return;
        const manualPrompt = document.getElementById('manualPrompt');
        const manualModal = document.getElementById('manualModal');

        if (!manualPrompt) return;

        if (manualModal && manualModal.classList.contains('hidden')) {
            if (window.showGlassToast) {
                window.showGlassToast('info', null, 'Please open the prompt modal first', false, 3000, '<i class="fas fa-info-circle"></i>');
            }
            return;
        }

        const currentValue = manualPrompt.value || '';

        if (text.startsWith('--')) {
            // Handle negation (removal)
            const tagToRemove = text.substring(2).trim();
            if (tagToRemove) {
                // Simple replacement logic for now
                const regex = new RegExp(`,?\\s*${tagToRemove.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,?`, 'gi');
                let updated = currentValue.replace(regex, (match) => {
                    if (match.startsWith(',') && match.endsWith(',')) return ', ';
                    return '';
                }).trim();

                // Clean up leading/trailing commas
                updated = updated.replace(/^,|,$/g, '').replace(/,\s*,/g, ', ').trim();
                // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
                setTextareaValuePreservingUndo(manualPrompt, updated);
            }
        } else {
            // Handle addition
            const separator = currentValue.trim() && !currentValue.trim().endsWith(',') ? ', ' : '';
            // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
            setTextareaValuePreservingUndo(manualPrompt, currentValue + separator + text);
        }

        manualPrompt.dispatchEvent(new Event('input', { bubbles: true }));
        manualPrompt.focus();

        if (window.showGlassToast) {
            window.showGlassToast('success', null, 'Prompt updated', false, 2000, '<i class="fas fa-check"></i>');
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    open() {
        if (this.modal) {
            if (window.openModal) {
                window.openModal(this.modal);
            } else {
                this.modal.classList.remove('hidden');
            }
        }
    }
}

// Global instance
const characterSearchModal = new CharacterSearchModal();

// Export for global access
if (typeof window !== 'undefined') {
    window.characterSearchModal = characterSearchModal;
}
