/**
 * Build a Windows .ico from PNG images (Yozora #640), so the app's icon can be compiled into its
 * EXE stub (csc /win32icon). Image data only; no executable code.
 *
 *   buildIco([{ size, rgba }, ...])  -> Buffer   a .ico: 16/32/48 as 32-bit DIBs, 256 as PNG
 *
 * Small sizes are DIB (BMP) entries, as Vista icons are; 256 is embedded as PNG. `rgba` is raw
 * RGBA pixels (size*size*4); callers get them from sharp. `png` may be given instead for 256.
 */
'use strict';

const align4 = (n) => Math.ceil(n / 4) * 4;

/** A 32-bit DIB icon image: BITMAPINFOHEADER, bottom-up BGRA, then the 1-bit AND mask. */
function dibImage(size, rgba) {
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(size, 4);
    header.writeInt32LE(size * 2, 8); // height counts the XOR bitmap and the AND mask
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    const xor = Buffer.alloc(size * size * 4);
    const maskRow = align4(Math.ceil(size / 8));
    const and = Buffer.alloc(maskRow * size);
    for (let y = 0; y < size; y++) {
        const dy = size - 1 - y;
        for (let x = 0; x < size; x++) {
            const s = (y * size + x) * 4;
            const d = (dy * size + x) * 4;
            xor[d] = rgba[s + 2]; xor[d + 1] = rgba[s + 1]; xor[d + 2] = rgba[s]; xor[d + 3] = rgba[s + 3];
            if (rgba[s + 3] === 0) and[dy * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
        }
    }
    header.writeUInt32LE(xor.length + and.length, 20);
    return Buffer.concat([header, xor, and]);
}

function buildIco(images) {
    const entries = images
        .filter((im) => im && (im.rgba || im.png) && im.size > 0)
        .map((im) => ({
            size: im.size,
            data: im.png ? Buffer.from(im.png) : (im.size >= 256 ? null : dibImage(im.size, im.rgba))
        }))
        .filter((e) => e.data);
    if (!entries.length) throw new Error('no icon images');
    const dir = Buffer.alloc(6 + entries.length * 16);
    dir.writeUInt16LE(0, 0);
    dir.writeUInt16LE(1, 2); // type: icon
    dir.writeUInt16LE(entries.length, 4);
    let offset = dir.length;
    entries.forEach((e, i) => {
        const at = 6 + i * 16;
        dir.writeUInt8(e.size >= 256 ? 0 : e.size, at);
        dir.writeUInt8(e.size >= 256 ? 0 : e.size, at + 1);
        dir.writeUInt8(0, at + 2); // colours
        dir.writeUInt8(0, at + 3);
        dir.writeUInt16LE(1, at + 4); // planes
        dir.writeUInt16LE(32, at + 6); // bit count
        dir.writeUInt32LE(e.data.length, at + 8);
        dir.writeUInt32LE(offset, at + 12);
        offset += e.data.length;
    });
    return Buffer.concat([dir, ...entries.map((e) => e.data)]);
}

module.exports = { buildIco, dibImage };
