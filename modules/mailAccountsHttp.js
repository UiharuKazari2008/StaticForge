/**
 * IMAP e-mail accounts over HTTP (Yozora #789): attachment bodies and uploads for sending. Admins only.
 *   GET  /api/mailaccounts/:accountId/attachment?folder=&uid=&part=   (from the mail server on first open, then cached)
 *   POST /api/mailaccounts/upload?name=<file>   body = the file (Content-Type its type), up to 35 MB -> { uploadId }
 */
'use strict';

const fs = require('fs');
const mailAccounts = require('./mailAccounts');

const MAX_UPLOAD = 35 * 1024 * 1024;

function mount(app, authMiddleware) {
    const auth = authMiddleware || ((req, res, next) => next());
    const admin = (req, res, next) => { if (req.userType !== 'admin') { res.status(403).json({ success: false, code: 'INSUFFICIENT_PERMISSIONS', error: 'Admin access required' }); return; } next(); };

    app.get('/api/mailaccounts/:accountId/attachment', auth, admin, async (req, res) => {
        try {
            const a = await mailAccounts.attachment(req.params.accountId, String(req.query.folder || 'INBOX'), Number(req.query.uid), String(req.query.part || ''));
            res.setHeader('Content-Type', a.type);
            res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(a.name)}`);
            res.setHeader('Cache-Control', 'private, max-age=86400');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            fs.createReadStream(a.file).on('error', () => res.end()).pipe(res);
        } catch (error) {
            res.status(error.code === 'NOT_FOUND' ? 404 : 502).json({ success: false, code: error.code || 'ERROR', error: error.message });
        }
    });

    app.post('/api/mailaccounts/upload', auth, admin, (req, res) => {
        const parts = [];
        let size = 0;
        let over = false;
        req.on('data', (c) => { size += c.length; if (size > MAX_UPLOAD) { over = true; req.destroy(); return; } parts.push(c); });
        req.on('end', () => {
            if (over) return;
            try {
                const out = mailAccounts.addUpload(Buffer.concat(parts), String(req.query.name || 'attachment'), String(req.headers['content-type'] || 'application/octet-stream').split(';')[0]);
                res.json(Object.assign({ success: true }, out));
            } catch (error) { res.status(500).json({ success: false, error: error.message }); }
        });
        req.on('close', () => { if (over && !res.headersSent) res.status(413).json({ success: false, code: 'TOO_LARGE', error: 'Attachments can be 35 MB at most.' }); });
    });
}

module.exports = { mount };
