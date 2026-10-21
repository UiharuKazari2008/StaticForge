// Purble Place, as Windows Vista's (Yozora #609). Art, layouts, animations, sounds, menus,
// dialogs and strings are PurblePlace.dll's / PurblePlace2.dll's and PurblePlace.exe.mui's
// (scripts/build-vista-games.js); the engine is vistaGameEngine.js. This file is the town (the
// PurblePlaceManager screen), the window, the shared dialogs (Select Difficulty, Options,
// Statistics, Saved Game Found, Return to Main Menu, Exit) and the pieces the three games share:
//
//   VistaPurble.Movie      the engine's Flash-exported "movies" (<Animations><Images> image
//                          definitions, <Library frameCount fps> of <ImageInstance> keyframes:
//                          x / y (the image's registration point), xscale / yscale and alpha in
//                          percent, rotation in degrees about x / y; a keyframe holds until the next)
//   VistaPurble.Nodes      NodeSprite / NodeButton / NodeLabel layouts (PurblePlaceManager,
//                          BuildAPurbleGame)
//   VistaPurble.text       "|id|Category|default//comment" layout strings -> the MUI string table
//
// The games: purblePairs.js (the school, Purble Pairs = CONCENTRATIONGAME), purbleCakes.js (the
// bakery, Comfy Cakes) and purbleShop.js (the store, Purble Shop = BUILDAPURBLE); purbleRules.js
// holds their pure rules (scripts/test-vista-purble.js).
//
// Measured on the VM: the client is the 800x496 scene over a 23 px Win32 status bar of three panes
// (empty in the town; Score / Tiles Turned in Purble Pairs, Cakes Finished in Comfy Cakes, Score /
// Guesses in Purble Shop). The town's buildings light up under the pointer (their Button sprite's
// hot frame: the building drawn glowing over the foreground) and show the pressed frame while held.
// Clicking a building the first time asks the difficulty in a task dialog (Select Difficulty, with
// the Options note as the footer); F3 / the green "town" button returns to the town, asking first
// when the game has moves ("Your game will be saved for next time"). The clouds drift across the
// sky (UI\PurblePlace\CloudsMovie.xml, 10 fps, 1016 frames). The VM's 3D driver draws no D3D text,
// so the tip balloons there are empty; their text here is the tip XML's.
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    // the Win32 status bar: VG.Cards.statusBar (cardEngine.js, the feature this one depends on)
    const C = VG.Cards;
    const PP = root.VistaPurble = root.VistaPurble || {};
    const GAME_ID = 'purble';
    const MODAL_ID = 'vistaPurbleModal';
    const W = 800;
    const H = 496;
    // CloudsMovie.xml's origin on the town (its y 303-482 is the sky at 3-182)
    const CLOUDS_X = -300;
    const CLOUDS_Y = -300;

    // MUI command ids (menus 172-175, accelerators 155)
    const CMD = {
        NEW: 40173, MAIN_MENU: 40167, HINT: 40004, STATS: 40009, OPTIONS: 40008, EXIT: 40010, HELP: 40005, ABOUT: 40006,
        NEW_CAKES: 40002, NEW_SHOP: 40011, NEW_PAIRS: 40155
    };
    // the menu each screen shows: the town's lists the three games (174), Purble Shop's has Hint
    // (104); Comfy Cakes and Purble Pairs share 172
    const MENUS = { town: 174, pairs: 172, cakes: 172, shop: 104 };
    PP.CMD = CMD;
    // The 2x sprite sheets: PurblePlace.dll's 2x pages were packed on their own, so some frames
    // are 1-2 px from twice their 1x offset and a few lie past the page (concentrationSheet12 is
    // 2037 x 2035, comfycakesSheet4 1823 x 1631); the engine reads a 2x frame at 2 x the 1x offset.
    // scripts/build-vista-purble-2x.js re-lays every frame at exactly 2x into sheets2x/ (frames it
    // cannot find there, comfycakesSheet4's box, are the 1x art scaled up); this pack loads those.
    function useRelaidSheets(pack) {
        const own = Object.getPrototypeOf(pack).sheet;
        pack.sheet = function (texture, scale) {
            const key = VG.key(texture).replace(/\.(SHT|JPG|PNG|BMP|DDS)$/, '') + '.SHT';
            const info = this.data.sheets[key];
            if (scale !== 2 || !info || info.length < 4 || !/^SHEETS_/.test(key)) return own.call(this, texture, scale);
            const id = key + '@2';
            if (!this.sheets.has(id)) {
                const file = key.replace(/^SHEETS_/, '').replace(/\.SHT$/, '').toLowerCase();
                this.sheets.set(id, new Promise((resolve) => {
                    const img = new Image();
                    img.decoding = 'async';
                    img.onload = () => resolve(img);
                    img.onerror = () => resolve(null);
                    img.src = this.base + 'sheets2x/' + file + '@2x.webp';
                }));
            }
            return this.sheets.get(id);
        };
    }
    PP.W = W;
    PP.H = H;

    const store = VG.store(GAME_ID);
    PP.store = store;
    const DIFFS = ['beginner', 'intermediate', 'advanced'];
    PP.DIFFS = DIFFS;
    const DEFAULTS = {
        sounds: true,
        tips: true,
        continueSaved: false,
        pairs: { difficulty: 0, timerOff: false, asked: false },
        cakes: { difficulty: 0, oneCake: false, asked: false },
        shop: { difficulty: 0, asked: false },
        townTipShown: false
    };

    // "%1!d!" / "%1" / "%%" from the MUI string tables
    PP.fmt = (t, ...a) => String(t).replace(/%(\d)(?:!\w!)?/g, (_, n) => String(a[Number(n) - 1])).replace(/%%/g, '%').trim();

    // "|47331|BAP_UI|LOADING... //The caption" -> the MUI string 47331 (or the default after it)
    PP.text = function (pack, value) {
        const s = String(value === undefined || value === null ? '' : value);
        const m = /^\s*\|(\d+)\|[^|]*\|([\s\S]*)$/.exec(s);
        if (!m) return s.replace(/\/\/[\s\S]*$/, '').trim();
        const fallback = m[2].replace(/\/\/[\s\S]*$/, '');
        return String(pack.string(Number(m[1]), fallback)).trim();
    };
    PP.num = (pack, value, fallback) => {
        const v = parseFloat(PP.text(pack, value));
        return Number.isFinite(v) ? v : fallback;
    };

    // a "Dialog-free" task dialog link from "&Yes\nReturn to main menu..." strings
    PP.link = (pack, id, result) => VG.linkFromString(pack.string(id), result);

    // ---- movies ------------------------------------------------------------------------------
    // One instance: keyframes resolved into a state per frame (null before its first keyframe).
    class Movie {
        constructor(pack, node, options) {
            this.pack = pack;
            this.options = options || {};
            const anims = VG.child(node, 'Animations') || node;
            const images = {};
            VG.children(VG.child(anims, 'Images'), 'ImageDef').forEach((d) => {
                images[d.a.name] = d.a.xml ? pack.sprite(d.a.xml) : null;
            });
            const lib = VG.child(anims, 'Library') || anims;
            const la = lib.a || {};
            this.frameCount = Math.max(1, parseInt(la.frameCount || '1', 10) || 1);
            let fps = parseFloat(la.fps || la.FPS || '');
            this.instances = VG.children(lib, 'ImageInstance').map((inst) => {
                if (!Number.isFinite(fps) && inst.a && inst.a.fps) fps = parseFloat(inst.a.fps);
                const name = inst.a && inst.a.name;
                const sprite = this.options.images && this.options.images[name] !== undefined ? this.options.images[name] : (images[name] || null);
                const keys = VG.children(inst, 'Frame').map((f) => f.a || {}).sort((a, b) => (+a.num) - (+b.num));
                const states = new Array(this.frameCount).fill(null);
                let cur = null;
                let k = 0;
                for (let f = 0; f < this.frameCount; f++) {
                    while (k < keys.length && +keys[k].num <= f) {
                        const a = keys[k];
                        cur = Object.assign({}, cur || { x: 0, y: 0, xs: 1, ys: 1, rot: 0, alpha: 1 });
                        if (a.x !== undefined) cur.x = parseFloat(a.x);
                        if (a.y !== undefined) cur.y = parseFloat(a.y);
                        if (a.xscale !== undefined) cur.xs = parseFloat(a.xscale) / 100;
                        if (a.yscale !== undefined) cur.ys = parseFloat(a.yscale) / 100;
                        if (a.rotation !== undefined) cur.rot = parseFloat(a.rotation) * Math.PI / 180;
                        if (a.alpha !== undefined) cur.alpha = parseFloat(a.alpha) / 100;
                        k += 1;
                    }
                    states[f] = cur;
                }
                return { name, sprite, states };
            });
            this.fps = Number.isFinite(fps) && fps > 0 ? fps : 12;
            this.duration = this.frameCount / this.fps * 1000;
        }

        sprites() {
            return this.instances.map((i) => i.sprite).filter(Boolean);
        }

        // the frame `ms` after the start (looping or held on the last one)
        frameAt(ms, loop) {
            const f = Math.floor(Math.max(0, ms) * this.fps / 1000);
            return loop ? f % this.frameCount : Math.min(this.frameCount - 1, f);
        }

        // draw frame f at ox / oy; opts: alpha, hide(name) -> bool, sprite(name) -> def
        draw(stage, f, ox, oy, opts) {
            opts = opts || {};
            const ctx = stage.ctx;
            const a0 = opts.alpha === undefined ? 1 : opts.alpha;
            const frame = Math.max(0, Math.min(this.frameCount - 1, f | 0));
            this.instances.forEach((inst) => {
                const s = inst.states[frame];
                if (!s || s.alpha <= 0) return;
                if (opts.hide && opts.hide(inst.name)) return;
                const def = (opts.sprite && opts.sprite(inst.name)) || inst.sprite;
                if (!def) return;
                const x = (ox || 0) + s.x;
                const y = (oy || 0) + s.y;
                if (!s.rot && s.xs === 1 && s.ys === 1) {
                    stage.sprite(def, x + def.regX, y + def.regY, { alpha: s.alpha * a0 });
                    return;
                }
                ctx.save();
                ctx.translate(x, y);
                if (s.rot) ctx.rotate(s.rot);
                if (s.xs !== 1 || s.ys !== 1) ctx.scale(s.xs, s.ys);
                stage.sprite(def, def.regX, def.regY, { alpha: s.alpha * a0 });
                ctx.restore();
            });
        }
    }
    PP.Movie = Movie;

    // movies by path, parsed once per pack
    PP.movie = function (pack, path) {
        pack.movies = pack.movies || new Map();
        const k = VG.key(path);
        if (!pack.movies.has(k)) {
            const node = pack.xml(path);
            pack.movies.set(k, node ? new Movie(pack, node) : null);
        }
        return pack.movies.get(k);
    };

    // A sprite animation (UI\...\*Anim.xml) on its own target, started now
    PP.anim = function (pack, path, target, options) {
        const node = typeof path === 'string' ? pack.xml(String(path).trim()) : path;
        if (!node) return null;
        const run = new VG.Animator(node, target || {}, options);
        return run;
    };

    // ---- node layouts (NodeSprite / NodeButton / NodeLabel) -----------------------------------
    class Nodes {
        constructor(pack, node) {
            this.pack = pack;
            this.items = [];
            this.byName = {};
            VG.children(node).forEach((n) => this.add(n, 0, 0));
        }

        add(n, ox, oy) {
            const desc = VG.child(n, 'Desc');
            const x = ox + VG.num(n, 'X', VG.num(n, 'x', 0));
            const y = oy + VG.num(n, 'Y', VG.num(n, 'y', 0));
            let item = null;
            if (n.t === 'NodeSprite' || n.t === 'NodeButton') {
                const path = VG.text(desc, n.t === 'NodeButton' ? 'Button' : 'Sprite') || VG.text(desc, 'Sprite');
                item = {
                    kind: n.t === 'NodeButton' ? 'button' : 'sprite',
                    sprite: path ? this.pack.sprite(path) : null,
                    alpha: VG.num(desc, 'Alpha', 255) / 255
                };
            } else if (n.t === 'NodeLabel') {
                item = {
                    kind: 'label',
                    text: PP.text(this.pack, VG.text(desc, 'Text')),
                    font: PP.text(this.pack, VG.text(desc, 'FontName', 'Segoe UI')) || 'Segoe UI',
                    size: PP.num(this.pack, VG.text(desc, 'FontSize'), 10),
                    color: VG.text(desc, 'Color', 'FF000000'),
                    justify: VG.num(desc, 'Justify', 0)
                };
            }
            if (!item) return null;
            Object.assign(item, { name: n.a && n.a.Name, node: n, x, y, w: VG.num(n, 'W', 0), h: VG.num(n, 'H', 0), visible: true, anim: 0 });
            if (item.sprite && !item.w) {
                item.w = item.sprite.w;
                item.h = item.sprite.h;
            }
            this.items.push(item);
            if (item.name && !this.byName[item.name]) this.byName[item.name] = item;
            return item;
        }

        get(name) {
            return this.byName[name] || null;
        }

        sprites() {
            return this.items.map((i) => i.sprite).filter(Boolean);
        }

        // a button's box: the frame minus its registration offset
        box(it) {
            const s = it.sprite;
            return { x: it.x - (s ? s.regX : 0), y: it.y - (s ? s.regY : 0), w: it.w, h: it.h };
        }

        hit(p, filter) {
            for (let i = this.items.length - 1; i >= 0; i--) {
                const it = this.items[i];
                if (it.kind !== 'button' || !it.visible || (filter && !filter(it))) continue;
                const b = this.box(it);
                if (p.x >= b.x && p.y >= b.y && p.x < b.x + b.w && p.y < b.y + b.h) return it;
            }
            return null;
        }
    }
    PP.Nodes = Nodes;

    // A label in the engine's box: Justify 64 centres in W, 32 centres in H, 128 right-aligns
    PP.drawLabel = function (stage, it, text, overrides) {
        const o = Object.assign({}, it, overrides || {});
        const t = text === undefined ? o.text : text;
        if (!t) return;
        const ctx = stage.ctx;
        const c = String(o.color || 'FF000000').replace(/^0x/i, '');
        const alpha = c.length >= 8 ? parseInt(c.slice(0, 2), 16) / 255 : 1;
        ctx.save();
        ctx.globalAlpha = alpha * (o.alpha === undefined ? 1 : o.alpha);
        ctx.fillStyle = '#' + c.slice(-6);
        const px = VG.pt(o.size || 10);
        ctx.font = (o.bold ? 'bold ' : '') + px + 'px "' + (o.font || 'Segoe UI') + '", "Segoe UI", sans-serif';
        const j = o.justify || 0;
        const lines = String(t).split(/\\n|\n/);
        const lh = Math.round(px * 1.25);
        ctx.textBaseline = 'top';
        ctx.textAlign = (j & 64) ? 'center' : ((j & 128) ? 'right' : 'left');
        const x = (j & 64) ? o.x + o.w / 2 : ((j & 128) ? o.x + o.w : o.x);
        let y = o.y;
        if (j & 32) y = o.y + (o.h - lines.length * lh) / 2;
        lines.forEach((line, i) => ctx.fillText(line, x, y + i * lh));
        ctx.restore();
    };

    // ---- tips (Tips.xml of each screen; Intro = White, Help = Green, Error = Red) --------------
    PP.loadTips = function (pack, path) {
        const out = {};
        VG.children(pack.xml(path), 'Tip').forEach((t) => {
            const id = VG.text(t, 'Id');
            if (!id || /^Pin/.test(id)) return;
            out[id] = {
                id,
                title: PP.text(pack, VG.text(t, 'Title')),
                message: PP.text(pack, VG.text(t, 'Message')),
                type: VG.text(t, 'Type', 'Intro'),
                minWidth: VG.num(t, 'MinWidth', 0),
                noTimeout: VG.bool(t, 'NoTimeout')
            };
        });
        return out;
    };
    const TIP_STYLE = { Intro: 'White', Help: 'Green', Error: 'Red' };
    PP.tipStyles = function (pack) {
        const out = {};
        Object.keys(TIP_STYLE).forEach((type) => {
            const s = VG.tipStyle(pack, TIP_STYLE[type]);
            if (!s) return;
            // the style's fonts are "|id|Tips|Segoe UI//..." strings
            s.bodyFont = PP.text(pack, s.bodyFont) || 'Segoe UI';
            s.titleFont = PP.text(pack, s.titleFont) || 'Segoe UI';
            out[type] = s;
        });
        return out;
    };

    // ---- the game ---------------------------------------------------------------------------
    let game = null;

    class PurblePlace {
        constructor(pack) {
            this.pack = pack;
            useRelaidSheets(pack);
            const saved = store.get('settings', {});
            this.s = Object.assign({}, DEFAULTS, saved);
            ['pairs', 'cakes', 'shop'].forEach((k) => { this.s[k] = Object.assign({}, DEFAULTS[k], saved[k] || {}); });
            const audio = pack.xml('Audio\\Audio.xml');
            const soundsNode = VG.child(VG.child(audio, 'Audio') || audio, 'Sounds');
            this.sounds = new VG.Sounds(pack, soundsNode);
            // feature sounds are numbered (<SoundID> in the face templates): the <Sounds> order
            this.soundNames = VG.children(soundsNode).map((n) => n.t);
            this.sounds.enabled = this.s.sounds;
            this.tipStyles = PP.tipStyles(pack);
            this.town = new Nodes(pack, pack.xml('UI\\PurblePlace\\PurblePlaceManager.xml'));
            const mgr = pack.xml('UI\\PurblePlace\\PurblePlaceManager.xml');
            this.townBack = pack.sprite(VG.text(mgr, 'Background'));
            this.clouds = PP.movie(pack, 'UI\\PurblePlace\\CloudsMovie.xml');
            this.loading = pack.sprite('UI\\PurblePlace\\Loading.xml');
            this.townTips = PP.loadTips(pack, 'UI\\PurblePlace\\Tips.xml');
            const widget = pack.xml('UI\\PurblePlace\\WidgetTip.xml');
            this.townTipPos = { x: VG.num(widget, 'DefaultX', 0), y: VG.num(widget, 'DefaultY', 400) };
            this.modules = {};
            this.screen = 'town';
            this.mod = null;
            this.hot = null;
            this.down = null;
            this.tip = null;
            this.started = VG.now();
            this.win = VG.createGameWindow({
                id: MODAL_ID,
                game: GAME_ID,
                title: pack.string(112, 'Purble Place'),
                // the taskbar looks the caption icon's file name up in the app-icon set
                icon: '/static_images/app_icons/48/vista-purble.webp',
                iconClass: 'fas fa-shapes',
                pack,
                menu: MENUS.town,
                accelerators: 155,
                nativeW: W,
                nativeH: H,
                fill: '#000',
                onCommand: (id) => this.command(id),
                menuState: (id) => this.menuState(id),
                onClose: () => this.requestExit(),
                onActivate: (a) => this.setActive(a),
                onKeyDown: (e) => this.keyDown(e)
            });
            // pane edges measured on the VM (x 217 / 517 of the 800 px client)
            this.status = C.statusBar(this.win, [{ width: 217 }, { width: 300 }, {}]);
            this.win.stage.draw = () => this.draw();
            this.win.stage.onFrame = (now) => this.frame(now);
            this.wirePointer();
            this.updateStatus();
        }

        saveSettings() {
            store.set('settings', this.s);
        }

        playSound(name, variant) {
            return this.sounds.play(name, variant);
        }

        // a <SoundID> number
        playSoundId(id) {
            const name = this.soundNames[id];
            if (name) this.sounds.play(name);
        }

        townSprites() {
            const list = this.town.sprites().concat(this.townBack ? [this.townBack] : [], this.clouds ? this.clouds.sprites() : [], this.loading ? [this.loading] : []);
            Object.values(this.tipStyles).forEach((s) => list.push(...s.sprites()));
            return list;
        }

        warm(list) {
            return VG.warmSprites(this.win.stage, this.pack, list || this.townSprites());
        }

        module(id) {
            if (!this.modules[id]) {
                const Ctor = { pairs: PP.Pairs, cakes: PP.Cakes, shop: PP.Shop }[id];
                if (!Ctor) return null;
                this.modules[id] = new Ctor(this);
            }
            return this.modules[id];
        }

        // ---- screens ----
        setMenu(id) {
            if (this.win.spec.menu === id) return;
            this.win.spec.menu = id;
            VG.buildMenubar(this.win);
        }

        showTown() {
            if (this.mod) this.mod.leave();
            this.mod = null;
            this.screen = 'town';
            this.hot = null;
            this.down = null;
            this.hideTip();
            this.setMenu(MENUS.town);
            this.updateStatus();
            this.win.stage.invalidate();
        }

        // click on a building: ask the difficulty the first time, offer a saved game, then play
        enter(id, opts) {
            opts = opts || {};
            const mod = this.module(id);
            if (!mod) return;
            const cfg = this.s[id];
            const go = () => {
                const saved = store.get('saved_' + id, null);
                if (saved && !opts.fresh) {
                    if (this.s.continueSaved) {
                        this.start(id, saved);
                        return;
                    }
                    // the blue loading screen stays behind the question (VM)
                    this.screen = 'loading';
                    this.hideTip();
                    this.win.stage.invalidate();
                    this.savedGameFound().then((r) => {
                        if (r === 1) this.start(id, saved);
                        else if (r === 2) {
                            store.remove('saved_' + id);
                            this.start(id, null);
                        } else this.showTown();
                    });
                    return;
                }
                this.start(id, null);
            };
            if (!cfg.asked && !opts.fresh) {
                this.askDifficulty(id).then((d) => {
                    if (d === null) return;
                    cfg.difficulty = d;
                    cfg.asked = true;
                    this.saveSettings();
                    go();
                });
                return;
            }
            go();
        }

        start(id, saved) {
            const mod = this.module(id);
            if (this.mod && this.mod !== mod) this.mod.leave();
            this.hideTip();
            this.screen = 'loading';
            this.mod = mod;
            this.hot = null;
            this.down = null;
            this.setMenu(MENUS[id]);
            this.win.stage.invalidate();
            this.updateStatus();
            mod.warm().then(() => {
                if (this.mod !== mod) return;
                this.screen = id;
                mod.begin(saved);
                if (saved) store.remove('saved_' + id);
                this.updateStatus();
                this.win.stage.invalidate();
            });
        }

        // ---- frame / draw ----
        frame() {
            // performance.now, the clock every start time here was taken from
            const now = VG.now();
            let busy = this.screen === 'town' || this.screen === 'loading';
            if (this.mod && this.screen === this.mod.id && this.mod.frame(now)) busy = true;
            if (this.tip) {
                if (!this.tip.noTimeout && now - this.tip.shownAt > 12000) this.tip = null;
                if (this.tip && this.tip.fadeIn && now - this.tip.shownAt < 300) busy = true;
            }
            return busy;
        }

        draw() {
            const st = this.win.stage;
            if (this.screen === 'loading') {
                if (this.loading) st.sprite(this.loading, 0, 0);
                const labels = this.town.items.filter((i) => i.name === 'Loading');
                labels.forEach((l) => PP.drawLabel(st, l));
                return;
            }
            if (this.screen === 'town') {
                this.drawTown(st);
                this.drawTip();
                return;
            }
            if (this.mod) this.mod.draw(st);
            this.drawTip();
        }

        drawTown(st) {
            const now = VG.now();
            if (this.townBack) st.sprite(this.townBack, 0, 0);
            // the clouds' stage is 1200 wide: they enter at x 0 and leave at ~1190, both off screen
            if (this.clouds) this.clouds.draw(st, this.clouds.frameAt(now - this.started, true), CLOUDS_X, CLOUDS_Y);
            this.town.items.forEach((it) => {
                if (it.kind === 'label') return; // the loading caption and the (MCE) title
                if (!it.sprite) return;
                let anim = 0;
                if (it.kind === 'button') {
                    if (this.down === it.name && this.hot === it.name) anim = 2;
                    else if (this.hot === it.name || this.down === it.name) anim = 1;
                }
                st.sprite(it.sprite, it.x, it.y, { anim: Math.min(anim, it.sprite.anims.length - 1), alpha: it.alpha });
            });
        }

        // ---- tips ----
        // tip: an entry of a Tips.xml; at: { x, y, w } in native px
        showTip(tip, at) {
            if (!this.s.tips || !tip) return;
            this.tip = Object.assign({}, tip, at, { shownAt: VG.now(), fadeIn: true });
            this.win.stage.invalidate();
        }

        hideTip() {
            if (!this.tip) return;
            this.tip = null;
            this.win.stage.invalidate();
        }

        drawTip() {
            const t = this.tip;
            if (!t) return;
            const style = this.tipStyles[t.type] || this.tipStyles.Intro;
            const alpha = Math.min(1, (VG.now() - t.shownAt) / 250);
            t.rect = VG.drawTip(this.win.stage, style, { title: t.title, message: t.message, x: t.x, y: t.y, bottom: t.bottom, w: Math.max(t.w || 0, t.minWidth || 0) || 212, alpha, closeHot: t.closeHot, closeDown: t.closeDown });
        }

        tipHit(p) {
            const r = this.tip && this.tip.rect;
            if (!r) return null;
            const c = r.close;
            if (p.x >= c.x - 2 && p.y >= c.y - 2 && p.x < c.x + c.w + 2 && p.y < c.y + c.h + 2) return 'close';
            if (p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h) return 'body';
            return null;
        }

        // ---- status bar ----
        updateStatus() {
            if (!this.status) return;
            const texts = this.mod && this.screen === this.mod.id && this.mod.statusTexts ? this.mod.statusTexts() : ['', '', ''];
            [0, 1, 2].forEach((i) => this.status.set(i, texts[i] || ''));
            const cells = this.status.el.children;
            const colors = this.mod && this.screen === this.mod.id && this.mod.statusColors ? this.mod.statusColors() : [];
            [0, 1, 2].forEach((i) => { if (cells[i]) cells[i].style.color = colors[i] || ''; });
        }

        // ---- input ----
        wirePointer() {
            const surface = this.win.surface;
            const pos = (e) => {
                const r = surface.getBoundingClientRect();
                return this.win.stage.toNative(e.clientX - r.left, e.clientY - r.top);
            };
            surface.addEventListener('contextmenu', (e) => e.preventDefault());
            surface.addEventListener('pointermove', (e) => this.pointer('move', pos(e), e));
            surface.addEventListener('pointerdown', (e) => {
                surface.focus({ preventScroll: true });
                if (e.button !== 0) return;
                try { surface.setPointerCapture(e.pointerId); } catch (_) { /* old browsers */ }
                this.pointer('down', pos(e), e);
            });
            surface.addEventListener('pointerup', (e) => {
                if (e.button !== 0) return;
                this.pointer('up', pos(e), e);
            });
            surface.addEventListener('pointerleave', () => this.pointer('leave', { x: -1, y: -1 }));
        }

        pointer(type, p, e) {
            if (this.win.dialogs.length) return;
            // the tip's close box
            if (this.tip) {
                const t = this.tipHit(p);
                if (type === 'move') {
                    const hot = t === 'close';
                    if (hot !== !!this.tip.closeHot) {
                        this.tip.closeHot = hot;
                        this.win.stage.invalidate();
                    }
                } else if (type === 'down' && t === 'close') {
                    this.tip.closeDown = true;
                    this.win.stage.invalidate();
                    return;
                } else if (type === 'up' && this.tip.closeDown) {
                    this.tip.closeDown = false;
                    if (t === 'close') this.hideTip();
                    this.win.stage.invalidate();
                    return;
                }
            }
            if (this.screen === 'town') {
                this.townPointer(type, p);
                return;
            }
            if (this.mod && this.screen === this.mod.id) this.mod.pointer(type, p, e);
        }

        townPointer(type, p) {
            const b = this.town.hit(p);
            const name = b ? b.name : null;
            if (type === 'move' || type === 'leave') {
                const n = type === 'leave' ? null : name;
                if (n !== this.hot) {
                    this.hot = n;
                    this.win.stage.invalidate();
                }
                return;
            }
            if (type === 'down') {
                this.down = name;
                this.hot = name;
                this.win.stage.invalidate();
                return;
            }
            if (type === 'up') {
                const down = this.down;
                this.down = null;
                this.win.stage.invalidate();
                if (!down || down !== name) return;
                this.playSound('UI_BUTTON');
                this.hideTip();
                if (down === 'ConcentrationButton') this.enter('pairs');
                else if (down === 'ComfyCakesButton') this.enter('cakes');
                else if (down === 'BuildAPurbleButton') this.enter('shop');
                else if (down === 'ExitButton') {
                    if (this.requestExit(true) !== false) VG.closeWindow(this.win);
                }
            }
        }

        keyDown(e) {
            if (this.mod && this.screen === this.mod.id && this.mod.keyDown) this.mod.keyDown(e);
        }

        setActive(active) {
            Object.values(this.modules).forEach((m) => m.setActive && m.setActive(active && m === this.mod));
        }

        // ---- menus ----
        menuState(id) {
            const inGame = this.mod && this.screen === this.mod.id;
            if (id === CMD.HINT) return { disabled: !inGame || !this.mod.canHint || !this.mod.canHint() };
            if (id === CMD.MAIN_MENU || id === CMD.NEW) return { disabled: !inGame };
            return null;
        }

        command(id) {
            const p = this.pack;
            const inGame = this.mod && this.screen === this.mod.id;
            switch (id) {
            case CMD.NEW: if (inGame) this.askNewGame(); break;
            case CMD.NEW_PAIRS: this.enter('pairs'); break;
            case CMD.NEW_CAKES: this.enter('cakes'); break;
            case CMD.NEW_SHOP: this.enter('shop'); break;
            case CMD.MAIN_MENU: if (inGame) this.askMainMenu(); break;
            case CMD.HINT: if (inGame && this.mod.hint) this.mod.hint(); break;
            case CMD.STATS: this.showStats(); break;
            case CMD.OPTIONS: this.showOptions(); break;
            case CMD.EXIT: if (this.requestExit(true) !== false) VG.closeWindow(this.win); break;
            case CMD.ABOUT: VG.aboutBox({ owner: this.win, title: p.string(112, 'Purble Place'), text: p.string(154), icon: '/static_images/vista-games/icons/purble-48.png' }); break;
            case CMD.HELP: this.showHelpTip(); break;
            default: break;
            }
        }

        showHelpTip() {
            if (this.screen === 'town') this.showTip(this.townTips.IntroTip, { x: this.townTipPos.x + 2, bottom: this.townTipPos.y + 76, w: 300 });
            else if (this.mod && this.mod.helpTip) this.mod.helpTip();
        }

        inProgress() {
            return !!(this.mod && this.screen === this.mod.id && this.mod.inProgress());
        }

        // ---- dialogs ----
        // Select Difficulty: strings 213-219 (Purble Pairs), 124-129 (Comfy Cakes), 130-135 (Purble Shop)
        askDifficulty(id) {
            const p = this.pack;
            const ids = { pairs: [213, 214, 215, 216, 217, 219], cakes: [124, 125, 127, 128, 129, 126], shop: [130, 131, 133, 134, 135, 132] }[id];
            return VG.taskDialog({
                owner: this.win,
                title: p.string(ids[0], 'Select Difficulty'),
                instruction: p.string(ids[1]),
                links: [PP.link(p, ids[2], 0), PP.link(p, ids[3], 1), PP.link(p, ids[4], 2)],
                footer: p.string(ids[5]).trim(),
                width: 401
            }).then((r) => (r === 0 || r === 1 || r === 2 ? r : null));
        }

        // VM: "Saved Game Found / Do you want to continue your saved game?" with Yes / No and the
        // "Always continue saved game" box (the shared 6006-6009 / 6023 strings)
        savedGameFound() {
            const p = this.pack;
            return VG.taskDialog({
                owner: this.win,
                title: p.string(6006, 'Saved Game Found'),
                instruction: p.string(6007, 'Do you want to continue your saved game?'),
                buttons: [{ id: 1, text: p.string(6008, '&Yes'), default: true }, { id: 2, text: p.string(6009, '&No') }],
                check: { text: p.string(6023, 'Always continue saved game'), checked: this.s.continueSaved }
            }).then((r) => {
                if (r.checked !== this.s.continueSaved) {
                    this.s.continueSaved = r.checked;
                    this.saveSettings();
                }
                return r.id;
            });
        }

        askMainMenu() {
            if (!this.inProgress()) {
                this.showTown();
                return;
            }
            const p = this.pack;
            VG.taskDialog({
                owner: this.win,
                title: p.string(175, 'Return to Main Menu'),
                instruction: p.string(176),
                links: [PP.link(p, 177, 1), PP.link(p, 178, 2)],
                width: 361
            }).then((r) => {
                if (r !== 1) return;
                this.saveCurrent();
                this.showTown();
            });
        }

        askNewGame() {
            const mod = this.mod;
            if (!this.inProgress()) {
                this.start(mod.id, null);
                return;
            }
            const p = this.pack;
            const quit = { shop: 167, cakes: 168, pairs: 196 }[mod.id];
            VG.taskDialog({
                owner: this.win,
                title: p.string(165, 'Purble Place New Game'),
                instruction: p.string(166),
                links: [PP.link(p, quit, 1), PP.link(p, 169, 2)],
                width: 401
            }).then((r) => {
                if (r !== 1) return;
                mod.recordLoss();
                this.start(mod.id, null);
            });
        }

        saveCurrent() {
            const mod = this.mod;
            if (!mod || !mod.inProgress()) return;
            const state = mod.saveState();
            if (state) store.set('saved_' + mod.id, state);
        }

        requestExit(fromMenu) {
            if (!this.inProgress()) return true;
            const p = this.pack;
            VG.taskDialog({
                owner: this.win,
                title: p.string(155, 'Exit Game'),
                instruction: p.string(156),
                links: [PP.link(p, 157, 1), PP.link(p, 159, 2)],
                width: 361
            }).then((r) => {
                if (r !== 1) return;
                this.saveCurrent();
                this.showTown();
                VG.closeWindow(this.win);
            });
            return fromMenu ? false : false;
        }

        // the game a module plays with changed settings: "These settings won't apply..." (174, 142, 139, 140)
        askChangedSettings() {
            const p = this.pack;
            return VG.taskDialog({
                owner: this.win,
                title: p.string(174, 'Change Game Settings'),
                instruction: p.string(142),
                links: [PP.link(p, 139, 1), PP.link(p, 140, 2)],
                width: 401
            });
        }

        // Options: Purble Pairs 142, Purble Shop 168, Comfy Cakes 169 (the town: the current game's,
        // Purble Pairs by default)
        showOptions() {
            const id = this.mod ? this.mod.id : 'pairs';
            const s = this.s;
            const cfg = s[id];
            const tpl = { pairs: 142, shop: 168, cakes: 169 }[id];
            const radios = { pairs: [1153, 1154, 1155], shop: [1001, 1002, 1003], cakes: [1006, 1007, 1008] }[id];
            const extra = { pairs: 1022, cakes: 1010 }[id];
            const before = JSON.stringify(cfg);
            VG.dialog(this.pack, tpl, {
                owner: this.win,
                init: (dlg) => {
                    radios.forEach((r, i) => dlg.checked(r, cfg.difficulty === i));
                    if (extra) dlg.checked(extra, id === 'pairs' ? !!cfg.timerOff : !!cfg.oneCake);
                    dlg.checked(1016, s.sounds);
                    dlg.checked(1015, s.tips);
                    dlg.checked(1020, s.continueSaved);
                },
                onCommand: (cid, dlg) => {
                    if (cid !== 1) return true;
                    const d = radios.findIndex((r) => dlg.checked(r));
                    const next = Object.assign({}, cfg, { difficulty: d < 0 ? cfg.difficulty : d, asked: true });
                    if (extra) next[id === 'pairs' ? 'timerOff' : 'oneCake'] = dlg.checked(extra);
                    s.sounds = dlg.checked(1016);
                    s.tips = dlg.checked(1015);
                    s.continueSaved = dlg.checked(1020);
                    this.sounds.enabled = s.sounds;
                    if (!s.tips) this.hideTip();
                    const changed = JSON.stringify(Object.assign({}, next, { asked: cfg.asked })) !== before;
                    if (changed && this.mod && this.mod.id === id && this.inProgress()) {
                        // the new settings apply now (and the game counts as lost) or next game
                        setTimeout(() => {
                            this.askChangedSettings().then((r) => {
                                Object.assign(cfg, next);
                                this.saveSettings();
                                if (r === 1) {
                                    this.mod.recordLoss();
                                    this.start(id, null);
                                }
                            });
                        }, 0);
                    } else {
                        Object.assign(cfg, next);
                        this.saveSettings();
                        if (changed && this.mod && this.mod.id === id && this.screen === id) this.start(id, null);
                    }
                    this.saveSettings();
                    return true;
                }
            });
        }

        // ---- statistics (dialog 107: one list for the nine game / difficulty pairs) ----
        stats(key) {
            const all = store.get('stats', {});
            return Object.assign({ played: 0, won: 0, best: [], sum: 0, count: 0 }, all[key] || {});
        }

        // result: { won, score, avg (the per-game figure the dialog averages) }
        recordGame(key, result) {
            const all = store.get('stats', {});
            const st = Object.assign({ played: 0, won: 0, best: [], sum: 0, count: 0 }, all[key] || {});
            st.played += 1;
            if (result.won) st.won += 1;
            if (typeof result.avg === 'number') {
                st.sum += result.avg;
                st.count += 1;
            }
            if (result.won && typeof result.score === 'number') {
                st.best.push({ score: Math.round(result.score), date: Date.now() });
                st.best.sort((a, b) => b.score - a.score || a.date - b.date);
                st.best = st.best.slice(0, 5);
            }
            all[key] = st;
            store.set('stats', all);
            return st;
        }

        showStats() {
            const p = this.pack;
            const entries = [
                { key: 'pairs0', name: 220 }, { key: 'pairs1', name: 218 }, { key: 'pairs2', name: 221 },
                { key: 'cakes0', name: 151 }, { key: 'cakes1', name: 152 }, { key: 'cakes2', name: 153 },
                { key: 'shop0', name: 148 }, { key: 'shop1', name: 149 }, { key: 'shop2', name: 150 }
            ];
            const avgText = { pairs: 42197, cakes: 50040, shop: 46633 };
            const cur = this.mod ? this.mod.id + this.s[this.mod.id].difficulty : 'pairs' + this.s.pairs.difficulty;
            let current = cur;
            const fill = (dlg) => {
                const st = this.stats(current);
                const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
                const kind = current.replace(/\d$/, '');
                dlg.text(1037, PP.fmt(p.string(41237, 'Games played: %1!d!'), st.played));
                dlg.text(1038, PP.fmt(p.string(41532, 'Games won: %1!d!'), st.won));
                dlg.text(1040, PP.fmt(p.string(41060, 'Win percentage: %1!d!%%'), pct));
                dlg.text(1039, PP.fmt(p.string(avgText[kind]), st.count ? Math.round(st.sum / st.count) : 0));
                [1027, 1028, 1029, 1030, 1031].forEach((cid, i) => {
                    const e = st.best[i];
                    dlg.text(cid, e ? String(e.score) : '');
                    dlg.text(cid + 5, e ? VG.formatDate(e.date) : '');
                });
            };
            VG.dialog(p, 107, {
                owner: this.win,
                focus: 1114,
                init: (dlg) => {
                    dlg.setList(1114, entries.map((e) => ({ value: e.key, text: p.string(e.name) })), current);
                    fill(dlg);
                },
                onCommand: (cid, dlg, how) => {
                    if (cid === 1114 && how === 'change') {
                        current = dlg.listValue(1114);
                        fill(dlg);
                        return false;
                    }
                    if (cid === 1025) {
                        VG.taskDialog({
                            owner: this.win,
                            title: p.string(6010, 'Reset Statistics'),
                            instruction: p.string(6011, 'Do you want to reset all your statistics to zero?'),
                            buttons: [{ id: 1, text: p.string(6012, '&Yes') }, { id: 2, text: p.string(6013, '&No'), default: true }]
                        }).then((r) => {
                            if (r === 1) {
                                store.set('stats', {});
                                fill(dlg);
                            }
                        });
                        return false;
                    }
                    return true;
                }
            });
        }

        // the end-of-game dialog: Play again (2 or the template's), Main menu, Exit; `hide`: the
        // controls the game leaves hidden (the Game Lost boxes' high score and date before there
        // is a high score)
        endDialog(template, texts, buttons, hide) {
            const p = this.pack;
            VG.dialog(p, template, {
                owner: this.win,
                texts,
                init: (dlg) => (hide || []).forEach((id) => dlg.show(id, false)),
                closeOn: 'any',
                onClose: (r) => {
                    if (r === buttons.exit) VG.closeWindow(this.win);
                    else if (r === buttons.menu) this.showTown();
                    else if (this.mod) this.start(this.mod.id, null);
                }
            });
        }

        afterOpen() {
            this.showTown();
            if (this.s.tips && !this.s.townTipShown) {
                this.s.townTipShown = true;
                this.saveSettings();
                this.showHelpTip();
            }
        }
    }

    function open() {
        return VG.loadPack(GAME_ID).then((pack) => {
            if (!game) game = new PurblePlace(pack);
            game.sounds.enabled = game.s.sounds;
            return game.warm().then(() => {
                const wasOpen = game.win.isOpen();
                game.win.open();
                if (!wasOpen) {
                    game.sounds.warm();
                    game.afterOpen();
                }
                return game;
            });
        });
    }

    VG.register({
        id: GAME_ID,
        name: 'Purble Place',
        icon: '/static_images/vista-games/icons/purble',
        thumbnail: '/static_images/vista-games/purble/images/rgmh_thumbnail_purbles.png',
        feature: 'vista_purble',
        open
    });
    root.openVistaPurblePlace = open;
    root.vistaPurblePlace = () => game;
})(typeof window !== 'undefined' ? window : globalThis);
