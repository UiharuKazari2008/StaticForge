#!/usr/bin/env node
/**
 * Cheap daily hash poll for NovelAI public web-app surfaces (no auth).
 *
 * Usage:
 *   node scripts/nai-webapp-watch/poll-hashes.js
 *   node scripts/nai-webapp-watch/poll-hashes.js --write
 *   node scripts/nai-webapp-watch/poll-hashes.js --json
 *
 * Public only: home HTML + chunk path list, updateReload.json, tokenizer ETag,
 * journal/blog announcement pages. Never hits generate or authenticated APIs.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const ROOT = path.join(__dirname, '..', '..');
const STATE_PATH = path.join(ROOT, '.cursor', 'nai-webapp-watch', 'state.json');

const PUBLIC_ENDPOINTS = {
    home: 'https://novelai.net/',
    updateReload: 'https://novelai.net/updateReload.json',
    tokenizerQwen: 'https://novelai.net/tokenizer/compressed/qwen35_tokenizer.def?v=2&static=true',
    journalV5: 'https://journal.novelai.net/image-generation-novelai-diffusion-v5-is-here-c2df7c6b8d2d/',
    blogUsage: 'https://blog.novelai.net/subscription-updates-usage-limits-2025-88a208d5d9c5'
};

const USER_AGENT = 'StaticForge-nai-webapp-watch/1.0 (+local hash poll; no auth)';

function sha256(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchUrl(url, { method = 'GET', accept = '*/*' } = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method,
            headers: {
                Accept: accept,
                'User-Agent': USER_AGENT
            }
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks)
                });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function extractChunkPaths(html) {
    const re = /\/_next\/static\/chunks\/[^"'\s>?#]+\.js/g;
    const found = new Set();
    for (const match of html.matchAll(re)) {
        found.add(match[0]);
    }
    return [...found].sort();
}

async function probeEndpoint(key, url, { hashBody = true, accept = '*/*' } = {}) {
    const res = await fetchUrl(url, { accept });
    const entry = {
        url,
        status: res.status,
        bytes: res.body.length,
        etag: res.headers.etag || null,
        lastModified: res.headers['last-modified'] || null
    };
    if (hashBody && res.body.length > 0) {
        entry.sha256 = sha256(res.body);
    }
    if (res.status >= 400) {
        entry.error = `HTTP ${res.status}`;
    }
    return entry;
}

async function collectSnapshot() {
    const homeRes = await fetchUrl(PUBLIC_ENDPOINTS.home, { accept: 'text/html' });
    const homeHtml = homeRes.body.toString('utf8');
    const chunkPaths = extractChunkPaths(homeHtml);
    const chunkPathsSha256 = sha256(chunkPaths.join('\n'));

    const home = {
        url: PUBLIC_ENDPOINTS.home,
        status: homeRes.status,
        bytes: homeRes.body.length,
        chunkCount: chunkPaths.length,
        chunkPathsSha256,
        chunkPathsSample: chunkPaths.slice(0, 8)
    };

    await sleep(150);
    const updateReload = await probeEndpoint('updateReload', PUBLIC_ENDPOINTS.updateReload, {
        accept: 'application/json'
    });
    await sleep(150);
    const tokenizerQwen = await probeEndpoint('tokenizerQwen', PUBLIC_ENDPOINTS.tokenizerQwen, {
        hashBody: false,
        accept: 'application/json,text/plain,*/*'
    });
    await sleep(150);
    const journalV5 = await probeEndpoint('journalV5', PUBLIC_ENDPOINTS.journalV5, {
        accept: 'text/html'
    });
    await sleep(150);
    const blogUsage = await probeEndpoint('blogUsage', PUBLIC_ENDPOINTS.blogUsage, {
        accept: 'text/html'
    });

    return {
        version: 1,
        capturedAt: new Date().toISOString(),
        policy: 'Public endpoints only. No JWT, recaptcha, cookies, or generate APIs.',
        sources: {
            home,
            updateReload,
            tokenizerQwen,
            journalV5,
            blogUsage
        }
    };
}

function loadState() {
    if (!fs.existsSync(STATE_PATH)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function compareKeys(snapshot, previous) {
    const changed = [];
    const keys = Object.keys(snapshot.sources);
    for (const key of keys) {
        const cur = snapshot.sources[key];
        const prev = previous?.sources?.[key];
        if (!prev) {
            changed.push({ key, reason: 'new baseline field' });
            continue;
        }
        if (key === 'home') {
            if (cur.chunkPathsSha256 !== prev.chunkPathsSha256) {
                changed.push({
                    key,
                    reason: 'chunkPathsSha256',
                    from: (prev.chunkPathsSha256 || '').slice(0, 12),
                    to: (cur.chunkPathsSha256 || '').slice(0, 12)
                });
            } else if (cur.chunkCount !== prev.chunkCount) {
                changed.push({ key, reason: 'chunkCount', from: prev.chunkCount, to: cur.chunkCount });
            }
            continue;
        }
        if (cur.status !== prev.status) {
            changed.push({ key, reason: 'status', from: prev.status, to: cur.status });
            continue;
        }
        if (cur.status >= 400) {
            continue;
        }
        if (cur.sha256 && prev.sha256 && cur.sha256 !== prev.sha256) {
            changed.push({ key, reason: 'sha256', from: prev.sha256.slice(0, 12), to: cur.sha256.slice(0, 12) });
            continue;
        }
        if (cur.etag && prev.etag && cur.etag !== prev.etag) {
            changed.push({ key, reason: 'etag', from: prev.etag, to: cur.etag });
        }
    }
    return changed;
}

function parseArgs(argv) {
    return {
        write: argv.includes('--write'),
        json: argv.includes('--json'),
        help: argv.includes('--help') || argv.includes('-h')
    };
}

async function main() {
    const opts = parseArgs(process.argv);
    if (opts.help) {
        console.log(`Usage: node scripts/nai-webapp-watch/poll-hashes.js [--write] [--json]

Writes baseline to ${STATE_PATH} with --write.
`);
        process.exit(0);
    }

    const snapshot = await collectSnapshot();
    const previous = loadState();
    const changed = previous ? compareKeys(snapshot, previous) : [];
    const report = {
        ok: changed.length === 0,
        changed,
        snapshot,
        previousCapturedAt: previous?.capturedAt || null,
        statePath: STATE_PATH
    };

    if (opts.write) {
        fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
        fs.writeFileSync(STATE_PATH, JSON.stringify(snapshot, null, 2) + '\n');
        report.wroteState = true;
    }

    if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log('[nai-webapp-watch]', JSON.stringify({
            ok: report.ok,
            changed: report.changed,
            previousCapturedAt: report.previousCapturedAt,
            capturedAt: snapshot.capturedAt,
            chunkCount: snapshot.sources.home.chunkCount
        }));
    }

    process.exit(report.ok ? 0 : 2);
}

main().catch((err) => {
    console.error('[nai-webapp-watch] fatal', err.message);
    process.exit(1);
});
