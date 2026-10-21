// Purble Place: Purble Shop, the store (Yozora #609). The layout is
// UI\BuildAPurble\BuildAPurbleGame.xml over the blue game screen (UI\GameScreen.png): the shop
// (Background.png), the curtain hiding the purble to guess (Curtain: 16 frames, the "?" mystery
// head behind it, HiddenPurble at 42 %), the spotlights, the cabinet (Cabinet\Cabinet.xml: the
// colour stones on top and a shelf per feature by difficulty, each item a FaceFeatureButton with
// its shelf tag), the guess button (GuessButton, with its idle animation), the count box
// (ColorCountWidget: green = right colour on the right feature, red = right colour on a wrong one,
// Advanced only), the purble you dress (GuessPurble, PurbleFaceTemplate1-8: Body, Head and the
// features at their offsets) and the history window (six slots: thermometer, the face at 35 %, the
// counts at 50 %), and the win movie (Win\Animation.xml).
//
// Measured on the VM: the game opens with the curtain drawn back on the "?" and the bald purble on
// the stage; clicking a shelf item puts it on the purble (and draws the curtain); the check button
// scores the look: the count box shows the number, the look goes into the history window, Guesses
// counts up in the status bar (both panes flash red as they change), and when none of the features
// is right their shelf tags get the red X; the check button stays dimmed until the look changes.
// From PurblePlace.exe (BuildAPurbleGame::MakeGuess): only Beginner marks the tags after a guess
// (a right feature: the green check on it, the red X on its other colours; a wrong one: the red X
// on the colour tried); Constants.xml's RemoveFirstFeature / RemoveNextFeature are not read by the
// game; SwappedColors comes when every colour is right but not every feature (Advanced).
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const PP = root.VistaPurble = root.VistaPurble || {};
    const SHELF_NAMES = { Eye: 'Eye', Nose: 'Nose', Mouth: 'Mouth', Hair: 'Hair', Accessory: 'Accessory' };
    const DIFF = ['Beginner', 'Intermediate', 'Advanced'];
    // the template's feature names (Extras = the outfit)
    const TEMPLATE_NAME = { Eye: 'Eye', Nose: 'Nose', Mouth: 'Mouth', Hair: 'Hair', Accessory: 'Extras' };
    // drawing order on the face (the template's order)
    const FACE_ORDER = ['Accessory', 'Head', 'Eye', 'Mouth', 'Nose', 'Hair'];
    // the balloon's box on the VM: 194, 50 - 408, 167
    const TIP_AT = { x: 194, bottom: 167, w: 214 };

    class Shop {
        constructor(pp) {
            this.pp = pp;
            this.id = 'shop';
            const pack = this.pack = pp.pack;
            this.R = PP.Rules;
            const doc = pack.xml('UI\\BuildAPurble\\BuildAPurbleGame.xml');
            this.doc = doc;
            this.nodes = new PP.Nodes(pack, doc);
            const named = (name) => VG.children(doc).find((n) => n.a && n.a.Name === name) || null;
            const pos = (name) => {
                const n = named(name);
                return { x: VG.num(n, 'X', 0), y: VG.num(n, 'Y', 0), n, desc: VG.child(n, 'Desc') };
            };
            // the blue game screen (UI\GameScreen.png) has no sprite XML: one in its place
            this.screenSprite = VG.spriteFromNode({ a: { Type: 'Sprite' }, c: [
                { t: 'SourceWidth', v: '800' }, { t: 'SourceHeight', v: '496' },
                { t: 'Animation', c: [{ t: 'Texture', v: 'UI\\GameScreen.png' }, { t: 'FrameCount', v: '1' }, { t: 'FramesPerRow', v: '1' }] }
            ] }, pack);
            this.background = pack.sprite('UI\\BuildAPurble\\Background.xml');
            // the curtain and its rod, the question mark, the spotlights
            const cur = pos('Curtain');
            this.curtain = { x: cur.x, y: cur.y, sprite: pack.sprite(VG.text(cur.desc, 'Sprite')) };
            const q = VG.child(cur.desc, 'QuestionMark');
            this.question = { x: VG.num(q, 'X', 101), y: VG.num(q, 'Y', 102), sprite: pack.sprite(VG.text(q, 'Sprite') || VG.text(VG.child(q, 'Desc'), 'Sprite')) };
            this.hidden = pos('HiddenPurble');
            this.hidden.scale = VG.num(this.hidden.n, 'Scale', 42) / 100;
            this.guessFace = pos('GuessPurble');
            this.guessFace.scale = VG.num(this.guessFace.n, 'Scale', 100) / 100;
            const gb = pos('GuessButton');
            this.guessBtn = { x: gb.x, y: gb.y, sprite: pack.sprite(VG.text(gb.desc, 'Button')), idle: pack.sprite(VG.text(gb.desc, 'Sprite')) };
            const cc = pos('ColorCountWidget');
            this.count = { x: cc.x, y: cc.y };
            const tpl = pack.xml('UI\\BuildAPurble\\ColorCountTemplate.xml');
            const tpart = (tag) => {
                const n = VG.child(tpl, tag);
                return { x: VG.num(n, 'X', 0), y: VG.num(n, 'Y', 0), w: VG.num(n, 'W', 0), h: VG.num(n, 'H', 0), desc: VG.child(n, 'Desc') };
            };
            this.countParts = { simple: tpart('RCRFSpriteSimple'), rcrf: tpart('RCRFSprite'), rcwf: tpart('RCWFSprite'), rcrfLabel: tpart('RCRFLabel'), rcwfLabel: tpart('RCWFLabel') };
            this.green = pack.sprite('UI\\BuildAPurble\\GreenNumbers.xml');
            this.red = pack.sprite('UI\\BuildAPurble\\RedNumbers.xml');
            // the history window
            const hw = pack.xml('UI\\BuildAPurble\\HistoryWindow\\HistoryWindow.xml');
            this.historyWin = {
                slots: VG.children(hw, 'HistorySlot').map((s) => ({ x: VG.num(s, 'X', 0), y: VG.num(s, 'Y', 0) })),
                left: { x: 36, y: 393, sprite: pack.sprite('UI\\BuildAPurble\\HistoryWindow\\GreenArrowSpriteLeft.xml') },
                right: { x: 741, y: 393, sprite: pack.sprite('UI\\BuildAPurble\\HistoryWindow\\GreenArrowSpriteRight.xml') },
                thermo: pack.sprite('UI\\BuildAPurble\\HistoryWindow\\Thermometer.xml')
            };
            const hb = (n, tag) => {
                const b = VG.children(hw).find((c) => c.a && c.a.Name === n);
                return b ? { x: VG.num(b, 'X', 0), y: VG.num(b, 'Y', 0) } : null;
            };
            Object.assign(this.historyWin.left, hb('LeftHistoryButton') || {});
            Object.assign(this.historyWin.right, hb('RightHistoryButton') || {});
            // the cabinet
            const cab = pack.xml('UI\\BuildAPurble\\Cabinet\\Cabinet.xml');
            this.cab = cab;
            this.checkbox = pack.sprite('UI\\BuildAPurble\\Cabinet\\CheckBox.xml');
            this.redX = pack.sprite('UI\\BuildAPurble\\Cabinet\\RedX.xml');
            this.greenCheck = pack.sprite('UI\\BuildAPurble\\Cabinet\\GreenCheck.xml');
            this.featureButtons = {};
            VG.children(cab, 'FaceFeatureButton').forEach((b) => {
                const d = VG.child(b, 'Desc');
                this.featureButtons[b.a.Name] = {
                    x: VG.num(b, 'X', 0), y: VG.num(b, 'Y', 0), cbx: VG.num(b, 'CheckBoxX', 30), cby: VG.num(b, 'CheckBoxY', 47),
                    sprite: pack.sprite(VG.text(d, 'Button'))
                };
            });
            this.templates = VG.children(VG.child(doc, 'FaceTemplates')).map((t) => VG.text(t)).filter((v, i, a) => a.indexOf(v) === i).map((path) => this.loadTemplate(path));
            this.home = this.nodes.get('ReturnToMainMenu');
            this.spot1 = this.nodes.get('Spotlight');
            this.spot2 = this.nodes.get('Spotlight2');
            this.rod = this.nodes.get('CurtainRod');
            this.winMovie = PP.movie(pack, 'UI\\BuildAPurble\\Win\\Animation.xml');
            this.tips = PP.loadTips(pack, 'UI\\BuildAPurble\\Tips.xml');
            this.active = true;
        }

        // a face template: Body / Head / each feature colour + variant at its offset
        loadTemplate(path) {
            const n = this.pack.xml(path);
            const out = { features: {}, mystery: null };
            if (!n) return out;
            const m = VG.child(n, 'MysteryHead');
            if (m) out.mystery = { x: VG.num(m, 'X', 0), y: VG.num(m, 'Y', 0), sprite: this.pack.sprite(VG.text(VG.child(m, 'Desc'), 'Sprite')) };
            VG.children(VG.child(n, 'Features')).forEach((f) => {
                const d = VG.child(f, 'Desc');
                out.features[f.t] = { x: VG.num(f, 'X', 0), y: VG.num(f, 'Y', 0), sprite: this.pack.sprite(VG.text(d, 'Sprite')), sound: VG.num(d, 'SoundID', -1) };
            });
            return out;
        }

        sprites() {
            const list = [this.screenSprite, this.background, this.curtain.sprite, this.question.sprite, this.guessBtn.sprite, this.guessBtn.idle,
                this.green, this.red, this.historyWin.left.sprite, this.historyWin.right.sprite, this.historyWin.thermo, this.checkbox, this.redX, this.greenCheck]
                .concat(this.nodes.sprites());
            Object.values(this.featureButtons).forEach((b) => list.push(b.sprite));
            this.templates.forEach((t) => {
                Object.values(t.features).forEach((f) => list.push(f.sprite));
                if (t.mystery) list.push(t.mystery.sprite);
            });
            if (this.winMovie) list.push(...this.winMovie.sprites());
            return list.filter(Boolean);
        }

        warm() {
            return this.pp.warm(this.sprites());
        }

        get s() {
            return this.pp.s.shop;
        }

        // ---- game ----
        begin(saved) {
            const d = saved ? saved.difficulty : this.s.difficulty;
            this.diff = d;
            this.features = this.R.SHOP_FEATURES[d];
            this.colors = this.R.SHOP_COLORS.slice(0, d + 3);
            this.maxGuesses = this.R.SHOP_MAX_GUESSES[d];
            this.shelves = this.features.map((f) => {
                const n = VG.children(this.cab, 'Shelf').find((s) => s.a && s.a.Name === 'Shelf' + f + DIFF[d]);
                const desc = VG.child(n, 'Desc');
                return {
                    feature: f, x: VG.num(n, 'X', 0), y: VG.num(n, 'Y', 0), itemsY: VG.num(desc, 'ItemsY', 0),
                    sprite: this.pack.sprite(VG.text(desc, 'Sprite')),
                    items: VG.children(VG.child(desc, 'ItemList')).map((it) => ({ name: it.t, x: VG.num(it) }))
                };
            });
            this.stones = VG.children(this.cab, 'NodeSprite').filter((s) => new RegExp(DIFF[d] + '$').test(s.a.Name)).map((s) => ({
                x: VG.num(s, 'X', 0), y: VG.num(s, 'Y', 0), sprite: this.pack.sprite(VG.text(VG.child(s, 'Desc'), 'Sprite'))
            }));
            if (saved) {
                Object.assign(this, {
                    hiddenLook: saved.hidden, variants: saved.variants, template: saved.template, guess: saved.guess, guesses: saved.guesses,
                    hints: saved.hints, points: saved.points, marks: saved.marks, history: saved.history, removed: saved.removed || []
                });
                this.moved = true;
            } else {
                this.hiddenLook = this.R.shopHidden(d);
                // one of the three looks of every colour of every feature, and a face shape
                this.variants = {};
                this.features.forEach((f) => this.colors.forEach((c) => { this.variants[c + f] = 1 + Math.floor(Math.random() * 3); }));
                this.template = Math.floor(Math.random() * this.templates.length);
                this.guess = this.features.map(() => -1);
                this.guesses = 0;
                this.hints = 0;
                this.points = this.R.SHOP_POINTS.initial;
                this.marks = {};
                this.history = [];
                this.removed = [];
                this.moved = false;
            }
            this.historyStart = Math.max(0, this.history.length - 6);
            this.over = false;
            this.gen = (this.gen || 0) + 1;
            this.res = null;
            this.won = false;
            this.lastFeedback = this.history.length ? this.history[this.history.length - 1].fb : null;
            this.guessedLook = this.lastFeedback ? this.history[this.history.length - 1].look.join() : '';
            this.curtainAt = VG.now();
            this.curtainOpen = !this.moved;
            this.flashAt = VG.now();
            this.hintedLook = null;
            this.pp.playSound('BAP_INTRO');
            this.pp.playSound('BAP_FEATURE_INTRO');
            if (!saved) this.tip(this.pp.s.shopIntroShown ? (d === 2 ? 'GameStartNextADV' : 'GameStartNext') : 'GameStart' + ['BEG', 'INT', 'ADV'][d]);
            this.pp.s.shopIntroShown = true;
            this.pp.saveSettings();
            this.pp.updateStatus();
        }

        itemName(feature, color) {
            return this.colors[color] + feature + this.variants[this.colors[color] + feature];
        }

        // the template entry of a feature in a colour
        faceFeature(t, feature, color) {
            const tpl = this.templates[t] || this.templates[0];
            return tpl.features[this.colors[color] + TEMPLATE_NAME[feature] + this.variants[this.colors[color] + feature]] || null;
        }

        pick(fi, color) {
            if (this.over) return;
            const f = this.features[fi];
            const mark = this.marks[f + color];
            if (this.removed.includes(f + color)) {
                this.tip('WrongLockedFeature' + f);
                this.pp.playSound('BAD_MOVE');
                return;
            }
            if (this.guess[fi] === color) {
                this.tip('AlreadySelected');
                return;
            }
            if (mark === 'x') this.tip('RedXFeature' + f);
            else if (Object.keys(this.marks).some((k) => k.startsWith(f) && this.marks[k] === 'check' && k !== f + color)) this.tip('GreenCheckedFeature' + f);
            else this.pp.hideTip();
            this.guess[fi] = color;
            this.moved = true;
            if (this.curtainOpen) {
                this.curtainOpen = false;
                this.curtainAt = VG.now();
                this.pp.playSound('BAP_CURTAIN_CLOSE');
            }
            const ff = this.faceFeature(this.template, f, color);
            if (ff && ff.sound >= 0) this.pp.playSoundId(ff.sound);
            else this.pp.playSound('UI_SELECT');
            this.pickAt = VG.now();
            this.pp.updateStatus();
            this.invalidate();
        }

        submit() {
            if (this.over) return;
            const missing = this.guess.findIndex((c) => c < 0);
            if (missing >= 0) {
                this.pp.playSound('BAD_MOVE');
                const all = this.guess.every((c) => c < 0);
                this.tip(all ? 'NoGuessesMade' : 'Missing' + ({ Eye: 'Eyes', Nose: 'Nose', Mouth: 'Mouth', Hair: 'Hair', Accessory: 'Accessory' })[this.features[missing]]);
                return;
            }
            const key = this.guess.join();
            if (this.history.some((h) => h.look.join() === key)) {
                this.pp.playSound('BAD_MOVE');
                this.tip('AlreadyMadeGuess');
                return;
            }
            const fb = this.R.shopFeedback(this.hiddenLook, this.guess);
            this.guesses += 1;
            this.points += fb.rcrf * this.R.SHOP_POINTS.rcrf + (this.diff === 2 ? fb.rcwf * this.R.SHOP_POINTS.rcwf : 0);
            this.history.push({ look: this.guess.slice(), fb });
            this.historyStart = Math.max(0, this.history.length - 6);
            this.lastFeedback = fb;
            this.guessedLook = key;
            this.countAt = VG.now();
            this.flashAt = VG.now();
            this.pp.playSound('UI_BUTTON');
            this.pp.hideTip();
            if (fb.rcrf === this.features.length) {
                this.win();
                return;
            }
            // Beginner marks the tags of every feature tried
            if (this.diff === 0) {
                this.features.forEach((f, i) => {
                    if (this.guess[i] === this.hiddenLook[i]) this.colors.forEach((c, ci) => { this.marks[f + ci] = ci === this.hiddenLook[i] ? 'check' : 'x'; });
                    else this.marks[f + this.guess[i]] = 'x';
                });
                if (fb.rcrf === 0) this.tip('RedXTip');
            }
            if (this.diff === 2 && fb.rcrf + fb.rcwf === this.features.length) this.tip('SwappedColors');
            else if (!this.shownCount && (this.diff > 0 || fb.rcrf > 0)) {
                this.shownCount = true;
                this.tip(this.diff === 2 ? 'ColorCountTipADV' : 'ColorCountTip');
            }
            if (this.maxGuesses && this.guesses >= this.maxGuesses) {
                this.lose();
                return;
            }
            if (this.maxGuesses && this.maxGuesses - this.guesses <= 2 && !this.warned) {
                this.warned = true;
                this.tip('FewGuessesLeft');
            }
            this.pp.updateStatus();
            this.invalidate();
        }

        canHint() {
            return !this.over;
        }

        // Hint: the purble says something about one of its features on the current look
        hint() {
            if (this.over) return;
            if (this.guess.some((c) => c < 0)) {
                this.tip('NoGuessesMade');
                return;
            }
            const key = this.guess.join();
            if (this.hintedLook === key) {
                this.tip('NoHintForNewFace');
                return;
            }
            this.hintedLook = key;
            this.hints += 1;
            const order = PP.Rules.shuffle(this.features.map((f, i) => i));
            const i = order.find((j) => this.marks[this.features[j] + this.guess[j]] === undefined);
            const fi = i === undefined ? order[0] : i;
            const f = this.features[fi];
            const c = this.guess[fi];
            const color = this.colors[c];
            const flavour = () => (Math.random() < 0.5 ? color : 'Generic' + (1 + Math.floor(Math.random() * 3)));
            let id;
            if (this.hiddenLook[fi] === c) {
                id = 'PosHint' + f + flavour();
                this.marks[f + c] = 'check';
            } else if (this.diff === 2 && this.hiddenLook.includes(c)) id = 'RCWFHint' + f + color;
            else {
                id = 'NegHint' + f + flavour();
                this.marks[f + c] = 'x';
            }
            this.tip(id);
            this.invalidate();
        }

        win() {
            this.over = true;
            this.won = true;
            this.curtainOpen = true;
            this.curtainAt = VG.now();
            this.winAt = VG.now();
            this.pp.playSound('BAP_CURTAIN_WIN_OPEN');
            this.later(() => this.pp.playSound('BAP_WIN_GAME'), 600);
            this.pp.updateStatus();
            // the Game Won box once the win movie (95 frames) has played
            this.settle(true);
            this.later(() => this.finish(true), Math.max(4500, this.winMovie ? this.winMovie.duration + 400 : 0));
        }

        // a timer for this game only (not after New Game, the town or closing the window)
        later(fn, ms) {
            const gen = this.gen;
            setTimeout(() => {
                if (gen === this.gen && this.pp.mod === this && this.pp.win.isOpen()) fn();
            }, ms);
        }

        lose() {
            this.over = true;
            this.curtainOpen = true;
            this.curtainAt = VG.now();
            this.pp.playSound('LOSE_GAME');
            this.pp.updateStatus();
            this.settle(false);
            this.later(() => this.finish(false), 2500);
        }

        // the score and the statistics, recorded as the game ends (the box comes after the movie)
        settle(won) {
            const pp = this.pp;
            const sc = this.R.shopScore({ difficulty: this.diff, guesses: this.guesses, hints: this.hints, points: this.points });
            const st = pp.recordGame('shop' + this.diff, { won, score: sc.final, avg: this.guesses });
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
            if (won) {
                pp.endDialog(112, {
                    1133: p.string(191 + sc.rank),
                    1134: String(this.points),
                    1136: String(this.guesses),
                    1137: String(this.hints),
                    1138: String(sc.total),
                    1139: String(sc.bonus),
                    1082: PP.fmt(p.string(57409, 'Final Score: %1!d!'), sc.final),
                    1072: PP.fmt(p.string(47149, 'High score: %1!d!'), best ? best.score : sc.final),
                    1073: PP.fmt(p.string(46633, 'Average number of guesses: %1!d!'), avg),
                    1071: PP.fmt(p.string(41237, 'Games played: %1!d!'), st.played),
                    1084: PP.fmt(p.string(41532, 'Games won: %1!d!'), st.won),
                    1074: PP.fmt(p.string(41060, 'Win percentage: %1!d!%%'), pct),
                    1075: PP.fmt(p.string(44135, 'Date: %1'), VG.formatDate(best ? best.date : Date.now()))
                }, { menu: 1088, exit: 1087 });
            } else {
                pp.endDialog(114, {
                    1077: PP.fmt(p.string(47149, 'High score: %1!d!'), best ? best.score : 0),
                    1078: PP.fmt(p.string(46633, 'Average number of guesses: %1!d!'), avg),
                    1076: PP.fmt(p.string(41237, 'Games played: %1!d!'), st.played),
                    1122: PP.fmt(p.string(41532, 'Games won: %1!d!'), st.won),
                    1080: PP.fmt(p.string(41060, 'Win percentage: %1!d!%%'), pct),
                    1079: PP.fmt(p.string(44135, 'Date: %1'), VG.formatDate(best ? best.date : Date.now()))
                }, { menu: 1060, exit: 1063 }, best ? [] : [1077, 1079]);
            }
        }

        recordLoss() {
            if (!this.moved) return;
            this.pp.recordGame('shop' + this.diff, { won: false, avg: this.guesses });
            this.moved = false;
        }

        inProgress() {
            return this.moved && !this.over;
        }

        saveState() {
            return {
                difficulty: this.diff, hidden: this.hiddenLook, variants: this.variants, template: this.template, guess: this.guess, guesses: this.guesses,
                hints: this.hints, points: this.points, marks: this.marks, history: this.history, removed: this.removed
            };
        }

        leave() {
            this.over = true;
            this.gen = (this.gen || 0) + 1;
            this.pp.hideTip();
        }

        setActive(active) {
            this.active = active;
        }

        tip(id) {
            const t = this.tips[id];
            if (!t || !this.pp.s.tips) return;
            this.pp.showTip(t, TIP_AT);
        }

        helpTip() {
            this.tip('GameStart' + ['BEG', 'INT', 'ADV'][this.diff || 0]);
        }

        statusTexts() {
            const p = this.pack;
            const g = this.maxGuesses ? PP.fmt(p.string(44646, 'Guesses: %1!d!/%2!d!'), this.guesses || 0, this.maxGuesses) : PP.fmt(p.string(47878, 'Guesses: %1!d!'), this.guesses || 0);
            return ['', PP.fmt(p.string(41658, 'Score: %1!d!'), this.points || 0), g];
        }

        // the panes flash red as the numbers change
        statusColors() {
            const red = this.flashAt && VG.now() - this.flashAt < 1500 ? '#e00000' : '';
            if (red) {
                clearTimeout(this.flashTimer);
                this.flashTimer = setTimeout(() => this.pp.updateStatus(), 1550 - (VG.now() - this.flashAt));
            }
            return ['', red, red];
        }

        invalidate() {
            this.pp.win.stage.invalidate();
        }

        frame() {
            return true;
        }

        // ---- draw ----
        // a sprite whose registration point goes at x / y, scaled k
        put(st, def, x, y, k, opts) {
            if (!def) return;
            st.sprite(def, x - def.regX * k + def.regX, y - def.regY * k + def.regY, Object.assign({ w: def.w * k, h: def.h * k }, opts || {}));
        }

        // a purble: the template's body and head, then the features of `look` (-1 = none)
        drawFace(st, look, ox, oy, k, opts) {
            const tpl = this.templates[this.template] || this.templates[0];
            if (!tpl) return;
            const f = tpl.features;
            if (f.Body) this.put(st, f.Body.sprite, ox + f.Body.x * k, oy + f.Body.y * k, k, opts);
            FACE_ORDER.forEach((name) => {
                if (name === 'Head') {
                    if (f.Head) this.put(st, f.Head.sprite, ox + f.Head.x * k, oy + f.Head.y * k, k, opts);
                    return;
                }
                const fi = this.features.indexOf(name);
                if (fi < 0 || look[fi] < 0 || look[fi] === undefined) return;
                const ff = this.faceFeature(this.template, name, look[fi]);
                if (ff) this.put(st, ff.sprite, ox + ff.x * k, oy + ff.y * k, k, opts);
            });
        }

        draw(st) {
            const now = VG.now();
            if (this.screenSprite) st.sprite(this.screenSprite, 0, 0);
            if (this.background) st.sprite(this.background, 0, 0);
            this.drawCurtain(st, now);
            [this.spot1, this.spot2, this.rod].forEach((it) => { if (it && it.sprite) st.sprite(it.sprite, it.x, it.y); });
            this.drawCabinet(st);
            this.drawCount(st, now);
            this.drawGuessButton(st, now);
            this.drawFace(st, this.guess || [], this.guessFace.x, this.guessFace.y, this.guessFace.scale);
            this.drawHistory(st);
            if (this.home && this.home.sprite) st.sprite(this.home.sprite, this.home.x, this.home.y, { anim: this.hot === 'home' ? (this.down === 'home' ? 2 : 1) : 0 });
            if (this.won && this.winMovie) this.winMovie.draw(st, this.winMovie.frameAt(now - this.winAt, false), 0, 0);
        }

        drawCurtain(st, now) {
            const c = this.curtain;
            // behind the curtain: the "?" head, or the hidden purble once it opens on a finished game
            const tpl = this.templates[this.template] || this.templates[0];
            if (this.over) this.drawFace(st, this.hiddenLook, this.hidden.x, this.hidden.y, this.hidden.scale);
            else if (tpl && tpl.mystery) {
                this.put(st, tpl.mystery.sprite, this.hidden.x + tpl.mystery.x * this.hidden.scale + 2, this.hidden.y + tpl.mystery.y * this.hidden.scale - 30, 1);
                // question_mark_anim: frames 0-14 in 1.5 s as the curtain opens, then held;
                // question_markclose_anim: 15-23 as it closes
                const qt = now - this.curtainAt;
                const qf = this.curtainOpen ? Math.min(14, Math.floor(qt / 100)) : Math.min(23, 15 + Math.floor(qt / 12));
                if (this.question.sprite) st.sprite(this.question.sprite, this.question.x, this.question.y, { frame: qf });
            }
            if (!c.sprite) return;
            // Curtain\OpenAnimation runs frames 0-7 (closed to drawn back), CloseAnimation 7-15,
            // 0.5 s each
            const t = Math.min(1, (now - this.curtainAt) / 500);
            const f = this.curtainOpen ? Math.round(7 * t) : 7 + Math.round(8 * t);
            st.sprite(c.sprite, c.x, c.y, { frame: Math.max(0, Math.min(15, f)) });
        }

        drawCabinet(st) {
            this.stones.forEach((s) => { if (s.sprite) st.sprite(s.sprite, s.x, s.y); });
            this.shelves.forEach((sh, fi) => {
                if (sh.sprite) st.sprite(sh.sprite, sh.x, sh.y);
                this.colors.forEach((color, ci) => {
                    const item = sh.items.find((it) => it.name === this.itemName(sh.feature, ci));
                    const b = item && this.featureButtons[item.name];
                    if (!b || !b.sprite) return;
                    const x = sh.x + item.x + b.x;
                    const y = sh.y + sh.itemsY + b.y;
                    const id = 'f' + fi + ':' + ci;
                    const removed = this.removed.includes(sh.feature + ci);
                    let anim = 0;
                    if (this.guess[fi] === ci) anim = 2;
                    else if (this.hot === id) anim = this.down === id ? 2 : 1;
                    st.sprite(b.sprite, x, y, { anim: Math.min(anim, b.sprite.anims.length - 1), alpha: removed || this.marks[sh.feature + ci] === 'x' ? 0.45 : 1 });
                    // the shelf tag's mark, centred on CheckBoxX / CheckBoxY under the item
                    const tx = sh.x + item.x + b.cbx;
                    const ty = sh.y + sh.itemsY + b.cby;
                    const mark = this.marks[sh.feature + ci];
                    if (mark === 'x' && this.redX) st.sprite(this.redX, tx, ty);
                    else if (mark === 'check' && this.greenCheck) st.sprite(this.greenCheck, tx, ty);
                });
            });
        }

        drawCount(st, now) {
            const fb = this.lastFeedback;
            const o = this.count;
            const P = this.countParts;
            const pop = this.countAt && now - this.countAt < 300 ? 1 + 0.3 * Math.sin((now - this.countAt) / 300 * Math.PI) : 1;
            if (this.diff < 2) {
                if (fb && this.green) this.put(st, this.green, o.x + P.simple.x, o.y + P.simple.y, pop, { frame: Math.min(5, fb.rcrf) });
                return;
            }
            const show = !!fb;
            if (this.green) this.put(st, this.green, o.x + P.rcrf.x + 9, o.y + P.rcrf.y, pop, { frame: show ? Math.min(5, fb.rcrf) : 0, alpha: show ? 1 : 0.35 });
            if (this.red) this.put(st, this.red, o.x + P.rcwf.x + 9, o.y + P.rcwf.y, pop, { frame: show ? Math.min(5, fb.rcwf) : 0, alpha: show ? 1 : 0.35 });
            const label = (part, color) => PP.drawLabel(st, { x: o.x + part.x, y: o.y + part.y, w: part.w, h: part.h, size: 10, font: 'Segoe UI', color, justify: 0 }, PP.text(this.pack, VG.text(part.desc, 'Text')).replace(/\\n/g, '\n'));
            label(P.rcrfLabel, 'FF329400');
            label(P.rcwfLabel, 'FFCC0001');
        }

        lookChanged() {
            return this.guess && this.guess.join() !== this.guessedLook;
        }

        drawGuessButton(st, now) {
            const g = this.guessBtn;
            if (!g.sprite) return;
            const enabled = !this.over && this.lookChanged() && this.guess.every((c) => c >= 0);
            let anim = 0;
            if (enabled && this.hot === 'guess') anim = this.down === 'guess' ? 2 : 1;
            st.sprite(g.sprite, g.x, g.y, { anim: Math.min(anim, g.sprite.anims.length - 1), frame: Math.floor(now / 200) % 2, alpha: enabled || !this.guessedLook ? 1 : 0.5 });
            // the idle shimmer every IdleDelay (10) seconds while it can be pressed
            if (enabled && g.idle && (now - (this.pickAt || 0)) % 10000 < 500) st.sprite(g.idle, g.x, g.y, { frame: Math.floor(((now - (this.pickAt || 0)) % 10000) / 500 * 6) });
        }

        drawHistory(st) {
            const h = this.historyWin;
            h.slots.forEach((s, i) => {
                const entry = this.history[this.historyStart + i];
                // the slot's thermometer (empty: frame 0) fills with the right features
                if (h.thermo) st.sprite(h.thermo, s.x + 3, s.y - 2, { frame: entry ? Math.min(12, Math.round(entry.fb.rcrf / this.features.length * 12)) : 0 });
                if (!entry) return;
                this.drawFace(st, entry.look, s.x + 30, s.y + 25, 0.35);
                // the counts at 50 % (RCRFLabel / RCWFLabel)
                if (this.green) this.put(st, this.green, s.x + 105 - 8, s.y + 47 - 12, 0.5, { frame: Math.min(5, entry.fb.rcrf) });
                if (this.diff === 2 && this.red) this.put(st, this.red, s.x + 105 - 8, s.y + 70 - 22, 0.5, { frame: Math.min(5, entry.fb.rcwf) });
            });
            [['hl', h.left], ['hr', h.right]].forEach(([id, b]) => {
                if (!b.sprite) return;
                // the arrows show only when there is more history that way (the blue caps are the
                // background's)
                const can = id === 'hl' ? this.historyStart > 0 : this.historyStart + 6 < this.history.length;
                if (can) st.sprite(b.sprite, b.x, b.y, { anim: this.hot === id ? (this.down === id ? 2 : 1) : 0 });
            });
        }

        // ---- input ----
        hitAt(p) {
            const inBox = (x, y, def) => def && p.x >= x - def.regX && p.y >= y - def.regY && p.x < x - def.regX + def.w && p.y < y - def.regY + def.h;
            if (this.home && inBox(this.home.x, this.home.y, this.home.sprite)) return 'home';
            if (inBox(this.guessBtn.x, this.guessBtn.y, this.guessBtn.sprite)) return 'guess';
            const hw = this.historyWin;
            if (inBox(hw.left.x, hw.left.y, hw.left.sprite)) return 'hl';
            if (inBox(hw.right.x, hw.right.y, hw.right.sprite)) return 'hr';
            for (let fi = 0; fi < (this.shelves || []).length; fi++) {
                const sh = this.shelves[fi];
                for (let ci = 0; ci < this.colors.length; ci++) {
                    const item = sh.items.find((it) => it.name === this.itemName(sh.feature, ci));
                    const b = item && this.featureButtons[item.name];
                    if (b && inBox(sh.x + item.x + b.x, sh.y + sh.itemsY + b.y, b.sprite)) return 'f' + fi + ':' + ci;
                    // the shelf tag under the item
                    if (b) {
                        const tx = sh.x + item.x + b.cbx;
                        const ty = sh.y + sh.itemsY + b.cby;
                        if (Math.abs(p.x - tx) <= 22 && Math.abs(p.y - ty) <= 12) return 't' + fi + ':' + ci;
                    }
                }
            }
            const g = this.guessFace;
            if (p.x >= g.x - 10 && p.x < g.x + 150 && p.y >= g.y - 60 && p.y < g.y + 160) return 'face';
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
            if (down === 'home') {
                this.pp.playSound('UI_BUTTON');
                this.pp.askMainMenu();
            } else if (down === 'guess') {
                if (!this.lookChanged() && this.guessedLook) {
                    this.tip('AlreadyMadeGuess');
                    return;
                }
                this.submit();
            } else if (down === 'hl' || down === 'hr') {
                const n = this.history.length;
                this.historyStart = Math.max(0, Math.min(Math.max(0, n - 6), this.historyStart + (down === 'hl' ? -1 : 1)));
                this.pp.playSound(down === 'hl' ? 'LEFT_BUTTON' : 'RIGHT_BUTTON');
            } else if (down === 'face') {
                if (!this.over) this.tip('ClickedOnFace');
            } else if (down[0] === 'f') {
                const [fi, ci] = down.slice(1).split(':').map(Number);
                this.pick(fi, ci);
            } else if (down[0] === 't') {
                // a shelf tag: nothing -> red X -> green check -> nothing
                const [fi, ci] = down.slice(1).split(':').map(Number);
                const key = this.features[fi] + ci;
                if (this.removed.includes(key)) return;
                const m = this.marks[key];
                if (!m) this.marks[key] = 'x';
                else if (m === 'x') this.marks[key] = 'check';
                else delete this.marks[key];
                this.pp.playSound('UI_SELECT');
            }
        }
    }

    PP.Shop = Shop;
})(typeof window !== 'undefined' ? window : globalThis);
