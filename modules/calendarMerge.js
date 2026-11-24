'use strict';

/**
 * Merge on save for calendar files (#1157). Calendar, the phone's Calendar and Tasks upload a whole .ics
 * from what they loaded; a stale window would overwrite what another device, the other app or an agent
 * (calendarMcp.js) wrote since. vfsWebSocketHandlers.js sends every .ics save of a file that changed under
 * the sender through mergeSave: a three-way merge by UID, so neither edit is lost.
 *
 *   base      the text the client loaded (found by its content hash; may be gone)
 *   current   what is stored now
 *   incoming  what the client sends
 *
 * Per UID: only the client changed it -> its version; only the store changed it -> the store's; both ->
 * the newer LAST-MODIFIED / DTSTAMP (a tie goes to the client). Removed by the client and untouched
 * in the store -> removed; removed by the client but edited in the store -> kept (an edit beats a delete),
 * and the other way round. Without a base nothing is ever dropped (a union).
 * A file with X-MELATON-SOURCE (the phone's mirrors, subscriptions) is stored as sent.
 * Header lines come from the client, except an X-MELATON-OWNER the store has.
 */

const { splitCalendar } = require('./calendarMcp');

const VOLATILE = /^(DTSTAMP|LAST-MODIFIED|SEQUENCE|CREATED)[;:]/i;
const keyOf = (c) => `${c.type}:${c.uid}`;
const norm = (c) => c.lines.filter((l) => !VOLATILE.test(l)).join('\n');
function stampOf(c) {
    const l = c.lines.find((x) => /^LAST-MODIFIED[;:]/i.test(x)) || c.lines.find((x) => /^DTSTAMP[;:]/i.test(x));
    return l ? l.slice(l.indexOf(':') + 1).trim() : '';
}

function index(parsed) {
    const m = new Map();
    parsed.comps.forEach((c) => { if (c.uid) m.set(keyOf(c), c); });
    return m;
}

/** Answers { text, merged } where merged is true when the store held changes the client had not seen. */
function mergeSave({ baseText, currentText, incomingText }, joinCalendar) {
    if (currentText === incomingText) return { text: incomingText, merged: false };
    let cur; let inc;
    try { cur = splitCalendar(currentText); } catch (_) { return { text: incomingText, merged: false }; }
    try { inc = splitCalendar(incomingText); } catch (_) { return { text: incomingText, merged: false }; }
    if (inc.header.some((l) => /^X-MELATON-SOURCE[;:]/i.test(l))) return { text: incomingText, merged: false }; // a mirror or subscription: its writer holds the whole truth
    let base = null;
    if (baseText) { try { base = splitCalendar(baseText); } catch (_) { base = null; } }
    if (base && baseText === currentText) return { text: incomingText, merged: false }; // nothing changed under the client

    const B = base ? index(base) : null;
    const C = index(cur);
    const I = index(inc);
    const out = [];
    const done = new Set();
    let merged = false;
    const take = (c) => { out.push(c); };

    cur.comps.forEach((c) => {
        if (!c.uid) return;
        const k = keyOf(c);
        done.add(k);
        const i = I.get(k);
        const b = B ? B.get(k) : null;
        if (!i) {
            if (b && norm(b) === norm(c)) return; // the client removed it, the store did not touch it
            merged = true; take(c); // added in the store since (or edited there and removed by the client)
            return;
        }
        const sameInc = norm(i) === norm(c);
        if (sameInc) { take(i); return; }
        const clientChanged = !b || norm(b) !== norm(i);
        const storeChanged = !b || norm(b) !== norm(c);
        if (clientChanged && !storeChanged) take(i);
        else if (storeChanged && !clientChanged) { merged = true; take(c); } else if (stampOf(c) > stampOf(i)) { merged = true; take(c); } else take(i);
    });
    inc.comps.forEach((i) => {
        if (!i.uid) return;
        const k = keyOf(i);
        if (done.has(k)) return;
        const b = B ? B.get(k) : null;
        if (b && norm(b) === norm(i)) { merged = true; return; } // the store removed it, the client did not touch it
        take(i);
    });
    const plain = (inc.comps.some((c) => !c.uid) ? inc : cur).comps.filter((c) => !c.uid);
    const header = inc.header.filter((l) => !/^X-MELATON-OWNER[;:]/i.test(l));
    const owner = cur.header.find((l) => /^X-MELATON-OWNER[;:]/i.test(l)) || inc.header.find((l) => /^X-MELATON-OWNER[;:]/i.test(l));
    if (owner) header.push(owner);
    return { text: joinCalendar(header, [...plain, ...out]), merged };
}

module.exports = { mergeSave };
