/**
 * Short-lived Grok webp tickets for MCP dest_path.
 * Dreamscape cannot write Grok Computer `/home/workdir/artifacts`.
 * The ticket URL is what the model curls into that sandbox, then render_file.
 */

const crypto = require('crypto');
const path = require('path');
const { resolveMcpPublicBaseUrl } = require('./mcpServerInfo');

const ARTIFACT_TTL_MS = 15 * 60 * 1000;
const ARTIFACT_MAX_TICKETS = 32;
const DEST_PATH_PREFIX = 'artifacts/';
const SANDBOX_PREFIX = '/home/workdir/';

const tickets = new Map();

function pruneArtifactTickets(nowMs) {
    const now = nowMs != null ? Number(nowMs) : Date.now();
    tickets.forEach((row, id) => {
        if (!row || row.expiresAt <= now) tickets.delete(id);
    });
    while (tickets.size > ARTIFACT_MAX_TICKETS) {
        const oldest = tickets.keys().next().value;
        if (oldest == null) break;
        tickets.delete(oldest);
    }
}

function safeStem(filename, fallback) {
    const raw = String(filename || '').trim();
    const base = path.posix.basename(raw.replace(/\\/g, '/'));
    const stem = path.posix.basename(base, path.posix.extname(base))
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .replace(/^\.+/, '');
    return stem || fallback || 'generated';
}

function normalizeDestPath(raw, filename, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const full = opts.full === true;
    const mime = String(opts.mime || '');
    const wantPng = full && (mime === 'image/png' || mime === 'image/jpeg');
    const ext = wantPng
        ? (mime === 'image/jpeg' ? '.jpg' : '.png')
        : '.webp';
    const defaultName = `${safeStem(filename, 'generated')}${ext}`;
    let rel = `${DEST_PATH_PREFIX}${defaultName}`;
    const text = raw != null ? String(raw).trim() : '';
    if (!text) return rel;

    let s = text.replace(/\\/g, '/');
    if (s.startsWith(SANDBOX_PREFIX)) s = s.slice(SANDBOX_PREFIX.length);
    s = s.replace(/^\.\//, '').replace(/^\/+/, '');
    if (s.includes('..') || s.includes('\0')) return rel;

    let base = '';
    if (s.startsWith(DEST_PATH_PREFIX)) {
        base = path.posix.basename(s);
    } else if (!s.includes('/')) {
        base = path.posix.basename(s);
    } else {
        return rel;
    }
    const cleaned = String(base || '')
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .replace(/^\.+/, '');
    if (!cleaned) return rel;
    const stem = path.posix.basename(cleaned, path.posix.extname(cleaned)) || 'generated';
    return `${DEST_PATH_PREFIX}${stem}${ext}`;
}

function pickDestPathInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
    if (input.dest_path != null) return input.dest_path;
    if (input.destPath != null) return input.destPath;
    return '';
}

function mintArtifactTicket(image, destPath, filename) {
    pruneArtifactTickets();
    if (!image || !image.bytes || !Buffer.isBuffer(image.bytes) || !image.bytes.length) {
        return null;
    }
    const id = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    const row = {
        id,
        bytes: image.bytes,
        mime: image.mimeType || image.mime || 'image/webp',
        destPath: destPath || normalizeDestPath('', filename, { mime: image.mimeType }),
        filename: filename || null,
        createdAt: now,
        expiresAt: now + ARTIFACT_TTL_MS
    };
    tickets.set(id, row);
    pruneArtifactTickets();
    return row;
}

function getArtifactTicket(id) {
    pruneArtifactTickets();
    const row = tickets.get(String(id || ''));
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
        tickets.delete(row.id);
        return null;
    }
    return row;
}

function buildArtifactUrl(globalResources, ticketId) {
    const base = resolveMcpPublicBaseUrl(globalResources);
    let uuid = '';
    try {
        uuid = globalResources && typeof globalResources.getMcpPathUuid === 'function'
            ? String(globalResources.getMcpPathUuid() || '')
            : '';
    } catch (_err) {
        uuid = '';
    }
    if (!uuid || !ticketId) return '';
    return `${base}/${uuid}/artifacts/${ticketId}`;
}

function destPathNext(destPath) {
    const rel = destPath || `${DEST_PATH_PREFIX}generated.webp`;
    return `Confirm /home/workdir/${rel} exists (curl url there if missing). render_file that path in the final message. Do not reprint with Grok Imagine. Do not paste base64 into the chat.`;
}

function attachDestPathMeta(globalResources, meta, image, destPathInput, options) {
    const body = meta && typeof meta === 'object' ? { ...meta } : {};
    if (!image || !image.bytes) return body;
    const destPath = normalizeDestPath(destPathInput, body.filename, {
        full: options && options.full === true,
        mime: image.mimeType || image.mime
    });
    const ticket = mintArtifactTicket(image, destPath, body.filename);
    if (!ticket) return body;
    body.dest_path = ticket.destPath;
    body.bytes = ticket.bytes.length;
    body.mime = ticket.mime;
    body.url = buildArtifactUrl(globalResources, ticket.id);
    body.expiresAt = new Date(ticket.expiresAt).toISOString();
    body.next = destPathNext(ticket.destPath);
    return body;
}

function resetArtifactTickets() {
    tickets.clear();
}

const DEST_PATH_SCHEMA = {
    type: 'string',
    description: 'Optional Grok Computer path, e.g. artifacts/1788_generated.webp. Server stores the Grok-sized webp and returns dest_path, bytes, mime, and a short-lived url (no pixels in the JSON). Default artifacts/<filename>.webp. If /home/workdir/artifacts is empty, curl url into that path, then render_file. Keep the tool-channel webp for inspect. Do not Imagine-reprint. async generate remembers this path for await_generation_job.'
};

module.exports = {
    ARTIFACT_TTL_MS,
    DEST_PATH_PREFIX,
    SANDBOX_PREFIX,
    DEST_PATH_SCHEMA,
    normalizeDestPath,
    pickDestPathInput,
    mintArtifactTicket,
    getArtifactTicket,
    buildArtifactUrl,
    destPathNext,
    attachDestPathMeta,
    pruneArtifactTickets,
    resetArtifactTickets
};
