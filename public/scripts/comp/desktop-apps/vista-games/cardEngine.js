// The Vista card games' shared table (Yozora #609): Solitaire, Spider Solitaire, FreeCell and
// Hearts all ran on CardGames.dll, and so do these (scripts/build-vista-games.js packs it as
// /static_images/vista-games/cardgames/). This file reads that pack: the decks (Decks\DeckList.xml,
// five animations per deck: clubs / diamonds / spades / hearts A-10, then J Q K of each suit and
// the back), the backgrounds and their slot art, the shared sprites (shadow, highlight, hints),
// the sounds (Audio\Audio.xml) and the layouts (Layouts\<Game>Layout.xml: stack groups, stacks,
// fan directions and spacing). A game supplies the rules through hooks (see CardTable).
//
// Measured on the VM (Solitaire): a pile ("vertical") steps 2 px down-right every SpacingCount
// cards; a fan ("down") spaces face-down cards 7 px and face-up cards 23 px and squeezes to its
// MaxStackSize; the client is the 800x496 table over a Win32 status bar.
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const C = {};
    VG.Cards = C;

    C.CARD_W = 71;
    C.CARD_H = 96;
    // sheet order of the deck's suit animations
    C.CLUBS = 0;
    C.DIAMONDS = 1;
    C.SPADES = 2;
    C.HEARTS = 3;
    C.SUIT_NAMES = ['Clubs', 'Diamonds', 'Spades', 'Hearts'];
    C.RANK_NAMES = ['', 'Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];
    C.isRed = (suit) => suit === C.DIAMONDS || suit === C.HEARTS;

    let assetsPromise = null;

    // ---- assets ----------------------------------------------------------------------------
    C.loadAssets = function () {
        if (assetsPromise) return assetsPromise;
        assetsPromise = VG.loadPack('cardgames').then((pack) => {
            const sp = (path) => pack.sprite(path);
            const decks = VG.children(pack.xml('Decks\\DeckList.xml'), 'Deck').map((n) => ({
                name: n.a.Name,
                thumb: pack.imageUrl(String(n.a.Thumbnail || '').replace(/\.png$/i, '')),
                sprite: sp(String(n.v || '').trim())
            }));
            const audio = VG.child(pack.xml('Audio\\Audio.xml'), 'Audio');
            return {
                pack,
                decks,
                shadow: sp('CardShadow.xml'),
                // the yellow glow under a selected card (a run: the stack pieces)
                highlight: sp('CardHighlight.xml'),
                // the blue glow of a hint (source, then destination)
                hint: sp('CardHintStackSprite.xml'),
                stackHint: { top: sp('StackHintTopSprite.xml'), middle: sp('StackHintMiddleSprite.xml'), bottom: sp('StackHintBottomSprite.xml') },
                stackHighlight: { top: sp('StackHighlightTopSprite.xml'), middle: sp('StackHighlightMiddleSprite.xml'), bottom: sp('StackHighlightBottomSprite.xml') },
                // the focus / hover glow over a card (animation 1: six frames fading in) or an empty stack
                button: sp('CardButton.xml'),
                buttonStack: sp('CardButtonStack.xml'),
                pulse: pack.xml('Animations\\PulseAlphaAnimation.xml'),
                delayedPulse: pack.xml('Animations\\DelayedPulseAlphaAnimation.xml'),
                soundsNode: VG.child(audio, 'Sounds')
            };
        });
        return assetsPromise;
    };

    // Backgrounds\<Game>BackgroundList.xml -> [{ name, thumb, sprite, open, closed, x, o }]
    C.backgrounds = function (assets, listPath) {
        const pack = assets.pack;
        return VG.children(pack.xml(listPath.replace(/\//g, '\\')), 'Background').map((n) => ({
            name: n.a.Name,
            thumb: pack.imageUrl(String(n.a.Thumbnail || '').replace(/\.png$/i, '')),
            sprite: pack.sprite(String(n.v || '').trim()),
            open: n.a.OpenPlacement ? pack.sprite(n.a.OpenPlacement) : null,
            closed: n.a.ClosedPlacement ? pack.sprite(n.a.ClosedPlacement) : null,
            xMarker: n.a.XMarker ? pack.sprite(n.a.XMarker) : null,
            oMarker: n.a.OMarker ? pack.sprite(n.a.OMarker) : null
        }));
    };

    C.allSprites = function (assets, deck, background) {
        const list = [assets.shadow, assets.highlight, assets.hint, assets.button, assets.buttonStack, deck && deck.sprite]
            .concat(Object.values(assets.stackHint), Object.values(assets.stackHighlight));
        if (background) list.push(background.sprite, background.open, background.closed, background.xMarker, background.oMarker);
        return list.filter(Boolean);
    };

    // ---- cards -----------------------------------------------------------------------------
    let nextCardId = 1;
    C.makeCard = (suit, rank, faceUp) => ({ id: nextCardId++, suit, rank, faceUp: !!faceUp, x: 0, y: 0, stack: null });

    C.standardDeck = function (copies, suits) {
        const out = [];
        const list = suits || [0, 1, 2, 3];
        for (let n = 0; n < (copies || 1); n++) {
            list.forEach((suit) => {
                for (let rank = 1; rank <= 13; rank++) out.push(C.makeCard(suit, rank, false));
            });
        }
        return out;
    };

    C.shuffle = function (cards, random) {
        const rnd = random || Math.random;
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }
        return cards;
    };

    // animation index / frame of a card in a deck sprite
    C.frameOf = function (card) {
        if (!card.faceUp) return { anim: 4, frame: 12 };
        if (card.rank <= 10) return { anim: card.suit, frame: card.rank - 1 };
        return { anim: 4, frame: card.suit * 3 + (card.rank - 11) };
    };

    C.cardName = (card) => C.RANK_NAMES[card.rank] + ' Of ' + C.SUIT_NAMES[card.suit];

    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    // ---- layout ----------------------------------------------------------------------------
    // A stack from the layout XML: { name, group, x, y, dir, upSpacing, spacingCount, faceUp,
    // faceDown, hFaceUp, hFaceDown, endSpacing, placement, maxSize, selectedOffset, cards: [] }
    C.readLayout = function (node) {
        const num = (n, tag, fallback) => VG.num(n, tag, fallback);
        const defaults = {
            faceUp: num(node, 'DefaultVerticalSpacingFaceUp', 23),
            faceDown: num(node, 'DefaultVerticalSpacingFaceDown', 7),
            hFaceUp: num(node, 'DefaultHorizontalSpacingFaceUp', 30),
            hFaceDown: num(node, 'DefaultHorizontalSpacingFaceDown', 6),
            upSpacing: num(node, 'DefaultUpSpacing', 2),
            spacingCount: num(node, 'DefaultSpacingCount', 1),
            endSpacing: num(node, 'DefaultEndSpacing', 15)
        };
        const stacks = [];
        const groups = [];
        VG.children(node, 'StackGroup').forEach((g) => {
            const group = { name: g.a.Name, x: num(g, 'GroupX'), y: num(g, 'GroupY'), w: num(g, 'GroupWidth'), h: num(g, 'GroupHeight'), stacks: [] };
            groups.push(group);
            VG.children(g, 'CardStack').forEach((s) => {
                const label = VG.child(s, 'Label');
                const stack = {
                    name: s.a.Name,
                    group: group.name,
                    x: num(s, 'X'),
                    y: num(s, 'Y'),
                    dir: VG.text(s, 'Direction', 'vertical'),
                    upSpacing: num(s, 'UpSpacing', defaults.upSpacing),
                    spacingCount: num(s, 'SpacingCount', defaults.spacingCount),
                    faceUp: num(s, 'VerticalSpacingFaceUp', defaults.faceUp),
                    faceDown: num(s, 'VerticalSpacingFaceDown', defaults.faceDown),
                    hFaceUp: num(s, 'HorizontalSpacingFaceUp', defaults.hFaceUp),
                    hFaceDown: num(s, 'HorizontalSpacingFaceDown', defaults.hFaceDown),
                    endSpacing: num(s, 'EndSpacing', 0),
                    placement: VG.text(s, 'CardPlacement', ''),
                    maxSize: num(s, 'MaxStackSize', 0),
                    selectedOffset: num(s, 'SelectedVerticalOffset', 0),
                    label: label ? { node: label } : null,
                    color: VG.text(s, 'Color', ''),
                    cards: []
                };
                stacks.push(stack);
                group.stacks.push(stack);
            });
        });
        return {
            stacks,
            groups,
            backgroundList: VG.text(node, 'BackgroundList'),
            defaultBackground: VG.text(node, 'DefaultBackground'),
            defaultDeck: VG.text(node, 'DefaultDeck')
        };
    };

    // ---- table -----------------------------------------------------------------------------
    // hooks: canPick(stack, index) -> bool; canDrop(stack, cards, from) -> bool;
    //   drop(from, to, cards) (the game moves the cards: table.move); click(stack, index, e);
    //   doubleClick(stack, index); rightClick(point); dragStart(); drawUnder(stage) / drawOver(stage);
    //   blocked() -> bool; input() (any pointer / key input); overlay(point, 'down'|'up'|'move') -> bool
    //   (the tip balloon takes the pointer); keyboard: focusable(stack) -> bool, focusCard(stack,
    //   index) -> bool (the cards in a fan the focus stops on; default canPick), keyActivate(stack,
    //   index, e) (Space / Enter on the focused card; default click), hoverable(stack, index) -> bool
    //
    // Measured on the VM (Solitaire): the arrow keys move a focus glow (CardButton.xml, drawn over
    // the card) from stack to stack, Down from the row stacks wraps to the top row; the mouse shows
    // the same glow over a card it can pick up. A selected card glows yellow underneath
    // (CardHighlight.xml); a hint glows blue on the cards to move, then on where they go
    // (CardHintStackSprite.xml, PulseAlphaAnimation / DelayedPulseAlphaAnimation), until the next input.
    class CardTable {
        constructor(stage, assets, layout, hooks) {
            this.stage = stage;
            this.assets = assets;
            this.layout = layout;
            this.stacks = layout.stacks;
            this.byName = {};
            this.stacks.forEach((s) => { this.byName[s.name] = s; });
            this.hooks = hooks || {};
            this.deck = assets.decks[0];
            this.background = null;
            this.flying = [];   // cards with a move animation
            this.drag = null;   // { cards, from, dx, dy, x, y, moved }
            this.hints = [];    // [{ cards, to, src: { alpha }, dst: { alpha }, anims }]
            this.highlight = null; // { stack, index }: the selected card (and the run above it)
            this.focus = null;     // { stack, card } (card null: the stack's top / the empty stack)
            this.focusVisible = false;
            this.hover = null;     // { stack, index, at }
            this.animations = true;
            this.snap = 35;
        }

        stack(name) {
            return this.byName[name];
        }

        // ---- card positions ----
        // where each card of a stack sits (native px); fans squeeze to maxSize
        positions(stack) {
            const out = [];
            const cards = stack.cards;
            const n = cards.length;
            if (stack.dir === 'down' || stack.dir === 'up') {
                let downStep = stack.faceDown;
                let upStep = stack.faceUp;
                if (stack.maxSize) {
                    let total = 0;
                    for (let i = 0; i < n - 1; i++) total += cards[i].faceUp ? upStep : downStep;
                    const room = stack.maxSize - C.CARD_H;
                    if (total > room && total > 0) {
                        const k = room / total;
                        downStep *= k;
                        upStep *= k;
                    }
                }
                let y = stack.y;
                for (let i = 0; i < n; i++) {
                    out.push({ x: stack.x, y: Math.round(y) });
                    y += (stack.dir === 'up' ? -1 : 1) * (cards[i].faceUp ? upStep : downStep);
                }
            } else if (stack.dir === 'right' || stack.dir === 'left') {
                const sign = stack.dir === 'left' ? -1 : 1;
                const fanned = stack.endSpacing ? Math.min(n, stack.fanCount || 1) : n;
                let x = stack.x;
                for (let i = 0; i < n; i++) {
                    out.push({ x: Math.round(x), y: stack.y });
                    const inEnd = stack.endSpacing && i >= n - fanned;
                    if (stack.endSpacing) {
                        x += sign * (inEnd ? stack.endSpacing : (((i + 1) % Math.max(1, stack.spacingCount)) === 0 ? stack.hFaceUp : 0));
                    } else if (stack.spacingCount > 1) {
                        x += sign * (((i + 1) % stack.spacingCount) === 0 ? (cards[i].faceUp ? stack.hFaceUp : stack.hFaceDown) : 0);
                    } else {
                        x += sign * (cards[i].faceUp ? stack.hFaceUp : stack.hFaceDown);
                    }
                }
            } else {
                // a pile: 2 px down-right every spacingCount cards
                for (let i = 0; i < n; i++) {
                    const step = Math.floor(i / Math.max(1, stack.spacingCount)) * (stack.upSpacing || 0);
                    out.push({ x: stack.x + step, y: stack.y + step });
                }
            }
            return out;
        }

        // put every card where its stack says, animating the ones that moved (unless instant);
        // card.liftX / liftY nudge one card off its place (Hearts' selected cards)
        arrange(stack, opts) {
            const list = stack ? [stack] : this.stacks;
            const now = VG.now();
            list.forEach((s) => {
                const pos = this.positions(s);
                s.cards.forEach((card, i) => {
                    card.stack = s;
                    card.tx = pos[i].x + (card.liftX || 0);
                    card.ty = pos[i].y + (card.liftY || 0);
                    if (opts && opts.instant) {
                        card.x = card.tx;
                        card.y = card.ty;
                        card.anim = null;
                    } else if (!card.anim && (card.x !== card.tx || card.y !== card.ty)) {
                        this.animateTo(card, { duration: 150, now });
                    }
                });
            });
            this.stage.invalidate();
        }

        animateTo(card, opts) {
            const now = opts.now || VG.now();
            const instant = !this.animations || opts.instant;
            if (instant) {
                card.x = card.tx;
                card.y = card.ty;
                card.anim = null;
                if (opts.flipTo !== undefined) card.faceUp = opts.flipTo;
                if (opts.done) opts.done(card);
                return;
            }
            card.anim = {
                sx: card.x, sy: card.y,
                start: now + (opts.delay || 0),
                duration: opts.duration || 250,
                flipTo: opts.flipTo,
                flipped: false,
                done: opts.done,
                arc: opts.arc || 0,
                order: opts.order !== undefined ? opts.order : now
            };
            if (!this.flying.includes(card)) this.flying.push(card);
            this.stage.invalidate();
        }

        // move cards (in order) onto a stack; opts: { flip: true|false, delay, stagger, duration, instant, done }
        move(cards, to, opts) {
            opts = opts || {};
            const now = VG.now();
            const sources = new Set();
            this.hints = [];
            cards.forEach((card) => {
                const from = card.stack;
                if (from && from !== to) sources.add(from);
                if (from) {
                    const i = from.cards.indexOf(card);
                    if (i >= 0) from.cards.splice(i, 1);
                }
                to.cards.push(card);
                card.stack = to;
            });
            const pos = this.positions(to);
            cards.forEach((card, k) => {
                const i = to.cards.indexOf(card);
                card.tx = pos[i].x + (card.liftX || 0);
                card.ty = pos[i].y + (card.liftY || 0);
                this.animateTo(card, {
                    now,
                    delay: (opts.delay || 0) + k * (opts.stagger || 0),
                    duration: opts.duration || 220,
                    flipTo: opts.flip,
                    instant: opts.instant,
                    done: k === cards.length - 1 ? opts.done : null,
                    order: now + k
                });
            });
            // the stacks the cards left re-fan (Spider / Solitaire squeeze)
            sources.forEach((s) => this.arrange(s));
            this.arrange(to);
            this.stage.invalidate();
        }

        flip(card, faceUp, opts) {
            opts = opts || {};
            if (!this.animations || opts.instant) {
                card.faceUp = faceUp;
                this.stage.invalidate();
                return;
            }
            card.flipAnim = { start: VG.now() + (opts.delay || 0), duration: opts.duration || 200, to: faceUp };
            if (!this.flying.includes(card)) this.flying.push(card);
            this.stage.invalidate();
        }

        busy() {
            return this.flying.length > 0;
        }

        // ---- frame ----
        step(now) {
            let running = false;
            this.flying = this.flying.filter((card) => {
                let alive = false;
                const a = card.anim;
                if (a) {
                    const t = Math.max(0, Math.min(1, (now - a.start) / a.duration));
                    const k = ease(t);
                    card.x = a.sx + (card.tx - a.sx) * k;
                    card.y = a.sy + (card.ty - a.sy) * k - (a.arc ? Math.sin(Math.PI * t) * a.arc : 0);
                    if (a.flipTo !== undefined && !a.flipped && t >= 0.5) {
                        a.flipped = true;
                        card.faceUp = a.flipTo;
                    }
                    card.flipScale = a.flipTo !== undefined && a.flipTo !== card.faceUpAtStart ? Math.abs(Math.cos(Math.PI * t)) : 1;
                    if (t >= 1) {
                        card.anim = null;
                        card.flipScale = 1;
                        card.x = card.tx;
                        card.y = card.ty;
                        if (a.flipTo !== undefined) card.faceUp = a.flipTo;
                        if (a.done) a.done(card);
                    } else alive = true;
                }
                const f = card.flipAnim;
                if (f) {
                    const t = Math.max(0, Math.min(1, (now - f.start) / f.duration));
                    card.flipScale = Math.abs(Math.cos(Math.PI * t));
                    if (t >= 0.5) card.faceUp = f.to;
                    if (t >= 1) {
                        card.flipAnim = null;
                        card.flipScale = 1;
                    } else alive = true;
                }
                if (alive) running = true;
                return alive;
            });
            // the hint glows pulse in, then stay
            this.hints.forEach((h) => {
                h.anims.forEach((a) => {
                    if (a.step(now)) running = true;
                });
            });
            // the focus / hover glow fades in over its six frames
            [this.focusVisible && this.focus, this.hover].forEach((f) => {
                if (f && now - (f.at || 0) < 6 * 33) running = true;
            });
            return running;
        }

        // ---- draw ----
        drawCard(card, x, y, opts) {
            const f = C.frameOf(card);
            const scale = card.flipScale === undefined ? 1 : card.flipScale;
            if (scale <= 0.02) return;
            const o = { anim: f.anim, frame: f.frame, alpha: opts && opts.alpha };
            if (scale !== 1) {
                o.w = C.CARD_W * scale;
                this.stage.sprite(this.deck.sprite, x + (C.CARD_W - o.w) / 2, y, o);
            } else this.stage.sprite(this.deck.sprite, x, y, o);
        }

        drawSlot(stack) {
            const bg = this.background;
            if (!bg || !stack.placement) return;
            const s = stack.placement === 'Closed' ? bg.closed : bg.open;
            if (!s) return;
            this.stage.sprite(s, stack.x + Math.round((C.CARD_W - s.w) / 2), stack.y + Math.round((C.CARD_H - s.h) / 2));
        }

        drawMarker(stack, kind) {
            const bg = this.background;
            const s = bg && (kind === 'x' ? bg.xMarker : bg.oMarker);
            if (!s) return;
            this.stage.sprite(s, stack.x + Math.round((C.CARD_W - s.w) / 2), stack.y + Math.round((C.CARD_H - s.h) / 2));
        }

        // A glow around one card (its sprite's registration puts the card at x, y) or a run of
        // fanned cards (top / stretched middle / bottom pieces). kind: 'hint' (blue) or 'select'.
        drawGlow(kind, x, y, lastY, alpha) {
            const st = this.stage;
            const a = alpha === undefined ? 1 : alpha;
            if (a <= 0) return;
            if (lastY === undefined || lastY === y) {
                st.sprite(kind === 'hint' ? this.assets.hint : this.assets.highlight, x, y, { alpha: a });
                return;
            }
            const p = kind === 'hint' ? this.assets.stackHint : this.assets.stackHighlight;
            if (!p.top || !p.middle || !p.bottom) return;
            const top = y - p.top.regY;
            const bottom = lastY + C.CARD_H + (p.top.regY);
            st.sprite(p.top, x, y, { alpha: a });
            const mid = bottom - p.bottom.h - (top + p.top.h);
            if (mid > 0) st.sprite(p.middle, x, top + p.top.h + p.middle.regY, { h: mid, alpha: a });
            st.sprite(p.bottom, x, bottom - p.bottom.h + p.bottom.regY, { alpha: a });
        }

        // the glows that start at a card: [{ kind, cards, alpha }] keyed by card, and the ones on
        // empty stacks
        glowsByCard() {
            const byCard = new Map();
            const onStacks = [];
            const add = (kind, cards, stack, alpha) => {
                if (cards.length) {
                    const list = byCard.get(cards[0]) || [];
                    list.push({ kind, cards, alpha });
                    byCard.set(cards[0], list);
                } else if (stack) onStacks.push({ kind, stack, alpha });
            };
            this.hints.forEach((h) => {
                add('hint', h.cards, h.from, h.src.alpha / 255);
                if (h.to) add('hint', h.to.cards.slice(-1), h.to, h.dst.alpha / 255);
            });
            if (this.highlight) {
                const { stack, index } = this.highlight;
                add('select', index >= 0 ? stack.cards.slice(index) : [], stack, 1);
            }
            return { byCard, onStacks };
        }

        // the focus (keyboard) or hover (mouse) glow: CardButton's fade-in, over the card
        drawButton(f, card, stack) {
            const s = card ? this.assets.button : this.assets.buttonStack;
            if (!s) return;
            const frame = Math.min(5, Math.floor((VG.now() - (f.at || 0)) / 33));
            this.stage.sprite(s, card ? card.x : stack.x, card ? card.y : stack.y, { anim: 1, frame });
        }

        // the card (or the empty stack) the focus is on, following a card that moved
        focusTarget() {
            const f = this.focus;
            if (!f) return null;
            if (f.card && f.card.stack && f.card.stack !== f.stack && !f.card.stack.hidden) f.stack = f.card.stack;
            const stack = f.stack;
            if (!stack || stack.hidden) return null;
            let index = f.card ? stack.cards.indexOf(f.card) : -1;
            if (index < 0) {
                index = stack.cards.length - 1;
                f.card = stack.cards[index] || null;
            }
            return { stack, index, card: f.card };
        }

        draw(W, H) {
            const st = this.stage;
            if (this.background && this.background.sprite) {
                const b = this.background.sprite;
                st.sprite(b, Math.round((W - b.w) / 2), Math.round((H - b.h) / 2));
            }
            if (this.hooks.drawUnder) this.hooks.drawUnder(st);
            this.stacks.forEach((s) => {
                if (!s.hidden) this.drawSlot(s);
            });
            const glows = this.glowsByCard();
            glows.onStacks.forEach((g) => this.drawGlow(g.kind, g.stack.x, g.stack.y, undefined, g.alpha));
            const focus = this.focusVisible ? this.focusTarget() : null;
            const hover = this.hover && !this.drag ? this.hover : null;
            const dragging = new Set(this.drag && this.drag.moved ? this.drag.cards : []);
            const flying = new Set(this.flying.filter((c) => c.anim && VG.now() >= c.anim.start));
            this.stacks.forEach((s) => {
                if (s.hidden) return;
                s.cards.forEach((card, i) => {
                    if (dragging.has(card) || flying.has(card)) return;
                    (glows.byCard.get(card) || []).forEach((g) => {
                        const last = g.cards[g.cards.length - 1];
                        this.drawGlow(g.kind, card.x, card.y, g.cards.length > 1 ? last.y : undefined, g.alpha);
                    });
                    this.drawCard(card, card.x, card.y);
                    if (focus && focus.stack === s && focus.index === i) this.drawButton(this.focus, card, s);
                    else if (hover && hover.stack === s && hover.index === i) this.drawButton(hover, card, s);
                });
                if (!s.cards.length) {
                    if (focus && focus.stack === s) this.drawButton(this.focus, null, s);
                    else if (hover && hover.stack === s && hover.index < 0) this.drawButton(hover, null, s);
                }
            });
            Array.from(flying).sort((a, b) => a.anim.order - b.anim.order).forEach((card) => this.drawCard(card, card.x, card.y));
            if (this.drag && this.drag.moved) {
                const d = this.drag;
                const sh = this.assets.shadow;
                d.cards.forEach((card, i) => {
                    const off = this.dragOffsets[i];
                    st.sprite(sh, d.x + off.x + 2, d.y + off.y + 2, { alpha: 0.85 });
                });
                d.cards.forEach((card, i) => {
                    const off = this.dragOffsets[i];
                    this.drawCard(card, d.x + off.x, d.y + off.y);
                });
            }
            if (this.hooks.drawOver) this.hooks.drawOver(st);
        }

        // ---- hit testing ----
        // the top-most card under the point: { stack, index } (index -1 = the empty stack)
        hit(p) {
            for (let s = this.stacks.length - 1; s >= 0; s--) {
                const stack = this.stacks[s];
                if (stack.hidden) continue;
                for (let i = stack.cards.length - 1; i >= 0; i--) {
                    const c = stack.cards[i];
                    if (p.x >= c.tx && p.y >= c.ty && p.x < c.tx + C.CARD_W && p.y < c.ty + C.CARD_H) return { stack, index: i };
                }
                if (!stack.cards.length && p.x >= stack.x && p.y >= stack.y && p.x < stack.x + C.CARD_W && p.y < stack.y + C.CARD_H) return { stack, index: -1 };
            }
            return null;
        }

        // the stack a dragged set lands on: the most overlap with the dragged card, within snap
        // opts.any: the nearest stack whether or not the rules take the cards (illegal-move tips)
        dropTarget(x, y, cards, from, opts) {
            const any = opts && opts.any;
            let best = null;
            let bestArea = 0;
            this.stacks.forEach((stack) => {
                if (stack === from || stack.hidden) return;
                const top = stack.cards[stack.cards.length - 1];
                const tx = top ? top.tx : stack.x;
                const ty = top ? top.ty : stack.y;
                const ox = Math.max(0, Math.min(x + C.CARD_W, tx + C.CARD_W) - Math.max(x, tx));
                const oy = Math.max(0, Math.min(y + C.CARD_H, ty + C.CARD_H) - Math.max(y, ty));
                const area = ox * oy;
                const near = Math.hypot(x - tx, y - ty) <= this.snap * 2.5;
                if ((area > 0 || near) && area >= bestArea && (any || !this.hooks.canDrop || this.hooks.canDrop(stack, cards, from))) {
                    best = stack;
                    bestArea = area;
                }
            });
            return best;
        }

        // ---- pointer ----
        wire(surface) {
            const toNative = (e) => {
                const r = surface.getBoundingClientRect();
                return this.stage.toNative(e.clientX - r.left, e.clientY - r.top);
            };
            let lastClick = { t: 0, x: 0, y: 0, key: '' };
            surface.addEventListener('contextmenu', (e) => e.preventDefault());
            surface.addEventListener('pointerdown', (e) => {
                if (this.hooks.blocked && this.hooks.blocked()) return;
                surface.focus({ preventScroll: true });
                const p = toNative(e);
                if (this.hooks.input) this.hooks.input();
                this.focusVisible = false;
                if (this.hooks.overlay && this.hooks.overlay(p, 'down')) {
                    this.overlayDown = true;
                    return;
                }
                if (e.button === 2) {
                    if (this.hooks.rightClick) this.hooks.rightClick(p, this.hit(p));
                    return;
                }
                if (e.button !== 0) return;
                const h = this.hit(p);
                if (h) this.focus = { stack: h.stack, card: h.stack.cards[h.index] || null };
                const now = VG.now();
                const key = h ? h.stack.name + ':' + h.index : '';
                const dbl = now - lastClick.t < 400 && Math.hypot(p.x - lastClick.x, p.y - lastClick.y) < 6 && key === lastClick.key;
                lastClick = { t: dbl ? 0 : now, x: p.x, y: p.y, key };
                if (dbl && h && this.hooks.doubleClick) {
                    this.drag = null;
                    this.hooks.doubleClick(h.stack, h.index);
                    return;
                }
                if (h && h.index >= 0 && this.hooks.canPick && this.hooks.canPick(h.stack, h.index)) {
                    const cards = h.stack.cards.slice(h.index);
                    const first = cards[0];
                    this.drag = { cards, from: h.stack, index: h.index, dx: p.x - first.tx, dy: p.y - first.ty, x: first.tx, y: first.ty, sx: p.x, sy: p.y, moved: false, hit: h };
                    this.dragOffsets = cards.map((c) => ({ x: c.tx - first.tx, y: c.ty - first.ty }));
                    try { surface.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
                } else {
                    this.pendingClick = h || { stack: null, index: -1, point: p };
                }
            });
            surface.addEventListener('pointermove', (e) => {
                const d = this.drag;
                const p = toNative(e);
                if (!d) {
                    if (this.hooks.overlay) this.hooks.overlay(p, 'move');
                    this.setHover(p);
                    return;
                }
                if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) < 3) return;
                if (!d.moved) {
                    d.moved = true;
                    this.hover = null;
                    if (this.hooks.dragStart) this.hooks.dragStart(d);
                }
                d.x = p.x - d.dx;
                d.y = p.y - d.dy;
                this.stage.invalidate();
            });
            surface.addEventListener('pointerleave', () => {
                if (this.hover) {
                    this.hover = null;
                    this.stage.invalidate();
                }
            });
            const end = (e) => {
                const d = this.drag;
                this.drag = null;
                if (this.overlayDown) {
                    this.overlayDown = false;
                    if (this.hooks.overlay) this.hooks.overlay(toNative(e), 'up');
                    this.pendingClick = null;
                    return;
                }
                if (d && d.moved) {
                    const target = this.dropTarget(d.x, d.y, d.cards, d.from);
                    // the cards continue from where they were let go
                    d.cards.forEach((c, i) => {
                        c.x = d.x + this.dragOffsets[i].x;
                        c.y = d.y + this.dragOffsets[i].y;
                    });
                    if (target && this.hooks.drop) this.hooks.drop(d.from, target, d.cards);
                    else {
                        if (this.hooks.dropFailed) this.hooks.dropFailed(d);
                        this.arrange(d.from);
                    }
                    this.stage.invalidate();
                    return;
                }
                if (d && this.hooks.click) this.hooks.click(d.hit.stack, d.hit.index, e);
                else if (this.pendingClick && this.hooks.click) this.hooks.click(this.pendingClick.stack, this.pendingClick.index, e, this.pendingClick.point);
                this.pendingClick = null;
                this.stage.invalidate();
            };
            surface.addEventListener('pointerup', end);
            surface.addEventListener('pointercancel', () => {
                if (this.drag) this.arrange(this.drag.from);
                this.drag = null;
                this.overlayDown = false;
            });
        }

        // the mouse glow: over a card the game would let the player use
        setHover(p) {
            if (this.hooks.blocked && this.hooks.blocked()) p = null;
            const h = p ? this.hit(p) : null;
            const ok = h && (this.hooks.hoverable ? this.hooks.hoverable(h.stack, h.index) : (h.index >= 0 && this.hooks.canPick && this.hooks.canPick(h.stack, h.index)));
            const prev = this.hover;
            if (ok && prev && prev.stack === h.stack && prev.index === h.index) return;
            if (!ok && !prev) return;
            this.hover = ok ? { stack: h.stack, index: h.index, at: VG.now() } : null;
            this.stage.invalidate();
        }

        // ---- hints ----
        // cards blink blue where they are, then (opts.to) on the stack they can go to
        showHint(cards, extra, opts) {
            const to = opts && opts.to;
            const h = { cards: cards.slice(), from: cards[0] ? cards[0].stack : (opts && opts.from), to, src: { alpha: 0 }, dst: { alpha: 0 }, extra };
            h.anims = [new VG.Animator(this.assets.pulse, h.src)];
            if (to) h.anims.push(new VG.Animator(this.assets.delayedPulse || this.assets.pulse, h.dst));
            if (!this.animations) {
                h.src.alpha = 255;
                h.dst.alpha = 255;
                h.anims = [];
            }
            this.hints = [h];
            this.stage.invalidate();
        }

        clearHints() {
            if (!this.hints.length) return;
            this.hints = [];
            this.stage.invalidate();
        }

        // ---- keyboard ----
        // the places the focus can be on in a stack: the face-up cards it could pick up (the top
        // card at least), or the empty stack
        focusIndices(stack) {
            const n = stack.cards.length;
            if (!n) return [-1];
            const out = [];
            const can = this.hooks.focusCard || this.hooks.canPick;
            for (let i = 0; i < n - 1; i++) {
                if (stack.cards[i].faceUp && can && can(stack, i)) out.push(i);
            }
            out.push(n - 1);
            return out;
        }

        focusStacks() {
            return this.stacks.filter((s) => !s.hidden && (!this.hooks.focusable || this.hooks.focusable(s)));
        }

        setFocus(stack, index) {
            this.focus = { stack, card: index >= 0 ? stack.cards[index] || null : null, at: VG.now() };
            this.focusVisible = true;
            this.stage.invalidate();
        }

        // arrows: along a fan first, then to the nearest stack that way; past the edge, around
        moveFocus(dir) {
            const stacks = this.focusStacks();
            if (!stacks.length) return;
            const cur = this.focusVisible ? this.focusTarget() : null;
            if (!cur || !stacks.includes(cur.stack)) {
                const first = stacks[0];
                this.setFocus(first, first.cards.length - 1);
                return;
            }
            const horizontal = dir === 'left' || dir === 'right';
            const sign = dir === 'left' || dir === 'up' ? -1 : 1;
            const s = cur.stack;
            const fanAxis = s.dir === 'right' || s.dir === 'left' ? 'h' : (s.dir === 'down' || s.dir === 'up' ? 'v' : '');
            if (fanAxis === (horizontal ? 'h' : 'v')) {
                const list = this.focusIndices(s);
                const k = list.indexOf(cur.index);
                const step = (s.dir === 'left' || s.dir === 'up') ? -sign : sign;
                const next = list[k + step];
                if (k >= 0 && next !== undefined) {
                    this.setFocus(s, next);
                    return;
                }
            }
            const others = stacks.filter((o) => o !== s);
            const along = (o) => (horizontal ? o.x - s.x : o.y - s.y) * sign;
            const across = (o) => Math.abs(horizontal ? o.y - s.y : o.x - s.x);
            let pick = null;
            let best = Infinity;
            others.forEach((o) => {
                const d = along(o);
                if (d <= 0) return;
                const score = d + across(o) * 3;
                if (score < best) {
                    best = score;
                    pick = o;
                }
            });
            if (!pick) {
                // around: the far end of the same row (or column), else the far end of the table
                best = -Infinity;
                others.forEach((o) => {
                    const score = -along(o) - across(o) * 3;
                    if (score > best) {
                        best = score;
                        pick = o;
                    }
                });
            }
            if (pick) this.setFocus(pick, pick.cards.length - 1);
        }

        // keyDown from the game: true when the table used the key
        key(e) {
            if (this.hooks.blocked && this.hooks.blocked()) return false;
            if (e.ctrlKey || e.altKey || e.metaKey) return false;
            const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
            if (dirs[e.key]) {
                if (this.hooks.input) this.hooks.input();
                this.hover = null;
                this.moveFocus(dirs[e.key]);
                return true;
            }
            if (e.key === ' ' || e.key === 'Enter') {
                if (this.hooks.input) this.hooks.input();
                const cur = this.focusVisible ? this.focusTarget() : null;
                if (!cur) {
                    this.moveFocus('right');
                    return true;
                }
                if (this.hooks.keyActivate) this.hooks.keyActivate(cur.stack, cur.index, e);
                else if (this.hooks.click) this.hooks.click(cur.stack, cur.index, e);
                this.stage.invalidate();
                return true;
            }
            return false;
        }
    }
    C.CardTable = CardTable;

    // ---- the Win32 status bar under the table (Solitaire: Time / Score) ----
    C.statusBar = function (win, panes) {
        const bar = VG.el('div', 'vista-game-statusbar');
        const cells = panes.map((p) => {
            const cell = VG.el('div', 'vista-game-statusbar-pane');
            if (p.width) cell.style.width = p.width + 'px';
            else cell.style.flex = '1 1 auto';
            bar.appendChild(cell);
            return cell;
        });
        bar.appendChild(VG.el('div', 'vista-game-statusbar-grip'));
        win.content.appendChild(bar);
        return {
            el: bar,
            set(i, text) {
                if (cells[i] && cells[i].textContent !== text) cells[i].textContent = text;
            }
        };
    };

    // ---- the Change Appearance dialog every card game shares (Solitaire.exe.mui 500 shape) ----
    C.appearanceDialog = function (game, opts) {
        const pack = game.pack;
        let deck = opts.deck;
        let bg = opts.background;
        return VG.dialog(opts.dialogPack || pack, opts.template || 500, {
            owner: game.win,
            title: 'Change Appearance',
            texts: { 5002: opts.deckLabel || 'Select Card Deck', 5003: opts.bgLabel || 'Select Background', 5004: opts.randomLabel || '&Randomly choose deck and background' },
            init: (dlg) => {
                VG.fillThumbList(dlg.get(5000), opts.decks.map((d) => ({ text: d.name, img: d.thumb })), deck, (i) => { deck = i; });
                VG.fillThumbList(dlg.get(5001), opts.backgrounds.map((b) => ({ text: b.name, img: b.thumb })), bg, (i) => { bg = i; });
                dlg.checked(5004, !!opts.random);
            },
            onCommand: (id, dlg) => {
                if (id !== 1) return true;
                const random = dlg.checked(5004);
                if (random) {
                    deck = Math.floor(Math.random() * opts.decks.length);
                    bg = Math.floor(Math.random() * opts.backgrounds.length);
                }
                opts.apply(deck, bg, random);
                return true;
            }
        });
    };

    // m:ss for the status bar / dialogs
    C.clock = function (seconds) {
        const s = Math.max(0, Math.floor(seconds));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    };
})(typeof window !== 'undefined' ? window : globalThis);

// ---- what the four card games share: window, status bar, tips, clock, save / exit flows ----
// config: { id, modalId, title, icon, iconClass, menu, accelerators, layout (path), panes,
//   statKind(s) -> key, defaults, tipStyle, tips (Tips\<Game>\<Game>Tips.xml), idleHints }.
//   Subclasses implement newGame(sameDeal), serialize() / deserialize(data), and the dialogs;
//   closed() runs when the window closes (call super).
//
// Measured on the VM (Solitaire): left idle, the table shows the next possible move's blue hint
// glows by itself, a different one every few seconds (no balloon, no sound).
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const C = VG.Cards;

    C.fmt = (t, ...a) => String(t).replace(/%(\d)(?:!\w!)?/g, (_, n) => String(a[Number(n) - 1])).replace(/%%/g, '%');

    class CardGame {
        constructor(pack, assets, config) {
            this.pack = pack;
            this.assets = assets;
            this.config = config;
            this.store = VG.store(config.id);
            this.s = Object.assign({ animations: true, sounds: true, tips: true, continueSaved: false, saveOnExit: false, deck: -1, background: 0, randomLook: false }, config.defaults || {}, this.store.get('settings', {}));
            this.layout = C.readLayout(assets.pack.xml(config.layout));
            this.backgrounds = C.backgrounds(assets, this.layout.backgroundList);
            if (this.s.deck < 0) this.s.deck = Math.max(0, assets.decks.findIndex((d) => d.name === this.layout.defaultDeck));
            this.sounds = new VG.Sounds(assets.pack, assets.soundsNode);
            this.tipStyle = VG.tipStyle(assets.pack, config.tipStyle || 'White');
            this.history = [];
            this.time = 0;
            this.running = false;
            this.paused = false;
            this.moved = false;
            this.ending = false;
            this.particles = [];
            this.timers = new Set();
            // the game's tips by Id (Title, Message, NoTimeout, Duration in seconds)
            this.tipDefs = {};
            VG.children(config.tips ? assets.pack.xml(config.tips) : null, 'Tip').forEach((t) => {
                this.tipDefs[VG.text(t, 'Id')] = { title: VG.text(t, 'Title'), message: VG.text(t, 'Message'), noTimeout: VG.bool(t, 'NoTimeout'), duration: VG.num(t, 'Duration', 0) };
            });
            this.win = VG.createGameWindow({
                id: config.modalId,
                game: config.id,
                title: config.title,
                icon: config.icon,
                iconClass: config.iconClass || 'fas fa-heart',
                pack,
                menu: config.menu,
                accelerators: config.accelerators,
                nativeW: config.nativeW || 800,
                nativeH: config.nativeH || 496,
                // CardGames.dll ENGINE.XML: the window may shrink to 640 x 480
                minWindowW: 640,
                minWindowH: 480,
                fill: config.fill || '#0b5a1e',
                onCommand: (id) => this.command(id),
                menuState: (id) => this.menuState(id),
                onClose: () => this.requestExit(),
                onActivate: (a) => this.setActive(a),
                onKeyDown: (e) => this.keyDown(e),
                onClosed: () => this.closed()
            });
            // the status bar is window chrome (VG.chrome counts it): the table keeps its native size
            if (config.panes) this.status = C.statusBar(this.win, config.panes);
            const hooks = this.tableHooks();
            const input = hooks.input;
            hooks.input = () => {
                this.noteInput();
                if (input) input();
            };
            hooks.overlay = (p, phase) => this.tipHit(p, phase);
            this.table = new C.CardTable(this.win.stage, assets, this.layout, hooks);
            this.win.stage.draw = () => this.table.draw(this.win.spec.nativeW, this.win.spec.nativeH);
            this.win.stage.onFrame = (now) => this.frame(now);
            this.table.wire(this.win.surface);
        }

        saveSettings() {
            this.store.set('settings', this.s);
        }

        // ---- statistics ----
        statKey() {
            if (this.statKeyOverride) return this.statKeyOverride;
            return this.config.statKind ? this.config.statKind(this.s) : 'all';
        }

        stats(key) {
            const all = this.store.get('stats', {});
            return Object.assign({ played: 0, won: 0, streak: 0, longestWin: 0, longestLose: 0, best: [] }, all[key || this.statKey()] || {});
        }

        saveStats(st, key) {
            const all = this.store.get('stats', {});
            all[key || this.statKey()] = st;
            this.store.set('stats', all);
        }

        // count a finished game; best = { score, date } kept highest first (lowest first with lowBest)
        recordResult(won, best) {
            const st = this.stats();
            st.played += 1;
            if (won) {
                st.won += 1;
                st.streak = st.streak > 0 ? st.streak + 1 : 1;
                st.longestWin = Math.max(st.longestWin, st.streak);
            } else {
                st.streak = st.streak < 0 ? st.streak - 1 : -1;
                st.longestLose = Math.max(st.longestLose, -st.streak);
            }
            if (best) {
                st.best.push(Object.assign({ date: Date.now() }, best));
                st.best.sort((a, b) => (this.config.lowBest ? a.score - b.score : b.score - a.score));
                st.best = st.best.slice(0, 5);
            }
            this.saveStats(st);
            this.lastStats = st;
            return st;
        }

        // a game given up (New Game, Exit without saving, new settings)
        recordLoss() {
            return this.recordResult(false);
        }

        // ---- look ----
        applyLook() {
            this.table.deck = this.assets.decks[this.s.deck] || this.assets.decks[0];
            this.table.background = this.backgrounds[this.s.background] || this.backgrounds[0];
            this.table.animations = this.s.animations;
            this.sounds.enabled = this.s.sounds;
            this.win.stage.invalidate();
        }

        warm() {
            const list = C.allSprites(this.assets, this.table.deck, this.table.background).concat(this.tipStyle ? this.tipStyle.sprites() : []);
            return VG.warmSprites(this.win.stage, this.assets.pack, list);
        }

        showAppearance(labels) {
            C.appearanceDialog(this, Object.assign({
                decks: this.assets.decks,
                backgrounds: this.backgrounds,
                deck: this.s.deck,
                background: this.s.background,
                random: this.s.randomLook,
                apply: (deck, bg, random) => {
                    Object.assign(this.s, { deck, background: bg, randomLook: random });
                    this.saveSettings();
                    this.applyLook();
                    this.warm();
                }
            }, labels || {}));
        }

        // ---- tips (the white balloon at the bottom left of the table) ----
        // showTip(title, message [, opts]): MUI string ids or text; opts { noTimeout, duration (s) }.
        // The balloon fades in, and out after 8 s (or its Duration) unless it is NoTimeout; its
        // close button dismisses it.
        showTip(title, message, opts) {
            if (!this.s.tips) return;
            const str = (v) => (typeof v === 'number' ? (v ? this.pack.string(v) : '') : (v || ''));
            this.tip = Object.assign({ title: str(title), message: str(message), alpha: 0, target: 1, shownAt: VG.now() }, opts || {});
            clearTimeout(this.tipTimer);
            if (!this.tip.noTimeout) {
                const tip = this.tip;
                this.tipTimer = this.later(() => {
                    if (this.tip === tip) this.hideTip();
                }, (tip.duration || 8) * 1000);
            }
            this.win.stage.invalidate();
        }

        // a tip from the game's Tips XML by Id; args fill its %1 / %2
        showTipId(id, ...args) {
            const def = this.tipDefs[id];
            if (!def) return;
            this.showTip(def.title, args.length ? C.fmt(def.message, ...args) : def.message, { id, noTimeout: def.noTimeout, duration: def.duration });
        }

        hideTip(instant) {
            if (this.tip) {
                if (instant || !this.s.animations) this.tip = null;
                else this.tip.target = 0;
            }
            this.win.stage.invalidate();
        }

        // the pointer on the balloon: the close button dismisses it, the rest of it takes the click
        tipHit(p, phase) {
            const t = this.tip;
            if (!t || !t.rect || t.target === 0) return false;
            const c = t.rect.close;
            const onClose = p.x >= c.x && p.y >= c.y && p.x < c.x + c.w && p.y < c.y + c.h;
            const onTip = p.x >= t.rect.x && p.y >= t.rect.y && p.x < t.rect.x + t.rect.w && p.y < t.rect.y + t.rect.h;
            if (phase === 'move') {
                if (t.closeHot !== onClose) {
                    t.closeHot = onClose;
                    this.win.stage.invalidate();
                }
                return false;
            }
            if (phase === 'down') {
                if (onClose) {
                    t.closeDown = true;
                    this.win.stage.invalidate();
                }
                return onTip;
            }
            if (phase === 'up' && t.closeDown) {
                t.closeDown = false;
                if (onClose) this.hideTip();
                this.win.stage.invalidate();
            }
            return onTip;
        }

        stepTip() {
            const t = this.tip;
            if (!t) return false;
            const before = t.alpha;
            t.alpha = Math.max(0, Math.min(1, t.alpha + (t.target ? 1 : -1) * 0.08));
            if (!this.s.animations) t.alpha = t.target ? 1 : 0;
            if (!t.target && t.alpha <= 0) {
                this.tip = null;
                return true;
            }
            return t.alpha !== before;
        }

        drawTip() {
            if (this.tip) this.tip.rect = VG.drawTip(this.win.stage, this.tipStyle, Object.assign({}, this.tip, { x: 2, bottom: this.win.spec.nativeH - 9, w: 212 }));
        }

        // ---- timers (cleared when the window closes) ----
        later(fn, ms) {
            const id = setTimeout(() => {
                this.timers.delete(id);
                fn();
            }, ms);
            this.timers.add(id);
            return id;
        }

        clearTimers() {
            this.timers.forEach((id) => clearTimeout(id));
            this.timers.clear();
            clearTimeout(this.clockTimer);
        }

        // ---- input: keyboard play, idle hints ----
        keyDown(e) {
            if (this.table.key(e)) {
                e.preventDefault();
                e.stopPropagation();
            }
        }

        // any input: the hint glows go, the idle clock starts over
        noteInput() {
            this.table.clearHints();
            this.idleHint = 0;
            this.armIdle();
        }

        armIdle() {
            clearTimeout(this.idleTimer);
            this.timers.delete(this.idleTimer);
            if (!this.config.idleHints || !this.hint) return;
            this.idleTimer = this.later(() => {
                if (this.s.tips && this.inProgress() && this.win.isActive() && !this.table.busy() && !this.table.drag) {
                    this.hint({ idle: true, index: this.idleHint });
                    this.idleHint = (this.idleHint || 0) + 1;
                }
                this.armIdle();
            }, this.idleHint ? 5000 : 8000);
        }

        // Click a card to select it (it glows yellow), then click where it goes (Solitaire, Spider:
        // measured on the VM); moves through hooks canPick / canDrop / drop, refusals through
        // refuseMove(from, to, cards). Returns true when it used the click.
        clickSelect(stack, index) {
            const t = this.table;
            const hooks = t.hooks;
            const sel = t.highlight;
            if (sel) {
                t.highlight = null;
                t.stage.invalidate();
                if (!stack || stack === sel.stack) return true;
                const cards = sel.stack.cards.slice(sel.index);
                if (!cards.length) return true;
                if (hooks.canDrop(stack, cards, sel.stack)) hooks.drop(sel.stack, stack, cards);
                else if (this.refuseMove) this.refuseMove(sel.stack, stack, cards);
                return true;
            }
            if (stack && index >= 0 && hooks.canPick(stack, index)) {
                t.highlight = { stack, index };
                t.stage.invalidate();
                return true;
            }
            return false;
        }

        // Space / Enter on a card (Solitaire, measured on the VM): it goes to the first place it
        // can (the list is the game's order); a selected card goes to the focused stack instead
        keyMove(stack, index, places) {
            const t = this.table;
            const hooks = t.hooks;
            if (t.highlight) return this.clickSelect(stack, index);
            if (index < 0 || !hooks.canPick(stack, index)) return false;
            const cards = stack.cards.slice(index);
            const to = places.find((p) => p !== stack && hooks.canDrop(p, cards, stack));
            if (to) hooks.drop(stack, to, cards);
            else this.sounds.play('ILLEGAL_MOVE');
            return true;
        }

        // a game over: the window closed (saved or not) deals afresh when it opens again
        closed() {
            this.clearTimers();
            clearTimeout(this.noMovesTimer);
            this.hideTip(true);
            const t = this.table;
            t.flying = [];
            t.drag = null;
            t.hints = [];
            t.highlight = null;
            t.hover = null;
            t.focusVisible = false;
            t.stacks.forEach((st) => { st.cards = []; });
            this.show = null;
            this.moved = false;
            this.running = false;
            this.ending = false;
            this.time = 0;
            this.history = [];
        }

        // ---- clock ----
        start() {
            if (this.running) return;
            this.running = true;
            this.startedAt = VG.now();
            this.hideTip();
        }

        elapsed() {
            if (!this.running || this.paused) return this.time;
            return this.time + (VG.now() - this.startedAt) / 1000;
        }

        stopClock() {
            this.time = this.elapsed();
            this.running = false;
        }

        setActive(active) {
            if (!this.running || this.ending) {
                this.paused = !active;
                return;
            }
            if (!active && !this.paused) {
                this.time = this.elapsed();
                this.paused = true;
            } else if (active && this.paused) {
                this.paused = false;
                this.startedAt = VG.now();
            }
        }

        frame(now) {
            const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0;
            this.lastFrame = now;
            let busy = this.table.step(now);
            if (this.stepEffects && this.stepEffects(now, dt)) busy = true;
            if (this.running && !this.paused && !this.ending) {
                const t = Math.floor(this.elapsed());
                if (t !== this.lastShownTime) {
                    this.lastShownTime = t;
                    if (this.tick) this.tick(t);
                    this.updateStatus();
                }
                if (!busy && this.config.clockRepaint !== false) {
                    clearTimeout(this.clockTimer);
                    this.clockTimer = setTimeout(() => this.win.stage.invalidate(), 1000 - (this.elapsed() % 1) * 1000);
                }
            }
            if (this.stepTip()) busy = true;
            return busy;
        }

        updateStatus() {}

        // ---- game in progress: new game / exit / saved game ----
        inProgress() {
            return this.moved && !this.ending;
        }

        // strings: { title, instruction, newLink, restartLink, keepLink } (MUI ids)
        askNewGame(strings) {
            if (!this.inProgress()) {
                this.newGame(false);
                return;
            }
            const p = this.pack;
            VG.taskDialog({
                owner: this.win,
                title: p.string(strings.title, 'New Game'),
                instruction: p.string(strings.instruction),
                links: [VG.linkFromString(p.string(strings.newLink), 1), VG.linkFromString(p.string(strings.restartLink), 2), VG.linkFromString(p.string(strings.keepLink), 3)]
            }).then((r) => {
                if (r !== 1 && r !== 2) return;
                this.recordLoss();
                this.newGame(r === 2);
            });
        }

        requestExit(fromMenu) {
            if (!this.inProgress()) {
                if (fromMenu) VG.closeWindow(this.win);
                return true;
            }
            const p = this.pack;
            if (this.s.saveOnExit) {
                this.saveGame();
                VG.closeWindow(this.win);
                return false;
            }
            VG.taskDialog({
                owner: this.win,
                title: p.string(6001, 'Exit Game'),
                instruction: p.string(6002),
                buttons: [{ id: 1, text: p.string(6003), default: true }, { id: 2, text: p.string(6004) }, { id: 3, text: p.string(6005) }],
                check: { text: p.string(6022), checked: this.s.saveOnExit },
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
                    this.store.remove('saved');
                    this.moved = false;
                    VG.closeWindow(this.win);
                }
            });
            return false;
        }

        dumpStacks() {
            const stacks = {};
            this.table.stacks.forEach((st) => { stacks[st.name] = st.cards.map((c) => [c.suit, c.rank, c.faceUp ? 1 : 0]); });
            return stacks;
        }

        restoreStacks(stacks) {
            this.table.stacks.forEach((st) => {
                st.cards = (stacks[st.name] || []).map(([suit, rank, up]) => C.makeCard(suit, rank, !!up));
            });
            this.table.arrange(null, { instant: true });
        }

        saveGame() {
            this.store.set('saved', Object.assign({ stacks: this.dumpStacks(), time: this.elapsed() }, this.serialize ? this.serialize() : {}));
        }

        loadSaved(saved) {
            this.table.highlight = null;
            this.table.hints = [];
            this.restoreStacks(saved.stacks);
            if (this.deserialize) this.deserialize(saved);
            this.time = saved.time || 0;
            this.history = [];
            this.moved = true;
            this.ending = false;
            this.running = true;
            this.startedAt = VG.now();
            this.store.remove('saved');
            this.updateStatus();
            this.armIdle();
        }

        // after the window opens: offer the saved game (or continue it), else onFirstOpen
        afterOpen(onFresh) {
            const saved = this.store.get('saved', null);
            if (!saved) {
                if (onFresh) onFresh();
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
                instruction: p.string(6007),
                buttons: [{ id: 1, text: p.string(6008), default: true }, { id: 2, text: p.string(6009) }],
                check: { text: p.string(6023), checked: this.s.continueSaved }
            }).then((r) => {
                if (r.checked !== this.s.continueSaved) {
                    this.s.continueSaved = r.checked;
                    this.saveSettings();
                }
                if (r.id === 1) this.loadSaved(saved);
                else {
                    this.store.remove('saved');
                    if (onFresh) onFresh();
                }
            });
        }

        // the settings changed what a game is: new game now, or after this one (the game given up
        // counts under the settings it was played with: prevKey)
        settingsChangedGame(prevKey) {
            if (!this.inProgress()) {
                this.newGame(false);
                return;
            }
            const p = this.pack;
            VG.taskDialog({
                owner: this.win,
                title: p.string(6014),
                instruction: p.string(6015),
                links: [VG.linkFromString(p.string(6016), 1), VG.linkFromString(p.string(6017), 2)]
            }).then((r) => {
                if (r === 1) {
                    this.statKeyOverride = prevKey || null;
                    this.recordLoss();
                    this.statKeyOverride = null;
                    this.newGame(false);
                }
            });
        }

        confirmResetStats(after) {
            const p = this.pack;
            VG.taskDialog({
                owner: this.win,
                title: p.string(6010),
                instruction: p.string(6011),
                buttons: [{ id: 1, text: p.string(6012) }, { id: 2, text: p.string(6013), default: true }]
            }).then((r) => {
                if (r === 1) {
                    this.store.set('stats', {});
                    if (after) after();
                }
            });
        }

        menuState() {
            return null;
        }
    }
    C.CardGame = CardGame;

    // The win: cards leave their stacks one by one on arcs across the table, trailing particles
    // of their suit and sparkles (CardGames.dll's emitters: life 0.7 s, xAccel 30, yAccel 200).
    // The VM could not be made to show its own win, so the choreography is an estimate.
    C.WinShow = class WinShow {
        constructor(game, cards, opts) {
            this.game = game;
            this.opts = opts || {};
            const pack = game.assets.pack;
            this.defs = {
                suit: ['ClubParticle.xml', 'DiamondParticle.xml', 'SpadeParticle.xml', 'HeartParticle.xml'].map((p) => pack.sprite(p)),
                sparkle: pack.sprite('SparkleParticle.xml'),
                star: pack.sprite('StarParticle.xml'),
                streak: pack.sprite('StreakParticle.xml')
            };
            VG.warmSprites(game.win.stage, pack, this.defs.suit.concat([this.defs.sparkle, this.defs.star, this.defs.streak]));
            const now = VG.now();
            const gap = game.s.animations ? (this.opts.gap || 110) : 0;
            this.flyers = cards.map((card, i) => ({
                card, start: now + i * gap, x: card.x, y: card.y,
                vx: (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * 260),
                vy: -(260 + Math.random() * 220)
            }));
            this.particles = [];
            this.end = now + cards.length * gap + (game.s.animations ? 1800 : 0);
        }

        step(now, dt) {
            let alive = false;
            this.flyers.forEach((f) => {
                if (now < f.start) {
                    alive = true;
                    return;
                }
                if (!f.launched) {
                    f.launched = true;
                    if (f.card.stack) f.card.stack.cards = f.card.stack.cards.filter((c) => c !== f.card);
                    this.game.sounds.play('LIFT_OFF');
                }
                const t = (now - f.start) / 1000;
                if (t > 1.6) return;
                alive = true;
                f.vy += 420 * dt;
                f.x += f.vx * dt;
                f.y += f.vy * dt;
                f.alpha = Math.max(0, 1 - Math.max(0, t - 1.0) / 0.6);
                f.acc = (f.acc || 0) + dt;
                while (f.acc > 1 / 30) {
                    f.acc -= 1 / 30;
                    f.n = (f.n || 0) + 1;
                    this.particles.push({
                        def: f.n % 5 === 0 ? this.defs.suit[f.card.suit] : this.defs.sparkle,
                        x: f.x + C.CARD_W / 2, y: f.y + C.CARD_H / 2,
                        vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60,
                        born: now, life: 700
                    });
                }
            });
            this.particles = this.particles.filter((p) => now - p.born < p.life);
            this.particles.forEach((p) => {
                p.vx += 30 * dt;
                p.vy += 200 * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
            });
            if (now >= this.end && !this.done) {
                this.done = true;
                setTimeout(() => this.opts.onDone && this.opts.onDone(), 0);
            }
            return alive || this.particles.length > 0;
        }

        draw() {
            const st = this.game.win.stage;
            const now = VG.now();
            this.particles.forEach((p) => {
                st.sprite(p.def, p.x - p.def.w / 2, p.y - p.def.h / 2, { alpha: Math.max(0, 1 - (now - p.born) / p.life) });
            });
            this.flyers.forEach((f) => {
                if (f.launched && f.alpha > 0) this.game.table.drawCard(f.card, f.x, f.y, { alpha: f.alpha });
            });
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
