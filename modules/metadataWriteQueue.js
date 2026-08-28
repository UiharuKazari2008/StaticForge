/**
 * FIFO write buffer for metadata.db.
 * Stages image metadata and gallery ownership in memory immediately;
 * SQL persistence runs sequentially in the background.
 * Hot entries stay readable for a short window after SQL flush (and on access).
 */

const HOT_RETENTION_MS = Math.max(
    30000,
    parseInt(process.env.METADATA_HOT_RETENTION_MS || '120000', 10) || 120000
);

const metadataWriteQueue = {
    queue: [],
    backgroundQueue: [],
    draining: false,
    drainPromise: null,
    hotImages: new Map(),
    hotGalleryOwnership: new Map(),
    removedGalleryOwnership: new Set(),

    galleryKey(filename, workspaceId, bucket) {
        return `${filename}\0${workspaceId}\0${bucket || 'files'}`;
    },

    stageImage(filename, record) {
        if (!filename || !record) return;
        const existing = this.hotImages.get(filename);
        this.hotImages.set(filename, {
            record: {
                ...record,
                receipt: Array.isArray(record.receipt) ? [...record.receipt] : [],
                upscaled: Boolean(record.upscaled)
            },
            retainUntil: existing?.retainUntil ?? null
        });
    },

    markImagePersisted(filename) {
        const entry = this.hotImages.get(filename);
        if (!entry) return;
        entry.retainUntil = Date.now() + HOT_RETENTION_MS;
    },

    touchImageRetention(filename) {
        const entry = this.hotImages.get(filename);
        if (!entry || entry.retainUntil == null) return;
        if (Date.now() < entry.retainUntil) {
            entry.retainUntil = Date.now() + HOT_RETENTION_MS;
        }
    },

    evictExpiredImage(filename) {
        const entry = this.hotImages.get(filename);
        if (!entry) return;
        if (entry.retainUntil != null && Date.now() >= entry.retainUntil) {
            this.hotImages.delete(filename);
        }
    },

    getHotImage(filename) {
        this.evictExpiredImage(filename);
        const entry = this.hotImages.get(filename);
        if (!entry) return null;

        this.touchImageRetention(filename);
        return this.formatHotRecord(entry.record);
    },

    formatHotRecord(record) {
        if (!record) return null;

        let metadata = record.metadata;
        if (typeof metadata === 'string') {
            try {
                metadata = JSON.parse(metadata);
            } catch {
                metadata = {};
            }
        }

        return {
            ...record,
            metadata: metadata || {},
            receipt: Array.isArray(record.receipt) ? [...record.receipt] : [],
            upscaled: Boolean(record.upscaled)
        };
    },

    /**
     * Batch read from hot cache for a filename list (FIFO / post-write retention).
     * Scans the small hot map instead of every requested filename.
     */
    getHotImagesBatch(filenames) {
        const out = {};
        if (!Array.isArray(filenames) || filenames.length === 0 || this.hotImages.size === 0) {
            return out;
        }

        const wanted = new Set(filenames);
        for (const [filename, entry] of this.hotImages) {
            if (!wanted.has(filename)) continue;
            this.evictExpiredImage(filename);
            if (!this.hotImages.has(filename)) continue;
            this.touchImageRetention(filename);
            const hot = this.formatHotRecord(entry.record);
            if (hot) out[filename] = hot;
        }

        return out;
    },

    getActiveHotFilenames() {
        const names = [];
        for (const filename of this.hotImages.keys()) {
            this.evictExpiredImage(filename);
            if (this.hotImages.has(filename)) {
                names.push(filename);
            }
        }
        return names;
    },

    hasHotImage(filename) {
        this.evictExpiredImage(filename);
        return this.hotImages.has(filename);
    },

    removeHotImage(filename) {
        this.hotImages.delete(filename);
    },

    stageGalleryOwnership(filename, workspaceId, bucket = 'files') {
        if (!filename || !workspaceId) return;
        const key = this.galleryKey(filename, workspaceId, bucket);
        this.removedGalleryOwnership.delete(key);
        const existing = this.hotGalleryOwnership.get(key);
        this.hotGalleryOwnership.set(key, {
            row: {
                filename,
                workspaceId,
                bucket: bucket || 'files',
                created_at: existing?.row?.created_at || Math.floor(Date.now() / 1000)
            },
            retainUntil: existing?.retainUntil ?? null
        });
    },

    markGalleryOwnershipPersisted(filename, workspaceId, bucket = 'files') {
        const key = this.galleryKey(filename, workspaceId, bucket);
        const entry = this.hotGalleryOwnership.get(key);
        if (!entry) return;
        entry.retainUntil = Date.now() + HOT_RETENTION_MS;
    },

    touchGalleryOwnershipRetention(filename) {
        for (const entry of this.hotGalleryOwnership.values()) {
            if (entry.row.filename !== filename) continue;
            if (entry.retainUntil == null) continue;
            if (Date.now() < entry.retainUntil) {
                entry.retainUntil = Date.now() + HOT_RETENTION_MS;
            }
        }
    },

    evictExpiredGalleryOwnership(key) {
        const entry = this.hotGalleryOwnership.get(key);
        if (!entry) return;
        if (entry.retainUntil != null && Date.now() >= entry.retainUntil) {
            this.hotGalleryOwnership.delete(key);
        }
    },

    removeHotGalleryOwnership(filename, workspaceId, bucket = 'files') {
        if (!filename || !workspaceId) return;
        const key = this.galleryKey(filename, workspaceId, bucket);
        this.hotGalleryOwnership.delete(key);
        this.removedGalleryOwnership.add(key);
    },

    unmarkGalleryOwnershipRemoved(filename, workspaceId, bucket = 'files') {
        if (!filename || !workspaceId) return;
        this.removedGalleryOwnership.delete(this.galleryKey(filename, workspaceId, bucket));
    },

    removeHotGalleryOwnershipForFilename(filename) {
        if (!filename) return;
        for (const [key, entry] of this.hotGalleryOwnership.entries()) {
            if (entry.row.filename === filename) {
                this.hotGalleryOwnership.delete(key);
                this.removedGalleryOwnership.add(key);
            }
        }
    },

    isGalleryOwnershipRemoved(key) {
        return this.removedGalleryOwnership.has(key);
    },

    getHotGalleryOwnershipRowsForFile(filename) {
        this.touchGalleryOwnershipRetention(filename);
        const rows = [];
        for (const [key, entry] of this.hotGalleryOwnership.entries()) {
            this.evictExpiredGalleryOwnership(key);
            if (!this.hotGalleryOwnership.has(key)) continue;
            if (entry.row.filename === filename) {
                rows.push(entry.row);
            }
        }
        return rows;
    },

    getHotGalleryOwnershipForWorkspace(workspaceId, bucket = 'files') {
        if (!workspaceId) return [];
        const rows = [];
        const targetBucket = bucket || 'files';
        for (const [key, entry] of this.hotGalleryOwnership.entries()) {
            this.evictExpiredGalleryOwnership(key);
            if (!this.hotGalleryOwnership.has(key)) continue;
            if (this.removedGalleryOwnership.has(key)) continue;
            const row = entry.row;
            if (row.workspaceId === workspaceId && (row.bucket || 'files') === targetBucket) {
                rows.push(row);
            }
        }
        return rows;
    },

    enqueue(taskFn, label, hooks = {}) {
        this.queue.push({
            taskFn,
            label: label || 'task',
            onSuccess: hooks.onSuccess || null,
            onFailure: hooks.onFailure || null
        });
        this.scheduleDrain();
    },

    /**
     * Lower-priority SQL work (search index rebuilds). Primary queue tasks always run first.
     */
    enqueueBackground(taskFn, label, hooks = {}) {
        this.backgroundQueue.push({
            taskFn,
            label: label || 'background',
            onSuccess: hooks.onSuccess || null,
            onFailure: hooks.onFailure || null
        });
        this.scheduleDrain();
    },

    scheduleDrain() {
        if (this.drainPromise) return this.drainPromise;
        this.draining = true;
        this.drainPromise = this.drainLoop().finally(() => {
            this.draining = false;
            this.drainPromise = null;
            if (this.queue.length > 0 || this.backgroundQueue.length > 0) {
                this.scheduleDrain();
            }
        });
        return this.drainPromise;
    },

    takeNextJob() {
        if (this.queue.length > 0) {
            return this.queue.shift();
        }
        if (this.backgroundQueue.length > 0) {
            return this.backgroundQueue.shift();
        }
        return null;
    },

    isClosedHandleError(err) {
        const msg = err?.message || String(err || '');
        return msg.includes('SQLITE_MISUSE') || msg.includes('Database handle is closed');
    },

    async drainLoop() {
        let job = this.takeNextJob();
        while (job) {
            const { taskFn, label, onSuccess, onFailure } = job;
            let lastError = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    await taskFn();
                    lastError = null;
                    if (onSuccess) {
                        onSuccess();
                    }
                    break;
                } catch (err) {
                    lastError = err;
                    if (this.isClosedHandleError(err) && attempt < 2) {
                        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
                        continue;
                    }
                    break;
                }
            }
            if (lastError) {
                if (onFailure) {
                    onFailure(lastError);
                }
                console.error(`Metadata write queue failed (${label}):`, lastError.message || lastError);
            }
            job = this.takeNextJob();
        }
    },

    async drainAll() {
        this.scheduleDrain();
        while (this.queue.length > 0 || this.backgroundQueue.length > 0 || this.drainPromise) {
            await (this.drainPromise || new Promise(resolve => setImmediate(resolve)));
            if (!this.drainPromise && (this.queue.length > 0 || this.backgroundQueue.length > 0)) {
                this.scheduleDrain();
            }
        }
    },

    getPendingCount() {
        return this.queue.length + this.backgroundQueue.length;
    },

    getHotRetentionMs() {
        return HOT_RETENTION_MS;
    }
};

module.exports = metadataWriteQueue;
