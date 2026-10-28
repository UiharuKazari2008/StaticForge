/**
 * Make Global (Yozora #668): an Aero Wizard that saves the request's embedded text expanders
 * (requestBodyReplacements, Text Expanders [Embedded]) as global ones (prompt.config.json
 * text_replacements, the !name expanders of Global Expanders). Opened from the Embedded window's
 * Make Global command; loaded by featureLoader 'expander_make_global'.
 *
 *   dsexp:choose   the embedded expanders as a check list (Phasewalker's managed rows are not
 *                  offered); rows that share a name are one expander, merged the way the server
 *                  merges them for a stage (any list -> one list, all text -> joined with ", ")
 *   dsexp:review   what each becomes; a name that is already global is merged (values added,
 *                  duplicates dropped), replaced, or skipped; the converted rows can leave the request
 *   dsexp:done     what was saved
 *
 * The pages are this module's own dialog templates (vistaDialogTemplates.js format, dialog units
 * at MS Shell Dlg 8) rendered by vistaDialogTemplate.openWizard. Saving is one save_text_replacements
 * (merge into text_replacements); the text_replacements app options chunk is refreshed after it.
 */
(function (root) {
    'use strict';

    const ID = 'expanderMakeGlobalWizard';
    const TITLE = 'Make Global';
    const ICON = '/static_images/app_icons/32/expanders.webp';
    const SS = 0x50020000; // static, SS_LEFT
    const CHECK = 0x50010003; // BS_AUTOCHECKBOX, WS_TABSTOP
    const GROUP = 0x50000007; // BS_GROUPBOX
    const RADIO_FIRST = 0x50030009; // BS_AUTORADIOBUTTON, WS_GROUP | WS_TABSTOP
    const RADIO = 0x50000009;

    const TEMPLATES = {
        'dsexp:choose': { t: '', w: 300, h: 196, f: ['MS Shell Dlg', 8], s: 0, c: [
            [100, 'S', 0, 0, 290, 16, SS, 'Each expander you select is saved as a global expander. Global expanders work in every request and every stage.', 0],
            [101, 'S', 0, 22, 290, 150, SS, '', 0],
            [102, 'B', 0, 178, 120, 10, CHECK, '&Select all', 0]
        ] },
        'dsexp:review': { t: '', w: 300, h: 196, f: ['MS Shell Dlg', 8], s: 0, c: [
            [200, 'S', 0, 0, 290, 8, SS, 'These global expanders will be saved:', 0],
            [201, 'S', 0, 12, 290, 80, SS, '', 0],
            [202, 'B', 0, 98, 290, 48, GROUP, 'When a global expander already has the name', 0],
            [203, 'B', 8, 110, 276, 10, RADIO_FIRST, '&Merge the values (the expander picks one at random)', 0],
            [204, 'B', 8, 122, 276, 10, RADIO, '&Replace the global values', 0],
            [205, 'B', 8, 134, 276, 10, RADIO, 'S&kip it and keep it embedded', 0],
            [206, 'B', 0, 152, 290, 10, CHECK, 'Re&move the converted expanders from this request', 0],
            [207, 'S', 0, 168, 290, 26, SS, '', 0]
        ] },
        'dsexp:done': { t: '', w: 300, h: 196, f: ['MS Shell Dlg', 8], s: 0, c: [
            [300, 'S', 0, 0, 290, 24, SS, '', 0],
            [301, 'S', 0, 30, 290, 150, SS, '', 0]
        ] }
    };

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    const toList = (v) => (Array.isArray(v) ? v.slice() : (v == null || v === '' ? [] : [v]));
    const fromList = (list) => (list.length === 1 ? list[0] : list);

    function embeddedList() {
        // requestBodyReplacements: public/scripts/comp/requestBodyReplacementsModal.js
        return typeof requestBodyReplacements !== 'undefined' && Array.isArray(requestBodyReplacements) ? requestBodyReplacements : [];
    }

    function hasStages(stages) {
        if (stages == null) return false;
        if (Array.isArray(stages)) return stages.length > 0;
        return typeof stages === 'object' && (stages.start !== undefined || stages.end !== undefined);
    }

    /** The embedded expanders a user can convert, one per name, in the request's order. */
    function groupEmbedded() {
        const byName = new Map();
        embeddedList().forEach((entry) => {
            if (!entry || entry.managed || !entry.name) return;
            if (!byName.has(entry.name)) byName.set(entry.name, { name: entry.name, entries: [] });
            byName.get(entry.name).entries.push(entry);
        });
        return Array.from(byName.values()).map((g) => {
            let value;
            if (g.entries.length === 1) {
                value = g.entries[0].value;
            } else {
                // as modules/textReplacements.js merges same-name body replacements for a stage
                const all = [];
                let anyList = false;
                g.entries.forEach((e) => { if (Array.isArray(e.value)) anyList = true; all.push(...toList(e.value)); });
                value = anyList ? all : all.join(', ');
            }
            return {
                name: g.name,
                entries: g.entries,
                value: Array.isArray(value) ? fromList(value) : value,
                staged: g.entries.some((e) => hasStages(e.stages)),
                extend: g.entries.some((e) => e.extend),
                merged: g.entries.length > 1
            };
        });
    }

    function summary(value) {
        const list = toList(value);
        if (list.length > 1) return `${list.length} values: ${list.join(' | ')}`;
        return list[0] || '';
    }

    /** The global value a converted expander saves, or undefined when it is skipped. */
    function finalValue(item, globals, mode) {
        const has = Object.prototype.hasOwnProperty.call(globals, item.name);
        if (!has) return fromList(toList(item.value));
        if (mode === 'skip') return undefined;
        if (mode === 'replace') return fromList(toList(item.value));
        const out = [];
        [...toList(globals[item.name]), ...toList(item.value)].forEach((v) => { if (!out.includes(v)) out.push(v); });
        return fromList(out);
    }

    async function loadGlobals() {
        // appOptionsChunkPresent / ensureAppOptionsChunk / refreshAppOptionsChunk: public/scripts/comp/appBootstrap.js
        try {
            if (typeof appOptionsChunkPresent === 'function' && appOptionsChunkPresent('text_replacements')) {
                await refreshAppOptionsChunk('text_replacements');
            } else if (typeof ensureAppOptionsChunk === 'function') {
                await ensureAppOptionsChunk('text_replacements');
            }
        } catch (_) { /* the cached map, if any */ }
        return (root.optionsData && root.optionsData.textReplacements) || {};
    }

    function listView(cols, rows) {
        const head = cols.map((c) => `<div class="vdt-lv-col" style="width:${c.w}px">${esc(c.text)}</div>`).join('');
        return `<div class="vdt-listview vdt-edge is-report dsexp-list" tabindex="0" role="listbox"><div class="vdt-lv-header">${head}</div><div class="vdt-lv-body">${rows}</div></div>`;
    }

    async function open() {
        const tplApi = root.vistaDialogTemplate;
        if (!tplApi || typeof tplApi.openWizard !== 'function') return null;
        root.vistaDialogTemplates = Object.assign(root.vistaDialogTemplates || {}, TEMPLATES);

        const items = groupEmbedded();
        let globals = await loadGlobals();
        const chosen = new Set();
        let mode = 'merge';
        let removeAfter = true;
        let result = null;

        const owner = document.getElementById('requestBodyReplacementsModal');
        const nextBtn = (ctx) => ctx.content.querySelector('.vdt-wizard-next');
        const selected = () => items.filter((it) => chosen.has(it.name));

        function renderChoose(ctx) {
            if (!items.length) {
                ctx.html(101, listView([{ text: 'Name', w: 130 }, { text: 'Value', w: 300 }],
                    '<div class="vdt-lv-row"><span style="width:430px">This request has no embedded expanders to convert.</span></div>'), 'dsexp:choose');
                ctx.enable(102, false, 'dsexp:choose');
                return;
            }
            const rows = items.map((it, i) => {
                const notes = [it.merged ? `${it.entries.length} rows` : '', it.staged ? 'stage limited' : '', it.extend ? 'extend' : ''].filter(Boolean).join(', ');
                const isGlobal = Object.prototype.hasOwnProperty.call(globals, it.name);
                const note = [isGlobal ? 'already global' : '', notes].filter(Boolean).join('; ');
                // the Vista box is drawn on the label after the input (taskbar-properties.css .tbp-check)
                return `<div class="vdt-lv-row dsexp-row" data-i="${i}">`
                    + `<span class="tbp-check dsexp-name" style="width:120px"><input type="checkbox" class="dsexp-check" id="${ID}-c${i}" data-i="${i}"${chosen.has(it.name) ? ' checked' : ''}><label for="${ID}-c${i}"><span>${esc(it.name)}</span></label></span>`
                    + `<span style="width:210px" title="${esc(summary(it.value))}">${esc(summary(it.value))}</span>`
                    + `<span style="width:100px" title="${esc(note)}">${esc(note)}</span></div>`;
            }).join('');
            ctx.html(101, listView([{ text: 'Name', w: 120 }, { text: 'Value', w: 210 }, { text: 'Notes', w: 100 }], rows), 'dsexp:choose');
        }

        function syncChoose(ctx) {
            const all = items.length > 0 && chosen.size === items.length;
            ctx.set(102, all, 'dsexp:choose');
            nextBtn(ctx).disabled = chosen.size === 0;
        }

        function renderReview(ctx) {
            const rows = selected().map((it) => {
                const isGlobal = Object.prototype.hasOwnProperty.call(globals, it.name);
                const status = !isGlobal ? 'New' : mode === 'merge' ? 'Merge' : mode === 'replace' ? 'Replace' : 'Skip';
                const value = finalValue(it, globals, mode);
                return `<div class="vdt-lv-row"><span style="width:130px">!${esc(it.name)}</span>`
                    + `<span style="width:70px">${status}</span>`
                    + `<span style="width:230px" title="${esc(value === undefined ? '' : summary(value))}">${esc(value === undefined ? '(unchanged)' : summary(value))}</span></div>`;
            }).join('');
            ctx.html(201, listView([{ text: 'Global expander', w: 130 }, { text: 'Action', w: 70 }, { text: 'Value', w: 230 }], rows), 'dsexp:review');
            const clash = selected().some((it) => Object.prototype.hasOwnProperty.call(globals, it.name));
            [202, 203, 204, 205].forEach((id) => ctx.enable(id, clash, 'dsexp:review'));
            const notes = [];
            if (selected().some((it) => it.staged)) notes.push('Global expanders apply to every stage; stage limits are not kept.');
            if (clash && mode === 'merge' && selected().some((it) => it.extend)) notes.push('Extend rows add their values to the global ones.');
            ctx.text(207, notes.join(' '), 'dsexp:review');
        }

        async function save(ctx) {
            const next = nextBtn(ctx);
            next.disabled = true;
            try {
                if (!root.wsClient || !root.wsClient.isConnected()) throw new Error('Not connected to the server.');
                // read the globals again: another window may have changed them since the wizard opened
                globals = await loadGlobals();
                const payload = {};
                const saved = [];
                const skipped = [];
                selected().forEach((it) => {
                    const value = finalValue(it, globals, mode);
                    if (value === undefined) { skipped.push(it); return; }
                    payload[it.name] = value;
                    saved.push({ it, value, existed: Object.prototype.hasOwnProperty.call(globals, it.name) });
                });
                if (saved.length) {
                    const res = await root.wsClient.sendMessage('save_text_replacements', { textReplacements: payload });
                    if (!res || !res.success) throw new Error((res && res.error) || 'The server did not save them.');
                }
                if (removeAfter && saved.length) {
                    const names = new Set(saved.map((s) => s.it.name));
                    const list = embeddedList();
                    const keep = list.filter((e) => !(e && !e.managed && names.has(e.name)));
                    list.length = 0;
                    keep.forEach((e) => list.push(e));
                    // renderRequestBodyReplacementsList: public/scripts/comp/requestBodyReplacementsModal.js
                    if (typeof renderRequestBodyReplacementsList === 'function') renderRequestBodyReplacementsList();
                }
                if (saved.length && typeof refreshAppOptionsChunk === 'function') void refreshAppOptionsChunk('text_replacements');
                // loadTextReplacements: public/scripts/comp/textReplacementManager.js (Global Expanders, when open)
                const manager = document.getElementById('textReplacementManagerModal');
                if (saved.length && manager && !manager.classList.contains('hidden') && typeof loadTextReplacements === 'function') void loadTextReplacements();
                result = { saved, skipped, error: null };
            } catch (err) {
                result = { saved: [], skipped: [], error: (err && err.message) || String(err) };
            }
            next.disabled = false;
            return 'dsexp:done';
        }

        function renderDone(ctx) {
            if (!result) return;
            if (result.error) {
                ctx.text(300, `The expanders were not saved. ${result.error}`, 'dsexp:done');
                ctx.html(301, '', 'dsexp:done');
                return;
            }
            const n = result.saved.length;
            const kept = removeAfter ? 'They were removed from this request.' : 'They are still embedded in this request too.';
            ctx.text(300, n
                ? `${n} global expander${n === 1 ? ' was' : 's were'} saved. ${kept}${result.skipped.length ? ` ${result.skipped.length} skipped.` : ''}`
                : 'No expanders were saved; every one was skipped.', 'dsexp:done');
            const rows = result.saved.map((s) => `<div class="vdt-lv-row"><span style="width:130px">!${esc(s.it.name)}</span>`
                + `<span style="width:70px">${s.existed ? (mode === 'replace' ? 'Replaced' : 'Merged') : 'Created'}</span>`
                + `<span style="width:230px" title="${esc(summary(s.value))}">${esc(summary(s.value))}</span></div>`).join('')
                + result.skipped.map((it) => `<div class="vdt-lv-row"><span style="width:130px">!${esc(it.name)}</span><span style="width:70px">Skipped</span><span style="width:230px"></span></div>`).join('');
            ctx.html(301, rows ? listView([{ text: 'Global expander', w: 130 }, { text: 'Result', w: 70 }, { text: 'Value', w: 230 }], rows) : '', 'dsexp:done');
        }

        return tplApi.openWizard({
            id: ID,
            title: TITLE,
            icon: ICON,
            owner,
            pages: [
                {
                    key: 'dsexp:choose',
                    overrides: { 101: { html: '' } },
                    instruction: 'Choose the embedded expanders to make global',
                    show: (ctx) => syncChoose(ctx),
                    next: () => (chosen.size ? 'dsexp:review' : false)
                },
                {
                    key: 'dsexp:review',
                    overrides: { 201: { html: '' } },
                    instruction: 'Review the global expanders',
                    nextText: 'Save',
                    show: (ctx) => {
                        ctx.set(203, mode === 'merge', 'dsexp:review');
                        ctx.set(204, mode === 'replace', 'dsexp:review');
                        ctx.set(205, mode === 'skip', 'dsexp:review');
                        ctx.set(206, removeAfter, 'dsexp:review');
                        renderReview(ctx);
                    },
                    next: (ctx) => save(ctx)
                },
                {
                    key: 'dsexp:done',
                    overrides: { 301: { html: '' } },
                    instruction: 'Make Global is complete',
                    noBack: true,
                    finish: true,
                    show: (ctx) => renderDone(ctx)
                }
            ],
            init: (ctx) => {
                renderChoose(ctx);
                const choosePage = ctx.content.querySelector('[data-vdt-page="dsexp:choose"]');
                choosePage.addEventListener('change', (ev) => {
                    const box = ev.target.closest('.dsexp-check');
                    if (box) {
                        const it = items[Number(box.dataset.i)];
                        if (box.checked) chosen.add(it.name); else chosen.delete(it.name);
                    } else if (ev.target.closest('[data-vdt-id="102"]')) {
                        const on = !!ctx.get(102, 'dsexp:choose');
                        items.forEach((it) => { if (on) chosen.add(it.name); else chosen.delete(it.name); });
                        choosePage.querySelectorAll('.dsexp-check').forEach((b) => { b.checked = on; });
                    }
                    syncChoose(ctx);
                });
                // a click anywhere on a row toggles its box, as on a check-box list view
                choosePage.addEventListener('click', (ev) => {
                    const row = ev.target.closest('.dsexp-row');
                    if (!row || ev.target.closest('input, label')) return;
                    const box = row.querySelector('.dsexp-check');
                    box.checked = !box.checked;
                    box.dispatchEvent(new Event('change', { bubbles: true }));
                });
                const reviewPage = ctx.content.querySelector('[data-vdt-page="dsexp:review"]');
                reviewPage.addEventListener('change', () => {
                    mode = ctx.get(204, 'dsexp:review') ? 'replace' : ctx.get(205, 'dsexp:review') ? 'skip' : 'merge';
                    removeAfter = !!ctx.get(206, 'dsexp:review');
                    renderReview(ctx);
                });
            }
        });
    }

    const api = { open, groupEmbedded, finalValue };
    root.expanderMakeGlobalWizard = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
