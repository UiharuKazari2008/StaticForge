/**
 * WebSocket inbound dispatch policy.
 *
 * Every inbound packet is recorded on a per-client request array. Handlers are
 * always scheduled on a later macrotask (setImmediate) so the ws message path
 * returns immediately and parallel work is not held behind unrelated packets.
 *
 * FIFO ordering is enforced by checking the client array for earlier queued or
 * running entries on the same chain — not by blocking the message receive path.
 * Handlers that must wait on a prior request can use waitForClientRequest().
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

function getClientKey(ws, clientInfo) {
    if (clientInfo && clientInfo.sessionId) {
        return `session:${clientInfo.sessionId}`;
    }
    return `ws:${ws}`;
}

function getFifoChainKey(ws, clientInfo, fifoScope) {
    if (fifoScope === 'global') {
        return 'global';
    }
    if (clientInfo && clientInfo.sessionId) {
        return `session:${clientInfo.sessionId}`;
    }
    return `ws:${ws}`;
}

function getOrCreateClientState(clientKey) {
    let state = clientStates.get(clientKey);
    if (!state) {
        state = { requests: [], nextSequence: 0 };
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

function hasPriorFifoWork(state, entry) {
    return state.requests.some((r) =>
        r.fifoChainKey === entry.fifoChainKey
        && r.id !== entry.id
        && (r.status === 'queued' || r.status === 'running')
        && r.sequence < entry.sequence
    );
}

function yieldToEventLoop() {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

async function waitForFifoTurn(state, entry) {
    while (hasPriorFifoWork(state, entry)) {
        await yieldToEventLoop();
    }
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

async function runTrackedRequest(state, entry, handlerFn, onError) {
    try {
        if (entry.dispatch === 'fifo' && entry.fifoChainKey) {
            await waitForFifoTurn(state, entry);
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

    state.requests.push(entry);

    setImmediate(() => {
        runTrackedRequest(state, entry, handlerFn, onError);
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

    while (Date.now() < deadline) {
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

        await yieldToEventLoop();
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
