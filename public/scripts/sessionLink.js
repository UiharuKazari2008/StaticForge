/**
 * Session link ID: ties multiple WebSocket connections and TabMesh peers to one browser workflow.
 * Persisted in sessionStorage; may be passed via ?sessionLink= on /editor (or other entry points).
 */
const SESSION_LINK_STORAGE_KEY = 'dreamscapeSessionLinkId';

function getOrCreateSessionLinkId() {
    try {
        const params = new URLSearchParams(location.search);
        const fromUrl = params.get('sessionLink');
        if (fromUrl && fromUrl.length > 0) {
            sessionStorage.setItem(SESSION_LINK_STORAGE_KEY, fromUrl);
            return fromUrl;
        }
    } catch (e) { /* ignore */ }

    try {
        let id = sessionStorage.getItem(SESSION_LINK_STORAGE_KEY);
        if (!id) {
            id = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : ('link_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12));
            sessionStorage.setItem(SESSION_LINK_STORAGE_KEY, id);
        }
        return id;
    } catch (e) {
        return 'link_fallback_' + Date.now();
    }
}

/**
 * Opens the standalone editor app in a new window, sharing the current session link ID.
 */
function openDreamscapeEditorWindow() {
    const id = getOrCreateSessionLinkId();
    const url = '/editor?sessionLink=' + encodeURIComponent(id);
    open(url, 'dreamscape-editor', 'noopener');
}
