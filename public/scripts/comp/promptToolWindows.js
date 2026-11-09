/**
 * Find and Emphasis tool windows for DreamStudio's prompt fields (Yukimi 2026-11-09: the inline
 * search bar and the emphasis editor become real tool windows that stay open, follow the field
 * being worked in, switch themselves off when there is nothing to act on, and hand the field back).
 *
 * Context: the Studio prompt field last focused (prompt, UC, inline negative, a character's
 * prompt or UC) and its caret / selection, which an unfocused textarea keeps. Both windows read it
 * and never move it for good: every edit puts the selection back where the user left it.
 *
 * Find drives the toolbar's search engine (promptTextareaToolbar.js) with the window body as its
 * "toolbar" (data-search-host): same matching, counting, tab switching and Select. Its highlights
 * show only while the Find window is the active window; clicking back into a field clears them, and
 * the next use searches again (the text may have changed meanwhile).
 *
 * Emphasis edits the group around the caret: weight (or share when normalising), step buttons, the
 * wheel over the value, trim, remove, and Emphasize Selection when the caret is in no group.
 * Opened from the toolbar Search / emphasis chip, Ctrl+F, the field menu, and Studio's Edit menu.
 */
(function () {
    'use strict';

    const FIELD_SELECTOR = '#manualModal textarea.prompt-textarea, #manualModal textarea.character-prompt-textarea';
    const ctx = { textarea: null, start: 0, end: 0 };
    let refreshFrame = 0;
    // true while a window edits the field: its own input events must not become the user's selection
    let editing = false;

    function findWindow() { return document.getElementById('promptFindTool'); }
    function emphasisWindow() { return document.getElementById('promptEmphasisTool'); }
    function isOpen(win) { return !!(win && !win.classList.contains('hidden')); }
    function studioOpen() {
        const studio = document.getElementById('manualModal');
        return !!(studio && !studio.classList.contains('hidden') && !studio.classList.contains('minimised'));
    }

    function isStudioField(el) {
        return !!(el && el.matches && el.matches(FIELD_SELECTOR) && el.id && !el.id.endsWith('_directive')
            && el.id !== 'creativeDirectiveInput');
    }

    /** A field's place for the windows' context line: "Prompt", "UC", "Character 2 prompt". */
    function fieldLabel(textarea) {
        if (!textarea) return '';
        const id = textarea.id;
        if (id === 'manualPrompt') return 'Prompt';
        if (id === 'manualUc') return 'Undesired Content';
        if (id === 'manualPromptNegative') return 'Inline negative';
        const item = textarea.closest('.character-prompt-item');
        const name = (item && item.dataset.charaName) || 'Character';
        if (/_uc$/.test(id)) return `${name} UC`;
        if (/_promptNegative$/.test(id)) return `${name} inline negative`;
        return `${name} prompt`;
    }

    function setContext(textarea) {
        if (editing || !isStudioField(textarea)) return;
        ctx.textarea = textarea;
        ctx.start = textarea.selectionStart;
        ctx.end = textarea.selectionEnd;
        scheduleRefresh();
    }

    function contextField() {
        const ta = ctx.textarea;
        return ta && ta.isConnected && studioOpen() ? ta : null;
    }

    function scheduleRefresh() {
        if (refreshFrame) return;
        refreshFrame = requestAnimationFrame(() => {
            refreshFrame = 0;
            if (isOpen(findWindow())) refreshFind();
            if (isOpen(emphasisWindow())) refreshEmphasis();
        });
    }

    /** Put the field's selection back as the user left it (clamped to the text as it is now). */
    function restoreSelection(textarea) {
        const len = textarea.value.length;
        textarea.setSelectionRange(Math.min(ctx.start, len), Math.min(ctx.end, len));
    }

    // ---------- Find ----------

    function findHost() { return findWindow() && findWindow().querySelector('[data-search-host]'); }

    function findState() {
        const host = findHost();
        return host && window.promptTextareaToolbar ? promptTextareaToolbar.searchStates.get(host) : null;
    }

    function startFind(textarea) {
        const host = findHost();
        if (!host || !window.promptTextareaToolbar) return;
        if (!findState()) {
            host.classList.add('search-mode');
            // initializeSearchMode: promptTextareaToolbar.js (wires the window's input and buttons once)
            promptTextareaToolbar.initializeSearchMode(textarea, host);
        }
        const state = findState();
        if (state) {
            state.textarea = textarea;
            const input = host.querySelector('.text-search-input');
            state.query = input ? input.value : '';
            promptTextareaToolbar.performSearch(host);
        }
    }

    function refreshFind() {
        const win = findWindow();
        const textarea = contextField();
        const off = !textarea;
        win.classList.toggle('ptw-disabled', off);
        win.querySelectorAll('input, button:not(.close-btn):not(.minimize-btn)').forEach((el) => { el.disabled = off; });
        const line = win.querySelector('.ptw-context');
        if (line) {
            line.textContent = off
                ? (studioOpen() ? 'Click in a prompt field to search it.' : 'Open DreamStudio to search its prompts.')
                : `Searching every prompt field, starting at ${fieldLabel(textarea)}.`;
        }
        const state = findState();
        if (state && textarea) state.textarea = textarea;
    }

    function openFind(textarea) {
        const win = findWindow();
        if (!win) return;
        if (isStudioField(textarea)) setContext(textarea);
        const field = textarea && textarea.selectionStart !== textarea.selectionEnd
            ? textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).trim() : '';
        // openModal: public/scripts/comp/modalUtils.js
        openModal(win);
        refreshFind();
        const input = win.querySelector('.text-search-input');
        if (input && field && !field.includes('\n') && field.length <= 80) input.value = field;
        const ta = contextField();
        if (ta) startFind(ta);
        if (input) { input.focus(); input.select(); }
    }

    function closeFind(returnFocus) {
        const host = findHost();
        if (host && findState()) promptTextareaToolbar.closeSearch(host, !returnFocus);
        if (host) host.classList.remove('search-mode');
    }

    // ---------- Emphasis ----------

    /** What the caret is in: a weighted group (managed or N::), a brace run ({...} / [...]), or null. */
    function emphasisInfo(textarea) {
        if (!textarea || !window.promptTextareaToolbar) return null;
        const value = textarea.value || '';
        const pos = textarea.selectionStart;
        const clean = (t) => String(t || '').replace(/[\u200B-\u200D\u2060-\u2064\uFEFF]/g, '').trim();
        const state = promptTextareaToolbar.resolveEmphasisGroupChipState(textarea);
        if (state && state.inside) {
            // listManagedEmphasisBlocks: public/scripts/comp/emphasisGroupIdCodec.js
            const block = listManagedEmphasisBlocks(value).find((b) => pos >= b.openEnd && pos <= b.closeStart);
            const share = /%$/.test(state.label);
            return {
                kind: 'Group',
                id: block ? block.id : null,
                text: block ? clean(block.innerText) : '',
                share,
                value: share ? parseFloat(state.label) : state.weight
            };
        }
        // findBraceBlockOverlappingSelection: public/scripts/comp/emphasisSelection.js. NovelAI braces:
        // each { is x1.05, each [ is /1.05.
        const brace = findBraceBlockOverlappingSelection(value, pos, pos + 1) || findBraceBlockOverlappingSelection(value, pos - 1, pos);
        if (brace) {
            const lead = value.slice(brace.start).match(/^(\{+|\[+)/);
            const n = lead ? lead[1].length : 0;
            const up = lead && lead[1][0] === '{';
            return { kind: 'Brace', id: null, text: clean(brace.innerText), share: false, value: Math.pow(1.05, up ? n : -n) };
        }
        return null;
    }

    function refreshEmphasis() {
        const win = emphasisWindow();
        const textarea = contextField();
        const info = textarea ? emphasisInfo(textarea) : null;
        const hasSelection = !!(textarea && textarea.selectionStart !== textarea.selectionEnd);
        win.classList.toggle('ptw-disabled', !info);
        const set = (sel, on) => win.querySelectorAll(sel).forEach((el) => { el.disabled = !on; });
        set('[data-pew="trim-start"], [data-pew="trim-end"], [data-pew="remove"], #promptEmphasisValue', !!info);
        set('[data-pew="create"]', !info && hasSelection);
        // one slot: Remove inside a group or brace run, Group the selection outside one
        win.querySelector('[data-pew="remove"]').classList.toggle('hidden', !info);
        win.querySelector('[data-pew="create"]').classList.toggle('hidden', !!info);
        const valueInput = win.querySelector('#promptEmphasisValue');
        const unit = win.querySelector('.ptw-unit');
        if (valueInput && document.activeElement !== valueInput) {
            valueInput.value = info ? (info.share ? String(Math.round(info.value)) : Number(info.value).toFixed(2)) : '';
        }
        if (unit) unit.textContent = info && info.share ? '%' : '';
        const kind = win.querySelector('.ptw-kind');
        if (kind) {
            kind.textContent = info ? info.kind : 'None';
            kind.dataset.kind = info ? info.kind.toLowerCase() : 'none';
            let tip;
            if (!studioOpen()) tip = 'Open DreamStudio to edit emphasis.';
            else if (!textarea) tip = 'Click in a prompt field.';
            else if (info) tip = `${info.kind} in ${fieldLabel(textarea)}: ${info.text || '(empty)'}`;
            else if (hasSelection) tip = `No emphasis at the caret in ${fieldLabel(textarea)}; Group makes one from the selection.`;
            else tip = `The caret in ${fieldLabel(textarea)} is in no emphasis group.`;
            kind.title = tip;
        }
    }

    /** Run an emphasis edit on the context group, then give the field its selection back. */
    function withContextGroup(fn) {
        const textarea = contextField();
        if (!textarea) return;
        const info = emphasisInfo(textarea);
        if (info && info.id != null && window.promptTextareaToolbar) {
            promptTextareaToolbar.selectPinnedEmphasisGroup(textarea, info.id);
        } else {
            restoreSelection(textarea);
        }
        editing = true;
        try {
            fn(textarea, info);
        } finally {
            editing = false;
        }
        restoreSelection(textarea);
        promptTextareaToolbar.updateEmphasisGroupChip(textarea, promptTextareaToolbar.getToolbarFromTextarea(textarea));
        refreshEmphasis();
        // the edit focused the field: keep working in this window
        const win = emphasisWindow();
        const keep = win && (win.contains(document.activeElement) ? document.activeElement : win.querySelector('#promptEmphasisValue'));
        if (keep && !keep.disabled) keep.focus({ preventScroll: true });
    }

    function adjustEmphasis(delta) {
        withContextGroup((textarea) => {
            // startEmphasisEditing / adjustEmphasisEditing / applyEmphasisEditing: emphasisEditing.js
            if (!startEmphasisEditing(textarea)) return;
            adjustEmphasisEditing(delta);
            applyEmphasisEditing();
        });
    }

    function setEmphasisValue(target) {
        const info = emphasisInfo(contextField());
        if (!info || !Number.isFinite(target)) return;
        const delta = target - info.value;
        if (Math.abs(delta) > 1e-6) adjustEmphasis(delta);
    }

    function emphasisCommand(action) {
        withContextGroup((textarea) => {
            const toolbar = promptTextareaToolbar.getToolbarFromTextarea(textarea);
            // handleEmphasisChipContextAction: promptTextareaToolbar.js (trim / remove at the caret)
            promptTextareaToolbar.handleEmphasisChipContextAction(action, textarea, toolbar);
        });
    }

    function createEmphasisGroup() {
        const textarea = contextField();
        if (!textarea || textarea.selectionStart === textarea.selectionEnd) return;
        withContextGroup((ta) => {
            if (!startEmphasisEditing(ta)) return;
            adjustEmphasisEditing(0.1);
            applyEmphasisEditing();
        });
    }

    function openEmphasis(textarea) {
        const win = emphasisWindow();
        if (!win) return;
        if (isStudioField(textarea)) setContext(textarea);
        openModal(win);
        refreshEmphasis();
        const input = win.querySelector('#promptEmphasisValue');
        if (input && !input.disabled) { input.focus(); input.select(); }
    }

    // ---------- wiring ----------

    function watchClose(win, onClosed) {
        let wasOpen = isOpen(win);
        new MutationObserver(() => {
            const open = isOpen(win);
            if (!open && wasOpen) onClosed();
            wasOpen = open;
        }).observe(win, { attributes: true, attributeFilter: ['class'] });
    }

    function wire() {
        const fw = findWindow();
        const ew = emphasisWindow();
        if (!fw || !ew || fw.dataset.ptwWired === 'true') return;
        fw.dataset.ptwWired = 'true';

        // the context follows the Studio field being worked in
        document.addEventListener('focusin', (e) => { if (isStudioField(e.target)) setContext(e.target); });
        document.addEventListener('selectionchange', () => {
            const el = document.activeElement;
            if (isStudioField(el) && (isOpen(fw) || isOpen(ew))) setContext(el);
        });
        document.addEventListener('input', (e) => { if (isStudioField(e.target) && isOpen(ew)) setContext(e.target); }, true);

        // In use = keyboard focus inside the window. An owned tool window shows the active caption
        // whenever the Studio is active (as on Vista), so active-window cannot tell. Find highlights
        // only while in use; focus back in a field (or anywhere else) gives the field its own look.
        let findInUse = false;
        document.addEventListener('focusin', (e) => {
            if (isOpen(fw)) {
                const inside = fw.contains(e.target);
                if (inside && !findInUse) {
                    findInUse = true;
                    const ta = contextField();
                    refreshFind();
                    if (ta) startFind(ta);
                } else if (!inside && findInUse) {
                    findInUse = false;
                    promptTextareaToolbar.clearAllSearchHighlights();
                }
            }
            if (isOpen(ew) && ew.contains(e.target)) refreshEmphasis();
        });
        watchClose(fw, () => {
            findInUse = false;
            closeFind(false);
        });
        fw.querySelectorAll('[data-ptw-close]').forEach((btn) => btn.addEventListener('click', () => {
            closeFind(true);
            closeModal(fw);
        }));

        // Emphasis
        ew.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-pew]');
            if (!btn || btn.disabled) return;
            const action = btn.dataset.pew;
            if (action === 'trim-start') emphasisCommand('emphasis-trim-start');
            else if (action === 'trim-end') emphasisCommand('emphasis-trim-end');
            else if (action === 'remove') emphasisCommand('emphasis-remove');
            else if (action === 'create') createEmphasisGroup();
            else if (action === 'close') {
                closeModal(ew);
                const ta = contextField();
                if (ta) { ta.focus(); restoreSelection(ta); }
            }
        });
        const value = ew.querySelector('#promptEmphasisValue');
        // the up-down arrows set the box; apply what it now says (Enter / blur apply typed values)
        value.addEventListener('change', () => setEmphasisValue(parseFloat(value.value)));
        value.addEventListener('input', (e) => {
            if (e.inputType === undefined || e.inputType === '') setEmphasisValue(parseFloat(value.value));
        });
        value.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); setEmphasisValue(parseFloat(value.value)); }
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const step = getEmphasisAdjustStep(e.shiftKey);
                adjustEmphasis(e.key === 'ArrowUp' ? step : -step);
            }
        });
        // createWheelTickGate / guardWheelTick: public/scripts/utils/wheelTickGate.js
        const allowTick = createWheelTickGate();
        ew.querySelector('.ptw-value-row').addEventListener('wheel', (e) => {
            if (!guardWheelTick(e, allowTick, { stop: true }) || value.disabled) return;
            const step = getEmphasisAdjustStep(e.shiftKey);
            adjustEmphasis(e.deltaY > 0 ? -step : step);
        }, { passive: false });
    }

    window.promptToolWindows = { openFind, openEmphasis, wire, refresh: scheduleRefresh, field: contextField };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
    else wire();
})();
