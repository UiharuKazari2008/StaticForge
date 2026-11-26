#!/usr/bin/env node
'use strict';

// Yozora DreamScape/StaticForge#1243: the X-File-Hash a static file is sent with must be the sha256 of the
// body actually sent. public/sw.js bodyMatchesClaimedHash refuses to cache a response whose sha256(body) differs
// from X-File-Hash, so a wrong header leaves a client without that file. The bug this guards: in dev mode (cookie
// staticforge_dev_mode=1) runtime-managed .js/.css were sent as raw source while the header claimed the compiled
// copy's hash.
//
// What it does (read-only, GETs only, bounded concurrency, against the LIVE server):
//   1. signs in with ~/.secrets/dreamscape-dev-login.key (GET /agent, Bearer) and keeps the connect.sid cookie;
//   2. takes the manifest the clients get: OPTIONS / (url + hash rows, the legacy package set). If that fails it
//      falls back to .cache/asset-manifest.json (path + hash) and says so;
//   3. for every entry with a sha256 hash, GETs the url and checks status 200, X-File-Hash (if sent) == sha256(body),
//      and reports manifest hash != sha256(body) separately (manifest stale vs served);
//   4. runs that in normal mode and in dev mode (extra cookie staticforge_dev_mode=1).
//
// Usage: node scripts/test-file-hash-matches-body.js [--base http://127.0.0.1:9220] [--mode normal|dev|both] [--limit N]
// Exit 1 on any header mismatch, manifest-vs-body mismatch (dev-mode source bodies excepted), non-200 other than a
// redirect, or fetch error, else 0.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const BASE = opt('--base', 'http://127.0.0.1:9220').replace(/\/+$/, '');
const MODE = opt('--mode', 'both');
const LIMIT = Number(opt('--limit', '0')) || 0;
const CONCURRENCY = 8;
const MAX_LIST = Number(opt("--list", "30"));
if (!['normal', 'dev', 'both'].includes(MODE)) { console.error('--mode must be normal, dev or both'); process.exit(2); }

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isSha = (h) => typeof h === 'string' && /^[0-9a-f]{64}$/i.test(h);
const short = (h) => (h ? String(h).slice(0, 10) : '-');

async function signIn() {
    const key = fs.readFileSync(path.join(os.homedir(), '.secrets', 'dreamscape-dev-login.key'), 'utf8').trim();
    const res = await fetch(`${BASE}/agent`, { headers: { Authorization: `Bearer ${key}`, 'X-Forwarded-Proto': 'https' }, redirect: 'manual' });
    await res.arrayBuffer();
    const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
    const sid = cookies.map((c) => /connect\.sid=[^;]*/.exec(c)).find(Boolean);
    if (!sid) throw new Error(`sign-in gave no connect.sid cookie (HTTP ${res.status})`);
    return sid[0];
}

async function loadManifest(sid) {
    try {
        const res = await fetch(`${BASE}/`, { method: 'OPTIONS', headers: { Cookie: sid, 'X-Forwarded-Proto': 'https' } });
        if (res.status === 200) {
            const rows = await res.json();
            if (Array.isArray(rows) && rows.length) {
                return { source: 'OPTIONS / (the manifest clients get, legacy package set)', rows: rows.map((r) => ({ url: r.url, hash: r.hash })) };
            }
        }
        console.error(`OPTIONS / gave HTTP ${res.status}, falling back to the cache file`);
    } catch (e) {
        console.error(`OPTIONS / failed (${e.message}), falling back to the cache file`);
    }
    const file = path.join(__dirname, '..', '.cache', 'asset-manifest.json');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { source: '.cache/asset-manifest.json (fallback)', rows: (j.assets || []).map((a) => ({ url: a.path, hash: a.hash })) };
}

async function runMode(label, rows, sid, dev) {
    const cookie = dev ? `${sid}; staticforge_dev_mode=1` : sid;
    const r = { checked: 0, headerMismatch: [], manifestMismatch: [], devSource: 0, non200: [], errors: [] };
    let next = 0;
    const worker = async () => {
        while (next < rows.length) {
            const row = rows[next++];
            try {
                const res = await fetch(BASE + row.url, { headers: { Cookie: cookie, 'X-Forwarded-Proto': 'https' }, redirect: 'manual' });
                const body = Buffer.from(await res.arrayBuffer());
                if (res.status !== 200) { r.non200.push({ url: row.url, status: res.status }); continue; }
                r.checked++;
                const actual = sha256(body);
                const claimed = res.headers.get('x-file-hash');
                if (claimed && claimed.toLowerCase() !== actual) r.headerMismatch.push({ url: row.url, claimed, actual });
                if (row.hash.toLowerCase() !== actual) {
                    // dev mode sends a managed file's unminified source on purpose: it differs from the manifest's
                    // compiled hash by design, and is fine as long as X-File-Hash names it (checked above)
                    if (dev && res.headers.get('x-staticforge-runtime-asset') === 'source') r.devSource++;
                    else r.manifestMismatch.push({ url: row.url, manifest: row.hash, actual });
                }
            } catch (e) {
                r.errors.push({ url: row.url, error: e.message });
            }
        }
    };
    const t0 = Date.now();
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(`\n== ${label} mode (${((Date.now() - t0) / 1000).toFixed(1)} s) ==`);
    console.log(`checked ${r.checked}, header mismatches ${r.headerMismatch.length}, manifest-vs-body mismatches ${r.manifestMismatch.length}${dev ? ` (+${r.devSource} dev-mode source bodies, expected)` : ''}, non-200 ${r.non200.length}, fetch errors ${r.errors.length}`);
    const list = (title, items, fmt) => {
        if (!items.length) return;
        console.log(`${title} (first ${Math.min(items.length, MAX_LIST)} of ${items.length}):`);
        for (const it of items.slice(0, MAX_LIST)) console.log('  ' + fmt(it));
    };
    list('X-File-Hash != sha256(body)', r.headerMismatch, (x) => `${x.url} header ${short(x.claimed)} body ${short(x.actual)}`);
    list('manifest hash != sha256(body)', r.manifestMismatch, (x) => `${x.url} manifest ${short(x.manifest)} body ${short(x.actual)}`);
    list('non-200', r.non200, (x) => `${x.url} HTTP ${x.status}`);
    list('fetch errors', r.errors, (x) => `${x.url} ${x.error}`);
    // a redirect (/ for a signed-in session) is not a file; any other non-200 is a manifest entry the client cannot get
    const badStatus = r.non200.filter((x) => x.status < 300 || x.status >= 400);
    return r.headerMismatch.length > 0 || r.manifestMismatch.length > 0 || badStatus.length > 0 || r.errors.length > 0;
}

(async () => {
    const sid = await signIn();
    const { source, rows: all } = await loadManifest(sid);
    let rows = all.filter((r) => typeof r.url === 'string' && r.url.startsWith('/') && isSha(r.hash));
    const skipped = all.length - rows.length;
    if (LIMIT) rows = rows.slice(0, LIMIT);
    console.log(`manifest source: ${source}`);
    console.log(`${all.length} entries, ${skipped} skipped (no sha256 hash), ${rows.length} to check, base ${BASE}`);
    let failed = false;
    if (MODE !== 'dev') failed = (await runMode('normal', rows, sid, false)) || failed;
    if (MODE !== 'normal') failed = (await runMode('dev', rows, sid, true)) || failed;
    console.log(failed ? '\nFAIL' : '\nOK');
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(2); });
