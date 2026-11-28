#!/usr/bin/env node
'use strict';

/**
 * The back-channel gate for Claude sessions that run on Fat Misaka (docs/fleet/sessions-on-misaka.md).
 *
 * It is the FORCED COMMAND of one ssh key in kanmi's authorized_keys:
 *   from="192.168.100.42",restrict,command="/usr/bin/node /home/kanmi/staticforge/scripts/fleet/misaka-gate.js" ssh-ed25519 ... misaka-agents-gate
 * so whatever the client asks for arrives in SSH_ORIGINAL_COMMAND and only the verbs below ever run (no shell, no pty,
 * no forwarding: `restrict`). Grammar: `<verb> [KEY=VALUE ...]`, single spaces, values from a small alphabet.
 *
 *   mcp-agent-coord [env]    modules/agentCoord/mcpServer.js (stdio MCP) with the session's identity in env
 *   mcp-yozora ident=fleet|claude   scripts/gitea-mcp.sh with that identity's token (the token never leaves this host)
 *   git-credential ident=fleet|claude   prints `username=` / `password=` for the Yozora host only (git credential helper)
 *   ask-hook                 scripts/claude-ask-hook.js (AskUserQuestion PreToolUse hook; stdin / stdout pass through)
 *   ingest <session id>      scripts/fleet/misaka-ingest.js: the watcher's event stream into the transcript mirror
 *   ping                     prints ok
 * Nothing prints or logs a token. Denied requests are logged (verb and reason only).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const HOME = os.homedir();
const LOG = path.join(HOME, '.local', 'state', 'dreamscape-agents', 'misaka-gate.log');
const YOZORA_HOST = 'yozora.bluesteel.737.jp.net';
const SID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VALUE_RE = /^[A-Za-z0-9._:/@+=,-]{0,300}$/;
const ENV_KEYS = new Set(['AGENT_COORD_ID', 'AGENT_COORD_KIND', 'AGENT_COORD_CWD', 'AGENT_COORD_HOST', 'AGENT_COORD_REPO', 'AGENT_COORD_ROOT',
    'AGENT_COORD_SESSION_ID', 'AGENT_COORD_ACCOUNT', 'AGENT_COORD_TMUX', 'AGENT_COORD_NAME_B64', 'AGENT_COORD_BRANCH']);
const IDENTS = { fleet: { login: 'director.yozora', file: '.secrets/yozora-yozora.token' }, claude: { login: 'claude', file: '.secrets/yozora-claude.token' } };

function deny(why, verb) {
    try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, `${new Date().toISOString()} denied ${String(verb || '').slice(0, 40)}: ${why}\n`); } catch (_) { /* no log */ }
    process.stderr.write(`misaka-gate: ${why}\n`);
    process.exit(126);
}
function note(line) { try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); } catch (_) { /* no log */ } }

const original = String(process.env.SSH_ORIGINAL_COMMAND || '').trim();
if (!original) deny('no command (this key only runs the Fleet verbs)', '');
if (original.length > 2000 || /[\0\r\n]/.test(original)) deny('bad command', '');
const [verb, ...rest] = original.split(' ');

function parseKv(tokens) {
    const out = {};
    for (const t of tokens) {
        const i = t.indexOf('=');
        if (i < 1) deny(`bad argument ${t.slice(0, 20)}`, verb);
        const k = t.slice(0, i);
        const v = t.slice(i + 1);
        if (!VALUE_RE.test(v)) deny(`bad value for ${k.slice(0, 40)}`, verb);
        out[k] = v;
    }
    return out;
}
function ident(kv) {
    const name = kv.ident || 'fleet';
    if (!IDENTS[name]) deny('unknown identity', verb);
    return Object.assign({ name }, IDENTS[name]);
}
function run(cmd, args, env) {
    const child = spawn(cmd, args, { stdio: 'inherit', env: Object.assign({}, process.env, env), cwd: ROOT });
    child.on('exit', (code, sig) => process.exit(code === null ? (sig ? 128 : 1) : code));
    child.on('error', (e) => { process.stderr.write(`misaka-gate: ${e.message}\n`); process.exit(127); });
}

switch (verb) {
case 'ping': process.stdout.write('ok\n'); break;
case 'mcp-agent-coord': {
    const kv = parseKv(rest);
    const env = {};
    for (const [k, v] of Object.entries(kv)) {
        if (!ENV_KEYS.has(k)) deny(`env ${k.slice(0, 40)} is not allowed`, verb);
        if (k === 'AGENT_COORD_NAME_B64') env.AGENT_COORD_NAME = Buffer.from(v, 'base64').toString('utf8').slice(0, 120);
        else env[k] = v;
    }
    if (env.AGENT_COORD_SESSION_ID && !SID_RE.test(env.AGENT_COORD_SESSION_ID)) deny('bad session id', verb);
    env.AGENT_COORD_KIND = env.AGENT_COORD_KIND || 'claude';
    note(`mcp-agent-coord ${env.AGENT_COORD_ID || '?'}`);
    run(process.execPath, [path.join(ROOT, 'modules', 'agentCoord', 'mcpServer.js')], env);
    break;
}
case 'mcp-yozora': {
    const kv = parseKv(rest);
    const id = ident(kv);
    const env = id.name === 'fleet' ? { FLEET_SESSION: '1', YOZORA_LOGIN: id.login, YOZORA_TOKEN_FILE: path.join(HOME, id.file) } : { FLEET_SESSION: '' };
    note(`mcp-yozora ${id.name}`);
    run('/bin/bash', [path.join(ROOT, 'scripts', 'gitea-mcp.sh')], env);
    break;
}
case 'git-credential': {
    const id = ident(parseKv(rest));
    // git's helper protocol sends the request on stdin; only the Yozora host is ever answered
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { input += c; if (input.length > 4096) process.exit(1); });
    process.stdin.on('end', () => {
        const host = (/^host=(.*)$/m.exec(input) || [])[1];
        if (host !== YOZORA_HOST) { note(`git-credential refused host ${String(host).slice(0, 60)}`); process.exit(1); }
        let token = '';
        try { token = fs.readFileSync(path.join(HOME, id.file), 'utf8').replace(/\s+/g, ''); } catch (_) { process.exit(1); }
        process.stdout.write(`username=${id.login}\npassword=${token}\n`);
        note(`git-credential ${id.name}`);
    });
    break;
}
case 'ask-hook': run(process.execPath, [path.join(ROOT, 'scripts', 'claude-ask-hook.js')], {}); break;
case 'ingest': {
    if (rest.length !== 1 || !SID_RE.test(rest[0])) deny('ingest needs one session id', verb);
    run(process.execPath, [path.join(ROOT, 'scripts', 'fleet', 'misaka-ingest.js'), rest[0]], {});
    break;
}
default: deny(`unknown verb ${String(verb).slice(0, 40)}`, verb);
}
