'use strict';

/**
 * The server's hardware sensors (Yozora #896; Server Manager > Diagnostics > Hardware and Sensors):
 * every Linux hwmon chip (/sys/class/hwmon/hwmon*) read as rows - temperatures, fans, voltages,
 * power and clocks - with the chip's own limits where it reports them. Readings a chip cannot give
 * (EOPNOTSUPP, a thermal zone at absolute zero) are left out, so a laptop without fan sensors shows
 * none rather than zeros.
 *
 *   read() -> { host, sensors: [{ id, chip, device, type, label, value, unit, min, max, crit, state }] }
 *     type   'temperature' (°C) | 'fan' (RPM) | 'voltage' (V) | 'power' (W) | 'clock' (MHz)
 *     state  'ok' | 'warning' (at or over max) | 'critical' (at or over crit) | 'stopped' (a fan at 0)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const HWMON = '/sys/class/hwmon';

// what each chip is, in a reader's words (the driver name otherwise)
const CHIP_NAMES = {
    k10temp: 'AMD processor',
    coretemp: 'Intel processor',
    zenpower: 'AMD processor',
    amdgpu: 'AMD graphics',
    nouveau: 'NVIDIA graphics',
    radeon: 'AMD graphics',
    nvme: 'NVMe drive',
    drivetemp: 'Drive',
    acpitz: 'ACPI thermal zone',
    pch_cannonlake: 'Chipset',
    iwlwifi_1: 'Wi-Fi adapter',
    thinkpad: 'ThinkPad embedded controller',
    dell_smm: 'Dell embedded controller',
    applesmc: 'Apple SMC',
    nct6775: 'Super I/O (Nuvoton)',
    it87: 'Super I/O (ITE)'
};

const KINDS = [
    // [file prefix, type, unit, scale to unit]
    ['temp', 'temperature', '°C', 1 / 1000],
    ['fan', 'fan', 'RPM', 1],
    ['in', 'voltage', 'V', 1 / 1000],
    ['power', 'power', 'W', 1 / 1e6],
    ['freq', 'clock', 'MHz', 1 / 1e6]
];

function readText(file) {
    try { return fs.readFileSync(file, 'utf8').trim(); } catch (_) { return null; }
}

function readNumber(file) {
    const t = readText(file);
    if (t === null || t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

function round(v, unit) {
    if (v === null || v === undefined) return null;
    if (unit === 'RPM' || unit === 'MHz') return Math.round(v);
    if (unit === 'V') return Math.round(v * 1000) / 1000;
    return Math.round(v * 10) / 10;
}

/** A chip's network or PCI name when it has one (r8169_0_100:00 -> the Ethernet adapter). */
function chipLabel(name) {
    if (CHIP_NAMES[name]) return CHIP_NAMES[name];
    if (/^r8169|^e1000|^igb|^igc|^ixgbe|^bnx|^tg3/.test(name)) return 'Ethernet adapter';
    if (/^iwlwifi|^ath|^mt7|^rtw/.test(name)) return 'Wi-Fi adapter';
    if (/^BAT|battery/i.test(name)) return 'Battery';
    return name;
}

function readChip(dir) {
    const name = readText(path.join(dir, 'name')) || path.basename(dir);
    let files;
    try { files = fs.readdirSync(dir); } catch (_) { return []; }
    const rows = [];
    for (const [prefix, type, unit, scale] of KINDS) {
        const inputs = files
            .map((f) => new RegExp(`^${prefix}(\\d+)_(input|average)$`).exec(f))
            .filter(Boolean)
            .sort((a, b) => Number(a[1]) - Number(b[1]));
        const seen = new Set();
        for (const m of inputs) {
            const n = m[1];
            if (seen.has(n)) continue; // power: input wins over average when both exist
            const raw = readNumber(path.join(dir, `${prefix}${n}_input`)) ?? readNumber(path.join(dir, `${prefix}${n}_average`));
            if (raw === null) continue;
            seen.add(n);
            const value = round(raw * scale, unit);
            if (type === 'temperature' && (value <= -50 || value >= 200)) continue; // an unpopulated zone
            const label = readText(path.join(dir, `${prefix}${n}_label`)) || `${type === 'temperature' ? 'Temperature' : type === 'fan' ? 'Fan' : type === 'voltage' ? 'Voltage' : type === 'power' ? 'Power' : 'Clock'} ${n}`;
            // a limit the chip leaves unset reads as a sentinel (NVMe: 65261.9 °C): left out
            const lim = (s) => {
                const v = readNumber(path.join(dir, `${prefix}${n}_${s}`));
                if (v === null) return null;
                const r = round(v * scale, unit);
                return type === 'temperature' && (r <= -50 || r >= 200) ? null : r;
            };
            const min = lim('min');
            const max = lim('max');
            const crit = lim('crit');
            let state = 'ok';
            if (crit !== null && crit > 0 && value >= crit) state = 'critical';
            else if (max !== null && max > 0 && value >= max) state = 'warning';
            if (type === 'fan' && value === 0) state = 'stopped';
            rows.push({ id: `${path.basename(dir)}:${prefix}${n}`, chip: name, device: chipLabel(name), type, label, value, unit, min, max, crit, state });
        }
    }
    return rows;
}

function read() {
    let dirs = [];
    try { dirs = fs.readdirSync(HWMON).filter((d) => /^hwmon\d+$/.test(d)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))); } catch (_) { dirs = []; }
    const sensors = [];
    for (const d of dirs) sensors.push(...readChip(path.join(HWMON, d)));
    return { host: os.hostname(), sensors };
}

module.exports = { read, _readChip: readChip, _chipLabel: chipLabel };
