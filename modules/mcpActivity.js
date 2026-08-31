/**
 * MCP activity ring + live client notify.
 * Broadcasts mcp_activity so the tray (2 min) and Periscope (Event Viewer) can show the last call.
 */

const MCP_ACTIVITY_TTL_MS = 2 * 60 * 1000;
const MAX_LOG = 80;
const LONG_STRING = 160;
const SKIP_KEYS = new Set([
    'image', 'imageData', 'buffer', 'preview', 'bytes', 'data', 'content', 'fileData'
]);
const GENERATE_TOOLS = new Set(['generate_image', 'generate_preset', 'upscale_image', 'expand_image']);

let entries = [];

function isGenerateTool(name, args) {
    if (GENERATE_TOOLS.has(name)) return true;
    if (name === 'advanced_tools' && args && GENERATE_TOOLS.has(String(args.name || args.tool || ''))) {
        return true;
    }
    return false;
}

function summarizeValue(value, depth) {
    if (value == null) return value;
    if (typeof value === 'string') {
        if (value.length > 200000) return `[omitted ${value.length} chars]`;
        if (value.length > LONG_STRING) return `${value.slice(0, LONG_STRING)}…`;
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Buffer.isBuffer(value)) return `[buffer ${value.length}]`;
    if (Array.isArray(value)) {
        if (depth > 2) return `[${value.length} items]`;
        const cap = value.slice(0, 8).map((item) => summarizeValue(item, depth + 1));
        if (value.length > 8) cap.push(`+${value.length - 8}`);
        return cap;
    }
    if (typeof value === 'object') {
        if (depth > 2) return '{…}';
        const out = {};
        Object.keys(value).slice(0, 16).forEach((key) => {
            if (SKIP_KEYS.has(key)) {
                out[key] = '[omitted]';
                return;
            }
            out[key] = summarizeValue(value[key], depth + 1);
        });
        return out;
    }
    return String(value);
}

function summarizeArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
    return summarizeValue(args, 0);
}

function summarizeResult(result) {
    if (!result) return { ok: false };
    if (typeof result === 'string') {
        return { text: result.length > LONG_STRING ? `${result.slice(0, LONG_STRING)}…` : result };
    }
    const content = result.content;
    let parsed = null;
    if (Array.isArray(content)) {
        const textPart = content.find((part) => part && part.type === 'text' && typeof part.text === 'string');
        if (textPart) {
            try {
                parsed = JSON.parse(textPart.text);
            } catch (_err) {
                parsed = { text: textPart.text.slice(0, LONG_STRING) };
            }
        }
        const imageCount = content.filter((part) => part && part.type === 'image').length;
        if (parsed && typeof parsed === 'object') {
            parsed = summarizeValue(parsed, 0);
            if (imageCount) parsed.images = imageCount;
        }
    }
    const success = result.isError ? false : (parsed && parsed.success === false ? false : !result.isError);
    return {
        success,
        error: parsed && parsed.error ? parsed.error : undefined,
        filename: parsed && parsed.filename ? parsed.filename : undefined,
        filenames: parsed && parsed.filenames ? parsed.filenames : undefined,
        count: parsed && parsed.count != null ? parsed.count : undefined,
        packetType: parsed && parsed.packetType ? parsed.packetType : undefined,
        preview: parsed
    };
}

function liveWsServer(globalResources) {
    if (!globalResources || typeof globalResources.getWebSocketServer !== 'function') return null;
    return globalResources.getWebSocketServer();
}

function broadcastActivity(globalResources, row) {
    const wsServer = liveWsServer(globalResources);
    if (!wsServer || typeof wsServer.broadcast !== 'function') return;
    wsServer.broadcast({
        type: 'mcp_activity',
        data: {
            tool: row.tool,
            args: row.argsSummary,
            result: row.resultSummary,
            success: row.success,
            generating: row.generating,
            at: row.at
        },
        timestamp: new Date(row.at).toISOString()
    });
}

function recordActivity(globalResources, entry) {
    const row = {
        tool: String(entry.tool || ''),
        argsSummary: entry.argsSummary || {},
        resultSummary: entry.resultSummary || null,
        success: entry.success !== false,
        generating: entry.generating,
        at: Date.now()
    };
    entries.push(row);
    if (entries.length > MAX_LOG) {
        entries = entries.slice(-MAX_LOG);
    }
    broadcastActivity(globalResources, row);
    return row;
}

function getRecent(now = Date.now()) {
    return entries.filter((row) => now - row.at <= MCP_ACTIVITY_TTL_MS);
}

function resetActivityLog() {
    entries = [];
}

module.exports = {
    MCP_ACTIVITY_TTL_MS,
    GENERATE_TOOLS,
    isGenerateTool,
    summarizeArgs,
    summarizeResult,
    summarizeValue,
    recordActivity,
    getRecent,
    resetActivityLog
};
