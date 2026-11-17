'use strict';

/**
 * GET /sw.js (#890). The browser checks for a new service worker on every navigation and at least
 * once a day, and registration asks with updateViaCache 'none' (serviceWorkerManager.js): the check
 * goes to the server each time, as a conditional request when the browser has a copy. Served
 * no-store it had no copy to compare, so every check downloaded the whole worker again (~29 KB
 * brotli; ~100 checks a day from the phones). 'no-cache' with its ETag / Last-Modified lets an
 * unchanged worker answer 304 (~300 B); a changed one is a 200 with the new bytes, and the browser's
 * byte comparison decides the update exactly as before.
 *
 * The workbox modules it imports (/dist/workbox/*.js) have no version in their path or query, so they
 * stay on the static files' 'no-cache' + ETag (agentAssetBundle.applyServedAssetCacheHeaders): 304s.
 */

const fs = require('fs');
const path = require('path');

const SW_CACHE_CONTROL = 'no-cache';

function createSwScriptHandler(publicDir) {
    const filePath = path.join(publicDir, 'sw.js');
    return function serveSwScript(req, res, next) {
        fs.promises.stat(filePath).then((st) => {
            if (!st || !st.isFile()) { next(); return; }
            res.setHeader('Cache-Control', SW_CACHE_CONTROL);
            res.sendFile(filePath, { etag: true, lastModified: true }, (err) => {
                if (err && !res.headersSent) next(err);
            });
        }, () => next());
    };
}

module.exports = { createSwScriptHandler, SW_CACHE_CONTROL };
