/**
 * Client side of the localhost agent session bridge.
 * Handles inbound agent_session_command, share-code UI, and a small Studio snapshot.
 * Depends on: wsInboundRegistry, studioChangeJson, manualModalManager, confirmationDialog
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
            // ignore send failures; the HTTP side will time out
        }
    }

    function readOpenFilename() {
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

    function resolveStudioPayload(data) {
        if (!data || typeof data !== 'object') return null;
        if (data.payload && typeof window.extractStudioChangeJson === 'function') {
            const fromPayload = typeof data.payload === 'string'
                ? window.extractStudioChangeJson(data.payload)
                : (data.payload.dreamscape || data.payload.type || data.payload.kind ? data.payload : null);
            if (fromPayload) return fromPayload;
        }
        if (data.change) {
            if (typeof data.change === 'string' && typeof window.extractStudioChangeJson === 'function') {
                return window.extractStudioChangeJson(data.change);
            }
            if (typeof data.change === 'object') return data.change;
        }
        if (data.prompt != null || data.uc != null) {
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
            return { dreamscape: 'change', v: 1, fields };
        }
        return null;
    }

    async function applyStudioFromCommand(data) {
        const payload = resolveStudioPayload(data);
        if (!payload) {
            return { ok: false, error: 'change JSON or prompt/uc fields are required' };
        }
        if (typeof window.applyStudioChangePayloadSilent === 'function') {
            return window.applyStudioChangePayloadSilent(payload);
        }
        if (typeof window.tryApplyStudioChangeJsonFromText === 'function') {
            const accepted = window.tryApplyStudioChangeJsonFromText(JSON.stringify(payload));
            return { ok: !!accepted, dialog: true };
        }
        return { ok: false, error: 'Studio change helper is not available' };
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

    async function handleAgentSessionCommand(message) {
        const requestId = message && message.requestId;
        const data = (message && message.data) || {};
        if (!sessionBound) {
            replyAgentSessionResult(requestId, { ok: false, error: 'Client is not bound' });
            return;
        }
        const command = data.command;
        try {
            if (command === 'get_state') {
                replyAgentSessionResult(requestId, {
                    ok: true,
                    workspaceId: readWorkspaceId(),
                    filename: readOpenFilename(),
                    model: readModel(),
                    clientId: sessionClientId
                });
                return;
            }
            if (command === 'open_image') {
                const result = await openImageFromCommand(data.filename);
                replyAgentSessionResult(requestId, result);
                return;
            }
            if (command === 'apply_studio') {
                const result = await applyStudioFromCommand(data);
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

    async function showAgentSessionShareDialog() {
        if (!window.wsClient || typeof window.wsClient.sendMessage !== 'function' || !window.wsClient.isConnected()) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Share session', 'WebSocket is not connected', false, 4000, '<i class="fas fa-share-nodes"></i>');
            }
            return;
        }
        try {
            const data = await window.wsClient.sendMessage('session_share_start', {
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
            }, false);
            if (data && data.clientId) sessionClientId = data.clientId;
            const code = data && data.code ? String(data.code) : '';
            const expiresInSec = data && data.expiresInSec ? data.expiresInSec : 300;
            if (!code) {
                throw new Error('No share code returned');
            }
            const body = `Give this code to a localhost agent (loopback + Bearer, not the PIN pad). It expires in ${expiresInSec} seconds.<br><br><strong style="letter-spacing:0.18em;font-size:1.35em">${typeof escapeHtml === "function" ? escapeHtml(code) : code}</strong>`;
            if (typeof showConfirmationDialog === 'function') {
                await showConfirmationDialog(body, [
                    { text: 'OK', value: true, className: 'btn-standard primary' }
                ], null, { title: 'Share session' });
            } else if (typeof showGlassToast === 'function') {
                showGlassToast('info', 'Share session', code, false, 20000, '<i class="fas fa-share-nodes"></i>');
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Share session', (err && err.message) || 'Failed to start share', false, 4000, '<i class="fas fa-share-nodes"></i>');
            }
        }
    }

    function wireShareSessionClicks() {
        document.addEventListener('click', (event) => {
            const trigger = event.target && event.target.closest && event.target.closest('[data-agent-share-session]');
            if (!trigger) return;
            event.preventDefault();
            event.stopPropagation();
            void showAgentSessionShareDialog();
        });
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

    wireShareSessionClicks();

    if (typeof window !== 'undefined') {
        window.showAgentSessionShareDialog = showAgentSessionShareDialog;
    }
})();
