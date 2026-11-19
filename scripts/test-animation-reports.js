#!/usr/bin/env node
// Animation watchdog reports in the fault store (#930): the page's watchdog
// (public/scripts/utils/offscreenAnimationPause.js) posts kind 'animation' through the fault capture;
// the store keeps the finding, folds the same offender from different clients into one report and
// keeps the kind apart from real errors. Run: node scripts/test-animation-reports.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, KINDS } = require('../modules/programFaultReports.js');

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anim-reports-'));
    const store = createStore({ dir });
    const changes = [];
    store.events.on('change', (c) => changes.push(c));
    assert.ok(KINDS.has('animation'));

    const body = (over = {}) => Object.assign({
        occurrenceId: 'occ-' + Math.random().toString(36).slice(2),
        surface: 'desktop',
        kind: 'animation',
        program: { key: 'gadget:clock', name: 'Sidebar gadget: clock' },
        errorName: 'AnimationWatchdog',
        message: 'Animation "vsb-clock-turn" runs without end in view: img.vsb-clock-hand',
        stack: 'AnimationWatchdog: Animation "vsb-clock-turn" runs without end in view: img.vsb-clock-hand\n    at keyframes vsb-clock-turn (/css/vista-sidebar.css:1:1)',
        source: 'animationWatchdog',
        animation: {
            type: 'endless', name: 'vsb-clock-turn', kind: 'css', target: 'img.vsb-clock-hand', window: 'div.vsb-gadget',
            reason: '', properties: 'transform', iterations: 'infinite', durationMs: 60000, runMs: 380235, targets: 3,
            paused: false, source: '/css/vista-sidebar.css', shell: 'desktop', client: 'dreamos', extra: 'dropped'
        },
        client: { userAgent: 'Mozilla/5.0 DreamOS/0.2.6', shell: 'desktop' }
    }, over);

    const first = await store.upsert(body());
    assert.strictEqual(first.created, true);
    assert.strictEqual(first.report.kind, 'animation');
    const a = first.report.latest.animation;
    assert.deepStrictEqual([a.type, a.name, a.target, a.iterations, a.runMs, a.targets, a.paused, a.source, a.shell, a.client],
        ['endless', 'vsb-clock-turn', 'img.vsb-clock-hand', 'infinite', 380235, 3, false, '/css/vista-sidebar.css', 'desktop', 'dreamos']);
    assert.strictEqual(a.extra, undefined, 'unknown fields are not stored');

    // the same offender from another client (another run time): one report, a second occurrence
    const b2 = body({ client: { userAgent: 'Mozilla/5.0 Android wv', shell: 'mobile' } });
    b2.animation = Object.assign({}, b2.animation, { runMs: 120444, client: 'android-app' });
    const second = await store.upsert(b2);
    assert.strictEqual(second.id, first.id);
    assert.strictEqual(second.count, 2);
    assert.strictEqual(second.report.latest.animation.client, 'android-app');

    // a hidden finding for the same animation is its own report (the message says why)
    const hidden = await store.upsert(body({
        message: 'Animation "vsb-clock-turn" runs on a target that is not seen (under opacity 0): img.vsb-clock-hand',
        animation: { type: 'hidden', name: 'vsb-clock-turn', reason: 'under opacity 0', paused: true }
    }));
    assert.notStrictEqual(hidden.id, first.id);
    assert.strictEqual(hidden.report.latest.animation.paused, true);

    // the finding is kept only for the animation kind; a report keeps its most serious kind
    const err = await store.upsert({ occurrenceId: 'e1', kind: 'uncaught', program: { key: 'x' }, errorName: 'TypeError', message: 'boom', animation: { name: 'nope' } });
    assert.strictEqual(err.report.latest.animation, undefined);

    const list = await store.list(10);
    assert.strictEqual(list.filter((r) => r.kind === 'animation').length, 2);
    assert.strictEqual(changes.length, 4);

    fs.rmSync(dir, { recursive: true, force: true });
    console.log('test-animation-reports: ok');
})().catch((err) => { console.error(err); process.exit(1); });
