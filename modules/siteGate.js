'use strict';

const fs = require('fs');
const path = require('path');
const { realClientIp, trustedProxiesFromResources } = require('./clientAddress');
const siteAccess = require('./siteAccess');
const siteHomepage = require('./siteHomepageStorage');

const DOOR_FAIL_WINDOW_MS = 60 * 60 * 1000;
const DOOR_FAIL_MAX = 10;
const doorFailByIp = new Map();

function clientRealIp(req, globalResources) {
    return realClientIp(req, trustedProxiesFromResources(globalResources));
}

function recordDoorFailure(ip) {
    if (!ip || ip === 'unknown') return false;
    const now = Date.now();
    let row = doorFailByIp.get(ip);
    if (!row || now - row.windowStart > DOOR_FAIL_WINDOW_MS) {
        row = { windowStart: now, count: 0 };
    }
    row.count++;
    doorFailByIp.set(ip, row);
    return row.count > DOOR_FAIL_MAX;
}

function resetDoorFailures(ip) {
    if (ip) doorFailByIp.delete(ip);
}

function getMcpUuid(globalResources) {
    try {
        return globalResources.getMcpPathUuid();
    } catch (_err) {
        return null;
    }
}

function getApocryphaUuid(globalResources) {
    try {
        return globalResources.getApocryphaPathUuid();
    } catch (_err) {
        return null;
    }
}

function isSiteGateExempt(req, globalResources) {
    const method = (req.method || 'GET').toUpperCase();
    const p = (req.path || '/').split('?')[0];

    if (p === '/agent' || p.startsWith('/agent/')) return true;
    if (p.startsWith('/replication/sync/')) return true;
    if (p.startsWith('/replication/assets/')) return true;
    if (p === '/replication/maintenance/ack') return true;
    if (p.startsWith('/.well-known/oauth')) return true;

    const mcpUuid = getMcpUuid(globalResources);
    if (mcpUuid && (p === `/${mcpUuid}` || p.startsWith(`/${mcpUuid}/`))) return true;

    const apUuid = getApocryphaUuid(globalResources);
    if (apUuid && (p === `/${apUuid}` || p.startsWith(`/${apUuid}/`))) return true;

    if (method === 'OPTIONS' && p === '/status') return true;
    if (method === 'POST' && p === '/') return true;
    if (method === 'GET' && p === '/sw.js') return true;

    return false;
}

function sendHomepageFile(res, resolved, statusCode) {
    const code = statusCode || (resolved.kind === '404' ? 404 : 200);
    res.status(code);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const relName = resolved.rel || (resolved.abs ? path.basename(resolved.abs) : 'index.html');
    res.type(siteHomepage.contentTypeForRel(relName));
    res.sendFile(resolved.abs);
}

function serveHomepage404(siteDir, res) {
    const resolved = siteHomepage.resolveSiteFile(siteDir, '/__gate_missing__');
    if (resolved.kind === '404' || resolved.kind === 'file') {
        sendHomepageFile(res, resolved, 404);
        return true;
    }
    res.status(404).type('text/html; charset=utf-8').end('<!DOCTYPE html><html><head><title>Not found</title></head><body><p>Not found</p></body></html>');
    return true;
}

function handleDoorPost(req, res, globalResources, cfg, siteDir, doorMeta) {
    const ip = clientRealIp(req, globalResources);
    if (recordDoorFailure(ip)) {
        const noResult = siteHomepage.resolveSiteFile(siteDir, doorMeta.noResultPath);
        if (noResult.kind === 'file') {
            sendHomepageFile(res, noResult, 200);
        } else {
            serveHomepage404(siteDir, res);
        }
        return;
    }

    const q = req.body && (req.body.q != null ? String(req.body.q) : '');
    const candidate = siteAccess.computeAccessHash(cfg.pepper, q);
    if (candidate && siteAccess.validateAccessToken(candidate, cfg)) {
        resetDoorFailures(ip);
        siteAccess.setDskCookie(req, res, cfg.hash);
        res.redirect(303, `/launch?k=${encodeURIComponent(cfg.hash)}`);
        return;
    }

    console.log(`[siteGate] door failure from ${ip}`);
    const noResult = siteHomepage.resolveSiteFile(siteDir, doorMeta.noResultPath);
    if (noResult.kind === 'file') {
        sendHomepageFile(res, noResult, 200);
    } else {
        serveHomepage404(siteDir, res);
    }
}

function createSiteGateMiddleware(globalResources, projectRoot) {
    return function siteGateMiddleware(req, res, next) {
        res.removeHeader('X-Powered-By');
        const cfg = siteAccess.readSiteAccessSecure(globalResources);
        if (!cfg.configured) {
            return next();
        }

        if (isSiteGateExempt(req, globalResources)) {
            return next();
        }

        let token = siteAccess.parseAccessTokenFromRequest(req);
        if (token && siteAccess.validateAccessToken(token, cfg)) {
            siteAccess.setDskCookie(req, res, cfg.hash);
            const method = (req.method || 'GET').toUpperCase();
            const urlPath = (req.path || '/').split('?')[0] || '/';
            if (method === 'GET' && (urlPath === '/' || urlPath === '/index.html')) {
                const q = req.query && req.query.k != null && req.query.k !== ''
                    ? `?k=${encodeURIComponent(String(req.query.k))}`
                    : '';
                res.redirect(302, `/launch${q}`);
                return;
            }
            return next();
        }

        const siteDir = siteHomepage.installedDir(projectRoot, cfg.homepage);
        if (!fs.existsSync(siteDir)) {
            res.status(503).type('text/plain').send('Site homepage is not installed');
            return;
        }

        const method = (req.method || 'GET').toUpperCase();
        const urlPath = (req.path || '/').split('?')[0] || '/';
        const doorMeta = siteHomepage.readDoorMeta(siteDir);

        if (method === 'POST' && urlPath === doorMeta.postPath) {
            handleDoorPost(req, res, globalResources, cfg, siteDir, doorMeta);
            return;
        }

        if (method === 'GET' || method === 'HEAD') {
            const resolved = siteHomepage.resolveSiteFile(siteDir, urlPath);
            if (resolved.kind === 'file') {
                if (method === 'HEAD') {
                    res.status(200).end();
                    return;
                }
                sendHomepageFile(res, resolved, 200);
                return;
            }
            if (resolved.kind === '404') {
                if (method === 'HEAD') {
                    res.status(404).end();
                    return;
                }
                sendHomepageFile(res, resolved, 404);
                return;
            }
        }

        serveHomepage404(siteDir, res);
    };
}

function attachSiteGateWebUpgrade(server, globalResources, sessionStore, sessionSecret) {
    const existing = server.listeners('upgrade');
    server.removeAllListeners('upgrade');
    server.on('upgrade', (req, socket, head) => {
        const cfg = siteAccess.readSiteAccessSecure(globalResources);
        if (!cfg.configured) {
            existing.forEach((listener) => listener.call(server, req, socket, head));
            return;
        }

        const p = (req.url || '/').split('?')[0];
        if (p.startsWith('/api/desktop-guac/web/')) {
            existing.forEach((listener) => listener.call(server, req, socket, head));
            return;
        }

        const headerToken = req.headers && req.headers[siteAccess.ACCESS_HEADER];
        const dsk = siteAccess.parseDskFromUpgradeRequest(req);
        const token = siteAccess.normalizeAccessHash(headerToken) || dsk;
        if (token && siteAccess.validateAccessToken(token, cfg)) {
            existing.forEach((listener) => listener.call(server, req, socket, head));
            return;
        }

        if (sessionStore && sessionSecret) {
            const cookies = req.headers.cookie;
            const sidCookie = cookies && cookies.split(';').map((c) => c.trim()).find((c) => c.startsWith('connect.sid='));
            if (sidCookie) {
                try {
                    const encoded = decodeURIComponent(sidCookie.split('=').slice(1).join('='));
                    if (encoded.startsWith('s:')) {
                        const body = encoded.slice(2);
                        const dot = body.lastIndexOf('.');
                        if (dot > 0) {
                            const id = body.slice(0, dot);
                            const sig = body.slice(dot + 1);
                            const crypto = require('crypto');
                            let secrets = sessionSecret;
                            if (!Array.isArray(secrets)) secrets = [secrets];
                            let okSig = false;
                            for (const secret of secrets) {
                                if (!secret) continue;
                                const expected = crypto.createHmac('sha256', secret).update(id).digest('base64').replace(/=+$/, '');
                                const a = Buffer.from(expected);
                                const b = Buffer.from(sig);
                                if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
                                    okSig = true;
                                    break;
                                }
                            }
                            if (okSig) {
                                sessionStore.get(id, (err, session) => {
                                    if (!err && session && session.authenticated === true) {
                                        existing.forEach((listener) => listener.call(server, req, socket, head));
                                    } else {
                                        socket.destroy();
                                    }
                                });
                                return;
                            }
                        }
                    }
                } catch (_err) {
                    // fall through to destroy
                }
            }
        }

        socket.destroy();
    });
}

function mountSiteHomepagePreview(app, globalResources, projectRoot, authMiddleware) {
    app.get('/site-homepage-preview/:slug/*', authMiddleware, (req, res, next) => {
        if (req.userType !== 'admin' && !(req.session && req.session.userType === 'admin')) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const slug = req.params.slug;
        if (!siteHomepage.isSafeSlug(slug)) {
            return res.status(400).json({ error: 'Invalid slug' });
        }
        const tail = req.params[0] || 'index.html';
        const siteDir = siteHomepage.installedDir(projectRoot, slug);
        if (!fs.existsSync(siteDir)) {
            const avail = path.join(siteHomepage.availableDir(projectRoot), slug);
            if (!fs.existsSync(avail)) {
                return res.status(404).json({ error: 'Homepage not found' });
            }
            siteHomepage.installHomepage(projectRoot, slug);
        }
        const urlPath = '/' + tail.replace(/^\/+/, '');
        const resolved = siteHomepage.resolveSiteFile(siteHomepage.installedDir(projectRoot, slug), urlPath);
        if (resolved.kind === 'file') {
            return sendHomepageFile(res, resolved, 200);
        }
        if (resolved.kind === '404') {
            return sendHomepageFile(res, resolved, 404);
        }
        return next();
    });
}

function buildDreamscapeManifestJson(accessHash, staticManifest) {
    const base = staticManifest && typeof staticManifest === 'object'
        ? Object.assign({}, staticManifest)
        : {
            name: 'Dreamscape',
            short_name: 'Dreamscape',
            display: 'standalone',
            scope: '/'
        };
    base.id = '/?app=dreamscape';
    if (accessHash) {
        base.start_url = `/launch?k=${encodeURIComponent(accessHash)}`;
    } else if (!base.start_url) {
        base.start_url = '/launch';
    }
    return base;
}

function readStaticManifest(publicManifestPath) {
    if (!publicManifestPath || !fs.existsSync(publicManifestPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(publicManifestPath, 'utf8'));
    } catch (_err) {
        return null;
    }
}

function registerDynamicManifestRoute(app, globalResources, publicManifestPath) {
    app.get('/manifest.json', (req, res) => {
        const cfg = siteAccess.readSiteAccessSecure(globalResources);
        const token = siteAccess.parseAccessTokenFromRequest(req);
        const hash = cfg.configured && token && siteAccess.validateAccessToken(token, cfg) ? cfg.hash : null;
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        if (hash) {
            siteAccess.setDskCookie(req, res, cfg.hash);
        }
        const staticManifest = readStaticManifest(publicManifestPath);
        if (hash) {
            return res.json(buildDreamscapeManifestJson(hash, staticManifest));
        }
        if (staticManifest) {
            return res.json(buildDreamscapeManifestJson(null, staticManifest));
        }
        return res.json(buildDreamscapeManifestJson(null, null));
    });
}

module.exports = {
    createSiteGateMiddleware,
    attachSiteGateWebUpgrade,
    mountSiteHomepagePreview,
    registerDynamicManifestRoute,
    buildDreamscapeManifestJson,
    isSiteGateExempt,
    doorFailByIp
};
