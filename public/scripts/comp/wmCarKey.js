/**
 * Melaton Mobile: the phone's car key (Yozora #874). Samsung Digital Key keeps an ongoing "Car
 * Detection" notification while the phone's key sees the car (title = the car, "Car in range.",
 * Lock / Unlock actions). The Android app's notification listener reads it on the phone and tells
 * this page (window.AndroidCarKey, `androidcarkey` window event; DSApp CarKeyWatch.kt); nothing of it
 * goes to the server. While the car is in range:
 *   - the title bar shows the car glyph (wmShell role 'carkey', art status-carkey), so Melaton Bars
 *     carries it over every Android program too; its bubble has the car's name, what the server
 *     knows of it (Lapis: doors, engine, fuel) and Lock / Unlock / Open Lapis
 *   - Lapis Remote's Lock and Unlock press the notification's own actions (the phone's key, no
 *     BlueLink round trip); out of range they go to the server as before
 *
 * window.wmCarKey: state() -> { inRange, car, text, since, canLock, canUnlock }, can('lock'|'unlock'),
 * press('lock'|'unlock') -> Boolean. Fires document `wmCarKeyChange` on every change.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const OFF = { inRange: false, car: '', text: '', since: 0, canLock: false, canUnlock: false };
    let state = OFF;

    function bridge() { return window.AndroidCarKey || null; }

    function take(s) {
        const next = s && typeof s === 'object' ? Object.assign({}, OFF, s) : OFF;
        const changed = next.inRange !== state.inRange || next.car !== state.car || next.canLock !== state.canLock || next.canUnlock !== state.canUnlock || next.text !== state.text;
        state = next;
        if (changed) document.dispatchEvent(new CustomEvent('wmCarKeyChange', { detail: state }));
    }

    function read() {
        const b = bridge();
        if (!b || typeof b.state !== 'function') return;
        try { take(JSON.parse(b.state())); } catch (_) { /* older app */ }
    }

    function can(kind) {
        if (!state.inRange) return false;
        return kind === 'lock' ? state.canLock : kind === 'unlock' ? state.canUnlock : false;
    }

    function press(kind) {
        const b = bridge();
        if (!b || !can(kind)) return false;
        try { return (kind === 'lock' ? b.lock() : b.unlock()) === true; } catch (_) { return false; }
    }

    window.addEventListener('androidcarkey', (e) => take(e.detail));
    // a page that came back from the background missed nothing (the app pushes), but read once anyway
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') read(); });
    read();

    window.wmCarKey = { state: () => state, can, press };
})();
