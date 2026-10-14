#!/usr/bin/env node
'use strict';

// Mail a Dreamscape job completion report through Dovecote MCP send_mail.
//
// Usage:
//   node scripts/mail-report.js --subject "perf-2 done" --body-file report.html
//   node scripts/mail-report.js --subject "perf-2 done" < report.html
//   node scripts/mail-report.js --subject "Job perf-2 rc=0" --body-file - --to menma --cc yukimi
//   node scripts/mail-report.js --print-job-body --job-name perf-2 --rc 0 \
//       --started 2026-10-14T12:00:00-04:00 --ended 2026-10-14T13:00:00-04:00 \
//       --agent-jsonl ~/worktrees/logs/perf-2.jsonl
//
// Defaults: --to menma, --cc yukimi, --key-file ~/.config/dreamscape-mail/cursor.key.
// The body is HTML. A standard signature is appended. --body-file - or a bare
// run with no --body-file reads stdin.
//
// The key file path is the only credential input. The file is read into the
// Authorization header and is never printed. Pass --api-base (or set
// DREAMSCAPE_MCP_URL) when the local MCP path is not in secure.config.json.
//
// Require from another script:
//   const { sendJobReport, buildJobReportBody } = require('./mail-report');
//   await sendJobReport({ subject: 'Job perf-2 rc=0', body: '<p>done</p>' });

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_KEY_FILE = path.join(os.homedir(), '.config', 'dreamscape-mail', 'cursor.key');
const DEFAULT_TO = 'menma';
const DEFAULT_CC = 'yukimi';
const SIGNATURE_MARK = 'Dreamscape job report';
const SIGNATURE_HTML = '<p>-- Cursor<br>Dreamscape job report</p>';
const TAIL_CHARS = 2000;

function publicError(err) {
    const parts = [];
    const seen = new Set();
    let current = err;
    while (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current);
        if (current.name && current.name !== 'Error') parts.push(String(current.name));
        if (current.message) parts.push(String(current.message));
        current = current.cause;
    }
    if (!parts.length) parts.push('request failed');
    return parts.join(': ')
        .replace(/https?:\/\/\S+/gi, '[url]')
        .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/\bsfapp_[A-Za-z0-9._-]+/g, '[redacted]')
        .replace(/[\r\n]+/g, ' ')
        .slice(0, 400);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderReportHtml(body) {
    const raw = String(body || '').trim();
    const inner = /<\/?[a-z][^>]*>/i.test(raw) ? raw : '<pre>' + escapeHtml(raw) + '</pre>';
    if (inner.includes(SIGNATURE_MARK)) return inner;
    return inner + '\n' + SIGNATURE_HTML;
}

function readAgentTail(jsonlPath, tailChars) {
    if (!jsonlPath) return '';
    let text;
    try {
        text = fs.readFileSync(jsonlPath, 'utf8');
    } catch (_err) {
        return '';
    }
    let result = '';
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event;
        try {
            event = JSON.parse(trimmed);
        } catch (_err) {
            continue;
        }
        if (event && event.type === 'result' && typeof event.result === 'string') {
            result = event.result;
        }
    }
    const cap = Math.max(1, Number(tailChars) || TAIL_CHARS);
    if (result.length <= cap) return result.trim();
    return result.slice(result.length - cap).trim();
}

function buildJobReportBody({ name, rc, started, ended, jsonl, tailChars } = {}) {
    const tail = readAgentTail(jsonl, tailChars);
    const text = [
        'Job: ' + (name || ''),
        'Exit: ' + (rc == null ? '' : rc),
        'Started: ' + (started || ''),
        'Ended: ' + (ended || ''),
        '',
        'Final message:',
        tail || '(no final message)'
    ].join('\n');
    return renderReportHtml(text);
}

function httpUrl(value, label) {
    let url;
    try {
        url = new URL(String(value || '').trim());
    } catch (_err) {
        throw new Error(label + ' must be an http(s) URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(label + ' must be an http(s) URL');
    }
    if (url.username || url.password) {
        throw new Error(label + ' must not include credentials');
    }
    return url.toString().replace(/\/+$/, '');
}

function mcpEndpoint(apiBaseUrl) {
    const base = httpUrl(apiBaseUrl, 'api base');
    if (/\/mcp$/i.test(base)) return base;
    return base + '/mcp';
}

function readMcpPathUuid(file) {
    if (!file || !fs.existsSync(file)) return '';
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_err) {
        return '';
    }
    const uuid = parsed && parsed.mcpPathUuid;
    if (typeof uuid !== 'string') return '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) return '';
    return uuid;
}

function resolveEndpoint(apiBase, secureConfigPath) {
    if (apiBase) return mcpEndpoint(apiBase);
    if (secureConfigPath) {
        const uuid = readMcpPathUuid(secureConfigPath);
        if (!uuid) throw new Error('mail API base is not configured');
        return 'http://127.0.0.1:9220/' + uuid + '/mcp';
    }
    if (process.env.DREAMSCAPE_MCP_URL) return mcpEndpoint(process.env.DREAMSCAPE_MCP_URL);
    const files = [
        path.join(process.cwd(), 'secure.config.json'),
        path.join(__dirname, '..', 'secure.config.json'),
        path.join(os.homedir(), 'staticforge', 'secure.config.json')
    ];
    for (const file of files) {
        const uuid = readMcpPathUuid(file);
        if (uuid) return 'http://127.0.0.1:9220/' + uuid + '/mcp';
    }
    throw new Error('mail API base is not configured');
}

function authorizationHeader(raw) {
    const token = String(raw || '').replace(/^\uFEFF/, '').trim();
    if (!token) throw new Error('key file is empty');
    if (/[\r\n]/.test(token)) throw new Error('key file must be a single line');
    if (/^(Bearer|Basic)\s+\S+$/i.test(token)) return token;
    if (/\s/.test(token)) throw new Error('key file has unexpected whitespace');
    return 'Bearer ' + token;
}

function readKeyFile(file) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') throw new Error('key file not found');
        throw new Error('could not read key file');
    }
    return authorizationHeader(text);
}

async function postJson(url, header, body, timeoutMs) {
    const response = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs || 20000),
        headers: {
            Authorization: header,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'mail-report'
        },
        body: JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, ok: response.status >= 200 && response.status < 300, text };
}

function unwrapSend(rpc) {
    if (!rpc || typeof rpc !== 'object') throw new Error('empty send_mail response');
    if (rpc.error) throw new Error('send_mail rejected');
    const result = rpc.result;
    if (!result || typeof result !== 'object') throw new Error('send_mail response missing result');
    let payload;
    try {
        payload = JSON.parse(result.content && result.content[0] && result.content[0].text);
    } catch (_err) {
        throw new Error('send_mail payload was not JSON');
    }
    if (result.isError || !payload || payload.success === false) {
        const code = payload && typeof payload.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(payload.code)
            ? ' (' + payload.code + ')'
            : '';
        throw new Error('send_mail failed' + code);
    }
    return payload;
}

async function sendJobReport(options) {
    const opts = options || {};
    const subject = String(opts.subject || '').trim();
    if (!subject) throw new Error('subject is required');
    const keyFile = opts.keyFile || DEFAULT_KEY_FILE;
    const header = readKeyFile(keyFile);
    const endpoint = resolveEndpoint(opts.apiBase, opts.secureConfigPath);
    let response;
    try {
        response = await postJson(endpoint, header, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'send_mail',
                arguments: {
                    to: opts.to === undefined ? DEFAULT_TO : opts.to,
                    cc: opts.cc === undefined ? DEFAULT_CC : opts.cc,
                    subject: subject,
                    body: renderReportHtml(opts.body),
                    format: 'html'
                }
            }
        }, opts.timeoutMs);
    } catch (err) {
        throw new Error('send_mail request failed: ' + publicError(err));
    }
    if (!response.ok) throw new Error('send_mail HTTP ' + response.status);
    let rpc;
    try {
        rpc = JSON.parse(response.text);
    } catch (_err) {
        throw new Error('send_mail response was not JSON');
    }
    return unwrapSend(rpc);
}

function parseArgs(argv) {
    const out = {
        subject: '',
        bodyFile: null,
        to: null,
        cc: null,
        keyFile: DEFAULT_KEY_FILE,
        apiBase: '',
        printJobBody: false,
        jobName: '',
        rc: '',
        started: '',
        ended: '',
        agentJsonl: '',
        help: false
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => {
            const value = argv[++i];
            if (value == null) throw new Error(arg + ' requires a value');
            return value;
        };
        if (arg === '--help' || arg === '-h') out.help = true;
        else if (arg === '--subject') out.subject = next();
        else if (arg === '--body-file') out.bodyFile = next();
        else if (arg === '--to') {
            if (!out.to) out.to = [];
            const value = next();
            if (value) out.to.push(value);
        } else if (arg === '--cc') {
            if (!out.cc) out.cc = [];
            const value = next();
            if (value) out.cc.push(value);
        } else if (arg === '--key-file') out.keyFile = next();
        else if (arg === '--api-base') out.apiBase = next();
        else if (arg === '--print-job-body') out.printJobBody = true;
        else if (arg === '--job-name') out.jobName = next();
        else if (arg === '--rc') out.rc = next();
        else if (arg === '--started') out.started = next();
        else if (arg === '--ended') out.ended = next();
        else if (arg === '--agent-jsonl') out.agentJsonl = next();
        else throw new Error('unknown argument');
    }
    return out;
}

function readBodyFile(file) {
    if (file == null || file === '-') return fs.readFileSync(0, 'utf8');
    return fs.readFileSync(file, 'utf8');
}

function helpText() {
    return [
        'Usage: node scripts/mail-report.js --subject <text> [--body-file <path|->] [--to <name>] [--cc <name>] [--key-file <path>] [--api-base <url>]',
        '       node scripts/mail-report.js --print-job-body --job-name <name> --rc <n> --started <iso> --ended <iso> [--agent-jsonl <path>]',
        '',
        'Defaults: to=menma, cc=yukimi, key-file=~/.config/dreamscape-mail/cursor.key.',
        'HTML body with a standard signature. The key file is never printed.'
    ].join('\n');
}

async function main(argv) {
    const args = parseArgs(argv || process.argv);
    if (args.help) {
        console.log(helpText());
        return;
    }
    if (args.printJobBody) {
        process.stdout.write(buildJobReportBody({
            name: args.jobName,
            rc: args.rc,
            started: args.started,
            ended: args.ended,
            jsonl: args.agentJsonl
        }));
        return;
    }
    const body = args.bodyFile == null && process.stdin.isTTY
        ? ''
        : readBodyFile(args.bodyFile);
    const sent = await sendJobReport({
        subject: args.subject,
        body: body,
        to: args.to === null ? undefined : args.to,
        cc: args.cc === null ? undefined : args.cc,
        keyFile: args.keyFile,
        apiBase: args.apiBase || undefined
    });
    const toList = Array.isArray(sent.to) ? sent.to.join(',') : '';
    const ccList = Array.isArray(sent.cc) ? sent.cc.join(',') : '';
    console.log('sent job report to=' + toList + ' cc=' + ccList);
}

module.exports = {
    sendJobReport,
    buildJobReportBody,
    renderReportHtml,
    readAgentTail,
    resolveEndpoint,
    publicError,
    parseArgs,
    DEFAULT_KEY_FILE,
    DEFAULT_TO,
    DEFAULT_CC
};

if (require.main === module) {
    main().catch((err) => {
        console.error(publicError(err));
        process.exit(1);
    });
}
