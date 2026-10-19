/**
 * Minimal inbound MIME: headers, text/plain from multipart (one nested
 * level), base64 and quoted-printable using the declared charset.
 * Not a general MIME library.
 */

'use strict';

function headerParam(value, name) {
    const match = String(value || '').match(new RegExp(`${name}\\s*=\\s*"?([^";\\s]+)"?`, 'i'));
    return match ? match[1] : '';
}

function charsetOf(contentType, fallback) {
    return headerParam(contentType, 'charset') || fallback || 'utf-8';
}

function decodeCharset(buf, charset) {
    const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    const cs = String(charset || 'utf-8').trim().toLowerCase();
    const alias = {
        utf8: 'utf-8',
        'us-ascii': 'utf-8',
        ascii: 'utf-8',
        latin1: 'windows-1252',
        'iso-8859-1': 'windows-1252',
        cp1252: 'windows-1252'
    };
    const enc = alias[cs] || cs;
    try {
        return new TextDecoder(enc).decode(raw);
    } catch (_err) {
        return raw.toString('utf8');
    }
}

function decodeQuotedPrintableBytes(text) {
    const raw = String(text || '').replace(/=\r?\n/g, '');
    const bytes = [];
    for (let i = 0; i < raw.length; i++) {
        if (raw[i] === '=' && /^[0-9A-Fa-f]{2}/.test(raw.slice(i + 1, i + 3))) {
            bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
            i += 2;
        } else {
            bytes.push(raw.charCodeAt(i) & 0xff);
        }
    }
    return Buffer.from(bytes);
}

function decodeQuotedPrintable(text, charset) {
    return decodeCharset(decodeQuotedPrintableBytes(text), charset || 'utf-8');
}

function decodeTransferEncoding(body, encoding, charset) {
    const cte = String(encoding || '7bit').trim().toLowerCase();
    if (cte === 'base64') {
        return decodeCharset(Buffer.from(String(body || '').replace(/\s+/g, ''), 'base64'), charset);
    }
    if (cte === 'quoted-printable') return decodeQuotedPrintable(body, charset);
    return String(body || '');
}

function parseHeaderBlock(headerBlock) {
    const headers = Object.create(null);
    let current = '';
    for (const line of String(headerBlock || '').split('\n')) {
        if (/^[ \t]/.test(line) && current) {
            headers[current] += ` ${line.trim()}`;
            continue;
        }
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        current = line.slice(0, colon).trim().toLowerCase();
        headers[current] = line.slice(colon + 1).trim();
    }
    return headers;
}

function splitMultipart(body, boundary) {
    if (!boundary) return [];
    const token = `--${boundary}`;
    const parts = String(body || '').split(token);
    const out = [];
    for (const part of parts) {
        let text = part;
        if (text.startsWith('--')) break;
        if (text.startsWith('\r\n')) text = text.slice(2);
        else if (text.startsWith('\n')) text = text.slice(1);
        text = text.replace(/\r?\n$/, '');
        if (!text.trim()) continue;
        out.push(text);
    }
    return out;
}

function decodePart(raw) {
    const split = raw.indexOf('\n\n');
    const headerBlock = split === -1 ? raw : raw.slice(0, split);
    const body = split === -1 ? '' : raw.slice(split + 2);
    const headers = parseHeaderBlock(headerBlock.replace(/\r\n/g, '\n'));
    const contentType = String(headers['content-type'] || 'text/plain');
    const encoding = headers['content-transfer-encoding'] || '';
    const charset = charsetOf(contentType);
    const multipart = /multipart\//i.test(contentType);
    return {
        contentType: contentType.toLowerCase(),
        headers,
        body: multipart ? body : decodeTransferEncoding(body, encoding, charset)
    };
}

function collectTextParts(parts, nestLeft) {
    const found = [];
    for (const part of parts) {
        if (part.contentType.startsWith('text/plain') || part.contentType.startsWith('text/html')) {
            found.push(part);
        } else if (nestLeft > 0 && /multipart\//i.test(part.contentType)) {
            const boundary = headerParam(part.headers['content-type'] || '', 'boundary');
            const nested = splitMultipart(part.body, boundary).map(decodePart);
            found.push(...collectTextParts(nested, nestLeft - 1));
        }
    }
    return found;
}

function pickText(parts) {
    const plain = parts.find((part) => part.contentType.startsWith('text/plain'));
    const html = parts.find((part) => part.contentType.startsWith('text/html'));
    if (plain) return { body: plain.body, format: 'text' };
    if (html) return { body: html.body, format: 'html' };
    return null;
}

function extractTextBody(rawMessage) {
    const text = String(rawMessage || '').replace(/\r\n/g, '\n');
    const split = text.indexOf('\n\n');
    const headerBlock = split === -1 ? text : text.slice(0, split);
    const rawBody = split === -1 ? '' : text.slice(split + 2);
    const headers = parseHeaderBlock(headerBlock);
    const contentType = String(headers['content-type'] || 'text/plain');
    const encoding = headers['content-transfer-encoding'] || '';
    let body = rawBody.replace(/\n$/, '');
    let format = contentType.toLowerCase().includes('text/html') ? 'html' : 'text';

    if (/multipart\//i.test(contentType)) {
        const boundary = headerParam(contentType, 'boundary');
        const parts = splitMultipart(body, boundary).map(decodePart);
        const picked = pickText(collectTextParts(parts, 1));
        if (picked) {
            body = picked.body;
            format = picked.format;
        }
    } else {
        body = decodeTransferEncoding(body, encoding, charsetOf(contentType));
    }

    return { headers, body, format, contentType };
}

module.exports = {
    decodeQuotedPrintable,
    decodeTransferEncoding,
    parseHeaderBlock,
    extractTextBody
};
