#!/usr/bin/env node
'use strict';

/**
 * One-time trim + VACUUM for .cache/replication_changelog.db.
 *
 * Default is a read-only report. Writing needs --apply and an explicit --max-age-days.
 * Prefer the in-process path (replicationChangelog.pruneChangelog runs 2 min after startup,
 * then every 6 h, and knows each child's lastSyncLsn). Use this script with Dreamscape stopped.
 *
 *   node scripts/replication-changelog-compact.js                       # report only
 *   node scripts/replication-changelog-compact.js --apply --max-age-days 7 --vacuum
 *   node scripts/replication-changelog-compact.js --apply --max-age-days 7 --max-lsn 12345
 *
 * Standalone (no replicas): any --max-age-days is safe. Master with children: also pass
 * --max-lsn <lowest child lastSyncLsn> so rows a child has not pulled are kept.
 * Child / ephemeral: do not run (local rows feed ack upload and user cargo export).
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function parseArgs(argv) {
    const args = { db: path.join(__dirname, '..', '.cache', 'replication_changelog.db'), apply: false, vacuum: false, maxAgeDays: null, maxLsn: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--apply') args.apply = true;
        else if (a === '--vacuum') args.vacuum = true;
        else if (a === '--db') args.db = argv[++i];
        else if (a === '--max-age-days') args.maxAgeDays = Number(argv[++i]);
        else if (a === '--max-lsn') args.maxLsn = Number(argv[++i]);
        else if (a === '--help' || a === '-h') args.help = true;
        else throw new Error(`Unknown argument: ${a}`);
    }
    return args;
}

const mib = (n) => `${(n / 1024 / 1024).toFixed(1)} MiB`;
const fileSize = (p) => (fs.existsSync(p) ? fs.statSync(p).size : 0);
const iso = (sec) => (sec ? new Date(sec * 1000).toISOString() : '-');

function report(db, dbPath, label) {
    const pageSize = db.pragma('page_size', { simple: true });
    const pageCount = db.pragma('page_count', { simple: true });
    const freelist = db.pragma('freelist_count', { simple: true });
    const row = db.prepare('SELECT COUNT(*) AS n, MIN(lsn) AS minLsn, MAX(lsn) AS maxLsn, MIN(created_at) AS oldest, MAX(created_at) AS newest FROM changes').get();
    console.log(`[${label}] file ${mib(fileSize(dbPath))} (+wal ${mib(fileSize(`${dbPath}-wal`))}), pages ${pageCount}, free ${mib(freelist * pageSize)}`);
    console.log(`[${label}] rows ${row.n}, lsn ${row.minLsn ?? '-'}..${row.maxLsn ?? '-'}, created ${iso(row.oldest)} .. ${iso(row.newest)}`);
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 19).join('\n'));
        return;
    }
    if (!fs.existsSync(args.db)) throw new Error(`Not found: ${args.db}`);

    const db = new Database(args.db, { readonly: !args.apply, timeout: 5000 });
    try {
        report(db, args.db, 'before');
        const nowSec = Math.floor(Date.now() / 1000);
        if (Number.isFinite(args.maxAgeDays) && args.maxAgeDays >= 0) {
            const cutoff = nowSec - args.maxAgeDays * 86400;
            const lsnClause = Number.isFinite(args.maxLsn) ? ' AND lsn <= ?' : '';
            const params = Number.isFinite(args.maxLsn) ? [cutoff, args.maxLsn] : [cutoff];
            const eligible = db.prepare(`SELECT COUNT(*) AS n FROM changes WHERE created_at < ?${lsnClause}`).get(...params).n;
            console.log(`eligible rows (older than ${args.maxAgeDays}d${lsnClause ? `, lsn <= ${args.maxLsn}` : ''}): ${eligible}`);
            if (args.apply) {
                const del = db.prepare(`DELETE FROM changes WHERE lsn IN (SELECT lsn FROM changes WHERE created_at < ?${lsnClause} ORDER BY lsn LIMIT 10000)`);
                let total = 0;
                for (;;) {
                    const { changes } = del.run(...params);
                    total += changes;
                    if (changes < 10000) break;
                }
                console.log(`deleted ${total} row(s)`);
            }
        } else if (args.apply) {
            throw new Error('--apply requires --max-age-days N');
        }
        if (args.apply && args.vacuum) {
            db.pragma('temp_store = FILE');
            const t0 = Date.now();
            db.exec('VACUUM');
            db.pragma('wal_checkpoint(TRUNCATE)');
            console.log(`VACUUM done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        }
        if (args.apply) report(db, args.db, 'after');
        else console.log('read-only report (pass --apply --max-age-days N [--max-lsn N] [--vacuum] to trim)');
    } finally {
        db.close();
    }
}

try {
    main();
} catch (error) {
    if (/SQLITE_BUSY|database is locked/i.test(error.message)) {
        console.error('Database is busy: stop Dreamscape first, or let the in-process prune handle it.');
    } else {
        console.error(error.message);
    }
    process.exit(1);
}
