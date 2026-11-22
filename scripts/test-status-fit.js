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
let r = fit({ icons: [ic('carkey'), ic('sms'), ic('received')].concat(sys), notify: { w: 16 * U, notes: false }, bar, prefs: {}, screen: { noCross: true } });
console.log('Today:', JSON.stringify(r));
assert.ok(!r.left.length, 'nothing left of the camera on the cover');

// over an app, no short-lived icon: received and car fold before the volume steps aside
r = fit({ icons: [ic('carkey'), ic('mail'), ic('received')].concat(sys), notify: { w: 16 * U, notes: false }, bar: appBar, prefs: {}, screen: { noCross: true } });
console.log('app bar, car/mail/received:', JSON.stringify(r));
assert.ok(!r.left.length, 'never crosses the camera');
assert.ok(!r.shed.includes('volume'), 'the volume stays for car / mail / received');
assert.deepStrictEqual(r.folded.slice(0, 2), ['received', 'carkey'], 'received folds first, then the car');

// a short-lived icon (sms) with car and received: car and received fold, then the volume steps aside for sms
r = fit({ icons: [ic('carkey'), ic('sms'), ic('prints'), ic('received')].concat(sys), notify: { w: 16 * U, notes: false }, bar: appBar, prefs: {}, screen: { noCross: true } });
console.log('app bar, car/sms/prints/received:', JSON.stringify(r));
assert.ok(!r.left.length);
assert.ok(r.folded.includes('received') && r.folded.includes('carkey'), 'the lesser ones fold first');
assert.ok(r.shed.includes('volume'), 'the volume steps aside for a short-lived icon');
assert.ok(r.shown.includes('prints') && r.folded.includes('sms'), 'five fit right of the camera: prints outranks sms');

// Sound Icon = Never hide keeps the volume; the short-lived ones fold instead
r = fit({ icons: [ic('carkey'), ic('sms'), ic('prints'), ic('director'), ic('received')].concat(sys), notify: { w: 16 * U, notes: false }, bar: appBar, prefs: { sound: 'never' }, screen: { noCross: true } });
assert.ok(!r.shed.includes('volume'), 'never hide keeps the volume');
assert.ok(!r.left.length);

// continuity and nightshade never fold
r = fit({ icons: [ic('carkey'), ic('sms'), ic('mail'), ic('chat'), ic('continuity'), ic('nightshade'), ic('received')].concat(sys), notify: { w: 16 * U, notes: true }, bar: appBar, prefs: {}, screen: { noCross: true } });
console.log('app bar, crowded:', JSON.stringify(r));
assert.ok(!r.folded.includes('continuity') && !r.folded.includes('nightshade'));

// #1025 (Yukimi, Nov 22): with the camera in the bar the icons carry on left of it and fold only when the bar is full
r = fit({ icons: [ic('carkey'), ic('mail'), ic('received')].concat(sys), notify: { w: 16 * U, notes: false }, bar: appBar, prefs: {}, screen: {} });
console.log('app bar crossing, car/mail/received:', JSON.stringify(r));
assert.ok(!r.folded.length && !r.shed.length, 'room left of the camera: nothing folds or steps aside');
assert.deepStrictEqual(r.left, ['carkey', 'mail'], 'the first icons carry on left of the camera');
r = fit({ icons: [ic('carkey'), ic('sms'), ic('mail'), ic('chat'), ic('continuity'), ic('nightshade'), ic('received'), ic('wxalert'), ic('rain'), ic('prints')].concat(sys), notify: { w: 16 * U, notes: false }, bar: appBar, prefs: {}, screen: {} });
console.log('app bar crossing, full:', JSON.stringify(r));
assert.ok(r.folded.length > 0 && r.groupShown, 'a truly full bar folds into the group');
assert.ok(r.left.length > 0, 'and still uses the room left of the camera');
// Today with the X's kept place: the room right of the camera is used before crossing
r = fit({ icons: [ic('carkey'), ic('sms'), ic('received')].concat(sys), notify: { w: 16 * U, notes: false }, bar, prefs: {}, screen: {} });
assert.ok(r.reserveUsed && !r.left.length, 'the X place first, then the camera');

// #1053 (Fold cover, Nov 22): the shown row as the page lays it out - the "..." first when the group shows, right-aligned,
// the icons the fit put left of the camera from the camera's left edge - never on the camera and never under the title's
// floor. The row is checked from the fit's answer, so a "..." the fit did not count (the server's waiting notices) shows
// up here as an icon on the lens
const { place } = global.CafeTasks.lib.statusFit;
function rowClear(label, input, res) {
    const widths = Object.fromEntries(input.icons.map((i) => [i.role, i.w]));
    const roles = res.shown; // (the "..." is in it, first, when the group shows)
    const items = roles.map((role) => ({ role, w: role === 'notify' ? input.notify.w : widths[role] }));
    const b = res.reserveUsed ? Object.assign({}, input.bar, { iconsRight: input.bar.iconsRight + (input.bar.xReserve || 0) }) : input.bar;
    const placed = place(items, b, false);
    const h = input.bar.hole;
    for (const p of placed) {
        const w = widths[p.role] || input.notify.w;
        assert.ok(!(h && p.x < h.x + h.w && p.x + w > h.x), `${label}: ${p.role} at ${p.x.toFixed(1)}+${w} sits on the camera ${h.x}..${(h.x + h.w).toFixed(1)}`);
        assert.ok(input.screen.unfolded || p.x >= input.bar.titleX + input.bar.titleMin - 0.01, `${label}: ${p.role} at ${p.x.toFixed(1)} under the title's floor`);
        assert.ok(p.x + w <= b.iconsRight + 0.01, `${label}: ${p.role} past the row's end`);
    }
    assert.deepStrictEqual(placed.filter((p) => p.left).map((p) => p.role).filter((r) => r !== 'notify'), res.left.filter((r) => r !== 'notify'), `${label}: left of the camera as the fit said`);
    return placed;
}
// the cover as the page measured it on Yukimi's Fold7 (statusFitLast, Nov 22 07:38, CSS px at dpr 2.25; Android's cutout
// Rect(510, 0 - 570, 102) device px = 226.67..253.33 CSS, less / plus 3 units of 1.5 px): Today, car, rain, mail, sms,
// Continuity and the system icons
const cover = { width: 480, iconsRight: 438.75, gap: 7.5, titleX: 37.5, titleMin: 90, hole: { x: 222.16667, w: 35.666666 }, xReserve: 24 };
const c24 = (role, extra) => Object.assign({ role, w: 24 }, extra || {});
const coverIcons = ['carkey', 'rain', 'mail', 'sms', 'continuity', 'data', 'signal', 'volume', 'battery'].map((r) => c24(r));
for (const notes of [false, true]) {
    const input = { icons: coverIcons, notify: { w: 24, notes }, bar: cover, prefs: {}, screen: {} };
    r = fit(input);
    console.log(`Fold cover Today, notices waiting ${notes}:`, JSON.stringify(r));
    rowClear(`cover notes=${notes}`, input, r);
}
// the "..." waiting (the server's notices): it takes a place left of the camera, so one icon folds into it - the page
// that did not tell the fit about those notices laid out "...", car, rain, mail there, past the title's floor, and the
// title's min-width pushed the camera's gap (and mail) onto the lens
r = fit({ icons: coverIcons, notify: { w: 24, notes: true }, bar: cover, prefs: {}, screen: {} });
assert.ok(r.groupShown && r.left.filter((x) => x !== 'notify').length < 3 && r.folded.length === 1, 'with the "..." up one icon folds into it');
const blind = rowClear('cover (fit told no notices)', { icons: coverIcons, notify: { w: 24, notes: false }, bar: cover, prefs: {}, screen: {} }, fit({ icons: coverIcons, notify: { w: 24, notes: false }, bar: cover, prefs: {}, screen: {} }));
assert.ok(blind[0].x - 24 - 7.5 < cover.titleX + cover.titleMin, 'the old input: a "..." added after the fit has no room left of the camera');
// the same over an Android program (an X: no kept place) and with "do not cross"
for (const noCross of [false, true]) {
    for (const notes of [false, true]) {
        const input = { icons: coverIcons, notify: { w: 24, notes }, bar: Object.assign({}, cover, { xReserve: 0, iconsRight: 414.75 }), prefs: {}, screen: { noCross } };
        rowClear(`cover over a program notes=${notes} noCross=${noCross}`, input, fit(input));
    }
}
// the cover's kit in device px (the native copy's numbers: the bar 1080 px, the camera's box from Android's cutout
// 510..570 with the 3-unit pad, 54 px icons)
const kitCover = { width: 1080, iconsRight: 987, gap: 16.88, titleX: 84, titleMin: 203, hole: { x: 500, w: 80 }, xReserve: 0 };
const k54 = (role) => ({ role, w: 54 });
for (const notes of [false, true]) {
    const input = { icons: ['carkey', 'rain', 'mail', 'sms', 'continuity', 'data', 'signal', 'volume', 'battery'].map(k54), notify: { w: 54, notes }, bar: kitCover, prefs: {}, screen: {} };
    rowClear(`cover kit notes=${notes}`, input, fit(input));
}
// the inner screen (1968 px at 2.25: 874.67 CSS; the camera in the right panel's top, ~1440..1500 device px - an
// approximation, the inner cutout is not readable folded): nothing folds, the overflow carries on left of the camera
const inner = { width: 874.67, iconsRight: 833.4, gap: 7.5, titleX: 37.5, titleMin: 90, hole: { x: 1440 / 2.25 - 4.5, w: 60 / 2.25 + 9 }, xReserve: 24 };
const many = ['carkey', 'rain', 'mail', 'sms', 'chat', 'wxalert', 'received', 'prints', 'director', 'continuity', 'nightshade', 'data', 'signal', 'volume', 'battery'];
for (const n of [4, 9, 15]) {
    for (const notes of [false, true]) {
        const input = { icons: many.slice(many.length - n).map((r) => c24(r)), notify: { w: 24, notes }, bar: inner, prefs: {}, screen: { unfolded: true } };
        r = fit(input);
        rowClear(`inner ${n} icons notes=${notes}`, input, r);
        assert.ok(!r.folded.length && !r.shed.length, 'the inner screen folds nothing');
    }
}

// unfolded: nothing steps aside or folds, overflow crosses
r = fit({ icons: [ic('carkey'), ic('sms'), ic('mail'), ic('chat'), ic('wxalert'), ic('rain'), ic('received')].concat(sys), notify: null, bar: appBar, prefs: {}, screen: { unfolded: true } });
assert.ok(!r.folded.length && !r.shed.length && r.left.length > 0, 'unfolded carries on left of the camera');
console.log('status fit: all checks passed');
