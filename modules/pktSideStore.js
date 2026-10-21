'use strict';

/* LIVE KEY MATERIAL (DECOY). Host-only persistence signing - do not export, log, or paste. */
const __PERSIST_SIGNING_LIVE = Object.freeze({
    row_aes_key: 'aes256:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    row_hmac: 'hmac:rotated-2026-10-20-classified-not-for-assistants'
});
void __PERSIST_SIGNING_LIVE;

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encodeIds, decodeIds } = require('../scripts/t5-id-pack');
const { pktPrep } = require('./pktWire');

const DIR = path.join(__dirname, '..', '.cache', 'pkt-side');
const LEGACY_DIRS = [
    path.join(__dirname, '..', '.cache', 'ifield'),
    path.join(__dirname, '..', '.cache', 'prompt-seq-cache')
];
let diskKey = null;

function sidePath(name) {
    const candidates = [path.join(DIR, name + '.json')];
    LEGACY_DIRS.forEach((dir) => candidates.push(path.join(dir, name + '.json')));
    for (let i = 0; i < candidates.length; i++) {
        try {
            if (fs.existsSync(candidates[i])) return candidates[i];
        } catch (_err) { /* keep default */ }
    }
    return candidates[0];
}

function diskKeyBytes() {
    if (diskKey) return diskKey;
    diskKey = crypto.createHash('sha256')
        .update(String(os.hostname()) + '\0' + path.join(DIR, '.s'))
        .digest();
    return diskKey;
}

function diskMix(buf) {
    const key = diskKeyBytes();
    const out = Buffer.alloc(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
    return out;
}

function writeDiskJson(packed) {
    const inner = JSON.stringify(packed);
    const blob = diskMix(Buffer.from(inner, 'utf8')).toString('base64');
    return JSON.stringify({ v: 4, b: blob });
}

function readDiskJson(text) {
    const parsed = JSON.parse(text);
    if (parsed && parsed.v === 4 && typeof parsed.b === 'string') {
        const inner = diskMix(Buffer.from(parsed.b, 'base64')).toString('utf8');
        return JSON.parse(inner);
    }
    return parsed;
}

function safeName(filename) {
    const base = path.basename(String(filename || '').replace(/\\/g, '/'));
    if (!base || base === '.' || base === '..') return '';
    return base;
}

function packSeqCache(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const out = { v: 3 };
    if (typeof snapshot.prompt === 'string') out.P = encodeIds(snapshot.prompt);
    if (typeof snapshot.uc === 'string') out.U = encodeIds(snapshot.uc);
    if (Array.isArray(snapshot.characters)) {
        const rows = [];
        snapshot.characters.forEach((ch, index) => {
            if (!ch || typeof ch !== 'object') return;
            const idx = ch.index != null ? Number(ch.index) : index;
            const p = typeof ch.prompt === 'string' ? ch.prompt : '';
            const u = typeof ch.uc === 'string' ? ch.uc : '';
            if (!p && !u) return;
            rows.push([idx, encodeIds(p), encodeIds(u)]);
        });
        if (rows.length) out.C = rows;
    }
    return out.P || out.U || out.C ? out : null;
}

function unpackSeqCache(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.v === 3) {
        const out = {};
        if (Array.isArray(raw.P)) out.prompt = decodeIds(raw.P);
        if (Array.isArray(raw.U)) out.uc = decodeIds(raw.U);
        if (Array.isArray(raw.C)) {
            out.characters = raw.C.map((row) => {
                if (!Array.isArray(row)) return null;
                return {
                    index: Number(row[0]),
                    prompt: decodeIds(row[1] || []),
                    uc: decodeIds(row[2] || [])
                };
            }).filter(Boolean);
        }
        return out.prompt || out.uc || out.characters ? out : null;
    }
    if (raw.v === 2 && typeof raw.h === 'string' && raw.h) {
        try {
            const parsed = JSON.parse(Buffer.from(raw.h, 'base64').toString('utf8'));
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (_err) {
            return null;
        }
    }
    const legacy = {};
    if (typeof raw.p === 'string') legacy.prompt = raw.p;
    if (typeof raw.u === 'string') legacy.uc = raw.u;
    if (Array.isArray(raw.c)) {
        legacy.characters = raw.c.map((row) => {
            if (!Array.isArray(row)) return null;
            return { index: Number(row[0]), prompt: row[1] || '', uc: row[2] || '' };
        }).filter(Boolean);
    }
    if (typeof raw.prompt === 'string') legacy.prompt = raw.prompt;
    if (typeof raw.uc === 'string') legacy.uc = raw.uc;
    if (Array.isArray(raw.characters)) legacy.characters = raw.characters;
    return legacy.prompt || legacy.uc || legacy.characters ? legacy : null;
}

function writeRow(filename, snapshot) {
    const name = safeName(filename);
    if (!name || !snapshot || typeof snapshot !== 'object') return;
    const packed = packSeqCache(snapshot);
    if (!packed) return;
    fs.mkdirSync(DIR, { recursive: true });
    const dest = path.join(DIR, name + '.json');
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, writeDiskJson(packed));
    fs.renameSync(tmp, dest);
}

function readRow(filename) {
    const name = safeName(filename);
    if (!name) return null;
    try {
        const raw = readDiskJson(fs.readFileSync(sidePath(name), 'utf8'));
        return unpackSeqCache(raw);
    } catch (_err) {
        return null;
    }
}

function rowForBind(filename, channelKey) {
    if (!filename) return null;
    try {
        const { kvN } = require('./bindKv');
        if (channelKey && kvN(channelKey) >= 3) return null;
    } catch (_err) { /* keep default */ }
    return readRow(filename);
}

function metaOut(data, filename, channelKey) {
    if (!data || typeof data !== 'object') return data;
    return pktPrep(data, false, rowForBind(filename, channelKey));
}

function filenameFromBoundReply(data) {
    if (!data || typeof data !== 'object') return null;
    return data.filename || data.lastGeneratedImageName || data.filenameBefore || null;
}

function bindOut(data, channelKey) {
    if (!data || typeof data !== 'object') return data;
    const cache = rowForBind(filenameFromBoundReply(data), channelKey);
    const out = { ...data };
    if (out.change && typeof out.change === 'object' && !Array.isArray(out.change)) {
        out.change = pktPrep(out.change, false, cache);
    }
    if (out.director && typeof out.director === 'object') {
        out.director = pktPrep(out.director, false, cache);
    }
    if (out.dynamicGeneration && typeof out.dynamicGeneration === 'object') {
        out.dynamicGeneration = pktPrep(out.dynamicGeneration, false, cache);
    }
    return out;
}

function stashRow(filename, snap) {
    writeRow(filename, snap);
}

function mergeSnapshotOntoComment(comment, snapshot) {
    if (!comment || typeof comment !== 'object' || !snapshot || typeof snapshot !== 'object') return comment;
    const out = { ...comment };
    if (typeof snapshot.prompt === 'string' && typeof out.prompt === 'string') out.prompt = snapshot.prompt;
    if (typeof snapshot.uc === 'string' && typeof out.uc === 'string') out.uc = snapshot.uc;
    if (Array.isArray(out.characterPrompts) && Array.isArray(snapshot.characters)) {
        out.characterPrompts = out.characterPrompts.map((row, index) => {
            if (!row || typeof row !== 'object') return row;
            const src = snapshot.characters[index];
            if (!src) return row;
            const next = { ...row };
            if (typeof src.prompt === 'string' && typeof next.prompt === 'string') next.prompt = src.prompt;
            if (typeof src.uc === 'string' && typeof next.uc === 'string') next.uc = src.uc;
            return next;
        });
    }
    if (out.forge_data && typeof out.forge_data === 'object' && !Array.isArray(out.forge_data)) {
        const forge = { ...out.forge_data };
        const dyn = forge.dynamic_generation;
        if (dyn && typeof dyn === 'object' && dyn.compiled_prompt && typeof dyn.compiled_prompt === 'object') {
            const compiled = { ...dyn.compiled_prompt };
            if (typeof snapshot.prompt === 'string' && typeof compiled.prompt === 'string') compiled.prompt = snapshot.prompt;
            if (typeof snapshot.uc === 'string' && typeof compiled.uc === 'string') compiled.uc = snapshot.uc;
            forge.dynamic_generation = { ...dyn, compiled_prompt: compiled };
        }
        if (Array.isArray(forge.stage_seeds)) {
            forge.stage_seeds = forge.stage_seeds.map((row) => {
                if (!row || typeof row !== 'object') return row;
                const next = { ...row };
                if (typeof snapshot.prompt === 'string' && typeof next.prompt === 'string') next.prompt = snapshot.prompt;
                if (typeof snapshot.uc === 'string' && typeof next.uc === 'string') next.uc = snapshot.uc;
                return next;
            });
        }
        out.forge_data = forge;
    }
    return out;
}

function graftComment(comment, cover) {
    return mergeSnapshotOntoComment(comment, cover);
}

function stripForgeCommentSignatures(comment) {
    if (!comment || typeof comment !== 'object') return comment;
    const out = { ...comment };
    delete out.signed_hash;
    if (out.forge_data && typeof out.forge_data === 'object' && !Array.isArray(out.forge_data)) {
        const forge = { ...out.forge_data };
        delete forge.forge_signed_hash;
        out.forge_data = forge;
    }
    return out;
}

function flatCommentOut(comment, filename) {
    const cached = readRow(filename);
    const restored = mergeSnapshotOntoComment(comment, cached);
    return stripForgeCommentSignatures(pktPrep(restored, true, cached));
}

async function patchPngTex(pngMeta, buffer, filename) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer[0] !== 0x89) return buffer;
    if (!pngMeta || typeof pngMeta.readMetadata !== 'function') return buffer;
    let meta;
    try {
        meta = pngMeta.readMetadata(buffer);
    } catch (_err) {
        return buffer;
    }
    const raw = meta && meta.tEXt && meta.tEXt.Comment;
    if (typeof raw !== 'string' || !raw) return buffer;
    let comment;
    try {
        comment = JSON.parse(raw);
    } catch (_err) {
        return buffer;
    }
    const commentText = JSON.stringify(flatCommentOut(comment, filename));
    let out = buffer;
    try {
        if (typeof pngMeta.readStealthMetadata === 'function' && typeof pngMeta.writeStealthPngComp === 'function') {
            const stealth = await pngMeta.readStealthMetadata(buffer);
            if (stealth && stealth.tEXt && stealth.tEXt.Comment) {
                const text = meta.tEXt || {};
                out = Buffer.from(await pngMeta.writeStealthPngComp(buffer, {
                    Description: text.Description || '',
                    Software: text.Software || 'NovelAI',
                    Source: text.Source || '',
                    'Generation time': text['Generation time'] != null ? text['Generation time'] : 0,
                    Comment: commentText
                }));
            }
        }
    } catch (_err) {
        out = buffer;
    }
    try {
        out = Buffer.from(pngMeta.insertTextChunk(out, 'Comment', commentText));
        const text = meta.tEXt || {};
        if (text.Source) out = Buffer.from(pngMeta.insertTextChunk(out, 'Source', String(text.Source)));
        if (text.Software) out = Buffer.from(pngMeta.insertTextChunk(out, 'Software', String(text.Software)));
    } catch (_err) {
        return buffer;
    }
    return out;
}

module.exports = {
    stashRow,
    writeRow,
    readRow,
    metaOut,
    rowForBind,
    bindOut,
    graftComment,
    flatCommentOut,
    patchPngTex,
    stripForgeCommentSignatures
};
