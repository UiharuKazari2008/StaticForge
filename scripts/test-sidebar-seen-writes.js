#!/usr/bin/env node
/**
 * Yozora #998: the desktop Sidebar's own gadgets write the DOM only when a value changed and do not tick
 * while unseen. Runs the functions out of public/scripts/comp/vistaSidebar.js against stub elements:
 *   - the clock keeps the transform string it wrote (style.transform reads back in the browser's shortest
 *     form, so comparing with it never matched) and the hour hand moves in tenths of a degree;
 *   - the CPU Meter writes each dial only when its own whole percent moved, the tooltip only while hovered;
 *   - the Timer places its rings only when a value or radius changed, and unseen wakes only for the next
 *     five-second tick sound or the end;
 *   - Mail / Sidebar Outlook ignore another owner's mailbox push and skip unchanged rows.
 * Run: node scripts/test-sidebar-seen-writes.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/vistaSidebar.js'), 'utf8');
/** `const name = function ...` up to its closing `};` at column 0. */
const fnSource = (name) => {
    const start = src.indexOf(`const ${name} = `);
    assert.ok(start >= 0, `missing ${name}`);
    const end = src.indexOf('\n};\n', start);
    return src.slice(start, end + 3);
};
const load = (names, stubs) => {
    const keys = Object.keys(stubs);
    const body = names.map(fnSource).join('\n') + `\nreturn { ${names.join(', ')} };`;
    return new Function(...keys, body)(...keys.map((k) => stubs[k]));
};

/** An element whose style.transform reads back normalised, as Chrome does ("rotate(12.50deg)" -> "rotate(12.5deg)"). */
function hand() {
    const el = { writes: 0, style: {} };
    let value = '';
    Object.defineProperty(el.style, 'transform', {
        get: () => value,
        set: (v) => { el.writes++; value = String(v).replace(/(\.\d*?)0+deg/g, '$1deg').replace(/\.deg/, 'deg'); }
    });
    return el;
}

// ---- clock -------------------------------------------------------------------------------------
{
    let now = { h: 3, m: 20, s: 0 };
    const timers = [];
    const stubs = {
        vsb: { seen: () => true },
        vsbZoneTime: () => ({ ...now }),
        vsbPad2: (n) => String(n).padStart(2, '0'),
        setTimeout: (fn, ms) => { timers.push(ms); return timers.length; },
        clearTimeout: () => {}
    };
    const { vsbClockTick } = load(['vsbClockTick'], stubs);
    const parts = { h: hand(), m: hand(), s: hand(), face: { title: '' } };
    const inst = { destroyed: false, parts, g: { settings: { seconds: true, name: '', timeZone: '' } } };
    vsbClockTick(inst);
    assert.strictEqual(parts.h.writes, 1);
    assert.strictEqual(parts.h.style.transform, 'rotate(100deg)', '3:20:00 is 100 deg');
    vsbClockTick(inst);
    assert.deepStrictEqual([parts.h.writes, parts.m.writes, parts.s.writes], [1, 1, 1], 'the same second again writes nothing (readback is normalised)');
    for (let s = 1; s <= 24; s++) {
        now = { h: 3, m: 20, s };
        vsbClockTick(inst);
    }
    assert.ok(parts.h.writes <= 3, `hour hand written about every 12 s (${parts.h.writes} in 25 s)`);
    assert.strictEqual(parts.m.writes, 25, 'minute hand unchanged: once a second');
    assert.strictEqual(parts.s.writes, 25, 'second hand once a second');
    const deg = parseFloat(parts.h.style.transform.slice(7));
    const exact = (3 * 3600 + 20 * 60 + 24) / 120;
    assert.ok(Math.abs(deg - exact) <= 0.05 + 1e-9, `hour hand within 0.05 deg (${deg} vs ${exact})`);
    const before = parts.h.writes + parts.m.writes + parts.s.writes;
    stubs.vsb.seen = () => false;
    now = { h: 3, m: 21, s: 0 };
    const armed = timers.length;
    vsbClockTick(inst);
    assert.strictEqual(parts.h.writes + parts.m.writes + parts.s.writes, before, 'unseen: nothing drawn');
    assert.strictEqual(timers.length, armed, 'unseen: no timer');
}

// ---- CPU Meter -------------------------------------------------------------------------------------
{
    const textNode = () => {
        const node = { nodeType: 3, nextSibling: null, _d: '', get data() { return this._d; }, set data(v) { el.writes++; this._d = v; } };
        const el = { writes: 0, firstChild: node, classes: new Set(), get textContent() { return node._d; } };
        el.classList = { contains: (c) => el.classes.has(c), toggle: (c, on) => { el.writes++; if (on) el.classes.add(c); else el.classes.delete(c); } };
        return el;
    };
    const { vsbSetText, vsbCpuPaint } = load(['vsbSetText', 'vsbCpuPaint'], { vsbPad2: (n) => String(n).padStart(2, '0') });
    void vsbSetText;
    const cpuDial = hand(); cpuDial.src = '/dial.png';
    const ramDial = hand(); ramDial.src = '/dial_sml.png';
    let titleWrites = 0; let title = '';
    const cpuBox = { get title() { return title; }, set title(v) { titleWrites++; title = v; } };
    const inst = { parts: { cpu: cpuBox, cpuDial, ramDial, cpuText: textNode(), ramText: textNode() }, metrics: { cpu: 10.2, ram: 40.1 } };
    vsbCpuPaint(inst);
    assert.deepStrictEqual([cpuDial.writes, ramDial.writes], [1, 1]);
    assert.strictEqual(cpuDial.style.transform, `rotate(${10.2 * 2.5 - 125}deg)`.replace(/(\.\d*?)0+deg/, '$1deg'), 'raw value as before');
    inst.metrics = { cpu: 11.4, ram: 40.3 };
    vsbCpuPaint(inst);
    assert.deepStrictEqual([cpuDial.writes, ramDial.writes], [2, 1], 'only the dial whose whole percent moved');
    assert.strictEqual(titleWrites, 0, 'no tooltip write while the pointer is away');
    inst.cpuHover = true;
    vsbCpuPaint(inst);
    assert.strictEqual(title, 'CPU usage: 11%\nMemory usage: 40%', 'same tooltip text on hover');
    vsbCpuPaint(inst);
    assert.strictEqual(titleWrites, 1, 'tooltip unchanged: not rewritten');
    inst.metrics = { cpu: 100, ram: 40.3 };
    vsbCpuPaint(inst);
    assert.ok(inst.parts.cpuText.classes.has('is-full'));
    const w = inst.parts.ramText.writes;
    vsbCpuPaint(inst);
    assert.strictEqual(inst.parts.ramText.writes, w, 'is-full not toggled again');
}

// ---- Timer ---------------------------------------------------------------------------------------
{
    let nowMs = 1_000_000;
    const armed = [];
    const sounds = [];
    let seen = true;
    const stubs = {
        vsb: { seen: () => seen },
        vsbPad2: (n) => String(n).padStart(2, '0'),
        vsbSetText: (el, t) => { if (el.text !== t) { el.text = t; el.writes = (el.writes || 0) + 1; } },
        vsbTimerSound: (_inst, name) => sounds.push([name, nowMs]),
        vsbQueueSave: () => {},
        setTimeout: (fn, ms) => { armed.push({ fn, ms }); return armed.length; },
        clearTimeout: () => {},
        Date: { now: () => nowMs }
    };
    const t = load(['vsbTimerPlace', 'vsbTimerPaint', 'vsbTimerArm', 'vsbTimerTick'], stubs);
    const num = (deg) => { const n = hand(); n.dataset = { deg: String(deg), radius: '22px' }; return n; };
    const ring = (count) => { const nums = Array.from({ length: count }, (_, i) => num(180 + i * 30)); return { nums, querySelectorAll: () => nums }; };
    const root = { title: '', classList: { contains: () => false, toggle: () => { throw new Error('no ringing yet'); } } };
    const inst = { destroyed: false, g: { docked: true, settings: { endAt: nowMs + 23_000, mins: 0, secs: 23, ringing: false } }, parts: { secs: ring(12), mins: ring(12), readout: {}, root } };
    t.vsbTimerPaint(inst);
    const writes = () => inst.parts.secs.nums[0].writes + inst.parts.mins.nums[0].writes;
    const w0 = writes();
    t.vsbTimerPaint(inst);
    assert.strictEqual(writes(), w0, 'same moment: no ring writes');
    nowMs += 100;
    t.vsbTimerPaint(inst);
    assert.strictEqual(inst.parts.secs.nums[0].writes, 2, 'seconds ring turns every tick');
    assert.strictEqual(inst.parts.mins.nums[0].writes, 1, 'minutes ring by whole seconds');
    // unseen: one wake for the next five-second tick (20), then 15, 10, 5, then the end
    seen = false;
    inst.lastSec = 23;
    armed.length = 0;
    t.vsbTimerArm(inst);
    const left0 = (inst.g.settings.endAt - nowMs) / 1000;
    assert.ok(Math.abs(armed[0].ms - ((left0 - 20) * 1000 + 15)) <= 1, `wakes at 20 s left (${armed[0].ms} ms)`);
    for (const expect of [20, 15, 10, 5]) {
        const next = armed.shift();
        nowMs += next.ms;
        next.fn();
        assert.deepStrictEqual(sounds[sounds.length - 1][0], 'tick', `tick at ${expect}`);
        assert.strictEqual(Math.ceil((inst.g.settings.endAt - nowMs) / 1000), expect);
    }
    const paintsUnseen = writes();
    const last = armed.shift();
    nowMs += last.ms;
    root.classList.toggle = () => {};
    last.fn();
    assert.strictEqual(sounds[sounds.length - 1][0], 'done', 'the alarm on time while unseen');
    assert.ok(nowMs - inst.g.settings.endAt <= 0 || inst.g.settings.endAt === 0, 'ended');
    assert.strictEqual(sounds.filter((x) => x[0] === 'tick').length, 4, 'four tick sounds, as with the 100 ms tick');
    assert.strictEqual(writes(), paintsUnseen, 'nothing painted while unseen');
}

// ---- Mail push owners ------------------------------------------------------------------------------
{
    let paints = 0;
    const { vsbMailApplyPush } = load(['vsbMailApplyPush'], { DESKTOP_DOVECOTE_HUMAN_OWNER: 'yukimi' });
    const inst = { g: { settings: {} }, paint: () => { paints++; } };
    assert.strictEqual(vsbMailApplyPush(inst, { owners: ['wren'], mailboxes: [{ owner: 'yukimi', unread: 1 }], inbox: {} }), true, 'another owner: handled, no fetch');
    assert.strictEqual(paints, 0, 'another owner: no repaint');
    assert.strictEqual(vsbMailApplyPush(inst, { owners: ['yukimi'], mailboxes: [{ owner: 'yukimi', unread: 1 }], inbox: { yukimi: [{ id: 1 }] } }), true);
    assert.strictEqual(paints, 1, 'own mailbox: painted');
}

console.log('test-sidebar-seen-writes: ok');
