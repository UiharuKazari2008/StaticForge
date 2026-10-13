/**
 * Grimoire / Alchemy as Internet Explorer 7 on Vista (Yozora #448, 1:1 with IE7 on the Vista VM).
 * tagWikiSearchModal.js keeps the browsing logic; this draws IE7's chrome around it:
 *
 *   travel row   the theme's orbs in Explorer's gutter and the Recent Pages ▾ (the active pane's
 *                history, the current page checked); the address box ends ▾ | refresh | stop like
 *                IE7's; then the search box (searches the Grimoire)
 *   tab row      Favorites ☆ (Alchemy bookmarks) and Add to Favorites, one tab with the page's
 *                icon and title (IE's loading ring while a page loads), the new-tab stub (opens
 *                the page in a new window), and on the right the command bar: Home, Page ▾
 *                (New Window, Copy Address, Split View) and Tools ▾ (the site menu)
 *   status bar   Done / Waiting, the zone (Internet for web pages, Dreamscape for the Grimoire's
 *                own) with Protected Mode: On
 *
 * Home, Split view and the site menu are the window's own buttons, moved into the command bar on
 * the Vista desktop and back to the caption toolbar elsewhere. Art from the VM
 * (public/static_images/vista-ie/, scripts/assets/vista-ie-parts/), styles in
 * public/css/vista-explorer.css. The page itself keeps its own look, as in a browser.
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-ie';
    const BOOKS_ICON = '/static_images/app_icons/books.png';

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function button(id, cls, title, html) {
        const b = document.createElement('button');
        b.type = 'button';
        if (id) b.id = id;
        b.className = cls;
        b.title = title;
        b.setAttribute('aria-label', title);
        b.innerHTML = html || '';
        return b;
    }

    class GrimoireIeChrome {
        constructor(host) {
            this.host = host;
            this.modal = host.modal;
            this.toolbar = this.modal.querySelector('.modal-window-title-toolbar');
            this.content = this.modal.querySelector('.modal-content');
            this.captionLabel = this.modal.querySelector('.modal-window-title-main > span');
            this.bookmarks = [];
            this.build();
            this.wire();
            this.place();
            this.sync();
        }

        /** True while the IE chrome shows (desktop, not the classic theme). */
        isOn() {
            const b = document.body;
            return !!b && b.classList.contains('desktop-mode') && !b.classList.contains('windows-classic-theme');
        }

        /** The pane the address bar speaks for (split view has two). */
        shell() {
            const host = this.host;
            return host.activePane && host.activePane !== host ? host.activePane : host;
        }

        // ---- building ----

        build() {
            const host = this.host;
            const back = host.backBtn;
            this.travel = back ? back.parentElement : null;
            if (this.travel) {
                this.travel.classList.add('grimoire-travel');
                this.recent = button('grimoireRecentPagesBtn', 'grimoire-recent-pages-btn', 'Recent Pages');
                this.travel.appendChild(this.recent);
            }

            const bar = host.addressBar;
            this.drop = button('grimoireAddressDropBtn', 'grimoire-ie-seg grimoire-ie-drop', 'Previous Locations');
            this.refresh = button('grimoireIeRefreshBtn', 'grimoire-ie-seg grimoire-ie-refresh', 'Refresh (F5)');
            this.stop = button('grimoireIeStopBtn', 'grimoire-ie-seg grimoire-ie-stop', 'Stop (Esc)');
            this.search = document.createElement('div');
            this.search.className = 'grimoire-ie-search';
            this.search.innerHTML = '<input type="text" id="grimoireIeSearch" placeholder="Grimoire Search" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Grimoire Search">'
                + '<button type="button" class="grimoire-ie-search-go" title="Search" aria-label="Search"></button>';
            if (bar && bar.parentNode) {
                bar.after(this.drop, this.refresh, this.stop, this.search);
            }
            this.searchInput = this.search.querySelector('input');
            this.searchGo = this.search.querySelector('button');

            this.tabRow = document.createElement('div');
            this.tabRow.className = 'grimoire-ie-tabrow';
            this.tabRow.innerHTML = `
                <button type="button" id="grimoireFavoritesBtn" class="grimoire-ie-fav" title="Favorites" aria-label="Favorites"><img src="${ART}/favorites.png" alt=""></button>
                <button type="button" id="grimoireAddFavoriteBtn" class="grimoire-ie-fav" title="Add to Favorites" aria-label="Add to Favorites"><img src="${ART}/favorites-add.png" alt=""></button>
                <div class="grimoire-ie-tabs" role="tablist">
                    <div class="grimoire-ie-tab is-active" role="tab" aria-selected="true"><img class="grimoire-ie-tab-icon" alt=""><span class="grimoire-ie-tab-title"></span></div>
                    <button type="button" class="grimoire-ie-newtab" title="Open in New Window" aria-label="Open in New Window"></button>
                </div>
                <div class="grimoire-ie-commands">
                    <button type="button" id="grimoirePageBtn" class="grimoire-ie-page" title="Page"><img src="${ART}/page.png" alt=""><span class="grimoire-ie-cmd-label">Page</span><span class="grimoire-ie-cmd-drop" aria-hidden="true"></span></button>
                </div>`;
            this.favBtn = this.tabRow.querySelector('#grimoireFavoritesBtn');
            this.addFavBtn = this.tabRow.querySelector('#grimoireAddFavoriteBtn');
            this.tabIcon = this.tabRow.querySelector('.grimoire-ie-tab-icon');
            this.tabTitle = this.tabRow.querySelector('.grimoire-ie-tab-title');
            this.newTab = this.tabRow.querySelector('.grimoire-ie-newtab');
            this.commands = this.tabRow.querySelector('.grimoire-ie-commands');
            this.pageBtn = this.tabRow.querySelector('#grimoirePageBtn');

            this.status = document.createElement('div');
            this.status.className = 'grimoire-ie-status';
            this.status.innerHTML = '<span class="grimoire-ie-status-text">Done</span>'
                + '<span class="grimoire-ie-status-cell"></span>'
                + `<span class="grimoire-ie-status-zone"><img src="${ART}/zone-internet.png" alt=""><span class="grimoire-ie-zone-text"></span></span>`
                + '<span class="grimoire-ie-status-grip" aria-hidden="true"></span>';
            this.statusText = this.status.querySelector('.grimoire-ie-status-text');
            this.zoneText = this.status.querySelector('.grimoire-ie-zone-text');

            if (this.content) {
                this.content.prepend(this.tabRow);
                this.content.append(this.status);
            }
        }

        /** The caption's Home / Split view / site menu move into IE's command bar on the desktop. */
        place() {
            const on = this.isOn();
            if (this._placed === on) return;
            this._placed = on;
            const host = this.host;
            const site = document.getElementById('grimoireAddressSiteBtn');
            const parts = [host.homeBtn, host.rightToggleBtn, site].filter(Boolean);
            if (on) {
                // Home first, then Page ▾ (the split toggle rides along hidden; Page ▾ drives it), Tools ▾
                if (host.homeBtn) this.commands.prepend(host.homeBtn);
                [host.rightToggleBtn, site].filter(Boolean).forEach((el) => this.commands.appendChild(el));
                if (site && !site.querySelector('.grimoire-ie-cmd-label')) {
                    site.dataset.grimoireIeHtml = site.innerHTML;
                    site.innerHTML = `<img src="${ART}/tools.png" alt=""><span class="grimoire-ie-cmd-label">Tools</span><span class="grimoire-ie-cmd-drop" aria-hidden="true"></span>`;
                    site.title = 'Tools';
                }
                if (host.homeBtn && !host.homeBtn.querySelector('img')) {
                    host.homeBtn.dataset.grimoireIeHtml = host.homeBtn.innerHTML;
                    host.homeBtn.innerHTML = `<img src="${ART}/home.png" alt="">`;
                }
                return;
            }
            // back to the caption toolbar in their old order: Home after the orbs, the rest after the address bar
            if (host.homeBtn && this.travel) this.travel.after(host.homeBtn);
            if (host.rightToggleBtn && host.addressBar) host.addressBar.after(host.rightToggleBtn);
            if (site && this.toolbar) this.toolbar.appendChild(site);
            [site, host.homeBtn].forEach((el) => {
                if (el && el.dataset.grimoireIeHtml != null) {
                    el.innerHTML = el.dataset.grimoireIeHtml;
                    delete el.dataset.grimoireIeHtml;
                }
            });
            if (site) site.title = 'Menu';
        }

        // ---- wiring ----

        wire() {
            const host = this.host;
            const cm = root.contextMenu;
            if (cm) {
                const lazy = (btn, build) => {
                    if (!btn) return;
                    const attach = () => this.attachMenu(btn, build());
                    btn.addEventListener('pointerdown', attach, true);
                    btn.addEventListener('focus', attach);
                    attach();
                };
                lazy(this.recent, () => this.recentPagesItems());
                lazy(this.drop, () => this.visitedItems());
                lazy(this.favBtn, () => this.favoriteItems());
                lazy(this.pageBtn, () => this.pageItems());
                // bookmarks load before the menu is built
                ['pointerenter', 'focus'].forEach((type) => this.favBtn.addEventListener(type, () => this.loadBookmarks()));
            }
            this.refresh.addEventListener('click', () => {
                if (host.refreshBtn) host.refreshBtn.click();
            });
            this.stop.addEventListener('click', () => this.stopLoading());
            this.addFavBtn.addEventListener('click', () => this.toggleFavorite());
            this.newTab.addEventListener('click', () => {
                const shell = this.shell();
                if (shell && typeof shell.openInNewWindow === 'function') shell.openInNewWindow();
            });
            const runSearch = () => {
                const q = this.searchInput.value.trim();
                if (!q) return;
                host.navigate('edtx://en.grimoire.jp/search?q=' + encodeURIComponent(q));
            };
            this.searchInput.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    runSearch();
                }
            });
            this.searchGo.addEventListener('click', runSearch);

            // every navigation, load and pane switch shows in the address bar
            const sync = () => this.sync();
            this.observer = new MutationObserver(sync);
            if (host.addressBar) {
                this.observer.observe(host.addressBar, { attributes: true, attributeFilter: ['class', 'data-alchemy-loading'], subtree: false });
            }
            if (host.addressPath) this.observer.observe(host.addressPath, { childList: true, characterData: true, subtree: true });
            [host.backBtn, host.forwardBtn].forEach((b) => b && this.observer.observe(b, { attributes: true, attributeFilter: ['disabled'] }));
            this.bodyObserver = new MutationObserver(() => {
                this.place();
                this.sync();
            });
            this.bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        }

        attachMenu(btn, items) {
            const cm = root.contextMenu;
            cm.detachClickMenuFromElement(btn);
            cm.attachClickMenuToElement(btn, {
                sections: [{ type: 'list', items }],
                onAction: (action, target, item) => this.onMenuAction(action, item)
            });
        }

        onMenuAction(action, item) {
            const shell = this.shell();
            if (action.startsWith('h:')) {
                const index = Number(action.slice(2));
                if (Number.isInteger(index) && shell && typeof shell.goToHistoryIndex === 'function') shell.goToHistoryIndex(index);
                return;
            }
            if (action === 'fav-open' && item && item.bookmarkUrl) {
                this.host.navigate(item.bookmarkUrl);
                return;
            }
            if (action === 'page-new-window' && shell && typeof shell.openInNewWindow === 'function') {
                shell.openInNewWindow();
                return;
            }
            if (action === 'page-copy-address') {
                const url = this.currentAddress();
                if (!url) return;
                if (typeof root.grimoireCopyText === 'function') root.grimoireCopyText(url);
                else if (root.navigator && root.navigator.clipboard) root.navigator.clipboard.writeText(url).catch(() => {});
                return;
            }
            if (action === 'page-split' && this.host.rightToggleBtn) {
                this.host.rightToggleBtn.click();
            }
        }

        // ---- menus ----

        entryLabel(entry, index) {
            const shell = this.shell();
            if (shell && typeof shell.getHistoryEntryDisplayText === 'function') return shell.getHistoryEntryDisplayText(entry, index);
            return (entry && (entry.title || entry.url)) || `Page ${index + 1}`;
        }

        /** Recent Pages: forward pages on top, the current one checked, then back (IE's order). */
        recentPagesItems() {
            const shell = this.shell();
            const history = (shell && shell.history) || [];
            const at = shell ? shell.historyIndex : -1;
            const items = [];
            for (let i = Math.min(history.length - 1, at + 4); i >= Math.max(0, at - 8); i--) {
                const text = this.entryLabel(history[i], i);
                items.push(i === at
                    ? { text, action: `h:${i}`, indicatorStyle: 'dot', checked: true }
                    : { text, action: `h:${i}`, icon: shell.getHistoryEntryMenuIcon ? shell.getHistoryEntryMenuIcon(history[i]) : 'fas fa-file' });
            }
            return items.length ? items : [{ text: 'No pages yet', disabled: true }];
        }

        /** The address box's list: each page once, newest first. */
        visitedItems() {
            const shell = this.shell();
            const history = (shell && shell.history) || [];
            const seen = new Set();
            const items = [];
            for (let i = history.length - 1; i >= 0 && items.length < 12; i--) {
                const text = this.entryLabel(history[i], i);
                if (seen.has(text)) continue;
                seen.add(text);
                items.push({ text, action: `h:${i}`, icon: shell.getHistoryEntryMenuIcon ? shell.getHistoryEntryMenuIcon(history[i]) : 'fas fa-file' });
            }
            return items.length ? items : [{ text: 'No pages yet', disabled: true }];
        }

        currentAddress() {
            const a = this.host.currentAddress;
            return (a && a.fullUrl) || '';
        }

        /** Page ▾: what Grimoire can do with the page on show. */
        pageItems() {
            const toggle = this.host.rightToggleBtn;
            const splitAvailable = !!toggle && toggle.style.display !== 'none';
            const splitOn = !!toggle && toggle.classList.contains('active');
            return [
                { text: 'Open in New Window', icon: 'fas fa-window-restore', action: 'page-new-window' },
                { text: 'Copy Address', icon: 'fas fa-link', action: 'page-copy-address', disabled: !this.currentAddress() },
                { separator: true },
                { text: 'Split View', action: 'page-split', indicatorStyle: 'box', checked: splitOn, disabled: !splitAvailable }
            ];
        }

        favoriteItems() {
            if (!this.bookmarks.length) return [{ text: 'No favorites yet', disabled: true }];
            return this.bookmarks.map((row) => ({ text: row.title || row.url, subtext: this.siteLabel(row.url), icon: 'fas fa-star', action: 'fav-open', bookmarkUrl: row.url }));
        }

        siteLabel(url) {
            return typeof root.grimoireSiteLabel === 'function' ? root.grimoireSiteLabel(url) : '';
        }

        async loadBookmarks() {
            if (typeof root.grimoireLoadAlchemySettings !== 'function') return;
            try {
                const settings = await root.grimoireLoadAlchemySettings();
                this.bookmarks = (settings && settings.bookmarks) || [];
            } catch (_err) { /* the menu shows what it had */ }
        }

        // ---- commands ----

        currentWebUrl() {
            return typeof root.grimoireShellWebUrl === 'function' ? root.grimoireShellWebUrl(this.shell()) : '';
        }

        /** Add to Favorites: the web page on show joins the Alchemy bookmarks (again: leaves them). */
        async toggleFavorite() {
            const url = this.currentWebUrl();
            if (!url || typeof root.grimoireSaveAlchemySettings !== 'function') return;
            await this.loadBookmarks();
            const shell = this.shell();
            const top = shell && shell.history ? shell.history[shell.historyIndex] : null;
            const has = this.bookmarks.some((row) => row.url === url);
            const next = has
                ? this.bookmarks.filter((row) => row.url !== url)
                : [{ url, title: (top && top.title) || url }].concat(this.bookmarks);
            try {
                await root.grimoireSaveAlchemySettings({ bookmarks: next });
                this.bookmarks = next;
                this.sync();
            } catch (_err) {
                if (typeof root.showGlassToast === 'function') root.showGlassToast('error', null, 'Could not save favorites', false, 4000);
            }
        }

        isLoading() {
            const bar = this.host.addressBar;
            return !!bar && (bar.classList.contains('nav-loading') || bar.hasAttribute('data-alchemy-loading'));
        }

        /** Alchemy has no stop command yet: Stop ends the wait (spinner and load fill). */
        stopLoading() {
            if (!this.isLoading()) return;
            if (typeof root.grimoireStopNavigationSpinner === 'function') root.grimoireStopNavigationSpinner(this.host);
            const bar = this.host.addressBar;
            if (bar) bar.removeAttribute('data-alchemy-loading');
        }

        // ---- state ----

        sync() {
            const shell = this.shell();
            if (!shell || !this.tabTitle) return;
            const entry = shell.history ? shell.history[shell.historyIndex] : null;
            const web = !!(entry && entry.type === 'web');
            const title = entry ? this.entryLabel(entry, shell.historyIndex) : 'Grimoire';
            if (this.tabTitle.textContent !== title) this.tabTitle.textContent = title;
            const icon = web ? `${ART}/page-ie.png` : BOOKS_ICON;
            if (this.tabIcon.getAttribute('src') !== icon) this.tabIcon.setAttribute('src', icon);
            this.tabTitle.parentElement.title = title;
            // IE's caption: "<page> - Windows Internet Explorer"; here "<page> - Grimoire"
            if (this.captionLabel) {
                const caption = this.isOn() && entry && entry.type !== 'home' ? `${title} - Grimoire` : 'Grimoire';
                if (this.captionLabel.textContent !== caption) this.captionLabel.textContent = caption;
            }

            const loading = this.isLoading();
            this.tabTitle.parentElement.classList.toggle('is-loading', loading);
            this.stop.disabled = !loading;
            this.statusText.textContent = loading ? 'Waiting for page…' : 'Done';
            this.zoneText.textContent = `${web ? 'Internet' : 'Dreamscape'} | Protected Mode: On`;

            const url = web ? this.currentWebUrl() : '';
            this.addFavBtn.disabled = !url;
            const fav = !!url && this.bookmarks.some((row) => row.url === url);
            this.addFavBtn.title = fav ? 'Remove from Favorites' : 'Add to Favorites';
            this.addFavBtn.classList.toggle('is-favorite', fav);

            const history = shell.history || [];
            const travel = history.length > 1;
            if (this.recent) this.recent.classList.toggle('is-disabled', !travel);
        }
    }

    root.GrimoireIeChrome = GrimoireIeChrome;
    if (typeof module !== 'undefined' && module.exports) module.exports = GrimoireIeChrome;
})(typeof window !== 'undefined' ? window : globalThis);
