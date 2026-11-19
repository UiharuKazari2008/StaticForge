'use strict';

/**
 * A Claude session's transcript as a chat (Claude Accounts on the desktop, apps/claudedesk): the
 * person's prompts, Claude's replies, and each tool call with a short summary of its input and result.
 *
 *   readPage(file, { before, limit })   the newest `limit` messages that end before byte `before` (the
 *                                       end of the file when omitted), newest last; `start` is the byte
 *                                       offset of the first one (pass it as `before` for earlier ones)
 *                                       and `end` the file size it was read at (for readSince)
 *   readSince(file, offset)             the messages appended after `offset` (a live session), up to
 *                                       512 KB at a time; `end` is where the next read starts
 *
 * Transcripts grow to tens of MB (tool results, pictures): a page is read backwards in 512 KB chunks
 * and stops as soon as it has its messages, so the cost follows the page, not the file. Everything is
 * async (no fs.*Sync: the socket handler calls it). Texts are capped; pictures become "[picture]";
 * thinking, attachments, hook and system wrappers are left out. Anything token-shaped (sk-ant-...,
 * GitHub / Slack tokens, Bearer values) is masked.
 */

const fs = require('fs');

const CHUNK = 512 * 1024;
const MAX_SCAN = 24 * 1024 * 1024; // a page never reads more than this far back
const TEXT_CAP = 12000;
const TOOL_CAP = 1200;
const INPUT_CAP = 400;

const SECRET_RE = /\b(sk-ant-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b|(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}|("?(?:accessToken|refreshToken|apiKey|password|secret)"?\s*[:=]\s*"?)[^"\s,}]{8,}/g;

function mask(text) {
    return String(text == null ? '' : text).replace(SECRET_RE, (m, tok, bearer, key) => {
        if (tok) return `${tok.slice(0, 7)}…`;
        if (bearer) return `${bearer}…`;
        if (key) return `${key}…`;
        return '…';
    });
}

function cap(text, n) {
    const t = mask(text);
    return t.length > n ? `${t.slice(0, n)}\n… (${(t.length - n).toLocaleString('en-US')} more characters)` : t;
}

const WRAPPER_RE = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|system-reminder|user-prompt-submit-hook|bash-input|bash-stdout|bash-stderr)/i;
const TASK_NOTE_RE = /^\s*<task-notification>/i;

function blockText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map((b) => {
        if (!b) return '';
        if (b.type === 'text') return b.text || '';
        if (b.type === 'image') return '[picture]';
        return '';
    }).filter(Boolean).join('\n');
}

/** A tool call's input, short: the command, the path, the pattern, else compact JSON. */
function inputSummary(name, input) {
    const i = input && typeof input === 'object' ? input : {};
    const pick = i.command || i.file_path || i.path || i.pattern || i.url || i.query || i.description || i.prompt || i.skill || '';
    let s = typeof pick === 'string' && pick ? pick : '';
    if (!s) {
        try { s = JSON.stringify(i); } catch (_) { s = ''; }
    }
    if (i.description && i.command) s = `${i.description}\n$ ${i.command}`;
    return cap(s, INPUT_CAP);
}

/**
 * The display messages of one transcript line (several for an assistant line with text + tool calls).
 * `at` is the line's byte offset (a stable key in the file).
 */
function messagesOf(o, at) {
    if (!o || typeof o !== 'object' || o.isMeta) return [];
    const base = { at, uuid: o.uuid || '', time: o.timestamp || null, sidechain: !!o.isSidechain };
    const out = [];
    if (o.type === 'user' && o.message) {
        const c = o.message.content;
        if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) {
            c.filter((b) => b && b.type === 'tool_result').forEach((b) => {
                const t = typeof b.content === 'string' ? b.content : blockText(b.content);
                out.push(Object.assign({}, base, { role: 'tool', kind: 'tool_result', toolUseId: b.tool_use_id || '', error: b.is_error === true, text: cap(t, TOOL_CAP) }));
            });
            return out;
        }
        const t = blockText(c);
        if (!t.trim()) return out;
        if (TASK_NOTE_RE.test(t)) { out.push(Object.assign({}, base, { role: 'system', kind: 'notice', text: cap(t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 600) })); return out; }
        if (WRAPPER_RE.test(t)) {
            const cmd = /<command-name>([^<]{1,80})<\/command-name>/.exec(t);
            if (cmd) out.push(Object.assign({}, base, { role: 'user', kind: 'command', text: cmd[1].trim() }));
            return out;
        }
        out.push(Object.assign({}, base, { role: 'user', kind: 'text', text: cap(t, TEXT_CAP), origin: (o.origin && o.origin.kind) || '' }));
        return out;
    }
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
        o.message.content.forEach((b) => {
            if (!b) return;
            if (b.type === 'text' && b.text && b.text.trim()) out.push(Object.assign({}, base, { role: 'assistant', kind: 'text', text: cap(b.text, TEXT_CAP), model: o.message.model || '' }));
            else if (b.type === 'tool_use') out.push(Object.assign({}, base, { role: 'assistant', kind: 'tool_use', tool: String(b.name || 'tool'), toolUseId: b.id || '', text: inputSummary(b.name, b.input) }));
        });
        return out;
    }
    if (o.type === 'system' && o.content && typeof o.content === 'string' && o.level !== 'debug') {
        out.push(Object.assign({}, base, { role: 'system', kind: 'notice', text: cap(o.content, 600) }));
    }
    return out;
}

function parse(line, at) {
    if (!line || line.length < 2) return [];
    let o;
    try { o = JSON.parse(line); } catch (_) { return []; }
    return messagesOf(o, at);
}

async function size(file) {
    const st = await fs.promises.stat(file);
    return st.size;
}

/** The newest `limit` messages before byte `before`. */
async function readPage(file, opts = {}) {
    const limit = Math.max(1, Math.min(400, Number(opts.limit) || 80));
    const end = await size(file);
    let pos = Number.isFinite(Number(opts.before)) && opts.before !== null && opts.before !== undefined ? Math.max(0, Math.min(end, Number(opts.before))) : end;
    const stopAt = Math.max(0, pos - MAX_SCAN);
    const fh = await fs.promises.open(file, 'r');
    const found = []; // newest first while scanning
    let start = pos;
    try {
        let tail = Buffer.alloc(0); // bytes of a line that continues into the next chunk
        while (pos > stopAt && found.length < limit) {
            const from = Math.max(stopAt, pos - CHUNK);
            const buf = Buffer.alloc(pos - from);
            await fh.read(buf, 0, buf.length, from);
            const all = Buffer.concat([buf, tail]);
            // lines whose start is in this chunk: everything after the first newline (or all from 0)
            let cut = from === 0 ? -1 : all.indexOf(0x0a);
            if (cut < 0 && from !== 0) { tail = all; pos = from; continue; }
            const body = all.subarray(cut + 1);
            const lines = body.toString('utf8').split('\n');
            let off = from + cut + 1;
            const offsets = lines.map((l) => { const o = off; off += Buffer.byteLength(l, 'utf8') + 1; return o; });
            for (let i = lines.length - 1; i >= 0 && found.length < limit; i -= 1) {
                const msgs = parse(lines[i], offsets[i]);
                for (let j = msgs.length - 1; j >= 0 && found.length < limit; j -= 1) found.push(msgs[j]);
                if (msgs.length) start = offsets[i];
            }
            tail = all.subarray(0, cut + 1 > 0 ? cut : 0);
            pos = from;
            if (from === 0) break;
        }
    } finally {
        await fh.close();
    }
    const full = found.length >= limit;
    const messages = found.reverse();
    // full page: earlier lines may hold more; short page: only when the scan stopped before the file's start
    return { messages, start: messages.length ? start : pos, end, more: full ? start > 0 : pos > 0 };
}

/** The messages appended after byte `offset`, up to 512 KB of lines; `end` is where to read next. */
async function readSince(file, offset) {
    const total = await size(file);
    let from = Math.max(0, Number(offset) || 0);
    if (from > total) from = 0; // the file was replaced
    if (from >= total) return { messages: [], end: total };
    const len = Math.min(CHUNK * 4, total - from);
    const fh = await fs.promises.open(file, 'r');
    let text = '';
    try {
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, from);
        const last = buf.lastIndexOf(0x0a);
        if (last < 0) return { messages: [], end: from }; // a line still being written
        text = buf.subarray(0, last + 1).toString('utf8');
    } finally {
        await fh.close();
    }
    const messages = [];
    let off = from;
    text.split('\n').forEach((l) => {
        if (l) parse(l, off).forEach((m) => messages.push(m));
        off += Buffer.byteLength(l, 'utf8') + 1;
    });
    return { messages, end: from + Buffer.byteLength(text, 'utf8') };
}

module.exports = { readPage, readSince, mask, messagesOf, _cap: cap };
