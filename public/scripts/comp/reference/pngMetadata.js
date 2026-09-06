// Extract PNG metadata from a File object
async function extractPNGMetadata(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const buffer = e.target.result;
                let metadata = readPNGMetadata(buffer);

                // External images may carry the blueprint in zTXt (compressed) or as
                // stealth LSB steganography (alpha/RGB) rather than tEXt/iTXt chunks.
                if (!metadata || !metadata.source || !metadata.source.includes('NovelAI')) {
                    const fallback = await extractFallbackPNGMetadata(new Uint8Array(buffer), file);
                    if (fallback) metadata = fallback;
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

    // NovelAI Diffusion V5 models (sample Source: "NovelAI Diffusion V5 0ADF9AB7")
    if (source.includes("NovelAI Diffusion V5")) {
        switch (source) {
            case "NovelAI Diffusion V5 0ADF9AB7":
            case "NovelAI Diffusion V5 DB276663":
                return "V5";
            default:
                if (source.includes("Curated") || source.includes("CUR")) return "V5_CUR";
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
                return "V4_5";
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
