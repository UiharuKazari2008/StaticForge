'use strict';

/**
 * DreamOS updates (StaticForge #910): the signed release channels and content-addressed files that DreamOS laptops
 * (Dreamscape as the main OS) update from - the base image, and the forge-shell (Chromium) and cafeready components.
 *
 * The server only stores and serves. Trust comes from the signature: the build host (Ruiko, which holds the signing
 * key) signs each channel manifest with Ed25519, and a device verifies the exact bytes against the public key in its
 * base image before it mounts anything. The server checks the same signature against data/dreamos/trusted-keys.json
 * so a bad publish is refused here too, and every file a manifest names must already be stored.
 *
 *   GET /api/dreamos/channel/:channel    the manifest bytes exactly as signed; X-DreamOS-Signature = base64 signature,
 *                                        X-DreamOS-Key = key id; ETag = sha256 of the bytes (304 when same)
 *   GET /api/dreamos/object/:sha256      a stored file (images, deltas); Range requests; immutable
 *   PUT /api/dreamos/object/:sha256      admin: store a file (body = raw bytes); refused unless its sha256 matches
 *   PUT /api/dreamos/channel/:channel    admin: { manifest: "<json text>", signature: "<base64>", key: "<id>" }
 *
 * Manifest (format 1), as text so its signed bytes survive untouched:
 *   { format: 1, channel, released: ISO, base: Release, components: { "forge-shell": Release, cafeready: Release } }
 *   Release = { version, api, needsBaseApi?, files: [{ name, sha256, size }], deltas?: [{ from, sha256, size }] }
 *
 * A publish emits 'channel' on `events` ({ channel, sha256 }) so the CaféReady link can push "update available" to
 * connected laptops (no polling - server-push-not-polling).
 *
 * Channel assignments (a roaming machine is repointed from here, not by editing its dreamos.conf):
 *   GET /api/dreamos/assign               admin: { devices: { <device id>: channel } }
 *   PUT /api/dreamos/assign/:device       admin: { channel: "<name>" | null } (null ends the assignment)
 * A DreamOS host's Miniport carrier names its device id (?miniport=1&device=<32 hex>, CaféReady identity.rs); at
 * every connect, and whenever its channel is published or its assignment changes, the carrier gets
 *   { type: 'miniport_update_channel', channel: name | null, released, sha256 }
 * and CaféReady keeps the channel (on its own server) and checks when the channel or the release is new to it
 * (firmware.rs server_channel). An assignment emits 'assign' on `events` ({ device, channel }).
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { isAdminUser } = require('./auth');

const ROOT = path.join(__dirname, '..', 'data', 'dreamos');

const SHA_RE = /^[0-9a-f]{64}$/;
const CHANNEL_RE = /^[a-z][a-z0-9-]{0,31}$/;
const COMPONENT_RE = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_MANIFEST = 256 * 1024;
const MAX_OBJECT = 8 * 1024 * 1024 * 1024; // a base image with headroom

const events = new EventEmitter();
const channelCache = new Map(); // channel -> { mtimeMs, size, bytes, sig, key, etag }
let keysCache = null; // { mtimeMs, keys: Map id -> KeyObject }

function setRoot(dir) { // tests
    module.exports._root = dir;
}
function root() { return module.exports._root || ROOT; }
function objectsDir() { return path.join(root(), 'objects'); }
function channelsDir() { return path.join(root(), 'channels'); }
function keysFile() { return path.join(root(), 'trusted-keys.json'); }
function assignFile() { return path.join(root(), 'assignments.json'); }

const DEVICE_RE = /^[0-9a-f]{32}$/;
let assignCache = null; // { mtimeMs, file, devices: { id: channel } }

// assignments.json: { devices: { <device id>: <channel> } }
async function assignments() {
    let st;
    try { st = await fsp.stat(assignFile()); } catch (_) { return {}; }
    if (assignCache && assignCache.mtimeMs === st.mtimeMs && assignCache.file === assignFile()) return assignCache.devices;
    let devices = {};
    try {
        const doc = JSON.parse(await fsp.readFile(assignFile(), 'utf8'));
        for (const [id, ch] of Object.entries((doc && doc.devices) || {})) if (DEVICE_RE.test(id) && CHANNEL_RE.test(String(ch))) devices[id] = String(ch);
    } catch (_) { devices = {}; }
    assignCache = { mtimeMs: st.mtimeMs, file: assignFile(), devices };
    return devices;
}

/** The carrier frame for a DreamOS host's device id (null when it names none): its channel and that channel's release. */
async function channelFrame(device) {
    if (!DEVICE_RE.test(String(device || ''))) return null;
    const channel = (await assignments())[device] || null;
    let released = null;
    let sha256 = null;
    if (channel) {
        const c = await readChannel(channel);
        if (c) {
            sha256 = c.etag.slice(1, -1);
            try { released = JSON.parse(c.bytes.toString('utf8')).released || null; } catch (_) { released = null; }
        }
    }
    return { type: 'miniport_update_channel', channel, released, sha256 };
}

// trusted-keys.json: { keys: [{ id, ed25519: "<base64url raw public key>" }] } - edited by hand on the server
async function trustedKeys() {
    let st;
    try { st = await fsp.stat(keysFile()); } catch (_) { return new Map(); }
    if (keysCache && keysCache.mtimeMs === st.mtimeMs && keysCache.file === keysFile()) return keysCache.keys;
    const keys = new Map();
    try {
        const doc = JSON.parse(await fsp.readFile(keysFile(), 'utf8'));
        for (const k of Array.isArray(doc.keys) ? doc.keys : []) {
            if (!k || typeof k.id !== 'string' || typeof k.ed25519 !== 'string') continue;
            try {
                keys.set(k.id, crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: k.ed25519 }, format: 'jwk' }));
            } catch (_) { /* skip a malformed key */ }
        }
    } catch (_) { /* unreadable: no keys */ }
    keysCache = { mtimeMs: st.mtimeMs, file: keysFile(), keys };
    return keys;
}

function validRelease(r) {
    if (!r || typeof r !== 'object' || typeof r.version !== 'string' || !Number.isInteger(r.api)) return false;
    if (!Array.isArray(r.files) || !r.files.length) return false;
    const ok = (f) => f && typeof f.name === 'string' && SHA_RE.test(f.sha256) && Number.isInteger(f.size) && f.size >= 0;
    if (!r.files.every(ok)) return false;
    if (r.deltas !== undefined && !(Array.isArray(r.deltas) && r.deltas.every((d) => d && typeof d.from === 'string' && SHA_RE.test(d.sha256) && Number.isInteger(d.size)))) return false;
    return true;
}

// -> { ok: true, doc, objects: [sha] } or { ok: false, error }
function checkManifest(text, channel) {
    let doc;
    try { doc = JSON.parse(text); } catch (_) { return { ok: false, error: 'The manifest is not JSON.' }; }
    if (!doc || doc.format !== 1) return { ok: false, error: 'Unknown manifest format.' };
    if (doc.channel !== channel) return { ok: false, error: 'The manifest names another channel.' };
    if (typeof doc.released !== 'string' || Number.isNaN(Date.parse(doc.released))) return { ok: false, error: 'released must be an ISO date.' };
    if (!validRelease(doc.base)) return { ok: false, error: 'The base release is incomplete.' };
    const comps = doc.components && typeof doc.components === 'object' ? doc.components : {};
    for (const [name, rel] of Object.entries(comps)) {
        if (!COMPONENT_RE.test(name) || !validRelease(rel)) return { ok: false, error: `Component ${name} is incomplete.` };
    }
    const objects = new Set();
    for (const rel of [doc.base, ...Object.values(comps)]) {
        for (const f of rel.files) objects.add(f.sha256);
        for (const d of rel.deltas || []) objects.add(d.sha256);
    }
    return { ok: true, doc, objects: [...objects] };
}

async function exists(p) {
    try { await fsp.access(p); return true; } catch (_) { return false; }
}

// channels/<channel>.release = { manifest: "<text as signed>", signature, key }, one file so a reader never pairs a
// new signature with an old manifest
async function readChannel(channel) {
    const file = path.join(channelsDir(), `${channel}.release`);
    let st;
    try { st = await fsp.stat(file); } catch (_) { return null; }
    const hit = channelCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    let env;
    try { env = JSON.parse(await fsp.readFile(file, 'utf8')); } catch (_) { return null; }
    if (!env || typeof env.manifest !== 'string') return null;
    const bytes = Buffer.from(env.manifest, 'utf8');
    const entry = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        bytes,
        sig: String(env.signature || ''),
        key: String(env.key || ''),
        etag: `"${crypto.createHash('sha256').update(bytes).digest('hex')}"`
    };
    channelCache.set(file, entry);
    return entry;
}

function fail(res, code, err, msg) {
    res.status(code).json({ success: false, code: err, error: msg });
}

async function writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, file);
}

function mount(app, authMiddleware) {
    const auth = authMiddleware || ((req, res, next) => next());
    const json = require('express').json({ limit: MAX_MANIFEST + 4096 });

    app.get('/api/dreamos/channel/:channel', auth, async (req, res) => {
        const channel = String(req.params.channel || '');
        if (!CHANNEL_RE.test(channel)) return fail(res, 404, 'NOT_FOUND', 'No such channel.');
        const c = await readChannel(channel);
        if (!c) return fail(res, 404, 'NOT_FOUND', 'No such channel.');
        res.set('ETag', c.etag);
        res.set('Cache-Control', 'no-cache');
        res.set('X-DreamOS-Signature', c.sig);
        res.set('X-DreamOS-Key', c.key);
        if (req.headers['if-none-match'] === c.etag) return res.status(304).end();
        res.type('application/json').send(c.bytes);
    });

    app.get('/api/dreamos/object/:sha', auth, async (req, res) => {
        const sha = String(req.params.sha || '');
        if (!SHA_RE.test(sha)) return fail(res, 404, 'NOT_FOUND', 'No such file.');
        const file = path.join(objectsDir(), sha);
        if (!(await exists(file))) return fail(res, 404, 'NOT_FOUND', 'No such file.');
        // sendFile answers Range and conditional requests; the name is its hash, so it never changes
        res.sendFile(file, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Type': 'application/octet-stream' }, etag: false, lastModified: false }, (err) => {
            if (err && !res.headersSent) fail(res, 500, 'READ_FAILED', 'The file could not be read.');
        });
    });

    app.put('/api/dreamos/object/:sha', auth, async (req, res) => {
        if (!isAdminUser(req)) return fail(res, 403, 'FORBIDDEN', 'Only an administrator can publish DreamOS files.');
        const sha = String(req.params.sha || '');
        if (!SHA_RE.test(sha)) return fail(res, 400, 'BAD_HASH', 'The name must be the file\'s sha256.');
        const dir = objectsDir();
        const file = path.join(dir, sha);
        if (await exists(file)) { req.resume(); return res.json({ success: true, sha256: sha, stored: false }); }
        await fsp.mkdir(dir, { recursive: true });
        const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.part`;
        const hash = crypto.createHash('sha256');
        const out = fs.createWriteStream(tmp);
        let size = 0;
        let aborted = false;
        const abort = (code, err, msg) => {
            if (aborted) return;
            aborted = true;
            out.destroy();
            fsp.unlink(tmp).catch(() => {});
            if (!res.headersSent) fail(res, code, err, msg);
        };
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_OBJECT) { req.destroy(); abort(413, 'TOO_LARGE', 'The file is too large.'); return; }
            hash.update(chunk);
        });
        req.on('aborted', () => abort(400, 'ABORTED', 'The upload stopped.'));
        out.on('error', () => abort(500, 'WRITE_FAILED', 'The file could not be stored.'));
        out.on('finish', async () => {
            if (aborted) return;
            const got = hash.digest('hex');
            if (got !== sha) return abort(400, 'HASH_MISMATCH', 'The file does not match its sha256.');
            try { await fsp.rename(tmp, file); } catch (_) { return abort(500, 'WRITE_FAILED', 'The file could not be stored.'); }
            res.json({ success: true, sha256: sha, size, stored: true });
        });
        req.pipe(out);
    });

    app.get('/api/dreamos/assign', auth, async (req, res) => {
        if (!isAdminUser(req)) return fail(res, 403, 'FORBIDDEN', 'Only an administrator can see DreamOS channel assignments.');
        res.json({ success: true, devices: await assignments() });
    });

    app.put('/api/dreamos/assign/:device', auth, json, async (req, res) => {
        if (!isAdminUser(req)) return fail(res, 403, 'FORBIDDEN', 'Only an administrator can assign DreamOS channels.');
        const device = String(req.params.device || '');
        if (!DEVICE_RE.test(device)) return fail(res, 400, 'BAD_DEVICE', 'A device id is 32 lower-case hex digits.');
        const body = req.body || {};
        const channel = body.channel === null ? null : String(body.channel || '');
        if (channel !== null && !CHANNEL_RE.test(channel)) return fail(res, 400, 'BAD_CHANNEL', 'Channel names are lower-case letters, digits and dashes.');
        const devices = { ...(await assignments()) };
        if (channel === null) delete devices[device]; else devices[device] = channel;
        await fsp.mkdir(root(), { recursive: true });
        await writeAtomic(assignFile(), JSON.stringify({ devices }, null, 2));
        assignCache = null;
        events.emit('assign', { device, channel });
        res.json({ success: true, device, channel });
    });

    app.put('/api/dreamos/channel/:channel', auth, json, async (req, res) => {
        if (!isAdminUser(req)) return fail(res, 403, 'FORBIDDEN', 'Only an administrator can publish DreamOS releases.');
        const channel = String(req.params.channel || '');
        if (!CHANNEL_RE.test(channel)) return fail(res, 400, 'BAD_CHANNEL', 'Channel names are lower-case letters, digits and dashes.');
        const body = req.body || {};
        const text = typeof body.manifest === 'string' ? body.manifest : '';
        const signature = typeof body.signature === 'string' ? body.signature : '';
        const keyId = typeof body.key === 'string' ? body.key : '';
        if (!text || text.length > MAX_MANIFEST) return fail(res, 400, 'BAD_MANIFEST', 'The manifest is missing or too large.');
        const key = (await trustedKeys()).get(keyId);
        if (!key) return fail(res, 403, 'UNTRUSTED_KEY', 'That signing key is not trusted on this server.');
        let good = false;
        try { good = crypto.verify(null, Buffer.from(text, 'utf8'), key, Buffer.from(signature, 'base64')); } catch (_) { good = false; }
        if (!good) return fail(res, 403, 'BAD_SIGNATURE', 'The signature does not match the manifest.');
        const chk = checkManifest(text, channel);
        if (!chk.ok) return fail(res, 400, 'BAD_MANIFEST', chk.error);
        const missing = [];
        for (const sha of chk.objects) if (!(await exists(path.join(objectsDir(), sha)))) missing.push(sha);
        if (missing.length) return res.status(409).json({ success: false, code: 'MISSING_FILES', error: 'Upload these files first.', missing });
        // a channel never goes back in time by accident
        const prev = await readChannel(channel);
        if (prev) {
            try {
                const old = JSON.parse(prev.bytes.toString('utf8'));
                if (Date.parse(old.released) > Date.parse(chk.doc.released) && body.allowOlder !== true) {
                    return fail(res, 409, 'OLDER_RELEASE', 'This release is older than the one on the channel (send allowOlder to roll back).');
                }
            } catch (_) { /* unreadable old manifest: replace it */ }
        }
        const dir = channelsDir();
        await fsp.mkdir(dir, { recursive: true });
        const file = path.join(dir, `${channel}.release`);
        await writeAtomic(file, JSON.stringify({ manifest: text, signature, key: keyId }));
        channelCache.delete(file);
        const sha256 = crypto.createHash('sha256').update(text).digest('hex');
        events.emit('channel', { channel, sha256 });
        res.json({ success: true, channel, sha256 });
    });
}

module.exports = { mount, events, channelFrame, assignments, _root: null, _test: { setRoot, checkManifest, trustedKeys, readChannel } };
