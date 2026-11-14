/**
 * Melaton Mobile: Internet Search (Yozora #830), a Windows Mobile styled search program. Today's
 * Search item opens it for Search Internet (Settings > Today > Items > Search > Options...).
 *
 *   the search bar     at the top, the engine's name above it (Google or Bing, chosen under Menu)
 *   empty bar          your past searches, newest first (a tap searches again)
 *   typing             the engine's live predictions (GET /api/search-suggest, modules/searchSuggest.js),
 *                      asked 180 ms after the last key; a tap searches that
 *   Search (left key)  the results open in Internet Explorer (wmBrowser)
 *   Menu               Search Engine > Google / Bing, Clear History, Internet Explorer
 *
 * Kept on the phone: wmInternetSearchEngine ('google' | 'bing'), wmInternetSearchHistory (20).
 * window.wmInternetSearch = { open(query?), search(query), engine() }. Styles: wm-internet-search.css
 * (added by this file: the program loads on demand, LAZY_APPS in wmShell.js).
 */
(function () {
    'use strict';

    const APP_ID = 'internetsearch';
    const ENGINE_KEY = 'wmInternetSearchEngine';
    const HISTORY_KEY = 'wmInternetSearchHistory';
    const MAX_HISTORY = 20;
    const ENGINES = {
        google: { name: 'Google', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
        bing: { name: 'Bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` }
    };
    const ART = '/static_images/wm61/';
    let ws = null;
    let page = null;
    let field = null;
    let suggestTimer = null;
    let suggestSeq = 0;
    let suggestions = [];
    let selected = -1;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const read = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
    const write = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };

    function engine() { const e = read(ENGINE_KEY, 'google'); return ENGINES[e] ? e : 'google'; }
    function history() {
        try { const v = JSON.parse(read(HISTORY_KEY, '[]')); return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []; } catch (_) { return []; }
    }
    function remember(q) {
        const list = [q].concat(history().filter((s) => s.toLowerCase() !== q.toLowerCase())).slice(0, MAX_HISTORY);
        write(HISTORY_KEY, JSON.stringify(list));
    }

    function addStyles() {
        if (document.querySelector('link[data-wm-internet-search]')) return;
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = '/css/wm-internet-search.css';
        l.dataset.wmInternetSearch = '1';
        document.head.appendChild(l);
    }

    // ---------------------------------------------------------------- drawing

    function rows() {
        const q = field ? field.value.trim() : '';
        if (q) return { title: 'Suggestions', kind: 'suggest', list: suggestions };
        return { title: 'Recent searches', kind: 'history', list: history() };
    }

    function render() {
        if (!page) return;
        const e = ENGINES[engine()];
        page.querySelector('.wis-engine').textContent = e.name;
        page.querySelector('.wis-engine').dataset.engine = engine();
        const r = rows();
        const box = page.querySelector('.wis-list');
        page.querySelector('.wis-heading').textContent = r.title;
        if (!r.list.length) {
            box.innerHTML = `<div class="wis-empty">${r.kind === 'history' ? 'No recent searches' : ''}</div>`;
            return;
        }
        if (selected >= r.list.length) selected = -1;
        box.innerHTML = r.list.map((s, i) => `<button type="button" class="wm-listbox-row wis-row is-${r.kind}${i === selected ? ' is-selected' : ''}" data-q="${esc(s)}"><span class="wis-glyph" aria-hidden="true"></span><span class="wis-text">${esc(s)}</span></button>`).join('');
    }

    function askSuggestions() {
        clearTimeout(suggestTimer);
        const q = field.value.trim();
        if (!q) { suggestions = []; render(); return; }
        const seq = ++suggestSeq;
        suggestTimer = setTimeout(async () => {
            let list = [];
            try {
                const r = await fetch(`/api/search-suggest?engine=${engine()}&q=${encodeURIComponent(q)}`, { credentials: 'same-origin' }).then((x) => x.json());
                list = (r && r.success && Array.isArray(r.suggestions)) ? r.suggestions : [];
            } catch (_) { list = []; }
            if (seq !== suggestSeq || !field || field.value.trim() !== q) return;
            suggestions = list;
            selected = -1;
            render();
        }, 180);
    }

    // ---------------------------------------------------------------- searching

    /** The results in Internet Explorer (it loads on demand: wait for it a little). */
    function search(text) {
        const q = String(text == null ? (field ? field.value : '') : text).trim();
        if (!q) { if (field) field.focus(); return false; }
        remember(q);
        const url = ENGINES[engine()].url(q);
        const go = () => window.wmBrowser && typeof window.wmBrowser.open === 'function' && window.wmBrowser.open(url) !== false;
        if (!go()) {
            ws.open('browser');
            let tries = 0;
            const wait = setInterval(() => { tries += 1; if (go() || tries > 50) clearInterval(wait); }, 100);
        }
        if (field) { field.value = ''; suggestions = []; selected = -1; render(); }
        return true;
    }

    function setEngine(id) {
        if (!ENGINES[id]) return;
        write(ENGINE_KEY, id);
        suggestions = [];
        render();
        if (field && field.value.trim()) askSuggestions();
        ws.refreshSoftKeys();
    }

    function clearHistory() {
        write(HISTORY_KEY, '[]');
        render();
    }

    function mount(p) {
        page = p;
        addStyles();
        p.classList.add('wm-internet-search');
        p.innerHTML = `
            <div class="wis-band">
                <img class="wis-icon" src="${ART}app-search.png" srcset="${ART}app-search.png 1x, ${ART}app-search@2x.png 2x, ${ART}app-search@4x.png 4x" alt="" draggable="false">
                <span class="wis-engine"></span>
            </div>
            <form class="wis-bar" role="search" autocomplete="off">
                <input class="wm-edit wis-field" type="search" enterkeyhint="search" inputmode="search" aria-label="Search the Internet" spellcheck="false">
            </form>
            <div class="wis-heading"></div>
            <div class="wm-listbox wis-list" role="listbox"></div>`;
        field = p.querySelector('.wis-field');
        field.addEventListener('input', askSuggestions);
        p.querySelector('.wis-bar').addEventListener('submit', (e) => { e.preventDefault(); search(); });
        p.querySelector('.wis-list').addEventListener('click', (e) => {
            const row = e.target.closest('.wis-row');
            if (row) search(row.dataset.q);
        });
        // the D-pad / arrow keys walk the list; Enter searches the selected row (as the device)
        field.addEventListener('keydown', (e) => {
            const list = rows().list;
            if (e.key === 'ArrowDown' && list.length) { e.preventDefault(); selected = Math.min(list.length - 1, selected + 1); render(); }
            else if (e.key === 'ArrowUp' && list.length) { e.preventDefault(); selected = Math.max(-1, selected - 1); render(); }
            else if (e.key === 'Enter' && selected >= 0 && list[selected]) { e.preventDefault(); search(list[selected]); }
        });
        render();
    }

    function show() {
        render();
        // the field takes the keyboard when the program comes up (Today's tap opened it)
        if (field) requestAnimationFrame(() => { try { field.focus({ preventScroll: true }); } catch (_) { /* gone */ } });
    }

    function register() {
        ws = window.wmShell;
        ws.registerApp({
            id: APP_ID,
            title: 'Internet Search',
            icon: 'app-search',
            inStart: 'programs',
            sip: true,
            mount,
            show,
            softKeys() {
                const cur = engine();
                return {
                    left: { label: 'Search', action: () => search() },
                    right: {
                        label: 'Menu',
                        menu: () => [
                            { label: 'Search Engine', submenu: [
                                { label: 'Google', radio: cur === 'google', action: () => setEngine('google') },
                                { label: 'Bing', radio: cur === 'bing', action: () => setEngine('bing') }
                            ] },
                            { label: 'Clear History', disabled: !history().length, action: clearHistory },
                            { separator: true },
                            { label: 'Internet Explorer', action: () => ws.open('browser') }
                        ]
                    }
                };
            }
        });
    }

    window.wmInternetSearch = {
        open(q) {
            ws.open(APP_ID);
            if (q && field) { field.value = q; askSuggestions(); }
        },
        search: (q) => search(q),
        engine
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
