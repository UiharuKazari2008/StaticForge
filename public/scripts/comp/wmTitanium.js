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
 *   - soft keys: left the Today key, right the panel's own (Set, Compose, Messaging, Library ...)
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
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // wm65 art by name ('ti-2051'); 's:owner' / 'x:app-studio-lg' = a 6.5 Start icon / a 6.1 set
    // icon in the panel icons' frame with their mirror image (ti-s-*, ti-x-*: made for the items 6.5
    // has no panel art for); or a path
    const artUrl = (name, scale) => {
        const n = String(name || '');
        if (n.startsWith('/')) return n;
        const file = n.startsWith('x:') ? `ti-x-${n.slice(2)}` : n.startsWith('s:') ? `ti-s-${n.slice(2)}` : n;
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
        try { const v = JSON.parse(localStorage.getItem('wmTodayItems') || 'null'); return Array.isArray(v) ? v : null; } catch (_) { return null; }
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
            const n = st.mailUnread;
            return {
                label: 'e-mail', count: n ? String(n) : '', icon: 'ti-2008',
                pages: [n ? { title: 'Dovecote', line2: `${n} Unread` } : { title: 'No New E-mails' }],
                softKey: { label: 'Messaging', action: () => sh.open('messaging') },
                onTap: () => sh.open('messaging')
            };
        }
        if (id === 'tasks') {
            return { label: 'tasks', icon: 's:tasks', pages: [{ title: st.tasks || 'No tasks' }], softKey: { label: 'Pictures', action: () => sh.open('gallery') }, onTap: () => sh.open('gallery') };
        }
        if (id === 'search') {
            return { label: 'search', icon: 's:search', pages: [{ title: 'Search pictures' }], softKey: { label: 'Search', action: () => searchPictures() }, onTap: () => searchPictures() };
        }
        if (id === 'workspace') {
            const menu = () => (typeof st.workspaceMenu === 'function' ? st.workspaceMenu() : []);
            return { label: 'workspace', icon: 's:fileexp', pages: [{ title: st.workspace || 'Workspace' }], softKey: { label: 'Change', menu }, onTap: () => sh.menu('right', menu(), null) };
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
        if (/^(ti-|s:|x:)/.test(n)) return n;
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

    // 6.5 keeps pictures and the phone items above the clock and the message items under it; with
    // no order chosen in Settings the panels follow that (pictures, workspace, tasks | clock | ...)
    const ABOVE_HOME = ['prints', 'workspace', 'tasks'];

    function buildPanels() {
        const st = sh.todayState() || {};
        const defs = new Map(sh.todayItemDefs().map((w) => [w.id, w]));
        const rows = [...page.querySelectorAll(':scope > [data-row]')];
        let ids = rows.filter((r) => !r.classList.contains('wm-today-off')).map((r) => r.dataset.row);
        if (!storedItems()) {
            const above = ABOVE_HOME.filter((id) => ids.includes(id));
            ids = above.concat(ids.filter((id) => !above.includes(id)));
            if (ids.includes('date')) { ids = ids.filter((id) => id !== 'date'); ids.splice(above.length, 0, 'date'); }
        }
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

    let expKey = '';
    function drawExpanded() {
        const p = panels[sel];
        const exp = host.querySelector('.wm-ti-exp');
        if (!p) { exp.innerHTML = ''; expKey = ''; return; }
        const n = p.pages.length;
        let at = pageAt.get(p.id) || 0;
        if (at >= n) at = 0;
        const pg = p.pages[at];
        const key = JSON.stringify([p.id, p.icon, at, n, pg.time, pg.ampm, pg.date, pg.network, pg.title, pg.line2, pg.line3, pg.image, pg.smallIcon, pg.icon]);
        const arrows = host.querySelectorAll('.wm-ti-arrow');
        arrows.forEach((a) => { a.hidden = n < 2; });
        if (key === expKey) return;
        expKey = key;
        const icon = pg.icon || p.icon;
        const iconHtml = icon ? `<img class="wm-ti-icon" src="${esc(artUrl(icon))}" srcset="${esc(artSet(icon))}" alt="" draggable="false">` : '';
        let body;
        if (p.clock) {
            body = `<div class="wm-ti-time">${esc(pg.time)}</div><div class="wm-ti-ampm">${esc(pg.ampm)}</div>
                <div class="wm-ti-date">${esc(pg.date)}</div><div class="wm-ti-network">${esc(pg.network)}</div>`;
        } else {
            const lines = [pg.title, pg.line2, pg.line3].filter(Boolean).length;
            const pic = pg.image ? `<span class="wm-ti-pic" style="background-image:url('${esc(pg.image)}')"></span>` : '';
            const small = !pg.image && pg.smallIcon ? `<img class="wm-ti-small" src="${esc(artUrl(pg.smallIcon))}" srcset="${esc(artSet(pg.smallIcon))}" alt="" draggable="false">` : '';
            body = `<div class="wm-ti-text" data-lines="${lines}"${pg.image ? ' data-pic="1"' : ''}${small ? ' data-small="1"' : ''}>${pic}${small}
                ${lineHtml('is-1', pg.title)}${lineHtml('is-2', pg.line2)}${lineHtml('is-3', pg.line3)}</div>`;
        }
        exp.innerHTML = iconHtml + body;
    }

    function turnPage(dir) {
        const p = panels[sel];
        if (!p || p.pages.length < 2) return;
        const n = p.pages.length;
        pageAt.set(p.id, ((pageAt.get(p.id) || 0) + dir + n) % n);
        drawExpanded();
    }

    function select(i, animate) {
        i = Math.max(0, Math.min(panels.length - 1, i));
        if (!animate) { cancelAnimationFrame(settle); settle = 0; sel = i; pos = i; place(); drawExpanded(); sh.refreshSoftKeys(); return; }
        settleTo(i);
    }

    /** Ease the list to item `target`, the selection stepping on as each row passes (as a drag does). */
    function settleTo(target) {
        cancelAnimationFrame(settle);
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
            sel = target;
            pos = target;
            place();
            drawExpanded();
            sh.refreshSoftKeys();
        };
        settle = requestAnimationFrame(step);
        place();
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
        let moved = false;
        let lastY = 0;
        let lastT = 0;
        let vel = 0; // rows per ms
        host.addEventListener('pointerdown', (e) => {
            if (id != null || (e.pointerType === 'mouse' && e.button !== 0)) return;
            if (e.target.closest('.wm-ti-arrow')) return;
            id = e.pointerId;
            y0 = lastY = e.clientY;
            x0 = e.clientX;
            lastT = e.timeStamp;
            vel = 0;
            moved = false;
            cancelAnimationFrame(settle);
            settle = 0;
            pos0 = pos;
        });
        host.addEventListener('pointermove', (e) => {
            if (e.pointerId !== id) return;
            const u = unit();
            const dy = (e.clientY - y0) / u;
            if (!moved) {
                if (Math.abs(dy) < DRAG_START) return;
                moved = true;
                dragging = true;
                try { host.setPointerCapture(id); } catch (_) { /* capture is a nicety */ }
            }
            const dt = e.timeStamp - lastT;
            if (dt > 0) { vel = 0.7 * vel + 0.3 * (-(e.clientY - lastY) / u / ROW / dt); lastY = e.clientY; lastT = e.timeStamp; }
            moveTo(pos0 - dy / ROW);
            place();
        });
        const end = (e) => {
            if (e.pointerId !== id) return;
            id = null;
            if (!moved) {
                if (e.type === 'pointerup') tap(e, x0);
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

    function tap(e, x0) {
        const u = unit();
        const r = host.getBoundingClientRect();
        const y = (e.clientY - r.top) / u;
        const top = focusTop();
        if (y >= top && y < top + BAND) {
            // a swipe across the band turns the panel's page; a tap opens it
            const dx = (e.clientX - x0) / u;
            if (Math.abs(dx) > DRAG_START) { turnPage(dx < 0 ? 1 : -1); return; }
            const p = panels[sel];
            if (p && typeof p.onTap === 'function') { try { p.onTap(p.pages[pageAt.get(p.id) || 0]); } catch (err) { console.warn('[wmTitanium] tap', p.id, err); } }
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
        else if (e.key === 'Enter') { const p = panels[sel]; if (p && typeof p.onTap === 'function') { p.onTap(p.pages[pageAt.get(p.id) || 0]); e.preventDefault(); } }
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
            return { left: keys.left, right: (p && p.softKey) || keys.right };
        }
    };

    function init() {
        sh = window.wmShell;
        if (!sh || typeof sh.setTodayView !== 'function') return;
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', () => { if (host && !host.hidden) place(); });
        sh.setTodayView(view);
    }

    window.wmTitanium = { enabled, select: (i) => select(i, true), panels: () => panels.map((p) => ({ id: p.id, label: p.label })), selected: () => sel };

    if (window.wmShell) init();
    else document.addEventListener('wmShellReady', init, { once: true });
})();
