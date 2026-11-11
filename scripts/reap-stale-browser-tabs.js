#!/usr/bin/env node
/**
 * Reaps leaked browser tabs on the Dreamscape host. Run from cron (see scripts/reap-stale-browser-tabs.cron).
 *
 * Why: on 2026-11-11 one tab left in the headless test browser grew to 10 GB (9 GB of it swap),
 * the host ran out of memory, and Dreamscape froze with it (Yozora #749).
 *
 * Playwright browsers (~/.cache/ms-playwright, the :9333 headless test browser and any other):
 *   - a renderer over REAP_MAX_RENDERER_MB of memory (resident + swap) is killed at once
 *   - a tab that does not answer for two runs in a row is closed (hung or crashed)
 *   - a tab older than REAP_MAX_TAB_HOURS is closed (about:blank is kept: it holds the browser open)
 *   - a Playwright browser without the test port that is older than REAP_MAX_BROWSER_HOURS is stopped
 * Alchemy (services/grimoire-browser, CDP on ALCHEMY_CDP_PORT):
 *   - only a tab that does not answer for two runs in a row is closed; never the owned tab
 *     (#alchemy-owned), never for age or size
 *
 *   node scripts/reap-stale-browser-tabs.js [--dry]
 *
 * Env: REAP_TEST_CDP_PORT (9333), ALCHEMY_CDP_PORT (9339), REAP_MAX_TAB_HOURS (24),
 *      REAP_MAX_RENDERER_MB (3072), REAP_MAX_BROWSER_HOURS (12), REAP_PROBE_MS (15000),
 *      REAP_STATE_DIR (~/.cache/dreamscape-tab-reaper)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const DRY = process.argv.includes('--dry');
const TEST_PORT = Number(process.env.REAP_TEST_CDP_PORT || 9333);
const ALCHEMY_PORT = Number(process.env.ALCHEMY_CDP_PORT || 9339);
const MAX_TAB_MS = Number(process.env.REAP_MAX_TAB_HOURS || 24) * 3600 * 1000;
const MAX_RENDERER_KB = Number(process.env.REAP_MAX_RENDERER_MB || 3072) * 1024;
const MAX_BROWSER_S = Number(process.env.REAP_MAX_BROWSER_HOURS || 12) * 3600;
const PROBE_MS = Number(process.env.REAP_PROBE_MS || 15000);
const STATE_DIR = process.env.REAP_STATE_DIR || path.join(os.homedir(), '.cache', 'dreamscape-tab-reaper');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const ALCHEMY_OWNED_MARKER = '#alchemy-owned';
const PLAYWRIGHT_MARK = '/ms-playwright/';

function log(message) {
    console.log(`${new Date().toISOString()} ${DRY ? '[dry] ' : ''}${message}`);
}

function httpJson(port, urlPath, method = 'GET') {
    return new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, timeout: 8000 }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => { try { resolve(JSON.parse(body)); } catch (_) { resolve(body); } });
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
        req.end();
    });
}

/** Ask a tab for its age. { ok: true, ageMs } when it answers, { ok: false } when it does not. */
function probe(target) {
    return new Promise((resolve) => {
        if (!target.webSocketDebuggerUrl) return resolve({ ok: false, why: 'no debugger address' });
        let done = false;
        const finish = (result) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { ws.terminate(); } catch (_) { /* already gone */ }
            resolve(result);
        };
        const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'), { perMessageDeflate: false, handshakeTimeout: PROBE_MS });
        const timer = setTimeout(() => finish({ ok: false, why: 'no answer' }), PROBE_MS);
        ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'Date.now() - performance.timeOrigin', returnByValue: true } })));
        ws.on('message', (data) => {
            let msg;
            try { msg = JSON.parse(data); } catch (_) { return; }
            if (msg.id !== 1) return;
            if (msg.error) return finish({ ok: false, why: msg.error.message || 'error' });
            finish({ ok: true, ageMs: Number(msg.result && msg.result.result && msg.result.result.value) || 0 });
        });
        ws.on('error', () => finish({ ok: false, why: 'cannot attach' }));
        ws.on('close', () => finish({ ok: false, why: 'closed' }));
    });
}

function readState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return { misses: {} }; }
}

function writeState(state) {
    if (DRY) return;
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

async function closeTab(port, target, reason) {
    log(`close tab ${String(target.id).slice(0, 8)} on :${port} (${reason}) ${String(target.url || '').slice(0, 80)}`);
    if (!DRY) await httpJson(port, `/json/close/${target.id}`);
}

/** One CDP browser: probe every page, close the hung (two runs) and, when maxAgeMs is set, the old. */
async function sweepBrowser(port, state, seen, { maxAgeMs = 0, keep = () => false } = {}) {
    const targets = await httpJson(port, '/json/list');
    if (!Array.isArray(targets)) return;
    for (const target of targets.filter((t) => t.type === 'page')) {
        const key = `${port}:${target.id}`;
        seen.add(key);
        if (keep(target)) continue;
        const result = await probe(target);
        if (!result.ok) {
            const misses = (state.misses[key] || 0) + 1;
            state.misses[key] = misses;
            if (misses >= 2) {
                await closeTab(port, target, `no answer for ${misses} runs: ${result.why}`);
                delete state.misses[key];
            } else {
                log(`tab ${String(target.id).slice(0, 8)} on :${port} did not answer (${result.why}); closed next run if still so`);
            }
            continue;
        }
        delete state.misses[key];
        if (maxAgeMs && result.ageMs > maxAgeMs) await closeTab(port, target, `open for ${(result.ageMs / 3600000).toFixed(1)} h`);
    }
}

// ---- processes (Linux /proc) -----------------------------------------------------------------

function processes() {
    const out = [];
    const clockTicks = 100;
    const uptime = Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
    for (const name of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(name)) continue;
        try {
            const cmd = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8').replace(/\0/g, ' ');
            if (!cmd.includes(PLAYWRIGHT_MARK)) continue;
            const status = fs.readFileSync(`/proc/${name}/status`, 'utf8');
            const stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
            const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            const kb = (key) => Number((new RegExp(`${key}:\\s+(\\d+) kB`).exec(status) || [])[1] || 0);
            out.push({
                pid: Number(name),
                ppid: Number(fields[1]),
                cmd,
                memKb: kb('VmRSS') + kb('VmSwap'),
                ageS: uptime - Number(fields[19]) / clockTicks,
                uid: Number((/Uid:\s+(\d+)/.exec(status) || [])[1])
            });
        } catch (_) { /* gone while reading */ }
    }
    return out.filter((p) => p.uid === process.getuid());
}

function kill(pid, signal, why) {
    log(`${signal} pid ${pid} (${why})`);
    if (DRY) return;
    try { process.kill(pid, signal); } catch (e) { log(`  could not signal ${pid}: ${e.code || e.message}`); }
}

function sweepPlaywrightProcesses() {
    const procs = processes();
    for (const p of procs) {
        const isRenderer = p.cmd.includes('--type=renderer');
        if (isRenderer && p.memKb > MAX_RENDERER_KB) {
            kill(p.pid, 'SIGKILL', `Playwright renderer holding ${(p.memKb / 1048576).toFixed(1)} GB, up ${(p.ageS / 3600).toFixed(1)} h`);
        }
        // the browser itself: not one of its helpers (renderer, gpu, zygote, utility, crashpad handler)
        const isBrowser = !p.cmd.includes('--type=') && !p.cmd.includes('crashpad');
        if (isBrowser && !p.cmd.includes(`--remote-debugging-port=${TEST_PORT}`) && p.ageS > MAX_BROWSER_S) {
            kill(p.pid, 'SIGTERM', `Playwright browser left running for ${(p.ageS / 3600).toFixed(1)} h`);
        }
    }
}

(async () => {
    const state = readState();
    if (!state.misses) state.misses = {};
    const seen = new Set();
    sweepPlaywrightProcesses();
    await sweepBrowser(TEST_PORT, state, seen, { maxAgeMs: MAX_TAB_MS, keep: (t) => String(t.url || '') === 'about:blank' });
    await sweepBrowser(ALCHEMY_PORT, state, seen, { keep: (t) => String(t.url || '').includes(ALCHEMY_OWNED_MARKER) });
    for (const key of Object.keys(state.misses)) if (!seen.has(key)) delete state.misses[key];
    writeState(state);
})().catch((e) => { log(`failed: ${e.stack || e.message}`); process.exit(1); });
