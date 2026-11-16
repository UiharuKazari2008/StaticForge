/**
 * Melaton Mobile: DreamStudio part - Inspector (#860 migration). Joins the program through
 * wmDreamStudio.extend; reaches Studio only through studioModel (studioModelInspector.js adds what it needs).
 *
 * The Inspector tab is the desktop's Inspector window (#textReplacementLockModal) on one page:
 *   the seed: Kept / Random, its LCD (a tap opens the program's seed box, api.seedBox) and its lock;
 *     under it Generate > Recent Seeds as one dense run of seeds (a tap uses that seed, kept, as the
 *     desktop's select-seed-*; past two rows a More... opens all of them)
 *   Genso: each expander pick of the last print with its lock box, its value, the pattern it came from
 *     and where it sits (character, UC, Rentan's category / reason / expiry for a dg_ expander), a dice
 *     tool for Randomize Value; a tap on the row opens its menu (Lock, Randomize Value, Resolve To,
 *     Copy Value, Apply to Prompt). Lock All / Unlock All in the header (Lock All also freezes Rentan's
 *     cache and context, as the desktop's Lock All does)
 *   Rentan: the cache's state and the scene it was compiled for, then each Tendai modification with its
 *     lock box, its mitigations in full and its Research Sources; a tap opens Lock, Copy Value, Apply to
 *     Prompt, Research Sources (the web ones), Set Emphasis..., Report Issue..., Delete
 *   Compiler Timeline & Costs: one row with the compile's token total; a tap opens it as a page (each
 *     pass, each call with its tools, reasons, plans and analyses, and their tokens)
 * Menu on this tab adds Refresh Expanders, Compiled Prompts (a page of its own), Compile Tendai,
 * Delete Managed (the desktop Inspector's toolbar and its button's menu) and Global / Local Expanders
 * when the Expanders part has registered their pages.
 */
(function () {
    'use strict';
    if (window.uiShell !== 'mobile' || !window.wmDreamStudio || typeof window.wmDreamStudio.extend !== 'function') return;
    window.wmDreamStudio.extend('Inspector', (api, reg) => {
        const { esc, toolIcon } = api;
        const M = () => api.M;
        const has = (name) => !!(M() && typeof M()[name] === 'function');
        let data = null;
        let sig = '';
        let seedSig = '';

        const where = (x) => [x.char != null ? `Character ${x.char + 1}` : '', x.uc ? 'UC' : ''].filter(Boolean).join(' ');
        const hhmm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // the FA font is a trimmed subset: a glyph is used only when it is in it
        const glyphs = new Map();
        function hasGlyph(cls) {
            if (glyphs.has(cls)) return glyphs.get(cls);
            const host = api.page || document.body;
            const i = document.createElement('i');
            i.className = cls;
            i.setAttribute('aria-hidden', 'true');
            host.appendChild(i);
            const c = getComputedStyle(i, '::before').content;
            i.remove();
            const ok = !!c && c !== 'none' && c !== 'normal' && c !== '""';
            glyphs.set(cls, ok);
            return ok;
        }
        /** The first of the classes the font has, as an icon ('' when none of them is there). */
        const icon = (...list) => { const cls = list.find(hasGlyph); return cls ? toolIcon(cls) : ''; };

        /** The cache line in the desktop banner's words (appendRentanSceneBlocks). */
        function cacheText(r) {
            if (!r.expiresAt) return '';
            const at = new Date(r.expiresAt);
            const ms = r.expiresAt - Date.now();
            if (!r.expired) {
                const min = Math.round(ms / 60000);
                const h = Math.round((min / 60) * 10) / 10;
                return `Cache valid: expires at ${at.toLocaleTimeString()} (${h >= 1 ? `${h}h ${min % 60}m` : `${min}m`})`;
            }
            const days = Math.floor(Math.abs(ms) / 86400000);
            const t = hhmm(r.expiresAt);
            if (days === 0) return `Cache expired: today (${t})`;
            if (days < 7) return `Cache expired: ${days === 1 ? '1 day' : `${days} days`} ago (${t})`;
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const y = at.getFullYear() !== new Date().getFullYear() ? `, ${at.getFullYear()}` : '';
            return `Cache expired: ${months[at.getMonth()]} ${at.getDate()}${y} (${t})`;
        }

        // ---- token figures (the desktop's formatTokens: input, output, cache, reasoning, total)

        const TOKEN_PARTS = [['input', 'Input', ['fas fa-up-right', 'fas fa-arrow-up']], ['output', 'Output', ['fas fa-down-left', 'fas fa-arrow-down']], ['cache', 'Cache', ['fas fa-cloud-check', 'fas fa-cloud']], ['reasoning', 'Reasoning', ['fas fa-gears', 'fas fa-gear']], ['total', 'Total', ['fas fa-equals']]];
        function tokenLine(t) {
            if (!t) return '';
            return `<span class="wdi-tokens">${TOKEN_PARTS.map(([k, label, cls]) => {
                const g = icon(...cls);
                return `<span title="${label}">${g || `${label} `}${Number(t[k] || 0).toLocaleString()}</span>`;
            }).join('')}</span>`;
        }

        // ---- the rows

        function seedRow(g) {
            const sel = `!${g.key}${g.index != null ? `#${g.index}` : ''}`;
            const sub = [
                g.isStatic ? `!${g.key}` : `${g.pattern} → ${sel}`,
                where(g),
                g.stages,
                g.rentan ? g.rentan.category : '',
                g.rentan && g.rentan.expiresAt ? `${g.rentan.expiresAt > Date.now() ? 'Expires' : 'Expired'} ${hhmm(g.rentan.expiresAt)}` : ''
            ].filter(Boolean).join(' · ');
            return `<div class="wdi-row${g.uc ? ' is-uc' : ''}" data-row="g:${g.i}">`
                // a pick that cannot be locked has no lock (the desktop shows it without its button)
                + (g.canLock ? `<label class="wm-check"><input type="checkbox" data-wdi-lock="g:${g.i}" aria-label="Lock ${esc(sel)}"${g.locked ? ' checked' : ''}><span></span></label>` : '<span class="wdi-nolock"></span>')
                + `<button type="button" class="wdi-text" data-wdi-menu="g:${g.i}"><span class="wdi-val">${esc(g.value) || '&nbsp;'}</span><span class="wdi-sub">${esc(sub)}</span>${g.rentan && g.rentan.reason ? `<span class="wdi-sub wdi-reason">“${esc(g.rentan.reason)}”</span>` : ''}</button>`
                + (g.canLock ? `<button type="button" class="wm-tool" data-wdi-roll="${g.i}" aria-label="Randomize Value" title="Randomize Value">${toolIcon('fas fa-dice')}</button>` : '')
                + '</div>';
        }

        const ACTION_ICON = { replace: 'fas fa-arrows-rotate', append: 'fas fa-plus', delete: 'fas fa-trash' };
        const STATUS = { failed: 'Failed', fallback: 'Fallback', alternative: 'Alternative' };
        // the desktop row's Research Sources glyphs, by kind
        const REF_ICON = { web_search: ['fas fa-globe'], tag_search: ['fas fa-tags', 'fas fa-tag'], tag_description: ['fas fa-search', 'fas fa-magnifying-glass'], tokenizer: ['fas fa-calculator'] };
        const REF_LEAD = { web_search: 'Web: ', tag_search: 'Tags: ', tag_description: '', tokenizer: '' };

        function tendaiRow(t) {
            const q = (s) => `“${s}”`;
            let main;
            if (t.action === 'delete') main = `${t.text ? q(t.text) : (t.count ? `Delete ${t.count} occurrence(s)` : 'Delete all')}${t.text ? (t.count ? ` (${t.count} occurrence(s))` : ' (all occurrences)') : ''}`;
            else if (t.action === 'append') main = `${t.find ? `${q(t.find)} + ` : ''}${t.text ? q(t.text) : 'N/A'}`;
            else main = `${t.find ? q(t.find) : 'N/A'} → ${t.text ? q(t.text) : 'N/A'}`;
            const sub = [where(t), t.category, STATUS[t.status] || '', t.converted ? 'Converted' : '', t.emphasis != null ? `Emphasis ${t.emphasis.toFixed(2)}` : ''].filter(Boolean).join(' · ');
            const refs = t.references || [];
            return `<div class="wdi-row${t.uc ? ' is-uc' : ''}" data-row="t:${t.i}">`
                + `<label class="wm-check"><input type="checkbox" data-wdi-lock="t:${t.i}" aria-label="Lock this replacement"${t.locked ? ' checked' : ''}><span></span></label>`
                + `<button type="button" class="wdi-text" data-wdi-menu="t:${t.i}"><span class="wdi-val">${toolIcon(ACTION_ICON[t.action] || ACTION_ICON.replace)}${esc(main)}</span>`
                + (sub ? `<span class="wdi-sub">${esc(sub)}</span>` : '')
                + (t.anchor ? `<span class="wdi-sub">Anchor ${esc(q(t.anchor))}</span>` : '')
                + (t.error ? `<span class="wdi-sub">${esc(t.error)}</span>` : '')
                // the mitigations in full: what was done and why (the desktop's list)
                + (t.mitigations || []).map((m) => `<span class="wdi-sub wdi-mit"><b>${esc(m.type)}</b>${m.text ? ` – ${esc(m.text)}` : ''}</span>`).join('')
                + (t.reason ? `<span class="wdi-sub wdi-reason">${esc(q(t.reason))}</span>` : '')
                + (refs.length ? `<span class="wdi-refs"><span class="wdi-refs-head">${icon('fas fa-book')}Research Sources:</span>${refs.map((r) => `<span>${icon(...REF_ICON[r.type])}${esc(REF_LEAD[r.type])}${esc(r.text)}</span>`).join('')}</span>` : '')
                + '</button></div>';
        }

        /** Every phase's totals added up (the one-line summary on the Inspector page). */
        function usageSum(u) {
            const sum = { input: 0, output: 0, cache: 0, reasoning: 0, total: 0 };
            let calls = 0;
            u.phases.forEach((p) => {
                calls += p.calls.length;
                if (p.totals) Object.keys(sum).forEach((k) => { sum[k] += Number(p.totals[k]) || 0; });
            });
            return { sum, calls };
        }

        function usageRow(u) {
            const { sum, calls } = usageSum(u);
            return `<button type="button" class="wdi-usage" data-wdi-open="timeline"><span class="wdi-val">${icon('fas fa-gauge-high', 'fas fa-gauge')}Compiler Timeline &amp; Costs</span>`
                + `<span class="wdi-sub">${calls === 1 ? '1 call' : `${calls} calls`}${u.twoPasses ? ' · 2 passes' : ''}</span>${tokenLine(sum)}</button>`;
        }

        function drawBody(box, d, usage) {
            let html = '';
            if (d.seeds.length) {
                html += '<div class="wm-form-sub wds-insp-head"><span>Genso</span><button type="button" class="wm-button" data-wdi="lockall">Lock All</button><button type="button" class="wm-button" data-wdi="unlockall">Unlock All</button></div>';
                html += d.seeds.map(seedRow).join('');
            }
            if (d.rentan) {
                html += `<div class="wm-form-sub wds-insp-head"><span>${esc(d.rentan.title)}</span>${d.seeds.length ? '' : '<button type="button" class="wm-button" data-wdi="lockall">Lock All</button>'}</div>`;
                const c = cacheText(d.rentan);
                if (c) html += `<p class="wdi-cache${d.rentan.expired ? ' is-expired' : ''}">${esc(c)}</p>`;
                if (d.rentan.scene.length) html += `<div class="wdi-scene">${d.rentan.scene.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>`;
                html += d.tendai.map(tendaiRow).join('');
            }
            if (usage) html += usageRow(usage);
            if (!d.seeds.length && !d.rentan && !usage) {
                html += `<p class="wds-none">${d.hasData ? 'No expanders in use. Menu &gt; Refresh Expanders scans the prompts for them.' : 'No Genso yet: expanders used in a print show their picks here.'}</p>`;
            }
            box.querySelector('.wdi-body').innerHTML = html;
        }

        // Recent Seeds: two rows' worth on the page, the rest behind More...
        const SEEDS_SHOWN = 8;
        function drawSeeds(box, s) {
            const list = has('recentSeeds') ? M().recentSeeds() : [];
            const cur = String(s.seedText || '');
            const next = JSON.stringify([list, cur]);
            if (next === seedSig) return;
            seedSig = next;
            const el = box.querySelector('.wdi-seeds');
            el.hidden = !list.length;
            const shown = list.length > SEEDS_SHOWN ? list.slice(0, SEEDS_SHOWN - 1) : list;
            el.innerHTML = `<span class="wdi-seeds-head">Recent</span>${shown.map((v) => `<button type="button" class="wdi-seed" data-wdi-use="${esc(v)}" aria-pressed="${v === cur}" aria-label="Use seed ${esc(v)}">${esc(v)}</button>`).join('')}`
                + (list.length > shown.length ? `<button type="button" class="wdi-seed" data-wdi-seeds="more">More...</button>` : '');
        }

        function draw(el) {
            const box = el.querySelector('.wds-insp');
            if (!box || !api.ui) return;
            const s = api.read();
            if (!box.querySelector('.wdi-body')) {
                box.innerHTML = '<div class="wm-form-sub">Seed</div>'
                    + '<div class="wds-wt-row is-on"><span class="wds-wt-name"></span><button type="button" class="wds-wt-lcd wm-lcd wds-insp-seed" data-wdi-seed="box" aria-label="Seed" aria-haspopup="dialog"></button><button type="button" class="wm-tool" data-wdi-seed="lock" aria-label="Keep this seed" title="Keep this seed"></button></div>'
                    + '<div class="wdi-seeds" hidden></div><div class="wdi-body"></div>';
                bind(box);
                sig = '';
                seedSig = '';
            }
            const kept = !!s.seedLock;
            box.querySelector('.wds-wt-name').textContent = kept ? 'Kept' : 'Random';
            const tool = box.querySelector('[data-wdi-seed="lock"]');
            tool.setAttribute('aria-pressed', String(kept));
            const ic = kept ? 'fas fa-lock' : 'fas fa-seedling';
            if (tool.dataset.icon !== ic) { tool.innerHTML = toolIcon(ic); tool.dataset.icon = ic; }
            const seed = String(s.seedText || (kept ? s.seed : '') || '');
            api.ui.segText(box.querySelector('.wds-insp-seed'), seed ? seed.padStart(10, '!') : '!!!!!!!!!!');
            drawSeeds(box, s);
            data = has('inspector') ? M().inspector() : { seeds: [], tendai: [], rentan: null, hasData: false };
            const usage = has('compilerUsage') ? M().compilerUsage() : null;
            // the list is drawn again only when it changed (every paint comes here: jogs, typing)
            const next = JSON.stringify([data, usage, Math.floor(Date.now() / 60000)]);
            if (next !== sig) { sig = next; drawBody(box, data, usage); }
        }

        // ---- what a row does

        const warn = (text, kind) => api.sh.messageBox({ title: 'Inspector', text, icon: kind || 'warning', modal: true });
        const after = () => { api.refresh(); sig = ''; seedSig = ''; api.paint(); };

        function gensoMenu(btn, g) {
            const open = (opts) => {
                const keys = new Set(opts.map((o) => o.key));
                const resolve = opts.length
                    ? opts.map((o) => ({ label: `${o.value}${keys.size > 1 ? ` (!${o.key})` : ''}${o.index != null ? ` #${o.index}` : ''}`, radio: o.value === g.value && o.key === g.key, action: () => { M().gensoResolve(g.i, o); after(); } }))
                    : [{ label: opts.failed ? 'Error loading options' : 'No options available', disabled: true }];
                api.sh.dropdown(btn, [
                    g.canLock ? { label: 'Lock', checked: g.locked, action: () => { M().gensoLockAt(g.i, !g.locked); after(); } } : null,
                    g.canLock ? { label: 'Randomize Value', action: () => reroll(g.i) } : null,
                    g.canResolve ? { label: 'Resolve To', submenu: resolve } : null,
                    '-',
                    { label: 'Copy Value', disabled: !g.value, action: () => M().gensoCopy(g.i) },
                    { label: 'Apply to Prompt', action: () => { const r = M().gensoApply(g.i); if (r && r.error) warn(r.error); after(); } }
                ].filter(Boolean), 'left');
            };
            if (!g.canResolve) { open([]); return; }
            // the options come first so Resolve To opens full (a slow answer opens the menu without them)
            let done = false;
            const go = (opts) => { if (done) return; done = true; open(opts); };
            Promise.resolve(M().gensoOptions(g.i)).then(go, () => go([]));
            setTimeout(() => go([]), 1500);
        }

        function reroll(i) {
            Promise.resolve(M().gensoReroll(i)).then((ok) => { if (!ok) warn('No options available for random selection.'); after(); });
        }

        function tendaiMenu(btn, t) {
            // the web sources open in the browser (the desktop row's links); the others are text only
            const web = (t.references || []).filter((r) => r.type === 'web_search' && r.url);
            api.sh.dropdown(btn, [
                { label: 'Lock', checked: t.locked, action: () => { M().tendaiLock(t.i, !t.locked); after(); } },
                { label: 'Copy Value', disabled: !t.value, action: () => M().tendaiCopy(t.i) },
                { label: 'Apply to Prompt', disabled: !t.canApply, action: () => { Promise.resolve(M().tendaiApply(t.i)).then(after); } },
                web.length ? { label: 'Research Sources', submenu: () => web.map((r) => ({ label: r.text, action: () => { try { window.open(r.url, '_blank', 'noopener'); } catch (_) { /* blocked */ } } })) } : null,
                '-',
                { label: 'Set Emphasis...', action: () => emphasisDialog(t) },
                { label: 'Report Issue...', disabled: !has('tendaiReport'), action: () => reportDialog(t) },
                { label: 'Delete', action: () => askDelete(t) }
            ].filter(Boolean), 'left');
        }

        function askDelete(t) {
            const what = t.find || t.text;
            api.sh.messageBox({ title: 'Inspector', text: `Are you sure you want to delete this replacement?${what ? `\n\n“${what}”` : ''}`, icon: 'question', modal: true, buttons: [{ text: 'Delete', value: true }, { text: 'Cancel', value: false, default: true }], cancelValue: false })
                .then((yes) => { if (yes) { M().tendaiDelete(t.i); after(); } });
        }

        /**
         * Set Emphasis: the desktop asks for any number (1.0 when none is set; e.g. 1.2, 0.8, -0.5): a
         * signed LCD with its jog (no ends, as the desktop has none); a tap on the LCD types one, minus
         * and point included. Set keeps it.
         */
        function emphasisDialog(t) {
            let v = t.emphasis != null ? t.emphasis : 1;
            const el = api.openDlg('Set Emphasis', 'wdi-empdlg', '<div class="wds-wt-row is-on"><span class="wds-wt-name">Emphasis</span><button type="button" class="wds-wt-lcd wm-lcd" aria-label="Emphasis: type a value" aria-haspopup="dialog"></button></div>'
                + '<div class="wm-msgbox-buttons"><button type="button" data-wdi-emp="set">Set</button><button type="button" data-wdi-emp="cancel">Cancel</button></div>');
            const row = el.querySelector('.wds-wt-row');
            const lcd = row.querySelector('.wm-lcd');
            const show = () => api.ui.segText(lcd, v.toFixed(2), { signed: true });
            show();
            const jog = api.ui.jogWheel(row, { label: 'Emphasis', value: v, step: 0.1, fineStep: 0.01, stepPx: 18, zeroStop: 0, onChange: (n) => { v = Number(n); show(); } });
            lcd.addEventListener('click', () => api.ui.numPad({
                title: 'Emphasis',
                value: String(Math.round(v * 100) / 100),
                minus: true,
                point: true,
                max: 4,
                onOk: (txt) => {
                    if (txt === '' || txt === '-') return;
                    const n = parseFloat(txt);
                    if (!Number.isFinite(n)) { warn('Invalid emphasis value. Must be a number.', 'error'); return; }
                    v = n;
                    jog.set(v);
                    show();
                }
            }));
            el.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-wdi-emp]');
                if (!b) return;
                if (b.dataset.wdiEmp === 'set') M().tendaiEmphasis(t.i, Math.round(v * 100) / 100);
                api.closeDlg();
                after();
            });
        }

        /**
         * Report Issue (the desktop's Report Issue to Rentan, showDirectorFeedbackModal): the modification's
         * Original Text, Replacement Text, Action and SI's Reasoning read only, What went wrong? to write;
         * Save Feedback sends it as the desktop does (director_save_feedback).
         */
        function reportDialog(t) {
            const r = t.report || { select: '', replace: '', action: '', reason: '' };
            const ro = (label, value) => api.ui.row(label, api.ui.edit('', value, 'readonly tabindex="-1"'), { wide: true });
            const el = api.openDlg('Report Issue to Rentan', 'wdi-repdlg', ro('Original Text', r.select)
                + ro('Replacement Text', r.replace)
                + ro('Action', r.action || 'replace')
                + `<div class="wds-label"><span>SI's Reasoning</span><span></span></div><textarea class="wm-edit wdi-rep-reason" rows="2" readonly tabindex="-1" spellcheck="false">${esc(r.reason)}</textarea>`
                + '<div class="wds-label"><span>What went wrong? *</span><span></span></div>'
                + '<textarea class="wm-edit wdi-rep-text" rows="4" spellcheck="false" autocapitalize="sentences" aria-label="What went wrong?" placeholder="Describe what was wrong with this replacement. This will help the SI avoid similar mistakes in the future."></textarea>'
                + '<div class="wm-msgbox-buttons"><button type="button" data-wdi-rep="save">Save Feedback</button></div>');
            const text = el.querySelector('.wdi-rep-text');
            let busy = false;
            el.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-wdi-rep]');
                if (!b || busy) return;
                const said = String(text.value || '').trim();
                if (!said) { warn('Please describe what went wrong with this replacement.', 'error'); return; }
                busy = true;
                b.disabled = true;
                Promise.resolve(M().tendaiReport(t.i, said)).then((res) => {
                    busy = false;
                    b.disabled = false;
                    if (res && res.ok) { api.closeDlg(); warn('Feedback saved successfully. The SI will learn from this.', 'info'); } else warn((res && res.error) || 'Failed to save feedback', 'error');
                });
            });
        }

        /** All of Recent Seeds (past what the page shows): a tap uses one. */
        function seedsDialog() {
            const list = M().recentSeeds();
            const cur = String(api.read().seedText || '');
            const el = api.openDlg('Recent Seeds', 'wdi-seedsdlg', api.ui.listbox(list.map((v) => ({ key: v, label: v, selected: v === cur }))));
            api.ui.bindListbox(el.querySelector('.wm-listbox'), (key) => { api.closeDlg(); useSeed(key); });
        }

        function useSeed(v) { if (M().useRecentSeed(v)) after(); }

        const find = (ref) => {
            const [k, n] = String(ref || '').split(':');
            const list = data ? (k === 'g' ? data.seeds : data.tendai) : [];
            return { kind: k, item: list.find((x) => x.i === Number(n)) };
        };

        function bind(box) {
            box.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-wdi], [data-wdi-menu], [data-wdi-roll], [data-wdi-seed], [data-wdi-use], [data-wdi-seeds], [data-wdi-open]');
                if (!b) return;
                if (b.dataset.wdiSeed === 'box') { api.seedBox(); return; }
                if (b.dataset.wdiSeed === 'lock') {
                    // the program's seed tool: keep / release the seed; nothing to keep opens the seed box
                    const was = !!api.read().seedLock;
                    api.change('seedLock', !was).then(() => { api.refresh(); if (!was && !api.read().seedLock) api.seedBox(); after(); });
                    return;
                }
                if (b.dataset.wdiUse) { useSeed(b.dataset.wdiUse); return; }
                if (b.dataset.wdiSeeds) { seedsDialog(); return; }
                if (b.dataset.wdiOpen) { api.openView(b.dataset.wdiOpen); return; }
                if (b.dataset.wdi) { M().inspectorLockAll(b.dataset.wdi === 'lockall'); after(); return; }
                if (b.dataset.wdiRoll != null) { reroll(Number(b.dataset.wdiRoll)); return; }
                const { kind, item } = find(b.dataset.wdiMenu);
                if (!item) return;
                if (kind === 'g') gensoMenu(b, item); else tendaiMenu(b, item);
            });
            box.addEventListener('change', (e) => {
                const t = e.target;
                if (!t || !t.dataset || !t.dataset.wdiLock) return;
                const { kind, item } = find(t.dataset.wdiLock);
                if (!item) return;
                if (kind === 'g') M().gensoLockAt(item.i, !!t.checked); else M().tendaiLock(item.i, !!t.checked);
                after();
            });
        }

        if (!has('inspector')) return;
        reg.pane('inspector', { draw });

        // ---- Compiled Prompts: the desktop toolbar's Compiled section as a page of its own

        reg.view('compiled', {
            title: 'Compiled Prompts',
            draw(el) {
                const c = M().compiledPrompts();
                const box = (name, text) => (String(text).trim() ? `<div class="wds-label"><span>${esc(name)}</span><span></span></div><textarea class="wm-edit wdi-compiled" readonly spellcheck="false">${esc(text)}</textarea>` : '');
                const html = box('Base Prompt', c.prompt) + box('Negative', c.uc)
                    + c.characters.map((ch, i) => box(`Character ${i + 1}`, ch.prompt) + box(`Character ${i + 1} UC`, ch.uc)).join('');
                el.classList.add('wds-fields', 'wdi-compiledview');
                const next = html || '<p class="wds-none">No compiled prompt data available.</p>';
                if (el._html !== next) {
                    el._html = next;
                    el.innerHTML = next;
                    // each box as tall as its text, up to ten lines (a longer one scrolls)
                    el.querySelectorAll('textarea.wdi-compiled').forEach((ta) => {
                        const px = parseFloat(getComputedStyle(ta).lineHeight) || 13;
                        ta.style.height = '0';
                        ta.style.height = `${Math.min(ta.scrollHeight + 2, px * 10 + 8)}px`;
                    });
                }
            }
        });

        // ---- Compiler Timeline & Costs: the usage block under the desktop Inspector's list, as a page

        const CALL_ICON = { tool: ['fas fa-wrench'], request: ['fas fa-code'], other: ['fas fa-circle'] };

        function sectionHtml(sec) {
            let h = `<div class="wdi-tl-sec"><span class="wdi-tl-sechead">${icon(sec.icon)}${esc(sec.title)}</span>`;
            if (sec.detected) h += `<span class="wdi-tl-kv"><span>Detected:</span><span class="wdi-tl-ctx">${sec.detected.map((f) => `<span class="${f.found ? '' : 'is-muted'}" title="${esc(f.tip)}" aria-label="${esc(f.tip)}">${icon(f.icon, 'fas fa-circle') || esc(f.field)}</span>`).join('')}</span></span>`;
            h += (sec.rows || []).map(([k, v]) => `<span class="wdi-tl-kv"><span>${esc(k)}:</span><span>${esc(v)}</span></span>`).join('');
            return `${h}</div>`;
        }

        function planHtml(p) {
            let h = '';
            if (p.count) {
                h += `<div class="wdi-tl-sec"><span class="wdi-tl-sechead">${icon('fas fa-clipboard-list')}Planned Changes (${p.count})</span>`
                    + p.groups.map((g) => `<span class="wdi-tl-cat"><b>${esc(g.category)}</b><span>${g.changes.length} change${g.changes.length !== 1 ? 's' : ''}</span></span>`
                        + g.changes.map((c) => `<span class="wdi-tl-change"><span class="wdi-tl-kv"><b>${esc(c.action)}</b><span>Segments: ${esc(c.segments)}</span></span><span>${esc(c.reason)}</span>${c.tags ? `<span class="wdi-sub">Tags: ${esc(c.tags)}</span>` : ''}${c.emphasis ? `<span class="wdi-sub">Emphasis: ${esc(c.emphasis)}</span>` : ''}</span>`).join('')).join('')
                    + '</div>';
            }
            if (p.completed.length || p.needed.length) {
                const items = (list) => list.map((x) => `<span class="wdi-tl-kv"><span>${esc(x.topic)}</span>${x.tool ? `<span class="wdi-sub">${esc(x.tool)}</span>` : ''}</span>`).join('');
                h += `<div class="wdi-tl-sec"><span class="wdi-tl-sechead">${icon('fas fa-search', 'fas fa-magnifying-glass')}Research Status</span>`
                    + (p.completed.length ? `<span class="wdi-tl-sub">${icon('fas fa-check-circle', 'fas fa-circle-check')}Completed (${p.completed.length})</span>${items(p.completed)}` : '')
                    + (p.needed.length ? `<span class="wdi-tl-sub">${icon('fas fa-clock')}Needed (${p.needed.length})</span>${items(p.needed)}` : '')
                    + '</div>';
            }
            if (p.conflicts.length) {
                h += `<div class="wdi-tl-sec"><span class="wdi-tl-sechead">${icon('fas fa-exclamation-triangle', 'fas fa-triangle-exclamation')}Conflicts to Resolve (${p.conflicts.length})</span>`
                    + p.conflicts.map((c) => `<span>${esc(c)}</span>`).join('') + '</div>';
            }
            return h;
        }

        function toolHtml(t) {
            let h = `<div class="wdi-tl-tool"><span class="wdi-tl-name">${icon(t.icon, 'fas fa-circle')}${esc(t.display)}</span>`;
            if (t.sections) h += t.sections.map(sectionHtml).join('');
            else if (t.plan) h += planHtml(t.plan);
            else if (t.tags && t.tags.length) h += t.tags.map((g) => `<span class="wdi-tl-tag">${icon('fas fa-tag')}${esc(g.name)}${g.reason ? ` • <span class="wdi-sub">${esc(g.reason)}</span>` : ''}</span>`).join('');
            else if (t.reason) h += `<span class="wdi-tl-reason">${esc(t.reason)}</span>`;
            return `${h}</div>`;
        }

        function timelineHtml(u) {
            if (!u) return '<p class="wds-none">No compile data: Rentan\'s compile shows its passes, calls and token costs here.</p>';
            return u.phases.map((p) => {
                let h = '';
                if (p.totals) h += `<div class="wdi-tl-phase">${p.titled ? `<b>${icon('fas fa-diagram-project')}${esc(p.name)}</b>` : ''}${tokenLine(p.totals)}</div>`;
                h += p.calls.map((c) => `<div class="wdi-tl-call"><span class="wdi-val">${icon(...CALL_ICON[c.kind])}${esc(c.title)}</span>`
                    + (c.reason ? `<span class="wdi-tl-reason">${esc(c.reason)}</span>` : '')
                    + c.tools.map(toolHtml).join('')
                    + tokenLine(c.usage) + '</div>').join('');
                return h;
            }).join('');
        }

        reg.view('timeline', {
            title: 'Compiler Timeline & Costs',
            draw(el) {
                el.classList.add('wdi-timeline');
                const next = timelineHtml(M().compilerUsage());
                if (el._html !== next) { el._html = next; el.innerHTML = next; }
            }
        });

        // Global / Local Expanders belong to the Expanders part: offered only when it registered the pages
        const EXPANDER_VIEWS = [['expanders-global', 'Global Expanders'], ['expanders-local', 'Local Expanders'], ['expanders', 'Expanders']];
        const viewThere = (name) => !!api.$(`.wds-xview[data-xview="${name}"]`);

        reg.menu('main', () => {
            if (api.tab !== 'inspector' || api.view() !== 'home') return [];
            const d = M().inspector();
            const exp = EXPANDER_VIEWS.filter(([name]) => viewThere(name));
            // the generic page only when the part has no separate global / local ones
            const rows = (exp.length > 1 ? exp.filter(([name]) => name !== 'expanders') : exp).map(([name, label]) => ({ label, action: () => api.openView(name) }));
            return [
                { label: 'Refresh Expanders', action: () => { Promise.resolve(M().scanExpanders()).then(after); } },
                { label: 'Compiled Prompts', action: () => api.openView('compiled') },
                { label: 'Compile Tendai', disabled: !d.hasTendai, action: () => { Promise.resolve(M().compileTendai()).then(after); } },
                { label: 'Delete Managed', disabled: !M().hasManagedStages(), action: () => { M().deleteManagedStages(); after(); } },
                ...(rows.length ? ['-', ...rows] : [])
            ];
        });
    });
})();
