/**
 * Shared scroll-wheel tick gate for Studio value steppers.
 * One successful tick, then ignore further wheel events for the interval.
 * Callers still preventDefault when the control owns the gesture.
 */

var WHEEL_TICK_MS = 400;

function createWheelTickGate(intervalMs) {
    const parsed = Number(intervalMs);
    const interval = parsed > 0 ? parsed : WHEEL_TICK_MS;
    let lastTickAt = -Infinity;
    return function allowWheelTick(now) {
        const t = now == null ? Date.now() : Number(now);
        if (!Number.isFinite(t) || t - lastTickAt < interval) return false;
        lastTickAt = t;
        return true;
    };
}

function guardWheelTick(event, allowTick, options) {
    if (options && options.stop) event.stopPropagation();
    event.preventDefault();
    return allowTick();
}
