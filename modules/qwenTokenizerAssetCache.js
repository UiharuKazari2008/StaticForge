'use strict';

const fs = require('fs/promises');
const path = require('path');
const { inflateSync } = require('fflate');

const QWEN_TOKENIZER_URL = 'https://novelai.net/tokenizer/compressed/qwen35_tokenizer.def?v=2&static=true';
const CACHE_FILENAME = 'qwen35_tokenizer.def';
let pendingFetch = null;

async function validateTokenizerDefinition(bytes) {
    const decoded = inflateSync(bytes);
    const config = JSON.parse(Buffer.from(decoded).toString('utf8'));
    if (!config.vocab || !Array.isArray(config.merges) || !Array.isArray(config.specialTokens)) {
        throw new Error('NovelAI Qwen tokenizer definition has an invalid shape');
    }
}

async function fetchTokenizerDefinition(cachePath) {
    const response = await fetch(QWEN_TOKENIZER_URL, {
        headers: { accept: 'application/octet-stream,*/*' },
        signal: AbortSignal.timeout(45000)
    });
    if (!response.ok) {
        throw new Error(`NovelAI Qwen tokenizer download failed with HTTP ${response.status}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    await validateTokenizerDefinition(bytes);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    const temporaryPath = `${cachePath}.tmp`;
    await fs.writeFile(temporaryPath, bytes);
    await fs.rename(temporaryPath, cachePath);
    return cachePath;
}

async function getQwenTokenizerDefinition(cacheRoot) {
    const cachePath = path.join(cacheRoot, 'tokenizers', CACHE_FILENAME);
    try {
        await fs.access(cachePath);
        return cachePath;
    } catch (_) {
        if (!pendingFetch) {
            pendingFetch = fetchTokenizerDefinition(cachePath).finally(() => {
                pendingFetch = null;
            });
        }
        return pendingFetch;
    }
}

module.exports = {
    getQwenTokenizerDefinition
};
