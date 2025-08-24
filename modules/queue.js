const WINDOW_5_MIN = 5 * 60 * 1000;
const WINDOW_15_MIN = 15 * 60 * 1000;
const MIN_INTERVAL = 15 * 1000;
const MAX_5MIN = 10;
const MAX_15MIN = 20;

// Store timestamps of requests
let requestTimestamps = [];
let lastRequestEnd = 0;
let isProcessing = false;

// Track previous status for change detection
let previousStatus = null;

function pruneOld(now = Date.now()) {
    requestTimestamps = requestTimestamps.filter(ts => now - ts < WINDOW_15_MIN);
}

function getStatus() {
    const now = Date.now();
    pruneOld(now);
    const lastTs = requestTimestamps.length ? requestTimestamps[requestTimestamps.length - 1] : 0;
    const sinceLast = now - lastTs;
    const in5min = requestTimestamps.filter(ts => now - ts < WINDOW_5_MIN).length;
    const in15min = requestTimestamps.length;
    const canRequest = !isProcessing && (now - lastRequestEnd > MIN_INTERVAL) && in5min < MAX_5MIN && in15min < MAX_15MIN;
    // Value: 0 = safe, 1 = warning, 2 = limit
    let value = 0;
    if (!canRequest) value = 2;
    else if (in5min >= MAX_5MIN - 2 || in15min >= MAX_15MIN - 5 || (now - lastRequestEnd < MIN_INTERVAL + 5000)) value = 1;
    
    const status = {
        canRequest,
        value,
        in5min,
        in15min,
        sinceLast,
        nextAllowed: Math.max(0, MIN_INTERVAL - (now - lastRequestEnd)),
    };
    
    return status;
}

function hasStatusChanged() {
    const currentStatus = getStatus();
    
    // If no previous status, consider it changed
    if (!previousStatus) {
        previousStatus = { ...currentStatus };
        return true;
    }
    
    // Check if key properties have changed
    const changed = 
        previousStatus.canRequest !== currentStatus.canRequest ||
        previousStatus.value !== currentStatus.value ||
        previousStatus.in5min !== currentStatus.in5min ||
        previousStatus.in15min !== currentStatus.in15min;
    
    if (changed) {
        previousStatus = { ...currentStatus };
    }
    
    return changed;
}

async function queueMiddleware(req, res, next) {
    const now = Date.now();
    pruneOld(now);
    if (isProcessing) {
        return res.status(429).json({ error: 'Another request is in progress. Please wait.' });
    }
    if (now - lastRequestEnd < MIN_INTERVAL) {
        return res.status(429).json({ error: `You must wait ${Math.ceil((MIN_INTERVAL - (now - lastRequestEnd))/1000)}s between requests.` });
    }
    const in5min = requestTimestamps.filter(ts => now - ts < WINDOW_5_MIN).length;
    const in15min = requestTimestamps.length;
    if (in5min >= MAX_5MIN) {
        return res.status(429).json({ error: 'Too many requests in 5 minutes.' });
    }
    if (in15min >= MAX_15MIN) {
        return res.status(429).json({ error: 'Too many requests in 15 minutes.' });
    }
    isProcessing = true;
    try {
        await next();
        requestTimestamps.push(Date.now());
        lastRequestEnd = Date.now();
        
        // Broadcast queue status immediately after state change
        broadcastQueueStatusImmediate();
    } finally {
        isProcessing = false;
        
        // Broadcast queue status immediately after processing ends
        broadcastQueueStatusImmediate();
    }
}

// Method to manually broadcast queue status (for immediate updates)
function broadcastQueueStatusImmediate() {
    try {
        const { getGlobalWsServer } = require('./websocket');
        const wsServer = getGlobalWsServer();
        if (wsServer && typeof wsServer.broadcastQueueStatusImmediate === 'function') {
            wsServer.broadcastQueueStatusImmediate();
            return true;
        }
    } catch (error) {
        // Silently fail if WebSocket server is not available
        console.warn('⚠️ Failed to broadcast queue status update:', error.message);
    }
    return false;
}

// Check if queue is currently blocked
function isQueueBlocked() {
    const status = getStatus();
    return !status.canRequest;
}

// Get detailed queue status with blocking reasons
function getDetailedStatus() {
    const status = getStatus();
    const now = Date.now();
    
    const reasons = [];
    if (isProcessing) {
        reasons.push('Another request is in progress');
    }
    if (now - lastRequestEnd < MIN_INTERVAL) {
        const waitTime = Math.ceil((MIN_INTERVAL - (now - lastRequestEnd))/1000);
        reasons.push(`Must wait ${waitTime}s between requests`);
    }
    if (status.in5min >= MAX_5MIN) {
        reasons.push(`Too many requests in 5 minutes (${status.in5min}/${MAX_5MIN})`);
    }
    if (status.in15min >= MAX_15MIN) {
        reasons.push(`Too many requests in 15 minutes (${status.in15min}/${MAX_15MIN})`);
    }
    
    return {
        ...status,
        isBlocked: !status.canRequest,
        blockingReasons: reasons,
        nextAllowedIn: Math.max(0, MIN_INTERVAL - (now - lastRequestEnd))
    };
}

module.exports = {
    queueMiddleware,
    getStatus,
    hasStatusChanged,
    broadcastQueueStatusImmediate,
    isQueueBlocked,
    getDetailedStatus,
}; 