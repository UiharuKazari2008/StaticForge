// Gallery per-image IndexedDB metadata/thumbnail cache + slim list helpers.
// Extracted from galleryView.js (#23 incremental slice). Same globals.

// IndexedDB utilities for per-image metadata / thumbnails (not gallery list cache)
class GalleryMetadataCache {
    constructor() {
        this.dbName = 'StaticForgeGallery';
        this.version = 7;
        this.db = null;
        this.snapshotCleanupDone = false;
        this.initPromise = this.initDB();
    }

    _openDatabase() {
        const openAttempt = new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) {
                reject(new Error('IndexedDB not supported'));
                return;
            }

            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                reject(request.error || new Error('IndexedDB open failed'));
            };

            request.onblocked = () => {
                reject(new Error('IndexedDB open blocked'));
            };

            request.onsuccess = (event) => {
                resolve(event.target.result);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                // Drop abandoned gallery list cache stores from earlier revisions
                for (const storeName of ['gallerySnapshots', 'galleryMeta', 'galleryBlocks', 'galleryPins']) {
                    if (db.objectStoreNames.contains(storeName)) {
                        db.deleteObjectStore(storeName);
                    }
                }

                let metadataStore;
                if (!db.objectStoreNames.contains('metadata')) {
                    metadataStore = db.createObjectStore('metadata', { keyPath: 'base' });
                    metadataStore.createIndex('mtime', 'mtime', { unique: false });
                } else {
                    metadataStore = event.target.transaction.objectStore('metadata');
                }
                if (!metadataStore.indexNames.contains('cachedAt')) {
                    metadataStore.createIndex('cachedAt', 'cachedAt', { unique: false });
                }

                let thumbnailStore;
                if (!db.objectStoreNames.contains('thumbnails')) {
                    thumbnailStore = db.createObjectStore('thumbnails', { keyPath: 'base' });
                } else {
                    thumbnailStore = event.target.transaction.objectStore('thumbnails');
                }
                if (!thumbnailStore.indexNames.contains('cachedAt')) {
                    thumbnailStore.createIndex('cachedAt', 'cachedAt', { unique: false });
                }
            };
        });

        const timeoutMs = 15000;
        return Promise.race([
            openAttempt,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`IndexedDB open timed out after ${timeoutMs}ms`)), timeoutMs);
            })
        ]);
    }

    async eraseDatabase() {
        if (this.db) {
            try {
                this.db.close();
            } catch (e) { /* ignore */ }
            this.db = null;
        }
        if (!('indexedDB' in window)) {
            return false;
        }

        await new Promise((resolve) => {
            const deleteReq = indexedDB.deleteDatabase(this.dbName);
            const timeout = setTimeout(resolve, 5000);
            const finish = () => {
                clearTimeout(timeout);
                resolve();
            };
            deleteReq.onsuccess = finish;
            deleteReq.onerror = finish;
            deleteReq.onblocked = finish;
        });

        this.snapshotCleanupDone = false;
        return true;
    }

    async initDB(isRetry = false) {
        try {
            const db = await this._openDatabase();
            this.db = db;
            db.onclose = () => {
                if (this.db === db) {
                    this.db = null;
                }
            };

            if (!this.snapshotCleanupDone) {
                this.snapshotCleanupDone = true;
                void Promise.resolve()
                    .then(() => this.runMaintenance())
                    .catch((err) => console.warn('Gallery IndexedDB maintenance failed:', err));
            }

            return this.db;
        } catch (error) {
            console.warn('Gallery IndexedDB failed to open; erasing corrupt database:', error);
            await this.eraseDatabase();
            if (!isRetry) {
                return this.initDB(true);
            }
            console.warn('Gallery IndexedDB unavailable after erase; memory-only metadata cache');
            this.db = null;
            return null;
        }
    }

    async getMetadata(base) {
        if (!this.db) return null;
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['metadata'], 'readonly');
            const store = transaction.objectStore('metadata');
            const request = store.get(base);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => resolve(null);
        });
    }

    async setMetadata(base, metadata) {
        if (!this.db) return;
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['metadata'], 'readwrite');
            const store = transaction.objectStore('metadata');
            const request = store.put({ base, ...metadata, cachedAt: Date.now() });

            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
        });
    }

    async getThumbnail(base) {
        if (!this.db) return null;
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['thumbnails'], 'readonly');
            const store = transaction.objectStore('thumbnails');
            const request = store.get(base);

            request.onsuccess = () => resolve(request.result?.data || null);
            request.onerror = () => resolve(null);
        });
    }

    async setThumbnail(base, thumbnailData) {
        if (!this.db) return;
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['thumbnails'], 'readwrite');
            const store = transaction.objectStore('thumbnails');
            const request = store.put({ base, data: thumbnailData, cachedAt: Date.now() });

            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
        });
    }

    async clearOldEntries(maxAge = 7 * 24 * 60 * 60 * 1000) {
        if (!this.db) return;
        const cutoff = Date.now() - maxAge;

        return new Promise((resolve) => {
            const transaction = this.db.transaction(['metadata'], 'readwrite');
            const store = transaction.objectStore('metadata');
            const index = store.index('cachedAt');
            const range = IDBKeyRange.upperBound(cutoff);
            const request = index.openCursor(range);

            let deleted = 0;
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    deleted++;
                    cursor.continue();
                } else {
                    if (deleted > 0) {
                        console.log(`🧹 Cleaned up ${deleted} old gallery metadata entries`);
                    }
                    resolve();
                }
            };
            request.onerror = () => resolve();
        });
    }

    async clearOldThumbnails(maxAge = 7 * 24 * 60 * 60 * 1000, maxEntries = 2000) {
        if (!this.db) return;
        const cutoff = Date.now() - maxAge;
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['thumbnails'], 'readwrite');
            const store = transaction.objectStore('thumbnails');
            let remaining = 0;
            let deleted = 0;

            const countRequest = store.count();
            countRequest.onsuccess = () => {
                remaining = countRequest.result || 0;
                const request = store.openCursor();
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (!cursor) return;
                    const cachedAt = Number(cursor.value?.cachedAt) || 0;
                    if (cachedAt < cutoff || remaining > maxEntries) {
                        cursor.delete();
                        remaining--;
                        deleted++;
                    }
                    cursor.continue();
                };
            };
            transaction.oncomplete = () => {
                if (deleted > 0) {
                    console.log(`🧹 Cleaned up ${deleted} old gallery thumbnail entries`);
                }
                resolve();
            };
            transaction.onerror = () => resolve();
            transaction.onabort = () => resolve();
        });
    }

    async runMaintenance() {
        await this.clearOldEntries();
        await this.clearOldThumbnails();
    }
}

/** Strip embedded metadata blobs from gallery index rows — list fields only. */
function slimGalleryListItem(item) {
    if (!item || typeof item !== 'object') {
        return item;
    }
    const filename = item.filename || item.upscaled || item.original || null;
    const slim = {
        base: item.base,
        original: item.original,
        upscaled: item.upscaled,
        preview: item.preview,
        blurhash: item.blurhash || null,
        mtime: item.mtime,
        width: item.width,
        height: item.height,
        size: item.size,
        isLarge: item.isLarge,
        isPinned: item.isPinned,
        filename,
        storage: item.storage || 'local',
        hasFullImage: item.hasFullImage !== false,
        hasMetadata: item.hasMetadata !== false,
        reachable: item.reachable !== false
    };
    if (slim.preview == null && slim.base) {
        slim.preview = `${slim.base}.webp`;
    }
    return slim;
}

function slimGalleryList(gallery) {
    if (!Array.isArray(gallery)) {
        return [];
    }
    return gallery.map(slimGalleryListItem);
}

// Global gallery metadata cache instance
const galleryMetadataCache = new GalleryMetadataCache();

function getGalleryItemStructureKey(item) {
    if (!item) {
        return '';
    }
    const base = item.base || '';
    const original = item.original || '';
    const upscaled = item.upscaled || '';
    const mtime = item.mtime || 0;
    return `${base}|${original}|${upscaled}|${mtime}`;
}

function verifyGalleryOverlap(cachedGallery, serverChunk, count) {
    if (!cachedGallery || !serverChunk || count <= 0) {
        return true;
    }
    for (let i = 0; i < count; i++) {
        if (getGalleryItemStructureKey(cachedGallery[i]) !== getGalleryItemStructureKey(serverChunk[i])) {
            return false;
        }
    }
    return true;
}
