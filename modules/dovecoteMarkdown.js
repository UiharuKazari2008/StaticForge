/**
 * Minimal markdown -> HTML for Dovecote mail bodies. Raw HTML in the source
 * is always escaped, never passed through as real tags — the subset of
 * markup this produces is itself finite and still goes through
 * dovecoteSanitize afterward (defense in depth, not a substitute).
 */

'use strict';

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderInline(text) {
    let escaped = escapeHtml(text);
    escaped = escaped.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    escaped = escaped.replace(/_([^_]+)_/g, '<em>$1</em>');
    escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2">$1</a>');
    return escaped;
}

function markdownToHtml(markdown) {
    const source = String(markdown || '').replace(/\r\n/g, '\n');
    const lines = source.split('\n');
    const html = [];
    let i = 0;
    let listStack = null; // 'ul' | 'ol' | null
    let paragraph = [];

    const flushParagraph = () => {
        if (paragraph.length) {
            html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
            paragraph = [];
        }
    };
    const closeList = () => {
        if (listStack) {
            html.push(`</${listStack}>`);
            listStack = null;
        }
    };

    while (i < lines.length) {
        const line = lines[i];

        if (/^```/.test(line)) {
            flushParagraph();
            closeList();
            const code = [];
            i += 1;
            while (i < lines.length && !/^```/.test(lines[i])) {
                code.push(lines[i]);
                i += 1;
            }
            html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
            i += 1;
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            flushParagraph();
            closeList();
            const level = heading[1].length;
            html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
            i += 1;
            continue;
        }

        if (/^\s*>\s?/.test(line)) {
            flushParagraph();
            closeList();
            const quote = [];
            while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                quote.push(lines[i].replace(/^\s*>\s?/, ''));
                i += 1;
            }
            html.push(`<blockquote><p>${renderInline(quote.join(' '))}</p></blockquote>`);
            continue;
        }

        if (/^\s*---+\s*$/.test(line)) {
            flushParagraph();
            closeList();
            html.push('<hr>');
            i += 1;
            continue;
        }

        const unordered = line.match(/^\s*[-*]\s+(.*)$/);
        const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
        if (unordered || ordered) {
            flushParagraph();
            const kind = unordered ? 'ul' : 'ol';
            if (listStack !== kind) {
                closeList();
                html.push(`<${kind}>`);
                listStack = kind;
            }
            html.push(`<li>${renderInline((unordered || ordered)[1])}</li>`);
            i += 1;
            continue;
        }

        if (!line.trim()) {
            flushParagraph();
            closeList();
            i += 1;
            continue;
        }

        paragraph.push(line.trim());
        i += 1;
    }
    flushParagraph();
    closeList();
    return html.join('\n');
}

module.exports = { markdownToHtml };
