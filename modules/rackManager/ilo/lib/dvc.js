'use strict';
// HP iLO "DVC" video bit-stream decoder, ported from the Java remote console (cim.java, intgapp3_231.jar).
// One instance per console connection. Feed it decrypted bytes; it calls back into `h` (handlers).

const BITS = [0,1,1,1,1,1,2,3,5,5,1,1,3,3,8,1,1,7,1,1,3,7,1,1,8,1,7,0,1,3,7,1,4,0,0,0,1,0,1,7,7,5,5,1,8,8,1,4];
const NEXT0 = [1,2,31,2,2,10,10,10,10,41,2,33,2,2,2,16,19,39,22,20,1,1,34,25,46,26,40,1,29,1,1,36,10,2,1,35,8,37,38,1,47,42,10,43,45,45,1,1];
const NEXT1 = [1,15,3,11,11,10,10,10,10,41,11,12,2,2,2,17,18,39,23,21,1,1,28,24,46,27,40,1,30,1,1,35,10,2,1,35,9,37,38,1,47,42,10,0,45,45,24,1];
const MASK = [0,1,3,7,15,31,63,127,255];

// init_reversal(): bit reversal, index of lowest set bit ("right"), 7 - index of highest set bit ("left"); 8 for 0.
const REV = new Uint8Array(256), RIGHT = new Uint8Array(256), LEFT = new Uint8Array(256);
for (let n = 0; n < 256; n++) {
  let lo = 8, hi = 8, v = n, r = 0;
  for (let i = 0; i < 8; i++) {
    r <<= 1;
    if (v & 1) { if (lo > i) lo = i; r |= 1; hi = 7 - i; }
    v >>= 1;
  }
  REV[n] = r; RIGHT[n] = lo; LEFT[n] = hi;
}

const LATCHED = 38, HUNT = 43;

class Dvc {
  // h: { resize(w,h), paste(x,y,block,bh), flush(), cipher(n), ping(), refresh(), power(on), noVideo(),
  //      text(chan,str), seized(), licensed(v) } — all optional
  constructor(h = {}, { gen = 3 } = {}) {
    this.h = h; this.gen = gen;
    this.bits = BITS.slice();
    this.next1 = NEXT1.slice();
    this.color = new Int32Array(17); this.usage = new Int32Array(17); this.blk = new Int32Array(17);
    this.block = new Int32Array(256);
    this.cmdBuf = new Int32Array(64);
    this.bh = 16; this.halfCap = false;
    this.screenW = 0; this.screenH = 0; this.video = false; this.yClipped = 0;
    this.sizeX = 0; this.sizeY = 0;
    this.setBpc(0);            // bpc 5
    this.state = 0; this.next = 0; this.zero = 0; this.acc = 0; this.bcnt = 0;
    this.active = 0; this.pixcode = 38; this.next1[31] = 38;
    this.pixelCount = 0; this.lastx = 0; this.lasty = 0; this.newx = 0; this.newy = 0;
    this.code = 0; this.r = 0; this.g = 0; this.b = 0; this.lastColor = 0;
    this.cmdCount = 0; this.cmdLast = 0; this.timeoutCount = -1; this.countBytes = 0; this.fatal = 0;
    this.printChan = 0; this.printStr = '';
    this.errors = 0;
  }

  setBpc(v) {
    if (this.gen === 2) {   // iLO 2: fixed 12-bit colour
      this.bpc = 4; this.bits[8] = this.bits[9] = this.bits[41] = this.bits[42] = 4;
      const t = this.remap = new Int32Array(4096);
      for (let c = 0; c < 4096; c++) t[c] = (c & 0xF00) * 4352 + (c & 0xF0) * 272 + (c & 0xF) * 17;
      return;
    }
    const bpc = this.bpc = 5 - (v & 3);
    this.bits[8] = this.bits[9] = this.bits[41] = this.bits[42] = bpc;
    const n = 1 << (bpc * 3), t = this.remap = new Int32Array(n);
    for (let c = 0; c < n; c++) {
      if (bpc === 5) t[c] = ((c & 0x1F) << 3) | ((c & 0x3E0) << 6) | ((c & 0x7C00) << 9);
      else if (bpc === 4) t[c] = ((c & 0xF) << 4) | ((c & 0xF0) << 8) | ((c & 0xF00) << 12);
      else if (bpc === 3) t[c] = ((c & 0xF) << 5) | ((c & 0xF0) << 11) | ((c & 0xF00) << 15);   // as in Java
      else t[c] = ((c & 0xF) << 6) | ((c & 0xF0) << 15) | ((c & 0xF00) << 18);
    }
  }

  setHalfHeight() {
    if (this.screenW > 1616) {
      if (this.halfCap && this.bh !== 8) { this.bh = 8; this.bits[17] = this.bits[21] = this.bits[30] = this.bits[39] = 8; }
    } else if (this.bh !== 16) {
      this.bh = 16; this.bits[17] = this.bits[21] = this.bits[30] = this.bits[39] = 7;
    }
  }

  setPixcode() {
    const a = this.active;
    this.pixcode = a < 2 ? 38 : a === 2 ? 4 : a === 3 ? 5 : a < 6 ? 6 : a < 10 ? 7 : 32;
    this.next1[31] = this.pixcode;
  }

  cacheLru(c) {
    let n = this.active, idx = 0, found = 0;
    for (let i = 0; i < n; i++) {
      if (c === this.color[i]) { idx = i; found = 1; break; }
      if (this.usage[i] === n - 1) idx = i;
    }
    let u = this.usage[idx];
    if (!found) {
      if (n < 17) { idx = n; u = n; n++; this.active = n; this.setPixcode(); }
      this.color[idx] = c;
    }
    this.blk[idx] = 1;
    for (let i = 0; i < n; i++) if (this.usage[i] < u) this.usage[i]++;
    this.usage[idx] = 0;
    return found;
  }

  cacheFind(k) {
    const n = this.active;
    for (let i = 0; i < n; i++) {
      if (this.usage[i] === k) {
        const col = this.color[i];
        for (let j = 0; j < n; j++) if (this.usage[j] < k) this.usage[j]++;
        this.usage[i] = 0; this.blk[i] = 1;
        return col;
      }
    }
    return -1;
  }

  cachePrune() {
    let n = this.active, i = 0;
    while (i < n) {
      if (this.blk[i] === 0) {
        n--;
        this.blk[i] = this.blk[n]; this.color[i] = this.color[n]; this.usage[i] = this.usage[n];
        continue;
      }
      this.blk[i]--; i++;
    }
    this.active = n; this.setPixcode();
  }

  nextBlock(n) {
    if (this.pixelCount !== 0 && this.yClipped > 0 && this.lasty === this.sizeY) {
      const c = this.remap[0];
      for (let i = this.yClipped; i < 256; i++) this.block[i] = c;
    }
    this.pixelCount = 0;
    this.next = 1;
    let x = this.lastx * 16; const y = this.lasty * this.bh;
    while (n !== 0) {
      if (this.video && this.h.paste) this.h.paste(x, y, this.block, this.bh);
      x += 16;
      if (++this.lastx >= this.sizeX) break;
      n--;
    }
  }

  getBits(n) {
    if (n === 1) { this.code = this.acc & 1; this.acc >>>= 1; this.bcnt--; return; }
    if (n === 0) return;
    const v = this.acc & MASK[n];
    this.bcnt -= n; this.acc >>>= n;
    this.code = REV[v] >> (8 - n);
  }

  emit(col) {
    if (this.pixelCount >= this.bh * 16) { this.next = LATCHED; return false; }
    this.block[this.pixelCount++] = col;
    return true;
  }

  // Feed one decrypted byte. Returns 0 normally.
  feed(c) {
    const err = this.processBits(c);
    if (err !== 0) {
      this.errors++;
      this.state = this.next = LATCHED; this.fatal = 0;
      if (this.h.refresh) this.h.refresh();
    }
    return err;
  }

  processBits(c) {
    this.acc |= c << this.bcnt; this.bcnt += 8;
    if ((this.zero += RIGHT[c]) > 30) { this.next = this.state = HUNT; }
    else if (c !== 0) this.zero = LEFT[c];
    this.countBytes++;
    const BH16 = () => this.bh * 16;
    for (;;) {
      const st = this.state, n = this.bits[st];
      if (n > this.bcnt) return 0;
      this.getBits(n);
      this.next = this.code === 0 ? NEXT0[st] : this.next1[st];
      switch (st) {
        case 3: case 4: case 5: case 6: case 7: case 32: {
          if (this.active === 1) this.code = this.usage[0];
          else if (st === 4) this.code = 0;
          else if (st === 3) this.code = 1;
          else if (this.code !== 0) this.code++;
          const col = this.cacheFind(this.code);
          if (col === -1) { this.next = LATCHED; break; }
          this.lastColor = this.remap[col];
          this.emit(this.lastColor);
          break;
        }
        case 12: {
          if (this.code === 7) { this.next = 14; break; }
          if (this.code === 6) { this.next = 13; break; }
          const k = this.code + 2;
          for (let i = 0; i < k; i++) if (!this.emit(this.lastColor)) break;
          break;
        }
        case 13: case 14: {
          const k = st === 13 ? this.code + 8 : this.code;
          for (let i = 0; i < k; i++) if (!this.emit(this.lastColor)) break;
          break;
        }
        case 33: this.emit(this.lastColor); break;
        case 35: this.next = this.pixcode; break;
        case 9: this.r = this.code << (this.bpc * 2); break;
        case 41: this.g = this.code << this.bpc; break;
        case 8: case 42: {
          if (st === 8) { this.r = this.code << (this.bpc * 2); this.g = this.code << this.bpc; }
          this.b = this.code;
          const col = this.r | this.g | this.b;
          if (this.cacheLru(col) !== 0) { this.next = LATCHED; break; }
          this.lastColor = this.remap[col];
          this.emit(this.lastColor);
          break;
        }
        case 17: case 26:
          this.newx = this.code;
          if (st === 17 && this.newx > this.sizeX) this.newx = 0;
          break;
        case 39:
          this.newy = this.code;
          if (this.bh === 16) this.newy &= 0x7F;
          this.lastx = this.newx; this.lasty = this.newy;
          if (this.gen === 2 && this.lasty > this.sizeY) this.lasty = 0;
          break;
        case 20: case 21: {
          let v = this.code;
          if (st === 20) v = this.lastx + this.code + 1;
          this.lastx = v;
          if (this.bh === 16) this.lastx &= 0x7F;
          if (this.gen === 2 && this.lastx > this.sizeX) this.lastx = 0;
          break;
        }
        case 27:
          if (this.timeoutCount === this.countBytes - 1) this.next = LATCHED;
          if ((this.bcnt & 7) !== 0) this.getBits(this.bcnt & 7);
          this.timeoutCount = this.countBytes;
          if (this.h.flush) this.h.flush();
          break;
        case 24:
          if (this.cmdCount !== 0 && this.cmdCount <= 64) this.cmdBuf[this.cmdCount - 1] = this.cmdLast;
          this.cmdCount++;
          this.cmdLast = this.code;
          break;
        case 46: {
          if (this.code !== 0) break;
          const p = this.cmdBuf, h = this.h;
          if (this.gen === 2) {
            switch (this.cmdLast) {
              case 1: this.next = 37; break;
              case 2: this.next = 44; break;
              case 6: if (h.noVideo) h.noVideo(); break;          // video suspended
              case 9: if ((this.bcnt & 7) !== 0) this.getBits(this.bcnt & 7); if (h.rekey) h.rekey(); break;
              case 10: if (h.seized) h.seized(); break;
            }
            this.cmdCount = 0;
            break;
          }
          switch (this.cmdLast) {
            case 1: this.next = 37; break;
            case 2: this.next = 44; break;
            case 4: if (h.power) h.power(true); break;
            case 5: if (h.power) h.power(false); break;
            case 6: if (h.noVideo) h.noVideo(); break;
            case 9: if ((this.bcnt & 7) !== 0) this.getBits(this.bcnt & 7); break;
            case 10: if (h.seized) h.seized(); break;
            case 11: this.setBpc(p[0]); break;
            case 12: if (h.cipher) h.cipher(p[0]); break;
            case 13:
              this.setBpc(p[0]);
              if (h.cipher) h.cipher(p[1]);
              if (h.licensed) h.licensed(p[2] & 1);
              this.halfCap = (p[3] & 8) !== 0;
              break;
            case 16: if (h.ping) h.ping(); break;
            case 128: if (h.flush) h.flush(); break;
          }
          this.cmdCount = 0;
          break;
        }
        case 44: this.printChan = this.code; this.printStr = ''; break;
        case 45:
          if (this.code !== 0) { this.printStr += String.fromCharCode(this.code); break; }
          if (this.h.text) this.h.text(this.printChan, this.printStr);
          this.next = 1;
          break;
        case 0:
          this.active = 0; this.pixelCount = 0; this.lastx = 0; this.lasty = 0;
          this.r = this.g = this.b = 0; this.fatal = 0; this.timeoutCount = -1; this.cmdCount = 0;
          break;
        case 38:
          this.fatal++;
          if (this.fatal === 41 || this.fatal === 11681 || this.fatal === 120000) { if (this.h.refresh) this.h.refresh(); }
          if (this.fatal >= 12000000) { if (this.h.refresh) this.h.refresh(); this.fatal = 41; }
          break;
        case 34: this.nextBlock(1); break;
        case 29: case 30: this.nextBlock(st === 29 ? this.code + 2 : this.code); break;
        case 40: this.sizeX = this.newx; this.sizeY = this.code; break;
        case 47:
          this.lastx = this.lasty = 0; this.pixelCount = 0; this.active = 0;
          this.screenW = this.sizeX * 16;
          this.screenH = this.sizeY * 16 + this.code;
          this.video = this.screenW !== 0 && this.screenH !== 0;
          this.yClipped = this.code > 0 ? 256 - 16 * this.code : 0;
          if (!this.video) { if (this.h.noVideo) this.h.noVideo(); break; }
          if (this.gen !== 2) this.setHalfHeight();
          if (this.h.resize) this.h.resize(this.screenW, this.screenH);
          break;
        case 43:
          if (this.next === st) break;
          this.acc = 0; this.bcnt = 0; this.zero = 0; this.countBytes = 0;
          break;
        case 37:
          return 1;
        default: break;   // 1 2 10 11 15 16 18 19 22 23 25 28 31 36
      }
      if (this.next === 2 && this.pixelCount === BH16()) { this.nextBlock(1); this.cachePrune(); }
      if (st === this.next && st !== 45 && st !== LATCHED && st !== HUNT) return 6;
      this.state = this.next;
    }
  }
}

module.exports = { Dvc };
