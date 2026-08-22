const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const crypto = require('crypto');
const compression = require('compression');
const helmet = require('helmet');

// Security and Rate Limiting
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

// Scheduled preset generation data structures
const pendingRequests = new Map(); // requestId -> { requestId, presetUuid, scheduledTime, status, filename, filenames, retrievedAt, startedAt, completedAt, errorMessage, queryParams, workspaceId, timeoutId, name, breakPoint }
const namedRequests = new Map(); // name -> requestId (for named request lookups)
const scheduledQueue = []; // Array of requestIds in FIFO order
let processingScheduled = false; // Flag to prevent concurrent processing
let lastScheduledCompletion = 0; // Timestamp of last scheduled request completion

// Import modules
const globalResources = require('./modules/globalResources');
const { createApplicationAuthEarlyMiddleware } = require('./modules/auth');
globalResources.prepare();
const authMiddleware = globalResources.getAuthMiddleware();
const devAuthMiddleware = globalResources.getDevAuthMiddleware();
const { processDynamicImage } = require('./modules/imageTools');
const { runCacheDirExpiry, CLEANUP_INTERVAL_MS, FIRST_RUN_DELAY_MS } = require('./modules/cacheDirExpiry');
const { handleGeneration, buildOptions, handleRerollGeneration, handleStagedGeneration } = require('./modules/imageGeneration');
const UnixSocketCommunication = require('./modules/unixSocketCommunication');
const { handleNaxImageRequest } = require('./modules/naxImageServer');
const { isAdminUser } = require('./modules/auth');
const { streamLogFile } = require('./modules/logStreamService');
const pm2Service = require('./modules/pm2Service');
const runtimeAssetService = require('./modules/runtimeAssetService');
const workspaceCssService = require('./modules/workspaceCssService');
const serverStartupStatus = require('./modules/serverStartupStatus');
const { browserRequest } = require('./modules/browserHttp');
const { getQwenTokenizerDefinition } = require('./modules/qwenTokenizerAssetCache');
const { getOpusUsageFromAccountData } = require('./modules/opusUsage');

let runtimeCompileComplete = false;

function broadcastRuntimeCompileErrors(result) {
    const errors = result && Array.isArray(result.errors) ? result.errors : [];
    if (errors.length === 0) {
        return;
    }
    try {
        const plumbing = globalResources.getDataPlumbing();
        plumbing.publish('ws:broadcast:runtimeCompileError', {
            errors,
            compiled: result.compiled || 0,
            skipped: result.skipped || 0,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Failed to broadcast runtime compile errors:', error.message);
    }
}

function broadcastRuntimeCompileProgress(progress) {
    try {
        const plumbing = globalResources.getDataPlumbing();
        plumbing.publish('ws:broadcast:runtimeCompileProgress', {
            ...progress,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Failed to broadcast runtime compile progress:', error.message);
    }
}

function broadcastRuntimeCompileComplete(result) {
    try {
        const plumbing = globalResources.getDataPlumbing();
        const errors = result.errors || [];
        plumbing.publish('ws:broadcast:runtimeCompileComplete', {
            compiled: result.compiled || 0,
            failedCount: errors.length,
            errors,
            stats: result.stats || null,
            runId: result.runId || null,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Failed to broadcast runtime compile complete:', error.message);
    }
}

function broadcastRuntimeCompileLogs(payload) {
    try {
        const plumbing = globalResources.getDataPlumbing();
        plumbing.publish('ws:broadcast:runtimeCompileLogs', payload || {});
    } catch (error) {
        console.error('Failed to broadcast runtime compile logs:', error.message);
    }
}

async function broadcastWorkspaceCssUpdated(result) {
    if (!result || result.status !== 'compiled') {
        return;
    }
    try {
        const plumbing = globalResources.getDataPlumbing();
        plumbing.publish('ws:broadcast:workspaceCssUpdated', {
            webPath: result.webPath || workspaceCssService.WEB_PATH,
            hash: result.sourceHash || null,
            sourceHash: result.sourceHash || null,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Failed to broadcast workspace CSS update:', error.message);
    }
}

function getRuntimeAutoRecompileConfig() {
    const config = globalResources.getConfig() || {};
    return config.runtimeAssets && config.runtimeAssets.autoRecompile === true;
}

runtimeAssetService.init({
    projectRoot: __dirname,
    getAutoRecompile: getRuntimeAutoRecompileConfig,
    refreshCache: async () => {
        await initializeCacheData(true);
    },
    broadcastErrors: broadcastRuntimeCompileErrors,
    broadcastProgress: broadcastRuntimeCompileProgress,
    broadcastComplete: broadcastRuntimeCompileComplete,
    broadcastManifest: async (options = {}) => {
        const silent = options.silent === true;
        const updateMessage = options.message || 'Runtime assets recompiled';
        const files = buildServiceWorkerCacheManifest();
        const plumbing = globalResources.getDataPlumbing();
        plumbing.publish('ws:broadcast:serviceWorkerCacheUpdate', {
            files,
            silent,
            message: updateMessage,
            runtimeAssetsRecompiled: options.runtimeAssetsRecompiled === true,
            timestamp: Date.now()
        });
    }
});

runtimeAssetService.initCompileLogStore(globalResources.getPath('logs'));
runtimeAssetService.setCompileLogBroadcastCallback(broadcastRuntimeCompileLogs);

workspaceCssService.init({
    projectRoot: __dirname,
    getWorkspacesConfig: () => globalResources.getWorkspacesConfig(),
    compileCssSource: (source, rel, hash, opts) => runtimeAssetService.compileCss(source, rel, hash, opts),
    hashSource: (source) => runtimeAssetService.hashSource(source),
    buildHeader: (rel, hash) => runtimeAssetService.buildHeader(rel, hash),
    atomicWrite: (filePath, content) => runtimeAssetService.atomicWrite(filePath, content),
    onCompiled: async (result, options) => {
        if (result.status !== 'compiled') {
            return;
        }
        if (options && options.broadcast === false) {
            return;
        }
        await broadcastWorkspaceCssUpdated(result);
    }
});

// Update server readiness stage (modules/serverStartupStatus.js)
function updateServerStage(stage, isReady = false, options = {}) {
    serverStartupStatus.updateStage(stage, { isReady, ...options });
}

// Server readiness middleware - blocks access to endpoints when server is not ready
function serverReadinessMiddleware(req, res, next) {
    const status = serverStartupStatus.getPublicStatus();
    if (!status.isReady) {
        return res.status(503).json({
            success: false,
            error: 'Server is initializing',
            stage: status.stage,
            subStage: status.subStage,
            stageMessage: status.stageMessage,
            progressPercent: status.progressPercent,
            uptime: status.uptime,
            retryAfter: 30
        });
    }

    next();
}

function getQueueMiddleware(req, res, next) {
    return globalResources.getQueue().queueMiddleware(req, res, next);
}

const BALANCE_REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
const ACCOUNT_DATA_REFRESH_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
const CACHE_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Common scraping patterns and suspicious URLs
const SCRAPING_PATTERNS = [
    // Admin and authentication paths
    /^\/admin/i, /^\/administrator/i, /^\/wp-admin/i, /^\/wp-login/i,
    /^\/login/i, /^\/signin/i, /^\/sign-in/i, /^\/auth/i, /^\/authentication/i,
    /^\/register/i, /^\/signup/i, /^\/sign-up/i, /^\/password/i, /^\/reset/i,
    /^\/forgot/i, /^\/logout/i, /^\/session/i, /^\/token/i, /^\/oauth/i,
    
    // API and data endpoints
    /^\/api/i, /^\/api\/v[0-9]+/i, /^\/graphql/i, /^\/rest/i, /^\/soap/i,
    /^\/json/i, /^\/xml/i, /^\/csv/i, /^\/excel/i, /^\/pdf/i, /^\/doc/i,
    /^\/docx/i, /^\/ppt/i, /^\/pptx/i, /^\/xls/i, /^\/xlsx/i,
    
    // Archive and download paths
    /^\/download/i, /^\/export/i, /^\/backup/i, /^\/archive/i,
    /^\/zip/i, /^\/rar/i, /^\/7z/i, /^\/tar/i, /^\/gz/i, /^\/bz2/i,
    
    // System and configuration files
    /^\/config/i, /^\/database/i, /^\/phpinfo/i, /^\/server-status/i,
    /^\/server-info/i, /^\/cgi-bin/i, /^\/xmlrpc/i, /^\/robots\.txt/i,
    /^\/sitemap/i, /^\/feed/i, /^\/rss/i, /^\/atom/i,
    
    // Development and testing paths
    /^\/test/i, /^\/debug/i, /^\/dev/i, /^\/development/i, /^\/staging/i,
    /^\/tmp/i, /^\/temp/i, /^\/cache/i, /^\/logs/i, /^\/log/i,
    
    // Common CMS paths
    /^\/drupal/i, /^\/joomla/i, /^\/magento/i, /^\/shop/i, /^\/cart/i,
    /^\/checkout/i, /^\/order/i, /^\/account/i, /^\/profile/i, /^\/settings/i,
    
    // File extensions commonly targeted
    /\.(php|asp|aspx|jsp|cgi|pl|py|rb|sh|bash|zsh|fish|csh|tcsh|ksh|dash|ash)$/i,
    /\.(log|txt|md|html|htm|ini|conf|config|sql|db|bak|backup|old|orig)$/i,
    
    // System directories
    /^\/bin/i, /^\/sbin/i, /^\/usr/i, /^\/var/i, /^\/etc/i, /^\/lib/i,
    /^\/lib64/i, /^\/opt/i, /^\/srv/i, /^\/home/i, /^\/root/i, /^\/mnt/i,
    /^\/media/i, /^\/dev/i, /^\/proc/i, /^\/sys/i, /^\/run/i, /^\/boot/i,
    /^\/lost\+found/i, /^\/vmlinuz/i, /^\/initrd/i, /^\/grub/i, /^\/efi/i,
    /^\/bios/i, /^\/firmware/i, /^\/modules/i, /^\/kernel/i, /^\/initramfs/i,
    
    // Private and hidden paths
    /^\/private/i, /^\/hidden/i, /^\/secret/i, /^\/internal/i, /^\/secure/i,
    /^\/protected/i, /^\/restricted/i, /^\/admin-panel/i, /^\/control-panel/i,
    /^\/dashboard/i, /^\/panel/i, /^\/console/i, /^\/terminal/i, /^\/shell/i
];

// Security configuration
const SECURITY_CONFIG = {
    // Rate limiting
    RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    RATE_LIMIT_MAX_REQUESTS: 100, // 100 requests per window
    RATE_LIMIT_SKIP_SUCCESSFUL: true,
    
    // Slow down configuration
    SLOW_DOWN_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    SLOW_DOWN_DELAY_AFTER: 10, // Start slowing down after 50 requests
    SLOW_DOWN_DELAY_MS: 500, // Add 500ms delay per request
    
    // IP blocking
    INVALID_URL_THRESHOLD: 5, // Block after 5 invalid URL attempts
    SCRAPING_ATTEMPT_THRESHOLD: 2, // Block after 3 scraping attempts
    BLOCK_DURATION_MS: 24 * 60 * 60 * 1000, // 24 hours
    
    // Cleanup intervals
    CLEANUP_INTERVAL_MS: 60 * 60 * 1000, // 1 hour
    MAX_BLOCKED_IPS: 10000, // Maximum number of blocked IPs to store
    MAX_SUSPICIOUS_IPS: 5000, // Maximum number of suspicious IPs to track
    MAX_KNOWN_BAD_PATHS: 50000, // Maximum probe URLs to remember across restarts
    BLOCKED_LOG_QUIET_MS: 10000 // Silence before emitting flood summary
};

// Per-IP flood suppression for blocked-request logging
const blockedRequestLogFlood = new Map(); // ip -> { suppressed, lastUrl, timer }

function scheduleBlockedLogFloodFlush(ip) {
    const state = blockedRequestLogFlood.get(ip);
    if (!state) return;

    if (state.timer) {
        clearTimeout(state.timer);
    }

    state.timer = setTimeout(() => {
        flushBlockedLogFlood(ip);
    }, SECURITY_CONFIG.BLOCKED_LOG_QUIET_MS);
}

function flushBlockedLogFlood(ip) {
    const state = blockedRequestLogFlood.get(ip);
    if (!state) return;

    if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
    }

    if (state.suppressed > 0) {
        const lastPath = state.lastUrl ? ` (last: ${state.lastUrl})` : '';
        console.log(`🚫 ${ip}: ${state.suppressed} log(s) suppressed due to flood${lastPath}`);
    }

    blockedRequestLogFlood.delete(ip);
}

function flushAllBlockedLogFloods() {
    for (const ip of blockedRequestLogFlood.keys()) {
        flushBlockedLogFlood(ip);
    }
}

function logBlockedRequest(ip, url, options = {}) {
    const { instantBlock = false, knownPath = null } = options;
    let state = blockedRequestLogFlood.get(ip);

    if (!state) {
        state = { suppressed: 0, lastUrl: url, timer: null };
        blockedRequestLogFlood.set(ip, state);

        if (instantBlock && knownPath) {
            console.log(`⚡ Instant block ${ip} — known bad path: ${knownPath}`);
        }
        console.log(`🚫 Blocked request from ${ip} to ${url}`);
        scheduleBlockedLogFloodFlush(ip);
        return;
    }

    state.suppressed++;
    state.lastUrl = url;
    scheduleBlockedLogFloodFlush(ip);
}

// Get real IP address from request
function getRealIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           req.ip ||
           'unknown';
}

// Check if IP address is in a private range
function isPrivateIP(ip) {
    if (!ip || ip === 'unknown') return false;
    
    // IPv4 private ranges
    // 10.0.0.0/8
    if (ip.startsWith('10.')) return true;
    
    // 172.16.0.0/12 (172.16.0.0 to 172.31.255.255)
    if (ip.startsWith('172.')) {
        const parts = ip.split('.');
        if (parts.length >= 2) {
            const secondOctet = parseInt(parts[1], 10);
            if (secondOctet >= 16 && secondOctet <= 31) {
                return true;
            }
        }
    }
    
    // 192.168.0.0/16
    if (ip.startsWith('192.168.')) return true;
    
    // 127.0.0.0/8 (loopback)
    if (ip.startsWith('127.')) return true;
    
    // IPv6 private ranges
    // ::1 (loopback)
    if (ip === '::1') return true;
    
    // fc00::/7 (unique local address)
    if (ip.startsWith('fc00:') || ip.startsWith('fd00:')) return true;
    
    // fe80::/10 (link-local)
    if (ip.startsWith('fe80:') || ip.startsWith('fe90:') || 
        ip.startsWith('fea0:') || ip.startsWith('feb0:')) return true;
    
    // IPv4-mapped IPv6 addresses (::ffff:10.0.0.1 format)
    if (ip.startsWith('::ffff:')) {
        const ipv4Part = ip.substring(7);
        return isPrivateIP(ipv4Part);
    }
    
    return false;
}

// Normalize request path for bad-path tracking (lowercase, decoded, no query)
function normalizeBadPath(url) {
    if (!url) return '';
    const pathOnly = url.split('?')[0];
    try {
        return decodeURIComponent(pathOnly).toLowerCase();
    } catch {
        return pathOnly.toLowerCase();
    }
}

// Paths that are almost always scanner probes, not user typos
function isSuspiciousProbePath(url) {
    const path = normalizeBadPath(url);
    if (!path || path === '/') return false;
    return (
        /^\/\./.test(path) ||
        /\.env/i.test(path) ||
        /\.git/i.test(path) ||
        /phpinfo/i.test(path) ||
        isScrapingPattern(path)
    );
}

function recordBadPath(url) {
    const normalized = normalizeBadPath(url);
    if (normalized) {
        globalResources.recordKnownBadPath(normalized);
    }
}

function denyBlockedRequest(res) {
    return res.status(403).json({
        success: false,
        error: 'Access denied',
        code: 'IP_BLOCKED'
    });
}

// Block an IP address
function blockIP(ip, reason, attempts = 0) {
    // Skip blocking for private IP addresses
    if (isPrivateIP(ip)) {
        console.log(`🔓 Skipping block for private IP: ${ip} - Reason: ${reason}`);
        return;
    }

    // Persist probe URLs from this IP before clearing tracking data
    const suspicious = globalResources.getSuspiciousIPs().get(ip);
    if (suspicious?.patterns) {
        for (const entry of suspicious.patterns) {
            recordBadPath(entry.url);
        }
    }
    
    globalResources.blockIP(ip, reason, attempts);
    console.log(`🚫 BLOCKED IP: ${ip} - Reason: ${reason} (Attempts: ${attempts})`);
}

// Check if URL matches scraping patterns
function isScrapingPattern(url) {
    return SCRAPING_PATTERNS.some(pattern => pattern.test(url));
}

// Track suspicious activity
function trackSuspiciousActivity(ip, url, userAgent) {
    // Skip tracking for private IP addresses
    if (isPrivateIP(ip)) {
        return false;
    }
    
    const now = Date.now();
    const suspiciousIPs = globalResources.getSuspiciousIPs();
    const suspicious = suspiciousIPs.get(ip) || { attempts: 0, lastSeen: now, patterns: [] };
    
    suspicious.attempts++;
    suspicious.lastSeen = now;
    suspicious.patterns.push({
        url: url,
        userAgent: userAgent,
        timestamp: now
    });
    
    recordBadPath(url);
    
    // Keep only last 10 patterns
    if (suspicious.patterns.length > 10) {
        suspicious.patterns = suspicious.patterns.slice(-10);
    }
    
    suspiciousIPs.set(ip, suspicious);
    
    // Check if we should block this IP
    if (suspicious.attempts >= SECURITY_CONFIG.SCRAPING_ATTEMPT_THRESHOLD) {
        blockIP(ip, `Scraping attempts (${suspicious.attempts})`, suspicious.attempts);
        return true;
    }
    
    return false;
}

// Track invalid URL attempts
function trackInvalidURL(ip, url) {
    // Skip tracking for private IP addresses
    if (isPrivateIP(ip)) {
        return false;
    }
    
    const now = Date.now();
    const invalidURLAttempts = globalResources.getInvalidURLAttempts();
    const attempts = invalidURLAttempts.get(ip) || { count: 0, lastAttempt: now, paths: [] };
    
    attempts.count++;
    attempts.lastAttempt = now;
    if (url && !attempts.paths.includes(url)) {
        attempts.paths.push(url);
        if (attempts.paths.length > 20) {
            attempts.paths = attempts.paths.slice(-20);
        }
    }
    
    invalidURLAttempts.set(ip, attempts);

    if (isSuspiciousProbePath(url) || attempts.count >= 2) {
        recordBadPath(url);
    }
    
    // Check if we should block this IP
    if (attempts.count >= SECURITY_CONFIG.INVALID_URL_THRESHOLD) {
        if (attempts.paths) {
            for (const pathEntry of attempts.paths) {
                recordBadPath(pathEntry);
            }
        }
        blockIP(ip, `Invalid URL attempts (${attempts.count})`, attempts.count);
        return true;
    }
    
    return false;
}

// Cleanup old entries (now uses globalResources)
function cleanupSecurityData() {
    globalResources.cleanupSecurityData(SECURITY_CONFIG.BLOCK_DURATION_MS, SECURITY_CONFIG);
}

// Check if a resource requires authentication
function isProtectedResource(url) {
    if (!url) return false;

    // Protect image resources
    if (url.startsWith('/images/') ||
        url.startsWith('/previews/') ||
        url.startsWith('/cache/')) {
        return true;
    }
    
    // Protect tokenizer and other authenticated assets
    if (url.startsWith('/protected/')) {
        return true;
    }

    if (url.startsWith('/private/wiki/')) {
        return true;
    }

    // Don't require auth for basic HTML pages and static assets
    return false;
}

// Security middleware
function securityMiddleware(req, res, next) {
    // Skip security checks for authenticated users (session or application credentials)
    if ((req.session && req.session.authenticated) ||
        req.authMethod === 'application_key' ||
        req.authMethod === 'temp_token') {
        return next();
    }

    const ip = getRealIP(req);
    const url = req.path;
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    // Skip IP blocking checks for private IP addresses
    if (!isPrivateIP(ip)) {
        const normalizedPath = normalizeBadPath(url);

        // Known probe URL — instant block for new scrapers
        if (globalResources.isKnownBadPath(normalizedPath)) {
            const wasBlocked = globalResources.isIPBlocked(ip, SECURITY_CONFIG.BLOCK_DURATION_MS);
            if (!wasBlocked) {
                blockIP(ip, `Known bad path (${normalizedPath})`, 1);
            } else {
                recordBadPath(url);
            }
            logBlockedRequest(ip, url, {
                instantBlock: !wasBlocked,
                knownPath: !wasBlocked ? normalizedPath : null
            });
            return denyBlockedRequest(res);
        }

        // Check if IP is blocked — keep learning probe URLs from active bots
        if (globalResources.isIPBlocked(ip, SECURITY_CONFIG.BLOCK_DURATION_MS)) {
            if (isSuspiciousProbePath(url)) {
                recordBadPath(url);
            }
            logBlockedRequest(ip, url);
            return denyBlockedRequest(res);
        }
    }

    // Enforce authentication for protected resources
    const requiresAuth = isProtectedResource(url);
    if (requiresAuth) {
        // Check if user is authenticated via session
        const isAuthenticated = req.session && req.session.authenticated;

        if (!isAuthenticated) {
            console.warn(`🚫 Unauthenticated access attempt to protected resource: ${ip} -> ${url}`);
            return res.status(403).json({
                success: false,
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        console.log(`✅ Authenticated access to protected resource: ${ip} -> ${url}`);
    }

    // Check for scraping patterns (skip for private IPs)
    if (!isPrivateIP(ip) && isScrapingPattern(url)) {
        console.log(`🕷️ Scraping pattern detected: ${ip} -> ${url}`);

        if (trackSuspiciousActivity(ip, url, userAgent)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                code: 'SCRAPING_DETECTED'
            });
        }
    }

    next();
}

// 404 handler for invalid URL tracking
function invalidURLHandler(req, res, next) {
    // Skip invalid URL tracking for authenticated users
    if (req.session && req.session.authenticated) {
        return next();
    }

    const ip = getRealIP(req);

    // Skip invalid URL tracking for private IPs
    if (!isPrivateIP(ip) && trackInvalidURL(ip, req.path)) {
        console.log(`🚫 Blocked IP ${ip} for excessive invalid URL attempts`);
        return res.status(403).json({
            success: false,
            error: 'Access denied',
            code: 'INVALID_URL_ABUSE'
        });
    }

    next();
}

// Initialize account data on startup
async function initializeAccountData(force = false) {
    try {
        const health = await globalResources.initializeAccountData(force);
        const accountBalance = globalResources.getAccountBalance();
        if (health.userDataValid) {
            globalResources.logger.bootSubStep(`Account loaded: ${accountBalance.totalCredits} total credits`);
        } else {
            const detail = health.userDataError || health.accountStanding || 'unknown';
            globalResources.logger.warn(`Account data not available: ${detail}`);
        }
    } catch (error) {
        globalResources.logger.error('Error initializing account data:', error.message);
    }
}

// Initialize cache data on startup
async function initializeCacheData(force = false) {
    try {
        const publicDir = path.join(__dirname, 'public');
        await globalResources.initializeCacheData(
            async () => await generateCacheData(publicDir),
            force
        );
        const cacheData = globalResources.getGlobalCacheData();
        globalResources.logger.bootSubStep(`Cached ${cacheData.length} assets`);
    } catch (error) {
        globalResources.logger.error('Error initializing cache data:', error.message);
    }
}

// Build service worker cache manifest (same payload as OPTIONS /)
function buildServiceWorkerCacheManifest() {
    const routeFiles = [
        { url: '/', name: '/index.html' },
        { url: '/app', name: '/app.html' },
        { url: '/launch', name: '/launch.html' }
    ];

    const routeEntries = routeFiles.map(route => {
        const file = globalResources.getGlobalCacheData().find(f => f.path === route.name) || {};
        return {
            url: route.url,
            name: route.name,
            hash: file.hash || file.md5 || 'no-hash',
            size: file.size || 0,
            modified: file.modified || Date.now(),
            type: 'route'
        };
    });

    const protectedRuntimeFiles = [
        {
            url: '/protected/fflate.js',
            filePath: path.resolve(__dirname, 'node_modules', 'fflate', 'umd', 'index.js')
        }
    ].filter(file => fs.existsSync(file.filePath))
        .map(file => {
            const stats = fs.statSync(file.filePath);
            return {
                url: file.url,
                hash: runtimeAssetService.hashServedFile(file.filePath),
                size: stats.size,
                modified: stats.mtime.getTime()
            };
        });

    const routeNames = routeFiles.map(f => f.name);
    const splashOrScreenshotPattern = /^\/static_images\/(apple-splash|android-screenshot)-.*\.(png|jpg|jpeg|webp)$/i;
    const unrelatedFilePattern = /\.(backup\..*|md|markdown|txt|log|DS_Store|swp|tmp|bak)$/i;

    const staticFiles = globalResources.getGlobalCacheData()
        .filter(file =>
            !routeNames.includes(file.path) &&
            !splashOrScreenshotPattern.test(file.path) &&
            !unrelatedFilePattern.test(file.path)
        )
        .map(file => ({
            url: file.path,
            hash: file.hash || file.md5,
            size: file.size,
            modified: file.modified
        }));

    return [...routeEntries, ...protectedRuntimeFiles, ...staticFiles];
}

// Recompile runtime assets, refresh server hash cache, and broadcast manifest to clients
async function refreshAndBroadcastServiceWorkerCache(options = {}) {
    const silent = options.silent === true;
    const updateMessage = options.message || 'Application updates are available';

    const compileResult = await runtimeAssetService.recompileAndRefresh({
        force: options.force === true,
        silent,
        showConsoleProgress: options.showConsoleProgress === true,
        message: updateMessage
    });

    const files = buildServiceWorkerCacheManifest();
    const wsServer = globalResources.getWebSocketServer();
    const clientsNotified = wsServer && typeof wsServer.getConnectionCount === 'function'
        ? wsServer.getConnectionCount()
        : 0;
    const errors = Array.isArray(compileResult.errors) ? compileResult.errors : [];

    return {
        success: errors.length === 0,
        message: errors.length === 0
            ? 'Runtime assets recompiled and service worker cache refreshed'
            : 'Runtime assets recompiled with errors',
        assetsCount: files.length,
        clientsNotified,
        compiled: compileResult.compiled || 0,
        skipped: compileResult.skipped || 0,
        failedCount: errors.length,
        timestamp: Date.now()
    };
}

// Generate cache data for public directory
async function generateCacheData(directory) {
    const assets = [];
    
    try {
        const files = await scanDirectory(directory);
        
        for (const file of files) {
            try {
                const filePath = path.join(directory, file);
                const stats = fs.statSync(filePath);
                
                // Skip directories and non-asset files
                if (stats.isDirectory() || 
                    file.startsWith('.') || 
                    file.includes('node_modules') ||
                    file.includes('.git')) {
                    continue;
                }

                // Convert to web path (remove /public prefix for clean URLs)
                const relativePath = path.relative(__dirname, filePath).replace(/\\/g, '/');
                const webPath = relativePath.startsWith('public/') 
                    ? '/' + relativePath.substring(7) // Remove 'public/' prefix
                    : '/' + relativePath;

                // Masters stay on disk for compile input only — SW gets optimised sizes from runtime-assets
                if (runtimeAssetService.isAppIconWebPath
                    && runtimeAssetService.isAppIconWebPath(webPath)) {
                    continue;
                }

                // SHA-256 of bytes actually served to clients (optimised copy for managed css/scripts)
                let hashPath = filePath;
                if (runtimeAssetService.isRuntimeManagedWebPath(webPath)) {
                    const servedPath = runtimeAssetService.resolveServedAssetPath(__dirname, webPath);
                    if (servedPath && fs.existsSync(servedPath)) {
                        hashPath = servedPath;
                    }
                }
                const hashStats = fs.statSync(hashPath);
                const hash = runtimeAssetService.hashServedFile(hashPath);

                assets.push({
                    path: webPath,
                    hash,
                    size: hashStats.size,
                    modified: hashStats.mtime.getTime()
                });
            } catch (error) {
                console.warn(`⚠️ Error processing file ${file}:`, error.message);
            }
        }

        // Optimised app icon sizes from .cache/runtime-assets (omit public masters above)
        if (typeof runtimeAssetService.listOptimisedAppIconManifestEntries === 'function') {
            const iconEntries = runtimeAssetService.listOptimisedAppIconManifestEntries(__dirname);
            for (const entry of iconEntries) {
                if (!assets.some((a) => a.path === entry.path)) {
                    assets.push(entry);
                }
            }
        }
        
        // Sort by path for consistent ordering
        assets.sort((a, b) => a.path.localeCompare(b.path));

        const workspaceEntry = workspaceCssService.getManifestEntry(__dirname);
        if (workspaceEntry && !assets.some((entry) => entry.path === workspaceEntry.path)) {
            assets.push(workspaceEntry);
            assets.sort((a, b) => a.path.localeCompare(b.path));
        }

        return assets;
    } catch (error) {
        console.error('❌ Error scanning directory:', error.message);
        return [];
    }
}

// Recursively scan directory for files
async function scanDirectory(dir, relFromPublic = '') {
    const files = [];
    
    try {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
            const itemPath = path.join(dir, item);
            const itemRel = relFromPublic ? `${relFromPublic}/${item}` : item;
            // App icon masters are compile inputs only — optimised sizes come from runtime-assets
            if (runtimeAssetService.isAppIconsMasterRelPath
                && runtimeAssetService.isAppIconsMasterRelPath(itemRel)) {
                continue;
            }
            const stats = fs.statSync(itemPath);
            
            if (stats.isDirectory()) {
                // Recursively scan subdirectories
                const subFiles = await scanDirectory(itemPath, itemRel);
                files.push(...subFiles.map(subFile => path.join(item, subFile)));
            } else {
                files.push(item);
            }
        }
    } catch (error) {
        console.error(`❌ Error reading directory ${dir}:`, error.message);
    }
    
    return files;
}

// Refresh account data periodically
async function refreshBalance(force = false) {
    try {
        await globalResources.refreshBalance(force);
    } catch (error) {
        console.error('❌ Error refreshing account data:', error.message);
    }
}

const { app, server } = globalResources.initializeExpressApp();

// Security and performance middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for development
    crossOriginEmbedderPolicy: false
}));

// Rate limiting middleware
const limiter = rateLimit({
    windowMs: SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS,
    max: SECURITY_CONFIG.RATE_LIMIT_MAX_REQUESTS,
    skipSuccessfulRequests: SECURITY_CONFIG.RATE_LIMIT_SKIP_SUCCESSFUL,
    keyGenerator: (req) => getRealIP(req),
    skip: (req) => {
        // Skip rate limiting for authenticated users
        if (req.session && req.session.authenticated) {
            return true;
        }
        if (req.authMethod === 'application_key' || req.authMethod === 'temp_token') {
            return true;
        }
        
        // Skip rate limiting for OPTIONS requests to specific routes only
        if (req.method === 'OPTIONS') {
            const allowedPaths = ['/', '/app', '/status'];
            return allowedPaths.includes(req.path);
        }
        
        return false;
    },
    handler: (req, res) => {
        const ip = getRealIP(req);
        console.log(`🚫 Rate limit exceeded for IP: ${ip}`);
        res.status(429).json({
            success: false,
            error: 'Too many requests',
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: Math.round(SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS / 1000)
        });
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Slow down middleware
const speedLimiter = slowDown({
    windowMs: SECURITY_CONFIG.SLOW_DOWN_WINDOW_MS,
    delayAfter: SECURITY_CONFIG.SLOW_DOWN_DELAY_AFTER,
    delayMs: () => SECURITY_CONFIG.SLOW_DOWN_DELAY_MS, // Fixed: Use function instead of static value
    keyGenerator: (req) => getRealIP(req),
    skipSuccessfulRequests: true,
    skip: (req) => {
        // Skip speed limiting for authenticated users
        if (req.session && req.session.authenticated) {
            return true;
        }
        if (req.authMethod === 'application_key' || req.authMethod === 'temp_token') {
            return true;
        }
        
        // Skip speed limiting for OPTIONS requests to specific routes only
        if (req.method === 'OPTIONS') {
            const allowedPaths = ['/', '/app', '/status'];
            return allowedPaths.includes(req.path);
        }
        
        return false;
    }
});

// Enable gzip compression for all responses
app.use(compression({
    level: 6, // Balanced compression level
    threshold: 512, // Only compress responses larger than 512B
    filter: (req, res) => {
        // Don't compress if client doesn't support it
        if (req.headers['x-no-compression']) {
            return false;
        }
        // SSE must not be compressed (buffers until connection closes)
        const accept = req.headers.accept || '';
        if (accept.includes('text/event-stream')) {
            return false;
        }
        if (req.path && req.path.endsWith('/stream')) {
            return false;
        }
        // Binary image routes already carry length; skip gzip so Content-Length stays reliable for transfer ETA.
        if (req.path && (req.path.startsWith('/images/') || req.path.startsWith('/previews/'))) {
            return false;
        }
        // Use compression for all other requests
        return compression.filter(req, res);
    }
}));

// Body parsing middleware with optimized limits
app.use(express.json({limit: '100mb'}));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(cookieParser());

const sessionStore = globalResources.initializeSessionStore();
const sessionSecret = globalResources.getSecureConfig({ path: 'sessionSecret' });
if (!sessionSecret) {
    throw new Error('Session secret is not configured in secure.config.json');
}

// Create session middleware
const sessionMiddleware = session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore, // Use the shared session store
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
});

globalResources.loadKnownBadPaths();
app.use(sessionMiddleware);
app.use(createApplicationAuthEarlyMiddleware(globalResources));
app.use(securityMiddleware);
app.use(limiter);
app.use(speedLimiter);

const registerReplicationRoutes = require('./modules/replication/registerRoutes');
registerReplicationRoutes(app, globalResources);

// Create cache directories
const cacheDir = path.resolve(__dirname, '.cache');
const uploadCacheDir = path.join(cacheDir, 'upload');
const previewCacheDir = path.join(cacheDir, 'preview');
const vibeCacheDir = path.join(cacheDir, 'vibe');
const wallpapersDir = path.join(cacheDir, 'wallpapers');
const tempDownloadDir = path.join(cacheDir, 'tempDownload');
const imagesDir = path.resolve(__dirname, 'images');
const previewsDir = path.resolve(__dirname, '.previews');
const fflateBrowserPath = path.resolve(__dirname, 'node_modules/fflate/umd/index.js');

// Ensure cache directories exist
[uploadCacheDir, previewCacheDir, vibeCacheDir, wallpapersDir, tempDownloadDir, imagesDir, previewsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

app.get('/protected/fflate.js', (req, res) => {
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(fflateBrowserPath);
});

app.get('/protected/qwen35_tokenizer.def', async (req, res) => {
    try {
        const tokenizerPath = await getQwenTokenizerDefinition(cacheDir);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'private, max-age=604800');
        res.sendFile(tokenizerPath);
    } catch (error) {
        console.error('Qwen tokenizer asset error:', error.message);
        res.status(502).json({ error: 'Qwen tokenizer asset is unavailable' });
    }
});


async function getBalance() {
    try {
        const apiKeyManager = globalResources.getApiKeyManager();
        const novelAiApiKey = apiKeyManager.getActiveApiKey('novelai');
        if (!novelAiApiKey) {
            console.warn('⚠️ Skipping NovelAI balance fetch - no API key configured.');
            return {
                ok: false,
                fixedTrainingStepsLeft: 0,
                purchasedTrainingSteps: 0,
                totalCredits: 0,
                subscription: null,
                reason: 'missing_api_key'
            };
        }
        // Tripwire: skip the outbound call while the service is locked.
        if (apiKeyManager.isServiceLocked('novelai')) {
            return {
                ok: false,
                fixedTrainingStepsLeft: 0,
                purchasedTrainingSteps: 0,
                totalCredits: 0,
                subscription: null,
                reason: 'service_locked'
            };
        }

        // NovelAI.getSubscription: ../NekoAI-JS/src/client.ts
        const client = globalResources.getNovelAiClient();
        if (!client) throw new Error('NovelAI client is unavailable');
        let balanceData;
        try {
            balanceData = await client.getSubscription();
            apiKeyManager.recordApiSuccess('novelai');
        } catch (error) {
            apiKeyManager.recordApiFailure(
                'novelai',
                error.statusCode || 0,
                error.message || 'Subscription request failed'
            );
            throw error;
        }
        
        // Extract training steps information
        const fixedTrainingStepsLeft = balanceData?.trainingStepsLeft?.fixedTrainingStepsLeft || 0;
        const purchasedTrainingSteps = balanceData?.trainingStepsLeft?.purchasedTrainingSteps || 0;
        const totalCredits = fixedTrainingStepsLeft + purchasedTrainingSteps;
        
        return {
            ok: true,
            fixedTrainingStepsLeft,
            purchasedTrainingSteps,
            totalCredits,
            subscription: balanceData
        }
        
    } catch (error) {
        console.error('Balance check error:', error);
        return {
            ok: false,
            fixedTrainingStepsLeft: 0,
            purchasedTrainingSteps: 0,
            totalCredits: 0,
            subscription: null
        }
    }
}

async function getUserData() {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000; // 2 seconds between retries
    
    try {
        const apiKeyManager = globalResources.getApiKeyManager();
        const novelAiApiKey = apiKeyManager.getActiveApiKey('novelai');
        if (!novelAiApiKey) {
            console.warn('⚠️ Skipping NovelAI user data fetch - no API key configured.');
            return {
                ok: false,
                reason: 'missing_api_key'
            };
        }
        // Tripwire: skip the outbound call while the service is locked.
        if (apiKeyManager.isServiceLocked('novelai')) {
            return {
                ok: false,
                reason: 'service_locked'
            };
        }

        // Helper function to check if error is retryable (network errors)
        const isRetryableError = (error) => {
            if (!error || !error.code) return false;
            const retryableCodes = ['ETIMEDOUT', 'ENETUNREACH', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN'];
            return retryableCodes.includes(error.code);
        };

        // Helper function to make the API request
        // browserRequest: modules/browserHttp.js
        const makeRequest = async () => {
            const res = await browserRequest({
                hostname: 'image.novelai.net',
                port: 443,
                path: '/user/data',
                method: 'GET',
                headers: {
                    accept: '*/*',
                    'content-type': 'application/json',
                    authorization: `Bearer ${novelAiApiKey}`,
                    'x-initiated-at': new Date().toISOString(),
                    'sec-gpc': '1'
                }
            }, null, { acceptResType: 'json', json: false });

            if (res.statusCode === 200) {
                try {
                    const response = JSON.parse(res.body.toString());
                    apiKeyManager.recordApiSuccess('novelai');
                    return {
                        ok: true,
                        ...response,
                    };
                } catch (e) {
                    throw new Error('Invalid JSON response from NovelAI API');
                }
            }

            try {
                const errorResponse = JSON.parse(res.body.toString());
                console.error('❌ User data API error:', errorResponse);
                apiKeyManager.recordApiFailure('novelai', res.statusCode, errorResponse.message);
                return {
                    ok: false,
                    statusCode: res.statusCode,
                    error: errorResponse.message || 'Unknown error'
                };
            } catch (e) {
                apiKeyManager.recordApiFailure('novelai', res.statusCode, `HTTP ${res.statusCode}`);
                throw new Error(`User data API error: HTTP ${res.statusCode}`);
            }
        };

        // Retry logic
        let lastError = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const userData = await makeRequest();
                
                // If we got a response (even if ok: false), return it (don't retry API errors)
                if (userData.ok === false && userData.statusCode) {
                    // This is an API error (not a network error), don't retry
                    return {
                        ok: false,
                        statusCode: userData.statusCode,
                        error: userData.error
                    };
                }
                
                // Success case
                return {
                    ok: true,
                    ...userData
                };
            } catch (error) {
                lastError = error;
                
                // Only retry on network errors
                if (isRetryableError(error)) {
                    if (attempt < MAX_RETRIES) {
                        console.warn(`⚠️ User data API request failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}. Retrying in ${RETRY_DELAY_MS}ms...`);
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                        continue;
                    } else {
                        console.error(`❌ User data API request failed after ${MAX_RETRIES} attempts: ${error.message}`);
                    }
                } else {
                    // Non-retryable error (e.g., invalid JSON), don't retry
                    console.error('❌ User data API request error:', error.message);
                    return {
                        ok: false,
                        error: error.message
                    };
                }
            }
        }

        // All retries exhausted
        return {
            ok: false,
            error: lastError ? lastError.message : 'Unknown error'
        };
    } catch (error) {
        console.error('User data error:', error);
        return {
            ok: false,
            error: error.message
        }
    }
}

// Validate preset query parameters for pending requests
function validatePresetQueryParameters(queryParams) {
    const errors = [];

    // Validate steps
    if (queryParams.steps !== undefined) {
        const steps = parseInt(queryParams.steps);
        if (isNaN(steps) || steps <= 0) {
            errors.push('steps must be a positive integer');
        }
    }

    // Validate guidance
    if (queryParams.guidance !== undefined) {
        const guidance = parseFloat(queryParams.guidance);
        if (isNaN(guidance) || guidance <= 0) {
            errors.push('guidance must be a positive number');
        }
    }

    // Validate rescale
    if (queryParams.rescale !== undefined) {
        const rescale = parseFloat(queryParams.rescale);
        if (isNaN(rescale)) {
            errors.push('rescale must be a number');
        }
    }

    // Validate resolution
    if (queryParams.resolution !== undefined) {
        const upperResolution = queryParams.resolution.toUpperCase();
        if (!globalResources.getNekoAiService('Resolution')[upperResolution]) {
            errors.push(`resolution "${queryParams.resolution}" must be a valid named resolution preset`);
        }
    }

    // Validate seed
    if (queryParams.seed !== undefined) {
        const seed = parseInt(queryParams.seed);
        if (isNaN(seed)) {
            errors.push('seed must be an integer');
        }
    }

    // Validate variety
    if (queryParams.variety !== undefined) {
        if (queryParams.variety !== 'true' && queryParams.variety !== 'false') {
            errors.push('variety must be "true" or "false"');
        }
    }

    // Validate dynamic generation parameters
    if (queryParams.dyna_tod !== undefined) {
        // dyna_tod can be boolean or string, no specific validation needed
    }

    if (queryParams.dyna_weather !== undefined) {
        // dyna_weather can be boolean or string, no specific validation needed
    }

    if (queryParams.dyna_season !== undefined) {
        const season = queryParams.dyna_season;
        if (season !== 'true' && season !== 'false' && season !== 'nearest' && isNaN(parseInt(season))) {
            errors.push('dyna_season must be boolean ("true"/"false"), "nearest", or numeric index');
        }
    }

    if (queryParams.dyna_action !== undefined) {
        if (queryParams.dyna_action !== 'true' && queryParams.dyna_action !== 'false') {
            errors.push('dyna_action must be "true" or "false"');
        }
    }

    if (queryParams.dyna_location !== undefined) {
        if (typeof queryParams.dyna_location !== 'string' || queryParams.dyna_location.trim() === '') {
            errors.push('dyna_location must be a non-empty string');
        }
    }

    if (queryParams.dyna_creative !== undefined) {
        if (queryParams.dyna_creative !== 'true' && queryParams.dyna_creative !== 'false') {
            errors.push('dyna_creative must be "true" or "false"');
        }
    }

    if (queryParams.dyna_no_cache !== undefined) {
        if (queryParams.dyna_no_cache !== 'true' && queryParams.dyna_no_cache !== 'false') {
            errors.push('dyna_no_cache must be "true" or "false"');
        }
    }

    // Validate other parameters
    if (queryParams.optimize !== undefined) {
        if (queryParams.optimize !== 'true' && queryParams.optimize !== 'false') {
            errors.push('optimize must be "true" or "false"');
        }
    }

    if (queryParams.download !== undefined) {
        if (queryParams.download !== 'true' && queryParams.download !== 'false') {
            errors.push('download must be "true" or "false"');
        }
    }

    if (queryParams.workspace !== undefined) {
        if (typeof queryParams.workspace !== 'string' || queryParams.workspace.trim() === '') {
            errors.push('workspace must be a non-empty string');
        }
    }

    // Validate name (for named requests)
    if (queryParams.name !== undefined) {
        if (typeof queryParams.name !== 'string' || queryParams.name.trim() === '' || queryParams.name.includes(':')) {
            errors.push('name must be a non-empty string without colons');
        }
    }

    return errors;
}

app.get('/internal/*', (req, res) => {
    try {
        res.setHeader('Cache-Control', 'blocked, no-cache, no-store, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Content-Type', 'application/json');
        res.json({
            success: true,
            message: 'File is missing from client cache',
            path: req.path,
            timestamp: Date.now()
        });
        
    } catch (error) {
        console.error('❌ Error handling internal URL:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});
app.use('/temp', express.static(path.join(cacheDir, 'tempDownload'), {
    maxAge: '10s', // Cache static assets for 10 seconds
    etag: true, // Enable ETags for cache validation
    lastModified: true, // Enable Last-Modified headers
    setHeaders: (res, path) => {
        res.setHeader('Cache-Control', 'realtime, no-cache, no-store, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));
app.use('/previews/:preview', authMiddleware, (req, res) => {
    const previewFile = decodeURIComponent(req.params.preview);
    const previewPath = path.join(previewsDir, previewFile);
    if (!fs.existsSync(previewPath)) {
        return res.status(404).json({ success: false, error: 'Preview not found' });
    }
    const previewStat = fs.statSync(previewPath);
    res.setHeader('Cache-Control', 'private, max-age=259200');
    res.setHeader('Content-Length', previewStat.size);
    res.sendFile(previewFile, { root: previewsDir });
});
app.get('/naxCache/:gallerySlug/:filename', authMiddleware, (req, res) => {
    handleNaxImageRequest(globalResources, req, res, cacheDir);
});
// Agora / Explore: lazy-fetch missing thumbs/blobs into .cache/explore_files before static serve
app.use('/cache/explore_files', authMiddleware, async (req, res, next) => {
    try {
        const base = path.basename(String(req.path || '').replace(/^\/+/, ''));
        if (!base || base.includes('..')) return next();
        const abs = path.join(cacheDir, 'explore_files', base);
        if (fs.existsSync(abs)) return next();

        const thumbMatch = /^thumb_([0-9a-fA-F-]{36})(?:\.[a-zA-Z0-9]+)?$/.exec(base);
        const blobMatch = /^blob_([0-9a-fA-F-]{36})(?:\.[a-zA-Z0-9]+)?$/.exec(base);
        const match = thumbMatch || blobMatch;
        if (!match) return next();

        const explore = globalResources.getNovelaiExploreGallery?.();
        if (!explore || typeof explore.ensureExploreImage !== 'function') return next();
        const apiKeyManager = globalResources.getApiKeyManager?.();
        const kind = blobMatch ? 'blob' : 'thumbnail';
        const ensured = await explore.ensureExploreImage(match[1], kind, {
            apiKey: apiKeyManager?.getActiveApiKey?.('novelai'),
            apiKeyManager
        });
        if (ensured?.filePath && path.basename(ensured.filePath) !== base) {
            // Content-Type may have added an extension; redirect to actual cached name
            return res.redirect(302, `/cache/explore_files/${path.basename(ensured.filePath)}`);
        }
        return next();
    } catch (err) {
        console.warn('[explore_files] ensure failed:', err.message);
        return next();
    }
});
app.use('/cache', authMiddleware, (req, res, next) => {
    // Wallpapers reuse a stable per-workspace path (/cache/wallpapers/<id>.png) but the
    // content is overwritten on every upload, so they must revalidate (ETag/Last-Modified)
    // instead of being served stale from the browser cache. Other /cache entries are
    // content-addressed by hash (immutable) and safe to cache long-term.
    if (req.path.startsWith('/wallpapers/')) {
        res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
    } else {
        res.setHeader('Cache-Control', 'public, max-age=259200');
    }
    next();
}, express.static(cacheDir));
app.use('/private/wiki', authMiddleware, express.static(path.join(cacheDir, 'wiki'), {
    maxAge: '7d',
    etag: true,
    lastModified: true
}));
// Logger // NOTE: Everything above this is not logged!
app.use((req, res, next) => {
    const skippedPaths = [
        '/ping',
        '/images',
        '/spellcheck',
        '/vibe',
        '/vibe/images',
    ];
    if (skippedPaths.some(path => req.path.startsWith(path))) {
        return next();
    }
    const logViewerPrefix = `/${globalResources.getLogViewerPathUuid()}`;
    if (req.path.startsWith(logViewerPrefix)) {
        return next();
    }
    const vfsPrefix = `/${globalResources.getVfsPathUuid()}`;
    if (req.path.startsWith(vfsPrefix)) {
        return next();
    }
    
    const startTime = Date.now();
    const timestamp = new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    const realIP = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || req.connection.remoteAddress;
    const queryParams = { ...req.query };
    delete queryParams.auth;
    delete queryParams.loginKey;
    
    // Add response time header
    res.setHeader('X-Response-Time', '0ms');
    
    console.log(`\n📋 [${timestamp}] ${realIP} => ${req.method} ${req.path}`);
    if (Object.keys(queryParams).length > 0) {
        console.log(`   Query: ${JSON.stringify(queryParams)}`);
    }
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(`   Body: ${JSON.stringify(req.body)}`);
    }
    
    let completionLogged = false;
    const originalEnd = res.end;
    res.end = function(...args) {
        if (!completionLogged && !res.headersSent) {
            try {
                const duration = Date.now() - startTime;
                const responseTime = `${duration}ms`;
                res.setHeader('X-Response-Time', responseTime);
                console.log(`⏱️ Completed in ${(duration / 1000).toFixed(2)}s`);
                completionLogged = true;
            } catch (error) {
                // Headers already sent, just log completion
                const duration = Date.now() - startTime;
                console.log(`⏱️ Completed in ${(duration / 1000).toFixed(2)}s (headers already sent)`);
                completionLogged = true;
            }
        }
        originalEnd.apply(this, args);
    };
    
    const originalSend = res.send;
    res.send = function(...args) {
        if (!completionLogged && !res.headersSent) {
            try {
                const duration = Date.now() - startTime;
                const responseTime = `${duration}ms`;
                res.setHeader('X-Response-Time', responseTime);
                console.log(`⏱️ Completed in ${(duration / 1000).toFixed(2)}s`);
                completionLogged = true;
            } catch (error) {
                // Headers already sent, just log completion
                const duration = Date.now() - startTime;
                console.log(`⏱️ Completed in ${(duration / 1000).toFixed(2)}s (headers already sent)`);
                completionLogged = true;
            }
        }
        originalSend.apply(this, args);
    };
    
    next();
});
app.use('/images/:filename', authMiddleware, async (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(imagesDir, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'Image not found' });
    }
    
    const fileStat = fs.statSync(filePath);

    // Set appropriate headers
    const ext = path.extname(filename).toLowerCase();
    res.setHeader('Content-Type', (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=259200');
    res.setHeader('Content-Length', fileStat.size);
    res.setHeader('Last-Modified', new Date(fileStat.mtime).toUTCString());
    res.setHeader('ETag', `"${fileStat.mtime.getTime()}"`);
    res.setHeader('Expires', '0');
    
    // Handle download request
    if (req.query.download === 'true') {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    // Clipboard / origin Comment: restore tEXt Comment from stealth (pre-forge NAI Comment)
    if ((req.query.clipboardOrigin === 'true' || req.query.clipboard === 'true')
        && path.extname(filename).toLowerCase() === '.png') {
        try {
            const imageBuffer = fs.readFileSync(filePath);
            const pngMeta = globalResources.getPngMetadata();
            // restoreOriginCommentFromStealth: modules/pngMetadata.js
            const restored = await pngMeta.restoreOriginCommentFromStealth(imageBuffer);
            const outBuffer = restored.restored ? restored.buffer : imageBuffer;
            // verifyNovelAiSignature: modules/pngMetadata.js
            const naiSig = await pngMeta.verifyNovelAiSignature(outBuffer);
            res.setHeader('X-NovelAI-Signature-Valid', naiSig.ok ? 'true' : 'false');
            res.setHeader('Access-Control-Expose-Headers', 'X-NovelAI-Signature-Valid');
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Content-Length', outBuffer.length);
            res.setHeader('Cache-Control', 'no-store');
            if (restored.restored) {
                console.log(`[/images clipboardOrigin] Restored origin Comment for ${filename} (${outBuffer.length} bytes, naiSig=${naiSig.ok})`);
            } else {
                console.log(`[/images clipboardOrigin] No stealth origin for ${filename}; sending original (naiSig=${naiSig.ok})`);
            }
            return res.send(outBuffer);
        } catch (error) {
            console.error('Error processing clipboardOrigin:', error);
            // Fall through to normal file sending
        }
    }

    // Download: attest NovelAI (+ Forge when forge_data is present) via response headers
    if (req.query.download === 'true' && path.extname(filename).toLowerCase() === '.png') {
        try {
            const imageBuffer = fs.readFileSync(filePath);
            const pngMeta = globalResources.getPngMetadata();
            // verifyNovelAiSignature: modules/pngMetadata.js
            const naiSig = await pngMeta.verifyNovelAiSignature(imageBuffer);
            res.setHeader('X-NovelAI-Signature-Valid', naiSig.ok ? 'true' : 'false');
            const expose = ['X-NovelAI-Signature-Valid'];

            let hasForgeData = false;
            try {
                const comment = JSON.parse(pngMeta.readMetadata(imageBuffer).tEXt?.Comment || '{}');
                hasForgeData = !!(comment && comment.forge_data);
            } catch (_) { /* ignore */ }

            let forgeOk = null;
            if (hasForgeData) {
                // verifyForgeSignature: modules/pngMetadata.js
                const forgeSig = await pngMeta.verifyForgeSignature(imageBuffer);
                forgeOk = forgeSig.ok;
                res.setHeader('X-Forge-Signature-Valid', forgeOk ? 'true' : 'false');
                expose.push('X-Forge-Signature-Valid');
            }

            res.setHeader('Access-Control-Expose-Headers', expose.join(', '));
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Content-Length', imageBuffer.length);
            console.log(`[/images download] ${filename} naiSig=${naiSig.ok}` +
                (forgeOk !== null ? ` forgeSig=${forgeOk}` : ''));
            return res.send(imageBuffer);
        } catch (error) {
            console.error('Error processing download signature headers:', error);
            // Fall through to normal file sending
        }
    }

    // Handle stripContext query parameter for PNG files
    if (req.query.stripContext === 'true' && path.extname(filename).toLowerCase() === '.png') {
        try {
            const imageBuffer = fs.readFileSync(filePath);
            const metadata = globalResources.getPngMetadata().readMetadata(imageBuffer);
            
            if (metadata.tEXt && metadata.tEXt.Comment) {
                try {
                    const parsedMetadata = JSON.parse(metadata.tEXt.Comment);
                    
                    // Remove dynamic_generation context data
                    if (parsedMetadata.dynamic_generation && parsedMetadata.dynamic_generation.compiled_prompt) {
                        delete parsedMetadata.dynamic_generation.compiled_prompt.context;
                    }
                    
                    const cleanedBuffer = globalResources.getPngMetadata().stripPngTextChunks(imageBuffer);
                    const finalBuffer = globalResources.getPngMetadata().insertTextChunk(cleanedBuffer, 'Comment', JSON.stringify(parsedMetadata));

                    console.log(`[/images stripContext] Processed ${filename}, stripped context, size: ${finalBuffer.length} bytes`);
                    
                    // Ensure Content-Type is set for the modified buffer
                    res.setHeader('Content-Type', 'image/png');
                    res.setHeader('Content-Length', finalBuffer.length);
                    return res.send(finalBuffer);
                } catch (parseError) {
                    // If parsing fails, fall through to normal file sending
                    console.error('Failed to parse metadata for context stripping:', parseError);
                }
            } else {
                console.log(`[/images stripContext] ${filename} has no Comment metadata to process`);
            }
        } catch (error) {
            console.error('Error processing stripContext:', error);
            // Fall through to normal file sending
        }
    }
    
    // Send the file
    res.sendFile(filePath);
});
// Slim PNG route - strips PNG metadata/blueprint data
app.use('/image/slim/:filename', authMiddleware, async (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(imagesDir, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'Image not found' });
    }
    
    try {
        // Process image to strip metadata and convert to clean PNG
        const processedImage = await sharp(filePath)
            .png({ 
                compressionLevel: 9,
                adaptiveFiltering: true,
                force: true // Force PNG output even if input is JPEG
            })
            .toBuffer();
        
        // Set headers for PNG
        const baseName = path.parse(filename).name;
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', processedImage.length);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        
        // Only set Content-Disposition if download is requested
        if (req.query.download === 'true') {
            res.setHeader('Content-Disposition', `attachment; filename="${baseName}_slim.png"`);
        }
        
        res.send(processedImage);
    } catch (error) {
        console.error('Error processing slim image:', error);
        res.status(500).json({ success: false, error: 'Failed to process image' });
    }
});
// Optimized JPG route - converts to optimized JPEG
app.use('/image/opti/:filename', authMiddleware, async (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(imagesDir, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'Image not found' });
    }
    
    try {
        // Process image to optimized JPEG
        const processedImage = await sharp(filePath)
            .jpeg({ 
                quality: 85,
                progressive: true,
                mozjpeg: true,
                optimizeScans: true,
                force: true // Force JPEG output
            })
            .toBuffer();
        
        // Set headers for JPEG download
        const baseName = path.parse(filename).name;
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', processedImage.length);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        
        // Only set Content-Disposition if download is requested
        if (req.query.download === 'true') {
            res.setHeader('Content-Disposition', `attachment; filename="${baseName}_optimized.jpg"`);
        }
        
        res.send(processedImage);
    } catch (error) {
        console.error('Error processing optimized image:', error);
        res.status(500).json({ success: false, error: 'Failed to process image' });
    }
});

app.options('/', (req, res) => {
    if (!runtimeCompileComplete) {
        const bootStatus = serverStartupStatus.getPublicStatus();
        return res.status(503).json({
            success: false,
            error: 'Runtime assets are compiling',
            stage: 'runtime_compile',
            stageMessage: bootStatus.stageMessage,
            progressPercent: bootStatus.progressPercent,
            uptime: bootStatus.uptime,
            retryAfter: 5
        });
    }
    try {
        res.json(buildServiceWorkerCacheManifest());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Server status endpoint - available once HTTP server is listening
app.options('/status', (req, res) => {
    res.json(serverStartupStatus.getPublicStatus({
        runtimeCompileComplete,
        runtimeCompile: runtimeAssetService.getPublicStatus(),
        runtimeAutoRecompile: getRuntimeAutoRecompileConfig()
    }));
});

// Boot-critical static assets — available as soon as HTTP listens (before full static middleware)
for (const bootPath of ['/sw.js', '/manifest.json']) {
    app.get(bootPath, (req, res, next) => {
        const filePath = path.join(__dirname, 'public', bootPath.slice(1));
        if (!fs.existsSync(filePath)) {
            return next();
        }
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        res.sendFile(filePath);
    });
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/agent', devAuthMiddleware, (req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    req.session.save((error) => {
        if (error) {
            console.error('Agent session save failed:', error.message);
            return res.status(500).json({ error: 'Failed to create agent session' });
        }
        return res.type('html').send(`<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Preparing Dreamscape</title>
<script>
(async () => {
    if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    location.replace('/app?agent=1');
})().catch(() => location.replace('/app?agent=1'));
</script>`);
    });
});
app.get('/.login.jpg', (req, res) => {
    res.sendFile(path.join(cacheDir, 'login_array.jpg'));
});
app.post('/', serverReadinessMiddleware, express.json(), (req, res) => {
    const { action, data } = req.body;
    
    if (!action) { return res.status(400).json({ error: 'Action is required' }); }
    
    switch (action) {
        case 'login':
            const { pin } = data || {};
            if (!pin) {
                return res.status(400).json({ error: 'PIN code is required' });
            }
            
            const realIP = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || req.connection.remoteAddress;
            
            const config = globalResources.getConfig();
            const secureConfig = globalResources.getSecureConfig();
            if (pin === secureConfig.loginPin) {
                // Clear any failed login attempts on successful login
                globalResources.unblockIP(realIP);
                
                req.session.authenticated = true;
                req.session.userType = 'admin';
                res.json({
                    success: true,
                    message: 'Login successful',
                    userType: 'admin',
                    logViewerPathUuid: globalResources.getLogViewerPathUuid(),
                    vfsPathUuid: globalResources.getVfsPathUuid()
                });
            } else if (pin === secureConfig.readOnlyPin) {
                if (config.userPinLoginEnabled === false) {
                    return res.status(403).json({
                        success: false,
                        error: 'User PIN login is disabled. Admin PIN required.',
                        code: 'USER_PIN_DISABLED'
                    });
                }

                // Clear any failed login attempts on successful login
                globalResources.unblockIP(realIP);
                
                req.session.authenticated = true;
                req.session.userType = 'readonly';
                res.json({ success: true, message: 'Login successful', userType: 'readonly', vfsPathUuid: globalResources.getVfsPathUuid() });
            } else {
                // Skip tracking failed login attempts for private IP addresses
                if (!isPrivateIP(realIP)) {
                    // Track failed login attempt
                    const now = Date.now();
                    const invalidURLAttempts = globalResources.getInvalidURLAttempts();
                    const attempts = invalidURLAttempts.get(realIP) || { count: 0, lastAttempt: now, type: 'login' };
                    attempts.count++;
                    attempts.lastAttempt = now;
                    attempts.type = 'login';
                    invalidURLAttempts.set(realIP, attempts);
                    
                    console.log(`🔐 Failed login attempt from ${realIP} (attempt ${attempts.count})`);
                    
                    // Block IP after 3 failed login attempts
                    if (attempts.count >= 3) {
                        blockIP(realIP, `Failed login attempts (${attempts.count})`, attempts.count);
                        console.log(`🚫 Blocked IP ${realIP} for 3 failed login attempts`);
                        return res.status(403).json({ 
                            success: false, 
                            error: 'Too many failed login attempts. IP blocked.',
                            code: 'IP_BLOCKED'
                        });
                    }
                } else {
                    console.log(`🔐 Failed login attempt from private IP: ${realIP} (not tracked)`);
                }
                
                res.status(401).json({ success: false, error: 'Invalid PIN code' });
            }
            break;
            
        case 'logout':
            req.session.destroy(() => {
                res.clearCookie('connect.sid');
                res.json({ success: true, message: 'Logged out successfully' });
            });
            break;
        
        case 'ping':
            globalResources.generateLoginSpriteSheet();
            
            // Process telemetry data if provided
            if (data && typeof data === 'object') {
                const realIP = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || req.connection.remoteAddress;
                const eventType = data.eventType === 'app' ? 'app' : 'login';
                const screen = data.screen || {};

                const telemetryInfo = {
                    timestamp: new Date().toISOString(),
                    eventType,
                    ip: realIP,
                    userAgent: data.userAgent || 'Unknown',
                    platform: data.platform || 'Unknown',
                    language: data.language || 'Unknown',
                    screen,
                    timezone: data.timezone || 'Unknown',
                    connection: data.connection || null,
                    serviceWorker: data.serviceWorker || {},
                    storage: data.storage || {},
                    features: data.features || {},
                    cookieEnabled: data.cookieEnabled || false,
                    onLine: data.onLine || false,
                    route: data.page || null
                };

                console.log('📊 Telemetry ping received:', JSON.stringify(telemetryInfo, null, 2));

                const telemetryDb = globalResources.getTelemetryDatabase?.();
                if (telemetryDb?.recordTelemetryEvent) {
                    telemetryDb.recordTelemetryEvent({
                        eventType,
                        clientTimestamp: data.timestamp || null,
                        ip: realIP,
                        userAgent: data.userAgent || null,
                        platform: data.platform || null,
                        language: data.language || null,
                        timezone: data.timezone || null,
                        screenWidth: screen.width || null,
                        screenHeight: screen.height || null,
                        cookieEnabled: !!data.cookieEnabled,
                        onLine: !!data.onLine,
                        userType: req.session?.userType || null,
                        sessionId: req.sessionID || null,
                        route: data.page || null,
                        payload: {
                            connection: data.connection || null,
                            serviceWorker: data.serviceWorker || {},
                            storage: data.storage || {},
                            features: data.features || {},
                            screen
                        }
                    }).catch((err) => {
                        console.error('❌ Failed to store telemetry event:', err.message);
                    });
                }
            }
            
            // Check if user is already authenticated
            const isAuthenticated = req.session && req.session.authenticated;
            const userType = req.session && req.session.userType;
            
            const pingPayload = { 
                success: true, 
                message: 'Pong',
                authenticated: isAuthenticated,
                userType: userType || null,
                redirect: isAuthenticated ? '/app' : null
            };
            if (isAuthenticated) {
                pingPayload.vfsPathUuid = globalResources.getVfsPathUuid();
            }
            if (isAuthenticated && isAdminUser(req)) {
                pingPayload.logViewerPathUuid = globalResources.getLogViewerPathUuid();
            }
            res.json(pingPayload);
            break;
        
        default:
            res.status(400).json({ success: false, error: 'Invalid action' });
    }
});

app.options('/app', authMiddleware, (req, res) => {
    const serverVersion = '1.0.2'; // Update this when making breaking changes
    const message = 'A new version is available. Some features may not work correctly.';
    let response = { 
        success: true, 
        message: 'Session Valid', 
        timestamp: Date.now().valueOf(),
        serverVersion: serverVersion,
        versionMessage: message
    };
    if (isAdminUser(req)) {
        response.logViewerPathUuid = globalResources.getLogViewerPathUuid();
    }
    if (req.userType) {
        response.userType = req.userType;
    }
    response.vfsPathUuid = globalResources.getVfsPathUuid();
    res.json(response);
});
app.get('/app', (req, res) => {
    if (req.query.agent === '1') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Android WebView: JSON probe for AndroidBackgroundRefresh manifest (session cookies, same as WebView)
app.get('/android/background-notification', serverReadinessMiddleware, authMiddleware, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    try {
        const balance = await getBalance();
        const fixed = balance.ok ? (balance.fixedTrainingStepsLeft || 0) : 0;
        const paid = balance.ok ? (balance.purchasedTrainingSteps || 0) : 0;
        let expiresAt = balance.subscription && balance.subscription.expiresAt;
        if (expiresAt == null) {
            const accountData = globalResources.getAccountData();
            expiresAt = accountData && accountData.subscription && accountData.subscription.expiresAt;
        }
        let daysLeft = '';
        if (expiresAt != null && expiresAt !== '') {
            const sec = Number(expiresAt);
            if (Number.isFinite(sec)) {
                const d = Math.ceil((sec * 1000 - Date.now()) / (86400000));
                daysLeft = String(d > 0 ? d : 0);
            }
        }
        res.json({
            free: String(fixed),
            paid: String(paid),
            daysLeft
        });
    } catch (error) {
        console.error('❌ /android/background-notification:', error);
        res.status(500).json({ error: 'Failed to load notification status' });
    }
});

// Traces viewer page
app.get('/traces', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'traces.html'));
});
// Traces API
app.get('/traces/list', authMiddleware, (req, res) => {
    try {
        const list = globalResources.getTracing().listTraces();
        console.log(`📋 listTraces() returned ${list.length} traces`);
        res.json({ success: true, traces: list });
    } catch (e) {
        console.error('❌ Error in /traces/list:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/traces/:id', authMiddleware, (req, res) => {
    try {
        const trace = globalResources.getTracing().loadTrace(req.params.id);
        if (!trace) return res.status(404).json({ success: false, error: 'Trace not found' });
        res.json({ success: true, trace });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Admin log viewer (UUID-prefixed paths — not guessable)
(function registerLogViewerRoutes() {
    const logPath = `/${globalResources.getLogViewerPathUuid()}`;

    function adminOnlyMiddleware(req, res, next) {
        if (!isAdminUser(req)) {
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }
        next();
    }

    app.get(`${logPath}/sources`, authMiddleware, adminOnlyMiddleware, (req, res) => {
        try {
            const listed = globalResources.getLogger().listLogSources();
            res.setHeader('Cache-Control', 'no-store');
            res.json({
                success: true,
                sources: listed.sources,
                groups: listed.groups,
                pm2Available: pm2Service.isPm2Available()
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get(`${logPath}/pm2/status`, authMiddleware, adminOnlyMiddleware, async (req, res) => {
        try {
            if (!pm2Service.isPm2Available()) {
                return res.status(404).json({ success: false, error: 'PM2 not available' });
            }
            const status = await pm2Service.getProcessStatus();
            res.json({ success: true, status });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post(`${logPath}/pm2/flush`, authMiddleware, adminOnlyMiddleware, async (req, res) => {
        try {
            if (!pm2Service.isPm2Available()) {
                return res.status(404).json({ success: false, error: 'PM2 not available' });
            }
            const result = await pm2Service.flushLogs();
            globalResources.getLogger().info(`PM2 logs flushed for ${result.processName} (admin log viewer)`);
            res.json({ success: true, ...result });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post(`${logPath}/pm2/restart`, authMiddleware, adminOnlyMiddleware, async (req, res) => {
        try {
            if (!pm2Service.isPm2Available()) {
                return res.status(404).json({ success: false, error: 'PM2 not available' });
            }
            const broom = req.body?.broom !== false;
            res.json({ success: true, broom, preparing: true });

            setImmediate(() => {
                performAdminDssRestart(broom).catch((err) => {
                    globalResources.getLogger().error(`Admin DSS restart failed: ${err.message}`);
                });
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get(`${logPath}/backlog`, authMiddleware, adminOnlyMiddleware, (req, res) => {
        try {
            const source = req.query.source;
            if (!source) {
                return res.status(400).json({ success: false, error: 'source is required' });
            }
            const lines = parseInt(req.query.lines, 10) || 500;
            const data = globalResources.getLogger().readLogTail(source, lines);
            res.setHeader('Cache-Control', 'no-store');
            res.json({ success: true, ...data });
        } catch (e) {
            res.status(400).json({ success: false, error: e.message });
        }
    });

    app.get(`${logPath}/stream`, authMiddleware, adminOnlyMiddleware, (req, res) => {
        const source = req.query.source;
        const logger = globalResources.getLogger();
        const offset = logger.parseLogStreamOffset(source, req.query.offset);
        if (!source || offset === null) {
            return res.status(400).json({ success: false, error: 'source and offset are required' });
        }
        if (!logger.resolveLogSource(source)) {
            return res.status(400).json({ success: false, error: 'Invalid log source' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const statusInterval = parseInt(req.query.statusInterval, 10);
        streamLogFile(res, globalResources.getLogger(), source, offset, {
            pm2Service,
            getHostMetrics: () => pm2Service.getHostMetrics(),
            getRuntimeCompileStatus: () => runtimeAssetService.getPublicStatus(),
            statusIntervalMs: Number.isFinite(statusInterval) ? statusInterval : undefined
        });
    });
})();

// VFS file serving (UUID-prefixed paths — not guessable)
(function registerVfsRoutes() {
    const vfsPath = `/${globalResources.getVfsPathUuid()}`;
    const vfsDb = () => globalResources.getVfsDatabase();
    const workspaceExists = (id) => !!globalResources.getWorkspaceManager().getWorkspaces()[id];

    function buildVfsSession(req) {
        return {
            userType: req.userType || req.session?.userType || 'admin',
            applicationScopes: req.applicationAuth?.applicationScopes
        };
    }

    function denyVfsFileAccess(res, asJson) {
        if (asJson) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        return res.status(403).send('Access denied');
    }

    app.get(`${vfsPath}/files/:fileId`, authMiddleware, async (req, res) => {
        try {
            const file = await vfsDb().getUserFileById(req.params.fileId);
            if (!file) return res.status(404).json({ success: false, error: 'File not found' });
            if (!vfsDb().canSessionAccessVfsFile(buildVfsSession(req), file, { workspaceExists })) {
                return denyVfsFileAccess(res, true);
            }
            const blobPath = globalResources.getVfsManager().getFileBlobPath(file.content_hash);
            if (!fs.existsSync(blobPath)) return res.status(404).json({ success: false, error: 'File blob missing' });
            res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"`);
            fs.createReadStream(blobPath).pipe(res);
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get(`${vfsPath}/system/:encodedKey`, authMiddleware, async (req, res) => {
        try {
            const vfs = globalResources.getVfsManager();
            const systemFileKey = vfs.decodeSystemFileKey(req.params.encodedKey);
            if (!systemFileKey) {
                return res.status(400).json({ success: false, error: 'Invalid system file key' });
            }
            const info = vfs.resolveSystemFileDownload(systemFileKey);
            if (!fs.existsSync(info.absPath)) {
                return res.status(404).json({ success: false, error: 'File not found' });
            }
            res.setHeader('Content-Type', info.mimeType || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(info.name)}"`);
            res.setHeader('Content-Length', String(info.size));
            fs.createReadStream(info.absPath).pipe(res);
        } catch (e) {
            const status = /not found|invalid|denied|Only cache/i.test(e.message) ? 404
                : /too large/i.test(e.message) ? 413
                    : 400;
            if (status === 413 || status === 400) {
                return res.status(status).json({ success: false, error: e.message });
            }
            return res.status(status).json({ success: false, error: e.message });
        }
    });

    app.get(`${vfsPath}/previews/:fileId`, authMiddleware, async (req, res) => {
        try {
            const file = await vfsDb().getUserFileById(req.params.fileId);
            if (!file) return res.status(404).send('Not found');
            if (!vfsDb().canSessionAccessVfsFile(buildVfsSession(req), file, { workspaceExists })) {
                return denyVfsFileAccess(res, false);
            }
            if (file.preview_path) {
                const previewPath = globalResources.getVfsManager().getFilePreviewPath(file.preview_path);
                if (previewPath && fs.existsSync(previewPath)) {
                    res.setHeader('Content-Type', 'image/webp');
                    return fs.createReadStream(previewPath).pipe(res);
                }
            }
            const blobPath = globalResources.getVfsManager().getFileBlobPath(file.content_hash);
            if ((file.mime_type || '').startsWith('image/') && fs.existsSync(blobPath)) {
                res.setHeader('Content-Type', file.mime_type);
                return fs.createReadStream(blobPath).pipe(res);
            }
            res.status(404).send('No preview');
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get(`${vfsPath}/images/:filename`, authMiddleware, async (req, res) => {
        try {
            const filename = decodeURIComponent(req.params.filename);
            const workspaceId = req.query.ws;
            if (!workspaceId) return res.status(400).json({ success: false, error: 'workspace required' });
            const ws = globalResources.getWorkspaceManager().getWorkspaces()[workspaceId];
            if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found' });
            const inFiles = (ws.files || []).includes(filename) || (ws.scraps || []).includes(filename);
            if (!inFiles) return res.status(403).json({ success: false, error: 'Access denied' });
            const imagePath = path.join(globalResources.getPath('images'), filename);
            if (!fs.existsSync(imagePath)) return res.status(404).send('Not found');
            res.setHeader('Content-Type', 'image/png');
            fs.createReadStream(imagePath).pipe(res);
        } catch (e) {
            res.status(500).send(e.message);
        }
    });
})();

// Serve trace attachments
app.use('/traces/files', authMiddleware, (req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    next();
}, express.static(globalResources.getTracing().tracesDir));
app.get('/launch', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'launch.html'));
});
app.get('/preset/:uuid', serverReadinessMiddleware, getQueueMiddleware, async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'realtime, no-cache, no-store, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        const currentPromptConfig = globalResources.getPromptConfig();
        // Resolve preset or preset group by UUID (transparently handles chapters)
        const resolution = globalResources.getTextReplacements().resolvePresetOrGroup(req.params.uuid);
        if (!resolution) {
            return res.status(404).json({ success: false, error: 'Preset or preset group not found' });
        }

        const { preset, presetName, isFromGroup, groupName } = resolution;

        // Validate query parameters
        const validationErrors = validatePresetQueryParameters(req.query);
        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid query parameters',
                details: validationErrors
            });
        }
        const p = {...preset, name: presetName};
        
        // Check if this preset has pipeline configuration for staged generation
        let result;
        if (p.pipeline && Array.isArray(p.pipeline) && p.pipeline.length > 0) {
            console.log(`🎬 Preset has pipeline with ${p.pipeline.length} stages`);
            
            // Use target_workspace from preset if no workspace specified
            const workspaceId = req?.query?.workspace || p?.target_workspace || 'default';
            
            // Build body for staged generation (similar to WebSocket flow)
            const bodyData = {
                ...p,
                workspace: workspaceId,
                preset: p.name,
                presetName: p.name,
                // Apply query parameter overrides
                ...(req.query.steps && { steps: parseInt(req.query.steps) }),
                ...(req.query.guidance && { guidance: parseFloat(req.query.guidance) }),
                ...(req.query.rescale && { rescale: parseFloat(req.query.rescale) }),
                ...(req.query.seed && { seed: parseInt(req.query.seed) }),
                ...(req.query.variety !== undefined && { variety: req.query.variety === 'true' }),
                ...(req.query.upscale && { upscale: req.query.upscale === 'true' ? true : parseFloat(req.query.upscale) })
            };
            
            // Call handleStagedGeneration with a mock session ID
            const sessionId = crypto.randomUUID();
            result = await handleStagedGeneration(globalResources, bodyData, sessionId, null, null, null, null);
        } else {
            // Regular single generation
            const opts = await buildOptions(globalResources, p, null, req.query);
            // Use target_workspace from preset if no workspace specified (for REST API calls)
            const workspaceId = req?.query?.workspace || p?.target_workspace || 'default';
            result = await handleGeneration(globalResources, opts, true, p.name || 'unknown', workspaceId);
        }
        
        // Handle staged generation results with multiple saved images
        let targetFilename = result.filename;
        
        if (result.filenames && Array.isArray(result.filenames) && result.filenames.length > 0) {
            // Multiple saved images from staged generation
            const numParam = req.query.num;
            
            if (numParam !== undefined) {
                const numIndex = parseInt(numParam);
                if (isNaN(numIndex) || numIndex < 0 || numIndex >= result.filenames.length) {
                    return res.status(404).json({
                        success: false,
                        error: `Invalid num parameter. Valid range: 0-${result.filenames.length - 1}`,
                        total_saved: result.filenames.length
                    });
                }
                targetFilename = result.filenames[numIndex];
                console.log(`📸 Returning staged result ${numIndex} of ${result.filenames.length}: ${targetFilename}`);
            } else {
                // Default to last image
                targetFilename = result.filenames[result.filenames.length - 1];
                console.log(`📸 Returning last staged result (${result.filenames.length - 1} of ${result.filenames.length}): ${targetFilename}`);
            }
        }
        
        // Read the target image file
        let finalBuffer;
        if (targetFilename && targetFilename !== result.filename) {
            // Need to read from disk
            const imagePath = path.join(imagesDir, targetFilename);
            if (!fs.existsSync(imagePath)) {
                return res.status(404).json({ success: false, error: 'Generated image file not found' });
            }
            finalBuffer = fs.readFileSync(imagePath);
        } else {
            // Use buffer from result
            finalBuffer = result.buffer;
        }
        
        // Check if optimization is requested
        const optimize = req.query.optimize === 'true';
        let contentType = 'image/png';
        if (optimize) {
            try {
                finalBuffer = await sharp(finalBuffer)
                    .jpeg({ quality: 75 })
                    .toBuffer();
                contentType = 'image/jpeg';
            } catch (error) {
                console.error('❌ Image optimization failed:', error.message);
                // Fall back to original PNG if optimization fails
            }
        }
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename, X-Total-Saved');
        res.setHeader('X-Generated-Filename', targetFilename);
        if (result.filenames && Array.isArray(result.filenames)) {
            res.setHeader('X-Total-Saved', result.filenames.length.toString());
        }
        res.setHeader('X-Preset-UUID', p.uuid);
        res.setHeader('X-Preset-Name', p.name);
        if (req.query.download === 'true') {
            const extension = optimize ? 'jpg' : 'png';
            const optimizedFilename = targetFilename.replace('.png', `.${extension}`);
            res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
        }
        res.send(finalBuffer);
    } catch(e) {
        console.error('❌ Error occurred:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Scheduled preset generation endpoint
app.get('/pending/preset/:uuid', serverReadinessMiddleware, getQueueMiddleware, async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'realtime, no-cache, no-store, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        const currentPromptConfig = globalResources.getPromptConfig();
        // Resolve preset or preset group by UUID (transparently handles chapters)
        const resolution = globalResources.getTextReplacements().resolvePresetOrGroup(req.params.uuid);
        if (!resolution) {
            return res.status(401).json({ success: 'not_possible', error: 'Invalid preset or preset group UUID' });
        }

        const { preset, presetName, isFromGroup, groupName } = resolution;

        // Validate query parameters
        const validationErrors = validatePresetQueryParameters(req.query);
        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: 'not_possible',
                error: 'Invalid query parameters',
                details: validationErrors
            });
        }

        const windowParam = req.query.window;
        let scheduledTime = Date.now();
        let successStatus = 'success';

        // Handle scheduling with window parameter
        if (windowParam) {
            const window = parseInt(windowParam);
            if (isNaN(window) || window < 60) {
                return res.status(400).json({
                    success: 'not_possible',
                    error: 'Window must be at least 60 seconds to account for generation time'
                });
            }

            // Schedule at random time within window, leaving 60 seconds for generation
            const maxDelay = window - 60;
            if (maxDelay <= 0) {
                return res.status(400).json({
                    success: 'not_possible',
                    error: 'Window too small to account for generation time (60 seconds)'
                });
            }

            scheduledTime = Date.now() + (Math.random() * maxDelay * 1000);
            successStatus = 'pending';
        }

        // Handle named requests
        const requestName = req.query.name;
        if (requestName) {
            const existingRequestId = namedRequests.get(requestName);
            if (existingRequestId) {
                const existingRequest = pendingRequests.get(existingRequestId);
                if (existingRequest && !existingRequest.retrievedAt) {
                    // Request exists and hasn't been retrieved yet - fail
                    return res.status(409).json({
                        success: 'not_possible',
                        error: `Named request "${requestName}" already exists and has not been retrieved yet`
                    });
                }
                // Request exists but has been retrieved - we can overwrite it
                // Clean up the old request
                cancelScheduledTimeout(existingRequestId);
                const queueIndex = scheduledQueue.indexOf(existingRequestId);
                if (queueIndex !== -1) {
                    scheduledQueue.splice(queueIndex, 1);
                }
                pendingRequests.delete(existingRequestId);
                console.log(`♻️ Overwriting completed named request "${requestName}"`);
            }
        }

        // Generate unique request ID
        const requestId = crypto.randomUUID();

        // Handle breakPoint parameter for pipeline stage breakpoints
        const breakPoint = req.query.breakPoint || null;
        if (breakPoint && !/^[0-9a-fA-F]{2}$/.test(breakPoint)) {
            return res.status(400).json({
                success: 'not_possible',
                error: 'breakPoint must be a valid 2-character hex ID (e.g., "3f", "a2")'
            });
        }

        // Store request data
        const requestData = {
            requestId,
            presetUuid: req.params.uuid,
            scheduledTime,
            status: 'waiting',
            filename: null,
            filenames: null,
            retrievedAt: null,
            startedAt: null,
            completedAt: null,
            errorMessage: null,
            queryParams: req.query,
            workspaceId: req.query.workspace || preset?.target_workspace || 'default',
            timeoutId: null,
            name: requestName || null,
            breakPoint: breakPoint
        };

        // Store in named requests map if name provided
        if (requestName) {
            namedRequests.set(requestName, requestId);
        }

        pendingRequests.set(requestId, requestData);
        const wasEmpty = scheduledQueue.length === 0;
        scheduledQueue.push(requestId);

        // Start queue processor only if this is the first request
        if (wasEmpty) {
            scheduleNextRequest();
        }

        res.json({
            success: successStatus,
            request_id: requestId,
            scheduled_time: scheduledTime
        });

    } catch(e) {
        console.error('❌ Scheduled preset request failed:', e);
        res.status(500).json({ success: 'failed', error: e.message });
    }
});

// Scheduled preset retrieval endpoint
app.get('/pending/retrieval/:requestid', serverReadinessMiddleware, async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'realtime, no-cache, no-store, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        let requestId = req.params.requestid;
        let request = null;

        // Handle named request lookups
        if (requestId.startsWith('named:')) {
            const requestName = requestId.substring(6); // Remove "named:" prefix
            if (!requestName || requestName.trim() === '') {
                return res.status(400).json({ success: false, error: 'Invalid named request format' });
            }

            const namedRequestId = namedRequests.get(requestName);
            if (!namedRequestId) {
                return res.status(404).json({ success: false, error: `Named request "${requestName}" not found` });
            }

            requestId = namedRequestId;
            request = pendingRequests.get(requestId);
        } else {
            request = pendingRequests.get(requestId);
        }

        if (!request) {
            return res.status(404).json({ success: false, error: 'Request not found' });
        }

        // Calculate queue position for waiting/pending requests
        let queuePosition = null;
        if (request.status === 'waiting' || request.status === 'pending') {
            queuePosition = scheduledQueue.indexOf(requestId) + 1;
        }

        if (request.status === 'waiting' || request.status === 'pending') {
            return res.json({
                status: request.status,
                scheduled_time: request.scheduledTime,
                queue_position: queuePosition
            });
        }

        if (request.status === 'error') {
            return res.json({
                status: 'error',
                error: request.errorMessage
            });
        }

        if (request.status === 'completed') {
            // Mark as retrieved if this is the first retrieval
            if (!request.retrievedAt) {
                request.retrievedAt = Date.now();
            }

            // Return the image buffer directly (same as regular preset endpoint)
            if (!request.filename) {
                return res.status(500).json({ success: false, error: 'No filename stored for completed request' });
            }

            // Handle staged generation results with multiple saved images
            let targetFilename = request.filename;
            
            if (request.filenames && Array.isArray(request.filenames) && request.filenames.length > 0) {
                // Multiple saved images from staged generation
                const numParam = req.query.num;
                
                if (numParam !== undefined) {
                    // Check if numParam is a hex ID (2-char hex) or numeric index
                    const isHexId = /^[0-9a-fA-F]{2}$/.test(numParam) && isNaN(numParam);
                    
                    if (isHexId) {
                        // Search by stage hex ID
                        const stageData = request.filenames.find(f => 
                            f.stageId && f.stageId.toLowerCase() === numParam.toLowerCase()
                        );
                        
                        if (!stageData) {
                            const availableIds = request.filenames
                                .map(f => f.stageId || 'null')
                                .filter(id => id !== 'null');
                            
                            return res.status(404).json({
                                success: false,
                                error: `Stage ID '${numParam}' not found`,
                                available_stage_ids: availableIds,
                                available_indices: `0-${request.filenames.length - 1}`,
                                total_saved: request.filenames.length
                            });
                        }
                        
                        targetFilename = stageData.filename;
                        console.log(`📸 Returning stage by ID '${numParam}': ${targetFilename} (index ${stageData.stageIndex})`);
                    } else {
                        // Numeric index
                        const numIndex = parseInt(numParam);
                        if (isNaN(numIndex) || numIndex < 0 || numIndex >= request.filenames.length) {
                            const availableIds = request.filenames
                                .map(f => f.stageId || 'null')
                                .filter(id => id !== 'null');
                            
                            return res.status(404).json({
                                success: false,
                                error: `Invalid num parameter. Valid range: 0-${request.filenames.length - 1}`,
                                available_stage_ids: availableIds.length > 0 ? availableIds : undefined,
                                total_saved: request.filenames.length
                            });
                        }
                        
                        // Handle both old format (string) and new format (object)
                        targetFilename = typeof request.filenames[numIndex] === 'string' 
                            ? request.filenames[numIndex] 
                            : request.filenames[numIndex].filename;
                        console.log(`📸 Returning staged result ${numIndex} of ${request.filenames.length}: ${targetFilename}`);
                    }
                } else {
                    // Default to last image
                    const lastEntry = request.filenames[request.filenames.length - 1];
                    targetFilename = typeof lastEntry === 'string' ? lastEntry : lastEntry.filename;
                    console.log(`📸 Returning last staged result (${request.filenames.length - 1} of ${request.filenames.length}): ${targetFilename}`);
                }
            }

            // Read the generated image file
            const imagePath = path.join(imagesDir, targetFilename);
            if (!fs.existsSync(imagePath)) {
                return res.status(404).json({ success: false, error: 'Generated image file not found' });
            }

            const imageBuffer = fs.readFileSync(imagePath);

            // Set headers similar to regular preset endpoint
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename, X-Request-ID, X-Total-Saved');
            res.setHeader('X-Generated-Filename', targetFilename);
            res.setHeader('X-Request-ID', requestId);
            if (request.filenames && Array.isArray(request.filenames)) {
                res.setHeader('X-Total-Saved', request.filenames.length.toString());
            }

            // Handle optimization if requested
            const optimize = req.query.optimize === 'true';
            let finalBuffer = imageBuffer;
            let contentType = 'image/png';

            if (optimize) {
                try {
                    finalBuffer = await sharp(imageBuffer)
                        .jpeg({ quality: 75 })
                        .toBuffer();
                    contentType = 'image/jpeg';
                } catch (error) {
                    console.error('❌ Image optimization failed:', error.message);
                    // Fall back to original PNG if optimization fails
                }
            }

            res.setHeader('Content-Type', contentType);
            if (req.query.download === 'true') {
                const extension = optimize ? 'jpg' : 'png';
                const optimizedFilename = targetFilename.replace('.png', `.${extension}`);
                res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
            }

            return res.send(finalBuffer);
        }

        // Unknown status
        return res.status(500).json({ success: false, error: 'Unknown request status' });

    } catch(e) {
        console.error('❌ Scheduled preset retrieval failed:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/reroll/:filename', serverReadinessMiddleware, authMiddleware, getQueueMiddleware, async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'realtime, no-cache, no-store, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        if (req.userType !== 'admin') {
            return res.status(403).json({ success: false, error: 'Non-Administrator Login: This operation is not allowed for non-administrator users' });
        }

        const filename = req.params.filename;
        const workspace = req.query.workspace || req.body.workspace || 'default';
        
        // Get image metadata
        const metadata = await globalResources.getMetadataDatabase().getImageMetadata(filename, imagesDir);
        if (!metadata) {
            return res.status(404).json({ success: false, error: `No metadata found for image: ${filename}` });
        }

        // Call the reroll generation function
        const result = await handleRerollGeneration(
            globalResources,
            metadata, 
            req.session.id, 
            workspace,
            true
        );
        
        // Check if optimization is requested
        const optimize = req.query.optimize === 'true';
        let finalBuffer = result.buffer;
        let contentType = 'image/png';
        
        if (optimize) {
            try {
                finalBuffer = await sharp(result.buffer)
                    .jpeg({ quality: 75 })
                    .toBuffer();
                contentType = 'image/jpeg';
            } catch (error) {
                console.error('❌ Image optimization failed:', error.message);
                // Fall back to original PNG if optimization fails
            }
        }
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename, X-Seed, X-Original-Filename');
        
        if (result && result.filename) {
            res.setHeader('X-Generated-Filename', result.filename);
        }
        
        if (result && result.seed !== undefined) {
            res.setHeader('X-Seed', result.seed.toString());
        }
        
        res.setHeader('X-Original-Filename', filename);
        
        if (req.query.download === 'true') {
            const extension = optimize ? 'jpg' : 'png';
            const optimizedFilename = result.filename.replace('.png', `.${extension}`);
            res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
        }
        
        res.send(finalBuffer);
        
    } catch(e) {
        console.error('❌ Reroll error occurred:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Test bias adjustment endpoint
app.post('/test-bias-adjustment', serverReadinessMiddleware, async (req, res) => {
    try {
        const { image_source, target_width, target_height, bias } = req.body;
        
        if (!image_source || !target_width || !target_height || !bias) {
            return res.status(400).json({ success: false, error: 'Missing required parameters' });
        }
        
        // Load image from disk based on source
        let imagePath;
        if (image_source.startsWith('file:')) {
            imagePath = path.join(imagesDir, image_source.replace('file:', ''));
        } else if (image_source.startsWith('cache:')) {
            imagePath = path.join(uploadCacheDir, image_source.replace('cache:', ''));
        } else {
            return res.status(400).json({ success: false, error: 'Invalid image source format' });
        }
        
        // Check if file exists
        if (!fs.existsSync(imagePath)) {
            return res.status(404).json({ success: false, error: 'Image file not found' });
        }
        
        // Read image file
        const imageBuffer = fs.readFileSync(imagePath);
        
        // Process image with dynamic bias
        const processedBuffer = await processDynamicImage(
            imageBuffer, 
            { width: target_width, height: target_height }, 
            bias
        );
        
        // Return the processed image
        res.set('Content-Type', 'image/png');
        res.send(processedBuffer);
        
    } catch (error) {
        console.error('Bias adjustment test error:', error);
        res.status(500).json({ success: false, error: 'Failed to process bias adjustment' });
    }
});

// Admin endpoint to view all pending requests
app.get('/pending', authMiddleware, (req, res) => {
    try {
        // Check if user is admin (not readonly)
        if (req.session.userType !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Admin access required to view pending requests' 
            });
        }

        // Convert pending requests map to array
        const requests = Array.from(pendingRequests.entries()).map(([id, request]) => {
            // Calculate duration if applicable
            let duration = null;
            if (request.startedAt && request.completedAt) {
                duration = request.completedAt - request.startedAt;
            } else if (request.startedAt) {
                duration = Date.now() - request.startedAt;
            }

            return {
                requestId: id,
                name: request.name || null,
                presetUuid: request.presetUuid,
                workspaceId: request.workspaceId,
                status: request.status,
                createdAt: request.scheduledTime,
                startedAt: request.startedAt || null,
                completedAt: request.completedAt || null,
                retrievedAt: request.retrievedAt || null,
                duration: duration,
                errorMessage: request.errorMessage || null,
                files: request.filenames || (request.filename ? [request.filename] : []),
                breakPoint: request.breakPoint || null,
                queuePosition: request.status === 'waiting' || request.status === 'pending' 
                    ? scheduledQueue.indexOf(id) + 1 
                    : null
            };
        });

        // Sort by creation time (newest first)
        requests.sort((a, b) => b.createdAt - a.createdAt);

        res.json({
            success: true,
            total: requests.length,
            queue_length: scheduledQueue.length,
            processing: processingScheduled,
            requests: requests
        });

    } catch (error) {
        console.error('❌ Error fetching pending requests:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch pending requests',
            details: error.message 
        });
    }
});

// Scheduled preset generation queue processing with timeout-based scheduling
async function scheduleNextRequest() {
    if (scheduledQueue.length === 0) return;

    // Find the next request in queue order
    const nextRequestId = scheduledQueue[0];
    const request = pendingRequests.get(nextRequestId);

    if (!request) {
        // Request was deleted, remove from queue
        scheduledQueue.shift();
        return scheduleNextRequest();
    }

    // Clear any existing timeout for this request
    if (request.timeoutId) {
        clearTimeout(request.timeoutId);
        request.timeoutId = null;
    }

    const now = Date.now();
    const delay = Math.max(0, request.scheduledTime - now);

    // Schedule the timeout for this request
    request.timeoutId = setTimeout(async () => {
        // Double-check the request still exists and is still first in queue
        if (!pendingRequests.has(nextRequestId) || scheduledQueue[0] !== nextRequestId) {
            return; // Request was processed or removed by another path
        }
        await processScheduledRequest(nextRequestId);
    }, delay);
}

// Process a single scheduled request
async function processScheduledRequest(requestId) {
    const request = pendingRequests.get(requestId);
    if (!request) return;

    // Check if we're currently processing another request
    if (processingScheduled) {
        console.log(`⏰ Request ${requestId} fired while busy, will wait for queue processor`);
        // Don't reschedule - let the queue processor handle this in order
        return;
    }

    processingScheduled = true;

    try {
        // Double-check the request is still in the queue before processing
        const queueIndex = scheduledQueue.indexOf(requestId);
        if (queueIndex === -1) {
            console.log(`⚠️ Request ${requestId} was removed from queue before processing`);
            return;
        }

        // CRITICAL: Only process if this is the first item in the queue
        // This ensures strict FIFO ordering
        if (queueIndex !== 0) {
            console.log(`⚠️ Request ${requestId} attempted to process out of order (position ${queueIndex + 1}), skipping`);
            return;
        }

        // Remove from queue
        scheduledQueue.splice(queueIndex, 1);

        // Clear the timeout since we're processing now
        if (request.timeoutId) {
            clearTimeout(request.timeoutId);
            request.timeoutId = null;
        }

        // Update status to pending and record start time
        request.status = 'pending';
        request.startedAt = Date.now();

        // Load preset and build options
        const currentPromptConfig = globalResources.getPromptConfig();
        const foundPreset = Object.entries(currentPromptConfig.presets).find(([key, preset]) => preset.uuid === request.presetUuid);
        if (!foundPreset) {
            throw new Error('Preset not found');
        }
        const p = {...foundPreset[1], name: foundPreset[0]};
        
        // Use target_workspace from preset if no workspace specified
        const workspaceId = request.queryParams.workspace || p?.target_workspace || 'default';

        // Check if this preset has pipeline configuration for staged generation
        let result;
        if (p.pipeline && Array.isArray(p.pipeline) && p.pipeline.length > 0) {
            console.log(`🎬 Scheduled preset has pipeline with ${p.pipeline.length} stages`);
            
            // Build body for staged generation (similar to WebSocket flow)
            const bodyData = {
                ...p,
                workspace: workspaceId,
                preset: p.name,
                presetName: p.name,
                // Apply query parameter overrides
                ...(request.queryParams.steps && { steps: parseInt(request.queryParams.steps) }),
                ...(request.queryParams.guidance && { guidance: parseFloat(request.queryParams.guidance) }),
                ...(request.queryParams.rescale && { rescale: parseFloat(request.queryParams.rescale) }),
                ...(request.queryParams.seed && { seed: parseInt(request.queryParams.seed) }),
                ...(request.queryParams.variety !== undefined && { variety: request.queryParams.variety === 'true' }),
                ...(request.queryParams.upscale && { upscale: request.queryParams.upscale === 'true' ? true : parseFloat(request.queryParams.upscale) }),
                // Add breakPoint if specified in request
                ...(request.breakPoint && { breakPoint: request.breakPoint })
            };
            
            // Call handleStagedGeneration with a mock session ID
            const sessionId = crypto.randomUUID();
            result = await handleStagedGeneration(globalResources, bodyData, sessionId, null, null, null, null);
        } else {
            // Regular single generation
            const opts = await buildOptions(globalResources, p, null, request.queryParams);
            result = await handleGeneration(globalResources, opts, true, p.name || 'unknown', workspaceId);
        }

        // Update request with successful result
        request.status = 'completed';
        request.completedAt = Date.now();
        request.filename = result.filename;
        
        // Store array of filenames if this is a staged generation
        if (result.filenames && Array.isArray(result.filenames) && result.filenames.length > 0) {
            request.filenames = result.filenames;
            console.log(`✅ Scheduled request ${requestId} completed with ${result.filenames.length} saved stages`);
        } else {
            console.log(`✅ Scheduled request ${requestId} completed successfully`);
        }

    } catch (error) {
        console.error('❌ Scheduled generation failed:', error);
        // Update request with error
        request.status = 'error';
        request.completedAt = Date.now();
        request.errorMessage = error.message;
    } finally {
        processingScheduled = false;
        lastScheduledCompletion = Date.now();

        // Wait random 10-15 seconds before scheduling next request
        // This ensures requests in the queue will be processed in order
        const delay = Math.floor(Math.random() * 5000) + 10000;
        setTimeout(() => {
            scheduleNextRequest();
        }, delay);
    }
}

// Cancel timeout for a specific request
function cancelScheduledTimeout(requestId) {
    const request = pendingRequests.get(requestId);
    if (request && request.timeoutId) {
        clearTimeout(request.timeoutId);
        request.timeoutId = null;
    }
}

// Cleanup all scheduled timeouts (for server shutdown)
function cleanupAllScheduledTimeouts() {
    globalResources.logger.info('Cleaning up all scheduled timeouts');
    for (const [requestId, request] of pendingRequests.entries()) {
        cancelScheduledTimeout(requestId);
    }
    // Clear the queues and maps
    scheduledQueue.length = 0;
    namedRequests.clear();
}

// Cleanup function for retrieved requests (1 hour after retrieval)
function cleanupRetrievedRequests() {
    const now = Date.now();
    const oneHourAgo = now - 3600000; // 1 hour in milliseconds

    // Create a list of requests to clean up to avoid modifying the map while iterating
    const requestsToCleanup = [];

    for (const [requestId, request] of pendingRequests.entries()) {
        if (request.retrievedAt && request.retrievedAt < oneHourAgo && request.status === 'completed') {
            requestsToCleanup.push(requestId);
        }
    }

    // Clean up the requests
    for (const requestId of requestsToCleanup) {
        const request = pendingRequests.get(requestId);
        if (!request) continue; // Request might have been deleted by another operation

        // Cancel any active timeout (though there shouldn't be any for completed requests)
        cancelScheduledTimeout(requestId);

        // Remove from named requests map if it has a name
        if (request.name) {
            namedRequests.delete(request.name);
        }

        // Remove from queue if present (shouldn't be for completed requests, but be safe)
        const queueIndex = scheduledQueue.indexOf(requestId);
        if (queueIndex !== -1) {
            scheduledQueue.splice(queueIndex, 1);
        }

        // Remove from map
        pendingRequests.delete(requestId);
        console.log(`🗑️ Cleaned up scheduled request ${requestId}${request.name ? ` (named: "${request.name}")` : ''} (expired after 1 hour)`);
    }
}

// Set callbacks in globalResources for account management
globalResources.setRefreshBalanceCallback(refreshBalance);
globalResources.setGetBalanceCallback(getBalance);

// Register cache refresh callback using plumbing system
globalResources.getDataPlumbing().setCallback('refreshCache', () => initializeCacheData(true), {
    temporary: false,
    category: 'cache',
    tags: ['cache', 'refresh'],
    description: 'Callback to force refresh server cache data'
});
globalResources.getDataPlumbing().setCallback('refreshAndBroadcastServiceWorkerCache', (options) => refreshAndBroadcastServiceWorkerCache(options), {
    temporary: false,
    category: 'cache',
    tags: ['cache', 'refresh', 'service-worker', 'broadcast'],
    description: 'Refresh server SW hash cache and broadcast manifest to all clients'
});
globalResources.setGetUserDataCallback(getUserData);

// Initialize account data in globalResources (balance is stored at accountData.subscription.trainingStepsLeft)
globalResources.setAccountData({ 
    ok: false,
    subscription: {
        trainingStepsLeft: {
            fixedTrainingStepsLeft: 0,
            purchasedTrainingSteps: 0
        }
    }
});

let unixSocketCommunication = null;

async function handleAdminUnixSocketMessage(message, socket) {
    const { type, data, id } = message;

    try {
        let result;

        switch (type) {
            case 'refresh_service_worker_cache':
            case 'recompile_runtime_assets':
                result = await refreshAndBroadcastServiceWorkerCache({
                    ...(data || {}),
                    silent: (data && data.silent) === true
                });
                break;
            default:
                throw new Error(`Unknown Unix socket message type: ${type}`);
        }

        unixSocketCommunication.sendResponseToClient(socket, id, result, null, true);
    } catch (error) {
        console.error(`❌ Error handling Unix socket message ${type}:`, error);
        unixSocketCommunication.sendResponseToClient(socket, id, null, error.message, false);
    }
}

// Start server with early readiness tracking
(async () => {
    // Initialize boot tree logging
    globalResources.logger.startBoot();

    // Listen immediately so /status is reachable during global resource init
    await globalResources.logger.bootStep('HTTP Server', async () => {
        updateServerStage('binding');
        await globalResources.startWebServer();
        serverStartupStatus.setCapability('http', true);
        serverStartupStatus.setCapability('status', true);
        globalResources.logger.bootSubStep(`Listening on port ${globalResources.getConfig().port}`);
    });

    await globalResources.logger.bootStep('Global Resources Initialization', async () => {
        updateServerStage('loading_global_resources');
        await globalResources.initialize({
            reportStartup: serverStartupStatus.reportGlobalResourcesStep
        });
    });

    // Rotate generation log on startup
    globalResources.logger.rotateGenerationLog();

    updateServerStage('initializing');
    
    // Preview Synchronization
    await globalResources.logger.bootStep('Preview Synchronization', async () => {
        updateServerStage('syncing_previews');
        await globalResources.syncPreviews();
    });
    
    // Account & Cache Initialization
    await globalResources.logger.bootStep('Runtime Asset Compilation', async () => {
        updateServerStage('runtime_compile');
        const result = await runtimeAssetService.compileOnBoot(__dirname, { showConsoleProgress: true });
        runtimeCompileComplete = true;
        if (result.errors.length > 0) {
            globalResources.logger.error(`Runtime compile: ${result.errors.length} file(s) failed (keeping previous optimised copies)`);
            for (const entry of result.errors) {
                globalResources.logger.error(`  ${entry.file}: ${entry.error}`);
            }
            broadcastRuntimeCompileErrors(result);
        } else {
            globalResources.logger.bootSubStep(`${result.compiled} compiled, ${result.skipped} up-to-date`);
        }
    });

    await globalResources.logger.bootStep('Account & Cache', async () => {
        updateServerStage('account_init');
        await initializeAccountData();
        await refreshBalance(true);

        updateServerStage('cache_init');
        await initializeCacheData(true);
    });
    
    // Service Initialization
    await globalResources.logger.bootStep('Service Initialization', async () => {
        updateServerStage('service_init');
        
        // Clear temp downloads
        globalResources.clearTempDownloads();
        
        // Generate login sprite sheet
        try {
            updateServerStage('sprite_sheet_init');
            await globalResources.generateLoginSpriteSheet();
            globalResources.logger.bootSubStep('Login sprite sheet generated');
        } catch (error) {
            globalResources.logger.warn('Sprite sheet generation failed, will generate on first access');
        }
    });
    
    // WebSocket Server
    await globalResources.logger.bootStep('WebSocket Server', async () => {
        updateServerStage('websocket_init');
        const { wsServer } = globalResources.initializeWebSocketServer();
        serverStartupStatus.setCapability('websocket', true);

        // Start ping interval with server data callback
        wsServer.startPingInterval(() => {
            return {
                balance: globalResources.getAccountBalance(),
                opusUsage: getOpusUsageFromAccountData(globalResources.getAccountData()),
                accountHealth: globalResources.getAccountClientFields(),
                queue_status: globalResources.getQueue().getStatus(),
                image_count: globalResources.getImageCounter().getCount(),
                server_time: Date.now().valueOf()
            };
        });

        // Start queue status broadcasting
        wsServer.startQueueStatusInterval();

        globalResources.logger.bootSubStep('WebSocket server initialized');
    });

    await globalResources.logger.bootStep('Generation Quips Auto-Update', async () => {
        updateServerStage('generation_quips_auto_update_init');
        globalResources.initializeGenerationQuipsAutoUpdate();
    });

    // Unix socket CLI (service worker cache refresh / client broadcast)
    await globalResources.logger.bootStep('Unix Socket CLI', async () => {
        updateServerStage('unix_socket_init');
        const socketPath = process.env.STATICFORGE_SOCKET_PATH || '/tmp/staticforge_mcp.sock';
        unixSocketCommunication = new UnixSocketCommunication({ socketPath });
        unixSocketCommunication.on('message', handleAdminUnixSocketMessage);
        await unixSocketCommunication.startServer();
        globalResources.logger.bootSubStep(`Unix socket listening on ${socketPath}`);
    });
    
    // Finalize Setup
    await globalResources.logger.bootStep('Finalizing', async () => {
        updateServerStage('finalizing');
        globalResources.logger.bootSubStep('Security system initialized');

        // Serve optimised css/scripts from .cache unless debug mode (before public static)
        app.use(async (req, res, next) => {
            try {
                if (req.method !== 'GET' && req.method !== 'HEAD') {
                    return next();
                }
                const webPath = req.path;
                if (!runtimeAssetService.isRuntimeManagedWebPath(webPath)) {
                    return next();
                }
                const debugMode = runtimeAssetService.isDebugRequest(req);
                if (!debugMode && runtimeAssetService.isAutoRecompileEnabled()) {
                    await runtimeAssetService.ensureCompiledForRequest(__dirname, webPath);
                }
                const servedPath = runtimeAssetService.resolveServedPath(
                    __dirname,
                    webPath,
                    debugMode
                );
                if (!fs.existsSync(servedPath)) {
                    return next();
                }
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                if (servedPath.includes(`${path.sep}.cache${path.sep}runtime-assets${path.sep}`)) {
                    res.setHeader('X-StaticForge-Runtime-Asset', 'optimized');
                } else {
                    res.setHeader('X-StaticForge-Runtime-Asset', 'source');
                }
                res.sendFile(servedPath);
            } catch (err) {
                next(err);
            }
        });

        serverStartupStatus.setCapability('staticAssets', true);

        // Serve static files from public directory (after routes to avoid conflicts)
        app.use(express.static('public', {
            maxAge: '10s', // Cache static assets for 10 seconds
            etag: true, // Enable ETags for cache validation
            lastModified: true, // Enable Last-Modified headers
            setHeaders: (res, path) => {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        }));

        // 404 handler for invalid URL tracking (after routes and static files)
        app.use('*', invalidURLHandler, (req, res) => {
            res.status(404).json({
                success: false,
                error: 'Not found',
                code: 'NOT_FOUND',
                path: req.originalUrl
            });
        });
        
        // Set up periodic refreshes using globalResources timer system
        globalResources.registerTimer('accountDataRefresh', 'interval', () => initializeAccountData(), ACCOUNT_DATA_REFRESH_INTERVAL);
        globalResources.registerTimer('balanceRefresh', 'interval', () => refreshBalance(), BALANCE_REFRESH_INTERVAL);
        globalResources.registerTimer('cacheRefresh', 'interval', () => initializeCacheData(), CACHE_REFRESH_INTERVAL);
        setTimeout(() => {
            try {
                runCacheDirExpiry(globalResources);
            } catch (err) {
                globalResources.logger.warn('Cache dir expiry failed:', err.message);
            }
        }, FIRST_RUN_DELAY_MS);
        globalResources.registerTimer('cacheDirExpiry', 'interval', () => {
            try {
                runCacheDirExpiry(globalResources);
            } catch (err) {
                globalResources.logger.warn('Cache dir expiry failed:', err.message);
            }
        }, CLEANUP_INTERVAL_MS);
        globalResources.registerTimer('securityCleanup', 'interval', () => cleanupSecurityData(), SECURITY_CONFIG.CLEANUP_INTERVAL_MS);
        globalResources.registerTimer('retrievedRequestsCleanup', 'interval', () => cleanupRetrievedRequests(), 5 * 60 * 1000);
        
        globalResources.logger.bootSubStep(`Server listening on port ${globalResources.getConfig().port}`);
    });

    // Server is now fully ready
    updateServerStage('ready', true);
    globalResources.logger.endBoot();
})();

// Admin log viewer: safe prepare, optional log flush (broom), then PM2 restart
async function performAdminDssRestart(broom = true) {
    const logger = globalResources.getLogger();
    logger.info(`Admin DSS restart requested (broom: ${broom})`);

    cleanupAllScheduledTimeouts();
    await globalResources.prepareForRestart();

    if (broom) {
        const flushResult = await pm2Service.flushLogs();
        logger.info(`PM2 logs flushed for ${flushResult.processName} (admin restart)`);
    }

    const restartResult = await pm2Service.restartProcess();
    logger.info(`PM2 restart initiated for ${restartResult.processName} (admin restart)`);
}

// Graceful shutdown handling
async function gracefulShutdown() {
    globalResources.logger.info('Graceful shutdown initiated');

    flushAllBlockedLogFloods();
    cleanupAllScheduledTimeouts();

    if (globalResources.shutdown) {
        await globalResources.shutdown();
    }

    // Close Unix socket communication if it exists
    if (unixSocketCommunication) {
        globalResources.logger.info('Closing Unix socket communication');
        unixSocketCommunication.close();
    }

    globalResources.logger.shutdown();
    process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('uncaughtException', (error) => {
    // pm2Service.handleRecoverablePm2Error: modules/pm2Service.js
    if (pm2Service.handleRecoverablePm2Error(error)) {
        globalResources?.logger?.warn('Recovered PM2 client error, connection reset:', error.message);
        return;
    }
    globalResources.logger.error('Uncaught exception:', error);
    process.exit(1);
});
process.on('unhandledRejection', (error) => {
    globalResources.logger.error('Unhandled rejection:', error);
});