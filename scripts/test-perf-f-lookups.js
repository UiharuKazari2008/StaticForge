'use strict';

// Perf slice f-lookups (#620): old (base revision) vs new results must be equal; prints timings.
// Old modules are compiled from `git show <base>:<file>` at their real path, so their requires
// resolve to the current sibling modules.
//
// Real-DB sections read copies under PERF_DATA_DIR (default ~/.cache/perfscan/f-lookups):
//   nax_tags.db, knowledge_memory.db, mail_exchange.db, reference_metadata.db
// A missing file skips that section. Every DB is copied into a scratch folder first.
//
//   node scripts/test-perf-f-lookups.js
//   PERF_BASE_REV=f2ac8aa PERF_DATA_DIR=/path node scripts/test-perf-f-lookups.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const BASE_REV = process.env.PERF_BASE_REV || 'f2ac8aa';
const DATA_DIR = process.env.PERF_DATA_DIR || path.join(os.homedir(), '.cache', 'perfscan', 'f-lookups');
const SCRATCH = fs.mkdtempSync(path.join(fs.existsSync(DATA_DIR) ? DATA_DIR : os.tmpdir(), 'run-'));

function loadBase(rel) {
    const src = execFileSync('git', ['show', `${BASE_REV}:${rel}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
    const filename = path.join(ROOT, rel);
    const m = new Module(filename, module);
    m.filename = filename;
    m.paths = Module._nodeModulePaths(path.dirname(filename));
    m._compile(src, filename);
    return m.exports;
}

function copyDb(name, destDir) {
    const src = path.join(DATA_DIR, name);
    if (!fs.existsSync(src)) return null;
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, name);
    fs.copyFileSync(src, dest);
    if (fs.existsSync(`${src}-wal`)) fs.copyFileSync(`${src}-wal`, `${dest}-wal`);
    return dest;
}

function ms(start) {
    return Number(process.hrtime.bigint() - start) / 1e6;
}

function timeIt(fn) {
    const t = process.hrtime.bigint();
    const out = fn();
    return { out, ms: ms(t) };
}

async function timeItAsync(fn) {
    const t = process.hrtime.bigint();
    const out = await fn();
    return { out, ms: ms(t) };
}

function report(label, oldMs, newMs, extra) {
    console.log(`  ${label}: old ${oldMs.toFixed(1)} ms, new ${newMs.toFixed(1)} ms${extra ? ` (${extra})` : ''}`);
}

function quiet(fn) {
    const log = console.log;
    console.log = () => {};
    try {
        return fn();
    } finally {
        console.log = log;
    }
}

// ---------------------------------------------------------------- NAX (findings 1 + 3)
function testNax() {
    const oldPath = copyDb('nax_tags.db', path.join(SCRATCH, 'nax-old'));
    if (!oldPath) {
        console.log('nax: skipped (no nax_tags.db)');
        return;
    }
    const newPath = copyDb('nax_tags.db', path.join(SCRATCH, 'nax-new'));
    console.log('nax:');
    const oldNax = loadBase('modules/naxTagsDatabase.js');
    const newNax = require('../modules/naxTagsDatabase');
    quiet(() => oldNax.initializeNaxTagsDatabase(oldPath));
    quiet(() => newNax.initializeNaxTagsDatabase(newPath));

    const galleries = oldNax.getGalleries();
    assert.deepStrictEqual(newNax.getGalleries(), galleries);
    const mutated = newNax.getGalleries();
    mutated[0].generationEnabled = true;
    assert.deepStrictEqual(newNax.getGalleries(), galleries, 'cached gallery rows are copies');

    const cases = [];
    for (const g of galleries) {
        for (const sort of ['score', 'name', 'date', 'ratio', 'random']) {
            for (const invert of [false, true]) {
                for (const markFilter of ['all', 'favorites']) {
                    for (const query of ['', 'ka']) {
                        for (const includeMissing of [false, true]) {
                            for (const offset of [0, 50]) {
                                cases.push({
                                    gallerySlug: g.slug, sort, invert, markFilter, query, offset, limit: 100,
                                    randomSeed: sort === 'random' ? 7 : null,
                                    includeMissing, missingMode: 'include'
                                });
                            }
                        }
                    }
                }
            }
        }
        for (const markFilter of ['try', 'unmarked', 'hidden', 'custom']) {
            cases.push({ gallerySlug: g.slug, markFilter, limit: 50 });
        }
        cases.push({ gallerySlug: g.slug, includeMissing: true, missingMode: 'only', markFilter: 'favorites' });
        cases.push({ gallerySlug: g.slug, elevatePins: 3, sort: 'score', limit: 30 });
        cases.push({ gallerySlug: g.slug, elevatePins: 1, sort: 'ratio', minScore: 5, maxRatio: 0.9 });
    }
    const oldRun = timeIt(() => cases.map((c) => oldNax.queryTags(c)));
    const newRun = timeIt(() => cases.map((c) => newNax.queryTags(c)));
    for (let i = 0; i < cases.length; i++) {
        assert.deepStrictEqual(newRun.out[i], oldRun.out[i], `queryTags ${JSON.stringify(cases[i])}`);
    }
    report(`queryTags x${cases.length}`, oldRun.ms, newRun.ms);

    // Total cache follows writes on this connection and on another connection.
    const d = newNax.getDb();
    const slug = 'danbooru-artist-tags-v5';
    if (galleries.some((g) => g.slug === slug)) {
        const countFav = () => d.prepare(
            'SELECT COUNT(*) AS c FROM nax_tags WHERE gallery_slug = ? AND favorite = 1 AND (hidden_mark = 0 OR hidden_mark IS NULL)'
        ).get(slug).c;
        const favTotal = () => newNax.queryTags({ gallerySlug: slug, markFilter: 'favorites', limit: 1 }).total;
        assert.strictEqual(favTotal(), countFav());
        const tag = d.prepare('SELECT tag FROM nax_tags WHERE gallery_slug = ? AND favorite = 0 AND hidden_mark = 0 LIMIT 1').get(slug).tag;
        newNax.setFavorite(slug, tag, true);
        assert.strictEqual(favTotal(), countFav(), 'total after setFavorite');
        newNax.setFavorite(slug, tag, false);
        assert.strictEqual(favTotal(), countFav(), 'total after unset');
        const other = new Database(newPath);
        other.prepare('UPDATE nax_tags SET favorite = 1 WHERE gallery_slug = ? AND tag = ?').run(slug, tag);
        assert.strictEqual(favTotal(), countFav(), 'total after another connection wrote');
        other.prepare('UPDATE nax_tags SET favorite = 0 WHERE gallery_slug = ? AND tag = ?').run(slug, tag);
        other.close();
        assert.strictEqual(favTotal(), countFav(), 'total after another connection reverted');
        const before = newNax.getGalleries().find((g) => g.slug === slug).tag_count;
        newNax.insertCustomTag(slug, 'perf test custom tag', 'perf.png');
        assert.strictEqual(newNax.getGalleries().find((g) => g.slug === slug).tag_count, before + 1, 'gallery list after insert');
        newNax.deleteCustomTag(slug, 'perf test custom tag');
        assert.strictEqual(newNax.getGalleries().find((g) => g.slug === slug).tag_count, before);
    }

    // findArtistPreview: one IN query vs up to 49 lookups.
    const od = oldNax.getDb();
    const names = od.prepare(
        "SELECT tag FROM nax_tags WHERE gallery_slug LIKE '%artist%' AND id % 97 = 0"
    ).all().map((r) => r.tag);
    const probes = [];
    names.forEach((n) => {
        probes.push(n, n.replace(/ /g, '_'), n.toUpperCase(), ` ${n.replace(/ /g, '  ')} `);
    });
    probes.push('', 'no such artist anywhere', 'artist_that_does_not_exist');
    const oldPrev = timeIt(() => probes.map((p) => oldNax.findArtistPreview(p)));
    const newPrev = timeIt(() => probes.map((p) => newNax.findArtistPreview(p)));
    assert.deepStrictEqual(newPrev.out, oldPrev.out);
    report(`findArtistPreview x${probes.length}`, oldPrev.ms, newPrev.ms, `${oldPrev.out.filter(Boolean).length} hits`);

    // search_nax (mcpAgentFacade.searchNaxTags): old facade + old DB module vs new + new.
    const oldFacade = loadBase('modules/mcpAgentFacade.js')._test;
    const newFacade = require('../modules/mcpAgentFacade')._test;
    const inputs = [];
    for (const kind of ['ALL', 'ARTIST', 'CHARA', 'COPYRIGHT']) {
        for (const sort of ['score', 'name', 'date', 'ratio']) {
            for (const invert of [false, true]) {
                inputs.push({ kind, sort, invert, limit: 20 });
            }
        }
        inputs.push({ kind, query: 'ka', sort: 'name', offset: 40, limit: 100 });
        inputs.push({ kind, sort: 'random', randomSeed: 3, limit: 30 });
        inputs.push({ kind, markFilter: 'favorites', limit: 50 });
    }
    const oldSearch = timeIt(() => inputs.map((input) => oldFacade.searchNaxTags(oldNax, input)));
    const newSearch = timeIt(() => inputs.map((input) => newFacade.searchNaxTags(newNax, input)));
    assert.deepStrictEqual(newSearch.out, oldSearch.out);
    report(`searchNaxTags x${inputs.length}`, oldSearch.ms, newSearch.ms);
    const allOld = timeIt(() => oldFacade.searchNaxTags(oldNax, { kind: 'ALL' }));
    const allNew = timeIt(() => newFacade.searchNaxTags(newNax, { kind: 'ALL' }));
    assert.deepStrictEqual(allNew.out, allOld.out);
    report('search_nax kind=ALL (one call, warm)', allOld.ms, allNew.ms);

    // sortNaxItems === Array#sort(compareNaxItems), including odd values and accents.
    const sample = oldNax.queryTags({ gallerySlug: galleries[0].slug, limit: 100 }).items.concat([
        { tag: 'Ecole', score: 5, upvotes: 1, exportIndex: 3 },
        { tag: String.fromCharCode(0xc9) + 'cole', score: 5, upvotes: 1, exportIndex: 2 },
        { tag: 'ecole', score: '5', upvotes: null, exportIndex: 'x' },
        { tag: null, score: NaN, upvotes: 2, downvotes: 2 },
        { tag: 'zeta', score: -3, upvotes: 0, downvotes: 0 }
    ]);
    for (const sort of ['score', 'name', 'date', 'ratio', 'random', 'bogus']) {
        for (const invert of [false, true]) {
            const want = sample.slice().sort((a, b) => newFacade.compareNaxItems(a, b, sort, invert));
            assert.deepStrictEqual(newFacade.sortNaxItems(sample, sort, invert), want, `sortNaxItems ${sort} ${invert}`);
        }
    }

    // The new (gallery_slug, score) index is used for the default sort.
    const plan = newNax.getDb().prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM nax_tags WHERE gallery_slug = 'x' ORDER BY score DESC, tag COLLATE NOCASE ASC LIMIT 100"
    ).all().map((r) => r.detail).join(' | ');
    assert.ok(/idx_nax_tags_gallery_score/.test(plan), plan);
    oldNax.closeDb();
    newNax.closeDb();
    console.log('  ok');
}

// ---------------------------------------------------------------- word lookup (finding 2)
async function testWordLookup() {
    console.log('wordLookup:');
    const t5 = require('../modules/t5-tokenizer-service');
    if (!(await quiet(() => t5.initialize()))) {
        console.log('  skipped (T5 tokenizer did not load)');
        return;
    }
    const gr = { getT5Tokenizer: () => t5, getSpellChecker: () => null };
    const OldWL = loadBase('modules/wordLookupService.js');
    const NewWL = require('../modules/wordLookupService');
    const oldSvc = new OldWL(gr);
    const newSvc = new NewWL(gr);
    const words = ['happy', 'big', 'run', 'light', 'dark', 'beautiful', 'cold', 'fast', 'girl', 'smile',
        'red', 'soft', 'strong', 'small', 'bright', 'sad', 'angry', 'water', 'fire', 'tree', 'zzzzqq'];
    // Moby synonyms with the same filtering lookupWord uses.
    const lists = words.map((w) => {
        const seen = new Set([w]);
        return { w, moby: newSvc.collectMobySynonyms(newSvc.getMobySynonyms(w), w, seen) };
    });
    const oldRank = timeIt(() => lists.map(({ w, moby }) => oldSvc.rankSynonyms(moby.slice(0, 5), moby.slice(5), w)));
    const newCold = timeIt(() => lists.map(({ w, moby }) => newSvc.rankSynonyms(moby.slice(0, 5), moby.slice(5), w)));
    const newWarm = timeIt(() => lists.map(({ w, moby }) => newSvc.rankSynonyms(moby.slice(0, 5), moby.slice(5), w)));
    assert.deepStrictEqual(newCold.out, oldRank.out);
    assert.deepStrictEqual(newWarm.out, oldRank.out);
    const total = lists.reduce((n, l) => n + l.moby.length, 0);
    report(`rankSynonyms ${words.length} words / ${total} synonyms`, oldRank.ms, newCold.ms, `warm cache ${newWarm.ms.toFixed(1)} ms`);

    // Strength cache is pure: same value as the tokenizer, and a not-ready tokenizer is not cached.
    lists.slice(0, 5).forEach(({ moby }) => moby.slice(0, 30).forEach((s) => {
        assert.strictEqual(newSvc.getSynonymStrength(s), oldSvc.getSynonymStrength(s));
    }));
    let ready = false;
    const lateSvc = new NewWL({ getT5Tokenizer: () => { if (!ready) throw new Error('not ready'); return t5; }, getSpellChecker: () => null });
    assert.strictEqual(lateSvc.getSynonymStrength('large'), 0);
    ready = true;
    assert.strictEqual(lateSvc.getSynonymStrength('large'), oldSvc.getSynonymStrength('large'));

    for (const w of ['happy', 'big', 'tree']) {
        const a = await oldSvc.lookupWord(w);
        const b = await newSvc.lookupWord(w);
        assert.deepStrictEqual(b, a, `lookupWord ${w}`);
    }
    console.log('  ok');
}

// ---------------------------------------------------------------- knowledge memory (finding 4)
function testKnowledge() {
    const oldDir = path.join(SCRATCH, 'km-old');
    const newDir = path.join(SCRATCH, 'km-new');
    if (!copyDb('knowledge_memory.db', oldDir)) {
        console.log('knowledge: skipped (no knowledge_memory.db)');
        return;
    }
    copyDb('knowledge_memory.db', newDir);
    console.log('knowledge:');
    const oldKm = loadBase('modules/knowledgeMemoryDatabase.js');
    const newKm = require('../modules/knowledgeMemoryDatabase');
    quiet(() => assert.strictEqual(oldKm.initializeKnowledgeMemoryDatabase(oldDir), true));
    quiet(() => assert.strictEqual(newKm.initializeKnowledgeMemoryDatabase(newDir), true));

    const ro = new Database(path.join(newDir, 'knowledge_memory.db'), { readonly: true });
    const rows = ro.prepare('SELECT name, description, category, model FROM knowledge_memories ORDER BY id').all();
    const obs = ro.prepare('SELECT content FROM knowledge_observations ORDER BY id').all();
    ro.close();
    const words = [];
    const addWords = (text) => String(text || '').toLowerCase().split(/[^a-z0-9]+/).forEach((w) => {
        if (w.length > 2 && !words.includes(w)) words.push(w);
    });
    rows.forEach((r) => { addWords(r.name.replace(/_/g, ' ')); addWords(r.description); });
    obs.slice(0, 200).forEach((o) => addWords(o.content));
    const pick = (n, step, offset) => {
        const out = [];
        for (let i = offset; out.length < n && i < words.length; i += step) out.push(words[i]);
        return out;
    };
    const queries = [];
    pick(40, Math.max(1, Math.floor(words.length / 40)), 0).forEach((w) => queries.push([w]));
    const pairs = pick(40, Math.max(1, Math.floor(words.length / 40)), 3);
    for (let i = 0; i + 1 < pairs.length; i += 2) queries.push([`${pairs[i]} ${pairs[i + 1]}`]);
    queries.push(['pose hands lighting']);
    queries.push(['a']);
    queries.push(['nothing-matches-this-qqq']);
    const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))].slice(0, 3);
    categories.forEach((c) => queries.push([pick(1, 1, 5)[0] || 'the', c]));
    const models = [...new Set(rows.map((r) => r.model).filter(Boolean))].slice(0, 2);
    models.forEach((m) => queries.push([pick(1, 1, 9)[0] || 'the', null, m]));

    const oldRun = timeIt(() => queries.map((q) => oldKm.searchKnowledgeMemories(...q)));
    const newRun = timeIt(() => queries.map((q) => newKm.searchKnowledgeMemories(...q)));
    let hits = 0;
    let full = 0;
    for (let i = 0; i < queries.length; i++) {
        // JSON text also checks key order.
        assert.strictEqual(JSON.stringify(newRun.out[i]), JSON.stringify(oldRun.out[i]), `search ${JSON.stringify(queries[i])}`);
        hits += oldRun.out[i].length;
        full += oldRun.out[i].filter((r) => r.full_memory).length;
    }
    report(`searchKnowledgeMemories x${queries.length}`, oldRun.ms, newRun.ms, `${hits} hits, ${full} full graphs`);
    oldKm.closeKnowledgeMemoryDatabase();
    newKm.closeKnowledgeMemoryDatabase();
    console.log('  ok');
}

// ---------------------------------------------------------------- mail exchange (finding 5)
function compareMailExchange(oldEx, newEx, label) {
    const oldList = oldEx.listMailboxRecords();
    const newList = newEx.listMailboxRecords();
    assert.strictEqual(JSON.stringify(newList), JSON.stringify(oldList), `${label}: listMailboxRecords`);
    const owners = oldList.map((r) => r.owner).concat(
        ['YUKIMI', ' mailroom ', 'Tsubame', 'nobody-here', '', null, undefined],
        oldList.map((r) => r.owner.toUpperCase())
    );
    for (const owner of owners) {
        assert.strictEqual(
            JSON.stringify(newEx.getMailboxRecord(owner)),
            JSON.stringify(oldEx.getMailboxRecord(owner)),
            `${label}: getMailboxRecord ${owner}`
        );
        assert.strictEqual(newEx.isActiveMailbox(owner), oldEx.isActiveMailbox(owner), `${label}: isActiveMailbox ${owner}`);
    }
    const n = 200;
    const target = oldList[Math.floor(oldList.length / 2)].owner;
    const oldT = timeIt(() => { for (let i = 0; i < n; i++) oldEx.isActiveMailbox(target); });
    const newT = timeIt(() => { for (let i = 0; i < n; i++) newEx.isActiveMailbox(target); });
    report(`${label}: isActiveMailbox x${n} (${oldList.length} mailboxes)`, oldT.ms, newT.ms);
}

function testMailExchange() {
    console.log('mailExchange:');
    const addresses = require('../modules/mailGatewayAddresses');
    const mailDb = require('../modules/mailExchangeDatabase');
    const newEx = require('../modules/mailExchange');
    const oldEx = loadBase('modules/mailExchange.js');
    const cfg = { config: { enabled: true }, mailGateway: { mailboxes: addresses.DEFAULT_MAILBOXES } };
    newEx.setTestConfig(cfg);
    oldEx.setTestConfig(cfg);

    const realDir = path.join(SCRATCH, 'mail-real');
    if (copyDb('mail_exchange.db', realDir)) {
        assert.strictEqual(quiet(() => mailDb.resetForTests(realDir)), true);
        compareMailExchange(oldEx, newEx, 'real db');
    } else {
        console.log('  real db: skipped (no mail_exchange.db)');
    }

    // Seeded db plus deleted / disabled / keyed / extra-address / db-only mailboxes.
    const seedDir = path.join(SCRATCH, 'mail-seed');
    fs.mkdirSync(seedDir, { recursive: true });
    assert.strictEqual(quiet(() => mailDb.resetForTests(seedDir)), true);
    const d = mailDb.getDb();
    const now = new Date().toISOString();
    const owners = d.prepare('SELECT owner FROM exchange_mailbox ORDER BY owner').all().map((r) => r.owner);
    if (owners[0]) d.prepare('UPDATE exchange_mailbox SET deleted_at = ? WHERE owner = ?').run(now, owners[0]);
    if (owners[1]) d.prepare('UPDATE exchange_mailbox SET enabled = 0 WHERE owner = ?').run(owners[1]);
    if (owners[2]) d.prepare('INSERT OR REPLACE INTO exchange_key (mailbox, key_hash, created_at, revoked_at) VALUES (?, ?, ?, NULL)').run(owners[2], 'h', now);
    if (owners[3]) d.prepare('INSERT OR REPLACE INTO exchange_key (mailbox, key_hash, created_at, revoked_at) VALUES (?, ?, ?, ?)').run(owners[3], 'h', now, now);
    if (owners[4]) {
        d.prepare('INSERT OR IGNORE INTO exchange_address (local_part, owner, is_primary, created_at) VALUES (?, ?, 0, ?)').run('zz.alias', owners[4], now);
        d.prepare('INSERT OR IGNORE INTO exchange_address (local_part, owner, is_primary, created_at) VALUES (?, ?, 0, ?)').run('aa.alias', owners[4], now);
    }
    d.prepare(`INSERT OR IGNORE INTO exchange_mailbox (owner, local_part, dept, display_name, enabled, created_at, updated_at, kind)
        VALUES ('dbonly', 'dbonly.lab', 'lab', 'DB Only', 1, ?, ?, 'bot')`).run(now, now);
    d.prepare('INSERT OR IGNORE INTO exchange_address (local_part, owner, is_primary, created_at) VALUES (?, ?, 1, ?)').run('dbonly.lab', 'dbonly', now);
    compareMailExchange(oldEx, newEx, 'seeded db');
    newEx.resetTestConfig();
    oldEx.resetTestConfig();
    mailDb.close();
    console.log('  ok');
}

// ---------------------------------------------------------------- reference metadata (finding 6)
// Same encoding filter the references WS listing uses.
function encodingsMetadataOf(encodings) {
    const out = [];
    if (encodings && typeof encodings === 'object') {
        for (const [model, modelEncodings] of Object.entries(encodings)) {
            if (modelEncodings && typeof modelEncodings === 'object') {
                for (const [extractionValue, encoding] of Object.entries(modelEncodings)) {
                    if (!encoding || (typeof encoding === 'string' && encoding.trim() === '')) continue;
                    const ieValue = parseFloat(extractionValue);
                    if (isNaN(ieValue)) continue;
                    out.push({ model, informationExtraction: ieValue });
                }
            }
        }
    }
    return out;
}

function compareVibeMaps(full, lean, label) {
    assert.deepStrictEqual(Object.keys(lean), Object.keys(full), `${label}: vibe ids`);
    for (const id of Object.keys(full)) {
        const { encodings: fe, ...frest } = full[id];
        const { encodings: le, ...lrest } = lean[id];
        assert.deepStrictEqual(lrest, frest, `${label}: vibe ${id}`);
        assert.deepStrictEqual(encodingsMetadataOf(le), encodingsMetadataOf(fe), `${label}: encodings ${id}`);
    }
}

async function testReferenceMetadata() {
    console.log('referenceMetadata:');
    const OldRef = loadBase('modules/referenceMetadataDatabase.js');
    const NewRef = require('../modules/referenceMetadataDatabase');

    // Presence mode on odd encodings (blank, spaces, leading space, normal).
    const synthDir = path.join(SCRATCH, 'ref-synth');
    fs.mkdirSync(synthDir, { recursive: true });
    const synth = quiet(() => new NewRef({ getPath: () => synthDir }));
    const sd = synth.db;
    sd.prepare("INSERT INTO reference_vibe_metadata (id, type, image_source) VALUES ('v1', 'cache', 'h1')").run();
    sd.prepare("INSERT INTO reference_vibe_workspace_ownership (vibe_id, workspace_id) VALUES ('v1', 'w1')").run();
    const encs = [['m1', 0.1, ''], ['m1', 0.2, '   '], ['m1', 0.3, ' abc'], ['m2', 1, 'xyz'], ['m2', 0.5, '\t\n'], ['m3', 0.7, String.fromCharCode(0xa0)]];
    const ins = sd.prepare('INSERT INTO reference_vibe_encodings (vibe_id, model, information_extraction, encoding) VALUES (?, ?, ?, ?)');
    encs.forEach(([m, ie, e]) => ins.run('v1', m, ie, e));
    const sFull = synth.getWorkspaceVibesWithData('w1');
    const sLean = synth.getWorkspaceVibesWithData('w1', { encodingPresence: true });
    compareVibeMaps(sFull, sLean, 'synthetic');
    assert.deepStrictEqual(encodingsMetadataOf(sLean.v1.encodings), [
        { model: 'm1', informationExtraction: 0.3 }, { model: 'm2', informationExtraction: 1 }
    ]);
    synth.close();

    const workDir = path.join(SCRATCH, 'ref-real');
    if (!copyDb('reference_metadata.db', workDir)) {
        console.log('  real db: skipped (no reference_metadata.db)');
        console.log('  ok');
        return;
    }
    const gr = { getPath: (name) => (name === 'databases' ? workDir : path.join(workDir, 'no-previews')) };
    // Record which rows the boot backfill visits, in order (no preview files here, so nothing is written).
    const blurhashBackfill = require('../modules/blurhashBackfill');
    const visited = [];
    const realRef = blurhashBackfill.encodeReferenceFileBlurhash;
    const realVibe = blurhashBackfill.encodeVibeBlurhash;
    blurhashBackfill.encodeReferenceFileBlurhash = async (hash) => { visited.push(`f:${hash}`); return null; };
    blurhashBackfill.encodeVibeBlurhash = async (vibe) => { visited.push(`v:${JSON.stringify(vibe)}`); return null; };
    const runBackfill = async (ref, options) => {
        visited.length = 0;
        const t = process.hrtime.bigint();
        const stats = await ref.backfillMissingBlurhashes({ log: () => {}, ...options });
        return { stats, visited: visited.slice(), ms: ms(t) };
    };

    const oldRef = quiet(() => new OldRef(gr));
    const oldMissing = await runBackfill(oldRef, {});
    const oldLimited = await runBackfill(oldRef, { limit: 2 });
    const oldForced = await runBackfill(oldRef, { force: true, limit: 50 });
    const wsIds = oldRef.db.prepare(
        'SELECT workspace_id FROM reference_vibe_workspace_ownership UNION SELECT workspace_id FROM reference_workspace_ownership'
    ).all().map((r) => r.workspace_id);
    const oldAll = timeIt(() => oldRef.getWorkspaceReferencesAndVibesWithData(wsIds));
    const oldOne = wsIds.map((id) => oldRef.getWorkspaceReferencesAndVibesWithData(id));
    oldRef.close();

    const newRef = quiet(() => new NewRef(gr));
    const newMissing = await runBackfill(newRef, {});
    const newLimited = await runBackfill(newRef, { limit: 2 });
    assert.deepStrictEqual(newMissing.stats, oldMissing.stats, 'backfill totals');
    assert.deepStrictEqual(newMissing.visited, oldMissing.visited, 'backfill rows and order');
    assert.deepStrictEqual(newLimited.visited, oldLimited.visited, 'backfill rows under limit');
    const newForced = await runBackfill(newRef, { force: true, limit: 50 });
    assert.deepStrictEqual(newForced.visited, oldForced.visited, 'forced backfill rows');
    const plan = newRef.db.prepare(
        "EXPLAIN QUERY PLAN SELECT rowid AS row_order, id, preview_hash, image_source, type FROM reference_vibe_metadata WHERE blurhash IS NULL OR blurhash = ''"
    ).all().map((r) => r.detail).join(' | ');
    assert.ok(/blurhash_missing/.test(plan), plan);
    report('backfillMissingBlurhashes (warm, nothing to encode)', oldMissing.ms, newMissing.ms,
        `${newMissing.stats.refsTotal} files, ${newMissing.stats.vibesTotal} vibes missing`);
    blurhashBackfill.encodeReferenceFileBlurhash = realRef;
    blurhashBackfill.encodeVibeBlurhash = realVibe;

    const newAll = timeIt(() => newRef.getWorkspaceReferencesAndVibesWithData(wsIds));
    assert.deepStrictEqual(newAll.out, oldAll.out, 'full mode unchanged');
    const leanAll = timeIt(() => newRef.getWorkspaceReferencesAndVibesWithData(wsIds, { encodingPresence: true }));
    assert.deepStrictEqual(leanAll.out.cacheFiles, oldAll.out.cacheFiles);
    compareVibeMaps(oldAll.out.vibes, leanAll.out.vibes, 'all workspaces');
    report(`references listing, ${wsIds.length} workspaces`, oldAll.ms, leanAll.ms,
        `payload in memory ${(JSON.stringify(oldAll.out).length / 1e6).toFixed(1)} MB -> ${(JSON.stringify(leanAll.out).length / 1e6).toFixed(2)} MB`);
    wsIds.forEach((id, i) => {
        const lean = newRef.getWorkspaceReferencesAndVibesWithData(id, { encodingPresence: true });
        assert.deepStrictEqual(lean.cacheFiles, oldOne[i].cacheFiles);
        compareVibeMaps(oldOne[i].vibes, lean.vibes, `workspace ${id}`);
        assert.deepStrictEqual(newRef.getWorkspaceReferencesWithData(id), oldOne[i].cacheFiles, `replace check ${id}`);
    });
    newRef.close();
    console.log('  ok');
}

// ---------------------------------------------------------------- MetadataCache (finding 7)
function testMetadataCache() {
    console.log('metadataCache:');
    const { WebSocketMessageHandlers } = require('../modules/websocketHandlers');
    const handlers = new WebSocketMessageHandlers({});
    handlers.metadataCache.stopCleanup();
    const MetadataCache = handlers.metadataCache.constructor;
    const c = new MetadataCache(3);
    c.set('w', 'a', 1);
    c.set('w', 'b', 2);
    c.set('w', 'c', 3);
    assert.strictEqual(c.get('w', 'a'), 1); // a is now most recent
    c.set('w', 'd', 4); // evicts b
    assert.strictEqual(c.get('w', 'b'), null);
    assert.deepStrictEqual([...c.getWorkspaceCache('w').keys()], ['c', 'a', 'd']);
    c.set('w', 'c', 33); // update moves c to the end, no eviction
    assert.deepStrictEqual([...c.getWorkspaceCache('w').keys()], ['a', 'd', 'c']);
    assert.strictEqual(c.get('w', 'c'), 33);
    c.set('w', 'e', 5); // evicts a
    assert.deepStrictEqual([...c.getWorkspaceCache('w').keys()], ['d', 'c', 'e']);

    const oldHandlers = new (loadBase('modules/websocketHandlers.js').WebSocketMessageHandlers)({});
    oldHandlers.metadataCache.stopCleanup();
    const OldMetadataCache = oldHandlers.metadataCache.constructor;
    const n = 20000;
    const fill = (cache) => timeIt(() => { for (let i = 0; i < n; i++) cache.set('w', `f${i}`, i); });
    const oldBig = new OldMetadataCache(1000);
    const big = new MetadataCache(1000);
    const oldT = fill(oldBig);
    const t = fill(big);
    assert.strictEqual(big.getWorkspaceCache('w').size, 1000);
    assert.strictEqual(big.get('w', `f${n - 1}`), n - 1);
    assert.deepStrictEqual([...big.getWorkspaceCache('w').keys()], [...oldBig.getWorkspaceCache('w').keys()]);
    report(`${n} sets into a full 1000-entry cache`, oldT.ms, t.ms);

    // Content length: one stat for a file, null when missing.
    const imagesDir = path.join(SCRATCH, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(path.join(imagesDir, 'x.png'), Buffer.alloc(123));
    const h2 = Object.create(WebSocketMessageHandlers.prototype);
    h2.globalResources = { getPath: () => imagesDir };
    assert.strictEqual(h2.resolveGeneratedImageContentLength({ filename: 'x.png' }), 123);
    assert.strictEqual(h2.resolveGeneratedImageContentLength({ filename: 'missing.png' }), null);
    assert.strictEqual(h2.resolveGeneratedImageContentLength({ image: Buffer.alloc(10).toString('base64') }), 10);
    assert.strictEqual(h2.resolveGeneratedImageContentLength({ buffer: Buffer.alloc(7) }), 7);
    console.log('  ok');
}

// ---------------------------------------------------------------- search turn (finding 8)
async function measureTurnHandoff(SearchService, delayMs) {
    const service = new SearchService({ getConfig: () => ({}) });
    const key = 'sess_v5';
    let release;
    service.processLatestRequest = async () => {
        await new Promise((resolve) => { release = resolve; });
        return { results: [], spellCheck: null };
    };
    service.latestRequests.set(key, { requestId: 'r1' });
    const first = service.waitForSearchTurn(key, 'r1');
    await new Promise((r) => setImmediate(r));
    // r2 replaces r1 as latest and parks behind the running turn.
    service.latestRequests.set(key, { requestId: 'r2' });
    let secondDoneAt = 0;
    service.processLatestRequest = async () => ({ results: ['r2'], spellCheck: null });
    const second = service.waitForSearchTurn(key, 'r2').then((res) => { secondDoneAt = Date.now(); return res; });
    await new Promise((r) => setTimeout(r, delayMs));
    const releasedAt = Date.now();
    release();
    const [a, b] = await Promise.all([first, second]);
    return { a, b, latency: secondDoneAt - releasedAt };
}

async function testSearchTurn() {
    console.log('searchTurn:');
    const { SearchService } = require('../modules/searchService');
    const Old = loadBase('modules/searchService.js').SearchService;
    const runs = { old: [], new: [] };
    for (let i = 0; i < 5; i++) {
        const o = await measureTurnHandoff(Old, 30 + i * 3);
        const n = await measureTurnHandoff(SearchService, 30 + i * 3);
        assert.deepStrictEqual(n.a, o.a);
        assert.deepStrictEqual(n.b, o.b);
        assert.deepStrictEqual(n.b.results, ['r2']);
        runs.old.push(o.latency);
        runs.new.push(n.latency);
    }
    const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    report('next search starts after release (avg of 5)', avg(runs.old), avg(runs.new));
    console.log('  ok');
}

// ---------------------------------------------------------------- dovecote (finding 9)
async function testDovecote() {
    console.log('dovecote:');
    const dir = path.join(SCRATCH, 'dovecote');
    fs.mkdirSync(dir, { recursive: true });
    const dovecoteDatabase = require('../modules/dovecoteDatabase');
    assert.strictEqual(quiet(() => dovecoteDatabase.initializeDovecoteDatabase(dir)), true);
    const mail = require('../modules/dovecoteMail');
    const data = Buffer.alloc(256 * 1024, 7);
    mail.sendMail({
        fromOwner: 'menma', to: 'rook', subject: 'perf file', body: 'attached',
        attachments: [{ name: 'a.bin', mimeType: 'application/octet-stream', data }]
    });
    const inbox = mail.listMail('rook', { folder: 'inbox' }).find((m) => m.subject === 'perf file');
    const attId = inbox.attachments[0].id;
    const syncHit = mail.getAttachment('rook', attId);
    const asyncHit = await mail.getAttachmentAsync('rook', attId);
    assert.deepStrictEqual(asyncHit, syncHit);
    assert.ok(asyncHit.data.equals(data));
    assert.strictEqual(await mail.getAttachmentAsync('hoshino', attId), mail.getAttachment('hoshino', attId));
    assert.strictEqual(await mail.getAttachmentAsync('rook', '00000000-0000-4000-8000-000000000000'), null);
    // Shared blob gone: both fall back the same way (null here, no legacy file).
    fs.rmSync(path.join(dovecoteDatabase.getAttachmentsRoot(), 'shared', attId));
    assert.strictEqual(await mail.getAttachmentAsync('rook', attId), mail.getAttachment('rook', attId));
    await assert.rejects(() => mail.getAttachmentAsync('not a mailbox!', attId), { code: 'UNKNOWN_OWNER' });
    console.log('  ok');
}

async function main() {
    try {
        testNax();
        await testWordLookup();
        testKnowledge();
        testMailExchange();
        await testReferenceMetadata();
        testMetadataCache();
        await testSearchTurn();
        await testDovecote();
        console.log('test-perf-f-lookups: ok');
    } finally {
        fs.rmSync(SCRATCH, { recursive: true, force: true });
    }
}

main().then(() => process.exit(0), (err) => {
    console.error(err);
    process.exit(1);
});
