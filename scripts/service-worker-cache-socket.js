#!/usr/bin/env node
/**
 * Unix socket client — asks the running server to refresh SW hash cache
 * and broadcast the manifest to all connected clients.
 *
 * Used by scripts/notify-service-worker-update.sh
 */

const net = require('net');

const SOCKET_PATH = process.env.STATICFORGE_SOCKET_PATH || '/tmp/staticforge_mcp.sock';
const TIMEOUT_MS = Number(process.env.STATICFORGE_SOCKET_TIMEOUT_MS) || 120000;

const silent = process.argv.includes('--silent');
const jsonOutput = process.argv.includes('--json');

const message = {
    id: Date.now(),
    type: 'refresh_service_worker_cache',
    data: { silent }
};

const client = net.createConnection(SOCKET_PATH);
let buffer = '';
let settled = false;

function finish(code, payload) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try {
        client.destroy();
    } catch (_) { /* ignore */ }

    if (code === 0) {
        if (jsonOutput) {
            process.stdout.write(`${JSON.stringify(payload)}\n`);
        } else {
            console.log(`Service worker cache refreshed (${payload.assetsCount} assets, ${payload.clientsNotified} clients notified)`);
        }
    } else {
        const errText = typeof payload === 'string' ? payload : (payload && payload.error) || 'Request failed';
        if (jsonOutput) {
            process.stdout.write(`${JSON.stringify({ success: false, error: errText })}\n`);
        } else {
            console.error(errText);
        }
    }
    process.exit(code);
}

const timer = setTimeout(() => {
    finish(1, `Timed out after ${TIMEOUT_MS}ms (is the server running?)`);
}, TIMEOUT_MS);

client.on('connect', () => {
    client.write(`${JSON.stringify(message)}\n`);
});

client.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let response;
        try {
            response = JSON.parse(trimmed);
        } catch (error) {
            finish(1, `Invalid socket response: ${error.message}`);
            return;
        }

        if (response.type !== 'response' || response.id !== message.id) {
            continue;
        }

        if (response.success) {
            finish(0, response.data || { success: true });
        } else {
            finish(1, response.error || 'Server returned an error');
        }
        return;
    }
});

client.on('error', (error) => {
    if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
        finish(1, `Cannot connect to ${SOCKET_PATH} — is the server running?`);
        return;
    }
    finish(1, error.message);
});
