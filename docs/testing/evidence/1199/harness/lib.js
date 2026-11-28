const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'sandboxes.json'), 'utf8'));
async function attach(which) {
  const s = cfg[which];
  if (!s) throw new Error('unknown sandbox ' + which);
  const t = await (await fetch(`http://127.0.0.1:${s.cdpPort}/json`)).json();
  const pg = t.find((x) => x.type === 'page');
  if (!pg) throw new Error('no page target');
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  let i = 0;
  const waiting = new Map();
  const events = [];
  ws.on('message', (x) => { const d = JSON.parse(x); if (d.id && waiting.has(d.id)) { const w = waiting.get(d.id); waiting.delete(d.id); d.error ? w.j(new Error(JSON.stringify(d.error))) : w.r(d.result); } else events.push(d); });
  const send = (method, params = {}) => new Promise((r, j) => { const id = ++i; waiting.set(id, { r, j }); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const shot = async (out) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };
  // a tap or click at CSS pixel x,y: with the holder's touch emulation on, a phone page gets a real touch
  const tap = async (x, y) => {
    if (which === 'phone') {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await new Promise((r) => setTimeout(r, 60));
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
  };
  // tap the centre of the first visible element matching a selector (optionally one whose text matches a regex source)
  const tapSel = async (sel, textRe) => {
    const r = await evalJs(`(() => { const re = ${textRe ? 'new RegExp(' + JSON.stringify(textRe) + ')' : 'null'}; const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length && !x.disabled && (!re || re.test(x.textContent.trim()))); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, t: e.textContent.trim().slice(0, 30) }; })()`);
    if (!r) throw new Error('nothing to tap: ' + sel + (textRe ? ' /' + textRe + '/' : ''));
    await tap(r.x, r.y);
    return r;
  };
  const typeText = async (text) => { await send('Input.insertText', { text }); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return { ws, send, evalJs, shot, tap, tapSel, typeText, sleep, close: () => ws.close(), cfg: s };
}
module.exports = { attach, cfg };
