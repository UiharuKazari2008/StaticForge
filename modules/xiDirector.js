'use strict';

// Xi is the host-side Director persona. Wren stays in the bubblewrap jail.
// This process is detached and unref'd so a Dreamscape restart does not kill
// the turn. The server reattaches by tailing the turn log. Diffs stay on disk
// and go to the client only when someone opens that one payload.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const director = require('./cursorDirector');

const RUN_IDLE_MS = 12 * 60 * 1000;
const RUN_HARD_MS = 30 * 60 * 1000;
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

function readIndex(indexPath) {
    const file = indexPath || layout().indexPath;
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && Array.isArray(parsed.chats)) return parsed;
    } catch (_) { /* new */ }
    return { chats: [] };
}

function writeIndex(index, indexPath) {
    const file = indexPath || layout().indexPath;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(index));
    fs.renameSync(tmp, file);
}

function hasChat(sessionId) {
    if (!sessionId) return false;
    return readIndex().chats.some((chat) => chat.id === sessionId);
}

function activeSessionId() {
    return runs.size === 1 ? Array.from(runs.keys())[0] : null;
}

function runtimeStatus() {
    const sessionId = activeSessionId();
    let sessionName = null;
    if (sessionId) {
        const chat = readIndex().chats.find((item) => item.id === sessionId);
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

function publicXiSession(chat) {
    return Object.assign(director._test.publicSession(chat), { persona: 'xi' });
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

function markToolDiffs(sessionId, rows) {
    (rows || []).forEach((row) => {
        if (!shouldPark(row)) return;
        if (!row.diffId) row.diffId = crypto.randomBytes(6).toString('hex');
        const body = JSON.stringify({
            name: row.name || '',
            detail: row.detail || '',
            args: row.args || '',
            result: row.result || ''
        });
        const hash = crypto.createHash('sha1').update(body).digest('hex');
        if (row._diffHash !== hash) {
            const file = diffPath(sessionId, row.diffId);
            if (file) {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, body);
            }
            row._diffHash = hash;
        }
        row.hasDiff = true;
        row.diffKind = EDIT_TOOLS.has(row.name) ? 'diff' : 'output';
    });
}

function readToolDiffText(sessionId, diffId) {
    const file = diffPath(sessionId, diffId);
    if (!file || !fs.existsSync(file)) return null;
    let stored;
    try {
        stored = JSON.parse(fs.readFileSync(file, 'utf8'));
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

function xiEnv() {
    const env = Object.assign({}, process.env);
    env.CURSOR_CONFIG_DIR = layout().configDir;
    if (xiMcp) {
        env.DREAMSCAPE_MCP_URL = xiMcp.url;
        env.DREAMSCAPE_MCP_KEY = xiMcp.key;
    }
    env.NO_OPEN_BROWSER = '1';
    env.GIT_TERMINAL_PROMPT = '0';
    env.NO_COLOR = '1';
    return env;
}

function requireAgent() {
    const bin = director.findAgent();
    if (bin) return bin;
    const error = new Error('Cursor is not installed on this host');
    error.code = 'CURSOR_MISSING';
    throw error;
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

function killPid(pid) {
    const n = Number(pid);
    if (!n) return;
    try {
        process.kill(-n, 'SIGTERM');
    } catch (_) {
        try { process.kill(n, 'SIGTERM'); } catch (_) { /* already exited */ }
    }
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

function buildPrompt(chat, userText, files, clientId) {
    const lines = [
        'You are Xi, the host Cursor agent for this repo. Wren is the Dreamspace persona. You are not Wren and you are not in the jail.',
        'Be short. A few sentences. Do not explain the obvious. Do not paste large code blocks or long examples. Name the file and the change.',
        'clientLink.clientGeneration no-go means generate_image on the server, show_chat_image, and open_in_studio only if Studio is already open. Resolution stays normal unless they name a size. Wallpaper is finish, not the wallpaper resolution preset. Over 1 megapixel needs userApprovedPaidRequest after they agree.',
        `Detail belongs on a Yozora issue. File or update the issue, then link it (${YOZORA_ISSUE}<number>). The issue is the write-up.`,
        'Coding, diagnostics, and debugging are the job. Dreamscape tools are on MCP server dreamscape when the task needs the app. Commands are already approved. Do not ask permission to run them.',
        'To ask the user anything, call request_form with chatId. AskQuestion is skipped in this window and they never see it. If it returns pending with a formId, call request_form again with only that formId until values come back.',
        'A client reload is normal. Continue this chat. Do not redo a finished step.',
        `Director chat id: ${chat.id}. Pass chatId on session tools.`,
        `Workspace: ${workspacePath(boundGr)}`
    ];
    if (clientId) lines.push(`Studio clientId: ${clientId}. If a tool says not bound, bind_session once with it.`);
    if (files.length) {
        lines.push('Attached files:');
        files.forEach((file) => lines.push(`- ${file}`));
    }
    lines.push('', 'User request:', userText || 'Look at the attached files.');
    return lines.join('\n');
}

function createCursorChat(workspace) {
    return new Promise((resolve, reject) => {
        const child = spawn(requireAgent(), ['create-chat', '--workspace', workspace], {
            cwd: workspace,
            env: xiEnv(),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let out = '';
        let err = '';
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(value);
        };
        const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
            finish(reject, new Error('Creating the Cursor chat timed out'));
        }, 20000);
        child.stdout.on('data', (buf) => { out += buf.toString(); });
        child.stderr.on('data', (buf) => { err += buf.toString(); });
        child.on('error', (error) => finish(reject, error));
        child.on('close', (code) => {
            const id = String(out || '').trim().split('\n').filter(Boolean).pop();
            if (code !== 0 || !id) {
                finish(reject, new Error((err || out || `create-chat exited ${code}`).trim().slice(0, 500)));
                return;
            }
            finish(resolve, id);
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
    if (run.stopPrintWatch) {
        try { run.stopPrintWatch(); } catch (_) { /* watcher already closed */ }
        run.stopPrintWatch = null;
    }
    if (run.timer) clearInterval(run.timer);
    if (run.persistTimer) clearTimeout(run.persistTimer);
    runs.delete(run.sessionId);
    try { fs.unlinkSync(run.metaPath); } catch (_) { /* already gone */ }
    const failed = !!(run.cancelled || (run.stream && run.stream.error) || why === 'timeout');
    const errorText = run.cancelled
        ? 'Stopped'
        : (why === 'timeout' ? 'Xi stopped because it made no progress' : ((run.stream && run.stream.error) || 'Xi stopped'));
    saveTrace(run)
        .then(() => clearInflight(run.sessionId))
        .then(async () => {
            if (!boundGr) return;
            let name = run.name || 'Xi';
            try {
                const chat = readIndex().chats.find((item) => item.id === run.sessionId);
                if (chat && chat.name) name = chat.name;
            } catch (_) { /* keep the name from the start of the turn */ }
            const text = (run.stream && run.stream.text) || '';
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
        if (line.trim()) director._test.consumeStreamLine(line, run.stream);
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
        if (run.buffer.trim()) director._test.consumeStreamLine(run.buffer, run.stream);
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
            if (run.buffer.trim()) director._test.consumeStreamLine(run.buffer, run.stream);
            run.buffer = '';
            finishRun(run, 'exit');
            return;
        }
        const now = Date.now();
        if (now - run.startedAt >= RUN_HARD_MS || now - run.lastActivity >= RUN_IDLE_MS) {
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
function spawnDetached(args, logPath, workspace) {
    const out = execFileSync('/bin/sh', [
        '-c',
        'log="$1"; shift; setsid "$@" >>"$log" 2>&1 </dev/null & echo $!',
        'xi-spawn',
        logPath,
        requireAgent(),
        ...args
    ], { cwd: workspace, env: xiEnv(), encoding: 'utf8', timeout: 10000 });
    const pid = parseInt(String(out).trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) throw new Error('Xi agent did not start');
    return pid;
}

async function handleDirectorGetSessions(handler, ws, message) {
    if (!assertEnabled(handler, ws, message.requestId)) return;
    try {
        const index = readIndex();
        sendOk(handler, ws, 'director_get_sessions_response', message.requestId, {
            sessions: index.chats.filter(chatIsListed).map(publicXiSession).reverse()
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
        const workspaceId = message.workspaceId || null;
        const chat = await enqueue(async () => {
            const index = readIndex();
            const created = {
                id: `xi_${crypto.randomBytes(8).toString('hex')}`,
                cursorId: null,
                persona: 'xi',
                name: (message.description || '').trim().slice(0, 48) || 'Xi',
                workspaceId,
                filename: null,
                image_type: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                archived: false,
                model: director.EFFORT_MODELS.medium,
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
    const chat = readIndex().chats.find((item) => item.id === message.sessionId);
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
    const index = readIndex();
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
    if (runs.has(message.sessionId)) {
        handler.sendError(ws, 'Xi is still working on that chat', 'DIRECTOR_BUSY', message.requestId);
        return;
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
    const chat = readIndex().chats.find((item) => item.id === message.sessionId);
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
        const workspace = workspacePath(gr);
        director.installUnrestrictedCli(layout().configDir);
        await ensureXiMcp(gr);
        const catalog = cachedModels();
        const runModel = director._test.resolveRunModel(catalog, message);
        const draftId = crypto.randomUUID();
        const prepared = await enqueue(async () => {
            const index = readIndex();
            const chat = index.chats.find((item) => item.id === sessionId);
            if (!chat) return null;
            const files = await storeAttachments(gr, chat, message.attachments || []);
            const spoken = String(message.content || '').trim() || (files.length ? 'Use the attached files.' : '');
            if (!spoken) throw new Error('Say what you want, or attach a file');
            const userText = message.steer ? `Stop the previous attempt. Do this instead:\n${spoken}` : spoken;
            if ((chat.name === 'Xi' || chat.name === 'Director') && spoken) chat.name = spoken.slice(0, 48);
            chat.model = runModel;
            chat.choice = {
                id: message.model ? String(message.model) : 'auto',
                effort: message.effort || 'medium',
                fast: message.fast === true
            };
            const stayWorkspace = typeof message.workspaceId === 'string' ? message.workspaceId.trim() : '';
            if (stayWorkspace && stayWorkspace !== (chat.workspaceId || '')) chat.workspaceId = stayWorkspace;
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
            let cursorId = chat.cursorId;
            if (!cursorId) {
                cursorId = await createCursorChat(workspace);
                chat.cursorId = cursorId;
            }
            const round = director._test.roundModelRecord(message.model, message.effort || 'medium', message.fast === true, chat.model);
            chat.inflight = {
                model: chat.model,
                draftId,
                startedAt: new Date().toISOString(),
                userText: userText.slice(0, 2000)
            };
            const clientId = directorClientId(clientInfo, message);
            const prompt = buildPrompt(chat, userText, files, clientId);
            writeIndex(index);
            return { prompt, cursorId, model: chat.model, name: chat.name, round };
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
        const args = [
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
        const pid = spawnDetached(args, log, workspace);
        const meta = {
            pid,
            sessionId,
            log,
            draftId,
            round: prepared.round,
            name: prepared.name,
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
    if (!run) {
        sendOk(handler, ws, 'director_abort_response', message.requestId, { aborted: false, sessionId: sessionId || null });
        return;
    }
    run.cancelled = true;
    killPid(run.pid);
    finishRun(run, 'abort');
    sendOk(handler, ws, 'director_abort_response', message.requestId, { aborted: true, sessionId });
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
    const chat = readIndex().chats.find((item) => item.id === sessionId);
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
        chat.messages.push(message);
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
    handleDirectorToolDiff,
    _test: { shouldPark, markToolDiffs, readToolDiffText, buildPrompt }
};
