/**
 * Which partner phone a DreamOS machine is on the hotspot of (#953, #910; Yukimi, Nov 20 2026: "detect if the phone is
 * connected as hotspot and use VZAccess Manager to show its status on that PC as if it's a mobile broadband card").
 *
 * The machine tells it is on a phone's hotspot itself (CaféReady wwan.rs: an Instant Hotspot session, or Android's
 * DHCP option 43 ANDROID_METERED in its lease) and says so in its ActiveSync status as host.tether { via, ssid, mac,
 * since, phone }. Which phone it is the machine cannot see when it joined by hand: the hotspot's MAC is randomized and
 * the phone reaches this server through the Nightshade tunnel, not from its carrier address. The phone knows: the
 * machine's MAC is in its neighbour table on its hotspot interface (ap_br_swlan0 on the Galaxy Fold, Nov 20 2026).
 *
 * So when a machine's tether changes (a new network or session), each online partner phone with Remote Commands is
 * asked once for `cat /proc/net/arp` (deviceAdb.shell, its own local ADB over ActiveSync) and the one that lists the
 * machine's MAC on a non-cellular interface is it (how: 'arp'). With no phone answering so, the one partner phone
 * online with a cellular network is taken (how: 'guess'). Nothing is asked on a timer; a phone's own status pushes
 * keep its battery and signal current on the page. The phone's ActiveSync record then carries
 * hotspot { ssid, computers: [{ deviceId, name, via }], how } (activeSync.js describeDevice), and the machine's
 * VZAccess Manager shows that phone (apps/vzaccess, docs/client-api/phone-broadband.md).
 */
'use strict';

const ARP_TIMEOUT_MS = 20000;
/** hostId -> { key, ssid, mac, via, phoneId, how, at } */
const tethers = new Map();
/** hostId -> the key being looked up now */
const looking = new Map();

const macOf = (v) => String(v || '').trim().toLowerCase();
const isMac = (v) => /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(v);

/** /proc/net/arp's text: true when `mac` is listed on an interface that is not the phone's cellular one. */
function arpHas(text, mac) {
    const want = macOf(mac);
    if (!isMac(want)) return false;
    return String(text || '').split('\n').slice(1).some((line) => {
        const f = line.trim().split(/\s+/);
        if (f.length < 6) return false;
        // flags 0x0 is an incomplete entry; rmnet / ccmni / dummy are the modem's own
        return macOf(f[3]) === want && f[2] !== '0x0' && !/^(rmnet|ccmni|dummy|lo)/.test(f[5]);
    });
}

function activeSync() { return require('./activeSync'); }

function partnerPhones(globalResources, server) {
    let data = null;
    try { data = activeSync().list(globalResources, server); } catch (_) { return []; }
    return ((data && data.devices) || []).filter((d) => d && d.online && d.partner && d.platform !== 'cafeready' && !d.test);
}

async function identify(globalResources, server, hostId, t) {
    const phones = partnerPhones(globalResources, server);
    const adb = require('./deviceAdb');
    for (const p of phones.slice(0, 6)) {
        let r = null;
        try {
            r = await Promise.race([
                adb.shell(globalResources, p.deviceId, 'cat /proc/net/arp'),
                new Promise((resolve) => { const tm = setTimeout(() => resolve(null), ARP_TIMEOUT_MS); if (tm.unref) tm.unref(); })
            ]);
        } catch (_) { r = null; }
        if (r && arpHas(r.output, t.mac)) return { phoneId: p.deviceId, how: 'arp' };
    }
    const cellular = phones.filter((p) => p.status && p.status.cellular && p.status.cellular.present !== false && p.status.cellular.operator);
    if (cellular.length === 1) return { phoneId: cellular[0].deviceId, how: 'guess' };
    return null;
}

/**
 * A DreamOS machine's status came (activeSync.js status): host.tether, or none. Looks the phone up when the tether is
 * new; an unchanged one costs nothing.
 */
function hostStatus(globalResources, server, hostId, name, tether) {
    const t = tether && typeof tether === 'object' && tether.ssid ? tether : null;
    const cur = tethers.get(hostId);
    if (!t) {
        if (cur || looking.has(hostId)) {
            tethers.delete(hostId);
            looking.delete(hostId);
            try { activeSync().touchDevice(globalResources, server, hostId); } catch (_) { /* no list */ }
        }
        return;
    }
    const key = `${t.via}|${t.ssid}|${macOf(t.mac)}|${t.since || 0}`;
    if ((cur && cur.key === key) || looking.get(hostId) === key) return;
    looking.set(hostId, key);
    void identify(globalResources, server, hostId, t).then((found) => {
        if (looking.get(hostId) !== key) return;
        looking.delete(hostId);
        tethers.set(hostId, { key, ssid: String(t.ssid).slice(0, 64), mac: macOf(t.mac), via: t.via === 'instant-hotspot' ? 'instant-hotspot' : 'hotspot', name: String(name || '').slice(0, 64), phoneId: found ? found.phoneId : null, how: found ? found.how : null, at: Date.now() });
        if (found) console.log(`📶 [phoneTether] ${name || hostId.slice(0, 8)} is on ${found.phoneId.slice(0, 8)}…'s hotspot "${t.ssid}" (${found.how})`);
        try { activeSync().touchDevice(globalResources, server, hostId); } catch (_) { /* no list */ }
    }, (err) => {
        looking.delete(hostId);
        console.warn('[phoneTether] lookup failed:', err && err.message);
    });
}

/** A machine went offline: its tether goes with it. */
function hostGone(globalResources, server, hostId) {
    if (!tethers.has(hostId) && !looking.has(hostId)) return;
    tethers.delete(hostId);
    looking.delete(hostId);
    try { activeSync().touchDevice(globalResources, server, hostId); } catch (_) { /* no list */ }
}

/** For a phone's ActiveSync record: the machines on its hotspot, or null. */
function hotspotOf(phoneId) {
    const computers = [];
    let ssid = null;
    let how = null;
    for (const [hostId, t] of tethers) {
        if (t.phoneId !== phoneId) continue;
        computers.push({ deviceId: hostId, name: t.name, via: t.via });
        ssid = ssid || t.ssid;
        how = how === 'arp' ? how : t.how;
    }
    return computers.length ? { ssid, computers, how } : null;
}

module.exports = { hostStatus, hostGone, hotspotOf, __test: { arpHas, tethers, reset: () => { tethers.clear(); looking.clear(); } } };
