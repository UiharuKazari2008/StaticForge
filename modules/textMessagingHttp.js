/**
 * Text Messaging over HTTP (Yozora #779): attachment bodies, which do not belong on the socket.
 *
 *   GET  /api/textmessaging/:accountId/attachment/:guid[?thumb=1]
 *        the provider's file (HEIC comes out as JPEG; ?thumb=1 = a 480 px preview), cached on disk
 *        in .cache/textmessaging-attachments by account + guid. Admins only.
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
