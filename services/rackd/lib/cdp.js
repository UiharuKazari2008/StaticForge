'use strict';
// Tiny Chrome DevTools Protocol client over lib/wsclient.js.
const http = require('http');
const { connect } = require('./wsclient');

function getJson(port, p, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: timeoutMs }, res => {
      let b = ''; res.on('data', d => { b += d; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('cdp http timeout')));
  });
}

async function session(wsUrl) {
  const ws = await connect(wsUrl);
  let id = 0; const pending = new Map(); const waiters = [];
  ws.on('message', m => {
    let j; try { j = JSON.parse(m); } catch { return; }
    if (j.id && pending.has(j.id)) { const p = pending.get(j.id); pending.delete(j.id); j.error ? p.rej(new Error(j.error.message || 'cdp error')) : p.res(j.result); }
    else if (j.method) for (const w of waiters.slice()) if (w.method === j.method) { waiters.splice(waiters.indexOf(w), 1); w.res(j.params); }
  });
  ws.on('close', () => { for (const p of pending.values()) p.rej(new Error('cdp closed')); pending.clear(); });
  return {
    send: (method, params = {}, timeoutMs = 30000) => new Promise((res, rej) => {
      const i = ++id; const t = setTimeout(() => { pending.delete(i); rej(new Error(`cdp ${method} timed out`)); }, timeoutMs);
      pending.set(i, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
      ws.sendText(JSON.stringify({ id: i, method, params }));
    }),
    waitFor: (method, timeoutMs = 10000) => new Promise(res => { const w = { method, res }; waiters.push(w); setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); res(null); } }, timeoutMs); }),
    close: () => ws.close(),
  };
}

// First page target of a browser on `port`.
async function pageTarget(port) {
  const list = await getJson(port, '/json/list');
  const t = list.find(x => x.type === 'page');
  if (!t) throw new Error('no page target');
  return t;
}
module.exports = { getJson, session, pageTarget };
