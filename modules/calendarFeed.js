/**
 * GET /calendar-feed?url=<webcal / https URL> (Yozora #632): Windows Calendar's Subscribe. The client
 * (apps/calendar) cannot read another site's .ics itself, so the server fetches it: public hosts
 * only, every redirect hop checked (sidebarGadgets.assertPublicHttps, DNS too), webcal:// and http://
 * asked for over https, at most 4 MB, kept 10 minutes. Only an iCalendar text comes back, as
 * text/plain with a sandbox CSP; the client parses it as data (it never goes into the page as HTML).
 */
'use strict';

const { STATUS_CODES } = require('http');
const sidebarGadgets = require('./sidebarGadgets');

const MAX_BYTES = 4 * 1024 * 1024;
const TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 32;
const cache = new Map();

function httpsOf(raw) {
    const s = String(raw || '').trim();
    if (/^webcals?:\/\//i.test(s)) return s.replace(/^webcals?:\/\//i, 'https://');
    if (/^http:\/\//i.test(s)) return s.replace(/^http:\/\//i, 'https://');
    return s;
}

async function fetchCalendar(raw) {
    let current = httpsOf(raw);
    for (let hop = 0; hop < 5; hop += 1) {
        const url = await sidebarGadgets.assertPublicHttps(current);
        // WinCal puts a host it cannot reach back on page 1 with the address selected, no error page
        if (!url) return { error: 'That address cannot be used (public https or webcal only).', unreachable: true };
        let res;
        try {
            res = await fetch(url.href, {
                redirect: 'manual',
                signal: AbortSignal.timeout(10000),
                headers: { 'User-Agent': 'Dreamscape Calendar', Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5' }
            });
        } catch (err) {
            return { error: `The calendar could not be reached (${err.name === 'TimeoutError' ? 'timed out' : 'network error'}).`, unreachable: true };
        }
        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('location');
            if (!loc) return { error: 'The calendar moved without saying where.' };
            current = httpsOf(new URL(loc, url).href);
            continue;
        }
        // WinCal string 5145, "Error %1!d!: %2!s!" with the server's reason phrase
        if (!res.ok) return { error: `Error ${res.status}: ${res.statusText || STATUS_CODES[res.status] || ''}`.trim() };
        if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) return { error: 'The calendar is larger than 4 MB.' };
        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_BYTES) return { error: 'The calendar is larger than 4 MB.' };
        const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
        if (!/^﻿?\s*BEGIN:VCALENDAR/i.test(text)) return { error: 'That address is not an iCalendar (.ics) file.' };
        return { text, url: url.href };
    }
    return { error: 'Too many redirects.' };
}

async function handle(req, res) {
    const raw = String(req.query.url || '');
    if (!raw || raw.length > 2000) { res.status(400).json({ success: false, error: 'No calendar address.' }); return; }
    const key = httpsOf(raw);
    const hit = cache.get(key);
    let out = hit && hit.until > Date.now() ? hit.out : null;
    if (!out) {
        out = await fetchCalendar(raw);
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
        cache.set(key, { out, until: Date.now() + (out.error ? 60 * 1000 : TTL_MS) });
    }
    if (out.error) { res.status(502).json({ success: false, error: out.error, unreachable: !!out.unreachable }); return; }
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Security-Policy', "sandbox; default-src 'none'");
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, max-age=60');
    res.send(out.text);
}

module.exports = { handle, fetchCalendar, httpsOf };
