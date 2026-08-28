/**
 * Browser-agent asset preload: app-shell URL list, zip bundle, and short-lived
 * private HTTP cache for dev_admin sessions (service worker is not used).
 *
 * modules/runtimeAssetService.js
 * modules/auth.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { zip } = require('fflate');
const runtimeAssetService = require('./runtimeAssetService');

const AGENT_STATIC_CACHE_CONTROL = 'private, max-age=120';
const NO_STORE = 'no-cache, no-store, must-revalidate, max-age=0';
const PRELOAD_TIMEOUT_MS = 45000;
const ZIP_LEVEL = 1;

const ROUTE_HTML = {
    '/': 'index.html',
    '/app': 'app.html',
    '/launch': 'launch.html'
};

let projectRoot = null;
let getManifest = null;
let zipCache = null;
let zipBuild = null;

function init(options = {}) {
    projectRoot = options.projectRoot || projectRoot;
    if (options.getManifest) {
        getManifest = options.getManifest;
    }
}

function invalidate() {
    zipCache = null;
}

function isDevAdminSession(req) {
    return Boolean(req.session && req.session.authenticated && req.session.userType === 'dev_admin');
}

function applyServedAssetCacheHeaders(req, res) {
    if (isDevAdminSession(req)) {
        res.setHeader('Cache-Control', AGENT_STATIC_CACHE_CONTROL);
        return true;
    }
    res.setHeader('Cache-Control', NO_STORE);
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return false;
}

function stripQuery(url) {
    if (!url) {
        return '';
    }
    const cut = url.indexOf('?');
    return cut === -1 ? url : url.slice(0, cut);
}

function normalizeAppUrl(raw) {
    if (!raw) {
        return null;
    }
    let url = String(raw).trim();
    if (!url || url.startsWith('data:') || url.startsWith('javascript:')) {
        return null;
    }
    if (/^https?:\/\//i.test(url) || url.startsWith('//')) {
        return null;
    }
    if (url.startsWith('./')) {
        url = url.slice(2);
    }
    if (!url.startsWith('/')) {
        url = `/${url}`;
    }
    return url;
}

function collectAppShellBootUrls(html) {
    const urls = [];
    const seen = new Set();
    function add(raw) {
        const url = normalizeAppUrl(raw);
        if (!url || seen.has(url)) {
            return;
        }
        seen.add(url);
        urls.push(url);
    }
    const scriptRe = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = scriptRe.exec(html))) {
        add(match[1]);
    }
    const linkRe = /<link\b([^>]+)>/gi;
    while ((match = linkRe.exec(html))) {
        const attrs = match[1];
        const relMatch = /\brel=["']([^"']+)["']/i.exec(attrs);
        const hrefMatch = /\bhref=["']([^"']+)["']/i.exec(attrs);
        if (!hrefMatch) {
            continue;
        }
        const rel = (relMatch && relMatch[1] || '').toLowerCase();
        if (rel.split(/\s+/).includes('stylesheet')) {
            add(hrefMatch[1]);
        }
    }
    return urls;
}

function readAppHtml() {
    const root = projectRoot;
    if (!root) {
        return '';
    }
    const appPath = path.join(root, 'public', 'app.html');
    if (!fs.existsSync(appPath)) {
        return '';
    }
    return fs.readFileSync(appPath, 'utf8');
}

function getBootUrls() {
    return collectAppShellBootUrls(readAppHtml());
}

function webPathToZipEntry(webPath) {
    const clean = stripQuery(webPath).replace(/^\/+/, '');
    if (!clean) {
        return 'index.html';
    }
    if (ROUTE_HTML[`/${clean}`]) {
        return ROUTE_HTML[`/${clean}`];
    }
    return clean;
}

function resolveFilePath(file) {
    const root = projectRoot;
    if (!root) {
        return null;
    }
    if (file.filePath && fs.existsSync(file.filePath)) {
        return file.filePath;
    }
    if (file.name) {
        const named = path.join(root, 'public', String(file.name).replace(/^\/+/, ''));
        if (fs.existsSync(named)) {
            return named;
        }
    }
    const webPath = stripQuery(file.url || file.path || '');
    if (!webPath) {
        return null;
    }
    const routeName = ROUTE_HTML[webPath];
    if (routeName) {
        const routePath = path.join(root, 'public', routeName);
        if (fs.existsSync(routePath)) {
            return routePath;
        }
    }
    const served = runtimeAssetService.resolveServedAssetPath(root, webPath);
    if (served && fs.existsSync(served)) {
        return served;
    }
    const publicPath = path.join(root, 'public', webPath.replace(/^\/+/, ''));
    if (fs.existsSync(publicPath)) {
        return publicPath;
    }
    return null;
}

function manifestHash(files) {
    const hash = crypto.createHash('sha256');
    for (const file of files) {
        hash.update(String(file.url || ''));
        hash.update('\0');
        hash.update(String(file.hash || ''));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function buildFileList() {
    const bootUrls = getBootUrls();
    const bootSet = new Set(bootUrls.map((url) => stripQuery(url)));
    const byUrl = new Map();

    function upsert(entry) {
        const url = entry.url;
        if (!url) {
            return;
        }
        const key = stripQuery(url);
        const prev = byUrl.get(key) || {};
        const keepQueryUrl = prev.url && prev.url.includes('?') && !url.includes('?');
        byUrl.set(key, {
            url: keepQueryUrl ? prev.url : url,
            hash: entry.hash || prev.hash || null,
            size: entry.size || prev.size || 0,
            boot: bootSet.has(key) || Boolean(entry.boot) || Boolean(prev.boot),
            filePath: entry.filePath || prev.filePath,
            name: entry.name || prev.name
        });
    }

    for (const url of bootUrls) {
        upsert({ url, boot: true });
    }

    const manifest = getManifest ? getManifest() : [];
    for (const file of manifest) {
        upsert({
            url: file.url,
            hash: file.hash,
            size: file.size,
            filePath: file.filePath,
            name: file.name,
            boot: bootSet.has(stripQuery(file.url || ''))
        });
    }

    const files = [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
    return {
        files,
        boot: bootUrls,
        hash: manifestHash(files)
    };
}

function getAssetsCatalog() {
    const list = buildFileList();
    const files = list.files.map((file) => ({
        url: file.url,
        hash: file.hash,
        size: file.size,
        boot: file.boot === true
    }));
    let bytes = 0;
    for (const file of files) {
        bytes += file.size || 0;
    }
    return {
        success: true,
        hash: list.hash,
        count: files.length,
        bootCount: list.boot.length,
        bytes,
        boot: list.boot,
        files
    };
}

function collectZipInput(list) {
    const input = {};
    const mapping = [];
    for (const file of list.files) {
        const diskPath = resolveFilePath(file);
        if (!diskPath) {
            continue;
        }
        const entryName = webPathToZipEntry(file.url);
        if (input[entryName]) {
            continue;
        }
        input[entryName] = new Uint8Array(fs.readFileSync(diskPath));
        mapping.push({
            path: entryName,
            url: stripQuery(file.url),
            hash: file.hash || null,
            boot: file.boot === true
        });
    }
    input['agent-assets.json'] = new TextEncoder().encode(JSON.stringify({
        hash: list.hash,
        files: mapping
    }));
    return input;
}

function buildZipBuffer() {
    const list = buildFileList();
    if (zipCache && zipCache.hash === list.hash) {
        return Promise.resolve(zipCache);
    }
    if (zipBuild && zipBuild.hash === list.hash) {
        return zipBuild.promise;
    }
    const promise = new Promise((resolve, reject) => {
        let input;
        try {
            input = collectZipInput(list);
        } catch (error) {
            zipBuild = null;
            reject(error);
            return;
        }
        zip(input, { level: ZIP_LEVEL }, (error, data) => {
            zipBuild = null;
            if (error) {
                reject(error);
                return;
            }
            zipCache = {
                hash: list.hash,
                buffer: Buffer.from(data),
                count: Object.keys(input).length
            };
            resolve(zipCache);
        });
    });
    zipBuild = { hash: list.hash, promise };
    return promise;
}

function warmZip() {
    return buildZipBuffer().then((built) => built, () => null);
}

function getBootstrapPageHtml() {
    const timeoutMs = PRELOAD_TIMEOUT_MS;
    return `<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Preparing Dreamscape</title>
<style>
body{margin:0;background:#111;color:#ddd;font:14px/1.4 system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
#s{opacity:.85}
</style>
<p id="s">Preparing Dreamscape…</p>
<script>
(async () => {
    const status = document.getElementById('s');
    function setStatus(text) {
        if (status) status.textContent = text;
    }
    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((registration) => registration.unregister()));
        }
    } catch (_) {}
    setStatus('Loading application assets…');
    try {
        const manifestRes = await fetch('/agent/assets.json', { credentials: 'same-origin', cache: 'no-store' });
        if (manifestRes.ok) {
            const manifest = await manifestRes.json();
            const urls = Array.isArray(manifest.boot) ? manifest.boot : [];
            const limit = 8;
            let next = 0;
            let done = 0;
            async function worker() {
                while (next < urls.length) {
                    const url = urls[next++];
                    try {
                        await fetch(url, { credentials: 'same-origin', cache: 'reload' });
                    } catch (_) {}
                    done++;
                    if (done === urls.length || done % 8 === 0) {
                        setStatus('Loading application assets… ' + done + ' / ' + urls.length);
                    }
                }
            }
            const workers = [];
            for (let i = 0; i < Math.min(limit, urls.length); i++) workers.push(worker());
            const preload = Promise.all(workers);
            const timeout = new Promise((resolve) => setTimeout(resolve, ${timeoutMs}));
            await Promise.race([preload, timeout]);
        }
    } catch (_) {}
    location.replace('/app?agent=1');
})().catch(() => location.replace('/app?agent=1'));
</script>`;
}

module.exports = {
    init,
    invalidate,
    warmZip,
    isDevAdminSession,
    applyServedAssetCacheHeaders,
    getAssetsCatalog,
    buildZipBuffer,
    getBootstrapPageHtml,
    getBootUrls,
    AGENT_STATIC_CACHE_CONTROL
};
