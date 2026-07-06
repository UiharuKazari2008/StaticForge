/**
 * WebSocket inbound dispatch policy.
 *
 * Most packets run in parallel (fire-and-forget). Only ordering-sensitive work
 * is chained FIFO per connection so reads and unrelated tasks are not blocked.
 */

const fifoChains = new Map();

function normalizeDispatchMeta(meta) {
    const m = meta && typeof meta === 'object' ? meta : {};
    return {
        dispatch: m.dispatch === 'fifo' ? 'fifo' : 'parallel',
        fifoScope: m.fifoScope === 'global' ? 'global' : 'connection'
    };
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

function runHandler(handlerFn, onError) {
    return Promise.resolve()
        .then(() => handlerFn())
        .catch((err) => {
            if (onError) {
                onError(err);
            } else {
                console.error('[wsMessageDispatcher] handler error:', err);
            }
        });
}

/**
 * @param {import('ws')} ws
 * @param {object} clientInfo
 * @param {() => Promise<void>|void} handlerFn
 * @param {{ dispatch?: 'fifo'|'parallel', fifoScope?: 'connection'|'global' }} [meta]
 * @param {(err: Error) => void} [onError]
 */
function dispatch(ws, clientInfo, handlerFn, meta, onError) {
    const { dispatch: mode, fifoScope } = normalizeDispatchMeta(meta);

    if (mode !== 'fifo') {
        runHandler(handlerFn, onError);
        return;
    }

    const chainKey = getFifoChainKey(ws, clientInfo, fifoScope);
    const previous = fifoChains.get(chainKey) || Promise.resolve();
    const next = previous
        .then(() => handlerFn())
        .catch((err) => {
            if (onError) {
                onError(err);
            } else {
                console.error('[wsMessageDispatcher] fifo handler error:', err);
            }
        })
        .finally(() => {
            if (fifoChains.get(chainKey) === next) {
                fifoChains.delete(chainKey);
            }
        });

    fifoChains.set(chainKey, next);
}

function clearFifoChainForSession(sessionId) {
    if (!sessionId) return;
    fifoChains.delete(`session:${sessionId}`);
}

module.exports = {
    dispatch,
    clearFifoChainForSession,
    normalizeDispatchMeta,
    WS_DISPATCH_FIFO_CONNECTION: { dispatch: 'fifo', fifoScope: 'connection' },
    WS_DISPATCH_FIFO_GLOBAL: { dispatch: 'fifo', fifoScope: 'global' }
};
