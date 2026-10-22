/**
 * Recent Items, Vista's Start menu list of recently opened documents, kept per workspace
 * (Yukimi 2026-10-21): files opened from Cartograph, the page each Grimoire / Alchemy browser
 * session was last on, images and files opened in Studio, Director sessions, notes and pictures.
 * Programs are not documents: the Start menu's most used list covers those.
 *
 *   recentItems.add({ kind, key, title, imageIcon?, image?, icon?, data })
 *        kind    'file' | 'page' | 'studio' | 'director' | 'note' | 'picture' | ...
 *        key     what makes it the same item again (a path, a browser session, a session id):
 *                adding it again moves it to the top with the new title and data, so a browser
 *                session keeps one entry that follows its last page
 *        data    what its opener needs to open it again
 *   recentItems.list(workspaceId?)    newest first, at most MAX
 *   recentItems.open(entry)           through the opener registered for its kind
 *   recentItems.registerOpener(kind, fn(entry))
 *   recentItems.clear(workspaceId?)   the Start menu's "Clear Recent Items list"
 *
 * Kept in this browser (localStorage 'recentItems:<workspace>'), like the Start menu's launch
 * history. While Taskbar and Start Menu Properties' "Store and display a list of recently opened
 * files" is off (taskbarSettings.js recentFiles) nothing is recorded and every workspace's list
 * is cleared, as in Vista. Fires 'recentitemschange' on window.
 */
(function (root) {
    'use strict';

    const PREFIX = 'recentItems:';
    const MAX = 15; // Vista's Recent Items shows 15
    const REOPEN_MS = 5000;
    const openers = {};
    // an item reopened from the list: the app it opens in may record it again under a key of its
    // own (a new browser session, a file opened from another folder); that entry replaces it
    let reopening = null;

    function workspaceId() {
        // activeWorkspace: public/scripts/comp/workspaceUtils.js (a classic-script global)
        if (typeof activeWorkspace !== 'undefined' && activeWorkspace) return String(activeWorkspace);
        return String(root.currentWorkspace || 'default');
    }

    function storageKey(ws) {
        return PREFIX + (ws || workspaceId());
    }

    function read(ws) {
        try {
            const raw = root.localStorage ? root.localStorage.getItem(storageKey(ws)) : null;
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list.filter((e) => e && e.key && e.kind && e.title) : [];
        } catch (_) {
            return [];
        }
    }

    function write(list, ws) {
        try {
            if (root.localStorage) root.localStorage.setItem(storageKey(ws), JSON.stringify(list.slice(0, MAX)));
        } catch (_) { /* private mode or full */ }
        try {
            root.dispatchEvent(new CustomEvent('recentitemschange', { detail: { workspace: ws || workspaceId() } }));
        } catch (_) { /* old browsers */ }
    }

    function recording() {
        const ts = root.taskbarSettings;
        return !(ts && ts.get().recentFiles === false);
    }

    function clip(text, n) {
        const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
        return s.length > n ? `${s.slice(0, n - 1)}…` : s;
    }

    /** Privacy off: every workspace's list goes, as Vista clears Recent Items. */
    function clearAll() {
        const ls = root.localStorage;
        if (!ls) return;
        try {
            const keys = [];
            for (let i = 0; i < (ls.length || 0); i++) {
                const k = ls.key(i);
                if (k && k.startsWith(PREFIX)) keys.push(k);
            }
            if (!keys.length && ls.getItem(storageKey())) keys.push(storageKey());
            keys.forEach((k) => ls.removeItem(k));
            if (keys.length) root.dispatchEvent(new CustomEvent('recentitemschange', { detail: { workspace: null } }));
        } catch (_) { /* private mode */ }
    }

    function add(entry) {
        if (!entry || !entry.kind || !entry.key || !entry.title || !recording()) return false;
        const ws = entry.workspace || workspaceId();
        const key = `${entry.kind}:${entry.key}`;
        if (reopening && (Date.now() > reopening.until || reopening.ws !== ws)) reopening = null;
        const replaces = reopening && reopening.kind === entry.kind && reopening.key !== key ? reopening.key : null;
        const item = {
            kind: String(entry.kind),
            key,
            title: clip(entry.title, 120),
            sub: entry.sub ? clip(entry.sub, 160) : undefined,
            imageIcon: entry.imageIcon || undefined,
            image: typeof entry.image === 'string' && !entry.image.startsWith('data:') ? entry.image : undefined,
            icon: entry.icon || undefined,
            data: entry.data && typeof entry.data === 'object' ? entry.data : {},
            t: Date.now()
        };
        const before = read(ws);
        // recorded again without its folder (reopened from the list): it keeps the one it had
        const was = before.find((e) => e.key === key);
        if (!item.sub && was && was.sub) item.sub = was.sub;
        const list = before.filter((e) => e.key !== key && e.key !== replaces);
        list.unshift(item);
        write(list, ws);
        if (replaces) reopening = null;
        return true;
    }

    function list(ws) {
        if (!recording()) {
            clearAll();
            return [];
        }
        return read(ws);
    }

    function remove(key, ws) {
        write(read(ws).filter((e) => e.key !== key), ws);
    }

    function clear(ws) {
        write([], ws);
    }

    function registerOpener(kind, fn) {
        if (kind && typeof fn === 'function') openers[kind] = fn;
    }

    async function open(entry) {
        const fn = entry && openers[entry.kind];
        if (!fn) return false;
        reopening = { kind: entry.kind, key: entry.key, ws: workspaceId(), until: Date.now() + REOPEN_MS };
        try {
            await fn(entry);
            // opening it again makes it the newest, unless the app recorded it afresh meanwhile;
            // one that records it a moment later (a page's first load) still replaces it
            if (reopening && reopening.key === entry.key) {
                add({ kind: entry.kind, key: entry.key.slice(entry.kind.length + 1), title: entry.title, sub: entry.sub, imageIcon: entry.imageIcon, image: entry.image, icon: entry.icon, data: entry.data });
            }
            return true;
        } catch (err) {
            reopening = null;
            console.error('Recent Items: could not open', entry.title, err);
            return false;
        }
    }

    // ---- what each app records (one call at the place it opens something) ----------------------

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    async function loadFeature(name) {
        // featureLoader: public/scripts/comp/featureLoader.js
        if (typeof featureLoader !== 'undefined' && featureLoader && typeof featureLoader.loadFeature === 'function') {
            await featureLoader.loadFeature(name);
        }
    }

    /** A browser window or tab: one entry for its whole life, following its last page
     *  (Yukimi: "the last page it was opened to, so it's per browser session"). */
    function sessionKey(shell) {
        if (!shell || typeof shell !== 'object') return null;
        if (!shell._recentItemsKey) shell._recentItemsKey = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
        return shell._recentItemsKey;
    }

    /** Grimoire / Alchemy: a page the session is now on ({ type: 'web' | 'wiki' | 'dsap', ... }). */
    function notePage(shell, entry) {
        const key = sessionKey(shell);
        if (!key || !entry) return;
        if (entry.type === 'web' && entry.url && /^https?:/i.test(entry.url)) {
            add({ kind: 'page', key, title: entry.title || entry.url, sub: entry.url, data: { type: 'web', url: entry.url } });
        } else if (entry.type === 'wiki' && entry.tag) {
            const name = entry.tag.name || entry.tag.title;
            if (name) add({ kind: 'page', key, title: entry.tag.title || name, data: { type: 'wiki', name } });
        } else if (entry.type === 'dsap' && entry.url) {
            add({ kind: 'page', key, title: entry.title || entry.url, data: { type: 'dsap', url: entry.url } });
        }
    }

    const EXPLORER_FIELDS = ['id', 'name', 'targetKind', 'targetId', 'previewImageFilename', 'mimeType', 'previewUrl', 'workspaceId', 'shortcutType', 'shortcutData', 'systemFileKey', 'navPath'];

    /** Cartograph: a file opened that no other recorder covers (pictures, notes and pages have
     *  their own: Lumen, the notepad and the browsers record those as they open). */
    function noteExplorerItem(item, folder) {
        if (!item || !item.name || !['user-file', 'system-file'].includes(item.targetKind)) return;
        const saved = {};
        EXPLORER_FIELDS.forEach((f) => { if (item[f] !== undefined && typeof item[f] !== 'function') saved[f] = item[f]; });
        // keyed by the file itself, not the folder it was opened from: reopened from the list, Cartograph
        // records it with no folder
        const id = item.systemFileKey || item.targetId || item.id || item.name;
        add({ kind: 'file', key: `${item.targetKind}:${id}`, title: item.name, sub: folder || '', data: { item: saved } });
    }

    /** Studio: an image loaded into it. */
    function noteStudioImage(image) {
        const fn = image && (image.filename || image.upscaled || image.original);
        if (!fn) return;
        add({ kind: 'studio', key: fn, title: fn, sub: 'Studio', data: { filename: fn } });
    }

    /** Director: a session opened. */
    function noteDirectorSession(session) {
        if (!session || !session.id) return;
        add({ kind: 'director', key: String(session.id), title: session.name || 'Director session', sub: 'Director', data: { id: session.id } });
    }

    /** Notepad / Notion: a note opened. */
    function noteNote(note) {
        if (!note || !note.id) return;
        add({ kind: 'note', key: String(note.id), title: note.name || 'Untitled', data: { id: note.id } });
    }

    /** Lumen: a picture opened (gallery images by filename, references by hash, else the source). */
    function notePicture(src, title, metadata) {
        const md = metadata || {};
        const id = md.filename || md.hash || src;
        if (!id || (typeof id === 'string' && id.startsWith('blob:'))) return;
        add({
            kind: 'picture',
            key: String(id),
            title: title || md.filename || 'Picture',
            data: { filename: md.filename || null, src: typeof src === 'string' && !src.startsWith('data:') && !src.startsWith('blob:') ? src : null, title: title || null }
        });
    }

    // ---- how each kind opens again ------------------------------------------------------------

    registerOpener('page', async (entry) => {
        const d = entry.data || {};
        if (d.type === 'dsap' && typeof root.openDsapInGrimoire === 'function') return root.openDsapInGrimoire(d.url);
        if (d.type === 'wiki') return callGlobal('openGrimoireApplet', d.name);
        // openGrimoireUrl: public/scripts/comp/featureLoader.js (web pages land in Alchemy)
        return callGlobal('openGrimoireUrl', d.url);
    });

    registerOpener('file', async (entry) => {
        const item = entry.data && entry.data.item;
        if (!item) return undefined;
        await loadFeature('explorer');
        // initializeExplorerApplet: public/scripts/comp/explorerApplet.js
        const explorer = callGlobal('initializeExplorerApplet');
        return explorer && typeof explorer.openItem === 'function' ? explorer.openItem(item) : undefined;
    });

    registerOpener('studio', async (entry) => {
        const fn = entry.data && entry.data.filename;
        if (!fn) return undefined;
        // findImageByFilename: galleryView.js; openManualModalWithContent: manualModalManager.js
        const image = callGlobal('findImageByFilename', fn) || { filename: fn };
        return callGlobal('openManualModalWithContent', { type: 'image', image, skipConfirm: true }, null);
    });

    registerOpener('director', async (entry) => {
        const id = entry.data && entry.data.id;
        // openDirectorWindow / directorInstance.openSessionInWindow: public/scripts/comp/director.js
        if (!root.directorInstance) await callGlobal('openDirectorWindow');
        if (root.directorInstance && typeof root.directorInstance.openSessionInWindow === 'function') {
            return root.directorInstance.openSessionInWindow(id);
        }
        return undefined;
    });

    registerOpener('note', async (entry) => {
        const id = entry.data && entry.data.id;
        // loadNotepadManager: public/scripts/comp/featureLoader.js
        const manager = (await callGlobal('loadNotepadManager')) || root.notepadManager;
        return manager && typeof manager.openExistingNote === 'function' ? manager.openExistingNote(id) : undefined;
    });

    registerOpener('picture', async (entry) => {
        const d = entry.data || {};
        // openGalleryImageInViewer / openImageInViewer: public/scripts/comp/imageViewer.js
        if (d.filename) {
            const image = callGlobal('findImageByFilename', d.filename) || { filename: d.filename, original: d.filename };
            return callGlobal('openGalleryImageInViewer', image);
        }
        if (d.src) return callGlobal('openImageInViewer', d.src, d.title || entry.title, {});
        return undefined;
    });

    root.addEventListener?.('taskbarsettingschange', (ev) => {
        if (ev && ev.detail && ev.detail.recentFiles === false) clearAll();
    });

    const api = {
        add, list, open, remove, clear, clearAll, registerOpener, workspaceId, MAX,
        notePage, noteExplorerItem, noteStudioImage, noteDirectorSession, noteNote, notePicture,
        _test: { storageKey, openers, sessionKey }
    };
    root.recentItems = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
