/**
 * Every "choose a file" in Melaton goes through the platform's Open dialog, never the browser's file
 * chooser (Yukimi, Nov 20 2026: "Replace every single one with the correct Vista Open dialog. For the
 * ones that are for Android/Windows clients that should attach to a 'Receive from Device' option, they
 * are kept but are disabled in DreamOS.") (#910)
 *
 *   Desktop  Vista's Open common dialog (studioSession.js studioOpenFolderDialog 'open-vfs': Favorite
 *            Links, the Folders tree, Computer and its drives (the phone's, the DreamOS host's), the
 *            file types from the caller's accept, multiple selection where the caller takes several).
 *            "Receive from Device" beside Open hands the choice to this device's own chooser (a Windows
 *            browser's disk, the Android app's storage); on DreamOS it is shown disabled: the machine IS
 *            the computer, its files are already in the dialog through its drives.
 *   Phone    Windows Mobile's Open dialog (wmFileDialogs.js, the phone's own volumes among its
 *            locations) with Browse device... in Menu.
 *
 * The caller keeps its own code: open(input) fills the caller's <input type=file> with the chosen
 * files (File objects, as the browser's chooser gives) and fires its input / change events, or cancel
 * when the dialog is dismissed. pick() resolves the File[] (null on Cancel) for callers without an input.
 *
 * API (window.fileOpenPicker):
 *   open(input, { title, owner, device = true, startPath })  the dialog for this input (its accept and
 *                                multiple are the dialog's types and selection); device: false leaves
 *                                Receive from Device out (the file only makes sense from Melaton's own)
 *   pick({ accept, multiple, title, owner, device, startPath })   resolves File[] or null
 *   receive(input)               the device's own chooser straight away (a caller's own "from device"
 *                                command, e.g. Explorer's Upload); false (nothing opened) on DreamOS
 *   canReceive                   whether this client has a device of its own to receive from
 *   registerSource(fn)           fn(item) -> null | { url, name?, type? } | Promise<File|Blob>: bytes for
 *                                a kind of item the dialog lists that this file does not know (new drives)
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const DREAMOS = / DreamOS\//.test((root.navigator && root.navigator.userAgent) || '');
    // the progress dialog only for a file that takes a while to arrive (Vista holds its own back ~1 s)
    const PROGRESS_DELAY_MS = 1000;
    const sources = [];

    const IMAGE_EXTS = ['bmp', 'dib', 'jpg', 'jpeg', 'jpe', 'jfif', 'gif', 'tif', 'tiff', 'png', 'ico', 'webp', 'avif', 'heic'];
    const AUDIO_EXTS = ['mp3', 'wav', 'wma', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'flac', 'mid', 'midi'];
    const VIDEO_EXTS = ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'mpg', 'mpeg', '3gp'];
    const TEXT_EXTS = ['txt', 'log', 'csv', 'md', 'json', 'xml', 'ini'];
    const MIME_OF = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
        bmp: 'image/bmp', dib: 'image/bmp', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif', heic: 'image/heic',
        mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', aac: 'audio/aac', m4a: 'audio/mp4', flac: 'audio/flac',
        mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime',
        json: 'application/json', txt: 'text/plain', csv: 'text/csv', xml: 'application/xml', pdf: 'application/pdf',
        apk: 'application/vnd.android.package-archive', zip: 'application/zip', tar: 'application/x-tar', zst: 'application/zstd',
        ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2'
    };
    // the name a type list gives an extension's files (Vista's own wording where Vista has one)
    const TYPE_NAMES = {
        json: 'JSON Files', txt: 'Text Documents', csv: 'CSV Files', xml: 'XML Files', pdf: 'PDF Files', apk: 'Android Packages',
        tar: 'Archives', zst: 'Archives', zip: 'Compressed (zipped) Folders', ttf: 'Font Files', otf: 'Font Files', woff: 'Font Files', woff2: 'Font Files',
        p8: 'Key Files', pem: 'Key Files', key: 'Key Files', nai: 'NovelAI Files', css: 'Style Sheets'
    };

    const extOf = (name) => {
        const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
        return m ? m[1].toLowerCase() : '';
    };

    /** The caller's accept as { exts, mimes: [exact | 'image/*' ...] } (empty = anything). */
    function parseAccept(accept) {
        const exts = [];
        const mimes = [];
        String(accept || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).forEach((t) => {
            if (t.startsWith('.')) exts.push(t.slice(1));
            else if (t.includes('/')) mimes.push(t);
        });
        return { exts, mimes, any: !exts.length && !mimes.length };
    }

    function mimeMatches(mime, pattern) {
        if (!mime) return false;
        if (pattern.endsWith('/*')) return mime.startsWith(pattern.slice(0, -1));
        return mime === pattern;
    }

    /** Whether a file (by its name / type) is one the caller asked for. */
    function accepts(spec, name, mime) {
        if (spec.any) return true;
        const ext = extOf(name);
        if (ext && spec.exts.includes(ext)) return true;
        const type = String(mime || MIME_OF[ext] || '').toLowerCase();
        if (spec.mimes.some((p) => mimeMatches(type, p))) return true;
        // application/octet-stream beside a list of extensions: the list decides
        return false;
    }

    /** The extensions a type label lists for an accept: its own, and those its mime families name. */
    function labelExts(spec) {
        const out = [];
        const add = (list) => list.forEach((e) => { if (!out.includes(e)) out.push(e); });
        spec.mimes.forEach((m) => {
            if (m === 'image/*') add(IMAGE_EXTS);
            else if (m === 'audio/*') add(AUDIO_EXTS);
            else if (m === 'video/*') add(VIDEO_EXTS);
            else if (m === 'text/*') add(TEXT_EXTS);
            else add(Object.keys(MIME_OF).filter((e) => MIME_OF[e] === m));
        });
        add(spec.exts);
        return out;
    }

    /** Files of type: the caller's kind first (Vista's "All Picture Files (*.bmp;*.jpg;...)"), then All Files. */
    function typesFor(spec) {
        const all = { label: 'All Files (*.*)' };
        if (spec.any) return [all];
        const exts = labelExts(spec);
        const media = spec.mimes.some((m) => m === 'audio/*' || m === 'video/*');
        const pictures = !media && spec.mimes.length && spec.mimes.every((m) => m.startsWith('image/')) && spec.exts.every((e) => IMAGE_EXTS.includes(e));
        let name;
        if (pictures) name = 'All Picture Files';
        else if (media) name = 'Media files (all types)';
        else {
            const names = [...new Set(exts.map((e) => TYPE_NAMES[e]).filter(Boolean))];
            name = names.length === 1 && exts.every((e) => TYPE_NAMES[e]) ? names[0] : 'All Supported Files';
        }
        const label = exts.length ? `${name} (${exts.map((e) => `*.${e}`).join(';')})` : name;
        return [{ label, accept: (item) => accepts(spec, item.name, itemMime(item)) }, all];
    }

    // ---- what an item in the dialog is, as bytes ----

    const galleryName = (item) => {
        if (item.targetKind === 'image' || item.targetKind === 'scrap') return item.previewImageFilename || item.targetId || '';
        if (item.shortcutType === 'image' && item.shortcutData && item.shortcutData.filename) return item.shortcutData.filename;
        return '';
    };

    function itemMime(item) {
        if (!item) return '';
        if (item.mimeType) return item.mimeType;
        if (item.phone && item.phone.mime) return item.phone.mime;
        const g = galleryName(item);
        return MIME_OF[extOf(g || item.name)] || (g ? 'image/png' : '');
    }

    /** The file name the caller gets: the item's name, with the stored file's extension when it has none. */
    function fileName(item) {
        const name = String(item.name || 'file');
        if (extOf(name)) return name;
        const ext = extOf(galleryName(item) || (item.phoneFile && item.phoneFile.path) || '');
        return ext ? `${name}.${ext}` : name;
    }

    /** Where an item's bytes come from: { url } or { file } (a source's own), or null (not a file). */
    function sourceOf(item) {
        if (!item || item.kind === 'folder' || item.navPath) return null;
        for (const fn of sources) {
            try {
                const s = fn(item);
                if (s) return s;
            } catch (_) { /* that source does not know it */ }
        }
        if (item.targetKind === 'user-file') {
            const id = item.targetId || item.id;
            return id ? { fileId: id } : null;
        }
        const g = galleryName(item);
        // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        if (g) return { url: typeof root.localGalleryImageUrl === 'function' ? root.localGalleryImageUrl(g) : `/images/${encodeURIComponent(g)}` };
        // a file on a phone (Computer's phone drive on the desktop, the phone's own volumes in WM's dialog)
        const ps = root.phoneStorage;
        const ph = item.phone && !item.phone.dir ? item.phone : item.phoneFile;
        if (ph && ps && typeof ps.fileUrl === 'function') return { url: ps.fileUrl(ph.root, ph.path) };
        if (item.downloadUrl) return { url: item.downloadUrl };
        return null;
    }

    const fetchable = (item) => !!sourceOf(item);

    /** One item's bytes as a File, reporting received bytes to onBytes(n, total). */
    async function toFile(item, onBytes) {
        let src = sourceOf(item);
        if (!src) throw new Error(`${item && item.name ? item.name : 'This item'} is not a file.`);
        if (typeof src.then === 'function') src = await src;
        const name = fileName(item);
        if (src instanceof root.Blob) return src instanceof root.File ? src : new root.File([src], name, { type: src.type || itemMime(item) });
        if (src.fileId) {
            // vfsClient.downloadFile: public/scripts/comp/vfsClient.js (a top-level const, not on window)
            // eslint-disable-next-line no-undef
            const vfs = typeof vfsClient !== 'undefined' ? vfsClient : root.vfsClient;
            const res = await vfs.downloadFile(src.fileId);
            src = { url: res && (res.downloadUrl || (res.data && res.data.downloadUrl)) };
            if (!src.url) throw new Error(`The server did not give ${name}.`);
        }
        const res = await fetch(src.url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`${name} could not be read (${res.status}).`);
        const total = Number(res.headers.get('content-length')) || Number(item.size) || 0;
        let blob;
        if (res.body && typeof res.body.getReader === 'function' && onBytes) {
            const reader = res.body.getReader();
            const parts = [];
            let got = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                parts.push(value);
                got += value.byteLength;
                onBytes(got, total);
            }
            blob = new root.Blob(parts);
        } else {
            blob = await res.blob();
        }
        const type = src.type || itemMime(item) || res.headers.get('content-type') || blob.type || '';
        return new root.File([blob], src.name || name, { type: String(type).split(';')[0], lastModified: item.modifiedAt ? Number(item.modifiedAt) * (item.modifiedAt < 1e12 ? 1000 : 1) : Date.now() });
    }

    /** The chosen items as Files; Vista's Downloading progress dialog once it takes over a second. */
    async function toFiles(items) {
        const P = root.fileOperationProgress;
        let op = null;
        let cancelled = false;
        const sizes = items.map((i) => Number(i.size) || 0);
        const done = [];
        let current = 0;
        const timer = P && typeof P.begin === 'function' && (!P.available || P.available()) ? setTimeout(() => {
            op = P.begin({
                op: 'copy',
                verb: 'Downloading',
                items: items.map((i, k) => ({ name: fileName(i), size: sizes[k] })),
                onCancel: () => { cancelled = true; }
            });
        }, PROGRESS_DELAY_MS) : null;
        try {
            for (let k = 0; k < items.length; k++) {
                if (cancelled) return null;
                const base = sizes.slice(0, k).reduce((a, b) => a + b, 0);
                const all = sizes.reduce((a, b) => a + b, 0);
                current = k;
                done.push(await toFile(items[k], (got, total) => {
                    if (op) op.progress(base + got, Math.max(all, base + (total || got)));
                }));
                if (op) op.done({ name: fileName(items[current]), size: sizes[current] });
            }
            return cancelled ? null : done;
        } finally {
            if (timer) clearTimeout(timer);
            if (op) op.finish();
        }
    }

    // ---- the device's own chooser ----

    const canReceive = !DREAMOS;

    /** The browser's chooser on this input (the Android app's storage, a Windows client's disk). */
    function receive(input) {
        if (!canReceive || !input) return false;
        HTMLInputElement.prototype.click.call(input);
        return true;
    }

    // ---- the dialog ----

    function message(text) {
        // showConfirmationDialog: public/scripts/comp/confirmationDialog.js (Vista's message box)
        if (typeof root.showConfirmationDialog === 'function') {
            const esc = String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
            return root.showConfirmationDialog(`<p>${esc}</p>`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'Open', icon: 'fas fa-circle-exclamation' });
        }
        return Promise.resolve();
    }

    /**
     * The platform's Open dialog: resolves { files } (File[]), { device: true } (Receive from Device was
     * chosen; the caller's chooser is already open) or null (Cancel).
     */
    function show(opts, deviceInput) {
        const spec = parseAccept(opts.accept);
        const multiple = !!opts.multiple;
        const title = opts.title || 'Open';
        const device = opts.device !== false && !!deviceInput;
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            const take = async (items) => {
                try {
                    const files = await toFiles(items.slice(0, multiple ? items.length : 1));
                    finish(files && files.length ? { files } : null);
                } catch (err) {
                    await message((err && err.message) || 'The file could not be opened.');
                    finish(null);
                }
            };
            const wm = root.uiShell === 'mobile' && root.wmFileDialogs && typeof root.wmFileDialogs.open === 'function' ? root.wmFileDialogs : null;
            if (wm) {
                // Windows Mobile's Open: the phone's own volumes too, Browse device... in Menu
                const extra = device ? [{ label: 'Browse device...', action: () => { finish({ device: true }); wm.close(); receive(deviceInput); } }] : [];
                void wm.open({
                    title,
                    typeLabel: typesFor(spec)[0].label.replace(/ \(.*\)$/, '') || 'All Files',
                    acceptAttr: opts.accept || '',
                    startPath: opts.startPath,
                    phone: true,
                    pictures: spec.mimes.length > 0 && spec.mimes.every((m) => m.startsWith('image/')),
                    accept: (item) => fetchable(item) && accepts(spec, fileName(item), itemMime(item)),
                    extra,
                    onCancel: () => finish(null),
                    async onPick(item) {
                        await take([item]);
                        return true;
                    }
                });
                return;
            }
            // studioOpenFolderDialog: public/scripts/comp/studioSession.js (Vista's common file dialog)
            if (typeof root.studioOpenFolderDialog !== 'function') {
                // no dialog on this page (it failed to load): the device's chooser, as before
                if (device && receive(deviceInput)) finish({ device: true });
                else finish(null);
                return;
            }
            const host = {
                title,
                types: typesFor(spec),
                acceptItem: fetchable,
                rejectMessage: 'This file can\'t be opened here.',
                onOpen: (item) => take([item]),
                onCancel: () => finish(null)
            };
            if (multiple) host.onOpenMany = (items) => take(items);
            if (opts.rememberKey) host.rememberKey = opts.rememberKey;
            if (device) {
                host.extraButton = {
                    label: 'Receive from <u>D</u>evice',
                    // DreamOS: this machine is the computer; its files are already in the dialog
                    disabled: !canReceive,
                    onClick: () => {
                        if (!canReceive) return;
                        host._settled = true;
                        // the chooser opens inside this click (it needs the gesture), then the dialog goes
                        receive(deviceInput);
                        finish({ device: true });
                        const modal = doc.getElementById('studioSaveFolderModal');
                        if (modal && typeof root.closeModal === 'function') root.closeModal(modal);
                    }
                };
            }
            void Promise.resolve(root.studioOpenFolderDialog('open-vfs', { owner: opts.owner, startPath: opts.startPath, host })).catch(() => finish(null));
        });
    }

    /** The caller's input gets the files and its events, as from the browser's chooser. */
    function fill(input, files) {
        try {
            const dt = new root.DataTransfer();
            files.forEach((f) => dt.items.add(f));
            input.files = dt.files;
        } catch (_) {
            return false;
        }
        input.dispatchEvent(new root.Event('input', { bubbles: true }));
        input.dispatchEvent(new root.Event('change', { bubbles: true }));
        return true;
    }

    /** The Open dialog for a caller's <input type=file>: its accept, multiple and change handler stay its own. */
    async function open(input, options) {
        // a disabled input (read-only mode, cacheAndReadOnly.js) opens nothing, as the browser's would
        if (!input || input.disabled) return false;
        const o = options || {};
        const result = await show({
            accept: o.accept != null ? o.accept : input.accept,
            multiple: o.multiple != null ? o.multiple : input.multiple,
            title: o.title,
            owner: o.owner,
            device: o.device,
            startPath: o.startPath,
            rememberKey: o.rememberKey
        }, input);
        if (result && result.files) return fill(input, result.files);
        if (!result) input.dispatchEvent(new root.Event('cancel', { bubbles: true }));
        return false;
    }

    /** The Open dialog without an input of the caller's: File[] (from the dialog or the device), or null. */
    function pick(options) {
        const o = options || {};
        const input = doc.createElement('input');
        input.type = 'file';
        if (o.accept) input.accept = o.accept;
        input.multiple = !!o.multiple;
        return new Promise((resolve) => {
            let done = false;
            const end = (v) => { if (!done) { done = true; resolve(v); } };
            input.addEventListener('change', () => end(input.files && input.files.length ? [...input.files] : null), { once: true });
            input.addEventListener('cancel', () => end(null), { once: true });
            // Receive from Device: the device's chooser fills the same input (change), or says cancel
            void open(input, o);
        });
    }

    function registerSource(fn) {
        if (typeof fn === 'function' && !sources.includes(fn)) sources.push(fn);
    }

    root.fileOpenPicker = { open, pick, receive, canReceive, isDreamOS: DREAMOS, registerSource, toFile, accepts: (accept, name, mime) => accepts(parseAccept(accept), name, mime) };
})(window);
