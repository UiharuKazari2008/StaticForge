#!/usr/bin/env node
/**
 * Window icon audit (#954): every desktop window caption and taskbar button shows an image icon when image icons are
 * on, never only a Font Awesome glyph. Runs in a live tab over CDP and lists the offenders.
 *
 *   node scripts/audit-window-icons.js <targetId> [--port 9333]
 *
 * Opens nothing itself: open the windows to audit first (or pass --open to open every Start menu program the
 * Toolbox lists, then audit). Exit 1 when something shows a glyph only.
 */
'use strict';
const http = require('http');
const WebSocket = require('ws');

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const port = Number((args[args.indexOf('--port') + 1]) || 9333);
if (!target) { console.error('usage: node scripts/audit-window-icons.js <targetId> [--port 9333] [--open]'); process.exit(2); }

const AUDIT = `(() => {
  const vis = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
  const glyphOnly = (box) => { if (!box) return false; const img = box.querySelector('img.icon-image, img'); const i = box.querySelector('i'); return !(img && vis(img)) && !!(i && vis(i)); };
  const out = { captions: [], taskbar: [] };
  document.querySelectorAll('.modal').forEach((m) => {
    if (!vis(m)) return;
    const main = m.querySelector(':scope > .modal-window-title > .modal-window-title-main');
    if (!main) return;
    if (m.dataset.vistaDialog === 'message' || m.dataset.captionIcon === 'none') return;
    if (glyphOnly(main)) out.captions.push(m.id + ' | ' + (main.textContent || '').trim().slice(0, 50) + ' | ' + main.querySelector('i').className);
  });
  document.querySelectorAll('.taskbar-window-item').forEach((t) => {
    if (glyphOnly(t)) out.taskbar.push((t.dataset.modalId || '') + ' | ' + (t.textContent || '').trim().slice(0, 50));
  });
  return JSON.stringify(out);
})()`;

const OPEN = `(async () => {
  const items = typeof flattenToolsSubmenuItems === 'function' ? flattenToolsSubmenuItems(buildToolsSubmenuItems()) : [];
  let n = 0;
  for (const it of items) {
    if (!it || typeof it.action !== 'function') continue;
    try { await it.action(); n++; } catch (_) { /* skip */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return n;
})()`;

function get(path) {
  return new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(JSON.parse(b))); }).on('error', reject));
}

(async () => {
  const t = (await get('/json/list')).find((x) => x.id === target);
  if (!t) { console.error('no such tab', target); process.exit(2); }
  const ws = new WebSocket(t.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'), { perMessageDeflate: false });
  await new Promise((r) => ws.on('open', r));
  let seq = 0; const pend = new Map();
  ws.on('message', (m) => { const x = JSON.parse(m); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } });
  const ev = (expression) => new Promise((r) => { const i = ++seq; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
  if (args.includes('--open')) console.log('opened', (await ev(OPEN)).result.result.value);
  const r = JSON.parse((await ev(AUDIT)).result.result.value);
  ws.close();
  r.captions.forEach((c) => console.log('caption glyph only:', c));
  r.taskbar.forEach((c) => console.log('taskbar glyph only:', c));
  console.log(`window icons: ${r.captions.length + r.taskbar.length ? 'FAIL' : 'ok'} (${r.captions.length} captions, ${r.taskbar.length} taskbar buttons with a glyph only)`);
  process.exit(r.captions.length + r.taskbar.length ? 1 : 0);
})();
