/**
 * Minimal inbound MIME: headers, text/plain from multipart, base64 and
 * quoted-printable. Not a general MIME library.
 */

'use strict';

function decodeQuotedPrintable(text) {
    const raw = String(text || '').replace(/=\r?\n/g, '');
    return raw.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeTransferEncoding(body, encoding) {
    const cte = String(encoding || '7bit').trim().toLowerCase();
    if (cte === 'base64') {
        return Buffer.from(String(body || '').replace(/\s+/g, ''), 'base64').toString('utf8');
    }
    if (cte === 'quoted-printable') return decodeQuotedPrintable(body);
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

function headerParam(value, name) {
    const match = String(value || '').match(new RegExp(`${name}\\s*=\\s*"?([^";\\s]+)"?`, 'i'));
    return match ? match[1] : '';
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
    const contentType = String(headers['content-type'] || 'text/plain').toLowerCase();
    const encoding = headers['content-transfer-encoding'] || '';
    return {
        contentType,
        headers,
        body: decodeTransferEncoding(body, encoding)
    };
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
        const plain = parts.find((part) => part.contentType.startsWith('text/plain'));
        const html = parts.find((part) => part.contentType.startsWith('text/html'));
        if (plain) {
            body = plain.body;
            format = 'text';
        } else if (html) {
            body = html.body;
            format = 'html';
        }
    } else {
        body = decodeTransferEncoding(body, encoding);
    }

    return { headers, body, format, contentType };
}

module.exports = {
    decodeQuotedPrintable,
    decodeTransferEncoding,
    parseHeaderBlock,
    extractTextBody
};
