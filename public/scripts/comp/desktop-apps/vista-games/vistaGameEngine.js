// Windows Vista games, shared engine (Yozora #609). Minesweeper, Mahjong Titans, Purble Place and
// the card games all ran on one sprite engine; this is that engine for the web desktop. Assets
// come from the games' own resources (scripts/build-vista-games.js writes
// /static_images/vista-games/<pack>/data.json + sheets + audio), so sprites, layouts, animations,
// menus and dialogs are the originals:
//
//   VistaGames.loadPack(name)       data.json + sheet loading; pack.xml(path), pack.sprite(path)
//   VistaGames.Stage                canvas at the game's native size, scaled with the window; draws
//                                   sprite frames the way the D3D9 engine did (bilinear, half-texel
//                                   offset, the 2x sheets once the window is 1.5x or more)
//   VistaGames.Animator             the engine's animation scripts (Affects CurrentFrame / Alpha /
//                                   Scale / XScale / YScale / Position / XPosition / YPosition,
//                                   LinearAbsolute / LinearRelative / LinearTargeted, WaitForComplete,
//                                   SendComplete)
//   VistaGames.Sounds               the <Sounds> block of a game's XML
//   VistaGames.createGameWindow     the game's window: menu bar from the MUI menu, accelerators,
//                                   aspect-locked resize (LockWindowAspect, MinSizeIsNative)
//   VistaGames.dialog               a dialog box built from the MUI dialog template (DLU layout)
//   VistaGames.taskDialog           a Vista task dialog (command links), as Select Difficulty
//   VistaGames.store                per-game settings / statistics / saved game (localStorage)
//   VistaGames.register / list      the game list Games Explorer and the Start menu read
//
// openModal / closeModal / bringModalToFront / restoreMinimizedModal / isModalMaximized:
// public/scripts/comp/modalUtils.js. contextMenu: public/scripts/comp/contextMenu.js.
(function (root) {
    'use strict';

    const ASSET_ROOT = '/static_images/vista-games/';
    // Segoe UI 8 pt dialog units on the Vista VM (Minesweeper's Options box: 255x242 DLU = 383x393 px)
    const DLU_X = 6 / 4;
    const DLU_Y = 13 / 8;

    // window.VistaGamesOptions, set before this file loads, presets engine switches
    // (Setup's games: { pixelRatio: 1, maxSheetScale: 1 }, public/scripts/launch/launchGamesHost.js)
    const VG = Object.assign({}, root.VistaGamesOptions || {});
    root.VistaGames = VG;

    // ---- XML nodes ({ t, a, c, v } from build-vista-games.js) --------------------------------
    VG.key = (p) => String(p || '').toUpperCase().replace(/[\\/]+/g, '_');
    VG.child = (node, tag) => (node && node.c ? node.c.find((n) => n.t === tag) : null) || null;
    VG.children = (node, tag) => (node && node.c ? node.c.filter((n) => !tag || n.t === tag) : []);
    VG.text = (node, tag, fallback) => {
        const n = tag ? VG.child(node, tag) : node;
        return n && n.v !== undefined ? n.v : (fallback === undefined ? '' : fallback);
    };
    VG.num = (node, tag, fallback) => {
        const n = tag ? VG.child(node, tag) : node;
        if (!n || n.v === undefined || n.v === '') return fallback === undefined ? 0 : fallback;
        const v = /^0x/i.test(n.v) ? parseInt(n.v, 16) : parseFloat(n.v);
        return Number.isFinite(v) ? v : (fallback === undefined ? 0 : fallback);
    };
    VG.bool = (node, tag, fallback) => {
        const v = VG.text(node, tag, null);
        if (v === null) return !!fallback;
        return /^(1|true|yes)$/i.test(v.trim());
    };
    // 0xRRGGBB / RRGGBB -> css
    VG.color = (value, fallback) => {
        const s = String(value || '').replace(/^0x/i, '').replace(/^#/, '');
        if (!/^[0-9a-f]{6,8}$/i.test(s)) return fallback || '#000';
        return '#' + s.slice(-6);
    };

    // ---- packs -------------------------------------------------------------------------------
    const packs = new Map();

    class Pack {
        constructor(name, data) {
            this.name = name;
            this.base = ASSET_ROOT + name + '/';
            this.data = data;
            this.sheets = new Map(); // key@scale -> Promise<Image>
            this.sprites = new Map();
            this.mui = data.mui || { strings: {}, menus: {}, dialogs: {}, accelerators: {} };
        }

        xml(path) {
            const k = VG.key(path);
            return this.data.xml[k] || this.data.xml[k.replace(/^UI_/, '')] || null;
        }

        string(id, fallback) {
            const s = this.mui.strings[id];
            return s === undefined ? (fallback === undefined ? '' : fallback) : s;
        }

        audioUrl(file) {
            const k = 'AUDIO_SFX_' + VG.key(file);
            const name = this.data.audio[k] || this.data.audio['AUDIO_' + VG.key(file)];
            return name ? this.base + 'audio/' + name + '.m4a' : null;
        }

        // "Decks\ClassicThumb" or "Decks\ClassicThumb.png" (the converter keys them with .PNG)
        imageUrl(path) {
            const k = VG.key(path);
            const name = this.data.images[k] || this.data.images[k + '.PNG'];
            return name ? this.base + 'images/' + name + '.png' : null;
        }

        // "Sheets\blueSheet1.sht", "Backgrounds\felt.jpg", "UI\board\backgrounds\seagrass.dds"
        // -> the key build-vista-games.js stores
        static textureKey(texture) {
            return VG.key(texture).replace(/\.(SHT|JPG|PNG|BMP|DDS)$/, '') + '.SHT';
        }

        // [w, h, w2x, h2x] of a sheet; a sprite on a plain PNG resource ("UI\Board\chooseLayout.png",
        // its X2 file the 2x) reports [0, 0] and [0, 0, 0, 0]
        sheetInfo(texture) {
            const sheet = this.data.sheets[Pack.textureKey(texture)];
            if (sheet) return sheet;
            const png = this.pngTexture(texture);
            if (!png) return null;
            return png.two ? [0, 0, 0, 0] : [0, 0];
        }

        pngTexture(texture) {
            if (!/\.png$/i.test(texture)) return null;
            const k = VG.key(texture);
            const one = this.data.images[k];
            if (!one) return null;
            const two = this.data.images[k.replace(/\.PNG$/, 'X2.PNG')];
            return { one: this.base + 'images/' + one + '.png', two: two ? this.base + 'images/' + two + '.png' : null };
        }

        // scale 1 or 2: the 1x sheet or the 2x (high DPI) sheet. VG.maxSheetScale 1 never asks
        // for a 2x sheet (Setup's games: public/scripts/launch/launchGamesHost.js)
        sheet(texture, scale) {
            if (VG.maxSheetScale === 1) scale = 1;
            const info = this.sheetInfo(texture);
            if (!info) return Promise.resolve(null);
            const two = scale === 2 && info.length > 2;
            const id = Pack.textureKey(texture) + (two ? '@2' : '@1');
            if (!this.sheets.has(id)) {
                const png = this.pngTexture(texture);
                const file = Pack.textureKey(texture).replace(/^SHEETS_/, '').replace(/\.SHT$/, '').toLowerCase();
                const url = png ? (two ? png.two : png.one) : this.base + 'sheets/' + file + (two ? '@2x' : '') + '.webp';
                const p = new Promise((resolve) => {
                    const img = new Image();
                    img.decoding = 'async';
                    img.onload = () => resolve(img);
                    img.onerror = () => resolve(null);
                    img.src = url;
                    // the image's own scale (a capped 2x request returns the 1x sheet)
                    img.__vgScale = two ? 2 : 1;
                });
                this.sheets.set(id, p);
            }
            return this.sheets.get(id);
        }

        // A sprite definition: { type, w, h, regX, regY, anims: [{ texture, ox, oy, count, perRow, pad }] }
        sprite(path) {
            const k = VG.key(path);
            if (this.sprites.has(k)) return this.sprites.get(k);
            const node = this.xml(path);
            const def = node ? VG.spriteFromNode(node, this) : null;
            this.sprites.set(k, def);
            return def;
        }

        // every sheet a list of sprites uses, both scales: resolves when they are decoded
        preload(paths, scale) {
            const textures = new Set();
            paths.forEach((p) => {
                const def = typeof p === 'string' ? this.sprite(p) : p;
                if (def) def.anims.forEach((a) => textures.add(a.texture));
            });
            const jobs = [];
            textures.forEach((t) => {
                jobs.push(this.sheet(t, 1));
                if (scale === 2) jobs.push(this.sheet(t, 2));
            });
            return Promise.all(jobs);
        }
    }

    VG.spriteFromNode = function (node, pack) {
        const def = {
            type: node.a && node.a.Type ? node.a.Type : 'Sprite',
            w: VG.num(node, 'SourceWidth'),
            h: VG.num(node, 'SourceHeight'),
            regX: VG.num(node, 'RegistrationX'),
            regY: VG.num(node, 'RegistrationY'),
            pack,
            anims: VG.children(node, 'Animation').map((a) => ({
                texture: VG.text(a, 'Texture'),
                ox: VG.num(a, 'SheetOffsetX'),
                oy: VG.num(a, 'SheetOffsetY'),
                count: Math.max(1, VG.num(a, 'FrameCount', 1)),
                perRow: Math.max(1, VG.num(a, 'FramesPerRow', 1)),
                pad: VG.bool(a, 'PreppedForFilter') ? 1 : 0
            }))
        };
        // a 1x1 source in a "Button" with no size: take the frame from the first animation's sheet later
        return def;
    };

    VG.loadPack = function (name) {
        if (!packs.has(name)) {
            packs.set(name, fetch(ASSET_ROOT + name + '/data.json', { credentials: 'same-origin' })
                .then((r) => {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then((data) => new Pack(name, data))
                .catch((err) => {
                    packs.delete(name);
                    throw err;
                }));
        }
        return packs.get(name);
    };

    // ---- stage -----------------------------------------------------------------------------
    // The game draws in native pixels (its minimum window size); the stage scales to the window
    // and keeps the aspect ratio (LockWindowAspect), letterboxing with `fill` when maximized.
    class Stage {
        constructor(host, nativeW, nativeH, options) {
            this.host = host;
            this.options = options || {};
            this.canvas = document.createElement('canvas');
            this.canvas.className = 'vista-game-canvas';
            this.ctx = this.canvas.getContext('2d', { alpha: false });
            host.appendChild(this.canvas);
            this.fill = this.options.fill || '#000';
            this.setNativeSize(nativeW, nativeH);
            this.scale = 1;
            this.ox = 0;
            this.oy = 0;
            this.dpr = 1;
            this.dirty = true;
            this.raf = 0;
            this.onFrame = null; // (now) -> bool keepAnimating
            this.draw = null;    // (ctx, stage) paint in native units
            this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.fit()) : null;
            if (this.resizeObserver) this.resizeObserver.observe(host);
            this.fit();
        }

        setNativeSize(w, h) {
            this.nativeW = w;
            this.nativeH = h;
            this.dirty = true;
        }

        fit() {
            const w = Math.max(1, this.host.clientWidth);
            const h = Math.max(1, this.host.clientHeight);
            // VG.pixelRatio pins the backing store (Setup's games draw at 1x, stretched with its
            // 1024 x 768 frame: public/scripts/launch/launchGamesHost.js)
            this.dpr = VG.pixelRatio || Math.max(1, root.devicePixelRatio || 1);
            // A new backing size clears the canvas (to black: it is opaque), so it is only set when
            // it changes, and then drawn again at once: the ResizeObserver runs before the paint,
            // and waiting for the next frame showed one black frame on every launch and resize
            const bw = Math.round(w * this.dpr);
            const bh = Math.round(h * this.dpr);
            const resized = this.canvas.width !== bw || this.canvas.height !== bh;
            if (resized) {
                this.canvas.width = bw;
                this.canvas.height = bh;
            }
            this.canvas.style.width = w + 'px';
            this.canvas.style.height = h + 'px';
            this.cssW = w;
            this.cssH = h;
            this.scale = Math.min(w / this.nativeW, h / this.nativeH);
            if (this.options.integerAtNative && Math.abs(this.scale - 1) < 0.02) this.scale = 1;
            this.ox = Math.round((w - this.nativeW * this.scale) / 2);
            this.oy = Math.round((h - this.nativeH * this.scale) / 2);
            if (this.options.onFit) this.options.onFit(this);
            if (resized && this.draw && w > 1 && h > 1) this.render();
            this.invalidate();
        }

        // device pixels per native pixel; the 2x sheets take over from 1.5
        get pixelScale() {
            return this.scale * this.dpr;
        }

        get sheetScale() {
            if (VG.maxSheetScale === 1) return 1;
            return this.pixelScale >= 1.5 ? 2 : 1;
        }

        // CSS px inside the host -> native px
        toNative(x, y) {
            return { x: (x - this.ox) / this.scale, y: (y - this.oy) / this.scale };
        }

        invalidate() {
            this.dirty = true;
            if (!this.raf) this.raf = root.requestAnimationFrame((t) => this.tick(t));
        }

        tick(now) {
            this.raf = 0;
            let again = false;
            if (this.onFrame) again = this.onFrame(now) === true;
            if (this.dirty || again) this.render();
            // one request a frame: an onFrame that invalidated has asked for the next one already
            // (a second request runs tick twice next frame, and one more time every frame after)
            if (again && !this.raf) this.raf = root.requestAnimationFrame((t) => this.tick(t));
        }

        render() {
            this.dirty = false;
            const ctx = this.ctx;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.fillStyle = this.fill;
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            const s = this.pixelScale;
            ctx.setTransform(s, 0, 0, s, this.ox * this.dpr, this.oy * this.dpr);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'medium';
            if (this.draw) this.draw(ctx, this);
        }

        // Source rect of frame `frame` of animation `anim` in the 1x sheet
        static frameRect(def, anim, frame) {
            const a = def.anims[anim || 0];
            if (!a) return null;
            const f = Math.max(0, Math.min(a.count - 1, frame | 0));
            const pitchW = def.w + a.pad * 2;
            const pitchH = def.h + a.pad * 2;
            return {
                a,
                sx: a.ox + (f % a.perRow) * pitchW + a.pad,
                sy: a.oy + Math.floor(f / a.perRow) * pitchH + a.pad
            };
        }

        // Draw a sprite frame at native x/y (top left minus registration). opts: anim, frame, alpha,
        // w / h (stretch), sx / sy (scale about the registration point), sw / sh (part of the frame)
        sprite(def, x, y, opts) {
            if (!def) return;
            opts = opts || {};
            const r = Stage.frameRect(def, opts.anim, opts.frame);
            if (!r) return;
            const scale = this.sheetScale;
            const img = def.pack.sheetsReady && def.pack.sheetsReady.get(VG.key(r.a.texture) + '@' + scale)
                || def.pack.sheetsReady && def.pack.sheetsReady.get(VG.key(r.a.texture) + '@1');
            if (!img) {
                this.requestSheet(def.pack, r.a.texture, scale);
                return;
            }
            const k = img.__vgScale || 1;
            const srcW = opts.sw !== undefined ? opts.sw : def.w;
            const srcH = opts.sh !== undefined ? opts.sh : def.h;
            const dw = opts.w !== undefined ? opts.w : srcW;
            const dh = opts.h !== undefined ? opts.h : srcH;
            const ctx = this.ctx;
            const alpha = opts.alpha === undefined ? 1 : opts.alpha;
            if (alpha <= 0) return;
            ctx.globalAlpha = alpha;
            const sx = opts.sx === undefined ? 1 : opts.sx;
            const sy = opts.sy === undefined ? 1 : opts.sy;
            let dx = x - def.regX;
            let dy = y - def.regY;
            if (sx !== 1 || sy !== 1) {
                ctx.save();
                ctx.translate(x, y);
                ctx.scale(sx, sy);
                ctx.translate(-x, -y);
            }
            // D3D9 maps pixel centres to texel corners, so the engine's sprites come out half a texel
            // off: every pixel is the average of a 2x2 texel block and the outer row blends into the
            // 1 px padding the sheets carry around each frame (PreppedForFilter). Canvas clamps
            // sampling to the source rect, so the rect takes the padding in and the image is placed
            // half a pixel down / right (VG.texelMode 'none' draws the frame as it is).
            const mode = VG.texelMode;
            if (k === 1 && mode !== 'none' && r.a.pad && !opts.sw && !opts.sh) {
                const sxx = r.sx + (opts.cx || 0) - 1;
                const syy = r.sy + (opts.cy || 0) - 1;
                const fx = dw / srcW;
                const fy = dh / srcH;
                const o = typeof VG.texelShift === 'number' ? VG.texelShift : 0.5;
                // clipped to the sprite's box: the shift must not spill into the next column / row
                ctx.save();
                ctx.beginPath();
                ctx.rect(dx, dy, dw, dh);
                ctx.clip();
                ctx.drawImage(img, sxx, syy, srcW + 2, srcH + 2, dx - fx + o, dy - fy + o, dw + fx * 2, dh + fy * 2);
                ctx.restore();
            } else {
                ctx.drawImage(img, (r.sx + (opts.cx || 0)) * k, (r.sy + (opts.cy || 0)) * k, srcW * k, srcH * k, dx, dy, dw, dh);
            }
            if (sx !== 1 || sy !== 1) ctx.restore();
            ctx.globalAlpha = 1;
        }

        requestSheet(pack, texture, scale) {
            pack.sheetsReady = pack.sheetsReady || new Map();
            const id = VG.key(texture) + '@' + scale;
            pack.sheetsPending = pack.sheetsPending || new Set();
            if (pack.sheetsPending.has(id)) return;
            pack.sheetsPending.add(id);
            pack.sheet(texture, scale).then((img) => {
                if (img) pack.sheetsReady.set(id, img);
                this.invalidate();
            });
            if (scale === 2) this.requestSheet(pack, texture, 1);
        }

        destroy() {
            if (this.resizeObserver) this.resizeObserver.disconnect();
            if (this.raf) root.cancelAnimationFrame(this.raf);
            this.raf = 0;
            this.canvas.remove();
        }
    }
    VG.Stage = Stage;

    // Make every sheet of `paths` drawable before the first paint (both scales the stage may use)
    // pack: the pack string paths resolve in; sprite objects carry their own (another pack's art)
    VG.warmSprites = function (stage, pack, paths) {
        const defs = paths.map((p) => (typeof p === 'string' ? pack.sprite(p) : p)).filter(Boolean);
        const jobs = [];
        const seen = new Set();
        defs.forEach((d) => d.anims.forEach((a) => {
            const owner = d.pack || pack;
            const id = owner.name + '|' + VG.key(a.texture);
            if (seen.has(id)) return;
            seen.add(id);
            owner.sheetsReady = owner.sheetsReady || new Map();
            [1, 2].forEach((scale) => {
                jobs.push(owner.sheet(a.texture, scale).then((img) => {
                    if (!img) return;
                    owner.sheetsReady.set(VG.key(a.texture) + '@' + scale, img);
                }));
            });
        }));
        return Promise.all(jobs).then(() => stage && stage.invalidate());
    };

    // ---- animation scripts -----------------------------------------------------------------
    // A script is a list of <Animation> steps, <WaitForComplete/> barriers and a final
    // <SendAnimationComplete/>. Steps between barriers run together. target: a plain object with
    // frame / alpha (0-255) / scale / xScale / yScale / x / y. Returns a handle with step(now)
    // (true while running) and the events the script sent.
    class Animator {
        constructor(node, target, options) {
            this.target = target;
            this.options = options || {};
            this.groups = [];
            let group = [];
            VG.children(node).forEach((n) => {
                if (n.t === 'Animation') group.push(Animator.parseStep(n));
                else if (n.t === 'WaitForComplete') {
                    if (group.length) this.groups.push(group);
                    group = [];
                } else if (n.t === 'SendAnimationComplete') {
                    if (group.length) this.groups.push(group);
                    group = [];
                    this.groups.push([{ sendDone: true }]);
                }
            });
            if (group.length) this.groups.push(group);
            this.index = -1;
            this.start = 0;
            this.done = false;
            this.timeScale = this.options.timeScale || 1;
        }

        static parseStep(n) {
            const type = VG.child(n, 'Type');
            const name = type && type.a ? type.a.Name : 'LinearAbsolute';
            const step = {
                affects: VG.text(n, 'Affects'),
                type: name,
                start: VG.num(type, 'Start', 0),
                end: VG.num(type, 'End', 0),
                time: VG.num(type, 'Time', 0),
                delta: VG.num(type, 'Delta', 0),
                send: VG.text(n, 'SendComplete', '')
            };
            const startX = VG.child(type, 'StartX');
            if (startX) {
                step.startX = VG.num(type, 'StartX');
                step.startY = VG.num(type, 'StartY');
                step.endX = VG.num(type, 'EndX');
                step.endY = VG.num(type, 'EndY');
            }
            return step;
        }

        begin(now) {
            this.index = 0;
            this.start = now;
            this.enter(now);
        }

        enter() {
            const group = this.groups[this.index];
            if (!group) return;
            group.forEach((s) => {
                if (s.sendDone) return;
                const t = this.target;
                // relative steps start from the current value
                s.from = s.type === 'LinearRelative' ? Animator.read(t, s.affects) : s.start;
                s.to = s.type === 'LinearRelative' ? s.from + (s.delta || s.end) : s.end;
                if (s.type === 'LinearTargeted' && this.options.targets && this.options.targets[s.affects]) {
                    s.from = Animator.read(t, s.affects);
                    s.to = this.options.targets[s.affects];
                }
            });
        }

        static read(t, affects) {
            switch (affects) {
            case 'CurrentFrame': return t.frame || 0;
            case 'Alpha': return t.alpha === undefined ? 255 : t.alpha;
            case 'Scale': return t.scale === undefined ? 1 : t.scale;
            case 'XScale': return t.xScale === undefined ? 1 : t.xScale;
            case 'YScale': return t.yScale === undefined ? 1 : t.yScale;
            case 'XPosition': return t.x || 0;
            case 'YPosition': return t.y || 0;
            case 'Position': return { x: t.x || 0, y: t.y || 0 };
            default: return 0;
            }
        }

        static write(t, s, k) {
            const lerp = (a, b) => a + (b - a) * k;
            switch (s.affects) {
            case 'CurrentFrame': t.frame = Math.floor(lerp(s.from, s.to + (s.to >= s.from ? 0.999 : -0.999))); break;
            case 'Alpha': t.alpha = lerp(s.from, s.to); break;
            case 'Scale': t.scale = lerp(s.from, s.to); break;
            case 'XScale': t.xScale = lerp(s.from, s.to); break;
            case 'YScale': t.yScale = lerp(s.from, s.to); break;
            case 'XPosition': t.x = lerp(s.from, s.to); break;
            case 'YPosition': t.y = lerp(s.from, s.to); break;
            case 'Position':
                if (s.startX !== undefined) {
                    t.x = lerp(s.startX, s.endX);
                    t.y = lerp(s.startY, s.endY);
                } else if (s.from && typeof s.from === 'object') {
                    const to = typeof s.to === 'object' ? s.to : s.from;
                    t.x = lerp(s.from.x, to.x);
                    t.y = lerp(s.from.y, to.y);
                }
                break;
            default: break;
            }
        }

        // advance; returns true while running
        step(now) {
            if (this.done) return false;
            if (this.index < 0) this.begin(now);
            for (;;) {
                const group = this.groups[this.index];
                if (!group) {
                    this.done = true;
                    return false;
                }
                const elapsed = (now - this.start) / 1000 * this.timeScale;
                let longest = 0;
                let ended = true;
                for (const s of group) {
                    if (s.sendDone) {
                        if (this.options.onEvent) this.options.onEvent('AnimationComplete');
                        continue;
                    }
                    longest = Math.max(longest, s.time);
                    const k = s.time > 0 ? Math.min(1, elapsed / s.time) : 1;
                    Animator.write(this.target, s, k);
                    if (k < 1) ended = false;
                    else if (s.send && !s.sent) {
                        s.sent = true;
                        if (this.options.onEvent) this.options.onEvent(s.send);
                    }
                }
                if (!ended) return true;
                this.index += 1;
                this.start += longest * 1000 / this.timeScale;
                this.enter(now);
            }
        }
    }
    VG.Animator = Animator;

    // ---- sounds ----------------------------------------------------------------------------
    VG.texelMode = 'half';
    VG.soundEnabled = true;
    class Sounds {
        constructor(pack, soundsNode) {
            this.pack = pack;
            this.enabled = true;
            this.defs = {};
            VG.children(soundsNode).forEach((n) => {
                const file = VG.text(n, 'File');
                if (!file) return;
                (this.defs[n.t] = this.defs[n.t] || []).push({
                    url: pack.audioUrl(file),
                    volume: Math.min(1, VG.num(n, 'Volume', 100) / 100),
                    buffers: Math.max(1, VG.num(n, 'Buffers', 1)),
                    pool: []
                });
            });
        }

        // a sound the XML does not list (FreeCell's FreeCellWin.wma is only in the pack)
        define(name, file, volume) {
            const url = this.pack.audioUrl(file);
            if (url) this.defs[name] = [{ url, volume: volume === undefined ? 1 : volume, buffers: 1, pool: [] }];
        }

        // play(name [, variant]): a random variant when the XML lists several (Flower Garden)
        play(name, variant) {
            if (!this.enabled || !VG.soundEnabled) return null;
            const list = this.defs[name];
            if (!list || !list.length) return null;
            const def = list[variant === undefined ? Math.floor(Math.random() * list.length) : Math.min(variant, list.length - 1)];
            if (!def.url) return null;
            let audio = def.pool.find((a) => a.paused || a.ended);
            if (!audio && def.pool.length < def.buffers) {
                audio = new Audio(def.url);
                audio.preload = 'auto';
                def.pool.push(audio);
            }
            if (!audio) return null;
            try {
                audio.currentTime = 0;
                audio.volume = def.volume;
                const p = audio.play();
                if (p && p.catch) p.catch(() => {});
            } catch (_) { /* autoplay refused */ }
            return audio;
        }

        warm() {
            Object.values(this.defs).forEach((list) => list.forEach((def) => {
                if (def.url && !def.pool.length) {
                    const a = new Audio(def.url);
                    a.preload = 'auto';
                    def.pool.push(a);
                }
            }));
        }
    }
    VG.Sounds = Sounds;

    // ---- tips (the engine's in-game balloons: Tips\Styles\<style>\TipStyle.xml) --------------
    VG.tipStyle = function (pack, style) {
        const base = 'Tips\\Styles\\' + style + '\\';
        const node = pack.xml(base + 'TipStyle.xml');
        if (!node) return null;
        const sprite = (tag) => pack.sprite(VG.text(node, tag));
        return {
            left: sprite('LeftBorder'), right: sprite('RightBorder'), top: sprite('TopBorder'), bottom: sprite('BottomBorder'),
            back: sprite('Back'), ul: sprite('ULCorner'), ur: sprite('URCorner'), ll: sprite('LLCorner'), lr: sprite('LRCorner'),
            close: sprite('CloseButton'), check: sprite('CheckButton'), checkMark: sprite('CheckSprite'), info: sprite('InfoSprite'),
            bodyFont: VG.text(node, 'BodyFontFace', 'Segoe UI'), bodySize: VG.num(node, 'BodyFontSize', 8),
            bodyColor: VG.color(VG.text(node, 'BodyFontColor'), '#494a4d'), bodyBold: VG.bool(node, 'BodyFontBold'),
            titleFont: VG.text(node, 'TitleFontFace', 'Segoe UI'), titleSize: VG.num(node, 'TitleFontSize', 12),
            titleColor: VG.color(VG.text(node, 'TitleFontColor'), '#014d9c'), titleBold: VG.bool(node, 'TitleFontBold'),
            sprites() {
                return [this.left, this.right, this.top, this.bottom, this.back, this.ul, this.ur, this.ll, this.lr, this.close, this.info].filter(Boolean);
            }
        };
    };

    // points -> px at 96 dpi
    VG.pt = (size) => Math.round(size * 96 / 72);

    VG.wrapText = function (ctx, text, width) {
        const out = [];
        String(text).split('\n').forEach((para) => {
            let line = '';
            para.split(/\s+/).forEach((word) => {
                const test = line ? line + ' ' + word : word;
                if (line && ctx.measureText(test).width > width) {
                    out.push(line);
                    line = word;
                } else line = test;
            });
            out.push(line);
        });
        return out;
    };

    // A tip balloon in native units. tip: { title, message, x, y, w, alpha, closeHot, closeDown }.
    // Returns the close button rect for hit testing.
    VG.drawTip = function (stage, style, tip) {
        if (!style || !tip) return null;
        const ctx = stage.ctx;
        const w = tip.w || 210;
        const padL = 12;
        const padT = 12;
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.font = (style.bodyBold ? 'bold ' : '') + VG.pt(style.bodySize) + 'px "' + style.bodyFont + '", "Segoe UI", sans-serif';
        // the text stays clear of the right border and its shadow
        const padR = style.right.w + 10;
        const bodyLines = VG.wrapText(ctx, tip.message || '', w - padL - padR);
        ctx.restore();
        const titleH = tip.title ? VG.pt(style.titleSize) + 8 : 0;
        const h = Math.max(58, padT + titleH + bodyLines.length * (VG.pt(style.bodySize) + 4) + 14);
        const a = tip.alpha === undefined ? 1 : tip.alpha;
        const x = Math.round(tip.x);
        // tip.bottom anchors the balloon by its lower edge: a longer text grows it upward
        const y = Math.round(tip.bottom !== undefined ? tip.bottom - h : tip.y);
        const ul = style.ul;
        const ur = style.ur;
        const ll = style.ll;
        const lr = style.lr;
        // The nine pieces go together in a layer at the sheets' own scale (1 or 2) and the layer
        // is drawn as one image: drawn straight onto a window scaled by a fraction, each piece's
        // clipped edge lands mid-pixel and the seams between them show as hairlines.
        const k = stage.sheetScale;
        const layer = stage.tipLayer || (stage.tipLayer = document.createElement('canvas'));
        layer.width = Math.max(1, w * k);
        layer.height = Math.max(1, h * k);
        const lctx = layer.getContext('2d');
        lctx.setTransform(k, 0, 0, k, 0, 0);
        lctx.imageSmoothingEnabled = true;
        lctx.imageSmoothingQuality = 'medium';
        const pieces = Object.create(stage);
        pieces.ctx = lctx;
        pieces.invalidate = () => stage.invalidate();
        pieces.requestSheet = (pack, texture, scale) => stage.requestSheet(pack, texture, scale);
        // centre fill, then the edges and corners over it
        pieces.sprite(style.back, style.left.w, ul.h, { w: w - style.left.w - style.right.w, h: h - ul.h - ll.h });
        pieces.sprite(style.top, ul.w, 0, { w: w - ul.w - ur.w });
        pieces.sprite(style.bottom, ll.w, h - style.bottom.h, { w: w - ll.w - lr.w });
        pieces.sprite(style.left, 0, ul.h, { h: h - ul.h - ll.h });
        pieces.sprite(style.right, w - style.right.w, ur.h, { h: h - ur.h - lr.h });
        pieces.sprite(ul, 0, 0);
        pieces.sprite(ur, w - ur.w, 0);
        pieces.sprite(ll, 0, h - ll.h);
        pieces.sprite(lr, w - lr.w, h - lr.h);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.drawImage(layer, x, y, w, h);
        ctx.restore();
        const close = { x: x + w - 24, y: y + 8, w: 12, h: 12 };
        if (style.close) stage.sprite(style.close, close.x, close.y, { anim: tip.closeDown ? 2 : (tip.closeHot ? 1 : 0), alpha: a });
        const ctx2 = stage.ctx;
        ctx2.save();
        ctx2.globalAlpha = a;
        ctx2.textBaseline = 'top';
        let ty = y + padT;
        if (tip.title) {
            ctx2.font = (style.titleBold ? 'bold ' : '') + VG.pt(style.titleSize) + 'px "' + style.titleFont + '", "Segoe UI", sans-serif';
            ctx2.fillStyle = style.titleColor;
            ctx2.fillText(tip.title, x + padL, ty);
            ty += titleH;
        }
        ctx2.font = (style.bodyBold ? 'bold ' : '') + VG.pt(style.bodySize) + 'px "' + style.bodyFont + '", "Segoe UI", sans-serif';
        ctx2.fillStyle = style.bodyColor;
        bodyLines.forEach((line) => {
            ctx2.fillText(line, x + padL, ty);
            ty += VG.pt(style.bodySize) + 4;
        });
        ctx2.restore();
        return { x, y, w, h, close };
    };

    // ---- scenes (Mahjong's layout screen, Purble Place): Container / Image / Label / Button XML ----
    // Every node keeps its name; X / Y nest through containers. Label: Text, FontName, FontSize (pt),
    // Color (0xAARRGGBB), Alpha (0-255), Justify 64 = centred in its W, Visible. Button: a "Button"
    // sprite drawn with animation 0 / 1 / 2 for normal / hot / pressed.
    class Scene {
        constructor(pack, node) {
            this.pack = pack;
            this.items = [];
            this.byName = {};
            this.walk(node, 0, 0);
        }

        walk(node, ox, oy) {
            VG.children(node).forEach((n) => {
                const x = ox + VG.num(n, 'X', 0);
                const y = oy + VG.num(n, 'Y', 0);
                if (n.t === 'Container') {
                    this.walk(n, x, y);
                    return;
                }
                if (n.t !== 'Image' && n.t !== 'Label' && n.t !== 'Button') return;
                const item = {
                    kind: n.t.toLowerCase(),
                    name: n.a && n.a.Name,
                    node: n,
                    x, y,
                    w: VG.num(n, 'W', 0),
                    h: VG.num(n, 'H', 0),
                    visible: VG.text(n, 'Visible', 'true') !== 'false',
                    anim: VG.num(n, 'AnimIdx', 0),
                    frame: 0,
                    alpha: VG.num(n, 'Alpha', 255) / 255
                };
                if (n.t === 'Label') {
                    item.text = VG.text(n, 'Text');
                    item.font = VG.text(n, 'FontName', 'Segoe UI');
                    item.size = VG.num(n, 'FontSize', 10);
                    const c = VG.text(n, 'Color', '0xFF000000').replace(/^0x/i, '');
                    item.color = '#' + c.slice(-6);
                    item.justify = VG.num(n, 'Justify', 0);
                } else {
                    item.sprite = this.pack.sprite(VG.text(n, 'Sprite'));
                    if (item.sprite && !item.w) {
                        item.w = item.sprite.w;
                        item.h = item.sprite.h;
                    }
                }
                this.items.push(item);
                if (item.name) this.byName[item.name] = item;
            });
        }

        get(name) {
            return this.byName[name] || null;
        }

        sprites() {
            return this.items.map((i) => i.sprite).filter(Boolean);
        }

        // state: { hot, down } button names
        draw(stage, state) {
            const ctx = stage.ctx;
            this.items.forEach((it) => {
                if (!it.visible || it.alpha <= 0) return;
                if (it.kind === 'label') {
                    if (!it.text) return;
                    ctx.save();
                    ctx.globalAlpha = it.alpha;
                    ctx.fillStyle = it.color;
                    ctx.font = VG.pt(it.size) + 'px "' + it.font + '", "Segoe UI", sans-serif';
                    ctx.textBaseline = 'top';
                    ctx.textAlign = it.justify === 64 ? 'center' : 'left';
                    ctx.fillText(it.text, it.justify === 64 ? it.x + it.w / 2 : it.x, it.y);
                    ctx.restore();
                    return;
                }
                if (!it.sprite) return;
                let anim = it.anim;
                if (it.kind === 'button' && state) {
                    if (state.down === it.name) anim = 2;
                    else if (state.hot === it.name) anim = 1;
                    anim = Math.min(anim, it.sprite.anims.length - 1);
                }
                const stretch = it.w && it.w !== it.sprite.w ? { w: it.w, h: it.h } : {};
                stage.sprite(it.sprite, it.x, it.y, Object.assign({ anim, frame: it.frame, alpha: it.alpha }, stretch));
            });
        }

        // the top-most button under a native point
        hit(p) {
            for (let i = this.items.length - 1; i >= 0; i--) {
                const it = this.items[i];
                if (it.kind !== 'button' || !it.visible) continue;
                if (p.x >= it.x && p.y >= it.y && p.x < it.x + it.w && p.y < it.y + it.h) return it;
            }
            return null;
        }
    }
    VG.Scene = Scene;

    // ---- storage ---------------------------------------------------------------------------
    VG.store = function (game) {
        const k = 'vistaGame:' + game;
        let cache = null;
        const read = () => {
            if (cache) return cache;
            try { cache = JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (_) { cache = {}; }
            return cache;
        };
        return {
            get(name, fallback) {
                const v = read()[name];
                return v === undefined ? fallback : v;
            },
            set(name, value) {
                read()[name] = value;
                try { localStorage.setItem(k, JSON.stringify(cache)); } catch (_) { /* quota */ }
            },
            remove(name) {
                delete read()[name];
                try { localStorage.setItem(k, JSON.stringify(cache)); } catch (_) { /* quota */ }
            }
        };
    };

    // ---- game registry (Games Explorer, Start menu) -------------------------------------------
    const registry = [];
    VG.register = function (entry) {
        const i = registry.findIndex((e) => e.id === entry.id);
        if (i >= 0) registry[i] = entry;
        else registry.push(entry);
    };
    VG.list = () => registry.slice();

    // ---- window ----------------------------------------------------------------------------
    const isVistaDesktop = () => {
        const b = document.body.classList;
        return b.contains('desktop-mode') && !b.contains('windows-classic-theme');
    };
    VG.isVistaDesktop = isVistaDesktop;

    const el = (tag, className, text) => {
        const n = document.createElement(tag);
        if (className) n.className = className;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    VG.el = el;

    const iconButton = (className, title, iconClass) => {
        const b = el('button', className);
        b.type = 'button';
        b.title = title;
        const i = el('i', iconClass);
        i.setAttribute('aria-hidden', 'true');
        b.appendChild(i);
        return b;
    };

    // "&New Game\tF2" -> { label: "New Game", mnemonic: "N", accel: "F2" }
    VG.menuLabel = function (text) {
        const [label, accel] = String(text || '').split('\t');
        const m = /&(.)/.exec(label || '');
        return { label: (label || '').replace(/&(.)/g, '$1').replace(/&&/g, '&'), mnemonic: m ? m[1].toUpperCase() : '', accel: accel || '' };
    };

    const VK_NAMES = { 112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6', 118: 'F7', 119: 'F8', 120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12', 46: 'Delete', 13: 'Enter', 27: 'Escape', 32: ' ' };

    // spec: { id, title, icon (url), iconClass, pack, menu (MUI menu id or items), accelerators (MUI id),
    //   nativeW, nativeH, fill, onCommand(id), menuState(id) -> { checked, disabled, hidden },
    //   onClose() -> false to keep open, onActivate(active), resizable (default true), maximizable }
    VG.createGameWindow = function (spec) {
        let modal = document.getElementById(spec.id);
        if (modal) return modal.__vg;

        modal = el('div', 'modal resizeable-window vista-game-window hidden');
        modal.id = spec.id;
        modal.dataset.windowIdentifier = spec.id;
        modal.dataset.windowClient = 'light';
        modal.dataset.vistaGame = spec.game || spec.id;
        if (spec.maximizable === false) modal.dataset.windowNoMaximize = 'true';
        if (spec.resizable === false) {
            modal.classList.remove('resizeable-window');
            modal.dataset.windowFixedSize = 'true';
        }

        const title = el('div', 'modal-window-title');
        const titleMain = el('div', 'modal-window-title-main');
        const fa = el('i', (spec.iconClass || 'fas fa-gamepad') + ' icon-fa');
        fa.setAttribute('aria-hidden', 'true');
        titleMain.appendChild(fa);
        if (spec.icon) {
            const img = el('img', 'icon-image');
            img.alt = '';
            img.src = spec.icon;
            titleMain.appendChild(img);
        }
        const titleText = el('span', '', spec.title);
        titleMain.appendChild(titleText);
        title.appendChild(titleMain);

        const controls = el('div', 'modal-window-controls');
        const minimizeBtn = iconButton('btn-secondary minimize-btn btn-small', 'Minimize', 'fa-regular fa-window-minimize');
        const closeBtn = iconButton('btn-danger close-btn btn-small', 'Close', 'fa-regular fa-xmark-large');
        controls.appendChild(minimizeBtn);
        controls.appendChild(closeBtn);

        const content = el('div', 'modal-content win7 vista-game-content');
        const menubar = el('div', 'naxt-menubar vista-game-menubar');
        menubar.setAttribute('role', 'menubar');
        const surface = el('div', 'vista-game-surface');
        surface.tabIndex = 0;
        const blocker = el('div', 'vista-game-blocker');
        content.appendChild(menubar);
        content.appendChild(surface);
        content.appendChild(blocker);

        modal.appendChild(title);
        modal.appendChild(el('div', 'modal-focus-overlay'));
        modal.appendChild(controls);
        modal.appendChild(content);
        document.body.appendChild(modal);

        const win = {
            spec,
            modal,
            content,
            menubar,
            surface,
            titleText,
            stage: null,
            dialogs: [],
            setTitle(t) { titleText.textContent = t; },
            open() { VG.showWindow(win); },
            close() { VG.closeWindow(win); },
            isOpen() { return !modal.classList.contains('hidden'); },
            isActive() { return modal.classList.contains('active-window') && !win.dialogs.length; },
            // native client size changed (new board size): resize the window to it
            setNativeSize(w, h, refit) {
                spec.nativeW = w;
                spec.nativeH = h;
                if (win.stage) win.stage.setNativeSize(w, h);
                if (refit !== false) VG.fitWindow(win, 1);
            },
            command(id) {
                if (spec.onCommand) spec.onCommand(id);
            }
        };
        modal.__vg = win;

        closeBtn.addEventListener('click', () => {
            if (win.dialogs.length) return;
            if (spec.onClose && spec.onClose() === false) return;
            VG.closeWindow(win);
        });

        VG.buildMenubar(win);
        VG.wireAccelerators(win);

        // aspect-locked resize (modalUtils.js calls modal.windowResizeConstrain while resizing)
        modal.windowResizeConstrain = (w, h, dir) => VG.constrainResize(win, w, h, dir);

        win.stage = new Stage(surface, spec.nativeW, spec.nativeH, { fill: spec.fill || '#000', integerAtNative: true });

        // keep the game told about focus (Vista games pause the clock while minimized); settle the
        // size once an open has revealed the window
        const mo = new MutationObserver(() => {
            if (win.wantSettle && !modal.classList.contains('hidden')) VG.settleWindow(win);
            const active = modal.classList.contains('active-window') && !modal.classList.contains('minimised') && !modal.classList.contains('hidden');
            if (active !== win.lastActive) {
                win.lastActive = active;
                if (spec.onActivate) spec.onActivate(active);
            }
        });
        mo.observe(modal, { attributes: true, attributeFilter: ['class'] });
        return win;
    };

    VG.buildMenubar = function (win) {
        const spec = win.spec;
        const menus = Array.isArray(spec.menu) ? spec.menu : (spec.pack && spec.pack.mui.menus[spec.menu]) || [];
        win.menubar.textContent = '';
        win.menuButtons = [];
        menus.forEach((top) => {
            const label = VG.menuLabel(top.text);
            const button = el('button', 'naxt-menu-title');
            button.type = 'button';
            button.setAttribute('role', 'menuitem');
            const text = document.createDocumentFragment();
            // the mnemonic is underlined while Alt is held (vista-games.css)
            const i = top.text.indexOf('&');
            if (i >= 0) {
                text.appendChild(document.createTextNode(label.label.slice(0, i)));
                text.appendChild(el('u', '', label.label.charAt(i)));
                text.appendChild(document.createTextNode(label.label.slice(i + 1)));
            } else text.appendChild(document.createTextNode(label.label));
            button.appendChild(text);
            button.dataset.mnemonic = label.mnemonic;
            win.menubar.appendChild(button);
            win.menuButtons.push(button);
            // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
            if (typeof contextMenu !== 'undefined' && contextMenu) {
                contextMenu.attachClickMenuToElement(button, {
                    onAction: (action) => {
                        if (typeof action === 'number' || /^\d+$/.test(String(action))) win.command(Number(action));
                        else win.command(action);
                    },
                    sections: [{
                        type: 'list',
                        initfn: (section) => { section.items = VG.menuItems(win, top.items || []); }
                    }]
                });
            }
        });
    };

    VG.menuItems = function (win, items) {
        const out = [];
        items.forEach((item) => {
            if (item.separator) {
                out.push({ separator: true });
                return;
            }
            const label = VG.menuLabel(item.text);
            const state = win.spec.menuState ? (win.spec.menuState(item.id, item) || {}) : {};
            if (state.hidden) return;
            const row = { text: state.text || label.label, badge: label.accel || null, disabled: !!state.disabled };
            if (item.items) row.submenu = VG.menuItems(win, item.items);
            else row.action = String(item.id);
            if (state.checked !== undefined) {
                row.checked = !!state.checked;
                row.showIndicator = true;
                row.indicatorMark = state.radio ? 'radio' : 'check';
            }
            out.push(row);
        });
        return out;
    };

    VG.wireAccelerators = function (win) {
        const spec = win.spec;
        const table = spec.pack && spec.accelerators !== undefined ? spec.pack.mui.accelerators[spec.accelerators] || [] : [];
        win.accel = table.map((a) => ({ key: VK_NAMES[a.key] || String.fromCharCode(a.key), id: a.id, ctrl: !!(a.flags & 0x08), shift: !!(a.flags & 0x04), alt: !!(a.flags & 0x10) }));
        win.onKeyDown = (e) => {
            if (!win.isOpen() || win.modal.classList.contains('minimised')) return;
            if (!win.modal.classList.contains('active-window')) return;
            if (win.dialogs.length) return;
            const t = e.target;
            if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]') && !win.modal.contains(t)) return;
            if (e.key === 'Alt') {
                win.modal.classList.add('vista-game-alt');
                return;
            }
            const hit = win.accel.find((a) => a.key.toLowerCase() === e.key.toLowerCase() && a.ctrl === e.ctrlKey && a.shift === e.shiftKey && a.alt === e.altKey);
            if (hit) {
                e.preventDefault();
                e.stopPropagation();
                win.command(hit.id);
                return;
            }
            if (e.altKey && e.key.length === 1) {
                const b = win.menuButtons.find((m) => m.dataset.mnemonic === e.key.toUpperCase());
                if (b) {
                    e.preventDefault();
                    b.click();
                    return;
                }
            }
            if (spec.onKeyDown) spec.onKeyDown(e);
        };
        win.onKeyUp = (e) => {
            if (e.key === 'Alt') win.modal.classList.remove('vista-game-alt');
            if (spec.onKeyUp && win.isActive()) spec.onKeyUp(e);
        };
        document.addEventListener('keydown', win.onKeyDown, true);
        document.addEventListener('keyup', win.onKeyUp, true);
    };

    // window chrome around the surface (caption, borders, menu bar), measured
    // offset sizes: the open / minimize animations scale the window, the layout box stays put
    VG.chrome = function (win) {
        return { x: win.modal.offsetWidth - win.surface.clientWidth, y: win.modal.offsetHeight - win.surface.clientHeight };
    };

    // the smallest client: the native size, or less where the game's ENGINE.XML allows a smaller
    // window (spec.minWindowW / minWindowH in window px: CardGames.dll's 640 x 480)
    VG.minClient = function (win, c) {
        const s = win.spec;
        return {
            w: s.minWindowW ? Math.min(s.nativeW, Math.max(1, s.minWindowW - c.x)) : s.nativeW,
            h: s.minWindowH ? Math.min(s.nativeH, Math.max(1, s.minWindowH - c.y)) : s.nativeH
        };
    };

    VG.fitWindow = function (win, scale) {
        const modal = win.modal;
        if (modal.classList.contains('hidden')) {
            win.pendingFit = scale || 1;
            return;
        }
        // isModalMaximized: public/scripts/comp/modalUtils.js
        if (typeof isModalMaximized === 'function' && isModalMaximized(modal)) return;
        const c = VG.chrome(win);
        const w = Math.round(win.spec.nativeW * (scale || 1)) + c.x;
        const h = Math.round(win.spec.nativeH * (scale || 1)) + c.y;
        const min = VG.minClient(win, c);
        modal.dataset.windowMinWidth = String(min.w + c.x);
        modal.dataset.windowMinHeight = String(min.h + c.y);
        const oldW = modal.offsetWidth;
        const oldH = modal.offsetHeight;
        modal.style.width = w + 'px';
        modal.style.height = h + 'px';
        // The top left corner stays put, as Windows sizes a window. The desktop centres a window
        // on its --modal-offset-x / -y while it opens and then pins the top left it restored at the
        // saved size (modalUtils.js settleModalPixelAnchor), so without this the window grew around
        // its centre during the open animation and jumped by half the size change at its end.
        if (oldW && oldH && (oldW !== w || oldH !== h) && modal.dataset.windowContentAnchor !== 'top') {
            const ox = parseFloat(modal.style.getPropertyValue('--modal-offset-x')) || 0;
            const oy = parseFloat(modal.style.getPropertyValue('--modal-offset-y')) || 0;
            modal.style.setProperty('--modal-offset-x', (ox + (w - oldW) / 2) + 'px');
            modal.style.setProperty('--modal-offset-y', (oy + (h - oldH) / 2) + 'px');
        }
        if (win.stage) win.stage.fit();
    };

    // max: the room the work area leaves ({ width, height }, window px); the box shrinks to fit it
    VG.constrainResize = function (win, w, h, dir, max) {
        if (win.spec.lockAspect === false) return { width: w, height: h };
        const c = VG.chrome(win);
        const ratio = win.spec.nativeW / win.spec.nativeH;
        const min = VG.minClient(win, c);
        let cw = Math.max(min.w, w - c.x);
        let ch = Math.max(min.h, h - c.y);
        if (max) {
            const mw = Math.max(min.w, max.width - c.x);
            const mh = Math.max(min.h, max.height - c.y);
            cw = Math.min(cw, mw, mh * ratio);
            ch = Math.min(ch, mh, mw / ratio);
        }
        let outW;
        let outH;
        if (dir === 'n' || dir === 's') {
            outH = ch;
            outW = ch * ratio;
        } else if (dir === 'e' || dir === 'w') {
            outW = cw;
            outH = cw / ratio;
        } else if (cw / ch > ratio) {
            outW = cw;
            outH = cw / ratio;
        } else {
            outH = ch;
            outW = ch * ratio;
        }
        return { width: Math.round(outW + c.x), height: Math.round(outH + c.y) };
    };

    VG.showWindow = function (win) {
        const modal = win.modal;
        // restoreMinimizedModal / openModal / bringModalToFront: public/scripts/comp/modalUtils.js
        if (modal.classList.contains('minimised') && typeof restoreMinimizedModal === 'function') restoreMinimizedModal(modal);
        const wasHidden = modal.classList.contains('hidden') || modal.classList.contains('hidden-alt');
        if (wasHidden) {
            if (!modal.style.width && !modal.dataset.windowDefaultWidth) {
                modal.style.width = (win.spec.nativeW + 16) + 'px';
                modal.style.height = (win.spec.nativeH + 80) + 'px';
            }
            if (!win.everFitted) win.pendingFit = win.pendingFit || 1;
            win.everFitted = true;
            // settled once the desktop has revealed the window (VG.settleWindow, from the class observer)
            win.wantSettle = true;
            openModal(modal);
            if (!modal.classList.contains('hidden')) VG.settleWindow(win);
        }
        bringModalToFront(modal);
        try { win.surface.focus({ preventScroll: true }); } catch (_) { /* old browsers */ }
    };

    // The desktop restores the saved window rect while the window opens; once it has, the window
    // snaps to the game's aspect at about that size (a new board size: native).
    VG.settleWindow = function (win) {
        win.wantSettle = false;
        const settle = () => {
            const pending = win.pendingFit;
            win.pendingFit = 0;
            if (pending) {
                VG.fitWindow(win, pending);
                return;
            }
            const cw = win.surface.clientWidth;
            const ch = win.surface.clientHeight;
            const scale = Math.max(1, Math.min(cw / win.spec.nativeW, ch / win.spec.nativeH));
            VG.fitWindow(win, Number.isFinite(scale) ? scale : 1);
        };
        settle();
        requestAnimationFrame(() => requestAnimationFrame(settle));
        win.modal.addEventListener('animationend', settle, { once: true });
    };

    VG.closeWindow = function (win) {
        win.dialogs.slice().forEach((d) => d.close());
        if (win.spec.onClosed) win.spec.onClosed();
        closeModal(win.modal);
    };

    // ---- dialogs from MUI templates ----------------------------------------------------------
    const BS_TYPE = 0x0f;
    const WS_VISIBLE = 0x10000000;
    const WS_DISABLED = 0x08000000;
    const SS_TYPE = 0x1f;

    // template: MUI dialog object or id; opts: { title, owner (game window), texts: { id: text },
    //   init(dlg), onCommand(id, dlg) -> true closes, onClose(result) }
    VG.dialog = function (pack, template, opts) {
        opts = opts || {};
        const tpl = typeof template === 'object' ? template : pack.mui.dialogs[template];
        if (!tpl) throw new Error('no dialog ' + template);
        const owner = opts.owner || null;
        const modal = el('div', 'modal transient vista-game-dialog hidden');
        modal.id = 'vistaGameDialog-' + Math.random().toString(36).slice(2, 8);
        modal.dataset.windowClient = 'light';
        modal.dataset.windowPositionMode = 'manual-only';
        // vista-dialogs.css: the Vista dialog look (light client, buttons) for data-vista-dialog
        modal.dataset.vistaDialog = 'form';
        // an owned window: no taskbar button (shouldShowInTaskbar, modalUtils.js)
        modal.dataset.windowOwned = 'true';
        const title = el('div', 'modal-window-title');
        const titleMain = el('div', 'modal-window-title-main');
        titleMain.appendChild(el('span', '', opts.title !== undefined ? opts.title : (tpl.title || (owner ? owner.spec.title : ''))));
        title.appendChild(titleMain);
        const controls = el('div', 'modal-window-controls');
        const closeBtn = iconButton('btn-danger close-btn btn-small', 'Close', 'fa-regular fa-xmark-large');
        controls.appendChild(closeBtn);
        const content = el('div', 'modal-content win7 vista-game-dialog-client');
        const w = Math.round(tpl.cx * DLU_X);
        const h = Math.round(tpl.cy * DLU_Y);
        content.style.width = w + 'px';
        content.style.height = h + 'px';
        modal.appendChild(title);
        modal.appendChild(el('div', 'modal-focus-overlay'));
        modal.appendChild(controls);
        modal.appendChild(content);

        const dlg = { modal, content, controls: {}, owner, result: null, tpl };
        let radioGroup = 0;
        const groups = [];
        tpl.controls.forEach((c) => {
            if (!(c.style & WS_VISIBLE)) return;
            const box = {
                left: Math.round(c.x * DLU_X) + 'px',
                top: Math.round(c.y * DLU_Y) + 'px',
                width: Math.round(c.cx * DLU_X) + 'px',
                height: Math.round(c.cy * DLU_Y) + 'px'
            };
            const text = opts.texts && opts.texts[c.id] !== undefined ? opts.texts[c.id] : (c.text || '');
            let node = null;
            const cls = String(c.className);
            if (cls === 'Button') {
                const bs = c.style & BS_TYPE;
                if (bs === 7) { // group box
                    node = el('fieldset', 'vista-game-group');
                    const legend = el('legend');
                    VG.mnemonicText(legend, text);
                    node.appendChild(legend);
                } else if (bs === 2 || bs === 3 || bs === 4 || bs === 9 || bs === 5 || bs === 6) {
                    // check box (2/3/5/6) or radio (4/9)
                    const radio = bs === 4 || bs === 9;
                    if (c.style & 0x00020000) radioGroup += 1; // WS_GROUP starts a radio group
                    node = el('div', 'vista-game-choice' + ((c.style & 0x2000) ? ' multiline' : ''));
                    const input = el('input');
                    input.type = radio ? 'radio' : 'checkbox';
                    input.id = modal.id + '-' + c.id;
                    if (radio) input.name = modal.id + '-g' + radioGroup;
                    const label = el('label');
                    label.htmlFor = input.id;
                    // one child in the label: 7.css lays its label out as a flex row
                    const span = el('span');
                    VG.mnemonicText(span, text);
                    label.appendChild(span);
                    if (span.dataset.mnemonic) label.dataset.mnemonic = span.dataset.mnemonic;
                    node.appendChild(input);
                    node.appendChild(label);
                    node.input = input;
                    input.addEventListener('change', () => opts.onCommand && opts.onCommand(c.id, dlg, 'change'));
                } else {
                    node = el('button', 'vista-game-button');
                    node.type = 'button';
                    VG.mnemonicText(node, text);
                    if (bs === 1) {
                        node.classList.add('default');
                        node.dataset.dialogPrimary = '1';
                    }
                    node.addEventListener('click', () => dlg.command(c.id));
                }
            } else if (cls === 'Static') {
                const ss = c.style & SS_TYPE;
                node = el('div', 'vista-game-static');
                if (ss === 1) node.style.textAlign = 'center';
                else if (ss === 2) node.style.textAlign = 'right';
                if (ss === 0x10) node.classList.add('etched-horz');
                VG.mnemonicText(node, text);
            } else if (cls === 'Edit') {
                node = el('input', 'vista-game-edit');
                node.type = 'text';
                if (c.style & 0x2000) node.inputMode = 'numeric';
                node.value = text;
            } else if (cls === 'ListBox') {
                // a Win32 list box (a <select> would become 7.css's drop-down)
                // (no listbox / option roles: 7.css styles those as Windows 7 list views)
                node = el('div', 'vista-game-listbox');
                node.tabIndex = 0;
                node.addEventListener('click', (e) => {
                    const item = e.target.closest('.vista-game-listbox-item');
                    if (!item || item.classList.contains('selected')) return;
                    dlg.listValue(c.id, item.dataset.value);
                    if (opts.onCommand) opts.onCommand(c.id, dlg, 'change');
                });
                node.addEventListener('keydown', (e) => {
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                    e.preventDefault();
                    const items = Array.from(node.children);
                    const i = items.findIndex((n) => n.classList.contains('selected'));
                    const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
                    if (next && next !== items[i]) {
                        dlg.listValue(c.id, next.dataset.value);
                        if (opts.onCommand) opts.onCommand(c.id, dlg, 'change');
                    }
                });
            } else if (cls === 'SysListView32') {
                node = el('div', 'vista-game-listview');
            } else {
                node = el('div', 'vista-game-static');
            }
            node.classList.add('vista-game-ctl');
            Object.assign(node.style, box);
            if (c.style & WS_DISABLED) VG.setEnabled(node, false);
            node.dataset.ctlId = String(c.id);
            content.appendChild(node);
            if (c.id !== -1 && c.id !== 65535) dlg.controls[c.id] = node;
            if (node.tagName === 'FIELDSET') groups.push(node);
        });
        // group boxes behind everything else
        groups.forEach((g) => content.insertBefore(g, content.firstChild));

        dlg.get = (id) => dlg.controls[id] || null;
        dlg.text = (id, value) => {
            const n = dlg.controls[id];
            if (!n) return '';
            if (value === undefined) return n.tagName === 'INPUT' ? n.value : n.textContent;
            if (n.tagName === 'INPUT') n.value = value;
            else n.textContent = value;
            return value;
        };
        dlg.checked = (id, value) => {
            const n = dlg.controls[id];
            if (!n || !n.input) return false;
            if (value !== undefined) n.input.checked = !!value;
            return n.input.checked;
        };
        dlg.enable = (id, on) => VG.setEnabled(dlg.controls[id], on);
        // list boxes: setList(id, [{ value, text }], selected), listValue(id [, value])
        dlg.setList = (id, items, selected) => {
            const n = dlg.controls[id];
            if (!n) return;
            n.textContent = '';
            items.forEach((item) => {
                const row = el('div', 'vista-game-listbox-item', item.text);
                row.dataset.value = String(item.value);
                n.appendChild(row);
            });
            dlg.listValue(id, selected);
        };
        dlg.listValue = (id, value) => {
            const n = dlg.controls[id];
            if (!n) return null;
            if (value !== undefined) {
                Array.from(n.children).forEach((row) => row.classList.toggle('selected', row.dataset.value === String(value)));
            }
            const sel = n.querySelector('.vista-game-listbox-item.selected');
            return sel ? sel.dataset.value : null;
        };
        dlg.show = (id, on) => {
            const n = dlg.controls[id];
            if (n) n.style.visibility = on ? '' : 'hidden';
        };
        dlg.command = (id) => {
            if (opts.onCommand && opts.onCommand(id, dlg, 'click') === false) return;
            if (id === 1 || id === 2 || opts.closeOn === 'any' || (Array.isArray(opts.closeOn) && opts.closeOn.includes(id))) dlg.close(id);
        };
        dlg.close = (result) => {
            if (dlg.closed) return;
            dlg.closed = true;
            dlg.result = result === undefined ? 2 : result;
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('keyup', onKeyUp, true);
            if (owner) {
                owner.dialogs = owner.dialogs.filter((d) => d !== dlg);
                owner.modal.classList.toggle('vista-game-blocked', owner.dialogs.length > 0);
            }
            // closeModal: public/scripts/comp/modalUtils.js
            closeModal(modal);
            setTimeout(() => modal.remove(), 400);
            if (opts.onClose) opts.onClose(dlg.result, dlg);
            if (owner && owner.isOpen()) bringModalToFront(owner.modal);
            dlg.resolve(dlg.result);
        };
        closeBtn.addEventListener('click', () => dlg.command(2));
        const onKey = (e) => {
            if (dlg.closed || !modal.classList.contains('active-window')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                dlg.command(2);
            } else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'BUTTON')) {
                const def = content.querySelector('.vista-game-button.default:not(:disabled)');
                if (def) {
                    e.preventDefault();
                    e.stopPropagation();
                    def.click();
                }
            } else if (e.altKey && e.key.length === 1) {
                const hit = Array.from(content.querySelectorAll('[data-mnemonic]')).find((n) => n.dataset.mnemonic === e.key.toUpperCase());
                if (hit) {
                    e.preventDefault();
                    const target = hit.closest('.vista-game-choice') ? hit.closest('.vista-game-choice').input : hit;
                    if (target.tagName === 'INPUT' && target.type !== 'text') target.click();
                    else target.focus();
                }
            }
            if (e.key === 'Alt') modal.classList.add('vista-game-alt');
        };
        document.addEventListener('keydown', onKey, true);
        const onKeyUp = (e) => { if (e.key === 'Alt') modal.classList.remove('vista-game-alt'); };
        document.addEventListener('keyup', onKeyUp, true);

        dlg.promise = new Promise((resolve) => { dlg.resolve = resolve; });
        if (opts.init) opts.init(dlg);
        document.body.appendChild(modal);
        if (owner) {
            owner.dialogs.push(dlg);
            owner.modal.classList.add('vista-game-blocked');
        }
        openModal(modal);
        VG.centerOver(modal, owner ? owner.modal : null, opts.task ? 'task' : 'dialog');
        bringModalToFront(modal);
        const first = (opts.focus !== undefined && dlg.controls[opts.focus]) || content.querySelector('.vista-game-button.default') || content.querySelector('input, button, .vista-game-listbox');
        if (first) try { first.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
        return dlg;
    };

    VG.setEnabled = function (node, on) {
        if (!node) return;
        node.classList.toggle('disabled', !on);
        const inputs = node.matches('input, button, select') ? [node] : Array.from(node.querySelectorAll('input, button, select'));
        inputs.forEach((i) => { i.disabled = !on; });
    };

    // "&Beginner\n10 mines" -> text with the mnemonic letter underlined (shown while Alt is down)
    VG.mnemonicText = function (node, text) {
        node.textContent = '';
        const s = String(text || '');
        const i = s.search(/&[^&]/);
        const clean = (t) => t.replace(/&&/g, '&');
        if (i < 0) {
            node.textContent = clean(s);
            return;
        }
        node.appendChild(document.createTextNode(clean(s.slice(0, i))));
        node.appendChild(el('u', '', s.charAt(i + 1)));
        node.appendChild(document.createTextNode(clean(s.slice(i + 2))));
        node.dataset.mnemonic = s.charAt(i + 1).toUpperCase();
    };

    // Where Vista puts an owned dialog (measured on the VM with Minesweeper): a dialog box is
    // centred over the owner window but never above or left of the owner's top-left corner; a task
    // dialog is centred 8 px left and 28 px up of the owner's centre.
    VG.centerOver = function (modal, ownerModal, kind) {
        const r = { width: modal.offsetWidth, height: modal.offsetHeight };
        let left = (window.innerWidth - r.width) / 2;
        let top = (window.innerHeight - r.height) / 2;
        if (ownerModal) {
            const o = ownerModal.getBoundingClientRect();
            left = o.left + (o.width - r.width) / 2;
            top = o.top + (o.height - r.height) / 2;
            if (kind === 'task') {
                left -= 8;
                top -= 28;
            } else {
                left = Math.max(o.left, left);
                top = Math.max(o.top, top);
            }
        }
        left = Math.max(0, Math.min(window.innerWidth - r.width, left));
        top = Math.max(0, Math.min(window.innerHeight - r.height, top));
        // setModalOffsetsFromViewportTopLeft: public/scripts/comp/modalUtils.js (the desktop's own
        // top-left placement, with its top inset)
        if (typeof setModalOffsetsFromViewportTopLeft === 'function') {
            setModalOffsetsFromViewportTopLeft(modal, Math.round(left), Math.round(top), {});
        } else {
            modal.style.left = left + 'px';
            modal.style.top = top + 'px';
        }
    };

    // A Vista task dialog: { title, instruction, content, links: [{ id, text, note }],
    //   buttons: [{ id, text, default }], check: { text, checked }, footer, owner, width }
    // -> Promise<id> (2 = closed), or Promise<{ id, checked }> when there is a check box
    VG.taskDialog = function (opts) {
        const tpl = { cx: 0, cy: 0, controls: [], title: opts.title };
        const fake = { mui: { dialogs: {} } };
        let dlg;
        let check = null;
        const promise = new Promise((resolve) => {
            dlg = VG.dialog(fake, tpl, {
                owner: opts.owner,
                title: opts.title,
                task: true,
                onClose: (result) => resolve(check ? { id: result, checked: check.checked } : result)
            });
        });
        dlg.modal.classList.add('vista-game-taskdialog');
        const c = dlg.content;
        c.style.width = (opts.width || 361) + 'px';
        c.style.height = '';
        const main = el('div', 'vista-task-main');
        main.appendChild(el('div', 'vista-task-instruction', opts.instruction || ''));
        if (opts.content) main.appendChild(el('div', 'vista-task-content', opts.content));
        (opts.links || []).forEach((link) => {
            const b = el('button', 'vista-task-link');
            b.type = 'button';
            b.appendChild(el('span', 'vista-task-link-arrow'));
            const body = el('span', 'vista-task-link-body');
            const text = el('span', 'vista-task-link-text');
            VG.mnemonicText(text, link.raw || link.text);
            body.appendChild(text);
            if (link.note) body.appendChild(el('span', 'vista-task-link-note', link.note));
            b.appendChild(body);
            if (text.dataset.mnemonic) b.dataset.mnemonic = text.dataset.mnemonic;
            b.addEventListener('click', () => dlg.close(link.id));
            b.addEventListener('blur', () => b.classList.remove('default'));
            if (!main.querySelector('.vista-task-link')) b.classList.add('default');
            main.appendChild(b);
        });
        if (!opts.buttons && main.lastChild && main.lastChild.classList.contains('vista-task-link')) main.lastChild.style.marginBottom = '0';
        c.appendChild(main);
        if (opts.buttons || opts.check) {
            const row = el('div', 'vista-task-buttons');
            if (opts.check) {
                const wrap = el('div', 'vista-task-check');
                check = el('input');
                check.type = 'checkbox';
                check.id = dlg.modal.id + '-check';
                check.checked = !!opts.check.checked;
                const label = el('label');
                label.htmlFor = check.id;
                const span = el('span');
                VG.mnemonicText(span, opts.check.text);
                label.appendChild(span);
                wrap.appendChild(check);
                wrap.appendChild(label);
                row.appendChild(wrap);
            }
            (opts.buttons || []).forEach((bt) => {
                const b = el('button', 'vista-game-button');
                b.type = 'button';
                VG.mnemonicText(b, bt.text);
                if (bt.default) {
                    b.classList.add('default');
                    b.dataset.dialogPrimary = '1';
                }
                b.addEventListener('click', () => dlg.close(bt.id));
                row.appendChild(b);
            });
            c.appendChild(row);
            // comctl32 widens a task dialog until its button row fits on one line (Minesweeper's
            // Exit Game: 440 px for the check box and three buttons)
            const need = row.scrollWidth + (opts.check ? 19 : 0);
            if (need > c.clientWidth) c.style.width = need + 'px';
        }
        if (opts.footer) c.appendChild(el('div', 'vista-task-footer', opts.footer));
        VG.centerOver(dlg.modal, opts.owner ? opts.owner.modal : null, 'task');
        const focus = c.querySelector('.vista-game-button.default') || c.querySelector('.vista-task-link');
        if (focus) try { focus.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
        return promise;
    };

    // "&Beginner\n10 mines, 9 x 9 tile grid" -> a command link
    VG.linkFromString = function (s, id) {
        const [text, note] = String(s || '').split('\n');
        return { id, raw: text || '', text: String(text || '').replace(/&(.)/g, '$1'), note: note || '' };
    };

    // SysListView32 in icon view: items [{ text, img }], selected index, onSelect(i)
    VG.fillThumbList = function (node, items, selected, onSelect) {
        if (!node) return;
        node.textContent = '';
        items.forEach((item, i) => {
            const cell = el('div', 'vista-game-listview-item' + (i === selected ? ' selected' : ''));
            if (item.img) {
                const img = el('img');
                img.alt = '';
                img.src = item.img;
                // the thumbnails' 2x copies (scripts/build-vista-games-hidpi.sh)
                if (VG.maxSheetScale !== 1 && /thumb[^/]*\.png$/i.test(item.img)) img.srcset = item.img + ' 1x, ' + item.img.replace(/\.png$/i, '@2x.png') + ' 2x';
                cell.appendChild(img);
            }
            cell.appendChild(el('span', '', item.text));
            cell.addEventListener('click', () => {
                node.querySelectorAll('.vista-game-listview-item').forEach((n) => n.classList.remove('selected'));
                cell.classList.add('selected');
                onSelect(i);
            });
            node.appendChild(cell);
        });
    };

    // Help > About <game>: Vista's ShellAbout box (Minesweeper's on the VM, without the Windows
    // banner and licence lines). opts.copyright replaces Microsoft's line for our own games.
    VG.aboutBox = function (opts) {
        const tpl = { cx: 0, cy: 0, controls: [], title: 'About ' + opts.title };
        const dlg = VG.dialog({ mui: { dialogs: {} } }, tpl, { owner: opts.owner, title: 'About ' + opts.title });
        const c = dlg.content;
        c.style.width = '413px';
        c.style.height = '';
        const box = el('div', 'vista-game-about');
        const row = el('div', 'vista-game-about-row');
        if (opts.icon) {
            const img = el('img');
            img.alt = '';
            img.src = opts.icon;
            // icons/<id>-48.png: the app icon set has the same icon at 96 px
            const id = /\/icons\/([a-z]+)-48\.png$/.exec(opts.icon);
            if (id && VG.maxSheetScale !== 1) img.srcset = opts.icon + ' 1x, /static_images/app_icons/96/vista-' + id[1] + '.webp 2x';
            row.appendChild(img);
        }
        const text = el('div');
        text.appendChild(el('div', '', opts.title));
        text.appendChild(el('div', '', 'Version 6.0 (Build 6002: Service Pack 2)'));
        text.appendChild(el('div', '', opts.copyright || 'Copyright \u00a9 2007 Xyridian Corporation.\u00a0 All rights reserved.'));
        if (opts.text) {
            const note = el('div', '', opts.text);
            note.className = 'vista-game-about-note';
            text.appendChild(note);
        }
        row.appendChild(text);
        box.appendChild(row);
        const actions = el('div', 'vista-game-about-actions');
        const ok = el('button', 'vista-game-button default', 'OK');
        ok.type = 'button';
        ok.dataset.dialogPrimary = '1';
        ok.style.width = '75px';
        ok.style.height = '23px';
        ok.addEventListener('click', () => dlg.close(1));
        actions.appendChild(ok);
        box.appendChild(actions);
        c.appendChild(box);
        VG.centerOver(dlg.modal, opts.owner ? opts.owner.modal : null);
        return dlg.promise;
    };

    // ---- small helpers ---------------------------------------------------------------------
    VG.formatDate = function (ms) {
        if (!ms) return '--/--/--';
        const d = new Date(ms);
        return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
    };

    // the account name for "Minesweeper Statistics - <name>": the signed-in account's name
    // (User Accounts' Change the account name; meletonAccounts.js)
    VG.userName = () => (root.meletonAccountName ? root.meletonAccountName() : 'Administrator');

    VG.now = () => (root.performance && performance.now ? performance.now() : Date.now());
})(typeof window !== 'undefined' ? window : globalThis);
