/**
 * TabMesh: cross-tab messaging via SharedWorker, BroadcastChannel fallback, optional SW relay.
 */
const TAB_MESH_SW_TYPE = 'TAB_MESH_RELAY';

class TabMesh {
    constructor() {
        this.sessionLinkId = typeof getOrCreateSessionLinkId === 'function'
            ? getOrCreateSessionLinkId()
            : '';
        this.meshTabId = null;
        this.role = 'main';
        this._handlers = new Map();
        this._topicHandlers = new Map();
        this._pending = new Map();
        this._requestSeq = 0;
        this._bc = null;
        this._port = null;
        this._swRelayInstalled = false;
        this._destroyed = false;
    }

    init(options = {}) {
        if (options.role) {
            this.role = options.role;
        }
        this._trySharedWorker();
        if (!this._port) {
            this._tryBroadcastChannel();
        }
        this._installServiceWorkerRelay();
        this._sendRaw({
            type: 'hello',
            role: this.role,
            sessionLinkId: this.sessionLinkId
        });
    }

    _trySharedWorker() {
        try {
            if (typeof SharedWorker === 'undefined') {
                return;
            }
            const w = new SharedWorker('/scripts/tabMeshSharedWorker.js');
            this._port = w.port;
            this._port.addEventListener('message', (ev) => this._onMessage(ev.data));
            this._port.start();
        } catch (e) {
            this._port = null;
        }
    }

    _tryBroadcastChannel() {
        try {
            const name = 'dreamscape-tab-mesh-' + this.sessionLinkId;
            this._bc = new BroadcastChannel(name);
            this._bc.onmessage = (ev) => this._onMessage(ev.data);
        } catch (e) {
            this._bc = null;
        }
    }

    _installServiceWorkerRelay() {
        if (this._swRelayInstalled || typeof navigator === 'undefined' || !navigator.serviceWorker) {
            return;
        }
        this._swRelayInstalled = true;
        navigator.serviceWorker.addEventListener('message', (event) => {
            const d = event.data;
            if (!d || d.type !== 'TAB_MESH_MESSAGE' || !d.envelope) {
                return;
            }
            if (d.envelope.sessionLinkId && d.envelope.sessionLinkId !== this.sessionLinkId) {
                return;
            }
            this._onMessage(d.envelope);
        });
    }

    _sendRaw(payload) {
        const envelope = { ...payload, sessionLinkId: this.sessionLinkId, fromRole: this.role };
        if (this._destroyed) {
            return;
        }
        if (this._port) {
            try {
                this._port.postMessage(envelope);
            } catch (e) { /* ignore */ }
            return;
        }
        if (this._bc) {
            try {
                this._bc.postMessage(envelope);
            } catch (e) { /* ignore */ }
            return;
        }
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            try {
                navigator.serviceWorker.controller.postMessage({
                    type: TAB_MESH_SW_TYPE,
                    envelope: envelope
                });
            } catch (e) { /* ignore */ }
        }
    }

    _shouldHandleRequest(target) {
        const t = target || 'any';
        if (t === 'any') {
            return this.role === 'main';
        }
        return t === this.role;
    }

    _onMessage(data) {
        if (!data || typeof data !== 'object' || this._destroyed) {
            return;
        }
        if (data.sessionLinkId && data.sessionLinkId !== this.sessionLinkId) {
            return;
        }
        if (data.type === 'mesh_ready' && data.meshTabId) {
            this.meshTabId = data.meshTabId;
            return;
        }
        if (data.type === 'response' && data.requestId != null) {
            const pend = this._pending.get(data.requestId);
            if (pend) {
                this._pending.delete(data.requestId);
                clearTimeout(pend.timer);
                if (data.error) {
                    pend.reject(new Error(data.error));
                } else {
                    pend.resolve(data.payload);
                }
            }
            return;
        }
        if (data.type === 'request' && data.method) {
            if (!this._shouldHandleRequest(data.target)) {
                return;
            }
            const fn = this._handlers.get(data.method);
            if (fn) {
                Promise.resolve(fn(data.payload || {}, data))
                    .then((result) => {
                        this._sendRaw({
                            type: 'response',
                            requestId: data.requestId,
                            payload: result
                        });
                    })
                    .catch((err) => {
                        this._sendRaw({
                            type: 'response',
                            requestId: data.requestId,
                            error: err && err.message ? err.message : String(err)
                        });
                    });
            }
            return;
        }
        const topic = data.topic;
        if (topic) {
            const set = this._topicHandlers.get(topic);
            if (set) {
                set.forEach((fn) => {
                    try {
                        fn(data.payload, data);
                    } catch (e) { /* ignore */ }
                });
            }
        }
    }

    registerHandler(method, fn) {
        this._handlers.set(method, fn);
    }

    on(topic, fn) {
        if (!this._topicHandlers.has(topic)) {
            this._topicHandlers.set(topic, new Set());
        }
        this._topicHandlers.get(topic).add(fn);
    }

    broadcast(topic, payload) {
        this._sendRaw({ type: 'broadcast', topic: topic, payload: payload });
    }

    /**
     * @param {'any'|'main'|'editor'} target
     */
    request(target, method, payload, timeoutMs = 3000) {
        return new Promise((resolve, reject) => {
            const requestId = 'mr_' + (++this._requestSeq) + '_' + Date.now();
            const timer = setTimeout(() => {
                if (this._pending.has(requestId)) {
                    this._pending.delete(requestId);
                    reject(new Error('TabMesh request timeout'));
                }
            }, timeoutMs);
            this._pending.set(requestId, { resolve, reject, timer });
            this._sendRaw({
                type: 'request',
                requestId: requestId,
                method: method,
                payload: payload,
                target: target
            });
        });
    }

    destroy() {
        this._destroyed = true;
        if (this._bc) {
            try {
                this._bc.close();
            } catch (e) { /* ignore */ }
            this._bc = null;
        }
        this._port = null;
    }
}

function createTabMesh(options) {
    const mesh = new TabMesh();
    mesh.init(options);
    return mesh;
}
