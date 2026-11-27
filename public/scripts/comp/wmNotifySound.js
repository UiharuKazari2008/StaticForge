/**
 * Melaton Mobile Settings > Sounds & Notifications > Sounds: "Notification sound:" (StaticForge #1298).
 *
 * Yukimi: "we need the ability to select a android notification sound for notifications, that is not add every single
 * notification sound in a impossible to navigate list that is show a view to select it. there are too many to select from".
 * So the page has ONE row (a combo-looking button that opens the picker; it is not a drop-down) and the picker is a
 * full-page view inside the Settings page, in the Windows Mobile list idiom (the Wallpaper browse view's way: a view of
 * the page, not a program), with its own soft keys Select / Back:
 *
 *   level 1  Event sounds (default) | None | each category the phone has (Notifications, Ringtones, Alarms, Melaton,
 *            Added by you) with its count and a chevron. Never a single sound.
 *   level 2  one category: a search box, then its sounds fifty at a time ("Show more" ends the list); tapping a row
 *            highlights it and plays it (Play / Stop on the highlighted row); Select chooses it.
 *
 * The sounds live in the Android app (window.AndroidSounds, DSApp-Kotlin); the page only asks for what is on screen:
 * categories() once per open, list() per category / search / page on a tap, nothing prefetched, nothing periodic. Where
 * the bridge is missing (a browser, an older app) the row is not drawn at all.
 *
 * Under the workspace's sound scheme "No Sounds" the row is disabled like its neighbours and does not open the picker
 * (#1367: nothing sounds then, with the page in front or asleep).
 *
 * The choice lives in the page draft (d.nsound = { mode, id, title, category }, d.nsoundSaved for "changed") and is
 * written with AndroidSounds.set(...) in the page's commit, like every other Sounds tab value.
 *
 * Settings' sub-view hooks (wmPrograms.js subView): the page asks this file for viewDepth / viewTitle / softKeys / back /
 * viewOk, so the shell's back key, the corner ok and the soft keys all work on the picker. window.wmNotifySound is the
 * page's handle (a deliberate export; wmSettingsPersonal.js reads it when it draws, so load order does not matter).
 *
 * A preview plays ONLY from her tap on a row or on Play (rule notification-discipline N7); nothing here sounds, toasts or
 * says "saved" on its own. Styles: public/css/wm-notify-sound.css. Test: scripts/test-notify-sound-picker.js.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile') return;

    const PAGE = 50; // sounds asked for at a time (the bridge allows 100)
    const DEBOUNCE = 250; // ms a search waits for the next key
    const TITLE = 'Notification sound';
    const EVENT_LABEL = 'Event sounds';
    const NOTE = 'Used by notifications that have no sound of their own on the Notifications tab.';

    const ui = () => (window.wmSettings && window.wmSettings.ui) || null;
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const refreshKeys = () => { const sh = window.wmShell; if (sh && typeof sh.refreshSoftKeys === 'function') sh.refreshSoftKeys(); };

    // ---------------------------------------------------------------- the bridge
    // Every method returns a JSON string except preview / stop / set (booleans). A missing or failing call is null.
    const bridge = () => window.AndroidSounds || null;
    function call(name, ...args) {
        const b = bridge();
        if (!b || typeof b[name] !== 'function') return null;
        try { return b[name](...args); } catch (_) { return null; }
    }
    function json(name, ...args) {
        const r = call(name, ...args);
        if (typeof r !== 'string') return null;
        try { return JSON.parse(r); } catch (_) { return null; }
    }

    // the bridge's version is read once per bridge object (a synchronous call: never from a render)
    let seenBridge = null;
    let seenOk = false;
    function available() {
        const b = bridge();
        if (!b) return false;
        if (b !== seenBridge) {
            seenBridge = b;
            seenOk = ['version', 'categories', 'list', 'get', 'set', 'preview', 'stop'].every((n) => typeof b[n] === 'function') && Number(call('version')) >= 1;
        }
        return seenOk;
    }

    function normalise(g) {
        const mode = g && (g.mode === 'none' || g.mode === 'sound') ? g.mode : 'default';
        if (mode !== 'sound') return { mode, id: '', title: '', category: '' };
        return { mode, id: String(g.id || ''), title: String(g.title || ''), category: String(g.category || '') };
    }

    /** The draft's sound scheme is No Sounds: the row is off. */
    const schemeOff = (d) => d.scheme === 'none';

    function choiceLabel(n) {
        if (n.mode === 'none') return 'None';
        if (n.mode === 'sound') return n.title || 'Selected sound';
        return EVENT_LABEL;
    }

    // ---------------------------------------------------------------- the picker
    /**
     * The picker of one open page: depth 0 (closed), 1 (the categories), 2 (one category's sounds). Keys of a row:
     * 'default', 'none', 'cat:<id>' at level 1; 's:<id>' and 'more' at level 2.
     */
    function makePicker(d) {
        const c = {
            depth: 0,
            cats: [],
            cat: null,
            q: '',
            items: [],
            total: 0,
            next: 0,
            failed: false,
            hi: '', // the highlighted row's key
            pin: null, // the sound in use, drawn first when its category opens and it is not on the first page: { id, title }
            playing: '', // the id the app says is sounding (the androidsoundpreview event)
            started: false, // a preview was asked for and not stopped since
            timer: 0,
            live: null, // AbortController of the listeners held while the picker is open
            host: null, // the Settings page's api ({ rerender })
            root: null, // the .wm-form the picker is drawn in
            html: '' // the list as last written (written only when it changes)
        };

        const chosenKey = () => {
            const n = d.nsound;
            if (c.depth === 1) return n.mode === 'sound' ? `cat:${n.category}` : n.mode;
            return n.mode === 'sound' ? `s:${n.id}` : '';
        };
        const hiItem = () => (c.hi.startsWith('s:') ? (c.pin && `s:${c.pin.id}` === c.hi ? c.pin : c.items.find((it) => `s:${it.id}` === c.hi)) || null : null);
        // The sound in use stays visible in its category (#1298): the list shows fifty at a time, so one further down would
        // not be seen when the category opens. With no search text, and when it is not among the rows loaded, it is the first
        // row (a later page that brings it is not drawn twice); a search shows exactly what the bridge answers.
        function setPin() {
            const n = d.nsound;
            c.pin = !c.q && !c.failed && c.items.length && c.cat && n.mode === 'sound' && n.id && n.category === c.cat.id && !c.items.some((it) => it.id === n.id)
                ? { id: n.id, title: n.title || n.id } : null;
        }

        // ---- previews: only from a tap of hers (N7)
        function preview(id) {
            if (!id) return;
            // notice: wm-notify-sound-preview
            c.started = call('preview', id) === true;
        }
        // Every way out of the picker or of a level asks the app to stop, whatever the page believes is sounding: the app's
        // `stopped` event of one preview can arrive after the next preview was asked for and clear what the page tracks.
        function stop() {
            c.started = false;
            c.playing = '';
            call('stop');
        }
        function onPreview(e) {
            const det = (e && e.detail) || {};
            const id = String(det.id || '');
            if (det.state === 'playing') c.playing = id;
            else if (det.state === 'stopped') { if (!id || c.playing === id) c.playing = ''; if (!c.playing) c.started = false; }
            else return;
            syncPlay();
        }
        // leaving Settings for another program ends the preview and the picker with it
        function onApp(e) { if (e && e.detail && e.detail.id !== 'settings') c.shutdown(); }
        // the screen going off, the page hidden or the shell behind an Android program ends the preview only: the picker
        // stays where it was and only the Play button goes back to Play (the state is read as the other Settings pages do)
        function onAway(e) {
            const det = (e && e.detail) || {};
            const ds = (document.documentElement && document.documentElement.dataset) || {};
            const away = document.hidden === true || ds.screenOff !== undefined || ds.wmBehind !== undefined
                || (e && e.type === 'melatonscreen' && det.on === false) || (e && e.type === 'wmBehind' && det.on === true);
            if (!away) return;
            stop();
            syncPlay();
        }

        function attach() {
            if (c.live) return;
            c.live = new AbortController();
            const signal = c.live.signal;
            window.addEventListener('androidsoundpreview', onPreview, { signal });
            document.addEventListener('wmAppChange', onApp, { signal });
            window.addEventListener('melatonscreen', onAway, { signal });
            document.addEventListener('visibilitychange', onAway, { signal });
            document.addEventListener('wmBehind', onAway, { signal });
        }
        function detach() {
            if (c.live) c.live.abort();
            c.live = null;
        }

        // ---- the data, asked for on a tap
        function loadPage(reset) {
            if (!c.cat) return;
            if (reset) { c.items = []; c.next = 0; c.total = 0; c.failed = false; }
            const r = json('list', c.cat.id, c.q, c.next, PAGE);
            if (!r || !Array.isArray(r.items)) { c.failed = true; return; }
            c.failed = false;
            const have = new Set(c.items.map((it) => it.id));
            for (const it of r.items) {
                if (it && it.id && !have.has(it.id)) { c.items.push({ id: String(it.id), title: String(it.title || it.id) }); have.add(it.id); }
            }
            c.next += r.items.length;
            c.total = Math.max(Number(r.total) || 0, c.items.length);
            if (!r.items.length) c.total = c.items.length; // nothing more behind a page that came back empty
        }
        const hasMore = () => c.items.length > 0 && c.next < c.total;

        // ---- moving between levels
        function rerender() { if (c.host && typeof c.host.rerender === 'function') c.host.rerender(); }
        function open() {
            const cats = json('categories');
            c.cats = Array.isArray(cats) ? cats.filter((x) => x && x.id).map((x) => ({ id: String(x.id), label: String(x.label || x.id), count: Number(x.count) || 0 })) : [];
            c.cat = null; c.q = ''; c.items = []; c.next = 0; c.total = 0; c.failed = false; c.pin = null;
            c.depth = 1;
            c.hi = chosenKey();
            if (c.hi.startsWith('cat:') && !c.cats.some((x) => `cat:${x.id}` === c.hi)) c.hi = 'default';
            attach();
            rerender();
        }
        function openCategory(cat) {
            c.cat = cat; c.q = '';
            loadPage(true);
            setPin();
            c.depth = 2;
            c.hi = c.pin || c.items.some((it) => `s:${it.id}` === chosenKey()) ? chosenKey() : '';
            rerender();
        }
        function close() {
            if (c.timer) { clearTimeout(c.timer); c.timer = 0; }
            stop();
            detach();
            c.depth = 0; c.cat = null; c.q = ''; c.items = []; c.next = 0; c.total = 0; c.hi = ''; c.pin = null;
        }
        function choose(n) {
            d.nsound = n;
            close();
            rerender();
        }
        function back() {
            if (c.depth === 2) {
                if (c.timer) { clearTimeout(c.timer); c.timer = 0; }
                stop();
                const was = c.cat;
                c.depth = 1; c.cat = null; c.q = ''; c.items = []; c.next = 0; c.total = 0; c.pin = null;
                c.hi = was ? `cat:${was.id}` : 'default';
                rerender();
                return true;
            }
            if (c.depth === 1) { close(); rerender(); return true; }
            return false;
        }
        // Select (the left soft key): choose the highlighted row, or open the category it is
        function select() {
            if (c.depth === 1) {
                if (c.hi === 'default' || c.hi === 'none') { choose({ mode: c.hi, id: '', title: '', category: '' }); return true; }
                const cat = c.cats.find((x) => `cat:${x.id}` === c.hi);
                if (cat) { openCategory(cat); return true; }
                return false;
            }
            if (c.depth === 2) {
                const it = hiItem();
                if (!it) return false;
                choose({ mode: 'sound', id: it.id, title: it.title, category: c.cat ? c.cat.id : '' });
                return true;
            }
            return false;
        }
        // the corner ok: confirms a choice that is final and leaves the picker, it never goes deeper
        function ok() {
            if (c.depth === 2) { if (hiItem()) return select(); return back(); }
            if (c.depth === 1) { if (c.hi === 'default' || c.hi === 'none') return select(); close(); rerender(); return true; }
            return false;
        }
        // a tap on a row: highlight it (and play it at level 2); a second tap on a level 1 row does what Select does
        function tap(key) {
            if (c.depth === 1) {
                if (c.hi === key) { select(); return; }
                c.hi = key;
            } else if (c.depth === 2) {
                if (key === 'more') { more(); return; }
                if (!key.startsWith('s:') || c.hi === key) return;
                c.hi = key;
                preview(key.slice(2));
            } else return;
            paintList();
            refreshKeys();
        }
        function more() {
            if (c.depth !== 2 || !hasMore()) return;
            loadPage(false);
            paintList();
        }
        function togglePlay() {
            const it = hiItem();
            if (!it) return;
            if (c.playing === it.id) stop(); else preview(it.id);
            syncPlay();
        }
        function queryChanged(text) {
            if (c.timer) clearTimeout(c.timer);
            c.timer = setTimeout(() => {
                c.timer = 0;
                if (c.depth !== 2) return;
                const q = String(text || '').trim();
                if (q === c.q) return;
                c.q = q;
                loadPage(true);
                setPin();
                if (c.hi.startsWith('s:') && !hiItem()) c.hi = '';
                paintList();
                refreshKeys();
            }, DEBOUNCE);
        }
        function shutdown() {
            if (!c.depth) return;
            close();
        }

        // ---- drawing
        const mark = (chosen) => `<span class="wmns-mark${chosen ? ' is-chosen' : ''}" aria-hidden="true"></span>`;
        function row(key, label, o = {}) {
            const hi = c.hi === key;
            const play = hi && o.sound ? `<button type="button" class="wm-button wmsp-play wmns-play${c.playing === o.sound ? ' is-playing' : ''}" data-act="play" aria-label="${c.playing === o.sound ? 'Stop' : 'Play'}"></button>` : '';
            return `<div class="wm-listbox-row wmns-row${hi ? ' is-selected' : ''}${o.chosen ? ' is-chosen' : ''}" role="option" aria-selected="${hi}" tabindex="0" data-key="${esc(key)}">${mark(o.chosen)}<span class="wmns-label">${esc(label)}</span>${o.count !== undefined ? `<span class="wmns-count">${o.count}</span>` : ''}${o.chevron ? '<span class="wmns-chevron" aria-hidden="true"></span>' : ''}${play}</div>`;
        }
        function listHtml() {
            const n = d.nsound;
            if (c.depth === 1) {
                return row('default', `${EVENT_LABEL} (default)`, { chosen: n.mode === 'default' })
                    + row('none', 'None', { chosen: n.mode === 'none' })
                    + c.cats.map((x) => row(`cat:${x.id}`, x.label, { chosen: n.mode === 'sound' && n.category === x.id, count: x.count, chevron: true })).join('');
            }
            const sound = (it) => row(`s:${it.id}`, it.title, { chosen: n.mode === 'sound' && n.id === it.id, sound: it.id });
            const rows = (c.pin ? sound(c.pin) : '') + c.items.filter((it) => !c.pin || it.id !== c.pin.id).map(sound).join('');
            const tail = c.failed ? '<div class="wmns-empty">The sounds could not be read.</div>'
                : !c.items.length ? `<div class="wmns-empty">${c.q ? 'No sound matches.' : 'No sounds.'}</div>`
                : hasMore() ? `<div class="wm-listbox-row wmns-row wmns-more" role="button" tabindex="0" data-key="more"><span class="wmns-label">Show more</span></div>` : '';
            return rows + tail;
        }
        /** The list only (a tap, a page, a search result): the search box keeps its focus and the list its place. */
        function paintList() {
            const list = c.root && c.root.querySelector ? c.root.querySelector('.wmns-list') : null;
            if (!list) return;
            const html = listHtml();
            if (html === c.html) return;
            const top = list.scrollTop;
            c.html = html;
            list.innerHTML = html;
            list.scrollTop = top;
        }
        /** Play / Stop follows the app's event: the button of the highlighted row only. */
        function syncPlay() {
            const b = c.root && c.root.querySelector ? c.root.querySelector('.wmns-play') : null;
            if (!b) return;
            const it = hiItem();
            const on = !!it && c.playing === it.id;
            if (b.classList.contains('is-playing') !== on) b.classList.toggle('is-playing', on);
            const label = on ? 'Stop' : 'Play';
            if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
            c.html = listHtml();
        }

        function draw(el, api) {
            c.host = api;
            c.root = el;
            const u = ui();
            const bar = c.depth === 2 ? u.row('Search:', u.edit('wmns-q', c.q, 'aria-label="Search sounds" autocapitalize="off" spellcheck="false" enterkeyhint="search"'), { for: 'wmns-q' }) : '';
            c.html = listHtml();
            el.innerHTML = `${bar}<div class="wm-listbox wmns-list" role="listbox" aria-label="${esc(c.depth === 2 && c.cat ? c.cat.label : TITLE)}">${c.html}</div>`;
            const box = el.querySelector('#wmns-q');
            if (box) box.addEventListener('input', () => queryChanged(box.value));
            el.addEventListener('click', (e) => {
                const t = e.target && e.target.closest ? e.target : null;
                if (!t) return;
                if (t.closest('.wmns-play')) { togglePlay(); return; }
                const r = t.closest('[data-key]');
                if (r && r.dataset) tap(r.dataset.key);
            });
            el.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const r = e.target && e.target.closest ? e.target.closest('[data-key]') : null;
                if (!r || !r.dataset) return;
                e.preventDefault();
                tap(r.dataset.key);
            });
        }

        Object.assign(c, {
            open, openCategory, back, select, ok, tap, more, togglePlay, queryChanged, shutdown, draw, paintList,
            canSelect: () => (c.depth === 1 ? !!c.hi : !!hiItem()),
            title: () => (c.depth === 2 && c.cat ? c.cat.label : TITLE)
        });
        return c;
    }

    // ---------------------------------------------------------------- what the Settings page calls
    // a deliberate export: the Settings page reads it (the segment deletes it on unload)
    function stopPicker(d) { if (d.nsoundUi) d.nsoundUi.shutdown(); }
    const changed = (d) => !!d.nsound && !same(d.nsound, d.nsoundSaved);
    window.wmNotifySound = {
        /** The bridge is there: the page offers the row. */
        available,
        /** Page open: read the choice once and make the picker. Without the bridge the draft has none. */
        init(d) {
            if (!available()) { d.nsound = null; d.nsoundSaved = null; d.nsoundUi = null; return; }
            d.nsound = normalise(json('get'));
            d.nsoundSaved = JSON.parse(JSON.stringify(d.nsound));
            d.nsoundUi = makePicker(d);
        },
        /** The row (empty without the bridge): "Notification sound:" over a button that opens the picker, and its note. */
        rowHtml(d) {
            const u = ui();
            if (!d.nsound || !d.nsoundUi || !u) return '';
            return `${u.gap()}${u.row('Notification sound:', u.comboHtml('nsound', choiceLabel(d.nsound), schemeOff(d)), { wide: true })}${u.note(NOTE)}`;
        },
        bindRow(el, d, api) {
            const b = el.querySelector('[data-act="nsound"]');
            if (!b || !d.nsoundUi) return;
            // the combo's look, a button's job: it opens the picker (it is not a drop-down)
            b.addEventListener('click', () => {
                if (schemeOff(d)) return;
                // another preview of this page (the Notifications tab's Play) ends when the picker opens
                const s = window.wmShell && window.wmShell.sounds;
                if (s && typeof s.stop === 'function') { try { s.stop(); } catch (_) { /* nothing was sounding */ } }
                d.nsoundUi.host = api;
                d.nsoundUi.open();
            });
        },
        /** The picker, drawn in place of the page. */
        render(el, d, api) { if (d.nsoundUi) d.nsoundUi.draw(el, api); },
        viewDepth: (d) => (d.nsoundUi ? d.nsoundUi.depth : 0),
        viewTitle: (d) => (d.nsoundUi && d.nsoundUi.depth ? d.nsoundUi.title() : ''),
        softKeys(d) {
            const c = d.nsoundUi;
            if (!c || !c.depth) return { left: null, right: null };
            return { left: { label: 'Select', action: () => c.select(), disabled: !c.canSelect() }, right: { label: 'Back', action: () => c.back() } };
        },
        back: (d) => !!(d.nsoundUi && d.nsoundUi.back()),
        viewOk: (d) => !!(d.nsoundUi && d.nsoundUi.depth && d.nsoundUi.ok()),
        /** Anything sounding stops and the picker closes (the page is saved or left). */
        stop: stopPicker,
        changed,
        /**
         * The page's save: previews stop, then the choice is written when it changed. false = it was refused (the page
         * says so with box(), told once where it failed, and stays open).
         */
        async commit(d, box) {
            stopPicker(d);
            if (!changed(d)) return true;
            const n = d.nsound;
            const sound = n.mode === 'sound';
            const r = call('set', n.mode, sound ? n.id : '', sound ? n.title : '', sound ? n.category : '');
            if (r !== true && r !== 'true') {
                if (typeof box === 'function') await box({ title: 'Sounds & Notifications', icon: 'error', text: 'The notification sound could not be saved.' });
                return false;
            }
            d.nsoundSaved = JSON.parse(JSON.stringify(n));
            return true;
        }
    };
})();
