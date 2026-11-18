// node scripts/test-status-fit.js: CafeTasks.lib.statusFit with the status-order.js table, on the Fold cover's numbers
const assert = require('assert');
global.CafeTasks = { lib: {} };
require('../public/scripts/tasks/status-order.js');
require('../public/scripts/tasks/status-fit.js');
const { fit } = global.CafeTasks.lib.statusFit;
const U = 3.375; // device px per WM unit on the Fold cover (wm-px 1.5 x dpr 2.25)
const bar = { width: 320 * U, iconsRight: 320 * U - 27.5 * U, gap: 5 * U, titleX: 30 * U, titleMin: 60 * 1.5 * 2.25, hole: { x: 148.1 * U, w: 23.8 * U }, xReserve: 22 * U };
const ic = (role, extra) => Object.assign({ role, w: 16 * U }, extra || {});
const sys = [ic('data'), ic('signal'), ic('volume'), ic('battery')];
const appBar = Object.assign({}, bar, { xReserve: 0 });

// Today (no X): the X's place goes to the icons first
let r = fit({ icons: [ic('carkey'), ic('sms'), ic('received')].concat(sys), notify: { w: 16 * U, notes: false }, bar, prefs: {}, screen: {} });
console.log('Today:', JSON.stringify(r));
assert.ok(!r.left.length, 'nothing left of the camera on the cover');

// over an app, no short-lived icon: received and car fold before the volume steps aside
r = fit({ icons: [ic('carkey'), ic('mail'), ic('received')].concat(sys), notify: { w: 16 * U, notes: false }, bar: appBar, prefs: {}, screen: {} });
console.log('app bar, car/mail/received:', JSON.stringify(r));
assert.ok(!r.left.length, 'never crosses the camera');
assert.ok(!r.shed.includes('volume'), 'the volume stays for car / mail / received');
assert.deepStrictEqual(r.folded.slice(0, 2), ['received', 'carkey'], 'received folds first, then the car');

// a short-lived icon (sms) with car and received: car and received fold, then the volume steps aside for sms
r = fit({ icons: [ic('carkey'), ic('sms'), ic('prints'), ic('received')].concat(sys), notify: { w: 16 * U, notes: false }, bar: appBar, prefs: {}, screen: {} });
console.log('app bar, car/sms/prints/received:', JSON.stringify(r));
assert.ok(!r.left.length);
assert.ok(r.folded.includes('received') && r.folded.includes('carkey'), 'the lesser ones fold first');
assert.ok(r.shed.includes('volume'), 'the volume steps aside for a short-lived icon');
assert.ok(r.shown.includes('prints') && r.folded.includes('sms'), 'five fit right of the camera: prints outranks sms');

// Sound Icon = Never hide keeps the volume; the short-lived ones fold instead
r = fit({ icons: [ic('carkey'), ic('sms'), ic('prints'), ic('director'), ic('received')].concat(sys), notify: { w: 16 * U, notes: false }, bar: appBar, prefs: { sound: 'never' }, screen: {} });
assert.ok(!r.shed.includes('volume'), 'never hide keeps the volume');
assert.ok(!r.left.length);

// continuity and nightshade never fold
r = fit({ icons: [ic('carkey'), ic('sms'), ic('mail'), ic('chat'), ic('continuity'), ic('nightshade'), ic('received')].concat(sys), notify: { w: 16 * U, notes: true }, bar: appBar, prefs: {}, screen: {} });
console.log('app bar, crowded:', JSON.stringify(r));
assert.ok(!r.folded.includes('continuity') && !r.folded.includes('nightshade'));

// unfolded: nothing steps aside or folds, overflow crosses
r = fit({ icons: [ic('carkey'), ic('sms'), ic('mail'), ic('chat'), ic('wxalert'), ic('rain'), ic('received')].concat(sys), notify: null, bar: appBar, prefs: {}, screen: { unfolded: true } });
assert.ok(!r.folded.length && !r.shed.length && r.left.length > 0, 'unfolded carries on left of the camera');
console.log('status fit: all checks passed');
