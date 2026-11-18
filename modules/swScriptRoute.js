'use strict';

/**
 * GET /sw.js (#890). The browser checks for a new service worker on every navigation and at least
 * once a day. sw.js itself always goes to the server (the HTTP cache is bypassed for the worker script
 * under every updateViaCache mode the pages use: the default 'imports' at boot, 'none' on a forced
 * update), as a conditional request when the browser has a copy. Served no-store it had no copy to
 * compare, so every check downloaded the whole worker again (~29 KB brotli; ~100 checks a day from the
 * phones). 'no-cache' with its ETag / Last-Modified lets an unchanged worker answer 304 (~300 B); a
 * changed one is a 200 with the new bytes, and the browser's byte comparison decides the update exactly
 * as before.
 *
 * The workbox modules it imports (/dist/workbox/*.js) are served 'public, max-age=86400' with their
 * ETag (agentAssetBundle WORKBOX_CACHE_CONTROL, #890 round 5 W8): with updateViaCache 'imports' an update
 * check reads them from the HTTP cache instead of revalidating all six each time.
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
