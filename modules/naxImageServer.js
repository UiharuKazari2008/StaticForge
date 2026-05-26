/**
 * HTTP GET handler for NAX CDN images: validate slug + filename against DB, disk cache under .cache/nax_images.
 * naxtApplet.js (image URLs)
 * Cache misses: one CDN fetch at a time (FIFO) so upstream requests are not stacked.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { pipeline } = require('stream');
const CDN_BASE = 'https://cdn.zele.st/data/NAX/Images';

const naxDownloadQueue = [];
let naxDownloadActive = false;

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
                    sendNaxImageFile(res, absDisk, finishSlot);
                    return;
                }
                if (renameErr.code === 'EEXIST' || fs.existsSync(diskPath)) {
                    cleanupTmp();
                    sendNaxImageFile(res, absDisk, finishSlot);
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
        sendNaxImageFile(res, absDisk, finishSlot);
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

    if (fs.existsSync(diskPath)) {
        return sendNaxImageFile(res, absDisk);
    }

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
        cancelled: false
    };
    req.once('close', () => {
        if (!res.headersSent) job.cancelled = true;
    });

    naxDownloadQueue.push(job);
    processNaxDownloadQueue();
}

module.exports = { handleNaxImageRequest };
