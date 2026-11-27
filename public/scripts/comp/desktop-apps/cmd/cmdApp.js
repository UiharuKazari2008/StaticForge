/**
 * Command Prompt (Yozora #1133): Vista's cmd.exe as a window of the page, over Dreamscape's own file systems.
 * Its settings (cell, window and buffer size, cursor, colours, edit modes), the Properties sheet and the system menu
 * are cmdProperties.js (#1342); this.cfg holds a window's settings and this.geo what they make.
 *
 *   C:\             the workspace VFS root "/" as Explorer shows it (Local Disk (C:)); a prompt starts in the
 *                   active workspace's folder, C:\Workspaces\<name>, which is where Explorer opens
 *   D:, E:, ...     the host computer's drives (explorerHostDrive.js: the letters Explorer gives them) and the
 *                   phone's storages (explorerPhoneDrive.js, window.phoneStorage); a storage Explorer gives no
 *                   letter (a phone reached over ActiveSync is a portable device) takes the next free letter from D:
 *
 * The console is a grid of cells (the settings' font: Raster Fonts 8 x 12 at 80 x 25 with a 300 line buffer by default):
 * one element per buffer row, a row is written only when its cells change, and the scroll bar is the desktop's Vista one (a native scroller).
 * Drives, history and the line editor belong to the window; the listeners on the phone storage and the host
 * drives end with it (app-scope). Nothing here polls: the drive table follows 'dreamosdrives' and the
 * phone storage's 'config' / 'state' events, and the cursor blinks with a CSS animation.
 *
 *   openMelatonCommandPrompt([startPath])   a new window (Vista opens a new one each time)
 *
 * Deleting on C: moves to the Recycle Bin (vfsClient.moveToTrash, as Explorer's Delete); on a phone drive to
 * Android's trash (what it cannot take is asked about); on a host drive it is permanent, as Vista's is on a
 * removable disk.
 */
(function (root) {
    'use strict';

    const doc = root.document;
    if (!doc) return;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const ART = '/static_images/vista-cmd';   // cmd.exe's own program icon (cmd.exe,0): the real 16 / 32 / 48 frames, not the .cmd file icon (#1342)
    const ICON16 = `${ART}/cmd-16.png`;
    const ICON32 = `${ART}/cmd-32.png`;
    const TITLE = 'Command Prompt';
    const COLS = 80;   // the font fit's probe width (the cell's width is the setting's)
    // cmd.exe's banner, 1:1 with Vista with the holder rewritten (copyrights-not-1to1.mdc: Microsoft Windows -> Xyridian Melaton)
    const VERSION_TEXT = 'Xyridian Melaton [Version 6.0.6002]';
    const COPYRIGHT_TEXT = 'Copyright (c) 2006 Xyridian Corporation.  All rights reserved.';
    const FIT_CHARS = COLS * 50;   // the font fit's probe: 50 rows of cells in one line (its layout width is an integer)
    const OPENED_AT = Date.now();
    const PROPS = () => root.melatonConsoleProperties;   // the console's settings, Properties sheet and system menu (cmdProperties.js, loaded before this file)
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const VFS = () => (typeof vfsClient !== 'undefined' ? vfsClient : root.vfsClient);
    const PS = () => root.phoneStorage || null;
    const HOST = () => root.DreamOSDrives || null;

    /** A message cmd prints (without a trailing newline) and the errorlevel the command ends with. */
    class CmdError extends Error {
        constructor(text, level) {
            super(text);
            this.level = level == null ? 1 : level;
        }
    }

    // ---- small helpers -------------------------------------------------------------------------------------

    function pad2(n) { return String(n).padStart(2, '0'); }
    function fmtNum(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
    function fmtDate(ms) {
        const d = new Date(ms || OPENED_AT);
        return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
    }
    function fmtTime(ms) {
        const d = new Date(ms || OPENED_AT);
        const h = d.getHours();
        return `${pad2(h % 12 || 12)}:${pad2(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
    }
    function serialOf(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        const s = h.toString(16).toUpperCase().padStart(8, '0');
        return `${s.slice(0, 4)}-${s.slice(4)}`;
    }
    function lc(s) { return String(s).toLowerCase(); }
    function toMs(m) {
        const n = Number(m) || 0;
        return n > 0 && n < 1e12 ? n * 1000 : n;
    }
    function nextTick() { return new Promise((r) => setTimeout(r, 0)); }

    /** Cells a character takes in the console: 2 for the East Asian wide ranges, 0 for combining marks. */
    function cellWidth(ch) {
        const c = ch.codePointAt(0);
        if (c < 0x300) return 1;
        if ((c >= 0x300 && c <= 0x36F) || c === 0x200B || c === 0x200D || (c >= 0xFE00 && c <= 0xFE0F)) return 0;
        if ((c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0xA4CF) || (c >= 0xAC00 && c <= 0xD7A3) || (c >= 0xF900 && c <= 0xFAFF)
            || (c >= 0xFE30 && c <= 0xFE6F) || (c >= 0xFF00 && c <= 0xFF60) || (c >= 0xFFE0 && c <= 0xFFE6) || (c >= 0x1F300 && c <= 0x1FAFF) || (c >= 0x20000 && c <= 0x3FFFD)) return 2;
        return 1;
    }

    /** A string as cells starting at a column: a tab fills to the next multiple of 8; a wide character is [ch, ''] */
    function cellsOf(text, startCol) {
        const out = [];
        let col = startCol || 0;
        for (const ch of String(text)) {
            if (ch === '\t') {
                const n = 8 - (col % 8);
                for (let i = 0; i < n; i += 1) out.push(' ');
                col += n;
                continue;
            }
            const w = cellWidth(ch);
            if (w === 0) { if (out.length) out[out.length - 1] += ch; continue; }
            out.push(ch);
            if (w === 2) out.push('');
            col += w;
        }
        return out;
    }

    function wildRegex(pattern) {
        const p = String(pattern);
        if (p === '*' || p === '*.*') return /^.*$/s;
        const src = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
        return new RegExp(`^${src}$`, 'is');
    }
    const hasWild = (s) => /[*?]/.test(s);

    function extOf(name) {
        const i = name.lastIndexOf('.');
        return i > 0 ? name.slice(i + 1) : '';
    }
    const MIME = { txt: 'text/plain', log: 'text/plain', md: 'text/markdown', json: 'application/json', html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', xml: 'application/xml', csv: 'text/csv', bat: 'text/plain', cmd: 'text/plain', ini: 'text/plain' };
    function mimeFor(name) { return MIME[lc(extOf(name))] || 'application/octet-stream'; }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]*,/, ''));
            fr.onerror = () => reject(fr.error || new Error('read failed'));
            // no-base64-images: transport (a file read to base64 for the server)
            fr.readAsDataURL(blob);
        });
    }

    function userName() {
        try { return root.localStorage.getItem('username') || 'User'; } catch (_) { return 'User'; }
    }
    function computerName() {
        const dm = root.melatonDeviceManager;
        try { if (dm && typeof dm.computerName === 'function') return dm.computerName(); } catch (_) { /* host name below */ }
        const host = (root.location && root.location.hostname) || 'melaton';
        return `DREAMSCAPE-${host.split('.')[0].toUpperCase()}`.slice(0, 15);
    }

    // ---- drives ----------------------------------------------------------------------------------------------
    // A drive: { letter, kind: 'vfs' | 'phone' | 'host', key, rootId, label (''= none), total, free, desc }

    function phoneBlocked(st) {
        if (!st) return true;
        if (!st.enabled || !st.access || st.locked) return true;
        return !(Array.isArray(st.roots) && st.roots.length);
    }

    /** The drive table of one window: stable letters while a drive stays, rebuilt on the events below. */
    class DriveTable {
        constructor() {
            this.assigned = new Map();   // key -> letter
            this.map = new Map();
            this.refresh();
        }

        free(from) {
            for (let c = from.charCodeAt(0); c <= 90; c += 1) {
                const l = String.fromCharCode(c);
                if (!this.taken.has(l)) return l;
            }
            return null;
        }

        take(key, preferred) {
            let l = this.assigned.get(key);
            if (!l || this.taken.has(l)) {
                l = preferred && /^[D-Z]$/.test(preferred) && !this.taken.has(preferred) ? preferred : this.free('D');
            }
            if (!l) return null;
            this.taken.add(l);
            this.assigned.set(key, l);
            return l;
        }

        refresh() {
            this.taken = new Set(['C']);
            const next = new Map();
            next.set('C', { letter: 'C', kind: 'vfs', key: 'vfs', rootId: null, label: '', desc: 'Local Disk, the workspace files (Cartograph)' });
            const h = HOST();
            const hs = h && typeof h.get === 'function' ? h.get() : null;
            const keys = new Set(['vfs']);
            (hs && Array.isArray(hs.drives) ? hs.drives : []).forEach((d) => {
                const key = `host:${d.id}`;
                keys.add(key);
                const l = this.take(key, String(d.letter || '').toUpperCase());
                if (!l) return;
                next.set(l, { letter: l, kind: 'host', key, rootId: d.id, label: /^(Local Disk|Removable Disk)$/.test(d.name || '') ? '' : (d.name || ''), total: Number(d.total) || 0, free: Number(d.free) || 0, readOnly: !!d.readOnly, desc: `${d.name || 'Disk'} (this computer)` });
            });
            const ps = PS();
            const st = ps && ps.available ? ps.state() : null;
            if (st && !phoneBlocked(st)) {
                const own = root.__explorerPhoneDriveOwn || root.explorerPhoneDrive;
                const roots = st.roots;
                const ordered = roots.filter((r) => r.kind === 'internal').concat(roots.filter((r) => r.kind !== 'internal'));
                ordered.forEach((r) => {
                    const key = `phone:${ps.deviceId || ''}:${r.id}`;
                    keys.add(key);
                    let want = '';
                    try { want = own && typeof own.driveLetter === 'function' ? own.driveLetter(r.id) : ''; } catch (_) { want = ''; }
                    const l = this.take(key, want);
                    if (!l) return;
                    const name = (own && typeof own.diskLabel === 'function' ? own.diskLabel(r.id) : '') || r.name || '';
                    next.set(l, { letter: l, kind: 'phone', key, rootId: r.id, label: /^(Local Disk|Removable Disk)$/.test(name) ? '' : name, total: Number(r.total) || 0, free: Number(r.free) || 0, desc: `${name || r.id} (${(ps.deviceName || 'Phone')})` });
                });
            }
            // a letter is forgotten with its drive: a drive that comes back may take another
            [...this.assigned.keys()].forEach((k) => { if (!keys.has(k)) this.assigned.delete(k); });
            this.map = next;
        }

        get(letter) { return this.map.get(String(letter).toUpperCase()) || null; }
        letters() { return [...this.map.keys()].sort(); }
    }

    // ---- locations ---------------------------------------------------------------------------------------------
    // A location: { d (drive), segs: [{ name, nav }] }. nav is what the drive's own calls take: a VFS navPath
    // ("/Workspaces/default") or an absolute path on a phone / host drive ("/DCIM/Camera"). The root is segs [].

    const locNav = (loc) => (loc.segs.length ? loc.segs[loc.segs.length - 1].nav : '/');
    const locText = (loc) => `${loc.d.letter}:\\${loc.segs.map((s) => s.name).join('\\')}`;
    const rootLoc = (d) => ({ d, segs: [] });
    const upLoc = (loc) => ({ d: loc.d, segs: loc.segs.slice(0, -1) });
    const childLoc = (loc, entry) => ({ d: loc.d, segs: loc.segs.concat([{ name: entry.name, nav: entry.nav }]) });
    const sameLoc = (a, b) => a.d.letter === b.d.letter && locNav(a) === locNav(b);
    const joinNav = (nav, name) => `${nav === '/' ? '' : nav}/${name}`;

    function guard(res, fallback) {
        if (res && typeof res.error === 'string' && res.error) {
            const code = res.code || '';
            if (code === 'exists') throw new CmdError('A subdirectory or file already exists.');
            if (code === 'not_found') throw new CmdError('The system cannot find the file specified.');
            if (code === 'denied' || code === 'readonly') throw new CmdError('Access is denied.');
            throw new CmdError(res.error || fallback || 'Access is denied.');
        }
        return res;
    }

    function fsError(err) {
        if (err instanceof CmdError) return err;
        const code = err && err.code;
        if (code === 'exists') return new CmdError('A subdirectory or file already exists.');
        if (code === 'not_found') return new CmdError('The system cannot find the file specified.');
        if (code === 'denied' || code === 'readonly' || code === 'unsupported') return new CmdError('Access is denied.');
        // the server's own refusals (a system folder, a protected item) read as cmd's
        if (/packet handler failed|not allowed|protected|forbidden|permission|cannot be (modified|changed|deleted)/i.test(String((err && (err.message || err.error)) || ''))) return new CmdError('Access is denied.');
        return new CmdError(String((err && (err.message || err.error)) || err || 'Access is denied.'));
    }

    // ---- file systems: one set of calls per drive kind ------------------------------------------------------
    // Entries: { name, dir, size, mtime (ms, 0 unknown), hidden, system, ro, nav, raw }

    const VFS_FILE_KINDS = new Set(['user-file']);
    const vfsEditable = (e) => !!e.raw && (e.raw.targetKind === 'user-file' || e.raw.targetKind === 'vfs-folder');

    function vfsRef(e) {
        const i = e.raw;
        return { id: i.id, name: i.name, kind: i.kind, targetKind: i.targetKind, targetId: i.targetId, navPath: i.navPath || undefined, size: i.size, modifiedAt: i.modifiedAt, mimeType: i.mimeType || undefined, workspaceId: i.workspaceId };
    }

    const FS = {
        vfs: {
            async list(d, loc) {
                const nav = locNav(loc);
                const out = [];
                let offset = 0;
                for (;;) {
                    let r;
                    try { r = await VFS().listDirectory(nav, { offset, limit: 2000 }); } catch (err) { throw fsError(err); }
                    if (r && r.error) throw new CmdError('The system cannot find the path specified.');
                    const items = (r && r.items) || [];
                    items.forEach((it) => out.push({
                        name: it.name,
                        dir: it.kind === 'folder',
                        size: it.kind === 'folder' ? 0 : Number(it.size) || 0,
                        mtime: toMs(it.modifiedAt),
                        hidden: false,
                        system: false,
                        ro: !!it.protected,
                        nav: it.navPath || joinNav(nav, it.name),
                        raw: it
                    }));
                    offset += items.length;
                    if (!r || !r.hasMore || !items.length) break;
                }
                return out;
            },
            async mkdir(d, loc, name) {
                let r;
                try { r = await VFS().createFolder(locNav(loc), name); } catch (err) { throw fsError(err); }
                guard(r);
            },
            async remove(d, loc, e) {
                if (!vfsEditable(e)) throw new CmdError('Access is denied.');
                try { guard(await VFS().moveToTrash([vfsRef(e)], locNav(loc))); } catch (err) { throw fsError(err); }
            },
            async rename(d, loc, e, name) {
                if (!vfsEditable(e)) throw new CmdError('Access is denied.');
                try {
                    guard(e.dir ? await VFS().renameFolder(e.raw.targetId || e.raw.id, name) : await VFS().renameFile(e.raw.targetId || e.raw.id, name));
                } catch (err) { throw fsError(err); }
            },
            // same drive, same name: the server copies / moves; true when it did
            async transfer(d, srcLoc, e, dstLoc, newName, move) {
                if (!vfsEditable(e)) throw new CmdError('Access is denied.');
                try {
                    if (move) {
                        if (!sameLoc(srcLoc, dstLoc)) guard(await VFS().moveItems([vfsRef(e)], locNav(dstLoc)));
                        if (newName !== e.name) guard(e.dir ? await VFS().renameFolder(e.raw.targetId || e.raw.id, newName) : await VFS().renameFile(e.raw.targetId || e.raw.id, newName));
                        return true;
                    }
                    if (newName !== e.name || sameLoc(srcLoc, dstLoc)) return false;
                    guard(await VFS().copyItems([vfsRef(e)], locNav(dstLoc), {}));
                    return true;
                } catch (err) { throw fsError(err); }
            },
            async read(d, loc, e) {
                if (!e.raw || !VFS_FILE_KINDS.has(e.raw.targetKind)) throw new CmdError('Access is denied.');
                let r;
                try { r = await VFS().downloadFile(e.raw.targetId || e.raw.id); } catch (err) { throw fsError(err); }
                if (!r || !r.downloadUrl) throw new CmdError('The system cannot find the file specified.');
                const res = await fetch(r.downloadUrl, { credentials: 'same-origin' });
                if (!res.ok) throw new CmdError('The system cannot find the file specified.');
                return res.blob();
            },
            async write(d, loc, name, blob, existing) {
                const mime = blob.type || mimeFor(name);
                const b64 = await blobToBase64(blob);
                try {
                    if (existing) {
                        if (!vfsEditable(existing) || existing.dir) throw new CmdError('Access is denied.');
                        guard(await VFS().replaceFile(existing.raw.targetId || existing.raw.id, b64, mime));
                    } else {
                        guard(await VFS().uploadFile(locNav(loc), b64, name, mime));
                    }
                } catch (err) { throw fsError(err); }
            },
            async space(d) {
                try {
                    const r = await VFS().getPathStats('/');
                    const disk = r && r.stats && r.stats.disk;
                    if (disk) return { total: Number(disk.totalBytes) || 0, free: Number(disk.freeBytes) || 0 };
                } catch (_) { /* unknown */ }
                return { total: 0, free: 0 };
            }
        },

        phone: {
            async list(d, loc) {
                const ps = PS();
                if (!ps || phoneBlocked(ps.state())) throw new CmdError('The device is not ready.');
                let r;
                try { r = await ps.call('list', { root: d.rootId, path: locNav(loc) }); } catch (err) { throw fsError(err); }
                return ((r && r.entries) || []).map((e) => ({ name: e.name, dir: !!e.dir, size: e.dir ? 0 : Number(e.size) || 0, mtime: toMs(e.mtime), hidden: !!e.hidden, system: false, ro: e.writable === false, nav: e.path, raw: e }));
            },
            async mkdir(d, loc, name) {
                try { await PS().call('mkdir', { root: d.rootId, path: joinNav(locNav(loc), name) }); } catch (err) { throw fsError(err); }
            },
            // true when the entry went to Android's trash; false when it cannot go there (the caller asks)
            async remove(d, loc, e, permanent) {
                try {
                    if (!permanent) {
                        const res = await PS().call('trash', { root: d.rootId, paths: [e.nav] });
                        if (!(res || []).filter((r) => !r.trashed).length) return true;
                        return false;
                    }
                    const res = await PS().call('delete', { root: d.rootId, paths: [e.nav] });
                    if ((Array.isArray(res) ? res : []).some((r) => r && r.deleted === false)) throw new CmdError('Access is denied.');
                    return true;
                } catch (err) { throw fsError(err); }
            },
            async rename(d, loc, e, name) {
                try { await PS().call('rename', { root: d.rootId, path: e.nav, name }); } catch (err) { throw fsError(err); }
            },
            async transfer(d, srcLoc, e, dstLoc, newName, move) {
                if (newName !== e.name || dstLoc.d.letter !== srcLoc.d.letter) return false;
                try {
                    await PS().call(move ? 'move' : 'copy', { root: d.rootId, path: e.nav, toRoot: d.rootId, toDir: locNav(dstLoc), conflict: 'fail' });
                    return true;
                } catch (err) { throw fsError(err); }
            },
            async read(d, loc, e) {
                const ps = PS();
                const res = await fetch(ps.fileUrl(d.rootId, e.nav));
                if (!res.ok) throw new CmdError('The system cannot find the file specified.');
                return res.blob();
            },
            async write(d, loc, name, blob, existing) {
                const file = blob instanceof File ? blob : new File([blob], name, { type: blob.type || mimeFor(name) });
                try { await PS().write(d.rootId, locNav(loc), file, { name, conflict: existing ? 'replace' : 'fail' }); } catch (err) { throw fsError(err); }
            },
            async space(d) { return { total: d.total || 0, free: d.free || 0 }; }
        },

        host: {
            async list(d, loc) {
                const r = guard(await HOST().list(d.rootId, locNav(loc)));
                return ((r && r.entries) || []).map((e) => ({ name: e.name, dir: !!e.dir, size: e.dir ? 0 : Number(e.size) || 0, mtime: toMs(e.mtime), hidden: !!e.hidden, system: !!e.system, ro: false, nav: e.path, raw: e }));
            },
            async mkdir(d, loc, name) { guard(await HOST().mkdir(d.rootId, joinNav(locNav(loc), name))); },
            async remove(d, loc, e) {
                const r = await HOST().remove(d.rootId, [e.nav]);
                if (r && r.error) guard(r);
                if (Array.isArray(r) && r.some((x) => x && x.deleted === false)) throw new CmdError('Access is denied.');
                return true;
            },
            async rename(d, loc, e, name) { guard(await HOST().rename(d.rootId, e.nav, name)); },
            async transfer(d, srcLoc, e, dstLoc, newName, move) {
                if (newName !== e.name || dstLoc.d.letter !== srcLoc.d.letter) return false;
                const fn = move ? HOST().move : HOST().copy;
                guard(await fn(d.rootId, e.nav, d.rootId, locNav(dstLoc), 'fail'));
                return true;
            },
            async read(d, loc, e) {
                const res = await fetch(HOST().fileUrl(d.rootId, e.nav, {}));
                if (!res.ok) throw new CmdError('The system cannot find the file specified.');
                return res.blob();
            },
            async write(d, loc, name, blob, existing) {
                const file = blob instanceof File ? blob : new File([blob], name, { type: blob.type || mimeFor(name) });
                guard(await HOST().write(d.rootId, locNav(loc), file, { conflict: existing ? 'replace' : 'fail', mtime: Date.now() }));
            },
            async space(d) { return { total: d.total || 0, free: d.free || 0 }; }
        }
    };

    const fsOf = (d) => FS[d.kind];

    // ---- the screen buffer ------------------------------------------------------------------------------------
    // 300 rows of at most 80 cells; every row is a div of 16 px and a cell is 8 px, so a character is always where
    // its column says. Only a row whose cells changed is written to the page; the buffer scrolls by moving its
    // first row element to the end.

    // single-line box characters as the arms they draw (u, d, l, r)
    const BOX = {};
    [['\u2502', 'ud'], ['\u2500', 'lr'], ['\u251C', 'udr'], ['\u2514', 'ur'], ['\u250C', 'dr'], ['\u2510', 'dl'], ['\u2518', 'ul'], ['\u2524', 'udl'], ['\u252C', 'dlr'], ['\u2534', 'ulr'], ['\u253C', 'udlr']]
        .forEach(([ch, arms]) => { BOX[ch] = [...arms].map((a) => `cmd-bx-${a}`).join(' '); });

    function escHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /** A row's cells as the row element's content: plain text when ASCII, else each other glyph in a cell box. */
    function rowContent(cells) {
        let last = cells.length;
        while (last > 0 && (cells[last - 1] === ' ' || cells[last - 1] === undefined)) last -= 1;
        let plain = true;
        for (let i = 0; i < last; i += 1) {
            const c = cells[i];
            if (c === undefined || c === '' || c.length !== 1 || c.charCodeAt(0) > 0x7E) { plain = false; break; }
        }
        if (plain) return { text: cells.slice(0, last).map((c) => c || ' ').join('') };
        let html = '';
        let run = '';
        const flush = () => { if (run) { html += escHtml(run); run = ''; } };
        for (let i = 0; i < last; i += 1) {
            const c = cells[i];
            if (c === undefined) { run += ' '; continue; }
            if (c === '') continue;
            if (c.length === 1 && c.charCodeAt(0) <= 0x7E) { run += c; continue; }
            flush();
            const wide = cells[i + 1] === '';
            const box = BOX[c];
            // box-drawing characters are painted by the stylesheet so neighbouring rows join whatever the font's glyphs are
            html += box ? `<span class="cmd-c cmd-bx ${box}">${escHtml(c)}</span>` : `<span class="${wide ? 'cmd-w' : 'cmd-c'}">${escHtml(c)}</span>`;
        }
        flush();
        return { html };
    }

    class Screen {
        constructor(rowsEl, cursorEl, scroller, geo) {
            this.g = geo;
            this.rowsEl = rowsEl;
            this.cursorEl = cursorEl;
            this.scroller = scroller;
            this.lines = [];
            this.rowEls = [];
            this.shown = [];
            this.dirty = new Set();
            this.row = 0;
            this.col = 0;
            this.cursorAt = '';
            const frag = doc.createDocumentFragment();
            for (let i = 0; i < this.g.buffer; i += 1) {
                const el = doc.createElement('div');
                el.className = 'cmd-row';
                frag.appendChild(el);
                this.rowEls.push(el);
                this.lines.push([]);
                this.shown.push('');
            }
            rowsEl.insertBefore(frag, cursorEl);
        }

        paintRow(i) {
            const content = rowContent(this.lines[i]);
            const key = content.html !== undefined ? `h${content.html}` : `t${content.text}`;
            if (this.shown[i] === key) return;
            this.shown[i] = key;
            const el = this.rowEls[i];
            if (content.html !== undefined) el.innerHTML = content.html;
            else el.textContent = content.text;
        }

        flush() {
            this.dirty.forEach((i) => this.paintRow(i));
            this.dirty.clear();
            this.moveCursor(this.row, this.col);
        }

        /** The cursor's box: the underscore sits on the cell's last rows, the block (overwrite) fills it */
        moveCursor(row, col) {
            const key = `${row},${col}`;
            if (this.cursorAt === key) return;
            this.cursorAt = key;
            this.cursorEl.style.left = `${col * this.g.cw}px`;
            this.cursorEl.style.top = `${row * this.g.ch}px`;
        }

        scrollBuffer(n) {
            // rows pending a paint are written first: their indexes change with the rotation below
            this.dirty.forEach((i) => this.paintRow(i));
            this.dirty.clear();
            for (let k = 0; k < n; k += 1) {
                this.lines.shift();
                this.lines.push([]);
                this.shown.shift();
                this.shown.push('');
                const first = this.rowEls.shift();
                first.textContent = '';
                this.rowsEl.insertBefore(first, this.cursorEl);
                this.rowEls.push(first);
            }
        }

        newline() {
            this.col = 0;
            this.row += 1;
            if (this.row >= this.g.buffer) {
                this.scrollBuffer(1);
                this.row = this.g.buffer - 1;
            }
        }

        write(text) {
            const s = String(text);
            for (const ch of s) {
                if (ch === '\n') { this.newline(); continue; }
                if (ch === '\r') { this.col = 0; continue; }
                if (ch === '\x07' || ch === '\b' && this.col === 0) continue;
                if (ch === '\b') { this.col -= 1; continue; }
                if (ch === '\t') {
                    const n = 8 - (this.col % 8);
                    for (let i = 0; i < n; i += 1) this.putCell(' ', 1);
                    continue;
                }
                const w = cellWidth(ch);
                if (w === 0) {
                    const line = this.lines[this.row];
                    if (this.col > 0 && line[this.col - 1] !== undefined) { line[this.col - 1] += ch; this.dirty.add(this.row); }
                    continue;
                }
                if (ch.charCodeAt(0) < 0x20) continue;
                this.putCell(ch, w);
            }
            this.flush();
        }

        putCell(ch, w) {
            if (this.col + w > this.g.cols) this.newline();
            const line = this.lines[this.row];
            while (line.length < this.col) line.push(' ');
            line[this.col] = ch;
            if (w === 2) line[this.col + 1] = '';
            this.dirty.add(this.row);
            this.col += w;
            if (this.col >= this.g.cols) this.newline();
        }

        clear() {
            for (let i = 0; i < this.g.buffer; i += 1) {
                if (this.lines[i].length) { this.lines[i] = []; this.dirty.add(i); }
            }
            this.row = 0;
            this.col = 0;
            this.scroller.scrollTop = 0;
            this.flush();
        }

        /** Sets one row's cells (the editor's): kept, cleared or cut at the row's width */
        setRow(i, cells) {
            const next = cells.slice(0, this.g.cols);
            const cur = this.lines[i];
            if (cur.length === next.length && cur.every((c, k) => c === next[k])) return;
            this.lines[i] = next;
            this.dirty.add(i);
        }

        /** A new geometry (Properties): the buffer gains or loses rows at the top, lines are cut to the new width. */
        regeometry(g) {
            this.g = g;
            const diff = g.buffer - this.rowEls.length;
            if (diff > 0) {
                const frag = doc.createDocumentFragment();
                for (let i = 0; i < diff; i += 1) {
                    const el = doc.createElement('div');
                    el.className = 'cmd-row';
                    frag.appendChild(el);
                    this.rowEls.push(el);
                    this.lines.push([]);
                    this.shown.push('');
                }
                this.rowsEl.insertBefore(frag, this.cursorEl);
            } else if (diff < 0) {
                for (let i = 0; i < -diff; i += 1) {
                    this.rowEls.shift().remove();
                    this.lines.shift();
                    this.shown.shift();
                }
                this.row = Math.max(0, this.row + diff);
                this.dirty.clear();
            }
            this.lines.forEach((l, i) => { if (l.length > g.cols) { l.length = g.cols; this.shown[i] = ''; this.dirty.add(i); } });
            if (this.col >= g.cols) this.col = g.cols - 1;
            this.cursorAt = '';
            this.flush();
        }

        /** Brings the cursor's row into the window: its line the last one shown when it was below */
        reveal(row) {
            const sc = this.scroller;
            const top = row * this.g.ch;
            const h = sc.clientHeight || this.g.rows * this.g.ch;
            if (top < sc.scrollTop) sc.scrollTop = top;
            else if (top + this.g.ch > sc.scrollTop + h) sc.scrollTop = top + this.g.ch - h;
        }
    }

    // ---- the interpreter ----------------------------------------------------------------------------------------

    function stripQuotes(s) { return String(s).replace(/"/g, ''); }

    /** Splits a command's arguments: quoted pieces stay whole; "/x" pieces (also "/s/b") are switches */
    function parseArgs(rest) {
        const args = [];
        const sw = new Set();
        const swv = {};
        let cur = '';
        let quoted = false;
        let have = false;
        const push = () => {
            if (!have) return;
            if (!quoted && cur.length > 1 && cur[0] === '/') {
                cur.slice(1).split('/').filter(Boolean).forEach((s) => {
                    const m = /^([A-Za-z?])[:]?(.*)$/.exec(s);
                    if (m) { sw.add(lc(m[1])); swv[lc(m[1])] = m[2]; } else sw.add(lc(s));
                });
            } else args.push(cur);
            cur = ''; quoted = false; have = false;
        };
        let inQ = false;
        for (const ch of rest) {
            if (ch === '"') { inQ = !inQ; quoted = true; have = true; continue; }
            if (!inQ && /\s/.test(ch)) { push(); continue; }
            cur += ch;
            have = true;
        }
        push();
        return { args, sw, swv, rest: rest.trim() };
    }

    /** Top-level split of a command line on && || & | (outside quotes); ^ escapes the next character */
    function splitChain(line) {
        const parts = [];
        let cur = '';
        let q = false;
        for (let i = 0; i < line.length; i += 1) {
            const ch = line[i];
            if (ch === '"') { q = !q; cur += ch; continue; }
            if (!q && ch === '^' && i + 1 < line.length) { cur += line[i + 1]; i += 1; continue; }
            if (!q && (ch === '&' || ch === '|')) {
                const dbl = line[i + 1] === ch;
                parts.push({ text: cur, op: dbl ? ch + ch : ch });
                cur = '';
                if (dbl) i += 1;
                continue;
            }
            cur += ch;
        }
        parts.push({ text: cur, op: null });
        return parts;
    }

    /** Pulls "> file", ">> file", "2> nul" and "< file" out of one command */
    function extractRedirects(text) {
        const out = { text: '', stdout: null, stderr: null, stdin: null };
        let q = false;
        let i = 0;
        let keep = '';
        while (i < text.length) {
            const ch = text[i];
            if (ch === '"') { q = !q; keep += ch; i += 1; continue; }
            if (!q && (ch === '>' || ch === '<')) {
                let fd = ch === '<' ? 0 : 1;
                if (ch === '>' && /[12]$/.test(keep) && (keep.length === 1 || /\s/.test(keep[keep.length - 2]))) { fd = Number(keep[keep.length - 1]); keep = keep.slice(0, -1); }
                let append = false;
                i += 1;
                if (ch === '>' && text[i] === '>') { append = true; i += 1; }
                while (i < text.length && text[i] === ' ') i += 1;
                let target = '';
                let tq = false;
                while (i < text.length && (tq || !/[\s<>]/.test(text[i]))) {
                    if (text[i] === '"') tq = !tq; else target += text[i];
                    i += 1;
                }
                if (ch === '<') out.stdin = target;
                else if (fd === 2) out.stderr = { target, append };
                else out.stdout = { target, append };
                continue;
            }
            keep += ch;
            i += 1;
        }
        out.text = keep;
        return out;
    }

    /** Builtins a name is recognised for ("cd.." and "dir/w" are the command followed by its argument) */
    const NAMES = ['cd', 'chdir', 'cls', 'cmd', 'color', 'copy', 'date', 'del', 'dir', 'doskey', 'echo', 'erase', 'exit', 'explorer', 'find', 'help', 'hostname', 'md', 'mkdir', 'more', 'move', 'path', 'pause', 'popd', 'prompt', 'pushd', 'rd', 'rem', 'ren', 'rename', 'rmdir', 'set', 'sort', 'start', 'time', 'title', 'tree', 'type', 'ver', 'vol', 'whoami', 'chcp'];

    const HELP_LIST = [
        ['CD', 'Displays the name of or changes the current directory.'],
        ['CHCP', 'Displays or sets the active code page number.'],
        ['CHDIR', 'Displays the name of or changes the current directory.'],
        ['CLS', 'Clears the screen.'],
        ['CMD', 'Starts a new instance of the Melaton command interpreter.'],
        ['COLOR', 'Sets the default console foreground and background colors.'],
        ['COPY', 'Copies one or more files to another location.'],
        ['DATE', 'Displays or sets the date.'],
        ['DEL', 'Deletes one or more files.'],
        ['DIR', 'Displays a list of files and subdirectories in a directory.'],
        ['DOSKEY', 'Edits command lines, recalls Melaton commands, and creates macros.'],
        ['ECHO', 'Displays messages, or turns command echoing on or off.'],
        ['ERASE', 'Deletes one or more files.'],
        ['EXIT', 'Quits the CMD.EXE program (command interpreter).'],
        ['FIND', 'Searches for a text string in a file or files.'],
        ['HELP', 'Provides Help information for Melaton commands.'],
        ['MD', 'Creates a directory.'],
        ['MKDIR', 'Creates a directory.'],
        ['MORE', 'Displays output one screen at a time.'],
        ['MOVE', 'Moves one or more files from one directory to another directory.'],
        ['PATH', 'Displays or sets a search path for executable files.'],
        ['PAUSE', 'Suspends processing of a batch file and displays a message.'],
        ['POPD', 'Restores the previous value of the current directory saved by PUSHD.'],
        ['PROMPT', 'Changes the Melaton command prompt.'],
        ['PUSHD', 'Saves the current directory then changes it.'],
        ['RD', 'Removes a directory.'],
        ['REM', 'Records comments (remarks) in batch files or CONFIG.SYS.'],
        ['REN', 'Renames a file or files.'],
        ['RENAME', 'Renames a file or files.'],
        ['RMDIR', 'Removes a directory.'],
        ['SET', 'Displays, sets, or removes Melaton environment variables.'],
        ['SORT', 'Sorts input.'],
        ['START', 'Starts a separate window to run a specified program or command.'],
        ['TIME', 'Displays or sets the system time.'],
        ['TITLE', 'Sets the window title for a CMD.EXE session.'],
        ['TREE', 'Graphically displays the directory structure of a drive or path.'],
        ['TYPE', 'Displays the contents of a text file.'],
        ['VER', 'Displays the Melaton version.'],
        ['VOL', 'Displays a disk volume label and serial number.']
    ];

    const USAGE = {
        cd: 'Displays the name of or changes the current directory.\n\nCHDIR [/D] [drive:][path]\nCHDIR [..]\nCD [/D] [drive:][path]\nCD [..]\n\n  ..   Specifies that you want to change to the parent directory.\n\nType CD drive: to display the current directory in the specified drive.\nType CD without parameters to display the current drive and directory.\n\nUse the /D switch to change current drive in addition to changing current\ndirectory for a drive.',
        dir: 'Displays a list of files and subdirectories in a directory.\n\nDIR [drive:][path][filename] [/A[[:]attributes]] [/B] [/C] [/D] [/L] [/N]\n  [/O[[:]sortorder]] [/P] [/Q] [/S] [/T[[:]timefield]] [/W] [/X] [/4]\n\n  [drive:][path][filename]\n              Specifies drive, directory, and/or files to list.\n\n  /A          Displays files with specified attributes.\n  attributes   D  Directories                R  Read-only files\n               H  Hidden files               A  Files ready for archiving\n               S  System files               -  Prefix meaning not\n  /B          Uses bare format (no heading information or summary).\n  /C          Display the thousand separator in file sizes.  This is the\n              default.  Use /-C to disable display of separator.\n  /D          Same as wide but files are list sorted by column.\n  /O          List by files in sorted order.\n  sortorder    N  By name (alphabetic)       S  By size (smallest first)\n               E  By extension (alphabetic)  D  By date/time (oldest first)\n               G  Group directories first    -  Prefix to reverse order\n  /S          Displays files in specified directory and all subdirectories.\n  /W          Uses wide list format.',
        md: 'Creates a directory.\n\nMKDIR [drive:]path\nMD [drive:]path\n\nIf Command Extensions are enabled MKDIR changes as follows:\n\nMKDIR creates any intermediate directories in the path, if needed.',
        rd: 'Removes (deletes) a directory.\n\nRMDIR [/S] [/Q] [drive:]path\nRD [/S] [/Q] [drive:]path\n\n    /S      Removes all directories and files in the specified directory\n            in addition to the directory itself.  Used to remove a directory\n            tree.\n\n    /Q      Quiet mode, do not ask if ok to remove a directory tree with /S',
        del: 'Deletes one or more files.\n\nDEL [/P] [/F] [/S] [/Q] [/A[[:]attributes]] names\nERASE [/P] [/F] [/S] [/Q] [/A[[:]attributes]] names\n\n  names         Specifies a list of one or more files or directories.\n                Wildcards may be used to delete multiple files. If a\n                directory is specified, all files within the directory\n                will be deleted.\n\n  /P            Prompts for confirmation before deleting each file.\n  /F            Force deleting of read-only files.\n  /S            Delete specified files from all subdirectories.\n  /Q            Quiet mode, do not ask if ok to delete on global wildcard',
        copy: 'Copies one or more files to another location.\n\nCOPY [/V] [/N] [/Y | /-Y] source [+ source [+ ...]] [destination [/A | /B]]\n\n  source       Specifies the file or files to be copied.\n  destination  Specifies the directory and/or filename for the new file(s).\n  /Y           Suppresses prompting to confirm you want to overwrite an\n               existing destination file.\n  /-Y          Causes prompting to confirm you want to overwrite an\n               existing destination file.',
        move: 'Moves files and renames files and directories.\n\nTo move one or more files:\nMOVE [/Y | /-Y] [drive:][path]filename1[,...] destination\n\nTo rename a directory:\nMOVE [/Y | /-Y] [drive:][path]dirname1 dirname2\n\n  [drive:][path]filename1  Specifies the location and name of the file\n                           or files you want to move.\n  destination              Specifies the new location of the file.\n  /Y                       Suppresses prompting to confirm you want to\n                           overwrite an existing destination file.\n  /-Y                      Causes prompting to confirm you want to overwrite\n                           an existing destination file.',
        ren: 'Renames a file or files.\n\nRENAME [drive:][path]filename1 filename2.\nREN [drive:][path]filename1 filename2.\n\nNote that you cannot specify a new drive for your destination.',
        type: 'Displays the contents of a text file or files.\n\nTYPE [drive:][path]filename',
        tree: 'Graphically displays the folder structure of a drive or path.\n\nTREE [drive:][path] [/F] [/A]\n\n   /F   Display the names of the files in each folder.\n   /A   Use ASCII instead of extended characters.',
        echo: 'Displays messages, or turns command-echoing on or off.\n\n  ECHO [ON | OFF]\n  ECHO [message]\n\nType ECHO without parameters to display the current echo setting.',
        vol: 'Displays the disk volume label and serial number, if they exist.\n\nVOL [drive:]',
        title: 'Sets the window title for the command prompt window.\n\nTITLE [string]\n\n  string       Specifies the title for the command prompt window.',
        cls: 'Clears the screen.\n\nCLS',
        ver: 'Displays the Melaton version.\n\nVER',
        exit: 'Quits the CMD.EXE program (command interpreter) or the current batch\nscript.\n\nEXIT [/B] [exitCode]',
        start: 'Starts a separate window to run a specified program or command.\n\nSTART ["title"] [command/program] [parameters]\n\nA file or folder opens the way Explorer opens it; START with no parameters\nopens a new Command Prompt window.',
        set: 'Displays, sets, or removes Melaton environment variables.\n\nSET [variable=[string]]\nSET /A expression\nSET /P variable=[promptString]\n\nType SET without parameters to display the current environment variables.',
        prompt: 'Changes the command prompt.\n\nPROMPT [text]\n\n  text    Specifies a new command prompt.\n\nPrompt can be made up of normal characters and the following special codes:\n\n  $A   & (Ampersand)\n  $B   | (pipe)\n  $D   Current date\n  $G   > (greater-than sign)\n  $L   < (less-than sign)\n  $N   Current drive\n  $P   Current drive and path\n  $Q   = (equal sign)\n  $S   (space)\n  $T   Current time\n  $V   Melaton version number\n  $_   Carriage return and linefeed\n  $$   $ (dollar sign)',
        date: 'Displays or sets the date.\n\nDATE [/T | date]\n\nType DATE without parameters to display the current date setting and\na prompt for a new one.  Press ENTER to keep the same date.\n\nIf Command Extensions are enabled the DATE command supports\nthe /T switch which tells the command to just output the\ncurrent date, without prompting for a new date.',
        time: 'Displays or sets the system time.\n\nTIME [/T | time]\n\nType TIME with no parameters to display the current time setting and a prompt\nfor a new one.  Press ENTER to keep the same time.\n\nIf Command Extensions are enabled the TIME command supports\nthe /T switch which tells the command to just output the\ncurrent time, without prompting for a new time.'
    };

    // COLOR's 16 digits: the console theme's tokens (public/css/themes/vista/console.css)
    const COLOR_NAMES = '0123456789abcdef'.split('').map((d) => `var(--console-cmd-${d})`);

    function matchName(entries, name) {
        const l = lc(name);
        return entries.find((e) => e.name === name) || entries.find((e) => lc(e.name) === l) || null;
    }

    class Shell {
        /**
         * host: { screen, close(), openNew(), setTitle(text), setColors(bg, fg), readLine(prompt), readKey(), sleep }
         */
        constructor(host) {
            this.host = host;
            this.screen = host.screen;
            this.drives = new DriveTable();
            this.cwds = new Map();
            this.cur = 'C';
            this.cache = new Map();
            this.echo = true;
            this.promptText = '$P$G';
            this.level = 0;
            this.pushStack = [];
            this.env = new Map([
                ['ALLUSERSPROFILE', 'C:\\ProgramData'], ['COMPUTERNAME', computerName()], ['ComSpec', 'C:\\Melaton\\system32\\cmd.exe'],
                ['HOMEDRIVE', 'C:'], ['NUMBER_OF_PROCESSORS', String((root.navigator && root.navigator.hardwareConcurrency) || 1)], ['OS', 'Melaton_NT'],
                ['PATHEXT', '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC'], ['PATH', 'C:\\Melaton\\system32;C:\\Melaton'],
                ['PROCESSOR_ARCHITECTURE', 'x86'], ['SystemDrive', 'C:'], ['SystemRoot', 'C:\\Melaton'], ['USERNAME', userName()], ['windir', 'C:\\Melaton']
            ]);
            this.running = null;
        }

        // ---- output

        out(text) { this.screen.write(text); }
        line(text) { this.screen.write(`${text == null ? '' : text}\n`); }

        // ---- drives and locations

        driveChanged() {
            this.drives.refresh();
            this.cache.clear();
        }

        cwdOf(letter) {
            const d = this.drives.get(letter);
            if (!d) return null;
            let loc = this.cwds.get(d.letter);
            if (!loc) { loc = rootLoc(d); this.cwds.set(d.letter, loc); } else if (loc.d !== d) { loc = { d, segs: loc.segs }; this.cwds.set(d.letter, loc); }
            return loc;
        }

        get cwd() { return this.cwdOf(this.cur) || this.cwdOf('C'); }

        async listLoc(loc) {
            const key = `${loc.d.letter}|${locNav(loc)}`;
            let hit = this.cache.get(key);
            if (!hit) {
                hit = await fsOf(loc.d).list(loc.d, loc);
                this.cache.set(key, hit);
            }
            return hit;
        }

        invalidate() { this.cache.clear(); }

        /** Walks names down from a location: the location, or null when a name is not a folder there */
        async walk(loc, parts) {
            let at = loc;
            for (const part of parts) {
                if (part === '.') continue;
                if (part === '..') { at = upLoc(at); continue; }
                const e = matchName(await this.listLoc(at), part);
                if (!e || !e.dir) return null;
                at = childLoc(at, e);
            }
            return at;
        }

        splitPath(text) {
            let s = stripQuotes(text).trim();
            let letter = null;
            const m = /^([A-Za-z]):(.*)$/s.exec(s);
            if (m) { letter = m[1].toUpperCase(); s = m[2]; }
            const absolute = /^[\\/]/.test(s);
            const parts = s.split(/[\\/]+/).filter((p) => p !== '');
            return { letter, absolute, parts, trailing: parts.length === 0 || /[\\/]$/.test(s) };
        }

        baseOf(p) {
            const letter = p.letter || this.cur;
            const d = this.drives.get(letter);
            if (!d) throw new CmdError('The system cannot find the drive specified.');
            return { d, base: p.absolute ? rootLoc(d) : this.cwdOf(letter) };
        }

        /**
         * Resolves a path argument: { d, dir (location of the folder), pattern (the last name, or null when the
         * argument is the folder itself), wild }. Throws "cannot find the path" when its folder is missing.
         */
        async locate(text, opts) {
            const o = opts || {};
            const p = this.splitPath(text || '');
            const { d, base } = this.baseOf(p);
            if (!p.parts.length) return { d, dir: base, pattern: null, wild: false, p };
            const last = p.parts[p.parts.length - 1];
            if (hasWild(last)) {
                const dir = await this.walk(base, p.parts.slice(0, -1));
                if (!dir) throw new CmdError('The system cannot find the path specified.');
                return { d, dir, pattern: last, wild: true, p };
            }
            if (last !== '.' && last !== '..' || true) {
                const whole = await this.walk(base, p.parts);
                if (whole && !o.fileFirst) return { d, dir: whole, pattern: null, wild: false, p };
            }
            const dir = await this.walk(base, p.parts.slice(0, -1));
            if (!dir) throw new CmdError('The system cannot find the path specified.');
            return { d, dir, pattern: last, wild: false, p };
        }

        /** Entries of a located argument that match it */
        async matches(loc, flt) {
            const entries = await this.listLoc(loc.dir);
            if (loc.pattern == null) return entries.filter((e) => !flt || flt(e));
            const rx = wildRegex(loc.pattern);
            return entries.filter((e) => rx.test(e.name) && (!flt || flt(e)));
        }

        // ---- text

        pathText(loc) { return locText(loc); }

        expandPrompt() {
            const now = new Date();
            const loc = this.cwd;
            return this.promptText.replace(/\$(.)/g, (_, c) => {
                switch (c.toUpperCase()) {
                    case 'P': return locText(loc);
                    case 'G': return '>';
                    case 'L': return '<';
                    case 'B': return '|';
                    case 'A': return '&';
                    case 'Q': return '=';
                    case 'S': return ' ';
                    case 'N': return `${loc.d.letter}`;
                    case 'D': return `${DAYS[now.getDay()]} ${fmtDate(now.getTime())}`;
                    case 'T': return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}.${pad2(Math.floor(now.getMilliseconds() / 10))}`;
                    case 'V': return VERSION_TEXT;
                    case '_': return '\n';
                    case '$': return '$';
                    case 'H': return '\b';
                    default: return `$${c}`;
                }
            });
        }

        envGet(name) {
            const u = name.toUpperCase();
            if (u === 'CD') return locText(this.cwd);
            if (u === 'DATE') return `${DAYS[new Date().getDay()]} ${fmtDate(Date.now())}`;
            if (u === 'TIME') { const n = new Date(); return `${pad2(n.getHours())}:${pad2(n.getMinutes())}:${pad2(n.getSeconds())}.${pad2(Math.floor(n.getMilliseconds() / 10))}`; }
            if (u === 'RANDOM') return String(Math.floor(Math.random() * 32768));
            if (u === 'ERRORLEVEL') return String(this.level);
            if (u === 'PROMPT') return this.promptText;
            for (const [k, v] of this.env) if (k.toUpperCase() === u) return v;
            return null;
        }

        expandVars(line) {
            return line.replace(/%([^%\s]+)%/g, (all, name) => { const v = this.envGet(name); return v == null ? all : v; });
        }

        // ---- running

        /** One line from the user: variables, the chain of commands, redirects and pipes */
        async run(line) {
            const text = this.expandVars(line);
            const ac = new AbortController();
            this.running = ac;
            this.invalidate();
            try {
                const chain = splitChain(text);
                let i = 0;
                while (i < chain.length) {
                    // a pipeline: items joined with |
                    let j = i;
                    while (chain[j].op === '|') j += 1;
                    const group = chain.slice(i, j + 1).map((c) => c.text);
                    const op = chain[j].op;
                    this.level = await this.runPipeline(group, ac.signal);
                    this.invalidate();
                    if (ac.signal.aborted) break;
                    i = j + 1;
                    if (op === '&&' && this.level !== 0) { while (i < chain.length && chain[i - 1].op === '&&') i += 1; }
                    else if (op === '||' && this.level === 0) { while (i < chain.length && chain[i - 1].op === '||') i += 1; }
                }
            } finally {
                this.running = null;
            }
        }

        cancel() { if (this.running) { this.cancelled = true; this.running.abort(); } }

        async runPipeline(group, signal) {
            let stdin = null;
            let level = 0;
            for (let k = 0; k < group.length; k += 1) {
                const last = k === group.length - 1;
                const res = await this.runOne(group[k], signal, stdin, !last);
                level = res.level;
                stdin = res.captured;
                if (signal.aborted) break;
            }
            return level;
        }

        /** One command; capture: its output is returned (it feeds the next command of a pipe) */
        async runOne(raw, signal, stdinText, capture) {
            const red = extractRedirects(raw);
            let text = red.text.trim();
            if (text.startsWith('@')) text = text.slice(1).trim();
            let buf = null;
            const toFile = red.stdout && !/^nul$/i.test(red.stdout.target);
            if (capture || toFile) buf = [];
            const io = {
                signal,
                aborted: () => signal.aborted,
                stdin: stdinText,
                out: (t) => { if (red.stdout && /^nul$/i.test(red.stdout.target)) return; if (buf) buf.push(t); else this.out(t); },
                err: (t) => { if (red.stderr && /^nul$/i.test(red.stderr.target)) return; this.out(t); },
                ask: (prompt) => this.host.readLine(prompt),
                key: () => this.host.readKey()
            };
            let level = 0;
            try {
                if (red.stdin && !stdinText) {
                    const loc = await this.locate(red.stdin, { fileFirst: true });
                    const e = loc.pattern ? matchName(await this.listLoc(loc.dir), loc.pattern) : null;
                    if (!e || e.dir) throw new CmdError('The system cannot find the file specified.');
                    io.stdin = await this.readText(loc.dir, e, 8 * 1024 * 1024);
                }
                level = await this.dispatch(text, io);
            } catch (err) {
                if (err instanceof CmdError) { io.err(`${err.message}\n`); level = err.level; } else { io.err(`${(err && err.message) || err}\n`); level = 1; console.warn('[cmd]', err); }
            }
            let captured = null;
            if (buf) {
                const data = buf.join('');
                if (capture) captured = data;
                else if (toFile) {
                    try { await this.writeTarget(red.stdout.target, data, red.stdout.append); } catch (err) { this.out(`${(err instanceof CmdError ? err.message : (err && err.message)) || 'Access is denied.'}\n`); level = 1; }
                }
            }
            return { level, captured };
        }

        async writeTarget(target, data, append) {
            const loc = await this.locate(target, { fileFirst: true });
            if (!loc.pattern || loc.wild) throw new CmdError('The filename, directory name, or volume label syntax is incorrect.');
            const existing = matchName(await this.listLoc(loc.dir), loc.pattern);
            if (existing && existing.dir) throw new CmdError('Access is denied.');
            let text = data;
            if (existing && append) text = (await this.readText(loc.dir, existing, 16 * 1024 * 1024)) + data;
            await fsOf(loc.d).write(loc.d, loc.dir, existing ? existing.name : loc.pattern, new Blob([text], { type: 'text/plain' }), existing || null);
            this.invalidate();
        }

        async readText(dirLoc, entry, limit) {
            if (entry.size > (limit || 0)) throw new CmdError('Not enough storage is available to process this command.');
            const blob = await fsOf(dirLoc.d).read(dirLoc.d, dirLoc, entry);
            const buf = new Uint8Array(await blob.arrayBuffer());
            let enc = 'utf-8';
            let skip = 0;
            if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) { enc = 'utf-16le'; skip = 2; } else if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) { enc = 'utf-16be'; skip = 2; } else if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) skip = 3;
            return new TextDecoder(enc).decode(skip ? buf.subarray(skip) : buf).replace(/\r\n?/g, '\n');
        }

        async dispatch(text, io) {
            if (!text) return this.level;
            if (/^[A-Za-z]:$/.test(text)) {
                const d = this.drives.get(text[0]);
                if (!d) throw new CmdError('The system cannot find the drive specified.');
                this.cur = d.letter;
                return 0;
            }
            const m = /^([A-Za-z]+)(?=$|[\s\/\\.:"(=,;+\[\]])/.exec(text);
            const name = m ? lc(m[1]) : '';
            if (m && NAMES.includes(name)) {
                let rest = text.slice(m[1].length);
                if (name === 'echo') return this.cmdEcho(rest, io);
                if (name === 'rem') return 0;
                const a = parseArgs(rest);
                if (a.sw.has('?') && USAGE[name === 'chdir' ? 'cd' : name === 'mkdir' ? 'md' : name === 'rmdir' ? 'rd' : name === 'erase' ? 'del' : name === 'rename' ? 'ren' : name]) {
                    const key = name === 'chdir' ? 'cd' : name === 'mkdir' ? 'md' : name === 'rmdir' ? 'rd' : name === 'erase' ? 'del' : name === 'rename' ? 'ren' : name;
                    io.out(`${USAGE[key]}\n`);
                    return 0;
                }
                if (name === 'cd' || name === 'chdir' || name === 'pushd') rest = rest.replace(/^[.:;,]/, (c) => (c === '.' ? '.' : ''));
                const fn = this[`cmd_${name}`];
                if (typeof fn === 'function') return (await fn.call(this, name === 'cd' || name === 'chdir' || name === 'pushd' ? Object.assign(a, { rest: rest.trim() }) : a, io)) | 0;
            }
            // a file typed as a command opens as Explorer opens it
            const first = parseArgs(text).args[0] || text.split(/\s/)[0];
            if (first && /[\\/.:]/.test(first)) {
                try {
                    const loc = await this.locate(first, { fileFirst: true });
                    const e = loc.pattern && !loc.wild ? matchName(await this.listLoc(loc.dir), loc.pattern) : null;
                    if (e && !e.dir) { await this.openEntry(loc.dir, e); return 0; }
                } catch (_) { /* not a path: not recognized below */ }
            }
            throw new CmdError(`'${first || text}' is not recognized as an internal or external command,\noperable program or batch file.`, 9009);
        }

        async openEntry(dirLoc, e) {
            if (!root.featureLoader) throw new CmdError('Access is denied.');
            await root.featureLoader.loadFeature('explorer');
            const ex = typeof root.initializeExplorerApplet === 'function' ? root.initializeExplorerApplet() : null;
            if (!ex) throw new CmdError('Access is denied.');
            const kind = dirLoc.d.kind;
            let item;
            if (kind === 'vfs') item = e.raw;
            else if (kind === 'phone') item = { id: `phone:${dirLoc.d.rootId}:${e.nav}`, name: e.name, kind: e.dir ? 'folder' : 'file', targetKind: 'phone-entry', mimeType: (e.raw && e.raw.mime) || '', size: e.size, modifiedAt: Math.floor(e.mtime / 1000), phone: { root: dirLoc.d.rootId, path: e.nav, dir: e.dir, hidden: e.hidden, mime: (e.raw && e.raw.mime) || '' } };
            else item = { id: `host:${dirLoc.d.rootId}:${e.nav}`, name: e.name, kind: e.dir ? 'folder' : 'file', targetKind: 'host-entry', mimeType: (e.raw && e.raw.mime) || '', size: e.size, modifiedAt: Math.floor(e.mtime / 1000), downloadUrl: HOST() ? HOST().fileUrl(dirLoc.d.rootId, e.nav, {}) : '', host: { drive: dirLoc.d.rootId, path: e.nav, dir: e.dir, hidden: e.hidden, mime: (e.raw && e.raw.mime) || '' } };
            if (e.dir) {
                const nav = kind === 'vfs' ? e.nav : (root.explorerPhoneDrive && root.explorerPhoneDrive.pathFor ? root.explorerPhoneDrive.pathFor(dirLoc.d.rootId, e.nav) : null);
                if (typeof root.openExplorerApplet === 'function' && nav) root.openExplorerApplet(nav);
                return;
            }
            // the items' own folder is the place Explorer reads documents against (Notepad's save path, Recent Items)
            const here = kind === 'vfs' ? locNav(dirLoc) : null;
            const prev = ex.currentPath;
            if (here) ex.currentPath = here;
            try {
                // openItem reads the applet's status line: its window is built (hidden) when it has none yet
                if (!ex.modal && typeof ex.init === 'function') ex.init();
                await ex.openItem(item);
            } finally { if (here && ex.currentPath === here) ex.currentPath = prev; }
        }

        // ---- commands

        cmdEcho(rest, io) {
            let t = rest;
            if (/^[.:;,(\[\]\\+=]/.test(t)) { io.out(`${t.slice(1)}\n`); return 0; }
            if (/^\s*\/\?\s*$/.test(t)) { io.out(`${USAGE.echo}\n`); return 0; }
            t = t.replace(/^\s/, '');
            if (!t.trim()) { io.out(`ECHO is ${this.echo ? 'on' : 'off'}.\n`); return 0; }
            if (/^off\s*$/i.test(t)) { this.echo = false; return 0; }
            if (/^on\s*$/i.test(t)) { this.echo = true; return 0; }
            io.out(`${t}\n`);
            return 0;
        }

        cmd_cls() { this.screen.clear(); return 0; }

        cmd_ver(a, io) { io.out(`\n${VERSION_TEXT}\n`); return 0; }

        cmd_hostname(a, io) { io.out(`${this.envGet('COMPUTERNAME')}\n`); return 0; }

        cmd_whoami(a, io) { io.out(`${lc(this.envGet('COMPUTERNAME'))}\\${lc(userName())}\n`); return 0; }

        cmd_chcp(a, io) { io.out('Active code page: 437\n'); return 0; }

        cmd_path(a, io) { io.out(`PATH=${this.envGet('PATH')}\n`); return 0; }

        cmd_exit() { this.host.close(); return 0; }

        cmd_cmd(a, io) { this.host.openNew(); return 0; }

        cmd_title(a) { this.host.setTitle(a.rest || TITLE); return 0; }

        cmd_color(a, io) {
            const v = a.args[0];
            if (!v) { this.host.setColors(null, null); return 0; }
            if (!/^[0-9a-f]{1,2}$/i.test(v)) { io.out('Invalid switch - /x\n'.replace('/x', v)); return 1; }
            const s = v.padStart(2, '0');
            const bg = parseInt(s[0], 16);
            const fg = parseInt(s[1], 16);
            if (bg === fg) return 1;
            this.host.setColors(COLOR_NAMES[bg], COLOR_NAMES[fg]);
            return 0;
        }

        cmd_date(a, io) {
            const now = new Date();
            const t = `${DAYS[now.getDay()]} ${fmtDate(now.getTime())}`;
            if (a.sw.has('t')) { io.out(`${t}\n`); return 0; }
            return this.askClock(io, `The current date is: ${t}\nEnter the new date: (mm-dd-yy) `, a);
        }

        cmd_time(a, io) {
            const now = new Date();
            if (a.sw.has('t')) { io.out(`${fmtTime(now.getTime())}\n`.replace(/^0/, '')); return 0; }
            const t = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}.${pad2(Math.floor(now.getMilliseconds() / 10))}`;
            return this.askClock(io, `The current time is: ${t}\nEnter the new time: `, a);
        }

        async askClock(io, text, a) {
            if (a.args.length) { io.out('A required privilege is not held by the client.\n'); return 1; }
            const ans = await io.ask(text);
            if (ans == null || !ans.trim()) return 0;
            io.out('A required privilege is not held by the client.\n');
            return 1;
        }

        cmd_prompt(a) {
            this.promptText = a.rest ? a.rest : '$P$G';
            return 0;
        }

        async cmd_pause(a, io) {
            io.out('Press any key to continue . . . ');
            await io.key();
            io.out('\n');
            return 0;
        }

        cmd_doskey(a, io) {
            if (a.sw.has('h') && a.swv.h !== undefined || a.rest.toLowerCase().includes('/history')) {
                (this.host.history() || []).forEach((h) => io.out(`${h}\n`));
                return 0;
            }
            if (a.rest.toLowerCase().includes('/macros')) return 0;
            return 0;
        }

        cmd_help(a, io) {
            const want = lc(a.args[0] || '');
            if (want) {
                const key = { chdir: 'cd', mkdir: 'md', rmdir: 'rd', erase: 'del', rename: 'ren' }[want] || want;
                if (USAGE[key]) { io.out(`${USAGE[key]}\n`); return 0; }
                const row = HELP_LIST.find(([n]) => lc(n) === want);
                if (row) { io.out(`${row[1]}\n\n${row[0]}\n`); return 0; }
                io.out(`This command is not supported by the help utility.  Try "${want} /?".\n`);
                return 1;
            }
            io.out('For more information on a specific command, type HELP command-name\n');
            HELP_LIST.forEach(([n, d]) => io.out(`${n.padEnd(15)}${d}\n`));
            io.out('\nDrive letters in this window:\n');
            this.drives.letters().forEach((l) => io.out(`  ${l}:  ${this.drives.get(l).desc}\n`));
            io.out('\nFor more information on tools see the command-line reference in the online help.\n');
            return 0;
        }

        async cmd_vol(a, io) {
            const t = a.args[0] || '';
            if (a.sw.has('?')) return 0;
            if (t === '*' || t === '*:') {
                this.drives.letters().forEach((l) => { const d = this.drives.get(l); io.out(`${l}:  ${d.desc}\n`); });
                return 0;
            }
            const p = this.splitPath(t);
            const d = this.drives.get(p.letter || this.cur);
            if (!d) throw new CmdError('The system cannot find the drive specified.');
            this.volumeLines(d, io);
            return 0;
        }

        volumeLines(d, io) {
            io.out(` Volume in drive ${d.letter} ${d.label ? `is ${d.label}` : 'has no label.'}\n`);
            io.out(` Volume Serial Number is ${serialOf(d.key)}\n`);
        }

        async cmd_set(a, io) {
            const rest = a.rest;
            if (!rest) {
                const all = [...this.env.entries()].map(([k, v]) => `${k}=${v}`).concat([`PROMPT=${this.promptText}`]);
                all.sort((x, y) => lc(x).localeCompare(lc(y))).forEach((l) => io.out(`${l}\n`));
                return 0;
            }
            const mA = /^\/a\s+(.*)$/i.exec(rest);
            if (mA) {
                const expr = mA[1].replace(/^(\w+)\s*=\s*/, '');
                const name = (/^(\w+)\s*=/.exec(mA[1]) || [])[1];
                const subst = expr.replace(/[A-Za-z_]\w*/g, (n) => { const v = this.envGet(n); return v == null ? '0' : v; });
                if (!/^[\d\s+\-*/%()]+$/.test(subst)) throw new CmdError('Missing operator.');
                let val;
                try { val = Math.trunc(Function(`"use strict"; return (${subst});`)()); } catch (_) { throw new CmdError('Missing operator.'); }
                if (name) this.env.set(name, String(val));
                io.out(`${val}\n`);
                return 0;
            }
            const mP = /^\/p\s+([^=]+)=(.*)$/i.exec(rest);
            if (mP) {
                const ans = await io.ask(mP[2].replace(/^"|"$/g, ''));
                if (ans == null) return 1;
                this.env.set(mP[1].trim(), ans);
                return 0;
            }
            const eq = rest.indexOf('=');
            if (eq < 0) {
                const hits = [...this.env.entries()].filter(([k]) => lc(k).startsWith(lc(rest)));
                if (!hits.length) throw new CmdError(`Environment variable ${rest} not defined`);
                hits.sort((x, y) => lc(x[0]).localeCompare(lc(y[0]))).forEach(([k, v]) => io.out(`${k}=${v}\n`));
                return 0;
            }
            const name = rest.slice(0, eq).trim();
            const val = rest.slice(eq + 1);
            if (!name) throw new CmdError('The syntax of the command is incorrect.');
            if (lc(name) === 'prompt') { this.promptText = val || '$P$G'; return 0; }
            let existing = null;
            for (const k of this.env.keys()) if (lc(k) === lc(name)) existing = k;
            if (existing) this.env.delete(existing);
            if (val !== '') this.env.set(existing || name, val);
            return 0;
        }

        // ---- cd, pushd, popd, md, rd

        async changeDir(a, io, push) {
            const rest = a.rest;
            const sw = /^\/d\s*/i.exec(rest);
            const text = stripQuotes(sw ? rest.slice(sw[0].length) : rest).trim();
            if (!text) { io.out(`${locText(this.cwd)}\n`); return 0; }
            const p = this.splitPath(text);
            if (p.letter && !p.parts.length && !p.absolute) {
                const d = this.drives.get(p.letter);
                if (!d) throw new CmdError('The system cannot find the drive specified.');
                io.out(`${locText(this.cwdOf(p.letter))}\n`);
                return 0;
            }
            const { d, base } = this.baseOf(p);
            const loc = await this.walk(base, p.parts);
            if (!loc) {
                const parent = p.parts.length ? await this.walk(base, p.parts.slice(0, -1)) : null;
                const hit = parent ? matchName(await this.listLoc(parent), p.parts[p.parts.length - 1]) : null;
                if (hit && !hit.dir) throw new CmdError('The directory name is invalid.');
                throw new CmdError('The system cannot find the path specified.');
            }
            if (push) this.pushStack.push(this.cwd);
            this.cwds.set(d.letter, loc);
            if (sw || !p.letter || push) this.cur = d.letter;
            return 0;
        }

        cmd_cd(a, io) { return this.changeDir(a, io, false); }
        cmd_chdir(a, io) { return this.changeDir(a, io, false); }

        async cmd_pushd(a, io) {
            if (!a.rest) { [...this.pushStack].reverse().forEach((l) => io.out(`${locText(l)}\n`)); return 0; }
            return this.changeDir(a, io, true);
        }

        cmd_popd() {
            const loc = this.pushStack.pop();
            if (!loc) return 0;
            if (!this.drives.get(loc.d.letter)) throw new CmdError('The system cannot find the drive specified.');
            this.cwds.set(loc.d.letter, loc);
            this.cur = loc.d.letter;
            return 0;
        }

        async mkdirs(text) {
            const p = this.splitPath(text);
            const { d, base } = this.baseOf(p);
            let at = base;
            let created = false;
            for (const part of p.parts) {
                if (part === '.') continue;
                if (part === '..') { at = upLoc(at); continue; }
                const entries = await this.listLoc(at);
                const hit = matchName(entries, part);
                if (hit && hit.dir) { at = childLoc(at, hit); continue; }
                if (hit) throw new CmdError(`A subdirectory or file ${stripQuotes(text)} already exists.`);
                await fsOf(d).mkdir(d, at, part);
                this.invalidate();
                created = true;
                const after = await this.listLoc(at);
                const made = matchName(after, part);
                if (!made) throw new CmdError('Access is denied.');
                at = childLoc(at, made);
            }
            if (!created) throw new CmdError(`A subdirectory or file ${stripQuotes(text)} already exists.`);
        }

        async cmd_md(a, io) {
            if (!a.args.length) throw new CmdError('The syntax of the command is incorrect.');
            let level = 0;
            for (const t of a.args) {
                try { await this.mkdirs(t); } catch (err) { io.err(`${err.message}\n`); level = 1; }
            }
            return level;
        }
        cmd_mkdir(a, io) { return this.cmd_md(a, io); }

        async removeTree(loc, entry) {
            await fsOf(loc.d).remove(loc.d, loc, entry);
            this.invalidate();
        }

        async cmd_rd(a, io) {
            if (!a.args.length) throw new CmdError('The syntax of the command is incorrect.');
            let level = 0;
            for (const t of a.args) {
                try {
                    const p = this.splitPath(t);
                    const { base } = this.baseOf(p);
                    if (!p.parts.length) throw new CmdError('The process cannot access the file because it is being used by another process.');
                    const parent = await this.walk(base, p.parts.slice(0, -1));
                    const last = p.parts[p.parts.length - 1];
                    const hit = parent && last !== '.' && last !== '..' ? matchName(await this.listLoc(parent), last) : null;
                    if (!parent || !hit) throw new CmdError('The system cannot find the file specified.');
                    if (!hit.dir) throw new CmdError('The directory name is invalid.');
                    const target = childLoc(parent, hit);
                    const cwd = this.cwd;
                    if (sameLoc(cwd, target) || cwd.d.letter === target.d.letter && cwd.segs.length > target.segs.length && cwd.segs[target.segs.length - 1].nav === target.segs[target.segs.length - 1].nav) throw new CmdError('The process cannot access the file because it is being used by another process.');
                    if (!a.sw.has('s')) {
                        if ((await this.listLoc(target)).length) throw new CmdError('The directory is not empty.');
                    } else if (!a.sw.has('q')) {
                        const ans = await io.ask(`${locText(target)}, Are you sure (Y/N)? `);
                        if (!ans || !/^y/i.test(ans.trim())) continue;
                    }
                    await this.removeTree(parent, hit);
                } catch (err) { io.err(`${err.message}\n`); level = 1; }
            }
            return level;
        }
        cmd_rmdir(a, io) { return this.cmd_rd(a, io); }

        // ---- dir

        attrFilter(spec) {
            if (spec === undefined) return (e) => !e.hidden && !e.system;
            if (!spec) return () => true;
            const want = [];
            let neg = false;
            for (const ch of lc(spec).replace(/^:/, '')) {
                if (ch === '-') { neg = true; continue; }
                want.push({ ch, neg });
                neg = false;
            }
            const has = (e, ch) => (ch === 'd' ? e.dir : ch === 'h' ? e.hidden : ch === 's' ? e.system : ch === 'r' ? e.ro : ch === 'a' ? !e.dir : true);
            return (e) => want.every((w) => (w.neg ? !has(e, w.ch) : has(e, w.ch)));
        }

        sorter(spec) {
            const keys = [];
            const letters = spec === undefined ? 'n' : lc(spec).replace(/^:/, '') || 'n';
            let neg = false;
            for (const ch of letters) {
                if (ch === '-') { neg = true; continue; }
                keys.push({ ch, neg });
                neg = false;
            }
            const ext = (n) => { const i = n.lastIndexOf('.'); return i > 0 ? lc(n.slice(i + 1)) : ''; };
            return (x, y) => {
                for (const k of keys) {
                    let r = 0;
                    if (k.ch === 'g') r = (y.dir ? 1 : 0) - (x.dir ? 1 : 0);
                    else if (k.ch === 'n') r = lc(x.name).localeCompare(lc(y.name));
                    else if (k.ch === 'e') r = ext(x.name).localeCompare(ext(y.name)) || lc(x.name).localeCompare(lc(y.name));
                    else if (k.ch === 's') r = x.size - y.size;
                    else if (k.ch === 'd') r = (x.mtime || OPENED_AT) - (y.mtime || OPENED_AT);
                    if (r) return k.neg && k.ch !== 'g' ? -r : r;
                }
                return 0;
            };
        }

        async cmd_dir(a, io) {
            const bare = a.sw.has('b');
            const wide = a.sw.has('w') || a.sw.has('d');
            const sub = a.sw.has('s');
            const commas = !a.sw.has('-c');
            const flt = this.attrFilter(a.sw.has('a') ? a.swv.a : undefined);
            const cmp = this.sorter(a.sw.has('o') ? a.swv.o : undefined);
            const num = (n) => (commas ? fmtNum(n) : String(Math.round(n)));
            const targets = a.args.length ? a.args : [''];
            let headerFor = null;
            let grandFiles = 0;
            let grandBytes = 0;
            let grandDirs = 0;
            let any = false;
            let free = null;
            const freeOf = async (d) => { if (!free || free.letter !== d.letter) free = { letter: d.letter, ...(await fsOf(d).space(d)) }; return free.free; };
            for (const target of targets) {
                if (io.aborted()) break;
                const loc = await this.locate(target);
                if (!bare && headerFor !== loc.d.letter) {
                    this.volumeLines(loc.d, io);
                    headerFor = loc.d.letter;
                }
                let blockFiles = 0;
                let blockBytes = 0;
                let blockDirs = 0;
                let blockAny = false;
                const showDot = (loc.pattern == null || loc.pattern === '*' || loc.pattern === '*.*');
                const visit = async (dirLoc, pattern, depth) => {
                    if (io.aborted()) return;
                    const entries = depth ? await this.listLoc(dirLoc).catch(() => []) : await this.listLoc(dirLoc);
                    const rx = pattern == null ? null : wildRegex(pattern);
                    let list = entries.filter((e) => flt(e) && (!rx || rx.test(e.name)));
                    list = list.slice().sort(cmp);
                    const dots = [];
                    if (showDot && !bare && dirLoc.segs.length && flt({ dir: true, hidden: false, system: false, ro: false, name: '.' })) {
                        dots.push({ name: '.', dir: true, size: 0, mtime: dirLoc.segs.length ? 0 : 0 }, { name: '..', dir: true, size: 0, mtime: 0 });
                    }
                    const shown = dots.concat(list);
                    if (shown.length) {
                        blockAny = true;
                        any = true;
                        const files = list.filter((e) => !e.dir);
                        const dirs = list.filter((e) => e.dir);
                        if (!bare) io.out(`\n Directory of ${locText(dirLoc)}\n\n`);
                        if (bare) {
                            shown.forEach((e) => { io.out(`${sub ? `${locText(dirLoc)}${dirLoc.segs.length ? '\\' : ''}${e.name}` : e.name}\n`); });
                        } else if (wide) {
                            const w = Math.max(...shown.map((e) => cellsOf(e.dir ? `[${e.name}]` : e.name, 0).length)) + 2;
                            const per = Math.max(1, Math.floor(this.screen.g.cols / w));
                            for (let i = 0; i < shown.length; i += per) {
                                io.out(`${shown.slice(i, i + per).map((e) => { const t = e.dir ? `[${e.name}]` : e.name; return t + ' '.repeat(Math.max(0, w - cellsOf(t, 0).length)); }).join('').replace(/\s+$/, '')}\n`);
                            }
                        } else {
                            shown.forEach((e) => {
                                const when = `${fmtDate(e.mtime)}  ${fmtTime(e.mtime)}`;
                                const mid = e.dir ? '    <DIR>          ' : ` ${num(e.size).padStart(17)} `;
                                io.out(`${when}${mid}${e.name}\n`);
                            });
                        }
                        blockFiles += files.length;
                        blockBytes += files.reduce((n, e) => n + e.size, 0);
                        blockDirs += dirs.length + dots.length;
                        if (!bare && sub) io.out(`${String(files.length).padStart(16)} File(s) ${num(files.reduce((n, e) => n + e.size, 0)).padStart(14)} bytes\n`);
                    }
                    if (sub) {
                        const subs = entries.filter((e) => e.dir && flt({ ...e, dir: true, hidden: false, system: false })).sort(cmp);
                        for (const s of subs) await visit(childLoc(dirLoc, s), pattern, depth + 1);
                    }
                };
                await visit(loc.dir, loc.pattern, 0);
                if (!blockAny && !sub && !bare) io.out(`\n Directory of ${locText(loc.dir)}\n\nFile Not Found\n`);
                if (!blockAny && bare) { io.err('File Not Found\n'); }
                grandFiles += blockFiles;
                grandBytes += blockBytes;
                grandDirs += blockDirs;
                if (!bare && !sub && blockAny) {
                    io.out(`${String(blockFiles).padStart(16)} File(s) ${num(blockBytes).padStart(14)} bytes\n`);
                    io.out(`${String(blockDirs).padStart(16)} Dir(s) ${num(await freeOf(loc.d)).padStart(15)} bytes free\n`);
                }
            }
            if (!bare && a.sw.has('s')) {
                if (any) {
                    io.out('\n     Total Files Listed:\n');
                    io.out(`${String(grandFiles).padStart(16)} File(s) ${num(grandBytes).padStart(14)} bytes\n`);
                    io.out(`${String(grandDirs).padStart(16)} Dir(s) ${num(free ? free.free : 0).padStart(15)} bytes free\n`);
                } else io.out('File Not Found\n');
            }
            return any ? 0 : 1;
        }

        // ---- tree

        async cmd_tree(a, io) {
            const files = a.sw.has('f');
            const ascii = a.sw.has('a');
            const t = a.args[0] || '';
            const loc = await this.locate(t);
            if (loc.pattern) throw new CmdError('Invalid path - ' + stripQuotes(t));
            const G = ascii ? { tee: '+---', last: '\\---', bar: '|   ' } : { tee: '\u251C\u2500\u2500\u2500', last: '\u2514\u2500\u2500\u2500', bar: '\u2502   ' };
            io.out(`Folder PATH listing${loc.d.label ? ` for volume ${loc.d.label}` : ''}\n`);
            io.out(`Volume serial number is ${serialOf(loc.d.key)}\n`);
            io.out(`${loc.dir.segs.length ? locText(loc.dir).toUpperCase() : `${loc.d.letter}:.`}\n`);
            let any = false;
            const walk = async (dirLoc, prefix, top) => {
                if (io.aborted()) return;
                // a folder the drive cannot list is left out, as tree does
                const entries = (await this.listLoc(dirLoc).catch(() => [])).filter((e) => !e.hidden && !e.system);
                const dirs = entries.filter((e) => e.dir).sort((x, y) => lc(x.name).localeCompare(lc(y.name)));
                const fl = entries.filter((e) => !e.dir).sort((x, y) => lc(x.name).localeCompare(lc(y.name)));
                if (files) {
                    const pre = prefix + (dirs.length ? G.bar : '    ');
                    fl.forEach((e) => io.out(`${pre}${e.name}\n`));
                    if (fl.length) io.out(`${pre}\n`);
                }
                for (let i = 0; i < dirs.length; i += 1) {
                    const last = i === dirs.length - 1;
                    any = true;
                    io.out(`${prefix}${last ? G.last : G.tee}${dirs[i].name}\n`);
                    await walk(childLoc(dirLoc, dirs[i]), prefix + (last ? '    ' : G.bar), false);
                }
                void top;
            };
            await walk(loc.dir, '', true);
            if (!any && !files) io.out('No subfolders exist \n\n');
            return 0;
        }

        // ---- type, copy, move, del, ren

        async cmd_type(a, io) {
            if (!a.args.length) throw new CmdError('The syntax of the command is incorrect.');
            let level = 0;
            const many = a.args.length > 1;
            for (const t of a.args) {
                if (io.aborted()) break;
                try {
                    const loc = await this.locate(t, { fileFirst: true });
                    if (!loc.pattern) throw new CmdError('Access is denied.');
                    const list = (await this.matches(loc, (e) => !e.dir)).sort((x, y) => lc(x.name).localeCompare(lc(y.name)));
                    if (!list.length) throw new CmdError('The system cannot find the file specified.');
                    for (const e of list) {
                        if (io.aborted()) break;
                        if (many || loc.wild) io.out(`\n${e.name}\n\n\n`);
                        const text = (await this.readText(loc.dir, e, 4 * 1024 * 1024)).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
                        // big files go to the screen in parts so Ctrl+C can stop them
                        for (let i = 0; i < text.length; i += 16000) {
                            if (io.aborted()) break;
                            io.out(text.slice(i, i + 16000));
                            if (i + 16000 < text.length) await nextTick();
                        }
                    }
                } catch (err) { io.err(`${err.message}\n`); level = 1; }
            }
            return level;
        }

        /** Where a copy / move target goes: { dirLoc, name (null: keep each file's name) } */
        async target(text, multiple) {
            const loc = await this.locate(text, { fileFirst: false });
            if (loc.pattern == null) return { dirLoc: loc.dir, name: null };
            if (loc.wild) throw new CmdError('The filename, directory name, or volume label syntax is incorrect.');
            if (multiple) return { dirLoc: loc.dir, name: loc.pattern, mustBeDir: true };
            return { dirLoc: loc.dir, name: loc.pattern };
        }

        async askOverwrite(io, state, path) {
            if (state.all) return true;
            const ans = await io.ask(`Overwrite ${path}? (Yes/No/All): `);
            const c = (ans || '').trim().toLowerCase();
            if (c.startsWith('a')) { state.all = true; return true; }
            return c.startsWith('y');
        }

        async transferFile(srcLoc, e, dstLoc, newName, move, io, state) {
            const same = srcLoc.d.letter === dstLoc.d.letter;
            const existing = matchName(await this.listLoc(dstLoc), newName);
            if (existing) {
                if (existing.dir) throw new CmdError('Access is denied.');
                if (same && locNav(srcLoc) === locNav(dstLoc) && lc(existing.name) === lc(e.name)) throw new CmdError(move ? 'A duplicate file name exists, or the file\ncannot be found.' : 'The file cannot be copied onto itself.');
                if (!(state.yes || await this.askOverwrite(io, state, `${locText(dstLoc)}${dstLoc.segs.length ? '\\' : ''}${existing.name}`))) return false;
                if (same && fsOf(dstLoc.d) && existing) {
                    // the server's copy / move will not overwrite: the old file goes first
                    await fsOf(dstLoc.d).remove(dstLoc.d, dstLoc, existing);
                    this.invalidate();
                }
            }
            if (same && !existing || same && existing) {
                const done = await fsOf(srcLoc.d).transfer(srcLoc.d, srcLoc, e, dstLoc, newName, move);
                if (done) { this.invalidate(); return true; }
            }
            if (e.dir) throw new CmdError('Access is denied.');
            const blob = await fsOf(srcLoc.d).read(srcLoc.d, srcLoc, e);
            const fresh = existing && !same ? existing : null;
            await fsOf(dstLoc.d).write(dstLoc.d, dstLoc, newName, blob, fresh);
            if (move) await fsOf(srcLoc.d).remove(srcLoc.d, srcLoc, e);
            this.invalidate();
            return true;
        }

        async copyMove(a, io, move) {
            if (!a.args.length) throw new CmdError('The syntax of the command is incorrect.');
            const srcText = a.args[0];
            if (/\+/.test(srcText)) throw new CmdError('The syntax of the command is incorrect.');
            const state = { all: false, yes: a.sw.has('y') };
            const src = await this.locate(srcText, { fileFirst: !move });
            let list;
            let srcDir = src.dir;
            if (src.pattern == null) {
                if (move) {
                    // move a directory: rename / move it as itself
                    const parent = src.dir.segs.length ? upLoc(src.dir) : null;
                    const me = parent ? matchName(await this.listLoc(parent), src.dir.segs[src.dir.segs.length - 1].name) : null;
                    if (!parent || !me) throw new CmdError('The system cannot find the file specified.');
                    list = [me];
                    srcDir = parent;
                } else list = (await this.matches(src, (e) => !e.dir));
            } else list = await this.matches(src, move ? null : (e) => !e.dir);
            if (!list.length) throw new CmdError('The system cannot find the file specified.');
            let dstSpec = a.args[1];
            const tgt = dstSpec ? await this.target(dstSpec, list.length > 1) : { dirLoc: this.cwd, name: null };
            if (tgt.mustBeDir && tgt.name) throw new CmdError('The syntax of the command is incorrect.');
            let count = 0;
            let dirs = 0;
            let level = 0;
            for (const e of list) {
                if (io.aborted()) break;
                try {
                    const name = tgt.name || e.name;
                    if (!tgt.name && sameLoc(srcDir, tgt.dirLoc)) throw new CmdError(move ? 'A duplicate file name exists, or the file\ncannot be found.' : 'The file cannot be copied onto itself.');
                    if (await this.transferFile(srcDir, e, tgt.dirLoc, name, move, io, state)) { count += 1; if (e.dir) dirs += 1; }
                } catch (err) { io.err(`${err.message}\n`); level = 1; }
            }
            if (move && dirs === count && dirs) io.out(`        ${dirs} dir(s) moved.\n`);
            else io.out(`${String(count).padStart(9)} file(s) ${move ? 'moved' : 'copied'}.\n`);
            return level;
        }

        cmd_copy(a, io) { return this.copyMove(a, io, false); }
        cmd_move(a, io) { return this.copyMove(a, io, true); }

        async cmd_del(a, io) {
            if (!a.args.length) throw new CmdError('The syntax of the command is incorrect.');
            let level = 0;
            const flt = this.attrFilter(a.sw.has('a') ? a.swv.a || '' : '');
            for (const t of a.args) {
                if (io.aborted()) break;
                try {
                    const loc = await this.locate(t, { fileFirst: true });
                    const allFiles = loc.pattern == null || loc.pattern === '*' || loc.pattern === '*.*';
                    let victims = [];
                    const collect = async (dirLoc, pattern) => {
                        const entries = await this.listLoc(dirLoc);
                        const rx = pattern == null ? null : wildRegex(pattern);
                        entries.filter((e) => !e.dir && flt(e) && (!rx || rx.test(e.name))).forEach((e) => victims.push({ dirLoc, e }));
                        if (a.sw.has('s')) for (const s of entries.filter((e) => e.dir)) await collect(childLoc(dirLoc, s), pattern);
                    };
                    await collect(loc.dir, loc.pattern);
                    if (!victims.length) {
                        const shown = loc.pattern ? `${locText(loc.dir)}${loc.dir.segs.length ? '\\' : ''}${loc.pattern}` : locText(loc.dir);
                        io.err(`Could Not Find ${shown}\n`);
                        level = 1;
                        continue;
                    }
                    if (allFiles && !a.sw.has('q') && !a.sw.has('p')) {
                        const ans = await io.ask(`${locText(loc.dir)}${loc.dir.segs.length ? '\\' : ''}${loc.pattern || '*'}, Are you sure (Y/N)? `);
                        if (!ans || !/^y/i.test(ans.trim())) continue;
                    }
                    for (const v of victims) {
                        if (io.aborted()) break;
                        const full = `${locText(v.dirLoc)}${v.dirLoc.segs.length ? '\\' : ''}${v.e.name}`;
                        if (a.sw.has('p')) {
                            const ans = await io.ask(`${full}, Delete (Y/N)? `);
                            if (!ans || !/^y/i.test(ans.trim())) continue;
                        }
                        if (v.e.ro && !a.sw.has('f')) { io.err(`${full}\nAccess is denied.\n`); level = 1; continue; }
                        await this.deleteOne(v.dirLoc, v.e, io, a);
                        if (a.sw.has('s')) io.out(`Deleted file - ${full}\n`);
                    }
                } catch (err) { io.err(`${err.message}\n`); level = 1; }
            }
            return level;
        }
        cmd_erase(a, io) { return this.cmd_del(a, io); }

        async deleteOne(dirLoc, e, io, a) {
            const fs = fsOf(dirLoc.d);
            if (dirLoc.d.kind === 'phone') {
                const ok = await fs.remove(dirLoc.d, dirLoc, e, false);
                if (!ok) {
                    const ans = a.sw.has('q') ? 'y' : await io.ask(`${e.name} cannot go to the Phone trash. Delete permanently (Y/N)? `);
                    if (ans && /^y/i.test(ans.trim())) await fs.remove(dirLoc.d, dirLoc, e, true);
                }
            } else await fs.remove(dirLoc.d, dirLoc, e);
            this.invalidate();
        }

        async cmd_ren(a, io) {
            if (a.args.length < 2) throw new CmdError('The syntax of the command is incorrect.');
            const loc = await this.locate(a.args[0], { fileFirst: true });
            const to = stripQuotes(a.args[1]);
            if (/[\\/:]/.test(to)) throw new CmdError('The syntax of the command is incorrect.');
            const list = loc.pattern == null ? [] : await this.matches(loc);
            if (!list.length) throw new CmdError('The system cannot find the file specified.');
            let level = 0;
            for (const e of list) {
                if (io.aborted()) break;
                const name = hasWild(to) ? this.mapWild(e.name, to) : to;
                try {
                    const existing = matchName(await this.listLoc(loc.dir), name);
                    if (existing && existing !== e) throw new CmdError('A duplicate file name exists, or the file\ncannot be found.');
                    if (name === e.name) continue;
                    await fsOf(loc.d).rename(loc.d, loc.dir, e, name);
                    this.invalidate();
                } catch (err) { io.err(`${err.message}\n`); level = 1; }
            }
            return level;
        }
        cmd_rename(a, io) { return this.cmd_ren(a, io); }

        /** REN a*.txt b*.bak: each * in the new name stands for the old name's base (or extension) */
        mapWild(oldName, pattern) {
            const dot = (n) => { const i = n.lastIndexOf('.'); return i > 0 ? [n.slice(0, i), n.slice(i + 1)] : [n, '']; };
            const [ob, oe] = dot(oldName);
            const di = pattern.lastIndexOf('.');
            const pb = di >= 0 ? pattern.slice(0, di) : pattern;
            const pe = di >= 0 ? pattern.slice(di + 1) : null;
            const fill = (p, o) => { let k = 0; return p.replace(/[*?]/g, (c) => { if (c === '*') return o.slice(k); const ch = o[k] || ''; k += 1; return ch; }); };
            const nb = fill(pb, ob);
            const ne = pe == null ? '' : fill(pe, oe);
            return pe == null || ne === '' ? nb : `${nb}.${ne}`;
        }

        // ---- find, sort, more

        async cmd_find(a, io) {
            const needle = a.args[0];
            if (needle == null) throw new CmdError('FIND: Parameter format not correct');
            const ci = a.sw.has('i');
            const inv = a.sw.has('v');
            const count = a.sw.has('c');
            const nums = a.sw.has('n');
            const test = (l) => (ci ? lc(l).includes(lc(needle)) : l.includes(needle)) !== inv;
            const scan = (lines, label) => {
                const hits = [];
                lines.forEach((l, i) => { if (test(l)) hits.push(nums ? `[${i + 1}]${l}` : l); });
                if (label != null) io.out(`\n---------- ${label}${count ? `: ${hits.length}` : ''}\n`);
                else if (count) { io.out(`${hits.length}\n`); return; }
                if (!count) hits.forEach((h) => io.out(`${h}\n`));
            };
            const files = a.args.slice(1);
            if (!files.length) {
                if (io.stdin == null) throw new CmdError('FIND: Parameter format not correct');
                scan(io.stdin.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === '')), null);
                return 0;
            }
            for (const f of files) {
                try {
                    const loc = await this.locate(f, { fileFirst: true });
                    const list = loc.pattern ? await this.matches(loc, (e) => !e.dir) : [];
                    if (!list.length) throw new CmdError(`File not found - ${f.toUpperCase()}`);
                    for (const e of list) scan((await this.readText(loc.dir, e, 8 * 1024 * 1024)).split('\n'), e.name.toUpperCase());
                } catch (err) { io.err(`${err.message}\n`); }
            }
            return 0;
        }

        cmd_sort(a, io) {
            const text = io.stdin == null ? '' : io.stdin;
            const lines = text.split('\n');
            if (lines[lines.length - 1] === '') lines.pop();
            lines.sort((x, y) => lc(x).localeCompare(lc(y)));
            if (a.sw.has('r')) lines.reverse();
            lines.forEach((l) => io.out(`${l}\n`));
            return 0;
        }

        async cmd_more(a, io) {
            if (io.stdin != null && !a.args.length) { io.out(io.stdin); return 0; }
            return this.cmd_type(a, io);
        }

        // ---- start, explorer

        async cmd_start(a, io) {
            const args = a.args.slice();
            if (args.length && /^".*"$/.test(a.rest.trim().split(/\s/)[0] || '') && args.length > 1) args.shift();
            if (!args.length) { this.host.openNew(); return 0; }
            const t = args[0];
            if (lc(t) === 'cmd' || lc(t) === 'cmd.exe') { this.host.openNew(); return 0; }
            const loc = await this.locate(t, { fileFirst: true }).catch(() => { throw new CmdError(`The system cannot find the file ${stripQuotes(t)}.`); });
            if (loc.pattern == null) { await this.openFolder(loc.dir); return 0; }
            const e = loc.wild ? null : matchName(await this.listLoc(loc.dir), loc.pattern);
            if (!e) throw new CmdError(`The system cannot find the file ${stripQuotes(t)}.`);
            if (e.dir) await this.openFolder(childLoc(loc.dir, e)); else await this.openEntry(loc.dir, e);
            return 0;
        }

        async openFolder(loc) {
            if (!root.featureLoader) return;
            await root.featureLoader.loadFeature('explorer');
            const pd = root.explorerPhoneDrive;
            const nav = loc.d.kind === 'vfs' ? locNav(loc) : (pd && pd.pathFor ? pd.pathFor(loc.d.rootId, locNav(loc)) : null);
            if (nav && typeof root.openExplorerApplet === 'function') root.openExplorerApplet(nav);
        }

        async cmd_explorer(a, io) {
            if (a.args.length) {
                const loc = await this.locate(a.args[0]);
                if (loc.pattern) throw new CmdError('The system cannot find the path specified.');
                await this.openFolder(loc.dir);
            } else await this.openFolder(this.cwd);
            return 0;
        }
    }

    // ---- the window and its line editor -----------------------------------------------------------------------

    function call(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    let seq = 0;
    let opened = 0;

    class CmdWindow {
        constructor() {
            this.id = ++seq;
            this.ac = new AbortController();
            this.closed = false;
            this.edit = null;
            this.keyWaiter = null;
            this.queue = [];
            this.pre = '';
            this.hist = [];
            this.histAt = 0;
            this.comp = null;
            this.cfg = PROPS().windowConfig();
            this.geo = PROPS().geometry(this.cfg);
            this.insert = this.cfg.insertMode;
            this.build();
            this.screen = new Screen(this.rowsEl, this.cursorEl, this.scroller, this.geo);
            const self = this;
            this.shell = new Shell({
                screen: this.screen,
                close: () => this.close(),
                openNew: () => { void openCommandPrompt(); },
                setTitle: (t) => this.setTitle(t),
                setColors: (bg, fg) => this.setColors(bg, fg),
                readLine: (prompt) => self.readLine(prompt, false),
                readKey: () => self.readKey(),
                history: () => self.hist
            });
            this.wire();
            this.applyConfig(this.cfg);
        }

        build() {
            const w = call('desktopAppCreateWindow', {
                id: `melatonCmdModal${this.id}`,
                identifier: 'melatonCmd',
                title: TITLE,
                icon16: ICON16,
                taskbarIcon: ICON32,
                className: 'cmd-window',
                fixed: true,
                minimize: true
            });
            const m = w.modal;
            // the window's size is its client (the settings' columns and the scroll bar, rows) in the glass frame (applyConfig sets it)
            // Vista's console has a maximize box; this one stays at 80 columns, so it is drawn disabled
            const min = m.querySelector('.modal-window-controls .minimize-btn');
            if (min) {
                const max = doc.createElement('button');
                max.type = 'button';
                max.className = 'btn-secondary btn-small cmd-max-btn';
                max.title = 'Maximize';
                max.disabled = true;
                max.innerHTML = '<i class="fa-regular fa-window-maximize"></i>';
                min.after(max);
            }
            w.content.classList.add('cmd-client');
            w.content.innerHTML = `<div class="cmd-screen" tabindex="0" role="textbox" aria-multiline="true" aria-label="${TITLE}"><div class="cmd-rows"><div class="cmd-cursor"></div></div></div>`;
            this.modal = m;
            this.closeBtn = w.close;
            this.scroller = w.content.querySelector('.cmd-screen');
            this.rowsEl = w.content.querySelector('.cmd-rows');
            this.cursorEl = w.content.querySelector('.cmd-cursor');
            this.titleEl = w.titleText;
        }

        setTitle(text) {
            if (this.titleEl) this.titleEl.textContent = text;
            this.modal.setAttribute('aria-label', text);
        }

        setColors(bg, fg) {
            if (!bg) { this.applyColors(); return; }
            if (bg) { this.scroller.style.setProperty('--cmd-bg', bg); this.scroller.style.setProperty('--cmd-fg', fg); } else { this.scroller.style.removeProperty('--cmd-bg'); this.scroller.style.removeProperty('--cmd-fg'); }
        }

        /** The settings' colours on the window: Screen Text / Background, and a changed palette for COLOR's digits (Properties). */
        applyColors() {
            const P = PROPS();
            const sc = this.scroller;
            const cfg = this.cfg;
            for (let i = 0; i < 16; i += 1) {
                const name = `--console-cmd-${i.toString(16)}`;
                if (cfg.palette) this.modal.style.setProperty(name, `rgb(${cfg.palette[i][0]} ${cfg.palette[i][1]} ${cfg.palette[i][2]})`);
                else this.modal.style.removeProperty(name);
            }
            sc.style.setProperty('--cmd-bg', P.colorCss(cfg, 'screenBg'));
            sc.style.setProperty('--cmd-fg', P.colorCss(cfg, 'screenText'));
        }

        /** Puts a settings object on the window: cell, window, buffer, cursor, colours, edit modes, position. */
        applyConfig(cfg) {
            const P = PROPS();
            const m = this.modal;
            const sc = this.scroller;
            const g = P.geometry(cfg);
            this.cfg = cfg;
            this.geo = g;
            m.dataset.cmdGeo = g.hbar ? 'h' : '1';
            m.dataset.windowDefaultWidth = String(g.screenW + g.frameW);
            m.dataset.windowDefaultHeight = String(g.screenH + g.frameH);
            m.style.setProperty('--cmd-cw', `${g.cw}px`);
            m.style.setProperty('--cmd-ch', `${g.ch}px`);
            m.style.setProperty('--cmd-cols', String(g.cols));
            m.style.setProperty('--cmd-buffer', String(g.buffer));
            m.style.setProperty('--cmd-win-w', `${g.screenW}px`);
            m.style.setProperty('--cmd-win-h', `${g.screenH}px`);
            sc.dataset.cmdCursor = cfg.cursorSize;
            sc.style.setProperty('--cmd-cursor-pct', `${P.cursorPercent(cfg)}%`);
            sc.toggleAttribute('data-cmd-bold', cfg.bold);
            sc.classList.toggle('cmdp-noquick', !cfg.quickEdit);
            this.insert = cfg.insertMode;
            if (this.hist.length > cfg.historySize) this.hist.splice(0, this.hist.length - cfg.historySize);
            this.screen.regeometry(g);
            this.applyColors();
            // Raster Fonts are the VM's own pixel fonts: face and size from the cell; Lucida Console is fitted to it (fit())
            const raster = P.fontStyle(cfg);
            if (raster) {
                sc.style.setProperty('--console-font', raster.family);
                sc.style.setProperty('--cmd-font-size', raster.size);
                sc.style.setProperty('--cmd-spacing', '0px');
            } else sc.style.removeProperty('--console-font');
            this.advance = 0;
            this.refit = false;
            if (this.fitted && !raster) this.fit();
            if (this.placed && !cfg.autoPosition) call('setModalOffsetsFromViewportTopLeft', m, cfg.left, cfg.top);
            if (this.edit) this.render();
            this.screen.reveal(this.screen.row);
        }

        wire() {
            const signal = this.ac.signal;
            this.closeBtn.addEventListener('click', () => this.close());
            const sc = this.scroller;
            sc.addEventListener('keydown', (ev) => this.onKey(ev));
            sc.addEventListener('focus', () => sc.classList.add('cmd-focused'));
            sc.addEventListener('blur', () => sc.classList.remove('cmd-focused'));
            sc.addEventListener('mouseup', () => {
                const sel = this.selectedText();
                if (!sel) sc.focus({ preventScroll: true });
            });
            sc.addEventListener('contextmenu', (ev) => {
                // no native menu: QuickEdit, as Vista's console: a selection is copied, else the clipboard is pasted
                ev.preventDefault();
                // QuickEdit Mode off (Properties): the right button copies and pastes nothing
                if (!this.cfg.quickEdit) { sc.focus({ preventScroll: true }); return; }
                const sel = this.selectedText();
                if (sel) { this.copyText(sel); this.clearSelection(); } else void this.pasteClipboard();
                sc.focus({ preventScroll: true });
            });
            sc.addEventListener('copy', (ev) => {
                const sel = this.selectedText();
                if (!sel || !ev.clipboardData) return;
                ev.clipboardData.setData('text/plain', sel);
                ev.preventDefault();
            });
            sc.addEventListener('paste', (ev) => {
                ev.preventDefault();
                const text = ev.clipboardData ? ev.clipboardData.getData('text/plain') : '';
                if (text) this.paste(text);
            });
            // drives come and go: the phone's storage and the host's disks tell it (nothing is polled)
            const refresh = () => this.shell.driveChanged();
            root.addEventListener('dreamosdrives', refresh, { signal });
            const ps = PS();
            if (ps && typeof ps.on === 'function') {
                const offs = [ps.on('config', refresh), ps.on('state', refresh)];
                signal.addEventListener('abort', () => offs.forEach((off) => { try { off(); } catch (_) { /* gone */ } }), { once: true });
                if (ps.available && !ps.state() && typeof ps.hello === 'function') ps.hello().catch(() => { /* the drive stays out */ });
            }
            if (appScopeSignal) appScopeSignal.addEventListener('abort', () => this.close(), { once: true, signal });
            // the caption icon, Alt+Space and the Edit modes: the system menu with Edit, Defaults and Properties (cmdProperties.js)
            PROPS().bind(this);
        }

        // ---- the selection and the clipboard

        selectedText() {
            const s = root.getSelection && root.getSelection();
            if (!s || s.isCollapsed || !s.rangeCount) return '';
            const r = s.getRangeAt(0);
            if (!this.rowsEl.contains(r.commonAncestorContainer)) return '';
            return s.toString().split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
        }

        clearSelection() {
            const s = root.getSelection && root.getSelection();
            if (s && s.rangeCount && this.rowsEl.contains(s.getRangeAt(0).commonAncestorContainer)) s.removeAllRanges();
        }

        copyText(text) {
            if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(text).catch(() => { /* blocked */ });
        }

        async pasteClipboard() {
            try {
                const text = await root.navigator.clipboard.readText();
                if (text) this.paste(text);
            } catch (_) { /* the browser did not allow reading */ }
        }

        paste(raw) {
            const lines = String(raw).replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\x00-\x09\x0B-\x1F]/g, '').split('\n');
            const first = lines.shift();
            if (this.edit) {
                this.insertText(first);
                if (lines.length) {
                    const rest = lines.pop();
                    this.submit();
                    this.queue.push(...lines);
                    this.pre = rest;
                }
            } else {
                this.pre += first;
                if (lines.length) { this.queue.push(this.pre, ...lines.slice(0, -1)); this.pre = lines[lines.length - 1]; }
            }
        }

        // ---- the line editor

        /** Reads one line at the cursor; null on Ctrl+C. history: Up / Down / Tab work on the command line only. */
        readLine(prompt, history) {
            if (prompt) this.screen.write(prompt);
            return new Promise((resolve) => {
                const e = { text: '', pos: 0, row: this.screen.row, col: this.screen.col, prevEnd: this.screen.row, resolve, history: !!history };
                this.edit = e;
                this.histAt = this.hist.length;
                this.comp = null;
                if (this.queue.length) {
                    e.text = this.queue.shift();
                    e.pos = e.text.length;
                    this.render();
                    this.submit();
                    return;
                }
                if (this.pre) { e.text = this.pre; e.pos = e.text.length; this.pre = ''; }
                this.render();
            });
        }

        readKey() {
            return new Promise((resolve) => { this.keyWaiter = resolve; });
        }

        render() {
            const e = this.edit;
            const s = this.screen;
            if (!e) return;
            const cells = cellsOf(e.text, e.col);
            const total = e.col + cells.length;
            let endRow = e.row + Math.floor(total / this.geo.cols);
            if (endRow >= this.geo.buffer) {
                const n = endRow - this.geo.buffer + 1;
                s.scrollBuffer(n);
                e.row -= n;
                e.prevEnd -= n;
                endRow -= n;
            }
            const lastRow = Math.max(endRow, e.prevEnd);
            let k = 0;
            for (let r = e.row; r <= lastRow; r += 1) {
                const start = r === e.row ? e.col : 0;
                const row = r === e.row ? s.lines[r].slice(0, e.col) : [];
                while (row.length < start) row.push(' ');
                const take = Math.max(0, Math.min(this.geo.cols - start, cells.length - k));
                s.setRow(r, row.concat(cells.slice(k, k + take)));
                k += take;
            }
            e.prevEnd = endRow;
            const idx = e.col + cellsOf(e.text.slice(0, e.pos), e.col).length;
            const crow = e.row + Math.floor(idx / this.geo.cols);
            s.dirty.forEach((i) => s.paintRow(i));
            s.dirty.clear();
            s.moveCursor(crow, idx % this.geo.cols);
            s.reveal(crow);
            this.scroller.classList.toggle('cmd-overwrite', !this.insert);
        }

        insertText(text) {
            const e = this.edit;
            if (!e || !text) return;
            if (this.insert) e.text = e.text.slice(0, e.pos) + text + e.text.slice(e.pos);
            else e.text = e.text.slice(0, e.pos) + text + e.text.slice(e.pos + [...text].length);
            e.pos += text.length;
            this.comp = null;
            this.render();
        }

        submit() {
            const e = this.edit;
            if (!e) return;
            const s = this.screen;
            this.edit = null;
            const cells = cellsOf(e.text, e.col);
            const total = e.col + cells.length;
            s.row = e.row + Math.floor(total / this.geo.cols);
            s.col = total % this.geo.cols;
            s.newline();
            s.flush();
            s.reveal(s.row);
            if (e.history && e.text.trim()) {
                // Discard Old Duplicates (Properties): the same command again leaves one entry
                const i = this.cfg.discardDuplicates ? this.hist.indexOf(e.text) : -1;
                if (i >= 0) this.hist.splice(i, 1);
                this.hist.push(e.text);
                if (this.hist.length > this.cfg.historySize) this.hist.shift();
            }
            e.resolve(e.text);
        }

        cancelLine() {
            const e = this.edit;
            if (!e) return;
            const s = this.screen;
            this.edit = null;
            const cells = cellsOf(e.text, e.col);
            const total = e.col + cells.length;
            s.row = e.row + Math.floor(total / this.geo.cols);
            s.col = total % this.geo.cols;
            s.write('^C');
            s.newline();
            s.flush();
            e.resolve(null);
        }

        setLine(text) {
            const e = this.edit;
            e.text = text;
            e.pos = text.length;
            this.render();
        }

        wordLeft(e) {
            let i = e.pos;
            while (i > 0 && e.text[i - 1] === ' ') i -= 1;
            while (i > 0 && e.text[i - 1] !== ' ') i -= 1;
            return i;
        }

        wordRight(e) {
            let i = e.pos;
            while (i < e.text.length && e.text[i] !== ' ') i += 1;
            while (i < e.text.length && e.text[i] === ' ') i += 1;
            return i;
        }

        onKey(ev) {
            if (ev.isComposing || this.closed) return;
            const k = ev.key;
            const modOnly = k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'AltGraph' || k === 'CapsLock' || k === 'NumLock' || k === 'ScrollLock';
            if (modOnly) return;
            const ctrl = ev.ctrlKey && !ev.altKey;
            const sel = this.selectedText();
            const eat = () => { ev.preventDefault(); ev.stopPropagation(); };
            if (sel) {
                if ((ctrl && lc(k) === 'c') || k === 'Enter' || (ctrl && k === 'Insert')) { eat(); this.copyText(sel); this.clearSelection(); return; }
                if (k === 'Escape') { eat(); this.clearSelection(); return; }
                if (!ctrl && !ev.metaKey) this.clearSelection();
            }
            if (ctrl && lc(k) === 'c') {
                eat();
                if (this.edit) this.cancelLine();
                else if (this.shell.running) this.shell.cancel();
                if (this.keyWaiter) { const r = this.keyWaiter; this.keyWaiter = null; r('c'); }
                return;
            }
            if ((ctrl && lc(k) === 'v') || (ev.shiftKey && k === 'Insert')) { eat(); void this.pasteClipboard(); return; }
            if (ctrl && (k === 'ArrowUp' || k === 'ArrowDown')) { eat(); this.scroller.scrollTop += (k === 'ArrowUp' ? -1 : 1) * this.geo.ch; return; }
            if (ev.shiftKey && (k === 'PageUp' || k === 'PageDown')) { eat(); this.scroller.scrollTop += (k === 'PageUp' ? -1 : 1) * (this.geo.rows - 1) * this.geo.ch; return; }
            if (ev.metaKey || (ev.altKey && !ev.getModifierState('AltGraph')) || (ctrl && !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Backspace', 'Delete'].includes(k))) return;
            if (this.keyWaiter) { eat(); const r = this.keyWaiter; this.keyWaiter = null; r(k); return; }
            const e = this.edit;
            if (!e) {
                // a command is running: what is typed waits for the next prompt
                if (k === 'Enter') { eat(); this.queue.push(this.pre); this.pre = ''; return; }
                if (k === 'Backspace') { eat(); this.pre = this.pre.slice(0, -1); return; }
                if ([...k].length === 1) { eat(); this.pre += k; }
                return;
            }
            switch (k) {
                case 'Enter': eat(); this.submit(); return;
                case 'Backspace':
                    eat();
                    if (e.pos > 0) { e.text = e.text.slice(0, e.pos - 1) + e.text.slice(e.pos); e.pos -= 1; this.comp = null; this.render(); }
                    return;
                case 'Delete':
                    eat();
                    if (e.pos < e.text.length) { e.text = e.text.slice(0, e.pos) + e.text.slice(e.pos + 1); this.comp = null; this.render(); }
                    return;
                case 'ArrowLeft': eat(); e.pos = ev.ctrlKey ? this.wordLeft(e) : Math.max(0, e.pos - 1); this.render(); return;
                case 'ArrowRight': eat(); e.pos = ev.ctrlKey ? this.wordRight(e) : Math.min(e.text.length, e.pos + 1); this.render(); return;
                case 'Home':
                    eat();
                    if (ev.ctrlKey) { e.text = e.text.slice(e.pos); }
                    e.pos = 0;
                    this.render();
                    return;
                case 'End':
                    eat();
                    if (ev.ctrlKey) { e.text = e.text.slice(0, e.pos); } else e.pos = e.text.length;
                    this.render();
                    return;
                case 'Escape': eat(); this.setLine(''); return;
                case 'Insert': eat(); this.insert = !this.insert; this.render(); return;
                case 'ArrowUp':
                case 'ArrowDown':
                    eat();
                    if (!e.history || !this.hist.length) return;
                    this.histAt = Math.max(0, Math.min(this.hist.length, this.histAt + (k === 'ArrowUp' ? -1 : 1)));
                    this.setLine(this.histAt >= this.hist.length ? '' : this.hist[this.histAt]);
                    return;
                case 'PageUp':
                case 'PageDown':
                    eat();
                    if (!e.history || !this.hist.length) return;
                    this.histAt = k === 'PageUp' ? 0 : this.hist.length - 1;
                    this.setLine(this.hist[this.histAt]);
                    return;
                case 'F3':
                    eat();
                    if (e.history && this.hist.length) this.setLine(this.hist[this.hist.length - 1]);
                    return;
                case 'Tab':
                    eat();
                    if (e.history && this.cfg.autoComplete) void this.complete(ev.shiftKey ? -1 : 1);
                    return;
                default:
                    if ([...k].length === 1) { eat(); this.insertText(k); }
            }
        }

        /** Tab: the file name at the cursor, the next match each time (Shift+Tab: the previous) */
        async complete(step) {
            const e = this.edit;
            if (!e || this.completing) return;
            this.completing = true;
            try {
                const c = this.comp;
                if (c && c.text === e.text && c.pos === e.pos) {
                    c.idx = (c.idx + step + c.matches.length) % c.matches.length;
                    this.applyCompletion(c);
                    return;
                }
                let q = false;
                let start = 0;
                for (let i = 0; i < e.pos; i += 1) {
                    if (e.text[i] === '"') q = !q;
                    else if (e.text[i] === ' ' && !q) start = i + 1;
                }
                const typed = stripQuotes(e.text.slice(start, e.pos));
                const cut = Math.max(typed.lastIndexOf('\\'), typed.lastIndexOf('/'), /^[A-Za-z]:/.test(typed) && typed.length >= 2 ? 1 : -1);
                const dirPart = typed.slice(0, cut + 1);
                const prefix = typed.slice(cut + 1);
                const dirsOnly = /^\s*(cd|chdir|rd|rmdir|pushd)\b/i.test(e.text);
                let matches = [];
                try {
                    const loc = await this.shell.locate(dirPart || '.');
                    if (!loc.pattern) {
                        const list = await this.shell.listLoc(loc.dir);
                        const l = lc(prefix);
                        matches = list.filter((x) => lc(x.name).startsWith(l) && (!dirsOnly || x.dir)).map((x) => x.name).sort((x, y) => lc(x).localeCompare(lc(y)));
                    }
                } catch (_) { matches = []; }
                if (this.edit !== e || !matches.length) return;
                const comp = { start, end: e.pos, dirPart, matches, idx: step < 0 ? matches.length - 1 : 0, text: '', pos: 0, after: e.text.slice(e.pos), before: e.text.slice(0, start) };
                this.comp = comp;
                this.applyCompletion(comp);
            } finally {
                this.completing = false;
            }
        }

        applyCompletion(c) {
            const e = this.edit;
            if (!e) return;
            const full = c.dirPart + c.matches[c.idx];
            const word = /[\s&|<>^,;=]/.test(full) ? `"${full}"` : full;
            e.text = c.before + word + c.after;
            e.pos = (c.before + word).length;
            c.text = e.text;
            c.pos = e.pos;
            this.render();
        }

        // ---- running

        async start(startPath) {
            this.show();
            await this.shell.initCwd(startPath);
            if (this.closed) return;
            this.screen.write(`${VERSION_TEXT}\n${COPYRIGHT_TEXT}\n`);
            await this.loop();
        }

        async loop() {
            const sh = this.shell;
            let cleared = false;
            for (;;) {
                if (this.closed) return;
                if (sh.echo) this.screen.write(`${cleared ? '' : '\n'}${sh.expandPrompt()}`);
                cleared = false;
                const line = await this.readLine('', true);
                if (this.closed) return;
                if (line === null) continue;
                const row0 = this.screen.row;
                await sh.run(line);
                if (this.closed) return;
                if (sh.cancelled) {
                    // Ctrl+C ended the command: the console shows ^C where it stopped
                    sh.cancelled = false;
                    this.screen.write(`${this.screen.col ? '\n' : ''}^C\n`);
                    this.screen.reveal(this.screen.row);
                }
                if (this.screen.row === 0 && this.screen.col === 0 && row0 > 0) cleared = true;
            }
        }

        show() {
            call('openModal', this.modal);
            this.modal.classList.remove('hidden');
            root.requestAnimationFrame(() => {
                if (this.closed) return;
                this.fitted = true;
                this.calibrate();
                const r = { width: this.geo.screenW + this.geo.frameW, height: this.geo.screenH + this.geo.frameH };
                const taskbar = doc.getElementById('taskbar');
                const workH = root.innerHeight - (taskbar ? taskbar.getBoundingClientRect().height : 0);
                const n = (opened++) % 8;
                if (this.cfg.autoPosition) call('setModalOffsetsFromViewportTopLeft', this.modal, Math.max(0, Math.round((root.innerWidth - r.width) / 2) + n * 26), Math.max(0, Math.round((workH - r.height) / 2) + n * 26));
                else call('setModalOffsetsFromViewportTopLeft', this.modal, this.cfg.left, this.cfg.top);
                this.placed = true;
                this.scroller.focus({ preventScroll: true });
            });
        }

        /**
         * The console's faces (--console-font in the console theme) are /protected/ web fonts: a window opened before
         * they arrive measures a fallback face. So it fits once with what is resolved now, waits for the face the stack
         * really resolves to (an event, no timer), and fits again; 'loadingdone' (any later face change) fits again only
         * when the resolved advance moved. All of it ends with the window (this.ac).
         */
        calibrate() {
            this.advance = 0;
            this.refit = false;
            this.fit();
            const fonts = doc.fonts;
            if (!fonts) return;
            fonts.addEventListener('loadingdone', () => this.fit(), { signal: this.ac.signal });
            void this.loadFace().then(() => { if (!this.closed) this.fit(); });
        }

        /** Loads the first face of the console font stack the page declares as a web font (a face that fails to load: the next one) */
        async loadFace() {
            const fonts = doc.fonts;
            if (typeof fonts.load !== 'function') return;
            const names = root.getComputedStyle(this.scroller).fontFamily.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
            for (const name of names) {
                if (this.closed) return;
                try {
                    const got = await fonts.load(`${this.geo.ch}px "${name}"`, 'M');
                    if (got && got.length) return;
                } catch (_) { /* this face did not arrive: the next one of the stack */ }
            }
        }

        /** The font's advance is fitted so 80 cells are exactly 640 px: a size from the font, then the leftover as letter spacing */
        fit() {
            if (this.closed || PROPS().fontStyle(this.cfg)) return;
            const sc = this.scroller;
            let adv = 0;
            try {
                if (!this.cv) this.cv = doc.createElement('canvas').getContext('2d');
                this.cv.font = `100px ${root.getComputedStyle(sc).fontFamily}`;
                adv = this.cv.measureText('M'.repeat(100)).width / 100;
            } catch (_) { adv = 0; /* the default size */ }
            if (adv > 0 && adv === this.advance && !this.refit) return;
            const probe = doc.createElement('div');
            probe.className = 'cmd-row cmd-probe';
            probe.textContent = 'M'.repeat(FIT_CHARS);
            this.rowsEl.appendChild(probe);
            // the cell's width in this face, capped by the cell's height (a 43 x 72 cell is a 72 px face)
            const size = adv > 0 ? Math.max(4, Math.min(this.geo.ch * 1.15, (this.geo.cw * 100) / adv)) : 13;
            sc.style.setProperty('--cmd-font-size', `${size.toFixed(3)}px`);
            sc.style.setProperty('--cmd-spacing', '0px');
            // the window's open animation is a 3-D transform, so a box's rect is not its size: the probe's layout width is
            // read (an integer, so the probe is FIT_CHARS cells long and the rounding is spread over all of them)
            const w = probe.offsetWidth / (FIT_CHARS / COLS);
            const spacing = w > 0 ? (COLS * this.geo.cw - w) / COLS : 0;
            if (Math.abs(spacing) > 0.0005) sc.style.setProperty('--cmd-spacing', `${spacing.toFixed(4)}px`);
            probe.remove();
            this.advance = adv;
            if (w > 0) { this.refit = false; return; }
            // not on screen (minimised): nothing could be measured, so fit again when the console has a size
            if (this.refit) return;
            this.refit = true;
            if (typeof root.ResizeObserver !== 'function') return;
            const ro = new root.ResizeObserver(() => {
                if (!this.refit) { ro.disconnect(); return; }
                if (sc.clientWidth > 0) { this.fit(); if (!this.refit) ro.disconnect(); }
            });
            ro.observe(sc);
            this.ac.signal.addEventListener('abort', () => ro.disconnect(), { once: true });
        }

        close() {
            if (this.closed) return;
            this.closed = true;
            this.shell.cancel();
            const waiter = this.keyWaiter;
            this.keyWaiter = null;
            if (waiter) waiter('');
            if (this.edit) { const r = this.edit.resolve; this.edit = null; r(null); }
            this.ac.abort();
            const m = this.modal;
            try {
                if (root.programFaults && root.programFaults.unregisterProgram) root.programFaults.unregisterProgram(m.id);
            } catch (_) { /* gone */ }
            Promise.resolve(call('closeModal', m)).finally(() => setTimeout(() => m.remove(), 300));
        }
    }

    /** Where a prompt starts: Explorer's folder for the active workspace (C:\Workspaces\<name>), or the given place */
    Shell.prototype.locFromNav = async function locFromNav(nav) {
        const parts = String(nav).split('/').filter(Boolean);
        let loc = rootLoc(this.drives.get('C'));
        let acc = '';
        for (const part of parts) {
            acc += `/${part}`;
            const list = await this.listLoc(loc);
            const e = list.find((x) => x.dir && x.nav === acc) || matchName(list.filter((x) => x.dir), part);
            if (!e) return null;
            loc = childLoc(loc, e);
        }
        return loc;
    };

    Shell.prototype.initCwd = async function initCwd(startPath) {
        let loc = null;
        try {
            if (typeof startPath === 'string' && startPath.startsWith('/')) loc = await this.locFromNav(startPath);
            else if (typeof startPath === 'string' && /^[A-Za-z]:/.test(startPath)) {
                const r = await this.locate(startPath);
                if (!r.pattern) { loc = r.dir; this.cur = r.d.letter; }
            } else {
                // activeWorkspace: the page's current workspace id (explorerApplet.js getDefaultPath)
                const ws = typeof activeWorkspace !== 'undefined' ? activeWorkspace : null; // eslint-disable-line no-undef
                if (ws) loc = await this.locFromNav(`/Workspaces/${ws}`);
            }
        } catch (_) { loc = null; }
        if (loc) this.cwds.set(loc.d.letter, loc);
        this.invalidate();
    };

    async function openCommandPrompt(startPath) {
        if (typeof root.desktopAppCreateWindow !== 'function') return null;
        const w = new CmdWindow();
        // the window's prompt loop runs for as long as the window lives: it is not awaited
        void w.start(startPath);
        return w;
    }

    root.openMelatonCommandPrompt = openCommandPrompt;
    root.melatonCommandPrompt = { open: openCommandPrompt, _test: { Screen, DriveTable, Shell, cellsOf, cellWidth, parseArgs, splitChain, extractRedirects, wildRegex, serialOf, fmtNum } };
})(typeof window !== 'undefined' ? window : globalThis);
