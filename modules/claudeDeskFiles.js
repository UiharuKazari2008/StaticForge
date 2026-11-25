'use strict';

/**
 * Fleet's session chat shows the files Claude sent (its SendUserFile tool calls) as inline cards. The bytes are
 * served by URL, never base64: GET /claude-desk/file/<session id>?path=<absolute path>[&dl=1] (admin only,
 * web_server.js). A file is served ONLY when that exact path appears in a SendUserFile call of that session's
 * own transcript, is a regular file after realpath and is at most 50 MB.
 *
 *   sentPaths(transcriptFile)   Set of the absolute paths that session sent (read incrementally, cached by size)
 *   resolve(sessionId, path)    { file, name, size } or throws { status, message }
 *   handle(req, res)            the express handler
 */

const fs = require('fs');
const path = require('path');
const launcher = require('./claudeSessionLauncher');
const transcript = require('./claudeTranscript');

const MAX_BYTES = 50 * 1024 * 1024;
const TYPES = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.json': 'application/json', '.csv': 'text/csv', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.zip': 'application/zip',
};
const sentCache = new Map(); // transcript file -> { offset, paths: Set }

function fail(status, message) { return Object.assign(new Error(message), { status }); }

/** Every path a session's SendUserFile calls named (a transcript is scanned from where the last scan ended). */
async function sentPaths(file) {
    let c = sentCache.get(file);
    const st = await fs.promises.stat(file);
    if (!c || st.size < c.offset) { c = { offset: 0, paths: new Set() }; sentCache.set(file, c); }
    if (sentCache.size > 200) sentCache.delete(sentCache.keys().next().value);
    if (st.size === c.offset) return c.paths;
    const fh = await fs.promises.open(file, 'r');
    try {
        let tail = '';
        let pos = c.offset;
        const buf = Buffer.alloc(1024 * 1024);
        while (pos < st.size) {
            const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, st.size - pos), pos);
            if (!bytesRead) break;
            pos += bytesRead;
            const text = tail + buf.subarray(0, bytesRead).toString('utf8');
            const cut = text.lastIndexOf('\n');
            if (cut < 0) { tail = text; continue; }
            tail = text.slice(cut + 1);
            text.slice(0, cut).split('\n').forEach((line) => {
                if (!line.includes(transcript.SEND_FILE_TOOL)) return;
                let o;
                try { o = JSON.parse(line); } catch (_) { return; }
                if (!o || o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) return;
                o.message.content.forEach((b) => {
                    if (b && b.type === 'tool_use' && b.name === transcript.SEND_FILE_TOOL) transcript.sentFilesOf(b.input, o.cwd).forEach((p) => c.paths.add(p));
                });
            });
            c.offset = pos - Buffer.byteLength(tail, 'utf8');
        }
    } finally { await fh.close(); }
    return c.paths;
}

async function resolve(sessionId, want) {
    const id = String(sessionId || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw fail(404, 'No such session');
    const asked = String(want || '');
    if (!asked || !path.isAbsolute(asked) || asked.includes('\0')) throw fail(404, 'No such file');
    const tfile = await launcher.findFile(id);
    if (!tfile) throw fail(404, 'No such session');
    const norm = path.normalize(asked);
    if (!(await sentPaths(tfile)).has(norm)) throw fail(403, 'This session did not send that file');
    let real;
    let st;
    try { real = await fs.promises.realpath(norm); st = await fs.promises.stat(real); } catch (_) { throw fail(404, 'The file is gone'); }
    if (!st.isFile()) throw fail(404, 'Not a file');
    if (st.size > MAX_BYTES) throw fail(413, 'The file is over 50 MB');
    return { file: real, name: path.basename(norm), size: st.size };
}

async function handle(req, res) {
    try {
        const r = await resolve(req.params.id, req.query.path);
        const ext = path.extname(r.name).toLowerCase();
        const text = transcript.fileKind(r.name) === 'text';
        const download = req.query.dl === '1';
        res.setHeader('Content-Type', TYPES[ext] || (text ? 'text/plain; charset=utf-8' : 'application/octet-stream'));
        res.setHeader('Content-Length', String(r.size));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // the private file never runs script in our origin (an SVG opened by itself, a saved page)
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
        res.setHeader('Cache-Control', 'private, no-cache');
        res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(r.name)}`);
        const stream = fs.createReadStream(r.file);
        stream.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
        stream.pipe(res);
    } catch (e) {
        res.status(e.status || 500).json({ success: false, error: e.message });
    }
}

module.exports = { sentPaths, resolve, handle, MAX_BYTES };
