const WINDOW_5_MIN = 5 * 60 * 1000;
const WINDOW_15_MIN = 15 * 60 * 1000;
const MIN_INTERVAL = 15 * 1000;
const MAX_5MIN = 10;
const MAX_15MIN = 20;

// Store timestamps of requests
let requestTimestamps = [];
let lastRequestEnd = 0;
let isProcessing = false;

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
    return {
        canRequest,
        value,
        in5min,
        in15min,
        sinceLast,
        nextAllowed: Math.max(0, MIN_INTERVAL - (now - lastRequestEnd)),
    };
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
    } finally {
        isProcessing = false;
    }
}

module.exports = {
    queueMiddleware,
    getStatus,
}; 