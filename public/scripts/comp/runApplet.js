// Run applet — Application Finder launcher
// public/scripts/comp/runApplet.js

class RunApplet {
    constructor() {
        this.modal = null;
        this.input = null;
        this.suggestionsEl = null;
        this.launchBtn = null;
        this.results = [];
        this.selectedIndex = -1;
        this.searchTimeout = null;
        this.debounceMs = 200;
        this.isOpen = false;
    }

    init() {
        this.modal = document.getElementById('runModal');
        this.input = document.getElementById('runAppletInput');
        this.suggestionsEl = document.getElementById('runAppletSuggestions');
        this.launchBtn = document.getElementById('runAppletLaunchBtn');
        if (!this.modal || !this.input) return;

        this.input.addEventListener('input', () => this.handleInput());
        this.input.addEventListener('keydown', (e) => this.handleKeydown(e));

        if (this.launchBtn) {
            this.launchBtn.addEventListener('click', () => this.executeSelected());
        }

        const closeBtn = this.modal.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }
    }

    open() {
        if (!this.modal) this.init();
        if (!this.modal) return;

        if (typeof invalidateRunStaticCache === 'function') invalidateRunStaticCache();

        if (typeof openModal === 'function') {
            openModal(this.modal);
        } else {
            this.modal.classList.remove('hidden');
        }

        this.isOpen = true;
        this.results = [];
        this.selectedIndex = -1;
        this.input.value = '';
        this.renderSuggestions([]);
        this.updateLaunchButton();

        requestAnimationFrame(() => {
            this.input.focus();
            this.input.select();
        });
    }

    close() {
        if (!this.modal) return;
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

    handleInput() {
        clearTimeout(this.searchTimeout);
        const value = this.input.value;
        if (!value.trim()) {
            this.results = [];
            this.selectedIndex = -1;
            this.renderSuggestions([]);
            this.updateLaunchButton();
            return;
        }
        this.searchTimeout = setTimeout(() => this.runSearch(value), this.debounceMs);
    }

    async runSearch(value) {
        if (!value.trim()) return;
        if (typeof searchRunCommands !== 'function') return;
        try {
            const results = await searchRunCommands(value);
            if (this.input.value.trim() !== value.trim()) return;
            this.results = results;
            this.selectedIndex = results.length > 0 ? 0 : -1;
            this.renderSuggestions(results);
            this.updateLaunchButton();
        } catch (err) {
            console.error('Run search failed:', err);
        }
    }

    renderSuggestions(results) {
        if (!this.suggestionsEl) return;
        this.suggestionsEl.innerHTML = '';
        if (!results.length) {
            this.suggestionsEl.classList.add('hidden');
            return;
        }
        this.suggestionsEl.classList.remove('hidden');

        results.forEach((entry, index) => {
            const item = document.createElement('div');
            item.className = 'character-autocomplete-item run-applet-item';
            if (index === this.selectedIndex) item.classList.add('keyboard-selected');

            const catLabel = (window.RUN_CATEGORY_LABELS && window.RUN_CATEGORY_LABELS[entry.category]) || entry.category;
            const iconClass = entry.icon || (window.RUN_CATEGORY_ICONS && window.RUN_CATEGORY_ICONS[entry.category]) || 'fas fa-circle';

            item.innerHTML = `
                <div class="character-info-row">
                    <i class="${iconClass} run-applet-item-icon"></i>
                    <span class="character-name">${this.escapeHtml(entry.label)}</span>
                    <span class="run-applet-category-badge">${this.escapeHtml(catLabel)}</span>
                </div>
                ${entry.subtitle ? `<div class="run-applet-item-sub">${this.escapeHtml(entry.subtitle)}</div>` : ''}
            `;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.selectedIndex = index;
                this.executeSelected();
            });
            item.addEventListener('mouseenter', () => {
                this.selectedIndex = index;
                this.renderSuggestions(this.results);
                this.updateLaunchButton();
            });
            this.suggestionsEl.appendChild(item);
        });
    }

    escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;');
    }

    handleKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (this.results.length) {
                this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
                if (this.selectedIndex < 0) this.selectedIndex = 0;
                this.renderSuggestions(this.results);
                this.updateLaunchButton();
            }
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (this.results.length) {
                this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
                this.renderSuggestions(this.results);
                this.updateLaunchButton();
            }
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            this.executeSelected();
        }
    }

    updateLaunchButton() {
        if (!this.launchBtn) return;
        const hasSelection = this.selectedIndex >= 0 && this.results[this.selectedIndex];
        this.launchBtn.disabled = !hasSelection;
    }

    async executeSelected() {
        let entry = null;
        if (this.selectedIndex >= 0 && this.results[this.selectedIndex]) {
            entry = this.results[this.selectedIndex];
        } else if (this.results.length === 1) {
            entry = this.results[0];
        }
        if (!entry || typeof entry.execute !== 'function') return;

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
