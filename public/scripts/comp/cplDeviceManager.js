/**
 * Device Manager (Yozora #632): Vista's MMC snap-in window (menu bar, toolbar, the device tree under
 * the computer's name) over the hardware this browser can see:
 *
 *   Display adapters   the WebGL renderer (WEBGL_debug_renderer_info), else "Standard VGA Graphics Adapter"
 *   Processors         one entry per logical processor (navigator.hardwareConcurrency)
 *   Monitors           the screen (screen.width x height, the pixel ratio)
 *   Sound, video and game controllers / Audio inputs and outputs   navigator.mediaDevices
 *   Keyboards, Mice    the standard PS/2 and HID devices every computer reports
 *   Network adapters   Melaton's VPN connection (melatonNetworkDialogs.js), WAN Miniport (L-PPoP)
 *   Disk drives        the browser's storage quota as the server's disk
 *   Human Interface Devices   the gamepads the browser sees
 *
 * A device's Properties is Vista's own sheet (devmgr.dll.mui General / Driver / Details).
 *   openDeviceManager()
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ITEMS = '/static_images/vista-cpl/items';
    const CMD = '/static_images/vista-cmdbar';
    // devmgr's class icons as the VM draws them (setupapi.dll, mmsys.cpl), 16 and 32 px
    const DEV = '/static_images/vista-devmgr';

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function gpuName() {
        try {
            const gl = doc.createElement('canvas').getContext('webgl');
            const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
            const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
            // "ANGLE (Intel, Intel(R) UHD Graphics 630 (0x3E92) Direct3D11 vs_5_0 ps_5_0, D3D11)" -> the adapter
            const m = /ANGLE \([^,]*,\s*([^(]+?)(?:\s*\(0x|\s+Direct3D|,|\))/.exec(name || '');
            return (m ? m[1] : name || '').trim() || 'Standard VGA Graphics Adapter';
        } catch (_) {
            return 'Standard VGA Graphics Adapter';
        }
    }

    // ---------------------------------------------------------------- the phone's own hardware (#829)
    // On a phone, and in the DeX desktop of that phone, the Android app reports the device
    // (window.AndroidHardware.getInfo): Device Manager lists that hardware by Vista's device classes.
    // Classes Vista did not have yet (Biometric devices, Proximity devices, Sensors) take Windows 7/8's
    // names. Every fact is optional: a class with nothing known is left out.

    function deviceHardware() {
        const id = root.melatonDeviceIdentity;
        if (id && typeof id.hardware === 'function') return id.hardware();
        const b = root.AndroidHardware;
        if (!b || typeof b.getInfo !== 'function') return null;
        try { return JSON.parse(b.getInfo() || 'null'); } catch (_) { return null; }
    }

    /** Vista's disk sizes in Device Manager style: "128 GB", "1.5 TB" (decimal, as drive makers print them). */
    function sizeText(bytes) {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n <= 0) return '';
        if (n >= 1e12) return `${(n / 1e12).toFixed(n >= 1e13 ? 0 : 1).replace(/\.0$/, '')} TB`;
        if (n >= 1e9) return `${Math.round(n / 1e9)} GB`;
        return `${Math.round(n / 1e6)} MB`;
    }

    const ARCH_PC = { arm64: 'ACPI ARM64-based PC', arm: 'ACPI ARM-based PC', x86_64: 'ACPI x64-based PC', x86: 'ACPI x86-based PC' };
    function archOf(hw) {
        const soc = (hw && hw.soc) || {};
        if (soc.arch) return soc.arch;
        const abi = Array.isArray(soc.abis) ? soc.abis[0] : '';
        return /arm64|aarch64/.test(abi) ? 'arm64' : /^armeabi/.test(abi) ? 'arm' : /x86_64/.test(abi) ? 'x86_64' : /x86/.test(abi) ? 'x86' : '';
    }

    function clockText(mhz) {
        const n = Number(mhz);
        return Number.isFinite(n) && n > 0 ? `${(n / 1000).toFixed(2)}GHz` : '';
    }

    /** The processor as Vista names one: "<SoC> (Cortex-X4) @ 3.30GHz", one row per core. */
    function processorRows(hw) {
        const soc = (hw && hw.soc) || {};
        const cpu = (hw && hw.cpu) || {};
        const name = soc.name || soc.model || [soc.manufacturer, 'Processor'].filter(Boolean).join(' ') || 'ARM Processor';
        const rows = [];
        const clusters = Array.isArray(cpu.clusters) ? cpu.clusters.filter((c) => c && c.cores > 0) : [];
        // fastest cores first, as the CPU numbers run on most phones' big.LITTLE layouts in reverse
        clusters.slice().sort((a, b) => (b.maxMHz || 0) - (a.maxMHz || 0)).forEach((c) => {
            const label = `${name}${c.part ? ` (${c.part})` : ''}${c.maxMHz ? ` @ ${clockText(c.maxMHz)}` : ''}`;
            for (let i = 0; i < c.cores; i++) rows.push(label);
        });
        if (!rows.length) {
            const n = cpu.cores || (root.navigator && root.navigator.hardwareConcurrency) || 1;
            for (let i = 0; i < n; i++) rows.push(`${name}${cpu.maxMHz ? ` @ ${clockText(cpu.maxMHz)}` : ''}`);
        }
        return rows;
    }

    const AUDIO_NAMES = {
        builtin_speaker: 'Speakers (Built-in Audio)', builtin_earpiece: 'Earpiece (Built-in Audio)', builtin_mic: 'Microphone (Built-in Audio)',
        telephony: 'Telephony Audio Device', wired_headset: 'Headset (Wired)', wired_headphones: 'Headphones (Wired)', line_analog: 'Line Out',
        line_digital: 'Digital Audio (S/PDIF)', hdmi: 'HDMI Audio Device', hdmi_arc: 'HDMI Audio Device (ARC)', usb_device: 'USB Audio Device',
        usb_headset: 'USB Audio Headset', usb_accessory: 'USB Audio Accessory', bluetooth_a2dp: 'Bluetooth Audio (Stereo)', bluetooth_sco: 'Bluetooth Audio (Hands-Free)',
        ble_headset: 'Bluetooth LE Audio Headset', ble_speaker: 'Bluetooth LE Audio Speaker', hearing_aid: 'Hearing Aid', dock: 'Dock Audio', fm_tuner: 'FM Radio Tuner',
        remote_submix: null, bus: null, ip: null, echo_reference: null, unknown: null
    };

    const SENSOR_NAMES = {
        accelerometer: 'Accelerometer', gyroscope: 'Gyroscope', magnetic_field: 'Magnetometer (Compass)', light: 'Ambient Light Sensor',
        proximity: 'Proximity Sensor', pressure: 'Barometer', gravity: 'Gravity Sensor', linear_acceleration: 'Linear Acceleration Sensor',
        rotation_vector: 'Orientation Sensor', ambient_temperature: 'Temperature Sensor', relative_humidity: 'Humidity Sensor',
        step_counter: 'Step Counter', step_detector: 'Step Detector', significant_motion: 'Motion Detector', heart_rate: 'Heart Rate Sensor',
        hinge_angle: 'Hinge Angle Sensor', game_rotation_vector: 'Game Orientation Sensor', geomagnetic_rotation_vector: 'Geomagnetic Orientation Sensor'
    };

    /** The RAM fitted, as makers sell it (6 GB), from what Android can use (5.26 GB). */
    const RAM_SIZES = [1, 1.5, 2, 3, 4, 6, 8, 10, 12, 16, 18, 20, 24, 32, 48, 64];
    function installedRam(bytes, mem) {
        // the boot property the maker sets (ro.boot.ddr_size), when the app reads it
        if (mem && Number(mem.installedBytes) > 0) return Math.round(Number(mem.installedBytes) / 1073741824 * 2) / 2;
        const gb = Number(bytes) / 1073741824;
        if (!Number.isFinite(gb) || gb <= 0) return 0;
        return RAM_SIZES.find((n) => n >= gb) || Math.ceil(gb);
    }

    /** The panel's diagonal in inches and its size in mm, from the physical dpi. */
    function screenSize(m) {
        if (!m || !m.width || !m.height || !m.xdpi || !m.ydpi) return null;
        const w = m.width / m.xdpi;
        const h = m.height / m.ydpi;
        const inches = Math.hypot(w, h);
        return inches > 1 && inches < 40 ? { inches, wmm: Math.round(w * 25.4), hmm: Math.round(h * 25.4) } : null;
    }
    function aspect(w, h) {
        const g = (a, b) => (b ? g(b, a % b) : a);
        const [a, b] = [Math.max(w, h), Math.min(w, h)];
        const r = a / b;
        const named = [[16 / 9, '16:9'], [16 / 10, '16:10'], [4 / 3, '4:3'], [18 / 9, '18:9'], [19.5 / 9, '19.5:9'], [20 / 9, '20:9'], [21 / 9, '21:9']].find(([x]) => Math.abs(x - r) < 0.02);
        return named ? named[1] : `${a / g(a, b)}:${b / g(a, b)}`;
    }

    const SENSOR_UNITS = {
        accelerometer: 'm/s\u00b2', gravity: 'm/s\u00b2', linear_acceleration: 'm/s\u00b2', gyroscope: 'rad/s', magnetic_field: '\u00b5T', light: 'lx', proximity: 'cm',
        pressure: 'hPa', ambient_temperature: '\u00b0C', relative_humidity: '%', heart_rate: 'bpm', hinge_angle: '\u00b0', step_counter: 'steps'
    };
    const AXES = { accelerometer: 'XYZ', gravity: 'XYZ', linear_acceleration: 'XYZ', gyroscope: 'XYZ', magnetic_field: 'XYZ', rotation_vector: 'XYZW', game_rotation_vector: 'XYZW', geomagnetic_rotation_vector: 'XYZW' };

    /** The kernel's cpu number for processorRows' i-th row: clusters are numbered in report order, rows run fastest first. */
    function processorCpuIndex(hw, i) {
        const clusters = hw && hw.cpu && Array.isArray(hw.cpu.clusters) ? hw.cpu.clusters.filter((c) => c && c.cores > 0) : [];
        if (!clusters.length) return i;
        let n = 0;
        const numbered = clusters.map((c) => { const first = n; n += c.cores; return { c, first }; });
        const rows = [];
        numbered.slice().sort((a, b) => (b.c.maxMHz || 0) - (a.c.maxMHz || 0)).forEach(({ c, first }) => { for (let k = 0; k < c.cores; k++) rows.push(first + k); });
        return rows[i] != null ? rows[i] : i;
    }

    // ---- Current Values (#829): what a device reads now, from the Android app's bridge
    function bridgeJson(fn, ...args) {
        const b = root.AndroidHardware;
        if (!b || typeof b[fn] !== 'function') return null;
        try { return JSON.parse(b[fn](...args) || 'null'); } catch (_) { return null; }
    }
    const cap1 = (t) => String(t || '').replace(/^\w/, (c) => c.toUpperCase());
    const num = (v, d = 0) => (v == null || !Number.isFinite(Number(v)) ? '' : Number(v).toFixed(d));
    const dur = (ms) => { const m = Math.round(Number(ms) / 60000); return !Number.isFinite(m) || m <= 0 ? '' : m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`; };

    /*
     * Shizuku or ADB (#829): the app reads dumpsys battery / thermalservice through the elevated path its
     * bridge settings prefer (Shizuku or its local ADB) when that is running and allowed (AndroidHardware.getPrivileged, refreshed at most every 30 s by requestPrivileged).
     */
    let privAsked = 0;
    function privileged() {
        const b = root.AndroidHardware;
        if (!b || typeof b.getPrivileged !== 'function') return null;
        if (Date.now() - privAsked > 30000 && typeof b.requestPrivileged === 'function') { privAsked = Date.now(); try { b.requestPrivileged(); } catch (_) { /* not allowed */ } }
        return bridgeJson('getPrivileged');
    }
    const THERMAL_NAMES = { AP: 'Application processor', CPU: 'Processor', GPU: 'Graphics', BAT: 'Battery', MAINBATRAW: 'Battery (raw)', SUBBAT: 'Second battery', SKIN: 'Device surface',
        USB: 'USB port', PA: 'Power amplifier', NPU: 'Neural processor', MODEM: 'Modem', CP: 'Modem' };
    const dateText = (d) => { const t = d ? new Date(`${d}T00:00:00`) : null; return t && Number.isFinite(t.getTime()) ? t.toLocaleDateString() : ''; };

    /** [[label, value]] for a live source; sensors are started on first read (stopLive ends them). */
    function liveValues(live) {
        if (!live) return [];
        const na = 'Not available';
        if (live.kind === 'battery' || live.kind === 'charger') {
            let b = bridgeJson('getBattery');
            if (!b) { try { const s = JSON.parse(root.AndroidDeviceStatus.getState()); b = s && s.battery; } catch (_) { b = null; } }
            if (!b) return [['Status', na]];
            const plug = { ac: 'AC charger', usb: 'USB', wireless: 'Wireless charger', dock: 'Dock' }[b.plugged] || 'Not plugged in';
            const pv = privileged();
            const pb = (pv && pv.battery) || {};
            if (live.kind === 'charger') {
                return [['Power source', plug], ['Charging', b.charging ? 'Yes' : 'No'],
                    ['Charge rate', b.charging && b.powerMw > 0 ? `${(b.powerMw / 1000).toFixed(1)} W` : ''], ['Time to full', b.charging ? dur(b.chargeTimeRemainingMs) : ''],
                    ['Charger maximum', pb.maxChargingCurrentMa > 0 ? `${Math.round(pb.maxChargingCurrentMa)} mA${pb.maxChargingVoltageMv > 0 ? ` at ${(pb.maxChargingVoltageMv / 1000).toFixed(1)} V` : ''}` : ''],
                    ['Fast charging', pb.adaptiveFastCharging == null ? '' : pb.superFastCharging ? 'Super fast charging on' : pb.adaptiveFastCharging ? 'Adaptive fast charging on' : 'Off'],
                    ['Charge limit', pb.protectThreshold ? `${pb.protectThreshold}% (battery protection)` : '']].filter((r) => r[1]);
            }
            return [['Charge remaining', b.level != null ? `${Math.round(b.level)}%` : ''], ['State', cap1((b.status || '').replace(/_/g, ' '))], ['Power source', plug],
                ['Voltage', b.voltageMv ? `${(b.voltageMv / 1000).toFixed(3)} V` : ''], ['Current', b.currentUa != null ? `${Math.round(b.currentUa / 1000)} mA` : ''],
                ['Average current', b.currentAvgUa != null ? `${Math.round(b.currentAvgUa / 1000)} mA` : ''], ['Power', b.powerMw != null ? `${(b.powerMw / 1000).toFixed(2)} W` : ''],
                ['Temperature', b.temperatureC != null ? `${num(b.temperatureC, 1)} \u00b0C` : ''], ['Health', cap1((b.health || '').replace(/_/g, ' '))], ['Charge counter', b.chargeCounterUah ? `${Math.round(b.chargeCounterUah / 1000)} mAh` : ''],
                ['Full charge capacity', b.fullCapacityMah ? `${Math.round(b.fullCapacityMah)} mAh` : ''], ['Design capacity', b.designCapacityMah ? `${Math.round(b.designCapacityMah)} mAh` : ''],
                ['Wear level', b.fullCapacityMah && b.designCapacityMah ? `${Math.max(0, Math.round(100 - b.fullCapacityMah * 100 / b.designCapacityMah))}%` : ''],
                ['Battery health', pb.healthPct != null ? `${Math.round(pb.healthPct)}% of original capacity` : ''],
                ['Charge cycles', b.cycleCount != null ? String(b.cycleCount) : pb.cycleCount != null ? `${pb.cycleCount}${pb.usagePct != null ? ` (${Number(pb.usagePct).toLocaleString()}% charged in total)` : ''}` : ''],
                ['First used', dateText(pb.firstUseDate)], ['Manufactured', dateText(pb.manufactureDate)], ['Battery saver', b.saver ? 'On' : 'Off'],
                ['Extra details', pv ? '' : (root.AndroidHardware && typeof root.AndroidHardware.getPrivilegedState === 'function' && root.AndroidHardware.getPrivilegedState() !== 'ready' ? 'Allow Shizuku or ADB in the Android Bridge settings for battery health and cycles' : '')]].filter((r) => r[1]);
        }
        if (live.kind === 'cpu') {
            const f = bridgeJson('getCpuFrequencies');
            const core = f && Array.isArray(f.cores) ? f.cores.find((c) => c.cpu === live.index) : null;
            if (!core) return [['Current speed', na]];
            return [['Current speed', core.online === false ? 'Parked (offline)' : core.curMHz ? `${Math.round(core.curMHz)} MHz` : na],
                ['Utilization', core.loadPct != null ? `${Math.round(core.loadPct)}%` : ''], ['All cores', f.loadPct != null ? `${Math.round(f.loadPct)}%` : ''],
                ['Minimum speed', core.minMHz ? `${Math.round(core.minMHz)} MHz` : ''], ['Maximum speed', core.maxMHz ? `${Math.round(core.maxMHz)} MHz` : ''],
                ['Speed', core.curMHz && core.maxMHz ? `${Math.round(core.curMHz * 100 / core.maxMHz)}% of maximum` : ''], ['CPU number', String(live.index)]].filter((r) => r[1]);
        }
        if (live.kind === 'gpu') {
            const f = bridgeJson('getCpuFrequencies');
            const g = f && f.gpu;
            if (!g || (!g.curMHz && !g.maxMHz)) return [['Current clock', na]];
            // the clock file reads 0 while the GPU sleeps
            if (!g.curMHz) return [['Current clock', 'Idle'], ['Maximum clock', `${Math.round(g.maxMHz)} MHz`], ['Utilization', g.loadPct != null ? `${Math.round(g.loadPct)}%` : '']].filter((r) => r[1]);
            return [['Current clock', `${Math.round(g.curMHz)} MHz`], ['Maximum clock', g.maxMHz ? `${Math.round(g.maxMHz)} MHz` : ''],
                ['Utilization', g.loadPct != null ? `${Math.round(g.loadPct)}%` : ''], ['Clock', g.maxMHz ? `${Math.round(g.curMHz * 100 / g.maxMHz)}% of maximum` : '']].filter((r) => r[1]);
        }
        if (live.kind === 'system') {
            const hw = bridgeJson('getInfo');
            const m = hw && hw.memory;
            const t = bridgeJson('getThermal');
            const gb = (b) => (b ? `${(b / 1073741824).toFixed(2)} GB` : '');
            return [['Memory (RAM)', gb(m && m.totalBytes)], ['Memory available', gb(m && m.availBytes)],
                ['Memory in use', m && m.totalBytes ? `${Math.round((m.totalBytes - m.availBytes) * 100 / m.totalBytes)}%` : ''], ['Low memory', m ? (m.lowMemory ? 'Yes' : 'No') : ''],
                ['Processor utilization', (() => { const f = bridgeJson('getCpuFrequencies'); return f && f.loadPct != null ? `${Math.round(f.loadPct)}%` : ''; })()],
                ['Thermal status', t && t.status ? t.status.replace(/^\w/, (c) => c.toUpperCase()) : ''], ['Thermal headroom', t && t.headroom != null ? `${Math.round(t.headroom * 100)}%` : '']]
                .concat(t && Array.isArray(t.sensors) ? t.sensors.filter((x) => x && x.name && x.tempC != null && Number(x.tempC) >= 10).map((x) => [`${x.name} temperature`, `${num(x.tempC, 1)} \u00b0C`]) : [])
                // the thermal service's own sensors (Shizuku): skip probes that read 0 (not fitted)
                .concat((() => { const pv = privileged(); const ts = pv && pv.thermal && Array.isArray(pv.thermal.sensors) ? pv.thermal.sensors : [];
                    return ts.filter((x) => x && x.name && Number(x.tempC) >= 1).map((x) => [`${THERMAL_NAMES[x.name] || x.name} (thermal service)`, `${num(x.tempC, 1)} \u00b0C`]); })())
                .filter((r) => r[1]);
        }
        if (live.kind === 'storage') {
            const hw = bridgeJson('getInfo');
            const v = hw && Array.isArray(hw.storage) ? hw.storage.find((x) => x.id === live.id) : null;
            if (!v) return [['State', 'Not present']];
            return [['State', v.state || ''], ['Capacity', sizeText(v.totalBytes)], ['Free space', sizeText(v.freeBytes)],
                ['Used', v.totalBytes ? `${Math.round((v.totalBytes - v.freeBytes) * 100 / v.totalBytes)}%` : '']].filter((r) => r[1]);
        }
        if (live.kind === 'quota') return [['Capacity', liveQuota.quota ? sizeText(liveQuota.quota) : ''], ['Used', liveQuota.usage != null ? sizeText(liveQuota.usage) || '0 MB' : '']].filter((r) => r[1]);
        if (live.kind === 'sensor') {
            const b = root.AndroidHardware;
            if (!b || typeof b.readSensor !== 'function') return [['Reading', 'This version of the Melaton app cannot read sensors']];
            if (!liveSensors.has(live.typeId)) { try { b.startSensor(live.typeId); } catch (_) { /* below */ } liveSensors.add(live.typeId); }
            const r = bridgeJson('readSensor', live.typeId);
            if (!r || !Array.isArray(r.values)) return [['Reading', 'Waiting for the sensor...']];
            const unit = SENSOR_UNITS[live.type] || '';
            const axes = AXES[live.type];
            const rows = axes ? r.values.slice(0, axes.length).map((v, i) => [`${axes[i]}`, `${num(v, 3)} ${i < 3 ? unit : ''}`.trim()])
                : [['Value', `${num(r.values[0], Math.abs(r.values[0]) >= 100 ? 0 : 2)} ${unit}`.trim()]].concat(r.values.slice(1).map((v, i) => [`Value ${i + 2}`, num(v, 3)]));
            if (axes && axes.startsWith('XYZ') && r.values.length >= 3 && unit) rows.push(['Magnitude', `${num(Math.hypot(r.values[0], r.values[1], r.values[2]), 3)} ${unit}`]);
            rows.push(['Accuracy', ['Unreliable', 'Low', 'Medium', 'High'][r.accuracy] || '']);
            rows.push(['Last reading', r.at ? new Date(r.at).toLocaleTimeString() : '']);
            return rows.filter((x) => x[1]);
        }
        return [];
    }
    const liveSensors = new Set();
    const liveQuota = { quota: 0, usage: null };
    function stopLive() {
        const b = root.AndroidHardware;
        liveSensors.forEach((t) => { try { if (b && typeof b.stopSensor === 'function') b.stopSensor(t); } catch (_) { /* gone */ } });
        liveSensors.clear();
    }

    function deviceCategories(hw, extra) {
        const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
        const dev = Object.assign({}, hw.device || {});
        // Android reports some makers in lower case ("samsung")
        if (dev.manufacturer) dev.manufacturer = String(dev.manufacturer).replace(/^\w/, (c) => c.toUpperCase());
        const bat = extra.battery || {};
        const cats = [];
        // a device is its name, or { name, info: { manufacturer, location, props [[k, v]], live } }:
        // Properties shows info, and a live source gets a Current Values tab (#829)
        const add = (name, icon, devices) => {
            const d = devices.filter(Boolean).map((x) => (typeof x === 'string' ? { name: x } : x));
            if (d.length) cats.push({ name, icon: `${DEV}/${icon}-16.png`, devices: d.map((x) => x.name), info: d.map((x) => x.info || null) });
        };
        const uniq = (a) => Array.from(new Set(a.filter(Boolean)));
        const maker = dev.manufacturer || '';
        const soc = hw.soc || {};

        // Batteries: the charger and the cell
        const cap = bat.designCapacityMah ? `${Math.round(bat.designCapacityMah).toLocaleString()} mAh` : '';
        add('Batteries', 'batteries', [
            { name: 'Microsoft AC Adapter', info: { manufacturer: 'Microsoft', location: 'Charging port', live: { kind: 'charger' } } },
            { name: `${[dev.manufacturer, bat.technology || 'Li-ion'].filter(Boolean).join(' ')} Battery${cap ? ` (${cap})` : ''}`, info: { manufacturer: maker, location: 'Internal battery', props: [['Chemistry', bat.technology || 'Li-ion'], ['Design capacity', cap]], live: { kind: 'battery' } } }
        ]);
        const bio = hw.biometrics || {};
        add('Biometric devices', 'biometric', [bio.fingerprint && 'Fingerprint Sensor', bio.face && 'Face Recognition Sensor', bio.iris && 'Iris Scanner']);
        const bt = hw.bluetooth || {};
        const btf = bt.features || {};
        const BT_FEATURES = [['le2MPhy', 'LE 2M PHY'], ['leCodedPhy', 'LE Coded PHY (long range)'], ['leExtendedAdvertising', 'LE Extended Advertising'], ['lePeriodicAdvertising', 'LE Periodic Advertising'],
            ['multipleAdvertisement', 'Multiple advertisement'], ['offloadedFiltering', 'Offloaded filtering'], ['offloadedScanBatching', 'Offloaded scan batching'], ['leAudio', 'LE Audio']];
        if (bt.present) add('Bluetooth Radios', 'bluetooth', [
            { name: bt.le ? 'Generic Bluetooth Radio (Bluetooth Low Energy)' : 'Generic Bluetooth Radio', info: { manufacturer: maker || '(Generic Bluetooth Radio)', location: 'Internal radio',
                props: [['Bluetooth version', bt.version ? `${bt.version}${bt.versionSource === 'features' ? ' or later (from the radio\'s features)' : bt.versionSource === 'spec' && (soc.name || soc.model) ? ` (${soc.name || soc.model} specification)` : ''}` : ''],
                ['Bluetooth chip', bt.chip && typeof bt.chip === 'object' ? bt.chip.name : bt.chip], ['Bluetooth firmware', bt.chip && typeof bt.chip === 'object' && bt.chip.raw !== bt.chip.name ? bt.chip.raw : ''], ['Low Energy', bt.le == null ? '' : bt.le ? 'Supported' : 'Not supported']].concat(BT_FEATURES.filter(([k]) => btf[k] != null).map(([k, l]) => [l, btf[k] ? 'Supported' : 'Not supported'])) } },
            'Microsoft Bluetooth Enumerator']);
        add('Computer', 'computer', [{ name: ARCH_PC[archOf(hw)] || 'ACPI ARM64-based PC', info: {
            manufacturer: maker, location: 'on System board',
            props: [['Model', [maker, dev.marketName || dev.model].filter(Boolean).join(' ')], ['Installed memory (RAM)', hw.memory && hw.memory.totalBytes ? `${installedRam(hw.memory.totalBytes, hw.memory)} GB${hw.memory.type || soc.ramType ? ` ${hw.memory.type || soc.ramType}` : ''} (${(hw.memory.totalBytes / 1073741824).toFixed(2)} GB usable)` : ''],
                ['Manufacturing process', soc.processNm ? `${soc.processNm} nm` : ''], ['Model number', dev.model], ['Board', dev.board], ['System on chip', [soc.manufacturer, soc.model].filter(Boolean).join(' ')], ['Instruction sets', list(soc.abis).join(', ')],
                ['Android', dev.androidRelease ? `${dev.androidRelease} (API ${dev.sdk || '?'})` : ''], ['Security patch', dev.securityPatch], ['Build', dev.buildId], ['Kernel', dev.kernel]],
            live: { kind: 'system' } } }]);

        // Disk drives: Dreamscape's virtual disk, then the phone's own storage
        const vols = list(hw.storage);
        const disk = (v) => {
            const size = sizeText(v.totalBytes);
            if (v.kind === 'internal') return `${maker ? `${maker} ` : ''}Internal Storage${size ? ` (${size})` : ''}`;
            if (v.kind === 'sd' || v.kind === 'adopted') return `SD Memory Card${v.label ? ` ${v.label}` : ''}${size ? ` (${size})` : ''}`;
            if (v.kind === 'usb') return `${v.label || 'USB Mass Storage'} USB Device${size ? ` (${size})` : ''}`;
            return `${v.label || 'Storage'}${size ? ` (${size})` : ''}`;
        };
        add('Disk drives', 'disk-drives', [{ name: `Dreamscape Virtual Disk${extra.quota ? ` (${sizeText(extra.quota)})` : ''}`, info: { manufacturer: 'Xyridian Corporation', location: 'Dreamscape server', live: { kind: 'quota' } } }]
            .concat(vols.filter((v) => !v.emulated || v.kind === 'internal').map((v) => ({ name: disk(v), info: {
                manufacturer: v.kind === 'internal' ? maker : '(Standard disk drives)', location: v.kind === 'internal' ? 'Internal' : v.kind === 'usb' ? 'USB port' : 'Storage card slot',
                props: [['Volume label', v.label], ['Volume ID', v.uuid || v.id], ['Kind', v.kind], ['File system', v.filesystem], ['Data partition', v.dataTotalBytes ? sizeText(v.dataTotalBytes) : ''],
                    ['Removable', v.removable ? 'Yes' : 'No'], ['Emulated', v.emulated ? 'Yes' : 'No']],
                live: { kind: 'storage', id: v.id } } }))));
        // the app reports gpu.model as { raw, name, cores } (an older build: a string)
        const gpu0 = hw.gpu || {};
        const gm = gpu0.model && typeof gpu0.model === 'object' ? gpu0.model : { raw: gpu0.model || '', name: gpu0.name || '', cores: gpu0.cores || 0 };
        const gpu = Object.assign({}, gpu0, { name: gm.name || gpu0.name, cores: gm.cores || gpu0.cores, model: gm.raw || '' });
        const gpuLabel = gpu.name ? `${/^Mali/i.test(gpu.name) ? 'ARM ' : /^Adreno/i.test(gpu.name) ? 'Qualcomm ' : ''}${gpu.name}${gpu.cores ? ` (${gpu.cores} cores)` : ''}` : gpuName();
        add('Display adapters', 'display-adapters', [{ name: gpuLabel, info: { manufacturer: soc.manufacturer || maker, location: 'on System on chip',
            props: [['System on chip', soc.name || soc.model], ['Graphics processor', gpu.model || gpuName()], ['Cores', gpu.cores ? String(gpu.cores) : ''],
                ['Maximum clock', gpu.maxMHz ? `${Math.round(gpu.maxMHz)} MHz` : ''], ['Minimum clock', gpu.minMHz ? `${Math.round(gpu.minMHz)} MHz` : ''], ['Renderer (WebGL)', gpuName()]], live: { kind: 'gpu' } } }]);

        // input: Windows puts touch screens and pens under Human Interface Devices
        const input = list(hw.input);
        const has = (d, k) => Array.isArray(d.sources) && d.sources.includes(k);
        const hid = [];
        input.forEach((d) => {
            if (has(d, 'touchscreen')) hid.push(`HID-compliant touch screen${d.name ? ` (${d.name})` : ''}`);
            if (has(d, 'stylus')) hid.push(`HID-compliant pen${d.name ? ` (${d.name})` : ''}`);
            if (has(d, 'gamepad')) hid.push(`HID-compliant game controller${d.name ? ` (${d.name})` : ''}`);
            if (has(d, 'keyboard') && d.keyboardType !== 'alphabetic' && !has(d, 'gamepad')) hid.push(`HID-compliant consumer control device${d.name ? ` (${d.name})` : ''}`);
        });
        add('Human Interface Devices', 'hid', uniq(hid));
        // Samsung lists one front camera under two ids: one row per lens
        const camSeen = new Set();
        // a logical camera made of several lenses (android.logicalMultiCamera): one row per lens, the
        // logical camera's own size on its main (wide) lens
        const KIND = { wide: 'Wide', ultrawide: 'Ultra Wide', telephoto: 'Telephoto' };
        const lensRows = [];
        list(hw.cameras).forEach((c) => {
            const phys = list(c.physical);
            if (!phys.length) { lensRows.push(c); return; }
            // the lens kind: the app's 35 mm equivalent when it sends one (equivalentMm), else from the
            // set itself - the biggest sensor is the main (wide) lens, a much shorter focal length is
            // ultra wide, anything else is telephoto (a 3x lens can be 7 mm beside a 6.25 mm main)
            const mp = (p) => (p.width && p.height ? p.width * p.height : (p.megapixels || 0) * 1e6);
            const mainLens = phys.slice().sort((a, b) => mp(b) - mp(a))[0];
            const kindOf = (p) => {
                if (p.equivalentMm) return p.equivalentMm < 18 ? 'ultrawide' : p.equivalentMm < 35 ? 'wide' : 'telephoto';
                if (p === mainLens) return 'wide';
                return p.focalLengthMm && mainLens.focalLengthMm && p.focalLengthMm < mainLens.focalLengthMm * 0.6 ? 'ultrawide' : 'telephoto';
            };
            phys.forEach((p0) => {
                const p = Object.assign({}, p0, { kind: kindOf(p0) });
                const main = p.kind === 'wide';
                lensRows.push(Object.assign({}, c, p, { id: `${c.id}/${p.id}`, lens: KIND[p.kind] || '',
                    width: main && c.width > (p.width || 0) ? c.width : p.width, height: main && c.height > (p.height || 0) ? c.height : p.height, physical: null }));
            });
        });
        const cams = lensRows.filter((c) => { const k = `${c.facing}|${c.width || ''}x${c.height || ''}|${c.focalLengthMm || c.megapixels || c.id}`; if (camSeen.has(k)) return false; camSeen.add(k); return true; });
        add('Imaging devices', 'imaging', cams.map((c) => {
            const where = c.facing === 'front' ? `Front ${c.lens ? `${c.lens} ` : ''}Camera` : c.facing === 'external' ? 'USB Video Device' : `Rear ${c.lens ? `${c.lens} ` : ''}Camera`;
            const mp = c.width && c.height ? (c.width * c.height) / 1e6 : c.megapixels;
            const yn = (v) => (v == null ? '' : v ? 'Yes' : 'No');
            return { name: `${where}${mp ? ` (${Math.round(mp)} MP)` : ''}`, info: { manufacturer: maker || '(Standard imaging devices)', location: `Camera ${c.id}`,
                props: [['Facing', c.facing], ['Lens', c.lens ? `${c.lens}${c.equivalentMm ? ` (${Math.round(c.equivalentMm)} mm equivalent)` : ''}` : ''], ['Resolution', mp ? `${Math.round(mp)} MP${c.width ? ` (${c.width} x ${c.height})` : ''}` : ''], ['Focal length', c.focalLengthMm ? `${Number(c.focalLengthMm).toFixed(2)} mm` : ''],
                    ['Autofocus', yn(c.autofocus)], ['Optical stabilization', yn(c.ois)], ['Digital zoom', c.maxZoom ? `up to ${Number(c.maxZoom).toFixed(1)}x` : ''], ['Flash', yn(c.flash)], ['Camera ID', c.id]] } };
        }));
        const kb = input.filter((d) => has(d, 'keyboard') && d.keyboardType === 'alphabetic').map((d) => (d.external ? `HID Keyboard Device (${d.name || 'USB'})` : d.name || 'Standard Keyboard'));
        // the phone's on-screen keyboard is Windows Mobile's Soft Input Panel
        add('Keyboards', 'keyboards', ['Melaton Soft Input Panel'].concat(kb));
        const tel = hw.telephony || {};
        if (tel.present) add('Modems', 'modems', [`Mobile Broadband Modem${tel.phoneType && tel.phoneType !== 'none' ? ` (${tel.phoneType.toUpperCase()})` : ''}${tel.simSlots > 1 ? `, ${tel.simSlots} SIM slots` : ''}`]);
        add('Mice and other pointing devices', 'mice', uniq(input.filter((d) => has(d, 'mouse') || has(d, 'touchpad') || has(d, 'trackball'))
            .map((d) => (has(d, 'touchpad') ? `HID-compliant touch pad${d.name ? ` (${d.name})` : ''}` : `HID-compliant mouse${d.name ? ` (${d.name})` : ''}`))));
        // Monitors: each display, built-in panels first
        const rank = (d) => (d.panel === 'inner' ? 0 : d.panel === 'cover' ? 1 : d.builtIn ? 2 : 3);
        const shows = list(hw.displays).slice().sort((a, b) => rank(a) - rank(b));
        let panel = 0;
        add('Monitors', 'monitors', shows.map((m) => {
            const sz = screenSize(m);
            const mode = m.width && m.height ? ` (${sz && m.builtIn ? `${sz.inches.toFixed(1)}", ` : ''}${m.width} x ${m.height}${m.refreshHz ? `, ${Math.round(m.refreshHz)} Hz` : ''})` : '';
            let name;
            // a foldable's panels by their place (#829: both, not only the one in use)
            const place = m.panel === 'inner' ? 'Main Display' : m.panel === 'cover' ? 'Cover Display' : '';
            if (place) name = `${place}${mode}`;
            else if (m.builtIn) { panel += 1; name = `Built-in Display${shows.filter((x) => x.builtIn).length > 1 ? ` ${panel}` : ''}${mode}`; } else name = `Generic PnP Monitor${mode}`;
            return { name, info: { manufacturer: m.builtIn ? maker : '(Standard monitor types)', location: m.builtIn ? 'Internal panel' : 'External display port', props: [
                ['Display name', m.name], ['State', m.active == null ? '' : m.active ? 'In use' : 'Off (not in use)'], ['Resolution', m.width && m.height ? `${m.width} x ${m.height}` : ''], ['Aspect ratio', m.width && m.height ? aspect(m.width, m.height) : ''],
                ['Screen size', sz ? `${sz.inches.toFixed(2)} in (${sz.wmm} x ${sz.hmm} mm)` : ''], ['Refresh rate', m.refreshHz ? `${Math.round(m.refreshHz)} Hz` : ''],
                ['Supported modes', list(m.modes).map((x) => `${x.width} x ${x.height} @ ${Math.round(x.refreshHz)} Hz`).join(', ')], ['Wide color gamut', m.wideColorGamut == null ? '' : m.wideColorGamut ? 'Yes' : 'No'],
                ['Density', m.densityDpi ? `${m.densityDpi} dpi` : ''], ['Physical dpi', m.xdpi ? `${Math.round(m.xdpi)} x ${Math.round(m.ydpi || m.xdpi)}` : ''], ['HDR', list(m.hdr).join(', ') || (m.hdr ? 'None' : '')], ['Display ID', m.id]
            ] } };
        }));
        const wifi = hw.wifi || {};
        const std = list(wifi.standards);
        const best = std.length ? std[std.length - 1] : '';
        add('Network adapters', 'network-adapters', [
            wifi.present && `Wireless Network Adapter${best ? ` (${best})` : ''}`,
            tel.present && 'Mobile Broadband Adapter',
            bt.present && 'Bluetooth Device (Personal Area Network)',
            extra.conn.miniport || `${extra.conn.connectionType || 'WAN'} Miniport (${extra.conn.device || 'L-PPoP'})`
        ]);
        // Vista lists removable media again under Portable Devices, by drive
        add('Portable Devices', 'portable', vols.filter((v) => v.removable && v.kind !== 'internal').map((v) => v.label || (v.kind === 'usb' ? 'USB Drive' : 'Storage Card')));
        add('Processors', 'processors', processorRows(hw).map((name, i) => ({ name, info: { manufacturer: soc.manufacturer || maker, location: `Core ${i}`,
            props: [['Processor', soc.name || soc.model], ['Model', soc.model], ['Manufacturing process', soc.processNm ? `${soc.processNm} nm` : '']], live: { kind: 'cpu', index: processorCpuIndex(hw, i) } } })));
        const nfc = hw.nfc || {};
        if (nfc.present) add('Proximity devices', 'proximity', [`NFC Controller${nfc.enabled === false ? ' (turned off)' : ''}`, nfc.hce && 'NFC Host Card Emulation', nfc.secureNfc && 'NFC Secure Element']);
        const sec = hw.security || {};
        add('Security Devices', 'security', [
            sec.hardwareKeystore && 'Trusted Execution Environment (Hardware Keystore)',
            sec.strongBox && 'StrongBox Secure Element',
            sec.encryption && /^active/.test(sec.encryption) && `Storage Encryption${sec.fileBased ? ' (File-Based)' : ''}`
        ]);
        const seen = new Set();
        add('Sensors', 'sensors', list(hw.sensors).filter((x) => !x.wakeUp || !list(hw.sensors).some((y) => y !== x && y.type === x.type && !y.wakeUp))
            .map((x) => {
                const kindName = SENSOR_NAMES[x.type] || (x.type ? x.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Sensor');
                const raw = String(x.name || '').trim();
                // "LSM6DSV Accelerometer" says what it is; "TCS3701" alone does not
                const word = kindName.split(/[\s(]/)[0].toLowerCase();
                const name = !raw ? kindName : raw.toLowerCase().includes(word) ? raw : `${kindName} (${raw})`;
                if (seen.has(name)) return null;
                seen.add(name);
                return { name, info: { manufacturer: x.vendor || '(Standard sensors)', location: 'Sensor hub', props: [
                    ['Sensor type', x.type], ['Type ID', x.typeId], ['Version', x.version], ['Power', x.powerMa != null ? `${x.powerMa} mA` : ''],
                    ['Maximum range', x.maxRange != null ? `${x.maxRange} ${SENSOR_UNITS[x.type] || ''}`.trim() : ''], ['Resolution', x.resolution != null ? String(x.resolution) : ''], ['Wake-up sensor', x.wakeUp ? 'Yes' : 'No']
                ], live: x.typeId != null ? { kind: 'sensor', typeId: x.typeId, type: x.type } : null } };
            }));
        const audio = hw.audio || {};
        const snd = list(audio.outputs).concat(list(audio.inputs)).map((a) => (a.type in AUDIO_NAMES ? AUDIO_NAMES[a.type] : (a.name || null)));
        add('Sound, video and game controllers', 'sound', uniq(snd).length ? uniq(snd) : ['High Definition Audio Device']);
        add('Storage volumes', 'volumes', vols.map(() => 'Generic volume'));
        add('System devices', 'system-devices', [
            'Microsoft ACPI-Compliant System', 'ACPI Fixed Feature Button', 'ACPI Power Button', 'ACPI Thermal Zone',
            hw.vibrator && hw.vibrator.present && 'Vibration Motor', 'System timer', dev.board && `${dev.board.toUpperCase()} System Board`
        ]);
        const usb = hw.usb || {};
        add('Universal Serial Bus controllers', 'usb', [
            'USB Root Hub', usb.host ? 'USB Host Controller (OTG)' : 'USB Device Controller',
            ...list(usb.devices).map((u) => u.product || u.name || 'USB Composite Device')
        ]);
        return cats;
    }

    async function categories() {
        const hw = deviceHardware();
        if (hw && typeof hw === 'object') {
            let quota = 0;
            try { const e = root.navigator.storage && await root.navigator.storage.estimate(); quota = (e && e.quota) || 0; } catch (_) { /* none */ }
            let battery = null;
            try { const b = root.AndroidDeviceStatus; const s = b && typeof b.getState === 'function' ? JSON.parse(b.getState()) : null; battery = s && s.battery; } catch (_) { battery = null; }
            const conn = root.melatonNetworkDialogs ? root.melatonNetworkDialogs.connectionInfo() : { connectionName: 'VPN Connection', connectionType: 'WAN', device: 'L-PPoP' };
            return deviceCategories(hw, { quota, battery: battery || {}, conn });
        }
        const n = (root.navigator && root.navigator.hardwareConcurrency) || 1;
        const s = root.screen || {};
        let media = [];
        try { media = root.navigator.mediaDevices ? await root.navigator.mediaDevices.enumerateDevices() : []; } catch (_) { media = []; }
        const label = (d, fallback, i) => d.label || `${fallback} ${i + 1}`;
        const audioOut = media.filter((d) => d.kind === 'audiooutput');
        const audioIn = media.filter((d) => d.kind === 'audioinput');
        const video = media.filter((d) => d.kind === 'videoinput');
        const pads = (root.navigator.getGamepads ? Array.from(root.navigator.getGamepads()) : []).filter(Boolean);
        const conn = root.melatonNetworkDialogs ? root.melatonNetworkDialogs.connectionInfo() : { connectionName: 'VPN Connection', connectionType: 'WAN', device: 'L-PPoP' };
        let quota = 0;
        try { const e = root.navigator.storage && await root.navigator.storage.estimate(); quota = (e && e.quota) || 0; } catch (_) { /* none */ }
        const cats = [
            { name: 'Computer', icon: `${DEV}/computer-16.png`, devices: ['ACPI x64-based PC'] },
            { name: 'Disk drives', icon: `${DEV}/disk-drives-16.png`, devices: [`Dreamscape Virtual Disk${quota ? ` (${Math.round(quota / 1e9)} GB)` : ''}`] },
            { name: 'Display adapters', icon: `${DEV}/display-adapters-16.png`, devices: [gpuName()] },
            { name: 'Human Interface Devices', icon: `${DEV}/hid-16.png`, devices: ['USB Input Device'].concat(pads.map((p) => p.id.replace(/\s*\(.*\)$/, ''))) },
            { name: 'IDE ATA/ATAPI controllers', icon: `${DEV}/ide-ata-atapi-16.png`, devices: ['Standard Dual Channel PCI IDE Controller'] },
            { name: 'Keyboards', icon: `${DEV}/keyboards-16.png`, devices: ['Standard PS/2 Keyboard'] },
            { name: 'Mice and other pointing devices', icon: `${DEV}/mice-16.png`, devices: ['HID-compliant mouse'].concat(root.matchMedia && root.matchMedia('(any-pointer: coarse)').matches ? ['HID-compliant touch screen'] : []) },
            { name: 'Monitors', icon: `${DEV}/monitors-16.png`, devices: [`Generic PnP Monitor (${s.width || 0} x ${s.height || 0})`] },
            { name: 'Network adapters', icon: `${DEV}/network-adapters-16.png`, devices: [conn.miniport || `${conn.connectionType || 'WAN'} Miniport (${conn.device || 'L-PPoP'})`] },
            { name: 'Processors', icon: `${DEV}/processors-16.png`, devices: Array.from({ length: n }, () => 'Melaton Virtual Processor') },
            { name: 'Sound, video and game controllers', icon: `${DEV}/sound-16.png`, devices: (audioOut.length ? audioOut.map((d, i) => label(d, 'High Definition Audio Device', i)) : ['High Definition Audio Device']).concat(video.map((d, i) => label(d, 'USB Video Device', i))) },
            { name: 'System devices', icon: `${DEV}/system-devices-16.png`, devices: ['ACPI Fixed Feature Button', 'High precision event timer', 'Programmable interrupt controller', 'System CMOS/real time clock', 'System timer'] },
            { name: 'Universal Serial Bus controllers', icon: `${DEV}/usb-16.png`, devices: ['USB Root Hub', 'Standard Enhanced PCI to USB Host Controller'] }
        ];
        // Vista has no Audio inputs and outputs class: microphones are Sound, video and game controllers
        if (audioIn.length) { const snd = cats.find((c) => c.name === 'Sound, video and game controllers'); if (snd) snd.devices = snd.devices.concat(audioIn.map((d, i) => label(d, 'Microphone', i))); }
        return cats;
    }

    let win = null;
    let tree = null;
    const expanded = new Set();

    function computerName() {
        // the phone (or its DeX desktop): the name its owner gave it in Device ID (#829)
        const id = root.melatonDeviceIdentity;
        if (id && root.AndroidHardware) { try { const me = id.get(); if (me && me.name) return me.name; } catch (_) { /* host name */ } }
        const n = root.melatonNetworkDialogs ? root.melatonNetworkDialogs.connectionInfo() : null;
        const host = (root.location && root.location.hostname) || 'melaton';
        return `${(n && n.domain) || 'DREAMSCAPE'}-${host.split('.')[0].toUpperCase()}`.slice(0, 15);
    }

    /**
     * MMC's toolbar as the VM's Device Manager: Back, Forward | Show/Hide Console Tree | Help, Show/Hide
     * Action Pane (mmc.exe bitmap 202); with a device selected, Properties joins before Help and
     * devmgr.dll bitmap 358's Scan for hardware changes and Update Driver Software come last.
     */
    function renderToolbar() {
        if (!win) return;
        const bar = win.querySelector('.dm-toolbar');
        const dev = !!win.querySelector('.dm-row.is-selected.is-dev');
        const mmc = (tool, i, title, opts = '') => `<button type="button" data-dm-tool="${tool}" title="${title}"${opts}><span class="dm-tb-icon" style="--i:${i}"></span></button>`;
        const own = (tool, i, title) => `<button type="button" data-dm-tool="${tool}" title="${title}"><span class="dm-tb-icon is-devmgr" style="--i:${i}"></span></button>`;
        const sep = '<span class="dm-sep"></span>';
        bar.innerHTML = mmc('back', 0, 'Back', ' disabled') + mmc('forward', 1, 'Forward', ' disabled') + sep
            + mmc('tree', 10, 'Show/Hide Console Tree') + sep
            + (dev ? mmc('properties', 8, 'Properties') + sep : '')
            + mmc('help', 15, 'Help') + mmc('actions', 17, 'Show/Hide Action Pane')
            + (dev ? sep + own('scan', 0, 'Scan for hardware changes') + sep + own('update', 4, 'Update Driver Software...') : '');
    }

    function render() {
        if (!win || !tree) return;
        const body = win.querySelector('.dm-tree');
        body.innerHTML = `<div class="dm-row is-root is-open" data-dm="root"><span class="dm-twisty"></span><img src="${DEV}/root-16.png" alt=""><span>${esc(computerName())}</span></div>
            ${tree.map((c, ci) => {
                const open = expanded.has(c.name);
                // is-last / in-last: where the dotted sibling lines stop (TVS_HASLINES)
                const last = ci === tree.length - 1;
                return `<div class="dm-row is-cat${open ? ' is-open' : ''}${last ? ' is-last' : ''}" data-dm="cat" data-cat="${ci}" tabindex="0"><span class="dm-twisty"></span><img src="${esc(c.icon)}" alt=""><span>${esc(c.name)}</span></div>
                    ${open ? c.devices.map((d, di) => `<div class="dm-row is-dev${last ? ' in-last' : ''}${di === c.devices.length - 1 ? ' is-last' : ''}" data-dm="dev" data-cat="${ci}" data-dev="${di}" tabindex="0"><img src="${esc(c.icon)}" alt=""><span>${esc(d)}</span></div>`).join('') : ''}`;
            }).join('')}`;
        renderToolbar();
    }

    /** Update Driver Software: the browser's devices have no drivers to update. */
    function msgUpToDate() {
        const sel = win && win.querySelector('.dm-row.is-selected.is-dev span:last-child');
        callGlobal('showConfirmationDialog', `<p>The best driver software for ${esc(sel ? sel.textContent : 'this device')} is already installed.</p><p>Melaton has determined the driver software for your device is up to date.</p>`, [{ text: 'Close', value: true, className: 'btn-standard primary' }], null, { title: 'Update Driver Software', width: 420 });
    }

    // Current Values (#829): devmgr's Details page laid out again for live readings - the device's icon
    // and name, then a list that refreshes each second while the sheet is open
    function valuesTemplate() {
        const T = root.vistaDialogTemplates || {};
        const base = T['devmgr:372'];
        if (!base) return null;
        return Object.assign({}, base, {
            t: 'Current Values',
            c: [base.c[0], base.c[1], [65535, 'S', 7, 35, 239, 8, 1342308352, 'Current &values (updated every second)', 0], [376, 'SysListView32', 7, 46, 239, 167, 1350680641, 'List1', 0]]
        });
    }

    function openProperties(ci, di) {
        const c = tree[ci];
        const name = c.devices[di];
        const info = (c.info && c.info[di]) || {};
        const V = root.vistaDialogTemplate;
        if (!V) return;
        const sheet = root.cplDialogs && root.cplDialogs.sheet;
        const open = sheet || ((def) => V.openSheet(def));
        const big = c.icon.replace('-16.png', '-32.png');
        const valuesTpl = info.live ? valuesTemplate() : null;
        const pages = [{ key: 'devmgr:103', overrides: { 218: { image: big } } }, { key: 'devmgr:106', overrides: { 226: { image: big } } }, { key: 'devmgr:372', overrides: { 373: { image: big } } }];
        if (valuesTpl) pages.push({ key: 'devmgr:values', tpl: valuesTpl, overrides: { 373: { image: big } } });
        const manufacturer = info.manufacturer || (/Melaton|Dreamscape/.test(name) ? 'Xyridian Corporation' : '(Standard system devices)');
        let timer = 0;
        open({
            windowId: 'dmDeviceProperties',
            title: `${name} Properties`,
            icon: c.icon,
            noApply: true,
            pages,
            init(ctx) {
                pages.forEach((p) => ctx.text(p.key === 'devmgr:103' ? 219 : p.key === 'devmgr:106' ? 227 : 374, name, p.key));
                ctx.set(220, c.name, 'devmgr:103');
                ctx.set(221, manufacturer, 'devmgr:103');
                ctx.set(357, info.location || 'PCI bus 0, device 1, function 0', 'devmgr:103');
                ctx.set(223, 'This device is working properly.', 'devmgr:103');
                ctx.set(385, info.manufacturer || 'Xyridian', 'devmgr:106');
                ctx.set(387, '6/21/2006', 'devmgr:106');
                ctx.set(389, '6.0.6002.18005', 'devmgr:106');
                ctx.set(393, 'Xyridian Melaton', 'devmgr:106');
                ['devmgr:103', 'devmgr:106', 'devmgr:372'].forEach((p) => {
                    ctx.content.querySelectorAll(`[data-vdt-page="${p}"] input.vdt-edit`).forEach((i) => { i.readOnly = true; });
                });
                const props = [['Device description', name], ['Hardware Ids', `ROOT\\${c.name.replace(/\W+/g, '').toUpperCase()}\\0000`], ['Class', c.name], ['Driver', 'Xyridian'], ['Manufacturer', manufacturer]]
                    .concat((info.props || []).filter((p) => p && p[1] != null && p[1] !== ''));
                ctx.options(375, props.map((p, i) => ({ value: String(i), text: p[0] })), '0', 'devmgr:372');
                const lv = ctx.holder(376, 'devmgr:372');
                const showProp = () => { lv.querySelector('.vdt-lv-body').innerHTML = `<div class="vdt-lv-row is-selected"><span>${esc(props[Number(ctx.get(375, 'devmgr:372'))][1])}</span></div>`; };
                ctx.on(375, 'change', showProp, 'devmgr:372');
                showProp();
                ctx.enable(309, false, 'devmgr:103');
                ctx.enable(217, false, 'devmgr:103');
                [380, 394, 378, 382].forEach((id) => ctx.enable(id, false, 'devmgr:106'));
                if (!valuesTpl) return;
                const vlv = ctx.holder(376, 'devmgr:values');
                const body = vlv && vlv.querySelector('.vdt-lv-body');
                if (!body) return;
                body.classList.add('dm-values');
                const draw = () => {
                    // the sheet closed: stop the sensors it started
                    if (!ctx.content.isConnected || ctx.content.closest('.hidden')) { clearInterval(timer); stopLive(); return; }
                    const page = ctx.content.querySelector('[data-vdt-page="devmgr:values"]');
                    if (page && page.hidden) return;
                    const rows = liveValues(info.live);
                    body.innerHTML = rows.map(([k, v]) => `<div class="vdt-lv-row dm-value-row"><span class="dm-value-key">${esc(k)}</span><span class="dm-value-val">${esc(v)}</span></div>`).join('')
                        || '<div class="vdt-lv-row"><span>No values</span></div>';
                };
                if (info.live.kind === 'quota' && root.navigator.storage) {
                    root.navigator.storage.estimate().then((e) => { liveQuota.quota = e.quota || 0; liveQuota.usage = e.usage || 0; }).catch(() => {});
                }
                ctx.content.querySelectorAll('[data-vdt-tab]').forEach((t) => t.addEventListener('click', () => setTimeout(draw, 0)));
                timer = setInterval(draw, 1000);
                draw();
            }
        }, null, win);
    }

    function build() {
        win = doc.createElement('div');
        win.id = 'deviceManagerModal';
        win.className = 'modal hidden resizeable-window dm-window';
        win.dataset.windowIdentifier = 'deviceManager';
        win.dataset.windowClient = 'light';
        win.dataset.windowDefaultWidth = '640';
        win.dataset.windowDefaultHeight = '480';
        win.dataset.windowMinWidth = '320';
        win.dataset.windowMinHeight = '240';
        win.innerHTML = `
            <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ITEMS}/device-manager-16.png" alt=""><span>Device Manager</span></div></div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                <button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                <button type="button" class="btn-danger close-btn btn-small dm-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content win7 dm-client">
                <div class="naxt-menubar dm-menubar" role="menubar" data-win32-menus><button type="button" class="naxt-menu-title" data-dm-menu="file">File</button><button type="button" class="naxt-menu-title" data-dm-menu="action">Action</button><button type="button" class="naxt-menu-title" data-dm-menu="view">View</button><button type="button" class="naxt-menu-title" data-dm-menu="help">Help</button></div>
                <div class="dm-toolbar" role="toolbar"></div>
                <div class="dm-tree" role="tree" tabindex="0"></div>
                <div class="dm-status"><span></span><span></span><span></span></div>
            </div>`;
        doc.body.appendChild(win);
        win.querySelector('.dm-close').addEventListener('click', () => callGlobal('closeModal', win));
        // attached up front: contextMenu opens them on click, and hovering another title
        // while one is open switches to it
        win.querySelectorAll('[data-dm-menu]').forEach(attachMenu);
        win.addEventListener('click', (ev) => {
            const row = ev.target.closest('.dm-row');
            if (row) {
                win.querySelectorAll('.dm-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
                row.classList.add('is-selected');
                renderToolbar();
                if (row.dataset.dm === 'cat' && ev.target.closest('.dm-twisty')) toggle(row);
            }
            const tool = ev.target.closest('[data-dm-tool]');
            if (tool) {
                const t = tool.dataset.dmTool;
                if (t === 'scan') void refresh();
                else if (t === 'update') msgUpToDate();
                else if (t === 'help') callGlobal('openHelpAndSupport', 'device-manager');
                else if (t === 'properties') {
                    const sel = win.querySelector('.dm-row.is-selected.is-dev');
                    if (sel) openProperties(Number(sel.dataset.cat), Number(sel.dataset.dev));
                }
            }
        });
        win.addEventListener('dblclick', (ev) => {
            const row = ev.target.closest('.dm-row');
            if (!row) return;
            if (row.dataset.dm === 'cat') toggle(row);
            else if (row.dataset.dm === 'dev') openProperties(Number(row.dataset.cat), Number(row.dataset.dev));
        });
        win.addEventListener('keydown', (ev) => {
            const row = ev.target.closest && ev.target.closest('.dm-row');
            if (!row) return;
            if (ev.key === 'Enter' && row.dataset.dm === 'dev') openProperties(Number(row.dataset.cat), Number(row.dataset.dev));
            if ((ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') && row.dataset.dm === 'cat') {
                const name = tree[Number(row.dataset.cat)].name;
                if ((ev.key === 'ArrowRight') !== expanded.has(name)) toggle(row);
            }
        });
    }

    function toggle(row) {
        const c = tree[Number(row.dataset.cat)];
        if (expanded.has(c.name)) expanded.delete(c.name); else expanded.add(c.name);
        render();
    }

    function attachMenu(btn) {
        const cm = root.contextMenu;
        if (!cm) return;
        const items = {
            // devmgr's MMC menus (Vista): File, Action, View with its four views, Help
            file: [{ text: 'Options...', action: 'dm-none', disabled: true }, { separator: true }, { text: 'Exit', action: 'dm-exit' }],
            action: [{ text: 'Scan for hardware changes', action: 'dm-scan' }, { text: 'Add legacy hardware', action: 'dm-add-hw' }, { separator: true }, { text: 'Properties', action: 'dm-props' }, { separator: true }, { text: 'Help', action: 'dm-help' }],
            view: [
                { text: 'Devices by type', action: 'dm-none', checked: true, showIndicator: true, indicatorMark: 'radio' },
                { text: 'Devices by connection', action: 'dm-none', disabled: true },
                { text: 'Resources by type', action: 'dm-none', disabled: true },
                { text: 'Resources by connection', action: 'dm-none', disabled: true },
                { separator: true },
                { text: 'Show hidden devices', action: 'dm-none', disabled: true },
                { separator: true },
                { text: 'Customize...', action: 'dm-none', disabled: true }
            ],
            // the VM's Device Manager: Help Topics | About ... Management Console..., About Device Manager...
            help: [{ text: 'Help Topics', action: 'dm-help' }, { separator: true }, { text: 'About Xyridian Management Console...', action: 'dm-about' }, { text: 'About Device Manager...', action: 'dm-about-snapin' }]
        }[btn.dataset.dmMenu];
        cm.attachClickMenuToElement(btn, {
            sections: [{ type: 'list', items }],
            onAction: (action) => {
                if (action === 'dm-exit') callGlobal('closeModal', win);
                else if (action === 'dm-scan') void refresh();
                // the Add Hardware wizard (hdwwiz), as Control Panel opens it
                else if (action === 'dm-add-hw') { const cp = root.melatonControlPanel; if (cp && cp.doAction) cp.doAction('dialog:add-hardware'); }
                else if (action === 'dm-help') callGlobal('openHelpAndSupport', 'device-manager');
                else if (action === 'dm-props') {
                    const sel = win.querySelector('.dm-row.is-selected.is-dev');
                    if (sel) openProperties(Number(sel.dataset.cat), Number(sel.dataset.dev));
                } else if (action === 'dm-about') callGlobal('openAboutMelatoninModal', { program: 'Xyridian Management Console', product: 'Management Console 3.0' });
                else if (action === 'dm-about-snapin') callGlobal('openSnapinAbout', { name: 'Device Manager', description: 'You can use Device Manager to view a list of hardware devices installed on your computer and set properties for each device.' });
            }
        });
    }

    async function refresh() {
        tree = await categories();
        render();
    }

    async function openDeviceManager() {
        if (!doc) return;
        if (!win) build();
        callGlobal('openModal', win);
        win.classList.remove('hidden');
        await refresh();
    }

    root.openDeviceManager = openDeviceManager;
    root.melatonDeviceManager = { open: openDeviceManager, categories, gpuName, computerName, deviceHardware, sizeText, processorRows, archOf, installedRam, screenSize };
})(typeof window !== 'undefined' ? window : globalThis);
