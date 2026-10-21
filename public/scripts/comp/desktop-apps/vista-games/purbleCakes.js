// Purble Place: Comfy Cakes, the bakery (Yozora #609). The layout is
// UI\ComfyCakes\ComfyCakesGame.xml: the factory (ComfyCakesBackground2.jpg), the order TV
// (CakeScreen: TVSprite, the order drawn at CakeX / CakeY, TVAnimation when an order comes in,
// the glass), the shipping monitor (ShippingSignBackground / ShippingSign / ScreenSlot), the belts
// (LeftConveyorBelt brings the wax papers in, MainConveyorBelt carries the cakes, RightBelt takes
// the boxes away), the star platform (ConveyorPlatform), the box (DroppingBox / CakeBox), the trash
// (TrashCan), the slide buttons and their highlights, the red light, and the six tools
// (Tools\*Tool.xml: the machine hanging over the belt, its falling / splat sprites, the buttons
// with their <Type>, which purbleRules.js cakeApply turns into a cake) and the chef's movies
// (Chef\Chef*Movie.xml: enter, idle, talk, leave, win, lose).
//
// Measured on the VM:
//   - the belt's stations are 97 px apart, the first at x 130 (y 249, the wax paper's centre); the
//     platform is the seventh. Beginner's four tools stand at stations 1-4 (pan, batter, icing,
//     decoration), Intermediate's five at 0-4 (+ filling), Advanced's six at 0-5 (+ final touch)
//   - Beginner: the belt moves only with the arrows, one cake at a time, a new order per cake;
//     Intermediate / Advanced (unless "One cake at a time"): after the first move the belt slides
//     a station every BeltSlideTime seconds (the gauge under the red light fills meanwhile) and a
//     new wax paper comes every NumSlidesToAddCake slides; one order for the batch
//   - a tool drops its part on the cake under it (the pan falls and squishes, batter pours, the
//     icing streams, the decorations drop); after a part the right arrow glows
//   - on the platform a good cake gets the box dropped on it and rides up the right belt (Cakes
//     Finished counts it, the monitor ticks a slot); a bad one goes in the trash
//   - the chef walks in when a tip comes up (the intro, a matched order) and leaves after it;
//     the status bar shows Cakes Finished (and Incorrect Cakes past Beginner)
//   - an empty paper does not move: the arrow shows GamePlayIdleStart and the pan machine glows;
//     one cake at a time, a wrong cake leaves the order on the TV
// From PurblePlace.exe (ComfyCakesGame): every press of a tool counts as a move (Tool::UseTool),
// the efficiency bonus is scored against CakesNeeded x the order's minimum, Beginner cannot lose
// on mistakes and Intermediate / Advanced lose when the incorrect cakes reach MissedCakesAllowed
// (CheckEndCondition); the Game Lost box hides the high score and its date until there is one.
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const PP = root.VistaPurble = root.VistaPurble || {};
    const SLOT_X = 130;
    const SLOT_DX = 97;
    const PAPER_Y = 249;
    const CAKE_Y = 258;
    const PLATFORM = 6;
    const SLIDE_MS = 500;
    // the tool panels (ComfyCakesGame.xml <Tools>), left to right
    const PANEL_X = [75, 173, 273, 373, 475, 588];
    const PANEL_Y = 298;
    // the cake pan machine hangs 30 px right of its XML spot on the VM
    const PAN_FUDGE = 30;
    // the balloon's box on the VM: 322, 403 - 664, 479
    const TIP_AT = { x: 322, bottom: 479, w: 342 };
    const TOOL_ORDER = ['CakePanTool', 'BatterTool', 'FillingTool', 'IcingTool', 'DecorationTool', 'FinalTouchTool'];
    // the stations each difficulty's tools stand at (index into TOOL_ORDER -> station)
    const STATIONS = [
        { CakePanTool: 1, BatterTool: 2, IcingTool: 3, DecorationTool: 4 },
        { CakePanTool: 0, BatterTool: 1, FillingTool: 2, IcingTool: 3, DecorationTool: 4 },
        { CakePanTool: 0, BatterTool: 1, FillingTool: 2, IcingTool: 3, DecorationTool: 4, FinalTouchTool: 5 }
    ];
    const SHAPES = ['Round', 'Rectangle', 'Heart'];
    const TV_SCALE = 0.8;

    class Cakes {
        constructor(pp) {
            this.pp = pp;
            this.id = 'cakes';
            const pack = this.pack = pp.pack;
            const R = PP.Rules;
            this.R = R;
            const doc = pack.xml('UI\\ComfyCakes\\ComfyCakesGame.xml');
            this.doc = doc;
            const at = (tag) => {
                const n = VG.child(doc, tag);
                const d = VG.child(n, 'Desc');
                return { x: VG.num(n, 'X', 0), y: VG.num(n, 'Y', 0), sprite: pack.sprite(VG.text(d, 'Sprite') || VG.text(d, 'Button')) };
            };
            this.back = pack.sprite(VG.text(doc, 'Background'));
            const screen = VG.child(VG.child(doc, 'CakeScreen'), 'Desc');
            const sub = (n, tag) => {
                const c = VG.child(n, tag);
                return { x: VG.num(c, 'X', 0), y: VG.num(c, 'Y', 0), sprite: pack.sprite(VG.text(VG.child(c, 'Desc'), 'Sprite')) };
            };
            this.tv = {
                back: pack.sprite(VG.text(screen, 'BackgroundSprite')),
                screen: sub(screen, 'ScreenSprite'),
                screenAnim: pack.xml(VG.text(screen, 'ScreenAnim')),
                glass: sub(screen, 'GlassSprite'),
                highlight: sub(screen, 'HighlightSprite'),
                cakeX: VG.num(screen, 'CakeX', 65),
                cakeY: VG.num(screen, 'CakeY', 104)
            };
            this.box = at('CakeBox');
            this.drop = at('DroppingBox');
            this.dropAnim = pack.xml(VG.text(doc, 'DroppingBoxAnim'));
            this.sign = at('ShippingSign');
            this.signBack = at('ShippingSignBackground');
            this.slot = at('ScreenSlot');
            this.redLight = at('RedLight');
            this.timerBack = pack.sprite('UI\\ComfyCakes\\TimerBackSprite.xml');
            this.timerBar = pack.sprite('UI\\ComfyCakes\\TimerBarSprite.xml');
            const belt = VG.child(doc, 'ConveyorBelt');
            const bx = VG.num(belt, 'X', 0);
            const by = VG.num(belt, 'Y', 220);
            const bd = VG.child(belt, 'Desc');
            const bsub = (tag) => {
                const s = sub(bd, tag);
                s.x += bx;
                s.y += by;
                return s;
            };
            this.mainBelt = bsub('MainBeltSprite');
            this.backWall = bsub('BackWall');
            this.leftBelt = bsub('LeftBeltSprite');
            this.rightBelt = at('RightBelt');
            this.trash = at('TrashCan');
            this.platform = at('ConveyorPlatform');
            this.home = at('ReturnToMainMenu');
            this.slideL = Object.assign(at('SlideLeftButton'), { hl: at('SlideLeftHighlightSprite') });
            this.slideR = Object.assign(at('SlideRightButton'), { hl: at('SlideRightHighlightSprite') });
            this.paper = pack.sprite('UI\\ComfyCakes\\WaxPaperSprite.xml');
            this.highlight = pack.sprite('UI\\ComfyCakes\\Machines\\ToolHighlightSprite.xml');
            // the layer sprites by tool type (Layers.xml: one <Layer> per type, three <Shape>s)
            this.layers = VG.children(pack.xml('UI\\ComfyCakes\\Layers.xml'), 'Layer').map((l) => {
                const shapes = VG.children(l, 'Shape');
                if (!shapes.length) return { delta: VG.num(l, 'Delta', 0), sprites: [pack.sprite(VG.text(l, 'Sprite'))] };
                return { delta: VG.num(shapes[0], 'Delta', 0), sprites: shapes.map((s) => pack.sprite(VG.text(s, 'Sprite'))) };
            });
            this.glaze = VG.children(pack.xml('UI\\ComfyCakes\\GlazeLayers.xml'), 'Layer').map((l) => VG.children(l, 'Shape').map((s) => pack.sprite(VG.text(s, 'Sprite'))));
            // the tools
            this.tools = {};
            VG.children(VG.child(doc, 'Tools'), 'Tool').forEach((t) => {
                const name = t.a && t.a.Name;
                const n = pack.xml(VG.text(t, 'Desc'));
                if (!name || !n) return;
                const part = (tag) => {
                    const c = VG.child(n, tag);
                    if (!c) return null;
                    return { x: VG.num(c, 'X', 0), y: VG.num(c, 'Y', 0), sprite: pack.sprite(VG.text(VG.child(c, 'Desc'), 'Sprite')) };
                };
                const anims = (tag) => VG.children(VG.child(n, tag), 'Anim').map((a) => pack.xml(VG.text(a).trim()));
                this.tools[name] = {
                    name,
                    action: part('ActionSprite'),
                    base: part('BaseSprite'),
                    falling: part('FallingSprite'),
                    fallingAnim: pack.xml(VG.text(n, 'FallingAnim').trim()),
                    splat: part('SplatSprite'),
                    stream: part('StreamSprite'),
                    actionAnims: anims('ActionAnims').concat(VG.text(n, 'ActionAnim') ? [pack.xml(VG.text(n, 'ActionAnim').trim())] : []),
                    buttons: VG.children(VG.child(n, 'Array'), 'ButtonTool').map((b) => {
                        const d = VG.child(b, 'Desc');
                        return { x: VG.num(b, 'X', 0), y: VG.num(b, 'Y', 0), type: VG.num(d, 'Type', 0), sprite: pack.sprite(VG.text(d, 'Button')) };
                    })
                };
            });
            this.chefMovies = {};
            const chef = VG.child(VG.child(doc, 'PurbleChef'), 'Desc');
            ['Enter', 'Leave', 'Idle', 'Talk', 'Win', 'Lose'].forEach((k) => {
                this.chefMovies[k.toLowerCase()] = PP.movie(pack, VG.text(chef, k + 'MoviePath'));
            });
            this.tips = PP.loadTips(pack, 'UI\\ComfyCakes\\ComfyCakesTips.xml');
            this.cakes = [];
            this.effects = [];
            this.active = true;
        }

        sprites() {
            const list = [this.back, this.tv.back, this.tv.screen.sprite, this.tv.glass.sprite, this.tv.highlight.sprite, this.box.sprite, this.drop.sprite,
                this.sign.sprite, this.signBack.sprite, this.slot.sprite, this.redLight.sprite, this.timerBack, this.timerBar, this.mainBelt.sprite,
                this.backWall.sprite, this.leftBelt.sprite, this.rightBelt.sprite, this.trash.sprite, this.platform.sprite, this.home.sprite,
                this.slideL.sprite, this.slideR.sprite, this.slideL.hl.sprite, this.slideR.hl.sprite, this.paper, this.highlight];
            this.layers.forEach((l) => list.push(...l.sprites));
            this.glaze.forEach((g) => list.push(...g));
            Object.values(this.tools).forEach((t) => {
                [t.action, t.base, t.falling, t.splat, t.stream].forEach((p) => { if (p) list.push(p.sprite); });
                t.buttons.forEach((b) => list.push(b.sprite));
            });
            Object.values(this.chefMovies).forEach((m) => { if (m) list.push(...m.sprites()); });
            return list.filter(Boolean);
        }

        warm() {
            return this.pp.warm(this.sprites());
        }

        get s() {
            return this.pp.s.cakes;
        }

        // ---- game ----
        begin(saved) {
            const d = saved && saved.difficulty !== undefined ? saved.difficulty : this.s.difficulty;
            this.diff = d;
            this.L = this.R.CAKE_LEVELS[d];
            this.batch = d > 0 && !(saved && saved.oneCake !== undefined ? saved.oneCake : this.s.oneCake);
            this.stations = STATIONS[d];
            this.cakes = [];
            this.effects = [];
            this.finished = 0;
            this.incorrect = 0;
            this.moves = 0;
            this.slides = 0;
            this.moved = false;
            this.over = false;
            this.slideAt = 0;
            this.slideDir = 0;
            this.nextSlide = 0;
            this.lastTick = VG.now();
            this.marks = [];
            this.shown = {};
            this.hintTool = null;
            // the timers a finished or left game must not act on
            this.gen = (this.gen || 0) + 1;
            this.res = null;
            if (saved) {
                Object.assign(this, { order: saved.order, finished: saved.finished, incorrect: saved.incorrect, moves: saved.moves, slides: saved.slides, marks: saved.marks || [] });
                this.cakes = saved.cakes.map((c) => ({ slot: c.slot, cake: c.cake, wrong: c.wrong }));
                this.moved = true;
                if (this.batch) this.startBelt();
            } else {
                this.newOrder();
                this.addPaper(true);
            }
            this.tvAt = VG.now();
            this.pp.playSound('CC_CAKEONTV');
            const first = !this.pp.s.cakesIntroShown;
            this.pp.s.cakesIntroShown = true;
            this.pp.saveSettings();
            if (!saved) this.tip((first ? 'GameStartFirst' : 'GameStartNext') + (this.batch ? 'B' : 'A'));
            this.pp.updateStatus();
        }

        newOrder() {
            this.order = this.R.cakeOrder(this.diff);
            this.tvAt = VG.now();
        }

        firstSlot() {
            return Math.min(...Object.values(this.stations));
        }

        addPaper(instant) {
            const slot = this.firstSlot();
            if (this.cakes.some((c) => c.slot === slot)) {
                this.lose('GameLoseLineClog');
                return;
            }
            this.cakes.push({ slot, cake: null, wrong: false, inAt: instant ? 0 : VG.now() });
            this.pp.playSound('CC_CONVEYOR');
            if (!instant) this.redAt = VG.now();
        }

        cakeAt(slot) {
            return this.cakes.find((c) => c.slot === slot && !c.leaving) || null;
        }

        stationOf(toolName) {
            return this.stations[toolName];
        }

        // a tool button: the part goes on the cake under the tool
        useTool(toolName, type) {
            if (this.over || this.sliding()) return;
            const tool = this.tools[toolName];
            const slot = this.stationOf(toolName);
            if (tool.busyUntil > VG.now()) {
                tool.shakeAt = VG.now();
                return;
            }
            // Tool::UseTool counts the press before it looks at the cake
            this.moves += 1;
            this.moved = true;
            const entry = this.cakeAt(slot);
            // no paper under the machine: only the pan says so (NeedWaxPaper)
            const r = !entry && this.R.kindOf(type) !== 'pan' ? { ok: false, tip: null } : this.R.cakeApply(entry ? entry.cake : null, type, !!entry);
            if (!r.ok) {
                this.pp.playSound('BAD_MOVE');
                tool.shakeAt = VG.now();
                if (r.tip) this.tip(r.tip);
                return;
            }
            this.pp.hideTip();
            if (this.batch && !this.nextSlide) this.startBelt();
            const kind = this.R.kindOf(type);
            this.pp.playSound({ pan: 'CC_CAKEPANBUTTON', batter: 'CC_CAKEBATTERBUTTON', filling: 'CC_CAKEFILLINGBUTTON', icing: 'CC_FROSTINGBUTTON', deco: 'CC_DECORATIONBUTTON', sugar: 'CC_SUGAR', glaze: 'CC_FLAME' }[kind] || 'CC_TOOLBUTTONS');
            const dur = 650;
            tool.busyUntil = VG.now() + dur;
            this.effects.push({ kind, tool, slot, type, shape: r.cake.shape, at: VG.now(), dur });
            setTimeout(() => {
                if (!this.cakes.includes(entry)) return;
                entry.cake = r.cake;
                if (!entry.wrong && !this.R.cakeOnTrack(entry.cake, this.order)) {
                    entry.wrong = true;
                    if (!this.shown.bad) {
                        this.shown.bad = true;
                        this.tip('GamePlayBadCakePart');
                    }
                }
                if (kind === 'filling' && !this.shown.filling && entry.cake.layers.length < this.order.layers.length) {
                    this.shown.filling = true;
                    this.tip('GamePlayFirstFilling');
                }
                if (this.R.cakeMatches(entry.cake, this.order) && !entry.told) {
                    entry.told = true;
                    if (!this.shown.matched) {
                        this.shown.matched = true;
                        this.tip('CakeMatchedOrder');
                    }
                }
                this.hintRight = VG.now();
                this.invalidate();
            }, dur * 0.6);
            this.invalidate();
        }

        // the automatic belt (a timer, not the frame loop: Engine.xml PauseOnLostFocus 0, the belt
        // keeps going while the window is inactive or hidden)
        startBelt() {
            clearTimeout(this.beltTimer);
            this.nextSlide = VG.now() + this.L.slide * 1000;
            const tick = () => {
                if (this.over || !this.batch || this.pp.mod !== this) return;
                this.slide(1, true);
                this.nextSlide = VG.now() + this.L.slide * 1000;
                this.beltTimer = setTimeout(tick, this.L.slide * 1000);
            };
            this.beltTimer = setTimeout(tick, this.L.slide * 1000);
        }

        sliding() {
            return this.slideAt && VG.now() - this.slideAt < SLIDE_MS;
        }

        // every cake moves one station (dir 1 right, -1 left)
        slide(dir, auto) {
            if (this.over || this.sliding()) return false;
            const live = this.cakes.filter((c) => !c.leaving);
            if (dir < 0 && live.some((c) => c.slot <= this.firstSlot())) {
                if (!auto) this.pp.playSound('BAD_MOVE');
                return false;
            }
            if (!live.length && !auto) return false;
            // VM: nothing on the papers yet - the belt stays, the pan machine glows
            if (!auto && !live.some((c) => c.cake && c.cake.shape >= 0)) {
                this.pp.playSound('BAD_MOVE');
                this.tip('GamePlayIdleStart');
                this.hintTool = 'CakePanTool';
                this.hintAt = VG.now();
                return false;
            }
            this.pp.playSound(dir > 0 ? 'RIGHT_BUTTON' : 'LEFT_BUTTON');
            this.pp.playSound('CC_CONVEYOR');
            this.pp.hideTip();
            this.slideAt = VG.now();
            this.slideDir = dir;
            live.forEach((c) => {
                c.from = c.slot;
                c.slot += dir;
            });
            this.hintRight = 0;
            if (!auto) this.moved = true;
            setTimeout(() => this.afterSlide(auto), SLIDE_MS);
            this.invalidate();
            return true;
        }

        afterSlide(auto) {
            if (this.over) return;
            this.cakes.filter((c) => !c.leaving && c.slot >= PLATFORM).forEach((c) => this.arrive(c));
            if (auto) {
                this.slides += 1;
                if (this.slides % this.L.slidesToAdd === 0) this.addPaper(false);
            }
            this.invalidate();
        }

        // a cake on the star platform: boxed and shipped, or trashed
        arrive(c) {
            c.leaving = true;
            c.leftAt = VG.now();
            const good = c.cake && this.R.cakeMatches(c.cake, this.order);
            if (good) {
                c.fate = 'box';
                this.finished += 1;
                this.marks.push(1);
                this.pp.playSound('CC_CORRECTCAKE');
                setTimeout(() => this.pp.playSound('CC_WONGAME'), 1100);
            } else {
                c.fate = 'trash';
                this.incorrect += 1;
                this.marks.push(2);
                this.pp.playSound('CC_BADCAKE');
                if (!this.shown.wrong && c.cake) {
                    this.shown.wrong = true;
                    this.tip('ContextualCakeWrong');
                }
            }
            this.signAt = VG.now();
            this.signGood = good;
            this.pp.updateStatus();
            const gen = this.gen;
            setTimeout(() => {
                if (gen !== this.gen) return;
                this.cakes = this.cakes.filter((k) => k !== c);
                if (this.over) return;
                if (this.finished >= this.L.needed) this.win();
                else if (this.diff > 0 && this.incorrect >= this.L.missed) this.lose('GameLoseTooMany');
                else if (!this.batch) {
                    if (good) {
                        this.newOrder();
                        this.pp.playSound('CC_CAKEONTV');
                    }
                    if (!this.cakes.length) this.addPaper(false);
                } else if (!this.cakes.some((k) => !k.leaving)) this.addPaper(false);
                this.invalidate();
            }, 2400);
        }

        win() {
            this.over = true;
            this.chef('win');
            const n = this.pp.s.cakesWins = (this.pp.s.cakesWins || 0) + 1;
            this.pp.saveSettings();
            this.tip(n === 1 ? 'GameWinFirst' + (this.batch ? 'B' : 'A') : 'GameWinNext' + (this.batch ? 'B' : 'A') + (1 + Math.floor(Math.random() * 3)));
            this.pp.playSound('CC_WONGAME');
            this.settle(true);
            this.later(() => this.finish(true), 3000);
        }

        // a timer for this game only (not after New Game, the town or closing the window)
        later(fn, ms) {
            const gen = this.gen;
            setTimeout(() => {
                if (gen === this.gen && this.pp.mod === this && this.pp.win.isOpen()) fn();
            }, ms);
        }

        lose(tipId) {
            if (this.over) return;
            this.over = true;
            this.chef('lose');
            this.tip(tipId);
            this.pp.playSound('CC_LOSTGAME');
            this.settle(false);
            this.later(() => this.finish(false), 3500);
        }

        // the score and the statistics, recorded as the game ends (the box comes after the movie)
        settle(won) {
            const pp = this.pp;
            const minMoves = this.L.needed * this.R.cakeMinMoves(this.order);
            const sc = this.R.cakeScore({ difficulty: this.diff, right: this.finished, wrong: this.incorrect, moves: this.moves, minMoves, singleCake: !this.batch });
            const st = pp.recordGame('cakes' + this.diff, { won, score: sc.final, avg: this.incorrect });
            this.moved = false;
            this.res = { won, sc, st };
            return this.res;
        }

        finish(won) {
            const p = this.pack;
            const pp = this.pp;
            const { sc, st } = this.res && this.res.won === won ? this.res : this.settle(won);
            const best = st.best[0];
            const pct = st.played ? Math.round(st.won * 100 / st.played) : 0;
            const avg = st.count ? Math.round(st.sum / st.count) : 0;
            const ranks = [170, 187, 188, 189, 190];
            const hide = best ? [] : [1082, 1085];
            if (won) {
                pp.endDialog(115, {
                    1133: p.string(ranks[sc.rank]),
                    1140: String(this.finished),
                    1141: String(sc.rightScore),
                    1142: String(this.incorrect),
                    1143: String(sc.wrongPenalty),
                    1144: String(sc.efficiency),
                    1098: PP.fmt(p.string(57409, 'Final Score: %1!d!'), sc.final),
                    1089: PP.fmt(p.string(47149, 'High score: %1!d!'), best ? best.score : sc.final),
                    1090: PP.fmt(p.string(50040, 'Average number of incorrect cakes: %1!d!'), avg),
                    1088: PP.fmt(p.string(41237, 'Games played: %1!d!'), st.played),
                    1126: PP.fmt(p.string(41532, 'Games won: %1!d!'), st.won),
                    1091: PP.fmt(p.string(41060, 'Win percentage: %1!d!%%'), pct),
                    1092: PP.fmt(p.string(44135, 'Date: %1'), VG.formatDate(best ? best.date : Date.now()))
                }, { menu: 1127, exit: 1100 });
            } else {
                pp.endDialog(113, {
                    1082: PP.fmt(p.string(47149, 'High score: %1!d!'), best ? best.score : 0),
                    1083: PP.fmt(p.string(50040, 'Average number of incorrect cakes: %1!d!'), avg),
                    1081: PP.fmt(p.string(41237, 'Games played: %1!d!'), st.played),
                    1129: PP.fmt(p.string(41532, 'Games won: %1!d!'), st.won),
                    1084: PP.fmt(p.string(41060, 'Win percentage: %1!d!%%'), pct),
                    1085: PP.fmt(p.string(44135, 'Date: %1'), VG.formatDate(best ? best.date : Date.now()))
                }, { menu: 1130, exit: 1070 }, hide);
            }
        }

        recordLoss() {
            if (!this.moved) return;
            this.pp.recordGame('cakes' + this.diff, { won: false, avg: this.incorrect });
            this.moved = false;
        }

        inProgress() {
            return this.moved && !this.over;
        }

        saveState() {
            return {
                difficulty: this.diff, oneCake: !this.batch, order: this.order, finished: this.finished, incorrect: this.incorrect, moves: this.moves, slides: this.slides,
                marks: this.marks, cakes: this.cakes.filter((c) => !c.leaving).map((c) => ({ slot: c.slot, cake: c.cake, wrong: c.wrong }))
            };
        }

        leave() {
            this.over = true;
            this.gen = (this.gen || 0) + 1;
            clearTimeout(this.beltTimer);
            this.chefState = null;
            this.pp.hideTip();
        }

        setActive(active) {
            this.active = active;
        }

        // ---- the chef ----
        chef(name) {
            const m = this.chefMovies[name];
            if (!m) return;
            if (name === 'enter') this.pp.playSound('CC_CHEFENTER');
            if (name === 'leave') this.pp.playSound('CC_CHEFEXIT');
            this.chefState = { name, movie: m, at: VG.now() };
        }

        tip(id) {
            const t = this.tips[id];
            if (!t || !this.pp.s.tips) return;
            this.pp.showTip(t, TIP_AT);
            if (!this.chefState || this.chefState.name === 'leave') this.chef('enter');
            else if (this.chefState.name === 'idle') this.chef('talk');
        }

        helpTip() {
            this.tip('GameStartFirst' + (this.batch ? 'B' : 'A'));
        }

        // ---- status ----
        statusTexts() {
            const p = this.pack;
            const L = this.L || this.R.CAKE_LEVELS[0];
            return ['', PP.fmt(p.string(54274, 'Cakes Finished: %1!d!/%2!d!'), this.finished || 0, L.needed),
                this.diff > 0 ? PP.fmt(p.string(45400, 'Incorrect Cakes: %1!d!/%2!d!'), this.incorrect || 0, L.missed) : ''];
        }

        invalidate() {
            this.pp.win.stage.invalidate();
        }

        // ---- frame ----
        frame() {
            const now = VG.now();
            let busy = true;
            // the chef: enter -> talk while the tip is up -> leave; win / lose stay
            const cs = this.chefState;
            if (cs) {
                const done = now - cs.at >= cs.movie.duration;
                if (cs.name === 'enter' && done) this.chef(this.pp.tip ? 'talk' : 'idle');
                else if ((cs.name === 'talk' || cs.name === 'idle') && !this.pp.tip && !this.over && now - cs.at > 600) this.chef('leave');
                else if (cs.name === 'talk' && done) this.chef(this.pp.tip ? 'talk' : 'idle');
                else if (cs.name === 'leave' && done) this.chefState = null;
            }
            this.effects = this.effects.filter((e) => now - e.at < e.dur + 400);
            return busy;
        }

        // ---- draw ----
        slotX(slot) {
            return SLOT_X + SLOT_DX * slot;
        }

        // a cake built up from the pan at x / y
        drawCake(st, cake, x, y, alpha) {
            if (!cake || cake.shape < 0) return;
            const s = cake.shape;
            const L = this.layers;
            const o = { alpha: alpha === undefined ? 1 : alpha };
            let cy = y;
            const pan = L[3 + s];
            if (pan) st.sprite(pan.sprites[0], x, cy, o);
            cy += pan ? pan.delta : -4;
            cake.layers.forEach((flavor, i) => {
                const b = L[flavor];
                st.sprite(b.sprites[s], x, cy, o);
                cy += b.delta;
                if (i < cake.fillings.length) {
                    const f = L[10 + cake.fillings[i]];
                    st.sprite(f.sprites[s], x, cy, o);
                    cy += f.delta;
                }
            });
            // the next layer's pan, waiting for its batter
            if (cake.pan && cake.layers.length && pan) st.sprite(pan.sprites[0], x, cy, o);
            const glaze = cake.final === 'glaze' || cake.final === 'both';
            if (cake.icing >= 0) {
                const ic = L[15 + cake.icing];
                st.sprite(ic.sprites[s], x, cy, o);
                if (glaze && this.glaze[cake.icing]) st.sprite(this.glaze[cake.icing][s], x, cy, o);
            }
            if (cake.final === 'sugar' || cake.final === 'both') st.sprite(L[14].sprites[s], x, cy, o);
            if (cake.deco >= 0) {
                const d = L[6 + cake.deco].sprites[0];
                st.sprite(d, x + 4, cy - (s === 2 ? 8 : 10), o);
            }
        }

        // where a cake on the belt is now (sliding between stations)
        cakePos(c, now) {
            let slot = c.slot;
            if (c.from !== undefined && this.slideAt && now - this.slideAt < SLIDE_MS) {
                const k = (now - this.slideAt) / SLIDE_MS;
                slot = c.from + (c.slot - c.from) * k;
            }
            let x = this.slotX(Math.min(slot, PLATFORM));
            let y = PAPER_Y;
            // a new paper slides down the left belt onto the first station
            if (c.inAt && now - c.inAt < 600) {
                const k = (now - c.inAt) / 600;
                x -= 32 * (1 - k);
                y -= 68 * (1 - k);
            }
            return { x, y };
        }

        draw(st) {
            const now = VG.now();
            if (this.back) st.sprite(this.back, 0, 0);
            const sliding = this.sliding();
            const beltFrame = sliding ? Math.floor((now - this.slideAt) / SLIDE_MS * 10) % 10 : 0;
            // the left belt runs down behind the TV
            if (this.leftBelt.sprite) st.sprite(this.leftBelt.sprite, this.leftBelt.x, this.leftBelt.y, { frame: this.cakes.some((c) => c.inAt && now - c.inAt < 600) ? Math.floor((now % 500) / 500 * 8) : 0 });
            this.drawTV(st, now);
            this.drawSign(st, now);
            if (this.backWall.sprite) st.sprite(this.backWall.sprite, this.backWall.x, this.backWall.y);
            this.drawBoxRide(st, now);
            this.drawMachines(st, now);
            const mb = this.mainBelt;
            if (mb.sprite) {
                for (let i = 0; i < 7; i++) st.sprite(mb.sprite, mb.x + i * SLOT_DX, mb.y, { anim: i === 6 ? 1 : 0, frame: beltFrame });
            }
            if (this.platform.sprite) {
                const pf = this.signAt && now - this.signAt < 1200 ? Math.min(8, Math.floor((now - this.signAt) / 1200 * 9)) : 0;
                st.sprite(this.platform.sprite, this.platform.x, this.platform.y, { frame: pf });
            }
            this.cakes.forEach((c) => this.drawEntry(st, c, now));
            this.drawEffects(st, now);
            this.drawTools(st, now);
            this.drawSlides(st, now);
            this.drawLight(st, now);
            if (this.chefState) {
                const cs = this.chefState;
                const loop = cs.name === 'idle' || cs.name === 'talk' || cs.name === 'lose' || cs.name === 'win';
                cs.movie.draw(st, cs.movie.frameAt(now - cs.at, loop), 0, 0);
            }
            if (this.home.sprite) st.sprite(this.home.sprite, this.home.x, this.home.y, { anim: this.hot === 'home' ? (this.down === 'home' ? 2 : 1) : 0 });
        }

        drawTV(st, now) {
            const tv = this.tv;
            if (tv.back) st.sprite(tv.back, 0, 0);
            const t = now - (this.tvAt || 0);
            // the screen (TVAnimationSprite); a new order shows after its 2.06 s TVAnimationAnim
            if (tv.screen.sprite) st.sprite(tv.screen.sprite, tv.screen.x, tv.screen.y, { frame: t < 2060 ? Math.floor(t / 2060 * 16) : 0 });
            if (t >= 2060 && this.order) {
                const o = this.order;
                const cake = { shape: o.shape, pan: false, layers: o.layers, fillings: o.fillings, icing: o.icing, deco: o.deco, final: o.final };
                // the TV shows the order at 80 %, 10 px under CakeY (VM: the heart is 68 px wide there, 85
                // on the belt)
                const ctx = st.ctx;
                ctx.save();
                ctx.translate(tv.cakeX + 2, tv.cakeY + 10);
                ctx.scale(TV_SCALE, TV_SCALE);
                this.drawCake(st, cake, 0, 0);
                ctx.restore();
            }
            if (tv.glass.sprite) st.sprite(tv.glass.sprite, tv.glass.x, tv.glass.y);
            if (t >= 2060 && t < 4060 && tv.highlight.sprite) {
                const a = Math.abs(Math.sin((t - 2060) / 250 * Math.PI / 2));
                st.sprite(tv.highlight.sprite, tv.highlight.x, tv.highlight.y, { alpha: a });
            }
        }

        drawSign(st, now) {
            if (this.signBack.sprite) st.sprite(this.signBack.sprite, this.signBack.x, this.signBack.y);
            if (this.sign.sprite) {
                const t = this.signAt ? now - this.signAt : Infinity;
                if (t < 2000) st.sprite(this.sign.sprite, this.sign.x, this.sign.y, { anim: this.signGood ? 0 : 1, frame: this.signGood ? Math.floor(t / 167) % 3 : Math.min(2, Math.floor(t / 200)) });
                else st.sprite(this.sign.sprite, this.sign.x, this.sign.y);
            }
            const L = this.L || this.R.CAKE_LEVELS[0];
            if (this.slot.sprite) {
                for (let i = 0; i < L.needed; i++) {
                    const mark = this.marks.filter((m) => m === 1)[i] ? 1 : 0;
                    st.sprite(this.slot.sprite, this.slot.x + 20 * (i % 4), this.slot.y + 28 * Math.floor(i / 4) + 4, { frame: mark });
                }
            }
        }

        drawEntry(st, c, now) {
            const p = this.cakePos(c, now);
            if (!c.leaving) {
                st.sprite(this.paper, p.x, p.y);
                this.drawCake(st, c.cake, p.x, CAKE_Y + (p.y - PAPER_Y));
                return;
            }
            const t = now - c.leftAt;
            if (c.fate === 'box') {
                // the box drops over the cake on the platform (16 frames, 1.07 s), then rides away
                if (t < 1070) {
                    st.sprite(this.paper, p.x, p.y);
                    this.drawCake(st, c.cake, p.x, CAKE_Y);
                    if (this.drop.sprite) {
                        const f = Math.min(15, Math.floor(t / 1070 * 16));
                        st.sprite(this.drop.sprite, this.drop.x, this.drop.y, { anim: Math.floor(f / 4), frame: f % 4 });
                    }
                }
                return;
            }
            // the trash: the cake leaves the platform into the can
            const k = Math.min(1, t / 1000);
            if (k < 1) {
                st.sprite(this.paper, p.x + 60 * k, p.y + 70 * k, { alpha: 1 - k });
                this.drawCake(st, c.cake, p.x + 60 * k, CAKE_Y + 70 * k, 1 - k);
            }
            if (this.trash.sprite && t < 2200) {
                const f = Math.min(12, Math.floor(t / 2200 * 13));
                const counts = [4, 3, 3, 3];
                let anim = 0;
                let frame = f;
                while (anim < 3 && frame >= counts[anim]) {
                    frame -= counts[anim];
                    anim += 1;
                }
                st.sprite(this.trash.sprite, this.trash.x, this.trash.y, { anim, frame: Math.min(frame, counts[anim] - 1) });
            }
        }

        drawBoxRide(st, now) {
            if (this.rightBelt.sprite) {
                const riding = this.cakes.some((c) => c.fate === 'box' && now - c.leftAt >= 1070);
                st.sprite(this.rightBelt.sprite, this.rightBelt.x, this.rightBelt.y, { frame: riding ? Math.floor((now % 700) / 700 * 9) : 0 });
            }
            this.cakes.forEach((c) => {
                if (c.fate !== 'box') return;
                const t = now - c.leftAt - 1070;
                if (t < 0 || !this.box.sprite) return;
                const k = Math.min(1, t / 1400);
                st.sprite(this.box.sprite, this.box.x + 128 * k, this.box.y - 272 * k);
            });
        }

        machineX(tool, part) {
            const slot = this.stationOf(tool.name);
            return PANEL_X[slot] + part.x + (tool.name === 'CakePanTool' && part === tool.action ? PAN_FUDGE : 0);
        }

        drawMachines(st, now) {
            Object.values(this.tools).forEach((tool) => {
                if (this.stationOf(tool.name) === undefined) return;
                const shake = tool.shakeAt && now - tool.shakeAt < 200 ? Math.round(Math.sin((now - tool.shakeAt) / 200 * Math.PI * 4) * 6) : 0;
                [tool.base, tool.action].forEach((part) => {
                    if (!part || !part.sprite) return;
                    if (tool.name === 'FinalTouchTool' && part === tool.action) return;
                    // the final-touch machine's body is its base sprite's third animation (the
                    // first two are empty), turning (FinalTouchMachineRotationAnim) while it works
                    let opts;
                    if (tool.name === 'FinalTouchTool') {
                        const busy = tool.busyUntil && now < tool.busyUntil;
                        opts = { anim: 2, frame: busy ? Math.floor((now % 500) / 500 * 6) : 0 };
                    }
                    st.sprite(part.sprite, this.machineX(tool, part) + shake, PANEL_Y + part.y, opts);
                });
            });
        }

        drawEffects(st, now) {
            this.effects.forEach((e) => {
                const t = now - e.at;
                const k = Math.min(1, t / e.dur);
                const tool = e.tool;
                const cx = this.slotX(e.slot);
                const panelX = PANEL_X[e.slot];
                switch (e.kind) {
                case 'pan':
                    if (tool.falling && tool.falling.sprite && k < 1) st.sprite(tool.falling.sprite, cx, CAKE_Y - 20 * (1 - k) + 4, { anim: e.shape, frame: Math.floor(k * 6) });
                    break;
                case 'batter':
                    if (tool.falling && tool.falling.sprite && k < 1) st.sprite(tool.falling.sprite, panelX + tool.falling.x, PANEL_Y + tool.falling.y, { anim: e.type - this.R.T.BATTER, frame: Math.floor(k * 8) });
                    break;
                case 'icing':
                    if (tool.stream && tool.stream.sprite && k < 0.7) st.sprite(tool.stream.sprite, panelX + tool.stream.x, PANEL_Y + tool.stream.y, { anim: e.type - this.R.T.ICING, frame: Math.floor(t / 125) % 4 });
                    if (tool.splat && tool.splat.sprite && k > 0.4 && k < 1) st.sprite(tool.splat.sprite, panelX + tool.splat.x, PANEL_Y + tool.splat.y - 24, { anim: e.type - this.R.T.ICING, frame: Math.floor((k - 0.4) / 0.6 * 6) });
                    break;
                case 'filling':
                    if (tool.splat && tool.splat.sprite && k < 1) st.sprite(tool.splat.sprite, panelX + tool.splat.x, PANEL_Y + tool.splat.y, { anim: e.type - this.R.T.FILLING, frame: Math.floor(k * 5) });
                    break;
                case 'deco':
                    if (tool.falling && tool.falling.sprite && k < 1) st.sprite(tool.falling.sprite, cx - 14, 150 + 100 * k, { anim: [1, 3, 0, 2][e.type - this.R.T.DECO] || 0, frame: Math.floor(k * 10) % 10 });
                    break;
                case 'sugar':
                case 'glaze':
                    if (tool.action && tool.action.sprite && k < 1) {
                        const anim = e.kind === 'sugar' ? 1 : 0;
                        const count = tool.action.sprite.anims[anim] ? tool.action.sprite.anims[anim].count : 10;
                        st.sprite(tool.action.sprite, panelX + tool.action.x, PANEL_Y + tool.action.y, { anim, frame: Math.floor(k * count) });
                    }
                    break;
                default: break;
                }
            });
        }

        drawTools(st, now) {
            Object.values(this.tools).forEach((tool) => {
                const slot = this.stationOf(tool.name);
                if (slot === undefined) return;
                const px = PANEL_X[slot];
                tool.buttons.forEach((b) => {
                    if (!b.sprite) return;
                    const id = tool.name + ':' + b.type;
                    let anim = 0;
                    if (this.down === id && this.hot === id) anim = 2;
                    else if (this.hot === id) anim = 1;
                    st.sprite(b.sprite, px + b.x, PANEL_Y + b.y, { anim: Math.min(anim, b.sprite.anims.length - 1) });
                });
                // the idle hint: the tool the first cake needs next blinks
                if (this.hintTool === tool.name && this.highlight) {
                    const a = Math.abs(Math.sin((now - this.hintAt) / 500 * Math.PI));
                    st.sprite(this.highlight, px - 28 + 28, PANEL_Y - 14 + 14, { alpha: a });
                }
            });
        }

        drawSlides(st, now) {
            [['left', this.slideL], ['right', this.slideR]].forEach(([name, b]) => {
                if (!b.sprite) return;
                let anim = 0;
                if (this.down === name && this.hot === name) anim = 2;
                else if (this.hot === name) anim = 1;
                st.sprite(b.sprite, b.x, b.y, { anim: Math.min(anim, b.sprite.anims.length - 1) });
            });
            if (this.hintRight && this.slideR.hl.sprite && !this.batch) {
                const a = Math.abs(Math.sin((now - this.hintRight) / 500 * Math.PI));
                st.sprite(this.slideR.hl.sprite, this.slideR.hl.x, this.slideR.hl.y, { alpha: a });
            }
        }

        drawLight(st, now) {
            if (this.diff === 0) return;
            if (this.redLight.sprite) {
                const on = this.redAt && now - this.redAt < 1500 ? Math.floor((now - this.redAt) / 250) % 2 : 0;
                st.sprite(this.redLight.sprite, this.redLight.x, this.redLight.y, { frame: on });
            }
            // the gauge fills until the next slide
            if (this.timerBack) st.sprite(this.timerBack, 0, 330);
            if (this.timerBar && this.batch && this.nextSlide) {
                const left = Math.max(0, this.nextSlide - now) / (this.L.slide * 1000);
                const n = Math.round((1 - left) * 6);
                for (let i = 0; i < n; i++) st.sprite(this.timerBar, 16 + i * 6, 345);
            }
        }

        // ---- input ----
        hitAt(p) {
            const inBox = (x, y, def) => def && p.x >= x - def.regX && p.y >= y - def.regY && p.x < x - def.regX + def.w && p.y < y - def.regY + def.h;
            if (inBox(this.home.x, this.home.y, this.home.sprite)) return 'home';
            if (inBox(this.slideL.x, this.slideL.y, this.slideL.sprite)) return 'left';
            if (inBox(this.slideR.x, this.slideR.y, this.slideR.sprite)) return 'right';
            for (const tool of Object.values(this.tools)) {
                const slot = this.stationOf(tool.name);
                if (slot === undefined) continue;
                for (const b of tool.buttons) {
                    if (inBox(PANEL_X[slot] + b.x, PANEL_Y + b.y, b.sprite)) return tool.name + ':' + b.type;
                }
            }
            return null;
        }

        pointer(type, p) {
            const hit = type === 'leave' ? null : this.hitAt(p);
            if (type === 'move' || type === 'leave') {
                if (hit !== this.hot) {
                    this.hot = hit;
                    this.invalidate();
                }
                return;
            }
            if (type === 'down') {
                this.down = hit;
                this.invalidate();
                return;
            }
            if (type !== 'up') return;
            const down = this.down;
            this.down = null;
            this.invalidate();
            if (!down || down !== hit) return;
            this.hintTool = null;
            if (down === 'home') {
                this.pp.playSound('UI_BUTTON');
                this.pp.askMainMenu();
            } else if (down === 'left') this.slide(-1, false);
            else if (down === 'right') {
                if (this.slide(1, false) && this.batch && !this.nextSlide) this.startBelt();
            } else {
                const [tool, type2] = down.split(':');
                this.pp.playSound('CC_TOOLBUTTONS');
                this.useTool(tool, Number(type2));
            }
        }
    }

    PP.Cakes = Cakes;
    PP.CAKE_SHAPES = SHAPES;
    PP.CAKE_TOOLS = TOOL_ORDER;
})(typeof window !== 'undefined' ? window : globalThis);
