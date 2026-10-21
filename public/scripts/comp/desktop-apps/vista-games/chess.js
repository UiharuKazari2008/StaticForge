// Chess Titans, as Windows Vista's (Yozora #609). Chess.dll is a Direct3D 9 game of its own (not the
// sprite engine the other games share): the meshes, textures, shaders, move curves, opening book and
// sounds are its own (scripts/build-vista-chess.js), the menus, accelerators, dialogs and strings
// come from Chess.exe.mui (scripts/build-vista-games.js -> chess/data.json). The pieces:
//
//   chessEngine.js   the rules and the computer player (in a Web Worker)
//   chessRender.js   the WebGL renderer (MeshCommon.fx and friends, decals, reflections)
//   chess.js         this file: the window, input, animation, tips, dialogs, statistics, saving
//
// The window, menus and dialogs are the shared engine's
// (public/scripts/comp/desktop-apps/vista-games/vistaGameEngine.js); its 2D stage canvas is hidden
// and two canvases take its place: the WebGL scene and a 2D layer over it for the tip balloons.
//
// Measured on the Vista VM (see the constants below for the numbers):
//   - the window opens with an 800 x 496 client (menu bar excluded) and resizes freely: the
//     scene fills the client, the camera keeps its vertical field of view
//   - the camera: from white's side (black's when playing as black), fitted to the board and
//     table corners of a VM capture to 2 px (CAMERA); a new game sweeps in from black's side, low
//     over the table, round white's left to the playing view in about 3 s; head to head the view
//     turns to the side to move in 1.3 s
//   - Graphics quality 0 (no 3D view) is the board from straight above with the Flat.dds pieces
//     ("Black & Gold"), 8.97 px a unit at 800 x 496; it turns Top down view on and the two
//     rotation options off
//   - a selected piece: the yellow Action.dds quarter and Decals\Select.dds on its square, the blue
//     quarter on every square it can move to (Show valid moves); the square under the pointer
//     gets Select.dds; the last move's LastMoveSource / LastMoveTarget corners (Show last move);
//     a king in check and the pieces giving it stand on Check.dds
//   - pieces move along the Media\Animations curves (a hop and a lean, 30 frames a second);
//     a captured piece fades out where it stood
//   - the hourglass (Decals\Thinky0-5.dds) turns in the top right while the computer thinks
//   - tips: a 278 px balloon 4 px from the left, its bottom 9 px over the client's (TipBlue for
//     How To Play, TipRed - a warm white - for Invalid Move), title 12 pt #014d9c, text 9 pt
//     #494a4d at 14.4 px a line; an invalid move also puts the piece down
//   - checkmate or a draw that is not the human's win: the Checkmate / Game Draw task dialog (End
//     Game, or Return and try again with Undo), then Game Over (template 309 head to head, 9
//     against the computer)
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const GAME_ID = 'chess';
    const MODAL_ID = 'vistaChessModal';
    const SCRIPT_BASE = '/scripts/comp/desktop-apps/vista-games/';
    const BASE = '/static_images/vista-games/chess/';
    const NATIVE_W = 800;
    const NATIVE_H = 496;
    const SQ = 5;
    const ANIM_FPS = 30;

    // MUI command ids (menu 129, accelerators 173)
    const CMD = {
        NEW_CPU: 32771, NEW_HUMAN: 32772, UNDO: 32775, STATS: 32776, OPTIONS: 32777, APPEARANCE: 32778,
        RESIGN: 32779, EXIT: 32780, HELP: 32784, ABOUT: 32785, ROTATE: 32781, SELF_PLAY: 32782, TOP_DOWN: 32783, FULL_SPEED: 32789
    };

    // Change Appearance: the order of the list views, names from the string table
    // (the Flat "Black & Gold" set, string 222, is not offered: it is the 2D view's)
    const PIECE_STYLES = [
        { id: 'porcelain', name: 219, thumb: 'MEDIA_CHANGEAPPEARANCE_PIECEPORCELAINTHUMB.PNG' },
        { id: 'glass', name: 220, thumb: 'MEDIA_CHANGEAPPEARANCE_PIECEGLASSTHUMB.PNG' },
        { id: 'wood', name: 221, thumb: 'MEDIA_CHANGEAPPEARANCE_PIECEWOODTHUMB.PNG' }
    ];
    const BOARD_STYLES = [
        { id: 'porcelain', name: 219, thumb: 'MEDIA_CHANGEAPPEARANCE_BOARDPORCELAINTHUMB.PNG' },
        { id: 'marble', name: 223, thumb: 'MEDIA_CHANGEAPPEARANCE_BOARDMARBLETHUMB.PNG' },
        { id: 'wood', name: 221, thumb: 'MEDIA_CHANGEAPPEARANCE_BOARDWOODTHUMB.PNG' }
    ];

    // Graphics quality (the Options slider) -> the five check boxes under it
    // (Show 3D view, High detail pieces, Show reflections, High gloss shine, Smooth edges)
    const QUALITY = [
        { view3d: false, highDetail: false, reflections: false, gloss: false, smooth: false },
        { view3d: true, highDetail: false, reflections: false, gloss: false, smooth: false },
        { view3d: true, highDetail: true, reflections: false, gloss: false, smooth: false },
        { view3d: true, highDetail: true, reflections: true, gloss: false, smooth: false },
        { view3d: true, highDetail: true, reflections: true, gloss: true, smooth: false },
        { view3d: true, highDetail: true, reflections: true, gloss: true, smooth: true }
    ];

    // The playing view (yaw 0 looks from white's side, -z): fitted to the VM's 800 x 496 view, the
    // board corners at (177, 428) (623, 428) (224, 109) (577, 109), the table's far corners at
    // (154, 50) (646, 50); 29.7 degrees of vertical field of view, 53.7 degrees down
    const CAMERA = { pitch: 0.9366, dist: 91.85, fov: 0.5178, target: [0, 3.19, -2.255] };
    // Top down view and the 2D view: the board centred, 40 units = 359 px of the 496 px height
    const TOP_DOWN = { pitch: Math.PI / 2 - 0.0001, dist: 104.8, fov: 0.5178, target: [0, 0, 0] };
    // the new game sweep: from black's side, low over the table
    const INTRO = { time: 3200, pitch: 0.22 };

    const store = VG.store(GAME_ID);
    const DEFAULT_SETTINGS = {
        level: 2,
        playAs: 0,            // 0 white, 8 black
        animations: true,
        sounds: true,
        tips: true,
        continueSaved: false,
        saveOnExit: false,
        showLastMove: true,
        showValidMoves: true,
        rotateHeadToHead: true,
        topDown: false,
        rotateBack: true,
        quality: 4,
        board: 'marble',
        pieces: 'glass',
        randomLook: false,
        askedDifficulty: false
    };

    let game = null;
    let core = null; // VistaChessCore

    function settings() {
        return Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
    }

    function saveSettings(s) {
        store.set('settings', s);
    }

    // "%d" / "%s" / "%1!d!" / "%%" from the MUI string tables
    function fmt(template, ...args) {
        let i = 0;
        return String(template)
            .replace(/%(\d)(?:!\w!)?/g, (_, n) => String(args[Number(n) - 1]))
            .replace(/%[ds]/g, () => String(args[i++]))
            .replace(/%%/g, '%');
    }

    function blankStats() {
        return { played: 0, won: 0, drawn: 0, streak: 0, streakType: '', longestWin: 0, longestDraw: 0, longestLoss: 0 };
    }

    function stats(level) {
        const all = store.get('stats', {});
        return Object.assign(blankStats(), all[level] || {});
    }

    function saveStats(level, st) {
        const all = store.get('stats', {});
        all[level] = st;
        store.set('stats', all);
    }

    // the helper files load with the game (the desktop's feature loader may already have them)
    const loaded = {};
    function loadScript(file) {
        if (!loaded[file]) {
            loaded[file] = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = SCRIPT_BASE + file;
                s.onload = () => resolve();
                s.onerror = () => {
                    delete loaded[file];
                    reject(new Error('could not load ' + file));
                };
                document.head.appendChild(s);
            });
        }
        return loaded[file];
    }

    function loadDeps() {
        return Promise.all([
            root.VistaChessCore ? null : loadScript('chessEngine.js'),
            root.VistaChessRenderer ? null : loadScript('chessRender.js')
        ]).then(() => {
            core = root.VistaChessCore;
        });
    }

    // ---- opening book (Media\Chess.opn as a move tree: scripts/build-vista-chess.js buildBook) ----
    class Book {
        constructor(buf) {
            const bytes = new Uint8Array(buf);
            let p = 0;
            const read = () => {
                const kids = [];
                while (p + 1 < bytes.length) {
                    const v = bytes[p] | (bytes[p + 1] << 8);
                    p += 2;
                    let w = 0;
                    let shift = 0;
                    for (;;) {
                        const b = bytes[p++];
                        w |= (b & 0x7f) << shift;
                        if (!(b & 0x80)) break;
                        shift += 7;
                    }
                    const node = { from: v & 63, to: (v >> 6) & 63, w, kids: null };
                    if (v & (1 << 12)) node.kids = read();
                    kids.push(node);
                    if (v & (1 << 13)) break;
                }
                return kids;
            };
            this.root = read();
        }

        // a weighted book reply after `played` ([{ from, to }] in 0..63 squares), or null
        pick(played, random) {
            let list = this.root;
            for (const m of played) {
                const n = list && list.find((k) => k.from === m.from && k.to === m.to);
                if (!n || !n.kids) return null;
                list = n.kids;
            }
            if (!list || !list.length) return null;
            const total = list.reduce((s, k) => s + k.w, 0);
            let r = (random || Math.random)() * total;
            for (const k of list) {
                r -= k.w;
                if (r < 0) return k;
            }
            return list[0];
        }
    }

    // ---- move curves (Media\Animations\*.can) -------------------------------------------------
    // Each curve runs along +z (n by zero), +x +z (n by n) or 1 x / 2 z (the knight's two by one);
    // a move takes the symmetry of the board that turns the curve onto its own direction.
    const NUMBER = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
    const SYMMETRIES = [
        [1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0],
        [-1, 0, 0, 1], [1, 0, 0, -1], [0, 1, 1, 0], [0, -1, -1, 0]
    ];

    function curveFor(anims, df, dr) {
        const af = Math.abs(df);
        const ar = Math.abs(dr);
        let name;
        let canon;
        if (af && ar && af !== ar) {
            name = 'twobyone';
            canon = [1, 2];
        } else if (af === ar) {
            name = NUMBER[af] + 'by' + NUMBER[af];
            canon = [1, 1];
        } else {
            name = NUMBER[Math.max(af, ar)] + 'byzero';
            canon = [0, 1];
        }
        const anim = anims[name];
        if (!anim) return null;
        const target = name === 'twobyone' ? [df, dr] : [Math.sign(df), Math.sign(dr)];
        const sym = SYMMETRIES.find((m) => m[0] * canon[0] + m[1] * canon[1] === target[0] && m[2] * canon[0] + m[3] * canon[1] === target[1]);
        return sym ? { anim, sym } : null;
    }

    // the curve at time t (seconds): offset [x y z] in world units and the lean quaternion
    function curveAt(c, t) {
        const a = c.anim;
        const f = Math.max(0, Math.min(a.n - 1, t * ANIM_FPS));
        const i = Math.min(a.n - 2, Math.floor(f));
        const k = f - i;
        const lerp = (p, q) => p + (q - p) * k;
        const p0 = a.pos[i];
        const p1 = a.pos[i + 1] || p0;
        const q0 = a.rot[i];
        const q1 = a.rot[i + 1] || q0;
        const m = c.sym;
        const px = lerp(p0[0], p1[0]);
        const pz = lerp(p0[2], p1[2]);
        const pos = [m[0] * px + m[1] * pz, lerp(p0[1], p1[1]), m[2] * px + m[3] * pz];
        // quaternions from the file: w x y z (w first, negated: the same rotation)
        let w = lerp(q0[0], q1[0]);
        let x = lerp(q0[1], q1[1]);
        let y = lerp(q0[2], q1[2]);
        let z = lerp(q0[3], q1[3]);
        if (w < 0) {
            w = -w; x = -x; y = -y; z = -z;
        }
        // the vector part turns with the symmetry (an axial vector: times the determinant)
        const det = m[0] * m[3] - m[1] * m[2];
        const vx = det * (m[0] * x + m[1] * z);
        const vz = det * (m[2] * x + m[3] * z);
        const vy = det * y;
        const l = Math.hypot(w, vx, vy, vz) || 1;
        return { pos, q: [w / l, vx / l, vy / l, vz / l], done: t * ANIM_FPS >= a.n - 1 };
    }

    // ---- the game -------------------------------------------------------------------------------
    class ChessTitans {
        constructor(pack, data3d, book) {
            this.pack = pack;
            this.data3d = data3d;
            this.book = book;
            this.s = settings();
            this.applyQualityDefaults();
            this.sounds = this.makeSounds();
            this.worker = core.createWorker();
            this.thinkToken = 0;
            this.anims = [];
            this.tip = null;
            this.selected = -1;
            this.hover = -1;
            this.cursor = -1;
            this.drag = null;
            this.freeView = null;
            this.state = 'ready'; // ready | playing | over
            this.win = VG.createGameWindow({
                id: MODAL_ID,
                game: GAME_ID,
                title: pack.string(170, 'Chess Titans'),
                // the taskbar finds the button's icon by this file name in the app-icon set
                icon: '/static_images/app_icons/48/vista-chess.webp',
                iconClass: 'fas fa-chess-knight',
                pack,
                menu: this.menu(),
                accelerators: 173,
                nativeW: NATIVE_W,
                nativeH: NATIVE_H,
                lockAspect: false,
                fill: '#000',
                maximizable: true,
                menuState: (id) => this.menuState(id),
                onCommand: (id) => this.command(id),
                onClose: () => this.requestExit(false),
                onClosed: () => this.closed(),
                onActivate: (active) => this.setActive(active),
                onKeyDown: (e) => this.key(e)
            });
            // the window resizes freely from 400 x 300 (MinSizeIsNative does not apply)
            this.win.spec.nativeW = NATIVE_W;
            this.win.spec.nativeH = NATIVE_H;
            this.makeCanvases();
            this.newGame(this.s.lastMode || 'cpu', false);
        }

        // Game / Help (the Debug menu of the template is not on the release build's menu bar)
        menu() {
            const menus = this.pack.mui.menus[129] || [];
            return menus.filter((m) => !/De&bug/.test(m.text));
        }

        applyQualityDefaults() {
            const q = QUALITY[Math.max(0, Math.min(QUALITY.length - 1, this.s.quality))];
            this.quality = q;
        }

        makeSounds() {
            const base = BASE + 'audio/';
            const make = (name) => {
                const a = { url: base + name + '.m4a', pool: [] };
                return a;
            };
            const defs = {
                move: [1, 2, 3, 4, 5, 6].map((i) => make('movepiece' + i)),
                taken: [make('piecetaken')],
                check: [make('check')],
                win: [make('checkmatewin')],
                lose: [make('checkmatelose')],
                illegal: [make('illegalmove')]
            };
            return {
                defs,
                play: (name) => {
                    if (!this.s.sounds || !VG.soundEnabled) return;
                    const list = defs[name];
                    if (!list) return;
                    const def = list[Math.floor(Math.random() * list.length)];
                    let audio = def.pool.find((x) => x.paused || x.ended);
                    if (!audio && def.pool.length < 3) {
                        audio = new Audio(def.url);
                        def.pool.push(audio);
                    }
                    if (!audio) return;
                    try {
                        audio.currentTime = 0;
                        const p = audio.play();
                        if (p && p.catch) p.catch(() => {});
                    } catch (_) { /* autoplay refused */ }
                },
                warm: () => Object.values(defs).forEach((list) => list.forEach((d) => {
                    if (!d.pool.length) {
                        const a = new Audio(d.url);
                        a.preload = 'auto';
                        d.pool.push(a);
                    }
                }))
            };
        }

        // ---- canvases ------------------------------------------------------------------------
        makeCanvases() {
            const surface = this.win.surface;
            const stage = this.win.stage;
            stage.canvas.style.display = 'none';
            this.glCanvas = VG.el('canvas', 'vista-game-canvas vista-chess-scene');
            this.overlay = VG.el('canvas', 'vista-game-canvas vista-chess-overlay');
            surface.appendChild(this.glCanvas);
            surface.appendChild(this.overlay);
            this.octx = this.overlay.getContext('2d');
            this.renderer = new root.VistaChessRenderer(this.glCanvas);
            this.renderer.onInvalidate = () => stage.invalidate();
            this.renderer.settings.board = this.s.board;
            this.renderer.settings.pieces = this.quality.view3d ? this.s.pieces : 'flat';
            this.syncQuality();
            // the stage keeps the frame loop and the size; this game paints its own canvases
            stage.options.onFit = () => this.fit();
            stage.onFrame = (now) => this.frame(now);
            stage.render = () => {
                stage.dirty = false;
                this.render();
            };
            this.tipImages = {};
            ['decal-tipbluetop', 'decal-tipbluemiddle', 'decal-tipbluebottom', 'decal-tipredtop', 'decal-tipredmiddle', 'decal-tipredbottom', 'decal-tipmisc'].forEach((n) => {
                const img = new Image();
                img.onload = () => stage.invalidate();
                img.src = BASE + 'textures/' + n + '.png';
                this.tipImages[n] = img;
            });
            this.wirePointer();
            this.fit();
        }

        // the quality check boxes: High detail pieces = MeshesHigh, Show reflections = the mirrored
        // pieces in the board, High gloss shine = the environment cube; no 3D view = the Flat set
        syncQuality() {
            const q = this.quality;
            const r = this.renderer.settings;
            r.highDetail = q.highDetail;
            r.reflections = q.reflections;
            // the VM draws the fixed-function techniques (TWhite / TBlack / TBoard: no environment
            // cube); High gloss shine is their specular
            r.environment = false;
            r.gloss = q.gloss;
            const pieces = q.view3d ? this.s.pieces : 'flat';
            if (r.pieces !== pieces || r.board !== this.s.board) this.renderer.setStyle(this.s.board, pieces);
        }

        // Top down view: the option, or forced by the 2D view
        topDown() {
            return this.s.topDown || !this.quality.view3d;
        }

        fit() {
            const surface = this.win.surface;
            const w = Math.max(1, surface.clientWidth);
            const h = Math.max(1, surface.clientHeight);
            const dpr = Math.max(1, root.devicePixelRatio || 1);
            // Smooth edges off: no supersampling past the device pixels
            const k = this.quality.smooth ? dpr : Math.min(dpr, 1);
            // a new backing size clears a canvas (the balloon on the overlay too), so it is only
            // set when it changes, and both are drawn again at once (this runs from the stage's
            // ResizeObserver, before the paint): no blank frame when the window opens or resizes
            let resized = false;
            [this.glCanvas, this.overlay].forEach((c, i) => {
                const kk = i === 0 ? k : dpr;
                const bw = Math.round(w * kk);
                const bh = Math.round(h * kk);
                if (c.width !== bw || c.height !== bh) {
                    c.width = bw;
                    c.height = bh;
                    resized = true;
                }
                c.style.width = w + 'px';
                c.style.height = h + 'px';
            });
            this.cssW = w;
            this.cssH = h;
            this.dpr = dpr;
            if (resized && this.renderer && w > 1 && h > 1) this.render();
            this.win.stage.invalidate();
        }

        invalidate() {
            this.win.stage.invalidate();
        }

        // ---- game flow -------------------------------------------------------------------------
        // mode 'cpu' (against the computer, the human plays s.playAs) or 'human' (head to head)
        newGame(mode, announce) {
            this.cancelThinking();
            this.mode = mode;
            this.s.lastMode = mode;
            saveSettings(this.s);
            this.humanColour = mode === 'cpu' ? this.s.playAs : 0;
            this.level = this.s.level;
            this.pos = core.Position.fromFEN(core.START_FEN);
            this.moves = [];
            this.lastMove = null;
            this.state = 'ready';
            this.result = null;
            this.counted = false;
            this.selected = -1;
            this.drag = null;
            this.anims = [];
            this.buildPieces();
            this.cameraYaw = this.viewYawFor(this.mode === 'cpu' ? this.humanColour : 0);
            this.camAnim = null;
            this.freeView = null;
            this.startIntro();
            if (announce !== false && this.win.isOpen()) this.showTip('start');
            this.invalidate();
            this.maybeComputer();
        }

        // the camera's sweep onto a new game (Display animations; not in the top down views). Held
        // at its first pose while the window is not open yet or a dialog is up before the game
        // (Select Difficulty): playIntro() runs it.
        startIntro() {
            this.intro = this.s.animations && !this.topDown() ? { start: 0, k: 0 } : null;
            if (this.win.isOpen() && !this.win.dialogs.length) this.playIntro();
        }

        playIntro() {
            if (this.intro && !this.intro.start) this.intro.start = VG.now();
            this.invalidate();
        }

        inProgress() {
            return this.state === 'playing' && this.moves.length > 0;
        }

        // the side whose move it is plays on the screen (head to head) or the human's colour
        viewYawFor(colour) {
            return colour === 8 ? Math.PI : 0;
        }

        isComputerTurn() {
            return this.mode === 'cpu' && this.pos.side !== this.humanColour && this.state !== 'over';
        }

        maybeComputer() {
            if (!this.isComputerTurn() || this.anims.length) return;
            if (this.thinking) return;
            const token = ++this.thinkToken;
            this.thinking = { start: VG.now(), token };
            const played = this.moves.map((m) => ({ from: core.sq64(core.mFrom(m)), to: core.sq64(core.mTo(m)) }));
            const bookMove = this.moves.length < 14 ? this.book && this.book.pick(played) : null;
            let job;
            if (bookMove) {
                const legal = this.pos.legalMoves().find((m) => core.sq64(core.mFrom(m)) === bookMove.from && core.sq64(core.mTo(m)) === bookMove.to);
                job = legal ? Promise.resolve({ move: legal }) : null;
            }
            if (!job) job = this.worker.think({ fen: core.START_FEN, moves: this.moves.slice(), level: this.level });
            // the hourglass turns for at least a moment, as the game's does
            const minimum = new Promise((resolve) => setTimeout(resolve, 700));
            Promise.all([job, minimum]).then(([r]) => {
                if (!this.thinking || this.thinking.token !== token) return;
                this.thinking = null;
                if (!r || !r.move) return;
                this.playMove(r.move, true);
            });
            this.invalidate();
        }

        cancelThinking() {
            this.thinking = null;
            this.thinkToken++;
            if (this.worker) this.worker.cancel();
        }

        // a legal move for the side to move: animate it, then check the result
        playMove(m, byComputer) {
            const pos = this.pos;
            const from = core.sq64(core.mFrom(m));
            const to = core.sq64(core.mTo(m));
            const flags = core.mFlags(m);
            if (this.state === 'ready') this.state = 'playing';
            const mover = this.pieceAt(from);
            const capSq = flags & core.F_EP ? to + (pos.side === core.WHITE ? -8 : 8) : to;
            const victim = (flags & core.F_CAPTURE) ? this.pieceAt(capSq) : null;
            pos.make(m);
            this.moves.push(m);
            this.lastMove = { from, to };
            this.selected = -1;
            this.hideTip();
            const finish = () => {
                if (core.mPromo(m) && mover) mover.type = core.mPromo(m);
                if (victim) this.sounds.play('taken');
                else this.sounds.play('move');
                this.afterMove(byComputer);
            };
            const animate = this.s.animations && !this.dropped;
            this.dropped = false;
            if (mover) {
                mover.square = to;
                this.animatePiece(mover, from, to, animate, () => {
                    if (victim) this.fadeOut(victim, animate);
                    finish();
                });
            }
            if (flags & core.F_CASTLE) {
                const kingSide = (to & 7) === 6;
                const rf = (from & ~7) + (kingSide ? 7 : 0);
                const rt = (from & ~7) + (kingSide ? 5 : 3);
                const rook = this.pieceAt(rf, mover);
                if (rook) {
                    rook.square = rt;
                    this.animatePiece(rook, rf, rt, animate, null);
                }
            }
            if (victim && !mover) this.fadeOut(victim, animate);
            this.invalidate();
        }

        afterMove(byComputer) {
            const st = this.pos.status();
            // head to head: the board turns to the side to move (Rotate board when playing head to
            // head), after the last move of a game too
            if (this.mode === 'human' && this.s.rotateHeadToHead && !this.topDown()) this.turnCamera(this.viewYawFor(this.pos.side));
            if (st.over) {
                this.endGame(st);
                return;
            }
            if (this.pos.inCheck()) this.sounds.play('check');
            void byComputer;
            this.maybeComputer();
            this.invalidate();
        }

        endGame(st) {
            this.state = 'over';
            this.result = st;
            // a draw has no winner (-1); a resignation is the human's
            const humanWon = this.mode === 'cpu' && st.winner === this.humanColour;
            const humanLost = this.mode === 'cpu' && st.winner >= 0 && st.winner !== this.humanColour;
            if (st.result === 'checkmate') this.sounds.play(this.mode === 'human' || humanWon ? 'win' : 'lose');
            if (this.mode === 'cpu' && !this.counted) {
                this.record(humanWon ? 'win' : (humanLost ? 'loss' : 'draw'));
                this.counted = true;
            }
            store.remove('saved');
            this.invalidate();
            // the dialog after the last move has landed (and the board has turned)
            const wait = this.s.animations ? (this.mode === 'human' && this.s.rotateHeadToHead ? 1500 : 700) : 50;
            // (head to head nothing is counted: straight to Game Over)
            clearTimeout(this.endTimer);
            this.endTimer = setTimeout(() => {
                if (this.state !== 'over' || !this.win.isOpen()) return;
                if (st.result === 'resign' || humanWon || this.mode !== 'cpu') this.showGameOver(st);
                else this.showReturnOrEnd(st);
            }, wait);
        }

        // Checkmate / Game Draw: end the game, or go back and undo (the result is already counted)
        showReturnOrEnd(st) {
            const pack = this.pack;
            const mate = st.result === 'checkmate';
            const end = VG.linkFromString(pack.string(62156, '&End Game'), 1);
            VG.taskDialog({
                owner: this.win,
                title: pack.string(mate ? 62151 : 62152, mate ? 'Checkmate' : 'Game Draw'),
                instruction: pack.string(62153, 'What do you want to do?'),
                links: [end, VG.linkFromString(pack.string(62155), 2)],
                footer: pack.string(mate ? 173 : 174)
            }).then((r) => {
                if (r === 2) {
                    // back to the game: Undo takes it on
                    return;
                }
                this.showGameOver(st);
            });
        }

        // vs computer only: the level's statistics
        record(outcome) {
            const st = stats(this.level);
            st.played += 1;
            if (outcome === 'win') st.won += 1;
            if (outcome === 'draw') st.drawn += 1;
            if (st.streakType === outcome) st.streak += 1;
            else {
                st.streakType = outcome;
                st.streak = 1;
            }
            if (outcome === 'win') st.longestWin = Math.max(st.longestWin, st.streak);
            if (outcome === 'draw') st.longestDraw = Math.max(st.longestDraw, st.streak);
            if (outcome === 'loss') st.longestLoss = Math.max(st.longestLoss, st.streak);
            saveStats(this.level, st);
        }

        undo() {
            if (!this.moves.length || this.anims.some((a) => a.kind === 'move')) return;
            this.cancelThinking();
            // against the computer: back to the human's last turn
            let n = 1;
            if (this.mode === 'cpu') {
                n = this.pos.side === this.humanColour ? 2 : 1;
                if (this.state === 'over' && this.pos.side !== this.humanColour) n = 1;
            }
            n = Math.min(n, this.moves.length);
            for (let i = 0; i < n; i++) {
                this.moves.pop();
                this.pos.unmake();
            }
            // the computer's opening move (the human plays black) cannot be taken back alone
            if (this.mode === 'cpu' && this.pos.side !== this.humanColour && !this.moves.length) {
                this.buildPieces();
                this.state = 'ready';
                this.maybeComputer();
                return;
            }
            if (this.state === 'over') this.state = 'playing';
            if (!this.moves.length) this.state = 'ready';
            const last = this.moves[this.moves.length - 1];
            this.lastMove = last ? { from: core.sq64(core.mFrom(last)), to: core.sq64(core.mTo(last)) } : null;
            this.selected = -1;
            this.buildPieces();
            if (this.mode === 'human' && this.s.rotateHeadToHead && !this.topDown()) this.turnCamera(this.viewYawFor(this.pos.side));
            this.invalidate();
        }

        // ---- pieces in the scene -------------------------------------------------------------
        buildPieces() {
            this.pieces = [];
            let id = 0;
            for (let s = 0; s < 64; s++) {
                const pc = this.pos.b[core.sq88(s)];
                if (!pc) continue;
                this.pieces.push({ id: id++, type: pc & 7, colour: pc & 8, square: s, x: 0, y: 0, z: 0, q: null, alpha: 1 });
            }
            this.pieces.forEach((p) => this.place(p, p.square));
            this.anims = [];
        }

        place(p, square) {
            p.x = ((square & 7) - 3.5) * SQ;
            p.z = ((square >> 3) - 3.5) * SQ;
            p.y = 0;
            p.q = null;
            // the knights look across the board to the other side
            p.yaw = p.colour === 8 ? Math.PI : 0;
        }

        pieceAt(square, except) {
            return this.pieces.find((p) => p.square === square && !p.dying && p !== except) || null;
        }

        animatePiece(p, from, to, animate, done) {
            const df = (to & 7) - (from & 7);
            const dr = (to >> 3) - (from >> 3);
            const curve = animate ? curveFor(this.data3d.anims, df, dr) : null;
            if (!curve) {
                this.place(p, to);
                if (done) done();
                return;
            }
            const x0 = ((from & 7) - 3.5) * SQ;
            const z0 = ((from >> 3) - 3.5) * SQ;
            this.anims.push({ kind: 'move', p, curve, x0, z0, to, start: VG.now(), done });
        }

        fadeOut(p, animate) {
            p.dying = true;
            if (!animate) {
                this.pieces = this.pieces.filter((x) => x !== p);
                return;
            }
            this.anims.push({ kind: 'fade', p, start: VG.now(), time: 450 });
        }

        turnCamera(yaw) {
            const from = this.cameraYaw;
            let to = yaw;
            if (Math.abs(to - from) < 1e-4) return;
            if (!this.s.animations) {
                this.cameraYaw = to;
                return;
            }
            // the shorter way round
            while (to - from > Math.PI) to -= Math.PI * 2;
            while (to - from < -Math.PI) to += Math.PI * 2;
            this.camAnim = { from, to, start: VG.now(), time: 1300 };
        }

        // ---- frame ---------------------------------------------------------------------------
        frame(now) {
            let busy = false;
            const done = [];
            this.anims = this.anims.filter((a) => {
                if (a.kind === 'move') {
                    const c = curveAt(a.curve, (now - a.start) / 1000);
                    a.p.x = a.x0 + c.pos[0];
                    a.p.y = c.pos[1];
                    a.p.z = a.z0 + c.pos[2];
                    a.p.q = c.q;
                    if (c.done) {
                        this.place(a.p, a.to);
                        if (a.done) done.push(a.done);
                        return false;
                    }
                    busy = true;
                    return true;
                }
                if (a.kind === 'fade') {
                    const k = Math.min(1, (now - a.start) / a.time);
                    a.p.alpha = 1 - k;
                    if (k >= 1) {
                        this.pieces = this.pieces.filter((x) => x !== a.p);
                        return false;
                    }
                    busy = true;
                    return true;
                }
                return false;
            });
            done.forEach((fn) => fn());
            if (this.camAnim) {
                const k = Math.min(1, (now - this.camAnim.start) / this.camAnim.time);
                const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
                this.cameraYaw = this.camAnim.from + (this.camAnim.to - this.camAnim.from) * e;
                if (k >= 1) {
                    this.cameraYaw = ((this.camAnim.to % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
                    this.camAnim = null;
                } else busy = true;
            }
            if (this.freeView && this.freeView.back) {
                const fv = this.freeView;
                const k = Math.min(1, (now - fv.back.start) / 600);
                const e = 1 - Math.pow(1 - k, 3);
                fv.yaw = fv.back.yaw * (1 - e);
                fv.pitch = fv.back.pitch * (1 - e);
                fv.dist = fv.back.dist * (1 - e);
                if (k >= 1) this.freeView = null;
                else busy = true;
            }
            if (this.intro && this.intro.start) {
                const k = Math.min(1, (now - this.intro.start) / INTRO.time);
                this.intro.k = k;
                if (k >= 1) this.intro = null;
                else busy = true;
            }
            if (this.thinking) busy = true;
            if (this.tip) {
                // fades in / out over 200 ms
                const before = this.tip.alpha;
                const target = this.tip.target ? 1 : 0;
                const dt = Math.max(0, now - (this.tip.last || now));
                this.tip.last = now;
                const step = Math.max(dt, 16) / 200;
                // at its target it stays: the old step took a shown balloon down to 0.9 and back up
                // every other frame, a constant flicker
                if (target > before) this.tip.alpha = Math.min(1, before + step);
                else if (target < before) this.tip.alpha = Math.max(0, before - step);
                if (this.tip.alpha !== before) busy = true;
                if (!this.tip.target && this.tip.alpha <= 0) this.tip = null;
                else if (this.tip && this.tip.target && this.tip.timeout && now - this.tip.shownAt > this.tip.timeout) this.tip.target = false;
                if (this.tip && this.tip.timeout) busy = true;
            }
            if (!this.renderer.ready) busy = true;
            return busy;
        }

        camera() {
            const top = this.topDown();
            const base = top ? TOP_DOWN : CAMERA;
            const fv = (!top && this.freeView) || { yaw: 0, pitch: 0, dist: 0 };
            // the vertical field of view holds; a narrow window widens it so the board still fits
            const aspect = this.cssW / this.cssH;
            const fit = Math.max(1, (NATIVE_W / NATIVE_H) / aspect);
            const fov = 2 * Math.atan(Math.tan(base.fov / 2) * fit);
            let yaw = this.cameraYaw + fv.yaw;
            let pitch = base.pitch + fv.pitch;
            if (this.intro && !top) {
                // round white's left (yaw falling from pi), rising from low over the table
                const k = this.intro.k;
                const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
                yaw += Math.PI * (1 - e);
                pitch = INTRO.pitch + (pitch - INTRO.pitch) * (1 - Math.pow(1 - k, 2));
            }
            const t = base.target;
            const ty = Math.sin(yaw) * t[2];
            const tz = Math.cos(yaw) * t[2];
            return {
                yaw,
                pitch: Math.max(0.12, Math.min(Math.PI / 2 - 0.0001, pitch)),
                dist: Math.max(40, Math.min(160, base.dist + fv.dist)),
                fov,
                target: [ty, t[1], tz]
            };
        }

        decals() {
            const out = [];
            const at = (s) => ({ x: ((s & 7) - 3.5) * SQ, z: ((s >> 3) - 3.5) * SQ });
            // Action.dds quarters: yellow, blue (top row), red, purple (bottom row)
            const QUARTER = { yellow: [0, 0, 0.5, 0.5], blue: [0.5, 0, 0.5, 0.5], red: [0, 0.5, 0.5, 0.5], purple: [0.5, 0.5, 0.5, 0.5] };
            if (this.lastMove && this.s.showLastMove) {
                out.push(Object.assign({ tex: 'decal-lastmovesource', size: SQ, fade: 1, rot: this.cameraYaw }, at(this.lastMove.from)));
                out.push(Object.assign({ tex: 'decal-lastmovetarget', size: SQ, fade: 1, rot: this.cameraYaw }, at(this.lastMove.to)));
            }
            if (this.pos.inCheck()) {
                // the king and every piece giving check
                this.checkers().forEach((sq) => out.push(Object.assign({ tex: 'decal-check', size: SQ, fade: 0.9 }, at(sq))));
            }
            if (this.selected >= 0) {
                if (this.s.showValidMoves) {
                    this.targets(this.selected).forEach((t) => {
                        out.push(Object.assign({ tex: 'decal-action', size: SQ, fade: 0.9, uv: QUARTER.blue }, at(t)));
                    });
                }
                out.push(Object.assign({ tex: 'decal-action', size: SQ, fade: 1, uv: QUARTER.yellow }, at(this.selected)));
                out.push(Object.assign({ tex: 'decal-select', size: SQ, fade: 1, rot: this.cameraYaw }, at(this.selected)));
            }
            const hot = this.cursor >= 0 ? this.cursor : this.hover;
            if (hot >= 0 && hot !== this.selected && this.state !== 'over') {
                out.push(Object.assign({ tex: 'decal-select', size: SQ, fade: 1, rot: this.cameraYaw }, at(hot)));
            }
            return out;
        }

        // the checked king's square and the squares of the pieces attacking it
        checkers() {
            const pos = this.pos;
            const king = pos.kings[pos.side >> 3];
            const out = [core.sq64(king)];
            // the enemy's moves onto the king's square, with the side to move flipped
            const save = pos.side;
            pos.side ^= 8;
            const list = pos.gen([], true);
            pos.side = save;
            list.forEach((m) => {
                if (core.mTo(m) === king) out.push(core.sq64(core.mFrom(m)));
            });
            return [...new Set(out)];
        }

        // the squares the piece on `square` can move to
        targets(square) {
            const s88 = core.sq88(square);
            const set = new Set();
            this.legal().forEach((m) => {
                if (core.mFrom(m) === s88) set.add(core.sq64(core.mTo(m)));
            });
            return [...set];
        }

        legal() {
            if (!this.legalCache || this.legalCache.key !== this.pos.lo + ':' + this.pos.hi + ':' + this.moves.length) {
                this.legalCache = { key: this.pos.lo + ':' + this.pos.hi + ':' + this.moves.length, moves: this.pos.legalMoves() };
            }
            return this.legalCache.moves;
        }

        render() {
            if (!this.renderer) return;
            const now = VG.now();
            const screen = [];
            if (this.thinking) {
                // 128 x 256 at 0.48: the hourglass 33 px from the right, 38 px down (VM)
                const f = Math.floor((now - this.thinking.start) / 120) % 6;
                const scale = this.glCanvas.width / this.cssW;
                screen.push({ tex: 'decal-thinky' + f, x: (this.cssW - 94) * scale, y: 34 * scale, w: 61 * scale, h: 122 * scale, alpha: 1 });
            }
            this.renderer.render({
                camera: this.camera(),
                pieces: this.pieces,
                decals: this.decals(),
                screen,
                view3d: this.quality.view3d,
                flatYaw: this.cameraYaw
            });
            this.drawOverlay();
        }

        // ---- tips ------------------------------------------------------------------------------
        // force: View Help shows How To Play with tips turned off too
        showTip(kind, text, force) {
            if (!this.s.tips && !force) return;
            let tip;
            if (kind === 'start') {
                tip = { title: this.pack.string(114, 'How To Play'), lines: [this.pack.string(204)], red: false, timeout: 0 };
            } else if (kind === 'invalid') {
                tip = { title: this.pack.string(113, 'Invalid Move'), lines: [text], red: true, timeout: 9000 };
            } else if (kind === 'turn') {
                tip = { title: this.pack.string(113, 'Invalid Move'), lines: [text], red: true, timeout: 6000 };
            } else return;
            tip.alpha = this.tip ? this.tip.alpha : 0;
            tip.target = true;
            tip.shownAt = VG.now();
            this.tip = tip;
            this.invalidate();
        }

        hideTip() {
            if (this.tip) this.tip.target = false;
            this.invalidate();
        }

        // the balloon (measured on the VM): 278 px wide, 4 px from the left, its bottom 9 px over the
        // client's; TipBlue / TipRed Top and Bottom.dds (512 x 16) at 8 px, Middle.dds stretched
        // between; the close button (TipMisc.dds, 24 px cells: normal, hot, pressed) at half size in
        // the top right; title 12 pt #014d9c, text 9 pt #494a4d, 14.4 px a line
        drawOverlay() {
            const ctx = this.octx;
            const c = this.overlay;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, c.width, c.height);
            const tip = this.tip;
            if (!tip || tip.alpha <= 0) return;
            const k = this.dpr;
            ctx.setTransform(k, 0, 0, k, 0, 0);
            ctx.globalAlpha = tip.alpha;
            const W = Math.min(278, this.cssW - 8);
            const padX = 8;
            const lineH = 14.4;
            ctx.font = '12px "Segoe UI", "Noto Sans", sans-serif';
            const body = [];
            tip.lines.forEach((l) => VG.wrapText(ctx, l, W - padX * 2).forEach((x) => body.push(x)));
            const H = Math.round(38 + body.length * lineH + 3);
            const x = 4;
            const y = Math.round(this.cssH - 9 - H);
            const col = tip.red ? 'red' : 'blue';
            const top = this.tipImages['decal-tip' + col + 'top'];
            const mid = this.tipImages['decal-tip' + col + 'middle'];
            const bot = this.tipImages['decal-tip' + col + 'bottom'];
            // the balloon is the textures' 278 px at 1:1 (3 px in), the
            // middle stretched between top and bottom
            if (top.naturalWidth && mid.naturalWidth && bot.naturalWidth) {
                // (the top's edge is its row 4, the bottom's its row 6, its shadow under it)
                ctx.drawImage(mid, 0, 0, W + 6, 128, x - 3, y + 12, W + 6, H - 19);
                ctx.drawImage(top, 0, 0, W + 6, 16, x - 3, y - 4, W + 6, 16);
                ctx.drawImage(bot, 0, 0, W + 6, 16, x - 3, y + H - 7, W + 6, 16);
            }
            const misc = this.tipImages['decal-tipmisc'];
            tip.closeRect = { x: x + W - 22, y: y + 5, w: 16, h: 16 };
            if (misc.naturalWidth) {
                const cell = tip.closeDown ? [2, 35] : (tip.closeHot ? [34, 2] : [2, 2]);
                ctx.drawImage(misc, cell[0], cell[1], 24, 24, x + W - 20, y + 7, 12, 12);
            }
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#014d9c';
            ctx.font = '16px "Segoe UI", "Noto Sans", sans-serif';
            ctx.fillText(tip.title, x + padX, y + 14);
            ctx.fillStyle = '#494a4d';
            ctx.font = '12px "Segoe UI", "Noto Sans", sans-serif';
            body.forEach((l, i) => ctx.fillText(l, x + padX, y + 37 + i * lineH));
            tip.rect = { x, y, w: W, h: H };
            ctx.globalAlpha = 1;
        }

        tipHit(p, phase) {
            const t = this.tip;
            if (!t || !t.rect || !t.target) return false;
            const c = t.closeRect;
            const onClose = c && p.x >= c.x && p.y >= c.y && p.x < c.x + c.w && p.y < c.y + c.h;
            const onTip = p.x >= t.rect.x && p.y >= t.rect.y && p.x < t.rect.x + t.rect.w && p.y < t.rect.y + t.rect.h;
            if (phase === 'move') {
                if (t.closeHot !== onClose) {
                    t.closeHot = onClose;
                    this.invalidate();
                }
                return false;
            }
            if (phase === 'down' && onClose) {
                t.closeDown = true;
                this.invalidate();
                return true;
            }
            if (phase === 'up' && t.closeDown) {
                t.closeDown = false;
                if (onClose) this.hideTip();
                return true;
            }
            return onTip && phase === 'down';
        }

        // why a move is not allowed (the game's own explanations, strings 120-140 and 212)
        invalidReason(from, to) {
            const pos = this.pos;
            const pc = pos.b[core.sq88(from)];
            const type = pc & 7;
            const s88f = core.sq88(from);
            const s88t = core.sq88(to);
            const pseudo = pos.gen([], false).filter((m) => core.mFrom(m) === s88f && core.mTo(m) === s88t);
            const str = (id) => this.pack.string(id);
            if (type === core.K && Math.abs((to & 7) - (from & 7)) === 2 && (to >> 3) === (from >> 3)) return str(123);
            if (pseudo.length) {
                if (type === core.K) return str(140);
                if (core.mFlags(pseudo[0]) & core.F_EP) return str(124);
                if (pos.inCheck()) return str(122);
                return str(212);
            }
            // the right shape but something in the way
            const df = (to & 7) - (from & 7);
            const dr = (to >> 3) - (from >> 3);
            const straight = !df || !dr;
            const diagonal = Math.abs(df) === Math.abs(dr);
            const slides = (type === core.R && straight) || (type === core.B && diagonal) || (type === core.Q && (straight || diagonal));
            if (slides) return str(121);
            if (pos.inCheck()) return str(122);
            return str({ 1: 134, 2: 135, 3: 136, 4: 137, 5: 138, 6: 139 }[type] || 120);
        }

        // ---- input -------------------------------------------------------------------------------
        canMove() {
            return this.state !== 'over' && !this.isComputerTurn() && !this.anims.some((a) => a.kind === 'move') && !this.win.dialogs.length;
        }

        clickSquare(sq) {
            if (sq < 0) return;
            if (this.state === 'over') {
                // "The game has ended. If you wish to play again, start a new game."
                if (!this.win.dialogs.length && this.pos.b[core.sq88(sq)]) this.showTip('turn', this.pack.string(166));
                return;
            }
            if (!this.canMove()) return;
            const pc = this.pos.b[core.sq88(sq)];
            const own = pc && (pc & 8) === this.pos.side;
            if (this.selected >= 0) {
                if (sq === this.selected) {
                    this.selected = -1;
                    this.invalidate();
                    return;
                }
                if (this.tryMove(this.selected, sq)) return;
                if (own) {
                    this.select(sq);
                    return;
                }
                this.sounds.play('illegal');
                this.showTip('invalid', this.invalidReason(this.selected, sq));
                // the piece is put down again
                this.selected = -1;
                this.invalidate();
                return;
            }
            if (own) this.select(sq);
            else if (pc) {
                this.sounds.play('illegal');
                this.showTip('turn', this.pack.string(this.pos.side === core.WHITE ? 159 : 150));
            }
        }

        select(sq) {
            this.selected = sq;
            this.hideTip();
            this.invalidate();
        }

        // a legal move from -> to (asks for the promotion piece); true when it was played
        tryMove(from, to) {
            const list = this.legal().filter((m) => core.sq64(core.mFrom(m)) === from && core.sq64(core.mTo(m)) === to);
            if (!list.length) return false;
            if (list.length > 1 && core.mPromo(list[0])) {
                this.askPromotion().then((type) => {
                    const m = list.find((x) => core.mPromo(x) === type) || list[0];
                    this.playMove(m, false);
                });
                this.selected = -1;
                return true;
            }
            this.playMove(list[0], false);
            return true;
        }

        askPromotion() {
            const pack = this.pack;
            return new Promise((resolve) => {
                VG.dialog(pack, 160, {
                    owner: this.win,
                    title: pack.string(225, 'Pawn Promotion'),
                    texts: { 1077: pack.string(226), 1080: pack.string(227, '&Queen'), 1079: pack.string(228, '&Rook'), 1081: pack.string(229, '&Bishop'), 1082: pack.string(230, '&Knight') },
                    closeOn: 'any',
                    init: (dlg) => {
                        // no close box: a piece must be chosen
                        const close = dlg.modal.querySelector('.modal-window-controls');
                        if (close) close.style.visibility = 'hidden';
                    },
                    onCommand: (id) => (id === 2 ? false : true),
                    onClose: (r) => resolve({ 1080: core.Q, 1079: core.R, 1081: core.B, 1082: core.N }[r] || core.Q)
                });
            });
        }

        wirePointer() {
            const surface = this.win.surface;
            const local = (e) => {
                const r = surface.getBoundingClientRect();
                return { x: e.clientX - r.left, y: e.clientY - r.top };
            };
            const squareAt = (p) => this.renderer.ready ? this.renderer.pick(p.x / this.cssW, p.y / this.cssH, this.pieces.filter((x) => !x.dying)) : -1;
            surface.addEventListener('contextmenu', (e) => e.preventDefault());
            surface.addEventListener('pointerdown', (e) => {
                surface.focus({ preventScroll: true });
                const p = local(e);
                if (this.tipHit(p, 'down')) return;
                try { surface.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
                if (e.button === 2) {
                    // right drag: a free look around the board
                    const fv = this.freeView && !this.freeView.back ? this.freeView : { yaw: 0, pitch: 0, dist: 0 };
                    if (this.freeView && this.freeView.back) {
                        fv.yaw = this.freeView.yaw;
                        fv.pitch = this.freeView.pitch;
                        fv.dist = this.freeView.dist;
                    }
                    this.freeView = fv;
                    this.look = { x: p.x, y: p.y, yaw: fv.yaw, pitch: fv.pitch };
                    if (this.tip && !this.tip.red) this.hideTip();
                    return;
                }
                if (e.button !== 0) return;
                const sq = squareAt(p);
                this.cursor = -1;
                const pc = sq >= 0 ? this.pos.b[core.sq88(sq)] : 0;
                if (sq >= 0 && pc && (pc & 8) === this.pos.side && this.canMove() && sq !== this.selected) {
                    this.select(sq);
                    this.drag = { square: sq, start: p, moved: false, fresh: true };
                } else {
                    this.drag = sq >= 0 && sq === this.selected ? { square: sq, start: p, moved: false, fresh: false } : null;
                    if (!this.drag) this.clickSquare(sq);
                }
            });
            surface.addEventListener('pointermove', (e) => {
                const p = local(e);
                this.tipHit(p, 'move');
                if (this.look) {
                    const fv = this.freeView;
                    fv.yaw = this.look.yaw + (p.x - this.look.x) / this.cssW * Math.PI * 1.5;
                    fv.pitch = Math.max(0.15 - CAMERA.pitch, Math.min(Math.PI / 2 - 0.01 - CAMERA.pitch, this.look.pitch + (p.y - this.look.y) / this.cssH * 1.5));
                    this.invalidate();
                    return;
                }
                const d = this.drag;
                if (!d) {
                    const sq = squareAt(p);
                    if (sq !== this.hover) {
                        this.hover = sq;
                        this.cursor = -1;
                        this.invalidate();
                    }
                }
                if (d) {
                    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) > 4) d.moved = true;
                    if (d.moved) {
                        // the piece follows the pointer over the board, lifted a little
                        const piece = this.pieceAt(d.square);
                        const r = this.renderer.ray(p.x / this.cssW, p.y / this.cssH);
                        if (piece && r.d[1] < -1e-4) {
                            const lift = 1.5;
                            const t = (lift - r.o[1]) / r.d[1];
                            piece.x = Math.max(-22, Math.min(22, r.o[0] + r.d[0] * t));
                            piece.z = Math.max(-22, Math.min(22, r.o[2] + r.d[2] * t));
                            piece.y = lift;
                            const f = Math.floor(piece.x / SQ + 4);
                            const k = Math.floor(piece.z / SQ + 4);
                            this.hover = f >= 0 && f < 8 && k >= 0 && k < 8 ? k * 8 + f : -1;
                        }
                        this.invalidate();
                    }
                }
            });
            const end = (e) => {
                const p = local(e);
                if (this.tipHit(p, 'up')) return;
                if (this.look) {
                    this.look = null;
                    if (this.s.rotateBack && this.freeView) {
                        const fv = this.freeView;
                        fv.back = { start: VG.now(), yaw: fv.yaw, pitch: fv.pitch, dist: fv.dist };
                    }
                    this.invalidate();
                    return;
                }
                const d = this.drag;
                this.drag = null;
                if (!d) return;
                if (d.moved) {
                    const piece = this.pieceAt(d.square);
                    const target = this.hover;
                    this.hover = -1;
                    if (piece) this.place(piece, d.square);
                    if (target >= 0 && target !== d.square) {
                        this.dropped = true;
                        if (!this.tryMove(d.square, target)) {
                            this.dropped = false;
                            this.sounds.play('illegal');
                            this.showTip('invalid', this.invalidReason(d.square, target));
                        }
                    }
                    this.invalidate();
                    return;
                }
                // a click on the selected piece puts it down again
                if (!d.fresh) {
                    this.selected = -1;
                    this.invalidate();
                }
            };
            surface.addEventListener('pointerup', end);
            surface.addEventListener('pointerleave', () => {
                if (this.drag || this.look) return;
                this.hover = -1;
                this.invalidate();
            });
            surface.addEventListener('pointercancel', end);
            surface.addEventListener('wheel', (e) => {
                if (!this.freeView) this.freeView = { yaw: 0, pitch: 0, dist: 0 };
                this.freeView.back = null;
                this.freeView.dist = Math.max(-30, Math.min(50, this.freeView.dist + Math.sign(e.deltaY) * 4));
                e.preventDefault();
                this.invalidate();
            }, { passive: false });
        }

        // arrow keys walk a cursor over the board (as seen from the camera), Enter / Space click
        key(e) {
            const k = e.key;
            const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
            if (moves[k]) {
                e.preventDefault();
                let [df, dr] = moves[k];
                // seen from black's side the board is turned round
                if (Math.cos(this.cameraYaw) < 0) {
                    df = -df;
                    dr = -dr;
                }
                const c = this.cursor >= 0 ? this.cursor : (this.selected >= 0 ? this.selected : (this.pos.side === core.WHITE ? 12 : 52));
                const f = Math.max(0, Math.min(7, (c & 7) + df));
                const r = Math.max(0, Math.min(7, (c >> 3) + dr));
                this.cursor = r * 8 + f;
                this.invalidate();
            } else if (k === 'Enter' || k === ' ') {
                if (this.cursor < 0) return;
                e.preventDefault();
                this.clickSquare(this.cursor);
            } else if (k === 'Escape') {
                this.selected = -1;
                this.cursor = -1;
                this.invalidate();
            }
        }

        setActive(active) {
            this.active = active;
        }

        // ---- menus / commands ----------------------------------------------------------------
        menuState(id) {
            if (id === CMD.UNDO) return { disabled: !this.moves.length || !!this.win.dialogs.length };
            if (id === CMD.RESIGN) return { disabled: this.mode !== 'cpu' || this.state === 'over' || !this.moves.length };
            return {};
        }

        command(id) {
            switch (id) {
            case CMD.NEW_CPU: this.askNewGame('cpu'); break;
            case CMD.NEW_HUMAN: this.askNewGame('human'); break;
            case CMD.UNDO: this.undo(); break;
            case CMD.STATS: this.showStats(); break;
            case CMD.OPTIONS: this.showOptions(); break;
            case CMD.APPEARANCE: this.showAppearance(); break;
            case CMD.RESIGN: this.askResign(); break;
            case CMD.EXIT: this.requestExit(true); break;
            case CMD.ABOUT: this.showAbout(); break;
            case CMD.HELP: this.showTip('start', '', true); break;
            case CMD.ROTATE: this.turnCamera(this.cameraYaw + Math.PI); break;
            case CMD.TOP_DOWN:
                this.s.topDown = !this.s.topDown;
                saveSettings(this.s);
                this.invalidate();
                break;
            default: break;
            }
        }

        // a game that counts: against the computer, after the first move
        counts() {
            return this.mode === 'cpu' && this.inProgress() && !this.counted;
        }

        askNewGame(mode) {
            if (this.state !== 'playing' || !this.moves.length) {
                this.startNew(mode);
                return;
            }
            const pack = this.pack;
            const loss = this.mode === 'cpu';
            VG.taskDialog({
                owner: this.win,
                title: pack.string(mode === 'cpu' ? 128 : 130),
                instruction: pack.string(195),
                links: [
                    VG.linkFromString(loss ? pack.string(196) : pack.string(196).split('\n')[0], 1),
                    VG.linkFromString(pack.string(197), 2)
                ]
            }).then((r) => {
                if (r !== 1) return;
                if (this.counts()) this.record('loss');
                this.startNew(mode);
            });
        }

        startNew(mode) {
            store.remove('saved');
            this.newGame(mode, true);
        }

        askResign() {
            if (this.mode !== 'cpu' || this.state === 'over' || !this.moves.length) return;
            const pack = this.pack;
            VG.taskDialog({
                owner: this.win,
                title: pack.string(126, 'Resign Game'),
                instruction: pack.string(127),
                buttons: [{ id: 1, text: pack.string(300, '&Yes'), default: true }, { id: 2, text: pack.string(301, '&No') }]
            }).then((r) => {
                if (r !== 1 || this.state === 'over') return;
                this.cancelThinking();
                this.endGame({ over: true, result: 'resign', winner: this.humanColour ^ 8 });
            });
        }

        requestExit(fromMenu) {
            if (!this.inProgress() || this.state === 'over') {
                if (fromMenu) VG.closeWindow(this.win);
                return true;
            }
            if (this.s.saveOnExit) {
                this.saveGame();
                VG.closeWindow(this.win);
                return false;
            }
            const pack = this.pack;
            VG.taskDialog({
                owner: this.win,
                title: pack.string(6001, 'Exit Game'),
                instruction: pack.string(6002),
                buttons: [
                    { id: 1, text: pack.string(6003, '&Save'), default: true },
                    { id: 2, text: pack.string(6004, "&Don't save") },
                    { id: 3, text: pack.string(6005, 'Cancel') }
                ],
                check: { text: pack.string(6022), checked: this.s.saveOnExit }
            }).then((r) => {
                const id = r && typeof r === 'object' ? r.id : r;
                if (r && typeof r === 'object' && r.checked !== this.s.saveOnExit) {
                    this.s.saveOnExit = r.checked;
                    saveSettings(this.s);
                }
                if (id === 1) {
                    this.saveGame();
                    VG.closeWindow(this.win);
                } else if (id === 2) {
                    if (this.counts()) this.record('loss');
                    store.remove('saved');
                    this.state = 'over';
                    VG.closeWindow(this.win);
                }
            });
            return false;
        }

        // the window closed: the computer stops thinking, and the next open starts a new game (and
        // offers the saved game)
        closed() {
            this.cancelThinking();
            clearTimeout(this.endTimer);
            this.hideTip();
            this.tip = null;
            this.drag = null;
            this.look = null;
            this.reopenFresh = true;
        }

        saveGame() {
            store.set('saved', {
                mode: this.mode, humanColour: this.humanColour, level: this.level,
                moves: this.moves.map((m) => core.moveText(m)), yaw: this.cameraYaw
            });
        }

        loadSaved(saved) {
            this.cancelThinking();
            this.intro = null;
            this.mode = saved.mode === 'human' ? 'human' : 'cpu';
            this.humanColour = saved.humanColour === 8 ? 8 : 0;
            this.level = Math.max(1, Math.min(10, saved.level || this.s.level));
            this.pos = core.Position.fromFEN(core.START_FEN);
            this.moves = [];
            for (const t of saved.moves || []) {
                const m = core.parseMove(this.pos, t);
                if (!m) break;
                this.pos.make(m);
                this.moves.push(m);
            }
            const last = this.moves[this.moves.length - 1];
            this.lastMove = last ? { from: core.sq64(core.mFrom(last)), to: core.sq64(core.mTo(last)) } : null;
            this.state = this.moves.length ? 'playing' : 'ready';
            this.counted = false;
            this.selected = -1;
            this.buildPieces();
            this.cameraYaw = this.mode === 'cpu' ? this.viewYawFor(this.humanColour) : (this.s.rotateHeadToHead ? this.viewYawFor(this.pos.side) : 0);
            store.remove('saved');
            const st = this.pos.status();
            if (st.over) this.state = 'over';
            this.invalidate();
            this.maybeComputer();
        }

        afterOpen() {
            const saved = store.get('saved', null);
            if (saved && saved.moves && !this.inProgress()) {
                if (this.s.continueSaved) {
                    this.intro = null;
                    this.loadSaved(saved);
                    return;
                }
                const pack = this.pack;
                VG.taskDialog({
                    owner: this.win,
                    title: pack.string(6006, 'Saved Game Found'),
                    instruction: pack.string(6007),
                    buttons: [{ id: 1, text: pack.string(6008, '&Yes'), default: true }, { id: 2, text: pack.string(6009, '&No') }],
                    check: { text: pack.string(6023), checked: this.s.continueSaved }
                }).then((r) => {
                    const id = r && typeof r === 'object' ? r.id : r;
                    if (r && typeof r === 'object' && r.checked !== this.s.continueSaved) {
                        this.s.continueSaved = r.checked;
                        saveSettings(this.s);
                    }
                    this.playIntro();
                    if (id === 1) this.loadSaved(saved);
                    else {
                        // the saved game was a game in progress: it counts as lost
                        if (saved.mode === 'cpu' && saved.moves.length) {
                            const keep = this.level;
                            this.level = saved.level || keep;
                            this.record('loss');
                            this.level = keep;
                        }
                        store.remove('saved');
                        this.showTip('start');
                    }
                });
                return;
            }
            if (!this.s.askedDifficulty) {
                this.s.askedDifficulty = true;
                saveSettings(this.s);
                const pack = this.pack;
                VG.taskDialog({
                    owner: this.win,
                    title: pack.string(182, 'Select Difficulty'),
                    instruction: pack.string(183),
                    links: [
                        VG.linkFromString(pack.string(185), 2),
                        VG.linkFromString(pack.string(186), 5),
                        VG.linkFromString(pack.string(187), 8)
                    ],
                    footer: pack.string(184),
                    width: 400
                }).then((r) => {
                    if (r === 2 || r === 5 || r === 8) {
                        this.s.level = r;
                        saveSettings(this.s);
                        this.level = r;
                    }
                    this.playIntro();
                    this.showTip('start');
                });
                return;
            }
            this.playIntro();
            if (this.state === 'ready') this.showTip('start');
        }

        // ---- dialogs ------------------------------------------------------------------------------
        statsTexts(level) {
            const pack = this.pack;
            const st = stats(level);
            const pct = (n) => (st.played ? Math.round(n * 100 / st.played) : 0);
            const streakIds = { win: [1050, 1051], draw: [1052, 1053], loss: [1054, 1055] };
            const ids = streakIds[st.streakType] || streakIds.win;
            const n = st.streakType ? st.streak : 0;
            return {
                1042: fmt(pack.string(213, 'Games played: %d'), st.played),
                1043: fmt(pack.string(214, 'Games won: %d'), st.won),
                1045: fmt(pack.string(216, 'Win percentage: %d%%'), pct(st.won)),
                1044: fmt(pack.string(215, 'Games drawn: %d'), st.drawn),
                1046: fmt(pack.string(217, 'Draw percentage: %d%%'), pct(st.drawn)),
                1047: fmt(pack.string(1047, 'Longest winning streak: %d'), st.longestWin),
                1048: fmt(pack.string(1048, 'Longest drawing streak: %d'), st.longestDraw),
                1049: fmt(pack.string(1049, 'Longest losing streak: %d'), st.longestLoss),
                1050: fmt(pack.string(n === 1 ? ids[0] : ids[1]), n)
            };
        }

        showStats() {
            const pack = this.pack;
            let current = this.level;
            const fill = (dlg) => {
                const t = this.statsTexts(current);
                Object.keys(t).forEach((id) => dlg.text(Number(id), t[id]));
                // Reset is grey while there is nothing to reset
                const all = store.get('stats', {});
                dlg.enable(1057, Object.keys(all).some((k) => all[k] && all[k].played > 0));
            };
            VG.dialog(pack, 167, {
                owner: this.win,
                title: fmt(pack.string(161, 'Chess Titans Statistics - %s'), VG.userName()),
                focus: 1076,
                init: (dlg) => {
                    const levels = [];
                    for (let i = 1; i <= 10; i++) levels.push({ value: i, text: fmt(pack.string(62161, 'Level %d'), i) });
                    dlg.setList(1076, levels, current);
                    fill(dlg);
                },
                onCommand: (id, dlg, how) => {
                    if (id === 1076 && how === 'change') {
                        current = Number(dlg.listValue(1076));
                        fill(dlg);
                        return false;
                    }
                    if (id === 1057) {
                        VG.taskDialog({
                            owner: this.win,
                            title: pack.string(6010, 'Reset Statistics'),
                            instruction: pack.string(6011),
                            buttons: [{ id: 1, text: pack.string(6012, '&Yes') }, { id: 2, text: pack.string(6013, '&No'), default: true }]
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

        // a trackbar (msctls_trackbar32) in a template slot: a range input with Vista's tick row
        trackbar(node, min, max, value, onChange) {
            if (!node) return null;
            node.textContent = '';
            node.classList.add('vista-chess-trackbar');
            const input = VG.el('input');
            input.type = 'range';
            input.min = String(min);
            input.max = String(max);
            input.step = '1';
            input.value = String(value);
            input.style.cssText = 'width:100%;margin:0;height:18px;';
            input.addEventListener('input', () => onChange && onChange(Number(input.value)));
            node.appendChild(input);
            return input;
        }

        showOptions() {
            const pack = this.pack;
            const s = this.s;
            let level = s.level;
            let quality = s.quality;
            let topDown = s.topDown;
            // quality 0 (no 3D view) checks Top down view and greys the two rotation options;
            // back above it the box shows the setting again
            const syncQualityBoxes = (dlg) => {
                const q = QUALITY[quality];
                dlg.checked(1064, q.view3d);
                dlg.checked(1063, q.highDetail);
                dlg.checked(1062, q.reflections);
                dlg.checked(1061, q.gloss);
                dlg.checked(1060, q.smooth);
                dlg.checked(1017, q.view3d ? topDown : true);
                dlg.enable(1014, q.view3d);
                dlg.enable(1019, q.view3d);
            };
            VG.dialog(pack, 164, {
                owner: this.win,
                title: 'Options',
                init: (dlg) => {
                    dlg.checked(s.playAs === 8 ? 1008 : 1007, true);
                    dlg.checked(1003, s.animations);
                    dlg.checked(1002, s.sounds);
                    dlg.checked(1015, s.tips);
                    dlg.checked(1016, s.continueSaved);
                    dlg.checked(1018, s.saveOnExit);
                    dlg.checked(1012, s.showLastMove);
                    dlg.checked(1013, s.showValidMoves);
                    dlg.checked(1014, s.rotateHeadToHead);
                    dlg.checked(1017, s.topDown);
                    dlg.checked(1019, s.rotateBack);
                    this.trackbar(dlg.get(1030), 1, 10, level, (v) => { level = v; });
                    this.trackbar(dlg.get(1031), 0, QUALITY.length - 1, quality, (v) => {
                        quality = v;
                        syncQualityBoxes(dlg);
                    });
                    syncQualityBoxes(dlg);
                },
                onCommand: (id, dlg) => {
                    if (id === 1017) {
                        if (QUALITY[quality].view3d) topDown = dlg.checked(1017);
                        return false;
                    }
                    if (id !== 1) return true;
                    const next = Object.assign({}, s);
                    const playAs = dlg.checked(1008) ? 8 : 0;
                    next.playAs = playAs;
                    next.animations = dlg.checked(1003);
                    next.sounds = dlg.checked(1002);
                    next.tips = dlg.checked(1015);
                    next.continueSaved = dlg.checked(1016);
                    next.saveOnExit = dlg.checked(1018);
                    next.showLastMove = dlg.checked(1012);
                    next.showValidMoves = dlg.checked(1013);
                    next.rotateHeadToHead = dlg.checked(1014);
                    next.topDown = topDown;
                    next.rotateBack = dlg.checked(1019);
                    next.level = level;
                    next.quality = quality;
                    const gameChanged = this.mode === 'cpu' && (next.level !== this.level || next.playAs !== this.humanColour);
                    this.applySettings(next, gameChanged);
                    return true;
                }
            });
        }

        applySettings(next, gameChanged) {
            this.s = next;
            saveSettings(next);
            this.applyQualityDefaults();
            this.syncQuality();
            this.fit();
            if (!next.tips) this.hideTip();
            if (this.mode === 'human' && next.rotateHeadToHead && !next.topDown) this.turnCamera(this.viewYawFor(this.pos.side));
            this.invalidate();
            if (!gameChanged) return;
            if (!this.inProgress()) {
                this.newGame('cpu', false);
                return;
            }
            const pack = this.pack;
            VG.taskDialog({
                owner: this.win,
                title: pack.string(115, 'Changed Game Settings'),
                instruction: pack.string(179),
                links: [VG.linkFromString(pack.string(180), 1), VG.linkFromString(pack.string(181), 2)]
            }).then((r) => {
                if (r === 1) {
                    if (this.counts()) this.record('loss');
                    this.startNew('cpu');
                }
            });
        }

        showAppearance() {
            const pack = this.pack;
            let pieces = Math.max(0, PIECE_STYLES.findIndex((p) => p.id === this.s.pieces));
            let board = Math.max(0, BOARD_STYLES.findIndex((b) => b.id === this.s.board));
            VG.dialog(pack, 500, {
                owner: this.win,
                title: 'Change Appearance',
                texts: { 5002: pack.string(62139, 'Select Piece Style'), 5003: pack.string(62140, 'Select Board'), 5004: pack.string(62141) },
                init: (dlg) => {
                    VG.fillThumbList(dlg.get(5000), PIECE_STYLES.map((p) => ({ text: pack.string(p.name), img: pack.imageUrl(p.thumb) })), pieces, (i) => { pieces = i; });
                    VG.fillThumbList(dlg.get(5001), BOARD_STYLES.map((b) => ({ text: pack.string(b.name), img: pack.imageUrl(b.thumb) })), board, (i) => { board = i; });
                    // three to a row at the thumbnails' own 131 px, as the VM shows them
                    dlg.content.querySelectorAll('.vista-game-listview').forEach((list) => {
                        list.style.justifyContent = 'space-around';
                        list.querySelectorAll('.vista-game-listview-item').forEach((cell) => { cell.style.width = '176px'; });
                        list.querySelectorAll('.vista-game-listview-item img').forEach((img) => {
                            img.style.width = '131px';
                            img.style.maxHeight = 'none';
                        });
                    });
                    dlg.checked(5004, !!this.s.randomLook);
                },
                onCommand: (id, dlg) => {
                    if (id !== 1) return true;
                    this.s.randomLook = dlg.checked(5004);
                    if (this.s.randomLook) {
                        pieces = Math.floor(Math.random() * PIECE_STYLES.length);
                        board = Math.floor(Math.random() * BOARD_STYLES.length);
                    }
                    this.s.pieces = PIECE_STYLES[pieces].id;
                    this.s.board = BOARD_STYLES[board].id;
                    saveSettings(this.s);
                    this.syncQuality();
                    this.invalidate();
                    return true;
                }
            });
        }

        showAbout() {
            VG.aboutBox({ owner: this.win, title: this.pack.string(170, 'Chess Titans'), text: this.pack.string(172), icon: '/static_images/vista-games/icons/chess-48.png' });
        }

        resultText(st) {
            const pack = this.pack;
            switch (st.result) {
            case 'checkmate': return pack.string(st.winner === core.WHITE ? 102 : 103);
            case 'resign': return pack.string(st.winner === core.WHITE ? 104 : 105);
            case 'stalemate': return pack.string(108);
            case 'fifty': return pack.string(109);
            case 'repetition': return pack.string(110);
            case 'material': return pack.string(111);
            default: return '';
            }
        }

        // Game Over: template 9 against the computer (the level's statistics), 309 head to head
        showGameOver(st) {
            const pack = this.pack;
            const cpu = this.mode === 'cpu';
            const s = stats(this.level);
            const pct = (n) => (s.played ? Math.round(n * 100 / s.played) : 0);
            VG.dialog(pack, cpu ? 9 : 309, {
                owner: this.win,
                title: pack.string(62157, 'Game Over'),
                texts: cpu ? {
                    1041: this.resultText(st),
                    1057: fmt(pack.string(178, 'Statistics for Level %d'), this.level),
                    1052: fmt(pack.string(188, 'Games played: %d'), s.played),
                    1053: fmt(pack.string(189, 'Games won: %d'), s.won),
                    1055: fmt(pack.string(190, 'Games drawn: %d'), s.drawn),
                    1054: fmt(pack.string(191, 'Percentage: %d%%'), pct(s.won)),
                    1056: fmt(pack.string(192, 'Percentage: %d%%'), pct(s.drawn))
                } : { 1041: this.resultText(st) },
                closeOn: 'any',
                onClose: (r) => {
                    if (r === 3) VG.closeWindow(this.win);
                    else if (r === 2) this.startNew(this.mode);
                }
            });
        }
    }

    function open() {
        return Promise.all([
            VG.loadPack(GAME_ID),
            loadDeps(),
            fetch(BASE + 'data3d.json', { credentials: 'same-origin' }).then((r) => r.json()),
            fetch(BASE + 'book.bin', { credentials: 'same-origin' }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
        ]).then(([pack, , data3d, bookBuf]) => {
            const created = !game;
            if (!game) game = new ChessTitans(pack, data3d, bookBuf ? new Book(bookBuf) : null);
            const first = !game.win.isOpen();
            // Randomly choose piece style and board: a new look each time the game starts
            if (created && game.s.randomLook) {
                game.s.pieces = PIECE_STYLES[Math.floor(Math.random() * PIECE_STYLES.length)].id;
                game.s.board = BOARD_STYLES[Math.floor(Math.random() * BOARD_STYLES.length)].id;
                game.syncQuality();
            }
            if (first && game.reopenFresh) {
                game.reopenFresh = false;
                game.newGame(game.s.lastMode || 'cpu', false);
            }
            return game.renderer.load().catch(() => null).then(() => {
                game.win.open();
                if (first) {
                    game.sounds.warm();
                    game.afterOpen();
                }
                return game;
            });
        });
    }

    VG.register({
        id: GAME_ID,
        name: 'Chess Titans',
        icon: '/static_images/vista-games/icons/chess',
        thumbnail: '/static_images/vista-games/chess/images/media_rgmh_thumbnail_chess.png',
        feature: 'vista_chess',
        open
    });
    root.openVistaChess = open;
    root.vistaChess = () => game;
})(typeof window !== 'undefined' ? window : globalThis);
