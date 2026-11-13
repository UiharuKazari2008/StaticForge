/**
 * Text Messaging over HTTP (Yozora #779): attachment bodies, which do not belong on the socket.
 *
 *   GET  /api/textmessaging/:accountId/attachment/:guid[?thumb=1]
 *        the provider's file (HEIC comes out as JPEG; ?thumb=1 = a 480 px preview), cached on disk
 *        in .cache/textmessaging-attachments by account + guid. Admins only.
 *   GET  /api/textmessaging/link-preview?url=     { title, description, image, site } of a link in a message
 *        (public hosts only, the head of the page only, cached 6 h)
 *   GET  /api/textmessaging/:accountId/pairing-qr.svg   the RCS account's pairing QR code (no-store)
 *   POST /api/textmessaging/:accountId/send-attachment?chat=<guid>&name=<file>&replyTo=&tempGuid=&audio=1
 *        body = the file (Content-Type = its MIME type), up to 100 MB. -> { success, tempGuid, message }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const textMessaging = require('./textMessaging');

const MAX_UPLOAD = 100 * 1024 * 1024;

function refuse(res, status, code, error) {
    res.status(status).json({ success: false, code, error });
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const parts = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) { reject(Object.assign(new Error('The file is too large to send (100 MB at most).'), { code: 'TOO_LARGE' })); req.destroy(); return; }
            parts.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(parts)));
        req.on('error', reject);
    });
}

// ---- link previews (a link in a message: title, description, picture), public hosts only ----
const PREVIEW_TTL_MS = 6 * 60 * 60 * 1000;
const PREVIEW_MAX_BYTES = 768 * 1024;
const previews = new Map(); // url -> { at, value }

function isPrivateAddress(ip) {
    const net = require('net');
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    }
    const v = ip.toLowerCase();
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

function metaOf(html, base) {
    const pick = (re) => { const m = re.exec(html); return m ? m[1] : ''; };
    const meta = (name) => pick(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))
        || pick(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i'));
    const decode = (t) => String(t || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).trim();
    const title = decode(meta('og:title') || meta('twitter:title') || pick(/<title[^>]*>([^<]*)<\/title>/i));
    const description = decode(meta('og:description') || meta('twitter:description') || meta('description'));
    let image = decode(meta('og:image') || meta('og:image:url') || meta('twitter:image'));
    try { image = image ? new URL(image, base).href : ''; } catch (_) { image = ''; }
    if (image && !/^https:/i.test(image)) image = '';
    const site = decode(meta('og:site_name')) || new URL(base).hostname.replace(/^www\./, '');
    return { title: title.slice(0, 300), description: description.slice(0, 500), image, site };
}

async function linkPreview(raw) {
    let u;
    try { u = new URL(String(raw)); } catch (_) { throw Object.assign(new Error('Not a link.'), { code: 'BAD_URL' }); }
    if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Not a web link.'), { code: 'BAD_URL' });
    const hit = previews.get(u.href);
    if (hit && Date.now() - hit.at < PREVIEW_TTL_MS) return hit.value;
    const dns = require('dns').promises;
    const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
    if (!addrs.length || addrs.some((x) => isPrivateAddress(x.address))) throw Object.assign(new Error('No preview for that address.'), { code: 'PRIVATE' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    let value = { url: u.href, title: '', description: '', image: '', site: u.hostname.replace(/^www\./, '') };
    try {
        const res = await fetch(u.href, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MelatonMessenger/1.0; link preview)', Accept: 'text/html,application/xhtml+xml' } });
        const type = res.headers.get('content-type') || '';
        if (res.ok && /^image\//i.test(type) && /^https:/i.test(res.url)) value.image = res.url;
        else if (res.ok && /html/i.test(type) && res.body) {
            const reader = res.body.getReader();
            const parts = [];
            let size = 0;
            while (size < PREVIEW_MAX_BYTES) {
                const { done, value: chunk } = await reader.read();
                if (done) break;
                parts.push(chunk);
                size += chunk.length;
                if (/<\/head>/i.test(Buffer.from(chunk).toString('latin1'))) break;
            }
            try { reader.cancel(); } catch (_) { /* done */ }
            value = Object.assign(value, metaOf(Buffer.concat(parts.map((c) => Buffer.from(c))).toString('utf8'), res.url || u.href));
        }
    } catch (_) { /* a bare preview: the address */ }
    clearTimeout(timer);
    previews.set(u.href, { at: Date.now(), value });
    if (previews.size > 500) previews.delete(previews.keys().next().value);
    return value;
}

function mount(app, authMiddleware, globalResources) {
    const auth = authMiddleware || ((req, res, next) => next());
    const cacheDir = path.join(globalResources.getPath('cache'), 'textmessaging-attachments');
    const admin = (req, res, next) => {
        if (req.userType !== 'admin') { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        next();
    };

    app.get('/api/textmessaging/:accountId/attachment/:guid', auth, admin, async (req, res) => {
        const { accountId, guid } = req.params;
        const thumb = req.query.thumb === '1';
        const key = crypto.createHash('sha1').update(`${accountId}|${guid}|${thumb ? 't' : 'f'}`).digest('hex');
        const file = path.join(cacheDir, key);
        try {
            const meta = JSON.parse(await fs.promises.readFile(`${file}.json`, 'utf8'));
            res.setHeader('Content-Type', meta.type || 'application/octet-stream');
            if (meta.name) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`);
            res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
            fs.createReadStream(file).on('error', () => res.end()).pipe(res);
            return;
        } catch (_) { /* not cached yet */ }
        let upstream;
        try {
            upstream = await textMessaging.downloadAttachment(accountId, guid, { thumb });
        } catch (error) {
            refuse(res, error.status === 404 ? 404 : 502, error.code || 'ERROR', error.message);
            return;
        }
        const type = upstream.headers.get('content-type') || 'application/octet-stream';
        const disp = upstream.headers.get('content-disposition') || '';
        const nameMatch = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
        const name = nameMatch ? decodeURIComponent(nameMatch[1]) : '';
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.setHeader('Content-Type', type);
        if (name) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        res.end(buf);
        try {
            await fs.promises.mkdir(cacheDir, { recursive: true });
            await fs.promises.writeFile(file, buf);
            await fs.promises.writeFile(`${file}.json`, JSON.stringify({ type, name, at: Date.now() }));
        } catch (error) {
            console.warn('[textMessaging] attachment cache write failed:', error.message);
        }
    });

    app.get('/api/textmessaging/link-preview', auth, admin, async (req, res) => {
        try {
            const value = await linkPreview(req.query.url);
            res.setHeader('Cache-Control', 'private, max-age=3600');
            res.json(Object.assign({ success: true }, value));
        } catch (error) {
            refuse(res, 400, error.code || 'ERROR', error.message);
        }
    });

    // a contact's picture (BlueBubbles serves the iPhone's contact photos), by handle key
    app.get('/api/textmessaging/:accountId/avatar/:key', auth, admin, (req, res) => {
        const buf = textMessaging.avatar(req.params.accountId, req.params.key);
        if (!buf) { refuse(res, 404, 'NO_PHOTO', 'No picture.'); return; }
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.end(buf);
    });

    // RCS pairing: the current Google Messages QR code as SVG (404 when no pairing is under way)
    app.get('/api/textmessaging/:accountId/pairing-qr.svg', auth, admin, async (req, res) => {
        const url = textMessaging.pairingQr(req.params.accountId);
        if (!url) { refuse(res, 404, 'NO_PAIRING', 'No pairing is under way.'); return; }
        try {
            const svg = await require('qrcode').toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Cache-Control', 'no-store');
            res.end(svg);
        } catch (error) {
            refuse(res, 500, 'ERROR', error.message);
        }
    });

    app.post('/api/textmessaging/:accountId/send-attachment', auth, admin, async (req, res) => {
        const chatGuid = String(req.query.chat || '');
        if (!chatGuid) { refuse(res, 400, 'NO_CHAT', 'Which conversation?'); return; }
        let buffer;
        try { buffer = await readBody(req, MAX_UPLOAD); } catch (error) { refuse(res, 413, error.code || 'ERROR', error.message); return; }
        if (!buffer.length) { refuse(res, 400, 'EMPTY', 'The file is empty.'); return; }
        try {
            const out = await textMessaging.sendAttachment(req.params.accountId, {
                chatGuid,
                name: String(req.query.name || 'attachment').slice(0, 200),
                mime: String(req.headers['content-type'] || 'application/octet-stream').split(';')[0],
                buffer,
                replyTo: req.query.replyTo ? String(req.query.replyTo) : null,
                tempGuid: req.query.tempGuid ? String(req.query.tempGuid) : null,
                audio: req.query.audio === '1'
            });
            res.json(Object.assign({ success: true }, out));
        } catch (error) {
            refuse(res, error.code === 'NO_ACCOUNT' ? 404 : 502, error.code || 'ERROR', error.message);
        }
    });
}

module.exports = { mount };
