// Run applet — Application Finder launcher
// public/scripts/comp/runApplet.js

class RunApplet {
    constructor() {
        this.modal = null;
        this.input = null;
        this.suggestionsEl = null;
        this.actionPanelEl = null;
        this.resultsShell = null;
        this.results = [];
        this.selectedIndex = -1;
        this.searchTimeout = null;
        this.debounceMs = 180;
        this.isOpen = false;
        this.actionPanelOpen = false;
        this.actionItems = [];
        this.actionSelectedIndex = 0;
        this.actionEntry = null;
        this.actionOnAction = null;
        this.lastSearchQuery = '';
        this.selectedEntryId = null;
        this.mouseNavEnabled = false;
        this.searchToken = 0;
    }

    init() {
        this.modal = document.getElementById('runModal');
        this.input = document.getElementById('runAppletInput');
        this.suggestionsEl = document.getElementById('runAppletSuggestions');
        this.actionPanelEl = document.getElementById('runAppletActionPanel');
        this.resultsShell = this.modal ? this.modal.querySelector('.run-applet-results-shell') : null;
        this.prefixHintEl = document.getElementById('runAppletPrefixHint');
        if (!this.modal || !this.input) return;

        if (this.prefixHintEl) {
            // RUN_SEARCH_PREFIX_HINT: public/scripts/comp/runCommandIndex.js
            this.prefixHintEl.textContent = window.RUN_SEARCH_PREFIX_HINT || '';
        }

        if (this.suggestionsEl) {
            this.suggestionsEl.addEventListener('mousemove', () => {
                if (!this.mouseNavEnabled && this.results.length) {
                    this.enableMouseNav();
                }
            }, { passive: true });
        }

        this.input.addEventListener('input', () => this.handleInput());
        this.input.addEventListener('keydown', (e) => this.handleKeydown(e));

        const closeBtn = this.modal.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }
    }

    open() {
        if (!this.modal) this.init();
        if (!this.modal) return;

        if (typeof invalidateRunStaticCache === 'function') invalidateRunStaticCache();

        this.closeActionPanel();

        if (typeof openModal === 'function') {
            openModal(this.modal);
        } else {
            this.modal.classList.remove('hidden');
        }

        this.isOpen = true;
        this.results = [];
        this.selectedIndex = -1;
        this.selectedEntryId = null;
        this.disableMouseNav();
        this.input.value = '';
        this.lastSearchQuery = '';
        this.renderSuggestions([]);

        requestAnimationFrame(() => {
            this.positionRunAppletWindow();
            this.input.focus();
            this.input.select();
        });
    }

    positionRunAppletWindow() {
        if (!this.modal) return;
        const maxW = parseInt(this.modal.dataset.windowMaxWidth, 10) || 720;
        this.modal.style.width = `${maxW}px`;
        this.modal.style.maxWidth = `${maxW}px`;
        this.modal.style.removeProperty('height');

        const applyPosition = () => {
            // Top-anchored modal — setModalOffsetsFromViewportTopLeft: public/scripts/comp/modalUtils.js
            const layout = typeof getModalLayoutDimensions === 'function'
                ? getModalLayoutDimensions(this.modal)
                : null;
            const width = (layout && layout.width) || maxW;
            const height = (layout && layout.height) || this.modal.offsetHeight || 120;
            const margin = 12;
            const left = Math.max(margin, Math.min(
                window.innerWidth - width - margin,
                (window.innerWidth - width) / 2
            ));
            const maxTop = Math.max(margin, window.innerHeight - height - margin);
            const top = Math.min(maxTop, Math.max(margin, window.innerHeight * 0.25));

            if (typeof setModalOffsetsFromViewportTopLeft === 'function') {
                setModalOffsetsFromViewportTopLeft(this.modal, left, top);
            }
            // ensureModalWithinViewport: public/scripts/comp/modalUtils.js
            if (typeof ensureModalWithinViewport === 'function') {
                ensureModalWithinViewport(this.modal);
            }
        };

        requestAnimationFrame(() => requestAnimationFrame(applyPosition));
    }

    close() {
        if (!this.modal) return;
        this.closeActionPanel();
        if (typeof closeModal === 'function') {
            closeModal(this.modal);
        } else {
            this.modal.classList.add('hidden');
        }
        this.isOpen = false;
        clearTimeout(this.searchTimeout);
    }

    toggle() {
        const isVisible = this.modal && !this.modal.classList.contains('hidden');
        if (isVisible) {
            this.close();
        } else {
            this.open();
        }
    }

    disableMouseNav() {
        this.mouseNavEnabled = false;
        if (this.resultsShell) {
            this.resultsShell.classList.remove('mouse-nav');
        }
    }

    enableMouseNav() {
        this.mouseNavEnabled = true;
        if (this.resultsShell) {
            this.resultsShell.classList.add('mouse-nav');
        }
    }

    handleInput() {
        clearTimeout(this.searchTimeout);
        this.closeActionPanel();
        this.disableMouseNav();
        const value = this.input.value;
        if (!value.trim()) {
            this.results = [];
            this.selectedIndex = -1;
            this.selectedEntryId = null;
            this.lastSearchQuery = '';
            this.renderSuggestions([]);
            return;
        }
        this.searchTimeout = setTimeout(() => this.runSearch(value), this.debounceMs);
    }

    runSearch(value) {
        if (!value.trim()) return;
        if (typeof searchRunCommands !== 'function') return;

        const queryAtStart = value.trim();
        this.lastSearchQuery = queryAtStart;
        this.disableMouseNav();
        const searchToken = ++this.searchToken;
        let isFirstResultForQuery = true;

        searchRunCommands(value, (results) => {
            if (searchToken !== this.searchToken) return;
            if (this.input.value.trim() !== queryAtStart) return;
            this.results = results || [];

            if (isFirstResultForQuery) {
                this.selectedIndex = this.results.length > 0 ? 0 : -1;
                isFirstResultForQuery = false;
            } else {
                const prevEntryId = this.selectedEntryId;
                if (prevEntryId) {
                    const idx = this.results.findIndex((e) => e.id === prevEntryId);
                    this.selectedIndex = idx >= 0 ? idx : (this.results.length > 0 ? 0 : -1);
                } else {
                    this.selectedIndex = this.results.length > 0 ? 0 : -1;
                }
            }

            this.syncSelectedEntryId();
            this.renderSuggestions(this.results);
            if (this.selectedIndex >= 0) {
                this.scrollSelectedIntoView();
            }
        });
    }

    updateSelectionHighlight() {
        if (!this.suggestionsEl) return;
        const items = this.suggestionsEl.querySelectorAll('.run-applet-item:not(.run-applet-action-item)');
        items.forEach((el, index) => {
            el.classList.toggle('keyboard-selected', index === this.selectedIndex);
        });
    }

    renderSuggestions(results) {
        if (!this.suggestionsEl) return;
        this.suggestionsEl.innerHTML = '';
        if (!results.length) {
            this.suggestionsEl.classList.add('hidden');
            if (this.resultsShell) this.resultsShell.classList.remove('has-results');
            return;
        }
        this.suggestionsEl.classList.remove('hidden');
        if (this.resultsShell) this.resultsShell.classList.add('has-results');

        results.forEach((entry, index) => {
            const item = document.createElement('div');
            item.className = 'character-autocomplete-item run-applet-item';
            if (index === this.selectedIndex) item.classList.add('keyboard-selected');
            if (entry.isNetworkResult || entry.pinnedBottom) {
                item.classList.add('run-applet-item-pinned');
            }

            const catLabel = (window.RUN_CATEGORY_LABELS && window.RUN_CATEGORY_LABELS[entry.category]) || entry.category;
            const iconClass = entry.icon || (window.RUN_CATEGORY_ICONS && window.RUN_CATEGORY_ICONS[entry.category]) || 'fas fa-circle';
            const hasMenu = !entry.isDeferredNetwork
                && typeof getRunEntryActionItems === 'function'
                && getRunEntryActionItems(entry);
            const sub = entry.subtitle ? ` · ${entry.subtitle}` : '';

            item.innerHTML = `
                <div class="character-info-row run-applet-row">
                    <i class="${iconClass} run-applet-item-icon"></i>
                    <span class="character-name run-applet-label">${this.escapeHtml(entry.label)}</span>
                    <span class="run-applet-meta">${this.escapeHtml(catLabel)}${this.escapeHtml(sub)}</span>
                    ${hasMenu ? '<span class="run-applet-menu-hint" title="Arrow right for actions"><i class="fas fa-chevron-right"></i></span>' : ''}
                </div>
            `;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.enableMouseNav();
                this.selectedIndex = index;
                this.syncSelectedEntryId();
                this.updateSelectionHighlight();
                this.executeSelected();
            });
            item.addEventListener('mouseenter', () => {
                if (!this.mouseNavEnabled) return;
                this.selectedIndex = index;
                this.syncSelectedEntryId();
                this.updateSelectionHighlight();
            });
            this.attachRunEntryContextMenu(item, entry);
            this.suggestionsEl.appendChild(item);
        });
        this.updateSelectionHighlight();
    }

    isActionItemSelectable(item) {
        return Boolean(item && !item.header && !item.disabled && !item.separator);
    }

    findNextActionableIndex(fromIndex, direction) {
        if (!this.actionItems.length) return -1;
        const step = direction >= 0 ? 1 : -1;
        let index = fromIndex;
        for (let i = 0; i < this.actionItems.length; i++) {
            index += step;
            if (index < 0 || index >= this.actionItems.length) {
                return fromIndex >= 0 && this.isActionItemSelectable(this.actionItems[fromIndex]) ? fromIndex : -1;
            }
            if (this.isActionItemSelectable(this.actionItems[index])) return index;
        }
        return -1;
    }

    attachRunEntryContextMenu(item, entry) {
        // getRunEntryContextMenu: public/scripts/comp/runCommandIndex.js
        if (!item || !entry || !contextMenu || typeof getRunEntryContextMenu !== 'function') return;
        const menuConfig = getRunEntryContextMenu(entry);
        if (!menuConfig) return;
        contextMenu.attachToElement(item, menuConfig);
    }

    escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;');
    }

    handleKeydown(e) {
        if (this.actionPanelOpen) {
            this.handleActionPanelKeydown(e);
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
            return;
        }
        if (e.key === 'ArrowRight') {
            const entry = this.results[this.selectedIndex];
            if (entry && !entry.isDeferredNetwork && typeof getRunEntryActionItems === 'function') {
                const actionData = getRunEntryActionItems(entry);
                if (actionData) {
                    e.preventDefault();
                    this.openActionPanel(entry, actionData);
                    return;
                }
            }
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.disableMouseNav();
            if (this.results.length) {
                if (this.selectedIndex < 0) this.selectedIndex = 0;
                else this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
                this.syncSelectedEntryId();
                this.updateSelectionHighlight();
                this.scrollSelectedIntoView();
            }
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.disableMouseNav();
            if (this.results.length) {
                if (this.selectedIndex < 0) this.selectedIndex = 0;
                else this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
                this.syncSelectedEntryId();
                this.updateSelectionHighlight();
                this.scrollSelectedIntoView();
            }
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            this.executeSelected();
        }
    }

    handleActionPanelKeydown(e) {
        if (e.key === 'Escape' || e.key === 'ArrowLeft') {
            e.preventDefault();
            this.closeActionPanel();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = this.findNextActionableIndex(this.actionSelectedIndex, 1);
            if (next >= 0) {
                this.actionSelectedIndex = next;
                this.renderActionPanel();
            }
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = this.findNextActionableIndex(this.actionSelectedIndex, -1);
            if (prev >= 0) {
                this.actionSelectedIndex = prev;
                this.renderActionPanel();
            }
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            this.executeActionPanelSelection();
        }
    }

    openActionPanel(entry, actionData) {
        if (!this.actionPanelEl || !this.resultsShell) return;
        this.actionPanelOpen = true;
        this.actionEntry = entry;
        this.actionItems = actionData.items || [];
        this.actionOnAction = actionData.onAction;
        this.actionSelectedIndex = this.findNextActionableIndex(-1, 1);
        if (this.actionSelectedIndex < 0) this.actionSelectedIndex = 0;
        this.resultsShell.classList.add('show-actions');
        this.actionPanelEl.classList.remove('hidden');
        this.renderActionPanel();
    }

    closeActionPanel() {
        this.actionPanelOpen = false;
        this.actionItems = [];
        this.actionEntry = null;
        this.actionOnAction = null;
        this.actionSelectedIndex = 0;
        if (this.actionPanelEl) {
            this.actionPanelEl.classList.add('hidden');
            this.actionPanelEl.innerHTML = '';
        }
        if (this.resultsShell) {
            this.resultsShell.classList.remove('show-actions');
        }
    }

    renderActionPanel() {
        if (!this.actionPanelEl || !this.actionEntry) return;
        const backLabel = this.escapeHtml(this.actionEntry.label);
        let html = `<div class="run-applet-action-header">
            <button type="button" class="run-applet-action-back" tabindex="-1"><i class="fas fa-chevron-left"></i> Back</button>
            <span class="run-applet-action-title">${backLabel}</span>
        </div>`;
        html += '<div class="run-applet-action-list">';
        this.actionItems.forEach((item, index) => {
            if (item.header) {
                html += `<div class="run-applet-action-section-label">${this.escapeHtml(item.text || '')}</div>`;
                return;
            }
            const selected = index === this.actionSelectedIndex ? ' keyboard-selected' : '';
            const danger = item.className && item.className.includes('danger') ? ' run-applet-action-danger' : '';
            const disabled = item.disabled ? ' is-disabled' : '';
            html += `<div class="character-autocomplete-item run-applet-item run-applet-action-item${selected}${danger}${disabled}" data-action-index="${index}">
                <div class="character-info-row run-applet-row">
                    <i class="${item.icon || 'fas fa-circle'} run-applet-item-icon"></i>
                    <span class="character-name run-applet-label">${this.escapeHtml(item.text)}</span>
                </div>
            </div>`;
        });
        html += '</div>';
        this.actionPanelEl.innerHTML = html;

        const backBtn = this.actionPanelEl.querySelector('.run-applet-action-back');
        if (backBtn) {
            backBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.closeActionPanel();
            });
        }
        this.actionPanelEl.querySelectorAll('.run-applet-action-item').forEach((el) => {
            const index = parseInt(el.dataset.actionIndex, 10) || 0;
            const item = this.actionItems[index];
            if (!this.isActionItemSelectable(item)) return;
            el.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.actionSelectedIndex = index;
                this.executeActionPanelSelection();
            });
            el.addEventListener('mouseenter', () => {
                if (!this.isActionItemSelectable(item)) return;
                this.actionSelectedIndex = index;
                this.renderActionPanel();
            });
        });
    }

    async executeActionPanelSelection() {
        const item = this.actionItems[this.actionSelectedIndex];
        if (!item || !this.isActionItemSelectable(item) || !this.actionOnAction) return;
        const entry = this.actionEntry;
        this.closeActionPanel();
        this.close();
        try {
            await this.actionOnAction(item.action, item);
        } catch (err) {
            console.error('Run action failed:', err);
            showGlassToast('error', 'Run', err.message || 'Action failed', false, 3000);
        }
        if (entry && entry.refocusTarget && document.contains(entry.refocusTarget)) {
            entry.refocusTarget.focus();
            if (typeof updateEmphasisHighlighting === 'function') updateEmphasisHighlighting(entry.refocusTarget);
        }
    }

    syncSelectedEntryId() {
        const entry = this.results[this.selectedIndex];
        this.selectedEntryId = entry ? entry.id : null;
    }

    scrollSelectedIntoView() {
        if (!this.suggestionsEl || this.selectedIndex < 0) return;
        const items = this.suggestionsEl.querySelectorAll('.run-applet-item:not(.run-applet-action-item)');
        const el = items[this.selectedIndex];
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }

    async executeSelected() {
        let entry = null;
        if (this.selectedIndex >= 0 && this.results[this.selectedIndex]) {
            entry = this.results[this.selectedIndex];
        } else if (this.results.length === 1) {
            entry = this.results[0];
        }
        if (!entry) return;

        if (entry.isDeferredNetwork) {
            const query = entry.deferredQuery || this.lastSearchQuery || this.input.value.trim();
            if (!query || typeof runFetchNetworkSearch !== 'function') return;
            const queryAtStart = query;
            runFetchNetworkSearch(query, (results) => {
                if (this.input.value.trim() !== queryAtStart) return;
                this.disableMouseNav();
                this.results = results || [];
                this.selectedIndex = this.results.length > 0 ? 0 : -1;
                this.syncSelectedEntryId();
                this.renderSuggestions(this.results);
            });
            return;
        }

        if (typeof entry.execute !== 'function') return;

        const refocusTarget = entry.refocusTarget || null;
        this.close();

        try {
            await entry.execute();
            if (refocusTarget && document.contains(refocusTarget)) {
                refocusTarget.focus();
                if (typeof updateEmphasisHighlighting === 'function') updateEmphasisHighlighting(refocusTarget);
            }
        } catch (err) {
            console.error('Run execute failed:', err);
            showGlassToast('error', 'Run', err.message || 'Action failed', false, 3000);
        }
    }
}

const runApplet = new RunApplet();

document.addEventListener('DOMContentLoaded', () => {
    runApplet.init();
});

window.runApplet = runApplet;
