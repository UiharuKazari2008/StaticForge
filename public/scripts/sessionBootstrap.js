/**
 * TabMesh bootstrap: main tab offers a small snapshot; editor tab may request it before full init.
 */
async function trySessionBootstrapFromPeers() {
    if (!window.tabMesh || typeof window.tabMesh.request !== 'function') {
        return null;
    }
    const clientVersion = (window.wsClient && window.wsClient.clientVersion) ? window.wsClient.clientVersion : '1.0.2';
    try {
        const snapshot = await window.tabMesh.request('main', 'bootstrap_snapshot', { clientVersion: clientVersion }, 2500);
        return snapshot;
    } catch (e) {
        return null;
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const role = (location.pathname && location.pathname.indexOf('/editor') !== -1) ? 'editor' : 'main';
    if (typeof createTabMesh === 'function') {
        window.tabMesh = createTabMesh({ role: role });
    }
    if (role === 'main' && window.tabMesh && typeof window.tabMesh.registerHandler === 'function') {
        window.tabMesh.registerHandler('bootstrap_snapshot', function () {
            const ws = window.wsClient;
            return Promise.resolve({
                clientVersion: ws ? ws.clientVersion : '1.0.2',
                initializationCompleted: ws ? !!ws.initializationCompleted : false,
                timestamp: Date.now()
            });
        });
    }
    if (role === 'editor') {
        trySessionBootstrapFromPeers().then(function (snap) {
            if (snap && snap.initializationCompleted) {
                console.log('ℹ️ Session bootstrap snapshot from peer tab:', snap);
            }
        });
    }
});
