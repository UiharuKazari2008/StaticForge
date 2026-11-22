'use strict';

/**
 * XM Radio's recorder as its own process (pm2 app `xmradio-recorder`, ecosystem.config.js), so a recording never stops
 * because Dreamscape restarted (Yukimi, Nov 21 2026: "due to how mission critical recordings are and we CAN NOT allow
 * the recording to stop because the server stopped we need a separate server running like the alchemy has. It can
 * communicate over a socket to the application interface on the server").
 *
 * It runs modules/xmRadioRecorder.js in its capture role with a SiriusXM client of its own (modules/xmRadio.js) that
 * never signs in: SiriusXM refuses a session from a second process, so Dreamscape hands over its access token (op
 * auth, again before it expires) and the account file stays read-only here. The pumps, the segments, the cuts, scheduled recordings, alerts and terms, and
 * the state file. A finished song or file goes to the spool (.cache/xmradio-spool/<id>.m4a + .json); Dreamscape files
 * it on the tape, now or when it is back (it owns the file store). Stopping this process keeps its recordings in the
 * state file; when it starts again each one carries on as the same recording from where it left off (the stream keeps
 * five hours, so the gap is read back). On a signal the segment on the wire is finished first and the exact next
 * segment stored, so a restart carries on from there; the recording queue lives in the same state file.
 *
 * Socket: a Unix socket beside the account file (.cache/xmradio-recorder.sock, mode 0600: this user only), one JSON
 * object a line.
 *   Dreamscape -> { id, op, args }      ops: auth { token, exp }, deck, start, stop, recordCut, recordChannel,
 *                                       recordRange { channelId, from, to, a, t, s, ik }, queueRemove { id },
 *                                       queueClear, setDeck, setTimers, addAlert, removeAlert, setTerms,
 *                                       tapeRenamed, playlist, ping
 *   <- { id, ok: true, result } | { id, ok: false, error: { message, code } }
 *   <- { ev: 'deck', deck }             after every change (pushed; Dreamscape keeps the last one)
 *   <- { ev: 'spool', id }              a finished file is waiting in the spool
 * Client: modules/xmRadioRecorderClient.js.
 */

const fs = require('fs');
const net = require('net');
const path = require('path');

const xmRadio = require('../../modules/xmRadio');
const recorder = require('../../modules/xmRadioRecorder');

xmRadio.useExternalAuth();

// the token Dreamscape last handed over, kept (owner only, beside the account file that holds the grants) so a restart
// of this service resumes its recordings at once instead of waiting for Dreamscape
const AUTH_FILE = path.join(path.dirname(xmRadio.accountFilePath()), 'xmradio-recorder-auth.json');
try {
    const kept = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    if (kept && kept.exp > Date.now() + 60000 && xmRadio.setAuth(kept)) console.log(`[xmradio-recorder] SiriusXM access kept (valid ${Math.round((kept.exp - Date.now()) / 60000)} min)`);
} catch (_) { /* none yet */ }

const SOCK = path.join(path.dirname(xmRadio.accountFilePath()), 'xmradio-recorder.sock');
const clients = new Set();

function send(sock, obj) {
    try { if (!sock.destroyed) sock.write(`${JSON.stringify(obj)}\n`); } catch (_) { /* gone */ }
}
function broadcast(obj) { clients.forEach((c) => send(c, obj)); }

// a burst of changes (a cut, a filed song) is one push
let deckTimer = null;
function deckChanged() {
    if (deckTimer) return;
    deckTimer = setTimeout(() => { deckTimer = null; broadcast({ ev: 'deck', deck: recorder.deck() }); }, 150);
}

recorder.init(xmRadio, null, { changed: deckChanged, spooled: (id) => broadcast({ ev: 'spool', id }), resumeMs: 1000 });

const OPS = {
    ping: () => ({ pid: process.pid, up: Math.round(process.uptime()) }),
    auth: (a) => {
        const ok = xmRadio.setAuth(a);
        if (ok) {
            try { fs.writeFileSync(`${AUTH_FILE}.tmp`, JSON.stringify({ token: a.token, exp: a.exp, entitlementHash: a.entitlementHash || '' }), { mode: 0o600 }); fs.renameSync(`${AUTH_FILE}.tmp`, AUTH_FILE); } catch (_) { /* in memory */ }
        }
        console.log(`[xmradio-recorder] SiriusXM access ${ok ? `received (valid ${Math.round(((Number(a && a.exp) || 0) - Date.now()) / 60000)} min)` : 'missing'}`);
        return ok;
    },
    deck: () => recorder.deck(),
    start: (a) => recorder.start(a || {}),
    stop: (a) => recorder.stop(String((a && a.rid) || '')),
    recordCut: (a) => recorder.recordCut(a.channelId, { fromStart: !!a.fromStart }),
    recordChannel: (a) => recorder.recordChannel(a.channelId, { fromStart: !!a.fromStart }),
    recordRange: (a) => recorder.recordRange(a.channelId, a || {}),
    queueRemove: (a) => recorder.queueRemove(String((a && a.id) || '')),
    queueClear: () => recorder.queueClear(),
    setDeck: (a) => recorder.setDeck(a || {}),
    setTimers: (a) => recorder.setTimers(a && a.timers),
    addAlert: (a) => recorder.addAlert(a || {}),
    removeAlert: (a) => recorder.removeAlert(String((a && a.id) || '')),
    setTerms: (a) => recorder.setTerms(a && a.terms),
    tapeRenamed: (a) => recorder.tapeRenamed(String(a.workspaceId || ''), String(a.from || ''), String(a.to || '')),
    playlist: (a) => recorder.playlist(String((a && a.rid) || ''))
};

async function handle(sock, line) {
    let msg;
    try { msg = JSON.parse(line); } catch (_) { return; }
    if (!msg || typeof msg !== 'object') return;
    const fn = OPS[msg.op];
    if (!fn) { send(sock, { id: msg.id, ok: false, error: { message: `Unknown operation ${msg.op}.`, code: 'XMREC_OP' } }); return; }
    try {
        const result = await fn(msg.args || {});
        send(sock, { id: msg.id, ok: true, result: result === undefined ? null : result });
    } catch (err) {
        send(sock, { id: msg.id, ok: false, error: { message: (err && err.message) || 'The recorder failed.', code: (err && err.code) || '' } });
    }
}

try { fs.unlinkSync(SOCK); } catch (_) { /* none left */ }
const server = net.createServer((sock) => {
    clients.add(sock);
    sock.setEncoding('utf8');
    let buf = '';
    sock.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (line) void handle(sock, line);
        }
        if (buf.length > 4 * 1024 * 1024) sock.destroy();
    });
    sock.on('close', () => clients.delete(sock));
    sock.on('error', () => clients.delete(sock));
    // what it has now, at once
    send(sock, { ev: 'deck', deck: recorder.deck() });
});
server.listen(SOCK, () => {
    try { fs.chmodSync(SOCK, 0o600); } catch (_) { /* best effort */ }
    console.log(`[xmradio-recorder] listening on ${SOCK} (pid ${process.pid})`);
});

// going down (pm2 restart / stop): finish the segment on the wire, store the exact next one and keep the queue, so
// the next process carries every recording on as the same recording - no half segment, no gap, no lost queue
let goingDown = false;
async function down(sig) {
    if (goingDown) return;
    goingDown = true;
    // pm2 allows 8 s (kill_timeout): never let a stuck fetch keep us from a clean handoff
    const hardStop = setTimeout(() => { console.warn(`[xmradio-recorder] ${sig}: handoff took too long; exiting`); process.exit(0); }, 7000);
    if (hardStop.unref) hardStop.unref();
    console.log(`[xmradio-recorder] ${sig}: finishing the current segment; recordings and queue hand over to the next start`);
    try { console.log(`[xmradio-recorder] handoff: ${JSON.stringify(await recorder.shutdown())}`); }
    catch (err) { console.warn(`[xmradio-recorder] handoff: ${err.message}`); }
    clearTimeout(hardStop);
    try { server.close(); } catch (_) { /* gone */ }
    try { fs.unlinkSync(SOCK); } catch (_) { /* gone */ }
    process.exit(0);
}
process.on('SIGINT', () => { void down('SIGINT'); });
process.on('SIGTERM', () => { void down('SIGTERM'); });
process.on('unhandledRejection', (err) => console.warn(`[xmradio-recorder] ${err && err.message}`));
