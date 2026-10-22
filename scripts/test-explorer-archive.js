// explorerArchive.js (Yozora #626): 7-Zip menu entries as the Vista VM shows them, archive paths,
// 7-Zip's progress number formats. DOM-less: the module's helpers and menu builders only.
const assert = require('assert');
const path = require('path');

const api = require(path.join(__dirname, '../public/scripts/comp/explorerArchive.js'));
const t = api._test;

// names and paths
assert.strictEqual(t.stemOf('sample.7z'), 'sample');
assert.strictEqual(t.stemOf('backup.tar.gz'), 'backup');
assert.strictEqual(t.stemOf('noext'), 'noext');
assert.ok(api.isArchiveName('X.ZIP') && api.isArchiveName('a.tar.gz') && api.isArchiveName('disk.iso'));
assert.ok(!api.isArchiveName('photo.png'));
const p = api.archivePathFor('f1', '/Workspaces/ws1/d1');
assert.strictEqual(p, '/Workspaces/ws1/d1/~archive.f1');
assert.ok(api.isArchivePath(`${p}/docs`));
assert.deepStrictEqual(api.splitArchivePath(`${p}/docs/a%2Fb`), {
    parentPath: '/Workspaces/ws1/d1', archiveRoot: p, fileId: 'f1', inner: ['docs', 'a/b'], base: 'docs/a/b'
});
assert.deepStrictEqual(t.refEntry({ id: 'arc:f1:docs/a.txt', name: 'a.txt' }), { fileId: 'f1', path: 'docs/a.txt', name: 'a.txt' });

// 7-Zip's progress window numbers (VM: "49999 KB", "826 MB", "3793 KB/s", "00:03:29")
assert.strictEqual(t.progressSize(51198976), '49999 KB');
assert.strictEqual(t.progressSize(866123776), '826 MB');
assert.strictEqual(t.progressSize(279), '279 B');
assert.strictEqual(t.clock(209000), '00:03:29');
assert.strictEqual(t.sizeLabel(32 * 1024 * 1024), '32 MB');
assert.strictEqual(t.sizeLabel(256 * 1024), '256 KB');
assert.strictEqual(t.backslashPath('/Workspaces/Main/Downloads'), '\\Workspaces\\Main\\Downloads\\');
assert.deepStrictEqual(t.formatsFor(false).map((f) => f[0]), ['7z', 'tar', 'wim', 'zip']);
assert.deepStrictEqual(t.formatsFor(true).map((f) => f[0]), ['7z', 'bzip2', 'gzip', 'tar', 'wim', 'xz', 'zip']);
// Tahoma dialog units: Extract's OK (136,160,64x16) -> 204,260 96x26 (face 1 px in)
assert.strictEqual(t.dlu(136, 160, 64, 16), 'left:204px;top:260px;width:96px;height:26px;');

// the 7-Zip submenu for one archive (VM: sample.7z with sample_2 names taken)
const archive = { id: 'f1', name: 'sample.7z', kind: 'file', targetKind: 'user-file', targetId: 'f1', archiveFormat: '7z' };
const explorer = {
    currentPath: '/Workspaces/ws1/d1',
    items: [archive, { id: 'f2', name: 'sample.zip' }, { id: 'x', name: 'sample.7z' }],
    grid: { getSelectedItems: () => [archive] },
    _isReadOnlyUser: () => false
};
let entry = api.contextMenuEntry(explorer, archive);
assert.strictEqual(entry.text, '7-Zip');
assert.deepStrictEqual(entry.submenu.map((i) => i.text), [
    'Open archive', 'Extract files...', 'Extract Here', 'Extract to "sample\\"', 'Test archive',
    'Add to archive...', 'Add to "sample_2.7z"', 'Add to "sample_2.zip"', 'CRC SHA'
]);
assert.deepStrictEqual(entry.submenu[8].submenu.map((i) => i.text), ['CRC-32', 'CRC-64', 'XXH64', 'SHA-1', 'SHA-256', 'BLAKE2sp', '*']);

// a folder: Add to archive... and CRC SHA only
const folder = { id: 'd2', name: 'Photos', kind: 'folder', targetKind: 'vfs-folder', targetId: 'd2' };
explorer.grid.getSelectedItems = () => [folder];
entry = api.contextMenuEntry(explorer, folder);
assert.deepStrictEqual(entry.submenu.map((i) => i.text), ['Add to archive...', 'Add to "Photos.7z"', 'Add to "Photos.zip"', 'CRC SHA']);

// gallery images, shortcuts and anything inside an archive get no 7-Zip menu
assert.strictEqual(api.contextMenuEntry(explorer, { id: 'i', targetKind: 'image', name: 'a.png' }), null);
assert.strictEqual(api.contextMenuEntry({ ...explorer, currentPath: `${p}/docs` }, archive), null);

// inside an archive
const entryItem = { id: 'arc:f1:docs/a.txt', name: 'a.txt', kind: 'file', targetKind: 'archive-entry', targetId: 'docs/a.txt' };
explorer.grid.getSelectedItems = () => [entryItem];
const sections = api.entryMenuSections(explorer, entryItem);
assert.deepStrictEqual(sections[0].items.filter((i) => !i.separator).map((i) => i.text), ['Open', 'Extract files...', 'Download', 'Copy', 'Test archive']);
assert.deepStrictEqual(api.emptyMenuSections()[0].items.filter((i) => !i.separator).map((i) => i.text), ['Extract all files...', 'Download all', 'Test archive']);
assert.ok(api.isEntryRefs([{ targetKind: 'archive-entry', id: 'arc:f1:a' }]));
assert.ok(!api.isEntryRefs([{ targetKind: 'user-file' }]));

console.log('test-explorer-archive: ok');
