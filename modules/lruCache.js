/**
 * LRU Cache Module
 * Provides LRU (Least Recently Used) cache implementation with size limits and expiration support
 */

/**
 * LRU Cache with size limits and expiration support
 */
class LRUCache {
    constructor(maxSize = 1000) {
        this.maxSize = maxSize;
        this.cache = new Map();
        this.accessOrder = new Map(); // For LRU tracking
        this.accessCounter = 0;
    }

    get(key) {
        if (this.cache.has(key)) {
            // Update access time for LRU
            this.accessOrder.set(key, ++this.accessCounter);
            return this.cache.get(key);
        }
        return undefined;
    }

    set(key, value) {
        // Update access time
        this.accessOrder.set(key, ++this.accessCounter);

        // If key exists, just update value
        if (this.cache.has(key)) {
            this.cache.set(key, value);
            return;
        }

        // If at capacity after adding this item, remove least recently used item
        if (this.cache.size >= this.maxSize) {
            let oldestKey = null;
            let oldestAccess = Infinity;

            // Find the key with the smallest (oldest) access time
            for (const [k, accessTime] of this.accessOrder) {
                if (accessTime < oldestAccess) {
                    oldestAccess = accessTime;
                    oldestKey = k;
                }
            }

            if (oldestKey !== null) {
                this.cache.delete(oldestKey);
                this.accessOrder.delete(oldestKey);
                console.log(`🗑️ Cache eviction: removed ${oldestKey} due to LRU (access time: ${oldestAccess})`);
            }
        }

        this.cache.set(key, value);
    }

    clear() {
        this.cache.clear();
        this.accessOrder.clear();
        this.accessCounter = 0;
    }

    size() {
        return this.cache.size;
    }

    /**
     * Periodic cleanup of expired entries
     * @param {number} maxAge - Maximum age in milliseconds
     */
    cleanupExpired(maxAge) {
        const now = Date.now();
        const keysToDelete = [];

        for (const [key, value] of this.cache) {
            if (value.timestamp && (now - value.timestamp) > maxAge) {
                keysToDelete.push(key);
            }
        }

        keysToDelete.forEach(key => {
            this.cache.delete(key);
            this.accessOrder.delete(key);
        });

        if (keysToDelete.length > 0) {
            console.log(`🧹 Cache cleanup: removed ${keysToDelete.length} expired entries`);
        }
    }
}

module.exports = {
    LRUCache
};

