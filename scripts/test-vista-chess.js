#!/usr/bin/env node
/**
 * Chess Titans rules tests (Yozora #609): perft of the start position and of "Kiwipete" (the
 * position that exercises castling, en passant and promotions) to depth 3, mate / stalemate /
 * draw detection, castling rights, en passant, promotion, and that the computer finds a mate in
 * one and takes a hanging queen.
 *
 *   node scripts/test-vista-chess.js
 */
const path = require('path');
const core = require(path.join(__dirname, '../public/scripts/comp/desktop-apps/vista-games/chessEngine.js'));

let failed = 0;
const check = (name, ok, detail) => {
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  (' + detail + ')' : ''));
    if (!ok) failed++;
};
const pos = (fen) => core.Position.fromFEN(fen);
const has = (p, text) => !!core.parseMove(p, text);

// ---- perft -----------------------------------------------------------------------------
const PERFT = [
    { name: 'start', fen: core.START_FEN, counts: [20, 400, 8902, 197281] },
    { name: 'kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', counts: [48, 2039, 97862] },
    { name: 'position 3', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', counts: [14, 191, 2812, 43238] },
    { name: 'position 4', fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', counts: [6, 264, 9467] },
    { name: 'position 5', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', counts: [44, 1486, 62379] }
];
PERFT.forEach((t) => {
    const p = pos(t.fen);
    t.counts.forEach((want, i) => {
        const t0 = Date.now();
        const got = core.perft(p, i + 1);
        check('perft ' + t.name + ' depth ' + (i + 1), got === want, got + ' / ' + want + ', ' + (Date.now() - t0) + ' ms');
    });
    check('perft ' + t.name + ' leaves the position as it was', p.fen() === pos(t.fen).fen());
});

// ---- FEN round trip ------------------------------------------------------------------------
PERFT.forEach((t) => check('fen round trip ' + t.name, pos(t.fen).fen() === pos(t.fen).fen() && pos(t.fen).fen().split(' ').slice(0, 4).join(' ') === t.fen.split(' ').slice(0, 4).join(' ')));

// ---- mate / stalemate / draws ----------------------------------------------------------------
{
    // fool's mate
    const p = pos(core.START_FEN);
    ['f2f3', 'e7e5', 'g2g4', 'd8h4'].forEach((m) => p.make(core.parseMove(p, m)));
    const s = p.status();
    check('fool\'s mate is checkmate, black wins', s.over && s.result === 'checkmate' && s.winner === core.BLACK, s.result);
}
{
    const s = pos('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').status();
    check('stalemate', s.over && s.result === 'stalemate', s.result);
}
{
    const s = pos('8/8/4k3/8/8/3NK3/8/8 w - - 0 1').status();
    check('K+N v K is insufficient material', s.over && s.result === 'material', s.result);
    const s2 = pos('8/8/4k3/8/8/3RK3/8/8 w - - 0 1').status();
    check('K+R v K is not', !s2.over);
    const s3 = pos('8/3b4/4k3/8/8/3BK3/8/8 w - - 0 1').status();
    check('K+B v K+B same colour is insufficient', s3.over && s3.result === 'material', s3.result);
    const s4 = pos('8/2b5/4k3/8/8/3BK3/8/8 w - - 0 1').status();
    check('K+B v K+B opposite colours is not', !s4.over);
}
{
    const s = pos('8/8/4k3/8/8/3RK3/8/8 w - - 100 80').status();
    check('fifty-move rule', s.over && s.result === 'fifty', s.result);
}
{
    const p = pos(core.START_FEN);
    let s = null;
    ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'].forEach((m) => {
        p.make(core.parseMove(p, m));
        s = p.status();
    });
    check('threefold repetition', s.over && s.result === 'repetition', s.result);
}

// ---- castling rights -------------------------------------------------------------------------
{
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const p = pos(fen);
    check('both castles available', has(p, 'e1g1') && has(p, 'e1c1'));
    p.make(core.parseMove(p, 'h1h2'));
    p.make(core.parseMove(p, 'a8a7'));
    check('rook moved: king side gone, queen side stays', !has(p, 'e1g1') && has(p, 'e1c1'), p.fen().split(' ')[2]);
    const q = pos(fen);
    q.make(core.parseMove(q, 'e1f1'));
    q.make(core.parseMove(q, 'e8f8'));
    q.make(core.parseMove(q, 'f1e1'));
    q.make(core.parseMove(q, 'f8e8'));
    check('king moved and back: no castling', !has(q, 'e1g1') && !has(q, 'e1c1'), q.fen().split(' ')[2]);
    check('cannot castle out of check', !has(pos('r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1'), 'e1g1'));
    check('cannot castle through check', !has(pos('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1'), 'e1g1'));
    check('cannot castle into check', !has(pos('r3k2r/8/8/8/8/8/6r1/R3K2R w KQkq - 0 1'), 'e1g1'));
    check('queen side: b1 attacked is fine', has(pos('r3k2r/8/8/8/8/8/1r6/R3K2R w KQkq - 0 1'), 'e1c1'));
    check('queen side blocked by a piece on b1', !has(pos('r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1'), 'e1c1'));
    const c = pos(fen);
    c.make(core.parseMove(c, 'e1g1'));
    check('castling moves the rook', c.b[core.sqParse('f1')] === (core.R | core.WHITE) && c.b[core.sqParse('h1')] === 0 && c.b[core.sqParse('g1')] === (core.K | core.WHITE));
    c.unmake();
    check('undo castling', c.fen() === pos(fen).fen());
    const cap = pos('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
    cap.make(core.parseMove(cap, 'a8a1'));
    check('capturing a rook takes its castling right', cap.fen().split(' ')[2] === 'Kk', cap.fen().split(' ')[2]);
}

// ---- en passant ---------------------------------------------------------------------------
{
    const p = pos('4k3/8/8/8/1p6/8/P7/4K3 w - - 0 1');
    p.make(core.parseMove(p, 'a2a4'));
    check('double push sets the en passant square', p.fen().split(' ')[3] === 'a3', p.fen());
    check('en passant capture is legal', has(p, 'b4a3'));
    const m = core.parseMove(p, 'b4a3');
    p.make(m);
    check('en passant removes the pawn', p.b[core.sqParse('a4')] === 0 && p.b[core.sqParse('a3')] === (core.P | core.BLACK));
    p.unmake();
    check('undo en passant', p.b[core.sqParse('a4')] === (core.P | core.WHITE) && p.b[core.sqParse('b4')] === (core.P | core.BLACK));
    const late = pos('4k3/8/8/8/1p6/8/P6P/4K3 w - - 0 1');
    late.make(core.parseMove(late, 'a2a4'));
    late.make(core.parseMove(late, 'e8d8'));
    late.make(core.parseMove(late, 'h2h3'));
    check('en passant only right after the push', !has(late, 'b4a3'));
    check('en passant that exposes the king is illegal', !has(pos('8/8/8/K1pP3r/8/8/8/4k3 w - c6 0 2'), 'd5c6'));
}

// ---- promotion -----------------------------------------------------------------------------
{
    const p = pos('8/P6k/8/8/8/8/8/4K3 w - - 0 1');
    const promos = p.legalMoves().filter((m) => core.mFrom(m) === core.sqParse('a7')).map((m) => core.mPromo(m)).sort();
    check('four promotion choices', promos.join() === [core.N, core.B, core.R, core.Q].join(), promos.join());
    p.make(core.parseMove(p, 'a7a8n'));
    check('under-promotion to a knight', p.b[core.sqParse('a8')] === (core.N | core.WHITE));
    p.unmake();
    check('undo promotion', p.b[core.sqParse('a7')] === (core.P | core.WHITE) && p.b[core.sqParse('a8')] === 0);
    const cp = pos('1r5k/P7/8/8/8/8/8/4K3 w - - 0 1');
    check('capture promotion', has(cp, 'a7b8q') && has(cp, 'a7a8q'));
}

// ---- the computer ----------------------------------------------------------------------------
{
    const p = pos('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
    const r = core.think(p, { level: 8 });
    check('level 8 finds the back-rank mate', core.moveText(r.move) === 'd1d8', core.moveText(r.move));
    const q = pos('4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1');
    const r2 = core.think(q, { level: 5, noise: 0 });
    check('takes a hanging queen', core.moveText(r2.move) === 'd2d5', core.moveText(r2.move));
    const t0 = Date.now();
    const start = pos(core.START_FEN);
    const r3 = core.think(start, { level: 10, time: 1500 });
    check('level 10 keeps to its time', Date.now() - t0 < 2600 && !!r3.move, (Date.now() - t0) + ' ms, depth ' + r3.depth + ', ' + r3.nodes + ' nodes, ' + core.moveText(r3.move));
    const easy = pos(core.START_FEN);
    const moves = new Set();
    for (let i = 0; i < 6; i++) moves.add(core.moveText(core.think(easy, { level: 1 }).move));
    check('level 1 varies its play', moves.size > 1, [...moves].join(' '));
}

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
