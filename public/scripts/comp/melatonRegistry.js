/**
 * Melaton's registry on the client (Yozora #632): Control Panel's settings that have nothing else
 * to drive, kept on the server as config.json userGlobalSettings.registry (modules/melatonRegistry.js;
 * Runes edits them there). Loaded with the page so any part of the desktop can read a value.
 *
 *   melatonRegistry.get('HKCU\\Control Panel\\Mouse', 'DoubleClickSpeed', 500)
 *   melatonRegistry.getKey('HKCU\\Control Panel\\Mouse')            -> { name: value } (a copy)
 *   melatonRegistry.set('HKCU\\Control Panel\\Mouse', { DoubleClickSpeed: 400, Old: null })
 *       null deletes a value; set(key, null) deletes the key. Saves through
 *       persistUserGlobalSettingsPatch({ registry }) (modalUtils.js); without a server
 *       connection the change stays in this window until the next load.
 *   melatonRegistry.onChange(fn)    fn(key, values) after a set or a load from the server
 *   melatonRegistry.hydrate(all)    the server's copy (applyUserGlobalSettingsToClient)
 */
(function (root) {
    'use strict';

    const data = {};
    const listeners = [];
    const KEY_RE = /^(HKCU|HKLM|HKCR|HKU|HKCC)(\\[^\\\0]{1,128})*$/;

    function norm(key) {
        const k = String(key || '').trim().replace(/\\+$/, '');
        return KEY_RE.test(k) ? k : null;
    }

    function emit(key) {
        listeners.slice().forEach((fn) => {
            try { fn(key, key ? getKey(key) : null); } catch (err) { console.error('melatonRegistry listener', err); }
        });
    }

    function get(key, name, fallback) {
        const k = norm(key);
        const vals = k && data[k];
        return vals && Object.prototype.hasOwnProperty.call(vals, name) ? vals[name] : fallback;
    }

    function getKey(key) {
        const k = norm(key);
        return k && data[k] ? { ...data[k] } : {};
    }

    /** Keys under a path (one level), as regedit lists subkeys. */
    function subkeys(key) {
        const k = norm(key);
        if (!k) return [];
        const prefix = `${k}\\`;
        const out = new Set();
        Object.keys(data).forEach((p) => {
            if (p.startsWith(prefix)) out.add(p.slice(prefix.length).split('\\')[0]);
        });
        return Array.from(out).sort();
    }

    async function set(key, values) {
        const k = norm(key);
        if (!k) throw new Error(`melatonRegistry: bad key ${key}`);
        if (values === null) {
            delete data[k];
        } else {
            const next = { ...(data[k] || {}) };
            Object.entries(values || {}).forEach(([name, value]) => {
                if (value === null || value === undefined) delete next[name];
                else next[name] = Array.isArray(value) ? value.map(String) : value;
            });
            if (Object.keys(next).length) data[k] = next;
            else delete data[k];
        }
        emit(k);
        const persist = root.persistUserGlobalSettingsPatch;
        if (typeof persist !== 'function') return;
        try {
            await persist({ registry: { [k]: values } });
        } catch (err) {
            console.error('melatonRegistry: saving to the server failed', err);
        }
    }

    function hydrate(all) {
        if (!all || typeof all !== 'object') return;
        Object.keys(data).forEach((k) => { delete data[k]; });
        Object.entries(all).forEach(([k, vals]) => {
            const key = norm(k);
            if (key && vals && typeof vals === 'object') data[key] = { ...vals };
        });
        emit(null);
    }

    function onChange(fn) {
        if (typeof fn === 'function') listeners.push(fn);
        return () => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
        };
    }

    root.melatonRegistry = { get, getKey, subkeys, set, hydrate, onChange, _data: data };
})(typeof window !== 'undefined' ? window : globalThis);
