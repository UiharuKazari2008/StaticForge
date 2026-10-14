#!/usr/bin/env node
'use strict';

// Standalone Dovecote poller. Cron starts it; it does not run inside a bot
// and it does not decide the schedule. One config, one state file, one
// Dreamscape list_mail per bot, and a webhook only for unread ids that are
// not already recorded.

const fs = require('fs');
const path = require('path');

const LIST_LIMIT = 200;
const DEFAULT_TIMEOUT_MS = 20000;

const HELP = `Usage: node mail-watch.js --config <file> [--dry-run] [--bot <name>]

Poll each bot mailbox with Dreamscape list_mail (inbox, unread only) and POST
that bot's webhook when unread ids are not already in the state file. The
script does not look at the clock; cron decides how often it runs.

Options:
  --config <file>   JSON config (required unless --help)
  --dry-run         Read mail and print what would wake. No webhook, no state write
  --bot <name>      Only the entry with this bot name
  --help            Show this help

Exit 0 when every selected bot succeeded. Exit 1 when config or state is
unusable, or any bot failed. One bot's failure does not skip the others.
`;

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

function oneLine(value) {
    return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').slice(0, 200);
}

function parseArgs(argv) {
    const out = { config: '', dryRun: false, bot: '', help: false };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            out.help = true;
        } else if (arg === '--dry-run') {
            out.dryRun = true;
        } else if (arg === '--config') {
            out.config = argv[++i];
            if (!out.config) throw new Error('--config requires a path');
        } else if (arg === '--bot') {
            out.bot = argv[++i];
            if (!out.bot) throw new Error('--bot requires a name');
        } else {
            throw new Error('unknown argument');
        }
    }
    return out;
}

function httpUrl(value, label) {
    let url;
    try {
        url = new URL(String(value || '').trim());
    } catch (_err) {
        throw new Error(`${label} must be an http(s) URL`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${label} must be an http(s) URL`);
    }
    if (url.username || url.password) {
        throw new Error(`${label} must not include credentials`);
    }
    return url.toString().replace(/\/+$/, '');
}

function mcpEndpoint(apiBaseUrl) {
    const base = httpUrl(apiBaseUrl, 'apiBaseUrl');
    if (/\/mcp$/i.test(base)) return base;
    return `${base}/mcp`;
}

function loadConfig(file) {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        if (err && err.code === 'ENOENT') throw new Error('config file not found');
        throw new Error('config file is not valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('config must be a JSON object');
    }
    const endpoint = mcpEndpoint(parsed.apiBaseUrl);
    const stateFile = String(parsed.stateFile || '').trim();
    if (!stateFile) throw new Error('config stateFile is required');
    let timeoutMs = DEFAULT_TIMEOUT_MS;
    if (parsed.timeoutMs != null) {
        timeoutMs = Number(parsed.timeoutMs);
        if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
            throw new Error('config timeoutMs must be a number from 1 to 120000');
        }
    }
    if (!Array.isArray(parsed.entries) || !parsed.entries.length) {
        throw new Error('config entries must be a non-empty array');
    }
    const globalWebhookKey = parsed.webhookKeyFile ? String(parsed.webhookKeyFile).trim() : '';
    const seen = new Set();
    const entries = parsed.entries.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`config entries[${index}] must be an object`);
        }
        const bot = String(entry.bot || '').trim();
        if (!bot || /[\r\n]/.test(bot)) throw new Error(`config entries[${index}] bot is invalid`);
        const botKey = bot.toLowerCase();
        if (seen.has(botKey)) throw new Error(`config has a duplicate bot: ${botKey}`);
        seen.add(botKey);
        const keyFile = String(entry.keyFile || '').trim();
        if (!keyFile) throw new Error(`config bot ${botKey} is missing keyFile`);
        const webhookUrl = httpUrl(entry.webhookUrl, `bot ${botKey} webhookUrl`);
        const webhookKeyFile = String(entry.webhookKeyFile || globalWebhookKey).trim();
        if (!webhookKeyFile) throw new Error(`config bot ${botKey} is missing a webhook key file`);
        return { bot, botKey, keyFile, webhookUrl, webhookKeyFile };
    });
    return { endpoint, stateFile, timeoutMs, entries };
}

function authorizationHeader(raw) {
    const token = String(raw || '').replace(/^\uFEFF/, '').trim();
    if (!token) throw new Error('key file is empty');
    if (/[\r\n]/.test(token)) throw new Error('key file must be a single line');
    if (/^(Bearer|Basic)\s+\S+$/i.test(token)) return token;
    if (/\s/.test(token)) throw new Error('key file has unexpected whitespace');
    return `Bearer ${token}`;
}

function readKeyFile(file) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (_err) {
        throw new Error('could not read key file');
    }
    return authorizationHeader(text);
}

function normalizeIds(ids) {
    return [...new Set(ids.filter((id) => id).map((id) => String(id)))].sort();
}

function sameIds(left, right) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

function loadState(file) {
    if (!fs.existsSync(file)) return { version: 1, bots: {} };
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_err) {
        throw new Error('state file is not valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('state file is not an object');
    }
    const botsIn = parsed.bots && typeof parsed.bots === 'object' && !Array.isArray(parsed.bots)
        ? parsed.bots
        : {};
    const bots = {};
    for (const [name, ids] of Object.entries(botsIn)) {
        if (!Array.isArray(ids)) continue;
        bots[String(name).toLowerCase()] = normalizeIds(ids);
    }
    return { version: 1, bots };
}

function writeStateAtomic(file, state) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) throw new Error('state directory does not exist');
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
    const body = `${JSON.stringify({ version: 1, bots: state.bots })}\n`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
        fs.writeSync(fd, body);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    try {
        fs.renameSync(tmp, file);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch (_unlinkErr) { /* temp file is private */ }
        throw err;
    }
}

function nextRecordedIds(previous, unreadIds, truncated) {
    if (truncated) return normalizeIds(previous.concat(unreadIds));
    return unreadIds;
}

async function postJson(url, header, body, timeoutMs) {
    const response = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
            Authorization: header,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'mail-watch'
        },
        body: JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, ok: response.status >= 200 && response.status < 300, text };
}

function unwrapListMail(rpc) {
    if (!rpc || typeof rpc !== 'object') throw new Error('empty list_mail response');
    if (rpc.error) throw new Error('list_mail rejected');
    const result = rpc.result;
    if (!result || typeof result !== 'object') throw new Error('list_mail response missing result');
    const text = result.content && result.content[0] && result.content[0].text;
    let payload;
    try {
        payload = JSON.parse(text);
    } catch (_err) {
        throw new Error('list_mail payload was not JSON');
    }
    if (result.isError || !payload || payload.success === false) {
        const code = payload && typeof payload.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(payload.code)
            ? ` (${payload.code})`
            : '';
        throw new Error(`list_mail failed${code}`);
    }
    if (typeof payload.owner !== 'string' || !payload.owner.trim()) {
        throw new Error('list_mail response missing owner');
    }
    if (!Array.isArray(payload.mail)) throw new Error('list_mail response missing mail');
    const messages = [];
    for (const row of payload.mail) {
        if (!row || row.id == null || String(row.id).trim() === '') continue;
        messages.push({
            id: String(row.id),
            subject: row.subject == null ? '' : String(row.subject)
        });
    }
    return { owner: payload.owner.trim(), messages, rawCount: payload.mail.length };
}

async function listUnread(endpoint, keyHeader, timeoutMs) {
    let response;
    try {
        response = await postJson(endpoint, keyHeader, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'list_mail',
                arguments: {
                    folder: 'inbox',
                    unreadOnly: true,
                    limit: LIST_LIMIT
                }
            }
        }, timeoutMs);
    } catch (err) {
        throw new Error(`list_mail request failed: ${publicError(err)}`);
    }
    if (!response.ok) throw new Error(`list_mail HTTP ${response.status}`);
    let rpc;
    try {
        rpc = JSON.parse(response.text);
    } catch (_err) {
        throw new Error('list_mail response was not JSON');
    }
    return unwrapListMail(rpc);
}

async function wakeBot(entry, fresh, timeoutMs) {
    const header = readKeyFile(entry.webhookKeyFile);
    let response;
    try {
        response = await postJson(entry.webhookUrl, header, {
            bot: entry.bot,
            count: fresh.length,
            ids: fresh.map((msg) => msg.id),
            subjects: fresh.map((msg) => msg.subject)
        }, timeoutMs);
    } catch (err) {
        throw new Error(`webhook request failed: ${publicError(err)}`);
    }
    if (!response.ok) throw new Error(`webhook HTTP ${response.status}`);
}

async function pollEntry(entry, ctx) {
    const listed = await listUnread(ctx.endpoint, readKeyFile(entry.keyFile), ctx.timeoutMs);
    if (listed.owner.toLowerCase() !== entry.botKey) {
        throw new Error('list_mail owner does not match bot');
    }
    const previous = ctx.state.bots[entry.botKey] || [];
    const known = new Set(previous);
    const fresh = [];
    const seen = new Set();
    for (const msg of listed.messages) {
        if (known.has(msg.id) || seen.has(msg.id)) continue;
        seen.add(msg.id);
        fresh.push(msg);
    }
    const unreadIds = normalizeIds(listed.messages.map((msg) => msg.id));
    const truncated = listed.rawCount >= LIST_LIMIT;
    const recorded = nextRecordedIds(previous, unreadIds, truncated);
    if (!fresh.length) {
        const pruned = previous.length - recorded.filter((id) => previous.includes(id)).length;
        if (ctx.dryRun) {
            console.log(pruned > 0
                ? `${entry.bot}: no new mail (would prune ${pruned})`
                : `${entry.bot}: no new mail`);
            return;
        }
        if (!sameIds(previous, recorded)) {
            ctx.state.bots[entry.botKey] = recorded;
            writeStateAtomic(ctx.stateFile, ctx.state);
        }
        console.log(`${entry.bot}: no new mail`);
        return;
    }
    if (ctx.dryRun) {
        console.log(`${entry.bot}: would wake count=${fresh.length} ids=${fresh.map((msg) => msg.id).join(',')} subjects=${fresh.map((msg) => oneLine(msg.subject)).join(' | ')}`);
        return;
    }
    await wakeBot(entry, fresh, ctx.timeoutMs);
    ctx.state.bots[entry.botKey] = recorded;
    try {
        writeStateAtomic(ctx.stateFile, ctx.state);
    } catch (_err) {
        throw new Error('webhook accepted but state write failed');
    }
    console.log(`${entry.bot}: woke count=${fresh.length}`);
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        process.stdout.write(HELP);
        return 0;
    }
    if (!args.config) throw new Error('--config is required');
    const config = loadConfig(args.config);
    let entries = config.entries;
    if (args.bot) {
        const wanted = args.bot.trim().toLowerCase();
        entries = entries.filter((entry) => entry.botKey === wanted);
        if (!entries.length) throw new Error('no config entry matches --bot');
    }
    const state = loadState(config.stateFile);
    const ctx = {
        endpoint: config.endpoint,
        stateFile: config.stateFile,
        timeoutMs: config.timeoutMs,
        dryRun: args.dryRun,
        state
    };
    let failed = 0;
    for (const entry of entries) {
        try {
            await pollEntry(entry, ctx);
        } catch (err) {
            failed += 1;
            console.error(`${entry.bot}: failed: ${publicError(err)}`);
        }
    }
    return failed ? 1 : 0;
}

main().then((code) => {
    process.exit(code);
}).catch((err) => {
    console.error(publicError(err));
    process.exit(1);
});
