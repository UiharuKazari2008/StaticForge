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

    // CaféReady tasks (#908): the app's own background duties (drive alerts, the status bar), with their state
    const TASK_NAMES = { 'drive-alerts': 'Drive Alerts', 'status-bar': 'Status Bar Icons' };
    function cafeTaskDevices() {
        const T = root.AndroidTasks;
        if (!T || typeof T.info !== 'function') return [];
        let info = null;
        try { info = JSON.parse(T.info() || 'null'); } catch (_) { info = null; }
        if (!info) return [];
        const host = { name: 'CaféReady Task Host', info: { manufacturer: 'Melaton', location: 'Melaton Café Miniport', props: [
            ['Host interface', `API ${info.api}`], ['Engine', info.supported ? (info.engine ? 'Running' : 'Stopped (starts on its next event)') : 'Not supported on this phone'],
            ['Link', info.link ? 'Connected' : 'Not in use'], ['Positions', info.positions || 'off'], ['Task code', info.source || '']
        ] } };
        const tasks = (info.tasks || []).map((name) => {
            let out = null;
            try { out = JSON.parse(T.output(name) || 'null'); } catch (_) { out = null; }
            const props = [['Task', name], ['Runs here', T.owns(name) ? 'Yes' : 'No (the page does it)']];
            if (name === 'drive-alerts' && out) props.push(['Driving', out.active ? 'Yes' : 'No'], ['Watching', out.mode === 'route' ? `The commute (${out.direction})` : out.mode === 'area' ? 'Cameras around the car' : '-'], ['Warned this drive', String((out.alerted || []).length)]);
            if (name === 'status-bar' && out && out.roles) props.push(['Icons shown', Object.keys(out.roles).filter((k) => out.roles[k]).join(', ') || 'None'], ['Link to Dreamscape', out.link ? 'Up' : 'Down']);
            return { name: `CaféReady Task: ${TASK_NAMES[name] || name}`, info: { manufacturer: 'Melaton', location: 'CaféReady Task Host', props } };
        });
        return info.supported ? [host].concat(tasks) : [host];
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
        // a DreamOS laptop (#910): the same report from its CaféReady host, for a PC - its battery (or none) is in the
        // report, its disks and network adapters come by name, and it has no soft keyboard or system on chip
        const pc = dev.platform === 'dreamos';
        const bat = extra.battery && Object.keys(extra.battery).length ? extra.battery : (hw.battery || {});
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
        if (!pc || hw.battery) add('Batteries', 'batteries', [
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
                ['Android', dev.androidRelease ? `${dev.androidRelease} (API ${dev.sdk || '?'})` : ''], ['DreamOS', pc ? dev.osVersion : ''], ['Firmware', pc ? dev.firmware : ''], ['Security patch', dev.securityPatch], ['Build', dev.buildId], ['Kernel', dev.kernel]],
            live: { kind: 'system' } } }]);

        // Disk drives: Dreamscape's virtual disk, then the phone's own storage
        const vols = list(hw.storage);
        const disk = (v) => {
            if (v.name) return v.name;
            const size = sizeText(v.totalBytes);
            if (v.kind === 'internal') return `${maker ? `${maker} ` : ''}Internal Storage${size ? ` (${size})` : ''}`;
            if (v.kind === 'sd' || v.kind === 'adopted') return `SD Memory Card${v.label ? ` ${v.label}` : ''}${size ? ` (${size})` : ''}`;
            if (v.kind === 'usb') return `${v.label || 'USB Mass Storage'} USB Device${size ? ` (${size})` : ''}`;
            return `${v.label || 'Storage'}${size ? ` (${size})` : ''}`;
        };
        add('Disk drives', 'disk-drives', [{ name: `Dreamscape Virtual Disk${extra.quota ? ` (${sizeText(extra.quota)})` : ''}`, info: { manufacturer: 'Xyridian Corporation', location: 'Dreamscape server', live: { kind: 'quota' } } }]
            .concat(vols.filter((v) => !v.emulated || v.kind === 'internal').map((v) => ({ name: disk(v), info: {
                manufacturer: v.kind === 'internal' && !pc ? maker : '(Standard disk drives)', location: v.kind === 'internal' ? 'Internal' : v.kind === 'usb' ? 'USB port' : 'Storage card slot',
                props: [['Volume label', v.label], ['Volume ID', v.uuid || v.id], ['Kind', v.kind], ['File system', v.filesystem], ['Data partition', v.dataTotalBytes ? sizeText(v.dataTotalBytes) : ''],
                    ['Removable', v.removable ? 'Yes' : 'No'], ['Emulated', v.emulated ? 'Yes' : 'No']],
                live: { kind: 'storage', id: v.id } } }))));
        // the app reports gpu.model as { raw, name, cores } (an older build: a string)
        const gpu0 = hw.gpu || {};
        const gm = gpu0.model && typeof gpu0.model === 'object' ? gpu0.model : { raw: gpu0.model || '', name: gpu0.name || '', cores: gpu0.cores || 0 };
        const gpu = Object.assign({}, gpu0, { name: gm.name || gpu0.name, cores: gm.cores || gpu0.cores, model: gm.raw || '' });
        const gpuLabel = gpu.name ? `${/^Mali/i.test(gpu.name) ? 'ARM ' : /^Adreno/i.test(gpu.name) ? 'Qualcomm ' : ''}${gpu.name}${gpu.cores ? ` (${gpu.cores} cores)` : ''}` : gpuName();
        add('Display adapters', 'display-adapters', [{ name: gpuLabel, info: { manufacturer: gpu0.vendor || soc.manufacturer || maker, location: pc ? 'PCI bus' : 'on System on chip',
            props: [[pc ? 'Processor' : 'System on chip', soc.name || soc.model], ['Graphics processor', gpu.model || gpuName()], ['Cores', gpu.cores ? String(gpu.cores) : ''],
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
        add('Keyboards', 'keyboards', (pc ? [] : ['Melaton Soft Input Panel']).concat(kb));
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
        const nics = pc ? list(hw.network).map((n) => n && n.name).filter(Boolean) : [];
        // (#952) the phone's real interfaces through the app's shell (AndroidWifi.interfaces v2: Windows-style names, the
        // modem's multiplexing / accelerator interfaces, Wi-Fi Direct / Aware, VPN tunnels), each with its kernel name and
        // driver; an interface the app saw before and is gone now is a non-present adapter (View > Show hidden devices)
        let ifs = [];
        try {
            const w = root.AndroidWifi;
            const r = w && typeof w.interfaces === 'function' ? JSON.parse(w.interfaces()) : null;
            ifs = r && r.version >= 2 && Array.isArray(r.interfaces) ? r.interfaces.filter((x) => x && x.label) : [];
        } catch (_) { ifs = []; }
        const rate = (n) => (Number(n) >= 0 ? Number(n).toLocaleString() : '');
        const BUS = { wifi: 'PCI bus', 'wifi-direct': 'PCI bus', 'wifi-aware': 'PCI bus', mobile: 'Modem', ipa: 'IP Accelerator', vpn: 'Virtual', bluetooth: 'Bluetooth', usb: 'USB port', ethernet: 'USB port', lan: 'USB port' };
        const ifRows = ifs.map((x) => ({ name: x.label, info: { iface: x, hidden: x.present === false, driver: x.driver || '',
            manufacturer: /^Qualcomm/.test(x.label) || /^(cnss|qca|ath|rmnet|ipa)/i.test(x.driver || '') ? 'Qualcomm' : /^Broadcom/.test(x.label) ? 'Broadcom' : /^MediaTek/.test(x.label) ? 'MediaTek' : x.vpnApp || (x.kind === 'vpn' ? '' : maker),
            location: `${x.name}${BUS[x.kind] ? ` (${BUS[x.kind]})` : ''}`,
            props: [['Interface', x.name], ['Driver', x.driver || ''], ['MAC address', x.mac ? String(x.mac).toUpperCase().replace(/:/g, '-') : ''], ['MTU', x.mtu || ''],
                ['State', x.present === false ? 'Not present' : x.connected ? 'Connected' : x.up ? 'Up, no network' : 'Down'], ['Bytes received', rate(x.rx)], ['Bytes sent', rate(x.tx)],
                ['IPv4 address', Array.isArray(x.ip) ? x.ip.join('\n') : ''], ['IPv6 address', Array.isArray(x.ip6) ? x.ip6.join('\n') : ''], ['Network', x.netType || x.apn || x.vpnApp || '']] } }));
        const miniport = extra.conn.miniport || `${extra.conn.connectionType || 'WAN'} Miniport (${extra.conn.device || 'L-PPoP'})`;
        add('Network adapters', 'network-adapters', (ifRows.length ? ifRows : nics.concat([
            !nics.length && wifi.present && `Wireless Network Adapter${best ? ` (${best})` : ''}`,
            tel.present && 'Mobile Broadband Adapter'
        ])).concat([
            bt.present && !ifs.some((x) => x.kind === 'bluetooth') && { name: 'Bluetooth Device (Personal Area Network)', info: { manufacturer: 'Xyridian', location: 'Bluetooth radio' } },
            { name: miniport, info: { miniport: true, manufacturer: 'Xyridian Corporation', location: 'Melaton Café Miniport' } }
        ]));
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
        ].concat(cafeTaskDevices()));
        const usb = hw.usb || {};
        add('Universal Serial Bus controllers', 'usb', [
            'USB Root Hub', usb.host ? (pc ? 'Standard Enhanced PCI to USB Host Controller' : 'USB Host Controller (OTG)') : 'USB Device Controller',
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
            const conn = root.melatonNetworkDialogs ? root.melatonNetworkDialogs.connectionInfo() : { connectionName: 'Nightshade Network', connectionType: 'WAN', device: 'L-PPoP' };
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
        const conn = root.melatonNetworkDialogs ? root.melatonNetworkDialogs.connectionInfo() : { connectionName: 'Nightshade Network', connectionType: 'WAN', device: 'L-PPoP' };
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

    // ---------------------------------------------------------------- Vista's device classes (devmgr Details tab)
    // the class name in Details' "Device class", its setupapi GUID and the enumerator a device of it comes from
    const CLASS = {
        'Batteries': ['Battery', '{72631e54-78a4-11d0-bcf7-00aa00b7b32a}', 'ACPI'],
        'Biometric devices': ['Biometric', '{53d29ef7-377c-4d14-864b-eb3a85769359}', 'ROOT'],
        'Bluetooth Radios': ['Bluetooth', '{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}', 'USB'],
        'Computer': ['Computer', '{4d36e966-e325-11ce-bfc1-08002be10318}', 'ROOT'],
        'Disk drives': ['DiskDrive', '{4d36e967-e325-11ce-bfc1-08002be10318}', 'SCSI'],
        'Display adapters': ['Display', '{4d36e968-e325-11ce-bfc1-08002be10318}', 'PCI'],
        'Human Interface Devices': ['HIDClass', '{745a17a0-74d3-11d0-b6fe-00a0c90f57da}', 'HID'],
        'IDE ATA/ATAPI controllers': ['hdc', '{4d36e96a-e325-11ce-bfc1-08002be10318}', 'PCI'],
        'Imaging devices': ['Image', '{6bdd1fc6-810f-11d0-bec7-08002be2092f}', 'USB'],
        'Keyboards': ['Keyboard', '{4d36e96b-e325-11ce-bfc1-08002be10318}', 'ACPI'],
        'Modems': ['Modem', '{4d36e96d-e325-11ce-bfc1-08002be10318}', 'USB'],
        'Mice and other pointing devices': ['Mouse', '{4d36e96f-e325-11ce-bfc1-08002be10318}', 'HID'],
        'Monitors': ['Monitor', '{4d36e96e-e325-11ce-bfc1-08002be10318}', 'DISPLAY'],
        'Network adapters': ['Net', '{4d36e972-e325-11ce-bfc1-08002be10318}', 'PCI'],
        'Portable Devices': ['WPD', '{eec5ad98-8080-425f-922a-dabf3de3f69a}', 'WPDBUSENUMROOT'],
        'Processors': ['Processor', '{50127dc3-0f36-415e-a6cc-4cb3be910b65}', 'ACPI'],
        'Proximity devices': ['Proximity', '{5630831c-06c9-4856-b327-f5d32586e060}', 'ROOT'],
        'Security Devices': ['SecurityDevices', '{d94ee5d8-d189-4994-83d2-f68d7d41b0e6}', 'ACPI'],
        'Sensors': ['Sensor', '{5175d334-c371-4806-b3ba-71fd53c9258d}', 'ROOT'],
        'Sound, video and game controllers': ['MEDIA', '{4d36e96c-e325-11ce-bfc1-08002be10318}', 'HDAUDIO'],
        'Storage volumes': ['Volume', '{71a27cdd-812a-11d0-bec7-00a0c91e2adc}', 'STORAGE'],
        'System devices': ['System', '{4d36e97d-e325-11ce-bfc1-08002be10318}', 'ACPI'],
        'Universal Serial Bus controllers': ['USB', '{36fc9e60-c465-11cf-8056-444553540000}', 'USB']
    };
    const classOf = (cat) => CLASS[cat] || ['System', '{4d36e97d-e325-11ce-bfc1-08002be10318}', 'ROOT'];
    const slug = (s) => String(s || '').toUpperCase().replace(/\(R\)|\(TM\)/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

    // ---------------------------------------------------------------- what Vista keeps between runs
    // Disable (CONFIGFLAG_DISABLED), the view, Show hidden devices, the devices seen before (non-present devices),
    // all on this computer (localStorage); an Uninstall lasts until Scan for hardware changes finds the device again
    const STORE = 'melaton.devmgr';
    function load(k, d) { try { const v = JSON.parse(root.localStorage.getItem(`${STORE}.${k}`) || 'null'); return v == null ? d : v; } catch (_) { return d; } }
    function save(k, v) { try { root.localStorage.setItem(`${STORE}.${k}`, JSON.stringify(v)); } catch (_) { /* full or private */ } }
    const settings = Object.assign({ view: 'type', hidden: false, statusBar: true, toolbar: true, menus: true, actions: false }, load('settings', {}));
    const disabled = new Set(load('disabled', []));
    const uninstalled = new Set();
    const keyOf = (cat, name) => `${cat}|${name}`;

    /**
     * Devices seen before and gone now come back flagged non-present (Vista's View > Show hidden devices). The record is
     * written only when it changes, and is capped at 400 devices.
     */
    function withHidden(cats) {
        const seen = load('seen', {});
        let changed = false;
        const now = new Set();
        cats.forEach((c) => c.devices.forEach((d, i) => {
            const k = keyOf(c.name, d);
            now.add(k);
            const inf = c.info ? c.info[i] : null; // (a browser's classes have no per-device facts)
            // not remembered: non-present rows the app already reports, and names that change with a reading (the
            // virtual disk's size, a radio's "(turned off)")
            if (inf && (inf.hidden || (inf.live && inf.live.kind === 'quota'))) return;
            if (/\((turned off)\)/.test(d)) return;
            if (!seen[k]) { seen[k] = { cat: c.name, icon: c.icon, name: d }; changed = true; }
        }));
        Object.keys(seen).forEach((k) => {
            if (now.has(k)) return;
            const s = seen[k];
            let c = cats.find((x) => x.name === s.cat);
            if (!c) { c = { name: s.cat, icon: s.icon, devices: [], info: [] }; cats.push(c); }
            c.devices.push(s.name);
            if (!c.info) c.info = c.devices.slice(0, -1).map(() => null);
            c.info.push({ hidden: true, manufacturer: '', location: '' });
        });
        const keys = Object.keys(seen);
        if (keys.length > 400) { keys.slice(0, keys.length - 400).forEach((k) => delete seen[k]); changed = true; }
        if (changed) save('seen', seen);
        cats.sort((a, b) => a.name.localeCompare(b.name));
        return cats;
    }

    // ---------------------------------------------------------------- the console
    let win = null;
    let tree = null;
    let nodes = null;
    let selected = null;
    const expanded = new Set(['root']);

    function computerName() {
        // the phone (or its DeX desktop): the name its owner gave it in Device ID (#829)
        const id = root.melatonDeviceIdentity;
        // (as a host name: melatonHostName, modalUtils.js, #945)
        if (id && root.AndroidHardware) { try { const me = id.get(); if (me && me.name) return typeof root.melatonHostName === 'function' ? root.melatonHostName(me.name) : me.name; } catch (_) { /* host name */ } }
        const n = root.melatonNetworkDialogs ? root.melatonNetworkDialogs.connectionInfo() : null;
        const host = (root.location && root.location.hostname) || 'melaton';
        return `${(n && n.domain) || 'DREAMSCAPE'}-${host.split('.')[0].toUpperCase()}`.slice(0, 15);
    }

    /** A device of the tree: { cat, ci, di, name, info, icon, key, off (disabled), gone (non-present) }. */
    function device(ci, di) {
        const c = tree[ci];
        const info = (c.info && c.info[di]) || {};
        const name = c.devices[di];
        const key = keyOf(c.name, name);
        const iface = info.iface;
        // a Wi-Fi adapter switched off is a disabled adapter (Network Connections' Disable is the same switch)
        const off = disabled.has(key) || (!!iface && iface.kind === 'wifi' && iface.enabled === false);
        return { cat: c.name, ci, di, name, info, icon: c.icon, key, off, gone: !!info.hidden };
    }

    /**
     * The tree as nodes for the view: { id, label, icon, kids, dev, depth }. By type: the computer, the classes, their
     * devices. By connection: the computer, its ACPI system, the buses the devices sit on, the devices. Resources: the
     * resource types and what uses them.
     */
    function buildNodes() {
        const all = [];
        tree.forEach((c, ci) => c.devices.forEach((_, di) => {
            const d = device(ci, di);
            if (uninstalled.has(d.key)) return;
            if (d.gone && !settings.hidden) return;
            all.push(d);
        }));
        const devNode = (d) => ({ id: `d:${d.ci}:${d.di}`, label: d.name, icon: d.icon, dev: d, kids: [] });
        const rootNode = { id: 'root', label: computerName(), icon: `${DEV}/root-16.png`, kids: [] };
        if (settings.view === 'type') {
            tree.forEach((c, ci) => {
                const kids = all.filter((d) => d.ci === ci).map(devNode);
                if (kids.length) rootNode.kids.push({ id: `c:${c.name}`, label: c.name, icon: c.icon, kids });
            });
        } else if (settings.view === 'connection') {
            const pc = all.find((d) => d.cat === 'Computer');
            const acpi = { id: 'n:acpi', label: 'Microsoft ACPI-Compliant System', icon: `${DEV}/system-devices-16.png`, kids: [] };
            const buses = {};
            const bus = (name, icon) => { if (!buses[name]) { buses[name] = { id: `n:${name}`, label: name, icon, kids: [] }; acpi.kids.push(buses[name]); } return buses[name]; };
            const hw = deviceHardware() || {};
            const soc = (hw.soc && (hw.soc.name || hw.soc.model)) || 'System on chip';
            all.forEach((d) => {
                if (d === pc) return;
                const loc = String(d.info.location || '');
                let parent;
                if (/USB/i.test(loc) || d.cat === 'Universal Serial Bus controllers' || d.cat === 'Portable Devices') parent = bus('USB Root Hub', `${DEV}/usb-16.png`);
                else if (d.cat === 'Sensors' || /Sensor hub/.test(loc)) parent = bus('Sensor Hub', `${DEV}/sensors-16.png`);
                else if (d.cat === 'Storage volumes' || d.cat === 'Disk drives') parent = bus('Storage Controller', `${DEV}/storage-controllers-16.png`);
                else if (d.cat === 'Network adapters' && d.info.iface && /^(mobile|ipa)$/.test(d.info.iface.kind)) parent = bus(`${soc} Modem`, `${DEV}/modems-16.png`);
                else if (d.cat === 'Network adapters' && !d.info.iface) parent = bus('Melaton Virtual Bus', `${DEV}/system-devices-16.png`);
                else if (d.cat === 'System devices' || d.cat === 'Batteries' || d.cat === 'Keyboards' || d.cat === 'Security Devices') parent = acpi;
                else parent = bus(`${soc} System on Chip`, `${DEV}/system-devices-16.png`);
                parent.kids.push(devNode(d));
            });
            const top = pc ? Object.assign(devNode(pc), { kids: [acpi] }) : acpi;
            rootNode.kids.push(top);
        } else {
            // resources: Android shows a program no IRQ, DMA or I/O ranges; the memory a computer has is known
            const hw = deviceHardware() || {};
            const total = hw.memory && hw.memory.totalBytes;
            const mem = { id: 'r:mem', label: 'Memory', icon: `${DEV}/res-memory-16.png`, kids: [] };
            const board = all.find((d) => d.cat === 'System devices' && /System Board/.test(d.name)) || all.find((d) => d.cat === 'Computer');
            if (total && board) {
                // 8 hex digits, 16 past 4 GB (Vista x64's ranges)
                const width = total > 0x100000000 ? 16 : 8;
                const hex = (n) => n.toString(16).toUpperCase().padStart(width, '0');
                const range = `[${hex(0)} - ${hex(Math.max(0, total - 1))}] ${board.name}`;
                mem.kids.push(Object.assign(devNode(board), { id: `rm:${board.ci}:${board.di}`, label: range, icon: `${DEV}/res-memory-16.png` }));
            }
            if (settings.view === 'resconnection') {
                const pc = all.find((d) => d.cat === 'Computer');
                const top = pc ? Object.assign(devNode(pc), { kids: [mem] }) : mem;
                rootNode.kids.push(top);
            } else rootNode.kids.push(mem);
        }
        // depth, last-child and the ancestors' lines
        const flat = new Map();
        const walk = (n, depth, lines) => {
            n.depth = depth;
            n.lines = lines;
            flat.set(n.id, n);
            n.kids.forEach((k, i) => { k.last = i === n.kids.length - 1; k.parent = n; walk(k, depth + 1, depth >= 1 ? lines.concat([!n.last]) : lines); });
        };
        rootNode.last = true;
        walk(rootNode, 0, []);
        nodes = flat;
        return rootNode;
    }

    /**
     * MMC's toolbar as the VM's Device Manager: Back, Forward | Show/Hide Console Tree | Properties | Help, Show/Hide
     * Action Pane (mmc.exe bitmap 202); with a device selected, devmgr.dll bitmap 358's Scan for hardware changes, then
     * Update Driver Software, Uninstall and Disable (Enable for a disabled device).
     */
    function renderToolbar() {
        if (!win) return;
        const bar = win.querySelector('.dm-toolbar');
        const n = selected && nodes ? nodes.get(selected) : null;
        const d = n && n.dev;
        const mmc = (tool, i, title, opts = '') => `<button type="button" data-dm-tool="${tool}" title="${title}"${opts}><span class="dm-tb-icon" style="--i:${i}"></span></button>`;
        const own = (tool, i, title, opts = '') => `<button type="button" data-dm-tool="${tool}" title="${title}"${opts}><span class="dm-tb-icon is-devmgr" style="--i:${i}"></span></button>`;
        const sep = '<span class="dm-sep"></span>';
        const html = mmc('back', 0, 'Back', ' disabled') + mmc('forward', 1, 'Forward', ' disabled') + sep
            + mmc('tree', 10, 'Show/Hide Console Tree') + sep
            + (d ? mmc('properties', 8, 'Properties') + sep : '')
            + mmc('help', 15, 'Help') + mmc('actions', 17, 'Show/Hide Action Pane')
            + (d ? sep + own('scan', 0, 'Scan for hardware changes') + sep + own('update', 4, 'Update Driver Software...', d.gone ? ' disabled' : '')
                + own('uninstall', 2, 'Uninstall') + (d.off ? own('enable', 1, 'Enable', d.gone ? ' disabled' : '') : own('disable', 3, 'Disable', d.gone ? ' disabled' : '')) : '');
        if (bar.dataset.html !== html) { bar.innerHTML = html; bar.dataset.html = html; }
        win.classList.toggle('dm-no-toolbar', !settings.toolbar);
        win.classList.toggle('dm-no-status', !settings.statusBar);
        win.classList.toggle('dm-no-menus', !settings.menus);
        win.classList.toggle('dm-has-actions', !!settings.actions);
        // Show/Hide Console Tree: the console's scope pane with the snap-in's one node (devmgr 986 / 989)
        win.classList.toggle('dm-has-scope', !!settings.scope);
        renderActions();
    }

    function rowHtml(n) {
        const kids = n.kids.length > 0;
        const open = kids && expanded.has(n.id);
        const d = n.dev;
        const cls = ['dm-row', kids ? 'has-kids' : '', open ? 'is-open' : '', n.last ? 'is-last' : '', n.id === selected ? 'is-selected' : '', d ? 'is-dev' : '', d && d.gone ? 'is-gone' : ''].filter(Boolean).join(' ');
        // the ancestors' sibling lines (TVS_HASLINES): one per level whose node has more siblings below
        const guides = n.lines.map((on, i) => (on ? `<i class="dm-guide" style="--g:${i + 1}"></i>` : '')).join('');
        // Vista's overlays: the down arrow on a disabled device
        const overlay = d && d.off ? `<img class="dm-overlay" src="${DEV}/overlay-disabled-16.png" srcset="${DEV}/overlay-disabled-32.png 2x" alt="">` : '';
        const row = `<div class="${cls}" data-node="${esc(n.id)}" style="--d:${n.depth}" role="treeitem" aria-expanded="${kids ? open : ''}">${guides}${kids ? '<span class="dm-twisty"></span>' : ''}<span class="dm-icon"><img src="${esc(n.icon)}" alt="">${overlay}</span><span class="dm-label">${esc(n.label)}</span></div>`;
        return row + (open ? n.kids.map(rowHtml).join('') : '');
    }

    function render() {
        if (!win || !tree) return;
        const top = buildNodes();
        if (selected && !nodes.has(selected)) selected = null;
        const body = win.querySelector('.dm-tree');
        body.innerHTML = rowHtml(top);
        renderToolbar();
    }

    // ---------------------------------------------------------------- actions
    const selDevice = () => { const n = selected && nodes ? nodes.get(selected) : null; return n && n.dev ? n.dev : null; };

    /** Update Driver Software: Melaton's drivers come with the system (Android's updates); this one is current. */
    function msgUpToDate(d) {
        callGlobal('showConfirmationDialog', `<p>The best driver software for your device is already installed.</p><p>Melaton has determined the driver software for your device is up to date.</p><p>${esc(d ? d.name : '')}</p>`, [{ text: 'Close', value: true, className: 'btn-standard primary' }], null, { title: 'Update Driver Software', width: 440 });
    }

    /** Scan for hardware changes: devmgr 328's box while the devices are read again; an Uninstall is undone. */
    async function scan() {
        uninstalled.clear();
        const V = root.vistaDialogTemplate;
        let box = null;
        if (V && root.vistaDialogTemplates && root.vistaDialogTemplates['devmgr:328']) box = V.openDialog({ id: 'dmScanning', key: 'devmgr:328', owner: win, bareCaption: true });
        // the Wi-Fi and modem interfaces read again (the app's shell)
        try { const w = root.AndroidWifi; if (w && typeof w.netInterfaces === 'function') w.netInterfaces(); } catch (_) { /* old app */ }
        await new Promise((r) => setTimeout(r, 700));
        await refresh();
        if (box && box.close) box.close(); else if (box && box.modal) callGlobal('closeModal', box.modal);
    }

    /** Disable: Vista's question, then the device is disabled (Wi-Fi: the radio off, as Network Connections' Disable). */
    async function setDisabled(d, off) {
        if (!d || d.gone) return;
        if (off) {
            const ok = await callGlobal('showConfirmationDialog', '<p class="dm-instruction">Disabling this device will cause it to stop functioning. Do you really want to disable it?</p>',
                [{ text: 'Yes', value: true, className: 'btn-standard' }, { text: 'No', value: false, className: 'btn-standard primary' }], null, { title: d.name, icon: 'fas fa-triangle-exclamation', width: 366 });
            if (ok !== true) return false;
        }
        const iface = d.info.iface;
        if (iface && iface.kind === 'wifi' && root.dreamosWifi && typeof root.dreamosWifi.setRadio === 'function') {
            try { await root.dreamosWifi.setRadio(!off); } catch (_) { /* below */ }
        } else if (d.info.miniport && root.melatonControlPanel && typeof root.melatonControlPanel.toggleConnection === 'function') {
            // the Café Miniport's adapter is the Nightshade connection
            const conn = root.melatonNetworkDialogs ? root.melatonNetworkDialogs.connectionInfo() : {};
            if (!!conn.connected === !!off) root.melatonControlPanel.toggleConnection();
        }
        // the Wi-Fi radio is its own record (Network Connections and the tray switch it too); any other device is disabled here
        if (off && !(iface && iface.kind === 'wifi')) disabled.add(d.key); else disabled.delete(d.key);
        save('disabled', Array.from(disabled));
        await refresh();
        return true;
    }

    /** Uninstall: devmgr 210's confirmation; the device leaves the list until Scan for hardware changes. */
    function uninstall(d) {
        if (!d) return;
        const V = root.vistaDialogTemplate;
        if (!V) return;
        V.openDialog({
            id: 'dmUninstall', key: 'devmgr:210', owner: win, bareCaption: true,
            overrides: { 115: { image: d.icon.replace('-16.png', '-32.png') } },
            init(ctx) {
                ctx.text(116, d.name);
                ctx.text(117, 'Warning: You are about to uninstall this device from your system.');
                // Delete the driver software: only for a driver installed apart from the system (none here)
                ctx.show(118, false);
                ctx.show(119, false);
            },
            ok() {
                uninstalled.add(d.key);
                disabled.delete(d.key);
                save('disabled', Array.from(disabled));
                selected = null;
                render();
            }
        });
    }

    function addLegacy() { const cp = root.melatonControlPanel; if (cp && cp.doAction) cp.doAction('dialog:add-hardware'); }

    async function action(a) {
        const d = selDevice();
        switch (a) {
            case 'scan': await scan(); break;
            case 'update': if (d) msgUpToDate(d); break;
            case 'disable': if (d) await setDisabled(d, true); break;
            case 'enable': if (d) await setDisabled(d, false); break;
            case 'uninstall': if (d) uninstall(d); break;
            case 'properties': if (d) openProperties(d); break;
            case 'add-hw': addLegacy(); break;
            case 'help': callGlobal('openHelpAndSupport', 'device-manager'); break;
            case 'techcenter': callGlobal('openHelpAndSupport', 'device-manager'); break;
            case 'tree': settings.scope = !settings.scope; save('settings', settings); renderToolbar(); break;
            case 'actions': settings.actions = !settings.actions; save('settings', settings); renderToolbar(); break;
            case 'customize': await customize(); break;
            case 'options': await options(); break;
            case 'exit': callGlobal('closeModal', win); break;
            case 'about': callGlobal('openAboutMelatoninModal', { program: 'Xyridian Management Console', product: 'Management Console 3.0' }); break;
            case 'about-snapin': callGlobal('openSnapinAbout', { name: 'Device Manager', description: 'You can use Device Manager to view a list of hardware devices installed on your computer and set properties for each device.' }); break;
            default:
                if (a && a.startsWith('view:')) { settings.view = a.slice(5); save('settings', settings); render(); }
                else if (a === 'hidden') { settings.hidden = !settings.hidden; save('settings', settings); render(); }
        }
    }

    /** The Action menu (and a device's context menu, ctx true): devmgr's own items in Vista's order. */
    function actionItems(ctx) {
        const d = selDevice();
        const items = [];
        if (d) {
            items.push({ text: 'Update Driver Software...', action: 'update', disabled: d.gone });
            items.push(d.off ? { text: 'Enable', action: 'enable', disabled: d.gone } : { text: 'Disable', action: 'disable', disabled: d.gone });
            items.push({ text: 'Uninstall', action: 'uninstall' }, { separator: true });
        }
        items.push({ text: 'Scan for hardware changes', action: 'scan' });
        if (!ctx) items.push({ text: 'Add legacy hardware', action: 'add-hw' });
        items.push({ separator: true }, { text: 'Properties', action: 'properties', disabled: !d, className: ctx ? 'context-menu-item-default' : '' });
        if (!ctx) items.push({ separator: true }, { text: 'Help', action: 'help' });
        return items;
    }

    function viewItems() {
        const radio = (text, v) => ({ text, action: `view:${v}`, checked: settings.view === v, showIndicator: true, indicatorMark: 'radio' });
        return [radio('Devices by type', 'type'), radio('Devices by connection', 'connection'), radio('Resources by type', 'restype'), radio('Resources by connection', 'resconnection'),
            { separator: true }, { text: 'Show hidden devices', action: 'hidden', checked: !!settings.hidden, showIndicator: true },
            { separator: true }, { text: 'Customize...', action: 'customize' }];
    }

    function menuItems(which) {
        return {
            file: [{ text: 'Options...', action: 'options' }, { separator: true }, { text: 'Exit', action: 'exit' }],
            action: actionItems(false),
            view: viewItems(),
            // the VM's Device Manager: Help Topics, TechCenter Web Site | About ... Management Console..., About Device Manager...
            help: [{ text: 'Help Topics', action: 'help' }, { text: 'TechCenter Web Site', action: 'techcenter' }, { separator: true }, { text: 'About Xyridian Management Console...', action: 'about' }, { text: 'About Device Manager...', action: 'about-snapin' }]
        }[which];
    }

    /** MMC's Customize View: the parts of the console window a user can hide. */
    async function customize() {
        const parts = [['menus', 'Standard menus (Action and View)'], ['toolbar', 'Standard toolbar'], ['statusBar', 'Status bar']];
        let boxes = null;
        const html = `<p>Select or clear the check boxes to show or hide items in the console window.</p><div class="mmc-dialog-checks">${parts.map(([k, t]) => `<label><input type="checkbox" data-dm-part="${k}"${settings[k] ? ' checked' : ''}> ${esc(t)}</label>`).join('')}</div>`;
        const ok = await callGlobal('showConfirmationDialog', html, [{ text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, {
            title: 'Customize View', icon: 'fas fa-circle-info', width: 360,
            onDialogReady: () => { boxes = Array.from(doc.querySelectorAll('#confirmationDialog [data-dm-part]')); }
        });
        if (ok !== true) return;
        if (!boxes || !boxes.length) boxes = Array.from(doc.querySelectorAll('#confirmationDialog [data-dm-part]'));
        boxes.forEach((b) => { settings[b.dataset.dmPart] = b.checked; });
        save('settings', settings);
        renderToolbar();
    }

    /** File > Options: the console's own options (a saved console's mode); Device Manager opened alone has none to change. */
    async function options() {
        await callGlobal('showConfirmationDialog', '<p><b>Device Manager</b></p><p>Console mode: Author mode</p><p>This console was opened from Control Panel and is not saved, so its options cannot be changed.</p>',
            [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'Options', icon: 'fas fa-circle-info', width: 380 });
    }

    /** MMC 3.0's Action pane: Device Manager's group, then the selected device's (Show/Hide Action Pane). */
    function renderActions() {
        const pane = win && win.querySelector('.dm-actions');
        if (!pane) return;
        if (!settings.actions) { if (pane.dataset.html) { pane.innerHTML = ''; pane.dataset.html = ''; } return; }
        const d = selDevice();
        const list = (items) => items.filter((x) => !x.separator).map((x) => `<div class="dm-act${x.disabled ? ' is-disabled' : ''}" data-dm-act="${esc(x.action)}">${esc(x.text)}</div>`).join('');
        const html = `<div class="dm-act-head">Actions</div><div class="dm-act-group">Device Manager</div>${list([{ text: 'Scan for hardware changes', action: 'scan' }, { text: 'Add legacy hardware', action: 'add-hw' }, { text: 'Help', action: 'help' }])}`
            + (d ? `<div class="dm-act-group">${esc(d.name)}</div>${list(actionItems(true).filter((x) => x.action !== 'scan'))}` : '');
        if (pane.dataset.html !== html) { pane.innerHTML = html; pane.dataset.html = html; }
    }

    // ---------------------------------------------------------------- Properties

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

    /** M/D/YYYY as Vista writes a driver date. */
    const usDate = (iso) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(iso || '')); return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : ''; };

    /** The driver's facts: Android's kernel and build for a phone's devices, the browser's for a plain computer. */
    function driverFacts(d) {
        const hw = deviceHardware() || {};
        const dev = hw.device || {};
        const maker = String(dev.manufacturer || '').replace(/^\w/, (c) => c.toUpperCase());
        const iface = d.info.iface;
        const kernel = String(dev.kernel || '').split('-')[0];
        const driver = (iface && iface.driver) || d.info.driver || '';
        return {
            provider: d.info.driverProvider || (/^Qualcomm/.test(d.name) ? 'Qualcomm' : d.info.manufacturer && !/^\(/.test(d.info.manufacturer) ? d.info.manufacturer : maker || 'Xyridian'),
            date: usDate(dev.securityPatch) || '6/21/2006',
            version: kernel || '6.0.6002.18005',
            signer: maker ? `${maker} (${dev.buildId || 'Android'})` : 'Xyridian Melaton',
            driver,
            files: driver ? [`/sys/bus/${/pci/.test(driver) ? 'pci' : 'platform'}/drivers/${driver}`] : []
        };
    }

    /** Vista's General status text for a device's state (devmgr 1030 / 1020 + 1333, setupapi code 45). */
    function statusText(d) {
        if (d.gone) return 'Currently, this hardware device is not connected to the computer. (Code 45)\r\n\r\nTo fix this problem, reconnect this hardware device to the computer.';
        if (d.off) return 'This device is disabled. (Code 22)\r\n\r\nClick Enable Device to enable this device.';
        return 'This device is working properly.';
    }

    /** Details: Vista's property names (devmgr 600-664) and their values for this device, then what the device reports. */
    function detailsProps(d, drv) {
        const [cls, guid, en] = classOf(d.cat);
        const iface = d.info.iface;
        const hwId = `${en}\\${iface ? `NET_${slug(iface.name)}` : slug(d.name)}`;
        const inst = `${hwId}\\${(d.di + 1).toString(16).toUpperCase().padStart(4, '0')}`;
        const sibs = tree[d.ci].devices.filter((_, i) => i !== d.di).slice(0, 8);
        const status = d.gone ? '' : ['DN_DRIVER_LOADED', 'DN_STARTED', 'DN_DISABLEABLE', 'DN_NT_ENUMERATOR', 'DN_NT_DRIVER'].concat(d.off ? ['DN_HAS_PROBLEM'] : []).join('\n');
        const list = [
            ['Device description', d.name], ['Hardware Ids', hwId], ['Compatible Ids', `${en}\\${slug(cls)}`], ['Service', drv.driver],
            ['Device class', cls], ['Device class guid', guid], ['Driver key', `${guid}\\${d.di.toString().padStart(4, '0')}`],
            ['ConfigFlags', d.off ? '00000001\nCONFIGFLAG_DISABLED' : '00000000'], ['Manufacturer', d.info.manufacturer || drv.provider],
            ['Location information', d.info.location || ''], ['Capabilities', '00000060\nCM_DEVCAP_UNIQUEID\nCM_DEVCAP_SURPRISEREMOVALOK'],
            ['Enumerator', en], ['Power data', d.gone ? '' : `Current power state:\nD${d.off ? '3' : '0'}\n\nPower capabilities:\n00000019\nPDCAP_D0_SUPPORTED\nPDCAP_D3_SUPPORTED\nPDCAP_WAKE_FROM_D0_SUPPORTED\n\nPower state mappings:\nS0 -> D0\nS1 -> D3\nS3 -> D3\nS4 -> D3\nS5 -> D3`],
            ['Removal policy', /USB|Storage card/i.test(d.info.location || '') ? '00000003\nExpect surprise removal' : '00000001\nExpect no removal'],
            ['Install state', d.gone ? '' : '00000000\nInstalled'], ['Location paths', d.info.location ? `ACPI(_SB_)#${slug(d.info.location)}` : ''],
            ['Device Instance Path', inst], ['DevNode status', status], ['Problem code', d.off ? '00000016' : d.gone ? '0000002D' : '00000000'],
            ['Parent', d.cat === 'Computer' ? `HTREE\\ROOT\\0` : 'ACPI_HAL\\PNP0C08\\0'], ['Siblings', sibs.join('\n')]
        ];
        // what the device itself reports (the phone's own facts, #829 / #952), under its own names
        const own = (d.info.props || []).filter((p) => p && p[1] != null && p[1] !== '').map((p) => [p[0], String(p[1])]);
        return list.filter((p) => p[1] != null && p[1] !== '').concat(own);
    }

    /** A network adapter's Advanced page (netcfgx 1505): the adapter's real settings, each as the driver reports it. */
    function advancedProps(d) {
        const x = d.info.iface || {};
        const hw = deviceHardware() || {};
        const wifi = hw.wifi || {};
        const out = [];
        if (x.kind === 'wifi') {
            const std = Array.isArray(wifi.standards) ? wifi.standards : [];
            // "802.11n/ac/ax/be", as a Wireless Mode value reads
            out.push(['802.11 mode', std.length ? `802.11${std.map((x) => String(x).replace(/^802\.11/, '')).join('/')}` : '']);
            out.push(['Band', ['2.4 GHz', wifi.band5GHz && '5 GHz', wifi.band6GHz && '6 GHz'].filter(Boolean).join(' / ')]);
            out.push(['Wi-Fi Direct', 'Supported'], ['Wi-Fi Aware', 'Supported']);
        }
        if (x.kind === 'mobile') {
            out.push(['Access point name', x.apn || (x.connected ? '' : 'Not in use')], ['Network type', x.netType || 'Not connected'], ['SIM', x.sim === 'ready' ? 'Ready' : x.sim || '']);
        }
        if (x.kind === 'vpn') out.push(['VPN application', x.vpnApp || '']);
        out.push(['Jumbo Packet', x.mtu ? `${x.mtu} Bytes` : ''], ['Locally Administered Address', '']);
        if (x.mac) out.push(['Permanent Address', String(x.mac).toUpperCase().replace(/:/g, '-')]);
        return out.filter((p) => p[0] === 'Locally Administered Address' || (p[1] != null && p[1] !== ''));
    }

    function openProperties(d) {
        const V = root.vistaDialogTemplate;
        if (!V || !d) return;
        const { name, info } = d;
        const sheet = root.cplDialogs && root.cplDialogs.sheet;
        const open = sheet || ((def) => V.openSheet(def));
        const big = d.icon.replace('-16.png', '-32.png');
        const isNet = d.cat === 'Network adapters' && !!info.iface;
        const valuesTpl = info.live ? valuesTemplate() : null;
        const drv = driverFacts(d);
        // the tabs Vista shows a device of this class: General, Advanced (network adapters), Driver, Details,
        // Resources (adapters, displays, sound, USB and system devices), Power Management (network adapters)
        const pages = [{ key: 'devmgr:103', overrides: { 218: { image: big } } }];
        if (isNet) pages.push({ key: 'netcfgx:1505' });
        pages.push({ key: 'devmgr:106', overrides: { 226: { image: big } } }, { key: 'devmgr:372', overrides: { 373: { image: big } } });
        if (/^(Network adapters|Display adapters|Sound, video and game controllers|Universal Serial Bus controllers|System devices)$/.test(d.cat)) pages.push({ key: 'setupapi:2001', overrides: { 2002: { image: big } } });
        if (isNet) pages.push({ key: 'devmgr:330', overrides: { 331: { image: big } } });
        if (valuesTpl) pages.push({ key: 'devmgr:values', tpl: valuesTpl, overrides: { 373: { image: big } } });
        // DreamOS: the Nightshade adapter's own Server tab after General (and Advanced), the domain controller's last
        // known address (dreamosServerAddress.js; the host keeps it, CaféReady serveraddr.rs)
        const sa = root.dreamosServerAddress;
        const srv = d.cat === 'Network adapters' && info.miniport && sa && sa.available() ? sa.page() : null;
        if (srv) pages.splice(isNet ? 2 : 1, 0, srv);
        const manufacturer = info.manufacturer || (/Melaton|Dreamscape/.test(name) ? 'Xyridian Corporation' : '(Standard system devices)');
        let timer = 0;
        open({
            windowId: 'dmDeviceProperties',
            title: `${name} Properties`,
            icon: d.icon,
            noApply: true,
            pages,
            init(ctx) {
                const P = (k) => ({ 103: 'devmgr:103', 106: 'devmgr:106', 372: 'devmgr:372', 2001: 'setupapi:2001', 330: 'devmgr:330' }[k]);
                pages.forEach((p) => {
                    const nameId = { 'devmgr:103': 219, 'devmgr:106': 227, 'devmgr:372': 374, 'devmgr:values': 374, 'setupapi:2001': 2003, 'devmgr:330': 332 }[p.key];
                    if (nameId) ctx.text(nameId, name, p.key);
                });
                if (srv) sa.wire(ctx, srv.key);
                // ---- General
                ctx.set(220, d.cat, P(103));
                ctx.set(221, manufacturer, P(103));
                ctx.set(357, info.location || (d.gone ? '' : 'on System board'), P(103));
                ctx.set(223, statusText(d), P(103));
                // Troubleshoot / Enable Device: Vista's General shows the one button only for a problem it can fix
                ctx.show(309, d.off && !d.gone, P(103));
                if (d.off) { ctx.text(309, 'Enable Device', P(103)); ctx.enable(309, true, P(103)); }
                ctx.on(309, 'click', async () => { if (await setDisabled(d, false)) ctx.close(); }, P(103));
                // Change settings: the UAC button of an unelevated sheet; Melaton's sheets run elevated
                ctx.show(217, false, P(103));
                // ---- Driver
                ctx.set(385, drv.provider, P(106));
                ctx.set(387, drv.date, P(106));
                ctx.set(389, drv.version, P(106));
                ctx.set(393, drv.signer, P(106));
                // the button texts as devmgr sets them at run time
                ctx.text(379, d.off ? 'Enables the selected device.' : 'Disables the selected device.', P(106));
                ctx.text(378, d.off ? 'Enable' : 'Disable', P(106));
                ctx.enable(394, false, P(106));
                ctx.enable(378, !d.gone, P(106));
                ctx.enable(380, !d.gone, P(106));
                ctx.on(390, 'click', () => driverDetails(d, drv, ctx.modal), P(106));
                ctx.on(380, 'click', () => msgUpToDate(d), P(106));
                ctx.on(378, 'click', async () => { if (await setDisabled(d, !d.off)) ctx.close(); }, P(106));
                ctx.on(382, 'click', () => { ctx.close(); uninstall(d); }, P(106));
                ['devmgr:103', 'devmgr:106', 'devmgr:372'].forEach((p) => {
                    ctx.content.querySelectorAll(`[data-vdt-page="${p}"] input.vdt-edit`).forEach((i) => { i.readOnly = true; });
                });
                // ---- Details: the Property drop-down list (Vista's own, vistaDialogTemplate selectDrop) over the values
                const props = detailsProps(d, drv);
                ctx.options(375, props.map((p, i) => ({ value: String(i), text: p[0] })), '0', P(372));
                const lv = ctx.holder(376, P(372));
                // Vista's value list: one column as wide as the list, no sideways scroll
                lv.classList.add('dm-value-list');
                const showProp = () => {
                    const v = props[Number(ctx.get(375, P(372)))] || ['', ''];
                    lv.querySelector('.vdt-lv-body').innerHTML = String(v[1]).split('\n').map((line, i) => `<div class="vdt-lv-row${i === 0 ? ' is-selected' : ''}"><span>${line ? esc(line) : '&nbsp;'}</span></div>`).join('');
                };
                ctx.on(375, 'change', showProp, P(372));
                showProp();
                // ---- Resources
                if (pages.some((p) => p.key === 'setupapi:2001')) {
                    const R = 'setupapi:2001';
                    const hw = deviceHardware() || {};
                    const total = hw.memory && hw.memory.totalBytes;
                    const board = d.cat === 'System devices' && /System Board/.test(name) && total;
                    ctx.show(2004, !!board, R);
                    ctx.show(2005, !!board, R);
                    ctx.show(2007, !board, R);
                    ctx.show(2006, false, R);
                    ctx.text(2007, d.off ? "This device isn't using any resources because it is not currently enabled." : 'This device does not require any resources.', R);
                    ['2008', '2009', '2014', '2015', '2012', '2013'].forEach((id) => ctx.show(Number(id), false, R));
                    ctx.show(2011, !!board, R);
                    ctx.show(2010, !!board, R);
                    if (board) {
                        ctx.set(2011, true, R);
                        ctx.enable(2011, false, R);
                        ctx.enable(2010, false, R);
                        const hex = (n) => n.toString(16).toUpperCase().padStart(16, '0');
                        const lvr = ctx.holder(2005, R);
                        lvr.classList.add('is-report');
                        lvr.querySelector('.vdt-lv-header').innerHTML = '<span class="vdt-lv-col dm-res-type">Resource type</span><span class="vdt-lv-col">Setting</span>';
                        lvr.querySelector('.vdt-lv-body').innerHTML = `<div class="vdt-lv-row"><span class="dm-res-type"><img src="${DEV}/res-memory-16.png" alt="">Memory Range</span><span>${hex(0)} - ${hex(total - 1)}</span></div>`;
                    }
                    ctx.set(2018, 'No conflicts.', R);
                    const ta = ctx.el(2018, R);
                    if (ta) ta.readOnly = true;
                }
                // ---- Power Management (network adapters): Android powers its radios itself; Vista's warning below
                if (isNet) {
                    const W = 'devmgr:330';
                    ctx.set(338, true, W);
                    ctx.enable(338, false, W);
                    ctx.set(333, false, W);
                    ctx.enable(333, false, W);
                    ctx.show(396, false, W);
                    ctx.text(343, 'Warning: Allowing this device to bring the computer out of standby may cause this computer to periodically wakeup to refresh its network state. If you travel with this computer or run it on a battery, you should not turn on this feature as the machine may awaken at inopportune times or consume the battery.', W);
                    // ---- Advanced: the property list on the left, its value on the right
                    const A = 'netcfgx:1505';
                    const adv = advancedProps(d);
                    ctx.options(1101, adv.map((p, i) => ({ value: String(i), text: p[0] })), '0', A);
                    const showAdv = () => {
                        const i = Number(ctx.get(1101, A) || 0);
                        const p = adv[i] || ['', ''];
                        const none = !p[1];
                        // a value the adapter does not have: the Not Present choice (Locally Administered Address)
                        ctx.show(1103, !none, A);
                        ctx.show(1105, none, A);
                        ctx.show(1106, none, A);
                        ctx.show(1102, false, A);
                        ctx.show(1104, false, A);
                        ctx.show(1111, false, A);
                        if (none) { ctx.set(1105, false, A); ctx.set(1106, true, A); ctx.enable(1105, false, A); ctx.enable(1106, false, A); } else ctx.options(1103, [{ value: '0', text: p[1] }], '0', A);
                    };
                    ctx.on(1101, 'change', showAdv, A);
                    showAdv();
                }
                if (!valuesTpl) return;
                const vlv = ctx.holder(376, 'devmgr:values');
                const body = vlv && vlv.querySelector('.vdt-lv-body');
                if (!body) return;
                body.classList.add('dm-values');
                // the list is built when its rows change; a tick writes only the values that moved (#890)
                let builtKeys = null;
                const paintValues = (rows) => {
                    const keys = rows.length ? rows.map((r) => String(r[0])).join('\n') : '';
                    if (keys !== builtKeys) {
                        body.innerHTML = rows.map(([k, v]) => `<div class="vdt-lv-row dm-value-row"><span class="dm-value-key">${esc(k)}</span><span class="dm-value-val">${esc(v)}</span></div>`).join('')
                            || '<div class="vdt-lv-row"><span>No values</span></div>';
                        builtKeys = keys;
                        return;
                    }
                    const cells = body.querySelectorAll('.dm-value-val');
                    rows.forEach(([, v], i) => {
                        const text = v == null ? '' : String(v);
                        if (cells[i] && cells[i].textContent !== text) cells[i].textContent = text;
                    });
                };
                const draw = () => {
                    // the sheet closed: stop the sensors it started
                    if (!ctx.content.isConnected || ctx.content.closest('.hidden')) { clearInterval(timer); stopLive(); return; }
                    // a hidden page or a phone's screen off: nothing is drawn (#890)
                    if (doc.hidden || doc.documentElement.dataset.screenOff !== undefined) return;
                    const page = ctx.content.querySelector('[data-vdt-page="devmgr:values"]');
                    if (page && page.hidden) return;
                    paintValues(liveValues(info.live));
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

    /** Driver Details (devmgr 110): the driver's files, then the selected file's provider, version, copyright, signer. */
    function driverDetails(d, drv, owner) {
        const V = root.vistaDialogTemplate;
        if (!V) return;
        V.openDialog({
            id: 'dmDriverFiles', key: 'devmgr:110', owner, bareCaption: true,
            overrides: { 303: { image: d.icon.replace('-16.png', '-32.png') } },
            init(ctx) {
                ctx.text(304, d.name);
                ctx.show(247, false);
                const lv = ctx.holder(228);
                const body = lv && lv.querySelector('.vdt-lv-body');
                if (body) {
                    body.innerHTML = drv.files.length
                        ? drv.files.map((f, i) => `<div class="vdt-lv-row${i === 0 ? ' is-selected' : ''}"><span><img src="${DEV}/driver-file-16.png" srcset="${DEV}/driver-file-32.png 2x" alt="">${esc(f)}</span></div>`).join('')
                        : '<div class="vdt-lv-row"><span>No driver files are required or have been loaded for this device.</span></div>';
                }
                ctx.text(229, drv.files.length ? drv.provider : '');
                ctx.text(230, drv.files.length ? `${drv.version} (kernel)` : '');
                ctx.text(231, drv.files.length ? 'Not available' : '');
                ctx.text(232, drv.files.length ? drv.signer : '');
            }
        });
    }

    // ---------------------------------------------------------------- the window
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
                <div class="naxt-menubar dm-menubar" role="menubar" data-win32-menus><button type="button" class="naxt-menu-title" data-dm-menu="file">File</button><button type="button" class="naxt-menu-title dm-std-menu" data-dm-menu="action">Action</button><button type="button" class="naxt-menu-title dm-std-menu" data-dm-menu="view">View</button><button type="button" class="naxt-menu-title" data-dm-menu="help">Help</button></div>
                <div class="dm-toolbar" role="toolbar"></div>
                <div class="dm-body"><div class="dm-scope" role="tree"><div class="dm-scope-row is-selected"><img src="${ITEMS}/device-manager-16.png" alt=""><span>Device Manager on local computer</span></div></div><div class="dm-tree" role="tree" tabindex="0"></div><div class="dm-actions"></div></div>
                <div class="dm-status"><span></span><span></span><span></span></div>
            </div>`;
        doc.body.appendChild(win);
        win.querySelector('.dm-close').addEventListener('click', () => callGlobal('closeModal', win));
        // attached up front: contextMenu opens them on click, and hovering another title while one is open switches to it
        win.querySelectorAll('[data-dm-menu]').forEach(attachMenu);
        const treeEl = win.querySelector('.dm-tree');
        const select = (row) => {
            selected = row ? row.dataset.node : null;
            win.querySelectorAll('.dm-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
            if (row) { row.classList.add('is-selected'); row.scrollIntoView({ block: 'nearest' }); }
            renderToolbar();
        };
        treeEl.addEventListener('mousedown', (ev) => {
            const row = ev.target.closest('.dm-row');
            if (row) select(row);
        });
        treeEl.addEventListener('click', (ev) => {
            const row = ev.target.closest('.dm-row');
            if (row && ev.target.closest('.dm-twisty')) toggle(row.dataset.node);
        });
        treeEl.addEventListener('dblclick', (ev) => {
            const row = ev.target.closest('.dm-row');
            if (!row || ev.target.closest('.dm-twisty')) return;
            const n = nodes.get(row.dataset.node);
            if (n && n.dev) openProperties(n.dev); else if (n) toggle(n.id);
        });
        treeEl.addEventListener('keydown', (ev) => {
            const rows = Array.from(treeEl.querySelectorAll('.dm-row'));
            const cur = treeEl.querySelector('.dm-row.is-selected');
            const i = rows.indexOf(cur);
            const n = cur ? nodes.get(cur.dataset.node) : null;
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); select(rows[Math.max(0, Math.min(rows.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))] || rows[0]); return; }
            if (!n) return;
            if (ev.key === 'Enter' && n.dev) openProperties(n.dev);
            else if (ev.key === 'ArrowRight' && n.kids.length && !expanded.has(n.id)) toggle(n.id);
            else if (ev.key === 'ArrowLeft' && expanded.has(n.id) && n.kids.length) toggle(n.id);
            else if (ev.key === 'ArrowLeft' && n.parent) { const p = treeEl.querySelector(`.dm-row[data-node="${CSS.escape(n.parent.id)}"]`); if (p) select(p); }
            else if (ev.key === 'Delete' && n.dev) uninstall(n.dev);
            else if (ev.key === 'F5') { ev.preventDefault(); void scan(); }
        });
        // a device's context menu (Vista's: Update Driver Software, Disable, Uninstall | Scan | Properties in bold);
        // on a class or the computer: Scan for hardware changes, Properties greyed
        if (root.contextMenu) {
            root.contextMenu.attachToElement(treeEl, {
                onAction: (a) => void action(a),
                sections: [{ type: 'list', initfn: (s) => { s.items = actionItems(true); } }]
            });
        }
        win.querySelector('.dm-toolbar').addEventListener('click', (ev) => {
            const tool = ev.target.closest('[data-dm-tool]');
            if (tool && !tool.disabled) void action(tool.dataset.dmTool);
        });
        win.querySelector('.dm-actions').addEventListener('click', (ev) => {
            const a = ev.target.closest('.dm-act');
            if (a && !a.classList.contains('is-disabled')) void action(a.dataset.dmAct);
        });
        treeEl.addEventListener('contextmenu', (ev) => { const row = ev.target.closest('.dm-row'); if (row) select(row); }, true);
    }

    function toggle(id) {
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        render();
    }

    function attachMenu(btn) {
        const cm = root.contextMenu;
        if (!cm) return;
        const config = {
            sections: [{ type: 'list', items: [], initfn: (s) => { s.items = menuItems(btn.dataset.dmMenu); } }],
            onAction: (a) => void action(a)
        };
        cm.attachClickMenuToElement(btn, config);
    }

    async function refresh() {
        tree = withHidden(await categories());
        render();
    }

    async function openDeviceManager() {
        if (!doc) return;
        if (!win) build();
        callGlobal('openModal', win);
        win.classList.remove('hidden');
        // DreamOS: the Nightshade adapter's Server tab, ready by the time its Properties open
        if (root.DreamOSServerAddress && root.featureLoader && typeof root.featureLoader.loadFeature === 'function') void root.featureLoader.loadFeature('dreamos_server_address');
        await refresh();
    }

    /** (#952) Network Connections' Configure...: a network adapter's own Properties sheet, by its kernel name (the
     *  Café Miniport's: 'miniport'). false when this computer has no such adapter. */
    async function openAdapter(ifaceName) {
        const fl = root.featureLoader;
        await Promise.resolve(fl && typeof fl.loadFeature === 'function' ? fl.loadFeature('vista_dialog_templates') : null);
        if (ifaceName === 'miniport' && root.DreamOSServerAddress && fl && typeof fl.loadFeature === 'function') await fl.loadFeature('dreamos_server_address');
        tree = withHidden(await categories());
        const ci = tree.findIndex((c) => c.name === 'Network adapters');
        if (ci < 0) return false;
        const infos = tree[ci].info || [];
        let di = infos.findIndex((i) => i && (ifaceName === 'miniport' ? i.miniport : i.iface && (i.iface.name === ifaceName || i.iface.alias === ifaceName)));
        // a browser's list has no per-device facts: the Miniport by its name
        if (di < 0 && ifaceName === 'miniport') di = tree[ci].devices.findIndex((n, i) => / Miniport /.test(` ${n} `) && !(infos[i] && infos[i].hidden));
        if (di < 0) return false;
        openProperties(device(ci, di));
        return true;
    }

    root.openDeviceManager = openDeviceManager;
    root.melatonDeviceManager = { open: openDeviceManager, openAdapter, categories, gpuName, computerName, deviceHardware, sizeText, processorRows, archOf, installedRam, screenSize };
})(typeof window !== 'undefined' ? window : globalThis);
