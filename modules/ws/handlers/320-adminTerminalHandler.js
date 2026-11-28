'use strict';

/**
 * Administrator Terminal packets (Yozora #1133; modules/adminTerminal.js; docs/client-api/ws/adminTerminal.md).
 *   admin_terminal_open   {id, cols, rows, claudeSession?}  -> admin_terminal_open_response {success, id, pid, cols, rows, title?}
 *                         claudeSession: a running Fleet session's id - the terminal is tmux attached to that
 *                         session's pane (Fleet's Show Screen) instead of bash; closing it only detaches.
 *   admin_terminal_input  {id, data}        (keys typed or pasted)
 *   admin_terminal_resize {id, cols, rows}
 *   admin_terminal_ack    {id, chars}       (output written into xterm: flow control)
 *   admin_terminal_close  {id}
 * Pushed to the owner's socket: admin_terminal_output {id, data}, admin_terminal_exit {id, exitCode, signal}.
 *
 * SECURITY: raw bash on the server. Every packet needs an administrator's full sign-in
 * (modules/adminTerminal.js fullAdminClient: userType admin, no application key / certificate-only /
 * approved-IP sign-in); the stored session is read again at open and at most every GUARD_TTL_MS after.
 * Anyone else is refused and nothing is spawned. Nothing typed is ever logged.
 * A CaféReady certificate session is refused with ADMIN_PIN_REQUIRED until the administrator PIN is typed in the
 * terminal (admin_terminal_pin / admin_pin_confirm {pin} -> <type>_response {success}); 5 wrong PINs lock it for 15 minutes.
 */

const wsPacketRegistry = require('../wsPacketRegistry');
const terminal = require('../../adminTerminal');

const { verifyPin } = require('../../pinAuth');

const GUARD_TTL_MS = 10 * 1000;
const PIN_TRIES = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;
const verdicts = new WeakMap(); // ws -> { at, ok }
const pinFails = new Map(); // sessionId -> { n, until }

function readSession(handlersCtx, sessionId) {
    return new Promise((resolve) => {
        const gr = handlersCtx && handlersCtx.globalResources;
        const store = gr && typeof gr.getSessionStore === 'function' ? gr.getSessionStore() : null;
        if (!store || typeof store.get !== 'function' || !sessionId) { resolve(null); return; }
        try { store.get(sessionId, (err, sess) => resolve(err ? null : sess || null)); } catch (_) { resolve(null); }
    });
}

function writeSession(handlersCtx, sessionId, sess) {
    return new Promise((resolve, reject) => {
        const gr = handlersCtx && handlersCtx.globalResources;
        const store = gr && typeof gr.getSessionStore === 'function' ? gr.getSessionStore() : null;
        if (!store || typeof store.set !== 'function') { reject(new Error('No session store')); return; }
        store.set(sessionId, sess, (err) => (err ? reject(err) : resolve()));
    });
}

/** True for an administrator's full sign-in. `fresh` reads the stored session now (open); otherwise a verdict up to GUARD_TTL_MS old is used. */
async function allowed(handlersCtx, ws, clientInfo, fresh) {
    if (!terminal.fullAdminClient(clientInfo)) { verdicts.delete(ws); return false; }
    const seen = verdicts.get(ws);
    if (!fresh && seen && seen.ok && Date.now() - seen.at < GUARD_TTL_MS) return true;
    const ok = terminal.sessionIsFull(await readSession(handlersCtx, clientInfo.sessionId));
    verdicts.set(ws, { at: Date.now(), ok });
    return ok;
}

function registerPackets() {
    const reg = (type, fresh, fn) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            const { ws, message, clientInfo, handlers } = ctx;
            const m = message || {};
            if (!(await allowed(handlers, ws, clientInfo, fresh))) {
                if (fresh && terminal.fullAdminClient(clientInfo) && terminal.sessionNeedsPin(await readSession(handlers, clientInfo.sessionId))) {
                    handlers.sendError(ws, 'Type the administrator PIN to open the Administrator Terminal', 'ADMIN_PIN_REQUIRED', m.requestId);
                    return;
                }
                handlers.sendError(ws, 'The Administrator Terminal needs an administrator signed in with a full sign-in', 'INSUFFICIENT_PERMISSIONS', m.requestId);
                return;
            }
            try {
                await fn(ctx, m);
            } catch (error) {
                handlers.sendError(ws, error.message, error.code || 'ADMIN_TERMINAL_FAILED', m.requestId);
            }
        }, { owner: 'adminTerminal', destructive: true, dispatch: 'fifo' });
    };
    const send = (ctx) => (type, data) => ctx.wsServer.sendToClient(ctx.ws, { type, data, timestamp: new Date().toISOString() });

    reg('admin_terminal_open', true, async (ctx, m) => {
        let command = null;
        if (m.claudeSession) command = await require('../../claudeSessionLauncher').attachCommand(String(m.claudeSession));
        const info = terminal.open(ctx.ws, ctx.clientInfo.sessionId, { id: m.id, cols: m.cols, rows: m.rows, command }, send(ctx));
        if (command) info.title = command.title;
        ctx.wsServer.sendToClient(ctx.ws, { type: 'admin_terminal_open_response', requestId: m.requestId, data: Object.assign({ success: true }, info), timestamp: new Date().toISOString() });
    });
    // the administrator PIN on a certificate session (CaféReady): stored on the session, so it is asked once per sign-in.
    // admin_pin_confirm is the general name (Rack Manager); admin_terminal_pin the terminal's own
    const pinPacket = (type) => wsPacketRegistry.registerWsPacket(type, async (ctx) => {
        const { ws, message, clientInfo, handlers } = ctx;
        const m = message || {};
        const sid = clientInfo && clientInfo.sessionId;
        const sess = terminal.fullAdminClient(clientInfo) ? await readSession(handlers, sid) : null;
        if (!terminal.sessionNeedsPin(sess)) {
            handlers.sendError(ws, 'The Administrator Terminal needs an administrator signed in with a full sign-in', 'INSUFFICIENT_PERMISSIONS', m.requestId);
            return;
        }
        const now = Date.now();
        const f = pinFails.get(sid);
        if (f && f.until > now) {
            handlers.sendError(ws, 'Too many wrong PINs. Try again in 15 minutes.', 'PIN_LOCKED', m.requestId);
            return;
        }
        const gr = handlers.globalResources;
        const secure = gr && typeof gr.getSecureConfig === 'function' ? gr.getSecureConfig() : null;
        if (!verifyPin(String(m.pin == null ? '' : m.pin), secure && secure.loginPin)) {
            const n = (f && !f.until ? f.n : 0) + 1; // a lock that ran out starts the count again
            pinFails.set(sid, { n, until: n >= PIN_TRIES ? now + PIN_LOCK_MS : 0 });
            handlers.sendError(ws, n >= PIN_TRIES ? 'Too many wrong PINs. Try again in 15 minutes.' : 'The PIN is incorrect.', n >= PIN_TRIES ? 'PIN_LOCKED' : 'BAD_PIN', m.requestId);
            return;
        }
        pinFails.delete(sid);
        try {
            sess.adminPinAt = now;
            await writeSession(handlers, sid, sess);
        } catch (error) {
            handlers.sendError(ws, error.message, 'ADMIN_TERMINAL_FAILED', m.requestId);
            return;
        }
        verdicts.delete(ws);
        ctx.wsServer.sendToClient(ws, { type: `${type}_response`, requestId: m.requestId, data: { success: true }, timestamp: new Date().toISOString() });
    }, { owner: 'adminTerminal', destructive: true, dispatch: 'fifo' });
    pinPacket('admin_pin_confirm');
    pinPacket('admin_terminal_pin');

    reg('admin_terminal_input', false, (ctx, m) => { terminal.write(ctx.ws, m.id, m.data); });
    reg('admin_terminal_resize', false, (ctx, m) => { terminal.resize(ctx.ws, m.id, m.cols, m.rows); });
    reg('admin_terminal_ack', false, (ctx, m) => { terminal.ack(ctx.ws, m.id, m.chars); });
    reg('admin_terminal_close', false, (ctx, m) => { terminal.close(ctx.ws, m.id); });
}

/** For another full-sign-in guard (Rack Manager, 322): true when the refusal is only the missing administrator PIN. */
async function needsPin(handlersCtx, clientInfo) {
    return terminal.fullAdminClient(clientInfo) && terminal.sessionNeedsPin(await readSession(handlersCtx, clientInfo && clientInfo.sessionId));
}

module.exports = { registerPackets, needsPin, _test: { allowed } };
