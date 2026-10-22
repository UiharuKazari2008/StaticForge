#!/usr/bin/env node
// Perf slice d-director (#620): old vs new results are equal, with timings.
// Runs against a scratch HOME. Never point it at the live ~/.cache/dreamscape-xi
// or ~/.cache/dreamscape-director: it writes there.
// Optional: PERF_XI_INDEX=<copy of a real Xi index.json> and
// PERF_WREN_DIR=<copy of a real Director dir with index.json + messages/>.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const scratch = fs.mkdtempSync(path.join(process.env.PERF_SCRATCH || os.tmpdir(), 'perf-d-director-'));
process.env.HOME = scratch;
assert.strictEqual(os.homedir(), scratch, 'HOME override must reach os.homedir()');

const director = require('../modules/cursorDirector');
const xi = require('../modules/xiDirector');

const ms = (start) => Number(process.hrtime.bigint() - start) / 1e6;
const sleep = (n) => new Promise((resolve) => setTimeout(resolve, n));

function time(label, fn, rounds) {
    const n = rounds || 20;
    fn();
    const start = process.hrtime.bigint();
    for (let i = 0; i < n; i++) fn();
    const each = ms(start) / n;
    console.log(`  ${label}: ${each.toFixed(3)} ms`);
    return each;
}

function sampleXiIndex() {
    if (process.env.PERF_XI_INDEX) return JSON.parse(fs.readFileSync(process.env.PERF_XI_INDEX, 'utf8'));
    const chats = [];
    for (let c = 0; c < 4; c++) {
        const messages = [];
        for (let m = 0; m < 20; m++) {
            messages.push({
                id: crypto.randomUUID(),
                role: m % 2 ? 'assistant' : 'user',
                content: 'x'.repeat(200),
                trace: m % 2 ? Array.from({ length: 30 }, (_, i) => ({ type: 'tool', name: 'Read', text: `row ${i} ${'y'.repeat(400)}` })) : undefined
            });
        }
        chats.push({ id: `xi_${crypto.randomBytes(8).toString('hex')}`, name: `chat ${c}`, runtime: 'claude', messages });
    }
    return { chats };
}

async function testXiIndexStore() {
    console.log('Xi index store');
    const paths = xi._test.layout();
    assert.ok(paths.indexPath.startsWith(scratch), 'Xi layout is under the scratch HOME');
    fs.mkdirSync(paths.root, { recursive: true });
    const original = sampleXiIndex();
    const text = JSON.stringify(original);
    fs.writeFileSync(paths.indexPath, text);
    // Let the file settle so its stamp is not the one being written right now.
    await sleep(20);

    assert.deepStrictEqual(xi._test.readIndex(), original, 'readIndex matches the file');
    assert.deepStrictEqual(xi._test.peekIndex(), original, 'peekIndex matches the file');

    // A writer that edits its copy and throws leaves the store alone.
    const copy = xi._test.readIndex();
    copy.chats[0].name = 'changed and dropped';
    copy.chats[0].messages.push({ id: 'dropped' });
    copy.chats.push({ id: 'xi_dropped', messages: [] });
    assert.deepStrictEqual(xi._test.peekIndex(), original, 'an unwritten copy does not leak into the store');

    // Write: visible at once, on disk after the coalesced flush, same format.
    const next = xi._test.readIndex();
    next.chats[0].name = 'renamed';
    next.chats[1].messages.push({ id: 'added', role: 'event' });
    xi._test.writeIndex(next);
    assert.strictEqual(xi._test.peekIndex().chats[0].name, 'renamed', 'write is visible in memory');
    await sleep(800);
    const onDisk = JSON.parse(fs.readFileSync(paths.indexPath, 'utf8'));
    assert.deepStrictEqual(onDisk, JSON.parse(JSON.stringify(next)), 'flushed file holds the written index');

    // A change made outside this process is picked up while nothing is pending.
    const outside = JSON.parse(JSON.stringify(onDisk));
    outside.chats[2].name = 'edited outside';
    fs.writeFileSync(`${paths.indexPath}.ext`, JSON.stringify(outside));
    fs.renameSync(`${paths.indexPath}.ext`, paths.indexPath);
    assert.strictEqual(xi._test.peekIndex().chats[2].name, 'edited outside', 'external edit is reloaded');

    // Exit flush: a child writes and exits before the 500 ms timer.
    const childScript = `
        process.env.HOME = ${JSON.stringify(scratch)};
        const xi = require(${JSON.stringify(path.resolve(__dirname, '../modules/xiDirector'))});
        const index = xi._test.readIndex();
        index.chats[0].name = 'written at exit';
        xi._test.writeIndex(index);
        process.exit(0);
    `;
    const child = spawnSync(process.execPath, ['-e', childScript], { encoding: 'utf8', env: { ...process.env, HOME: scratch } });
    assert.strictEqual(child.status, 0, child.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(paths.indexPath, 'utf8')).chats[0].name, 'written at exit', 'exit flush wrote the pending index');
    const sigScript = childScript.replace("process.exit(0);", "process.kill(process.pid, 'SIGTERM'); setTimeout(() => {}, 5000);").replace('written at exit', 'written on SIGTERM');
    const sig = spawnSync(process.execPath, ['-e', sigScript], { encoding: 'utf8', env: { ...process.env, HOME: scratch } });
    assert.strictEqual(sig.status, 143, `SIGTERM still exits (${sig.status}) ${sig.stderr}`);
    assert.strictEqual(JSON.parse(fs.readFileSync(paths.indexPath, 'utf8')).chats[0].name, 'written on SIGTERM', 'signal flush wrote the pending index');

    // Timings: the old path parsed and rewrote the file synchronously on every call.
    const file = paths.indexPath;
    const oldRead = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    const oldWrite = (index) => {
        const tmp = `${file}.old.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(index));
        fs.renameSync(tmp, file);
    };
    await sleep(20);
    const before = time('old readIndex (read+parse)', oldRead);
    const beforeRw = time('old read+write cycle (saveTrace)', () => oldWrite(oldRead()));
    const after = time('new peekIndex (stat only)', () => xi._test.peekIndex());
    const afterRw = time('new readIndex+writeIndex (copy, flush later)', () => xi._test.writeIndex(xi._test.readIndex()));
    assert.ok(after < before, 'peekIndex is cheaper than a full read');
    assert.ok(afterRw < beforeRw, 'the in-memory write is cheaper than the sync rewrite');
    await sleep(800);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), JSON.parse(JSON.stringify(xi._test.peekIndex())), 'store and file agree after the timing writes');
}

function oldMarkToolDiffs(diffPath, sessionId, rows) {
    rows.forEach((row) => {
        if (!xi._test.shouldPark(row)) return;
        if (!row.diffId) row.diffId = crypto.randomBytes(6).toString('hex');
        const body = JSON.stringify({ name: row.name || '', detail: row.detail || '', args: row.args || '', result: row.result || '' });
        const hash = crypto.createHash('sha1').update(body).digest('hex');
        if (row._diffHash !== hash) {
            const file = diffPath(sessionId, row.diffId);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, body);
            row._diffHash = hash;
        }
        row.hasDiff = true;
        row.diffKind = row.name === 'Edit' ? 'diff' : 'output';
    });
}

async function testMarkToolDiffs() {
    console.log('Xi markToolDiffs');
    const sessionId = 'xi_perfdiffs01';
    const rowsFor = () => Array.from({ length: 120 }, (_, i) => ({
        type: 'tool',
        name: i % 3 ? 'Shell' : 'Edit',
        detail: `step ${i}`,
        args: JSON.stringify({ command: 'z'.repeat(800 + i) }),
        result: 'r'.repeat(i % 2 ? 150000 : 600),
        diffId: `d${String(i).padStart(4, '0')}`
    }));
    const oldRows = rowsFor();
    const newRows = rowsFor();
    const oldDir = path.join(scratch, 'old-diffs');
    const oldPath = (sid, did) => path.join(oldDir, sid, `${did}.json`);
    oldMarkToolDiffs(oldPath, sessionId, oldRows);
    xi._test.markToolDiffs(sessionId, newRows);
    // Grow one row like a streaming result does.
    oldRows[5].result += ' more';
    newRows[5].result += ' more';
    oldMarkToolDiffs(oldPath, sessionId, oldRows);
    xi._test.markToolDiffs(sessionId, newRows);
    // A read straight after the tick is served even before the async write lands.
    assert.ok(xi._test.readToolDiffText(sessionId, 'd0005').text.endsWith(' more'), 'pending body is readable');
    await sleep(300);
    const newDir = path.join(xi._test.layout().chats, sessionId, 'diffs');
    oldRows.forEach((row, i) => {
        assert.strictEqual(newRows[i].hasDiff, row.hasDiff, 'hasDiff matches');
        assert.strictEqual(newRows[i].diffKind, row.diffKind, 'diffKind matches');
        assert.ok(!('_diffHash' in newRows[i]), 'no hash field on the row');
        assert.strictEqual(fs.readFileSync(path.join(newDir, `${row.diffId}.json`), 'utf8'), fs.readFileSync(path.join(oldDir, sessionId, `${row.diffId}.json`), 'utf8'), 'same diff body on disk');
    });
    const oldTick = time('old markToolDiffs tick (120 rows, ~9 MB)', () => oldMarkToolDiffs(oldPath, sessionId, oldRows), 10);
    const newTick = time('new markToolDiffs tick (unchanged rows)', () => xi._test.markToolDiffs(sessionId, newRows), 10);
    assert.ok(newTick < oldTick, 'unchanged rows cost less');
    await sleep(100);
}

function oldReadProjectCursorRules(workspace) {
    const rulesDir = path.join(workspace, '.cursor', 'rules');
    let names = [];
    try { names = fs.readdirSync(rulesDir).filter((name) => name.endsWith('.mdc')); } catch (_) { return ''; }
    return names.sort().map((name) => {
        let text = '';
        try { text = fs.readFileSync(path.join(rulesDir, name), 'utf8'); } catch (_) { return ''; }
        return text.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
    }).filter(Boolean).join('\n\n');
}

async function testProjectRules() {
    console.log('Xi project rules cache');
    const ws = path.join(scratch, 'rules-ws');
    const rules = path.join(ws, '.cursor', 'rules');
    fs.mkdirSync(rules, { recursive: true });
    for (let i = 0; i < 15; i++) fs.writeFileSync(path.join(rules, `r${i}.mdc`), `---\ndescription: r${i}\n---\nRule ${i} ${'w'.repeat(3000)}\n`);
    const past = new Date(Date.now() - 5000);
    fs.readdirSync(rules).forEach((name) => fs.utimesSync(path.join(rules, name), past, past));
    const prompt = (dir) => xi._test.claudeProjectPrompt(dir);
    assert.ok(prompt(ws).startsWith(oldReadProjectCursorRules(ws)), 'same rules text');
    fs.writeFileSync(path.join(rules, 'r3.mdc'), '---\nx: 1\n---\nChanged rule\n');
    assert.ok(prompt(ws).includes('Changed rule'), 'an edited rule is read again');
    fs.unlinkSync(path.join(rules, 'r4.mdc'));
    assert.ok(prompt(ws).startsWith(oldReadProjectCursorRules(ws)), 'a removed rule drops out');
    const repo = path.resolve(__dirname, '..');
    assert.ok(prompt(repo).startsWith(oldReadProjectCursorRules(repo)), 'same text for this repo');
    fs.readdirSync(rules).forEach((name) => fs.utimesSync(path.join(rules, name), past, past));
    time('old readProjectCursorRules', () => oldReadProjectCursorRules(ws));
    assert.strictEqual(xi._test.readProjectCursorRules(ws), oldReadProjectCursorRules(ws), 'rules text matches exactly');
    time('new readProjectCursorRules (cached)', () => xi._test.readProjectCursorRules(ws));
}

const tests = [testXiIndexStore, testMarkToolDiffs, testProjectRules];

(async () => {
    try {
        for (const test of tests) await test();
        console.log('test-perf-d-director: ok');
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
    process.exit(0);
})().catch((error) => {
    console.error(error);
    fs.rmSync(scratch, { recursive: true, force: true });
    process.exit(1);
});
