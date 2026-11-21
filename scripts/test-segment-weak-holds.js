#!/usr/bin/env node --expose-gc
/**
 * melatonSegments.js remembers what an app made (observers, the windows it appended, the menus it attached) so an
 * unload can undo it. It used to hold them strongly: every observer and closed window an app ever made stayed in
 * memory with its closures and DOM until the app unloaded (Fold DeX heap snapshot, Nov 21 2026: Security Center's
 * old keychain rows via contextMenu undos, closed Grimoire tool windows via r.observers). WeakBag / elementUndo hold
 * them weakly: a member the app dropped is collected, a live one is still reached by the unload.
 * Run: node --expose-gc scripts/test-segment-weak-holds.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

if (typeof global.gc !== 'function') {
    execFileSync(process.execPath, ['--expose-gc', __filename], { stdio: 'inherit' });
    process.exit(0);
}
const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/melatonSegments.js'), 'utf8');
const cls = src.match(/class WeakBag \{[\s\S]*?\n {4}\}\n/);
const fn = src.match(/function elementUndo\(el, run\) \{[\s\S]*?function strongElementUndo\(el, run\) \{[\s\S]*?\n {4}\}\n/);
assert.ok(cls && fn, 'WeakBag and elementUndo are in melatonSegments.js');
const { WeakBag, elementUndo } = new Function(`${cls[0]}\n${fn[0]}\nreturn { WeakBag, elementUndo };`)();
assert.ok(/nodes: new WeakBag\(\)/.test(src) && /observers: new WeakBag\(\)/.test(src), 'a segment holds its nodes and observers in WeakBags');
assert.ok(/attachClickMenuToElement[\s\S]{0,120}elementUndo\(/.test(src) && /attachToElement[\s\S]{0,120}elementUndo\(/.test(src), 'context menu undos hold their element weakly');

const settle = async () => { for (let i = 0; i < 4; i++) { await new Promise((r) => setImmediate(r)); global.gc(); } };

(async () => {
    const bag = new WeakBag();
    let dropped = { name: 'closed window' };
    const kept = { name: 'open window' };
    bag.add(dropped).add(kept).add(kept);
    assert.strictEqual(bag.size, 2, 'one entry per member');
    dropped = null;
    await settle();
    assert.strictEqual(bag.size, 1, 'a member nothing else holds is collected');
    const seen = [];
    bag.forEach((v) => seen.push(v.name));
    assert.deepStrictEqual(seen, ['open window'], 'the unload still reaches the live one');
    assert.deepStrictEqual([...new Set(bag)].map((v) => v.name), ['open window'], 'iterable (unload copies it into a Set)');

    const detached = [];
    let el = { id: 'row' };
    const undo = elementUndo(el, (e) => detached.push(e.id));
    undo();
    assert.deepStrictEqual(detached, ['row'], 'undo runs on a live element');
    el = null;
    await settle();
    assert.strictEqual(undo.elementRef.deref(), undefined, 'the undo does not keep its element alive');
    undo();
    assert.deepStrictEqual(detached, ['row'], 'a collected element has nothing to undo');
    console.log('test-segment-weak-holds: ok');
})().catch((e) => { console.error(e); process.exit(1); });
