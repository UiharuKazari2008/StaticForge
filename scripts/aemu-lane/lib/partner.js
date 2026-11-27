#!/usr/bin/env node
// Proposes an ActiveSync partnership to the emulator as a harness "computer" (aemu.sh partner): a fresh dev-login
// session of its own on loopback, as_hello kind computer, then as_partnership propose. The emulator's page shows
// the confirm; accept it on the device (aemu.sh partner waits up to the server's propose timeout).
// Refuses unless the device is already marked a test device on the server.
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const WebSocket = require('ws');

// Usage: node partner.js <device id> <name>   (the device must already be a marked test device)
const DEV = String(process.argv[2] || '').trim();
const NAME = process.argv[3] || 'Lane emulator';
if (!/^[0-9a-f]{32}$/.test(DEV)) { console.error('partner: usage: node partner.js <32 hex device id> <name>'); process.exit(2); }
const devKey = fs.readFileSync(`${os.homedir()}/.secrets/dreamscape-dev-login.key`, 'utf8').trim();
const appKey = fs.readFileSync(`${os.homedir()}/.secrets/dreamscape-claude.key`, 'utf8').trim();
// the harness computer keeps one id (Device Center shows it as one computer)
const idFile = `${process.env.HOME}/.config/aemu-lane/computer-id`;
if (!fs.existsSync(idFile)) fs.writeFileSync(idFile, crypto.randomBytes(16).toString('hex'));
const COMPUTER = fs.readFileSync(idFile, 'utf8').trim();

function req(method, path, headers, body) {
    return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port: 9220, path, method, headers }, (res) => {
            let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ res, body: b }));
        });
        r.on('error', reject); r.end(body || undefined);
    });
}

(async () => {
    const t = await req('GET', '/api/test-devices', { Authorization: `Bearer ${appKey}`, 'X-StaticForge-App-Key': appKey, 'User-Agent': 'claude-code' });
    const marked = (JSON.parse(t.body).devices || []).some((d) => d.id === DEV);
    if (!marked) throw new Error(`${DEV} is not marked a test device: refusing to partner it`);
    const a = await req('GET', '/agent', { Authorization: `Bearer ${devKey}`, 'X-Forwarded-Proto': 'https', 'User-Agent': 'claude-code lane' });
    const sc = [].concat(a.res.headers['set-cookie'] || []).find((c) => c.startsWith('connect.sid='));
    if (!sc) throw new Error('no harness session');
    const ws = new WebSocket('ws://127.0.0.1:9220/', { headers: { Cookie: sc.split(';')[0], 'X-Forwarded-Proto': 'https', 'User-Agent': 'claude-code lane' } });
    let n = 0;
    const pending = new Map();
    ws.on('message', (m) => {
        let d; try { d = JSON.parse(m); } catch (_e) { return; }
        if (d.requestId && pending.has(d.requestId)) { pending.get(d.requestId)(d); pending.delete(d.requestId); }
    });
    const send = (type, data, ms = 15000) => new Promise((resolve, reject) => {
        const requestId = `lane-${++n}`;
        pending.set(requestId, resolve);
        ws.send(JSON.stringify({ type, data, requestId }));
        setTimeout(() => { if (pending.delete(requestId)) reject(new Error(`${type}: no answer`)); }, ms);
    });
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    await new Promise((r) => setTimeout(r, 1500)); // the server authenticates the socket from its session
    const h = await send('as_hello', { kind: 'computer', id: COMPUTER, name: 'lane harness', ops: [], testLane: true });
    if (!h.data || !h.data.success) throw new Error(`hello refused: ${JSON.stringify(h.data || h).slice(0, 200)}`);
    console.log(`proposing "${NAME}" to ${DEV.slice(0, 8)} - accept it on the emulator (lane.sh taps it)`);
    const p = await send('as_partnership', { action: 'propose', deviceId: DEV, mode: 'partner', name: NAME, syncItems: [] }, 200000);
    console.log(JSON.stringify({ success: p.data && p.data.success, accepted: p.data && p.data.accepted, code: p.data && p.data.code, error: p.data && p.data.error }));
    ws.close();
    process.exit(p.data && p.data.accepted ? 0 : 1);
})().catch((e) => { console.error(`partner: ${e.message}`); process.exit(1); });
