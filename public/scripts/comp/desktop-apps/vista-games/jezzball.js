// JezzBall, the Windows 3.x game (Microsoft Entertainment Pack 4, 1992), as it runs in a Vista
// shell: a 16-bit program Vista draws unthemed, Windows Classic in the Aero colour scheme. Taken
// from the game itself (JEZZBALL.EXE / WEP4UTIL.DLL, decompiled) and the VM running it under otvdm;
// the rules and the client's drawing are jezzballCore.js, the arithmetic jezzballReal.js, the
// look vista-jezzball.css, the assets scripts/build-vista-jezzball.js. Measured on the VM:
//
//   - the window: client 496 x 322 under a 20 px menu bar, an 8 px sizing frame, 19 px caption;
//     sizable with that as its minimum, the board stays at the client's top left (more black)
//   - menus: flat, Segoe UI 9 pt, titles 7 px either side of their text, items 19 px tall, a
//     fade in and a drop shadow; the game keeps running while one is open (Win16's menu loop
//     dispatches the timer), and freezes while the window is inactive or minimized
//   - Esc minimizes (the boss key), F1 Help, F2 New Game, F3 Pause, right click turns the wall
//     builder (the system's ns / ew resize cursors), Ctrl+Shift+F12 the original's cheat
//   - Well done! is a 16-bit dialog (System font, white client) placed at (178, 106) of the
//     client; the Entertainment Pack's boxes (About, the name entry, Hall of Fame) are gray, centred
//     on the screen's width a third of the way down (WEP4UTIL CENTERHWND); Game Over is a Vista
//     message box
//   - only BOUNCE.WAV and JEZZDEAD.WAV ship with the game, so the other events are silent as in
//     the original; tada.wav is looked for in the Windows directory, where Vista has none
//   - high scores: WEP4UTIL's EntPack.dat (Hall of Fame, and Today's list that resets each day,
//     five each) and EntPack.ini's [WEP] DefName, kept in localStorage `vistaGame:entpack`
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const JZ = root.JezzBallCore;
    const GAME_ID = 'jezzball';
    const MODAL_ID = 'vistaJezzballModal';
    const ART = '/static_images/vista-games/jezzball/';
    const CLIENT_W = JZ.CLIENT_W;
    const CLIENT_H = JZ.CLIENT_H;
    // outer size for the client: 8 px frame each side; 8 + 19 caption + 1 + 20 menu bar above
    const CHROME_W = 16;
    const CHROME_H = 56;
    const WEP_NAME = 'Jezz Ball';

    // MAIN MENU (cm ids of the resource)
    const CMD = {
        NEW: 1110, PAUSE: 1150, DEMO: 1120, SCORES: 1600, EXIT: 1200,
        FAST: 1310, SLOW: 1320, SOUND: 1330,
        CONTENTS: 1510, HOWTO: 1520, COMMANDS: 1530, HELPHELP: 1599, ABOUT: 1590
    };
    // popup widths and accelerator columns as Vista lays them out (measured)
    const MENU = [
        {
            text: '&Game', width: 45, popupWidth: 140, accelX: 101, items: [
                { id: CMD.NEW, text: '&New Game', accel: 'F2' },
                { id: CMD.PAUSE, text: '&Pause', accel: 'F3' },
                { id: CMD.DEMO, text: '&Demo' },
                { id: CMD.SCORES, text: '&High Scores...' },
                { separator: true },
                { id: CMD.EXIT, text: 'E&xit' }
            ]
        },
        {
            text: '&Options', width: 56, popupWidth: 83, items: [
                { id: CMD.SLOW, text: '&Slow' },
                { id: CMD.FAST, text: '&Fast' },
                { separator: true },
                { id: CMD.SOUND, text: 'Soun&d' }
            ]
        },
        {
            text: '&Help', width: 39, popupWidth: 160, accelX: 121, items: [
                { id: CMD.CONTENTS, text: '&Contents', accel: 'F1' },
                { id: CMD.HOWTO, text: '&How To Play' },
                { id: CMD.COMMANDS, text: 'C&ommands' },
                { id: CMD.HELPHELP, text: 'How To &Use Help' },
                { separator: true },
                { id: CMD.ABOUT, text: '&About JezzBall...' }
            ]
        }
    ];

    const store = VG.store(GAME_ID);
    const wepStore = VG.store('entpack');

    const el = (tag, className, text) => {
        const n = document.createElement(tag);
        if (className) n.className = className;
        if (text !== undefined) n.textContent = text;
        return n;
    };

    // "&Game" -> fragment with the mnemonic underlined (shown with keyboard cues)
    function mnemonicFragment(text) {
        const frag = document.createDocumentFragment();
        const i = text.indexOf('&');
        if (i < 0) {
            frag.appendChild(document.createTextNode(text));
            return frag;
        }
        frag.appendChild(document.createTextNode(text.slice(0, i)));
        frag.appendChild(el('u', '', text.charAt(i + 1)));
        frag.appendChild(document.createTextNode(text.slice(i + 2)));
        return frag;
    }
    const mnemonicOf = (text) => {
        const m = /&(.)/.exec(text || '');
        return m ? m[1].toUpperCase() : '';
    };

    // The caption's gradient as Windows draws it (measured, exact on every VM caption): solid up to
    // `start` (19 behind an icon, else 0), then a + (d * t - 1) / L across L px, solid after it, the
    // span ending `gap` px before the caption buttons (2; Vista's own message box: 0). Painted into
    // 1 px strips for the active and inactive colours, set as --jz-cap-active / --jz-cap-inactive.
    const CAPTION_COLORS = { active: [[153, 180, 209], [185, 209, 234]], inactive: [[191, 205, 219], [215, 228, 242]] };
    function paintCaption(modal, width, start, buttons, gap) {
        width = Math.max(1, Math.round(width));
        if (modal.__jzCaptionW === width) return;
        modal.__jzCaptionW = width;
        const end = Math.max(start + 1, width - 2 - buttons - gap);
        const L = end - start;
        Object.entries(CAPTION_COLORS).forEach(([kind, [a, b]]) => {
            const c = document.createElement('canvas');
            c.width = width;
            c.height = 1;
            const ctx = c.getContext('2d');
            const img = ctx.createImageData(width, 1);
            for (let x = 0; x < width; x++) {
                const t = Math.min(Math.max(x - start, 0), L);
                for (let k = 0; k < 3; k++) {
                    const d = b[k] - a[k];
                    img.data[x * 4 + k] = t >= L ? b[k] : t > 0 ? a[k] + Math.floor((d * t - 1) / L) : a[k];
                }
                img.data[x * 4 + 3] = 255;
            }
            ctx.putImageData(img, 0, 0);
            modal.style.setProperty('--jz-cap-' + kind, 'url("' + c.toDataURL('image/png') + '")');
        });
    }

    // ---- assets --------------------------------------------------------------------------------
    let assetsPromise = null;
    function loadAssets() {
        if (assetsPromise) return assetsPromise;
        const image = (file) => new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const d = ctx.getImageData(0, 0, c.width, c.height);
                resolve({ w: c.width, h: c.height, data: d.data });
            };
            img.onerror = () => reject(new Error('JezzBall: cannot load ' + file));
            img.src = ART + file;
        });
        assetsPromise = Promise.all([
            image('sheet.png'),
            fetch(ART + 'jezzball.json').then((r) => r.json())
        ]).then(([sheet, data]) => ({
            sheet,
            system: JZ.fontFromJson(data.fonts.system),
            title: JZ.fontFromJson(data.fonts.sserif24),
            demo: data.demo
        }));
        assetsPromise.catch(() => { assetsPromise = null; });
        return assetsPromise;
    }

    // ---- raster text for the controls ------------------------------------------------------------
    // DrawText with a bitmap font: lines wrapped at spaces (DT_WORDBREAK), each aligned in `width`
    // edit: an EDIT control's wrap, which keeps the space at the end of a broken line (and centres
    // the line with it)
    function wrapLines(font, text, width, edit) {
        const out = [];
        String(text).split(/\r?\n/).forEach((para) => {
            if (!width) {
                out.push(para);
                return;
            }
            if (edit) {
                let line = '';
                (para.match(/[^ ]+ *| +/g) || ['']).forEach((w) => {
                    if (line && font.width((line + w).replace(/ +$/, '')) > width) {
                        out.push(line);
                        line = w;
                    } else line += w;
                });
                out.push(line);
                return;
            }
            // words with the spaces before them; a break drops the spaces at the start of the next line
            const words = para.match(/ *[^ ]+| +$/g) || [''];
            let line = '';
            words.forEach((w) => {
                const next = line + w;
                if (line && font.width(next) > width) {
                    out.push(line);
                    line = w.replace(/^ +/, '');
                } else line = next;
            });
            out.push(line);
        });
        return out;
    }

    // a canvas the size of the rect with the text drawn as DrawText would: the glyphs go down in a
    // marker colour, then every marked pixel becomes opaque `color` (the rest stays transparent)
    function textCanvas(font, text, w, h, opts) {
        opts = opts || {};
        const c = document.createElement('canvas');
        c.width = Math.max(1, w);
        c.height = Math.max(1, h);
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(c.width, c.height);
        const rgb = opts.color || [0, 0, 0];
        const lines = opts.single ? [String(text)] : wrapLines(font, text, opts.wrap === false ? 0 : w, opts.edit);
        const total = lines.length * font.height;
        let y = opts.vcenter ? Math.trunc((h - total) / 2) : (opts.top || 0);
        const surf = { w: c.width, h: c.height, data: img.data, dirty: false };
        lines.forEach((line) => {
            const lw = font.width(line);
            let x = opts.align === 'center' ? Math.trunc((w - lw) / 2) : opts.align === 'right' ? w - lw : 0;
            x += opts.left || 0;
            font.draw(surf, x, y, line, [255, 0, 255]);
            y += font.height;
        });
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 255) {
                d[i] = rgb[0];
                d[i + 1] = rgb[1];
                d[i + 2] = rgb[2];
                d[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        return c;
    }

    // a static control (SS_LEFT / SS_CENTER / SS_RIGHT) at its client rect
    function rasterLabel(parent, font, text, x, y, w, h, opts) {
        const n = el('div', 'jz-label');
        Object.assign(n.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
        const c = textCanvas(font, text, w, h, opts);
        c.style.left = '0px';
        c.style.top = '0px';
        n.appendChild(c);
        parent.appendChild(n);
        return n;
    }

    // ---- push buttons ------------------------------------------------------------------------------
    // the control with the focus in its window: Windows draws the focus rectangle while that
    // window is active, whether or not the browser tab itself has the system focus
    function setControlFocus(node) {
        if (!node) return;
        const box = node.closest('.jz-classic, #vistaJezzballModal');
        if (box) box.querySelectorAll('.jz-has-focus').forEach((n) => { if (n !== node) n.classList.remove('jz-has-focus'); });
        if (!node.classList.contains('jz-has-focus')) node.classList.add('jz-has-focus');
        try { node.focus({ preventScroll: true }); } catch (_) { /* detached */ }
    }

    // DrawFocusRect inset 4 px: dots where x + y (from the button's corner) is odd
    function focusCanvas(w, h) {
        const c = document.createElement('canvas');
        c.className = 'jz-focus-rect';
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#000';
        const l = 4;
        const t = 4;
        const r = w - 5;
        const btm = h - 5;
        for (let x = l; x <= r; x++) {
            if ((x + t) & 1) ctx.fillRect(x, t, 1, 1);
            if ((x + btm) & 1) ctx.fillRect(x, btm, 1, 1);
        }
        for (let y = t + 1; y < btm; y++) {
            if ((l + y) & 1) ctx.fillRect(l, y, 1, 1);
            if ((r + y) & 1) ctx.fillRect(r, y, 1, 1);
        }
        return c;
    }

    // spec: { x, y, w, h, text, font (raster) | ui (Segoe UI text), def, onClick, mnemonic }
    function pushButton(parent, spec) {
        const b = el('button', 'jz-button' + (spec.def ? ' jz-default' : '') + (spec.ui ? ' jz-ui' : ''));
        b.type = 'button';
        b.tabIndex = 0;
        Object.assign(b.style, { left: spec.x + 'px', top: spec.y + 'px', width: spec.w + 'px', height: spec.h + 'px' });
        if (spec.ui) {
            const s = el('span');
            s.appendChild(mnemonicFragment(spec.text));
            b.appendChild(s);
        } else {
            const label = spec.text.replace(/&(.)/g, '$1');
            const tw = spec.font.width(label);
            const c = textCanvas(spec.font, label, tw, spec.font.height, { single: true });
            // the label cell sits a pixel above the centre (measured on the VM's 30 and 40 px buttons)
            c.style.left = Math.trunc((spec.w - tw) / 2) + 'px';
            c.style.top = (Math.trunc((spec.h - spec.font.height) / 2) - 1) + 'px';
            b.appendChild(c);
        }
        b.appendChild(focusCanvas(spec.w, spec.h));
        b.dataset.mnemonic = mnemonicOf(spec.text);
        let down = false;
        const setPressed = (on) => b.classList.toggle('jz-pressed', on);
        b.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            down = true;
            setPressed(true);
            try { b.setPointerCapture(e.pointerId); } catch (_) { /* old browsers */ }
            setControlFocus(b);
            e.preventDefault();
        });
        b.addEventListener('pointermove', (e) => {
            if (!down) return;
            const r = b.getBoundingClientRect();
            setPressed(e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom);
        });
        b.addEventListener('pointerup', (e) => {
            if (!down) return;
            down = false;
            const hit = b.classList.contains('jz-pressed');
            setPressed(false);
            if (hit && spec.onClick) spec.onClick();
            e.preventDefault();
        });
        b.addEventListener('pointercancel', () => {
            down = false;
            setPressed(false);
        });
        b.addEventListener('keydown', (e) => {
            if (e.key === ' ' && !e.repeat) {
                setPressed(true);
                e.preventDefault();
            }
        });
        b.addEventListener('keyup', (e) => {
            if (e.key === ' ' && b.classList.contains('jz-pressed')) {
                setPressed(false);
                if (spec.onClick) spec.onClick();
                e.preventDefault();
            }
        });
        b.addEventListener('click', (e) => e.preventDefault());
        // Enter on the default button, a mnemonic, BM_CLICK
        b.jzActivate = () => { if (!b.disabled && spec.onClick) spec.onClick(); };
        parent.appendChild(b);
        return b;
    }

    // ---- sounds (sndPlaySound: one sound at a time) -------------------------------------------------
    class WaveOut {
        constructor() {
            this.ctx = null;
            this.buffers = {};
            this.current = null;
            this.loading = null;
        }

        load() {
            if (this.loading) return this.loading;
            const AC = root.AudioContext || root.webkitAudioContext;
            if (!AC) return Promise.resolve();
            try { this.ctx = new AC(); } catch (_) { return Promise.resolve(); }
            const get = (index, file) => fetch(ART + file).then((r) => r.arrayBuffer())
                .then((ab) => this.ctx.decodeAudioData(ab))
                .then((buf) => { this.buffers[index] = buf; })
                .catch(() => {});
            this.loading = Promise.all([get(JZ.SND.BOUNCE, 'bounce.wav'), get(JZ.SND.JEZZDEAD, 'jezzdead.wav')]);
            return this.loading;
        }

        // bounce does not cut another sound off (seg4: its sndPlaySound is SND_NOSTOP)
        play(index) {
            const buf = this.buffers[index];
            if (!buf || !this.ctx) return;
            if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
            const busy = this.current && this.ctx.currentTime < this.current.end;
            if (busy && index === JZ.SND.BOUNCE) return;
            this.stop();
            const src = this.ctx.createBufferSource();
            src.buffer = buf;
            src.connect(this.ctx.destination);
            src.start();
            this.current = { src, end: this.ctx.currentTime + buf.duration };
        }

        stop() {
            if (this.current) {
                try { this.current.src.stop(); } catch (_) { /* already ended */ }
                this.current = null;
            }
        }
    }

    // ---- classic windows (dialogs) -------------------------------------------------------------------
    // opts: { id, title, frame: 'dialog' | 'border', icon: 'wep' | null, w, h (client),
    //   clientClass, closeDisabled, owner (JezzBallWindow), onClose() }
    function classicWindow(opts) {
        const modal = el('div', 'modal transient jz-classic hidden' + (opts.icon ? '' : ' jz-no-icon'));
        modal.id = opts.id;
        modal.dataset.windowIdentifier = opts.id;
        modal.dataset.windowPositionMode = 'manual-only';
        modal.dataset.windowOwned = 'true';
        modal.dataset.windowFrame = 'flush';
        modal.dataset.aeroTexture = 'off';
        modal.dataset.jzFrame = opts.frame;
        const fw = opts.frame === 'dialog' ? 6 : 2;
        const fh = opts.frame === 'dialog' ? 26 : 22;
        modal.style.width = (opts.w + fw) + 'px';
        modal.style.height = (opts.h + fh) + 'px';
        // the desktop's layout size never goes below its default minimum (200 x 150) otherwise
        modal.dataset.windowMinWidth = String(opts.w + fw);
        modal.dataset.windowMinHeight = String(opts.h + fh);
        const title = el('div', 'modal-window-title');
        const main = el('div', 'modal-window-title-main');
        if (opts.icon) {
            // a div: the taskbar takes the caption's first span as the title (getModalTitle)
            const ic = el('div', 'jz-caption-icon' + (opts.icon === 'wep' ? ' jz-wep-icon' : ''));
            main.appendChild(ic);
        }
        main.appendChild(el('span', '', opts.title));
        title.appendChild(main);
        const controls = el('div', 'modal-window-controls');
        const close = el('button', 'jz-close');
        close.type = 'button';
        close.title = 'Close';
        close.appendChild(el('i', 'fa-regular fa-xmark-large'));
        if (opts.closeDisabled) close.disabled = true;
        controls.appendChild(close);
        const client = el('div', 'modal-content jz-dialog-client ' + (opts.clientClass || ''));
        modal.appendChild(title);
        modal.appendChild(el('div', 'modal-focus-overlay'));
        modal.appendChild(controls);
        modal.appendChild(client);
        // caption: the frame's inner width; one close box (17 px)
        paintCaption(modal, opts.w + fw - (opts.frame === 'dialog' ? 6 : 2), opts.icon ? 19 : 0, 17, opts.captionGap === undefined ? 2 : opts.captionGap);
        const win = {
            modal,
            client,
            closed: false,
            closeButton: close,
            open(left, top) {
                document.body.appendChild(modal);
                if (opts.owner) opts.owner.addDialog(win);
                // openModal / bringModalToFront / setModalOffsetsFromViewportTopLeft: modalUtils.js
                openModal(modal);
                // placed again once the opened window has its layout size
                const place = () => {
                    if (!win.closed && typeof setModalOffsetsFromViewportTopLeft === 'function') {
                        setModalOffsetsFromViewportTopLeft(modal, Math.round(left), Math.round(top), { skipClamp: true });
                    }
                };
                place();
                // the desktop measures (and settles) the window during its open animation; place it
                // again once the animation is over
                let settled = false;
                const settle = () => {
                    if (settled || modal.classList.contains('opening')) return;
                    settled = true;
                    watch.disconnect();
                    place();
                };
                const watch = new MutationObserver(() => setTimeout(settle, 0));
                watch.observe(modal, { attributes: true, attributeFilter: ['class'] });
                requestAnimationFrame(() => requestAnimationFrame(settle));
                setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        watch.disconnect();
                        place();
                    }
                }, 1000);
                bringModalToFront(modal);
            },
            close() {
                if (win.closed) return;
                win.closed = true;
                document.removeEventListener('keydown', onKey, true);
                if (opts.owner) opts.owner.removeDialog(win);
                closeModal(modal);
                setTimeout(() => modal.remove(), 400);
                if (opts.onClosed) opts.onClosed();
            },
            isActive: () => modal.classList.contains('active-window')
        };
        close.addEventListener('click', () => {
            if (opts.onClose) opts.onClose();
            else win.close();
        });
        const onKey = (e) => {
            if (win.closed || !win.isActive()) return;
            if (opts.onKey && opts.onKey(e) === true) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return win;
    }

    // keyboard for a dialog's buttons: Enter = default, Esc = cancel, Tab cycles, Alt+mnemonic
    function dialogKeys(win, buttons, onEnter, onEscape) {
        return (e) => {
            const focusable = buttons.filter((b) => !b.disabled);
            const focused = focusable.find((b) => b.classList.contains('jz-has-focus'));
            if (e.key === 'Enter') {
                // the focused push button, else the dialog's default
                if (focused && focused.tagName === 'BUTTON') focused.jzActivate();
                else if (onEnter) onEnter(null);
                return true;
            }
            if (e.key === 'Escape') {
                if (onEscape) onEscape();
                return true;
            }
            if (e.key === 'Tab' && focusable.length) {
                const i = focusable.indexOf(focused);
                const next = focusable[(i + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length];
                setControlFocus(next);
                return true;
            }
            if (e.key.length === 1 && (e.altKey || !focusable.some((b) => b.tagName === 'INPUT'))) {
                const hit = focusable.find((b) => b.dataset && b.dataset.mnemonic === e.key.toUpperCase());
                if (hit) {
                    setControlFocus(hit);
                    if (hit.tagName === 'BUTTON') hit.jzActivate();
                    return true;
                }
            }
            return false;
        };
    }

    // WEP4UTIL CENTERHWND: centred on the screen's width (a multiple of 8 px), a third down
    function wepPlace(w, h) {
        const sw = root.innerWidth;
        const sh = root.innerHeight;
        return { left: ((sw - w) & ~0xe) >> 1, top: Math.trunc((sh - h) / 3) };
    }

    // ---- the Vista message box -----------------------------------------------------------------------
    // MessageBox(text, caption, MB_YESNO | MB_OKCANCEL, MB_ICONQUESTION) -> 'yes' / 'no' / 'ok' / 'cancel'
    // client widths Vista gave the game's messages (GDI's text widths, measured on the VM)
    const MESSAGE_WIDTH = { 'Do you want to start a new game?': 282 };
    function messageBox(owner, text, caption, kind) {
        return new Promise((resolve) => {
            const buttons = kind === 'okcancel' ? [['OK', 'ok'], ['Cancel', 'cancel']] : [['&Yes', 'yes'], ['&No', 'no']];
            const measure = document.createElement('canvas').getContext('2d');
            measure.font = '9pt "Segoe UI", "SegoeUI", "Noto Sans", sans-serif';
            const textW = Math.ceil(measure.measureText(text).width);
            const w = MESSAGE_WIDTH[text] || Math.max(65 + textW + 39, 8 + buttons.length * 88 + (buttons.length - 1) * 9 + 8 + 65);
            const h = 133;
            const win = classicWindow({
                id: 'vistaJezzballMessage', title: caption, frame: 'dialog', w, h, clientClass: 'jz-msgbox', captionGap: 0,
                closeDisabled: kind !== 'okcancel', owner,
                onClose: () => done(kind === 'okcancel' ? 'cancel' : null),
                onKey: (e) => keys(e)
            });
            const top = el('div', 'jz-msgbox-top');
            top.style.height = '84px';
            win.client.appendChild(top);
            const icon = el('img', 'jz-bitmap');
            icon.src = ART + 'question32.png';
            icon.alt = '';
            Object.assign(icon.style, { left: '25px', top: '26px', width: '32px', height: '32px' });
            win.client.appendChild(icon);
            const t = el('div', 'jz-msgbox-text', text);
            Object.assign(t.style, { left: '65px', top: '34px', width: (w - 65 - 20) + 'px' });
            win.client.appendChild(t);
            const made = [];
            let x = w - 8 - 88;
            for (let i = buttons.length - 1; i >= 0; i--) {
                const [label, result] = buttons[i];
                made[i] = pushButton(win.client, { x, y: 96, w: 88, h: 26, text: label, ui: true, def: i === 0, onClick: () => done(result) });
                x -= 88 + 9;
            }
            function done(result) {
                if (result === null) return;
                win.close();
                resolve(result);
            }
            const keys = dialogKeys(win, made, (focused) => {
                if (!focused) made[0].jzActivate();
            }, () => { if (kind === 'okcancel') done('cancel'); });
            const sw = root.innerWidth;
            const sh = root.innerHeight;
            win.open((sw - (w + 6)) / 2 + 3, (sh - (h + 26)) / 2 + 9);
            setControlFocus(made[0]);
        });
    }

    // ---- the Entertainment Pack's high scores (EntPack.dat) -------------------------------------------
    function todayKey() {
        const d = new Date();
        return d.getDate() + '-' + (d.getMonth() + 1) + '-' + d.getFullYear();
    }

    function readScores() {
        const all = wepStore.get('scores', {});
        const rec = all[WEP_NAME] || { date: '', hall: [], today: [] };
        // Today's list is kept only when the stored date is today
        if (rec.date !== todayKey()) rec.today = [];
        const pad = (list) => {
            const out = list.slice(0, 5);
            while (out.length < 5) out.push({ score: '', name: '' });
            return out;
        };
        return { hall: pad(rec.hall || []), today: pad(rec.today || []) };
    }

    function writeScores(rec) {
        const all = wepStore.get('scores', {});
        all[WEP_NAME] = { date: todayKey(), hall: rec.hall, today: rec.today };
        wepStore.set('scores', all);
    }

    const scoreValue = (e) => (e && e.score !== '' ? parseInt(e.score, 10) : -1);
    // the first entry whose score is lower (an empty entry is lower than any score)
    const rankIn = (list, score) => list.findIndex((e) => scoreValue(e) < score);

    // ---- the game window ------------------------------------------------------------------------------
    class JezzBallWindow {
        constructor(assets) {
            this.assets = assets;
            this.dialogs = [];
            this.wave = new WaveOut();
            this.build();
            this.newGame();
        }

        newGame() {
            const a = this.assets;
            const settings = store.get('settings', {});
            this.soundOn = settings.sound !== 'OFF';
            this.game = new JZ.Game({
                sheet: a.sheet,
                font: a.system,
                demoScript: a.demo,
                sound: (n) => this.sound(n),
                startTimer: (speed) => this.startTimer(speed),
                onState: () => this.syncState(),
                onPausedButton: (show) => this.showPaused(show),
                onCursor: () => { if (this.game.active) this.applyCursor(); },
                levelEnd: (level) => this.nextLevelDialog(level),
                gameOver: (score) => this.gameOverFlow(score),
                redraw: () => this.flush()
            });
            this.game.speed = settings.speed === 'SLOW' ? JZ.SLOW : JZ.FAST;
            this.started = false;
            this.cursor = 'default';
            this.canvas.style.cursor = 'default';
            this.resizeClient(true);
        }

        build() {
            const modal = el('div', 'modal resizeable-window vista-jezzball-window hidden');
            modal.id = MODAL_ID;
            modal.dataset.windowIdentifier = MODAL_ID;
            modal.dataset.vistaGame = GAME_ID;
            modal.dataset.windowFrame = 'flush';
            modal.dataset.aeroTexture = 'off';
            modal.dataset.windowDefaultWidth = String(CLIENT_W + CHROME_W);
            modal.dataset.windowDefaultHeight = String(CLIENT_H + CHROME_H);
            modal.dataset.windowMinWidth = String(CLIENT_W + CHROME_W);
            modal.dataset.windowMinHeight = String(CLIENT_H + CHROME_H);
            modal.style.width = (CLIENT_W + CHROME_W) + 'px';
            modal.style.height = (CLIENT_H + CHROME_H) + 'px';

            const title = el('div', 'modal-window-title');
            const main = el('div', 'modal-window-title-main');
            const fa = el('i', 'fas fa-circle icon-fa');
            fa.setAttribute('aria-hidden', 'true');
            main.appendChild(fa);
            // the taskbar reads this image (by file name under app_icons); the caption draws caption16.png
            const img = el('img', 'icon-image');
            img.alt = '';
            img.src = '/static_images/app_icons/16/vista-jezzball.webp';
            main.appendChild(img);
            main.appendChild(el('div', 'jz-caption-icon'));
            this.titleText = el('span', '', 'JezzBall');
            main.appendChild(this.titleText);
            title.appendChild(main);

            const controls = el('div', 'modal-window-controls');
            const minimize = el('button', 'btn-secondary minimize-btn btn-small');
            minimize.type = 'button';
            minimize.title = 'Minimize';
            minimize.appendChild(el('i', 'fa-regular fa-window-minimize'));
            const close = el('button', 'btn-danger close-btn btn-small');
            close.type = 'button';
            close.title = 'Close';
            close.appendChild(el('i', 'fa-regular fa-xmark-large'));
            controls.appendChild(minimize);
            controls.appendChild(close);

            const content = el('div', 'modal-content jz-content');
            const menubar = el('div', 'jz-menubar');
            menubar.setAttribute('role', 'menubar');
            const client = el('div', 'jz-client');
            client.tabIndex = 0;
            const canvas = el('canvas', 'jz-canvas');
            client.appendChild(canvas);
            const blocker = el('div', 'jz-blocker');
            content.appendChild(menubar);
            content.appendChild(client);
            content.appendChild(blocker);

            modal.appendChild(title);
            modal.appendChild(el('div', 'modal-focus-overlay'));
            modal.appendChild(controls);
            modal.appendChild(content);
            document.body.appendChild(modal);

            this.modal = modal;
            this.menubar = menubar;
            this.client = client;
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.blocker = blocker;
            blocker.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this.focusTopDialog();
            });

            close.addEventListener('click', () => this.exit());
            this.menu = new ClassicMenu(this);

            // the Paused push button (id 2, 80 x 40 at 208, 141); a click resumes
            this.pausedButton = pushButton(client, {
                x: 208, y: 141, w: 80, h: 40, text: 'Paused', font: this.assets.system,
                onClick: () => this.command(CMD.PAUSE)
            });
            this.pausedButton.style.display = 'none';

            client.addEventListener('pointerdown', (e) => this.onPointerDown(e));
            client.addEventListener('pointermove', (e) => this.onPointerMove(e));
            client.addEventListener('contextmenu', (e) => e.preventDefault());

            this.onKeyDown = (e) => this.keyDown(e);
            document.addEventListener('keydown', this.onKeyDown, true);

            this.resizeObserver = new ResizeObserver(() => {
                this.resizeClient(false);
                // three caption buttons: 17 + 17 + 2 + 17
                paintCaption(modal, title.clientWidth || (CLIENT_W), 19, 53, 2);
            });
            this.resizeObserver.observe(client);
            this.resizeObserver.observe(title);

            // active / minimized: the game runs only in the active window
            this.observer = new MutationObserver(() => this.syncActive());
            this.observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
        }

        // ---- the client surface ----
        resizeClient(force) {
            const w = Math.max(CLIENT_W, this.client.clientWidth || CLIENT_W);
            const h = Math.max(CLIENT_H, this.client.clientHeight || CLIENT_H);
            const s = this.game.surface;
            if (!force && w === s.w && h === s.h) return;
            const oldW = s.w;
            const oldH = s.h;
            s.resize(w, h);
            this.canvas.width = w;
            this.canvas.height = h;
            this.canvas.style.width = w + 'px';
            this.canvas.style.height = h + 'px';
            if (force) {
                this.game.paint();
            } else if (w > oldW || h > oldH) {
                // WM_PAINT for the newly exposed strips only
                const scratch = new JZ.Surface(w, h);
                this.game.paintInto(scratch);
                for (let y = 0; y < h; y++) {
                    const x0 = y < oldH ? oldW : 0;
                    if (x0 >= w) continue;
                    s.data.set(scratch.data.subarray((y * w + x0) * 4, (y + 1) * w * 4), (y * w + x0) * 4);
                }
            }
            s.dirty = true;
            this.flush();
        }

        flush() {
            const s = this.game.surface;
            if (!s.dirty) return;
            s.dirty = false;
            if (this.canvas.width !== s.w || this.canvas.height !== s.h) {
                this.canvas.width = s.w;
                this.canvas.height = s.h;
            }
            this.ctx.putImageData(new ImageData(s.data, s.w, s.h), 0, 0);
        }

        // ---- timer (WM_TIMER) ----
        startTimer(speed) {
            this.tickMs = JZ.TICK_MS[speed] || JZ.TICK_MS[JZ.FAST];
            if (this.timer) return;
            this.due = performance.now() + this.tickMs;
            const step = () => {
                this.timer = null;
                if (!this.game || this.destroyed) return;
                const now = performance.now();
                if (now >= this.due) {
                    try {
                        this.game.timer();
                    } catch (err) {
                        console.error('JezzBall:', err);
                    }
                    this.flush();
                    // WM_TIMER is not queued twice: a late tick does not catch up
                    this.due = Math.max(this.due + this.tickMs, now);
                }
                this.timer = setTimeout(step, Math.max(1, this.due - performance.now()));
            };
            this.timer = setTimeout(step, this.tickMs);
        }

        stopTimer() {
            if (this.timer) clearTimeout(this.timer);
            this.timer = null;
        }

        // ---- state ----
        windowActive() {
            const c = this.modal.classList;
            return c.contains('active-window') && !c.contains('hidden') && !c.contains('minimised') && !c.contains('minimising');
        }

        syncActive() {
            const c = this.modal.classList;
            this.game.iconic = c.contains('minimised') || c.contains('minimising');
            const active = this.windowActive() && !this.dialogs.length;
            if (active && !this.started && !c.contains('opening')) {
                // the first WM_ACTIVATE: state 1, then New Game
                this.started = true;
                this.game.active = true;
                this.game.start();
                // New Game left the client black for the WM_PAINT that follows the activation
                this.game.paint();
                this.flush();
            }
            if (this.windowActive() && this.dialogs.length) {
                // a disabled owner hands the activation to its dialog
                setTimeout(() => this.focusTopDialog(), 0);
            }
            if (active !== this.game.active) {
                this.game.active = active;
                if (!active) this.wave.stop();
            }
            if (!active && this.menu.isOpen()) this.menu.close();
        }

        syncState() {
            this.menu.refresh();
        }

        showPaused(show) {
            this.pausedButton.style.display = show ? '' : 'none';
        }

        sound(n) {
            if (!this.soundOn || !this.game.active) return;
            this.wave.play(n);
        }

        applyCursor() {
            const c = this.game.cursor();
            if (!c) return;
            const css = c === 'ns' ? 'ns-resize' : 'ew-resize';
            if (css !== this.cursor) {
                this.cursor = css;
                this.canvas.style.cursor = css;
            }
        }

        clientPoint(e) {
            const r = this.canvas.getBoundingClientRect();
            const sx = r.width ? this.canvas.width / r.width : 1;
            const sy = r.height ? this.canvas.height / r.height : 1;
            return { x: Math.floor((e.clientX - r.left) * sx), y: Math.floor((e.clientY - r.top) * sy) };
        }

        onPointerDown(e) {
            if (e.target !== this.canvas) return;
            if (this.menu.isOpen()) return;
            this.client.focus({ preventScroll: true });
            if (!this.game.active) return;
            const p = this.clientPoint(e);
            if (e.button === 0) this.game.leftDown(p.x, p.y);
            else if (e.button === 2) this.game.rightDown();
            e.preventDefault();
        }

        onPointerMove(e) {
            if (e.target !== this.canvas) return;
            this.applyCursor();
        }

        // WM_KEYDOWN (1:3375) and the menu keys
        keyDown(e) {
            if (!this.windowActive() || this.dialogs.length) return;
            if (this.menu.handleKey(e)) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            const t = e.target;
            if (t && t.closest && t.closest('input, textarea, [contenteditable="true"]') && !this.modal.contains(t)) return;
            let handled = true;
            if (e.key === 'F1') this.command(CMD.CONTENTS);
            else if (e.key === 'F2') this.command(CMD.NEW);
            else if (e.key === 'F3') this.command(CMD.PAUSE);
            else if (e.key === 'Escape') this.minimize();
            else if (e.key === 'F12' && e.ctrlKey && e.shiftKey) this.game.cheat();
            else handled = false;
            if (handled) {
                e.preventDefault();
                e.stopPropagation();
                this.flush();
            }
        }

        minimize() {
            // minimizeModalProgrammatically: public/scripts/comp/modalUtils.js
            if (typeof minimizeModalProgrammatically === 'function') minimizeModalProgrammatically(this.modal);
        }

        // ---- menu commands ----
        menuState(id) {
            const g = this.game;
            const S = JZ.STATE;
            switch (id) {
                case CMD.SCORES: return { disabled: g.state === S.LEVEL_END || g.state === S.PAUSED };
                case CMD.FAST: return { checked: g.speed === JZ.FAST };
                case CMD.SLOW: return { checked: g.speed === JZ.SLOW };
                case CMD.SOUND: return { checked: this.soundOn };
                default: return {};
            }
        }

        saveSettings() {
            store.set('settings', { speed: this.game.speed === JZ.SLOW ? 'SLOW' : 'FAST', sound: this.soundOn ? 'ON' : 'OFF' });
        }

        command(id) {
            const g = this.game;
            switch (id) {
                case CMD.NEW:
                    g.newGame(false);
                    break;
                case CMD.DEMO:
                    g.newGame(true);
                    break;
                case CMD.PAUSE:
                    g.togglePause();
                    break;
                case CMD.SCORES:
                    this.fameDialog();
                    break;
                case CMD.EXIT:
                    this.exit();
                    break;
                case CMD.FAST:
                case CMD.SLOW:
                    g.setSpeed(id === CMD.SLOW ? JZ.SLOW : JZ.FAST);
                    this.saveSettings();
                    break;
                case CMD.SOUND:
                    this.soundOn = !this.soundOn;
                    if (!this.soundOn) this.wave.stop();
                    this.saveSettings();
                    break;
                case CMD.CONTENTS:
                case CMD.HOWTO:
                case CMD.COMMANDS:
                case CMD.HELPHELP:
                    this.help(id);
                    break;
                case CMD.ABOUT:
                    this.aboutDialog();
                    break;
                default:
                    break;
            }
            this.menu.refresh();
            this.flush();
        }

        // WinHelp: Vista has no WinHlp32 for a 16-bit program's .HLP; the help is a classic topic window
        help(id) {
            if (typeof root.openJezzBallHelp === 'function') root.openJezzBallHelp(id === CMD.HOWTO ? 'How To Play' : id === CMD.COMMANDS ? 'Commands' : id === CMD.HELPHELP ? 'help' : 'contents');
        }

        // ---- dialogs ----
        addDialog(d) {
            this.dialogs.push(d);
            if (!this.modal.classList.contains('jz-blocked')) this.modal.classList.add('jz-blocked');
            this.menu.close();
            this.syncActive();
        }

        removeDialog(d) {
            this.dialogs = this.dialogs.filter((x) => x !== d);
            if (this.modal.classList.contains('jz-blocked') !== this.dialogs.length > 0) this.modal.classList.toggle('jz-blocked', this.dialogs.length > 0);
            if (!this.dialogs.length && this.isOpen()) bringModalToFront(this.modal);
            this.syncActive();
        }

        focusTopDialog() {
            const top = this.dialogs[this.dialogs.length - 1];
            if (top && !top.closed) bringModalToFront(top.modal);
        }

        clientOrigin() {
            const r = this.client.getBoundingClientRect();
            return { x: r.left, y: r.top };
        }

        // NEXTLEVELDIALOG: "Well done!", client 198 x 138, the window at (178, 106) of the client
        nextLevelDialog(level) {
            return new Promise((resolve) => {
                const font = this.assets.system;
                const win = classicWindow({
                    id: 'vistaJezzballNextLevel', title: 'Well done!', frame: 'dialog', w: 198, h: 138,
                    clientClass: 'jz-win16', owner: this,
                    onClose: () => finish(),
                    onKey: (e) => keys(e)
                });
                const edit = el('div', 'jz-edit');
                Object.assign(edit.style, { left: '24px', top: '16px', width: '152px', height: '58px' });
                const text = textCanvas(font, 'You have completed Level ' + level, 150, 56, { align: 'center', top: 1, edit: true });
                text.style.position = 'absolute';
                text.style.left = '0px';
                text.style.top = '0px';
                edit.appendChild(text);
                win.client.appendChild(edit);
                const button = pushButton(win.client, { x: 22, y: 88, w: 156, h: 40, text: 'NEXT LEVEL', font, def: true, onClick: () => finish() });
                const keys = dialogKeys(win, [button], () => finish(), () => finish());
                function finish() {
                    win.close();
                    resolve();
                }
                const o = this.clientOrigin();
                win.open(o.x + 178, o.y + 106);
                setControlFocus(button);
            });
        }

        // Game over (1:24ce): the high-score entry (FWEPSCORE2), then "Do you want to start a new game?"
        gameOverFlow(score) {
            return this.recordScore(score)
                .then(() => messageBox(this, 'Do you want to start a new game?', 'Game Over', 'yesno'))
                .then((r) => r === 'yes');
        }

        // FWEPSCORE2: only a score that makes Today's five; then the Hall of Fame
        recordScore(score) {
            if (!(score > 0)) return Promise.resolve(false);
            const rec = readScores();
            const ti = rankIn(rec.today, score);
            if (ti < 0) return Promise.resolve(false);
            return this.nameDialog().then((name) => {
                rec.today.splice(ti, 0, { score: String(score), name });
                rec.today.length = 5;
                const hi = rankIn(rec.hall, score);
                if (hi >= 0) {
                    rec.hall.splice(hi, 0, { score: String(score), name });
                    rec.hall.length = 5;
                }
                wepStore.set('defName', name);
                writeScores(rec);
                return this.fameDialog().then(() => true);
            });
        }

        // WEP4UTIL dialog 200: "Jezz Ball High Score", client 270 x 110
        nameDialog() {
            return new Promise((resolve) => {
                const font = this.assets.system;
                const win = classicWindow({
                    id: 'vistaJezzballScoreEntry', title: WEP_NAME + ' High Score', frame: 'border', icon: 'wep', w: 270, h: 110,
                    clientClass: 'jz-wep', owner: this,
                    onClose: () => finish(),
                    onKey: (e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') {
                            finish();
                            return true;
                        }
                        return false;
                    }
                });
                rasterLabel(win.client, font, 'You have achieved a high score!', 10, 4, 254, 16, { align: 'center' });
                rasterLabel(win.client, font, 'Please enter your name:', 10, 24, 250, 16, { align: 'center' });
                const edit = rasterEdit(win.client, font, 40, 48, 190, 24, wepStore.get('defName', ''), 32);
                const ok = pushButton(win.client, { x: 100, y: 76, w: 70, h: 30, text: 'OK', font, def: true, onClick: () => finish() });
                ok.tabIndex = 0;
                function finish() {
                    const name = edit.value();
                    win.close();
                    resolve(name);
                }
                const p = wepPlace(272, 132);
                win.open(p.left, p.top);
                edit.focus();
            });
        }

        // WEP4UTIL dialog 300: "Jezz Ball High Scores", client 340 x 340
        fameDialog() {
            return new Promise((resolve) => {
                const a = this.assets;
                const font = a.system;
                const rec = readScores();
                const win = classicWindow({
                    id: 'vistaJezzballFame', title: WEP_NAME + ' High Scores', frame: 'border', icon: 'wep', w: 340, h: 340,
                    clientClass: 'jz-wep', owner: this,
                    onClose: () => finish(),
                    onKey: (e) => keys(e)
                });
                const c = win.client;
                const box = (cls, x, y, w, h) => {
                    const n = el('div', cls);
                    Object.assign(n.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
                    c.appendChild(n);
                    return n;
                };
                const rows = (list, y0, ids) => {
                    if (!rec.hall[0].score) return;
                    list.forEach((e, i) => {
                        const y = y0 + i * 18;
                        if (e.score) rasterLabel(c, font, e.score, 20, y, 80, 16, { align: 'right', single: true });
                        if (e.name) rasterLabel(c, font, e.name, 110, y, 200, 16, { single: true });
                    });
                };
                box('jz-dented', 10, 24, 320, 110);
                const title1 = box('jz-outdent', 60, 10, 220, 26);
                title1.style.background = '#c0c0c0';
                rasterLabel(c, a.title, 'Hall of Fame', 60, 10, 220, 26, { align: 'center', single: true, top: 1 });
                rows(rec.hall, 40);
                box('jz-dented', 10, 164, 320, 110);
                const title2 = box('jz-outdent', 60, 150, 220, 26);
                title2.style.background = '#c0c0c0';
                // only the Hall of Fame label has WS_BORDER (its text one pixel in)
                rasterLabel(c, a.title, "Today's High Scores", 60, 150, 220, 26, { align: 'center', single: true });
                rows(rec.today, 180);
                const trophy = (x) => {
                    const t = el('img', 'jz-bitmap');
                    t.src = ART + 'trophy.png';
                    t.alt = '';
                    Object.assign(t.style, { left: x + 'px', top: '284px', width: '36px', height: '50px' });
                    c.appendChild(t);
                };
                trophy(10);
                trophy(100);
                box('jz-indent', 55, 288, 40, 40);
                const icon = el('img', 'jz-bitmap');
                icon.src = ART + 'icon32.png';
                icon.alt = '';
                Object.assign(icon.style, { left: '59px', top: '292px', width: '32px', height: '32px' });
                c.appendChild(icon);
                const ok = pushButton(c, { x: 148, y: 292, w: 68, h: 30, text: 'OK', font, def: true, onClick: () => finish() });
                const clear = pushButton(c, {
                    x: 224, y: 292, w: 108, h: 30, text: '&Clear Scores', font,
                    onClick: () => {
                        messageBox(this, 'Clear All High Scores?', WEP_NAME + ' High Scores', 'okcancel').then((r) => {
                            if (r !== 'ok') return;
                            writeScores({ hall: [], today: [] });
                            win.close();
                            this.fameDialog().then(resolve);
                        });
                    }
                });
                // the underlined C (the button draws its mnemonic, the original's "&Clear Scores")
                underlineMnemonic(clear, font, '&Clear Scores', 108, 30);
                if (!rec.hall[0].score) clear.disabled = true;
                const keys = dialogKeys(win, [ok, clear], (focused) => { if (!focused) finish(); }, () => finish());
                function finish() {
                    win.close();
                    resolve();
                }
                const p = wepPlace(342, 362);
                win.open(p.left, p.top);
                setControlFocus(ok);
            });
        }

        // WEPABOUT2: dialog 100, "About Jezz Ball", client 280 x 256
        aboutDialog() {
            return new Promise((resolve) => {
                const font = this.assets.system;
                const win = classicWindow({
                    id: 'vistaJezzballAbout', title: 'About ' + WEP_NAME, frame: 'border', icon: 'wep', w: 280, h: 256,
                    clientClass: 'jz-wep', owner: this,
                    onClose: () => finish(),
                    onKey: (e) => keys(e)
                });
                const c = win.client;
                const logo = el('img', 'jz-bitmap');
                logo.src = ART + 'wep-logo.png';
                logo.alt = '';
                // the owner-drawn button is 260 x 65, the bitmap 259 x 64: the BitBlt's extra column and
                // row come out white
                Object.assign(logo.style, { left: '10px', top: '10px', width: '259px', height: '64px', padding: '0 1px 1px 0', background: '#fff', boxSizing: 'content-box' });
                c.appendChild(logo);
                const icon = el('img', 'jz-bitmap');
                icon.src = ART + 'icon32.png';
                icon.alt = '';
                Object.assign(icon.style, { left: '20px', top: '88px', width: '32px', height: '32px' });
                c.appendChild(icon);
                rasterLabel(c, font, WEP_NAME, 52, 92, 184, 32, { align: 'center' });
                rasterLabel(c, font, 'by Dima Pavlovsky\n Produced by Marjacq Micro Ltd.', 20, 124, 248, 32, { align: 'center' });
                rasterLabel(c, font, 'Copyright © 1992 Microsoft Corp.', 20, 164, 248, 32, { align: 'center' });
                const ok = pushButton(c, { x: 106, y: 214, w: 68, h: 30, text: 'OK', font, def: true, onClick: () => finish() });
                const keys = dialogKeys(win, [ok], () => finish(), () => finish());
                function finish() {
                    win.close();
                    resolve();
                }
                const p = wepPlace(282, 278);
                win.open(p.left, p.top);
                setControlFocus(ok);
            });
        }

        // ---- open / close ----
        isOpen() {
            return !this.modal.classList.contains('hidden');
        }

        open() {
            const modal = this.modal;
            // still minimizing: restore once the animation has ended
            if (modal.classList.contains('minimising')) {
                modal.addEventListener('animationend', () => this.open(), { once: true });
                return;
            }
            // restoreMinimizedModal / openModal / bringModalToFront: public/scripts/comp/modalUtils.js
            if (modal.classList.contains('minimised') && typeof restoreMinimizedModal === 'function') restoreMinimizedModal(modal);
            if (modal.classList.contains('hidden')) {
                openModal(modal);
                this.wave.load();
            }
            bringModalToFront(modal);
            try { this.client.focus({ preventScroll: true }); } catch (_) { /* old browsers */ }
            this.syncActive();
        }

        // the window and its listeners gone (a reloaded script replaces the instance)
        destroy() {
            this.destroyed = true;
            this.stopTimer();
            this.wave.stop();
            this.menu.close();
            this.dialogs.slice().forEach((d) => d.close());
            document.removeEventListener('keydown', this.onKeyDown, true);
            this.resizeObserver.disconnect();
            this.observer.disconnect();
            this.modal.remove();
        }

        // WM_CLOSE: settings written (1:0109); the next start is a new process
        exit() {
            if (this.dialogs.length) {
                this.focusTopDialog();
                return;
            }
            this.saveSettings();
            this.menu.close();
            this.stopTimer();
            this.wave.stop();
            closeModal(this.modal);
            this.restartOnOpen = true;
        }
    }

    // a WS_BORDER EDIT over an IndentBox (WEP4UTIL): gray, System font, a caret; typing goes
    // through a hidden input
    function rasterEdit(parent, font, x, y, w, h, value, max) {
        const box = el('div', 'jz-edit jz-wep-edit');
        Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
        const input = el('input');
        input.type = 'text';
        input.maxLength = max;
        input.value = value || '';
        input.spellcheck = false;
        input.autocomplete = 'off';
        const caret = el('div', 'jz-caret');
        let canvas = null;
        // a single-line EDIT draws its text (and caret) at the top of the formatting rect
        const left = 2;
        const top = 2;
        const render = () => {
            if (canvas) canvas.remove();
            const v = input.value;
            canvas = textCanvas(font, v, Math.max(1, w - left - 2), font.height, { single: true });
            canvas.style.position = 'absolute';
            canvas.style.left = left + 'px';
            canvas.style.top = top + 'px';
            box.insertBefore(canvas, caret);
            const pos = input.selectionStart === null ? v.length : input.selectionStart;
            caret.style.left = (left + font.width(v.slice(0, pos))) + 'px';
            caret.style.top = top + 'px';
            caret.style.height = font.height + 'px';
        };
        box.appendChild(caret);
        box.appendChild(input);
        ['input', 'keyup', 'focus', 'blur', 'select', 'click'].forEach((ev) => input.addEventListener(ev, render));
        box.addEventListener('pointerdown', () => setTimeout(() => setControlFocus(input), 0));
        parent.appendChild(box);
        render();
        input.dataset.mnemonic = '';
        return {
            box,
            value: () => input.value,
            focus: () => {
                setControlFocus(input);
                input.select();
                render();
            }
        };
    }

    // underline a raster button's mnemonic letter (DrawText's & prefix)
    function underlineMnemonic(button, font, text, w, h) {
        const i = text.indexOf('&');
        if (i < 0) return;
        const label = text.replace(/&(.)/g, '$1');
        const tw = font.width(label);
        const x0 = Math.trunc((w - tw) / 2) + font.width(label.slice(0, i));
        const cw = font.width(label.charAt(i));
        const line = el('div');
        Object.assign(line.style, {
            position: 'absolute', left: x0 + 'px', width: cw + 'px', height: '1px', background: '#000',
            top: (Math.trunc((h - font.height) / 2) - 1 + font.ascent + 1) + 'px', pointerEvents: 'none'
        });
        button.appendChild(line);
    }

    // ---- the classic menu bar ------------------------------------------------------------------------
    class ClassicMenu {
        constructor(win) {
            this.win = win;
            this.titles = [];
            this.openIndex = -1;
            this.popup = null;
            this.hot = -1;
            this.keyboard = false;
            this.mode = false; // Alt / F10: a title selected, no popup
            MENU.forEach((m, i) => {
                const b = el('button', 'jz-menu-title');
                b.type = 'button';
                b.tabIndex = -1;
                b.style.width = m.width + 'px';
                b.appendChild(mnemonicFragment(m.text));
                b.addEventListener('pointerdown', (e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    if (this.win.dialogs.length) return;
                    if (this.openIndex === i) this.close();
                    else this.open(i, false);
                });
                b.addEventListener('pointerenter', () => {
                    if (this.openIndex >= 0 && this.openIndex !== i) this.open(i, this.keyboard);
                });
                win.menubar.appendChild(b);
                this.titles.push(b);
            });
            this.onDocDown = (e) => {
                if (this.popup && this.popup.contains(e.target)) return;
                if (this.titles.includes(e.target.closest && e.target.closest('.jz-menu-title'))) return;
                // a click outside closes the menu and goes nowhere else
                this.close();
                e.preventDefault();
                e.stopPropagation();
            };
        }

        isOpen() {
            return this.openIndex >= 0 || this.mode;
        }

        refresh() {
            if (this.popup && this.openIndex >= 0) this.renderPopup();
        }

        open(i, keyboard) {
            this.close(true);
            this.openIndex = i;
            this.keyboard = !!keyboard;
            this.mode = false;
            this.titles.forEach((t, k) => t.classList.toggle('jz-open', k === i));
            if (this.win.modal.classList.contains('jz-cues') !== this.keyboard) this.win.modal.classList.toggle('jz-cues', this.keyboard);
            const popup = el('div', 'jz-menu-popup' + (this.keyboard ? ' jz-cues' : ''));
            popup.setAttribute('role', 'menu');
            this.popup = popup;
            this.hot = keyboard ? this.firstEnabled(0, 1) : -1;
            this.renderPopup();
            document.body.appendChild(popup);
            const r = this.titles[i].getBoundingClientRect();
            popup.style.left = Math.round(r.left) + 'px';
            popup.style.top = Math.round(r.bottom) + 'px';
            document.addEventListener('pointerdown', this.onDocDown, true);
        }

        firstEnabled(from, dir) {
            const items = MENU[this.openIndex].items;
            for (let n = 0, k = from; n < items.length; n++, k = (k + dir + items.length) % items.length) {
                if (!items[k].separator) return k;
            }
            return -1;
        }

        renderPopup() {
            const m = MENU[this.openIndex];
            const popup = this.popup;
            popup.textContent = '';
            popup.style.width = m.popupWidth + 'px';
            if (m.accelX) popup.style.setProperty('--jz-accel-x', m.accelX + 'px');
            m.items.forEach((item, k) => {
                if (item.separator) {
                    popup.appendChild(el('div', 'jz-menu-separator'));
                    return;
                }
                const state = this.win.menuState(item.id);
                const row = el('div', 'jz-menu-item' + (state.disabled ? ' jz-disabled' : '') + (k === this.hot ? ' jz-hot' : ''));
                row.setAttribute('role', 'menuitem');
                if (state.checked) row.appendChild(el('span', 'jz-menu-check'));
                const text = el('span', 'jz-menu-text');
                text.appendChild(mnemonicFragment(item.text));
                row.appendChild(text);
                if (item.accel) row.appendChild(el('span', 'jz-menu-accel', item.accel));
                row.addEventListener('pointerenter', () => this.setHot(k));
                row.addEventListener('pointerleave', () => { if (!this.keyboard) this.setHot(-1); });
                row.addEventListener('pointerup', (e) => {
                    if (e.button !== 0) return;
                    this.choose(k);
                });
                popup.appendChild(row);
            });
        }

        setHot(k) {
            if (this.hot === k) return;
            this.hot = k;
            const rows = this.popup ? Array.from(this.popup.children) : [];
            let n = 0;
            MENU[this.openIndex].items.forEach((item, idx) => {
                const row = rows[n++];
                if (row && !item.separator) row.classList.toggle('jz-hot', idx === k);
            });
        }

        choose(k) {
            const item = MENU[this.openIndex] && MENU[this.openIndex].items[k];
            if (!item || item.separator) return;
            if (this.win.menuState(item.id).disabled) return;
            this.close();
            this.win.command(item.id);
        }

        close(keepMode) {
            if (this.popup) {
                this.popup.remove();
                this.popup = null;
            }
            document.removeEventListener('pointerdown', this.onDocDown, true);
            this.openIndex = -1;
            this.hot = -1;
            if (!keepMode) {
                this.mode = false;
                // classList.remove writes the attribute even when the class is absent, which would
                // wake the window's class observer (syncActive -> close) again
                if (this.win.modal.classList.contains('jz-cues')) this.win.modal.classList.remove('jz-cues');
                this.titles.forEach((t) => { if (t.classList.contains('jz-open')) t.classList.remove('jz-open'); });
            }
        }

        // Alt / F10, arrows, Enter, Esc, mnemonics -> true when used
        handleKey(e) {
            const open = this.openIndex >= 0;
            if (!open && !this.mode) {
                if ((e.key === 'Alt' || e.key === 'F10') && !e.repeat) {
                    this.altDown = true;
                    if (e.key === 'F10') this.enterMode();
                    return e.key === 'F10';
                }
                if (e.altKey && e.key.length === 1) {
                    const i = MENU.findIndex((m) => mnemonicOf(m.text) === e.key.toUpperCase());
                    if (i >= 0) {
                        this.open(i, true);
                        return true;
                    }
                }
                return false;
            }
            const items = open ? MENU[this.openIndex].items : [];
            const cur = open ? this.openIndex : this.modeIndex;
            switch (e.key) {
                case 'Escape':
                    if (open) {
                        this.close(true);
                        this.enterMode(cur);
                    } else this.close();
                    return true;
                case 'Alt':
                case 'F10':
                    this.close();
                    return true;
                case 'ArrowLeft':
                case 'ArrowRight': {
                    const next = (cur + (e.key === 'ArrowLeft' ? -1 : 1) + MENU.length) % MENU.length;
                    if (open) this.open(next, true);
                    else this.enterMode(next);
                    return true;
                }
                case 'ArrowDown':
                case 'ArrowUp':
                    if (!open) {
                        this.open(cur, true);
                        return true;
                    }
                    this.keyboard = true;
                    this.setHot(this.firstEnabled(this.hot < 0 ? 0 : (this.hot + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length, e.key === 'ArrowUp' ? -1 : 1));
                    return true;
                case 'Enter':
                    if (!open) this.open(cur, true);
                    else if (this.hot >= 0) this.choose(this.hot);
                    return true;
                default:
                    if (e.key.length === 1) {
                        const ch = e.key.toUpperCase();
                        if (open) {
                            const k = items.findIndex((it) => !it.separator && mnemonicOf(it.text) === ch);
                            if (k >= 0) this.choose(k);
                        } else {
                            const i = MENU.findIndex((m) => mnemonicOf(m.text) === ch);
                            if (i >= 0) this.open(i, true);
                        }
                        return true;
                    }
                    return false;
            }
        }

        enterMode(i) {
            this.mode = true;
            this.modeIndex = i === undefined ? 0 : i;
            this.titles.forEach((t, k) => t.classList.toggle('jz-open', k === this.modeIndex));
            if (!this.win.modal.classList.contains('jz-cues')) this.win.modal.classList.add('jz-cues');
        }

        // Alt released on its own toggles the menu bar's selection (keyup)
        altUp() {
            if (!this.altDown) return;
            this.altDown = false;
            if (this.mode) this.close();
            else if (this.openIndex < 0) this.enterMode(0);
        }
    }

    // ---- Windows Help ---------------------------------------------------------------------------------
    // WinHlp32 as Vista's update installs it (a 32-bit, themed window): the button bar, the topic
    // with its title, green jumps (solid underline) and popups (dotted), Back and the browse sequence
    class HelpWindow {
        constructor() {
            const modal = el('div', 'modal resizeable-window jz-help-window hidden');
            modal.id = 'vistaJezzballHelp';
            modal.dataset.windowIdentifier = 'vistaJezzballHelp';
            modal.dataset.windowClient = 'light';
            modal.dataset.vistaDialog = 'form';
            modal.dataset.windowDefaultWidth = '560';
            modal.dataset.windowDefaultHeight = '470';
            modal.dataset.windowMinWidth = '320';
            modal.dataset.windowMinHeight = '200';
            modal.style.width = '560px';
            modal.style.height = '470px';
            const title = el('div', 'modal-window-title');
            const main = el('div', 'modal-window-title-main');
            const fa = el('i', 'fas fa-book icon-fa');
            main.appendChild(fa);
            const img = el('img', 'icon-image');
            img.alt = '';
            img.src = '/static_images/app_icons/16/vista-jezzball.webp';
            main.appendChild(img);
            main.appendChild(el('span', '', 'JezzBall Help'));
            title.appendChild(main);
            const controls = el('div', 'modal-window-controls');
            const minimize = el('button', 'btn-secondary minimize-btn btn-small');
            minimize.type = 'button';
            minimize.title = 'Minimize';
            minimize.appendChild(el('i', 'fa-regular fa-window-minimize'));
            const close = el('button', 'btn-danger close-btn btn-small');
            close.type = 'button';
            close.title = 'Close';
            close.appendChild(el('i', 'fa-regular fa-xmark-large'));
            controls.appendChild(minimize);
            controls.appendChild(close);
            const content = el('div', 'modal-content jz-help-content');
            const bar = el('div', 'jz-help-buttons');
            const button = (label, fn, disabled) => {
                const b = el('button', 'btn-secondary jz-help-button');
                b.type = 'button';
                // one span: the desktop's buttons are flex boxes and would space the mnemonic apart
                const text = el('span');
                text.appendChild(mnemonicFragment(label));
                b.appendChild(text);
                b.disabled = !!disabled;
                b.addEventListener('click', fn);
                bar.appendChild(b);
                return b;
            };
            this.contentsBtn = button('&Contents', () => this.show('contents'));
            button('&Index', () => {}, true);
            this.backBtn = button('&Back', () => this.back());
            button('&Print', () => {}, true);
            this.prevBtn = button('&<<', () => this.browse(-1));
            this.nextBtn = button('&>>', () => this.browse(1));
            const topic = el('div', 'jz-help-topic');
            topic.tabIndex = 0;
            content.appendChild(bar);
            content.appendChild(topic);
            modal.appendChild(title);
            modal.appendChild(el('div', 'modal-focus-overlay'));
            modal.appendChild(controls);
            modal.appendChild(content);
            document.body.appendChild(modal);
            close.addEventListener('click', () => closeModal(modal));
            this.modal = modal;
            this.topic = topic;
            this.history = [];
            this.current = null;
            topic.addEventListener('click', (e) => {
                const a = e.target.closest('[data-jump], [data-popup]');
                if (!a) {
                    this.closePopup();
                    return;
                }
                e.preventDefault();
                if (a.dataset.jump) this.show(a.dataset.jump);
                else this.popup(a.dataset.popup, a);
            });
        }

        // "{j:Topic|label}" / "{p:...}" / "{b:...}" -> nodes
        inline(parent, text) {
            const re = /\{([jpb]):([^}|]*)(?:\|([^}]*))?\}/g;
            let last = 0;
            let m;
            while ((m = re.exec(text))) {
                if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
                if (m[1] === 'b') parent.appendChild(el('b', '', m[2]));
                else {
                    const a = el('a', m[1] === 'j' ? 'jz-help-jump' : 'jz-help-popup', m[3] || m[2]);
                    a.href = '#';
                    a.dataset[m[1] === 'j' ? 'jump' : 'popup'] = m[2];
                    parent.appendChild(a);
                }
                last = re.lastIndex;
            }
            if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
        }

        render(name) {
            const { TOPICS } = root.JezzBallHelpTopics;
            const t = TOPICS[name] || TOPICS.contents;
            this.topic.textContent = '';
            this.closePopup();
            const head = el('div', 'jz-help-title', t.title);
            this.topic.appendChild(head);
            t.body.forEach((block) => {
                if (block.charAt(0) === '#') {
                    this.topic.appendChild(el('div', 'jz-help-heading', block.slice(1)));
                    return;
                }
                const p = el('div', 'jz-help-para');
                const step = /^(\d*)\t/.exec(block);
                if (step) {
                    p.classList.add('jz-help-step');
                    p.appendChild(el('span', 'jz-help-num', step[1]));
                    block = block.slice(step[0].length);
                }
                block.split('\n').forEach((line, i) => {
                    if (i) p.appendChild(el('br'));
                    if (line === 'See Also') p.appendChild(el('b', '', line));
                    else this.inline(p, line);
                });
                this.topic.appendChild(p);
            });
            this.topic.scrollTop = 0;
        }

        show(name) {
            if (name === 'help') name = 'contents';
            if (this.current && this.current !== name) this.history.push(this.current);
            this.current = name;
            this.render(name);
            this.syncButtons();
            const modal = this.modal;
            if (modal.classList.contains('minimised') && typeof restoreMinimizedModal === 'function') restoreMinimizedModal(modal);
            if (modal.classList.contains('hidden')) openModal(modal);
            bringModalToFront(modal);
        }

        back() {
            const prev = this.history.pop();
            if (!prev) return;
            this.current = prev;
            this.render(prev);
            this.syncButtons();
        }

        browse(dir) {
            const { BROWSE } = root.JezzBallHelpTopics;
            const i = BROWSE.indexOf(this.current);
            const next = BROWSE[i < 0 ? 0 : i + dir];
            if (next) this.show(next);
        }

        syncButtons() {
            const { BROWSE } = root.JezzBallHelpTopics;
            const i = BROWSE.indexOf(this.current);
            this.backBtn.disabled = !this.history.length;
            this.prevBtn.disabled = i <= 0;
            this.nextBtn.disabled = i < 0 || i >= BROWSE.length - 1;
        }

        popup(name, anchor) {
            const { TOPICS } = root.JezzBallHelpTopics;
            const t = TOPICS[name];
            this.closePopup();
            if (!t) return;
            const box = el('div', 'jz-help-popupbox');
            t.body.forEach((block) => {
                const p = el('div', 'jz-help-para');
                this.inline(p, block);
                box.appendChild(p);
            });
            document.body.appendChild(box);
            const r = anchor.getBoundingClientRect();
            const w = Math.min(320, root.innerWidth - 20);
            box.style.width = w + 'px';
            box.style.left = Math.max(4, Math.min(root.innerWidth - w - 8, r.left)) + 'px';
            box.style.top = Math.round(r.bottom + 4) + 'px';
            this.popupBox = box;
            this.onAway = (e) => {
                if (e.type === 'keydown' || !box.contains(e.target)) this.closePopup();
            };
            setTimeout(() => {
                document.addEventListener('pointerdown', this.onAway, true);
                document.addEventListener('keydown', this.onAway, true);
            }, 0);
        }

        closePopup() {
            if (!this.popupBox) return;
            this.popupBox.remove();
            this.popupBox = null;
            document.removeEventListener('pointerdown', this.onAway, true);
            document.removeEventListener('keydown', this.onAway, true);
        }
    }

    let help = null;
    root.openJezzBallHelp = (topic) => {
        if (!help) help = new HelpWindow();
        help.show(topic || 'contents');
        return help;
    };

    let jz = null;
    if (root.VistaJezzBall && root.VistaJezzBall.destroy) root.VistaJezzBall.destroy();
    document.addEventListener('keyup', (e) => {
        if (!jz || !jz.windowActive() || jz.dialogs.length) return;
        if (e.key === 'Alt') {
            e.preventDefault();
            jz.menu.altUp();
        }
    }, true);
    document.addEventListener('keydown', (e) => {
        // any other key with Alt down cancels the lone-Alt toggle
        if (jz && e.key !== 'Alt') jz.menu.altDown = false;
    }, true);

    function open() {
        return loadAssets().then((assets) => {
            if (!jz) jz = new JezzBallWindow(assets);
            else if (jz.restartOnOpen && !jz.isOpen()) {
                jz.restartOnOpen = false;
                jz.newGame();
            }
            jz.open();
            return jz;
        });
    }

    VG.register({
        id: GAME_ID,
        name: 'JezzBall',
        icon: ART + 'icon32',
        thumbnail: ART + 'icon32.png',
        feature: 'vista_jezzball',
        open
    });
    root.openVistaJezzBall = open;
    // for scripts/test-vista-jezzball.js
    root.VistaJezzBall = {
        CMD, MENU, readScores, writeScores, rankIn, wrapLines, wepPlace,
        window: () => jz,
        destroy: () => {
            if (jz) jz.destroy();
            jz = null;
            if (help) help.modal.remove();
            help = null;
        }
    };
})(window);
