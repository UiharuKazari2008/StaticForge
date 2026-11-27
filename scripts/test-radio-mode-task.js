#!/usr/bin/env node
/*
 * CaféReady task radio-mode (#1328): runs public/scripts/tasks in a bare VM context (no DOM, no timers, like the app's
 * isolate) and drives it the way DSApp CafeTasks does: dispatch(name, type, dataJson, stateJson?) -> actions, the
 * state kept by the host from patch / drop and handed back after an engine restart. The last part runs random event
 * sequences against a model phone that carries out the radio actions in order.
 *
 *   node scripts/test-radio-mode-task.js [random runs per kind]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'public', 'scripts', 'tasks');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
assert.ok(manifest.files.includes('radio-mode.js'), 'the task ships in the manifest');
assert.ok(manifest.files.indexOf('radio-mode.js') > manifest.files.indexOf('drive-alerts.js'), 'after drive-alerts.js (distM)');
assert.strictEqual(manifest.files[0], 'runtime.js');
assert.ok(manifest.tasks.some((t) => t.name === 'radio-mode' && t.api === 1));
assert.strictEqual(manifest.api, 1);

const compiled = new Map();
const script = (f) => {
    if (!compiled.has(f)) compiled.set(f, new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f }));
    return compiled.get(f);
};
function load(files = manifest.files) {
    const sandbox = {};
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    files.forEach((f) => script(f).runInContext(sandbox));
    return sandbox;
}

const plain = (v) => JSON.parse(JSON.stringify(v)); // values from the VM, comparable here
const same = (a, b, msg) => assert.deepStrictEqual(plain(a === undefined ? null : a), plain(b), msg);

const mask = (...types) => types.reduce((n, t) => n | (1 << (t - 1)), 0).toString(2).padStart(20, '0');
const OLD = [1, 2, 3, 8, 9, 10, 15, 16, 18]; // 2G / 3G / IWLAN
const SUP = mask(...OLD, 13, 19, 20);
const SUP4G = mask(...OLD, 13, 19);
const NR_ONLY = mask(20);
const LTE_ONLY = mask(13, 19);
const NRLTE = mask(13, 19, 20);

const metres = (m) => m / 111194.93; // degrees of latitude
const WORK = { id: 'work', name: 'Work', lat: 10, lon: 20, radiusM: 300, mode: 'nr', on: true };
const CAMPUS = { id: 'campus', name: 'Campus', lat: 10.001, lon: 20, radiusM: 1000, mode: 'lte', on: true };
const FAR = { id: 'far', name: 'Far', lat: 11, lon: 20, radiusM: 200, mode: 'nrlte', on: true };
const ALL = [WORK, CAMPUS, FAR];

// ---------------------------------------------------------------- the pure parts
const L = load().CafeTasks.lib.radio;
same(L.MODES.map((m) => [m.id, m.label]), [['nr', 'NR only'], ['auto', 'Auto'], ['lte', 'LTE'], ['nrlte', 'NR / LTE']]);
assert.strictEqual(L.label('nr'), 'NR only');
assert.strictEqual(L.label('nrlte'), 'NR / LTE');
assert.strictEqual(L.label('wcdma'), '');
same(L.RADII, [100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000]);
same(L.modes(SUP).map((m) => m.id), ['nr', 'auto', 'lte', 'nrlte']);
same(L.modes(SUP4G).map((m) => m.id), ['auto', 'lte']);
same(L.modes(NR_ONLY).map((m) => m.id), ['nr', 'auto']);
same(L.modes(mask(1, 16)).map((m) => m.id), ['auto'], 'a 2G phone: Auto alone');
same(L.modes(mask(19)).map((m) => m.id), ['auto'], 'LTE needs the LTE type, LTE_CA alone is not it');
[null, undefined, '', mask(), '101', `${SUP}1`, SUP.replace('1', '2'), 5].forEach((v) => same(L.modes(v), [], `unknown supported ${v}`));

assert.strictEqual(L.maskFor('nr', SUP, null), NR_ONLY);
assert.strictEqual(L.maskFor('lte', SUP, null), LTE_ONLY);
assert.strictEqual(L.maskFor('nrlte', SUP, null), NRLTE);
assert.strictEqual(L.maskFor('lte', mask(1, 13), null), mask(13), 'only what the phone supports');
assert.strictEqual(L.maskFor('nr', SUP4G, null), null);
assert.strictEqual(L.maskFor('nrlte', SUP4G, null), null);
assert.strictEqual(L.maskFor('nrlte', NR_ONLY, null), null);
['3g', '', null, 'constructor', 'toString'].forEach((id) => assert.strictEqual(L.maskFor(id, SUP, null), null, String(id)));
['nr', 'lte', 'nrlte', 'auto'].forEach((id) => { assert.strictEqual(L.maskFor(id, null, SUP), null); assert.strictEqual(L.maskFor(id, mask(), null), null); });

// the Auto mask
const BASE = mask(1, 3, 13, 16, 19, 20);
assert.strictEqual(L.autoMask(SUP, null), SUP);
assert.strictEqual(L.autoMask(SUP, BASE), BASE, 'a full baseline is her own choice');
assert.strictEqual(L.maskFor('auto', SUP, BASE), BASE);
assert.strictEqual(L.autoMask(SUP, NR_ONLY), SUP, 'a baseline that is itself forced NR: no LTE');
assert.strictEqual(L.autoMask(SUP, LTE_ONLY), SUP, 'a baseline forced to LTE on an NR phone: no NR');
assert.strictEqual(L.autoMask(SUP4G, LTE_ONLY), LTE_ONLY, 'without NR in the phone it is full enough');
assert.strictEqual(L.autoMask(SUP, NRLTE), NRLTE, 'NR / LTE has both generations');
assert.strictEqual(L.autoMask(SUP4G, BASE), SUP4G, 'a bit the phone does not have');
assert.strictEqual(L.autoMask(SUP, mask(1, 16)), SUP);
assert.strictEqual(L.autoMask(SUP, mask()), SUP);
assert.strictEqual(L.autoMask(SUP, 'junk'), SUP);
assert.strictEqual(L.autoMask(null, BASE), null);
assert.strictEqual(L.autoMask(mask(), BASE), null);
assert.strictEqual(L.autoMask(NR_ONLY, null), NR_ONLY);

// what the phone is on
assert.strictEqual(L.modeOf(SUP, SUP, null), 'auto');
assert.strictEqual(L.modeOf(mask(...OLD, 13, 20), SUP, null), 'auto', 'LTE_CA does not count');
assert.strictEqual(L.modeOf(NR_ONLY, SUP, null), 'nr');
assert.strictEqual(L.modeOf(mask(19, 20), SUP, null), 'nr', 'NR with a stray LTE_CA');
assert.strictEqual(L.modeOf(LTE_ONLY, SUP, null), 'lte');
assert.strictEqual(L.modeOf(mask(13), SUP, null), 'lte', 'LTE read back without LTE_CA');
assert.strictEqual(L.modeOf(NRLTE, SUP, null), 'nrlte');
assert.strictEqual(L.modeOf(mask(13, 20), SUP, null), 'nrlte');
assert.strictEqual(L.modeOf(NRLTE, SUP, NRLTE), 'auto', 'the Auto mask wins over a mode name');
assert.strictEqual(L.modeOf(BASE, SUP, BASE), 'auto');
assert.strictEqual(L.modeOf(mask(1, 13), SUP, null), 'auto', 'LTE and something else');
assert.strictEqual(L.modeOf(mask(16, 20), SUP, null), 'auto', 'NR and something else');
assert.strictEqual(L.modeOf(mask(1, 2, 16), SUP, null), 'other');
assert.strictEqual(L.modeOf(mask(19), SUP, null), 'other', 'LTE_CA alone is nothing');
assert.strictEqual(L.modeOf(mask(), SUP, null), 'other');
assert.strictEqual(L.modeOf(NR_ONLY, null, null), 'nr', 'supported unknown: the mask still names itself');
[null, undefined, '', '1010'].forEach((v) => assert.strictEqual(L.modeOf(v, SUP, null), null));

// rules
same(L.cleanRule({ id: 'a-1', name: '  Work  ', lat: -90, lon: 180, mode: 'nr' }), { id: 'a-1', name: 'Work', lat: -90, lon: 180, radiusM: 300, mode: 'nr', on: true });
const clean = (o) => L.cleanRule(Object.assign({}, WORK, o));
assert.strictEqual(clean({ radiusM: 5 }).radiusM, 100);
assert.strictEqual(clean({ radiusM: 99999 }).radiusM, 5000);
assert.strictEqual(clean({ radiusM: 333.6 }).radiusM, 334);
[NaN, null, '500', undefined].forEach((v) => assert.strictEqual(clean({ radiusM: v }).radiusM, 300));
assert.strictEqual(clean({ on: false }).on, false);
assert.strictEqual(clean({ on: undefined }).on, true);
assert.strictEqual(clean({ name: 'x'.repeat(80) }).name.length, 60);
assert.strictEqual(clean({ name: `${'x'.repeat(59)}\u{1F3E2}` }).name, 'x'.repeat(59), 'never half a character');
[{ id: 'A' }, { id: '' }, { id: 'a b' }, { id: 'x'.repeat(41) }, { id: 7 }, { name: '   ' }, { name: 4 }, { lat: 90.1 }, { lat: null }, { lat: '10' },
    { lon: -181 }, { lon: NaN }, { mode: 'auto' }, { mode: '3g' }, { mode: 'constructor' }, { mode: undefined }].forEach((o) => assert.strictEqual(clean(o), null, JSON.stringify(o)));
[null, undefined, 'x', 3].forEach((v) => assert.strictEqual(L.cleanRule(v), null));
const many = []; for (let i = 0; i < 30; i++) many.push(Object.assign({}, WORK, { id: `r${i}` }));
assert.strictEqual(L.cleanRules(many).length, 20);
same(L.cleanRules([WORK, Object.assign({}, WORK, { name: 'Second' }), null, { id: 'bad' }, CAMPUS]).map((r) => r.name), ['Work', 'Campus']);
same(L.cleanRules('nope'), []);
{
    const g = load();
    assert.strictEqual(g.CafeTasks.lib.radio.distM(WORK, CAMPUS), g.CafeTasks.lib.drive.distM(WORK, CAMPUS));
    assert.ok(Math.abs(L.distM(WORK, { lat: 10 + metres(500), lon: 20 }) - 500) < 0.1);
}
assert.strictEqual(L.winner(ALL, ['work', 'campus']).id, 'work', 'the smallest circle');
assert.strictEqual(L.winner(ALL, ['campus']).id, 'campus');
assert.strictEqual(L.winner([Object.assign({}, WORK, { on: false }), CAMPUS], ['work', 'campus']).id, 'campus', 'a rule turned off never wins');
assert.strictEqual(L.winner([CAMPUS, Object.assign({}, WORK, { radiusM: 1000 })], ['work', 'campus']).id, 'campus', 'a tie: the earlier in the list');
assert.strictEqual(L.winner(ALL, []), null);
assert.strictEqual(L.winner(ALL, ['gone']), null);
assert.strictEqual(L.winner(null, null), null);

// ---------------------------------------------------------------- the host model
const NAME = 'radio-mode';
const HOST = { api: 1, ops: ['car', 'radio'] };

function makePhone({ ops = HOST.ops, device, files, start = true } = {}) {
    const p = { g: load(files), state: null, fresh: true, output: null, device: device || { supported: SUP, current: SUP, baseline: null } };
    p.send = (type, data) => {
        const out = JSON.parse(p.g.CafeTasks.dispatch(NAME, type, JSON.stringify(data || {}), p.fresh && p.state ? JSON.stringify(p.state) : null));
        p.fresh = false;
        if (out.error) throw new Error(out.error);
        if (out.patch) p.state = Object.assign(p.state || {}, out.patch);
        (out.drop || []).forEach((k) => { delete p.state[k]; });
        out.actions.forEach((a) => {
            assert.ok(a.op === 'radio' || a.op === 'output', `only radio and output, not ${a.op}`);
            if (a.op === 'output') { assert.notDeepStrictEqual(a.output, p.output, 'output only when changed'); p.output = a.output; }
        });
        return out.actions;
    };
    p.ev = (type, data) => p.send(type, Object.assign({ device: Object.assign({}, p.device) }, data));
    p.radios = (type, data) => p.ev(type, data).filter((a) => a.op === 'radio');
    p.start = () => p.send('start', { host: { api: 1, ops } }).filter((a) => a.op === 'radio');
    /** The engine closed (idle, process death) and started again: the host hands the state back, start first. */
    p.restart = () => { p.g = load(files); p.fresh = true; return p.start(); };
    p.rules = (rules, inside) => p.radios('rules', inside ? { rules, inside } : { rules });
    p.enter = (...ids) => p.radios('geofence', { enter: ids, exit: [] });
    p.exit = (...ids) => p.radios('geofence', { enter: [], exit: ids });
    p.retry = () => p.radios('retry', { why: 'screen' });
    p.manual = (mode, current) => { p.device.current = current || L.maskFor(mode, SUP, null) || p.device.current; return p.radios('manual', { mode }); };
    p.fixAt = (lat, lon, accuracyM) => p.radios('fix', { lat, lon, accuracyM, why: 'service' });
    /** The host's answer to one action; ok writes the mask. -> the radio actions the answer caused. */
    p.answer = (a, ok = true, error) => {
        if (ok) p.device.current = a.mask || SUP;
        return p.radios('radio', Object.assign({ ok, mode: a.mode, mask: a.mask, ruleId: a.ruleId }, ok ? {} : { error: error || 'write failed' }));
    };
    if (start) { p.start(); p.rules(ALL); }
    return p;
}
const one = (list) => { assert.strictEqual(list.length, 1, `one radio action, got ${JSON.stringify(list)}`); return list[0]; };
const none = (list, msg) => same(list, [], msg || 'no radio action');
const brief = (a) => [a.mode, a.ruleId];
const done = (p) => { same(p.state.want, null); assert.strictEqual(p.state.armed, false); same(p.state.forced, null); same(p.state.inside, []); };
/** A phone forced to NR at Work, confirmed. */
function atWork(o) { const p = makePhone(o); p.answer(one(p.enter('work'))); return p; }

// ---------------------------------------------------------------- an older app: nothing at all
for (const data of [{}, { host: { api: 1, ops: ['approach', 'car'] } }, { host: {} }]) {
    const p = makePhone({ start: false });
    same(p.send('start', data), []);
    same(p.ev('rules', { rules: ALL, inside: ['work'] }), []);
    same(p.ev('geofence', { enter: ['work'], exit: [] }), []);
    same(p.ev('fix', { lat: 10, lon: 20, accuracyM: 5 }), []);
    same(p.ev('manual', { mode: 'lte' }), []);
    same(p.ev('retry', {}), []);
    same(p.ev('radio', { ok: true, mode: 'nr', mask: NR_ONLY, ruleId: 'work' }), []);
    same(p.state.inside, []);
    same(p.state.rules, []);
    assert.strictEqual(p.state.armed, false);
}

// ---------------------------------------------------------------- enter, repeat, manual, exit
// (two places that do not overlap: a fix at Work enters nothing else)
{
    const TWO = [WORK, FAR];
    const p = makePhone({ start: false });
    let a = p.send('start', { host: HOST });
    same(a, [{ op: 'output', output: { active: true, inside: [], rule: null, want: null, error: null } }]);
    none(p.rules(TWO), 'saving places applies nothing');
    none(p.exit('work'), 'leaving a place never entered: nothing');
    none(p.enter('unknown'), 'an unknown id');
    none(p.retry());

    const f = one(p.enter('work'));
    same(f, { op: 'radio', mode: 'nr', mask: NR_ONLY, autoMask: SUP, ruleId: 'work', name: 'Work', why: 'enter' });
    same(p.output, { active: true, inside: ['work'], rule: null, want: 'nr', error: null }, 'wanted, not yet confirmed');
    none(p.answer(f));
    same(p.output, { active: true, inside: ['work'], rule: { id: 'work', name: 'Work', mode: 'nr' }, want: 'nr', error: null });
    assert.ok(p.state.forced.at > 0);

    same(p.ev('geofence', { enter: ['work'], exit: [] }), [], 'a repeated enter: no action, no output');
    none(p.retry(), 'nothing to retry');
    same(p.restart(), []);
    none(p.enter('work'), 'a re-registration after an engine restart');
    none(p.fixAt(10, 20, 10), 'a fix inside says nothing new');

    // by hand inside: nothing brings the rule back over it
    none(p.manual('lte'));
    same(p.output, { active: true, inside: ['work'], rule: null, want: null, error: null });
    none(p.enter('work'));
    none(p.retry());
    none(p.fixAt(10, 20, 10));
    none(p.rules(TWO));
    none(p.rules(TWO, ['work']));
    none(p.rules(TWO.map((r) => (r.id === 'work' ? Object.assign({}, r, { name: 'Office' }) : r))), 'a rename');
    none(p.exit('far'));
    none(p.answer(f), 'a repeat of the old answer');
    same(p.output.rule, null, 'the old answer does not show the force again');
    none(p.answer(f, false), 'nor does a late failure bring the want back');
    none(p.retry());

    const back = one(p.exit('work'));
    same([back.mode, back.mask, back.autoMask, back.ruleId, back.name, back.why], ['auto', SUP, SUP, '', '', 'exit'], 'leaving returns to Auto, also after a hand set');
    assert.strictEqual(p.state.armed, true, 'armed until Auto answers ok');
    same(p.output.want, 'auto');
    none(p.answer(back));
    done(p);
    same(p.output, { active: true, inside: [], rule: null, want: null, error: null });
    none(p.exit('work'));
    none(p.retry());
}

// the baseline the app kept is what Auto goes back to; a forced one is not
{
    const p = makePhone({ device: { supported: SUP, current: BASE, baseline: null } });
    const f = one(p.enter('work'));
    p.device.baseline = BASE;
    p.answer(f);
    p.device.baseline = null;
    const a = one(p.exit('work'));
    same([a.mask, a.autoMask], [BASE, BASE], 'the last read baseline is kept');
    const q = makePhone({ device: { supported: SUP, current: NR_ONLY, baseline: NR_ONLY } });
    same(one(q.enter('work')).autoMask, SUP);
}

// ---------------------------------------------------------------- failures and retry
{
    const p = makePhone();
    none(p.rules([WORK, FAR]));
    const f = one(p.enter('work'));
    none(p.answer(f, false, 'Shizuku is not running'), 'no resend from a failure (no loop)');
    same(p.output, { active: true, inside: ['work'], rule: null, want: 'nr', error: 'Shizuku is not running' });
    same(p.restart(), [], 'start sends nothing');
    const r1 = one(p.retry());
    same([...brief(r1), r1.mask, r1.why], ['nr', 'work', NR_ONLY, 'retry']);
    p.answer(r1, false);
    const r2 = one(p.enter('work'));
    p.answer(r2, false);
    const r3 = one(p.fixAt(10, 20, 20));
    p.answer(r3, false);
    const r4 = one(p.fixAt(0, 0, 5000));
    p.answer(r4);
    same(p.output.error, null);
    same(p.output.rule.mode, 'nr');
    none(p.retry());

    // Auto fails: tried again by retry, a repeated exit and a fix, until it answers ok
    const a1 = one(p.exit('work'));
    none(p.answer(a1, false, 'read back differs'));
    same([p.state.armed, p.output.want, p.output.error, p.output.rule.mode], [true, 'auto', 'read back differs', 'nr']);
    const a2 = one(p.retry());
    p.answer(a2, false);
    const a3 = one(p.exit('work'));
    p.answer(a3, false);
    const a4 = one(p.fixAt(12, 20, 10));
    same([a2.mode, a3.mode, a4.mode], ['auto', 'auto', 'auto']);
    p.answer(a4);
    done(p);
    same(p.output.error, null);
}

// exit while the forced apply is still pending, or failed: ends at Auto
{
    const p = makePhone();
    const f = one(p.enter('work'));
    const a = one(p.exit('work'));
    same(a.mode, 'auto');
    none(p.answer(f), 'the stale force answer');
    same([p.state.want.mode, p.state.armed, p.output.rule.mode], ['auto', true, 'nr'], 'the phone is on NR until Auto answers');
    p.answer(a);
    done(p);
    assert.strictEqual(p.device.current, SUP);

    const q = makePhone();
    const f2 = one(q.enter('work'));
    const a2 = one(q.exit('work'));
    none(q.answer(f2, false), 'the stale failure changes nothing');
    same([q.state.status, q.output.error], ['sent', null]);
    q.answer(a2);
    done(q);

    const r = makePhone();
    r.answer(one(r.enter('work')), false);
    const a3 = one(r.exit('work'));
    same(a3.mode, 'auto');
    r.answer(a3);
    done(r);

    // the Auto answer is lost (the process died): the want is still there for the next event
    const s = atWork();
    one(s.exit('work'));
    same(s.restart(), []);
    s.answer(one(s.retry()));
    done(s);
}

// a force's answer is lost: sent again, and the exit still goes to Auto
{
    const p = makePhone();
    one(p.enter('work'));
    const again = one(p.retry());
    p.answer(again);
    assert.strictEqual(p.state.status, 'done');
    none(p.retry());
}

// ---------------------------------------------------------------- stale and repeated answers
{
    // an old Auto answer after she came back never replaces the newer want
    const p = atWork();
    const a1 = one(p.exit('work'));
    const f2 = one(p.enter('work'));
    none(p.answer(a1));
    same([p.state.want.mode, p.state.status, p.state.armed], ['nr', 'sent', true]);
    p.answer(f2);
    same([p.state.status, p.output.rule.mode], ['done', 'nr']);
    // an old Auto failure likewise
    const a3 = one(p.exit('work'));
    const f4 = one(p.enter('work'));
    none(p.answer(a3, false));
    same([p.state.want.mode, p.output.error], ['nr', null]);
    p.answer(f4);

    // in and out twice before any answer: the first Auto's ok does not end the stay with a force still on the way
    const q = atWork();
    const first = one(q.exit('work'));
    const force = one(q.enter('work'));
    const last = one(q.exit('work'));
    none(q.answer(first));
    same([q.state.armed, q.state.want.mode], [true, 'auto'], 'not settled: a force sent after it is unanswered');
    none(q.answer(force));
    q.answer(last, false);
    same([q.state.armed, q.state.status], [true, 'failed']);
    q.answer(one(q.retry()));
    done(q);

    // the same with the force's answer lost
    const r = atWork();
    const r1 = one(r.exit('work'));
    one(r.enter('work'));
    const r3 = one(r.exit('work'));
    r.answer(r1);
    assert.strictEqual(r.state.armed, true);
    r.answer(r3);
    done(r);

    // answers out of order: the last force went through and the newest Auto failed, then an older Auto's ok comes in.
    // It answers no send still open, so it ends nothing: the phone is still on NR
    const o = atWork();
    const older = one(o.exit('work'));
    const lastForce = one(o.enter('work'));
    const newest = one(o.exit('work'));
    none(o.answer(lastForce));
    none(o.answer(newest, false));
    none(o.radios('radio', { ok: true, mode: 'auto', mask: older.mask, ruleId: '' }));
    same([o.state.armed, o.state.want.mode, o.state.status, o.output.rule.mode], [true, 'auto', 'failed', 'nr']);
    o.answer(one(o.retry()));
    done(o);

    // a force's own ok with a later Auto unanswered is not the end either: Auto, then the force again
    const s = makePhone();
    const s1 = one(s.enter('work'));
    const s2 = one(s.exit('work'));
    const s3 = one(s.enter('work'));
    none(s.answer(s1));
    assert.strictEqual(s.state.status, 'sent');
    s.answer(s2);
    s.answer(s3);
    assert.strictEqual(s.state.status, 'done');

    // a repeated ok of the first Auto cannot confirm anything
    const t = atWork();
    const t1 = one(t.exit('work'));
    t.answer(t1);
    done(t);
    none(t.answer(t1));
    done(t);

    // a force that answers after Auto was confirmed: Auto again
    const u = makePhone();
    const u1 = one(u.enter('work'));
    u.answer(one(u.exit('work')));
    done(u);
    const late = one(u.answer(u1));
    same([late.mode, late.mask, late.why], ['auto', SUP, 'late']);
    assert.strictEqual(u.state.armed, true);
    u.answer(late);
    done(u);
    // ... but never over a mode she set by hand since
    const v = makePhone();
    const v1 = one(v.enter('work'));
    v.answer(one(v.exit('work')));
    v.manual('lte');
    none(v.answer(v1));
    none(v.retry());
    same(v.state.want, null);

    // an Auto that fails after another was taken as done is wanted again, sent by the next event only
    const w = atWork();
    const w1 = one(w.exit('work'));
    const w2 = one(w.retry());
    w.answer(w1);
    done(w);
    none(w.answer(w2, false, 'binder died'));
    same([w.state.armed, w.state.want.mode, w.output.error], [true, 'auto', 'binder died']);
    w.answer(one(w.retry()));
    done(w);

    // an answer with no mode or a made-up one is nothing
    const x = atWork();
    none(x.radios('radio', { ok: true }));
    none(x.radios('radio', { ok: true, mode: '3g' }));
    same(x.state.status, 'done');
}

// ---------------------------------------------------------------- a hand set outside ends the stay
{
    const p = atWork();
    p.answer(one(p.exit('work')), false);
    none(p.manual('nr'), 'she set NR herself, away from the place');
    same([p.state.want, p.state.armed, p.output.want, p.output.error, p.output.rule], [null, false, null, null, null]);
    none(p.retry());
    none(p.exit('work'));
    none(p.rules([]));
    none(p.rules(ALL));
    none(p.fixAt(12, 20, 10));
    // the next stay works as ever
    p.answer(one(p.enter('work')));
    p.answer(one(p.exit('work')));
    done(p);

    // a hand set with no stay at all
    const q = makePhone();
    none(q.manual('lte'));
    none(q.retry());
    done(q);
}

// ---------------------------------------------------------------- overlapping places
{
    const p = makePhone();
    p.answer(one(p.enter('campus')));
    const inner = one(p.enter('work'));
    same(brief(inner), ['nr', 'work']);
    p.answer(inner);
    const out = one(p.exit('work'));
    same([...brief(out), out.mask], ['lte', 'campus', LTE_ONLY], 'leaving the inner one: the outer one');
    p.answer(out);
    p.answer(one(p.enter('work')));
    none(p.exit('campus'), 'leaving the one that does not decide: nothing');
    p.answer(one(p.exit('work')));
    done(p);

    // both in one event; a larger place entered over a hand set applies the winner
    const q = makePhone();
    const both = one(q.enter('campus', 'work'));
    same(brief(both), ['nr', 'work']);
    q.answer(both);
    same(brief(one(q.exit('work', 'campus'))), ['auto', '']);
    const r = atWork();
    r.manual('lte');
    same(brief(one(r.enter('campus'))), ['nr', 'work'], 'a newly entered place applies the winner');

    // two places with the same mode: leaving the winner applies the other
    const s = makePhone();
    s.rules([WORK, Object.assign({}, CAMPUS, { mode: 'nr' })]);
    s.answer(one(s.enter('work', 'campus')));
    same(brief(one(s.exit('work'))), ['nr', 'campus']);

    // an id told as entered and left at once counts as left
    const t = makePhone();
    none(t.enter('gone'));
    none(t.radios('geofence', { enter: ['work'], exit: ['work'] }));
    done(t);
    const u = atWork();
    same(one(u.radios('geofence', { enter: ['work'], exit: ['work'] })).mode, 'auto');
}

// ---------------------------------------------------------------- the rules change while inside
const edit = (id, o) => ALL.map((r) => (r.id === id ? Object.assign({}, r, o) : r));
{
    const p = atWork();
    const changed = one(p.rules(edit('work', { mode: 'lte' })));
    same([...brief(changed), changed.mask, changed.why], ['lte', 'work', LTE_ONLY, 'rules']);
    p.answer(changed);
    none(p.rules(edit('work', { mode: 'lte', name: 'HQ' })), 'a rename');
    same(p.output.rule, { id: 'work', name: 'HQ', mode: 'lte' });
    none(p.rules(edit('work', { mode: 'lte', name: 'HQ' }).map((r) => (r.id === 'far' ? Object.assign({}, r, { mode: 'nr' }) : r))), 'another rule');
    same(brief(one(p.rules(edit('work', { on: false })))), ['auto', ''], 'turned off');

    const q = atWork();
    same(brief(one(q.rules([CAMPUS, FAR]))), ['auto', ''], 'removed');
    same(q.state.inside, []);
    q.answer(one(q.retry()));
    done(q);
    none(q.enter('work'), 'a stale geofence of a removed rule');

    const r = atWork();
    r.manual('lte');
    same(brief(one(r.rules([]))), ['auto', ''], 'removing the place she is in counts as leaving, also after a hand set');

    // armed and already out, Auto failed: a rules save tries again
    const s = atWork();
    s.answer(one(s.exit('work')), false);
    same(brief(one(s.rules([]))), ['auto', '']);

    // not inside anywhere: no save applies anything
    const t = makePhone();
    none(t.rules([]));
    none(t.rules(ALL));

    // a save without a list changes no rule
    const u = atWork();
    none(u.radios('rules', {}));
    same(u.state.rules.length, 3);

    // inside from the app: entered
    const v = makePhone();
    const hinted = one(v.rules(ALL, ['work', 'nope', 'work']));
    same(brief(hinted), ['nr', 'work']);
    same(v.state.inside, ['work']);

    // a moved or shrunk circle: the old membership would never get an exit, so it is left ...
    const moved = atWork();
    same(brief(one(moved.rules(edit('work', { lat: 12 })))), ['auto', '']);
    same(moved.state.inside, []);
    const shrunk = atWork();
    same(brief(one(shrunk.rules(edit('work', { radiusM: 200 })))), ['auto', '']);
    same(brief(one(shrunk.enter('work'))), ['nr', 'work'], 'the new geofence says she is in it: applied again');
    // ... unless the new circle holds the old one, or the app says she is in it
    const grown = atWork();
    none(grown.rules(edit('work', { radiusM: 500 })));
    none(grown.rules(edit('work', { radiusM: 750, lat: 10 + metres(100) })));
    same(grown.state.inside, ['work']);
    const told = atWork();
    none(told.rules(edit('work', { radiusM: 200 }), ['work']));
    same(told.state.inside, ['work']);

    // the list is cleaned: a broken entry is a removed rule
    const bad = atWork();
    same(brief(one(bad.rules(edit('work', { mode: 'auto' })))), ['auto', '']);
}

// ---------------------------------------------------------------- what the phone cannot do is never sent
{
    const p = makePhone({ device: { supported: SUP4G, current: SUP4G, baseline: null } });
    none(p.enter('work'), 'no NR in this phone');
    same(p.output, { active: true, inside: ['work'], rule: null, want: 'nr', error: 'This phone does not support NR only' });
    none(p.retry());
    none(p.enter('work'));
    assert.strictEqual(p.state.armed, true);
    const back = one(p.exit('work'));
    same([back.mode, back.mask], ['auto', SUP4G], 'a wanted mode arms the return to Auto');
    p.answer(back);
    done(p);
    none(p.enter('far'));
    same(p.output.error, 'This phone does not support NR / LTE');
    none(p.enter('campus'), 'the smaller circle still decides, and it cannot be sent');
    const lte = one(p.exit('far'));
    same([...brief(lte), lte.mask], ['lte', 'campus', LTE_ONLY]);
}
{
    const p = makePhone({ device: { supported: SUP4G, current: SUP4G, baseline: null } });
    const lte = one(p.enter('campus'));
    same([...brief(lte), lte.mask], ['lte', 'campus', LTE_ONLY]);
}
{
    // the phone's types not read yet: the want waits, nothing is made up
    const p = makePhone({ device: { supported: null, current: null, baseline: null } });
    none(p.enter('work'));
    same([p.state.want.mode, p.state.armed, p.output.error], ['nr', true, 'The phone\'s network types have not been read yet']);
    none(p.retry());
    p.device = { supported: mask(), current: null, baseline: null };
    none(p.retry(), 'an all-zero supported mask is not a reading');
    p.device = { supported: SUP, current: SUP, baseline: null };
    const f = one(p.retry());
    same([...brief(f), f.mask, f.autoMask], ['nr', 'work', NR_ONLY, SUP]);
    p.answer(f);
    same(p.output.error, null);
    p.device = { supported: null, current: null, baseline: null };
    same(one(p.exit('work')).mask, SUP, 'the last read types are kept');

    // left before they were ever read: Auto with no mask, the host has its kept one
    const q = makePhone({ device: { supported: null, current: null, baseline: BASE } });
    none(q.enter('work'));
    const a = one(q.exit('work'));
    same([a.mode, a.mask, a.autoMask, a.ruleId, a.name], ['auto', '', '', '', '']);
    // an event with no device at all
    const r = makePhone();
    same(r.send('geofence', { enter: ['work'] }).filter((x) => x.op === 'radio')[0].mask, NR_ONLY);
    r.send('geofence', null);
    r.send('rules', { rules: ALL, device: null, inside: 'work' });
    r.send('fix', { device: 'junk' });
    same(r.state.inside, ['work']);
}

// a failed switch that reads back off the old force is not shown as forced
{
    const p = atWork();
    const f = one(p.rules(edit('work', { mode: 'lte' })));
    p.device.current = mask(1, 16);
    p.answer(f, false);
    same(p.output.rule, null);
}

// ---------------------------------------------------------------- the one-shot fix
{
    const at = (m, acc) => [10 + metres(m), 20, acc];
    const only = () => { const p = makePhone(); p.rules([WORK]); return p; };
    const p = only();
    none(p.fixAt(...at(1000, 20)), 'outside, nothing to leave');
    none(p.fixAt(...at(290, 20)), 'neither clearly in nor out');
    none(p.fixAt(...at(0, 1001)), 'too inaccurate');
    none(p.fixAt(10, 20, undefined), 'no accuracy');
    none(p.fixAt(10, 20, -1));
    none(p.fixAt('10', 20, 10));
    none(p.radios('fix', { accuracyM: 10 }));
    same(p.state.inside, []);
    const f = one(p.fixAt(...at(270, 20)));
    same([...brief(f), f.why], ['nr', 'work', 'fix'], 'clearly inside: entered');
    p.answer(f);
    none(p.fixAt(...at(310, 20)), 'on the edge within its accuracy: stays');
    none(p.fixAt(...at(290, 20)));
    none(p.fixAt(...at(5000, 1001)), 'far but inaccurate: ignored');
    none(p.fixAt(10 + metres(5000), 20, undefined));
    same(p.state.inside, ['work']);
    const a = one(p.fixAt(...at(330, 20)));
    same(a.mode, 'auto', 'clearly outside: left');
    p.answer(a);
    done(p);
    // by hand inside, a fix inside keeps it; a fix outside leaves
    const q = only();
    q.answer(one(q.fixAt(...at(0, 10))));
    q.manual('lte');
    none(q.fixAt(...at(0, 10)));
    same(one(q.fixAt(...at(2000, 900))).mode, 'auto', '2000 - 900 is still outside');
    // a rule turned off is never entered by a fix
    const r = makePhone();
    r.rules(edit('work', { on: false }));
    same(brief(one(r.fixAt(10, 20, 10))), ['lte', 'campus']);
    // the missed exit: the fix leaves one place and enters another
    const s = atWork();
    same(brief(one(s.fixAt(11, 20, 15))), ['nrlte', 'far']);
}

// ---------------------------------------------------------------- the state across a restart
{
    const p = atWork();
    same(Object.keys(p.state).sort(), ['armed', 'device', 'error', 'forced', 'inside', 'on', 'open', 'outSig', 'rules', 'status', 'want']);
    const kept = JSON.stringify(p.state);
    same(p.restart(), []);
    same(JSON.stringify(p.state), kept, 'a restart changes nothing');
    const a = one(p.exit('work'));
    same(a.mode, 'auto', 'the exit after a restart');
    p.restart();
    p.answer(a);
    done(p);
    // other tasks' broadcast events are not this task's
    same(p.send('drive', { state: 'driving' }), []);
    same(p.send('car', { connected: true }), []);
    // the open sends stay few however long the host does not answer
    const q = makePhone();
    q.enter('work');
    for (let i = 0; i < 200; i++) q.retry();
    assert.ok(q.state.open.length <= 24);
    q.answer(one(q.exit('work')));
    done(q);
}

// ---------------------------------------------------------------- random sequences
/*
 * A model phone: actions wait in a queue, are carried out in order (ok or not) and answered. Kinds: ordered (answers as
 * sent), lossy (some answers never come), dup (some come twice), reorder (any order). After every event: only sane
 * actions, never over a hand set. At the end, every place left and every waiting action answered ok: the phone is on
 * Auto unless her own hand set after leaving stands.
 */
const RUNS = Number(process.argv[2]) || 300;
const CORE = ['runtime.js', 'drive-alerts.js', 'radio-mode.js'];
const UNIVERSE = [WORK, CAMPUS, FAR, { id: 'cafe', name: 'Cafe', lat: 10 + metres(60), lon: 20, radiusM: 500, mode: 'nr', on: true }];
const IDS = UNIVERSE.map((r) => r.id);
const seen = { forced: 0, late: 0, handIn: 0, handOut: 0, restarts: 0, resent: 0 };

function randomRun(kind, seed) {
    let x = seed >>> 0;
    const rnd = () => { x = (x + 0x6D2B79F5) >>> 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const chance = (c) => rnd() < c;
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const some = (c) => IDS.concat('ghost').filter(() => chance(c));

    const p = makePhone({ files: CORE, start: false });
    const R = () => p.g.CafeTasks.lib.radio;
    const queue = [];
    const answers = [];
    const trace = [];
    let writer = 'start';
    let handOutside = false;
    let guard = null; // after a hand set: { key } of the winner then, until a place is entered or the winner changes
    const keyOf = (s) => { const w = R().winner(s.rules, s.inside); return w ? `${w.id}:${w.mode}` : ''; };

    function dispatch(type, data) {
        const wasInside = p.state ? p.state.inside.slice() : [];
        trace.push([type, data]);
        const acts = type === 'start' ? p.restart() : p.radios(type, data);
        const s = p.state;
        // the state hangs together
        assert.strictEqual(new Set(s.inside).size, s.inside.length);
        s.inside.forEach((id) => assert.ok(s.rules.some((r) => r.id === id && r.on), 'inside only places that are on'));
        const w = R().winner(s.rules, s.inside);
        if (w) assert.ok(s.armed && s.want && s.want.ruleId === w.id && s.want.mode === w.mode, 'inside: the winner is wanted');
        else assert.ok(s.want === null ? !s.armed : s.armed && s.want.mode === 'auto', 'outside: nothing, or Auto while armed');
        assert.ok(s.open.length <= 24);
        assert.ok(acts.length <= 1, 'one write at a time');
        acts.forEach((a) => {
            assert.notStrictEqual(type, 'start');
            assert.notStrictEqual(type, 'manual');
            if (type === 'radio') assert.ok(a.why === 'late' && data.ok && data.mode !== 'auto', 'an answer sends only Auto after a late force');
            if (a.why === 'late') seen.late++;
            if (a.why === 'retry') seen.resent++;
            if (a.mode === 'auto') {
                assert.strictEqual(w, null, 'Auto only outside every place');
                same([a.ruleId, a.name, a.mask, a.autoMask], ['', '', SUP, SUP]);
            } else {
                seen.forced++;
                same([a.ruleId, a.mode, a.mask, a.autoMask], [w.id, w.mode, R().maskFor(w.mode, SUP, null), SUP], 'only the winner\'s mode');
                const bits = parseInt(a.mask, 2);
                assert.ok(bits && (bits & ~parseInt(SUP, 2)) === 0 && (bits & parseInt(mask(13, 20), 2)), 'a mask the app may write');
            }
        });
        if (guard) {
            const entered = s.inside.some((id) => wasInside.indexOf(id) < 0);
            if (!entered && keyOf(s) === guard.key) none(acts, 'never over a hand set');
            else guard = null;
        }
        queue.push(...acts);
    }
    const device = () => ({ supported: SUP, current: p.device.current, baseline: null });
    const event = (type, data) => dispatch(type, Object.assign({ device: device() }, data));
    function execute(ok) {
        const a = queue.shift();
        if (ok) { p.device.current = a.mask; writer = a.mode === 'auto' ? 'auto' : 'force'; }
        answers.push(Object.assign({ ok, mode: a.mode, mask: a.mask, ruleId: a.ruleId, device: device() }, ok ? {} : { error: 'no' }));
    }
    function deliver() {
        const i = kind === 'reorder' ? Math.floor(rnd() * answers.length) : 0;
        const [ans] = answers.splice(i, 1);
        if (kind === 'lossy' && chance(0.25)) return;
        dispatch('radio', ans);
        if (kind === 'dup' && chance(0.25)) dispatch('radio', ans);
    }
    function randomRules() {
        return UNIVERSE.filter(() => chance(0.9)).map((r) => Object.assign({}, r,
            chance(0.2) ? { mode: pick(['nr', 'lte', 'nrlte']) } : {},
            chance(0.1) ? { on: false } : {},
            chance(0.1) ? { radiusM: pick(L.RADII) } : {},
            chance(0.05) ? { lat: r.lat + metres(pick([-800, 800])) } : {},
            chance(0.05) ? { name: 'Renamed' } : {}));
    }

    dispatch('start', {});
    event('rules', { rules: UNIVERSE });
    const steps = 5 + Math.floor(rnd() * 70);
    for (let n = 0; n < steps; n++) {
        const c = rnd();
        if (c < 0.12) event('geofence', { enter: some(0.3), exit: [] });
        else if (c < 0.24) event('geofence', { enter: [], exit: some(0.4) });
        else if (c < 0.27) event('geofence', { enter: some(0.2), exit: some(0.2) });
        else if (c < 0.33) event('rules', Object.assign({ rules: randomRules() }, chance(0.3) ? { inside: some(0.2) } : {}));
        else if (c < 0.39) {
            const at = pick(UNIVERSE);
            event('fix', { lat: at.lat + metres(pick([0, 50, 250, 400, 900, 3000, 20000])), lon: at.lon, accuracyM: pick([5, 40, 300, 2000, undefined]) });
        } else if (c < 0.43) {
            // the app writes in order: what is queued is done before her own write
            while (queue.length) execute(chance(0.75));
            const mode = pick(['auto', 'nr', 'lte', 'nrlte']);
            p.device.current = R().maskFor(mode, SUP, null);
            writer = 'hand';
            handOutside = p.state.inside.length === 0;
            if (handOutside) seen.handOut++; else seen.handIn++;
            guard = null;
            event('manual', { mode });
            guard = { key: keyOf(p.state) };
        } else if (c < 0.51) event('retry', { why: 'screen' });
        else if (c < 0.55) { seen.restarts++; dispatch('start', {}); }
        else if (c < 0.77) { if (queue.length) execute(chance(0.7)); }
        else if (answers.length) deliver();
    }

    // she leaves every place, and every waiting action is answered ok
    const drain = () => {
        let rounds = 0;
        while (queue.length || answers.length) {
            assert.ok(++rounds < 500, 'the sends end');
            while (queue.length) execute(true);
            if (answers.length) dispatch('radio', answers.splice(0, 1)[0]);
        }
    };
    const safe = (when) => {
        if (writer === 'force') assert.fail(`${when}: left on a forced mode\n${JSON.stringify(trace.slice(-14).map(([t, d]) => [t, Object.assign({}, d, { device: undefined, rules: d.rules && d.rules.length })]))}`);
        if (writer === 'hand') assert.ok(handOutside, `${when}: only a hand set made outside may stand`);
    };
    try {
        event('geofence', { enter: [], exit: IDS });
        drain();
        // with answers in order this holds at once; a repeated or reordered one may need the app's next retry
        if (kind === 'ordered' || kind === 'lossy') safe('after leaving');
        event('retry', { why: 'screen' });
        drain();
        safe('after the next retry');
        same([p.state.want, p.state.armed, p.state.inside, p.state.forced], [null, false, [], null], 'the stay is over');
    } catch (e) {
        e.message = `${kind} seed ${seed}: ${e.message}`;
        throw e;
    }
}

for (const kind of ['ordered', 'lossy', 'dup', 'reorder']) {
    for (let seed = 1; seed <= RUNS; seed++) {
        try { randomRun(kind, seed); } catch (e) { if (!e.message.includes(' seed ')) e.message = `${kind} seed ${seed}: ${e.message}`; throw e; }
    }
}
Object.entries(seen).forEach(([k, v]) => assert.ok(v > 0, `the random runs reached ${k}`));

console.log(`radio mode: all checks passed (${RUNS} random runs each of ordered, lossy, dup, reorder; ${JSON.stringify(seen)})`);
