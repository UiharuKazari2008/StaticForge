'use strict';

// A picture kept on disk as a file shown to clients by address, not as a base64 data URL
// (no-base64-images): a versioned copy lives under .cache/<group>/, served by the authed /cache
// static route (the name carries mtime and size, so it is immutable and cacheable).

const fs = require('fs');
const path = require('path');

const CACHE_ROOT = path.join(__dirname, '..', '.cache');

/**
 * The address of sourceFile's served copy, or null when the file cannot be read.
 * group: folder under .cache; key: the owner (account, provider id); older copies of the key go.
 * cacheRoot: override for tests.
 */
function servedUrl(sourceFile, group, key, ext = 'png', cacheRoot = CACHE_ROOT) {
    try {
        const st = fs.statSync(sourceFile);
        const name = `${key}-${Math.round(st.mtimeMs)}-${st.size}.${ext}`;
        const dir = path.join(cacheRoot, group);
        const target = path.join(dir, name);
        if (!fs.existsSync(target)) {
            fs.mkdirSync(dir, { recursive: true });
            for (const old of fs.readdirSync(dir)) {
                if (old.startsWith(`${key}-`)) { try { fs.unlinkSync(path.join(dir, old)); } catch (_e) { /* gone */ } }
            }
            fs.copyFileSync(sourceFile, target);
        }
        return `/cache/${group}/${name}`;
    } catch (_err) {
        return null;
    }
}

module.exports = { servedUrl };
