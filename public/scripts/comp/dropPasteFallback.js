/**
 * Files from the computer dropped on Dreamscape, and image data pasted into it, where no window
 * takes them (Yozora #676). Listens on window in the bubble phase, so every existing drop zone
 * and paste handler (Explorer's grid and folders, Studio, Paint, Media Player, the prompt boxes)
 * runs first; it acts only when none of them called preventDefault.
 *
 *   an Explorer window                    upload into the folder it shows (Explorer's own upload,
 *                                         vfsImportRouter.js, under the progress dialog)
 *   a desktop icon of a folder            upload into that folder (Computer, the user's folder,
 *                                         Pictures ... : system-folder icons with a path)
 *   the Director window                   attach to the message being written
 *   anywhere else                         ask: Attach to Director Message, Import (the Import
 *                                         wizard), Save to Folder (the Save As dialog), Cancel
 *
 * A paste goes to the active Explorer window or the Director the same way, else asks. A paste in a
 * text box with only text on the clipboard stays the box's; a rich text box keeps its own image
 * paste. A drag that started inside the page (a gallery image, an Explorer item) is not a drop
 * from the computer and is left alone.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;

    // what the Import wizard reads: pictures (references, blueprints) and vibe files
    const IMPORT_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|json|naiv4vibe|naiv4vibebundle)$/i;

    let internalDrag = false;
    let highlighted = null;
    let asking = false;

    function explorer() {
        /* global explorerApplet */
        return typeof explorerApplet !== 'undefined' && explorerApplet ? explorerApplet : null;
    }

    function explorerOpen() {
        const app = explorer();
        const m = app && app.modal;
        return m && !m.classList.contains('hidden') && !m.classList.contains('minimised') ? app : null;
    }

    /** The desktop (or the non-desktop app) is up: not the logon screen, boot or the lock. */
    function ready() {
        // getClientDesktopState: public/scripts/comp/agentClientBridge.js (logon, booting, locked, desktop, ready)
        const state = typeof getClientDesktopState === 'function' ? getClientDesktopState() : 'ready';
        return state === 'desktop' || state === 'ready';
    }

    function textField(el) {
        return !!(el && el.matches && el.matches('input, textarea'));
    }

    function readOnly() {
        try { return localStorage.getItem('userType') === 'readonly'; } catch (_) { return false; }
    }

    /** A folder files from the computer may go into: Explorer's rule, without the Desktop folder (shortcuts only). */
    function uploadablePath(app, path) {
        if (!app || !path || typeof app.canUploadToPath !== 'function' || !app.canUploadToPath(path)) return false;
        /* global vfsImportRouter */
        return vfsImportRouter._parsePath(path).systemFolder !== 'Desktop';
    }

    /** The Explorer window under the target, when the folder it shows takes files. */
    function explorerTarget(target) {
        const app = explorerOpen();
        if (!app || !target || !app.modal.contains(target)) return null;
        return uploadablePath(app, app.currentPath) ? app : null;
    }

    /** A desktop icon of a folder with a path (system-folder shortcuts) under the target. */
    function desktopFolderTarget(target) {
        const el = target && target.closest ? target.closest('.desktop-shortcut[data-shortcut-id]') : null;
        /* global desktopShortcuts */
        if (!el || typeof desktopShortcuts === 'undefined' || !desktopShortcuts) return null;
        const shortcut = (desktopShortcuts.shortcuts || []).find((s) => s.id === el.dataset.shortcutId);
        const path = shortcut && shortcut.type === 'system-folder' && shortcut.data && shortcut.data.navPath;
        if (!path) return null;
        // Explorer's script decides what takes files; until it is loaded a folder path is a target
        const app = explorer();
        if (app && !uploadablePath(app, path)) return null;
        return { el, path };
    }

    function directorTarget(target) {
        return !!(target && target.closest && target.closest('#directorWindow, #directorContainer'));
    }

    function setHighlight(el) {
        if (highlighted === el) return;
        if (highlighted) highlighted.classList.remove('folder-drop-target');
        highlighted = el;
        if (el) el.classList.add('folder-drop-target');
    }

    function hasFiles(dt) {
        return !!(dt && dt.types && Array.from(dt.types).includes('Files'));
    }

    /** The dropped files, without folders (a folder from the computer cannot be read as one file). */
    function droppedFiles(dt) {
        const files = Array.from((dt && dt.files) || []);
        const items = Array.from((dt && dt.items) || []).filter((i) => i.kind === 'file');
        if (items.length === files.length) {
            return files.filter((f, i) => {
                const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
                return !(entry && entry.isDirectory);
            });
        }
        return files;
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    /** A clipboard image has no name of its own ("image.png"): give it the time it was pasted. */
    function namePasted(file, index) {
        if (file.name && !/^image\.\w+$/i.test(file.name)) return file;
        const d = new Date();
        const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*$/, '');
        const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
        return new File([file], `Pasted Image ${stamp}${index ? ` (${index + 1})` : ''}.${ext}`, { type: file.type });
    }

    /** Image files on the clipboard, as uploadHandlers.js reads them (Dreamscape's packed copy too). */
    function pastedImages(cd) {
        const out = [];
        const seen = new Set();
        const add = (file) => {
            if (!file || !file.type || !file.type.startsWith('image/')) return;
            const key = `${file.name}|${file.size}|${file.type}`;
            if (seen.has(key)) return;
            seen.add(key);
            out.push(file);
        };
        Array.from((cd && cd.files) || []).forEach(add);
        Array.from((cd && cd.items) || []).forEach((item) => {
            if (item.kind === 'file' && item.type && item.type.startsWith('image/')) add(item.getAsFile());
        });
        const html = cd && cd.getData ? cd.getData('text/html') : '';
        /* global filesFromClipboardHtml */
        if (html && html.includes('dreamscape-images') && typeof filesFromClipboardHtml === 'function') {
            filesFromClipboardHtml(html).forEach(add);
        }
        return out.map(namePasted);
    }

    // ---- what the files become ----------------------------------------------------------------

    async function uploadTo(path, files) {
        if (readOnly()) {
            showGlassToast('warning', null, 'Not available in read-only mode', false, 4000);
            return;
        }
        // featureLoader.loadFeature / initializeExplorerApplet: featureLoader.js, explorerApplet.js
        await featureLoader.loadFeature('explorer');
        const app = initializeExplorerApplet();
        if (!uploadablePath(app, path)) {
            showGlassToast('warning', null, 'Cannot save files in this folder', false, 4000);
            return;
        }
        await app.uploadFilesToPath(path, files);
    }

    async function attachToDirector(files) {
        // openDirectorWindow / initializeDirector: director.js
        await openDirectorWindow();
        const director = root.directorInstance;
        if (!director) return;
        if (!director.directorWindow && typeof director.showDirector === 'function') await director.showDirector();
        director.addComputerFiles(files);
        if (director.directorChatInput) director.directorChatInput.focus();
    }

    function importFiles(files) {
        // unifiedUploadModalManager: referenceManager.js (Toolbox > Import)
        return unifiedUploadModalManager.handleFiles(files);
    }

    function saveToFolder(files) {
        if (readOnly()) {
            showGlassToast('warning', null, 'Not available in read-only mode', false, 4000);
            return Promise.resolve();
        }
        const one = files.length === 1;
        const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : '';
        // studioOpenFolderDialog: studioSession.js (the Vista Save As dialog)
        return studioOpenFolderDialog('save', {
            startPath: ws ? `/Workspaces/${ws}` : '/',
            host: {
                title: 'Save As',
                typeLabel: 'All Files (*.*)',
                acceptType: 'user-file',
                // several files keep their own names: the box only names the folder
                suggestName: () => (one ? files[0].name : '(this folder)'),
                async onSave(info) {
                    let list = files;
                    if (one) {
                        const name = String(info.name || '').trim();
                        if (!name) return false;
                        if (name !== files[0].name) list = [new File([files[0]], name, { type: files[0].type })];
                    }
                    const app = explorer();
                    if (app && !uploadablePath(app, info.path || '/')) {
                        showGlassToast('warning', null, 'Cannot save files in this folder', false, 4000);
                        return false;
                    }
                    // the dialog closes first; the progress dialog shows the upload
                    setTimeout(() => { void uploadTo(info.path || '/', list); }, 0);
                    return true;
                }
            }
        });
    }

    function describe(files, verb) {
        // the confirmation dialog reads a message with tags as HTML
        if (files.length === 1) return `What do you want to do with "${String(files[0].name || 'this file').replace(/[<>]/g, '')}"?`;
        return `What do you want to do with these ${files.length} ${verb}?`;
    }

    async function ask(files, event, pasted) {
        if (!files.length || asking) return;
        asking = true;
        try {
            const options = [{ text: 'Attach to Director Message', value: 'director', className: 'btn-standard primary', primary: true }];
            if (files.some((f) => (f.type && f.type.startsWith('image/')) || IMPORT_EXT.test(f.name || ''))) {
                options.push({ text: 'Import', value: 'import', className: 'btn-standard' });
            }
            options.push({ text: 'Save to Folder...', value: 'save', className: 'btn-standard' });
            options.push({ text: 'Cancel', value: null, className: 'btn-standard' });
            const choice = await showConfirmationDialog(describe(files, pasted ? 'images' : 'files'), options, event, {
                title: 'Dreamscape',
                icon: 'fas fa-question-circle'
            });
            if (choice === 'director') await attachToDirector(files);
            else if (choice === 'import') await importFiles(files);
            else if (choice === 'save') await saveToFolder(files);
        } catch (err) {
            console.error('[dropPasteFallback]', err);
            showGlassToast('error', null, (err && err.message) || 'Could not use the files', false, 5000);
        } finally {
            asking = false;
        }
    }

    /** Where files go: a folder under the target, the Director, or the question. */
    function deliver(files, target, event, pasted) {
        const app = pasted ? null : explorerTarget(target);
        if (app) return uploadTo(app.currentPath, files);
        if (pasted) {
            const active = explorerOpen();
            if (active && active.modal.classList.contains('active-window') && uploadablePath(active, active.currentPath)) {
                return uploadTo(active.currentPath, files);
            }
        } else {
            const folder = desktopFolderTarget(target);
            if (folder) return uploadTo(folder.path, files);
        }
        if (directorTarget(target)) return attachToDirector(files);
        return ask(files, event, pasted);
    }

    // ---- listeners ------------------------------------------------------------------------------

    root.addEventListener('dragstart', () => { internalDrag = true; }, true);
    root.addEventListener('dragend', () => { internalDrag = false; }, true);
    // no pointer events reach the page during a drag: the first one after it means the drag is
    // over, also when its source left the page and no dragend came
    root.addEventListener('pointermove', () => { if (internalDrag) internalDrag = false; }, true);

    root.addEventListener('dragover', (e) => {
        if (internalDrag || e.defaultPrevented || !hasFiles(e.dataTransfer)) return;
        if (e.target && e.target.matches && e.target.matches('input[type="file"]')) return;
        // anywhere takes the drop: a folder, the Director, or the question; never the browser
        // opening the file in place of the desktop
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = ready() ? 'copy' : 'none';
        if (!ready()) return;
        const folder = desktopFolderTarget(e.target);
        setHighlight(folder ? folder.el : null);
    });

    root.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget) setHighlight(null);
    });

    root.addEventListener('drop', (e) => {
        setHighlight(null);
        if (internalDrag) { internalDrag = false; return; }
        if (e.defaultPrevented || !hasFiles(e.dataTransfer)) return;
        if (e.target && e.target.matches && e.target.matches('input[type="file"]')) return;
        e.preventDefault();
        if (!ready()) return;
        const files = droppedFiles(e.dataTransfer);
        if (!files.length) return;
        void deliver(files, e.target, e, false);
    });

    root.addEventListener('paste', (e) => {
        if (e.defaultPrevented) return;
        const target = e.target;
        // a rich text box pastes the picture into itself
        if (target && target.isContentEditable) return;
        // a text box keeps text: Office copies carry a picture of the text beside it
        const types = Array.from((e.clipboardData && e.clipboardData.types) || []);
        if (textField(target) && types.includes('text/plain')) return;
        if (!ready()) return;
        const files = pastedImages(e.clipboardData);
        if (!files.length) return;
        e.preventDefault();
        void deliver(files, target, null, true);
    });

    root.dropPasteFallback = { deliver, ask };
})(typeof window !== 'undefined' ? window : globalThis);
