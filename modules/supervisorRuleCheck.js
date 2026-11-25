'use strict';

/**
 * The Supervisor's rule check at turn end (Yukimi, Nov 24 2026: "can rule violations be part of the Supervisor's
 * step-ins, handled at the end of a turn - like when an agent built its own toggle list instead of the platform's
 * tree"). It runs with the turn-end review (modules/agentSupervisor.js review()), never mid-turn:
 *
 *   1. files the turn changed       agent-coord's edits since the turn started, plus the files of violations still open
 *   2. the check scripts            scripts/check-perf-rules.js, check-ui-standard.js, check-app-scope.js on just those
 *                                   files; a count that rose over its baseline is a violation (rule, file, line, text)
 *   3. the judgement                the rules that apply to those paths (+ the turn's diff) go to the Supervisor's engine,
 *                                   which names clear violations with a quote; a quote that is not in the diff is dropped
 *
 * Violations: { rule, file, line, quote, why, fix, source: 'script' | 'judge', script? }.
 * Everything here takes its inputs and effects (git, scripts, engine) from `deps`, so the tests stub them.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT_TIMEOUT_MS = 25000;
const GIT_TIMEOUT_MS = 8000;
const DIFF_PER_FILE = 6000;
const DIFF_PER_CALL = 22000;
const RULE_PER_RULE = 2600;
const RULE_PER_CALL = 24000;
const MAX_FILES = 40;
const MAX_VIOLATIONS = 10;
const CODE_RE = /\.(js|mjs|cjs|ts|css|html|kt|java|sh|xml|mdc)$/;
const SKIP_RE = /(^|\/)(node_modules|\.git|\.cache|dist|build)\//;

const SCRIPTS = [
    // `scope`: the files each script's own default scan covers (a file outside it would be counted against no baseline)
    { name: 'check-perf-rules', file: 'scripts/check-perf-rules.js', parse: 'perf', scope: (f) => /\.(js|css)$/.test(f) && !/\.min\./.test(f) && /^(public|apps|modules)\/|^web_server\.js$/.test(f) },
    { name: 'check-ui-standard', file: 'scripts/check-ui-standard.js', parse: 'ui', scope: (f) => /^(public\/css|public\/scripts\/comp|public\/templates|apps)\//.test(f) && !/(^|\/)(node_modules|vendor|server)\//.test(f) || f === 'public/app.html' },
    { name: 'check-app-scope', file: 'scripts/check-app-scope.js', parse: 'scope', scope: (f) => /\.js$/.test(f) && !/\.min\.js$/.test(f) && /^(public\/scripts|apps)\//.test(f) && !/(^|\/)(node_modules|vendor|server)\//.test(f) }
];

// which rules apply to which paths (the rest of the 40 rules are about process, not the code in a diff)
const ALWAYS = ['no-base64-images', 'keyboard-characters'];
const PATH_RULES = [
    [/^(apps\/[^/]+\/client\/|public\/)/, ['ui-standard', 'no-native-browser-ui', 'vista-icons-not-fa', 'scroll-lists-keep-position', 'sliders-platform', 'phone-power-client', 'app-scope-ownership', 'tray-balloons', 'design-decisions', 'cafeready-background', 'installed-boot-zero-wait']],
    [/^(modules|routes|server|apps\/[^/]+\/(?!client\/))/, ['server-push-not-polling', 'phone-power-server', 'cafeready-background']],
    [/\.(kt|java)$|(^|\/)android\//, ['phone-power-native', 'cafeready-background', 'android-app-builds']],
    [/^\.cursor\/rules\/|^CLAUDE\.md$/, ['keyboard-characters']],
    [/melaton|statusbar|status-bar/i, ['melaton-bars-native-layouts', 'status-icon-tables']]
];

function globToRe(g) {
    const s = String(g).trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?');
    return new RegExp(`^${s}$`);
}

/** The globs of a rule file's frontmatter (one line or a list). */
function globsOf(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
    if (!m) return [];
    const lines = m[1].split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i += 1) {
        const k = /^globs:\s*(.*)$/.exec(lines[i]);
        if (!k) continue;
        if (k[1].trim()) { k[1].split(',').forEach((x) => { if (x.trim()) out.push(x.trim().replace(/^["']|["']$/g, '')); }); continue; }
        for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j += 1) out.push(lines[j].replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''));
    }
    return out.filter(Boolean);
}

/** Rules (from listRules with text) that apply to these files: [{ name, text }]. */
function applicableRules(rules, files) {
    const want = new Set(ALWAYS);
    files.forEach((f) => PATH_RULES.forEach(([re, names]) => { if (re.test(f)) names.forEach((n) => want.add(n)); }));
    rules.forEach((r) => {
        if (want.has(r.name)) return;
        const globs = globsOf(r.text);
        if (globs.some((g) => { const re = globToRe(g); return files.some((f) => re.test(f)); })) want.add(r.name);
    });
    return rules.filter((r) => want.has(r.name)).map((r) => ({ name: r.name, text: String(r.body || r.text || '') }));
}

/** Repo-relative paths of the edited files worth checking: inside the repo, existing, code-like, once each. */
function checkable(repo, paths) {
    const seen = new Set();
    const out = [];
    (paths || []).forEach((p) => {
        let rel = String(p || '');
        if (path.isAbsolute(rel)) rel = path.relative(repo, rel);
        if (!rel || rel.startsWith('..') || SKIP_RE.test(rel) || !CODE_RE.test(rel) && rel !== 'CLAUDE.md' || seen.has(rel)) return;
        try { const st = fs.statSync(path.join(repo, rel)); if (!st.isFile() || st.size > 1.5 * 1024 * 1024) return; } catch (_) { return; }
        seen.add(rel);
        out.push(rel);
    });
    return out.slice(0, MAX_FILES);
}

function git(repo, args) {
    return execFileSync('git', ['-C', repo].concat(args), { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

/** What the turn did to each file: the diff from the last commit before the turn started to the working tree (so a turn that already committed still shows). */
function gitDiffs(repo, files, since) {
    const map = new Map();
    if (!files.length) return map;
    let base = 'HEAD';
    try { const b = git(repo, ['rev-list', '-1', `--before=${new Date(since || Date.now()).toISOString()}`, 'HEAD']).trim(); if (b) base = b; } catch (_) { /* HEAD */ }
    try {
        git(repo, ['diff', '-U2', '--no-color', base, '--'].concat(files)).split(/^(?=diff --git )/m).forEach((chunk) => {
            const m = /^diff --git a\/(.+?) b\//.exec(chunk);
            if (m && chunk.trim()) map.set(m[1], chunk);
        });
    } catch (_) { /* no diff */ }
    let untracked = [];
    try { untracked = git(repo, ['ls-files', '--others', '--exclude-standard', '--'].concat(files)).split('\n').filter(Boolean); } catch (_) { untracked = []; }
    untracked.forEach((f) => {
        try { map.set(f, `new file ${f}\n${fs.readFileSync(path.join(repo, f), 'utf8').split('\n').map((l) => `+${l}`).join('\n')}`); } catch (_) { /* gone */ }
    });
    return map;
}

function runScript(repo, script, files) {
    try {
        const stdout = execFileSync(process.execPath, [path.join(repo, script.file)].concat(files), { cwd: repo, encoding: 'utf8', timeout: SCRIPT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, stdout, stderr: '' };
    } catch (e) {
        return { code: typeof e.status === 'number' ? e.status : -1, stdout: String(e.stdout || ''), stderr: String(e.stderr || ''), error: e.killed ? 'timeout' : '' };
    }
}

/** The counts a script says rose: [{ file, id, was, now, why }]. */
function parseRises(kind, text) {
    const out = [];
    const lines = String(text || '').split(/\r?\n/);
    if (kind === 'perf' || kind === 'scope') {
        lines.forEach((l) => { const m = /^\s+(\S+): ([\w-]+) (\d+) -> (\d+)\s*$/.exec(l); if (m) out.push({ file: m[1], id: m[2], was: Number(m[3]), now: Number(m[4]), why: '' }); });
        if (kind === 'perf') lines.forEach((l, i) => { const m = /^\s+(\S+): ([\w-]+) \d+ -> \d+\s*$/.exec(l); if (m && lines[i + 1]) { const r = out.find((x) => x.file === m[1] && x.id === m[2]); if (r) r.why = lines[i + 1].trim().slice(0, 200); } });
    } else {
        let file = '';
        lines.forEach((l) => {
            const f = /^ {2}(\S+)\s*$/.exec(l);
            if (f && !/^\d+$/.test(f[1])) { file = f[1]; return; }
            const m = /^ {4}([\w-]+): (\d+) -> (\d+)\s+\((.*)\)\s*$/.exec(l);
            if (m && file) out.push({ file, id: m[1], was: Number(m[2]), now: Number(m[3]), why: m[4].slice(0, 200) });
        });
    }
    return out;
}

/** The lines of the newest hits (the script's own --list), or [] when it cannot say. */
function hitLines(repo, script, rise, run) {
    const r = run(repo, script, ['--list', rise.id, rise.file]);
    const lines = String(r.stdout || '').split(/\r?\n/).filter(Boolean).map((l) => /^(.+?):(\d+):?\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ line: Number(m[2]), text: m[3].slice(0, 160) }));
    return lines.slice(-Math.max(1, rise.now - rise.was));
}

/** The deterministic part: runs each check script on the files; every rise becomes a violation. */
function scriptViolations(repo, files, deps) {
    const out = [];
    const ran = [];
    const run = deps.runScript || runScript;
    SCRIPTS.forEach((sc) => {
        const mine = files.filter(sc.scope);
        if (!mine.length) return;
        const r = run(repo, sc, mine);
        if (r.error === 'timeout') { ran.push(`${sc.name}: timeout`); return; }
        ran.push(sc.name);
        if (r.code !== 1) return;
        parseRises(sc.parse, `${r.stderr}\n${r.stdout}`).forEach((rise) => {
            if (!mine.includes(rise.file)) return;
            const hits = hitLines(repo, sc, rise, run);
            const first = hits[0] || null;
            out.push({
                rule: rise.id, script: sc.name, file: rise.file, line: first ? first.line : 0,
                quote: hits.map((h) => `${h.line}: ${h.text}`).join(' | ').slice(0, 300),
                why: `${sc.name}: ${rise.id} went from ${rise.was} to ${rise.now}${rise.why ? ` (${rise.why})` : ''}`,
                fix: `Remove the new ${rise.id} hit${rise.now - rise.was > 1 ? 's' : ''} (node scripts/${path.basename(sc.file)} --list ${rise.id} ${rise.file}), or mark a line that must stay as the script says`,
                source: 'script'
            });
        });
    });
    return { violations: out, ran };
}

const JUDGE_SYSTEM = [
    'You check one coding agent turn against the project rules given. You get the rules (name and text) and the diff of the files the turn changed (+ lines are added, - removed).',
    'Report a violation ONLY when an added line (+) clearly breaks a rule as it is stated in the text given: a hand-made control where the rule names a platform one, a polling timer where the rule demands push, a base64 picture, and the like. No style opinions, no things a rule does not say, nothing about removed lines or unchanged context, nothing you are unsure of.',
    'Each violation names the rule exactly as given, the file exactly as given, a QUOTE copied letter for letter from an added line of that file, why it breaks the rule (one sentence), and the fix (one sentence).',
    'Answer ONLY {"violations":[{"rule":"name","file":"path","quote":"added line text","why":"...","fix":"..."}]}; {"violations":[]} when there is none.'
].join('\n');

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Keeps only violations that name a given rule and file, whose quote is really in that file's diff. */
function cleanJudged(list, ruleNames, diffs) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((v) => {
        if (!v || typeof v !== 'object') return;
        const rule = String(v.rule || '').replace(/\.mdc$/, '');
        const file = String(v.file || '');
        const quote = norm(v.quote);
        if (!ruleNames.has(rule) || !diffs.has(file) || quote.length < 4) return;
        const d = norm(diffs.get(file));
        if (!d.includes(quote)) return;
        const raw = String(diffs.get(file)).split('\n');
        const at = raw.findIndex((l) => norm(l).includes(quote));
        let line = 0;
        if (at >= 0) {
            // the new-file line number from the hunk header above it
            for (let i = at; i >= 0; i -= 1) {
                const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw[i]);
                if (h) { line = Number(h[1]) + raw.slice(i + 1, at).filter((l) => !l.startsWith('-')).length; break; }
            }
        }
        out.push({ rule, file, line, quote: String(v.quote).slice(0, 300), why: String(v.why || '').slice(0, 300), fix: String(v.fix || '').slice(0, 300), source: 'judge' });
    });
    return out.slice(0, MAX_VIOLATIONS);
}

/** The judgement part: the applicable rules and the diffs, in as many engine calls as the budget allows. */
async function judge(files, rules, diffs, ask, calls) {
    const out = [];
    let used = 0;
    const hasDiff = files.filter((f) => diffs.has(f));
    const picked = applicableRules(rules, hasDiff);
    if (!hasDiff.length || !picked.length) return { violations: out, calls: used, rules: picked.map((r) => r.name) };
    let rtext = '';
    picked.forEach((r) => { const t = `### ${r.name}\n${r.text.slice(0, RULE_PER_RULE)}\n\n`; if (rtext.length + t.length <= RULE_PER_CALL) rtext += t; });
    const names = new Set(picked.map((r) => r.name));
    // batches of diffs, each under the cap
    const batches = [];
    let cur = []; let size = 0;
    hasDiff.forEach((f) => {
        const t = String(diffs.get(f)).slice(0, DIFF_PER_FILE);
        if (cur.length && size + t.length > DIFF_PER_CALL) { batches.push(cur); cur = []; size = 0; }
        cur.push([f, t]); size += t.length;
    });
    if (cur.length) batches.push(cur);
    for (const b of batches.slice(0, Math.max(1, calls))) {
        used += 1;
        const bmap = new Map(b);
        const user = `Rules:\n${rtext}\nChanged files (diff):\n${b.map(([f, t]) => `=== ${f}\n${t}`).join('\n\n')}`;
        const o = await ask(JUDGE_SYSTEM, user);
        out.push(...cleanJudged(o && o.violations, names, bmap));
    }
    return { violations: out.slice(0, MAX_VIOLATIONS), calls: used, rules: [...names] };
}

/**
 * The whole check for one turn. in: { repo, sessionId, since, rules (listRules withText), openFiles (files of violations
 * still open for this session), calls, ask(system, user), deps }. Never throws.
 * Answer: { checked, files, violations, scripts, rules, calls, error, skipped }.
 */
async function runRuleCheck(o) {
    const deps = o.deps || {};
    const res = { checked: false, files: [], violations: [], scripts: [], rules: [], calls: 0, error: '' };
    try {
        // the files the turn edited, and those of violations still open (so a later review can see them fixed)
        const edited = deps.changedFiles ? deps.changedFiles(o.sessionId, o.since) : [];
        const files = checkable(o.repo, (edited || []).concat(o.openFiles || []));
        res.files = files;
        if (!files.length) { res.skipped = 'no files changed'; return res; }
        res.checked = true;
        const sv = scriptViolations(o.repo, files, deps);
        res.scripts = sv.ran;
        res.violations = sv.violations.slice();
        const diffs = deps.diffs ? deps.diffs(files, o.since) : gitDiffs(o.repo, files, o.since);
        try {
            const j = await judge(files, o.rules || [], diffs, o.ask, o.calls || 1);
            res.rules = j.rules; res.calls = j.calls;
            // a judged violation the scripts already named (same file and rule) is not said twice
            j.violations.forEach((v) => { if (!res.violations.some((x) => x.file === v.file && x.rule === v.rule)) res.violations.push(v); });
        } catch (e) { res.error = String(e.message || e).slice(0, 200); }
        res.violations = res.violations.slice(0, MAX_VIOLATIONS);
    } catch (e) { res.error = String(e.message || e).slice(0, 200); }
    return res;
}

module.exports = { runRuleCheck, applicableRules, parseRises, checkable, gitDiffs, globsOf, cleanJudged, scriptViolations, judge, SCRIPTS };
