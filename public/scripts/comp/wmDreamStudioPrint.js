/**
 * Melaton Mobile: DreamStudio part - Print (#860 migration). Joins the program through
 * wmDreamStudio.extend; reaches Studio only through studioModel (studioModelPrint.js adds what it needs).
 *
 * What the desktop does with a print that the phone's Print rows did not have, as phone forms:
 *   Print     Enhance... (the desktop Enhance dialog: Magnitude LCD + jog, Upscale amount, the
 *             upscale's Scale and Delivery, the wrench's advanced rows, Prompt, Enhance after a
 *             question), Comparison (a page of its own: the source and the print, a wipe handle for
 *             Slide, the overlay's opacity / blend / colours / priority in its Menu, the desktop's
 *             own comparison state), Edit in Paint (a Paint page: brush, eraser back to the print,
 *             colour, size, undo, Save to the gallery), Original (Copy, Save to Phone, Expand
 *             Canvas, Delete) when an upscaled print kept its original, Copy, Move To (the other
 *             workspaces), Set as Today Background (the phone's own wallpaper), Add to Start
 *   File      Save to Start... (the session's request as a Start menu shortcut, the phone form of the
 *             desktop's Save As > To Desktop)
 *   View      Print History (the workspace gallery's prints, newest first, a dense list)
 * Start shortcuts (pictures and requests) are kept on this device and registered at load.
 * Styles: public/css/wm-ds-print.css.
 */
(function () {
    'use strict';
    if (window.uiShell !== 'mobile') return;
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    // ---------------------------------------------------------------- Start shortcuts
    // kept on this device (as the phone's Start menu choices are); each a program of the shell that
    // opens the picture, or DreamStudio with the request put back

    const PIN_KEY = 'wdsStartPins';
    let pinIds = new Set();

    function readPins() {
        try { const v = JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); return Array.isArray(v) ? v.filter((p) => p && p.id && p.name) : []; } catch (_) { return []; }
    }

    function writePins(list) {
        try { localStorage.setItem(PIN_KEY, JSON.stringify(list)); return true; } catch (_) { return false; }
    }

    /** Settings > Menus keeps its own Start list once saved: a new shortcut joins it (wmShortcuts.js does the same). */
    function startListAdd(id) {
        try {
            const saved = JSON.parse(localStorage.getItem('wmStartMenu') || 'null');
            if (Array.isArray(saved) && !saved.includes(id)) { saved.push(id); localStorage.setItem('wmStartMenu', JSON.stringify(saved)); }
        } catch (_) { /* Start shows the programs' own places */ }
    }

    function launchPin(p) {
        const sh = window.wmShell;
        if (!sh) return;
        if (p.kind === 'picture') {
            if (typeof sh.viewPicture === 'function') sh.viewPicture({ data: { filename: p.file } });
            return;
        }
        sh.open('studio');
        const M = window.studioModel;
        if (M && typeof M.applyRequest === 'function') sh.busy(M.applyRequest(p.payload).catch((err) => console.warn('[wmDreamStudio] request', err)), { delay: 250 });
    }

    function removePin(p) {
        const sh = window.wmShell;
        sh.messageBox({ title: 'Remove Shortcut', icon: 'warning', text: `Remove the shortcut '${p.name}'?`, modal: true, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false })
            .then((yes) => { if (!yes) return; writePins(readPins().filter((x) => x.id !== p.id)); syncPins(); });
    }

    function syncPins() {
        const sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return false;
        const want = new Set();
        readPins().forEach((p) => {
            const id = `ds-pin:${p.id}`;
            want.add(id);
            sh.registerApp({ id, title: p.name, icon: p.kind === 'picture' ? 'app-pictures' : 'app-studio', inStart: 'top', launch: () => launchPin(p), holdMenu: () => [{ label: 'Remove', action: () => removePin(p) }] });
        });
        pinIds.forEach((id) => { if (!want.has(id) && typeof sh.removeApp === 'function') sh.removeApp(id); });
        pinIds = want;
        document.dispatchEvent(new CustomEvent('wmAppsChanged'));
        return true;
    }

    function addPin(p) {
        const list = readPins();
        const id = `${p.kind}-${Date.now().toString(36)}`;
        list.push(Object.assign({ id }, p));
        if (!writePins(list)) return false;
        startListAdd(`ds-pin:${id}`);
        syncPins();
        return true;
    }

    // the shell not up yet: pinned once it is (wmShellReady), not a 500 ms poll for it
    if (!syncPins()) document.addEventListener('wmShellReady', () => { syncPins(); }, { once: true, signal: appScopeSignal });

    if (!window.wmDreamStudio || typeof window.wmDreamStudio.extend !== 'function') return;

    window.wmDreamStudio.extend('Print', (api, reg) => {
        const M = api.M;
        if (!M || typeof M.selectFull !== 'function') return;
        const { esc } = api;
        const ui = () => api.ui;
        const sh = () => api.sh;
        const say = (text, icon = 'info', title = 'DreamStudio') => sh().messageBox({ title, text, icon, modal: true });
        const ask = (text, title = 'DreamStudio', icon = 'question') => sh().messageBox({ title, text, icon, modal: true, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false });
        const after = () => { api.refresh(); api.paint(); };
        const baseName = (f) => String(f || '').replace(/\.[^/.]+$/, '');

        /** Studio holds the print on show (with its original / upscaled pair) before `run(file)`. */
        const onPrint = (run) => {
            const f = api.shownPrint();
            if (!f) return null;
            return sh().busy(Promise.resolve(M.selectFull(f)).then((ok) => (ok ? run(f) : null)).then(after)
                .catch((err) => console.warn('[wmDreamStudio] print', err)), { delay: 250 });
        };

        const places = (v) => (String(v).split('.')[1] || '').length;

        /**
         * A dialog row's LCD with its jog wheel; a tap on the LCD opens the number pad. value null =
         * inherited: the LCD shows `inherit` faint until a value is set, the row's Default square
         * puts it back to inherited (opts.reset). onChange(value | null) once the wheel stops.
         */
        function numRow(row, { label, value, inherit = null, min, max, step, fine = 0, signed = false, reset = false, onChange }) {
            const lcd = row.querySelector('.wm-lcd');
            const dg = Math.max(places(step), fine ? places(fine) : 0);
            let cur = value;
            let timer = 0;
            const shown = () => (cur == null ? inherit : cur);
            const show = () => {
                const v = shown();
                ui().segText(lcd, v == null ? '' : Number(v).toFixed(dg), { signed });
                row.classList.toggle('is-inherited', cur == null);
            };
            const jog = ui().jogWheel(row, {
                label, value: shown() == null ? min : shown(), min, max, step, fineStep: fine, stepPx: 18, zeroStop: 0,
                onChange: (v) => { cur = v; show(); clearTimeout(timer); timer = setTimeout(() => onChange(cur), 120); }
            });
            lcd.addEventListener('click', () => ui().numPad({
                title: label,
                // typed afresh (the value on show would take the pad's figures)
                value: '',
                point: dg > 0,
                minus: signed,
                max: Math.max(2, String(Math.trunc(Math.max(Math.abs(min), Math.abs(max)))).length + dg),
                onOk: (t) => {
                    const n = parseFloat(t);
                    if (!Number.isFinite(n)) return;
                    cur = Math.max(min, Math.min(max, Number(n.toFixed(dg))));
                    jog.set(cur);
                    show();
                    onChange(cur);
                }
            }));
            if (reset) {
                row.insertAdjacentHTML('beforeend', `<button type="button" class="wm-valuepop-default" aria-label="${esc(label)}: Inherited" title="Inherited"></button>`);
                row.lastElementChild.addEventListener('click', () => { cur = null; if (inherit != null) jog.set(inherit); show(); onChange(null); });
            }
            show();
            return {
                /** a new inherited value (Strength / Noise follow Magnitude until they are set) */
                inherit(v) { inherit = v; if (cur == null) { jog.set(v); show(); } },
                get: () => cur
            };
        }

        const lcdRow = (key, label) => `<div class="wds-wt-row is-on" data-j="${key}"><span class="wds-wt-name">${esc(label)}</span><button type="button" class="wds-wt-lcd wm-lcd wdp-padlcd" aria-label="${esc(label)}: type a value"></button></div>`;
        const comboRow = (key, label, value) => `<div class="wds-wt-row is-on"><span class="wds-wt-name">${esc(label)}</span>${ui().comboHtml(key, value)}</div>`;
        const nameIn = (list, v, none) => { const x = list.find((o) => o[0] === v); return x ? x[1] : none; };

        // ---------------------------------------------------------------- Enhance

        /**
         * The desktop's Enhance dialog (Studio's): the question, Magnitude, Upscale amount with the
         * wrench (the advanced rows), the upscale's Scale and Delivery, the hint; Prompt and Enhance.
         */
        function enhanceDialog() {
            const f = api.shownPrint();
            if (!f) return;
            const o = M.enhanceOptions(f);
            const v = { scale: o.scale, magnitude: o.magnitude, strength: null, noise: null, steps: null, guidance: null, rescale: null, seed: null, sampler: '', noiseScheduler: '', model: '', speed: 'instant', localScale: o.upscaleScales.includes(4) ? 4 : o.upscaleScales[0] };
            const dims = o.dims ? `${o.dims.width} x ${o.dims.height}` : 'the source dimensions';
            const scaleName = (s) => nameIn(o.scales.map((x) => [x.value, x.name]), s, s === 'max' ? 'Max' : `${s}x`);
            const DELIVERY = [['instant', 'Instant'], ['fast', 'Fast'], ['slow', 'Slow']];
            const hint = (s) => (s === 'max' ? 'Max preserves the source width and height and creates a new gallery image.' : 'Enhance reprocesses the image with its prompt and saves a new gallery image.');
            const el = api.openDlg('Enhance', 'wdp-dlg wdp-enh', `<p class="wdp-q">Enhance this image from ${esc(dims)}?</p>`
                + lcdRow('mag', 'Magnitude')
                + `<div class="wds-wt-row is-on"><span class="wds-wt-name">Upscale amount</span>${ui().comboHtml('scale', scaleName(v.scale))}<button type="button" class="wm-tool" data-e="adv" aria-pressed="false" aria-label="Advanced" title="Advanced">${api.toolIcon('fas fa-wrench')}</button></div>`
                + `<div class="wds-wt-row is-on wdp-pair"><span class="wds-wt-name">Scale</span>${ui().comboHtml('lscale', `${v.localScale}x`)}<span class="wds-wt-name">Delivery</span>${ui().comboHtml('speed', 'Instant')}</div>`
                + '<div class="wdp-adv" hidden>'
                + lcdRow('strength', 'Strength') + lcdRow('noise', 'Noise') + lcdRow('steps', 'Steps') + lcdRow('guidance', 'Guidance') + lcdRow('rescale', 'Rescale')
                + comboRow('sampler', 'Sampler', 'Inherited') + (o.hasNoise ? comboRow('noisesch', 'Noise Scheduler', 'Inherited') : '') + comboRow('model', 'Model', 'Inherited')
                + `<div class="wds-wt-row is-on is-inherited" data-j="seed"><span class="wds-wt-name">Seed</span><button type="button" class="wds-wt-lcd wm-lcd wdp-padlcd wdp-seed" aria-label="Seed: type a value"></button><button type="button" class="wm-valuepop-default" aria-label="Seed: Random" title="Random"></button></div>`
                + '</div>'
                + `<p class="wm-form-note wdp-hint">${esc(hint(v.scale))}</p>`
                + '<div class="wm-msgbox-buttons"><button type="button" data-e="prompt">Prompt</button><button type="button" data-e="go">Enhance</button></div>');
            const q = (s) => el.querySelector(s);
            const preset = (m) => M.magnitudePreset(m) || { strength: 0.5, noise: 0 };
            numRow(q('[data-j="mag"]'), { label: 'Magnitude', value: v.magnitude, min: 1, max: 5.5, step: 0.5, fine: 0.1, onChange: (n) => { v.magnitude = n; strength.inherit(preset(n).strength); noise.inherit(preset(n).noise); } });
            const strength = numRow(q('[data-j="strength"]'), { label: 'Strength', value: null, inherit: preset(v.magnitude).strength, min: 0, max: 1, step: 0.05, fine: 0.01, reset: true, onChange: (n) => { v.strength = n; } });
            const noise = numRow(q('[data-j="noise"]'), { label: 'Noise', value: null, inherit: preset(v.magnitude).noise, min: 0, max: 1, step: 0.05, fine: 0.01, reset: true, onChange: (n) => { v.noise = n; } });
            // blank = the print's own value (shown faint once its settings are read)
            const steps = numRow(q('[data-j="steps"]'), { label: 'Steps', value: null, min: 1, max: 50, step: 1, reset: true, onChange: (n) => { v.steps = n; } });
            const guidance = numRow(q('[data-j="guidance"]'), { label: 'Guidance', value: null, min: 0, max: 10, step: 0.1, reset: true, onChange: (n) => { v.guidance = n; } });
            const rescale = numRow(q('[data-j="rescale"]'), { label: 'Rescale', value: null, min: 0, max: 1, step: 0.05, fine: 0.01, reset: true, onChange: (n) => { v.rescale = n; } });
            M.printMeta(f).then((m) => {
                if (!m || !el.isConnected) return;
                if (m.steps != null) steps.inherit(m.steps);
                if (m.guidance != null) guidance.inherit(m.guidance);
                if (m.rescale != null) rescale.inherit(m.rescale);
            });
            ui().bindCombo(q('[data-act="scale"]'), o.scales.map((x) => [x.value, x.name]), v.scale, (s) => { v.scale = s; q('.wdp-hint').textContent = hint(s); });
            ui().bindCombo(q('[data-act="lscale"]'), o.upscaleScales.map((n) => [n, `${n}x`]), v.localScale, (n) => { v.localScale = n; });
            ui().bindCombo(q('[data-act="speed"]'), DELIVERY, v.speed, (s) => { v.speed = s; });
            const inherited = (list) => [['', 'Inherited'], ...list];
            ui().bindCombo(q('[data-act="sampler"]'), inherited(o.samplers), '', (s) => { v.sampler = s; });
            if (o.hasNoise) ui().bindCombo(q('[data-act="noisesch"]'), inherited(o.noise), '', (s) => { v.noiseScheduler = s; });
            ui().bindCombo(q('[data-act="model"]'), inherited(o.models), '', (s) => { v.model = s; });
            // Seed: blank is Random (the desktop's placeholder); a tap types one, the square clears it
            const seedRow = q('[data-j="seed"]');
            const seedLcd = q('.wdp-seed');
            const showSeed = () => { ui().segText(seedLcd, v.seed == null ? '!!!!!!!!!!' : String(v.seed).padStart(10, '!')); seedRow.classList.toggle('is-inherited', v.seed == null); };
            showSeed();
            seedLcd.addEventListener('click', () => ui().numPad({ title: 'Seed', value: v.seed == null ? '' : String(v.seed), max: 10, onOk: (t) => { const n = parseInt(t, 10); v.seed = Number.isFinite(n) ? n : null; showSeed(); } }));
            seedRow.querySelector('.wm-valuepop-default').addEventListener('click', () => { v.seed = null; showSeed(); });
            el.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-e]');
                if (!b) return;
                if (b.dataset.e === 'adv') {
                    const open = b.getAttribute('aria-pressed') !== 'true';
                    b.setAttribute('aria-pressed', String(open));
                    q('.wdp-adv').hidden = !open;
                } else if (b.dataset.e === 'prompt') {
                    onPrint(() => M.action('view-image-data'));
                } else if (b.dataset.e === 'go') {
                    // Enhance is paid NovelAI work: the phone asks before it goes
                    ask(`Enhance this image from ${dims}? Enhance can spend Anlas.`, 'Enhance').then((yes) => {
                        if (!yes) return;
                        api.closeDlg();
                        M.enhance(o.filename, v).catch((err) => say(`The image could not be enhanced.\n${(err && err.message) || ''}`, 'error', 'Enhance'));
                    });
                }
            });
        }

        // ---------------------------------------------------------------- Comparison

        let cmpPrint = '';

        function openCompare() {
            const f = api.shownPrint();
            if (!f) return;
            cmpPrint = f;
            const st = M.compareState();
            // the page compares: a source with no mode on opens on Slide (the wipe)
            if (st.has && !st.slide && !st.overlay) M.compareDo('compareToggleSlide');
            api.openView('compare');
        }

        /** The print on show becomes the comparison's source (Enable, or Replace Source). */
        function setSource() {
            const has = M.compareState().has;
            onPrint(() => {
                M.compareDo(has ? 'compareReplaceSource' : 'compareEnable');
                const st = M.compareState();
                if (st.has && !st.slide && !st.overlay) M.compareDo('compareToggleSlide');
            });
        }

        function drawCompare(el) {
            const st = M.compareState();
            const f = api.shownPrint() || cmpPrint;
            const stage = el.querySelector('.wdp-cmp-stage');
            const res = el.querySelector('.wdp-cmp-res');
            const src = el.querySelector('.wdp-cmp-src');
            const handle = el.querySelector('.wdp-cmp-handle');
            const none = el.querySelector('.wdp-cmp-none');
            const rs = f ? api.pictureUrl(f) : '';
            if (rs && res.getAttribute('src') !== rs) res.src = rs;
            res.hidden = !rs;
            none.hidden = st.has;
            none.textContent = st.has ? '' : 'No comparison source. Set Source makes this print the source.';
            const ss = st.has ? (st.file ? M.galleryUrl(st.file) : st.url) : '';
            if (ss && src.getAttribute('src') !== ss) src.src = ss;
            src.hidden = !ss;
            // the desktop's layering (compareViewManager.js updateCompareDisplayState): the overlaid
            // picture on top at the chosen opacity and blend, Slide clips it at the split
            const priGen = st.priority === 'generation';
            const top = st.overlay && priGen ? res : src;
            const under = top === res ? src : res;
            top.classList.add('is-top');
            under.classList.remove('is-top', 'is-clip');
            top.classList.toggle('is-clip', st.slide);
            top.style.opacity = st.overlay ? String(st.opacity / 100) : '';
            top.style.mixBlendMode = st.overlay ? st.blend : '';
            under.style.opacity = '';
            under.style.mixBlendMode = '';
            src.style.filter = st.filters[st.sourceColor] || '';
            res.style.filter = st.filters[st.resultColor] || '';
            // neither mode on: the print alone (the source hidden), as the desktop shows it
            if (st.has && !st.slide && !st.overlay) src.hidden = true;
            stage.style.setProperty('--wdp-split', `${st.split}%`);
            handle.hidden = !(st.has && st.slide);
        }

        function bindWipe(el) {
            const stage = el.querySelector('.wdp-cmp-stage');
            let id = null;
            const at = (e) => {
                const r = stage.getBoundingClientRect();
                const pct = Math.max(0, Math.min(100, ((e.clientX - r.left) / Math.max(1, r.width)) * 100));
                stage.style.setProperty('--wdp-split', `${pct}%`);
                M.compareSplit(pct);
            };
            stage.addEventListener('pointerdown', (e) => {
                if (!M.compareState().slide || id != null) return;
                id = e.pointerId;
                try { stage.setPointerCapture(id); } catch (_) { /* capture is a nicety */ }
                at(e);
                e.preventDefault();
            });
            stage.addEventListener('pointermove', (e) => { if (e.pointerId === id) at(e); });
            const end = (e) => { if (e.pointerId === id) id = null; };
            stage.addEventListener('pointerup', end);
            stage.addEventListener('pointercancel', end);
        }

        function compareMenu() {
            const st = M.compareState();
            const off = !st.overlay;
            const act = (a, value) => () => { M.compareDo(a, value); api.paint(); };
            const radios = (list, cur, a) => list.map((x) => (x === '-' ? '-' : { label: x[1], radio: x[0] === cur, action: act(a, x[0]) }));
            const rows = [{ label: st.has ? 'Replace Source' : 'Set Source', disabled: !api.shownPrint(), action: setSource }];
            if (!st.has) return rows;
            rows.push(
                '-',
                { label: 'Slide', checked: st.slide, action: act('compareToggleSlide') },
                { label: 'Overlay', checked: st.overlay, action: act('compareToggleOverlay') },
                '-',
                { label: 'Priority', disabled: off, submenu: () => radios([['source', 'Result'], ['generation', 'Source']], st.priority, 'setComparePriority') },
                { label: 'Visibility', disabled: off, submenu: () => radios(st.opacities.map((n) => [n, `${n}%`]), st.opacity, 'setCompareOpacity') },
                { label: 'Blending', disabled: off, submenu: () => radios(st.blends, st.blend, 'setCompareBlend') },
                { label: 'Color', disabled: off, submenu: () => [{ label: 'Source', submenu: () => radios(st.colors, st.sourceColor, 'setCompareSourceColor') }, { label: 'Result', submenu: () => radios(st.colors, st.resultColor, 'setCompareGenerationColor') }] },
                '-',
                { label: 'Defaults', submenu: () => [{ label: 'Save Default Settings', action: act('compareSaveDefaultSettings') }, { label: 'Clear Default Settings', disabled: !st.savedDefaults, action: act('compareClearDefaultSettings') }, { label: 'Auto Enable State', checked: st.autoEnable, action: act('compareToggleAutoEnableState') }] },
                { label: 'Reset Controls', action: act('compareResetControls') },
                { label: 'Stop Comparison', action: act('compareClearSource') }
            );
            return rows;
        }

        reg.view('compare', {
            title: 'Comparison',
            mount(el) {
                el.innerHTML = '<div class="wdp-cmp-stage"><img class="wdp-cmp-res" alt=""><img class="wdp-cmp-src" alt=""><div class="wdp-cmp-handle" hidden><span class="wdp-cmp-grip"></span></div></div><p class="wds-none wdp-cmp-none" hidden></p>';
                bindWipe(el);
            },
            draw: (el) => drawCompare(el),
            softKeys: () => (M.compareState().has
                ? { left: { label: 'Done', action: () => api.closeView() }, right: { label: 'Menu', menu: compareMenu } }
                : { left: { label: 'Set Source', disabled: !api.shownPrint(), action: setSource }, right: { label: 'Menu', menu: compareMenu } }),
            menu: compareMenu
        });

        // ---------------------------------------------------------------- Paint

        // the desktop's Edit in Paint opens Melaton Paint, a desktop window; the phone has no paint
        // program, so DreamStudio carries a small one: the print on a canvas, a brush in a colour and
        // a size, an eraser that brings the print back, undo, and Save (a new picture in the gallery)
        const pt = { file: '', tool: 'brush', color: '', size: 8, dirty: false, undo: [], orig: null, el: null };

        function hexOf(css) {
            const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(css || ''));
            return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : '';
        }

        function openPaint() {
            const f = api.shownPrint();
            if (!f) return;
            pt.file = f;
            pt.dirty = false;
            pt.undo = [];
            pt.orig = null;
            api.openView('paint');
            loadPaint();
        }

        /**
         * Paint left (ok, Back, Close, another tab): the print it held three times over goes (the canvas,
         * the untouched copy the eraser paints back, up to six full undo snapshots: ~520 MB for a 4x
         * upscale, #890). Opening it again reads the print anew, as it always did.
         */
        function freePaint() {
            pt.loadSeq = (pt.loadSeq || 0) + 1;
            pt.undo = [];
            pt.dirty = false;
            if (pt.orig) { pt.orig.width = 0; pt.orig.height = 0; }
            pt.orig = null;
            const cv = pt.el && pt.el.querySelector('canvas');
            if (cv && (cv.width || cv.height)) { cv.width = 0; cv.height = 0; }
        }

        function loadPaint() {
            const el = pt.el;
            if (!el) return;
            const cv = el.querySelector('canvas');
            const img = new Image();
            const seq = (pt.loadSeq = (pt.loadSeq || 0) + 1);
            img.onload = () => {
                // Paint was left (or opened on another print) while the print loaded
                if (seq !== pt.loadSeq || String(api.view()) !== 'x:paint') return;
                cv.width = img.naturalWidth;
                cv.height = img.naturalHeight;
                const ctx = cv.getContext('2d');
                ctx.drawImage(img, 0, 0);
                pt.orig = document.createElement('canvas');
                pt.orig.width = cv.width;
                pt.orig.height = cv.height;
                pt.orig.getContext('2d').drawImage(img, 0, 0);
                fitPaint();
            };
            img.onerror = () => say('The print could not be opened in Paint.', 'error', 'Paint');
            img.src = M.galleryUrl(pt.file);
        }

        /** The canvas as large as the page allows, its own shape kept. */
        function fitPaint() {
            const el = pt.el;
            if (!el || !pt.orig) return;
            const stage = el.querySelector('.wdp-pt-stage');
            const cv = el.querySelector('canvas');
            const w = stage.clientWidth;
            const h = stage.clientHeight;
            if (!w || !h) return;
            const k = Math.min(w / cv.width, h / cv.height);
            cv.style.width = `${Math.floor(cv.width * k)}px`;
            cv.style.height = `${Math.floor(cv.height * k)}px`;
        }

        function drawPaintBar(el) {
            el.querySelectorAll('[data-pt="brush"], [data-pt="eraser"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pt === pt.tool)));
            el.querySelector('.wdp-pt-well').style.setProperty('--wm-swatch', pt.color);
            ui().segText(el.querySelector('[data-pt="size"]'), String(pt.size).padStart(3, '!'));
            el.querySelector('[data-pt="undo"]').disabled = !pt.undo.length;
        }

        function bindPaint(el) {
            const cv = el.querySelector('canvas');
            let id = null;
            let last = null;
            const pos = (e) => {
                const r = cv.getBoundingClientRect();
                return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * cv.width, y: ((e.clientY - r.top) / Math.max(1, r.height)) * cv.height };
            };
            const ctxFor = () => {
                const ctx = cv.getContext('2d');
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                // the size is in the picture's own pixels, as on the desktop
                ctx.lineWidth = pt.size;
                ctx.strokeStyle = pt.tool === 'eraser' ? ctx.createPattern(pt.orig, 'no-repeat') : pt.color;
                ctx.fillStyle = ctx.strokeStyle;
                return ctx;
            };
            cv.addEventListener('pointerdown', (e) => {
                if (id != null || !pt.orig) return;
                id = e.pointerId;
                try { cv.setPointerCapture(id); } catch (_) { /* capture is a nicety */ }
                const ctx = cv.getContext('2d');
                pt.undo.push(ctx.getImageData(0, 0, cv.width, cv.height));
                if (pt.undo.length > 6) pt.undo.shift();
                last = pos(e);
                const c = ctxFor();
                c.beginPath();
                c.arc(last.x, last.y, pt.size / 2, 0, Math.PI * 2);
                c.fill();
                pt.dirty = true;
                e.preventDefault();
            });
            cv.addEventListener('pointermove', (e) => {
                if (e.pointerId !== id) return;
                const p = pos(e);
                const c = ctxFor();
                c.beginPath();
                c.moveTo(last.x, last.y);
                c.lineTo(p.x, p.y);
                c.stroke();
                last = p;
            });
            const end = (e) => { if (e.pointerId !== id) return; id = null; drawPaintBar(el); sh().refreshSoftKeys(); };
            cv.addEventListener('pointerup', end);
            cv.addEventListener('pointercancel', end);
            el.querySelector('.wdp-pt-bar').addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-pt]');
                if (!b || b.disabled) return;
                const k = b.dataset.pt;
                if (k === 'brush' || k === 'eraser') { pt.tool = k; drawPaintBar(el); return; }
                if (k === 'undo') { const d = pt.undo.pop(); if (d) cv.getContext('2d').putImageData(d, 0, 0); pt.dirty = pt.undo.length > 0; drawPaintBar(el); return; }
                if (k === 'color') {
                    ui().popPanel(b, { label: 'Color', className: 'wdp-pt-colors', build(p) { ui().colorField(p, { value: pt.color, onChange: (c) => { pt.color = c; pt.tool = 'brush'; drawPaintBar(el); } }); } });
                    return;
                }
                if (k === 'size') ui().valuePop(b, { label: 'Size', min: 1, max: 500, step: 1, value: pt.size, onChange: (n) => { pt.size = n; drawPaintBar(el); } });
            });
            window.addEventListener('resize', () => { if (String(api.view()) === 'x:paint') fitPaint(); }, { signal: appScopeSignal });
        }

        function revertPaint() {
            const el = pt.el;
            if (!el || !pt.orig) return;
            const cv = el.querySelector('canvas');
            const ctx = cv.getContext('2d');
            pt.undo.push(ctx.getImageData(0, 0, cv.width, cv.height));
            ctx.drawImage(pt.orig, 0, 0);
            pt.dirty = false;
            drawPaintBar(el);
        }

        /** Save: the picture as a new PNG in the workspace's gallery (Paint's Save to Gallery); then: 'base' | 'today'. */
        function savePaint(then) {
            const el = pt.el;
            if (!el || !pt.orig) return;
            const cv = el.querySelector('canvas');
            const b64 = cv.toDataURL('image/png').split(',')[1];
            const name = `${baseName(pt.file) || 'untitled'}.png`;
            sh().busy(M.savePicture(b64, name).then((res) => {
                pt.dirty = false;
                const saved = (res && (res.filename || (res.image && res.image.filename))) || '';
                if (then === 'base' && saved && M.setBaseImage(saved)) { api.refresh(); api.closeView(); api.setTab('refs'); return; }
                say('Saved to the gallery.', 'info', 'Paint');
            }).catch((err) => say(`Paint cannot save to the gallery.\n${(err && err.message) || ''}`, 'error', 'Paint')), { delay: 250 });
        }

        reg.view('paint', {
            title: 'Paint',
            mount(el) {
                pt.el = el;
                el.innerHTML = '<div class="wm-toolbar wdp-pt-bar">'
                    + `<div class="wm-toolbar-group"><button type="button" class="wm-tool" data-pt="brush" aria-pressed="true" aria-label="Brush" title="Brush">${api.toolIcon('fas fa-paintbrush')}</button><button type="button" class="wm-tool" data-pt="eraser" aria-pressed="false" aria-label="Eraser" title="Eraser">${api.toolIcon('fas fa-eraser')}</button><button type="button" class="wm-tool" data-pt="color" aria-haspopup="dialog" aria-label="Color" title="Color"><span class="wm-color-cell wdp-pt-well"></span></button></div>`
                    + '<div class="wm-toolbar-group"><span class="wm-tool-sep" aria-hidden="true"></span><button type="button" class="wm-tool is-text wm-lcd" data-pt="size" aria-haspopup="dialog" aria-label="Size" title="Size"></button></div>'
                    + `<div class="wm-toolbar-group"><span class="wm-tool-sep" aria-hidden="true"></span><button type="button" class="wm-tool" data-pt="undo" aria-label="Undo" title="Undo">${api.toolIcon('fas fa-rotate-left')}</button></div>`
                    + '</div><div class="wdp-pt-stage"><canvas class="wdp-pt-canvas"></canvas></div>';
                bindPaint(el);
            },
            draw(el) {
                // the brush starts in the page's own ink (the theme's text colour)
                if (!pt.color) pt.color = hexOf(getComputedStyle(el).color) || hexOf(getComputedStyle(document.body).color);
                drawPaintBar(el);
                requestAnimationFrame(fitPaint);
            },
            // ok / Back with changes not saved asks first, as Menu > Close does (they were lost unasked)
            leave: () => (pt.dirty ? ask('Close Paint without saving the changes?', 'Paint', 'warning') : true),
            softKeys: () => ({
                left: { label: 'Save', disabled: !pt.orig, action: () => savePaint() },
                right: {
                    label: 'Menu',
                    menu: () => [
                        { label: 'Save and Use as Base Image', disabled: !pt.orig, action: () => savePaint('base') },
                        { label: 'Revert', disabled: !pt.dirty, action: revertPaint },
                        '-',
                        { label: 'Close', action: () => { if (!pt.dirty) { api.closeView(); return; } ask('Close Paint without saving the changes?', 'Paint', 'warning').then((yes) => { if (yes) { pt.dirty = false; api.closeView(); } }); } }
                    ]
                }
            })
        });

        // ---------------------------------------------------------------- Print History

        const HIST_PAGE = 40;
        let histShown = HIST_PAGE;

        function stamp(ms) {
            if (!ms) return '';
            try { return new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; }
        }

        function historyRows(f) {
            return [
                { label: 'View Full Screen', action: () => { if (typeof sh().viewPicture === 'function') sh().viewPicture({ data: { filename: f } }); } },
                { label: 'Show in Studio', action: () => sh().busy(M.selectFull(f).then(after), { delay: 250 }) },
                { label: 'Use Its Settings', action: () => sh().busy(M.openPicture(f).then(after).catch(() => {}), { delay: 250 }) },
                { label: 'Use as Base Image', action: () => { if (M.setBaseImage(f)) { api.refresh(); api.closeView(); api.setTab('refs'); } } }
            ];
        }

        reg.view('history', {
            title: 'Print History',
            mount(el) {
                el.addEventListener('click', (e) => {
                    const row = e.target.closest && e.target.closest('[data-hf]');
                    if (row) sh().dropdown(row, historyRows(row.dataset.hf), 'left');
                });
                el.addEventListener('scroll', () => {
                    if (el.scrollTop + el.clientHeight < el.scrollHeight - 40) return;
                    // the count only (studioModelPrint keeps the sorted list while the gallery is the same)
                    const h = M.history(0, 0);
                    if (histShown >= h.total) return;
                    histShown += HIST_PAGE;
                    api.paint();
                }, { passive: true });
            },
            draw(el) {
                const h = M.history(0, histShown);
                const mine = new Set(M.prints());
                const top = el.scrollTop;
                el.innerHTML = h.rows.length
                    ? `<div class="wm-listbox wdp-h-list">${h.rows.map((r) => `<div class="wm-listbox-row wdp-h-row${mine.has(r.filename) ? ' is-visit' : ''}" role="button" tabindex="0" data-hf="${esc(r.filename)}"><img alt="" loading="lazy" src="${esc(api.thumbUrl(r.filename))}"><span class="wdp-h-when">${esc(stamp(r.mtime))}</span><span class="wdp-h-size">${r.width && r.height ? esc(`${r.width}x${r.height}`) : ''}</span><span class="wdp-h-mark">${r.pinned ? api.toolIcon('fa-solid fa-star') : ''}</span></div>`).join('')}</div>`
                    : '<p class="wds-none">No prints in this workspace yet.</p>';
                el.scrollTop = top;
            }
        });

        // ---------------------------------------------------------------- the print's other rows

        function originalRows() {
            return [
                { label: 'Copy', action: () => onPrint((f) => M.originalAction(f, 'copy')) },
                { label: 'Save to Phone', action: () => { const f = api.shownPrint(); const o = M.originalOf(f); if (o && typeof sh().saveToPhone === 'function') sh().saveToPhone(M.galleryUrl(o), o); } },
                { label: 'Expand Canvas...', action: () => onPrint((f) => M.originalAction(f, 'expand')) },
                '-',
                {
                    label: 'Delete',
                    action: () => ask('Delete the original (un-upscaled) file? The upscaled version will be kept.', 'Original', 'warning').then((yes) => {
                        if (yes) sh().busy(M.deleteOriginal(api.shownPrint()).then(after).catch((err) => say(`Failed to delete original: ${(err && err.message) || ''}`, 'error')), { delay: 250 });
                    })
                }
            ];
        }

        function moveRows() {
            return M.moveTargets().map((w) => ({
                label: w.name,
                action: () => {
                    const f = api.shownPrint();
                    if (!f) return;
                    ask(`Move image to workspace "${w.name}"?`, 'Move').then((yes) => {
                        if (yes) sh().busy(M.movePrint(f, w.id).then(after).catch((err) => say(`Failed to move image to ${w.name}: ${(err && err.message) || ''}`, 'error', 'Move')), { delay: 250 });
                    });
                }
            }));
        }

        function addPrintToStart() {
            const f = api.shownPrint();
            if (!f) return;
            if (addPin({ kind: 'picture', name: baseName(f), file: f })) say('The print was added to the Start menu.');
            else say('The shortcut could not be kept on this device.', 'error');
        }

        function saveRequestToStart() {
            const payload = M.requestPayload();
            if (!payload) { say('Studio has nothing to save yet.'); return; }
            sh().messageBox({ title: 'Save to Start', text: 'Name:', input: { value: M.sessionName() || 'Studio Request' }, modal: true, buttons: [{ text: 'Save', value: true, default: true }, { text: 'Cancel', value: false }], cancelValue: false })
                .then((name) => {
                    const clean = String(name || '').trim();
                    if (!clean) return;
                    payload.title = clean;
                    if (!addPin({ kind: 'request', name: clean, payload })) say('The shortcut could not be kept on this device.', 'error');
                });
        }

        reg.menu('print', () => {
            const f = api.shownPrint();
            const none = !f;
            const rows = [
                { label: 'Enhance...', disabled: none, action: enhanceDialog },
                { label: 'Comparison', disabled: none, action: openCompare },
                { label: 'Edit in Paint', disabled: none, action: openPaint }
            ];
            if (f && M.originalOf(f)) rows.push({ label: 'Original', submenu: originalRows });
            const targets = none ? [] : M.moveTargets();
            rows.push(
                '-',
                { label: 'Copy', disabled: none, action: () => M.copyPicture(f) },
                { label: 'Move To', disabled: !targets.length, submenu: moveRows },
                { label: 'Set as Today Background', disabled: none || typeof sh().setTodayBackground !== 'function', action: () => sh().setTodayBackground(f, M.printItem(f)) },
                { label: 'Add to Start', disabled: none, action: addPrintToStart }
            );
            return rows;
        });
        reg.menu('file', () => [{ label: 'Save to Start...', action: saveRequestToStart }]);
        reg.menu('view', () => [{ label: 'Print History', action: () => { histShown = HIST_PAGE; api.openView('history'); } }]);

        // the comparison's page follows prints that land and the desktop's own changes to it
        M.on('end', () => { const v = String(api.view()); if (v === 'x:compare' || v === 'x:history') api.paint(); });
        // Paint lets go of its pictures once another page is drawn in its place
        reg.hook('paint', (v) => { if (String(v) !== 'x:paint' && (pt.orig || pt.undo.length)) freePaint(); });
        // closed with X (its pages go, no paint follows while it is away); a minimize keeps Paint as it was
        reg.hook('hide', () => { if (String(api.view()) !== 'x:paint' && (pt.orig || pt.undo.length)) freePaint(); });
    });
})();
