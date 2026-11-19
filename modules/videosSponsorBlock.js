/**
 * Melaton Videos: SponsorBlock (Yozora #920). Yukimi, Nov 18 2026: "can we also intergrate with sponsor block to
 * auto skip segments that it marks".
 *
 * SponsorBlock (sponsor.ajay.app) is a crowd-sourced list of the parts of YouTube videos that are sponsor reads,
 * self-promotion, "like and subscribe" reminders and the like. Its data is CC BY-NC-SA 4.0 (the program's About
 * names it). The server asks, not the phone, and with SponsorBlock's privacy interface: only the first four
 * characters of the video id's SHA-256 are sent, the answer covers every video sharing them, and the one wanted is
 * picked out here. Answers are kept for 6 hours. A failure means no segments: nothing is skipped.
 */
'use strict';

const crypto = require('crypto');

const BASE = process.env.VIDEOS_SPONSORBLOCK_BASE || 'https://sponsor.ajay.app';
const VIDEO_ID = /^[\w-]{11}$/;
const CATEGORIES = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'music_offtopic'];
const TTL = 6 * 3600000;
const MAX = 400;
const memo = new Map(); // id -> { at, segments }
let fetcher = (...a) => fetch(...a);

/** The marked parts of a video: [{ start, end, category }] in seconds, in order (only whole-skip marks). */
async function segments(id) {
    if (!VIDEO_ID.test(String(id || ''))) return [];
    const held = memo.get(id);
    if (held && Date.now() - held.at < TTL) return held.segments;
    let out = [];
    try {
        const prefix = crypto.createHash('sha256').update(id).digest('hex').slice(0, 4);
        const res = await fetcher(`${BASE}/api/skipSegments/${prefix}?categories=${encodeURIComponent(JSON.stringify(CATEGORIES))}&actionTypes=${encodeURIComponent('["skip"]')}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
        if (res.status === 200) {
            const rows = await res.json();
            const mine = (Array.isArray(rows) ? rows : []).find((r) => r && r.videoID === id);
            out = ((mine && mine.segments) || [])
                .filter((s) => s && s.actionType === 'skip' && Array.isArray(s.segment) && s.segment[1] > s.segment[0] && CATEGORIES.includes(s.category))
                .map((s) => ({ start: Math.max(0, Math.round(s.segment[0] * 10) / 10), end: Math.round(s.segment[1] * 10) / 10, category: s.category }))
                .sort((a, b) => a.start - b.start);
        } else if (res.status !== 404) {
            return held ? held.segments : []; // not kept: asked again next time
        }
    } catch (_e) {
        return held ? held.segments : [];
    }
    if (memo.size >= MAX) memo.delete(memo.keys().next().value);
    memo.set(id, { at: Date.now(), segments: out });
    return out;
}

module.exports = { segments, CATEGORIES, _test: { setFetch(f) { fetcher = f || ((...a) => fetch(...a)); }, reset() { memo.clear(); } } };
