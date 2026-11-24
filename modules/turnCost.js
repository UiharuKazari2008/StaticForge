'use strict';

/**
 * What a Director turn really cost (Yukimi, Nov 24 2026: "where can we put the cost of a run ... and what cost so much").
 * The agent CLI prices every model it does not know as Claude Opus ($5 / $0.50 / $25 per million): a DeepSeek-V4.1-Flash
 * turn on DeepInfra that cost about 9 cents read as $3.63. Here a turn is priced from its own token counts and the
 * provider's own price list:
 *   DeepInfra   GET https://api.deepinfra.com/models/<model> -> pricing { cents_per_input_token, cents_per_output_token,
 *               rate_per_input_token_cached } (read at most every 12 h per model, never during a turn's wait)
 *   Anthropic   Claude models by family (Opus 5 / 25, Sonnet 3 / 15, Haiku 1 / 5 per million; cache reads 0.1x, writes 1.25x)
 *   otherwise   no price (the tokens are still shown)
 *
 *   priceTurn({ engine, model, usage }) -> Promise<{ usd: number | null, basis: string | null }>
 *   turnRecord(stats) -> the record kept on the reply: { ms, steps, input, cached, cacheWrite, output, usd, basis }
 */

const PRICE_TTL_MS = 12 * 60 * 60 * 1000;
const deepinfra = new Map(); // model -> { at, price: { in, out, cached } | null, promise }

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function deepinfraPrice(model) {
    const now = Date.now();
    const kept = deepinfra.get(model);
    if (kept && kept.price !== undefined && now - kept.at < PRICE_TTL_MS) return Promise.resolve(kept.price);
    if (kept && kept.promise) return kept.promise;
    const promise = (async () => {
        try {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 8000);
            const res = await fetch(`https://api.deepinfra.com/models/${encodeURIComponent(model).replace(/%2F/gi, '/')}`, { signal: ac.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            const p = body && body.pricing;
            if (!p || p.type !== 'tokens' || !Number.isFinite(Number(p.cents_per_input_token))) throw new Error('no token pricing');
            const inUsd = Number(p.cents_per_input_token) / 100;
            const outUsd = num(p.cents_per_output_token) / 100;
            const cachedRate = Number.isFinite(Number(p.rate_per_input_token_cached)) ? Number(p.rate_per_input_token_cached) : 1;
            const price = { in: inUsd, out: outUsd, cached: inUsd * cachedRate };
            deepinfra.set(model, { at: Date.now(), price });
            return price;
        } catch (err) {
            // (a failed read is tried again in 10 minutes, not on every turn)
            deepinfra.set(model, { at: Date.now() - PRICE_TTL_MS + 10 * 60 * 1000, price: (kept && kept.price) || null });
            return (kept && kept.price) || null;
        }
    })();
    deepinfra.set(model, Object.assign({}, kept || {}, { promise }));
    return promise;
}

function anthropicPrice(model) {
    const m = String(model || '').toLowerCase();
    let base = null;
    if (/opus/.test(m)) base = { in: 5, out: 25 };
    else if (/sonnet/.test(m)) base = { in: 3, out: 15 };
    else if (/haiku/.test(m)) base = { in: 1, out: 5 };
    if (!base) return null;
    const M = 1e6;
    return { in: base.in / M, out: base.out / M, cached: (base.in * 0.1) / M, write: (base.in * 1.25) / M };
}

/** The turn's price in US dollars from its usage, or null when the provider's price is not known. */
async function priceTurn({ engine, model, usage } = {}) {
    if (!usage || !model) return { usd: null, basis: null };
    const e = String(engine || '').toLowerCase();
    let price = null;
    let basis = null;
    if (e.includes('deepinfra')) { price = await deepinfraPrice(model); basis = price ? 'deepinfra' : null; }
    else if (/claude|anthropic/.test(e) || /^claude/i.test(model)) { price = anthropicPrice(model); basis = price ? 'anthropic' : null; }
    if (!price) return { usd: null, basis: null };
    const usd = num(usage.input_tokens) * price.in
        + num(usage.cache_read_input_tokens) * price.cached
        + num(usage.cache_creation_input_tokens) * (price.write || price.in)
        + num(usage.output_tokens) * price.out;
    return { usd: Math.round(usd * 1e6) / 1e6, basis };
}

/** The figures kept on a reply for its turn (the CLI's own cost estimate is never used). */
function turnRecord({ ms, steps, usage, usd, basis }) {
    const u = usage || {};
    return {
        ms: Number.isFinite(ms) ? Math.round(ms) : null,
        steps: Number.isFinite(steps) ? steps : null,
        input: num(u.input_tokens),
        cached: num(u.cache_read_input_tokens),
        cacheWrite: num(u.cache_creation_input_tokens),
        output: num(u.output_tokens),
        usd: Number.isFinite(usd) ? usd : null,
        basis: basis || null
    };
}

module.exports = { priceTurn, turnRecord, _test: { anthropicPrice, deepinfra } };
