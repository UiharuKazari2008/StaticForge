/**
 * studioModel part - Menu (#860 migration): the Studio calls DreamStudio's Menu part needs, added
 * with studioModel.extend. Only this file touches the desktop form for them.
 *
 *   studioModel.menuRows(menu, texts)   rows of the desktop menu bar's menu `menu` (studioMenuBarItems:
 *                                       'File', 'Edit', 'View', 'Generate', 'Image', 'Tools' ...), only
 *                                       those labelled in texts ('-' a rule), as plain rows:
 *                                       { label, disabled, checked | radio, submenu() | run() }. The
 *                                       desktop's own builders and handler (handleStudioMenuBarAction),
 *                                       so both stay in step; rows that open a desktop window the phone
 *                                       does not show are left out.
 *   studioModel.promptToolState(field)  { text, disabledBlocks, groups } of 'prompt' or 'uc'
 *   studioModel.promptTool(action, field)
 *                                       the desktop's Prompt menu commands on that field's text:
 *                                       'clear-emphasis' | 'reindex-groups' | 'remove-disabled'
 *   studioModel.changeOps()             Edit > Copy Change JSON's rows: [{ key, group, title, detail }]
 *                                       (studioChangeJson.js buildExportOpsFromStudio), null when absent
 *   studioModel.copyChange(keys) / copyChangeSpec()
 *                                       the change JSON of those rows / the SI spec to the clipboard
 *                                       (the desktop dialog's Copy JSON / Copy SI spec; promises)
 */
(function () {
    'use strict';
    const M = window.studioModel;
    if (!M || typeof M.extend !== 'function') return;

    /* global studioMenuBarItems, handleStudioMenuBarAction, studioPickMenuRows, studioWin32MenuSections,
       removeAllEmphasisFromSelection, updateEmphasisHighlighting, promptCtxHasDisabledBlocks,
       promptCtxDeleteAllDisabledBlocks, countEmphasisGroupsForIdReindex, promptTextareaToolbar,
       buildExportOpsFromStudio, describeStudioChangeOp, buildPayloadFromOps, attachStudioSeedEcho,
       copyStudioChangeText, STUDIO_CHANGE_AI_SPEC */

    // desktop rows whose desktop window the phone does not show: the phone has its own forms of them
    // in the other DreamStudio parts (Print: Enhance, Paint, Comparison, Today background, Add to
    // Start; Session: Studio Activity; Expanders: Text Expanders), or none is needed (Open Result in
    // Window: the phone has View Full Screen)
    const NO_PHONE = new Set(['open-in-window', 'edit-in-paint', 'create-desktop-shortcut', 'studio-activity', 'studio-text-expanders', 'set-wallpaper', 'enhance']);
    // the previous-print overlay the phone does not draw
    const NO_PHONE_LABELS = new Set(['Comparison']);
    // one value of several: WM marks those with a bullet
    const RADIO = new Set(['imggen-format', 'imggen-alpha', 'imggen-transparency', 'enhance-preset-magnitude', 'enhance-preset-scale']);

    const val = (v, item) => { try { return typeof v === 'function' ? v(item) : v; } catch (_) { return undefined; } };

    // New Persona asks chatSystem, a feature a phone loads only when Chat first opens (wmChat.js
    // ensureChat): without it the desktop's handler does nothing
    async function chatReady() {
        if (window.chatSystem) return true;
        const fl = window.featureLoader;
        try { if (fl && typeof fl.loadFeature === 'function') await fl.loadFeature('chat'); } catch (_) { return false; }
        for (let i = 0; i < 50 && !window.chatSystem; i += 1) await new Promise((r) => setTimeout(r, 100));
        return !!window.chatSystem;
    }

    async function runItem(item) {
        if (typeof handleStudioMenuBarAction !== 'function') return false;
        if (item.action === 'start-chat' && !(await chatReady())) return false;
        let out;
        try { out = handleStudioMenuBarAction(item.action, M._el('manualModal'), item); } catch (err) { console.warn('[studioModel] menu', item.action, err); }
        // the handlers change the form in place (some a moment later): the views read it again
        return Promise.resolve(out).catch(() => null).then((r) => { M._emit('change', { id: 'menu' }); return r; });
    }

    function plain(list) {
        const out = [];
        const rule = () => { if (out.length && out[out.length - 1] !== '-') out.push('-'); };
        (typeof studioWin32MenuSections === 'function' ? studioWin32MenuSections(list) : (list || [])).forEach((item) => {
            if (!item) return;
            if (item.type === 'grid' && Array.isArray(item.items)) { rule(); out.push(...plain(item.items)); return; }
            if (item.separator) { rule(); return; }
            if (val(item.hidden, item)) return;
            if (item.action && NO_PHONE.has(item.action)) return;
            // Custom color opens Vista's Color dialog
            if (item.action === 'imggen-transparency' && item.value === 'custom') return;
            try { if (typeof item.loadfn === 'function') item.loadfn(item, null); } catch (_) { /* as is */ }
            const label = String(val(item.text, item) || val(item.tooltip, item) || '').replace(/\s+/g, ' ').trim();
            if (!label || NO_PHONE_LABELS.has(label)) return;
            const row = { label, disabled: !!val(item.disabled, item) };
            if (Array.isArray(item.submenu) || typeof item.optionsfn === 'function') {
                row.submenu = () => plain(Array.isArray(item.submenu) ? item.submenu : val(item.optionsfn, null));
            } else if (item.action) {
                if (RADIO.has(item.action) || item.indicatorMark === 'radio') row.radio = !!item.checked;
                else if (item.showIndicator || item.keepMenuOpen) row.checked = !!item.checked;
                row.run = () => runItem(item);
            } else return;
            out.push(row);
        });
        while (out.length && out[out.length - 1] === '-') out.pop();
        return out;
    }

    function menuRows(menu, texts) {
        if (typeof studioMenuBarItems !== 'function') return [];
        let rows = [];
        try {
            rows = studioMenuBarItems(menu);
            if (Array.isArray(texts) && typeof studioPickMenuRows === 'function') rows = studioPickMenuRows(rows, texts);
            return plain(rows);
        } catch (err) { console.warn('[studioModel] menuRows', menu, err); return []; }
    }

    // the desktop's Prompt commands work on the prompt field last used (studioEditPromptTarget); the
    // phone names it: the page's own field
    const promptArea = (field) => M._el(field === 'uc' ? 'manualUc' : 'manualPrompt');

    function promptToolState(field) {
        const ta = promptArea(field);
        const text = ta ? String(ta.value || '') : '';
        let disabledBlocks = false;
        let groups = 0;
        try { disabledBlocks = typeof promptCtxHasDisabledBlocks === 'function' && promptCtxHasDisabledBlocks(ta); } catch (_) { disabledBlocks = false; }
        try { groups = typeof countEmphasisGroupsForIdReindex === 'function' ? countEmphasisGroupsForIdReindex(text) : 0; } catch (_) { groups = 0; }
        return { text, disabledBlocks: !!disabledBlocks, groups };
    }

    function promptTool(action, field) {
        const ta = promptArea(field);
        if (!ta) return false;
        const before = ta.value;
        if (action === 'clear-emphasis' && typeof removeAllEmphasisFromSelection === 'function') {
            // no selection: the whole text, as the desktop does with its caret anywhere
            ta.setSelectionRange(0, 0);
            removeAllEmphasisFromSelection(ta);
            if (typeof updateEmphasisHighlighting === 'function') updateEmphasisHighlighting(ta);
        } else if (action === 'remove-disabled' && typeof promptCtxDeleteAllDisabledBlocks === 'function') {
            promptCtxDeleteAllDisabledBlocks(ta);
        } else if (action === 'reindex-groups' && typeof promptTextareaToolbar !== 'undefined' && promptTextareaToolbar) {
            promptTextareaToolbar.reindexEmphasisGroupIds(ta, promptTextareaToolbar.getToolbarFromTextarea(ta));
        } else return false;
        M._emit('change', { id: field === 'uc' ? 'uc' : 'prompt' });
        return ta.value !== before;
    }

    // Copy Change JSON: the desktop dialog (openStudioChangeExportDialog) is a Vista list of its own;
    // the phone draws the rows itself and copies through the same builders
    function changeOps() {
        if (typeof buildExportOpsFromStudio !== 'function' || typeof describeStudioChangeOp !== 'function') return null;
        try {
            return buildExportOpsFromStudio().map((op) => {
                const d = describeStudioChangeOp(op) || {};
                return { key: op.key, group: op.group || '', title: String(d.title || ''), detail: String(d.detail || '') };
            });
        } catch (err) { console.warn('[studioModel] changeOps', err); return null; }
    }

    function copyChange(keys) {
        if (typeof buildPayloadFromOps !== 'function' || typeof copyStudioChangeText !== 'function') return Promise.resolve(false);
        const want = new Set(keys || []);
        // built again at the tap, so the JSON is the session as it is now (as the desktop's on Copy)
        const ops = buildExportOpsFromStudio().filter((op) => want.has(op.key));
        if (!ops.length) return Promise.resolve(false);
        const payload = attachStudioSeedEcho(buildPayloadFromOps(ops, ''));
        return copyStudioChangeText(JSON.stringify(payload, null, 2), 'Change JSON copied');
    }

    function copyChangeSpec() {
        if (typeof copyStudioChangeText !== 'function' || typeof STUDIO_CHANGE_AI_SPEC !== 'string') return Promise.resolve(false);
        return copyStudioChangeText(STUDIO_CHANGE_AI_SPEC, 'SI format spec copied');
    }

    M.extend({ menuRows, promptToolState, promptTool, changeOps, copyChange, copyChangeSpec });
})();
