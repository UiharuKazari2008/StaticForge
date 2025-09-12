const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
const { NovelAI, Model } = require('nekoai-js');
const config = require('./config.json');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const crypto = require('crypto');
const compression = require('compression');
const helmet = require('helmet');

// Security and Rate Limiting
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

// Import modules
const { authMiddleware, devAuthMiddleware } = require('./modules/auth');
const { loadPromptConfig } = require('./modules/textReplacements');
const { tagSuggestionsCache } = require('./modules/cache');
const { queueMiddleware, getStatus: getQueueStatus } = require('./modules/queue');
const { WebSocketServer, setGlobalWsServer, getGlobalWsServer } = require('./modules/websocket');
const { WebSocketMessageHandlers } = require('./modules/websocketHandlers');
const { getBaseName } = require('./modules/pngMetadata');
const { processDynamicImage } = require('./modules/imageTools');
const { initializeWorkspaces, getWorkspaces, getActiveWorkspace, addToWorkspaceArray } = require('./modules/workspace');
const { addReceiptMetadata, addUnattributedReceipt, broadcastReceiptNotification, getImageMetadata } = require('./modules/metadataDatabase');
const { initializeChatDatabase } = require('./modules/chatDatabase');
const { initializeDirectorDatabase } = require('./modules/directorDatabase');
const imageCounter = require('./modules/imageCounter');
const { generateBlurredPreview, generateMobilePreviews } = require('./modules/previewUtils');
const { setContext: setImageGenContext, handleGeneration, buildOptions, handleRerollGeneration } = require('./modules/imageGeneration');
const { setContext: setUpscaleContext } = require('./modules/imageUpscaling');
const UnixSocketCommunication = require('./modules/unixSocketCommunication');

// Initialize NovelAI client
const client = new NovelAI({ 
    token: config.apiKey,
    timeout: 100000,
    verbose: !!config.debugNovelAI
 });


// Account data management
let accountData = { ok: false };
let accountBalance = { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0, totalCredits: 0 };
let lastBalanceCheck = 0;
let lastAccountDataCheck = 0;
const BALANCE_REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
const ACCOUNT_DATA_REFRESH_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

// Cache data management
let globalCacheData = [];
const CACHE_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
let lastCacheCheck = 0;

// Security and IP Blocking System
const blockedIPs = new Map(); // IP -> { blockedAt, reason, attempts }
const suspiciousIPs = new Map(); // IP -> { attempts, lastSeen, patterns }
const invalidURLAttempts = new Map(); // IP -> { count, lastAttempt }

// Rolling Key System for Service Worker Authentication
const rollingKeys = {
  current: null,
  previous: null, // Keep previous key for transition period
  lastRotation: 0,
  rotationInterval: 5 * 60 * 1000, // 5 minutes
  keyLength: 32,
  validationAttempts: new Map(), // Track validation attempts per IP
  maxAttempts: 10, // Max validation attempts per IP per minute
  attemptWindow: 60 * 1000 // 1 minute window
};

// Generate a new rolling key with enhanced security
function generateRollingKey() {
  // Use crypto.randomBytes for secure random generation
  const randomBytes = crypto.randomBytes(rollingKeys.keyLength);
  // Convert to hex and ensure exact length
  const key = randomBytes.toString('hex');
  if (key.length !== rollingKeys.keyLength * 2) {
    throw new Error('Generated key has incorrect length');
  }
  return key;
}

// Validate rolling key input format and sanitize
function validateAndSanitizeKey(key) {
  if (!key || typeof key !== 'string') {
    return { valid: false, sanitized: null };
  }

  // Remove any whitespace
  const sanitized = key.trim();

  // Validate length (hex representation of 32 bytes = 64 characters)
  if (sanitized.length !== rollingKeys.keyLength * 2) {
    return { valid: false, sanitized: null };
  }

  // Validate character set (only hexadecimal characters)
  if (!/^[a-f0-9]+$/i.test(sanitized)) {
    return { valid: false, sanitized: null };
  }

  return { valid: true, sanitized: sanitized.toLowerCase() };
}

// Secure constant-time string comparison to prevent timing attacks
function secureStringCompare(a, b) {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Use crypto.timingSafeEqual for constant-time comparison
  try {
    const aBytes = Buffer.from(a, 'utf8');
    const bBytes = Buffer.from(b, 'utf8');

    // Only compare if lengths are equal (constant time)
    if (aBytes.length !== bBytes.length) {
      return false;
    }

    return crypto.timingSafeEqual(aBytes, bBytes);
  } catch (error) {
    // Fallback to regular comparison if timingSafeEqual fails
    console.warn('⚠️ timingSafeEqual failed, using regular comparison:', error.message);
    return a === b;
  }
}

// Check rate limiting for key validation attempts
function checkRateLimit(ip) {
  const now = Date.now();
  const attempts = rollingKeys.validationAttempts.get(ip) || { count: 0, resetTime: now + rollingKeys.attemptWindow };

  // Reset counter if window has passed
  if (now > attempts.resetTime) {
    attempts.count = 0;
    attempts.resetTime = now + rollingKeys.attemptWindow;
  }

  // Check if limit exceeded
  if (attempts.count >= rollingKeys.maxAttempts) {
    return { allowed: false, resetTime: attempts.resetTime };
  }

  // Increment counter
  attempts.count++;
  rollingKeys.validationAttempts.set(ip, attempts);

  return { allowed: true };
}

// Rotate the rolling key
function rotateRollingKey() {
  const now = Date.now();
  if (now - rollingKeys.lastRotation >= rollingKeys.rotationInterval) {
    rollingKeys.previous = rollingKeys.current;
    rollingKeys.current = generateRollingKey();
    rollingKeys.lastRotation = now;

    // Clean up old validation attempts
    const cutoffTime = now - rollingKeys.attemptWindow;
    for (const [ip, attempts] of rollingKeys.validationAttempts.entries()) {
      if (attempts.resetTime < cutoffTime) {
        rollingKeys.validationAttempts.delete(ip);
      }
    }

    return true;
  }
  return false;
}

// Get current valid rolling key
function getCurrentRollingKey() {
  rotateRollingKey(); // Rotate if needed
  return rollingKeys.current;
}

// Validate a rolling key with comprehensive security checks
function validateRollingKey(key, ip = 'unknown') {
  // Check rate limiting first
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', ip, {
      event: 'rolling_key_validation',
      attemptsRemaining: rollingKeys.maxAttempts - (rollingKeys.validationAttempts.get(ip)?.count || 0),
      resetTime: rateLimit.resetTime
    });
    return false;
  }

  // Validate and sanitize input
  const validation = validateAndSanitizeKey(key);
  if (!validation.valid) {
    logSecurityEvent('INVALID_KEY_FORMAT', ip, {
      event: 'rolling_key_validation',
      keyLength: key ? key.length : 0,
      expectedLength: rollingKeys.keyLength * 2
    });
    return false;
  }

  const sanitizedKey = validation.sanitized;

  // Ensure we have current keys
  rotateRollingKey();

  // Use secure comparison to prevent timing attacks
  const isCurrentValid = secureStringCompare(sanitizedKey, rollingKeys.current);
  const isPreviousValid = rollingKeys.previous && secureStringCompare(sanitizedKey, rollingKeys.previous);

  if (isCurrentValid || isPreviousValid) {
    logSecurityEvent('VALID_KEY_AUTHENTICATION', ip, {
      event: 'rolling_key_validation',
      keyType: isCurrentValid ? 'current' : 'previous',
      keyAge: Date.now() - rollingKeys.lastRotation
    });
    return true;
  }

  logSecurityEvent('INVALID_KEY_REJECTED', ip, {
    event: 'rolling_key_validation',
    keyLength: sanitizedKey.length,
    currentKeyAge: Date.now() - rollingKeys.lastRotation
  });
  return false;
}

// Security audit logging for rolling key system
function logSecurityEvent(eventType, ip, details = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    eventType,
    ip,
    ...details
  };

  // Log to console with structured format
  console.log(`🔐 SECURITY [${eventType}]: IP ${ip}`, details);

  // In production, you might want to:
  // - Write to security log file
  // - Send to SIEM system
  // - Store in security database
  // - Send alerts for suspicious activity

  // For now, we'll just log to console, but this function can be enhanced
  // to integrate with your security monitoring system
}

// Get rolling key system statistics
function getRollingKeyStats() {
  const now = Date.now();
  const activeIPs = rollingKeys.validationAttempts.size;

  // Calculate statistics
  let totalAttempts = 0;
  let rateLimitedIPs = 0;

  for (const [ip, attempts] of rollingKeys.validationAttempts.entries()) {
    totalAttempts += attempts.count;
    if (attempts.count >= rollingKeys.maxAttempts) {
      rateLimitedIPs++;
    }
  }

  return {
    currentKeyAge: now - rollingKeys.lastRotation,
    nextRotation: rollingKeys.lastRotation + rollingKeys.rotationInterval - now,
    activeIPs,
    rateLimitedIPs,
    totalAttempts,
    keyLength: rollingKeys.current ? rollingKeys.current.length : 0,
    hasPreviousKey: !!rollingKeys.previous
  };
}

// Initialize rolling key system
function initializeRollingKeySystem() {
  try {
    rollingKeys.current = generateRollingKey();
    rollingKeys.lastRotation = Date.now();

    // Validate that the key was generated correctly
    if (!rollingKeys.current || rollingKeys.current.length !== rollingKeys.keyLength * 2) {
      throw new Error('Failed to generate valid rolling key during initialization');
    }

    // Log successful initialization
    logSecurityEvent('ROLLING_KEY_INIT', 'system', {
      keyLength: rollingKeys.current.length,
      rotationInterval: rollingKeys.rotationInterval
    });

    // Set up periodic rotation
    setInterval(rotateRollingKey, rollingKeys.rotationInterval / 4); // Check every 1.25 minutes

    // Set up periodic cleanup of validation attempts
    setInterval(() => {
      const now = Date.now();
      const cutoffTime = now - rollingKeys.attemptWindow;
      let cleanedCount = 0;

      // Clean up old validation attempts
      for (const [ip, attempts] of rollingKeys.validationAttempts.entries()) {
        if (attempts.resetTime < cutoffTime) {
          rollingKeys.validationAttempts.delete(ip);
          cleanedCount++;
        }
      }

      // Log current statistics
      const stats = getRollingKeyStats();
      if (stats.activeIPs > 0 || cleanedCount > 0) {
        //onsole.log(`🔑 Rolling key stats: ${stats.activeIPs} active IPs, ${stats.rateLimitedIPs} rate limited, cleaned ${cleanedCount} old entries`);

        if (stats.rateLimitedIPs > 0) {
          logSecurityEvent('RATE_LIMIT_STATS', 'system', stats);
        }
      }
    }, rollingKeys.attemptWindow / 2); // Clean up every 30 seconds

    // Set up security monitoring
    setInterval(() => {
      const stats = getRollingKeyStats();

      // Alert if too many IPs are being rate limited
      if (stats.rateLimitedIPs > 10) {
        logSecurityEvent('HIGH_RATE_LIMIT_ACTIVITY', 'system', {
          message: 'High number of rate limited IPs detected',
          ...stats
        });
      }

      // Alert if key is getting old (should have rotated)
      if (stats.currentKeyAge > rollingKeys.rotationInterval * 1.5) {
        logSecurityEvent('KEY_ROTATION_DELAY', 'system', {
          message: 'Key rotation appears to be delayed',
          ...stats
        });
      }
    }, 60000); // Check every minute

  } catch (error) {
    console.error('❌ Failed to initialize rolling key system:', error);
    logSecurityEvent('ROLLING_KEY_INIT_FAILED', 'system', {
      error: error.message
    });
    throw error;
  }
}

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
    MAX_SUSPICIOUS_IPS: 5000 // Maximum number of suspicious IPs to track
};

// Get real IP address from request
function getRealIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           req.ip ||
           'unknown';
}

// Check if IP is blocked
function isIPBlocked(ip) {
    const blocked = blockedIPs.get(ip);
    if (!blocked) return false;
    
    // Check if block has expired
    if (Date.now() - blocked.blockedAt > SECURITY_CONFIG.BLOCK_DURATION_MS) {
        blockedIPs.delete(ip);
        return false;
    }
    
    return true;
}

// Block an IP address
function blockIP(ip, reason, attempts = 0) {
    blockedIPs.set(ip, {
        blockedAt: Date.now(),
        reason: reason,
        attempts: attempts
    });
    
    console.log(`🚫 BLOCKED IP: ${ip} - Reason: ${reason} (Attempts: ${attempts})`);
    
    // Cleanup if we have too many blocked IPs
    if (blockedIPs.size > SECURITY_CONFIG.MAX_BLOCKED_IPS) {
        const oldestEntries = Array.from(blockedIPs.entries())
            .sort((a, b) => a[1].blockedAt - b[1].blockedAt)
            .slice(0, Math.floor(SECURITY_CONFIG.MAX_BLOCKED_IPS * 0.1));
        
        oldestEntries.forEach(([ip]) => blockedIPs.delete(ip));
    }
}

// Check if URL matches scraping patterns
function isScrapingPattern(url) {
    return SCRAPING_PATTERNS.some(pattern => pattern.test(url));
}

// Track suspicious activity
function trackSuspiciousActivity(ip, url, userAgent) {
    const now = Date.now();
    const suspicious = suspiciousIPs.get(ip) || { attempts: 0, lastSeen: now, patterns: [] };
    
    suspicious.attempts++;
    suspicious.lastSeen = now;
    suspicious.patterns.push({
        url: url,
        userAgent: userAgent,
        timestamp: now
    });
    
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
function trackInvalidURL(ip) {
    const now = Date.now();
    const attempts = invalidURLAttempts.get(ip) || { count: 0, lastAttempt: now };
    
    attempts.count++;
    attempts.lastAttempt = now;
    
    invalidURLAttempts.set(ip, attempts);
    
    // Check if we should block this IP
    if (attempts.count >= SECURITY_CONFIG.INVALID_URL_THRESHOLD) {
        blockIP(ip, `Invalid URL attempts (${attempts.count})`, attempts.count);
        return true;
    }
    
    return false;
}

// Cleanup old entries
function cleanupSecurityData() {
    const now = Date.now();
    const cleanupAge = SECURITY_CONFIG.BLOCK_DURATION_MS;
    
    // Cleanup blocked IPs
    for (const [ip, data] of blockedIPs.entries()) {
        if (now - data.blockedAt > cleanupAge) {
            blockedIPs.delete(ip);
        }
    }
    
    // Cleanup suspicious IPs
    for (const [ip, data] of suspiciousIPs.entries()) {
        if (now - data.lastSeen > cleanupAge) {
            suspiciousIPs.delete(ip);
        }
    }
    
    // Cleanup invalid URL attempts
    for (const [ip, data] of invalidURLAttempts.entries()) {
        if (now - data.lastAttempt > cleanupAge) {
            invalidURLAttempts.delete(ip);
        }
    }
    
    // Limit suspicious IPs size
    if (suspiciousIPs.size > SECURITY_CONFIG.MAX_SUSPICIOUS_IPS) {
        const entries = Array.from(suspiciousIPs.entries())
            .sort((a, b) => a[1].lastSeen - b[1].lastSeen)
            .slice(0, Math.floor(SECURITY_CONFIG.MAX_SUSPICIOUS_IPS * 0.1));
        
        entries.forEach(([ip]) => suspiciousIPs.delete(ip));
    }
}

// Check if a resource requires rolling key authentication
function isProtectedResource(url) {
    if (!url) return false;

    // Protect image resources
    if (url.startsWith('/images/') ||
        url.startsWith('/previews/') ||
        url.startsWith('/cache/') ||
        url.startsWith('/.previews/')) {
        return true;
    }

    // Don't require auth for basic HTML pages and static assets
    return false;
}

// Security middleware
function securityMiddleware(req, res, next) {
    // Skip security checks for authenticated users
    if (req.session && req.session.authenticated) {
        return next();
    }

    const ip = getRealIP(req);
    const url = req.path;
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Check if this is a legitimate service worker request using rolling key
    const rollingKey = req.headers['x-sw-key'];
    const isServiceWorkerRequest = rollingKey && validateRollingKey(rollingKey);

    if (isServiceWorkerRequest) {
        return next();
    }
    
    // Check if IP is blocked
    if (isIPBlocked(ip)) {
        console.log(`🚫 Blocked request from ${ip} to ${url}`);
        return res.status(403).json({
            success: false,
            error: 'Access denied',
            code: 'IP_BLOCKED'
        });
    }

    // Allow service worker key endpoint to bypass scraping detection
    if (url === '/sw.js' && req.method === 'OPTIONS') {
        console.log(`🔑 Service Worker key request from ${ip} - allowing`);
        return next();
    }

    // Enforce rolling key authentication for protected resources
    const requiresAuth = isProtectedResource(url);
    if (requiresAuth) {
        const rollingKey = req.headers['x-sw-key'];

        // Validate rolling key with security checks
        if (!rollingKey) {
            console.warn(`🚫 Missing rolling key for protected resource: ${ip} -> ${url}`);
            return res.status(403).json({
                success: false,
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        const isAuthenticated = validateRollingKey(rollingKey, ip);

        if (!isAuthenticated) {
            // Check if it was rate limited
            const rateLimit = checkRateLimit(ip);
            if (!rateLimit.allowed) {
                console.warn(`🚫 Rate limit exceeded for protected resource: ${ip} -> ${url}`);
                return res.status(429).json({
                    success: false,
                    error: 'Too many requests',
                    code: 'RATE_LIMIT_EXCEEDED',
                    retryAfter: Math.ceil((rateLimit.resetTime - Date.now()) / 1000)
                });
            }

            console.warn(`🚫 Invalid rolling key for protected resource: ${ip} -> ${url}`);
            return res.status(403).json({
                success: false,
                error: 'Invalid authentication',
                code: 'AUTH_INVALID'
            });
        }

        console.log(`✅ Authenticated access to protected resource: ${ip} -> ${url}`);
    }

    // Check for scraping patterns
    if (isScrapingPattern(url)) {
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

    // Skip invalid URL tracking for legitimate service worker requests
    const rollingKey = req.headers['x-sw-key'];
    const isServiceWorkerRequest = rollingKey && validateRollingKey(rollingKey);

    if (isServiceWorkerRequest) {
        return next();
    }

    // Allow service worker key endpoint
    if (req.path === '/sw.js' && req.method === 'OPTIONS') {
        return next();
    }

    const ip = getRealIP(req);

    if (trackInvalidURL(ip)) {
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
        const now = Date.now();
        if (now - lastAccountDataCheck >= ACCOUNT_DATA_REFRESH_INTERVAL || force) {
            console.log('🔄 Initializing account data...');
            const userData = await getUserData();
            if (userData.ok) {
                accountData = userData;
                
                // Extract balance information from user data
                const fixedTrainingStepsLeft = userData?.subscription?.trainingStepsLeft?.fixedTrainingStepsLeft || 0;
                const purchasedTrainingSteps = userData?.subscription?.trainingStepsLeft?.purchasedTrainingSteps || 0;
                const totalCredits = fixedTrainingStepsLeft + purchasedTrainingSteps;
                
                accountBalance = {
                    fixedTrainingStepsLeft,
                    purchasedTrainingSteps,
                    totalCredits
                };
            }

            lastAccountDataCheck = Date.now();
            
            if (accountBalance.totalCredits !== 0) {
                console.log('✅ Account data loaded successfully');
                console.log(`💰 Balance: ${accountBalance.totalCredits} credits (${accountBalance.fixedTrainingStepsLeft} fixed, ${accountBalance.purchasedTrainingSteps} paid)`);
            } else {
                console.error('❌ Failed to load account data');
            }
        }
    } catch (error) {
        console.error('❌ Error initializing account data:', error.message);
    }
}

// Initialize cache data on startup
async function initializeCacheData(force = false) {
    try {
        const now = Date.now();
        if (now - lastCacheCheck >= CACHE_REFRESH_INTERVAL || force) {
            console.log('🔄 Initializing cache data...');
            
            const publicDir = path.join(__dirname, 'public');
            const cacheData = await generateCacheData(publicDir);
            
            globalCacheData = cacheData;
            lastCacheCheck = Date.now();
            
            console.log(`✅ Cache data generated: ${cacheData.length} assets`);
        }
    } catch (error) {
        console.error('❌ Error initializing cache data:', error.message);
    }
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
                
                // Calculate MD5 hash
                const fileBuffer = fs.readFileSync(filePath);
                const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
                
                // Convert to web path (remove /public prefix for clean URLs)
                const relativePath = path.relative(__dirname, filePath).replace(/\\/g, '/');
                const webPath = relativePath.startsWith('public/') 
                    ? '/' + relativePath.substring(7) // Remove 'public/' prefix
                    : '/' + relativePath;
                
                assets.push({
                    path: webPath,
                    md5: hash,
                    size: stats.size,
                    modified: stats.mtime.getTime()
                });
            } catch (error) {
                console.warn(`⚠️ Error processing file ${file}:`, error.message);
            }
        }
        
        // Sort by path for consistent ordering
        assets.sort((a, b) => a.path.localeCompare(b.path));
        
        return assets;
    } catch (error) {
        console.error('❌ Error scanning directory:', error.message);
        return [];
    }
}

// Recursively scan directory for files
async function scanDirectory(dir) {
    const files = [];
    
    try {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
            const itemPath = path.join(dir, item);
            const stats = fs.statSync(itemPath);
            
            if (stats.isDirectory()) {
                // Recursively scan subdirectories
                const subFiles = await scanDirectory(itemPath);
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
        const now = Date.now();
        if (now - lastBalanceCheck >= (BALANCE_REFRESH_INTERVAL / 2) || force) {
            // Check if there are active WebSocket clients connected
            const wsServer = getGlobalWsServer();
            if (wsServer && wsServer.getConnectionCount() === 0) {
                return;
            }
            
            const newBalanceData = await getBalance();
            
            if (newBalanceData && newBalanceData.ok) {
                // Check for deposits (balance increase)
                const oldTotalBalance = accountBalance.totalCredits;
                const newTotalBalance = newBalanceData.totalCredits;
                
                if (newTotalBalance > oldTotalBalance) {
                    const depositAmount = newTotalBalance - oldTotalBalance;
                    console.log(`💰 Deposit detected: +${depositAmount} credits`);
                    
                    // Determine which type of credits were deposited
                    const oldFixed = accountBalance.fixedTrainingStepsLeft;
                    const newFixed = newBalanceData.fixedTrainingStepsLeft;
                    const oldPurchased = accountBalance.purchasedTrainingSteps;
                    const newPurchased = newBalanceData.purchasedTrainingSteps;
                    
                    if (newPurchased > oldPurchased) {
                        // Add deposit receipt
                        addUnattributedReceipt({
                            type: 'deposit',
                            cost: newPurchased - oldPurchased,
                            creditType: 'paid',
                            date: now.valueOf()
                        });
                    }
                    if (newFixed > oldFixed) {
                        // Add deposit receipt
                        addUnattributedReceipt({
                            type: 'deposit',
                            cost: newFixed - oldFixed,
                            creditType: 'fixed',
                            date: now.valueOf()
                        });
                    }
                }
                
                // Update account balance with fresh balance data
                accountBalance = {
                    fixedTrainingStepsLeft: newBalanceData.fixedTrainingStepsLeft,
                    purchasedTrainingSteps: newBalanceData.purchasedTrainingSteps,
                    totalCredits: newBalanceData.totalCredits
                };
                
                // Update account data subscription info with fresh balance data
                if (accountData.ok) {
                    accountData.subscription = newBalanceData.subscription;
                }
                
                lastBalanceCheck = now;
            }
        }
    } catch (error) {
        console.error('❌ Error refreshing account data:', error.message);
    }
}

// Calculate credit usage and determine which type was used
async function calculateCreditUsage(_oldBalance) {
    const oldBalance = _oldBalance || { ...accountBalance };
    await refreshBalance(true);
    
    const totalUsage = Math.max(0, oldBalance.totalCredits - accountBalance.totalCredits);
    const freeUsage = Math.max(0, oldBalance.fixedTrainingStepsLeft - accountBalance.fixedTrainingStepsLeft);
    const paidUsage = Math.max(0, oldBalance.purchasedTrainingSteps - accountBalance.purchasedTrainingSteps);
    const usageType = totalUsage > 0 ? (paidUsage > 0 ? 'paid' : 'fixed') : 'free';
    
    return { totalUsage, freeUsage, paidUsage, usageType };
}

// Create Express app
const app = express();
const server = require('http').createServer(app);

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
        
        // Skip rate limiting for OPTIONS requests to specific routes only
        if (req.method === 'OPTIONS') {
            const allowedPaths = ['/', '/app'];
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
        
        // Skip speed limiting for OPTIONS requests to specific routes only
        if (req.method === 'OPTIONS') {
            const allowedPaths = ['/', '/app'];
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
        // Use compression for all other requests
        return compression.filter(req, res);
    }
}));

// Body parsing middleware with optimized limits
app.use(express.json({limit: '100mb'}));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(cookieParser());

// Create session store (prefer SQLite, fallback to memory)
let SQLiteStore = null;
try {
    SQLiteStore = require('connect-sqlite3')(session);
} catch (e) {
    console.warn('⚠️ connect-sqlite3 is not installed. Falling back to MemoryStore. Run "npm i connect-sqlite3" to enable SQLite-backed sessions.');
}

let sessionStore;
if (SQLiteStore) {
    try {
        const sessionsDir = path.resolve(__dirname, '.cache', 'sessions');
        if (!fs.existsSync(sessionsDir)) {
            fs.mkdirSync(sessionsDir, { recursive: true });
        }
        sessionStore = new SQLiteStore({
            dir: sessionsDir,
            db: 'sessions.sqlite',
            table: 'sessions',
            concurrentDB: true
        });
        console.log(`✅ Using SQLite session store at ${sessionsDir}/sessions.sqlite`);
    } catch (err) {
        console.error('❌ Failed to initialize SQLite session store, falling back to MemoryStore:', err.message);
        sessionStore = new session.MemoryStore();
    }
} else {
    sessionStore = new session.MemoryStore();
}

// Make session store globally accessible for workspace persistence
global.sessionStore = sessionStore;

// Create session middleware
const sessionMiddleware = session({
    secret: config.sessionSecret || 'staticforge-very-secret-key',
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

app.use(sessionMiddleware);
app.use(securityMiddleware);
app.use(limiter);
app.use(speedLimiter);

// Create cache directories
const cacheDir = path.resolve(__dirname, '.cache');
const uploadCacheDir = path.join(cacheDir, 'upload');
const previewCacheDir = path.join(cacheDir, 'preview');
const vibeCacheDir = path.join(cacheDir, 'vibe');
const tempDownloadDir = path.join(cacheDir, 'tempDownload');
const imagesDir = path.resolve(__dirname, 'images');
const previewsDir = path.resolve(__dirname, '.previews');

// Ensure cache directories exist
[uploadCacheDir, previewCacheDir, vibeCacheDir, tempDownloadDir, imagesDir, previewsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Initialize workspace system
initializeWorkspaces();

// Generate login page sprite sheet (single sheet with normal + blurred images)
async function generateLoginSpriteSheet() {
    try {
        const spritePath = path.join(previewsDir, 'login_image.jpg');
        const metadataPath = path.join(previewsDir, 'login_sprite_metadata.json');
        
        // Check if sprite sheet exists and is less than 1 hour old
        if (fs.existsSync(spritePath)) {
            const stats = fs.statSync(spritePath);
            const ageInHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
            if (ageInHours < 1) {
                return;
            }
        }
        
        const pinnedImages = await getPinnedImages();
        const randomImages = await getRandomWorkspaceImages();
        
        console.log(`📊 Image selection: ${pinnedImages.length} pinned + ${randomImages.length} random available`);
        
        // Ensure we have at least some images to work with
        if (pinnedImages.length === 0 && randomImages.length === 0) {
            console.log('⚠️ No images found for sprite sheet, skipping generation');
            return;
        }
        
        // If no pinned images, use more random images to fill the quota
        let selectedImages;
        if (pinnedImages.length === 0) {
            selectedImages = randomImages.slice(0, 20);
        } else if (pinnedImages.length < 20) {
            const remainingSlots = 20 - pinnedImages.length;
            selectedImages = [...pinnedImages, ...randomImages.slice(0, remainingSlots)];
        } else {
            selectedImages = pinnedImages.slice(0, 20);
        }
        
        if (selectedImages.length === 0) {
            console.log('⚠️ No valid images found for sprite sheet');
            return;
        }
        
        // Create 2x20 sprite sheet: 2 columns (normal + blurred), 20 rows (images)
        const width = 1024;
        const height = 1024;
        
        // Generate single combined sprite sheet with both normal and blurred images
        console.log('🖼️ Step 3: Generating combined sprite sheet...');
        await generateCombinedSpriteSheet(selectedImages, spritePath, width, height);
        
        // Save metadata for frontend use
        console.log('💾 Step 4: Saving metadata...');
        const metadata = {
            imageCount: selectedImages.length,
            spriteWidth: width,
            spriteHeight: (height * selectedImages.length),
            generatedAt: Date.now(),
            images: selectedImages.map(img => img.filename)
        };
        
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        
        console.log('✅ Login sprite sheet generated successfully');
        
    } catch (error) {
        console.error('❌ Error generating login sprite sheet:', error);
        // Don't throw the error, just log it so the server can continue
    }
}

// Get pinned/favorited images from workspaces
async function getPinnedImages() {
    try {
        const workspaces = getWorkspaces();

        if (!workspaces || typeof workspaces !== 'object') {
            console.warn('⚠️ Workspaces is not a valid object:', typeof workspaces);
            return [];
        }
        
        // Validate workspace structure
        if (Object.keys(workspaces).length === 0) {
            console.warn('⚠️ No workspaces found');
            return [];
        }
        
        const pinnedImages = [];
        
        // workspaces is an object with workspace IDs as keys, so we need to iterate over its values
        Object.entries(workspaces).forEach(([workspaceId, workspace]) => {
            if (!workspace || typeof workspace !== 'object') {
                console.warn(`⚠️ Invalid workspace object for ID: ${workspaceId}`);
                return;
            }
            
            if (workspace.pinned && Array.isArray(workspace.pinned) && workspace.pinned.length > 0) {
                // Select only 1 pinned image from this workspace for variety
                const randomPinnedIndex = Math.floor(Math.random() * workspace.pinned.length);
                const pinnedFile = workspace.pinned[randomPinnedIndex];
                
                if (!pinnedFile || typeof pinnedFile !== 'string') {
                    console.warn(`  ⚠️ Invalid pinned file entry:`, pinnedFile);
                    return;
                }
                
                const imagePath = path.join(imagesDir, pinnedFile);
                if (fs.existsSync(imagePath) && pinnedFile.match(/\.(png|jpg|jpeg)$/i)) {
                    pinnedImages.push({
                        filename: pinnedFile,
                        path: imagePath,
                        workspace: workspace.name || workspaceId
                    });
                } else {
                    console.log(`  ⚠️ Skipped pinned image (not found or invalid): ${pinnedFile}`);
                }
            } else {
            }
        });
        
        return pinnedImages;
    } catch (error) {
        console.error('❌ Error getting pinned images:', error);
        return [];
    }
}

// Get random workspace images
async function getRandomWorkspaceImages() {
    try {
        // Check if images directory exists
        if (!fs.existsSync(imagesDir)) {
            console.warn('⚠️ Images directory does not exist:', imagesDir);
            return [];
        }
        
        const imageFiles = fs.readdirSync(imagesDir)
            .filter(file => file.match(/\.(png|jpg|jpeg)$/i))
            .map(file => ({
                filename: file,
                path: path.join(imagesDir, file)
            }));
        
        if (imageFiles.length === 0) {
            console.warn('⚠️ No image files found in images directory');
            return [];
        }
        
        // Shuffle and return random images
        return imageFiles.sort(() => 0.5 - Math.random());
    } catch (error) {
        console.error('❌ Error getting random workspace images:', error);
        return [];
    }
}

// Generate combined sprite sheet with both normal and blurred images
async function generateCombinedSpriteSheet(images, outputPath, width, height) {
    try {
        if (!images || images.length === 0) {
            throw new Error('No images provided for sprite sheet generation');
        }
        
        console.log(`🖼️ Generating combined sprite sheet with ${images.length} images...`);
        
        // Create a canvas-like structure using sharp
        const spriteCanvas = sharp({
            create: {
                width: width,
                height: height * images.length,
                channels: 3,
                background: { r: 0, g: 0, b: 0 }
            }
        });
        
        const composites = [];
        let processedCount = 0;
        
        for (let i = 0; i < images.length; i++) {
            const image = images[i];
            const y = i * height; // Y position for each row
            
            try {
                if (!image.path || !fs.existsSync(image.path)) {
                    console.warn(`⚠️ Skipping invalid image: ${image.filename || 'unknown'}`);
                    continue;
                }
                
                // Process normal image (left column) - crop to point of interest
                const normalImage = sharp(image.path)
                    .resize(width, height, { 
                        fit: 'cover',
                        position: 'attention' // This focuses on the most interesting part of the image
                    });
                
                const normalBuffer = await normalImage.toBuffer();
                
                composites.push({
                    input: normalBuffer,
                    left: 0, // Left column for normal images
                    top: y
                });
                
                processedCount++;
                
            } catch (error) {
                console.error(`❌ Error processing image ${image.filename}:`, error.message);
                // Continue with other images instead of failing completely
            }
        }
        
        if (composites.length === 0) {
            throw new Error('No images could be processed for sprite sheet');
        }
        
        console.log(`✅ Processed ${processedCount}/${images.length} images for combined sprite sheet`);
        
        // Composite all images onto the sprite sheet
        await spriteCanvas
            .composite(composites)
            .jpeg({ quality: 40 })
            .toFile(outputPath);
            
        console.log(`💾 Saved combined sprite sheet to ${outputPath}`);
            
    } catch (error) {
        console.error(`❌ Error generating combined sprite sheet:`, error);
        throw error;
    }
}

// On startup: generate missing previews and clean up orphans
async function syncPreviews() {
    const files = fs.readdirSync(imagesDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i));
    const previews = fs.readdirSync(previewsDir).filter(f => f.endsWith('.jpg'));
    const baseMap = {};
    // Pair originals and upscales
    for (const file of files) {
        const base = getBaseName(file);
        if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null };
        if (file.includes('_upscaled')) baseMap[base].upscaled = file;
        else baseMap[base].original = file;
    }
    // Generate missing previews
    for (const base in baseMap) {
        const previewFile = `${base}.jpg`
        const imgFile = baseMap[base].original || baseMap[base].upscaled;
        const previewPath = path.join(previewsDir, previewFile);
        const retinaPreviewPath = path.join(previewsDir, `${base}@2x.jpg`);
        const blurPreviewFile = `${base}_blur.jpg`;
        const blurPreviewPath = path.join(previewsDir, blurPreviewFile);
        if (imgFile) {
            const imgPath = path.join(imagesDir, imgFile);
            if (!fs.existsSync(previewPath) || !fs.existsSync(retinaPreviewPath)) {
                // Generate both main and @2x previews for mobile devices
                await generateMobilePreviews(imgPath, base);
            }
            if (!fs.existsSync(blurPreviewPath)) {
                await generateBlurredPreview(imgPath, blurPreviewPath);
            }
        }
    }
    // Remove orphan previews (both regular, @2x, and blur)
    for (const preview of previews) {
        // Handle regular previews (.jpg), @2x previews (@2x.jpg), and blur previews (_blur.jpg)
        let base;
        if (preview.endsWith('_blur.jpg')) {
            // For blur previews, extract the base name by removing '_blur.jpg'
            base = preview.replace(/_blur\.jpg$/, '');
        } else if (preview.endsWith('@2x.jpg')) {
            // For @2x previews, extract the base name by removing '@2x.jpg'
            base = preview.replace(/@2x\.jpg$/, '');
        } else if (preview.endsWith('.jpg')) {
            // For regular previews, extract the base name by removing '.jpg'
            base = preview.replace(/\.jpg$/, '');
        } else {
            // Skip non-jpg files
            continue;
        }
        
        // Check if the base image still exists
        if (!baseMap[base]) {
            const previewPath = path.join(previewsDir, preview);
            fs.unlinkSync(previewPath);
            console.log(`🧹 Removed orphan preview: ${preview}`);
        }
    }
}

async function getBalance() {
    try {
        const options = {
            hostname: 'api.novelai.net',
            port: 443,
            path: '/user/subscription',
            method: 'GET',
            headers: {
                "accept": "*/*",
                "accept-language": "en-US,en;q=0.9,en-GB;q=0.8",
                "authorization": `Bearer ${config.apiKey}`,
                "content-type": "application/json",
                "priority": "u=1, i",
                "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Microsoft Edge\";v=\"138\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"macOS\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "x-correlation-id": crypto.randomBytes(3).toString('hex').toUpperCase(),
                "x-initiated-at": new Date().toISOString(),
                "referer": "https://novelai.net/",
                "origin": "https://novelai.net",
                "sec-gpc": "1",
                "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0"
              }
        };
        
        const balanceData = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = [];
                res.on('data', chunk => data.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(data);
                    if (res.statusCode === 200) {
                        try {
                            const response = JSON.parse(buffer.toString());
                            resolve(response);
                        } catch (e) {
                            reject(new Error('Invalid JSON response from NovelAI API'));
                        }
                    } else {
                        try {
                            const errorResponse = JSON.parse(buffer.toString());
                            reject(new Error(`Balance API error: ${errorResponse.error || 'Unknown error'}`));
                        } catch (e) {
                            reject(new Error(`Balance API error: HTTP ${res.statusCode}`));
                        }
                    }
                });
            });
            
            req.on('error', error => {
                console.error('❌ Balance API request error:', error.message);
                reject(error);
            });
            
            req.end();
        });
        
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
    try {
        const options = {
            hostname: 'api.novelai.net',
            port: 443,
            path: '/user/data',
            method: 'GET',
            headers: {
                "accept": "*/*",
                "accept-language": "en-US,en;q=0.9,en-GB;q=0.8",
                "authorization": `Bearer ${config.apiKey}`,
                "content-type": "application/json",
                "priority": "u=1, i",
                "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Microsoft Edge\";v=\"138\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"macOS\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "x-correlation-id": crypto.randomBytes(3).toString('hex').toUpperCase(),
                "x-initiated-at": new Date().toISOString(),
                "Referer": "https://novelai.net/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0"
              }
        };
        const userData = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = [];
                res.on('data', chunk => data.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(data);
                    if (res.statusCode === 200) {
                        try {
                            const response = JSON.parse(buffer.toString());
                            resolve({
                                ok: true,
                                ...response,
                            });
                        } catch (e) {
                            reject(new Error('Invalid JSON response from NovelAI API'));
                        }
                    } else {
                        try {
                            const errorResponse = JSON.parse(buffer.toString());
                            console.error('❌ User data API error:', errorResponse);
                            resolve({
                                ok: false,
                                statusCode: res.statusCode,
                                error: errorResponse.message || 'Unknown error'
                            })
                        } catch (e) {
                            reject(new Error(`User data API error: HTTP ${res.statusCode}`));
                        }
                    }
                });
            });
            req.on('error', error => {
                console.error('❌ User data API request error:', error.message);
                reject(error);
            });
            req.end();
        });
        return {
            ok: true,
            ...userData
        };
    } catch (error) {
        console.error('User data error:', error);
        return {
            ok: false
        }
    }
}

app.use('/cache', (req, res, next) => {
    res.setHeader('Cache-Control', 'public, max-age=259200');
    next();
}, express.static(cacheDir));
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
app.use('/previews/:preview', (req, res) => {
    const previewFile = req.params.preview;
    const previewPath = path.join(previewsDir, previewFile);
    if (!fs.existsSync(previewPath)) {
        return res.status(404).json({ success: false, error: 'Preview not found' });
    }
    res.setHeader('Cache-Control', 'private, max-age=259200');
    res.sendFile(previewFile, { root: previewsDir });
});
app.use('/images/:filename', authMiddleware, (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(imagesDir, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'Image not found' });
    }
    
    // Set appropriate headers
    const ext = path.extname(filename).toLowerCase();
    res.setHeader('Content-Type', (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=259200');
    res.setHeader('Last-Modified', new Date(fs.statSync(filePath).mtime).toUTCString());
    res.setHeader('ETag', `"${fs.statSync(filePath).mtime.getTime()}"`);
    res.setHeader('Expires', '0');
    
    // Handle download request
    if (req.query.download === 'true') {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }
    
    // Send the file
    res.sendFile(filePath);
});

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

// Public routes (no authentication required)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cache manifest endpoint for service worker
app.options('/', (req, res) => {
    try {
        // Route-based HTML entries
        const routeFiles = [
            { url: '/', name: '/index.html' },
            { url: '/app', name: '/app.html' },
            { url: '/launch', name: '/launch.html' }
        ];

        // Build route file info from cache
        const routeEntries = routeFiles.map(route => {
            const file = globalCacheData.find(f => f.path === route.name) || {};
            return {
                url: route.url,
                name: route.name,
                hash: file.md5 || 'no-hash',
                size: file.size || 0,
                modified: file.modified || Date.now(),
                type: 'route'
            };
        });

        // Patterns to exclude
        const routeNames = routeFiles.map(f => f.name);
        const splashOrScreenshotPattern = /^\/static_images\/(apple-splash|android-screenshot)-.*\.(png|jpg|jpeg|webp)$/i;
        const unrelatedFilePattern = /\.(backup\..*|md|markdown|txt|log|DS_Store|swp|tmp|bak)$/i;

        // Filter static files
        const staticFiles = globalCacheData
            .filter(file =>
                !routeNames.includes(file.path) &&
                !splashOrScreenshotPattern.test(file.path) &&
                !unrelatedFilePattern.test(file.path)
            )
            .map(file => ({
                url: file.path,
                hash: file.md5,
                size: file.size,
                modified: file.modified
            }));

        res.json([...routeEntries, ...staticFiles]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Service Worker Rolling Key Endpoint (bypasses security checks)
app.options('/sw.js', (req, res) => {
    try {
        const ip = getRealIP(req);

        // Rate limit key requests to prevent abuse
        const rateLimit = checkRateLimit(ip);
        if (!rateLimit.allowed) {
            console.warn(`🚫 Rate limit exceeded for key request from IP ${ip}`);
            return res.status(429).json({
                error: 'Too many requests',
                code: 'RATE_LIMIT_EXCEEDED',
                retryAfter: Math.ceil((rateLimit.resetTime - Date.now()) / 1000)
            });
        }

        const key = getCurrentRollingKey();
        const expiresAt = rollingKeys.lastRotation + rollingKeys.rotationInterval;

        // Enhanced security headers
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'X-Key-Expires': expiresAt.toString(),
            'X-Key-Rotation-Interval': rollingKeys.rotationInterval.toString(),
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
            'Content-Security-Policy': "default-src 'none'",
            'Access-Control-Allow-Origin': req.headers.origin || '*',
            'Access-Control-Allow-Methods': 'OPTIONS',
            'Access-Control-Allow-Headers': 'X-Requested-With,Cache-Control,Pragma',
            'Access-Control-Max-Age': '86400' // 24 hours
        });

        // Validate key before sending
        if (!key || key.length !== rollingKeys.keyLength * 2) {
            console.error('❌ Invalid key generated for response');
            return res.status(500).json({ error: 'Internal server error' });
        }

        const responseData = {
            key: key,
            expiresAt: expiresAt,
            rotationInterval: rollingKeys.rotationInterval,
            serverTime: Date.now()
        };

        console.log(`🔑 Served rolling key to IP ${ip}, expires at ${new Date(expiresAt)}`);

        res.json(responseData);

    } catch (error) {
        console.error('❌ Error serving rolling key:', error);
        res.status(500).json({
            error: 'Internal server error',
            code: 'INTERNAL_ERROR'
        });
    }
});

// Unified message endpoint
app.post('/', express.json(), (req, res) => {
    const { action, data } = req.body;
    
    if (!action) { return res.status(400).json({ error: 'Action is required' }); }
    
    switch (action) {
        case 'login':
            const { pin } = data || {};
            if (!pin) {
                return res.status(400).json({ error: 'PIN code is required' });
            }
            
            const realIP = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || req.connection.remoteAddress;
            
            if (pin === config.loginPin) {
                // Clear any failed login attempts on successful login
                if (invalidURLAttempts.has(realIP)) {
                    invalidURLAttempts.delete(realIP);
                }
                
                req.session.authenticated = true;
                req.session.userType = 'admin';
                res.json({ success: true, message: 'Login successful', userType: 'admin' });
            } else if (pin === config.readOnlyPin) {
                // Clear any failed login attempts on successful login
                if (invalidURLAttempts.has(realIP)) {
                    invalidURLAttempts.delete(realIP);
                }
                
                req.session.authenticated = true;
                req.session.userType = 'readonly';
                res.json({ success: true, message: 'Login successful', userType: 'readonly' });
            } else {
                // Track failed login attempt
                const now = Date.now();
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
            generateLoginSpriteSheet();
            
            // Process telemetry data if provided
            if (data && typeof data === 'object') {
                const realIP = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || req.connection.remoteAddress;
                
                const telemetryInfo = {
                    timestamp: new Date().toISOString(),
                    ip: realIP,
                    userAgent: data.userAgent || 'Unknown',
                    platform: data.platform || 'Unknown',
                    language: data.language || 'Unknown',
                    screen: data.screen || {},
                    timezone: data.timezone || 'Unknown',
                    connection: data.connection || null,
                    serviceWorker: data.serviceWorker || {},
                    storage: data.storage || {},
                    features: data.features || {},
                    cookieEnabled: data.cookieEnabled || false,
                    onLine: data.onLine || false
                };
                
                console.log('📊 Telemetry ping received:', JSON.stringify(telemetryInfo, null, 2));
            }
            
            // Check if user is already authenticated
            const isAuthenticated = req.session && req.session.authenticated;
            const userType = req.session && req.session.userType;
            
            res.json({ 
                success: true, 
                message: 'Pong',
                authenticated: isAuthenticated,
                userType: userType || null,
                redirect: isAuthenticated ? '/app' : null
            });
            break;
        
        default:
            res.status(400).json({ success: false, error: 'Invalid action' });
    }
});

// Launch route (PWA entry point)
app.get('/launch', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'launch.html'));
});

// App route (requires authentication)
app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.options('/app', authMiddleware, (req, res) => {
    const serverVersion = '1.0.0'; // Update this when making breaking changes
    const message = 'A new version is available. Some features may not work correctly.';
    let response = { 
        success: true, 
        message: 'Session Valid', 
        timestamp: Date.now().valueOf(),
        serverVersion: serverVersion,
        versionMessage: message
    };
    if (config.enable_dev) {
        response.devPort = config.devPort || 65202;
        response.devHost = config.devHost || 'localhost';
    }
    res.json(response);
});

// Reload cache data endpoint (for development/deployment)
app.get('/admin/reload-cache', authMiddleware, async (req, res) => {
    try {
        // Check if user is admin (not readonly)
        if (req.session.userType !== 'admin') {
            return res.status(403).json({ 
                success: false, error: 'Admin access required to reload cache data' 
            });
        }

        console.log('🔄 Admin requested cache data reload...');
        
        // Force reload of cache data
        await initializeCacheData(true);
        
        // Get updated cache data
        const publicDir = path.join(__dirname, 'public');
        const updatedCacheData = await generateCacheData(publicDir);
        
        // Update global cache data
        globalCacheData = updatedCacheData;
        
        console.log(`✅ Cache data reloaded successfully: ${updatedCacheData.length} assets`);
        
        res.json({
            success: true,
            message: `Cache data reloaded successfully`,
            assetsCount: updatedCacheData.length,
            timestamp: Date.now().valueOf(),
            cacheData: updatedCacheData
        });
        
    } catch (error) {
        console.error('❌ Error reloading cache data:', error);
        res.status(500).json({ 
            error: 'Failed to reload cache data',
            details: error.message 
        });
    }
});

// Security status endpoint
app.get('/admin/security-status', authMiddleware, (req, res) => {
    try {
        // Check if user is admin (not readonly)
        if (req.session.userType !== 'admin') {
            return res.status(403).json({ 
                success: false, error: 'Admin access required to view security status' 
            });
        }

        const now = Date.now();
        const blockedIPsArray = Array.from(blockedIPs.entries()).map(([ip, data]) => ({
            ip,
            blockedAt: data.blockedAt,
            reason: data.reason,
            attempts: data.attempts,
            ageMinutes: Math.round((now - data.blockedAt) / (1000 * 60))
        }));

        const suspiciousIPsArray = Array.from(suspiciousIPs.entries()).map(([ip, data]) => ({
            ip,
            attempts: data.attempts,
            lastSeen: data.lastSeen,
            ageMinutes: Math.round((now - data.lastSeen) / (1000 * 60)),
            recentPatterns: data.patterns.slice(-5) // Last 5 patterns
        }));

        const invalidURLAttemptsArray = Array.from(invalidURLAttempts.entries()).map(([ip, data]) => ({
            ip,
            count: data.count,
            lastAttempt: data.lastAttempt,
            ageMinutes: Math.round((now - data.lastAttempt) / (1000 * 60))
        }));

        res.json({
            success: true,
            security: {
                blockedIPs: {
                    count: blockedIPs.size,
                    ips: blockedIPsArray.sort((a, b) => b.blockedAt - a.blockedAt)
                },
                suspiciousIPs: {
                    count: suspiciousIPs.size,
                    ips: suspiciousIPsArray.sort((a, b) => b.lastSeen - a.lastSeen)
                },
                invalidURLAttempts: {
                    count: invalidURLAttempts.size,
                    ips: invalidURLAttemptsArray.sort((a, b) => b.lastAttempt - a.lastAttempt)
                },
                config: SECURITY_CONFIG,
                stats: {
                    totalBlocked: blockedIPsArray.length,
                    totalSuspicious: suspiciousIPsArray.length,
                    totalInvalidAttempts: invalidURLAttemptsArray.length
                }
            },
            timestamp: now
        });

    } catch (error) {
        console.error('❌ Error fetching security status:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch security status',
            details: error.message 
        });
    }
});

// Unblock IP endpoint
app.post('/admin/unblock-ip', authMiddleware, (req, res) => {
    try {
        // Check if user is admin (not readonly)
        if (req.session.userType !== 'admin') {
            return res.status(403).json({ 
                success: false, error: 'Admin access required to unblock IPs' 
            });
        }

        const { ip } = req.body;
        if (!ip) {
            return res.status(400).json({ 
                success: false, error: 'IP address is required' 
            });
        }

        const wasBlocked = blockedIPs.has(ip);
        const wasSuspicious = suspiciousIPs.has(ip);
        const hadInvalidAttempts = invalidURLAttempts.has(ip);

        // Remove from all tracking maps
        blockedIPs.delete(ip);
        suspiciousIPs.delete(ip);
        invalidURLAttempts.delete(ip);

        console.log(`🔓 Admin unblocked IP: ${ip} (was blocked: ${wasBlocked}, was suspicious: ${wasSuspicious}, had invalid attempts: ${hadInvalidAttempts})`);

        res.json({
            success: true,
            message: `IP ${ip} has been unblocked`,
            wasBlocked,
            wasSuspicious,
            hadInvalidAttempts,
            timestamp: Date.now()
        });

    } catch (error) {
        console.error('❌ Error unblocking IP:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to unblock IP',
            details: error.message 
        });
    }
});

// Restart server endpoint (for development/deployment)
app.post('/admin/restart-server', authMiddleware, async (req, res) => {
    try {
        // Check if user is admin (not readonly)
        if (req.session.userType !== 'admin') {
            return res.status(403).json({ 
                success: false, error: 'Admin access required to restart server' 
            });
        }

        console.log('🔄 Admin requested server restart...');
        
        // Send response immediately before restarting
        res.json({
            success: true,
            message: 'Server restart initiated',
            timestamp: Date.now().valueOf()
        });
        
        // Small delay to ensure response is sent
        setTimeout(() => {
            console.log('🔄 Restarting server via PM2...');
            // Use PM2 to restart the server (ID 12 as mentioned in user rules)
            const { exec } = require('child_process');
            exec('timeout 5 pm2 restart 12', (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Error restarting server:', error);
                } else {
                    console.log('✅ Server restart command executed:', stdout);
                }
            });
        }, 100);
        
    } catch (error) {
        console.error('❌ Error initiating server restart:', error);
        // Response already sent, just log the error
    }
});

// Internal URL handler for service worker cached data
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

app.get('/preset/:uuid', authMiddleware, queueMiddleware, async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'realtime, no-cache, no-store, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        if (req.userType !== 'admin') {
            return res.status(403).json({ success: false, error: 'Non-Administrator Login: This operation is not allowed for non-administrator users' });
        }
        const currentPromptConfig = loadPromptConfig();
        // Find preset by UUID instead of name
        const p = Object.entries(currentPromptConfig.presets).find(([key, preset]) => preset.uuid === req.params.uuid).map(p => ({...p[1], name: p[0]}));
        if (!p) {
            return res.status(404).json({ success: false, error: 'Preset not found' });
        }
        
        console.log('🔍 Building options for preset:', p);
        const opts = await buildOptions(p, null, req.query);
        // Use target_workspace from preset if no workspace specified (for REST API calls)
        const workspaceId = req?.query?.workspace || p?.target_workspace || 'default';
        let result = await handleGeneration(opts, true, p.name || 'unknown', workspaceId);
        
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
        res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename');
        if (result && result.filename) {
            res.setHeader('X-Generated-Filename', result.filename);
        }
        res.setHeader('X-Preset-UUID', p.uuid);
        res.setHeader('X-Preset-Name', p.name);
        if (req.query.download === 'true') {
            const extension = optimize ? 'jpg' : 'png';
            const optimizedFilename = result.filename.replace('.png', `.${extension}`);
            res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
        }
        res.send(finalBuffer);
    } catch(e) {
        console.error('❌ Error occurred:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Image reroll endpoint
app.post('/reroll/:filename', authMiddleware, queueMiddleware, async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'realtime, no-cache, no-store, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        if (req.userType !== 'admin') {
            return res.status(403).json({ success: false, error: 'Non-Administrator Login: This operation is not allowed for non-administrator users' });
        }

        const filename = req.params.filename;
        const workspace = req.query.workspace || req.body.workspace || 'default';
        
        console.log(`🎲 Processing reroll request for filename: ${filename} in workspace: ${workspace}`);
        
        // Get image metadata
        const metadata = await getImageMetadata(filename, imagesDir);
        if (!metadata) {
            return res.status(404).json({ success: false, error: `No metadata found for image: ${filename}` });
        }

        // Call the reroll generation function
        const result = await handleRerollGeneration(
            metadata, 
            req.userType, 
            req.session.id, 
            workspace
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

// Initialize cache at startup
async function initializeCache() {
    console.log('🔄 Syncing previews...');
    await syncPreviews();

    // Initialize account data
    await initializeAccountData();
    
    // Initialize cache data
    await initializeCacheData(true);
    
    // Initialize chat database
    console.log('🔄 Initializing chat database...');
    initializeChatDatabase();
    
    // Initialize Director database
    console.log('🔄 Initializing Director database...');
    initializeDirectorDatabase();
    
    // Set up periodic refreshes
    setInterval(() => initializeAccountData(), ACCOUNT_DATA_REFRESH_INTERVAL); // Check every 4 hours
    setInterval(() => refreshBalance(), BALANCE_REFRESH_INTERVAL); // Check every 15 minutes
    setInterval(() => initializeCacheData(), CACHE_REFRESH_INTERVAL); // Check every 5 minutes
    setInterval(() => cleanupSecurityData(), SECURITY_CONFIG.CLEANUP_INTERVAL_MS); // Cleanup every hour
}

// Test bias adjustment endpoint
app.post('/test-bias-adjustment', async (req, res) => {
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

// Cache save scheduling function
function scheduleCacheSave() {
    if (tagSuggestionsCache.isDirty) {
        tagSuggestionsCache.markDirty();
    }
}

// Initialize WebSocket message handlers
const wsMessageHandlers = new WebSocketMessageHandlers({
    Model: Model,
    config: config,
    scheduleCacheSave,
    calculateCreditUsage,
    tagSuggestionsCache,
    accountData: () => accountData,
    accountBalance: () => accountBalance,
    getGlobalCacheData: () => globalCacheData,
    reloadCacheData: () => initializeCacheData(true)
});

// Development Bridge Server - will be initialized in the startup function
let devBridgeServer = null;

// Unix Socket Communication - will be initialized in the startup function
let unixSocketCommunication = null;

// Set context with all required functions
setImageGenContext({
    client,
    calculateCreditUsage: calculateCreditUsage,
    addToWorkspaceArray: addToWorkspaceArray,
    addReceiptMetadata: addReceiptMetadata,
    broadcastReceiptNotification: broadcastReceiptNotification,
    getActiveWorkspace: getActiveWorkspace
});

setUpscaleContext({
    config,
    addToWorkspaceArray: addToWorkspaceArray,
    getActiveWorkspace: getActiveWorkspace
});

// Export global cache data for websocket handlers
module.exports.globalCacheData = globalCacheData;

// Export security maps for websocket handlers
global.blockedIPs = blockedIPs;
global.suspiciousIPs = suspiciousIPs;
global.invalidURLAttempts = invalidURLAttempts;


// Clear temp downloads on server boot
function clearTempDownloads() {
    try {
        if (fs.existsSync(tempDownloadDir)) {
            const files = fs.readdirSync(tempDownloadDir);
            let deletedCount = 0;
            
            for (const file of files) {
                try {
                    const filePath = path.join(tempDownloadDir, file);
                    fs.unlinkSync(filePath);
                    deletedCount++;
                } catch (error) {
                    console.warn(`⚠️ Failed to delete temp file ${file}:`, error.message);
                }
            }
            
            if (deletedCount > 0) {
                console.log(`🧹 Cleared ${deletedCount} temp download files on server boot`);
            }
        }
    } catch (error) {
        console.warn('⚠️ Failed to clear temp downloads:', error.message);
    }
}

// Development Bridge API endpoints
if (config.enable_dev) {
    // Get development logs
    app.get('/admin/dev/logs', devAuthMiddleware, async (req, res) => {
        try {
            if (req.userType !== 'admin' && req.userType !== 'dev_admin') {
                return res.status(403).json({ success: false, error: 'Development admin access required' });
            }

            if (!devBridgeServer) {
                return res.status(404).json({ success: false, error: 'Development Bridge not enabled' });
            }

            const options = {
                type: req.query.type || null,
                level: req.query.level || null,
                clientId: req.query.clientId || null,
                limit: parseInt(req.query.limit) || 100,
                offset: parseInt(req.query.offset) || 0,
                startTime: req.query.startTime ? parseInt(req.query.startTime) : null,
                endTime: req.query.endTime ? parseInt(req.query.endTime) : null
            };

            const logs = await devBridgeServer.getDatabase().getLogs(options);
            const totalCount = await devBridgeServer.getDatabase().getLogCount(options);

            res.json({
                success: true,
                logs: logs,
                totalCount: totalCount,
                limit: options.limit,
                offset: options.offset,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('❌ Error fetching dev logs:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get network logs
    app.get('/admin/dev/network', devAuthMiddleware, async (req, res) => {
        try {
            if (req.userType !== 'admin' && req.userType !== 'dev_admin') {
                return res.status(403).json({ success: false, error: 'Development admin access required' });
            }

            if (!devBridgeServer) {
                return res.status(404).json({ success: false, error: 'Development Bridge not enabled' });
            }

            const options = {
                type: req.query.type || null,
                clientId: req.query.clientId || null,
                limit: parseInt(req.query.limit) || 100,
                offset: parseInt(req.query.offset) || 0,
                startTime: req.query.startTime ? parseInt(req.query.startTime) : null,
                endTime: req.query.endTime ? parseInt(req.query.endTime) : null
            };

            const logs = await devBridgeServer.getDatabase().getNetworkLogs(options);

            res.json({
                success: true,
                logs: logs,
                limit: options.limit,
                offset: options.offset,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('❌ Error fetching network logs:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get screenshots
    app.get('/admin/dev/screenshots', devAuthMiddleware, async (req, res) => {
        try {
            if (req.userType !== 'admin' && req.userType !== 'dev_admin') {
                return res.status(403).json({ success: false, error: 'Development admin access required' });
            }

            if (!devBridgeServer) {
                return res.status(404).json({ success: false, error: 'Development Bridge not enabled' });
            }

            const options = {
                clientId: req.query.clientId || null,
                limit: parseInt(req.query.limit) || 50,
                offset: parseInt(req.query.offset) || 0,
                startTime: req.query.startTime ? parseInt(req.query.startTime) : null,
                endTime: req.query.endTime ? parseInt(req.query.endTime) : null
            };

            const screenshots = await devBridgeServer.getDatabase().getScreenshots(options);

            res.json({
                success: true,
                screenshots: screenshots,
                limit: options.limit,
                offset: options.offset,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('❌ Error fetching screenshots:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get code executions
    app.get('/admin/dev/executions', devAuthMiddleware, async (req, res) => {
        try {
            if (req.userType !== 'admin' && req.userType !== 'dev_admin') {
                return res.status(403).json({ success: false, error: 'Development admin access required' });
            }

            if (!devBridgeServer) {
                return res.status(404).json({ success: false, error: 'Development Bridge not enabled' });
            }

            const options = {
                clientId: req.query.clientId || null,
                limit: parseInt(req.query.limit) || 100,
                offset: parseInt(req.query.offset) || 0,
                startTime: req.query.startTime ? parseInt(req.query.startTime) : null,
                endTime: req.query.endTime ? parseInt(req.query.endTime) : null
            };

            const executions = await devBridgeServer.getDatabase().getCodeExecutions(options);

            res.json({
                success: true,
                executions: executions,
                limit: options.limit,
                offset: options.offset,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('❌ Error fetching code executions:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get connected clients
    app.get('/admin/dev/clients', devAuthMiddleware, (req, res) => {
        try {
            if (req.userType !== 'admin' && req.userType !== 'dev_admin') {
                return res.status(403).json({ success: false, error: 'Development admin access required' });
            }

            if (!devBridgeServer) {
                return res.status(404).json({ success: false, error: 'Development Bridge not enabled' });
            }

            const clients = devBridgeServer.getClientList();
            const activeClient = devBridgeServer.getActiveClient();
            const masterClient = devBridgeServer.getMasterClient();

            res.json({
                success: true,
                clients: clients,
                activeClient: activeClient ? {
                    id: activeClient.id,
                    ip: activeClient.ip,
                    userAgent: activeClient.userAgent,
                    connectedAt: activeClient.connectedAt,
                    sessionId: activeClient.sessionId,
                    url: activeClient.url,
                    isMaster: activeClient.isMaster
                } : null,
                masterClient: masterClient ? {
                    id: masterClient.id,
                    ip: masterClient.ip,
                    userAgent: masterClient.userAgent,
                    connectedAt: masterClient.connectedAt,
                    sessionId: masterClient.sessionId,
                    url: masterClient.url
                } : null,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('❌ Error fetching clients:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Send command to active client
    app.post('/admin/dev/command', devAuthMiddleware, (req, res) => {
        try {
            if (req.userType !== 'admin' && req.userType !== 'dev_admin') {
                return res.status(403).json({ success: false, error: 'Development admin access required' });
            }

            if (!devBridgeServer) {
                return res.status(404).json({ success: false, error: 'Development Bridge not enabled' });
            }

            const { type, data, clientId } = req.body;
            const targetClientId = clientId || devBridgeServer.activeClient;

            if (!targetClientId) {
                return res.status(400).json({ success: false, error: 'No active client or client ID specified' });
            }

            const message = {
                type: type,
                data: data,
                timestamp: Date.now()
            };

            devBridgeServer.sendToClient(targetClientId, message);

            res.json({
                success: true,
                message: 'Command sent to client',
                clientId: targetClientId,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('❌ Error sending command:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
}

// Unix Socket Message Handler
async function handleUnixSocketMessage(message, socket) {
    const { type, data, id } = message;
    
    try {
        let result;
        
        switch (type) {
            case 'get_dev_logs':
                result = await handleGetDevLogs(data);
                break;
            case 'get_network_logs':
                result = await handleGetNetworkLogs(data);
                break;
            case 'get_screenshots':
                result = await handleGetScreenshots(data);
                break;
            case 'get_code_executions':
                result = await handleGetCodeExecutions(data);
                break;
            case 'get_connected_clients':
                result = await handleGetConnectedClients();
                break;
            case 'take_screenshot':
                result = await handleTakeScreenshot(data);
                break;
            case 'execute_javascript':
                result = await handleExecuteJavaScript(data);
                break;
            case 'query_elements':
                result = await handleQueryElements(data);
                break;
            case 'trigger_event':
                result = await handleTriggerEvent(data);
                break;
            case 'send_command':
                result = await handleSendCommand(data);
                break;
            default:
                throw new Error(`Unknown Unix socket message type: ${type}`);
        }
        
        // Send response back to client
        unixSocketCommunication.sendResponseToClient(socket, id, result, null, true);
        
    } catch (error) {
        console.error(`❌ Error handling Unix socket message ${type}:`, error);
        
        // Send error response back to client
        unixSocketCommunication.sendResponseToClient(socket, id, null, error.message, false);
    }
}

// Unix Socket Handler Functions
async function handleGetDevLogs(options) {
    if (!devBridgeServer) {
        throw new Error('Development Bridge not enabled');
    }
    
    const logs = await devBridgeServer.getDatabase().getLogs(options);
    const totalCount = await devBridgeServer.getDatabase().getLogCount(options);
    
    return { logs, totalCount };
}

async function handleGetNetworkLogs(options) {
    if (!devBridgeServer) {
        throw new Error('Development Bridge not enabled');
    }
    
    const logs = await devBridgeServer.getDatabase().getNetworkLogs(options);
    return { logs };
}

async function handleGetScreenshots(options) {
    if (!devBridgeServer) {
        throw new Error('Development Bridge not enabled');
    }
    
    const screenshots = await devBridgeServer.getDatabase().getScreenshots(options);
    return { screenshots };
}

async function handleGetCodeExecutions(options) {
    if (!devBridgeServer) {
        throw new Error('Development Bridge not enabled');
    }
    
    const executions = await devBridgeServer.getDatabase().getCodeExecutions(options);
    return { executions };
}

async function handleGetConnectedClients() {
    if (!devBridgeServer) {
        throw new Error('Development Bridge not enabled');
    }
    
    const clients = devBridgeServer.getClientList();
    const activeClient = devBridgeServer.getActiveClient();
    const masterClient = devBridgeServer.getMasterClient();
    
    return { clients, activeClient, masterClient };
}

async function handleTakeScreenshot(data) {
    if (!devBridgeServer) {
        throw new Error('Development Bridge not enabled');
    }
    
    const { selector, clientId } = data;
    const targetClientId = clientId || devBridgeServer.activeClient;
    
    if (!targetClientId) {
        throw new Error('No active client or client ID specified');
    }
    
    const message = {
        type: 'screenshot_request',
        selector,
        timestamp: Date.now()
    };
    
    devBridgeServer.sendToClient(targetClientId, message);
    
    return {
        message: 'Screenshot command sent to client',
        clientId: targetClientId,
        timestamp: Date.now()
    };
}

async function handleExecuteJavaScript(data) {
    if (!devBridgeServer) {
        throw new Error('Development Bridge not enabled');
    }
    
    const { code, clientId } = data;
    const targetClientId = clientId || devBridgeServer.activeClient;
    
    if (!targetClientId) {
        throw new Error('No active client or client ID specified');
    }
    
    const message = {
        type: 'execute_code_request',
        code,
        timestamp: Date.now()
    };
    
    devBridgeServer.sendToClient(targetClientId, message);
    
    return {
        message: 'JavaScript execution command sent to client',
        clientId: targetClientId,
        timestamp: Date.now()
    };
}

async function handleQueryElements(data) {
    if (!devBridgeServer) {
        throw new Error('Development Bridge not enabled');
    }
    
    const { selector, clientId } = data;
    const targetClientId = clientId || devBridgeServer.activeClient;
    
    if (!targetClientId) {
        throw new Error('No active client or client ID specified');
    }
    
    const message = {
        type: 'query_elements_request',
        selector,
        timestamp: Date.now()
    };
    
    devBridgeServer.sendToClient(targetClientId, message);
    
    return {
        message: 'Element query command sent to client',
        clientId: targetClientId,
        timestamp: Date.now()
    };
}

async function handleTriggerEvent(data) {
    if (!devBridgeServer) {
        throw new Error('Development Bridge not enabled');
    }
    
    const { selector, eventType, eventData, clientId } = data;
    const targetClientId = clientId || devBridgeServer.activeClient;
    
    if (!targetClientId) {
        throw new Error('No active client or client ID specified');
    }
    
    const message = {
        type: 'trigger_event_request',
        selector,
        eventType,
        eventData,
        timestamp: Date.now()
    };
    
    devBridgeServer.sendToClient(targetClientId, message);
    
    return {
        message: 'Event trigger command sent to client',
        clientId: targetClientId,
        timestamp: Date.now()
    };
}

async function handleSendCommand(data) {
    if (!devBridgeServer) {
        throw new Error('Development Bridge not enabled');
    }
    
    const { type, data: commandData, clientId } = data;
    const targetClientId = clientId || devBridgeServer.activeClient;
    
    if (!targetClientId) {
        throw new Error('No active client or client ID specified');
    }
    
    const message = {
        type: type,
        data: commandData,
        timestamp: Date.now()
    };
    
    devBridgeServer.sendToClient(targetClientId, message);
    
    return {
        message: 'Custom command sent to client',
        clientId: targetClientId,
        timestamp: Date.now()
    };
}

// Start server
(async () => {
    console.log('🚀 Initializing cache... (Server unavailable until cache is initialized)');
    await initializeCache();
    
    // Clear temp downloads on startup
    clearTempDownloads();
    
    // Generate login sprite sheet on startup
    try {
        console.log('🎨 Generating login sprite sheet on startup...');
        await generateLoginSpriteSheet();
    } catch (error) {
        console.error('❌ Failed to generate login sprite sheet on startup:', error.message);
        console.log('⚠️ Server will continue without sprite sheet, it will be generated on first login access');
    }
    
    // Initialize Development Bridge Server FIRST (before main WebSocket server)
    if (config.enable_dev) {
        const DevBridgeServer = require('./modules/devBridge');
        devBridgeServer = new DevBridgeServer(config);
        console.log('🔧 Development Bridge enabled');
        
                    // Initialize Unix Socket Communication
            unixSocketCommunication = new UnixSocketCommunication({
                socketPath: config.unixSocketPath
            });
            
            // Setup Unix socket message handlers
            unixSocketCommunication.on('message', async (message, socket) => {
                try {
                    await handleUnixSocketMessage(message, socket);
                } catch (error) {
                    console.error('❌ Error handling Unix socket message:', error);
                    // Send error response back to client
                    unixSocketCommunication.sendResponseToClient(socket, message.id, null, error.message, false);
                }
            });
            
            // Start Unix socket server
            await unixSocketCommunication.startServer();
            console.log('🔗 Unix Socket Communication enabled');
    }

    // Initialize WebSocket server with session store and message handler
    const wsServer = new WebSocketServer(server, sessionStore, async (ws, message, clientInfo, wsServer) => {
        await wsMessageHandlers.handleMessage(ws, message, clientInfo, wsServer);
    });
    
    setGlobalWsServer(wsServer);
    
    // Start ping interval with server data callback
    wsServer.startPingInterval(() => {
        return {
            balance: accountBalance,
            queue_status: getQueueStatus(),
            image_count: imageCounter.getCount(),
            server_time: Date.now().valueOf()
        };
    });

    // Start queue status broadcasting
    wsServer.startQueueStatusInterval();

    // Initialize rolling key system for service worker authentication
    initializeRollingKeySystem();

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

    server.listen(config.port, () => {
        console.log(`🚀 Server running on port ${config.port}`);
        console.log(`📊 Performance monitoring: GET /admin/performance`);
        console.log(`🔒 Gzip compression enabled`);
        console.log(`🛡️ Security headers enabled`);
    });
})();

// Graceful shutdown handling
function gracefulShutdown() {
    console.log('🛑 Graceful shutdown initiated...');
    
    // Get WebSocket server from global reference
    const wsServer = getGlobalWsServer();
    if (wsServer) {
        wsServer.stopPingInterval();
        wsServer.stopQueueStatusInterval();
    }
    
    // Close dev bridge server if it exists
    if (devBridgeServer) {
        console.log('🔧 Closing dev bridge server...');
        devBridgeServer.close();
    }
    
    // Close Unix socket communication if it exists
    if (unixSocketCommunication) {
        console.log('🔗 Closing Unix socket communication...');
        unixSocketCommunication.close();
    }
    
    // Save tag cache immediately if dirty
    if (tagSuggestionsCache.isDirty) {
        console.log('💾 Saving tag cache before shutdown...');
        tagSuggestionsCache.saveCache();
    }
    
    process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('uncaughtException', (e) => {
    console.log(e);
});
process.on('unhandledRejection', (e) => {
    console.log(e);
});