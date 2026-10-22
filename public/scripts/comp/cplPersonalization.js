/**
 * Control Panel > Personalization, 1:1 with Vista's (Yukimi 2026-10-21: "update personalise to be
 * 1:1 like vista where it goes to subpage and update the elements to reside in pages they belong
 * in"). themecpl.dll's layouts on the Vista Aero VM: UIFILE 1001 (the hub), 1002 (Window Color and
 * Appearance); strings and icons from the same DLL.
 *
 *   Personalize appearance and sounds   the hub: one row per item (24 px icon, link, description)
 *     Window Color and Appearance  -> page 'window-color' (here)
 *     Desktop Background           -> page 'desktop-background' (cplDesktopBackground.js), now with
 *                                     the picture's position
 *     Screen Saver                 -> Screen Saver Settings dialog (personalizationDialogs.js)
 *     Sounds                       -> Sound dialog, Sounds tab (personalizationDialogs.js)
 *     Mouse Pointers               -> not built yet (a message says so)
 *     Theme                        -> Theme Settings dialog (personalizationDialogs.js)
 *     Display Settings             -> not built yet (a message says so)
 *
 * Window Color and Appearance: the swatches (Clear and Workspace, then Vista's eight), Enable
 * transparency, Color intensity (Vista's 10-85), Show color mixer (hue, saturation, brightness), and
 * the two settings Appearance Settings had (Yukimi 2026-10-21): the glass (Windows Aero live, Aero
 * frosted or Windows Vista Basic, aeroGlass.js) and Show window contents while dragging (live window
 * repositioning, saved to the user's global settings). Both apply to every workspace.
 * Every change previews at once (desktopPersonalization.preview, a layer over the saved settings);
 * OK saves only the page's own fields (colour, mixer, intensity, transparency), so a screen saver
 * or sound change made meanwhile stays; Cancel or leaving the page ends the preview, as Vista does.
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-personalization';
    let registered = false;

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function cpl() {
        return root.melatonControlPanel || null;
    }

    function pers() {
        return root.desktopPersonalization || null;
    }

    function dialogs() {
        return root.personalizationDialogs || null;
    }

    function notBuilt(title) {
        const box = root.bootMessageBox;
        if (box && typeof box.show === 'function') {
            box.show({ title, icon: 'info', message: `${title} is not available in Melaton yet.` });
        }
    }

    function icon(name) {
        return `<img class="cpl-pers-icon" src="${ART}/hub-${name}-24.png" srcset="${ART}/hub-${name}-24.png 1x, ${ART}/hub-${name}-48.png 2x" width="24" height="24" alt="" draggable="false">`;
    }

    // ---- the hub ------------------------------------------------------------------------------

    const HUB = [
        { id: 'window-color', icon: 'color', name: 'Window Color and Appearance',
            text: 'Fine tune the color and style of your windows.' },
        { id: 'desktop-background', icon: 'background', name: 'Desktop Background',
            text: 'Choose from available backgrounds or colors or use one of your own pictures to decorate the desktop.' },
        { id: 'screen-saver', icon: 'screensaver', name: 'Screen Saver',
            text: 'Change your screen saver or adjust when it displays. A screen saver is a picture or animation that covers your screen and appears when your computer is idle for a set period of time.' },
        { id: 'sounds', icon: 'sounds', name: 'Sounds',
            text: 'Change which sounds are heard when you do everything from getting e-mail to emptying your Recycle Bin.' },
        { id: 'mouse', icon: 'mouse', name: 'Mouse Pointers',
            text: 'Pick a different mouse pointer. You can also change how the mouse pointer looks during such activities as clicking and selecting.' },
        { id: 'theme', icon: 'theme', name: 'Theme',
            text: 'Change the theme. Themes can change a wide range of visual and auditory elements at one time including the appearance of menus, icons, backgrounds, screen savers, some computer sounds, and mouse pointers.' },
        { id: 'display', icon: 'display', name: 'Display Settings',
            text: 'Adjust your monitor resolution, which changes the view so more or fewer items fit on the screen. You can also control monitor flicker (refresh rate).' }
    ];

    function openHubItem(id) {
        const c = cpl();
        switch (id) {
            case 'window-color':
            case 'desktop-background':
                if (c) c.navigate(id);
                break;
            case 'theme':
                if (dialogs()) dialogs().openTheme();
                break;
            case 'screen-saver':
                if (dialogs()) dialogs().openScreenSaver();
                break;
            case 'sounds':
                if (dialogs()) dialogs().openSound();
                break;
            case 'mouse': notBuilt('Mouse Pointers'); break;
            case 'display': notBuilt('Display Settings'); break;
            case 'desktop-icons':
                // Desktop Icon Settings: public/scripts/comp/desktopIconDialogs.js
                if (typeof featureLoader !== 'undefined') {
                    featureLoader.loadFeature('desktop_icon_dialogs').then(() => {
                        if (root.desktopIconDialogs) root.desktopIconDialogs.openDesktopIconSettings();
                    }).catch((err) => console.error('Desktop Icon Settings', err));
                }
                break;
            case 'dpi': notBuilt('DPI Scaling'); break;
            case 'ease': notBuilt('Ease of Access Center'); break;
            default: break;
        }
    }

    function hubTasks() {
        const c = cpl();
        return `
            <div class="cpl-task-group">
                <h3 class="cpl-task-heading">Tasks</h3>
                <ul class="cpl-task-list">
                    <li><button type="button" class="cpl-link" data-cpl-pers="desktop-icons">Change desktop icons</button></li>
                    <li class="cpl-pers-shield"><img src="/static_images/vista-cpl/shield-uac-16.png" width="16" height="16" alt="" draggable="false"><button type="button" class="cpl-link" data-cpl-pers="dpi">Adjust font size (DPI)</button></li>
                </ul>
            </div>
            <div class="cpl-task-group cpl-task-group--see-also">
                <h3 class="cpl-task-heading">See also</h3>
                <ul class="cpl-task-list">
                    ${c ? c.taskLinkHtml('Taskbar and Start Menu', 'item', 'taskbar') : ''}
                    <li><button type="button" class="cpl-link" data-cpl-pers="ease">Ease of Access</button></li>
                </ul>
            </div>`;
    }

    function hubBody() {
        return `
            <div class="cpl-pers-hub">
                <h1 class="cpl-page-title">Personalize appearance and sounds</h1>
                ${HUB.map((item) => `
                    <div class="cpl-pers-task">
                        <button type="button" class="cpl-pers-task-icon" data-cpl-pers="${item.id}" tabindex="-1" aria-hidden="true">${icon(item.icon)}</button>
                        <div class="cpl-pers-task-text">
                            <button type="button" class="cpl-link cpl-pers-task-link" data-cpl-pers="${item.id}">${esc(item.name)}</button>
                            <p class="cpl-pers-task-desc">${esc(item.text)}</p>
                        </div>
                    </div>`).join('')}
            </div>`;
    }

    // ---- Window Color and Appearance -----------------------------------------------------------

    const wc = {
        main: null,
        pending: null, // what the page shows
        committed: false,
        mixerOpen: false,
        global: null,      // { glass, liveDrag } when the page opened
        globalPending: null
    };

    const GLASS_NAMES = [['live', 'Melaton Aero'], ['frosted', 'Melaton Aero (frosted glass)'], ['basic', 'Melaton Basic']];

    function readGlobal() {
        /* global desktopSettingsGlobalState */
        const live = typeof desktopSettingsGlobalState !== 'undefined' ? desktopSettingsGlobalState.liveWindowRepositioning === true : false;
        return { glass: root.aeroGlass ? root.aeroGlass.getMode() : 'live', liveDrag: live };
    }

    function applyGlobal(g, save) {
        // the preview does not store the mode; OK stores it even though the preview already shows it
        if (root.aeroGlass && (root.aeroGlass.getMode() !== g.glass || (save && wc.global && g.glass !== wc.global.glass))) {
            root.aeroGlass.setMode(g.glass, { persist: save });
        }
        // setLiveWindowRepositioningEnabled, persistUserGlobalSettingsPatch: modalUtils.js
        if (typeof root.setLiveWindowRepositioningEnabled === 'function') root.setLiveWindowRepositioningEnabled(g.liveDrag);
        if (save && typeof root.persistUserGlobalSettingsPatch === 'function' && wc.global && g.liveDrag !== wc.global.liveDrag) {
            Promise.resolve(root.persistUserGlobalSettingsPatch({ desktop: { liveWindowRepositioning: g.liveDrag } })).catch(() => {});
        }
    }

    function swatchHtml(sw, selected) {
        const art = sw.id === 'workspace'
            ? `<span class="cpl-pers-swatch-art cpl-pers-swatch-art--workspace" style="--cpl-pers-ws:${esc(workspaceColor())}"></span>`
            : `<img class="cpl-pers-swatch-art" src="${ART}/swatch-${sw.id}.png" width="64" height="64" alt="" draggable="false">`;
        return `
            <button type="button" class="cpl-pers-swatch${selected ? ' is-selected' : ''}" data-cpl-pers-swatch="${sw.id}"
                role="radio" aria-checked="${selected}" title="${esc(sw.name)}">
                ${art}
                <span class="cpl-pers-swatch-label">${esc(sw.name)}</span>
            </button>`;
    }

    function workspaceColor() {
        /* global workspaces, activeWorkspace */
        const id = (typeof activeWorkspace !== 'undefined' && activeWorkspace) || root.currentWorkspace || 'default';
        const ws = typeof workspaces !== 'undefined' && workspaces ? workspaces[id] : null;
        return (ws && (ws.backgroundColor || ws.color)) || '#0a1a2a';
    }

    function colorBody() {
        const p = wc.pending;
        const P = pers();
        const swatches = P ? P.SWATCHES : [];
        return `
            <div class="cpl-pers-page cpl-pers-color">
                <div class="cpl-pers-scroll">
                    <div class="cpl-pers-pane">
                        <h1 class="cpl-page-title">Window Color and Appearance</h1>
                        <p class="cpl-intro">You can change the color of windows. Pick one of the available colors or create your own color using the color mixer.</p>
                        <div class="cpl-pers-swatches" role="radiogroup" aria-label="Color swatch">
                            ${swatches.map((sw) => swatchHtml(sw, p.windowColor === sw.id)).join('')}
                        </div>
                        <div class="cpl-pers-check">
                            <input type="checkbox" id="cplPersTransparency"${p.transparency ? ' checked' : ''}>
                            <label for="cplPersTransparency">E<u>n</u>able transparency</label>
                        </div>
                        <div class="cpl-pers-perf">
                            <img src="${ART}/info-16.png" width="16" height="16" alt="Performance Information" draggable="false">
                            <span>Enabling transparency might adversely affect the performance of this computer.</span>
                        </div>
                        <div class="cpl-pers-slider-row">
                            <label class="cpl-pers-slider-label" for="cplPersIntensity">Color intensity:</label>
                            <input type="range" id="cplPersIntensity" class="cpl-pers-slider" min="${P.INTENSITY_MIN}" max="${P.INTENSITY_MAX}" step="1" value="${p.intensity}" aria-label="Color intensity">
                        </div>
                        <div class="cpl-pers-mixer${wc.mixerOpen ? ' is-open' : ''}">
                            <button type="button" class="cpl-pers-expando" data-cpl-pers="mixer" aria-expanded="${wc.mixerOpen}">
                                <span class="cpl-pers-expando-image" aria-hidden="true"></span>
                                <span class="cpl-pers-expando-text">${wc.mixerOpen ? 'Hide color mixer' : 'Show color mixer'}</span>
                            </button>
                            <div class="cpl-pers-mixer-body">
                                ${hsbRow('Hue', 'h', 359)}
                                ${hsbRow('Saturation', 's', 100)}
                                ${hsbRow('Brightness', 'b', 100)}
                            </div>
                        </div>
                        <div class="cpl-pers-slider-row cpl-pers-glass-row">
                            <span class="cpl-pers-slider-label">Glass:</span>
                            <button type="button" class="cpl-db-combo cpl-pers-glass" aria-label="Glass"></button>
                        </div>
                        <div class="cpl-pers-check">
                            <input type="checkbox" id="cplPersLiveDrag"${wc.globalPending && wc.globalPending.liveDrag ? ' checked' : ''}>
                            <label for="cplPersLiveDrag">Show window contents while dragging</label>
                        </div>
                    </div>
                </div>
                <div class="cpl-pers-footer">
                    <button type="button" class="cpl-wu-button" data-cpl-pers="ok">OK</button>
                    <button type="button" class="cpl-wu-button" data-cpl-pers="cancel">Cancel</button>
                </div>
            </div>`;
    }

    function hsbRow(label, key, max) {
        return `
            <div class="cpl-pers-slider-row">
                <label class="cpl-pers-slider-label" for="cplPersHsb-${key}">${label}:</label>
                <input type="range" id="cplPersHsb-${key}" class="cpl-pers-slider cpl-pers-hsb" data-hsb="${key}" min="0" max="${max}" step="1" aria-label="${label}">
            </div>`;
    }

    /** The colour the mixer shows: the custom one, or the selected swatch's. */
    function mixerColor(p) {
        const P = pers();
        if (p.windowColor === 'custom') return p.customColor;
        const { rgb } = P.frameColor({ ...p, transparency: true });
        return rgb ? P.rgbToHsb(rgb[0], rgb[1], rgb[2]) : p.customColor;
    }

    function syncColorControls() {
        const m = wc.main;
        if (!m) return;
        const p = wc.pending;
        const P = pers();
        m.querySelectorAll('[data-cpl-pers-swatch]').forEach((b) => {
            const on = b.dataset.cplPersSwatch === p.windowColor;
            b.classList.toggle('is-selected', on);
            b.setAttribute('aria-checked', String(on));
        });
        const tr = m.querySelector('#cplPersTransparency');
        if (tr) tr.checked = p.transparency;
        const it = m.querySelector('#cplPersIntensity');
        if (it && document.activeElement !== it) it.value = String(p.intensity);
        const hsb = mixerColor(p);
        const [r, g, b] = P.hsbToRgb(hsb.h, 100, 100);
        const full = P.hsbToRgb(hsb.h, hsb.s, 100);
        m.querySelectorAll('.cpl-pers-hsb').forEach((input) => {
            const key = input.dataset.hsb;
            if (document.activeElement !== input) input.value = String(hsb[key]);
        });
        const host = m.querySelector('.cpl-pers-mixer-body');
        if (host) {
            host.style.setProperty('--cpl-pers-hue-full', `rgb(${r} ${g} ${b})`);
            host.style.setProperty('--cpl-pers-sat-full', `rgb(${full[0]} ${full[1]} ${full[2]})`);
        }
    }

    function preview(patch) {
        const P = pers();
        if (!P) return;
        wc.pending = P.preview(patch);
        syncColorControls();
    }

    function onColorInput(ev) {
        const t = ev.target;
        if (t.id === 'cplPersIntensity') {
            preview({ intensity: Number(t.value) });
        } else if (t.classList && t.classList.contains('cpl-pers-hsb')) {
            const hsb = { ...mixerColor(wc.pending) };
            hsb[t.dataset.hsb] = Number(t.value);
            preview({ windowColor: 'custom', customColor: hsb });
        } else if (t.id === 'cplPersTransparency') {
            preview({ transparency: t.checked });
        } else if (t.id === 'cplPersLiveDrag' && ev.type === 'change') {
            wc.globalPending.liveDrag = t.checked;
            applyGlobal(wc.globalPending, false);
        }
    }

    function syncGlass() {
        const btn = wc.main && wc.main.querySelector('.cpl-pers-glass');
        if (btn) btn.textContent = (GLASS_NAMES.find(([id]) => id === wc.globalPending.glass) || GLASS_NAMES[0])[1];
    }

    /** OK / Cancel: back where the page was opened from, else Personalization (unmount reverts an unsaved preview). */
    function leaveColorPage() {
        const c = cpl();
        if (!c) return;
        c.goBack();
        if (c.currentPage() === 'window-color') c.navigate('personalization');
    }

    function onColorClick(ev) {
        const sw = ev.target.closest('[data-cpl-pers-swatch]');
        if (sw && wc.main && wc.main.contains(sw)) {
            const P = pers();
            const def = P.swatch(sw.dataset.cplPersSwatch);
            // Vista: a swatch brings its own intensity
            preview({ windowColor: sw.dataset.cplPersSwatch, intensity: def ? def.intensity : wc.pending.intensity });
            return true;
        }
        const act = ev.target.closest('[data-cpl-pers]');
        if (!act || !wc.main || !wc.main.contains(act)) return false;
        const what = act.dataset.cplPers;
        if (what === 'mixer') {
            wc.mixerOpen = !wc.mixerOpen;
            const box = wc.main.querySelector('.cpl-pers-mixer');
            box.classList.toggle('is-open', wc.mixerOpen);
            act.setAttribute('aria-expanded', String(wc.mixerOpen));
            act.querySelector('.cpl-pers-expando-text').textContent = wc.mixerOpen ? 'Hide color mixer' : 'Show color mixer';
            return true;
        }
        if (what === 'ok') {
            wc.committed = true;
            const p = wc.pending;
            // the page's own fields only, on top of whatever else changed meanwhile
            pers().update({ windowColor: p.windowColor, customColor: { ...p.customColor }, intensity: p.intensity, transparency: p.transparency }, { save: true });
            pers().preview(null);
            applyGlobal(wc.globalPending, true);
            leaveColorPage();
            return true;
        }
        if (what === 'cancel') {
            leaveColorPage();
            return true;
        }
        return false;
    }

    function mountColor(main) {
        const P = pers();
        if (!P) {
            main.innerHTML = '<p class="cpl-empty">Window Color and Appearance could not load.</p>';
            return;
        }
        wc.main = main;
        P.preview(null);
        wc.pending = { ...P.get() };
        wc.committed = false;
        wc.global = readGlobal();
        wc.globalPending = { ...wc.global };
        main.innerHTML = colorBody();
        syncColorControls();
        syncGlass();
        const glassBtn = main.querySelector('.cpl-pers-glass');
        if (glassBtn && root.contextMenu && typeof root.contextMenu.attachPickerMenu === 'function') {
            // contextMenu.attachPickerMenu: public/scripts/comp/contextMenu.js; previews at once
            root.contextMenu.attachPickerMenu(glassBtn, {
                items: () => GLASS_NAMES.map(([value, text]) => ({ value, text })),
                value: () => wc.globalPending.glass,
                onSelect: (v) => { wc.globalPending.glass = v; applyGlobal(wc.globalPending, false); syncGlass(); }
            });
        }
        main.addEventListener('input', onColorInput);
        main.addEventListener('change', onColorInput);
    }

    function unmountColor() {
        if (wc.main) {
            wc.main.removeEventListener('input', onColorInput);
            wc.main.removeEventListener('change', onColorInput);
        }
        // leaving without OK drops the preview (the saved settings were never touched)
        if (!wc.committed && pers()) pers().preview(null);
        if (!wc.committed && wc.global) applyGlobal(wc.global, false);
        wc.main = null;
    }

    // ---- registration -------------------------------------------------------------------------

    function onWindowClick(ev) {
        if (onColorClick(ev)) return;
        const el = ev.target.closest('[data-cpl-pers]');
        if (!el || !ev.currentTarget.contains(el)) return;
        const c = cpl();
        if (!c || !['personalization'].includes(c.currentPage())) return;
        ev.preventDefault();
        openHubItem(el.dataset.cplPers);
    }

    function wireWindow() {
        const modal = document.getElementById('melatonControlPanelModal');
        if (!modal || modal.dataset.cplPersWired) return;
        modal.dataset.cplPersWired = '1';
        modal.addEventListener('click', onWindowClick);
    }

    function register() {
        if (registered) return true;
        const c = cpl();
        if (!c || typeof c.registerPage !== 'function') return false;
        registered = true;
        c.registerPage('personalization', {
            title: () => 'Personalization',
            tasks: hubTasks,
            body: hubBody,
            mount: wireWindow
        });
        c.registerPage('window-color', {
            title: () => 'Window Color and Appearance',
            parent: 'personalization',
            tasks: () => '',
            body: () => '',
            mount: (main) => { wireWindow(); mountColor(main); },
            unmount: unmountColor
        });
        if (root.cplDesktopBackground && typeof root.cplDesktopBackground.register === 'function') {
            root.cplDesktopBackground.register();
        }
        return true;
    }

    root.cplPersonalization = { register, HUB, openHubItem };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
        else register();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplPersonalization;
})(typeof window !== 'undefined' ? window : globalThis);
