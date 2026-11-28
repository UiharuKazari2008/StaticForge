#!/usr/bin/env node
'use strict';

// #1414 AI-generated soft key profiles: the pure parts (validation, link matching, prompt, answer parsing, assembling) and the
// whole generation with the model call stubbed. No network, no real model, no config written.
//   node scripts/test-softkey-generate.js

const assert = require('assert');
const sk = require('../modules/softKeyGenerate');
const kc = require('../modules/androidKeycodes');
require('../modules/tokenRouterGate').configure({ limit: 1000 }); // the shared gate must not make the stubbed calls wait

let n = 0;
let failed = 0;
function t(name, fn) {
    n++;
    try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
async function ta(name, fn) {
    n++;
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

const PKG = 'com.google.android.youtube';
// an invented, YouTube-shaped probe (test data only)
const probe = sk.sanitizeProbe({
    pkg: PKG, label: 'YouTube', versionName: '19.0.0',
    routes: [{ route: 'package-manager', ok: true }, { route: 'manifest', ok: false, error: 'denied' }],
    activities: [{ name: `${PKG}.app.honeycomb.Shell$HomeActivity`, exported: true }, { name: `${PKG}.UrlActivity`, exported: true }],
    links: [
        { activity: `${PKG}.UrlActivity`, actions: ['android.intent.action.VIEW'], scheme: 'https', host: 'www.youtube.com', pathPrefix: '/feed' },
        { activity: `${PKG}.UrlActivity`, actions: ['android.intent.action.VIEW'], scheme: 'https', host: 'www.youtube.com', path: '/shorts' },
        { activity: `${PKG}.UrlActivity`, actions: ['android.intent.action.VIEW'], scheme: 'https', host: 'm.youtube.com', pathPattern: '/watch.*' },
        { activity: `${PKG}.UrlActivity`, actions: ['android.intent.action.VIEW'], scheme: 'https', host: '*.youtu.be' },
        { activity: `${PKG}.Search`, actions: ['com.google.android.youtube.action.open.search'], scheme: '' }
    ],
    shortcuts: [{ id: 'explore', shortLabel: 'Explore', intent: 'https://www.youtube.com/results' }],
    keyboardShortcuts: [{ label: 'Search', keys: 'Ctrl+F' }]
}, PKG);
const intent = (host, path, pkg = PKG) => `intent://${host}${path}#Intent;scheme=https;package=${pkg};end`;
const v = (a, p = probe, o = {}) => sk.validateAction(a, p, Object.assign({ pkg: PKG }, o));

// ---- android keycodes
t('keycodes: the table is the full android list (code 316 is MACRO_4, 3 is HOME, 29 is A, 131 is F1)', () => {
    assert.strictEqual(kc.MAX_KEYCODE, 316);
    assert.strictEqual(kc.keyCode('KEYCODE_HOME'), 3);
    assert.strictEqual(kc.keyCode('A'), 29);
    assert.strictEqual(kc.keyCode('KEYCODE_F1'), 131);
    assert.strictEqual(kc.keyCode('KEYCODE_MACRO_4'), 316);
    assert.strictEqual(kc.keyCode('KEYCODE_ALL_APPS'), 284);
    assert.ok(kc.KEYCODES.size >= 315);
    assert.strictEqual(new Set(kc.NAMES_BY_CODE).size, kc.NAMES_BY_CODE.length, 'no name twice');
});
t('keycodes: digits 1..max are codes, 0 / 317 / NOPE are not, combos are 2..5 parts', () => {
    assert.strictEqual(kc.keyCode('29'), 29);
    assert.strictEqual(kc.keyCode('0'), null);
    assert.strictEqual(kc.keyCode('317'), null);
    assert.strictEqual(kc.keyCode('KEYCODE_NOPE'), null);
    assert.strictEqual(kc.keyCode('escape'), null, 'the phone is case sensitive');
    assert.deepStrictEqual(kc.keyCodes('KEYCODE_CTRL_LEFT+KEYCODE_F'), [113, 34]);
    assert.strictEqual(kc.keyCodes('KEYCODE_F'), null);
    assert.strictEqual(kc.keyCodes('A+B+C+D+E+F'), null);
});

// ---- validateAction
t('builtin names pass as via builtin; none and unknown names do not', () => {
    assert.deepStrictEqual([v('back').ok, v('back').via], [true, 'builtin']);
    assert.strictEqual(v('tasks').via, 'builtin');
    assert.strictEqual(v('none').ok, false);
    assert.strictEqual(v('teleport').ok, false);
    assert.strictEqual(v('ownmenu', probe, { menu: true }).ok, false, 'no ownmenu inside a menu');
});
t('do: only the known rows; open: only the app\'s own program id', () => {
    assert.strictEqual(v('do:flashlight').via, 'builtin');
    assert.strictEqual(v('do:format').ok, false);
    assert.strictEqual(v(`open:android:${PKG}`).ok, true);
    assert.strictEqual(v(`open:android:${PKG}/.Main`).ok, true);
    assert.strictEqual(v('open:android:com.evil.app').ok, false);
    assert.strictEqual(v('open:today').ok, false);
});
t('key: real KEYCODE names are via keys; KEYCODE_NOPE is refused; power and sleep are refused', () => {
    assert.deepStrictEqual([v('key:KEYCODE_ESCAPE').ok, v('key:KEYCODE_ESCAPE').via], [true, 'keys']);
    assert.strictEqual(v('key:ESCAPE').action, 'key:KEYCODE_ESCAPE');
    const bad = v('key:KEYCODE_NOPE');
    assert.strictEqual(bad.ok, false);
    assert.ok(/KEYCODE/.test(bad.reason));
    assert.strictEqual(v('key:KEYCODE_POWER').ok, false);
    assert.strictEqual(v('combo:KEYCODE_CTRL_LEFT+KEYCODE_SLEEP').ok, false);
});
t('combo: 2 to 5 real keys, via keys', () => {
    assert.strictEqual(v('combo:KEYCODE_CTRL_LEFT+KEYCODE_F').via, 'keys');
    assert.strictEqual(v('combo:KEYCODE_F').ok, false);
    assert.strictEqual(v('combo:KEYCODE_CTRL_LEFT+KEYCODE_NOPE').ok, false);
});
t('uri: an intent link on a host and path the probe declares is via link', () => {
    const r = v(`uri:${intent('www.youtube.com', '/feed/subscriptions')}`);
    assert.deepStrictEqual([r.ok, r.via], [true, 'link']);
    assert.ok(/declares this link/.test(r.note));
});
t('uri: an https URL on a declared host passes; path rules: path exact, pathPrefix, pathPattern glob, wildcard host', () => {
    assert.strictEqual(v('uri:https://www.youtube.com/feed/history').ok, true);
    assert.strictEqual(v('uri:https://www.youtube.com/shorts').ok, true);
    assert.strictEqual(v('uri:https://www.youtube.com/shorts/abc').ok, false, 'path is exact');
    assert.strictEqual(v('uri:https://m.youtube.com/watch?v=1').ok, true);
    assert.strictEqual(v('uri:https://m.youtube.com/playlist').ok, false);
    assert.strictEqual(v('uri:https://a.youtu.be/xyz').ok, true);
    assert.strictEqual(v('uri:https://youtu.be/xyz').ok, false, '*.host does not match the bare host');
});
t('uri: a host the probe does not declare is a problem with the reason named', () => {
    const r = v('uri:https://evil.example.com/feed/subscriptions');
    assert.strictEqual(r.ok, false);
    assert.ok(/declares no link filter for this host\/path/.test(r.reason));
    assert.strictEqual(v(`uri:${intent('www.youtube.com', '/account')}`).ok, false, 'host fits, path does not');
});
t('uri: an intent for another package, component=, SEL;, extras, javascript:, file:, market:, data: are refused', () => {
    assert.ok(/another package/.test(v(`uri:${intent('www.youtube.com', '/feed/x', 'com.other.app')}`).reason));
    assert.strictEqual(v(`uri:intent://www.youtube.com/feed/x#Intent;scheme=https;package=${PKG};component=${PKG}/.A;end`).ok, false);
    assert.strictEqual(v(`uri:intent://www.youtube.com/feed/x#Intent;scheme=https;package=${PKG};SEL;component=a/b;end`).ok, false);
    assert.strictEqual(v(`uri:intent://www.youtube.com/feed/x#Intent;scheme=https;package=${PKG};S.browser_fallback_url=https%3A%2F%2Fx.test;end`).ok, false);
    assert.strictEqual(v(`uri:intent://www.youtube.com/feed/x#Intent;scheme=https;end`).ok, false, 'no package=');
    ['javascript:alert(1)', 'file:///sdcard/x', 'content://a/b', 'data:text/html,hi', 'market://details?id=x', 'http://www.youtube.com/feed/x'].forEach((u) => {
        assert.strictEqual(v(`uri:${u}`).ok, false, u);
    });
});
t('uri: longer than 600 characters, spaces, https with a user name are refused', () => {
    assert.strictEqual(v(`uri:https://www.youtube.com/feed/${'a'.repeat(620)}`).ok, false);
    assert.strictEqual(v('uri:https://www.youtube.com/feed/a b').ok, false);
    assert.strictEqual(v('uri:https://user:pw@www.youtube.com/feed/x').ok, false);
});
t('uri: with no link filters read, it is accepted as unverified and says so', () => {
    const empty = sk.sanitizeProbe({ pkg: PKG }, PKG);
    const r = v(`uri:${intent('www.youtube.com', '/feed/subscriptions')}`, empty);
    assert.deepStrictEqual([r.ok, r.via], [true, 'link']);
    assert.strictEqual(r.note, 'unverified: the phone read no link filters');
});
t('uri: an action-only intent needs the action in a link filter; the app\'s own shortcut also counts', () => {
    const a = `uri:intent:#Intent;action=com.google.android.youtube.action.open.search;package=${PKG};end`;
    assert.strictEqual(v(a).ok, true);
    assert.strictEqual(v(`uri:intent:#Intent;action=com.google.android.youtube.action.nothing;package=${PKG};end`).ok, false);
    assert.strictEqual(v('uri:https://www.youtube.com/results').ok, true, 'the Explore shortcut names it');
});
t('glob: pathPattern .* and a repeated char', () => {
    assert.ok(sk.globToRegExp('/watch.*').test('/watch/abc'));
    assert.ok(sk.globToRegExp('/a*b').test('/aaab'));
    assert.ok(!sk.globToRegExp('/watch').test('/watch/abc'));
});

// ---- the whole profile
const youtubeAnswer = {
    left: { action: `uri:${intent('www.youtube.com', '/feed/subscriptions')}`, label: 'Subscriptions', why: 'the feed filter opens it' },
    center: { action: 'tasks', label: '', why: 'default' },
    right: {
        action: 'ownmenu', label: 'More', why: 'menu',
        menu: [
            { label: 'Home', action: `uri:${intent('www.youtube.com', '/feed/explore')}`, why: 'feed' },
            { label: 'Shorts', action: `uri:${intent('www.youtube.com', '/shorts')}`, why: 'declared path' },
            { label: 'Watch Later', action: 'uri:https://www.youtube.com/playlist?list=WL', why: 'playlist link' },
            { label: 'Search', action: 'combo:KEYCODE_CTRL_LEFT+KEYCODE_F', why: 'the app declares Ctrl+F' },
            { sep: true },
            { label: 'My Account', action: 'key:KEYCODE_NOPE', why: 'guess' },
            { label: 'History', action: `uri:${intent('www.youtube.com', '/feed/history')}`, why: 'feed' }
        ]
    },
    unmapped: []
};
t('a YouTube-shaped answer keeps Subscriptions as a uri via link and the menu with its good rows', () => {
    const out = sk.validateProfile(youtubeAnswer, probe, { pkg: PKG });
    assert.strictEqual(out.profile.left.action, youtubeAnswer.left.action);
    assert.strictEqual(out.profile.left.label, 'Subscriptions');
    const left = out.items.find((i) => i.side === 'left');
    assert.strictEqual(left.via, 'link');
    assert.strictEqual(out.profile.center.action, 'tasks');
    assert.strictEqual(out.profile.right.action, 'ownmenu');
});
t('a menu with a bad row keeps the good rows and reports the bad ones with their menuIndex', () => {
    const out = sk.validateProfile(youtubeAnswer, probe, { pkg: PKG });
    assert.deepStrictEqual(out.profile.right.menu.map((r) => r.label), ['Home', 'Shorts', 'Search', '-', 'History']);
    const bad = out.problems.filter((p) => p.side === 'right');
    assert.deepStrictEqual(bad.map((p) => p.menuIndex), [2, 5]);
    assert.ok(/declares no link filter/.test(bad[0].reason));
    assert.strictEqual(bad[1].action, 'key:KEYCODE_NOPE');
    assert.ok(/KEYCODE/.test(bad[1].reason));
});
t('items list every kept action with via and why; a bad row is never in the profile', () => {
    const out = sk.validateProfile(youtubeAnswer, probe, { pkg: PKG });
    const search = out.items.find((i) => i.label === 'Search');
    assert.strictEqual(search.via, 'keys');
    assert.strictEqual(search.menuIndex, 3);
    assert.strictEqual(out.items.find((i) => i.label === 'Shorts').via, 'link');
    assert.ok(out.items.every((i) => ['link', 'keys', 'builtin'].includes(i.via) && typeof i.why === 'string'));
    assert.ok(!JSON.stringify(out.profile).includes('NOPE'));
    assert.ok(!JSON.stringify(out.profile).includes('playlist'));
});
t('a keys row without a why from the model still says honestly it drives the app', () => {
    const out = sk.validateProfile({ left: { action: 'key:KEYCODE_ESCAPE', label: 'Esc' } }, probe, { pkg: PKG });
    assert.ok(/key events/.test(out.items[0].why));
});
t('a key with a menu becomes ownmenu even when the model gave another action', () => {
    const out = sk.validateProfile({ right: { action: 'back', label: 'More', menu: [{ label: 'Home', action: 'home' }] } }, probe, { pkg: PKG });
    assert.strictEqual(out.profile.right.action, 'ownmenu');
    assert.deepStrictEqual(out.profile.right.menu, [{ label: 'Home', action: 'home' }]);
});
t('ownmenu with no menu is a problem and the key is not saved; ownmenu in a menu row is a problem', () => {
    const out = sk.validateProfile({ left: { action: 'ownmenu', label: 'X' }, right: { action: 'ownmenu', label: 'M', menu: [{ label: 'Loop', action: 'ownmenu' }, { label: 'Home', action: 'home' }] } }, probe, { pkg: PKG });
    assert.strictEqual(out.profile.left, undefined);
    assert.ok(out.problems.some((p) => p.side === 'left' && /ownmenu/.test(p.reason)));
    assert.deepStrictEqual(out.profile.right.menu, [{ label: 'Home', action: 'home' }]);
    assert.ok(out.problems.some((p) => p.side === 'right' && p.menuIndex === 0));
});
t('a menu left with no valid rows makes the key a problem', () => {
    const out = sk.validateProfile({ right: { action: 'ownmenu', label: 'M', menu: [{ label: 'A', action: 'key:KEYCODE_NOPE' }, { label: 'B', action: 'none' }] } }, probe, { pkg: PKG });
    assert.strictEqual(out.profile.right, undefined);
    assert.strictEqual(out.problems.filter((p) => p.side === 'right').length, 3);
    assert.ok(out.problems.some((p) => p.menuIndex === null && /every row/.test(p.reason)));
});
t('the center defaults to tasks; a dead left key (none) is a problem, not a dead button', () => {
    const out = sk.validateProfile({ left: { action: 'none', label: 'Nothing' } }, probe, { pkg: PKG });
    assert.deepStrictEqual(out.profile.center, { action: 'tasks', label: '' });
    assert.strictEqual(out.profile.left, undefined);
    assert.ok(out.problems.some((p) => p.side === 'left' && /does nothing/.test(p.reason)));
});
t('size caps: key label 24, menu label 40, menu rows 24 (the rest are problems), blank label on a uri is a problem', () => {
    const rows = [];
    for (let i = 0; i < 30; i++) rows.push({ label: `Row ${i} ${'x'.repeat(60)}`, action: 'home' });
    const out = sk.validateProfile({ left: { action: 'home', label: 'L'.repeat(40) }, right: { action: 'ownmenu', label: 'M', menu: rows } }, probe, { pkg: PKG });
    assert.strictEqual(out.profile.left.label.length, 24);
    assert.strictEqual(out.profile.right.menu.length, 24);
    assert.ok(out.profile.right.menu.every((r) => r.label.length <= 40));
    assert.strictEqual(out.problems.filter((p) => /at most 24/.test(p.reason)).length, 6);
    const blank = sk.validateProfile({ left: { action: `uri:${intent('www.youtube.com', '/feed/x')}`, label: '' } }, probe, { pkg: PKG });
    assert.strictEqual(blank.profile.left, undefined);
    assert.ok(/needs a label/.test(blank.problems[0].reason));
});
t('probe caps: 200 activities, 150 links, 60 shortcuts, 60 keyboard shortcuts, strings 300', () => {
    const big = sk.sanitizeProbe({
        pkg: PKG,
        activities: Array.from({ length: 300 }, (_, i) => ({ name: `a${i}` })),
        links: Array.from({ length: 200 }, (_, i) => ({ scheme: 'https', host: `h${i}.test` })),
        shortcuts: Array.from({ length: 90 }, (_, i) => ({ id: `s${i}` })),
        keyboardShortcuts: Array.from({ length: 90 }, (_, i) => ({ label: `k${i}`, keys: 'A' })),
        notes: ['n'.repeat(900)]
    }, PKG);
    assert.deepStrictEqual([big.activities.length, big.links.length, big.shortcuts.length, big.keyboardShortcuts.length], [200, 150, 60, 60]);
    assert.strictEqual(big.notes[0].length, 300);
    assert.strictEqual(sk.sanitizeProbe(null, PKG).links.length, 0, 'a missing probe is empty, not an error');
    assert.strictEqual(sk.sanitizeProbe('garbage', PKG).activities.length, 0);
});
t('the model\'s unmapped entries are kept as problems, never dropped', () => {
    const out = sk.validateProfile({ left: { action: 'home', label: 'Home' }, unmapped: [{ label: 'Playables', reason: 'no link and no key reach it' }] }, probe, { pkg: PKG });
    const u = out.problems.find((p) => p.label === 'Playables');
    assert.ok(u && u.reason === 'no link and no key reach it' && u.action === '');
});

// ---- the pre-design way
const design = { left: { label: 'Subscriptions' }, right: { label: 'More', menu: [{ label: 'Home' }, { label: 'Shorts' }, { label: 'Library' }, { sep: true }, { label: 'History' }] } };
t('pre-design: her labels and divider are kept, the model finds the actions, an unmapped label is a problem with the model\'s reason', () => {
    const answer = {
        left: { action: `uri:${intent('www.youtube.com', '/feed/subscriptions')}`, label: 'Subs', why: 'feed' },
        right: { action: 'ownmenu', label: 'Menu', menu: [
            { label: 'home', action: `uri:${intent('www.youtube.com', '/feed/explore')}` },
            { label: 'Shorts', action: `uri:${intent('www.youtube.com', '/shorts')}` },
            { label: 'History', action: `uri:${intent('www.youtube.com', '/feed/history')}` }] },
        unmapped: [{ label: 'Library', reason: 'no link filter reaches the library tab' }]
    };
    const out = sk.assemble(answer, { probe, pkg: PKG, design, unmapped: answer.unmapped });
    assert.strictEqual(out.profile.left.label, 'Subscriptions');
    assert.strictEqual(out.profile.right.label, 'More');
    assert.deepStrictEqual(out.profile.right.menu.map((r) => r.label), ['Home', 'Shorts', '-', 'History']);
    const lib = out.problems.filter((p) => p.label === 'Library');
    assert.strictEqual(lib.length, 1, 'not reported twice');
    assert.deepStrictEqual([lib[0].side, lib[0].menuIndex, lib[0].reason], ['right', 2, 'no link filter reaches the library tab']);
});
t('pre-design: a written label the model did not answer is a problem, not a dropped entry', () => {
    const out = sk.assemble({ left: { action: 'home', label: 'x' }, right: { action: 'ownmenu', menu: [{ label: 'Shorts', action: 'home' }] } }, { probe, pkg: PKG, design });
    assert.ok(out.problems.some((p) => p.label === 'Home' && p.menuIndex === 0 && /no action/.test(p.reason)));
    assert.ok(out.problems.some((p) => p.label === 'History' && p.menuIndex === 4));
});

// ---- the prompt and the model's text
t('prompt: names the grammar, the package, the probe, the design and the word JSON', () => {
    const p = sk.buildPrompt({ pkg: PKG, label: 'YouTube', probe, wish: 'left key = Subscriptions', design });
    const all = `${p.system}\n${p.user}`;
    assert.ok(/json/i.test(all));
    ['combo:KEYCODE_', 'key:KEYCODE_', 'uri:<link>', 'do:taskmanager', 'ownmenu', 'unmapped', `package=${PKG}`].forEach((w) => assert.ok(all.includes(w), w));
    assert.ok(p.user.includes('www.youtube.com') && p.user.includes('pathPrefix=/feed') && p.user.includes('Ctrl+F'));
    assert.ok(p.user.includes('"Library"') && p.user.includes('left key = Subscriptions'));
    assert.ok(/PRE-DESIGN/.test(p.system));
    assert.ok(!/PRE-DESIGN/.test(sk.buildPrompt({ pkg: PKG, label: 'YouTube', probe, wish: '', design: null }).system));
});
t('parseModelAnswer: plain, fenced json, text around it, think tags; garbage is null', () => {
    const o = { left: { action: 'home' } };
    assert.deepStrictEqual(sk.parseModelAnswer(JSON.stringify(o)), o);
    assert.deepStrictEqual(sk.parseModelAnswer('```json\n' + JSON.stringify(o) + '\n```'), o);
    assert.deepStrictEqual(sk.parseModelAnswer('Here you go:\n```\n' + JSON.stringify(o) + '\n```\nEnjoy'), o);
    assert.deepStrictEqual(sk.parseModelAnswer('sure! ' + JSON.stringify(o) + ' hope it helps {not json'), o);
    assert.deepStrictEqual(sk.parseModelAnswer('<think>{"x":1}</think>' + JSON.stringify(o)), o);
    assert.strictEqual(sk.parseModelAnswer('I cannot do that'), null);
    assert.strictEqual(sk.parseModelAnswer('[1,2,3]'), null);
    assert.strictEqual(sk.parseModelAnswer(''), null);
    assert.strictEqual(sk.parseModelAnswer(null), null);
});

// ---- generation with the model call stubbed
const KEY = 'sk-test-secret-KEY-123';
const saved = [];
const gr = {
    getApiKeyManager: () => ({ getActiveApiKey: (s) => (s === 'tokenrouter' ? KEY : '') }),
    getConfig: () => ({ softKeyGen: saved.length ? saved[saved.length - 1] : undefined }),
    modifyConfig: () => ({ assign: async (p, val) => { assert.deepStrictEqual(p, ['softKeyGen']); saved.push(val); } })
};
sk._setEngineSource(() => [
    { id: 'tokenrouter', name: 'TokenRouter', defaultModel: 'deepseek/deepseek-v4.1-flash', ready: true },
    { id: 'deepinfra', name: 'DeepInfra', defaultModel: 'deepseek-ai/DeepSeek-V4.1-Flash', ready: false }
]);
let lastCall = null;
const reply = (text, status = 200) => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => (status < 300 ? JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) : text) });
const stub = (fn) => sk._setFetch(async (url, init) => { lastCall = { url, init, body: JSON.parse(init.body) }; return fn(url, init); });
const req = { pkg: PKG, label: 'YouTube', probe: { pkg: PKG, links: probe.links, activities: probe.activities }, wish: 'a menu for the main screens' };

t('open:<own program> is for Home / Open the app only: a label naming another screen is a problem, not a key that just starts the app', () => {
    const own = `open:android:${PKG}`;
    const raw = { left: { action: own, label: 'Subscriptions' }, center: { action: 'tasks', label: '' }, right: { action: 'ownmenu', label: 'Menu', menu: [{ label: 'Home', action: own }, { label: 'History', action: own }] } };
    const out = sk.validateProfile(raw, probe, { pkg: PKG, appLabel: 'YouTube' });
    assert.ok(!out.profile.left, 'Subscriptions must not be a key that only starts the app');
    assert.ok(out.problems.some((p) => p.label === 'Subscriptions' && /starts the app/.test(p.reason)));
    assert.deepStrictEqual(out.profile.right.menu.map((r) => r.label), ['Home']);
    assert.ok(out.problems.some((p) => p.label === 'History'));
});

t('an https link is stored as an intent link that names the app, so it opens in the app and not a browser', () => {
    const v = sk.validateAction('uri:https://www.youtube.com/feed/history?x=1', probe, { pkg: PKG });
    assert.strictEqual(v.ok, true, v.reason);
    assert.strictEqual(v.action, `uri:intent://www.youtube.com/feed/history?x=1#Intent;scheme=https;package=${PKG};end`);
    assert.strictEqual(v.via, 'link');
});

t('the prompt lists only the activities other programs can start, at most 40, so a large app does not slow the AI', () => {
    const many = { pkg: PKG, label: 'Big', activities: Array.from({ length: 150 }, (_, i) => ({ name: `${PKG}.A${i}`, exported: i % 3 === 0 })), links: [], shortcuts: [], keyboardShortcuts: [], routes: [], notes: [] };
    const p = sk.sanitizeProbe(many, PKG);
    const { user } = sk.buildPrompt({ pkg: PKG, label: 'Big', probe: p, wish: '', design: null });
    const listed = user.split('\n').filter((l) => /^- \.A\d+/.test(l));
    assert.ok(listed.length <= 40 && listed.length > 0, `listed ${listed.length}`);
    assert.ok(listed.every((l) => / x/.test(l)));
    assert.ok(/150 in all/.test(user));
});

async function main() {
    await ta('generate: a good answer comes back as profile, items, problems, engine, model, ms; the call is JSON mode with the key only in the header', async () => {
        stub(() => reply(JSON.stringify(youtubeAnswer)));
        const out = await sk.generate(gr, req);
        assert.strictEqual(out.profile.left.label, 'Subscriptions');
        assert.ok(out.items.length >= 6 && out.problems.length === 2, JSON.stringify([out.items.length, out.problems]));
        assert.deepStrictEqual([out.engine, out.model], ['tokenrouter', 'deepseek/deepseek-v4.1-flash']);
        assert.ok(Number.isInteger(out.ms));
        assert.strictEqual(lastCall.url, 'https://api.tokenrouter.com/v1/chat/completions');
        assert.strictEqual(lastCall.init.headers.Authorization, `Bearer ${KEY}`);
        assert.deepStrictEqual(lastCall.body.response_format, { type: 'json_object' });
        assert.ok(lastCall.body.messages.some((m) => /json/i.test(m.content)));
        assert.ok(!JSON.stringify(out).includes(KEY));
        assert.ok(!JSON.stringify(lastCall.body).includes(KEY));
    });
    await ta('generate: fenced json with text around it is read', async () => {
        stub(() => reply('Sure!\n```json\n' + JSON.stringify(youtubeAnswer) + '\n```\n'));
        assert.strictEqual((await sk.generate(gr, req)).profile.right.action, 'ownmenu');
    });
    await ta('generate: garbage model output is an error answer (code SOFTKEYS_BAD_ANSWER), not a crash', async () => {
        stub(() => reply('I am sorry, I cannot help with that.'));
        await assert.rejects(() => sk.generate(gr, req), (e) => e.code === 'SOFTKEYS_BAD_ANSWER' && /did not answer with soft keys/.test(e.message));
        stub(() => reply('{"foo": 1}'));
        await assert.rejects(() => sk.generate(gr, req), (e) => e.code === 'SOFTKEYS_BAD_ANSWER');
    });
    await ta('generate: an upstream error never carries the key; 400 about response_format is asked again without it', async () => {
        stub(() => reply(`bad key ${KEY} rejected`, 401));
        await assert.rejects(() => sk.generate(gr, req), (e) => e.code === 'SOFTKEYS_UPSTREAM' && !e.message.includes(KEY) && /401/.test(e.message));
        let calls = 0;
        stub(() => { calls++; return calls === 1 ? reply('response_format is not supported', 400) : reply(JSON.stringify(youtubeAnswer)); });
        const out = await sk.generate(gr, req);
        assert.strictEqual(calls, 2);
        assert.strictEqual(lastCall.body.response_format, undefined);
        assert.ok(out.profile.left);
    });
    await ta('generate: a network failure is an error answer; a bad package or an engine with no key is refused before any call', async () => {
        stub(() => { throw new Error(`connect failed ${KEY}`); });
        await assert.rejects(() => sk.generate(gr, req), (e) => e.code === 'SOFTKEYS_UPSTREAM' && !e.message.includes(KEY));
        let called = false;
        stub(() => { called = true; return reply('{}'); });
        await assert.rejects(() => sk.generate(gr, Object.assign({}, req, { pkg: 'nope' })), (e) => e.code === 'SOFTKEYS_BAD_REQUEST');
        await assert.rejects(() => sk.generate(gr, Object.assign({}, req, { engine: 'deepinfra' })), (e) => e.code === 'SOFTKEYS_NO_KEY');
        await assert.rejects(() => sk.generate(gr, Object.assign({}, req, { engine: 'nothing' })), (e) => e.code === 'SOFTKEYS_NO_ENGINE');
        assert.strictEqual(called, false);
    });
    await ta('generate: a design reaches the prompt and her labels win in the answer', async () => {
        stub(() => reply(JSON.stringify({ left: { action: `uri:${intent('www.youtube.com', '/feed/subscriptions')}`, label: 'Subs' }, unmapped: [] })));
        const out = await sk.generate(gr, Object.assign({}, req, { design: { left: { label: 'Subscriptions' } } }));
        assert.ok(lastCall.body.messages[1].content.includes('"Subscriptions"'));
        assert.strictEqual(out.profile.left.label, 'Subscriptions');
    });
    await ta('defaults: no saved pick is TokenRouter with its DeepSeek model; a saved pick is kept and read back; a bad pick is refused', async () => {
        assert.deepStrictEqual(sk.resolveDefault(gr), { engine: 'tokenrouter', model: 'deepseek/deepseek-v4.1-flash', isSaved: false });
        assert.deepStrictEqual(await sk.saveDefault(gr, { engine: 'custom:tokenrouter', model: 'anthropic/claude-sonnet-5.5' }), { engine: 'tokenrouter', model: 'anthropic/claude-sonnet-5.5' });
        assert.strictEqual(sk.resolveDefault(gr).model, 'anthropic/claude-sonnet-5.5');
        await assert.rejects(() => sk.saveDefault(gr, { engine: 'ghost', model: 'x' }), (e) => e.code === 'SOFTKEYS_ENGINE');
        await assert.rejects(() => sk.saveDefault(gr, { engine: 'tokenrouter', model: 'bad model!' }), (e) => e.code === 'SOFTKEYS_MODEL');
        stub(() => reply(JSON.stringify(youtubeAnswer)));
        const out = await sk.generate(gr, req);
        assert.strictEqual(out.model, 'anthropic/claude-sonnet-5.5', 'generate with no engine uses the saved default');
    });
    await ta('engines: the Director\'s list with models and the saved pick (an engine with no key lists no models)', async () => {
        sk._setEngineSource(() => [{ id: 'deepinfra', name: 'DeepInfra', defaultModel: 'deepseek-ai/DeepSeek-V4.1-Flash', ready: false }]);
        const e = await sk.engines({ getConfig: () => ({}) });
        assert.deepStrictEqual(e.engines, [{ id: 'deepinfra', name: 'DeepInfra', defaultModel: 'deepseek-ai/DeepSeek-V4.1-Flash', ready: false, models: ['deepseek-ai/DeepSeek-V4.1-Flash'] }]);
        assert.deepStrictEqual(e.saved, { engine: '', model: '' });
    });
    await ta('handler: registers the three packets and answers with sendOk / sendError shapes', async () => {
        const reg = require('../modules/ws/wsPacketRegistry');
        const handler = require('../modules/ws/handlers/45-softKeysHandler');
        const sent = [];
        const ctx = { globalResources: gr, sendToClient: (ws, m) => sent.push(m), sendError: (ws, msg, code, id) => sent.push({ error: msg, code, id }) };
        handler.registerPackets(ctx);
        sk._setEngineSource(() => [{ id: 'tokenrouter', name: 'TokenRouter', defaultModel: 'deepseek/deepseek-v4.1-flash', ready: true }]);
        const call = async (type, message) => { const h = reg.getWsPacketHandler ? reg.getWsPacketHandler(type) : null; assert.ok(h, `${type} registered`); await (h.handler || h)({ ws: {}, message: Object.assign({ type, requestId: 'r1' }, message), clientInfo: {}, wsServer: null, handlers: ctx }); };
        stub(() => reply(JSON.stringify(youtubeAnswer)));
        await call('softkeys_generate', req);
        assert.strictEqual(sent[0].type, 'softkeys_generate_response');
        assert.strictEqual(sent[0].requestId, 'r1');
        assert.strictEqual(sent[0].data.success, true);
        assert.ok(sent[0].data.profile && sent[0].data.items && sent[0].data.problems);
        await call('softkeys_default_set', { engine: 'tokenrouter', model: 'deepseek/deepseek-v4.1-flash' });
        assert.deepStrictEqual(sent[1].data.saved, { engine: 'tokenrouter', model: 'deepseek/deepseek-v4.1-flash' });
        await call('softkeys_default_set', { engine: 'ghost', model: 'x' });
        assert.strictEqual(sent[2].code, 'SOFTKEYS_ENGINE');
        await call('softkeys_generate', { pkg: 'x' });
        assert.strictEqual(sent[3].code, 'SOFTKEYS_BAD_REQUEST');
    });
    sk._setFetch(null);
    sk._setEngineSource(null);
    console.log(`\n${n - failed} of ${n} passed`);
    process.exit(failed ? 1 : 0);
}
main();
