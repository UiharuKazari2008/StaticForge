#!/usr/bin/env node
// Perf slice d-director (#620): old vs new results are equal, with timings.
// Runs against a scratch HOME. Never point it at the live ~/.cache/dreamscape-xi
// or ~/.cache/dreamscape-director: it writes there.
// Optional: PERF_XI_INDEX=<copy of a real Xi index.json> and
// PERF_WREN_DIR=<copy of a real Director dir with index.json + messages/>.
// PERF_SIZE_DIR=<a big tree to walk read-only for the dirSize timing>.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const scratch = fs.mkdtempSync(path.join(process.env.PERF_SCRATCH || os.tmpdir(), 'perf-d-director-'));
process.env.HOME = scratch;
process.env.DREAMSCAPE_CURSOR_ACCOUNTS_DIR = path.join(scratch, 'cursor-accounts');
process.env.APOCRYPHA_DATA_DIR = path.join(scratch, 'apocrypha');
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
    const original = JSON.parse(JSON.stringify(sampleXiIndex()));
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

// ---- Wren (cursorDirector) ----
const d = director._test;

function oldPayloadFolderBytes(folder) {
    let total = 0;
    try {
        fs.readdirSync(folder).forEach((name) => {
            try { total += fs.statSync(path.join(folder, name)).size; } catch (_err) { /* gone */ }
        });
    } catch (_err) { /* no folder yet */ }
    return total;
}

// The persist half of the old parkToolBodies, byte for byte.
function oldPersist(persistDir, rows) {
    rows.forEach((row) => {
        if (!row || row.type !== 'tool') return;
        const args = row.args ? String(row.args) : '';
        const result = row.result ? String(row.result) : '';
        if (!args && !result) return;
        const body = { args, result, name: row.name || '', label: row.label || '', detail: row.detail || '' };
        const folder = path.join(persistDir, 'payloads');
        fs.mkdirSync(folder, { recursive: true });
        const file = path.join(folder, `${d.safeName(row.payloadId)}.json`);
        if (!fs.existsSync(file)) {
            const text = JSON.stringify(body);
            if (oldPayloadFolderBytes(folder) + text.length <= d.SESSION_PAYLOAD_DISK_MAX) fs.writeFileSync(file, text);
        }
    });
}

function listFiles(dir) {
    const out = {};
    const walk = (rel) => {
        let entries = [];
        try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch (_) { return; }
        entries.forEach((entry) => {
            const sub = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(sub);
            else if (entry.isFile()) out[sub] = fs.readFileSync(path.join(dir, sub), 'utf8');
        });
    };
    walk('');
    return out;
}

async function testParkToolBodies() {
    console.log('Wren parkToolBodies');
    const rows = Array.from({ length: 300 }, (_, i) => ({
        type: 'tool',
        name: 'Shell',
        label: 'Shell',
        detail: `cmd ${i}`,
        args: `{"command":"${'a'.repeat(200 + i)}"}`,
        result: i % 7 ? 'r'.repeat(2000 + i) : '',
        payloadId: `p${String(i).padStart(4, '0')}`
    }));
    // Folders that already hold 638 payloads, like the live session in the scan.
    const seed = (dir) => {
        const folder = path.join(dir, 'payloads');
        fs.mkdirSync(folder, { recursive: true });
        for (let i = 0; i < 638; i++) fs.writeFileSync(path.join(folder, `old${i}.json`), 'x'.repeat(4000));
    };
    const oldDir = path.join(scratch, 'park-old');
    const newDir = path.join(scratch, 'park-new');
    seed(oldDir);
    seed(newDir);
    const first = rows.slice(0, 200);
    oldPersist(oldDir, first);
    d.parkToolBodies('perf-park', first, newDir);
    oldPersist(oldDir, rows);
    d.parkToolBodies('perf-park', rows, newDir);
    assert.deepStrictEqual(listFiles(path.join(newDir, 'payloads')), listFiles(path.join(oldDir, 'payloads')), 'same payload files and bodies');
    // Budget: a folder near the cap refuses the same bodies.
    const capOld = path.join(scratch, 'cap-old');
    const capNew = path.join(scratch, 'cap-new');
    [capOld, capNew].forEach((dir) => {
        fs.mkdirSync(path.join(dir, 'payloads'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'payloads', 'big.json'), Buffer.alloc(d.SESSION_PAYLOAD_DISK_MAX - 30000));
    });
    oldPersist(capOld, rows);
    d.parkToolBodies('perf-cap', rows, capNew);
    assert.deepStrictEqual(Object.keys(listFiles(path.join(capNew, 'payloads'))).sort(), Object.keys(listFiles(path.join(capOld, 'payloads'))).sort(), 'same bodies refused at the budget');
    const more = rows.map((row, i) => ({ ...row, payloadId: `q${i}` }));
    let n = 0;
    time('old persist, 2 s save of 300 rows (6 new)', () => {
        const batch = rows.concat(more.slice(n, n + 6));
        n += 6;
        oldPersist(oldDir, batch);
    }, 10);
    n = 0;
    time('new parkToolBodies, 2 s save of 300 rows (6 new)', () => {
        const batch = rows.concat(more.slice(n, n + 6));
        n += 6;
        d.parkToolBodies('perf-park', batch, newDir);
    }, 10);
}

function seedWren() {
    const paths = director.layout();
    assert.ok(paths.root.startsWith(scratch), 'Director layout is under the scratch HOME');
    fs.mkdirSync(path.join(paths.root, 'messages'), { recursive: true });
    const src = process.env.PERF_WREN_DIR;
    if (src) {
        fs.copyFileSync(path.join(src, 'index.json'), paths.indexPath);
        fs.readdirSync(path.join(src, 'messages')).forEach((name) => fs.copyFileSync(path.join(src, 'messages', name), path.join(paths.root, 'messages', name)));
    } else {
        const chats = [];
        for (let c = 0; c < 10; c++) {
            const id = `dirc_${crypto.randomBytes(8).toString('hex')}`;
            const messages = Array.from({ length: 200 }, (_, m) => ({ id: crypto.randomUUID(), role: m % 2 ? 'assistant' : 'user', content: 'm'.repeat(c === 0 ? 20000 : 500) }));
            fs.writeFileSync(path.join(paths.root, 'messages', `${id}.json`), JSON.stringify(messages));
            chats.push({ id, name: `chat ${c}`, created_at: new Date().toISOString() });
        }
        fs.writeFileSync(paths.indexPath, JSON.stringify({ chats }));
    }
    const sized = fs.readdirSync(path.join(paths.root, 'messages'))
        .map((name) => ({ name, size: fs.statSync(path.join(paths.root, 'messages', name)).size }))
        .sort((a, b) => b.size - a.size);
    const bigId = sized[0].name.replace(/\.json$/, '');
    return { paths, bigId, messagesFile: path.join(paths.root, 'messages', sized[0].name) };
}

async function testWrenDraftSaves() {
    console.log('Wren draft saves');
    const { paths, bigId, messagesFile } = seedWren();
    const chat = d.peekIndex(paths.indexPath).chats.find((item) => item.id === bigId);
    assert.ok(chat && Array.isArray(chat.messages), 'big chat loads with its messages');
    const count = chat.messages.length;
    const rows = [{ type: 'assistant', text: 'thinking about it' }];
    const draftId = 'perf-draft-0001';
    await d.saveDirectorTrace(paths, bigId, rows, 'partial', draftId, null, true);
    assert.strictEqual(d.peekIndex(paths.indexPath).chats.find((item) => item.id === bigId).messages.length, count + 1, 'draft is in memory at once');
    await sleep(800);
    assert.ok(!fs.readFileSync(messagesFile, 'utf8').includes(draftId), 'a draft-only change waits for DRAFT_FLUSH_MS');
    const onDiskIndex = JSON.parse(fs.readFileSync(paths.indexPath, 'utf8'));
    assert.ok(onDiskIndex.chats.every((item) => !item.messages), 'index.json keeps the split format');
    await d.saveDirectorTrace(paths, bigId, rows.concat([{ type: 'assistant', text: 'done' }]), 'final answer', draftId, null);
    await sleep(800);
    const saved = JSON.parse(fs.readFileSync(messagesFile, 'utf8'));
    assert.strictEqual(saved.length, count + 1, 'the turn-end save writes the chat');
    assert.strictEqual(saved[saved.length - 1].data.Description, 'final answer', 'final text on disk');
    assert.deepStrictEqual(saved, JSON.parse(JSON.stringify(d.peekIndex(paths.indexPath).chats.find((item) => item.id === bigId).messages)), 'disk matches memory');

    // Drafts alone are flushed after DRAFT_FLUSH_MS.
    const lateId = 'perf-draft-0002';
    await d.saveDirectorTrace(paths, bigId, rows, 'late partial', lateId, null, true);
    await sleep(d.DRAFT_FLUSH_MS + 900);
    assert.ok(fs.readFileSync(messagesFile, 'utf8').includes(lateId), 'a lone draft lands after DRAFT_FLUSH_MS');

    // Exit flush writes a pending draft.
    const childScript = `
        process.env.HOME = ${JSON.stringify(scratch)};
        const director = require(${JSON.stringify(path.resolve(__dirname, '../modules/cursorDirector'))});
        const paths = director.layout();
        director._test.saveDirectorTrace(paths, ${JSON.stringify(bigId)}, [{ type: 'assistant', text: 'x' }], 'exit partial', 'perf-draft-exit', null, true)
            .then(() => process.exit(0));
    `;
    const child = spawnSync(process.execPath, ['-e', childScript], { encoding: 'utf8', env: { ...process.env, HOME: scratch } });
    assert.strictEqual(child.status, 0, child.stderr);
    assert.ok(fs.readFileSync(messagesFile, 'utf8').includes('perf-draft-exit'), 'exit flush wrote the pending draft');

    const big = d.peekIndex(paths.indexPath).chats.find((item) => item.id === bigId).messages;
    console.log(`  big chat: ${big.length} messages, ${(fs.statSync(messagesFile).size / 1048576).toFixed(1)} MB`);
    time('old cost per 2 s draft save: stringify the big chat', () => JSON.stringify(big), 10);
    time('readIndex copy (unchanged, per read/write)', () => d.readIndex(paths.indexPath), 20);
}

function oldGit(args, cwd, env) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(env || {}) }
    });
    const stdout = result.stdout || '';
    const redact = (text) => String(text || '').replace(/token\s+\S+/gi, 'token ***').replace(/https:\/\/[^@\s]+@/g, 'https://***@');
    const stderr = redact(result.stderr || (result.error ? result.error.message : ''));
    return { ok: result.status === 0, status: result.status, stdout, stderr };
}

async function testGitAsync() {
    console.log('Wren git() async');
    const repo = path.join(scratch, 'git-repo');
    fs.mkdirSync(repo, { recursive: true });
    const cases = [
        [['init', '-q', '-b', 'main'], repo],
        [['rev-parse', '--verify', 'HEAD'], repo],
        [['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'one'], repo],
        [['rev-parse', '--verify', 'HEAD'], repo],
        [['log', '--format=%s'], repo],
        [['diff', '--no-color', 'HEAD', '--'], repo],
        [['not-a-command'], repo],
        [['rev-parse', '--verify', 'nope'], repo]
    ];
    for (const [args, cwd] of cases) {
        const fresh = await d.git(args, cwd);
        const old = oldGit(args, cwd);
        if (args[0] === 'init') continue;
        assert.deepStrictEqual(fresh, old, `same result for git ${args.join(' ')}`);
    }
    const missing = await d.git(['status'], path.join(scratch, 'no-such-dir'));
    const oldMissing = oldGit(['status'], path.join(scratch, 'no-such-dir'));
    assert.strictEqual(missing.ok, oldMissing.ok, 'missing cwd: ok matches');
    assert.strictEqual(missing.status, oldMissing.status, 'missing cwd: status null like spawnSync');
    assert.ok(missing.stderr, 'missing cwd: the spawn error is in stderr');
    // The loop keeps turning while git runs.
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 1);
    await d.git(['-c', 'core.pager=cat', 'log', '--format=%H'], repo);
    await Promise.all(Array.from({ length: 8 }, () => d.git(['rev-parse', 'HEAD'], repo)));
    clearInterval(timer);
    assert.ok(ticks > 0, 'event loop ran during git');
}

function oldDirSize(dir) {
    let total = 0;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return 0; }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
            total += oldDirSize(full);
            continue;
        }
        try { total += fs.statSync(full).size; } catch (_) { /* vanished */ }
    }
    return total;
}

async function testDirSize() {
    console.log('Wren dirSize / computerSize');
    const paths = director.layout();
    const tree = paths.computer;
    for (let i = 0; i < 20; i++) {
        const dir = path.join(tree, i % 2 ? 'home' : 'workspace', `d${i}`, 'deep', String(i));
        fs.mkdirSync(dir, { recursive: true });
        for (let j = 0; j < 30; j++) fs.writeFileSync(path.join(dir, `f${j}`), 'z'.repeat(i * 100 + j));
    }
    fs.symlinkSync('/usr', path.join(tree, 'home', 'link-to-usr'));
    fs.symlinkSync(path.join(tree, 'workspace'), path.join(tree, 'home', 'loop'));
    assert.strictEqual(await d.dirSize(tree), oldDirSize(tree), 'dirSize matches');
    assert.deepStrictEqual(await d.computerSize(), { bytes: oldDirSize(paths.computer), home: oldDirSize(paths.home), path: paths.computer }, 'computerSize matches, one walk');
    const big = process.env.PERF_SIZE_DIR;
    if (big) {
        let start = process.hrtime.bigint();
        const oldBig = oldDirSize(big);
        const oldMs = ms(start);
        let lag = 0;
        let last = Date.now();
        const timer = setInterval(() => {
            const now = Date.now();
            lag = Math.max(lag, now - last);
            last = now;
        }, 5);
        start = process.hrtime.bigint();
        const marks = new Map([[path.join(big, 'home'), 0]]);
        const newBig = await d.dirSize(big, marks);
        const newMs = ms(start);
        clearInterval(timer);
        assert.strictEqual(newBig, oldBig, 'same total on the big tree');
        assert.strictEqual(marks.get(path.join(big, 'home')), oldDirSize(path.join(big, 'home')), 'same home total on the big tree');
        console.log(`  ${big}: old sync walk ${oldMs.toFixed(0)} ms (loop blocked), new async walk ${newMs.toFixed(0)} ms, worst loop gap ${lag} ms`);
    }
}

async function testStderrCap() {
    console.log('Wren runAgentTurn stderr cap');
    const { spawn } = require('child_process');
    const script = `
        const chunk = 'e'.repeat(64 * 1024) + '\\n';
        for (let i = 0; i < 64; i++) process.stderr.write(chunk);
        process.stderr.write('Error: you hit your usage limit\\n');
        process.stdout.write('{"type":"text"}\\n');
        process.exitCode = 3;
    `;
    const engine = {
        label: 'Test',
        spawn: () => spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] }),
        consume: (_line, state) => { state.text = 'some reply'; }
    };
    const error = await d.runAgentTurn(engine, () => {}, null, { pollMs: 1000 }).then(() => null, (err) => err);
    assert.ok(error, 'non-zero exit with a usage-limit line late in 4 MB of stderr still fails the turn');
    const full = `${'e'.repeat(64 * 1024)}\n`.repeat(64);
    assert.strictEqual(error.message, full.trim().slice(0, 800), 'error text is the first 800 chars, as before');
}

async function testEnsureProjectMemo() {
    console.log('Wren ensureProject memo');
    let uuid = 'perf-uuid-1';
    const dirs = {};
    ['cache', 'images', 'previews', 'uploadCache', 'previewCache'].forEach((name) => {
        dirs[name] = path.join(scratch, 'gr', name);
        fs.mkdirSync(dirs[name], { recursive: true });
    });
    let validations = 0;
    const gr = {
        getPath: (name) => dirs[name],
        getConfig: (opts) => (opts && opts.path === 'port' ? 9220 : {}),
        getMcpPathUuid: () => uuid,
        getWebSocketServer: () => null,
        getApplicationAuthManager: () => ({
            validateApplicationKey: async () => { validations += 1; return { valid: true, scopes: ['universal'] }; },
            createApplicationKey: async () => ({ key: 'dsak_perf_key' })
        })
    };
    const first = await director.ensureProject(gr);
    const paths = director.layout();
    assert.ok(paths.computer.startsWith(scratch), 'prepare writes under the scratch HOME');
    assert.ok(d.prepareState(), 'a full prepare stores the memo');
    const stampAll = () => {
        const out = {};
        const walk = (dir) => {
            let entries = [];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
            entries.forEach((entry) => {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== '.git') walk(full);
                } else if (entry.isFile()) {
                    out[full] = `${fs.statSync(full).mtimeMs}:${fs.readFileSync(full, 'utf8')}`;
                }
            });
        };
        walk(paths.computer);
        return out;
    };
    const before = stampAll();
    const second = await director.ensureProject(gr);
    assert.deepStrictEqual(second.jail, first.jail, 'memo hit returns the same jail');
    assert.deepStrictEqual(stampAll(), before, 'memo hit writes nothing');
    assert.strictEqual(validations, 1, 'the app key is still checked on a memo hit (the first call minted it)');

    // A full prepare from scratch state gives the same tree and jail.
    d.invalidateProjectPrepare();
    const third = await director.ensureProject(gr);
    assert.deepStrictEqual(third.jail, first.jail, 'full prepare: same jail');
    const after = stampAll();
    Object.keys(before).forEach((file) => assert.strictEqual(after[file].replace(/^[^:]*:/, ''), before[file].replace(/^[^:]*:/, ''), `same content ${file}`));

    // An edit from inside the jail is put back on the next packet, as before.
    const agents = path.join(paths.workspace, 'AGENTS.md');
    const agentsText = fs.readFileSync(agents, 'utf8');
    fs.writeFileSync(agents, 'edited by the agent');
    await director.ensureProject(gr);
    assert.strictEqual(fs.readFileSync(agents, 'utf8'), agentsText, 'edited project file restored');
    fs.unlinkSync(path.join(paths.workspace, '.cursor', 'mcp.json'));
    await director.ensureProject(gr);
    assert.ok(fs.existsSync(path.join(paths.workspace, '.cursor', 'mcp.json')), 'deleted mcp.json rewritten');

    // A new MCP path uuid reaches mcp.json.
    uuid = 'perf-uuid-2';
    await director.ensureProject(gr);
    assert.ok(fs.readFileSync(path.join(paths.workspace, '.cursor', 'mcp.json'), 'utf8').includes('perf-uuid-2'), 'uuid change rewrites mcp.json');

    // Computer stop drops the memo.
    d.shutdownIdleDirector('perf test');
    assert.strictEqual(d.prepareState(), null, 'idle shutdown drops the memo');
    await director.ensureProject(gr);
    assert.ok(d.prepareState(), 'next packet prepares again');

    // Cleanup runs under the maintenance gate and reports like before.
    const cleaned = await director.cleanupComputer();
    assert.strictEqual(cleaned.size, oldDirSize(paths.computer), 'cleanup size matches the old walk');

    let start = process.hrtime.bigint();
    for (let i = 0; i < 5; i++) {
        d.invalidateProjectPrepare();
        await director.ensureProject(gr);
    }
    const fullEach = ms(start) / 5;
    await director.ensureProject(gr);
    start = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) await director.ensureProject(gr);
    const hitEach = ms(start) / 20;
    console.log(`  full prepare ${fullEach.toFixed(2)} ms, memo hit ${hitEach.toFixed(2)} ms (wall, includes the awaited key check)`);
    assert.ok(hitEach < fullEach, 'memo hit is cheaper');
}

const tests = [
    testXiIndexStore, testMarkToolDiffs, testProjectRules,
    testParkToolBodies, testWrenDraftSaves, testGitAsync, testDirSize, testStderrCap, testEnsureProjectMemo
];

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
