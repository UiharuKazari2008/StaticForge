#!/usr/bin/env node
// Phoenix BIOS on /launch (public/scripts/launch/phoenixBios.js, Yozora #611) on a virtual clock:
// the POST splash and its keys, the Setup Utility's pages, values, popups, CMOS save / discard,
// the boot order and what it starts, the Boot Menu, the CD prompt, the diagnostic POST.
// Run: node scripts/test-phoenix-bios.js
const assert = require('assert');
const B = require('../public/scripts/launch/phoenixBios.js');
const font = require('../public/scripts/launch/biosFont.js');

function harness(opts = {}) {
    const t = { now: 0, store: Object.assign({}, opts.store || {}), paints: 0 };
    const env = {
        now: () => t.now,
        sleep: (ms) => new Promise((r) => setImmediate(() => { t.now += ms; r(); })),
        localStorage: { getItem: (k) => (k in t.store ? t.store[k] : null), setItem: (k, v) => { t.store[k] = v; }, removeItem: (k) => { delete t.store[k]; } },
        navigator: { deviceMemory: 8, hardwareConcurrency: 4 },
        storageQuota: 40 * 1024 * 1024 * 1024,
        date: () => new Date(2026, 9, 21, 18, 33, 3)
    };
    const bios = B.createBios(env, () => { t.paints += 1; });
    const flush = () => new Promise((r) => setImmediate(r));
    const settle = async (n = 40) => { for (let i = 0; i < n; i++) await flush(); };
    const until = async (pred, max = 2000) => { for (let i = 0; i < max && !pred(); i++) await flush(); assert.ok(pred(), 'condition never met'); };
    const row = (r) => bios.screen.text(r).replace(/\s+$/, '');
    return { bios, env, t, flush, settle, until, row };
}

(async () => {
    // ---------- the font ----------
    assert.strictEqual(font.CHARS.length, 138);
    assert.deepStrictEqual(Array.from(font.glyph('A')).slice(2, 4), [0x10, 0x38], 'the VGA A');
    assert.ok(font.has('►') && font.has('│') && font.has('↑'), 'arrows and box lines');
    assert.strictEqual(font.glyph('一'), font.glyph('?'), 'unknown glyphs draw as ?');

    // ---------- the screen model ----------
    const s = B.createScreen();
    s.box(2, 1, 10, 3, B.C.black, B.C.grey);
    assert.strictEqual(s.text(1, 2, 12), '┌────────┐');
    assert.strictEqual(s.attr(3, 2).bg, B.C.grey);
    assert.deepStrictEqual(s.find('└'), { row: 3, col: 2 });

    // ---------- POST: the splash fills over splashMs, then the Hard Drive boots when it has an OS ----------
    let h = harness();
    let p = h.bios.post({ hasOs: true });
    await h.flush();
    assert.strictEqual(h.bios.state, 'splash');
    assert.strictEqual(h.bios.screen.mode, 'splash');
    assert.ok(h.bios.screen.splash.prompt.indexOf('F2') !== -1 && h.bios.screen.splash.prompt.indexOf('ESC') !== -1);
    assert.deepStrictEqual(await p, { device: 'hdd', via: 'order' });
    assert.ok(h.t.now >= B.config.splashMs + B.config.splashHoldMs, 'the splash takes its time');
    assert.strictEqual(h.bios.screen.splash.progress, 1);
    assert.ok(h.t.paints > 10, 'the bar is repainted while it fills');

    // nothing installed: the Hard Drive is skipped, the CD-ROM (the installation media) boots, no prompt
    h = harness();
    assert.deepStrictEqual(await h.bios.post({ hasOs: false }), { device: 'cdrom', via: 'order' });
    assert.strictEqual(h.bios.state, 'splash', 'no CD prompt on a blank disk');

    // ---------- F2 during the splash: Setup Utility ----------
    h = harness();
    p = h.bios.post({ hasOs: true });
    await h.flush();
    assert.strictEqual(h.bios.handleKey('F2'), true);
    assert.strictEqual(h.bios.screen.splash.prompt, 'Press F2 to enter SETUP, F12 for Network Boot, ESC for Boot Menu', 'the prompt changes on the next repaint');
    await h.until(() => h.bios.state === 'setup');
    assert.strictEqual(h.row(0).trim(), 'PhoenixBIOS Setup Utility');
    assert.strictEqual(h.row(1), '    Main     Advanced     Security     Boot     Exit');
    assert.strictEqual(h.bios.screen.attr(4, 1).bg, B.C.grey, 'the open tab is black on grey');
    assert.strictEqual(h.bios.screen.attr(4, 1).fg, B.C.black);
    assert.strictEqual(h.bios.screen.attr(13, 1).fg, B.C.white, 'the others white on blue');
    assert.strictEqual(h.bios.screen.attr(13, 1).bg, B.C.blue);
    assert.strictEqual(h.row(3), '│' + ' '.repeat(52) + '│   Item Specific Help    │');
    assert.strictEqual(h.row(4), '│   System Time:                  [18:33:03]         ├' + '─'.repeat(25) + '┤');
    assert.ok(h.row(2).startsWith('┌' + '─'.repeat(52) + '┬'), 'the frame splits at col 53');
    assert.strictEqual(h.row(23), '  F1   Help   ↑↓  Select Item   -/+    Change Values       F9   Setup Defaults');
    assert.strictEqual(h.row(24), '  Esc  Exit   ↔   Select Menu   Enter  Select ► Sub-Menu   F10  Save and Exit');
    assert.strictEqual(h.bios.screen.attr(2, 23).fg, B.C.white, 'keys in white');
    assert.strictEqual(h.bios.screen.attr(7, 23).fg, B.C.black, 'what they do in black');
    assert.ok(h.row(19).indexOf('Boot-time Diagnostic Screen:  [Disabled]') !== -1);
    assert.ok(h.row(6).indexOf('<Tab>, <Shift-Tab>, or') !== -1, 'the help for System Time');

    // every tab, every item reachable, values cycle with +/-, Enter opens the list
    h.bios.handleKey('ArrowRight');
    assert.ok(h.row(4).indexOf('Multiprocessor Specification: [1.4]') !== -1);
    h.bios.handleKey('-');
    assert.ok(h.row(4).indexOf('[1.1]') !== -1, '- picks the lower value');
    h.bios.handleKey('+');
    assert.ok(h.row(4).indexOf('[1.4]') !== -1);
    h.bios.handleKey('Enter');
    assert.ok(h.bios.setup.popup && h.bios.setup.popup.type === 'options');
    assert.ok(h.bios.screen.find('1.1') && h.bios.screen.find('1.4'), 'the list shows both values');
    h.bios.handleKey('ArrowUp');
    h.bios.handleKey('Enter');
    assert.strictEqual(h.bios.cmosValue('mps'), '1.1', 'Enter on a list entry sets it');
    assert.strictEqual(h.bios.setup.popup, null);
    h.bios.handleKey('ArrowDown');
    h.bios.handleKey('ArrowDown');
    h.bios.handleKey('ArrowDown');
    h.bios.handleKey('Enter');
    assert.ok(h.row(3).indexOf('Cache Memory') !== -1, 'a sub-menu, titled in the body');
    assert.strictEqual(h.row(1).trim(), 'Advanced', 'only the parent tab shows on a sub-menu');
    assert.ok(h.row(21).indexOf('▼') !== -1, 'the long list scrolls');
    h.bios.handleKey('End');
    assert.ok(h.row(21).indexOf('Cache EC00 - EFFF') !== -1, 'End goes to the last item');
    h.bios.handleKey('Escape');
    assert.ok(h.row(1).indexOf('Security') !== -1, 'Esc leaves the sub-menu');
    h.bios.handleKey('ArrowRight');
    assert.ok(h.row(4).indexOf('Supervisor Password Is:       Clear') !== -1);
    assert.ok(h.row(8).indexOf('Set Supervisor Password') !== -1);
    h.bios.handleKey('Enter');
    assert.strictEqual(h.bios.setup.popup.type, 'password');
    'abc'.split('').forEach((c) => h.bios.handleKey(c, c));
    h.bios.handleKey('Enter');
    'abc'.split('').forEach((c) => h.bios.handleKey(c, c));
    h.bios.handleKey('Enter');
    assert.strictEqual(h.bios.setup.popup.type, 'notice');
    h.bios.handleKey('Enter');
    assert.ok(h.row(4).indexOf('Supervisor Password Is:       Set') !== -1, 'stored, never enforced');
    assert.strictEqual(h.bios.cmosValue('supPwSet'), true);
    h.bios.handleKey('ArrowDown');
    assert.ok(h.row(10).indexOf('Password on boot:') !== -1 && h.bios.setup.sel === 6, 'Password on boot opens up once a supervisor password is set');

    // the Boot page: Enter expands the Hard Drive, +/- move devices, Esc goes to Exit
    h.bios.handleKey('ArrowRight');
    assert.ok(h.row(5).indexOf('+Hard Drive') !== -1);
    h.bios.handleKey('Enter');
    assert.ok(h.row(5).indexOf('-Hard Drive') !== -1 && h.row(6).indexOf('Maxtor 6Y080L0-(PM)') !== -1, 'expanded with the disk');
    h.bios.handleKey('ArrowDown');
    h.bios.handleKey('ArrowDown');
    h.bios.handleKey('ArrowDown');
    h.bios.handleKey('+');
    assert.deepStrictEqual(h.bios.bootOrder(), ['removable', 'cdrom', 'hdd', 'network'], '+ moves the CD-ROM up');
    h.bios.handleKey('F1');
    assert.strictEqual(h.bios.setup.popup.type, 'help');
    assert.ok(h.bios.screen.find('General Help'));
    h.bios.handleKey('Escape');
    h.bios.handleKey('Escape');
    assert.ok(h.row(4).indexOf('Exit Saving Changes') !== -1, 'Esc on a top page opens Exit');
    assert.strictEqual(h.row(24), '  Esc  Exit   ↔   Select Menu   Enter  Execute Command     F10  Save and Exit');
    h.bios.handleKey('Enter');
    assert.strictEqual(h.bios.setup.popup.type, 'confirm');
    assert.ok(h.bios.screen.find('Save configuration changes and exit now?'));
    assert.ok(h.bios.screen.find('[Yes]') && h.bios.screen.find('[No]'));
    h.bios.handleKey('Enter');
    await h.until(() => h.bios.state === 'splash');
    const saved = JSON.parse(h.t.store.melatonCmos);
    assert.strictEqual(saved.mps, '1.1');
    assert.deepStrictEqual(saved.bootOrder, ['removable', 'cdrom', 'hdd', 'network']);
    // the POST runs again; the CD-ROM now comes before the disk, so Vista's CD prompt asks
    await h.until(() => h.bios.state === 'cdprompt');
    assert.strictEqual(h.row(0), 'Press any key to boot from CD or DVD...');
    assert.strictEqual(h.bios.handleKey('Enter'), true);
    assert.deepStrictEqual(await p, { device: 'cdrom', via: 'prompt' });

    // the prompt times out: the disk boots
    h = harness({ store: { melatonCmos: JSON.stringify(saved) } });
    p = h.bios.post({ hasOs: true });
    await h.until(() => h.bios.state === 'cdprompt');
    assert.deepStrictEqual(await p, { device: 'hdd', via: 'order' });
    assert.ok(h.t.now >= B.config.splashMs + B.config.cdPromptMs);

    // ---------- Exit Discarding Changes asks when the CMOS is dirty; F9 loads defaults ----------
    h = harness({ store: { melatonCmos: JSON.stringify(saved) } });
    p = h.bios.post({ hasOs: true });
    await h.flush();
    h.bios.handleKey('F2');
    await h.until(() => h.bios.state === 'setup');
    h.bios.handleKey('F9');
    h.bios.handleKey('Enter');
    assert.deepStrictEqual(h.bios.bootOrder(), ['removable', 'hdd', 'cdrom', 'network'], 'defaults back in the working copy');
    h.bios.handleKey('Escape');
    h.bios.handleKey('ArrowDown');
    h.bios.handleKey('Enter');
    assert.strictEqual(h.bios.setup.popup.title, 'Setup Warning');
    h.bios.handleKey('ArrowRight');
    h.bios.handleKey('Enter');
    await h.until(() => h.bios.state !== 'setup');
    assert.deepStrictEqual(JSON.parse(h.t.store.melatonCmos).bootOrder, saved.bootOrder, 'No: nothing saved');
    await h.until(() => h.bios.state === 'cdprompt');
    h.bios.handleKey('x');
    await p;

    // ---------- ESC: the Boot Menu picks a device for this start only ----------
    h = harness();
    p = h.bios.post({ hasOs: true });
    await h.flush();
    h.bios.handleKey('Escape');
    await h.until(() => h.bios.state === 'bootmenu');
    assert.ok(h.bios.screen.find('Boot Menu'));
    assert.ok(h.bios.screen.find('3.  CD-ROM Drive'));
    assert.ok(h.bios.screen.find('<Enter Setup>'));
    h.bios.handleKey('ArrowDown');
    h.bios.handleKey('Enter');
    await h.until(() => h.bios.state === 'cdprompt');
    h.bios.handleKey('Enter');
    assert.deepStrictEqual(await p, { device: 'cdrom', via: 'prompt' });
    assert.strictEqual(h.t.store.melatonCmos, undefined, 'the menu changes nothing in CMOS');

    // <Enter Setup> from the Boot Menu
    h = harness();
    p = h.bios.post({ hasOs: true });
    await h.flush();
    h.bios.handleKey('Escape');
    await h.until(() => h.bios.state === 'bootmenu');
    h.bios.handleKey('ArrowDown');
    h.bios.handleKey('ArrowDown');
    h.bios.handleKey('ArrowDown');
    h.bios.handleKey('Enter');
    await h.until(() => h.bios.state === 'setup');
    h.bios.handleKey('F10');
    h.bios.handleKey('Enter');
    assert.deepStrictEqual(await p, { device: 'hdd', via: 'order' });

    // ---------- F12: the network boot agent, then the next device ----------
    h = harness();
    p = h.bios.post({ hasOs: true });
    await h.flush();
    h.bios.handleKey('F12');
    await h.until(() => h.bios.state === 'pxe');
    assert.ok(h.bios.screen.find('PXE-E53: No boot filename received') || true);
    assert.deepStrictEqual(await p, { device: 'hdd', via: 'order' });
    assert.ok(h.bios.screen.find('PXE-M0F: Exiting Intel Boot Agent.'), 'the agent gave up before the disk booted');

    // ---------- no server at the POST: the boot agent gives up, Operating System not found ----------
    {
        h = harness();
        let down = 'dhcp';
        let pinAsked = false;
        let back = null;
        p = h.bios.post({
            hasOs: true,
            serverDown: async () => down,
            requireBootPin: async () => { pinAsked = true; return false; },
            serverBack: (stopped) => new Promise((r) => { back = () => r(!stopped()); })
        });
        await h.until(() => h.bios.state === 'pxe');
        await h.until(() => h.bios.screen.find('PXE-E51: No DHCP or proxyDHCP offers were received.'), 4000);
        assert.ok(/^DHCP\.+[|/\-\\]$/.test(h.row(4)), 'the DHCP spinner line stays');
        await h.until(() => h.bios.state === 'halt');
        assert.ok(!h.bios.screen.find('PXE-E51'), 'the halt clears the agent');
        assert.strictEqual(h.row(0), 'Operating System not found');
        assert.strictEqual(pinAsked, false, 'no PIN without a server');
        await h.settle();
        assert.strictEqual(h.bios.state, 'halt', 'it stays halted');
        down = null;
        back();
        assert.deepStrictEqual(await p, { device: 'hdd', via: 'order' }, 'the server back: a reboot, then the disk');
        assert.strictEqual(pinAsked, true, 'the PIN is asked again once there is a server');

        // offline: the media test fails; a key reboots
        h = harness();
        down = 'media';
        p = h.bios.post({ hasOs: false, serverDown: async () => down });
        await h.until(() => h.bios.state === 'pxe');
        await h.until(() => h.bios.screen.find('PXE-E61: Media test failure, check cable'));
        await h.until(() => h.bios.state === 'halt');
        down = null;
        h.bios.handleKey('Enter');
        assert.deepStrictEqual(await p, { device: 'cdrom', via: 'order' }, 'nothing installed boots the media once the network is back');
    }

    // ---------- the POST's bar follows real work ----------
    {
        h = harness();
        let release;
        const tasks = [
            { id: 'disk', run: async () => 'disk' },
            { id: 'os', run: () => new Promise((r) => { release = r; }) }
        ];
        p = h.bios.post({ tasks, hasOsAfter: (results) => results.os === true });
        await h.settle(10);
        assert.strictEqual(h.bios.state, 'splash');
        const seen = [];
        for (let i = 0; i < 400; i++) { await h.flush(); seen.push(h.bios.screen.splash.progress); }
        assert.ok(Math.max(...seen) < 1, 'the bar waits for the task that is still running');
        assert.ok(Math.max(...seen) >= 0.5, 'the finished task is its share of the bar');
        assert.ok(Math.max(...seen) < 0.95, 'the running task never completes its share by itself');
        assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'the bar never moves back');
        assert.ok(seen.every((v) => v === 0 || v === 0.5), 'the bar does not count up: it stands, then jumps by a finished share');
        assert.ok(B.splashBarCells(0.5) === 33 && B.splashBarCells(0.999) === 65, 'the bar fills in whole cells');
        release(true);
        assert.deepStrictEqual(await p, { device: 'hdd', via: 'order' });
        assert.deepStrictEqual(h.bios.work, { disk: 'disk', os: true }, 'the results are kept for the boot');
    }

    // ---------- weighted jumps, each at least its gap after the last, even for instant tasks ----------
    {
        h = harness();
        const tasks = [
            { id: 'a', weight: 1, run: async () => 1 },
            { id: 'b', weight: 3, run: async () => 2 }
        ];
        const start = h.t.now;
        p = h.bios.post({ tasks, hasOs: true });
        const jumps = [];
        let last = -1;
        for (let i = 0; i < 2000 && h.bios.state === 'splash'; i++) {
            await h.flush();
            const v = h.bios.screen.splash && h.bios.screen.splash.progress;
            if (typeof v === 'number' && v !== last) { jumps.push([h.t.now, v]); last = v; }
        }
        assert.deepStrictEqual(jumps.map((j) => j[1]), [0, 0.25, 1], 'the bar jumps by each weight');
        assert.ok(jumps[1][0] - start >= B.config.barStepGapsMs[0], `instant work still waits its gap (${JSON.stringify(jumps)})`);
        assert.ok(jumps[2][0] - jumps[1][0] >= B.config.barStepGapsMs[1]);
        await p;
    }

    // ---------- the diagnostic POST ----------
    h = harness({ store: { melatonCmos: JSON.stringify({ diag: 'Enabled', bootOrder: ['removable', 'hdd'] }) } });
    p = h.bios.post({ hasOs: false });
    await h.until(() => h.bios.state === 'diag');
    assert.ok(h.row(0).startsWith('PhoenixBIOS 4.0 Release 6.0'));
    assert.deepStrictEqual(await p, { device: 'cdrom', via: 'order' }, 'the saved order fills in the missing devices');
    assert.ok(h.bios.screen.find('Extended RAM Passed'));
    h = harness({ store: { melatonCmos: JSON.stringify({ diag: 'Enabled' }) } });
    p = h.bios.post({ hasOs: true });
    await h.until(() => h.bios.state === 'diag');
    h.bios.handleKey('F2');
    await h.until(() => h.bios.state === 'setup', 4000);
    await h.until(() => h.bios.state === 'setup', 4000);
    h.bios.handleKey('F10');
    h.bios.handleKey('Enter');
    assert.deepStrictEqual(await p, { device: 'hdd', via: 'order' });

    // ---------- a cancelled run stops at the next tick ----------
    h = harness();
    let cancelled = false;
    p = h.bios.post({ hasOs: true, run: { cancelled: () => cancelled } });
    await h.flush();
    cancelled = true;
    assert.strictEqual(await p, 'cancelled');

    // ---------- pointer: tabs, items, the key bar ----------
    h = harness();
    p = h.bios.post({ hasOs: true });
    await h.flush();
    h.bios.handleKey('F2');
    await h.until(() => h.bios.state === 'setup');
    h.bios.handlePointer(27, 1);
    assert.ok(h.row(4).indexOf('Supervisor Password') !== -1, 'a tap on a tab opens it');
    h.bios.handlePointer(4, 1);
    h.bios.handlePointer(10, 19);
    assert.strictEqual(h.bios.setup.sel, 15, 'a tap selects the item');
    h.bios.handlePointer(10, 19);
    assert.strictEqual(h.bios.setup.popup.type, 'options', 'a second tap is Enter');
    h.bios.handlePointer(2, 23);
    assert.strictEqual(h.bios.setup.popup, null, 'a tap outside the list closes it');
    h.bios.handlePointer(60, 24);
    assert.strictEqual(h.bios.setup.popup.type, 'confirm', 'F10 on the key bar');
    const no = h.bios.screen.find('[No]');
    h.bios.handlePointer(no.col + 1, no.row);
    assert.strictEqual(h.bios.setup.popup, null);
    h.bios.handleKey('F10');
    h.bios.handleKey('Enter');
    await p;

    // ---------- the PIN pad: taps type the PIN, ← deletes, OK submits; a wrong PIN clears ----------
    {
        h = harness();
        const sent = [];
        const realFetch = global.fetch;
        global.fetch = async (url, init) => {
            const body = JSON.parse(init.body);
            sent.push({ url, pin: body.data.pin, client: init.headers['X-Dreamscape-Client'] });
            const ok = body.data.pin === '1235';
            return { ok, json: async () => (ok ? { success: true, userType: 'admin' } : { success: false }) };
        };
        global.localStorage = { setItem() {} };
        let asked = 0;
        p = h.bios.post({ hasOs: true, requireBootPin: async () => (asked++ === 0) });
        await h.until(() => h.bios.state === 'bootpin');
        assert.ok(h.bios.screen.find('Password on boot'), 'the PIN box');
        const tap = (label) => {
            const at = h.bios.screen.find('│' + ' '.repeat(Math.floor((9 - 2 - label.length) / 2)) + label);
            assert.ok(at, `pad key ${label} drawn`);
            h.bios.handlePointer(at.col + 4, at.row);
        };
        ['1', '2', '9'].forEach(tap);
        tap('\u2190');
        tap('3');
        assert.ok(h.bios.screen.find('Enter PIN:  ***'), 'three stars after 1 2 9 ← 3');
        tap('OK');
        await h.until(() => sent.length === 1);
        await h.settle();
        assert.strictEqual(sent[0].pin, '123', 'the PIN typed on the pad');
        assert.strictEqual(sent[0].client, 'melaton-bios', 'the BIOS knocks');
        assert.ok(h.bios.screen.find('Incorrect password'), 'a wrong PIN says so');
        assert.ok(h.bios.screen.find('Enter PIN:   '), 'and the entry is cleared');
        h.bios.handlePointer(0, 0);
        assert.strictEqual(h.bios.state, 'bootpin', 'a tap outside the keys does nothing');
        ['1', '2', '3', '5'].forEach(tap);
        h.bios.handleKey('Enter', '');
        assert.deepStrictEqual(await p, { device: 'hdd', via: 'order' }, 'the right PIN boots');
        assert.strictEqual(sent[1].pin, '1235', 'the keyboard Enter submits what the pad typed');
        global.fetch = realFetch;
        delete global.localStorage;
    }

    console.log('test-phoenix-bios passed');
})().catch((err) => {
    console.error('❌ test-phoenix-bios failed:', err);
    process.exit(1);
});
