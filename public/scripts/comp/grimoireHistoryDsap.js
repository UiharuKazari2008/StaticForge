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

    function load() {
        try {
            const list = JSON.parse(root.localStorage.getItem(KEY) || '[]');
            return Array.isArray(list) ? list.filter((r) => r && r.url && r.at) : [];
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
        if (/^dsap:\/\/history\.grimoire\.jp/i.test(u)) return false;
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
        if (!recordable(url)) return;
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

    function siteOf(url) {
        const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
        return m ? m[1].replace(/^www\./i, '') : '';
    }

    function iconFor(url) {
        if (/^https?:/i.test(url)) return 'fas fa-globe';
        if (/^rdf:/i.test(url)) return 'fas fa-file-alt';
        if (/^dsap:/i.test(url)) return 'fas fa-puzzle-piece';
        if (/search/i.test(url)) return 'fas fa-search';
        return 'fas fa-book';
    }

    function render(rootEl, query) {
        const list = load();
        const q = String(query || '').trim().toLowerCase();
        const rows = q ? list.filter((r) => `${r.title} ${r.url}`.toLowerCase().includes(q)) : list;
        const body = rootEl.querySelector('.gh-list');
        if (!rows.length) {
            body.innerHTML = `<div class="gh-empty">${q ? 'No pages match your search.' : 'No pages have been visited yet.'}</div>`;
            return;
        }
        let html = '';
        let group = null;
        for (const r of rows) {
            const label = groupLabel(r.at);
            if (label !== group) {
                if (group !== null) html += '</ul>';
                group = label;
                html += `<h3 class="gh-day">${esc(label)}</h3><ul class="gh-rows">`;
            }
            const time = new Date(r.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            html += `<li class="gh-row" data-url="${esc(r.url)}">
                <i class="${iconFor(r.url)} gh-icon" aria-hidden="true"></i>
                <a class="gh-title" href="#" data-url="${esc(r.url)}" title="${esc(r.url)}">${esc(r.title || r.url)}</a>
                <span class="gh-site">${esc(siteOf(r.url))}</span>
                <span class="gh-time">${esc(time)}</span>
                <button type="button" class="gh-remove" data-remove="${esc(r.url)}" title="Delete from History" aria-label="Delete from History">&times;</button>
            </li>`;
        }
        html += '</ul>';
        body.innerHTML = html;
    }

    const CSS = `
        .gh-page { font: 12px "Segoe UI", Tahoma, sans-serif; color: #1e1e1e; padding: 18px 24px 32px; max-width: 900px; }
        .gh-page h2 { font: 18px "Segoe UI", Tahoma, sans-serif; color: #1e395b; margin: 0 0 12px; font-weight: normal; }
        .gh-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 14px; }
        .gh-bar input { flex: 1; max-width: 320px; height: 22px; box-sizing: border-box; padding: 2px 4px; }
        .gh-day { font: bold 12px "Segoe UI", Tahoma, sans-serif; color: #1e395b; margin: 16px 0 4px; padding-bottom: 3px; border-bottom: 1px solid #b6c5d8; }
        .gh-rows { list-style: none; margin: 0; padding: 0; }
        .gh-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) minmax(0, 180px) 64px 18px; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 2px; }
        .gh-row:hover { background: #e5f3fb; }
        .gh-icon { color: #4a6f9c; font-size: 12px; text-align: center; }
        .gh-title { color: #0066cc; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .gh-title:hover { text-decoration: underline; }
        .gh-site, .gh-time { color: #6d6d6d; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .gh-time { text-align: right; }
        .gh-remove { visibility: hidden; border: 0; background: none; color: #8a8a8a; font-size: 14px; line-height: 14px; padding: 0; min-width: 0; min-height: 0; cursor: pointer; }
        .gh-row:hover .gh-remove { visibility: visible; }
        .gh-remove:hover { color: #c00; }
        .gh-empty { color: #6d6d6d; padding: 24px 0; }
    `;

    const driver = {
        init(host) {
            const rootEl = host.getRoot();
            if (!rootEl) return;
            const search = rootEl.querySelector('.gh-search');
            render(rootEl, '');
            search.addEventListener('input', () => render(rootEl, search.value));
            rootEl.addEventListener('click', (ev) => {
                const rm = ev.target.closest('[data-remove]');
                if (rm) {
                    ev.preventDefault();
                    remove(rm.dataset.remove);
                    render(rootEl, search.value);
                    return;
                }
                const link = ev.target.closest('a[data-url]');
                if (link) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    host.navigate(link.dataset.url);
                    return;
                }
                if (ev.target.closest('[data-gh-clear]')) {
                    const ask = typeof root.showConfirmationDialog === 'function'
                        ? root.showConfirmationDialog('Are you sure you want to delete your browsing history?', [
                            { text: 'Yes', value: true, className: 'btn-standard primary' },
                            { text: 'No', value: false, className: 'btn-standard' }
                        ], ev, { title: 'Delete Browsing History', icon: 'fas fa-question-circle' })
                        : Promise.resolve(true);
                    ask.then((yes) => {
                        if (!yes) return;
                        clear();
                        render(rootEl, search.value);
                    });
                }
            });
        },
        refresh(host) {
            const rootEl = host.getRoot();
            if (rootEl) render(rootEl, (rootEl.querySelector('.gh-search') || {}).value || '');
        }
    };

    function register() {
        if (typeof root.registerDsap !== 'function' || register.done) return;
        register.done = true;
        root.registerDsap({
            url: 'history.grimoire.jp',
            title: 'History',
            type: 'core',
            getContent() {
                return {
                    html: `<div class="gh-page" data-dsap="history">
                        <h2>History</h2>
                        <div class="gh-bar">
                            <input type="search" class="gh-search" placeholder="Search History" aria-label="Search History">
                            <button type="button" class="btn-standard" data-gh-clear="1">Delete History...</button>
                        </div>
                        <div class="gh-list"></div>
                    </div>`,
                    css: CSS,
                    drivers: driver,
                    baseBackground: '#ffffff'
                };
            }
        });
    }

    register();

    root.GRIMOIRE_HISTORY_URL = HISTORY_URL;
    root.grimoireHistoryLog = { noteAddress, add, remove, clear, load, register, _test: { groupLabel, recordable } };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.grimoireHistoryLog;
})(typeof window !== 'undefined' ? window : globalThis);
