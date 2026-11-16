/**
 * Melaton Mobile: DreamStudio part - Inspector (#860 migration). Joins the program through
 * wmDreamStudio.extend; reaches Studio only through studioModel (studioModelInspector.js adds what it needs).
 *
 * The Inspector tab is the desktop's Inspector window (#textReplacementLockModal) on one page:
 *   the seed and its lock (the built-in row; its tap still goes to the program's own seed box),
 *   Genso: each expander pick of the last print with its lock box, its value, the pattern it came from
 *     and where it sits (character, UC, Rentan's category / reason / expiry for a dg_ expander), a dice
 *     tool for Randomize Value; a tap on the row opens its menu (Lock, Randomize Value, Resolve To,
 *     Copy Value, Apply to Prompt). Lock All / Unlock All in the header (Lock All also freezes Rentan's
 *     cache and context, as the desktop's Lock All does)
 *   Rentan: the cache's state and the scene it was compiled for, then each Tendai modification with its
 *     lock box; a tap opens Lock, Copy Value, Apply to Prompt, Set Emphasis..., Delete
 * Menu on this tab adds Refresh Expanders, Compiled Prompts (a page of its own), Compile Tendai and
 * Delete Managed (the desktop Inspector's toolbar and its button's menu).
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

        const where = (x) => [x.char != null ? `Character ${x.char + 1}` : '', x.uc ? 'UC' : ''].filter(Boolean).join(' ');
        const hhmm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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

        function tendaiRow(t) {
            const q = (s) => `“${s}”`;
            let main;
            if (t.action === 'delete') main = `${t.text ? q(t.text) : (t.count ? `Delete ${t.count} occurrence(s)` : 'Delete all')}${t.text ? (t.count ? ` (${t.count} occurrence(s))` : ' (all occurrences)') : ''}`;
            else if (t.action === 'append') main = `${t.find ? `${q(t.find)} + ` : ''}${t.text ? q(t.text) : 'N/A'}`;
            else main = `${t.find ? q(t.find) : 'N/A'} → ${t.text ? q(t.text) : 'N/A'}`;
            const sub = [where(t), t.category, STATUS[t.status] || '', t.converted ? 'Converted' : '', t.emphasis != null ? `Emphasis ${t.emphasis.toFixed(2)}` : ''].filter(Boolean).join(' · ');
            return `<div class="wdi-row${t.uc ? ' is-uc' : ''}" data-row="t:${t.i}">`
                + `<label class="wm-check"><input type="checkbox" data-wdi-lock="t:${t.i}" aria-label="Lock this replacement"${t.locked ? ' checked' : ''}><span></span></label>`
                + `<button type="button" class="wdi-text" data-wdi-menu="t:${t.i}"><span class="wdi-val">${toolIcon(ACTION_ICON[t.action] || ACTION_ICON.replace)}${esc(main)}</span>`
                + (sub ? `<span class="wdi-sub">${esc(sub)}</span>` : '')
                + (t.anchor ? `<span class="wdi-sub">Anchor ${esc(q(t.anchor))}</span>` : '')
                + (t.error ? `<span class="wdi-sub">${esc(t.error)}</span>` : '')
                + (t.reason ? `<span class="wdi-sub wdi-reason">${esc(q(t.reason))}</span>` : '')
                + '</button></div>';
        }

        function drawBody(box, d) {
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
            if (!d.seeds.length && !d.rentan) {
                html += `<p class="wds-none">${d.hasData ? 'No expanders in use. Menu &gt; Refresh Expanders scans the prompts for them.' : 'No Genso yet: expanders used in a print show their picks here.'}</p>`;
            }
            const body = box.querySelector('.wdi-body');
            body.innerHTML = html;
        }

        function draw(el) {
            const box = el.querySelector('.wds-insp');
            if (!box || !api.ui) return;
            const s = api.read();
            // the seed row as the program draws it: its tool keeps data-insp="seed", so the program's own
            // handler (with its seed box when there is no seed to keep) answers the tap
            if (!box.querySelector('.wdi-body')) {
                box.innerHTML = '<div class="wm-form-sub">Seed</div><div class="wds-wt-row is-on"><span class="wds-wt-name"></span><span class="wds-wt-lcd wm-lcd wds-insp-seed"></span><button type="button" class="wm-tool" data-insp="seed" aria-label="Keep this seed" title="Keep this seed"></button></div><div class="wdi-body"></div>';
                bind(box);
                sig = '';
            }
            const kept = !!s.seedLock;
            box.querySelector('.wds-wt-name').textContent = kept ? 'Kept' : 'Random';
            const tool = box.querySelector('[data-insp="seed"]');
            tool.setAttribute('aria-pressed', String(kept));
            const icon = kept ? 'fas fa-lock' : 'fas fa-seedling';
            if (tool.dataset.icon !== icon) { tool.innerHTML = toolIcon(icon); tool.dataset.icon = icon; }
            const seed = String(s.seedText || (kept ? s.seed : '') || '');
            api.ui.segText(box.querySelector('.wds-insp-seed'), seed ? seed.padStart(10, '!') : '!!!!!!!!!!');
            data = has('inspector') ? M().inspector() : { seeds: [], tendai: [], rentan: null, hasData: false };
            // the list is drawn again only when it changed (every paint comes here: jogs, typing)
            const next = JSON.stringify([data, Math.floor(Date.now() / 60000)]);
            if (next !== sig) { sig = next; drawBody(box, data); }
        }

        // ---- what a row does

        const warn = (text) => api.sh.messageBox({ title: 'Inspector', text, icon: 'warning', modal: true });
        const after = () => { api.refresh(); sig = ''; api.paint(); };

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
            api.sh.dropdown(btn, [
                { label: 'Lock', checked: t.locked, action: () => { M().tendaiLock(t.i, !t.locked); after(); } },
                { label: 'Copy Value', disabled: !t.value, action: () => M().tendaiCopy(t.i) },
                { label: 'Apply to Prompt', disabled: !t.canApply, action: () => { Promise.resolve(M().tendaiApply(t.i)).then(after); } },
                '-',
                { label: 'Set Emphasis...', action: () => emphasisDialog(t) },
                { label: 'Delete', action: () => askDelete(t) }
            ], 'left');
        }

        function askDelete(t) {
            const what = t.find || t.text;
            api.sh.messageBox({ title: 'Inspector', text: `Are you sure you want to delete this replacement?${what ? `\n\n“${what}”` : ''}`, icon: 'question', modal: true, buttons: [{ text: 'Delete', value: true }, { text: 'Cancel', value: false, default: true }], cancelValue: false })
                .then((yes) => { if (yes) { M().tendaiDelete(t.i); after(); } });
        }

        /** Set Emphasis (the desktop asks for a number, 1.0 when none is set): a signed LCD with its jog; Set keeps it. */
        function emphasisDialog(t) {
            let v = t.emphasis != null ? t.emphasis : 1;
            const el = api.openDlg('Set Emphasis', 'wdi-empdlg', '<div class="wds-wt-row is-on"><span class="wds-wt-name">Emphasis</span><button type="button" class="wds-wt-lcd wm-lcd" aria-label="Emphasis: type a value"></button></div>'
                + '<div class="wm-msgbox-buttons"><button type="button" data-wdi-emp="set">Set</button><button type="button" data-wdi-emp="cancel">Cancel</button></div>');
            const row = el.querySelector('.wds-wt-row');
            const lcd = row.querySelector('.wm-lcd');
            const show = () => api.ui.segText(lcd, v.toFixed(2), { signed: true });
            show();
            const jog = api.ui.jogWheel(row, { label: 'Emphasis', value: v, min: -3, max: 5, step: 0.1, fineStep: 0.01, stepPx: 18, onChange: (n) => { v = Number(n); show(); } });
            lcd.addEventListener('click', () => api.ui.numPad({ title: 'Emphasis', value: v.toFixed(2), point: true, minus: true, max: 5, onOk: (txt) => { const n = Number(txt); if (Number.isFinite(n)) { v = Math.max(-3, Math.min(5, n)); jog.set(v); show(); } } }));
            el.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-wdi-emp]');
                if (!b) return;
                if (b.dataset.wdiEmp === 'set') M().tendaiEmphasis(t.i, Math.round(v * 100) / 100);
                api.closeDlg();
                after();
            });
        }

        const find = (ref) => {
            const [k, n] = String(ref || '').split(':');
            const list = data ? (k === 'g' ? data.seeds : data.tendai) : [];
            return { kind: k, item: list.find((x) => x.i === Number(n)) };
        };

        function bind(box) {
            box.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-wdi], [data-wdi-menu], [data-wdi-roll]');
                if (!b) return;
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

        reg.menu('main', () => {
            if (api.tab !== 'inspector' || api.view() !== 'home') return [];
            const d = M().inspector();
            return [
                { label: 'Refresh Expanders', action: () => { Promise.resolve(M().scanExpanders()).then(after); } },
                { label: 'Compiled Prompts', action: () => api.openView('compiled') },
                { label: 'Compile Tendai', disabled: !d.hasTendai, action: () => { Promise.resolve(M().compileTendai()).then(after); } },
                { label: 'Delete Managed', disabled: !M().hasManagedStages(), action: () => { M().deleteManagedStages(); after(); } }
            ];
        });
    });
})();
