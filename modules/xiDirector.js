'use strict';

// Xi is the host-side Director persona. Wren keeps its own jail and is not
// changed here. Xi itself now starts inside bubblewrap: the project and one
// home-access folder are bind-mounted, HOME is fresh per launch, and the
// process does not inherit Cursor variables from Dreamscape.
// This process is detached and unref'd so a Dreamscape restart does not kill
// the turn. The server reattaches by tailing the turn log. Diffs stay on disk
// and go to the client only when someone opens that one payload.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const director = require('./cursorDirector');
const xiLaunch = require('./xiLaunch');
const tokenRouter = require('./tokenRouterBridge');
const customProviders = require('./customModelProviders');

// Xi runs as long as its log keeps growing; 10 minutes of silence stops it. No total cap.
const RUN_IDLE_MS = 10 * 60 * 1000;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'StrReplace', 'Delete', 'ApplyPatch']);
const YOZORA_ISSUE = 'https://yozora.bluesteel.737.jp.net/DreamScape/StaticForge/issues/';

const runs = new Map();
let indexQueue = Promise.resolve();
let boundGr = null;
let xiMcp = null;

function enqueue(fn) {
    const next = indexQueue.then(fn, fn);
    indexQueue = next.then(() => {}, () => {});
    return next;
}

function xiHome() {
    return path.join(os.homedir(), '.cache', 'dreamscape-xi');
}

function layout() {
    const root = xiHome();
    return {
        root,
        chats: path.join(root, 'chats'),
        runs: path.join(root, 'runs'),
        logs: path.join(root, 'logs'),
        indexPath: path.join(root, 'index.json'),
        configDir: path.join(root, 'cursor-config')
    };
}

function chatsDir() {
    return layout().chats;
}

function isEnabled(gr) {
    try {
        const cfg = gr && gr.getConfig && gr.getConfig();
        return !!(cfg && cfg.xi && cfg.xi.enabled === true);
    } catch (_) {
        return false;
    }
}

function workspacePath(gr) {
    const resources = gr || boundGr;
    let asked = '';
    try {
        const cfg = resources && resources.getConfig && resources.getConfig();
        asked = cfg && cfg.xi && typeof cfg.xi.workspace === 'string' ? cfg.xi.workspace.trim() : '';
    } catch (_) { /* default repo */ }
    if (asked) {
        const resolved = path.resolve(asked);
        if (fs.existsSync(resolved)) return resolved;
    }
    return path.resolve(__dirname, '..');
}

// ---- Index store ----
// index.json (the chats with their messages inline) lives in memory. Reading,
// parsing and rewriting the whole file on every 2 s trace save, and parsing it on
// every directorStatus and tools/list, held the event loop (#620). The file format
// is unchanged. Writes are coalesced and land asynchronously; exit and
// SIGINT/SIGTERM flush synchronously (cursorDirector.onExitFlush). With nothing
// pending, an index.json changed outside this process is picked up on the next read.
const INDEX_FLUSH_MS = 500;
let indexStore = null;

function fileStamp(file) {
    try {
        const st = fs.statSync(file);
        return `${st.mtimeMs}:${st.size}:${st.ino}`;
    } catch (_) {
        return null;
    }
}

function parseIndexFile(file) {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && Array.isArray(parsed.chats)) return parsed;
    } catch (_) { /* new */ }
    return { chats: [] };
}

function loadIndexStore(file) {
    const stamp = fileStamp(file);
    indexStore = {
        file,
        index: parseIndexFile(file),
        stamp,
        dirty: false,
        flushing: null,
        timer: null,
        // Bumped by the exit flush, so an async write that started before it does not land after it.
        generation: 0
    };
    return indexStore;
}

function currentIndexStore() {
    const file = layout().indexPath;
    const store = indexStore;
    if (!store || (store.file !== file && !store.dirty && !store.flushing)) return loadIndexStore(file);
    if (!store.dirty && !store.flushing && fileStamp(file) !== store.stamp) return loadIndexStore(file);
    return store;
}

// readIndex hands out a copy (chat records and their message lists), so a writer
// that edits and then throws instead of calling writeIndex leaves the store as it
// was, like the old re-read from disk. Message objects are shared: edit them only
// on the way to writeIndex.
function readIndex() {
    const index = currentIndexStore().index;
    return {
        ...index,
        chats: index.chats.map((chat) => (Array.isArray(chat.messages)
            ? { ...chat, messages: chat.messages.slice() }
            : { ...chat }))
    };
}

function writeIndex(index) {
    const store = currentIndexStore();
    store.index = index;
    store.dirty = true;
    scheduleIndexFlush(store);
}

function scheduleIndexFlush(store) {
    // Registered on the first write, after both modules have finished loading.
    if (typeof director.onExitFlush === 'function') director.onExitFlush(flushIndexStoreSync);
    if (store.timer) return;
    store.timer = setTimeout(() => {
        store.timer = null;
        // A flush in progress reschedules when it finishes.
        if (!store.flushing) flushIndexStore(store);
    }, INDEX_FLUSH_MS);
    if (typeof store.timer.unref === 'function') store.timer.unref();
}

function flushIndexStore(store) {
    if (!store.dirty) return;
    store.dirty = false;
    const generation = store.generation;
    const text = JSON.stringify(store.index);
    const tmp = `${store.file}.${process.pid}.tmp`;
    store.flushing = (async () => {
        await fs.promises.mkdir(path.dirname(store.file), { recursive: true });
        await fs.promises.writeFile(tmp, text);
        if (store.generation !== generation) {
            await fs.promises.unlink(tmp).catch(() => {});
            return;
        }
        await fs.promises.rename(tmp, store.file);
        store.stamp = fileStamp(store.file);
    })().catch((error) => {
        console.error(`Xi index write failed: ${error.message}`);
        store.dirty = true;
    }).finally(() => {
        store.flushing = null;
        if (store.dirty) scheduleIndexFlush(store);
    });
}

// Exit path: write the live index, including a change an unfinished async flush was writing.
function flushIndexStoreSync() {
    const store = indexStore;
    if (!store || (!store.dirty && !store.flushing)) return;
    try {
        store.generation += 1;
        fs.mkdirSync(path.dirname(store.file), { recursive: true });
        const tmp = `${store.file}.${process.pid}.exit.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(store.index));
        fs.renameSync(tmp, store.file);
        store.dirty = false;
        store.stamp = fileStamp(store.file);
    } catch (error) {
        console.error(`Xi index exit flush failed: ${error.message}`);
    }
}

// The live store object, without a copy. readChatWorkspace runs on every MCP call
// while Xi has a session. Read-only callers only: never edit what this returns.
function peekIndex() {
    return currentIndexStore().index;
}

function hasChat(sessionId) {
    if (!sessionId) return false;
    return peekIndex().chats.some((chat) => chat.id === sessionId);
}

function activeSessionId() {
    return runs.size === 1 ? Array.from(runs.keys())[0] : null;
}

function activeChatBrief() {
    const sessionId = activeSessionId();
    if (!sessionId) return null;
    const chat = peekIndex().chats.find((item) => item.id === sessionId);
    if (!chat) return null;
    const choice = chat.choice && typeof chat.choice === 'object' ? chat.choice : {};
    return {
        id: chat.id,
        model: String(choice.id || chat.model || '').trim(),
        engine: String(chat.runtime || '').trim()
    };
}

// In-process Xi tails, including after the agent pid exits while finishRun
// is still settling the session (Yozora #565).
function listActiveRuns() {
    return Array.from(runs.values()).map((run) => ({
        sessionId: run.sessionId,
        pid: run.pid || null,
        name: run.name || 'Xi',
        startedAt: run.startedAt || null,
        settled: run.settled === true
    }));
}

// Runtime of whatever Xi session is currently driving a call through the
// shared "Xi" MCP key (modules/dovecoteMail.js uses this to tell a Cursor
// job's mail apart from a Claude or TokenRouter job's — they share one
// application key). null when no Xi session is running (caller should
// default to 'cursor' so existing sessions without a runtime stay Cursor).
function activeRuntime() {
    const sessionId = activeSessionId();
    if (!sessionId) return null;
    const chat = peekIndex().chats.find((item) => item.id === sessionId);
    return chat ? sanitizeRuntime(chat.runtime) : null;
}

function readChatWorkspace(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) return '';
    const chat = peekIndex().chats.find((item) => item.id === id);
    return chat && typeof chat.workspaceId === 'string' ? chat.workspaceId.trim() : '';
}

function runtimeStatus() {
    const sessionId = activeSessionId();
    let sessionName = null;
    if (sessionId) {
        const chat = peekIndex().chats.find((item) => item.id === sessionId);
        sessionName = chat ? (chat.name || 'Xi') : null;
    }
    return {
        enabled: isEnabled(boundGr),
        running: runs.size > 0,
        sessionId,
        sessionName
    };
}

function chatIsListed(chat) {
    if (!chat) return false;
    if (chat.cursorId) return true;
    return (chat.messages || []).some((item) => item && item.role === 'user' && item.message_type !== 'Attachment');
}

const XI_RUNTIMES = new Set(['cursor', 'claude', 'tokenrouter']);
const XI_TOKENROUTER_DEFAULT_MODEL = tokenRouter.DEFAULT_MODEL;

function sanitizeRuntime(value) {
    const text = String(value || '').trim().toLowerCase();
    if (customProviders.isEngine(text)) return text;
    return XI_RUNTIMES.has(text) ? text : 'cursor';
}

// Claude, TokenRouter, and custom OpenAI providers are Claude CLI sessions.
function usesClaudeCli(runtime) {
    return runtime === 'claude' || runtime === 'tokenrouter' || customProviders.isEngine(runtime);
}

function publicXiSession(chat) {
    return Object.assign(director._test.publicSession(chat), {
        persona: 'xi',
        runtime: sanitizeRuntime(chat && chat.runtime)
    });
}

// The picker only runs at creation (handleDirectorCreateSession); every later
// write path (send message, fork, etc.) must call this before touching chat.runtime.
function assertRuntimeUnchanged(chat, message) {
    if (!message || message.runtime === undefined) return;
    if (sanitizeRuntime(message.runtime) !== sanitizeRuntime(chat.runtime)) {
        const error = new Error('Xi session runtime cannot change after creation');
        error.code = 'RUNTIME_LOCKED';
        throw error;
    }
}

function safeId(value) {
    const text = String(value || '');
    return /^[A-Za-z0-9_-]{4,80}$/.test(text) ? text : '';
}

function shouldPark(row) {
    if (!row || row.type !== 'tool') return false;
    const args = String(row.args || '');
    const result = String(row.result || '');
    if (!args && !result) return false;
    if (EDIT_TOOLS.has(row.name)) return true;
    if (args.length > 500 || result.length > 500) return true;
    return /^diff --git |\n@@ /m.test(`${args}\n${result}`);
}

function diffPath(sessionId, diffId) {
    const sid = safeId(sessionId);
    const did = safeId(diffId);
    if (!sid || !did) return '';
    return path.join(layout().chats, sid, 'diffs', `${did}.json`);
}

// publish runs every 200 ms over every parked row (bodies up to 200 KB). A row is
// written again only when one of the four stored fields changed: a string compare
// against what was last written, not a stringify and sha1 per row per tick. The
// write is async; readToolDiffText serves a body that is still on its way to disk.
const diffWritten = new WeakMap();
const diffWrites = new Map();

function queueDiffWrite(file, body) {
    const busy = diffWrites.get(file);
    if (busy) {
        busy.body = body;
        busy.again = true;
        return;
    }
    const entry = { body, again: false };
    diffWrites.set(file, entry);
    (async () => {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        do {
            entry.again = false;
            await fs.promises.writeFile(file, entry.body);
        } while (entry.again);
    })().catch((error) => {
        console.error(`Xi tool diff write failed: ${error.message}`);
    }).finally(() => {
        diffWrites.delete(file);
    });
}

function markToolDiffs(sessionId, rows) {
    (rows || []).forEach((row) => {
        if (!shouldPark(row)) return;
        if (!row.diffId) row.diffId = crypto.randomBytes(6).toString('hex');
        const fields = {
            name: row.name || '',
            detail: row.detail || '',
            args: row.args || '',
            result: row.result || ''
        };
        const last = diffWritten.get(row);
        if (!last || last.diffId !== row.diffId || last.name !== fields.name || last.detail !== fields.detail
            || last.args !== fields.args || last.result !== fields.result) {
            const file = diffPath(sessionId, row.diffId);
            if (file) queueDiffWrite(file, JSON.stringify(fields));
            diffWritten.set(row, { diffId: row.diffId, ...fields });
        }
        row.hasDiff = true;
        row.diffKind = EDIT_TOOLS.has(row.name) ? 'diff' : 'output';
    });
}

function readToolDiffText(sessionId, diffId) {
    const file = diffPath(sessionId, diffId);
    if (!file) return null;
    const pending = diffWrites.get(file);
    if (!pending && !fs.existsSync(file)) return null;
    let stored;
    try {
        stored = JSON.parse(pending ? pending.body : fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return null;
    }
    const parts = [];
    if (stored.detail) parts.push(String(stored.detail));
    if (stored.args) parts.push(String(stored.args));
    if (stored.result) parts.push(String(stored.result));
    return {
        text: parts.join('\n\n') || '(empty)',
        name: stored.name || '',
        detail: stored.detail || ''
    };
}

// The repo .cursor/mcp.json reads these through ${env:...}. The key stays out of git.
async function ensureXiMcp(gr) {
    if (xiMcp) return;
    try {
        const uuid = gr.getMcpPathUuid();
        if (!uuid) return;
        const port = gr.getConfig({ path: 'port' }) || 9220;
        const key = await director.ensureAppKey(gr, path.join(layout().root, 'key'), 'Xi');
        xiMcp = { url: `http://127.0.0.1:${port}/${uuid}/mcp`, key };
    } catch (err) {
        console.error(`Xi MCP skipped: ${err.message}`);
    }
}

function mcpLaunchEnv() {
    if (!xiMcp) return {};
    return {
        DREAMSCAPE_MCP_URL: xiMcp.url,
        DREAMSCAPE_MCP_KEY: xiMcp.key
    };
}

function launchPlan(agentArgs, options) {
    const opts = options || {};
    return xiLaunch.buildLaunch({
        projectDir: opts.projectDir || workspacePath(boundGr),
        homeAccessDir: opts.homeAccessDir || layout().root,
        agentArgs: agentArgs || [],
        extraEnv: Object.assign({}, mcpLaunchEnv(), opts.extraEnv || {}),
        detach: opts.detach === true,
        runtime: opts.runtime,
        claudeTokenFile: opts.claudeTokenFile,
        secureConfigPath: opts.secureConfigPath,
        accountsDir: opts.accountsDir,
        projectRoot: opts.projectRoot,
        accountId: opts.accountId,
        runRoot: opts.runRoot,
        runHome: opts.runHome,
        command: opts.command,
        includeAgent: opts.includeAgent,
        bwrapBin: opts.bwrapBin,
        agentBin: opts.agentBin,
        cwd: opts.cwd,
        homeDir: opts.homeDir
    });
}

function removeRunHome(runHome) {
    if (!runHome) return;
    try { fs.rmSync(runHome, { recursive: true, force: true }); } catch (_) { /* already gone */ }
}

function pidAlive(pid) {
    const n = Number(pid);
    if (!Number.isFinite(n) || n <= 0) return false;
    try {
        process.kill(n, 0);
        return true;
    } catch (_) {
        return false;
    }
}

function killPid(pid, signal) {
    const n = Number(pid);
    const sig = signal || 'SIGTERM';
    if (!n) return;
    try {
        process.kill(-n, sig);
    } catch (_) {
        try { process.kill(n, sig); } catch (_) { /* already exited */ }
    }
}

function hardStopXi(sessionId) {
    const run = sessionId ? runs.get(sessionId) : null;
    if (!run) return false;
    run.cancelled = true;
    killPid(run.pid, 'SIGTERM');
    setTimeout(() => killPid(run.pid, 'SIGKILL'), 500);
    return true;
}

function cachedModels() {
    try {
        const file = path.join(os.homedir(), '.cache', 'dreamscape-director', 'models.json');
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(parsed.models) ? parsed.models : [];
    } catch (_) {
        return [];
    }
}

function emit(gr, type, data, requestId) {
    const payload = { type, data, timestamp: new Date().toISOString() };
    if (requestId) payload.requestId = requestId;
    let wsServer = null;
    try { wsServer = gr && gr.getWebSocketServer && gr.getWebSocketServer(); } catch (_) { return; }
    if (wsServer && typeof wsServer.broadcast === 'function') wsServer.broadcast(payload);
}

function sendOk(handler, ws, type, requestId, data) {
    handler.sendToClient(ws, {
        type,
        requestId: requestId || null,
        data: Object.assign({ success: true, persona: 'xi', xiEnabled: true }, data || {}),
        timestamp: new Date().toISOString()
    });
}

function assertEnabled(handler, ws, requestId) {
    if (isEnabled(handler && handler.globalResources)) return true;
    if (handler && ws) handler.sendError(ws, 'Xi is not enabled on this server', 'XI_DISABLED', requestId);
    return false;
}

function directorClientId(clientInfo, message) {
    const fromInfo = clientInfo && clientInfo.clientId;
    const fromMessage = message && (message.clientId || message.client_id);
    const id = String(fromInfo || fromMessage || '').trim().toLowerCase();
    return /^[0-9a-f]{12}$/.test(id) ? id : '';
}

function xiIdentityLine(runtime) {
    if (customProviders.isEngine(runtime)) {
        const name = customProviders.displayName(boundGr, runtime);
        return `You are Xi, the host Claude Code agent for this repo, running through ${name}. Wren is the Dreamspace persona. You are not Wren and you are not in the jail.`;
    }
    if (runtime === 'tokenrouter') {
        return 'You are Xi, the host Claude Code agent for this repo, running through TokenRouter. Wren is the Dreamspace persona. You are not Wren and you are not in the jail.';
    }
    if (runtime === 'claude') {
        return 'You are Xi, the host Claude Code agent for this repo. Wren is the Dreamspace persona. You are not Wren and you are not in the jail.';
    }
    return 'You are Xi, the host Cursor agent for this repo. Wren is the Dreamspace persona. You are not Wren and you are not in the jail.';
}

function buildPrompt(chat, userText, files, clientId, options) {
    const runtime = sanitizeRuntime(chat.runtime);
    const lines = [
        xiIdentityLine(runtime),
        'Be short. A few sentences. Do not explain the obvious. Do not paste large code blocks or long examples. Name the file and the change.',
        'clientLink.clientGeneration no-go means generate_image on the server, show_chat_image, and open_in_studio only if Studio is already open. Resolution stays normal unless they name a size. Wallpaper is finish, not the wallpaper resolution preset. Over 1 megapixel needs userApprovedPaidRequest after they agree.',
        `Detail belongs on a Yozora issue. File or update the issue, then link it (${YOZORA_ISSUE}<number>). The issue is the write-up.`,
        'Dreamscape tools are on MCP server dreamscape when the task needs the app. Coding, diagnostics, and debugging are the job. Explore scans use search_explore (compact), count_explore, get_explore_post, and get_explore_image in the Laboratory workspace. Commands are already approved. Do not ask permission to run them.',
        'To ask the user anything, call request_form with chatId. AskQuestion is skipped in this window and they never see it. If it returns pending with a formId, call request_form again with only that formId until values come back.',
        'A client reload is normal. Continue this chat. Do not redo a finished step.',
        `Director chat id: ${chat.id}. Pass chatId on session tools.`,
        chat.workspaceId
            ? `Dreamscape workspace id: ${chat.workspaceId}. If a client has in_workspace false, do not use Studio. Call request_workspace_switch. Glancewell, Lumen, and show_chat_image are still fine. Writes go to this workspace.`
            : 'No Dreamscape workspace is paired yet.',
        `Workspace: ${workspacePath(boundGr)}`
    ];
    if (options && options.memoryStore === 'obliterated') {
        lines.push('Memory store: Obliterated Memories. list_memories, search_memories, get_memory, and save_memory use that shared store. It is not the Studio memory database. Do not pass a Studio model filter.');
    }
    if (options && options.ageTool === false) {
        lines.push('lookup_character_age is turned off for this engine. Do not call it.');
    }
    if (clientId) lines.push(`Studio clientId: ${clientId}. If a tool says not bound, bind_session once with it.`);
    if (files.length) {
        lines.push('Attached files:');
        files.forEach((file) => lines.push(`- ${file}`));
    }
    lines.push('', 'User request:', userText || 'Look at the attached files.');
    return lines.join('\n');
}

// Read on every Claude-runtime Xi turn. The joined text is kept until a rule file is
// added, removed or changed (name, mtime, size, inode). Files touched in the last
// second are read again next time: one timestamp tick can hide a same-size edit.
const RULES_SETTLE_MS = 1000;
let projectRulesCache = null;

function readProjectCursorRules(workspace) {
    const rulesDir = path.join(workspace, '.cursor', 'rules');
    let names = [];
    try { names = fs.readdirSync(rulesDir).filter((name) => name.endsWith('.mdc')); } catch (_) { return ''; }
    names.sort();
    let newest = 0;
    const stamps = names.map((name) => {
        try {
            const st = fs.statSync(path.join(rulesDir, name));
            newest = Math.max(newest, st.mtimeMs);
            return `${name}:${st.mtimeMs}:${st.size}:${st.ino}`;
        } catch (_) {
            return `${name}:-`;
        }
    });
    const key = `${rulesDir}\n${stamps.join('\n')}`;
    if (projectRulesCache && projectRulesCache.key === key) return projectRulesCache.text;
    const joined = names.map((name) => {
        let text = '';
        try { text = fs.readFileSync(path.join(rulesDir, name), 'utf8'); } catch (_) { return ''; }
        return text.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
    }).filter(Boolean).join('\n\n');
    projectRulesCache = Date.now() - newest > RULES_SETTLE_MS ? { key, text: joined } : null;
    return joined;
}

// Claude Code auto-discovers a project CLAUDE.md, but Xi runs against the real
// repo (not a jailed copy like Wren's), so writing one there would dirty git
// status every turn. --append-system-prompt carries the same two sources —
// this project's own .cursor/rules plus the shared Dreamscape MCP instructions
// cursor-agent gets implicitly from the MCP server's initialize message —
// without touching the working tree.
function claudeProjectPrompt(workspace) {
    const { MCP_INSTRUCTIONS, ENSHUTSUKA_MODES } = require('./mcpInstructions');
    const rules = readProjectCursorRules(workspace);
    return [
        rules,
        '## Shared Dreamscape rules (from Enshutsuka)',
        MCP_INSTRUCTIONS,
        ENSHUTSUKA_MODES
    ].filter(Boolean).join('\n\n');
}

// Same Dreamscape MCP server Cursor loads from .cursor/mcp.json, passed inline
// so no file needs to exist inside the jail before the process starts. The
// placeholders are substituted from the jail env (DREAMSCAPE_MCP_URL/_KEY),
// so the key itself never sits in argv.
function claudeMcpConfigArg() {
    return JSON.stringify({
        mcpServers: {
            dreamscape: {
                type: 'http',
                url: '${DREAMSCAPE_MCP_URL}',
                headers: { Authorization: 'Bearer ${DREAMSCAPE_MCP_KEY}' }
            }
        }
    });
}

const CLAUDE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function sanitizeClaudeEffort(value) {
    const text = String(value || '').trim().toLowerCase();
    return CLAUDE_EFFORTS.has(text) ? text : 'medium';
}

function createCursorChat(workspace) {
    return new Promise((resolve, reject) => {
        const plan = launchPlan(['create-chat', '--workspace', workspace], {
            projectDir: workspace,
            detach: false
        });
        const child = spawn(plan.bin, plan.args, {
            env: plan.hostEnv,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const dropHome = () => removeRunHome(plan.runHome);
        let out = '';
        let err = '';
        let settled = false;
        // create-chat prints the id at once but can hang without exiting.
        const stop = () => {
            if (child.exitCode === null && child.signalCode === null) {
                try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
            }
        };
        const chatId = () => String(out || '').split('\n').map((line) => line.trim())
            .find((line) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line)) || null;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(value);
        };
        const timer = setTimeout(() => {
            stop();
            finish(reject, new Error('Creating the Cursor chat timed out'));
        }, 20000);
        child.stdout.on('data', (buf) => {
            out += buf.toString();
            const id = chatId();
            if (id) {
                finish(resolve, id);
                stop();
            }
        });
        child.stderr.on('data', (buf) => { err += buf.toString(); });
        child.on('error', (error) => {
            dropHome();
            finish(reject, error);
        });
        child.on('close', (code) => {
            dropHome();
            const id = chatId();
            if (id) {
                finish(resolve, id);
                return;
            }
            finish(reject, new Error((err || out || `create-chat exited ${code}`).trim().slice(0, 500)));
        });
    });
}

async function storeAttachments(gr, chat, attachments) {
    const saved = [];
    const inbox = path.join(layout().chats, chat.id, 'inbox');
    fs.mkdirSync(inbox, { recursive: true });
    for (const attachment of attachments || []) {
        const file = await director.readAttachment(gr, attachment);
        const destName = `${Date.now()}-${file.name}`;
        const dest = path.join(inbox, destName);
        fs.writeFileSync(dest, file.buffer);
        saved.push(dest);
    }
    return saved;
}

function publish(run) {
    if (!boundGr || !run || !run.stream) return;
    markToolDiffs(run.sessionId, run.stream.rows);
    if (run.stream.live) markToolDiffs(run.sessionId, [run.stream.live]);
    director.parkToolBodies(run.sessionId, run.stream.rows);
    if (run.stream.live) director.parkToolBodies(run.sessionId, [run.stream.live]);
    const wire = director._test.publicTraceRow;
    director.queueDirectorStream(boundGr, {
        sessionId: run.sessionId,
        persona: 'xi',
        rows: (run.stream.rows || []).map(wire),
        live: run.stream.live ? wire(run.stream.live) : null,
        fullContent: (run.stream.live && run.stream.live.text) || run.stream.text || '',
        context: run.stream.context || null,
        model: run.round || null
    });
    if (run.persistTimer) return;
    run.persistTimer = setTimeout(() => {
        run.persistTimer = null;
        saveTrace(run).catch(() => {});
    }, 2000);
}

function saveTrace(run) {
    const rows = (run.stream && run.stream.rows) || [];
    markToolDiffs(run.sessionId, rows);
    director.parkToolBodies(run.sessionId, rows, path.join(layout().chats, director._test.safeName(run.sessionId)));
    const wire = director._test.publicTraceRow;
    const text = (run.stream && run.stream.text) || '';
    const assistant = {
        id: run.draftId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        trace: rows.map(wire),
        data: { Description: text },
        model: run.round || null
    };
    return enqueue(async () => {
        const index = readIndex();
        const chat = index.chats.find((item) => item.id === run.sessionId);
        if (!chat) return;
        chat.messages = chat.messages || [];
        chat.updated_at = new Date().toISOString();
        const claudeSessionId = run.stream && run.stream.sessionId;
        if (claudeSessionId) chat.claudeSessionId = claudeSessionId;
        const mine = director.printsForMessage(chat, run.draftId);
        if (mine.length) assistant.prints = mine;
        const existing = chat.messages.find((item) => item.id === run.draftId);
        if (existing) {
            existing.trace = assistant.trace;
            existing.data = assistant.data;
            if (assistant.model) existing.model = assistant.model;
            if (mine.length) existing.prints = mine;
        } else {
            chat.messages.push(assistant);
        }
        writeIndex(index);
    });
}

function clearInflight(sessionId) {
    return enqueue(async () => {
        const index = readIndex();
        const chat = index.chats.find((item) => item.id === sessionId);
        if (!chat || !chat.inflight) return;
        delete chat.inflight;
        writeIndex(index);
    });
}

function finishRun(run, why) {
    if (!run || run.settled) return;
    if (run.stream && !run.cancelled && !run.stream.error && why === 'exit') {
        const text = run.stream.text || '';
        const rows = run.stream.rows || [];
        if (!text && !rows.length) run.stream.error = 'Xi stopped before it replied';
    }
    run.settled = true;
    removeRunHome(run.runHome);
    if (run.stopPrintWatch) {
        try { run.stopPrintWatch(); } catch (_) { /* watcher already closed */ }
        run.stopPrintWatch = null;
    }
    if (run.timer) clearInterval(run.timer);
    if (run.persistTimer) clearTimeout(run.persistTimer);
    runs.delete(run.sessionId);
    try { fs.unlinkSync(run.metaPath); } catch (_) { /* already gone */ }
    const steered = why === 'steer' || run.steer === true;
    const failed = !steered && !!(run.cancelled || (run.stream && run.stream.error) || why === 'timeout');
    const errorText = run.cancelled
        ? 'Stopped'
        : (why === 'timeout' ? 'Xi stopped because it sent nothing for 10 minutes' : ((run.stream && run.stream.error) || 'Xi stopped'));
    saveTrace(run)
        .then(() => clearInflight(run.sessionId))
        .then(async () => {
            if (!boundGr) return;
            let name = run.name || 'Xi';
            try {
                const chat = peekIndex().chats.find((item) => item.id === run.sessionId);
                if (chat && chat.name) name = chat.name;
            } catch (_) { /* keep the name from the start of the turn */ }
            const text = (run.stream && run.stream.text) || '';
            if (run.deleted) {
                try { director.broadcastDirectorStatus(boundGr); } catch (_) { /* status is best effort */ }
                return;
            }
            if (steered) {
                emit(boundGr, 'director_message_response', {
                    success: true,
                    sessionId: run.sessionId,
                    persona: 'xi',
                    steer: true
                });
                try { director.broadcastDirectorStatus(boundGr); } catch (_) { /* status is best effort */ }
                return;
            }
            if (failed) {
                emit(boundGr, 'director_message_error', {
                    sessionId: run.sessionId,
                    persona: 'xi',
                    error: String(errorText).slice(0, 800),
                    saved: true
                });
            } else {
                emit(boundGr, 'director_message_response', {
                    success: true,
                    sessionId: run.sessionId,
                    persona: 'xi',
                    response: { SuggestedName: name, Description: text || 'Done.' },
                    clientResponse: { Description: text || 'Done.', SuggestedName: name },
                    data: { Description: text || 'Done.' }
                });
                emit(boundGr, 'director_send_message_response', {
                    success: true,
                    sessionId: run.sessionId,
                    persona: 'xi',
                    assistantMessageId: run.draftId
                }, run.requestId);
            }
            try { director.broadcastDirectorStatus(boundGr); } catch (_) { /* status is best effort */ }
        })
        .catch((err) => console.error(`Xi finish skipped: ${err.message}`));
}

const CLAUDE_CONTEXT_WINDOW = 200000;
const TOOL_PAYLOAD_CAP = 200000;

function clipText(value, limit) {
    const text = String(value == null ? '' : value);
    const cap = limit || TOOL_PAYLOAD_CAP;
    return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

function claudeToolResultText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.filter((block) => block && block.type === 'text').map((block) => block.text || '').join('\n');
    }
    return content == null ? '' : JSON.stringify(content);
}

// Claude's `-p --output-format stream-json` (no --include-partial-messages) emits
// one complete message per line, so there is no live/partial row to assemble —
// unlike Cursor's cursor-agent, whose consumeStreamLine deals with text deltas.
// Tool calls arrive as assistant content blocks; their results arrive later as a
// separate `user` event with tool_result blocks keyed by tool_use_id.
function consumeClaudeStreamLine(line, state) {
    let evt;
    try {
        evt = JSON.parse(line);
    } catch (_) {
        return;
    }
    if (!state.rows) state.rows = [];
    if (!state.openTools) state.openTools = new Map();
    if (evt.type === 'system' && evt.subtype === 'init') {
        if (evt.session_id) state.sessionId = evt.session_id;
        return;
    }
    if (evt.type === 'rate_limit_event') {
        director._test.noteClaudeUsage(evt.rate_limit_info);
        return;
    }
    if (evt.type === 'assistant') {
        const blocks = evt.message && Array.isArray(evt.message.content) ? evt.message.content : [];
        blocks.forEach((block) => {
            if (!block) return;
            if (block.type === 'tool_use' && block.name) {
                const row = {
                    type: 'tool',
                    name: block.name,
                    label: block.name,
                    detail: '',
                    args: clipText(JSON.stringify(block.input || {})),
                    result: '',
                    replay: null,
                    text: block.name,
                    _closed: false
                };
                state.rows.push(row);
                if (block.id) state.openTools.set(block.id, row);
                state.tool = block.name;
            } else if (block.type === 'text' && block.text) {
                state.rows.push({ type: 'assistant', text: block.text });
                state.text = `${state.text || ''}${block.text}`;
            }
        });
        return;
    }
    if (evt.type === 'user') {
        const blocks = evt.message && Array.isArray(evt.message.content) ? evt.message.content : [];
        blocks.forEach((block) => {
            if (!block || block.type !== 'tool_result') return;
            const row = block.tool_use_id ? state.openTools.get(block.tool_use_id) : null;
            if (!row) return;
            const text = clipText(claudeToolResultText(block.content));
            row.result = block.is_error ? `Error: ${text}` : text;
            row._closed = true;
        });
        return;
    }
    if (evt.type === 'result') {
        state.finished = true;
        if (evt.is_error) {
            state.error = (typeof evt.result === 'string' && evt.result) || 'Claude run failed';
        } else if (typeof evt.result === 'string' && evt.result.trim() && !state.text) {
            state.text = evt.result.trim();
        }
        if (evt.usage) {
            const prompt = Number(evt.usage.input_tokens || 0)
                + Number(evt.usage.cache_read_input_tokens || 0)
                + Number(evt.usage.cache_creation_input_tokens || 0);
            if (prompt > 0) {
                state.context = { tokens: prompt, percent: Math.min(100, Math.round((prompt / CLAUDE_CONTEXT_WINDOW) * 100)) };
            }
        }
    }
}

function consumeXiStreamLine(runtime, line, state) {
    if (usesClaudeCli(runtime)) {
        consumeClaudeStreamLine(line, state);
        return;
    }
    director._test.consumeStreamLine(line, state);
}

function readNew(run) {
    let size = 0;
    try { size = fs.statSync(run.log).size; } catch (_) { return false; }
    if (size < run.offset) run.offset = 0;
    if (size === run.offset) return false;
    const length = size - run.offset;
    const chunk = Buffer.alloc(length);
    const fd = fs.openSync(run.log, 'r');
    try {
        fs.readSync(fd, chunk, 0, length, run.offset);
    } finally {
        fs.closeSync(fd);
    }
    run.offset = size;
    const lines = `${run.buffer}${chunk.toString()}`.split('\n');
    run.buffer = lines.pop() || '';
    lines.forEach((line) => {
        if (line.trim()) consumeXiStreamLine(run.runtime, line, run.stream);
    });
    return true;
}

function rememberXiPrint(sessionId, filename, messageId) {
    return enqueue(async () => {
        const index = readIndex();
        const chat = index.chats.find((item) => item.id === sessionId);
        if (!chat) return;
        director.stampChatPrint(chat, filename, messageId);
        writeIndex(index);
    });
}

function startTail(meta) {
    if (!meta || !meta.sessionId || runs.has(meta.sessionId)) return;
    const run = {
        sessionId: meta.sessionId,
        pid: meta.pid,
        log: meta.log,
        metaPath: meta.metaPath,
        draftId: meta.draftId,
        round: meta.round || null,
        name: meta.name || 'Xi',
        runtime: sanitizeRuntime(meta.runtime),
        requestId: meta.requestId || null,
        offset: 0,
        buffer: '',
        cancelled: meta.cancelled === true,
        settled: false,
        // Caps start when this server attaches. A restart does not kill the process,
        // and the detached agent is not timed out while nobody is attached.
        startedAt: Date.now(),
        lastActivity: Date.now(),
        timer: null,
        persistTimer: null,
        stream: { text: '', tool: '', error: null, finished: false, rows: [], live: null, context: null, keepToolBodies: true }
    };
    readNew(run);
    if (boundGr) {
        run.stopPrintWatch = director.watchGeneratedPrints(boundGr, (filename) => {
            rememberXiPrint(run.sessionId, filename, run.draftId)
                .then(() => emit(boundGr, 'director_session_image', {
                    chatId: run.sessionId,
                    sessionId: run.sessionId,
                    filename,
                    messageId: run.draftId,
                    persona: 'xi'
                }))
                .catch(() => {});
        });
    }
    runs.set(run.sessionId, run);
    publish(run);
    if (!pidAlive(run.pid)) {
        if (run.buffer.trim()) consumeXiStreamLine(run.runtime, run.buffer, run.stream);
        run.buffer = '';
        finishRun(run, 'exit');
        return;
    }
    emit(boundGr, 'director_typing_start', { sessionId: run.sessionId, persona: 'xi' });
    run.timer = setInterval(() => {
        if (run.settled) return;
        const grew = readNew(run);
        if (grew) run.lastActivity = Date.now();
        if (grew) publish(run);
        if (!pidAlive(run.pid)) {
            if (run.buffer.trim()) consumeXiStreamLine(run.runtime, run.buffer, run.stream);
            run.buffer = '';
            finishRun(run, 'exit');
            return;
        }
        const now = Date.now();
        if (now - run.lastActivity >= RUN_IDLE_MS) {
            run.cancelled = true;
            killPid(run.pid);
            finishRun(run, 'timeout');
        }
    }, 200);
}

function writeMeta(meta) {
    fs.mkdirSync(path.dirname(meta.metaPath), { recursive: true });
    fs.writeFileSync(meta.metaPath, JSON.stringify(meta));
}

function reattachAll() {
    const dir = layout().runs;
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { return 0; }
    let attached = 0;
    names.forEach((name) => {
        if (!name.endsWith('.json')) return;
        const metaPath = path.join(dir, name);
        let meta = null;
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) { return; }
        if (!meta || !meta.sessionId || !meta.log) return;
        meta.metaPath = metaPath;
        if (pidAlive(meta.pid)) {
            startTail(meta);
            attached += 1;
            return;
        }
        startTail(meta);
    });
    return attached;
}

function prepareXi(gr) {
    boundGr = gr;
    if (!isEnabled(gr)) return { enabled: false };
    const paths = layout();
    fs.mkdirSync(paths.chats, { recursive: true });
    fs.mkdirSync(paths.runs, { recursive: true });
    fs.mkdirSync(paths.logs, { recursive: true });
    let cursorLogin = { ok: false, reason: 'missing' };
    try {
        cursorLogin = director.installUnrestrictedCli(paths.configDir);
    } catch (err) {
        console.error(`Xi CLI config skipped: ${err.message}`);
    }
    const attached = reattachAll();
    return { enabled: true, attached, cursorLogin };
}

// PM2 treekill kills every descendant of the server on restart. The shell
// backgrounds the agent and exits, so the agent reparents off the server.
function spawnDetached(args, logPath, workspace, options) {
    const plan = launchPlan(args, Object.assign({ projectDir: workspace, detach: true }, options || {}));
    let out = '';
    try {
        out = execFileSync('/bin/sh', [
            '-c',
            'log="$1"; shift; setsid "$@" >>"$log" 2>&1 </dev/null & echo $!',
            'xi-spawn',
            logPath,
            plan.bin,
            ...plan.args
        ], { cwd: workspace, env: plan.hostEnv, encoding: 'utf8', timeout: 10000 });
    } catch (err) {
        removeRunHome(plan.runHome);
        throw err;
    }
    const pid = parseInt(String(out).trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) {
        removeRunHome(plan.runHome);
        throw new Error('Xi agent did not start');
    }
    return { pid, runHome: plan.runHome };
}

function getActiveXiAccountId(gr) {
    try {
        const secureConfig = gr && typeof gr.getSecureConfig === 'function' ? gr.getSecureConfig() : null;
        if (secureConfig && secureConfig.cursorAccounts && secureConfig.cursorAccounts.xi) {
            return secureConfig.cursorAccounts.xi.activeAccountId || 'default';
        }
    } catch (_) {}
    return 'default';
}

async function handleDirectorGetSessions(handler, ws, message) {
    if (!assertEnabled(handler, ws, message.requestId)) return;
    try {
        const gr = handler.globalResources;
        const index = peekIndex();
        const activeAccId = getActiveXiAccountId(gr);
        const secureConfig = gr && typeof gr.getSecureConfig === 'function' ? gr.getSecureConfig() : null;
        const cursorAccountAuthStore = require('./cursorAccountAuthStore');
        const rawAccounts = (secureConfig && secureConfig.cursorAccounts && secureConfig.cursorAccounts.accounts) || [
            { id: 'default', name: 'Host Account (Default)', isDefault: true }
        ];
        const accounts = rawAccounts.map(cursorAccountAuthStore.publicCursorAccount).filter(Boolean);
        sendOk(handler, ws, 'director_get_sessions_response', message.requestId, {
            sessions: index.chats.filter(chatIsListed).map(publicXiSession).reverse(),
            persona: 'xi',
            activeAccountId: activeAccId,
            accounts
        });
    } catch (error) {
        handler.sendError(ws, error.message || 'Failed to fetch Xi sessions', error.code || 'DIRECTOR_ERROR', message.requestId);
    }
}

async function handleDirectorCreateSession(handler, ws, message) {
    if (!assertEnabled(handler, ws, message.requestId)) return;
    try {
        const gr = handler.globalResources;
        boundGr = gr;
        const activeAccId = getActiveXiAccountId(gr);
        const workspaceId = message.workspaceId || null;
        const chat = await enqueue(async () => {
            const index = readIndex();
            const created = {
                id: `xi_${crypto.randomBytes(8).toString('hex')}`,
                cursorId: null,
                claudeSessionId: null,
                accountId: activeAccId,
                persona: 'xi',
                // Chosen once, at creation. See assertRuntimeUnchanged — nothing
                // after this point may write chat.runtime for an existing chat.
                runtime: sanitizeRuntime(message.runtime),
                name: (message.description || '').trim().slice(0, 48) || 'Xi',
                workspaceId,
                filename: null,
                image_type: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                archived: false,
                model: customProviders.isEngine(sanitizeRuntime(message.runtime))
                    ? ((customProviders.lookup(gr, message.runtime) || {}).defaultModel || XI_TOKENROUTER_DEFAULT_MODEL)
                    : (sanitizeRuntime(message.runtime) === 'tokenrouter'
                        ? XI_TOKENROUTER_DEFAULT_MODEL
                        : director.EFFORT_MODELS.medium),
                replay: false,
                messages: []
            };
            fs.mkdirSync(path.join(layout().chats, created.id, 'inbox'), { recursive: true });
            index.chats.push(created);
            writeIndex(index);
            return created;
        });
        sendOk(handler, ws, 'director_create_session_response', message.requestId, {
            session: Object.assign(publicXiSession(chat), { messages: [] })
        });
    } catch (error) {
        handler.sendError(ws, error.message || 'Failed to create Xi session', error.code || 'DIRECTOR_ERROR', message.requestId);
    }
}

async function handleDirectorGetSession(handler, ws, message) {
    if (!assertEnabled(handler, ws, message.requestId)) return;
    const chat = peekIndex().chats.find((item) => item.id === message.sessionId);
    if (!chat) {
        handler.sendError(ws, 'Session not found', 'SESSION_NOT_FOUND', message.requestId);
        return;
    }
    sendOk(handler, ws, 'director_get_session_response', message.requestId, {
        session: Object.assign(publicXiSession(chat), {
            messages: (chat.messages || []).map(director._test.publicMessage)
        })
    });
    const run = runs.get(message.sessionId);
    if (run) publish(run);
}

async function handleDirectorOpenWorkspace(handler, ws, message) {
    if (!assertEnabled(handler, ws, message.requestId)) return;
    const index = peekIndex();
    const preferred = message.preferredChatId && index.chats.find((chat) => chat.id === message.preferredChatId);
    const byId = message.directorSessionId && index.chats.find((chat) => chat.id === message.directorSessionId);
    const workspaceId = message.workspaceId || null;
    let found = preferred || byId || null;
    if (!found && workspaceId) {
        const matches = index.chats.filter((chat) => chat.workspaceId === workspaceId && chatIsListed(chat));
        found = matches.length ? matches[matches.length - 1] : null;
    }
    if (!found) {
        sendOk(handler, ws, 'director_open_workspace_response', message.requestId, { session: null, draft: true });
        return;
    }
    sendOk(handler, ws, 'director_open_workspace_response', message.requestId, {
        session: Object.assign(publicXiSession(found), {
            messages: (found.messages || []).map(director._test.publicMessage)
        })
    });
}

async function handleDirectorDeleteSession(handler, ws, message) {
    if (!assertEnabled(handler, ws, message.requestId)) return;
    const run = runs.get(message.sessionId);
    if (run) {
        run.deleted = true;
        run.cancelled = true;
        hardStopXi(message.sessionId);
        finishRun(run, 'abort');
    }
    await enqueue(async () => {
        const index = readIndex();
        index.chats = index.chats.filter((chat) => chat.id !== message.sessionId);
        writeIndex(index);
    });
    sendOk(handler, ws, 'director_delete_session_response', message.requestId, {});
}

async function handleDirectorGetMessages(handler, ws, message) {
    if (!assertEnabled(handler, ws, message.requestId)) return;
    const chat = peekIndex().chats.find((item) => item.id === message.sessionId);
    if (!chat) {
        handler.sendError(ws, 'Session not found', 'SESSION_NOT_FOUND', message.requestId);
        return;
    }
    const live = runs.get(chat.id);
    const messages = (chat.messages || []).filter((item) => !live || item.id !== live.draftId);
    sendOk(handler, ws, 'director_get_messages_response', message.requestId, {
        sessionId: chat.id,
        name: chat.name || 'Xi',
        images: Array.isArray(chat.images) ? chat.images : [],
        prints: Array.isArray(chat.prints) ? chat.prints : [],
        tasks: director._test.normalizeSessionTasks(chat.tasks),
        messages: messages.map(director._test.publicMessage)
    });
    const run = runs.get(message.sessionId);
    if (run) publish(run);
}

async function handleDirectorRollbackMessage(handler, ws, message) {
    if (!assertEnabled(handler, ws, message.requestId)) return;
    if (runs.has(message.sessionId)) {
        handler.sendError(ws, 'Xi is still working on that chat', 'DIRECTOR_BUSY', message.requestId);
        return;
    }
    const removed = await enqueue(async () => {
        const index = readIndex();
        const chat = index.chats.find((item) => item.id === message.sessionId);
        if (!chat) return null;
        const messages = chat.messages || [];
        const indexAt = messages.findIndex((item) => item.id === message.messageId || item.timestamp === message.messageId);
        if (indexAt < 0) return false;
        let cut = indexAt;
        let source = messages[indexAt];
        if (message.retry && source.role !== 'user') {
            for (let i = indexAt - 1; i >= 0; i--) {
                if (messages[i].role === 'user') {
                    source = messages[i];
                    cut = i;
                    break;
                }
            }
        }
        const retryText = message.retry ? (source.user_input || source.content || '') : '';
        chat.messages = messages.slice(0, cut);
        chat.cursorId = null;
        chat.replay = chat.messages.length > 0;
        writeIndex(index);
        return { retryText };
    });
    if (removed === null) {
        handler.sendError(ws, 'Session not found', 'SESSION_NOT_FOUND', message.requestId);
        return;
    }
    if (removed === false) {
        handler.sendError(ws, 'Message not found', 'MESSAGE_NOT_FOUND', message.requestId);
        return;
    }
    sendOk(handler, ws, 'director_rollback_message_response', message.requestId, {
        message: message.retry ? 'Dropped the later replies and queued a retry' : 'Messages rolled back',
        sessionId: message.sessionId,
        retryText: removed.retryText || ''
    });
}

async function handleDirectorSendMessage(handler, ws, message, clientInfo) {
    if (!assertEnabled(handler, ws, message.requestId)) return;
    const sessionId = message.sessionId;
    try {
        const gr = handler.globalResources;
        boundGr = gr;
        if (!sessionId) {
            handler.sendError(ws, 'Session ID is required', 'MISSING_PARAMETERS', message.requestId);
            return;
        }
        if (runs.has(sessionId)) {
            handler.sendError(ws, 'Xi is still working on the last request', 'DIRECTOR_BUSY', message.requestId);
            return;
        }

        const spokenContent = String(message.content || '').trim();
        const spokenLower = spokenContent.toLowerCase();

        if (spokenLower === '/logout' || spokenLower === 'logout' || spokenLower === '/auth-logout' || spokenLower === '/clear-auth') {
            const cursorAccountAuthStore = require('./cursorAccountAuthStore');
            const secureConfig = gr.getSecureConfig ? gr.getSecureConfig() : {};
            const cursorData = (secureConfig && secureConfig.cursorAccounts) || {};
            const activeAccountId = (cursorData.xi && cursorData.xi.activeAccountId) || 'default';

            cursorAccountAuthStore.logoutCursorAccount('xi', activeAccountId);

            handler.sendToClient(ws, {
                type: 'director_message_response',
                data: {
                    sessionId,
                    reply: `🔒 **Logged out of Cursor account for Xi.**\n\nThe active account profile (\`${activeAccountId}\`) and live authentication state have been logged out and cleared. Perform a fresh login in Cursor or click **Capture Credentials** in Security Center after logging in.`,
                    done: true
                },
                timestamp: new Date().toISOString()
            });
            return;
        }

        const workspace = workspacePath(gr);
        const runtime = sanitizeRuntime((peekIndex().chats.find((item) => item.id === sessionId) || {}).runtime);
        if (runtime === 'cursor') director.installUnrestrictedCli(layout().configDir);
        if (runtime === 'tokenrouter') director._test.requireTokenRouterKey(gr);
        if (customProviders.isEngine(runtime)) customProviders.requireReady(gr, runtime);
        await ensureXiMcp(gr);
        const catalog = cachedModels();
        const runModel = runtime === 'cursor' ? director._test.resolveRunModel(catalog, message) : null;
        const claudeEffort = sanitizeClaudeEffort(message.effort);
        const customRun = customProviders.isEngine(runtime)
            ? await customProviders.resolveForTurn(gr, runtime, message)
            : null;
        const tokenRun = runtime === 'tokenrouter'
            ? await director._test.resolveTokenRouterRun({
                model: message.model || XI_TOKENROUTER_DEFAULT_MODEL,
                effort: message.effort,
                fast: message.fast
            })
            : null;
        const draftId = crypto.randomUUID();
        const prepared = await enqueue(async () => {
            const index = readIndex();
            const chat = index.chats.find((item) => item.id === sessionId);
            if (!chat) return null;
            assertRuntimeUnchanged(chat, message);
            const files = await storeAttachments(gr, chat, message.attachments || []);
            const spoken = String(message.content || '').trim() || (files.length ? 'Use the attached files.' : '');
            if (!spoken) throw new Error('Say what you want, or attach a file');
            const userText = message.steer ? `Stop the previous attempt. Do this instead:\n${spoken}` : spoken;
            if ((chat.name === 'Xi' || chat.name === 'Director') && spoken) chat.name = spoken.slice(0, 48);
            chat.model = customRun
                ? customRun.model
                : (runtime === 'tokenrouter'
                    ? tokenRun.model
                    : (runtime === 'claude' ? `claude-${claudeEffort}` : runModel));
            chat.choice = {
                id: message.model ? String(message.model) : (customRun
                    ? customRun.family || customRun.model
                    : (runtime === 'tokenrouter' ? tokenRun.family || tokenRun.model : 'auto')),
                effort: message.effort || 'medium',
                fast: message.fast === true
            };
            const { keepSessionWorkspace } = require('./sessionWorkspacePairing');
            keepSessionWorkspace(chat, message.workspaceId);
            chat.messages = chat.messages || [];
            chat.messages.push({
                id: crypto.randomUUID(),
                role: 'user',
                content: spoken,
                user_input: spoken,
                message_type: 'Ask',
                timestamp: new Date().toISOString(),
                data: null
            });
            chat.updated_at = new Date().toISOString();
            let cursorId = null;
            let claudeSessionId = null;
            let claudeFirstTurn = false;
            if (runtime === 'cursor') {
                cursorId = chat.cursorId;
                const cursorAccountAuthStore = require('./cursorAccountAuthStore');
                const activeAccountId = cursorAccountAuthStore.getActiveAccountId('xi');
                if (chat.accountId && chat.accountId !== activeAccountId) {
                    cursorId = null;
                }
                if (!cursorId) {
                    cursorId = await createCursorChat(workspace);
                    chat.cursorId = cursorId;
                    chat.accountId = activeAccountId;
                }
            } else {
                claudeFirstTurn = !chat.claudeSessionId;
                claudeSessionId = chat.claudeSessionId || crypto.randomUUID();
                chat.claudeSessionId = claudeSessionId;
            }
            const round = director._test.roundModelRecord(
                customRun ? customRun.family || customRun.model : (runtime === 'tokenrouter' ? tokenRun.family || tokenRun.model : message.model),
                customRun ? customRun.effort : (runtime === 'tokenrouter' ? tokenRun.effort : (runtime === 'claude' ? claudeEffort : (message.effort || 'medium'))),
                customRun ? false : (runtime === 'tokenrouter' ? tokenRun.fast === true : message.fast === true),
                chat.model,
                usesClaudeCli(runtime) ? runtime : undefined
            );
            chat.inflight = {
                model: chat.model,
                draftId,
                startedAt: new Date().toISOString(),
                userText: userText.slice(0, 2000)
            };
            const clientId = directorClientId(clientInfo, message);
            const memoryStore = customProviders.isEngine(runtime)
                ? customProviders.memoryStoreForEngine(gr, runtime)
                : '';
            const ageTool = !customProviders.isEngine(runtime) || customProviders.ageToolEnabled(gr, runtime);
            const prompt = buildPrompt(chat, userText, files, clientId, { memoryStore, ageTool });
            writeIndex(index);
            return { prompt, cursorId, claudeSessionId, claudeFirstTurn, model: chat.model, name: chat.name, round, runtime };
        });
        if (!prepared) {
            handler.sendError(ws, 'Session not found', 'SESSION_NOT_FOUND', message.requestId);
            return;
        }
        const paths = layout();
        const log = path.join(paths.logs, `${sessionId}.ndjson`);
        fs.mkdirSync(paths.logs, { recursive: true });
        fs.writeFileSync(log, '');
        const metaPath = path.join(paths.runs, `${sessionId}.json`);
        const args = usesClaudeCli(runtime)
            ? [
                '-p',
                '--output-format', 'stream-json',
                '--verbose',
                '--permission-mode', 'bypassPermissions',
                '--strict-mcp-config',
                '--mcp-config', claudeMcpConfigArg(),
                '--append-system-prompt', claudeProjectPrompt(workspace),
                ...(runtime === 'tokenrouter' || customProviders.isEngine(runtime) ? ['--model', prepared.model] : ['--effort', claudeEffort]),
                prepared.claudeFirstTurn ? '--session-id' : '--resume', prepared.claudeSessionId,
                '--',
                prepared.prompt
            ]
            : [
                '--print',
                '--output-format', 'stream-json',
                '--stream-partial-output',
                '--sandbox', 'disabled',
                '--trust',
                '--force',
                '--approve-mcps',
                '--workspace', workspace,
                '--model', prepared.model,
                '--resume', prepared.cursorId,
                '--',
                prepared.prompt
            ];
        let extraEnv = {};
        if (runtime === 'tokenrouter' || customProviders.isEngine(runtime)) {
            const link = await tokenRouter.ensureBridge();
            const bridged = customRun
                ? { model: customRun.model, effort: customRun.effort, lane: 'interactive', providerId: customProviders.providerId(runtime) }
                : { ...tokenRun, lane: 'interactive' };
            extraEnv = director._test.tokenRouterCliEnv(link, bridged);
        }
        const started = spawnDetached(args, log, workspace, { runtime, extraEnv });
        const meta = {
            pid: started.pid,
            runHome: started.runHome,
            sessionId,
            log,
            draftId,
            round: prepared.round,
            name: prepared.name,
            runtime,
            requestId: message.requestId || null,
            startedAt: new Date().toISOString(),
            metaPath
        };
        writeMeta(meta);
        emit(gr, 'director_typing_start', { sessionId, persona: 'xi' });
        startTail(meta);
        try { director.broadcastDirectorStatus(gr); } catch (_) { /* status is best effort */ }
    } catch (error) {
        handler.sendError(ws, error.message || 'Failed to send Xi message', error.code || 'DIRECTOR_ERROR', message.requestId);
    }
}

async function handleDirectorAbort(handler, ws, message) {
    const sessionId = message.sessionId;
    const run = sessionId ? runs.get(sessionId) : null;
    const steer = message.steer === true;
    if (!run) {
        sendOk(handler, ws, 'director_abort_response', message.requestId, { aborted: false, sessionId: sessionId || null, steer });
        return;
    }
    run.steer = steer;
    run.cancelled = true;
    hardStopXi(sessionId);
    finishRun(run, steer ? 'steer' : 'abort');
    sendOk(handler, ws, 'director_abort_response', message.requestId, { aborted: true, sessionId, steer });
}

async function handleDirectorForkSession(handler, ws, message) {
    if (!assertEnabled(handler, ws, message.requestId)) return;
    const forked = await enqueue(async () => {
        const index = readIndex();
        const chat = index.chats.find((item) => item.id === message.sessionId);
        if (!chat) return null;
        const key = String(message.messageId || '');
        const messages = chat.messages || [];
        let head;
        if (!key) {
            head = messages.map((item) => JSON.parse(JSON.stringify(item)));
        } else {
            if (key.startsWith('live:')) return false;
            const colon = key.indexOf(':');
            const id = colon > 0 ? key.slice(0, colon) : key;
            const indexAt = messages.findIndex((item) => item && (item.id === id || item.timestamp === id));
            if (indexAt < 0) return false;
            head = messages.slice(0, indexAt + 1).map((item) => JSON.parse(JSON.stringify(item)));
            if (colon > 0 && Array.isArray(head[head.length - 1].trace)) {
                const rowIndex = parseInt(key.slice(colon + 1), 10);
                if (Number.isFinite(rowIndex) && rowIndex >= 0) {
                    head[head.length - 1].trace = head[head.length - 1].trace.slice(0, rowIndex + 1);
                }
            }
        }
        const activeAccId = getActiveXiAccountId(handler.globalResources);
        const created = {
            id: `xi_${crypto.randomBytes(8).toString('hex')}`,
            cursorId: null,
            claudeSessionId: null,
            runtime: sanitizeRuntime(chat.runtime),
            accountId: chat.accountId || activeAccId,
            name: `${chat.name || 'Xi'} fork`.slice(0, 48),
            workspaceId: chat.workspaceId || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            archived: false,
            model: chat.model || null,
            choice: chat.choice || null,
            replay: head.length > 0,
            messages: head,
            tasks: Array.isArray(chat.tasks) ? JSON.parse(JSON.stringify(chat.tasks)) : []
        };
        index.chats.push(created);
        writeIndex(index);
        return created;
    });
    if (!forked) {
        handler.sendError(ws, forked === false ? 'Message not found' : 'Session not found', forked === false ? 'MESSAGE_NOT_FOUND' : 'SESSION_NOT_FOUND', message.requestId);
        return;
    }
    sendOk(handler, ws, 'director_fork_session_response', message.requestId, {
        persona: 'xi',
        fullCopy: !String(message.messageId || '').trim(),
        session: Object.assign(publicXiSession(forked), {
            messages: (forked.messages || []).map(director._test.publicMessage)
        })
    });
}

async function handleDirectorMoveSession(handler, ws, message) {
    if (!assertEnabled(handler, ws, message.requestId)) return;
    const sessionId = message.sessionId;
    const workspaceId = typeof message.workspaceId === 'string' ? message.workspaceId.trim() : '';
    if (!sessionId || !workspaceId) {
        handler.sendError(ws, 'Session and workspace are required', 'MISSING_PARAMETERS', message.requestId);
        return;
    }
    const gr = handler.globalResources;
    let known = false;
    try {
        const all = gr.getWorkspaceManager().getWorkspaces();
        known = !!(all && all[workspaceId]);
    } catch (_err) { known = false; }
    if (!known) {
        handler.sendError(ws, 'Workspace not found', 'WORKSPACE_NOT_FOUND', message.requestId);
        return;
    }
    const moved = await enqueue(async () => {
        const index = readIndex();
        const chat = index.chats.find((item) => item.id === sessionId);
        if (!chat) return null;
        chat.workspaceId = workspaceId;
        writeIndex(index);
        return chat;
    });
    if (!moved) {
        handler.sendError(ws, 'Session not found', 'SESSION_NOT_FOUND', message.requestId);
        return;
    }
    sendOk(handler, ws, 'director_move_session_response', message.requestId, {
        persona: 'xi',
        session: publicXiSession(moved)
    });
}

async function handleDirectorToolDiff(handler, ws, message) {
    if (!assertEnabled(handler, ws, message.requestId)) return;
    const found = readToolDiffText(message.sessionId, message.diffId);
    if (!found) {
        handler.sendError(ws, 'That change is not on disk', 'DIFF_NOT_FOUND', message.requestId);
        return;
    }
    sendOk(handler, ws, 'director_tool_diff_response', message.requestId, {
        text: found.text,
        name: found.name,
        detail: found.detail,
        diffId: message.diffId
    });
}

function chatImagesDir(sessionId) {
    return path.join(layout().chats, director._test.safeName(sessionId), 'chat-images');
}

async function setSessionTitle(gr, sessionId, title) {
    boundGr = gr || boundGr;
    const name = String(title || '').replace(/\s+/g, ' ').trim();
    if (!name) {
        const error = new Error('A title is required');
        error.code = 'MISSING_PARAMETERS';
        throw error;
    }
    if (name.length > 80) {
        const error = new Error('Keep the title under 80 characters');
        error.code = 'TITLE_TOO_LONG';
        throw error;
    }
    const saved = await enqueue(async () => {
        const index = readIndex();
        const chat = index.chats.find((item) => item.id === sessionId);
        if (!chat) return null;
        chat.name = name;
        chat.updated_at = new Date().toISOString();
        chat.titleSetByAgent = true;
        writeIndex(index);
        return name;
    });
    if (saved && boundGr) {
        emit(boundGr, 'director_session_renamed', { sessionId, name: saved, persona: 'xi' });
        try { director.broadcastDirectorStatus(boundGr); } catch (_) { /* status is best effort */ }
    }
    return saved;
}

async function writeSessionTasks(gr, sessionId, mutate) {
    boundGr = gr || boundGr;
    const written = await enqueue(async () => {
        const index = readIndex();
        const chat = index.chats.find((item) => item.id === sessionId);
        if (!chat) return null;
        const current = director._test.normalizeSessionTasks(chat.tasks);
        const next = mutate(current);
        if (!next) return { tasks: current, changed: false };
        chat.tasks = next;
        writeIndex(index);
        return { tasks: next, changed: true };
    });
    if (written && written.changed && boundGr) {
        emit(boundGr, 'director_session_tasks', { sessionId, tasks: written.tasks, persona: 'xi' });
    }
    return written;
}

function readSessionTasks(sessionId) {
    const chat = peekIndex().chats.find((item) => item.id === sessionId);
    if (!chat) return null;
    return director._test.normalizeSessionTasks(chat.tasks);
}

function setSessionTasks(gr, sessionId, list) {
    return writeSessionTasks(gr, sessionId, () => director._test.normalizeSessionTasks(list));
}

function setSessionTask(gr, sessionId, id, done) {
    const wanted = String(id == null ? '' : id).trim();
    return writeSessionTasks(gr, sessionId, (tasks) => {
        const row = tasks.find((task) => task.id === wanted);
        if (!row) return null;
        row.done = done === true;
        return tasks;
    });
}

function clearSessionTasks(gr, sessionId) {
    return writeSessionTasks(gr, sessionId, (tasks) => (tasks.length ? [] : null));
}

async function appendSessionCard(gr, sessionId, card) {
    boundGr = gr || boundGr;
    const message = {
        id: crypto.randomUUID(),
        role: 'event',
        content: '',
        message_type: card.kind,
        timestamp: new Date().toISOString(),
        data: card.data || null
    };
    const saved = await enqueue(async () => {
        const index = readIndex();
        const chat = index.chats.find((item) => item.id === sessionId);
        if (!chat) return null;
        chat.messages = chat.messages || [];
        const draftId = chat.inflight && chat.inflight.draftId;
        const draftAt = draftId ? chat.messages.findIndex((item) => item.id === draftId) : -1;
        if (draftAt >= 0) chat.messages.splice(draftAt, 0, message);
        else chat.messages.push(message);
        writeIndex(index);
        return message;
    });
    if (saved && boundGr) {
        emit(boundGr, card.event, Object.assign({ sessionId, chatId: sessionId, cardId: message.id, persona: 'xi' }, card.data || {}));
    }
    return saved;
}

module.exports = {
    prepareXi,
    isEnabled,
    runtimeStatus,
    hasChat,
    activeSessionId,
    activeChatBrief,
    listActiveRuns,
    activeRuntime,
    sanitizeRuntime,
    readChatWorkspace,
    chatsDir,
    chatImagesDir,
    setSessionTitle,
    readSessionTasks,
    setSessionTasks,
    setSessionTask,
    clearSessionTasks,
    appendSessionCard,
    MAX_CARD_REASON: director.MAX_CARD_REASON,
    MAX_CARD_CAPTION: director.MAX_CARD_CAPTION,
    handleDirectorGetSessions,
    handleDirectorCreateSession,
    handleDirectorGetSession,
    handleDirectorOpenWorkspace,
    handleDirectorDeleteSession,
    handleDirectorGetMessages,
    handleDirectorRollbackMessage,
    handleDirectorSendMessage,
    handleDirectorAbort,
    handleDirectorForkSession,
    handleDirectorMoveSession,
    handleDirectorToolDiff,
    _test: {
        shouldPark, markToolDiffs, readToolDiffText, buildPrompt, launchPlan,
        layout, readIndex, writeIndex, peekIndex, readProjectCursorRules,
        sanitizeRuntime, assertRuntimeUnchanged, publicXiSession, consumeClaudeStreamLine,
        claudeProjectPrompt, claudeMcpConfigArg, sanitizeClaudeEffort,
        usesClaudeCli, xiIdentityLine, XI_TOKENROUTER_DEFAULT_MODEL
    }
};
