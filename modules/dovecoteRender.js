/**
 * Renders a mail body for display: markdown -> HTML (raw HTML disabled) or
 * HTML straight through, then always through the allowlist sanitizer. This
 * is the only place "safe to show the user" HTML gets produced.
 */

'use strict';

const { sanitizeHtml } = require('./dovecoteSanitize');
const { markdownToHtml } = require('./dovecoteMarkdown');

function escapeText(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

function renderMailBody({ body, format, sender, allowRemoteImages, alwaysLoadSenders }) {
    let html;
    if (format === 'html') {
        html = String(body || '');
    } else if (format === 'md') {
        html = markdownToHtml(body);
    } else {
        html = escapeText(body);
    }
    const result = sanitizeHtml(html, { sender, allowRemoteImages, alwaysLoadSenders });
    return {
        html: result.html,
        sanitized: true,
        strippedCounts: result.counts,
        remoteImages: result.remoteImages
    };
}

module.exports = { renderMailBody };
