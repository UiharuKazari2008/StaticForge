'use strict';

// TokenRouter bridge request worker (tokenRouterBridge.js openRequest). A Director model step
// re-sends the whole session with every picture as base64; parsing it, converting it to an
// OpenAI request and serializing that again held the server's event loop 150-400 ms per step.
// Here it holds only this thread. Bodies stay here between a request's attempts (relaxer
// retries build again from the same body) until the bridge drops them.
//
// Messages (rid answers each one):
//   { op: 'parse', id, raw }   -> { meta }          keeps the body under id
//   { op: 'build', id, opts }  -> { bytes, applies } bytes transferred
//   { op: 'drop', id }                              no answer
//   { op: 'tokens', raw }      -> { tokens }        count_tokens, nothing kept

const { parentPort } = require('worker_threads');
const bridge = require('./tokenRouterBridge');

const { buildRequestBytes, bodyMeta, estimateTokens } = bridge._worker;
// A body whose drop never came (bridge restarted mid-request): gone at the next parse.
const STALE_MS = 30 * 60 * 1000;
const bodies = new Map();

function parse(raw) {
    try {
        return JSON.parse(Buffer.from(raw).toString('utf8') || '{}');
    } catch (_) {
        throw Object.assign(new Error('Body is not JSON'), { status: 400 });
    }
}

function transferable(buf) {
    if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) return buf.buffer;
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

parentPort.on('message', (msg) => {
    if (!msg) return;
    if (msg.op === 'drop') {
        bodies.delete(msg.id);
        return;
    }
    try {
        if (msg.op === 'parse') {
            const now = Date.now();
            bodies.forEach((entry, id) => { if (now - entry.at > STALE_MS) bodies.delete(id); });
            const body = parse(msg.raw);
            bodies.set(msg.id, { body, at: now });
            parentPort.postMessage({ rid: msg.rid, ok: true, meta: bodyMeta(body) });
        } else if (msg.op === 'build') {
            const entry = bodies.get(msg.id);
            if (!entry) throw new Error('request body is gone');
            const built = buildRequestBytes(entry.body, msg.opts || {});
            const bytes = transferable(built.bytes);
            parentPort.postMessage({ rid: msg.rid, ok: true, bytes, applies: built.applies }, [bytes]);
        } else if (msg.op === 'tokens') {
            parentPort.postMessage({ rid: msg.rid, ok: true, tokens: estimateTokens(parse(msg.raw)) });
        } else {
            throw new Error(`unknown op ${msg.op}`);
        }
    } catch (error) {
        parentPort.postMessage({ rid: msg.rid, ok: false, error: error.message || String(error), status: error.status });
    }
});
