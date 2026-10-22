/**
 * Taskbar and Start Menu Properties, 1:1 with Vista's (explorer.exe dialogs 6 Taskbar, 205 Start
 * Menu, 5 Notification Area, 10 Toolbars; sub-dialogs 7 Customize Notification Icons and 1036
 * Customize Start Menu), measured on the Vista Aero VM at 96 dpi. Lazy feature
 * "taskbar_properties" (featureLoader.js); opened by taskbarSettings.openProperties(tab) from
 * the taskbar's and the Start button's menus and from Control Panel's "Taskbar and Start Menu".
 *
 *   taskbarProperties.open(tab)   'taskbar' | 'startmenu' | 'notification' | 'toolbars'
 *
 * Controls sit where the dialog templates put them: MS Shell Dlg 8 dialog units, x * 6/4 and
 * y * 13/8 px, from the page origin 4 px right of and 2 px under the tab pane's corner.
 *
 * Every change goes to a pending copy; the previews draw from it. Apply saves and applies it
 * (and greys out until the next change), OK applies and closes, Cancel and the close box drop it.
 * Sub-dialogs (Customize...) write into the pending copy on their own OK, as Vista's do.
 *
 * Besides Vista's settings the dialog carries ours, as Vista-style controls in the fitting place:
 *   Taskbar tab          "Start button": its style, Windows logo and text (Logo and Text grey
 *                        out for the Orb); program pictures on taskbar buttons
 *   Start Menu tab       Customize Start Menu: the Start menu and All Programs icon sizes, which
 *                        places the menu shows, "Open the workspace at startup", how many recent
 *                        programs, and what the power and lock buttons do
 *   Notification Area    "Notifications": the shortest time a notification stays, and Customize
 *                        Notifications (which notifications to hide; the Notification Bridge
 *                        where an Android host is attached)
 *   Toolbars             Quick Launch and the Status ticker
 * Server-held settings (the Start button, program pictures, startup, the bridge) are saved with
 * persistUserGlobalSettingsPatch (modalUtils.js); the rest stay on this computer
 * (taskbarSettings.js, trayRegistry.js). Styles: public/css/taskbar-properties.css.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ART = '/static_images/vista-taskbar';
    const TABS = [
        { id: 'taskbar', label: 'Taskbar' },
        { id: 'startmenu', label: 'Start Menu' },
        { id: 'notification', label: 'Notification Area' },
        { id: 'toolbars', label: 'Toolbars' }
    ];
    // the taskbar's height for each Start button style (desktop-shell.css body.taskbar-orb /
    // body.taskbar-luna / body.desktop-mode)
    const PREVIEW_BAR_HEIGHTS = { orb: 31, luna: 33, workspace: 35 };
    const BEHAVIOR_LABELS = { inactive: 'Hide when inactive', hide: 'Hide', show: 'Show' };

    // dialog units -> px as the VM draws controls (MS Shell Dlg 8 at 96 dpi: 6 x 13 base units):
    // left, top and right edges round, the bottom edge drops its fraction (measured on the
    // Remote tab and Remote Access Properties, see remoteAccessProperties.js); inset pulls the
    // face in (Vista's buttons draw 1 px inside their rectangle)
    function bottomPx(y, h) {
        return Math.floor((y + h) * 1.625);
    }

    function dlu(x, y, w, h, inset = 0) {
        const left = Math.round(x * 1.5);
        const top = Math.round(y * 1.625);
        let s = `left:${left + inset}px;top:${top + inset}px;`;
        if (w !== undefined) s += `width:${Math.round((x + w) * 1.5) - left - 2 * inset}px;`;
        if (h !== undefined) s += `height:${bottomPx(y, h) - top - 2 * inset}px;`;
        return s;
    }

    /** A check box or radio button row: the 13 px box centred in the control (BS_VCENTER),
     *  floor((h - 13) / 2) under its top. */
    function checkStyle(x, y, w, h) {
        const height = bottomPx(y, h) - Math.round(y * 1.625);
        return `${dlu(x, y, w, h)}padding-top:${Math.max(0, Math.floor((height - 13) / 2))}px;`;
    }

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    // Monolith helpers are classic-script globals (not window properties): reached by name, guarded
    // with typeof so the file also loads in the node tests.
    /* global readDesktopSettingsStartMenuButtonPreference, readDesktopSettingsAutoLaunchPreference,
       readDesktopSettingsNotificationBridgeEnabledPreference, readDesktopSettingsBypassNotificationBridgeDesktopPreference,
       desktopSettingsGlobalState, persistUserGlobalSettingsPatch, isAndroidNotificationBridgeDetected,
       getStartMenuButtonPresetGroups, START_MENU_BUTTON_PRESET_META, resolveStartMenuButtonDisplayText,
       startMenuButtonLogoUrl, getStartMenuPlacesAll, trayMinPopupMs, traySetMinPopupMs, trayPopupTimeChoices,
       trayPopupCatalog, trayPopupHidden, traySetPopupHidden, trayIconCatalog, trayIconBehavior, traySetIconBehaviors,
       trayIconTucked, taskbarSettings, applyNotificationBridgePreferences, desktopSettingsPersistedStartMenuButton,
       desktopSettingsPersistedUseApplicationImageIcon */
    // ---- state ---------------------------------------------------------------------------------

    function bridgeDetected() {
        const fn = typeof isAndroidNotificationBridgeDetected !== 'undefined' ? isAndroidNotificationBridgeDetected : null;
        return typeof fn === 'function' && fn() === true;
    }

    function readState() {
        const core = root.taskbarSettings ? root.taskbarSettings.get() : {};
        const btnFn = typeof readDesktopSettingsStartMenuButtonPreference !== 'undefined' ? readDesktopSettingsStartMenuButtonPreference : null;
        const startButton = btnFn ? btnFn() : { preset: 'start-ja', customText: '', style: 'workspace', logo: 'dreamscape' };
        const gs = typeof desktopSettingsGlobalState !== 'undefined' ? desktopSettingsGlobalState : {};
        const behaviors = {};
        const catalog = (typeof trayIconCatalog !== 'undefined') ? trayIconCatalog() : [];
        catalog.forEach((row) => { behaviors[row.id] = trayIconBehavior(row.id); });
        const hiddenPopups = {};
        const popups = (typeof trayPopupCatalog !== 'undefined') ? trayPopupCatalog() : [];
        popups.forEach((row) => { hiddenPopups[row.id] = trayPopupHidden(row.id) === true; });
        const autoFn = typeof readDesktopSettingsAutoLaunchPreference !== 'undefined' ? readDesktopSettingsAutoLaunchPreference : null;
        const bridgeFn = typeof readDesktopSettingsNotificationBridgeEnabledPreference !== 'undefined' ? readDesktopSettingsNotificationBridgeEnabledPreference : null;
        const bypassFn = typeof readDesktopSettingsBypassNotificationBridgeDesktopPreference !== 'undefined' ? readDesktopSettingsBypassNotificationBridgeDesktopPreference : null;
        return {
            core,
            startButton: { ...startButton },
            useAppImageIcon: gs.useApplicationImageIcon === true,
            autoLaunch: autoFn ? autoFn() !== false : true,
            trayMinMs: (typeof trayMinPopupMs !== 'undefined') ? trayMinPopupMs() : 8000,
            behaviors,
            hiddenPopups,
            bridgeEnabled: bridgeFn ? bridgeFn() !== false : true,
            bridgeBypass: bypassFn ? bypassFn() === true : false
        };
    }

    function clone(state) {
        return JSON.parse(JSON.stringify(state));
    }

    let dlg = null;       // { modal, content, pending, saved, tab, sub }
    let seq = 0;

    // ---- markup helpers ------------------------------------------------------------------------

    function check(id, x, y, w, label, key, opts = {}) {
        return `<div class="tbp-ctl tbp-check" style="${checkStyle(x, y, w, 10)}"><input type="checkbox" id="tbp-${id}" data-key="${key}"${opts.disabled ? ' disabled' : ''}><label for="tbp-${id}"><span>${label}</span></label></div>`;
    }

    function radio(id, x, y, w, name, value, label, opts = {}) {
        return `<div class="tbp-ctl tbp-check" style="${checkStyle(x, y, w, 10)}"><input type="radio" id="tbp-${id}" name="tbp-${name}" value="${value}"${opts.disabled ? ' disabled' : ''}><label for="tbp-${id}"><span>${label}</span></label></div>`;
    }

    function group(x, y, w, h, label) {
        return `<div class="tbp-group" style="${dlu(x, y, w, h)}"><span class="tbp-group-label">${label}</span></div>`;
    }

    function text(x, y, w, h, body, cls = '') {
        return `<div class="tbp-ctl tbp-static ${cls}" style="${dlu(x, y, w, h)}">${body}</div>`;
    }

    function button(x, y, w, h, label, action, opts = {}) {
        return `<button type="button" class="tbp-ctl tbp-button" style="${dlu(x, y, w, h, 1)}" data-action="${action}"${opts.disabled ? ' disabled' : ''}>${label}</button>`;
    }

    function link(x, y, w, label, action) {
        return `<div class="tbp-ctl tbp-link-row" style="${dlu(x, y, w, 8)}"><button type="button" class="tbp-link" data-action="${action}">${label}</button></div>`;
    }

    // ---- pages (explorer.exe.mui dialog templates) ---------------------------------------------

    function pageTaskbar() {
        return `
            ${group(6, 6, 240, 133, 'Taskbar appearance')}
            <div class="tbp-ctl tbp-preview tbp-preview-taskbar" style="${dlu(13, 18, 224, 21)}"></div>
            ${check('lock', 13, 45, 200, '<u>L</u>ock the taskbar', 'locked')}
            ${check('autohide', 13, 58, 200, 'A<u>u</u>to-hide the taskbar', 'autoHide')}
            ${check('ontop', 13, 71, 200, 'Keep the <u>t</u>askbar on top of other windows', 'onTop')}
            ${check('group', 13, 84, 200, '<u>G</u>roup similar taskbar buttons', 'group')}
            ${check('quicklaunch', 13, 97, 200, 'Show <u>Q</u>uick Launch', 'quickLaunch')}
            ${check('thumbs', 13, 110, 200, '<u>S</u>how window previews (thumbnails)', 'thumbnails')}
            ${text(13, 125, 30, 8, 'O<u>p</u>acity:')}
            <input type="range" class="tbp-ctl tbp-opacity" id="tbp-opacity" min="20" max="100" step="1" style="${dlu(46, 121, 150, 15)}" aria-label="Taskbar opacity">
            ${text(200, 125, 30, 8, '100%', 'tbp-opacity-value')}
            ${group(6, 142, 240, 58, 'Start button')}
            ${text(13, 157, 26, 8, 'St<u>y</u>le:')}
            <select class="tbp-ctl tbp-select" id="tbp-sb-style" style="${dlu(40, 155, 86, 12)}" aria-label="Start button style">
                <option value="orb">Orb</option><option value="luna">Media Center</option><option value="workspace">Workspace</option>
            </select>
            ${text(132, 157, 22, 8, 'L<u>o</u>go:', 'tbp-sb-dep')}
            <select class="tbp-ctl tbp-select" id="tbp-sb-logo" style="${dlu(156, 155, 83, 12)}" aria-label="Melaton logo">
                <option value="royal">Royal</option><option value="vista">Vista</option><option value="dreamscape">Dreamscape</option>
            </select>
            ${text(13, 173, 26, 8, 'Te<u>x</u>t:', 'tbp-sb-dep')}
            <select class="tbp-ctl tbp-select" id="tbp-sb-text" style="${dlu(40, 171, 110, 12)}" aria-label="Start button text">${startTextOptions()}</select>
            <input type="text" class="tbp-ctl tbp-edit" id="tbp-sb-custom" maxlength="24" style="${dlu(154, 171, 85, 12)}" placeholder="Custom text" aria-label="Custom start button text">
            ${check('appicons', 13, 187, 224, 'Show program pictures on taskbar buttons', 'x:useAppImageIcon')}
            ${link(7, 205, 238, 'How do I customize the taskbar?', 'help-taskbar')}`;
    }

    function startTextOptions() {
        const groups = typeof getStartMenuButtonPresetGroups !== 'undefined' ? getStartMenuButtonPresetGroups() : [];
        return groups.map((gr) => `<optgroup label="${esc(gr.group)}">${gr.options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</optgroup>`).join('');
    }

    /** The Start button controls follow the pending style: Orb has its own flag and no text, so
     *  Logo, Text and the custom text grey out; the custom text only takes typing for Custom Text. */
    function syncStartButtonControls() {
        const c = dlg.content;
        const sb = dlg.pending.startButton;
        const style = c.querySelector('#tbp-sb-style');
        if (!style) return;
        style.value = sb.style;
        c.querySelector('#tbp-sb-logo').value = sb.logo;
        c.querySelector('#tbp-sb-text').value = sb.preset;
        const custom = c.querySelector('#tbp-sb-custom');
        if (document.activeElement !== custom) custom.value = sb.customText || '';
        const orb = sb.style === 'orb';
        c.querySelector('#tbp-sb-logo').disabled = orb;
        c.querySelector('#tbp-sb-text').disabled = orb;
        custom.disabled = orb || sb.preset !== 'custom';
        c.querySelectorAll('.tbp-sb-dep').forEach((el) => el.classList.toggle('is-disabled', orb));
    }

    function pageStartMenu() {
        return `
            ${radio('sm-vista', 7, 7, 105, 'smstyle', 'vista', '<u>S</u>tart menu')}
            ${text(20, 17, 150, 24, 'This menu style gives you easy access to your folders, favorite programs, and search.')}
            ${button(192, 4, 53, 14, '<u>C</u>ustomize...', 'customize-start')}
            ${radio('sm-classic', 7, 47, 105, 'smstyle', 'classic', 'Classic Start <u>m</u>enu', { disabled: true })}
            ${text(20, 57, 150, 24, 'This menu style gives you the look and functionality of previous versions of Melaton.', 'is-disabled')}
            ${button(192, 44, 53, 14, '<u>C</u>ustomize...', 'customize-classic', { disabled: true })}
            ${group(7, 100, 238, 42, 'Privacy')}
            ${check('recentfiles', 14, 114, 224, 'Store and display a list of recently opened <u>f</u>iles', 'recentFiles')}
            ${check('recentprogs', 14, 128, 224, 'Store and display a list of recently opened <u>p</u>rograms', 'recentPrograms')}
            ${link(7, 200, 238, 'How do I change the way the Start menu looks?', 'help-start')}`;
    }

    function pageNotification(state) {
        const times = (typeof trayPopupTimeChoices !== 'undefined') ? trayPopupTimeChoices() : [];
        return `
            <div class="tbp-ctl tbp-preview tbp-preview-tray" style="${dlu(7, 6, 238, 21)}"></div>
            ${group(6, 33, 240, 58, 'Icons')}
            ${text(13, 48, 223, 16, 'You can keep the notification area uncluttered by hiding icons that you have not clicked recently.')}
            ${check('hideinactive', 13, 70, 125, '<u>H</u>ide inactive icons', 'hideInactive')}
            ${button(188, 70, 50, 14, '<u>C</u>ustomize...', 'customize-icons')}
            ${group(6, 97, 240, 84, 'System icons')}
            ${text(13, 112, 223, 16, 'Select which system icons to always show.')}
            ${check('sys-clock', 13, 126, 200, 'Cloc<u>k</u>', 'clock')}
            ${check('sys-volume', 13, 139, 200, '<u>V</u>olume', 'volume')}
            ${check('sys-network', 13, 152, 200, '<u>N</u>etwork', 'network')}
            ${check('sys-power', 13, 164, 200, '<u>P</u>ower', 'power', { disabled: true })}
            ${group(6, 186, 240, 30, 'Notifications')}
            ${text(13, 200, 112, 8, 'Show notifications for at <u>l</u>east:')}
            <select class="tbp-ctl tbp-select" id="tbp-mintime" data-key="x:trayMinMs" style="${dlu(126, 198, 56, 12)}">
                ${times.map((t) => `<option value="${esc(t.value)}"${Number(t.value) === state.trayMinMs ? ' selected' : ''}>${esc(t.text)}</option>`).join('')}
            </select>
            ${button(188, 197, 50, 14, 'C<u>u</u>stomize...', 'customize-popups')}`;
    }

    function pageToolbars() {
        return `
            ${text(7, 7, 223, 12, 'Select which toolbars to add to the taskbar.')}
            <div class="tbp-ctl tbp-tree" style="${dlu(7, 20, 236, 160)}" role="tree">
                <div class="tbp-tree-row" role="treeitem"><input type="checkbox" id="tbp-tb-quicklaunch" data-key="quickLaunch"><label for="tbp-tb-quicklaunch">Quick Launch</label></div>
                <div class="tbp-tree-row" role="treeitem"><input type="checkbox" id="tbp-tb-ticker" data-key="ticker"><label for="tbp-tb-ticker">Status</label></div>
            </div>
            ${button(133, 186, 110, 14, '<u>R</u>estore Quick Launch Items', 'ql-restore')}`;
    }

    // ---- previews ------------------------------------------------------------------------------

    /** The taskbar as the pending settings would draw it, with our own parts (Vista's bitmaps 145-153). */
    function renderTaskbarPreview() {
        const host = dlg && dlg.content.querySelector('.tbp-preview-taskbar');
        if (!host) return;
        const p = dlg.pending;
        const c = p.core;
        const sb = p.startButton;
        const isOrb = sb.style === 'orb';
        const startText = (typeof resolveStartMenuButtonDisplayText !== 'undefined') ? resolveStartMenuButtonDisplayText(sb.preset, sb.customText) : 'Start';
        const logoUrl = (typeof startMenuButtonLogoUrl !== 'undefined') ? startMenuButtonLogoUrl(sb.logo) : '';
        const cls = ['desktop-taskbar', 'tbp-preview-bar'];
        if (!c.locked) cls.push('taskbar-unlocked');
        if (!c.quickLaunch) cls.push('taskbar-no-quick-launch');
        const icon = (name, legacy) => p.useAppImageIcon || isOrb
            ? `<img class="icon-image" src="/static_images/app_icons/16/${name}.webp" alt="" width="16" height="16">`
            : `<i class="${legacy}"></i>`;
        const explorer = icon('vista-explorer', 'fas fa-folder-open');
        const notes = icon('vista-journal', 'fas fa-book');
        const item = (iconHtml, label, extra = '') => `
            <div class="taskbar-window-item${extra}"><div class="taskbar-window-item-content">${iconHtml}<span>${esc(label)}</span>${extra.includes('group') ? '<span class="taskbar-group-count">7</span>' : ''}</div></div>`;
        const buttons = c.group
            ? item(explorer, 'Cartograph', ' taskbar-window-group') + item(notes, 'Untitled - Notion')
            : item(explorer, 'Documents') + item(explorer, 'Pictures') + item(explorer, 'Music');
        // the real Quick Launch list (taskbarSettings.js quickLaunchItems)
        const ts = root.taskbarSettings;
        const ql = (ts ? c.quickLaunchItems || [] : [])
            .map((id) => ts.quickLaunchEntry(id))
            .filter(Boolean)
            .map((e) => `<span class="taskbar-quick-launch-btn">${e.fa ? `<i class="${esc(e.fa)}"></i>` : `<img src="${esc(e.icon)}" alt="" width="16" height="16">`}</span>`)
            .join('');
        const startCls = `taskbar-start-button${isOrb ? ' orb' : sb.style === 'luna' ? ' luna' : ''}`;
        // the bar at the height this style gives it, so its art is not stretched; bottom-aligned
        // in the 34 px strip, so the orb overhangs it as it does the screen's edge
        const barH = PREVIEW_BAR_HEIGHTS[sb.style] || PREVIEW_BAR_HEIGHTS.workspace;
        host.innerHTML = `
            <div class="${cls.join(' ')}" aria-hidden="true" style="--taskbar-height:${barH}px;height:${barH}px;top:${34 - barH}px">
                <div class="taskbar-start"><span class="${startCls}">
                    <span class="taskbar-start-button-orb-frame${isOrb ? '' : ' hidden'}"></span>
                    ${isOrb ? '' : `<img src="${esc(logoUrl)}" alt="" class="taskbar-start-button-logo${sb.logo === 'royal' ? ' is-royal' : sb.logo === 'vista' ? ' is-vista' : ''}">
                    <span class="taskbar-start-button-text">${esc(startText)}</span>`}
                </span></div>
                <div class="taskbar-quick-launch">${ql}</div>
                <div class="taskbar-windows">${buttons}</div>
            </div>`;
    }

    /** The notification area as the pending settings would draw it (Vista's bitmaps 190-221). */
    function renderTrayPreview() {
        const host = dlg && dlg.content.querySelector('.tbp-preview-tray');
        if (!host) return;
        const p = dlg.pending;
        const c = p.core;
        const live = doc.querySelector('.taskbar-tray-icons');
        const icons = [];
        let tucked = 0;
        const catalog = (typeof trayIconCatalog !== 'undefined') ? trayIconCatalog() : [];
        catalog.forEach((row) => {
            const el = doc.getElementById(row.id);
            if (!el || el.classList.contains('hidden')) return;
            const b = p.behaviors[row.id] || 'inactive';
            const hide = c.hideInactive && (b === 'hide' || (b === 'inactive' && el.classList.contains('tray-overflow')));
            if (hide) tucked++;
            else icons.push(el);
        });
        const sys = [];
        if (c.network) { const n = doc.getElementById('modemTrayIcon'); if (n && !n.classList.contains('hidden')) sys.push(n); }
        if (c.volume) { const v = doc.getElementById('volumeTrayIcon'); if (v && !v.classList.contains('hidden')) sys.push(v); }
        // Copies keep their ids: the Vista pictures (network, volume, the update shield ...) are
        // drawn by #id rules (vista-glass-controls.css). The dialog comes after the taskbar in
        // <body>, so a lookup by id still finds the real icon first.
        const copy = (el) => {
            const cl = el.cloneNode(true);
            cl.classList.remove('tray-overflow', 'tray-boot-in');
            cl.removeAttribute('title');
            return cl.outerHTML;
        };
        const time = callGlobal('taskbarClockText') || '';
        host.innerHTML = `
            <div class="desktop-taskbar tbp-preview-bar tbp-preview-traybar" aria-hidden="true">
                <div class="taskbar-tray">
                    <div class="taskbar-tray-icons">
                        ${c.hideInactive && tucked ? '<span class="tray-overflow-btn"></span>' : ''}
                        ${icons.map(copy).join('')}${sys.map(copy).join('')}
                    </div>
                    ${c.clock ? `<div class="taskbar-clock"><span class="taskbar-time">${esc(time)}</span></div>` : ''}
                </div>
            </div>`;
        if (!live) host.querySelector('.taskbar-tray-icons').textContent = '';
    }

    /** The live taskbar's text colours and size, for the previews (inside the light dialog they
     *  would take its near-black text). */
    function barLook() {
        const tb = doc.getElementById('desktopTaskbar');
        if (!tb) return '';
        const tbs = getComputedStyle(tb);
        const icon = tb.querySelector('.taskbar-tray-icon:not(.hidden)');
        const tray = icon ? getComputedStyle(icon).color : tbs.color;
        return `--tbp-bar-color:${tbs.color};--tbp-bar-font-size:${tbs.fontSize};--tbp-tray-color:${tray};`;
    }

    function renderPreviews() {
        renderTaskbarPreview();
        renderTrayPreview();
        const look = barLook();
        if (dlg && look) dlg.content.querySelectorAll('.tbp-preview-bar').forEach((bar) => { bar.style.cssText += look; });
    }

    // ---- sync controls <-> pending -------------------------------------------------------------

    function readKey(key) {
        const p = dlg.pending;
        if (key.startsWith('x:')) return p[key.slice(2)];
        if (key === 'power') return false;
        return p.core[key];
    }

    function writeKey(key, value) {
        const p = dlg.pending;
        if (key.startsWith('x:')) p[key.slice(2)] = value;
        else p.core[key] = value;
    }

    function syncControls() {
        const content = dlg.content;
        content.querySelectorAll('input[type="checkbox"][data-key]').forEach((el) => {
            el.checked = readKey(el.dataset.key) === true;
        });
        const vista = content.querySelector('#tbp-sm-vista');
        if (vista) vista.checked = true;
        const sel = content.querySelector('#tbp-mintime');
        if (sel) sel.value = String(dlg.pending.trayMinMs);
        const op = content.querySelector('#tbp-opacity');
        if (op) {
            op.value = String(dlg.pending.core.opacity || 100);
            content.querySelector('.tbp-opacity-value').textContent = `${op.value}%`;
        }
        const qlRestore = content.querySelector('[data-action="ql-restore"]');
        if (qlRestore && root.taskbarSettings) qlRestore.disabled = !root.taskbarSettings.missingQuickLaunchDefaults(dlg.pending.core.quickLaunchItems || []).length;
        syncStartButtonControls();
        renderPreviews();
    }

    function setDirty(on) {
        dlg.dirty = on;
        const apply = dlg.content.querySelector('[data-action="apply"]');
        if (apply) apply.disabled = !on;
    }

    // ---- apply ---------------------------------------------------------------------------------

    function same(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    /** The taskbarSettings fields that differ from when the dialog opened (or last applied). */
    function corePatch(pending, saved) {
        const patch = {};
        Object.keys(pending).forEach((k) => {
            if (k === 'places' || same(pending[k], saved[k])) return;
            patch[k] = pending[k];
        });
        const ids = new Set([...Object.keys(pending.places || {}), ...Object.keys(saved.places || {})]);
        const places = {};
        ids.forEach((id) => {
            const now = (pending.places || {})[id] === false;
            if (now !== ((saved.places || {})[id] === false)) places[id] = now ? false : true;
        });
        if (Object.keys(places).length) patch.places = places;
        return patch;
    }

    /** A change made elsewhere while the dialog is open (the taskbar menu's Lock the Taskbar, Quick
     *  Launch's Add / Delete) shows in it, unless the dialog has its own pending change there. */
    function onSettingsChange(ev) {
        if (!dlg || !ev || !ev.detail) return;
        const live = ev.detail;
        const p = dlg.pending.core;
        const s = dlg.saved.core;
        let changed = false;
        Object.keys(live).forEach((k) => {
            if (k === 'places' || !(k in s) || same(live[k], s[k]) || !same(p[k], s[k])) return;
            p[k] = clone(live[k]);
            s[k] = clone(live[k]);
            changed = true;
        });
        if (changed) syncControls();
    }

    async function applyPending() {
        const p = dlg.pending;
        const s = dlg.saved;
        // only what this dialog changed: Lock the Taskbar or a Quick Launch add / delete made
        // while it was open stays (the review's M13)
        if (root.taskbarSettings) {
            const patch = corePatch(p.core, s.core);
            if (Object.keys(patch).length) root.taskbarSettings.set(patch);
        }
        // notification area (trayRegistry.js)
        if ((typeof traySetIconBehaviors !== 'undefined')) traySetIconBehaviors(p.behaviors);
        if ((typeof traySetMinPopupMs !== 'undefined')) traySetMinPopupMs(p.trayMinMs);
        if ((typeof traySetPopupHidden !== 'undefined')) Object.keys(p.hiddenPopups).forEach((id) => traySetPopupHidden(id, p.hiddenPopups[id] === true));
        // the server-held ones, only when they changed
        const desktop = {};
        if (JSON.stringify(p.startButton) !== JSON.stringify(s.startButton)) desktop.startMenuButton = { ...p.startButton };
        if (p.useAppImageIcon !== s.useAppImageIcon) desktop.useApplicationImageIcon = p.useAppImageIcon;
        if (p.autoLaunch !== s.autoLaunch) desktop.autoLaunchWorkspace = p.autoLaunch;
        if (bridgeDetected() && (p.bridgeEnabled !== s.bridgeEnabled || p.bridgeBypass !== s.bridgeBypass)) {
            desktop.notificationBridgeEnabled = p.bridgeEnabled;
            desktop.bypassNotificationBridgeInDesktopMode = p.bridgeBypass;
        }
        dlg.saved = clone(p);
        setDirty(false);
        renderPreviews();
        if (!Object.keys(desktop).length) return;
        const gs = typeof desktopSettingsGlobalState !== 'undefined' ? desktopSettingsGlobalState : null;
        if (gs) {
            if (desktop.startMenuButton) {
                gs.startMenuButtonPreset = p.startButton.preset;
                gs.startMenuButtonCustomText = p.startButton.customText;
                gs.startMenuButtonStyle = p.startButton.style;
                gs.startMenuButtonLogo = p.startButton.logo;
            }
            if ('useApplicationImageIcon' in desktop) gs.useApplicationImageIcon = p.useAppImageIcon;
            if ('autoLaunchWorkspace' in desktop) gs.autoLaunchWorkspace = p.autoLaunch;
            if ('notificationBridgeEnabled' in desktop) {
                gs.notificationBridgeEnabled = p.bridgeEnabled;
                gs.bypassNotificationBridgeInDesktopMode = p.bridgeBypass;
            }
        }
        try {
            // persistUserGlobalSettingsPatch applies on this client first, then sends (modalUtils.js)
            if ((typeof persistUserGlobalSettingsPatch !== 'undefined')) await persistUserGlobalSettingsPatch({ desktop });
            // the old settings page compares against these
            if (desktop.startMenuButton && typeof desktopSettingsPersistedStartMenuButton !== 'undefined') {
                desktopSettingsPersistedStartMenuButton = { ...p.startButton };
            }
            if ('useApplicationImageIcon' in desktop && typeof desktopSettingsPersistedUseApplicationImageIcon !== 'undefined') {
                desktopSettingsPersistedUseApplicationImageIcon = p.useAppImageIcon;
            }
        } catch (err) {
            console.error('Taskbar and Start Menu Properties: saving to the server failed', err);
        }
    }

    // ---- the window ----------------------------------------------------------------------------

    function el(tag, className, textContent) {
        const n = doc.createElement(tag);
        if (className) n.className = className;
        if (textContent !== undefined) n.textContent = textContent;
        return n;
    }

    function captionButton(title) {
        const b = el('button', 'btn-danger close-btn btn-small');
        b.type = 'button';
        b.title = title;
        const i = el('i', 'fa-regular fa-xmark-large');
        i.setAttribute('aria-hidden', 'true');
        b.appendChild(i);
        return b;
    }

    /** A Vista dialog window (light client, 7.css controls) with only the close box. */
    function makeWindow(id, title, iconSrc, clientClass) {
        // an ordinary window, not always on top (Vista's property sheets stack with the rest);
        // a Customize dialog opens over its sheet, which stays inert until it closes
        const modal = el('div', `modal hidden tbp-window ${clientClass}-window`);
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
        // the sub-dialogs have no caption icon, as in Vista; their taskbar button still gets one
        if (!iconSrc) modal.dataset.captionIcon = 'none';
        if (iconSrc) {
            const img = el('img', 'icon-image');
            img.alt = '';
            img.src = iconSrc;
            main.appendChild(img);
        }
        main.appendChild(el('span', '', title));
        cap.appendChild(main);
        const controls = el('div', 'modal-window-controls');
        const close = captionButton('Close');
        controls.appendChild(close);
        const content = el('div', `modal-content win7 tbp-client ${clientClass}`);
        modal.append(cap, el('div', 'modal-focus-overlay'), controls, content);
        doc.body.appendChild(modal);
        return { modal, content, close };
    }

    function showWindow(modal, owner) {
        // a sheet without its own icon shows its owner's on the taskbar button (ensureModalApplicationIcon)
        if (owner && owner.id) modal.dataset.iconOwnerId = owner.id;
        callGlobal('openModal', modal);
        if (modal.classList.contains('hidden')) modal.classList.remove('hidden');
        // a window that has just opened is the foreground one, as in Vista (openModal can slot it
        // under a window that was on top); not always on top after that
        callGlobal('bringModalToFront', modal);
        // centred over the owner (or the screen), as Vista places a property sheet
        requestAnimationFrame(() => {
            const r = modal.getBoundingClientRect();
            let cx = root.innerWidth / 2;
            let cy = (root.innerHeight - 35) / 2;
            if (owner) {
                const o = owner.getBoundingClientRect();
                cx = o.left + o.width / 2;
                cy = o.top + o.height / 2;
            }
            const left = Math.max(0, Math.round(cx - r.width / 2));
            const top = Math.max(0, Math.round(cy - r.height / 2));
            if (typeof root.setModalOffsetsFromViewportTopLeft === 'function') root.setModalOffsetsFromViewportTopLeft(modal, left, top);
        });
    }

    /** Close a window the window manager's way: it fades out on top, and the next window is
     *  activated once it has gone. Resolves when it is out of the DOM. */
    function closeWindow(modal) {
        if (!modal) return Promise.resolve();
        let closing = Promise.resolve();
        try {
            if (typeof root.closeModal === 'function') closing = Promise.resolve(root.closeModal(modal));
        } catch (_) { /* window manager gone */ }
        const fallback = new Promise((resolve) => setTimeout(resolve, 600));
        return Promise.race([closing.catch(() => {}), fallback]).then(() => {
            if (modal.parentNode) modal.parentNode.removeChild(modal);
        });
    }

    function buildSheet() {
        const { modal, content, close } = makeWindow('taskbarPropertiesDialog', 'Taskbar and Start Menu Properties',
            '/static_images/app_icons/16/vista-taskbar.webp', 'tbp-sheet');
        content.innerHTML = `
            <div class="tbp-tabs" role="tablist">
                ${TABS.map((t) => `<button type="button" class="tbp-tab" role="tab" data-tab="${t.id}" aria-selected="false">${t.label}</button>`).join('')}
            </div>
            <div class="tbp-pane">
                <div class="tbp-page" data-page="taskbar" role="tabpanel"></div>
                <div class="tbp-page" data-page="startmenu" role="tabpanel"></div>
                <div class="tbp-page" data-page="notification" role="tabpanel"></div>
                <div class="tbp-page" data-page="toolbars" role="tabpanel"></div>
            </div>
            <div class="tbp-footer">
                <button type="button" class="tbp-button tbp-footer-button" data-action="ok" data-dialog-primary="1">OK</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="cancel">Cancel</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="apply" disabled>Apply</button>
            </div>`;
        close.addEventListener('click', () => cancel());
        content.addEventListener('click', onClick);
        content.addEventListener('change', onChange);
        content.addEventListener('input', onInput);
        modal.addEventListener('keydown', onKey);
        return { modal, content };
    }

    function fillPages() {
        const c = dlg.content;
        c.querySelector('[data-page="taskbar"]').innerHTML = pageTaskbar();
        c.querySelector('[data-page="startmenu"]').innerHTML = pageStartMenu();
        c.querySelector('[data-page="notification"]').innerHTML = pageNotification(dlg.pending);
        c.querySelector('[data-page="toolbars"]').innerHTML = pageToolbars();
    }

    function selectTab(tab) {
        if (!TABS.some((t) => t.id === tab)) tab = 'taskbar';
        dlg.tab = tab;
        dlg.content.querySelectorAll('.tbp-tab').forEach((b) => {
            const on = b.dataset.tab === tab;
            b.classList.toggle('is-selected', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            b.tabIndex = on ? 0 : -1;
        });
        dlg.content.querySelectorAll('.tbp-page').forEach((p) => { p.hidden = p.dataset.page !== tab; });
        dlg.modal.dataset.tab = tab;
        renderPreviews();
    }

    function onChange(ev) {
        const t = ev.target;
        if (t.matches('input[type="checkbox"][data-key]')) {
            writeKey(t.dataset.key, t.checked);
            // Show Quick Launch and the Toolbars tab's Quick Launch are one setting
            if (t.dataset.key === 'quickLaunch') {
                dlg.content.querySelectorAll('input[data-key="quickLaunch"]').forEach((o) => { o.checked = t.checked; });
            }
            setDirty(true);
            renderPreviews();
        } else if (t.id === 'tbp-mintime') {
            dlg.pending.trayMinMs = Number(t.value);
            setDirty(true);
        } else if (t.id === 'tbp-sb-style' || t.id === 'tbp-sb-logo' || t.id === 'tbp-sb-text') {
            const key = { 'tbp-sb-style': 'style', 'tbp-sb-logo': 'logo', 'tbp-sb-text': 'preset' }[t.id];
            dlg.pending.startButton = { ...dlg.pending.startButton, [key]: t.value };
            syncStartButtonControls();
            if (key === 'preset' && t.value === 'custom') dlg.content.querySelector('#tbp-sb-custom').focus();
            setDirty(true);
            renderPreviews();
        }
    }

    function onInput(ev) {
        if (ev.target.id === 'tbp-opacity') {
            // the taskbar follows the slider at once; Cancel puts the saved opacity back
            dlg.pending.core.opacity = Number(ev.target.value);
            dlg.content.querySelector('.tbp-opacity-value').textContent = `${ev.target.value}%`;
            if (root.taskbarSettings && root.taskbarSettings.previewOpacity) root.taskbarSettings.previewOpacity(dlg.pending.core.opacity);
            setDirty(true);
            return;
        }
        if (ev.target.id !== 'tbp-sb-custom') return;
        dlg.pending.startButton = { ...dlg.pending.startButton, customText: ev.target.value.slice(0, 24) };
        setDirty(true);
        renderPreviews();
    }

    function onClick(ev) {
        const tab = ev.target.closest('.tbp-tab');
        if (tab) {
            selectTab(tab.dataset.tab);
            return;
        }
        const b = ev.target.closest('[data-action]');
        if (!b || b.disabled) return;
        switch (b.dataset.action) {
            case 'ok': ok(); break;
            case 'cancel': cancel(); break;
            case 'apply': if (startButtonValid()) void applyPending(); break;
            case 'customize-start': openCustomizeStart(); break;
            case 'customize-icons': openCustomizeIcons(); break;
            case 'customize-popups': openCustomizePopups(); break;
            case 'ql-restore': restoreQuickLaunchPending(); break;
            case 'help-taskbar':
            case 'help-start':
                // Help and Support is the Grimoire (modalUtils.js start menu places)
                callGlobal('openGrimoireApplet');
                break;
            default: break;
        }
    }

    /** The Toolbars tab's Restore Quick Launch Items: the deleted defaults go back into the pending
     *  list (taskbarSettings.js mergeQuickLaunchDefaults), shown on, saved with Apply / OK. */
    function restoreQuickLaunchPending() {
        const ts = root.taskbarSettings;
        if (!ts) return;
        const c = dlg.pending.core;
        c.quickLaunchItems = ts.mergeQuickLaunchDefaults(c.quickLaunchItems || []);
        c.quickLaunch = true;
        setDirty(true);
        syncControls();
    }

    function onKey(ev) {
        if (dlg && dlg.sub) return;
        if (ev.key === 'Escape') {
            ev.preventDefault();
            cancel();
        } else if (ev.key === 'Enter' && !ev.target.matches('button, select, textarea')) {
            ev.preventDefault();
            ok();
        } else if (ev.ctrlKey && ev.key === 'Tab') {
            ev.preventDefault();
            ev.stopPropagation();
            const i = TABS.findIndex((t) => t.id === dlg.tab);
            selectTab(TABS[(i + (ev.shiftKey ? TABS.length - 1 : 1)) % TABS.length].id);
        }
    }

    /** Custom Text needs text, as the old settings page asked. */
    function startButtonValid() {
        const sb = dlg.pending.startButton;
        if (sb.style === 'orb' || sb.preset !== 'custom' || (sb.customText || '').trim()) return true;
        selectTab('taskbar');
        const custom = dlg.content.querySelector('#tbp-sb-custom');
        if (custom) custom.focus();
        return false;
    }

    async function ok() {
        if (!startButtonValid()) return;
        if (dlg.dirty) await applyPending();
        finish();
    }

    function cancel() {
        finish();
    }

    /** An unapplied opacity preview goes back to the saved opacity (Cancel, Close, or OK with nothing applied). */
    function revertOpacityPreview() {
        const ts = root.taskbarSettings;
        if (ts && ts.previewOpacity) ts.previewOpacity(ts.get().opacity);
    }

    function finish() {
        if (!dlg) return;
        if (dlg.sub) closeSub(false);
        revertOpacityPreview();
        const modal = dlg.modal;
        dlg = null;
        root.removeEventListener('taskbarsettingschange', onSettingsChange);
        closeWindow(modal);
    }

    function open(tab = 'taskbar') {
        if (!doc) return;
        if (dlg) {
            selectTab(tab);
            callGlobal('openModal', dlg.modal);
            return;
        }
        const saved = readState();
        const { modal, content } = buildSheet();
        dlg = { modal, content, saved, pending: clone(saved), tab, sub: null, dirty: false };
        root.addEventListener('taskbarsettingschange', onSettingsChange);
        fillPages();
        syncControls();
        selectTab(tab);
        showWindow(modal, null);
    }

    // ---- sub-dialogs (modal to the sheet) ------------------------------------------------------

    function openSub(id, title, cls, html, onOk) {
        if (!dlg || dlg.sub) return null;
        const { modal, content, close } = makeWindow(id, title, null, cls);
        content.innerHTML = html;
        dlg.modal.setAttribute('inert', '');
        dlg.sub = { modal, content, onOk };
        close.addEventListener('click', () => closeSub(false));
        modal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                closeSub(false);
            }
        });
        content.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-action]');
            if (!b || b.disabled) return;
            if (b.dataset.action === 'sub-ok') closeSub(true);
            else if (b.dataset.action === 'sub-cancel') closeSub(false);
        });
        showWindow(modal, dlg.modal);
        return dlg.sub;
    }

    function closeSub(accept) {
        if (!dlg || !dlg.sub) return;
        const sub = dlg.sub;
        if (accept && sub.onOk) {
            if (sub.onOk(sub.content) === false) return;
            setDirty(true);
            syncControls();
        }
        dlg.sub = null;
        const owner = dlg.modal;
        owner.removeAttribute('inert');
        // Vista: the dialog fades out over its owner, then the owner is the active window again.
        // Raising the owner at once put it over the closing dialog (Yukimi 2026-10-21).
        closeWindow(sub.modal).then(() => {
            if (owner.isConnected && !owner.classList.contains('hidden') && !owner.classList.contains('closing')) {
                callGlobal('bringModalToFront', owner);
            }
        });
    }

    function okCancel(okX, cancelX, y) {
        return `${button(okX, y, 50, 14, 'OK', 'sub-ok')}${button(cancelX, y, 50, 14, 'Cancel', 'sub-cancel')}`;
    }

    // Customize Notification Icons (dialog 7): Icon | Behavior, Current Items and Past Items
    function openCustomizeIcons() {
        const catalog = (typeof trayIconCatalog !== 'undefined') ? trayIconCatalog() : [];
        const behaviors = { ...dlg.pending.behaviors };
        const row = (r) => {
            const live = doc.getElementById(r.id);
            const glyph = live ? live.cloneNode(true) : null;
            if (glyph) {
                // ids kept: the tray's Vista pictures come from #id rules (see renderTrayPreview)
                glyph.className = `${glyph.className} tbp-list-glyph`.replace(/\b(hidden|tray-overflow|tray-boot-in)\b/g, '');
                glyph.removeAttribute('title');
            }
            const b = behaviors[r.id] || 'inactive';
            return `<div class="tbp-list-row" data-id="${esc(r.id)}" tabindex="-1">
                <span class="tbp-list-icon">${glyph ? glyph.outerHTML : ''}</span><span class="tbp-list-name">${esc(r.label)}</span>
                <span class="tbp-list-behavior"><span class="tbp-list-behavior-text">${esc(BEHAVIOR_LABELS[b])}</span>
                    <select class="tbp-list-select" aria-label="Behavior">${Object.keys(BEHAVIOR_LABELS).map((k) => `<option value="${k}"${k === b ? ' selected' : ''}>${BEHAVIOR_LABELS[k]}</option>`).join('')}</select></span>
            </div>`;
        };
        const current = catalog.filter((r) => { const e = doc.getElementById(r.id); return e && !e.classList.contains('hidden'); });
        const past = catalog.filter((r) => !current.includes(r));
        const html = `
            ${text(6, 6, 220, 10, 'Click an icon behavior to change it.')}
            <div class="tbp-ctl tbp-list" style="${dlu(6, 22, 220, 160)}" role="listbox">
                <div class="tbp-list-header"><span>Icon</span><span>Behavior</span></div>
                <div class="tbp-list-body">
                    ${current.length ? `<div class="tbp-list-group">Current Items</div>${current.map(row).join('')}` : ''}
                    ${past.length ? `<div class="tbp-list-group">Past Items</div>${past.map(row).join('')}` : ''}
                </div>
            </div>
            ${button(164, 192, 62, 14, '<u>D</u>efault Settings', 'icons-default')}
            ${okCancel(122, 176, 220)}`;
        const sub = openSub('taskbarPropertiesIcons', 'Customize Notification Icons', 'tbp-icons', html, (content) => {
            content.querySelectorAll('.tbp-list-row').forEach((r) => {
                dlg.pending.behaviors[r.dataset.id] = r.querySelector('.tbp-list-select').value;
            });
        });
        if (!sub) return;
        const setRow = (r, value) => {
            r.querySelector('.tbp-list-select').value = value;
            r.querySelector('.tbp-list-behavior-text').textContent = BEHAVIOR_LABELS[value];
        };
        sub.content.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-action="icons-default"]')) {
                sub.content.querySelectorAll('.tbp-list-row').forEach((r) => setRow(r, 'inactive'));
                return;
            }
            const r = ev.target.closest('.tbp-list-row');
            if (!r) return;
            sub.content.querySelectorAll('.tbp-list-row.is-selected').forEach((o) => { if (o !== r) o.classList.remove('is-selected', 'is-editing'); });
            r.classList.add('is-selected');
            // a click on the behavior opens its combo box, as Vista's list does
            if (ev.target.closest('.tbp-list-behavior')) r.classList.add('is-editing');
        });
        sub.content.addEventListener('change', (ev) => {
            const sel = ev.target.closest('.tbp-list-select');
            if (!sel) return;
            const r = sel.closest('.tbp-list-row');
            setRow(r, sel.value);
            r.classList.remove('is-editing');
        });
    }

    // Customize Notifications (ours, in dialog 7's layout): which notifications to hide, and the bridge
    function openCustomizePopups() {
        const popups = (typeof trayPopupCatalog !== 'undefined') ? trayPopupCatalog() : [];
        const hidden = { ...dlg.pending.hiddenPopups };
        const bridge = bridgeDetected();
        const row = (r) => {
            const b = hidden[r.id] ? 'hide' : 'show';
            return `<div class="tbp-list-row" data-id="${esc(r.id)}" tabindex="-1">
                <span class="tbp-list-name is-wide">${esc(r.label)}</span>
                <span class="tbp-list-behavior"><span class="tbp-list-behavior-text">${b === 'hide' ? 'Hide' : 'Show'}</span>
                    <select class="tbp-list-select" aria-label="Behavior"><option value="show"${b === 'show' ? ' selected' : ''}>Show</option><option value="hide"${b === 'hide' ? ' selected' : ''}>Hide</option></select></span>
            </div>`;
        };
        const html = `
            ${text(6, 6, 220, 10, 'Click a notification behavior to change it.')}
            <div class="tbp-ctl tbp-list" style="${dlu(6, 22, 220, bridge ? 130 : 160)}" role="listbox">
                <div class="tbp-list-header"><span>Notification</span><span>Behavior</span></div>
                <div class="tbp-list-body">${popups.map(row).join('')}</div>
            </div>
            ${bridge ? `
                ${check('bridge-on', 6, 158, 220, 'Send notifications to the Android <u>N</u>otification Bridge', 'x:bridgeEnabled')}
                ${check('bridge-bypass', 6, 172, 220, 'On the desktop, show them here <u>i</u>nstead', 'x:bridgeBypass')}` : ''}
            ${button(164, 192, 62, 14, '<u>D</u>efault Settings', 'popups-default')}
            ${okCancel(122, 176, 220)}`;
        const sub = openSub('taskbarPropertiesPopups', 'Customize Notifications', 'tbp-icons', html, (content) => {
            content.querySelectorAll('.tbp-list-row').forEach((r) => {
                dlg.pending.hiddenPopups[r.dataset.id] = r.querySelector('.tbp-list-select').value === 'hide';
            });
            const on = content.querySelector('#tbp-bridge-on');
            const by = content.querySelector('#tbp-bridge-bypass');
            if (on) dlg.pending.bridgeEnabled = on.checked;
            if (by) dlg.pending.bridgeBypass = by.checked;
        });
        if (!sub) return;
        const on = sub.content.querySelector('#tbp-bridge-on');
        const by = sub.content.querySelector('#tbp-bridge-bypass');
        if (on) on.checked = dlg.pending.bridgeEnabled;
        if (by) by.checked = dlg.pending.bridgeBypass;
        const setRow = (r, value) => {
            r.querySelector('.tbp-list-select').value = value;
            r.querySelector('.tbp-list-behavior-text').textContent = value === 'hide' ? 'Hide' : 'Show';
        };
        sub.content.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-action="popups-default"]')) {
                sub.content.querySelectorAll('.tbp-list-row').forEach((r) => setRow(r, 'show'));
                return;
            }
            const r = ev.target.closest('.tbp-list-row');
            if (!r) return;
            sub.content.querySelectorAll('.tbp-list-row.is-selected').forEach((o) => { if (o !== r) o.classList.remove('is-selected', 'is-editing'); });
            r.classList.add('is-selected');
            if (ev.target.closest('.tbp-list-behavior')) r.classList.add('is-editing');
        });
        sub.content.addEventListener('change', (ev) => {
            const sel = ev.target.closest('.tbp-list-select');
            if (!sel) return;
            const r = sel.closest('.tbp-list-row');
            setRow(r, sel.value);
            r.classList.remove('is-editing');
        });
    }

    // Customize Start Menu (dialog 1036): a settings tree, Start menu size, and (in place of
    // "Show on Start menu") the Start button's text
    function openCustomizeStart() {
        const p = dlg.pending;
        const places = (typeof getStartMenuPlacesAll === 'function' ? getStartMenuPlacesAll() : [])
            .filter((pl) => !pl.separator && pl.id !== 'user' && pl.id !== 'recent');
        let n = 0;
        const radioRow = (name, value, label, on) => {
            const id = `tbp-cs-${++n}`;
            return `<div class="tbp-tree-row is-child"><input type="radio" id="${id}" name="tbp-cs-${name}" value="${esc(value)}"${on ? ' checked' : ''}><label for="${id}">${esc(label)}</label></div>`;
        };
        const checkRow = (cls, value, label, on) => {
            const id = `tbp-cs-${++n}`;
            return `<div class="tbp-tree-row"><input type="checkbox" id="${id}" class="${cls}" value="${esc(value)}"${on ? ' checked' : ''}><label for="${id}">${esc(label)}</label></div>`;
        };
        const node = (label, children) => `<div class="tbp-tree-node"><div class="tbp-tree-row is-node">${esc(label)}</div>${children}</div>`;
        const shownPlaces = places.map((pl) => node(pl.text,
            radioRow(`place-${pl.id}`, 'link', 'Display as a link', p.core.places[pl.id] !== false)
            + radioRow(`place-${pl.id}`, 'none', "Don't display this item", p.core.places[pl.id] === false))).join('');
        // the sizes first: they are what people look for (Yukimi 2026-10-21)
        const tree = node('Start menu icon size',
            radioRow('startsize', 'small', 'Small icons', p.core.startIconSize === 'small')
            + radioRow('startsize', 'medium', 'Medium icons', p.core.startIconSize === 'medium')
            + radioRow('startsize', 'large', 'Large icons', p.core.startIconSize === 'large'))
            + node('All Programs icon size',
                radioRow('progsize', 'small', 'Small icons', p.core.programsIconSize === 'small')
                + radioRow('progsize', 'medium', 'Medium icons', p.core.programsIconSize === 'medium')
                + radioRow('progsize', 'large', 'Large icons', p.core.programsIconSize === 'large'))
            + shownPlaces
            + checkRow('tbp-cs-autolaunch', '1', 'Open the workspace at startup', p.autoLaunch);
        const choice = (options, value) => options.map(([v, label]) => `<option value="${v}"${v === value ? ' selected' : ''}>${label}</option>`).join('');
        const html = `
            ${text(7, 7, 238, 16, 'You can customize how links, icons, and menus look and behave on the Start menu.')}
            <div class="tbp-ctl tbp-tree" style="${dlu(7, 26, 238, 124)}" role="tree">${tree}</div>
            ${group(7, 153, 238, 26, 'Start menu size')}
            ${text(14, 165, 132, 8, '<u>N</u>umber of recent programs to display:')}
            <span class="tbp-ctl tbp-spinedit" style="${dlu(153, 163)}">
                <input type="text" class="tbp-edit tbp-cs-count" inputmode="numeric" maxlength="2" value="${p.core.recentProgramCount}" aria-label="Number of recent programs to display">
                <span class="tbp-spin tbp-spin-up" data-action="cs-up" aria-hidden="true"></span>
                <span class="tbp-spin tbp-spin-down" data-action="cs-down" aria-hidden="true"></span>
            </span>
            ${button(7, 183, 80, 14, 'Use <u>D</u>efault Settings', 'cs-default')}
            ${group(7, 199, 238, 56, 'Power buttons')}
            ${text(14, 213, 82, 10, '<u>P</u>ower button:')}
            <select class="tbp-ctl tbp-select tbp-cs-power" style="${dlu(98, 211, 140, 12)}" aria-label="Power button">${choice([['shutdown', 'Shut down'], ['restart', 'Restart'], ['logoff', 'Log off']], p.core.powerButton)}</select>
            ${text(14, 230, 82, 10, '<u>L</u>ock button:')}
            <select class="tbp-ctl tbp-select tbp-cs-lock" style="${dlu(98, 228, 140, 12)}" aria-label="Lock button">${choice([['lock', 'Lock'], ['logoff', 'Log off']], p.core.lockButton)}</select>
            ${okCancel(131, 195, 257)}`;
        const sub = openSub('taskbarPropertiesStart', 'Customize Start Menu', 'tbp-start', html, (content) => {
            const val = (name) => {
                const r = content.querySelector(`input[name="tbp-cs-${name}"]:checked`);
                return r ? r.value : null;
            };
            places.forEach((pl) => {
                p.core.places[pl.id] = val(`place-${pl.id}`) === 'none' ? false : true;
            });
            const cnt = Number(content.querySelector('.tbp-cs-count').value);
            if (Number.isFinite(cnt)) p.core.recentProgramCount = Math.max(0, Math.min(30, Math.round(cnt)));
            const auto = content.querySelector('.tbp-cs-autolaunch');
            if (auto) p.autoLaunch = auto.checked;
            p.core.startIconSize = val('startsize') || p.core.startIconSize;
            p.core.programsIconSize = val('progsize') || p.core.programsIconSize;
            p.core.powerButton = content.querySelector('.tbp-cs-power').value;
            p.core.lockButton = content.querySelector('.tbp-cs-lock').value;
            return true;
        });
        if (!sub) return;
        const c = sub.content;
        const count = c.querySelector('.tbp-cs-count');
        const step = (d) => {
            const v = Number(count.value) || 0;
            count.value = String(Math.max(0, Math.min(30, v + d)));
        };
        // the spin repeats while held, as Vista's up-down control does
        let repeat = 0;
        const stopRepeat = () => {
            clearTimeout(repeat);
            clearInterval(repeat);
            repeat = 0;
        };
        c.querySelectorAll('.tbp-spin').forEach((spin) => {
            spin.addEventListener('pointerdown', (ev) => {
                if (ev.button !== 0) return;
                ev.preventDefault();
                const d = spin.dataset.action === 'cs-up' ? 1 : -1;
                step(d);
                stopRepeat();
                repeat = setTimeout(() => { repeat = setInterval(() => step(d), 60); }, 400);
            });
            spin.addEventListener('pointerup', stopRepeat);
            spin.addEventListener('pointerleave', stopRepeat);
        });
        count.addEventListener('input', () => {
            const digits = count.value.replace(/\D+/g, '').slice(0, 2);
            if (digits !== count.value) count.value = digits;
        });
        count.addEventListener('keydown', (ev) => {
            if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
                ev.preventDefault();
                step(ev.key === 'ArrowUp' ? 1 : -1);
            }
        });
        c.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-action]');
            if (!b) return;
            if (b.dataset.action === 'cs-default') {
                count.value = String(root.taskbarSettings ? root.taskbarSettings.DEFAULTS.recentProgramCount : 8);
                c.querySelectorAll('input[type="radio"][value="link"]').forEach((r) => { r.checked = true; });
                // Vista's defaults for the rest of the tree
                const d = root.taskbarSettings ? root.taskbarSettings.DEFAULTS : {};
                const pick = (name, value) => { const r = c.querySelector(`input[name="tbp-cs-${name}"][value="${value}"]`); if (r) r.checked = true; };
                pick('startsize', d.startIconSize || 'large');
                pick('progsize', d.programsIconSize || 'small');
                c.querySelector('.tbp-cs-power').value = d.powerButton || 'shutdown';
                c.querySelector('.tbp-cs-lock').value = d.lockButton || 'lock';

            }
        });
    }

    root.taskbarProperties = {
        open,
        close: () => finish(),
        isOpen: () => !!dlg,
        _test: {
            dlu,
            readState,
            state: () => dlg,
            select: (tab) => dlg && selectTab(tab),
            apply: () => dlg && applyPending(),
            corePatch,
            revertOpacityPreview
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
