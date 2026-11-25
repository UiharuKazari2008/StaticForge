/**
 * Client asset URL resolver — local paths or master replication asset URLs.
 * replicationGalleryBanner.js
 */

let galleryShowSharedRemote = null;
let galleryReplicationContext = null;

function getGalleryReplicationContext() {
    return galleryReplicationContext;
}

function applyGalleryReplicationContext(context) {
    galleryReplicationContext = context && typeof context === 'object' ? context : null;
    if (context && context.showSharedRemote !== undefined) {
        galleryShowSharedRemote = context.showSharedRemote === true;
    }
}

function getGalleryShowSharedRemote() {
    if (galleryShowSharedRemote !== null) {
        return galleryShowSharedRemote === true;
    }
    const ctx = galleryReplicationContext;
    if (!ctx || !ctx.masterAccessUrl) return false;
    if (ctx.gallerySharedDefault === 'always') return true;
    if (ctx.gallerySharedDefault === 'never') return false;
    return ctx.showSharedRemote === true;
}

function setGalleryShowSharedRemote(value) {
    galleryShowSharedRemote = !!value;
}

function isReplicationSharedGalleryMenuAvailable() {
    const ctx = galleryReplicationContext;
    if (!ctx || !ctx.masterAccessUrl) return false;
    if (ctx.connectivity === 'airgapped') return false;
    return ctx.gallerySharedDefault === 'manual';
}

/** Local /images URL — always encode so `?` `#` spaces etc. stay in the path. */
function localGalleryImageUrl(filename) {
    if (!filename) return '';
    return `/images/${encodeURIComponent(filename)}`;
}

/** Local /previews URL — always encode path segment. */
function localGalleryPreviewUrl(previewName) {
    if (!previewName) return '';
    return `/previews/${encodeURIComponent(previewName)}`;
}

// #1156 picture names: a new picture's name is an extensionless 36-char UUIDv7 (no .png); legacy
// `x.png` / `x_upscaled.png` still occur. These helpers are the one place that tells them apart.

/** The ID when `name` is an ID picture (extension tolerated), else ''. */
// app-scope: allow shared picture-name helper other files call (#1156)
function pictureIdOf(name) {
    if (!name) return '';
    const stem = String(name).replace(/\.(png|jpe?g|webp|jxl|gif)$/i, '');
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stem) ? stem : '';
}

// app-scope: allow shared picture-name helper other files call (#1156)
function isPictureId(name) {
    return !!pictureIdOf(name);
}

/** Name without a picture extension (only when one is present: an ID has none). */
// app-scope: allow shared picture-name helper other files call (#1156)
function pictureStem(name) {
    return name ? String(name).replace(/\.(png|jpe?g|webp|jxl|gif)$/i, '') : '';
}

/** Creation time (ms) encoded in an ID name, else null (the UUIDv7 time is its first 48 bits). */
// app-scope: allow shared picture-name helper other files call (#1156)
function pictureIdTimeMs(name) {
    const id = pictureIdOf(name);
    if (!id) return null;
    const ms = parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
    return Number.isFinite(ms) ? ms : null;
}

/**
 * True for an upscale. Takes a gallery item (server fields: `upscaled` flag or filename, `parent`)
 * or a bare name (legacy `_upscaled` test; an ID name alone cannot tell, the server links it).
 */
// app-scope: allow shared picture-name helper other files call (#1156)
function isUpscaledPicture(itemOrName) {
    if (!itemOrName) return false;
    if (typeof itemOrName === 'string') return /_upscaled(\.|$)/.test(itemOrName);
    const it = itemOrName;
    if (it.isUpscale === true || it.upscaled === true) return true;
    if (typeof it.upscaled === 'string' && it.upscaled && (!it.filename || it.filename === it.upscaled)) return true;
    return /_upscaled(\.|$)/.test(String(it.filename || ''));
}

/** Pixels of a gallery item or its metadata (server width/height, else the print's actual size); null when unknown. */
// app-scope: allow shared picture-name helper other files call (#1156)
function pictureResolutionPixels(item) {
    if (!item || typeof item !== 'object') return null;
    const md = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    const w = Number(item.width || md.actual_width || md.width);
    const h = Number(item.height || md.actual_height || md.height);
    return w > 0 && h > 0 ? w * h : null;
}

/**
 * True when regenerating this picture is paid (over 1024x1024 pixels; Anlas), false when it is not, null when
 * its size is unknown (a name test, `large_` / `wallpaper_`, is the caller's legacy fallback, #1156).
 */
// app-scope: allow shared picture-name helper other files call (#1156)
function isPaidResolutionPicture(item) {
    const px = pictureResolutionPixels(item);
    return px == null ? null : px > 1024 * 1024;
}

// app-scope: allow shared picture-name helper other files call (#1156)
function pictureExtForMime(mime) {
    const m = String(mime || '').toLowerCase().split(';')[0].trim();
    if (m === 'image/jxl') return 'jxl';
    if (m === 'image/png') return 'png';
    if (m === 'image/webp') return 'webp';
    if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
    if (m === 'image/gif') return 'gif';
    return '';
}

/** `<stem>.<ext>` for a download; replaces a picture extension, appends to an ID. */
// app-scope: allow shared picture-name helper other files call (#1156)
function pictureDownloadName(name, ext, suffix) {
    return `${pictureStem(name)}${suffix || ''}${ext ? '.' + ext : ''}`;
}

/**
 * href + download name for saving a gallery picture as PNG. A legacy `x.png` is served as stored; an ID picture
 * (stored as JXL, no extension) is asked for as PNG and named `<id>.png` (#1156).
 */
// app-scope: allow shared picture-name helper other files call (#1156)
function galleryPngDownload(filename) {
    if (isPictureId(filename)) {
        return { href: `${localGalleryImageUrl(filename)}?download=true&format=png`, name: pictureDownloadName(filename, 'png') };
    }
    return { href: localGalleryImageUrl(filename), name: filename };
}

/** Studio preview WebP for a gallery file: /previews/<stem>@studio.webp, made by the server from /images/ (#648). */
function localStudioPreviewUrl(filename) {
    if (!filename) return '';
    // Legacy names carry .png/.jpg; an ID has no extension (#1156).
    if (isPictureId(filename)) return localGalleryPreviewUrl(`${pictureStem(filename)}@studio.webp`);
    if (!/\.(png|jpe?g)$/i.test(filename)) return '';
    const stem = filename.replace(/\.(png|jpe?g)$/i, '');
    return localGalleryPreviewUrl(`${stem}@studio.webp`);
}

/**
 * What Studio's preview <img> shows for a local /images/ URL: the optimised WebP, not the PNG.
 * Anything else (blob:, data:, remote, already a preview) comes back unchanged. The full
 * /images/ URL stays the one for download, copy, compare and opening (#648).
 */
function studioPreviewDisplayUrl(imageUrl) {
    const match = /^\/images\/([^?#]+)$/.exec(imageUrl || '');
    if (!match) return imageUrl;
    let filename;
    try {
        filename = decodeURIComponent(match[1]);
    } catch (_) {
        return imageUrl;
    }
    // localStudioPreviewUrl: this file
    return localStudioPreviewUrl(filename) || imageUrl;
}

/** Local /image/slim|opti URL — always encode path segment. */
function localGalleryDerivedImageUrl(kind, filename) {
    if (!filename || (kind !== 'slim' && kind !== 'opti')) return '';
    return `/image/${kind}/${encodeURIComponent(filename)}`;
}

/** Local /cache/preview URL — always encode path segment (full filename, incl. .webp). */
function localCachePreviewUrl(previewName) {
    if (!previewName) return '';
    return `/cache/preview/${encodeURIComponent(previewName)}`;
}

/** Local /cache/upload URL — always encode path segment. */
function localCacheUploadUrl(uploadName) {
    if (!uploadName) return '';
    return `/cache/upload/${encodeURIComponent(uploadName)}`;
}

/** Local /cache/wallpapers URL — encode full filename (`id.png`). */
function localCacheWallpaperUrl(workspaceId) {
    if (!workspaceId) return '';
    return `/cache/wallpapers/${encodeURIComponent(`${workspaceId}.png`)}`;
}

function buildLocalAssetPath(kind, key, item) {
    if (!key) return '';
    if (kind === 'gallery-image') {
        // localGalleryImageUrl: this file
        return localGalleryImageUrl(key);
    }
    if (kind === 'gallery-preview') {
        const preview = key.endsWith('.webp') ? key : `${key}.webp`;
        if (typeof getGalleryPreviewUrl === 'function') {
            // localGalleryPreviewUrl: this file
            return localGalleryPreviewUrl(getGalleryPreviewUrl(preview));
        }
        return localGalleryPreviewUrl(preview);
    }
    if (kind === 'reference-preview') {
        const preview = key.endsWith('.webp') ? key : `${key}.webp`;
        // localCachePreviewUrl: this file
        return localCachePreviewUrl(preview);
    }
    if (kind === 'reference-upload') {
        // localCacheUploadUrl: this file
        return localCacheUploadUrl(key);
    }
    if (item && item.preview && (kind === 'gallery-preview' || !kind)) {
        return buildLocalAssetPath('gallery-preview', item.preview, item);
    }
    return '';
}

function buildRemoteAssetPath(kind, key) {
    const ctx = galleryReplicationContext;
    if (!ctx || !ctx.masterAccessUrl || ctx.masterReachable === false) {
        return '';
    }
    const base = String(ctx.masterAccessUrl).replace(/\/$/, '');
    const segments = String(key).split('/').map((part) => encodeURIComponent(part));
    let url = `${base}/replication/assets/${encodeURIComponent(kind)}/${segments.join('/')}`;
    if (ctx.assetReadToken) {
        url += `?token=${encodeURIComponent(ctx.assetReadToken)}`;
    }
    return url;
}

function resolveAssetUrl(kind, key, item) {
    if (!key && item) {
        key = item.filename || item.upscaled || item.original || item.preview || null;
    }
    if (!key) return '';

    const storage = item && item.storage ? item.storage : 'local';
    if (storage === 'remote') {
        const remote = buildRemoteAssetPath(kind, key);
        if (remote) return remote;
    }
    return buildLocalAssetPath(kind, key, item);
}

function resolveGalleryPreviewUrl(image) {
    if (!image) return '';
    const previewKey = image.preview || (image.base ? `${image.base}.webp` : null);
    if (!previewKey) return '';

    if (image.storage === 'remote') {
        const remote = buildRemoteAssetPath('gallery-preview', previewKey);
        if (remote) return remote;
    }
    if (typeof getGalleryPreviewUrl === 'function') {
        // localGalleryPreviewUrl: this file
        return localGalleryPreviewUrl(getGalleryPreviewUrl(previewKey));
    }
    return localGalleryPreviewUrl(previewKey);
}

function resolveGalleryFullImageUrl(image) {
    if (!image) return '';
    const filename = image.upscaled || image.original || image.filename;
    if (!filename) return '';

    if (image.storage === 'remote' && !image.hasFullImage) {
        return resolveGalleryPreviewUrl(image);
    }
    if (image.storage === 'remote') {
        const remote = buildRemoteAssetPath('gallery-image', filename);
        if (remote) return remote;
    }
    // localGalleryImageUrl: this file
    return localGalleryImageUrl(filename);
}
