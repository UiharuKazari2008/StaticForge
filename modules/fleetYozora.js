'use strict';

/**
 * The Supervisor's work queue tracked in Yozora (#1154, Yukimi Nov 24 2026: "your work queue should use
 * tracking in the Yozora issues of that project and show in the interface by getting items with that tag
 * on their issue ... external tracking and handling. Using comments as an easy way for updates of progress
 * and better handling of the timer and definition of done tracking. You don't have to force all data into
 * the issue but the issue should stay in sync with Fleet").
 *
 *   issue     every work item has one issue in its project's repo (the repo of its folder's git remote on
 *             Yozora; DreamScape/StaticForge by default), labelled `fleet`: a new one (the brief, the
 *             definition of done, a hidden <!-- fleet-work:<id> --> marker) or the issue it came from
 *   comments  the Supervisor comments each state change: started (account, engine, model, session link),
 *             gaps sent back (the missed items), done (the Supervisor's verdict), failed, cancelled
 *   labels    status:* follow the state (running / waiting -> in-progress, done -> review, failed ->
 *             blocked) where the repo has them; the DreamScape board card moves with them
 *   time      the time a session ran is added to the issue as tracked time when it ends (no stopwatch: one
 *             stopwatch per account, and several sessions run at once)
 *   pull      open issues labelled `fleet` in the watched repos (config agentSupervisor.yozoraRepos, default
 *             DreamScape/StaticForge, plus every repo an item uses) that no item has yet become queued
 *             items (`fleet:now` also starts them); an item whose issue was closed on Yozora ends (queued ->
 *             cancelled, else done). Pulled when Fleet reads the queue (at most every 2 min) and every 10 min
 *             on the server.
 *
 * Token: Yozora's own (director.yozora, ~/.secrets/yozora-yozora.token; Yukimi Nov 24 2026: "all the fleet
 * system should use Yozora's token not Claude, pretty much only the host session should use that"), read on
 * every call, never logged. Every call is best effort: Yozora being away never stops the queue.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOST = 'yozora.bluesteel.737.jp.net';
const API = `https://${HOST}/api/v1`;
const WEB = `https://${HOST}`;
const DEFAULT_REPO = 'DreamScape/StaticForge';
const LABEL = 'fleet';
const LABEL_NOW = 'fleet:now';
const BOARD = { org: 'DreamScape', project: 5, columns: { queued: 23, running: 24, waiting: 24, done: 25, failed: 26 } };
// done = the Supervisor checked the work itself (nothing missed, tested with evidence): the issue closes as done.
// Yukimi, Nov 24 2026: "review at this point means the supervisor needs to look over the work and review it itself
// ... I don't and should not have to review a task, that's the point of the supervisor."
const STATUS_LABEL = { queued: 'status:ready', starting: 'status:in-progress', running: 'status:in-progress', waiting: 'status:in-progress', done: 'status:done', failed: 'status:blocked' };
const MARK = (id) => `<!-- fleet-work:${id} -->`;

function token() {
    for (const name of ['yozora-yozora.token']) {
        try { const t = fs.readFileSync(path.join(os.homedir(), '.secrets', name), 'utf8').trim(); if (t) return t; } catch (_) { /* next */ }
    }
    throw new Error('no Yozora (director.yozora) token in ~/.secrets/yozora-yozora.token');
}

let fetchFn = (...a) => fetch(...a);
function _setFetch(fn) { fetchFn = typeof fn === 'function' ? fn : (...a) => fetch(...a); }

async function call(method, url, body) {
    const res = await fetchFn(API + url, {
        method,
        headers: Object.assign({ Authorization: `token ${token()}`, Accept: 'application/json' }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000)
    });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`Yozora ${method} ${url.split('?')[0]}: HTTP ${res.status}`), { status: res.status });
    try { return text ? JSON.parse(text) : null; } catch (_) { return null; }
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** owner/repo of a folder's git remote on Yozora, else the default repo. */
const repoCache = new Map();
function repoForCwd(cwd) {
    const d = String(cwd || '');
    if (repoCache.has(d)) return repoCache.get(d);
    let repo = DEFAULT_REPO;
    try {
        const urls = execFileSync('git', ['-C', d || path.join(__dirname, '..'), 'remote', '-v'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
        const m = new RegExp(`${HOST.replace(/\./g, '\\.')}[/:]([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\\.git)?\\s`).exec(urls);
        if (m) repo = `${m[1]}/${m[2]}`;
    } catch (_) { /* default */ }
    repoCache.set(d, repo);
    return repo;
}

/** "owner/repo#12" or a Yozora issue URL -> { repo, number }. */
function parseIssueRef(ref) {
    const s = String(ref || '').trim();
    let m = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/.exec(s);
    if (m) return { repo: m[1], number: Number(m[2]) };
    m = new RegExp(`${HOST.replace(/\./g, '\\.')}/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/issues/(\\d+)`).exec(s);
    if (m) return { repo: m[1], number: Number(m[2]) };
    m = /^#?(\d+)$/.exec(s);
    if (m) return { repo: DEFAULT_REPO, number: Number(m[1]) };
    return null;
}
const issueUrl = (repo, number) => `${WEB}/${repo}/issues/${number}`;

const labelCache = new Map(); // repo -> { at, byName }
async function labels(repo) {
    const c = labelCache.get(repo);
    if (c && Date.now() - c.at < 5 * 60 * 1000) return c.byName;
    const list = (await call('GET', `/repos/${repo}/labels?limit=100`)) || [];
    const byName = new Map(list.map((l) => [l.name, l.id]));
    labelCache.set(repo, { at: Date.now(), byName });
    return byName;
}
async function ensureFleetLabel(repo) {
    const by = await labels(repo);
    if (by.has(LABEL)) return by.get(LABEL);
    const made = await call('POST', `/repos/${repo}/labels`, { name: LABEL, color: '#1f6feb', description: 'Tracked by Fleet: the Supervisor\'s work queue runs it as a supervised Claude session' });
    labelCache.delete(repo);
    return made && made.id;
}

function doneList(item) {
    const p = String(item.prompt || '');
    const m = /(?:^|\n)#{0,3}\s*(?:Acceptance|Definition of done)[^\n]*\n([\s\S]{0,3000}?)(?:\n#{1,3}\s|\n\n\n|$)/i.exec(p);
    const own = m ? m[1].trim().split('\n').filter((l) => l.trim()).map((l) => `- [ ] ${l.replace(/^\s*(?:[-*]\s*(?:\[[ x]\]\s*)?|\d+[.)]\s*)/, '')}`) : [];
    return own.concat([
        '- [ ] Every part of the request and of any steering is addressed (the Supervisor\'s check says ok)',
        '- [ ] Committed and pushed (commit-each-turn); build gate used for any build / restart',
        '- [ ] Done comment on this issue (commit, files, how to verify)'
    ]);
}

/** Makes the item's issue (or links the one it names). Answers { repo, number, id, url }. */
async function createIssue(item) {
    const repo = REPO_RE.test(item.issueRepo || '') ? item.issueRepo : repoForCwd(item.cwd);
    const fleetLabel = await ensureFleetLabel(repo).catch(() => null);
    const by = await labels(repo).catch(() => new Map());
    const ids = [fleetLabel, by.get('status:ready'), by.get('type:feature')].filter(Boolean);
    const body = [
        `Queued in **Fleet** (the Supervisor's work queue, item ${item.id}, from ${item.source}). It runs as a supervised Claude Code session; the Supervisor comments here when it starts, when it sends gaps back, and when it ends, and adds the time it ran. Tracked by Yozora (\`director.yozora\`) for Fleet.`,
        '',
        '## Brief',
        '',
        String(item.prompt || '').slice(0, 30000),
        '',
        '## Definition of done',
        '',
        ...doneList(item),
        '',
        MARK(item.id)
    ].join('\n');
    const issue = await call('POST', `/repos/${repo}/issues`, { title: String(item.title || 'Fleet work').slice(0, 200), body, labels: ids, assignees: ['director.yozora'] });
    if (repo.startsWith(`${BOARD.org}/`) && issue && issue.id) await call('POST', `/orgs/${BOARD.org}/projects/${BOARD.project}/columns/${BOARD.columns.queued}/issues/${issue.id}`).catch(() => {});
    return { repo, number: issue.number, id: issue.id, url: issueUrl(repo, issue.number) };
}

/** Links an existing issue: adds the fleet label. */
async function linkIssue(ref) {
    const r = parseIssueRef(ref);
    if (!r) throw new Error(`Not an issue: ${ref}`);
    const issue = await call('GET', `/repos/${r.repo}/issues/${r.number}`);
    const fleetLabel = await ensureFleetLabel(r.repo).catch(() => null);
    if (fleetLabel && !(issue.labels || []).some((l) => l.name === LABEL)) await call('POST', `/repos/${r.repo}/issues/${r.number}/labels`, { labels: [fleetLabel] }).catch(() => {});
    return { repo: r.repo, number: r.number, id: issue.id, url: issueUrl(r.repo, r.number), title: issue.title, body: issue.body || '' };
}

async function comment(repo, number, text) {
    return call('POST', `/repos/${repo}/issues/${number}/comments`, { body: text });
}

/** status:* labels follow the state (where the repo has them); the board card moves (DreamScape). */
async function setStatus(repo, number, issueId, state) {
    const want = STATUS_LABEL[state];
    const by = await labels(repo);
    if (want && by.has(want)) {
        const issue = await call('GET', `/repos/${repo}/issues/${number}`);
        const keep = (issue.labels || []).filter((l) => !String(l.name).startsWith('status:')).map((l) => l.id);
        await call('PUT', `/repos/${repo}/issues/${number}/labels`, { labels: keep.concat([by.get(want)]) });
    }
    const col = BOARD.columns[state];
    if (col && issueId && repo.startsWith(`${BOARD.org}/`)) await call('POST', `/orgs/${BOARD.org}/projects/${BOARD.project}/issues/${issueId}/move`, { column_id: col }).catch(() => {});
}

async function addTime(repo, number, seconds) {
    const s = Math.round(Number(seconds) || 0);
    if (s < 30) return null;
    return call('POST', `/repos/${repo}/issues/${number}/times`, { time: s });
}

async function close(repo, number) {
    return call('PATCH', `/repos/${repo}/issues/${number}`, { state: 'closed' });
}

/** Open issues labelled fleet in a repo: [{ repo, number, id, title, body, url, now, labels }]. */
async function openFleetIssues(repo) {
    const list = ((await call('GET', `/repos/${repo}/issues?state=open&type=issues&labels=${encodeURIComponent(LABEL)}&limit=50`)) || [])
        // Gitea ignores a label filter it cannot resolve and answers EVERY open issue (#1154, Nov 24: 50 issues
        // were queued that way): only issues that really carry the label count
        .filter((i) => (i.labels || []).some((l) => l && l.name === LABEL));
    return list.map((i) => ({ repo, number: i.number, id: i.id, title: i.title, body: i.body || '', url: issueUrl(repo, i.number), labels: (i.labels || []).map((l) => l.name), now: (i.labels || []).some((l) => l.name === LABEL_NOW), marker: (/<!-- fleet-work:(\d+) -->/.exec(i.body || '') || [])[1] || null }));
}

/** One issue: { repo, number, id, title, body, url, state } (several issues in one run: the brief names each, #1191). */
async function getIssue(repo, number) {
    const i = await call('GET', `/repos/${repo}/issues/${number}`);
    if (!i) throw new Error(`No issue ${repo}#${number}`);
    return { repo, number: i.number || number, id: i.id, title: i.title || '', body: i.body || '', url: issueUrl(repo, i.number || number), state: i.state };
}

/**
 * Open issues of a repo, newest first (Gitea's default order), for the Work Queue's issue picker: one request, no polling.
 * [{ repo, number, id, title, url, labels }]; q filters by title (and is passed to Gitea's own search).
 */
async function openIssues(repo, opts = {}) {
    if (!REPO_RE.test(String(repo || ''))) throw new Error(`Not a repository: ${repo}`);
    const limit = Math.max(1, Math.min(100, Number(opts.limit) || 100));
    const q = String(opts.q || '').trim();
    const list = (await call('GET', `/repos/${repo}/issues?state=open&type=issues&limit=${limit}${q ? `&q=${encodeURIComponent(q)}` : ''}`)) || [];
    const want = q.toLowerCase();
    return list.filter((i) => i && i.number && !i.pull_request && (!want || String(i.title || '').toLowerCase().includes(want)))
        .map((i) => ({ repo, number: i.number, id: i.id, title: i.title || '', url: issueUrl(repo, i.number), labels: (i.labels || []).map((l) => l.name) }));
}

async function issueState(repo, number) {
    const i = await call('GET', `/repos/${repo}/issues/${number}`);
    return i ? i.state : null;
}

module.exports = {
    DEFAULT_REPO, LABEL, LABEL_NOW, repoForCwd, parseIssueRef, issueUrl, createIssue, linkIssue, comment, setStatus, addTime, close,
    openFleetIssues, openIssues, getIssue, issueState, call, labels, _setFetch, _doneList: doneList, MARK
};
