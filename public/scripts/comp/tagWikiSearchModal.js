// Tag Wiki Search Modal
// Handles searching and displaying tag wiki pages

const DREAMWIKI_RECENT_STORAGE_KEY = 'dreamWikiRecentPages';
const DREAMWIKI_RECENT_MAX = 20;
const GRIMOIRE_RIGHT_PANE_LS = 'grimoireRightPaneState';
const GRIMOIRE_ONLINE_SEARCH_LS = 'grimoireIncludeOnlineSearch';
const GRIMOIRE_SPLIT_PANEL_LS = 'grimoireSplitPanelEnabled';
const GRIMOIRE_SPLIT_MIN_WIDTH = 1024; // min width to auto-enable practical split (dual pane) UI even without maximize

function isGrimoireEditableShortcutTarget(el) {
    if (!el || el === document.body) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
        const type = (el.type || 'text').toLowerCase();
        return type !== 'button' && type !== 'submit' && type !== 'checkbox' && type !== 'radio' && type !== 'range';
    }
    if (el.isContentEditable) return true;
    return false;
}
const TAG_WIKI_MAX_HISTORY = 100;

function capTagWikiHistoryEntries(history, historyIndex) {
    if (!Array.isArray(history) || history.length <= TAG_WIKI_MAX_HISTORY) {
        return { history, historyIndex };
    }
    const trimCount = history.length - TAG_WIKI_MAX_HISTORY;
    return {
        history: history.slice(trimCount),
        historyIndex: Math.max(0, (historyIndex || 0) - trimCount)
    };
}

function dreamWikiRecentRead() {
    try {
        const raw = localStorage.getItem(DREAMWIKI_RECENT_STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) return [];
        return arr.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
    } catch (e) {
        return [];
    }
}

function dreamWikiRecentAppend(tagName) {
    const t = String(tagName || '').trim();
    if (!t) return;
    let list = dreamWikiRecentRead().filter((x) => x.toLowerCase() !== t.toLowerCase());
    list.unshift(t);
    if (list.length > DREAMWIKI_RECENT_MAX) {
        list = list.slice(0, DREAMWIKI_RECENT_MAX);
    }
    try {
        localStorage.setItem(DREAMWIKI_RECENT_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
        /* quota / private mode */
    }
}

// Shared Wiki Display functionality - base class for wiki display features
class WikiDisplayBase {
    constructor() {
        this.displayArea = null;
        this.currentSelectedTag = null;
        this.currentSource = 'both';
        this.contextMenuElements = [];
        this.currentFetchedOnline = false;
        this.currentTagName = null;
        this.currentStaticWiki = null;
    }

    // Base setAddress: for standalone windows, update the window title to reflect the current pseudo-URL/path.
    // The full layered bar + protocol logic lives on TagWikiSearchModal for the main browser.
    setAddress({ displayUrl, fullUrl, mode } = {}) {
        const url = displayUrl || fullUrl || '';
        if (!url) return;
        // Store for cross-pane address bar syncing when this pane is the active one
        this._currentAddress = { displayUrl: url, fullUrl: fullUrl || url, mode: mode || 'edtx' };

        // If this is a standalone wiki window instance, reflect the address in its title bar
        if (this.modal && this.modal.classList.contains('wiki-page-viewer-modal')) {
            const titleEl = this.modal.querySelector('.modal-window-title-main span');
            if (titleEl) {
                // Show clean path; icon in window title already indicates type
                titleEl.textContent = url.replace(/^(edtx|rdf|dsap):\/\//i, '');
            }
            return;
        }
        // For other base users (split panes etc.), no-op (main Grimoire overrides with full bar logic)
    }

    // No-op by default for WikiDisplayBase users (WikiWindowInstance standalone viewers,
    // GrimoireSplitPane, etc.). The main TagWikiSearchModal (which owns the layered address bar)
    // overrides this with the spinner / .nav-loading / path-hint implementation.
    setNavigationLoading(loading) {
        // Intentionally empty for standalone / base cases.
    }

    // Robust link interception for any content rendered into displayArea.
    // Prevents links/anchors from "exiting the application" (following real hrefs or causing full nav).
    // Called after innerHTML sets for wiki content, search pages, lookup pages, etc.
    _interceptAllLinks() {
        if (!this.displayArea) return;
        const area = this.displayArea;

        // 1. General safe external links (force new tab, noopener)
        area.querySelectorAll('a[href]').forEach(a => {
            const href = (a.getAttribute('href') || '').trim();
            if (!href || a.dataset.pseudoHandled) return;
            a.dataset.pseudoHandled = '1';

            if (/^https?:\/\//i.test(href)) {
                // In-app tag wiki links are handled by setupLinkHandlers (verify before navigate)
                if (a.classList.contains('tag-wiki-link')) {
                    return;
                }
                if (!a.hasAttribute('target')) a.setAttribute('target', '_blank');
                const rel = (a.getAttribute('rel') || '').toLowerCase();
                if (!rel.includes('noopener')) {
                    a.setAttribute('rel', (a.getAttribute('rel') || '') + ' noopener noreferrer');
                }
                // For DSAP contexts, show leave warning dialog instead of silent new tab
                a.addEventListener('click', (e) => {
                    if (this._dsapActive) {
                        e.preventDefault();
                        this.showLeaveDSAPDialog(href, a);
                    }
                    // else let the target=_blank happen
                }, { once: true });
                return;
            }

            // 2. Anchor links inside current content - scroll smoothly, no nav
            // Catches both classed DText anchors and plain <a href="#...">
            if (href.startsWith('#')) {
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    const id = href.slice(1).trim();
                    if (!id) {
                        // bare # or invalid - scroll to top of content area
                        area.scrollTop = 0;
                        return;
                    }
                    this.scrollToWikiAnchor(id);
                });
                return;
            }

            // 3. Pseudo-browser internal links (protocols or known domains) - route through navigate
            // resolveDsap, isDsapPseudoUrl: public/scripts/comp/dsapRegistry.js
            if (/^(edtx|rdf|dsap):\/\//i.test(href) ||
                (typeof isDsapPseudoUrl === 'function' && isDsapPseudoUrl(href)) ||
                /en\.grimoire\.jp|wiki\.(danbooru|e621)\.(jp|com)|docs\.novelai\.jp/i.test(href)) {
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (typeof this.navigate === 'function') {
                        this.navigate(href);
                    } else if (window.tagWikiSearchModal && typeof window.tagWikiSearchModal.navigate === 'function') {
                        window.tagWikiSearchModal.navigate(href);
                    }
                });
            }
        });

        // Also run the original specialized setup for wiki content (classes from DText)
        if (typeof this.setupLinkHandlers === 'function') {
            try { this.setupLinkHandlers(); } catch(e) {}
        }
    }
    
    getDisplayText() {
        if (!this.displayArea) return '';
        const pageContent = this.displayArea.querySelector('.tag-wiki-page');
        if (pageContent) {
            return pageContent.innerText || pageContent.textContent || '';
        }
        return this.displayArea.innerText || this.displayArea.textContent || '';
    }

    // Show warning dialog when clicking external link while inside a DSAP
    showLeaveDSAPDialog(href, linkEl) {
        const dialog = document.createElement('div');
        dialog.style.cssText = 'position:fixed;z-index:999999;top:50%;left:50%;transform:translate(-50%,-50%);background:#f0f0f0;border:2px solid #003366;padding:14px;min-width:300px;box-shadow:0 6px 20px rgba(0,0,0,0.35);font-family:Arial,Helvetica,sans-serif;font-size:10pt;';
        const grimoireHost = window.tagWikiSearchModal;
        const wide = (grimoireHost && typeof grimoireHost.isWideEnoughForSplit === 'function' && grimoireHost.isWideEnoughForSplit())
            || (this.isWideEnoughForSplit && this.isWideEnoughForSplit());
        const rightVisible = (grimoireHost && grimoireHost.modal && grimoireHost.modal.classList.contains('tag-wiki-split-active'))
            || (this.rightPaneEl && !this.rightPaneEl.classList.contains('hidden'));
        dialog.innerHTML = `
            <div style="margin-bottom:10px;font-weight:bold;color:#003366;">Leave DSAP?</div>
            <div style="margin-bottom:14px;line-height:1.3;">This link will leave the currently open DSAP.</div>
            <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">
                <button type="button" data-act="new" style="padding:4px 10px;background:#c0c0c0;border:1px solid #ff8c00;border-radius:3px;font-size:9pt;cursor:pointer;">Open in New Window</button>
                ${ (wide || rightVisible) ? `<button type="button" data-act="right" style="padding:4px 10px;background:#c0c0c0;border:1px solid #ff8c00;border-radius:3px;font-size:9pt;cursor:pointer;">Open in Right Side</button>` : '' }
                <button type="button" data-act="cancel" style="padding:4px 10px;background:#d4d0c8;border:1px solid #666;border-radius:3px;font-size:9pt;cursor:pointer;">Cancel</button>
            </div>
        `;
        document.body.appendChild(dialog);

        const cleanup = () => { if (dialog.parentNode) dialog.parentNode.removeChild(dialog); };

        dialog.querySelectorAll('button').forEach(b => {
            b.addEventListener('click', () => {
                const act = b.dataset.act;
                if (act === 'new') {
                    window.open(href, '_blank', 'noopener,noreferrer');
                } else if (act === 'right') {
                    const host = grimoireHost || this;
                    if (host && typeof host.showRightPane === 'function') {
                        host.showRightPane();
                    }
                    const rightPane = host.rightPane || this.rightPane;
                    if (rightPane && typeof rightPane.navigate === 'function') {
                        rightPane.navigate(href);
                        if (host.setActivePane) host.setActivePane('right');
                    } else {
                        window.open(href, '_blank', 'noopener,noreferrer');
                    }
                }
                cleanup();
            });
        });

        // click backdrop to cancel
        setTimeout(() => {
            document.addEventListener('click', function onDoc(e) {
                if (!dialog.contains(e.target)) {
                    cleanup();
                    document.removeEventListener('click', onDoc);
                }
            }, { once: true });
        }, 0);
    }

    showRightPane() {
        if (!this.rightPaneEl || !this.splitDividerEl || !this.modal) return;
        this.modal.classList.add('tag-wiki-split-active');
        this.rightPaneEl.classList.remove('hidden');
        this.splitDividerEl.classList.remove('hidden');
        if (typeof this.checkAndUpdateSplitMode === 'function') {
            setTimeout(() => this.checkAndUpdateSplitMode(), 30);
        }
    }

    hideRightPane() {
        if (!this.rightPaneEl || !this.splitDividerEl || !this.modal) return;
        this.modal.classList.remove('tag-wiki-split-active');
        this.rightPaneEl.classList.add('hidden');
        this.splitDividerEl.classList.add('hidden');
    }

    toggleRightPane() {
        if (!this.modal || !this.rightPaneEl) return;
        const isActive = this.modal.classList.contains('tag-wiki-split-active');
        if (isActive) {
            this.hideRightPane();
        } else {
            this.showRightPane();
        }
    }

    _notifyGrimoireKeyboardOverlayContextChanged() {
        // TagWikiSearchModal overrides — public/scripts/comp/tagWikiSearchModal.js
    }
    
    setupLinkContextMenu(link) {
        // Setup context menu for a tag wiki link using existing context menu system
        if (!link || !contextMenu) return;
        
        const tagName = link.dataset.tagName;
        if (!tagName) return;
        
        const linkMenuConfig = {
            sections: [
                {
                    type: 'icons',
                    icons: [
                        {
                            tooltip: 'Copy Tag',
                            icon: 'fas fa-copy',
                            action: 'wiki-link-copy'
                        },
                        {
                            tooltip: 'Add to Favorites',
                            icon: 'fas fa-star',
                            action: 'wiki-link-add-to-favorites'
                        }
                    ]
                },
                {
                    type: 'list',
                    items: [
                        {
                            text: 'New Window',
                            icon: 'fas fa-window-restore',
                            action: 'wiki-link-open-new-window'
                        },
                        {
                            text: 'Open on Right',
                            icon: 'fas fa-arrow-right',
                            action: 'wiki-link-open-on-right',
                            hidden: () => {
                                const host = window.tagWikiSearchModal;
                                return !host || typeof host.isWideEnoughForSplit !== 'function' || !host.isWideEnoughForSplit()
                                    || host.isRightPaneDisplay(this.displayArea);
                            }
                        },
                        {
                            text: 'Open on Left',
                            icon: 'fas fa-arrow-left',
                            action: 'wiki-link-open-on-left',
                            hidden: () => {
                                const host = window.tagWikiSearchModal;
                                return !host || typeof host.isSplitMode !== 'function' || !host.isSplitMode()
                                    || !host.isRightPaneDisplay(this.displayArea);
                            }
                        },
                        { separator: true },
                        {
                            text: 'Add to Prompt',
                            icon: 'fas fa-plus',
                            action: 'wiki-link-add-to-prompt',
                            disabled: () => manualModal.classList.contains('hidden')
                        },
                        {
                            text: 'Add Reference',
                            icon: 'fas fa-bookmark',
                            action: 'wiki-link-add-reference',
                            disabled: () => !this.isDirectiveAvailable()
                        },
                        {
                            text: 'PhaseWalker',
                            icon: 'fas fa-layer-group',
                            openOnHover: true,
                            optionsfn: () => this.buildWikiPhasewalkerSubmenuItems(tagName),
                            handlerfn: (subItem) => this.handleWikiPhasewalkerSubmenuAction(subItem)
                        },
                        {
                            text: 'Add to Desktop',
                            icon: 'fas fa-arrow-down-left',
                            action: 'wiki-link-add-to-desktop'
                        }
                    ]
                }
            ],
            onAction: (action, target, item) => {
                if (action === 'wiki-link-copy') {
                    this.copyToClipboard(tagName);
                } else if (action === 'wiki-link-add-to-favorites') {
                    // showAddToFavoritesDialog: public/scripts/comp/autocompleteUtils.js
                    if (showAddToFavoritesDialog) {
                        showAddToFavoritesDialog(tagName);
                    }
                } else if (action === 'wiki-link-add-to-prompt') {
                    this.addToPrompt(tagName);
                } else if (action === 'wiki-link-add-reference') {
                    const referenceText = `[Read "${tagName}" Wiki Page]`;
                    const creativeDirectiveInput = document.getElementById('creativeDirectiveInput');
                    if (creativeDirectiveInput) {
                        const currentValue = creativeDirectiveInput.value || '';
                        const separator = currentValue.trim() && !currentValue.trim().endsWith('\n') ? '\n' : '';
                        creativeDirectiveInput.value = currentValue + separator + referenceText;
                        creativeDirectiveInput.dispatchEvent(new Event('input', { bubbles: true }));
                        creativeDirectiveInput.focus();
                        showGlassToast('success', null, 'Added reference to directive', false, 3000, '<i class="fas fa-check"></i>');
                    }
                } else if (action === 'wiki-link-open-new-window') {
                    this.openLinkInNewWindow(tagName);
                } else if (action === 'wiki-link-open-on-right') {
                    if (window.tagWikiSearchModal && typeof window.tagWikiSearchModal.openLinkOnPane === 'function') {
                        window.tagWikiSearchModal.openLinkOnPane(tagName, 'right');
                    }
                } else if (action === 'wiki-link-open-on-left') {
                    if (window.tagWikiSearchModal && typeof window.tagWikiSearchModal.openLinkOnPane === 'function') {
                        window.tagWikiSearchModal.openLinkOnPane(tagName, 'left');
                    }
                } else if (action === 'wiki-link-add-to-desktop') {
                    this.addWikiPageToDesktop(tagName);
                }
            }
        };
        
        contextMenu.attachToElement(link, linkMenuConfig);
        this.contextMenuElements.push(link);
    }
    
    copyToClipboard(text) {
        // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
        copyTextToClipboard(text).then(() => {
            showGlassToast('success', null, 'Copied to clipboard', false, 3000, '<i class="fas fa-check"></i>');
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    }
    
    getCurrentTagName() {
        if (this.currentSelectedTag) {
            return this.currentSelectedTag.title || this.currentSelectedTag.name || '';
        }
        return this.currentTagName || '';
    }

    hasWikiPageTag() {
        return Boolean(String(this.getCurrentTagName() || '').trim()) && !this.currentStaticWiki;
    }

    isStaticDocPage() {
        return !!this.currentStaticWiki;
    }

    isSearchPage() {
        return !!this._searchPageMode;
    }

    canRefreshFromOnline() {
        // Dynamic wiki tag pages (edtx:// style from Danbooru/e621) can be refreshed from online sources.
        // Static docs (rdf://), search surfaces, and home pages cannot.
        if (this.currentStaticWiki) return false;
        const last = this.history && this.history[this.historyIndex];
        if (last && (last.type === 'static-wiki-page' || last.type === 'static-wiki-index')) return false;
        if (this._searchPageMode) return false;
        const tag = this.getCurrentTagName();
        return Boolean(String(tag || '').trim());
    }

    buildWikiPhasewalkerSubmenuItems(tagText) {
        const text = String(tagText || this.getCurrentTagName() || '').trim();
        // buildPhasewalkerContextSubmenuItems: public/scripts/comp/runCommandIndex.js
        if (typeof buildPhasewalkerContextSubmenuItems === 'function') {
            return buildPhasewalkerContextSubmenuItems(text);
        }
        return [{ text: 'Unavailable', disabled: true }];
    }

    handleWikiPhasewalkerSubmenuAction(subItem) {
        // handlePhasewalkerContextSubmenuAction: public/scripts/comp/runCommandIndex.js
        if (handlePhasewalkerContextSubmenuAction) {
            handlePhasewalkerContextSubmenuAction(subItem);
        }
    }

    handleWikiDisplayContextMenuAction(action, target, item) {
        if (action === 'wiki-back') {
            this.goBack();
        } else if (action === 'wiki-forward') {
            this.goForward();
        } else if (action === 'wiki-home') {
            this.goHome();
        } else if (action === 'wiki-add-to-prompt') {
            this.addToPrompt();
        } else if (action === 'wiki-add-reference') {
            this.addToDirective();
        } else if (action === 'wiki-open-new-window') {
            this.openInNewWindow();
        } else if (action === 'wiki-add-to-desktop') {
            this.addWikiPageToDesktop();
        } else if (action === 'wiki-selection-search-google') {
            this.searchGoogleForSelection();
        } else if (action === 'wiki-selection-add-to-directive') {
            this.addSelectionToDirective();
        } else if (action === 'wiki-selection-copy') {
            this.copySelectionToClipboard();
        } else if (action === 'wiki-refresh-online') {
            this.refreshFromOnline();
        } else if (action === 'wiki-copy-tag') {
            const tag = this.getCurrentTagName();
            // copyRunTagText: public/scripts/comp/runCommandIndex.js
            if (tag && typeof copyRunTagText === 'function') {
                copyRunTagText(tag);
            }
        } else if (action === 'wiki-add-to-favorites') {
            const tag = this.getCurrentTagName();
            // showAddToFavoritesDialog: public/scripts/comp/autocompleteUtils.js
            if (tag && showAddToFavoritesDialog) {
                showAddToFavoritesDialog(tag);
            }
        }
    }

    attachWikiDisplayContextMenu() {
        if (!this.displayArea || !contextMenu) return;

        const displayMenuConfig = {
            sections: [
                {
                    type: 'icons',
                    icons: [
                        {
                            icon: 'fas fa-arrow-left',
                            action: 'wiki-back',
                            tooltip: 'Back',
                            disabled: () => !this.history || this.historyIndex <= 0
                        },
                        {
                            icon: 'fas fa-arrow-right',
                            action: 'wiki-forward',
                            tooltip: 'Forward',
                            disabled: () => !this.history || this.historyIndex >= this.history.length - 1
                        },
                        {
                            icon: 'fas fa-home',
                            action: 'wiki-home',
                            tooltip: 'Home'
                        },
                        {
                            tooltip: 'New Window',
                            icon: 'fas fa-window-restore',
                            action: 'wiki-open-new-window',
                            hidden: () => this.isSearchPage() && !this.getCurrentTagName() && !this.currentStaticWiki
                        },
                        {
                            tooltip: 'Copy Tag',
                            icon: 'fas fa-copy',
                            action: 'wiki-copy-tag',
                            hidden: () => !this.hasWikiPageTag()
                        },
                        {
                            tooltip: 'Copy Selected Text to Clipboard',
                            icon: 'fas fa-clipboard',
                            action: 'wiki-selection-copy',
                            hidden: () => {
                                const selection = window.getSelection();
                                const text = selection.toString().trim();
                                if (!text) return true;
                                const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
                                return !range || !this.displayArea.contains(range.commonAncestorContainer);
                            }
                        }
                    ]
                },
                {
                    type: 'list',
                    items: [
                        {
                            text: 'Add to Prompt',
                            icon: 'fas fa-plus',
                            action: 'wiki-add-to-prompt',
                            disabled: () => manualModal.classList.contains('hidden'),
                            hidden: () => !this.getCurrentTagName()
                        },
                        {
                            text: 'Add to Favorites',
                            icon: 'fas fa-star',
                            action: 'wiki-add-to-favorites',
                            hidden: () => !this.hasWikiPageTag()
                        },
                        {
                            text: 'PhaseWalker',
                            icon: 'fas fa-layer-group',
                            openOnHover: true,
                            optionsfn: () => this.buildWikiPhasewalkerSubmenuItems(),
                            handlerfn: (subItem) => this.handleWikiPhasewalkerSubmenuAction(subItem),
                            hidden: () => !this.hasWikiPageTag()
                        },
                        {
                            text: 'Add Selection to Directive',
                            icon: 'fas fa-plus',
                            action: 'wiki-selection-add-to-directive',
                            disabled: () => !this.isDirectiveAvailable(),
                            hidden: () => {
                                const selection = window.getSelection();
                                const text = selection.toString().trim();
                                if (!text) return true;
                                const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
                                return !range || !this.displayArea.contains(range.commonAncestorContainer);
                            }
                        },
                        {
                            text: 'Add Reference',
                            icon: 'fas fa-bookmark',
                            action: 'wiki-add-reference',
                            disabled: () => !this.isDirectiveAvailable(),
                            hidden: () => !this.getCurrentTagName()
                        },
                        { separator: true },
                        {
                            text: 'Refresh from Online',
                            icon: 'fas fa-sync-alt',
                            action: 'wiki-refresh-online',
                            hidden: () => !this.canRefreshFromOnline()
                        },
                        {
                            text: 'Search Google',
                            icon: 'fas fa-search',
                            action: 'wiki-selection-search-google',
                            hidden: () => {
                                const selection = window.getSelection();
                                const text = selection.toString().trim();
                                if (!text) return true;
                                const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
                                return !range || !this.displayArea.contains(range.commonAncestorContainer);
                            }
                        },
                        {
                            text: 'Add to Desktop',
                            icon: 'fas fa-arrow-down-left',
                            action: 'wiki-add-to-desktop',
                            hidden: () => this.isSearchPage() || (!this.getCurrentTagName() && !this.currentStaticWiki)
                        }
                    ]
                }
            ],
            onAction: (action, target, item) => {
                this.handleWikiDisplayContextMenuAction(action, target, item);
            }
        };

        contextMenu.attachToElement(this.displayArea, displayMenuConfig);
        this.contextMenuElements.push(this.displayArea);
    }
    
    addToPrompt(text) {
        const manualModal = document.getElementById('manualModal');
        const manualPrompt = document.getElementById('manualPrompt');
        
        if (!manualPrompt) return;
        
        // Check if manualModal is open (not hidden)
        const isModalOpen = manualModal && !manualModal.classList.contains('hidden');
        
        if (!isModalOpen) {
            showGlassToast('info', null, 'Please open the prompt modal first', false, 3000, '<i class="fas fa-info-circle"></i>');
            return;
        }
        
        // Use tag name instead of full page content
        const tagName = text || this.getCurrentTagName();
        if (!tagName) {
            showGlassToast('info', null, 'No tag selected', false, 3000, '<i class="fas fa-info-circle"></i>');
            return;
        }
        
        // Add text to prompt
        const currentValue = manualPrompt.value || '';
        const separator = currentValue.trim() && !currentValue.trim().endsWith(',') ? ', ' : '';
        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(manualPrompt, currentValue + separator + tagName);
        
        // Trigger input event to update any listeners
        manualPrompt.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Focus the textarea
        manualPrompt.focus();
        
        showGlassToast('success', null, 'Added to prompt', false, 3000, '<i class="fas fa-check"></i>');
    }
    
    addToDirective() {
        const creativeDirectiveInput = document.getElementById('creativeDirectiveInput');
        if (!creativeDirectiveInput) return;
        
        const tagName = this.getCurrentTagName();
        if (!tagName) {
            showGlassToast('info', null, 'No tag selected', false, 3000, '<i class="fas fa-info-circle"></i>');
            return;
        }
        
        const referenceText = `\n[Read "${tagName}" Wiki Page]`;
        const currentValue = creativeDirectiveInput.value || '';
        const separator = currentValue.trim() && !currentValue.trim().endsWith('\n') ? '\n' : '';
        creativeDirectiveInput.value = currentValue + separator + referenceText;
        
        // Trigger input event to update any listeners
        creativeDirectiveInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Focus the textarea
        creativeDirectiveInput.focus();
        
        showGlassToast('success', null, 'Added reference to directive', false, 3000, '<i class="fas fa-check"></i>');
    }
    
    async addWikiPageToDesktop(tagName = null) {
        if (this.currentStaticWiki) {
            const sw = this.currentStaticWiki;
            const label = sw.title || sw.pageId || 'Documentation';
            try {
                if (desktopShortcuts && desktopShortcuts.addShortcut) {
                    await desktopShortcuts.addShortcut({
                        name: label,
                        type: 'static-wiki-page',
                        data: {
                            siteId: sw.siteId,
                            pageId: sw.pageId,
                            title: sw.title || label
                        }
                    });
                    showGlassToast('success', null, 'Documentation page added to desktop', false, 3000, '<i class="fas fa-arrow-down-left"></i>');
                } else {
                    showGlassToast('error', 'Error', 'Desktop shortcuts not available', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                }
            } catch (error) {
                console.error('Failed to add static wiki page to desktop:', error);
                showGlassToast('error', 'Error', 'Failed to add shortcut', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
            return;
        }

        const targetTagName = tagName || this.getCurrentTagName();
        if (!targetTagName) {
            showGlassToast('info', null, 'No tag selected', false, 3000, '<i class="fas fa-info-circle"></i>');
            return;
        }
        
        try {
            if (desktopShortcuts && desktopShortcuts.addShortcut) {
                const shortcut = {
                    name: targetTagName,
                    type: 'wiki-page',
                    data: {
                        tagName: targetTagName
                    }
                };
                
                await desktopShortcuts.addShortcut(shortcut);
                showGlassToast('success', null, 'Wiki page added to desktop', false, 3000, '<i class="fas fa-arrow-down-left"></i>');
            } else {
                showGlassToast('error', 'Error', 'Desktop shortcuts not available', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } catch (error) {
            console.error('Failed to add wiki page to desktop:', error);
            showGlassToast('error', 'Error', 'Failed to add wiki page shortcut', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }
    
    isDirectiveAvailable() {
        if (!dynamicGenerationGroup || !creativeBtn) return false;
        
        // Check if dynamic generation is enabled (group is visible)
        const isDynamicGenerationEnabled = !dynamicGenerationGroup.classList.contains('hidden');
        
        // Check if creative tab is active
        const isCreativeActive = creativeBtn.dataset.state === 'on';
        
        return isDynamicGenerationEnabled && isCreativeActive;
    }
    
    searchGoogleForSelection() {
        const selection = window.getSelection();
        const text = selection.toString().trim();
        if (text) {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
            window.open(searchUrl, '_blank', 'noopener,noreferrer');
            window.getSelection().removeAllRanges();
        }
    }
    
    addSelectionToDirective() {
        const selection = window.getSelection();
        const text = selection.toString().trim();
        if (!text) return;
        
        const creativeDirectiveInput = document.getElementById('creativeDirectiveInput');
        if (!creativeDirectiveInput) return;
        
        const currentValue = creativeDirectiveInput.value || '';
        const separator = currentValue.trim() && !currentValue.trim().endsWith('\n') ? '\n' : '';
        creativeDirectiveInput.value = currentValue + separator + text;
        creativeDirectiveInput.dispatchEvent(new Event('input', { bubbles: true }));
        creativeDirectiveInput.focus();
        showGlassToast('success', null, 'Added to directive', false, 3000, '<i class="fas fa-check"></i>');
        window.getSelection().removeAllRanges();
    }
    
    copySelectionToClipboard() {
        const selection = window.getSelection();
        const text = selection.toString().trim();
        if (text) {
            this.copyToClipboard(text);
            window.getSelection().removeAllRanges();
        }
    }
    
    openInNewWindow() {
        if (!this.displayArea) {
            console.warn('openInNewWindow: displayArea is null');
            return;
        }
        
        if (!window.wikiWindowManager) {
            console.error('openInNewWindow: wikiWindowManager is not available');
            return;
        }
        
        const currentContent = this.getCurrentPageContent();
        if (!currentContent) {
            console.warn('openInNewWindow: No page content available to open');
            return;
        }
        
        // Copy history up to and including current entry (so new window can navigate back)
        const historyToCopy = this.history && this.history.length > 0 
            ? this.history.slice(0, this.historyIndex + 1)
            : null;
        
        window.wikiWindowManager.createWindow(currentContent, this.currentSelectedTag, historyToCopy);
    }
    
    openLinkInNewWindow(tagName) {
        if (!tagName || !window.wsClient || !window.wsClient.isConnected() || !window.wikiWindowManager) return;

        const tag = this.buildWikiTagFromTerm(tagName);
        if (!tag) return;

        this.getTagWikiPage(tag).then((result) => {
            if (this.hasWikiPageContent(result)) {
                window.wikiWindowManager.createWindow(result, { title: tag.title, name: tag.name });
            }
        }).catch((error) => {
            console.error('Failed to load wiki page for new window:', error);
        });
    }
    
    getCurrentPageContent() {
        // Get the current page content from display area
        if (!this.displayArea) return null;
        
        const pageElement = this.displayArea.querySelector('.tag-wiki-page');
        if (!pageElement) return null;
        
        // Reconstruct content object from displayed HTML
        if (this.currentStaticWiki) {
            const sw = this.currentStaticWiki;
            const title = sw.title || sw.pageId || 'Documentation';
            const bodyEl = pageElement.querySelector('.tag-wiki-body-content') || pageElement;
            const html = bodyEl.innerHTML;
            return {
                tagName: title,
                title,
                html,
                body: html,
                staticWiki: true,
                siteId: sw.siteId,
                pageId: sw.pageId,
                siteIcon: sw.siteIcon || null
            };
        }

        const title = this.currentSelectedTag ? (this.currentSelectedTag.title || this.currentSelectedTag.name) : 'Unknown';
        const html = pageElement.innerHTML;
        
        return {
            tagName: title,
            title: title,
            html: html,
            body: html
        };
    }

    setupStaticWikiIndexLinks(container) {
        if (!container) return;
        container.querySelectorAll('.wiki-static-index-link').forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const siteId = link.getAttribute('data-wiki-site');
                const pageId = link.getAttribute('data-wiki-page');
                if (siteId && pageId) {
                    this.openStaticWikiPage(siteId, pageId);
                }
            });
        });
    }

    async loadStaticWikiHomeSites() {
        // Append doc buttons into the main horizontal inline flow (no separate docs header/block).
        // This lets tag-group/search + documentation buttons all flow in the same flex-wrap container.
        const container = this.displayArea && this.displayArea.querySelector('.dreamwiki-starting-points-inline');
        if (!container) return;

        if (!wsClient || !wsClient.isConnected()) {
            // don't pollute the flow with "offline" text
            return;
        }

        try {
            const result = await wsClient.sendMessage('get_wiki_home', {});
            const sites = (result && result.sites) ? result.sites : [];
            if (!sites.length) {
                return;
            }
            // Clear any previously appended doc buttons to prevent duplicates (e.g. NovelAI appearing twice)
            container.querySelectorAll('[data-static-wiki-site]').forEach((b) => b.remove());

            const frag = document.createDocumentFragment();
            sites.forEach((site) => {
                let name = this.escapeHtml(site.name || site.id);
                const id = site.id || '';
                const safeId = this.escapeHtml(id);
                if (id === 'novelai' || String(id).toLowerCase().includes('novelai')) {
                    name = 'NovelAI';
                }
                const icon = site.icon ? this.escapeHtml(site.icon) : '';
                const iconHtml = icon
                    ? `<img src="${icon}" alt="" class="dreamwiki-site-btn-icon" aria-hidden="true">`
                    : '<i class="fas fa-book" aria-hidden="true"></i>';
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn-secondary btn-small dreamwiki-start-row dreamwiki-site-btn';
                btn.setAttribute('data-static-wiki-site', safeId);
                btn.innerHTML = `${iconHtml}<span>${name}</span>`;
                btn.addEventListener('click', () => {
                    if (id) {
                        this.showStaticWikiSiteIndex(id);
                    }
                });
                frag.appendChild(btn);
            });
            container.appendChild(frag);
        } catch (err) {
            console.error('loadStaticWikiHomeSites:', err);
            // silent fail to not break the flow
        }
    }

    showDreamWikiHomepage() {
        if (!this.displayArea) return;

        // deactivateDsapOnShell: public/scripts/comp/dsapRegistry.js
        if (typeof deactivateDsapOnShell === 'function') deactivateDsapOnShell(this);

        this.setNavigationLoading(false);
        this._searchPageMode = false;
        if (this.searchBody) {
            this.searchBody.classList.remove('search-page-view');
        }

        this.currentSelectedTag = null;
        this.currentTagName = null;
        this.currentStaticWiki = null;

        const recents = dreamWikiRecentRead();
        const recentRows = recents.length
            ? recents
                  .map((name) => {
                      const safe = this.escapeHtml(name);
                      const enc = encodeURIComponent(name);
                      return `<span class="tag-pill dreamwiki-recent-item" role="button" tabindex="0" data-dreamwiki-recent="${enc}">${safe}</span>`;
                  })
                  .join('')
            : `<div class="dreamwiki-recent-empty">No pages yet.</div>`;

        this.displayArea.innerHTML = `
<div class="dreamwiki-home">
    <div class="dreamwiki-home-hero form-row center-align">
        <div class="about-logo-container">
            <img src="/static_images/logo_icon.png" alt="Dreamscape Logo" class="about-logo">
            <h2 class="logo-text">Dreamscape</h2>
        </div>
    </div>
    <p class="dreamwiki-home-subtitle">The central home of Knowledge, The Grimoire</p>
    <div class="dreamwiki-home-pad dreamwiki-home-pad-sm"></div>
    <div class="dreamwiki-home-border-dotted"></div>
    <div class="dreamwiki-home-pad dreamwiki-home-pad-md"></div>
    <div class="dreamwiki-home-actions-center">
        <!-- Tag groups + search + documentation buttons flow horizontally (flex row wrap) with max-width per button.
             No section header for tag groups per request. -->
        <div class="dreamwiki-starting-points dreamwiki-starting-points-inline">
            <button type="button" class="btn-secondary btn-small dreamwiki-start-row" data-action="open-search-home">
                <i class="fas fa-search"></i> Search the Grim
            </button>
            <button type="button" class="btn-secondary btn-small dreamwiki-start-row" data-action="open-dreamscape-settings">
                <i class="fas fa-sliders"></i> Settings
            </button>
            <button type="button" class="btn-secondary btn-small dreamwiki-start-row" data-dreamwiki-page="tag groups">
                <i class="nai-sakura"></i> Danbooru Tags
            </button>
            <button type="button" class="btn-secondary btn-small dreamwiki-start-row" data-dreamwiki-page="tag_group:index">
                <i class="nai-paw"></i> e621 Tags
            </button>
            <!-- Documentation site buttons (e.g. NovelAI) are appended here by loadStaticWikiHomeSites so they participate in the horizontal wrap flow -->
        </div>
    </div>
    <div class="dreamwiki-recent-panel">
        <h4 class="dreamwiki-recent-heading">Recently visited</h4>
        <div class="dreamwiki-recent-list tag-cloud">${recentRows}</div>
    </div>
</div>`;

        this.bindDreamWikiHomepageEvents();
        if (typeof this._interceptAllLinks === 'function') {
            this._interceptAllLinks();
        }
    }

    bindDreamWikiHomepageEvents() {
        if (!this.displayArea) return;

        this.displayArea.querySelectorAll('[data-dreamwiki-page]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const page = btn.getAttribute('data-dreamwiki-page');
                if (page) {
                    this.getTagWikiPageDirectly(page);
                }
            });
        });

        // Button to open the classic Google-style search homepage
        const searchHomeBtn = this.displayArea.querySelector('[data-action="open-search-home"]');
        if (searchHomeBtn) {
            searchHomeBtn.addEventListener('click', () => {
                this.navigate('edtx://en.grimoire.jp/search');
            });
        }

        const settingsBtn = this.displayArea.querySelector('[data-action="open-dreamscape-settings"]');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                this.navigate('dsap://dreamscape.jp/');
            });
        }

        this.loadStaticWikiHomeSites();

        const list = this.displayArea.querySelector('.dreamwiki-recent-list');
        if (list) {
            const activateRecent = (el) => {
                const raw = el.getAttribute('data-dreamwiki-recent');
                let name = '';
                if (raw) {
                    try {
                        name = decodeURIComponent(raw);
                    } catch (e) {
                        name = raw;
                    }
                }
                if (name) {
                    this.getTagWikiPageDirectly(name);
                }
            };
            list.querySelectorAll('[data-dreamwiki-recent]').forEach((row) => {
                row.addEventListener('click', () => activateRecent(row));
                row.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        activateRecent(row);
                    }
                });
            });
        }
    }

    rebindDisplayContent() {
        if (!this.displayArea) return;
        if (this.displayArea.querySelector('.tag-wiki-split-blank-state')) {
            return;
        }
        if (this.displayArea.querySelector('.dreamwiki-home')) {
            this.bindDreamWikiHomepageEvents();
            return;
        }
        if (this.displayArea.querySelector('.static-wiki-index')) {
            this.setupStaticWikiIndexLinks(this.displayArea);
            if (typeof this._interceptAllLinks === 'function') {
                this._interceptAllLinks();
            }
            return;
        }
        if (typeof this._interceptAllLinks === 'function') {
            this._interceptAllLinks();
        }
    }

    async showStaticWikiSiteIndex(siteId) {
        if (!this.displayArea || !siteId) return;
        if (!wsClient || !wsClient.isConnected()) {
            this.displayArea.innerHTML = '<div class="tag-wiki-error"><i class="fas fa-exclamation-circle"></i> WebSocket not connected</div>';
            return;
        }

        this.currentSelectedTag = null;
        this.currentTagName = null;
        this.currentStaticWiki = null;

        this.displayArea.innerHTML = '<div class="tag-wiki-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading...</div>';

        try {
            const data = await wsClient.sendMessage('get_static_wiki_site_index', { siteId });
            const siteName = this.escapeHtml(data.name || siteId);
            const headerHtml = this.staticWikiPageHeaderHtml(data.name || siteId, siteId, data.icon);
            const groups = data.groups || [];
            let groupsHtml = '';
            if (!groups.length) {
                groupsHtml = '<p class="dreamwiki-recent-empty">No pages imported yet.</p>';
            } else {
                groupsHtml = groups.map((group) => {
                    const groupName = this.escapeHtml(group.name || 'Other');
                    const pages = (group.pages || []).map((page) => {
                        const title = this.escapeHtml(page.title || page.id);
                        const encSite = this.escapeHtml(siteId);
                        const encPage = this.escapeHtml(page.id);
                        return `<li><a href="#" class="wiki-static-index-link" data-wiki-site="${encSite}" data-wiki-page="${encPage}">${title}</a></li>`;
                    }).join('');
                    return `<h5 class="static-wiki-index-group-title">${groupName}</h5><ul class="tag-wiki-list static-wiki-index-page-list">${pages}</ul>`;
                }).join('');
            }

            this.displayArea.innerHTML = `
<div class="tag-wiki-page static-wiki-index">
    ${headerHtml}
    <div class="tag-wiki-body-content tag-wiki-page-content">
        ${groupsHtml}
    </div>
</div>`;

            this.setupStaticWikiIndexLinks(this.displayArea);
            if (typeof this._interceptAllLinks === 'function') {
                this._interceptAllLinks();
            }

            this.addToHistory({
                type: 'static-wiki-index',
                siteId,
                siteName: data.name || siteId,
                icon: data.icon || null
            });

            // Use document (rdf) protocol + own domain for novelai docs
            if (siteId === 'novelai' || String(siteId).toLowerCase().includes('novelai')) {
                this.setAddress({ displayUrl: 'rdf://docs.novelai.jp/', mode: 'rdf' });
            } else {
                this.setAddress({ displayUrl: `edtx://en.grimoire.jp/docs/${siteId}`, mode: 'edtx' });
            }
        } catch (err) {
            console.error('showStaticWikiSiteIndex:', err);
            this.displayArea.innerHTML = `<div class="tag-wiki-error"><i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(err.message || 'Failed to load index')}</div>`;
        }
    }

    async openStaticWikiPage(siteId, pageId) {
        if (!siteId || !pageId) return;
        if (!wsClient || !wsClient.isConnected()) {
            if (this.displayArea) {
                this.displayArea.innerHTML = '<div class="tag-wiki-error"><i class="fas fa-exclamation-circle"></i> WebSocket not connected</div>';
            }
            return;
        }

        if (this.displayArea) {
            this.displayArea.innerHTML = '<div class="tag-wiki-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading...</div>';
        }

        try {
            const data = await wsClient.sendMessage('get_static_wiki_page', { siteId, pageId });
            const content = {
                title: data.title || pageId,
                tagName: data.title || pageId,
                html: data.html || '',
                staticWiki: true,
                siteId,
                pageId,
                siteIcon: data.siteIcon || null
            };
            this.renderWikiPage(content);
            if (typeof this._interceptAllLinks === 'function') {
                this._interceptAllLinks();
            }
            this.addToHistory({
                type: 'static-wiki-page',
                siteId,
                pageId,
                title: content.title,
                content
            });
        } catch (err) {
            console.error('openStaticWikiPage:', err);
            if (this.displayArea) {
                this.displayArea.innerHTML = `<div class="tag-wiki-error"><i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(err.message || 'Page not found')}</div>`;
            }
        }
    }
    
    resolveBooruWikiTagName(tag) {
        const raw = String(tag?.name || tag?.title || '').trim();
        return raw
            .replace(/\\/g, '')
            .replace(/^(?:species|invalid):/i, '')
            .replace(/\s+/g, '_')
            .trim();
    }

    resolveWikiPageSource(tag) {
        const filter = this.currentSource || 'both';
        const tagSources = Array.isArray(tag?.source) ? tag.source : [];
        if (filter !== 'both') {
            if (tagSources.length > 0 && !tagSources.includes(filter)) {
                return tagSources.length === 1 ? tagSources[0] : undefined;
            }
            return filter;
        }
        return undefined;
    }

    hasWikiPageContent(result) {
        if (!result || result.error) return false;
        if (Array.isArray(result.bodies) && result.bodies.some((body) => body && (body.html || body.body))) {
            return true;
        }
        return typeof result.html === 'string' && result.html.trim().length > 0;
    }

    buildWikiTagFromTerm(term, extra = {}) {
        const title = String(term || '').trim();
        if (!title) return null;
        const tag = { title, name: title, ...extra };
        tag.name = this.resolveBooruWikiTagName(tag);
        return tag;
    }

    async getTagWikiPage(tag, options = {}) {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const wikiLookupName = this.resolveBooruWikiTagName(tag);
        const wikiSource = options.source || this.resolveWikiPageSource(tag) || 'both';
        const payload = {
            tagName: wikiLookupName,
            source: wikiSource,
            format: 'html'
        };
        if (options.force) {
            payload.force = true;
        }

        try {
            const result = await window.wsClient.sendMessage('get_tag_wiki_page', payload);

            return result || {};
        } catch (error) {
            console.error('Get tag wiki page request failed:', error);
            throw error;
        } finally {
            this.setNavigationLoading(false);
        }
    }
    
    renderWikiPage(content) {
        if (!this.displayArea) return;

        // deactivateDsapOnShell: public/scripts/comp/dsapRegistry.js
        if (typeof deactivateDsapOnShell === 'function') deactivateDsapOnShell(this);

        delete this._checkingOnlineTag;  // ensure we exit any pending dedicated online lookup state
        this.setNavigationLoading(false);
        this._searchPageMode = false;
        // Leaving search page view - restore normal sidebar+display layout if it was hidden
        if (this.searchBody) {
            this.searchBody.classList.remove('search-page-view');
        }
        
        if (content.error) {
            const canGoBack = this.history && this.historyIndex > 0;
            const backButtonHtml = canGoBack 
                ? `<button class="btn-secondary btn-small wiki-error-back-btn" style="margin-top: var(--spacing-sm);">
                    <i class="fas fa-arrow-left"></i> Back
                </button>`
                : '';
            
            this.displayArea.innerHTML = `
                <div class="tag-wiki-error">
                    <i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(content.error)}
                    ${backButtonHtml}
                </div>
            `;
            
            // Setup back button click handler
            if (canGoBack) {
                const backBtn = this.displayArea.querySelector('.wiki-error-back-btn');
                if (backBtn) {
                    backBtn.addEventListener('click', () => {
                        if (this.goBack) {
                            this.goBack();
                        }
                    });
                }
            }
            return;
        }
        
        const title = content.tagName || content.title || 'Unknown';

        // Update the layered address bar with a protocol-prefixed pseudo-URL for the loaded page.
        if (!content.staticWiki && (this.currentTagName || content.tagName)) {
            const tag = this.currentTagName || content.tagName || title;
            const enc = encodeURIComponent(String(tag).replace(/\s+/g, '_'));
            // Protocol + source domain
            this.setAddress({ displayUrl: `edtx://wiki.danbooru.jp/tag/${enc}`, mode: 'edtx' });
        } else if (content.staticWiki && content.siteId && content.pageId) {
            const s = content.siteId;
            if (s === 'novelai' || String(s).toLowerCase().includes('novelai')) {
                this.setAddress({ displayUrl: `rdf://docs.novelai.jp/${content.pageId}`, mode: 'rdf' });
            } else {
                this.setAddress({ displayUrl: `edtx://en.grimoire.jp/docs/${s}/${content.pageId}`, mode: 'edtx' });
            }
        }

        if (content.staticWiki && content.siteId && content.pageId) {
            this.currentStaticWiki = {
                siteId: content.siteId,
                pageId: content.pageId,
                title,
                siteIcon: content.siteIcon || null
            };
            this.currentSelectedTag = null;
            this.currentTagName = null;
        } else {
            this.currentStaticWiki = null;
        }
        
        // Update window title if this is a WikiWindowInstance
        if (this.modal && this.modal.classList.contains('wiki-page-viewer-modal')) {
            const titleElement = this.modal.querySelector('.modal-window-title-main span');
            if (titleElement) {
                titleElement.textContent = `Wiki Page - ${title}`;
            }
        }
        
        // Handle multiple bodies (when source is 'both')
        let bodiesHtml = '';
        let anyFetchedOnline = content.fetchedOnline || false;
        if (content.bodies && Array.isArray(content.bodies)) {
            bodiesHtml = content.bodies.map((body, index) => {
                const sourceLabel = body.source === 'danbooru' ? 'Danbooru' : 'e621';
                const divider = index > 0 ? '<div class="tag-wiki-body-divider"></div>' : '';
                if (body.fetchedOnline) {
                    anyFetchedOnline = true;
                }
                return `${divider}<div class="tag-wiki-body-source">
                    <div class="tag-wiki-body-source-label">${this.escapeHtml(sourceLabel)}</div>
                    <div class="tag-wiki-body-content">${body.html}</div>
                </div>`;
            }).join('');
        } else {
            // Single body
            const html = content.html || content.body || '';
            if (content.fetchedOnline) {
                anyFetchedOnline = true;
            }
            
            // Check if the HTML already contains a title (from getCurrentPageContent)
            // getCurrentPageContent returns pageElement.innerHTML which includes the title
            // If it does, extract just the body content without the title
            if (html.includes('tag-wiki-page-title')) {
                // Create a temporary div to parse the HTML and extract body content
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                
                // Find and remove the title element if it exists
                const titleElement = tempDiv.querySelector('.tag-wiki-page-title');
                if (titleElement) {
                    titleElement.remove();
                }
                
                // Get the remaining HTML (body content)
                const bodyContent = tempDiv.innerHTML.trim();
                
                // If there's body content, use it directly (it's already properly structured)
                // Otherwise fall back to wrapping the original html
                if (bodyContent) {
                    bodiesHtml = bodyContent;
                } else {
                    bodiesHtml = `<div class="tag-wiki-body-content">${html}</div>`;
                }
            } else if (content.staticWiki) {
                bodiesHtml = `<div class="tag-wiki-body-content tag-wiki-page-content wiki-static-doc">${html}</div>`;
            } else {
                // Normal case: wrap the HTML in body-content div
                bodiesHtml = `<div class="tag-wiki-body-content">${html}</div>`;
            }
        }
        
        // Always show the title in content for better readability
        // The window title bar also shows it, but having it in content helps with context
        // Add online icon if any body was fetched online
        const onlineIcon = anyFetchedOnline 
            ? ' <i class="fas fa-cloud-download-alt tag-wiki-online-icon" title="Fetched from online"></i>' 
            : '';
        let titleHtml;
        if (content.staticWiki) {
            titleHtml = this.staticWikiPageHeaderHtml(title, content.siteId, content.siteIcon);
        } else {
            titleHtml = `<div class="tag-wiki-page-title">${this.escapeHtml(title)}${onlineIcon}</div>`;
        }
        
        // Store fetched online status for context menu use
        this.currentFetchedOnline = anyFetchedOnline;
        
        const displayHtml = `
            <div class="tag-wiki-page">
                ${titleHtml}
                ${bodiesHtml}
            </div>
        `;
        
        // Clean up any existing loading indicators from previous content before replacing HTML
        // Only clean up if we're actually rendering new content (not just updating)
        if (this.displayArea) {
            const previousLinks = this.displayArea.querySelectorAll('.wiki-link-loading');
            previousLinks.forEach(link => {
                if (link._loadingIndicator) {
                    // Clear any pending timeouts and remove immediately since content is being replaced
                    if (link._loadingIndicatorTimeout) {
                        clearTimeout(link._loadingIndicatorTimeout);
                        link._loadingIndicatorTimeout = null;
                    }
                    this.removeLinkLoadingIndicator(link);
                }
            });
            // Also restore cursor and pointer events in case they were set
            this.displayArea.style.cursor = '';
            this.displayArea.style.pointerEvents = '';
        }
        
        this.displayArea.innerHTML = displayHtml;
        
        // Assign stable dtext-* ids to collapsible sections for [[#anchor]] navigation
        this._applyWikiSectionAnchors();
        
        // Setup collapsible sections
        this.setupCollapsibleSections();
        
        // Link handlers + robust interception to prevent "exiting the app" (_interceptAllLinks calls setupLinkHandlers)
        if (typeof this._interceptAllLinks === 'function') {
            this._interceptAllLinks();
        }
        
        // Update custom scrollbar after content changes (for window instances)
        if (this.modal && this.modal.classList.contains('wiki-page-viewer-modal') && window.customScrollbar) {
            const displayPanel = this.modal.querySelector('.tag-wiki-search-display.form-section-scroll');
            if (displayPanel) {
                // Only update if scrollbar exists in map - don't create if scrollable-content already exists in DOM
                if (window.customScrollbar.scrollbars && window.customScrollbar.scrollbars.has(displayPanel)) {
                    window.customScrollbar.updateScrollbar(displayPanel);
                }
            }
        }
    }
    
    setupCollapsibleSections() {
        const sectionToggles = this.displayArea.querySelectorAll('.tag-wiki-section-toggle');
        sectionToggles.forEach(toggle => {
            toggle.addEventListener('click', () => {
                const targetId = (toggle.dataset.target || '').trim();
                if (!targetId) return;
                // Scope the query to the current display area to avoid conflicts with other windows
                let content;
                try {
                    content = this.displayArea.querySelector(`#${CSS.escape(targetId)}`) ||
                              (this.modal ? this.modal.querySelector(`#${CSS.escape(targetId)}`) : null);
                } catch (err) {
                    content = null;
                }
                if (!content) content = document.getElementById(targetId);
                const icon = toggle.querySelector('i');
                
                if (content && icon) {
                    if (content.classList.contains('hidden')) {
                        content.classList.remove('hidden');
                        icon.classList.remove('fa-chevron-right');
                        icon.classList.add('fa-chevron-down');
                    } else {
                        content.classList.add('hidden');
                        icon.classList.remove('fa-chevron-down');
                        icon.classList.add('fa-chevron-right');
                    }
                }
            });
        });
    }
    
    showLinkLoadingIndicator(link) {
        // Remove any existing indicator
        this.removeLinkLoadingIndicator(link);
        
        // Add highlight class to link
        link.classList.add('wiki-link-loading');
        
        // Set cursor to progress and prevent pointer events on wiki content
        if (this.displayArea) {
            this.displayArea.style.cursor = 'progress';
            this.displayArea.style.pointerEvents = 'none';
        }
        
        // Create loading indicator div above the link
        const linkRect = link.getBoundingClientRect();
        const indicator = document.createElement('div');
        indicator.className = 'wiki-link-loading-indicator';
        indicator.innerHTML = '<i class="fas fa-loader fa-spin"></i>';
        indicator.style.position = 'fixed';
        indicator.style.zIndex = '10000';
        indicator.style.pointerEvents = 'none';
        
        document.body.appendChild(indicator);
        
        // Position indicator above the link, centered
        const indicatorRect = indicator.getBoundingClientRect();
        const top = linkRect.top - indicatorRect.height - 8;
        const left = linkRect.left + (linkRect.width / 2);
        
        indicator.style.top = `${Math.max(10, top)}px`;
        indicator.style.left = `${left}px`;
        indicator.style.transform = 'translateX(-50%)';
        
        link._loadingIndicator = indicator;
    }
    
    updateLinkLoadingIndicator(link, message, isError = false) {
        if (!link || !link._loadingIndicator) return;
        
        const indicator = link._loadingIndicator;
        
        // Clear any existing removal timeout when updating to error
        if (isError && link._loadingIndicatorTimeout) {
            clearTimeout(link._loadingIndicatorTimeout);
            link._loadingIndicatorTimeout = null;
        }
        
        if (isError) {
            indicator.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(message)}`;
            indicator.classList.add('wiki-link-error-indicator');
        } else {
            indicator.innerHTML = `<i class="fas fa-loader fa-spin"></i> ${this.escapeHtml(message)}`;
            indicator.classList.remove('wiki-link-error-indicator');
        }
        
        // Recalculate position to center the updated message
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
            if (!link || !link._loadingIndicator || !link._loadingIndicator.parentNode) return;
            
            const linkRect = link.getBoundingClientRect();
            const indicatorRect = link._loadingIndicator.getBoundingClientRect();
            const top = linkRect.top - indicatorRect.height - 8;
            const left = linkRect.left + (linkRect.width / 2);
            
            link._loadingIndicator.style.top = `${Math.max(10, top)}px`;
            link._loadingIndicator.style.left = `${left}px`;
            link._loadingIndicator.style.transform = 'translateX(-50%)';
        });
    }
    
    removeLinkLoadingIndicator(link, delay = 0) {
        // Clear any existing timeout for this link
        if (link && link._loadingIndicatorTimeout) {
            clearTimeout(link._loadingIndicatorTimeout);
            link._loadingIndicatorTimeout = null;
        }
        
        const remove = () => {
            // Remove highlight class from link
            if (link) {
                link.classList.remove('wiki-link-loading');
            }
            
            // Remove loading indicator
            if (link && link._loadingIndicator) {
                if (link._loadingIndicator.parentNode) {
                    link._loadingIndicator.parentNode.removeChild(link._loadingIndicator);
                }
                link._loadingIndicator = null;
            }
            
            // Clear timeout reference
            if (link) {
                link._loadingIndicatorTimeout = null;
            }
            
            // Restore cursor and pointer events on wiki content
            if (this.displayArea) {
                this.displayArea.style.cursor = '';
                this.displayArea.style.pointerEvents = '';
            }
        };
        
        if (delay > 0) {
            // Store timeout ID so we can clear it if needed
            if (link) {
                link._loadingIndicatorTimeout = setTimeout(remove, delay);
            }
        } else {
            remove();
        }
    }
    
    scrollToWikiAnchor(rawAnchor) {
        let anchor = String(rawAnchor || '').trim();
        if (anchor.startsWith('#')) anchor = anchor.slice(1);
        if (!anchor) return false;

        const normalizeDtextId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const normalized = normalizeDtextId(anchor);
        const candidates = [];
        if (normalized) candidates.push('dtext-' + normalized);
        candidates.push(anchor.toLowerCase(), anchor);

        const area = this.displayArea;
        const seen = new Set();
        for (const id of candidates) {
            if (!id || seen.has(id)) continue;
            seen.add(id);
            let target = null;
            if (area) {
                try {
                    target = area.querySelector('#' + CSS.escape(id));
                } catch (err) {
                    target = null;
                }
            }
            if (!target) target = document.getElementById(id);
            if (target) {
                this._expandWikiSectionAncestors(target);
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return true;
            }
        }

        // Fallback: match collapsible section headers (e.g. [section,expanded=Arachnid:])
        if (area && normalized) {
            const toggles = area.querySelectorAll('.tag-wiki-section-toggle');
            for (const toggle of toggles) {
                const label = toggle.querySelector('span');
                const labelSlug = normalizeDtextId(label ? label.textContent : toggle.textContent);
                if (labelSlug !== normalized) continue;
                this._expandWikiSectionAncestors(toggle);
                toggle.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return true;
            }
        }
        return false;
    }

    _applyWikiSectionAnchors() {
        if (!this.displayArea) return;
        const normalizeDtextId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const usedIds = new Set();
        this.displayArea.querySelectorAll('[id]').forEach((el) => {
            if (el.id) usedIds.add(el.id);
        });

        this.displayArea.querySelectorAll('.tag-wiki-section-toggle').forEach((toggle) => {
            const label = toggle.querySelector('span');
            const slug = normalizeDtextId(label ? label.textContent : toggle.textContent);
            if (!slug) return;
            const anchorId = 'dtext-' + slug;
            if (usedIds.has(anchorId)) return;
            toggle.id = anchorId;
            usedIds.add(anchorId);

            const targetId = (toggle.dataset.target || '').trim();
            if (!targetId) return;
            let content;
            try {
                content = this.displayArea.querySelector('#' + CSS.escape(targetId));
            } catch (err) {
                content = null;
            }
            if (content && !content.id) {
                content.id = anchorId + '-content';
                usedIds.add(content.id);
            }
        });
    }

    _expandWikiSectionAncestors(element) {
        if (!element || !this.displayArea) return;
        let parent = element.parentElement;
        while (parent && parent !== this.displayArea) {
            if (parent.classList.contains('tag-wiki-section-content') && parent.classList.contains('hidden')) {
                parent.classList.remove('hidden');
                const section = parent.closest('.tag-wiki-section');
                const toggle = section ? section.querySelector('.tag-wiki-section-toggle') : null;
                const icon = toggle ? toggle.querySelector('i') : null;
                if (icon) {
                    icon.classList.remove('fa-chevron-right');
                    icon.classList.add('fa-chevron-down');
                }
            }
            parent = parent.parentElement;
        }
    }

    setupLinkHandlers() {
        // Add click handlers and context menus for tag wiki links
        const tagLinks = this.displayArea.querySelectorAll('.tag-wiki-link');
        tagLinks.forEach(link => {
            if (link.dataset.wikiLinkWired) return;
            link.dataset.wikiLinkWired = '1';

            // Click handler
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                let tagName = String(link.dataset.tagName || '').trim();
                let anchor = String(link.dataset.anchor || '').trim();

                // Same-page anchors: [[#section]] / [[#section|label]] (DText emits tagName "#section")
                if (tagName.startsWith('#')) {
                    this.scrollToWikiAnchor(anchor || tagName.slice(1));
                    return;
                }
                if (!tagName && anchor) {
                    this.scrollToWikiAnchor(anchor);
                    return;
                }
                if (!tagName) return;

                // Check if navigating to the same page
                const currentTagName = this.getCurrentTagName();
                if (currentTagName && currentTagName.toLowerCase() === tagName.toLowerCase()) {
                    // Same page - just handle anchor if present
                    if (anchor) {
                        setTimeout(() => this.scrollToWikiAnchor(anchor), 100);
                    }
                    return; // Block navigation to same page
                }
                
                // Show loading indicator
                this.showLinkLoadingIndicator(link);
                
                try {
                    const result = await this.getTagWikiPageDirectly(tagName, link);
                    if (this.hasWikiPageContent(result)) {
                        // Success - remove indicator immediately
                        this.removeLinkLoadingIndicator(link);
                        
                        if (anchor) {
                            setTimeout(() => this.scrollToWikiAnchor(anchor), 100);
                        }
                    }
                    // If error, indicator will be updated in getTagWikiPageDirectly
                } catch (error) {
                    // Error handling is done in getTagWikiPageDirectly
                }
            });
            
            // Setup context menu using existing system
            this.setupLinkContextMenu(link);
        });
        
        const staticLinks = this.displayArea.querySelectorAll('.wiki-static-link');
        staticLinks.forEach((link) => {
            if (link.dataset.wikiLinkWired) return;
            link.dataset.wikiLinkWired = '1';

            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const siteId = link.dataset.wikiSite;
                const pageId = link.dataset.wikiPage;
                if (siteId && pageId) {
                    this.openStaticWikiPage(siteId, pageId);
                }
            });
        });

        // Handle anchor links
        const anchorLinks = this.displayArea.querySelectorAll('.tag-wiki-anchor-link');
        anchorLinks.forEach(link => {
            if (link.dataset.wikiLinkWired) return;
            link.dataset.wikiLinkWired = '1';

            link.addEventListener('click', (e) => {
                e.preventDefault();
                const href = link.getAttribute('href');
                if (href && href.startsWith('#')) {
                    this.scrollToWikiAnchor(href.substring(1));
                }
            });
        });
        
        // Handle external links
        const externalLinks = this.displayArea.querySelectorAll('.tag-wiki-external-link, a[href^="https://e621.net"], a[href^="https://danbooru.donmai.us"]');
        externalLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;
            
            // Check if it's a search link
            try {
                const url = new URL(href);
                const hostname = url.hostname.toLowerCase();
                let searchQuery = null;
                let isSearchLink = false;
                
                if (hostname === 'e621.net' && url.pathname === '/tags' && url.searchParams.has('commit')) {
                    isSearchLink = true;
                    const nameMatches = url.searchParams.get('search[name_matches]') || 
                                       url.searchParams.get('search%5Bname_matches%5D') ||
                                       (() => {
                                           const decodedSearch = decodeURIComponent(url.search);
                                           const match = decodedSearch.match(/search\[name_matches\]=([^&]+)/);
                                           return match ? match[1] : null;
                                       })();
                    if (nameMatches) {
                        searchQuery = decodeURIComponent(nameMatches).replace(/\*/g, '').trim();
                        searchQuery = searchQuery.replace(/^["']|["']$/g, '');
                    }
                } else if (hostname === 'danbooru.donmai.us' && 
                         (url.pathname === '/wiki_pages' || url.pathname === '/wiki_pages/')) {
                    const hasSearchParam = url.searchParams.has('search[name_matches]') || 
                                          url.searchParams.has('search%5Bname_matches%5D') ||
                                          url.search.includes('search[name_matches]') ||
                                          url.search.includes('search%5Bname_matches%5D');
                    if (hasSearchParam) {
                        isSearchLink = true;
                        const nameMatches = url.searchParams.get('search[name_matches]') || 
                                           url.searchParams.get('search%5Bname_matches%5D') ||
                                           (() => {
                                               const decodedSearch = decodeURIComponent(url.search);
                                               const match = decodedSearch.match(/search\[name_matches\]=([^&]+)/);
                                               return match ? match[1] : null;
                                           })();
                        if (nameMatches) {
                            searchQuery = decodeURIComponent(nameMatches).replace(/\*/g, '').trim();
                            searchQuery = searchQuery.replace(/^["']|["']$/g, '');
                        }
                    }
                }
                
                if (isSearchLink && searchQuery) {
                    link.classList.add('tag-wiki-search-link');
                    if (!link.dataset.wikiLinkWired) {
                        link.dataset.wikiLinkWired = '1';
                        link.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (window.tagWikiSearchModal) {
                                window.tagWikiSearchModal.open(searchQuery);
                            }
                        });
                    }
                    link.style.cursor = 'pointer';
                    link.title = `Search for: ${searchQuery}`;
                    return;
                }
            } catch (e) {
                // URL parsing failed
            }
            
            // Normal external link handling
            if (!link.hasAttribute('target')) {
                link.setAttribute('target', '_blank');
            }
            if (!link.hasAttribute('rel')) {
                link.setAttribute('rel', 'noopener noreferrer');
            }
        });
        
        // Handle embedded images
        const embeddedImages = this.displayArea.querySelectorAll('.wiki-embedded-image');
        embeddedImages.forEach(img => {
            if (img.dataset.wikiLinkWired) return;
            img.dataset.wikiLinkWired = '1';

            img.style.cursor = 'pointer';
            img.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const imageSrc = img.getAttribute('src');
                if (imageSrc && window.openImageInViewer) {
                    const imageId = img.getAttribute('data-image-id') || '';
                    const wikiTag = img.getAttribute('data-wiki-tag') || '';
                    const title = wikiTag || imageId || 'Wiki Image';
                    
                    window.openImageInViewer(imageSrc, title, {
                        imageId: imageId,
                        wikiTag: wikiTag
                    });
                }
            });
        });
        
        // Handle media embeds
        const mediaEmbeds = this.displayArea.querySelectorAll('media-embed');
        mediaEmbeds.forEach(embed => {
            const mediaType = embed.getAttribute('data-type');
            const mediaId = embed.getAttribute('data-id');

            if (mediaType && mediaId && window.openImageInViewer) {
                if (mediaType === 'post') {
                    if (embed.dataset.wikiLinkWired) return;
                    embed.dataset.wikiLinkWired = '1';

                    const imageUrl = `/cache/wiki_files/post${mediaId}.jpg`;
                    embed.style.cursor = 'pointer';
                    embed.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.openImageInViewer(imageUrl, `Post #${mediaId}`, {
                            mediaType: mediaType,
                            mediaId: mediaId
                        });
                    });
                }
            }
        });
    }
    
    async getTagWikiPageDirectly(tagName, clickedLink = null) {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            console.error('WebSocket not connected');
            this.setNavigationLoading(false);
            return;
        }

        const deferNavigation = !!clickedLink;

        // If the main Grimoire browser modal is not yet visible (e.g. a desktop
        // shortcut, command, or navigation that targets the full browser rather
        // than a pure standalone viewer), open it first. This ensures the user
        // immediately sees the container + loading state.
        if (this.modal && (this.modal.classList.contains('hidden') || this.modal.classList.contains('hidden-alt'))) {
            this.open('', { skipInitialHome: true });
        }

        const tag = this.buildWikiTagFromTerm(tagName);
        if (!tag) {
            this.setNavigationLoading(false);
            return;
        }

        const isOnlineCheck = !!this._checkingOnlineTag;

        // Only force a live fetch for the dedicated "attempting online lookup" flow
        // (triggered from "no wiki" tag pills in search results). Normal direct loads,
        // navigation, desktop shortcuts, history, etc. must always prefer the local
        // database cache for the wiki body (and the derived image cache for post# refs).
        // The user can explicitly update the stored copy via "Refresh from online".
        const wantFreshBody = isOnlineCheck;

        // In-page link clicks: keep the current article visible until we know the target exists.
        if (!deferNavigation) {
            this.setNavigationLoading(true);
            if (this.displayArea && !isOnlineCheck) {
                this.displayArea.innerHTML = '<div class="tag-wiki-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading wiki page...</div>';
            }
        }

        const reportLinkClickError = (errorMessage) => {
            if (clickedLink && clickedLink._loadingIndicator) {
                this.updateLinkLoadingIndicator(clickedLink, errorMessage, true);
                this.removeLinkLoadingIndicator(clickedLink, 3000);
                return;
            }
            if (this.displayArea) {
                const canGoBack = this.history && this.historyIndex > 0;
                const backButtonHtml = canGoBack
                    ? `<button class="btn-secondary btn-small wiki-error-back-btn" style="margin-top: var(--spacing-sm);">
                        <i class="fas fa-arrow-left"></i> Back
                    </button>`
                    : '';

                this.displayArea.innerHTML = `
                    <div class="tag-wiki-error">
                        <i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(errorMessage)}
                        ${backButtonHtml}
                    </div>
                `;

                if (canGoBack) {
                    const backBtn = this.displayArea.querySelector('.wiki-error-back-btn');
                    if (backBtn) {
                        backBtn.addEventListener('click', () => {
                            if (this.goBack) {
                                this.goBack();
                            }
                        });
                    }
                }
            }
        };

        // Check for errors before rendering - fetch data first
        try {
            const result = await this.getTagWikiPage(tag, { force: wantFreshBody });

            // Check if there's an error in the result
            if (!this.hasWikiPageContent(result)) {
                const errorMessage = (result && result.error)
                    || `Tag "${tag.title}" has no wiki page on the selected source(s)`;

                if (isOnlineCheck) {
                    const t = this._checkingOnlineTag;
                    delete this._checkingOnlineTag;
                    this._showOnlineLookupSorry(t);
                    return result || { error: errorMessage };
                }

                reportLinkClickError(errorMessage);
                return result || { error: errorMessage };
            }

            // Success path
            delete this._checkingOnlineTag;

            if (deferNavigation && clickedLink) {
                this.removeLinkLoadingIndicator(clickedLink);
            }

            this.currentTagName = this.resolveBooruWikiTagName(tag);
            this.currentSelectedTag = { title: tag.title, name: tag.name };
            this.renderWikiPage(result);
            dreamWikiRecentAppend(tag.title);

            if (this.addToHistory) {
                this.addToHistory({
                    type: 'wiki',
                    tag: { title: tag.title, name: tag.name },
                    content: result
                });
            }

            return result;
        } catch (error) {
            console.error('Get tag wiki page request failed:', error);
            
            if (isOnlineCheck) {
                const t = this._checkingOnlineTag;
                delete this._checkingOnlineTag;
                this._showOnlineLookupSorry(t);
                return;
            }
            
            reportLinkClickError(`Error: ${error.message}`);
            
            throw error;
        }
    }
    
    async refreshFromOnline() {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            console.error('WebSocket not connected');
            if (typeof showGlassToast !== 'undefined') {
                showGlassToast('WebSocket not connected', 'error');
            }
            return;
        }

        const tag = this.getCurrentTagName();
        if (this.currentStaticWiki || !tag) {
            // Never offer/execute "refresh from online" for static docs (novelai etc.) or non-tag pages.
            // We have no server-side refresh path for bundled static documentation.
            console.warn('refreshFromOnline: not applicable for current page type (static doc or no tag)');
            if (typeof showGlassToast === 'function') {
                showGlassToast('info', null, 'Refresh from online is only available for wiki tag pages.', false, 2200, '<i class="fas fa-info-circle"></i>');
            }
            return;
        }
        if (!this.currentTagName) {
            this.currentTagName = tag;
        }
        
        try {
            // Show loading state
            if (this.displayArea) {
                this.displayArea.innerHTML = '<div class="tag-wiki-loading"><i class="fas fa-spinner-third fa-spin"></i> Refreshing from online...</div>';
            }
            
            // Send refresh request with force flag
            const result = await window.wsClient.sendMessage('refresh_tag_wiki_page', {
                tagName: this.currentTagName,
                source: 'both',
                format: 'html',
                force: true
            });
            
            // Check for errors
            if (result && result.error) {
                if (this.displayArea) {
                    this.displayArea.innerHTML = `
                        <div class="tag-wiki-error">
                            <i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(result.error)}
                        </div>
                    `;
                }
                if (typeof showGlassToast !== 'undefined') {
                    showGlassToast(`Error: ${result.error}`, 'error');
                }
                return;
            }
            
            // Re-render the page with refreshed content
            if (result) {
                this.renderWikiPage(result);
                if (typeof showGlassToast !== 'undefined') {
                    showGlassToast('Wiki page refreshed from online', 'success');
                }
            }
        } catch (error) {
            console.error('Refresh from online failed:', error);
            if (this.displayArea) {
                this.displayArea.innerHTML = `
                    <div class="tag-wiki-error">
                        <i class="fas fa-exclamation-circle"></i> Error: ${this.escapeHtml(error.message)}
                    </div>
                `;
            }
            if (typeof showGlassToast !== 'undefined') {
                showGlassToast(`Error: ${error.message}`, 'error');
            }
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    staticWikiSiteIconUrl(siteId, iconFromApi) {
        if (iconFromApi) {
            return iconFromApi;
        }
        if (siteId) {
            return `/private/wiki/${siteId}/assets/icon.png`;
        }
        return '';
    }

    staticWikiPageHeaderHtml(title, siteId, iconFromApi) {
        const safeTitle = this.escapeHtml(title);
        const iconUrl = this.staticWikiSiteIconUrl(siteId, iconFromApi);
        const iconHtml = iconUrl
            ? `<img src="${this.escapeHtml(iconUrl)}" alt="" class="static-wiki-index-site-icon">`
            : '';
        return `<div class="tag-wiki-page-title static-wiki-index-header"><span class="static-wiki-index-title-text">${safeTitle}</span>${iconHtml}</div><div class="form-section-separator tag-wiki-page-header-sep"></div>`;
    }
    
    // History navigation methods - shared by WikiWindowInstance and TagWikiSearchModal
    getHistoryEntryDisplayText(entry, index) {
        if (!entry) return `Entry ${index + 1}`;
        
        if (entry.type === 'home') {
            return 'Grimoire';
        }
        if (entry.type === 'dsap') {
            return entry.title || entry.url || 'Applet';
        }
        if (entry.type === 'nav-error') {
            return entry.title || 'Navigation failed';
        }
        if (entry.type === 'static-wiki-index') {
            return entry.siteName || entry.siteId || 'Documentation';
        }
        if (entry.type === 'static-wiki-page') {
            return entry.title || entry.pageId || `Doc ${index + 1}`;
        }
        if (entry.type === 'wiki' && entry.tag) {
            return entry.tag.title || entry.tag.name || `Wiki Page ${index + 1}`;
        } else if (entry.query) {
            return `Search: ${entry.query}`;
        }
        
        return `Entry ${index + 1}`;
    }

    getHistoryEntryMenuIcon(entry) {
        if (!entry) return 'fas fa-circle';
        if (entry.type === 'home') return 'fas fa-home';
        if (entry.type === 'dsap') return 'fas fa-puzzle-piece';
        if (entry.type === 'nav-error') return 'fas fa-triangle-exclamation';
        if (entry.type === 'static-wiki-index') return 'fas fa-book';
        if (entry.type === 'static-wiki-page') return 'fas fa-file-alt';
        if (entry.type === 'wiki') return 'fas fa-file-alt';
        return 'fas fa-search';
    }
    
    setupBackButtonContextMenu() {
        if (!this.backBtn || !contextMenu) return;
        
        // Store reference to update menu dynamically
        this.backMenuConfig = {
            sections: [
                {
                    type: 'list',
                    items: []
                }
            ],
            onAction: (action, target, item) => {
                if (action.startsWith('wiki-back-to-')) {
                    const index = parseInt(action.replace('wiki-back-to-', ''), 10);
                    this.goToHistoryIndex(index);
                }
            }
        };
        
        contextMenu.attachToElement(this.backBtn, this.backMenuConfig);
        this.contextMenuElements.push(this.backBtn);
    }
    
    isStandaloneWindow() {
        // Check if this is a standalone wiki window (not the main search modal)
        return this.modal && this.modal.classList.contains('wiki-page-viewer-modal');
    }
    
    setupForwardButtonContextMenu() {
        if (!this.forwardBtn || !contextMenu) return;
        
        // Store reference to update menu dynamically
        this.forwardMenuConfig = {
            sections: [
                {
                    type: 'list',
                    items: []
                }
            ],
            onAction: (action, target, item) => {
                if (action.startsWith('wiki-forward-to-')) {
                    const index = parseInt(action.replace('wiki-forward-to-', ''), 10);
                    this.goToHistoryIndex(index);
                }
            }
        };

        contextMenu.attachToElement(this.forwardBtn, this.forwardMenuConfig);
        this.contextMenuElements.push(this.forwardBtn);
    }
    
    goToHistoryIndex(index) {
        if (index >= 0 && index < this.history.length && index !== this.historyIndex) {
            this.historyIndex = index;
            this.restoreHistoryEntry(this.history[this.historyIndex]);
        }
    }
    
    goBack() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.restoreHistoryEntry(this.history[this.historyIndex]);
        }
    }
    
    goForward() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.restoreHistoryEntry(this.history[this.historyIndex]);
        }
    }
}

// Wiki Window Manager - manages multiple wiki window instances
class GrimoireSplitPane extends WikiDisplayBase {
    constructor(opts) {
        super();
        this.displayArea = opts.displayArea;
        this.history = [];
        this.historyIndex = -1;
        this.blank = true;
        this.attachWikiDisplayContextMenu();
    }

    isStandaloneWindow() {
        return true;
    }

    isBlank() {
        return this.blank === true;
    }

    showBlankPlaceholder() {
        this.blank = true;
        this.history = [];
        this.historyIndex = -1;
        this.currentSelectedTag = null;
        this.currentTagName = null;
        if (this.displayArea) {
            this.displayArea.innerHTML = `
                <div class="tag-wiki-split-blank-state">
                    <i class="fas fa-book-open"></i>
                    <p>Open a link on the right, or swap panels to browse here.</p>
                </div>
            `;
        }
    }

    captureState() {
        return {
            blank: this.blank === true,
            history: this.history.map((entry) => ({ ...entry })),
            historyIndex: this.historyIndex,
            currentSelectedTag: this.currentSelectedTag,
            currentTagName: this.currentTagName,
            displayHtml: this.displayArea ? this.displayArea.innerHTML : ''
        };
    }

    applyState(state) {
        if (!state) return;
        this.blank = state.blank === true;
        this.history = (state.history || []).map((entry) => ({ ...entry }));
        this.historyIndex = state.historyIndex;
        this.currentSelectedTag = state.currentSelectedTag || null;
        this.currentTagName = state.currentTagName || null;
        if (this.displayArea) {
            this.displayArea.innerHTML = state.displayHtml || '';
            if (!this.blank) {
                this.rebindDisplayContent();
            }
        }
        // Clear cached address so sync after swap uses the freshly applied state
        // (history, currentTagName, currentStaticWiki) instead of stale pre-swap address.
        delete this._currentAddress;
    }

    async openTagByName(tagName) {
        const t = String(tagName || '').trim();
        if (!t) return;
        this.blank = false;
        await this.getTagWikiPageDirectly(t);
    }

    addToHistory(entry) {
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        this.history.push(entry);
        this.historyIndex = this.history.length - 1;
        const capped = capTagWikiHistoryEntries(this.history, this.historyIndex);
        this.history = capped.history;
        this.historyIndex = capped.historyIndex;
        this.blank = false;
    }

    goBack() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.restoreHistoryEntry(this.history[this.historyIndex]);
        }
    }

    goForward() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.restoreHistoryEntry(this.history[this.historyIndex]);
        }
    }

    restoreHistoryEntry(entry) {
        if (!entry) return;
        this.blank = false;
        if (entry.type === 'home') {
            this.currentSelectedTag = null;
            this.currentTagName = null;
            this.showDreamWikiHomepage();
            return;
        }
        if (entry.type === 'static-wiki-index') {
            this.currentSelectedTag = null;
            this.currentTagName = null;
            this.showStaticWikiSiteIndex(entry.siteId);
            return;
        }
        if (entry.type === 'static-wiki-page') {
            this.currentSelectedTag = null;
            this.currentTagName = null;
            if (entry.content) {
                this.renderWikiPage(entry.content);
            } else {
                this.openStaticWikiPage(entry.siteId, entry.pageId);
            }
            return;
        }
        if (entry.type === 'wiki') {
            if (entry.tag) {
                this.currentSelectedTag = entry.tag;
                if (entry.content) {
                    this.renderWikiPage(entry.content);
                } else {
                    this.getTagWikiPageDirectly(entry.tag.title || entry.tag.name);
                }
            }
        }

        if (entry.type === 'dsap' && entry.url) {
            this.currentSelectedTag = null;
            this.currentTagName = null;
            // navigateDsapIfMatched: public/scripts/comp/dsapRegistry.js
            if (typeof navigateDsapIfMatched === 'function') {
                navigateDsapIfMatched(this, entry.url, { skipHistory: true, skipLoadingDelay: true });
            }
            return;
        }

        if (entry.query !== undefined || entry.type === 'search') {
            const qq = entry.query || '';
            if (this.displayArea) {
                this.displayArea.innerHTML = `<div class="search-in-window">Search “${this.escapeHtml(qq || 'home')}” — full search page with gear filters is in the main Grimoire window.</div>`;
            }
            return;
        }
    }

    goHome() {
        this.blank = false;
        this.currentSelectedTag = null;
        this.currentTagName = null;
        this.currentStaticWiki = null;
        this.history = [{ type: 'home' }];
        this.historyIndex = 0;
        this.showDreamWikiHomepage();
    }

    // When the right pane renders or navigates, notify the main host so that if this
    // pane is currently the active one, the shared address bar + top controls get updated.
    setAddress(args) {
        super.setAddress(args);
        const host = window.tagWikiSearchModal;
        if (host && typeof host.notifyPaneAddressChanged === 'function') {
            host.notifyPaneAddressChanged(this);
        }
    }
}

class WikiWindowManager {
    constructor() {
        this.windows = new Map(); // Map of window IDs to window instances
        this.nextId = 1;
        this.template = null;
    }
    
    init() {
        this.template = document.getElementById('tagWikiWindowTemplate');
        if (!this.template) {
            console.error('Tag wiki window template not found');
            return;
        }
    }
    
    // Create a new wiki window instance
    createWindow(initialContent, initialTag = null, historyToCopy = null) {
        // Ensure initialization has happened
        if (!this.template) {
            this.init();
        }
        
        if (!this.template) {
            console.error('Cannot create wiki window: template not found');
            return null;
        }
        
        const windowId = `wikiWindow_${this.nextId++}`;
        const windowElement = this.template.cloneNode(true);
        windowElement.id = windowId;
        
        // Update IDs to be unique
        this.updateElementIds(windowElement, windowId);
        
        // Set stable identifier for position restoration (based on tag name)
        let tagName = null;
        if (initialTag) {
            if (typeof initialTag === 'string') {
                tagName = initialTag;
            } else if (typeof initialTag === 'object' && initialTag.name) {
                tagName = initialTag.name;
            } else if (typeof initialTag === 'object' && initialTag.title) {
                tagName = initialTag.title;
            }
        } else if (initialContent && initialContent.staticWiki && initialContent.siteId && initialContent.pageId) {
            tagName = `${initialContent.siteId}:${initialContent.pageId}`;
        } else if (initialContent && (initialContent.tagName || initialContent.title)) {
            tagName = initialContent.tagName || initialContent.title;
        }

        let windowIdentifier = tagName ? `wikiWindow:${tagName}` : `wikiWindow:${windowId}`;
        if (tagName) {
            windowElement.dataset.windowIdentifier = windowIdentifier;
        }
        
        // If clone has scrollbar structure from template, register it in map BEFORE inserting into DOM
        // This prevents MutationObserver from trying to initialize it again (which would cause nesting)
        if (window.customScrollbar) {
            const displayPanel = windowElement.querySelector('.tag-wiki-search-display.form-section-scroll');
            if (displayPanel) {
                const scrollableContent = displayPanel.querySelector('.scrollable-content');
                const scrollbar = displayPanel.querySelector('.custom-scrollbar');
                const thumb = scrollbar?.querySelector('.custom-scrollbar-thumb');
                
                if (scrollableContent && scrollbar && thumb) {
                    // Clone has scrollbar structure - register it in map so MutationObserver skips it
                    window.customScrollbar.scrollbars.set(displayPanel, {
                        scrollableContent,
                        scrollbar,
                        thumb
                    });
                    // Initialize functionality and update
                    window.customScrollbar.initScrollbarFunctionality(displayPanel, scrollableContent, scrollbar, thumb);
                    window.customScrollbar.updateScrollbar(displayPanel);
                }
            }
        }
        
        // Insert into DOM (MutationObserver will see it's already in map and skip initialization)
        document.body.appendChild(windowElement);
        
        // Create window instance (MutationObserver will handle scrollbar initialization)
        const windowInstance = new WikiWindowInstance(windowId, windowElement, initialContent, initialTag, this, historyToCopy);
        this.windows.set(windowId, windowInstance);
        
        // Mark this transient window for position restoration (wiki shortcuts need positions)
        transientWindowsWithPositions.add(windowIdentifier);
        
        return windowInstance;
    }

    createDsapWindow(dsapUrl, historyToCopy = null) {
        if (!this.template) {
            this.init();
        }
        if (!this.template) {
            console.error('Cannot create DSAP window: template not found');
            return null;
        }

        const targetUrl = String(dsapUrl || '').trim();
        const windowId = `wikiWindow_${this.nextId++}`;
        const windowElement = this.template.cloneNode(true);
        windowElement.id = windowId;
        this.updateElementIds(windowElement, windowId);

        const windowIdentifier = `wikiWindow:dsap:${targetUrl}`;
        windowElement.dataset.windowIdentifier = windowIdentifier;

        if (customScrollbar) {
            const displayPanel = windowElement.querySelector('.tag-wiki-search-display.form-section-scroll');
            if (displayPanel) {
                const scrollableContent = displayPanel.querySelector('.scrollable-content');
                const scrollbar = displayPanel.querySelector('.custom-scrollbar');
                const thumb = scrollbar?.querySelector('.custom-scrollbar-thumb');
                if (scrollableContent && scrollbar && thumb) {
                    customScrollbar.scrollbars.set(displayPanel, {
                        scrollableContent,
                        scrollbar,
                        thumb
                    });
                    customScrollbar.initScrollbarFunctionality(displayPanel, scrollableContent, scrollbar, thumb);
                    customScrollbar.updateScrollbar(displayPanel);
                }
            }
        }

        document.body.appendChild(windowElement);

        const windowInstance = new WikiWindowInstance(
            windowId,
            windowElement,
            null,
            null,
            this,
            historyToCopy,
            { dsapUrl: targetUrl }
        );
        this.windows.set(windowId, windowInstance);
        transientWindowsWithPositions.add(windowIdentifier);
        return windowInstance;
    }
    
    // Update element IDs to be unique for this window instance
    updateElementIds(element, windowId) {
        const elementsWithIds = element.querySelectorAll('[id]');
        elementsWithIds.forEach(el => {
            const originalId = el.id;
            el.id = `${originalId}_${windowId}`;
        });
    }
    
    // Remove a window instance
    removeWindow(windowId) {
        const windowInstance = this.windows.get(windowId);
        if (windowInstance) {
            windowInstance.destroy();
            this.windows.delete(windowId);
        }
    }
    
    // Get window by ID
    getWindow(windowId) {
        const windowInstance = this.windows.get(windowId);
        return windowInstance ? windowInstance : null;
    }
}

// Wiki Window Instance - manages a standalone wiki window
class WikiWindowInstance extends WikiDisplayBase {
    constructor(id, element, initialContent, initialTag, manager, historyToCopy = null, options = null) {
        super();
        this.id = id;
        this.modal = element;
        this.manager = manager;
        this.backBtn = null;
        this.forwardBtn = null;
        this.homeBtn = null;
        this.closeBtn = null;
        this.maximizeBtn = null;
        this.initialDsapUrl = options && options.dsapUrl ? String(options.dsapUrl) : null;
        
        this.currentSelectedTag = initialTag;
        this.initialContent = initialContent;
        this.initialTag = initialTag;
        
        // If history is being copied, use it; otherwise start fresh
        if (historyToCopy && Array.isArray(historyToCopy)) {
            // Deep copy the history array (this already includes the current page as the last entry)
            this.history = historyToCopy.map(entry => ({ ...entry }));
            // Set index to the last entry (the current page)
            this.historyIndex = this.history.length - 1;
        } else {
            this.history = [];
            this.historyIndex = -1;
        }
        
        this.init();
    }
    
    init() {
        // Get references using unique IDs
        this.displayArea = this.modal.querySelector('.tag-wiki-display-content');
        this.backBtn = this.modal.querySelector('.wiki-window-back-btn');
        this.forwardBtn = this.modal.querySelector('.wiki-window-forward-btn');
        this.homeBtn = this.modal.querySelector('.wiki-window-home-btn');
        this.closeBtn = this.modal.querySelector('.wiki-window-close-btn');
        this.maximizeBtn = this.modal.querySelector('.wiki-window-maximize-btn');
        
        // Setup event listeners
        if (this.backBtn) {
            this.backBtn.addEventListener('click', () => this.goBack());
            this.setupBackButtonContextMenu();
        }
        if (this.forwardBtn) {
            this.forwardBtn.addEventListener('click', () => this.goForward());
            this.setupForwardButtonContextMenu();
        }
        if (this.homeBtn) {
            this.homeBtn.addEventListener('click', () => this.goHome());
        }
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.close());
        }
        if (this.maximizeBtn) {
            this.maximizeBtn.addEventListener('click', () => this.maximizeToMainWindow());
        }
        
        // Update navigation buttons to populate context menus initially
        this.updateNavigationButtons();
        
        // Setup minimize button
        const minimizeBtn = this.modal.querySelector('.minimize-btn');
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => {
                if (window.minimizeModal) {
                    window.minimizeModal(this.modal);
                }
            });
        }
        
        this.attachWikiDisplayContextMenu();
        
        // Open the modal first (same pattern as main modal)
        openModal(this.modal);
        
        // Render initial content
        if (this.initialDsapUrl) {
            // navigateDsapIfMatched: public/scripts/comp/dsapRegistry.js
            if (typeof navigateDsapIfMatched === 'function') {
                navigateDsapIfMatched(this, this.initialDsapUrl);
            }
        } else if (this.initialContent) {
            this.renderWikiPage(this.initialContent);
            if (this.history.length === 0) {
                if (this.initialContent.staticWiki) {
                    this.addToHistory({
                        type: 'static-wiki-page',
                        siteId: this.initialContent.siteId,
                        pageId: this.initialContent.pageId,
                        title: this.initialContent.title || this.initialContent.pageId,
                        content: this.initialContent
                    });
                } else {
                    this.addToHistory({
                        type: 'wiki',
                        tag: this.initialTag,
                        content: this.initialContent
                    });
                }
            } else {
                // History was copied, just update navigation buttons
                this.updateNavigationButtons();
            }
        }
    }
    
    navigate(url) {
        const target = String(url || '').trim();
        if (!target) return;

        // navigateDsapIfMatched: public/scripts/comp/dsapRegistry.js
        if (typeof navigateDsapIfMatched === 'function' && navigateDsapIfMatched(this, target)) {
            return;
        }

        // Prefer the unified domain registry (same as main Grimoire browser).
        if (typeof navigateDsapIfMatched === 'function' && navigateDsapIfMatched(this, target)) {
            return;
        }

        // Legacy fallback for initial content in standalone wiki windows
        const routePath = typeof grimoireStripPseudoProtocol === 'function'
            ? grimoireStripPseudoProtocol(target)
            : target.replace(/^(edtx|rdf|dsap):\/\//i, '');
        const lower = routePath.toLowerCase();

        if (lower.includes('wiki.danbooru.jp/tag/') || lower.includes('wiki.e621.com/tag/')) {
            const m = routePath.match(/\/tag\/([^/?#]+)/i);
            const tag = m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : '';
            if (tag) this.getTagWikiPageDirectly(tag);
            return;
        }

        if (lower.includes('docs.novelai.jp') || lower.includes('novelai.jp/docs')) {
            let rest = routePath.replace(/^docs\.novelai\.jp\/?/i, '');
            const pageId = rest || '';
            if (pageId) this.openStaticWikiPage('novelai', pageId);
            else this.showStaticWikiSiteIndex('novelai');
        }
    }

    openInNewWindow() {
        if (this._dsapActive && this._dsapState?.url) {
            // openDsapInStandaloneWindow: public/scripts/comp/dsapRegistry.js
            if (typeof openDsapInStandaloneWindow === 'function') {
                const historyToCopy = this.history && this.history.length > 0
                    ? this.history.slice(0, this.historyIndex + 1)
                    : null;
                openDsapInStandaloneWindow(this._dsapState.url, { historyToCopy });
                return;
            }
        }

        if (!this.displayArea) return;
        
        const currentContent = this.getCurrentPageContent();
        if (currentContent && this.manager) {
            // Copy history up to and including current entry
            const historyToCopy = this.history && this.history.length > 0 
                ? this.history.slice(0, this.historyIndex + 1)
                : null;
            
            this.manager.createWindow(currentContent, this.currentSelectedTag, historyToCopy);
        }
    }
    
    addToHistory(entry) {
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        
        this.history.push(entry);
        this.historyIndex = this.history.length - 1;
        const capped = capTagWikiHistoryEntries(this.history, this.historyIndex);
        this.history = capped.history;
        this.historyIndex = capped.historyIndex;
        
        this.updateNavigationButtons();
    }
    
    goHome() {
        if (this.initialDsapUrl) {
            // navigateDsapIfMatched, resolveDsap: public/scripts/comp/dsapRegistry.js
            const target = this.initialDsapUrl;
            if (typeof navigateDsapIfMatched === 'function') {
                navigateDsapIfMatched(this, target, { skipHistory: true, skipLoadingDelay: true });
            }
            const match = typeof resolveDsap === 'function' ? resolveDsap(target) : null;
            this.history = [{
                type: 'dsap',
                url: match ? match.canonicalUrl : target,
                title: match?.entry?.title || 'Applet'
            }];
            this.historyIndex = 0;
            this.updateNavigationButtons();
            return;
        }

        if (this.initialContent) {
            this.renderWikiPage(this.initialContent);
            if (this.initialContent.staticWiki) {
                this.currentSelectedTag = null;
                this.history = [{
                    type: 'static-wiki-page',
                    siteId: this.initialContent.siteId,
                    pageId: this.initialContent.pageId,
                    title: this.initialContent.title,
                    content: this.initialContent
                }];
            } else {
                this.currentSelectedTag = this.initialTag;
                this.history = [{
                    type: 'wiki',
                    tag: this.initialTag,
                    content: this.initialContent
                }];
            }
            this.historyIndex = 0;
            this.updateNavigationButtons();
        } else if (tagWikiSearchModal) {
            tagWikiSearchModal.getTagWikiPageDirectly('tag groups');
        }
    }
    
    restoreHistoryEntry(entry) {
        if (!entry) return;

        if (entry.type === 'static-wiki-index') {
            this.currentSelectedTag = null;
            this.currentTagName = null;
            this.currentStaticWiki = null;
            this.showStaticWikiSiteIndex(entry.siteId);
            this.updateNavigationButtons();
            return;
        }

        if (entry.type === 'static-wiki-page') {
            this.currentSelectedTag = null;
            this.currentTagName = null;
            if (entry.content) {
                this.renderWikiPage(entry.content);
            } else {
                this.openStaticWikiPage(entry.siteId, entry.pageId);
            }
            this.updateNavigationButtons();
            return;
        }
        
        if (entry.type === 'wiki') {
            if (entry.tag) {
                this.currentSelectedTag = entry.tag;
                this.currentStaticWiki = null;
                if (entry.content) {
                    this.renderWikiPage(entry.content);
                } else {
                    this.getTagWikiPageDirectly(entry.tag.title || entry.tag.name);
                }
            }
        }

        if (entry.type === 'dsap' && entry.url) {
            this.currentSelectedTag = null;
            this.currentTagName = null;
            // navigateDsapIfMatched: public/scripts/comp/dsapRegistry.js
            if (typeof navigateDsapIfMatched === 'function') {
                navigateDsapIfMatched(this, entry.url, { skipHistory: true, skipLoadingDelay: true });
            }
            this.updateNavigationButtons();
            return;
        }

        if (entry.query !== undefined || entry.type === 'search') {
            const qq = entry.query || '';
            if (this.displayArea) {
                this.displayArea.innerHTML = `<div class="search-in-window">Search “${this.escapeHtml(qq || 'home')}” — interactive search page is available in the main Grimoire window.</div>`;
            }
            this.updateNavigationButtons();
            return;
        }
        
        this.updateNavigationButtons();
    }
    
    updateNavigationButtons() {
        // Update button disabled states
        if (this.backBtn) {
            this.backBtn.disabled = this.historyIndex <= 0;
        }
        if (this.forwardBtn) {
            this.forwardBtn.disabled = this.historyIndex >= this.history.length - 1;
        }
        
        // Update back button context menu
        if (this.backMenuConfig && contextMenu && this.backBtn) {
            const backItems = [];
            const isStandalone = this.isStandaloneWindow();
            
            for (let i = this.historyIndex - 1; i >= 0; i--) {
                const entry = this.history[i];
                
                // Standalone windows: wiki, DSAP, and static docs in history menus
                if (isStandalone && !['wiki', 'dsap', 'static-wiki-page', 'static-wiki-index'].includes(entry.type)) {
                    continue;
                }
                
                const displayText = this.getHistoryEntryDisplayText(entry, i);
                backItems.push({
                    text: displayText,
                    icon: this.getHistoryEntryMenuIcon(entry),
                    action: `wiki-back-to-${i}`,
                    data: { index: i }
                });
            }
            
            // If no items, add a "No history" message
            if (backItems.length === 0) {
                backItems.push({
                    text: 'No history',
                    icon: 'fas fa-info-circle',
                    action: 'wiki-no-action',
                    disabled: true
                });
            }
            
            this.backMenuConfig.sections[0].items = backItems;
            contextMenu.detachFromElement(this.backBtn);
            contextMenu.attachToElement(this.backBtn, this.backMenuConfig);
        }
        
        // Update forward button context menu
        if (this.forwardMenuConfig && contextMenu && this.forwardBtn) {
            const forwardItems = [];
            const isStandalone = this.isStandaloneWindow();
            
            for (let i = this.historyIndex + 1; i < this.history.length; i++) {
                const entry = this.history[i];
                
                // Standalone windows: wiki, DSAP, and static docs in history menus
                if (isStandalone && !['wiki', 'dsap', 'static-wiki-page', 'static-wiki-index'].includes(entry.type)) {
                    continue;
                }
                
                const displayText = this.getHistoryEntryDisplayText(entry, i);
                forwardItems.push({
                    text: displayText,
                    icon: this.getHistoryEntryMenuIcon(entry),
                    action: `wiki-forward-to-${i}`,
                    data: { index: i }
                });
            }
            
            // If no items, add a "No history" message
            if (forwardItems.length === 0) {
                forwardItems.push({
                    text: 'No history',
                    icon: 'fas fa-info-circle',
                    action: 'wiki-no-action',
                    disabled: true
                });
            }
            
            this.forwardMenuConfig.sections[0].items = forwardItems;
            contextMenu.detachFromElement(this.forwardBtn);
            contextMenu.attachToElement(this.forwardBtn, this.forwardMenuConfig);
        }
    }
    
    maximizeToMainWindow() {
        if (!window.tagWikiSearchModal) {
            console.error('Main wiki modal not available');
            return;
        }

        if (this._dsapActive && this._dsapState?.url) {
            const historyToCopy = this.history && this.history.length > 0
                ? this.history.slice(0, this.historyIndex + 1)
                : [];
            const dsapUrl = this._dsapState.url;
            window.tagWikiSearchModal.open('', { skipInitialHome: true, initialAddress: dsapUrl });
            // navigateDsapIfMatched: public/scripts/comp/dsapRegistry.js
            if (typeof navigateDsapIfMatched === 'function') {
                navigateDsapIfMatched(window.tagWikiSearchModal, dsapUrl, { skipHistory: true, skipLoadingDelay: true });
            }
            if (historyToCopy.length > 0) {
                window.tagWikiSearchModal.history = historyToCopy.map((entry) => ({ ...entry }));
                window.tagWikiSearchModal.historyIndex = historyToCopy.length - 1;
                window.tagWikiSearchModal.updateNavigationButtons();
            }
            this.close();
            return;
        }
        
        // Get current page content
        const currentContent = this.getCurrentPageContent();
        if (!currentContent || !this.currentSelectedTag) {
            console.error('No content to maximize');
            return;
        }
        
        // Get current tag name
        const tagName = this.currentSelectedTag.title || this.currentSelectedTag.name;
        if (!tagName) {
            console.error('No tag name available');
            return;
        }
        
        // Copy history to main window (up to and including current entry)
        const historyToCopy = this.history && this.history.length > 0 
            ? this.history.slice(0, this.historyIndex + 1)
            : [];
        
        // Open main modal
        window.tagWikiSearchModal.open('', { skipInitialHome: true });
        
        // Navigate to current page in main window
        // Use getTagWikiPageDirectly to load the page
        window.tagWikiSearchModal.getTagWikiPageDirectly(tagName).then((result) => {
            // Copy history to main window if there's history
            if (historyToCopy.length > 0 && window.tagWikiSearchModal.history) {
                // Replace the history with copied history
                // The current page was just added by getTagWikiPageDirectly, so we need to replace it
                // with the copied history which already includes the current page
                window.tagWikiSearchModal.history = historyToCopy.map(entry => ({ ...entry }));
                window.tagWikiSearchModal.historyIndex = historyToCopy.length - 1;
                window.tagWikiSearchModal.updateNavigationButtons();
            } else if (result && window.tagWikiSearchModal.hasWikiPageContent(result)) {
                // If no history to copy, ensure the current page is in history
                // (getTagWikiPageDirectly should have already added it, but ensure it's there)
                if (window.tagWikiSearchModal.history.length === 0) {
                    window.tagWikiSearchModal.addToHistory({
                        type: 'wiki',
                        tag: { title: tagName, name: tagName },
                        content: result
                    });
                }
            }
        }).catch(error => {
            console.error('Failed to navigate main window:', error);
        });
        
        // Close this standalone window
        this.close();
    }
    
    close() {
        const finish = () => {
            if (this.manager) {
                this.manager.removeWindow(this.id);
            }
        };

        if (this.modal && closeModal) {
            Promise.resolve(closeModal(this.modal)).then(finish);
        } else {
            finish();
        }
    }
    
    destroy() {
        // deactivateDsapOnShell: public/scripts/comp/dsapRegistry.js
        if (typeof deactivateDsapOnShell === 'function') deactivateDsapOnShell(this);

        // Detach context menus
        if (contextMenu) {
            this.contextMenuElements.forEach(element => {
                if (element && element.parentNode) {
                    contextMenu.detachFromElement(element);
                }
            });
        }
        this.contextMenuElements = [];
        
        // Remove modal from DOM
        if (this.modal && this.modal.parentNode) {
            this.modal.parentNode.removeChild(this.modal);
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

class TagWikiSearchModal extends WikiDisplayBase {
    constructor() {
        super();
        this._activePane = 'left';
        this._searchResultIndex = -1;
        this.modal = null;
        this.searchInput = null;
        this.filterDropdown = null;
        this.filterDropdownBtn = null;
        this.filterDropdownMenu = null;
        this.filterIcon = null;
        this.searchTypeDropdown = null;
        this.searchTypeDropdownBtn = null;
        this.searchTypeDropdownMenu = null;
        this.searchTypeIcon = null;
        this.sourceDropdown = null;
        this.sourceDropdownBtn = null;
        this.sourceDropdownMenu = null;
        this.sourceIcon = null;
        this._searchPageMode = false; // used to suppress old sidebar + auto-direct-match when treating search as a navigable page (set in navigate for search URLs)
        this.resultsList = null;
        this.backBtn = null;
        this.forwardBtn = null;
        this.homeBtn = null;
        this.closeBtn = null;
        this.searchBody = null;
        this.resultsScrollPanel = null;
        this.resultsCollapseBtn = null;
        this.resultsSidebarToggleBtn = null;
        this.splitSwapBtn = null;
        this.splitDividerEl = null;
        this.rightPaneEl = null;
        this.rightPane = null;
        this.resultsOverlayBackdrop = null;
        this.onlineToggleBtn = null;
        this.refreshBtn = null;
        this.searchControlElements = [];
        this.hasEverMaximized = false;
        
        this.history = [];
        this.historyIndex = -1;
        this.currentSearchResults = [];
        this.resultsSidebarManualCollapsed = false;
        this.RESULTS_SIDEBAR_AUTO_COLLAPSE_WIDTH = 900;
        
        // Current filter values
        this.currentFilter = '';
        this.currentSearchType = 'name';
        this.includeOnline = false;
        this.lastOnlineSectionCount = null;
        this.lastOnlineTagOnlyCount = null;
        
        try {
            this.includeOnline = localStorage.getItem(GRIMOIRE_ONLINE_SEARCH_LS) === 'true';
        } catch (e) {
            this.includeOnline = false;
        }
        
        this.init();
    }
    
    init() {
        this.modal = document.getElementById('tagWikiSearchModal');
        if (!this.modal) return;
        
        this.searchInput = document.getElementById('tagWikiSearchInput');
        this.displayArea = document.getElementById('tagWikiSearchDisplay');
        this.backBtn = document.getElementById('tagWikiSearchBackBtn');
        this.forwardBtn = document.getElementById('tagWikiSearchForwardBtn');
        this.homeBtn = document.getElementById('tagWikiSearchHomeBtn');
        this.closeBtn = document.getElementById('closeTagWikiSearchModalBtn');
        this.searchBody = this.modal.querySelector('.tag-wiki-search-body');
        this.splitSwapBtn = document.getElementById('tagWikiSearchSplitSwapBtn');
        this.splitDividerEl = document.getElementById('tagWikiSearchSplitDivider');
        this.rightPaneEl = document.getElementById('tagWikiSearchRightPane');
        this.refreshBtn = document.getElementById('tagWikiSearchRefreshBtn');

        // Layered pseudo-browser address bar elements (new two-layer widget)
        this.addressBar = document.getElementById('grimoireAddressBar');
        this.addressDisplay = document.getElementById('grimoireAddressDisplay');
        this.addressEdit = document.getElementById('grimoireAddressEdit');
        this.addressPath = document.getElementById('grimoireAddressPath');
        this.addressModeIcon = document.getElementById('grimoireAddressModeIcon');

        // Dynamic right-pane toggle button (visible only when wide enough for dual view).
        // Placed as the last (rightmost) button in the title toolbar, using exact same class as the home button.
        this.rightToggleBtn = null;
        const toolbarParent = (this.homeBtn && this.homeBtn.parentNode) || (this.addressBar && this.addressBar.parentNode);
        if (toolbarParent) {
            this.rightToggleBtn = document.createElement('button');
            this.rightToggleBtn.type = 'button';
            this.rightToggleBtn.className = 'btn-secondary btn-toggle';
            this.rightToggleBtn.id = 'tagWikiSearchRightToggleBtn';
            this.rightToggleBtn.title = 'Toggle Right Side Panel';
            this.rightToggleBtn.innerHTML = '<i class="fas fa-columns"></i>';
            this.rightToggleBtn.style.display = 'none';
            // Insert after the address bar so it is the rightmost/last button on the right side of the browser toolbar
            if (this.addressBar && this.addressBar.parentNode) {
                this.addressBar.parentNode.insertBefore(this.rightToggleBtn, this.addressBar.nextSibling);
            } else if (this.homeBtn && this.homeBtn.nextSibling) {
                this.homeBtn.parentNode.insertBefore(this.rightToggleBtn, this.homeBtn.nextSibling);
            } else {
                toolbarParent.appendChild(this.rightToggleBtn);
            }
            this.rightToggleBtn.addEventListener('click', () => this.toggleRightPane());
        }

        // Note: old sidebar results controls (filter/source/type/online btns that lived in the
        // removed .tag-wiki-search-results-panel header) are gone. Search options for the
        // results "page" are now provided exclusively by the gear in showSearchResultsPage
        // (using the modern highlighted submenu gear menu).
        this.setupClickMenus(); // still wires any remaining (e.g. for split or other)
        this.setupEventListeners();
        this.setupSplitModeListeners();
        this.setupContextMenu();
        // updateSearchControlsVisibility no longer needed (no old header controls to toggle)
    }

    setupSplitModeListeners() {
        if (!this.modal || this._splitModeListenersWired) return;
        this._splitModeListenersWired = true;

        // Use check logic for both max/restore and resize, so split is available on wide windows too
        this._boundCheckSplitMaximized = () => this.checkAndUpdateSplitMode();
        this._boundCheckSplitResize = () => this.checkAndUpdateSplitMode();
        this._boundSplitSwapClick = () => this.swapSplitPanes();
        this._boundAddressOutsideMousedown = (e) => {
            if (!this.addressBar) return;
            if (this.addressBar.classList.contains('edit-active')) {
                if (!this.addressBar.contains(e.target)) {
                    this.exitAddressEditAndRestore();
                }
            }
        };

        // attachModalListeners: public/scripts/comp/modalListenerScope.js
        attachModalListeners(this.modal, (signal) => {
            this.modal.addEventListener('modalMaximized', this._boundCheckSplitMaximized, { signal });
            this.modal.addEventListener('modalRestored', this._boundCheckSplitMaximized, { signal });
            this.modal.addEventListener('modalResized', this._boundCheckSplitResize, { signal });
            if (this.splitSwapBtn) {
                this.splitSwapBtn.addEventListener('click', this._boundSplitSwapClick, { signal });
            }
            window.addEventListener('resize', this._boundCheckSplitResize, { signal });
            document.addEventListener('mousedown', this._boundAddressOutsideMousedown, { capture: true, signal });
            setTimeout(() => this.checkAndUpdateSplitMode(), 120);
        });
    }

    teardownSplitModeListeners() {
        if (!this.modal) return;
        // detachModalListeners: public/scripts/comp/modalListenerScope.js
        detachModalListeners(this.modal);
    }

    checkAndUpdateSplitMode() {
        if (!this.modal || !this.rightPaneEl || !this.splitDividerEl) return;
        const isMaximized = this.modal.classList.contains('modal-maximized');
        const wideEnough = (this.modal.offsetWidth || 0) >= GRIMOIRE_SPLIT_MIN_WIDTH;
        const isCurrentlySplit = this.modal.classList.contains('tag-wiki-split-active');

        const userWantsSplit = this.loadSplitPanelPreference();
        const shouldBeSplit = isMaximized || (wideEnough && userWantsSplit);

        if (shouldBeSplit) {
            if (!isCurrentlySplit || !this.rightPane) {
                this.enterSplitMode();
                this.setActivePane('left');
            }
        } else if (isCurrentlySplit && !isMaximized) {
            this.exitSplitMode();
            this._activePane = 'left';
        }

        // Reflect the resulting split state (after enter/exit) so the toggle button
        // never shows a stale label/active state.
        this.updateSplitToggleButton(
            wideEnough,
            this.modal.classList.contains('tag-wiki-split-active'),
            isMaximized
        );
    }

    loadSplitPanelPreference() {
        try {
            const stored = localStorage.getItem(GRIMOIRE_SPLIT_PANEL_LS);
            if (stored === null) {
                return true;
            }
            return stored === 'true';
        } catch (e) {
            return true;
        }
    }

    saveSplitPanelPreference(enabled) {
        try {
            localStorage.setItem(GRIMOIRE_SPLIT_PANEL_LS, enabled ? 'true' : 'false');
        } catch (e) {
            /* */
        }
    }

    updateSplitToggleButton(wideEnough, isCurrentlySplit, isMaximized) {
        if (!this.rightToggleBtn) {
            return;
        }
        const showToggle = wideEnough || isMaximized;
        this.rightToggleBtn.style.display = showToggle ? '' : 'none';
        this.rightToggleBtn.classList.toggle('active', isCurrentlySplit);
        this.rightToggleBtn.dataset.state = isCurrentlySplit ? 'on' : 'off';
        this.rightToggleBtn.title = isCurrentlySplit
            ? 'Hide Right Side Panel'
            : 'Show Right Side Panel';
    }

    toggleRightPane() {
        if (!this.modal || !this.rightPaneEl) return;
        const wideEnough = (this.modal.offsetWidth || 0) >= GRIMOIRE_SPLIT_MIN_WIDTH;
        const isMaximized = this.modal.classList.contains('modal-maximized');
        const isActive = this.modal.classList.contains('tag-wiki-split-active');
        if (isActive) {
            this.exitSplitMode();
            this.saveSplitPanelPreference(false);
        } else {
            if (!wideEnough && !isMaximized) return;
            this.enterSplitMode();
            this.saveSplitPanelPreference(true);
        }
        this.updateSplitToggleButton(
            wideEnough,
            this.modal.classList.contains('tag-wiki-split-active'),
            isMaximized
        );
        this._notifyGrimoireKeyboardOverlayContextChanged();
    }

    needsResultsOverlay() {
        const modalWidth = this.modal ? (this.modal.offsetWidth || 0) : 0;
        const tooSmall = modalWidth > 0 && modalWidth <= this.RESULTS_SIDEBAR_AUTO_COLLAPSE_WIDTH;
        return this.isSplitMode() || tooSmall;
    }

    isResultsSidebarOpen() {
        if (!this.searchBody || !this.modal) return false;
        if (this.needsResultsOverlay()) {
            return this.modal.classList.contains('tag-wiki-results-overlay-open');
        }
        return !this.searchBody.classList.contains('results-sidebar-collapsed');
    }

    shouldShowResultsSidebarToggle() {
        if (!this.searchBody || !this.modal) return false;
        if (this.needsResultsOverlay()) {
            return true;
        }
        return this.searchBody.classList.contains('results-sidebar-collapsed');
    }

    updateResultsSidebarToggle() {
        if (!this.resultsSidebarToggleBtn) return;
        const overlayMode = this.needsResultsOverlay();
        const sidebarOpen = this.isResultsSidebarOpen();
        this.resultsSidebarToggleBtn.classList.toggle('hidden', !this.shouldShowResultsSidebarToggle());
        this.resultsSidebarToggleBtn.dataset.state = sidebarOpen ? 'on' : 'off';
        this.resultsSidebarToggleBtn.title = sidebarOpen
            ? (overlayMode ? 'Hide search results sidebar' : 'Collapse search results sidebar')
            : 'Show search results sidebar';
    }

    toggleResultsSidebar() {
        if (this.needsResultsOverlay()) {
            const open = this.modal.classList.contains('tag-wiki-results-overlay-open');
            if (open) {
                this.resultsSidebarManualCollapsed = true;
                this.setResultsOverlayOpen(false);
            } else {
                this.resultsSidebarManualCollapsed = false;
                this.setResultsOverlayOpen(true);
            }
        } else {
            this.resultsSidebarManualCollapsed = !this.resultsSidebarManualCollapsed;
            this.updateResultsSidebar();
        }
    }

    setResultsOverlayOpen(open) {
        if (!this.modal) return;
        const on = !!open;
        this.modal.classList.toggle('tag-wiki-results-overlay-open', on);
        if (this.resultsOverlayBackdrop) {
            this.resultsOverlayBackdrop.classList.toggle('hidden', !on);
        }
        if (on && this.resultsScrollPanel && window.customScrollbar) {
            window.customScrollbar.forceReinit(this.resultsScrollPanel);
        }
        if (this.needsResultsOverlay() && this.resultsCollapseBtn) {
            this.resultsCollapseBtn.disabled = !on;
            this.resultsCollapseBtn.title = on ? 'Hide search results' : 'Collapse results';
        }
        this.updateResultsSidebarToggle();
    }

    saveRightPaneStateToStorage() {
        if (!this.rightPane) return;
        try {
            localStorage.setItem(GRIMOIRE_RIGHT_PANE_LS, JSON.stringify(this.rightPane.captureState()));
        } catch (e) {
            /* */
        }
    }

    loadRightPaneStateFromStorage() {
        try {
            const raw = localStorage.getItem(GRIMOIRE_RIGHT_PANE_LS);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    clearRightPaneStateFromStorage() {
        try {
            localStorage.removeItem(GRIMOIRE_RIGHT_PANE_LS);
        } catch (e) {
            /* */
        }
    }

    isSplitMode() {
        if (!this.modal) return false;
        return this.modal.classList.contains('tag-wiki-split-active');
    }

    isWideEnoughForSplit() {
        if (!this.modal) return false;
        if (this.modal.classList.contains('modal-maximized')) return true;
        const w = this.modal.offsetWidth || (this.modal.getBoundingClientRect ? this.modal.getBoundingClientRect().width : 0);
        return w >= GRIMOIRE_SPLIT_MIN_WIDTH;
    }

    isRightPaneDisplay(displayArea) {
        return !!(this.rightPane && displayArea === this.rightPane.displayArea);
    }

    enterSplitMode() {
        if (!this.rightPaneEl || !this.splitDividerEl) return;
        this.hasEverMaximized = true;
        this.modal.classList.add('tag-wiki-split-active');
        this.modal.classList.remove('tag-wiki-results-overlay-open');
        this.rightPaneEl.classList.remove('hidden');
        this.splitDividerEl.classList.remove('hidden');
        if (!this.rightPane) {
            this.rightPane = new GrimoireSplitPane({
                displayArea: document.getElementById('tagWikiSearchRightDisplay')
            });
            const saved = this.loadRightPaneStateFromStorage();
            if (saved && saved.blank !== true) {
                this.rightPane.applyState(saved);
            } else {
                this.rightPane.showBlankPlaceholder();
            }
        }
        this.updateResultsSidebar();
        if (window.customScrollbar) {
            setTimeout(() => {
                const panel = this.rightPaneEl.querySelector('.tag-wiki-search-display.form-section-scroll');
                if (panel) window.customScrollbar.forceReinit(panel);
            }, 50);
        }

        // Make the panes "focusable" via click so the shared top address bar, gear, refresh,
        // and nav buttons (back/forward/home) target the correct pane's state.
        if (this.displayArea) {
            this.displayArea.addEventListener('mousedown', () => this.setActivePane('left'), true);
        }
        const rightContent = this.rightPaneEl ? this.rightPaneEl.querySelector('.tag-wiki-search-display, .tag-wiki-display-content') : null;
        if (rightContent) {
            rightContent.addEventListener('mousedown', () => this.setActivePane('right'), true);
        }

        // Default active to the primary (left) when we enter split
        if (!this._activePane) this._activePane = 'left';
    }

    exitSplitMode() {
        this.setResultsOverlayOpen(false);
        if (this.modal) {
            this.modal.classList.remove('tag-wiki-split-active', 'tag-wiki-results-overlay-open');
        }
        if (this.rightPaneEl) this.rightPaneEl.classList.add('hidden');
        if (this.splitDividerEl) this.splitDividerEl.classList.add('hidden');
        this.updateResultsSidebar();
    }

    showRightPane() {
        if (!this.modal || !this.rightPaneEl) return;
        this.enterSplitMode();
        const wideEnough = (this.modal.offsetWidth || 0) >= GRIMOIRE_SPLIT_MIN_WIDTH;
        this.updateSplitToggleButton(
            wideEnough,
            true,
            this.modal.classList.contains('modal-maximized')
        );
    }

    hideRightPane() {
        if (!this.modal || !this.rightPaneEl) return;
        this.exitSplitMode();
        const wideEnough = (this.modal.offsetWidth || 0) >= GRIMOIRE_SPLIT_MIN_WIDTH;
        this.updateSplitToggleButton(
            wideEnough,
            false,
            this.modal.classList.contains('modal-maximized')
        );
    }

    captureLeftWikiState() {
        return {
            blank: false,
            history: this.history.map((entry) => ({ ...entry })),
            historyIndex: this.historyIndex,
            currentSelectedTag: this.currentSelectedTag,
            currentTagName: this.currentTagName,
            displayHtml: this.displayArea ? this.displayArea.innerHTML : ''
        };
    }

    applyLeftWikiState(state) {
        if (!state) return;
        this.history = (state.history || []).map((entry) => ({ ...entry }));
        this.historyIndex = state.historyIndex;
        this.currentSelectedTag = state.currentSelectedTag || null;
        this.currentTagName = state.currentTagName || null;
        if (this.displayArea) {
            this.displayArea.innerHTML = state.displayHtml || '';
            this.rebindDisplayContent();
        }
        this.updateNavigationButtons();
        // Clear cached address so sync after swap will re-derive from the newly applied state
        // (currentTagName, history, currentStaticWiki etc.) instead of stale _currentAddress.
        delete this._currentAddress;
    }

    swapSplitPanes() {
        if (!this.isSplitMode() || !this.rightPane) return;
        const rightWasBlank = this.rightPane.isBlank();
        const leftState = this.captureLeftWikiState();
        const rightState = this.rightPane.captureState();
        this.rightPane.applyState(leftState);
        this.applyLeftWikiState(rightState);
        if (rightWasBlank) {
            this.goHome();
        }
        // After swapping contents between physical left and right, force-update the address bar
        // (both Layer 1 pretty display + icon, and Layer 2 edit input value via currentAddress)
        // and controls to whatever the active logical pane now holds (the data has moved).
        this.syncAddressAndControlsToActive();
        this._notifyGrimoireKeyboardOverlayContextChanged();
    }

    setActivePane(side) {
        if (!this.isSplitMode() || !this.rightPane) {
            this._activePane = 'left';
            return;
        }
        const newSide = (side === 'right') ? 'right' : 'left';
        if (this._activePane === newSide) return;
        this._activePane = newSide;
        this.syncAddressAndControlsToActive();
    }

    get activePane() {
        if (this.isSplitMode() && this.rightPane && this._activePane === 'right') {
            return this.rightPane;
        }
        return this;
    }

    syncAddressAndControlsToActive() {
        const pane = this.activePane;
        let addr = pane._currentAddress || pane.currentAddress;
        if (addr && addr.displayUrl) {
            this.setAddress({ displayUrl: addr.displayUrl, mode: addr.mode }, { force: true });
        } else {
            // Fallback derivation from the pane's current state / history
            const derived = this._getDerivedDisplayUrlForPane(pane);
            if (derived) {
                const m = derived.match(/^(edtx|rdf|dsap):/i);
                this.setAddress({ displayUrl: derived, mode: m ? m[1].toLowerCase() : 'edtx' }, { force: true });
            }
        }

        // If the active pane's current history entry is a search, sync the input value
        const h = pane.history || [];
        const idx = (typeof pane.historyIndex === 'number') ? pane.historyIndex : -1;
        const entry = (idx >= 0 && h[idx]) ? h[idx] : null;
        if (entry && this.searchInput && entry.query !== undefined) {
            this.searchInput.value = entry.query || '';
        }

        this.updateSearchControlsVisibility();
        if (typeof this.updateOnlineToggleState === 'function') {
            this.updateOnlineToggleState();
        }
        // Refresh the back/forward popup menus (they are built from the main instance's history;
        // the actual button click handlers already delegate to the active pane).
        if (typeof this.updateNavigationButtons === 'function') {
            this.updateNavigationButtons();
        }
    }

    _getDerivedDisplayUrlForPane(pane) {
        if (!pane) return 'edtx://en.grimoire.jp/index.dtxt';
        if (pane.currentStaticWiki) {
            const sw = pane.currentStaticWiki;
            const s = sw.siteId || '';
            const pid = sw.pageId || '';
            if (s === 'novelai' || /novelai/i.test(s)) {
                return pid ? `rdf://docs.novelai.jp/${pid}` : 'rdf://docs.novelai.jp/';
            }
            return pid ? `edtx://en.grimoire.jp/docs/${s}/${pid}` : `edtx://en.grimoire.jp/docs/${s}`;
        }
        const tag = (typeof pane.getCurrentTagName === 'function') ? pane.getCurrentTagName() : null;
        if (tag) {
            const enc = encodeURIComponent(String(tag).replace(/\s+/g, '_'));
            return `edtx://wiki.danbooru.jp/tag/${enc}`;
        }
        const entry = (pane.history && typeof pane.historyIndex === 'number') ? pane.history[pane.historyIndex] : null;
        if (entry) {
            if (entry.type === 'home') return 'edtx://en.grimoire.jp/index.dtxt';
            if (entry.query !== undefined) {
                return entry.query ? `edtx://en.grimoire.jp/search?q=${encodeURIComponent(entry.query)}` : 'edtx://en.grimoire.jp/search';
            }
            if (entry.type === 'static-wiki-page' && entry.siteId) {
                const s = entry.siteId;
                const pid = entry.pageId || '';
                if (s === 'novelai' || /novelai/i.test(s)) {
                    return pid ? `rdf://docs.novelai.jp/${pid}` : 'rdf://docs.novelai.jp/';
                }
                return pid ? `edtx://en.grimoire.jp/docs/${s}/${pid}` : `edtx://en.grimoire.jp/docs/${s}`;
            }
            if (entry.tag) {
                const t = entry.tag.name || entry.tag.title || '';
                const enc = encodeURIComponent(String(t).replace(/\s+/g, '_'));
                return `edtx://wiki.danbooru.jp/tag/${enc}`;
            }
        }
        return 'edtx://en.grimoire.jp/index.dtxt';
    }

    notifyPaneAddressChanged(paneInstance) {
        if (!paneInstance) return;
        if (this.activePane === paneInstance) {
            this.syncAddressAndControlsToActive();
        }
    }

    async openLinkOnPane(tagName, side) {
        const t = String(tagName || '').trim();
        if (!t) return;
        if (side === 'right') {
            if (!this.isWideEnoughForSplit()) return;
            if (!this.isSplitMode()) {
                this.enterSplitMode();
                this.saveSplitPanelPreference(true);
                const wideEnough = (this.modal.offsetWidth || 0) >= GRIMOIRE_SPLIT_MIN_WIDTH;
                this.updateSplitToggleButton(
                    wideEnough,
                    true,
                    this.modal.classList.contains('modal-maximized')
                );
            }
            if (!this.rightPane) return;
            await this.rightPane.openTagByName(t);
            this.setActivePane('right'); // after sending content to right, make the controls target it
            return;
        }
        await this.getTagWikiPageDirectly(t);
    }
    
    setupContextMenu() {
        this.attachWikiDisplayContextMenu();
    }
    
    
    setupClickMenus() {
        // Old click menus for the sidebar header buttons (filter/source/type) removed along with
        // the results sidebar. The gear menu (showSearchControlsContextMenu) now provides the
        // source / search-by / category / online controls for search pages using the modern
        // submenu + highlighted indicator pattern. The option getters below are still used by the gear.
    }

    getGrimoireFilterOptions() {
        return [
            { value: '', label: 'All Categories' },
            { value: '0', label: 'General' },
            { value: '1', label: 'Artist' },
            { value: '3', label: 'Copyright' },
            { value: '4', label: 'Character' },
            { value: '5', label: 'Meta' },
            { value: '6', label: 'Species' },
            { value: 'non-tag', label: 'Non-Tag Results' }
        ];
    }

    getGrimoireSearchTypeOptions() {
        return [
            { value: 'name', label: 'Name' },
            { value: 'description', label: 'Description' }
        ];
    }

    getGrimoireSourceOptions() {
        return [
            { value: 'both', label: 'Both' },
            { value: 'danbooru', label: 'Danbooru' },
            { value: 'e621', label: 'e621' }
        ];
    }

    applyGrimoireFilter(value) {
        this.currentFilter = value;
        if (this.filterIcon) {
            this.filterIcon.className = 'fas fa-filter';
        }
        if (this.searchInput && this.searchInput.value.trim()) {
            this.performSearch();
        }
    }

    applyGrimoireSearchType(value) {
        this.currentSearchType = value;
        if (this.searchTypeIcon) {
            this.searchTypeIcon.className = value === 'description' ? 'fas fa-font' : 'fas fa-tag';
        }
        this.updateOnlineToggleState();
        if (this.searchInput && this.searchInput.value.trim()) {
            this.performSearch();
        }
    }

    applyGrimoireSource(value) {
        this.currentSource = value;
        if (this.sourceIcon) {
            if (value === 'danbooru') {
                this.sourceIcon.className = 'nai-sakura';
            } else if (value === 'e621') {
                this.sourceIcon.className = 'nai-paw';
            } else {
                this.sourceIcon.className = 'fas fa-globe';
            }
        }
        if (this.searchInput && this.searchInput.value.trim()) {
            this.performSearch();
        }
    }

    buildGrimoireFilterClickMenuConfig() {
        const modal = this;
        return {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 360,
            beforeShow: () => modal.refreshGrimoireFilterClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'select-grimoire-filter') return;
                modal.applyGrimoireFilter(item.filterValue);
            }
        };
    }

    refreshGrimoireFilterClickMenuItems() {
        if (!this.filterClickMenuConfig) return;
        this.filterClickMenuConfig.sections[0].items = this.getGrimoireFilterOptions().map((opt) => ({
            text: opt.label,
            action: 'select-grimoire-filter',
            filterValue: opt.value,
            loadfn: (item) => {
                item.highlighted = item.filterValue === this.currentFilter;
            }
        }));
    }

    buildGrimoireSearchTypeClickMenuConfig() {
        const modal = this;
        return {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 240,
            beforeShow: () => modal.refreshGrimoireSearchTypeClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'select-grimoire-search-type' || !item.searchType) return;
                modal.applyGrimoireSearchType(item.searchType);
            }
        };
    }

    refreshGrimoireSearchTypeClickMenuItems() {
        if (!this.searchTypeClickMenuConfig) return;
        this.searchTypeClickMenuConfig.sections[0].items = this.getGrimoireSearchTypeOptions().map((opt) => ({
            text: opt.label,
            action: 'select-grimoire-search-type',
            searchType: opt.value,
            loadfn: (item) => {
                item.highlighted = item.searchType === this.currentSearchType;
            }
        }));
    }

    buildGrimoireSourceClickMenuConfig() {
        const modal = this;
        return {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 240,
            beforeShow: () => modal.refreshGrimoireSourceClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'select-grimoire-source' || !item.sourceValue) return;
                modal.applyGrimoireSource(item.sourceValue);
            }
        };
    }

    refreshGrimoireSourceClickMenuItems() {
        if (!this.sourceClickMenuConfig) return;
        this.sourceClickMenuConfig.sections[0].items = this.getGrimoireSourceOptions().map((opt) => ({
            text: opt.label,
            action: 'select-grimoire-source',
            sourceValue: opt.value,
            loadfn: (item) => {
                item.highlighted = item.sourceValue === this.currentSource;
            }
        }));
    }

    // Old results sidebar (and its toggle/overlay/collapse logic) has been removed.
    // Search results are now exclusively rendered as a page in the display area.
    // These are kept as no-ops for any remaining call sites during transition.
    setupResultsSidebar() {}
    updateResultsSidebar(expandForResults = false) {}
    setResultsOverlayOpen(open) {}
    toggleResultsSidebar() {}
    needsResultsOverlay() { return false; }
    isResultsSidebarOpen() { return false; }
    updateResultsSidebarToggle() {}
    shouldShowResultsSidebarToggle() { return false; }

    updateResultsSidebar(expandForResults = false) {
        if (!this.searchBody || !this.modal) return;

        const modalWidth = this.modal.offsetWidth || 0;
        const tooSmall = modalWidth > 0 && modalWidth <= this.RESULTS_SIDEBAR_AUTO_COLLAPSE_WIDTH;
        const overlayMode = this.needsResultsOverlay();

        const hasResults = this.currentSearchResults.length > 0 ||
            (this.resultsList && (
                this.resultsList.querySelector('.tag-wiki-result-item') ||
                this.resultsList.querySelector('.tag-wiki-loading') ||
                this.resultsList.querySelector('.tag-wiki-empty-results') ||
                this.resultsList.querySelector('.tag-wiki-error')
            ));

        if (expandForResults && hasResults && overlayMode) {
            this.resultsSidebarManualCollapsed = false;
            this.setResultsOverlayOpen(true);
        }

        if (overlayMode) {
            this.searchBody.classList.add('results-sidebar-collapsed');
            if (this.resultsCollapseBtn) {
                const overlayOpen = this.modal.classList.contains('tag-wiki-results-overlay-open');
                this.resultsCollapseBtn.disabled = !overlayOpen;
                this.resultsCollapseBtn.title = overlayOpen ? 'Hide search results' : 'Collapse results';
            }
            this.updateResultsSidebarToggle();
            return;
        }

        this.setResultsOverlayOpen(false);

        if (expandForResults && hasResults && !tooSmall) {
            this.resultsSidebarManualCollapsed = false;
        }

        const collapsed = tooSmall || this.resultsSidebarManualCollapsed;
        const wasCollapsed = this.searchBody.classList.contains('results-sidebar-collapsed');
        this.searchBody.classList.toggle('results-sidebar-collapsed', collapsed);

        if (this.resultsCollapseBtn) {
            this.resultsCollapseBtn.disabled = tooSmall;
            this.resultsCollapseBtn.title = tooSmall
                ? 'Results hidden while window is narrow'
                : 'Collapse results';
        }

        if (wasCollapsed && !collapsed && this.resultsScrollPanel && window.customScrollbar) {
            window.customScrollbar.forceReinit(this.resultsScrollPanel);
        }
        this.updateResultsSidebarToggle();
    }
    
    setupEventListeners() {
        if (!this.modal || this._eventsWired) return;
        this._eventsWired = true;

        // Search input - Enter key to search (skip when address bar is in edit mode)
        if (this.searchInput) {
            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
                    e.preventDefault();
                    if (this.addressBar?.classList.contains('edit-active')) {
                        this.commitAddressFromInput();
                    } else {
                        this.performSearch();
                    }
                }
            });
        }
        
        // Navigation buttons - delegate to the active pane (left or right in split mode)
        // so the shared top toolbar controls the focused panel's history / location.
        if (this.backBtn) {
            this.backBtn.addEventListener('click', () => {
                const p = this.activePane;
                if (p && typeof p.goBack === 'function') p.goBack();
                else this.goBack();
            });
            this.setupBackButtonContextMenu();
        }
        
        if (this.forwardBtn) {
            this.forwardBtn.addEventListener('click', () => {
                const p = this.activePane;
                if (p && typeof p.goForward === 'function') p.goForward();
                else this.goForward();
            });
            this.setupForwardButtonContextMenu();
        }
        
        if (this.homeBtn) {
            this.homeBtn.addEventListener('click', () => {
                const p = this.activePane;
                if (p && typeof p.goHome === 'function') {
                    p.goHome();
                } else {
                    this.goHome();
                }
            });
        }

        if (this.refreshBtn) {
            this.refreshBtn.addEventListener('click', () => this.refreshToolbar());
        }
        
        // Close button
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.close();
            });
        }
        
        // Update navigation buttons to populate context menus initially
        this.updateNavigationButtons();

        // Wire the new layered address bar (display <-> edit)
        this.wireAddressBar();
        // Initial address for the main Grimoire browser (will evolve with real navigation state)
        this.setAddress({ displayUrl: 'en.grimoire.jp/index.dtxt', mode: 'edtx' });

        // Expose a convenience for other modules / the address bar future full-router usage
        if (!window.grimoireNavigate && this.navigate) {
            window.grimoireNavigate = (u) => this.navigate(u);
        }

        this.wireKeyboardOverlayEntries();
    }

    _triggerGrimoireNavigation(which) {
        const p = this.activePane;
        if (which === 'back') {
            if (p && typeof p.goBack === 'function') p.goBack();
            else this.goBack();
        } else if (which === 'forward') {
            if (p && typeof p.goForward === 'function') p.goForward();
            else this.goForward();
        } else if (which === 'home') {
            if (p && typeof p.goHome === 'function') p.goHome();
            else this.goHome();
        }
    }

    _focusGrimoireAddressBar() {
        this.enterAddressEdit();
        if (this.searchInput) {
            this.searchInput.focus();
            this.searchInput.select();
        }
    }

    _getActiveSearchResultContainer() {
        const pane = this.activePane;
        if (!pane || !pane.displayArea) return null;
        if (typeof pane.isSearchPage === 'function' && !pane.isSearchPage()) return null;
        if (!pane.displayArea.querySelector('.search-results-list')) return null;
        return pane.displayArea;
    }

    _getSearchResultItems(container) {
        if (!container) return [];
        return Array.from(container.querySelectorAll('.google-search-result, .tag-pill'));
    }

    _updateSearchResultHighlight(container) {
        const items = this._getSearchResultItems(container);
        items.forEach((el, i) => {
            el.classList.toggle('keyboard-selected', i === this._searchResultIndex);
        });
        const selected = items[this._searchResultIndex];
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' });
        }
        this._notifyGrimoireKeyboardOverlayContextChanged();
    }

    _handleGrimoireSearchResultKeydown(e) {
        const container = this._getActiveSearchResultContainer();
        if (!container) {
            this._searchResultIndex = -1;
            return false;
        }
        const items = this._getSearchResultItems(container);
        if (!items.length) return false;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (this._searchResultIndex < 0) this._searchResultIndex = 0;
            else this._searchResultIndex = Math.min(this._searchResultIndex + 1, items.length - 1);
            this._updateSearchResultHighlight(container);
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (this._searchResultIndex < 0) this._searchResultIndex = 0;
            else this._searchResultIndex = Math.max(this._searchResultIndex - 1, 0);
            this._updateSearchResultHighlight(container);
            return true;
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
            if (isGrimoireEditableShortcutTarget(e.target)) return false;
            const idx = this._searchResultIndex >= 0 ? this._searchResultIndex : 0;
            const el = items[idx];
            if (el) {
                e.preventDefault();
                el.click();
                return true;
            }
        }
        return false;
    }

    _handleGrimoireKeydown(e) {
        if (!this.modal || this.modal.classList.contains('hidden')) return;

        const inAddressEdit = this.addressBar && this.addressBar.classList.contains('edit-active');
        const isEditable = isGrimoireEditableShortcutTarget(e.target);

        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'l' || e.key === 'L')) {
            e.preventDefault();
            this._focusGrimoireAddressBar();
            return true;
        }

        if (isEditable) {
            if (inAddressEdit && (e.key === 'Enter' || e.key === 'Escape')) return;
            if (e.target && e.target.classList && e.target.classList.contains('search-page-input')) {
                if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') return;
                }
            } else {
                return;
            }
        }

        if ((e.altKey && e.key === 'ArrowLeft') || e.key === 'BrowserBack') {
            e.preventDefault();
            this._triggerGrimoireNavigation('back');
            return true;
        }
        if ((e.altKey && e.key === 'ArrowRight') || e.key === 'BrowserForward') {
            e.preventDefault();
            this._triggerGrimoireNavigation('forward');
            return true;
        }
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'h' || e.key === 'H')) {
            e.preventDefault();
            this._triggerGrimoireNavigation('home');
            return true;
        }
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === '\\') {
            if (this.rightToggleBtn && this.rightToggleBtn.style.display !== 'none') {
                e.preventDefault();
                this.toggleRightPane();
                return true;
            }
        }
        if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === 's' || e.key === 'S')) {
            if (this.isSplitMode()) {
                e.preventDefault();
                this.swapSplitPanes();
                return true;
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
            const pane = this.activePane;
            const hasTag = pane && typeof pane.hasWikiPageTag === 'function' && pane.hasWikiPageTag();
            if (hasTag) {
                e.preventDefault();
                if (typeof pane.handleWikiDisplayContextMenuAction === 'function') {
                    pane.handleWikiDisplayContextMenuAction('wiki-copy-tag');
                } else {
                    this.handleWikiDisplayContextMenuAction('wiki-copy-tag');
                }
                return true;
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A')) {
            const pane = this.activePane;
            const tag = pane && typeof pane.getCurrentTagName === 'function' ? pane.getCurrentTagName() : '';
            if (tag) {
                e.preventDefault();
                if (pane && typeof pane.addToPrompt === 'function') {
                    pane.addToPrompt();
                } else {
                    this.addToPrompt();
                }
                return true;
            }
        }

        return this._handleGrimoireSearchResultKeydown(e);
    }

    wireKeyboardOverlayEntries() {
        if (this._keyboardOverlayWired) return;
        this._keyboardOverlayWired = true;
        if (!this._escapeKeyHandler) {
            this._escapeKeyHandler = (e) => {
                if (e.key !== 'Escape') return;
                if (this.addressBar && this.addressBar.classList.contains('edit-active')) {
                    this.exitAddressEditAndRestore();
                    return true;
                }
            };
        }
        if (!this._grimoireKeydownHandler) {
            this._grimoireKeydownHandler = (e) => this._handleGrimoireKeydown(e);
        }
        // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        registerKeyboardListener({
            id: 'tagWikiSearchModal.escape',
            handler: this._escapeKeyHandler,
            type: 'whenFocused',
            modalId: 'tagWikiSearchModal',
            priority: 80,
            critical: true,
            showInOverlay: false
        });
        registerKeyboardListener({
            id: 'tagWikiSearchModal.keydown',
            handler: this._grimoireKeydownHandler,
            type: 'whenFocused',
            modalId: 'tagWikiSearchModal',
            priority: 75,
            showInOverlay: false
        });
        [
            { id: 'overlay.tagWikiSearchModal.close', label: 'Close', keys: 'Alt+Q', icon: 'fas fa-times' },
            { id: 'overlay.tagWikiSearchModal.back', label: 'Back', keys: 'Alt+←', icon: 'fas fa-arrow-left', overlayAlt: true, overlayValid: () => this.history && this.historyIndex > 0 },
            { id: 'overlay.tagWikiSearchModal.forward', label: 'Forward', keys: 'Alt+→', icon: 'fas fa-arrow-right', overlayAlt: true, overlayValid: () => this.history && this.historyIndex < this.history.length - 1 },
            { id: 'overlay.tagWikiSearchModal.home', label: 'Home', keys: 'Ctrl+H', icon: 'fas fa-home' },
            { id: 'overlay.tagWikiSearchModal.focusAddress', label: 'Focus address bar', keys: 'Ctrl+L', icon: 'fas fa-link' },
            { id: 'overlay.tagWikiSearchModal.splitToggle', label: 'Toggle split panel', keys: 'Alt+\\', icon: 'fas fa-columns', overlayAlt: true, overlayValid: () => this.rightToggleBtn && this.rightToggleBtn.style.display !== 'none' },
            { id: 'overlay.tagWikiSearchModal.swapPanels', label: 'Swap panels', keys: 'Alt+Shift+S', icon: 'fas fa-arrow-right-arrow-left', overlayAlt: true, overlayValid: () => this.isSplitMode() },
            { id: 'overlay.tagWikiSearchModal.copyTag', label: 'Copy tag', keys: 'Ctrl+Shift+C', icon: 'fas fa-copy', overlayValid: () => this._grimoireOverlayHasWikiTag() },
            { id: 'overlay.tagWikiSearchModal.addTag', label: 'Add to prompt', keys: 'Ctrl+Shift+A', icon: 'fas fa-plus', overlayValid: () => this._grimoireOverlayCanAddToPrompt() },
            { id: 'overlay.tagWikiSearchModal.resultDown', label: 'Next result', keys: '↓', icon: 'fas fa-chevron-down', overlayValid: () => this._grimoireOverlayHasSearchResults() },
            { id: 'overlay.tagWikiSearchModal.resultUp', label: 'Previous result', keys: '↑', icon: 'fas fa-chevron-up', overlayValid: () => this._grimoireOverlayHasSearchResults() },
            { id: 'overlay.tagWikiSearchModal.search', label: 'Search / open result', keys: 'Enter', icon: 'fas fa-search', overlayValid: () => this._grimoireOverlayHasSearchResults() }
        ].forEach((entry) => {
            registerKeyboardListener({
                id: entry.id,
                type: 'whenFocused',
                modalId: 'tagWikiSearchModal',
                label: entry.label,
                keys: entry.keys,
                overlayIcon: entry.icon,
                overlayGroup: 'Grimoire',
                overlayAlt: entry.overlayAlt === true,
                overlayValid: typeof entry.overlayValid === 'function' ? entry.overlayValid : null,
                overlayOnly: true,
                priority: -10
            });
        });
    }

    _grimoireOverlayHasWikiTag() {
        const pane = this.activePane;
        return !!(pane && typeof pane.hasWikiPageTag === 'function' && pane.hasWikiPageTag());
    }

    _grimoireOverlayCanAddToPrompt() {
        const manualModalEl = document.getElementById('manualModal');
        const isManualOpen = manualModalEl && !manualModalEl.classList.contains('hidden');
        if (!isManualOpen) return false;
        const pane = this.activePane;
        const tag = pane && typeof pane.getCurrentTagName === 'function' ? pane.getCurrentTagName() : '';
        return !!tag;
    }

    _grimoireOverlayHasSearchResults() {
        return this._getSearchResultItems(this._getActiveSearchResultContainer()).length > 0;
    }

    _notifyGrimoireKeyboardOverlayContextChanged() {
        // notifyKeyboardOverlayContextChanged: public/scripts/comp/modalKeyboardRegistry.js
        notifyKeyboardOverlayContextChanged();
    }

    // --- Layered pseudo-browser address bar controller ---
    wireAddressBar() {
        if (!this.addressBar || !this.addressDisplay || !this.addressEdit) return;

        // Click on display layer -> enter edit (reveal input + refresh)
        this.addressDisplay.addEventListener('click', (e) => {
            e.preventDefault();
            this.enterAddressEdit();
        });

        // Keyboard activation on display layer
        this.addressDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.enterAddressEdit();
            }
        });

        // Hover reveal of Layer 2 is 100% CSS:
        //   .wiki-address-bar:hover:not(.edit-active) .address-edit-layer { display:flex; ... }
        //   .wiki-address-bar:focus-within:not(.edit-active) ...
        // No JS mouseenter/leave is used (good for touch, simpler, no hover state on mobile).
        //
        // The JS below is required for things CSS fundamentally cannot do:
        //   1. Reading the current *full technical URL* from JS state (currentAddress) and writing it
        //      into the <input> when the user decides to edit. (Layer 1 always shows the pretty path.)
        //   2. Actually navigating / running the router when the user presses Enter in the input
        //      (commitAddressFromInput → navigate()).
        //   3. Managing edit *mode* beyond visibility: outside-click dismissal, Escape to cancel
        //      (not submit), focus/select of the input, accessibility activation of Layer 1,
        //      and coordinating with split-pane active state / loading states.
        //
        // Click or keyboard-activate Layer 1 → enter committed edit mode (adds .edit-active,
        // which CSS uses to *hide* Layer 1 completely and keep Layer 2 visible + focused).
        // Hover is just a temporary peek (CSS only).

        // Commit on Enter inside the address input — this is the *only* place that treats the field value as a new location/search.
        if (this.searchInput) {
            // On blur (including after submit or clicking away), switch back to Layer 1.
            this.searchInput.addEventListener('blur', () => {
                // Small timeout so that click on refresh (which is inside the layer) has time to process
                // its own exit logic if needed. Blur will still fire.
                setTimeout(() => {
                    if (this.addressBar && this.addressBar.classList.contains('edit-active')) {
                        this.exitAddressEditAndRestore();
                    }
                }, 0);
            });

            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.exitAddressEditAndRestore();
                }
            });
        }

        // Refresh button (already wired to refreshToolbar) — after refresh, just close editor (display already correct)
        if (this.refreshBtn) {
            this.refreshBtn.addEventListener('click', () => {
                setTimeout(() => this.exitAddressEditAndRestore(), 120);
            }, { once: false });
        }

        // Address bar outside-click handled in setupSplitModeListeners via modal listener scope.
    }

    setAddress({ displayUrl, mode = 'edtx' } = {}, options = {}) {
        if (!this.addressPath) return;

        let fullUrl = displayUrl || 'edtx://en.grimoire.jp/index.dtxt';

        const force = !!options.force;

        // When the right pane is active we still let left render update its internal currentAddress,
        // but we must not clobber the shared address bar visuals (they belong to the active pane)
        // unless this call is explicitly forcing the update (e.g. from sync after swap or active change).
        const updatingActiveLeft = (this.activePane === this) || force;

        // Ensure we have an internal fullUrl with protocol for navigation/router.
        if (!/^(edtx|rdf|dsap):\/\//i.test(fullUrl)) {
            // isDsapPseudoUrl: public/scripts/comp/dsapRegistry.js
            if (mode === 'dsap' || (typeof isDsapPseudoUrl === 'function' && isDsapPseudoUrl(fullUrl))) {
                fullUrl = `dsap://${fullUrl.replace(/^\/+/, '')}`;
                mode = 'dsap';
            } else if (mode === 'rdf' || fullUrl.includes('docs.')) {
                fullUrl = `rdf://${fullUrl.replace(/^\/+/, '')}`;
            } else {
                fullUrl = `edtx://${fullUrl.replace(/^\/+/, '')}`;
            }
        }

        // For Layer 1 (visible display span): show only the path part (no protocol scheme),
        // since we have a mode icon that indicates the protocol/type.
        const displayPath = fullUrl.replace(/^(edtx|rdf|dsap):\/\//i, '');

        this.currentAddress = { fullUrl, displayPath, mode };
        this._currentAddress = { displayUrl: displayPath, fullUrl, mode };

        if (!updatingActiveLeft) {
            // Right pane is the active one; its own setAddress + notify will keep the bar in sync.
            // (unless force was passed from explicit sync)
            return;
        }

        this.addressPath.textContent = displayPath;

        if (this.addressPath.dataset.loadingHint) {
            this.addressPath.dataset.preloadText = displayPath;
            this.addressPath.textContent = `${displayPath} …`;
        }

        if (this.addressModeIcon) {
            // Icon based on protocol or domain (same logic)
            let icon = 'fas fa-book';
            const lower = fullUrl.toLowerCase();
            // isDsapPseudoUrl: public/scripts/comp/dsapRegistry.js
            if (lower.startsWith('dsap://') || mode === 'dsap' || (typeof isDsapPseudoUrl === 'function' && isDsapPseudoUrl(fullUrl))) {
                icon = 'fas fa-puzzle-piece';
            } else if (lower.startsWith('rdf://') || lower.includes('docs.') || mode === 'rdf') {
                icon = 'fas fa-file-alt';
            } else if (lower.includes('wiki.danbooru') || lower.includes('wiki.e621')) {
                icon = 'fas fa-globe';
            }
            this.addressModeIcon.className = `address-mode-icon ${icon}`;
        }

        if (this.addressBar) {
            this.addressBar.dataset.protocol = (fullUrl.match(/^(edtx|rdf|dsap):/i)?.[1] || mode || 'edtx').toLowerCase();
        }
    }

    setNavigationLoading(loading) {
        if (!this.addressBar || !this.addressModeIcon) return;
        const icon = this.addressModeIcon;
        const display = this.addressDisplay;

        if (loading) {
            if (!icon.dataset.originalClass) {
                icon.dataset.originalClass = icon.className;
            }
            icon.className = 'fas fa-spinner-third fa-spin';
            this.addressBar.classList.add('nav-loading');
            if (display) display.style.pointerEvents = 'none';
            // disable entering edit while loading
            this.addressBar.style.cursor = 'progress';
            // visual loading hint on the path without losing the target url
            if (this.addressPath && !this.addressPath.dataset.loadingHint) {
                this.addressPath.dataset.loadingHint = '1';
                const orig = this.addressPath.textContent;
                if (!this.addressPath.dataset.preloadText) this.addressPath.dataset.preloadText = orig;
                this.addressPath.textContent = orig + ' …';
            }
        } else {
            if (icon.dataset.originalClass) {
                icon.className = icon.dataset.originalClass;
                delete icon.dataset.originalClass;
            }
            this.addressBar.classList.remove('nav-loading');
            if (display) display.style.pointerEvents = '';
            this.addressBar.style.cursor = '';
            // restore path
            if (this.addressPath && this.addressPath.dataset.preloadText) {
                this.addressPath.textContent = this.addressPath.dataset.preloadText;
                delete this.addressPath.dataset.preloadText;
                delete this.addressPath.dataset.loadingHint;
            }
        }
    }

    enterAddressEdit() {
        if (!this.addressBar || !this.addressEdit || !this.searchInput) return;
        this.addressBar.classList.add('edit-active');
        this.addressEdit.classList.remove('hidden');

        // Layer 2 (edit input): prefill with the *full technical URI* including protocol.
        // Layer 1 (display) shows the pretty path only (protocol stripped, icon indicates type).
        // Do NOT auto-focus the input here — user may want to directly click the refresh button
        // without the input stealing focus (and triggering keyboard on touch, etc.).
        // User can click the input if they want to edit the address.
        const current = (this.currentAddress && this.currentAddress.fullUrl) || this.addressPath?.textContent || '';
        this.searchInput.value = current || 'edtx://en.grimoire.jp/index.dtxt';
    }

    exitAddressEdit() {
        // Pure exit: just hide the edit layer and restore whatever the display layer was showing.
        // Do NOT read the input value and turn it into a search here. That only happens on explicit commit (Enter).
        if (!this.addressBar || !this.addressEdit) return;
        this.addressBar.classList.remove('edit-active');
        this.addressEdit.classList.add('hidden');
    }

    exitAddressEditAndRestore() {
        // Called on blur/cancel (outside click, mouseleave while not committed, Escape).
        // Just close the editor; the display layer already shows the last committed address.
        this.exitAddressEdit();
    }

    commitAddressFromInput() {
        // Called only on explicit commit (Enter in the address field).
        // Parse what the user typed and navigate or search.
        this.exitAddressEdit(); // close editor first

        const val = (this.searchInput && this.searchInput.value || '').trim();
        if (!val) {
            // empty → go home
            this.setAddress({ displayUrl: 'edtx://en.grimoire.jp/index.dtxt', mode: 'edtx' });
            this.showDreamWikiHomepage?.();
            return;
        }

        // If it looks like a full pseudo address (has domain or scheme), let the router handle it.
        if (typeof isGrimoirePseudoBrowserAddress === 'function' && isGrimoirePseudoBrowserAddress(val)) {
            if (typeof this.navigate === 'function') {
                this.navigate(val);
            }
            return;
        }

        // Bare term → search page
        this.navigate(`edtx://en.grimoire.jp/search?q=${encodeURIComponent(val)}`);
    }

    showGrimoireNavigationLoadingPage(displayPath) {
        if (!this.displayArea) return;

        // deactivateDsapOnShell: public/scripts/comp/dsapRegistry.js
        if (typeof deactivateDsapOnShell === 'function') deactivateDsapOnShell(this);

        this._searchPageMode = false;
        if (this.searchBody) {
            this.searchBody.classList.remove('search-page-view');
        }

        const safePath = this.escapeHtml(displayPath || '…');
        this.displayArea.innerHTML = `
            <div class="grimoire-nav-loading">
                <div class="grimoire-nav-loading-icon"><i class="fas fa-spinner-third fa-spin"></i></div>
                <p class="grimoire-nav-loading-title">Loading</p>
                <p class="grimoire-nav-loading-url">${safePath}</p>
            </div>`;
    }

    showGrimoireNavigateErrorPage(options = {}) {
        if (!this.displayArea) return;

        const {
            url = '',
            kind = 'not_found',
            protocol = '',
            skipHistory = false,
            skipLoadingDelay = false
        } = options;

        const startedAt = this._grimoireNavStartedAt || Date.now();
        const displayPath = url.replace(/^(edtx|rdf|dsap):\/\//i, '') || url;
        this._grimoireLastFailedNavUrl = url;

        if (!skipLoadingDelay) {
            this.showGrimoireNavigationLoadingPage(displayPath);
        }

        const renderError = () => {
            // deactivateDsapOnShell: public/scripts/comp/dsapRegistry.js
            if (typeof deactivateDsapOnShell === 'function') deactivateDsapOnShell(this);

            this._searchPageMode = false;
            if (this.searchBody) {
                this.searchBody.classList.remove('search-page-view');
            }

            const safeUrl = this.escapeHtml(url || displayPath);
            let title = 'This page can\u2019t be displayed';
            let detail = `Dreamscape Browser cannot find <strong>${safeUrl}</strong>. Check the address for typos or try again later.`;

            if (kind === 'invalid_protocol') {
                title = 'Invalid address';
                const protoLabel = this.escapeHtml(protocol || 'unknown');
                detail = `The protocol <strong>${protoLabel}://</strong> is not supported. Use <strong>edtx://</strong>, <strong>rdf://</strong>, or <strong>dsap://</strong> addresses in Dreamscape Browser.`;
            }

            this.displayArea.innerHTML = `
                <div class="grimoire-nav-error">
                    <div class="grimoire-nav-error-icon"><i class="fas fa-globe"></i></div>
                    <h2 class="grimoire-nav-error-title">${title}</h2>
                    <p class="grimoire-nav-error-url">${safeUrl}</p>
                    <p class="grimoire-nav-error-detail">${detail}</p>
                    <div class="grimoire-nav-error-actions">
                        <button type="button" class="btn-secondary btn-small" data-grimoire-nav-action="retry">
                            <i class="fas fa-rotate-right"></i> Try again
                        </button>
                        <button type="button" class="btn-secondary btn-small" data-grimoire-nav-action="home">
                            <i class="fas fa-home"></i> Home
                        </button>
                    </div>
                </div>`;

            this.displayArea.querySelector('[data-grimoire-nav-action="retry"]')?.addEventListener('click', () => {
                const retryUrl = this._grimoireLastFailedNavUrl;
                if (retryUrl && typeof this.navigate === 'function') {
                    this.navigate(retryUrl);
                }
            });
            this.displayArea.querySelector('[data-grimoire-nav-action="home"]')?.addEventListener('click', () => {
                this.goHome();
            });

            if (!skipHistory && typeof this.addToHistory === 'function') {
                this.addToHistory({
                    type: 'nav-error',
                    url,
                    kind,
                    protocol: protocol || null,
                    title: kind === 'invalid_protocol' ? 'Invalid address' : 'Page not found'
                });
            }
            this.updateNavigationButtons?.();
        };

        if (skipLoadingDelay) {
            renderError();
            this.setNavigationLoading(false);
            return;
        }

        requestAnimationFrame(() => {
            requestAnimationFrame(renderError);
        });

        const wait = typeof grimoireGetNavLoadingDelayMs === 'function'
            ? grimoireGetNavLoadingDelayMs(startedAt)
            : 360;
        setTimeout(() => this.setNavigationLoading(false), wait);
    }

    finishGrimoireNavigationLoading(startedAt) {
        const wait = typeof grimoireGetNavLoadingDelayMs === 'function'
            ? grimoireGetNavLoadingDelayMs(startedAt || this._grimoireNavStartedAt)
            : 0;
        setTimeout(() => this.setNavigationLoading(false), wait);
    }

    /**
     * Minimal navigate entry point for the pseudo-browser (Grimoire surface).
     * Accepts full pseudo-URLs (en.grimoire.jp/..., wiki.danbooru.jp/..., dsap://…).
     *
     * All routing is now driven by the Grimoire Domain Registry (dsapRegistry + core domains).
     * Domain name + aliases resolve to a registered applet/handler. The modal (this file)
     * acts primarily as the generic browser chrome + thin router.
     *
     * See: public/scripts/comp/dsapRegistry.js and grimoireCoreDomains.js
     */
    navigate(pseudoUrl = '') {
        const url = String(pseudoUrl || '').trim();
        if (!url) return;

        const target = this.activePane;
        if (target !== this) {
            this._navigateToPane(target, url);
            return;
        }

        this.setNavigationLoading(true);
        this._grimoireNavStartedAt = Date.now();

        const unsupportedProtocol = typeof grimoireGetUnsupportedProtocol === 'function'
            ? grimoireGetUnsupportedProtocol(url)
            : null;
        if (unsupportedProtocol) {
            this.exitAddressEdit();
            const normalized = typeof grimoireNormalizePseudoDisplayUrl === 'function'
                ? grimoireNormalizePseudoDisplayUrl(url)
                : { displayUrl: url, mode: 'edtx' };
            this.setAddress(normalized);
            this.showGrimoireNavigateErrorPage({
                url: normalized.displayUrl,
                kind: 'invalid_protocol',
                protocol: unsupportedProtocol
            });
            return;
        }

        // Single unified resolution path.
        // resolveDsap (and the registrations in grimoireCoreDomains.js + individual applets)
        // now owns: en.grimoire.jp (search/home), wiki.danbooru.jp, wiki.e621.com, docs.novelai.jp,
        // all DSAP applets, and any future domain.
        // navigateDsapIfMatched handles loading chrome, activation, history (when the activator doesn't),
        // address bar, and cleanup.
        if (typeof resolveDsap === 'function' && resolveDsap(url)) {
            this.exitAddressEdit();
            const normalized = typeof grimoireNormalizePseudoDisplayUrl === 'function'
                ? grimoireNormalizePseudoDisplayUrl(url)
                : { displayUrl: url, mode: 'dsap' };
            this.setAddress(normalized);
            navigateDsapIfMatched(this, url, { navStartedAt: this._grimoireNavStartedAt });
            return;
        }

        // Unknown but looks like a Grimoire-style pseudo address → proper error page (no silent search).
        this.exitAddressEdit();
        if (typeof isGrimoirePseudoBrowserAddress === 'function' && isGrimoirePseudoBrowserAddress(url)) {
            const normalized = typeof grimoireNormalizePseudoDisplayUrl === 'function'
                ? grimoireNormalizePseudoDisplayUrl(url)
                : { displayUrl: url, mode: 'edtx' };
            this.setAddress(normalized);
            this.showGrimoireNavigateErrorPage({
                url: normalized.displayUrl,
                kind: 'not_found'
            });
            return;
        }

        // Ultimate fallback: treat bare input as a search term (old behavior for convenience).
        if (this.searchInput) this.searchInput.value = url;
        this.performSearch();
        this.finishGrimoireNavigationLoading();
    }

    _navigateToPane(pane, url) {
        if (!pane || !url) return;

        // Unified domain resolution (core domains + DSAP applets) now drives panes too.
        // See navigate() and grimoireCoreDomains.js + dsapRegistry.js
        if (typeof navigateDsapIfMatched === 'function' && navigateDsapIfMatched(pane, url)) {
            return;
        }

        // Search URLs on a side pane are intentionally routed to the primary surface
        // (the dedicated search results page + filters live in the main Grimoire area).
        const routePath = typeof grimoireStripPseudoProtocol === 'function'
            ? grimoireStripPseudoProtocol(url)
            : String(url).replace(/^(edtx|rdf|dsap):\/\//i, '');
        const lower = routePath.toLowerCase();

        if (lower.includes('en.grimoire.jp/search') || lower.includes('/search')) {
            let q = '';
            try {
                const u = new URL(url.startsWith('http') ? url : 'https://dummy/' + url.replace(/^[^?]+/, ''));
                q = u.searchParams.get('q') || '';
            } catch (e) {
                const mm = url.match(/[?&]q=([^?&#]+)/);
                if (mm) q = decodeURIComponent(mm[1]);
            }
            if (this.searchInput) this.searchInput.value = q;
            this.performSearch().finally(() => {
                this.showSearchResultsPage(q, false);
            });
            return;
        }

        // Final fallback for a pane: if it looks like a bare tag name, try direct wiki.
        if (typeof pane.getTagWikiPageDirectly === 'function') {
            pane.getTagWikiPageDirectly(url);
        }
    }

    // --- end address bar controller ---

    open(initialQuery = '', options = {}) {
        if (!this.modal) return;
        const wasClosed = this.modal.classList.contains('hidden');
        const trimmedQuery = String(initialQuery || '').trim();
        const skipInitialHome = options && options.skipInitialHome;
        const initialAddress = options && options.initialAddress;
        openModal(this.modal);

        // Sync the layered address bar for the primary Grimoire browser surface (with protocol prefix)
        if (initialAddress) {
            const normalized = typeof grimoireNormalizePseudoDisplayUrl === 'function'
                ? grimoireNormalizePseudoDisplayUrl(initialAddress)
                : { displayUrl: initialAddress, mode: 'dsap' };
            this.setAddress(normalized);
        } else if (trimmedQuery) {
            this.setAddress({ displayUrl: `edtx://en.grimoire.jp/search?q=${encodeURIComponent(trimmedQuery)}`, mode: 'edtx' });
        } else if (!skipInitialHome) {
            this.setAddress({ displayUrl: 'edtx://en.grimoire.jp/index.dtxt', mode: 'edtx' });
        }
        setTimeout(() => this.checkAndUpdateSplitMode(), 150);
        
        if (wasClosed) {
            // Initialize custom scrollbars after modal is opened
            if (window.customScrollbar) {
                setTimeout(() => {
                    const resultsPanel = this.modal.querySelector('.tag-wiki-search-results.form-section-scroll');
                    const displayPanel = this.modal.querySelector('.tag-wiki-search-display.form-section-scroll');
                    if (resultsPanel) {
                        window.customScrollbar.forceReinit(resultsPanel);
                    }
                    if (displayPanel) {
                        window.customScrollbar.forceReinit(displayPanel);
                    }
                }, 50);
            }

            if (!trimmedQuery && !skipInitialHome) {
                this.clearResults();
                this.history = [{ type: 'home' }];
                this.historyIndex = 0;
                if (this.searchInput) {
                    this.searchInput.value = '';
                }
                this.showDreamWikiHomepage();
                this.updateNavigationButtons();
                this.updateSearchControlsVisibility();
            }
            
            // Focus search input
            if (this.searchInput) {
                // Set initial query if provided
                if (trimmedQuery) {
                    this.searchInput.value = trimmedQuery;
                }
                setTimeout(() => {
                    if (this.searchInput) {
                        this.searchInput.focus();
                        if (trimmedQuery) {
                            this.searchInput.setSelectionRange(trimmedQuery.length, trimmedQuery.length);
                            setTimeout(() => {
                                this.performSearch();
                            }, 10);
                        }
                    }
                }, 100);
            }

            this.updateResultsSidebar();
        }
    }

    /**
     * Opens encyclopedia, sets search query, runs search, focuses. public/scripts/comp/modalUtils.js (activateTaskbarWindowEntry, bringModalToFront)
     */
    openSearchForTerm(searchText) {
        if (!this.modal) return;
        const term = String(searchText || '').trim();
        if (!term) return;

        const wasMinimised = this.modal.classList.contains('minimised');
        const wasHidden = this.modal.classList.contains('hidden') || this.modal.classList.contains('hidden-alt');

        if (wasHidden) {
            openModal(this.modal);
        } else if (wasMinimised) {
            if (typeof activateTaskbarWindowEntry === 'function') {
                activateTaskbarWindowEntry(this.modal.id);
            }
        } else if (typeof bringModalToFront === 'function') {
            bringModalToFront(this.modal);
        }

        const delay = wasMinimised ? 280 : (wasHidden ? 120 : 60);
        setTimeout(() => {
            if (wasHidden && window.customScrollbar) {
                const resultsPanel = this.modal.querySelector('.tag-wiki-search-results.form-section-scroll');
                const displayPanel = this.modal.querySelector('.tag-wiki-search-display.form-section-scroll');
                if (resultsPanel) {
                    window.customScrollbar.forceReinit(resultsPanel);
                }
                if (displayPanel) {
                    window.customScrollbar.forceReinit(displayPanel);
                }
            }
            if (this.searchInput) {
                this.searchInput.value = term;
                this.searchInput.focus();
                this.searchInput.setSelectionRange(term.length, term.length);
            }
            this.performSearch();
        }, delay);
    }

    /**
     * Opens a standalone wiki viewer only when get_tag_wiki_page succeeds (direct article).
     *
     * IMPORTANT: We open the standalone window *first* (with a visible loading state)
     * before doing the (potentially cached) fetch. This gives immediate feedback
     * for both desktop shortcuts and any other direct tag open that targets a
     * standalone wiki viewer.
     */
    async openStandaloneWikiIfDirectMatch(tagName, options = {}) {
        const trimmed = String(tagName || '').trim();
        if (!trimmed) return false;

        if (!window.wikiWindowManager) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, 'Wiki windows are not available', false, 4000, '<i class="fas fa-exclamation-triangle"></i>');
            }
            return false;
        }

        if (!window.wsClient || !window.wsClient.isConnected()) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, 'WebSocket not connected', false, 4000, '<i class="fas fa-exclamation-triangle"></i>');
            }
            return false;
        }

        const tag = options.tag || this.buildWikiTagFromTerm(trimmed);
        const initialTag = {
            title: tag.title || trimmed,
            name: tag.name || this.resolveBooruWikiTagName(tag)
        };

        // Open the standalone modal/window *immediately* with a loading state
        // so the user sees feedback right away (no more "nothing happens until fetch done").
        const loadingHtml = '<div class="tag-wiki-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading wiki page...</div>';
        const loadingContent = {
            title: initialTag.title,
            tagName: initialTag.name,
            html: loadingHtml,
            loading: true
        };

        let winInstance = null;
        try {
            winInstance = window.wikiWindowManager.createWindow(loadingContent, initialTag, null);
            if (winInstance && winInstance.modal && typeof bringModalToFront === 'function') {
                bringModalToFront(winInstance.modal);
            }
        } catch (e) {
            console.error('Failed to create loading standalone wiki window:', e);
            // Fall through to try direct load (old behavior as last resort)
        }

        try {
            const result = await this.getTagWikiPage(tag, { force: !!options.force });

            if (!this.hasWikiPageContent(result)) {
                const errorMessage = (result && result.error) || 'No matching wiki page';
                if (winInstance && winInstance.displayArea) {
                    // Show error inside the already-visible standalone window
                    const canGoBack = winInstance.history && winInstance.historyIndex > 0;
                    winInstance.displayArea.innerHTML = `
                        <div class="tag-wiki-error">
                            <i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(errorMessage)}
                            ${canGoBack ? '<button class="btn-secondary btn-small wiki-error-back-btn">Back</button>' : ''}
                        </div>
                    `;
                    // wire back if present
                    const backBtn = winInstance.displayArea.querySelector('.wiki-error-back-btn');
                    if (backBtn && winInstance.goBack) {
                        backBtn.addEventListener('click', () => winInstance.goBack());
                    }
                } else if (typeof showGlassToast === 'function') {
                    showGlassToast('info', null, errorMessage, false, 3500, '<i class="fas fa-book"></i>');
                }
                return false;
            }

            if (typeof hideCharacterAutocomplete === 'function') {
                hideCharacterAutocomplete();
            }

            // Populate the already-open standalone window
            if (winInstance) {
                winInstance.renderWikiPage(result);

                // Ensure history entry exists for this standalone window
                if (winInstance.addToHistory && (!winInstance.history || winInstance.history.length === 0)) {
                    winInstance.addToHistory({
                        type: 'wiki',
                        tag: initialTag,
                        content: result
                    });
                } else if (winInstance.updateNavigationButtons) {
                    winInstance.updateNavigationButtons();
                }
            } else {
                // Fallback: create normally (should be rare)
                winInstance = window.wikiWindowManager.createWindow(result, initialTag, null);
                if (winInstance && winInstance.modal && typeof bringModalToFront === 'function') {
                    bringModalToFront(winInstance.modal);
                }
            }

            return true;
        } catch (err) {
            console.error('openStandaloneWikiIfDirectMatch:', err);
            if (winInstance && winInstance.displayArea) {
                winInstance.displayArea.innerHTML = `
                    <div class="tag-wiki-error">
                        <i class="fas fa-exclamation-circle"></i> Error loading wiki page: ${this.escapeHtml(err.message || 'Unknown error')}
                    </div>
                `;
            } else if (typeof showGlassToast === 'function') {
                showGlassToast('info', null, 'No matching wiki page', false, 3500, '<i class="fas fa-book"></i>');
            }
            return false;
        }
    }
    
    async close() {
        if (!this.modal) return;

        const rightHasState = this.rightPane && !this.rightPane.isBlank();
        if (this.hasEverMaximized && rightHasState) {
            const result = await showConfirmationDialog(
                'Save the right panel state for the next time you maximise Grimoire?',
                [
                    {
                        text: 'Save',
                        value: 'save',
                        className: 'btn-primary',
                        icon: 'fas fa-floppy-disk'
                    },
                    {
                        text: "Don't save",
                        value: 'discard',
                        className: 'btn-secondary',
                        icon: 'fas fa-trash'
                    },
                    {
                        text: 'Cancel',
                        value: null,
                        className: 'btn-secondary'
                    }
                ]
            );
            if (result === null) return;
            if (result === 'save') {
                this.saveRightPaneStateToStorage();
            } else if (result === 'discard') {
                this.clearRightPaneStateFromStorage();
            }
        }

        this.exitSplitMode();
        this.teardownSplitModeListeners();
        closeModal(this.modal).then(() => {
            this.currentSearchResults = [];
            this.currentSelectedTag = null;
            this.history = [];
            this.historyIndex = -1;
            this.hasEverMaximized = false;
            this.rightPane = null;
            this.clearResults();
            this.clearDisplay();
            this.setResultsOverlayOpen(false);
        });
    }

    async refreshToolbar() {
        const p = this.activePane;
        if (p !== this) {
            // Right pane (split): best-effort refresh using the pane's own state.
            // Most right-pane usage is wiki pages or static docs.
            this.setNavigationLoading(true);
            try {
                const tag = (typeof p.getCurrentTagName === 'function') ? p.getCurrentTagName() : null;
                if (tag && typeof p.refreshFromOnline === 'function') {
                    await p.refreshFromOnline();
                    return;
                }
                const entry = p.history && p.history[p.historyIndex];
                if (entry) {
                    if (entry.content) {
                        p.renderWikiPage(entry.content);
                    } else if (entry.tag && typeof p.getTagWikiPageDirectly === 'function') {
                        p.getTagWikiPageDirectly(entry.tag.title || entry.tag.name);
                    } else if (entry.type === 'static-wiki-page' && entry.siteId && typeof p.openStaticWikiPage === 'function') {
                        p.openStaticWikiPage(entry.siteId, entry.pageId);
                    } else if (entry.type === 'home' && typeof p.goHome === 'function') {
                        p.goHome();
                    }
                }
            } finally {
                this.setNavigationLoading(false);
            }
            return;
        }

        // Refresh is always context-sensitive (for the main / left panel):
        // - On a wiki tag page (current or from history): force a fresh body fetch (refreshFromOnline).
        // - On a static doc page (e.g. novelai rdf://): re-fetch the bundled doc page.
        // - On a search results "page": re-run the search and re-render the dedicated search view (no old sidebar).
        // - Home or fallback: appropriate home/search.
        // We also drive the address bar loading indicator for the main browser.
        this.setNavigationLoading(true);
        try {
            // Wiki tag page? Use getter (currentSelectedTag may be set even if currentTagName is not after some restores)
            let tag = this.getCurrentTagName();
            if (!tag) {
                const entry = this.history && this.history[this.historyIndex];
                if (entry && entry.type === 'wiki' && entry.tag) {
                    tag = entry.tag.title || entry.tag.name || '';
                    if (tag) {
                        this.currentSelectedTag = entry.tag;
                        this.currentTagName = tag;
                    }
                }
            }
            if (tag) {
                await this.refreshFromOnline();
                return;
            }

            // Static documentation page (rdf:// etc.)
            if (this.currentStaticWiki && this.currentStaticWiki.siteId) {
                const sw = this.currentStaticWiki;
                if (sw.pageId) {
                    await this.openStaticWikiPage(sw.siteId, sw.pageId);
                } else {
                    this.showStaticWikiSiteIndex(sw.siteId);
                }
                return;
            }

            // Inspect history entry for precise context (search page, static, etc.)
            const entry = this.history && this.history[this.historyIndex];
            if (entry) {
                if (entry.type === 'static-wiki-page' && entry.siteId) {
                    await this.openStaticWikiPage(entry.siteId, entry.pageId);
                    return;
                }
                if (entry.type === 'static-wiki-index' && entry.siteId) {
                    this.showStaticWikiSiteIndex(entry.siteId);
                    return;
                }
                if (entry.query !== undefined || entry.type === 'search') {
                    const q = entry.query || (this.searchInput?.value || '').trim();
                    if (q && this.searchInput) {
                        this.searchInput.value = q;
                    }
                    if (typeof this.refreshSearchPageResults === 'function') {
                        this.refreshSearchPageResults();
                        // Keep the address bar loading indicator visible a bit longer for the async search.
                        setTimeout(() => this.setNavigationLoading(false), 750);
                    } else if (q) {
                        this.performSearch();
                    }
                    return;
                }
                if (entry.type === 'home') {
                    this.showDreamWikiHomepage();
                    return;
                }
                if (entry.type === 'dsap' && entry.url) {
                    // navigateDsapIfMatched: public/scripts/comp/dsapRegistry.js
                    if (typeof navigateDsapIfMatched === 'function') {
                        navigateDsapIfMatched(this, entry.url, { skipHistory: true, skipLoadingDelay: true });
                    }
                    return;
                }
                if (entry.type === 'nav-error' && entry.url) {
                    this.showGrimoireNavigateErrorPage({
                        url: entry.url,
                        kind: entry.kind || 'not_found',
                        protocol: entry.protocol || '',
                        skipHistory: true,
                        skipLoadingDelay: true
                    });
                    return;
                }
            }

            // Fallback: searchInput has a value → re-execute as search page (avoid old sidebar)
            const query = (this.searchInput?.value || '').trim();
            if (query) {
                if (this.searchInput) this.searchInput.value = query;
                if (typeof this.refreshSearchPageResults === 'function') {
                    this.refreshSearchPageResults();
                    setTimeout(() => this.setNavigationLoading(false), 750);
                } else {
                    await this.performSearch();
                }
                return;
            }

            // Default to home
            this.showDreamWikiHomepage();
        } catch (err) {
            console.error('refreshToolbar failed:', err);
        } finally {
            // Slight delay so the nav loading state is visible even for fast synchronous contexts (home, static re-fetch).
            // For search-page refreshes we schedule a longer delay above before returning.
            setTimeout(() => this.setNavigationLoading(false), 90);
        }
    }
    
    async performSearch() {
        if (!this.searchInput) return;
        
        const query = this.searchInput.value.trim();
        if (!query) {
            this.clearResults();
            return;
        }
        
        const filter = this.currentFilter || '';
        const searchType = this.currentSearchType || 'name';
        const source = this.currentSource || 'both';
        const includeOnline = this.includeOnline && searchType === 'name';
        
        if (this._searchPageMode) {
            // Dedicated search page flow.
        } else {
            // Legacy sidebar loading removed (sidebar deleted); the modern search page view
            // or direct wiki render will handle presentation.
        }
        
        try {
            const results = await this.searchTagWiki(query, {
                category: filter === '' ? undefined : (filter === 'non-tag' ? null : parseInt(filter, 10)),
                searchType: searchType,
                source: source,
                includeNonTag: filter === 'non-tag',
                includeOnline: includeOnline
            });
            
            this.currentSearchResults = results || [];

            if (this._searchPageMode) {
                // For search page navigation, we do NOT render to the sidebar or trigger direct-match auto-open.
                // The caller (navigate path) will render the results into the main content via showSearchResultsPage.
            } else {
                this.renderResults(this.currentSearchResults);
            }
            
            // Reflect the active search in the layered address bar (with protocol)
            if (query) {
                this.setAddress({ displayUrl: `edtx://en.grimoire.jp/search?q=${encodeURIComponent(query)}`, mode: 'edtx' });
            }
            
            // Add to history
            this.addToHistory({
                query,
                filter,
                searchType,
                source,
                includeOnline,
                results: this.currentSearchResults
            });
        } catch (error) {
            console.error('Tag wiki search error:', error);
            // Old sidebar error state removed; errors surface in the search page view or display.
            this.updateSearchControlsVisibility();
        }
    }
    
    async searchTagWiki(query, options = {}) {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        const { category, searchType, source, includeNonTag, includeOnline } = options;
        
        try {
            const result = await window.wsClient.sendMessage('search_tag_wiki', {
                query,
                category,
                searchType: searchType || 'name',
                source: source || 'both',
                includeNonTag: includeNonTag || false,
                includeOnline: includeOnline === true,
                limit: 50
            });
            
            // WebSocket sendMessage returns the data directly (message.data from server)
            this.lastOnlineSectionCount = result?.sections?.onlineOnly ?? null;
            this.lastOnlineTagOnlyCount = result?.sections?.onlineTagOnly ?? null;
            return result?.results || [];
        } catch (error) {
            console.error('Tag wiki search request failed:', error);
            throw error;
        }
    }
    
    renderResultItem(result, index, extraClass = '') {
        const sourceIcon = this.getSourceIcon(result.source);
        const category = result.categoryName || 'Uncategorized';
        const tagName = result.title || result.name || 'Unknown';
        const wikiName = result.name || tagName.replace(/\s+/g, '_');
        const cloudBadge = (result.matchType === 'merged' || result.onlineOnly)
            ? '<i class="fas fa-cloud tag-wiki-online-icon" title="Online"></i>'
            : '';
        return `
            <div class="tag-wiki-result-item ${extraClass}" data-index="${index}" data-tag-id="${result.id || ''}" data-tag-name="${tagName}" data-wiki-name="${wikiName}">
                <div class="tag-wiki-result-name">${this.escapeHtml(tagName)}</div>
                <div class="tag-wiki-result-source">${cloudBadge}${sourceIcon}</div>
                <div class="tag-wiki-result-category">${this.escapeHtml(category)}</div>
            </div>
        `;
    }

    shouldShowSearchControls() {
        const entry = this.history[this.historyIndex];
        if (entry && (entry.type === 'wiki' || entry.type === 'static-wiki-page' || entry.type === 'static-wiki-index')) {
            return false;
        }
        return true;
    }

    // Old sidebar controls visibility and panel title (panel deleted) are no-ops.
    updateSearchControlsVisibility() {}
    updateResultsPanelTitle() {}

    renderResults(results) {
        // Legacy sidebar renderer stubbed out (old results panel deleted).
        // New results "page" rendering lives in showSearchResultsPage.
        if (this._searchPageMode) return;
        const q = (this.searchInput && this.searchInput.value.trim()) || '';
        if (q) this.showSearchResultsPage(q, false);
    }

    /**
     * Render a classic Google-like search results "page" into the main display area.
     * This is used when the pseudo-browser navigates to an en.grimoire.jp/search location.
     * The old left results sidebar is treated as secondary/overlay and can be hidden for this view.
     */
    showSearchResultsPage(query = '', isLoading = false) {
        this._searchResultIndex = -1;
        if (!this.displayArea) return;

        // deactivateDsapOnShell: public/scripts/comp/dsapRegistry.js
        if (typeof deactivateDsapOnShell === 'function') deactivateDsapOnShell(this);

        // Respect explicitly passed query from navigation URL ('' means the search homepage form).
        // Only fall back to current address input value if no explicit query string was provided in the call.
        let q = String(query ?? '').trim();
        if (q === '' && this.searchInput) {
            // Only use input value as fallback for "search what I'm thinking" cases, not when explicitly going to the bare search home.
            // In practice the callers that want home pass '' and we want the home UI.
            // If the input has a previous value and we want to search it, the caller should have put ?q= in the url.
            q = ''; // force home when '' explicitly passed for the form
        }
        const results = this.currentSearchResults || [];

        // Activate search-page view mode (hides the persistent results sidebar "overlay")
        // Only hide the panel if NOT in split/maximised mode (so search page can live in a content pane)
        const inSplit = !!(this.isSplitMode && this.isSplitMode());
        if (this.searchBody) {
            if (!inSplit) {
                this.searchBody.classList.add('search-page-view');
            }
            // also clear any old overlay classes that might be lingering
            this.searchBody.classList.remove('tag-wiki-results-overlay-open');
            if (this.modal) this.modal.classList.remove('tag-wiki-results-overlay-open');
        }

        // --- Classic Google-style search *homepage* when no query ---
        if (!q && !isLoading) {
            const homeHtml = `
<div class="grimoire-google-home">
  <div class="google-brand">
    <img src="/static_images/grim_logo.png" alt="Grimoire" class="brand-logo">
  </div>
  <div class="google-search-form">
    <div class="search-box-large">
      <i class="fas fa-search"></i>
      <input type="text" class="google-large-input" placeholder="Search the encyclopedia...">
      <i class="fas fa-cog search-gear" title="Search options &amp; filters"></i>
    </div>
    <div class="google-actions">
      <button class="google-action-btn" data-action="search">Search</button>
      <button class="google-action-btn" data-action="lucky">I'm Feeling Lucky</button>
    </div>
  </div>
  <div class="google-hint">Tip: Use the top address bar for direct <code>edtx://</code> navigation or tag names.</div>
</div>`;
            this.displayArea.innerHTML = homeHtml;

            const largeInput = this.displayArea.querySelector('.google-large-input');
            const searchBtn = this.displayArea.querySelector('[data-action="search"]');
            const luckyBtn = this.displayArea.querySelector('[data-action="lucky"]');

            const doHomeSearch = () => {
                const val = (largeInput && largeInput.value.trim()) || '';
                if (val) this.navigate(`edtx://en.grimoire.jp/search?q=${encodeURIComponent(val)}`);
            };
            if (largeInput) {
                largeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doHomeSearch(); });
            }
            if (searchBtn) searchBtn.addEventListener('click', doHomeSearch);
            if (luckyBtn) luckyBtn.addEventListener('click', () => {
                // Feeling lucky: jump to a common demo search
                const demos = ['1girl', 'solo', 'cat', 'school_uniform'];
                const pick = demos[Math.floor(Math.random() * demos.length)];
                this.navigate(`edtx://en.grimoire.jp/search?q=${pick}`);
            });

            // Gear for search options on the pure homepage (same as results page)
            const homeGear = this.displayArea.querySelector('.search-gear');
            if (homeGear && contextMenu && typeof contextMenu.attachClickMenuToElement === 'function') {
                const cfg = this.showSearchControlsContextMenu(homeGear, true /* returnOnly */);
                if (cfg) {
                    contextMenu.attachClickMenuToElement(homeGear, cfg);
                }
                homeGear.addEventListener('click', (e) => e.stopPropagation());
            } else if (homeGear) {
                homeGear.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (typeof showGlassToast === 'function') {
                        showGlassToast('info', 'Search', 'Search options (context/click menu system not available)', false, 2000);
                    }
                });
            }

            return;
        }

        // --- Normal search results page (with query or loading) ---
        const wikiResults = results.filter(r => r.hasWiki);
        const noWikiResults = results.filter(r => !r.hasWiki);

        let innerResults = '';

        if (isLoading) {
            let loadMsg = `Searching${q ? ` for “${this.escapeHtml(q)}”` : ''}...`;
            if (this._checkingOnlineTag) {
                loadMsg = `Attempting to redirect to online wiki version for “${this.escapeHtml(this._checkingOnlineTag)}”...`;
            }
            innerResults = `
<div class="search-loading">
  <i class="fas fa-spinner-third fa-spin"></i>
  <span>${loadMsg}</span>
</div>`;
        } else if (this._checkingOnlineTag && wikiResults.length === 0) {
            // Special sorry page for failed online check from tag cloud
            innerResults = `
<div class="online-sorry">
  <i class="fas fa-exclamation-triangle"></i>
  <p>Sorry, no wiki page was found for <strong>${this.escapeHtml(this._checkingOnlineTag)}</strong> on the online sources either.</p>
</div>`;
            delete this._checkingOnlineTag;
        } else if (!wikiResults.length && !noWikiResults.length) {
            innerResults = `<div class="search-empty-state"><i class="fas fa-search"></i><p>No matching tags or wiki pages found. Try broadening your search.</p></div>`;
        } else {
            innerResults = `<div class="search-results-list google-style">`;
            wikiResults.slice(0, 40).forEach((result) => {
                const tagName = this.escapeHtml(result.title || result.name || 'Unknown');
                const cat = this.escapeHtml(result.categoryName || 'Uncategorized');
                const sourceHtml = this.getSourceIcon(result.source);
                const cloud = (result.matchType === 'merged' || result.onlineOnly) ? '<i class="fas fa-cloud tag-wiki-online-icon" title="Online"></i>' : '';
                const imgIcon = result.hasWiki ? '<i class="fas fa-image" title="Contains images / references in wiki"></i>' : '';

                const snippet = `Wiki and usage details for the ${cat} tag. Click to open the full page with examples, related tags, and prompt advice.`;

                innerResults += `
<div class="google-search-result" data-tag-name="${this.escapeHtml(result.name || tagName)}">
  <div class="result-title-row">
    <span class="result-title">${tagName}</span>
    <span class="result-icons">
      ${sourceHtml}
      ${cloud}
      ${imgIcon}
    </span>
  </div>
  <div class="result-category">${cat}</div>
  <div class="result-snippet">${this.escapeHtml(snippet)}</div>
</div>`;
            });
            innerResults += `</div>`;

            // No-wiki tags section with tag cloud at the bottom (only if not the sorry case above)
            if (noWikiResults.length && !this._checkingOnlineTag) {
                innerResults += `
<div class="no-wiki-section">
  <h4>Tags without wiki pages (click to check online)</h4>
  <div class="tag-cloud">`;
                noWikiResults.slice(0, 30).forEach((r) => {
                    const nm = this.escapeHtml(r.title || r.name || 'Unknown');
                    innerResults += `<span class="tag-pill" data-tag="${nm}">${nm}</span>`;
                });
                innerResults += `</div>
</div>`;
            }
        }

        if (this._checkingOnlineTag) {
            delete this._checkingOnlineTag;
        }

        const stats = isLoading ? '' : (results.length ? `About ${results.length} results` : 'No results');

        const html = `
<div class="grimoire-search-page">
  <div class="search-page-header">
    <div class="search-page-bar">
      <i class="fas fa-search search-page-icon"></i>
      <input type="text" class="search-page-input form-control" value="${this.escapeHtml(q)}" placeholder="Search tags, wikis, and documentation...">
      <i class="fas fa-cog search-gear" title="Search options &amp; filters"></i>
      <button type="button" class="btn-secondary search-page-go">Search</button>
    </div>
    <div class="search-page-options">
      <span class="search-page-hint">Results for <strong>${this.escapeHtml(q || 'everything')}</strong>. Use the address bar or top filters.</span>
    </div>
  </div>

  <div class="search-page-stats">${stats}</div>

  <div class="search-results-list google-style">
    ${innerResults}
  </div>
</div>`;

        this.displayArea.innerHTML = html;

        // Wire the page-internal search bar
        const pageInput = this.displayArea.querySelector('.search-page-input');
        const goBtn = this.displayArea.querySelector('.search-page-go');
        const doSearch = () => {
            const newQ = (pageInput && pageInput.value.trim()) || q;
            if (newQ) {
                this.navigate(`edtx://en.grimoire.jp/search?q=${encodeURIComponent(newQ)}`);
            }
        };
        if (pageInput) {
            pageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') doSearch();
            });
        }
        if (goBtn) goBtn.addEventListener('click', doSearch);

        // Gear icon for search controls (replaces the old sidebar header filters when on the dedicated search page).
        // Placed immediately to the left of the "Search" go button as requested.
        // Attach *before* any user click so the context system's mousedown/click listeners see [data-click-menu] and open the menu on the gear click.
        const gear = this.displayArea.querySelector('.search-gear');
        if (gear && contextMenu && typeof contextMenu.attachClickMenuToElement === 'function') {
            // Build fresh config (with current toggle states) and attach for click-to-open.
            // The show function now returns the config (and attaches only if anchor passed).
            const cfg = this.showSearchControlsContextMenu(gear, true /* returnOnly */);
            if (cfg) {
                contextMenu.attachClickMenuToElement(gear, cfg);
            }
            gear.addEventListener('click', (e) => e.stopPropagation());
        } else if (gear) {
            gear.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof showGlassToast === 'function') {
                    showGlassToast('info', 'Search', 'Search options (context/click menu system not available)', false, 2000);
                }
            });
        }

        // Wire clicking a result -> load the wiki page (this path still supports direct tag navigation via getTagWikiPageDirectly / selectTag for other callers)
        this.displayArea.querySelectorAll('.google-search-result').forEach((el) => {
            el.addEventListener('click', () => {
                const tagName = el.dataset.tagName;
                if (tagName) {
                    this.getTagWikiPageDirectly(tagName);
                }
            });
        });

        // Tag cloud pills (no-wiki results) - click to attempt online wiki check
        // Uses direct wiki lookup (not search) so it targets the exact clicked tag.
        this.displayArea.querySelectorAll('.tag-pill').forEach((pill) => {
            pill.addEventListener('click', () => {
                const tag = pill.dataset.tag;
                if (!tag) return;
                this._checkingOnlineTag = tag;
                this.includeOnline = true;
                if (this.searchInput) this.searchInput.value = tag;
                this._showOnlineLookupPage(tag);
                // Direct attempt for this exact tag (source 'both' will try online if no local wiki).
                // The dedicated UI stays visible during fetch (see guard in getTagWikiPageDirectly).
                this.getTagWikiPageDirectly(tag);
            });
        });

        // Attach the full per-tag context menu (copy, favorites, phasewalker, add to prompt, 
        // new window, desktop, AND the "Open on Left"/"Open on Right" send-to-pane options when in split mode)
        // to search result items and tag pills in the dedicated search page view.
        // This makes "send to left and right" available directly from the results list / cloud.
        this.displayArea.querySelectorAll('.google-search-result, .tag-pill').forEach((el) => {
            const tagName = el.dataset.tagName || el.dataset.tag;
            if (tagName) {
                el.dataset.tagName = tagName; // normalize for setupLinkContextMenu
                this.setupLinkContextMenu(el);
            }
        });

        // Robust interception for any links that might have been rendered (anchors, pseudo, external safety)
        if (typeof this._interceptAllLinks === 'function') {
            this._interceptAllLinks();
        }
    }

    showSearchControlsContextMenu(anchorEl, returnOnly = false) {
        if (!contextMenu && !returnOnly) return null;

        const config = {
            position: 'anchor',
            anchor: anchorEl,
            anchorAlign: 'start',
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            // Web/online search toggle uses *highlighted* as state indicator (standard: no checkmark text, no toggle icons)
                            text: 'Online search',
                            icon: 'fas fa-globe',
                            action: 'toggle-online',
                            loadfn: (item) => {
                                item.highlighted = !!this.includeOnline;
                            }
                        },
                        { separator: true },
                        {
                            // Source as submenu (open on hover), active indicated by highlighted (no ✓ appended)
                            text: 'Source',
                            icon: 'fas fa-database',
                            openOnHover: true,
                            optionsfn: () => {
                                const src = this.currentSource || 'both';
                                return [
                                    {
                                        text: 'Danbooru',
                                        icon: 'fas fa-globe',
                                        action: 'source-danbooru',
                                        loadfn: (item) => { item.highlighted = src === 'danbooru'; }
                                    },
                                    {
                                        text: 'e621',
                                        icon: 'fas fa-paw',
                                        action: 'source-e621',
                                        loadfn: (item) => { item.highlighted = src === 'e621'; }
                                    },
                                    {
                                        text: 'Both',
                                        icon: 'fas fa-layer-group',
                                        action: 'source-both',
                                        loadfn: (item) => { item.highlighted = src === 'both'; }
                                    }
                                ];
                            }
                        },
                        {
                            // Search type (name vs description) as submenu, highlighted for active
                            text: 'Search by',
                            icon: 'fas fa-search',
                            openOnHover: true,
                            optionsfn: () => {
                                const typ = this.currentSearchType || 'name';
                                return [
                                    {
                                        text: 'Name',
                                        icon: 'fas fa-tag',
                                        action: 'type-name',
                                        loadfn: (item) => { item.highlighted = typ === 'name'; }
                                    },
                                    {
                                        text: 'Description',
                                        icon: 'fas fa-file-alt',
                                        action: 'type-description',
                                        loadfn: (item) => { item.highlighted = typ === 'description'; }
                                    }
                                ];
                            }
                        },
                        { separator: true },
                        {
                            // Category remains submenu; items get highlighted for current via loadfn wrapper (no check text)
                            text: 'Category Filter...',
                            icon: 'fas fa-filter',
                            openOnHover: true,
                            optionsfn: () => this.getGrimoireFilterOptionsForMenu().map((opt) => ({
                                text: opt.text || opt.label,
                                icon: (opt.filterValue === '' || !opt.filterValue) ? 'fas fa-tags' : 'fas fa-tag',
                                action: opt.action || ('filter-' + (opt.filterValue || '')),
                                filterValue: opt.filterValue,
                                loadfn: (item) => {
                                    const cur = (this.currentFilter || '');
                                    const val = (item.filterValue != null ? String(item.filterValue) : '');
                                    item.highlighted = val === cur;
                                }
                            })),
                            handlerfn: (sub) => {
                                if (sub && sub.filterValue !== undefined) {
                                    this.applyGrimoireFilter(sub.filterValue);
                                    setTimeout(() => this.refreshSearchPageResults(), 50);
                                }
                            }
                        }
                    ]
                }
            ],
            onAction: (action) => {
                switch (action) {
                    case 'toggle-online':
                        this.includeOnline = !this.includeOnline;
                        try {
                            localStorage.setItem(GRIMOIRE_ONLINE_SEARCH_LS, this.includeOnline ? 'true' : 'false');
                        } catch (err) { /* */ }
                        this.updateOnlineToggleState && this.updateOnlineToggleState();
                        this.refreshSearchPageResults();
                        break;
                    case 'source-danbooru':
                        this.currentSource = 'danbooru';
                        this.refreshSearchPageResults();
                        break;
                    case 'source-e621':
                        this.currentSource = 'e621';
                        this.refreshSearchPageResults();
                        break;
                    case 'source-both':
                        this.currentSource = 'both';
                        this.refreshSearchPageResults();
                        break;
                    case 'type-name':
                        this.currentSearchType = 'name';
                        this.updateOnlineToggleState && this.updateOnlineToggleState();
                        this.refreshSearchPageResults();
                        break;
                    case 'type-description':
                        this.currentSearchType = 'description';
                        this.updateOnlineToggleState && this.updateOnlineToggleState();
                        this.refreshSearchPageResults();
                        break;
                }
            }
        };

        if (returnOnly) {
            return config;
        }

        // Attach for click-to-open (preferred for gear/options).
        if (contextMenu && typeof contextMenu.attachClickMenuToElement === 'function') {
            contextMenu.attachClickMenuToElement(anchorEl, config);
        } else if (contextMenu && typeof contextMenu.attachToElement === 'function') {
            contextMenu.attachToElement(anchorEl, config);
        }
        return config;
    }

    getGrimoireFilterOptionsForMenu() {
        // Reuse or approximate the filter options from existing logic
        if (typeof this.getGrimoireFilterOptions === 'function') {
            return this.getGrimoireFilterOptions().map(opt => ({
                text: opt.label,
                filterValue: opt.value,
                action: 'filter-' + opt.value
            }));
        }
        // Fallback simple categories
        return [
            { text: 'All', filterValue: '' },
            { text: 'General', filterValue: '0' },
            { text: 'Character', filterValue: '4' },
            { text: 'Copyright', filterValue: '3' },
            { text: 'Artist', filterValue: '1' },
            { text: 'Meta', filterValue: '5' }
        ];
    }

    refreshSearchPageResults() {
        // Re-run search with current filter states and re-render into the dedicated search page view.
        // Temporarily force _searchPageMode so performSearch + renderResults skip the legacy
        // results sidebar / overlay (we removed reliance on the old split sidebar for search pages).
        const currentQ = (this.searchInput && this.searchInput.value.trim()) || '';
        if (!currentQ) return;
        const wasSearchPageMode = !!this._searchPageMode;
        this._searchPageMode = true;
        this.performSearch().finally(() => {
            this._searchPageMode = wasSearchPageMode;
            this.showSearchResultsPage(currentQ, false);
        });
    }

    // Dedicated "online page lookup" UI for tag cloud clicks (no-wiki tags)
    // Shows attempting state, then either loads the wiki or a sorry page.
    _showOnlineLookupPage(tag) {
        if (!this.displayArea) return;
        const safe = this.escapeHtml(tag);
        this.displayArea.innerHTML = `
<div class="online-lookup dedicated-page">
  <div class="lookup-hero">
    <i class="fas fa-globe fa-2x"></i>
    <h2>Online Wiki Lookup</h2>
  </div>
  <p>Attempting to redirect to the online wiki version for <strong>${safe}</strong> (Danbooru &amp; e621)...</p>
  <div class="lookup-spinner"><i class="fas fa-spinner-third fa-spin fa-3x"></i></div>
</div>`;
        this.setAddress({ displayUrl: `edtx://en.grimoire.jp/online-lookup?q=${encodeURIComponent(tag)}`, mode: 'edtx' });
        if (typeof this._interceptAllLinks === 'function') {
            this._interceptAllLinks();
        }
    }

    _showOnlineLookupSorry(tag) {
        if (!this.displayArea) return;
        const safe = this.escapeHtml(tag);
        this.displayArea.innerHTML = `
<div class="online-lookup dedicated-page sorry">
  <div class="lookup-hero">
    <i class="fas fa-exclamation-circle fa-2x"></i>
    <h2>Online Lookup Failed</h2>
  </div>
  <p>Sorry, no wiki page was found for <strong>${safe}</strong> on the online sources either.</p>
  <div class="sorry-actions">
    <button type="button" class="btn-secondary" data-action="search-anyway">Search anyway (local + online)</button>
    <button type="button" class="btn-secondary" data-action="back-to-home">Back to Grimoire home</button>
  </div>
</div>`;
        // wire actions
        const anyway = this.displayArea.querySelector('[data-action="search-anyway"]');
        if (anyway) {
            anyway.addEventListener('click', () => {
                this.navigate(`edtx://en.grimoire.jp/search?q=${encodeURIComponent(tag)}`);
            });
        }
        const back = this.displayArea.querySelector('[data-action="back-to-home"]');
        if (back) {
            back.addEventListener('click', () => {
                this.navigate('edtx://en.grimoire.jp/index.dtxt');
            });
        }
        this.setAddress({ displayUrl: `edtx://en.grimoire.jp/search?q=${encodeURIComponent(tag)}`, mode: 'edtx' });
        if (typeof this._interceptAllLinks === 'function') {
            this._interceptAllLinks();
        }
    }
    
    checkAndOpenDirectMatch(allResults, itemsWithWiki) {
        if (!this.searchInput) return;
        if (this._checkingOnlineTag) return;  // suppress auto-direct during dedicated online lookup from tag cloud
        
        const query = this.searchInput.value.trim().toLowerCase();
        if (!query) return;
        
        const normalizedQuery = query
            .replace(/^(?:species|invalid):/i, '')
            .replace(/[_\s]+/g, ' ')
            .trim();
        
        const normalizedQueryKey = normalizedQuery.replace(/\s+/g, '_');
        
        // Find exact match
        const directMatch = itemsWithWiki.find(({ result }) => {
            const tagName = (result.title || result.name || '').toLowerCase();
            const normalizedTagName = tagName.replace(/[_\s]+/g, ' ');
            const tagKey = (result.name || tagName).replace(/[_\s]+/g, '_');
            return normalizedTagName === normalizedQuery || tagKey === normalizedQueryKey;
        });
        
        if (directMatch && directMatch.result.hasWiki) {
            // Auto-open the direct match
            setTimeout(() => {
                this.selectTag(directMatch.result);
            }, 100);
        }
    }
    
    getSourceIcon(source) {
        if (Array.isArray(source)) {
            const hasDanbooru = source.includes('danbooru');
            const hasE621 = source.includes('e621');
            
            if (hasDanbooru && hasE621) {
                // Show both icons when multiple sources match
                return '<i class="nai-sakura" title="Danbooru"></i><i class="nai-paw" title="e621" style="margin-left: 4px;"></i>';
            } else if (hasDanbooru) {
                return '<i class="nai-sakura" title="Danbooru"></i>';
            } else if (hasE621) {
                return '<i class="nai-paw" title="e621"></i>';
            }
        }
        if (source === 'danbooru' || (Array.isArray(source) && source.length === 1 && source[0] === 'danbooru')) {
            return '<i class="nai-sakura" title="Danbooru"></i>';
        } else if (source === 'e621' || (Array.isArray(source) && source.length === 1 && source[0] === 'e621')) {
            return '<i class="nai-paw" title="e621"></i>';
        }
        return '<i class="fas fa-question-circle" title="Unknown"></i>';
    }
    
    async selectTag(tag) {
        if (!tag) return;
        
        this.currentSelectedTag = tag;

        if (this.needsResultsOverlay()) {
            this.setResultsOverlayOpen(false);
        }
        
        // Update selected state in results
        const items = this.resultsList.querySelectorAll('.tag-wiki-result-item');
        items.forEach(item => {
            if (item.dataset.tagId === String(tag.id || '') || item.dataset.tagName === (tag.title || tag.name)) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
        
        // Show loading
        if (this.displayArea) {
            this.displayArea.innerHTML = '<div class="tag-wiki-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading wiki page...</div>';
        }
        
        try {
            const wikiContent = await this.getTagWikiPage(tag);
            
            // Check for errors before rendering
            if (!this.hasWikiPageContent(wikiContent)) {
                const errorText = (wikiContent && wikiContent.error)
                    || `Error loading wiki for "${tag.title || tag.name || 'tag'}"`;
                const canGoBack = this.history && this.historyIndex > 0;
                const backButtonHtml = canGoBack
                    ? `<button class="btn-secondary btn-small wiki-error-back-btn" style="margin-top: var(--spacing-sm);">
                        <i class="fas fa-arrow-left"></i> Back
                    </button>`
                    : '';

                if (this.displayArea) {
                    this.displayArea.innerHTML = `
                        <div class="tag-wiki-error">
                            <i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(errorText)}
                            ${backButtonHtml}
                        </div>
                    `;

                    // Setup back button click handler
                    if (canGoBack) {
                        const backBtn = this.displayArea.querySelector('.wiki-error-back-btn');
                        if (backBtn) {
                            backBtn.addEventListener('click', () => {
                                if (this.goBack) {
                                    this.goBack();
                                }
                            });
                        }
                    }
                }
                return;
            }

            this.renderWikiPage(wikiContent);
            this.currentTagName = this.resolveBooruWikiTagName(tag);

            // Add to history only if content loaded
            if (this.hasWikiPageContent(wikiContent)) {
                dreamWikiRecentAppend(tag.title || tag.name || '');
                this.addToHistory({
                    type: 'wiki',
                    tag: tag,
                    content: wikiContent
                });
            }
        } catch (error) {
            console.error('Error loading wiki page:', error);
            const canGoBack = this.history && this.historyIndex > 0;
            const backButtonHtml = canGoBack 
                ? `<button class="btn-secondary btn-small wiki-error-back-btn" style="margin-top: var(--spacing-sm);">
                    <i class="fas fa-arrow-left"></i> Back
                </button>`
                : '';
            
            if (this.displayArea) {
                this.displayArea.innerHTML = `
                    <div class="tag-wiki-error">
                        <i class="fas fa-exclamation-circle"></i> Error loading wiki: ${this.escapeHtml(error.message)}
                        ${backButtonHtml}
                    </div>
                `;
                
                // Setup back button click handler
                if (canGoBack) {
                    const backBtn = this.displayArea.querySelector('.wiki-error-back-btn');
                    if (backBtn) {
                        backBtn.addEventListener('click', () => {
                            if (this.goBack) {
                                this.goBack();
                            }
                        });
                    }
                }
            }
        }
    }
    
    openInNewWindow() {
        if (!this.displayArea) {
            console.warn('openInNewWindow: displayArea is null');
            return;
        }

        if (this._dsapActive && this._dsapState?.url) {
            // openDsapInStandaloneWindow: public/scripts/comp/dsapRegistry.js
            if (typeof openDsapInStandaloneWindow === 'function') {
                const historyToCopy = this.history && this.history.length > 0
                    ? this.history.slice(0, this.historyIndex + 1)
                    : null;
                openDsapInStandaloneWindow(this._dsapState.url, { historyToCopy });
                return;
            }
        }
        
        if (!wikiWindowManager) {
            console.error('openInNewWindow: wikiWindowManager is not available');
            return;
        }
        
        const currentContent = this.getCurrentPageContent();
        if (!currentContent) {
            console.warn('openInNewWindow: No page content available to open');
            return;
        }

        let initialTag = this.currentSelectedTag;
        if (!initialTag && this.currentStaticWiki) {
            const sw = this.currentStaticWiki;
            initialTag = {
                title: sw.title,
                name: `${sw.siteId}:${sw.pageId}`
            };
        } else if (!initialTag && currentContent.staticWiki) {
            initialTag = {
                title: currentContent.title || currentContent.tagName,
                name: `${currentContent.siteId}:${currentContent.pageId}`
            };
        }

        const historyToCopy = this.history && this.history.length > 0
            ? this.history.slice(0, this.historyIndex + 1)
            : null;

        wikiWindowManager.createWindow(currentContent, initialTag, historyToCopy);
    }
    
    clearResults() {
        // Old list cleared (sidebar removed); keep current results for the page view if needed.
        this.currentSearchResults = [];
        this.updateSearchControlsVisibility();
    }
    
    clearDisplay() {
        if (this.displayArea) {
            this.displayArea.innerHTML = `
                <div class="tag-wiki-empty-state">
                    <i class="fas fa-book-open"></i>
                    <p>Select a tag from the results to view its wiki page</p>
                </div>
            `;
        }
        this.currentSelectedTag = null;
    }
    
    addToHistory(entry) {
        // Remove any entries after current index
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        
        this.history.push(entry);
        this.historyIndex = this.history.length - 1;
        const capped = capTagWikiHistoryEntries(this.history, this.historyIndex);
        this.history = capped.history;
        this.historyIndex = capped.historyIndex;
        
        this.updateNavigationButtons();
        this.updateSearchControlsVisibility();
    }
    
    goHome() {
        if (this.searchInput) {
            this.searchInput.value = '';
        }
        this.clearResults();
        this.history = [{ type: 'home' }];
        this.historyIndex = 0;
        this.showDreamWikiHomepage();
        this.setAddress({ displayUrl: 'edtx://en.grimoire.jp/index.dtxt', mode: 'edtx' });
        this.updateNavigationButtons();
        this.updateSearchControlsVisibility();
    }
    
    restoreHistoryEntry(entry) {
        if (!entry) return;

        if (entry.type === 'home') {
            this.currentSelectedTag = null;
            this.currentTagName = null;
            this.showDreamWikiHomepage();
            this.setAddress({ displayUrl: 'edtx://en.grimoire.jp/index.dtxt', mode: 'edtx' });
            this.updateNavigationButtons();
            return;
        }

        if (entry.type === 'dsap' && entry.url) {
            this.currentSelectedTag = null;
            this.currentTagName = null;
            if (typeof navigateDsapIfMatched === 'function') {
                navigateDsapIfMatched(this, entry.url, { skipHistory: true, skipLoadingDelay: true });
            } else if (typeof this.navigate === 'function') {
                this.navigate(entry.url);
            }
            this.updateNavigationButtons();
            return;
        }

        if (entry.type === 'nav-error' && entry.url) {
            this.currentSelectedTag = null;
            this.currentTagName = null;
            this.showGrimoireNavigateErrorPage({
                url: entry.url,
                kind: entry.kind || 'not_found',
                protocol: entry.protocol || '',
                skipHistory: true,
                skipLoadingDelay: true
            });
            if (typeof grimoireNormalizePseudoDisplayUrl === 'function') {
                this.setAddress(grimoireNormalizePseudoDisplayUrl(entry.url));
            }
            this.updateNavigationButtons();
            return;
        }

        if (entry.type === 'static-wiki-index') {
            this.currentSelectedTag = null;
            this.currentTagName = null;
            this.showStaticWikiSiteIndex(entry.siteId);
            this.updateNavigationButtons();
            return;
        }

        if (entry.type === 'static-wiki-page') {
            this.currentSelectedTag = null;
            this.currentTagName = null;
            if (entry.content) {
                this.renderWikiPage(entry.content);
            } else {
                this.openStaticWikiPage(entry.siteId, entry.pageId);
            }
            this.updateNavigationButtons();
            return;
        }
        
        if (entry.type === 'wiki') {
            // Restore wiki view
            if (entry.tag) {
                this.currentSelectedTag = entry.tag;
                this.currentTagName = entry.tag.title || entry.tag.name || this.currentTagName || '';
                if (entry.content) {
                    this.renderWikiPage(entry.content);
                } else {
                    this.selectTag(entry.tag);
                }
            }
        } else {
            // Restore search results
            if (this.searchInput) {
                this.searchInput.value = entry.query || '';
            }
            if (entry.filter !== undefined) {
                this.currentFilter = entry.filter || '';
                const filterOptions = [
                    { value: '', label: 'All Categories' },
                    { value: '0', label: 'General' },
                    { value: '1', label: 'Artist' },
                    { value: '3', label: 'Copyright' },
                    { value: '4', label: 'Character' },
                    { value: '5', label: 'Meta' },
                    { value: '6', label: 'Species' },
                    { value: 'non-tag', label: 'Non-Tag Results' }
                ];
                const filterOption = filterOptions.find(opt => opt.value === this.currentFilter);
                if (this.filterIcon) {
                    this.filterIcon.className = 'fas fa-filter';
                }
            }
            if (entry.searchType !== undefined) {
                this.currentSearchType = entry.searchType || 'name';
                if (this.searchTypeIcon) {
                    if (this.currentSearchType === 'description') {
                        this.searchTypeIcon.className = 'fas fa-font';
                    } else {
                        this.searchTypeIcon.className = 'fas fa-tag';
                    }
                }
            }
            if (entry.source !== undefined) {
                this.currentSource = entry.source || 'both';
                if (this.sourceIcon) {
                    if (this.currentSource === 'danbooru') {
                        this.sourceIcon.className = 'nai-sakura';
                    } else if (this.currentSource === 'e621') {
                        this.sourceIcon.className = 'nai-paw';
                    } else {
                        this.sourceIcon.className = 'fas fa-globe';
                    }
                }
            }
            if (entry.includeOnline !== undefined) {
                this.includeOnline = !!entry.includeOnline;
                if (this.onlineToggleBtn) {
                    this.onlineToggleBtn.dataset.state = this.includeOnline ? 'on' : 'off';
                    this.onlineToggleBtn.title = this.includeOnline
                        ? 'Online search enabled (Danbooru & e621)'
                        : 'Search online (Danbooru & e621)';
                }
            }
            if (entry.query !== undefined) {
                // Search entry (including the search homepage when query is empty string)
                if (this.searchInput) {
                    this.searchInput.value = entry.query || '';
                }
                this.currentSearchResults = entry.results || [];
                this.showSearchResultsPage(entry.query || '', false);

                // Make sure address bar shows the correct pretty url for this history entry
                const display = entry.query
                    ? `edtx://en.grimoire.jp/search?q=${encodeURIComponent(entry.query)}`
                    : 'edtx://en.grimoire.jp/search';
                this.setAddress({ displayUrl: display, mode: 'edtx' });
            } else {
                this.updateResultsSidebar(true);
            }
        }
        
        this.updateNavigationButtons();
        this.updateSearchControlsVisibility();
    }
    
    updateNavigationButtons() {
        // Update button disabled states
        if (this.backBtn) {
            this.backBtn.disabled = this.historyIndex <= 0;
        }
        if (this.forwardBtn) {
            this.forwardBtn.disabled = this.historyIndex >= this.history.length - 1;
        }
        
        // Update back button context menu
        if (this.backMenuConfig && contextMenu && this.backBtn) {
            const backItems = [];
            const isStandalone = this.isStandaloneWindow();
            
            for (let i = this.historyIndex - 1; i >= 0; i--) {
                const entry = this.history[i];
                
                // Standalone windows: wiki, DSAP, and static docs in history menus
                if (isStandalone && !['wiki', 'dsap', 'static-wiki-page', 'static-wiki-index'].includes(entry.type)) {
                    continue;
                }
                
                const displayText = this.getHistoryEntryDisplayText(entry, i);
                backItems.push({
                    text: displayText,
                    icon: this.getHistoryEntryMenuIcon(entry),
                    action: `wiki-back-to-${i}`,
                    data: { index: i }
                });
            }
            
            // If no items, add a "No history" message
            if (backItems.length === 0) {
                backItems.push({
                    text: 'No history',
                    icon: 'fas fa-info-circle',
                    action: 'wiki-no-action',
                    disabled: true
                });
            }
            
            this.backMenuConfig.sections[0].items = backItems;
            contextMenu.detachFromElement(this.backBtn);
            contextMenu.attachToElement(this.backBtn, this.backMenuConfig);
        }
        
        // Update forward button context menu
        if (this.forwardMenuConfig && contextMenu && this.forwardBtn) {
            const forwardItems = [];
            const isStandalone = this.isStandaloneWindow();
            
            for (let i = this.historyIndex + 1; i < this.history.length; i++) {
                const entry = this.history[i];
                
                // Standalone windows: wiki, DSAP, and static docs in history menus
                if (isStandalone && !['wiki', 'dsap', 'static-wiki-page', 'static-wiki-index'].includes(entry.type)) {
                    continue;
                }
                
                const displayText = this.getHistoryEntryDisplayText(entry, i);
                forwardItems.push({
                    text: displayText,
                    icon: this.getHistoryEntryMenuIcon(entry),
                    action: `wiki-forward-to-${i}`,
                    data: { index: i }
                });
            }
            
            // If no items, add a "No history" message
            if (forwardItems.length === 0) {
                forwardItems.push({
                    text: 'No history',
                    icon: 'fas fa-info-circle',
                    action: 'wiki-no-action',
                    disabled: true
                });
            }
            
            this.forwardMenuConfig.sections[0].items = forwardItems;
            contextMenu.detachFromElement(this.forwardBtn);
            contextMenu.attachToElement(this.forwardBtn, this.forwardMenuConfig);
        }
        this._notifyGrimoireKeyboardOverlayContextChanged();
    }
}

// Global instances - create immediately
const wikiWindowManager = new WikiWindowManager();
const tagWikiSearchModal = new TagWikiSearchModal();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        wikiWindowManager.init();
    });
} else {
    wikiWindowManager.init();
}

// Export for global access
if (typeof window !== 'undefined') {
    window.tagWikiSearchModal = tagWikiSearchModal;
// Convenience router for the pseudo-browser surface (used by the layered address bar, Run entries, internal links, etc.)
if (tagWikiSearchModal && typeof tagWikiSearchModal.navigate === 'function') {
    window.grimoireNavigate = window.grimoireNavigate || ((u) => tagWikiSearchModal.navigate(u));
}
    window.wikiWindowManager = wikiWindowManager;
}

