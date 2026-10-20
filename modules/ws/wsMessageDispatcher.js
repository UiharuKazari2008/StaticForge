/**
 * WebSocket inbound dispatch policy.
 *
 * Every inbound packet is recorded on a per-client request array. Handlers are
 * always scheduled on a later macrotask (setImmediate) so the ws message path
 * returns immediately and parallel work is not held behind unrelated packets.
 *
 * FIFO ordering chains each entry behind the previous entry on the same chain
 * (per client) — not by blocking the message receive path, and not by polling:
 * a setImmediate wait loop kept the event loop spinning for as long as an earlier
 * handler ran. Handlers that must wait on a prior request can use waitForClientRequest().
 */

/** @type {Map<string, { requests: ClientRequestEntry[] }>} */
const clientStates = new Map();

/**
 * @typedef {'queued'|'running'|'completed'|'failed'} ClientRequestStatus
 * @typedef {{
 *   id: string,
 *   type: string,
 *   status: ClientRequestStatus,
 *   dispatch: 'parallel'|'fifo',
 *   fifoChainKey: string|null,
 *   sequence: number,
 *   enqueuedAt: number,
 *   startedAt: number|null,
 *   completedAt: number|null,
 *   error: Error|null
 * }} ClientRequestEntry
 */

const COMPLETED_RETENTION_MS = 5 * 60 * 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 120000;

function normalizeDispatchMeta(meta) {
    const m = meta && typeof meta === 'object' ? meta : {};
    return {
        dispatch: m.dispatch === 'fifo' ? 'fifo' : 'parallel',
        fifoScope: m.fifoScope === 'global' ? 'global' : 'connection'
    };
}

// `ws:${ws}` was "ws:[object Object]" for every socket, so all session-less
// sockets shared one request list and FIFO chain. Number each socket instead.
const socketIds = new WeakMap();
let nextSocketId = 1;

function socketKey(ws) {
    if (!ws || typeof ws !== 'object') return `ws:${ws}`;
    let id = socketIds.get(ws);
    if (!id) {
        id = nextSocketId++;
        socketIds.set(ws, id);
    }
    return `ws:${id}`;
}

function getClientKey(ws, clientInfo) {
    if (clientInfo && clientInfo.sessionId) {
        return `session:${clientInfo.sessionId}`;
    }
    return socketKey(ws);
}

function getFifoChainKey(ws, clientInfo, fifoScope) {
    if (fifoScope === 'global') {
        return 'global';
    }
    if (clientInfo && clientInfo.sessionId) {
        return `session:${clientInfo.sessionId}`;
    }
    return socketKey(ws);
}

function getOrCreateClientState(clientKey) {
    let state = clientStates.get(clientKey);
    if (!state) {
        // fifoTails: chain key -> settled promise of the newest entry on that chain
        state = { requests: [], nextSequence: 0, fifoTails: new Map() };
        clientStates.set(clientKey, state);
    }
    return state;
}

function pruneCompletedRequests(state) {
    const cutoff = Date.now() - COMPLETED_RETENTION_MS;
    state.requests = state.requests.filter((entry) => {
        if (entry.status === 'queued' || entry.status === 'running') {
            return true;
        }
        return entry.completedAt != null && entry.completedAt >= cutoff;
    });
}

function yieldToEventLoop() {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

/**
 * Run handler on a later macrotask so synchronous handler bodies do not run
 * inline on the ws 'message' callback stack.
 */
function runHandlerIsolated(handlerFn) {
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            Promise.resolve()
                .then(() => handlerFn())
                .then(resolve, reject);
        });
    });
}

async function runTrackedRequest(state, entry, handlerFn, onError, priorTurn) {
    try {
        if (priorTurn) {
            await priorTurn;
        }

        entry.status = 'running';
        entry.startedAt = Date.now();

        await runHandlerIsolated(handlerFn);

        entry.status = 'completed';
        entry.completedAt = Date.now();
    } catch (err) {
        entry.status = 'failed';
        entry.completedAt = Date.now();
        entry.error = err;
        if (onError) {
            onError(err);
        } else {
            console.error('[wsMessageDispatcher] handler error:', err);
        }
    }
}

function settleEntry(entry) {
    if (entry.settle) {
        entry.settle();
        entry.settle = null;
    }
}

/**
 * @param {import('ws')} ws
 * @param {object} clientInfo
 * @param {() => Promise<void>|void} handlerFn
 * @param {{ dispatch?: 'fifo'|'parallel', fifoScope?: 'connection'|'global' }} [meta]
 * @param {(err: Error) => void} [onError]
 * @param {{ type?: string, requestId?: string }} [tracking]
 */
function dispatch(ws, clientInfo, handlerFn, meta, onError, tracking) {
    const { dispatch: mode, fifoScope } = normalizeDispatchMeta(meta);
    const clientKey = getClientKey(ws, clientInfo);
    const state = getOrCreateClientState(clientKey);
    pruneCompletedRequests(state);

    const track = tracking && typeof tracking === 'object' ? tracking : {};
    const sequence = state.nextSequence;
    state.nextSequence += 1;

    const entry = {
        id: track.requestId || `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: String(track.type || 'unknown'),
        status: 'queued',
        dispatch: mode,
        fifoChainKey: mode === 'fifo' ? getFifoChainKey(ws, clientInfo, fifoScope) : null,
        sequence,
        enqueuedAt: Date.now(),
        startedAt: null,
        completedAt: null,
        error: null
    };
    // settled resolves (never rejects) when the entry completes or fails. Not
    // enumerable, so getClientRequestList snapshots stay plain data.
    let settle = null;
    const settled = new Promise((resolve) => { settle = resolve; });
    Object.defineProperties(entry, {
        settled: { value: settled },
        settle: { value: settle, writable: true }
    });

    state.requests.push(entry);

    let priorTurn = null;
    if (entry.fifoChainKey) {
        priorTurn = state.fifoTails.get(entry.fifoChainKey) || null;
        state.fifoTails.set(entry.fifoChainKey, entry.settled);
        entry.settled.then(() => {
            if (state.fifoTails.get(entry.fifoChainKey) === entry.settled) {
                state.fifoTails.delete(entry.fifoChainKey);
            }
        });
    }

    setImmediate(() => {
        runTrackedRequest(state, entry, handlerFn, onError, priorTurn).then(() => settleEntry(entry));
    });
}

function clearClientState(clientKey) {
    if (!clientKey) return;
    clientStates.delete(clientKey);
}

function clearFifoChainForSession(sessionId) {
    if (!sessionId) return;
    clearClientState(`session:${sessionId}`);
}

/**
 * Snapshot of tracked requests for a client (newest last).
 * @param {import('ws')} ws
 * @param {object} clientInfo
 * @returns {ClientRequestEntry[]}
 */
function getClientRequestList(ws, clientInfo) {
    const state = clientStates.get(getClientKey(ws, clientInfo));
    if (!state) return [];
    return state.requests.map((entry) => ({ ...entry, error: entry.error ? String(entry.error.message || entry.error) : null }));
}

/**
 * Wait until a prior tracked request completes. Use when a handler must yield
 * to an earlier packet on the same client.
 * @param {import('ws')} ws
 * @param {object} clientInfo
 * @param {string} requestId
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<boolean>}
 */
async function waitForClientRequest(ws, clientInfo, requestId, options) {
    const timeoutMs = options && options.timeoutMs != null ? options.timeoutMs : DEFAULT_WAIT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const clientKey = getClientKey(ws, clientInfo);

    for (;;) {
        const state = clientStates.get(clientKey);
        if (!state) {
            return false;
        }

        const entry = state.requests.find((r) => r.id === requestId);
        if (!entry) {
            return false;
        }

        if (entry.status === 'completed') {
            return true;
        }

        if (entry.status === 'failed') {
            const err = entry.error || new Error(`Request ${requestId} failed`);
            throw err;
        }

        const left = deadline - Date.now();
        if (left <= 0) break;
        let timer = null;
        await Promise.race([
            entry.settled,
            new Promise((resolve) => { timer = setTimeout(resolve, left); })
        ]);
        clearTimeout(timer);
    }

    throw new Error(`Timeout waiting for WebSocket request ${requestId}`);
}

/**
 * True when an earlier FIFO entry on the same chain is still queued or running.
 * @param {import('ws')} ws
 * @param {object} clientInfo
 * @param {string} fifoChainKey
 */
function isFifoChainBusy(ws, clientInfo, fifoChainKey) {
    const state = clientStates.get(getClientKey(ws, clientInfo));
    if (!state || !fifoChainKey) return false;
    return state.requests.some((r) =>
        r.fifoChainKey === fifoChainKey
        && (r.status === 'queued' || r.status === 'running')
    );
}

module.exports = {
    dispatch,
    clearFifoChainForSession,
    clearClientState,
    normalizeDispatchMeta,
    getClientKey,
    getClientRequestList,
    waitForClientRequest,
    yieldToEventLoop,
    isFifoChainBusy,
    WS_DISPATCH_FIFO_CONNECTION: { dispatch: 'fifo', fifoScope: 'connection' },
    WS_DISPATCH_FIFO_GLOBAL: { dispatch: 'fifo', fifoScope: 'global' }
};
