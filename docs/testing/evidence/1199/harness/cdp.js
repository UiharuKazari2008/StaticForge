// usage: NODE_PATH=$SP/deps/node_modules node cdp.js <desktop|phone> <command> [args]
// commands: wake (desktop: one mouse move so a waiting balloon's timer runs) | eval <js> | shot <out.png> | clientid | notice | display-state (phone) | softkey <left|right> (phone)
//           other-notifications-display <on|off> (phone)
const { attach } = require('./lib');

const NOTICE_DESKTOP = `(() => {
  const pops = [...document.querySelectorAll('.popover.tray-balloon')].filter((p) => p.classList.contains('show') && p.getClientRects().length);
  const p = pops.find((x) => /Remote Access/.test((x.querySelector('.popover-header') || {}).textContent || '')) || null;
  if (!p) return { uiShell: window.uiShell, visible: false, title: null, text: null };
  const h = p.querySelector('.popover-header'), b = p.querySelector('.popover-body');
  return { uiShell: window.uiShell, visible: true, title: h ? h.textContent.trim() : null, text: b ? b.textContent : null };
})()`;

const NOTICE_PHONE = `(() => {
  const held = window.showAgentSessionTrayNotice && window.showAgentSessionTrayNotice.phoneNote;
  const heldEl = held ? document.getElementById(held.id) : null;
  const noteUp = !!(heldEl && heldEl.isConnected && !heldEl.classList.contains('removing'));
  const bub = document.querySelector('.wm-notify');
  const bubbleShown = !!(bub && !bub.hidden && bub.getClientRects().length);
  const name = bub && bub.querySelector('.wm-notify-name');
  const msg = bub && bub.querySelector('.wm-notify-body .toast-message');
  const key = (s) => { const k = document.querySelector('.wm-softkey[data-side="' + s + '"]'); return k ? k.textContent : null; };
  return { uiShell: window.uiShell, noteUp, bubbleShown, title: bubbleShown && name ? name.textContent : null, text: bubbleShown && msg ? msg.textContent : null,
    toastTitle: heldEl ? ((heldEl.querySelector('.toast-title') || {}).textContent || null) : null,
    toastText: heldEl ? ((heldEl.querySelector('.toast-message') || {}).textContent || null) : null,
    softKeys: { left: key('left'), right: key('right') } };
})()`;

const DISPLAY_STATE = `(() => { const s = window.wmShell && window.wmShell.sounds; const p = s && s.eventPrefs('notification'); return { display: p ? !!p.display : null }; })()`;

async function main() {
  const [which, cmd, ...rest] = process.argv.slice(2);
  if (!which || !cmd) throw new Error('usage: cdp.js <desktop|phone> <eval|shot|clientid|notice|display-state|softkey|other-notifications-display> ...');
  const c = await attach(which);
  let out;
  if (cmd === 'eval') out = await c.evalJs(rest.join(' '));
  else if (cmd === 'shot') { await c.shot(rest[0]); out = { file: rest[0] }; }
  else if (cmd === 'clientid') out = await c.evalJs(`({ clientId: (typeof WebSocketClient !== 'undefined' && WebSocketClient.readStoredAgentClientId) ? WebSocketClient.readStoredAgentClientId() : null, uiShell: window.uiShell, wsConnected: !!(window.wsClient && window.wsClient.isConnected && window.wsClient.isConnected()) })`);
  else if (cmd === 'notice') out = await c.evalJs(which === 'phone' ? NOTICE_PHONE : NOTICE_DESKTOP);
  else if (cmd === 'wake') { // one mouse move on an empty spot: the tray balloon's 8 s only counts while there was input in the last 30 s (popoverManager presence)
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 8 }); out = { moved: true };
  } else if (cmd === 'display-state') { if (which !== 'phone') throw new Error('phone only'); out = await c.evalJs(DISPLAY_STATE); }
  else if (cmd === 'softkey') {
    if (which !== 'phone' || !['left', 'right'].includes(rest[0])) throw new Error('usage: phone softkey <left|right>');
    const r = await c.evalJs(`(() => { const k = document.querySelector('.wm-softkey[data-side="${rest[0]}"]'); if (!k) return null; const r = k.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: k.textContent, disabled: k.disabled }; })()`);
    if (!r) throw new Error('no soft key');
    if (r.disabled) throw new Error('soft key disabled: ' + r.label);
    await c.tap(r.x, r.y);
    out = { pressed: rest[0], label: r.label, at: { x: r.x, y: r.y } };
  } else if (cmd === 'other-notifications-display') {
    out = await require('./settingsFlow').run(c, rest[0]);
  } else throw new Error('unknown command ' + cmd);
  console.log(JSON.stringify(out));
  c.close();
  process.exit(0);
}
main().catch((e) => { console.error(JSON.stringify({ error: e.message })); process.exit(1); });
