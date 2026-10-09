'use strict';

// Live E2E: does exactly what the Director UI does for a brand-new chat
// (create session -> send message with the default model) against the running
// server, and prints every director_* event so failures are visible.

const WebSocket = require('ws');
const path = require('path');
const globalResources = require('../modules/globalResources');

const PERSONA = process.argv[2] || 'wren';
const MODEL = process.argv[3] || 'grok-4.7';
const TIMEOUT_MS = 180000;

async function main() {
    const dbPath = path.join(process.cwd(), '.cache');
    await require('../modules/applicationAuthDatabase').initializeApplicationAuthDatabase(dbPath);
    await globalResources.initializeApplicationAuthManager();
    const auth = globalResources.getApplicationAuthManager();
    const ua = 'E2ENewChat/1.0';
    const key = await auth.createApplicationKey({ name: 'E2E New Chat', userAgent: ua, userType: 'admin', scopes: ['universal'] });
    const started = Date.now();
    const t = () => `+${((Date.now() - started) / 1000).toFixed(1)}s`;
    let sessionId = null;

    const done = (code) => {
        auth.revokeApplicationKey(key.summary.id).catch(() => {}).finally(() => process.exit(code));
    };

    const ws = new WebSocket('ws://127.0.0.1:9220/');
    const timer = setTimeout(() => { console.log(`${t()} TIMEOUT`); ws.close(); done(2); }, TIMEOUT_MS);
    const send = (obj) => ws.send(JSON.stringify(obj));

    ws.on('open', () => send({ type: 'authenticate_application', applicationKey: key.key, userAgent: ua, requestId: 'auth' }));
    ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        const type = msg.type || '';
        if (type === 'application_authenticated') {
            console.log(`${t()} authenticated; creating session (persona=${PERSONA})`);
            send({ type: 'director_create_session', persona: PERSONA, requestId: 'create' });
            return;
        }
        if (type === 'auth_error') {
            console.log(`${t()} auth_error: ${msg.code} ${msg.message}`); clearTimeout(timer); ws.close(); done(1); return;
        }
        if (type === 'director_streaming' || type === 'director_stream') return;
        if (!/director|error/i.test(type)) return;
        const data = msg.data || {};
        console.log(`${t()} ${type}: ${JSON.stringify(data).slice(0, 400)}`);
        if (type === 'director_create_session_response') {
            sessionId = (data.session && data.session.id) || data.sessionId || data.id;
            if (!sessionId) { console.log('no session id'); clearTimeout(timer); done(1); return; }
            console.log(`${t()} sending message on ${sessionId} model=${MODEL}`);
            send({
                type: 'director_send_message', requestId: 'send', persona: PERSONA, sessionId,
                content: 'Reply with just the word: pong', effort: 'medium', fast: false, model: MODEL,
                context: '', thinking: true, attachments: [], workspaceId: ''
            });
            return;
        }
        if (type === 'director_message_response' && data.sessionId === sessionId) {
            console.log(`${t()} SUCCESS`); clearTimeout(timer); ws.close(); done(0); return;
        }
        if ((type === 'director_message_error' && data.sessionId === sessionId) || type === 'error') {
            console.log(`${t()} FAILURE`); clearTimeout(timer); ws.close(); done(1);
        }
    });
    ws.on('error', (e) => { console.log('ws error', e.message); done(1); });
}

main().catch((e) => { console.error(e); process.exit(1); });
