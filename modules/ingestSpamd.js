/**
 * SpamAssassin spamd client (spamc protocol, SYMBOLS) for the Ingest Controller's spam filter.
 * LANTIS runs spamd for the Postfix milter with only two children, so calls here are gentle:
 * one at a time, a short timeout, a small message, a short queue. Every failure resolves to
 * { ok:false } and the caller FAILS OPEN (the message is left alone).
 *
 *   score(raw, { host, port, timeoutMs, user }) -> { ok:true, score, required, spam, symbols:[...] }
 *                                                | { ok:false, error }
 *   ping(host, port, timeoutMs)                 -> { ok, reply } | { ok:false, error }
 *   buildMessage(msg)                           -> an RFC822 text for mail that is only in the store
 */
'use strict';

const net = require('net');

const MAX_RAW = 200 * 1024;      // bigger mail is cut here: the headers and the start decide
const MAX_QUEUE = 20;            // more waiting than this and a call is skipped (fail open)
const MAX_REPLY = 64 * 1024;

let active = 0;
const waiting = [];
let concurrency = 1;

function slot() {
    return new Promise((resolve, reject) => {
        if (active < concurrency) { active++; return resolve(); }
        if (waiting.length >= MAX_QUEUE) return reject(new Error('spamd queue full'));
        waiting.push(resolve);
        return undefined;
    });
}
function release() {
    const next = waiting.shift();
    if (next) next(); else active = Math.max(0, active - 1);
}

function talk(host, port, payload, timeoutMs) {
    return new Promise((resolve) => {
        let done = false;
        const chunks = [];
        let size = 0;
        const socket = net.connect({ host, port: Number(port) });
        const finish = (res) => { if (done) return; done = true; clearTimeout(timer); try { socket.destroy(); } catch (_) { /* gone */ } resolve(res); };
        const timer = setTimeout(() => finish({ ok: false, error: 'spamd timeout' }), Math.max(500, Math.min(Number(timeoutMs) || 4000, 15000)));
        socket.on('connect', () => { socket.write(payload); });
        socket.on('data', (d) => { size += d.length; if (size > MAX_REPLY) return finish({ ok: false, error: 'spamd reply too large' }); chunks.push(d); return undefined; });
        socket.on('end', () => finish({ ok: true, data: Buffer.concat(chunks).toString('utf8') }));
        socket.on('close', () => finish(chunks.length ? { ok: true, data: Buffer.concat(chunks).toString('utf8') } : { ok: false, error: 'spamd closed' }));
        socket.on('error', (e) => finish({ ok: false, error: `spamd ${e.code || e.message}` }));
    });
}

function parseReply(data) {
    const text = String(data || '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const st = /^SPAMD\/[\d.]+\s+(\d+)\s*(.*)$/.exec(first);
    if (!st) return { ok: false, error: 'not a spamd reply' };
    if (Number(st[1]) !== 0) return { ok: false, error: `spamd ${st[1]} ${st[2] || ''}`.trim() };
    const sp = /^Spam:\s*(True|False|Yes|No)\s*;\s*(-?[\d.]+)\s*\/\s*(-?[\d.]+)/im.exec(text);
    if (!sp) return { ok: false, error: 'spamd reply without a score' };
    const split = text.search(/\r?\n\r?\n/);
    const body = split >= 0 ? text.slice(split).trim() : '';
    return {
        ok: true,
        spam: /^(true|yes)$/i.test(sp[1]),
        score: Number(sp[2]),
        required: Number(sp[3]),
        symbols: body ? body.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60) : []
    };
}

async function score(raw, opts = {}) {
    const host = String(opts.host || '').trim();
    const port = Number(opts.port) || 0;
    if (!host || !port) return { ok: false, error: 'spamd is not configured' };
    let buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''), 'utf8');
    if (!buf.length) return { ok: false, error: 'empty message' };
    if (buf.length > MAX_RAW) buf = buf.subarray(0, MAX_RAW);
    const user = opts.user ? `User: ${String(opts.user).replace(/[^\w.@-]/g, '')}\r\n` : '';
    const head = Buffer.from(`SYMBOLS SPAMC/1.5\r\nContent-length: ${buf.length}\r\n${user}\r\n`, 'utf8');
    try { await slot(); } catch (e) { return { ok: false, error: e.message }; }
    try {
        const r = await talk(host, port, Buffer.concat([head, buf]), opts.timeoutMs);
        return r.ok ? parseReply(r.data) : r;
    } finally { release(); }
}

async function ping(host, port, timeoutMs) {
    if (!host || !port) return { ok: false, error: 'spamd is not configured' };
    const r = await talk(String(host), port, Buffer.from('PING SPAMC/1.5\r\n\r\n', 'utf8'), timeoutMs || 3000);
    if (!r.ok) return r;
    const line = (r.data.split(/\r?\n/, 1)[0] || '').trim();
    return /PONG/.test(line) ? { ok: true, reply: line } : { ok: false, error: line || 'no PONG' };
}

function clean(v, n) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, n || 998); }

/** Mail that is only in the store (parsed): a plain RFC822 text for spamd. Receives/relay headers are not known. */
function buildMessage(msg) {
    const m = msg || {};
    const h = [];
    const from = m.fromName ? `${clean(m.fromName, 100).replace(/[<>"]/g, '')} <${clean(m.from, 200)}>` : clean(m.from, 200);
    h.push(`From: ${from}`);
    if ((m.to || []).length) h.push(`To: ${clean((m.to || []).join(', '), 900)}`);
    if ((m.cc || []).length) h.push(`Cc: ${clean((m.cc || []).join(', '), 900)}`);
    h.push(`Subject: ${clean(m.subject, 300)}`);
    h.push(`Date: ${new Date(m.date || Date.now()).toUTCString()}`);
    if (m.messageId) h.push(`Message-ID: ${clean(m.messageId, 300)}`);
    for (const [k, v] of Object.entries(m.headers || {})) {
        if (/^(list-unsubscribe|list-unsubscribe-post|reply-to|list-id|precedence|x-mailer|mime-version)$/i.test(k) && v) h.push(`${k}: ${clean(v, 900)}`);
    }
    const body = m.text || m.html || '';
    const isHtml = !m.text && !!m.html;
    h.push('MIME-Version: 1.0');
    h.push(`Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=UTF-8`);
    return `${h.join('\r\n')}\r\n\r\n${String(body).replace(/\r?\n/g, '\r\n')}\r\n`;
}

function _setConcurrency(n) { concurrency = Math.max(1, Number(n) || 1); }

module.exports = { score, ping, parseReply, buildMessage, MAX_RAW, _setConcurrency };
