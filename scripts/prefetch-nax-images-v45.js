/**
 * Prefetch NAX CDN images (same layout as the app: .cache/nax_images/<slug>/<filename>).
 *
 * Usage:
 *   node scripts/prefetch-nax-images-v45.js
 *   node scripts/prefetch-nax-images-v45.js --version v5
 *   node scripts/prefetch-nax-images-v45.js --cache /path/to/.cache
 *   node scripts/prefetch-nax-images-v45.js --slug danbooru-character-tags-v4.5
 *
 * Default: all galleries with version containing "4.5".
 * --version v5 | 4.5 | all  (ignored when --slug is set)
 * With --slug: only that gallery (must exist in nax_galleries).
 *
 * Downloads are serial (one HTTPS fetch at a time) to stay light on the CDN.
 * Requires: npm import DB from scripts/import-nax-tags.js (.cache/nax_tags.db).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { pipeline } = require('stream');
const Database = require('better-sqlite3');

const CDN_BASE = 'https://cdn.zele.st/data/NAX/Images';

const ROOT = path.join(__dirname, '..');
const DEFAULT_DB = path.join(ROOT, '.cache', 'nax_tags.db');
const DEFAULT_CACHE = path.join(ROOT, '.cache');

function parseArgs() {
    const out = { cacheDir: DEFAULT_CACHE, dbPath: DEFAULT_DB, slug: null, version: '4.5' };
    for (let i = 2; i < process.argv.length; i++) {
        if (process.argv[i] === '--cache' && process.argv[i + 1]) {
            out.cacheDir = path.resolve(process.argv[++i]);
        } else if (process.argv[i] === '--db' && process.argv[i + 1]) {
            out.dbPath = path.resolve(process.argv[++i]);
        } else if (process.argv[i] === '--version' && process.argv[i + 1]) {
            const v = String(process.argv[++i]).trim().toLowerCase();
            if (v !== 'v5' && v !== '5' && v !== '4.5' && v !== 'v4.5' && v !== 'all') {
                console.error('Invalid --version (allowed: v5, 4.5, all)');
                process.exit(1);
            }
            out.version = v === '5' ? 'v5' : (v === 'v4.5' ? '4.5' : v);
        } else if (process.argv[i] === '--slug' && process.argv[i + 1]) {
            const s = String(process.argv[++i]).trim();
            if (!/^[a-z0-9._-]+$/i.test(s) || s.includes('..')) {
                console.error('Invalid --slug (allowed: letters, digits, . _ -)');
                process.exit(1);
            }
            out.slug = s;
        }
    }
    return out;
}

function versionWhereSql(version) {
    if (version === 'all') return { sql: '1=1', label: 'all galleries' };
    if (version === 'v5') return { sql: "g.version LIKE '%v5%'", label: 'all v5 galleries' };
    return { sql: "g.version LIKE '%4.5%'", label: 'all v4.5 galleries' };
}

function cdnUrl(slug, dbFilename) {
    const pathSeg = encodeURIComponent(String(dbFilename));
    return `${CDN_BASE}/${slug}/${pathSeg}`;
}

/**
 * @returns {Promise<'ok'|'skip'>}
 */
function downloadOne(slug, dbFilename, destPath) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(destPath)) {
            resolve('skip');
            return;
        }
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const tmpPath = `${destPath}.${crypto.randomBytes(8).toString('hex')}.part`;
        const url = cdnUrl(slug, dbFilename);

        const req = https.get(url, (upstream) => {
            if (upstream.statusCode !== 200) {
                upstream.resume();
                fs.unlink(tmpPath, () => {});
                reject(new Error(`HTTP ${upstream.statusCode} ${url}`));
                return;
            }
            const file = fs.createWriteStream(tmpPath, { flags: 'w' });
            pipeline(upstream, file, (err) => {
                if (err) {
                    fs.unlink(tmpPath, () => {});
                    reject(err);
                    return;
                }
                fs.rename(tmpPath, destPath, (renameErr) => {
                    if (!renameErr) {
                        resolve('ok');
                        return;
                    }
                    if (renameErr.code === 'EEXIST' || fs.existsSync(destPath)) {
                        fs.unlink(tmpPath, () => {});
                        resolve('skip');
                        return;
                    }
                    fs.unlink(tmpPath, () => {});
                    reject(renameErr);
                });
            });
        });
        req.on('error', (e) => {
            fs.unlink(tmpPath, () => {});
            reject(e);
        });
    });
}

async function main() {
    const { cacheDir, dbPath, slug, version } = parseArgs();

    if (!fs.existsSync(dbPath)) {
        console.error('Database not found:', dbPath);
        console.error('Run: node scripts/import-nax-tags.js');
        process.exit(1);
    }

    const db = new Database(dbPath, { readonly: true });
    let rows;
    if (slug) {
        const gal = db.prepare('SELECT slug, title FROM nax_galleries WHERE slug = ?').get(slug);
        if (!gal) {
            console.error('Unknown gallery slug:', slug);
            db.close();
            process.exit(1);
        }
        rows = db
            .prepare(
                `
            SELECT DISTINCT gallery_slug AS slug, filename
            FROM nax_tags
            WHERE gallery_slug = ?
            ORDER BY filename
        `
            )
            .all(slug);
    } else {
        const ver = versionWhereSql(version);
        rows = db
            .prepare(
                `
            SELECT DISTINCT t.gallery_slug AS slug, t.filename
            FROM nax_tags t
            INNER JOIN nax_galleries g ON g.slug = t.gallery_slug
            WHERE ${ver.sql}
            ORDER BY t.gallery_slug, t.filename
        `
            )
            .all();
    }

    db.close();

    if (!rows.length) {
        console.log(slug ? `No tags for gallery "${slug}". Nothing to do.` : `No (slug, filename) rows for ${versionWhereSql(version).label}. Nothing to do.`);
        process.exit(0);
    }

    const naxRoot = path.join(cacheDir, 'nax_images');
    let ok = 0;
    let skipped = 0;
    let failed = 0;

    const scopeLabel = slug ? `gallery "${slug}"` : versionWhereSql(version).label;
    console.log(`Prefetch ${rows.length} images (${scopeLabel}) → ${naxRoot} (serial)`);

    for (let i = 0; i < rows.length; i++) {
        const { slug, filename } = rows[i];
        const dest = path.join(naxRoot, slug, filename);
        try {
            const r = await downloadOne(slug, filename, dest);
            if (r === 'skip') skipped++;
            else ok++;
        } catch (e) {
            failed++;
            console.error(`[${i + 1}/${rows.length}] ${slug}/${filename}:`, e.message || e);
        }
        if ((i + 1) % 50 === 0 || i === rows.length - 1) {
            console.log(`Progress ${i + 1}/${rows.length} (ok ${ok}, skip ${skipped}, fail ${failed})`);
        }
    }

    console.log('Done. ok:', ok, 'skipped (already cached):', skipped, 'failed:', failed);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
