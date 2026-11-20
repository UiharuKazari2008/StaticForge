'use strict';
/**
 * The Nightshade Network's addresses (Yozora #952, Yukimi Nov 20 2026): the server is the DHCP server of the Café
 * Miniport / Nightshade adapter, and every client gets its own address from 172.18.0.0/16, shown on the client's
 * adapter (Status > Details, ipconfig) and in the server's client lists (Server Manager > Clients).
 *
 * A "client" is what Windows would see as one: a computer's network adapter. Each browser profile, Android app or
 * DreamOS machine keeps one adapter address of its own (the page makes it once and keeps it in its storage: the
 * phone page and its DeX window share the app's storage, so a phone and its DeX desktop are one computer with one
 * address, as they share one Café Miniport). The adapter address is the DHCP client identifier; the lease follows it,
 * not the socket, so a reconnect, a restart or a new window keeps the same address.
 *
 *   172.18.0.1          the server: default gateway, DHCP server, DNS server
 *   172.18.1.1 - .254.254   clients, one random free address each (no x.x.x.0 / x.x.x.255)
 *   lease               8 days (Windows Server's DHCP default); renewed at each connection once half of it has run
 *                       (T1), as a DHCP client renews; obtained / expires are what the client shows
 *   held                an address stays with its adapter while the lease runs and 30 days after it ran out; only
 *                       then is it free for another adapter (never handed out while another holds it)
 *
 *   lease({ nic, host, user, clientId }) -> lease row (below) | null
 *   list() -> [rows]          byNic(nic) -> row | null
 *   SERVER_IP, MASK, PREFIX
 *
 * Kept in data/nightshade-leases.json (written after a change, atomically); read once at start.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SERVER_IP = '172.18.0.1';
const PREFIX = 16;
const MASK = '255.255.0.0';
const LEASE_MS = 8 * 24 * 60 * 60 * 1000;
const HOLD_MS = 30 * 24 * 60 * 60 * 1000;
const FILE = path.join(__dirname, '..', 'data', 'nightshade-leases.json');

let leases = null; // nic -> row
let writing = null;
let again = false;

/** A client's adapter address: 12 hex digits (a MAC's), the locally administered kind the page makes. */
const cleanNic = (v) => {
    const s = String(v == null ? '' : v).toLowerCase().replace(/[^0-9a-f]/g, '');
    return s.length === 12 ? s : null;
};
const cleanText = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function load() {
    if (leases) return leases;
    leases = new Map();
    try {
        const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        if (Array.isArray(rows)) {
            for (const r of rows) {
                const nic = r && cleanNic(r.nic);
                if (nic && typeof r.ip === 'string' && /^172\.18\.\d+\.\d+$/.test(r.ip)) leases.set(nic, { ...r, nic });
            }
        }
    } catch (_) { /* none yet */ }
    return leases;
}

function save() {
    if (writing) { again = true; return; }
    const rows = [...load().values()];
    const tmp = `${FILE}.${process.pid}.tmp`;
    writing = fs.promises.mkdir(path.dirname(FILE), { recursive: true })
        .then(() => fs.promises.writeFile(tmp, JSON.stringify(rows, null, 1)))
        .then(() => fs.promises.rename(tmp, FILE))
        .catch((err) => console.warn('[nightshade] could not keep the leases:', err && err.message))
        .finally(() => { writing = null; if (again) { again = false; save(); } });
}

/** Leases that ran out more than HOLD_MS ago free their address. */
function purge(now) {
    let gone = false;
    for (const [nic, r] of load()) {
        if (Number(r.expiresAt) + HOLD_MS < now) { load().delete(nic); gone = true; }
    }
    return gone;
}

function freeAddress() {
    const taken = new Set([...load().values()].map((r) => r.ip));
    for (let i = 0; i < 4096; i += 1) {
        const b = 1 + crypto.randomInt(254); // 172.18.1-254.x
        const c = 1 + crypto.randomInt(254); // x.x.x.1-254
        const ip = `172.18.${b}.${c}`;
        if (!taken.has(ip)) return ip;
    }
    return null;
}

/**
 * A DHCP request from a client's adapter: its lease, new or renewed. The row:
 *   { nic, ip, mask, prefix, gateway, dhcpServer, dns: [ip], obtainedAt, expiresAt, host, user, firstSeen, lastSeen }
 */
function lease({ nic, host, user, clientId } = {}, now = Date.now()) {
    const id = cleanNic(nic);
    if (!id) return null;
    let changed = purge(now);
    let r = load().get(id);
    if (!r) {
        const ip = freeAddress();
        if (!ip) return null;
        r = { nic: id, ip, obtainedAt: now, expiresAt: now + LEASE_MS, firstSeen: now };
        load().set(id, r);
        changed = true;
    } else if (now >= Number(r.obtainedAt) + LEASE_MS / 2 || now >= Number(r.expiresAt)) {
        // T1 (or a lease that ran out while away, its address still held for it): renewed
        r.obtainedAt = now;
        r.expiresAt = now + LEASE_MS;
        changed = true;
    }
    const h = cleanText(host, 63);
    const u = cleanText(user, 32);
    if (h && r.host !== h) { r.host = h; changed = true; }
    if (u && r.user !== u) { r.user = u; changed = true; }
    // lastSeen is kept to the hour on disk (a reconnect does not rewrite the file)
    if (!r.lastSeen || now - Number(r.lastSeen) > 3600000) { r.lastSeen = now; changed = true; }
    if (clientId) r.lastClientId = cleanText(clientId, 32);
    if (changed) save();
    return view(r);
}

function view(r) {
    return {
        nic: r.nic,
        ip: r.ip,
        mask: MASK,
        prefix: PREFIX,
        gateway: SERVER_IP,
        dhcpServer: SERVER_IP,
        dns: [SERVER_IP],
        obtainedAt: Number(r.obtainedAt),
        expiresAt: Number(r.expiresAt),
        host: r.host || '',
        user: r.user || '',
        firstSeen: Number(r.firstSeen) || null,
        lastSeen: Number(r.lastSeen) || null
    };
}

function byNic(nic) {
    const id = cleanNic(nic);
    const r = id && load().get(id);
    return r ? view(r) : null;
}

function list() {
    return [...load().values()].map(view);
}

module.exports = { lease, byNic, list, cleanNic, SERVER_IP, MASK, PREFIX, LEASE_MS, HOLD_MS, _reset: () => { leases = new Map(); } };
