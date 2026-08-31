/**
 * MCP activity tray (2 min) + Periscope Event Viewer log + open Lumen / Glancewell from MCP.
 * Periscope: public/scripts/comp/logViewerApplet.js
 * Tray generating: public/scripts/comp/trayIndicators.js
 * Lumen / Glancewell: public/scripts/comp/lightbox.js, public/scripts/comp/imageViewer.js
 */

const MCP_ACTIVITY_TTL_MS = 2 * 60 * 1000;
const MCP_ACTIVITY_LOG_CLIENT_SOURCE_ID = 'client:mcp-activity';
const MCP_ACTIVITY_LOG_MAX_ENTRIES = 80;
const mcpActivityLogBuffer = [];
let mcpActivityHideTimer = null;

function formatMcpActivityTime(at) {
    try {
        return new Date(at).toLocaleTimeString();
    } catch (_err) {
        return '';
    }
}

function summarizeMcpHover(entry) {
    if (!entry) return 'MCP';
    const tool = entry.tool || 'mcp';
    const result = entry.result || {};
    const bit = result.filename || (Array.isArray(result.filenames) ? result.filenames[0] : '') || result.error || '';
    return bit ? `MCP: ${tool} — ${bit}` : `MCP: ${tool}`;
}

function formatMcpActivityLogLine(entry) {
    const time = formatMcpActivityTime(entry.at);
    let phase = 'ok';
    if (entry.success === false) phase = 'error';
    else if (entry.generating === true) phase = 'generating';
    else if (entry.generating === false) phase = 'done';
    const argsText = JSON.stringify(entry.args || {});
    const resultText = entry.result == null ? '' : ` ${JSON.stringify(entry.result)}`;
    return `[${time}] ${phase} ${entry.tool || 'mcp'} — ${argsText}${resultText}`;
}

function getMcpActivityLogFormattedText() {
    if (!mcpActivityLogBuffer.length) {
        return 'No MCP interactions recorded.';
    }
    return mcpActivityLogBuffer.map(formatMcpActivityLogLine).join('\n');
}

function updateMcpActivityIndicator() {
    const indicator = document.getElementById('mcpActivityIndicator');
    if (!indicator) return;
    const now = Date.now();
    const recent = mcpActivityLogBuffer.filter((row) => now - row.at <= MCP_ACTIVITY_TTL_MS);
    const last = recent[recent.length - 1];
    if (!last) {
        indicator.classList.add('hidden');
        indicator.classList.remove('active');
        indicator.title = 'MCP';
        return;
    }
    indicator.classList.remove('hidden');
    indicator.classList.add('active');
    indicator.title = summarizeMcpHover(last);
    if (mcpActivityHideTimer) clearTimeout(mcpActivityHideTimer);
    mcpActivityHideTimer = setTimeout(updateMcpActivityIndicator, Math.max(250, MCP_ACTIVITY_TTL_MS - (now - last.at) + 50));
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
        at: Number(data.at) || Date.now()
    };
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
window.mcpActivityLogApi = {
    clientSourceId: MCP_ACTIVITY_LOG_CLIENT_SOURCE_ID,
    getFormattedText: getMcpActivityLogFormattedText,
    getEntryCount: () => mcpActivityLogBuffer.length
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        updateMcpActivityIndicator();
        wireMcpActivityTrayClick();
    });
} else {
    updateMcpActivityIndicator();
    wireMcpActivityTrayClick();
}
