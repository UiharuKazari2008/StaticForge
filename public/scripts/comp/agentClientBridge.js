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
        const text = resolveStudioText(data);
        if (!text) {
            return { ok: false, error: 'change JSON or prompt/uc fields are required' };
        }
        if (!autoApply) {
            return { ok: true, applied: false, autoApply: false, autoGenerate: false };
        }
        if (typeof window.applyStudioChangePayloadSilent !== 'function' || typeof window.extractStudioChangeJson !== 'function') {
            return { ok: false, error: 'Studio change helper is not available' };
        }
        const payload = window.extractStudioChangeJson(text);
        if (!payload) {
            return { ok: false, error: 'change JSON is not valid' };
        }
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
        if (!applied) {
            return { ok: false, applied: false, autoApply: true, autoGenerate, error: 'Studio change was not applied' };
        }
        if (!autoGenerate) {
            return { ok: true, applied: true, autoApply: true, autoGenerate: false };
        }
        const gen = fireBoundTabGenerate();
        return { ok: true, applied: true, autoApply: true, autoGenerate: true, ...gen };
    }

    async function openImageFromCommand(filename) {
        if (!filename) return { ok: false, error: 'filename is required' };
        if (typeof openManualModalWithContent !== 'function') {
            return { ok: false, error: 'Studio is not available' };
        }
        const image = (typeof findImageByFilename === 'function' && findImageByFilename(filename))
            || { filename };
        await openManualModalWithContent({ type: 'image', image }, null);
        return { ok: true, filename };
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

    async function handleAgentSessionCommand(message) {
        const requestId = message && message.requestId;
        const data = (message && message.data) || {};
        // Commands are only sent to the bound socket; treat arrival as bind confirmation.
        sessionBound = true;
        if (data.clientId) sessionClientId = data.clientId;
        const command = data.command;
        try {
            if (command === 'get_state' || command === 'get_editor') {
                replyAgentSessionResult(requestId, {
                    ok: true,
                    workspaceId: readWorkspaceId(),
                    filename: readOpenFilename(),
                    model: readModel(),
                    clientId: sessionClientId,
                    change: readStudioChangeSnapshot()
                });
                return;
            }
            if (command === 'open_image') {
                const result = await openImageFromCommand(data.filename);
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
            }
        });
        registerWsInboundHandler({
            id: 'agent.session_unbound',
            type: 'agent_session_unbound',
            phase: 'only',
            handler() {
                sessionBound = false;
            }
        });
    }

    if (typeof window !== 'undefined') {
        window.agentSessionShareStart = agentSessionShareStart;
    }
})();
