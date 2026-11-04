#!/usr/bin/env node
// public/scripts/comp/explorerPhoneDrive.js over phoneStorageBridge.js and a fake
// window.AndroidPhoneStorage (Yozora #698): places, listing (hidden, sort, states), the address box,
// delete through the phone's trash, restore, and transfers phone <-> phone / VFS / computer.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function fakePhone() {
    const st = {
        version: 1, enabled: true, access: true, locked: false, mode: 'all',
        roots: [{ id: 'internal', name: 'Internal storage', kind: 'internal', path: '/storage/emulated/0', total: 100, free: 40 },
            { id: 'usb1', name: 'USB drive', kind: 'removable', path: '/storage/ABCD', total: 50, free: 50 }],
        baseUrl: 'https://appassets.androidplatform.net/phone-storage/tok',
        features: { binaryWrite: true, chunkSize: 64 * 1024 }
    };
    // root -> path -> { dir, data?, mtime, hidden }
    const fsys = { internal: new Map(), usb1: new Map() };
    const put = (r, p, v) => fsys[r].set(p, { mtime: 1700000000000, hidden: /\/\./.test(p), ...v });
    put('internal', '/DCIM', { dir: true });
    put('internal', '/DCIM/b.jpg', { data: Buffer.from('bbbb') });
    put('internal', '/DCIM/a.jpg', { data: Buffer.from('aaaaaaaa') });
    put('internal', '/DCIM/.thumbs', { dir: true });
    put('internal', '/Download', { dir: true });
    put('internal', '/Download/doc.pdf', { data: Buffer.from('%PDF') });
    put('usb1', '/x.txt', { data: Buffer.from('hello') });
    const trash = [];
    const calls = [];
    const ups = new Map();
    let upId = 1;
    const kids = (r, dir) => [...fsys[r].keys()].filter((p) => p !== dir && p.startsWith(dir === '/' ? '/' : dir + '/') && !p.slice(dir === '/' ? 1 : dir.length + 1).includes('/'));
    const entry = (r, p) => {
        const v = fsys[r].get(p);
        return { name: p.split('/').pop(), path: p, dir: !!v.dir, size: v.data ? v.data.length : 0, mtime: v.mtime, mime: /\.jpg$/.test(p) ? 'image/jpeg' : /\.pdf$/.test(p) ? 'application/pdf' : /\.mp4$/.test(p) ? 'video/mp4' : /\.apk$/.test(p) ? 'application/vnd.android.package-archive' : 'text/plain', hidden: v.hidden, writable: true, count: v.dir ? kids(r, p).length : undefined, thumb: /\.jpg$/.test(p) };
    };
    const copyTree = (r, from, tr, to, move) => {
        [...fsys[r].keys()].filter((p) => p === from || p.startsWith(from + '/')).forEach((p) => {
            const v = fsys[r].get(p);
            fsys[tr].set(to + p.slice(from.length), { ...v, data: v.data ? Buffer.from(v.data) : undefined });
            if (move) fsys[r].delete(p);
        });
    };
    const bridge = {
        onmessage: null,
        postMessage(msg) {
            const send = (m) => setTimeout(() => bridge.onmessage({ data: JSON.stringify(m) }), 0);
            if (msg instanceof ArrayBuffer) {
                const v = new DataView(msg);
                const up = ups.get(v.getInt32(0, false));
                const seq = v.getInt32(4, false);
                up.parts.push(Buffer.from(msg.slice(8)));
                up.written += msg.byteLength - 8;
                send({ event: 'chunk', upload: up.id, seq, ok: true, written: up.written });
                return;
            }
            const { id, op, args } = JSON.parse(msg);
            calls.push({ op, args });
            const ok = (result) => send({ id, ok: true, result });
            const fail = (code, message) => send({ id, ok: false, error: { code, message: message || code } });
            switch (op) {
                case 'hello': return ok(st);
                case 'list': {
                    if (!fsys[args.root].has(args.path) && args.path !== '/') return fail('not_found');
                    return ok({ root: args.root, path: args.path, entries: kids(args.root, args.path).map((p) => entry(args.root, p)) });
                }
                case 'mkdir': {
                    if (fsys[args.root].has(args.path)) return fail('exists');
                    fsys[args.root].set(args.path, { dir: true, mtime: Date.now() });
                    return ok(entry(args.root, args.path));
                }
                case 'rename': {
                    const to = args.path.replace(/[^/]+$/, args.name);
                    if (fsys[args.root].has(to)) return fail('exists');
                    copyTree(args.root, args.path, args.root, to, true);
                    return ok(entry(args.root, to));
                }
                case 'copy':
                case 'move': {
                    const tr = args.toRoot || args.root;
                    let name = args.path.split('/').pop();
                    let to = (args.toDir === '/' ? '' : args.toDir) + '/' + name;
                    if (fsys[tr].has(to)) {
                        if (args.conflict === 'replace') { /* overwrite */ } else if (args.conflict === 'rename') { name = name.replace(/(\.[^.]*)?$/, ' (1)$1'); to = (args.toDir === '/' ? '' : args.toDir) + '/' + name; } else return fail('exists', `${name} exists`);
                    }
                    copyTree(args.root, args.path, tr, to, op === 'move');
                    return ok(entry(tr, to));
                }
                case 'trash': return ok(args.paths.map((p) => {
                    if (fsys[args.root].get(p).dir) return { path: p, trashed: false, reason: 'folder' };
                    trash.push({ id: `t${trash.length + 1}`, name: p.split('/').pop(), root: args.root, path: p, size: fsys[args.root].get(p).data.length, mime: 'image/jpeg', expires: 1800000000000, data: fsys[args.root].get(p) });
                    fsys[args.root].delete(p);
                    return { path: p, trashed: true };
                }));
                case 'trashList': return ok(trash.map(({ data, ...t }) => t));
                case 'restore': return ok(args.ids.map((tid) => {
                    const i = trash.findIndex((t) => t.id === tid);
                    if (i < 0) return { id: tid, restored: false };
                    const t = trash.splice(i, 1)[0];
                    fsys[t.root].set(t.path, t.data);
                    return { id: tid, restored: true };
                }));
                case 'delete': args.paths.forEach((p) => copyTree(args.root, p, args.root, '/__gone', true)); [...fsys[args.root].keys()].filter((p) => p.startsWith('/__gone')).forEach((p) => fsys[args.root].delete(p)); return ok(args.paths.map((p) => ({ path: p, deleted: true })));
                case 'stat': return fsys[args.root].has(args.path) ? ok(entry(args.root, args.path)) : fail('not_found');
                case 'watch': case 'unwatch': case 'open': case 'share': return ok(null);
                case 'writeBegin': {
                    const dst = (args.dir === '/' ? '' : args.dir) + '/' + args.name;
                    if (fsys[args.root].has(dst) && args.conflict !== 'replace') return fail('exists');
                    const up = { id: upId++, args, dst, parts: [], written: 0 };
                    ups.set(up.id, up);
                    return ok({ upload: up.id, name: args.name, chunkSize: 64 * 1024 });
                }
                case 'writeEnd': {
                    const up = ups.get(args.upload);
                    fsys[up.args.root].set(up.dst, { data: Buffer.concat(up.parts), mtime: up.args.mtime });
                    return ok(entry(up.args.root, up.dst));
                }
                case 'writeAbort': ups.delete(args.upload); return ok(null);
                default: return fail('io', 'unknown op ' + op);
            }
        }
    };
    return { bridge, fsys, calls, trash, st };
}

function setup() {
    const phone = fakePhone();
    const vfs = { files: new Map(), folders: new Set(['/Workspaces/W/Stuff']), uploads: [] };
    vfs.files.set('f1', { name: 'song.mp3', data: crypto.randomBytes(300 * 1024 + 3), dir: '/Workspaces/W/Stuff' });
    const dialogs = [];
    const toasts = [];
    const win = {
        AndroidPhoneStorage: phone.bridge,
        localStorage: { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); } },
        showGlassToast: (type, title, msg) => toasts.push([type, msg]),
        showConfirmationDialog: async (message, options) => { dialogs.push({ message, options: options.map((o) => o.value) }); return win._answer.shift(); },
        _answer: [],
        prompt: () => win._promptAnswer,
        vfsClient: {
            downloadFile: async (id) => ({ downloadUrl: `vfs://${id}` }),
            listDirectory: async (p) => ({ items: [...vfs.files.entries()].filter(([, f]) => f.dir === p).map(([id, f]) => ({ id, name: f.name, kind: 'file', targetKind: 'user-file', targetId: id, size: f.data.length })) }),
            createFolder: async (p, name) => { vfs.folders.add(`${p}/${name}`); },
            moveToTrash: async () => ({})
        },
        vfsImportRouter: { routeFilesToPath: async (p, files) => { for (const f of files) vfs.uploads.push({ p, name: f.name, data: Buffer.from(await f.arrayBuffer()), lastModified: f.lastModified }); } },
        fileOperationProgress: null,
        opened: [],
        recents: [],
        recentItems: { add: (e) => win.recents.push(e) },
        openImageInViewer: (url, title, md) => win.opened.push({ app: 'lumen', url, title, md }),
        openDesktopMediaPlayerUrl: (url, name) => win.opened.push({ app: 'media', url, name }),
        featureLoader: { loadFeature: async () => {} },
        melatonRegistry: { _v: {}, get(key, name, def) { return this._v[name] || def; } },
        notepadVista: { openPhoneFile: async (src, label) => win.opened.push({ app: 'notepad', src, label }) },
        // reference/pngMetadata.js stand-in: nai*.png carry NovelAI's Comment JSON
        extractPNGMetadata: async (file) => (/^nai/.test(file.name) ? { prompt: '1girl, phone drive', uc: 'lowres', steps: 28, source: 'NovelAI Diffusion V4.5 4BDE2A90' } : { source: undefined }),
        transformMetadataForEditor: (md) => ({ ...md, transformed: true }),
        openManualModalWithContent: async (content) => win.opened.push({ app: 'studio', content }),
        openImagePromptInspector: (md) => win.opened.push({ app: 'properties', md })
    };
    // fetch: phone URLs stream from the fake phone, vfs:// from the fake VFS
    win.fetch = async (url) => {
        const u = String(url);
        let data = null;
        if (u.startsWith('vfs://')) data = vfs.files.get(u.slice(6)).data;
        else {
            const m = u.replace(phone.st.baseUrl + '/', '').split('?')[0].split('/');
            const r = decodeURIComponent(m[0]);
            const p = '/' + m.slice(1).map(decodeURIComponent).join('/');
            const v = phone.fsys[r].get(p);
            if (!v) return { ok: false, status: 404 };
            data = v.data;
        }
        let sent = false;
        return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(data) })) }) }, blob: async () => new Blob([data]) };
    };
    const mod = { exports: {} };
    const run = (src) => new Function('window', 'globalThis', 'module', 'document', 'localStorage', 'fetch', 'navigator', 'btoa', 'AbortController', 'Blob', 'File', src)(win, win, mod, undefined, win.localStorage, win.fetch, { clipboard: { writeText: async () => {} } }, (s) => Buffer.from(s, 'binary').toString('base64'), AbortController, Blob, File);
    run(read('public/scripts/comp/phoneStorageBridge.js'));
    run(read('public/scripts/comp/explorerPhoneDrive.js'));
    const app = {
        currentPath: 'phone://', sortField: 'name', sortDirection: 'asc', clipboard: null, modal: null, items: [],
        refreshed: 0,
        softRefresh: async () => { app.refreshed += 1; },
        navigateTo: (p) => { app.currentPath = p; },
        isFolderItem: (i) => i.kind === 'folder',
        resolveNavigationPath: (i) => i.navPath,
        _progressPlace: (p) => ({ name: p, path: p })
    };
    return { win, phone, vfs, dialogs, toasts, app, drive: win.explorerPhoneDrive };
}

(async () => {
    // no bridge: nothing is the phone's
    {
        const win = {};
        new Function('window', 'globalThis', 'module', read('public/scripts/comp/phoneStorageBridge.js') + read('public/scripts/comp/explorerPhoneDrive.js'))(win, win, { exports: {} });
        assert.strictEqual(win.explorerPhoneDrive.available(), false);
        assert.strictEqual(win.explorerPhoneDrive.isPath('phone://internal/DCIM'), false, 'a browser has no phone places');
        assert.deepStrictEqual(win.explorerPhoneDrive.computerDrives(), []);
    }

    const { phone, vfs, dialogs, toasts, app, drive, win } = setup();

    // places
    assert.deepStrictEqual(drive.parse('phone://internal/DCIM/Camera'), { root: 'internal', path: '/DCIM/Camera' });
    assert.deepStrictEqual(drive.parse('phone://internal'), { root: 'internal', path: '/' });
    assert.strictEqual(drive.pathFor('internal', '/'), 'phone://internal');
    assert.strictEqual(drive.normalize('phone://internal/DCIM/'), 'phone://internal/DCIM');
    assert.strictEqual(drive.isPath('phone://'), true);
    assert.strictEqual(drive.isPath('/Workspaces'), false);

    // the drive list
    let res = await drive.list(app, 'phone://');
    assert.deepStrictEqual(res.items.map((i) => i.name), ['Internal storage (D:)', 'USB drive (E:)']);
    assert.ok(res.items.every((i) => i.previewUrl.endsWith('/drive-removable-48.png')), 'the removable disk icon');
    assert.strictEqual(res.items[0].navPath, 'phone://internal');
    assert.deepStrictEqual(drive.computerDrives().map((d) => [d.key, d.name, d.icon]), [['phone:internal', 'Internal storage (D:)', 'drive-removable'], ['phone:usb1', 'USB drive (E:)', 'drive-removable']]);
    assert.strictEqual(drive.resolveInput('E:'), 'phone://usb1');
    assert.strictEqual(drive.resolveInput('d:\\DCIM\\Camera'), 'phone://internal/DCIM/Camera');
    assert.strictEqual(drive.resolveInput('Phone/Internal storage (D:)/DCIM'), 'phone://internal/DCIM');
    assert.strictEqual(drive.resolveInput('F:'), null);
    assert.strictEqual(drive.resolveInput('Phone/Internal storage/DCIM'), 'phone://internal/DCIM');
    assert.strictEqual(drive.resolveInput('phone'), 'phone://');
    assert.strictEqual(drive.resolveInput('/Workspaces'), null);
    assert.deepStrictEqual(drive.crumbs('phone://internal/DCIM').map((c) => c.label), ['Internal storage (D:)', 'DCIM']);
    assert.strictEqual(drive.displayPath('phone://internal/DCIM'), 'D:\\DCIM');
    assert.strictEqual(drive.resolveInput(drive.displayPath('phone://internal/DCIM')), 'phone://internal/DCIM', 'the address box reads back');
    assert.strictEqual(drive.parentOf('phone://internal/DCIM'), 'phone://internal');
    assert.strictEqual(drive.parentOf('phone://internal'), null, 'up from a drive is Computer');
    assert.strictEqual(drive.parentOf('phone://'), null);

    // a folder: hidden files out, folders first, name order (numeric), thumbs, watch
    app.currentPath = 'phone://internal/DCIM';
    res = await drive.list(app, app.currentPath);
    assert.deepStrictEqual(res.items.map((i) => i.name), ['a.jpg', 'b.jpg'], 'hidden .thumbs left out');
    assert.ok(res.items[0].previewUrl.endsWith('/internal/DCIM/a.jpg?thumb=256'));
    assert.strictEqual(res.items[0].modifiedAt, 1700000000, 'mtime in seconds');
    assert.ok(phone.calls.some((c) => c.op === 'watch' && c.args.path === '/DCIM'));
    app.sortField = 'size'; app.sortDirection = 'desc';
    res = await drive.list(app, app.currentPath);
    assert.deepStrictEqual(res.items.map((i) => i.name), ['a.jpg', 'b.jpg']);
    app.sortDirection = 'asc';
    res = await drive.list(app, app.currentPath);
    assert.deepStrictEqual(res.items.map((i) => i.name), ['b.jpg', 'a.jpg']);
    app.sortField = 'name';
    await drive.handleAction('explorer-phone-toggle-hidden', null, app);
    res = await drive.list(app, app.currentPath);
    assert.deepStrictEqual(res.items.map((i) => i.name), ['.thumbs', 'a.jpg', 'b.jpg'], 'shown with the toggle');
    await drive.handleAction('explorer-phone-toggle-hidden', null, app);
    // leaving unwatches
    drive.leave(app);
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(phone.calls.some((c) => c.op === 'unwatch' && c.args.path === '/DCIM'));

    // states: sharing off, no access, locked
    for (const [patch, text] of [[{ enabled: false }, 'Turn on in app settings'], [{ access: false }, 'Allow access'], [{ locked: true }, 'Unlock the app to browse the phone']]) {
        const saved = { ...phone.st };
        Object.assign(phone.st, patch);
        phone.bridge.onmessage({ data: JSON.stringify({ event: 'config' }) });
        await new Promise((r) => setTimeout(r, 10));
        res = await drive.list(app, 'phone://');
        assert.deepStrictEqual(res.items.map((i) => i.name), [text], 'the state shows as one item in the view');
        assert.strictEqual(res.emptyMessage, text);
        if (patch.enabled === false) {
            await drive.open(app, res.items[0]);
            assert.strictEqual(phone.calls[phone.calls.length - 1].op, 'openSettings', 'opening it opens the app settings');
        }
        if (patch.access === false) {
            await drive.open(app, res.items[0]);
            assert.strictEqual(phone.calls[phone.calls.length - 1].op, 'requestAccess', 'opening it asks for access');
        }
        assert.strictEqual(drive.computerDrives()[0].block.text, text);
        Object.keys(patch).forEach((k) => { phone.st[k] = saved[k]; });
        phone.bridge.onmessage({ data: JSON.stringify({ event: 'config' }) });
        await new Promise((r) => setTimeout(r, 10));
    }
    assert.strictEqual(drive.computerDrives().length, 2, 'back after sharing comes on again');

    // delete: a photo to the trash; a folder can't go there -> confirm -> permanent delete
    app.currentPath = 'phone://internal/DCIM';
    res = await drive.list(app, app.currentPath);
    await drive.remove(app, [res.items.find((i) => i.name === 'b.jpg')], false);
    assert.ok(!phone.fsys.internal.has('/DCIM/b.jpg') && phone.trash.length === 1, 'trashed');
    win._answer.push(true);
    phone.fsys.internal.set('/DCIM/Old', { dir: true, mtime: 1 });
    res = await drive.list(app, app.currentPath);
    await drive.remove(app, [res.items.find((i) => i.name === 'Old')], false);
    assert.ok(/can't go to the Phone trash/.test(dialogs[dialogs.length - 1].message), 'asks before a permanent delete');
    assert.ok(!phone.fsys.internal.has('/DCIM/Old'), 'deleted after the confirm');
    // the trash view, restore
    res = await drive.list(app, 'phone-trash://');
    assert.deepStrictEqual(res.items.map((i) => i.name), ['b.jpg']);
    await drive.handleAction('explorer-phone-restore', res.items[0], app);
    assert.ok(phone.fsys.internal.has('/DCIM/b.jpg') && !phone.trash.length, 'restored');

    // phone -> phone across roots, with the conflict prompt (Keep both)
    res = await drive.list(app, 'phone://internal/DCIM');
    const a = res.items.find((i) => i.name === 'a.jpg');
    phone.fsys.usb1.set('/a.jpg', { data: Buffer.from('old'), mtime: 1 });
    win._answer.push('rename');
    await drive.deliver(app, [a], 'phone://usb1', 'copy', { sourcePath: 'phone://internal/DCIM' });
    assert.ok(phone.fsys.usb1.get('/a (1).jpg').data.equals(Buffer.from('aaaaaaaa')), 'kept both');
    assert.deepStrictEqual(dialogs[dialogs.length - 1].options, ['replace', 'rename', 'skip', 'cancel']);

    // phone -> VFS (a file and a folder), name and mtime kept, bytes identical
    res = await drive.list(app, 'phone://internal');
    const dl = res.items.find((i) => i.name === 'Download');
    await drive.deliver(app, [a, dl], '/Workspaces/W/Stuff', 'copy', { sourcePath: 'phone://internal' });
    const up = vfs.uploads.find((u) => u.name === 'a.jpg');
    assert.ok(up && up.data.equals(Buffer.from('aaaaaaaa')) && up.lastModified === 1700000000000);
    assert.ok(vfs.folders.has('/Workspaces/W/Stuff/Download'), 'folder made in the VFS');

    // VFS -> phone (binary chunks), byte-identical
    const ref = { id: 'f1', name: 'song.mp3', kind: 'file', targetKind: 'user-file', targetId: 'f1', size: vfs.files.get('f1').data.length };
    await drive.deliver(app, [ref], 'phone://internal/Download', 'copy', { sourcePath: '/Workspaces/W/Stuff' });
    assert.ok(phone.fsys.internal.get('/Download/song.mp3').data.equals(vfs.files.get('f1').data), 'VFS -> phone byte-identical');
    // again: exists -> Replace
    win._answer.push('replace');
    await drive.deliver(app, [ref], 'phone://internal/Download', 'copy', { sourcePath: '/Workspaces/W/Stuff' });
    assert.ok(phone.calls.filter((c) => c.op === 'writeBegin').some((c) => c.args.conflict === 'replace'));

    // computer files dropped on the phone
    await drive.uploadFiles(app, 'phone://usb1', [new File([Buffer.from('desk')], 'note.txt', { lastModified: 1600000000000 })]);
    assert.ok(phone.fsys.usb1.get('/note.txt').data.equals(Buffer.from('desk')));

    // a cut from the phone into the VFS moves: the original goes to the phone's trash
    res = await drive.list(app, 'phone://usb1');
    await drive.deliver(app, [res.items.find((i) => i.name === 'x.txt')], '/Workspaces/W/Stuff', 'cut', { sourcePath: 'phone://usb1' });
    assert.ok(!phone.fsys.usb1.has('/x.txt') && phone.trash.some((t) => t.name === 'x.txt'), 'moved: source trashed');
    // a drag across drives copies instead
    res = await drive.list(app, 'phone://usb1');
    await drive.deliver(app, [res.items.find((i) => i.name === 'note.txt')], '/Workspaces/W/Stuff', 'cut', { sourcePath: 'phone://usb1', drag: true });
    assert.ok(phone.fsys.usb1.has('/note.txt'), 'a cross-drive drag keeps the source');

    // new folder, rename
    app.currentPath = 'phone://usb1';
    await drive.createFolder(app);
    await drive.createFolder(app);
    assert.ok(phone.fsys.usb1.has('/New Folder') && phone.fsys.usb1.has('/New Folder (2)'));
    res = await drive.list(app, 'phone://usb1');
    win._promptAnswer = 'Renamed';
    await drive.rename(app, res.items.find((i) => i.name === 'New Folder'));
    assert.ok(phone.fsys.usb1.has('/Renamed'));

    // errors toast their message
    await drive.handleAction('explorer-phone-open-with', { targetKind: 'phone-entry', name: 'z', phone: { root: 'nope', path: '/z', dir: false } }, app);
    assert.ok(toasts.length === 0 || toasts.every((t) => typeof t[1] === 'string'));

    // ---- Dreamscape's own apps (follow-up to #698) ----
    assert.strictEqual(drive.programFor('a.jpg', 'image/jpeg'), 'lumen');
    assert.strictEqual(drive.programFor('clip.mp4', 'video/mp4'), 'media-player');
    assert.strictEqual(drive.programFor('song.mp3', ''), 'media-player');
    assert.strictEqual(drive.programFor('notes.txt', 'text/plain'), 'notepad');
    assert.strictEqual(drive.programFor('doc.pdf', 'application/pdf'), 'viewer');
    assert.strictEqual(drive.programFor('app.apk', 'application/vnd.android.package-archive'), null);
    win.melatonRegistry._v['.jpg'] = 'paint';
    assert.strictEqual(drive.programFor('a.jpg', 'image/jpeg'), 'paint', 'Default Programs wins');
    delete win.melatonRegistry._v['.jpg'];

    // a photo: Lumen with the folder's pictures, no bridge open, recents by { root, path }
    phone.fsys.internal.set('/DCIM/c.jpg', { data: Buffer.from('cc'), mtime: 1700000000000 });
    app.currentPath = 'phone://internal/DCIM';
    res = await drive.list(app, app.currentPath);
    app.items = res.items;
    const opensBefore = phone.calls.filter((c) => c.op === 'open').length;
    await drive.open(app, res.items.find((i) => i.name === 'b.jpg'));
    const lum = win.opened.pop();
    assert.strictEqual(lum.app, 'lumen');
    assert.ok(lum.url.endsWith('/internal/DCIM/b.jpg') && /Phone › Internal storage \(D:\)\/DCIM\/b\.jpg/.test(lum.title));
    assert.deepStrictEqual(lum.md.siblings.map((r) => r.title), ['a.jpg', 'b.jpg', 'c.jpg'], 'Previous / Next walk the folder');
    assert.strictEqual(lum.md.siblings.indexOf(lum.md), 1);
    assert.strictEqual(phone.calls.filter((c) => c.op === 'open').length, opensBefore, 'Android is not asked');
    const rec = win.recents.pop();
    assert.deepStrictEqual([rec.kind, rec.data.root, rec.data.path], ['phone', 'internal', '/DCIM/b.jpg']);
    assert.ok(!JSON.stringify(rec).includes('tok'), 'no tokenized URL in Recent Items');
    // video / audio -> Media Player, text -> Notepad, PDF -> the document viewer window (no DOM here: skipped)
    phone.fsys.internal.set('/DCIM/v.mp4', { data: Buffer.from('mp4'), mtime: 1 });
    phone.fsys.internal.set('/DCIM/n.txt', { data: Buffer.from('hello phone'), mtime: 1700000001000 });
    res = await drive.list(app, app.currentPath);
    await drive.open(app, res.items.find((i) => i.name === 'v.mp4'));
    assert.strictEqual(win.opened.pop().app, 'media');
    await drive.open(app, res.items.find((i) => i.name === 'n.txt'));
    const np = win.opened.pop();
    assert.deepStrictEqual([np.app, np.src.root, np.src.path, np.src.kind], ['notepad', 'internal', '/DCIM/n.txt', 'phone']);
    // Open in Android app: the bridge with the chooser
    await drive.handleAction('explorer-phone-open-android', res.items.find((i) => i.name === 'n.txt'), app);
    const andr = phone.calls.filter((c) => c.op === 'open').pop();
    assert.deepStrictEqual([andr.args.path, andr.args.chooser], ['/DCIM/n.txt', true]);
    // a file with no program: Open With lists Dreamscape's programs, then Android's
    phone.fsys.internal.set('/DCIM/x.apk', { data: Buffer.from('apk'), mtime: 1 });
    res = await drive.list(app, app.currentPath);
    win._answer.push(null);
    await drive.open(app, res.items.find((i) => i.name === 'x.apk'));
    const ow = dialogs[dialogs.length - 1];
    assert.ok(/no program set/.test(ow.message) && ow.options.includes('android') && ow.options.includes('notepad'));

    // Save from an editor: writeText replaces the phone's file, mtime follows
    const src = np.src;
    await drive.writeText(src, 'edited on Dreamscape');
    assert.strictEqual(phone.fsys.internal.get('/DCIM/n.txt').data.toString(), 'edited on Dreamscape');
    assert.ok(phone.calls.filter((c) => c.op === 'writeBegin').pop().args.conflict === 'replace');
    // changed on the phone, then deleted there: the document is told
    const seen = [];
    const stop = drive.trackDocument(src, (kind) => seen.push(kind));
    phone.fsys.internal.get('/DCIM/n.txt').mtime = 1800000000000;
    phone.bridge.onmessage({ data: JSON.stringify({ event: 'changed', root: 'internal', path: '/DCIM' }) });
    await new Promise((r) => setTimeout(r, 20));
    phone.fsys.internal.delete('/DCIM/n.txt');
    phone.bridge.onmessage({ data: JSON.stringify({ event: 'changed', root: 'internal', path: '/DCIM' }) });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(seen, ['changed', 'deleted']);
    stop();

    // Recent Items reopen: a file there opens again; with sharing off it says so
    assert.strictEqual(await drive.openRecent({ root: 'internal', path: '/DCIM/a.jpg', name: 'a.jpg' }), true);
    assert.strictEqual(win.opened.pop().app, 'lumen');
    phone.st.enabled = false;
    phone.bridge.onmessage({ data: JSON.stringify({ event: 'config' }) });
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(await drive.openRecent({ root: 'internal', path: '/DCIM/a.jpg', name: 'a.jpg' }), false);
    assert.ok(toasts.some((t) => /Phone storage isn't available/.test(t[1])));
    phone.st.enabled = true;
    phone.bridge.onmessage({ data: JSON.stringify({ event: 'config' }) });
    await new Promise((r) => setTimeout(r, 10));

    // NovelAI images: Open in Studio / Properties from the metadata read off the phone
    phone.fsys.internal.set('/DCIM/nai_print.png', { data: Buffer.from('png'), mtime: 1 });
    phone.fsys.internal.set('/DCIM/plain.png', { data: Buffer.from('png'), mtime: 1 });
    res = await drive.list(app, 'phone://internal/DCIM');
    const naiItem = res.items.find((i) => i.name === 'nai_print.png');
    const plainItem = res.items.find((i) => i.name === 'plain.png');
    naiItem.mimeType = plainItem.mimeType = 'image/png';
    const menuOf = (it) => drive.entryMenuSections(app, it)[0].items.map((x) => x.text).filter(Boolean);
    assert.ok(menuOf(naiItem).includes('Open in Studio'), 'an unread PNG offers Studio');
    assert.ok((await drive.readNai(naiItem)).prompt === '1girl, phone drive');
    assert.strictEqual(await drive.readNai(plainItem), null);
    assert.ok(menuOf(naiItem).includes('Properties') && !menuOf(plainItem).includes('Open in Studio'), 'only a NovelAI image keeps them');
    await drive.handleAction('explorer-phone-studio', naiItem, app);
    const st = win.opened.pop();
    assert.deepStrictEqual([st.app, st.content.type, st.content.data.transformed, st.content.data.prompt], ['studio', 'metadata', true, '1girl, phone drive']);
    await drive.handleAction('explorer-phone-properties', naiItem, app);
    const pr = win.opened.pop();
    assert.ok(pr.app === 'properties' && pr.md.id === naiItem.id && pr.md.filename === undefined && pr.md.image_url.endsWith('/DCIM/nai_print.png') && pr.md.uc === 'lowres');
    await drive.handleAction('explorer-phone-studio', plainItem, app);
    assert.ok(toasts.some((t) => /no NovelAI settings/.test(t[1])));

    console.log('test-explorer-phone-drive: ok');
})().catch((err) => { console.error(err); process.exit(1); });
