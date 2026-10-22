/**
 * The desktop's icon view, 1:1 with Vista's (Yukimi 2026-10-21: "for the desktop we want the copy
 * vistas desktop settings and also its icon selection 1:1, we also want to be able to reorder icons
 * that are in the grid. we also want the icon size option"). Measured on the Vista Aero VM
 * (1920x1200, the desktop ListView read with LVM_GETITEMRECT):
 *
 *   View      Large Icons (96) / Medium Icons (48, the default) / Classic Icons (32), Auto Arrange,
 *             Align to Grid (on by default), Show Desktop Icons. Ctrl + mouse wheel steps the size
 *             by Vista's ratio: up round(s / 0.9), down round(s * 0.9), 16 to 256. The menu's radio
 *             follows the size: under 48 Classic, under 96 Medium, else Large.
 *   Sort By   Name, Size, Type, Date modified. A new field starts in its own direction (Name and
 *             Type ascending, Size and Date modified newest / largest first); the same field again
 *             reverses it. It arranges the icons once, in columns from the top left.
 *   Cells     Vista fills the work area with whole cells: n = floor(W / m), cell = floor(W / n),
 *             where the least cell width is max(75, 1.04 s + 5.4) and height 1.05 s + 47.85 (fits
 *             every size measured from 16 to 256). An item is the cell wide; its icon box is s + 4
 *             high with the picture 2 px down, the label starts 1 px under it, 15 px lines plus 2,
 *             wrapped at the item width less 2, at most two lines with "..." unless it is the focused
 *             item (then all of it shows).
 *   Arrange   Auto Arrange: the icons fill columns top to bottom in list order; a drop moves the
 *             dragged icons to the cell under the pointer (an insertion mark shows where). Off: every
 *             icon keeps its own place; with Align to Grid a drop snaps to the nearest free cell.
 *
 * Settings live per workspace on the record (`desktopView`, modules/workspace.js) and in
 * localStorage `desktop-view:<id>` until the server stores the field (it needs a restart).
 * Positions and a shortcut's own icon (data.customIcon) are saved with the shortcuts
 * (desktopShortcuts.js). The Desktop Icon Settings and Change Icon dialogs are
 * desktopIconDialogs.js (feature desktop_icon_dialogs).
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const STORAGE_PREFIX = 'desktop-view:';
    const ART = '/static_images/vista-desktop';

    const SIZES = { large: 96, medium: 48, classic: 32 };
    const MIN_SIZE = 16;
    const MAX_SIZE = 256;
    const SORT_FIELDS = ['name', 'size', 'type', 'date'];
    const SORT_FIRST_DIR = { name: 'asc', size: 'desc', type: 'asc', date: 'desc' };

    // Vista's icon files as the Change Icon dialog names them; the sheets are 16 icons a row
    // (extracted from the VM with PrivateExtractIcons at 16, 32, 48 and 96).
    const SHEET_COLS = 16;
    const SHEET_SIZES = [16, 32, 48, 96];
    const ICON_FILES = {
        imageres: { path: 'C:\\Melaton\\System32\\imageres.dll', count: 185 },
        shell32: { path: 'C:\\Melaton\\System32\\shell32.dll', count: 278 },
        NetworkExplorer: { path: 'C:\\Melaton\\System32\\NetworkExplorer.dll', count: 23 },
        app: { path: 'C:\\Program Files\\Melaton\\Melaton.exe' }
    };

    // Desktop Icon Settings, in its order; the icons are each CLSID's DefaultIcon on the VM
    // (imageres -109, -123, -55 / -54, -27 and NetworkExplorer.dll,0 as indexes)
    const SYSTEM_ICONS = [
        { key: 'computer', check: 'Co<u>m</u>puter', label: 'Computer', icon: { file: 'imageres', index: 103 } },
        { key: 'user', check: '<u>U</u>ser\'s Files', label: 'User\'s Files', icon: { file: 'imageres', index: 116 } },
        { key: 'network', check: '<u>N</u>etwork', label: 'Network', icon: { file: 'NetworkExplorer', index: 0 } },
        { key: 'recycle', check: '<u>R</u>ecycle Bin', label: 'Recycle Bin', icon: { file: 'imageres', index: 49 } },
        { key: 'control-panel', check: 'C<u>o</u>ntrol Panel', label: 'Control Panel', icon: { file: 'imageres', index: 21 } }
    ];
    // the list under the check boxes: Control Panel is not in it, the Recycle Bin is there twice
    const SYSTEM_ICON_SLOTS = [
        { slot: 'computer', label: 'Computer', icon: { file: 'imageres', index: 103 } },
        { slot: 'user', label: null, icon: { file: 'imageres', index: 116 } },
        { slot: 'network', label: 'Network', icon: { file: 'NetworkExplorer', index: 0 } },
        { slot: 'recycle-full', label: 'Recycle Bin (full)', icon: { file: 'imageres', index: 48 } },
        { slot: 'recycle-empty', label: 'Recycle Bin (empty)', icon: { file: 'imageres', index: 49 } }
    ];

    const DEFAULTS = {
        size: SIZES.medium,
        autoArrange: false,
        alignToGrid: true,
        showIcons: true,
        sortBy: 'name',
        sortDir: 'asc',
        systemIcons: {}
    };

    // ---- settings -------------------------------------------------------------------------------

    function clampSize(v) {
        const n = Math.round(Number(v));
        return Number.isFinite(n) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, n)) : DEFAULTS.size;
    }

    function normalizeIconRef(ref) {
        if (!ref || typeof ref !== 'object') return null;
        if (ref.file === 'app') {
            return typeof ref.name === 'string' && /^[\w .-]{1,80}\.(png|webp|svg)$/i.test(ref.name) ? { file: 'app', name: ref.name } : null;
        }
        const f = ICON_FILES[ref.file];
        const i = Math.round(Number(ref.index));
        if (!f || !f.count || !Number.isFinite(i) || i < 0 || i >= f.count) return null;
        return { file: ref.file, index: i };
    }

    function normalize(raw) {
        const r = raw && typeof raw === 'object' ? raw : {};
        const systemIcons = {};
        if (r.systemIcons && typeof r.systemIcons === 'object') {
            SYSTEM_ICON_SLOTS.forEach(({ slot }) => {
                const ref = normalizeIconRef(r.systemIcons[slot]);
                if (ref) systemIcons[slot] = ref;
            });
        }
        return {
            size: clampSize(r.size == null ? DEFAULTS.size : r.size),
            autoArrange: r.autoArrange === true,
            alignToGrid: r.alignToGrid !== false,
            showIcons: r.showIcons !== false,
            sortBy: SORT_FIELDS.includes(r.sortBy) ? r.sortBy : DEFAULTS.sortBy,
            sortDir: r.sortDir === 'desc' ? 'desc' : 'asc',
            systemIcons
        };
    }

    function activeWorkspaceId() {
        /* global activeWorkspace */
        return (typeof activeWorkspace !== 'undefined' && activeWorkspace) || root.currentWorkspace || 'default';
    }

    function workspaceRecord(id) {
        /* global workspaces */
        const list = typeof workspaces !== 'undefined' && workspaces ? workspaces : null;
        return list && list[id] ? list[id] : null;
    }

    function readStored(id) {
        try {
            const raw = root.localStorage && root.localStorage.getItem(STORAGE_PREFIX + id);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function writeStored(id, value) {
        try {
            if (root.localStorage) root.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(value));
        } catch (_) { /* quota / private mode */ }
    }

    /** The workspace's view: the record's own, else this browser's copy, else Vista's defaults. */
    function read(id = activeWorkspaceId()) {
        const ws = workspaceRecord(id);
        if (ws && ws.desktopView && typeof ws.desktopView === 'object') return normalize(ws.desktopView);
        return normalize(readStored(id));
    }

    const listeners = new Set();

    function get(id) {
        return read(id || activeWorkspaceId());
    }

    async function persist(id, value) {
        writeStored(id, value);
        const ws = workspaceRecord(id);
        if (ws) ws.desktopView = value;
        const client = root.wsClient;
        if (!client || typeof client.updateWorkspaceSettings !== 'function') return;
        if (typeof client.isConnected === 'function' && !client.isConnected()) return;
        try {
            await client.updateWorkspaceSettings(id, { desktopView: value });
        } catch (err) {
            console.warn('desktopIconView: workspace save failed, kept in this browser', err && err.message);
        }
    }

    /** Merge a change into the workspace's view, save it, and redraw the desktop. */
    function update(patch, id = activeWorkspaceId()) {
        const next = normalize({ ...read(id), ...patch });
        persist(id, next);
        listeners.forEach((fn) => { try { fn(next, id); } catch (e) { console.error(e); } });
        redraw();
        return next;
    }

    function sizeName(size) {
        const s = clampSize(size);
        if (s < SIZES.medium) return 'classic';
        if (s < SIZES.large) return 'medium';
        return 'large';
    }

    function stepSize(size, up) {
        const s = clampSize(size);
        return clampSize(up ? Math.round(s / 0.9) : Math.round(s * 0.9));
    }

    // ---- cells ----------------------------------------------------------------------------------

    /** Vista's cell pitch for icon size s on a w x h work area (see the header). */
    function metrics(size, width, height) {
        const s = clampSize(size);
        const w = Math.max(1, Math.floor(Number(width) || 0));
        const h = Math.max(1, Math.floor(Number(height) || 0));
        const minCx = Math.max(75, 1.04 * s + 5.4);
        const minCy = 1.05 * s + 47.85;
        const cols = Math.max(1, Math.floor(w / minCx));
        const rows = Math.max(1, Math.floor(h / minCy));
        return {
            size: s,
            cx: Math.floor(w / cols),
            cy: Math.floor(h / rows),
            cols,
            rows,
            width: w,
            height: h,
            iconBox: s + 4,
            lineHeight: 15,
            // the label's text wraps at the item less 6 (its rect is the text + 4, 1 px in from the item)
            labelWidth: Math.floor(w / cols) - 6
        };
    }

    function cellIndex(m, col, row) {
        return col * m.rows + row;
    }

    function cellAt(m, index) {
        return { col: Math.floor(index / m.rows), row: index % m.rows };
    }

    /** The cell whose box holds the point (clamped to the work area). */
    function cellFromPoint(m, x, y) {
        const col = Math.min(m.cols - 1, Math.max(0, Math.floor(x / m.cx)));
        const row = Math.min(m.rows - 1, Math.max(0, Math.floor(y / m.cy)));
        return { col, row };
    }

    /** The nearest cell to an item's top left (Align to Grid). */
    function snapCell(m, x, y) {
        const col = Math.min(m.cols - 1, Math.max(0, Math.round(x / m.cx)));
        const row = Math.min(m.rows - 1, Math.max(0, Math.round(y / m.cy)));
        return { col, row };
    }

    /** The free cell nearest to (col,row), searching outward ring by ring, columns first. */
    function nearestFreeCell(m, col, row, taken) {
        const key = (c, r) => `${c},${r}`;
        if (!taken.has(key(col, row))) return { col, row };
        const max = Math.max(m.cols, m.rows);
        for (let d = 1; d <= max; d++) {
            let best = null;
            let bestDist = Infinity;
            for (let c = col - d; c <= col + d; c++) {
                for (let r = row - d; r <= row + d; r++) {
                    if (Math.max(Math.abs(c - col), Math.abs(r - row)) !== d) continue;
                    if (c < 0 || r < 0 || c >= m.cols || r >= m.rows || taken.has(key(c, r))) continue;
                    const dist = (c - col) * (c - col) * m.cx * m.cx + (r - row) * (r - row) * m.cy * m.cy;
                    if (dist < bestDist) { best = { col: c, row: r }; bestDist = dist; }
                }
            }
            if (best) return best;
        }
        return { col, row };
    }

    /** A free icon's top left in this work area: placed ones scale with the area they were placed on. */
    function placedPoint(position, m, legacyPoint) {
        if (position && position.index === 'free') {
            const pw = Number(position.w) > 0 ? Number(position.w) : m.width;
            const ph = Number(position.h) > 0 ? Number(position.h) : m.height;
            const x = (Number(position.x) || 0) * (pw === m.width ? 1 : m.width / pw);
            const y = (Number(position.y) || 0) * (ph === m.height ? 1 : m.height / ph);
            return { x, y };
        }
        return legacyPoint || { x: 0, y: 0 };
    }

    /**
     * Where each icon goes. items: [{ id, position, point? }] in list order (point: a legacy
     * quadrant icon's top left). Returns { order: [id], places: Map id -> { x, y, col, row } }.
     */
    function layout(items, view, m) {
        const places = new Map();
        const listed = items.filter((it) => it.position && it.position.index === 0)
            .sort((a, b) => (Number(a.position.pos) || 0) - (Number(b.position.pos) || 0));
        const placed = items.filter((it) => !(it.position && it.position.index === 0));
        const capacity = m.cols * m.rows;

        if (view.autoArrange) {
            // the list first, then placed icons in column order where they stood
            const ranked = placed.map((it) => {
                const p = placedPoint(it.position, m, it.point);
                const c = snapCell(m, p.x, p.y);
                return { it, rank: cellIndex(m, c.col, c.row) };
            }).sort((a, b) => a.rank - b.rank).map((r) => r.it);
            const order = listed.concat(ranked);
            order.forEach((it, i) => {
                const { col, row } = cellAt(m, Math.min(i, capacity - 1));
                places.set(it.id, { x: col * m.cx, y: row * m.cy, col, row });
            });
            return { order: order.map((it) => it.id), places };
        }

        const taken = new Set();
        const key = (c, r) => `${c},${r}`;
        placed.forEach((it) => {
            const p = placedPoint(it.position, m, it.point);
            if (view.alignToGrid) {
                const want = snapCell(m, p.x, p.y);
                const c = nearestFreeCell(m, want.col, want.row, taken);
                taken.add(key(c.col, c.row));
                places.set(it.id, { x: c.col * m.cx, y: c.row * m.cy, col: c.col, row: c.row });
            } else {
                const x = Math.min(Math.max(0, p.x), Math.max(0, m.width - m.cx));
                const y = Math.min(Math.max(0, p.y), Math.max(0, m.height - m.cy));
                const c = snapCell(m, x, y);
                taken.add(key(c.col, c.row));
                places.set(it.id, { x, y, col: c.col, row: c.row });
            }
        });
        // icons that were never placed fill the free cells in column order, as new ones do on Vista
        let next = 0;
        listed.forEach((it) => {
            while (next < capacity - 1 && taken.has(key(Math.floor(next / m.rows), next % m.rows))) next++;
            const { col, row } = cellAt(m, next);
            taken.add(key(col, row));
            places.set(it.id, { x: col * m.cx, y: row * m.cy, col, row });
            next++;
        });
        return { order: listed.concat(placed).map((it) => it.id), places };
    }

    /** Auto Arrange: the list index a drop at (x,y) inserts before, and the mark's line. */
    function insertionAt(m, x, y, count) {
        const c = cellFromPoint(m, x, y);
        const index = Math.min(count, cellIndex(m, c.col, c.row));
        const at = cellAt(m, index);
        return { index, x: at.col * m.cx, y: at.row * m.cy, width: m.cx };
    }

    // ---- sorting --------------------------------------------------------------------------------

    const SYSTEM_ORDER = ['computer', 'user', 'network', 'recycle', 'control-panel'];

    function sortGroup(sc) {
        const key = sc && sc.data && sc.data.desktopIcon;
        if (key || (sc && sc.type === 'system-folder' && sc.data && sc.data.systemKey === 'trash')) return 0;
        if (sc && (sc.type === 'folder' || sc.type === 'system-folder')) return 1;
        return 2;
    }

    function systemRank(sc) {
        const key = (sc.data && sc.data.desktopIcon) || (sc.data && sc.data.systemKey === 'trash' ? 'recycle' : '');
        const i = SYSTEM_ORDER.indexOf(key);
        return i < 0 ? SYSTEM_ORDER.length : i;
    }

    /** What Explorer's Type column would call this shortcut. */
    function typeName(sc) {
        switch (sc && sc.type) {
            case 'folder': return 'File Folder';
            case 'system-folder': return 'System Folder';
            case 'image': return 'Image';
            case 'note': return 'Text Document';
            case 'reference': return 'Reference';
            case 'applet':
            case 'dsap':
            case 'remote-desktop': return 'Shortcut';
            case 'web-page':
            case 'wiki-page':
            case 'static-wiki-page': return 'Internet Shortcut';
            default: return String((sc && sc.type) || 'File').replace(/(^|-)(\w)/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase());
        }
    }

    function sortValue(sc, field) {
        const d = (sc && sc.data) || {};
        switch (field) {
            case 'size': return Number(d.size || d.fileSize || d.bytes || 0);
            case 'type': return typeName(sc).toLowerCase();
            case 'date': return Date.parse(sc.updatedAt || d.modified || d.updatedAt || sc.createdAt || 0) || 0;
            default: return String(sc.name || '').toLowerCase();
        }
    }

    function compareNames(a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
    }

    /** Vista's order for a Sort By: system icons, folders, files; descending reverses all of it. */
    function sortShortcuts(list, field, dir) {
        const out = list.slice().sort((a, b) => {
            const g = sortGroup(a) - sortGroup(b);
            if (g) return g;
            if (sortGroup(a) === 0) return systemRank(a) - systemRank(b);
            const va = sortValue(a, field);
            const vb = sortValue(b, field);
            if (field !== 'name') {
                const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
                if (c) return c;
            }
            return compareNames(a, b);
        });
        return dir === 'desc' ? out.reverse() : out;
    }

    /** The next Sort By state when the user picks a field. */
    function nextSort(view, field) {
        if (view.sortBy === field) return { sortBy: field, sortDir: view.sortDir === 'asc' ? 'desc' : 'asc' };
        return { sortBy: field, sortDir: SORT_FIRST_DIR[field] || 'asc' };
    }

    // ---- icons ----------------------------------------------------------------------------------

    function sheetSizeFor(px) {
        const want = Math.max(1, Math.round(px * (root.devicePixelRatio || 1)));
        for (let i = 0; i < SHEET_SIZES.length; i++) {
            if (SHEET_SIZES[i] >= want) return SHEET_SIZES[i];
        }
        return SHEET_SIZES[SHEET_SIZES.length - 1];
    }

    /** Background for icon `index` of a sheet file drawn at px. */
    function spriteStyle(ref, px) {
        const f = ICON_FILES[ref.file];
        if (!f || !f.count) return null;
        const sheet = sheetSizeFor(px);
        const rows = Math.ceil(f.count / SHEET_COLS);
        const col = ref.index % SHEET_COLS;
        const row = Math.floor(ref.index / SHEET_COLS);
        return {
            backgroundImage: `url('${ART}/${ref.file}-${sheet}.webp')`,
            backgroundSize: `${SHEET_COLS * px}px ${rows * px}px`,
            backgroundPosition: `${-col * px}px ${-row * px}px`
        };
    }

    /** An icon element for an icon reference, drawn at px (the desktop's size, or a dialog's 32). */
    function iconElement(ref, px, className = 'desktop-shortcut-icon') {
        const el = doc.createElement('div');
        el.className = `${className} desktop-icon-custom`;
        el.style.setProperty('--desktop-icon-px', `${px}px`);
        if (ref && ref.file === 'app') {
            const img = doc.createElement('img');
            img.className = 'icon-image';
            img.alt = '';
            img.draggable = false;
            // resolveAppIconPath / buildAppIconSrcset: public/scripts/comp/modalUtils.js
            img.src = typeof resolveAppIconPath === 'function' ? resolveAppIconPath(ref.name) : `/static_images/app_icons/${ref.name}`;
            if (typeof buildAppIconSrcset === 'function') {
                const srcset = buildAppIconSrcset(ref.name);
                if (srcset) { img.setAttribute('srcset', srcset); img.setAttribute('sizes', `${px}px`); }
            }
            el.appendChild(img);
            return el;
        }
        const s = ref ? spriteStyle(ref, px) : null;
        if (s) {
            const pic = doc.createElement('span');
            pic.className = 'desktop-icon-sprite';
            // as variables too, so a selection tint can mask itself with the picture
            pic.style.setProperty('--sprite-image', s.backgroundImage);
            pic.style.setProperty('--sprite-size', s.backgroundSize);
            pic.style.setProperty('--sprite-pos', s.backgroundPosition);
            el.appendChild(pic);
        }
        return el;
    }

    /** Every app picture the shell knows (Start menu entries and window icons), for Change Icon. */
    function appIconNames() {
        const names = new Set();
        try {
            /* global startMenuLaunchables, MODAL_APPLICATION_ICONS */
            if (typeof startMenuLaunchables !== 'undefined' && Array.isArray(startMenuLaunchables)) {
                startMenuLaunchables.forEach((l) => { if (l && typeof l.imageIcon === 'string' && /\.png$/i.test(l.imageIcon)) names.add(l.imageIcon); });
            }
            if (typeof MODAL_APPLICATION_ICONS !== 'undefined' && MODAL_APPLICATION_ICONS) {
                Object.values(MODAL_APPLICATION_ICONS).forEach((n) => { if (typeof n === 'string' && /\.png$/i.test(n)) names.add(n); });
            }
        } catch (_) { /* not loaded */ }
        return [...names].sort((a, b) => a.localeCompare(b));
    }

    /** The default icon of a system slot ('computer', 'recycle-full', ...). */
    function systemSlotDefault(slot) {
        const s = SYSTEM_ICON_SLOTS.find((x) => x.slot === slot);
        return s ? s.icon : null;
    }

    /** The icon a system slot shows in this workspace (its own pick, else Vista's). */
    function systemSlotIcon(slot, view = get()) {
        return (view.systemIcons && view.systemIcons[slot]) || systemSlotDefault(slot);
    }

    // ---- labels ---------------------------------------------------------------------------------

    // Segoe UI 9 pt's GDI advance widths for ' ' to '~' (GetCharWidth32 on the VM): Vista measures
    // labels with whole pixels, and the cuts fall where these sums say. Other characters use the
    // browser's width, rounded.
    const SEGOE_9PT = [3, 3, 5, 7, 6, 10, 10, 3, 4, 4, 5, 8, 3, 5, 3, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 3, 3, 8, 8, 8, 5,
        11, 8, 7, 8, 8, 6, 6, 8, 9, 3, 4, 7, 6, 11, 9, 9, 7, 9, 7, 6, 7, 8, 7, 11, 7, 7, 7, 4, 5, 4, 8, 5,
        3, 6, 7, 6, 7, 6, 4, 7, 7, 3, 3, 6, 3, 11, 7, 7, 7, 7, 4, 5, 4, 7, 6, 9, 5, 6, 5, 4, 3, 4, 8];

    let measureCtx = null;
    let measureFont = '';
    const glyphCache = new Map();

    function glyphWidth(ch, font) {
        const c = ch.codePointAt(0);
        if (c >= 32 && c <= 126) return SEGOE_9PT[c - 32];
        const key = `${font}|${ch}`;
        if (glyphCache.has(key)) return glyphCache.get(key);
        let w = 12;
        if (doc) {
            if (!measureCtx) measureCtx = doc.createElement('canvas').getContext('2d');
            if (measureFont !== font) { measureCtx.font = font; measureFont = font; }
            w = Math.round(measureCtx.measureText(ch).width);
        }
        glyphCache.set(key, w);
        return w;
    }

    function textWidth(text, font) {
        let w = 0;
        for (const ch of String(text || '')) w += glyphWidth(ch, font);
        return w;
    }

    /**
     * Lines as DrawText(DT_WORDBREAK | DT_EDITCONTROL) breaks them at `width`: between words, and
     * inside a word that is wider than the line. Each line: { text, start } (start: its offset).
     */
    function wrapLines(text, width, font) {
        const s = String(text || '');
        const lines = [];
        let i = 0;
        while (i < s.length) {
            while (i < s.length && s[i] === ' ' && lines.length) i++;
            if (i >= s.length) break;
            let end = i;
            let lastBreak = -1;
            let w = 0;
            while (end < s.length) {
                const cw = glyphWidth(s[end], font);
                if (w + cw > width && end > i) break;
                if (s[end] === ' ') lastBreak = end;
                w += cw;
                end++;
            }
            if (end < s.length && s[end] !== ' ' && lastBreak > i) end = lastBreak;
            lines.push({ text: s.slice(i, end).replace(/ +$/, ''), start: i });
            i = end;
        }
        return lines.length ? lines : [{ text: '', start: 0 }];
    }

    /**
     * The label as Vista's list view prints it (measured on the VM): wrapped at `width` (the item
     * less 6), as wide as its widest line; unfocused it keeps two lines and the second one is cut to
     * that width with "..." (a space before it stays). Returns { lines, all, cut, width }.
     */
    function clampLabel(text, width, font, maxLines = 2) {
        const s = String(text || '');
        const wrapped = wrapLines(s, width, font);
        const all = wrapped.map((l) => l.text);
        const widest = Math.max(0, ...all.map((l) => textWidth(l, font)));
        if (wrapped.length <= maxLines) return { lines: all, all, cut: false, width: widest };
        const lines = all.slice(0, maxLines - 1);
        const rest = s.slice(wrapped[maxLines - 1].start);
        let last = '';
        for (const ch of rest) {
            if (textWidth(`${last}${ch}...`, font) > widest) break;
            last += ch;
        }
        lines.push(`${last}...`);
        return { lines, all, cut: true, width: widest };
    }

    // ---- the desktop ----------------------------------------------------------------------------

    function container() {
        return doc ? doc.getElementById('desktopIcons') : null;
    }

    function manager() {
        /* global desktopShortcuts */
        return typeof desktopShortcuts !== 'undefined' && desktopShortcuts ? desktopShortcuts : null;
    }

    function redraw() {
        const m = manager();
        if (m && typeof m.renderShortcuts === 'function' && m.currentWorkspace) m.renderShortcuts();
        else applyContainer();
    }

    /** The container's view attributes and cell variables (desktop-icon-view.css). */
    function applyContainer(view = get(), met = null) {
        const box = container();
        if (!box) return null;
        const r = box.getBoundingClientRect();
        const mm = met || metrics(view.size, r.width, r.height);
        box.dataset.iconView = sizeName(view.size);
        box.classList.toggle('desktop-icons-hidden', !view.showIcons);
        box.style.setProperty('--di-size', `${mm.size}px`);
        box.style.setProperty('--di-cx', `${mm.cx}px`);
        box.style.setProperty('--di-cy', `${mm.cy}px`);
        return mm;
    }

    /** Desktop focus: the icons draw Vista's focused selection only while the desktop has it. */
    function wireFocus() {
        const box = container();
        if (!box || box.dataset.focusWired) return;
        box.dataset.focusWired = '1';
        doc.addEventListener('pointerdown', (ev) => {
            const inside = !!(ev.target && ev.target.closest && ev.target.closest('#desktopIcons'));
            if ((box.dataset.focused === '1') !== inside) box.dataset.focused = inside ? '1' : '0';
        }, true);
    }

    /** Ctrl + wheel over the desktop resizes the icons, as on Vista. */
    function wireWheel() {
        const box = container();
        if (!box || box.dataset.wheelWired) return;
        box.dataset.wheelWired = '1';
        box.addEventListener('wheel', (ev) => {
            if (!ev.ctrlKey || !ev.deltaY) return;
            ev.preventDefault();
            const view = get();
            const next = stepSize(view.size, ev.deltaY < 0);
            if (next !== view.size) update({ size: next });
        }, { passive: false });
    }

    // ---- the desktop's menu ---------------------------------------------------------------------

    function clipboardHasItems() {
        if (localStorage.getItem('userType') === 'readonly') return false;
        /* global explorerApplet */
        return !!(typeof explorerApplet !== 'undefined' && explorerApplet && explorerApplet.clipboard);
    }

    /** Vista's desktop menu (contextMenu.js config): View, Sort By, Refresh, Paste, New, Personalize. */
    function desktopMenuConfig() {
        const radio = (text, size) => ({
            text, action: 'desktop-view-size', value: size, showIndicator: true, indicatorMark: 'radio',
            loadfn: (item) => { item.checked = sizeName(get().size) === sizeName(size); }
        });
        const check = (text, key, action) => ({
            text, action, showIndicator: true, indicatorMark: 'check',
            loadfn: (item) => { item.checked = !!get()[key]; }
        });
        return {
            // Vista opens View / Sort By / New under the pointer
            openSubmenusOnHover: true,
            beforeShow: () => {
                if (typeof explorerApplet !== 'undefined' && explorerApplet) explorerApplet._contextMenuTarget = null;
            },
            sections: [{
                type: 'list',
                items: [
                    {
                        text: 'View',
                        submenu: [
                            radio('Large Icons', SIZES.large),
                            radio('Medium Icons', SIZES.medium),
                            radio('Classic Icons', SIZES.classic),
                            { separator: true },
                            check('Auto Arrange', 'autoArrange', 'desktop-view-auto-arrange'),
                            check('Align to Grid', 'alignToGrid', 'desktop-view-align-grid'),
                            { separator: true },
                            check('Show Desktop Icons', 'showIcons', 'desktop-view-show-icons')
                        ]
                    },
                    {
                        text: 'Sort By',
                        submenu: [
                            { text: 'Name', action: 'desktop-sort-by', value: 'name' },
                            { text: 'Size', action: 'desktop-sort-by', value: 'size' },
                            { text: 'Type', action: 'desktop-sort-by', value: 'type' },
                            { text: 'Date modified', action: 'desktop-sort-by', value: 'date' }
                        ]
                    },
                    { text: 'Refresh', action: 'desktop-refresh' },
                    { separator: true },
                    { text: 'Paste', action: 'desktop-paste', loadfn: (item) => { item.disabled = !clipboardHasItems(); } },
                    { text: 'Paste Shortcut', action: 'desktop-paste', loadfn: (item) => { item.disabled = !clipboardHasItems(); } },
                    { separator: true },
                    {
                        text: 'New',
                        submenu: [
                            { icon: 'desktop-menu-icon desktop-menu-icon--folder', text: 'Folder', action: 'desktop-new-folder' }
                        ]
                    },
                    { separator: true },
                    { icon: 'desktop-menu-icon desktop-menu-icon--personalize', text: 'Personalize', action: 'open-desktop-settings' }
                ]
            }]
        };
    }

    /** Sort By: arrange every desktop icon once in the new order (columns from the top left). */
    function sortDesktop(field) {
        const m = manager();
        const view = get();
        const next = nextSort(view, field);
        if (m) {
            const visible = m.shortcuts.filter((s) => !s._isDeleted && (s.folderId == null));
            const sorted = sortShortcuts(visible, next.sortBy, next.sortDir);
            m.updateMultipleShortcutPositions(sorted.map((s, i) => ({ id: s.id, position: { index: 0, pos: i } })));
        }
        update(next);
    }

    function handleMenuAction(ev) {
        const d = ev && ev.detail;
        if (!d || typeof d.action !== 'string' || !d.action.startsWith('desktop-')) return;
        const item = d.item || {};
        const value = item.value != null ? item.value : (d.data && d.data.value);
        switch (d.action) {
            case 'desktop-view-size': update({ size: Number(value) || SIZES.medium }); break;
            case 'desktop-view-auto-arrange': update({ autoArrange: !get().autoArrange }); break;
            case 'desktop-view-align-grid': update({ alignToGrid: !get().alignToGrid }); break;
            case 'desktop-view-show-icons': update({ showIcons: !get().showIcons }); break;
            case 'desktop-sort-by': if (SORT_FIELDS.includes(value)) sortDesktop(value); break;
            case 'desktop-refresh': {
                const m = manager();
                if (m && m.currentWorkspace && typeof m.loadShortcuts === 'function') m.loadShortcuts(m.currentWorkspace);
                else redraw();
                break;
            }
            default: break;
        }
    }

    function bind() {
        if (!doc) return;
        wireFocus();
        wireWheel();
        // one menu handler even if this file runs again (an update without a reload)
        if (root.__desktopIconViewMenuHandler) doc.removeEventListener('contextMenuAction', root.__desktopIconViewMenuHandler);
        root.__desktopIconViewMenuHandler = handleMenuAction;
        doc.addEventListener('contextMenuAction', handleMenuAction);
        // another window saved this workspace's view (settings_updated carries the record's fields)
        doc.addEventListener('workspaceUpdated', (ev) => {
            const d = ev && ev.detail;
            if (d && d.settings && d.settings.desktopView && d.workspaceId === activeWorkspaceId()) {
                const ws = workspaceRecord(d.workspaceId);
                if (ws) ws.desktopView = d.settings.desktopView;
                redraw();
            }
        });
        let resizeTimer = null;
        root.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(redraw, 150);
        });
    }

    const api = {
        SIZES,
        MIN_SIZE,
        MAX_SIZE,
        DEFAULTS,
        ICON_FILES,
        SHEET_COLS,
        SYSTEM_ICONS,
        SYSTEM_ICON_SLOTS,
        get,
        read,
        update,
        normalize,
        normalizeIconRef,
        sizeName,
        stepSize,
        metrics,
        layout,
        insertionAt,
        cellFromPoint,
        snapCell,
        nearestFreeCell,
        placedPoint,
        sortShortcuts,
        nextSort,
        typeName,
        spriteStyle,
        iconElement,
        appIconNames,
        systemSlotIcon,
        systemSlotDefault,
        wrapLines,
        clampLabel,
        applyContainer,
        desktopMenuConfig,
        sortDesktop,
        onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }
    };

    root.desktopIconView = api;
    if (doc) {
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', bind);
        else bind();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
