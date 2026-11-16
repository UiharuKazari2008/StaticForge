/**
 * Melaton Mobile: DreamStudio part - Menu (#860 migration). Joins the program through
 * wmDreamStudio.extend; reaches Studio only through studioModel (studioModelMenu.js adds what it needs).
 *
 * The desktop Studio menu bar's commands the phone's Menu had no row for, grouped as the desktop
 * groups them (imageGenerationSettings.js studioMenuBarItems), each a WM submenu so the Menu stays
 * short:
 *   Menu      File (Save, Save As, Session Name, Open Session), Copy Change JSON, View (Clear Preview,
 *             Transparent Background, Alpha Mode), Prompt (Clear Emphasis Weights, Reset Emphasis Group
 *             IDs, Remove Disabled Blocks: on the field of the page on show), Generate (Allow Paid,
 *             Reset to Free Limits, Maximum Quality, Recent Seeds, Phasewalker), Preferences
 *   Print     Create Animation, Original, New Persona, Ask Wren (on the print on show)
 * The rows, their checks and what they do are the desktop's own (studioModel.menuRows).
 */
(function () {
    'use strict';
    if (window.uiShell !== 'mobile' || !window.wmDreamStudio || typeof window.wmDreamStudio.extend !== 'function') return;
    window.wmDreamStudio.extend('Menu', (api, reg) => {
        const M = api.M;
        if (!M || typeof M.menuRows !== 'function') return;

        const after = () => { api.refresh(); api.paint(); };
        // rows that open a dialog: WM writes them with an ellipsis, as the program's own rows are
        const DOTS = new Set(['Session Name', 'New Preset', 'To Desktop', 'To Folder', 'Gallery Image', 'VFS File', 'Preset']);

        /** Model rows as WM menu rows; `wrap` runs a row's command (the print rows select the print first). */
        function wmRows(rows, wrap) {
            return (rows || []).map((r) => {
                if (r === '-') return '-';
                const row = { label: DOTS.has(r.label) ? `${r.label}...` : r.label, disabled: !!r.disabled };
                if (typeof r.submenu === 'function') {
                    row.submenu = () => { const sub = wmRows(r.submenu(), wrap); return sub.length ? sub : [{ label: '(empty)', disabled: true }]; };
                    return row;
                }
                if ('radio' in r) row.radio = r.radio;
                if ('checked' in r) row.checked = r.checked;
                row.action = () => (wrap ? wrap(r.run) : Promise.resolve(r.run()).then(after));
                return row;
            });
        }

        /** A desktop menu's rows as one WM submenu row (left out when none of them is there). */
        function group(label, menu, texts, wrap) {
            const probe = M.menuRows(menu, texts);
            if (!probe.length) return null;
            return { label, submenu: () => wmRows(M.menuRows(menu, texts), wrap) };
        }

        // the desktop's Prompt commands act on the prompt field last used; here the page's own (the
        // Undesired page: its text; any other: the prompt)
        const promptField = () => (api.tab === 'uc' ? 'uc' : 'prompt');
        function promptRows() {
            const field = promptField();
            const st = M.promptToolState(field);
            const run = (action) => () => { M.promptTool(action, field); after(); };
            return [
                { label: 'Clear Emphasis Weights', disabled: !st.text, action: run('clear-emphasis') },
                { label: 'Reset Emphasis Group IDs', disabled: !st.groups, action: run('reindex-groups') },
                { label: 'Remove Disabled Blocks', disabled: !st.disabledBlocks, action: run('remove-disabled') }
            ];
        }

        /**
         * Edit > Copy Change JSON: the desktop dialog's rows as check rows (Select all first), then its
         * Copy JSON and Copy SI spec; the title bar's ok is its Cancel.
         */
        function changeDialog() {
            const ops = M.changeOps() || [];
            if (!ops.length) { api.sh.messageBox({ title: 'Copy Change JSON', text: 'Studio has nothing to export yet.', icon: 'info', modal: true }); return; }
            const on = new Set(ops.map((o) => o.key));
            const label = (o) => `${o.title}${o.detail ? `: ${o.detail}` : ''}`.replace(/\s+/g, ' ');
            const el = api.openDlg('Copy Change JSON', 'wds-cjdlg', api.ui.listbox([{ key: '*', label: 'Select all', checked: true }, ...ops.map((o) => ({ key: o.key, label: label(o), checked: true }))], { maxHeight: 200 })
                + '<div class="wm-msgbox-buttons"><button type="button" data-cj="copy">Copy JSON</button><button type="button" data-cj="spec">Copy SI spec</button></div>');
            const box = el.querySelector('.wm-listbox');
            const sync = () => {
                box.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = i.dataset.key === '*' ? on.size === ops.length : on.has(i.dataset.key); });
            };
            api.ui.bindListbox(box, null, (key, checked) => {
                if (key === '*') { on.clear(); if (checked) ops.forEach((o) => on.add(o.key)); } else if (checked) on.add(key); else on.delete(key);
                sync();
            });
            el.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-cj]');
                if (!b) return;
                if (b.dataset.cj === 'spec') { M.copyChangeSpec(); api.closeDlg(); return; }
                if (!on.size) { api.sh.messageBox({ title: 'Copy Change JSON', text: 'Nothing selected', icon: 'info', modal: true }); return; }
                M.copyChange([...on]);
                api.closeDlg();
            });
        }

        reg.menu('main', () => {
            const rows = [
                group('File', 'File', ['Save', 'Save As', 'Session Name', '-', 'Open Session']),
                M.changeOps() ? { label: 'Copy Change JSON...', action: changeDialog } : null,
                group('View', 'View', ['Clear Preview', '-', 'Transparent Background', 'Alpha Mode']),
                { label: 'Prompt', submenu: promptRows },
                group('Generate', 'Generate', ['Allow Paid', 'Reset to Free Limits', 'Maximum Quality', '-', 'Recent Seeds', 'Phasewalker']),
                ...wmRows(M.menuRows('Tools', ['Preferences']))
            ];
            return rows.filter(Boolean);
        });

        // the print on show (the program's own when it says; else the one its stage holds)
        const shownPrint = () => {
            if (typeof api.shownPrint === 'function') return api.shownPrint();
            const img = api.$('.wds-stage > img');
            const list = M.prints();
            return (img && img.dataset.file) || list[list.length - 1] || M.selected() || '';
        };
        const onPrint = (run) => {
            const f = shownPrint();
            if (!f) return null;
            return api.sh.busy(Promise.resolve(M.select(f)).then((ok) => (ok ? run() : null)).then(after)
                .catch((err) => console.warn('[wmDreamStudio] menu print', err)), { delay: 250 });
        };

        reg.menu('print', () => {
            const none = !shownPrint();
            return wmRows(M.menuRows('Image', ['Create Animation', 'Original', 'New Persona', 'Ask Wren']), onPrint)
                .map((r) => (none && r !== '-' ? { ...r, disabled: true } : r));
        });
    });
})();
