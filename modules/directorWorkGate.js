'use strict';

/**
 * The Director's work gate (#1275). Yozora (modules/xiDirector.js) is the Director's front: she reads, plans,
 * briefs and follows up; the Supervisor's Fleet sessions change the code. Prose alone did not hold her to that
 * (she edited and built inline), so the Claude CLI turn carries two hooks that run this file:
 *   pre-tool  refuses every write-shaped tool call (edit tools, git that changes anything, builds, restarts, ...)
 *   stop      once per turn, stops her from ending a work request without handing it to the Supervisor
 *             (claude_dispatch / fleet_work_update / fleet_work_start) and naming the work item in her reply.
 *
 * It runs as a short-lived hook process on every Bash call: only fs and path are required, nothing is polled,
 * and the transcript is read once, from its tail. Any internal error fails open (stderr line, exit 0, no output):
 * a broken gate must not brick her reads.
 */

const fs = require('fs');

const REFUSAL = 'Yozora does not change the tree, build or restart: hand this to the Supervisor with claude_dispatch '
    + '(issue, files, acceptance check), or fleet_work_update an existing item.';
const refusal = (rule) => `${REFUSAL} Refused: ${rule}.`;

// ---------------------------------------------------------------------------------------------------------------
// classifyRequest: is this user request work for the Supervisor?
// ---------------------------------------------------------------------------------------------------------------

const GREETING_PREFIX = /^(?:(?:hi|hey|hello|yo|ok|okay|so|well|yozora|please)\b[\s,.:!-]*)+/i;
const QUESTION_START = /^(?:what|why|how|where|when|who|which|is|are|does|did|do (?:you|i|we|they)|can you explain|could you tell)\b/i;
const STATUS_WORDS = /\b(?:going|status|progress|running|queue|queued|work item)\b/i;
// a "strong" imperative: still work when it sits inside a question ("can you fix modules/foo.js?")
const STRONG_VERB = /\b(?:fix|implement|change|add|build|deploy|restart|refactor|remove|rename|update)\b/i;
const WORK_VERB = new RegExp('\\b(?:fix|repair|implement|add|change|update|edit|modify|refactor|rewrite|rename|remove|delete|build|'
    + 'deploy|ship|restart|install|migrate|port|wire up|hook up|create|bump|upgrade|patch|commit|push|merge|revert|'
    + 'make (?:it|this|that|the|them|these)|write (?:me )?(?:an? |the |some )?(?:\\w+ )?(?:test|script|module)s?)\\b', 'i');
const FILE_RE = /(?:^|[\s"'`(\[])((?:[\w.-]+\/)*[\w-][\w.-]*\.(?:js|mjs|cjs|ts|tsx|jsx|kt|kts|java|py|css|scss|html|json|md|mdc|sh|ps1|yml|yaml|xml|gradle|sql|toml|txt))\b/gi;
const NOT_A_FILE = /^(?:node|next|vue|three|express|react|d3)\.js$/i;
const DIR_RE = /\b(?:modules|public|scripts|apps|services|docs)\/[\w.-]+/i;
const ISSUE_RE = /(?:\bissues\/\d+|#\d+\b|\b[\w.-]+#\d+\b)/;
const BUG_RE = /\b(?:bug|broken|crash(?:es|ed|ing)?|errors?|regression|fail(?:s|ed|ing)?|not working|doesn'?t work|does not work|throws?|threw|exception|hangs?|freezes?)\b/i;

function namesRealFile(text) {
    FILE_RE.lastIndex = 0;
    let m;
    while ((m = FILE_RE.exec(text))) {
        const base = m[1].split('/').pop();
        if (!NOT_A_FILE.test(base)) return true;
    }
    return DIR_RE.test(text);
}

function classifyRequest(text) {
    const raw = String(text || '').trim();
    if (!raw) return { work: false, why: 'empty request' };
    // "hi Yozora, ..." is greeting, not part of the request; "the update on #12" is a noun, not the verb
    const cleaned = raw.replace(GREETING_PREFIX, '').replace(/\b(?:the|any|an|latest|no)\s+updates?\b/gi, ' ').trim();
    const startsQuestion = QUESTION_START.test(cleaned);
    const isQuestion = startsQuestion || /\?\s*$/.test(raw);
    const strong = STRONG_VERB.test(cleaned);
    if (startsQuestion && STATUS_WORDS.test(cleaned)) return { work: false, why: 'status read' };
    if (isQuestion && !strong) return { work: false, why: 'question with no imperative' };
    const anchored = namesRealFile(cleaned) || ISSUE_RE.test(cleaned) || BUG_RE.test(cleaned);
    if (WORK_VERB.test(cleaned) && anchored) return { work: true, why: 'work verb with a technical anchor' };
    if (BUG_RE.test(cleaned) && namesRealFile(cleaned)) return { work: true, why: 'bug report naming a file' };
    return { work: false, why: 'no work verb with a technical anchor' };
}

// ---------------------------------------------------------------------------------------------------------------
// bashGuard: refuse write-shaped shell. Parse every simple command of a pipeline / list / substitution, then
// judge each. Read-shaped commands (and anything not named below) pass.
// ---------------------------------------------------------------------------------------------------------------

function newCmd() { return { words: [], redirs: [], stdin: '', hasHere: false }; }

/** Parse shell text into simple commands (words, redirects, heredoc body), recursing into $( ), ` ` and <( ). */
function parseShell(src, out, depth) {
    if (depth > 8) return;
    const P = { s: String(src), i: 0 };
    parseList(P, out, depth, false);
}

function scanSubstitutions(body, out, depth) {
    let at = 0;
    for (;;) {
        const d = body.indexOf('$(', at);
        const b = body.indexOf('`', at);
        if (d < 0 && b < 0) return;
        if (d >= 0 && (b < 0 || d < b)) {
            const P = { s: body, i: d + 2 };
            parseList(P, out, depth + 1, true);
            at = Math.max(P.i, d + 2);
        } else {
            const e = body.indexOf('`', b + 1);
            if (e < 0) return;
            parseShell(body.slice(b + 1, e), out, depth + 1);
            at = e + 1;
        }
    }
}

function parseList(P, out, depth, inParen) {
    const s = P.s;
    let cmd = newCmd();
    let w = '';
    let inW = false;
    let wQuoted = false;
    let pendingRedir = null;
    let pendingHere = null;
    let par = 0;
    const heredocs = [];

    const endWord = () => {
        if (!inW) return;
        if (pendingRedir) { cmd.redirs.push({ op: pendingRedir, target: w }); pendingRedir = null; }
        else if (pendingHere) { heredocs.push({ cmd, delim: w, quoted: wQuoted, strip: pendingHere.strip }); cmd.hasHere = true; pendingHere = null; }
        else cmd.words.push(w);
        w = ''; inW = false; wQuoted = false;
    };
    const endCmd = () => {
        endWord();
        pendingRedir = null; pendingHere = null;
        if (cmd.words.length || cmd.redirs.length || cmd.hasHere) out.push(cmd);
        cmd = newCmd();
    };

    while (P.i < s.length) {
        const c = s[P.i];
        if (c === '\\') {
            const n = s[P.i + 1];
            if (n === '\n') { P.i += 2; continue; }
            if (n !== undefined) { w += n; inW = true; }
            P.i += 2;
        } else if (c === "'") {
            const e = s.indexOf("'", P.i + 1);
            const stop = e < 0 ? s.length : e;
            w += s.slice(P.i + 1, stop); inW = true; wQuoted = true;
            P.i = stop + 1;
        } else if (c === '"') {
            P.i++; inW = true; wQuoted = true;
            while (P.i < s.length && s[P.i] !== '"') {
                const d = s[P.i];
                if (d === '\\' && P.i + 1 < s.length) { w += s[P.i + 1]; P.i += 2; }
                else if (d === '$' && s[P.i + 1] === '(') { P.i += 2; parseList(P, out, depth + 1, true); w += '$(..)'; }
                else if (d === '`') {
                    const e = s.indexOf('`', P.i + 1);
                    const stop = e < 0 ? s.length : e;
                    parseShell(s.slice(P.i + 1, stop), out, depth + 1);
                    w += '$(..)'; P.i = stop + 1;
                } else { w += d; P.i++; }
            }
            P.i++;
        } else if (c === '$' && s[P.i + 1] === '(') {
            P.i += 2; parseList(P, out, depth + 1, true); w += '$(..)'; inW = true;
        } else if (c === '`') {
            const e = s.indexOf('`', P.i + 1);
            const stop = e < 0 ? s.length : e;
            parseShell(s.slice(P.i + 1, stop), out, depth + 1);
            w += '$(..)'; inW = true; P.i = stop + 1;
        } else if (c === '#' && !inW) {
            while (P.i < s.length && s[P.i] !== '\n') P.i++;
        } else if (c === ' ' || c === '\t' || c === '\r') {
            endWord(); P.i++;
        } else if (c === '\n') {
            endCmd();
            let pos = P.i + 1;
            while (heredocs.length) {
                const h = heredocs.shift();
                const lines = [];
                while (pos <= s.length) {
                    const nl = s.indexOf('\n', pos);
                    const line = nl < 0 ? s.slice(pos) : s.slice(pos, nl);
                    const cmp = h.strip ? line.replace(/^\t+/, '') : line;
                    if (cmp === h.delim) { pos = nl < 0 ? s.length : nl + 1; break; }
                    lines.push(line);
                    if (nl < 0) { pos = s.length; break; }
                    pos = nl + 1;
                }
                const body = `${lines.join('\n')}\n`;
                h.cmd.stdin += body;
                if (!h.quoted) scanSubstitutions(body, out, depth);
            }
            P.i = pos;
        } else if (c === ';') {
            endCmd(); P.i++;
        } else if (c === '&') {
            if (s[P.i + 1] === '>') {
                endWord();
                pendingRedir = s[P.i + 2] === '>' ? '&>>' : '&>';
                P.i += pendingRedir.length;
            } else { endCmd(); P.i += s[P.i + 1] === '&' ? 2 : 1; }
        } else if (c === '|') {
            endCmd(); P.i += (s[P.i + 1] === '|' || s[P.i + 1] === '&') ? 2 : 1;
        } else if (c === '(') {
            endCmd(); par++; P.i++;
        } else if (c === ')') {
            endCmd(); P.i++;
            if (par > 0) par--;
            else if (inParen) return;
        } else if (c === '<' || c === '>') {
            if (s[P.i + 1] === '(') {
                P.i += 2; parseList(P, out, depth + 1, true); w += '$(..)'; inW = true;
                continue;
            }
            if (inW && !wQuoted && /^\d+$/.test(w)) { w = ''; inW = false; } else endWord();
            let op;
            if (c === '>') op = s[P.i + 1] === '>' ? '>>' : (s[P.i + 1] === '|' ? '>|' : (s[P.i + 1] === '&' ? '>&' : '>'));
            else if (s.startsWith('<<<', P.i)) op = '<<<';
            else if (s.startsWith('<<-', P.i)) op = '<<-';
            else if (s.startsWith('<<', P.i)) op = '<<';
            else op = s[P.i + 1] === '&' ? '<&' : (s[P.i + 1] === '>' ? '<>' : '<');
            P.i += op.length;
            if (op === '<<' || op === '<<-') pendingHere = { strip: op === '<<-' };
            else pendingRedir = op;
        } else {
            w += c; inW = true; P.i++;
        }
    }
    endCmd();
}

const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'for', 'case', 'esac', 'in', 'select', 'time', '!', '{', '}', 'function']);

const ALWAYS_DENY = new Set([
    'rm', 'rmdir', 'mv', 'cp', 'mkdir', 'touch', 'ln', 'chmod', 'chown', 'chgrp', 'truncate', 'dd', 'install', 'patch', 'zip',
    'npm', 'pnpm', 'yarn', 'npx', 'node-gyp', 'gradle', 'gradlew', 'make', 'docker', 'docker-compose', 'pm2', 'systemctl', 'service',
    'kill', 'pkill', 'killall', 'rsync', 'scp', 'sftp', 'ssh', 'crontab', 'reboot', 'shutdown', 'poweroff', 'halt',
    'apt', 'apt-get', 'dpkg', 'pip', 'pip3', 'cargo', 'mvn', 'sponge', 'vi', 'vim', 'nano', 'emacs', 'ed', 'ex',
    'mkfifo', 'mknod', 'shred', 'useradd', 'usermod', 'passwd', 'mount', 'umount'
]);
const SHELLS = new Set(['bash', 'sh', 'dash', 'zsh', 'ksh']);
const SYSTEM_BIN = /^\/(?:usr\/(?:local\/)?(?:s?bin)|s?bin)\//;
const RESTART_NAME = /^(?:restart|reload-server-module|restart-gate|restart-dreamscape)/i;
const GIT_READ = new Set(['log', 'show', 'diff', 'status', 'blame', 'grep', 'branch', 'rev-parse', 'ls-files', 'ls-tree', 'ls-remote',
    'cat-file', 'show-ref', 'describe', 'shortlog', 'rev-list', 'merge-base', 'reflog', 'for-each-ref', 'remote', 'tag', 'stash',
    'config', 'worktree', 'name-rev', 'count-objects', 'whatchanged', 'diff-tree', 'diff-index', 'diff-files', 'check-ignore',
    'var', 'help', 'version', 'verify-commit', 'verify-tag', 'range-diff', 'cherry', 'show-branch', 'annotate', 'fsck']);
const ADB_READ = new Set(['devices', 'version', 'help', 'get-state', 'get-serialno', 'get-devpath', 'start-server', 'track-devices']);

const NODE_WRITE = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|writeSync|unlink|unlinkSync|rmSync|rmdir|rmdirSync|mkdir|mkdirSync|rename|renameSync|copyFile|copyFileSync|cpSync|createWriteStream|truncate|chmod|chown|symlink|utimes|child_process|execSync|spawnSync|execFileSync|execFile)\b|process\.kill|\bfs\.rm\b/;
const PY_WRITE = /\bopen\s*\([^)]*,\s*(?:mode\s*=\s*)?['"][^'"]*[wax+][^'"]*['"]|\bos\.(?:system|remove|unlink|rename|replace|rmdir|mkdir|makedirs|popen|chmod|chown|kill)\b|\bsubprocess\b|\bshutil\b|\bwrite_text\b|\bwrite_bytes\b|\.(?:unlink|mkdir|rmdir|rename|touch)\s*\(/;
const PERL_WRITE = /\b(?:unlink|rename|mkdir|rmdir|system|exec)\b|`|\bopen\s*\([^)]*['"]\s*[>+]/;
const AWK_WRITE = /\bsystem\s*\(|\bprintf?\b[^;}()\n]*>>?|\|\s*"/;

function scanCode(code, re, lang) {
    const m = re.exec(String(code || ''));
    return m ? `${lang} code that writes (${m[0].trim().slice(0, 40)})` : null;
}

/** Write targets that need no hand-over: scratch only. */
function safeTarget(t) {
    if (t === '/dev/null' || t === '/dev/stdout' || t === '/dev/stderr' || /^\/dev\/fd\/\d+$/.test(t)) return true;
    if (/(^|\/)\.\.(\/|$)/.test(t)) return false;
    return /^\/tmp\/./.test(t) || /^\$\{?TMPDIR\}?\/./.test(t);
}
const safeTmp = (t) => t === '/dev/null' || (/^\/dev\//.test(t) ? false : safeTarget(t));

const isFlag = (a) => typeof a === 'string' && a.length > 1 && a[0] === '-';
const clusterHas = (a, letters) => /^-[A-Za-z]/.test(a) && !a.startsWith('--') && new RegExp(`^-[A-Za-z]*[${letters}]`).test(a);

function baseName(w) {
    return String(w).split('/').pop();
}

function checkGit(args) {
    let i = 0;
    while (i < args.length && isFlag(args[i])) {
        i += (args[i] === '-C' || args[i] === '-c' || args[i] === '--git-dir' || args[i] === '--work-tree' || args[i] === '--namespace') ? 2 : 1;
    }
    const sub = args[i];
    if (!sub) return null;
    const rest = args.slice(i + 1);
    if (!GIT_READ.has(sub)) return `git ${sub}`;
    if (rest.some((a) => /^--output(=|$)/.test(a))) return `git ${sub} --output`;
    const flags = rest.filter(isFlag);
    const positional = rest.filter((a) => !isFlag(a));
    if (sub === 'branch') {
        if (flags.some((a) => /^--(delete|move|copy|set-upstream-to|unset-upstream|force|edit-description|track|no-track|create-reflog)\b/.test(a) || /^-[a-zA-Z]*[dDmMcCuft]/.test(a) && !a.startsWith('--'))) return 'git branch (create, delete, rename or set)';
        const listing = flags.some((a) => /^--(list|show-current|contains|no-contains|merged|no-merged|points-at|all|remotes)\b/.test(a) || /^-[a-zA-Z]*[larv]/.test(a) && !a.startsWith('--'));
        if (positional.length && !listing) return 'git branch <name> (creates a branch)';
    } else if (sub === 'tag') {
        if (flags.some((a) => /^--(delete|annotate|sign|local-user|force|message|file|edit)\b/.test(a) || /^-[a-zA-Z]*[dasufmFe]/.test(a) && !a.startsWith('--'))) return 'git tag (create or delete)';
        const listing = flags.some((a) => /^--(list|contains|no-contains|points-at|merged|no-merged)\b/.test(a) || /^-[a-zA-Z]*[ln]/.test(a) && !a.startsWith('--'));
        if (positional.length && !listing) return 'git tag <name> (creates a tag)';
    } else if (sub === 'stash') {
        if (!['list', 'show'].includes(positional[0])) return 'git stash (not list / show)';
    } else if (sub === 'config') {
        if (flags.some((a) => /^--(add|unset|unset-all|replace-all|edit|rename-section|remove-section|set)\b|^-e$/.test(a))) return 'git config (write)';
        const reads = flags.some((a) => /^--(get|get-all|get-regexp|get-urlmatch|list|show-origin|show-scope)\b|^-l$/.test(a)) || ['get', 'list'].includes(positional[0]);
        if (!reads && positional.length > 1) return 'git config <key> <value> (write)';
    } else if (sub === 'remote') {
        if (positional.length && !['show', 'get-url'].includes(positional[0])) return 'git remote (change)';
    } else if (sub === 'worktree') {
        if (positional[0] !== 'list') return 'git worktree (not list)';
    } else if (sub === 'reflog') {
        if (positional.some((a) => ['expire', 'delete'].includes(a))) return 'git reflog expire / delete';
    }
    return null;
}

function checkCurl(args) {
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (/^--(output|dump-header|cookie-jar|trace|trace-ascii|stderr|libcurl)(=|$)/.test(a)) {
            const t = a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[i + 1];
            if (!(t === '-' || safeTmp(t || ''))) return `curl ${a.split('=')[0]} outside /tmp`;
        } else if (/^--(remote-name|remote-name-all|remote-header-name|create-dirs)\b/.test(a)) {
            return `curl ${a}`;
        } else if (a[0] === '-' && a[1] !== '-') {
            for (let k = 1; k < a.length; k++) {
                const ch = a[k];
                if (ch === 'O' || ch === 'J') return `curl -${ch} (saves into the working folder)`;
                if (ch === 'o' || ch === 'D' || ch === 'c') {
                    const attached = a.slice(k + 1);
                    const t = attached || args[i + 1] || '';
                    if (!(t === '-' || safeTmp(t))) return `curl -${ch} outside /tmp`;
                    break;
                }
                if ('AbCdeEFHKmPQrTuUwxXyYzt'.includes(ch)) break;
            }
        }
    }
    return null;
}

function checkTar(args) {
    let modes = '';
    let file = null;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--extract' || a === '--get' || a === '--append' || a === '--update' || a === '--delete' || a === '--concatenate') return `tar ${a}`;
        if (a === '--create') modes += 'c';
        else if (/^--file(=|$)/.test(a)) file = a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[i + 1];
        else if ((i === 0 && !isFlag(a)) || (isFlag(a) && !a.startsWith('--'))) {
            const letters = a.replace(/^-/, '');
            modes += letters;
            if (letters.includes('f')) file = args[i + 1];
        }
    }
    if (/[xruA]/.test(modes)) return 'tar (extract / modify)';
    if (modes.includes('c') && !(file === '-' || safeTmp(file || '-'))) return 'tar -c to a file outside /tmp';
    return null;
}

/** Judge one simple command. Returns the rule that refuses it, or null. */
function checkWords(words, cmd, depth) {
    if (depth > 8) return null;
    let w = words.slice();
    while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || RESERVED.has(w[0]))) w.shift();
    if (!w.length) return null;
    const first = w[0];
    if (first.includes('$')) return 'a command named by a variable or substitution';
    if (first.includes('/') && !SYSTEM_BIN.test(first)) return `run a file (${first.slice(0, 60)})`;
    const name = baseName(first);
    const args = w.slice(1);
    if (RESTART_NAME.test(name)) return `restart script (${name})`;
    if (/\.sh$/.test(name)) return `run a file (${name})`;
    if (ALWAYS_DENY.has(name)) return name;

    switch (name) {
    case 'env': {
        let i = 0;
        while (i < args.length) {
            if (/^(-u|-C|-S|--unset|--chdir)$/.test(args[i])) i += 2;
            else if (isFlag(args[i]) || /^[A-Za-z_]\w*=/.test(args[i])) i++;
            else break;
        }
        return checkWords(args.slice(i), cmd, depth + 1);
    }
    case 'sudo': case 'doas': {
        let i = 0;
        while (i < args.length && isFlag(args[i])) i += /^-[ugChprtUDR]$/.test(args[i]) ? 2 : 1;
        return checkWords(args.slice(i), cmd, depth + 1);
    }
    case 'nohup': case 'exec': case 'builtin': case 'setsid': case 'stdbuf': case 'unbuffer': case 'time': {
        let i = 0;
        while (i < args.length && isFlag(args[i])) i++;
        return checkWords(args.slice(i), cmd, depth + 1);
    }
    case 'nice': case 'ionice': case 'chrt': case 'taskset': {
        let i = 0;
        while (i < args.length && isFlag(args[i])) i += /^-[ncp]$/.test(args[i]) ? 2 : 1;
        return checkWords(args.slice(i), cmd, depth + 1);
    }
    case 'command': {
        if (args.some((a) => /^-[vV]$/.test(a))) return null;
        let i = 0;
        while (i < args.length && isFlag(args[i])) i++;
        return checkWords(args.slice(i), cmd, depth + 1);
    }
    case 'timeout': {
        let i = 0;
        while (i < args.length && isFlag(args[i])) i += /^-[sk]$/.test(args[i]) ? 2 : 1;
        i++; // the duration
        return checkWords(args.slice(i), cmd, depth + 1);
    }
    case 'xargs': {
        let i = 0;
        while (i < args.length && isFlag(args[i])) i += /^-(I|n|P|L|d|E|s|a)$/.test(args[i]) ? 2 : 1;
        return checkWords(args.slice(i), cmd, depth + 1);
    }
    case 'eval': {
        const inner = [];
        parseShell(args.join(' '), inner, depth + 1);
        return checkCommands(inner, depth + 1);
    }
    case 'source': case '.':
        return /\.sh$/.test(args[0] || '') ? `source ${args[0]}` : null;
    case 'tee':
        return args.filter((a) => !isFlag(a)).every((a) => a === '/dev/null') ? null : 'tee';
    case 'sed': case 'yq': case 'ruby':
        if (args.some((a) => a === '--in-place' || /^--in-place=/.test(a) || (a[0] === '-' && a[1] !== '-' && /^-[A-Za-z]*i/.test(a)))) return `${name} -i (edits a file in place)`;
        return null;
    case 'perl': {
        if (args.some((a) => /^-[A-Za-z]*i/.test(a) && !a.startsWith('--'))) return 'perl -i (edits a file in place)';
        const e = args.findIndex((a) => /^-[A-Za-z]*e$/.test(a));
        return e >= 0 ? scanCode(args[e + 1], PERL_WRITE, 'perl') : null;
    }
    case 'awk': case 'gawk': case 'mawk': case 'nawk': {
        if (args.some((a, i) => /^-i(nplace)?$/.test(a) || a === '-iinplace' || (a === '-i' && args[i + 1] === 'inplace'))) return 'awk -i inplace';
        const prog = args.find((a) => !isFlag(a));
        return scanCode(prog, AWK_WRITE, 'awk');
    }
    case 'sort':
        return args.some((a) => a === '-o' || /^--output/.test(a) || (/^-[a-zA-Z]*o/.test(a) && !a.startsWith('--'))) ? 'sort -o (writes a file)' : null;
    case 'find':
        return args.find((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(a)) ? `find ${args.find((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(a))}` : null;
    case 'curl':
        return checkCurl(args);
    case 'wget': {
        const i = args.findIndex((a) => /^-[A-Za-z]*O/.test(a) || /^--output-document/.test(a));
        if (i < 0) return 'wget (saves into the working folder)';
        const a = args[i];
        const t = a.includes('=') ? a.slice(a.indexOf('=') + 1) : (a.replace(/^-[A-Za-z]*O/, '') || args[i + 1]);
        return (t === '-' || safeTmp(t || '')) ? null : 'wget -O outside /tmp';
    }
    case 'tar':
        return checkTar(args);
    case 'gzip': case 'gunzip': case 'bzip2': case 'bunzip2': case 'xz': case 'unxz': case 'zstd': case 'unzstd': case 'lz4':
        return args.some((a) => /^--(stdout|to-stdout|test|list)$/.test(a) || /^-[A-Za-z]*[ctl]/.test(a) && !a.startsWith('--')) ? null : name;
    case 'unzip':
        return args.some((a) => /^-[A-Za-z]*[lpt]/.test(a)) ? null : 'unzip';
    case 'adb': {
        let i = 0;
        while (i < args.length && isFlag(args[i])) i += /^-[sHPt]$/.test(args[i]) ? 2 : 1;
        return ADB_READ.has(args[i]) || args[i] === undefined ? null : `adb ${args[i]}`;
    }
    case 'git':
        return checkGit(args);
    case 'node': case 'nodejs': {
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === '--check' || a === '-c' || a === '-v' || a === '--version' || a === '-h' || a === '--help') return null;
            if (a === '-e' || a === '--eval' || a === '-p' || a === '--print') return scanCode(args[i + 1], NODE_WRITE, 'node');
            if (/^--(eval|print)=/.test(a)) return scanCode(a.slice(a.indexOf('=') + 1), NODE_WRITE, 'node');
            if (/^(-r|--require|--import|--loader|--experimental-loader|--env-file)$/.test(a)) { i++; continue; }
            if (a === '-') return cmd && cmd.hasHere ? scanCode(cmd.stdin, NODE_WRITE, 'node') : 'node reading a script from stdin';
            if (isFlag(a)) continue;
            const script = baseName(a);
            if (!/^check-/.test(script)) return `node ${script}`;
            if (args.slice(i + 1).some((x) => /^--(update|write|fix|apply|save|baseline|force|reset)\b/.test(x))) return `node ${script} (writes)`;
            return null;
        }
        return cmd && cmd.hasHere ? scanCode(cmd.stdin, NODE_WRITE, 'node') : 'node reading a script from stdin';
    }
    case 'python': case 'python2': case 'python3': {
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === '-V' || a === '--version' || a === '-h' || a === '--help') return null;
            if (a === '-c') return scanCode(args[i + 1], PY_WRITE, 'python');
            if (a === '-m') return args[i + 1] === 'json.tool' ? null : `python -m ${args[i + 1] || ''}`.trim();
            if (a === '-') return cmd && cmd.hasHere ? scanCode(cmd.stdin, PY_WRITE, 'python') : 'python reading a script from stdin';
            if (isFlag(a)) continue;
            return `python ${baseName(a)}`;
        }
        return cmd && cmd.hasHere ? scanCode(cmd.stdin, PY_WRITE, 'python') : 'python reading a script from stdin';
    }
    default:
    }
    if (SHELLS.has(name)) {
        let i = 0;
        let script = null;
        let run = false;
        let syntax = false;
        for (; i < args.length; i++) {
            const a = args[i];
            if (isFlag(a)) {
                if (!a.startsWith('--') && /^-[A-Za-z]*c/.test(a)) { run = true; script = args[i + 1]; break; }
                if (!a.startsWith('--') && /^-[A-Za-z]*n/.test(a)) syntax = true;
                continue;
            }
            return `${name} ${baseName(a)} (runs a file)`;
        }
        if (syntax) return null;
        const inner = [];
        if (run) parseShell(script || '', inner, depth + 1);
        else if (cmd && cmd.hasHere) parseShell(cmd.stdin, inner, depth + 1);
        else return `${name} reading a script from stdin`;
        return checkCommands(inner, depth + 1);
    }
    return null;
}

function checkCommands(cmds, depth) {
    for (const cmd of cmds) {
        for (const r of cmd.redirs) {
            if (!['>', '>>', '>|', '&>', '&>>', '<>', '>&'].includes(r.op)) continue;
            if (r.op === '>&' && /^(\d+|-)$/.test(r.target)) continue;
            if (!safeTarget(r.target)) return `redirect ${r.op} ${r.target.slice(0, 60)}`;
        }
        const rule = checkWords(cmd.words, cmd, depth);
        if (rule) return rule;
    }
    return null;
}

function bashGuard(command) {
    const text = String(command == null ? '' : command);
    if (!text.trim()) return { deny: false };
    const cmds = [];
    parseShell(text, cmds, 0);
    const rule = checkCommands(cmds, 0);
    return rule ? { deny: true, reason: refusal(rule) } : { deny: false };
}

// ---------------------------------------------------------------------------------------------------------------
// stopGate: one nudge per turn, then she may end it.
// ---------------------------------------------------------------------------------------------------------------

const HANDOVER_TOOLS = new Set(['claude_dispatch', 'fleet_work_update', 'fleet_work_start', 'claude_session_send']);
const ESCAPE_TOOL = 'request_form';
const NO_HANDOVER = 'This request is work for the Supervisor, and this turn has not handed it over. Call claude_dispatch with a complete brief '
    + '(the Yozora issue, the files, the acceptance check; coord_claim before editing, coord_build_request before any build or restart, '
    + 'commit every turn, Sonnet unless a named reason), or fleet_work_update / fleet_work_start an existing item, then end with finish_turn '
    + 'whose summary names the item (work item #N and its issue link). If this was not work (a question, talk, a status read), say so in one '
    + 'line and end the turn; you will not be stopped again.';
const NOT_NAMED = 'Name what you handed over in your reply: work item #N (Waiting / Queued) and its issue link, then end the turn.';

const shortName = (n) => String(n || '').replace(/^mcp__.+?__/, '');

/** A user entry that begins a turn: plain-string content or a text block (not only tool_result blocks). */
function isTurnStart(e) {
    if (!e || e.type !== 'user' || e.isMeta === true || e.isSidechain === true) return false;
    const c = e.message && e.message.content;
    if (typeof c === 'string') return c.trim().length > 0;
    return Array.isArray(c) && c.some((b) => b && b.type === 'text');
}

function resultText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((b) => (b && typeof b.text === 'string' ? b.text : (typeof b === 'string' ? b : ''))).join('\n');
    return '';
}

function turnItems(entries) {
    let start = -1;
    for (let i = entries.length - 1; i >= 0; i--) if (isTurnStart(entries[i])) { start = i; break; }
    const items = [];
    for (const e of entries.slice(start + 1)) {
        if (!e || !e.message) continue;
        const c = e.message.content;
        if (e.type === 'assistant') {
            if (typeof c === 'string') items.push({ kind: 'text', text: c });
            else if (Array.isArray(c)) {
                for (const b of c) {
                    if (!b) continue;
                    if (b.type === 'tool_use') items.push({ kind: 'use', id: b.id, name: shortName(b.name), input: b.input || {} });
                    else if (b.type === 'text' && typeof b.text === 'string') items.push({ kind: 'text', text: b.text });
                }
            }
        } else if (e.type === 'user' && Array.isArray(c)) {
            for (const b of c) {
                if (b && b.type === 'tool_result') items.push({ kind: 'result', id: b.tool_use_id, error: b.is_error === true, text: resultText(b.content) });
            }
        }
    }
    return items;
}

function handedOverRefs(use, result) {
    const ids = new Set();
    const issues = [];
    const addIssue = (full, number, url) => issues.push({ full, number: String(number), url: url || '' });
    const addRef = (text) => {
        String(text || '').replace(/([\w.-]+\/[\w.-]+)#(\d+)/g, (_, repo, n) => { addIssue(`${repo}#${n}`, n); return _; });
        String(text || '').replace(/(https?:\/\/[^\s"'\\)\]]+\/issues\/(\d+))/g, (_, url, n) => { addIssue(url, n, url); return _; });
    };
    if (use.name === 'claude_dispatch' && result) {
        const t = result.text;
        const work = /\\?"work\\?"\s*:\s*(\d+)/.exec(t);
        if (work) ids.add(work[1]);
        const arr = /\\?"issues\\?"\s*:\s*\[([^\]]*)\]/.exec(t);
        if (arr) addRef(arr[1].replace(/\\"/g, '"'));
        const url = /\\?"issueUrl\\?"\s*:\s*\\?"([^"\\]+)/.exec(t);
        if (url) addRef(url[1]);
    } else if (use.name === 'fleet_work_update') {
        if (Number(use.input.id) > 0) ids.add(String(Number(use.input.id)));
        (Array.isArray(use.input.issues) ? use.input.issues : []).forEach(addRef);
    } else if (use.name === 'fleet_work_start') {
        (Array.isArray(use.input.ids) ? use.input.ids : [use.input.ids]).forEach((n) => { if (Number(n) > 0) ids.add(String(Number(n))); });
    }
    return { ids, issues };
}

function replyText(items) {
    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].kind === 'use' && items[i].name === 'finish_turn') return String(items[i].input.summary || '');
    }
    let lastUse = -1;
    items.forEach((it, i) => { if (it.kind === 'use') lastUse = i; });
    return items.slice(lastUse + 1).filter((it) => it.kind === 'text').map((it) => it.text).join('\n');
}

function stopGate(opts) {
    const o = opts || {};
    if (o.stopHookActive) return { block: false };
    if (!classifyRequest(o.request).work) return { block: false };
    const items = turnItems(Array.isArray(o.transcriptEntries) ? o.transcriptEntries : []);
    const results = new Map(items.filter((it) => it.kind === 'result').map((it) => [it.id, it]));
    const uses = items.filter((it) => it.kind === 'use');
    // a hand-over whose tool call failed is not a hand-over
    const handovers = uses.filter((u) => HANDOVER_TOOLS.has(u.name) && !(results.get(u.id) && results.get(u.id).error));
    if (!handovers.length) {
        if (uses.some((u) => u.name === ESCAPE_TOOL)) return { block: false };
        return { block: true, reason: NO_HANDOVER };
    }
    const ids = new Set();
    const issues = [];
    handovers.forEach((u) => {
        const r = handedOverRefs(u, results.get(u.id));
        r.ids.forEach((id) => ids.add(id));
        issues.push(...r.issues);
    });
    if (!ids.size && !issues.length) return { block: false };
    const reply = replyText(items);
    const named = [...ids].some((id) => new RegExp(`(?:^|[^\\w/])#${id}\\b|\\b(?:work\\s+)?item\\s+#?${id}\\b|\\bwork\\s+#?${id}\\b`, 'i').test(reply))
        || issues.some((i) => (i.full && reply.includes(i.full)) || (i.url && reply.includes(i.url))
            || new RegExp(`(?:^|[^\\w/])#${i.number}\\b|issues/${i.number}\\b`).test(reply));
    return named ? { block: false } : { block: true, reason: NOT_NAMED };
}

// ---------------------------------------------------------------------------------------------------------------
// Claude CLI hook settings and the hook process entry
// ---------------------------------------------------------------------------------------------------------------

const PRE_TOOL_MATCHER = 'Bash|Edit|Write|MultiEdit|NotebookEdit|Agent|Task';
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/** The object for `claude --settings` (JSON string): the PreToolUse refusal and the Stop nudge. */
function hookSettings(opts) {
    const o = opts || {};
    const node = shq(o.nodeBin || 'node');
    const script = shq(o.gateScript);
    return {
        hooks: {
            PreToolUse: [{ matcher: PRE_TOOL_MATCHER, hooks: [{ type: 'command', command: `${node} ${script} pre-tool`, timeout: 10 }] }],
            Stop: [{ hooks: [{ type: 'command', command: `${node} ${script} stop ${shq(o.gateFile)}`, timeout: 10 }] }]
        }
    };
}

/**
 * The transcript entries of the last turn, read from the file's tail (a resumed chat's transcript can be tens of MB;
 * only the lines from the last turn start on are parsed).
 */
function readTurnEntries(file) {
    const fd = fs.openSync(file, 'r');
    try {
        const size = fs.fstatSync(fd).size;
        let want = 256 * 1024;
        for (;;) {
            const start = Math.max(0, size - want);
            const buf = Buffer.alloc(size - start);
            fs.readSync(fd, buf, 0, buf.length, start);
            let lines = buf.toString('utf8').split('\n');
            if (start > 0) lines = lines.slice(1); // the first line is cut
            const entries = [];
            let found = false;
            for (let i = lines.length - 1; i >= 0; i--) {
                if (!lines[i].trim()) continue;
                let e = null;
                try { e = JSON.parse(lines[i]); } catch (_) { continue; }
                entries.push(e);
                if (isTurnStart(e)) { found = true; break; }
            }
            if (found || start === 0) return entries.reverse();
            want *= 4;
        }
    } finally {
        fs.closeSync(fd);
    }
}

function denyOutput(reason) {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}

function runHook(mode, input, gateFile) {
    if (mode === 'pre-tool') {
        const tool = String(input.tool_name || '');
        if (tool === 'Bash') {
            const g = bashGuard(input.tool_input && input.tool_input.command);
            return g.deny ? denyOutput(g.reason) : '';
        }
        if (/^(Edit|Write|MultiEdit|NotebookEdit|Agent|Task)$/.test(tool)) return denyOutput(refusal(tool));
        return '';
    }
    if (mode === 'stop') {
        let gate = null;
        try { gate = JSON.parse(fs.readFileSync(gateFile, 'utf8')); } catch (_) { return ''; }
        if (!gate || gate.work !== true || input.stop_hook_active) return '';
        if (!input.transcript_path) return '';
        const verdict = stopGate({ request: gate.request, transcriptEntries: readTurnEntries(input.transcript_path), stopHookActive: false });
        return verdict.block ? JSON.stringify({ decision: 'block', reason: verdict.reason }) : '';
    }
    return '';
}

function main(argv) {
    const mode = argv[2];
    try {
        let input = {};
        try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (_) { input = {}; }
        const out = runHook(mode, input, argv[3]);
        if (out) process.stdout.write(out);
    } catch (error) {
        process.stderr.write(`directorWorkGate ${mode}: ${error && error.message}\n`);
    }
}

module.exports = {
    classifyRequest, bashGuard, stopGate, hookSettings, readTurnEntries, isTurnStart, runHook,
    REFUSAL, NO_HANDOVER, NOT_NAMED, PRE_TOOL_MATCHER
};

if (require.main === module) main(process.argv);
