#!/usr/bin/env node
'use strict';
// 5555 back over Wireless debugging from the server (Yozora #1309 / #1312): modules/deviceAdb.js, opt-in per phone
// (settings tlsRestore, with autoRestore). No phone is touched: `adb` is a fake script that plays a phone whose 5555 is
// closed but whose Wireless debugging door is open, and a second device on the LAN that must never be dialled.
//   node scripts/test-device-adb-tls.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'device-adb-tls-'));
const log = path.join(tmp, 'adb.log');
const up = path.join(tmp, '5555.up');
const fake = path.join(tmp, 'adb');
// the phone: 192.168.100.225, TLS port 41311, model SM-F966U; another phone on the LAN: 192.168.100.99:40001 (wrong address)
fs.writeFileSync(fake, `#!/bin/bash
echo "$*" >> '${log}'
if [ "$1" = -s ]; then serial=$2; shift 2; fi
case "$1" in
  mdns) printf 'List of discovered mdns services\\nadb-RFCYXXXX-abc\\t_adb-tls-connect._tcp.\\t192.168.100.225:41311\\nadb-OTHER-def\\t_adb-tls-connect._tcp.\\t192.168.100.99:40001\\nadb-RFCYXXXX-abc\\t_adb-tls-pairing._tcp.\\t192.168.100.225:39999\\n';;
  connect) echo "connected to $2";;
  disconnect) echo "disconnected $2";;
  get-state)
    case "$serial" in
      192.168.100.225:41311) echo device;;
      192.168.100.225:5555) if [ -f '${up}' ]; then echo device; else echo "error: cannot connect" >&2; exit 1; fi;;
      *) echo "error: device '$serial' not found" >&2; exit 1;;
    esac;;
  shell) echo "\${FAKE_MODEL:-SM-F966U}";;
  tcpip) touch '${up}'; echo "restarting in TCP mode port: $2";;
  *) echo "unknown $*" >&2; exit 1;;
esac
`, { mode: 0o755 });
process.env.DREAMSCAPE_ADB = fake;

const gr = { getPath: () => tmp, getWebSocketServer: () => null };
const activeSync = require('../modules/activeSync');
const adbMod = require('../modules/deviceAdb');
activeSync.deviceAddresses = () => ['192.168.100.225'];
activeSync.deviceRow = () => ({ model: 'SM-F966U' });
activeSync.touchDevice = () => {};

const logs = [];
const realLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };
const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
const reset = () => { for (const f of [log, up, path.join(tmp, 'device-adb.json')]) { try { fs.unlinkSync(f); } catch (_) { /* none */ } } adbMod.resetForTests(); delete process.env.FAKE_MODEL; };

(async () => {
    let n = 0;
    const t = async (name, fn) => { reset(); try { await fn(); n++; realLog(`ok   ${name}`); } catch (e) { realLog(`FAIL ${name}\n${e.stack}`); process.exitCode = 1; } };

    await t('parseMdnsServices keeps only TLS connect services (not pairing, not the header)', () => {
        const r = adbMod.parseMdnsServices('List of discovered mdns services\nadb-A-1\t_adb-tls-connect._tcp.\t10.0.0.5:4444\nadb-A-1\t_adb-tls-pairing._tcp.\t10.0.0.5:5555\nadb-B-2\t_adb-tls-connect._tcp.\t[fe80::1]:4000\n');
        assert.deepStrictEqual(r, [{ name: 'adb-A-1', ip: '10.0.0.5', port: 4444 }, { name: 'adb-B-2', ip: 'fe80::1', port: 4000 }]);
    });

    await t('tlsRestore is off by default and only a boolean sets it', () => {
        assert.strictEqual(adbMod.settings(gr, 'p1').tlsRestore, false);
        assert.strictEqual(adbMod.settings(gr, 'p1', { tlsRestore: 'yes' }).tlsRestore, false);
        assert.strictEqual(adbMod.settings(gr, 'p1', { tlsRestore: true }).tlsRestore, true);
    });

    await t('default: a closed 5555 stays unreachable and the Wireless debugging door is never dialled', async () => {
        adbMod.settings(gr, 'p1', { autoRestore: true });
        const st = await adbMod.detect(gr, 'p1', { force: true });
        assert.strictEqual(st.state, 'unreachable');
        assert.ok(!calls().some((c) => /41311|mdns|tcpip/.test(c)), calls().join(' | '));
    });

    await t('tlsRestore without autoRestore does nothing either', async () => {
        adbMod.settings(gr, 'p1', { autoRestore: false, tlsRestore: true });
        const st = await adbMod.detect(gr, 'p1', { force: true });
        assert.strictEqual(st.state, 'unreachable');
        assert.ok(!calls().some((c) => /tcpip|mdns/.test(c)));
    });

    await t('autoRestore + tlsRestore: 5555 is asked for over the TLS port of this phone and detect finds it ready', async () => {
        adbMod.settings(gr, 'p1', { autoRestore: true, tlsRestore: true });
        const st = await adbMod.detect(gr, 'p1', { force: true });
        assert.strictEqual(st.state, 'ready', JSON.stringify(st));
        assert.strictEqual(st.serial, '192.168.100.225:5555');
        const c = calls();
        assert.strictEqual(c.filter((x) => /tcpip/.test(x)).length, 1, c.join(' | '));
        assert.ok(c.includes('-s 192.168.100.225:41311 tcpip 5555'), c.join(' | '));
        // only this phone's own address was ever dialled; the other device on the LAN never was
        assert.ok(!c.some((x) => /192\.168\.100\.99|40001/.test(x)), c.join(' | '));
        assert.ok(logs.some((l) => /5555 asked back over Wireless debugging at 192\.168\.100\.225:41311/.test(l)));
    });

    await t('a service at this address whose model is another phone is not asked for tcpip', async () => {
        process.env.FAKE_MODEL = 'Pixel 8';
        adbMod.settings(gr, 'p1', { autoRestore: true, tlsRestore: true });
        const st = await adbMod.detect(gr, 'p1', { force: true });
        assert.notStrictEqual(st.state, 'ready');
        assert.ok(!calls().some((x) => /tcpip/.test(x)), calls().join(' | '));
    });

    await t('no service of this phone on the LAN: unreachable, with the reason in the error', async () => {
        activeSync.deviceAddresses = () => ['192.168.100.77'];
        adbMod.settings(gr, 'p1', { autoRestore: true, tlsRestore: true });
        const st = await adbMod.detect(gr, 'p1', { force: true });
        activeSync.deviceAddresses = () => ['192.168.100.225'];
        assert.strictEqual(st.state, 'unreachable');
        assert.ok(/Wireless debugging: no Wireless debugging service of this phone/.test(st.error), st.error);
        assert.ok(!calls().some((x) => /tcpip/.test(x)));
    });

    realLog(`${n} passed`);
    fs.rmSync(tmp, { recursive: true, force: true });
})();
