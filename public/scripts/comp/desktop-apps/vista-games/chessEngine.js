// Chess Titans, the rules and the computer player (Yozora #609). Chess.dll's own engine is native
// code we cannot run, so this is a small 0x88 engine of our own: complete rules (castling, en
// passant, promotion, check / mate / stalemate, the fifty-move rule, threefold repetition,
// insufficient material) and an alpha-beta search (iterative deepening, principal variation
// search, a transposition table, null-move pruning, killer / history ordering, quiescence) whose
// strength follows the game's ten difficulty levels.
//
// Everything lives in one self-contained function, chessCore(): the game calls it on the page for
// the rules and runs a second copy in a Web Worker (built from chessCore.toString() into a Blob,
// see VistaChessCore.createWorker) for the search, so the window stays smooth while the computer
// thinks. scripts/test-vista-chess.js loads this file in node for the perft / rules tests.
(function (root) {
    'use strict';

    function chessCore() {
        // pieces: type | colour (0 white, 8 black); squares: 0x88 (rank * 16 + file, a1 = 0)
        const P = 1;
        const N = 2;
        const B = 3;
        const R = 4;
        const Q = 5;
        const K = 6;
        const WHITE = 0;
        const BLACK = 8;
        const KNIGHT_D = [33, 31, 18, 14, -33, -31, -18, -14];
        const BISHOP_D = [17, 15, -17, -15];
        const ROOK_D = [16, -16, 1, -1];
        const KING_D = [17, 15, -17, -15, 16, -16, 1, -1];
        // castling rights: 1 white king side, 2 white queen side, 4 black king side, 8 black queen side
        const CASTLE_MASK = new Int8Array(128).fill(15);
        CASTLE_MASK[0] = 15 & ~2;
        CASTLE_MASK[7] = 15 & ~1;
        CASTLE_MASK[4] = 15 & ~3;
        CASTLE_MASK[112] = 15 & ~8;
        CASTLE_MASK[119] = 15 & ~4;
        CASTLE_MASK[116] = 15 & ~12;

        // moves: from | to << 7 | promotion type << 14 | flags << 17
        const F_CAPTURE = 1;
        const F_EP = 2;
        const F_CASTLE = 4;
        const F_DOUBLE = 8;
        const mv = (from, to, promo, flags) => from | (to << 7) | (promo << 14) | (flags << 17);
        const mFrom = (m) => m & 127;
        const mTo = (m) => (m >> 7) & 127;
        const mPromo = (m) => (m >> 14) & 7;
        const mFlags = (m) => (m >> 17) & 15;

        const sq88 = (s64) => (s64 >> 3) * 16 + (s64 & 7);
        const sq64 = (s) => (s >> 4) * 8 + (s & 7);
        const sqName = (s) => 'abcdefgh'[s & 7] + ((s >> 4) + 1);
        const sqParse = (t) => (t.charCodeAt(1) - 49) * 16 + (t.charCodeAt(0) - 97);

        // ---- zobrist keys (two 32-bit halves) ---------------------------------------------
        let seed = 0x2f6b4c1d;
        const rnd = () => {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            return seed | 0;
        };
        const Z_LO = new Int32Array(16 * 128);
        const Z_HI = new Int32Array(16 * 128);
        for (let i = 0; i < Z_LO.length; i++) {
            Z_LO[i] = rnd();
            Z_HI[i] = rnd();
        }
        const Z_SIDE_LO = rnd();
        const Z_SIDE_HI = rnd();
        const Z_CASTLE_LO = new Int32Array(16);
        const Z_CASTLE_HI = new Int32Array(16);
        const Z_EP_LO = new Int32Array(8);
        const Z_EP_HI = new Int32Array(8);
        for (let i = 0; i < 16; i++) {
            Z_CASTLE_LO[i] = rnd();
            Z_CASTLE_HI[i] = rnd();
        }
        for (let i = 0; i < 8; i++) {
            Z_EP_LO[i] = rnd();
            Z_EP_HI[i] = rnd();
        }

        // ---- position --------------------------------------------------------------------
        class Position {
            constructor() {
                this.b = new Int8Array(128);
                this.side = WHITE;
                this.castle = 0;
                this.ep = -1;
                this.half = 0;
                this.full = 1;
                this.kings = [0, 0];
                this.lo = 0;
                this.hi = 0;
                this.undo = [];
                this.histLo = []; // hash of every earlier position, for repetitions
                this.histHi = [];
            }

            static fromFEN(fen) {
                const p = new Position();
                const parts = String(fen).trim().split(/\s+/);
                let r = 7;
                let f = 0;
                for (const ch of parts[0]) {
                    if (ch === '/') {
                        r--;
                        f = 0;
                    } else if (/\d/.test(ch)) f += Number(ch);
                    else {
                        const type = 'pnbrqk'.indexOf(ch.toLowerCase()) + 1;
                        const colour = ch === ch.toLowerCase() ? BLACK : WHITE;
                        p.b[r * 16 + f] = type | colour;
                        if (type === K) p.kings[colour >> 3] = r * 16 + f;
                        f++;
                    }
                }
                p.side = parts[1] === 'b' ? BLACK : WHITE;
                const c = parts[2] || '-';
                p.castle = (c.includes('K') ? 1 : 0) | (c.includes('Q') ? 2 : 0) | (c.includes('k') ? 4 : 0) | (c.includes('q') ? 8 : 0);
                p.ep = parts[3] && parts[3] !== '-' ? sqParse(parts[3]) : -1;
                p.half = parseInt(parts[4], 10) || 0;
                p.full = parseInt(parts[5], 10) || 1;
                p.rehash();
                return p;
            }

            fen() {
                let s = '';
                for (let r = 7; r >= 0; r--) {
                    let empty = 0;
                    for (let f = 0; f < 8; f++) {
                        const pc = this.b[r * 16 + f];
                        if (!pc) {
                            empty++;
                            continue;
                        }
                        if (empty) s += empty;
                        empty = 0;
                        const ch = 'pnbrqk'[(pc & 7) - 1];
                        s += pc & BLACK ? ch : ch.toUpperCase();
                    }
                    if (empty) s += empty;
                    if (r) s += '/';
                }
                const c = (this.castle & 1 ? 'K' : '') + (this.castle & 2 ? 'Q' : '') + (this.castle & 4 ? 'k' : '') + (this.castle & 8 ? 'q' : '');
                return s + ' ' + (this.side ? 'b' : 'w') + ' ' + (c || '-') + ' ' + (this.ep >= 0 ? sqName(this.ep) : '-') + ' ' + this.half + ' ' + this.full;
            }

            clone() {
                const p = new Position();
                p.b.set(this.b);
                p.side = this.side;
                p.castle = this.castle;
                p.ep = this.ep;
                p.half = this.half;
                p.full = this.full;
                p.kings = this.kings.slice();
                p.lo = this.lo;
                p.hi = this.hi;
                p.histLo = this.histLo.slice();
                p.histHi = this.histHi.slice();
                return p;
            }

            rehash() {
                let lo = 0;
                let hi = 0;
                for (let s = 0; s < 128; s++) {
                    if (s & 0x88) continue;
                    const pc = this.b[s];
                    if (pc) {
                        lo ^= Z_LO[pc * 128 + s];
                        hi ^= Z_HI[pc * 128 + s];
                    }
                }
                if (this.side) {
                    lo ^= Z_SIDE_LO;
                    hi ^= Z_SIDE_HI;
                }
                lo ^= Z_CASTLE_LO[this.castle];
                hi ^= Z_CASTLE_HI[this.castle];
                if (this.ep >= 0) {
                    lo ^= Z_EP_LO[this.ep & 7];
                    hi ^= Z_EP_HI[this.ep & 7];
                }
                this.lo = lo;
                this.hi = hi;
            }

            // is square s attacked by colour `by`?
            attacked(s, by) {
                const b = this.b;
                // pawns
                if (by === WHITE) {
                    if (!((s - 15) & 0x88) && b[s - 15] === (P | WHITE)) return true;
                    if (!((s - 17) & 0x88) && b[s - 17] === (P | WHITE)) return true;
                } else {
                    if (!((s + 15) & 0x88) && b[s + 15] === (P | BLACK)) return true;
                    if (!((s + 17) & 0x88) && b[s + 17] === (P | BLACK)) return true;
                }
                for (let i = 0; i < 8; i++) {
                    const t = s + KNIGHT_D[i];
                    if (!(t & 0x88) && b[t] === (N | by)) return true;
                }
                for (let i = 0; i < 8; i++) {
                    const t = s + KING_D[i];
                    if (!(t & 0x88) && b[t] === (K | by)) return true;
                }
                for (let i = 0; i < 4; i++) {
                    const d = BISHOP_D[i];
                    for (let t = s + d; !(t & 0x88); t += d) {
                        const pc = b[t];
                        if (pc) {
                            if ((pc & 8) === by && ((pc & 7) === B || (pc & 7) === Q)) return true;
                            break;
                        }
                    }
                }
                for (let i = 0; i < 4; i++) {
                    const d = ROOK_D[i];
                    for (let t = s + d; !(t & 0x88); t += d) {
                        const pc = b[t];
                        if (pc) {
                            if ((pc & 8) === by && ((pc & 7) === R || (pc & 7) === Q)) return true;
                            break;
                        }
                    }
                }
                return false;
            }

            inCheck(colour) {
                const c = colour === undefined ? this.side : colour;
                return this.attacked(this.kings[c >> 3], c ^ 8);
            }

            // pseudo-legal moves into `out` (an array); captures only for quiescence
            gen(out, capturesOnly) {
                const b = this.b;
                const us = this.side;
                const them = us ^ 8;
                for (let s = 0; s < 128; s++) {
                    if (s & 0x88) {
                        s += 7;
                        continue;
                    }
                    const pc = b[s];
                    if (!pc || (pc & 8) !== us) continue;
                    const type = pc & 7;
                    if (type === P) {
                        const fwd = us === WHITE ? 16 : -16;
                        const startRank = us === WHITE ? 1 : 6;
                        const lastRank = us === WHITE ? 7 : 0;
                        const t = s + fwd;
                        if (!(t & 0x88) && !b[t]) {
                            if ((t >> 4) === lastRank) {
                                for (let pr = Q; pr >= N; pr--) out.push(mv(s, t, pr, 0));
                            } else if (!capturesOnly) {
                                out.push(mv(s, t, 0, 0));
                                if ((s >> 4) === startRank && !b[t + fwd]) out.push(mv(s, t + fwd, 0, F_DOUBLE));
                            }
                        }
                        for (const side of [-1, 1]) {
                            const c = t + side;
                            if (c & 0x88) continue;
                            if (b[c] && (b[c] & 8) === them) {
                                if ((c >> 4) === lastRank) {
                                    for (let pr = Q; pr >= N; pr--) out.push(mv(s, c, pr, F_CAPTURE));
                                } else out.push(mv(s, c, 0, F_CAPTURE));
                            } else if (c === this.ep) out.push(mv(s, c, 0, F_CAPTURE | F_EP));
                        }
                        continue;
                    }
                    if (type === N || type === K) {
                        const dirs = type === N ? KNIGHT_D : KING_D;
                        for (let i = 0; i < 8; i++) {
                            const t = s + dirs[i];
                            if (t & 0x88) continue;
                            const q = b[t];
                            if (!q) {
                                if (!capturesOnly) out.push(mv(s, t, 0, 0));
                            } else if ((q & 8) === them) out.push(mv(s, t, 0, F_CAPTURE));
                        }
                        if (type === K && !capturesOnly) this.genCastles(out, s);
                        continue;
                    }
                    const dirs = type === B ? BISHOP_D : (type === R ? ROOK_D : KING_D);
                    for (let i = 0; i < dirs.length; i++) {
                        const d = dirs[i];
                        for (let t = s + d; !(t & 0x88); t += d) {
                            const q = b[t];
                            if (!q) {
                                if (!capturesOnly) out.push(mv(s, t, 0, 0));
                                continue;
                            }
                            if ((q & 8) === them) out.push(mv(s, t, 0, F_CAPTURE));
                            break;
                        }
                    }
                }
                return out;
            }

            genCastles(out, s) {
                const b = this.b;
                const us = this.side;
                const them = us ^ 8;
                const home = us === WHITE ? 4 : 116;
                if (s !== home) return;
                const kingSide = us === WHITE ? 1 : 4;
                const queenSide = us === WHITE ? 2 : 8;
                if (!(this.castle & (kingSide | queenSide))) return;
                if (this.attacked(s, them)) return;
                if ((this.castle & kingSide) && !b[s + 1] && !b[s + 2] && b[s + 3] === (R | us)
                    && !this.attacked(s + 1, them) && !this.attacked(s + 2, them)) out.push(mv(s, s + 2, 0, F_CASTLE));
                if ((this.castle & queenSide) && !b[s - 1] && !b[s - 2] && !b[s - 3] && b[s - 4] === (R | us)
                    && !this.attacked(s - 1, them) && !this.attacked(s - 2, them)) out.push(mv(s, s - 2, 0, F_CASTLE));
            }

            // play a move; false (and nothing changed) when it leaves the mover's king in check
            make(m) {
                const b = this.b;
                const from = mFrom(m);
                const to = mTo(m);
                const flags = mFlags(m);
                const pc = b[from];
                const us = this.side;
                let captured = b[to];
                let capSq = to;
                if (flags & F_EP) {
                    capSq = to + (us === WHITE ? -16 : 16);
                    captured = b[capSq];
                }
                this.undo.push({ m, captured, capSq, castle: this.castle, ep: this.ep, half: this.half, lo: this.lo, hi: this.hi });
                this.histLo.push(this.lo);
                this.histHi.push(this.hi);
                let lo = this.lo;
                let hi = this.hi;
                lo ^= Z_CASTLE_LO[this.castle];
                hi ^= Z_CASTLE_HI[this.castle];
                if (this.ep >= 0) {
                    lo ^= Z_EP_LO[this.ep & 7];
                    hi ^= Z_EP_HI[this.ep & 7];
                }
                if (captured) {
                    b[capSq] = 0;
                    lo ^= Z_LO[captured * 128 + capSq];
                    hi ^= Z_HI[captured * 128 + capSq];
                }
                b[from] = 0;
                lo ^= Z_LO[pc * 128 + from];
                hi ^= Z_HI[pc * 128 + from];
                const promo = mPromo(m);
                const placed = promo ? (promo | us) : pc;
                b[to] = placed;
                lo ^= Z_LO[placed * 128 + to];
                hi ^= Z_HI[placed * 128 + to];
                if ((pc & 7) === K) {
                    this.kings[us >> 3] = to;
                    if (flags & F_CASTLE) {
                        const rf = to > from ? from + 3 : from - 4;
                        const rt = to > from ? from + 1 : from - 1;
                        const rook = b[rf];
                        b[rf] = 0;
                        b[rt] = rook;
                        lo ^= Z_LO[rook * 128 + rf] ^ Z_LO[rook * 128 + rt];
                        hi ^= Z_HI[rook * 128 + rf] ^ Z_HI[rook * 128 + rt];
                    }
                }
                this.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
                this.ep = flags & F_DOUBLE ? (from + to) >> 1 : -1;
                lo ^= Z_CASTLE_LO[this.castle];
                hi ^= Z_CASTLE_HI[this.castle];
                if (this.ep >= 0) {
                    lo ^= Z_EP_LO[this.ep & 7];
                    hi ^= Z_EP_HI[this.ep & 7];
                }
                this.half = (pc & 7) === P || captured ? 0 : this.half + 1;
                if (us === BLACK) this.full++;
                this.side = us ^ 8;
                lo ^= Z_SIDE_LO;
                hi ^= Z_SIDE_HI;
                this.lo = lo;
                this.hi = hi;
                if (this.attacked(this.kings[us >> 3], us ^ 8)) {
                    this.unmake();
                    return false;
                }
                return true;
            }

            unmake() {
                const u = this.undo.pop();
                if (!u) return;
                this.histLo.pop();
                this.histHi.pop();
                const b = this.b;
                const m = u.m;
                const from = mFrom(m);
                const to = mTo(m);
                const flags = mFlags(m);
                this.side ^= 8;
                const us = this.side;
                if (us === BLACK) this.full--;
                let pc = b[to];
                if (mPromo(m)) pc = P | us;
                b[from] = pc;
                b[to] = 0;
                if (u.captured) b[u.capSq] = u.captured;
                if ((pc & 7) === K) {
                    this.kings[us >> 3] = from;
                    if (flags & F_CASTLE) {
                        const rf = to > from ? from + 3 : from - 4;
                        const rt = to > from ? from + 1 : from - 1;
                        b[rf] = b[rt];
                        b[rt] = 0;
                    }
                }
                this.castle = u.castle;
                this.ep = u.ep;
                this.half = u.half;
                this.lo = u.lo;
                this.hi = u.hi;
            }

            // a null move for the search (side to move passes)
            makeNull() {
                this.undo.push({ m: -1, castle: this.castle, ep: this.ep, half: this.half, lo: this.lo, hi: this.hi });
                this.histLo.push(this.lo);
                this.histHi.push(this.hi);
                let lo = this.lo ^ Z_SIDE_LO;
                let hi = this.hi ^ Z_SIDE_HI;
                if (this.ep >= 0) {
                    lo ^= Z_EP_LO[this.ep & 7];
                    hi ^= Z_EP_HI[this.ep & 7];
                }
                this.ep = -1;
                this.side ^= 8;
                this.half++;
                this.lo = lo;
                this.hi = hi;
            }

            unmakeNull() {
                const u = this.undo.pop();
                this.histLo.pop();
                this.histHi.pop();
                this.side ^= 8;
                this.ep = u.ep;
                this.half = u.half;
                this.lo = u.lo;
                this.hi = u.hi;
            }

            legalMoves() {
                const out = [];
                const list = this.gen([], false);
                for (const m of list) {
                    if (this.make(m)) {
                        out.push(m);
                        this.unmake();
                    }
                }
                return out;
            }

            // how often the current position occurred before (since the last irreversible move)
            repetitions() {
                let n = 0;
                const len = this.histLo.length;
                for (let i = len - 2; i >= 0 && i >= len - this.half; i -= 2) {
                    if (this.histLo[i] === this.lo && this.histHi[i] === this.hi) n++;
                }
                return n;
            }

            // K v K, K+minor v K, K+B v K+B with the bishops on one colour
            insufficient() {
                const minors = [];
                for (let s = 0; s < 128; s++) {
                    if (s & 0x88) continue;
                    const pc = this.b[s];
                    if (!pc) continue;
                    const t = pc & 7;
                    if (t === K) continue;
                    if (t === P || t === R || t === Q) return false;
                    minors.push({ t, colour: pc & 8, shade: ((s >> 4) + (s & 7)) & 1 });
                }
                if (minors.length <= 1) return true;
                if (minors.every((m) => m.t === B)) return minors.every((m) => m.shade === minors[0].shade);
                return false;
            }

            // { over, result, winner }: result checkmate | stalemate | fifty | repetition | material
            status() {
                const moves = this.legalMoves();
                if (!moves.length) {
                    if (this.inCheck()) return { over: true, result: 'checkmate', winner: this.side ^ 8, moves };
                    return { over: true, result: 'stalemate', winner: -1, moves };
                }
                if (this.insufficient()) return { over: true, result: 'material', winner: -1, moves };
                if (this.half >= 100) return { over: true, result: 'fifty', winner: -1, moves };
                if (this.repetitions() >= 2) return { over: true, result: 'repetition', winner: -1, moves };
                return { over: false, result: '', winner: -1, moves };
            }
        }

        const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

        function perft(pos, depth) {
            if (depth === 0) return 1;
            const list = pos.gen([], false);
            let n = 0;
            for (const m of list) {
                if (!pos.make(m)) continue;
                n += depth === 1 ? 1 : perft(pos, depth - 1);
                pos.unmake();
            }
            return n;
        }

        // "e2e4", "e7e8q" -> the legal move, or 0
        function parseMove(pos, text) {
            const t = String(text).trim().toLowerCase();
            const from = sqParse(t.slice(0, 2));
            const to = sqParse(t.slice(2, 4));
            const promo = t[4] ? 'pnbrqk'.indexOf(t[4]) + 1 : 0;
            return pos.legalMoves().find((m) => mFrom(m) === from && mTo(m) === to && (mPromo(m) === promo || (!promo && mPromo(m) === Q))) || 0;
        }

        const moveText = (m) => sqName(mFrom(m)) + sqName(mTo(m)) + (mPromo(m) ? 'pnbrqk'[mPromo(m) - 1] : '');

        // ---- evaluation (material + piece-square tables, king tables tapered by phase) -----
        const VALUE = [0, 100, 320, 330, 500, 900, 0];
        // white's view, a8 first (row 0 = rank 8)
        const PST_SRC = {
            1: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
                0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
            2: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
                -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
            3: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
                -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
            4: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
                -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
            5: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
                0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
            6: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
                -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
            7: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
                -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50]
        };
        // PST[type][colour][sq88]; type 7 = king endgame
        const PST = [];
        for (let t = 1; t <= 7; t++) {
            PST[t] = [new Int16Array(128), new Int16Array(128)];
            for (let i = 0; i < 64; i++) {
                const rank = 7 - (i >> 3);
                const file = i & 7;
                PST[t][0][rank * 16 + file] = PST_SRC[t][i];
                PST[t][1][(7 - rank) * 16 + file] = PST_SRC[t][i];
            }
        }
        const PHASE = [0, 0, 1, 1, 2, 4, 0];

        function evaluate(pos) {
            const b = pos.b;
            let mg = 0;
            let kingMg = 0;
            let kingEg = 0;
            let phase = 0;
            let bishops = [0, 0];
            for (let s = 0; s < 128; s++) {
                if (s & 0x88) {
                    s += 7;
                    continue;
                }
                const pc = b[s];
                if (!pc) continue;
                const t = pc & 7;
                const c = pc >> 3;
                const sign = c ? -1 : 1;
                phase += PHASE[t];
                if (t === K) {
                    kingMg += sign * PST[6][c][s];
                    kingEg += sign * PST[7][c][s];
                    continue;
                }
                if (t === B) bishops[c]++;
                mg += sign * (VALUE[t] + PST[t][c][s]);
            }
            if (bishops[0] >= 2) mg += 30;
            if (bishops[1] >= 2) mg -= 30;
            const ph = Math.min(24, phase);
            const score = mg + Math.round((kingMg * ph + kingEg * (24 - ph)) / 24);
            return pos.side === WHITE ? score : -score;
        }

        // ---- search ------------------------------------------------------------------------
        const MATE = 30000;
        const INF = 32000;
        const TT_BITS = 18;
        const TT_SIZE = 1 << TT_BITS;
        const TT_MASK = TT_SIZE - 1;
        let ttHi = null;
        let ttMove = null;
        let ttData = null; // score (16) | depth (8) | flag (2) packed
        const ensureTT = () => {
            if (ttHi) return;
            ttHi = new Int32Array(TT_SIZE);
            ttMove = new Int32Array(TT_SIZE);
            ttData = new Int32Array(TT_SIZE);
        };
        const TT_EXACT = 1;
        const TT_LOWER = 2;
        const TT_UPPER = 3;

        class Searcher {
            constructor(pos, opts) {
                ensureTT();
                this.pos = pos;
                this.deadline = opts.deadline || Infinity;
                this.nodes = 0;
                this.stop = false;
                this.killers = [];
                for (let i = 0; i < 128; i++) this.killers.push([0, 0]);
                this.history = new Int32Array(16 * 128);
                this.rootPly = pos.histLo.length;
            }

            timeUp() {
                if ((this.nodes & 1023) === 0 && Date.now() > this.deadline) this.stop = true;
                return this.stop;
            }

            ttProbe() {
                const i = this.pos.lo & TT_MASK;
                if (ttHi[i] !== this.pos.hi || !ttData[i]) return null;
                const d = ttData[i];
                return { move: ttMove[i], score: (d >> 16), depth: (d >> 2) & 255, flag: d & 3 };
            }

            ttStore(depth, score, flag, move) {
                const i = this.pos.lo & TT_MASK;
                ttHi[i] = this.pos.hi;
                ttMove[i] = move;
                ttData[i] = (score << 16) | ((depth & 255) << 2) | flag;
            }

            order(list, ttm, ply) {
                const b = this.pos.b;
                const k = this.killers[ply] || [0, 0];
                const scores = list.map((m) => {
                    if (m === ttm) return 1e7;
                    const f = mFlags(m);
                    if (f & F_CAPTURE) {
                        const victim = f & F_EP ? P : (b[mTo(m)] & 7);
                        const attacker = b[mFrom(m)] & 7;
                        return 1e6 + VALUE[victim] * 10 - VALUE[attacker] / 10 + (mPromo(m) ? 5000 : 0);
                    }
                    if (mPromo(m)) return 9e5 + mPromo(m);
                    if (m === k[0]) return 8e5;
                    if (m === k[1]) return 7e5;
                    return this.history[(b[mFrom(m)] & 15) * 128 + mTo(m)];
                });
                const idx = list.map((_, i) => i).sort((a, c) => scores[c] - scores[a]);
                return idx.map((i) => list[i]);
            }

            quiesce(alpha, beta, ply) {
                this.nodes++;
                if (this.timeUp()) return 0;
                const pos = this.pos;
                const stand = evaluate(pos);
                if (stand >= beta) return stand;
                if (stand > alpha) alpha = stand;
                if (ply > 60) return stand;
                const list = this.order(pos.gen([], true), 0, Math.min(ply, 127));
                for (const m of list) {
                    // delta pruning: a capture that cannot lift the score near alpha
                    const f = mFlags(m);
                    const victim = f & F_EP ? P : (pos.b[mTo(m)] & 7);
                    if (!mPromo(m) && stand + VALUE[victim] + 200 < alpha) continue;
                    if (!pos.make(m)) continue;
                    const score = -this.quiesce(-beta, -alpha, ply + 1);
                    pos.unmake();
                    if (this.stop) return 0;
                    if (score >= beta) return score;
                    if (score > alpha) alpha = score;
                }
                return alpha;
            }

            search(depth, alpha, beta, ply, allowNull) {
                const pos = this.pos;
                if (ply > 0) {
                    if (pos.half >= 100 || pos.insufficient()) return 0;
                    // a repetition inside the search (or of a game position) counts as a draw
                    const len = pos.histLo.length;
                    for (let i = len - 2; i >= 0 && i >= len - pos.half; i -= 2) {
                        if (pos.histLo[i] === pos.lo && pos.histHi[i] === pos.hi) return 0;
                    }
                }
                const inCheck = pos.inCheck();
                if (inCheck) depth++;
                if (depth <= 0) return this.quiesce(alpha, beta, ply);
                this.nodes++;
                if (this.timeUp()) return 0;
                const alphaIn = alpha;
                const tt = this.ttProbe();
                let ttm = 0;
                if (tt) {
                    ttm = tt.move;
                    if (ply > 0 && tt.depth >= depth) {
                        let s = tt.score;
                        if (s > MATE - 200) s -= ply;
                        else if (s < -MATE + 200) s += ply;
                        if (tt.flag === TT_EXACT) return s;
                        if (tt.flag === TT_LOWER && s >= beta) return s;
                        if (tt.flag === TT_UPPER && s <= alpha) return s;
                    }
                }
                // null move: when passing still beats beta, this node is not worth a full look
                if (allowNull && !inCheck && depth >= 3 && ply > 0 && beta - alpha === 1 && this.hasPieces(pos.side)) {
                    pos.makeNull();
                    const score = -this.search(depth - 3, -beta, -beta + 1, ply + 1, false);
                    pos.unmakeNull();
                    if (this.stop) return 0;
                    if (score >= beta) return beta;
                }
                const list = this.order(pos.gen([], false), ttm, Math.min(ply, 127));
                let best = -INF;
                let bestMove = 0;
                let legal = 0;
                for (const m of list) {
                    if (!pos.make(m)) continue;
                    legal++;
                    let score;
                    const quiet = !(mFlags(m) & F_CAPTURE) && !mPromo(m);
                    if (legal === 1) score = -this.search(depth - 1, -beta, -alpha, ply + 1, true);
                    else {
                        // late quiet moves get a reduced look first
                        let r = 0;
                        if (quiet && !inCheck && depth >= 3 && legal > 4 && !pos.inCheck()) r = 1;
                        score = -this.search(depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
                        if (score > alpha && (r || score < beta)) score = -this.search(depth - 1, -beta, -alpha, ply + 1, true);
                    }
                    pos.unmake();
                    if (this.stop) return 0;
                    if (score > best) {
                        best = score;
                        bestMove = m;
                    }
                    if (score > alpha) {
                        alpha = score;
                        if (ply === 0) this.rootBest = m;
                    }
                    if (alpha >= beta) {
                        if (quiet) {
                            const k = this.killers[Math.min(ply, 127)];
                            if (k[0] !== m) {
                                k[1] = k[0];
                                k[0] = m;
                            }
                            this.history[(pos.b[mFrom(m)] & 15) * 128 + mTo(m)] += depth * depth;
                        }
                        break;
                    }
                }
                if (!legal) return inCheck ? -MATE + ply : 0;
                let stored = best;
                if (stored > MATE - 200) stored += ply;
                else if (stored < -MATE + 200) stored -= ply;
                this.ttStore(depth, stored, best >= beta ? TT_LOWER : (best > alphaIn ? TT_EXACT : TT_UPPER), bestMove);
                return best;
            }

            hasPieces(side) {
                const b = this.pos.b;
                for (let s = 0; s < 128; s++) {
                    if (s & 0x88) continue;
                    const pc = b[s];
                    if (pc && (pc & 8) === side && (pc & 7) !== P && (pc & 7) !== K) return true;
                }
                return false;
            }
        }

        // The ten levels of the Options slider: how deep and how long the computer looks, and how
        // far its root choice may stray from the best score (the easy levels make human mistakes).
        const LEVELS = [
            null,
            { depth: 1, time: 300, noise: 350 },
            { depth: 1, time: 400, noise: 180 },
            { depth: 2, time: 500, noise: 110 },
            { depth: 2, time: 600, noise: 60 },
            { depth: 3, time: 800, noise: 35 },
            { depth: 4, time: 1000, noise: 18 },
            { depth: 5, time: 1500, noise: 8 },
            { depth: 6, time: 2000, noise: 0 },
            { depth: 8, time: 3000, noise: 0 },
            { depth: 64, time: 5000, noise: 0 }
        ];

        // best move for the side to move: { move, score, depth, nodes }
        function think(pos, opts) {
            opts = opts || {};
            const level = LEVELS[Math.max(1, Math.min(10, opts.level || 5))];
            const maxDepth = opts.depth || level.depth;
            const time = opts.time || level.time;
            const noise = opts.noise === undefined ? level.noise : opts.noise;
            const random = opts.random || Math.random;
            const legal = pos.legalMoves();
            if (!legal.length) return { move: 0, score: 0, depth: 0, nodes: 0 };
            if (legal.length === 1) return { move: legal[0], score: 0, depth: 0, nodes: 0 };
            const s = new Searcher(pos, { deadline: Date.now() + time });
            if (noise > 0) {
                // every root move scored at the level's depth, then a noisy pick
                const scored = [];
                for (const m of legal) {
                    pos.make(m);
                    const sc = -s.search(maxDepth - 1, -INF, INF, 1, true);
                    pos.unmake();
                    scored.push({ m, sc: sc + (random() * 2 - 1) * noise });
                }
                // never miss a mate in one, never step into one when the level can see it
                scored.sort((a, c) => c.sc - a.sc);
                return { move: scored[0].m, score: Math.round(scored[0].sc), depth: maxDepth, nodes: s.nodes };
            }
            let best = legal[0];
            let bestScore = 0;
            let reached = 0;
            for (let d = 1; d <= maxDepth; d++) {
                s.rootBest = 0;
                const score = s.search(d, -INF, INF, 0, false);
                if (s.stop) {
                    // a partial iteration still found something better than the last full one
                    if (s.rootBest) best = s.rootBest;
                    break;
                }
                best = s.rootBest || best;
                bestScore = score;
                reached = d;
                if (Math.abs(score) > MATE - 200) break;
                // the next depth would not finish in time
                if (Date.now() > s.deadline - time * 0.55) break;
            }
            return { move: best, score: bestScore, depth: reached, nodes: s.nodes };
        }

        // replay "startFen + moves" into a position with its history
        function replay(fen, moves) {
            const pos = Position.fromFEN(fen || START_FEN);
            (moves || []).forEach((m) => pos.make(m));
            pos.undo = [];
            return pos;
        }

        return {
            P, N, B, R, Q, K, WHITE, BLACK, F_CAPTURE, F_EP, F_CASTLE, F_DOUBLE, START_FEN, LEVELS,
            Position, mv, mFrom, mTo, mPromo, mFlags, sq88, sq64, sqName, sqParse,
            perft, parseMove, moveText, evaluate, think, replay
        };
    }

    // ---- the computer player in a Web Worker ------------------------------------------------
    // worker.think({ fen, moves, level }) -> Promise<{ move, score, depth, nodes }>
    function createWorker() {
        let worker = null;
        try {
            const src = 'const core = (' + chessCore.toString() + ')();\n'
                + 'self.onmessage = (e) => { const d = e.data; const pos = core.replay(d.fen, d.moves);'
                + ' const r = core.think(pos, { level: d.level, time: d.time, depth: d.depth });'
                + ' self.postMessage({ id: d.id, move: r.move, score: r.score, depth: r.depth, nodes: r.nodes }); };';
            const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
            worker = new Worker(url);
            URL.revokeObjectURL(url);
        } catch (_) {
            worker = null; // no workers: think on the page (the window pauses while it does)
        }
        let seq = 0;
        const pending = new Map();
        if (worker) {
            worker.onmessage = (e) => {
                const p = pending.get(e.data.id);
                if (p) {
                    pending.delete(e.data.id);
                    p(e.data);
                }
            };
        }
        const local = chessCore();
        return {
            think(job) {
                if (!worker) {
                    const pos = local.replay(job.fen, job.moves);
                    return Promise.resolve(local.think(pos, job));
                }
                const id = ++seq;
                return new Promise((resolve) => {
                    pending.set(id, resolve);
                    worker.postMessage(Object.assign({ id }, job));
                });
            },
            // a new game / undo while the computer thinks: forget its answer
            cancel() {
                pending.clear();
            },
            terminate() {
                pending.clear();
                if (worker) worker.terminate();
                worker = null;
            }
        };
    }

    const api = chessCore();
    api.core = chessCore;
    api.createWorker = createWorker;
    root.VistaChessCore = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
