/**
 * Melaton Mobile: DreamStudio part - Rack (#860 migration). Joins the program through
 * wmDreamStudio.extend; reaches Studio only through studioModel (studioModelRack.js adds what it needs).
 *
 * The desktop's Weight Rack (Prompt menu > Weight Rack, emphasisGroupsToolManager.js) as a full page
 * of its own (Yukimi, Nov 16: "like a main view"), over every prompt field at once: Prompt, the
 * Directive (while Rentan's creative mode is on), UC, the inline negative and each character's prompt
 * and UC. A field with weighted groups gets its name as a sub-header, then its text in prompt order:
 * each group a row (its text, its weight as a signed LCD, a jog wheel and the square default button),
 * the plain text between groups a dimmed 1.00 row as the desktop shows it. A tap on a group's text
 * selects it and opens its tools (the desktop card's: Merge with Previous Group, Split at Commas,
 * its sign); a tap on the LCD types the weight on the number pad. Weights go back into the field's
 * text in the plain `1.2::text::` form; a group stays a group at 1.00 (the desktop rack keeps it).
 */
(function () {
    'use strict';
    if (window.uiShell !== 'mobile' || !window.wmDreamStudio || typeof window.wmDreamStudio.extend !== 'function') return;
    window.wmDreamStudio.extend('Rack', (api, reg) => {
        const { esc } = api;
        // the jog's range and steps (the phone's emphasis range: the editor's Weight Rack pop-up has the same)
        const JOG = { min: -3, max: 5, step: 0.1, fineStep: 0.01, def: 1 };
        const clamp = (w) => Math.max(JOG.min, Math.min(JOG.max, Math.round(w * 100) / 100));
        const fmtLcd = (w) => Number(w).toFixed(2);

        /** The fields the rack covers, in the program's order (characters last, prompt then UC each). */
        function fields() {
            const out = ['prompt'];
            if (api.M && typeof api.M.directiveOn === 'function' && api.M.directiveOn()) out.push('directive');
            out.push('uc', 'negative');
            (api.read().characters || []).forEach((_, i) => out.push(`c:${i}:prompt`, `c:${i}:uc`));
            return out;
        }

        /**
         * A field's text cut into its weighted groups and the plain runs between them (the desktop's
         * context cards: a run of only commas / spaces is none, its outer commas and spaces left off).
         */
        function parse(text) {
            const items = [];
            const re = new RegExp(api.WEIGHT_RE.source, 'g');
            let at = 0;
            let k = 0;
            const plain = (from, to) => {
                const s = text.slice(from, to).replace(/^[,\s]+|[,\s]+$/g, '');
                if (s) items.push({ plain: true, inner: s });
            };
            let m;
            while ((m = re.exec(text))) {
                plain(at, m.index);
                items.push({ k: k++, from: m.index, to: m.index + m[0].length, raw: m[1], weight: Number(m[1]), inner: m[2] });
                at = m.index + m[0].length;
            }
            plain(at, text.length);
            return items;
        }
        const groupsOf = (items) => items.filter((g) => !g.plain);

        // ---- writing: a field's text is read fresh and rewritten per write; writes to one field queue
        // up behind each other (each one waits for the last to reach Studio)

        const pending = {};
        const timers = {};
        const chains = {};
        const busy = {};
        const rowKey = (fid, k) => `${fid}|${k}`;

        function rewrite(text, fn) {
            const re = new RegExp(api.WEIGHT_RE.source, 'g');
            let k = 0;
            return text.replace(re, (whole, raw, inner) => { const out = fn({ k: k++, raw, weight: Number(raw), inner }); return out == null ? whole : out; });
        }

        function queue(fid, job) {
            chains[fid] = (chains[fid] || Promise.resolve()).then(() => {
                api.refresh();
                const text = api.fieldValue(fid);
                const out = job(text);
                if (out == null || out === text) return null;
                return api.fieldSet(fid, out);
            }).catch((err) => console.warn('[wmDreamStudio] rack', fid, err));
            return chains[fid];
        }

        function flush(fid) {
            clearTimeout(timers[fid]);
            const map = pending[fid];
            delete pending[fid];
            if (!map || !map.size) return chains[fid] || Promise.resolve();
            return queue(fid, (text) => rewrite(text, (g) => (map.has(g.k) ? `${api.fmtWeight(map.get(g.k))}::${g.inner}::` : null)));
        }

        /** A weight rolled or typed: shown at once, written once the finger rests (each write repaints). */
        function setWeight(fid, k, w, hold = true) {
            // a row being rolled keeps its own figures for a moment (Studio's echo of an older step must not jump it back)
            if (hold) busy[rowKey(fid, k)] = Date.now() + 900;
            (pending[fid] = pending[fid] || new Map()).set(k, w);
            clearTimeout(timers[fid]);
            timers[fid] = setTimeout(() => flush(fid), 120);
        }

        /** A change to the field's groups themselves (merge, split): pending weights go first. */
        function restructure(fid, job) {
            return flush(fid).then(() => queue(fid, job)).then(() => { selected = null; api.paint(); });
        }

        // ---- the group's tools (the desktop card's buttons)

        let selected = null; // { fid, k }

        /** Merge with Previous Group: only when commas / spaces alone stand between them; the weight is their average. */
        function canMerge(text, k) {
            const gs = groupsOf(parse(text));
            const a = gs[k - 1];
            const b = gs[k];
            return !!(a && b && /^[ ,]*$/.test(text.slice(a.to, b.from)) && a.inner.trim() && b.inner.trim());
        }
        function merge(fid, k) {
            restructure(fid, (text) => {
                if (!canMerge(text, k)) return null;
                const gs = groupsOf(parse(text));
                const a = gs[k - 1];
                const b = gs[k];
                // the prompt's own separator between them is kept (never a comma made up)
                const inner = `${a.inner.trim()}${text.slice(a.to, b.from)}${b.inner.trim()}`;
                const w = String(Number(((a.weight + b.weight) / 2).toFixed(4)));
                return `${text.slice(0, a.from)}${w}::${inner}::${text.slice(b.to)}`;
            });
        }

        /** Split at Commas: each ", " part its own group at the same weight, as written. */
        const partsOf = (inner) => String(inner || '').split(', ').map((s) => s.trim()).filter(Boolean);
        function split(fid, k) {
            restructure(fid, (text) => {
                const g = groupsOf(parse(text))[k];
                const parts = g ? partsOf(g.inner) : [];
                if (parts.length < 2) return null;
                return `${text.slice(0, g.from)}${parts.map((p) => `${g.raw}::${p}::`).join(', ')}${text.slice(g.to)}`;
            });
        }

        /**
         * The desktop card's sign button: to negative keeps a weight already under 1 and makes any
         * other one -|w|; to positive the range starts at 1 (a weight under 1 in size becomes 1).
         */
        function flipSign(fid, k) {
            const g = groupsOf(parse(api.fieldValue(fid)))[k];
            if (!g) return;
            const neg = g.weight < 1;
            const w = neg ? (Math.abs(g.weight) < 1 ? 1 : Math.abs(g.weight)) : -Math.abs(g.weight);
            setWeight(fid, k, clamp(w), false);
            flush(fid).then(() => api.paint());
        }

        function groupRows(sel) {
            const text = sel ? api.fieldValue(sel.fid) : '';
            const g = sel ? groupsOf(parse(text))[sel.k] : null;
            return [
                { label: 'Merge with Previous Group', disabled: !g || !canMerge(text, sel.k), action: () => merge(sel.fid, sel.k) },
                { label: 'Split at Commas', disabled: !g || partsOf(g.inner).length < 2, action: () => split(sel.fid, sel.k) },
                '-',
                { label: 'Negative Weight', checked: !!g && g.weight < 1, disabled: !g, action: () => flipSign(sel.fid, sel.k) }
            ];
        }

        // the kit's pad has one key left of 0 (a point or a minus): the point here, a weight's sign is
        // the group's Negative Weight (or the wheel past 0); a negative weight is typed as its size
        function typeWeight(fid, k, now) {
            api.ui.numPad({
                title: 'Weight',
                value: api.fmtWeight(Math.abs(now)),
                point: true,
                max: 4,
                onOk: (t) => {
                    const size = parseFloat(t);
                    if (!Number.isFinite(size)) return;
                    const n = now < 0 ? -size : size;
                    setWeight(fid, k, clamp(n), false);
                    flush(fid).then(() => api.paint());
                }
            });
        }

        // ---- the page

        let shape = '';
        let rows = {}; // rowKey -> { lcd, jog }

        function draw(el) {
            const data = fields().map((fid) => ({ fid, items: parse(api.fieldValue(fid)) })).filter((f) => f.items.some((g) => !g.plain));
            // the rows are built again only when the groups themselves change: a repaint while a wheel
            // turns must leave it under the finger
            const next = JSON.stringify(data.map((f) => [f.fid, api.fieldName(f.fid), f.items.map((g) => (g.plain ? `p${g.inner}` : `g${g.inner}`))]));
            const list = el.querySelector('.wds-rack-list');
            if (next !== shape || !list) {
                shape = next;
                rows = {};
                if (selected && !data.some((f) => f.fid === selected.fid && groupsOf(f.items)[selected.k])) selected = null;
                el.innerHTML = `<div class="wm-form wds-rack-list">${data.length ? data.map((f) => `${api.ui.sub(api.fieldName(f.fid))}${f.items.map((g) => (g.plain
                    ? `<div class="wds-wt-row wds-rack-plain"><span class="wds-wt-name">${esc(g.inner)}</span><span class="wds-wt-lcd wm-lcd"></span><span class="wds-rack-gap" aria-hidden="true"></span></div>`
                    : `<div class="wds-wt-row wds-rack-row" data-f="${esc(f.fid)}" data-k="${g.k}"><button type="button" class="wds-wt-name wds-rack-name" aria-haspopup="menu">${esc(g.inner.trim())}</button><button type="button" class="wds-wt-lcd wm-lcd" aria-label="${esc(g.inner.trim())}: weight"></button></div>`)).join('')}`).join('')
                    : '<p class="wds-none">No emphasis groups in this prompt.</p>'}</div>`;
                el.querySelectorAll('.wds-rack-plain > .wds-wt-lcd').forEach((lcd) => api.ui.segText(lcd, fmtLcd(1), { signed: true }));
                data.forEach((f) => groupsOf(f.items).forEach((g) => {
                    const row = el.querySelector(`.wds-rack-row[data-f="${CSS.escape(f.fid)}"][data-k="${g.k}"]`);
                    if (!row) return;
                    const key = rowKey(f.fid, g.k);
                    const lcd = row.querySelector('.wds-wt-lcd');
                    api.ui.segText(lcd, fmtLcd(g.weight), { signed: true });
                    const r = { lcd, jog: null, weight: g.weight };
                    rows[key] = r;
                    const put = (w) => { r.weight = w; api.ui.segText(lcd, fmtLcd(w), { signed: true }); setWeight(f.fid, g.k, w); };
                    const jog = r.jog = api.ui.jogWheel(row, { label: `${g.inner.trim()} weight`, value: g.weight, min: JOG.min, max: JOG.max, step: JOG.step, fineStep: JOG.fineStep, stepPx: 18, onChange: put });
                    row.insertAdjacentHTML('beforeend', `<button type="button" class="wm-valuepop-default" aria-label="${esc(g.inner.trim())}: Default" title="Default"></button>`);
                    row.lastElementChild.addEventListener('click', () => { jog.set(JOG.def); put(JOG.def); });
                    lcd.addEventListener('click', () => typeWeight(f.fid, g.k, r.weight));
                    row.querySelector('.wds-rack-name').addEventListener('click', (e) => {
                        selected = { fid: f.fid, k: g.k };
                        markSelected(el);
                        api.sh.dropdown(e.currentTarget, groupRows(selected), 'left');
                    });
                }));
            } else {
                // same groups: only the weights changed (here or on the desktop); a row being rolled keeps its own
                data.forEach((f) => groupsOf(f.items).forEach((g) => {
                    const key = rowKey(f.fid, g.k);
                    const r = rows[key];
                    if (!r || (busy[key] || 0) > Date.now() || (pending[f.fid] && pending[f.fid].has(g.k))) return;
                    if (r.weight === g.weight) return;
                    r.weight = g.weight;
                    r.jog.set(g.weight);
                    api.ui.segText(r.lcd, fmtLcd(g.weight), { signed: true });
                }));
            }
            markSelected(el);
        }

        function markSelected(el) {
            el.querySelectorAll('.wds-rack-row').forEach((row) => row.classList.toggle('is-selected', !!selected && row.dataset.f === selected.fid && Number(row.dataset.k) === selected.k));
        }

        reg.view('rack', {
            title: 'Weight Rack',
            draw,
            menu: () => groupRows(selected)
        });

        const open = () => { selected = null; api.openView('rack'); };
        reg.menu('main', () => [{ label: 'Weight Rack', action: open }]);

        // from the editor's toolbox: the editor keeps its text to itself until Done, so what it holds
        // goes to Studio first (the rack reads Studio), and once the rack steps back to it the
        // editor loads the field again with the rack's weights in it
        let fromEditor = null;
        function editedField() {
            const ta = api.edArea();
            if (!ta) return null;
            if (ta.dataset.field) return ta.dataset.field;
            // the editor's own box (a character's field, the inline negative): its head names the field
            const label = api.$('.wds-ed-head > .wm-combo > span');
            const name = label ? label.textContent : '';
            return fields().find((fid) => api.fieldName(fid) === name) || null;
        }
        reg.menu('toolbox', () => [{
            label: 'Weight Rack',
            action: () => {
                const fid = api.view() === 'editor' ? editedField() : null;
                const ta = fid ? api.edArea() : null;
                const sent = ta && ta.value !== api.fieldValue(fid) ? api.fieldSet(fid, ta.value) : null;
                Promise.resolve(sent).then(() => { api.refresh(); fromEditor = fid; open(); });
            }
        }]);
        reg.hook('paint', (v) => {
            if (!fromEditor || v === 'x:rack') return;
            const fid = fromEditor;
            fromEditor = null;
            if (v !== 'editor') return;
            Promise.all(Object.keys(pending).map(flush).concat(Object.values(chains))).then(() => {
                if (api.view() !== 'editor') return;
                const ta = api.edArea();
                if (ta) ta.blur();
                api.refresh();
                api.openEditor(fid);
            });
        });
    });
})();
