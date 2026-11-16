/**
 * Melaton Mobile: the phone's car keys (Yozora #874). Samsung Digital Key keeps an ongoing "Car
 * Detection" notification for each car whose key the phone holds while it sees that car (title =
 * the car, "Car in range.", Lock / Unlock). The Android app's notification listener reads them on the
 * phone and tells this page (window.AndroidCarKey, `androidcarkey` window event; DSApp CarKeyWatch.kt);
 * nothing of it goes to the server.
 *
 * A phone can hold the user's own car's key and keys friends shared. One car is "my car": Lapis
 * Remote's Lock / Unlock use its key while it is in range, and it is the one the server knows
 * (BlueLink). It is chosen on the phone (localStorage wmCarKeyMine = the car's name; wmCarKeyFriends =
 * names marked as a friend's): by default the car whose name is in Lapis's vehicle name, else the
 * first car seen. A new car seen once a car is chosen asks "Is <car> your car?" once.
 *
 *   - the title bar shows the car glyph (wmShell role 'carkey', art status-carkey) while any car is in
 *     range, so Melaton Bars carries it over Android programs too; its bubble lists each car with its
 *     own large Lock / Unlock and "Set as My Car" for the others
 *
 * window.wmCarKey: state() -> { inRange (any car), cars: [{ key, car, mine, canLock, canUnlock }],
 * mine (my car's entry or null) }, can(kind) / press(kind) (my car; kind 'lock' | 'unlock'),
 * pressCar(key, kind), setMine(name), setFriend(name), forget(name), known() (every key seen, for
 * Wallet > Car Keys), isMine(name). Fires document `wmCarKeyChange` on every change.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const MINE_KEY = 'wmCarKeyMine';
    const FRIENDS_KEY = 'wmCarKeyFriends';
    const SEEN_KEY = 'wmCarKeysSeen'; // every car name a key was seen for, so it can be set when out of range
    let raw = { cars: [] };
    let state = { inRange: false, cars: [], mine: null };
    const asked = new Set();

    const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* storage off */ } };
    const friends = () => { try { return JSON.parse(lsGet(FRIENDS_KEY) || '[]') || []; } catch (_) { return []; } };
    const norm = (s) => String(s || '').trim().toLowerCase();

    function bridge() { return window.AndroidCarKey || null; }

    /** Lapis's vehicle name ("2024 Sonata Hybrid"), to recognise my car by its key's name ("SONATA"). */
    function lapisName() {
        const l = window.wmLapis;
        const st = l && typeof l.state === 'function' ? l.state() : null;
        return (st && st.vehicle && st.vehicle.name) || '';
    }

    function mineName(cars) {
        const set = lsGet(MINE_KEY);
        if (set) return set;
        const ln = norm(lapisName());
        const byLapis = ln && cars.find((c) => norm(c.car) && ln.includes(norm(c.car).split(/\s+/)[0]));
        const fr = friends().map(norm);
        const pick = byLapis || cars.find((c) => !fr.includes(norm(c.car)));
        if (pick && pick.car) { lsSet(MINE_KEY, pick.car); return pick.car; }
        return '';
    }

    function build() {
        const list = Array.isArray(raw.cars) ? raw.cars
            // an app build before several keys: its one car
            : raw.inRange ? [{ key: '', car: raw.car, text: raw.text, canLock: raw.canLock, canUnlock: raw.canUnlock }] : [];
        const mine = norm(mineName(list));
        const cars = list.map((c) => ({ key: c.key || '', car: c.car || 'Car', text: c.text || '', canLock: !!c.canLock, canUnlock: !!c.canUnlock, mine: !!mine && norm(c.car) === mine }));
        return { inRange: cars.length > 0, cars, mine: cars.find((c) => c.mine) || null };
    }

    function seen() { try { return JSON.parse(lsGet(SEEN_KEY) || '[]') || []; } catch (_) { return []; } }
    function remember(cars) {
        const list = seen();
        let changed = false;
        cars.forEach((c) => { if (c.car && !list.map(norm).includes(norm(c.car))) { list.push(c.car); changed = true; } });
        if (changed) lsSet(SEEN_KEY, JSON.stringify(list.slice(-20)));
    }

    /** Every key this phone has seen: [{ car, mine, friend, inRange }] (Wallet > Car Keys). */
    function known() {
        const mine = norm(lsGet(MINE_KEY));
        const fr = friends().map(norm);
        const names = seen();
        state.cars.forEach((c) => { if (!names.map(norm).includes(norm(c.car))) names.push(c.car); });
        return names.map((n) => ({ car: n, mine: norm(n) === mine, friend: fr.includes(norm(n)) || (!!mine && norm(n) !== mine), inRange: state.cars.some((c) => norm(c.car) === norm(n)) }));
    }

    /** Forgets a key (Wallet > Car Keys): not mine, not a friend's, not remembered. */
    function forget(name) {
        lsSet(SEEN_KEY, JSON.stringify(seen().filter((n) => norm(n) !== norm(name))));
        lsSet(FRIENDS_KEY, JSON.stringify(friends().filter((n) => norm(n) !== norm(name))));
        if (norm(lsGet(MINE_KEY)) === norm(name)) lsSet(MINE_KEY, null);
        state = { inRange: false, cars: [], mine: null };
        take(raw);
    }

    function take(s) {
        raw = s && typeof s === 'object' ? s : { cars: [] };
        if (Array.isArray(raw.cars)) remember(raw.cars); else if (raw.inRange && raw.car) remember([{ car: raw.car }]);
        const next = build();
        const key = (o) => JSON.stringify(o.cars.map((c) => [c.key, c.car, c.mine, c.canLock, c.canUnlock]));
        const changed = key(next) !== key(state);
        state = next;
        if (changed) document.dispatchEvent(new CustomEvent('wmCarKeyChange', { detail: state }));
        askAboutNew();
    }

    /** A car seen for the first time while my car is set: is it mine, or a friend's? (once per car) */
    function askAboutNew() {
        const sh = window.wmShell;
        const mine = norm(lsGet(MINE_KEY));
        if (!sh || typeof sh.messageBox !== 'function' || !mine) return;
        const fr = friends().map(norm);
        const fresh = state.cars.find((c) => norm(c.car) !== mine && !fr.includes(norm(c.car)) && !asked.has(norm(c.car)));
        if (!fresh) return;
        asked.add(norm(fresh.car));
        sh.messageBox({
            title: 'Car Key',
            icon: 'question',
            text: `This phone has a key for ${fresh.car} as well as ${lsGet(MINE_KEY)}. Is ${fresh.car} your car?\n\nYour car is the one Lapis Remote controls; any other key is kept as a friend's car.`,
            buttons: [{ text: 'My Car', value: 'mine' }, { text: 'Friend\'s', value: 'friend' }]
        }).then((v) => {
            if (v === 'mine') setMine(fresh.car);
            else markFriend(fresh.car);
        });
    }

    function markFriend(name) {
        const fr = friends();
        if (!fr.map(norm).includes(norm(name))) { fr.push(name); lsSet(FRIENDS_KEY, JSON.stringify(fr.slice(-20))); }
        take(raw);
    }

    function setMine(name) {
        const old = lsGet(MINE_KEY);
        lsSet(MINE_KEY, name);
        // the car that was mine becomes a friend's; the new one is not a friend's any more
        let fr = friends().filter((n) => norm(n) !== norm(name));
        if (old && norm(old) !== norm(name) && !fr.map(norm).includes(norm(old))) fr.push(old);
        lsSet(FRIENDS_KEY, JSON.stringify(fr.slice(-20)));
        state = { inRange: false, cars: [], mine: null };
        take(raw);
    }

    function read() {
        const b = bridge();
        if (!b || typeof b.state !== 'function') return;
        try { take(JSON.parse(b.state())); } catch (_) { /* older app */ }
    }

    function pressCar(key, kind) {
        const b = bridge();
        const c = state.cars.find((x) => x.key === key);
        if (!b || !c || !(kind === 'lock' ? c.canLock : c.canUnlock)) return false;
        try { return (kind === 'lock' ? (key ? b.lock(key) : b.lock()) : (key ? b.unlock(key) : b.unlock())) === true; } catch (_) { return false; }
    }

    // my car: what Lapis uses
    const can = (kind) => !!(state.mine && (kind === 'lock' ? state.mine.canLock : kind === 'unlock' ? state.mine.canUnlock : false));
    const press = (kind) => !!(state.mine && can(kind) && pressCar(state.mine.key, kind));

    window.addEventListener('androidcarkey', (e) => take(e.detail));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') read(); });
    // Lapis's vehicle name arrives after its first load: it may name my car
    document.addEventListener('wmLapisChange', () => { if (!lsGet(MINE_KEY) && raw.cars && raw.cars.length) take(raw); });
    read();

    window.wmCarKey = { state: () => state, can, press, pressCar, setMine, setFriend: markFriend, forget, known, isMine: (n) => norm(n) === norm(lsGet(MINE_KEY)) };
})();
