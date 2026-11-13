/**
 * Text Messaging's full sync in a process of its own (Yozora #779). Yukimi, Nov 13 2026: indexing
 * belongs in the background, not in server time. Like the prompt indexer it works in batches and
 * reports progress, but the work (BlueBubbles' pages, JSON, the SQLite + full-text writes, which
 * better-sqlite3 does synchronously) runs here, at the lowest CPU priority, never on the server's
 * event loop. The server forks this file (textMessagingBlueBubbles.js startSync) and only reads
 * the store; it hears progress over IPC.
 *
 *   in   { cmd: 'sync', account: { id, url, password, settings }, cacheDir }
 *   out  { progress: { phase, done } } ... { done: true, stats } | { error }
 */
'use strict';

const os = require('os');

try { os.setPriority(process.pid, 19); } catch (_) { /* not allowed: normal priority */ }

process.on('message', async (job) => {
    if (!job || job.cmd !== 'sync') return;
    const store = require('./textMessagingStore');
    const { BlueBubblesProvider } = require('./textMessagingBlueBubbles');
    let timer = null;
    try {
        store.open(job.cacheDir || undefined);
        const p = new BlueBubblesProvider(job.account, { log: (m) => send({ log: m }) });
        p.store = store;
        p.syncFast = true; // its own process at nice 19: bigger pages, short pauses
        p.info = await p.test();
        timer = setInterval(() => send({ progress: p.syncProgress || null }), 2000);
        await p.syncAll();
        send({ done: true, stats: store.stats(job.account.id) });
    } catch (error) {
        send({ error: error.message || String(error) });
    } finally {
        clearInterval(timer);
        try { store._close(); } catch (_) { /* closed */ }
        setTimeout(() => process.exit(0), 100);
    }
});

process.on('disconnect', () => process.exit(0));

function send(m) {
    try { if (process.send) process.send(m); } catch (_) { /* the server went away */ }
}
