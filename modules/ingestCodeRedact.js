/**
 * Verification-code helpers for the Ingest Controller (modules/ingestController.js, Yukimi Nov 19 2026).
 * Pure functions, no dependencies, so the MCP activity log (modules/mcpActivity.js) can use them too.
 *
 *   extractCodes(text)   -> { codes: ['123456'], links: ['https://...'] }   4-8 digit codes next to a
 *                           verification word, and sign-in / verify / confirm / reset links
 *   redactCodes(text)    -> the text with those codes and links replaced by [redacted]
 *
 * A code is a secret: it goes to Yukimi's devices through the notification inbox and nowhere else
 * (never a log line, the Exchange audit, MCP activity, or an agent hand-off).
 */
'use strict';

const WORDS = '(?:verification|verify|security|confirmation|confirm|authentication|authorization|login|log-in|sign[- ]?in|one[- ]time|single[- ]use|access|passcode|pass code|otp|2fa|pin|code|token|password)';
// "code is 123456", "verification code: 123 456", "your OTP 4821", "G-123456"
const BEFORE = new RegExp(`${WORDS}[^\\d\\n]{0,40}?(?:G-)?(\\d{3}[ -]\\d{3}|\\d{4,8})(?!\\d)(?![.,]\\d)(?!\\s?%)`, 'ig');
// "123456 is your verification code"
const AFTER = new RegExp(`(?<![\\d$.,-])(\\d{3}[ -]\\d{3}|\\d{4,8})(?!\\d)(?=[^\\n]{0,40}?${WORDS})`, 'ig');
const LINK = /https?:\/\/[^\s<>"')\]]+/ig;
const LINK_WORDS = /(verify|verification|confirm|activate|magic|sign-?in|log-?in|auth|token|otp|one-?time|passcode|reset)/i;
const TRIGGER = new RegExp(WORDS, 'i');

function digitsOf(s) { return String(s).replace(/\D/g, ''); }

function looksLikeYear(d, whole) { return d.length === 4 && /^(19|20)\d\d$/.test(d) && !new RegExp(`${WORDS}[^\\d\\n]{0,40}?${d}`, 'i').test(whole); }

function extractCodes(text) {
    const whole = String(text == null ? '' : text).slice(0, 20000);
    const codes = [];
    const links = [];
    if (!whole || !TRIGGER.test(whole)) return { codes, links };
    for (const re of [BEFORE, AFTER]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(whole))) {
            const d = digitsOf(m[1]);
            if (d.length < 4 || d.length > 8 || looksLikeYear(d, whole)) continue;
            if (!codes.includes(d)) codes.push(d);
            if (codes.length >= 4) break;
        }
    }
    LINK.lastIndex = 0;
    let l;
    while ((l = LINK.exec(whole))) {
        const url = l[0].replace(/[.,;]+$/, '');
        if (LINK_WORDS.test(url) && !links.includes(url)) links.push(url);
        if (links.length >= 2) break;
    }
    return { codes, links };
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** The text with verification codes and verification links replaced. Never throws. */
function redactCodes(text) {
    let out = String(text == null ? '' : text);
    if (!out || !TRIGGER.test(out)) return out;
    try {
        const { codes, links } = extractCodes(out);
        for (const l of links) out = out.split(l).join('[redacted link]');
        out = out.replace(BEFORE, (all, c) => (looksLikeYear(digitsOf(c), all) ? all : all.slice(0, all.length - c.length) + '[redacted]'));
        for (const c of codes) out = out.replace(new RegExp(`(?<!\\d)${escapeRe(c).split('').join('[ -]?')}(?!\\d)`, 'g'), '[redacted]');
        out = out.replace(AFTER, (all, c) => (looksLikeYear(digitsOf(c), all) ? all : all.replace(c, '[redacted]')));
    } catch (_) { /* leave what we have */ }
    return out;
}

module.exports = { extractCodes, redactCodes };
