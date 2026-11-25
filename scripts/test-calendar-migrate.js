#!/usr/bin/env node
'use strict';

/**
 * #1157: the one-time move of other workspaces' Calendars into Default (modules/calendarMigrate.js), the
 * kept calendar texts by hash (modules/calendarBases.js), and a save from a stale window whose base blob is
 * gone (vfs_replace_file through calendarBases -> a delete stays deleted).
 *
 *   node scripts/test-calendar-migrate.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const mig = require('../modules/calendarMigrate');
const bases = require('../modules/calendarBases');
const cal = require('../modules/calendarMcp');

let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 4).join('\n     ')}`); }
}

const ics = (extra, items) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...(extra || []), ...(items || []).flatMap(([uid, sum]) => ['BEGIN:VTODO', `UID:${uid}`, 'DTSTAMP:20261124T100000Z', `SUMMARY:${sum}`, 'END:VTODO']), 'END:VCALENDAR'].join('\r\n') + '\r\n';
const md5 = (t) => crypto.createHash('md5').update(t).digest('hex');
const tmpdir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const f = (id, name, workspaceId, text, workspaceName) => ({ id, name, workspaceId, workspaceName: workspaceName || workspaceId, text });
const byId = (acts) => Object.fromEntries(acts.map((a) => [a.id, a]));

(async () => {
    await test('planMigration: mirror trashed, user calendar moved, clash renamed, identical twin trashed, agents never trashed', () => {
        const home = ics(['X-WR-CALNAME:Home'], [['a', 'A']]);
        const acts = byId(mig.planMigration([
            f('d1', 'Home.ics', 'default', home, 'Default'),
            f('m1', 'Phone (Fold).ics', 'ws2', ics(['X-MELATON-SOURCE:phone:Fold'], [['p', 'P']]), 'Studio'),
            f('u1', 'Garden.ics', 'ws2', ics(['X-WR-CALNAME:Garden'], [['g', 'G']]), 'Studio'),
            f('t1', 'Home.ics', 'ws2', home, 'Studio'), // identical twin of Default's
            f('c1', 'Home.ics', 'ws3', ics(['X-WR-CALNAME:Home'], [['b', 'B']]), 'Side Quest'), // same name, other text
            f('g1', 'Yozora.ics', 'ws2', ics(['X-MELATON-OWNER:agents'], [['y', 'Y']]), 'Studio'),
        ]));
        assert.strictEqual(acts.d1, undefined, 'Default files are never touched');
        assert.strictEqual(acts.m1.action, 'trash'); assert.strictEqual(acts.m1.reason, 'phone-mirror');
        assert.strictEqual(acts.u1.action, 'move'); assert.strictEqual(acts.u1.toName, undefined);
        assert.strictEqual(acts.t1.action, 'trash'); assert.strictEqual(acts.t1.reason, 'identical-duplicate');
        assert.strictEqual(acts.c1.action, 'move'); assert.strictEqual(acts.c1.toName, 'Home (Side Quest).ics');
        assert.strictEqual(acts.g1.action, 'move');
    });

    await test('planMigration: a subscription is trashed when Default has its source, else moved (once)', () => {
        const sub = (src, extra) => ics([`X-MELATON-SOURCE:${src}`, ...(extra || [])], [['e', 'E']]);
        const acts = byId(mig.planMigration([
            f('d1', 'Holidays.ics', 'default', sub('http://x.example/h.ics')),
            f('s1', 'Holidays copy.ics', 'ws2', sub('http://x.example/h.ics', ['X-WR-CALNAME:copy'])),
            f('s2', 'Weather.ics', 'ws2', sub('http://x.example/w.ics')),
            f('s3', 'Weather.ics', 'ws3', sub('http://x.example/w.ics')), // the same feed in a third workspace: the moved one is Default's now
        ]));
        assert.deepStrictEqual([acts.s1.action, acts.s1.reason], ['trash', 'subscription-in-default']);
        assert.deepStrictEqual([acts.s2.action, acts.s2.toName], ['move', undefined]);
        assert.strictEqual(acts.s3.action, 'trash');
    });

    await test('planMigration: unreadable text and clashes never trash a user calendar; second clash is numbered; trashed/non-ics ignored', () => {
        const acts = mig.planMigration([
            f('d1', 'A.ics', 'default', ics([], [['1', 'x']])),
            f('x1', 'A.ics', 'ws2', null, 'W'),
            f('x2', 'A.ics', 'ws3', ics([], [['2', 'y']]), 'W'),
            { ...f('x3', 'T.ics', 'ws2', ics([])), trashed: true },
            f('x4', 'notes.txt', 'ws2', 'hi'),
        ]);
        assert.strictEqual(acts.length, 2);
        assert.ok(acts.every((a) => a.action === 'move'));
        assert.deepStrictEqual(acts.map((a) => a.toName).sort(), ['A (W) 2.ics', 'A (W).ics']);
    });

    await test('calendarBases: saved by hash, found again, capped by count and age, pruned on write', async () => {
        const d = tmpdir('calbases-');
        bases.setDir(d);
        const t = ics([], [['a', 'A']]);
        assert.strictEqual(await bases.save(md5(t), t), true);
        assert.strictEqual(await bases.save(md5(t), t), false, 'kept once');
        assert.strictEqual(await bases.read(md5(t)), t);
        assert.strictEqual(await bases.read('not-a-hash'), '');
        // 305 more files: the oldest go
        for (let i = 0; i < bases.MAX_FILES + 5; i += 1) {
            const x = ics([], [[`u${i}`, `S${i}`]]);
            await bases.save(md5(x), x);
            const p = path.join(d, `${md5(x)}.ics`);
            fs.utimesSync(p, new Date(Date.now() - (1000 - i) * 1000), new Date(Date.now() - (1000 - i) * 1000));
        }
        await bases.prune();
        const left = fs.readdirSync(d);
        assert.ok(left.length <= bases.MAX_FILES, `${left.length} files left`);
        // old by age
        const old = ics([], [['old', 'Old']]);
        await bases.save(md5(old), old);
        const op = path.join(d, `${md5(old)}.ics`);
        const long = new Date(Date.now() - bases.MAX_AGE_MS - 3600000);
        fs.utimesSync(op, long, long);
        await bases.prune();
        assert.ok(!fs.existsSync(op), 'older than 30 days is dropped');
        bases.setDir(null);
        fs.rmSync(d, { recursive: true, force: true });
    });

    await test('stale base: the blob is gone (cleaned with the last file), calendarBases has it, a delete stays deleted', async () => {
        const VfsWebSocketHandlers = require('../modules/vfsWebSocketHandlers');
        const root = tmpdir('calstale-');
        const blobs = path.join(root, 'userFiles');
        fs.mkdirSync(blobs);
        bases.setDir(path.join(root, 'bases'));
        const row = { id: 'f1', original_name: 'Home.ics', mime_type: 'text/calendar', size: 0, content_hash: null };
        const rows = { f1: row };
        const vdb = {
            getUserFileById: async (id) => rows[id] && { ...rows[id] },
            updateUserFile: async (id, u) => { Object.assign(rows[id], u); return { ...rows[id] }; },
            countUserFilesByContentHash: async (h) => Object.values(rows).filter((r) => r.content_hash === h).length,
        };
        const vfs = { getFileBlobPath: (h) => path.join(blobs, h), getFilePreviewPath: () => null };
        const gr = { getVfsDatabase: () => vdb, getVfsManager: () => vfs, getPath: () => root };
        const sent = [];
        const h = new VfsWebSocketHandlers({ globalResources: gr, sendToClient: (ws, m) => sent.push(m) });
        const put = (text) => { const hash = md5(text); fs.writeFileSync(path.join(blobs, hash), text); row.content_hash = hash; row.size = Buffer.byteLength(text); return hash; };
        const save = (text, baseHash) => h._replaceFile({}, { requestId: 'r', data: { fileId: 'f1', fileData: Buffer.from(text).toString('base64'), baseHash } }, {}, null);
        const sums = (t) => cal.splitCalendar(t).comps.map((c) => c.uid).sort();

        const v1 = ics([], [['a', 'A'], ['b', 'B']]);
        const h1 = put(v1);                       // the window loads v1
        const v2 = ics([], [['a', 'A'], ['b', 'B'], ['c', 'C']]);
        await save(v2, h1);                       // an agent / other device saves v2: v1's blob is collected
        assert.ok(!fs.existsSync(path.join(blobs, h1)), 'v1 blob was removed with its last file');
        const v3 = ics([], [['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D']]);
        await save(v3, md5(v2));                  // and v3: v2's blob is gone too
        // the stale window (loaded v1) deletes b and saves: without v1 the delete would come back
        const mine = ics([], [['a', 'A']]);
        await save(mine, h1);
        const stored = fs.readFileSync(path.join(blobs, row.content_hash), 'utf8');
        assert.deepStrictEqual(sums(stored), ['a', 'c', 'd'], 'b stays deleted; c and d (added since) are kept');
        // control: without the kept copy the delete is lost (union)
        fs.rmSync(path.join(root, 'bases'), { recursive: true, force: true });
        const again = ics([], [['a', 'A']]);
        put(v3);
        await save(again, h1);
        assert.deepStrictEqual(sums(fs.readFileSync(path.join(blobs, row.content_hash), 'utf8')), ['a', 'b', 'c', 'd'], 'no base: nothing is dropped');
        bases.setDir(null);
        fs.rmSync(root, { recursive: true, force: true });
    });

    await test('run: trash / move through the VFS, marker written, second run does nothing', async () => {
        const root = tmpdir('calmig-');
        fs.mkdirSync(path.join(root, 'userFiles'));
        const folders = [{ id: 'fd', workspace_id: 'default', name: 'Calendars' }, { id: 'f2', workspace_id: 'ws2', name: 'calendars' }];
        const files = [];
        const add = (id, name, ws, folder, text) => { const hash = md5(text + id); fs.writeFileSync(path.join(root, 'userFiles', hash), text); files.push({ id, original_name: name, workspace_id: ws, folder_id: folder, content_hash: hash, size: text.length }); };
        add('d1', 'Home.ics', 'default', 'fd', ics([], [['a', 'A']]));
        add('m1', 'Phone (Fold).ics', 'ws2', 'f2', ics(['X-MELATON-SOURCE:phone:Fold']));
        add('u1', 'Garden.ics', 'ws2', 'f2', ics(['X-WR-CALNAME:Garden']));
        add('u2', 'Home.ics', 'ws2', 'f2', ics(['X-WR-CALNAME:Home'], [['z', 'Z']]));
        const trashed = [];
        const vdb = {
            getFoldersByParent: async (s, ws) => folders.filter((x) => x.workspace_id === ws),
            getUserFilesByLocation: async (s, ws, fid) => files.filter((x) => x.workspace_id === ws && x.folder_id === fid && !x.trashed_at),
            updateUserFile: async (id, u) => { Object.assign(files.find((x) => x.id === id), u); },
            createFolder: async () => { throw new Error('Default already has its Calendars folder'); },
        };
        const vfs = { moveItemsToTrash: async (refs) => { refs.forEach((r) => { trashed.push(r.targetId); files.find((x) => x.id === r.targetId).trashed_at = 1; }); }, invalidatePathStatsCache() {} };
        const gr = {
            getPath: (k) => (k === 'userFiles' ? path.join(root, 'userFiles') : root),
            getWorkspaceManager: () => ({ getWorkspaces: () => ({ default: { name: 'Default' }, ws2: { name: 'Studio' } }) }),
        };
        const out = await mig.run(gr, { vdb, vfs, lock: (fn) => fn() });
        assert.deepStrictEqual([out.moved, out.trashed, out.failed], [2, 1, 0]);
        assert.deepStrictEqual(trashed, ['m1']);
        const u1 = files.find((x) => x.id === 'u1'); const u2 = files.find((x) => x.id === 'u2');
        assert.deepStrictEqual([u1.workspace_id, u1.folder_id, u1.original_name], ['default', 'fd', 'Garden.ics']);
        assert.deepStrictEqual([u2.workspace_id, u2.original_name], ['default', 'Home (Studio).ics']);
        assert.ok(fs.existsSync(path.join(root, mig.MARKER)));
        assert.deepStrictEqual(await mig.run(gr, { vdb, vfs, lock: (fn) => fn() }), { skipped: 'done' });
        fs.rmSync(root, { recursive: true, force: true });
    });

    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
