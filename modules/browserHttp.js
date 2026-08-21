/**
 * Shared browser-like HTTP helpers for outbound requests (NovelAI and similar).
 * Chromium Chrome / Windows header fingerprints so server calls look like a real browser.
 *
 * Usage:
 *   const { getBrowserHeaders, browserFetch, browserRequest } = require('./browserHttp');
 *   const headers = getBrowserHeaders({
 *     acceptResType: 'json',      // html | json | image | any | custom Accept string
 *     allowCompression: true,     // include Accept-Encoding
 *     stealth: false,             // true = omit Dreamscape/version from User-Agent
 *     extra: { authorization: `Bearer ${key}` }
 *   });
 *   const res = await browserFetch(url, { method: 'POST', body, headers: { authorization }, browser: { acceptResType: 'json' } });
 */

'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotliDecompress = promisify(zlib.brotliDecompress);

const BROWSER_UA_BASE =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

const DEFAULT_ORIGIN = 'https://novelai.net';
const DEFAULT_REFERER = 'https://novelai.net/';

const ACCEPT_HTML =
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
const ACCEPT_IMAGE = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
// Only encodings Node zlib can decode (no zstd — advertising it returns undecodable bodies).
const ACCEPT_ENCODING = 'gzip, deflate, br';

/** Chrome Client Hints + shared navigate/API chrome base. */
const CHROME_CLIENT_HINTS = {
    'accept-language': 'en-US,en;q=0.9',
    dnt: '1',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-gpc': '1'
};

/**
 * Profiles keyed by acceptResType.
 * - html/document: full navigation fingerprint (user-supplied Chrome headers)
 * - json / image / any: same Chrome identity, CORS-style fetch metadata for XHR/fetch APIs
 */
const ACCEPT_RES_PROFILES = {
    html: {
        accept: ACCEPT_HTML,
        priority: 'u=0, i',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        includeOrigin: false
    },
    document: null, // alias → html
    json: {
        accept: 'application/json',
        priority: 'u=1, i',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        includeOrigin: true
    },
    image: {
        accept: ACCEPT_IMAGE,
        priority: 'u=1, i',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        includeOrigin: true
    },
    any: {
        accept: '*/*',
        priority: 'u=1, i',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        includeOrigin: true
    }
};
ACCEPT_RES_PROFILES.document = ACCEPT_RES_PROFILES.html;

let cachedVersion = null;

function getDreamscapeVersion() {
    if (cachedVersion != null) return cachedVersion;
    try {
        cachedVersion = String(require('../package.json').version || '1.0.0');
    } catch (_) {
        cachedVersion = '1.0.0';
    }
    return cachedVersion;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.stealth=false] If true, omit Dreamscape/version suffix.
 */
function getBrowserUserAgent(options = {}) {
    const stealth = !!options.stealth;
    if (stealth) return BROWSER_UA_BASE;
    return `${BROWSER_UA_BASE} Dreamscape/${getDreamscapeVersion()}`;
}

/** Short opaque id similar to NAI client (e.g. SJtOHQ). */
function newCorrelationId() {
    return crypto.randomBytes(4).toString('base64').replace(/[+/=]/g, '').slice(0, 6);
}

function normalizeHeaderMap(headers) {
    if (!headers) return {};
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        const out = {};
        headers.forEach((value, key) => {
            out[key.toLowerCase()] = value;
        });
        return out;
    }
    const out = {};
    for (const [key, value] of Object.entries(headers)) {
        if (value == null) continue;
        out[String(key).toLowerCase()] = String(value);
    }
    return out;
}

function resolveAcceptResProfile(acceptResType) {
    const key = String(acceptResType || 'json').trim().toLowerCase();
    if (ACCEPT_RES_PROFILES[key]) {
        return { profile: ACCEPT_RES_PROFILES[key], customAccept: null };
    }
    // Custom Accept string (e.g. "image/webp,image/*,*/*")
    return {
        profile: {
            accept: acceptResType,
            priority: 'u=1, i',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            includeOrigin: true
        },
        customAccept: acceptResType
    };
}

/**
 * Build Chrome-like headers for an outbound request.
 *
 * @param {object} [options]
 * @param {string} [options.acceptResType='json'] html|document|json|image|any|custom Accept value
 * @param {boolean} [options.allowCompression=true] Include Accept-Encoding: gzip, deflate, br
 * @param {boolean} [options.stealth=false] Omit Dreamscape/version from User-Agent
 * @param {boolean} [options.json] Include content-type: application/json (default: true for json acceptResType)
 * @param {string|null} [options.origin] Override Origin (null/false to omit)
 * @param {string|null} [options.referer] Override Referer (null/false to omit)
 * @param {string} [options.correlationId] Reuse a correlation id; otherwise a new one is generated
 * @param {boolean} [options.correlation=true] Include x-correlation-id (NAI-style)
 * @param {object} [options.extra] Extra/override headers
 * @returns {Record<string, string>}
 */
function getBrowserHeaders(options = {}) {
    const {
        acceptResType = 'json',
        allowCompression = true,
        stealth = false,
        origin = DEFAULT_ORIGIN,
        referer = DEFAULT_REFERER,
        correlationId = null,
        correlation = true,
        extra = {}
    } = options;

    const { profile } = resolveAcceptResProfile(acceptResType);

    const wantsJsonContentType = options.json != null
        ? !!options.json
        : String(acceptResType || 'json').toLowerCase() === 'json';

    const headers = {
        ...CHROME_CLIENT_HINTS,
        accept: profile.accept,
        priority: profile.priority,
        'sec-fetch-dest': profile['sec-fetch-dest'],
        'sec-fetch-mode': profile['sec-fetch-mode'],
        'sec-fetch-site': profile['sec-fetch-site'],
        'user-agent': getBrowserUserAgent({ stealth })
    };

    if (profile['sec-fetch-user']) {
        headers['sec-fetch-user'] = profile['sec-fetch-user'];
    }
    if (profile['upgrade-insecure-requests']) {
        headers['upgrade-insecure-requests'] = profile['upgrade-insecure-requests'];
    }

    if (allowCompression) {
        headers['accept-encoding'] = ACCEPT_ENCODING;
    }

    if (profile.includeOrigin) {
        if (origin) headers.origin = origin;
        if (referer) headers.referer = referer;
    }

    if (wantsJsonContentType) {
        headers['content-type'] = 'application/json';
    }

    if (correlation) {
        headers['x-correlation-id'] = correlationId || newCorrelationId();
    }

    const extraNorm = normalizeHeaderMap(extra);
    Object.assign(headers, extraNorm);

    // Keep computed UA unless caller overrides user-agent in extra.
    if (!extraNorm['user-agent']) {
        headers['user-agent'] = getBrowserUserAgent({ stealth });
    }

    return headers;
}

async function decompressIfNeeded(buffer, contentEncoding) {
    const enc = String(contentEncoding || '').toLowerCase().trim();
    if (!enc || enc === 'identity') return buffer;
    try {
        if (enc.includes('gzip')) return await gunzip(buffer);
        if (enc.includes('deflate')) return await inflate(buffer);
        if (enc.includes('br')) return await brotliDecompress(buffer);
        console.warn(`browserHttp: unsupported content-encoding "${enc}", returning raw body`);
    } catch (err) {
        console.warn('browserHttp: decompress failed, returning raw body', err.message);
    }
    return buffer;
}

/**
 * fetch() wrapper that merges browser headers. Node's fetch decompresses responses.
 *
 * @param {string|URL} url
 * @param {RequestInit & { browser?: object }} [init]
 *   `browser` is passed to getBrowserHeaders (acceptResType, allowCompression, stealth, …).
 * @returns {Promise<Response>}
 */
async function browserFetch(url, init = {}) {
    const { browser = {}, headers: initHeaders, ...rest } = init;
    const method = String(rest.method || 'GET').toUpperCase();
    const extra = normalizeHeaderMap(initHeaders);

    const acceptResType = browser.acceptResType != null
        ? browser.acceptResType
        : (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? 'any' : 'json');

    const headers = getBrowserHeaders({
        ...browser,
        acceptResType,
        json: browser.json != null
            ? !!browser.json
            : (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && acceptResType === 'json'),
        extra: { ...extra, ...(browser.extra || {}) }
    });

    if ((method === 'GET' || method === 'HEAD' || method === 'OPTIONS') && !extra['content-type']) {
        delete headers['content-type'];
    }

    return fetch(url, {
        ...rest,
        headers
    });
}

function resolveRequestTarget(urlOrOptions) {
    if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
        const u = typeof urlOrOptions === 'string' ? new URL(urlOrOptions) : urlOrOptions;
        const isHttps = u.protocol === 'https:';
        return {
            isHttps,
            options: {
                protocol: u.protocol,
                hostname: u.hostname,
                port: u.port || (isHttps ? 443 : 80),
                path: `${u.pathname}${u.search}`,
                method: 'GET'
            }
        };
    }

    const options = { ...urlOrOptions };
    const isHttps = options.protocol
        ? options.protocol === 'https:'
        : (options.port == null || options.port === 443 || options.defaultPort === 443);
    return { isHttps, options };
}

/**
 * Low-level http(s).request wrapper with browser headers + optional body.
 * Decompresses gzip/deflate/br when allowCompression is enabled (default).
 *
 * @param {string|URL|object} urlOrOptions URL string or Node http(s) request options
 * @param {Buffer|string|null} [body]
 * @param {object} [browserOpts] Passed to getBrowserHeaders; also `timeoutMs` (default 60000)
 * @returns {Promise<{ statusCode: number, headers: object, body: Buffer }>}
 */
function browserRequest(urlOrOptions, body = null, browserOpts = {}) {
    const { timeoutMs = 60000, ...headerOpts } = browserOpts;
    const { isHttps, options } = resolveRequestTarget(urlOrOptions);
    const method = String(options.method || (body ? 'POST' : 'GET')).toUpperCase();
    options.method = method;

    const extra = normalizeHeaderMap(options.headers);
    const allowCompression = headerOpts.allowCompression != null ? !!headerOpts.allowCompression : true;

    const acceptResType = headerOpts.acceptResType != null
        ? headerOpts.acceptResType
        : (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? 'any' : 'json');

    const headers = getBrowserHeaders({
        ...headerOpts,
        acceptResType,
        allowCompression,
        json: headerOpts.json != null
            ? !!headerOpts.json
            : (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && acceptResType === 'json'),
        extra: { ...extra, ...(headerOpts.extra || {}) }
    });

    if ((method === 'GET' || method === 'HEAD' || method === 'OPTIONS') && !extra['content-type']) {
        delete headers['content-type'];
    }

    let bodyBuffer = null;
    if (body != null) {
        bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
        if (!headers['content-length']) {
            headers['content-length'] = String(bodyBuffer.length);
        }
    }

    options.headers = headers;

    const transport = isHttps ? https : http;

    return new Promise((resolve, reject) => {
        const req = transport.request(options, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', async () => {
                try {
                    const raw = Buffer.concat(chunks);
                    const bodyOut = allowCompression
                        ? await decompressIfNeeded(raw, res.headers['content-encoding'])
                        : raw;
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: bodyOut
                    });
                } catch (err) {
                    reject(err);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('Upstream request timeout'));
        });
        if (bodyBuffer) req.write(bodyBuffer);
        req.end();
    });
}

module.exports = {
    DEFAULT_ORIGIN,
    DEFAULT_REFERER,
    BROWSER_UA_BASE,
    ACCEPT_HTML,
    ACCEPT_IMAGE,
    ACCEPT_ENCODING,
    ACCEPT_RES_PROFILES,
    getDreamscapeVersion,
    getBrowserUserAgent,
    newCorrelationId,
    getBrowserHeaders,
    decompressIfNeeded,
    browserFetch,
    browserRequest
};
