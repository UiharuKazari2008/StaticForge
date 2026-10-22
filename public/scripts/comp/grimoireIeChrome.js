/**
 * Grimoire / Alchemy as Internet Explorer 7 on Vista (Yozora #448, 1:1 with IE7 on the Vista VM).
 * tagWikiSearchModal.js keeps the browsing logic; this draws IE7's chrome around it:
 *
 *   travel row   the theme's orbs in Explorer's gutter and the Recent Pages ▾ (the active pane's
 *                history, the current page checked); the address box ends ▾ | refresh | stop like
 *                IE7's; then the search box
 *                and the search box (searches the Grimoire or, from its ▾, Danbooru, e621 or the web)
 *   tab row      Favorites ☆ (Alchemy bookmarks) and Add to Favorites, one tab with the page's
 *                icon and title (IE's loading ring while a page loads), the new-tab stub (opens
 *                the page in a new window), and on the right the command bar: Home ▾ (the home
 *                page: Add or Change / Remove), Feeds ▾ (the feeds a web page advertises), Print ▾
 *                (Print / Print Preview), Page ▾ (New Window, Copy Address, Split View) and
 *                Tools ▾ (the site menu)
 *   status bar   Done / Waiting, the zone (Alchemy's web pages: Internet | Protected Mode: On; the
 *                Grimoire's own pages: Local intranet | Protected Mode: Off, as IE7 shows them),
 *                and the zoom (click: 100 / 125 / 150 %, ▾: levels)
 *
 * The home page and the search provider are user settings (userGlobalSettings.alchemy.homePage /
 * searchProvider, modules/grimoireBrowserBridge.js). Zoom is per pane: CSS zoom on Grimoire pages,
 * Chrome's own zoom in Alchemy (services/grimoire-browser `zoom`). Print copies a Grimoire page into
 * #grimoireIePrintHost; a web page comes back from Alchemy as one full-page picture (`print`).
 *
 * Home, Split view and the site menu are the window's own buttons, moved into the command bar on
 * the Vista desktop and back to the caption toolbar elsewhere. Art from the VM
 * (public/static_images/vista-ie/, scripts/assets/vista-ie-parts/), styles in
 * public/css/vista-explorer.css. The page itself keeps its own look, as in a browser.
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-ie';
    const BOOKS_ICON = '/static_images/app_icons/books.webp'; // the Grimoire's own icon is its pages' favicon (Yukimi)
    const NAI_FAVICON = '/static_images/novelai-favicon.png';

    function pageFavicon(entry) {
        if (entry && entry.type === 'web') return `${ART}/page-ie.png`;
        const site = entry && (entry.siteId || (entry.content && entry.content.siteId));
        const url = entry ? (entry.displayUrl || entry.url || (entry.content && entry.content.displayUrl) || '') : '';
        if (site === 'novelai' || /docs\.novelai\.jp/i.test(String(url))) return NAI_FAVICON;
        return BOOKS_ICON;
    }

    // Search ▾ (ids match ALCHEMY_SEARCH_PROVIDERS in modules/grimoireBrowserBridge.js)
    const SEARCH_PROVIDERS = [
        { id: 'grimoire', label: 'Grimoire Search', url: (q) => 'edtx://en.grimoire.jp/search?q=' + encodeURIComponent(q) },
        { id: 'danbooru', label: 'Danbooru Wiki', url: (q) => wikiUrl(q, 'danbooru') },
        { id: 'e621', label: 'e621 Wiki', url: (q) => wikiUrl(q, 'e621') },
        { id: 'web', label: 'Web Search', url: (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q) }
    ];

    // IE7's zoom levels (the status bar's ▾); clicking the cell steps 100 -> 125 -> 150 -> 100
    const ZOOM_LEVELS = [400, 200, 150, 125, 100, 75, 50];
    const ZOOM_STEPS = [10, 25, 50, 75, 100, 110, 125, 150, 175, 200, 250, 300, 400];
    const ZOOM_CYCLE = [100, 125, 150];

    function wikiUrl(q, site) {
        // grimoireOnlineWikiUrls: public/scripts/comp/grimoireRemoteBrowser.js
        const urls = typeof root.grimoireOnlineWikiUrls === 'function' ? root.grimoireOnlineWikiUrls(q) : {};
        return urls[site] || '';
    }

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
                + '<button type="button" class="grimoire-ie-search-go" title="Search" aria-label="Search"></button>'
                + '<button type="button" class="grimoire-ie-search-drop" title="Search Options" aria-label="Search Options"></button>';
            if (bar && bar.parentNode) {
                bar.after(this.drop, this.refresh, this.stop, this.search);
            }
            this.searchInput = this.search.querySelector('input');
            this.searchGo = this.search.querySelector('.grimoire-ie-search-go');
            this.searchDrop = this.search.querySelector('.grimoire-ie-search-drop');

            this.tabRow = document.createElement('div');
            this.tabRow.className = 'grimoire-ie-tabrow';
            this.tabRow.innerHTML = `
                <button type="button" id="grimoireFavoritesBtn" class="grimoire-ie-fav" title="Favorites" aria-label="Favorites"><img src="${ART}/favorites.png" alt=""></button>
                <button type="button" id="grimoireAddFavoriteBtn" class="grimoire-ie-fav" title="Add to Favorites" aria-label="Add to Favorites"><img src="${ART}/favorites-add.png" alt=""></button>
                <div class="grimoire-ie-tabs">
                    <span class="grimoire-ie-tabtools" hidden><button type="button" class="grimoire-ie-quicktabs" title="Quick Tabs (Ctrl+Q)" aria-label="Quick Tabs"><img src="${ART}/quick-tabs.png" alt=""></button><button type="button" class="grimoire-ie-tablist" title="Tab List" aria-label="Tab List"><span class="grimoire-ie-cmd-drop" aria-hidden="true"></span></button></span>
                    <div class="grimoire-ie-tabstrip" role="tablist"><button type="button" class="grimoire-ie-newtab" title="New Tab (Ctrl+T)" aria-label="New Tab (Ctrl+T)"></button></div>
                </div>
                <div class="grimoire-ie-commands">
                    <span class="grimoire-ie-split grimoire-ie-split-home"><button type="button" id="grimoireHomeDropBtn" class="grimoire-ie-split-drop" title="Home Page Options" aria-label="Home Page Options"><span class="grimoire-ie-cmd-drop" aria-hidden="true"></span></button></span>
                    <span class="grimoire-ie-split"><button type="button" id="grimoireFeedsBtn" class="grimoire-ie-split-main" title="No Feeds Detected on this page" aria-label="Feeds" disabled><img src="${ART}/feeds.png" alt=""></button><button type="button" id="grimoireFeedsDropBtn" class="grimoire-ie-split-drop" title="Feeds" aria-label="Feeds" disabled><span class="grimoire-ie-cmd-drop" aria-hidden="true"></span></button></span>
                    <span class="grimoire-ie-split"><button type="button" id="grimoirePrintBtn" class="grimoire-ie-split-main" title="Print" aria-label="Print"><img src="${ART}/print.png" alt=""></button><button type="button" id="grimoirePrintDropBtn" class="grimoire-ie-split-drop" title="Print Options" aria-label="Print Options"><span class="grimoire-ie-cmd-drop" aria-hidden="true"></span></button></span>
                    <button type="button" id="grimoirePageBtn" class="grimoire-ie-page" title="Page"><img src="${ART}/page.png" alt=""><span class="grimoire-ie-cmd-label">Page</span><span class="grimoire-ie-cmd-drop" aria-hidden="true"></span></button>
                </div>`;
            this.favBtn = this.tabRow.querySelector('#grimoireFavoritesBtn');
            this.addFavBtn = this.tabRow.querySelector('#grimoireAddFavoriteBtn');
            this.tabStrip = this.tabRow.querySelector('.grimoire-ie-tabstrip');
            this.tabTools = this.tabRow.querySelector('.grimoire-ie-tabtools');
            this.quickTabsBtn = this.tabRow.querySelector('.grimoire-ie-quicktabs');
            this.tabListBtn = this.tabRow.querySelector('.grimoire-ie-tablist');
            this.tabEls = new Map(); // tab id -> its strip element (renderTabs)
            this.renderTabs();
            this.newTab = this.tabRow.querySelector('.grimoire-ie-newtab');
            this.commands = this.tabRow.querySelector('.grimoire-ie-commands');
            this.pageBtn = this.tabRow.querySelector('#grimoirePageBtn');
            this.homeSplit = this.tabRow.querySelector('.grimoire-ie-split-home');
            this.homeDrop = this.tabRow.querySelector('#grimoireHomeDropBtn');
            this.feedsBtn = this.tabRow.querySelector('#grimoireFeedsBtn');
            this.feedsDrop = this.tabRow.querySelector('#grimoireFeedsDropBtn');
            this.printBtn = this.tabRow.querySelector('#grimoirePrintBtn');
            this.printDrop = this.tabRow.querySelector('#grimoirePrintDropBtn');

            this.status = document.createElement('div');
            this.status.className = 'grimoire-ie-status';
            this.status.innerHTML = '<span class="grimoire-ie-status-text">Done</span>'
                + '<span class="grimoire-ie-status-cell"></span>'
                + `<span class="grimoire-ie-status-zone"><img src="${ART}/zone-internet.png" alt=""><span class="grimoire-ie-zone-text"></span></span>`
                + `<span class="grimoire-ie-status-zoom"><button type="button" class="grimoire-ie-zoom-btn" title="Change Zoom Level"><img src="${ART}/zoom.png" alt=""><span class="grimoire-ie-zoom-text">100%</span></button>`
                + '<button type="button" class="grimoire-ie-zoom-drop" title="Change Zoom Level" aria-label="Zoom Levels"><span class="grimoire-ie-cmd-drop" aria-hidden="true"></span></button></span>'
                + '<span class="grimoire-ie-status-grip" aria-hidden="true"></span>';
            this.statusText = this.status.querySelector('.grimoire-ie-status-text');
            this.zoneText = this.status.querySelector('.grimoire-ie-zone-text');
            this.zoneIcon = this.status.querySelector('.grimoire-ie-status-zone img');
            this.zoomBtn = this.status.querySelector('.grimoire-ie-zoom-btn');
            this.zoomDrop = this.status.querySelector('.grimoire-ie-zoom-drop');
            this.zoomText = this.status.querySelector('.grimoire-ie-zoom-text');

            if (this.content) {
                this.content.prepend(this.tabRow);
                this.content.append(this.status);
            }

            // a later Grimoire window (#615): its ids end in the window's suffix, the name stays in data-grimoire-part
            const suffix = this.host.idSuffix || '';
            [this.recent, this.drop, this.refresh, this.stop, this.search, this.tabRow, this.status].filter(Boolean).forEach((root) => {
                [root, ...root.querySelectorAll('[id]')].forEach((el) => {
                    if (!el.id || el.dataset.grimoirePart) return;
                    el.dataset.grimoirePart = el.id;
                    el.id += suffix;
                });
            });
        }

        /** A later window closing (tagWikiSearchModal.js destroyWindow): its listeners go with it. */
        destroy() {
            root.removeEventListener('message', this.onFrameMessage);
            if (this.observer) this.observer.disconnect();
            if (this.bodyObserver) this.bodyObserver.disconnect();
            this.toggleQuickTabs(false);
        }

        /** The caption's Home / Split view / site menu move into IE's command bar on the desktop. */
        place() {
            const on = this.isOn();
            if (this._placed === on) return;
            this._placed = on;
            const host = this.host;
            const site = typeof host.part === 'function' ? host.part('grimoireAddressSiteBtn') : document.getElementById('grimoireAddressSiteBtn');
            const parts = [host.homeBtn, host.rightToggleBtn, site].filter(Boolean);
            if (on) {
                // Home first, then Page ▾ (the split toggle rides along hidden; Page ▾ drives it), Tools ▾
                if (host.homeBtn) this.homeSplit.prepend(host.homeBtn);
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
                if (host.homeBtn) host.homeBtn.classList.add('grimoire-ie-split-main');
                this.applyZoom(this.shell());
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
            if (host.homeBtn) host.homeBtn.classList.remove('grimoire-ie-split-main');
            this.applyZoom(this.shell());
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
                lazy(this.homeDrop, () => this.homeItems());
                lazy(this.feedsDrop, () => this.feedItems());
                lazy(this.printDrop, () => this.printItems());
                lazy(this.searchDrop, () => this.searchItems());
                lazy(this.zoomDrop, () => this.zoomItems());
                // bookmarks load before the menu is built
                ['pointerenter', 'focus'].forEach((type) => this.favBtn.addEventListener(type, () => this.loadBookmarks()));
            }
            this.refresh.addEventListener('click', () => {
                if (host.refreshBtn) host.refreshBtn.click();
            });
            this.stop.addEventListener('click', () => this.stopLoading());
            this.addFavBtn.addEventListener('click', () => this.toggleFavorite());
            this.wireTabs();
            const runSearch = () => {
                const q = this.searchInput.value.trim();
                if (!q) return;
                const url = this.provider().url(q);
                if (url) host.navigate(url);
            };
            this.searchInput.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    runSearch();
                }
            });
            this.searchGo.addEventListener('click', runSearch);

            // Home goes to the chosen home page (the Grimoire home when none is set); the capture
            // listener runs before tagWikiSearchModal.js's own click handler
            if (host.homeBtn) {
                host.homeBtn.addEventListener('click', (ev) => {
                    if (!this.homePage) return;
                    ev.stopImmediatePropagation();
                    host.navigate(this.homePage);
                }, true);
            }
            this.feedsBtn.addEventListener('click', () => {
                const feeds = this.feedsOf(this.shell());
                if (feeds.length) host.navigate(feeds[0].href);
            });
            this.printBtn.addEventListener('click', () => this.print());
            this.zoomBtn.addEventListener('click', () => {
                const at = ZOOM_CYCLE.indexOf(this.zoomOf(this.shell()));
                this.setZoom(ZOOM_CYCLE[(at + 1) % ZOOM_CYCLE.length]);
            });
            this.loadSettings();

            // Alchemy: a page's feeds, a page to print, and a new viewer that needs the pane's zoom
            this.onFrameMessage = (ev) => this.frameMessage(ev);
            root.addEventListener('message', this.onFrameMessage);

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
            if (action === 'home-go' && item) {
                if (item.homeUrl) this.host.navigate(item.homeUrl);
                else if (shell && typeof shell.goHome === 'function') shell.goHome();
                return;
            }
            if (action === 'home-set') {
                this.changeHomePage();
                return;
            }
            if (action === 'home-remove') {
                this.saveSetting({ homePage: '' });
                return;
            }
            if (action === 'feed-open' && item && item.feedUrl) {
                this.host.navigate(item.feedUrl);
                return;
            }
            if (action === 'print') {
                this.print();
                return;
            }
            if (action === 'search-provider' && item) {
                this.saveSetting({ searchProvider: item.providerId });
                return;
            }
            if (action === 'zoom-in' || action === 'zoom-out') {
                const z = this.zoomOf(shell);
                const next = action === 'zoom-in' ? ZOOM_STEPS.find((v) => v > z) : ZOOM_STEPS.slice().reverse().find((v) => v < z);
                if (next) this.setZoom(next);
                return;
            }
            if (action === 'zoom' && item) {
                this.setZoom(item.zoomLevel);
                return;
            }
            if (action.startsWith('h:')) {
                const index = Number(action.slice(2));
                if (Number.isInteger(index) && shell && typeof shell.goToHistoryIndex === 'function') shell.goToHistoryIndex(index);
                return;
            }
            if (action === 'fav-open' && item && item.bookmarkUrl) {
                this.host.navigate(item.bookmarkUrl);
                return;
            }
            // IE7's New Window: another full Grimoire window with this page (tagWikiSearchModal.js, #615)
            if (action === 'page-new-window') {
                if (typeof this.host.openPageInNewWindow === 'function') this.host.openPageInNewWindow();
                else if (shell && typeof shell.openInNewWindow === 'function') shell.openInNewWindow();
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
                { text: 'New Window', subtext: 'Ctrl+N', icon: 'fas fa-window-restore', action: 'page-new-window' },
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

        /** Home ▾: the home page (checked), then Add or Change / Remove like IE7's. */
        homeItems() {
            const custom = this.homePage;
            const items = [{ text: 'Grimoire', action: 'home-go', homeUrl: '', indicatorStyle: 'dot', checked: !custom }];
            if (custom) items.push({ text: this.homeLabel(custom), subtext: custom, action: 'home-go', homeUrl: custom, indicatorStyle: 'dot', checked: true });
            items.push({ separator: true });
            items.push({ text: 'Add or Change Home Page...', action: 'home-set', disabled: !this.pageAddress() });
            items.push({ text: 'Remove Home Page', action: 'home-remove', disabled: !custom });
            return items;
        }

        homeLabel(url) {
            const site = this.siteLabel(url);
            return site || url;
        }

        /** The page on show as a home page address: the web page, or the Grimoire page's edtx:// address. */
        pageAddress() {
            const shell = this.shell();
            const entry = shell && shell.history ? shell.history[shell.historyIndex] : null;
            if (!entry || entry.type === 'home') return '';
            const url = entry.type === 'web' ? this.currentWebUrl() : this.currentAddress();
            return /^(https?|edtx):\/\/\S+$/i.test(url) ? url : '';
        }

        async changeHomePage() {
            const url = this.pageAddress();
            if (!url) return;
            const ask = root.showConfirmationDialog;
            const ok = typeof ask === 'function'
                ? await ask(`Would you like to use the following as your home page?\n\n${url}`, 'Yes', 'No')
                : true;
            if (ok) this.saveSetting({ homePage: url });
        }

        feedsOf(shell) {
            return (shell && Array.isArray(shell._grimoireIeFeeds)) ? shell._grimoireIeFeeds : [];
        }

        feedItems() {
            const feeds = this.feedsOf(this.shell());
            if (!feeds.length) return [{ text: 'No Feeds Detected on this page', disabled: true }];
            return feeds.map((feed, i) => ({ text: feed.title || `Feed ${i + 1}`, subtext: this.siteLabel(feed.href), icon: 'fas fa-rss', action: 'feed-open', feedUrl: feed.href }));
        }

        printItems() {
            return [
                { text: 'Print...', icon: 'fas fa-print', action: 'print' },
                // the browser's print dialog is a preview with the page setup in it
                { text: 'Print Preview...', action: 'print' }
            ];
        }

        provider() {
            return SEARCH_PROVIDERS.find((p) => p.id === this.searchProvider) || SEARCH_PROVIDERS[0];
        }

        searchItems() {
            const current = this.provider().id;
            return SEARCH_PROVIDERS.map((p) => ({ text: p.label, action: 'search-provider', providerId: p.id, indicatorStyle: 'dot', checked: p.id === current }));
        }

        zoomItems() {
            const z = this.zoomOf(this.shell());
            return [
                { text: 'Zoom In', action: 'zoom-in', disabled: z >= ZOOM_STEPS[ZOOM_STEPS.length - 1] },
                { text: 'Zoom Out', action: 'zoom-out', disabled: z <= ZOOM_STEPS[0] },
                { separator: true }
            ].concat(ZOOM_LEVELS.map((level) => ({ text: `${level}%`, action: 'zoom', zoomLevel: level, indicatorStyle: 'dot', checked: z === level })));
        }

        // ---- settings (userGlobalSettings.alchemy) ----

        async loadSettings() {
            if (typeof root.grimoireLoadAlchemySettings !== 'function') return;
            try {
                this.applySettings(await root.grimoireLoadAlchemySettings());
            } catch (_err) { /* defaults stay */ }
        }

        applySettings(settings) {
            this.homePage = (settings && settings.homePage) || '';
            this.searchProvider = (settings && settings.searchProvider) || 'grimoire';
            this.searchInput.placeholder = this.provider().label;
            this.searchInput.setAttribute('aria-label', this.provider().label);
            if (this.host.homeBtn) this.host.homeBtn.title = this.homePage ? `Home (${this.homeLabel(this.homePage)})` : 'Home';
        }

        async saveSetting(patch) {
            if (typeof root.grimoireSaveAlchemySettings !== 'function') return;
            try {
                this.applySettings(await root.grimoireSaveAlchemySettings(patch));
            } catch (_err) {
                if (typeof root.showGlassToast === 'function') root.showGlassToast('error', null, 'Could not save the setting', false, 4000);
            }
        }

        // ---- zoom (per pane) ----

        zoomOf(shell) {
            return (shell && shell._grimoireIeZoom) || 100;
        }

        setZoom(level) {
            const shell = this.shell();
            if (!shell) return;
            shell._grimoireIeZoom = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.round(level)));
            this.applyZoom(shell);
            this.sync();
        }

        /** Grimoire pages: CSS zoom on the pane's page (vista-explorer.css); Alchemy: Chrome's own zoom.
         *  Outside the IE chrome (no zoom control) pages show at 100%. */
        applyZoom(shell) {
            if (!shell || !shell.displayArea) return;
            const z = this.isOn() ? this.zoomOf(shell) / 100 : 1;
            if (z === 1) shell.displayArea.style.removeProperty('--grimoire-ie-zoom');
            else shell.displayArea.style.setProperty('--grimoire-ie-zoom', String(z));
            const frame = typeof root.grimoireRemoteFrame === 'function' ? root.grimoireRemoteFrame(shell) : null;
            if (frame && frame.contentWindow && (z !== 1 || shell._grimoireIeZoomSent)) {
                frame.contentWindow.postMessage({ type: 'grimoire-browser-zoom', value: z }, '*');
                shell._grimoireIeZoomSent = z !== 1;
            }
        }

        // ---- Alchemy messages ----

        shellOfFrame(source) {
            const shells = [this.host, this.host.rightPane].filter(Boolean);
            return shells.find((shell) => {
                const frame = typeof root.grimoireRemoteFrame === 'function' ? root.grimoireRemoteFrame(shell) : null;
                return frame && frame.contentWindow === source;
            }) || null;
        }

        frameMessage(ev) {
            const data = ev.data;
            if (!data || typeof data !== 'object' || typeof data.type !== 'string' || !data.type.startsWith('grimoire-browser-')) return;
            const shell = this.shellOfFrame(ev.source);
            if (!shell) return;
            if (data.type === 'grimoire-browser-ready') {
                // a new viewer: feeds come again from the service, and it starts at 100%
                shell._grimoireIeFeeds = [];
                shell._grimoireIeZoomSent = false;
                this.applyZoom(shell);
                this.sync();
            } else if (data.type === 'grimoire-browser-feeds') {
                shell._grimoireIeFeeds = (Array.isArray(data.feeds) ? data.feeds : [])
                    .filter((feed) => feed && /^https?:\/\//i.test(feed.href || ''))
                    .map((feed) => ({ href: String(feed.href), title: String(feed.title || '') }));
                this.sync();
            } else if (data.type === 'grimoire-browser-print' && data.id && data.id === this.printId) {
                this.printId = '';
                this.printing = false;
                if (data.error || !/^data:image\//.test(data.image || '')) {
                    this.sync();
                    if (typeof root.showGlassToast === 'function') root.showGlassToast('error', null, 'Could not print this page', false, 4000);
                    return;
                }
                const img = document.createElement('img');
                img.className = 'grimoire-ie-print-shot';
                img.alt = data.title || '';
                img.src = data.image;
                this.printNodes([img], data.title || data.url || 'Web page');
            }
        }

        // ---- print ----

        /** Print...: a Grimoire page is copied into the print host; a web page comes back from Alchemy as one picture. */
        print() {
            const shell = this.shell();
            if (!shell || !shell.displayArea || this.printing) return;
            const entry = shell.history ? shell.history[shell.historyIndex] : null;
            const frame = typeof root.grimoireRemoteFrame === 'function' ? root.grimoireRemoteFrame(shell) : null;
            if (entry && entry.type === 'web' && frame && frame.contentWindow) {
                this.printing = true;
                this.printId = 'p' + Date.now().toString(36);
                this.statusText.textContent = 'Preparing to print…';
                frame.contentWindow.postMessage({ type: 'grimoire-browser-print', id: this.printId }, '*');
                // no answer (an old Alchemy service, a closed page): give the button back
                setTimeout(() => {
                    if (this.printing && this.printId) {
                        this.printing = false;
                        this.printId = '';
                        this.sync();
                    }
                }, 30000);
                return;
            }
            const page = document.createElement('div');
            page.className = shell.displayArea.className;
            page.innerHTML = shell.displayArea.innerHTML;
            page.querySelectorAll('iframe, script, video, audio').forEach((el) => el.remove());
            this.printNodes([page], this.tabTitle.textContent || 'Grimoire');
        }

        printNodes(nodes, title) {
            let printHost = document.getElementById('grimoireIePrintHost');
            if (!printHost) {
                printHost = document.createElement('div');
                printHost.id = 'grimoireIePrintHost';
                document.body.appendChild(printHost);
            }
            printHost.replaceChildren(...nodes);
            const html = document.documentElement;
            const docTitle = document.title;
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                html.classList.remove('grimoire-ie-printing');
                printHost.replaceChildren();
                document.title = docTitle;
                root.removeEventListener('afterprint', finish);
                this.sync();
            };
            const go = () => {
                html.classList.add('grimoire-ie-printing');
                document.title = title; // the browser's print header and PDF name
                root.addEventListener('afterprint', finish);
                root.print();
                setTimeout(finish, 1000); // print() returns once the dialog closes; afterprint is not always sent
            };
            const pending = [...printHost.querySelectorAll('img')].filter((img) => !img.complete);
            if (!pending.length) {
                go();
                return;
            }
            Promise.all(pending.map((img) => new Promise((resolve) => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
            }))).then(go);
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

        // ---- tabs (grimoireTabs.js) ----

        /** The window's tabs; without the tab module, the window itself as its one tab. */
        tabList() {
            const tabs = this.host.tabs;
            return tabs ? tabs.list() : [{ id: 0 }];
        }

        tabById(id) {
            return this.tabList().find((tab) => String(tab.id) === String(id)) || null;
        }

        tabOfEvent(ev) {
            const el = ev && ev.target && ev.target.closest ? ev.target.closest('.grimoire-ie-tab') : null;
            return el ? this.tabById(el.dataset.tabId) : null;
        }

        /** The tab on show speaks for its active pane, as the address bar does. */
        activeTabInfo() {
            const shell = this.shell();
            const entry = shell && shell.history ? shell.history[shell.historyIndex] : null;
            return {
                title: entry ? this.entryLabel(entry, shell.historyIndex) : 'Grimoire',
                icon: pageFavicon(entry),
                loading: this.isLoading()
            };
        }

        backgroundTabInfo(tab) {
            const pane = this.host.tabs.paneOf(tab) || {};
            const entry = pane.history ? pane.history[pane.historyIndex] : null;
            const label = entry && typeof this.host.getHistoryEntryDisplayText === 'function'
                ? this.host.getHistoryEntryDisplayText(entry, pane.historyIndex)
                : 'Grimoire';
            return { title: label, icon: pageFavicon(entry), loading: !!tab.loading };
        }

        makeTabEl(tab) {
            const el = document.createElement('div');
            el.className = 'grimoire-ie-tab';
            el.setAttribute('role', 'tab');
            el.dataset.tabId = String(tab.id);
            el.innerHTML = '<img class="grimoire-ie-tab-icon" alt=""><span class="grimoire-ie-tab-title"></span>'
                + '<button type="button" class="grimoire-ie-tab-close" title="Close Tab (Ctrl+W)" aria-label="Close Tab"></button>';
            return el;
        }

        /** IE7's strip: every tab in order, the one on show raised with its close button; Quick Tabs and Tab List ▾ from two tabs on. */
        renderTabs() {
            if (!this.tabStrip) return;
            const tabs = this.host.tabs;
            const list = this.tabList();
            const seen = new Set();
            list.forEach((tab, i) => {
                let el = this.tabEls.get(tab.id);
                if (!el) {
                    el = this.makeTabEl(tab);
                    this.tabEls.set(tab.id, el);
                }
                seen.add(tab.id);
                const active = tabs ? tabs.isActive(tab) : true;
                const info = active ? this.activeTabInfo() : this.backgroundTabInfo(tab);
                const titleEl = el.querySelector('.grimoire-ie-tab-title');
                const iconEl = el.querySelector('.grimoire-ie-tab-icon');
                if (titleEl.textContent !== info.title) titleEl.textContent = info.title;
                if (iconEl.getAttribute('src') !== info.icon) iconEl.setAttribute('src', info.icon);
                el.title = info.title;
                el.classList.toggle('is-active', active);
                el.classList.toggle('is-loading', info.loading);
                el.setAttribute('aria-selected', active ? 'true' : 'false');
                if (active) {
                    this.tabTitle = titleEl;
                    this.tabIcon = iconEl;
                }
                if (this.tabStrip.children[i] !== el) this.tabStrip.insertBefore(el, this.tabStrip.children[i] || null);
            });
            this.tabEls.forEach((el, id) => {
                if (seen.has(id)) return;
                el.remove();
                this.tabEls.delete(id);
            });
            const many = list.length > 1;
            if (this.tabTools.hidden === many) this.tabTools.hidden = !many;
            // a tab opened or closed under Quick Tabs: the grid follows
            if (this.isQuickTabsOpen() && this.quickCount !== list.length) this.toggleQuickTabs(many);
            this.tabRow.classList.toggle('has-many-tabs', many);
            // tabs past the strip's end: the one on show scrolls into it
            const current = this.tabStrip.querySelector('.grimoire-ie-tab.is-active');
            if (current) {
                const strip = this.tabStrip;
                if (current.offsetLeft < strip.scrollLeft) strip.scrollLeft = current.offsetLeft;
                else if (current.offsetLeft + current.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = current.offsetLeft + current.offsetWidth - strip.clientWidth;
            }
        }

        wireTabs() {
            const tabs = this.host.tabs;
            if (!tabs) {
                // no tab module: the stub opens the page in a new window, as before #451
                this.newTab.addEventListener('click', () => {
                    const shell = this.shell();
                    if (shell && typeof shell.openInNewWindow === 'function') shell.openInNewWindow();
                });
                return;
            }
            tabs.onChange(() => this.sync());
            this.newTab.addEventListener('click', () => {
                this.toggleQuickTabs(false);
                tabs.open();
            });
            this.tabStrip.addEventListener('click', (ev) => {
                const tab = this.tabOfEvent(ev);
                if (!tab) return;
                this.toggleQuickTabs(false);
                if (ev.target.closest('.grimoire-ie-tab-close')) tabs.close(tab);
                else tabs.activate(tab);
            });
            // middle click closes a tab (no autoscroll circle)
            this.tabStrip.addEventListener('mousedown', (ev) => {
                if (ev.button === 1) ev.preventDefault();
            });
            this.tabStrip.addEventListener('auxclick', (ev) => {
                const tab = ev.button === 1 ? this.tabOfEvent(ev) : null;
                if (!tab) return;
                ev.preventDefault();
                tabs.close(tab);
            });
            // a double click on the row's empty space opens a tab
            this.tabRow.addEventListener('dblclick', (ev) => {
                const t = ev.target;
                if (t === this.tabRow || t.classList.contains('grimoire-ie-tabs') || t === this.tabStrip) tabs.open();
            });
            const cm = root.contextMenu;
            if (!cm) return;
            const listConfig = {
                sections: [{ type: 'list', items: [] }],
                onAction: (action, target, item) => {
                    const tab = item && this.tabById(item.tabId);
                    if (action === 'tab-show' && tab) tabs.activate(tab);
                }
            };
            const fillList = () => {
                listConfig.sections[0].items = tabs.list().map((tab) => ({
                    text: (tabs.isActive(tab) ? this.activeTabInfo() : this.backgroundTabInfo(tab)).title,
                    action: 'tab-show',
                    tabId: tab.id,
                    indicatorStyle: 'dot',
                    checked: tabs.isActive(tab)
                }));
                cm.detachClickMenuFromElement(this.tabListBtn);
                cm.attachClickMenuToElement(this.tabListBtn, listConfig);
            };
            this.tabListBtn.addEventListener('pointerdown', fillList, true);
            this.tabListBtn.addEventListener('focus', fillList);
            fillList();
            this.quickTabsBtn.addEventListener('click', () => this.toggleQuickTabs());

            // IE7's tab menu (VM): Close, Close Other Tabs | Refresh, Refresh All | New Tab
            let menuTab = null;
            const tabMenu = {
                sections: [{ type: 'list', items: [] }],
                beforeShow: (event) => {
                    menuTab = this.tabOfEvent(event) || null;
                    const one = tabs.count() < 2;
                    tabMenu.sections[0].items = [
                        { text: 'Close', action: 'tab-close', disabled: !menuTab },
                        { text: 'Close Other Tabs', action: 'tab-close-others', disabled: !menuTab || one },
                        { separator: true },
                        { text: 'Refresh', action: 'tab-refresh', disabled: !menuTab },
                        { text: 'Refresh All', action: 'tab-refresh-all' },
                        { separator: true },
                        { text: 'New Tab', action: 'tab-new' }
                    ];
                },
                onAction: (action) => {
                    if (action === 'tab-new') tabs.open();
                    else if (action === 'tab-refresh-all') this.refreshTabs(tabs.list());
                    else if (!menuTab) return;
                    else if (action === 'tab-close') tabs.close(menuTab);
                    else if (action === 'tab-close-others') tabs.closeOthers(menuTab);
                    else if (action === 'tab-refresh') this.refreshTabs([menuTab]);
                }
            };
            tabMenu.beforeShow(null);
            cm.attachToElement(this.tabStrip, tabMenu);
        }

        // ---- Quick Tabs (Ctrl+Q): every tab as a thumbnail over the page, IE7's grid ----

        isQuickTabsOpen() {
            return !!(this.quickView && this.quickView.isConnected);
        }

        toggleQuickTabs(force) {
            const open = force === undefined ? !this.isQuickTabsOpen() : force;
            if (this.quickView) this.quickView.remove();
            this.quickView = null;
            this.quickTabsBtn.classList.remove('is-pressed');
            if (this.onQuickKey) document.removeEventListener('keydown', this.onQuickKey, true);
            const tabs = this.host.tabs;
            const wrap = this.modal.querySelector('.tag-wiki-panels-wrap');
            if (!open || !tabs || tabs.count() < 2 || !wrap) return;
            const view = document.createElement('div');
            view.className = 'grimoire-ie-quickview';
            const panel = document.createElement('div');
            panel.className = 'grimoire-ie-quickpanel';
            view.appendChild(panel);
            const ref = this.host.displayArea;
            const refWidth = Math.max(320, (ref && ref.clientWidth) || 800);
            tabs.list().forEach((tab) => panel.appendChild(this.quickTile(tab, refWidth)));
            view.addEventListener('click', (ev) => {
                const tile = ev.target.closest('.grimoire-ie-quicktile');
                const tab = tile ? this.tabById(tile.dataset.tabId) : null;
                if (!tab) return;
                if (ev.target.closest('.grimoire-ie-quicktile-close')) {
                    tabs.close(tab);
                    this.toggleQuickTabs(tabs.count() > 1);
                    return;
                }
                this.toggleQuickTabs(false);
                tabs.activate(tab);
            });
            wrap.appendChild(view);
            this.quickView = view;
            this.quickCount = tabs.count();
            this.quickTabsBtn.classList.add('is-pressed');
            this.onQuickKey = (ev) => {
                if (ev.key !== 'Escape') return;
                ev.preventDefault();
                ev.stopPropagation();
                this.toggleQuickTabs(false);
            };
            document.addEventListener('keydown', this.onQuickKey, true);
        }

        /** One tile: the title, the close button and a picture of the page (Alchemy's last frame, or the Grimoire page scaled down). */
        quickTile(tab, refWidth) {
            const tabs = this.host.tabs;
            const active = tabs.isActive(tab);
            const info = active ? this.activeTabInfo() : this.backgroundTabInfo(tab);
            const tile = document.createElement('div');
            tile.className = 'grimoire-ie-quicktile';
            tile.dataset.tabId = String(tab.id);
            tile.title = info.title;
            const title = document.createElement('span');
            title.className = 'grimoire-ie-quicktile-title';
            title.textContent = info.title;
            const close = button('', 'grimoire-ie-quicktile-close', 'Close Tab');
            const shot = document.createElement('div');
            shot.className = 'grimoire-ie-quicktile-shot';
            tile.append(title, close, shot);

            const pane = tabs.paneOf(tab);
            const top = pane && pane.history ? pane.history[pane.historyIndex] : null;
            // an Alchemy page: its last frame (grimoireTabs.js frameSnapshot), or the one kept when its session was given up
            const picture = pane && pane._grimoireRemoteSessionId ? tabs.frameSnapshot(pane) : (top && top.type === 'web' ? tab.snapshot || '' : '');
            if (picture || (top && top.type === 'web')) {
                if (picture) {
                    const img = document.createElement('img');
                    img.alt = '';
                    img.src = picture;
                    shot.appendChild(img);
                }
                return tile;
            }
            const area = pane && pane.displayArea;
            if (!area) return tile;
            const scale = 227 / refWidth;
            const page = document.createElement('div');
            page.className = 'tag-wiki-search-display grimoire-ie-quicktile-page';
            page.style.width = refWidth + 'px';
            page.style.height = Math.ceil(146 / scale) + 'px';
            page.style.transform = `scale(${scale})`;
            const copy = area.cloneNode(true);
            copy.querySelectorAll('iframe, script, video, audio').forEach((el) => el.remove());
            [copy, ...copy.querySelectorAll('[id]')].forEach((el) => el.removeAttribute('id'));
            page.appendChild(copy);
            shot.appendChild(page);
            return tile;
        }

        /** Refresh: the tab on show through the window's refresh; a background Alchemy page reloads in place;
         *  a background Grimoire page is shown and refreshed (its page is drawn in the window). */
        refreshTabs(list) {
            const tabs = this.host.tabs;
            let showAndRefresh = null;
            list.forEach((tab) => {
                if (tabs.isActive(tab)) return;
                const pane = tabs.paneOf(tab);
                const frame = pane && pane._grimoireRemoteSessionId && typeof root.grimoireRemoteFrame === 'function' ? root.grimoireRemoteFrame(pane) : null;
                if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type: 'grimoire-browser-reload' }, '*');
                else if (list.length === 1) showAndRefresh = tab;
            });
            if (showAndRefresh) tabs.activate(showAndRefresh);
            if (showAndRefresh || list.some((tab) => tabs.isActive(tab))) {
                if (this.host.refreshBtn) this.host.refreshBtn.click();
            }
        }

        // ---- state ----

        sync() {
            const shell = this.shell();
            if (!shell || !this.tabStrip) return;
            const entry = shell.history ? shell.history[shell.historyIndex] : null;
            const web = !!(entry && entry.type === 'web');
            const title = this.activeTabInfo().title;
            this.renderTabs();
            // IE's caption: "<page> - Windows Internet Explorer"; here "<page> - Grimoire"
            if (this.captionLabel) {
                const caption = this.isOn() && entry && entry.type !== 'home' ? `${title} - Grimoire` : 'Grimoire';
                if (this.captionLabel.textContent !== caption) this.captionLabel.textContent = caption;
            }

            const loading = this.isLoading();
            this.stop.disabled = !loading;
            if (!this.printing) this.statusText.textContent = loading ? 'Waiting for page…' : 'Done';

            const feeds = web ? this.feedsOf(shell) : [];
            this.feedsBtn.disabled = !feeds.length;
            this.feedsDrop.disabled = !feeds.length;
            this.feedsBtn.title = feeds.length ? `View Feeds on this Page (${feeds.length})` : 'No Feeds Detected on this page';
            this.printBtn.disabled = !!this.printing;
            this.zoomText.textContent = `${this.zoomOf(shell)}%`;
            // IE7's zones (the VM registry's Internet Settings Zones 1 and 3): the Grimoire is the local intranet, Alchemy the Internet
            const zone = web ? 'Internet | Protected Mode: On' : 'Local intranet | Protected Mode: Off';
            if (this.zoneText.textContent !== zone) this.zoneText.textContent = zone;
            const zoneArt = `${ART}/${web ? 'zone-internet' : 'zone-intranet'}.png`;
            if (this.zoneIcon && this.zoneIcon.getAttribute('src') !== zoneArt) this.zoneIcon.setAttribute('src', zoneArt);

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
