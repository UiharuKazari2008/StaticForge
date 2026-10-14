/**
 * Wheel gesture lock for nested scrollers (Yozora #466, Yukimi 2026-10-13: the Director panel
 * inside Studio "should have a debouncer to lock scroll actions inside the area it was started").
 *
 * A wheel gesture is a run of wheel events less than `settleMs` apart. The scroller that
 * consumes the first event owns the gesture until it settles: events that land on another
 * scroller meanwhile are forwarded to the owner (the page keeps scrolling to the very top even
 * when the Director panel slides under the pointer), and the owner swallows events at its own
 * edge instead of chaining to its parent (scrolling inside the panel never spills into Studio
 * until the wheel has settled). After the gap the next gesture picks its owner afresh.
 *
 * Pure decision logic, no DOM: customScrollbar.js feeds it from its wheel handler and keeps
 * the owner's scrollbar visible while it owns the gesture (`wheel-owner` on the host element).
 *
 *   const lock = createWheelLock({ settleMs: 180 });
 *   lock.decide(scroller, now, { canScroll, canScrollInDirection, innermost })
 *     -> { action: 'scroll' | 'swallow' | 'forward' | 'pass', owner }
 *        scroll   this scroller takes the event (and now owns the gesture)
 *        swallow  this scroller owns the gesture but is at its edge: eat the event, move nothing
 *        forward  another scroller owns the gesture: give it the delta, eat the event
 *        pass     not ours: let it bubble (an outer scroller or the page decides)
 *   lock.owner(now)      the owner while the gesture is live, else null
 *   lock.release()       drop the owner (the host went away)
 *   lock.onChange(fn)    fn(owner | null) whenever the owner changes
 */
(function (root) {
    'use strict';

    const DEFAULT_SETTLE_MS = 180;

    function createWheelLock(options = {}) {
        const settleMs = Number.isFinite(options.settleMs) ? options.settleMs : DEFAULT_SETTLE_MS;
        let owner = null;
        let last = -Infinity;
        const listeners = [];

        function emit(next) {
            if (next === owner) return;
            owner = next;
            for (const fn of listeners) { try { fn(owner); } catch (e) { /* a listener must not break scrolling */ } }
        }

        function live(now) {
            return owner !== null && (now - last) < settleMs;
        }

        function decide(scroller, now, state = {}) {
            const canScroll = !!state.canScroll;
            const canScrollInDirection = !!state.canScrollInDirection;
            const innermost = state.innermost !== false;
            if (owner !== null && !live(now)) emit(null);
            if (owner !== null && owner !== scroller) {
                last = now;
                return { action: 'forward', owner };
            }
            if (owner === scroller) {
                last = now;
                return { action: canScrollInDirection ? 'scroll' : 'swallow', owner };
            }
            // no live gesture: the innermost scroller that can move takes it
            if (innermost && canScroll && canScrollInDirection) {
                last = now;
                emit(scroller);
                return { action: 'scroll', owner };
            }
            return { action: 'pass', owner: null };
        }

        function currentOwner(now) {
            if (owner !== null && !live(now)) emit(null);
            return owner;
        }

        function release() {
            last = -Infinity;
            emit(null);
        }

        function onChange(fn) {
            if (typeof fn === 'function') listeners.push(fn);
        }

        return { decide, owner: currentOwner, release, onChange, settleMs };
    }

    const api = { createWheelLock, DEFAULT_SETTLE_MS };
    if (root) root.wheelScrollLock = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
