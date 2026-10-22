/**
 * Allowlist HTML sanitizer for Dovecote mail bodies.
 *
 * Strips script/iframe/object/embed/form/style/link/meta/base/svg/comments
 * entirely (tag + contents), drops every on* handler, strips url()/@import
 * out of inline style, forces safe link targets, and blocks remote images
 * by default (callers opt a sender/thread back in explicitly).
 *
 * The result is meant to be dropped into a sandboxed iframe via srcdoc —
 * it is never trusted to run script, so there is no sanitize-on-the-client
 * step; this is the single authoritative pass.
 */

'use strict';

const { parse, NodeType } = require('node-html-parser');

// Removed along with all of their content — never just unwrapped.
const DROP_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta',
    'base', 'noscript', 'svg', 'title', 'head', 'applet', 'frame', 'frameset'
]);

// tag -> attributes it may keep (before per-attribute scheme/value checks).
const ALLOWED_TAGS = {
    p: ['style'], br: [], b: [], strong: [], i: [], em: [], u: [], s: [], strike: [],
    sub: [], sup: [], hr: [], blockquote: ['style'], pre: ['style'], code: ['style'],
    h1: ['style'], h2: ['style'], h3: ['style'], h4: ['style'], h5: ['style'], h6: ['style'],
    ul: ['style'], ol: ['style'], li: ['style'],
    table: ['style'], thead: ['style'], tbody: ['style'], tr: ['style'],
    td: ['style', 'colspan', 'rowspan'], th: ['style', 'colspan', 'rowspan'],
    span: ['style'], div: ['style'],
    a: ['href', 'title'],
    img: ['src', 'alt', 'width', 'height']
};

const UNSAFE_STYLE_PATTERN = /url\s*\(|@import/i;
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function bump(counts, key) {
    counts[key] = (counts[key] || 0) + 1;
}

function parseUrl(value) {
    try { return new URL(String(value || '')); } catch (_) { return null; }
}

// Drops whole declarations that reference url()/@import rather than just the
// token, so no CSS-fetchable remnant (tracking pixel, @import exfil) survives.
function cleanStyle(value, counts) {
    const declarations = String(value || '').split(';');
    const kept = declarations.filter((decl) => {
        if (!UNSAFE_STYLE_PATTERN.test(decl)) return true;
        bump(counts, 'unsafeStyleStripped');
        return false;
    });
    return kept.join(';').trim();
}

function sanitizeAttributes(node, tag, counts) {
    const allowed = new Set(ALLOWED_TAGS[tag] || []);
    const current = Object.assign({}, node.attributes);
    for (const name of Object.keys(current)) {
        const lower = name.toLowerCase();
        if (lower.startsWith('on')) {
            node.removeAttribute(name);
            bump(counts, 'eventHandlersStripped');
            continue;
        }
        if (!allowed.has(lower)) {
            node.removeAttribute(name);
            bump(counts, 'attributesStripped');
            continue;
        }
        if (lower === 'style') {
            node.setAttribute('style', cleanStyle(current[name], counts));
        }
    }
}

/** Returns false if the <img> was dropped outright. */
function handleImg(node, counts, opts) {
    const src = (node.getAttribute('src') || '').trim();
    if (src.startsWith('data:image/')) return true;
    // cid: images point at this mail's own attachments; the client swaps in the bytes
    // (doveResolveInlineImages: public/scripts/comp/desktop-apps/dovecote.js).
    if (/^cid:/i.test(src)) {
        node.removeAttribute('src');
        node.setAttribute('data-dove-cid', src.slice(4));
        bump(counts, 'inlineAttachmentImages');
        return true;
    }
    // Same-origin relative paths (/vfs/..., a send_mail vfsPath, /images/...) are not remote:
    // the client resolves them to an attachment by name or loads them from this origin.
    if (src.startsWith('/') && !src.startsWith('//') && !/[\\\s]/.test(src)) {
        node.removeAttribute('src');
        node.setAttribute('data-dove-local', src);
        bump(counts, 'localImages');
        return true;
    }
    const url = parseUrl(src);
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
        node.remove();
        bump(counts, 'unsafeImagesDropped');
        return false;
    }
    const sender = opts.sender || null;
    const allowRemote = opts.allowRemoteImages === true || (sender && opts.alwaysLoadSenders && opts.alwaysLoadSenders.has(sender));
    if (!allowRemote) {
        node.removeAttribute('src');
        node.setAttribute('data-blocked-src', src);
        opts.remoteImages.add(src);
        bump(counts, 'remoteImagesBlocked');
    }
    return true;
}

function handleAnchor(node) {
    const href = node.getAttribute('href') || '';
    const url = parseUrl(href);
    if (!url || !SAFE_LINK_SCHEMES.has(url.protocol)) {
        node.removeAttribute('href');
    } else {
        node.setAttribute('title', href);
    }
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
}

// Bare web addresses in mail text (https://..., www....) become links, so every format
// (plain text, markdown, HTML) gets clickable URLs. Text already inside an <a> stays as it is.
const BARE_URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const URL_CLOSERS = { ')': '(', ']': '[', '}': '{' };

function escapeHtmlText(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function countChar(text, ch) {
    return text.split(ch).length - 1;
}

// Sentence punctuation after an address stays text; a closing bracket only belongs to the
// address when the address opened it (wiki-style "Foo_(bar)").
function trimBareUrl(raw) {
    let url = raw;
    for (;;) {
        const before = url;
        url = url.replace(/[.,;:!?'*~_]+$/, '');
        const last = url.slice(-1);
        if (URL_CLOSERS[last] && countChar(url, last) > countChar(url, URL_CLOSERS[last])) url = url.slice(0, -1);
        if (url === before) return url;
    }
}

/** Returns the nodes that replace this text node: itself, or text split around new <a> links. */
function linkifyText(textNode) {
    const text = textNode.text;
    const parts = [];
    let last = 0;
    for (const match of text.matchAll(BARE_URL_PATTERN)) {
        const label = trimBareUrl(match[0]);
        const href = /^www\./i.test(label) ? 'https://' + label : label;
        const url = parseUrl(href);
        if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname.includes('.')) continue;
        parts.push(escapeHtmlText(text.slice(last, match.index)));
        parts.push(`<a href="${escapeHtmlText(href).replace(/"/g, '&quot;')}">${escapeHtmlText(label)}</a>`);
        last = match.index + label.length;
    }
    if (!parts.length) return [textNode];
    parts.push(escapeHtmlText(text.slice(last)));
    return parse(parts.join('')).childNodes.map((node) => {
        if (node.nodeType === NodeType.ELEMENT_NODE) handleAnchor(node);
        return node;
    });
}

function walk(node, counts, opts, inLink) {
    const next = [];
    for (const child of node.childNodes.slice()) {
        if (child.nodeType === NodeType.COMMENT_NODE) {
            bump(counts, 'commentsStripped');
            continue;
        }
        if (child.nodeType === NodeType.TEXT_NODE) {
            if (inLink) next.push(child);
            else next.push(...linkifyText(child));
            continue;
        }
        if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
        const tag = (child.tagName || '').toLowerCase();
        if (DROP_TAGS.has(tag)) {
            bump(counts, 'tagsDropped');
            bump(counts, `tagsDropped:${tag}`);
            continue;
        }
        walk(child, counts, opts, inLink || tag === 'a');
        if (!ALLOWED_TAGS[tag]) {
            bump(counts, 'tagsUnwrapped');
            next.push(...child.childNodes);
            continue;
        }
        sanitizeAttributes(child, tag, counts);
        if (tag === 'img' && !handleImg(child, counts, opts)) continue;
        if (tag === 'a') handleAnchor(child);
        next.push(child);
    }
    node.childNodes = next;
}

/**
 * @param {string} html
 * @param {{ sender?: string, allowRemoteImages?: boolean, alwaysLoadSenders?: Set<string> }} opts
 * @returns {{ html: string, counts: object, remoteImages: string[] }}
 */
function sanitizeHtml(html, opts = {}) {
    const counts = {};
    const remoteImages = new Set();
    const root = parse(String(html || ''), { comment: true });
    walk(root, counts, Object.assign({ remoteImages }, opts));
    return { html: root.toString(), counts, remoteImages: Array.from(remoteImages) };
}

module.exports = {
    sanitizeHtml,
    ALLOWED_TAGS,
    DROP_TAGS
};
