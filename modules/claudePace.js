'use strict';

/**
 * Pace and renewal math for Claude plan usage (Yukimi Nov 24 2026: "a chip on the progress bar towards the weekly
 * usage, as well as the renewal date"). Pure functions of percent + resetsAt + now; no I/O, no polling.
 * Fleet (apps/claudedesk/client/claudedesk.js) and the phone's Fleet (public/scripts/comp/wmClaudeAccounts.js)
 * carry a copy of paceOf / renewalAfter (the browser cannot require this file); scripts/test-claude-fleet.js
 * checks the copies against this module.
 *
 *   paceOf(limit, now)  -> null | { elapsedPct, percent, ahead, state: 'ok'|'over'|'far', runOutAt }
 *     window start = resetsAt - 7 days (weekly) or - 5 hours (session); elapsedPct is where an even spend would be.
 *     over: ahead of even pace; far: at this rate it runs out before the reset (runOutAt then is when).
 *   renewalAfter(day, now) -> ms of the next billing date (a day of month, clamped to the month's length, local time)
 */

const HOUR = 3600000;

function windowMs(kind) {
    const k = String(kind || '');
    if (k === 'session' || k === 'five_hour') return 5 * HOUR;
    if (k.startsWith('weekly') || k.startsWith('seven_day')) return 168 * HOUR;
    return 0;
}

function paceOf(l, now) {
    const win = l ? windowMs(l.kind) : 0;
    if (!win || !(l.resetsAt > now) || !Number.isFinite(l.percent)) return null;
    const elapsed = Math.max(0, Math.min(1, (now - (l.resetsAt - win)) / win));
    const percent = Math.max(0, l.percent);
    const elapsedPct = elapsed * 100;
    const ahead = Math.round(percent - elapsedPct);
    let runOutAt = null;
    let far = false;
    // under 5% of the window gone the rate says nothing: never red that early
    if (percent > 0 && elapsed >= 0.05) {
        const at = now + (100 - percent) * (elapsed * win) / percent;
        if (percent >= 100 || at < l.resetsAt) { far = true; runOutAt = percent >= 100 ? null : Math.round(at); }
    }
    return { elapsedPct, percent, ahead, state: far ? 'far' : (percent > elapsedPct ? 'over' : 'ok'), runOutAt, resetsAt: l.resetsAt, win };
}

function renewalAfter(day, now) {
    const d = Math.round(Number(day));
    if (!(d >= 1 && d <= 31)) return null;
    const base = new Date(now);
    for (let m = 0; m < 3; m++) {
        const y = base.getFullYear();
        const mo = base.getMonth() + m;
        const last = new Date(y, mo + 1, 0).getDate();
        const t = new Date(y, mo, Math.min(d, last), 23, 59, 59).getTime();
        if (t > now) return new Date(y, mo, Math.min(d, last)).getTime();
    }
    return null;
}

module.exports = { paceOf, renewalAfter, windowMs };
