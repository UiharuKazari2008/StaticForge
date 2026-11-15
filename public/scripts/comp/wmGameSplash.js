/**
 * Melaton Mobile: the start-up cards of the phone's 3D games (Yozora #836). A game that draws in 3D
 * shows them once when it starts, over its own field while its first frames are made:
 *
 *   1. the game's card: its icon, its name, who made it
 *   2. "Powered by Xyridian Mobile DirectSpark 9"
 *
 * DirectSpark is Xyridian's 3D graphics layer on Melaton Mobile (the place a phone of the time gave
 * to its maker's own 3D runtime). The name and the mark are ours: a four-point spark in Xyridian's
 * star orange inside a tilted blue orbit, drawn here as SVG.
 *
 *   wmGameSplash.show(host, { title, icon, developer }) -> Promise, resolved when the cards are gone
 *
 * host is the game's field (position: relative or absolute); a touch skips the cards. About three
 * seconds. Styles: public/css/wm-game-splash.css (linked here on first use). Only on phones.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile') return;

    const CSS = '/css/wm-game-splash.css';
    const NAME = 'DirectSpark';
    const VERSION = '9';
    const MAKER = 'Xyridian Mobile';
    let styled = null;
    let serial = 0;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function styles() {
        if (!styled) {
            styled = new Promise((resolve) => {
                if (document.querySelector(`link[href="${CSS}"]`)) { resolve(); return; }
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = CSS;
                link.onload = link.onerror = () => resolve();
                document.head.appendChild(link);
            });
        }
        return styled;
    }

    /** The DirectSpark mark: the orbit's far side, the spark, the orbit's near side over it, a small star on the orbit. */
    function mark() {
        const id = `wgs${++serial}`;
        const spark = 'M0,-40 C3.5,-11 11,-3.5 40,0 C11,3.5 3.5,11 0,40 C-3.5,11 -11,3.5 -40,0 C-11,-3.5 -3.5,-11 0,-40Z';
        return `<svg class="wgs-mark" viewBox="0 0 200 112" role="img" aria-label="${NAME}">`
            + `<defs><linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2a6fd6"/><stop offset="0.5" stop-color="#a9dcff"/><stop offset="1" stop-color="#1c56b4"/></linearGradient>`
            + `<radialGradient id="${id}s"><stop offset="0" stop-color="#fff6cf"/><stop offset="0.4" stop-color="#ffbe2e"/><stop offset="1" stop-color="#f88800"/></radialGradient></defs>`
            + '<g transform="translate(100 56) rotate(-16)">'
            + `<path d="M-74,0 A74,24 0 0 1 74,0" fill="none" stroke="url(#${id}r)" stroke-width="6" stroke-linecap="round" opacity="0.6"/>`
            + `<g transform="rotate(16)"><path d="${spark}" fill="url(#${id}s)"/><path d="${spark}" fill="#fff" opacity="0.55" transform="scale(0.36)"/></g>`
            + `<path d="M-74,0 A74,24 0 0 0 74,0" fill="none" stroke="url(#${id}r)" stroke-width="7" stroke-linecap="round"/>`
            + `<path d="${spark}" fill="#fff" transform="translate(62 -13.5) scale(0.17)"/>`
            + '</g></svg>';
    }

    function show(host, opts) {
        const o = opts || {};
        if (!host) return Promise.resolve();
        return styles().then(() => new Promise((resolve) => {
            const el = document.createElement('div');
            el.className = 'wm-game-splash';
            el.setAttribute('data-wm-no-hold', '');
            el.innerHTML = '<div class="wgs-card" data-card="game">'
                + (o.icon ? `<img class="wgs-icon" src="${esc(o.icon)}" alt="" draggable="false">` : '')
                + `<div class="wgs-title">${esc(o.title || '')}</div>`
                + (o.developer ? `<div class="wgs-by">${esc(o.developer)}</div>` : '')
                + '</div>'
                + '<div class="wgs-card" data-card="engine">'
                + '<div class="wgs-powered">Powered by</div>'
                + mark()
                + `<div class="wgs-maker">${esc(MAKER)}</div>`
                + `<div class="wgs-word">Direct<b>Spark</b><i>${esc(VERSION)}</i></div>`
                + '</div>';
            host.appendChild(el);
            const game = el.querySelector('[data-card="game"]');
            const engine = el.querySelector('[data-card="engine"]');
            const timers = [];
            let done = false;
            const at = (ms, fn) => timers.push(setTimeout(fn, ms));
            const finish = () => {
                if (done) return;
                done = true;
                timers.forEach(clearTimeout);
                el.classList.add('is-leaving');
                setTimeout(() => { el.remove(); resolve(); }, 420);
            };
            el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); finish(); });
            at(30, () => game.classList.add('is-on'));
            at(1350, () => game.classList.remove('is-on'));
            at(1700, () => engine.classList.add('is-on'));
            at(3100, finish);
        }));
    }

    window.wmGameSplash = { show, name: `${MAKER} ${NAME} ${VERSION}` };
})();
