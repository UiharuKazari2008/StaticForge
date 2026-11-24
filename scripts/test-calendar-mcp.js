#!/usr/bin/env node
'use strict';

/**
 * modules/calendarMcp.js: the agents' calendar merge (owner guard, UID merge, times through a zone and
 * across DST, folding, listing), and the tool end to end against a fake VFS (the packets it sends).
 *
 *   node scripts/test-calendar-mcp.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const cal = require('../modules/calendarMcp');

let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`); }
}

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);

(async () => {
    await test('wall times go through America/New_York to UTC, on both sides of DST', () => {
        assert.strictEqual(new Date(cal.parseWhen('2026-11-25T15:00', 'America/New_York').utc).toISOString(), '2026-11-25T20:00:00.000Z'); // EST -5
        assert.strictEqual(new Date(cal.parseWhen('2026-07-01T15:00', 'America/New_York').utc).toISOString(), '2026-07-01T19:00:00.000Z'); // EDT -4
        assert.strictEqual(new Date(cal.parseWhen('2026-11-25T15:00:00Z', 'America/New_York').utc).toISOString(), '2026-11-25T15:00:00.000Z');
        assert.deepStrictEqual(cal.parseWhen('2026-12-01', 'America/New_York'), { allDay: true, y: 2026, mo: 12, d: 1 });
        assert.throws(() => cal.parseWhen('next tuesday', 'America/New_York'), /Cannot read/);
    });

    await test('a new calendar is made owned; events and tasks land with UTC times, all-day dates, alarms', () => {
        const r = cal.mergeItems('', 'Yozora', [
            { kind: 'event', uid: 'plaud-1-1@dreamscape', summary: 'Dentist, Main St', start: '2026-11-25T15:00', location: 'Main St', description: 'said "book the dentist"\nsource plaud:1', reminderMinutes: 30 },
            { kind: 'event', uid: 'plaud-1-2@dreamscape', summary: 'Holiday', start: '2026-12-24' },
            { kind: 'task', uid: 'plaud-1-t1@dreamscape', summary: 'Call the bank', due: '2026-11-26', priority: 1, categories: ['Home'] }
        ], { now: NOW });
        assert.deepStrictEqual(r.added, ['plaud-1-1@dreamscape', 'plaud-1-2@dreamscape', 'plaud-1-t1@dreamscape']);
        assert.match(r.text, /X-MELATON-OWNER:agents/);
        assert.match(r.text, /DTSTART:20261125T200000Z\r\nDTEND:20261125T210000Z/);
        assert.match(r.text, /DTSTART;VALUE=DATE:20261224\r\nDTEND;VALUE=DATE:20261225/);
        assert.match(r.text, /BEGIN:VTODO[\s\S]*DUE;VALUE=DATE:20261126[\s\S]*PRIORITY:1[\s\S]*STATUS:NEEDS-ACTION/);
        assert.match(r.text, /DESCRIPTION:said "book the dentist"\\nsource plaud:1/);
        assert.match(r.text, /LOCATION:Main St/);
        assert.match(r.text, /TRIGGER:-PT30M/);
        assert.ok(r.text.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'every line folded to 75 octets');
    });

    await test('merge by UID: again is skipped, replace swaps it, nothing else in the file changes', () => {
        const one = cal.mergeItems('', 'Yozora', [{ kind: 'task', uid: 'a@x', summary: 'One' }, { kind: 'task', uid: 'b@x', summary: 'Two' }], { now: NOW }).text;
        const again = cal.mergeItems(one, 'Yozora', [{ kind: 'task', uid: 'a@x', summary: 'One changed' }], { now: NOW });
        assert.deepStrictEqual([again.added, again.skipped], [[], ['a@x']]);
        const rep = cal.mergeItems(one, 'Yozora', [{ kind: 'task', uid: 'a@x', summary: 'One changed' }], { now: NOW, replace: true });
        assert.deepStrictEqual(rep.replaced, ['a@x']);
        assert.match(rep.text, /SUMMARY:One changed/);
        assert.match(rep.text, /SUMMARY:Two/);
        assert.throws(() => cal.mergeItems('', 'Yozora', [{ kind: 'task', uid: 'a@x', summary: '1' }, { kind: 'task', uid: 'a@x', summary: '2' }]), /twice/);
    });

    await test('a calendar the agents do not own is never written (Yukimi\'s, a phone mirror)', () => {
        const mine = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Home\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Mine\r\nDTSTART:20261125T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
        assert.throws(() => cal.mergeItems(mine, 'Home', [{ kind: 'task', summary: 'x' }]), /not an agents' calendar/);
        const phone = mine.replace('X-WR-CALNAME:Home', 'X-WR-CALNAME:Home\r\nX-MELATON-SOURCE:phone:Fold');
        assert.throws(() => cal.mergeItems(phone, 'Home', [{ kind: 'task', summary: 'x' }]), /not an agents' calendar/);
    });

    await test('bad items are refused before anything is written', () => {
        assert.throws(() => cal.mergeItems('', 'Yozora', [{ kind: 'event', summary: 'No start' }]), /needs a start/);
        assert.throws(() => cal.mergeItems('', 'Yozora', [{ kind: 'event', summary: 'Back', start: '2026-11-25T15:00', end: '2026-11-25T14:00' }]), /not after/);
        assert.throws(() => cal.mergeItems('', 'Yozora', [{ kind: 'event', summary: 'Mixed', start: '2026-11-25', end: '2026-11-25T14:00' }]), /both/);
        assert.throws(() => cal.mergeItems('', 'Yozora', [{ kind: 'task', uid: 'has space', summary: 'x' }]), /UID/);
    });

    await test('readItems lists what was written (and what a user calendar holds)', () => {
        const text = cal.mergeItems('', 'Yozora', [{ kind: 'event', uid: 'e@x', summary: 'Meet, with comma', start: '2026-11-25T15:00', description: 'source plaud:9' }], { now: NOW }).text;
        const r = cal.readItems(text, 'Yozora');
        assert.strictEqual(r.owner, 'agents');
        assert.deepStrictEqual([r.items[0].summary, r.items[0].start, r.items[0].description], ['Meet, with comma', '2026-11-25T20:00Z', 'source plaud:9']);
    });

    await test('tool end to end on a fake VFS: makes the folder and file, merges, lists across calendars, guards names', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calmcp-'));
        const blobs = new Map(); // id -> { name, hash }
        const folders = new Set(['/Workspaces/default']);
        const files = new Map(); // folder -> [{ id, name }]
        let n = 0;
        const put = (folder, name, text) => {
            const list = files.get(folder) || [];
            let f = list.find((x) => x.name === name);
            if (!f) { f = { id: `f${++n}`, name, kind: 'file', targetKind: 'user-file' }; list.push(f); files.set(folder, list); }
            const hash = `h${++n}`;
            fs.writeFileSync(path.join(tmp, hash), text);
            blobs.set(f.id, { hash, size: Buffer.byteLength(text) });
        };
        put('/Workspaces/other/Calendars', 'x.ics', 'x');
        const sent = [];
        const ctx = {
            req: {},
            gr: {
                getVfsDatabase: () => ({ getUserFileById: async (id) => { const b = blobs.get(id); return b ? { content_hash: b.hash, size: b.size } : null; } }),
                getVfsManager: () => ({ getFileBlobPath: (h) => path.join(tmp, h) })
            },
            dispatchPacketTool: async (gr, req, type, args) => {
                sent.push(type);
                if (type === 'vfs_list_directory') {
                    if (args.search === 'Calendars') return { success: folders.has(args.path), data: { items: folders.has(`${args.path}/Calendars`) ? [{ name: 'Calendars', kind: 'folder' }] : [] } };
                    return folders.has(args.path) ? { success: true, data: { items: files.get(args.path) || [] } } : { success: false, error: 'nope' };
                }
                if (type === 'vfs_create_folder') { folders.add(`${args.path}/${args.name}`); return { success: true }; }
                if (type === 'vfs_upload_file') { put(args.path, args.originalFilename, Buffer.from(args.fileData, 'base64').toString('utf8')); return { success: true }; }
                return { success: false, error: type };
            }
        };
        const call = async (name, input) => JSON.parse((await cal.handleCalendarTool(ctx, name, input)).content[0].text);
        const a = await call('calendar_add_items', { items: [{ kind: 'task', uid: 't1@x', summary: 'Call mum' }] });
        assert.ok(a.success && a.created && a.added.length === 1, JSON.stringify(a));
        assert.strictEqual(a.path, '/Workspaces/default/Calendars/Yozora.ics');
        put('/Workspaces/default/Calendars', 'Home.ics', 'BEGIN:VCALENDAR\r\nX-WR-CALNAME:Home\r\nBEGIN:VEVENT\r\nUID:h1\r\nSUMMARY:Lunch plaud:5\r\nDTSTART:20261125T170000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
        // two writes at once: both land (the lock serialises read-merge-write)
        const [b, c] = await Promise.all([
            call('calendar_add_items', { items: [{ kind: 'task', uid: 't2@x', summary: 'Two' }] }),
            call('calendar_add_items', { items: [{ kind: 'task', uid: 't3@x', summary: 'Three' }] })
        ]);
        assert.ok(b.success && c.success);
        const l = await call('calendar_list_items', { kind: 'all' });
        assert.deepStrictEqual(l.items.map((i) => i.uid).sort(), ['h1', 't1@x', 't2@x', 't3@x']);
        assert.deepStrictEqual(l.calendars.map((x) => [x.name, x.agents]).sort(), [['Home', false], ['Yozora', true]]);
        const s = await call('calendar_list_items', { search: 'plaud:5' });
        assert.deepStrictEqual(s.items.map((i) => i.uid), ['h1']);
        const home = await call('calendar_add_items', { calendar: 'Home', items: [{ kind: 'task', summary: 'x' }] });
        assert.ok(!home.success && /not an agents' calendar/.test(home.error));
        const ph = await call('calendar_add_items', { calendar: 'Phone - Work', items: [{ kind: 'task', summary: 'x' }] });
        assert.ok(!ph.success && /Phone/.test(ph.error));
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    await test('merge on save: three-way by UID, neither edit lost', () => {
        const { mergeSave } = require('../modules/calendarMerge');
        const mk = (items, extra) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:T', ...(extra || []), ...items.flatMap(([uid, sum, stamp]) => ['BEGIN:VTODO', `UID:${uid}`, `DTSTAMP:${stamp || '20261124T100000Z'}`, `SUMMARY:${sum}`, 'END:VTODO']), 'END:VCALENDAR'].join('\r\n') + '\r\n';
        const sums = (t) => cal._test.splitCalendar(t).comps.map((c) => `${c.uid}=${(c.lines.find((l) => /^SUMMARY/.test(l)) || '').slice(8)}`).sort();
        const j = cal.joinCalendar;
        const base = mk([['a', 'A'], ['b', 'B']]);
        // an agent added c while a window (loaded at base) edited a and deleted b
        const current = mk([['a', 'A'], ['b', 'B'], ['c', 'C']]);
        const incoming = mk([['a', 'A edited', '20261124T110000Z']]);
        let r = mergeSave({ baseText: base, currentText: current, incomingText: incoming }, j);
        assert.deepStrictEqual(sums(r.text), ['a=A edited', 'c=C']); assert.ok(r.merged);
        // nothing changed under the client: its file is stored as sent (a delete holds)
        r = mergeSave({ baseText: base, currentText: base, incomingText: incoming }, j);
        assert.deepStrictEqual(sums(r.text), ['a=A edited']); assert.ok(!r.merged);
        // the same item edited on both sides: the newer stamp wins; a tie goes to the client
        r = mergeSave({ baseText: base, currentText: mk([['a', 'A server', '20261124T120000Z'], ['b', 'B']]), incomingText: mk([['a', 'A client', '20261124T110000Z'], ['b', 'B']]) }, j);
        assert.deepStrictEqual(sums(r.text), ['a=A server', 'b=B']);
        r = mergeSave({ baseText: base, currentText: mk([['a', 'A server'], ['b', 'B']]), incomingText: mk([['a', 'A client'], ['b', 'B']]) }, j);
        assert.deepStrictEqual(sums(r.text), ['a=A client', 'b=B']);
        // an edit beats a delete, both ways
        r = mergeSave({ baseText: base, currentText: mk([['a', 'A server edit'], ['b', 'B']]), incomingText: mk([['b', 'B']]) }, j);
        assert.deepStrictEqual(sums(r.text), ['a=A server edit', 'b=B']);
        r = mergeSave({ baseText: base, currentText: mk([['a', 'A']]), incomingText: mk([['a', 'A'], ['b', 'B edited']]) }, j);
        assert.deepStrictEqual(sums(r.text), ['a=A', 'b=B edited']);
        // no base (it is gone): nothing is dropped
        r = mergeSave({ baseText: '', currentText: mk([['a', 'A'], ['c', 'C']]), incomingText: mk([['a', 'A'], ['d', 'D']]) }, j);
        assert.deepStrictEqual(sums(r.text), ['a=A', 'c=C', 'd=D']);
        // the owner line survives a client that dropped it; a phone mirror / subscription is stored as sent
        r = mergeSave({ baseText: base, currentText: mk([['a', 'A'], ['b', 'B']], ['X-MELATON-OWNER:agents', 'X-X:1']), incomingText: mk([['a', 'A2']]) }, j);
        assert.match(r.text, /X-MELATON-OWNER:agents/);
        const mirror = mk([['a', 'A2']], ['X-MELATON-SOURCE:phone:Fold']);
        assert.strictEqual(mergeSave({ baseText: '', currentText: mk([['a', 'A'], ['z', 'Z']]), incomingText: mirror }, j).text, mirror);
    });

    await test('tools: scope vfs, listed in core_vfs', () => {
        cal.TOOLS.forEach((t) => assert.strictEqual(t.scope, 'vfs'));
        const reg = require('../modules/mcpModuleRegistry').MODULE_DEFS.core_vfs.tools;
        assert.ok(reg.includes('calendar_add_items') && reg.includes('calendar_list_items'));
    });

    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
