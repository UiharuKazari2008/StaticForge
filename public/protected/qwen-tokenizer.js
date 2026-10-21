(function (root, factory) {
    root.QwenTokenizer = factory();
}(globalThis, function () {
    'use strict';

    function buildByteMaps() {
        const byteToChar = {};
        const charToByte = {};
        const direct = [];
        for (let i = 33; i <= 126; i++) direct.push(i);
        for (let i = 161; i <= 172; i++) direct.push(i);
        for (let i = 174; i <= 255; i++) direct.push(i);
        const directSet = new Set(direct);
        let extra = 0;
        for (let i = 0; i < 256; i++) {
            const mapped = directSet.has(i) ? String.fromCodePoint(i) : String.fromCodePoint(256 + extra++);
            byteToChar[i] = mapped;
            charToByte[mapped] = i;
        }
        return { byteToChar, charToByte };
    }

    function escapeRegex(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    class QwenBpeCore {
        // tables: { vocab, decoder, mergeRanks } already built (loadFromURL in a browser builds
        // them in slices from the worker's parse); without it the constructor builds them here.
        constructor(config, tables) {
            this.vocab = tables ? tables.vocab : config.vocab;
            this.specialTokens = new Set(config.specialTokens || []);
            this.settings = config.config || {};
            this.decoder = tables ? tables.decoder : [];
            if (!tables) {
                Object.entries(this.vocab).forEach(([token, id]) => {
                    this.decoder[id] = token;
                });
            }

            const maps = buildByteMaps();
            this.byteToChar = maps.byteToChar;
            this.charToByte = maps.charToByte;
            this.textEncoder = new TextEncoder();
            this.textDecoder = new TextDecoder('utf-8');
            this.splitRegex = new RegExp(this.settings.splitRegex, 'gu');
            if (tables) {
                this.mergeRanks = tables.mergeRanks;
            } else {
                this.mergeRanks = new Map();
                (config.merges || []).forEach((pair, index) => {
                    this.mergeRanks.set(pair[0] + pair[1], index);
                });
            }
            const specials = Array.from(this.specialTokens)
                .sort((a, b) => b.length - a.length)
                .map(escapeRegex);
            this.specialRegex = specials.length ? new RegExp(`(${specials.join('|')})`, 'g') : null;
            this.cache = new Map();
        }

        splitWords(text) {
            const words = [];
            const sections = this.specialRegex ? text.split(this.specialRegex) : [text];
            sections.forEach((section) => {
                if (!section) return;
                if (this.specialTokens.has(section)) {
                    words.push(section);
                    return;
                }
                for (const match of section.matchAll(this.splitRegex)) {
                    words.push(match[0]);
                }
            });
            return words;
        }

        toByteUnicode(text) {
            return Array.from(this.textEncoder.encode(text), (byte) => this.byteToChar[byte]).join('');
        }

        rankedPairs(word) {
            let bestRank = Infinity;
            let bestLeft = null;
            let bestRight = null;
            for (let i = 0; i < word.length - 1; i++) {
                const left = word[i];
                const right = word[i + 1];
                const rank = this.mergeRanks.get(left + right);
                if (rank !== undefined && rank < bestRank) {
                    bestRank = rank;
                    bestLeft = left;
                    bestRight = right;
                }
            }
            return bestLeft === null ? null : { left: bestLeft, right: bestRight };
        }

        toBpe(text) {
            const direct = this.vocab[text];
            if (direct !== undefined) return [direct];
            const cached = this.cache.get(text);
            if (cached) return cached;

            let word = Array.from(text);
            while (word.length > 1) {
                const pair = this.rankedPairs(word);
                if (!pair) break;
                const next = [];
                for (let i = 0; i < word.length;) {
                    if (word[i] === pair.left && word[i + 1] === pair.right) {
                        next.push(pair.left + pair.right);
                        i += 2;
                    } else {
                        next.push(word[i]);
                        i++;
                    }
                }
                word = next;
            }

            const tokens = word.map((token) => this.vocab[token]).filter((id) => id !== undefined);
            if (this.cache.size >= 50000) this.cache.clear();
            this.cache.set(text, tokens);
            return tokens;
        }

        encode(text) {
            const normalized = this.settings.normalization
                ? String(text || '').normalize(this.settings.normalization)
                : String(text || '');
            const encoded = [];
            this.splitWords(normalized).forEach((word) => {
                if (this.specialTokens.has(word)) {
                    encoded.push(this.vocab[word]);
                } else {
                    encoded.push(...this.toBpe(this.toByteUnicode(word)));
                }
            });
            return encoded;
        }

        decode(tokenIds) {
            const bytes = [];
            tokenIds.forEach((id) => {
                const token = this.decoder[id] || '';
                for (const character of token) {
                    const byte = this.charToByte[character];
                    if (byte !== undefined) bytes.push(byte);
                }
            });
            return this.textDecoder.decode(new Uint8Array(bytes));
        }
    }

    // Browser load. Inflating and parsing the definition and building the tables on the page
    // held the main thread ~0.7-0.9s at boot (CPU profile, 2026-10-21). The page still fetches
    // the bytes; a worker gets a copy, inflates them with DecompressionStream (no requests of its
    // own) and parses, then sends the vocabulary and merges back as NUL-joined strings. The page
    // builds the same tables in slices, yielding between them, in the constructor's entry order.
    // A timeout or any error loads on the page from the same bytes.
    const WORKER_TIMEOUT_MS = 15000;
    const WORKER_SOURCE = `
        self.onmessage = async (event) => {
            try {
                const stream = new Blob([event.data.bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                const config = JSON.parse(await new Response(stream).text());
                const entries = Object.entries(config.vocab);
                const tokens = entries.map((entry) => entry[0]);
                const ids = new Int32Array(entries.map((entry) => entry[1]));
                const mergeKeys = (config.merges || []).map((pair) => pair[0] + pair[1]);
                if (tokens.some((t) => t.includes('\\0')) || mergeKeys.some((k) => k.includes('\\0'))) {
                    throw new Error('NUL in tokenizer strings');
                }
                self.postMessage({
                    tokens: tokens.join('\\0'),
                    ids,
                    mergeKeys: mergeKeys.join('\\0'),
                    specialTokens: config.specialTokens || [],
                    config: config.config || {}
                }, [ids.buffer]);
            } catch (error) {
                self.postMessage({ error: error && error.message ? error.message : String(error) });
            }
        };
    `;

    function canParseInWorker() {
        return typeof Worker === 'function' && typeof document !== 'undefined'
            && typeof DecompressionStream === 'function' && typeof Blob === 'function';
    }

    function parseInWorker(buffer) {
        return new Promise((resolve, reject) => {
            const blobUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
            let worker = null;
            let timer = null;
            const done = (fn, value) => {
                clearTimeout(timer);
                if (worker) worker.terminate();
                URL.revokeObjectURL(blobUrl);
                fn(value);
            };
            try {
                worker = new Worker(blobUrl);
            } catch (error) {
                done(reject, error);
                return;
            }
            timer = setTimeout(() => done(reject, new Error('Qwen tokenizer worker timed out')), WORKER_TIMEOUT_MS);
            worker.onmessage = (event) => {
                if (!event.data || event.data.error) done(reject, new Error((event.data && event.data.error) || 'empty reply'));
                else done(resolve, event.data);
            };
            worker.onerror = (event) => done(reject, new Error(event.message || 'Qwen tokenizer worker failed'));
            // Copied, not transferred: the page keeps the bytes for the fallback
            worker.postMessage({ bytes: buffer });
        });
    }

    const SLICE = 20000;
    function yieldToPage() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    async function buildTablesInSlices(parsed) {
        const tokens = parsed.tokens.split('\0');
        const ids = parsed.ids;
        if (tokens.length !== ids.length) throw new Error('Qwen tokenizer worker reply is inconsistent');
        const vocab = {};
        const decoder = [];
        for (let start = 0; start < tokens.length; start += SLICE) {
            const end = Math.min(tokens.length, start + SLICE);
            for (let i = start; i < end; i++) {
                vocab[tokens[i]] = ids[i];
                decoder[ids[i]] = tokens[i];
            }
            await yieldToPage();
        }
        const keys = parsed.mergeKeys ? parsed.mergeKeys.split('\0') : [];
        const mergeRanks = new Map();
        for (let start = 0; start < keys.length; start += SLICE) {
            const end = Math.min(keys.length, start + SLICE);
            for (let i = start; i < end; i++) mergeRanks.set(keys[i], i);
            await yieldToPage();
        }
        return { vocab, decoder, mergeRanks };
    }

    class QwenTokenizer {
        constructor() {
            this.tokenizer = null;
            this.loaded = false;
            this.specialTokens = new Set();
        }

        async loadFromDEF(definition) {
            if (!globalThis.fflate) {
                throw new Error('fflate must be loaded before the Qwen tokenizer');
            }
            const compressed = definition instanceof Uint8Array
                ? definition
                : new Uint8Array(definition);
            const decoded = globalThis.fflate.inflateSync(compressed);
            const config = JSON.parse(new TextDecoder('utf-8').decode(decoded));
            this.tokenizer = new QwenBpeCore(config);
            this.specialTokens = new Set(config.specialTokens || []);
            this.loaded = true;
            return this;
        }

        async loadFromURL(url) {
            const response = await fetch(url, { cache: 'force-cache' });
            if (!response.ok) {
                throw new Error(`Qwen tokenizer request failed with HTTP ${response.status}`);
            }
            const buffer = await response.arrayBuffer();
            if (canParseInWorker()) {
                try {
                    const parsed = await parseInWorker(buffer);
                    const tables = await buildTablesInSlices(parsed);
                    const config = { specialTokens: parsed.specialTokens, config: parsed.config };
                    this.tokenizer = new QwenBpeCore(config, tables);
                    this.specialTokens = new Set(config.specialTokens);
                    this.loaded = true;
                    return this;
                } catch (error) {
                    console.warn('Qwen tokenizer worker load failed, loading on the page:', error.message);
                }
            }
            return this.loadFromDEF(buffer);
        }

        checkLoaded() {
            if (!this.loaded) throw new Error('Qwen tokenizer is not loaded');
        }

        encode(text) {
            this.checkLoaded();
            return this.tokenizer.encode(text);
        }

        decode(tokenIds) {
            this.checkLoaded();
            return this.tokenizer.decode(tokenIds);
        }

        countTokens(text) {
            return this.encode(text).length;
        }

        analyzeTexts(texts, includeDetailedTokens = false) {
            const results = (texts || []).map((text) => {
                const tokenIds = this.encode(text || '');
                const result = { text, tokenCount: tokenIds.length };
                if (includeDetailedTokens) {
                    result.detailedTokens = tokenIds.map((tokenId) => {
                        const rawToken = this.tokenizer.decoder[tokenId];
                        const isSpecial = this.specialTokens.has(rawToken);
                        return {
                            tokenId,
                            text: isSpecial ? rawToken : this.decode([tokenId]),
                            strength: 0,
                            isSpecial,
                            isValid: true
                        };
                    });
                }
                return result;
            });
            return {
                totalTokens: results.reduce((sum, result) => sum + result.tokenCount, 0),
                results
            };
        }
    }

    return QwenTokenizer;
}));
