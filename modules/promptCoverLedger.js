'use strict';

const fs = require('fs');
const path = require('path');
const { maskAgentStudioRead } = require('../public/scripts/comp/promptListFold');

const DIR = path.join(__dirname, '..', '.cache', 'prompt-cover');

function safeName(filename) {
    const base = path.basename(String(filename || '').replace(/\\/g, '/'));
    if (!base || base === '.' || base === '..') return '';
    return base;
}

function rememberPromptCover(filename, cover) {
    const name = safeName(filename);
    if (!name || !cover || typeof cover !== 'object') return;
    fs.mkdirSync(DIR, { recursive: true });
    const dest = path.join(DIR, name + '.json');
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cover));
    fs.renameSync(tmp, dest);
}

function readPromptCover(filename) {
    const name = safeName(filename);
    if (!name) return null;
    try {
        return JSON.parse(fs.readFileSync(path.join(DIR, name + '.json'), 'utf8'));
    } catch (_err) {
        return null;
    }
}

function applyPromptCover(comment, cover) {
    if (!comment || typeof comment !== 'object' || !cover || typeof cover !== 'object') return comment;
    const out = { ...comment };
    if (typeof cover.prompt === 'string' && typeof out.prompt === 'string') out.prompt = cover.prompt;
    if (typeof cover.uc === 'string' && typeof out.uc === 'string') out.uc = cover.uc;
    if (Array.isArray(out.characterPrompts) && Array.isArray(cover.characters)) {
        out.characterPrompts = out.characterPrompts.map((row, index) => {
            if (!row || typeof row !== 'object') return row;
            const src = cover.characters[index];
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
            if (typeof cover.prompt === 'string' && typeof compiled.prompt === 'string') compiled.prompt = cover.prompt;
            if (typeof cover.uc === 'string' && typeof compiled.uc === 'string') compiled.uc = cover.uc;
            forge.dynamic_generation = { ...dyn, compiled_prompt: compiled };
        }
        if (Array.isArray(forge.stage_seeds)) {
            forge.stage_seeds = forge.stage_seeds.map((row) => {
                if (!row || typeof row !== 'object') return row;
                const next = { ...row };
                if (typeof cover.prompt === 'string' && typeof next.prompt === 'string') next.prompt = cover.prompt;
                if (typeof cover.uc === 'string' && typeof next.uc === 'string') next.uc = cover.uc;
                return next;
            });
        }
        out.forge_data = forge;
    }
    return out;
}

function stripAgentSignatures(comment) {
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

function coverComment(comment, filename) {
    const restored = applyPromptCover(comment, readPromptCover(filename));
    return stripAgentSignatures(maskAgentStudioRead(restored, true));
}

async function coverAgentPng(pngMeta, buffer, filename) {
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
    const commentText = JSON.stringify(coverComment(comment, filename));
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
    rememberPromptCover,
    readPromptCover,
    applyPromptCover,
    coverComment,
    coverAgentPng
};
