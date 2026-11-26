'use strict';

/**
 * What a review checks against the real world before it sends a gap back (#1256).
 *
 * Review 343 invented the gap "close out #852" from the Supervisor's own earlier note; #852 was already closed and
 * nothing looked. So a review now reads the state of the issues and commits the request, the Supervisor's note, the
 * steering and the agent's answer name, tells the model (section), and drops the gaps that state already settles (settle).
 *
 *   refsIn(texts, { defaultRepo })   { issues: [{ repo, number }], commits: [sha] } (8 and 8 at most)
 *   stateOf(refs, deps)              { defaultRepo, cwd, issues: [{ repo, number, state, closedAt, title }], commits: [{ sha, onMain }] }
 *   section(states)                  the prompt text ('' when nothing was found or read)
 *   settle(missed, states)           { missed, satisfied: [{ item, why }] }
 *   lastHumanText(messages, prefix)  the last user text that is not a Supervisor note
 *
 * One lookup is at most 3 s, all run in parallel, an answer is kept 60 s, every failure is "unknown" (state null) and
 * never fails a review. No timers run while idle; git runs through the spawn helper, never on the server loop.
 */

const MAX_ISSUES = 8;
const MAX_COMMITS = 8;
const LOOKUP_MS = 3000;
const CACHE_MS = 60000;
const DEFAULT_REPO = 'DreamScape/StaticForge';

const cache = new Map(); // key -> { at, value }
function _clearCache() { cache.clear(); }

// ---------------------------------------------------------------- refs

const FULL_RE = /(?<![\w/.-])([A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/g;
const URL_RE = /\/([A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+)\/issues\/(\d+)\b/g;
const BARE_RE = /(?<![\w/.#-])#(\d+)\b/g;
const SHA_RE = /\b[0-9a-f]{7,40}\b/g;

/** Issue refs (#123, owner/repo#123, an issue URL) and commit shas (7-40 hex with a digit and a letter) in the texts. */
function refsIn(texts, opts = {}) {
    const defaultRepo = opts.defaultRepo || DEFAULT_REPO;
    const issues = [];
    const commits = [];
    const seenI = new Set();
    const seenC = new Set();
    const addIssue = (repo, number) => {
        const k = `${repo}#${number}`;
        if (seenI.has(k) || issues.length >= MAX_ISSUES) return;
        seenI.add(k);
        issues.push({ repo, number: Number(number) });
    };
    (Array.isArray(texts) ? texts : [texts]).forEach((raw) => {
        const text = String(raw == null ? '' : raw);
        if (!text) return;
        const found = [];
        let m;
        FULL_RE.lastIndex = 0;
        while ((m = FULL_RE.exec(text))) found.push({ at: m.index, repo: m[1], number: m[2] });
        URL_RE.lastIndex = 0;
        while ((m = URL_RE.exec(text))) found.push({ at: m.index, repo: m[1], number: m[2] });
        BARE_RE.lastIndex = 0;
        while ((m = BARE_RE.exec(text))) found.push({ at: m.index, repo: defaultRepo, number: m[1] });
        found.sort((a, b) => a.at - b.at).forEach((f) => addIssue(f.repo, f.number));
        SHA_RE.lastIndex = 0;
        while ((m = SHA_RE.exec(text))) {
            const sha = m[0];
            if (!/\d/.test(sha) || !/[a-f]/.test(sha) || seenC.has(sha) || commits.length >= MAX_COMMITS) continue;
            seenC.add(sha);
            commits.push(sha);
        }
    });
    return { issues, commits };
}

// ---------------------------------------------------------------- state

function withCap(promise) {
    let timer;
    const cap = new Promise((resolve) => { timer = setTimeout(() => resolve(undefined), LOOKUP_MS); });
    return Promise.race([Promise.resolve(promise).catch(() => undefined), cap]).finally(() => clearTimeout(timer));
}

async function defaultIssue(repo, number) {
    const i = await require('./fleetYozora').call('GET', `/repos/${repo}/issues/${number}`);
    return i ? { state: i.state, closedAt: i.closed_at || '', title: i.title || '' } : null;
}

/** true / false from `git merge-base --is-ancestor`; null when git cannot tell (no such commit, no origin/main, timeout). */
async function defaultCommit(sha, cwd) {
    if (!cwd) return null;
    try {
        await require('./spawnHelper').execFileText('git', ['-C', cwd, 'merge-base', '--is-ancestor', sha, 'origin/main'], { timeout: LOOKUP_MS });
        return true;
    } catch (e) {
        return e && e.code === 1 ? false : null;
    }
}

function cached(key, make, useCache) {
    if (useCache) {
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.value);
    }
    return make().then((value) => {
        if (useCache && value !== null && value !== undefined && !(value && value.state === null)) cache.set(key, { at: Date.now(), value });
        return value;
    });
}

/**
 * The state now of each named issue and commit. deps (tests): { issue(repo, number) -> { state, closedAt, title },
 * commit(sha, cwd) -> bool|null, cwd, defaultRepo }; a lookup that fails, times out or has no answer is state null.
 */
async function stateOf(refs, deps = {}) {
    const r = refs || { issues: [], commits: [] };
    const injected = !!(deps.issue || deps.commit);
    const issueFn = deps.issue || defaultIssue;
    const commitFn = deps.commit || defaultCommit;
    const useCache = !injected;
    const issues = await Promise.all((r.issues || []).map(async (i) => {
        const got = await withCap(cached(`i:${i.repo}#${i.number}`, async () => {
            const v = await issueFn(i.repo, i.number);
            return v && (v.state === 'open' || v.state === 'closed') ? { state: v.state, closedAt: v.closedAt || '', title: v.title || '' } : null;
        }, useCache));
        return { repo: i.repo, number: i.number, state: got ? got.state : null, closedAt: got ? got.closedAt : '', title: got ? got.title : '' };
    }));
    const commits = await Promise.all((r.commits || []).map(async (sha) => {
        const got = await withCap(cached(`c:${deps.cwd || ''}:${sha}`, async () => {
            const v = await commitFn(sha, deps.cwd || '');
            return v === true || v === false ? { onMain: v } : null;
        }, useCache));
        return { sha, onMain: got ? got.onMain : null };
    }));
    return { defaultRepo: deps.defaultRepo || DEFAULT_REPO, cwd: deps.cwd || '', issues, commits };
}

const shortSha = (s) => String(s).slice(0, 9);
const day = (iso) => (/^\d{4}-\d{2}-\d{2}/.exec(String(iso || '')) || [''])[0];

/** The prompt section: what the issues and commits named in this turn are, read now. '' when nothing was read. */
function section(states) {
    if (!states) return '';
    const lines = [];
    (states.issues || []).forEach((i) => {
        if (i.state !== 'open' && i.state !== 'closed') return;
        const when = i.state === 'closed' && day(i.closedAt) ? ` ${day(i.closedAt)}` : '';
        lines.push(`- ${i.repo}#${i.number}: ${i.state}${when}${i.title ? ` (${String(i.title).replace(/\s+/g, ' ').slice(0, 120)})` : ''}`);
    });
    (states.commits || []).forEach((c) => {
        if (c.onMain === null || c.onMain === undefined) return;
        lines.push(`- commit ${shortSha(c.sha)}: ${c.onMain ? 'on origin/main' : 'not on origin/main'}`);
    });
    return lines.length ? `## Current state of what is named (read now)\n${lines.join('\n')}` : '';
}

// ---------------------------------------------------------------- settle

const CLOSE_VERB = '(?:close(?:\\s+out)?|close-out|mark(?:\\s+it)?(?:\\s+as)?\\s+(?:done|closed|finished)|finish\\s+off|resolve|wrap\\s+up)';
const ISSUE_TOKEN = '(?:the\\s+)?(?:issue\\s+|ticket\\s+)?(?:[A-Za-z0-9_-]+\\/[A-Za-z0-9_.-]+)?#\\d+';
// the whole ask is closing one issue ("Close out #852", "close #852 as the request requires")
const CLOSE_ALL_RE = new RegExp(`^\\W*(?:please\\s+|also\\s+|then\\s+)*${CLOSE_VERB}\\s+${ISSUE_TOKEN}\\W*(?:\\s+(?:as|since|because|per|so that|in line with)\\b[^.;]*)?\\W*$`, 'i');
// "X (and close out #N)": only the parenthetical is closing an issue
const CLOSE_PAREN_RE = new RegExp(`\\s*\\(\\s*(?:and\\s+|also\\s+|then\\s+)?${CLOSE_VERB}\\s+${ISSUE_TOKEN}[^()]*\\)`, 'i');
const PUSH_VERB = '(?:push|publish|land|merge|ship)';
const PUSH_RE = new RegExp(`^\\W*(?:please\\s+|also\\s+|then\\s+)*${PUSH_VERB}\\s+(?:the\\s+)?(?:commits?\\s+)?([0-9a-f]{7,40})(?:\\s+(?:to|onto|into)\\s+(?:origin\\/)?(?:main|master))?\\W*$`, 'i');

const issueOf = (states, repo, number) => (states.issues || []).find((i) => i.repo === repo && i.number === number);

/**
 * Drops the missed items the state already settles. Conservative: only "close (out) #N" with #N closed now (or the
 * parenthetical of a compound item, which is cut out of the item) and "push <sha>" with the sha on origin/main now.
 * Anything unknown or unclear stays missed. { missed, satisfied: [{ item, why }] }
 */
function settle(missed, states) {
    const list = Array.isArray(missed) ? missed : [];
    if (!states || !list.length) return { missed: list, satisfied: [] };
    const repo = states.defaultRepo || DEFAULT_REPO;
    const keep = [];
    const satisfied = [];
    list.forEach((m) => {
        const text = String((m && m.item) || '');
        // (a) the whole ask is closing an issue that is closed now
        if (CLOSE_ALL_RE.test(text)) {
            const refs = refsIn([text], { defaultRepo: repo }).issues;
            if (refs.length === 1) {
                const st = issueOf(states, refs[0].repo, refs[0].number);
                if (st && st.state === 'closed') { satisfied.push({ item: text, why: `${refs[0].repo}#${refs[0].number} is already closed` }); return; }
            }
        }
        // (a2) "X (and close out #N)" with #N closed: the parenthetical goes, X stays
        const paren = CLOSE_PAREN_RE.exec(text);
        if (paren) {
            const refs = refsIn([paren[0]], { defaultRepo: repo }).issues;
            const st = refs.length === 1 ? issueOf(states, refs[0].repo, refs[0].number) : null;
            if (st && st.state === 'closed') {
                const rest = text.replace(CLOSE_PAREN_RE, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
                if (rest && /[A-Za-z0-9]/.test(rest)) {
                    satisfied.push({ item: text, why: `${refs[0].repo}#${refs[0].number} is already closed` });
                    keep.push(Object.assign({}, m, { item: rest }));
                    return;
                }
            }
        }
        // (b) the whole ask is pushing a named commit that is on origin/main now
        const push = PUSH_RE.exec(text);
        if (push && /\d/.test(push[1]) && /[a-f]/i.test(push[1])) {
            const sha = push[1].toLowerCase();
            const c = (states.commits || []).find((x) => x.onMain === true && (x.sha.startsWith(sha) || sha.startsWith(x.sha)));
            if (c) { satisfied.push({ item: text, why: `commit ${shortSha(c.sha)} is already on origin/main` }); return; }
        }
        keep.push(m);
    });
    return { missed: keep, satisfied };
}

/** The last user text that does not start with the Supervisor's prefix (a session without a work item: the real request). */
function lastHumanText(messages, prefix) {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const m = list[i];
        if (!m || m.sidechain || m.role !== 'user' || m.kind !== 'text') continue;
        const t = String(m.text || '').trim();
        if (t && !(prefix && t.startsWith(prefix))) return t;
    }
    return '';
}

module.exports = { refsIn, stateOf, section, settle, lastHumanText, _clearCache, MAX_ISSUES, MAX_COMMITS };
