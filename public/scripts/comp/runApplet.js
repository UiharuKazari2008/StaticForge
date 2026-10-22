// Run applet — Application Finder launcher in Vista's Run dialog (public/css/run-applet.css)
// public/scripts/comp/runApplet.js
//
// The Open box is Vista's editable combo box: typing shows the results in the autocomplete
// drop-down under it (Enter or OK runs the selected one, Right opens its actions), the drop-down
// button (F4, Alt+Down) lists what was run before. OK with nothing found shows Vista's "cannot
// find" message box; Browse... opens Cartograph. The dialog opens at the bottom left of the work
// area, where Vista puts it.

const RUN_HISTORY_KEY = 'runAppletHistory';
const RUN_HISTORY_MAX = 26;
const RUN_ROW_PX = 19;

class RunApplet {
    constructor() {
        this.modal = null;
        this.input = null;
        this.combo = null;
        this.suggestionsEl = null;
        this.actionPanelEl = null;
        this.resultsShell = null;
        this.okButton = null;
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
        // the drop-down: null (closed), 'auto' (results) or 'history'
        this.popupMode = null;
        this.popupDismissed = false;
        this.popupSize = null;
        this.history = [];
        this.historyIndex = -1;
        this.confirmPending = false;
    }

    init() {
        this.modal = document.getElementById('runModal');
        this.input = document.getElementById('runAppletInput');
        this.suggestionsEl = document.getElementById('runAppletSuggestions');
        this.actionPanelEl = document.getElementById('runAppletActionPanel');
        this.resultsShell = this.modal ? this.modal.querySelector('.run-applet-results-shell') : null;
        this.prefixHintEl = document.getElementById('runAppletPrefixHint');
        this.combo = this.modal ? this.modal.querySelector('.run-applet-combo') : null;
        this.okButton = this.modal ? this.modal.querySelector('[data-run-action="ok"]') : null;
        if (!this.modal || !this.input) return;
        if (this._initWired) {
            return;
        }
        this._initWired = true;

        if (this.prefixHintEl) {
            // RUN_SEARCH_PREFIX_HINT: public/scripts/comp/runCommandIndex.js
            const hint = window.RUN_SEARCH_PREFIX_HINT || '';
            this.prefixHintEl.textContent = hint ? `Prefixes: ${hint}` : '';
            this.prefixHintEl.title = hint;
        }

        if (this.suggestionsEl) {
            this.suggestionsEl.addEventListener('mousemove', () => {
                if (!this.mouseNavEnabled && this.results.length) {
                    this.enableMouseNav();
                }
            }, { passive: true });
        }

        this.input.addEventListener('input', () => this.handleInput());
        // Vista closes the drop-down when the box loses focus (clicks in the list keep it)
        this.input.addEventListener('blur', () => this.hidePopup());

        const drop = this.modal.querySelector('.run-applet-drop');
        if (drop) {
            drop.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.input.focus();
                this.toggleHistory();
            });
        }

        // the drop-down never takes the focus from the box (its grip and scroll bar included)
        if (this.resultsShell) this.resultsShell.addEventListener('mousedown', (e) => e.preventDefault());
        const grip = this.modal.querySelector('.run-applet-grip');
        if (grip) this.wireGrip(grip);

        this.modal.querySelectorAll('[data-run-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.runAction;
                if (action === 'ok') this.confirm();
                else if (action === 'cancel') this.close();
                else if (action === 'browse') this.browse();
            });
        });

        this.wireKeyboardHandler();

        const closeBtn = this.modal.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }
    }

    open() {
        if (!this.modal) this.init();
        if (!this.modal) return;

        if (typeof invalidateRunStaticCache === 'function') invalidateRunStaticCache();
        // Wildcard results need the on-demand chunk; runCommandIndex.js rebuilds when it lands
        // ensureAppOptionsChunk: public/scripts/comp/appBootstrap.js
        if (typeof ensureAppOptionsChunk === 'function') ensureAppOptionsChunk('text_replacements');

        this.closeActionPanel();
        this.hidePopup();
        this.modal.classList.remove('run-applet-cues');

        if (typeof openModal === 'function') {
            openModal(this.modal);
        } else {
            this.modal.classList.remove('hidden');
        }

        this.isOpen = true;
        this.results = [];
        this.selectedIndex = -1;
        this.selectedEntryId = null;
        this.confirmPending = false;
        this.popupSize = null;
        this.history = this.loadHistory();
        this.disableMouseNav();
        this.input.value = '';
        this.lastSearchQuery = '';
        this.updateOkState();
        this.renderSuggestions([]);

        requestAnimationFrame(() => {
            this.positionRunAppletWindow();
            this.input.focus();
            this.input.select();
        });
    }

    /** Vista opens Run at the bottom left of the work area, just above the taskbar. */
    positionRunAppletWindow() {
        if (!this.modal) return;
        const applyPosition = () => {
            // getModalWorkAreaBounds / setModalOffsetsFromViewportTopLeft: public/scripts/comp/modalUtils.js
            const area = typeof getModalWorkAreaBounds === 'function'
                ? getModalWorkAreaBounds()
                : { left: 0, top: 0, bottom: window.innerHeight };
            // the layout size: the bounding rect is still scaled by the opening animation
            const layout = typeof getModalLayoutDimensions === 'function'
                ? getModalLayoutDimensions(this.modal)
                : { height: this.modal.offsetHeight };
            const left = area.left + 8;
            const top = Math.max(area.top, area.bottom - layout.height - 4);
            if (typeof setModalOffsetsFromViewportTopLeft === 'function') {
                setModalOffsetsFromViewportTopLeft(this.modal, left, top);
            }
            // ensureModalWithinViewport: public/scripts/comp/modalUtils.js
            if (typeof ensureModalWithinViewport === 'function') {
                ensureModalWithinViewport(this.modal);
            }
        };

        // placed once the opening animation is over (while it runs the window is scaled, and the
        // window manager settles the scaled rect), and again if the size changes after that (the
        // first open loads run-applet.css with the script). Only a new size places it again, so a
        // drag in the meantime stays where the user put it.
        const modal = this.modal;
        let lastSize = '';
        const place = () => {
            if (!this.isOpen || modal.classList.contains('opening')) return;
            const size = `${modal.offsetWidth}x${modal.offsetHeight}`;
            if (size === lastSize) return;
            lastSize = size;
            applyPosition();
        };
        if (this._placeObservers) this._placeObservers.forEach((o) => o.disconnect());
        const observers = [new MutationObserver(place)];
        observers[0].observe(modal, { attributes: true, attributeFilter: ['class'] });
        if (typeof ResizeObserver === 'function') {
            observers.push(new ResizeObserver(place));
            observers[1].observe(modal);
        }
        this._placeObservers = observers;
        setTimeout(() => {
            if (this._placeObservers !== observers) return;
            observers.forEach((o) => o.disconnect());
            this._placeObservers = null;
        }, 3000);
        requestAnimationFrame(() => requestAnimationFrame(place));
    }

    close() {
        if (!this.modal) return;
        this.closeActionPanel();
        this.hidePopup();
        if (typeof closeModal === 'function') {
            closeModal(this.modal);
        } else {
            this.modal.classList.add('hidden');
            debouncedUpdateTaskbarWindows();
        }
        this.isOpen = false;
        this.confirmPending = false;
        clearTimeout(this.searchTimeout);
        this.searchTimeout = null;
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

    updateOkState() {
        if (this.okButton) this.okButton.disabled = !this.input.value.trim();
    }

    handleInput() {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = null;
        this.closeActionPanel();
        this.disableMouseNav();
        this.popupDismissed = false;
        this.confirmPending = false;
        if (this.popupMode === 'history') this.hidePopup();
        this.updateOkState();
        const value = this.input.value;
        if (!value.trim()) {
            this.results = [];
            this.selectedIndex = -1;
            this.selectedEntryId = null;
            this.lastSearchQuery = '';
            this.renderSuggestions([]);
            return;
        }
        this.searchTimeout = setTimeout(() => {
            this.searchTimeout = null;
            this.runSearch(value);
        }, this.debounceMs);
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
            // OK / Enter pressed before the results were in: run the first one now
            if (this.confirmPending) {
                this.confirmPending = false;
                if (this.results.length) this.executeSelected();
                else this.showNotFound(queryAtStart);
                return;
            }
            this.renderSuggestions(this.results);
            if (this.selectedIndex >= 0) {
                this.scrollSelectedIntoView();
            }
        });
    }

    updateSelectionHighlight() {
        if (!this.suggestionsEl) return;
        const items = this.suggestionsEl.querySelectorAll('.run-applet-item');
        items.forEach((el, index) => {
            el.classList.toggle('keyboard-selected', index === this.selectedIndex);
            el.setAttribute('aria-selected', index === this.selectedIndex ? 'true' : 'false');
        });
    }

    renderSuggestions(results) {
        if (!this.suggestionsEl) return;
        this.suggestionsEl.innerHTML = '';
        if (!results.length) {
            if (this.popupMode === 'auto') this.hidePopup();
            this._notifyRunKeyboardOverlayContextChanged();
            return;
        }

        results.forEach((entry, index) => {
            const item = document.createElement('div');
            item.className = 'run-applet-item';
            item.setAttribute('role', 'option');
            if (index === this.selectedIndex) item.classList.add('keyboard-selected');
            if (entry.isNetworkResult || entry.pinnedBottom) {
                item.classList.add('run-applet-item-pinned');
            }

            const catLabel = (window.RUN_CATEGORY_LABELS && window.RUN_CATEGORY_LABELS[entry.category]) || entry.category;
            const hasMenu = !entry.isDeferredNetwork
                && typeof getRunEntryActionItems === 'function'
                && getRunEntryActionItems(entry);
            // the subtitle only when it says more than the category ("Application - Application")
            const subtitle = String(entry.subtitle || '');
            const cat = String(catLabel || '');
            const repeats = !subtitle || subtitle.toLowerCase().includes(cat.toLowerCase()) || cat.toLowerCase().includes(subtitle.toLowerCase());
            const meta = repeats ? (cat || subtitle) : `${cat} - ${subtitle}`;
            item.title = `${entry.label}\n${meta}`;

            item.innerHTML = `
                <span class="run-applet-label">${this.escapeHtml(entry.label)}</span>
                <span class="run-applet-meta">${this.escapeHtml(meta)}</span>
                ${hasMenu ? '<span class="run-applet-menu-hint" title="Right arrow for actions"></span>' : ''}
            `;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                if (e.button !== 0) return;
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
        if (!this.popupDismissed && this.popupMode !== 'history') this.showPopup('auto');
        this._notifyRunKeyboardOverlayContextChanged();
    }

    // ---- the drop-down ----

    showPopup(mode) {
        if (!this.resultsShell) return;
        this.popupMode = mode;
        this.resultsShell.classList.remove('hidden');
        this.resultsShell.classList.toggle('is-history', mode === 'history');
        if (this.combo) this.combo.classList.toggle('is-dropped', mode === 'history');
        this.placePopup();
    }

    hidePopup() {
        if (!this.resultsShell) return;
        if (this.popupMode === 'history') this.closeHistory();
        this.popupMode = null;
        this.resultsShell.classList.add('hidden');
        this.resultsShell.classList.remove('is-history', 'is-above');
        if (this.combo) this.combo.classList.remove('is-dropped');
    }

    /** Under the combo box, or over it when the screen has no room below (Run sits on the taskbar). */
    placePopup() {
        const shell = this.resultsShell;
        if (!shell || !this.combo || !this.popupMode) return;
        const modalRect = this.modal.getBoundingClientRect();
        const comboRect = this.combo.getBoundingClientRect();
        const history = this.popupMode === 'history';
        let rows;
        if (history) {
            rows = Math.max(1, Math.min(this.history.length, 8));
        } else if (this.actionPanelOpen) {
            rows = Math.min(this.actionItems.length + 1, 14);
        } else {
            rows = Math.max(1, this.results.length);
        }
        // the autocomplete list sits on the edit part (3 px in, as wide as the edit), its grip in a row of its own
        const width = (this.popupSize && !history) ? this.popupSize.width
            : history ? comboRect.width : comboRect.width - 23;
        const height = (this.popupSize && !history) ? this.popupSize.height
            : rows * RUN_ROW_PX + (history ? 0 : RUN_ROW_PX) + 2;
        const left = comboRect.left + (history ? 0 : 3);
        const below = history ? comboRect.bottom : comboRect.bottom - 3;
        const above = history ? comboRect.top : comboRect.top + 3;
        const area = typeof getModalWorkAreaBounds === 'function'
            ? getModalWorkAreaBounds()
            : { top: 0, bottom: window.innerHeight };
        const roomBelow = area.bottom - below;
        const roomAbove = above - area.top;
        const flip = height > roomBelow && roomAbove > roomBelow;
        const h = Math.min(height, Math.max(RUN_ROW_PX * 2 + 2, flip ? roomAbove : roomBelow));
        shell.classList.toggle('is-above', flip);
        shell.style.left = `${Math.round(left - modalRect.left)}px`;
        shell.style.top = `${Math.round((flip ? above - h : below) - modalRect.top)}px`;
        shell.style.width = `${Math.round(width)}px`;
        shell.style.height = `${Math.round(h)}px`;
    }

    /** The size grip resizes the autocomplete list (from its bottom right, or top right when it opens upwards). */
    wireGrip(grip) {
        grip.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || !this.resultsShell) return;
            e.preventDefault();
            const shell = this.resultsShell;
            const start = { x: e.clientX, y: e.clientY, w: shell.offsetWidth, h: shell.offsetHeight, top: shell.offsetTop };
            const above = shell.classList.contains('is-above');
            grip.setPointerCapture(e.pointerId);
            const move = (ev) => {
                const width = Math.max(120, start.w + ev.clientX - start.x);
                const dy = ev.clientY - start.y;
                const height = Math.max(RUN_ROW_PX * 2 + 2, above ? start.h - dy : start.h + dy);
                this.popupSize = { width, height };
                shell.style.width = `${width}px`;
                shell.style.height = `${height}px`;
                if (above) shell.style.top = `${start.top + start.h - height}px`;
            };
            const up = () => {
                grip.removeEventListener('pointermove', move);
                grip.removeEventListener('pointerup', up);
                grip.removeEventListener('pointercancel', up);
            };
            grip.addEventListener('pointermove', move);
            grip.addEventListener('pointerup', up);
            grip.addEventListener('pointercancel', up);
        });
    }

    // ---- history (the combo box's list: what was run here before) ----

    loadHistory() {
        try {
            const list = JSON.parse(localStorage.getItem(RUN_HISTORY_KEY) || '[]');
            return Array.isArray(list) ? list.filter((s) => typeof s === 'string' && s.trim()).slice(0, RUN_HISTORY_MAX) : [];
        } catch (_) {
            return [];
        }
    }

    remember(text) {
        const value = String(text || '').trim();
        if (!value) return;
        this.history = [value, ...this.loadHistory().filter((s) => s !== value)].slice(0, RUN_HISTORY_MAX);
        try {
            localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(this.history));
        } catch (_) { /* storage blocked: the list lives for this session */ }
    }

    toggleHistory() {
        if (this.popupMode === 'history') {
            this.hidePopup();
            return;
        }
        this.closeActionPanel();
        this.hidePopup();
        this.history = this.loadHistory();
        this.historyIndex = this.history.indexOf(this.input.value.trim());
        this.renderHistory();
        this.showPopup('history');
    }

    renderHistory() {
        if (!this.suggestionsEl) return;
        this.suggestionsEl.innerHTML = '';
        this.history.forEach((text, index) => {
            const item = document.createElement('div');
            item.className = 'run-applet-item';
            item.setAttribute('role', 'option');
            item.classList.toggle('keyboard-selected', index === this.historyIndex);
            item.innerHTML = `<span class="run-applet-label">${this.escapeHtml(text)}</span>`;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                if (e.button !== 0) return;
                this.pickHistory(index);
            });
            item.addEventListener('mouseenter', () => {
                this.historyIndex = index;
                this.suggestionsEl.querySelectorAll('.run-applet-item').forEach((el, i) => el.classList.toggle('keyboard-selected', i === index));
            });
            this.suggestionsEl.appendChild(item);
        });
    }

    pickHistory(index) {
        const text = this.history[index];
        this.hidePopup();
        if (typeof text !== 'string') return;
        this.input.value = text;
        this.input.select();
        this.handleInput();
    }

    closeHistory() {
        this.historyIndex = -1;
        if (this.suggestionsEl) this.suggestionsEl.innerHTML = '';
        // the results come back when the list closes
        if (this.results.length && this.popupMode === 'history') {
            this.popupMode = null;
            this.renderSuggestions(this.results);
        }
    }

    handleHistoryKeydown(e) {
        if (e.key === 'Escape' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) {
            e.preventDefault();
            this.hidePopup();
            return true;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!this.history.length) return true;
            const step = e.key === 'ArrowDown' ? 1 : -1;
            this.historyIndex = Math.max(0, Math.min(this.history.length - 1, this.historyIndex + step));
            this.suggestionsEl.querySelectorAll('.run-applet-item').forEach((el, i) => {
                el.classList.toggle('keyboard-selected', i === this.historyIndex);
                if (i === this.historyIndex && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
            });
            return true;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (this.historyIndex >= 0) this.pickHistory(this.historyIndex);
            else this.hidePopup();
            return true;
        }
        return false;
    }

    // ---- buttons ----

    /** OK / Enter: the selected result; Vista's message box when nothing matches what was typed. */
    confirm() {
        const query = this.input.value.trim();
        if (!query) return;
        const settled = !this.searchTimeout && this.lastSearchQuery === query;
        if (!settled) {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = null;
            this.confirmPending = true;
            this.runSearch(this.input.value);
            return;
        }
        if (this.results.length) {
            this.executeSelected();
            return;
        }
        this.showNotFound(query);
    }

    showNotFound(query) {
        this.hidePopup();
        if (typeof showConfirmationDialog !== 'function') return;
        // public/scripts/comp/confirmationDialog.js; vistaDialogs.js draws it as an error message box
        showConfirmationDialog(
            `Melaton cannot find '${query}'. Make sure you typed the name correctly, and then try again.`,
            [{ text: 'OK', value: true, className: 'btn-standard primary' }],
            null,
            { title: query, icon: 'fas fa-circle-xmark' }
        ).then(() => {
            if (!this.isOpen) return;
            this.input.focus();
            this.input.select();
        });
    }

    async browse() {
        this.close();
        try {
            // openExplorerApplet: public/scripts/comp/featureLoader.js (loads Cartograph)
            if (typeof openExplorerApplet === 'function') await openExplorerApplet();
        } catch (err) {
            console.error('Run browse failed:', err);
        }
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

    wireKeyboardHandler() {
        if (this._keyboardHandlerWired) return;
        this._keyboardHandlerWired = true;
        this.wireKeyboardOverlayEntries();
        // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        registerKeyboardListener({
            id: 'runModal.keydown',
            handler: (e) => this.handleKeydown(e),
            type: 'whenFocused',
            modalId: 'runModal',
            priority: 70,
            // a key Run handles stops there: the global Esc (priority 60) would blur the Open box
            critical: true,
            showInOverlay: false
        });
    }

    wireKeyboardOverlayEntries() {
        if (this._keyboardOverlayWired) return;
        this._keyboardOverlayWired = true;
        // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        const runOverlayEntries = [
            { id: 'overlay.runModal.close', label: 'Close', keys: 'Esc', icon: 'fas fa-times' },
            { id: 'overlay.runModal.down', label: 'Next result', keys: '↓', icon: 'fas fa-chevron-down', overlayValid: () => this._runOverlayResultsNavValid() },
            { id: 'overlay.runModal.up', label: 'Previous result', keys: '↑', icon: 'fas fa-chevron-up', overlayValid: () => this._runOverlayResultsNavValid() },
            { id: 'overlay.runModal.enter', label: 'Run command', keys: 'Enter', icon: 'fas fa-play', overlayValid: () => this._runOverlayResultsNavValid() },
            { id: 'overlay.runModal.actions', label: 'Actions panel', keys: '→', icon: 'fas fa-bolt', overlayValid: () => this._runOverlayActionsEntryValid() },
            { id: 'overlay.runModal.actionsBack', label: 'Back to results', keys: 'Esc / ←', icon: 'fas fa-arrow-left', overlayValid: () => this.actionPanelOpen },
            { id: 'overlay.runModal.history', label: 'Previous commands', keys: 'F4', icon: 'fas fa-clock-rotate-left', overlayValid: () => !this.actionPanelOpen }
        ];
        runOverlayEntries.forEach((entry) => {
            registerKeyboardListener({
                id: entry.id,
                type: 'whenFocused',
                modalId: 'runModal',
                label: entry.label,
                keys: entry.keys,
                overlayIcon: entry.icon,
                overlayGroup: 'Run',
                overlayValid: typeof entry.overlayValid === 'function' ? entry.overlayValid : null,
                overlayOnly: true,
                priority: -10
            });
        });
    }

    _runOverlayResultsNavValid() {
        return !this.actionPanelOpen && this.results.length > 0;
    }

    _runOverlayActionsEntryValid() {
        if (this.actionPanelOpen || !this.results.length) return false;
        const entry = this.results[this.selectedIndex >= 0 ? this.selectedIndex : 0];
        if (!entry || entry.isDeferredNetwork) return false;
        return typeof getRunEntryActionItems === 'function' && !!getRunEntryActionItems(entry);
    }

    _notifyRunKeyboardOverlayContextChanged() {
        // notifyKeyboardOverlayContextChanged: public/scripts/comp/modalKeyboardRegistry.js
        notifyKeyboardOverlayContextChanged();
    }

    handleKeydown(e) {
        // one keydown is handled once (the registry can reach this listener twice for Esc)
        if (e._runAppletHandled) return true;
        e._runAppletHandled = true;
        // Alt shows the access keys; Alt+O is the Open box, Alt+B Browse...
        if (e.key === 'Alt') {
            this.modal.classList.add('run-applet-cues');
            return;
        }
        if (e.altKey && !e.ctrlKey && (e.key === 'o' || e.key === 'O')) {
            e.preventDefault();
            this.modal.classList.add('run-applet-cues');
            this.input.focus();
            this.input.select();
            return true;
        }
        if (e.altKey && !e.ctrlKey && (e.key === 'b' || e.key === 'B')) {
            e.preventDefault();
            this.browse();
            return true;
        }

        if (this.popupMode === 'history') {
            if (this.handleHistoryKeydown(e)) return true;
        }

        if (this.actionPanelOpen) {
            this.handleActionPanelKeydown(e);
            return;
        }

        if (e.key === 'F4' || (e.altKey && e.key === 'ArrowDown')) {
            e.preventDefault();
            this.toggleHistory();
            return true;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            // the first Esc closes the drop-down, the next one the dialog
            if (this.popupMode) {
                this.popupDismissed = true;
                this.hidePopup();
            } else {
                this.close();
            }
            return true;
        }
        if (e.key === 'ArrowRight' && this.popupMode === 'auto') {
            const entry = this.results[this.selectedIndex];
            if (entry && !entry.isDeferredNetwork && typeof getRunEntryActionItems === 'function') {
                const actionData = getRunEntryActionItems(entry);
                if (actionData) {
                    e.preventDefault();
                    this.openActionPanel(entry, actionData);
                    return true;
                }
            }
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            this.disableMouseNav();
            if (this.results.length) {
                if (this.popupMode !== 'auto') {
                    this.popupDismissed = false;
                    this.renderSuggestions(this.results);
                }
                if (this.selectedIndex < 0) this.selectedIndex = 0;
                else if (e.key === 'ArrowDown') this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
                else this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
                this.syncSelectedEntryId();
                this.updateSelectionHighlight();
                this.scrollSelectedIntoView();
            }
            return true;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            // Enter on a focused Cancel / Browse... button presses that button
            const focusedAction = document.activeElement && document.activeElement.dataset
                ? document.activeElement.dataset.runAction : null;
            if (focusedAction && focusedAction !== 'ok') {
                document.activeElement.click();
                return true;
            }
            this.confirm();
            return true;
        }
    }

    handleActionPanelKeydown(e) {
        if (e.key === 'Escape' || e.key === 'ArrowLeft') {
            e.preventDefault();
            this.closeActionPanel();
            return true;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = this.findNextActionableIndex(this.actionSelectedIndex, 1);
            if (next >= 0) {
                this.actionSelectedIndex = next;
                this.renderActionPanel();
            }
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = this.findNextActionableIndex(this.actionSelectedIndex, -1);
            if (prev >= 0) {
                this.actionSelectedIndex = prev;
                this.renderActionPanel();
            }
            return true;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            this.executeActionPanelSelection();
            return true;
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
        this.placePopup();
        this._notifyRunKeyboardOverlayContextChanged();
    }

    closeActionPanel() {
        const wasOpen = this.actionPanelOpen;
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
        if (wasOpen) {
            this.placePopup();
            this._notifyRunKeyboardOverlayContextChanged();
        }
    }

    renderActionPanel() {
        if (!this.actionPanelEl || !this.actionEntry) return;
        const backLabel = this.escapeHtml(this.actionEntry.label);
        let html = `<div class="run-applet-action-header">
            <button type="button" class="run-applet-action-back" tabindex="-1" title="Back" aria-label="Back"></button>
            <span class="run-applet-action-title">${backLabel}</span>
        </div>`;
        html += '<div class="run-applet-action-list">';
        this.actionItems.forEach((item, index) => {
            if (item.separator) return;
            if (item.header) {
                html += `<div class="run-applet-action-section-label">${this.escapeHtml(item.text || '')}</div>`;
                return;
            }
            const selected = index === this.actionSelectedIndex ? ' keyboard-selected' : '';
            const disabled = item.disabled ? ' is-disabled' : '';
            html += `<div class="run-applet-item run-applet-action-item${selected}${disabled}" data-action-index="${index}">
                <span class="run-applet-label">${this.escapeHtml(item.text)}</span>
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
        this.remember(this.input.value);
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
        const items = this.suggestionsEl.querySelectorAll('.run-applet-item');
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
                this.popupDismissed = false;
                this.renderSuggestions(this.results);
            });
            return;
        }

        if (typeof entry.execute !== 'function') return;

        const refocusTarget = entry.refocusTarget || null;
        this.remember(this.input.value);
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
