// Custom rate limiting queue system
class CustomQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.lastRequestTime = 0;
        this.requestCount = 0;
        this.windowStartTime = Date.now();
        this.minDelay = 5000; // 5 seconds minimum between requests
        this.maxDelay = 15000; // 15 seconds maximum delay
        this.windowResetTime = 2 * 60 * 1000; // 2 minutes
        this.excludedEndpoints = ['/options', '/'];
    }

    // Check if endpoint should be excluded from rate limiting
    isExcluded(path) {
        return this.excludedEndpoints.some(endpoint => path === endpoint || path.startsWith(endpoint));
    }

    // Calculate current delay based on request count
    getCurrentDelay() {
        if (this.requestCount <= 3) {
            return this.minDelay;
        }
        
        // Increase delay for each request after the first 3
        const additionalDelay = Math.min((this.requestCount - 3) * 2000, this.maxDelay - this.minDelay);
        return this.minDelay + additionalDelay;
    }

    // Reset window if 2 minutes have passed
    resetWindowIfNeeded() {
        const now = Date.now();
        if (now - this.windowStartTime >= this.windowResetTime) {
            this.requestCount = 0;
            this.windowStartTime = now;
            console.log('🔄 Rate limit window reset');
        }
    }

    // Add request to queue and process
    async enqueue(req, res, next) {
        // Skip rate limiting for excluded endpoints
        if (this.isExcluded(req.path)) {
            return next();
        }

        this.resetWindowIfNeeded();
        
        return new Promise((resolve, reject) => {
            const queueItem = {
                req,
                res,
                next,
                resolve,
                reject,
                enqueueTime: Date.now()
            };

            this.queue.push(queueItem);
            this.processQueue();
        });
    }

    // Process the queue
    async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            const now = Date.now();
            
            // Calculate delay needed
            const timeSinceLastRequest = now - this.lastRequestTime;
            const requiredDelay = this.getCurrentDelay();
            const actualDelay = Math.max(0, requiredDelay - timeSinceLastRequest);

            if (actualDelay > 0) {
                const queueTime = now - item.enqueueTime;
                if (queueTime > 0) {
                    console.log(`⏳ Queued for ${queueTime}ms`);
                }
                console.log(`⏱️ Waiting ${actualDelay}ms (request #${this.requestCount + 1})`);
                await new Promise(resolve => setTimeout(resolve, actualDelay));
            }

            // Update tracking
            this.lastRequestTime = Date.now();
            this.requestCount++;

            // Execute the request
            try {
                await item.next(item.req, item.res);
                item.resolve();
            } catch (error) {
                console.log(`❌ Request failed: ${error.message}`);
                item.reject(error);
            }
        }

        this.processing = false;
    }
}

// Create global queue instance
const requestQueue = new CustomQueue();

// Queue middleware (runs before logging)
const queueMiddleware = (req, res, next) => {
    requestQueue.enqueue(req, res, next);
};

module.exports = {
    CustomQueue,
    requestQueue,
    queueMiddleware
}; 