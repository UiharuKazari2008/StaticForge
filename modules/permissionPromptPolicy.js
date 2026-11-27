'use strict';

/**
 * Policy for Claude Code tool-permission prompts a supervised session is stuck on (#1351: session 419eb279 sat 30 min on
 * "Do you want to proceed? 1. Yes 2. No"). Fleet's Supervisor reads the pane, calls decide() and presses the approve
 * option (Yes) or the decline option (No, plus a steer note that carries `reason`). Pure and stateless: no I/O besides an
 * existence check of the repo root (.git) and of a checkout target; every table below is a constant.
 *
 *   decide(prompt, opts) -> { decision: 'approve' | 'deny' | 'hers', kind: 'bash'|'edit'|'tool'|'fetch'|'other',
 *                             reason, command, approveN, declineN }
 *     prompt = { question, options: [{ n, text, on }], context: [lines above the question, right-trimmed] }
 *     opts   = { cwd, scratch?, home?, repoRoot?, liveTree? }
 *     reason  one short sentence for a note to the session and for an issue comment (no "declined:" prefix)
 *     command the extracted command / path / url / tool text, secrets masked with ***, max 300 chars
 *     approveN / declineN  the option numbers to press (1 and 2 unless the prompt lists other numbers)
 *   splitCommand(str) -> string[]   quote-aware split on && || ; | & and newlines
 *
 * Order: kind detection, 'hers' (login / account / money steps only Yukimi can do), deny, approve, anything else is denied
 * as not recognised. Any one denied part of a compound command denies the whole command.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const YOZORA_HOST = 'yozora.bluesteel.737.jp.net';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];
const A53_SERIAL = 'R5CT71TSEMZ';
const FOREIGN_EMULATOR_PORTS = ['5570', '5580'];
const SCRATCHPAD_RE = /^\/tmp\/claude-\d+(\/|$)/;
const SCRATCHPAD_CHILD_RE = /^\/tmp\/claude-\d+\/.+/;
const MAX_COMMAND = 300;

// ----------------------------------------------------------------------------------------------------------- patterns

// Paths and names that mean "a secret": [regex, label]. Applied to command text, edit paths and urls.
const SECRET_PATH_RES = [
    [/\.secrets\b/, '~/.secrets'],
    [/\.cache\/secrets/, '.cache/secrets'],
    [/(\/[\w.-]*\.token\b)|([\w]+[-_][\w.-]*\.token\b)/, 'a .token file'],
    [/(^|[\s/'"=:(])\.env(?!\.(example|sample|template|dist)\b)(\.[\w.-]+)?(?=$|[\s'"/;|&)`])/, '.env'],
    [/\bid_(rsa|ed25519|ecdsa|dsa)\b/, 'an ssh key'],
    [/\.ssh(\/|\b)/, '.ssh'],
    [/ruiko-windows-pin/, 'a PIN file'],
    [/[\w-]+-pin(\.\w+)?(?=$|[\s'"/;|&)`])/, 'a PIN file'],
    [/(^|[/\s'"=~_-])pins?\.(txt|json|key|pin|dat)\b/i, 'a PIN file'],
    [/passw(or)?ds?[\w.-]*\.(txt|json|key|conf|cfg|dat|secret|ya?ml)\b/i, 'a password file'],
    [/\.(netrc|npmrc|pgpass|git-credentials|pypirc)\b/, 'a credentials file'],
    [/(^|[/.])credentials(\.(json|ya?ml|xml|txt|csv))?(?=$|[\s'"/;|&)`])/i, 'a credentials file'],
    [/\.(aws|gnupg)\//, 'a credentials directory'],
    [/\/etc\/(shadow|sudoers)/, 'a system secrets file'],
    [/\/proc\/[^\s]*\/environ/, 'a process environment'],
    [/\$\{?[A-Za-z0-9_]*(TOKEN|SECRET|PASSW(OR)?D|API_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH_?KEY)[A-Za-z0-9_]*\}?/, 'a secret environment variable'],
    [/\$\{?(?:[A-Z0-9_]*_)?PIN(?:_[A-Z0-9_]*)?\}?(?![A-Za-z0-9_])/, 'a PIN environment variable'],
];

// Narrower set for heredoc bodies (commit messages, issue text, code): path-like references only.
const BODY_SECRET_RES = [
    [/\.secrets\b/, '~/.secrets'],
    [/\.cache\/secrets/, '.cache/secrets'],
    [/(\/[\w.-]*\.token\b)|([\w]+[-_][\w.-]*\.token\b)/, 'a .token file'],
    [/\bid_(rsa|ed25519|ecdsa|dsa)\b/, 'an ssh key'],
    [/\.ssh\//, '.ssh'],
    [/ruiko-windows-pin/, 'a PIN file'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
];

const TOKEN_VALUE_RES = [
    /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{16,}/,
    /\bglpat-[\w-]{12,}/,
    /\bsk-[A-Za-z0-9_-]{16,}/,
    /\bxox[abposr]-[\w-]{8,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const HERS_TEXT_RE = /(^|[\s"'=])--(allow-)?paid\b|userApprovedPaidRequest|\ballow_paid\b/;
const BILLING_URL_RE = /\/(billing|purchases?|checkout|payments?|subscribe|subscriptions?|signup|sign-up|register|admin\/users|user\/signup)(\/|\?|#|$)/i;
const SECRET_VARNAME_RE = /(TOKEN|SECRET|PASSW(OR)?D|API_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH_?KEY|(^|_)PIN($|_))/i;

const BAD_GIT_C_RE = /^(core\.(hookspath|sshcommand|fsmonitor|pager|editor|askpass|gitproxy)|credential\.|alias\.|include|filter\.|diff\..*|merge\..*driver|protocol\.|url\.|http\.|gpg\.|sequence\.editor)/i;

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

const SIMPLE_READ_CMDS = new Set([
    'ls', 'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'wc', 'jq', 'stat', 'file', 'diff', 'cmp', 'du', 'df', 'pwd',
    'echo', 'printf', 'test', '[', '[[', 'true', 'false', ':', 'which', 'type', 'ps', 'basename', 'dirname', 'realpath',
    'readlink', 'tr', 'cut', 'paste', 'column', 'nl', 'tac', 'rev', 'fold', 'fmt', 'comm', 'join', 'md5sum', 'sha1sum',
    'sha256sum', 'sha512sum', 'cksum', 'b2sum', 'base64', 'od', 'xxd', 'hexdump', 'strings', 'tree', 'seq', 'sleep',
    'expr', 'bc', 'nproc', 'hostname', 'uname', 'whoami', 'id', 'uptime', 'free', 'pgrep', 'lsof', 'ss', 'netstat',
    'wait', 'exit', 'return', 'shopt', 'umask', 'unset', 'local', 'readonly', 'getconf', 'locale', 'tput', 'clear',
    'break', 'continue', 'shift', 'hash', 'read',
]);

const KNOWN_CMDS = new Set([
    ...SIMPLE_READ_CMDS, 'git', 'node', 'nodejs', 'npm', 'npx', 'python', 'python3', 'bash', 'sh', 'zsh', 'dash', 'ksh',
    'sed', 'awk', 'gawk', 'find', 'sort', 'uniq', 'tee', 'mkdir', 'touch', 'cp', 'mv', 'rm', 'rmdir', 'curl', 'wget',
    'sqlite3', 'cd', 'adb', 'tmux', 'xargs', 'env', 'printenv', 'export', 'set', 'declare', 'source', 'eval', 'exec',
    'command', 'nohup', 'time', 'timeout', 'nice', 'kill', 'pkill', 'killall', 'pm2', 'chmod', 'chown', 'dd', 'date',
    'ssh', 'scp', 'rsync', 'sudo', 'rg', 'trap', 'mktemp', 'gh', 'docker', 'for', 'while', 'if', 'then', 'else', 'fi',
    'do', 'done', 'case', 'esac', 'in',
]);

const KEYWORD_PREFIX = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}']);

// ----------------------------------------------------------------------------------------------------------- verdicts

function ok(why) { return { d: 'approve', why: why || '' }; }
function no(why) { return { d: 'deny', why }; }
function hers(why) { return { d: 'hers', why }; }

function combine(list) {
    let firstNo = null;
    for (const v of list) {
        if (v && v.d === 'hers') return v;
        if (v && v.d === 'deny' && !firstNo) firstNo = v;
    }
    if (firstNo) return firstNo;
    return list.find((v) => v) || ok('');
}

function short(s, n) {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ');
    const m = n || 60;
    return t.length > m ? t.slice(0, m - 3) + '...' : t;
}

function maskSecrets(s) {
    let t = String(s == null ? '' : s);
    t = t.replace(/\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{16,}/g, '***')
        .replace(/\bglpat-[\w-]{12,}/g, '***')
        .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '***')
        .replace(/\bxox[abposr]-[\w-]{8,}/g, '***')
        .replace(/\bAKIA[0-9A-Z]{16}\b/g, '***')
        .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '***')
        .replace(/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 ***')
        .replace(/\b([A-Za-z0-9_.-]*(?:token|password|passwd|secret|api[_-]?key)[A-Za-z0-9_.-]*)(\s*[=:]\s*)(?!\*\*\*)("[^"]*"|'[^']*'|[^\s"';&|)]+)/gi, '$1$2***')
        .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g, (m) => (/^[0-9a-f]{7,64}$/i.test(m) ? m : '***'));
    // ASCII only in notes and comments
    t = t.replace(/[^\x09\x0a\x20-\x7e]/g, '?');
    return t.length > MAX_COMMAND ? t.slice(0, MAX_COMMAND - 3) + '...' : t;
}

// ----------------------------------------------------------------------------------------------------------- context

function findRepoRoot(cwd) {
    let d = cwd;
    for (let i = 0; i < 40; i++) {
        try { if (fs.existsSync(path.join(d, '.git'))) return d; } catch (_) { /* ignore */ }
        const parent = path.dirname(d);
        if (parent === d) break;
        d = parent;
    }
    return cwd;
}

function makeCtx(opts) {
    const o = opts || {};
    const home = path.resolve(o.home || os.homedir());
    const cwd = path.resolve(o.cwd || process.cwd());
    return {
        home,
        cwd,
        scratch: o.scratch ? path.resolve(o.scratch) : null,
        repoRoot: o.repoRoot ? path.resolve(o.repoRoot) : findRepoRoot(cwd),
        live: path.resolve(o.liveTree || path.join(home, 'staticforge')),
    };
}

function newState(cx) {
    return { cx, curDir: cx.cwd, bg: [], pidVars: [], names: [], depth: 0 };
}

function childState(st) {
    return { cx: st.cx, curDir: st.curDir, bg: st.bg.slice(), pidVars: st.pidVars.slice(), names: st.names, depth: st.depth + 1 };
}

function within(p, root) {
    if (!p || !root) return false;
    if (root === '/') return true;
    return p === root || p.startsWith(root + '/');
}

function hasGitSegment(p) { return p.split('/').includes('.git'); }

function expandPathStr(t, st, base) {
    let s = String(t);
    const home = st.cx.home;
    if (s === '~') s = home;
    else if (s.startsWith('~/')) s = home + s.slice(1);
    else if (s.startsWith('~')) return null;
    s = s.replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, home);
    const here = base === undefined ? st.curDir : base;
    s = s.replace(/\$\{PWD\}|\$PWD(?![A-Za-z0-9_])/g, here || st.cx.cwd);
    if (/[$`]/.test(s)) return null;
    if (!path.isAbsolute(s)) {
        if (!here) return null;
        s = path.join(here, s);
    }
    return path.resolve(s);
}

function allowedWrite(p, st) {
    if (!p) return false;
    if (p === '/dev/null') return true;
    if (hasGitSegment(p)) return false;
    const cx = st.cx;
    return within(p, cx.cwd) || within(p, cx.repoRoot) || SCRATCHPAD_RE.test(p) || within(p, cx.scratch);
}

function rmAllowed(p, st) {
    if (!p || hasGitSegment(p)) return false;
    const cx = st.cx;
    const base = path.basename(p);
    const parent = path.dirname(p);
    if (/^[*?.[\]]*[*?][*?.[\]]*$/.test(base) && (parent === cx.cwd || parent === cx.repoRoot)) return false;
    if (SCRATCHPAD_CHILD_RE.test(p)) return true;
    if (cx.scratch && within(p, cx.scratch)) return true;
    return within(p, cx.cwd) && p !== cx.cwd;
}

function repoDirOk(d, st) {
    if (!d) return false;
    const cx = st.cx;
    return within(d, cx.cwd) || within(d, cx.repoRoot) || SCRATCHPAD_RE.test(d) || within(d, cx.scratch);
}

function whereMsg() {
    return 'write only inside the repo or the scratchpad (/tmp/claude-<uid>/...)';
}

// ----------------------------------------------------------------------------------------------------------- lexing

// i is just after an opening '('; returns the index of the matching ')' or -1.
function findClose(s, i) {
    let depth = 1;
    while (i < s.length) {
        const c = s[i];
        if (c === '\\') { i += 2; continue; }
        if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) return -1; i = j + 1; continue; }
        if (c === '"') { const j = skipDq(s, i + 1); if (j < 0) return -1; i = j; continue; }
        if (c === '`') { const j = s.indexOf('`', i + 1); if (j < 0) return -1; i = j + 1; continue; }
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) return i; }
        i++;
    }
    return -1;
}

// i is just after an opening double quote; returns the index after the closing quote or -1.
function skipDq(s, i) {
    while (i < s.length) {
        const c = s[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '"') return i + 1;
        if (c === '$' && s[i + 1] === '(') { const k = findClose(s, i + 2); if (k < 0) return -1; i = k + 1; continue; }
        if (c === '`') { const j = s.indexOf('`', i + 1); if (j < 0) return -1; i = j + 1; continue; }
        i++;
    }
    return -1;
}

// Heredoc bodies are data: cut them out. Returns { main, bodies: [{ delim, text, consumer }], unterminated }.
function stripHeredocs(text) {
    const lines = String(text).split('\n');
    const outLines = [];
    const bodies = [];
    let unterminated = false;
    const stack = [{ t: 'top' }];
    let li = 0;
    while (li < lines.length) {
        const line = lines[li];
        outLines.push(line);
        li++;
        const pending = [];
        let i = 0;
        while (i < line.length) {
            const top = stack[stack.length - 1];
            const c = line[i];
            if (top.t === 'sq') { if (c === "'") stack.pop(); i++; continue; }
            if (c === '\\') { i += 2; continue; }
            if (top.t === 'dq') {
                if (c === '"') { stack.pop(); i++; continue; }
                if (c === '$' && line[i + 1] === '(' && line[i + 2] !== '(') { stack.push({ t: 'cmd', depth: 1 }); i += 2; continue; }
                i++;
                continue;
            }
            // top or cmd
            if (c === "'") { stack.push({ t: 'sq' }); i++; continue; }
            if (c === '"') { stack.push({ t: 'dq' }); i++; continue; }
            if (c === '$' && line[i + 1] === '(' && line[i + 2] !== '(') { stack.push({ t: 'cmd', depth: 1 }); i += 2; continue; }
            if (top.t === 'cmd') {
                if (c === '(') top.depth++;
                else if (c === ')') { top.depth--; if (top.depth === 0) stack.pop(); }
            }
            if (c === '<' && line[i + 1] === '<' && line[i + 2] !== '<' && line[i - 1] !== '<' && !/[0-9(]/.test(line[i - 1] || ' ') && !line.includes('((')) {
                const m = /^<<(-?)\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][\w]*))/.exec(line.slice(i));
                if (m) {
                    const before = line.slice(0, i);
                    const pieces = before.split(/\|\||&&|[;&|(`]|\$\(/);
                    const lastPiece = (pieces[pieces.length - 1] || '').trim();
                    const toks = lastPiece.split(/\s+/).filter((x) => x && !/^[A-Za-z_]\w*=/.test(x));
                    const consumer = path.basename(toks[0] || '');
                    pending.push({ delim: m[2] || m[3] || m[4], consumer });
                    i += m[0].length;
                    continue;
                }
            }
            i++;
        }
        for (const pd of pending) {
            const body = [];
            let closed = false;
            while (li < lines.length) {
                const bl = lines[li];
                li++;
                if (bl.trim() === pd.delim) { closed = true; break; }
                body.push(bl);
            }
            if (!closed) unterminated = true;
            bodies.push({ delim: pd.delim, text: body.join('\n'), consumer: pd.consumer });
        }
    }
    return { main: outLines.join('\n'), bodies, unterminated };
}

// Splits into segments { text, op, bg, subs }: op is the separator before the segment, subs the inner strings of
// $(...), backticks and <(...) inside it. open is true when a quote or parenthesis is not closed.
function scan(str) {
    const segs = [];
    let buf = '';
    let subs = [];
    let op = '';
    let open = false;
    let q = null;
    const n = str.length;
    let i = 0;
    const push = (nextOp, bg) => {
        const text = buf.trim();
        if (text) segs.push({ text, op, bg: !!bg, subs });
        if (text || nextOp !== '\n') op = nextOp;
        buf = '';
        subs = [];
    };
    while (i < n) {
        const c = str[i];
        if (q === "'") { buf += c; if (c === "'") q = null; i++; continue; }
        if (c === '\\') {
            if (str[i + 1] === '\n') { i += 2; continue; }
            buf += c + (i + 1 < n ? str[i + 1] : '');
            i += 2;
            continue;
        }
        if (c === '$' && str[i + 1] === '(') {
            const k = findClose(str, i + 2);
            if (k < 0) { open = true; buf += str.slice(i); i = n; continue; }
            const inner = str.slice(i + 2, k);
            if (inner.startsWith('(') && inner.endsWith(')')) {
                for (const s2 of scan(inner).segs.flatMap((s) => s.subs)) subs.push(s2);
            } else {
                subs.push(inner);
            }
            buf += str.slice(i, k + 1);
            i = k + 1;
            continue;
        }
        if (c === '`') {
            let j = i + 1;
            while (j < n && str[j] !== '`') { if (str[j] === '\\') j++; j++; }
            if (j >= n) { open = true; buf += str.slice(i); i = n; continue; }
            subs.push(str.slice(i + 1, j));
            buf += str.slice(i, j + 1);
            i = j + 1;
            continue;
        }
        if (q === '"') { if (c === '"') q = null; buf += c; i++; continue; }
        if (c === "'") { q = "'"; buf += c; i++; continue; }
        if (c === '"') { q = '"'; buf += c; i++; continue; }
        if ((c === '<' || c === '>') && str[i + 1] === '(') {
            const k = findClose(str, i + 2);
            if (k < 0) { open = true; buf += str.slice(i); i = n; continue; }
            subs.push(str.slice(i + 2, k));
            buf += str.slice(i, k + 1);
            i = k + 1;
            continue;
        }
        if (c === '(') {
            const k = findClose(str, i + 1);
            if (k < 0) { open = true; buf += str.slice(i); i = n; continue; }
            if (buf.trim() !== '') {
                for (const s2 of scan(str.slice(i + 1, k)).segs.flatMap((s) => s.subs)) subs.push(s2);
            }
            buf += str.slice(i, k + 1);
            i = k + 1;
            continue;
        }
        if (c === '#' && (buf === '' || /\s/.test(buf[buf.length - 1]))) {
            while (i < n && str[i] !== '\n') i++;
            continue;
        }
        if (c === '\n') { push('\n'); i++; continue; }
        if (c === ';') { push(';'); i++; if (str[i] === ';') i++; continue; }
        if (c === '&') {
            if (str[i + 1] === '&') { push('&&'); i += 2; continue; }
            if (buf.endsWith('>') || buf.endsWith('<') || str[i + 1] === '>') { buf += c; i++; continue; }
            push(';', true);
            i++;
            continue;
        }
        if (c === '|') {
            if (buf.endsWith('>')) { buf += c; i++; continue; }
            if (str[i + 1] === '|') { push('||'); i += 2; continue; }
            if (str[i + 1] === '&') { push('|'); i += 2; continue; }
            push('|');
            i++;
            continue;
        }
        buf += c;
        i++;
    }
    if (q) open = true;
    push('');
    return { segs, open };
}

function splitCommand(str) {
    const hd = stripHeredocs(String(str == null ? '' : str));
    return scan(hd.main).segs.map((s) => s.text);
}

// A segment into words and redirects. Word: { t, dyn, exp, glob, quoted }.
function tokenize(text) {
    const words = [];
    const redirs = [];
    let pending = null;
    const n = text.length;
    let i = 0;
    const add = (w) => {
        if (pending) { pending.target = w; redirs.push(pending); pending = null; } else words.push(w);
    };
    while (i < n) {
        while (i < n && /\s/.test(text[i])) i++;
        if (i >= n) break;
        const m = /^(?:&>>?|\d*(?:>>|>\||>&|>|<<<|<<-|<<|<&|<>|<))/.exec(text.slice(i));
        if (m && !((m[0] === '<' || m[0] === '>') && text[i + 1] === '(')) {
            const opm = /(&>>?|>>|>\||>&|>|<<<|<<-|<<|<&|<>|<)$/.exec(m[0]);
            i += m[0].length;
            if (pending) { pending.target = null; redirs.push(pending); }
            pending = { op: opm[1] };
            continue;
        }
        let t = '';
        let dyn = false;
        let exp = false;
        let glob = false;
        let quoted = false;
        while (i < n) {
            const c = text[i];
            if (/\s/.test(c)) break;
            if (c === '<' || c === '>') {
                if (text[i + 1] === '(') {
                    const k = findClose(text, i + 2);
                    const e = k < 0 ? n - 1 : k;
                    t += text.slice(i, e + 1);
                    dyn = true;
                    i = e + 1;
                    continue;
                }
                break;
            }
            if (c === '\\') { if (i + 1 < n) { t += text[i + 1]; i += 2; } else i++; continue; }
            if (c === "'") {
                const j = text.indexOf("'", i + 1);
                const e = j < 0 ? n : j;
                t += text.slice(i + 1, e);
                i = j < 0 ? n : j + 1;
                quoted = true;
                continue;
            }
            if (c === '"') {
                i++;
                quoted = true;
                while (i < n && text[i] !== '"') {
                    const d = text[i];
                    if (d === '\\' && i + 1 < n) {
                        const e = text[i + 1];
                        t += '"\\$`'.includes(e) ? e : '\\' + e;
                        i += 2;
                        continue;
                    }
                    if (d === '$' && text[i + 1] === '(') {
                        const k = findClose(text, i + 2);
                        const e = k < 0 ? n - 1 : k;
                        t += text.slice(i, e + 1);
                        dyn = true;
                        i = e + 1;
                        continue;
                    }
                    if (d === '`') {
                        const j = text.indexOf('`', i + 1);
                        const e = j < 0 ? n - 1 : j;
                        t += text.slice(i, e + 1);
                        dyn = true;
                        i = e + 1;
                        continue;
                    }
                    if (d === '$') exp = true;
                    t += d;
                    i++;
                }
                i++;
                continue;
            }
            if (c === '$' && text[i + 1] === '(') {
                const k = findClose(text, i + 2);
                const e = k < 0 ? n - 1 : k;
                t += text.slice(i, e + 1);
                dyn = true;
                i = e + 1;
                continue;
            }
            if (c === '`') {
                const j = text.indexOf('`', i + 1);
                const e = j < 0 ? n - 1 : j;
                t += text.slice(i, e + 1);
                dyn = true;
                i = e + 1;
                continue;
            }
            if (c === '$') exp = true;
            if (c === '*' || c === '?' || c === '[') glob = true;
            t += c;
            i++;
        }
        if (t.length > 0 || quoted) add({ t, dyn, exp, glob, quoted });
    }
    if (pending) { pending.target = null; redirs.push(pending); }
    return { words, redirs };
}

// ----------------------------------------------------------------------------------------------------------- scanners

function scanSecrets(text) {
    for (const re of TOKEN_VALUE_RES) {
        if (re.test(text)) return no('it contains a literal token or key; sessions never put secret values in commands, use the tool that already holds the credential or ask Yukimi');
    }
    for (const [re, label] of SECRET_PATH_RES) {
        if (re.test(text)) {
            return no(`it touches a secret (${label}); sessions never read, print or copy secrets, so use a tool that already holds the credential (mcp__yozora__*, a plain git push) or ask Yukimi`);
        }
    }
    return null;
}

function scanBody(text) {
    for (const re of TOKEN_VALUE_RES) {
        if (re.test(text)) return no('the heredoc contains a literal token or key; keep secret values out of commands');
    }
    for (const [re, label] of BODY_SECRET_RES) {
        if (re.test(text)) return no(`the heredoc text references a secret (${label}); leave secret paths out of what you send, or ask Yukimi`);
    }
    if (/\bgit\b[^\n]*\bpush\b[^\n]*(\s--force\b|\s--force-with-lease|\s-[A-Za-z]*f[A-Za-z]*\b|\s\+\S)/.test(text)) {
        return no('the heredoc force-pushes; push without --force or ask for the push to be done another way');
    }
    if (/\bgit\b[^\n]*--no-verify/.test(text)) return no('the heredoc skips the git hooks with --no-verify; fix what the hook reports instead');
    if (/\b(ssh|scp|sftp|mosh)\s+(-\S+\s+)*[\w.-]+@[\w.-]+/.test(text) || /\badb\s+connect\b/.test(text) || /\brsync\b[^\n]*\s[\w.-]+@?[\w.-]+:\S/.test(text)) {
        return no('the heredoc reaches another machine (ssh/scp/rsync/adb connect); sessions work on this host only, ask Yukimi for remote work');
    }
    return null;
}

// ----------------------------------------------------------------------------------------------------------- helpers

function splitFlagsArgs(args, valueFlags) {
    const vf = valueFlags || [];
    const flags = [];
    const pos = [];
    const values = {};
    let rest = false;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (rest) { pos.push(a); continue; }
        if (a.t === '--') { rest = true; continue; }
        if (a.t.length > 1 && a.t[0] === '-') {
            flags.push(a);
            if (vf.includes(a.t) && i + 1 < args.length) { values[a.t] = args[i + 1]; i++; }
            continue;
        }
        pos.push(a);
    }
    return { flags, pos, values };
}

function hasShort(flags, ch) { return flags.some((f) => /^-[A-Za-z0-9]+$/.test(f.t) && f.t.slice(1).includes(ch)); }
function hasFlag(flags, ...names) { return flags.some((f) => names.includes(f.t) || names.some((n) => n.startsWith('--') && f.t.startsWith(n + '='))); }

function allWrite(name, words, st) {
    for (const w of words) {
        const p = w.dyn ? null : expandPathStr(w.t, st);
        if (!p || !allowedWrite(p, st)) {
            return no(`${name} ${short(w.t)} reaches outside the repo and the scratchpad; ${whereMsg()}`);
        }
    }
    return ok();
}

function urlHostVerdict(u, label) {
    let url;
    try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : 'http://' + u); } catch (_) { return no(`${label} ${short(u)} is not a valid URL`); }
    if (BILLING_URL_RE.test(url.pathname)) return hers(`${short(u)} is a billing, purchase or account step only Yukimi can do`);
    if (!/^https?:$/.test(url.protocol)) return no(`${label} to ${short(u)} uses ${url.protocol}; only http(s) to localhost or Yozora is auto-approved`);
    const host = url.hostname.toLowerCase();
    if (LOCAL_HOSTS.includes(host) || host === YOZORA_HOST) return ok('local or Yozora request');
    return no(`${label} to ${host} is not on the auto-approve list (localhost and ${YOZORA_HOST} only); use the Yozora or local API, or ask Yukimi to approve the request`);
}

function secretVarName(n) { return SECRET_VARNAME_RE.test(n); }

// ----------------------------------------------------------------------------------------------------------- git

const DISCARD_MSG = 'it would discard uncommitted edits other sessions may hold in the shared tree; commit them with your change or leave them alone (no-stash-to-pretty-commit)';
const LIVE_PULL_MSG = 'never pull, rebase or merge a remote in the live /home/kanmi/staticforge tree; git fetch, then build your commit on origin/main in a separate clone or worktree under the scratchpad and push that (commit-each-turn)';

function evalGit(args, st) {
    let i = 0;
    let dir = st.curDir;
    while (i < args.length) {
        const a = args[i].t;
        if (a === '-C') {
            const nx = args[i + 1];
            if (!nx || nx.dyn) return no('git -C needs a plain directory; write the path out');
            dir = expandPathStr(nx.t, st, dir);
            i += 2;
            continue;
        }
        if (a === '-c') {
            const nx = args[i + 1];
            if (!nx) return no('git -c needs a key=value');
            const key = nx.t.split('=')[0];
            if (BAD_GIT_C_RE.test(key)) return no(`git -c ${key} can disable hooks, add credentials or run commands, so it is not auto-approved; use plain git`);
            i += 2;
            continue;
        }
        if (a.startsWith('--git-dir') || a.startsWith('--work-tree')) {
            let val = a.includes('=') ? a.slice(a.indexOf('=') + 1) : (args[i + 1] || {}).t;
            if (!a.includes('=')) i++;
            i++;
            const p = val ? expandPathStr(val, st, dir) : null;
            if (!p || !repoDirOk(p, st)) return no('git --git-dir/--work-tree points outside the repo and the scratchpad; run git inside your own repo');
            if (a.startsWith('--work-tree')) dir = p;
            continue;
        }
        if (/^--(no-pager|paginate|no-optional-locks|literal-pathspecs|glob-pathspecs|noglob-pathspecs|icase-pathspecs|no-replace-objects)$/.test(a) || a === '-p' || a === '-P') { i++; continue; }
        if (a.startsWith('-')) return no(`git option ${short(a)} is not on the auto-approve list`);
        break;
    }
    if (i >= args.length) return ok('git');
    const sub = args[i].t;
    const rest = args.slice(i + 1);
    const { flags, pos } = splitFlagsArgs(rest);
    const dirOk = repoDirOk(dir, st);
    const outside = () => no(`git ${sub} in ${short(dir || 'an unknown directory')} is outside this session's repo and the scratchpad; run it in your own repo`);
    const live = !dir || within(dir, st.cx.live);

    if (hasFlag(flags, '--no-verify') || (sub === 'commit' && flags.some((f) => /^-[A-Za-z]+$/.test(f.t) && f.t.slice(1).includes('n')))) {
        return no('it skips the pre-commit hooks; fix what the hook reports and commit without --no-verify');
    }

    switch (sub) {
    case 'status': case 'diff': case 'log': case 'show': case 'rev-parse': case 'blame': case 'ls-files': case 'ls-tree':
    case 'rev-list': case 'describe': case 'shortlog': case 'cat-file': case 'name-rev': case 'grep': case 'merge-base':
    case 'diff-tree': case 'diff-index': case 'diff-files': case 'show-ref': case 'for-each-ref': case 'check-ignore':
    case 'count-objects': case 'whatchanged': case 'show-branch': case 'range-diff': case 'cherry': case 'version':
    case 'help': case 'check-ref-format': case 'verify-commit':
        if (hasFlag(flags, '--output')) {
            const t = flags.find((f) => f.t.startsWith('--output='));
            const p = t ? expandPathStr(t.t.slice(9), st) : null;
            if (!p || !allowedWrite(p, st)) return no(`git ${sub} --output writes outside the repo and the scratchpad; ${whereMsg()}`);
        }
        return ok('git read');
    case 'ls-remote': {
        if (pos[0] && /[:@/]/.test(pos[0].t)) return urlHostVerdict(pos[0].t.replace(/^[\w.-]+@([\w.-]+):/, 'ssh://$1/'), 'git ls-remote');
        return ok('git read');
    }
    case 'reflog':
        if (pos.some((p) => p.t === 'expire' || p.t === 'delete')) return no('git reflog expire/delete throws away recovery history; leave it alone');
        return ok('git read');
    case 'symbolic-ref':
        if (pos.length <= 1) return ok('git read');
        return no('git symbolic-ref with a value rewrites HEAD; use git switch or git checkout <branch>');
    case 'config':
        if (hasFlag(flags, '--get', '--get-all', '--get-regexp', '--list', '-l', '--get-urlmatch', '--show-origin', '--name-only', '--get-color')) return ok('git config read');
        return no('git config can only be read (--get / --list); changing git config is not auto-approved');
    case 'remote':
        if (!pos.length || pos[0].t === 'show' || pos[0].t === 'get-url') return ok('git read');
        return no(`git remote ${short(pos[0].t)} changes where the repo pushes; ask Yukimi`);
    case 'fetch': {
        if (!dirOk) return outside();
        if (hasFlag(flags, '--force', '-f', '--update-head-ok', '-u') || hasShort(flags, 'f')) return no('git fetch --force can overwrite local refs; use a plain git fetch');
        if (pos[0] && /[:@/]/.test(pos[0].t) && !/^[\w.-]+$/.test(pos[0].t)) {
            const v = urlHostVerdict(pos[0].t.replace(/^[\w.-]+@([\w.-]+):/, 'ssh://$1/'), 'git fetch');
            if (v.d !== 'approve') return v;
        }
        if (pos.slice(1).some((p) => p.t.includes(':'))) return no('git fetch with a dst refspec overwrites local branches; use a plain git fetch origin');
        return ok('git fetch');
    }
    case 'push': {
        if (!dirOk) return outside();
        for (const f of flags) {
            const t = f.t;
            if (t === '--force' || t === '--force-with-lease' || t.startsWith('--force-with-lease=') || t === '--force-if-includes' || t === '--mirror'
                || (/^-[A-Za-z]+$/.test(t) && t.slice(1).includes('f'))) {
                return no('it force-pushes; push without --force or ask for the push to be done another way');
            }
            if (t === '--delete' || t === '--prune' || (/^-[A-Za-z]+$/.test(t) && t.slice(1).includes('d'))) {
                return no('it deletes remote refs; ask Yukimi for remote deletions instead');
            }
        }
        if (pos[0] && (/[:@]|^[./~]/.test(pos[0].t) || pos[0].dyn)) return no(`it pushes to ${short(pos[0].t)} instead of a named remote; push to origin`);
        for (const r of pos.slice(1)) {
            if (r.t.startsWith('+')) return no('it force-pushes (+refspec); push without + or ask for the push to be done another way');
            if (r.t.startsWith(':')) return no('it deletes a remote ref (:ref); ask Yukimi for remote deletions instead');
        }
        return ok('git push');
    }
    case 'pull':
        if (!dirOk) return outside();
        if (live) return no(LIVE_PULL_MSG);
        return ok('git pull in a separate clone');
    case 'rebase':
        if (!dirOk) return outside();
        if (live && !hasFlag(flags, '--abort')) return no(LIVE_PULL_MSG);
        return ok('git rebase in a separate clone');
    case 'merge':
        if (!dirOk) return outside();
        if (live && pos.some((p) => /^(origin|upstream)\/|FETCH_HEAD|@\{u/.test(p.t))) return no(LIVE_PULL_MSG);
        return ok('git merge');
    case 'stash':
        return no('git stash can carry other sessions\' uncommitted work away; commit it with your change or leave it (no-stash-to-pretty-commit)');
    case 'clean':
        if (hasFlag(flags, '-n', '--dry-run') || hasShort(flags, 'n')) return ok('git clean dry run');
        return no('git clean deletes untracked files other sessions may need; remove only your own files by name');
    case 'reset':
        if (!dirOk) return outside();
        if (hasFlag(flags, '--hard', '--merge', '--keep', '--soft', '--mixed')) return no('git reset moves the branch or throws away uncommitted work in the shared tree; use git restore --staged for the index or ask Yukimi');
        if (pos.some((p) => /^(HEAD[~^@]|[0-9a-f]{7,40}$|origin\/|@\{|ORIG_HEAD|FETCH_HEAD)|~\d/.test(p.t))) return no('git reset to another commit moves the branch and can drop other sessions\' unpushed commits; ask Yukimi');
        return ok('git reset of the index');
    case 'restore':
        if (!dirOk) return outside();
        if (hasFlag(flags, '--staged', '-S') && !hasFlag(flags, '--worktree', '-W')) return ok('git restore --staged');
        return no(DISCARD_MSG);
    case 'checkout': {
        if (!dirOk) return outside();
        if (hasFlag(flags, '-f', '--force', '--theirs', '--ours') || hasShort(flags, 'f')) return no(DISCARD_MSG);
        if (rest.some((w) => w.t === '--')) return no(DISCARD_MSG);
        if (hasFlag(flags, '-b', '-B', '--orphan', '--detach', '-t', '--track', '-d') || hasShort(flags, 'b')) return ok('git checkout of a branch');
        if (pos.length === 0) return ok('git checkout');
        if (pos.length >= 2) return no(DISCARD_MSG);
        const p = pos[0].t;
        if (/^(\.|:\/|\*|:\(.*)$/.test(p)) return no(DISCARD_MSG);
        let isPath = false;
        try { isPath = p !== '-' && fs.existsSync(path.join(dir, p)); } catch (_) { isPath = false; }
        if (isPath) return no(DISCARD_MSG);
        return ok('git checkout of a branch');
    }
    case 'switch':
        if (!dirOk) return outside();
        if (hasFlag(flags, '-f', '--force', '--discard-changes', '-C', '--force-create') || hasShort(flags, 'f')) return no(DISCARD_MSG);
        return ok('git switch');
    case 'branch':
        if (!dirOk) return outside();
        if (hasFlag(flags, '-D', '-f', '--force') || hasShort(flags, 'D') || hasShort(flags, 'f')) return no('git branch -D/-f drops or moves a branch with unmerged commits; use -d, or ask Yukimi');
        return ok('git branch');
    case 'tag':
        if (!dirOk) return outside();
        if (hasFlag(flags, '-f', '--force') || hasShort(flags, 'f')) return no('git tag -f moves an existing tag; use a new tag name');
        return ok('git tag');
    case 'add': case 'commit': case 'cherry-pick': case 'revert': case 'apply':
        if (!dirOk) return outside();
        return ok('git ' + sub);
    case 'worktree': {
        if (!dirOk) return outside();
        const act = pos[0] ? pos[0].t : '';
        if (act === 'list' || !act) return ok('git read');
        if (act === 'add' || act === 'remove' || act === 'move' || act === 'prune') {
            const sub2 = rest.slice(rest.findIndex((w) => w.t === act) + 1);
            const { pos: p2 } = splitFlagsArgs(sub2, ['-b', '-B', '--reason', '--expire']);
            for (const w of (act === 'prune' ? [] : p2.slice(0, act === 'move' ? 2 : 1))) {
                const p = w.dyn ? null : expandPathStr(w.t, st, dir);
                if (!p || !allowedWrite(p, st)) return no(`git worktree ${act} ${short(w.t)} is outside the repo and the scratchpad; use a path under the scratchpad`);
            }
            return ok('git worktree');
        }
        return no(`git worktree ${short(act)} is not on the auto-approve list`);
    }
    case 'clone': {
        const url = pos[0];
        if (!url) return no('git clone needs a url');
        if (/[:@]|:\/\//.test(url.t) || url.dyn) {
            const v = urlHostVerdict(url.t.replace(/^[\w.-]+@([\w.-]+):/, 'ssh://$1/'), 'git clone');
            if (v.d !== 'approve') return v;
        }
        if (pos[1]) {
            const p = pos[1].dyn ? null : expandPathStr(pos[1].t, st, dir);
            if (!p || !allowedWrite(p, st)) return no(`git clone into ${short(pos[1].t)} is outside the repo and the scratchpad; clone into the scratchpad`);
        } else if (!dirOk) {
            return outside();
        }
        return ok('git clone');
    }
    default:
        return no(`git ${short(sub)} is not on the auto-approve list; use status/diff/log/add/commit/push/fetch/branch/checkout/switch or ask Yukimi`);
    }
}

// ----------------------------------------------------------------------------------------------------------- adb

function serialVerdict(serial) {
    if (!serial) return no('adb without -s could hit the Fold; pin it with -s emulator-<port> (not 5570 or 5580) or -s ' + A53_SERIAL + ' (the A53)');
    if (serial === A53_SERIAL) return ok('adb on the A53');
    const m = /^emulator-(\d+)$/.exec(serial);
    if (m) {
        if (FOREIGN_EMULATOR_PORTS.includes(m[1])) return no(`${serial} belongs to another session; use your own emulator-<port> or the A53 (-s ${A53_SERIAL})`);
        return ok('adb on an emulator');
    }
    return no(`adb -s ${short(serial)} is not an emulator or the A53 (the Fold is off limits); use -s emulator-<port> or -s ${A53_SERIAL}`);
}

function deviceReadOnly(inner) {
    const text = String(inner || '').trim();
    if (!text) return false;
    if (/[`]|\$\(/.test(text)) return false;
    if (/(^|[^2&0-9])>(?!\s*\/dev\/null|&)/.test(text) || /(^|[^2&])>>/.test(text)) return false;
    for (const segText of splitCommand(text)) {
        const toks = segText.trim().split(/\s+/);
        const c = toks[0];
        const a1 = toks[1] || '';
        if (['getprop', 'logcat', 'screencap', 'cat', 'ls', 'ps', 'id', 'date', 'uptime', 'df', 'du', 'stat', 'grep', 'egrep',
            'head', 'tail', 'wc', 'echo', 'getevent', 'netstat', 'ss', 'which', 'uname', 'top', 'printenv', 'sort', 'cut', 'tr', 'awk', 'find'].includes(c)) {
            if (c === 'find' && /-(delete|exec)\b/.test(segText)) return false;
            continue;
        }
        if (c === 'dumpsys') { if (/\b(set|reset|unplug|force-idle|unforce|enable|disable|whitelist|reset-all)\b/.test(segText)) return false; continue; }
        if (c === 'pm') { if (/^(list|path|dump|resolve-activity|get-[\w-]+|has-feature)$/.test(a1)) continue; return false; }
        if (c === 'settings') { if (a1 === 'get' || a1 === 'list') continue; return false; }
        if (c === 'wm') { if ((a1 === 'size' || a1 === 'density') && toks.length <= 2) continue; return false; }
        if (c === 'ip') { if (/^(addr|address|route|link|neigh)$/.test(a1) && !/\b(add|del|delete|set|flush|replace)\b/.test(segText)) continue; return false; }
        return false;
    }
    return true;
}

function evalAdb(args, st, env) {
    let i = 0;
    let serial = (env && env.ANDROID_SERIAL) || null;
    while (i < args.length && args[i].t.startsWith('-')) {
        const a = args[i].t;
        if (a === '-s') { serial = args[i + 1] ? (args[i + 1].dyn || args[i + 1].exp ? '$unresolved' : args[i + 1].t) : null; i += 2; continue; }
        if (a === '-H' || a === '-P' || a === '-L') { i += 2; continue; }
        i++;
    }
    const sub = args[i] ? args[i].t : '';
    const rest = args.slice(i + 1);
    if (!sub) return ok('adb');
    if (sub === 'connect' || sub === 'disconnect' || sub === 'pair' || sub === 'mdns') return no(`adb ${sub} reaches another machine or changes the shared adb connections; the emulators and the A53 are already attached, ask Yukimi for anything else`);
    if (sub === 'kill-server' || sub === 'start-server' || sub === 'server') return no(`adb ${sub} drops every other session's device connections; leave the adb server alone`);
    if (['devices', 'get-state', 'get-serialno', 'get-devpath', 'version', 'help', 'features', 'logcat', 'wait-for-device', 'wait-for-usb-device'].includes(sub)) return ok('adb read');
    if (sub === 'pull') {
        const dest = rest.filter((w) => !w.t.startsWith('-'))[1];
        if (!dest) return ok('adb pull');
        const p = dest.dyn ? null : expandPathStr(dest.t, st);
        if (!p || !allowedWrite(p, st)) return no(`adb pull into ${short(dest.t)} writes outside the repo and the scratchpad; ${whereMsg()}`);
        return ok('adb pull');
    }
    if (sub === 'shell' || sub === 'exec-out') {
        const inner = rest.map((w) => w.t).join(' ');
        if (deviceReadOnly(inner)) return ok('adb read-only shell');
    }
    return serialVerdict(serial);
}

function evalLaneWrapper(args) {
    const text = args.map((w) => w.t).join(' ');
    if (/emulator-(5570|5580)\b|(^|\s)(5570|5580)(\s|$)/.test(text)) return no('emulator-5570 and emulator-5580 belong to other sessions; use your own lane instance or the A53');
    const m = /(^|\s)-s\s+(\S+)/.exec(text);
    if (m) {
        const v = serialVerdict(m[2]);
        if (v.d !== 'approve') return v;
    }
    return ok('lane/A53 wrapper');
}

// ----------------------------------------------------------------------------------------------------------- simple commands

function evalCurl(name, args, st) {
    const curl = name === 'curl';
    const valFlags = curl
        ? new Set(['-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '-X', '--request', '-o', '--output', '-u', '--user', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '-c', '--cookie-jar', '-F', '--form', '--form-string', '-T', '--upload-file', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '--retry', '--json', '-r', '--range', '--limit-rate', '--retry-delay', '--output-dir', '--url', '--cacert', '--cert', '-E', '--key'])
        : new Set(['-O', '--output-document', '-P', '--directory-prefix', '-o', '--output-file', '-a', '--append-output', '--header', '--post-data', '--post-file', '--user', '--password', '-U', '--user-agent', '--referer', '-T', '--timeout', '-t', '--tries', '-w', '--wait', '--load-cookies', '--save-cookies', '-e', '--execute', '-i', '--input-file']);
    const outFlags = curl ? ['-o', '--output', '-c', '--cookie-jar', '--output-dir'] : ['-O', '--output-document', '-P', '--directory-prefix', '-o', '--output-file', '-a', '--append-output', '--save-cookies'];
    const urls = [];
    const outs = [];
    let writesHere = false;
    for (let i = 0; i < args.length; i++) {
        const a = args[i].t;
        if (a.startsWith('-') && a.length > 1) {
            let key = a;
            let val = null;
            if (a.startsWith('--') && a.includes('=')) { key = a.slice(0, a.indexOf('=')); val = a.slice(a.indexOf('=') + 1); }
            if (['--proxy', '-x', '--resolve', '--connect-to', '--config', '-K', '--socks5', '--interface'].includes(key)) {
                return no(`${name} ${key} redirects the request to another host; call localhost or Yozora directly`);
            }
            if (curl && (key === '-O' || key === '--remote-name')) writesHere = true;
            if (val === null && valFlags.has(key)) { val = args[i + 1] ? args[i + 1].t : null; i++; }
            else if (val === null && /^-[A-Za-z]{2,}$/.test(a) && valFlags.has('-' + a[a.length - 1])) { key = '-' + a[a.length - 1]; val = args[i + 1] ? args[i + 1].t : null; i++; }
            if (key === '--url' && val) urls.push(val);
            if (outFlags.includes(key) && val) outs.push(val);
            continue;
        }
        urls.push(a);
    }
    for (const o of outs) {
        const p = expandPathStr(o, st);
        if (!(o === '-') && (!p || !allowedWrite(p, st))) return no(`${name} output to ${short(o)} writes outside the repo and the scratchpad; ${whereMsg()}`);
    }
    if (writesHere && !(st.curDir && allowedWrite(st.curDir, st))) return no(`${name} -O writes into ${short(st.curDir || 'an unknown directory')}; cd into the repo or the scratchpad first`);
    if (!urls.length) {
        if (args.some((w) => /^(--version|-V|--help|-h)$/.test(w.t))) return ok(name + ' info');
        return no(`${name} without a URL cannot be checked; give a localhost or Yozora URL`);
    }
    const vs = urls.map((u) => urlHostVerdict(u, name));
    return combine(vs);
}

function evalFind(args, st, flow, env) {
    let idx = 0;
    const roots = [];
    while (idx < args.length && !/^(-|\(|!)/.test(args[idx].t)) { roots.push(args[idx]); idx++; }
    const rootList = roots.length ? roots : [{ t: '.', dyn: false }];
    const expr = args.slice(idx);
    const hasDelete = expr.some((w) => w.t === '-delete');
    const execAt = [];
    for (let i = 0; i < expr.length; i++) if (/^-(exec|execdir|ok|okdir)$/.test(expr[i].t)) execAt.push(i);
    if (expr.some((w) => /^-(fprint0?|fprintf|fls)$/.test(w.t))) return no('find -fprint/-fls writes a file; redirect the output into the repo or the scratchpad instead');
    let anyBad = false;
    let firstGood = null;
    if (hasDelete || execAt.length) {
        for (const r of rootList) {
            const p = r.dyn ? null : expandPathStr(r.t, st);
            if (!p || !rmAllowed(p, st)) {
                if (hasDelete) return no(`find ${short(r.t)} -delete reaches the repo root or outside it; give a narrower directory below the repo or the scratchpad`);
                anyBad = true;
            } else if (!firstGood) {
                firstGood = p;
            }
        }
    }
    for (const at of execAt) {
        const cmd = [];
        let j = at + 1;
        while (j < expr.length && expr[j].t !== ';' && expr[j].t !== '+') { cmd.push(expr[j]); j++; }
        if (!cmd.length) continue;
        const mapped = cmd.map((w) => (w.t.includes('{}') ? { ...w, t: w.t.replace(/\{\}/g, !anyBad && firstGood ? firstGood + '/x' : '/__find_unknown__/x') } : w));
        const v = evalSimple(mapped, st, null, flow, env);
        if (v.d !== 'approve') return v;
        if (anyBad && /^(rm|rmdir|mv|chmod|chown|unlink|tee|cp)$/.test(cmd[0].t)) return no(`find -exec ${cmd[0].t} from ${short(rootList[0].t)} can reach outside what a session may change; use a directory below the repo or the scratchpad`);
    }
    return ok('find');
}

function evalSed(args, st) {
    const { flags } = splitFlagsArgs(args);
    const inPlace = flags.some((f) => /^-[A-Za-z]*i/.test(f.t) && !/^--/.test(f.t)) || flags.some((f) => f.t === '--in-place' || f.t.startsWith('--in-place='));
    if (!inPlace) {
        return ok('sed read');
    }
    let scriptGiven = false;
    const files = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i].t;
        if (a === '-e' || a === '-f' || a === '--expression' || a === '--file') { scriptGiven = true; i++; continue; }
        if (a.startsWith('-')) continue;
        if (!scriptGiven) { scriptGiven = true; continue; }
        files.push(args[i]);
    }
    if (!files.length) return ok('sed');
    return allWrite('sed -i on', files, st);
}

function evalPackageManager(args) {
    const { flags, pos } = splitFlagsArgs(args, ['--prefix', '--workspace', '-w', '--cache', '--registry']);
    const sub = pos[0] ? pos[0].t : '';
    if (!sub) return ok('npm');
    if (['login', 'adduser', 'add-user'].includes(sub)) return hers('npm login is an account step only Yukimi can do');
    if (['test', 't', 'tst', 'run', 'run-script', 'rum', 'urb', 'ci', 'install', 'i', 'add', 'ls', 'list', 'll', 'la', 'view', 'info', 'outdated', 'audit', 'root', 'bin', 'prefix', 'exec', 'x', 'start', 'stop', 'restart', 'version-info', 'help', 'explain', 'why', 'doctor'].includes(sub)) {
        if (['install', 'i', 'add'].includes(sub) && hasFlag(flags, '-g', '--global')) return no('npm install -g changes the system, outside the repo; install locally or ask Yukimi');
        return ok('npm');
    }
    if (sub === 'config') {
        if (pos[1] && (pos[1].t === 'get' || pos[1].t === 'list' || pos[1].t === 'ls')) return ok('npm config read');
        return no('npm config can only be read; changing it is not auto-approved');
    }
    if (flags.some((f) => f.t === '--version' || f.t === '-v')) return ok('npm');
    return no(`npm ${short(sub)} is not on the auto-approve list (test/run/ci/install only); ask Yukimi`);
}

function evalSqlite(args) {
    const text = args.map((w) => w.t).join(' ');
    if (/\b(insert|update|delete|drop|alter|create|replace|vacuum|attach|reindex|analyze)\b/i.test(text) || /\bpragma\b[^;]*=/i.test(text) || /(^|\s)\.(import|write|shell|system|output|once|save|restore|backup|read|load)\b/.test(text)) {
        return no('sqlite3 may only read; changing a database is not auto-approved, ask Yukimi');
    }
    return ok('sqlite3 read');
}

function evalTmux(args) {
    let i = 0;
    while (i < args.length && args[i].t.startsWith('-')) { i += /^-[LSfcT]$/.test(args[i].t) ? 2 : 1; }
    const sub = args[i] ? args[i].t : '';
    if (!sub) return no('tmux with no subcommand attaches a terminal; use capture-pane or list-*');
    if (/^(capture-pane|capturep|list-sessions|ls|list-windows|lsw|list-panes|lsp|list-clients|lsc|list-buffers|lsb|show-buffer|showb|show-options|show|show-environment|showenv|display-message|display|has-session|has|list-keys|lsk|show-messages|showmsgs)$/.test(sub)) return ok('tmux read');
    return no(`tmux ${short(sub)} types into, creates or kills sessions; the Supervisor does that itself, so use capture-pane / list-* here`);
}

function evalKill(name, args, st) {
    const { flags, pos } = splitFlagsArgs(args, ['-s', '-n', '-u', '-g', '-t', '-P']);
    if (name === 'kill') {
        if (hasFlag(flags, '-l', '-L', '-0')) return ok('kill info');
        if (!pos.length) return no('kill with no visible pid; name the process and ask Yukimi');
        const bad = pos.filter((w) => {
            if (w.t === '$!' || /^%\d*$/.test(w.t)) return false;
            const m = /^\$\{?([A-Za-z_]\w*)\}?$/.exec(w.t);
            return !(m && st.pidVars.includes(m[1]));
        });
        if (!bad.length) return ok('kill of a process this command started');
        return no(`kill of pid ${short(bad.map((w) => w.t).join(' '))} is not auto-approved because this command did not start it; name the process and ask Yukimi, or stop only what you launched in the same command`);
    }
    if (!pos.length) return no(`${name} with no process name; name the process and ask Yukimi`);
    const bad = pos.filter((w) => !(w.t.length >= 3 && st.bg.some((b) => b.includes(w.t))));
    if (!bad.length) return ok(name + ' of a process this command started');
    return no(`${name} of "${short(bad.map((w) => w.t).join(' '))}" is not auto-approved because this command did not start it; name the process and ask Yukimi, or stop only what you launched in the same command`);
}

function evalRm(name, args, st) {
    const { pos } = splitFlagsArgs(args);
    if (!pos.length) return no(`${name} with no visible targets (they come from a pipe or a variable); give the paths to delete explicitly, below the repo or the scratchpad`);
    for (const w of pos) {
        const p = w.dyn ? null : expandPathStr(w.t, st);
        if (!p) return no(`${name} target "${short(w.t)}" cannot be resolved (variable, substitution or unknown directory); write the path out, below the repo or the scratchpad`);
        if (!rmAllowed(p, st)) return no(`${name} of ${short(w.t)} reaches outside what a session may delete (only below the repo directory and the scratchpad, never the directory itself or .git); delete only files inside the repo`);
    }
    return ok('delete inside the repo or scratchpad');
}

function evalWrapped(words, st, seg, flow, env) {
    if (!words.length) return ok();
    return evalSimple(words, st, seg, flow, env);
}

// seg may be null (find -exec). Returns a verdict.
function evalSimple(words, st, seg, flow, env) {
    const w0 = words[0];
    if (w0.dyn || /[$`]/.test(w0.t)) return no(`the command name "${short(w0.t)}" is computed, so it cannot be checked; write the command out`);
    let name = w0.t;
    const args = words.slice(1);
    const fl = flow || {};

    if (name.includes('/')) {
        const p = expandPathStr(name, st);
        if (!p) return no(`the command path "${short(name)}" cannot be resolved; use a path inside the repo`);
        const base = path.basename(p);
        const dirName = path.dirname(p);
        if (['/usr/bin', '/bin', '/usr/local/bin', '/usr/sbin', '/sbin'].includes(dirName)) name = base;
        else if (base === 'adb' && (within(p, st.cx.home) || within(p, '/usr') || within(p, '/opt'))) name = 'adb';
        else if (p === path.join(st.cx.home, '.config/a53/a53.sh')) return evalLaneWrapper(args);
        else if (allowedWrite(p, st) || within(p, st.cx.repoRoot)) {
            if (base === 'lane.sh' || base === 'a53.sh') return evalLaneWrapper(args);
            st.names.push('script');
            return ok('repo script');
        } else return no(`running ${short(name)} is not repo work (it is outside the repo and the scratchpad); run a script under the repo or ask Yukimi`);
    }
    st.names.push(name);

    switch (name) {
    // ---- control words and shell builtins
    case 'for': case 'select': case 'done': case 'fi': case 'esac': case 'in': case 'function':
        return ok('shell control');
    case 'cd': {
        const t = args.filter((w) => !/^-[LPe@]+$/.test(w.t))[0];
        if (!t) st.curDir = st.cx.home;
        else if (t.t === '-' || t.dyn) st.curDir = null;
        else st.curDir = expandPathStr(t.t, st);
        return ok('cd');
    }
    case 'source': case '.': {
        const t = args[0];
        const p = t && !t.dyn ? expandPathStr(t.t, st) : null;
        if (p && (allowedWrite(p, st) || within(p, st.cx.repoRoot))) return ok('source of a repo script');
        return no(`sourcing ${short(t ? t.t : '')} runs a script from outside the repo and the scratchpad; source only repo scripts`);
    }
    case 'eval': {
        if (!args.length) return ok('eval');
        return classifyCommand(args.map((w) => w.t).join(' '), childState(st));
    }
    case 'trap': {
        const h = args[0];
        if (!h || h.t === '-' || h.t === '' || h.t === '-l' || h.t === '-p') return ok('trap');
        return classifyCommand(h.t, childState(st));
    }
    case 'export': case 'declare': case 'typeset':
        if (!args.length && name === 'export') return no('export with no arguments prints every variable, secrets included; print only the variable you need');
        if (args.some((w) => w.t === '-p' || /^-[A-Za-z]*p/.test(w.t))) return no(`${name} -p prints every variable, secrets included; print only the variable you need`);
        return ok(name);
    case 'set':
        if (!args.length) return no('a bare set prints every variable, secrets included; print only the variable you need');
        return ok('set');
    case 'env': {
        let i = 0;
        const e2 = Object.assign({}, env);
        while (i < args.length) {
            const a = args[i].t;
            if (a === '-u' || a === '-C' || a === '-S') { i += 2; continue; }
            if (a.startsWith('-')) { i++; continue; }
            const m = /^([A-Za-z_]\w*)=(.*)$/.exec(a);
            if (m) { e2[m[1]] = m[2]; i++; continue; }
            break;
        }
        if (i >= args.length) return no('env with no command prints every variable, secrets included; print only the variable you need (printenv NAME is still checked) or run a command under env');
        return evalWrapped(args.slice(i), st, seg, flow, e2);
    }
    case 'printenv': {
        if (!args.length) return no('printenv with no name prints every variable, secrets included; print only the variable you need');
        const bad = args.find((w) => secretVarName(w.t));
        if (bad) return no(`printenv ${short(bad.t)} prints a secret; sessions never print secrets`);
        return ok('printenv');
    }
    case 'command': case 'builtin': case 'exec': case 'nohup': case 'setsid': case 'time': case 'stdbuf': case 'nice': case 'timeout': case 'ionice': {
        if (name === 'command' && args.some((w) => w.t === '-v' || w.t === '-V')) return ok('command -v');
        let i = 0;
        if (name === 'timeout') {
            while (i < args.length && args[i].t.startsWith('-')) i += /^(-k|-s|--kill-after|--signal)$/.test(args[i].t) ? 2 : 1;
            i++;
        } else if (name === 'nice') {
            while (i < args.length && args[i].t.startsWith('-')) i += args[i].t === '-n' ? 2 : 1;
        } else if (name === 'ionice') {
            while (i < args.length && args[i].t.startsWith('-')) i += /^-[cnp]$/.test(args[i].t) ? 2 : 1;
        } else {
            while (i < args.length && args[i].t.startsWith('-')) i++;
        }
        return evalWrapped(args.slice(i), st, seg, flow, env);
    }
    case 'xargs': {
        let i = 0;
        while (i < args.length && args[i].t.startsWith('-')) {
            i += /^-(n|I|L|P|d|E|s|a)$/.test(args[i].t) || /^--(max-args|max-procs|delimiter|arg-file)$/.test(args[i].t) ? 2 : 1;
        }
        const cmd = args.slice(i);
        if (!cmd.length) return ok('xargs echo');
        const first = path.basename(cmd[0].t);
        if (/^(rm|rmdir|unlink|shred|mv|cp|chmod|chown|tee|dd|kill|pkill|killall|truncate|ln|touch|mkdir|sed|git)$/.test(first)) {
            return no(`xargs ${first} acts on targets that come from stdin and cannot be checked; list the paths explicitly`);
        }
        return evalSimple(cmd, st, seg, flow, env);
    }
    case 'bash': case 'sh': case 'zsh': case 'dash': case 'ksh': {
        let cFlag = false;
        let script = null;
        let inner = null;
        for (let i = 0; i < args.length; i++) {
            const a = args[i].t;
            if (/^-[A-Za-z]*c[A-Za-z]*$/.test(a)) { cFlag = true; continue; }
            if (a.startsWith('-') && a !== '-') continue;
            if (cFlag) { inner = args[i]; break; }
            script = args[i];
            break;
        }
        if (cFlag) {
            if (!inner) return no(`${name} -c with no command string`);
            return classifyCommand(inner.t, childState(st));
        }
        if (script && script.t !== '-') {
            const p = script.dyn ? null : expandPathStr(script.t, st);
            if (p && p === path.join(st.cx.home, '.config/a53/a53.sh')) return evalLaneWrapper(args.slice(args.indexOf(script) + 1));
            if (p && (allowedWrite(p, st) || within(p, st.cx.repoRoot))) {
                const b = path.basename(p);
                if (b === 'lane.sh' || b === 'a53.sh') return evalLaneWrapper(args.slice(args.indexOf(script) + 1));
                return ok('repo script');
            }
            return no(`${name} ${short(script.t)} runs a script from outside the repo and the scratchpad; run a script under the repo or ask Yukimi`);
        }
        if (seg && seg.hasHeredoc) return ok('shell script from a heredoc');
        if (fl.pipedIn && fl.netPipe) return no(`piping a download into ${name} (curl|sh) runs code nobody has read; download the file into the scratchpad, read it, then run it`);
        return no(`${name} reading a script from stdin or a pipe cannot be checked; give it a script file under the repo or a heredoc`);
    }

    // ---- git, node, python
    case 'git': return evalGit(args, st);
    case 'node': case 'nodejs': case 'python': case 'python3': case 'npx': return ok(name);
    case 'npm': return evalPackageManager(args);

    // ---- accounts and money
    case 'gh': {
        if (args[0] && args[0].t === 'auth') {
            if (args[1] && args[1].t === 'token') return no('gh auth token prints a secret; sessions never print secrets');
            return hers('gh auth is a login step only Yukimi can do');
        }
        return no(notRecognised(name));
    }
    case 'docker': case 'podman':
        if (args.some((w) => w.t === 'login')) return hers(`${name} login is an account step only Yukimi can do`);
        return no(notRecognised(name));
    case 'gcloud': case 'az': case 'firebase': case 'vercel': case 'netlify': case 'heroku': case 'wrangler': case 'flyctl': case 'fly': case 'supabase': case 'doctl': case 'aws':
        if (args.some((w) => /^(auth|login|configure|signup)$/.test(w.t))) return hers(`${name} login is an account step only Yukimi can do`);
        return no(notRecognised(name));
    case 'stripe': case 'paypal':
        return hers(`${name} is a money step only Yukimi can do`);
    case 'useradd': case 'adduser': case 'passwd': case 'chpasswd': case 'usermod':
        return hers(`${name} creates or changes an account, which only Yukimi can do`);

    // ---- other machines and the system
    case 'ssh': case 'scp': case 'sftp': case 'mosh': case 'ssh-keygen': case 'ssh-add': case 'ssh-agent': case 'ssh-copy-id':
        return no(`${name} reaches another machine or touches ssh keys; sessions work on this host only, ask Yukimi for remote work`);
    case 'rsync': {
        if (args.some((w) => /^[\w.-]+@[\w.-]+:|^[\w.-]+:[^/\s]|^-e$|^--rsh/.test(w.t))) return no('rsync to or from another host is not auto-approved; sessions work on this host only, ask Yukimi');
        return no(notRecognised(name));
    }
    case 'nc': case 'ncat': case 'netcat': case 'socat': case 'telnet': case 'ftp':
        return no(`${name} opens a connection to another host; sessions use curl against localhost or Yozora only`);
    case 'sudo': case 'su': case 'doas': case 'pkexec': case 'systemctl': case 'service': case 'reboot': case 'shutdown': case 'poweroff': case 'halt': case 'init': case 'telinit':
        return no(`${name} changes the whole machine, so it is never auto-approved; ask Yukimi, or do the work as the normal user inside the repo`);
    case 'pm2': {
        const sub = args[0] ? args[0].t : '';
        if (/^(restart|reload|stop|delete|kill|start|gracefulReload|reset|update|resurrect|startOrRestart|startOrReload|flush|save|unstartup|startup|install|uninstall|deploy|scale)$/.test(sub)) {
            return no(`pm2 ${sub} restarts or stops Dreamscape for every client; use scripts/reload-server-module.sh or server_reload_module for a module change, or coord_build_request for a real restart`);
        }
        if (/^(list|ls|l|status|logs|log|describe|show|jlist|prettylist|env|monit|ping|report)$/.test(sub)) {
            if (sub === 'env') return no('pm2 env prints the environment, secrets included');
            return ok('pm2 read');
        }
        return no(`pm2 ${short(sub)} is not on the auto-approve list`);
    }
    case 'curl': case 'wget': return evalCurl(name, args, st);
    case 'adb': return evalAdb(args, st, env);
    case 'tmux': return evalTmux(args);
    case 'sqlite3': return evalSqlite(args);
    case 'kill': case 'pkill': case 'killall': return evalKill(name, args, st);

    // ---- files
    case 'rm': case 'rmdir': case 'unlink': return evalRm(name, args, st);
    case 'shred': return no('shred destroys files beyond recovery; use rm on your own files below the repo');
    case 'find': return evalFind(args, st, flow, env);
    case 'sed': return evalSed(args, st);
    case 'mkdir': case 'touch': {
      const { pos } = splitFlagsArgs(args, ['-m', '--mode', '-d', '-t', '-r', '--date', '--reference']);
      return allWrite(name, pos, st);
    }
    case 'tee': {
        const { pos } = splitFlagsArgs(args);
        return allWrite('tee to', pos, st);
    }
    case 'cp': case 'mv': {
        const { flags, pos, values } = splitFlagsArgs(args, ['-t', '--target-directory', '-S', '--suffix']);
        const tFlag = values['-t'] || values['--target-directory'] || (flags.find((f) => f.t.startsWith('--target-directory=')) && { t: flags.find((f) => f.t.startsWith('--target-directory=')).t.slice(19) });
        let dest;
        let srcs;
        if (tFlag) { dest = [tFlag]; srcs = pos; } else { dest = pos.slice(-1); srcs = pos.slice(0, -1); }
        const dv = allWrite(name + ' into', dest, st);
        if (dv.d !== 'approve') return dv;
        if (name === 'mv') {
            const sv = allWrite('mv of', srcs, st);
            if (sv.d !== 'approve') return sv;
        }
        return ok(name);
    }
    case 'chmod': case 'chown': case 'chgrp': {
        const { flags, pos } = splitFlagsArgs(args);
        const paths = hasFlag(flags, '--reference') ? pos : pos.slice(1);
        const v = allWrite(name, paths, st);
        if (v.d !== 'approve') return no(`${name} reaches outside the repo and the scratchpad${hasShort(flags, 'R') ? ' (recursively)' : ''}; change permissions only on repo files`);
        return ok(name);
    }
    case 'dd': {
        const of = args.find((w) => w.t.startsWith('of='));
        if (!of) return ok('dd to stdout');
        const t = of.t.slice(3);
        if (/^\/dev\/(?!null$)/.test(t)) return no('dd of=/dev/... can overwrite a disk; never auto-approved');
        const p = expandPathStr(t, st);
        if (!p || !allowedWrite(p, st)) return no(`dd of=${short(t)} writes outside the repo and the scratchpad; ${whereMsg()}`);
        return ok('dd');
    }
    case 'mktemp': {
        const { pos, values, flags } = splitFlagsArgs(args, ['-p', '--tmpdir']);
        const cands = [];
        if (values['-p']) cands.push(values['-p']);
        const tm = flags.find((f) => f.t.startsWith('--tmpdir='));
        if (tm) cands.push({ t: tm.t.slice(9) });
        for (const w of pos) if (w.t.includes('/')) cands.push(w);
        if (!cands.length) return no('mktemp makes files in /tmp, outside the scratchpad; use mktemp -p <scratchpad dir>');
        return allWrite('mktemp in', cands, st);
    }
    case 'sort': {
        const { values, flags } = splitFlagsArgs(args, ['-o', '--output', '-T', '--temporary-directory']);
        const o = values['-o'] || values['--output'] || (flags.find((f) => f.t.startsWith('--output=')) && { t: flags.find((f) => f.t.startsWith('--output=')).t.slice(9) });
        if (o) return allWrite('sort -o', [o], st);
        return ok('sort');
    }
    case 'uniq': {
        const { pos } = splitFlagsArgs(args, ['-f', '-s', '-w']);
        if (pos.length >= 2) return allWrite('uniq output', [pos[1]], st);
        return ok('uniq');
    }
    case 'date':
        if (args.some((w) => w.t === '-s' || w.t.startsWith('--set'))) return no('date -s changes the system clock; never auto-approved');
        return ok('date');
    case 'awk': case 'gawk': {
        const prog = args.filter((w) => !w.t.startsWith('-')).map((w) => w.t).join('\n');
        if (/system\s*\(|\|\s*"|\|&|print[^\n;}]*>>?\s*["'$\w/]/.test(prog)) {
            return no('this awk program runs commands or writes files; use a plain print and redirect the output into the repo or the scratchpad');
        }
        return ok('awk');
    }
    case 'rg':
        if (args.some((w) => w.t === '--pre' || w.t.startsWith('--pre='))) return no('rg --pre runs a command on every file; drop --pre');
        return ok('rg');
    default:
        break;
    }
    if (SIMPLE_READ_CMDS.has(name)) {
        // echo of a secret variable is caught by the text scan; reading is otherwise safe
        return ok(name);
    }
    if (/^mkfs/.test(name)) return no('mkfs formats a disk; never auto-approved');
    return no(notRecognised(name));
}

function notRecognised(first) {
    return `not recognised as repo work (${short(first, 40)}); if it is needed, say why in your turn and ask Yukimi, or run it in a form the auto-approver knows (git/node/python/scripts)`;
}

// ----------------------------------------------------------------------------------------------------------- classify

function classifyRedirs(redirs, st) {
    for (const r of redirs) {
        if (/^(>>?|>\||&>>?|<>|>&)$/.test(r.op)) {
            const t = r.target;
            if (!t) return no('a redirect has no visible target; write the target path out');
            if (r.op === '>&' && /^(\d+|-)$/.test(t.t)) continue;
            if (['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty'].includes(t.t)) continue;
            const p = t.dyn ? null : expandPathStr(t.t, st);
            if (!p || !allowedWrite(p, st)) return no(`the redirect into ${short(t.t)} writes outside the repo and the scratchpad; ${whereMsg()}`);
        }
    }
    return ok();
}

function classifyWords(tk, seg, st, flow) {
    const words = tk.words.slice();
    while (words.length && KEYWORD_PREFIX.has(words[0].t) && !words[0].quoted) words.shift();
    if (!words.length) return classifyRedirs(tk.redirs, st);
    const env = {};
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0].t)) {
        const w = words.shift();
        const eq = w.t.indexOf('=');
        const nm = w.t.slice(0, eq);
        const val = w.t.slice(eq + 1);
        env[nm] = val;
        if (val === '$!') st.pidVars.push(nm);
        if ((nm === 'HUSKY' && val === '0') || nm === 'HUSKY_SKIP_HOOKS' || nm === 'SKIP_HOOKS') return no('it skips the git hooks through the environment; fix what the hook reports instead');
    }
    if (!words.length) return classifyRedirs(tk.redirs, st);
    const v = evalSimple(words, st, seg, flow, env);
    return combine([v, classifyRedirs(tk.redirs, st)]);
}

function classifySeg(seg, st, flow) {
    const out = [];
    for (const sub of seg.subs) out.push(classifyCommand(sub, childState(st)));
    const text = seg.text;
    if (text.startsWith('(')) {
        const k = findClose(text, 1);
        if (k === text.length - 1) {
            out.push(classifyCommand(text.slice(1, k), childState(st)));
            return combine(out);
        }
        out.push(no('a (...) group followed by more text cannot be checked; split it into plain commands'));
        return combine(out);
    }
    const tk = tokenize(text);
    seg.hasHeredoc = tk.redirs.some((r) => r.op === '<<' || r.op === '<<-');
    out.push(classifyWords(tk, seg, st, flow));
    return combine(out);
}

function classifyCommand(text, st) {
    if (st.depth > 8) return no('the command nests too deeply to check');
    const hd = stripHeredocs(String(text));
    const out = [];
    if (HERS_TEXT_RE.test(text)) out.push(hers('it asks for a paid step (--paid / userApprovedPaidRequest); only Yukimi approves spending'));
    for (const b of hd.bodies) {
        const v = scanBody(b.text);
        if (v) out.push(v);
        if (SHELLS.has(b.consumer)) out.push(classifyCommand(b.text, childState(st)));
    }
    const sv = scanSecrets(hd.main);
    if (sv) out.push(sv);
    const sc = scan(hd.main);
    if (sc.open) {
        out.push(no('the command has an unclosed quote or parenthesis, so it cannot be checked; fix the quoting'));
        return combine(out);
    }
    let netPipe = false;
    for (const seg of sc.segs) {
        if (seg.op !== '|') netPipe = false;
        const flow = { pipedIn: seg.op === '|', netPipe };
        out.push(classifySeg(seg, st, flow));
        if (/(^|[\s;&|(])(curl|wget)(\s|$)/.test(seg.text)) netPipe = true;
        if (seg.bg) st.bg.push(seg.text);
    }
    return combine(out);
}

function classify(commandText, opts) {
    const st = newState(makeCtx(opts));
    const v = classifyCommand(String(commandText), st);
    if (v.d === 'approve') {
        const uniq = Array.from(new Set(st.names)).slice(0, 4);
        v.why = 'repo work' + (uniq.length ? ' (' + uniq.join(', ') + ')' : '');
    }
    return v;
}

// ----------------------------------------------------------------------------------------------------------- prompt

const FOOTER_RE = /requires approval|^Command contains|^Do you want|^Permission rule|^Allow /i;

function dedent(lines) {
    let min = Infinity;
    for (const l of lines) {
        if (!l.trim()) continue;
        const m = /^[ \t]*/.exec(l)[0].length;
        if (m < min) min = m;
    }
    if (!isFinite(min)) min = 0;
    return lines.map((l) => l.slice(Math.min(min, /^[ \t]*/.exec(l)[0].length)));
}

function isComplete(text) {
    const hd = stripHeredocs(text);
    if (hd.unterminated) return false;
    if (scan(hd.main).open) return false;
    return !/(\\|&&|\|\||\|)\s*$/.test(hd.main);
}

function looksLikeDescription(line) {
    const l = line.trim();
    if (!l) return false;
    if (/^[A-Z][a-z]/.test(l) && !/[=|&;$<>`]/.test(l)) return true;
    if (/\s/.test(l) && !/[/=|&;$<>()"'\\`*~{}]/.test(l) && !KNOWN_CMDS.has(l.split(/\s+/)[0])) return true;
    return false;
}

function stripBox(l) {
    return String(l).replace(/^[\s\u2502|]*\u2502/, (m) => ' '.repeat(m.length)).replace(/[\s\u2502|]*\u2502\s*$/, '').replace(/\s+$/, '');
}

function extractBash(ctxIn) {
    const ctx = ctxIn.map(stripBox).filter((l) => l.trim() && !/^[\s\u2500-\u257f+-]+$/.test(l));
    const isFooter = (l) => /^(This command requires approval|Command contains|Do you want|Permission rule|Allow )/i.test(l.trim());
    let body = [];
    const hi = ctx.findIndex((l) => /^\s*Bash command\s*$/i.test(l));
    const from = hi >= 0 ? hi + 1 : 0;
    for (let j = from; j < ctx.length; j++) {
        if (isFooter(ctx[j])) break;
        if (hi < 0 && !/^\s/.test(ctx[j]) && ctx.some((x) => /^\s/.test(x))) continue;
        body.push(ctx[j]);
    }
    let lines = dedent(body);
    let desc = '';
    if (lines.length >= 2) {
        const last = lines[lines.length - 1];
        const head = lines.slice(0, -1).join('\n');
        if (isComplete(head) && looksLikeDescription(last)) { desc = last.trim(); lines = lines.slice(0, -1); }
    }
    return { text: lines.join('\n'), desc };
}

function mk(decision, kind, reason, command, extra) {
    const r = {
        decision,
        kind,
        reason: String(reason || '').replace(/[^\x20-\x7e]/g, '?'),
        command: maskSecrets(String(command == null ? '' : command).replace(/\n+/g, ' ; ')),
        approveN: 1,
        declineN: 2,
    };
    if (extra) Object.assign(r, extra);
    return r;
}

function editVerdict(rawPath, cx) {
    const st = newState(cx);
    const t = String(rawPath || '').trim().replace(/^["'`]|["'`]$/g, '');
    if (!t) return no('the edit target path could not be read; ask Yukimi');
    const p = expandPathStr(t, st);
    if (!p) return no(`the edit target ${short(t)} cannot be resolved; use a path inside the repo`);
    for (const [re, label] of SECRET_PATH_RES.slice(0, 15)) {
        if (re.test(p)) return no(`${short(t)} is a secrets file (${label}); sessions never edit secrets, ask Yukimi`);
    }
    if (hasGitSegment(p)) return no(`${short(t)} is inside .git; change repo files with git commands, not by editing .git`);
    if (/\/\.claude\/settings(\.local)?\.json$/.test(p)) return no('Claude permission settings are not edited by sessions; ask Yukimi');
    if (!allowedWrite(p, st)) return no(`editing ${short(t)} reaches outside the repo (${cx.repoRoot}) and the scratchpad; do the work inside the repo or ask Yukimi`);
    return ok('edit inside the repo');
}

function toolVerdict(ctxText, ctxLines) {
    let server = null;
    let tool = null;
    let m = /mcp__([A-Za-z0-9_.-]+?)__([A-Za-z0-9_.-]+)/.exec(ctxText);
    if (m) { server = m[1]; tool = m[2]; }
    else {
        m = /^\s*([A-Za-z0-9_.-]+)\s+-\s+([A-Za-z0-9_.-]+)\s*(?:\(|$)/m.exec(ctxLines.filter((l) => !/^\s*Tool use\s*$/i.test(l)).join('\n'));
        if (m) { server = m[1]; tool = m[2]; }
    }
    if (!server) return { v: no('the MCP tool name could not be read from the prompt; ask for it explicitly'), name: '' };
    const name = `mcp__${server}__${tool}`;
    if (HERS_TEXT_RE.test(ctxText) || /(purchase|billing|checkout|payment|subscribe)/i.test(tool) || tool === 'create_organization') {
        return { v: hers(`${name} is a paid, billing or account step only Yukimi can do`), name };
    }
    for (const re of TOKEN_VALUE_RES) {
        if (re.test(ctxText)) return { v: no(`${name} is called with a literal token or key; keep secret values out of tool arguments`), name };
    }
    const s = server.toLowerCase();
    if (s === 'agent-coord') return { v: ok('agent-coord tool'), name };
    if (s === 'yozora') {
        if (tool === 'repo_write' && /\bdelete\b/i.test(ctxText)) return { v: no('deleting a repository is not auto-approved; ask Yukimi'), name };
        return { v: ok('Yozora tool'), name };
    }
    if (s === 'dreamscape' && /^(get|list|search)_/.test(tool)) return { v: ok('Dreamscape read tool'), name };
    return { v: no(`${name} is not on the auto-approve list; ask for it explicitly`), name };
}

function fetchVerdict(url) {
    for (const re of TOKEN_VALUE_RES) if (re.test(url)) return no('the URL contains a literal token or key; keep secret values out of URLs');
    if (/[?&](token|key|secret|password|api_?key|access_token)=/i.test(url)) return no('the URL carries a secret in its query; keep secret values out of URLs');
    return urlHostVerdict(url, 'fetching');
}

function decideInner(prompt, opts) {
    const cx = makeCtx(opts);
    const q = String(prompt.question || '').trim();
    const ctx = (Array.isArray(prompt.context) ? prompt.context : []).map((l) => String(l).replace(/\s+$/, '')).filter((l) => l.trim());
    const ctxText = ctx.join('\n');
    const options = Array.isArray(prompt.options) ? prompt.options : [];
    let kind = 'other';
    let res;
    let command = '';

    const em = /^Do you want to (?:make this edit to|create|overwrite|write to)\s+(.+?)\s*\??$/i.exec(q);
    const fm = /allow Claude to fetch this content from\s+(\S+?)\s*\??$/i.exec(q);
    const header = ctx.length ? ctx[0].trim() : '';
    const bashHeader = /^Bash command\b/i.test(header);
    const otherHeader = /^(Edit|Create|Write|Read|Fetch|Search|Web|Skill|Use skill|Notebook|Plan|Task|Agent)\b/i;
    if (em) kind = 'edit';
    else if (fm) kind = 'fetch';
    else if (bashHeader) kind = 'bash';
    else if (/^Tool use\b/i.test(header) || /mcp__[\w.-]+__[\w.-]+/.test(ctxText) || /\(MCP\)/.test(ctxText)) kind = 'tool';
    else if (/^(Edit|Create|Write|Overwrite) file\b/i.test(header)) kind = 'edit';
    else if (/^Fetch\b/i.test(header)) kind = 'fetch';
    else if (/requires approval/i.test(ctxText) || (/^Do you want to proceed/i.test(q) && ctx.length && !otherHeader.test(header))) kind = 'bash';

    if (kind === 'edit') {
        let target = em ? em[1] : '';
        if (!target) {
            const ln = ctx.slice(1).find((l) => l.trim());
            target = ln ? ln.trim() : '';
        }
        command = target;
        res = editVerdict(target, cx);
    } else if (kind === 'fetch') {
        let url = fm ? fm[1] : '';
        if (!url) { const m = /https?:\/\/\S+/.exec(ctxText); url = m ? m[0] : ''; }
        command = url;
        res = url ? fetchVerdict(url) : no('the fetch URL could not be read from the prompt; ask Yukimi');
    } else if (kind === 'tool') {
        const r = toolVerdict(ctxText, ctx);
        res = r.v;
        command = ctx.filter((l) => !/^\s*Tool use\s*$/i.test(l)).map((l) => l.trim()).join(' ');
    } else if (kind === 'bash') {
        const ex = extractBash(ctx);
        command = ex.text;
        if (!ex.text.trim()) res = no('the command text could not be read from the prompt; ask Yukimi');
        else {
            const st = newState(cx);
            res = classifyCommand(ex.text, st);
            if (res.d === 'approve' && ex.desc) {
                const dv = scanSecrets(ex.desc) || scanBody(ex.desc) || (HERS_TEXT_RE.test(ex.desc) ? hers('it asks for a paid step (--paid / userApprovedPaidRequest); only Yukimi approves spending') : null);
                if (dv) res = dv;
            }
            if (res.d === 'approve') {
                const uniq = Array.from(new Set(st.names)).slice(0, 4);
                res = ok('repo work' + (uniq.length ? ' (' + uniq.join(', ') + ')' : ''));
            }
        }
    } else {
        const first = (header || q).split(/\s+/)[0] || 'unknown';
        command = header || q;
        res = no(notRecognised(first));
    }

    const extra = {};
    if (options.length) {
        const yes = options.find((o) => /^yes\b/i.test(String(o.text || '')));
        const noOpt = options.find((o) => /^no\b/i.test(String(o.text || '')));
        if (yes) extra.approveN = Number(yes.n) || 1;
        if (noOpt) extra.declineN = Number(noOpt.n) || 2;
        if (!yes && res.d === 'approve') res = hers('the prompt is not a plain Yes/No permission question; left for Yukimi');
    }
    return mk(res.d, kind, res.why, command, extra);
}

function decide(prompt, opts) {
    try {
        return decideInner(prompt || {}, opts || {});
    } catch (e) {
        return mk('hers', 'other', 'the auto-approver could not read this prompt (' + short(e && e.message, 60) + '); left for Yukimi', '');
    }
}

module.exports = { decide, splitCommand, classify, maskSecrets };
require('./hotReload').mark(module);
