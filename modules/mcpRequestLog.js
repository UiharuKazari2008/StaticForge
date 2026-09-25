/**
 * Cheap MCP JSON-RPC call lines on the normal pm2 stdout log.
 * One line per HTTP request: method, tool, actor, IP, status, ok/error/abort, duration.
 * Never logs arguments, prompts, tokens, headers, or the MCP path UUID.
 */

const { monitorEventLoopDelay } = require('perf_hooks');

const LAG_WARN_NS = 500 * 1e6;
const LAG_WARN_COOLDOWN_MS = 30000;
const LAG_SAMPLE_MS = 1000;
const MCP_LOG_TOKEN_MAX = 64;
const MCP_LOG_TOKEN_RE = /[^A-Za-z0-9_./:-]+/g;

let lagHistogram = null;
let lagTimer = null;
let lastLagWarnAt = 0;

function formatTimestamp(now) {
    const d = now instanceof Date ? now : new Date(now || Date.now());
    return d.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

function readConfigPath(globalResources, key) {
    if (!globalResources || typeof globalResources.getConfig !== 'function') return undefined;
    try {
        return globalResources.getConfig({ path: key });
    } catch (_err) {
        return undefined;
    }
}

function isMcpRequestLogEnabled(globalResources) {
    const env = process.env.MCP_REQUEST_LOG;
    if (env === '0' || env === 'false' || env === 'off') return false;
    if (env === '1' || env === 'true' || env === 'on') return true;
    const cfg = readConfigPath(globalResources, 'mcp_request_log');
    if (cfg === false || cfg === 0 || cfg === 'false' || cfg === 'off') return false;
    return true;
}

function isMcpRpcPath(reqPath, uuid) {
    if (!uuid || !reqPath) return false;
    const prefix = `/${String(uuid)}`;
    return reqPath === prefix || reqPath === `${prefix}/` || reqPath === `${prefix}/mcp`;
}

function redactMcpPath(reqPath, uuid) {
    const raw = String(reqPath || '');
    const id = String(uuid || '');
    if (!id) return '/{mcp}';
    const prefix = `/${id}`;
    if (raw === prefix || raw.startsWith(`${prefix}/`)) {
        return `/{mcp}${raw.slice(prefix.length)}` || '/{mcp}';
    }
    return '/{mcp}';
}

function sanitizeMcpLogToken(value) {
    if (value == null) return null;
    const cleaned = String(value).replace(MCP_LOG_TOKEN_RE, '').slice(0, MCP_LOG_TOKEN_MAX);
    return cleaned || null;
}

function peekMcpRpc(body) {
    const items = Array.isArray(body) ? body : (body && typeof body === 'object' && !Array.isArray(body) ? [body] : []);
    if (!items.length) return { rpcMethod: null, tool: null, batch: null };
    const first = items[0];
    const rpcMethod = sanitizeMcpLogToken(first && typeof first.method === 'string' ? first.method : null);
    let tool = null;
    if (rpcMethod === 'tools/call' && first.params && typeof first.params === 'object' && !Array.isArray(first.params)) {
        tool = sanitizeMcpLogToken(first.params.name);
    }
    return { rpcMethod, tool, batch: items.length > 1 ? items.length : null };
}

function peekMcpActor(req) {
    const auth = req && req.applicationAuth;
    const keyId = auth && auth.applicationKeyId != null ? sanitizeMcpLogToken(auth.applicationKeyId) : null;
    if (!keyId) return null;
    const raw = auth.appName != null ? auth.appName : auth.applicationAppName;
    const name = raw != null ? sanitizeMcpLogToken(raw) : null;
    return name ? `${name}/appkey:${keyId}` : `appkey:${keyId}`;
}

function peekMcpIp(req) {
    // requestClientIP: modules/agentClientBridge.js (same header order as web_server.js getRealIP)
    if (!req) return 'unknown';
    const headers = req.headers || {};
    return headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        headers['x-real-ip'] ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        req.ip ||
        'unknown';
}

function inferMcpOutcome(statusCode, body) {
    const status = Number(statusCode) || 0;
    if (status >= 400) return 'error';
    if (Array.isArray(body)) {
        return body.some((item) => inferMcpOutcome(200, item) === 'error') ? 'error' : 'ok';
    }
    if (body && typeof body === 'object') {
        if (body.error) return 'error';
        if (body.result && body.result.isError === true) return 'error';
    }
    return 'ok';
}

function peekSseRpcOutcome(chunk) {
    if (typeof chunk !== 'string') return null;
    const marker = 'data: ';
    const idx = chunk.indexOf(marker);
    if (idx === -1) return null;
    const rest = chunk.slice(idx + marker.length);
    const end = rest.indexOf('\n');
    const jsonText = (end === -1 ? rest : rest.slice(0, end)).trim();
    if (!jsonText.startsWith('{') || !jsonText.endsWith('}')) return null;
    try {
        return inferMcpOutcome(200, JSON.parse(jsonText));
    } catch (_err) {
        return null;
    }
}

function shouldSkipMcpCallLog(req, peeked) {
    const httpMethod = req && req.method ? String(req.method).toUpperCase() : '';
    if (httpMethod === 'GET') return true;
    const rpc = peeked || peekMcpRpc(req && req.body);
    return rpc.rpcMethod === 'notifications/initialized';
}

function formatMcpCallLine(info) {
    const ts = info.timestamp || formatTimestamp();
    const parts = [`📋 [${ts}] MCP`, info.ip || 'unknown'];
    if (info.httpMethod) parts.push(String(info.httpMethod));
    if (info.path) parts.push(String(info.path));
    const rpcMethod = sanitizeMcpLogToken(info.rpcMethod);
    const tool = sanitizeMcpLogToken(info.tool);
    if (rpcMethod) parts.push(rpcMethod);
    if (tool) parts.push(tool);
    if (info.batch) parts.push(`batch=${info.batch}`);
    const actor = sanitizeMcpLogToken(info.actor);
    if (actor) parts.push(`actor=${actor}`);
    parts.push(`status=${info.status != null ? info.status : '-'}`);
    parts.push(info.outcome || 'ok');
    parts.push(`${Number(info.durationMs) || 0}ms`);
    return parts.join(' ');
}

function ensureLagMonitor() {
    if (lagHistogram) return;
    lagHistogram = monitorEventLoopDelay({ resolution: 20 });
    lagHistogram.enable();
    lagTimer = setInterval(() => {
        maybeWarnEventLoopLag();
    }, LAG_SAMPLE_MS);
    if (lagTimer && typeof lagTimer.unref === 'function') lagTimer.unref();
}

function sampleEventLoopLag() {
    if (!lagHistogram) return null;
    const p99 = lagHistogram.percentile(99);
    lagHistogram.reset();
    return p99;
}

function maybeWarnEventLoopLag(nowMs) {
    const p99 = sampleEventLoopLag();
    if (p99 == null || p99 < LAG_WARN_NS) return false;
    const now = nowMs != null ? Number(nowMs) : Date.now();
    if (now - lastLagWarnAt < LAG_WARN_COOLDOWN_MS) return false;
    lastLagWarnAt = now;
    console.log(`⚠️ [${formatTimestamp(now)}] MCP event-loop lag ${Math.round(p99 / 1e6)}ms`);
    return true;
}

function attachMcpRequestLog(req, res, options) {
    if (req && req._mcpCallLogAttached) return false;
    const opts = options && typeof options === 'object' ? options : {};
    if (!isMcpRequestLogEnabled(opts.globalResources)) return false;
    const peeked = peekMcpRpc(req && req.body);
    if (shouldSkipMcpCallLog(req, peeked)) return false;
    if (req) req._mcpCallLogAttached = true;
    ensureLagMonitor();

    const start = Date.now();
    const ip = peekMcpIp(req);
    const httpMethod = req && req.method ? String(req.method) : null;
    const path = redactMcpPath(req && (req.path || req.url), opts.uuid);
    let finished = false;
    let outcomeHint = null;
    let emitted = false;

    const emit = (outcome) => {
        if (emitted) return;
        emitted = true;
        console.log(formatMcpCallLine({
            ip,
            httpMethod,
            path,
            rpcMethod: peeked.rpcMethod,
            tool: peeked.tool,
            batch: peeked.batch,
            actor: peekMcpActor(req),
            status: res && res.statusCode,
            outcome,
            durationMs: Date.now() - start
        }));
    };

    if (res && typeof res.json === 'function') {
        const originalJson = res.json.bind(res);
        res.json = function mcpCallLogJson(body) {
            outcomeHint = inferMcpOutcome(res.statusCode || 200, body);
            return originalJson(body);
        };
    }

    if (res && typeof res.write === 'function') {
        const originalWrite = res.write.bind(res);
        res.write = function mcpCallLogWrite(chunk, encoding, cb) {
            if (outcomeHint == null) {
                const sseOutcome = peekSseRpcOutcome(chunk);
                if (sseOutcome) outcomeHint = sseOutcome;
            }
            return originalWrite(chunk, encoding, cb);
        };
    }

    if (res && typeof res.on === 'function') {
        res.on('finish', () => {
            finished = true;
            emit(outcomeHint || inferMcpOutcome(res.statusCode, null));
        });
        res.on('close', () => {
            if (!finished) emit('abort');
        });
    }
    return true;
}

module.exports = {
    formatTimestamp,
    formatMcpCallLine,
    sanitizeMcpLogToken,
    MCP_LOG_TOKEN_MAX,
    redactMcpPath,
    isMcpRpcPath,
    isMcpRequestLogEnabled,
    shouldSkipMcpCallLog,
    peekMcpRpc,
    peekMcpActor,
    peekMcpIp,
    peekSseRpcOutcome,
    inferMcpOutcome,
    attachMcpRequestLog,
    maybeWarnEventLoopLag,
    sampleEventLoopLag,
    LAG_SAMPLE_MS
};
