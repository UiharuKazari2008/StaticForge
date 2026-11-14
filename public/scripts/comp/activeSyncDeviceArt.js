/**
 * A phone as Device Center draws it (Yozora #818, #827): a modern phone in the style of Windows'
 * device icons (device-pda-256.png: silver body, black bezel, glossy glass), seen as those icons
 * see a device: turned so its right side shows, leaning back a little so its bottom edge shows,
 * in real perspective (CSS 3D, not a shear), with the phone's own screen in it. Shared by Melaton
 * Mobile Device Center (apps/activesync) and the Sidebar's Mobile Device gadgets (vistaSidebar.js).
 * Styles: public/css/activesync-device-art.css. Loaded as the feature 'activesync_device_art'.
 *
 *   activeSyncDeviceArt.html({ form, screens, uid, arrive })  -> markup for a 256 x 256 box
 *     form     'phone' | 'fold' (a foldable drawn as it is now: open = its inner screen, closed = its cover)
 *     screens  { inner, cover, external, screen: 'inner' | 'cover' } picture URLs (null: the glossy blue
 *              of an empty screen); external draws DeX's laptop behind, the phone in front on its left
 *     uid      a prefix for the SVG ids (several pictures on one page)
 *     arrive   play the arrival (the phone turns in and its screen lights up)
 *   activeSyncDeviceArt.isFoldable(dev)          a Galaxy Z Fold (SM-F9..) or a phone that said it folds
 *   activeSyncDeviceArt.screenOf(dev)            'inner' | 'cover' | null: which screen is in use now
 *   activeSyncDeviceArt.makeModel(model)         'Samsung Galaxy Z Fold7 (SM-F966U)' from 'SM-F966U'
 *   activeSyncDeviceArt.osText(dev)              'Melaton Mobile 6.5 (Android 16)'
 *   activeSyncDeviceArt.bars(level, kind)        a signal meter (0-4 bars) as markup
 */
(function (root) {
    'use strict';

    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    // ---------------------------------------------------------------- the front (flat, then turned in 3D)

    function paints(id) {
        return `<linearGradient id="${id('metal')}" x1="0" y1="0" x2="1" y2=".35">
                <stop offset="0" stop-color="#c9ced5"/><stop offset=".08" stop-color="#ffffff"/><stop offset=".22" stop-color="#e4e8ec"/>
                <stop offset=".6" stop-color="#bcc2ca"/><stop offset=".86" stop-color="#9aa1aa"/><stop offset="1" stop-color="#cfd4da"/></linearGradient>
            <linearGradient id="${id('rays')}" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>
            <linearGradient id="${id('bezel')}" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#2a2e34"/><stop offset=".5" stop-color="#0c0e11"/><stop offset="1" stop-color="#1b1e22"/></linearGradient>
            <linearGradient id="${id('blank')}" x1="0" y1="0" x2=".6" y2="1">
                <stop offset="0" stop-color="#6d9cf4"/><stop offset=".45" stop-color="#2a5fdc"/><stop offset="1" stop-color="#173f9e"/></linearGradient>
            <linearGradient id="${id('gloss')}" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".48" stop-color="#fff" stop-opacity=".08"/>
                <stop offset=".49" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
            <linearGradient id="${id('crease')}" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".42" stop-color="#000" stop-opacity=".10"/>
                <stop offset=".5" stop-color="#fff" stop-opacity=".16"/><stop offset=".58" stop-color="#000" stop-opacity=".10"/>
                <stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`;
    }

    /** A screen: the picture (or the empty glass), clipped to its rounded rectangle, gloss on top. */
    function glass(id, key, x, y, w, h, r, url, extra = '') {
        const clip = `<clipPath id="${id(`clip-${key}`)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath>`;
        const pic = url
            ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/><image href="${esc(url)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
            : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id('blank')})"/>`
              + `<path d="M${x + w * .5} ${y + h * 1.05} C${x + w * .2} ${y + h * .6} ${x + w * .25} ${y + h * .25} ${x + w * .42} ${y - 2} L${x + w * .55} ${y - 2} C${x + w * .42} ${y + h * .3} ${x + w * .45} ${y + h * .65} ${x + w * .62} ${y + h * 1.05} Z" fill="url(#${id('rays')})" opacity=".55"/>`
              + `<path d="M${x + w * .62} ${y + h * 1.05} C${x + w * .55} ${y + h * .6} ${x + w * .62} ${y + h * .3} ${x + w * .78} ${y - 2} L${x + w * .86} ${y - 2} C${x + w * .72} ${y + h * .35} ${x + w * .7} ${y + h * .65} ${x + w * .74} ${y + h * 1.05} Z" fill="url(#${id('rays')})" opacity=".35"/>`;
        // the light-up of the arrival: a black sheet over the picture that fades (activesync-device-art.css)
        return `${clip}<g clip-path="url(#${id(`clip-${key}`)})">${pic}${extra}<rect class="asda-off" x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id('gloss')})"/></g>`;
    }

    /** The phone's face, w x h: a hairline silver rim, a narrow black border, the screen. */
    function front(id, w, h, { r, bezel, url, hinge }) {
        const parts = [];
        parts.push(`<rect x=".45" y=".45" width="${w - .9}" height="${h - .9}" rx="${r}" fill="url(#${id('metal')})" stroke="#7b8189" stroke-width=".9"/>`);
        parts.push(`<rect x="1.4" y="1.4" width="${w - 2.8}" height="${h - 2.8}" rx="${r - 1}" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1"/>`);
        const rim = Math.max(1.4, w * 0.014); const bw = w - 2 * rim; const bh = h - 2 * rim; const br = Math.max(2, r - rim);
        parts.push(`<rect x="${rim}" y="${rim}" width="${bw}" height="${bh}" rx="${br}" fill="url(#${id('bezel')})"/>`);
        const sx = rim + bezel; const sy = rim + bezel; const sw = bw - 2 * bezel; const sh = bh - 2 * bezel;
        const crease = hinge ? `<rect x="${sx + sw / 2 - 9}" y="${sy}" width="18" height="${sh}" fill="url(#${id('crease')})"/>` : '';
        parts.push(glass(id, 'phone', sx, sy, sw, sh, Math.max(2, br - bezel), url, crease));
        const cx = hinge ? sx + sw * 0.78 : sx + sw / 2;
        parts.push(`<circle cx="${cx}" cy="${sy + 5.5}" r="2.3" fill="#05070a" stroke="#2c3138" stroke-width=".8"/><circle cx="${cx - .6}" cy="${sy + 4.9}" r=".6" fill="#5a7ab8" fill-opacity=".8"/>`);
        if (hinge) parts.push(`<line x1="${w / 2}" y1=".8" x2="${w / 2}" y2="2.6" stroke="#6f757d" stroke-width="1.2"/><line x1="${w / 2}" y1="${h - 2.6}" x2="${w / 2}" y2="${h - .8}" stroke="#6f757d" stroke-width="1.2"/>`);
        return parts.join('');
    }

    /**
     * The phone as a slab in 3D: its edge is a stack of thin rounded layers behind the face (the
     * rounded corners keep their shape in perspective), the right side a plane with the keys.
     */
    function slab(uid, x, y, w, h, o) {
        const id = (n) => `${uid}-${n}`;
        const depth = o.depth;
        const layers = [];
        for (let i = 1; i <= depth; i += 1) {
            // lit from the upper left: the layers darken towards the back
            const t = i / depth;
            const c = Math.round(168 - 70 * t);
            layers.push(`<i class="asda-layer" style="transform:translateZ(${-i}px);background:rgb(${c},${c + 5},${c + 12})"></i>`);
        }
        const side = `<i class="asda-side" style="height:${h - 2 * o.r}px;top:${o.r}px;width:${depth}px">`
            + `<b style="top:${h * 0.2 - o.r}px;height:${h * 0.11}px"></b><b style="top:${h * 0.37 - o.r}px;height:${h * 0.06}px"></b></i>`;
        const bottom = `<i class="asda-bottom" style="width:${w - 2 * o.r}px;left:${o.r}px;height:${depth}px"></i>`;
        const svg = `<svg class="asda-front" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs>${paints(id)}</defs>${front(id, w, h, o)}</svg>`;
        return `<div class="asda-slab" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${o.r}px;--asda-r:${o.r}px;transform:translateZ(${o.z || 0}px) rotateX(${o.lean || 0}deg)">${layers.join('')}${side}${bottom}${svg}</div>`;
    }

    /**
     * DeX's laptop (Yukimi's sketch, Nov 13): behind the phone on the right, the lid standing at the
     * back of a slim base whose keyboard deck comes towards us.
     */
    function laptop(uid, url) {
        const id = (n) => `${uid}-lt-${n}`;
        const W = 168; const LID = 104; const DECK = 92; const X = 84; const HINGE = 150;
        const lid = `<svg class="asda-front" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${LID}" width="${W}" height="${LID}"><defs>${paints(id)}</defs>`
            + `<rect x=".5" y=".5" width="${W - 1}" height="${LID - 1}" rx="4" fill="#1a1d21" stroke="#a9afb7" stroke-width="1"/>`
            + glass(id, 'external', 3.5, 3.5, W - 7, LID - 9, 1.5, url)
            + `<rect x="1.5" y="${LID - 3.5}" width="${W - 3}" height="2" fill="#2a2e34"/></svg>`;
        const deck = `<i class="asda-deck-keys"></i><i class="asda-deck-pad"></i>`;
        return `<div class="asda-laptop" style="left:${X}px;top:${HINGE - LID}px;width:${W}px;height:${LID}px">`
            + `<div class="asda-lid" style="width:${W}px;height:${LID}px"><i class="asda-lid-back"></i>${lid}</div>`
            + `<div class="asda-deck" style="width:${W}px;height:${DECK}px;top:${LID}px">${deck}</div>`
            + `<div class="asda-deck-edge" style="width:${W}px;top:${LID}px;transform:translateZ(${DECK}px)"></div>`
            + '</div>';
    }

    function html({ form = 'phone', screens = {}, uid = 'asda', arrive = false } = {}) {
        // only the phone as it is now: a foldable open (its inner screen) or closed (its cover)
        const open = form === 'fold' && screens.screen !== 'cover';
        const url = form === 'fold' ? (open ? screens.inner : (screens.cover || screens.inner)) : (screens.inner || screens.cover);
        const ratio = open ? 0.9 : form === 'fold' ? 0.43 : 0.47;
        // slim: a hairline rim, a narrow black border, a shallow edge (Yukimi: not chunky)
        const o = open ? { r: 8, bezel: 2, depth: 6, hinge: true } : { r: form === 'fold' ? 9 : 13, bezel: 2, depth: 6 };
        let box;
        const parts = [];
        // a soft shadow on the floor under a thing: a plane lying at y, centred on depth z
        const floor = (x, y, w, depth, z) => parts.push(`<i class="asda-shadow" style="left:${x}px;top:${y}px;width:${w}px;height:${depth}px;transform:translateZ(${z - depth / 2}px) rotateX(90deg)"></i>`);
        if (screens.external) {
            floor(70, 152, 200, 120, 46);
            parts.push(laptop(uid, screens.external));
            // in front, on the left (the sketch), nearer than the keyboard deck
            box = open ? { x: 66, w: 94, bottom: 206, z: 112 } : { x: 78, w: Math.round(136 * ratio), bottom: 208, z: 112 };
        } else {
            box = open ? { x: 34, w: 184, bottom: 232, z: 0 } : { x: Math.round((256 - 212 * ratio) / 2), w: Math.round(212 * ratio), bottom: 234, z: 0 };
        }
        const h = Math.round(box.w / ratio);
        const y = box.bottom - h;
        floor(box.x - box.w * 0.15, box.bottom, box.w * 1.4, 34, box.z - 6);
        parts.push(slab(uid, box.x, y, box.w, h, { ...o, url, z: box.z, lean: 7 }));
        return `<div class="asda${arrive ? ' is-arriving' : ''}" data-form="${open ? 'open' : form}"><div class="asda-world">${parts.join('')}</div></div>`;
    }

    // ---------------------------------------------------------------- facts

    function isFoldable(dev) {
        const st = (dev && dev.status) || {};
        return /^SM-F9/i.test((dev && dev.model) || '') || st.foldable === true;
    }

    /** The screen in use: what the phone's page says (it is in front), else null. */
    function screenOf(dev) {
        const st = (dev && dev.status) || {};
        return st.screen === 'cover' || st.screen === 'inner' ? st.screen : null;
    }

    // marketing names for the models people carry; the maker always, the name when known
    const SAMSUNG = [
        [/^SM-F96[6-9]/, 'Galaxy Z Fold7'], [/^SM-F95[6-9]/, 'Galaxy Z Fold6'], [/^SM-F94[6-9]/, 'Galaxy Z Fold5'], [/^SM-F93[6-9]/, 'Galaxy Z Fold4'],
        [/^SM-F92[6-9]/, 'Galaxy Z Fold3'], [/^SM-F76[6-9]/, 'Galaxy Z Flip7'], [/^SM-F74[1-9]/, 'Galaxy Z Flip6'], [/^SM-F73[1-9]/, 'Galaxy Z Flip5'],
        [/^SM-S93[1-9]/, 'Galaxy S25'], [/^SM-S92[1-9]/, 'Galaxy S24'], [/^SM-S91[1-9]/, 'Galaxy S23'], [/^SM-S90[1-9]/, 'Galaxy S22'],
        [/^SM-A53[6-9]/, 'Galaxy A53 5G'], [/^SM-A54[6-9]/, 'Galaxy A54 5G'], [/^SM-A55[6-9]/, 'Galaxy A55 5G'], [/^SM-A56[6-9]/, 'Galaxy A56 5G'],
        [/^SM-X/, 'Galaxy Tab'], [/^SM-T/, 'Galaxy Tab']
    ];
    function makeModel(model) {
        const m = String(model || '').trim();
        if (!m) return '';
        if (/^SM-/i.test(m)) {
            const hit = SAMSUNG.find(([re]) => re.test(m.toUpperCase()));
            return hit ? `Samsung ${hit[1]} (${m})` : `Samsung ${m}`;
        }
        if (/^Pixel\b/i.test(m)) return `Google ${m}`;
        if (/^(XQ-|SO-|SOG)/i.test(m)) return `Sony ${m}`;
        if (/^(CPH|PH[A-Z]\d)/i.test(m)) return `OPPO ${m}`;
        if (/^(LE|NE|PJ[A-Z])\d/i.test(m)) return `OnePlus ${m}`;
        if (/^moto/i.test(m)) return `Motorola ${m}`;
        return m;
    }

    function osText(dev) {
        const st = (dev && dev.status) || {};
        const android = String((dev && dev.os) || '').trim();
        const shell = st.shell ? `Melaton Mobile ${st.shell}` : '';
        if (shell && android) return `${shell} (${android})`;
        return shell || android;
    }

    /** A signal meter: four rising bars, the lit ones by the phone's own level (0-4). */
    function bars(level, kind = 'wifi') {
        const n = Math.max(0, Math.min(4, Math.round(Number(level) || 0)));
        let s = '';
        for (let i = 0; i < 4; i += 1) s += `<i class="${i < n ? 'is-on' : ''}" style="height:${4 + i * 3}px"></i>`;
        return `<span class="asda-bars asda-bars--${kind}" role="img" aria-label="${n} of 4 bars">${s}</span>`;
    }

    root.activeSyncDeviceArt = { html, isFoldable, screenOf, makeModel, osText, bars };
})(typeof window !== 'undefined' ? window : globalThis);
