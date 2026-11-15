'use strict';

/**
 * Fault auto-fix (Yozora #833): a new or regressed fault report (modules/programFaultReports.js)
 * starts a headless Claude Code run that finds the cause and fixes it, following this repo's rules
 * (CLAUDE.md, .cursor/rules: Yozora issue, busy lock, Done comment).
 *
 *   change event -> eligible? -> queued (settleMs, so repeats and the dialog's button land first)
 *   -> one run at a time, at most maxRunsPerDay -> claude -p ... (detached with setsid, so a server
 *   restart, which a fix may need, does not kill it) -> the run's last line
 *     FAULT_FIX_RESULT {"status": "...", "issue": N, "commit": "...", "branch": "...", "summary": "..."}
 *   is written back to the report's `fix` field.
 *
 * Before every run, in this order and by this module (not left to the agent), Yukimi 2026-11-14:
 *   1. a Yozora issue for the fault: an open issue that names the fault id is reused, else a new
 *      "[Fault] <program>: <message>" (type:bug, status:in-progress, carded In progress) is opened;
 *   2. the live tree is committed as it stands ("chore(autofix): snapshot ..."), so the run starts
 *      from committed code and its fix is a commit of its own on top.
 *   If either step fails (Yozora down, git busy) the run does not start: the fault goes back in the
 *   queue for PREP_RETRY_MS, and after PREP_MAX_FAILURES it is marked failed. When the run ends,
 *   this module comments its result (status, summary, commit, log) on that issue.
 *
 * Modes (config.json faultAutoFix.mode):
 *   worktree  (default) the run works in .claude/worktrees/autofix-<fault id> on branch
 *             autofix/<fault id>, commits there and does not push; fix.state "proposed" until
 *             someone lands the branch. The live tree and the running server are not touched.
 *   live      the run works in the live tree like any other agent here (lock, commit whole files,
 *             push to Yozora main as claude, SW notify / idle-checked restart when needed);
 *             fix.state "fixed" and the report's status "fixed", so the fault coming back reopens
 *             it as "regressed" and queues another attempt (up to maxAttemptsPerFault).
 *
 * Eligible: the fault's surface and kind are in the config lists (logged is off by default), it
 * has a frame of ours, it is not known noise (network drops, ResizeObserver, extension frames,
 * test helpers), it did not come from a headless test tab unless includeHeadless, and its fix
 * attempts and cooldown allow it. POST /api/fault-reports/:id/fix (admin) queues one by hand,
 * ignoring the filters and the daily cap but not the one-at-a-time rule.
 *
 *   GET  /api/fault-autofix              -> { ok, editable, config, settings, active, queue, today }
 *   PUT  /api/fault-autofix/settings     -> same; admin. { enabled, mode, maxRunsPerDay } from
 *        Problem Reports and Solutions > Change settings > Advanced settings (cplPages2.js) and the
 *        phone's Error Reporting > Auto-fix tab (wmSettingsDreamscape.js); saved in
 *        data/fault-reports/.autofix-settings.json, over config.json faultAutoFix
 *   POST /api/fault-reports/:id/fix      -> { ok, queued }            admin
 *   POST /api/fault-autofix/cancel       -> { ok, cancelled }         admin, stops the active run
 *
 * State (queue, active run, daily count) is kept in data/fault-reports/.autofix-state.json so it
 * survives restarts; run logs are in data/fault-reports/autofix-logs/<run id>.ndjson.
 *
 * Test: scripts/test-error-capture.js
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const RESULT_RE = /FAULT_FIX_RESULT\s*(\{[\s\S]*?\})\s*$/m;
const RESULT_STATES = new Set(['fixed', 'not-a-bug', 'needs-human', 'blocked', 'failed']);
const CHECK_MS = 15 * 1000;
const PREP_RETRY_MS = 10 * 60 * 1000;
const PREP_MAX_FAILURES = 6;
const YOZORA_API = 'https://yozora.bluesteel.737.jp.net/api/v1';
const YOZORA_REPO = 'DreamScape/StaticForge';
const YOZORA_PROJECT = 'orgs/DreamScape/projects/5';
const YOZORA_IN_PROGRESS_COLUMN = 24;

const DEFAULTS = {
    enabled: true,
    mode: 'worktree',
    surfaces: ['desktop', 'mobile', 'server'],
    // resource (a script failed to load) and logged are captured but mostly restarts and outside failures
    kinds: ['crash', 'uncaught', 'rejection', 'route', 'dialog', 'swallowed'],
    includeHeadless: false,
    settleMs: 2 * 60 * 1000,
    maxRunsPerDay: 8,
    maxAttemptsPerFault: 2,
    cooldownMs: 6 * 3600 * 1000,
    runTimeoutMs: 45 * 60 * 1000,
    effort: 'high',
    model: '',
    ignore: []
};

// Not bugs in our code: the network, the browser, extensions, deliberate test faults.
const NOISE = [
    /^Failed to fetch\b/i, /NetworkError when attempting/i, /^Load failed$/i, /ResizeObserver loop/i,
    /^Script error\.?$/i, /\bAbortError\b/, /The (user|operation) (was )?aborted/i, /signal is aborted/i,
    /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|ENOTFOUND)\b/,
    /socket hang up/i, /Test uncaught exception/i, /QuotaExceededError/i, /The play\(\) request was interrupted/i,
    /Request aborted/i, /NotAllowedError: play\(\) failed/i
];
const EXTENSION_FRAME = /(chrome|moz|safari)-extension:\/\//;
const SETTINGS_KEYS = ['enabled', 'mode', 'maxRunsPerDay'];
const MAX_RUNS_PER_DAY = 50;

/** Only the keys the settings pages may change, each checked; anything else is dropped. */
function cleanSettings(input) {
    const out = {};
    if (!input || typeof input !== 'object') return out;
    if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
    if (input.mode === 'live' || input.mode === 'worktree') out.mode = input.mode;
    const n = Number(input.maxRunsPerDay);
    if (input.maxRunsPerDay !== undefined && input.maxRunsPerDay !== null && Number.isInteger(n) && n >= 0 && n <= MAX_RUNS_PER_DAY) out.maxRunsPerDay = n;
    return out;
}

/**
 * The effective config: DEFAULTS < config.json faultAutoFix < the settings saved from Problem
 * Reports and Solutions (desktop Control Panel) / Error Reporting (phone), SETTINGS_KEYS only.
 */
function cfg(getConfig, saved) {
    let raw = {};
    try { raw = (getConfig && getConfig().faultAutoFix) || {}; } catch (_) { raw = {}; }
    const c = Object.assign({}, DEFAULTS, raw && typeof raw === 'object' ? raw : {}, cleanSettings(saved));
    c.mode = c.mode === 'live' ? 'live' : 'worktree';
    c.ignore = (Array.isArray(c.ignore) ? c.ignore : []).map((p) => { try { return new RegExp(p, 'i'); } catch (_) { return null; } }).filter(Boolean);
    return c;
}

/** Why a report is not for the fixer (null when it is). */
function ineligible(report, c, manual) {
    if (!report) return 'no report';
    const fix = report.fix || {};
    if (fix.state === 'queued' || fix.state === 'running') return 'already ' + fix.state;
    if (manual) return null;
    if (fix.state === 'proposed') return 'a fix is waiting to be landed';
    if (fix.state === 'needs-human' || fix.state === 'not-a-bug') return 'last run said ' + fix.state;
    if ((fix.attempts || 0) >= c.maxAttemptsPerFault) return 'out of attempts';
    if (fix.finishedAt && Date.now() - Date.parse(fix.finishedAt) < c.cooldownMs) return 'cooling down';
    if (!c.surfaces.includes(report.surface || 'desktop')) return 'surface ' + report.surface + ' is off';
    if (!c.kinds.includes(report.kind || 'dialog')) return 'kind ' + report.kind + ' is off';
    const latest = report.latest || {};
    const text = `${report.errorName || ''}: ${report.message || ''}`;
    if (NOISE.some((re) => re.test(text) || re.test(report.message || ''))) return 'noise';
    if (c.ignore.some((re) => re.test(text) || re.test(latest.stack || ''))) return 'ignored by config';
    if (EXTENSION_FRAME.test(latest.stack || '')) return 'extension frame';
    const ua = (latest.client && latest.client.userAgent) || '';
    if (!c.includeHeadless && /HeadlessChrome/.test(ua)) return 'headless test tab';
    const own = (report.surface === 'server')
        ? /\/(modules|services|apps|polymodules|scripts)\/|web_server\.js/.test(latest.stack || '')
        : /\/(scripts|apps|css)\//.test(latest.stack || '') || (report.kind === 'resource');
    if (!own) return 'no frame of ours';
    return null;
}

/** The minified code around each client frame (served scripts are terser copies without maps). */
function minifiedContext(stack, root = REPO_ROOT) {
    const out = [];
    const seen = new Set();
    for (const line of String(stack || '').split('\n')) {
        const m = line.match(/(?:https?:\/\/[^/\s)]+)?(\/(?:scripts|apps)\/[^\s?):]+\.js)(?:\?[^\s):]*)?:(\d+):(\d+)/);
        if (!m) continue;
        const key = `${m[1]}:${m[2]}:${m[3]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const compiled = path.join(root, '.cache', 'runtime-assets', m[1]);
        try {
            const lines = fs.readFileSync(compiled, 'utf8').split('\n');
            const text = lines[Number(m[2]) - 1] || '';
            const col = Number(m[3]) - 1;
            out.push(`${m[1]}:${m[2]}:${m[3]} (minified) ...${text.slice(Math.max(0, col - 220), col)}<<HERE>>${text.slice(col, col + 220)}...`);
        } catch (_) { /* not a compiled copy (apps, or gone) */ }
        if (out.length >= 3) break;
    }
    return out;
}

function trimReport(report) {
    const r = JSON.parse(JSON.stringify(report));
    delete r.fix;
    if (Array.isArray(r.recent)) r.recent = r.recent.slice(0, 4);
    return r;
}

function buildPrompt(report, c, run) {
    const ctx = minifiedContext(report.latest && report.latest.stack);
    const where = c.mode === 'live'
        ? [
            `Mode: live. You work in the live tree (${REPO_ROOT}), like any other agent here. Follow CLAUDE.md and every .cursor/rules file: plant .agent-autofix-${report.id} before the first edit and delete it when done; if another agent's lock covers the files you need, stop with status "blocked".`,
            `Before you started, the fixer committed the live tree as it stood (${run.snapshot || 'nothing to commit'}): that snapshot is Yukimi's rule and is yours to push with your fix. Commit your fix as its own commit (whole files) and push to Yozora main as claude; if origin/main..HEAD also holds other sessions' commits besides the snapshot, do not push them: leave your commit local and say so in the Done comment. Client asset changes need the service worker notify; a server code change needs the idle-checked restart the rules describe.`
        ]
        : [
            `Mode: worktree. You work only in ${run.cwd} (branch ${run.branch}, made from the live HEAD). node_modules is a link to the live tree's (never commit it). Do not edit, commit or restart anything in ${REPO_ROOT}, and do not push.`,
            `The fixer committed the live tree before you started (${run.snapshot || 'nothing to commit'}); your branch starts there. Commit your fix on the branch. Someone lands it later, so make the commit message and the issue comment say exactly what changed and why.`
        ];
    return [
        `You are the Dreamscape fault auto-fix agent: a headless Claude Code run that modules/faultAutoFix.js started for fault report ${report.id} (run ${run.id}). No human is watching this run, so never wait for an answer: decide, or stop with status "needs-human".`,
        '',
        'The task: find the root cause of the fault below and fix it in the source, if it is a bug in our code.',
        ...where,
        '',
        'Steps:',
        `1. Yozora (CLAUDE.md "Yozora access"): this fault's issue is #${run.issue}, opened (or found) by the fixer. Use it; do not open another one for this fault. Start its stopwatch and comment that you started. Other problems you find go on new issues, as the rules say.`,
        '2. Find the cause. Client stacks point at the served, minified copies (/scripts/...js?sha=...:line:col); the minified code around each frame is below, so match the identifiers to the source in public/. Server stacks point at the source directly.',
        '3. Decide: a bug of ours -> the smallest correct fix, in the style of the file, plus the narrowest test you can run (node scripts/test-*.js, or a syntax check). Not a bug of ours (a test tab\'s injected code, an outside service, a browser quirk) -> change nothing, status "not-a-bug". Needs a design decision, a greg / ui-review item, or Yukimi -> status "needs-human". Fixing UI defects you notice on the way follows fix-ui-issues-you-find.mdc.',
        '4. Close out on the issue: the Done comment shape from yozora-cursor-agent.mdc (in worktree mode, "Commit" is the branch commit and "PR: none (branch ' + run.branch + ', not landed)"), status:review, stopwatch stopped.',
        '5. End your final message with exactly one line:',
        '   FAULT_FIX_RESULT {"status": "fixed" | "not-a-bug" | "needs-human" | "blocked" | "failed", "issue": ' + run.issue + ', "commit": "<sha or null>", "branch": "<branch or null>", "summary": "<one sentence>"}',
        '',
        `Fault report (data/fault-reports/${report.id}.json):`,
        JSON.stringify(trimReport(report), null, 2).slice(0, 24000),
        ...(ctx.length ? ['', 'Minified code at the client frames (<<HERE>> marks the column):', ...ctx] : [])
    ].join('\n');
}

function parseResult(logText) {
    let resultText = '';
    let isError = false;
    for (const line of String(logText || '').split('\n')) {
        if (!line.startsWith('{')) continue;
        let evt = null;
        try { evt = JSON.parse(line); } catch (_) { continue; }
        if (evt && evt.type === 'result') {
            resultText = String(evt.result || '');
            isError = !!evt.is_error;
        } else if (evt && evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
            const text = evt.message.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
            if (text) resultText = resultText && /FAULT_FIX_RESULT/.test(resultText) ? resultText : text;
        }
    }
    const m = resultText.match(RESULT_RE);
    if (m) {
        try {
            const r = JSON.parse(m[1]);
            const status = RESULT_STATES.has(r.status) ? r.status : 'failed';
            return {
                status,
                issue: Number(r.issue) || null,
                commit: r.commit ? String(r.commit).slice(0, 60) : null,
                branch: r.branch ? String(r.branch).slice(0, 120) : null,
                summary: String(r.summary || '').slice(0, 500)
            };
        } catch (_) { /* fall through */ }
    }
    return { status: 'failed', issue: null, commit: null, branch: null, summary: isError ? 'The run ended with an error before reporting a result' : 'The run ended without a FAULT_FIX_RESULT line' };
}

function pidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
    } catch (_) {
        return false;
    }
    try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        return /claude/.test(cmd);
    } catch (_) {
        return true;
    }
}

/** The server's local calendar day: "runs a day" resets at local midnight, as the settings pages say. */
function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function createFixer(options = {}) {
    const store = options.store;
    const getConfig = options.getConfig || (() => ({}));
    const dir = store.dir;
    const stateFile = path.join(dir, '.autofix-state.json');
    const settingsFile = options.settingsFile || path.join(dir, '.autofix-settings.json');
    let settingsCache = null;
    function savedSettings() {
        if (settingsCache) return settingsCache;
        try { settingsCache = cleanSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch (_) { settingsCache = {}; }
        return settingsCache;
    }
    const conf = () => cfg(getConfig, savedSettings());

    /** From the settings pages (admin): merged into the saved settings; returns the new status. */
    function saveSettings(input) {
        const next = Object.assign({}, savedSettings(), cleanSettings(input));
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${settingsFile}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(Object.assign({}, next, { updatedAt: new Date().toISOString() }), null, 2) + '\n');
        fs.renameSync(tmp, settingsFile);
        settingsCache = next;
        // a higher limit or turning it back on may let a waiting fault start now
        schedule();
        return status();
    }
    const logDir = path.join(dir, 'autofix-logs');
    const launcher = options.launch || launchClaude;
    const yozora = options.yozora || yozoraClient();
    const snapshot = options.snapshot || snapshotLiveTree;
    let state = { queue: [], active: null, daily: { date: today(), count: 0 } };
    let timer = null;
    let ticking = false;

    function loadState() {
        try {
            const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            if (s && typeof s === 'object') state = Object.assign(state, s);
        } catch (_) { /* first start */ }
        if (!Array.isArray(state.queue)) state.queue = [];
    }

    function saveState() {
        try {
            fs.mkdirSync(dir, { recursive: true });
            const tmp = `${stateFile}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
            fs.renameSync(tmp, stateFile);
        } catch (err) {
            console.warn('Fault auto-fix: state not saved:', err.message);
        }
    }

    function schedule() {
        if (timer) return;
        if (!state.active && !state.queue.length) return;
        timer = setTimeout(() => { timer = null; tick().catch((err) => console.warn('Fault auto-fix: tick failed:', err.message)); }, CHECK_MS);
        if (timer.unref) timer.unref();
    }

    async function enqueue(id, opts = {}) {
        const c = conf();
        if (!c.enabled && !opts.manual) return { queued: false, reason: 'auto-fix is off' };
        if (state.queue.some((q) => q.id === id) || (state.active && state.active.faultId === id)) return { queued: false, reason: 'already queued' };
        let reason = null;
        const report = await store.patch(id, (r) => {
            reason = ineligible(r, c, !!opts.manual);
            if (reason) return false;
            r.fix = Object.assign({}, r.fix || {}, { state: 'queued', queuedAt: new Date().toISOString(), mode: c.mode });
            return true;
        });
        if (!report) return { queued: false, reason: 'no such report' };
        if (reason) return { queued: false, reason };
        state.queue.push({ id, readyAt: Date.now() + (opts.manual ? 0 : c.settleMs), manual: !!opts.manual });
        saveState();
        schedule();
        return { queued: true };
    }

    function onChange(change) {
        if (!change || !(change.created || change.regressed)) return;
        enqueue(change.id).catch((err) => console.warn('Fault auto-fix: enqueue failed:', err.message));
    }

    async function finishActive(result) {
        const run = state.active;
        if (!run) return;
        state.active = null;
        saveState();
        const c = conf();
        await store.patch(run.faultId, (r) => {
            const fix = r.fix || {};
            const proposed = result.status === 'fixed' && run.mode !== 'live';
            fix.state = proposed ? 'proposed' : result.status;
            fix.finishedAt = new Date().toISOString();
            fix.issue = result.issue || fix.issue || null;
            fix.commit = result.commit || null;
            fix.branch = result.branch || run.branch || null;
            fix.summary = result.summary;
            fix.runs = (fix.runs || []).concat([{ id: run.id, mode: run.mode, startedAt: run.startedAt, finishedAt: fix.finishedAt, status: result.status, log: path.relative(REPO_ROOT, run.log) }]).slice(-10);
            r.fix = fix;
            if (result.status === 'fixed' && run.mode === 'live') r.status = 'fixed';
            if (result.status === 'not-a-bug') r.status = 'not-a-bug';
            return true;
        }).catch(() => {});
        if (run.runHome) fs.rm(run.runHome, { recursive: true, force: true }, () => {});
        if (run.issue) {
            const lines = [
                `Auto-fix run \`${run.id}\` (modules/faultAutoFix.js, ${run.mode} mode) for \`${run.faultId}\` ended: **${result.status}**.`,
                result.summary ? `- Summary: ${result.summary}` : null,
                `- Snapshot before the run: ${run.snapshot ? '`' + run.snapshot + '`' : 'nothing to commit'}`,
                `- Fix commit: ${result.commit ? '`' + result.commit + '`' : 'none'}${run.branch ? ` (branch \`${run.branch}\`, not landed)` : ''}`,
                `- Run log: \`${path.relative(REPO_ROOT, run.log)}\`; report: \`data/fault-reports/${run.faultId}.json\``
            ].filter(Boolean);
            await yozora.comment(run.issue, lines.join('\n')).catch((err) => console.warn('Fault auto-fix: result comment failed:', err.message));
        }
        console.log(`Fault auto-fix: ${run.faultId} run ${run.id} ended: ${result.status}${result.issue ? ' (#' + result.issue + ')' : ''} - ${result.summary}`);
        void c;
    }

    async function checkActive() {
        const run = state.active;
        if (!run) return;
        const c = conf();
        if (pidAlive(run.pid)) {
            if (Date.now() - Date.parse(run.startedAt) > c.runTimeoutMs) {
                try { process.kill(-run.pid, 'SIGTERM'); } catch (_) { try { process.kill(run.pid, 'SIGTERM'); } catch (__) { /* gone */ } }
                await finishActive({ status: 'failed', issue: null, commit: null, branch: run.branch, summary: `Stopped after ${Math.round(c.runTimeoutMs / 60000)} minutes` });
            }
            return;
        }
        let text = '';
        try { text = await fsp.readFile(run.log, 'utf8'); } catch (_) { text = ''; }
        await finishActive(parseResult(text));
    }

    async function startNext() {
        const c = conf();
        if (state.active || !state.queue.length) return;
        if (state.daily.date !== today()) state.daily = { date: today(), count: 0 };
        const now = Date.now();
        const idx = state.queue.findIndex((q) => q.readyAt <= now && (q.manual || (c.enabled && state.daily.count < c.maxRunsPerDay)));
        if (idx < 0) return;
        const item = state.queue.splice(idx, 1)[0];
        const report = await store.read(item.id);
        if (!report || !report.fix || report.fix.state !== 'queued') {
            saveState();
            return;
        }
        const run = { id: 'run_' + crypto.randomBytes(5).toString('hex'), faultId: item.id, mode: c.mode, startedAt: new Date().toISOString() };
        fs.mkdirSync(logDir, { recursive: true });
        run.log = path.join(logDir, `${run.id}.ndjson`);
        // 1. the Yozora issue, 2. the snapshot commit: no run starts without both
        try {
            run.issue = await yozora.ensureIssue(report);
            if (!run.issue) throw new Error('Yozora gave no issue number');
            await store.patch(item.id, (r) => { r.fix = Object.assign({}, r.fix || {}, { issue: run.issue }); return true; }).catch(() => {});
            run.snapshot = snapshot(item.id, run.issue);
        } catch (err) {
            const failures = (item.prepFailures || 0) + 1;
            if (failures >= PREP_MAX_FAILURES) {
                await store.patch(item.id, (r) => {
                    r.fix = Object.assign({}, r.fix || {}, { state: 'failed', finishedAt: new Date().toISOString(), summary: 'Could not prepare the run: ' + err.message });
                    return true;
                }).catch(() => {});
            } else {
                state.queue.push(Object.assign({}, item, { readyAt: Date.now() + PREP_RETRY_MS, prepFailures: failures }));
            }
            console.warn(`Fault auto-fix: run for ${item.id} not started (${failures}/${PREP_MAX_FAILURES}):`, err.message);
            saveState();
            return;
        }
        try {
            if (c.mode === 'live') {
                run.cwd = REPO_ROOT;
                run.branch = null;
            } else {
                Object.assign(run, prepareWorktree(item.id));
            }
            const prompt = buildPrompt(report, c, run);
            const started = launcher({ cwd: run.cwd, log: run.log, prompt, effort: c.effort, model: c.model });
            run.pid = started.pid;
            run.runHome = started.runHome || null;
        } catch (err) {
            await store.patch(item.id, (r) => {
                r.fix = Object.assign({}, r.fix || {}, { state: 'failed', finishedAt: new Date().toISOString(), summary: 'Could not start: ' + err.message });
                return true;
            }).catch(() => {});
            console.warn('Fault auto-fix: could not start a run for', item.id + ':', err.message);
            saveState();
            return;
        }
        if (!item.manual) state.daily.count += 1;
        state.active = run;
        saveState();
        await store.patch(item.id, (r) => {
            const fix = r.fix || {};
            fix.state = 'running';
            fix.attempts = (fix.attempts || 0) + 1;
            fix.startedAt = run.startedAt;
            fix.runId = run.id;
            fix.branch = run.branch || null;
            fix.issue = run.issue;
            fix.snapshot = run.snapshot || null;
            r.fix = fix;
            return true;
        }).catch(() => {});
        console.log(`Fault auto-fix: started ${run.id} for ${item.id} (${run.mode}, pid ${run.pid})`);
    }

    async function tick() {
        if (ticking) return;
        ticking = true;
        try {
            await checkActive();
            await startNext();
        } finally {
            ticking = false;
            schedule();
        }
    }

    async function cancel() {
        const run = state.active;
        if (!run) return false;
        try { process.kill(-run.pid, 'SIGTERM'); } catch (_) { try { process.kill(run.pid, 'SIGTERM'); } catch (__) { /* gone */ } }
        await finishActive({ status: 'failed', issue: null, commit: null, branch: run.branch, summary: 'Cancelled' });
        return true;
    }

    function start() {
        loadState();
        store.events.on('change', onChange);
        schedule();
    }

    function status() {
        const c = conf();
        if (state.daily.date !== today()) state.daily = { date: today(), count: 0 };
        return {
            config: Object.assign({}, c, { ignore: c.ignore.map((re) => re.source) }),
            settings: { enabled: c.enabled, mode: c.mode, maxRunsPerDay: c.maxRunsPerDay, max: MAX_RUNS_PER_DAY },
            active: state.active ? { id: state.active.id, faultId: state.active.faultId, mode: state.active.mode, startedAt: state.active.startedAt, pid: state.active.pid, issue: state.active.issue || null, snapshot: state.active.snapshot || null, branch: state.active.branch || null, log: path.relative(REPO_ROOT, state.active.log) } : null,
            queue: state.queue.map((q) => ({ id: q.id, readyAt: new Date(q.readyAt).toISOString(), manual: q.manual })),
            today: state.daily
        };
    }

    return { start, enqueue, tick, cancel, status, saveSettings, _state: () => state, onChange };
}

/**
 * Commit the live tree as it stands (whole files, other sessions' edits too: Yukimi wants the code
 * backed up before a fix run touches it). Returns the new commit, or null when nothing changed.
 * Throws when git cannot commit (another git command holds the index): the run then waits.
 */
function snapshotLiveTree(faultId, issue, root = REPO_ROOT) {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!git(['status', '--porcelain']).trim()) return null;
    git(['add', '-A']);
    if (!git(['diff', '--cached', '--name-only']).trim()) return null;
    git(['commit', '-q', '--no-verify', '-m', `chore(autofix): snapshot of the live tree before the fault ${faultId} run (#${issue})\n\nCommitted by modules/faultAutoFix.js before an automatic fix starts, so the fix is a\ncommit of its own on top of the code as it stood. Includes other sessions' uncommitted work.`]);
    return git(['rev-parse', '--short=12', 'HEAD']).trim();
}

function yozoraToken() {
    const home = require('os').homedir();
    for (const name of ['yozora-claude.token', 'yozora-grok.cursor.token']) {
        try {
            const t = fs.readFileSync(path.join(home, '.secrets', name), 'utf8').trim();
            if (t) return t;
        } catch (_) { /* next */ }
    }
    throw new Error('no Yozora token in ~/.secrets');
}

/** The few Yozora calls the fixer makes itself; the token is read on every call and never logged. */
function yozoraClient(base = YOZORA_API) {
    async function call(method, url, body) {
        const res = await fetch(base + url, {
            method,
            headers: Object.assign({ Authorization: 'token ' + yozoraToken(), Accept: 'application/json' }, body ? { 'Content-Type': 'application/json' } : {}),
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(20000)
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Yozora ${method} ${url.split('?')[0]}: HTTP ${res.status}`);
        try { return text ? JSON.parse(text) : null; } catch (_) { return null; }
    }
    async function labelIds(names) {
        const labels = await call('GET', `/repos/${YOZORA_REPO}/labels?limit=100`);
        return (labels || []).filter((l) => names.includes(l.name)).map((l) => l.id);
    }
    async function ensureIssue(report) {
        const open = await call('GET', `/repos/${YOZORA_REPO}/issues?state=open&type=issues&q=${encodeURIComponent(report.id)}&limit=20`);
        const found = (open || []).find((i) => String(i.body || '').includes(report.id) || String(i.title || '').includes(report.id));
        if (found) return found.number;
        const program = (report.program && report.program.name) || 'program';
        const msg = String(report.message || report.errorName || 'error').replace(/\s+/g, ' ').slice(0, 90);
        const latest = report.latest || {};
        const body = [
            `Automatic fault report, opened by modules/faultAutoFix.js before its fix run (Yozora #833). Claude Code automation (\`claude\`).`,
            '',
            `- Fault: \`${report.id}\` (data/fault-reports/${report.id}.json, GET /api/fault-reports/${report.id})`,
            `- Surface / kind: ${report.surface || 'desktop'} / ${report.kind || 'dialog'}`,
            `- Program: ${program}${report.program && report.program.key ? ` (\`${report.program.key}\`)` : ''}`,
            `- Seen: ${report.count || 1}x (${report.repeats || 1} faults), first ${report.firstSeen}, last ${report.lastSeen}${report.status === 'regressed' ? ' - **regressed** after a fix' : ''}`,
            latest.request ? `- Request: ${latest.request.method} ${latest.request.path}` : null,
            '',
            '```',
            `${report.errorName || 'Error'}: ${String(report.message || '').slice(0, 500)}`,
            String(latest.stack || '').split('\n').slice(0, 12).join('\n'),
            '```',
            '',
            'The run comments here when it starts and when it ends (Done comment, then the fixer\'s result line).'
        ].filter((l) => l !== null).join('\n');
        const labels = await labelIds(['type:bug', 'status:in-progress']).catch(() => []);
        const issue = await call('POST', `/repos/${YOZORA_REPO}/issues`, { title: `[Fault] ${program}: ${msg}`, body, labels });
        if (issue && issue.id) await call('POST', `/${YOZORA_PROJECT}/columns/${YOZORA_IN_PROGRESS_COLUMN}/issues/${issue.id}`).catch(() => {});
        return issue && issue.number;
    }
    async function comment(number, text) {
        return call('POST', `/repos/${YOZORA_REPO}/issues/${number}/comments`, { body: text });
    }
    return { ensureIssue, comment };
}

/** A worktree on autofix/<id> from the live HEAD, with the live node_modules linked in. */
function prepareWorktree(faultId) {
    const base = path.join(REPO_ROOT, '.claude', 'worktrees');
    fs.mkdirSync(base, { recursive: true });
    let n = 1;
    let branch = `autofix/${faultId}`;
    let cwd = path.join(base, `autofix-${faultId}`);
    const exists = (b) => { try { execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], { cwd: REPO_ROOT, stdio: 'ignore' }); return true; } catch (_) { return false; } };
    while (exists(branch) || fs.existsSync(cwd)) {
        n += 1;
        branch = `autofix/${faultId}-${n}`;
        cwd = path.join(base, `autofix-${faultId}-${n}`);
    }
    execFileSync('git', ['worktree', 'add', '-q', '-b', branch, cwd, 'HEAD'], { cwd: REPO_ROOT, stdio: 'ignore', timeout: 120000 });
    try { fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(cwd, 'node_modules')); } catch (_) { /* tests without deps still run */ }
    // .gitignore's node_modules/ matches a directory, not this link: keep it out of the run's commits
    try {
        const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
        const exclude = path.join(common, 'info', 'exclude');
        const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
        if (!/^\/?node_modules$/m.test(text)) fs.appendFileSync(exclude, (text && !text.endsWith('\n') ? '\n' : '') + 'node_modules\n');
    } catch (_) { /* the prompt also says not to commit it */ }
    return { cwd, branch };
}

/** claude -p, detached (setsid) so a restart of this server does not end it; output to the log. */
function launchClaude({ cwd, log, prompt, effort, model }) {
    const xiLaunch = require('./xiLaunch');
    const args = [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'bypassPermissions',
        ...(model ? ['--model', model] : []),
        ...(effort ? ['--effort', effort] : []),
        '--',
        prompt
    ];
    const plan = xiLaunch.buildLaunch({ runtime: 'claude', sandbox: false, projectDir: cwd, agentArgs: args });
    fs.writeFileSync(log, '');
    const out = execFileSync('/bin/sh', [
        '-c',
        'log="$1"; shift; setsid "$@" >>"$log" 2>&1 </dev/null & echo $!',
        'fault-autofix-spawn',
        log,
        plan.bin,
        ...plan.args
    ], { cwd, env: plan.hostEnv, encoding: 'utf8', timeout: 10000 });
    const pid = parseInt(String(out).trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) throw new Error('the Claude run did not start');
    return { pid, runHome: plan.runHome };
}

let fixer = null;

function mount(app, authMiddleware, options = {}) {
    const store = options.store || require('./programFaultReports').defaultStore();
    fixer = createFixer({ store, getConfig: options.getConfig });
    fixer.start();
    const auth = authMiddleware || ((req, res, next) => next());
    const admin = (req, res, next) => (req.userType === 'admin' ? next() : res.status(403).json({ ok: false, error: 'Admin only' }));
    // editable: the settings pages disable their controls for anyone but an administrator
    app.get('/api/fault-autofix', auth, (req, res) => res.json(Object.assign({ ok: true, editable: req.userType === 'admin' }, fixer.status())));
    app.put('/api/fault-autofix/settings', auth, admin, (req, res) => {
        try {
            res.json(Object.assign({ ok: true, editable: true }, fixer.saveSettings(req.body || {})));
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });
    app.post('/api/fault-reports/:id/fix', auth, admin, async (req, res) => {
        try {
            const r = await fixer.enqueue(String(req.params.id), { manual: true });
            res.status(r.queued ? 200 : 409).json(Object.assign({ ok: r.queued }, r));
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });
    app.post('/api/fault-autofix/cancel', auth, admin, async (req, res) => {
        try {
            res.json({ ok: true, cancelled: await fixer.cancel() });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });
    return fixer;
}

module.exports = { mount, createFixer, ineligible, buildPrompt, parseResult, minifiedContext, cfg, cleanSettings, launchClaude, prepareWorktree, snapshotLiveTree, yozoraClient, DEFAULTS, NOISE };
