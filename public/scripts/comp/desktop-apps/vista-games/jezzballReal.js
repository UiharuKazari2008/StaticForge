// JezzBall's Turbo Pascal 6-byte Real (JezzBallCore.Real), ported from the System unit linked into
// JEZZBALL.EXE and checked against that machine code run in an 8086 interpreter (23,897 operations,
// no mismatch). The cleared area is a sum of n / 560 terms that drifts below the exact value, so the
// level only ends at 421 cells when they come one at a time and every exact 5% step reads one lower;
// the clone keeps area, score and bonus in this format, in the original's order of operations.
(function (root) {
    'use strict';

    // Turbo Pascal for Windows 6-byte Real, bit-exact with the System unit linked into JEZZBALL.EXE
    // (seg9: add 0508 / sub 0504, mul 05cb, div 06d0, cmp 0747, int->real 0771, Trunc/Round 07b0).
    // A Real is its 6 memory bytes [exp, m0, m1, m2, m3, m4|sign]: exp biased 129 (0 = zero), 39-bit
    // fraction with an implicit leading 1, sign in bit 7 of the last byte. Registers as the RTL holds
    // them: AX = bytes 0-1 (AL exp, AH lowest mantissa byte), BX = bytes 2-3, DX = bytes 4-5.
    // Errors the RTL raises as runtime errors (205 overflow, 200 division by zero, 207 invalid
    // Trunc/Round) throw a RangeError with the TP error number.

    function r48Regs(r) { return [r[0] | (r[1] << 8), r[2] | (r[3] << 8), r[4] | (r[5] << 8)]; }
    function r48Bytes(ax, bx, dx) { return [ax & 255, (ax >> 8) & 255, bx & 255, (bx >> 8) & 255, dx & 255, (dx >> 8) & 255]; }
    function r48Error(code) { const e = new RangeError('Runtime error ' + code); e.tpError = code; throw e; }

    const ZERO = [0, 0, 0, 0, 0, 0];

    // 0508 (A in DX:BX:AX, B in DI:SI:CX). A 48-bit mantissa (40 + 8 guard bits) is kept as a Number
    // (exact below 2^53).
    function r48AddRegs(ax, bx, dx, cx, si, di) {
        let ea = ax & 255, eb = cx & 255;
        if (eb === 0) return [ax, bx, dx];
        if (ea === 0) return [cx, si, di];
        if (ea > eb) { [ax, bx, dx, cx, si, di] = [cx, si, di, ax, bx, dx]; [ea, eb] = [eb, ea]; }
        const d = eb - ea;
        if (d >= 40) return [cx, si, di];
        const signA = dx & 0x8000, diff = (dx ^ di) & 0x8000;
        // A: DX|0x8000 : BX : AH : guard 00, shifted right by d (bits below the guard byte are lost)
        let a = ((dx | 0x8000) * 2 ** 32) + bx * 65536 + (ax & 0xff00);
        a = Math.floor(a / 2 ** d);
        const b = ((di | 0x8000) * 2 ** 32) + si * 65536 + (cx & 0xff00);
        let exp = eb, sign = signA, m;
        const M48 = 2 ** 48;
        if (!diff) {
            m = a + b;
            if (m >= M48) { m = Math.floor(m / 2); exp++; if (exp > 255) r48Error(205); }
        } else {
            m = a - b;
            if (m < 0) { m = -m; sign ^= 0x8000; }
            if (m === 0) return [0, 0, 0];
            while (m < 2 ** 47) { m *= 2; exp--; if (exp === 0) return [0, 0, 0]; }
        }
        return r48Finish(m, exp, sign);
    }

    // 0575: round half up on the guard byte, store exponent and sign
    function r48Finish(m, exp, sign) {
        m += 0x80;
        if (m >= 2 ** 48) { m = 2 ** 47; exp++; if (exp > 255) r48Error(205); }
        const dx = Math.floor(m / 2 ** 32), bx = Math.floor(m / 65536) % 65536, ah = Math.floor(m / 256) % 256;
        return [(ah << 8) | exp, bx, (dx & 0x7fff) | sign];
    }

    // 06aa..06c8: shared tail of mul / div. cxv is the 16-bit CX after the bias step, m the 48-bit
    // mantissa DX:BX:AX with the guard byte in AL.
    function r48Tail(m, cxv) {
        m += 0x80;
        if (m >= 2 ** 48) { m = 2 ** 47; cxv = (cxv + 1) & 0xffff; }
        let ch = cxv >> 8;
        if (ch & 0x40) return [0, 0, 0];
        cxv = (cxv + 1) & 0xffff;
        ch = cxv >> 8;
        const exp = cxv & 255;
        let dx = Math.floor(m / 2 ** 32);
        const bx = Math.floor(m / 65536) % 65536, ah = Math.floor(m / 256) % 256;
        dx ^= ch << 8;
        if (ch & 1) r48Error(205);
        return [(ah << 8) | exp, bx, dx & 0xffff];
    }

    function r48MulRegs(ax, bx, dx, cx, si, di) {
        if ((ax & 255) === 0 || (cx & 255) === 0) return [0, 0, 0];
        let sx = ((dx ^ di) & 0x8000) + (ax & 255) + (cx & 255); // DX after the add/adc at 05de
        // operands as 16-bit words: A = BP:BX:AH00, B = DI:SI:CH00
        let A = [ax & 0xff00, bx, dx | 0x8000], B = [cx & 0xff00, si, di | 0x8000];
        let w3, w4, w5;
        const aLowZero = (ax & 0xff00) === 0 && bx === 0, bLowZero = (cx & 0xff00) === 0 && si === 0;
        if (aLowZero || bLowZero) {
            // 0602: one operand is just its top word; that word's low byte times the other's low byte
            // is dropped
            if (!aLowZero) { const t = A; A = B; B = t; }
            const bp = A[2], ch = B[0] >> 8;
            let acc3 = (bp >> 8) * ch;                 // bx
            const p1 = bp * B[1];                       // dx:ax
            acc3 += p1 % 65536;
            let carry = acc3 >= 65536 ? 1 : 0;
            acc3 %= 65536;
            const c4 = Math.floor(p1 / 65536) + carry;  // cx
            const p2 = bp * B[2];
            const lo = (p2 % 65536) + c4;
            w4 = lo % 65536;
            w5 = (Math.floor(p2 / 65536) + (lo >= 65536 ? 1 : 0)) % 65536;
            w3 = acc3;
        } else {
            // 0621: full product of the 48-bit words, words 0-2 only feed carries
            const P = (BigInt(A[2]) << 32n | BigInt(A[1]) << 16n | BigInt(A[0])) *
                      (BigInt(B[2]) << 32n | BigInt(B[1]) << 16n | BigInt(B[0]));
            w3 = Number((P >> 48n) & 0xffffn); w4 = Number((P >> 64n) & 0xffffn); w5 = Number((P >> 80n) & 0xffffn);
        }
        let m = w5 * 2 ** 32 + w4 * 65536 + w3;
        let cxv = sx;
        if (w5 < 0x8000) { m *= 2; cxv = (cxv - 1) & 0xffff; }
        cxv = (cxv - 0x8081) & 0xffff;
        return r48Tail(m, cxv);
    }

    function r48DivRegs(ax, bx, dx, cx, si, di) {
        if ((cx & 255) === 0) r48Error(200);
        if ((ax & 255) === 0) return [0, 0, 0];
        // DX = sign | (expA - expB) with the borrow into DH (05d4..06e9)
        let sx = (((dx ^ di) & 0x8000) + (ax & 255) - (cx & 255)) & 0xffff;
        let rem = ((dx | 0x8000) * 2 ** 24) + bx * 256 + ((ax >> 8) & 255); // BP:BX:AH, 40 bits
        const dv = ((di | 0x8000) * 2 ** 24) + si * 256 + ((cx >> 8) & 255);
        const T40 = 2 ** 40;
        let q = 0; // 42 quotient bits, MSB first
        for (let i = 0; i < 42; i++) {
            let bit;
            if (i === 0) {
                bit = rem >= dv ? 1 : 0;
                if (bit) rem -= dv;
            } else {
                rem *= 2;
                if (rem >= T40) { rem -= T40; rem = rem + T40 - dv; bit = 1; } // carry out: always subtract
                else { bit = rem >= dv ? 1 : 0; if (bit) rem -= dv; }
            }
            q = q * 2 + bit;
        }
        // DX = q bits 0-15, BX = 16-31, AX = bits 32-41 << 6 with the low 6 bits set (the NOT at 0730)
        let m = q * 64 + 63;
        let cxv = sx;
        if (m < 2 ** 47) { m = (m - 63) * 2 + 126; cxv = (cxv - 1) & 0xffff; }
        cxv = (cxv + 0x8080) & 0xffff;
        return r48Tail(m, cxv);
    }

    // 0747: -1 a<b, 0 equal, 1 a>b (CF / ZF as the RTL leaves them)
    function r48CmpRegs(ax, bx, dx, cx, si, di) {
        if ((dx ^ di) & 0x8000) return (dx & 0x8000) ? -1 : 1;
        const mag = () => {
            if ((ax & 255) !== (cx & 255)) return (ax & 255) < (cx & 255) ? -1 : 1;
            if ((ax & 255) === 0) return 0;
            if (dx !== di) return dx < di ? -1 : 1;
            if (bx !== si) return bx < si ? -1 : 1;
            if ((ax >> 8) !== (cx >> 8)) return (ax >> 8) < (cx >> 8) ? -1 : 1;
            return 0;
        };
        const c = mag();
        return (dx & 0x8000) ? -c : c;
    }

    function fromInt(n) {
        n |= 0;
        if (n === 0) return ZERO.slice();
        const neg = n < 0;
        let v = Math.abs(n); // up to 2^31
        let exp = 0xa0, m = v; // DX:BX as a 32-bit value
        while (m < 2 ** 31) { m *= 2; exp--; }
        const dx = Math.floor(m / 65536), bx = m % 65536;
        return r48Bytes(exp, bx, neg ? dx : dx & 0x7fff);
    }

    // 07b0: CH = 0 Trunc, 1 Round (half away from zero); the lowest mantissa byte is not looked at
    function r48ToInt(r, round) {
        const [ax, bx, dx] = r48Regs(r);
        const e = ax & 255;
        if (e > 0x9f) r48Error(207);
        let cl = 0x9f - e;
        if (cl > 0x1f) return 0;
        cl++;
        const v = (dx | 0x8000) * 65536 + bx; // DX:AX after the xchg
        let n = Math.floor(v / 2 ** cl);
        const half = Math.floor(v / 2 ** (cl - 1)) & 1;
        if (half && round) { n++; if (n >= 2 ** 31) r48Error(207); }
        return (dx & 0x8000) ? -n : n;
    }

    function binop(fn) {
        return (a, b) => { const A = r48Regs(a), B = r48Regs(b); const [ax, bx, dx] = fn(A[0], A[1], A[2], B[0], B[1], B[2]); return r48Bytes(ax, bx, dx); };
    }

    const add = binop(r48AddRegs);
    const sub = (a, b) => { const c = b.slice(); c[5] ^= 0x80; return add(a, c); }; // 0504 flips B's sign
    const mul = binop(r48MulRegs);
    const div = binop(r48DivRegs);
    const cmp = (a, b) => { const A = r48Regs(a), B = r48Regs(b); return r48CmpRegs(A[0], A[1], A[2], B[0], B[1], B[2]); };
    const trunc = (a) => r48ToInt(a, false);
    const round = (a) => r48ToInt(a, true);
    const fromBytes = (b) => Array.from(b, (x) => x & 255);
    function toNumber(r) {
        if (!r[0]) return 0;
        const m = (r[5] & 0x7f | 0x80) * 2 ** 32 + r[4] * 2 ** 24 + r[3] * 2 ** 16 + r[2] * 256 + r[1];
        return (r[5] & 0x80 ? -1 : 1) * m * 2 ** (r[0] - 129 - 39);
    }

    const JZ = root.JezzBallCore || (root.JezzBallCore = {});
    JZ.Real = { ZERO, fromInt, add, sub, mul, div, cmp, trunc, round, fromBytes, toNumber };
})(typeof window !== 'undefined' ? window : globalThis);
