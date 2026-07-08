// Character Autofill Tool Window — detached autofill panel linked to prompt editor
// Session/render logic: public/scripts/comp/autocompleteUtils.js

function getAutofillToolPromptFieldLabel(textarea) {
    const id = textarea?.id || '';
    if (id === 'manualPrompt') return 'Main Prompt';
    if (id === 'manualUc') return 'UC';
    if (id === 'manualPromptNegative') return 'Inline Negative';
    if (id.endsWith('_prompt')) return 'Character Prompt';
    if (id.endsWith('_uc')) return 'Character UC';
    if (id.endsWith('_promptNegative')) return 'Character Negative';
    if (textarea?.closest?.('.creative-directive-container')) return 'Creative Directive';
    return id || 'Prompt';
}

class CharacterAutofillToolManager {
    constructor() {
        this.element = null;
        this.shellEl = null;
        this.listShellEl = null;
        this.searchInputEl = null;
        this.detached = false;
        this.linkedTextarea = null;
        this.insertTarget = null;
        this.lookupMode = false;
        this.isHovered = false;
        this.isInteracted = false;
        this._interactTimer = null;
        this._wired = false;
        this._outsideMouseClearWired = false;
        this._keydownListenerRegistered = false;
        this._boundDetachedToolKeydown = null;
        this._searchInputTimer = null;
    }

    init() {
        this.element = document.getElementById('characterAutofillTool');
        if (!this.element) return;
        this.shellEl = this.element.querySelector('.character-autofill-tool-shell');
        this.listShellEl = this.element.querySelector('.character-autofill-tool-list-shell');
        this.searchInputEl = document.getElementById('characterAutofillToolSearch');
        this._wireShell();
        this._wireSearchInput();
    }

    _handleDetachedToolKeydown(e) {
        if (!this.isDetachedActive()) return false;
        if (!this.isInteractionActive()) return false;
        if (this._isSearchInputTarget(document.activeElement)) return false;
        const routeTarget = currentCharacterAutocompleteTarget || this.getInsertTarget() || this.linkedTextarea;
        if (!routeTarget) return false;
        if (document.activeElement === routeTarget) return false;
        // isCharacterAutocompleteOverlayOpen: public/scripts/comp/autocompleteUtils.js
        if (!isCharacterAutocompleteOverlayOpen()) return false;
        // isAutofillRoutedKeydown: public/scripts/comp/autocompleteUtils.js
        if (!isAutofillRoutedKeydown(e)) return false;
        e.preventDefault();
        e.stopPropagation();
        const proxied = new Proxy(e, {
            get(target, prop) {
                if (prop === 'target') return routeTarget;
                const val = target[prop];
                return typeof val === 'function' ? val.bind(target) : val;
            }
        });
        routeTarget.focus({ preventScroll: true });
        // handleCharacterAutocompleteKeydown: public/scripts/comp/autocompleteUtils.js
        handleCharacterAutocompleteKeydown(proxied);
        return true;
    }

    _registerDetachedKeydownListener() {
        if (!this._boundDetachedToolKeydown) {
            this._boundDetachedToolKeydown = (e) => this._handleDetachedToolKeydown(e);
        }
        if (this._keydownListenerRegistered) return;
        // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        registerKeyboardListener({
            id: 'characterAutofillTool.keydown',
            handler: this._boundDetachedToolKeydown,
            type: 'whenOpen',
            modalId: 'characterAutofillTool',
            priority: 76,
            critical: true,
            showInOverlay: false
        });
        this._keydownListenerRegistered = true;
    }

    _unregisterDetachedKeydownListener() {
        if (!this._keydownListenerRegistered) return;
        // deregisterKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        deregisterKeyboardListener('characterAutofillTool.keydown');
        this._keydownListenerRegistered = false;
    }

    _isSearchInputTarget(target) {
        return !!(target && this.searchInputEl && (target === this.searchInputEl || this.searchInputEl.contains(target)));
    }

    _wireShell() {
        if (this._wired || !this.shellEl) return;

        const closeBtn = this.element.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeFromUser());
        }

        this.element.addEventListener('mousedown', (e) => {
            if (this._isSearchInputTarget(e.target)) return;
            if (e.target.closest('.modal-window-title-toolbar')) return;
            e.preventDefault();
            this.markInteracted();
        });

        this.shellEl.addEventListener('mousedown', (e) => {
            if (this._isSearchInputTarget(e.target)) return;
            e.preventDefault();
            this.markInteracted();
        });
        this.shellEl.addEventListener('mouseenter', () => {
            // isAutofillToolMouseInteractionAllowed: public/scripts/comp/autocompleteUtils.js
            if (typeof isAutofillToolMouseInteractionAllowed === 'function' && !isAutofillToolMouseInteractionAllowed()) {
                return;
            }
            this.isHovered = true;
        });
        this.shellEl.addEventListener('mouseleave', () => {
            this.isHovered = false;
        });
        this.shellEl.addEventListener('mousemove', () => {
            if (typeof isAutofillToolMouseInteractionAllowed === 'function' && !isAutofillToolMouseInteractionAllowed()) {
                this.clearMouseInteractionState();
            }
        });
        this.shellEl.addEventListener('wheel', (e) => {
            // handleAutocompleteOverlayWheel: public/scripts/comp/autocompleteUtils.js
            if (typeof handleAutocompleteOverlayWheel === 'function') {
                handleAutocompleteOverlayWheel(e);
            }
        }, { passive: false });

        this._wired = true;

        if (!this._outsideMouseClearWired) {
            this._outsideMouseClearWired = true;
            document.addEventListener('mousedown', (e) => {
                if (!this.isDetachedActive() || !this.element) return;
                if (this.element.contains(e.target)) return;
                this.clearMouseInteractionState();
            }, true);
        }
    }

    _wireSearchInput() {
        if (!this.searchInputEl) return;

        this.searchInputEl.addEventListener('focus', () => {
            // enterAutofillToolLookupMode: public/scripts/comp/autocompleteUtils.js
            if (typeof enterAutofillToolLookupMode === 'function') {
                enterAutofillToolLookupMode();
            }
            setTimeout(() => {
                // syncAutofillToolWindowActiveState: public/scripts/comp/autocompleteUtils.js
                if (typeof syncAutofillToolWindowActiveState === 'function') {
                    syncAutofillToolWindowActiveState();
                }
            }, 0);
        });

        this.searchInputEl.addEventListener('blur', () => {
            setTimeout(() => {
                // syncAutofillToolWindowActiveState: public/scripts/comp/autocompleteUtils.js
                if (typeof syncAutofillToolWindowActiveState === 'function') {
                    syncAutofillToolWindowActiveState();
                }
            }, 0);
        });

        this.searchInputEl.addEventListener('input', () => {
            if (this._searchInputTimer) clearTimeout(this._searchInputTimer);
            this._searchInputTimer = setTimeout(() => {
                this._searchInputTimer = null;
                // triggerAutofillToolSearchFromInput: public/scripts/comp/autocompleteUtils.js
                if (typeof triggerAutofillToolSearchFromInput === 'function') {
                    triggerAutofillToolSearchFromInput(this.searchInputEl.value);
                }
            }, 120);
        });

        this.searchInputEl.addEventListener('keydown', (e) => {
            // handleAutofillToolSearchInputKeydown: public/scripts/comp/autocompleteUtils.js
            if (typeof handleAutofillToolSearchInputKeydown === 'function') {
                handleAutofillToolSearchInputKeydown(e);
            }
        });

        const searchBtn = document.getElementById('characterAutofillToolSearchBtn');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                if (this._searchInputTimer) {
                    clearTimeout(this._searchInputTimer);
                    this._searchInputTimer = null;
                }
                // triggerAutofillToolSearchFromInput: public/scripts/comp/autocompleteUtils.js
                if (typeof triggerAutofillToolSearchFromInput === 'function') {
                    triggerAutofillToolSearchFromInput(this.searchInputEl?.value);
                }
            });
        }
    }

    isDetachedActive() {
        return this.detached && this.element && !this.element.classList.contains('hidden');
    }

    isInteractionActive() {
        if (!this.isDetachedActive()) return false;
        // isAutofillToolMouseInteractionAllowed: public/scripts/comp/autocompleteUtils.js
        const foreground = typeof isAutofillToolMouseInteractionAllowed !== 'function'
            || isAutofillToolMouseInteractionAllowed();
        if (!foreground) return false;
        if (this._isSearchInputTarget(document.activeElement)) return true;
        return this.isHovered || this.isInteracted;
    }

    clearMouseInteractionState() {
        this.isHovered = false;
        this.isInteracted = false;
        if (this._interactTimer) {
            clearTimeout(this._interactTimer);
            this._interactTimer = null;
        }
    }

    isLookupMode() {
        return this.lookupMode;
    }

    markInteracted() {
        this.isInteracted = true;
        if (this._interactTimer) {
            clearTimeout(this._interactTimer);
        }
        this._interactTimer = setTimeout(() => {
            this.isInteracted = false;
            this._interactTimer = null;
        }, 900);
    }

    getShellElement() {
        return this.shellEl;
    }

    getLinkedTextarea() {
        return this.linkedTextarea;
    }

    getInsertTarget() {
        return this.insertTarget || this.linkedTextarea;
    }

    setInsertTarget(textarea) {
        if (textarea && typeof isAutofillTarget === 'function' && isAutofillTarget(textarea)) {
            this.insertTarget = textarea;
        }
    }

    setLookupMode(enabled) {
        this.lookupMode = !!enabled;
    }

    getSearchInputEl() {
        if (!this.searchInputEl) {
            this.searchInputEl = document.getElementById('characterAutofillToolSearch');
        }
        return this.searchInputEl;
    }

    syncSearchInputFromQuery(query, options = {}) {
        const input = this.getSearchInputEl();
        if (!input) return;
        if (this.lookupMode && !options.force) {
            if (document.activeElement === input) return;
        }
        const next = query == null ? '' : String(query);
        if (input.value !== next) {
            input.value = next;
        }
    }

    focusSearchInput() {
        if (!this.searchInputEl) return;
        this.searchInputEl.focus({ preventScroll: true });
        this.searchInputEl.select();
    }

    updateTitle(textarea) {
        const titleEl = this.element?.querySelector('[data-autofill-tool-title]');
        if (!titleEl) return;
        if (this.lookupMode) {
            titleEl.textContent = 'SmartText [Flywheel]';
            return;
        }
        titleEl.textContent = `SmartText [${getAutofillToolPromptFieldLabel(textarea)}]`;
    }

    _mountPanelDom() {
        const overlay = document.getElementById('characterAutocompleteOverlay');
        const list = overlay?.querySelector('.character-autocomplete-list');
        const keyguide = document.getElementById('characterAutocompleteKeyguide');
        const listHost = this.listShellEl || this.shellEl;
        if (!list || !keyguide || !listHost || !this.shellEl) return false;

        listHost.appendChild(list);
        this.shellEl.appendChild(keyguide);
        this.shellEl.classList.add('detached-tool-active');
        if (overlay) {
            overlay.classList.add('hidden');
        }
        return true;
    }

    _openWindow(textarea, options = {}) {
        if (!this._mountPanelDom()) return false;

        this.detached = true;
        this._registerDetachedKeydownListener();
        if (textarea) {
            this.linkedTextarea = textarea;
            this.setInsertTarget(textarea);
        }

        this.updateTitle(textarea || this.insertTarget);

        const manualModal = document.getElementById('manualModal');
        if (manualModal && linkToolWindowToParent) {
            linkToolWindowToParent(this.element, manualModal);
        }

        if (!this.isDetachedActive()) {
            openModal(this.element);
        }

        setTimeout(() => {
            if (options.focusSearch) {
                this.setLookupMode(true);
                this.updateTitle(null);
                this.focusSearchInput();
            } else if (options.lookup) {
                this.setLookupMode(true);
                this.updateTitle(null);
            } else {
                this.setLookupMode(false);
            }
            // ensureAutofillDetachedExpanded: public/scripts/comp/autocompleteUtils.js
            if (typeof ensureAutofillDetachedExpanded === 'function') {
                ensureAutofillDetachedExpanded();
            }
            const scrollHost = this.listShellEl || this.shellEl;
            if (scrollHost && customScrollbar?.forceReinit) {
                customScrollbar.forceReinit(scrollHost);
            }
            if (options.focusSearch) {
                this.focusSearchInput();
            }
        }, 0);

        return true;
    }

    open(textarea, options = {}) {
        if (this.isDetachedActive()) {
            if (textarea) {
                this.linkedTextarea = textarea;
                this.setInsertTarget(textarea);
                this.updateTitle(textarea);
            }
            if (options.focusSearch) {
                this.setLookupMode(true);
                this.updateTitle(null);
                this.focusSearchInput();
            } else {
                // syncAutofillToolSearchInput: public/scripts/comp/autocompleteUtils.js
                if (typeof syncAutofillToolSearchInput === 'function') {
                    syncAutofillToolSearchInput(true);
                }
            }
            // ensureDetachedAutofillListComplete: public/scripts/comp/autocompleteUtils.js
            if (typeof ensureDetachedAutofillListComplete === 'function') {
                ensureDetachedAutofillListComplete();
            }
            return true;
        }
        return this._openWindow(textarea, options);
    }

    detach(textarea) {
        if (!textarea) return false;
        this.setLookupMode(false);
        return this._openWindow(textarea, { lookup: false });
    }

    reattach() {
        const overlay = document.getElementById('characterAutocompleteOverlay');
        const list = this.listShellEl?.querySelector('.character-autocomplete-list')
            || this.shellEl?.querySelector('.character-autocomplete-list');
        const keyguide = this.shellEl?.querySelector('#characterAutocompleteKeyguide')
            || document.getElementById('characterAutocompleteKeyguide');

        if (overlay && list && list.parentElement !== overlay) {
            overlay.insertBefore(list, overlay.firstChild || null);
        }
        if (overlay && keyguide && keyguide.parentElement !== overlay) {
            overlay.appendChild(keyguide);
        }

        this.shellEl?.classList.remove('detached-tool-active');
        this.detached = false;
        this._unregisterDetachedKeydownListener();
        this.linkedTextarea = null;
        this.insertTarget = null;
        this.lookupMode = false;
        this.isHovered = false;
        this.isInteracted = false;
        // relocateAutofillSearchStatusForMode: public/scripts/comp/autocompleteUtils.js
        if (typeof relocateAutofillSearchStatusForMode === 'function') {
            relocateAutofillSearchStatusForMode();
        }
    }

    closeFromUser() {
        if (!this.element) return;
        // closeAutofillToolWindowFromUser: public/scripts/comp/autocompleteUtils.js
        if (typeof closeAutofillToolWindowFromUser === 'function') {
            closeAutofillToolWindowFromUser();
            return;
        }
        this.reattach();
        closeModal(this.element);
    }

    close() {
        this.closeFromUser();
    }
}

const characterAutofillToolManager = new CharacterAutofillToolManager();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => characterAutofillToolManager.init());
} else {
    characterAutofillToolManager.init();
}
