/*
 * Removable media on DreamOS (#910; Yukimi, Nov 19 2026: Safely Remove Hardware in the tray for removable media):
 * the CaféReady host mounts USB sticks, disks and the SD card (cafeready drives.rs, window.DreamOSDrives from the
 * kiosk's shell bridge). Without that bridge (a browser, the Android app) this file does nothing.
 *
 *   Safely Remove Hardware   the notification-area icon (hotplug.dll icon 0), shown only while a removable device is
 *                            in. Tooltip "Safely Remove Hardware" (stobject.dll 211). A click (either button) lists
 *                            each device as Vista's menu does: "Safely remove USB Mass Storage Device - Drive(E:)"
 *                            (stobject 216 + 219, "- Drives(E:, F:)" 220 for several volumes). Ejected: the balloon
 *                            "Safe To Remove Hardware" / "The 'USB Mass Storage Device' device can now be safely
 *                            removed from the computer." (hotplug.dll 2261 / 2260); in use: "Problem Ejecting <device>"
 *                            (hotplug 2254) with Vista's in-use words, and the programs that hold it.
 *   AutoPlay                 a removable disk put in while the desktop runs: Control Panel > AutoPlay's choice for its
 *                            content (Pictures, Video files, Audio files, Mixed content; cplPages2.js), and for "Ask me
 *                            every time" (the default) Vista's AutoPlay window: "<label> (E:)", the content's options
 *                            ("View pictures using Lumen" ...), General options "Open folder to view files using
 *                            Melaton Explorer" (shell32 17410/17411), "Always do this for <type>" and the link to
 *                            AutoPlay's defaults. Disks that were in before the page started never trigger it.
 *
 * Nothing polls: the host pushes 'dreamosdrives' when a drive comes, goes or changes.
 *   window.hostDrivesShell = { eject(id) -> Promise<bool>, autoplay(id), state() }
 */
(function (root) {
    'use strict';
    const doc = root.document;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const ICON_ID = 'safelyRemoveTrayIcon';
    const POPUP_ID = 'safely-remove';
    const ART = '/static_images/vista-explorer';
    const AUTOPLAY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Explorer\\AutoplayHandlers\\UserChosenExecuteHandlers';
    const D = () => root.DreamOSDrives || null;
    const iconEl = () => (doc ? doc.getElementById(ICON_ID) : null);
    const started = Date.now();

    let state = { present: false, drives: [], devices: [] };
    let known = null;         // drive ids seen (null until the first state: those never AutoPlay)
    let menuConfig = null;
    let holding = false;      // the icon stays while its "Safe To Remove Hardware" balloon shows (Vista), then goes

    function esc(text) {
        return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function devices() { return Array.isArray(state.devices) ? state.devices : []; }
    function driveOf(id) { return (state.drives || []).find((d) => d.id === id) || null; }

    /** stobject.dll 216 + 219 / 220: "Safely remove USB Mass Storage Device - Drive(E:)" */
    function deviceLabel(dev) {
        const letters = (dev.letters || []).map((l) => `${l}:`);
        return `Safely remove ${dev.name}${letters.length > 1 ? ` - Drives(${letters.join(', ')})` : letters.length ? ` - Drive(${letters[0]})` : ''}`;
    }

    function paint() {
        const icon = iconEl();
        if (!icon) return;
        const show = devices().length > 0 || holding;
        if (icon.classList.contains('hidden') === show) icon.classList.toggle('hidden', !show);
    }

    function menuSections() {
        const list = devices();
        // Vista writes the whole line ("Safely remove USB Mass Storage Device - Drive(E:)"): the menu may be wider
        return [{ type: 'list', className: 'safely-remove-menu', items: list.length ? list.map((d) => ({ text: deviceLabel(d), action: `sr:${d.id}` })) : [{ text: '(Empty)', action: 'none', disabled: true }] }];
    }

    function onAction(action) {
        if (!String(action).startsWith('sr:')) return;
        const dev = devices().find((d) => d.id === action.slice(3));
        const first = dev && (state.drives || []).find((d) => d.deviceId === dev.id);
        if (first) void eject(first.id);
    }

    function balloon(type, title, text, onHide) {
        const icon = iconEl();
        const pm = root.PopoverManager;
        if (!icon || !pm || typeof pm.showPopover !== 'function') return;
        pm.showPopover(icon, type, esc(title), esc(text), false, 10000,
            '<img src="/static_images/vista-icons/safely-remove-tray-32.png" alt="" width="32" height="32">', null,
            { popupId: POPUP_ID, position: 'top', arrowPosition: 'bottom-right', onClick: null, onHide });
    }

    /** Vista's Safely Remove for the device a drive is on. Resolves true when it can be taken out. */
    async function eject(id) {
        const d = D();
        const drive = driveOf(id);
        if (!d || !drive) return false;
        const r = await d.eject(id);
        const name = (r && r.device) || drive.device || 'USB Mass Storage Device';
        if (r && r.ok) {
            // hotplug.dll 2261 / 2260, on the icon, which stays until the balloon closes
            holding = true;
            paint();
            balloon('info', 'Safe To Remove Hardware', `The '${name}' device can now be safely removed from the computer.`, () => { holding = false; paint(); });
            return true;
        }
        const programs = r && Array.isArray(r.programs) && r.programs.length ? `\n\nPrograms using the device: ${r.programs.join(', ')}` : '';
        const text = r && r.code === 'in_use'
            ? `This device is currently in use. Close any programs or windows that might be using the device, and then try again.${programs}`
            : `Windows can't stop your '${name}' device. ${(r && r.error) || ''}`;
        if (typeof root.showConfirmationDialog === 'function') {
            await root.showConfirmationDialog(`<p>${esc(text).replace(/\n/g, '<br>')}</p>`, [{ text: 'OK', value: true, className: 'btn-primary' }], null, { title: `Problem Ejecting ${name}`, icon: 'fas fa-triangle-exclamation' });
        }
        return false;
    }

    function wire() {
        const icon = iconEl();
        if (!icon || icon.dataset.srWired === '1') return;
        icon.dataset.srWired = '1';
        icon.tabIndex = 0;
        const cm = root.contextMenu;
        if (!cm) return;
        // Vista opens the device list on a left click and on a right click
        menuConfig = { sections: menuSections(), onAction, beforeShow: () => { menuConfig.sections = menuSections(); } };
        if (typeof cm.attachToElement === 'function') cm.attachToElement(icon, menuConfig);
        if (typeof cm.attachClickMenuToElement === 'function') {
            const clickConfig = { sections: menuSections(), onAction };
            cm.attachClickMenuToElement(icon, clickConfig);
            icon.addEventListener('pointerdown', () => { clickConfig.sections = menuSections(); }, { signal: appScopeSignal });
            icon.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                clickConfig.sections = menuSections();
                const r = icon.getBoundingClientRect();
                if (typeof cm.showClickMenu === 'function') cm.showClickMenu({ clientX: r.left, clientY: r.top }, icon, false);
            }, { signal: appScopeSignal });
        }
    }

    // ---- AutoPlay -------------------------------------------------------------------------------------------------

    const IMG = /\.(jpe?g|png|gif|bmp|webp|heic|avif|tiff?)$/i;
    const VID = /\.(mp4|m4v|mov|avi|wmv|mkv|webm|mpe?g|3gp)$/i;
    const AUD = /\.(mp3|wma|wav|m4a|aac|flac|ogg|opus)$/i;

    /** Vista's content type: what the disk's top folder and DCIM hold. */
    async function contentOf(id) {
        const d = D();
        const names = [];
        const read = async (path) => {
            const r = await d.list(id, path);
            if (!r || !Array.isArray(r.entries)) return [];
            r.entries.filter((e) => !e.hidden && !e.dir).forEach((e) => names.push(e.name));
            return r.entries.filter((e) => e.dir && !e.hidden);
        };
        const top = await read('/');
        const dcim = top.find((e) => e.name.toUpperCase() === 'DCIM');
        if (dcim) for (const sub of (await read(dcim.path)).slice(0, 8)) await read(sub.path);
        const files = names.filter((n) => !/^(autorun\.inf|desktop\.ini|thumbs\.db)$/i.test(n));
        const pics = files.filter((n) => IMG.test(n));
        const vids = files.filter((n) => VID.test(n));
        const auds = files.filter((n) => AUD.test(n));
        if (files.length && pics.length === files.length) return { type: 'Pictures', what: 'pictures', first: dcim ? null : pics[0] };
        if (files.length && vids.length === files.length) return { type: 'Video', what: 'video files' };
        if (files.length && auds.length === files.length) return { type: 'Audio', what: 'audio files' };
        if (files.length && pics.length + vids.length === files.length) return { type: 'Pictures', what: 'pictures' };
        return { type: 'MixedContent', what: 'mixed content' };
    }

    function regGet(name, fallback) {
        const r = root.melatonRegistry;
        try { return r && typeof r.get === 'function' ? r.get(AUTOPLAY, name, fallback) : fallback; } catch (_) { return fallback; }
    }

    async function openFolder(drive, path) {
        const navPath = `drive://${encodeURIComponent(drive.id)}${path && path !== '/' ? path : ''}`;
        // featureLoader.js openExplorerApplet: loads Explorer (and explorerHostDrive.js) first
        if (typeof root.openExplorerApplet === 'function') await root.openExplorerApplet(navPath);
    }

    async function viewPictures(drive) {
        const d = D();
        // the first picture in the disk's top folder or its DCIM folders, in Lumen with its folder for Previous / Next
        const find = async (path, depth) => {
            const r = await d.list(drive.id, path);
            const entries = (r && r.entries) || [];
            const pic = entries.find((e) => !e.dir && IMG.test(e.name));
            if (pic) return { dir: path, entries };
            if (depth > 1) return null;
            for (const e of entries.filter((x) => x.dir && !x.hidden && (depth === 0 ? x.name.toUpperCase() === 'DCIM' : true)).slice(0, 8)) {
                const f = await find(e.path, depth + 1);
                if (f) return f;
            }
            return null;
        };
        const hit = await find('/', 0);
        if (!hit || typeof root.openImageInViewer !== 'function') { await openFolder(drive, '/'); return; }
        const rows = [];
        hit.entries.filter((e) => !e.dir && IMG.test(e.name)).forEach((e) => rows.push({ url: d.fileUrl(drive.id, e.path), base: `${drive.name} (${drive.letter}:)${e.path}`, title: e.name, siblings: rows }));
        root.openImageInViewer(rows[0].url, rows[0].base, rows[0]);
    }

    async function playMedia(drive, re) {
        const d = D();
        const r = await d.list(drive.id, '/');
        const f = ((r && r.entries) || []).find((e) => !e.dir && re.test(e.name));
        if (!f) { await openFolder(drive, '/'); return; }
        if (root.featureLoader) await root.featureLoader.loadFeature('media_player');
        if (typeof root.openDesktopMediaPlayerUrl === 'function') root.openDesktopMediaPlayerUrl(d.fileUrl(drive.id, f.path), f.name);
    }

    async function run(choice, drive) {
        if (/^Open folder/.test(choice)) return openFolder(drive, '/');
        if (/^View pictures/.test(choice)) return viewPictures(drive);
        if (/^Play video/.test(choice)) return playMedia(drive, VID);
        if (/^Play audio/.test(choice)) return playMedia(drive, AUD);
        if (/^Import pictures/.test(choice)) return openFolder(drive, '/');
        return null;
    }

    const OPTIONS = {
        Pictures: { head: 'Pictures options', rows: [['View pictures', 'using Lumen', '/static_images/app_icons/vista-photo-viewer.png']] },
        Video: { head: 'Video files options', rows: [['Play video', 'using Melaton Media Player', '/static_images/app_icons/media-player-live.png']] },
        Audio: { head: 'Audio files options', rows: [['Play audio files', 'using Melaton Media Player', '/static_images/app_icons/media-player-live.png']] },
        MixedContent: null
    };

    async function autoplay(id) {
        const d = D();
        const drive = driveOf(id);
        if (!d || !drive || typeof root.showConfirmationDialog !== 'function') return;
        if (regGet('Enabled', true) === false) return;
        const content = await contentOf(id).catch(() => ({ type: 'MixedContent', what: 'mixed content' }));
        const chosen = regGet(content.type, 'Ask me every time');
        if (chosen === 'Take no action') return;
        if (chosen && chosen !== 'Ask me every time') { await run(chosen, drive); return; }
        const opts = OPTIONS[content.type];
        const row = (title, sub, icon) => `<button type="button" class="autoplay-option" data-ap-choice="${esc(`${title} ${sub}`)}"><img src="${esc(icon)}" alt="" width="32" height="32"><span><span class="autoplay-option-title">${esc(title)}</span><span class="autoplay-option-sub">${esc(sub)}</span></span></button>`;
        const group = (head, rows) => `<div class="autoplay-group"><div class="autoplay-group-head">${esc(head)}</div>${rows.map((r) => row(...r)).join('')}</div>`;
        const html = `<div class="autoplay">
            <div class="autoplay-head"><img src="${ART}/drive-removable-48.png" alt="" width="48" height="48"><span>${esc(`${drive.name} (${drive.letter}:)`)}</span></div>
            <label class="autoplay-always"><input type="checkbox" class="autoplay-always-box"> Always do this for ${esc(content.what)}:</label>
            <div class="autoplay-options">
                ${opts ? group(opts.head, opts.rows) : ''}
                ${group('General options', [['Open folder to view files', 'using Melaton Explorer', '/static_images/app_icons/vista-explorer.png']])}
            </div>
            <a href="#" class="autoplay-defaults">Set AutoPlay defaults in Control Panel</a>
        </div>`;
        let picked = null;
        const choice = await root.showConfirmationDialog(html, [{ text: 'Close', value: null }], null, {
            title: 'AutoPlay',
            width: 364,
            showCloseButton: true,
            resolveValue: (v, dlg) => (picked ? { choice: picked, always: !!(dlg.querySelector('.autoplay-always-box') || {}).checked } : null),
            onDialogReady: (signal) => {
                const box = doc.querySelector('#confirmationDialog .autoplay');
                if (!box) return;
                const close = () => { const b = doc.querySelector('#confirmationControls button'); if (b) b.click(); };
                box.addEventListener('click', (e) => {
                    const opt = e.target.closest('[data-ap-choice]');
                    if (opt) { picked = opt.dataset.apChoice; close(); return; }
                    if (e.target.closest('.autoplay-defaults')) {
                        e.preventDefault();
                        close();
                        const cp = root.melatonControlPanel;
                        if (cp && typeof cp.openItem === 'function') cp.openItem('autoplay');
                    }
                }, { signal });
            }
        });
        if (!choice || !choice.choice) return;
        if (choice.always && root.melatonRegistry && typeof root.melatonRegistry.set === 'function') {
            try { await root.melatonRegistry.set(AUTOPLAY, { [content.type]: choice.choice }); } catch (_) { /* kept for this time only */ }
        }
        await run(choice.choice, drive);
    }

    // ---- state ----------------------------------------------------------------------------------------------------

    function onState(st) {
        state = st && Array.isArray(st.drives) ? st : { present: false, drives: [], devices: [] };
        paint();
        const ids = new Set(state.drives.map((d) => d.id));
        if (known) {
            // a removable disk that came while the desktop runs (one per device: its first volume)
            const fresh = state.drives.filter((d) => d.removable && !known.has(d.id) && (Number(d.insertedAt) || 0) >= started - 2000);
            const seenDevices = new Set();
            fresh.forEach((d) => {
                if (seenDevices.has(d.deviceId)) return;
                seenDevices.add(d.deviceId);
                if (doc && doc.body && doc.body.classList.contains('desktop-mode')) void autoplay(d.id);
            });
        }
        known = ids;
    }

    function start() {
        if (!D() || root.uiShell === 'mobile' || !iconEl()) return;
        wire();
        onState(D().get());
        root.addEventListener('dreamosdrives', (e) => onState(e.detail), { signal: appScopeSignal });
        // the Open dialog reads a drive's files through their own URL (fileOpenPicker.js), Explorer loaded or not
        if (root.fileOpenPicker && typeof root.fileOpenPicker.registerSource === 'function' ) {
            root.fileOpenPicker.registerSource((item) => (item && item.targetKind === 'host-entry' && item.host && !item.host.dir
                ? { url: D().fileUrl(item.host.drive, item.host.path), name: item.name, type: item.mimeType || '' } : null));
        }
    }

    root.hostDrivesShell = { eject, autoplay, state: () => state };
    if (!doc) return;
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true, signal: appScopeSignal });
    else start();
})(typeof window !== 'undefined' ? window : globalThis);
