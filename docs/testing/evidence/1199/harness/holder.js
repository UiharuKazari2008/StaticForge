// Keeps one CDP session open on a sandbox page so its emulation (device metrics, touch) and the
// ignore-certificate-errors switch stay on between cdp.js runs (CDP emulation ends when its session detaches).
// usage: node holder.js <desktop|phone> <cdpPort>
const WebSocket = require('ws');
const [kind, port] = [process.argv[2], process.argv[3]];
(async () => {
  const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const pg = t.find((x) => x.type === 'page');
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let i = 0;
  const send = (m, p) => new Promise((r) => { const id = ++i; const h = (x) => { const d = JSON.parse(x); if (d.id === id) { ws.off('message', h); r(d); } }; ws.on('message', h); ws.send(JSON.stringify({ id, method: m, params: p })); });
  console.log(JSON.stringify(await send('Security.setIgnoreCertificateErrors', { ignore: true })));
  if (kind === 'phone') {
    console.log(JSON.stringify(await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true })));
    console.log(JSON.stringify(await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })));
    console.log(JSON.stringify(await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' })));
  } else {
    console.log(JSON.stringify(await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })));
  }
  console.log('holder ready', kind);
  ws.on('close', () => process.exit(0));
  setInterval(() => {}, 1 << 30);
})();
