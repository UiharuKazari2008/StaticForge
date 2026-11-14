/**
 * Search predictions for Melaton Mobile's Internet Search (Yozora #830): the engines' own suggestion
 * lists, fetched here because a page cannot read them across origins.
 *
 *   GET /api/search-suggest?engine=google|bing&q=<text>  -> { success, engine, q, suggestions: [string] }
 *
 * Both answer OpenSearch JSON ([query, [suggestion, ...]]). Answers are kept for 5 minutes (at most
 * 500 queries); an engine that does not answer within 2.5 s gives an empty list, never an error page.
 */
'use strict';

const ENGINES = {
    google: (q) => `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(q)}`,
    bing: (q) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`
};
const TTL_MS = 5 * 60 * 1000;
const MAX_KEPT = 500;
const TIMEOUT_MS = 2500;
const kept = new Map(); // `${engine}\n${q}` -> { at, list }

async function suggestions(engine, q) {
    const key = `${engine}\n${q}`;
    const had = kept.get(key);
    if (had && Date.now() - had.at < TTL_MS) return had.list;
    let list = [];
    try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
        const res = await fetch(ENGINES[engine](q), { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Melaton Mobile) Dreamscape', Accept: 'application/json' } });
        clearTimeout(timer);
        if (res.ok) {
            // Google answers in the query's own charset; the text is read as UTF-8 either way
            const data = JSON.parse(await res.text());
            if (Array.isArray(data) && Array.isArray(data[1])) list = data[1].filter((s) => typeof s === 'string' && s.trim()).slice(0, 10);
        }
    } catch (_) {
        list = [];
    }
    if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value);
    kept.set(key, { at: Date.now(), list });
    return list;
}

function mount(app, authMiddleware) {
    const auth = authMiddleware || ((req, res, next) => next());
    app.get('/api/search-suggest', auth, async (req, res) => {
        const engine = ENGINES[String(req.query.engine || '')] ? String(req.query.engine) : 'google';
        const q = String(req.query.q || '').trim().slice(0, 200);
        res.set('Cache-Control', 'private, max-age=300');
        if (!q) { res.json({ success: true, engine, q, suggestions: [] }); return; }
        res.json({ success: true, engine, q, suggestions: await suggestions(engine, q) });
    });
}

module.exports = { mount, suggestions };
