/**
 * GET /gadget-proxy?url=<http(s) URL> (Yozora #629): the web for hosted Sidebar gadgets. Their pages
 * may only load from this origin (scripts/import-vista-gadget.js CSP), so gadgetShim.js sends
 * cross-origin XMLHttpRequests (and the XMLDOM loads on top of them) and remote <img>s here.
 *
 * Gadget pages run on Dreamscape's origin and many put fetched text into innerHTML, so text is
 * only fetched for the hosts a gadget is listed with (catalog.json "web", the requesting page
 * named by its Referer); pictures come from any public host. Administrators only, like the
 * Sidebar's packets. http is asked for over https. Every hop is checked like the Feed Headlines
 * fetch (sidebarGadgets.assertPublicHttps: public hosts only, DNS checked), redirects followed by
 * hand. Only text, XML, JSON and images, at most 4 MB, kept 5 minutes; a sandbox CSP on the reply.
 *
 * Feeds that are gone are rebuilt from their successors (LEGACY_FEEDS), with no markup in them.
 */
const dns = require('dns');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');
const sidebarGadgets = require('./sidebarGadgets');
const { isPrivateOrLocalIP } = require('./dynamicGenerationHandlers');

const MAX_BYTES = 4 * 1024 * 1024;
const TTL_MS = 5 * 60 * 1000;
const MAX_CACHE = 64;
const IMAGE_RE = /^image\/(png|jpe?g|gif|webp|bmp|x-icon|vnd\.microsoft\.icon)\b/i;
const TEXT_RE = /^(text\/(plain|xml|html|css|csv)|application\/(xml|rss\+xml|atom\+xml|json|geo\+json|xhtml\+xml|rdf\+xml))\b/i;
const CATALOG = path.join(__dirname, '..', 'public', 'static_images', 'vista-gadgets', 'catalog.json');

const cache = new Map();
let catalog = { mtimeMs: -1, web: new Map() };

/** id -> allowed hosts, from catalog.json, re-read when it changes. */
function webHosts(id) {
    try {
        const { mtimeMs } = fs.statSync(CATALOG);
        if (mtimeMs !== catalog.mtimeMs) {
            const list = JSON.parse(fs.readFileSync(CATALOG, 'utf8')).gadgets || [];
            catalog = { mtimeMs, web: new Map(list.map((g) => [g.id, (g.web || []).map((h) => String(h).toLowerCase())])) };
        }
    } catch (_e) {
        return [];
    }
    return catalog.web.get(id) || [];
}

function refererGadget(referer) {
    try {
        const parts = new URL(referer).pathname.split('/').filter(Boolean);
        return parts[0] === 'static_images' && parts[1] === 'vista-gadgets' && parts[2] ? parts[2].toLowerCase() : '';
    } catch (_e) {
        return '';
    }
}

function hostAllowed(host, allowed) {
    const h = String(host || '').toLowerCase();
    return allowed.some((a) => h === a || h.endsWith('.' + a));
}

async function fetchPublic(raw, accept) {
    let current = String(raw || '').trim().replace(/^http:\/\//i, 'https://');
    for (let hop = 0; hop < 5; hop++) {
        const url = await sidebarGadgets.assertPublicHttps(current);
        if (!url) return { status: 400, error: 'Not a public https address' };
        let response;
        try {
            response = await fetch(url.href, {
                redirect: 'manual',
                signal: AbortSignal.timeout(10000),
                headers: { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.0)', Accept: '*/*' }
            });
        } catch (_e) {
            return { status: 502, error: 'Fetch failed' };
        }
        if (response.status >= 300 && response.status < 400) {
            const loc = response.headers.get('location');
            if (!loc) return { status: 502, error: 'Redirect without a location' };
            current = new URL(loc, url).href.replace(/^http:\/\//i, 'https://');
            continue;
        }
        const type = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
        if (!accept(type, url.hostname)) return { status: 415, error: 'Not allowed for this gadget' };
        if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) return { status: 413, error: 'Too large' };
        const chunks = [];
        let size = 0;
        const reader = response.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > MAX_BYTES) {
                reader.cancel().catch(() => {});
                return { status: 413, error: 'Too large' };
            }
            chunks.push(value);
        }
        const charset = /charset=([\w-]+)/i.exec(response.headers.get('content-type') || '');
        return { status: response.status, type, charset: charset ? charset[1] : '', body: Buffer.concat(chunks.map((c) => Buffer.from(c))) };
    }
    return { status: 508, error: 'Too many redirects' };
}

// ---------------------------------------------------------------- feeds that moved

const plain = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, '').trim();
const xml = (s) => plain(s).replace(/'/g, '&apos;');

/**
 * USGS's "eqs1day-M2.5.xml" / "eqs7day-M5.xml" RSS (gone) from today's GeoJSON summary feeds:
 * the same item fields (title "M 2.6, place", description, link, pubDate, geo:lat / geo:long).
 */
async function usgsLegacy(m) {
    const span = m[1] === '7day' ? 'week' : 'day';
    const mag = Number(m[2]) >= 4.5 ? '4.5' : (Number(m[2]) >= 2.5 ? '2.5' : '1.0');
    const res = await fetchPublic(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${mag}_${span}.geojson`, (type) => TEXT_RE.test(type));
    if (!res.body) return res;
    let data;
    try {
        data = JSON.parse(res.body.toString('utf8'));
    } catch (_e) {
        return { status: 502, error: 'Bad feed' };
    }
    const items = (data.features || []).slice(0, 100).map((f) => {
        const p = f.properties || {};
        const c = (f.geometry && f.geometry.coordinates) || [];
        const when = new Date(Number(p.time) || Date.now());
        const title = `M ${Number(p.mag).toFixed(1)}, ${plain(p.place)}`;
        return `<item><title>${xml(title)}</title>`
            + `<description>${xml(`${when.toUTCString()} - Depth ${Number(c[2] || 0).toFixed(1)} km - ${plain(p.place)}`)}</description>`
            + `<link>${xml(String(p.url || '').replace(/^http:/i, 'https:'))}</link><pubDate>${when.toUTCString()}</pubDate>`
            + `<geo:lat>${Number(c[1]) || 0}</geo:lat><geo:long>${Number(c[0]) || 0}</geo:long></item>`;
    }).join('');
    const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#"><channel>`
        + `<title>USGS M ${mag}+ Earthquakes</title><link>https://earthquake.usgs.gov/</link><description>Real-time, worldwide earthquake list for the past ${span}</description>${items}</channel></rss>`;
    return { status: 200, type: 'application/xml', charset: 'utf-8', body: Buffer.from(body, 'utf8') };
}

const LEGACY_FEEDS = [
    [/^https?:\/\/earthquake\.usgs\.gov\/eqcenter\/(?:recenteqsww\/)?catalogs\/eqs(1day|7day)-M(\d(?:\.\d)?)\.xml$/i, usgsLegacy]
];

/** Express handler; mount after authMiddleware. */
async function handle(req, res) {
    if (req.userType !== 'admin' && req.userType !== 'dev_admin') {
        res.status(403).json({ success: false, error: 'Admin access required' });
        return;
    }
    const raw = typeof req.query.url === 'string' ? req.query.url : '';
    if (!raw || raw.length > 2048 || !/^https?:\/\//i.test(raw)) {
        res.status(400).json({ success: false, error: 'url must be an http(s) address' });
        return;
    }
    const gadget = refererGadget(req.get('referer'));
    const allowed = gadget ? webHosts(gadget) : [];
    const key = `${gadget}|${raw}`;
    let hit = cache.get(key);
    if (!hit || hit.expires < Date.now()) {
        const legacy = LEGACY_FEEDS.find(([re]) => re.test(raw));
        const result = legacy
            ? (allowed.length ? await legacy[1](legacy[0].exec(raw)) : { status: 403, error: 'Not allowed for this gadget' })
            : await fetchPublic(raw, (type, host) => IMAGE_RE.test(type) || (TEXT_RE.test(type) && hostAllowed(host, allowed)));
        hit = { ...result, expires: Date.now() + TTL_MS };
        cache.delete(key);
        cache.set(key, hit);
        while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    }
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (!hit.body) {
        res.status(hit.status || 502).json({ success: false, error: hit.error || 'Failed' });
        return;
    }
    res.status(hit.status >= 200 && hit.status < 300 ? 200 : hit.status);
    res.type(hit.charset ? `${hit.type}; charset=${hit.charset}` : hit.type);
    res.end(hit.body);
}

// ---------------------------------------------------------------- /gadget-stream (radio)

const STREAM_TYPE_RE = /^(audio\/[\w.+-]+|application\/ogg|application\/octet-stream|video\/mp2t)\b/i;
const PLAYLIST_RE = /^(audio\/(x-)?mpegurl|application\/(x-|vnd\.apple\.)?mpegurl|audio\/x-scpls|application\/pls\+xml|video\/x-ms-asf|audio\/x-ms-wax|video\/x-ms-wvx|text\/plain)\b/i;
const MAX_STREAMS = 4;
let streams = 0;

const blocked = (ip) => !ip || ip === '::' || isPrivateOrLocalIP(String(ip).replace(/^::ffff:/i, ''));

/** dns.lookup that answers only public addresses: the address connected to is the one checked. */
function publicLookup(hostname, options, callback) {
    const cb = typeof options === 'function' ? options : callback;
    dns.lookup(hostname, { all: true }, (err, addrs) => {
        if (err) return cb(err);
        const ok = (addrs || []).filter((a) => !blocked(a.address));
        if (!ok.length || ok.length !== addrs.length) return cb(new Error('Private address'));
        if (options && typeof options === 'object' && options.all) return cb(null, ok);
        return cb(null, ok[0].address, ok[0].family);
    });
}

function streamRequest(raw, hops) {
    return new Promise((resolve, reject) => {
        let url;
        try {
            url = new URL(raw);
        } catch (_e) {
            reject(new Error('Bad address'));
            return;
        }
        if (!/^https?:$/.test(url.protocol) || url.username || url.password) return reject(new Error('Bad address'));
        const host = url.hostname.replace(/^\[|\]$/g, '');
        if (net.isIP(host) ? blocked(host) : (!host.includes('.') || /\.(local|internal)$/i.test(host) || host === 'localhost')) return reject(new Error('Not public'));
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.get(url, { lookup: publicLookup, timeout: 10000, headers: { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.0)', 'Icy-MetaData': '0' } }, (up) => {
            if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location && hops < 5) {
                up.resume();
                resolve(streamRequest(new URL(up.headers.location, url).href, hops + 1));
                return;
            }
            resolve({ up, req, url });
        });
        req.on('timeout', () => req.destroy(new Error('Timed out')));
        req.on('error', reject);
    });
}

/** The first stream address of an M3U / PLS / ASX playlist. */
function playlistTarget(text, base) {
    const m = /(?:^|\n)\s*(?:File\d+=)?(https?:\/\/[^\s"<]+)/i.exec(text) || /<ref\s+href\s*=\s*"([^"]+)"/i.exec(text);
    if (!m) return null;
    try { return new URL(m[1].replace(/&amp;/g, '&'), base).href; } catch (_e) { return null; }
}

/**
 * GET /gadget-stream?url=: a radio station's audio, relayed so an http stream plays on the https
 * desktop and the gadget page's CSP (media from this origin only) holds. Admins only; public
 * hosts only (every connection's address checked); audio types only, playlists (M3U / PLS /
 * ASX, up to 64 KB) followed to their first stream; at most four at a time. Not counted as busy
 * by modules/busyStatus.js: a radio reconnects after a restart.
 */
async function handleStream(req, res) {
    if (req.userType !== 'admin' && req.userType !== 'dev_admin') {
        res.status(403).json({ success: false, error: 'Admin access required' });
        return;
    }
    const raw = typeof req.query.url === 'string' ? req.query.url : '';
    if (!raw || raw.length > 2048 || !/^https?:\/\//i.test(raw)) {
        res.status(400).json({ success: false, error: 'url must be an http(s) address' });
        return;
    }
    if (streams >= MAX_STREAMS) {
        res.status(429).json({ success: false, error: 'Too many streams' });
        return;
    }
    streams += 1;
    let upstream = null;
    const release = () => {
        if (upstream) upstream.destroy();
        upstream = null;
    };
    res.on('close', release);
    try {
        let target = raw;
        for (let depth = 0; depth < 3; depth++) {
            const { up, req: upReq } = await streamRequest(target, 0);
            upstream = upReq;
            const type = String(up.headers['content-type'] || '').split(';')[0].trim();
            if (up.statusCode !== 200) throw new Error(`Station answered ${up.statusCode}`);
            if (PLAYLIST_RE.test(type) || /\.(m3u8?|pls|asx|wax)(\?|$)/i.test(target)) {
                let text = '';
                for await (const chunk of up) {
                    text += chunk.toString('utf8');
                    if (text.length > 65536) break;
                }
                release();
                const next = playlistTarget(text, target);
                if (!next) throw new Error('Empty playlist');
                target = next;
                continue;
            }
            if (!STREAM_TYPE_RE.test(type)) throw new Error('Not an audio stream');
            if (res.writableEnded || res.destroyed) return;
            res.status(200);
            res.setHeader('Content-Type', type);
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Security-Policy', 'sandbox');
            up.on('error', () => res.destroy());
            up.pipe(res);
            await new Promise((resolve) => res.on('close', resolve));
            return;
        }
        throw new Error('Playlist too deep');
    } catch (err) {
        if (!res.headersSent) res.status(502).json({ success: false, error: err.message });
        else res.destroy();
    } finally {
        streams -= 1;
        release();
    }
}

module.exports = { handle, handleStream };
