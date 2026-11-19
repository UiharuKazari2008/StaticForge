/*
 * DPI Scaling (#910): Vista's Personalization > "Adjust font size (DPI)" dialog and its Custom DPI Setting, measured on
 * the Vista Aero VM (DpiScaling.exe, 2026-11-19). On DreamOS the scale is the compositor's output scale, set live by
 * the CaféReady host (window.DreamOSSettings.display, injected by the DreamOS shell bridge) and kept on /data:
 *   Default scale = the panel's own (200% on a Retina panel), Larger scale = that x 1.25, Custom = any 100-300%.
 * The DPI figures in the labels follow (96 x scale). On the Android app's desktop shell (DeX / Continuity PC, #798) the
 * same shape comes from window.melatonDisplayScale (androidTrayProviders.js): the density of the display the desktop is
 * on, set by the app (wm density through its own shell), kept per display; 160 dpi is 100% (96 DPI), and the page's
 * devicePixelRatio follows live. Elsewhere (no DreamOS host, no app) the dialog is not offered.
 */
(function (root) {
    'use strict';
    const doc = root.document;
    if (!doc) return;

    function settings() {
        const s = root.DreamOSSettings;
        if (s && s.display && typeof s.display.get === 'function') return s.display;
        const a = root.melatonDisplayScale;
        return a && typeof a.get === 'function' && typeof a.set === 'function' ? a : null;
    }

    function el(tag, className, text) {
        const n = doc.createElement(tag);
        if (className) n.className = className;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    /** A Vista dialog window (light client) with only the close box (remoteAccessProperties.js makeWindow). */
    function makeWindow(id, title, clientClass) {
        const modal = el('div', `modal hidden on-top tbp-window dpi-window ${clientClass}-window`);
        modal.id = id;
        modal.dataset.windowIdentifier = id;
        modal.dataset.windowRestorePosition = 'false';
        modal.dataset.windowRestoreSize = 'false';
        modal.dataset.windowFixedSize = 'true';
        modal.dataset.vistaDialog = 'form';
        modal.dataset.windowClient = 'light';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', title);
        const cap = el('div', 'modal-window-title');
        const main = el('div', 'modal-window-title-main');
        const img = el('img', 'icon-image');
        img.alt = '';
        img.src = '/static_images/vista-cpl/dpi-16.png';
        main.append(img, el('span', '', title));
        cap.appendChild(main);
        const controls = el('div', 'modal-window-controls');
        const close = el('button', 'btn-danger close-btn btn-small');
        close.type = 'button';
        close.title = 'Close';
        const x = el('i', 'fa-regular fa-xmark-large');
        x.setAttribute('aria-hidden', 'true');
        close.appendChild(x);
        controls.appendChild(close);
        const content = el('div', `modal-content win7 tbp-client ${clientClass}`);
        modal.append(cap, el('div', 'modal-focus-overlay'), controls, content);
        doc.body.appendChild(modal);
        return { modal, content, close };
    }

    function showWindow(modal, owner) {
        if (owner && owner.id) modal.dataset.iconOwnerId = owner.id;
        callGlobal('openModal', modal);
        modal.classList.remove('hidden');
        root.requestAnimationFrame(() => {
            const r = modal.getBoundingClientRect();
            let cx = root.innerWidth / 2;
            let cy = (root.innerHeight - 35) / 2;
            if (owner) {
                const o = owner.getBoundingClientRect();
                cx = o.left + o.width / 2;
                cy = o.top + o.height / 2;
            }
            callGlobal('setModalOffsetsFromViewportTopLeft', modal, Math.max(0, Math.round(cx - r.width / 2)), Math.max(0, Math.round(cy - r.height / 2)));
        });
    }

    function closeWindow(modal) {
        if (!modal) return;
        try { callGlobal('closeModal', modal); } catch (_) { /* window manager gone */ }
        setTimeout(() => { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 400);
    }

    const pct = (scale) => Math.round(scale * 100);
    const dpi = (scale) => Math.round(96 * scale);

    let dlg = null; // { modal, content, def, saved, pending (null = default | number), custom }

    function render() {
        const c = dlg.content;
        const def = dlg.def;
        const larger = Math.round(def * 125) / 100;
        const p = dlg.pending;
        const isDefault = p === null || Math.abs(p - def) < 0.001;
        const isLarger = !isDefault && Math.abs(p - larger) < 0.001;
        c.querySelector('[data-dpi="default"] span').textContent = `Default scale (${dpi(def)} DPI) - fit more information`;
        c.querySelector('[data-dpi="larger"] span').textContent = `Larger scale (${dpi(larger)} DPI) - make text more readable`;
        c.querySelector('#dpi-default').checked = isDefault;
        c.querySelector('#dpi-larger').checked = isLarger;
        const custom = c.querySelector('.dpi-custom-choice');
        custom.hidden = isDefault || isLarger;
        if (!custom.hidden) custom.querySelector('span').textContent = `Custom scale (${dpi(p)} DPI)`;
        c.querySelector('#dpi-custom').checked = !custom.hidden;
        const changed = (p === null ? null : pct(p)) !== (dlg.saved === null ? null : pct(dlg.saved));
        c.querySelector('[data-action="apply"]').disabled = !changed;
    }

    async function apply() {
        const s = settings();
        if (!s) return false;
        if (dlg.can === false) {
            // the Android app sets a display's density through its own shell (Localhost ADB or Shizuku)
            if (root.bootMessageBox) root.bootMessageBox.show({ title: 'DPI Scaling', icon: 'error', message: 'The display scale could not be changed.', detail: 'Turn on Localhost ADB or Shizuku in the phone\'s Settings > Android Bridge, then try again.' });
            return false;
        }
        const r = await s.set(dlg.pending === null ? null : dlg.pending);
        if (r && r.error) {
            if (root.bootMessageBox) root.bootMessageBox.show({ title: 'DPI Scaling', icon: 'error', message: 'The display scale could not be changed.', detail: String(r.error) });
            return false;
        }
        dlg.saved = dlg.pending;
        render();
        return true;
    }

    function finish() {
        if (!dlg) return;
        const m = dlg.modal;
        dlg = null;
        closeWindow(m);
    }

    // ---- Custom DPI Setting ------------------------------------------------------------------

    const CHOICES = [100, 125, 150, 175, 200, 225, 250, 275, 300];

    function openCustom() {
        const start = dlg.pending === null ? dlg.def : dlg.pending;
        const { modal, content, close } = makeWindow('dpiCustomDialog', 'Custom DPI Setting', 'dpi-custom');
        content.innerHTML = `
            <div class="tbp-ctl tbp-static dpi-c-intro">For a custom DPI setting, select a percentage from the list, or drag the ruler with your mouse.</div>
            <div class="tbp-ctl tbp-static dpi-c-label">Scale to this percentage of normal size:</div>
            <select class="tbp-ctl tbp-select dpi-c-combo" aria-label="Scale to this percentage of normal size"></select>
            <div class="dpi-c-ruler" tabindex="0" aria-label="Ruler"><canvas width="320" height="54"></canvas></div>
            <div class="tbp-ctl tbp-static dpi-c-sample"></div>
            <div class="tbp-ctl tbp-check dpi-c-xp"><input type="checkbox" id="dpi-c-xp" checked disabled><label for="dpi-c-xp"><span>Use Windows XP style DPI scaling</span></label></div>
            <button type="button" class="tbp-ctl tbp-button dpi-c-ok" data-action="ok" data-dialog-primary="1">OK</button>
            <button type="button" class="tbp-ctl tbp-button dpi-c-cancel" data-action="cancel">Cancel</button>`;
        const combo = content.querySelector('.dpi-c-combo');
        const canvas = content.querySelector('canvas');
        const sample = content.querySelector('.dpi-c-sample');
        let value = pct(start);
        const fill = () => {
            const list = CHOICES.includes(value) ? CHOICES : [...CHOICES, value].sort((a, b) => a - b);
            combo.innerHTML = list.map((v) => `<option value="${v}"${v === value ? ' selected' : ''}>${v}%</option>`).join('');
            sample.textContent = `9 point Segoe UI at ${Math.round(96 * value / 100)} pixels per inch.`;
            // the ruler: inches at the chosen DPI, ticks every eighth, labels 0, 1, 2 ... (Vista's DpiScaling ruler)
            const ctx = canvas.getContext('2d');
            const ppi = 96 * value / 100;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, 1);
            ctx.font = '9pt "Segoe UI", Tahoma, sans-serif';
            for (let i = 0; i * ppi / 2 <= canvas.width; i++) {
                const x = Math.round(i * ppi / 2) + 0.5;
                const whole = i % 2 === 0;
                ctx.fillRect(Math.floor(x), 1, 1, whole ? 28 : 18);
                if (whole) ctx.fillText(String(i / 2), Math.floor(x) + 3, 50);
            }
        };
        fill();
        combo.addEventListener('change', () => { value = Number(combo.value) || 100; fill(); });
        // drag the ruler: the 1-inch mark follows the pointer
        let dragging = false;
        const fromX = (ev) => {
            const r = canvas.getBoundingClientRect();
            const x = Math.max(24, Math.min(canvas.width, ev.clientX - r.left));
            value = Math.max(100, Math.min(300, Math.round(x * 2 / 96 * 100 / 2 / 5) * 5));
            fill();
        };
        canvas.addEventListener('pointerdown', (ev) => { dragging = true; canvas.setPointerCapture(ev.pointerId); fromX(ev); });
        canvas.addEventListener('pointermove', (ev) => { if (dragging) fromX(ev); });
        canvas.addEventListener('pointerup', () => { dragging = false; });
        const done = (ok) => {
            if (ok && dlg) {
                const s = value / 100;
                dlg.pending = Math.abs(s - dlg.def) < 0.001 ? null : s;
                render();
            }
            closeWindow(modal);
        };
        content.addEventListener('click', (ev) => {
            const a = ev.target.closest('[data-action]');
            if (a) done(a.dataset.action === 'ok');
        });
        close.addEventListener('click', () => done(false));
        modal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') done(false);
            else if (ev.key === 'Enter' && ev.target.tagName !== 'SELECT') done(true);
        });
        showWindow(modal, dlg.modal);
    }

    // ---- the sheet ---------------------------------------------------------------------------

    async function open() {
        const s = settings();
        if (!s) return false;
        if (dlg) { callGlobal('bringModalToFront', dlg.modal); return true; }
        let cur = null;
        try { cur = await s.get(); } catch (_) { cur = null; }
        if (!cur || cur.error) return false;
        const { modal, content, close } = makeWindow('dpiScalingDialog', 'DPI Scaling', 'dpi-sheet');
        content.innerHTML = `
            <div class="tbp-tabs" role="tablist"><button type="button" class="tbp-tab is-selected" role="tab" aria-selected="true">DPI Scaling</button></div>
            <div class="tbp-pane">
                <div class="tbp-page" role="tabpanel">
                    <div class="tbp-ctl tbp-static dpi-intro">Choose a smaller scale to fit more information on the screen or a larger scale to make text more readable.&nbsp; <button type="button" class="tbp-link" data-action="help">How do I know which DPI to choose?</button></div>
                    <div class="tbp-ctl tbp-check dpi-r1" data-dpi="default"><input type="radio" id="dpi-default" name="dpi-choice"><label for="dpi-default"><span></span></label></div>
                    <div class="tbp-ctl tbp-check dpi-r2" data-dpi="larger"><input type="radio" id="dpi-larger" name="dpi-choice"><label for="dpi-larger"><span></span></label></div>
                    <div class="tbp-ctl tbp-check dpi-r3 dpi-custom-choice" hidden><input type="radio" id="dpi-custom" name="dpi-choice"><label for="dpi-custom"><span></span></label></div>
                    <button type="button" class="tbp-ctl tbp-button dpi-custom-btn" data-action="custom">Custom DPI...</button>
                </div>
            </div>
            <div class="tbp-footer">
                <button type="button" class="tbp-button tbp-footer-button" data-action="ok" data-dialog-primary="1">OK</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="cancel">Cancel</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="apply" disabled>Apply</button>
            </div>`;
        dlg = { modal, content, def: Number(cur.default) || 1, saved: cur.auto ? null : Number(cur.scale), pending: cur.auto ? null : Number(cur.scale), can: cur.can };
        render();
        content.addEventListener('change', (ev) => {
            if (ev.target.id === 'dpi-default') dlg.pending = null;
            else if (ev.target.id === 'dpi-larger') dlg.pending = Math.round(dlg.def * 125) / 100;
            render();
        });
        content.addEventListener('click', async (ev) => {
            const a = ev.target.closest('[data-action]');
            if (!a) return;
            switch (a.dataset.action) {
                case 'custom': openCustom(); break;
                case 'apply': await apply(); break;
                case 'ok': if (await apply()) finish(); break;
                case 'cancel': finish(); break;
                case 'help':
                    if (root.bootMessageBox) root.bootMessageBox.show({ title: 'DPI Scaling', icon: 'info', message: 'The default scale is what this screen was made for. A larger scale makes text and pictures bigger, so less fits on the screen; a smaller custom scale fits more.' });
                    break;
                default: break;
            }
        });
        close.addEventListener('click', () => finish());
        modal.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') finish(); });
        showWindow(modal, null);
        return true;
    }

    root.dpiScalingDialog = { open, available: () => !!settings() };
})(typeof window !== 'undefined' ? window : globalThis);
