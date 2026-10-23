/**
 * GET /melaton-apps/<root>/<path> (Yozora #638): a Melaton app's client files.
 *
 * <root> is an installed package id (.cache/packages/<id>/) or the sha256 of a .msaz run from the
 * VFS (.cache/packages/.run/<sha>/). The server half (server/), the manifest's dot files and any
 * dot path stay unserved; everything else in the tree is the app's client side (client/, icon,
 * assets). Run trees are content-addressed, so they cache for good; installed trees revalidate.
 * Behind authMiddleware (web_server.js); the service worker passes these through (sw.js).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ID_RE = /^[a-z][a-z0-9-]{1,62}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

function createMelatonAppStatic({ packagesRoot }) {
    const root = path.resolve(packagesRoot);
    return function melatonAppStatic(req, res, next) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const m = /^\/([^/]+)\/(.+)$/.exec(req.path);
        if (!m) return res.status(404).end();
        const [, top, rest] = m;
        let base;
        if (SHA_RE.test(top)) base = path.join(root, '.run', top);
        else if (ID_RE.test(top)) base = path.join(root, top);
        else return res.status(404).end();

        let rel;
        try {
            rel = decodeURIComponent(rest);
        } catch (_) {
            return res.status(400).end();
        }
        const parts = rel.split('/');
        if (parts.some((p) => !p || p === '.' || p === '..' || p.startsWith('.')) || parts[0] === 'server' || rel === 'manifest.json') {
            return res.status(404).end();
        }
        const file = path.join(base, ...parts);
        if (!file.startsWith(base + path.sep)) return res.status(404).end();
        fs.stat(file, (err, st) => {
            if (err || !st.isFile()) return res.status(404).end();
            res.setHeader('Cache-Control', SHA_RE.test(top) ? 'private, max-age=31536000, immutable' : 'private, no-cache');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            // root = the package tree, so the dotfile rule looks at the path inside it, not at .cache/
            res.sendFile(parts.join('/'), { root: base, dotfiles: 'deny' }, (sendErr) => {
                if (sendErr && !res.headersSent) res.status(sendErr.status || 404).end();
            });
        });
    };
}

module.exports = { createMelatonAppStatic };
