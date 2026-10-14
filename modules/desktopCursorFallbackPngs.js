/**
 * Tiny PNG pointers so Vista / Posy still look different when media/cursors
 * is empty (url() 404 → native keyword). Not the Microsoft / Posy binaries.
 */
const zlib = require('zlib');

const N = 32;

function blank() {
    return Buffer.alloc(N * N * 4);
}

function idx(x, y) {
    return (y * N + x) * 4;
}

function put(px, x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= N || y >= N || a <= 0) return;
    const i = idx(x, y);
    const srcA = a / 255;
    const dstA = px[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;
    px[i] = Math.round((r * srcA + px[i] * dstA * (1 - srcA)) / outA);
    px[i + 1] = Math.round((g * srcA + px[i + 1] * dstA * (1 - srcA)) / outA);
    px[i + 2] = Math.round((b * srcA + px[i + 2] * dstA * (1 - srcA)) / outA);
    px[i + 3] = Math.round(outA * 255);
}

function dot(px, x, y, r, g, b, a, radius) {
    const rad = radius || 1;
    for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
            if (dx * dx + dy * dy <= rad * rad) put(px, x + dx, y + dy, r, g, b, a);
        }
    }
}

function line(px, x0, y0, x1, y1, r, g, b, a, width) {
    const w = width || 0;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= steps; i++) {
        const x = Math.round(x0 + (dx * i) / steps);
        const y = Math.round(y0 + (dy * i) / steps);
        dot(px, x, y, r, g, b, a, w);
    }
}

function fillPoly(px, pts, r, g, b, a) {
    let minY = N;
    let maxY = 0;
    for (let i = 0; i < pts.length; i++) {
        if (pts[i][1] < minY) minY = pts[i][1];
        if (pts[i][1] > maxY) maxY = pts[i][1];
    }
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(N - 1, Math.ceil(maxY));
    for (let y = minY; y <= maxY; y++) {
        const xs = [];
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const c = pts[(i + 1) % pts.length];
            const y0 = a[1];
            const y1 = c[1];
            if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
                xs.push(a[0] + ((c[0] - a[0]) * (y - y0)) / (y1 - y0));
            }
        }
        xs.sort((p, q) => p - q);
        for (let i = 0; i + 1 < xs.length; i += 2) {
            const x0 = Math.max(0, Math.round(xs[i]));
            const x1 = Math.min(N - 1, Math.round(xs[i + 1]));
            for (let x = x0; x <= x1; x++) put(px, x, y, r, g, b, a);
        }
    }
}

function strokePoly(px, pts, r, g, b, a, width) {
    for (let i = 0; i < pts.length; i++) {
        const a0 = pts[i];
        const a1 = pts[(i + 1) % pts.length];
        line(px, a0[0], a0[1], a1[0], a1[1], r, g, b, a, width);
    }
}

function png32(px) {
    const raw = Buffer.alloc((N * 4 + 1) * N);
    for (let y = 0; y < N; y++) {
        raw[y * (N * 4 + 1)] = 0;
        px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
    }
    function chunk(tag, data) {
        const crc = zlib.crc32(Buffer.concat([tag, data]));
        const out = Buffer.alloc(12 + data.length);
        out.writeUInt32BE(data.length, 0);
        tag.copy(out, 4);
        data.copy(out, 8);
        out.writeUInt32BE(crc >>> 0, 8 + data.length);
        return out;
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(N, 0);
    ihdr.writeUInt32BE(N, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk(Buffer.from('IHDR'), ihdr),
        chunk(Buffer.from('IDAT'), zlib.deflateSync(raw, { level: 9 })),
        chunk(Buffer.from('IEND'), Buffer.alloc(0))
    ]);
}

function dataUri(px) {
    return `url("data:image/png;base64,${png32(px).toString('base64')}")`;
}

const VISTA = { ink: [0, 0, 0], fill: [255, 255, 255], glow: [70, 160, 255] };
const POSY = { ink: [20, 20, 20], fill: [248, 248, 248], glow: null };

function paintArrow(style) {
    const px = blank();
    const pts = style.glow
        ? [[1, 1], [1, 22], [7, 16], [11, 26], [16, 24], [11, 15], [20, 15]]
        : [[2, 2], [2, 23], [8, 17], [12, 27], [18, 25], [12, 16], [22, 16]];
    if (style.glow) {
        const glow = pts.map((p) => [p[0] + 2, p[1] + 2]);
        fillPoly(px, glow, style.glow[0], style.glow[1], style.glow[2], 90);
    }
    fillPoly(px, pts, style.fill[0], style.fill[1], style.fill[2], 255);
    strokePoly(px, pts, style.ink[0], style.ink[1], style.ink[2], 255, style.glow ? 0 : 1);
    return px;
}

function paintHand(style) {
    const px = blank();
    const palm = [[8, 14], [8, 26], [20, 26], [20, 16], [17, 14]];
    const fingers = [
        [[10, 14], [10, 5], [13, 5], [13, 14]],
        [[13, 14], [13, 3], [16, 3], [16, 14]],
        [[16, 15], [16, 6], [19, 6], [19, 15]],
        [[19, 16], [19, 9], [22, 9], [22, 17]]
    ];
    if (style.glow) {
        fillPoly(px, palm.map((p) => [p[0] + 1, p[1] + 1]), style.glow[0], style.glow[1], style.glow[2], 70);
    }
    fingers.forEach((f) => {
        fillPoly(px, f, style.fill[0], style.fill[1], style.fill[2], 255);
        strokePoly(px, f, style.ink[0], style.ink[1], style.ink[2], 255, 0);
    });
    fillPoly(px, palm, style.fill[0], style.fill[1], style.fill[2], 255);
    strokePoly(px, palm, style.ink[0], style.ink[1], style.ink[2], 255, 0);
    return px;
}

function paintHelp(style) {
    const px = paintArrow(style);
    const ink = style.ink;
    for (let y = 18; y < 30; y++) {
        for (let x = 18; x < 30; x++) {
            const dx = x - 23;
            const dy = y - 23;
            if (dx * dx + dy * dy <= 36) put(px, x, y, 255, 230, 80, 255);
        }
    }
    for (let a = 0; a < 360; a += 8) {
        const rad = (a * Math.PI) / 180;
        put(px, 23 + Math.round(Math.cos(rad) * 6), 23 + Math.round(Math.sin(rad) * 6), ink[0], ink[1], ink[2], 255);
    }
    line(px, 23, 20, 23, 24, ink[0], ink[1], ink[2], 255, 0);
    put(px, 23, 26, ink[0], ink[1], ink[2], 255);
    return px;
}

function paintBusy(style) {
    const px = blank();
    const ink = style.ink;
    const cx = 15;
    const cy = 15;
    if (style.glow) {
        for (let y = 2; y < 30; y++) {
            for (let x = 2; x < 30; x++) {
                const dx = x - cx;
                const dy = y - cy;
                if (dx * dx + dy * dy <= 121) put(px, x, y, style.glow[0], style.glow[1], style.glow[2], 40);
            }
        }
    }
    for (let a = 0; a < 360; a += 4) {
        const rad = (a * Math.PI) / 180;
        put(px, cx + Math.round(Math.cos(rad) * 10), cy + Math.round(Math.sin(rad) * 10), ink[0], ink[1], ink[2], 255);
        put(px, cx + Math.round(Math.cos(rad) * 11), cy + Math.round(Math.sin(rad) * 11), 220, 220, 220, 255);
    }
    line(px, cx, cy, cx, cy - 7, ink[0], ink[1], ink[2], 255, 0);
    line(px, cx, cy, cx + 5, cy + 2, ink[0], ink[1], ink[2], 255, 0);
    return px;
}

function paintWork(style) {
    const px = paintArrow(style);
    const busy = paintBusy(style);
    for (let y = 16; y < 32; y++) {
        for (let x = 16; x < 32; x++) {
            const i = idx(x, y);
            if (busy[i + 3] > 20) {
                px[i] = busy[i];
                px[i + 1] = busy[i + 1];
                px[i + 2] = busy[i + 2];
                px[i + 3] = busy[i + 3];
            }
        }
    }
    return px;
}

function paintText(style) {
    const px = blank();
    const ink = style.ink;
    const fill = style.fill;
    for (let y = 4; y < 28; y++) put(px, 15, y, fill[0], fill[1], fill[2], 255);
    line(px, 15, 4, 15, 27, ink[0], ink[1], ink[2], 255, 0);
    line(px, 10, 4, 20, 4, ink[0], ink[1], ink[2], 255, 0);
    line(px, 10, 27, 20, 27, ink[0], ink[1], ink[2], 255, 0);
    return px;
}

function paintPrecision(style) {
    const px = blank();
    const ink = style.ink;
    line(px, 15, 2, 15, 28, ink[0], ink[1], ink[2], 255, 0);
    line(px, 2, 15, 28, 15, ink[0], ink[1], ink[2], 255, 0);
    for (let a = 0; a < 360; a += 6) {
        const rad = (a * Math.PI) / 180;
        put(px, 15 + Math.round(Math.cos(rad) * 6), 15 + Math.round(Math.sin(rad) * 6), ink[0], ink[1], ink[2], 255);
    }
    return px;
}

function paintUnavail(style) {
    const px = paintArrow(style);
    const ink = [180, 30, 30];
    for (let a = 0; a < 360; a += 5) {
        const rad = (a * Math.PI) / 180;
        put(px, 22 + Math.round(Math.cos(rad) * 7), 22 + Math.round(Math.sin(rad) * 7), ink[0], ink[1], ink[2], 255);
    }
    line(px, 17, 17, 27, 27, ink[0], ink[1], ink[2], 255, 0);
    return px;
}

function paintMove(style) {
    const px = blank();
    const ink = style.ink;
    const fill = style.fill;
    line(px, 15, 3, 15, 28, ink[0], ink[1], ink[2], 255, 0);
    line(px, 3, 15, 28, 15, ink[0], ink[1], ink[2], 255, 0);
    line(px, 15, 3, 12, 7, ink[0], ink[1], ink[2], 255, 0);
    line(px, 15, 3, 18, 7, ink[0], ink[1], ink[2], 255, 0);
    line(px, 15, 28, 12, 24, ink[0], ink[1], ink[2], 255, 0);
    line(px, 15, 28, 18, 24, ink[0], ink[1], ink[2], 255, 0);
    line(px, 3, 15, 7, 12, ink[0], ink[1], ink[2], 255, 0);
    line(px, 3, 15, 7, 18, ink[0], ink[1], ink[2], 255, 0);
    line(px, 28, 15, 24, 12, ink[0], ink[1], ink[2], 255, 0);
    line(px, 28, 15, 24, 18, ink[0], ink[1], ink[2], 255, 0);
    put(px, 15, 15, fill[0], fill[1], fill[2], 255);
    return px;
}

function paintEw(style) {
    const px = blank();
    const ink = style.ink;
    line(px, 4, 15, 27, 15, ink[0], ink[1], ink[2], 255, 0);
    line(px, 4, 15, 8, 11, ink[0], ink[1], ink[2], 255, 0);
    line(px, 4, 15, 8, 19, ink[0], ink[1], ink[2], 255, 0);
    line(px, 27, 15, 23, 11, ink[0], ink[1], ink[2], 255, 0);
    line(px, 27, 15, 23, 19, ink[0], ink[1], ink[2], 255, 0);
    return px;
}

function paintNs(style) {
    const px = blank();
    const ink = style.ink;
    line(px, 15, 4, 15, 27, ink[0], ink[1], ink[2], 255, 0);
    line(px, 15, 4, 11, 8, ink[0], ink[1], ink[2], 255, 0);
    line(px, 15, 4, 19, 8, ink[0], ink[1], ink[2], 255, 0);
    line(px, 15, 27, 11, 23, ink[0], ink[1], ink[2], 255, 0);
    line(px, 15, 27, 19, 23, ink[0], ink[1], ink[2], 255, 0);
    return px;
}

function paintNwse(style) {
    const px = blank();
    const ink = style.ink;
    line(px, 6, 6, 25, 25, ink[0], ink[1], ink[2], 255, 0);
    line(px, 6, 6, 12, 6, ink[0], ink[1], ink[2], 255, 0);
    line(px, 6, 6, 6, 12, ink[0], ink[1], ink[2], 255, 0);
    line(px, 25, 25, 19, 25, ink[0], ink[1], ink[2], 255, 0);
    line(px, 25, 25, 25, 19, ink[0], ink[1], ink[2], 255, 0);
    return px;
}

function paintNesw(style) {
    const px = blank();
    const ink = style.ink;
    line(px, 25, 6, 6, 25, ink[0], ink[1], ink[2], 255, 0);
    line(px, 25, 6, 19, 6, ink[0], ink[1], ink[2], 255, 0);
    line(px, 25, 6, 25, 12, ink[0], ink[1], ink[2], 255, 0);
    line(px, 6, 25, 12, 25, ink[0], ink[1], ink[2], 255, 0);
    line(px, 6, 25, 6, 19, ink[0], ink[1], ink[2], 255, 0);
    return px;
}

function paintZoom(style, inward) {
    const px = paintArrow(style);
    const ink = style.ink;
    for (let a = 0; a < 360; a += 6) {
        const rad = (a * Math.PI) / 180;
        put(px, 22 + Math.round(Math.cos(rad) * 6), 22 + Math.round(Math.sin(rad) * 6), 255, 255, 255, 255);
        put(px, 22 + Math.round(Math.cos(rad) * 7), 22 + Math.round(Math.sin(rad) * 7), ink[0], ink[1], ink[2], 255);
    }
    line(px, 19, 22, 25, 22, ink[0], ink[1], ink[2], 255, 0);
    if (inward) line(px, 22, 19, 22, 25, ink[0], ink[1], ink[2], 255, 0);
    return px;
}

const DRAW = {
    arrow: (s) => paintArrow(s),
    link: (s) => paintHand(s),
    help: (s) => paintHelp(s),
    busy: (s) => paintBusy(s),
    work: (s) => paintWork(s),
    text: (s) => paintText(s),
    precision: (s) => paintPrecision(s),
    unavail: (s) => paintUnavail(s),
    move: (s) => paintMove(s),
    ew: (s) => paintEw(s),
    ns: (s) => paintNs(s),
    nwse: (s) => paintNwse(s),
    nesw: (s) => paintNesw(s),
    alt: (s) => paintArrow(s),
    zoomin: (s) => paintZoom(s, true),
    zoomout: (s) => paintZoom(s, false)
};

const cache = {};

function dataCursor(scheme, role, hotspot) {
    const style = scheme === 'posy' ? POSY : VISTA;
    const draw = DRAW[role] || DRAW.arrow;
    const key = `${scheme}:${role}`;
    if (!cache[key]) cache[key] = dataUri(draw(style));
    const hot = hotspot || '0 0';
    return `${cache[key]} ${hot}`;
}

module.exports = { dataCursor, DRAW, N };
