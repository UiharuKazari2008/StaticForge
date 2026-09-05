/**
 * Client side of the localhost agent session bridge.
 * Invisible inbound handler only — no applet, no Control Panel row, no share dialog.
 * Depends on: wsInboundRegistry, studioChangeJson, openManualModalWithContent
 */

(function initAgentClientBridge() {
    let sessionBound = false;
    let sessionClientId = null;

    function replyAgentSessionResult(requestId, data) {
        if (!window.wsClient || typeof window.wsClient.sendAcklessMessage !== 'function') return;
        try {
            window.wsClient.sendAcklessMessage('agent_session_result', {
                requestId,
                data: data || {}
            });
        } catch (_err) {
            // HTTP side times out if the reply never arrives
        }
    }

    function filenameFromImageLike(img) {
        if (!img || typeof img !== 'object') return null;
        return img.filename || img.original || img.upscaled || img.sourceFilename || null;
    }

    function readOpenFilename() {
        // Preview is what the editor is actually showing. currentEditMetadata /
        // uploadedImageData are variation/img2img sources and often have no filename.
        const showing = filenameFromImageLike(window.currentManualPreviewImage);
        if (showing) return showing;
        const loaded = filenameFromImageLike(window.currentEditImage);
        if (loaded) return loaded;
        const meta = window.currentEditMetadata;
        if (meta) {
            if (meta.sourceFilename) return meta.sourceFilename;
            if (meta.filename) return meta.filename;
        }
        const uploaded = window.uploadedImageData;
        if (uploaded && uploaded.filename) return uploaded.filename;
        return null;
    }

    function readModel() {
        if (typeof manualSelectedModel !== 'undefined' && manualSelectedModel) {
            return manualSelectedModel;
        }
        return null;
    }

    function readWorkspaceId() {
        return window.currentWorkspace || null;
    }

    const WINDOW_TEXT_CAP = 12000;
    const WINDOW_FILE_CAP = 60;

    function capText(value) {
        const text = String(value == null ? '' : value);
        if (text.length <= WINDOW_TEXT_CAP) return text;
        return `${text.slice(0, WINDOW_TEXT_CAP)}\n…[truncated ${text.length - WINDOW_TEXT_CAP} chars]`;
    }

    function capFilenames(list) {
        const names = [];
        const seen = new Set();
        (list || []).forEach((name) => {
            if (!name || seen.has(name) || names.length >= WINDOW_FILE_CAP) return;
            seen.add(name);
            names.push(name);
        });
        return names;
    }

    function classifyOpenWindowKind(modal) {
        const id = modal && modal.id ? String(modal.id) : '';
        if (id === 'galleryWindow') return 'gallery';
        if (id === 'manualModal') return 'studio';
        if (id === 'tagWikiSearchModal') return 'grimoire';
        if (id === 'photoSwipeWindow') return 'glancewell';
        if (id.indexOf('imageViewer_') === 0) return 'lumen';
        const ident = modal && modal.dataset ? String(modal.dataset.windowIdentifier || '') : '';
        if (ident.indexOf('imageViewer:') === 0) return 'lumen';
        if (ident === 'grimoire') return 'grimoire';
        if (/^dsap:\/\//i.test(ident) || id.indexOf('dsap') === 0) return 'dsap';
        return 'window';
    }

    function collectGlancewellWindowData() {
        // getActivePhotoSwipe: public/scripts/comp/lightbox.js
        const pswp = getActivePhotoSwipe();
        if (!pswp || !pswp.isOpen) return null;
        const current = pswp.currSlide && pswp.currSlide.data;
        const currentFilename = filenameFromImageLike(current);
        const source = pswp.options && pswp.options.dataSource;
        const names = [];
        const n = pswp.numItems || (Array.isArray(source) ? source.length : 0);
        for (let i = 0; i < n && names.length < WINDOW_FILE_CAP; i += 1) {
            const data = Array.isArray(source) ? source[i] : null;
            const name = filenameFromImageLike(data);
            if (name) names.push(name);
        }
        return {
            filename: currentFilename,
            filenames: capFilenames(names.length ? names : (currentFilename ? [currentFilename] : [])),
            index: pswp.currIndex,
            count: n
        };
    }

    function collectLumenWindowData(modal) {
        // imageViewerManager: public/scripts/comp/imageViewer.js
        const viewer = imageViewerManager.viewers.get(modal.id);
        const filename = viewer ? viewer.getImageFilename() : null;
        return { filename };
    }

    function collectGalleryWindowData() {
        // getSelectedFilenames: public/scripts/comp/galleryView.js
        const selected = capFilenames(getSelectedFilenames());
        return {
            selected,
            selectedCount: selected.length,
            workspaceId: activeWorkspace || readWorkspaceId()
        };
    }

    function collectGrimoireWindowData() {
        // tagWikiSearchModal.getDisplayText: public/scripts/comp/tagWikiSearchModal.js
        const pathEl = document.getElementById('grimoireAddressPath');
        const url = pathEl ? String(pathEl.textContent || '').trim() : '';
        return {
            url,
            text: capText(tagWikiSearchModal.getDisplayText())
        };
    }

    function collectStudioWindowData() {
        return {
            filename: readOpenFilename(),
            model: readModel()
        };
    }

    function collectWindowData(kind, modal) {
        if (kind === 'gallery') return collectGalleryWindowData();
        if (kind === 'studio') return collectStudioWindowData();
        if (kind === 'grimoire') return collectGrimoireWindowData();
        if (kind === 'glancewell') return collectGlancewellWindowData() || {};
        if (kind === 'lumen') return collectLumenWindowData(modal);
        return {};
    }

    function collectOpenWindowsSnapshot() {
        // getOpenTaskbarModals / getModalTitle / currentActiveWindowId: public/scripts/comp/modalUtils.js
        const seen = new Set();
        const modals = getOpenTaskbarModals().slice();
        const pswpShell = document.getElementById('photoSwipeWindow');
        if (pswpShell && !pswpShell.classList.contains('hidden') && !seen.has(pswpShell.id)) {
            if (!modals.some((modal) => modal.id === pswpShell.id)) modals.push(pswpShell);
        }
        // imageViewerManager: public/scripts/comp/imageViewer.js
        imageViewerManager.viewers.forEach((_viewer, id) => {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden') && !modals.some((modal) => modal.id === id)) {
                modals.push(el);
            }
        });
        const windows = [];
        modals.forEach((modal) => {
            if (!modal || !modal.id || seen.has(modal.id)) return;
            if (modal.classList.contains('hidden') || modal.classList.contains('closing')) return;
            seen.add(modal.id);
            const kind = classifyOpenWindowKind(modal);
            windows.push({
                id: modal.id,
                kind,
                title: getModalTitle(modal) || modal.id,
                active: modal.id === currentActiveWindowId,
                minimised: modal.classList.contains('minimised'),
                data: collectWindowData(kind, modal)
            });
        });
        windows.sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1;
            return 0;
        });
        return {
            workspaceId: readWorkspaceId(),
            activeWindowId: currentActiveWindowId || null,
            windows
        };
    }

    function buildPromptUcChange(data) {
        const fields = [];
        if (data.prompt != null) {
            fields.push({
                id: 'prompt',
                action: 'replace',
                chunks: [{ name: 'Prompt', text: String(data.prompt) }]
            });
        }
        if (data.uc != null) {
            fields.push({
                id: 'uc',
                action: 'replace',
                chunks: [{ name: 'UC', text: String(data.uc) }]
            });
        }
        if (!fields.length) return null;
        return { dreamscape: 'change', v: 1, fields };
    }

    function resolveStudioPayload(data) {
        if (!data || typeof data !== 'object') return null;
        if (data.change && typeof data.change === 'object' && !Array.isArray(data.change)) {
            return data.change;
        }
        const text = resolveStudioText(data);
        if (!text || typeof window.extractStudioChangeJson !== 'function') return null;
        return window.extractStudioChangeJson(text);
    }

    function readVSliderHydration(payload) {
        const requested = payload && Array.isArray(payload.vSlider) ? payload.vSlider.length : 0;
        let installed = 0;
        try {
            const snap = typeof getStudioVSliderSnapshot === 'function' ? getStudioVSliderSnapshot() : null;
            installed = snap && snap.length ? snap.length : 0;
        } catch (_err) {
            installed = 0;
        }
        return {
            vSlider: installed ? getStudioVSliderSnapshot() : null,
            vSliderRequested: requested,
            vSliderInstalled: installed,
            vSliderRejected: requested > installed ? requested - installed : 0,
            vSliderHydrated: requested === 0 || installed > 0
        };
    }

    function resolveStudioText(data) {
        if (!data || typeof data !== 'object') return null;
        if (typeof data.change === 'string') return data.change;
        if (data.change && typeof data.change === 'object') return JSON.stringify(data.change);
        if (data.payload) {
            if (typeof data.payload === 'string') return data.payload;
            if (typeof data.payload === 'object') return JSON.stringify(data.payload);
        }
        const built = buildPromptUcChange(data);
        return built ? JSON.stringify(built) : null;
    }

    function readBoolFlag(value, defaultValue) {
        if (value === undefined || value === null) return defaultValue;
        if (typeof value === 'boolean') return value;
        if (value === 1 || value === '1' || value === 'true') return true;
        if (value === 0 || value === '0' || value === 'false') return false;
        return defaultValue;
    }

    function fireBoundTabGenerate() {
        const btn = document.getElementById('manualGenerateBtn');
        if (!btn) {
            return { generateStarted: false, generateError: 'Generate button is not available' };
        }
        if (btn.disabled) {
            return { generateStarted: false, generateError: 'Generate button is disabled' };
        }
        btn.click();
        return { generateStarted: true };
    }

    async function applyStudioFromCommand(data) {
        const autoApply = readBoolFlag(data && data.autoApply, true);
        const autoGenerate = readBoolFlag(data && data.autoGenerate, false);
        if (!autoApply && autoGenerate) {
            return { ok: false, error: 'autoGenerate requires autoApply' };
        }
        const payload = resolveStudioPayload(data);
        if (!payload) {
            return { ok: false, error: 'change JSON or prompt/uc fields are required' };
        }
        if (!autoApply) {
            return { ok: true, applied: false, autoApply: false, autoGenerate: false };
        }
        if (typeof window.applyStudioChangePayloadSilent !== 'function') {
            return { ok: false, error: 'Studio change helper is not available' };
        }
        const modal = document.getElementById('manualModal');
        const studioWasClosed = !modal || modal.classList.contains('hidden');
        let applied = false;
        try {
            applied = !!await window.applyStudioChangePayloadSilent(payload);
        } catch (err) {
            return {
                ok: false,
                applied: false,
                autoApply: true,
                autoGenerate,
                error: (err && err.message) || 'Failed to apply studio change'
            };
        }
        const hydration = readVSliderHydration(payload);
        if (!applied) {
            return {
                ok: false,
                applied: false,
                autoApply: true,
                autoGenerate,
                ...hydration,
                error: hydration.vSliderRejected
                    ? 'Studio change was not applied (vSlider catalog did not hydrate — check kind, axes, and 2+ stops per axis)'
                    : 'Studio change was not applied'
            };
        }
        const partialVSlider = hydration.vSliderRejected > 0;
        // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
        showAgentSessionTrayNotice(studioWasClosed ? 'open' : 'update', data);
        const checkpointId = storeStudioCheckpoint(captureStudioCheckpointPayload());
        const baseResult = {
            ok: true,
            applied: true,
            autoApply: true,
            opened: studioWasClosed,
            checkpointId,
            ...hydration,
            ...(partialVSlider ? {
                partial: true,
                warning: 'Prompt/expanders applied but vSlider catalog did not hydrate — fix kind, axes, and 2+ stops per axis, then retry vSlider only.'
            } : {})
        };
        if (!autoGenerate) {
            return { ...baseResult, autoGenerate: false };
        }
        const gen = fireBoundTabGenerate();
        return { ...baseResult, autoGenerate: true, ...gen };
    }

    async function openImageFromCommand(filename, commandData) {
        if (!filename) return { ok: false, error: 'filename is required' };
        if (typeof openManualModalWithContent !== 'function') {
            return { ok: false, error: 'Studio is not available' };
        }
        const image = (typeof findImageByFilename === 'function' && findImageByFilename(filename))
            || { filename };
        await openManualModalWithContent({ type: 'image', image }, null);
        // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
        showAgentSessionTrayNotice('open', commandData);
        return { ok: true, filename };
    }

    function readDynamicPhysicsConfig() {
        const todBtn = document.getElementById('todBtn');
        const weatherBtn = document.getElementById('weatherBtn');
        const seasonBtn = document.getElementById('seasonBtn');
        const config = {};
        // collectDynamicButtonState: public/scripts/comp/dynamicGenerationOverrides.js
        config.tod = collectDynamicButtonState(todBtn);
        config.weather = collectDynamicButtonState(weatherBtn);
        config.season = collectDynamicButtonState(seasonBtn);
        const loc = weatherBtn && weatherBtn.getAttribute('data-location');
        if (loc) config.location = loc;
        return config;
    }

    function readStudioChangeSnapshot() {
        if (typeof window.buildStudioChangeSnapshot === 'function') {
            try {
                return window.buildStudioChangeSnapshot();
            } catch (_err) {
                // fall through to empty editor
            }
        }
        return { dreamscape: 'change', v: 1 };
    }

    let studioCheckpoint = null;

    function newStudioCheckpointId() {
        return (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function captureStudioCheckpointPayload() {
        return {
            workspaceId: readWorkspaceId(),
            filename: readOpenFilename(),
            model: readModel(),
            change: readStudioChangeSnapshot(),
            dynamicGeneration: typeof readDynamicGenerationSnapshot === 'function'
                ? readDynamicGenerationSnapshot()
                : null,
            director: typeof readDirectorAttachSnapshot === 'function'
                ? readDirectorAttachSnapshot()
                : null
        };
    }

    function studioValuesEqual(left, right) {
        try {
            return JSON.stringify(left) === JSON.stringify(right);
        } catch (_err) {
            return left === right;
        }
    }

    function diffStudioCheckpointPayload(prev, next) {
        const keys = ['workspaceId', 'filename', 'model', 'change', 'dynamicGeneration', 'director'];
        const delta = {};
        let changed = false;
        for (let i = 0; i < keys.length; i += 1) {
            const key = keys[i];
            if (!studioValuesEqual(prev && prev[key], next && next[key])) {
                delta[key] = next[key];
                changed = true;
            }
        }
        return { changed, delta };
    }

    function storeStudioCheckpoint(payload) {
        const id = newStudioCheckpointId();
        studioCheckpoint = { id, payload };
        return id;
    }

    function replyStudioState(requestId, extra) {
        const current = captureStudioCheckpointPayload();
        const forceFull = !!(extra && (extra.full === true || extra.full === 'true'));
        const since = extra && (extra.since || extra.checkpointId);
        const canDiff = !forceFull && since && studioCheckpoint && studioCheckpoint.id === since;
        let body;
        if (canDiff) {
            const diffed = diffStudioCheckpointPayload(studioCheckpoint.payload, current);
            const checkpointId = storeStudioCheckpoint(current);
            body = {
                ok: true,
                clientId: sessionClientId,
                checkpointId,
                diff: true,
                unchanged: !diffed.changed,
                ...diffed.delta
            };
        } else {
            const checkpointId = storeStudioCheckpoint(current);
            body = {
                ok: true,
                clientId: sessionClientId,
                checkpointId,
                diff: false,
                unchanged: false,
                ...current
            };
        }
        replyAgentSessionResult(requestId, body);
    }

    async function handleAgentSessionCommand(message) {
        const requestId = message && message.requestId;
        const data = (message && message.data) || {};
        // Commands are only sent to the bound socket; treat arrival as bind confirmation.
        sessionBound = true;
        if (data.clientId) sessionClientId = data.clientId;
        const command = data.command;
        try {
            if (command === 'get_state' || command === 'get_editor') {
                // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
                showAgentSessionTrayNotice('read', data);
                // readDynamicGenerationSnapshot / readDirectorAttachSnapshot: public/scripts/comp/dynamicGenerationLockState.js
                replyStudioState(requestId, data);
                return;
            }
            if (command === 'get_windows') {
                // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
                showAgentSessionTrayNotice('windows', data);
                replyAgentSessionResult(requestId, {
                    ok: true,
                    clientId: sessionClientId,
                    ...collectOpenWindowsSnapshot()
                });
                return;
            }
            if (command === 'get_physics') {
                replyAgentSessionResult(requestId, {
                    ok: true,
                    clientId: sessionClientId,
                    dynamicConfig: readDynamicPhysicsConfig()
                });
                return;
            }
            if (command === 'open_image') {
                const result = await openImageFromCommand(data.filename, data);
                replyAgentSessionResult(requestId, result);
                return;
            }
            if (command === 'open_viewer') {
                if (typeof window.openMcpViewer !== 'function') {
                    replyAgentSessionResult(requestId, { ok: false, error: 'Viewer helper is not available' });
                    return;
                }
                const result = await window.openMcpViewer(data);
                replyAgentSessionResult(requestId, result);
                return;
            }
            if (command === 'apply_studio') {
                const result = await applyStudioFromCommand(data);
                replyAgentSessionResult(requestId, result);
                return;
            }
            if (command === 'client_update') {
                if (typeof window.showAgentClientUpdateDialog !== 'function') {
                    replyAgentSessionResult(requestId, { ok: false, error: 'Client update dialog is not available' });
                    return;
                }
                const result = await window.showAgentClientUpdateDialog();
                replyAgentSessionResult(requestId, result);
                return;
            }
            replyAgentSessionResult(requestId, { ok: false, error: 'Unknown command' });
        } catch (err) {
            replyAgentSessionResult(requestId, {
                ok: false,
                error: (err && err.message) || 'Command failed'
            });
        }
    }

    /**
     * Console / agent helper. Mints a short share code (no UI, never logs the code).
     * Usage: const { code, clientId, expiresInSec } = await window.agentSessionShareStart();
     */
    async function agentSessionUnbindRequest() {
        if (!window.wsClient || typeof window.wsClient.sendMessage !== 'function' || !window.wsClient.isConnected()) {
            throw new Error('WebSocket is not connected');
        }
        return window.wsClient.sendMessage('agent_session_unbind', {}, false);
    }

    async function agentSessionShareStart() {
        if (!window.wsClient || typeof window.wsClient.sendMessage !== 'function' || !window.wsClient.isConnected()) {
            throw new Error('WebSocket is not connected');
        }
        const data = await window.wsClient.sendMessage('session_share_start', {
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
        }, false);
        if (data && data.clientId) sessionClientId = data.clientId;
        return data;
    }

    if (typeof registerWsInboundHandler === 'function') {
        registerWsInboundHandler({
            id: 'agent.session_command',
            type: 'agent_session_command',
            phase: 'only',
            handler(message) {
                void handleAgentSessionCommand(message);
            }
        });
        registerWsInboundHandler({
            id: 'agent.session_bound',
            type: 'agent_session_bound',
            phase: 'only',
            handler(message) {
                sessionBound = true;
                if (message && message.data && message.data.clientId) {
                    sessionClientId = message.data.clientId;
                }
                // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
                showAgentSessionTrayNotice('bound', message && message.data);
            }
        });
        registerWsInboundHandler({
            id: 'agent.session_unbound',
            type: 'agent_session_unbound',
            phase: 'only',
            handler() {
                sessionBound = false;
                // markAgentSessionUnbound: public/scripts/comp/mcpActivityClient.js
                markAgentSessionUnbound();
            }
        });
        registerWsInboundHandler({
            id: 'agent.session_notice',
            type: 'agent_session_notice',
            phase: 'only',
            handler(message) {
                const action = message && message.data && message.data.action;
                if (action === 'physics') {
                    // markMcpPhysicsUsed: public/scripts/comp/mcpActivityClient.js
                    markMcpPhysicsUsed(message.data.actorName || message.data.appName);
                }
            }
        });
    }

    if (typeof window !== 'undefined') {
        window.agentSessionShareStart = agentSessionShareStart;
        window.agentSessionUnbindRequest = agentSessionUnbindRequest;
        window.isAgentSessionBound = () => sessionBound;
    }
})();
