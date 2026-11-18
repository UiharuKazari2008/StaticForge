// node scripts/test-status-fit.js: CafeTasks.lib.statusFit against the page's rules on the Fold cover's numbers
const assert = require('assert');
global.CafeTasks = { lib: {} };
require('../public/scripts/tasks/status-fit.js');
const { fit } = global.CafeTasks.lib.statusFit;
const U = 3.375; // device px per WM unit on the Fold cover (wm-px 1.5 x dpr 2.25)
const bar = { width: 320 * U, iconsRight: 320 * U - 27.5 * U, gap: 5 * U, titleX: 30 * U, titleMin: 60 * 1.5 * 2.25, hole: { x: 148.1 * U, w: 23.8 * U }, xReserve: 22 * U };
const ic = (role, app, extra) => Object.assign({ role, w: 16 * U, app }, extra || {});
const icons = [ic('carkey', true, { seenAt: 1 }), ic('received', true, { seenAt: 2 }), ic('sms', true, { seenAt: 3 }), ic('prints', true, { seenAt: 4, ongoing: true }),
    ic('data'), ic('signal'), ic('volume'), ic('battery')];
let r = fit({ icons, notify: { w: 16 * U, notes: true }, bar, prefs: {}, screen: {} });
console.log('cover, Today, notices waiting:', JSON.stringify(r));
assert.ok(!r.left.length, 'nothing left of the camera on the cover');
assert.ok(r.reserveUsed, 'the X place is given to the icons first');
assert.ok(r.groupShown && r.shown.length - 1 >= 6, 'six icons and the group');
// with the X shown (over an app): no reserve to give back
r = fit({ icons, notify: { w: 16 * U, notes: true }, bar: Object.assign({}, bar, { xReserve: 0 }), prefs: {}, screen: {} });
console.log('cover, over an app:', JSON.stringify(r));
assert.ok(!r.left.length && r.shed.includes('volume'), 'the volume steps aside before anything crosses the camera');
// Sound icon = Never hide keeps the volume
r = fit({ icons, notify: { w: 16 * U, notes: true }, bar: Object.assign({}, bar, { xReserve: 0 }), prefs: { sound: 'never' }, screen: {} });
assert.ok(!r.shed.includes('volume'), 'never hide keeps the volume');
// unfolded: nothing steps aside or folds, overflow crosses
r = fit({ icons: icons.concat([ic('wxalert', true, { seenAt: 5 }), ic('rain', true, { seenAt: 6 })]), notify: null, bar: Object.assign({}, bar, { xReserve: 0 }), prefs: {}, screen: { unfolded: true } });
assert.ok(!r.folded.length && !r.shed.length && r.left.length > 0, 'unfolded carries on left of the camera');
console.log('status fit: all checks passed');
