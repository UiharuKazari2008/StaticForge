// Shared utilities for reference management

// Convert file to base64 string
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        // no-base64-images: transport (the string is sent to NovelAI / the server; callers show a picture via base64PictureUrl)
        reader.readAsDataURL(file);
        reader.onload = () => {
            const base64 = reader.result.split(',')[1]; // Remove data URL prefix
            resolve(base64);
        };
        reader.onerror = error => reject(error);
    });
}

// Get workspace display name
function getWorkspaceDisplayName(workspaceId) {
    const workspace = workspaces[workspaceId];
    return workspace ? workspace.name.charAt(0).toUpperCase() + workspace.name.slice(1) : 'Default';
}

// Show comment dialog
function showCommentDialog(comment, title) {
    const dialog = document.createElement('div');
    dialog.className = 'modal comment-dialog';
    dialog.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3><i class="fas fa-comment"></i> ${title}</h3>
                <button class="btn-secondary btn-small" onclick="this.closest('.comment-dialog').remove()">
                    <i class="fa-regular fa-xmark-large"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="comment-content">
                    <p>${comment.replace(/\n/g, '<br>')}</p>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" onclick="this.closest('.comment-dialog').remove()">Close</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    openModal(dialog);
}

// Show multiple vibes comments dialog
function showVibesCommentsDialog(vibes) {
    const dialog = document.createElement('div');
    dialog.className = 'modal comment-dialog';
    
    const commentsHtml = vibes.map(vibe => `
        <div class="vibe-comment-item">
            <h4>${vibe.originalName || 'Vibe'}</h4>
            <p>${vibe.comment.replace(/\n/g, '<br>')}</p>
        </div>
    `).join('');
    
    dialog.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3><i class="fas fa-comments"></i> Vibe Comments</h3>
                <button class="btn-secondary btn-small" onclick="this.closest('.comment-dialog').remove()">
                    <i class="fa-regular fa-xmark-large"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="vibes-comments-content">
                    ${commentsHtml}
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" onclick="this.closest('.comment-dialog').remove()">Close</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    openModal(dialog);
}

(function () {
'use strict';
// A base64 picture (reference images, vibe sources, mask PNGs: kept as base64 because the API takes it) as an
// object URL to SHOW (no-base64-images): decoded once per string and cached, at most BASE64_PICTURE_URL_CAP
// pictures (least recently shown first; its URL is revoked as it leaves the cache, phone-power-client rule 8).
const BASE64_PICTURE_URL_CAP = 64;
const _base64PictureUrls = new Map();
function base64PictureUrl(base64, mime) {
    if (!base64) return '';
    let b64 = String(base64);
    let type = mime || '';
    // no-base64-images: tiny (a pattern that strips a prefix, no picture is built here)
    const m = /^data:([^;,]+);base64,/.exec(b64);
    if (m) { type = type || m[1]; b64 = b64.slice(m[0].length); }
    if (!type) type = b64.startsWith('/9j/') ? 'image/jpeg' : (b64.startsWith('UklGR') ? 'image/webp' : 'image/png');
    const key = type + '|' + b64;
    const hit = _base64PictureUrls.get(key);
    if (hit) {
        _base64PictureUrls.delete(key);
        _base64PictureUrls.set(key, hit);
        return hit;
    }
    let url = '';
    try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        url = URL.createObjectURL(new Blob([bytes], { type }));
    } catch (_) { return ''; }
    _base64PictureUrls.set(key, url);
    while (_base64PictureUrls.size > BASE64_PICTURE_URL_CAP) {
        const oldest = _base64PictureUrls.keys().next().value;
        URL.revokeObjectURL(_base64PictureUrls.get(oldest));
        _base64PictureUrls.delete(oldest);
    }
    return url;
}
window.base64PictureUrl = base64PictureUrl;

// The same decode for a picture shown once or replaced step by step (a live generation preview): NOT cached, the
// caller owns the URL and revokes it.
function base64PictureUrlOnce(base64, mime) {
    if (!base64) return '';
    let b64 = String(base64);
    // no-base64-images: tiny (a pattern that strips a prefix, no picture is built here)
    const m = /^data:([^;,]+);base64,/.exec(b64);
    if (m) { mime = mime || m[1]; b64 = b64.slice(m[0].length); }
    try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return URL.createObjectURL(new Blob([bytes], { type: mime || 'image/jpeg' }));
    } catch (_) { return ''; }
}
window.base64PictureUrlOnce = base64PictureUrlOnce;

// A base64 / data URL picture as a Blob (bytes, not text), for a picture kept to show later: the owner makes an
// object URL when it shows it and revokes that when done.
function base64PictureBlob(base64, mime) {
    if (!base64) return null;
    let b64 = String(base64);
    // no-base64-images: tiny (a pattern that strips a prefix, no picture is built here)
    const m = /^data:([^;,]+);base64,/.exec(b64);
    if (m) { mime = mime || m[1]; b64 = b64.slice(m[0].length); }
    try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: mime || 'image/png' });
    } catch (_) { return null; }
}
window.base64PictureBlob = base64PictureBlob;
})();
