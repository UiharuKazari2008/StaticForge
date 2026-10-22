/**
 * Grimoire tabs (Yozora #451). The main Grimoire window holds several tabs; each is a Grimoire page or an
 * Alchemy page with its own history, and a tab can go from one to the other like a single window does.
 *
 * Every tab keeps its own display area (a `.tag-wiki-search-display` scroller in the left pane, and one in
 * the right pane once split view shows it), so an Alchemy iframe stays connected while its tab is in the
 * background and a Grimoire page keeps its scroll position. The page state of tagWikiSearchModal.js
 * (PAGE_KEYS) is swapped in and out of the window on a tab switch, so every Grimoire feature (search page,
 * DSAP applets, split view) works in every tab. Split view itself is the window's (maximize and the saved
 * preference); each tab has its own right pane.
 *
 * A background tab's state is a plain object (`tab.state`) that also serves as its shell for Alchemy
 * messages: grimoireRemoteBrowser.js grimoireBackgroundRemoteMessage updates it (address, title, history,
 * loading, feeds) and leaves anything that needs the page on screen until the tab is shown again.
 * The strip is IE7's, drawn by grimoireIeChrome.js renderTabs.
 */
(function (root) {
    'use strict';

    // tagWikiSearchModal page state that belongs to one tab; everything else belongs to the window
    const PAGE_KEYS = [
        'history', 'historyIndex', 'blank',
        'currentSelectedTag', 'currentTagName', 'currentStaticWiki', 'currentFetchedOnline',
        'currentAddress', '_currentAddress',
        '_searchPageMode', 'currentSearchResults', '_searchResultIndex', 'lastOnlineSectionCount', 'lastOnlineTagOnlyCount',
        '_dsapState', '_dsapActive',
        '_grimoireRemoteSessionId', '_grimoireRemoteViewQuery', '_grimoireRemoteTitle', '_grimoireDialogId',
        '_alchemyScroll', '_alchemyHistoryDir', '_alchemyHistoryAt',
        '_grimoireIeFeeds', '_grimoireIeZoom', '_grimoireIeZoomSent',
        '_recentItemsKey', '_grimoireNavStartedAt', '_grimoireLastFailedNavUrl',
        '_activePane', 'rightPane'
    ];

    let nextTabId = 1;

    function show(el, on) {
        if (!el) return;
        if (on) el.style.removeProperty('display');
        else el.style.display = 'none';
    }

    class GrimoireTabs {
        constructor(host) {
            this.host = host;
            this.listeners = [];
            const area = host.displayArea;
            const wrap = area ? area.closest('.tag-wiki-search-display') : null;
            this.wrapClass = wrap ? wrap.className : 'tag-wiki-search-display form-section-scroll selectable';
            this.areaClass = area ? area.className : 'tag-wiki-display-content';
            const rightArea = typeof host.part === 'function' ? host.part('tagWikiSearchRightDisplay') : document.getElementById('tagWikiSearchRightDisplay');
            const first = this.makeTab(area, wrap);
            first.rightArea = rightArea;
            first.rightWrap = rightArea ? rightArea.closest('.tag-wiki-search-display') : null;
            first.first = true;
            this.tabs = [first];
            this.active = first;
        }

        makeTab(area, wrap) {
            return { id: nextTabId++, area, wrap, rightArea: null, rightWrap: null, state: null, loading: false, lastActive: Date.now(), menuWired: false };
        }

        list() {
            return this.tabs.slice();
        }

        count() {
            return this.tabs.length;
        }

        isActive(tab) {
            return tab === this.active;
        }

        /** Tabs need the strip: IE7's chrome on the Vista desktop (grimoireIeChrome.js). */
        available() {
            const chrome = this.host.ieChrome;
            return !!(chrome && chrome.isOn() && this.host.modal && !this.host.modal.classList.contains('hidden'));
        }

        onChange(fn) {
            this.listeners.push(fn);
        }

        emit() {
            this.listeners.forEach((fn) => {
                try { fn(); } catch (e) { console.warn('Grimoire tabs:', e); }
            });
        }

        // ---- state swap ----

        capture(tab) {
            const host = this.host;
            const state = {};
            PAGE_KEYS.forEach((key) => { state[key] = host[key]; });
            state.displayArea = tab.area;
            state.searchPageView = !!(host.searchBody && host.searchBody.classList.contains('search-page-view'));
            return state;
        }

        restore(tab) {
            const host = this.host;
            const state = tab.state || {};
            PAGE_KEYS.forEach((key) => {
                if (state[key] === undefined) delete host[key];
                else host[key] = state[key];
            });
            host.displayArea = tab.area;
            if (host.searchBody) host.searchBody.classList.toggle('search-page-view', !!state.searchPageView);
        }

        fresh(area) {
            return {
                history: [],
                historyIndex: -1,
                currentSelectedTag: null,
                currentTagName: null,
                currentStaticWiki: null,
                currentFetchedOnline: false,
                currentSearchResults: [],
                _searchPageMode: false,
                _searchResultIndex: -1,
                _activePane: 'left',
                rightPane: null,
                displayArea: area
            };
        }

        /** The right pane's display area for the tab on show (split view makes the pane on demand). */
        activeRightArea() {
            const tab = this.active;
            if (!tab.rightArea) {
                const paneEl = this.host.rightPaneEl;
                if (!paneEl) return null;
                const made = this.newArea();
                paneEl.appendChild(made.wrap);
                tab.rightArea = made.area;
                tab.rightWrap = made.wrap;
                made.wrap.addEventListener('mousedown', () => this.host.setActivePane('right'), true);
                this.reinitScrollbar(made.wrap);
            }
            return tab.rightArea;
        }

        /** Only the window's first tab restores the right pane saved at the last close. */
        restoresSavedRightPane() {
            return !!this.active.first;
        }

        newArea() {
            const wrap = document.createElement('div');
            wrap.className = this.wrapClass;
            const area = document.createElement('div');
            area.className = this.areaClass;
            wrap.appendChild(area);
            return { wrap, area };
        }

        reinitScrollbar(wrap) {
            // customScrollbar: public/scripts/comp/customScrollbar.js
            if (root.customScrollbar && wrap) setTimeout(() => root.customScrollbar.forceReinit(wrap), 50);
        }

        isLoading() {
            const chrome = this.host.ieChrome;
            return !!(chrome && chrome.isLoading());
        }

        activate(tab) {
            if (!tab || tab === this.active || this.tabs.indexOf(tab) < 0) return;
            const host = this.host;
            const old = this.active;

            if (host.exitAddressEdit) host.exitAddressEdit();
            old.loading = this.isLoading();
            // the old tab's spinner and load fill stop with it (grimoireRemoteBrowser.js)
            if (typeof root.grimoireStopNavigationSpinner === 'function') root.grimoireStopNavigationSpinner(host);
            clearTimeout(host._grimoireLoadFillTimer);
            if (host.addressBar) {
                host.addressBar.removeAttribute('data-alchemy-loading');
                host.addressBar.style.setProperty('--alchemy-load', '0%');
            }
            host._wikiLoadHold = 0;

            old.state = this.capture(old);
            old.lastActive = Date.now();
            show(old.wrap, false);
            show(old.rightWrap, false);
            // audio stays with the page that plays it (grimoireRemoteBrowser.js)
            if (typeof root.grimoireRetargetAudio === 'function') root.grimoireRetargetAudio(host, old.state);

            const bag = tab.state;
            this.restore(tab);
            tab.state = null;
            this.active = tab;
            tab.lastActive = Date.now();
            show(tab.wrap, true);
            show(tab.rightWrap, true);
            if (typeof root.grimoireRetargetAudio === 'function') root.grimoireRetargetAudio(bag, host);

            if (host.isSplitMode && host.isSplitMode()) {
                if (!host.rightPane) host.enterSplitMode();
            } else if (host._activePane === 'right') {
                host._activePane = 'left';
            }

            host.syncAddressAndControlsToActive();
            this.resume(tab);
            if (host.ieChrome) {
                host.ieChrome.applyZoom(host);
                if (host.rightPane) host.ieChrome.applyZoom(host.rightPane);
            }
            if (host._notifyGrimoireKeyboardOverlayContextChanged) host._notifyGrimoireKeyboardOverlayContextChanged();
            this.emit();
        }

        /** What waited for the tab: a page that failed, a session given up to the cap or a browser restart, the scrollbar, the spinner. */
        resume(tab) {
            const host = this.host;
            const shells = [host, host.rightPane].filter(Boolean);
            const pending = tab.pending || {};
            tab.pending = null;
            shells.forEach((shell) => {
                const side = shell === host ? 'left' : 'right';
                const top = shell.history && shell.history[shell.historyIndex];
                const status = pending[side];
                if (status && shell._grimoireRemoteSessionId) {
                    root.grimoireShowRemoteTabPage(shell, status.state, status.url);
                    return;
                }
                if (top && top.type === 'web' && top.url && !shell._grimoireRemoteSessionId) {
                    root.grimoireOpenRemoteBrowser(shell, top.url, { host, skipHistory: true });
                    return;
                }
                if (shell._grimoireRemoteSessionId) {
                    if (shell._alchemyScroll) root.grimoireUpdateRemoteScrollbar({ shell }, shell._alchemyScroll);
                    if (shell === host.activePane) root.grimoireSetAudioShell(shell);
                    if (shell === host.activePane && tab.loading) root.grimoireStartNavigationSpinner(host, top && top.url, true);
                }
            });
            tab.loading = false;
        }

        // ---- opening and closing ----

        /**
         * A new tab, shown at once (IE7's default). opts.url / opts.session: an Alchemy page (a session the
         * service already opened streams as is); opts.address: any Grimoire address; neither: the Grimoire home.
         * opts.afterActive puts it next to the tab on show (pages a tab opens), otherwise at the end.
         */
        open(opts) {
            const o = opts || {};
            const host = this.host;
            const made = this.newArea();
            const leftWraps = this.tabs.map((t) => t.wrap).filter(Boolean);
            const anchor = leftWraps[leftWraps.length - 1];
            if (anchor && anchor.parentNode) anchor.after(made.wrap);
            else if (host.searchBody) host.searchBody.appendChild(made.wrap);
            const tab = this.makeTab(made.area, made.wrap);
            tab.state = this.fresh(made.area);
            const at = o.afterActive ? this.tabs.indexOf(this.active) + 1 : this.tabs.length;
            this.tabs.splice(at, 0, tab);
            made.wrap.style.display = 'none';
            made.area.addEventListener('mousedown', () => host.setActivePane('left'), true);
            this.activate(tab);
            host.attachWikiDisplayContextMenu();
            this.reinitScrollbar(made.wrap);

            this.load(o);
            return tab;
        }

        /** What a tab opens with (open's options), into the tab on show. */
        load(o) {
            const host = this.host;
            const webUrl = typeof root.grimoireNormalizeWebUrl === 'function' ? root.grimoireNormalizeWebUrl(o.url || '') : '';
            if (o.session || webUrl) {
                root.grimoireOpenRemoteBrowser(host, webUrl, { host, session: o.session || null });
            } else if (o.tag) {
                host.getTagWikiPageDirectly(o.tag);
            } else if (o.address) {
                host.navigate(o.address);
            } else {
                host.goHome();
            }
        }

        close(tab) {
            const target = tab || this.active;
            if (this.tabs.indexOf(target) < 0) return;
            if (this.tabs.length === 1) {
                this.host.close();
                return;
            }
            if (target === this.active) {
                const at = this.tabs.indexOf(target);
                this.activate(this.tabs[at + 1] || this.tabs[at - 1]);
            }
            this.dispose(target);
            this.tabs.splice(this.tabs.indexOf(target), 1);
            this.emit();
        }

        closeOthers(keep) {
            const tab = keep || this.active;
            if (tab !== this.active) this.activate(tab);
            this.tabs.filter((t) => t !== tab).forEach((t) => this.dispose(t));
            this.tabs = [tab];
            this.emit();
        }

        /** A background tab goes: its Alchemy sessions end, its applet is torn down, its areas leave the page. */
        dispose(tab) {
            const state = tab.state;
            if (!state) return;
            [state, state.rightPane].filter(Boolean).forEach((shell) => {
                if (shell._grimoireRemoteSessionId) root.grimoireCloseRemoteBrowser(shell);
                // deactivateDsapOnShell: public/scripts/comp/dsapRegistry.js
                if (typeof root.deactivateDsapOnShell === 'function') root.deactivateDsapOnShell(shell);
                if (typeof root.grimoireRetargetAudio === 'function') root.grimoireRetargetAudio(shell, null);
            });
            [tab.wrap, tab.rightWrap].filter(Boolean).forEach((wrap) => {
                if (root.customScrollbar) root.customScrollbar.destroy(wrap);
                if (root.contextMenu && wrap.firstElementChild) root.contextMenu.detachFromElement(wrap.firstElementChild);
                wrap.remove();
            });
            tab.state = null;
        }

        /** The window closes: every other tab goes and the one on show ends its Alchemy sessions. */
        resetForWindowClose() {
            const keep = this.active;
            this.tabs.filter((t) => t !== keep).forEach((t) => this.dispose(t));
            this.tabs = [keep];
            keep.first = true;
            const host = this.host;
            [host, host.rightPane].filter(Boolean).forEach((shell) => {
                if (shell._grimoireRemoteSessionId) root.grimoireCloseRemoteBrowser(shell);
            });
            this.emit();
        }

        step(dir) {
            if (this.tabs.length < 2) return;
            const at = this.tabs.indexOf(this.active);
            this.activate(this.tabs[(at + dir + this.tabs.length) % this.tabs.length]);
        }

        // ---- background tabs ----

        /** Shells of tabs not on show (their state objects and right panes), for Alchemy message routing. */
        backgroundShells() {
            const out = [];
            this.tabs.forEach((tab) => {
                if (tab === this.active || !tab.state) return;
                out.push(tab.state);
                if (tab.state.rightPane) out.push(tab.state.rightPane);
            });
            return out;
        }

        backgroundTabOf(shell) {
            if (!shell) return null;
            return this.tabs.find((tab) => tab !== this.active && tab.state && (tab.state === shell || tab.state.rightPane === shell)) || null;
        }

        /** The pane a background tab shows in its strip entry (the one that was active in it). */
        paneOf(tab) {
            if (tab === this.active) return this.host.activePane || this.host;
            const state = tab.state || {};
            return state._activePane === 'right' && state.rightPane ? state.rightPane : state;
        }

        sideOf(tab, shell) {
            return tab.state && tab.state.rightPane === shell ? 'right' : 'left';
        }

        /** Remember a failed page for a background tab; it shows when the tab does. */
        holdStatus(tab, shell, state, url) {
            tab.pending = tab.pending || {};
            tab.pending[this.sideOf(tab, shell)] = { state, url };
            tab.loading = false;
            this.emit();
        }

        /** The Alchemy page's last frame as a JPEG data URL ('' when there is none); the viewer is same-origin. */
        frameSnapshot(shell) {
            const frame = typeof root.grimoireRemoteFrame === 'function' ? root.grimoireRemoteFrame(shell) : null;
            try {
                const canvas = frame && frame.contentDocument && frame.contentDocument.querySelector('canvas');
                return canvas && canvas.width ? canvas.toDataURL('image/jpeg', 0.8) : '';
            } catch (_err) {
                return '';
            }
        }

        /**
         * The service caps Alchemy sessions (MAX_SESSIONS, 429). The background tab used longest ago gives
         * its session up; its page reconnects when the tab is shown. Resolves true when one was freed.
         */
        async freeSession() {
            const candidates = this.tabs
                .filter((tab) => tab !== this.active && tab.state)
                .sort((a, b) => a.lastActive - b.lastActive);
            for (const tab of candidates) {
                const shell = [tab.state, tab.state.rightPane].find((s) => s && s._grimoireRemoteSessionId);
                if (!shell) continue;
                tab.snapshot = this.frameSnapshot(shell);
                await root.grimoireCloseRemoteBrowser(shell);
                this.emit();
                return true;
            }
            return false;
        }
    }

    /**
     * Searches, desktop shortcuts and links from other apps open as a new tab in the Grimoire window used
     * last (#615) instead of a window of their own (Yukimi, 2026-10-22). target: { address } (any Grimoire address or
     * web URL), { url, session } (Alchemy), or { tag } (a wiki page). A closed window opens and its tab takes
     * the page. Without the tab strip (classic theme, no desktop) it returns false and the caller keeps its
     * old way. Explicit "Open in New Window" commands do not come here.
     */
    function grimoireOpenInTab(target) {
        // the window used last (#615; grimoireActiveWindow: public/scripts/comp/tagWikiSearchModal.js)
        const host = typeof root.grimoireActiveWindow === 'function' ? root.grimoireActiveWindow() : root.tagWikiSearchModal;
        const chrome = host && host.ieChrome;
        if (!host || !host.modal || !host.tabs || !chrome || !chrome.isOn()) return false;
        const o = Object.assign({}, target);
        const modal = host.modal;
        if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt')) {
            host.open('', { skipInitialHome: true });
            setTimeout(() => host.tabs.load(o), 50);
            return true;
        }
        // modalUtils.js: a minimised window comes back, an open one comes to the front
        if (modal.classList.contains('minimised') && typeof root.activateTaskbarWindowEntry === 'function') root.activateTaskbarWindowEntry(modal.id);
        else if (typeof root.bringModalToFront === 'function') root.bringModalToFront(modal);
        chrome.toggleQuickTabs(false);
        host.tabs.open(Object.assign(o, { afterActive: false }));
        return true;
    }

    root.grimoireOpenInTab = grimoireOpenInTab;
    root.GrimoireTabs = GrimoireTabs;
    root.GRIMOIRE_TAB_PAGE_KEYS = PAGE_KEYS;
    if (typeof module !== 'undefined' && module.exports) module.exports = GrimoireTabs;
})(typeof window !== 'undefined' ? window : globalThis);
