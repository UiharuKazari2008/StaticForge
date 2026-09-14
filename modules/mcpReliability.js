/**
 * Small MCP reliability helpers (Enshutsuka #200).
 * Keep dest_path / handshake / franchise / live-diet logic here — not a connector rewrite.
 */

'use strict';

const crypto = require('crypto');
const { prepareEmphasisTextForNovelAI } = require('./emphasisGroupIdSyntax');

const APPLY_GENERATE_TTL_MS = 3 * 60 * 1000;
const applyGenerateJobs = new Map();

const FRANCHISE_ALIASES = {
    'sword art online': 'sao',
    'sao': 'sao',
    'blue archive': 'blue archive',
    'ba': 'blue archive',
    'genshin impact': 'genshin impact',
    'nikke': 'nikke',
    'goddess of victory nikke': 'nikke'
};

const FRANCHISE_WIKI_TITLES = {
    sao: 'sword art online',
    'blue archive': 'blue archive',
    nikke: 'nikke',
    'genshin impact': 'genshin impact'
};

const CARD_WIKI_TIMEOUT_MS = 6000;
const CARD_ALIAS_TIMEOUT_MS = 4000;
const CARD_STUDIO_TIMEOUT_MS = 2500;
const CARD_WIKI_TITLE_TRIES = 2;

function pruneApplyGenerateJobs(nowMs) {
    const now = nowMs != null ? Number(nowMs) : Date.now();
    applyGenerateJobs.forEach((row, id) => {
        if (!row || (row.createdAt + APPLY_GENERATE_TTL_MS) <= now) applyGenerateJobs.delete(id);
    });
}

function rememberApplyGenerateJob(info) {
    pruneApplyGenerateJobs();
    const jobId = `apply-${crypto.randomBytes(8).toString('hex')}`;
    const row = {
        jobId,
        bindKey: info && info.bindKey ? String(info.bindKey) : '',
        workspaceId: (info && info.workspaceId) || 'default',
        filenameBefore: info && info.filenameBefore ? String(info.filenameBefore) : null,
        checkpointId: (info && info.checkpointId) || null,
        destPath: (info && info.destPath) || null,
        prompt: (info && info.prompt) || null,
        status: 'running',
        filename: null,
        createdAt: Date.now()
    };
    applyGenerateJobs.set(jobId, row);
    return row;
}

function getApplyGenerateJob(jobId) {
    pruneApplyGenerateJobs();
    return applyGenerateJobs.get(String(jobId || '')) || null;
}

function findPendingApplyGenerate(bindKey, workspaceId) {
    pruneApplyGenerateJobs();
    const key = String(bindKey || '');
    const ws = workspaceId ? String(workspaceId) : '';
    let newest = null;
    applyGenerateJobs.forEach((row) => {
        if (!row || row.status !== 'running') return;
        if (key && row.bindKey && row.bindKey !== key) return;
        if (ws && row.workspaceId && row.workspaceId !== ws) return;
        if (!newest || row.createdAt > newest.createdAt) newest = row;
    });
    return newest;
}

function completeApplyGenerateJob(jobId, filename) {
    const row = getApplyGenerateJob(jobId);
    if (!row) return null;
    row.status = 'completed';
    row.filename = filename || null;
    return row;
}

function resetApplyGenerateJobs() {
    applyGenerateJobs.clear();
}

function canonicalizeFranchise(franchise) {
    const n = String(franchise || '').trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
    if (!n) return '';
    return FRANCHISE_ALIASES[n] || n;
}

function qualifyCharacterQuery(name, franchise) {
    const n = String(name || '').trim();
    if (!n) return n;
    if (/\([^)]+\)/.test(n)) return n;
    const fr = canonicalizeFranchise(franchise);
    if (!fr) return n;
    return `${n} (${fr})`;
}

function franchiseWikiQualifier(franchise) {
    const c = canonicalizeFranchise(franchise);
    if (!c) return '';
    return FRANCHISE_WIKI_TITLES[c] || String(franchise || '').trim().replace(/_/g, ' ');
}

function characterBareName(name) {
    const raw = String(name || '').trim();
    if (!raw) return '';
    return raw.replace(/\s*\([^)]*\)\s*$/, '').trim() || raw;
}

function characterLookupQueries(name, franchise) {
    const raw = String(name || '').trim();
    const bare = characterBareName(raw);
    const qualified = qualifyCharacterQuery(raw, franchise);
    const longFr = franchiseWikiQualifier(franchise);
    const out = [];
    const seen = new Set();
    const add = (value) => {
        const t = String(value || '').trim();
        if (!t) return;
        const variants = [t];
        const swapped = t.includes('_') ? t.replace(/_/g, ' ') : t.replace(/ /g, '_');
        if (swapped !== t) variants.push(swapped);
        variants.forEach((item) => {
            if (!item || seen.has(item)) return;
            seen.add(item);
            out.push(item);
        });
    };
    add(qualified);
    if (longFr && bare) add(`${bare} (${longFr})`);
    add(raw);
    add(bare);
    return out;
}

function pickWikiPageTitles(queries, aliasTitles, franchise) {
    const scored = [];
    const add = (title, score) => {
        const t = String(title || '').trim();
        if (!t) return;
        scored.push({ t, score: Number(score) || 0 });
    };
    (Array.isArray(aliasTitles) ? aliasTitles : []).forEach((title) => {
        add(title, naxTagMatchesFranchise(title, franchise) ? 6 : 1);
    });
    (Array.isArray(queries) ? queries : []).forEach((query, index) => {
        add(query, 4 - Math.min(index, 3));
    });
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const out = [];
    scored.forEach((row) => {
        const key = row.t.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
        if (seen.has(key)) return;
        seen.add(key);
        out.push(row.t);
    });
    return out;
}

function promiseWithTimeout(promise, ms, fallback) {
    const wait = Number(ms);
    if (!Number.isFinite(wait) || wait <= 0) return Promise.resolve(promise);
    let timer = null;
    return Promise.race([
        Promise.resolve(promise).finally(() => {
            if (timer) clearTimeout(timer);
        }),
        new Promise((resolve) => {
            timer = setTimeout(() => resolve(fallback), wait);
        })
    ]);
}

function naxTagMatchesFranchise(tag, franchise) {
    const fr = canonicalizeFranchise(franchise);
    if (!fr) return true;
    const raw = String(tag || '').replace(/_/g, ' ');
    const match = raw.match(/\(([^)]+)\)\s*$/);
    if (!match) return false;
    return canonicalizeFranchise(match[1]) === fr;
}

function wikiAppearanceLines(text) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    const first = raw.split(/\n+/)[0] || '';
    if (/^see also\b/i.test(first) && raw.length < 500) return [];
    return raw.split(/\n+/).map((line) => line.replace(/^[-*]\s*/, '').trim()).filter(Boolean).slice(0, 8);
}

function classicPromptText(text) {
    if (text == null || typeof text !== 'string') return text;
    if (!text) return text;
    try {
        return prepareEmphasisTextForNovelAI(text).text;
    } catch (_err) {
        return text;
    }
}

function studioFieldText(fields, id) {
    const list = Array.isArray(fields) ? fields : [];
    const row = list.find((item) => item && (item.id === id || item.field === id));
    if (!row) return null;
    if (typeof row.text === 'string') return classicPromptText(row.text);
    if (typeof row.value === 'string') return classicPromptText(row.value);
    if (Array.isArray(row.chunks)) {
        return classicPromptText(row.chunks.map((chunk) => {
            if (typeof chunk === 'string') return chunk;
            return (chunk && (chunk.text || chunk.value)) || '';
        }).join(''));
    }
    return null;
}

function slimParamScalars(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
    const keys = [
        'steps', 'guidance', 'rescale', 'seed', 'seedLock', 'sampler', 'noiseScheduler',
        'resolution', 'width', 'height', 'n', 'variety', 'upscale', 'strength', 'noise',
        'append_quality', 'append_uc', 'append_transparency', 'nsfw'
    ];
    const out = {};
    keys.forEach((key) => {
        if (params[key] !== undefined) out[key] = params[key];
    });
    return Object.keys(out).length ? out : null;
}

function slimLiveWindows(windows) {
    if (!Array.isArray(windows)) return [];
    return windows.map((win) => {
        const data = win && win.data && typeof win.data === 'object' ? win.data : {};
        const filename = data.filename
            || (Array.isArray(data.selected) ? data.selected[0] : null)
            || (Array.isArray(data.filenames) ? data.filenames[0] : null)
            || null;
        return {
            id: win && win.id != null ? win.id : null,
            kind: (win && (win.kind || win.type || win.windowKind)) || null,
            title: (win && win.title) || null,
            filename: filename ? String(filename) : null
        };
    });
}

function pickQualitySettings(change) {
    const dc = (change && change.dataset_config)
        || (change && change.params && change.params.dataset_config)
        || null;
    const quality = dc && dc.settings && dc.settings.__quality__;
    return quality && typeof quality === 'object' && !Array.isArray(quality) ? quality : null;
}

function slimMemoryHit(row) {
    if (!row || typeof row !== 'object') return row;
    const observations = Array.isArray(row.observations) ? row.observations : [];
    const first = observations[0];
    const oneObservation = typeof first === 'string'
        ? first
        : (first && (first.content || first.text)) || null;
    return {
        name: row.name,
        confidence: row.confidence,
        relevance: row.relevance_score != null ? row.relevance_score : row.relevance,
        oneObservation: oneObservation || (row.description ? String(row.description).slice(0, 240) : null)
    };
}

module.exports = {
    APPLY_GENERATE_TTL_MS,
    FRANCHISE_ALIASES,
    FRANCHISE_WIKI_TITLES,
    CARD_WIKI_TIMEOUT_MS,
    CARD_ALIAS_TIMEOUT_MS,
    CARD_STUDIO_TIMEOUT_MS,
    CARD_WIKI_TITLE_TRIES,
    rememberApplyGenerateJob,
    getApplyGenerateJob,
    findPendingApplyGenerate,
    completeApplyGenerateJob,
    resetApplyGenerateJobs,
    canonicalizeFranchise,
    qualifyCharacterQuery,
    franchiseWikiQualifier,
    characterBareName,
    characterLookupQueries,
    pickWikiPageTitles,
    promiseWithTimeout,
    naxTagMatchesFranchise,
    wikiAppearanceLines,
    classicPromptText,
    studioFieldText,
    slimParamScalars,
    slimLiveWindows,
    pickQualitySettings,
    slimMemoryHit
};
