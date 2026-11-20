/**
 * The kit's tree list (Yozora #979, #851 slice 3): a Vista report list view whose rows open to child rows, as Vista
 * draws nested items in a list (Explorer's tree glyphs from aero.msstyles: closed / open, and their hot copies), with
 * check-box columns that stay in their columns at every depth. Styles: public/css/vista-glass-controls.css
 * ("tree list"); the check boxes are the kit's (input + label inside the light window / .win7 scope).
 *
 *   const tl = vistaTreeList.create(host, {
 *       label: 'Notifications',                         the list's accessible name
 *       columns: [{ id, title, kind: 'tree' | 'check' | 'text', width: '1fr' | 136 }],   the first is the tree column
 *       rows: [{ id, label, detail?, tip?, icon?, cells: { <column id>: { checked, disabled, label } | 'text' },
 *                children?: [rows] }],
 *       open: ['id', ...],                              rows open at first
 *       onToggle(id, open), onCheck(rowId, columnId, checked)
 *   });
 *   tl.update(rows)    draws the rows again (the selection, focus and scroll stay)
 *   tl.isOpen(id) / tl.setOpen(id, open) / tl.select(id) / tl.destroy()
 *
 * Keyboard (as Vista's tree view): Up / Down / Home / End move the selection; Right opens a row, or goes to its first
 * child; Left closes it, or goes to its parent; + and - open and close; Space toggles the row's first check box.
 * A click on the glyph, or a double-click on the row, opens or closes it. The data is the caller's: a check box or a
 * toggle calls back, and the caller draws the rows again with update().
 * Desktop only (the phone has its own kit).
 */
(function (root) {
    'use strict';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let serial = 0;

    function create(host, opts) {
        const o = opts || {};
        const columns = (o.columns || []).slice();
        const open = new Set(o.open || []);
        const uid = `vtl${++serial}`;
        let rows = o.rows || [];
        let selected = null;
        let flat = [];          // the visible rows in order: { row, depth, parent }

        const el = document.createElement('div');
        el.className = 'vista-treelist';
        el.setAttribute('role', 'treegrid');
        el.tabIndex = 0;
        if (o.label) el.setAttribute('aria-label', o.label);
        el.style.setProperty('--vtl-cols', columns.map((c) => (typeof c.width === 'number' ? `${c.width}px` : (c.width || '1fr'))).join(' '));
        el.innerHTML = `<div class="vista-treelist-head" role="row">${columns.map((c) => `<span class="vista-treelist-colhead" role="columnheader">${esc(c.title)}</span>`).join('')}</div><div class="vista-treelist-body" role="rowgroup"></div>`;
        const body = el.querySelector('.vista-treelist-body');
        host.appendChild(el);

        function walk(list, depth, parent) {
            for (const r of list || []) {
                flat.push({ row: r, depth, parent });
                if (r.children && r.children.length && open.has(r.id)) walk(r.children, depth + 1, r.id);
            }
        }

        function cellHtml(r, c, i) {
            const v = r.cells ? r.cells[c.id] : null;
            if (c.kind === 'check') {
                if (!v) return '<span class="vista-treelist-cell" role="gridcell"></span>';
                const id = `${uid}-${i}-${c.id}`;
                return `<span class="vista-treelist-cell vista-treelist-check" role="gridcell"><input type="checkbox" id="${id}" data-vtl-col="${esc(c.id)}" tabindex="-1" aria-label="${esc(v.label || c.title)}"${v.checked ? ' checked' : ''}${v.disabled ? ' disabled' : ''}><label for="${id}"></label></span>`;
            }
            return `<span class="vista-treelist-cell" role="gridcell">${esc(v)}</span>`;
        }

        function draw() {
            const scroll = el.scrollTop;
            const hadFocus = el.contains(document.activeElement);
            flat = [];
            walk(rows, 0, null);
            if (selected && !flat.some((x) => x.row.id === selected)) selected = null;
            // as a Win32 tree view's image list: when any row has an icon, every row keeps the icon's room, so a child
            // starts one level (19 px, Device Manager on the VM) in from its parent and its text clears the parent's
            const icons = flat.some((x) => x.row.icon);
            body.innerHTML = flat.map(({ row: r, depth }, i) => {
                const kids = !!(r.children && r.children.length);
                const isOpen = kids && open.has(r.id);
                const icon = r.icon ? `<img class="vista-treelist-icon" src="${esc(r.icon)}" alt="">` : (icons ? '<span class="vista-treelist-icon" aria-hidden="true"></span>' : '');
                const detail = r.detail ? `<span class="vista-treelist-detail">${esc(r.detail)}</span>` : '';
                return `<div class="vista-treelist-row${selected === r.id ? ' is-selected' : ''}${r.detail ? ' has-detail' : ''}" role="row" data-vtl-row="${i}" aria-level="${depth + 1}"${kids ? ` aria-expanded="${isOpen}"` : ''}${selected === r.id ? ' aria-selected="true"' : ''}>`
                    + `<span class="vista-treelist-cell vista-treelist-main" role="gridcell" data-depth="${depth}"${r.tip ? ` title="${esc(r.tip)}"` : ''}>`
                    + `<span class="vista-treelist-glyph${kids ? (isOpen ? ' is-open' : ' is-closed') : ''}" aria-hidden="true"></span>${icon}`
                    + `<span class="vista-treelist-text"><span class="vista-treelist-label">${esc(r.label)}</span>${detail}</span></span>`
                    + columns.slice(1).map((c) => cellHtml(r, c, i)).join('')
                    + '</div>';
            }).join('');
            // the depth indents the tree column only: the other columns keep their place
            body.querySelectorAll('.vista-treelist-main').forEach((m) => m.style.setProperty('--vtl-depth', m.dataset.depth));
            if (el.scrollTop !== scroll) el.scrollTop = scroll;
            if (hadFocus && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
        }

        function indexOf(id) { return flat.findIndex((x) => x.row.id === id); }

        function select(id, reveal) {
            if (selected !== id) {
                selected = id;
                body.querySelectorAll('.vista-treelist-row.is-selected').forEach((r) => { r.classList.remove('is-selected'); r.removeAttribute('aria-selected'); });
                const i = indexOf(id);
                const rowEl = i >= 0 ? body.querySelector(`[data-vtl-row="${i}"]`) : null;
                if (rowEl) { rowEl.classList.add('is-selected'); rowEl.setAttribute('aria-selected', 'true'); }
            }
            if (reveal) {
                const i = indexOf(id);
                const rowEl = i >= 0 ? body.querySelector(`[data-vtl-row="${i}"]`) : null;
                if (rowEl) rowEl.scrollIntoView({ block: 'nearest' });
            }
        }

        function setOpen(id, want) {
            const item = flat.find((x) => x.row.id === id);
            if (!item || !(item.row.children && item.row.children.length) || open.has(id) === want) return;
            if (want) open.add(id); else open.delete(id);
            draw();
            if (typeof o.onToggle === 'function') o.onToggle(id, want);
        }

        // ---- input (on the list's own elements: they go with it)
        el.addEventListener('click', (ev) => {
            const rowEl = ev.target.closest('.vista-treelist-row');
            if (!rowEl) return;
            const item = flat[Number(rowEl.dataset.vtlRow)];
            if (!item) return;
            if (ev.target.closest('.vista-treelist-glyph')) { setOpen(item.row.id, !open.has(item.row.id)); select(item.row.id); return; }
            if (!ev.target.closest('input, label')) select(item.row.id);
            el.focus({ preventScroll: true });
        });
        el.addEventListener('dblclick', (ev) => {
            const rowEl = ev.target.closest('.vista-treelist-row');
            if (!rowEl || ev.target.closest('input, label, .vista-treelist-glyph')) return;
            const item = flat[Number(rowEl.dataset.vtlRow)];
            if (item) setOpen(item.row.id, !open.has(item.row.id));
        });
        el.addEventListener('change', (ev) => {
            const box = ev.target.closest('input[data-vtl-col]');
            const rowEl = box && box.closest('.vista-treelist-row');
            const item = rowEl && flat[Number(rowEl.dataset.vtlRow)];
            if (!item) return;
            select(item.row.id);
            if (typeof o.onCheck === 'function') o.onCheck(item.row.id, box.dataset.vtlCol, box.checked);
            el.focus({ preventScroll: true });
        });
        el.addEventListener('keydown', (ev) => {
            if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
            if (!flat.length) return;
            let i = selected ? indexOf(selected) : -1;
            const cur = i >= 0 ? flat[i] : null;
            const kids = cur && cur.row.children && cur.row.children.length;
            let handled = true;
            switch (ev.key) {
                case 'ArrowDown': i = Math.min(flat.length - 1, i + 1); select(flat[i].row.id, true); break;
                case 'ArrowUp': i = Math.max(0, i < 0 ? 0 : i - 1); select(flat[i].row.id, true); break;
                case 'Home': select(flat[0].row.id, true); break;
                case 'End': select(flat[flat.length - 1].row.id, true); break;
                case 'ArrowRight':
                    if (!cur) { select(flat[0].row.id, true); break; }
                    if (kids && !open.has(cur.row.id)) setOpen(cur.row.id, true);
                    else if (kids) select(flat[i + 1].row.id, true);
                    break;
                case 'ArrowLeft':
                    if (!cur) break;
                    if (kids && open.has(cur.row.id)) setOpen(cur.row.id, false);
                    else if (cur.parent != null) select(cur.parent, true);
                    break;
                case '+': if (cur && kids) setOpen(cur.row.id, true); break;
                case '-': if (cur && kids) setOpen(cur.row.id, false); break;
                case ' ': {
                    if (!cur) break;
                    const box = body.querySelector(`[data-vtl-row="${i}"] input[data-vtl-col]:not(:disabled)`);
                    if (box) { box.checked = !box.checked; box.dispatchEvent(new Event('change', { bubbles: true })); }
                    break;
                }
                default: handled = false;
            }
            if (handled) ev.preventDefault();
        });

        draw();
        return {
            el,
            update(next) { rows = next || []; draw(); },
            isOpen: (id) => open.has(id),
            setOpen,
            select: (id) => select(id, true),
            selected: () => selected,
            destroy() { el.remove(); }
        };
    }

    root.vistaTreeList = { create };
})(typeof window !== 'undefined' ? window : globalThis);
