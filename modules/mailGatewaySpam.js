/**
 * Inbound spam classification from LANTIS relay headers.
 *
 * MTAs prepend. Only the hop that just delivered the message is trusted:
 * headers above the original From / Subject / Date / To / … block. For each
 * name, the topmost instance in that prefix wins. Authentication-Results may
 * instead be selected by a configured authserv-id (first matching id in the
 * prefix). Sender-supplied copies further down are ignored. X-Spam-Flag: NO
 * never rescues a trusted Yes / fail mark.
 */

'use strict';

const FAIL_RESULTS = new Set(['fail', 'softfail', 'permerror']);

const ORIGINATION_HEADERS = new Set([
    'from', 'sender', 'resent-from', 'resent-sender',
    'to', 'cc', 'bcc', 'reply-to', 'resent-to', 'resent-cc',
    'date', 'resent-date',
    'subject',
    'message-id', 'resent-message-id',
    'mime-version', 'content-type', 'content-transfer-encoding'
]);

const DEFAULT_SPAM_CONFIG = Object.freeze({
    flagHeader: 'X-Spam-Flag',
    statusHeader: 'X-Spam-Status',
    authenticationResultsHeader: 'Authentication-Results',
    receivedSpfHeader: 'Received-SPF',
    authservId: ''
});

function headerNameList(value, fallback) {
    const raw = value == null || value === '' ? fallback : value;
    const list = Array.isArray(raw) ? raw : String(raw).split(',');
    return list.map((name) => String(name || '').trim().toLowerCase()).filter(Boolean);
}

function resolveSpamConfig(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
        flagHeader: src.flagHeader ? String(src.flagHeader) : DEFAULT_SPAM_CONFIG.flagHeader,
        statusHeader: src.statusHeader ? String(src.statusHeader) : DEFAULT_SPAM_CONFIG.statusHeader,
        authenticationResultsHeader: src.authenticationResultsHeader
            ? String(src.authenticationResultsHeader)
            : DEFAULT_SPAM_CONFIG.authenticationResultsHeader,
        receivedSpfHeader: src.receivedSpfHeader
            ? String(src.receivedSpfHeader)
            : DEFAULT_SPAM_CONFIG.receivedSpfHeader,
        authservId: src.authservId != null ? String(src.authservId).trim() : DEFAULT_SPAM_CONFIG.authservId
    };
}

function collectHeaderValues(headerBlock) {
    const headers = Object.create(null);
    let current = '';
    const text = String(headerBlock || '').replace(/\r\n/g, '\n');
    for (const line of text.split('\n')) {
        if (/^[ \t]/.test(line) && current && headers[current] && headers[current].length) {
            headers[current][headers[current].length - 1] += ` ${line.trim()}`;
            continue;
        }
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        current = line.slice(0, colon).trim().toLowerCase();
        if (!current) continue;
        // Original-message headers start the sender-controlled block. Relay
        // marks are prepended above them; anything at or below is untrusted.
        if (ORIGINATION_HEADERS.has(current)) break;
        if (!headers[current]) headers[current] = [];
        headers[current].push(line.slice(colon + 1).trim());
    }
    return headers;
}

function valuesFor(collected, names) {
    const out = [];
    headerNameList(names).forEach((name) => {
        (collected[name] || []).forEach((value) => out.push(value));
    });
    return out;
}

function topmostValue(collected, names) {
    const values = valuesFor(collected, names);
    return values.length ? values[0] : '';
}

function authservIdOf(value) {
    const first = String(value || '').trim().split(/[;\s]/)[0] || '';
    return first.replace(/^<|>$/g, '').toLowerCase();
}

function trustedAuthResults(collected, names, authservId) {
    const values = valuesFor(collected, names);
    if (!values.length) return [];
    const wanted = String(authservId || '').trim().toLowerCase();
    if (!wanted) return [values[0]];
    const match = values.find((value) => authservIdOf(value) === wanted);
    return match ? [match] : [];
}

function isYesToken(value) {
    return /^\s*yes\b/i.test(String(value || ''));
}

function isFailResult(value) {
    const token = String(value || '').trim().split(/[\s;]/)[0].toLowerCase();
    return FAIL_RESULTS.has(token);
}

function authMethodFailed(value) {
    return /\b(?:spf|dkim|dmarc)\s*=\s*(?:fail|softfail|permerror)\b/i.test(String(value || ''));
}

/**
 * Classify a raw RFC5322 header block. Does not look at the body.
 * Returns { spam, reasons } — spam is true only from trusted relay marks.
 */
function isInboundSpam(headerBlock, config) {
    const cfg = resolveSpamConfig(config);
    const collected = collectHeaderValues(headerBlock);
    const reasons = [];

    const flag = topmostValue(collected, cfg.flagHeader);
    if (isYesToken(flag)) reasons.push('spam-flag');

    const status = topmostValue(collected, cfg.statusHeader);
    if (isYesToken(status)) reasons.push('spam-status');

    const receivedSpf = topmostValue(collected, cfg.receivedSpfHeader);
    if (isFailResult(receivedSpf)) reasons.push('received-spf');

    const authResults = trustedAuthResults(
        collected,
        cfg.authenticationResultsHeader,
        cfg.authservId
    );
    if (authResults.some(authMethodFailed)) reasons.push('authentication-results');

    return { spam: reasons.length > 0, reasons };
}

module.exports = {
    DEFAULT_SPAM_CONFIG,
    FAIL_RESULTS,
    ORIGINATION_HEADERS,
    resolveSpamConfig,
    collectHeaderValues,
    isInboundSpam
};
