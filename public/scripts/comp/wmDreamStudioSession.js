/**
 * Melaton Mobile: DreamStudio part - Session (#860 migration). Joins the program through
 * wmDreamStudio.extend; reaches Studio only through studioModel (studioModelSession.js adds what it needs).
 *
 * Studio-wide controls the phone had no form for:
 *   File      Workspace... (the session's target workspace: a list with each workspace's colour and
 *             file count, the desktop combo's rows), Quick Start... (the empty preview's gallery:
 *             Quick Start and Explorer as WM tabs; a tap opens that picture's settings as the session)
 *   View      Show Both Prompt/UC (a page with both fields; a tap edits one)
 *   Generate  Upscale Scale / Upscale Delivery (#manualUpscaleChoices, while Upscale Each Print is on),
 *             Next Print: Free | N Anlas... (the price badge, the balance, 24 h prints, usage and the
 *             tokens free in Prompt and UC)
 *   Tools     vSlider (the desktop tool: a widget a group, each axis an LCD with its jog wheel; the
 *             title's menu: Edit, Reset to Default, Finalise, Delete; Menu: Add Widget, Finalise All,
 *             Revert; the widget editor as a page), Studio Activity (the log as a WM list; a row opens
 *             its description, fields and Details; Menu: Studio only, Clear Log)
 * Tools > Preferences (round 1) already holds every Studio preference; Phasewalker is Generate's
 * (round 1, the phone program); SmartText's detached window adds a tag lookup only, which Quick
 * Access's Find Tag already is on the phone.
 */
(function () {
    'use strict';
    if (window.uiShell !== 'mobile' || !window.wmDreamStudio || typeof window.wmDreamStudio.extend !== 'function') return;
    window.wmDreamStudio.extend('Session', (api, reg) => {
        const M = api.M;
        if (!M || typeof M.workspaces !== 'function') return;
        const esc = api.esc;
        const ui = () => api.ui;
        const sh = () => api.sh;
        const after = () => { api.refresh(); api.paint(); };
        const say = (text, icon = 'info', title = 'DreamStudio') => sh().messageBox({ title, text, icon, modal: true });
        const busy = (p) => sh().busy(Promise.resolve(p).catch((err) => console.warn('[wmDreamStudio] session', err)), { delay: 250 });

        // the FA font is a trimmed subset: a glyph is used only when it is in it
        const glyphs = new Map();
        function glyphOk(cls) {
            if (glyphs.has(cls)) return glyphs.get(cls);
            const i = document.createElement('i');
            i.className = cls;
            i.setAttribute('aria-hidden', 'true');
            document.body.appendChild(i);
            const c = getComputedStyle(i, '::before').content;
            i.remove();
            const ok = !!c && c !== 'none' && c !== 'normal' && c !== '""';
            glyphs.set(cls, ok);
            return ok;
        }

        // ---------------------------------------------------------------- File > Workspace

        /** The desktop combo's rows (colour, name, file count); a tap switches, as the combo does. */
        function workspaceDialog() {
            const list = M.workspaces();
            if (!list.length) { say('There are no workspaces yet.'); return; }
            const el = api.openDlg('Workspace', 'wss-wsdlg', `<div class="wm-listbox">${list.map((w) => `<button type="button" class="wm-listbox-row${w.active ? ' is-selected' : ''}" data-ws="${esc(w.id)}"><span class="wss-swatch" aria-hidden="true"></span><span class="wss-ws-name">${esc(w.name)}</span><span class="wss-ws-count">${esc(`${w.files} files`)}</span></button>`).join('')}</div>`);
            el.querySelectorAll('[data-ws]').forEach((b, i) => { if (list[i].color) b.querySelector('.wss-swatch').style.setProperty('--wss-swatch', list[i].color); });
            el.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-ws]');
                if (!b) return;
                const w = list.find((x) => x.id === b.dataset.ws);
                api.closeDlg();
                if (w && !w.active) busy(M.setWorkspace(w.id).then(after));
            });
        }

        // ---------------------------------------------------------------- File > Quick Start

        const QS_TABS = [['quickstart', 'Quick Start'], ['explorer', 'Explorer']];
        const qs = { mode: 'quickstart', rows: {}, loading: {} };

        function qsLoad(mode) {
            if (qs.rows[mode] || qs.loading[mode]) return;
            qs.loading[mode] = true;
            M.quickstart(mode).then((rows) => { qs.rows[mode] = rows; }).finally(() => { qs.loading[mode] = false; if (api.view() === 'x:quickstart') api.paint(); });
        }

        reg.view('quickstart', {
            title: 'Quick Start',
            mount(el) {
                el.classList.add('wss-qs');
                el.innerHTML = `<div class="wss-qs-grid"></div><div class="wm-tabs wss-qs-tabs" role="tablist">${QS_TABS.map(([id, label]) => `<button type="button" class="wm-tab" role="tab" data-qs="${id}" aria-selected="false">${label}</button>`).join('')}</div>`;
                el.addEventListener('click', (e) => {
                    const t = e.target.closest && e.target.closest('[data-qs]');
                    if (t) { qs.mode = t.dataset.qs; api.paint(); return; }
                    const card = e.target.closest && e.target.closest('[data-qs-key]');
                    if (!card) return;
                    const mode = qs.mode;
                    busy(M.openQuickstart(mode, card.dataset.qsKey).then((ok) => {
                        if (!ok) return;
                        api.closeView();
                        api.setTab('prompt');
                    }));
                });
            },
            draw(el) {
                el.querySelectorAll('[data-qs]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.qs === qs.mode)));
                const grid = el.querySelector('.wss-qs-grid');
                const rows = qs.rows[qs.mode];
                if (!rows) qsLoad(qs.mode);
                const key = `${qs.mode}:${rows ? rows.length : 'loading'}`;
                if (grid.dataset.key === key) return;
                grid.dataset.key = key;
                grid.scrollTop = 0;
                if (!rows) { grid.innerHTML = `<p class="wds-none">${qs.mode === 'explorer' ? 'Loading Explorer...' : 'Loading Quick Start...'}</p>`; return; }
                if (!rows.length) { grid.innerHTML = `<p class="wds-none">${qs.mode === 'explorer' ? 'Explorer has nothing to show right now.' : 'Quick Start could not be loaded.'}</p>`; return; }
                let section = null;
                grid.innerHTML = rows.map((r) => {
                    const head = r.section && r.section !== section ? `<p class="wss-qs-sec">${esc(r.section)}</p>` : '';
                    section = r.section;
                    return `${head}<button type="button" class="wss-qs-card" data-qs-key="${esc(r.key)}" aria-label="${esc(r.label)}"><img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(r.full || r.thumb)}"></button>`;
                }).join('');
            }
        });

        // ---------------------------------------------------------------- View > Show Both Prompt/UC

        const BOTH = [['prompt', 'Prompt', 'Tap here to write the prompt'], ['uc', 'Undesired', 'Tap here to list what to leave out']];
        let bothSeq = 0;
        reg.view('both', {
            title: 'Prompt and UC',
            mount(el) {
                el.classList.add('wds-fields', 'wss-both');
                el.innerHTML = BOTH.map(([id, label]) => `<div class="wds-label"><span>${label}</span><span data-both-count="${id}"></span></div><button type="button" class="wds-field wss-both-box" data-both="${id}"></button>`).join('');
                el.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-both]'); if (b) api.openEditor(b.dataset.both); });
            },
            draw(el) {
                const s = api.read();
                const seq = ++bothSeq;
                const limit = M.tokenLimit() || 512;
                BOTH.forEach(([id, , hint]) => {
                    const box = el.querySelector(`[data-both="${id}"]`);
                    const text = String(s[id] || '');
                    box.classList.toggle('is-empty', !text);
                    box.innerHTML = text ? `<span>${esc(text)}</span>` : `<span class="wss-hint">${esc(hint)}</span>`;
                    const out = el.querySelector(`[data-both-count="${id}"]`);
                    Promise.resolve(text ? M.tokens(text) : 0).then((n) => {
                        if (seq !== bothSeq || n == null) return;
                        const total = n + (M.addedTokens(id) || 0);
                        out.textContent = `${total}/${limit}`;
                        out.classList.toggle('is-over', total > limit);
                    });
                });
            }
        });

        // ---------------------------------------------------------------- Generate > Anlas

        function moneyDialog() {
            const m = M.money();
            const s = api.read();
            const n = (v) => (v == null ? '-' : Number(v).toLocaleString());
            const facts = [
                ['Next print:', m.price > 0 ? `${n(m.price)} Anlas` : 'Free'],
                ['Free Anlas:', m.deferred ? '---' : n(m.fixed)],
                ['Paid Anlas:', m.deferred ? '---' : n(m.paid)],
                ['Prints (24 h):', n(m.count)]
            ];
            if (m.usage) facts.push(['Usage:', m.usage]);
            // the desktop badge: the model's token limit less the field's own words and what Studio adds
            const limit = M.tokenLimit();
            const draw = (p, u) => {
                const rows = limit == null ? facts : facts.concat([['Prompt tokens free:', p], ['UC tokens free:', u]]);
                return `<div class="wss-money">${ui().facts(rows)}</div>`;
            };
            const el = api.openDlg('Anlas', 'wss-moneydlg', draw('...', '...'));
            if (limit == null) return;
            Promise.all(['prompt', 'uc'].map((f) => Promise.resolve(s[f] ? M.tokens(s[f]) : 0).then((own) => (own == null ? null : limit - own - (M.addedTokens(f) || 0)))))
                .then(([p, u]) => {
                    const body = el.querySelector('.wds-dlg-body');
                    if (el.isConnected && body) body.innerHTML = draw(p == null ? '-' : String(p), u == null ? '-' : String(u));
                });
        }

        function generateRows() {
            const rows = ['-'];
            const u = M.upscaleChoices();
            if (u.on) {
                // the worker's own list (an 8x scale comes with a worker that can): asked for next time
                M.refreshUpscaleStatus();
                const pick = (kind) => () => M.upscaleChoices()[kind].map((r) => ({ label: r.sub && r.sub.length <= 12 ? `${r.label} (${r.sub})` : r.label, radio: r.radio, disabled: r.disabled, action: () => { M.setUpscaleChoice(kind, r.value); after(); } }));
                if (u.scale.length) rows.push({ label: 'Upscale Scale', submenu: pick('scale') });
                if (u.speed.length) rows.push({ label: 'Upscale Delivery', submenu: pick('speed') });
            }
            const m = M.money();
            rows.push({ label: m.price > 0 ? `Next Print: ${m.price} Anlas...` : 'Next Print: Free...', action: moneyDialog });
            return rows;
        }

        // ---------------------------------------------------------------- Tools > vSlider

        const jogs = new Map();
        const pct = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100);

        function bindJog(row, key, { label, value, min, max, step, fineStep = 0, digits = 0, onChange }) {
            const lcd = row.querySelector('.wm-lcd');
            ui().segText(lcd, Number(value).toFixed(digits));
            let timer = 0;
            const h = ui().jogWheel(row, { label, value, min, max, step, fineStep, stepPx: 18, zeroStop: 0, onChange: (v) => { ui().segText(lcd, Number(v).toFixed(digits)); clearTimeout(timer); timer = setTimeout(() => onChange(v), 120); } });
            if (key) jogs.set(key, h);
            return h;
        }

        function vsWidgetMenu(btn, w) {
            sh().dropdown(btn, [
                { label: 'Edit...', action: () => vsEdit(w.id) },
                { label: 'Reset to Default', action: () => { M.vsReset(w.id); vsRefresh(); } },
                { label: 'Finalise', action: () => { M.vsFinalise(w.id); after(); } },
                '-',
                { label: 'Delete', action: () => { M.vsDelete(w.id); after(); } }
            ], 'left');
        }

        function vsAxisRowHtml(w, a) {
            return `<div class="wds-wt-row is-on" data-vs-axis="${esc(a.id)}"><span class="wds-wt-name"></span><button type="button" class="wds-wt-lcd wm-lcd" data-vs-pad aria-label="${esc(a.label)}"></button></div>`
                + (w.kind === 'slider' ? '<p class="wss-vs-status" data-vs-status></p><p class="wss-vs-status" data-vs-blend></p>' : '');
        }

        function vsBuild(el, d) {
            jogs.clear();
            const list = el.querySelector('.wss-vs-list');
            if (!d.widgets.length) {
                list.innerHTML = '<p class="wds-none">There are no vSlider widgets for this print.</p><p class="wm-form-note">Add one here, or send a vSlider list through Change JSON or MCP.</p><div class="wm-msgbox-buttons"><button type="button" data-vs-add>Add Widget...</button></div>';
                return;
            }
            list.innerHTML = d.widgets.map((w) => `<div class="wss-vs-card" data-vs="${esc(w.id)}"><button type="button" class="wss-vs-title" data-vs-menu aria-haspopup="menu"><b></b><span></span></button>${w.kind === 'dropdown'
                ? '<div class="wss-vs-pick"><button type="button" class="wm-combo" data-vs-combo><span></span></button></div><p class="wss-vs-status" data-vs-text></p>'
                : w.axes.map((a) => vsAxisRowHtml(w, a)).join('')}</div>`).join('');
            d.widgets.forEach((w) => {
                const card = list.querySelector(`[data-vs="${CSS.escape(w.id)}"]`);
                w.axes.forEach((a) => {
                    const row = card.querySelector(`[data-vs-axis="${CSS.escape(a.id)}"]`);
                    bindJog(row, `${w.id}\n${a.id}`, { label: a.label, value: pct(a.value), min: 0, max: 100, step: 1, onChange: (v) => { M.vsSet(w.id, a.id, v / 100); vsRefresh(); } });
                });
            });
        }

        /** The readouts again (no rebuild: a wheel being rolled keeps rolling). */
        function vsUpdate(el, d) {
            const list = el.querySelector('.wss-vs-list');
            d.widgets.forEach((w) => {
                const card = list.querySelector(`[data-vs="${CSS.escape(w.id)}"]`);
                if (!card) return;
                card.classList.toggle('is-dirty', w.dirty);
                card.querySelector('.wss-vs-title > b').textContent = w.title;
                card.querySelector('.wss-vs-title > span').textContent = w.badge;
                if (w.kind === 'dropdown') {
                    const opt = w.options.find((o) => o.id === w.value);
                    card.querySelector('[data-vs-combo] > span').textContent = opt ? opt.label : '';
                    card.querySelector('[data-vs-text]').textContent = w.text;
                    return;
                }
                w.axes.forEach((a) => {
                    const row = card.querySelector(`[data-vs-axis="${CSS.escape(a.id)}"]`);
                    if (!row) return;
                    // a slider's name is its axis; the pad's and star's axes show the stop they are nearest
                    row.querySelector('.wds-wt-name').textContent = w.kind === 'slider' ? a.label : `${a.label}: ${a.nearer}`;
                    const lcd = row.querySelector('.wm-lcd');
                    const text = String(pct(a.value));
                    if (lcd.dataset.v !== text) { lcd.dataset.v = text; ui().segText(lcd, text); }
                    const h = jogs.get(`${w.id}\n${a.id}`);
                    if (h && typeof h.set === 'function') h.set(pct(a.value));
                    const st = card.querySelector(`[data-vs-axis="${CSS.escape(a.id)}"] + [data-vs-status]`);
                    if (st) {
                        st.textContent = a.status;
                        const blend = st.nextElementSibling;
                        blend.textContent = a.blend ? `Writes: ${a.blend}` : '';
                        blend.hidden = !a.blend;
                    }
                });
            });
            const note = el.querySelector('.wss-vs-note');
            note.textContent = d.note;
            note.hidden = !d.note;
        }

        let vsEl = null;
        function vsRefresh() { if (vsEl && api.view() === 'x:vslider') { const d = M.vsList(); if (d) vsUpdate(vsEl, d); } }

        reg.view('vslider', {
            title: 'vSlider',
            mount(el) {
                vsEl = el;
                el.classList.add('wm-form', 'wss-vs');
                el.innerHTML = '<div class="wss-vs-list"></div><p class="wm-form-note wss-vs-note" hidden></p>';
                el.addEventListener('click', (e) => {
                    const t = e.target.closest ? e.target : null;
                    if (!t) return;
                    if (t.closest('[data-vs-add]')) { vsEdit(null); return; }
                    const card = t.closest('[data-vs]');
                    const d = card && M.vsList();
                    const w = d && d.widgets.find((x) => x.id === card.dataset.vs);
                    if (!w) return;
                    const menuBtn = t.closest('[data-vs-menu]');
                    if (menuBtn) { vsWidgetMenu(menuBtn, w); return; }
                    const combo = t.closest('[data-vs-combo]');
                    if (combo) {
                        sh().dropdown(combo, w.options.map((o) => ({ label: o.label, radio: o.id === w.value, action: () => { M.vsSet(w.id, null, o.id); vsRefresh(); } })), 'left');
                        return;
                    }
                    const lcd = t.closest('[data-vs-pad]');
                    if (lcd) {
                        const a = w.axes.find((x) => x.id === lcd.closest('[data-vs-axis]').dataset.vsAxis);
                        if (!a) return;
                        ui().numPad({ title: a.label, value: String(pct(a.value)), max: 3, onOk: (txt) => { const v = Number(txt); if (Number.isFinite(v)) { M.vsSet(w.id, a.id, Math.max(0, Math.min(100, v)) / 100); vsRefresh(); } } });
                    }
                });
            },
            draw(el) {
                M.vsHydrate();
                const d = M.vsList();
                if (!d) { el.querySelector('.wss-vs-list').innerHTML = '<p class="wds-none">vSlider is not loaded yet.</p>'; el._key = ''; return; }
                const key = JSON.stringify(d.widgets.map((w) => [w.id, w.kind, w.axes.map((a) => a.id), w.options && w.options.map((o) => o.id)]));
                if (el._key !== key) { el._key = key; vsBuild(el, d); }
                vsUpdate(el, d);
            },
            menu() {
                const d = M.vsList();
                const any = !!(d && d.widgets.length);
                return [
                    { label: 'Add Widget...', disabled: !d, action: () => vsEdit(null) },
                    '-',
                    { label: 'Finalise All', disabled: !any, action: () => { M.vsFinaliseAll(); after(); } },
                    { label: 'Revert', disabled: !(d && d.dirty), action: () => { M.vsRevertAll(); vsRefresh(); } }
                ];
            }
        });

        // ---- the widget editor (the desktop's Vista form as a WM page)

        const KINDS = [['slider', 'Slider'], ['xypad', 'XY pad'], ['star', 'Star'], ['dropdown', 'Drop-down list']];
        const STAR_MAX = 8;
        const ve = { draft: null, id: null };
        const clamp01 = (n) => { const v = Number(n); return !Number.isFinite(v) ? 0 : Math.max(0, Math.min(1, v)); };
        const perAxis = (d) => (d.kind === 'xypad' || d.kind === 'star') && !(d.target && d.target.kind === 'prompt');
        const axisPrefix = (d, a) => (a.target && a.target.kind === 'expander' && a.target.prefix ? a.target.prefix : a.id || '');

        function vsEdit(id) {
            ve.id = id || null;
            ve.draft = M.vsDraft(id, 'slider');
            if (!ve.draft) return;
            const el = api.$('.wds-xview[data-xview="vsedit"]');
            if (el) el._key = '';
            api.openView('vsedit');
        }

        function removeCell(attr, off, label) {
            const icon = glyphOk('fas fa-trash') ? api.toolIcon('fas fa-trash') : 'x';
            return `<button type="button" class="wm-tool" ${attr}${off ? ' disabled' : ''} aria-label="${label}" title="${label}">${icon}</button>`;
        }

        function veHtml() {
            const d = ve.draft;
            const u = ui();
            const toPrompt = !!(d.target && d.target.kind === 'prompt');
            const pa = perAxis(d);
            let h = u.row('Kind:', u.comboHtml('ve-kind', (KINDS.find((k) => k[0] === d.kind) || KINDS[0])[1]))
                + u.row('Title:', u.edit('', d.title || '', 'data-ve="title" autocapitalize="off" spellcheck="false"'))
                + u.row('Writes to:', u.comboHtml('ve-target', toPrompt ? 'The prompt' : (pa ? 'An expander per axis' : 'An expander')));
            if (!toPrompt && !pa) h += u.row('Expander:', u.edit('', d.target && d.target.prefix ? d.target.prefix : '', 'data-ve="prefix" placeholder="prefix, without !" autocapitalize="off" spellcheck="false"'));
            if (d.kind === 'dropdown') {
                h += u.sub('Options') + d.options.map((o, i) => `<div class="wss-ve-opt" data-ve-opt="${i}">${u.edit('', o.id, 'data-f="id" aria-label="Id" placeholder="Id" autocapitalize="off" spellcheck="false"')}${u.edit('', o.label, 'data-f="label" aria-label="Label" placeholder="Label"')}${u.edit('', o.text, 'data-f="text" aria-label="Prompt text" placeholder="Prompt text" autocapitalize="off" spellcheck="false"')}${removeCell('data-ve-rmopt', d.options.length <= 1, 'Remove')}</div>`).join('')
                    + `<div class="wss-ve-actions"><button type="button" class="wm-button" data-ve-act="addopt">Add Option</button>${u.row('Default:', u.comboHtml('ve-default', (d.options.find((o) => o.id === d.default) || d.options[0] || { label: '' }).label || d.default || ''))}</div>`;
                return h;
            }
            d.axes.forEach((a, ai) => {
                h += `<div class="wss-ve-axis" data-ve-axis="${ai}">${u.sub(`Axis ${ai + 1}`)}`
                    + u.row('Id:', u.edit('', a.id, 'data-f="id" autocapitalize="off" spellcheck="false"'))
                    + u.row('Label:', u.edit('', a.label, 'data-f="label"'))
                    + (pa ? u.row('Expander:', u.edit('', axisPrefix(d, a), 'data-f="prefix" placeholder="prefix, without !" autocapitalize="off" spellcheck="false"')) : '')
                    + '<div class="wds-wt-row is-on" data-ve-def><span class="wds-wt-name">Default:</span><button type="button" class="wds-wt-lcd wm-lcd" data-ve-pad="def" aria-label="Default"></button></div>'
                    + a.stops.map((s, si) => `<div class="wss-ve-stop" data-ve-stop="${si}"><button type="button" class="wds-wt-lcd wm-lcd" data-ve-pad="at" aria-label="Position (0 to 1)"></button>${u.edit('', s.text, 'data-f="text" aria-label="Prompt text" placeholder="Prompt text" autocapitalize="off" spellcheck="false"')}${removeCell('data-ve-rmstop', a.stops.length <= 2, 'Remove')}</div>`).join('')
                    + '<div class="wss-ve-actions"><button type="button" class="wm-button" data-ve-act="addstop">Add Stop</button></div></div>';
            });
            if (d.kind === 'star') h += `<div class="wss-ve-actions"><button type="button" class="wm-button" data-ve-act="addaxis"${d.axes.length >= STAR_MAX ? ' disabled' : ''}>Add Axis</button><button type="button" class="wm-button" data-ve-act="rmaxis"${d.axes.length <= 2 ? ' disabled' : ''}>Remove Axis</button></div>`;
            return h;
        }

        function veRender(el) {
            const d = ve.draft;
            el.innerHTML = veHtml();
            el.querySelectorAll('.wss-ve-stop').forEach((row) => {
                const a = d.axes[Number(row.closest('[data-ve-axis]').dataset.veAxis)];
                ui().segText(row.querySelector('.wm-lcd'), Number(a.stops[Number(row.dataset.veStop)].at).toFixed(2));
            });
            el.querySelectorAll('[data-ve-def]').forEach((row) => {
                const a = d.axes[Number(row.closest('[data-ve-axis]').dataset.veAxis)];
                if (a.default == null) a.default = 0.5;
                bindJog(row, '', { label: 'Default', value: clamp01(a.default), min: 0, max: 1, step: 0.05, fineStep: 0.01, digits: 2, onChange: (v) => { a.default = clamp01(v); } });
            });
            // the combos
            const kind = el.querySelector('[data-act="ve-kind"]');
            if (kind) {
                ui().bindCombo(kind, KINDS, d.kind, (k) => {
                    const keptId = d.id;
                    const keptTitle = d.title;
                    const next = M.vsDraft(null, k);
                    if (!next) return;
                    next.id = keptId;
                    if (keptTitle) next.title = keptTitle;
                    ve.draft = next;
                    veRender(el);
                });
            }
            const target = el.querySelector('[data-act="ve-target"]');
            if (target) {
                const pa = (d.kind === 'xypad' || d.kind === 'star');
                ui().bindCombo(target, [['expander', pa ? 'An expander per axis' : 'An expander'], ['prompt', 'The prompt']], d.target && d.target.kind === 'prompt' ? 'prompt' : 'expander', (v) => {
                    if (v === 'prompt') d.target = { kind: 'prompt' };
                    else d.target = { kind: 'expander', prefix: String(d.title || (d.axes && d.axes[0] && d.axes[0].id) || 'body').trim().replace(/\W+/g, '_') };
                    d.commit = v === 'prompt' ? 'prompt' : 'expander';
                    veRender(el);
                });
            }
            const def = el.querySelector('[data-act="ve-default"]');
            if (def) ui().bindCombo(def, d.options.filter((o) => String(o.id || '').trim()).map((o) => [o.id, o.label || o.id]), d.default, (v) => { d.default = v; });
        }

        reg.view('vsedit', {
            title: () => (ve.id ? 'Edit Widget' : 'Add Widget'),
            mount(el) {
                el.classList.add('wm-form', 'wss-ve');
                // what is typed goes into the draft at once (the desktop editor's inputs do the same)
                el.addEventListener('input', (e) => {
                    const t = e.target;
                    const d = ve.draft;
                    if (!d || !t || !t.matches('input')) return;
                    if (t.dataset.ve === 'title') { d.title = t.value; return; }
                    if (t.dataset.ve === 'prefix') { d.target = { kind: 'expander', prefix: t.value.trim().replace(/^!/, '') }; return; }
                    const opt = t.closest('[data-ve-opt]');
                    if (opt) { d.options[Number(opt.dataset.veOpt)][t.dataset.f] = t.value; return; }
                    const axisEl = t.closest('[data-ve-axis]');
                    const a = axisEl && d.axes[Number(axisEl.dataset.veAxis)];
                    if (!a) return;
                    const stop = t.closest('[data-ve-stop]');
                    if (stop) { a.stops[Number(stop.dataset.veStop)].text = t.value; return; }
                    if (t.dataset.f === 'id') a.id = t.value.trim();
                    else if (t.dataset.f === 'label') a.label = t.value;
                    else if (t.dataset.f === 'prefix') a.target = { kind: 'expander', prefix: t.value.trim().replace(/^!/, '') };
                });
                el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('input')) e.target.blur(); });
                el.addEventListener('click', (e) => {
                    const t = e.target.closest ? e.target : null;
                    const d = ve.draft;
                    if (!t || !d) return;
                    const axisEl = t.closest('[data-ve-axis]');
                    const a = axisEl && d.axes[Number(axisEl.dataset.veAxis)];
                    const act = t.closest('[data-ve-act]');
                    if (act) {
                        const k = act.dataset.veAct;
                        if (k === 'addopt') { const oid = `opt${d.options.length + 1}`; d.options.push({ id: oid, label: oid, text: oid }); } else if (k === 'addstop' && a) a.stops.push({ at: 1, text: 'new' });
                        else if (k === 'addaxis' && d.axes.length < STAR_MAX) { const n = d.axes.length; d.axes.push({ id: `axis${n}`, label: `axis${n}`, default: 0.5, target: { kind: 'expander', prefix: `axis${n}` }, stops: [{ at: 0, text: 'low' }, { at: 0.5, text: 'mid' }, { at: 1, text: 'high' }] }); } else if (k === 'rmaxis' && d.axes.length > 2) d.axes.pop();
                        veRender(el);
                        return;
                    }
                    if (t.closest('[data-ve-rmopt]')) { if (d.options.length > 1) { d.options.splice(Number(t.closest('[data-ve-opt]').dataset.veOpt), 1); veRender(el); } return; }
                    if (t.closest('[data-ve-rmstop]') && a) { if (a.stops.length > 2) { a.stops.splice(Number(t.closest('[data-ve-stop]').dataset.veStop), 1); veRender(el); } return; }
                    const pad = t.closest('[data-ve-pad]');
                    if (pad && a) {
                        const stop = pad.dataset.vePad === 'at' ? a.stops[Number(pad.closest('[data-ve-stop]').dataset.veStop)] : null;
                        const cur = stop ? stop.at : a.default;
                        ui().numPad({
                            title: stop ? 'Position' : 'Default',
                            value: String(Number(Number(cur).toFixed(2))),
                            point: true,
                            max: 4,
                            onOk: (txt) => {
                                const v = Number(txt);
                                if (!Number.isFinite(v)) return;
                                if (stop) stop.at = clamp01(v); else a.default = clamp01(v);
                                veRender(el);
                            }
                        });
                    }
                });
            },
            draw(el) {
                if (!ve.draft) { el.innerHTML = ''; return; }
                if (el._key === 'drawn') return;
                el._key = 'drawn';
                veRender(el);
            },
            softKeys: () => ({
                left: {
                    label: 'Save',
                    action: () => {
                        const active = document.activeElement;
                        if (active && active.blur) active.blur();
                        const err = M.vsSave(ve.draft, ve.id);
                        if (err) { say(err, 'error', 'vSlider'); return; }
                        ve.draft = null;
                        api.closeView();
                        api.refresh();
                        if (api.view() !== 'x:vslider') api.openView('vslider'); else api.paint();
                    }
                },
                right: { label: 'Cancel', action: () => { ve.draft = null; api.closeView(); } }
            })
        });

        // ---------------------------------------------------------------- Tools > Studio Activity

        function activityDialog(r) {
            const u = ui();
            const el = api.openDlg(r.title, 'wss-actdlg', `<p class="wss-act-desc"></p>${u.facts(r.fields)}<textarea class="wm-edit wss-act-json" readonly spellcheck="false" hidden></textarea><div class="wm-msgbox-buttons"><button type="button" data-act-btn="details">Details</button><button type="button" data-act-btn="copy">Copy</button></div>`);
            el.querySelector('.wss-act-desc').textContent = r.description.join('\n');
            el.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-act-btn]');
                if (!b) return;
                if (b.dataset.actBtn === 'details') {
                    const ta = el.querySelector('.wss-act-json');
                    ta.hidden = !ta.hidden;
                    if (!ta.hidden) ta.value = r.details();
                    // the desktop pane's two tabs: General (the description and fields) or Details
                    el.querySelectorAll('.wss-act-desc, .wds-dlg-body > .wm-facts').forEach((x) => { x.hidden = !ta.hidden; });
                    b.textContent = ta.hidden ? 'Details' : 'General';
                    return;
                }
                const text = r.copy();
                const done = () => { b.textContent = 'Copied'; };
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => say('The text could not be copied.', 'error', 'Studio Activity'));
            });
        }

        reg.view('activity', {
            title: 'Studio Activity',
            mount(el) {
                el.classList.add('wss-act');
                el.addEventListener('click', (e) => {
                    const row = e.target.closest && e.target.closest('[data-act-id]');
                    if (!row) return;
                    const d = M.activity();
                    const r = d && d.rows.find((x) => String(x.id) === row.dataset.actId);
                    if (r) activityDialog(r);
                });
            },
            draw(el) {
                const d = M.activity();
                if (!d) { el.innerHTML = '<p class="wds-none">Studio Activity is not loaded yet.</p>'; return; }
                const key = `${d.studioOnly}|${d.rows.map((r) => `${r.id}:${r.action}:${r.level}`).join(',')}`;
                if (el._key === key) return;
                el._key = key;
                if (!d.rows.length) { el.innerHTML = '<p class="wds-none">There are no items to show in this view.</p>'; return; }
                el.innerHTML = `<div class="wm-listbox wss-act-list">${d.rows.map((r) => {
                    const art = ui().art(`msgbox-${r.level === 'error' || r.level === 'warning' ? r.level : 'info'}`);
                    return `<button type="button" class="wm-listbox-row wss-act-row" data-act-id="${r.id}"><img alt="${esc(r.levelLabel)}" src="${esc(art.src)}"${art.srcset ? ` srcset="${esc(art.srcset)}"` : ''}><span class="wss-act-main"><span class="wss-act-what">${esc(r.action)}</span><span class="wss-act-sub">${esc(`${r.when}, ${r.source}, ${r.actor}`)}</span></span></button>`;
                }).join('')}</div>`;
            },
            menu() {
                const d = M.activity();
                return [
                    { label: 'Studio only', checked: !!(d && d.studioOnly), disabled: !d, action: () => { M.activityStudioOnly(!(d && d.studioOnly)); api.paint(); } },
                    { label: 'Clear Log', disabled: !(d && d.total), action: () => { M.activityClear(); api.paint(); } }
                ];
            }
        });
        M.on('activity', () => { if (api.view() === 'x:activity') api.paint(); });

        // ---------------------------------------------------------------- menus

        reg.menu('file', () => {
            const cur = M.workspaces().find((w) => w.active);
            return [
                '-',
                { label: cur ? `Workspace: ${cur.name}...` : 'Workspace...', action: workspaceDialog },
                { label: 'Quick Start...', action: () => api.openView('quickstart') }
            ];
        });
        reg.menu('view', () => [{ label: 'Show Both Prompt/UC', checked: api.view() === 'x:both', action: () => (api.view() === 'x:both' ? api.closeView() : api.openView('both')) }]);
        // right under the program's Upscale Each Print (the upscale options belong with it)
        reg.menu('generate', generateRows, { order: 10 });
        reg.menu('tools', () => [
            { label: 'vSlider', action: () => api.openView('vslider') },
            { label: 'Studio Activity', action: () => api.openView('activity') }
        ]);
    });
})();
