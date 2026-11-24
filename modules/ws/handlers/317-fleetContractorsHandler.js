'use strict';

/**
 * Fleet Contractors (#1154): other machines that run Claude Code work for Fleet (modules/fleetContractors.js,
 * the agent in scripts/contractor/). Admin only. One packet, by action:
 *
 *   claude_fleet_contractors { action: 'list' }                              { contractors, invites }
 *     { action: 'invite', name, serverUrl? }                                 { invite: { id, name, code, expiresAt }, install }
 *     { action: 'revoke', id }            a contractor (closes its socket) or an open invite (inv_...)
 *     { action: 'remove', id }            revokes and forgets a contractor
 *     { action: 'installer', os: 'linux' | 'windows', serverUrl? }           { filename, text } (agent inside)
 *     { action: 'sessions', id }                                             { live, recent }
 *     { action: 'transcript', id, sessionId, before?, limit?, show?, item? } claudeTranscript's page shape
 *     { action: 'start', id, cwd, prompt, title, model?, effort?, mode? }    { sessionId, link, state }
 *     { action: 'steer', id, sessionId, text } / 'interrupt' / 'stop' { id, sessionId }
 *
 * Answer: claude_fleet_contractors_response { success, action, ... }. Push (admins):
 * claude_fleet_contractors_status { reason, contractor } | { reason: 'invites', invites }.
 * docs/client-api/ws/fleet-contractors.md
 */

const fs = require('fs');
const path = require('path');
const wsPacketRegistry = require('../wsPacketRegistry');
const contractors = require('../../fleetContractors');

const TYPE = 'claude_fleet_contractors';
const ROOT = path.join(__dirname, '..', '..', '..');
const SERVER_URL_RE = /^https?:\/\/[A-Za-z0-9.-]{1,253}(:\d{1,5})?\/?$/;

const isAdmin = (info) => !!(info && info.authenticated !== false && /^(admin|dev_admin)$/.test(String(info.userType || '')));
const serverUrlOf = (v) => (typeof v === 'string' && SERVER_URL_RE.test(v.trim()) ? v.trim().replace(/\/$/, '') : '');
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** The installer with the agent (and the transcript reader it shares with the server) inside it. */
async function installer(osName, serverUrl) {
    const read = (rel) => fs.promises.readFile(path.join(ROOT, rel), 'utf8');
    const [agent, reader] = await Promise.all([read('scripts/contractor/agent.js'), read('modules/claudeTranscript.js')]);
    if (osName === 'windows') {
        let text = await read('scripts/contractor/install.ps1');
        if (/^'@/m.test(agent) || /^'@/m.test(reader)) throw new Error('The agent cannot be embedded in a PowerShell here-string');
        text = text.replace(/# >>> embedded files[\s\S]*?# <<< embedded files/, () => [
            '# >>> embedded files (filled in by the server)',
            `$EmbeddedAgent = @'\n${agent}\n'@`,
            `$EmbeddedTranscript = @'\n${reader}\n'@`,
            serverUrl ? `if (-not $Server) { $Server = ${psq(serverUrl)} }` : '',
            '# <<< embedded files'
        ].join('\n'));
        return { filename: 'fleet-contractor-install.ps1', text: text.replace(/\r?\n/g, '\r\n') };
    }
    let text = await read('scripts/contractor/install.sh');
    if (/^FLEET_AGENT_EOF$/m.test(agent) || /^FLEET_TRANSCRIPT_EOF$/m.test(reader)) throw new Error('The agent cannot be embedded in a here-document');
    text = text.replace(/# >>> embedded files[\s\S]*?# <<< embedded files/, () => [
        '# >>> embedded files (filled in by the server)',
        "embedded_agent() { cat <<'FLEET_AGENT_EOF'",
        agent.replace(/\n$/, ''),
        'FLEET_AGENT_EOF',
        '}',
        "embedded_transcript() { cat <<'FLEET_TRANSCRIPT_EOF'",
        reader.replace(/\n$/, ''),
        'FLEET_TRANSCRIPT_EOF',
        '}',
        serverUrl ? `[ -n "$SERVER" ] || SERVER=${shq(serverUrl)}` : '',
        '# <<< embedded files'
    ].join('\n'));
    return { filename: 'fleet-contractor-install.sh', text };
}

function installHelp(name, serverUrl) {
    const srv = serverUrl || '<server url>';
    return {
        linux: `sh fleet-contractor-install.sh --server ${shq(srv)} --name ${shq(name)} --project <folder>   # asks for the pairing code`,
        windows: `powershell -ExecutionPolicy Bypass -File fleet-contractor-install.ps1 -Server ${psq(srv)} -Name ${psq(name)} -Project <folder>   # asks for the pairing code`,
        note: 'Save the installer from Fleet (Contractors > Get installer) and copy it to the machine. The code works once, for 15 minutes; it is asked for at the prompt (or FLEET_PAIR_CODE in the environment) and never on the command line.'
    };
}

async function run(message, clientInfo) {
    const action = String(message.action || '');
    const id = String(message.id || '');
    switch (action) {
        case 'list': return contractors.list();
        case 'invite': {
            const invite = contractors.createInvite(message.name, clientInfo && (clientInfo.username || clientInfo.userId));
            return { invite, install: installHelp(invite.name, serverUrlOf(message.serverUrl)) };
        }
        case 'revoke': return contractors.revoke(id);
        case 'remove': return contractors.remove(id);
        case 'installer': return installer(message.os === 'windows' ? 'windows' : 'linux', serverUrlOf(message.serverUrl));
        case 'sessions': return Object.assign({ id }, await contractors.sessions(id));
        case 'transcript': return Object.assign({ id, sessionId: message.sessionId }, await contractors.transcript(id, message));
        case 'start': return Object.assign({ id }, await contractors.startOn(id, message));
        case 'steer': return Object.assign({ id }, await contractors.steer(id, message.sessionId, message.text));
        case 'interrupt': return Object.assign({ id }, await contractors.interrupt(id, message.sessionId));
        case 'stop': return Object.assign({ id }, await contractors.stop(id, message.sessionId));
        default: throw new Error('Unknown action');
    }
}

async function handle(handlersCtx, ws, message, clientInfo) {
    const msg = message || {};
    if (!isAdmin(clientInfo)) {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', msg.requestId);
        return;
    }
    try {
        const data = await run(msg, clientInfo);
        handlersCtx.sendToClient(ws, { type: `${TYPE}_response`, requestId: msg.requestId, data: Object.assign({ success: true, action: String(msg.action || '') }, data), timestamp: new Date().toISOString() });
    } catch (error) {
        console.warn(`[fleetContractors] ${msg.action}: ${error.message}`);
        handlersCtx.sendError(ws, error.message, 'FLEET_CONTRACTORS_FAILED', msg.requestId);
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    contractors.arm(handlersCtx.globalResources);
    wsPacketRegistry.registerWsPacket(TYPE, async (ctx) => {
        await handle(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo);
    }, { owner: 'fleetContractors', destructive: true });
}

module.exports = { registerPackets, _handlers: { handle, run, installer } };
