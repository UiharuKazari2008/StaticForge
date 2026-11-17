/**
 * HTTP GET handler for NAX CDN images: validate slug + filename against DB, disk cache under .cache/nax_images.
 * naxtApplet.js (image URLs)
 * Cache misses: one CDN fetch at a time (FIFO) so upstream requests are not stacked.
 *
 * ?w=480 (#890 P13): the picture 480 px wide as WebP, aspect kept (object-fit: cover crops it the same
 * as the original), for grids whose cells are far smaller than the 832x1216 originals (Melaton
 * Mobile's Atelier). Made from the cached original on first request, kept beside it in
 * .cache/nax_images/<slug>/.w480/<file>.webp, and served immutable (a file name never changes picture).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { pipeline } = require('stream');
const CDN_BASE = 'https://cdn.zele.st/data/NAX/Images';

const naxDownloadQueue = [];
let naxDownloadActive = false;

// ---- ?w= thumbnails (#890 P13)
const THUMB_WIDTHS = new Set([480]);
const THUMB_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const THUMB_CONCURRENCY = 2;
const thumbJobs = new Map(); // thumb path -> Promise<boolean>
const thumbWaiting = [];
let thumbRunning = 0;

/** The thumbnail width a request asks for (0: the original). */
function thumbWidthOf(req) {
    const w = Number(req && req.query ? req.query.w : NaN);
    return THUMB_WIDTHS.has(w) ? w : 0;
}

function thumbPathFor(naxDir, dbFilename, w) {
    return path.join(naxDir, `.w${w}`, `${dbFilename}.webp`);
}

function thumbSlot() {
    return new Promise((resolve) => {
        const grant = () => {
            thumbRunning += 1;
            let done = false;
            resolve(() => {
                if (done) return;
                done = true;
                thumbRunning -= 1;
                const next = thumbWaiting.shift();
                if (next) next();
            });
        };
        if (thumbRunning < THUMB_CONCURRENCY) grant(); else thumbWaiting.push(grant);
    });
}

/** Make the thumbnail of a cached original once (concurrent requests share the encode). */
function ensureThumb(absOriginal, thumbPath, w) {
    if (thumbJobs.has(thumbPath)) return thumbJobs.get(thumbPath);
    const job = thumbSlot().then(async (release) => {
        const tmp = `${thumbPath}.${crypto.randomBytes(6).toString('hex')}.part`;
        try {
            await fs.promises.mkdir(path.dirname(thumbPath), { recursive: true });
            const sharp = require('sharp');
            await sharp(absOriginal, { failOnError: false })
                .resize({ width: w, withoutEnlargement: true })
                .webp({ quality: 82, effort: 4 })
                .toFile(tmp);
            await fs.promises.rename(tmp, thumbPath);
            return true;
        } catch (err) {
            fs.unlink(tmp, () => {});
            console.error('nax thumbnail', path.basename(absOriginal), err.message);
            return false;
        } finally {
            release();
        }
    }).finally(() => thumbJobs.delete(thumbPath));
    thumbJobs.set(thumbPath, job);
    return job;
}

function sendThumbFile(res, thumbPath) {
    if (res.headersSent) return;
    res.type('webp');
    res.setHeader('Cache-Control', THUMB_CACHE_CONTROL);
    res.sendFile(thumbPath, (err) => {
        if (err && !res.headersSent) res.status(500).json({ success: false, error: 'Send failed' });
    });
}

/**
 * The original is on disk: send it, or its thumbnail (made now if needed). onComplete runs once the
 * caller's download slot may go (for a thumbnail: before the encode, which has its own limit).
 */
function deliverNaxImage(res, absDisk, onComplete, thumb) {
    if (!thumb) { sendNaxImageFile(res, absDisk, onComplete); return; }
    if (typeof onComplete === 'function') onComplete();
    ensureThumb(absDisk, thumb.path, thumb.w).then((ok) => {
        if (res.headersSent || res.destroyed) return;
        // the encode failed (a file sharp cannot read): the original, as without ?w=
        if (ok) sendThumbFile(res, thumb.path); else sendNaxImageFile(res, absDisk);
    });
}

function sendNaxImageFile(res, absPath, onComplete) {
    if (res.headersSent) {
        if (typeof onComplete === 'function') onComplete();
        return;
    }
    const ext = path.extname(absPath);
    if (ext) res.type(ext);
    res.setHeader('Cache-Control', 'public, max-age=2592000');
    res.sendFile(absPath, (err) => {
        if (err) {
            console.error('nax sendFile', err);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: 'Send failed' });
            }
        }
        if (typeof onComplete === 'function') onComplete();
    });
}

function releaseNaxDownloadSlot() {
    naxDownloadActive = false;
    processNaxDownloadQueue();
}

function runNaxCdnFetch(job, finishSlot) {
    const { req, res, url, diskPath, absDisk } = job;
    const tmpPath = `${diskPath}.${crypto.randomBytes(8).toString('hex')}.part`;
    job.tmpPath = tmpPath;

    let reqHttps;
    const onEarlyHttpsError = (err) => {
        if (reqHttps) reqHttps.off('error', onEarlyHttpsError);
        console.error('nax https', err.code || err.message);
        fs.unlink(tmpPath, () => {});
        if (!res.headersSent) {
            res.status(502).json({ success: false, error: 'Fetch failed' });
        }
        finishSlot();
    };

    reqHttps = https.get(url, (upstream) => {
        reqHttps.off('error', onEarlyHttpsError);

        if (job.cancelled) {
            upstream.resume();
            if (!res.headersSent) {
                res.status(502).json({ success: false, error: 'Cancelled' });
            }
            return finishSlot();
        }

        if (upstream.statusCode !== 200) {
            upstream.resume();
            if (!res.headersSent) {
                res.status(upstream.statusCode === 404 ? 404 : 502).json({
                    success: false,
                    error: `Upstream ${upstream.statusCode}`
                });
            }
            return finishSlot();
        }

        const file = fs.createWriteStream(tmpPath, { flags: 'w' });
        let cleaned = false;
        const cleanupTmp = () => {
            if (cleaned) return;
            cleaned = true;
            fs.unlink(tmpPath, () => {});
        };

        let pipelineDone = false;
        const abortIfClientGone = () => {
            if (pipelineDone || res.writableEnded) return;
            try {
                upstream.destroy();
            } catch {
                /* */
            }
            try {
                file.destroy();
            } catch {
                /* */
            }
        };
        req.once('close', abortIfClientGone);

        pipeline(upstream, file, (pipeErr) => {
            pipelineDone = true;
            req.removeListener('close', abortIfClientGone);
            if (job.cancelled) {
                cleanupTmp();
                return finishSlot();
            }
            if (pipeErr) {
                console.error('nax upstream pipeline', pipeErr);
                cleanupTmp();
                if (!res.headersSent) {
                    res.status(502).json({ success: false, error: 'Fetch failed' });
                }
                return finishSlot();
            }

            fs.rename(tmpPath, diskPath, (renameErr) => {
                if (job.cancelled) {
                    cleanupTmp();
                    return finishSlot();
                }
                if (!renameErr) {
                    cleaned = true;
                    deliverNaxImage(res, absDisk, finishSlot, job.thumb);
                    return;
                }
                if (renameErr.code === 'EEXIST' || fs.existsSync(diskPath)) {
                    cleanupTmp();
                    deliverNaxImage(res, absDisk, finishSlot, job.thumb);
                    return;
                }
                console.error('nax image rename', renameErr);
                cleanupTmp();
                if (!res.headersSent) {
                    res.status(500).json({ success: false, error: 'Cache write failed' });
                }
                finishSlot();
            });
        });
    });

    reqHttps.on('error', onEarlyHttpsError);
}

function processNaxDownloadQueue() {
    if (naxDownloadActive) return;
    const job = naxDownloadQueue.shift();
    if (!job) return;
    naxDownloadActive = true;

    if (job.cancelled) {
        releaseNaxDownloadSlot();
        return;
    }

    const { res, diskPath, absDisk } = job;

    let slotFinished = false;
    const finishSlot = () => {
        if (slotFinished) return;
        slotFinished = true;
        releaseNaxDownloadSlot();
    };

    if (fs.existsSync(diskPath)) {
        deliverNaxImage(res, absDisk, finishSlot, job.thumb);
        return;
    }

    runNaxCdnFetch(job, finishSlot);
}

/**
 * Express handler: GET /naxCache/:gallerySlug/:filename
 * :filename must match nax_tags.filename exactly (URL-encoded in links from the client).
 */
function handleNaxImageRequest(globalResources, req, res, cacheDir) {
    const slug = req.params.gallerySlug;
    const fn = req.params.filename;
    if (!fn || typeof fn !== 'string' || fn.includes('..') || fn.includes('/') || fn.includes('\\')) {
        return res.status(400).json({ success: false, error: 'Invalid path' });
    }
    if (!/^[a-z0-9._-]+$/i.test(slug) || slug.includes('..')) {
        return res.status(400).json({ success: false, error: 'Invalid gallery' });
    }

    let nax;
    try {
        nax = globalResources.getNaxTagsDatabase();
    } catch {
        return res.status(503).json({ success: false, error: 'NAX database unavailable' });
    }

    if (!nax.slugExists(slug)) {
        return res.status(404).json({ success: false, error: 'Unknown gallery' });
    }

    const row = nax.findTagByGalleryFilename(slug, fn);
    if (!row) {
        return res.status(404).json({ success: false, error: 'Image not in dataset' });
    }

    const dbFilename = row.filename;
    const naxDir = path.join(cacheDir, 'nax_images', slug);
    const diskPath = path.join(naxDir, dbFilename);
    const absDisk = path.resolve(diskPath);
    const w = thumbWidthOf(req);
    const thumb = w ? { w, path: path.resolve(thumbPathFor(naxDir, dbFilename, w)) } : null;

    // one stat off the event loop per request (a phone's grid asks for dozens at once)
    const known = thumb ? fs.promises.stat(thumb.path).then((st) => (st.isFile() && st.size > 0 ? 'thumb' : null), () => null) : Promise.resolve(null);
    known.then((have) => {
        if (have === 'thumb') { sendThumbFile(res, thumb.path); return null; }
        return fs.promises.stat(diskPath).then(() => true, () => false);
    }).then((onDisk) => {
        if (onDisk === null) return;
        if (onDisk) { deliverNaxImage(res, absDisk, null, thumb); return; }
        fetchNaxOriginal(req, res, slug, naxDir, dbFilename, diskPath, absDisk, thumb);
    }).catch((err) => {
        console.error('nax image', err && err.message);
        if (!res.headersSent) res.status(500).json({ success: false, error: 'Read failed' });
    });
}

/** Not cached yet: queue the CDN fetch (one at a time), then send it (or its thumbnail). */
function fetchNaxOriginal(req, res, slug, naxDir, dbFilename, diskPath, absDisk, thumb) {
    // the client went away while its file was looked for
    if (req.destroyed || res.destroyed || res.writableEnded) return;
    let pathSeg;
    try {
        pathSeg = encodeURIComponent(dbFilename);
    } catch {
        pathSeg = encodeURIComponent(String(dbFilename));
    }
    const url = `${CDN_BASE}/${slug}/${pathSeg}`;

    fs.mkdirSync(naxDir, { recursive: true });

    const job = {
        req,
        res,
        url,
        diskPath,
        absDisk,
        thumb,
        cancelled: false
    };
    req.once('close', () => {
        if (!res.headersSent) job.cancelled = true;
    });

    naxDownloadQueue.push(job);
    processNaxDownloadQueue();
}

module.exports = { handleNaxImageRequest, _test: { thumbWidthOf, thumbPathFor, ensureThumb, THUMB_CACHE_CONTROL } };
