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

function buildLocalAssetPath(kind, key, item) {
    if (!key) return '';
    if (kind === 'gallery-image') {
        return `/images/${encodeURIComponent(key)}`;
    }
    if (kind === 'gallery-preview') {
        const preview = key.endsWith('.webp') ? key : `${key}.webp`;
        if (typeof getGalleryPreviewUrl === 'function') {
            return `/previews/${encodeURIComponent(getGalleryPreviewUrl(preview))}`;
        }
        return `/previews/${encodeURIComponent(preview)}`;
    }
    if (kind === 'reference-preview') {
        const preview = key.endsWith('.webp') ? key : `${key}.webp`;
        return `/cache/preview/${encodeURIComponent(preview)}`;
    }
    if (kind === 'reference-upload') {
        return `/cache/upload/${encodeURIComponent(key)}`;
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
        return `/previews/${encodeURIComponent(getGalleryPreviewUrl(previewKey))}`;
    }
    return `/previews/${encodeURIComponent(previewKey)}`;
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
    return `/images/${encodeURIComponent(filename)}`;
}
