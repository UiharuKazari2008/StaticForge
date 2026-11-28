// labels: a stand-in client (a WebSocket authenticated with the comparison key, as the bridge treats any
// authenticated socket as a client) is bound by each caller; the server's own frames to it carry the label.
// Prints and writes only frame types, tool names and actorName fields.
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { call } = require('./mcp.js');
const ccKey = fs.readFileSync(path.join(__dirname, 'state/compare/claude-code.key'), 'utf8').trim();
const frames = [];
const ws = new WebSocket('ws://127.0.0.1:9302/', { headers: { 'user-agent': 'acc1199-standin-client' } });
const waitFor = (pred, ms) => new Promise((res) => { const t0 = Date.now(); const i = setInterval(() => { const f = frames.find(pred); if (f || Date.now() - t0 > ms) { clearInterval(i); res(f || null); } }, 50); });
ws.on('message', (d) => { try { frames.push({ at: Date.now(), m: JSON.parse(String(d)) }); } catch (_) { /* binary */ } });
const text = (r) => { try { return JSON.parse(r.rpc.result.content[0].text); } catch (_) { return null; } };
(async () => {
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    ws.send(JSON.stringify({ type: 'authenticate_application', applicationKey: ccKey, userAgent: 'claude-code/2.1.332 (sdk-cli)', requestId: 'a1' }));
    const auth = await waitFor((f) => f.m.requestId === 'a1', 5000);
    console.log('ws authenticate_application ->', auth ? auth.m.type : 'no answer');
    const out = [];
    const lc = await call('fleet', 'tools/call', 'list_clients', {});
    const lcj = text(lc);
    const list = (lcj && (lcj.clients || lcj)) || [];
    console.log('list_clients status', lc.status, 'clients', Array.isArray(list) ? list.length : '?');
    const mine = (Array.isArray(list) ? list : []).find((c) => /acc1199-standin/.test(c.userAgent || ''));
    if (!mine) { console.log('stand-in client not listed'); out.push('stand-in client not listed in list_clients: ' + JSON.stringify(lcj).slice(0, 300)); }
    else {
        for (const kind of ['fleet', 'item', 'fleet-noheader', 'compare']) {
            const b = await call(kind, 'tools/call', 'bind_session', { clientId: mine.clientId });
            console.log('bind_session', kind, 'HTTP', b.status, JSON.stringify(text(b)).replace(/"clientId":"[^"]*"/, '"clientId":"<id>"').replace(/"workspaceId":"[^"]*"/, '"workspaceId":"<ws>"').slice(0, 160));
            const g = await call(kind, 'tools/call', 'get_studio_state', {});
            console.log('get_studio_state', kind, 'HTTP', g.status);
        }
    }
    await new Promise((r) => setTimeout(r, 1500));
    const rows = [];
    for (const f of frames) {
        const m = f.m;
        const actor = (m.data && m.data.actorName) !== undefined ? m.data.actorName : (m.actorName !== undefined ? m.actorName : undefined);
        if (actor !== undefined || /agent_session|mcp_activity/.test(m.type)) rows.push(`${m.type}${m.data && m.data.tool ? ' tool=' + m.data.tool : ''} actorName=${JSON.stringify(actor === undefined ? null : actor)}`);
    }
    console.log('--- frames carrying an actor ---');
    console.log(rows.join('\n') || '(none)');
    fs.writeFileSync(path.join(__dirname, 'out/.labels-frames.txt'), rows.join('\n') + '\n');
    ws.close();
    setTimeout(() => process.exit(0), 300);
})().catch((e) => { console.log('failed', e.message); process.exit(1); });
