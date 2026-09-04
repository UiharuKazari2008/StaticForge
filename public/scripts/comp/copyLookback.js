/**
 * Copy Lookback — compact markdown-link refs for MCP resolve_lookback.
 * Shape: [label](dsap://lookback/<type>/<id>)
 * #82. Loaded from public/app.html before gallery / Lumen / note / wiki menus.
 */

const LOOKBACK_HREF_PREFIX = 'dsap://lookback/';
const LOOKBACK_SEL_MAX = 1200;

function encodeLookbackSeg(value) {
    return encodeURIComponent(String(value == null ? '' : value))
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');
}

function encodeLookbackB64(text) {
    const raw = String(text || '').slice(0, LOOKBACK_SEL_MAX);
    const bytes = new TextEncoder().encode(raw);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function lookbackMarkdown(type, pathTail, label) {
    const href = LOOKBACK_HREF_PREFIX + type + '/' + pathTail;
    const safe = String(label || type).replace(/[\[\]()\n\r]/g, '').slice(0, 24) || type;
    return '[' + safe + '](' + href + ')';
}

function writeLookbackClipboard(markdown) {
    // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
    copyTextToClipboard(markdown).then(() => {
        // showGlassToast: public/scripts/comp/toastManager.js
        showGlassToast('success', null, 'Copied lookback', false, 2000, '<i class="fas fa-link"></i>');
    }).catch(() => {
        showGlassToast('error', null, 'Copy lookback failed', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
    });
}

function copyLookbackRef(type, pathTail, label) {
    writeLookbackClipboard(lookbackMarkdown(type, pathTail, label));
}

function copyLookbackImage(filename) {
    const name = String(filename || '').trim();
    if (!name) {
        showGlassToast('info', null, 'No lookback target', false, 2000, '<i class="fas fa-info-circle"></i>');
        return;
    }
    copyLookbackRef('img', encodeLookbackSeg(name), 'img');
}

function copyLookbackNote(noteId, selectedText) {
    const id = String(noteId || '').trim();
    if (!id) {
        showGlassToast('info', null, 'No lookback target', false, 2000, '<i class="fas fa-info-circle"></i>');
        return;
    }
    const sel = String(selectedText || '').trim();
    if (sel) {
        copyLookbackRef('sel', 'note/' + encodeLookbackSeg(id) + '/' + encodeLookbackB64(sel), 'sel');
        return;
    }
    copyLookbackRef('note', encodeLookbackSeg(id), 'note');
}

function copyLookbackWikiContext(modal, extras) {
    const extra = extras || {};
    if (extra.imgSrc) {
        copyLookbackRef('wimg', encodeLookbackB64(extra.imgSrc), 'wimg');
        return;
    }
    const sel = String(extra.selection || '').trim();
    const sw = modal && modal.currentStaticWiki;
    const tag = modal && modal.getCurrentTagName && modal.getCurrentTagName();
    const uri = modal && modal.getCurrentPageUri && modal.getCurrentPageUri();
    if (sel) {
        if (sw && sw.siteId && sw.pageId) {
            copyLookbackRef(
                'sel',
                'swiki/' + encodeLookbackSeg(sw.siteId) + '/' + encodeLookbackSeg(sw.pageId) + '/' + encodeLookbackB64(sel),
                'sel'
            );
            return;
        }
        if (tag) {
            copyLookbackRef('sel', 'wiki/' + encodeLookbackSeg(tag) + '/' + encodeLookbackB64(sel), 'sel');
            return;
        }
        if (uri) {
            copyLookbackRef('sel', 'page/' + encodeLookbackSeg(uri) + '/' + encodeLookbackB64(sel), 'sel');
            return;
        }
    }
    if (sw && sw.siteId && sw.pageId) {
        copyLookbackRef('swiki', encodeLookbackSeg(sw.siteId) + '/' + encodeLookbackSeg(sw.pageId), 'wiki');
        return;
    }
    if (tag) {
        copyLookbackRef('wiki', encodeLookbackSeg(tag), 'wiki');
        return;
    }
    if (uri) {
        copyLookbackRef('page', encodeLookbackSeg(uri), 'page');
        return;
    }
    showGlassToast('info', null, 'No lookback target', false, 2000, '<i class="fas fa-info-circle"></i>');
}
