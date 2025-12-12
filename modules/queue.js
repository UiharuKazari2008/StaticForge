const WINDOW_5_MIN = 5 * 60 * 1000;
const WINDOW_15_MIN = 15 * 60 * 1000;
const MIN_INTERVAL = 15 * 1000;
const MAX_5MIN = 10;
const MAX_15MIN = 20;

class Queue {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('Queue requires globalResources instance and shoudl only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
        
        // Store timestamps of requests
        this.requestTimestamps = [];
        this.lastRequestEnd = 0;
        this.isProcessing = false;
        
        // Track previous status for change detection
        this.previousStatus = null;
    }

    pruneOld(now = Date.now()) {
        this.requestTimestamps = this.requestTimestamps.filter(ts => now - ts < WINDOW_15_MIN);
    }

    getStatus() {
        const now = Date.now();
        this.pruneOld(now);
        const lastTs = this.requestTimestamps.length ? this.requestTimestamps[this.requestTimestamps.length - 1] : 0;
        const sinceLast = now - lastTs;
        const in5min = this.requestTimestamps.filter(ts => now - ts < WINDOW_5_MIN).length;
        const in15min = this.requestTimestamps.length;
        const canRequest = !this.isProcessing && (now - this.lastRequestEnd > MIN_INTERVAL) && in5min < MAX_5MIN && in15min < MAX_15MIN;
        // Value: 0 = safe, 1 = warning, 2 = limit
        let value = 0;
        if (!canRequest) value = 2;
        else if (in5min >= MAX_5MIN - 2 || in15min >= MAX_15MIN - 5 || (now - this.lastRequestEnd < MIN_INTERVAL + 5000)) value = 1;
        
        const status = {
            canRequest,
            value,
            in5min,
            in15min,
            sinceLast,
            nextAllowed: Math.max(0, MIN_INTERVAL - (now - this.lastRequestEnd)),
        };
        
        return status;
    }

    hasStatusChanged() {
        const currentStatus = this.getStatus();
        
        // If no previous status, consider it changed
        if (!this.previousStatus) {
            this.previousStatus = { ...currentStatus };
            return true;
        }
        
        // Check if key properties have changed
        const changed = 
            this.previousStatus.canRequest !== currentStatus.canRequest ||
            this.previousStatus.value !== currentStatus.value ||
            this.previousStatus.in5min !== currentStatus.in5min ||
            this.previousStatus.in15min !== currentStatus.in15min;
        
        if (changed) {
            this.previousStatus = { ...currentStatus };
        }
        
        return changed;
    }

    async queueMiddleware(req, res, next) {
        const now = Date.now();
        this.pruneOld(now);
        if (this.isProcessing) {
            return res.status(429).json({ error: 'Another request is in progress. Please wait.' });
        }
        if (now - this.lastRequestEnd < MIN_INTERVAL) {
            return res.status(429).json({ error: `You must wait ${Math.ceil((MIN_INTERVAL - (now - this.lastRequestEnd))/1000)}s between requests.` });
        }
        const in5min = this.requestTimestamps.filter(ts => now - ts < WINDOW_5_MIN).length;
        const in15min = this.requestTimestamps.length;
        if (in5min >= MAX_5MIN) {
            return res.status(429).json({ error: 'Too many requests in 5 minutes.' });
        }
        if (in15min >= MAX_15MIN) {
            return res.status(429).json({ error: 'Too many requests in 15 minutes.' });
        }
        this.isProcessing = true;
        try {
            await next();
            this.requestTimestamps.push(Date.now());
            this.lastRequestEnd = Date.now();
            
            // Broadcast queue status immediately after state change
            const plumbing = this.globalResources.getDataPlumbing();
            plumbing.publish('ws:broadcast:queueStatus', null);
        } finally {
            this.isProcessing = false;
            
            // Broadcast queue status immediately after processing ends
            const plumbing = this.globalResources.getDataPlumbing();
            plumbing.publish('ws:broadcast:queueStatus', null);
        }
    }

    // Check if queue is currently blocked
    isQueueBlocked() {
        const status = this.getStatus();
        return !status.canRequest;
    }

    // Get detailed queue status with blocking reasons
    getDetailedStatus() {
        const status = this.getStatus();
        const now = Date.now();
        
        const reasons = [];
        if (this.isProcessing) {
            reasons.push('Another request is in progress');
        }
        if (now - this.lastRequestEnd < MIN_INTERVAL) {
            const waitTime = Math.ceil((MIN_INTERVAL - (now - this.lastRequestEnd))/1000);
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
            nextAllowedIn: Math.max(0, MIN_INTERVAL - (now - this.lastRequestEnd))
        };
    }
}

module.exports = Queue;
