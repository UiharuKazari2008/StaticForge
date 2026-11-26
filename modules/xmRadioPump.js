'use strict';
/**
 * XM Radio's segment pump (Yozora #989): one SiriusXM channel followed on the server, its new segments fetched,
 * decrypted (AES-128-CBC, the playlist's key through modules/xmRadio.js keyBytes) and handed on as plain ADTS AAC.
 * It feeds the low-bandwidth relay (Opus through ffmpeg) and the cassette deck's recorder; neither needs a client.
 *
 *   const pump = createPump({ channelId, quality: 'hi' | 'std' | 'low', tune, keyBytes, log })
 *   pump.on('segment', ({ seq, pdt (ms), dur (s), adts (Buffer), plain (Buffer: decrypted, its ID3 kept) }) => ...)
 *   pump.on('error', (err) => ...)        a fatal stop (signed out, the channel left the plan; persistent: the plan only)
 *   pump.on('gap', ({ from, to }) => ...) audio that left SiriusXM's window before it was fetched (ms): a hole, never spliced
 *   pump.on('pause' | 'refetch' | 'state') a pause began (the buffer ran thin), a segment was fetched again, the state changed
 *   pump.stats()                          { state, bufferSegs, behindS, paused, pauses, refetches, caughtUp }
 *   pump.start({ back: 0, from? })        back: start this many seconds behind live; from (ms): carry on exactly there (a
 *                                         recording that resumes: audio missing since then is a gap, not a silent skip)
 *   pump.stop()                           stops pulling new segments; awaits one already being fetched, so a recorder
 *                                         handing over to a new process does not cut a segment in half
 *
 * Buffer health (Yozora #1252 S6, Yukimi Nov 26 2026): the pump never fetches closer to the live edge than `healthyBuffer`
 * whole segments (the newest ones wait until that many newer ones exist), so a stall at the live edge cannot cost audio. A
 * segment is verified before it is handed on (Content-Length, AES, ADTS frames to the last byte) and fetched again by the same
 * address when it fails (the same URL is the same bytes). Audio that left the window before it was fetched is a `gap`.
 *
 * Read by program date-time, not sequence numbers: when SiriusXM's signed stream address expires mid-recording the
 * pump tunes again and carries on from the last instant it had, with no gap and no repeat.
 */

const { EventEmitter } = require('events');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const TIMEOUT_MS = 20000;
const BANDWIDTH = { hi: 256000, std: 128000, low: 32000 };

async function getText(url) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.siriusxm.com/' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return r.text();
}

/** A segment's body and the length its response declared (null when it declared none, or the body was content-encoded). */
async function getBytes(url) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.siriusxm.com/' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    const h = r.headers && typeof r.headers.get === 'function' ? r.headers : null;
    const declared = h && !h.get('content-encoding') && /^\d+$/.test(h.get('content-length') || '') ? Number(h.get('content-length')) : null;
    let body;
    try { body = Buffer.from(await r.arrayBuffer()); } catch (err) { throw Object.assign(new Error(`body cut short: ${err.message}`), { integrity: true }); }
    return { body, declared };
}

/** The variant of a master playlist nearest the wanted bandwidth. */
function pickVariant(master, base, quality) {
    const want = BANDWIDTH[quality] || BANDWIDTH.hi;
    const lines = master.split('\n');
    let best = null;
    for (let i = 0; i < lines.length; i++) {
        const m = /^#EXT-X-STREAM-INF:.*?BANDWIDTH=(\d+)/.exec(lines[i]);
        if (!m) continue;
        const uri = (lines[i + 1] || '').trim();
        if (!uri || uri.startsWith('#')) continue;
        const bw = Number(m[1]);
        if (!best || Math.abs(bw - want) < Math.abs(best.bw - want)) best = { bw, url: new URL(uri, base).href };
    }
    return best ? best.url : null;
}

/** A media playlist's segments: { seq, url, dur, pdt (ms), keyUri, iv (Buffer|null) }. */
function parseMedia(text, base) {
    const out = [];
    let seq = 0;
    let pdt = null;
    let dur = 0;
    let key = null;
    let iv = null;
    for (const raw of text.split('\n')) {
        const l = raw.trim();
        if (!l) continue;
        let m;
        if ((m = /^#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(l))) seq = Number(m[1]);
        else if ((m = /^#EXT-X-PROGRAM-DATE-TIME:(.+)$/.exec(l))) pdt = Date.parse(m[1]);
        else if ((m = /^#EXTINF:([\d.]+)/.exec(l))) dur = Number(m[1]);
        else if (l.startsWith('#EXT-X-KEY')) {
            const u = /URI="([^"]+)"/.exec(l);
            const v = /IV=0x([0-9a-f]+)/i.exec(l);
            key = u ? new URL(u[1], base).href : null;
            iv = v ? Buffer.from(v[1].padStart(32, '0'), 'hex') : null;
        } else if (!l.startsWith('#')) {
            out.push({ seq, url: new URL(l, base).href, dur, pdt, keyUri: key, iv });
            if (pdt != null) pdt += dur * 1000;
            seq += 1;
        }
    }
    return out;
}

/** A segment's audio without its leading ID3 tags (each segment opens with one: a timestamp). */
function stripId3(buf) {
    let off = 0;
    while (off + 10 <= buf.length && buf.toString('latin1', off, off + 3) === 'ID3') {
        const size = ((buf[off + 6] & 0x7f) << 21) | ((buf[off + 7] & 0x7f) << 14) | ((buf[off + 8] & 0x7f) << 7) | (buf[off + 9] & 0x7f);
        const footer = (buf[off + 5] & 0x10) ? 10 : 0;
        off += 10 + size + footer;
    }
    return off ? buf.subarray(off) : buf;
}

/** Do the ADTS frames parse cleanly to the last byte? (a truncated or corrupt segment does not; returns the frame count, or 0) */
function adtsClean(buf) {
    let off = 0;
    let n = 0;
    while (off < buf.length) {
        if (off + 7 > buf.length || buf[off] !== 0xff || (buf[off + 1] & 0xf6) !== 0xf0) return 0;
        const len = ((buf[off + 3] & 0x03) << 11) | (buf[off + 4] << 3) | (buf[off + 5] >> 5);
        if (len < 7 || off + len > buf.length) return 0;
        off += len;
        n += 1;
    }
    return n;
}

function decrypt(data, key, iv, seq) {
    let ivBuf = iv;
    if (!ivBuf) {
        ivBuf = Buffer.alloc(16);
        ivBuf.writeUInt32BE(seq >>> 0, 12);
    }
    const d = crypto.createDecipheriv('aes-128-cbc', key, ivBuf);
    return Buffer.concat([d.update(data), d.final()]);
}

const DEFAULTS = { healthyBuffer: 3, behindSeconds: 120, refetchRetries: 3 };
const sleepMs = (ms) => new Promise((ok) => { const t = setTimeout(ok, ms); if (t.unref) t.unref(); });

/**
 * opts: { channelId, quality, tune, keyBytes, log, persistent,
 *         settings: () => ({ healthyBuffer, behindSeconds, refetchRetries }) read on every tick (the console changes them live),
 *         now, sleep, pollMs: test hooks (clock, backoff sleep, a fixed poll interval) }
 */
function createPump({ channelId, quality = 'hi', tune, keyBytes, log = () => {}, persistent = false, settings, now = Date.now, sleep = sleepMs, pollMs = 0 }) {
    const ev = new EventEmitter();
    let running = false;
    let timer = null;
    let ticking = null; // the tick in flight (a segment fetch), so stop() can wait for it to land
    let variant = null;
    let lastEnd = 0; // ms: the end of the last segment handed on
    let failures = 0;
    const keys = new Map();
    // buffer health
    let anchored = false; // a position that audio must follow without a hole (a segment was handed on, or `from` was given)
    let emitted = 0;
    let lastProgressAt = 0; // when a segment was last handed on
    let paused = false;
    let pauses = 0;
    let refetches = 0;
    let bufferSegs = 0;
    let behindS = 0;
    let reaching = false; // a deliberate reach-back (the start's `back`, a resume) is still being caught up: not "behind"
    let stateNow = 'buffering';
    let liveEndMs = 0; // the live edge as the last playlist read had it, and its segment length
    let segLenMs = 6000;

    const cfg = () => {
        const c = (typeof settings === 'function' ? settings() : null) || {};
        const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
        return {
            healthyBuffer: Math.floor(num(c.healthyBuffer, DEFAULTS.healthyBuffer, 0, 60)),
            behindSeconds: num(c.behindSeconds, DEFAULTS.behindSeconds, 1, 86400),
            refetchRetries: Math.floor(num(c.refetchRetries, DEFAULTS.refetchRetries, 0, 20))
        };
    };

    function setState(next) {
        if (next === stateNow) return;
        stateNow = next;
        ev.emit('state', next);
    }

    /**
     * The state after a tick, a failed one too (a stalled fetch is how it falls behind). behind: seconds past where a healthy
     * position stands (the live edge less the buffer kept back). paused: nothing could be fetched and the buffer did not
     * refill (a stall at the live edge), or fewer than the healthy buffer is there at all; it carries on, in order, as soon
     * as the buffer is back.
     */
    function health(c, got) {
        if (!liveEndMs) return;
        behindS = Math.max(0, Math.round((liveEndMs - lastEnd - c.healthyBuffer * segLenMs) / 1000));
        if (reaching && behindS <= c.behindSeconds) reaching = false;
        if (got > 0) paused = false;
        else if (emitted > 0 && !paused && (bufferSegs < c.healthyBuffer || now() - lastProgressAt > 2.5 * segLenMs)) {
            paused = true;
            pauses += 1;
            ev.emit('pause', { at: now(), bufferSegs });
        }
        setState(paused ? 'paused-refilling' : (!reaching && behindS > c.behindSeconds ? 'behind' : (emitted < c.healthyBuffer ? 'buffering' : 'recording')));
    }

    async function retune() {
        const t = await tune(channelId);
        const master = await getText(t.url);
        variant = pickVariant(master, t.url, quality);
        if (!variant) throw new Error('No stream variant');
    }

    async function key(uri) {
        if (keys.has(uri)) return keys.get(uri);
        const k = await keyBytes(uri);
        keys.set(uri, k);
        if (keys.size > 20) keys.delete(keys.keys().next().value);
        return k;
    }

    /**
     * One segment, verified: the declared length equals the body, the AES decrypt succeeds, the ADTS frames parse to the last
     * byte. A segment that fails is fetched again by the same address (the same URL is the same bytes) up to `retries`
     * times with a short backoff; still bad throws, and the tick ends: the segment is tried again on the next tick while it
     * is in the window (never skipped), and a gap only when it has left it.
     */
    async function fetchChecked(s, retries) {
        let why = '';
        for (let attempt = 0; attempt <= retries; attempt++) {
            if (attempt > 0) {
                refetches += 1;
                ev.emit('refetch', { seq: s.seq, attempt, why });
                await sleep(Math.min(2000, 250 * attempt));
                if (!running) throw Object.assign(new Error('stopped'), { stopped: true });
            }
            let got;
            try { got = await getBytes(s.url); } catch (err) {
                if (!err.integrity) throw err; // an HTTP status or a network error: the tick's own backoff and retune
                why = err.message;
                continue;
            }
            if (got.declared != null && got.declared !== got.body.length) { why = `got ${got.body.length} of ${got.declared} bytes`; continue; }
            const k = s.keyUri ? await key(s.keyUri) : null; // a key that cannot be fetched is not the segment's fault
            let plain;
            try { plain = k ? decrypt(got.body, k, s.iv, s.seq) : got.body; } catch (err) { why = `decrypt: ${err.message}`; continue; }
            const adts = stripId3(plain);
            if (!adtsClean(adts)) { why = 'ADTS frames do not parse to the end'; continue; }
            return { plain, adts };
        }
        throw new Error(`segment ${s.seq} failed its checks after ${retries} refetches (${why})`);
    }

    async function tick(back, from) {
        if (!running) return;
        let wait = 6000;
        const c = cfg();
        let got = 0;
        try {
            if (!variant) await retune();
            let text;
            try { text = await getText(variant); } catch (err) {
                // a signed address that expired: tune again and carry on
                if (err.status === 403 || err.status === 404 || err.status === 410) { variant = null; await retune(); text = await getText(variant); } else throw err;
            }
            const segs = parseMedia(text, variant);
            if (!segs.length) throw new Error('Empty playlist');
            const live = segs[segs.length - 1];
            const segMs = (live.dur || 6) * 1000;
            const liveEnd = (live.pdt || now()) + segMs;
            liveEndMs = liveEnd;
            segLenMs = segMs;
            if (!lastEnd) {
                if (from) {
                    lastEnd = from;
                    anchored = true;
                } else {
                    // the first read: start `back` seconds behind live (at least the last segment)
                    const f = (live.pdt || now()) - Math.max(0, back) * 1000;
                    lastEnd = Math.min(f, live.pdt || f);
                }
                lastProgressAt = now();
                // a start that reaches back further than "behind" is a deliberate reach-back until it has caught up
                reaching = (liveEnd - lastEnd) > c.behindSeconds * 1000;
            }
            // what is left to fetch, oldest first; the newest healthyBuffer segments stay on the stream's side
            const wanted = segs.filter((s) => s.pdt != null && s.pdt + 1 >= lastEnd);
            bufferSegs = wanted.length;
            const fetchable = Math.max(0, wanted.length - c.healthyBuffer);
            for (let i = 0; i < fetchable; i++) {
                const s = wanted[i];
                if (!running) return;
                if (anchored && s.pdt > lastEnd + 1000) {
                    // the audio between left the stream's window before it could be fetched: a hole, reported, never spliced
                    ev.emit('gap', { from: lastEnd, to: s.pdt });
                    log('warn', `[xmRadioPump] ${channelId}: ${Math.round((s.pdt - lastEnd) / 1000)} s left the stream window`);
                    lastEnd = s.pdt;
                }
                const ok = await fetchChecked(s, c.refetchRetries);
                lastEnd = s.pdt + s.dur * 1000;
                anchored = true;
                emitted += 1;
                got += 1;
                lastProgressAt = now();
                bufferSegs = wanted.length - i - 1;
                ev.emit('segment', { seq: s.seq, pdt: s.pdt, dur: s.dur, adts: ok.adts, plain: ok.plain });
            }
            failures = 0;
            health(c, got);
            wait = pollMs || Math.max(2000, Math.min(10000, (live.dur || 6) * 1000));
        } catch (err) {
            if (err && err.stopped) return;
            health(c, got);
            failures += 1;
            log('warn', `[xmRadioPump] ${channelId}: ${err.message}`);
            // a recording (persistent) never gives up on a sign-in: the recorder service waits for Dreamscape's token
            // and reads the gap back from the stream's five hours once it has one; only a channel out of the plan ends it
            if (err && (err.code === 'XMRADIO_NOT_SUBSCRIBED' || (err.code === 'XMRADIO_SIGNED_OUT' && !persistent))) { stop(); ev.emit('error', err); return; }
            wait = pollMs || Math.min(60000, 2000 * 2 ** Math.min(failures, 5));
        }
        if (running) { timer = setTimeout(() => { ticking = tick(0, 0); void ticking; }, wait); if (timer.unref) timer.unref(); }
    }

    function start({ back = 0, from = 0 } = {}) {
        if (running) return;
        running = true;
        ticking = tick(back, Number(from) || 0);
        void ticking;
    }

    async function stop() {
        running = false;
        clearTimeout(timer);
        timer = null;
        // the tick's loop checks `running` before each fetch, so it finishes a segment already on the wire and then
        // returns: awaiting it here is what lets a recording stop *after* that segment (Yukimi, Nov 22 2026)
        if (ticking) { try { await ticking; } catch (_) { /* the tick logs its own errors */ } ticking = null; }
    }

    ev.start = start;
    ev.stop = stop;
    ev.running = () => running;
    ev.channelId = channelId;
    ev.quality = quality;
    /** The buffer's health: state (buffering | recording | paused-refilling | behind), what the last read held beyond the position. */
    ev.stats = () => ({ state: stateNow, bufferSegs, behindS, paused, pauses, refetches, caughtUp: !reaching });
    return ev;
}

module.exports = { createPump, _test: { pickVariant, parseMedia, stripId3, decrypt, adtsClean } };
