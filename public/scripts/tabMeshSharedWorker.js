'use strict';

const ports = new Map();

function broadcast(fromPort, data) {
    for (const p of ports.keys()) {
        if (p !== fromPort) {
            try {
                p.postMessage(data);
            } catch (e) { /* ignore */ }
        }
    }
}

onconnect = function (e) {
    const port = e.ports[0];
    const meshTabId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : ('mesh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10));
    ports.set(port, meshTabId);
    port.start();

    port.postMessage({ type: 'mesh_ready', meshTabId: meshTabId });

    port.onmessage = function (ev) {
        broadcast(port, { ...ev.data, _fromMeshTabId: meshTabId });
    };

    port.onmessageerror = function () {
        ports.delete(port);
    };
};
