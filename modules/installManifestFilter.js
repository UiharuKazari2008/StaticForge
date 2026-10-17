/**
 * Drop install-manifest rows the server cannot serve.
 * web_server.js buildServiceWorkerCacheManifest
 */
const fs = require('fs');
const path = require('path');

function decodeWebPath(url) {
    const raw = String(url || '').split('?')[0].split('#')[0];
    if (!raw.startsWith('/')) {
        return null;
    }
    let decoded;
    try {
        decoded = decodeURIComponent(raw);
    } catch (_err) {
        return null;
    }
    if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) {
        return null;
    }
    return decoded;
}

function underRoot(projectRoot, rel) {
    const root = path.resolve(projectRoot);
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
        return null;
    }
    return abs;
}

function isFile(abs) {
    if (!abs) {
        return false;
    }
    try {
        return fs.statSync(abs).isFile();
    } catch (_err) {
        return false;
    }
}

function candidatePaths(projectRoot, webPath) {
    const out = [];
    const push = (rel) => {
        const abs = underRoot(projectRoot, rel);
        if (abs) {
            out.push(abs);
        }
    };

    if (webPath === '/' || webPath === '/index.html') {
        push(path.join('public', 'index.html'));
        return out;
    }
    if (webPath === '/app') {
        push(path.join('public', 'app.html'));
        return out;
    }
    if (webPath === '/launch') {
        push(path.join('public', 'launch.html'));
        return out;
    }
    if (webPath === '/.login.jpg') {
        push(path.join('public', 'images', 'login_array.jpg'));
        push(path.join('.cache', 'login_array.jpg'));
        return out;
    }
    if (webPath === '/protected/fflate.js') {
        push(path.join('public', 'scripts', 'vendor', 'fflate.js'));
    }

    const rel = webPath.replace(/^\/+/, '');
    if (!rel || rel.split('/').includes('..')) {
        return out;
    }
    if (webPath.startsWith('/cursors/')) {
        const rest = webPath.slice('/cursors/'.length);
        push(path.join('public', 'cursors', rest));
        return out;
    }
    if (webPath.startsWith('/sounds/vista/')) {
        let name = path.basename(webPath);
        try { name = decodeURIComponent(name); } catch (_) { /* keep raw */ }
        push(path.join('public', 'sounds', 'vista', name));
        return out;
    }
    push(path.join('public', rel));
    push(path.join('.cache', 'runtime-assets', rel));
    return out;
}

function manifestEntryExists(projectRoot, entry) {
    const webPath = decodeWebPath(entry && (entry.url || entry.path));
    if (!webPath) {
        return false;
    }
    return candidatePaths(projectRoot, webPath).some(isFile);
}

function filterExistingManifestEntries(projectRoot, entries) {
    const list = Array.isArray(entries) ? entries : [];
    return list.filter((entry) => manifestEntryExists(projectRoot, entry));
}

function isAuthGatedWebPath(webPath) {
    const pathOnly = String(webPath || '').split('?')[0].split('#')[0];
    return pathOnly.startsWith('/protected/') || pathOnly.startsWith('/private/');
}

// Logged-out clients must not treat these as ordinary precache rows.
function markAuthGatedEntries(entries) {
    const list = Array.isArray(entries) ? entries : [];
    for (const entry of list) {
        const url = entry && (entry.url || entry.path);
        if (isAuthGatedWebPath(url)) {
            entry.auth = true;
        }
    }
    return list;
}

module.exports = {
    decodeWebPath,
    candidatePaths,
    manifestEntryExists,
    filterExistingManifestEntries,
    isAuthGatedWebPath,
    markAuthGatedEntries
};
