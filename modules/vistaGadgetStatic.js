/**
 * Sidebar gadget packages (Yozora #629): public/static_images/vista-gadgets/<id>/, unpacked by
 * scripts/import-vista-gadget.js with every path lowercased.
 *
 * Gadgets were written for Windows: their pages ask for "Images\Clock.PNG" where the file is
 * images/clock.png, and the Sidebar looked a file up in the gadget's locale folder (en-US/) first
 * and then in the gadget's root. This serves the same lookup: the request path folded to
 * lowercase, then the locale folder dropped when the file is not there. Anything else falls
 * through to the 404 handler.
 *
 * A gadget's own URL root was the gadget folder, so "../images/x.png" from a page in that folder
 * stayed inside it. Here it climbs out to /static_images/vista-gadgets/images/x.png: the
 * requesting page (Referer, sent because gadget files answer with Referrer-Policy: same-origin)
 * names the gadget, and the path is looked up inside it.
 *
 * The files are on demand (web_server.js leaves the prefix out of the update manifest, like the
 * Vista games); the service worker caches them as they are fetched.
 */
const fs = require('fs');
const path = require('path');

const WEB_PREFIX = '/static_images/vista-gadgets';
const LOCALE_RE = /^[a-z]{2}(-[a-z]{2,4})?$/;

/** The gadget id of a referring gadget page, or ''. */
function refererGadget(referer) {
    try {
        const parts = new URL(referer).pathname.split('/').filter(Boolean);
        // static_images / vista-gadgets / <id> / ...
        return parts[0] === 'static_images' && parts[1] === 'vista-gadgets' && parts[2] ? parts[2].toLowerCase() : '';
    } catch (_err) {
        return '';
    }
}

function resolveFile(root, requestPath, referer) {
    let rel;
    try {
        rel = decodeURIComponent(requestPath);
    } catch (_err) {
        return null;
    }
    const parts = rel.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
    const gadget = referer ? refererGadget(referer) : '';
    if (!parts.length || (parts.length < 2 && !gadget) || parts.some((p) => p === '..' || p === '.' || p.includes('\0'))) return null;
    const tries = parts.length > 1 ? [parts] : [];
    // <id>/<locale>/rest -> <id>/rest
    if (parts.length > 2 && LOCALE_RE.test(parts[1])) tries.push([parts[0], ...parts.slice(2)]);
    if (gadget && gadget !== parts[0]) {
        tries.push([gadget, ...parts]);
        if (parts.length > 1 && LOCALE_RE.test(parts[0])) tries.push([gadget, ...parts.slice(1)]);
    }
    for (const t of tries) {
        const file = path.join(root, ...t);
        if (!file.startsWith(root + path.sep)) continue;
        try {
            if (fs.statSync(file).isFile()) return file;
        } catch (_err) { /* try the next */ }
    }
    return null;
}

/** Express middleware for WEB_PREFIX (mount with app.use(WEB_PREFIX, ...)). */
function middleware(repoRoot) {
    const root = path.resolve(repoRoot, 'public', 'static_images', 'vista-gadgets');
    return (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const file = resolveFile(root, req.path, req.get('referer'));
        if (!file) return next();
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Referrer-Policy', 'same-origin');
        return res.sendFile(file, { dotfiles: 'deny' }, (err) => {
            if (err && !res.headersSent) next();
        });
    };
}

module.exports = { WEB_PREFIX, middleware, resolveFile };
