'use strict';
/**
 * XM Radio's segment pump (Yozora #989): one SiriusXM channel followed on the server, its new segments fetched,
 * decrypted (AES-128-CBC, the playlist's key through modules/xmRadio.js keyBytes) and handed on as plain ADTS AAC.
 * It feeds the low-bandwidth relay (Opus through ffmpeg) and the cassette deck's recorder; neither needs a client.
 *
 *   const pump = createPump({ channelId, quality: 'hi' | 'std' | 'low', tune, keyBytes, log })
 *   pump.on('segment', ({ seq, pdt (ms), dur (s), adts (Buffer), plain (Buffer: decrypted, its ID3 kept) }) => ...)
 *   pump.on('error', (err) => ...)        a fatal stop (signed out, the channel left the plan; persistent: the plan only)
 *   pump.start({ back: 0 })               back: start this many seconds behind live
 *   pump.stop()                           stops pulling new segments; awaits one already being fetched, so a recorder
 *                                         handing over to a new process does not cut a segment in half
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

async function getBytes(url) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.siriusxm.com/' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return Buffer.from(await r.arrayBuffer());
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

function decrypt(data, key, iv, seq) {
    let ivBuf = iv;
    if (!ivBuf) {
        ivBuf = Buffer.alloc(16);
        ivBuf.writeUInt32BE(seq >>> 0, 12);
    }
    const d = crypto.createDecipheriv('aes-128-cbc', key, ivBuf);
    return Buffer.concat([d.update(data), d.final()]);
}

function createPump({ channelId, quality = 'hi', tune, keyBytes, log = () => {}, persistent = false }) {
    const ev = new EventEmitter();
    let running = false;
    let timer = null;
    let ticking = null; // the tick in flight (a segment fetch), so stop() can wait for it to land
    let variant = null;
    let lastEnd = 0; // ms: the end of the last segment handed on
    let failures = 0;
    const keys = new Map();

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

    async function tick(back) {
        if (!running) return;
        let wait = 6000;
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
            if (!lastEnd) {
                // the first read: start `back` seconds behind live (at least the last segment)
                const from = (live.pdt || Date.now()) - Math.max(0, back) * 1000;
                lastEnd = Math.min(from, live.pdt || from);
            }
            for (const s of segs) {
                if (!running) return;
                if (s.pdt == null || s.pdt + 1 < lastEnd) continue;
                const data = await getBytes(s.url);
                const k = s.keyUri ? await key(s.keyUri) : null;
                const plain = k ? decrypt(data, k, s.iv, s.seq) : data;
                lastEnd = s.pdt + s.dur * 1000;
                ev.emit('segment', { seq: s.seq, pdt: s.pdt, dur: s.dur, adts: stripId3(plain), plain });
            }
            failures = 0;
            wait = Math.max(2000, Math.min(10000, (live.dur || 6) * 1000));
        } catch (err) {
            failures += 1;
            log('warn', `[xmRadioPump] ${channelId}: ${err.message}`);
            // a recording (persistent) never gives up on a sign-in: the recorder service waits for Dreamscape's token
            // and reads the gap back from the stream's five hours once it has one; only a channel out of the plan ends it
            if (err && (err.code === 'XMRADIO_NOT_SUBSCRIBED' || (err.code === 'XMRADIO_SIGNED_OUT' && !persistent))) { stop(); ev.emit('error', err); return; }
            wait = Math.min(60000, 2000 * 2 ** Math.min(failures, 5));
        }
        if (running) { timer = setTimeout(() => { ticking = tick(0); void ticking; }, wait); if (timer.unref) timer.unref(); }
    }

    function start({ back = 0 } = {}) {
        if (running) return;
        running = true;
        ticking = tick(back);
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
    return ev;
}

module.exports = { createPump, _test: { pickVariant, parseMedia, stripId3, decrypt } };
