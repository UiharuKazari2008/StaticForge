const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const { syncNaxTags, snapshotTags } = require('../modules/naxTagSync');

function exportOf(galleries) {
    const out = {};
    for (const [slug, tags] of Object.entries(galleries)) {
        out[slug] = {
            title: slug,
            version: 'v5',
            description: '',
            tags: tags.map((tag) => ({
                tag: tag.tag,
                filename: tag.filename || `${tag.tag}.webp`,
                votes: { up: tag.up || 0, down: tag.down || 0, score: tag.score || 0 }
            }))
        };
    }
    return { metadata: { version: '2.0' }, galleries: out };
}

function zipOf(data) {
    const zip = new AdmZip();
    zip.addFile('tags.json', Buffer.from(JSON.stringify(data)));
    return zip.toBuffer();
}

function mockFetch(status, body, headers) {
    const map = {};
    Object.entries(headers || {}).forEach(([key, value]) => {
        map[key.toLowerCase()] = value;
    });
    return async (_url, init) => {
        mockFetch.lastHeaders = init && init.headers;
        return {
            status,
            ok: status >= 200 && status < 300,
            headers: { get: (name) => map[String(name).toLowerCase()] || null },
            async arrayBuffer() { return body; }
        };
    };
}

function row(dbPath, slug, tag) {
    const db = new Database(dbPath, { readonly: true });
    try {
        return db.prepare('SELECT * FROM nax_tags WHERE gallery_slug = ? AND tag = ?').get(slug, tag);
    } finally {
        db.close();
    }
}

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nax-tag-sync-'));
    const dbPath = path.join(root, 'nax_tags.db');
    const stateDir = path.join(root, 'state');
    const base = exportOf({
        g1: [{ tag: 'a', score: 1, up: 1 }, { tag: 'b', score: 2, up: 2 }],
        g2: [{ tag: 'c', score: 3, up: 3 }]
    });
    const baseZip = zipOf(base);

    const first = await syncNaxTags({
        dbPath,
        stateDir,
        fetchImpl: mockFetch(200, baseZip, { etag: '"v1"', 'last-modified': 'Sat, 26 Sep 2026 14:00:53 GMT' })
    });
    assert.strictEqual(first.unchanged, false);
    assert.strictEqual(first.added, 3);
    assert.strictEqual(first.updated, 0);
    assert.strictEqual(first.removed, 0);
    assert.ok(fs.existsSync(path.join(stateDir, 'tags.zip')));

    const db = new Database(dbPath);
    db.prepare('UPDATE nax_tags SET favorite = 1, score = 999 WHERE gallery_slug = ? AND tag = ?').run('g1', 'a');
    db.prepare(`
        INSERT INTO nax_tags (gallery_slug, tag, filename, upvotes, downvotes, score, favorite, export_index, is_custom)
        VALUES ('g1', 'mine', 'mine.webp', 0, 0, 0, 1, 9, 1)
    `).run();
    db.close();

    const same = await syncNaxTags({
        dbPath,
        stateDir,
        fetchImpl: mockFetch(200, baseZip, { etag: '"v1"', 'last-modified': 'Sat, 26 Sep 2026 14:00:53 GMT' })
    });
    assert.strictEqual(same.unchanged, true);
    assert.strictEqual(same.reason, 'sha256');
    assert.strictEqual(row(dbPath, 'g1', 'a').score, 999);
    assert.strictEqual(row(dbPath, 'g1', 'a').favorite, 1);
    assert.strictEqual(row(dbPath, 'g1', 'mine').is_custom, 1);

    const notModified = await syncNaxTags({
        dbPath,
        stateDir,
        fetchImpl: mockFetch(304, Buffer.alloc(0), { etag: '"v1"' })
    });
    assert.strictEqual(notModified.unchanged, true);
    assert.strictEqual(notModified.reason, 'not-modified');
    assert.strictEqual(mockFetch.lastHeaders['If-None-Match'], '"v1"');
    assert.strictEqual(row(dbPath, 'g1', 'a').score, 999);

    const beforeBad = snapshotTags(dbPath);
    for (const bad of [Buffer.alloc(0), Buffer.from('not a zip'), zipOf({ galleries: {} }), zipOf({ nope: true })]) {
        const status = bad.length ? 200 : 200;
        await assert.rejects(
            () => syncNaxTags({
                dbPath,
                stateDir,
                fetchImpl: mockFetch(status, bad, { etag: '"bad"' })
            }),
            (err) => err && err.code === 'NAX_DOWNLOAD'
        );
        assert.deepStrictEqual(snapshotTags(dbPath), beforeBad);
    }
    await assert.rejects(
        () => syncNaxTags({
            dbPath,
            stateDir,
            fetchImpl: mockFetch(500, Buffer.from('nope'), {})
        }),
        (err) => err && err.code === 'NAX_DOWNLOAD'
    );
    assert.deepStrictEqual(snapshotTags(dbPath), beforeBad);

    const reset = new Database(dbPath);
    reset.prepare('UPDATE nax_tags SET score = 1 WHERE gallery_slug = ? AND tag = ?').run('g1', 'a');
    reset.close();

    const diff = exportOf({
        g1: [
            { tag: 'a', score: 1, up: 1 },
            { tag: 'b', score: 9, up: 9 },
            { tag: 'd', score: 4, up: 4 }
        ]
    });
    const applied = await syncNaxTags({
        dbPath,
        stateDir,
        fetchImpl: mockFetch(200, zipOf(diff), { etag: '"v2"', 'last-modified': 'Fri, 09 Oct 2026 12:00:00 GMT' })
    });
    assert.strictEqual(applied.unchanged, false);
    assert.strictEqual(applied.added, 1);
    assert.strictEqual(applied.updated, 1);
    assert.strictEqual(applied.removed, 1);
    const kept = row(dbPath, 'g1', 'a');
    assert.strictEqual(kept.favorite, 1);
    assert.strictEqual(kept.score, 1);
    assert.strictEqual(row(dbPath, 'g1', 'b').score, 9);
    assert.strictEqual(row(dbPath, 'g1', 'd').tag, 'd');
    assert.strictEqual(row(dbPath, 'g2', 'c'), undefined);
    assert.strictEqual(row(dbPath, 'g1', 'mine').is_custom, 1);
    const check = new Database(dbPath, { readonly: true });
    const g2 = check.prepare('SELECT slug FROM nax_galleries WHERE slug = ?').get('g2');
    const g1 = check.prepare('SELECT tag_count FROM nax_galleries WHERE slug = ?').get('g1');
    check.close();
    assert.strictEqual(g2, undefined);
    assert.strictEqual(g1.tag_count, 4);

    fs.rmSync(root, { recursive: true, force: true });
    console.log('test-nax-tag-sync: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
