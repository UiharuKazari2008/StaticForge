/**
 * Pause looping CSS animations while their element is outside the viewport.
 *
 * Chrome cannot composite an animation it judges to have no visible change (an element laid out
 * off-screen), so it runs it on the main thread instead: a style pass, pre-paint and commit every
 * frame, ~60 fps, for something nobody can see (measured 2026-10-16: three typing dots parked
 * off-screen = 118 main-thread frames in 2.5 s; on-screen, hidden, zero-size or scrolled out of
 * a scroller = 5-16). Yukimi's Director-turn trace showed exactly that pattern: 7 elements
 * restyled per frame, no paint, ~35 fps for the whole turn.
 *
 * Every element that starts an infinite animation is watched with one IntersectionObserver;
 * outside the viewport (plus a margin) it gets .offscreen-paused (public/css/hidden.css:
 * animation-play-state: paused), and the class comes off as soon as it is back in view. A
 * looping animation resumes from where it paused, which is invisible.
 */
(function () {
    'use strict';

    if (typeof IntersectionObserver !== 'function') return;

    const PAUSED_CLASS = 'offscreen-paused';
    const watched = new WeakSet();

    const io = new IntersectionObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
            const el = entries[i].target;
            const off = !entries[i].isIntersecting;
            if (el.classList.contains(PAUSED_CLASS) !== off) el.classList.toggle(PAUSED_CLASS, off);
        }
    }, { rootMargin: '64px' });

    function hasInfiniteAnimation(el) {
        if (typeof el.getAnimations !== 'function') return false;
        const list = el.getAnimations();
        for (let i = 0; i < list.length; i++) {
            const effect = list[i].effect;
            if (effect && effect.target === el && effect.getTiming().iterations === Infinity) return true;
        }
        return false;
    }

    function watch(el) {
        if (!el || el.nodeType !== 1 || watched.has(el) || !hasInfiniteAnimation(el)) return;
        watched.add(el);
        io.observe(el);
    }

    function unwatchIfDone(el) {
        if (!el || !watched.has(el) || hasInfiniteAnimation(el)) return;
        watched.delete(el);
        io.unobserve(el);
        if (el.classList.contains(PAUSED_CLASS)) el.classList.remove(PAUSED_CLASS);
    }

    document.addEventListener('animationstart', (event) => watch(event.target), true);
    document.addEventListener('animationend', (event) => unwatchIfDone(event.target), true);
    document.addEventListener('animationcancel', (event) => unwatchIfDone(event.target), true);

    // Animations that started before this script ran
    if (typeof document.getAnimations === 'function') {
        document.getAnimations().forEach((animation) => {
            const target = animation.effect && animation.effect.target;
            if (target) watch(target);
        });
    }
})();
