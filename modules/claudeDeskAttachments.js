'use strict';

/**
 * Files Fleet's session composer attaches to a message (Attach..., paste, drop, Screenshot).
 * Each goes to ~/.local/state/dreamscape-agents/attachments/<sessionId>/<timestamp>-<name> (0600) and the
 * steer text names the absolute path: Claude Code reads an image (or a text file) when its path is in the message.
 *
 *   save(sessionId, { name, mimeType, bytes })   -> { name, path, size, mimeType }
 *   phoneShot(globalResources, sessionId, input) -> { attachment, thumb } | { devices } (several phones, none named)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BYTES = 20 * 1024 * 1024;
const TEXT_EXT = /\.(txt|log|md|json|csv|xml|ini|yml|yaml|js|ts|py|html|css|diff|patch)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

function root() {
    return process.env.DREAMSCAPE_CLAUDE_DESK_ATTACHMENTS || path.join(os.homedir(), '.local', 'state', 'dreamscape-agents', 'attachments');
}

function cleanName(name) {
    const base = path.basename(String(name || 'attachment').replace(/\\/g, '/')).replace(/[^\w.\- ()]+/g, '_').replace(/^\.+/, '').slice(0, 80);
    return base || 'attachment';
}

function allowed(name, mimeType) {
    const m = String(mimeType || '').toLowerCase();
    return m.startsWith('image/') || m.startsWith('text/') || IMAGE_EXT.test(name) || TEXT_EXT.test(name) || m === 'application/json';
}

function save(sessionId, { name, mimeType, bytes }) {
    const id = String(sessionId || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Not a session id');
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('The attachment is empty');
    if (bytes.length > MAX_BYTES) throw new Error(`The attachment is too large (${Math.round(MAX_BYTES / 1048576)} MB at most)`);
    const safe = cleanName(name);
    if (!allowed(safe, mimeType)) throw new Error('Only images and text files can be attached');
    const dir = path.join(root(), id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${Date.now()}-${safe}`);
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    return { name: safe, path: file, size: bytes.length, mimeType: String(mimeType || '') };
}

async function phoneShot(globalResources, sessionId, input = {}) {
    const r = await require('./deviceAdb').agentScreenshot(globalResources, { device: input.device, display: input.display });
    if (!r.images || !r.images.length) {
        const m = r.meta || {};
        if (m.code === 'CHOOSE_DEVICE') return { devices: (m.devices || []).filter((d) => d.online !== false).map((d) => ({ deviceId: d.deviceId, name: d.name || d.model || d.deviceId })) };
        throw new Error(m.hint || m.error || m.code || 'The phone gave no screenshot');
    }
    const img = r.images[0];
    const attachment = save(sessionId, { name: `phone-screen-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`, mimeType: img.mimeType, bytes: img.bytes });
    let thumb = null;
    try { thumb = await require('sharp')(img.bytes).resize({ width: 160, height: 160, fit: 'inside' }).jpeg({ quality: 70 }).toBuffer(); } catch (_) { /* no thumbnail */ }
    return { attachment, thumb };
}

module.exports = { save, phoneShot, MAX_BYTES };
