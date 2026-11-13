/**
 * An e-mail account's full sync in a process of its own (Yozora #789), at the lowest CPU priority:
 * IMAP, MIME parsing and the SQLite + full-text writes never run on the server's event loop (the
 * #779 lesson). The server forks this file per sync (modules/mailAccounts.js) and hears progress.
 *
 *   in   { cmd: 'sync', account, password, cacheDir, folders?: [path] }   (folders: only these)
 *   out  { progress: { folder, done, total, folderIndex, folders } } ... { done: true, stats, changes } | { error }
 */
'use strict';

const os = require('os');

try { os.setPriority(process.pid, 19); } catch (_) { /* normal priority */ }

process.on('message', async (job) => {
    if (!job || job.cmd !== 'sync') return;
    const store = require('./mailAccountsStore');
    const imap = require('./mailAccountsImap');
    let c = null;
    const changes = [];
    try {
        store.open(job.cacheDir || undefined);
        c = imap.client(job.account, job.password);
        c.on('error', () => {});
        await c.connect();
        const id = job.account.id;
        let folders = await imap.listFolders(c);
        // folders gone at the server leave the copy (a complete listing only)
        if (!job.folders) {
            const live = new Set(folders.map((f) => f.path));
            for (const f of store.listFolders(id)) if (!live.has(f.path)) store.removeFolder(id, f.path);
        } else {
            folders = folders.filter((f) => job.folders.includes(f.path));
        }
        const rank = (f) => (f.special === '\\Inbox' ? 0 : f.special === '\\Sent' ? 1 : f.special === '\\Drafts' ? 2 : f.special === '\\Junk' || f.special === '\\Trash' ? 9 : 5);
        folders.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
        for (let i = 0; i < folders.length; i += 1) {
            const f = folders[i];
            send({ progress: { folder: f.path, done: 0, total: null, folderIndex: i, folders: folders.length } });
            try {
                const r = await imap.syncFolder(c, store, id, f, (done, total) => send({ progress: { folder: f.path, done, total, folderIndex: i, folders: folders.length } }));
                if (r.fetched || r.removed || r.flagsChanged) changes.push(Object.assign({ folder: f.path }, r));
            } catch (error) {
                send({ log: `${f.path}: ${error.message}` });
            }
        }
        store.setState(id, 'lastSync', Date.now());
        if (!job.folders) store.setState(id, 'complete', '1');
        send({ done: true, stats: store.stats(id), changes });
    } catch (error) {
        send({ error: error.message || String(error) });
    } finally {
        try { if (c) await c.logout(); } catch (_) { /* closed */ }
        try { store._close(); } catch (_) { /* closed */ }
        setTimeout(() => process.exit(0), 100);
    }
});

process.on('disconnect', () => process.exit(0));

function send(m) {
    try { if (process.send) process.send(m); } catch (_) { /* the server went away */ }
}
