/*
 * The device client's sound devices for Control Panel > Sound (#963): Playback / Recording list the speakers,
 * headphones, microphones, HDMI and Bluetooth audio of the computer the page runs on, as Vista's mmsys.cpl lists its
 * endpoints. Contract (docs/client-api/tray-providers.md "audio devices"):
 *
 *   melatonAudioDevices.platform()            'android' | 'dreamos' | 'browser'
 *   melatonAudioDevices.list(flow)            flow 'playback' | 'recording': [device] in Vista's order (default first)
 *   melatonAudioDevices.onChange(fn)          fn() on every pushed change; returns unsubscribe. The platform is told to
 *                                             push only while someone listens (the Sound dialog is open)
 *   melatonAudioDevices.setDefault(id)        Promise<{ error? }>
 *   melatonAudioDevices.setLevel(id, patch)   patch { volume?: 0-100, muted?: bool }: Promise<{ error? }>
 *   melatonAudioDevices.rename(id, name)      the name shown in the list (kept on this computer, as Vista keeps it)
 *   melatonAudioDevices.setFormat(id, f)      f { bits, rate }: the device's Default Format (DreamOS); Promise<{ error? }>
 *   melatonAudioDevices.speakers()            the Speakers' Enhancements tuning (DreamOS on the MacBook Pro 11,x, CaféReady
 *                                             speakers.rs) or null; setSpeakers(patch) -> Promise<{ error? }>
 *
 * A device: { id, flow, kind, name, description, state: 'working' | 'unplugged' | 'disconnected', isDefault,
 *   canSetDefault, setDefaultNote, volume (0-100 | null), muted (bool | null), canSetVolume, canMute,
 *   controller: { name, vendor }, jacks: [text], format: { channels, bits, rate } | null, formats: [format], canSetFormat,
 *   dsp (the Speakers filter: its Enhancements tab) }
 * kind is the picture: speakers | headphones | headset | handset | microphone | line | digital | hdmi.
 *
 * Sources, each pushed by its platform and never polled:
 *   Android   window.AndroidAudioDevices (DSApp AudioDevicesBridge): AudioManager's outputs / inputs, where media plays,
 *             the communication device and the mic mute; 'androidaudiodevices' while watch(true). Paired Bluetooth
 *             audio devices that are not connected (the tray's bluetooth provider) are the Disconnected ones.
 *   DreamOS   window.DreamOSAudio (CaféReady audio.rs): PipeWire's sinks and sources in its state's outputs / inputs,
 *             pushed as 'dreamosaudio'.
 *   browser   one output and one input named after the browser, as before (#963 keeps it).
 */
(function (root) {
    'use strict';

    const NAMES_KEY = 'melaton-audio-device-names';
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : (s && typeof s === 'object' ? s : null); } catch (_) { return null; } };
    const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

    // ---- names (Vista's endpoint names: the KS pin category; the hardware under it) --------------------------------

    function storedNames() {
        try { return JSON.parse(root.localStorage.getItem(NAMES_KEY) || '{}') || {}; } catch (_) { return {}; }
    }

    // Vista's Default Format strings (mmsys 345 / 346) and its quality names
    function quality(bits, rate) {
        if (rate <= 8000) return 'Telephone Quality';
        if (rate <= 11025) return 'Dictation Quality';
        if (rate <= 22050) return 'FM Radio Quality';
        if (bits <= 16 && rate === 44100) return 'CD Quality';
        if (bits <= 16 && rate === 48000) return 'DVD Quality';
        return 'Studio Quality';
    }

    function formatText(f, flow) {
        if (!f || !f.rate) return '';
        const bits = f.bits || 16;
        const head = flow === 'recording' ? `${f.channels || 2} channel, ` : '';
        return `${head}${bits} bit, ${f.rate} Hz (${quality(bits, f.rate)})`;
    }

    function sortDevices(list) {
        // Vista: the default first, then working devices, then the rest, each by name
        const rank = (d) => (d.isDefault ? 0 : d.state === 'working' ? 1 : 2);
        return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    }

    function capital(s) {
        const t = String(s || '').trim();
        return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
    }

    // ---- Android -------------------------------------------------------------------------------------------------

    // AudioDeviceInfo types (DSApp's names, HardwareInfoBridge.audioType): the Vista name per flow, the picture, the
    // controller line and the jack. Internal plumbing (telephony, remote submix, echo reference, bus, ip) is not shown.
    const ANDROID = {
        builtin_speaker: { out: 'Speakers', kind: 'speakers', ctl: 'Built-in speaker', jack: 'Integrated Device' },
        builtin_earpiece: { out: 'Handset', kind: 'handset', ctl: 'Built-in earpiece', jack: 'Integrated Device' },
        builtin_mic: { in: 'Microphone', kind: 'microphone', ctl: 'Built-in microphone', jack: 'Integrated Device' },
        wired_headphones: { out: 'Headphones', kind: 'headphones', ctl: 'Wired headphones', jack: '3.5 mm Jack' },
        wired_headset: { out: 'Headset Earphone', in: 'Headset Microphone', kind: 'headset', ctl: 'Wired headset', jack: '3.5 mm Jack' },
        line_analog: { out: 'Line Out', in: 'Line In', kind: 'line', ctl: 'Analog line', jack: 'Analog Jack' },
        line_digital: { out: 'Digital Output Device (SPDIF)', in: 'Digital Input Device (SPDIF)', kind: 'digital', ctl: 'Digital line (S/PDIF)', jack: 'Digital Jack' },
        hdmi: { out: 'Digital Output Device (HDMI)', in: 'Digital Input Device (HDMI)', kind: 'hdmi', ctl: 'HDMI / DisplayPort audio', jack: 'HDMI' },
        hdmi_arc: { out: 'Digital Output Device (HDMI)', kind: 'hdmi', ctl: 'HDMI audio return channel', jack: 'HDMI' },
        hdmi_earc: { out: 'Digital Output Device (HDMI)', kind: 'hdmi', ctl: 'HDMI enhanced audio return channel', jack: 'HDMI' },
        usb_device: { out: 'Speakers', in: 'Microphone', kind: 'speakers', inKind: 'microphone', ctl: 'USB audio device' },
        usb_accessory: { out: 'Speakers', in: 'Microphone', kind: 'speakers', inKind: 'microphone', ctl: 'USB audio accessory' },
        usb_headset: { out: 'Headset Earphone', in: 'Headset Microphone', kind: 'headset', ctl: 'USB headset' },
        dock: { out: 'Speakers', in: 'Line In', kind: 'speakers', inKind: 'line', ctl: 'Dock audio', jack: 'Jack' },
        dock_analog: { out: 'Speakers', kind: 'speakers', ctl: 'Dock audio (analog)', jack: 'Analog Jack' },
        bluetooth_a2dp: { out: 'Headphones', kind: 'headphones', ctl: 'Bluetooth audio (A2DP)' },
        bluetooth_sco: { out: 'Headset Earphone', in: 'Headset Microphone', kind: 'headset', ctl: 'Bluetooth hands-free (SCO)' },
        ble_headset: { out: 'Headset Earphone', in: 'Headset Microphone', kind: 'headset', ctl: 'Bluetooth LE Audio headset' },
        ble_speaker: { out: 'Speakers', kind: 'speakers', ctl: 'Bluetooth LE Audio speaker' },
        ble_broadcast: { out: 'Speakers', kind: 'speakers', ctl: 'Bluetooth LE Audio broadcast' },
        hearing_aid: { out: 'Headphones', kind: 'headphones', ctl: 'Hearing aid' },
        fm_tuner: { in: 'Line In', kind: 'line', ctl: 'FM radio tuner', jack: 'Integrated Device' },
        tv_tuner: { in: 'Line In', kind: 'line', ctl: 'TV tuner', jack: 'Integrated Device' },
        aux_line: { out: 'Line Out', kind: 'line', ctl: 'Auxiliary line', jack: 'Analog Jack' }
    };
    const BT_TYPES = ['bluetooth_a2dp', 'bluetooth_sco', 'ble_headset', 'ble_speaker', 'ble_broadcast', 'hearing_aid'];
    // Bluetooth major class AUDIO_VIDEO (0x400): loudspeaker / car audio / hi-fi play as Speakers, the rest Headphones
    const BT_SPEAKER_CLASSES = [0x0414, 0x0420, 0x0428, 0x042C, 0x0434];
    // a headset's input pairs with the output Android calls the communication device
    const COMM_PAIR = { bluetooth_sco: 'bluetooth_sco', ble_headset: 'ble_headset', wired_headset: 'wired_headset', usb_headset: 'usb_headset' };
    // where Android records from when no app asks: a plugged headset's mic first, else the phone's own
    const INPUT_ORDER = ['usb_headset', 'usb_device', 'usb_accessory', 'wired_headset', 'builtin_mic'];
    // AudioFormat encodings: bits
    const ENC_BITS = { 2: 16, 3: 8, 4: 32, 21: 24, 22: 32 };

    function androidDeviceName(st) {
        const d = (st && st.device) || {};
        const maker = capital(d.manufacturer);
        const market = String(d.marketName || d.model || '').trim();
        if (!market) return maker || 'Android device';
        return maker && !market.toLowerCase().startsWith(maker.toLowerCase()) ? `${maker} ${market}` : market;
    }

    function androidFormats(d, flow) {
        const rates = (Array.isArray(d.rates) ? d.rates : []).map(Number).filter((r) => r > 0);
        const chans = (Array.isArray(d.channels) ? d.channels : []).map(Number).filter((c) => c > 0);
        const bitsList = [...new Set((Array.isArray(d.encodings) ? d.encodings : []).map((e) => ENC_BITS[e]).filter(Boolean))].sort((a, b) => a - b);
        // an empty list from Android means "anything": the mixer's 48 kHz stereo 16 bit
        const r = rates.length ? [...new Set(rates)].sort((a, b) => a - b) : [48000];
        const c = chans.length ? Math.max(...chans) : (flow === 'recording' ? 1 : 2);
        const b = bitsList.length ? bitsList : [16];
        const all = [];
        b.forEach((bits) => r.forEach((rate) => all.push({ channels: Math.min(c, flow === 'recording' ? 2 : 8), bits: Math.min(bits, 24), rate })));
        const uniq = [];
        all.forEach((f) => { if (!uniq.some((u) => u.bits === f.bits && u.rate === f.rate && u.channels === f.channels)) uniq.push(f); });
        // the mixer runs at 48 kHz 16 bit where the device takes it (AudioFlinger's primary output)
        const def = uniq.find((f) => f.rate === 48000 && f.bits === 16) || uniq.find((f) => f.rate === 48000) || uniq[0] || null;
        return { format: def, formats: uniq };
    }

    function androidSource() {
        const B = root.AndroidAudioDevices;
        if (!B || typeof B.get !== 'function') return null;
        let st = parse((() => { try { return B.get(); } catch (_) { return null; } })());
        const fns = [];
        let watching = false;
        let btOff = null;
        root.addEventListener('androidaudiodevices', (e) => {
            const next = parse(e && e.detail);
            if (!next) return;
            st = next;
            fns.slice().forEach((fn) => { try { fn(); } catch (err) { console.error('[audioDevices]', err); } });
        }, { signal: appScopeSignal });
        const bt = () => {
            const t = root.melatonTray;
            const p = t && typeof t.provider === 'function' ? t.provider('bluetooth') : null;
            try { return p && p.get ? p.get() : null; } catch (_) { return null; }
        };

        function list(flow) {
            if (!st) return [];
            const here = androidDeviceName(st);
            const raw = (flow === 'playback' ? st.outputs : st.inputs) || [];
            const media = st.media || {};
            const out = [];
            const seen = new Set();
            // builtin mics come one per element (bottom / top / back): Vista shows the array as one endpoint
            const mics = raw.filter((d) => d.type === 'builtin_mic');
            raw.forEach((d) => {
                const t = ANDROID[d.type];
                if (!t || !(flow === 'playback' ? t.out : t.in)) return;
                // the speaker's "safe" twin is the same speaker
                if (d.type === 'builtin_mic' && d !== mics[0]) return;
                const key = `${d.type}|${d.address || ''}`;
                if (seen.has(key)) return;
                seen.add(key);
                const bluetooth = BT_TYPES.includes(d.type);
                let name = flow === 'playback' ? t.out : t.in;
                let kind = flow === 'recording' && t.inKind ? t.inKind : t.kind;
                if (d.type === 'builtin_mic' && mics.length > 1) name = 'Microphone Array';
                if (d.type === 'bluetooth_a2dp' && BT_SPEAKER_CLASSES.includes(Number(d.btClass))) { name = 'Speakers'; kind = 'speakers'; }
                const product = String(d.name || '').trim();
                const builtin = /^builtin_/.test(d.type) || d.type === 'fm_tuner' || d.type === 'tv_tuner';
                const model = st.device && st.device.model;
                const description = builtin || !product || product === model ? (bluetooth ? 'Bluetooth Audio' : here) : product;
                const fm = androidFormats(d, flow);
                const dev = {
                    id: `a${d.id}`, nativeId: d.id, type: d.type, address: d.address || '', flow, kind, name, description,
                    state: 'working', isDefault: false, canSetDefault: false, setDefaultNote: '',
                    volume: null, muted: null, canSetVolume: false, canMute: false,
                    controller: { name: `${t.ctl}${d.type === 'builtin_mic' && mics.length > 1 ? ` (${mics.length} microphones)` : ''}`, vendor: bluetooth && d.address ? `Bluetooth ${String(d.address).toUpperCase()}` : (builtin ? capital(st.device && st.device.manufacturer) || 'Android' : (product || 'Android')) },
                    jacks: t.jack ? [t.jack] : [],
                    format: fm.format, formats: fm.formats,
                    platform: 'android'
                };
                if (flow === 'playback') {
                    dev.isDefault = media.id !== undefined && media.id !== null && Number(media.id) === Number(d.id);
                    if (dev.isDefault) {
                        dev.volume = num(media.pct);
                        dev.muted = !!media.muted;
                        dev.canSetVolume = dev.canMute = typeof B.setMedia === 'function';
                    }
                    dev.setDefaultNote = 'Android chooses where media plays: the newest headphones or Bluetooth device, else the speaker.';
                } else {
                    dev.muted = !!st.micMuted;
                    dev.canMute = typeof B.setMicMute === 'function';
                    const pair = COMM_PAIR[d.type];
                    const commIds = (Array.isArray(st.canComm) ? st.canComm : []).map(Number);
                    const partner = pair && (st.outputs || []).find((o) => o.type === pair && (o.address || '') === (d.address || '') && commIds.includes(Number(o.id)));
                    dev.commPartner = partner ? partner.id : (d.type === 'builtin_mic' ? -1 : null);
                    dev.canSetDefault = dev.commPartner !== null && typeof B.setCommunicationDevice === 'function';
                    if (!dev.canSetDefault) dev.setDefaultNote = 'Android records from this device only when it chooses to.';
                }
                out.push(dev);
            });
            if (flow === 'recording' && out.length) {
                // the communication device's microphone when one is chosen, else Android's own order
                const comm = num(st.comm);
                let def = comm !== null ? out.find((d) => d.commPartner !== null && d.commPartner !== -1 && Number(d.commPartner) === comm) : null;
                if (!def) for (const t of INPUT_ORDER) { def = out.find((d) => d.type === t); if (def) break; }
                (def || out[0]).isDefault = true;
            }
            if (flow === 'playback') {
                // paired Bluetooth audio that is not connected: Vista's Disconnected; Set Default connects it
                const b = bt();
                const connectedAddrs = new Set(out.filter((d) => d.address).map((d) => String(d.address).toUpperCase()));
                ((b && b.devices) || []).forEach((p) => {
                    if (p.kind !== 'audio' || p.connected || connectedAddrs.has(String(p.id).toUpperCase())) return;
                    out.push({
                        id: `bt${p.id}`, btId: p.id, type: 'bluetooth_a2dp', address: p.id, flow, kind: 'headphones', name: 'Headphones',
                        description: p.name || p.id, state: 'disconnected', isDefault: false, canSetDefault: true,
                        setDefaultNote: '', volume: null, muted: null, canSetVolume: false, canMute: false,
                        controller: { name: ANDROID.bluetooth_a2dp.ctl, vendor: `Bluetooth ${String(p.id).toUpperCase()}` },
                        jacks: [], format: null, formats: [], platform: 'android'
                    });
                });
            }
            return out;
        }

        return {
            id: 'android',
            list,
            watch(on) {
                if (on === watching) return;
                watching = on;
                try { if (typeof B.watch === 'function') B.watch(!!on); } catch (_) { /* old app */ }
                if (on) {
                    // a fresh read when the dialog opens: the app pushed nothing while nobody listened
                    const fresh = parse((() => { try { return B.get(); } catch (_) { return null; } })());
                    if (fresh) st = fresh;
                    const t = root.melatonTray;
                    if (t && typeof t.onChange === 'function') btOff = t.onChange('bluetooth', () => fns.slice().forEach((fn) => fn()));
                } else if (btOff) { btOff(); btOff = null; }
            },
            subscribe(fn) { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
            setDefault(dev) {
                if (dev.btId) {
                    const t = root.melatonTray;
                    const p = t && t.provider('bluetooth');
                    return p && typeof p.connect === 'function' ? Promise.resolve(p.connect(dev.btId)) : Promise.resolve({ error: 'Bluetooth is not available.' });
                }
                if (dev.flow !== 'recording' || dev.commPartner === null || dev.commPartner === undefined) return Promise.resolve({ error: dev.setDefaultNote || 'Android does not allow it.' });
                let ok = false;
                try { ok = !!B.setCommunicationDevice(Number(dev.commPartner)); } catch (_) { ok = false; }
                return Promise.resolve(ok ? {} : { error: 'Android refused to use this device.' });
            },
            setLevel(dev, patch) {
                try {
                    if (dev.flow === 'recording') {
                        if (patch.muted !== undefined) st = parse(B.setMicMute(!!patch.muted)) || st;
                        return Promise.resolve({});
                    }
                    if (!dev.isDefault) return Promise.resolve({ error: 'Android sets the level of the device media plays on.' });
                    const pct = num(patch.volume);
                    const next = parse(B.setMedia(pct === null ? -1 : Math.max(0, Math.min(100, Math.round(pct))), patch.muted === undefined ? -1 : (patch.muted ? 1 : 0)));
                    if (next) st = next;
                    return Promise.resolve({});
                } catch (err) {
                    return Promise.resolve({ error: String((err && err.message) || err) });
                }
            }
        };
    }

    // ---- DreamOS (PipeWire through CaféReady) ----------------------------------------------------------------------

    function linuxKind(d, flow) {
        const port = d.port || {};
        const hay = `${port.type || ''} ${port.name || ''} ${d.formFactor || ''} ${d.name || ''}`.toLowerCase();
        if (/hdmi|displayport|\bdp\b/.test(hay)) return flow === 'playback' ? ['Digital Output Device (HDMI)', 'hdmi'] : ['Digital Input Device (HDMI)', 'hdmi'];
        if (/spdif|iec958|optical|digital/.test(hay)) return flow === 'playback' ? ['Digital Output Device (SPDIF)', 'digital'] : ['Digital Input Device (SPDIF)', 'digital'];
        if (/headset|handsfree|hands-free|headset-head-unit|hfp|hsp/.test(hay)) return flow === 'playback' ? ['Headset Earphone', 'headset'] : ['Headset Microphone', 'headset'];
        if (/handset/.test(hay)) return ['Handset', 'handset'];
        if (/headphone/.test(hay)) return ['Headphones', 'headphones'];
        if (/line/.test(hay)) return flow === 'playback' ? ['Line Out', 'line'] : ['Line In', 'line'];
        if (flow === 'recording') return [/array/.test(hay) ? 'Microphone Array' : 'Microphone', 'microphone'];
        if (d.api === 'bluez5' || d.bus === 'bluetooth') return /speaker|car|hifi/.test(hay) ? ['Speakers', 'speakers'] : ['Headphones', 'headphones'];
        return ['Speakers', 'speakers'];
    }

    function linuxJack(d) {
        const port = d.port || {};
        const hay = `${port.type || ''} ${port.name || ''}`.toLowerCase();
        if (d.api === 'bluez5' || d.bus === 'bluetooth' || d.bus === 'usb') return [];
        if (/hdmi|displayport/.test(hay)) return ['HDMI'];
        if (/spdif|iec958/.test(hay)) return ['Digital Jack'];
        if (/speaker|internal|builtin|mic(?!.*jack)/.test(hay) && !/headphone|headset|line/.test(hay)) return ['Integrated Device'];
        if (/headphone|headset|line|mic/.test(hay)) return ['3.5 mm Jack'];
        return [];
    }

    function dreamosSource() {
        const A = root.DreamOSAudio;
        if (!A || typeof A.get !== 'function') return null;
        const fns = [];
        let asked = false;
        root.addEventListener('dreamosaudio', () => fns.slice().forEach((fn) => { try { fn(); } catch (err) { console.error('[audioDevices]', err); } }), { signal: appScopeSignal });
        const state = () => { try { return A.get() || {}; } catch (_) { return {}; } };
        function list(flow) {
            const st = state();
            const raw = (flow === 'playback' ? st.outputs : st.inputs) || [];
            return raw.map((d) => {
                const [name, kind] = linuxKind(d, flow);
                const port = d.port || {};
                const bits = num(d.bits) || (/s24/i.test(String(d.format || '')) ? 24 : /s32|f32/i.test(String(d.format || '')) ? 32 : 16);
                const f = d.rate ? { channels: num(d.channels) || 2, bits, rate: Number(d.rate) } : null;
                // what the hardware offers (CaféReady reads the node's EnumFormat); the current one at least
                const offered = Array.isArray(d.formats) ? d.formats.filter((x) => x && num(x.bits) && num(x.rate)).map((x) => ({ channels: num(d.channels) || 2, bits: Number(x.bits), rate: Number(x.rate) })) : [];
                const formats = offered.length ? offered : (f ? [f] : []);
                return {
                    id: `p${d.id}`, nativeId: d.id, flow, kind, name,
                    description: d.description || d.card || d.name || 'Sound device',
                    state: port.available === 'no' ? 'unplugged' : 'working',
                    isDefault: !!d.isDefault, canSetDefault: typeof A.setDefault === 'function' && !d.isDefault, setDefaultNote: '',
                    volume: num(d.volume), muted: d.muted === undefined ? null : !!d.muted,
                    canSetVolume: num(d.volume) !== null, canMute: d.muted !== undefined,
                    controller: {
                        name: d.cardLongName || d.card || d.description || d.name || 'Sound device',
                        vendor: d.api === 'bluez5' || d.bus === 'bluetooth' ? `Bluetooth${d.address ? ` ${String(d.address).toUpperCase()}` : ''}` : (d.bus === 'usb' ? 'USB Audio (ALSA)' : (d.alsaCard !== undefined && d.alsaCard !== null ? `ALSA card ${d.alsaCard}` : 'PipeWire'))
                    },
                    jacks: linuxJack(d),
                    format: f, formats, canSetFormat: offered.length > 1,
                    dsp: !!d.dsp,
                    platform: 'dreamos'
                };
            });
        }
        return {
            id: 'dreamos',
            list,
            watch(on) {
                // the host reads PipeWire's device list when asked (and on a sound uevent); its state then arrives pushed
                if (on && !asked && typeof A.devices === 'function') { asked = true; Promise.resolve(A.devices()).catch(() => {}); }
                if (!on) asked = false;
            },
            subscribe(fn) { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
            setDefault(dev) {
                if (typeof A.setDefault !== 'function') return Promise.resolve({ error: 'This DreamOS version cannot change it.' });
                return Promise.resolve(A.setDefault(dev.nativeId)).then((r) => (r && r.error ? r : {}), (e) => ({ error: String(e) }));
            },
            setLevel(dev, patch) {
                return Promise.resolve(A.set(Object.assign({ id: dev.nativeId }, patch))).then((r) => (r && r.error ? r : {}), (e) => ({ error: String(e) }));
            },
            setFormat(dev, f) {
                return Promise.resolve(A.set({ id: dev.nativeId, format: { bits: Number(f.bits), rate: Number(f.rate) } })).then((r) => (r && r.error ? r : {}), (e) => ({ error: String(e) }));
            },
            speakers() {
                const t = state().speakers;
                return t && typeof t === 'object' ? t : null;
            },
            setSpeakers(patch) {
                return Promise.resolve(A.set({ speakers: patch })).then((r) => (r && r.error ? r : {}), (e) => ({ error: String(e) }));
            }
        };
    }

    // ---- a plain browser: what it showed before #963 ---------------------------------------------------------------

    function browserName() {
        const nav = root.navigator || {};
        const brands = (nav.userAgentData && nav.userAgentData.brands) || [];
        const known = [
            [/Edge/i, 'Microsoft Edge'], [/Opera|OPR/i, 'Opera'], [/Brave/i, 'Brave'], [/Vivaldi/i, 'Vivaldi'],
            [/Yandex/i, 'Yandex Browser'], [/Google Chrome/i, 'Google Chrome']
        ];
        for (const [re, name] of known) if (brands.some((b) => re.test(b.brand))) return name;
        const ua = String(nav.userAgent || '');
        if (/Edg\//.test(ua)) return 'Microsoft Edge';
        if (/OPR\//.test(ua)) return 'Opera';
        if (/Firefox\//.test(ua)) return 'Mozilla Firefox';
        if (/Chrome\//.test(ua)) return brands.some((b) => /Chromium/i.test(b.brand)) && !/Google/i.test(ua) ? 'Chromium' : 'Google Chrome';
        if (/Safari\//.test(ua)) return 'Safari';
        return 'Web Browser';
    }

    function browserSource() {
        const fns = [];
        let hasInput = true;
        let read = false;
        const tv = () => root.tabVolume || null;
        function list(flow) {
            const hw = `${browserName()} Sound Device`;
            const t = tv();
            if (flow === 'playback') {
                return [{
                    id: 'browser-out', flow, kind: 'speakers', name: 'Built-In Sound Output', description: hw, state: 'working',
                    isDefault: true, canSetDefault: false, setDefaultNote: '', volume: t ? t.getLevel() : null, muted: t ? t.isMuted() : null,
                    canSetVolume: !!t, canMute: !!t, controller: { name: hw, vendor: browserName() }, jacks: [],
                    format: { channels: 2, bits: 16, rate: 48000 }, formats: [{ channels: 2, bits: 16, rate: 48000 }], platform: 'browser'
                }];
            }
            return [{
                id: 'browser-in', flow, kind: 'microphone', name: 'Built-In Sound Input', description: hw, state: hasInput ? 'working' : 'unplugged',
                isDefault: hasInput, canSetDefault: false, setDefaultNote: '', volume: null, muted: null, canSetVolume: false, canMute: false,
                controller: { name: hw, vendor: browserName() }, jacks: [], format: null, formats: [], platform: 'browser'
            }];
        }
        return {
            id: 'browser',
            list,
            watch(on) {
                if (!on || read) return;
                read = true;
                // the input: "Not plugged in" when the browser reports no microphone (no permission is asked)
                const md = root.navigator && root.navigator.mediaDevices;
                if (md && typeof md.enumerateDevices === 'function') {
                    md.enumerateDevices().then((l) => {
                        hasInput = l.some((d) => d.kind === 'audioinput');
                        fns.slice().forEach((fn) => fn());
                    }).catch(() => {});
                }
            },
            subscribe(fn) { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
            setDefault() { return Promise.resolve({ error: 'It already is the default device.' }); },
            setLevel(dev, patch) {
                const t = tv();
                if (!t || dev.flow !== 'playback') return Promise.resolve({ error: 'No level.' });
                if (patch.volume !== undefined) t.setLevel(Number(patch.volume));
                if (patch.muted !== undefined) t.setMuted(!!patch.muted);
                return Promise.resolve({});
            }
        };
    }

    // ---- the one in use --------------------------------------------------------------------------------------------

    let src = null;
    function source() {
        if (!src) src = dreamosSource() || androidSource() || browserSource();
        return src;
    }
    const listeners = [];
    let off = null;

    function list(flow) {
        const names = storedNames();
        return sortDevices(source().list(flow === 'recording' ? 'recording' : 'playback').map((d) => {
            const own = names[`${d.platform}:${d.flow}:${d.type || ''}:${d.address || ''}:${d.kind}`];
            return Object.assign(d, { vistaName: d.name, name: own || d.name });
        }));
    }

    function find(id) {
        return list('playback').concat(list('recording')).find((d) => d.id === id) || null;
    }

    const api = {
        platform: () => source().id,
        list,
        find,
        formatText,
        browserName,
        onChange(fn) {
            if (typeof fn !== 'function') return () => {};
            listeners.push(fn);
            if (listeners.length === 1) {
                const s = source();
                off = s.subscribe(() => listeners.slice().forEach((f) => { try { f(); } catch (err) { console.error('[audioDevices]', err); } }));
                s.watch(true);
            }
            return () => {
                const i = listeners.indexOf(fn);
                if (i < 0) return;
                listeners.splice(i, 1);
                if (!listeners.length) {
                    if (off) off();
                    off = null;
                    source().watch(false);
                }
            };
        },
        setDefault(id) {
            const d = find(id);
            return d ? source().setDefault(d) : Promise.resolve({ error: 'The device you are configuring has been removed.' });
        },
        setLevel(id, patch) {
            const d = find(id);
            return d ? source().setLevel(d, patch || {}) : Promise.resolve({ error: 'The device you are configuring has been removed.' });
        },
        setFormat(id, f) {
            const d = find(id);
            const s = source();
            if (!d) return Promise.resolve({ error: 'The device you are configuring has been removed.' });
            return typeof s.setFormat === 'function' ? s.setFormat(d, f || {}) : Promise.resolve({ error: 'The format of this device cannot be changed.' });
        },
        speakers() {
            const s = source();
            return typeof s.speakers === 'function' ? s.speakers() : null;
        },
        setSpeakers(patch) {
            const s = source();
            return typeof s.setSpeakers === 'function' ? s.setSpeakers(patch || {}) : Promise.resolve({ error: 'This device has no enhancements.' });
        },
        rename(id, name) {
            const d = find(id);
            if (!d) return;
            const names = storedNames();
            const key = `${d.platform}:${d.flow}:${d.type || ''}:${d.address || ''}:${d.kind}`;
            const t = String(name || '').trim();
            if (!t || t === d.vistaName) delete names[key]; else names[key] = t;
            try { root.localStorage.setItem(NAMES_KEY, JSON.stringify(names)); } catch (_) { /* private mode */ }
            listeners.slice().forEach((f) => { try { f(); } catch (_) { /* a listener failed */ } });
        },
        _test: { reset: () => { src = null; }, androidDeviceName, linuxKind, quality }
    };
    root.melatonAudioDevices = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
