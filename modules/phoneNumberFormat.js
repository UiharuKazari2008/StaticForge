/**
 * A phone number as Messaging shows an account's own number (Yozora #978, Yukimi Nov 20 2026: "extract only the
 * digits, then format as +<country code> <rest with dashes where they belong>"): +1 484-362-9855, +81 90-1234-5678,
 * +81 3-1234-5678, +44 7911-123456. The groups follow libphonenumber's national grouping for the countries the
 * household uses (NANP, Japan, the UK); any other country keeps its code and the rest in threes with a final four.
 *
 *   format(raw, { country = '1' })   raw: whatever the source gave ("(484) 362-9855", "+14843629855", "090-1234-5678");
 *                                    a number with no country code is taken as [country]'s (default NANP)
 */
'use strict';

// ITU country codes by length: one digit, then the two-digit ones; everything else is three digits
const CC1 = new Set(['1', '7']);
const CC2 = new Set(['20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58',
    '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98']);

function splitCountry(digits) {
    if (CC1.has(digits[0])) return [digits[0], digits.slice(1)];
    if (CC2.has(digits.slice(0, 2))) return [digits.slice(0, 2), digits.slice(2)];
    return [digits.slice(0, 3), digits.slice(3)];
}

const group = (s, sizes) => {
    const out = [];
    let at = 0;
    for (const n of sizes) { if (at >= s.length) break; out.push(s.slice(at, at + n)); at += n; }
    if (at < s.length) out[out.length - 1] += s.slice(at);
    return out.join('-');
};

/** The national part grouped for its country (no trunk 0). */
function national(cc, rest) {
    if (cc === '1' && rest.length === 10) return group(rest, [3, 3, 4]);
    if (cc === '81') {
        // mobile / IP / pager (70, 80, 90, 50, 20): 2-4-4; toll free 120: 3-3-3; Tokyo 3 / Osaka 6: 1-4-4; other areas 2-3-4
        if (rest.length === 10) return group(rest, [2, 4, 4]);
        if (/^120/.test(rest)) return group(rest, [3, 3, 3]);
        if (/^[36]/.test(rest)) return group(rest, [1, 4, 4]);
        return group(rest, [2, 3, 4]);
    }
    if (cc === '44') {
        if (/^7/.test(rest)) return group(rest, [4, 6]);
        if (/^2/.test(rest)) return group(rest, [2, 4, 4]);
        return group(rest, [4, 6]);
    }
    if (rest.length <= 4) return rest;
    const head = rest.slice(0, rest.length - 4);
    const groups = head.match(/.{1,3}/g) || [];
    return groups.concat(rest.slice(-4)).join('-');
}

function format(raw, { country = '1' } = {}) {
    const s = String(raw == null ? '' : raw).trim();
    let digits = s.replace(/\D/g, '');
    if (!digits) return s;
    let cc;
    let rest;
    if (s.startsWith('+') || s.startsWith('00')) {
        if (s.startsWith('00')) digits = digits.slice(2);
        [cc, rest] = splitCountry(digits);
    } else if (country === '1' && digits.length === 11 && digits[0] === '1') {
        cc = '1'; rest = digits.slice(1);
    } else if (country === '1' && digits.length === 10) {
        cc = '1'; rest = digits;
    } else if (country !== '1' && digits.startsWith('0')) {
        cc = country; rest = digits.slice(1);
    } else if (digits.length > 10) {
        [cc, rest] = splitCountry(digits);
    } else {
        cc = country; rest = digits;
    }
    // a trunk 0 written after the country code (+81 090...) is not dialled
    if (cc !== '1' && rest.startsWith('0')) rest = rest.slice(1);
    return `+${cc} ${national(cc, rest)}`;
}

module.exports = { format };
