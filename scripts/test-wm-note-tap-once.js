// One tap, one answer for the notification control (Yukimi, Nov 27 2026, on the Fold: the left soft key set
// to Notifications and the "..." in the status bar both flickered the box/tray open-closed).
//
// The notification answer is a toggle, so it must run once per physical press. Two page-side rules hold that:
//   - noteIconTap drops a second answer within NOTE_TAP_GUARD_MS (the app's bar and the page can both hear one
//     press; two toggles cancel out), except while the app is asking for a popup's layout to draw (barsOpening)
//   - a soft key whose action IS the notification control is marked notify: true, so the "tap elsewhere closes
//     the tray" rule spares it (closing there first made one press close and reopen the tray)
// Source-level, as the other wmShell tests are: the shell needs the whole phone page to run.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/wmShell.js'), 'utf8');
let pass = 0;
const test = (name, fn) => { fn(); pass += 1; console.log(`ok ${pass} - ${name}`); };

const fnBody = (name) => {
    const at = src.indexOf(`\n    function ${name}(`);
    assert.ok(at !== -1, `${name} exists`);
    const end = src.indexOf('\n    }\n', at);
    assert.ok(end !== -1, `${name} ends`);
    return src.slice(at, end);
};

test('noteIconTap guards a repeated answer, with the app\'s layout copy excepted', () => {
    const body = fnBody('noteIconTap');
    assert.ok(/NOTE_TAP_GUARD_MS/.test(body), 'the guard window is used');
    assert.ok(/if \(!barsOpening && now - noteTapAt < NOTE_TAP_GUARD_MS\) return;/.test(body),
        'a second answer inside the window is dropped; barsOpening (the app copying the popup) is not');
    assert.ok(/noteTapAt = now;/.test(body), 'the window is stamped');
    assert.ok(/let noteTapAt = -Infinity;/.test(src), 'the stamp starts unset');
    assert.ok(/const NOTE_TAP_GUARD_MS = 150;/.test(src), '150 ms: no hand taps twice that fast');
});

test('the Today Notifications soft key is marked notify: true', () => {
    const body = fnBody('todaySoftKeyFor');
    assert.ok(/if \(v === 'notifications'\) \{/.test(body), 'the Notifications action is there');
    assert.ok(/notify: true,/.test(body), 'and the key says it is the notification control');
});

test('the home screen\'s notification key is marked too', () => {
    assert.ok(/keys\.left = \{ label: 'Notification', badge: notes\.length, notify: true, action: \(\) => noteIconTap\(\) \};/.test(src),
        'the badge key on Today carries notify: true');
});

test('the tap-elsewhere rule spares the notification key', () => {
    assert.ok(/const noteKeyTap = \(\(\) => \{/.test(src), 'the key is worked out for the tap');
    assert.ok(/return !!\(key && key\.notify\);/.test(src), 'the flag is what counts');
    assert.ok(/if \(noteTrayOpen && !noteKeyTap && !\(e\.target\.closest && e\.target\.closest\('#wmShell \.wm-notify-tray, #wmShell \[data-role="notify"\]'\)\)\)/.test(src),
        'the tray is not closed under a tap on the notification key');
});

console.log(`\ntest-wm-note-tap-once: ${pass} ok`);
