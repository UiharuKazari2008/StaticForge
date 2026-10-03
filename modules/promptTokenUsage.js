'use strict';

const fs = require('fs');
const path = require('path');

const INSPECT_CAP = 240;
let qwenTokenizer = null;
let qwenLoad = null;

function round4(value) {
    return Math.round(value * 10000) / 10000;
}

function round1(value) {
    return Math.round(value * 10) / 10;
}

function tokenBudget(features) {
    const limitRaw = features && Number(features.tokenLimit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : null;
    let recommended = features && Number(features.recommendedTokens);
    if (!Number.isFinite(recommended) || recommended <= 0) {
        recommended = limit ? Math.max(1, Math.round(limit * 0.75)) : null;
    }
    return {
        tokenizer: (features && features.tokenizer) || null,
        limit,
        recommended
    };
}

function describeTokenTotal(total, budget) {
    const count = Math.max(0, Math.round(Number(total) || 0));
    const limit = budget && budget.limit;
    const recommended = budget && budget.recommended;
    const ofLimit = limit ? round4(count / limit) : null;
    const ofRecommended = recommended ? round4(count / recommended) : null;
    return {
        total: count,
        ofLimit,
        ofRecommended,
        percentOfLimit: ofLimit == null ? null : round1(ofLimit * 100),
        percentOfRecommended: ofRecommended == null ? null : round1(ofRecommended * 100),
        overLimit: !!(limit && count > limit),
        overRecommended: !!(recommended && count > recommended)
    };
}

async function loadQwenTokenizer(globalResources) {
    if (qwenTokenizer) return qwenTokenizer;
    if (!qwenLoad) {
        qwenLoad = (async () => {
            const { getQwenTokenizerDefinition } = require('./qwenTokenizerAssetCache');
            const cacheRoot = globalResources.getPath('cache');
            const defPath = await getQwenTokenizerDefinition(cacheRoot);
            const bytes = await fs.promises.readFile(defPath);
            globalThis.fflate = require('fflate');
            require(path.join(__dirname, '..', 'public', 'protected', 'qwen-tokenizer.js'));
            const tokenizer = new globalThis.QwenTokenizer();
            await tokenizer.loadFromDEF(bytes);
            qwenTokenizer = tokenizer;
            return tokenizer;
        })().catch((error) => {
            qwenLoad = null;
            throw error;
        });
    }
    return qwenLoad;
}

function inspectTokens(detailed, cap) {
    const list = Array.isArray(detailed) ? detailed : [];
    const tokens = list.slice(0, cap).map((row) => {
        if (row && typeof row === 'object') {
            return typeof row.text === 'string' ? row.text : String(row.tokenId ?? '');
        }
        return String(row);
    });
    return {
        tokens,
        tokenTotal: list.length,
        tokensTruncated: list.length > tokens.length
    };
}

async function countOne(globalResources, tokenizerName, text, inspect) {
    const raw = typeof text === 'string' ? text : '';
    if (tokenizerName === 'qwen') {
        const tokenizer = await loadQwenTokenizer(globalResources);
        if (!inspect) {
            return { tokenCount: tokenizer.countTokens(raw) };
        }
        const analysis = tokenizer.analyzeTexts([raw], true);
        const detailed = analysis && analysis.results && analysis.results[0]
            ? analysis.results[0].detailedTokens
            : [];
        return { tokenCount: tokenizer.countTokens(raw), ...inspectTokens(detailed, INSPECT_CAP) };
    }
    if (tokenizerName === 't5') {
        const tokenizer = globalResources.getT5Tokenizer();
        if (!inspect) {
            return { tokenCount: tokenizer.countTokens(raw) };
        }
        const detailed = tokenizer.getTokenData(raw);
        return { tokenCount: detailed.length, ...inspectTokens(detailed, INSPECT_CAP) };
    }
    const error = new Error(`Tokenizer "${tokenizerName || 'unknown'}" is not available for counting`);
    error.status = 400;
    error.code = 'TOKENIZER_UNAVAILABLE';
    throw error;
}

function collectCountTexts(input) {
    if (Array.isArray(input.texts)) {
        return input.texts.map((row) => (typeof row === 'string' ? row : ''));
    }
    if (typeof input.text === 'string') return [input.text];
    const rows = [];
    if (typeof input.prompt === 'string') rows.push(input.prompt);
    if (typeof input.uc === 'string') rows.push(input.uc);
    return rows;
}

async function countPromptTokens(globalResources, input) {
    const body = input && typeof input === 'object' ? input : {};
    const texts = collectCountTexts(body);
    if (!texts.length) {
        const error = new Error('text, texts, or prompt is required');
        error.status = 400;
        throw error;
    }
    if (texts.length > 16) {
        const error = new Error('At most 16 texts per count');
        error.status = 400;
        throw error;
    }
    const model = String(body.model || 'v5').trim() || 'v5';
    const features = globalResources.getModelFeatures(model);
    if (!features) {
        const error = new Error(`Unknown model "${model}"`);
        error.status = 400;
        throw error;
    }
    const budget = tokenBudget(features);
    const inspect = body.inspect === true;
    const results = [];
    for (let i = 0; i < texts.length; i++) {
        const counted = await countOne(globalResources, budget.tokenizer, texts[i], inspect);
        const usage = describeTokenTotal(counted.tokenCount, budget);
        const row = { index: i, ...usage };
        if (inspect) {
            row.tokens = counted.tokens;
            row.tokensTruncated = counted.tokensTruncated;
        }
        if (texts.length === 2 && typeof body.prompt === 'string' && typeof body.uc === 'string' && !Array.isArray(body.texts)) {
            row.field = i === 0 ? 'prompt' : 'uc';
        }
        results.push(row);
    }
    return {
        success: true,
        model,
        tokenizer: budget.tokenizer,
        limit: budget.limit,
        recommended: budget.recommended,
        results
    };
}

module.exports = {
    tokenBudget,
    describeTokenTotal,
    countPromptTokens
};
