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
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let r = 0;
                let g = 0;
                let b = 0;
                for (let j = 0; j < numY; j++) {
                    for (let i = 0; i < numX; i++) {
                        const basis = Math.cos((Math.PI * x * i) / width) * Math.cos((Math.PI * y * j) / height);
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

    function blurhashToDataUrl(blurhash, width, height, punch) {
        if (!blurhash) return null;
        const w = width || 32;
        const h = height || 32;
        const key = `${blurhash}|${w}x${h}|${punch || 1}`;
        if (dataUrlCache.has(key)) return dataUrlCache.get(key);
        try {
            const pixels = blurhashDecode(blurhash, w, h, punch);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            const imageData = ctx.createImageData(w, h);
            imageData.data.set(pixels);
            ctx.putImageData(imageData, 0, 0);
            const url = canvas.toDataURL('image/png');
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
