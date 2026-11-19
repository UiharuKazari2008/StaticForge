/**
 * RFC 2047 encoded-word decoding for mail headers (Subject, From, To, Cc, …).
 * Handles B and Q encodings, multiple charsets, language tags (RFC 2231),
 * and the rule that linear whitespace between adjacent encoded-words is
 * deleted. Decoding an already-decoded string is a no-op.
 */

'use strict';

const TEXT_HEADERS = new Set([
    'subject', 'from', 'to', 'cc', 'bcc', 'reply-to', 'sender',
    'comments', 'keywords', 'organization', 'list-id', 'thread-topic'
]);

const CHARSET_ALIAS = {
    utf8: 'utf-8',
    'us-ascii': 'utf-8',
    ascii: 'utf-8',
    latin1: 'windows-1252',
    'iso-8859-1': 'windows-1252',
    cp1252: 'windows-1252',
    'ks_c_5601-1987': 'euc-kr',
    'ks_c_5601': 'euc-kr',
    'gb2312': 'gb18030',
    'gbk': 'gb18030',
    'shift-jis': 'shift_jis',
    'shift_jis': 'shift_jis',
    sjis: 'shift_jis',
    'windows-31j': 'shift_jis'
};

// charset, optional *language, encoding, encoded-text
const ENCODED_WORD = /=\?([A-Za-z0-9][A-Za-z0-9_.:-]*)(?:\*[^\?]*)?\?([BQbq])\?([^?]*)\?=/g;

function hasEncodedWord(value) {
    if (typeof value !== 'string' || value.indexOf('=?') === -1) return false;
    ENCODED_WORD.lastIndex = 0;
    return ENCODED_WORD.test(value);
}

function decodeCharset(buf, charset) {
    const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    const cs = String(charset || 'utf-8').trim().toLowerCase();
    const enc = CHARSET_ALIAS[cs] || cs;
    try {
        return new TextDecoder(enc).decode(raw);
    } catch (_err) {
        try {
            return new TextDecoder('utf-8').decode(raw);
        } catch (_err2) {
            return raw.toString('utf8');
        }
    }
}

function decodeQBytes(encoded) {
    const raw = String(encoded || '').replace(/_/g, ' ');
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

function decodeOneWord(charset, encoding, encoded) {
    try {
        const kind = String(encoding || '').toUpperCase();
        if (kind === 'B') {
            const compact = String(encoded || '').replace(/\s+/g, '');
            if (!compact) return '';
            return decodeCharset(Buffer.from(compact, 'base64'), charset);
        }
        if (kind === 'Q') {
            return decodeCharset(decodeQBytes(encoded), charset);
        }
        return null;
    } catch (_err) {
        return null;
    }
}

/**
 * Decode RFC 2047 encoded-words in an unstructured header value.
 * Whitespace (space, tab, CR, LF) between adjacent encoded-words is removed.
 * Text next to an encoded-word, including a single space before regular words,
 * is kept. Invalid encoded-words are left unchanged.
 */
function decodeRfc2047(input) {
    if (input == null) return '';
    const text = String(input);
    if (text.indexOf('=?') === -1) return text;
    let out = '';
    let last = 0;
    let lastWasWord = false;
    const re = new RegExp(ENCODED_WORD.source, 'g');
    let match;
    while ((match = re.exec(text)) !== null) {
        const gap = text.slice(last, match.index);
        if (!(lastWasWord && /^[ \t\r\n]*$/.test(gap))) out += gap;
        const decoded = decodeOneWord(match[1], match[2], match[3]);
        if (decoded === null) {
            out += match[0];
            lastWasWord = false;
        } else {
            out += decoded;
            lastWasWord = true;
        }
        last = re.lastIndex;
    }
    out += text.slice(last);
    return out;
}

function decodeTextHeaders(headers) {
    if (!headers || typeof headers !== 'object') return headers;
    for (const key of Object.keys(headers)) {
        if (TEXT_HEADERS.has(String(key).toLowerCase()) && typeof headers[key] === 'string') {
            headers[key] = decodeRfc2047(headers[key]);
        }
    }
    return headers;
}

function decodeAddressNames(list) {
    if (!Array.isArray(list)) return list;
    return list.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        if (typeof entry.name === 'string' && entry.name.indexOf('=?') !== -1) {
            return Object.assign({}, entry, { name: decodeRfc2047(entry.name) });
        }
        return entry;
    });
}

module.exports = {
    TEXT_HEADERS,
    needsRfc2047Decode: hasEncodedWord,
    decodeRfc2047,
    decodeTextHeaders,
    decodeAddressNames,
    decodeCharset
};
