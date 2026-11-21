/**
 * Grimoire / Alchemy History (Yukimi 2026-10-22, Yozora #628): every page the browser showed, web
 * pages and Grimoire's own (tag wiki, docs, Apocrypha, search, DSAP pages), kept per browser profile
 * in localStorage and listed by day at dsap://history.grimoire.jp. Tools ▾ > History opens it
 * (grimoireRemoteBrowser.js grimoireShowSiteMenu).
 *
 * Recording: tagWikiSearchModal.js setAddress calls grimoireHistoryLog.noteAddress(pane, url) for
 * every address the bar shows; the visit is written a moment later so the page's title (which a
 * web page sends after its address) is in it, and a page shown again within 30 minutes updates its
 * row instead of adding one. The History page itself is not recorded.
 */
(function (root) {
    'use strict';

    const KEY = 'grimoireHistory';
    const MAX = 3000;
    const MERGE_MS = 30 * 60 * 1000;
    const SETTLE_MS = 1200;
    const HISTORY_URL = 'dsap://history.grimoire.jp';

    // Internet Properties > Browsing history > Settings: "Days to keep pages in history" (IE's
    // Url History DaysToKeep, cplInternetOptions.js; 0 keeps none, the default 20)
    const DAYS_KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Internet Settings\\Url History';

    function daysToKeep() {
        const reg = root.melatonRegistry;
        const n = reg ? Number(reg.get(DAYS_KEY, 'DaysToKeep', 20)) : 20;
        return Number.isFinite(n) ? Math.max(0, Math.min(999, n)) : 20;
    }

    function load() {
        try {
            const list = JSON.parse(root.localStorage.getItem(KEY) || '[]');
            const since = Date.now() - daysToKeep() * 86400000;
            return Array.isArray(list) ? list.filter((r) => r && r.url && r.at && r.at >= since) : [];
        } catch (_) {
            return [];
        }
    }

    function save(list) {
        try {
            root.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
        } catch (_) {
            // full: keep the newer half
            try { root.localStorage.setItem(KEY, JSON.stringify(list.slice(0, Math.floor(MAX / 2)))); } catch (_e) { /* private mode */ }
        }
    }

    function recordable(url) {
        const u = String(url || '');
        if (!/^(https?|edtx|rdf|dsap):\/\/\S+/i.test(u)) return false;
        // the History page and the New Tab page are not visits
        if (/^dsap:\/\/(history|tabs)\.grimoire\.jp/i.test(u)) return false;
        if (/^https?:\/\/(localhost|127\.)/i.test(u)) return false;
        return true;
    }

    function titleFor(pane, url) {
        if (typeof root.grimoireShellBookmarkTitle === 'function') {
            const t = root.grimoireShellBookmarkTitle(pane, url);
            if (t && t !== url) return t;
        }
        if (pane && pane._grimoireRemoteTitle && /^https?:/i.test(url)) return pane._grimoireRemoteTitle;
        return url.replace(/^(edtx|rdf|dsap):\/\//i, '');
    }

    function add(url, title) {
        if (!recordable(url) || daysToKeep() === 0) return;
        const now = Date.now();
        const list = load();
        const at = list.findIndex((r) => r.url === url);
        if (at >= 0 && now - list[at].at < MERGE_MS) {
            const row = list.splice(at, 1)[0];
            row.at = now;
            if (title && title !== url) row.title = title;
            row.count = (row.count || 1) + 1;
            list.unshift(row);
        } else {
            list.unshift({ url, title: title || url, at: now, count: 1 });
        }
        save(list);
    }

    const pending = new WeakMap();

    /** An address the bar now shows for this pane (tagWikiSearchModal.js setAddress). */
    function noteAddress(pane, url) {
        if (!pane || !recordable(url)) return;
        const prev = pending.get(pane);
        if (prev) clearTimeout(prev);
        pending.set(pane, setTimeout(() => {
            pending.delete(pane);
            const now = pane._currentAddress || pane.currentAddress;
            const shown = (now && now.fullUrl) || url;
            if (shown !== url) return;
            add(url, titleFor(pane, url));
        }, SETTLE_MS));
    }

    function remove(url) {
        save(load().filter((r) => r.url !== url));
    }

    function clear() {
        save([]);
    }

    // ---- the History page ----------------------------------------------------------------------

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function dayStart(d) {
        const x = new Date(d);
        x.setHours(0, 0, 0, 0);
        return x.getTime();
    }

    /** IE7's history groups: Today, Yesterday, the weekdays of this week, Last Week, then months. */
    function groupLabel(at, now = Date.now()) {
        const today = dayStart(now);
        const day = dayStart(at);
        const days = Math.round((today - day) / 86400000);
        if (days <= 0) return 'Today';
        if (days === 1) return 'Yesterday';
        if (days < 7) return new Date(at).toLocaleDateString('en-US', { weekday: 'long' });
        if (days < 14) return 'Last Week';
        if (days < 21) return '2 Weeks Ago';
        if (days < 28) return '3 Weeks Ago';
        return new Date(at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    // ---- the page: IE7's History in the Favorites Center (Yukimi, Nov 21 2026: "the history page needs to be updated
    // like a IE page"): the History header with View By Date ▾ (By Date, By Site, By Most Visited, By Order Visited
    // Today, Search History), a tree of days (oldest first, Today last, as IE7 lists them), each day's sites, each
    // site's pages; a right-click deletes. Styles: css/themes/vista/grimoire-ie-pages.css (.gfc-*). ----
    const VIEW_KEY = 'grimoireHistoryView';
    const VIEWS = [
        { id: 'date', label: 'View By Date' },
        { id: 'site', label: 'View By Site' },
        { id: 'visits', label: 'View By Most Visited' },
        { id: 'today', label: 'View By Order Visited Today' },
        { id: 'search', label: 'Search History' }
    ];
    const ICON_DAY = '/static_images/vista-cmdbar/calendar.png';
    const ICON_SITE = '/static_images/vista-cmdbar/folder.png';
    const ICON_WEB = '/static_images/vista-ie/page-ie.png';
    const ICON_GRIMOIRE = '/static_images/app_icons/books.webp';

    function viewOf() {
        try {
            const v = root.localStorage.getItem(VIEW_KEY);
            return VIEWS.some((x) => x.id === v) ? v : 'date';
        } catch (_) {
            return 'date';
        }
    }

    function pageIcon(url) {
        return /^https?:/i.test(url) ? ICON_WEB : ICON_GRIMOIRE;
    }

    /** "bing (www.bing.com)": IE7's site folders; Grimoire's own sites by their host. */
    function siteLabel(url) {
        const host = (/^[a-z]+:\/\/([^/?#]+)/i.exec(url) || [])[1] || url;
        if (!/^https?:/i.test(url)) return host;
        const short = host.replace(/^www\./i, '').split('.')[0];
        return short && short !== host ? `${short} (${host})` : host;
    }

    function pageRow(r, level) {
        return `<li class="gfc-item gfc-page gfc-l${level}" data-url="${esc(r.url)}"><a class="gfc-link" href="#" data-url="${esc(r.url)}" title="${esc(r.url)}">`
            + `<img class="gfc-icon" src="${pageIcon(r.url)}" alt="">${esc(r.title || r.url)}</a></li>`;
    }

    function groupRow(key, icon, label, inner, open) {
        return `<li class="gfc-item gfc-group${open ? ' is-open' : ''}" data-group="${esc(key)}"><a class="gfc-link gfc-toggle" href="#">`
            + `<img class="gfc-icon" src="${icon}" alt="">${esc(label)}</a><ul class="gfc-children">${inner}</ul></li>`;
    }

    function bySite(rows, level, keyPrefix) {
        const sites = new Map();
        rows.forEach((r) => {
            const s = siteLabel(r.url);
            if (!sites.has(s)) sites.set(s, []);
            sites.get(s).push(r);
        });
        return Array.from(sites.keys()).sort((a, b) => a.localeCompare(b))
            .map((s) => groupRow(`${keyPrefix}|${s}`, ICON_SITE, s, sites.get(s).map((r) => pageRow(r, level + 1)).join(''), false)).join('');
    }

    function render(rootEl, query) {
        const view = viewOf();
        const list = load();
        const tree = rootEl.querySelector('.gfc-tree');
        const viewBtn = rootEl.querySelector('.gfc-view-label');
        const searchRow = rootEl.querySelector('.gfc-search-row');
        if (viewBtn) viewBtn.textContent = (VIEWS.find((v) => v.id === view) || VIEWS[0]).label;
        if (searchRow) searchRow.hidden = view !== 'search';
        const open = rootEl._gfcOpen || (rootEl._gfcOpen = new Set(['Today']));
        let html = '';
        if (view === 'date') {
            const days = new Map();
            list.forEach((r) => {
                const label = groupLabel(r.at);
                if (!days.has(label)) days.set(label, []);
                days.get(label).push(r);
            });
            // oldest first, Today last
            html = Array.from(days.keys()).reverse()
                .map((d) => groupRow(d, ICON_DAY, d, bySite(days.get(d), 1, d), open.has(d))).join('');
        } else if (view === 'site') {
            html = bySite(list, 0, 'site');
        } else if (view === 'visits') {
            const merged = new Map();
            list.forEach((r) => {
                const m = merged.get(r.url);
                if (m) m.count += r.count || 1;
                else merged.set(r.url, Object.assign({}, r, { count: r.count || 1 }));
            });
            html = Array.from(merged.values()).sort((a, b) => b.count - a.count || b.at - a.at).slice(0, 200).map((r) => pageRow(r, 0)).join('');
        } else if (view === 'today') {
            const today = dayStart(Date.now());
            html = list.filter((r) => r.at >= today).map((r) => pageRow(r, 0)).join('');
        } else {
            const q = String(query || '').trim().toLowerCase();
            html = q ? list.filter((r) => `${r.title} ${r.url}`.toLowerCase().includes(q)).map((r) => pageRow(r, 0)).join('') : '';
        }
        tree.innerHTML = html || `<li class="gfc-empty">${view === 'search' ? (String(query || '').trim() ? 'No pages match your search.' : 'Type words to search for in your History.') : 'There are no pages in your History.'}</li>`;
    }

    const driver = {
        init(host) {
            const rootEl = host.getRoot();
            if (!rootEl) return;
            const search = rootEl.querySelector('.gfc-search');
            const viewBtn = rootEl.querySelector('.gfc-view');
            render(rootEl, '');
            const again = () => render(rootEl, search ? search.value : '');
            if (search) search.addEventListener('input', again);
            const cm = root.contextMenu;
            if (cm && viewBtn) {
                const attach = () => {
                    cm.detachClickMenuFromElement(viewBtn);
                    cm.attachClickMenuToElement(viewBtn, {
                        sections: [{ type: 'list', items: VIEWS.slice(0, 4).map((v) => ({ text: v.label, action: v.id, showIndicator: true, indicatorStyle: 'dot', checked: viewOf() === v.id }))
                            .concat([{ separator: true }, { text: 'Search History', action: 'search', showIndicator: true, indicatorStyle: 'dot', checked: viewOf() === 'search' }]) }],
                        onAction: (action) => {
                            try { root.localStorage.setItem(VIEW_KEY, action); } catch (_) { /* private mode */ }
                            again();
                            if (action === 'search' && search) search.focus();
                        }
                    });
                };
                viewBtn.addEventListener('pointerdown', attach, true);
                viewBtn.addEventListener('focus', attach);
                attach();
            }
            rootEl.addEventListener('click', (ev) => {
                const toggle = ev.target.closest('.gfc-toggle');
                if (toggle) {
                    ev.preventDefault();
                    const item = toggle.closest('.gfc-group');
                    item.classList.toggle('is-open');
                    if (item.classList.contains('is-open')) rootEl._gfcOpen.add(item.dataset.group);
                    else rootEl._gfcOpen.delete(item.dataset.group);
                    return;
                }
                const link = ev.target.closest('a[data-url]');
                if (link) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    host.navigate(link.dataset.url);
                }
            });
            // IE7's History item menu: Open, Delete
            if (cm) {
                let menuUrl = '';
                const menu = {
                    sections: [{ type: 'list', items: [] }],
                    beforeShow: (event) => {
                        const item = event && event.target && event.target.closest ? event.target.closest('.gfc-page') : null;
                        menuUrl = item ? item.dataset.url : '';
                        menu.sections[0].items = [
                            { text: 'Open', action: 'open', disabled: !menuUrl, className: 'context-menu-item-default' },
                            { separator: true },
                            { text: 'Delete', action: 'delete', disabled: !menuUrl },
                            { separator: true },
                            { text: 'Delete Browsing History...', action: 'clear' }
                        ];
                    },
                    onAction: (action) => {
                        if (action === 'open' && menuUrl) host.navigate(menuUrl);
                        else if (action === 'delete' && menuUrl) { remove(menuUrl); again(); }
                        else if (action === 'clear') askClear(again);
                    }
                };
                cm.attachToElement(rootEl, menu);
            }
        },
        refresh(host) {
            const rootEl = host.getRoot();
            if (rootEl) render(rootEl, (rootEl.querySelector('.gfc-search') || {}).value || '');
        }
    };

    function askClear(after) {
        const ask = typeof root.showConfirmationDialog === 'function'
            ? root.showConfirmationDialog('Are you sure you want to delete your browsing history?', [
                { text: 'Yes', value: true, className: 'btn-standard primary' },
                { text: 'No', value: false, className: 'btn-standard' }
            ], null, { title: 'Delete Browsing History', icon: 'fas fa-question-circle' })
            : Promise.resolve(true);
        Promise.resolve(ask).then((yes) => {
            if (!yes) return;
            clear();
            after();
        });
    }

    function register() {
        if (typeof root.registerDsap !== 'function' || register.done) return;
        register.done = true;
        root.registerDsap({
            url: 'history.grimoire.jp',
            title: 'History',
            type: 'core',
            getContent() {
                return {
                    html: `<div class="gfc-pane" data-dsap="history">
                        <div class="gfc-head"><img class="gfc-head-icon" src="/static_images/vista-cmdbar/history.png" alt=""><span class="gfc-head-title">History</span></div>
                        <div class="gfc-bar"><button type="button" class="gfc-view"><span class="gfc-view-label">View By Date</span><span class="grimoire-ie-cmd-drop" aria-hidden="true"></span></button></div>
                        <div class="gfc-search-row" hidden><input type="text" class="gfc-search" placeholder="Search History" aria-label="Search History" autocomplete="off" spellcheck="false"></div>
                        <ul class="gfc-tree"></ul>
                    </div>`,
                    drivers: driver,
                    baseBackground: ''
                };
            }
        });
    }

    register();

    root.GRIMOIRE_HISTORY_URL = HISTORY_URL;
    root.grimoireHistoryLog = { noteAddress, add, remove, clear, load, register, _test: { groupLabel, recordable } };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.grimoireHistoryLog;
})(typeof window !== 'undefined' ? window : globalThis);
