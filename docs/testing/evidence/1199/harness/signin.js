// usage: ACC_PIN=<pin> node signin.js <desktop|phone>   (the PIN comes from the environment only; nothing is stored)
const { attach } = require('./lib');
(async () => {
  const c = await attach(process.argv[2]);
  const pin = process.env.ACC_PIN || '';
  if (!/^\d{6}$/.test(pin)) throw new Error('ACC_PIN missing');
  await c.send('Page.enable');
  // the logon page can come up with its PIN pad minimised (a tap on the dots toggles it)
  if (await c.evalJs(`!!document.querySelector('.minimize .pin-pad, .login-dialog.minimize, [aria-expanded="false"]')`)) { await c.tapSel('[aria-expanded]'); await c.sleep(900); }
  for (const d of pin) {
    const p = JSON.parse(await c.evalJs(`(()=>{const b=document.querySelector('.pin-button[data-number="${d}"]');if(!b)return 'null';const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`));
    if (!p) throw new Error('no pin pad');
    await c.tap(p.x, p.y);
    await c.sleep(150);
  }
  for (let i = 0; i < 40 && (await c.evalJs('location.pathname')) === '/'; i++) await c.sleep(1000);
  console.log(await c.evalJs('location.href + " | " + document.title'));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
