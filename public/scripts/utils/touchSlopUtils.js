/**
 * Scrollable overlay rows: distinguish tap from scroll on touch devices.
 * Touchend after a drag must not run the same handler as a short tap.
 */
var touchSlopUtils = (function () {
    const touchSlopState = new WeakMap();
    const TOUCH_SLOP_PX = 12;

    function registerTouchSlopTracking(element) {
        if (!element) return;
        element.addEventListener('touchstart', (e) => {
            const t = e.changedTouches[0];
            if (t) touchSlopState.set(element, { x0: t.clientX, y0: t.clientY, max: 0 });
        }, { passive: true });
        element.addEventListener('touchmove', (e) => {
            const st = touchSlopState.get(element);
            if (!st) return;
            const t = e.changedTouches[0];
            if (!t) return;
            const d = Math.hypot(t.clientX - st.x0, t.clientY - st.y0);
            if (d > st.max) st.max = d;
        }, { passive: true });
        element.addEventListener('touchcancel', () => {
            touchSlopState.delete(element);
        }, { passive: true });
    }

    function finalizeTouchSlop(element, touchEvent) {
        const st = touchSlopState.get(element);
        let maxDelta = 0;
        if (st) {
            const t = touchEvent.changedTouches[0];
            if (t) {
                const finalD = Math.hypot(t.clientX - st.x0, t.clientY - st.y0);
                maxDelta = Math.max(st.max, finalD);
            } else {
                maxDelta = st.max;
            }
            touchSlopState.delete(element);
        }
        return maxDelta;
    }

    function isTouchSlopTap(maxDelta) {
        return maxDelta <= TOUCH_SLOP_PX;
    }

    return {
        TOUCH_SLOP_PX,
        registerTouchSlopTracking,
        finalizeTouchSlop,
        isTouchSlopTap
    };
})();
