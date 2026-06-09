// Tag Wiki Search Modal
// Handles searching and displaying tag wiki pages

const DREAMWIKI_RECENT_STORAGE_KEY = 'dreamWikiRecentPages';
const DREAMWIKI_RECENT_MAX = 20;
const GRIMOIRE_RIGHT_PANE_LS = 'grimoireRightPaneState';
const GRIMOIRE_ONLINE_SEARCH_LS = 'grimoireIncludeOnlineSearch';

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
    
    getDisplayText() {
        if (!this.displayArea) return '';
        const pageContent = this.displayArea.querySelector('.tag-wiki-page');
        if (pageContent) {
            return pageContent.innerText || pageContent.textContent || '';
        }
        return this.displayArea.innerText || this.displayArea.textContent || '';
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
                                return !host || typeof host.isSplitMode !== 'function' || !host.isSplitMode()
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
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showGlassToast('success', null, 'Copied to clipboard', false, 3000, '<i class="fas fa-check"></i>');
            }).catch(err => {
                console.error('Failed to copy:', err);
            });
        } else {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showGlassToast('success', null, 'Copied to clipboard', false, 3000, '<i class="fas fa-check"></i>');
            } catch (err) {
                console.error('Failed to copy:', err);
            }
            document.body.removeChild(textarea);
        }
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
                            action: 'wiki-open-new-window'
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
                            disabled: () => manualModal.classList.contains('hidden')
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
                            disabled: () => !this.isDirectiveAvailable()
                        },
                        { separator: true },
                        {
                            text: 'Refresh from Online',
                            icon: 'fas fa-sync-alt',
                            action: 'wiki-refresh-online'
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
                            action: 'wiki-add-to-desktop'
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
        
        // Fetch the wiki page for this tag
        window.wsClient.sendMessage('get_tag_wiki_page', {
            tagName: tagName,
            source: 'both',
            format: 'html'
        }).then(result => {
            if (result) {
                window.wikiWindowManager.createWindow(result, { title: tagName, name: tagName });
            }
        }).catch(error => {
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
        const wrap = this.displayArea && this.displayArea.querySelector('.dreamwiki-static-wiki-sites');
        if (!wrap) return;

        if (!wsClient || !wsClient.isConnected()) {
            wrap.innerHTML = '<span class="dreamwiki-docs-empty">Offline</span>';
            return;
        }

        try {
            const result = await wsClient.sendMessage('get_wiki_home', {});
            const sites = (result && result.sites) ? result.sites : [];
            if (!sites.length) {
                wrap.innerHTML = '<span class="dreamwiki-docs-empty">No docs imported</span>';
                return;
            }
            wrap.innerHTML = sites.map((site) => {
                const name = this.escapeHtml(site.name || site.id);
                const id = this.escapeHtml(site.id);
                const icon = site.icon ? this.escapeHtml(site.icon) : '';
                const iconHtml = icon
                    ? `<img src="${icon}" alt="" class="dreamwiki-site-btn-icon" aria-hidden="true">`
                    : '';
                return `<button type="button" class="btn-secondary btn-small dreamwiki-start-row dreamwiki-site-btn" data-static-wiki-site="${id}">${iconHtml}<span>${name}</span></button>`;
            }).join('');
            wrap.querySelectorAll('[data-static-wiki-site]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const siteId = btn.getAttribute('data-static-wiki-site');
                    if (siteId) {
                        this.showStaticWikiSiteIndex(siteId);
                    }
                });
            });
        } catch (err) {
            console.error('loadStaticWikiHomeSites:', err);
            wrap.innerHTML = '<span class="dreamwiki-docs-empty">Failed to load</span>';
        }
    }

    showDreamWikiHomepage() {
        if (!this.displayArea) return;

        this.currentSelectedTag = null;
        this.currentTagName = null;
        this.currentStaticWiki = null;

        const recents = dreamWikiRecentRead();
        const recentRows = recents.length
            ? recents
                  .map((name) => {
                      const safe = this.escapeHtml(name);
                      const enc = encodeURIComponent(name);
                      return `<div class="tag-wiki-result-item dreamwiki-recent-item" role="button" tabindex="0" data-dreamwiki-recent="${enc}"><span class="tag-wiki-result-name">${safe}</span></div>`;
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
        <div class="dreamwiki-home-actions-block">
            <div class="tag-wiki-no-wiki-header dreamwiki-home-section-label">Tag Groups</div>
            <div class="dreamwiki-starting-points dreamwiki-starting-points-stack">
                <button type="button" class="btn-secondary btn-small dreamwiki-start-row" data-dreamwiki-page="tag groups">Anime</button>
                <button type="button" class="btn-secondary btn-small dreamwiki-start-row" data-dreamwiki-page="tag_group:index">Furry</button>
            </div>
        </div>
        <div class="dreamwiki-home-actions-block">
            <div class="tag-wiki-no-wiki-header dreamwiki-home-section-label">Documentation</div>
            <div class="dreamwiki-starting-points dreamwiki-starting-points-stack dreamwiki-static-wiki-sites">
                <span class="dreamwiki-docs-loading"><i class="fas fa-spinner-third fa-spin"></i></span>
            </div>
        </div>
    </div>
    <div class="dreamwiki-home-pad dreamwiki-home-pad-sm"></div>
    <div class="dreamwiki-home-direct-wrap">
        <div class="tag-wiki-no-wiki-header dreamwiki-home-section-label">Open wiki page</div>
        <input type="text" class="form-control hover-show colored dreamwiki-direct-page-input" placeholder="Exact page name (Enter to open)" autocapitalize="false" autocorrect="false" spellcheck="false">
    </div>
    <div class="dreamwiki-home-pad dreamwiki-home-pad-md"></div>
    <div class="dreamwiki-recent-panel">
        <div class="tag-wiki-no-wiki-header">Recently visited</div>
        <div class="dreamwiki-recent-list dreamwiki-recent-list-cols-3">${recentRows}</div>
    </div>
</div>`;

        this.bindDreamWikiHomepageEvents();
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

        this.loadStaticWikiHomeSites();

        const directInput = this.displayArea.querySelector('.dreamwiki-direct-page-input');
        if (directInput) {
            directInput.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const q = directInput.value.trim();
                if (q) {
                    this.getTagWikiPageDirectly(q);
                }
            });
        }

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
            return;
        }
        this.setupLinkHandlers();
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

            this.addToHistory({
                type: 'static-wiki-index',
                siteId,
                siteName: data.name || siteId,
                icon: data.icon || null
            });
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

    async getTagWikiPage(tag) {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        const wikiLookupName = this.resolveBooruWikiTagName(tag);
        const wikiSource = this.resolveWikiPageSource(tag);
        
        try {
            const result = await window.wsClient.sendMessage('get_tag_wiki_page', {
                tagName: wikiLookupName,
                source: wikiSource,
                format: 'html'
            });
            
            // Store tag name for refresh functionality
            this.currentTagName = wikiLookupName;
            
            return result || {};
        } catch (error) {
            console.error('Get tag wiki page request failed:', error);
            throw error;
        }
    }
    
    renderWikiPage(content) {
        if (!this.displayArea) return;
        
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
        
        // Setup collapsible sections
        this.setupCollapsibleSections();
        
        // Setup link handlers and context menus
        this.setupLinkHandlers();
        
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
                const targetId = toggle.dataset.target;
                // Scope the query to the current display area to avoid conflicts with other windows
                const content = this.displayArea.querySelector(`#${targetId}`) || 
                               (this.modal ? this.modal.querySelector(`#${targetId}`) : null) ||
                               document.getElementById(targetId);
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
    
    setupLinkHandlers() {
        // Add click handlers and context menus for tag wiki links
        const tagLinks = this.displayArea.querySelectorAll('.tag-wiki-link');
        tagLinks.forEach(link => {
            // Click handler
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const tagName = link.dataset.tagName;
                const anchor = link.dataset.anchor;
                if (tagName) {
                    // Check if navigating to the same page
                    const currentTagName = this.getCurrentTagName();
                    if (currentTagName && currentTagName.toLowerCase() === tagName.toLowerCase()) {
                        // Same page - just handle anchor if present
                        if (anchor) {
                            setTimeout(() => {
                                const anchorId = 'dtext-' + anchor.toLowerCase();
                                const targetElement = document.getElementById(anchorId);
                                if (targetElement) {
                                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }
                            }, 100);
                        }
                        return; // Block navigation to same page
                    }
                    
                    // Show loading indicator
                    this.showLinkLoadingIndicator(link);
                    
                    try {
                        const result = await this.getTagWikiPageDirectly(tagName, link);
                        if (result && !result.error) {
                            // Success - remove indicator immediately
                            this.removeLinkLoadingIndicator(link);
                            
                            if (anchor) {
                                setTimeout(() => {
                                    const anchorId = 'dtext-' + anchor.toLowerCase();
                                    const targetElement = document.getElementById(anchorId);
                                    if (targetElement) {
                                        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }
                                }, 100);
                            }
                        }
                        // If error, indicator will be updated in getTagWikiPageDirectly
                    } catch (error) {
                        // Error handling is done in getTagWikiPageDirectly
                    }
                }
            });
            
            // Setup context menu using existing system
            this.setupLinkContextMenu(link);
        });
        
        const staticLinks = this.displayArea.querySelectorAll('.wiki-static-link');
        staticLinks.forEach((link) => {
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
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const href = link.getAttribute('href');
                if (href && href.startsWith('#')) {
                    const anchor = href.substring(1);
                    const targetElement = document.getElementById(anchor);
                    if (targetElement) {
                        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
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
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (window.tagWikiSearchModal) {
                            window.tagWikiSearchModal.open(searchQuery);
                        }
                    });
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
            return;
        }
        
        // Store tag name for refresh functionality
        this.currentTagName = tagName;
        
        // Check for errors before rendering - fetch data first
        try {
            const result = await window.wsClient.sendMessage('get_tag_wiki_page', {
                tagName,
                source: 'both',
                format: 'html'
            });
            
            // Check if there's an error in the result
            if (result && result.error) {
                // Update loading indicator to show error message
                if (clickedLink && clickedLink._loadingIndicator) {
                    this.updateLinkLoadingIndicator(clickedLink, result.error, true);
                    // Remove indicator after 3 seconds (updateLinkLoadingIndicator clears any existing timeout)
                    this.removeLinkLoadingIndicator(clickedLink, 3000);
                } else {
                    // Fallback: show error in display area with back button
                    if (this.displayArea) {
                        const canGoBack = this.history && this.historyIndex > 0;
                        const backButtonHtml = canGoBack 
                            ? `<button class="btn-secondary btn-small wiki-error-back-btn" style="margin-top: var(--spacing-sm);">
                                <i class="fas fa-arrow-left"></i> Back
                            </button>`
                            : '';
                        
                        this.displayArea.innerHTML = `
                            <div class="tag-wiki-error">
                                <i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(result.error)}
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
                return result;
            }
            
            // No error - proceed with normal rendering
            if (result) {
                // Show loading before rendering
                if (this.displayArea) {
                    this.displayArea.innerHTML = '<div class="tag-wiki-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading wiki page...</div>';
                }
                
                this.currentSelectedTag = { title: tagName, name: tagName };
                this.renderWikiPage(result);
                dreamWikiRecentAppend(tagName);

                // Add to history if method exists
                if (this.addToHistory) {
                    this.addToHistory({
                        type: 'wiki',
                        tag: { title: tagName, name: tagName },
                        content: result
                    });
                }
            }
            
            return result;
        } catch (error) {
            console.error('Get tag wiki page request failed:', error);
            
            // Update loading indicator to show error message
            if (clickedLink && clickedLink._loadingIndicator) {
                this.updateLinkLoadingIndicator(clickedLink, `Error: ${error.message}`, true);
                // Remove indicator after 3 seconds (updateLinkLoadingIndicator clears any existing timeout)
                this.removeLinkLoadingIndicator(clickedLink, 3000);
            } else {
                // Fallback: show error in display area with back button
                if (this.displayArea) {
                    const canGoBack = this.history && this.historyIndex > 0;
                    const backButtonHtml = canGoBack 
                        ? `<button class="btn-secondary btn-small wiki-error-back-btn" style="margin-top: var(--spacing-sm);">
                            <i class="fas fa-arrow-left"></i> Back
                        </button>`
                        : '';
                    
                    this.displayArea.innerHTML = `
                        <div class="tag-wiki-error">
                            <i class="fas fa-exclamation-circle"></i> Error: ${this.escapeHtml(error.message)}
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
        
        if (!this.currentTagName) {
            console.error('No tag name available for refresh');
            if (typeof showGlassToast !== 'undefined') {
                showGlassToast('No tag selected', 'error');
            }
            return;
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
    constructor(id, element, initialContent, initialTag, manager, historyToCopy = null) {
        super();
        this.id = id;
        this.modal = element;
        this.manager = manager;
        this.backBtn = null;
        this.forwardBtn = null;
        this.homeBtn = null;
        this.closeBtn = null;
        this.maximizeBtn = null;
        
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
        if (this.initialContent) {
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
    
    openInNewWindow() {
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
        
        this.updateNavigationButtons();
    }
    
    goHome() {
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
                
                // For standalone windows, filter out search entries (only show wiki pages)
                if (isStandalone && entry.type !== 'wiki') {
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
                
                // For standalone windows, filter out search entries (only show wiki pages)
                if (isStandalone && entry.type !== 'wiki') {
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
            } else if (result && !result.error) {
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
        if (this.modal && window.closeModal) {
            window.closeModal(this.modal);
        }
        // Remove from manager after animation
        if (this.manager) {
            setTimeout(() => {
                this.manager.removeWindow(this.id);
            }, 300);
        }
    }
    
    destroy() {
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
        this.filterDropdown = document.getElementById('tagWikiSearchFilterDropdown');
        this.filterDropdownBtn = document.getElementById('tagWikiSearchFilterDropdownBtn');
        this.filterDropdownMenu = document.getElementById('tagWikiSearchFilterDropdownMenu');
        this.filterIcon = document.getElementById('tagWikiSearchFilterIcon');
        this.searchTypeDropdown = document.getElementById('tagWikiSearchTypeDropdown');
        this.searchTypeDropdownBtn = document.getElementById('tagWikiSearchTypeDropdownBtn');
        this.searchTypeDropdownMenu = document.getElementById('tagWikiSearchTypeDropdownMenu');
        this.searchTypeIcon = document.getElementById('tagWikiSearchTypeIcon');
        this.sourceDropdown = document.getElementById('tagWikiSearchSourceDropdown');
        this.sourceDropdownBtn = document.getElementById('tagWikiSearchSourceDropdownBtn');
        this.sourceDropdownMenu = document.getElementById('tagWikiSearchSourceDropdownMenu');
        this.sourceIcon = document.getElementById('tagWikiSearchSourceIcon');
        this.resultsList = document.getElementById('tagWikiSearchResultsList');
        this.displayArea = document.getElementById('tagWikiSearchDisplay');
        this.backBtn = document.getElementById('tagWikiSearchBackBtn');
        this.forwardBtn = document.getElementById('tagWikiSearchForwardBtn');
        this.homeBtn = document.getElementById('tagWikiSearchHomeBtn');
        this.closeBtn = document.getElementById('closeTagWikiSearchModalBtn');
        this.searchBody = this.modal.querySelector('.tag-wiki-search-body');
        this.resultsScrollPanel = this.modal.querySelector('.tag-wiki-search-results.form-section-scroll');
        this.resultsCollapseBtn = document.getElementById('tagWikiSearchResultsCollapseBtn');
        this.resultsSidebarToggleBtn = document.getElementById('tagWikiSearchResultsSidebarToggleBtn');
        this.splitSwapBtn = document.getElementById('tagWikiSearchSplitSwapBtn');
        this.splitDividerEl = document.getElementById('tagWikiSearchSplitDivider');
        this.rightPaneEl = document.getElementById('tagWikiSearchRightPane');
        this.resultsOverlayBackdrop = document.getElementById('tagWikiSearchResultsOverlayBackdrop');
        this.onlineToggleBtn = document.getElementById('tagWikiSearchOnlineToggleBtn');
        this.refreshBtn = document.getElementById('tagWikiSearchRefreshBtn');
        this.searchControlElements = [
            document.getElementById('tagWikiSearchOnlineToggleBtn'),
            document.getElementById('tagWikiSearchSourceDropdown'),
            document.getElementById('tagWikiSearchFilterDropdown'),
            document.getElementById('tagWikiSearchTypeDropdown')
        ].filter(Boolean);
        
        this.setupOnlineToggle();
        this.setupClickMenus();
        this.setupResultsSidebar();
        this.setupEventListeners();
        this.setupSplitModeListeners();
        this.setupContextMenu();
        this.updateSearchControlsVisibility();
    }

    setupOnlineToggle() {
        if (!this.onlineToggleBtn) return;
        this.onlineToggleBtn.dataset.state = this.includeOnline ? 'on' : 'off';
        this.onlineToggleBtn.title = this.includeOnline
            ? 'Online search enabled (Danbooru & e621)'
            : 'Search online (Danbooru & e621)';
        this.onlineToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.includeOnline = !this.includeOnline;
            this.onlineToggleBtn.dataset.state = this.includeOnline ? 'on' : 'off';
            try {
                localStorage.setItem(GRIMOIRE_ONLINE_SEARCH_LS, this.includeOnline ? 'true' : 'false');
            } catch (err) {
                /* */
            }
            this.updateOnlineToggleState();
            if (this.searchInput && this.searchInput.value.trim()) {
                this.performSearch();
            }
        });
        this.updateOnlineToggleState();
    }

    updateOnlineToggleState() {
        if (!this.onlineToggleBtn) return;
        const nameSearch = (this.currentSearchType || 'name') === 'name';
        this.onlineToggleBtn.disabled = !nameSearch;
        this.onlineToggleBtn.title = !nameSearch
            ? 'Online search is only available for name searches'
            : (this.includeOnline
                ? 'Online search enabled (Danbooru & e621)'
                : 'Search online (Danbooru & e621)');
    }

    setupSplitModeListeners() {
        if (!this.modal) return;
        this.modal.addEventListener('modalMaximized', () => this.enterSplitMode());
        this.modal.addEventListener('modalRestored', () => this.exitSplitMode());
        if (this.splitSwapBtn) {
            this.splitSwapBtn.addEventListener('click', () => this.swapSplitPanes());
        }
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
        return !!(this.modal && this.modal.classList.contains('modal-maximized'));
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
    }

    async openLinkOnPane(tagName, side) {
        const t = String(tagName || '').trim();
        if (!t) return;
        if (side === 'right') {
            if (!this.isSplitMode()) return;
            if (!this.rightPane) this.enterSplitMode();
            await this.rightPane.openTagByName(t);
            return;
        }
        await this.getTagWikiPageDirectly(t);
    }
    
    setupContextMenu() {
        this.attachWikiDisplayContextMenu();
    }
    
    
    setupClickMenus() {
        // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
        if (!contextMenu) return;

        this.filterClickMenuConfig = this.buildGrimoireFilterClickMenuConfig();
        this.searchTypeClickMenuConfig = this.buildGrimoireSearchTypeClickMenuConfig();
        this.sourceClickMenuConfig = this.buildGrimoireSourceClickMenuConfig();

        if (this.filterDropdownBtn) {
            contextMenu.attachClickMenuToElement(this.filterDropdownBtn, this.filterClickMenuConfig);
        }
        if (this.searchTypeDropdownBtn) {
            contextMenu.attachClickMenuToElement(this.searchTypeDropdownBtn, this.searchTypeClickMenuConfig);
        }
        if (this.sourceDropdownBtn) {
            contextMenu.attachClickMenuToElement(this.sourceDropdownBtn, this.sourceClickMenuConfig);
        }
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

    setupResultsSidebar() {
        if (!this.searchBody || !this.modal) return;

        if (this.resultsCollapseBtn) {
            this.resultsCollapseBtn.addEventListener('click', () => {
                this.resultsSidebarManualCollapsed = true;
                if (this.needsResultsOverlay()) {
                    this.setResultsOverlayOpen(false);
                } else {
                    this.updateResultsSidebar();
                }
            });
        }

        if (this.resultsSidebarToggleBtn) {
            this.resultsSidebarToggleBtn.addEventListener('click', () => {
                this.toggleResultsSidebar();
            });
        }

        if (this.resultsOverlayBackdrop) {
            this.resultsOverlayBackdrop.addEventListener('click', () => {
                this.setResultsOverlayOpen(false);
            });
        }

        this._boundResultsSidebarResize = () => this.updateResultsSidebar();
        this.modal.addEventListener('modalResized', this._boundResultsSidebarResize);
        this.updateResultsSidebar();
    }

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
        if (!this.modal) return;
        
        // Search input - Enter key to search
        if (this.searchInput) {
            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
                    e.preventDefault();
                    this.performSearch();
                }
            });
        }
        
        // Navigation buttons
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
        
    }

    open(initialQuery = '', options = {}) {
        if (!this.modal) return;
        const wasClosed = this.modal.classList.contains('hidden');
        const trimmedQuery = String(initialQuery || '').trim();
        const skipInitialHome = options && options.skipInitialHome;
        openModal(this.modal);
        if (this.isSplitMode()) {
            this.enterSplitMode();
        }
        
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
     */
    async openStandaloneWikiIfDirectMatch(tagName) {
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

        try {
            const result = await window.wsClient.sendMessage('get_tag_wiki_page', {
                tagName: trimmed,
                source: 'both',
                format: 'html'
            });

            if (!result || result.error) {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('info', null, 'No matching wiki page', false, 3500, '<i class="fas fa-book"></i>');
                }
                return false;
            }

            if (typeof hideCharacterAutocomplete === 'function') {
                hideCharacterAutocomplete();
            }

            const initialTag = { title: trimmed, name: trimmed };
            const winInstance = window.wikiWindowManager.createWindow(result, initialTag, null);
            if (winInstance && winInstance.modal && typeof bringModalToFront === 'function') {
                bringModalToFront(winInstance.modal);
            }
            return true;
        } catch (err) {
            console.error('openStandaloneWikiIfDirectMatch:', err);
            if (typeof showGlassToast === 'function') {
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
        if (this.currentTagName) {
            await this.refreshFromOnline();
            return;
        }
        const query = this.searchInput?.value.trim();
        if (query) {
            await this.performSearch();
            return;
        }
        const entry = this.history[this.historyIndex];
        if (entry && entry.type === 'home') {
            this.showDreamWikiHomepage();
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
        
        // Show loading state
        if (this.resultsList) {
            const loadingHint = includeOnline
                ? '<i class="fas fa-spinner-third fa-spin"></i> Searching local &amp; online...'
                : '<i class="fas fa-spinner-third fa-spin"></i> Searching...';
            this.resultsList.innerHTML = `<div class="tag-wiki-loading">${loadingHint}</div>`;
        }
        this.updateResultsSidebar(true);
        this.updateSearchControlsVisibility();
        
        try {
            const results = await this.searchTagWiki(query, {
                category: filter === '' ? undefined : (filter === 'non-tag' ? null : parseInt(filter, 10)),
                searchType: searchType,
                source: source,
                includeNonTag: filter === 'non-tag',
                includeOnline: includeOnline
            });
            
            this.currentSearchResults = results || [];
            this.renderResults(this.currentSearchResults);
            
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
            if (this.resultsList) {
                this.resultsList.innerHTML = `<div class="tag-wiki-error"><i class="fas fa-exclamation-circle"></i> Error: ${error.message}</div>`;
            }
            this.updateResultsSidebar(true);
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

    updateSearchControlsVisibility() {
        const show = this.shouldShowSearchControls();
        this.searchControlElements.forEach((el) => {
            el.classList.toggle('hidden', !show);
        });
    }

    updateResultsPanelTitle() {
        const titleEl = this.modal && this.modal.querySelector('.tag-wiki-results-panel-title');
        if (!titleEl) return;
        if (this.includeOnline && this.currentSearchType === 'name') {
            let onlineNote = '';
            if (this.lastOnlineSectionCount != null) {
                onlineNote += ` · ${this.lastOnlineSectionCount} online wiki`;
            }
            if (this.lastOnlineTagOnlyCount > 0) {
                onlineNote += ` · ${this.lastOnlineTagOnlyCount} online tags`;
            }
            titleEl.textContent = `Results (local + cloud${onlineNote})`;
        } else {
            titleEl.textContent = 'Results';
        }
    }

    renderResults(results) {
        if (!this.resultsList) return;
        
        if (!results || results.length === 0) {
            this.resultsList.innerHTML = '<div class="tag-wiki-empty-results"><i class="fas fa-search"></i> No results found</div>';
            this.updateResultsPanelTitle();
            this.updateResultsSidebar(true);
            this.updateSearchControlsVisibility();
            return;
        }
        
        const mergedItems = [];
        const localOnlyItems = [];
        const onlineWikiItems = [];
        const onlineTagItems = [];
        const itemsWithoutWiki = [];
        
        results.forEach((result, index) => {
            if (!result.hasWiki) {
                if (result.matchType === 'online-tag' || (result.onlineOnly && result.matchType !== 'online')) {
                    onlineTagItems.push({ result, index });
                } else {
                    itemsWithoutWiki.push({ result, index });
                }
            } else if (result.matchType === 'online' || (result.onlineOnly && result.hasWiki)) {
                onlineWikiItems.push({ result, index });
            } else if (result.matchType === 'merged') {
                mergedItems.push({ result, index });
            } else {
                localOnlyItems.push({ result, index });
            }
        });
        
        let html = '';
        
        if (mergedItems.length > 0) {
            html += mergedItems.map(({ result, index }) =>
                this.renderResultItem(result, index, 'tag-wiki-result-item-merged')
            ).join('');
        }

        if (onlineWikiItems.length > 0) {
            html += '<div class="tag-wiki-online-section">';
            html += `<div class="tag-wiki-online-header">Online Wiki Pages (${onlineWikiItems.length})</div>`;
            html += onlineWikiItems.map(({ result, index }) =>
                this.renderResultItem(result, index, 'tag-wiki-result-item-online')
            ).join('');
            html += '</div>';
        }

        if (onlineTagItems.length > 0) {
            html += '<div class="tag-wiki-online-section tag-wiki-online-tags-section">';
            html += `<div class="tag-wiki-online-header">Online Tags (no wiki page)</div>`;
            html += onlineTagItems.map(({ result, index }) => {
                const category = result.categoryName || 'Uncategorized';
                const tagName = result.title || result.name || 'Unknown';
                return `
                    <div class="tag-wiki-result-item tag-wiki-result-item-no-wiki tag-wiki-result-item-online-tag" data-index="${index}" data-tag-id="${result.id || ''}" data-tag-name="${tagName}">
                        <div class="tag-wiki-result-name">${this.escapeHtml(tagName)}</div>
                        <div class="tag-wiki-result-source">${this.getSourceIcon(result.source)}</div>
                        <div class="tag-wiki-result-category">${this.escapeHtml(category)}</div>
                    </div>
                `;
            }).join('');
            html += '</div>';
        } else if (this.includeOnline && this.currentSearchType === 'name' && onlineWikiItems.length === 0) {
            html += '<div class="tag-wiki-online-section">';
            html += '<div class="tag-wiki-online-header tag-wiki-online-header-empty">No additional online wiki pages</div>';
            html += '</div>';
        }

        if (localOnlyItems.length > 0) {
            html += localOnlyItems.map(({ result, index }) =>
                this.renderResultItem(result, index, '')
            ).join('');
        }
        
        if (itemsWithoutWiki.length > 0) {
            html += '<div class="tag-wiki-no-wiki-section">';
            html += '<div class="tag-wiki-no-wiki-header">Other Results (No Wiki Pages)</div>';
            html += itemsWithoutWiki.map(({ result, index }) => {
                const category = result.categoryName || 'Uncategorized';
                const tagName = result.title || result.name || 'Unknown';
                
                return `
                    <div class="tag-wiki-result-item tag-wiki-result-item-no-wiki" data-index="${index}" data-tag-id="${result.id || ''}" data-tag-name="${this.escapeHtml(tagName)}">
                        <div class="tag-wiki-result-name">${this.escapeHtml(tagName)}</div>
                        <div class="tag-wiki-result-source"><i class="fas fa-question-circle" title="No Wiki"></i></div>
                        <div class="tag-wiki-result-category">${this.escapeHtml(category)}</div>
                    </div>
                `;
            }).join('');
            html += '</div>';
        }
        
        this.resultsList.innerHTML = html;
        
        const clickableItems = this.resultsList.querySelectorAll('.tag-wiki-result-item:not(.tag-wiki-result-item-no-wiki)');
        clickableItems.forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index, 10);
                const tag = results[index];
                if (tag && tag.hasWiki) {
                    this.selectTag(tag);
                }
            });
        });
        
        const itemsWithWiki = [...mergedItems, ...localOnlyItems, ...onlineWikiItems];
        this.checkAndOpenDirectMatch(results, itemsWithWiki);
        this.updateResultsPanelTitle();
        this.updateResultsSidebar(true);
        this.updateSearchControlsVisibility();
    }
    
    checkAndOpenDirectMatch(allResults, itemsWithWiki) {
        if (!this.searchInput) return;
        
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
            if (wikiContent && wikiContent.error) {
                const canGoBack = this.history && this.historyIndex > 0;
                const backButtonHtml = canGoBack 
                    ? `<button class="btn-secondary btn-small wiki-error-back-btn" style="margin-top: var(--spacing-sm);">
                        <i class="fas fa-arrow-left"></i> Back
                    </button>`
                    : '';
                
                if (this.displayArea) {
                    this.displayArea.innerHTML = `
                        <div class="tag-wiki-error">
                            <i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(wikiContent.error)}
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
            
            // Add to history only if no error
            if (!wikiContent || !wikiContent.error) {
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
        if (this.resultsList) {
            this.resultsList.innerHTML = '';
        }
        this.currentSearchResults = [];
        this.updateResultsSidebar();
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
        this.updateNavigationButtons();
        this.updateSearchControlsVisibility();
    }
    
    restoreHistoryEntry(entry) {
        if (!entry) return;

        if (entry.type === 'home') {
            this.currentSelectedTag = null;
            this.currentTagName = null;
            this.showDreamWikiHomepage();
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
            if (entry.results) {
                this.currentSearchResults = entry.results;
                this.renderResults(entry.results);
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
                
                // For standalone windows, filter out search entries (only show wiki pages)
                if (isStandalone && entry.type !== 'wiki') {
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
                
                // For standalone windows, filter out search entries (only show wiki pages)
                if (isStandalone && entry.type !== 'wiki') {
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
    window.wikiWindowManager = wikiWindowManager;
}

