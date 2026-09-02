/**
 * Remote Access tray (2 min) + Periscope Event Viewer log + open Lumen / Glancewell from MCP.
 * Periscope: public/scripts/comp/logViewerApplet.js
 * Tray generating: public/scripts/comp/trayIndicators.js
 * Lumen / Glancewell: public/scripts/comp/lightbox.js, public/scripts/comp/imageViewer.js
 */

const MCP_ACTIVITY_TTL_MS = 2 * 60 * 1000;
const MCP_PHYSICS_TTL_MS = 15 * 60 * 1000;
const MCP_ACTIVITY_LOG_CLIENT_SOURCE_ID = 'client:mcp-activity';
const MCP_ACTIVITY_LOG_MAX_ENTRIES = 80;
const MCP_NOTICE_COALESCE_MS = 2000;
const mcpActivityLogBuffer = [];
let mcpActivityHideTimer = null;
let mcpPhysicsHideTimer = null;
let mcpPhysicsUsedAt = 0;
let mcpSessionBound = false;
let mcpLastActorName = '';
let mcpLastNoticeAt = 0;
let mcpLastNoticeActor = '';
let mcpLastNoticeGroup = '';

function formatMcpActivityTime(at) {
    try {
        return new Date(at).toLocaleTimeString();
    } catch (_err) {
        return '';
    }
}

function rememberRemoteActor(name) {
    const trimmed = String(name || '').trim();
    if (trimmed) mcpLastActorName = trimmed;
    return mcpLastActorName;
}

function quotedRemoteActor(name) {
    const actor = String(name || mcpLastActorName || '').trim();
    if (!actor) return null;
    return `"${actor.replace(/"/g, '')}"`;
}

function formatRemoteAccessMessage(action, actorName) {
    const who = quotedRemoteActor(actorName);
    if (action === 'update') {
        return who ? `Studio was updated by ${who}` : 'Studio was updated remotely';
    }
    if (action === 'open') {
        return who ? `Studio was opened by ${who}` : 'Studio was opened remotely';
    }
    if (action === 'read' || action === 'studio-read') {
        return who ? `Studio was read by ${who}` : 'Studio was read remotely';
    }
    if (action === 'physics') {
        return who ? `Your location was accessed by ${who}` : 'Your location was accessed remotely';
    }
    return who ? `Your session was accessed by ${who}` : 'Your session was accessed remotely';
}

function summarizeMcpHover(entry) {
    const who = quotedRemoteActor(entry && entry.actorName);
    const accessed = who ? `Your session was accessed by ${who}` : 'Your session was accessed remotely';
    if (!entry) return accessed;
    const tool = entry.tool || '';
    const result = entry.result || {};
    const bit = result.filename || (Array.isArray(result.filenames) ? result.filenames[0] : '') || result.error || '';
    if (tool && bit) return `${accessed} — ${tool} (${bit})`;
    if (tool) return `${accessed} — ${tool}`;
    return accessed;
}

function formatMcpActivityLogLine(entry) {
    const time = formatMcpActivityTime(entry.at);
    let phase = 'ok';
    if (entry.success === false) phase = 'error';
    else if (entry.generating === true) phase = 'generating';
    else if (entry.generating === false) phase = 'done';
    const argsText = JSON.stringify(entry.args || {});
    const resultText = entry.result == null ? '' : ` ${JSON.stringify(entry.result)}`;
    const actor = quotedRemoteActor(entry.actorName);
    const who = actor ? ` ${actor}` : '';
    return `[${time}] ${phase}${who} ${entry.tool || 'mcp'} — ${argsText}${resultText}`;
}

function getMcpActivityLogFormattedText() {
    if (!mcpActivityLogBuffer.length) {
        return 'No remote access recorded.';
    }
    return mcpActivityLogBuffer.map(formatMcpActivityLogLine).join('\n');
}

function updateMcpActivityIndicator() {
    const indicator = document.getElementById('mcpActivityIndicator');
    if (!indicator) return;
    const now = Date.now();
    const recent = mcpActivityLogBuffer.filter((row) => now - row.at <= MCP_ACTIVITY_TTL_MS);
    const last = recent[recent.length - 1];
    if (!last && !mcpSessionBound) {
        indicator.classList.add('hidden');
        indicator.classList.remove('active');
        indicator.title = 'Remote Access';
        return;
    }
    indicator.classList.remove('hidden');
    indicator.classList.add('active');
    const who = quotedRemoteActor(last && last.actorName);
    const boundHint = mcpSessionBound
        ? (who ? `Remote Access — bound to ${who} (right-click to unbind)` : 'Remote Access — bound (right-click to unbind)')
        : '';
    indicator.title = last
        ? (mcpSessionBound ? `${summarizeMcpHover(last)} (right-click to unbind)` : summarizeMcpHover(last))
        : boundHint;
    if (mcpActivityHideTimer) clearTimeout(mcpActivityHideTimer);
    if (!mcpSessionBound && last) {
        mcpActivityHideTimer = setTimeout(updateMcpActivityIndicator, Math.max(250, MCP_ACTIVITY_TTL_MS - (now - last.at) + 50));
    }
}

function updateMcpPhysicsIndicator() {
    const indicator = document.getElementById('mcpPhysicsIndicator');
    if (!indicator) return;
    const now = Date.now();
    const fresh = mcpPhysicsUsedAt && (now - mcpPhysicsUsedAt) <= MCP_PHYSICS_TTL_MS;
    if (!fresh && !(mcpSessionBound && mcpPhysicsUsedAt)) {
        indicator.classList.add('hidden');
        indicator.classList.remove('active');
        indicator.title = 'Location';
        return;
    }
    indicator.classList.remove('hidden');
    indicator.classList.add('active');
    indicator.title = formatRemoteAccessMessage('physics', mcpLastActorName);
    if (mcpPhysicsHideTimer) clearTimeout(mcpPhysicsHideTimer);
    if (fresh) {
        mcpPhysicsHideTimer = setTimeout(updateMcpPhysicsIndicator, Math.max(250, MCP_PHYSICS_TTL_MS - (now - mcpPhysicsUsedAt) + 50));
    }
}

function markMcpPhysicsUsed(actorName) {
    rememberRemoteActor(actorName);
    mcpPhysicsUsedAt = Date.now();
    updateMcpPhysicsIndicator();
    updateMcpActivityIndicator();
    showAgentSessionTrayNotice('physics');
}

function markAgentSessionBound() {
    mcpSessionBound = true;
    updateMcpActivityIndicator();
}

function markAgentSessionUnbound() {
    mcpSessionBound = false;
    mcpPhysicsUsedAt = 0;
    mcpLastActorName = '';
    updateMcpActivityIndicator();
    updateMcpPhysicsIndicator();
}

function showAgentSessionTrayNotice(action, messageOrData) {
    let actorName = mcpLastActorName;
    let message;
    if (messageOrData && typeof messageOrData === 'object') {
        actorName = rememberRemoteActor(messageOrData.actorName || messageOrData.appName);
        message = formatRemoteAccessMessage(action, actorName);
    } else if (typeof messageOrData === 'string' && messageOrData) {
        message = messageOrData;
    } else {
        message = formatRemoteAccessMessage(action, actorName);
    }
    if (action === 'bound') markAgentSessionBound();
    if (action === 'physics') {
        mcpPhysicsUsedAt = Date.now();
        updateMcpPhysicsIndicator();
    }
    updateMcpActivityIndicator();
    const now = Date.now();
    const noticeGroup = (action === 'read' || action === 'studio-read' || action === 'windows' || action === 'bound')
        ? 'access'
        : action;
    const sameActor = actorName && actorName === mcpLastNoticeActor;
    if (sameActor && noticeGroup === mcpLastNoticeGroup && (now - mcpLastNoticeAt) < MCP_NOTICE_COALESCE_MS) {
        return;
    }
    mcpLastNoticeAt = now;
    mcpLastNoticeActor = actorName || '';
    mcpLastNoticeGroup = noticeGroup;
    const anchor = document.getElementById('mcpActivityIndicator');
    if (!anchor) return;
    const iconClass = action === 'physics' ? 'fas fa-location-arrow' : 'fas fa-screencast';
    // showPopover: public/scripts/comp/popoverManager.js
    showPopover(anchor, 'info', 'Remote Access', message, false, 8000, `<i class="${iconClass}"></i>`, null, {
        position: 'top',
        arrowPosition: 'bottom-right'
    });
    // startPopoverAutoHideTimer: public/scripts/comp/systemTrayManager.js
    startPopoverAutoHideTimer(anchor);
}

function notifyMcpActivityLogViewer(entry) {
    // logViewerApplet — public/scripts/comp/logViewerApplet.js (on-open via featureLoader)
    if (typeof logViewerApplet !== 'undefined' && logViewerApplet && logViewerApplet.isMcpActivityLogSourceActive()) {
        logViewerApplet.onMcpActivityLogEntry(entry);
    }
}

function recordMcpActivity(data) {
    if (!data || typeof data !== 'object') return;
    const entry = {
        tool: data.tool || '',
        args: data.args || {},
        result: data.result || null,
        success: data.success !== false,
        generating: data.generating,
        actorName: data.actorName || data.appName || '',
        at: Number(data.at) || Date.now()
    };
    rememberRemoteActor(entry.actorName);
    mcpActivityLogBuffer.push(entry);
    while (mcpActivityLogBuffer.length > MCP_ACTIVITY_LOG_MAX_ENTRIES) {
        mcpActivityLogBuffer.shift();
    }

    if (entry.generating === true) {
        window.mcpRemoteGenerating = true;
    } else if (entry.generating === false) {
        window.mcpRemoteGenerating = false;
    }
    // updateImageGenerationIndicator: public/scripts/comp/trayIndicators.js
    updateImageGenerationIndicator({ reveal: true });
    updateMcpActivityIndicator();
    notifyMcpActivityLogViewer(entry);
}

function resolveViewerImage(filename) {
    // findImageByFilename: public/scripts/comp/galleryView.js
    const found = findImageByFilename(filename);
    return found || { filename: filename, original: filename };
}

function openLumenForFilenames(filenames) {
    const name = filenames[0];
    if (!name) return { ok: false, error: 'filename is required' };
    const image = resolveViewerImage(name);
    // openGalleryImageInViewer: public/scripts/comp/imageViewer.js
    openGalleryImageInViewer(image);
    return { ok: true, target: 'lumen', filename: name };
}

async function openGlancewellForFilenames(filenames) {
    if (!filenames.length) return { ok: false, error: 'filename is required' };
    if (filenames.length === 1) {
        // showLightbox: public/scripts/comp/lightbox.js
        await showLightbox({ filename: filenames[0] });
        return { ok: true, target: 'glancewell', filenames: filenames };
    }
    const dataSource = filenames.map((name) => {
        const image = resolveViewerImage(name);
        // resolveGalleryFullImageUrl / localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        const src = resolveGalleryFullImageUrl(image)
            || localGalleryImageUrl(image.upscaled || image.original || name)
            || ('/images/' + encodeURIComponent(name));
        return {
            src: src,
            width: image.width || 1024,
            height: image.height || 1024
        };
    });
    // openStandalonePhotoSwipe: public/scripts/comp/lightbox.js
    await openStandalonePhotoSwipe(dataSource);
    return { ok: true, target: 'glancewell', filenames: filenames };
}

async function openMcpViewer(data) {
    const target = String((data && data.target) || 'lumen').toLowerCase();
    const filenames = [];
    const raw = (data && (data.filenames || data.filename)) || [];
    const list = Array.isArray(raw) ? raw : [raw];
    list.forEach((item) => {
        const name = typeof item === 'string' ? item : (item && item.filename);
        if (name) filenames.push(name);
    });
    if (target === 'glancewell' || target === 'lightbox') {
        return openGlancewellForFilenames(filenames);
    }
    return openLumenForFilenames(filenames);
}

async function openMcpActivityInPeriscope() {
    // featureLoader: public/scripts/comp/featureLoader.js
    await featureLoader.loadFeature('log_viewer');
    // logViewerApplet: public/scripts/comp/logViewerApplet.js
    await logViewerApplet.open({ source: MCP_ACTIVITY_LOG_CLIENT_SOURCE_ID });
}

function wireMcpActivityTrayClick() {
    const indicator = document.getElementById('mcpActivityIndicator');
    if (!indicator || indicator.dataset.mcpPeriscopeWired === '1') return;
    indicator.dataset.mcpPeriscopeWired = '1';
    indicator.addEventListener('click', function () {
        void openMcpActivityInPeriscope();
    });
    if (!contextMenu) return;
    contextMenu.attachToElement(indicator, {
        sections: [
            {
                type: 'list',
                title: 'Remote Access',
                items: [
                    {
                        icon: 'fas fa-unlink',
                        text: 'Disconnect',
                        action: 'mcp-session-unbind',
                        tooltip: 'Stop remote access from driving this tab',
                        loadfn: (item) => {
                            item.disabled = !mcpSessionBound && !window.isAgentSessionBound();
                        }
                    },
                    {
                        icon: 'fas fa-list',
                        text: 'Open access log',
                        action: 'mcp-open-periscope',
                        tooltip: 'Open Periscope Remote Access activity'
                    }
                ]
            }
        ],
        onAction: (action) => {
            if (action === 'mcp-session-unbind') {
                // agentSessionUnbindRequest: public/scripts/comp/agentClientBridge.js
                void agentSessionUnbindRequest();
                return;
            }
            if (action === 'mcp-open-periscope') {
                void openMcpActivityInPeriscope();
            }
        }
    });
}

registerWsInboundHandler({
    id: 'mcp.activity',
    type: 'mcp_activity',
    phase: 'only',
    handler(message) {
        recordMcpActivity(message && message.data);
    }
});
registerWsInboundHandler({
    id: 'mcp.open_viewer',
    type: 'mcp_open_viewer',
    phase: 'only',
    handler(message) {
        void openMcpViewer(message && message.data);
    }
});

window.openMcpViewer = openMcpViewer;
window.recordMcpActivity = recordMcpActivity;
window.showAgentSessionTrayNotice = showAgentSessionTrayNotice;
window.markMcpPhysicsUsed = markMcpPhysicsUsed;
window.markAgentSessionUnbound = markAgentSessionUnbound;
window.mcpActivityLogApi = {
    clientSourceId: MCP_ACTIVITY_LOG_CLIENT_SOURCE_ID,
    getFormattedText: getMcpActivityLogFormattedText,
    getEntryCount: () => mcpActivityLogBuffer.length
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        updateMcpActivityIndicator();
        updateMcpPhysicsIndicator();
        wireMcpActivityTrayClick();
    });
} else {
    updateMcpActivityIndicator();
    updateMcpPhysicsIndicator();
    wireMcpActivityTrayClick();
}
