// Picture format readers (one global: #1156). Formats whose generation metadata can be imported are png, webp and jxl
// (JPEG XL by its fields only: the browser may not decode it).
const pictureMetadata = (() => {
// Which picture format the bytes are, by magic (a .jxl usually has an empty file.type): 'png', 'webp', 'jxl'
// (bare codestream or container), 'jpeg' or null. #1156
function sniffPictureFormat(data) {
    if (!data || data.length < 4) return null;
    if (data.length >= 8 && isValidPNGHeader(data)) return 'png';
    if (data.length >= 12 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
        data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return 'webp';
    if (data[0] === 0xFF && data[1] === 0x0A) return 'jxl';
    if (data.length >= 12 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 0x0C &&
        data[4] === 0x4A && data[5] === 0x58 && data[6] === 0x4C && data[7] === 0x20 &&
        data[8] === 0x0D && data[9] === 0x0A && data[10] === 0x87 && data[11] === 0x0A) return 'jxl';
    if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) return 'jpeg';
    return null;
}

// The format of a File from its first bytes, never from file.type or the extension.
async function sniffPictureFileFormat(file) {
    try {
        return sniffPictureFormat(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    } catch (e) {
        return null;
    }
}


// [keyword, text] fields as the NovelAI keyword set flattenNaiComment reads (a later field of a keyword wins).
function metadataFromFields(fields, encoding) {
    const o = {};
    for (const [k, v] of fields) o[k] = v;
    if (o.Comment) return flattenNaiComment({ Comment: o.Comment, Source: o.Source, Software: o.Software }, encoding);
    return null;
}

// WebP (NovelAI): EXIF chunk, UserComment JSON = the whole field set, else the IFD0 strings (see modules/pictureMeta.js).
function readWebpMetadata(data) {
    let off = 12;
    while (off + 8 <= data.length) {
        const fourcc = String.fromCharCode(data[off], data[off + 1], data[off + 2], data[off + 3]);
        const len = data[off + 4] | (data[off + 5] << 8) | (data[off + 6] << 16) | (data[off + 7] * 0x1000000);
        if (off + 8 + len > data.length) break;
        if (fourcc === 'EXIF') {
            let tiff = data.subarray(off + 8, off + 8 + len);
            if (tiff.length >= 6 && String.fromCharCode(...tiff.subarray(0, 6)) === 'Exif\0\0') tiff = tiff.subarray(6);
            return metadataFromFields(readExifFields(tiff), 'WebP EXIF');
        }
        off += 8 + len + (len & 1);
    }
    return null;
}

// Fields from a TIFF block: the UserComment JSON object, else DocumentName / ImageDescription / Software + the comment.
function readExifFields(t) {
    if (t.length < 8) return [];
    const order = String.fromCharCode(t[0], t[1]);
    if (order !== 'MM' && order !== 'II') return [];
    const le = order === 'II';
    const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const u16 = (o) => dv.getUint16(o, le);
    const u32 = (o) => dv.getUint32(o, le);
    if (u16(2) !== 42) return [];
    const typeSize = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
    const readIfd = (off) => {
        const tags = new Map();
        if (!off || off + 2 > t.length) return tags;
        const n = u16(off);
        for (let i = 0; i < n; i++) {
            const p = off + 2 + i * 12;
            if (p + 12 > t.length) break;
            const type = u16(p + 2);
            const size = (typeSize[type] || 1) * u32(p + 4);
            const vo = size > 4 ? u32(p + 8) : p + 8;
            if (vo + size > t.length) continue;
            tags.set(u16(p), { type, value: t.subarray(vo, vo + size), ptr: u32(p + 8) });
        }
        return tags;
    };
    const ifd0 = readIfd(u32(4));
    const ep = ifd0.get(0x8769);
    const exif = ep ? readIfd(ep.ptr) : new Map();
    const ascii = (v) => {
        let end = v.length;
        while (end > 0 && v[end - 1] === 0) end--;
        return new TextDecoder('utf-8').decode(v.subarray(0, end));
    };
    let text = null;
    const uc = exif.get(0x9286);
    if (uc && uc.value.length >= 8) {
        const cs = String.fromCharCode(...uc.value.subarray(0, 8));
        const body = uc.value.subarray(8);
        if (cs.startsWith('UNICODE')) {
            let s = '';
            for (let i = 0; i + 1 < body.length; i += 2) s += String.fromCharCode(le ? body[i] | (body[i + 1] << 8) : (body[i] << 8) | body[i + 1]);
            text = s.replace(/\0+$/, '');
        } else {
            text = ascii(body);
        }
    }
    if (text) {
        try {
            const obj = JSON.parse(text);
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                return Object.keys(obj).map((k) => [k, typeof obj[k] === 'string' ? obj[k] : JSON.stringify(obj[k])]);
            }
        } catch (e) { /* a plain comment */ }
    }
    const out = [];
    const s = (tag) => { const e = ifd0.get(tag); return e && e.type === 2 ? ascii(e.value) : null; };
    if (s(0x010D) != null) out.push(['Title', s(0x010D)]);
    if (s(0x010E) != null) out.push(['Description', s(0x010E)]);
    if (s(0x0131) != null) out.push(['Software', s(0x0131)]);
    if (text) out.push(['Comment', text]);
    return out;
}

// JPEG XL container: the sfMD box ({v:1, fields:[[k,v],...]}), else a legacy sfPN box (raw PNG chunks). A bare
// codestream has no boxes: null (no metadata).
async function readJxlMetadata(data) {
    if (data[0] === 0xFF) return null;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const dec = new TextDecoder('utf-8');
    let md = null;
    let pn = null;
    let off = 0;
    while (off + 8 <= data.length) {
        let size = dv.getUint32(off);
        const type = String.fromCharCode(data[off + 4], data[off + 5], data[off + 6], data[off + 7]);
        let head = 8;
        if (size === 1) { size = Number(dv.getBigUint64(off + 8)); head = 16; }
        if (size === 0) size = data.length - off;
        if (size < head || off + size > data.length) break;
        if (type === 'sfMD' && !md) md = data.subarray(off + head, off + size);
        else if (type === 'sfPN' && !pn) pn = data.subarray(off + head, off + size);
        off += size;
    }
    if (md) {
        try {
            const o = JSON.parse(dec.decode(md));
            if (o && o.v === 1 && Array.isArray(o.fields)) {
                const fields = o.fields.filter((f) => Array.isArray(f) && typeof f[0] === 'string')
                    .map((f) => [f[0], typeof f[1] === 'string' ? f[1] : f[1] == null ? '' : JSON.stringify(f[1])]);
                return metadataFromFields(fields, 'JXL sfMD');
            }
        } catch (e) { /* fall through to sfPN */ }
    }
    if (pn && pn[0] === 1) {
        // entries: where(1) + raw PNG chunk (length, type, data, crc); read as a PNG without pixels
        const parts = [];
        let p = 1;
        let total = 8;
        while (p + 5 <= pn.length) {
            const len = (pn[p + 1] << 24 | pn[p + 2] << 16 | pn[p + 3] << 8 | pn[p + 4]) >>> 0;
            const end = p + 1 + 12 + len;
            if (end > pn.length) break;
            parts.push(pn.subarray(p + 1, end));
            total += end - p - 1;
            p = end;
        }
        const png = new Uint8Array(total);
        png.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);
        let w = 8;
        for (const part of parts) { png.set(part, w); w += part.length; }
        let metadata = readPNGMetadata(png.buffer);
        if (!metadata || !metadata.source || !metadata.source.includes('NovelAI')) {
            const z = await readCompressedTextChunks(png);
            if (z && z.Comment) metadata = flattenNaiComment(z, 'JXL sfPN');
        }
        return metadata && metadata.source ? metadata : null;
    }
    return null;
}

    return {
        FORMATS: ['png', 'webp', 'jxl'],
        sniffFormat: sniffPictureFormat,
        sniffFile: sniffPictureFileFormat,
        fromWebp: readWebpMetadata,
        fromJxl: readJxlMetadata
    };
})();

// Extract picture metadata (PNG, lossless WebP, JPEG XL) from a File object. Name kept for its callers.
async function extractPNGMetadata(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const buffer = e.target.result;
                const bytes = new Uint8Array(buffer);
                const format = pictureMetadata.sniffFormat(bytes);
                let metadata;
                if (format === 'webp' || format === 'jxl') {
                    metadata = format === 'webp' ? pictureMetadata.fromWebp(bytes) : await pictureMetadata.fromJxl(bytes);
                    // WebP keeps stealth data in the alpha LSBs and the browser decodes it; a JXL is fields only.
                    if (format === 'webp' && (!metadata || !metadata.source || !metadata.source.includes('NovelAI'))) {
                        const fallback = await extractFallbackPNGMetadata(bytes, file);
                        if (fallback) metadata = fallback;
                    }
                    if (!metadata) metadata = {};
                } else {
                    metadata = readPNGMetadata(buffer);

                    // External images may carry the blueprint in zTXt (compressed) or as
                    // stealth LSB steganography (alpha/RGB) rather than tEXt/iTXt chunks.
                    if (!metadata || !metadata.source || !metadata.source.includes('NovelAI')) {
                        const fallback = await extractFallbackPNGMetadata(bytes, file);
                        if (fallback) metadata = fallback;
                    }
                }

                const enhancedMetadata = await extractMetadataWithDimensions(metadata, buffer, file);
                resolve(enhancedMetadata);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
}

// Fallback metadata extraction for external images: zTXt chunks then stealth LSB.
async function extractFallbackPNGMetadata(data, file) {
    try {
        const ztxt = await readCompressedTextChunks(data);
        if (ztxt && ztxt.Comment) {
            return flattenNaiComment(ztxt, 'JzTXt');
        }
    } catch (e) {
        console.warn('zTXt metadata decode failed:', e.message);
    }
    try {
        const stealth = await readStealthLSBMetadata(file);
        if (stealth) return stealth;
    } catch (e) {
        console.warn('Stealth LSB metadata decode failed:', e.message);
    }
    return null;
}

// Flatten a NovelAI keyword set ({ Comment, Source, Software }) into the shape
// readPNGMetadata returns for tEXt images, tagging the source encoding.
function flattenNaiComment(tEXtLike, encoding) {
    try {
        const commentData = JSON.parse(tEXtLike.Comment);
        return { ...commentData, source: tEXtLike.Source, software: tEXtLike.Software, _encoding: encoding };
    } catch (e) {
        return { source: tEXtLike.Source, software: tEXtLike.Software, _encoding: encoding };
    }
}

// Decode zTXt (zlib/deflate) Comment/Source/Software chunks using the native
// DecompressionStream (no external dependency).
async function readCompressedTextChunks(data) {
    if (!isValidPNGHeader(data)) return null;
    const out = {};
    let idx = 8;
    while (idx + 8 <= data.length) {
        const length = readUint32(data, idx);
        const name = String.fromCharCode(...data.slice(idx + 4, idx + 8));
        idx += 8;
        if (name === 'IEND') break;
        if (name === 'zTXt') {
            const chunk = data.slice(idx, idx + length);
            let i = 0;
            let keyword = '';
            while (i < chunk.length && chunk[i] !== 0) { keyword += String.fromCharCode(chunk[i]); i++; }
            i++; // null separator
            i++; // compression method
            if (keyword === 'Comment' || keyword === 'Source' || keyword === 'Software') {
                try {
                    out[keyword] = new TextDecoder('utf-8').decode(await decompressBytes(chunk.slice(i), 'deflate'));
                } catch (e) {
                    // ignore individual chunk failures
                }
            }
        }
        idx += length + 4;
    }
    return Object.keys(out).length ? out : null;
}

// Decompress bytes with the browser's native DecompressionStream.
async function decompressBytes(bytes, format) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Decode stealth LSB steganography (alpha or RGB, plain or gzip) from image pixels.
async function readStealthLSBMetadata(file) {
    const bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();
    const data = ctx.getImageData(0, 0, width, height).data; // RGBA (4 channels)

    let res = extractStealthPayloadBits(data, width, height, 4, 'alpha');
    if (!res) res = extractStealthPayloadBits(data, width, height, 4, 'rgb');
    if (!res) return null;

    let jsonStr;
    if (res.compressed) {
        jsonStr = new TextDecoder('utf-8').decode(await decompressBytes(res.payload, 'gzip'));
    } else {
        jsonStr = new TextDecoder('utf-8').decode(res.payload);
    }
    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch (e) { return null; }
    const tEXtLike = {
        Comment: typeof parsed.Comment === 'string' ? parsed.Comment : JSON.stringify(parsed.Comment),
        Source: parsed.Source,
        Software: parsed.Software
    };
    if (!tEXtLike.Comment || tEXtLike.Comment === 'undefined') return null;
    return flattenNaiComment(tEXtLike, res.encoding);
}

// Extract the stealth payload from RGBA pixel data. Bits are read column-major
// (x outer, y inner); alpha mode uses 1 bit/pixel, rgb mode uses 3 bits/pixel.
function extractStealthPayloadBits(data, width, height, channels, mode) {
    const bitAt = (index) => {
        if (mode === 'alpha') {
            const x = Math.floor(index / height);
            const y = index % height;
            return data[(y * width + x) * channels + 3] & 1;
        }
        const pixel = Math.floor(index / 3);
        const sub = index % 3;
        const x = Math.floor(pixel / height);
        const y = pixel % height;
        return data[(y * width + x) * channels + sub] & 1;
    };
    const maxBits = mode === 'alpha' ? width * height : width * height * 3;
    if (maxBits < 120 + 32) return null;

    let p = 0;
    let sig = '';
    for (let i = 0; i < 15; i++) {
        let b = 0;
        for (let j = 0; j < 8; j++) b = (b << 1) | bitAt(p++);
        sig += String.fromCharCode(b);
    }
    const signatures = {
        stealth_pnginfo: { mode: 'alpha', compressed: false },
        stealth_pngcomp: { mode: 'alpha', compressed: true },
        stealth_rgbinfo: { mode: 'rgb', compressed: false },
        stealth_rgbcomp: { mode: 'rgb', compressed: true }
    };
    const info = signatures[sig];
    if (!info || info.mode !== mode) return null;

    let lenBits = 0;
    for (let i = 0; i < 32; i++) lenBits = (lenBits << 1) | bitAt(p++);
    lenBits = lenBits >>> 0;
    if (lenBits <= 0 || lenBits % 8 !== 0 || p + lenBits > maxBits) return null;

    const byteLen = lenBits / 8;
    const payload = new Uint8Array(byteLen);
    for (let i = 0; i < byteLen; i++) {
        let b = 0;
        for (let j = 0; j < 8; j++) b = (b << 1) | bitAt(p++);
        payload[i] = b;
    }
    return { payload, compressed: info.compressed, encoding: mode === 'alpha' ? 'LSB Alpha' : 'LSB RGB' };
}

// Read PNG metadata from ArrayBuffer
function readPNGMetadata(buffer) {
    const data = new Uint8Array(buffer);
    if (!isValidPNGHeader(data)) {
        throw new Error('Invalid PNG file header');
    }
    
    const result = {};
    // Records which chunk type carried the "Comment" payload (JtEXt/JiTXt)
    let commentEncoding = null;
    let idx = 8;
    
    while (idx < data.length) {
        if (idx + 8 > data.length) break;
        
        const length = readUint32(data, idx);
        const name = String.fromCharCode(...data.slice(idx + 4, idx + 8));
        idx += 8;
        
        if (name === 'IEND') break;
        
        if (name === 'tEXt') {
            const chunkData = data.slice(idx, idx + length);
            const textChunk = textDecode(chunkData);
            if (!result.tEXt) result.tEXt = {};
            result.tEXt[textChunk.keyword] = textChunk.text;
            if (textChunk.keyword === 'Comment') commentEncoding = 'JtEXt';
        } else if (name === 'iTXt') {
            const itxtChunk = iTXtDecode(data.slice(idx, idx + length));
            if (itxtChunk && !itxtChunk.compressed && (itxtChunk.keyword === 'Comment' || itxtChunk.keyword === 'Source' || itxtChunk.keyword === 'Software')) {
                if (!result.tEXt) result.tEXt = {};
                result.tEXt[itxtChunk.keyword] = itxtChunk.text.replaceAll('\x00', '');
                if (itxtChunk.keyword === 'Comment') commentEncoding = 'JiTXt';
            }
        }
        
        idx += length + 4; // Skip data and CRC
    }
    
    if (result.tEXt && result.tEXt.Comment) {
        try {
            const commentData = JSON.parse(result.tEXt.Comment);
            return { ...commentData, source: result.tEXt.Source, software: result.tEXt.Software, _encoding: commentEncoding };
        } catch (e) {
            // Comment is not JSON, return basic metadata
            return { source: result.tEXt.Source, software: result.tEXt.Software, _encoding: commentEncoding };
        }
    }
    
    return result;
}

// Decode an iTXt chunk header + text (uncompressed only). Compressed iTXt is
// reported via the `compressed` flag and handled by the zTXt/stealth fallback.
function iTXtDecode(data) {
    let i = 0;
    let keyword = '';
    while (i < data.length && data[i] !== 0) { keyword += String.fromCharCode(data[i]); i++; }
    i++; // null separator after keyword
    const compressionFlag = data[i]; i++;
    i++; // compression method
    while (i < data.length && data[i] !== 0) i++; i++; // language tag
    while (i < data.length && data[i] !== 0) i++; i++; // translated keyword
    if (compressionFlag === 1) {
        return { keyword, text: null, compressed: true };
    }
    const text = new TextDecoder('utf-8').decode(data.slice(i));
    return { keyword, text, compressed: false };
}

// Enhance metadata with actual image dimensions and scale ratio detection
async function extractMetadataWithDimensions(metadata, buffer, file) {
    try {
        // Create an image element to get actual dimensions
        const imageUrl = URL.createObjectURL(file);
        const img = new Image();
        
        const dimensions = await new Promise((resolve, reject) => {
            img.onload = () => {
                const actualWidth = img.naturalWidth;
                const actualHeight = img.naturalHeight;
                URL.revokeObjectURL(imageUrl);
                resolve({ width: actualWidth, height: actualHeight });
            };
            img.onerror = () => {
                URL.revokeObjectURL(imageUrl);
                reject(new Error('Failed to load image for dimension extraction'));
            };
            img.src = imageUrl;
        });
        
        // Add actual dimensions to metadata
        metadata.actual_width = dimensions.width;
        metadata.actual_height = dimensions.height;
        
        // Calculate scale ratio if both embedded and actual dimensions are present
        if (metadata.width && metadata.height) {
            const embeddedWidth = metadata.width;
            const embeddedHeight = metadata.height;
            
            // Check if image was scaled up (both dimensions increased)
            if (dimensions.width > embeddedWidth && dimensions.height > embeddedHeight) {
                const scaleX = (dimensions.width / embeddedWidth).toFixed(2);
                const scaleY = (dimensions.height / embeddedHeight).toFixed(2);
                
                // Use the smaller scale factor for display (more conservative)
                const displayScale = Math.min(parseFloat(scaleX), parseFloat(scaleY));
                
                // Add scale ratio information
                metadata.scale_ratio = {
                    x: parseFloat(scaleX),
                    y: parseFloat(scaleY),
                    display: `${displayScale % 1 === 0 ? displayScale : displayScale.toFixed(1)}×`,
                    original_dimensions: `${embeddedWidth}×${embeddedHeight}`,
                    current_dimensions: `${dimensions.width}×${dimensions.height}`
                };
            }
        }
        
        return metadata;
    } catch (error) {
        console.warn('Could not extract image dimensions:', error.message);
        return metadata; // Return original metadata if dimension extraction fails
    }
}

// Helper function to determine model from metadata
function determineModelFromMetadata(metadata) {
    if (!metadata || !metadata.source) {
        return "unknown";
    }
    
    const source = metadata.source;

    // NovelAI Diffusion V5. Live image-app chunk (2026-09-29): current full
    // Source is "NovelAI Diffusion V5 DB276663". New V5 hashes are full.
    // JULES:#171
    if (source.includes("NovelAI Diffusion V5")) {
        // Medium hashes resolve to V5_MEDIUM (forge key v5_medium), not Full and not Curated.
        switch (source) {
            case "NovelAI Diffusion V5 93F4BD30":
            case "NovelAI Diffusion V5 70AB5786":
                return "V5_MEDIUM";
            case "NovelAI Diffusion V5 657484A5":
            case "NovelAI Diffusion V5 0ADF9AB7":
            case "NovelAI Diffusion V5 DB276663":
                return "V5";
            default:
                return "V5";
        }
    }
    
    // NovelAI Diffusion V4/V4.5 models
    if (source.includes("NovelAI Diffusion V4")) {
        switch (source) {
            case "NovelAI Diffusion V4.5 4BDE2A90":
            case "NovelAI Diffusion V4.5 1229B44F":
            case "NovelAI Diffusion V4.5 B9F340FD":
            case "NovelAI Diffusion V4.5 F3D95188":
            case "NovelAI Diffusion V4.5 5BB76870":
                return "V4_5";
            case "NovelAI Diffusion V4.5 C02D4F98":
            case "NovelAI Diffusion V4.5 5AB81C7C":
            case "NovelAI Diffusion V4.5 B5A2A797":
            case "NovelAI Diffusion V4 5AB81C7C":
            case "NovelAI Diffusion V4 B5A2A797":
                return "V4_5_CUR";
            case "NovelAI Diffusion V4 37442FCA":
            case "NovelAI Diffusion V4 4F49EC75":
            case "NovelAI Diffusion V4 CA4B7203":
            case "NovelAI Diffusion V4 79F47848":
            case "NovelAI Diffusion V4 F6302A9D":
                return "V4";
            case "NovelAI Diffusion V4 7ABFFA2A":
            case "NovelAI Diffusion V4 C1CCBA86":
            case "NovelAI Diffusion V4 770A9E12":
                return "V4_CUR";
            default:
                return source.includes("V4.5") ? "V4_5" : "V4";
        }
    }
    
    // Stable Diffusion models
    switch (source) {
        case "Stable Diffusion XL B0BDF6C1":
        case "Stable Diffusion XL C1E1DE52":
        case "Stable Diffusion XL 7BCCAA2C":
        case "Stable Diffusion XL 1120E6A9":
        case "Stable Diffusion XL 8BA2AF87":
            return "V3";
        case "Stable Diffusion XL 4BE8C60C":
        case "Stable Diffusion XL C8704949":
        case "Stable Diffusion XL 37C2B166":
        case "Stable Diffusion XL F306816B":
        case "Stable Diffusion XL 9CC2F394":
            return "FURRY";
        default:
            return source;
    }
}

// Helper function to get model display name
function getModelDisplayName(model) {
    return model === "V5" ? "<span class='model-name'>NovelAI v5</span><span class='badge custom-dropdown-badge'>F</span>" :
           model === "V5_MEDIUM" ? "<span class='model-name'>NovelAI v5</span><span class='badge custom-dropdown-badge'>M</span>" :
           model === "V5_CUR" ? "<span class='model-name'>NovelAI v5</span><span class='badge custom-dropdown-badge curated-badge'>C</span>" :
           model === "V4_5" ? "<span class='model-name'>NovelAI v4.5</span><span class='badge custom-dropdown-badge'>F</span>" : 
           model === "V4_5_CUR" ? "<span class='model-name'>NovelAI v4.5</span><span class='badge custom-dropdown-badge curated-badge'>C</span>" : 
           model === "V4" ? "<span class='model-name'>NovelAI v4</span><span class='badge custom-dropdown-badge'>F</span>" : 
           model === "V4_CUR" ? "<span class='model-name'>NovelAI v4</span><span class='badge custom-dropdown-badge curated-badge'>C</span>" : 
           model === "V3" ? "<span class='model-name'>NovelAI v3</span><span class='badge custom-dropdown-badge legacy-badge'>L</span>" :  
           model === "FURRY" ? "<span class='model-name'>NovelAI v3</span><span class='badge custom-dropdown-badge furry-badge'>LF</span>" :
           model;
}

// Helper functions for PNG parsing
function isValidPNGHeader(data) {
    return (
        data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47 &&
        data[4] === 0x0D && data[5] === 0x0A && data[6] === 0x1A && data[7] === 0x0A
    );
}

function readUint32(data, offset) {
    return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
}

function textDecode(data) {
    let naming = true;
    let text = '';
    let name = '';
    
    for (let i = 0; i < data.length; i++) {
        if (naming) {
            if (data[i]) {
                name += String.fromCharCode(data[i]);
            } else {
                naming = false;
            }
        } else {
            const textDecoder = new TextDecoder("utf-8");
            text = textDecoder.decode(data.slice(i));
            break;
        }
    }
    
    return { keyword: name, text };
}

