/**
 * Melaton Mobile 6.5: the "Melaton Default" home screen (Windows Mobile 6.5's "Windows Default"
 * Today item, code name Titanium) (Yozora #739).
 *
 * Measured on Windows Mobile 6.5 Professional (VGA emulator) and read from the ROM's own layout,
 * \Windows\Titanium_480x640.cpr (plain XML; lengths below are its VGA pixels, halved to WM units
 * in wm-titanium.css):
 *   - one column of items, 68 high when condensed (label Tahoma 18 pt at 20,8), under a fixed
 *     focus band 140 high centred in the list ((height - 140) / 2: 198 of 536, 118 of 376);
 *     the band art is 480 x 164 (RCDATA 3000), stretched to the screen width
 *   - the item in the band is expanded: panel icon 86 x 114 at 376,-26, lines at 20,34 / 20,68 /
 *     20,98 (three lines), 20,52 / 20,86 (two), 20,66 (one), bold 10 pt then regular 8 pt; with a
 *     picture (86 x 86 at 20,34, white 2 px frame) the lines start at 118; page arrows 8 x 18 at
 *     4,74 and right 4
 *   - at rest the items fade with distance from the band; while a finger drags the list every
 *     label is full white and slides 1:1 under the band's glass (dim inside it), the selected
 *     item's label waits centred in the band, and the selection moves on when the next item has
 *     travelled one full row; a drag starts after 36 px
 *   - left / right on a panel with pages: after 45 px the page follows the finger, the next one a
 *     screen width behind; past half the width it carries on, short of it the page slides back
 *   - soft keys: left the Today key, right the panel's own (Set, Compose, Messaging, Library ...);
 *     a page may bring its own right key and tap (pages[].softKey / onTap)
 *
 * Panels come from Today's items: the shell's rows (date + connection = the clock panel, as 6.5
 * shows the network under the time) and each registered item's titanium() (wmTodayWidgets.js,
 * wmAccounts.js, wmXLink.js); an item without one gets a generic panel from its row.
 *
 * Settings > Today > Items lists "Melaton Default" first (6.5 only); unchecked, Today shows its
 * rows as in 6.1. The other items' check boxes and order pick the panels.
 */
(function () {
    'use strict';

    const root = document.documentElement;
    if (window.uiShell !== 'mobile' || root.dataset.wmVersion !== '6.5') return;

    const ART = '/static_images/wm65/';
    const ROW = 34;      // condensed item, WM units (68 VGA px)
    const BAND = 70;     // focus band (140)
    const DRAG_START = 18; // a drag starts after 36 VGA px of travel
    const SLIDE_START = 22.5; // a page starts to follow the finger after 45
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // wm65 art by name ('ti-2051'); 's:owner' / 'x:app-studio-lg' / 'p:wren' = a 6.5 Start icon / a 6.1 set
    // icon / a Director persona's picture; 'w:rain' = a weather condition (ti-w-*)
    // icon in the panel icons' frame with their mirror image (ti-s-*, ti-x-*: made for the items 6.5
    // has no panel art for); or a path
    const artUrl = (name, scale) => {
        const n = String(name || '');
        if (n.startsWith('/')) return n;
        const file = n.startsWith('x:') ? `ti-x-${n.slice(2)}` : n.startsWith('s:') ? `ti-s-${n.slice(2)}` : n.startsWith('p:') ? `ti-p-${n.slice(2)}` : n.startsWith('w:') ? `ti-w-${n.slice(2)}` : n;
        return `${ART}${file}${scale > 1 ? `@${scale}x` : ''}.png`;
    };
    // 1x = the ROM art halved, 2x = the ROM art, 4x = it upscaled (GPU) for dense phone screens
    const artSet = (name) => (String(name || '').startsWith('/') ? `${name} 1x` : `${artUrl(name)} 1x, ${artUrl(name, 2)} 2x, ${artUrl(name, 4)} 4x`);
    const artImageSet = (name) => `image-set(url("${artUrl(name)}") 1x, url("${artUrl(name, 2)}") 2x, url("${artUrl(name, 4)}") 4x)`;

    let sh = null;
    let host = null;     // .wm-ti inside Today's page
    let page = null;
    let panels = [];     // [{ id, label, count, icon, pages, softKey, onTap, clock }]
    let sel = 0;         // selected panel
    let pos = 0;         // list position in rows while dragging / settling (sel at rest)
    let pageAt = new Map(); // panel id -> page index
    let dragging = false;
    let settle = 0;      // rAF id of the settle animation
    let panelsKey = '';
    let homeDone = false;

    const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    const fmtShort = new Intl.DateTimeFormat(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' });

    function timeParts(d) {
        let time = '';
        let ampm = '';
        try {
            for (const p of fmtTime.formatToParts(d)) {
                if (p.type === 'dayPeriod') ampm = p.value;
                else if (p.type !== 'literal' || p.value.trim()) time += p.value;
            }
        } catch (_) { time = fmtTime.format(d); }
        return { time: time.trim(), ampm };
    }

    // ---------------------------------------------------------------- settings

    function storedItems() {
        try { const v = JSON.parse(localStorage.getItem(sh.todayItemsKey) || 'null'); return Array.isArray(v) ? v : null; } catch (_) { return null; }
    }

    /** "Melaton Default" checked in Settings > Today > Items (on until switched off). */
    function enabled() {
        const list = storedItems();
        const it = list && list.find((x) => x && x.id === 'titanium');
        return !(it && it.on === false);
    }

    // ---------------------------------------------------------------- panels

    const lower = (s) => String(s || '').toLowerCase();

    /** The shell's own rows as panels. */
    function builtin(id, st, rowEl) {
        if (id === 'date') {
            const now = new Date();
            const t = timeParts(now);
            return {
                clock: true, label: t.time, count: t.ampm, icon: 'ti-2051',
                pages: [{ time: t.time, ampm: t.ampm, date: fmtShort.format(now), network: st.connection ? st.connection.text : '' }],
                softKey: { label: 'Set', action: () => openSettings('clock') },
                onTap: () => {
                    if (st.connection && st.connection.tap === 'reconnect' && window.wsClient && typeof window.wsClient.manualReconnect === 'function') window.wsClient.manualReconnect();
                    else openSettings('clock');
                }
            };
        }
        if (id === 'connection') return null; // 6.5 shows the network on the clock panel
        if (id === 'owner') {
            return { label: 'owner', icon: 's:owner', pages: [{ title: st.owner || 'Owner' }], softKey: { label: 'Edit', action: () => openSettings('owner') }, onTap: () => openSettings('owner') };
        }
        if (id === 'messages') {
            // the last five messages of the inbox, a page each: subject over sender and time
            const n = st.mailUnread;
            const list = recentMail();
            const go = () => sh.open('messaging');
            const openMail = (m) => { const a = window.wmMessaging; if (a && typeof a.openMail === 'function') a.openMail(m.id); else go(); };
            return {
                label: 'e-mail', count: n ? String(n) : '', icon: 'ti-2008',
                pages: list.length
                    ? list.map((m) => ({ title: m.subject || '(no subject)', line2: [mailFrom(m), mailWhen(m.createdAt)].filter(Boolean).join(', '), onTap: () => openMail(m) }))
                    : [{ title: 'No New E-mails' }],
                softKey: { label: 'Messaging', action: go },
                onTap: go
            };
        }
        if (id === 'tasks') {
            return { label: 'tasks', icon: 's:tasks', pages: [{ title: st.tasks || 'No tasks' }], softKey: { label: 'Pictures', action: () => sh.open('gallery') }, onTap: () => sh.open('gallery') };
        }
        if (id === 'search') {
            return { label: 'search', icon: 's:search', pages: [{ title: 'Search pictures' }], softKey: { label: 'Search', action: () => searchPictures() }, onTap: () => searchPictures() };
        }
        if (id === 'workspace') {
            // the current workspace (Change opens Teleport), the favourites picked in the item's
            // options (Change travels there), then Manage Workspaces (Create)
            const all = st.workspaces || [];
            const count = (w) => (w.count == null ? '' : (w.count === 1 ? '1 picture' : `${w.count.toLocaleString()} pictures`));
            const teleport = () => sh.open('teleport');
            const cur = all.find((w) => w.active);
            const pages = [{ title: cur ? cur.name : (st.workspace || 'Workspace'), line2: cur ? count(cur) : '', softKey: { label: 'Change', action: teleport }, onTap: teleport }];
            all.filter((w) => w.favorite && !w.active).forEach((w) => {
                const travel = () => st.switchWorkspace(w.id);
                pages.push({ title: w.name, line2: count(w), softKey: { label: 'Change', action: travel }, onTap: travel });
            });
            pages.push({ title: 'Manage Workspaces', line2: all.length === 1 ? '1 workspace' : `${all.length} workspaces`, softKey: { label: 'Create', action: createWorkspaceAsk }, onTap: teleport });
            return { label: 'workspace', icon: 's:fileexp', pages };
        }
        if (id === 'prints') {
            const prints = (st.prints || []).filter((p) => p.filename);
            if (!prints.length) return { label: 'pictures', icon: 'ti-2451', pages: [{ title: 'No Photos' }], softKey: { label: 'Pictures', action: () => sh.open('gallery') }, onTap: () => sh.open('gallery') };
            return {
                label: 'pictures', icon: 'ti-2451',
                pages: prints.map((p) => ({ image: p.preview, title: printName(p.filename), line2: printWhen(p), file: p.filename })),
                softKey: { label: 'Pictures', action: () => sh.open('gallery') },
                onTap: (pg) => { sh.open('gallery'); try { if (pg && pg.file && typeof showLightbox === 'function') showLightbox({ filename: pg.file }); } catch (_) { /* the gallery opens without the viewer */ } }
            };
        }
        // a shell row this file does not know: its text
        const text = rowEl ? rowEl.textContent.trim() : '';
        return text ? { label: lower(id), icon: 'x:app-programs-lg', pages: [{ title: text }] } : null;
    }

    // ---- recent mail (dovecote_list_mail, read-only: listing marks nothing read) ----
    const mail = { list: [], at: 0, busy: false };
    function recentMail() {
        const c = window.wsClient;
        if (!mail.busy && Date.now() - mail.at > 60000 && c && typeof c.isConnected === 'function' && c.isConnected() && c.initializationCompleted) {
            mail.busy = true;
            Promise.resolve(c.sendMessage('dovecote_list_mail', { folder: 'inbox', limit: 5 }, false))
                .then((r) => { mail.list = ((r && (r.mail || (r.data && r.data.mail))) || []).slice(0, 5); })
                .catch(() => { /* the panel keeps what it had */ })
                .finally(() => { mail.at = Date.now(); mail.busy = false; });
        }
        return mail.list;
    }

    function mailFrom(m) {
        const f = (m.fromLabel && !m.labelSuspicious) ? m.fromLabel : m.from;
        if (f && typeof f === 'object') return String(f.name || f.display || f.address || f.id || '');
        return String(f || '').replace(/\s*<[^>]*>\s*$/, '').replace(/^"(.*)"$/, '$1');
    }

    function mailWhen(v) {
        const t = v ? new Date(typeof v === 'number' && v < 1e11 ? v * 1000 : v) : null;
        if (!t || Number.isNaN(t.getTime())) return '';
        return t.toDateString() === new Date().toDateString() ? fmtTime.format(t) : `${fmtTime.format(t)} ${fmtShort.format(t)}`;
    }

    /** Manage Workspaces > Create: the name in a message box, then the desktop's own createWorkspace. */
    async function createWorkspaceAsk() {
        const name = await sh.messageBox({ title: 'Workspaces', text: 'Name of the new workspace:', input: { value: '' }, buttons: [{ text: 'Create', value: true }, { text: 'Cancel', value: false }], cancelValue: false });
        const text = typeof name === 'string' ? name.trim() : (name && typeof name.value === 'string' ? name.value.trim() : '');
        if (!text) return;
        try { if (typeof createWorkspace === 'function') await sh.busy(() => createWorkspace(text), { paint: true }); } catch (err) { console.warn('[wmTitanium] create workspace', err); }
    }

    function printName(file) {
        return String(file || '').replace(/\.[a-z0-9]+$/i, '');
    }

    function printWhen(p) {
        const t = p.time ? new Date(typeof p.time === 'number' && p.time < 1e11 ? p.time * 1000 : p.time) : null;
        if (!t || Number.isNaN(t.getTime())) return '';
        return `${fmtTime.format(t)} ${fmtShort.format(t)}`;
    }

    function openSettings(id) {
        if (window.wmSettings && typeof window.wmSettings.open === 'function') window.wmSettings.open(id);
    }

    function searchPictures() {
        // Pictures holds the search (its Menu > Search)
        sh.open('gallery');
    }

    /** An item's 6.1 icon name as its panel icon (the large one of the set: ti-x-app-<x>-lg). */
    function panelIcon(name) {
        const n = String(name || '');
        if (!n || n.startsWith('/')) return n || 'x:app-programs-lg';
        if (/^(ti-|s:|x:|p:|w:)/.test(n)) return n;
        return `x:${n.replace(/^today-/, 'app-').replace(/-lg$/, '')}-lg`;
    }

    /** A registered item (registerTodayItem) as a panel: its titanium(), or a generic one from its row. */
    function widgetPanel(w, rowEl) {
        const option = (key) => sh.todayOption(w.id, key);
        if (typeof w.titanium === 'function') {
            let p = null;
            try { p = w.titanium({ option }); } catch (err) { console.warn('[wmTitanium] panel', w.id, err); }
            if (!p) return null;
            return Object.assign({ label: lower(w.label || w.id), icon: panelIcon(w.icon) }, p);
        }
        if (rowEl && rowEl.hidden) return null;
        const icon = panelIcon(w.icon);
        if (typeof w.text === 'function') {
            let text = '';
            try { text = String(w.text() || ''); } catch (_) { text = ''; }
            if (!text) return null;
            return { label: lower(w.label || w.id), icon, pages: [{ title: w.label || w.id, line2: text }], onTap: w.onTap };
        }
        // a block: the lines it drew in its (hidden) Today row
        const lines = [];
        if (rowEl) {
            const walk = (el) => {
                for (const n of el.childNodes) {
                    if (n.nodeType === 3) { const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (t) lines.push(t); }
                    else if (n.nodeType === 1 && !n.hidden) walk(n);
                }
            };
            walk(rowEl);
        }
        if (!lines.length) return null;
        return { label: lower(w.label || w.id), icon, pages: [{ title: lines[0], line2: lines[1] || '', line3: lines[2] || '' }], onTap: () => { const b = rowEl && rowEl.querySelector('button, [role="button"]'); if (b) b.click(); else if (rowEl) rowEl.click(); } };
    }

    // with no order chosen in Settings the panels follow 6.5's own (wmShell.todayOrder65): the
    // clock is home, in the middle of the list, the places above it and what arrives below

    function buildPanels() {
        const st = sh.todayState() || {};
        const defs = new Map(sh.todayItemDefs().map((w) => [w.id, w]));
        const rows = [...page.querySelectorAll(':scope > [data-row]')];
        let ids = rows.filter((r) => !r.classList.contains('wm-today-off')).map((r) => r.dataset.row);
        if (!storedItems()) ids = sh.todayOrder65(ids);
        const out = [];
        for (const id of ids) {
            const rowEl = rows.find((r) => r.dataset.row === id);
            const w = defs.get(id);
            let p = null;
            if (w) p = widgetPanel(w, rowEl);
            else if (!(rowEl && rowEl.hidden && id !== 'prints' && id !== 'tasks' && id !== 'messages')) p = builtin(id, st, rowEl);
            else p = null;
            if (!p || !Array.isArray(p.pages) || !p.pages.length) continue;
            p.id = id;
            out.push(p);
        }
        // the date row switched off: the connection still needs a place
        if (!out.some((p) => p.clock) && ids.includes('connection') && st.connection) {
            out.unshift({ id: 'connection', label: 'connection', icon: 'ti-2603', pages: [{ title: st.connection.text }] });
        }
        return out;
    }

    // ---------------------------------------------------------------- drawing

    function unit() {
        return parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
    }

    function build() {
        host = document.createElement('div');
        host.className = 'wm-ti';
        host.innerHTML = `<div class="wm-ti-list"></div>
            <div class="wm-ti-band" aria-hidden="true"></div>
            <div class="wm-ti-focus">
                <button type="button" class="wm-ti-arrow" data-dir="-1" aria-label="Previous" hidden></button>
                <button type="button" class="wm-ti-arrow" data-dir="1" aria-label="Next" hidden></button>
                <div class="wm-ti-exp"></div>
            </div>`;
        host.querySelector('.wm-ti-band').style.backgroundImage = artImageSet('ti-3000');
        host.querySelectorAll('.wm-ti-arrow').forEach((b) => {
            const id = b.dataset.dir === '1' ? 'ti-3601' : 'ti-3600';
            b.style.backgroundImage = artImageSet(id);
            b.addEventListener('click', (e) => { e.stopPropagation(); turnPage(Number(b.dataset.dir)); });
        });
        bindPointer();
        page.appendChild(host);
    }

    function focusTop() {
        // centred in the list: (height - 140) / 2 in VGA pixels
        const u = unit();
        return Math.round(((host.clientHeight / u) - BAND) / 2 * 2) / 2;
    }

    function drawRows() {
        const list = host.querySelector('.wm-ti-list');
        const have = new Map([...list.children].map((el) => [el.dataset.id, el]));
        panels.forEach((p) => {
            let el = have.get(p.id);
            if (!el) {
                el = document.createElement('div');
                el.className = 'wm-ti-row';
                el.dataset.id = p.id;
                el.innerHTML = '<span class="wm-ti-label"></span><span class="wm-ti-count"></span>';
                list.appendChild(el);
            }
            have.delete(p.id);
            const l = el.firstElementChild;
            const c = el.lastElementChild;
            if (l.textContent !== p.label) l.textContent = p.label;
            if (c.textContent !== (p.count || '')) c.textContent = p.count || '';
        });
        have.forEach((el) => el.remove());
    }

    /** Place every row for the list position `pos` (rows) around the band. */
    function place() {
        const top = focusTop();
        const list = host.querySelector('.wm-ti-list');
        const e = (pos - sel) * ROW;
        const rest = !dragging && !settle;
        host.style.setProperty('--wm-ti-top', String(top));
        host.classList.toggle('is-rest', rest);
        panels.forEach((p, i) => {
            const el = list.querySelector(`[data-id="${CSS.escape(p.id)}"]`);
            if (!el) return;
            let y;
            if (i < sel) y = top - ROW * (sel - i) - e;
            else if (i > sel) y = top + BAND + ROW * (i - sel - 1) - e;
            else y = top + (BAND - ROW) / 2;
            el.style.transform = `translate3d(0, calc(${y} * var(--wm-px)), 0)`;
            el.classList.toggle('is-sel', i === sel);
            const d = Math.abs(i - sel);
            el.dataset.far = rest ? String(Math.min(d, 3)) : '0';
        });
    }

    function lineHtml(cls, text) {
        return text ? `<div class="wm-ti-line ${cls}">${esc(text)}</div>` : '';
    }

    /** One page of a panel as markup (positions are the layout's, inside the 480 x 164 expanded box). */
    function pageHtml(p, pg) {
        const icon = pg.icon || p.icon;
        const iconHtml = icon ? `<img class="wm-ti-icon" src="${esc(artUrl(icon))}" srcset="${esc(artSet(icon))}" alt="" draggable="false">` : '';
        if (p.clock) {
            return `${iconHtml}<div class="wm-ti-time">${esc(pg.time)}</div><div class="wm-ti-ampm">${esc(pg.ampm)}</div>
                <div class="wm-ti-date">${esc(pg.date)}</div><div class="wm-ti-network">${esc(pg.network)}</div>`;
        }
        const lines = [pg.title, pg.line2, pg.line3].filter(Boolean).length;
        const pic = pg.image ? `<span class="wm-ti-pic" style="background-image:url('${esc(pg.image)}')"></span>` : '';
        const small = !pg.image && pg.smallIcon ? `<img class="wm-ti-small" src="${esc(artUrl(pg.smallIcon))}" srcset="${esc(artSet(pg.smallIcon))}" alt="" draggable="false">` : '';
        return `${iconHtml}<div class="wm-ti-text" data-lines="${lines}"${pg.image ? ' data-pic="1"' : ''}${small ? ' data-small="1"' : ''}>${pic}${small}
            ${lineHtml('is-1', pg.title)}${lineHtml('is-2', pg.line2)}${lineHtml('is-3', pg.line3)}</div>`;
    }

    function pageIndex(p) {
        const at = pageAt.get(p.id) || 0;
        return at < p.pages.length ? at : 0;
    }

    let expKey = '';
    function drawExpanded() {
        const p = panels[sel];
        const exp = host.querySelector('.wm-ti-exp');
        if (!p) { exp.innerHTML = ''; expKey = ''; return; }
        const n = p.pages.length;
        const at = pageIndex(p);
        const pg = p.pages[at];
        const key = JSON.stringify([p.id, p.icon, at, n, pg.time, pg.ampm, pg.date, pg.network, pg.title, pg.line2, pg.line3, pg.image, pg.smallIcon, pg.icon]);
        host.querySelectorAll('.wm-ti-arrow').forEach((a) => { a.hidden = n < 2; });
        if (slide.active || key === expKey) return; // a page on its way keeps what it shows
        expKey = key;
        exp.innerHTML = `<div class="wm-ti-pg">${pageHtml(p, pg)}</div>`;
        // the pages either side slide in with their picture already loaded
        if (n > 1) for (const d of [1, -1]) { const im = p.pages[(at + d + n) % n].image; if (im) { const pre = new Image(); pre.decoding = 'async'; pre.src = im; } }
    }

    // Left / right on a panel with pages (emulator, "getting started", sampled every 15-40 px): after
    // 45 px of travel the page, its text and its icon, follows the finger 1:1 and the next one follows
    // a screen width behind (the pages go round); the arrows are gone while it moves; let go past half
    // the width and it carries on to the next page, short of it the page slides back.
    const slide = { active: false, dir: 0, x: 0, raf: 0 };

    function slideBegin(dir) {
        const p = panels[sel];
        if (!p || p.pages.length < 2) return false;
        const exp = host.querySelector('.wm-ti-exp');
        const cur = exp.querySelector('.wm-ti-pg');
        if (!cur) return false;
        if (slide.active && slide.dir === dir) return true;
        exp.querySelectorAll('.wm-ti-pg.is-next').forEach((el) => el.remove());
        const n = p.pages.length;
        const next = document.createElement('div');
        next.className = 'wm-ti-pg is-next';
        next.innerHTML = pageHtml(p, p.pages[(pageIndex(p) + dir + n) % n]);
        exp.appendChild(next);
        slide.active = true;
        slide.dir = dir;
        host.classList.add('is-sliding');
        return true;
    }

    /** x: how far the page has moved, px (negative = to the left, the next page comes from the right). */
    function slideMove(x) {
        const dir = x < 0 ? 1 : -1;
        if (!slideBegin(dir)) return;
        slide.x = x;
        const exp = host.querySelector('.wm-ti-exp');
        const w = host.clientWidth;
        const cur = exp.querySelector('.wm-ti-pg:not(.is-next)');
        const next = exp.querySelector('.wm-ti-pg.is-next');
        if (cur) cur.style.transform = `translate3d(${x}px, 0, 0)`;
        if (next) next.style.transform = `translate3d(${x + dir * w}px, 0, 0)`;
    }

    /** Finish a slide: on to the next page (commit) or back, eased; then the panel is redrawn. */
    function slideEnd(commit) {
        if (!slide.active) return;
        cancelAnimationFrame(slide.raf);
        const w = host.clientWidth;
        const from = slide.x;
        const dir = slide.dir;
        const to = commit ? -dir * w : 0;
        const ms = Math.max(120, Math.min(320, 320 * Math.abs(to - from) / w));
        const t0 = performance.now();
        const done = () => {
            const p = panels[sel];
            if (commit && p) { const n = p.pages.length; pageAt.set(p.id, (pageIndex(p) + dir + n) % n); }
            slide.active = false;
            slide.x = 0;
            host.classList.remove('is-sliding');
            expKey = '';
            drawExpanded();
            if (commit) sh.refreshSoftKeys(); // a page can bring its own right soft key
        };
        const step = (now) => {
            const k = Math.min(1, (now - t0) / ms);
            const eased = 1 - (1 - k) * (1 - k);
            slideMove(from + (to - from) * eased || (dir > 0 ? -0.01 : 0.01));
            if (k < 1) slide.raf = requestAnimationFrame(step); else done();
        };
        slide.raf = requestAnimationFrame(step);
    }

    /** The arrows and the left / right keys: the same slide, run on its own. */
    function turnPage(dir) {
        const p = panels[sel];
        if (!p || p.pages.length < 2 || slide.active) return;
        if (!slideBegin(dir)) return;
        slide.x = 0;
        slideEnd(true);
    }

    function select(i, animate) {
        i = Math.max(0, Math.min(panels.length - 1, i));
        if (!animate) { cancelAnimationFrame(settle); settle = 0; sel = i; pos = i; place(); drawExpanded(); sh.refreshSoftKeys(); return; }
        settleTo(i);
    }

    /** Ease the list to item `target`, the selection stepping on as each row passes (as a drag does). */
    function settleTo(target) {
        cancelAnimationFrame(settle);
        const sel0 = settle ? -1 : sel; // the item that was in the band when the move began
        const from = pos;
        const dist = target - from;
        if (Math.abs(dist) < 0.001) { settle = 0; sel = target; pos = target; place(); drawExpanded(); sh.refreshSoftKeys(); return; }
        const ms = Math.min(420, 140 + 70 * Math.abs(dist));
        const t0 = performance.now();
        const step = (now) => {
            const k = Math.min(1, (now - t0) / ms);
            const eased = 1 - (1 - k) * (1 - k);
            moveTo(from + dist * eased);
            if (k < 1) { settle = requestAnimationFrame(step); place(); return; }
            settle = 0;
            const moved = sel0 !== target;
            sel = target;
            pos = target;
            place();
            drawExpanded();
            if (moved) zoomIn(); else sh.refreshSoftKeys();
        };
        settle = requestAnimationFrame(step);
        place();
    }

    /**
     * The panel arriving in the band (device: the band is empty while the list slides, then the
     * content grows from about 65 % to full size, the text toward the left edge and the icon toward
     * the right, slowing down, 0.4 - 0.5 s; the right soft key changes only after it). 350 ms here.
     */
    let zoomTimer = 0;
    function zoomIn() {
        clearTimeout(zoomTimer);
        host.classList.remove('is-zoom');
        void host.offsetWidth; // restart the animation
        host.classList.add('is-zoom');
        zoomTimer = setTimeout(() => { host.classList.remove('is-zoom'); sh.refreshSoftKeys(); }, 350);
    }

    /** List position p (rows): the selection moves on once the next item has travelled a whole row. */
    function moveTo(p) {
        pos = Math.max(0, Math.min(panels.length - 1, p));
        while (pos - sel >= 1) sel++;
        while (pos - sel <= -1) sel--;
    }

    function bindPointer() {
        let id = null;
        let y0 = 0;
        let x0 = 0;
        let pos0 = 0;
        let axis = '';   // '' until the travel passes a start distance, then 'y' (the list) or 'x' (the pages)
        let lastY = 0;
        let lastX = 0;
        let lastT = 0;
        let vel = 0;  // rows per ms
        let velX = 0; // px per ms
        let inBand = false;
        host.addEventListener('pointerdown', (e) => {
            if (id != null || (e.pointerType === 'mouse' && e.button !== 0)) return;
            if (e.target.closest('.wm-ti-arrow') || slide.active) return;
            id = e.pointerId;
            y0 = lastY = e.clientY;
            x0 = lastX = e.clientX;
            lastT = e.timeStamp;
            vel = 0;
            velX = 0;
            axis = '';
            cancelAnimationFrame(settle);
            settle = 0;
            pos0 = pos;
            const top = focusTop();
            const y = (e.clientY - host.getBoundingClientRect().top) / unit();
            inBand = y >= top && y < top + BAND;
        });
        host.addEventListener('pointermove', (e) => {
            if (e.pointerId !== id) return;
            const u = unit();
            const dy = (e.clientY - y0) / u;
            const dx = (e.clientX - x0) / u;
            if (!axis) {
                const p = panels[sel];
                if (inBand && p && p.pages.length > 1 && Math.abs(dx) >= SLIDE_START && Math.abs(dx) > Math.abs(dy)) axis = 'x';
                else if (Math.abs(dy) >= DRAG_START) { axis = 'y'; dragging = true; }
                else return;
                try { host.setPointerCapture(id); } catch (_) { /* capture is a nicety */ }
            }
            const dt = e.timeStamp - lastT;
            if (axis === 'x') {
                if (dt > 0) { velX = 0.7 * velX + 0.3 * ((e.clientX - lastX) / dt); lastX = e.clientX; lastT = e.timeStamp; }
                // the page starts where the finger is once the start distance is passed
                const x = (dx - Math.sign(dx) * SLIDE_START) * u;
                slideMove(x || (dx < 0 ? -0.01 : 0.01));
                return;
            }
            if (dt > 0) { vel = 0.7 * vel + 0.3 * (-(e.clientY - lastY) / u / ROW / dt); lastY = e.clientY; lastT = e.timeStamp; }
            moveTo(pos0 - dy / ROW);
            place();
        });
        const end = (e) => {
            if (e.pointerId !== id) return;
            id = null;
            if (!axis) {
                if (e.type === 'pointerup') tap(e);
                return;
            }
            if (axis === 'x') {
                // past half the width, or a flick the way the page is going
                const w = host.clientWidth;
                const flick = e.timeStamp - lastT < 80 && Math.abs(velX) > 0.5 && Math.sign(velX) === Math.sign(slide.x);
                slideEnd(e.type === 'pointerup' && (Math.abs(slide.x) > w / 2 || flick));
                return;
            }
            dragging = false;
            // a flick carries on (about a fifth of a second of its speed), then the nearest item
            const carry = e.timeStamp - lastT < 80 ? vel * 180 : 0;
            settleTo(Math.max(0, Math.min(panels.length - 1, Math.round(pos + carry))));
        };
        host.addEventListener('pointerup', end);
        host.addEventListener('pointercancel', end);
    }

    function tap(e) {
        const u = unit();
        const r = host.getBoundingClientRect();
        const y = (e.clientY - r.top) / u;
        const top = focusTop();
        if (y >= top && y < top + BAND) {
            const p = panels[sel];
            const pg = p && p.pages[pageIndex(p)];
            const act = (pg && pg.onTap) || (p && p.onTap);
            if (typeof act === 'function') { try { act(pg); } catch (err) { console.warn('[wmTitanium] tap', p.id, err); } }
            return;
        }
        const i = y < top ? sel - Math.ceil((top - y) / ROW) : sel + 1 + Math.floor((y - top - BAND) / ROW);
        if (i >= 0 && i < panels.length && i !== sel) select(i, true);
    }

    function onKey(e) {
        if (!host || sh.current !== 'today' || !page.classList.contains('is-titanium')) return;
        const t = e.target;
        if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (document.querySelector('#wmShell .wm-popup:not([hidden]), #wmShell .wm-msgbox-layer:not([hidden])')) return;
        if (e.key === 'ArrowDown') { select(sel + 1, true); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { select(sel - 1, true); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { turnPage(-1); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { turnPage(1); e.preventDefault(); }
        else if (e.key === 'Enter') { const p = panels[sel]; if (p && typeof p.onTap === 'function') { p.onTap(p.pages[pageIndex(p)]); e.preventDefault(); } }
    }

    // ---------------------------------------------------------------- the Today view

    const view = {
        refresh(todayPage) {
            page = todayPage;
            const on = enabled();
            page.classList.toggle('is-titanium', on);
            if (!on) { if (host) host.hidden = true; return; }
            if (!host) build();
            host.hidden = false;
            if (dragging || settle) return; // the list is moving: the next repaint (2 s) takes the new data
            const selId = panels[sel] && panels[sel].id;
            panels = buildPanels();
            const key = panels.map((p) => p.id).join('|');
            if (key !== panelsKey) {
                panelsKey = key;
                let at = panels.findIndex((p) => p.id === selId);
                // the first time: the clock is home, as on 6.5
                if (!homeDone && panels.length) { homeDone = true; at = panels.findIndex((p) => p.clock); }
                sel = Math.max(0, at);
                pos = sel;
            }
            drawRows();
            place();
            drawExpanded();
        },
        softKeys(keys) {
            if (!host || host.hidden) return keys;
            const p = panels[sel];
            const pg = p && p.pages[pageIndex(p)];
            return { left: keys.left, right: (pg && pg.softKey) || (p && p.softKey) || keys.right };
        }
    };

    function init() {
        sh = window.wmShell;
        if (!sh || typeof sh.setTodayView !== 'function') return;
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', () => { if (host && !host.hidden) place(); });
        sh.setTodayView(view);
    }

    window.wmTitanium = { enabled, select: (i) => select(i, true), panels: () => panels.map((p) => ({ id: p.id, label: p.label, pages: p.pages.length })), selected: () => sel };

    if (window.wmShell) init();
    else document.addEventListener('wmShellReady', init, { once: true });
})();
