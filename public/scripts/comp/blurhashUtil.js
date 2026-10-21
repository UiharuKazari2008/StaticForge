/**
 * Client BlurHash decode helpers (gallery / workspace placeholders).
 * Server encode: modules/blurhashUtils.js
 */
(function (global) {
    const DIGIT_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

    function decode83(str) {
        let value = 0;
        for (let i = 0; i < str.length; i++) {
            const digit = DIGIT_CHARS.indexOf(str[i]);
            value = value * 83 + digit;
        }
        return value;
    }

    function srgbToLinear(value) {
        const v = value / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }

    function linearToSrgb(value) {
        const v = Math.max(0, Math.min(1, value));
        return v <= 0.0031308
            ? Math.trunc(v * 12.92 * 255 + 0.5)
            : Math.trunc((1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255 + 0.5);
    }

    function signPow(val, exp) {
        return (val < 0 ? -1 : 1) * Math.pow(Math.abs(val), exp);
    }

    function decodeDC(value) {
        const r = value >> 16;
        const g = (value >> 8) & 255;
        const b = value & 255;
        return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
    }

    function decodeAC(value, maxVal) {
        const quantR = Math.floor(value / 361);
        const quantG = Math.floor(value / 19) % 19;
        const quantB = value % 19;
        return [
            signPow((quantR - 9) / 9, 2) * maxVal,
            signPow((quantG - 9) / 9, 2) * maxVal,
            signPow((quantB - 9) / 9, 2) * maxVal
        ];
    }

    function validateBlurhash(blurhash) {
        if (!blurhash || blurhash.length < 6) {
            throw new Error('The blurhash string must be at least 6 characters');
        }
        const sizeFlag = decode83(blurhash[0]);
        const numY = Math.floor(sizeFlag / 9) + 1;
        const numX = (sizeFlag % 9) + 1;
        if (blurhash.length !== 4 + 2 * numX * numY) {
            throw new Error(
                `blurhash length mismatch: length is ${blurhash.length} but it should be ${4 + 2 * numX * numY}`
            );
        }
    }

    function blurhashIsValid(blurhash) {
        try {
            validateBlurhash(blurhash);
            return true;
        } catch (_) {
            return false;
        }
    }

    function blurhashDecode(blurhash, width, height, punch) {
        validateBlurhash(blurhash);
        punch = punch || 1;
        const sizeFlag = decode83(blurhash[0]);
        const numY = Math.floor(sizeFlag / 9) + 1;
        const numX = (sizeFlag % 9) + 1;
        const quantisedMaximumValue = decode83(blurhash[1]);
        const maximumValue = (quantisedMaximumValue + 1) / 166;
        const colors = new Array(numX * numY);
        for (let i = 0; i < colors.length; i++) {
            if (i === 0) {
                colors[i] = decodeDC(decode83(blurhash.substring(2, 6)));
            } else {
                colors[i] = decodeAC(decode83(blurhash.substring(4 + i * 2, 6 + i * 2)), maximumValue * punch);
            }
        }
        const bytesPerRow = width * 4;
        const pixels = new Uint8ClampedArray(bytesPerRow * height);
        // Same cosines as computing them per pixel, looked up instead (the per-pixel Math.cos
        // calls were most of the decode: gallery placeholders paint while scrolling)
        const cosX = new Float64Array(width * numX);
        for (let x = 0; x < width; x++) {
            for (let i = 0; i < numX; i++) cosX[x * numX + i] = Math.cos((Math.PI * x * i) / width);
        }
        const cosY = new Float64Array(height * numY);
        for (let y = 0; y < height; y++) {
            for (let j = 0; j < numY; j++) cosY[y * numY + j] = Math.cos((Math.PI * y * j) / height);
        }
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let r = 0;
                let g = 0;
                let b = 0;
                for (let j = 0; j < numY; j++) {
                    for (let i = 0; i < numX; i++) {
                        const basis = cosX[x * numX + i] * cosY[y * numY + j];
                        const color = colors[i + j * numX];
                        r += color[0] * basis;
                        g += color[1] * basis;
                        b += color[2] * basis;
                    }
                }
                const offset = 4 * x + y * bytesPerRow;
                pixels[offset] = linearToSrgb(r);
                pixels[offset + 1] = linearToSrgb(g);
                pixels[offset + 2] = linearToSrgb(b);
                pixels[offset + 3] = 255;
            }
        }
        return pixels;
    }

    const dataUrlCache = new Map();

    /**
     * RGBA pixels -> uncompressed 32-bit BMP data URL. A canvas + toDataURL('image/png') cost
     * ~1.6-2.2 ms per hash (PNG encode and readback); this is plain JS. Same pixels either way.
     */
    function pixelsToBmpDataUrl(pixels, width, height) {
        const rowBytes = width * 4;
        const size = 54 + rowBytes * height;
        const bytes = new Uint8Array(size);
        const view = new DataView(bytes.buffer);
        bytes[0] = 0x42; // 'B'
        bytes[1] = 0x4d; // 'M'
        view.setUint32(2, size, true);
        view.setUint32(10, 54, true);
        view.setUint32(14, 40, true);
        view.setInt32(18, width, true);
        view.setInt32(22, -height, true); // top-down rows
        view.setUint16(26, 1, true);
        view.setUint16(28, 32, true);
        view.setUint32(34, rowBytes * height, true);
        for (let i = 0, o = 54; i < width * height; i++, o += 4) {
            const p = i * 4;
            bytes[o] = pixels[p + 2];
            bytes[o + 1] = pixels[p + 1];
            bytes[o + 2] = pixels[p];
            bytes[o + 3] = 255;
        }
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        return 'data:image/bmp;base64,' + btoa(binary);
    }

    function blurhashToDataUrl(blurhash, width, height, punch) {
        if (!blurhash) return null;
        const w = width || 32;
        const h = height || 32;
        const key = `${blurhash}|${w}x${h}|${punch || 1}`;
        if (dataUrlCache.has(key)) return dataUrlCache.get(key);
        try {
            const url = pixelsToBmpDataUrl(blurhashDecode(blurhash, w, h, punch), w, h);
            if (dataUrlCache.size > 400) dataUrlCache.clear();
            dataUrlCache.set(key, url);
            return url;
        } catch (_) {
            return null;
        }
    }

    function applyBlurhashPlaceholder(el, blurhash, size) {
        if (!el || !blurhash) return false;
        const url = blurhashToDataUrl(blurhash, size || 32, size || 32);
        if (!url) return false;
        el.style.backgroundImage = `url("${url}")`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.style.backgroundRepeat = 'no-repeat';
        return true;
    }

    global.blurhashIsValid = blurhashIsValid;
    global.blurhashDecode = blurhashDecode;
    global.blurhashToDataUrl = blurhashToDataUrl;
    global.applyBlurhashPlaceholder = applyBlurhashPlaceholder;
})(typeof globalThis !== 'undefined' ? globalThis : this);
