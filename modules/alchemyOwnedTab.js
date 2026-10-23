'use strict';

/**
 * Alchemy-owned tab on the dedicated-agent-client Chromium (CDP 127.0.0.1:9334).
 * Reuses that persistent profile. Does not launch another Chrome.
 * Scoped to one owned tab — never the Dreamscape /app?agent=1 priority tab.
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { URL } = require('url');

function loadWebSocket() {
    return require('ws');
}

const CDP_HOST = '127.0.0.1';
const CDP_PORT = Number(process.env.DREAMSCAPE_AGENT_CDP_PORT || 9334);
const ALCHEMY_OWNED_HASH = 'alchemy-owned';
const ALCHEMY_BLANK_URL = `about:blank#${ALCHEMY_OWNED_HASH}`;
const DEFAULT_ACTION_GAP_MS = 700;
const DEFAULT_NAV_TIMEOUT_MS = 45000;
const STATE_DIR = path.join(os.homedir(), '.cache', 'dreamscape-agent-client');
const STATE_FILE = path.join(STATE_DIR, 'alchemy-owned-tab.json');

const DISCORD_WRITE_SELECTOR_RE = new RegExp([
    'data-slate',
    'slate-editor',
    'role=["\']textbox["\']',
    'contenteditable',
    'placeholder=["\']Message',
    'aria-label=["\']Send( a | Message|)',
    'aria-label=["\']Add Reaction',
    'aria-label=["\']React',
    'aria-label=["\']Reply',
    'aria-label=["\']Edit( Message)?',
    'aria-label=["\']Forward',
    'aria-label=["\']Upload',
    'aria-label=["\']Attach',
    'aria-label=["\']Gift',
    'aria-label=["\']Open GIF',
    'aria-label=["\']Open sticker',
    'aria-label=["\']Open emoji',
    'class\\*=["\'][^"\']*attachButton',
    'class\\*=["\'][^"\']*emojiButton',
    'class\\*=["\'][^"\']*reactionsInner',
    'class\\*=["\'][^"\']*reactionInner',
    'button\\[type=["\']submit["\']'
].join('|'), 'i');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(url, options = {}) {
    return new Promise((resolve, reject) => {
        const request = http.request(url, options, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`HTTP ${response.statusCode} from ${url}`));
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
                }
            });
        });
        request.setTimeout(3000, () => request.destroy(new Error('CDP HTTP timed out')));
        request.on('error', reject);
        request.end();
    });
}

function parseUrlSafe(raw) {
    try {
        return new URL(String(raw || ''));
    } catch (_) {
        return null;
    }
}

function isDreamscapeAgentUrl(url) {
    const parsed = parseUrlSafe(url);
    if (!parsed) return false;
    if (parsed.pathname === '/agent') return true;
    return parsed.pathname === '/app' && parsed.searchParams.get('agent') === '1';
}

function isAlchemyOwnedUrl(url) {
    const text = String(url || '');
    if (text.includes(`#${ALCHEMY_OWNED_HASH}`)) return true;
    const parsed = parseUrlSafe(text);
    if (!parsed) return false;
    return parsed.hash === `#${ALCHEMY_OWNED_HASH}`
        || parsed.searchParams.get(ALCHEMY_OWNED_HASH) === '1';
}

function isDreamscapeAgentTarget(target) {
    return !!(target && target.type === 'page' && isDreamscapeAgentUrl(target.url));
}

function isAlchemyOwnedTarget(target) {
    if (!target || target.type !== 'page') return false;
    if (isDreamscapeAgentTarget(target)) return false;
    if (isAlchemyOwnedUrl(target.url)) return true;
    const title = String(target.title || '');
    return title === 'Alchemy owned' || title.indexOf('[Alchemy owned]') === 0;
}

function pickDreamscapeAgentTarget(targets) {
    const list = Array.isArray(targets) ? targets : [];
    return list.find(isDreamscapeAgentTarget) || null;
}

function pickAlchemyOwnedTarget(targets) {
    const list = Array.isArray(targets) ? targets : [];
    const marked = list.find(isAlchemyOwnedTarget);
    if (marked) return marked;
    const pages = list.filter((target) => target && target.type === 'page' && !isDreamscapeAgentTarget(target));
    return pages[0] || null;
}

function isHttpOrBlank(url) {
    const parsed = parseUrlSafe(url);
    if (!parsed) return false;
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'about:';
}

function isDiscordHost(url) {
    const parsed = parseUrlSafe(url);
    if (!parsed) return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'discord.com' || host === 'discordapp.com' || host.endsWith('.discord.com') || host.endsWith('.discordapp.com');
}

function isDiscordWriteSelector(selector) {
    const text = String(selector || '').trim();
    if (!text) return false;
    return DISCORD_WRITE_SELECTOR_RE.test(text);
}

function createPacer(options) {
    const minGapMs = Math.max(0, Number(options && options.minGapMs) || DEFAULT_ACTION_GAP_MS);
    const nowFn = (options && options.now) || Date.now;
    const sleepFn = (options && options.sleep) || sleep;
    let lastAt = 0;
    return {
        minGapMs,
        async wait() {
            const now = nowFn();
            const waitMs = lastAt ? Math.max(0, minGapMs - (now - lastAt)) : 0;
            if (waitMs) await sleepFn(waitMs);
            lastAt = nowFn();
            return waitMs;
        }
    };
}

function readState(readFileFn) {
    const read = readFileFn || ((file) => fs.readFileSync(file, 'utf8'));
    try {
        const raw = JSON.parse(read(STATE_FILE));
        return raw && typeof raw === 'object' ? raw : {};
    } catch (_) {
        return {};
    }
}

function writeState(state, writeFileFn, mkdirFn) {
    const mkdir = mkdirFn || ((dir) => fs.mkdirSync(dir, { recursive: true, mode: 0o700 }));
    const write = writeFileFn || ((file, text) => fs.writeFileSync(file, text, { mode: 0o600 }));
    mkdir(STATE_DIR);
    write(STATE_FILE, JSON.stringify(state && typeof state === 'object' ? state : {}, null, 2));
}

class CdpConnection {
    constructor(webSocketUrl) {
        this.nextId = 1;
        this.pending = new Map();
        this.socket = new loadWebSocket()(webSocketUrl);
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
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed'));
        else pending.resolve(message.result || {});
    }

    rejectPending(error) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }

    send(method, params, timeoutMs) {
        if (this.socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('CDP WebSocket is not open'));
        }
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} timed out`));
            }, timeoutMs || 15000);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.send(JSON.stringify({ id, method, params: params || {} }));
        });
    }

    isOpen() {
        return this.socket.readyState === WebSocket.OPEN;
    }

    close() {
        if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
            this.socket.close();
        }
        this.rejectPending(new Error('CDP WebSocket closed'));
    }
}

const CLICK_WRITE_GUARD = `(function(el){
    if (!el || !el.getAttribute) return false;
    const aria = String(el.getAttribute('aria-label') || '');
    const role = String(el.getAttribute('role') || '');
    const type = String(el.getAttribute('type') || '');
    const placeholder = String(el.getAttribute('placeholder') || '');
    const name = ((el.className && el.className.toString) ? el.className.toString() : String(el.className || '')).toLowerCase();
    if (el.isContentEditable || role === 'textbox' || type === 'submit') return true;
    if (/send message|add reaction|^react$|^reply$|^edit|forward|upload a file|attach|gift|open gif|open sticker|open emoji picker/i.test(aria)) return true;
    if (/message #|message @/i.test(placeholder)) return true;
    if (/attachbutton|emojibutton|reactionsinner|reactioninner/.test(name)) return true;
    return false;
})`;

class AlchemyOwnedTab {
    constructor(options) {
        const opts = options && typeof options === 'object' ? options : {};
        this.host = opts.host || CDP_HOST;
        this.port = Number(opts.port || CDP_PORT);
        this.origin = `http://${this.host}:${this.port}`;
        this.requestJson = opts.requestJson || requestJson;
        this.CdpConnection = opts.CdpConnection || CdpConnection;
        this.pacer = createPacer({
            minGapMs: opts.minGapMs,
            now: opts.now,
            sleep: opts.sleep
        });
        this.sleep = opts.sleep || sleep;
        this.readState = opts.readState || readState;
        this.writeState = opts.writeState || writeState;
        this.connection = null;
        this.target = null;
    }

    isOpen() {
        return !!(this.connection && this.connection.isOpen());
    }

    async listTargets() {
        return this.requestJson(`${this.origin}/json/list`);
    }

    async createOwnedTarget() {
        const encoded = encodeURIComponent(ALCHEMY_BLANK_URL);
        return this.requestJson(`${this.origin}/json/new?${encoded}`, { method: 'PUT' });
    }

    async connect() {
        let targets;
        try {
            targets = await this.listTargets();
        } catch (error) {
            const err = new Error(`Alchemy Chromium is not reachable on ${this.host}:${this.port}. The dedicated-agent-client service must be running.`);
            err.code = 'ALCHEMY_CDP_OFFLINE';
            err.cause = error;
            throw err;
        }
        if (pickDreamscapeAgentTarget(targets) && !pickAlchemyOwnedTarget(targets)) {
            try {
                await this.createOwnedTarget();
                targets = await this.listTargets();
            } catch (_) {
                // keep going; pickAlchemyOwnedTarget may still find a non-agent page
            }
        }
        let target = pickAlchemyOwnedTarget(targets);
        if (!target) {
            target = await this.createOwnedTarget();
        }
        if (!target || isDreamscapeAgentTarget(target)) {
            const err = new Error('Alchemy-owned tab is not available; refused to use the Dreamscape agent tab');
            err.code = 'ALCHEMY_TAB_UNAVAILABLE';
            throw err;
        }
        if (!target.webSocketDebuggerUrl) {
            throw new Error('Alchemy-owned tab has no CDP debugger URL');
        }
        if (this.connection) this.connection.close();
        this.connection = new this.CdpConnection(target.webSocketDebuggerUrl);
        await this.connection.open();
        await this.connection.send('Page.enable');
        await this.connection.send('Runtime.enable');
        this.target = target;
        return this.info();
    }

    async ensure() {
        if (this.isOpen()) return this.info();
        return this.connect();
    }

    async send(method, params, timeoutMs) {
        if (!this.isOpen()) await this.connect();
        return this.connection.send(method, params, timeoutMs);
    }

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception && result.exceptionDetails.exception.description
                ? result.exceptionDetails.exception.description
                : (result.exceptionDetails.text || 'Alchemy evaluate failed'));
        }
        return result.result ? result.result.value : undefined;
    }

    async info() {
        const page = await this.evaluate("({ url: location.href, title: document.title, readyState: document.readyState })");
        return {
            url: page && page.url ? page.url : (this.target && this.target.url) || '',
            title: page && page.title ? page.title : (this.target && this.target.title) || '',
            readyState: page && page.readyState ? page.readyState : '',
            owned: true
        };
    }

    async navigate(url) {
        const targetUrl = String(url || '').trim();
        if (!targetUrl) throw new Error('url is required');
        if (!isHttpOrBlank(targetUrl)) {
            const err = new Error('Alchemy navigate only accepts http(s) or about: URLs');
            err.code = 'ALCHEMY_URL_REFUSED';
            throw err;
        }
        await this.pacer.wait();
        await this.send('Page.navigate', { url: targetUrl }, DEFAULT_NAV_TIMEOUT_MS);
        const deadline = Date.now() + DEFAULT_NAV_TIMEOUT_MS;
        let last = null;
        while (Date.now() < deadline) {
            try {
                last = await this.evaluate("document.readyState");
                if (last === 'interactive' || last === 'complete') break;
            } catch (_) {
                // navigation destroys the execution context
            }
            await this.sleep(200);
        }
        const info = await this.info();
        this.writeState({
            url: info.url,
            title: info.title,
            updatedAt: new Date().toISOString()
        });
        return info;
    }

    async scroll(input) {
        const opts = input && typeof input === 'object' ? input : {};
        const amount = Number.isFinite(Number(opts.amount)) ? Number(opts.amount) : 800;
        const direction = String(opts.direction || 'down').toLowerCase();
        const delta = direction === 'up' || direction === 'left' ? -Math.abs(amount) : Math.abs(amount);
        const horizontal = direction === 'left' || direction === 'right';
        const selector = String(opts.selector || '').trim();
        if (selector && isDiscordWriteSelector(selector)) {
            const err = new Error('Refused Discord write selector');
            err.code = 'DISCORD_WRITE_REFUSED';
            throw err;
        }
        await this.pacer.wait();
        return this.evaluate(`(function(){
            var sel = ${JSON.stringify(selector)};
            var node = sel ? document.querySelector(sel) : (document.scrollingElement || document.documentElement);
            if (!node) throw new Error('scroll target not found');
            if (${horizontal ? 'true' : 'false'}) node.scrollBy(${delta}, 0);
            else node.scrollBy(0, ${delta});
            return { top: node.scrollTop || window.scrollY || 0, left: node.scrollLeft || window.scrollX || 0 };
        })()`);
    }

    async click(input) {
        const opts = input && typeof input === 'object' ? input : {};
        const selector = String(opts.selector || '').trim();
        const x = opts.x != null ? Number(opts.x) : null;
        const y = opts.y != null ? Number(opts.y) : null;
        const info = await this.info();
        if (isDiscordHost(info.url)) {
            if (selector && isDiscordWriteSelector(selector)) {
                const err = new Error('Refused Discord write click (compose, react, reply, or send)');
                err.code = 'DISCORD_WRITE_REFUSED';
                throw err;
            }
            if (!selector && Number.isFinite(x) && Number.isFinite(y)) {
                const err = new Error('Refused coordinate click on Discord; use a read-only selector or navigate by URL');
                err.code = 'DISCORD_WRITE_REFUSED';
                throw err;
            }
        }
        if (!selector && !(Number.isFinite(x) && Number.isFinite(y))) {
            throw new Error('click needs selector or x,y');
        }
        await this.pacer.wait();
        if (selector) {
            return this.evaluate(`(function(){
                var el = document.querySelector(${JSON.stringify(selector)});
                if (!el) throw new Error('click target not found');
                if (${CLICK_WRITE_GUARD}(el) && /discord\\.com|discordapp\\.com/i.test(location.hostname)) {
                    throw new Error('Refused Discord write click (compose, react, reply, or send)');
                }
                el.click();
                return { clicked: true, selector: ${JSON.stringify(selector)} };
            })()`);
        }
        await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        return { clicked: true, x, y };
    }

    async readText(input) {
        const opts = input && typeof input === 'object' ? input : {};
        const maxChars = Math.min(200000, Math.max(1, Number(opts.maxChars) || 40000));
        const selector = String(opts.selector || '').trim();
        await this.pacer.wait();
        const text = await this.evaluate(`(function(){
            var sel = ${JSON.stringify(selector)};
            var node = sel ? document.querySelector(sel) : document.body;
            if (!node) return '';
            return (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
        })()`);
        const full = String(text || '');
        return {
            text: full.length > maxChars ? full.slice(0, maxChars) : full,
            truncated: full.length > maxChars,
            length: full.length
        };
    }

    async readDom(input) {
        const opts = input && typeof input === 'object' ? input : {};
        const maxChars = Math.min(200000, Math.max(1, Number(opts.maxChars) || 40000));
        const selector = String(opts.selector || '').trim();
        await this.pacer.wait();
        const html = await this.evaluate(`(function(){
            var sel = ${JSON.stringify(selector)};
            var node = sel ? document.querySelector(sel) : document.documentElement;
            if (!node) return '';
            return node.outerHTML || '';
        })()`);
        const full = String(html || '');
        return {
            html: full.length > maxChars ? full.slice(0, maxChars) : full,
            truncated: full.length > maxChars,
            length: full.length
        };
    }

    close() {
        if (this.connection) this.connection.close();
        this.connection = null;
        this.target = null;
    }
}

let sharedTab = null;

function resetSharedTab() {
    if (sharedTab) sharedTab.close();
    sharedTab = null;
}

async function getSharedTab(options) {
    if (sharedTab && sharedTab.isOpen()) return sharedTab;
    sharedTab = new AlchemyOwnedTab(options);
    await sharedTab.connect();
    return sharedTab;
}

async function runBrowserOp(op, input, options) {
    const name = String(op || '').trim();
    const args = input && typeof input === 'object' ? input : {};
    const tab = options && options.tab ? options.tab : await getSharedTab(options);
    if (name === 'info' || name === 'page_info' || name === '') {
        return { success: true, op: 'info', page: await tab.info() };
    }
    if (name === 'navigate') {
        const page = await tab.navigate(args.url);
        return { success: true, op: 'navigate', page };
    }
    if (name === 'scroll') {
        const scroll = await tab.scroll(args);
        return { success: true, op: 'scroll', scroll, page: await tab.info() };
    }
    if (name === 'click') {
        const click = await tab.click(args);
        return { success: true, op: 'click', click, page: await tab.info() };
    }
    if (name === 'read_text' || name === 'readText') {
        const read = await tab.readText(args);
        return { success: true, op: 'read_text', ...read, page: await tab.info() };
    }
    if (name === 'read_dom' || name === 'readDom' || name === 'read_page') {
        const read = await tab.readDom(args);
        return { success: true, op: 'read_dom', ...read, page: await tab.info() };
    }
    const err = new Error(`Unknown alchemy_browser op: ${name}`);
    err.code = 'ALCHEMY_OP_UNKNOWN';
    throw err;
}

module.exports = {
    CDP_HOST,
    CDP_PORT,
    ALCHEMY_OWNED_HASH,
    ALCHEMY_BLANK_URL,
    DEFAULT_ACTION_GAP_MS,
    STATE_FILE,
    isDreamscapeAgentUrl,
    isAlchemyOwnedUrl,
    isDreamscapeAgentTarget,
    isAlchemyOwnedTarget,
    pickDreamscapeAgentTarget,
    pickAlchemyOwnedTarget,
    isHttpOrBlank,
    isDiscordHost,
    isDiscordWriteSelector,
    createPacer,
    readState,
    writeState,
    CdpConnection,
    AlchemyOwnedTab,
    getSharedTab,
    resetSharedTab,
    runBrowserOp,
    requestJson,
    sleep
};
