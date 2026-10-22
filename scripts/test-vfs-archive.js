// 7-Zip in the VFS (modules/vfsArchive.js, Yozora #626): browse an archive as a folder, extract all
// and a selection (overwrite modes, subfolder, eliminate root), stream one entry, pack a selection
// for download, test, checksums, create 7z / zip archives (update, password, volumes) from VFS
// folders. Real vfsDatabase (temp sqlite) and the host's 7z; no mocks of 7-Zip.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const vfsDatabase = require('../modules/vfsDatabase');
const { VfsManager } = require('../modules/vfsManager');

function seven(args, cwd) {
    return execFileSync('7z', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-archive-'));
    const cache = path.join(dir, '.cache');
    fs.mkdirSync(path.join(cache, 'userFiles'), { recursive: true });
    try {
        assert.strictEqual(await vfsDatabase.initializeVfsDatabase(dir), true);
        const gr = {
            getPath: (k) => ({ cache, userFiles: path.join(cache, 'userFiles'), tempDownload: path.join(cache, 'tempDownload') }[k]),
            getWorkspaceManager: () => ({ getWorkspaces: () => ({ ws1: { name: 'Main' } }) }),
            getVfsPathUuid: () => 'uuid-test',
            getVfsDatabase: () => vfsDatabase,
            getSystemInfoCache: () => null
        };
        const vfs = new VfsManager(gr);
        const archive = vfs.getArchive();

        // a source tree -> sample.zip / sample.7z stored as VFS files in /<folder>
        const src = path.join(dir, 'src');
        fs.mkdirSync(path.join(src, 'sample', 'docs', 'deep'), { recursive: true });
        fs.writeFileSync(path.join(src, 'sample', 'readme.txt'), 'hello archive\n');
        fs.writeFileSync(path.join(src, 'sample', 'docs', 'a.txt'), 'A'.repeat(5000));
        fs.writeFileSync(path.join(src, 'sample', 'docs', 'deep', 'b.txt'), 'bee');
        seven(['a', '-bso0', '-bsp0', path.join(dir, 'sample.zip'), 'sample'], src);
        seven(['a', '-bso0', '-bsp0', '-pPW', '-mhe=on', path.join(dir, 'locked.7z'), 'sample'], src);
        seven(['a', '-bso0', '-bsp0', '-ttar', path.join(dir, 'sample.tar'), 'sample'], src);
        seven(['a', '-bso0', '-bsp0', '-tgzip', path.join(dir, 'sample.tar.gz'), path.join(dir, 'sample.tar')], dir);

        const folder = await vfsDatabase.createFolder({ scope: 'workspace', workspaceId: 'ws1', name: 'Downloads' });
        const folderPath = `/Workspaces/ws1/${folder.id}`;
        const loc = { scope: 'workspace', workspaceId: 'ws1', folderId: folder.id };
        const store = (p, name) => vfs.saveUserFileBuffer(fs.readFileSync(p), { originalName: name, mimeType: 'application/octet-stream', ...loc });
        const zip = await store(path.join(dir, 'sample.zip'), 'sample.zip');
        const locked = await store(path.join(dir, 'locked.7z'), 'locked.7z');
        const tgz = await store(path.join(dir, 'sample.tar.gz'), 'sample.tar.gz');

        // file items carry the format and icon
        const item = vfs.makeFileItem(zip);
        assert.strictEqual(item.archiveFormat, 'zip');
        assert.ok(item.icon.includes('ex-archive-zip'));
        assert.strictEqual(vfs.makeFileItem(tgz).archiveFormat, 'gz');

        // browse: root, a folder, display path, stats, parsePath
        const rootPath = archive.buildArchivePath(folderPath, zip.id);
        const top = await vfs.listDirectory(rootPath);
        assert.deepStrictEqual(top.items.map((i) => i.name), ['sample']);
        assert.strictEqual(top.items[0].kind, 'folder');
        const inner = await vfs.listDirectory(top.items[0].navPath);
        assert.deepStrictEqual(inner.items.map((i) => i.name).sort(), ['docs', 'readme.txt']);
        const docs = inner.items.find((i) => i.name === 'docs');
        assert.strictEqual(docs.size, 5003, 'folder size sums its files');
        const readme = inner.items.find((i) => i.name === 'readme.txt');
        assert.strictEqual(readme.targetKind, 'archive-entry');
        assert.ok(readme.protected);
        assert.strictEqual(vfs.parsePath(top.items[0].navPath).type, 'archive');
        assert.throws(() => vfs.resolveLocationFromPath(top.items[0].navPath), /compressed folder/);
        const stats = await vfs.getPathStats(docs.navPath);
        assert.strictEqual(stats.displayName, 'docs');
        assert.ok(stats.displayPath.includes('sample.zip'), stats.displayPath);
        assert.strictEqual(await vfs.resolvePathInput(docs.navPath), docs.navPath);
        // a name with a slash-like encoding round-trips
        assert.deepStrictEqual(archive.splitArchivePath(archive.buildArchivePath('/x', 'id1', ['a/b', 'c'])).inner, ['a/b', 'c']);

        // tar.gz browses as its tar
        const tgzTop = await vfs.listDirectory(archive.buildArchivePath(folderPath, tgz.id));
        assert.deepStrictEqual(tgzTop.items.map((i) => i.name), ['sample']);

        // locked 7z: needs a password, a wrong one says so, the right one unlocks
        assert.deepStrictEqual((await archive.describe(locked.id, '')).needsPassword, true);
        const wrong = await archive.describe(locked.id, 'nope');
        assert.ok(wrong.needsPassword && wrong.wrongPassword);
        const ok = await archive.describe(locked.id, 'PW');
        assert.ok(ok.archive && ok.archive.fileCount === 3, JSON.stringify(ok));
        assert.strictEqual((await vfs.listDirectory(archive.buildArchivePath(folderPath, locked.id))).items[0].name, 'sample');

        const runOp = (kind, params) => new Promise((resolve) => {
            const events = [];
            const opId = archive.start(kind, params, {
                send: (data) => {
                    events.push(data);
                    if (data.ask) setImmediate(() => archive.control(opId, 'answer', params.__answer || 'yes'));
                    if (data.state !== 'running') resolve({ last: data, events });
                },
                broadcast: () => {}
            });
        });
        const filesIn = async (l) => (await vfsDatabase.getUserFilesByLocation(l.scope, l.workspaceId, l.folderId)).map((f) => f.original_name).sort();
        const foldersIn = async (l) => (await vfsDatabase.getFoldersByParent(l.scope, l.workspaceId, l.folderId));

        // Extract to "sample\" with eliminate root: Downloads/sample/{readme.txt, docs/...}
        let r = await runOp('extract', { fileId: zip.id, targetPath: folderPath, subfolder: 'sample', eliminateRoot: true, overwrite: 'ask' });
        assert.strictEqual(r.last.state, 'done', JSON.stringify(r.last));
        assert.strictEqual(r.last.result.files, 3);
        const sampleFolder = (await foldersIn(loc)).find((f) => f.name === 'sample');
        assert.ok(sampleFolder, 'subfolder made');
        const sLoc = { ...loc, folderId: sampleFolder.id };
        assert.deepStrictEqual(await filesIn(sLoc), ['readme.txt']);
        const docsFolder = (await foldersIn(sLoc)).find((f) => f.name === 'docs');
        assert.ok(docsFolder, 'no sample/sample duplication');
        assert.ok(r.events.some((e) => e.status === 'Extracting'));

        // again with Ask: the answer comes back through control(); Auto Rename keeps both
        r = await runOp('extract', { fileId: zip.id, targetPath: folderPath, subfolder: 'sample', eliminateRoot: true, overwrite: 'ask', __answer: 'rename' });
        assert.strictEqual(r.last.state, 'done');
        assert.ok(r.events.some((e) => e.ask && e.ask.type === 'replace' && e.ask.name === 'readme.txt'));
        assert.deepStrictEqual(await filesIn(sLoc), ['readme.txt', 'readme_1.txt']);
        // Skip existing files leaves them
        r = await runOp('extract', { fileId: zip.id, targetPath: folderPath, subfolder: 'sample', eliminateRoot: true, overwrite: 'skip' });
        assert.strictEqual(r.last.result.skipped, 3);

        // a selection from inside docs, No pathnames off: lands as the selected names in the target
        const target2 = await vfsDatabase.createFolder({ scope: 'workspace', workspaceId: 'ws1', name: 'Out' });
        const t2Loc = { ...loc, folderId: target2.id };
        r = await runOp('extract', { fileId: zip.id, entries: ['sample/docs/a.txt', 'sample/docs/deep'], base: 'sample/docs', targetPath: `/Workspaces/ws1/${target2.id}`, overwrite: 'overwrite' });
        assert.strictEqual(r.last.state, 'done', JSON.stringify(r.last));
        assert.deepStrictEqual(await filesIn(t2Loc), ['a.txt']);
        const deep = (await foldersIn(t2Loc)).find((f) => f.name === 'deep');
        assert.ok(deep);
        assert.deepStrictEqual(await filesIn({ ...loc, folderId: deep.id }), ['b.txt']);
        // No pathnames: flat
        const target3 = await vfsDatabase.createFolder({ scope: 'workspace', workspaceId: 'ws1', name: 'Flat' });
        r = await runOp('extract', { fileId: zip.id, targetPath: `/Workspaces/ws1/${target3.id}`, pathMode: 'none', overwrite: 'overwrite' });
        assert.deepStrictEqual(await filesIn({ ...loc, folderId: target3.id }), ['a.txt', 'b.txt', 'readme.txt']);
        // the encrypted one with the remembered password
        const target4 = await vfsDatabase.createFolder({ scope: 'workspace', workspaceId: 'ws1', name: 'Locked' });
        r = await runOp('extract', { fileId: locked.id, targetPath: `/Workspaces/ws1/${target4.id}`, overwrite: 'overwrite' });
        assert.strictEqual(r.last.state, 'done', JSON.stringify(r.last));
        // extracted contents are byte-identical
        const aRow = (await vfsDatabase.getUserFilesByLocation('workspace', 'ws1', target2.id)).find((f) => f.original_name === 'a.txt');
        assert.strictEqual(fs.readFileSync(vfs.getFileBlobPath(aRow.content_hash), 'utf8'), 'A'.repeat(5000));

        // test archive
        r = await runOp('test', { fileId: zip.id });
        assert.strictEqual(r.last.state, 'done');
        assert.ok(r.last.messages.includes('There are no errors'));

        // stream one entry
        const res = new EventEmitter();
        const chunks = [];
        Object.assign(res, {
            headers: {}, statusCode: 200, headersSent: false, writableFinished: false,
            setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
            removeHeader(k) { delete this.headers[k.toLowerCase()]; },
            status(c) { this.statusCode = c; return this; },
            type() { return this; },
            send(b) { chunks.push(Buffer.from(String(b))); this.end(); },
            write(c) { this.headersSent = true; chunks.push(Buffer.from(c)); return true; },
            end(c) { if (c) chunks.push(Buffer.from(c)); this.writableFinished = true; this.emit('finish'); this.emit('close'); },
            on: EventEmitter.prototype.on,
            once: EventEmitter.prototype.once,
            emit: EventEmitter.prototype.emit,
            removeListener: EventEmitter.prototype.removeListener
        });
        await archive.streamEntry({}, res, zip, 'sample/readme.txt', { inline: true });
        await new Promise((resolve) => (res.writableFinished ? resolve() : res.once('finish', resolve)));
        assert.strictEqual(Buffer.concat(chunks).toString(), 'hello archive\n');
        assert.strictEqual(res.headers['content-type'], 'text/plain');

        // pack: one file stays itself, several become a zip
        r = await runOp('pack', { fileId: zip.id, entries: ['sample/readme.txt'], base: 'sample' });
        assert.strictEqual(r.last.state, 'done');
        assert.strictEqual(r.last.result.name, 'readme.txt');
        r = await runOp('pack', { fileId: zip.id, entries: ['sample/readme.txt', 'sample/docs'], base: 'sample' });
        assert.strictEqual(r.last.result.name, 'sample.zip');
        const token = r.last.result.downloadUrl.split('/').pop();
        const dl = archive.downloads.get(token);
        assert.ok(dl && fs.existsSync(dl.filePath));
        const packedList = seven(['l', '-ba', dl.filePath]);
        assert.ok(/docs\/deep\/b\.txt/.test(packedList) && /readme\.txt/.test(packedList), packedList);
        archive.dropDownload(token);

        // create: 7z of the extracted "sample" folder, then zip with a password, update mode, volumes
        const folderItem = { targetKind: 'vfs-folder', targetId: sampleFolder.id, kind: 'folder', name: 'sample' };
        r = await runOp('create', { items: [folderItem], sourcePath: folderPath, archiveName: 'made.7z', format: '7z', level: 9, method: 'LZMA2', solid: 'on', threads: 2 });
        assert.strictEqual(r.last.state, 'done', JSON.stringify(r.last));
        const made = (await vfsDatabase.getUserFilesByLocation('workspace', 'ws1', folder.id)).find((f) => f.original_name === 'made.7z');
        assert.ok(made);
        const madeList = seven(['l', '-ba', vfs.getFileBlobPath(made.content_hash) ]);
        assert.ok(/sample\/docs\/deep\/b\.txt/.test(madeList), madeList);
        // Update and add into the same archive adds a new file next to the old ones
        const extraRow = (await vfsDatabase.getUserFilesByLocation('workspace', 'ws1', target2.id)).find((f) => f.original_name === 'a.txt');
        r = await runOp('create', { items: [{ targetKind: 'user-file', targetId: extraRow.id, name: 'a.txt' }], sourcePath: `/Workspaces/ws1/${target2.id}`, targetPath: folderPath, archiveName: 'made.7z', format: '7z', updateMode: 'update' });
        assert.strictEqual(r.last.state, 'done', JSON.stringify(r.last));
        const made2 = (await vfsDatabase.getUserFilesByLocation('workspace', 'ws1', folder.id)).filter((f) => f.original_name === 'made.7z');
        assert.strictEqual(made2.length, 1, 'updated in place');
        const made2List = seven(['l', '-ba', vfs.getFileBlobPath(made2[0].content_hash)]);
        assert.ok(/ a\.txt$/m.test(made2List) && /sample\/readme\.txt/.test(made2List), made2List);
        r = await runOp('create', { items: [folderItem], sourcePath: folderPath, archiveName: 'secret.zip', format: 'zip', level: 5, method: 'Deflate', password: 'zz', encryptionMethod: 'AES-256' });
        const secret = (await vfsDatabase.getUserFilesByLocation('workspace', 'ws1', folder.id)).find((f) => f.original_name === 'secret.zip');
        const slt = seven(['l', '-slt', '-pzz', vfs.getFileBlobPath(secret.content_hash)]);
        assert.ok(/Encrypted = \+/.test(slt) && /AES-256/.test(slt), 'zip AES');
        // a single-file format refuses a folder
        r = await runOp('create', { items: [folderItem], sourcePath: folderPath, archiveName: 'x.gz', format: 'gzip' });
        assert.strictEqual(r.last.state, 'error');
        // volumes
        const big = await vfs.saveUserFileBuffer(require('crypto').randomBytes(300 * 1024), { originalName: 'noise.bin', mimeType: 'application/octet-stream', ...loc });
        r = await runOp('create', { items: [{ targetKind: 'user-file', targetId: big.id, name: 'noise.bin' }], sourcePath: folderPath, archiveName: 'vol.7z', format: '7z', level: 0, volumes: '100K' });
        assert.strictEqual(r.last.state, 'done', JSON.stringify(r.last));
        const vols = (await filesIn(loc)).filter((n) => n.startsWith('vol.7z.'));
        assert.deepStrictEqual(vols, ['vol.7z.001', 'vol.7z.002', 'vol.7z.003', 'vol.7z.004']);

        // CRC SHA
        const readmeRow = (await vfsDatabase.getUserFilesByLocation('workspace', 'ws1', sampleFolder.id)).find((f) => f.original_name === 'readme.txt');
        r = await runOp('hash', { items: [{ targetKind: 'user-file', targetId: readmeRow.id, name: 'readme.txt' }], method: 'SHA-256' });
        const expected = require('crypto').createHash('sha256').update('hello archive\n').digest('hex');
        assert.ok(r.last.messages.includes(`SHA256: ${expected}`), JSON.stringify(r.last.messages));
        assert.ok(r.last.messages.includes('Name: readme.txt'));

        // cancel a running extraction
        const p = runOp('extract', { fileId: zip.id, targetPath: folderPath, subfolder: 'cancelled', overwrite: 'overwrite' });
        // the op is registered synchronously; cancel before it gets far
        const opId = [...archive.ops.keys()].pop();
        archive.control(opId, 'cancel');
        r = await p;
        assert.strictEqual(r.last.state, 'cancelled');

        console.log('test-vfs-archive: ok');
    } finally {
        await vfsDatabase.closeVfsDatabase().catch(() => {});
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

main().then(() => process.exit(0), (err) => {
    console.error(err);
    process.exit(1);
});
