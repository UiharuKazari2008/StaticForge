#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const SERVER_ORIGIN = process.env.DREAMSCAPE_AGENT_SERVER || 'http://127.0.0.1:9220';
const CDP_HOST = '127.0.0.1';
const CDP_PORT = Number(process.env.DREAMSCAPE_AGENT_CDP_PORT || 9334);
const CDP_ORIGIN = `http://${CDP_HOST}:${CDP_PORT}`;
const PROFILE_DIR = process.env.DREAMSCAPE_AGENT_CLIENT_PROFILE
    || path.join(os.homedir(), '.cache', 'dreamscape-agent-client', 'chromium');
const APP_KEY_PATH = process.env.DREAMSCAPE_AGENT_CLIENT_KEY_FILE
    || path.join(os.homedir(), '.config', 'dreamscape-agent-client', 'app-key');
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 DreamscapeDedicatedAgentClient/1.0';
const READY_STATES = new Set(['desktop', 'ready']);

let chromium = null;
let cdp = null;
let stopping = false;

function log(message) {
    process.stdout.write(`[dedicated-agent-client] ${message}\n`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readApplicationKey() {
    const key = fs.readFileSync(APP_KEY_PATH, 'utf8').trim();
    if (!key.startsWith('sfapp_')) throw new Error('Dedicated agent client application key is missing or invalid');
    return key;
}

function requestJson(url, options = {}) {
    return new Promise((resolve, reject) => {
        const request = http.request(url, options, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`HTTP ${response.statusCode} from ${new URL(url).pathname}`));
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new Error(`Invalid JSON from ${new URL(url).pathname}: ${error.message}`));
                }
            });
        });
        request.setTimeout(3000, () => request.destroy(new Error('HTTP request timed out')));
        request.on('error', reject);
        request.end();
    });
}

async function waitForCdp(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            return await requestJson(`${CDP_ORIGIN}/json/version`);
        } catch (error) {
            lastError = error;
            await sleep(250);
        }
    }
    throw new Error(`Chromium debugging endpoint did not start: ${lastError ? lastError.message : 'timeout'}`);
}

async function getPageTarget() {
    const targets = await requestJson(`${CDP_ORIGIN}/json/list`);
    const page = targets.find((target) => target.type === 'page');
    if (page) return page;
    return requestJson(`${CDP_ORIGIN}/json/new?about%3Ablank`, { method: 'PUT' });
}

class CdpConnection {
    constructor(webSocketUrl) {
        this.nextId = 1;
        this.pending = new Map();
        this.handlers = new Map();
        this.socket = new WebSocket(webSocketUrl);
    }

    async open() {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('CDP WebSocket connection timed out')), 5000);
            this.socket.once('open', () => {
                clearTimeout(timer);
                resolve();
            });
            this.socket.once('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
        this.socket.on('message', (data) => this.handleMessage(data));
        this.socket.on('close', () => this.rejectPending(new Error('CDP WebSocket closed')));
        this.socket.on('error', (error) => this.rejectPending(error));
    }

    handleMessage(data) {
        let message;
        try {
            message = JSON.parse(String(data));
        } catch (_) {
            return;
        }
        if (message.id) {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            clearTimeout(pending.timer);
            if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed'));
            else pending.resolve(message.result || {});
            return;
        }
        const handlers = this.handlers.get(message.method);
        if (handlers) handlers.forEach((handler) => handler(message.params || {}));
    }

    rejectPending(error) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }

    on(method, handler) {
        const handlers = this.handlers.get(method) || [];
        handlers.push(handler);
        this.handlers.set(method, handlers);
    }

    send(method, params = {}, timeoutMs = 10000) {
        if (this.socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('CDP WebSocket is not open'));
        }
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} timed out`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    close() {
        if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
            this.socket.close();
        }
    }
}

async function evaluate(connection, expression) {
    const result = await connection.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Client evaluation failed');
    }
    return result.result ? result.result.value : undefined;
}

async function waitForValue(connection, expression, predicate, description, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    let lastValue;
    while (Date.now() < deadline) {
        try {
            lastValue = await evaluate(connection, expression);
            if (predicate(lastValue)) return lastValue;
        } catch (_) {
            // Navigation temporarily destroys the execution context.
        }
        await sleep(250);
    }
    throw new Error(`Timed out waiting for ${description}; last value: ${JSON.stringify(lastValue)}`);
}

function findChromium() {
    const configured = process.env.DREAMSCAPE_AGENT_CHROMIUM;
    const candidates = [configured, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
    const binary = candidates.find((candidate) => candidate && fs.existsSync(candidate));
    if (!binary) throw new Error('No Chromium binary found');
    return binary;
}

function startChromium() {
    fs.mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
    chromium = spawn(findChromium(), [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        `--remote-debugging-address=${CDP_HOST}`,
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE_DIR}`,
        '--window-size=1920,1200',
        `--user-agent=${USER_AGENT}`,
        'about:blank'
    ], {
        cwd: ROOT,
        stdio: ['ignore', 'ignore', 'ignore']
    });
    chromium.once('exit', (code, signal) => {
        if (!stopping) {
            log(`Chromium exited unexpectedly (${signal || code}); supervisor will restart it`);
            process.exitCode = 1;
            shutdown();
        }
    });
    chromium.once('error', (error) => {
        log(`Chromium failed to start: ${error.message}`);
        process.exitCode = 1;
        shutdown();
    });
}

async function authenticateAndOpenClient(connection) {
    const key = readApplicationKey();
    let appRequestCleared = false;

    connection.on('Fetch.requestPaused', async (event) => {
        try {
            const requestUrl = new URL(event.request.url);
            if (requestUrl.origin === SERVER_ORIGIN && requestUrl.pathname === '/app') {
                const headers = Object.entries(event.request.headers)
                    .filter(([name]) => !['authorization', 'x-staticforge-app-key'].includes(name.toLowerCase()))
                    .map(([name, value]) => ({ name, value: String(value) }));
                await connection.send('Fetch.continueRequest', { requestId: event.requestId, headers });
                appRequestCleared = true;
                await connection.send('Network.setExtraHTTPHeaders', { headers: {} });
                return;
            }
            await connection.send('Fetch.continueRequest', { requestId: event.requestId });
        } catch (error) {
            log(`Request handoff failed: ${error.message}`);
        }
    });

    await connection.send('Page.enable');
    await connection.send('Runtime.enable');
    await connection.send('Network.enable');
    await connection.send('Fetch.enable', {
        patterns: [{ urlPattern: `${SERVER_ORIGIN}/app*`, requestStage: 'Request' }]
    });
    await connection.send('Network.setExtraHTTPHeaders', {
        headers: { 'X-StaticForge-App-Key': key }
    });
    await connection.send('Page.navigate', { url: `${SERVER_ORIGIN}/agent` });
    await waitForValue(
        connection,
        "location.origin === '" + SERVER_ORIGIN + "' && location.pathname === '/app' && new URLSearchParams(location.search).get('agent') === '1'",
        Boolean,
        'the browser-agent app'
    );
    await connection.send('Network.setExtraHTTPHeaders', { headers: {} });
    await connection.send('Fetch.disable');
    if (!appRequestCleared) throw new Error('Application key header was not cleared before the app request');
}

async function registerPriorityClient(connection) {
    await waitForValue(
        connection,
        "typeof getClientDesktopState === 'function' && typeof setAgentPriorityClient === 'function'",
        Boolean,
        'agent client bridge'
    );
    await evaluate(connection, "sessionStorage.setItem('dreamscape.priorityClient', '1'); setAgentPriorityClient(true)");
    const state = await waitForValue(
        connection,
        "({ desktopState: getClientDesktopState(), priority: getAgentPriorityClientState() })",
        (value) => value
            && READY_STATES.has(value.desktopState)
            && value.priority
            && value.priority.registered
            && value.priority.thisClient
            && value.priority.connected,
        'desktop readiness and priority registration',
        90000
    );
    log(`ready (${state.desktopState}); all agent client calls are isolated to this server-side tab`);
}

async function supervise(connection) {
    while (!stopping) {
        await sleep(10000);
        const state = await evaluate(
            connection,
            "({ path: location.pathname, agent: new URLSearchParams(location.search).get('agent'), desktopState: typeof getClientDesktopState === 'function' ? getClientDesktopState() : null, priority: typeof getAgentPriorityClientState === 'function' ? getAgentPriorityClientState() : null })"
        );
        if (!state || state.path !== '/app' || state.agent !== '1') {
            throw new Error('Dedicated tab left browser-agent mode');
        }
        if (!state.priority || !state.priority.registered) {
            await evaluate(connection, "sessionStorage.setItem('dreamscape.priorityClient', '1'); setAgentPriorityClient(true)");
        }
    }
}

async function run() {
    startChromium();
    await waitForCdp();
    const target = await getPageTarget();
    cdp = new CdpConnection(target.webSocketDebuggerUrl);
    await cdp.open();
    await authenticateAndOpenClient(cdp);
    await registerPriorityClient(cdp);
    await supervise(cdp);
}

function shutdown() {
    if (stopping) return;
    stopping = true;
    if (cdp) cdp.close();
    if (chromium && chromium.exitCode === null && !chromium.killed) {
        chromium.kill('SIGTERM');
        const forceTimer = setTimeout(() => {
            if (chromium && chromium.exitCode === null) chromium.kill('SIGKILL');
        }, 5000);
        forceTimer.unref();
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run().catch((error) => {
    log(`failed: ${error.message}`);
    process.exitCode = 1;
    shutdown();
});
