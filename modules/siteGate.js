'use strict';

const fs = require('fs');
const path = require('path');
const { realClientIp, trustedProxiesFromResources } = require('./clientAddress');
const siteAccess = require('./siteAccess');
const siteHomepage = require('./siteHomepageStorage');
const siteHomepagePreview = require('./siteHomepagePreview');
const replicationTokenAuth = require('./replicationTokenAuth');

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

/**
 * Dreamscape's own clients announce themselves: the X-Dreamscape-Client header (the BIOS, the
 * launch page, DSApp-Kotlin / DSApp-Win), or DSApp-Win's DreamscapeShell/ user agent from
 * before the header. A scanner sends neither, so the app endpoints below stay invisible to it.
 */
const CLIENT_HEADER = 'x-dreamscape-client';
function hasClientKnock(req) {
    const header = req.headers && req.headers[CLIENT_HEADER];
    if (typeof header === 'string' && header.trim()) return true;
    const ua = req.headers && req.headers['user-agent'];
    return typeof ua === 'string' && ua.startsWith('DreamscapeShell/');
}

function isLoopbackRequest(req, globalResources) {
    const { isLoopbackIp } = require('./clientAddress');
    return isLoopbackIp(clientRealIp(req, globalResources));
}

/**
 * The MCP connector's own hostname (config mcp_public_hostname, e.g. mcp.example.net). When it
 * is set, OAuth discovery and the MCP mount answer only on that host: the cover host never
 * shows them. Unset: on every host, as before.
 */
function mcpHostname(globalResources) {
    try {
        const host = globalResources.getConfig({ path: 'mcp_public_hostname' });
        return typeof host === 'string' && host.trim() ? host.trim().toLowerCase() : null;
    } catch (_err) {
        return null;
    }
}

function requestHost(req) {
    const raw = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
    return String(raw).split(',')[0].trim().toLowerCase();
}

function onMcpHost(req, globalResources) {
    const host = mcpHostname(globalResources);
    if (!host) return true;
    const got = requestHost(req);
    return got === host || got.split(':')[0] === host.split(':')[0];
}

function isSiteGateExempt(req, globalResources) {
    const method = (req.method || 'GET').toUpperCase();
    const p = (req.path || '/').split('?')[0];

    // The local agent API answers loopback only; from anywhere else it is the cover
    if (p === '/agent' || p.startsWith('/agent/')) return isLoopbackRequest(req, globalResources);
    // Partner instances carry their replication token, not the gate key. Without a token
    // that matches a configured one the routes stay behind the cover like everything else.
    if (p.startsWith('/replication/sync/') || p.startsWith('/replication/assets/') || p === '/replication/maintenance/ack') {
        return hasReplicationCredential(req, globalResources);
    }
    if (p.startsWith('/.well-known/oauth')) return onMcpHost(req, globalResources);

    const mcpUuid = getMcpUuid(globalResources);
    if (mcpUuid && (p === `/${mcpUuid}` || p.startsWith(`/${mcpUuid}/`))) return onMcpHost(req, globalResources);

    const apUuid = getApocryphaUuid(globalResources);
    if (apUuid && (p === `/${apUuid}` || p.startsWith(`/${apUuid}/`))) return true;

    // The app's own endpoints: for Dreamscape clients only (a valid key or a session passes
    // the gate anyway). Anyone else gets what a static server would answer.
    if (method === 'OPTIONS' && p === '/status') return hasClientKnock(req);
    if (method === 'POST' && p === '/') return hasClientKnock(req);
    if (method === 'GET' && p === '/sw.js') return hasClientKnock(req);

    // /site-homepage-preview is mounted ahead of the gate and answers only with its ticket or
    // preview cookie; anything else falls through to the cover (siteHomepagePreviewAccess).

    return false;
}

function hasReplicationCredential(req, globalResources) {
    let config = null;
    try {
        config = globalResources.getReplicationService().getReplicationConfig();
    } catch (_err) {
        return false;
    }
    const { writeToken, readToken } = replicationTokenAuth.getTokens(config);
    if (!writeToken && !readToken) return false;
    const token = replicationTokenAuth.getReplicationTokenFromRequest(req);
    if (!token) return false;
    const t = String(token);
    return t === writeToken || t === readToken;
}

/**
 * The gate key a request presents, explicit first: the X-Dreamscape-Access header, then
 * ?k=, then the dsk cookie. null when it presents none.
 */
function presentedAccessToken(req) {
    const header = req.headers && req.headers[siteAccess.ACCESS_HEADER];
    if (header != null && header !== '') return String(header);
    if (req.query && req.query.k != null && req.query.k !== '') return String(req.query.k);
    const cookie = (req.cookies && req.cookies[siteAccess.DSK_COOKIE])
        || siteAccess.parseDskFromUpgradeRequest(req);
    return cookie ? String(cookie) : null;
}

/**
 * Gate state for OPTIONS /status. null when the gate is off. passed: a valid key or a signed-in
 * session. hor (Hash OK Return): only when the request presented a key, whether that key is
 * valid, so a PWA, an external app or the BIOS knows to ask for the Gateway Password.
 */
function gateStatusForRequest(req, globalResources) {
    const cfg = siteAccess.readSiteAccessSecure(globalResources);
    if (!cfg.configured) return null;
    const presented = presentedAccessToken(req);
    const hor = presented != null ? siteAccess.validateAccessToken(presented, cfg) : null;
    const passed = hor === true || !!(req.session && req.session.authenticated === true);
    return { configured: true, passed, hor, homepage: cfg.homepage };
}

/**
 * POST / { action: 'gateway', data: { password } }: the BIOS Gateway Password. The cover
 * site's door phrase, checked like the door (same failure window): sets the dsk cookie and
 * answers the key, so an installed client with a stale key gets back in without the homepage.
 */
function handleGatewayUnlock(req, res, globalResources) {
    const cfg = siteAccess.readSiteAccessSecure(globalResources);
    if (!cfg.configured) {
        return res.status(404).json({ success: false, error: 'Not found' });
    }
    const ip = clientRealIp(req, globalResources);
    const row = doorFailByIp.get(ip);
    if (row && Date.now() - row.windowStart <= DOOR_FAIL_WINDOW_MS && row.count >= DOOR_FAIL_MAX) {
        return res.status(429).json({ success: false, error: 'Too many attempts', code: 'GATEWAY_LOCKED' });
    }
    const data = (req.body && req.body.data) || {};
    const phrase = siteAccess.normalizeAccessPhrase(data.password);
    const candidate = phrase ? siteAccess.computeAccessHash(cfg.pepper, phrase) : null;
    if (candidate && siteAccess.validateAccessToken(candidate, cfg)) {
        resetDoorFailures(ip);
        siteAccess.setDskCookie(req, res, cfg.hash);
        return res.json({ success: true, k: cfg.hash });
    }
    recordDoorFailure(ip);
    console.log(`[siteGate] gateway password failure from ${ip}`);
    return res.status(401).json({ success: false, error: 'Incorrect password', code: 'GATEWAY_DENIED' });
}

// Headers Helmet sets for the app. A static site behind nginx does not send these, so the cover
// drops them (HSTS, nosniff and X-Frame-Options are common nginx config and stay).
const APP_ONLY_HEADERS = [
    'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy', 'Origin-Agent-Cluster',
    'Referrer-Policy', 'X-DNS-Prefetch-Control', 'X-Download-Options',
    'X-Permitted-Cross-Domain-Policies', 'X-XSS-Protection', 'Content-Security-Policy',
    'X-Response-Time', 'X-Powered-By'
];

function stripAppHeaders(res) {
    for (const name of APP_ONLY_HEADERS) res.removeHeader(name);
}

// nginx's mime.types: text/html without a charset, no text/csv (default_type octet-stream)
const NGINX_TYPES = {
    '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.txt': 'text/plain', '.xml': 'text/xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
    '.woff2': 'font/woff2', '.woff': 'font/woff'
};

function nginxType(rel) {
    return NGINX_TYPES[path.extname(rel || '').toLowerCase()] || 'application/octet-stream';
}

function nginxEtag(stat) {
    return `"${Math.floor(stat.mtimeMs / 1000).toString(16)}-${stat.size.toString(16)}"`;
}

function nginxErrorPage(code, title) {
    return `<html>\r\n<head><title>${code} ${title}</title></head>\r\n<body>\r\n<center><h1>${code} ${title}</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n`;
}

/** nginx's own error page (405 for a method a static file does not take, 403 for a bare directory). */
function sendNginxError(res, code) {
    const title = { 403: 'Forbidden', 405: 'Not Allowed', 400: 'Bad Request' }[code] || 'Error';
    stripAppHeaders(res);
    const body = nginxErrorPage(code, title);
    res.status(code);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.end(body);
}

/**
 * A cover file as nginx serves a static file: Last-Modified, an nginx ETag, Accept-Ranges,
 * no Cache-Control, HEAD with the same headers, 304 on a matching conditional request.
 * html (optional): a rendered body (the door's result page) sent in place of the file.
 */
async function sendCoverFile(req, res, resolved, statusCode, html) {
    const code = statusCode || (resolved.kind === '404' ? 404 : 200);
    let stat;
    try {
        stat = await fs.promises.stat(resolved.abs);
    } catch (_err) {
        return sendNginxError(res, 403);
    }
    stripAppHeaders(res);
    const rel = resolved.rel || path.basename(resolved.abs);
    res.status(code);
    res.setHeader('Content-Type', nginxType(rel));
    if (html != null) {
        const body = Buffer.from(html, 'utf8');
        res.setHeader('Content-Length', body.length);
        if ((req.method || 'GET').toUpperCase() === 'HEAD') return res.end();
        return res.end(body);
    }
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    if (code === 200) {
        const etag = nginxEtag(stat);
        res.setHeader('ETag', etag);
        res.setHeader('Accept-Ranges', 'bytes');
        const inm = req.headers['if-none-match'];
        const ims = req.headers['if-modified-since'];
        const notModified = inm
            ? inm.split(',').map((t) => t.trim()).includes(etag)
            : (ims && Date.parse(ims) >= Math.floor(stat.mtimeMs / 1000) * 1000);
        if (notModified) {
            res.removeHeader('Content-Type');
            res.status(304);
            return res.end();
        }
    }
    res.setHeader('Content-Length', stat.size);
    if ((req.method || 'GET').toUpperCase() === 'HEAD') return res.end();
    fs.createReadStream(resolved.abs).on('error', () => res.destroy()).pipe(res);
}

// Admin preview (Alchemy): the plain file, cover-style
function sendHomepageFile(res, resolved, statusCode) {
    const code = statusCode || (resolved.kind === '404' ? 404 : 200);
    res.status(code);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const relName = resolved.rel || (resolved.abs ? path.basename(resolved.abs) : 'index.html');
    res.type(siteHomepage.contentTypeForRel(relName));
    res.sendFile(resolved.abs);
}

async function serveHomepage404(req, siteDir, res) {
    const resolved = await siteHomepage.resolveSiteFileAsync(siteDir, '/__gate_missing__');
    if (resolved.kind === '404') {
        return sendCoverFile(req, res, resolved, 404);
    }
    stripAppHeaders(res);
    const body = nginxErrorPage(404, 'Not Found');
    res.status(404).setHeader('Content-Type', 'text/html');
    res.end(body);
}

/** The door's result page for a query: the matching listed record, or the site's "none found". */
async function sendDoorResult(req, res, siteDir, doorMeta, query) {
    const page = await siteHomepage.resolveSiteFileAsync(siteDir, '/' + doorMeta.resultPage);
    if (page.kind !== 'file') return serveHomepage404(req, siteDir, res);
    let html;
    try {
        html = await fs.promises.readFile(page.abs, 'utf8');
    } catch (_err) {
        return serveHomepage404(req, siteDir, res);
    }
    const rendered = siteHomepage.renderDoorResult(html, doorMeta, query);
    return sendCoverFile(req, res, page, 200, rendered.html);
}

async function handleDoorPost(req, res, globalResources, cfg, siteDir, doorMeta, q) {
    const ip = clientRealIp(req, globalResources);
    q = q != null ? String(q) : '';
    // A listed record is an ordinary lookup: never a door failure, never the phrase
    const isRecord = !!(doorMeta.records && doorMeta.records[siteHomepage.normalizeDoorQuery(q)] != null);
    if (!isRecord && q) {
        const locked = recordDoorFailure(ip);
        const phrase = siteAccess.normalizeAccessPhrase(q);
        if (!locked && phrase) {
            const candidate = siteAccess.computeAccessHash(cfg.pepper, phrase);
            if (candidate && siteAccess.validateAccessToken(candidate, cfg)) {
                resetDoorFailures(ip);
                siteAccess.setDskCookie(req, res, cfg.hash);
                stripAppHeaders(res);
                // Passphrase stays in POST body only; the stored access hash may go in the URL.
                res.redirect(303, `/launch?k=${encodeURIComponent(cfg.hash)}`);
                return;
            }
            console.log(`[siteGate] door failure from ${ip}`);
        }
    }
    return sendDoorResult(req, res, siteDir, doorMeta, q);
}

function createSiteGateMiddleware(globalResources, projectRoot) {
    return function siteGateMiddleware(req, res, next) {
        res.removeHeader('X-Powered-By');
        const cfg = siteAccess.readSiteAccessSecure(globalResources);
        if (!cfg.configured) {
            return next();
        }

        // Past gate 1 (a valid access token): web_server.js securityMiddleware skips the
        // instant block for these requests and the rate limits are looser.
        let token = siteAccess.parseAccessTokenFromRequest(req);
        const tokenValid = !!token && siteAccess.validateAccessToken(token, cfg);
        req.siteGatePassed = tokenValid;

        if (isSiteGateExempt(req, globalResources)) {
            return next();
        }

        // Authenticated Dreamscape session bypasses the cover (gate runs after express-session).
        if (req.session && req.session.authenticated === true) {
            if (cfg.hash) {
                siteAccess.setDskCookie(req, res, cfg.hash);
            }
            return next();
        }

        if (tokenValid) {
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

        serveCoverSite(req, res, globalResources, cfg, projectRoot).catch(next);
    };
}

// Gated (logged-out) requests: the cover site, answered the way nginx serves a static site.
async function serveCoverSite(req, res, globalResources, cfg, projectRoot) {
    const siteDir = siteHomepage.coverSiteDir(projectRoot, cfg.homepage);
    let siteDirExists = false;
    if (siteDir) {
        try {
            await fs.promises.stat(siteDir);
            siteDirExists = true;
        } catch (_err) {
            siteDirExists = false;
        }
    }
    if (!siteDirExists) {
        // nothing that names the folder: an empty server is a 404 like any other
        console.error(`[siteGate] cover site folder missing: ${cfg.homepage}`);
        stripAppHeaders(res);
        res.status(404).setHeader('Content-Type', 'text/html');
        res.end(nginxErrorPage(404, 'Not Found'));
        return;
    }

    const method = (req.method || 'GET').toUpperCase();
    const urlPath = (req.path || '/').split('?')[0] || '/';
    const doorMeta = siteHomepage.readDoorMeta(siteDir);

    const doorPhrase = siteHomepage.extractDoorPhrase(req, doorMeta, { clientKnock: hasClientKnock(req) });
    if (doorPhrase !== undefined) {
        await handleDoorPost(req, res, globalResources, cfg, siteDir, doorMeta, doorPhrase);
        return;
    }

    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
        return sendNginxError(res, 405);
    }

    // GET on the door's action or result page with ?q=: the public lookup (never the phrase)
    if (method !== 'POST' && (urlPath === doorMeta.postPath || urlPath === '/' + doorMeta.resultPage)
        && req.query && req.query[doorMeta.field || 'q'] != null) {
        return sendDoorResult(req, res, siteDir, doorMeta, String(req.query[doorMeta.field || 'q']));
    }
    // The action endpoint without a query: the search page itself
    if (method !== 'POST' && urlPath === doorMeta.postPath && doorMeta.postPath !== '/' + doorMeta.resultPage) {
        return sendDoorResult(req, res, siteDir, doorMeta, '');
    }

    // A contact form's endpoint: its "sent" page, whatever was posted (nothing is kept)
    if (method === 'POST' && doorMeta.forms && doorMeta.forms[urlPath]) {
        const sent = await siteHomepage.resolveSiteFileAsync(siteDir, '/' + doorMeta.forms[urlPath]);
        if (sent.kind === 'file') return sendCoverFile(req, res, sent, 200);
    }

    const resolved = await siteHomepage.resolveSiteFileAsync(siteDir, urlPath);
    if (method === 'POST') {
        // a static file takes no POST
        if (resolved.kind === 'file' || resolved.kind === 'redirect' || resolved.kind === 'forbidden') {
            return sendNginxError(res, 405);
        }
        return serveHomepage404(req, siteDir, res);
    }
    if (resolved.kind === 'file') return sendCoverFile(req, res, resolved, 200);
    if (resolved.kind === 'redirect') {
        stripAppHeaders(res);
        const body = nginxErrorPage(301, 'Moved Permanently');
        res.status(301).setHeader('Location', resolved.location);
        res.setHeader('Content-Type', 'text/html');
        return res.end(method === 'HEAD' ? undefined : body);
    }
    if (resolved.kind === 'forbidden') return sendNginxError(res, 403);
    return serveHomepage404(req, siteDir, res);
}

// A refused WebSocket upgrade answers like a static server (404), not a dropped connection
function refuseUpgrade(socket) {
    const body = nginxErrorPage(404, 'Not Found');
    try {
        socket.end(`HTTP/1.1 404 Not Found\r\nContent-Type: text/html\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    } catch (_err) {
        socket.destroy();
    }
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

        // /api/desktop-guac/web/ included: its own upgrade handler wants an admin session, and
        // a session passes here as well
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
                                        refuseUpgrade(socket);
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

        refuseUpgrade(socket);
    });
}

function siteHomepagePreviewAccess(globalResources) {
    return function siteHomepagePreviewAccessMiddleware(req, res, next) {
        const slug = req.params.slug;
        if (!siteHomepage.isSafeSlug(slug)) {
            return next('route');
        }
        if (siteHomepagePreview.requestIsAdminPreview(req)) {
            return next();
        }
        const sessionVal = siteHomepagePreview.parseSprevCookie(req);
        if (siteHomepagePreview.verifyPreviewSession(globalResources, slug, sessionVal)) {
            return next();
        }
        const ticket = req.query && req.query.t != null ? String(req.query.t) : '';
        if (ticket && siteHomepagePreview.verifyPreviewTicket(globalResources, slug, ticket)) {
            siteHomepagePreview.setPreviewSessionCookie(req, res, globalResources, slug);
            return next();
        }
        // No ticket: as if the route did not exist (the gate's cover, or the 404 past it)
        return next('route');
    };
}

function serveSiteHomepagePreviewFile(req, res, projectRoot, next) {
    const slug = req.params.slug;
    if (!siteHomepage.isSafeSlug(slug)) {
        return res.status(400).json({ error: 'Invalid slug' });
    }
    const hit = siteHomepage.resolvePreviewSiteDir(projectRoot, slug);
    if (!hit) {
        return res.status(404).json({ error: 'Homepage not found' });
    }
    const tail = req.params[0];
    const urlPath = tail ? '/' + String(tail).replace(/^\/+/, '') : '/';
    const resolved = siteHomepage.resolveSiteFile(hit.siteDir, urlPath);
    if (resolved.kind === 'file') {
        return sendHomepageFile(res, resolved, 200);
    }
    if (resolved.kind === '404') {
        return sendHomepageFile(res, resolved, 404);
    }
    return next();
}

function mountSiteHomepagePreview(app, globalResources, projectRoot) {
    const root = projectRoot || path.join(__dirname, '..');
    const access = siteHomepagePreviewAccess(globalResources);
    const handler = (req, res, next) => serveSiteHomepagePreviewFile(req, res, root, next);
    // No authMiddleware: Alchemy's server-side Chromium has no Dreamscape session cookie.
    // Admin mints a short-lived ?t= ticket over WS; follow-up assets use the sprev cookie.
    app.get('/site-homepage-preview/:slug', access, handler);
    app.get('/site-homepage-preview/:slug/*', access, handler);
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

// /manifest.json is fetched on every page load; public/manifest.json changes on deploy only.
const STATIC_MANIFEST_TTL_MS = 2000;
let staticManifestCache = null;

function readStaticManifest(publicManifestPath) {
    const now = Date.now();
    if (staticManifestCache
        && staticManifestCache.path === publicManifestPath
        && now - staticManifestCache.at < STATIC_MANIFEST_TTL_MS) {
        // buildDreamscapeManifestJson copies before it edits; hand out a fresh object anyway.
        return staticManifestCache.value ? JSON.parse(staticManifestCache.text) : null;
    }
    const value = readStaticManifestUncached(publicManifestPath);
    staticManifestCache = { path: publicManifestPath, at: now, value, text: value ? JSON.stringify(value) : null };
    return value;
}

function readStaticManifestUncached(publicManifestPath) {
    if (!publicManifestPath || !fs.existsSync(publicManifestPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(publicManifestPath, 'utf8'));
    } catch (_err) {
        return null;
    }
}

function projectRootForManifest(publicManifestPath) {
    // <root>/public/manifest.json
    return path.resolve(path.dirname(publicManifestPath), '..');
}

/**
 * Before gate 1: a plain web manifest in the cover site's name. No Dreamscape name, icons,
 * screenshots or id, so an installed Dreamscape PWA (id /?app=dreamscape) never takes it.
 */
function buildCoverManifestJson(cfg, projectRoot) {
    let title = '';
    let lang = 'en';
    try {
        const siteDir = siteHomepage.coverSiteDir(projectRoot, cfg.homepage);
        const meta = siteDir ? JSON.parse(fs.readFileSync(path.join(siteDir, 'manifest.json'), 'utf8')) : null;
        if (meta && typeof meta.title === 'string') title = meta.title.trim();
        if (meta && typeof meta.lang === 'string') lang = meta.lang.trim() || lang;
    } catch (_err) { /* the plain fallback below */ }
    const name = title || 'Home';
    const shortName = name.split('|').pop().trim() || name;
    return {
        name,
        short_name: shortName.slice(0, 24),
        start_url: '/',
        scope: '/',
        display: 'browser',
        lang
    };
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
        if (cfg.configured && !(req.session && req.session.authenticated === true)) {
            const body = JSON.stringify(buildCoverManifestJson(cfg, projectRootForManifest(publicManifestPath)));
            res.removeHeader('Cache-Control');
            res.setHeader('Content-Type', 'application/json');
            return res.end(body);
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
    hasClientKnock,
    CLIENT_HEADER,
    gateStatusForRequest,
    handleGatewayUnlock,
    doorFailByIp
};
