'use strict';

// Claude subscription usage refresh. The setup token cannot read
// /api/oauth/usage, but every `claude -p` call reports the 5-hour and 7-day
// windows in a rate_limit_event. So a tiny ping/pong call refreshes them when
// the saved figures (modules/cursorDirector.js claude-usage.json, also written
// by real Wren and Xi turns) are 6 hours old.
//
// Only while someone uses Dreamscape: an authenticated client connected now or
// in the last 4 hours. Otherwise the refresh waits until a client logs in.
// One call at a time: concurrent triggers share the in-flight promise, and a
// failed attempt waits FAIL_BACKOFF_MS before the next.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REFRESH_MS = 6 * 60 * 60 * 1000;
const CLIENT_WINDOW_MS = 4 * 60 * 60 * 1000;
const TICK_MS = 10 * 60 * 1000;
const FAIL_BACKOFF_MS = 30 * 60 * 1000;
const PING_TIMEOUT_MS = 90 * 1000;

let inflight = null;
let lastClientAt = 0;
let lastAttemptAt = 0;
let armed = false;

function director() {
    return require('./cursorDirector');
}

function anyClientConnected(gr) {
    try {
        const ws = gr.getWebSocketServer();
        for (const info of ws.clients.values()) {
            if (info && info.authenticated) return true;
        }
    } catch (_) { /* no WS server yet */ }
    return false;
}

function usageAgeMs(now) {
    const at = director()._test.claudeUsageAt();
    return at ? now - at : Infinity;
}

// Haiku is the cheapest model the installed CLI can run.
function pingModel() {
    const ids = director()._test.availableClaudeModels().map((family) => family.id);
    return ids.includes('claude-haiku-5-5') ? 'claude-haiku-5-5' : 'claude-haiku-4-5';
}

// Host run with a throwaway HOME: no MCP, no tools, no saved session, so it
// touches nothing of Wren's, Xi's, or the user's Claude state.
function runPing() {
    return new Promise((resolve) => {
        const bin = director().findClaude();
        if (!bin) {
            resolve({ ok: false, error: 'Claude Code is not installed' });
            return;
        }
        let token = '';
        try {
            token = fs.readFileSync(require('./xiLaunch').resolveClaudeTokenFile(), 'utf8').trim();
        } catch (_) { /* reported below */ }
        if (!token) {
            resolve({ ok: false, error: 'Claude OAuth token file is missing' });
            return;
        }
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-ping-'));
        const args = [
            '-p',
            '--output-format', 'stream-json',
            '--verbose',
            '--model', pingModel(),
            '--no-session-persistence',
            '--strict-mcp-config',
            '--tools', '',
            '--settings', JSON.stringify({ fastMode: false }),
            '--',
            'Reply with exactly: pong'
        ];
        const child = spawn(bin, args, {
            cwd: home,
            env: {
                HOME: home,
                PATH: process.env.PATH || '/usr/bin:/bin',
                CLAUDE_CODE_OAUTH_TOKEN: token,
                NO_COLOR: '1',
                DISABLE_AUTOUPDATER: '1'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let buffer = '';
        let info = null;
        let reply = '';
        const take = (line) => {
            let evt;
            try { evt = JSON.parse(line); } catch (_) { return; }
            if (evt.type === 'rate_limit_event' && evt.rate_limit_info) info = evt.rate_limit_info;
            if (evt.type === 'result' && typeof evt.result === 'string') reply = evt.result;
        };
        child.stdout.on('data', (buf) => {
            buffer += buf.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();
            lines.forEach(take);
        });
        child.stderr.on('data', () => { /* drain */ });
        const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
        }, PING_TIMEOUT_MS);
        const done = (result) => {
            clearTimeout(timer);
            fs.rm(home, { recursive: true, force: true }, () => {});
            resolve(result);
        };
        child.on('error', (err) => done({ ok: false, error: err.message }));
        child.on('close', (code) => {
            if (buffer.trim()) take(buffer);
            if (info) {
                director()._test.noteClaudeUsage(info);
                done({ ok: true, reply: reply.trim() });
                return;
            }
            done({ ok: false, error: `no rate_limit_event (exit ${code})` });
        });
    });
}

// Single entry for the timer and for logins. Never runs two pings at once.
function maybeRefresh(gr, reason, options) {
    if (inflight) return inflight;
    const opts = options || {};
    const now = opts.now || Date.now();
    if (anyClientConnected(gr)) lastClientAt = now;
    if (now - lastClientAt > CLIENT_WINDOW_MS) return Promise.resolve({ skipped: 'no client in 4 hours' });
    if (usageAgeMs(now) < REFRESH_MS) return Promise.resolve({ skipped: 'fresh' });
    if (now - lastAttemptAt < FAIL_BACKOFF_MS) return Promise.resolve({ skipped: 'backoff' });
    lastAttemptAt = now;
    const ping = opts.ping || runPing;
    inflight = Promise.resolve()
        .then(() => ping())
        .then((result) => {
            if (!result.ok) console.warn(`Claude usage refresh (${reason}) failed: ${result.error}`);
            return result;
        })
        .catch((err) => ({ ok: false, error: err.message }))
        .finally(() => { inflight = null; });
    return inflight;
}

// modules/websocket.js on an authenticated connection.
function noteClientLogin(gr) {
    lastClientAt = Date.now();
    void maybeRefresh(gr, 'login');
}

function armClaudeUsageProbe(gr) {
    if (armed || !gr || typeof gr.registerTimer !== 'function') return;
    armed = true;
    gr.registerTimer('claudeUsageProbe', 'interval', () => { void maybeRefresh(gr, 'timer'); }, TICK_MS);
    void maybeRefresh(gr, 'boot');
}

module.exports = {
    armClaudeUsageProbe,
    noteClientLogin,
    maybeRefresh,
    _test: {
        runPing,
        reset() { inflight = null; lastClientAt = 0; lastAttemptAt = 0; },
        state: () => ({ inflight: !!inflight, lastClientAt, lastAttemptAt }),
        REFRESH_MS, CLIENT_WINDOW_MS, FAIL_BACKOFF_MS
    }
};
