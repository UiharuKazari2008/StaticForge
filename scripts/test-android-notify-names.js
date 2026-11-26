'use strict';
// Yozora #1097: a phone notification's app is never shown by its package name.
const assert = require('assert');
const R = require('../public/scripts/comp/androidAppName.js');

const inst = { 'org.example.foo': 'Foo Reader', 'com.google.android.gm': 'Gmail (work)' };
const cases = [
    ['sent label = package', ['com.google.android.gm', 'com.google.android.gm', {}], 'Gmail'],
    ['sent label looks like another package', ['com.discord', 'com.something.else', {}], 'Discord'],
    ['real sent label wins', ['com.google.android.gm', 'Mail', inst], 'Mail'],
    ['no label + installed label', ['org.example.foo', '', inst], 'Foo Reader'],
    ['installed label is the package: ignored', ['org.example.foo', '', { 'org.example.foo': 'org.example.foo' }], 'Foo'],
    ['no label + known table', ['com.samsung.android.email.provider', undefined, {}], 'Samsung Email'],
    ['unknown package', ['io.github.some_cool_app.debug', null, {}], 'Some Cool App'],
    ['unknown camelCase', ['net.vendor.MyNotes', '', {}], 'My Notes'],
    ['single segment', ['termux', '', {}], 'Termux'],
    ['empty package', ['', '', {}], 'Notification']
];
let fails = 0;
for (const [name, [pkg, sent, map], want] of cases) {
    const got = R.resolve(pkg, sent, map);
    try {
        assert.strictEqual(got, want, `${name}: ${got} != ${want}`);
        assert.ok(got !== pkg || !pkg, `${name}: returned the package`);
        assert.ok(!/^[a-z][\w-]*(\.[\w-]+)+$/i.test(got), `${name}: looks like a package`);
        console.log(`ok   ${name} -> ${got}`);
    } catch (e) { fails++; console.log(`FAIL ${e.message}`); }
}
// no known-table or humane output may be a package
for (const pkg of Object.keys(R.KNOWN).concat(['com.a.b', 'jp.net.x.y_z'])) {
    const got = R.resolve(pkg, pkg, {});
    if (R.isPackageName(got, pkg) && got.includes('.')) { fails++; console.log(`FAIL ${pkg} -> ${got}`); }
}
assert.strictEqual(R.iconSrc('com.x.y'), '/notification-icon/com.x.y');
assert.ok(!/^data:/.test(R.genericIcon(16)));
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('all passed');
