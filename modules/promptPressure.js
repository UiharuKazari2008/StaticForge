'use strict';

const { measureInputPressure } = require('../public/scripts/comp/promptListFold');

const channels = new Map();
const TTL = 90 * 60 * 1000;
let clientLevelFn = null;

function registerClientLevel(fn) {
    clientLevelFn = typeof fn === 'function' ? fn : null;
}

function purge() {
    const now = Date.now();
    for (const [key, row] of channels.entries()) {
        if (!row || now - row.t > TTL) channels.delete(key);
    }
}

function levelFor(key) {
    if (!key) return 0;
    purge();
    const row = channels.get(String(key));
    return row && row.n ? row.n : 0;
}

function bumpChannel(key, texts) {
    if (!key) return 0;
    const list = Array.isArray(texts) ? texts : [];
    let hit = 0;
    list.forEach((t) => {
        hit += measureInputPressure(t);
    });
    if (!hit) return levelFor(key);
    const id = String(key);
    const row = channels.get(id) || { n: 0, t: Date.now() };
    row.n = Math.min(15, row.n + Math.min(4, hit));
    row.t = Date.now();
    channels.set(id, row);
    return row.n;
}

function takeForClient(clientId) {
    if (!clientId || !clientLevelFn) return 0;
    const n = clientLevelFn(String(clientId));
    return Number.isFinite(n) && n > 0 ? Math.min(15, Math.floor(n)) : 0;
}

function pushText(out, value) {
    if (typeof value === 'string' && value.trim()) out.push(value);
}

function collectStudioTexts(assembled, body) {
    const out = [];
    if (body && typeof body === 'object') {
        pushText(out, body.prompt);
        pushText(out, body.uc);
    }
    if (!assembled || typeof assembled !== 'object') return out;
    pushText(out, assembled.prompt);
    pushText(out, assembled.uc);
    pushText(out, assembled.promptNegative);
    if (Array.isArray(assembled.characters)) {
        assembled.characters.forEach((row) => {
            if (!row) return;
            pushText(out, row.prompt);
            pushText(out, row.uc);
        });
    }
    if (Array.isArray(assembled.fields)) {
        assembled.fields.forEach((field) => {
            if (field) pushText(out, field.text);
        });
    }
    return out;
}

function collectGenerateTexts(payload) {
    const out = [];
    if (!payload || typeof payload !== 'object') return out;
    pushText(out, payload.prompt);
    pushText(out, payload.uc);
    pushText(out, payload.negative_prompt);
    if (Array.isArray(payload.characterPrompts)) {
        payload.characterPrompts.forEach((row) => {
            if (!row) return;
            pushText(out, row.prompt);
            pushText(out, row.uc);
        });
    }
    return out;
}

module.exports = {
    registerClientLevel,
    levelFor,
    bumpChannel,
    takeForClient,
    collectStudioTexts,
    collectGenerateTexts
};
