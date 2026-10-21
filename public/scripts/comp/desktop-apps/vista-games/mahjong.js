// Mahjong Titans, as Windows Vista's (Yozora #609). Art, layouts, sounds, menus, dialogs and
// strings are Mahjong.dll's and Mahjong.exe.mui's (scripts/build-vista-games.js); the engine is
// vistaGameEngine.js. The game opens on the layout screen (UI\Board\BackgroundLayout.xml: Turtle,
// Dragon, Cat, Fortress, Crab, Spider); a layout is UI\Board\Layouts\<Name>Layout.xml, 144 tiles in
// layers on a 40 x 56 px grid. A tile is free when nothing lies on it and its left or right side
// is open; identical tiles match, any season matches any season and any flower any flower. Every
// deal is solvable: it is built by taking pairs off the full layout and the reverse is the win.
//
// Measured on the VM: the 800x496 board over the status bar (Available Matches, Tiles Remaining,
// Score, Time); a pair is worth 2 points, the score pane flashes red, the pair leaves in a spray of
// pink blossoms (FlowersAnim with the traditional tiles); Hint lights a pair in pale blue.
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    // the Win32 status bar: VG.Cards.statusBar (cardEngine.js, the feature this one depends on)
    const C = VG.Cards;
    const GAME_ID = 'mahjong';
    const MODAL_ID = 'vistaMahjongModal';
    const W = 800;
    const H = 496;
    const STEP_X = 40;
    const STEP_Y = 56;

    const CMD = { NEW: 40020, UNDO: 40021, HINT: 40022, STATS: 40030, OPTIONS: 40016, APPEARANCE: 40028, EXIT: 40002, HELP: 40008, ABOUT: 40025 };
    const LAYOUTS = [
        { id: 'turtle', file: 'Turtle', name: 60698, stats: 49017 },
        { id: 'dragon', file: 'Dragon', name: 47783, stats: 48472 },
        { id: 'cat', file: 'Cat', name: 49539, stats: 43533 },
        { id: 'fortress', file: 'Fortress', name: 56131, stats: 48833 },
        { id: 'crab', file: 'Crab', name: 43604, stats: 63342 },
        { id: 'spider', file: 'Spider', name: 54904, stats: 57936 }
    ];
    const TILESETS = [
        { name: 47960, thumb: 'UI\\Board\\Tiles\\TilesThumb.png', effect: 'flowers' },
        { name: 63122, thumb: 'UI\\Board\\Tiles\\Tiles2Thumb.png', effect: 'stars' },
        { name: 63123, thumb: 'UI\\Board\\Tiles\\Tiles3Thumb.png', effect: 'bubbles' },
        { name: 63124, thumb: 'UI\\Board\\Tiles\\TilesThumb_MCE.png', effect: 'flame' }
    ];
    const BACKGROUNDS = [
        { name: 41222, file: 'Seagrass' }, { name: 46323, file: 'GreenFelt' }, { name: 61480, file: 'BrownFelt' },
        { name: 55117, file: 'RedFelt' }, { name: 47550, file: 'Blossom' }
    ];
    // frames 0-33 match their own kind; seasons 34-37 match each other, flowers 38-41 too
    const group = (f) => (f >= 34 && f <= 37 ? 'season' : (f >= 38 && f <= 41 ? 'flower' : 'tile' + f));

    const store = VG.store(GAME_ID);
    const DEFAULTS = { animations: true, sounds: true, tips: true, continueSaved: false, saveOnExit: false, tileset: 0, background: 0, randomLook: false, layout: 0 };
    const fmt = (t, ...a) => String(t).replace(/%(\d)(?:!\w!)?/g, (_, n) => String(a[Number(n) - 1])).replace(/%%/g, '%').trim();

    let game = null;

    class Mahjong {
        constructor(pack) {
            this.pack = pack;
            this.s = Object.assign({}, DEFAULTS, store.get('settings', {}));
            this.sounds = new VG.Sounds(pack, VG.child(VG.child(pack.xml('Audio\\Audio.xml'), 'Audio'), 'Sounds'));
            this.tipStyle = VG.tipStyle(pack, 'White');
            this.tileSprite = pack.sprite('UI\\Board\\spriteSolitaireTiles.xml');
            this.shadow = pack.sprite('UI\\Board\\spriteShadow.xml');
            this.highlight = pack.sprite('UI\\Board\\spriteHighlights.xml');
            this.effects = {
                flowers: { sprite: pack.sprite('UI\\Board\\Animations\\FlowersAnim.xml'), spec: pack.xml('UI\\Board\\Animations\\FlowersAnimDefine.xml'), sound: 'SOUND_FLOWERANIM' },
                stars: { sprite: pack.sprite('UI\\Board\\Animations\\StarsAnim.xml'), spec: pack.xml('UI\\Board\\Animations\\StarsAnimDefine.xml'), sound: 'SOUND_STARANIM' },
                bubbles: { sprite: pack.sprite('UI\\Board\\Animations\\BubblesAnim.xml'), spec: pack.xml('UI\\Board\\Animations\\BubblesAnimDefine.xml'), sound: 'SOUND_BUBBLESANIM' },
                flame: { sprite: pack.sprite('UI\\Board\\Animations\\FlameAnim.xml'), spec: pack.xml('UI\\Board\\Animations\\FlameAnimDefine.xml'), sound: 'SOUND_FLAMEANIM' }
            };
            this.backgrounds = BACKGROUNDS.map((b) => pack.sprite('UI\\Board\\Backgrounds\\' + b.file + 'Sprite.xml'));
            this.chooser = new VG.Scene(pack, pack.xml('UI\\Board\\BackgroundLayout.xml'));
            this.particles = [];
            this.anims = [];
            this.mode = 'choose';
            this.time = 0;
            this.running = false;
            this.win = VG.createGameWindow({
                id: MODAL_ID,
                game: GAME_ID,
                title: pack.string(44419, 'Mahjong Titans'),
                icon: '/static_images/app_icons/48/vista-mahjong.webp',
                iconClass: 'fas fa-dragon',
                pack,
                menu: Object.keys(pack.mui.menus)[0],
                accelerators: 116,
                nativeW: W,
                nativeH: H,
                fill: '#2a2015',
                onCommand: (id) => this.command(id),
                menuState: (id) => this.menuState(id),
                onClose: () => this.requestExit(),
                onClosed: () => this.closed(),
                onActivate: (a) => this.setActive(a),
                onKeyDown: () => { if (this.fireworks) this.endFireworks(); }
            });
            this.status = C.statusBar(this.win, [{ width: 265 }, { width: 245 }, { width: 142 }, {}]);
            this.win.stage.draw = () => this.draw();
            this.win.stage.onFrame = (now) => this.frame(now);
            this.wirePointer();
            this.updateStatus();
        }

        saveSettings() {
            store.set('settings', this.s);
        }

        allSprites() {
            const list = [this.tileSprite, this.shadow, this.highlight, this.backgrounds[this.s.background]]
                .concat(Object.values(this.effects).map((e) => e.sprite), this.chooser.sprites());
            if (this.tipStyle) list.push(...this.tipStyle.sprites());
            return list.filter(Boolean);
        }

        warm() {
            return VG.warmSprites(this.win.stage, this.pack, this.allSprites());
        }

        // ---- board ----
        loadLayout(index) {
            const L = LAYOUTS[index];
            const root2 = this.pack.xml('UI\\Board\\Layouts\\' + L.file + 'Layout.xml');
            const tiles = [];
            const walk = (n, ox, oy, layer) => {
                VG.children(n).forEach((c) => {
                    if (c.t === 'Container') {
                        const m = /Layer(\d+)/.exec((c.a && c.a.Name) || '');
                        walk(c, ox + VG.num(c, 'X', 0), oy + VG.num(c, 'Y', 0), m ? Number(m[1]) : layer);
                    } else if (c.t === 'Image' && /^Tile\d+$/.test((c.a && c.a.Name) || '')) {
                        tiles.push({ x: ox + VG.num(c, 'X', 0), y: oy + VG.num(c, 'Y', 0), layer, removed: false, kind: 0 });
                    }
                });
            };
            walk(root2, 0, 0, 0);
            // painter's order: layer, then top to bottom, then left to right
            tiles.sort((a, b) => (a.layer - b.layer) || (a.y - b.y) || (a.x - b.x));
            tiles.forEach((t, i) => { t.i = i; });
            return tiles;
        }

        covers(a, b) {
            // a lies on b (a higher layer, overlapping its face)
            return a.layer > b.layer && Math.abs(a.x - b.x) < STEP_X - 2 && Math.abs(a.y - b.y) < STEP_Y - 2;
        }

        free(t, tiles) {
            const list = tiles || this.tiles;
            let left = false;
            let right = false;
            for (const o of list) {
                if (o === t || o.removed) continue;
                if (this.covers(o, t)) return false;
                if (o.layer === t.layer && Math.abs(o.y - t.y) < STEP_Y - 2) {
                    if (Math.abs(o.x - (t.x - STEP_X)) < 3) left = true;
                    if (Math.abs(o.x - (t.x + STEP_X)) < 3) right = true;
                }
            }
            return !(left && right);
        }

        // a deal that can be finished: pairs come off the full board, the reverse is the win
        deal(tiles) {
            const pairs = [];
            for (let f = 0; f < 34; f++) pairs.push([f, f], [f, f]);
            pairs.push([34, 35], [36, 37], [38, 39], [40, 41]);
            for (let attempt = 0; attempt < 200; attempt++) {
                const order = pairs.slice();
                for (let i = order.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [order[i], order[j]] = [order[j], order[i]];
                }
                tiles.forEach((t) => { t.removed = false; });
                let ok = true;
                for (const pair of order) {
                    const free = tiles.filter((t) => !t.removed && this.free(t, tiles));
                    if (free.length < 2) {
                        ok = false;
                        break;
                    }
                    const a = free.splice(Math.floor(Math.random() * free.length), 1)[0];
                    // the second of a pair is never the tile that alone frees the first
                    const b = free[Math.floor(Math.random() * free.length)];
                    a.kind = pair[0];
                    b.kind = pair[1];
                    a.removed = true;
                    b.removed = true;
                }
                if (ok) {
                    tiles.forEach((t) => { t.removed = false; });
                    return true;
                }
            }
            return false;
        }

        startLayout(index, sameDeal) {
            this.s.layout = index;
            this.saveSettings();
            this.layoutIndex = index;
            if (!sameDeal || !this.dealKinds) {
                this.tiles = this.loadLayout(index);
                this.deal(this.tiles);
                this.dealKinds = this.tiles.map((t) => t.kind);
            } else {
                this.tiles = this.loadLayout(index);
                this.tiles.forEach((t, i) => { t.kind = this.dealKinds[i]; });
            }
            this.mode = 'play';
            this.selected = null;
            this.hover = null;
            this.history = [];
            this.score = 0;
            this.time = 0;
            this.running = true;
            this.startedAt = VG.now();
            this.paused = false;
            this.moved = false;
            this.ending = false;
            this.hints = null;
            this.anims = [];
            this.sounds.play('SOUND_INTRO_DRAGON');
            this.updateStatus();
            this.win.stage.invalidate();
            if (this.s.tips && !this.introShown) {
                this.introShown = true;
                this.showTip(46484, 61462);
            }
        }

        showChooser() {
            this.mode = 'choose';
            this.running = false;
            this.selected = null;
            this.hideTip();
            if (this.s.tips) this.showTip(49370, 46221);
            this.updateStatus();
            this.win.stage.invalidate();
        }

        // ---- play ----
        remaining() {
            return this.tiles ? this.tiles.filter((t) => !t.removed) : [];
        }

        availableMatches() {
            const free = this.remaining().filter((t) => this.free(t));
            const groups = {};
            free.forEach((t) => { groups[group(t.kind)] = (groups[group(t.kind)] || 0) + 1; });
            return Object.values(groups).reduce((n, c) => n + Math.floor(c * (c - 1) / 2), 0);
        }

        tileAt(p) {
            const list = this.remaining();
            for (let i = list.length - 1; i >= 0; i--) {
                const t = list[i];
                if (p.x >= t.x && p.y >= t.y && p.x < t.x + 45 && p.y < t.y + 60) return t;
            }
            return null;
        }

        click(t) {
            if (this.ending || !t) return;
            if (!this.free(t)) {
                this.sounds.play('SOUND_ILLEGALMOVE');
                const covered = this.remaining().some((o) => this.covers(o, t));
                this.showTip(48093, covered ? 63212 : 59546);
                return;
            }
            if (!this.selected) {
                this.selected = t;
                this.sounds.play('SOUND_SELECT');
            } else if (this.selected === t) {
                this.selected = null;
            } else if (group(this.selected.kind) === group(t.kind)) {
                this.match(this.selected, t);
            } else {
                this.sounds.play('SOUND_NOMATCH');
                const g = group(this.selected.kind);
                this.showTip(53114, g === 'season' ? (this.s.tileset === 2 ? 47349 : 49866) : (g === 'flower' ? (this.s.tileset === 2 ? 52432 : 63262) : 57557));
                this.selected = t;
            }
            this.win.stage.invalidate();
        }

        match(a, b) {
            this.selected = null;
            this.hints = null;
            this.hintIndex = 0;
            this.moved = true;
            a.removed = true;
            b.removed = true;
            this.score += 2;
            this.flashScore = VG.now();
            this.history.push([a, b]);
            const fx = this.effects[TILESETS[this.s.tileset].effect];
            if (this.s.animations && fx.sprite) {
                [a, b].forEach((t) => {
                    const target = { frame: 0 };
                    this.anims.push({ fx, t, target, run: new VG.Animator(fx.spec, target) });
                    t.fading = VG.now();
                });
            }
            this.sounds.play(fx.sound);
            this.hideTip();
            this.updateStatus();
            if (!this.remaining().length) {
                this.ending = true;
                this.later(() => this.winGame(), this.s.animations ? 900 : 0);
                return;
            }
            if (this.remaining().every((t) => this.free(t)) && this.s.tips) this.showTip(58346, 50876);
            if (!this.availableMatches()) this.later(() => this.noMoreMatches(), 700);
        }

        undo() {
            if (this.ending || this.mode !== 'play') return;
            const pair = this.history.pop();
            if (!pair) return;
            pair.forEach((t) => { t.removed = false; t.fading = 0; });
            this.score = Math.max(0, this.score - 2);
            this.selected = null;
            this.sounds.play('SOUND_SELECT');
            this.updateStatus();
            this.win.stage.invalidate();
        }

        // Hint: the selected tile's match, or the next of the available pairs each time it is asked
        hint() {
            if (this.ending || this.mode !== 'play') return;
            const free = this.remaining().filter((t) => this.free(t));
            const pairs = [];
            for (let i = 0; i < free.length; i++) {
                for (let j = i + 1; j < free.length; j++) {
                    if (group(free[i].kind) === group(free[j].kind)) pairs.push([free[i], free[j]]);
                }
            }
            const sel = this.selected;
            if (sel) {
                const pair = pairs.find((pr) => pr.includes(sel));
                if (!pair) {
                    this.sounds.play('SOUND_NOMATCH');
                    this.showTip(64326, 53750);
                    return;
                }
                this.hints = { tiles: pair, until: VG.now() + 2500 };
                this.win.stage.invalidate();
                return;
            }
            if (!pairs.length) {
                this.sounds.play('SOUND_NOMATCH');
                this.showTip(59031, 50381);
                return;
            }
            this.hintIndex = ((this.hintIndex || 0) % pairs.length);
            this.hints = { tiles: pairs[this.hintIndex], until: VG.now() + 2500 };
            this.hintIndex += 1;
            this.win.stage.invalidate();
        }

        // right-click with every tile open: the board clears itself
        autoFinish() {
            if (this.ending || this.mode !== 'play') return;
            if (!this.remaining().every((t) => this.free(t))) return;
            const step = () => {
                const list = this.remaining();
                for (let i = 0; i < list.length; i++) {
                    for (let j = i + 1; j < list.length; j++) {
                        if (group(list[i].kind) === group(list[j].kind)) {
                            this.match(list[i], list[j]);
                            if (this.remaining().length) this.later(step, this.s.animations ? 160 : 0);
                            return;
                        }
                    }
                }
            };
            step();
        }

        // a timeout the window's close cancels (the win, auto finish, No More Moves)
        later(fn, ms) {
            const id = setTimeout(() => {
                this.timers = this.timers.filter((t) => t !== id);
                fn();
            }, ms);
            this.timers = (this.timers || []).concat(id);
        }

        noMoreMatches() {
            if (this.ending || this.mode !== 'play' || this.availableMatches() || this.win.dialogs.length || !this.remaining().length) return;
            const p = this.pack;
            this.sounds.play('SOUND_LOSE');
            VG.taskDialog({
                owner: this.win,
                title: p.string(928, 'No More Moves').trim(),
                instruction: p.string(909, 'There are no more matches. What do you want to do?').trim(),
                links: [VG.linkFromString(p.string(1068, '&End Game').trim(), 1), VG.linkFromString(p.string(1067).trim(), 2)]
            }).then((r) => {
                if (r === 1 && this.mode === 'play' && !this.ending) this.finish(false);
            });
        }

        // ---- win: fireworks ----
        winGame() {
            this.ending = true;
            this.time = this.elapsed();
            this.running = false;
            this.sounds.play('SOUND_WIN');
            const pk = this.pack;
            this.fireworks = {
                defs: [pk.sprite('UI\\Fireworks\\SparkleParticle.xml'), pk.sprite('UI\\Fireworks\\StreakParticle.xml'), pk.sprite('UI\\Fireworks\\BlobParticle.xml')],
                particles: [],
                next: VG.now() + 200,
                bursts: 0
            };
            VG.warmSprites(this.win.stage, pk, this.fireworks.defs);
            this.showTip(63813, 56582);
            this.win.stage.invalidate();
        }

        endFireworks(quiet) {
            if (!this.fireworks) return;
            this.fireworks = null;
            this.hideTip();
            this.finish(true, quiet);
        }

        // the window closed: timers stop, a win still in its fireworks counts, and the next open
        // starts on the layout screen (or offers the saved game)
        closed() {
            (this.timers || []).forEach((t) => clearTimeout(t));
            this.timers = [];
            clearTimeout(this.clockTimer);
            clearTimeout(this.flashTimer);
            if (this.fireworks) this.endFireworks(true);
            else if (this.ending && this.mode === 'play' && !this.remaining().length) {
                this.time = this.elapsed();
                this.finish(true, true);
            }
            this.ending = false;
            this.running = false;
            this.anims = [];
            this.tip = null;
            this.mode = 'choose';
        }

        // ---- clock ----
        elapsed() {
            if (!this.running || this.paused) return this.time;
            return this.time + (VG.now() - this.startedAt) / 1000;
        }

        setActive(active) {
            if (!this.running) return;
            if (!active && !this.paused) {
                this.time = this.elapsed();
                this.paused = true;
            } else if (active && this.paused) {
                this.paused = false;
                this.startedAt = VG.now();
            }
        }

        // ---- frame / draw ----
        frame(now) {
            let busy = false;
            const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0;
            this.lastFrame = now;
            this.anims = this.anims.filter((a) => {
                const alive = a.run.step(now);
                if (alive) busy = true;
                return alive;
            });
            if (this.tiles && this.tiles.some((t) => t.fading && now - t.fading < 500)) busy = true;
            if (this.hints) {
                if (now > this.hints.until) this.hints = null;
                else busy = true;
            }
            if (this.flashScore && now - this.flashScore < 1600) busy = true;
            const f = this.fireworks;
            if (f) {
                busy = true;
                if (now >= f.next && f.bursts < 30) {
                    f.bursts += 1;
                    f.next = now + 300 + Math.random() * 450;
                    const x = 100 + Math.random() * 600;
                    const y = 70 + Math.random() * 240;
                    for (let i = 0; i < 30; i++) {
                        const a = (i / 30) * Math.PI * 2;
                        const v = 130 + Math.random() * 120;
                        f.particles.push({ def: f.defs[i % 3], x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: now, life: 1000 + Math.random() * 400 });
                    }
                    this.sounds.play('SOUND_FIREWORKS_' + (1 + Math.floor(Math.random() * 3)));
                }
                f.particles = f.particles.filter((p) => now - p.born < p.life);
                f.particles.forEach((p) => {
                    p.vx *= 0.985;
                    p.vy = p.vy * 0.985 + 120 * dt;
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                });
                if (f.bursts >= 30 && !f.particles.length) this.endFireworks();
            }
            if (this.running && !this.paused) {
                const t = Math.floor(this.elapsed());
                if (t !== this.shownTime) {
                    this.shownTime = t;
                    this.updateStatus();
                }
                if (!busy) {
                    clearTimeout(this.clockTimer);
                    this.clockTimer = setTimeout(() => this.win.stage.invalidate(), 1000 - (this.elapsed() % 1) * 1000);
                }
            }
            if (this.tip && now - this.tip.shownAt > 9000 && !this.tip.sticky) this.tip = null;
            return busy;
        }

        draw() {
            const st = this.win.stage;
            const bg = this.backgrounds[this.s.background];
            if (this.mode === 'choose') {
                this.chooser.draw(st, { hot: this.hotButton, down: this.downButton });
                this.drawTip();
                return;
            }
            if (bg) st.sprite(bg, 0, 0);
            const now = VG.now();
            const tiles = this.tiles || [];
            const hinted = this.hints ? this.hints.tiles : [];
            const blink = this.hints && Math.floor((now - (this.hints.until - 2500)) / 300) % 2 === 0;
            let layer = -1;
            tiles.forEach((t) => {
                const fading = t.removed && t.fading && now - t.fading < 500;
                if (t.removed && !fading) return;
                const alpha = fading ? 1 - (now - t.fading) / 500 : 1;
                if (t.layer !== layer) layer = t.layer;
                st.sprite(this.shadow, t.x - 6, t.y - 6, { anim: 4, alpha: alpha * 0.9 });
                st.sprite(this.tileSprite, t.x, t.y, { anim: this.s.tileset, frame: t.kind, alpha });
                if (t === this.selected) st.sprite(this.highlight, t.x - 5, t.y - 5, { anim: 1 });
                else if ((hinted.includes(t) && blink) || (t === this.hover && this.free(t))) st.sprite(this.highlight, t.x - 5, t.y - 5, { anim: 2 });
            });
            this.anims.forEach((a) => {
                const s = a.fx.sprite;
                st.sprite(s, a.t.x + 22 - s.w / 2, a.t.y + 30 - s.h / 2, { frame: a.target.frame });
            });
            if (this.fireworks) {
                const ctx = st.ctx;
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                this.fireworks.particles.forEach((p) => {
                    const a = Math.max(0, 1 - (now - p.born) / p.life);
                    st.sprite(p.def, p.x - p.def.w / 4, p.y - p.def.h / 4, { alpha: a, w: p.def.w / 2, h: p.def.h / 2 });
                });
                ctx.restore();
            }
            this.drawTip();
        }

        // force: View Help shows How To Play with tips turned off too
        showTip(title, message, force) {
            if (!this.s.tips && !force) return;
            const str = (v) => (typeof v === 'number' ? (v ? this.pack.string(v) : '') : (v || ''));
            this.tip = { title: str(title).trim(), message: str(message).trim(), shownAt: VG.now() };
            this.win.stage.invalidate();
        }

        hideTip() {
            this.tip = null;
            this.win.stage.invalidate();
        }

        drawTip() {
            if (this.tip) this.tip.rect = VG.drawTip(this.win.stage, this.tipStyle, Object.assign({}, this.tip, { x: 2, bottom: H - 9, w: 212 }));
        }

        updateStatus() {
            if (!this.status) return;
            const p = this.pack;
            if (this.mode !== 'play') {
                [0, 1, 2, 3].forEach((i) => this.status.set(i, ''));
                return;
            }
            this.status.set(0, fmt(p.string(44945, 'Available Matches: %1!d!'), this.availableMatches()));
            this.status.set(1, fmt(p.string(63017, 'Tiles Remaining: %1!d!'), this.remaining().length));
            const flash = this.flashScore && VG.now() - this.flashScore < 1600;
            const cell = this.status.el.children[2];
            if (cell) cell.style.color = flash ? '#e00000' : '';
            this.status.set(2, fmt(p.string(56557, 'Score: %1!d!'), this.score));
            this.status.set(3, fmt(p.string(53625, 'Time: %1!d!'), Math.floor(this.elapsed())));
            if (flash) {
                clearTimeout(this.flashTimer);
                this.flashTimer = setTimeout(() => this.updateStatus(), 1650 - (VG.now() - this.flashScore));
            }
        }

        // ---- input ----
        wirePointer() {
            const surface = this.win.surface;
            const pos = (e) => {
                const r = surface.getBoundingClientRect();
                return this.win.stage.toNative(e.clientX - r.left, e.clientY - r.top);
            };
            surface.addEventListener('contextmenu', (e) => e.preventDefault());
            surface.addEventListener('pointermove', (e) => {
                const p = pos(e);
                if (this.mode === 'choose') {
                    const b = this.chooser.hit(p);
                    const name = b && /^Layout\dBtn$/.test(b.name) ? b.name : null;
                    if (name !== this.hotButton) {
                        this.hotButton = name;
                        this.win.stage.invalidate();
                    }
                    return;
                }
                const t = this.tileAt(p);
                if (t !== this.hover) {
                    this.hover = t;
                    this.win.stage.invalidate();
                }
            });
            surface.addEventListener('pointerdown', (e) => {
                surface.focus({ preventScroll: true });
                if (this.fireworks) {
                    this.endFireworks();
                    return;
                }
                const p = pos(e);
                if (e.button === 2) {
                    this.autoFinish();
                    return;
                }
                if (this.mode === 'choose') {
                    const b = this.chooser.hit(p);
                    if (b && /^Layout(\d)Btn$/.test(b.name)) {
                        this.downButton = b.name;
                        this.win.stage.invalidate();
                    }
                    return;
                }
                this.click(this.tileAt(p));
            });
            surface.addEventListener('pointerup', (e) => {
                if (this.mode !== 'choose' || !this.downButton) return;
                const b = this.chooser.hit(pos(e));
                const down = this.downButton;
                this.downButton = null;
                if (b && b.name === down) {
                    this.sounds.play('SOUND_CHOOSELAYOUT');
                    this.startLayout(Number(/^Layout(\d)Btn$/.exec(down)[1]) - 1);
                }
                this.win.stage.invalidate();
            });
        }

        // ---- results / menus ----
        stats(layout) {
            const all = store.get('stats', {});
            return Object.assign({ played: 0, won: 0, best: [] }, all[layout === undefined ? LAYOUTS[this.layoutIndex || 0].id : layout] || {});
        }

        // quiet: count the game without the Game Won dialog (the window closed)
        finish(won, quiet) {
            this.ending = false;
            this.running = false;
            const key = LAYOUTS[this.layoutIndex].id;
            const all = store.get('stats', {});
            const st = Object.assign({ played: 0, won: 0, best: [] }, all[key] || {});
            st.played += 1;
            if (won) {
                st.won += 1;
                st.best.push({ score: this.score, time: Math.floor(this.time), date: Date.now() });
                st.best.sort((a, b) => b.score - a.score || a.time - b.time);
                st.best = st.best.slice(0, 5);
            }
            all[key] = st;
            store.set('stats', all);
            store.remove('saved');
            if (quiet) return;
            if (!won) {
                this.showChooser();
                return;
            }
            const p = this.pack;
            const best = st.best[0];
            const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
            VG.dialog(p, 113, {
                owner: this.win,
                title: p.string(48566, 'Game Won'),
                texts: {
                    1069: p.string(41049, 'Congratulations! You won the game!').trim(),
                    1044: fmt(p.string(64858, 'Points: %1!d!'), this.score),
                    1045: 'Time: ' + fmt(p.string(63859, '%1!d! seconds'), Math.floor(this.time)),
                    1070: LAYOUTS[this.layoutIndex] ? p.string(LAYOUTS[this.layoutIndex].name) : '',
                    1048: fmt(p.string(64860, 'High score: %1!d!'), best ? best.score : 0),
                    1049: fmt(p.string(64861, 'Date: %1'), VG.formatDate(best ? best.date : Date.now())),
                    1050: fmt(p.string(51401, 'Games played: %1!d!'), st.played),
                    1051: fmt(p.string(64854, 'Games won: %1!d!'), st.won),
                    1052: fmt(p.string(54443, 'Win percentage: %1!d!%%'), pct)
                },
                closeOn: 'any',
                onClose: (r) => {
                    if (r === 1039) VG.closeWindow(this.win);
                    else if (r === 2) this.showChooser();
                    else this.startLayout(this.layoutIndex);
                }
            });
        }

        recordLoss() {
            if (!this.moved || this.mode !== 'play') return;
            const key = LAYOUTS[this.layoutIndex].id;
            const all = store.get('stats', {});
            const st = Object.assign({ played: 0, won: 0, best: [] }, all[key] || {});
            st.played += 1;
            all[key] = st;
            store.set('stats', all);
        }

        inProgress() {
            return this.mode === 'play' && this.moved && !this.ending;
        }

        menuState(id) {
            if (id === CMD.UNDO) return { disabled: this.mode !== 'play' || this.ending || !this.history || !this.history.length };
            if (id === CMD.HINT) return { disabled: this.mode !== 'play' || this.ending };
            return null;
        }

        command(id) {
            const p = this.pack;
            if (this.fireworks) this.endFireworks();
            switch (id) {
            case CMD.NEW: this.askNewGame(); break;
            case CMD.UNDO: this.undo(); break;
            case CMD.HINT: this.hint(); break;
            case CMD.STATS: this.showStats(); break;
            case CMD.OPTIONS: this.showOptions(); break;
            case CMD.APPEARANCE: this.showAppearance(); break;
            case CMD.EXIT: if (this.requestExit(true) !== false) VG.closeWindow(this.win); break;
            case CMD.ABOUT: VG.aboutBox({ owner: this.win, title: p.string(44419, 'Mahjong Titans'), text: p.string(920), icon: '/static_images/vista-games/icons/mahjong-48.png' }); break;
            case CMD.HELP: this.showTip(46484, 61462, true); break;
            default: break;
            }
        }

        // New Game: with a game in progress (a pair taken) it counts as a loss; on an untouched deal
        // the shorter New Game (a new deal of this layout or another layout); on the layout screen
        // nothing
        askNewGame() {
            if (this.mode !== 'play' || this.ending) return;
            const p = this.pack;
            const str = (id) => p.string(id).trim();
            const loss = this.inProgress();
            VG.taskDialog({
                owner: this.win,
                title: str(925),
                instruction: str(908),
                links: loss ? [
                    VG.linkFromString(str(915), 1),
                    VG.linkFromString(str(914), 2),
                    VG.linkFromString(str(917), 4),
                    VG.linkFromString(str(916), 3)
                ] : [
                    VG.linkFromString(str(912), 1),
                    VG.linkFromString(str(911), 4),
                    VG.linkFromString(str(916), 3)
                ]
            }).then((r) => {
                if (![1, 2, 4].includes(r) || this.mode !== 'play') return;
                if (loss) this.recordLoss();
                if (r === 1) this.startLayout(this.layoutIndex);
                else if (r === 2) this.startLayout(this.layoutIndex, true);
                else this.showChooser();
            });
        }

        requestExit(fromMenu) {
            if (!this.inProgress()) return true;
            const p = this.pack;
            if (this.s.saveOnExit) {
                this.saveGame();
                if (!fromMenu) VG.closeWindow(this.win);
                return fromMenu ? true : false;
            }
            VG.taskDialog({
                owner: this.win,
                title: p.string(6001, 'Exit Game'),
                instruction: p.string(6002, 'What do you want to do with the game in progress?'),
                buttons: [{ id: 1, text: p.string(6003, '&Save'), default: true }, { id: 2, text: p.string(6004, "&Don't save") }, { id: 3, text: p.string(6005, 'Cancel') }],
                check: { text: p.string(6022, 'Always save game on exit'), checked: this.s.saveOnExit },
                width: 440
            }).then((r) => {
                if (r.checked !== this.s.saveOnExit) {
                    this.s.saveOnExit = r.checked;
                    this.saveSettings();
                }
                if (r.id === 1) {
                    this.saveGame();
                    VG.closeWindow(this.win);
                } else if (r.id === 2) {
                    this.recordLoss();
                    store.remove('saved');
                    this.moved = false;
                    VG.closeWindow(this.win);
                }
            });
            return false;
        }

        saveGame() {
            store.set('saved', {
                layout: this.layoutIndex, kinds: this.dealKinds, removed: this.tiles.map((t) => (t.removed ? 1 : 0)),
                history: this.history.map((pair) => pair.map((t) => t.i)), score: this.score, time: this.elapsed()
            });
        }

        loadSaved(saved) {
            this.dealKinds = saved.kinds;
            this.startLayout(saved.layout, true);
            this.tiles.forEach((t, i) => { t.removed = !!saved.removed[i]; });
            this.history = (saved.history || []).map((pair) => pair.map((i) => this.tiles[i]));
            this.score = saved.score || 0;
            this.time = saved.time || 0;
            this.moved = true;
            this.startedAt = VG.now();
            store.remove('saved');
            this.updateStatus();
        }

        afterOpen() {
            const saved = store.get('saved', null);
            if (!saved) {
                this.showChooser();
                return;
            }
            if (this.s.continueSaved) {
                this.loadSaved(saved);
                return;
            }
            const p = this.pack;
            VG.taskDialog({
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
                if (r.id === 1) this.loadSaved(saved);
                else {
                    store.remove('saved');
                    this.showChooser();
                }
            });
        }

        showStats() {
            const p = this.pack;
            let current = LAYOUTS[this.layoutIndex || this.s.layout || 0].id;
            const fill = (dlg) => {
                const st = this.stats(current);
                const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
                dlg.text(1064, fmt(p.string(41281, 'Games played: %1!d!'), st.played));
                dlg.text(1065, fmt(p.string(64217, 'Games won: %1!d!'), st.won));
                dlg.text(1066, fmt(p.string(59156, 'Win percentage: %1!d!%%'), pct));
                [[1037, 1047, 1041], [1038, 1048, 1042], [1039, 1049, 1043], [1040, 1050, 1044], [1045, 1051, 1046]].forEach(([a, b, c], i) => {
                    const e = st.best[i];
                    dlg.text(a, e ? String(e.score) : '');
                    dlg.text(b, e ? fmt(p.string(63859, '%1!d! seconds'), e.time) : '');
                    dlg.text(c, e ? VG.formatDate(e.date) : '');
                });
            };
            VG.dialog(p, 108, {
                owner: this.win,
                title: fmt(p.string(56799, 'Mahjong Titans Statistics - %1'), VG.userName()),
                focus: 1063,
                init: (dlg) => {
                    dlg.setList(1063, LAYOUTS.map((L) => ({ value: L.id, text: p.string(L.name) })), current);
                    fill(dlg);
                },
                onCommand: (id, dlg, how) => {
                    if (id === 1063 && how === 'change') {
                        current = dlg.listValue(1063);
                        fill(dlg);
                        return false;
                    }
                    if (id === 1024) {
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

        showOptions() {
            const s = this.s;
            VG.dialog(this.pack, 105, {
                owner: this.win,
                init: (dlg) => {
                    dlg.checked(1010, s.animations);
                    dlg.checked(1009, s.sounds);
                    dlg.checked(1013, s.tips);
                    dlg.checked(1011, s.continueSaved);
                    dlg.checked(1071, s.saveOnExit);
                },
                onCommand: (id, dlg) => {
                    if (id !== 1) return true;
                    Object.assign(s, {
                        animations: dlg.checked(1010),
                        sounds: dlg.checked(1009),
                        tips: dlg.checked(1013),
                        continueSaved: dlg.checked(1011),
                        saveOnExit: dlg.checked(1071)
                    });
                    this.saveSettings();
                    this.sounds.enabled = s.sounds;
                    if (!s.tips) this.hideTip();
                    return true;
                }
            });
        }

        showAppearance() {
            const p = this.pack;
            let tileset = this.s.tileset;
            let bg = this.s.background;
            VG.dialog(p, 500, {
                owner: this.win,
                title: 'Change Appearance',
                texts: { 5002: p.string(62139, 'Select Tile Set'), 5003: p.string(62140, 'Select Background'), 5004: p.string(62141) },
                init: (dlg) => {
                    VG.fillThumbList(dlg.get(5000), TILESETS.map((t) => ({ text: p.string(t.name), img: p.imageUrl(t.thumb.replace(/\.png$/i, '')) })), tileset, (i) => { tileset = i; });
                    VG.fillThumbList(dlg.get(5001), BACKGROUNDS.map((b) => ({ text: p.string(b.name), img: p.imageUrl('UI\\Board\\Backgrounds\\' + b.file + 'Thumb') })), bg, (i) => { bg = i; });
                    dlg.checked(5004, !!this.s.randomLook);
                },
                onCommand: (id, dlg) => {
                    if (id !== 1) return true;
                    this.s.randomLook = dlg.checked(5004);
                    if (this.s.randomLook) {
                        tileset = Math.floor(Math.random() * TILESETS.length);
                        bg = Math.floor(Math.random() * BACKGROUNDS.length);
                    }
                    this.s.tileset = tileset;
                    this.s.background = bg;
                    this.saveSettings();
                    this.warm();
                    this.win.stage.invalidate();
                    return true;
                }
            });
        }
    }

    function open() {
        return VG.loadPack(GAME_ID).then((pack) => {
            if (!game) game = new Mahjong(pack);
            if (game.s.randomLook && !game.win.isOpen()) {
                game.s.tileset = Math.floor(Math.random() * TILESETS.length);
                game.s.background = Math.floor(Math.random() * BACKGROUNDS.length);
            }
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
        name: 'Mahjong Titans',
        icon: '/static_images/vista-games/icons/mahjong',
        thumbnail: '/static_images/vista-games/mahjong/images/rgmh_thumbnail_mahjong.png',
        feature: 'vista_mahjong',
        open
    });
    root.openVistaMahjong = open;
    // the rules for scripts/test-vista-games.js (layouts, free tiles, solvable deals)
    root.VistaMahjongRules = Mahjong.prototype;
    root.vistaMahjong = () => game;
})(typeof window !== 'undefined' ? window : globalThis);
