'use strict';

/**
 * How Dreamscape reaches the Fleet agent account on Fat Misaka (docs/fleet/sessions-on-misaka.md). No dependencies: used by
 * modules/misakaSessions.js and by the agent-coord MCP server (steering into a Misaka session's tmux pane).
 * Key ~/.ssh/misaka_agents_ed25519 (authorized for user `agents` there with from="<Dreamscape address>", no forwarding); the
 * host key is pinned in <state>/misaka_known_hosts on first use; one multiplexed connection is kept for 2 minutes.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const COORD_HOST = 'fat-misaka';

function stateDir() { return process.env.DREAMSCAPE_CLAUDE_DESK_STATE || path.join(os.homedir(), '.local', 'state', 'dreamscape-agents'); }

function cfg() {
    return {
        host: process.env.DREAMSCAPE_MISAKA_ADDR || '192.168.100.42',
        user: process.env.DREAMSCAPE_MISAKA_USER || 'agents',
        key: process.env.DREAMSCAPE_MISAKA_KEY || path.join(os.homedir(), '.ssh', 'misaka_agents_ed25519'),
        home: '/home/agents',
        socket: 'dreamscape-claude-carry',
        // the gate on Dreamscape, as seen from Misaka
        gateUser: os.userInfo().username,
        gateKey: '/home/agents/.ssh/dreamscape_gate_ed25519',
        gateKnown: '/home/agents/.ssh/known_hosts_dreamscape'
    };
}

/** ssh options (without the destination) for a non-interactive command; tty: true for an attach. */
function sshOptions(opts = {}) {
    const c = cfg();
    const dir = path.join(stateDir(), 'ssh');
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (_) { /* ssh says */ }
    const a = ['-q', '-i', c.key, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
        '-o', `UserKnownHostsFile=${path.join(stateDir(), 'misaka_known_hosts')}`, '-o', 'ConnectTimeout=8',
        '-o', 'ControlMaster=auto', '-o', `ControlPath=${path.join(dir, 'm-%C')}`, '-o', 'ControlPersist=120', '-o', 'ServerAliveInterval=20'];
    a.push(opts.tty ? '-tt' : '-T');
    return a;
}

function destination() { const c = cfg(); return `${c.user}@${c.host}`; }

module.exports = { COORD_HOST, cfg, sshOptions, destination, stateDir };

require('./hotReload').mark(module);
