/**
 * Melaton Mobile: DreamStudio part - Refs (#860 migration). Joins the program through
 * wmDreamStudio.extend; reaches Studio only through studioModel (studioModelRefs.js adds what it needs).
 *
 * The References tab lists every reference of the session, one row each (its picture, what it is,
 * its numbers as LCDs): the base image, the character / style (precise) references and the vibe
 * transfers, with Normalize Vibes under the vibes. A tap opens a small dialog of LCD + jog rows and
 * check boxes with Remove. Menu > Add holds the desktop Add menu's reference rows: Base Image...,
 * Vibe Transfer... (the workspace's vibes, or a gallery picture encoded first), Character / Style...,
 * and Previous Image / Current Image when the desktop offers them.
 */
(function () {
    'use strict';
    if (window.uiShell !== 'mobile' || !window.wmDreamStudio || typeof window.wmDreamStudio.extend !== 'function') return;

    window.wmDreamStudio.extend('Refs', (api, reg) => {
        const { M, esc } = api;
        const ui = () => api.ui;
        const sh = () => api.sh;
        const TYPES = { 1: 'Character and Style', 2: 'Character', 3: 'Style' };
        const pct = (v) => `${Math.round(Number(v) * 100)}%`;
        const has = (name) => M && typeof M[name] === 'function';
        const state = () => (has('refsState') ? M.refsState() : { precise: [], vibes: [], normalize: true, vibeBlock: '', preciseBlock: '' });
        const say = (text, icon = 'info') => sh().messageBox({ title: 'DreamStudio', text, icon, modal: true });
        const caps = () => (M.options() || { has: {} }).has || {};

        // ---------------------------------------------------------------- the tab

        let lastHtml = '';

        function rowHtml(key, pic, name, caption, lcds, off) {
            return `<button type="button" class="wdr-row${off ? ' is-off' : ''}" data-ref="${esc(key)}">`
                + (pic ? `<img class="wdr-pic" alt="" src="${esc(pic)}">` : '<span class="wdr-pic" aria-hidden="true"></span>')
                + `<span class="wdr-name"><b>${esc(name)}</b><span>${esc(caption)}</span></span>`
                + lcds.map(([v, signed]) => `<span class="wm-lcd wdr-lcd" data-v="${esc(Number(v).toFixed(2))}"${signed ? ' data-signed="1"' : ''}></span>`).join('')
                + '</button>';
        }

        function drawPane(el) {
            const s = api.read();
            const st = state();
            const rows = [];
            if (s.hasBaseImage) {
                const nums = [[s.strength]];
                if (caps().noise !== false) nums.push([s.noise]);
                rows.push(rowHtml('base', api.thumbUrl(s.baseImage) || st.basePreview, 'Base Image', nums.length > 1 ? 'Strength, Noise' : 'Strength', nums, false));
            }
            st.precise.forEach((r) => rows.push(rowHtml(`p:${r.key}`, r.file ? api.thumbUrl(r.file) : r.preview, TYPES[r.type] || TYPES[1], 'Strength, Fidelity', [[r.strength], [r.fidelity]], !r.enabled)));
            st.vibes.forEach((v) => rows.push(rowHtml(`v:${v.id}`, v.preview, 'Vibe Transfer', v.missing ? 'IE not encoded, Strength' : 'IE, Strength', [[v.ie == null ? 0 : v.ie], [v.strength, true]], !v.enabled)));
            let html = rows.length ? `<div class="wdr-list">${rows.join('')}</div>` : '<p class="wds-none">No references. Menu &gt; Add adds one.</p>';
            if (st.vibes.length) html += ui().check('wdrNormalize', 'Normalize Vibe Strengths', st.normalize, 'data-wdr="normalize"');
            // drawn again only when something shows differently (a paint comes with every change; the
            // list keeps its scroll place otherwise)
            if (html !== lastHtml || !el.querySelector('.wdr-list, .wds-none')) {
                lastHtml = html;
                el.innerHTML = html;
                el.querySelectorAll('.wdr-lcd').forEach((lcd) => ui().segText(lcd, lcd.dataset.v, { signed: lcd.dataset.signed === '1' }));
            }
            if (el.dataset.wdrBound) return;
            el.dataset.wdrBound = '1';
            el.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('.wdr-row');
                if (!b) return;
                const k = b.dataset.ref || '';
                if (k === 'base') baseDialog();
                else if (k.startsWith('p:')) preciseDialog(k.slice(2));
                else if (k.startsWith('v:')) vibeDialog(k.slice(2));
            });
            el.addEventListener('change', (e) => {
                const t = e.target;
                if (t && t.dataset && t.dataset.wdr === 'normalize') { M.setNormalizeVibes(!!t.checked); api.paint(); }
            });
        }

        reg.pane('refs', { draw: (el) => drawPane(el) });

        // ---------------------------------------------------------------- dialog pieces

        const lcdRow = (key, label) => `<div class="wds-wt-row is-on" data-j="${key}"><span class="wds-wt-name">${esc(label)}</span><button type="button" class="wds-wt-lcd wm-lcd wdr-padlcd" aria-label="${esc(label)}: type a value"></button></div>`;

        /**
         * A dialog row's LCD and jog: the value goes 120 ms after the wheel stops (as api.dlgJog), the
         * LCD shows a sign figure when the value can go negative and a tap on it opens the number pad.
         */
        function jogRow(row, { label, value, min, max, step, fineStep, signed = false, onChange }) {
            const lcd = row.querySelector('.wm-lcd');
            const show = (v) => ui().segText(lcd, Number(v).toFixed(2), { signed });
            let cur = Number(value) || 0;
            let timer = 0;
            show(cur);
            const jog = ui().jogWheel(row, { label, value: cur, min, max, step, fineStep, stepPx: 18, zeroStop: 0, onChange: (v) => { cur = v; show(v); clearTimeout(timer); timer = setTimeout(() => onChange(v), 120); } });
            lcd.addEventListener('click', () => ui().numPad({
                title: label,
                value: Number(cur).toFixed(2),
                point: true,
                minus: signed,
                max: 5,
                onOk: (t) => {
                    const n = parseFloat(t);
                    if (!Number.isFinite(n)) return;
                    cur = Math.max(min, Math.min(max, Math.round(n * 100) / 100));
                    show(cur);
                    if (jog && typeof jog.set === 'function') jog.set(cur);
                    onChange(cur);
                }
            }));
            return jog;
        }

        const picHtml = (src) => (src ? `<img class="wds-base-pic" alt="" src="${esc(src)}">` : '');
        const buttons = (list) => `<div class="wm-msgbox-buttons">${list.map(([act, label]) => `<button type="button" data-wdr-act="${act}">${esc(label)}</button>`).join('')}</div>`;
        const onAct = (el, map) => el.addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('[data-wdr-act]');
            if (b && map[b.dataset.wdrAct]) map[b.dataset.wdrAct]();
        });

        // ---------------------------------------------------------------- base image

        function chooseBase() {
            api.choosePicture('Base Image', (f) => { if (M.setBaseImage(f)) { api.refresh(); api.setTab('refs'); } });
        }

        /** The desktop's base image settings: Strength and Noise (where the model has noise), Change..., Remove. */
        function baseDialog() {
            const s = api.read();
            if (!s.hasBaseImage) { chooseBase(); return; }
            const noise = caps().noise !== false;
            const el = api.openDlg('Base Image', 'wdr-dlg', picHtml(api.thumbUrl(s.baseImage) || state().basePreview)
                + lcdRow('strength', 'Strength') + (noise ? lcdRow('noise', 'Noise') : '')
                + buttons([['change', 'Change...'], ['remove', 'Remove']]));
            jogRow(el.querySelector('[data-j="strength"]'), { label: 'Strength', value: Number(s.strength) || 0, min: 0, max: 1, step: 0.05, fineStep: 0.01, onChange: (v) => api.change('strength', v) });
            if (noise) jogRow(el.querySelector('[data-j="noise"]'), { label: 'Noise', value: Number(s.noise) || 0, min: 0, max: 1, step: 0.05, fineStep: 0.01, onChange: (v) => api.change('noise', v) });
            onAct(el, {
                change: () => { api.closeDlg(); chooseBase(); },
                remove: () => { M.clearBaseImage(); api.refresh(); api.closeDlg(); }
            });
        }

        // ---------------------------------------------------------------- character / style references

        /** One precise reference: Character / Style (the desktop's two toggles), on or off, Strength, Fidelity. */
        function preciseDialog(key) {
            const r = state().precise.find((x) => x.key === key);
            if (!r) return;
            const el = api.openDlg(TYPES[r.type] || 'Reference', 'wdr-dlg', picHtml(r.file ? api.thumbUrl(r.file) : r.preview)
                + `<div class="wdr-checks">${ui().check('wdrChar', 'Character', r.type === 1 || r.type === 2, 'data-pt="character"')}${ui().check('wdrStyle', 'Style', r.type === 1 || r.type === 3, 'data-pt="style"')}${ui().check('wdrOn', 'Enabled', r.enabled, 'data-pt="on"')}</div>`
                + lcdRow('strength', 'Strength') + lcdRow('fidelity', 'Fidelity')
                + buttons([['remove', 'Remove']]));
            const title = el.querySelector('.wm-msgbox-title > span');
            const put = (patch) => { M.setPrecise(key, patch); api.refresh(); };
            jogRow(el.querySelector('[data-j="strength"]'), { label: 'Strength', value: r.strength, min: 0, max: 1, step: 0.05, fineStep: 0.01, onChange: (v) => put({ strength: v }) });
            jogRow(el.querySelector('[data-j="fidelity"]'), { label: 'Fidelity', value: r.fidelity, min: 0, max: 1, step: 0.05, fineStep: 0.01, onChange: (v) => put({ fidelity: v }) });
            el.addEventListener('change', (e) => {
                const t = e.target;
                if (!t || !t.dataset || !t.dataset.pt) return;
                if (t.dataset.pt === 'on') { put({ enabled: !!t.checked }); return; }
                const c = el.querySelector('[data-pt="character"]');
                const s = el.querySelector('[data-pt="style"]');
                // as the desktop's toggles: one of the two stays on (turning off the last turns the other on)
                if (!c.checked && !s.checked) (t === c ? s : c).checked = true;
                const type = c.checked && s.checked ? 1 : c.checked ? 2 : 3;
                put({ type });
                if (title) title.textContent = TYPES[type];
            });
            onAct(el, { remove: () => { M.removePrecise(key); api.refresh(); api.closeDlg(); } });
        }

        function addPrecise() {
            const st = state();
            if (st.preciseBlock) { say(st.preciseBlock); return; }
            api.choosePicture('Character / Style', (f) => {
                M.addPrecise(f).then((res) => {
                    api.refresh();
                    if (!res.ok && res.message) say(res.message);
                    api.setTab('refs');
                });
            });
        }

        // ---------------------------------------------------------------- vibe transfers

        /** One vibe: its IE (the encodings it has for the session's model), Strength -1..1, on / off, Text Injection. */
        function vibeDialog(id) {
            const v = state().vibes.find((x) => x.id === id);
            if (!v) return;
            const ieLabel = v.ie == null ? 'None' : pct(v.ie);
            const acts = [];
            // the desktop offers a new IE where the vibe has none for this model
            if (!v.ies.length) acts.push(['ie', 'Request IE...']);
            acts.push(['remove', 'Remove']);
            const el = api.openDlg('Vibe Transfer', 'wdr-dlg', picHtml(v.preview)
                + `<div class="wds-wt-row is-on"><span class="wds-wt-name">Information Extracted</span>${ui().comboHtml('ie', ieLabel, !v.ies.length)}</div>`
                + lcdRow('strength', 'Strength')
                + `<div class="wdr-checks">${ui().check('wdrVOn', 'Enabled', v.enabled, 'data-vt="enabled"')}${ui().check('wdrVInj', 'Text Injection', v.inject, 'data-vt="inject"')}</div>`
                + buttons(acts));
            const put = (patch) => { M.setVibe(id, patch); api.refresh(); };
            ui().bindCombo(el.querySelector('.wm-combo'), v.ies.map((x) => [x, pct(x)]), v.ie, (x) => put({ ie: x }));
            jogRow(el.querySelector('[data-j="strength"]'), { label: 'Strength', value: v.strength, min: -1, max: 1, step: 0.05, fineStep: 0.01, signed: true, onChange: (x) => put({ strength: x }) });
            el.addEventListener('change', (e) => {
                const t = e.target;
                if (t && t.dataset && t.dataset.vt) put({ [t.dataset.vt]: !!t.checked });
            });
            onAct(el, {
                remove: () => { M.removeVibe(id); api.refresh(); api.closeDlg(); },
                ie: () => {
                    if (!v.locked) { encodeDialog({ id, preview: v.preview, ie: v.ie }); return; }
                    sh().messageBox({ title: 'DreamStudio', text: 'This reference cannot be modified. Would you like to remove it from your references?', icon: 'question', modal: true, buttons: [{ text: 'Remove', value: true }, { text: 'Cancel', value: false, default: true }], cancelValue: false })
                        .then((yes) => { if (yes) { M.removeVibe(id); api.refresh(); api.closeDlg(); } });
                }
            });
        }

        /**
         * Encode a vibe (the desktop's Vibe Encoding dialog): a gallery picture (filename) or a new IE for
         * a vibe (id). Model, Information Extraction (0.35 by default) and, for a picture, a comment.
         */
        function encodeDialog({ filename = '', id = '', preview = '', ie = null }) {
            const models = M.vibeModels();
            if (!models.length) { say('No model can encode vibes.'); return; }
            const cur = String(api.read().model || '').toLowerCase();
            let model = (models.find((m) => m.value.toLowerCase() === cur) || models[0]).value;
            let value = ie == null ? 0.35 : Number(ie);
            const el = api.openDlg(id ? 'Request New IE' : 'Encode Vibe', 'wdr-dlg', picHtml(filename ? api.thumbUrl(filename) : preview)
                + `<div class="wds-wt-row is-on"><span class="wds-wt-name">Model</span>${ui().comboHtml('model', (models.find((m) => m.value === model) || models[0]).name)}</div>`
                + lcdRow('ie', 'Information Extraction')
                + (id ? '' : `<div class="wds-wt-row is-on"><span class="wds-wt-name">Comment</span>${ui().edit('', '', 'data-wdr="comment" maxlength="200" placeholder="Optional"')}</div>`)
                + buttons([['encode', 'Encode']]));
            ui().bindCombo(el.querySelector('.wm-combo'), models.map((m) => [m.value, m.name]), model, (x) => { model = x; });
            jogRow(el.querySelector('[data-j="ie"]'), { label: 'Information Extraction', value, min: 0, max: 1, step: 0.05, fineStep: 0.01, onChange: (x) => { value = x; } });
            onAct(el, {
                encode: () => {
                    const c = el.querySelector('[data-wdr="comment"]');
                    const comment = c ? c.value.trim() : '';
                    api.closeDlg();
                    const job = M.encodeVibe({ filename, id, ie: value, model, comment, add: true }).then((res) => {
                        api.refresh();
                        api.setTab('refs');
                        if (!res.ok) say(res.message || 'Failed to process vibe encoding.', 'error');
                    });
                    sh().busy(job, { delay: 250 });
                }
            });
        }

        /** Vibe Transfer...: the workspace's vibes to pick from (as the desktop's reference browser), or Picture... to encode one. */
        function vibePicker() {
            const st = state();
            if (st.vibeBlock) { say(st.vibeBlock); return; }
            const el = api.openDlg('Vibe Transfer', 'wdr-dlg wdr-pickdlg', '<div class="wdr-grid"><p class="wds-none">Loading...</p></div>' + buttons([['picture', 'Picture...']]));
            const grid = el.querySelector('.wdr-grid');
            let list = [];
            M.workspaceVibes().then((vibes) => {
                if (!el.isConnected) return;
                const inSession = new Set(state().vibes.map((v) => v.id));
                // encoded for the session's model first, as those are the ones that can be used now
                list = vibes.filter((v) => !inSession.has(v.id)).sort((a, b) => (b.ies.length ? 1 : 0) - (a.ies.length ? 1 : 0));
                grid.innerHTML = list.length
                    ? list.map((v, i) => `<button type="button" class="wdr-cell${v.ies.length ? '' : ' is-off'}" data-i="${i}" aria-label="${esc(v.comment || 'Vibe')}">${v.preview ? `<img alt="" src="${esc(v.preview)}">` : ''}</button>`).join('')
                    : '<p class="wds-none">The workspace has no vibes. Picture... encodes one.</p>';
            });
            grid.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('.wdr-cell');
                const v = b && list[Number(b.dataset.i)];
                if (!v) return;
                api.closeDlg();
                M.addVibe(v.id, v.ies.length ? v.ies[0] : null).then((res) => {
                    api.refresh();
                    api.setTab('refs');
                    if (!res.ok && res.message) say(res.message);
                });
            });
            onAct(el, {
                picture: () => {
                    api.closeDlg();
                    api.choosePicture('Vibe Transfer', (f) => encodeDialog({ filename: f }));
                }
            });
        }

        // ---------------------------------------------------------------- Menu > Add

        reg.menu('add', () => {
            const st = state();
            const o = M.options();
            const rows = [
                { label: 'Base Image...', action: () => (api.read().hasBaseImage ? baseDialog() : chooseBase()) },
                // the model takes no vibes: greyed; refused for a reason of the session (a mask, precise
                // references): the desktop's message
                { label: 'Vibe Transfer...', disabled: st.vibeBlock === 'Vibe transfer is not supported on this model.', action: vibePicker },
                { label: 'Character / Style...', disabled: !(o && o.has && o.has.references) || /not supported/.test(st.preciseBlock), action: addPrecise }
            ];
            if (st.reroll) rows.push({ label: 'Previous Image', action: () => { if (M.addBaseFrom('reroll')) { api.refresh(); api.setTab('refs'); } } });
            if (st.variation) rows.push({ label: 'Current Image', action: () => { if (M.addBaseFrom('variation')) { api.refresh(); api.setTab('refs'); } } });
            return rows;
        });
    });
})();
