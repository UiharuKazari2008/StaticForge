/**
 * Character Database Browser — Tools desktop applet.
 * Browse copyrights → characters → base prompt + enhancer overloads.
 * public/scripts/utils/dreamscapeClipboard.js (copyTextToClipboard)
 * public/scripts/comp/confirmationDialog.js (showConfirmationDialog, showInputDialog)
 * public/scripts/comp/contextMenu.js (contextMenu.attachToElement)
 * public/scripts/comp/modalUtils.js (openModal, closeModal)
 * public/scripts/comp/textareaUtils.js (setTextareaValuePreservingUndo)
 * public/scripts/comp/utilities.js (escapeHtml, escapeHtmlAttribute)
 */

class CharacterDbApplet {
    constructor() {
        this.modal = null;
        this.searchInput = null;
        this.searchClearBtn = null;
        this.searchHitsEl = null;
        this.copyrightListEl = null;
        this.characterListEl = null;
        this.tagListEl = null;
        this.statusEl = null;
        this.scrollShells = [];

        this.characters = [];
        this.selectedCopyright = null;
        this.selectedCharacterName = null;
        this.searchMode = false;
        this.searchHits = [];
        this.searchDebounceTimer = null;
        this.searchSessionId = 'char_db_applet';
        this.searchRequestId = null;
        this._boundSearchUpdate = null;
        this._initWired = false;
    }

    init() {
        if (this._initWired) return;
        this.modal = document.getElementById('characterDbModal');
        if (!this.modal) return;
        this._initWired = true;

        this.searchInput = document.getElementById('characterDbSearchInput');
        this.searchClearBtn = document.getElementById('characterDbSearchClearBtn');
        this.searchHitsEl = document.getElementById('characterDbSearchHits');
        this.copyrightListEl = document.getElementById('characterDbCopyrightList');
        this.characterListEl = document.getElementById('characterDbCharacterList');
        this.tagListEl = document.getElementById('characterDbTagList');
        this.statusEl = document.getElementById('characterDbStatus');
        this.scrollShells = Array.from(this.modal.querySelectorAll('.character-db-scroll-shell[data-custom-scrollbar]'));

        const closeBtn = document.getElementById('closeCharacterDbBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => this.onSearchInput());
            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.clearSearch();
                }
            });
        }
        if (this.searchClearBtn) {
            this.searchClearBtn.addEventListener('click', () => this.clearSearch());
        }

        this.wireContextMenus();
        this._boundSearchUpdate = (message) => this.onSearchResultsUpdate(message);
        // wsClient.on: public/scripts/websocket.js
        if (typeof wsClient !== 'undefined' && wsClient.on) {
            wsClient.on('search_results_update', this._boundSearchUpdate);
        }
    }

    open() {
        this.init();
        if (!this.modal) return;
        // openModal: public/scripts/comp/modalUtils.js
        openModal(this.modal);
        this.loadDatabase().then(() => {
            setTimeout(() => this.reinitScrollbars(), 80);
        });
        if (this.searchInput) {
            setTimeout(() => this.searchInput.focus(), 50);
        }
    }

    close() {
        if (!this.modal) return;
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(this.modal);
    }

    reinitScrollbars() {
        if (typeof customScrollbar === 'undefined' || !customScrollbar.forceReinit) return;
        this.scrollShells.forEach((shell) => customScrollbar.forceReinit(shell));
    }

    setStatus(text) {
        if (this.statusEl) this.statusEl.textContent = text || '';
    }

    isManualEditorOpen() {
        const manualModal = document.getElementById('manualModal');
        return !!(manualModal && !manualModal.classList.contains('hidden'));
    }

    copyText(text) {
        if (!text) return;
        // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
        copyTextToClipboard(text).then(() => {
            showGlassToast('success', null, 'Copied to clipboard', false, 2000, '<i class="fas fa-check"></i>');
        }).catch(() => {});
    }

    joinOverloadText(character, enhancerGroup) {
        const prompt = character && character.prompt ? character.prompt : '';
        const enhancerText = Array.isArray(enhancerGroup) ? enhancerGroup.join(', ') : '';
        if (prompt && enhancerText) return `${prompt}, ${enhancerText}`;
        return prompt || enhancerText || '';
    }

    parseTagList(text) {
        if (!text || typeof text !== 'string') return [];
        return text.split(',')
            .map((t) => t.trim())
            .filter(Boolean);
    }

    getCopyrights() {
        const map = new Map();
        for (const ch of this.characters) {
            const cp = ch.copyright || 'Original';
            if (!map.has(cp)) map.set(cp, 0);
            map.set(cp, map.get(cp) + 1);
        }
        return [...map.entries()]
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }

    getCharactersForCopyright(copyright) {
        const cp = copyright || '';
        return this.characters
            .filter((ch) => (ch.copyright || 'Original') === cp)
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }

    getSelectedCharacter() {
        if (!this.selectedCharacterName) return null;
        return this.characters.find((ch) => ch.name === this.selectedCharacterName) || null;
    }

    applyData(data) {
        this.characters = Array.isArray(data) ? data : [];
        if (this.selectedCopyright) {
            const still = this.getCopyrights().some((c) => c.name === this.selectedCopyright);
            if (!still) {
                this.selectedCopyright = null;
                this.selectedCharacterName = null;
            }
        }
        if (this.selectedCharacterName) {
            const ch = this.getSelectedCharacter();
            if (!ch) {
                this.selectedCharacterName = null;
            } else if (this.selectedCopyright && (ch.copyright || 'Original') !== this.selectedCopyright) {
                this.selectedCopyright = ch.copyright || 'Original';
            }
        }
        this.renderAll();
    }

    async loadDatabase() {
        this.setStatus('Loading…');
        try {
            // sendMessage resolves with message.data: { data: character[], copyrights }
            const result = await wsClient.sendMessage('get_character_db', {}, false);
            const data = result && Array.isArray(result.data) ? result.data : [];
            this.applyData(data);
            this.setStatus(`${this.characters.length} characters`);
        } catch (error) {
            console.error('characterDb load:', error);
            this.setStatus('Failed to load');
            showGlassToast('error', null, error.message || 'Failed to load character database', false, 4000, '<i class="fas fa-xmark"></i>');
        }
    }

    async upsertCharacter(character, oldName = null) {
        const body = { character };
        if (oldName) body.oldName = oldName;
        const result = await wsClient.sendMessage('character_db_upsert', body, false);
        if (result && Array.isArray(result.data)) {
            this.applyData(result.data);
        } else {
            await this.loadDatabase();
        }
        return result && result.character ? result.character : null;
    }

    async deleteCharacterByName(name) {
        const result = await wsClient.sendMessage('character_db_delete', { name }, false);
        if (result && Array.isArray(result.data)) {
            this.applyData(result.data);
        } else {
            await this.loadDatabase();
        }
    }

    async renameCopyright(oldCopyright, newCopyright) {
        const result = await wsClient.sendMessage('character_db_rename_copyright', {
            oldCopyright,
            newCopyright
        }, false);
        if (result && Array.isArray(result.data)) {
            this.applyData(result.data);
        } else {
            await this.loadDatabase();
        }
        this.selectedCopyright = newCopyright;
    }

    async deleteCopyrightByName(copyright) {
        const result = await wsClient.sendMessage('character_db_delete_copyright', { copyright }, false);
        if (result && Array.isArray(result.data)) {
            this.applyData(result.data);
        } else {
            await this.loadDatabase();
        }
        if (this.selectedCopyright === copyright) {
            this.selectedCopyright = null;
            this.selectedCharacterName = null;
            this.renderAll();
        }
    }

    selectCopyright(name) {
        if (this.selectedCopyright === name) return;
        this.selectedCopyright = name;
        this.selectedCharacterName = null;
        this.updateActiveCopyrightRows();
        this.renderCharacterList();
        this.renderTagList();
        this.updatePanelScrollbar('character');
        this.updatePanelScrollbar('tagtext');
    }

    selectCharacter(name) {
        const ch = this.characters.find((c) => c.name === name);
        if (!ch) return;
        const nextCopyright = ch.copyright || 'Original';
        const copyrightChanged = this.selectedCopyright !== nextCopyright;
        this.selectedCopyright = nextCopyright;
        this.selectedCharacterName = ch.name;
        if (copyrightChanged) {
            this.updateActiveCopyrightRows();
            this.renderCharacterList();
            this.updatePanelScrollbar('character');
        } else {
            this.updateActiveCharacterRows();
        }
        this.renderTagList();
        this.updatePanelScrollbar('tagtext');
    }

    getPanelScrollable(panelName) {
        const panel = this.modal && this.modal.querySelector(`.character-db-panel[data-panel="${panelName}"]`);
        if (!panel) return null;
        return panel.querySelector('.character-db-scrollable') || panel.querySelector('.scrollable-content');
    }

    updatePanelScrollbar(panelName) {
        const shell = this.modal && this.modal.querySelector(`.character-db-panel[data-panel="${panelName}"] .character-db-scroll-shell`);
        if (!shell || typeof customScrollbar === 'undefined') return;
        if (customScrollbar._scheduleUpdateScrollbar) {
            customScrollbar._scheduleUpdateScrollbar(shell);
        } else if (customScrollbar.updateScrollbar) {
            customScrollbar.updateScrollbar(shell);
        }
    }

    updateActiveCopyrightRows() {
        if (!this.copyrightListEl) return;
        this.copyrightListEl.querySelectorAll('.character-db-row').forEach((row) => {
            row.classList.toggle('active', row.dataset.copyright === this.selectedCopyright);
        });
    }

    updateActiveCharacterRows() {
        if (!this.characterListEl) return;
        this.characterListEl.querySelectorAll('.character-db-row').forEach((row) => {
            row.classList.toggle('active', row.dataset.name === this.selectedCharacterName);
        });
    }

    renderAll() {
        this.renderCopyrightList();
        this.renderCharacterList();
        this.renderTagList();
        setTimeout(() => this.reinitScrollbars(), 0);
    }

    renderCopyrightList() {
        if (!this.copyrightListEl) return;
        const scrollable = this.getPanelScrollable('copyright');
        const savedScroll = scrollable ? scrollable.scrollTop : 0;
        const list = this.getCopyrights();
        if (!list.length) {
            this.copyrightListEl.innerHTML = '<div class="character-db-empty">No copyrights</div>';
            return;
        }
        this.copyrightListEl.innerHTML = list.map((item) => `
            <div class="character-db-row${item.name === this.selectedCopyright ? ' active' : ''}"
                data-kind="copyright" data-copyright="${escapeHtmlAttribute(item.name)}">
                <div class="character-db-row-label">${escapeHtml(item.name)}</div>
                <span class="character-db-row-count">${item.count}</span>
            </div>
        `).join('');
        this.copyrightListEl.querySelectorAll('.character-db-row').forEach((row) => {
            row.addEventListener('click', () => this.selectCopyright(row.dataset.copyright));
        });
        if (scrollable) scrollable.scrollTop = savedScroll;
    }

    renderCharacterList() {
        if (!this.characterListEl) return;
        const scrollable = this.getPanelScrollable('character');
        const savedScroll = scrollable ? scrollable.scrollTop : 0;
        if (!this.selectedCopyright) {
            this.characterListEl.innerHTML = '<div class="character-db-empty">Select a copyright</div>';
            return;
        }
        const list = this.getCharactersForCopyright(this.selectedCopyright);
        if (!list.length) {
            this.characterListEl.innerHTML = '<div class="character-db-empty">No characters</div>';
            return;
        }
        this.characterListEl.innerHTML = list.map((ch) => `
            <div class="character-db-row${ch.name === this.selectedCharacterName ? ' active' : ''}"
                data-kind="character" data-name="${escapeHtmlAttribute(ch.name)}">
                <div class="character-db-row-label">${escapeHtml(ch.name)}</div>
            </div>
        `).join('');
        this.characterListEl.querySelectorAll('.character-db-row').forEach((row) => {
            row.addEventListener('click', () => this.selectCharacter(row.dataset.name));
        });
        if (scrollable) scrollable.scrollTop = savedScroll;
    }

    renderTagList() {
        if (!this.tagListEl) return;
        const ch = this.getSelectedCharacter();
        if (!ch) {
            this.tagListEl.innerHTML = '<div class="character-db-empty">Select a character</div>';
            return;
        }

        const rows = [];
        rows.push(`
            <div class="character-db-row" data-kind="base-prompt" data-name="${escapeHtmlAttribute(ch.name)}">
                <div class="character-db-row-label">
                    <span class="character-db-row-meta">Base prompt</span>
                    ${escapeHtml(ch.prompt || '') || '<span class="muted">(empty)</span>'}
                </div>
                <button type="button" class="btn-secondary btn-small character-db-copy-btn" title="Copy base prompt" data-copy="base">
                    <i class="fas fa-copy"></i>
                </button>
            </div>
        `);

        const enhancers = Array.isArray(ch.enhancers) ? ch.enhancers : [];
        enhancers.forEach((group, index) => {
            const label = Array.isArray(group) ? group.join(', ') : '';
            rows.push(`
                <div class="character-db-row" data-kind="overload" data-name="${escapeHtmlAttribute(ch.name)}" data-index="${index}">
                    <div class="character-db-row-label">
                        <span class="character-db-row-meta">Overload ${index + 1}</span>
                        ${escapeHtml(label)}
                    </div>
                    <button type="button" class="btn-secondary btn-small character-db-copy-btn" title="Copy joined prompt" data-copy="overload" data-index="${index}">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
            `);
        });

        this.tagListEl.innerHTML = rows.join('');
        this.tagListEl.querySelectorAll('.character-db-copy-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const current = this.getSelectedCharacter();
                if (!current) return;
                if (btn.dataset.copy === 'base') {
                    this.copyText(current.prompt || '');
                    return;
                }
                const idx = Number(btn.dataset.index);
                const group = current.enhancers && current.enhancers[idx];
                this.copyText(this.joinOverloadText(current, group));
            });
        });
        this.bindTagRowContextTracking();
    }

    /* ——— Search (autofill backend, characters only) ——— */

    onSearchInput() {
        const q = this.searchInput ? this.searchInput.value.trim() : '';
        if (this.searchClearBtn) {
            this.searchClearBtn.classList.toggle('hidden', !q);
        }
        clearTimeout(this.searchDebounceTimer);
        if (!q) {
            this.exitSearchMode();
            return;
        }
        this.searchDebounceTimer = setTimeout(() => this.runSearch(q), 120);
    }

    clearSearch() {
        if (this.searchInput) this.searchInput.value = '';
        if (this.searchClearBtn) this.searchClearBtn.classList.add('hidden');
        this.exitSearchMode();
    }

    exitSearchMode() {
        this.searchMode = false;
        this.searchHits = [];
        this.searchRequestId = null;
        if (this.searchHitsEl) {
            this.searchHitsEl.classList.add('hidden');
            this.searchHitsEl.innerHTML = '';
        }
    }

    getSearchModel() {
        const el = document.getElementById('manualModel');
        return (el && el.value) ? el.value : 'v4_5';
    }

    runSearch(query) {
        if (!query || query.length < 2) {
            this.setStatus('Type at least 2 characters');
            return;
        }
        this.searchMode = true;
        this.searchRequestId = `char_db_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.setStatus('Searching…');
        // wsClient.searchCharacters: public/scripts/websocket.js
        wsClient.searchCharacters(query, this.getSearchModel(), {
            requestId: this.searchRequestId,
            autofillSessionId: this.searchSessionId,
            autofillSettings: {
                spellcheck: false,
                thesaurus: false,
                naiAnimeTags: false,
                naiFurryTags: false,
                dbAnimeTags: false,
                dbFurryTags: false,
                wikiPreviews: false,
                resultTypeFilter: 'characters',
                maxResults: 50
            }
        });
    }

    onSearchResultsUpdate(message) {
        if (!message || message.service !== 'characters') return;
        if (message.autofillSessionId && message.autofillSessionId !== this.searchSessionId) return;
        if (this.searchRequestId && message.requestId && message.requestId !== this.searchRequestId) return;
        if (!this.searchMode) return;

        const results = Array.isArray(message.results) ? message.results : [];
        this.searchHits = results
            .slice()
            .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
            .map((r) => r.character || (r.name ? this.characters.find((c) => c.name === r.name) : null))
            .filter(Boolean);
        this.renderSearchHits();
        this.setStatus(`${this.searchHits.length} search hits`);
    }

    renderSearchHits() {
        if (!this.searchHitsEl) return;
        if (!this.searchHits.length) {
            this.searchHitsEl.classList.remove('hidden');
            this.searchHitsEl.innerHTML = '<div class="character-db-empty">No characters found</div>';
            return;
        }
        this.searchHitsEl.classList.remove('hidden');
        this.searchHitsEl.innerHTML = this.searchHits.map((ch) => `
            <div class="character-db-search-hit" data-name="${escapeHtmlAttribute(ch.name)}">
                <div class="character-db-search-hit-name">${escapeHtml(ch.name)}</div>
                <div class="character-db-search-hit-meta">${escapeHtml(ch.copyright || 'Original')}</div>
            </div>
        `).join('');
        this.searchHitsEl.querySelectorAll('.character-db-search-hit').forEach((el) => {
            el.addEventListener('click', () => {
                this.selectCharacter(el.dataset.name);
                this.exitSearchMode();
                if (this.searchInput) this.searchInput.value = '';
                if (this.searchClearBtn) this.searchClearBtn.classList.add('hidden');
                this.setStatus(`${this.characters.length} characters`);
            });
        });
    }

    /* ——— Add to prompt ——— */

    addToPrompt(text) {
        if (!text) return;
        const manualPrompt = document.getElementById('manualPrompt');
        const manualModal = document.getElementById('manualModal');
        if (!manualPrompt) return;
        if (manualModal && manualModal.classList.contains('hidden')) {
            showGlassToast('info', null, 'Please open the prompt editor first', false, 3000, '<i class="fas fa-info-circle"></i>');
            return;
        }

        const currentValue = manualPrompt.value || '';
        if (text.startsWith('--')) {
            const tagToRemove = text.substring(2).trim();
            if (tagToRemove) {
                const regex = new RegExp(`,?\\s*${tagToRemove.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,?`, 'gi');
                let updated = currentValue.replace(regex, (match) => {
                    if (match.startsWith(',') && match.endsWith(',')) return ', ';
                    return '';
                }).trim();
                updated = updated.replace(/^,|,$/g, '').replace(/,\s*,/g, ', ').trim();
                // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
                setTextareaValuePreservingUndo(manualPrompt, updated);
            }
        } else {
            const separator = currentValue.trim() && !currentValue.trim().endsWith(',') ? ', ' : '';
            // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
            setTextareaValuePreservingUndo(manualPrompt, currentValue + separator + text);
        }
        manualPrompt.dispatchEvent(new Event('input', { bubbles: true }));
        manualPrompt.focus();
        showGlassToast('success', null, 'Prompt updated', false, 2000, '<i class="fas fa-check"></i>');
    }

    /* ——— Context menus ——— */

    wireContextMenus() {
        if (typeof contextMenu === 'undefined' || !contextMenu) return;

        const copyrightPanel = this.modal.querySelector('.character-db-panel[data-panel="copyright"]');
        const characterPanel = this.modal.querySelector('.character-db-panel[data-panel="character"]');
        const tagPanel = this.modal.querySelector('.character-db-panel[data-panel="tagtext"]');

        if (copyrightPanel) {
            contextMenu.attachToElement(copyrightPanel, {
                sections: [
                    {
                        type: 'list',
                        items: [
                            {
                                text: 'Copy copyright',
                                icon: 'fas fa-copy',
                                action: 'cdb-copy-copyright',
                                disabled: () => !this.selectedCopyright
                            },
                            {
                                text: 'Add character',
                                icon: 'fas fa-user-plus',
                                action: 'cdb-add-character',
                                disabled: () => !this.selectedCopyright
                            },
                            {
                                text: 'Add copyright',
                                icon: 'fas fa-plus',
                                action: 'cdb-add-copyright'
                            },
                            {
                                text: 'Edit copyright',
                                icon: 'fas fa-pen',
                                action: 'cdb-edit-copyright',
                                disabled: () => !this.selectedCopyright
                            },
                            {
                                text: 'Delete copyright',
                                icon: 'fas fa-trash',
                                action: 'cdb-delete-copyright',
                                disabled: () => !this.selectedCopyright
                            }
                        ]
                    }
                ],
                onAction: (action) => this.handleContextAction(action)
            });
        }

        if (characterPanel) {
            contextMenu.attachToElement(characterPanel, {
                sections: [
                    {
                        type: 'list',
                        items: [
                            {
                                text: 'Copy name',
                                icon: 'fas fa-copy',
                                action: 'cdb-copy-name',
                                disabled: () => !this.getSelectedCharacter()
                            },
                            {
                                text: 'Copy base prompt',
                                icon: 'fas fa-copy',
                                action: 'cdb-copy-base',
                                disabled: () => !this.getSelectedCharacter()
                            },
                            {
                                text: 'Add to prompt',
                                icon: 'fas fa-plus',
                                action: 'cdb-add-base-to-prompt',
                                disabled: () => !this.getSelectedCharacter() || !this.isManualEditorOpen()
                            },
                            {
                                text: 'Add overload',
                                icon: 'fas fa-layer-group',
                                action: 'cdb-add-overload',
                                disabled: () => !this.getSelectedCharacter()
                            },
                            {
                                text: 'Add character',
                                icon: 'fas fa-user-plus',
                                action: 'cdb-add-character',
                                disabled: () => !this.selectedCopyright
                            },
                            {
                                text: 'Edit character',
                                icon: 'fas fa-pen',
                                action: 'cdb-edit-character',
                                disabled: () => !this.getSelectedCharacter()
                            },
                            {
                                text: 'Delete character',
                                icon: 'fas fa-trash',
                                action: 'cdb-delete-character',
                                disabled: () => !this.getSelectedCharacter()
                            }
                        ]
                    }
                ],
                onAction: (action) => this.handleContextAction(action)
            });
        }

        if (tagPanel) {
            contextMenu.attachToElement(tagPanel, {
                sections: [
                    {
                        type: 'list',
                        items: [
                            {
                                text: 'Copy',
                                icon: 'fas fa-copy',
                                action: 'cdb-copy-tag-context',
                                disabled: () => !this.getSelectedCharacter()
                            },
                            {
                                text: 'Add to prompt',
                                icon: 'fas fa-plus',
                                action: 'cdb-add-tag-to-prompt',
                                disabled: () => !this.getSelectedCharacter() || !this.isManualEditorOpen()
                            },
                            {
                                text: 'Edit',
                                icon: 'fas fa-pen',
                                action: 'cdb-edit-tag-context',
                                disabled: () => !this.getSelectedCharacter()
                            },
                            {
                                text: 'Delete overload',
                                icon: 'fas fa-trash',
                                action: 'cdb-delete-overload',
                                disabled: () => typeof this._contextOverloadIndex !== 'number'
                            },
                            {
                                text: 'Add overload',
                                icon: 'fas fa-layer-group',
                                action: 'cdb-add-overload',
                                disabled: () => !this.getSelectedCharacter()
                            }
                        ]
                    }
                ],
                onAction: (action) => this.handleContextAction(action)
            });
        }
    }

    handleContextAction(action) {
        const ch = this.getSelectedCharacter();
        switch (action) {
            case 'cdb-copy-copyright':
                if (this.selectedCopyright) this.copyText(this.selectedCopyright);
                break;
            case 'cdb-copy-name':
                if (ch) this.copyText(ch.name);
                break;
            case 'cdb-copy-base':
                if (ch) this.copyText(ch.prompt || '');
                break;
            case 'cdb-copy-tag-context':
                this.copyTagContext();
                break;
            case 'cdb-add-base-to-prompt':
                if (ch) this.addToPrompt(ch.prompt || '');
                break;
            case 'cdb-add-tag-to-prompt':
                this.addTagContextToPrompt();
                break;
            case 'cdb-add-copyright':
                this.promptAddCopyright();
                break;
            case 'cdb-add-character':
                this.promptAddCharacter(this.selectedCopyright);
                break;
            case 'cdb-edit-copyright':
                this.promptEditCopyright();
                break;
            case 'cdb-delete-copyright':
                this.promptDeleteCopyright();
                break;
            case 'cdb-edit-character':
                this.promptEditCharacter();
                break;
            case 'cdb-delete-character':
                this.promptDeleteCharacter();
                break;
            case 'cdb-add-overload':
                this.promptAddOverload();
                break;
            case 'cdb-edit-tag-context':
                this.promptEditTagContext();
                break;
            case 'cdb-delete-overload':
                this.promptDeleteOverload();
                break;
            default:
                break;
        }
    }

    resolveTagContext() {
        const ch = this.getSelectedCharacter();
        if (!ch) return null;
        if (typeof this._contextOverloadIndex === 'number' && ch.enhancers && ch.enhancers[this._contextOverloadIndex]) {
            return {
                kind: 'overload',
                index: this._contextOverloadIndex,
                text: this.joinOverloadText(ch, ch.enhancers[this._contextOverloadIndex]),
                group: ch.enhancers[this._contextOverloadIndex]
            };
        }
        return {
            kind: 'base',
            text: ch.prompt || '',
            group: null
        };
    }

    copyTagContext() {
        const ctx = this.resolveTagContext();
        if (ctx) this.copyText(ctx.text);
    }

    addTagContextToPrompt() {
        const ctx = this.resolveTagContext();
        if (ctx) this.addToPrompt(ctx.text);
    }

    /* Track which tag row the context menu opened on */
    bindTagRowContextTracking() {
        if (!this.tagListEl || this._tagContextBound) return;
        this._tagContextBound = true;
        this.tagListEl.addEventListener('contextmenu', (e) => {
            const row = e.target.closest('.character-db-row');
            if (!row) {
                this._contextOverloadIndex = null;
                this._contextTagKind = 'base';
                return;
            }
            if (row.dataset.kind === 'overload') {
                this._contextOverloadIndex = Number(row.dataset.index);
                this._contextTagKind = 'overload';
            } else {
                this._contextOverloadIndex = null;
                this._contextTagKind = 'base';
            }
            this.tagListEl.querySelectorAll('.character-db-row').forEach((r) => r.classList.remove('active'));
            row.classList.add('active');
        });
    }

    /* ——— Dialogs / CRUD ——— */

    async promptAddCopyright() {
        const html = `
            <div class="character-db-form-stack">
                <p>Create a copyright and its first character.</p>
                <label>Copyright
                    <input type="text" class="form-control" id="cdbFieldCopyright" value="" />
                </label>
                <label>Character name
                    <input type="text" class="form-control" id="cdbFieldName" value="" />
                </label>
                <label>Base prompt
                    <textarea class="form-control" id="cdbFieldPrompt" rows="3"></textarea>
                </label>
            </div>
        `;
        const result = await showConfirmationDialog(html, [
            { text: 'Add', value: 'ok', className: 'btn-primary', icon: 'fas fa-plus', primary: true },
            { text: 'Cancel', value: null, className: 'btn-secondary' }
        ], null, {
            title: 'Add copyright',
            resolveValue: (value, dialog) => {
                if (value !== 'ok') return null;
                return {
                    copyright: dialog.querySelector('#cdbFieldCopyright')?.value?.trim() || '',
                    name: dialog.querySelector('#cdbFieldName')?.value?.trim() || '',
                    prompt: dialog.querySelector('#cdbFieldPrompt')?.value || ''
                };
            }
        });
        if (!result || !result.name || !result.copyright) {
            if (result && (!result.name || !result.copyright)) {
                showGlassToast('error', null, 'Copyright and character name are required', false, 3000, '<i class="fas fa-xmark"></i>');
            }
            return;
        }
        try {
            const saved = await this.upsertCharacter({
                name: result.name,
                copyright: result.copyright,
                prompt: result.prompt,
                enhancers: []
            });
            if (saved) this.selectCharacter(saved.name);
            showGlassToast('success', null, 'Copyright added', false, 2500, '<i class="fas fa-check"></i>');
        } catch (error) {
            showGlassToast('error', null, error.message || 'Failed to add', false, 4000, '<i class="fas fa-xmark"></i>');
        }
    }

    async promptAddCharacter(prefillCopyright) {
        const copyright = prefillCopyright || this.selectedCopyright || '';
        const html = `
            <div class="character-db-form-stack">
                <label>Copyright
                    <input type="text" class="form-control" id="cdbFieldCopyright" value="${escapeHtmlAttribute(copyright)}" />
                </label>
                <label>Character name
                    <input type="text" class="form-control" id="cdbFieldName" value="" />
                </label>
                <label>Base prompt
                    <textarea class="form-control" id="cdbFieldPrompt" rows="3"></textarea>
                </label>
            </div>
        `;
        const result = await showConfirmationDialog(html, [
            { text: 'Add', value: 'ok', className: 'btn-primary', icon: 'fas fa-plus', primary: true },
            { text: 'Cancel', value: null, className: 'btn-secondary' }
        ], null, {
            title: 'Add character',
            resolveValue: (value, dialog) => {
                if (value !== 'ok') return null;
                return {
                    copyright: dialog.querySelector('#cdbFieldCopyright')?.value?.trim() || '',
                    name: dialog.querySelector('#cdbFieldName')?.value?.trim() || '',
                    prompt: dialog.querySelector('#cdbFieldPrompt')?.value || ''
                };
            }
        });
        if (!result || !result.name) {
            if (result && !result.name) {
                showGlassToast('error', null, 'Character name is required', false, 3000, '<i class="fas fa-xmark"></i>');
            }
            return;
        }
        try {
            const saved = await this.upsertCharacter({
                name: result.name,
                copyright: result.copyright || 'Original',
                prompt: result.prompt,
                enhancers: []
            });
            if (saved) this.selectCharacter(saved.name);
            showGlassToast('success', null, 'Character added', false, 2500, '<i class="fas fa-check"></i>');
        } catch (error) {
            showGlassToast('error', null, error.message || 'Failed to add', false, 4000, '<i class="fas fa-xmark"></i>');
        }
    }

    async promptEditCopyright() {
        if (!this.selectedCopyright) return;
        const next = await showInputDialog(
            'Rename copyright (updates all characters under it)',
            this.selectedCopyright,
            'Copyright name',
            [
                { text: 'Save', value: 'ok', className: 'btn-primary', icon: 'fas fa-check', primary: true },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ],
            null,
            { title: 'Edit copyright' }
        );
        if (next == null || !String(next).trim()) return;
        const newName = String(next).trim();
        if (newName === this.selectedCopyright) return;
        try {
            await this.renameCopyright(this.selectedCopyright, newName);
            showGlassToast('success', null, 'Copyright renamed', false, 2500, '<i class="fas fa-check"></i>');
        } catch (error) {
            showGlassToast('error', null, error.message || 'Failed to rename', false, 4000, '<i class="fas fa-xmark"></i>');
        }
    }

    async promptDeleteCopyright() {
        if (!this.selectedCopyright) return;
        const count = this.getCharactersForCopyright(this.selectedCopyright).length;
        const confirmed = await showConfirmationDialog(
            `Delete copyright <strong>${escapeHtml(this.selectedCopyright)}</strong> and its ${count} character(s)?`,
            [
                { text: 'Delete', value: 'delete', className: 'btn-danger', icon: 'fas fa-trash', primary: true },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ],
            null,
            { title: 'Delete copyright' }
        );
        if (confirmed !== 'delete') return;
        try {
            await this.deleteCopyrightByName(this.selectedCopyright);
            showGlassToast('success', null, 'Copyright deleted', false, 2500, '<i class="fas fa-check"></i>');
        } catch (error) {
            showGlassToast('error', null, error.message || 'Failed to delete', false, 4000, '<i class="fas fa-xmark"></i>');
        }
    }

    async promptEditCharacter() {
        const ch = this.getSelectedCharacter();
        if (!ch) return;
        const html = `
            <div class="character-db-form-stack">
                <label>Copyright
                    <input type="text" class="form-control" id="cdbFieldCopyright" value="${escapeHtmlAttribute(ch.copyright || '')}" />
                </label>
                <label>Character name
                    <input type="text" class="form-control" id="cdbFieldName" value="${escapeHtmlAttribute(ch.name)}" />
                </label>
                <label>Base prompt
                    <textarea class="form-control" id="cdbFieldPrompt" rows="4">${escapeHtml(ch.prompt || '')}</textarea>
                </label>
            </div>
        `;
        const result = await showConfirmationDialog(html, [
            { text: 'Save', value: 'ok', className: 'btn-primary', icon: 'fas fa-check', primary: true },
            { text: 'Cancel', value: null, className: 'btn-secondary' }
        ], null, {
            title: 'Edit character',
            resolveValue: (value, dialog) => {
                if (value !== 'ok') return null;
                return {
                    copyright: dialog.querySelector('#cdbFieldCopyright')?.value?.trim() || '',
                    name: dialog.querySelector('#cdbFieldName')?.value?.trim() || '',
                    prompt: dialog.querySelector('#cdbFieldPrompt')?.value || ''
                };
            }
        });
        if (!result || !result.name) return;
        try {
            const saved = await this.upsertCharacter({
                name: result.name,
                copyright: result.copyright || 'Original',
                prompt: result.prompt,
                enhancers: ch.enhancers || []
            }, ch.name);
            if (saved) this.selectCharacter(saved.name);
            showGlassToast('success', null, 'Character saved', false, 2500, '<i class="fas fa-check"></i>');
        } catch (error) {
            showGlassToast('error', null, error.message || 'Failed to save', false, 4000, '<i class="fas fa-xmark"></i>');
        }
    }

    async promptDeleteCharacter() {
        const ch = this.getSelectedCharacter();
        if (!ch) return;
        const confirmed = await showConfirmationDialog(
            `Delete character <strong>${escapeHtml(ch.name)}</strong>?`,
            [
                { text: 'Delete', value: 'delete', className: 'btn-danger', icon: 'fas fa-trash', primary: true },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ],
            null,
            { title: 'Delete character' }
        );
        if (confirmed !== 'delete') return;
        try {
            const name = ch.name;
            await this.deleteCharacterByName(name);
            this.selectedCharacterName = null;
            this.renderAll();
            showGlassToast('success', null, 'Character deleted', false, 2500, '<i class="fas fa-check"></i>');
        } catch (error) {
            showGlassToast('error', null, error.message || 'Failed to delete', false, 4000, '<i class="fas fa-xmark"></i>');
        }
    }

    async promptAddOverload() {
        const ch = this.getSelectedCharacter();
        if (!ch) return;
        const text = await showInputDialog(
            'Comma-separated overload tags',
            '',
            'outfit tags, …',
            [
                { text: 'Add', value: 'ok', className: 'btn-primary', icon: 'fas fa-plus', primary: true },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ],
            null,
            { title: 'Add overload' }
        );
        if (text == null || !String(text).trim()) return;
        const group = this.parseTagList(String(text));
        if (!group.length) return;
        const enhancers = Array.isArray(ch.enhancers) ? [...ch.enhancers, group] : [group];
        try {
            await this.upsertCharacter({
                name: ch.name,
                copyright: ch.copyright,
                prompt: ch.prompt,
                enhancers
            }, ch.name);
            this.selectCharacter(ch.name);
            showGlassToast('success', null, 'Overload added', false, 2500, '<i class="fas fa-check"></i>');
        } catch (error) {
            showGlassToast('error', null, error.message || 'Failed to add overload', false, 4000, '<i class="fas fa-xmark"></i>');
        }
    }

    async promptEditTagContext() {
        const ch = this.getSelectedCharacter();
        if (!ch) return;
        const ctx = this.resolveTagContext();
        if (!ctx) return;

        if (ctx.kind === 'base') {
            const text = await showInputDialog(
                'Base prompt',
                ch.prompt || '',
                'prompt tags',
                [
                    { text: 'Save', value: 'ok', className: 'btn-primary', icon: 'fas fa-check', primary: true },
                    { text: 'Cancel', value: null, className: 'btn-secondary' }
                ],
                null,
                { title: 'Edit base prompt' }
            );
            if (text == null) return;
            try {
                await this.upsertCharacter({
                    name: ch.name,
                    copyright: ch.copyright,
                    prompt: String(text),
                    enhancers: ch.enhancers || []
                }, ch.name);
                this.selectCharacter(ch.name);
                showGlassToast('success', null, 'Prompt updated', false, 2500, '<i class="fas fa-check"></i>');
            } catch (error) {
                showGlassToast('error', null, error.message || 'Failed to save', false, 4000, '<i class="fas fa-xmark"></i>');
            }
            return;
        }

        const current = Array.isArray(ctx.group) ? ctx.group.join(', ') : '';
        const text = await showInputDialog(
            'Comma-separated overload tags',
            current,
            'outfit tags, …',
            [
                { text: 'Save', value: 'ok', className: 'btn-primary', icon: 'fas fa-check', primary: true },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ],
            null,
            { title: 'Edit overload' }
        );
        if (text == null) return;
        const group = this.parseTagList(String(text));
        const enhancers = Array.isArray(ch.enhancers) ? [...ch.enhancers] : [];
        if (!group.length) {
            enhancers.splice(ctx.index, 1);
        } else {
            enhancers[ctx.index] = group;
        }
        try {
            await this.upsertCharacter({
                name: ch.name,
                copyright: ch.copyright,
                prompt: ch.prompt,
                enhancers
            }, ch.name);
            this.selectCharacter(ch.name);
            showGlassToast('success', null, 'Overload updated', false, 2500, '<i class="fas fa-check"></i>');
        } catch (error) {
            showGlassToast('error', null, error.message || 'Failed to save', false, 4000, '<i class="fas fa-xmark"></i>');
        }
    }

    async promptDeleteOverload() {
        const ch = this.getSelectedCharacter();
        if (!ch || typeof this._contextOverloadIndex !== 'number') return;
        const idx = this._contextOverloadIndex;
        const confirmed = await showConfirmationDialog(
            `Delete overload ${idx + 1}?`,
            [
                { text: 'Delete', value: 'delete', className: 'btn-danger', icon: 'fas fa-trash', primary: true },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ],
            null,
            { title: 'Delete overload' }
        );
        if (confirmed !== 'delete') return;
        const enhancers = Array.isArray(ch.enhancers) ? [...ch.enhancers] : [];
        enhancers.splice(idx, 1);
        try {
            await this.upsertCharacter({
                name: ch.name,
                copyright: ch.copyright,
                prompt: ch.prompt,
                enhancers
            }, ch.name);
            this._contextOverloadIndex = null;
            this.selectCharacter(ch.name);
            showGlassToast('success', null, 'Overload deleted', false, 2500, '<i class="fas fa-check"></i>');
        } catch (error) {
            showGlassToast('error', null, error.message || 'Failed to delete', false, 4000, '<i class="fas fa-xmark"></i>');
        }
    }
}

const characterDbApplet = new CharacterDbApplet();
