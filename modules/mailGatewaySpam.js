/**
 * Inbound spam classification from LANTIS relay headers.
 *
 * MTAs prepend. Only the hop that just delivered the message is trusted:
 * headers above the topmost Received (the relay stamp) or, if that is
 * missing, above the original From / Subject / Date / To / … block. For
 * each name, the topmost instance in that prefix wins. Authentication-Results
 * is trusted only when its authserv-id matches the configured relay id
 * (default mx.dream.737.jp.net). The relay strips inbound X-Spam-* and
 * forged A-R with that id before stamping; sender copies further down are
 * still ignored. X-Spam-Flag: NO never rescues a trusted Yes. Folder
 * decision is Flag YES, Status Yes, or trusted A-R dmarc=fail with
 * p=quarantine / dis=QUARANTINE. DKIM fail, dmarc p=none, and Received-SPF
 * are display-only. Header names stay configurable.
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

// First Received is the relay's own stamp. Everything at or below it is
// a previous hop or the original message.
const TRUST_CUTOFF_HEADERS = new Set(['received', ...ORIGINATION_HEADERS]);

const DEFAULT_SPAM_CONFIG = Object.freeze({
    flagHeader: 'X-Spam-Flag',
    statusHeader: 'X-Spam-Status',
    authenticationResultsHeader: 'Authentication-Results',
    receivedSpfHeader: 'Received-SPF',
    reportHeader: 'X-Spam-Report',
    originalToHeader: 'X-Original-To',
    authservId: 'mx.dream.737.jp.net'
});

const MAX_REPORT_CHARS = 16384;

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
        reportHeader: src.reportHeader ? String(src.reportHeader) : DEFAULT_SPAM_CONFIG.reportHeader,
        originalToHeader: src.originalToHeader ? String(src.originalToHeader) : DEFAULT_SPAM_CONFIG.originalToHeader,
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
        if (TRUST_CUTOFF_HEADERS.has(current)) break;
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
    if (!wanted) return [];
    const match = values.find((value) => authservIdOf(value) === wanted);
    return match ? [match] : [];
}

function isYesToken(value) {
    return /^\s*yes\b/i.test(String(value || ''));
}

function parseSpamStatus(value) {
    const raw = String(value || '').trim();
    const match = raw.match(
        /^(yes|no)\b(?:\s*,\s*)?(?:score\s*=\s*([+-]?\d+(?:\.\d+)?))?(?:\s+required\s*=\s*([+-]?\d+(?:\.\d+)?))?/i
    );
    const testsMatch = raw.match(/\btests\s*=\s*(\S+)/i);
    const tests = testsMatch
        ? testsMatch[1].split(',').map((token) => token.trim()).filter(Boolean)
        : [];
    if (!match) {
        return { yes: false, no: false, score: null, required: null, tests, forgedOurs: hasForgedOurs(tests, raw), raw };
    }
    return {
        yes: /^yes$/i.test(match[1]),
        no: /^no$/i.test(match[1]),
        score: match[2] != null ? Number(match[2]) : null,
        required: match[3] != null ? Number(match[3]) : null,
        tests,
        forgedOurs: hasForgedOurs(tests, raw),
        raw
    };
}

function hasForgedOurs(tests, raw) {
    if ((tests || []).some((token) => /^LANTIS_FORGED_OURS$/i.test(token))) return true;
    return /\bLANTIS_FORGED_OURS\b/i.test(String(raw || ''));
}

function spfResultOf(value) {
    return String(value || '').trim().split(/[\s;]/)[0].toLowerCase();
}

function authMethodValue(value, method) {
    const match = String(value || '').match(new RegExp(`\\b${method}\\s*=\\s*(\\w+)`, 'i'));
    return match ? match[1].toLowerCase() : '';
}

function parseDmarcComment(value) {
    const text = String(value || '');
    const dmarc = text.match(/\bdmarc\s*=\s*(\w+)([^;]*)/i);
    if (!dmarc) return { result: '', p: '', dis: '', quarantine: false };
    const result = dmarc[1].toLowerCase();
    const rest = dmarc[2] || '';
    const p = ((rest.match(/\bp\s*=\s*(\w+)/i) || [])[1] || '').toLowerCase();
    const dis = ((rest.match(/\bdis\s*=\s*(\w+)/i) || [])[1] || '').toLowerCase();
    return {
        result,
        p,
        dis,
        quarantine: result === 'fail' && (p === 'quarantine' || dis === 'quarantine')
    };
}

function clipReport(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.length > MAX_REPORT_CHARS ? text.slice(0, MAX_REPORT_CHARS) : text;
}

/**
 * Classify a raw RFC5322 header block. Does not look at the body.
 * Folder decision: Flag YES, Status Yes, or trusted A-R dmarc=fail
 * with p=quarantine / dis=QUARANTINE. Everything else is display-only.
 */
function isInboundSpam(headerBlock, config) {
    const cfg = resolveSpamConfig(config);
    const collected = collectHeaderValues(headerBlock);
    const reasons = [];

    const flag = topmostValue(collected, cfg.flagHeader);
    if (isYesToken(flag)) reasons.push('spam-flag');

    const status = parseSpamStatus(topmostValue(collected, cfg.statusHeader));
    if (status.yes) reasons.push('spam-status');

    const receivedSpfRaw = topmostValue(collected, cfg.receivedSpfHeader);
    const receivedSpf = spfResultOf(receivedSpfRaw);

    const authResults = trustedAuthResults(
        collected,
        cfg.authenticationResultsHeader,
        cfg.authservId
    );
    const trustedAr = authResults[0] || '';
    const dmarc = parseDmarcComment(trustedAr);
    if (dmarc.quarantine) reasons.push('dmarc-quarantine');

    const report = clipReport(topmostValue(collected, cfg.reportHeader));
    const forgedOurs = status.forgedOurs || hasForgedOurs([], report);

    return {
        spam: reasons.length > 0,
        reasons,
        flag: flag || '',
        status: status.raw,
        score: status.score,
        required: status.required,
        tests: status.tests,
        forgedOurs,
        report,
        receivedSpf,
        dkim: authMethodValue(trustedAr, 'dkim'),
        dmarc: dmarc.result,
        dmarcP: dmarc.p,
        dmarcDis: dmarc.dis
    };
}

/**
 * Relay-stamped X-Original-To from the trusted top block only (above the
 * first Received / origination header). Lower and duplicate copies are
 * ignored. Display only — never used to pick a mailbox.
 */
function trustedOriginalTo(headerBlock, rawConfig) {
    const cfg = resolveSpamConfig(rawConfig);
    const collected = collectHeaderValues(headerBlock);
    const raw = topmostValue(collected, cfg.originalToHeader);
    if (!raw) return null;
    const angled = raw.match(/<([^<>]+)>/);
    let value = (angled ? angled[1] : raw).trim().replace(/[\r\n]+/g, ' ');
    if (value.includes('@')) value = value.toLowerCase();
    value = value.slice(0, 320);
    return value || null;
}

function displayMeta(mark) {
    if (!mark || typeof mark !== 'object') return null;
    const meta = {};
    if (mark.score != null && Number.isFinite(mark.score)) meta.score = mark.score;
    if (mark.required != null && Number.isFinite(mark.required)) meta.required = mark.required;
    if (mark.report) meta.report = String(mark.report);
    if (mark.status) meta.status = String(mark.status);
    if (mark.flag) meta.flag = String(mark.flag);
    if (mark.receivedSpf) meta.receivedSpf = String(mark.receivedSpf);
    if (mark.dkim) meta.dkim = String(mark.dkim);
    if (mark.dmarc) meta.dmarc = String(mark.dmarc);
    if (mark.dmarcP) meta.dmarcP = String(mark.dmarcP);
    if (mark.dmarcDis) meta.dmarcDis = String(mark.dmarcDis);
    if (mark.forgedOurs) meta.forgedOurs = true;
    return Object.keys(meta).length ? meta : null;
}

module.exports = {
    DEFAULT_SPAM_CONFIG,
    FAIL_RESULTS,
    ORIGINATION_HEADERS,
    TRUST_CUTOFF_HEADERS,
    resolveSpamConfig,
    collectHeaderValues,
    parseSpamStatus,
    parseDmarcComment,
    displayMeta,
    isInboundSpam,
    trustedOriginalTo
};
