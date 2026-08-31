const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const sharp = require('sharp');
const { getResolutionFromDimensions } = require('./imageTools');
const {
    signGeneratedImage,
    verifyGeneratedImage
} = require('./forgeSigning');
const { qualityPresetStripCandidates } = require('./promptTextBoundary');

// NovelAI image attestation public key (Ed25519 raw → SPKI)
// https://github.com/NovelAI/novelai-image-metadata/blob/main/nai_sig.py
const NAI_VERIFY_PUBKEY_B64 = 'Y2JcQAOhLwzwSDUJPNgL04nS0Tbqm7cSRc4xk0vRMic=';
const NAI_VERIFY_PUBKEY = crypto.createPublicKey({
    key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(NAI_VERIFY_PUBKEY_B64, 'base64')
    ]),
    format: 'der',
    type: 'spki'
});

/**
 * Remove signed_hash from an exact NAI Comment JSON string (no re-serialize).
 * Signing payload is RGB + this string (Python json.dumps of comment sans signed_hash).
 */
function stripSignedHashFromCommentJson(commentStr) {
    if (typeof commentStr !== 'string' || !commentStr.includes('signed_hash')) {
        return { commentWithoutSig: commentStr, signatureB64: null };
    }
    const sigMatch = commentStr.match(/"signed_hash"\s*:\s*"([A-Za-z0-9+/=]+)"/);
    const signatureB64 = sigMatch ? sigMatch[1] : null;
    let commentWithoutSig = commentStr.replace(/\s*,\s*"signed_hash"\s*:\s*"[A-Za-z0-9+/=]+"/, '');
    commentWithoutSig = commentWithoutSig.replace(/"signed_hash"\s*:\s*"[A-Za-z0-9+/=]+"\s*,\s*/, '');
    return { commentWithoutSig, signatureB64 };
}

// Stealth LSB steganography signatures (NovelAI / AUTOMATIC1111 stealth_pnginfo)
// All signatures are exactly 15 characters (used as a fixed 120-bit prefix).
const STEALTH_SIGNATURES = {
    stealth_pnginfo: { mode: 'alpha', compressed: false },
    stealth_pngcomp: { mode: 'alpha', compressed: true },
    stealth_rgbinfo: { mode: 'rgb', compressed: false },
    stealth_rgbcomp: { mode: 'rgb', compressed: true }
};
const STEALTH_SIGNATURE_BITS = 15 * 8;
// Match NovelAI Explore PNG Title (API embeds "NovelAI generated image")
const STANDARD_PNG_TITLE = 'AI generated image';

/** Python json.dumps default separators: (', ', ': ') */
function stringifyNaiStyle(obj) {
    if (obj === null) return 'null';
    if (typeof obj === 'boolean') return obj ? 'true' : 'false';
    if (typeof obj === 'number') {
        if (!Number.isFinite(obj)) return 'null';
        return JSON.stringify(obj);
    }
    if (typeof obj === 'string') return JSON.stringify(obj);
    if (Array.isArray(obj)) {
        return '[' + obj.map(stringifyNaiStyle).join(', ') + ']';
    }
    const parts = [];
    for (const key of Object.keys(obj)) {
        parts.push(JSON.stringify(key) + ': ' + stringifyNaiStyle(obj[key]));
    }
    return '{' + parts.join(', ') + '}';
}

class PngMetadata {
    constructor(globalResources) {
        this.globalResources = globalResources;
    }

    // Helper: Read PNG metadata
    readMetadata(buffer) {
        const result = {};
        // Records which chunk type carried the "Comment" payload (JtEXt/JiTXt/JzTXt)
        let commentEncoding = null;
        const chunks = this.extractChunks(buffer);
        chunks.forEach(chunk => {
            switch (chunk.name) {
                case 'tEXt':
                    if (!result.tEXt) {
                        result.tEXt = {};
                    }
                    const textChunk = this.textDecode(chunk.data);
                    result.tEXt[textChunk.keyword] = textChunk.text;
                    if (textChunk.keyword === 'Comment') {
                        commentEncoding = 'JtEXt';
                    }
                    break;
                case 'pHYs':
                    result.pHYs = {
                        x: this.readUint32(chunk.data, 0),
                        y: this.readUint32(chunk.data, 4),
                        unit: chunk.data[8]
                    };
                    break;
                case 'iTXt':
                    const textDecodeResult = this.textDecode(chunk.data);
                    if (textDecodeResult.keyword === "Comment" || textDecodeResult.keyword === "Source" || textDecodeResult.keyword === "Software") {
                        try {
                            if (!result.tEXt) {
                                result.tEXt = {};
                            }
                            result.tEXt[textDecodeResult.keyword] = textDecodeResult.text.replaceAll("\x00", "");
                            if (textDecodeResult.keyword === 'Comment') {
                                commentEncoding = 'JiTXt';
                            }
                        } catch (e) {
                            console.error(e.message);
                        }
                    }
                    break;
                case 'zTXt':
                    const ztxtResult = this.ztxtDecode(chunk.data);
                    if (ztxtResult && (ztxtResult.keyword === "Comment" || ztxtResult.keyword === "Source" || ztxtResult.keyword === "Software")) {
                        try {
                            if (!result.tEXt) {
                                result.tEXt = {};
                            }
                            result.tEXt[ztxtResult.keyword] = ztxtResult.text;
                            if (ztxtResult.keyword === 'Comment') {
                                commentEncoding = 'JzTXt';
                            }
                        } catch (e) {
                            console.error(e.message);
                        }
                    }
                    break;
                default:
                    result[chunk.name] = true;
            }
        });
        if (result.tEXt && result.tEXt.Comment && commentEncoding) {
            result._encoding = commentEncoding;
        }
        return result;
    }

    // Helper: Decode a zTXt (zlib-compressed text) chunk => { keyword, text }
    ztxtDecode(data) {
        try {
            let i = 0;
            let keyword = '';
            while (i < data.length && data[i] !== 0) {
                keyword += String.fromCharCode(data[i]);
                i++;
            }
            i++; // skip null separator
            // Next byte is the compression method (0 = zlib/deflate); skip it
            i++;
            const compressed = Buffer.from(data.slice(i));
            let text = '';
            try {
                text = zlib.inflateSync(compressed).toString('utf8');
            } catch (e) {
                // Some encoders use raw deflate without zlib header
                text = zlib.inflateRawSync(compressed).toString('utf8');
            }
            return { keyword, text };
        } catch (e) {
            console.error('Error decoding zTXt chunk:', e.message);
            return null;
        }
    }

    // Extract the stealth LSB payload bit-stream from raw pixel data for a given mode.
    // mode: 'alpha' reads 1 bit/pixel from the alpha channel; 'rgb' reads 3 bits/pixel (R,G,B).
    // Bits are read column-major (x outer, y inner) per the stealth_pnginfo spec.
    _extractStealthPayload(data, width, height, channels, mode) {
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
        if (maxBits < STEALTH_SIGNATURE_BITS + 32) return null;

        let p = 0;
        let sig = '';
        for (let i = 0; i < 15; i++) {
            let b = 0;
            for (let j = 0; j < 8; j++) b = (b << 1) | bitAt(p++);
            sig += String.fromCharCode(b);
        }
        const sigInfo = STEALTH_SIGNATURES[sig];
        if (!sigInfo || sigInfo.mode !== mode) return null;

        let lenBits = 0;
        for (let i = 0; i < 32; i++) lenBits = (lenBits << 1) | bitAt(p++);
        lenBits = lenBits >>> 0;
        if (lenBits <= 0 || lenBits % 8 !== 0 || p + lenBits > maxBits) return null;

        const byteLen = lenBits / 8;
        const payload = Buffer.alloc(byteLen);
        for (let i = 0; i < byteLen; i++) {
            let b = 0;
            for (let j = 0; j < 8; j++) b = (b << 1) | bitAt(p++);
            payload[i] = b;
        }

        let jsonStr;
        try {
            jsonStr = sigInfo.compressed ? zlib.gunzipSync(payload).toString('utf8') : payload.toString('utf8');
        } catch (e) {
            return null;
        }
        return { jsonStr, encoding: mode === 'alpha' ? 'LSB Alpha' : 'LSB RGB' };
    }

    // Decode stealth LSB metadata embedded in the alpha or RGB channels.
    // Returns a readMetadata-shaped object ({ tEXt, _encoding }) or null.
    async readStealthMetadata(buffer) {
        try {
            const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            const { width, height, channels } = info;
            let res = null;
            if (channels >= 4) {
                res = this._extractStealthPayload(data, width, height, channels, 'alpha');
            }
            if (!res) {
                res = this._extractStealthPayload(data, width, height, channels, 'rgb');
            }
            if (!res) return null;

            let parsed;
            try {
                parsed = JSON.parse(res.jsonStr);
            } catch (e) {
                return null;
            }

            // Stealth JSON mirrors the NovelAI tEXt keyword set
            const tEXt = {};
            if (parsed.Comment !== undefined) {
                tEXt.Comment = typeof parsed.Comment === 'string' ? parsed.Comment : JSON.stringify(parsed.Comment);
            }
            if (parsed.Source !== undefined) tEXt.Source = parsed.Source;
            if (parsed.Software !== undefined) tEXt.Software = parsed.Software;
            if (parsed.Description !== undefined) tEXt.Description = parsed.Description;
            if (!tEXt.Comment) return null;
            return { tEXt, _encoding: res.encoding };
        } catch (e) {
            return null;
        }
    }

    // Unified async reader: prefer PNG text chunks, fall back to stealth LSB steganography.
    async readAnyMetadata(buffer) {
        const meta = this.readMetadata(buffer);
        if (meta && meta.tEXt && meta.tEXt.Comment) {
            return meta;
        }
        const stealth = await this.readStealthMetadata(buffer);
        if (stealth) {
            meta.tEXt = { ...(meta.tEXt || {}), ...stealth.tEXt };
            meta._encoding = stealth._encoding;
        }
        return meta;
    }

    // Helper: Update PNG metadata with forge_data
    updateMetadata(imageBuffer, forgeData) {
        try {
            const metadata = this.readMetadata(imageBuffer);
            let existingMetadata = {};
            
            // Parse existing Comment metadata if it exists
            if (metadata.tEXt && metadata.tEXt.Comment) {
                try {
                    existingMetadata = JSON.parse(metadata.tEXt.Comment);
                } catch (e) {
                    console.error('Error parsing existing metadata:', e.message);
                    existingMetadata = {};
                }
            }
            
            // Merge forge_data
            const hasExistingForgeData = !!existingMetadata.forge_data;
            if (!existingMetadata.forge_data) {
                existingMetadata.forge_data = {};
            }
            existingMetadata.forge_data.software = 'StaticForge v1.0';
            if (!existingMetadata.forge_data.history) {
                existingMetadata.forge_data.history = [];
            }
            // Preserve existing preset_name if it exists
            const existingPresetName = existingMetadata.forge_data.preset_name;
            
            if (hasExistingForgeData) {
                const currentSeed = existingMetadata.seed;
                const historyEntry = {
                    generation_type: existingMetadata.forge_data.generation_type || 'unknown',
                    date_generated: existingMetadata.forge_data.date_generated || Date.now(),
                    seed: currentSeed,
                    filename: existingMetadata.filename || 'unknown'
                };
                existingMetadata.forge_data.history.push(historyEntry);
            }
            
            // Merge new data into existing forge_data, excluding null values
            const cleanForgeData = {};
            for (const [key, value] of Object.entries(forgeData)) {
                if (value !== null) {
                    cleanForgeData[key] = value;
                }
            }
            
            existingMetadata.forge_data = { ...existingMetadata.forge_data, ...cleanForgeData };
            
            // Restore existing preset_name if it was there
            if (existingPresetName && !forgeData.preset_name) {
                existingMetadata.forge_data.preset_name = existingPresetName;
            }
            
            // Create new PNG with updated metadata (Title set via insertTextChunk on Comment)
            return this.insertTextChunk(imageBuffer, 'Comment', JSON.stringify(existingMetadata));
            
        } catch (error) {
            console.error('Error updating metadata:', error.message);
            return imageBuffer; // Return original buffer if update fails
        }
    }

    // Helper: Extract PNG chunks
    extractChunks(buffer) {
        const data = new Uint8Array(buffer);
        if (!this.isValidPngHeader(data)) {
            throw new Error('Invalid .png file header');
        }
        let idx = 8;
        const chunks = [];
        while (idx < data.length) {
            const length = this.readUint32(data, idx) + 4;
            idx += 4;
            const name = String.fromCharCode(...data.slice(idx, idx + 4));
            idx += 4;
            if (name === 'IEND') {
                chunks.push({ name, data: new Uint8Array(0) });
                break;
            }
            const chunkData = data.slice(idx, idx + length - 4);
            idx += length;
            chunks.push({ name, data: chunkData });
        }
        return chunks;
    }

    // Helper: Decode text chunks
    textDecode(data) {
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

    // Helper: Read 32-bit unsigned integer
    readUint32(data, offset) {
        return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
    }

    // Helper: Validate PNG header
    isValidPngHeader(data) {
    return (
        data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47 &&
            data[4] === 0x0D && data[5] === 0x0A && data[6] === 0x1A && data[7] === 0x0A
        );
    }

    // Helper: Insert text chunk into PNG
    insertTextChunk(imageBuffer, keyword, text) {
    try {
        const data = new Uint8Array(imageBuffer);
        let commentStart = -1;
        let commentEnd = -1;
        let iendPos = -1;
        let idx = 8;
        while (idx < data.length - 4) {
            const length = this.readUint32(data, idx);
            const name = String.fromCharCode(...data.slice(idx + 4, idx + 8));
            if (name === 'tEXt') {
                const chunkData = data.slice(idx + 8, idx + 8 + length);
                const keywordStart = chunkData.indexOf(0);
                if (keywordStart !== -1) {
                    const chunkKeyword = new TextDecoder().decode(chunkData.slice(0, keywordStart));
                    if (chunkKeyword === keyword) {
                        commentStart = idx;
                        commentEnd = idx + 4 + 4 + length + 4;
                    }
                }
            } else if (name === 'IEND') {
                iendPos = idx;
                break;
            }
            idx += 4 + 4 + length + 4;
        }
        if (iendPos === -1) {
            throw new Error('IEND chunk not found');
        }
        const keywordBytes = new TextEncoder().encode(keyword);
        const textBytes = new TextEncoder().encode(text);
        const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
        chunkData.set(keywordBytes, 0);
        chunkData[keywordBytes.length] = 0;
        chunkData.set(textBytes, keywordBytes.length + 1);
        const typeBytes = new TextEncoder().encode('tEXt');
        const chunkLength = chunkData.length;
        const fullChunk = new Uint8Array(4 + 4 + chunkLength + 4);
        fullChunk[0] = (chunkLength >>> 24) & 0xFF;
        fullChunk[1] = (chunkLength >>> 16) & 0xFF;
        fullChunk[2] = (chunkLength >>> 8) & 0xFF;
        fullChunk[3] = chunkLength & 0xFF;
        fullChunk.set(typeBytes, 4);
        fullChunk.set(chunkData, 8);
        const crc = this.calculateCRC(fullChunk.slice(4, 8 + chunkLength));
        fullChunk[8 + chunkLength] = (crc >>> 24) & 0xFF;
        fullChunk[8 + chunkLength + 1] = (crc >>> 16) & 0xFF;
        fullChunk[8 + chunkLength + 2] = (crc >>> 8) & 0xFF;
        fullChunk[8 + chunkLength + 3] = crc & 0xFF;
        let newBuffer;
        if (commentStart !== -1) {
            const beforeComment = data.slice(0, commentStart);
            const afterComment = data.slice(commentEnd);
            newBuffer = new Uint8Array(beforeComment.length + fullChunk.length + afterComment.length);
            newBuffer.set(beforeComment, 0);
            newBuffer.set(fullChunk, beforeComment.length);
            newBuffer.set(afterComment, beforeComment.length + fullChunk.length);
        } else {
            const beforeIend = data.slice(0, iendPos);
            const afterIend = data.slice(iendPos);
            newBuffer = new Uint8Array(beforeIend.length + fullChunk.length + afterIend.length);
            newBuffer.set(beforeIend, 0);
            newBuffer.set(fullChunk, beforeIend.length);
            newBuffer.set(afterIend, beforeIend.length + fullChunk.length);
        }
        let out = Buffer.from(newBuffer);
        // Any Comment write also sets Explore-aligned Title (covers generate/copy/upscale/strip rebuilds)
        if (keyword === 'Comment') {
            out = this.insertTextChunk(out, 'Title', STANDARD_PNG_TITLE);
        }
        return out;
    } catch (error) {
        console.error('Error inserting text chunk:', error.message);
        return imageBuffer;
    }
}

    // Helper: Calculate CRC32
    calculateCRC(data) {
        let crc = 0xFFFFFFFF;
        const table = [];
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) {
                c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
            }
            table[i] = c;
        }
        for (let i = 0; i < data.length; i++) {
            crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    // Utility: Strip all text chunks (tEXt, iTXt, zTXt) from a PNG buffer
    stripPngTextChunks(buffer) {
        // PNG header is 8 bytes
        if (!buffer || buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) return buffer;
        const PNG_HEADER = buffer.slice(0, 8);
        let offset = 8;
        const outChunks = [PNG_HEADER];
        while (offset < buffer.length) {
            if (offset + 8 > buffer.length) break;
            const length = buffer.readUInt32BE(offset);
            const type = buffer.toString('ascii', offset + 4, offset + 8);
            const chunkStart = offset;
            const chunkEnd = offset + 12 + length;
            // Strip all text-related chunks: tEXt, iTXt, and zTXt
            if (type !== 'tEXt' && type !== 'iTXt' && type !== 'zTXt') {
                outChunks.push(buffer.slice(chunkStart, chunkEnd));
            }
            offset = chunkEnd;
        }
        return Buffer.concat(outChunks);
    }

    // Helper: Extract NovelAI metadata from PNG
    async extractNovelAIMetadata(filePath) {
        try {
            const buffer = fs.readFileSync(filePath);
            const metadata = await this.readAnyMetadata(buffer);
            const sourceEncoding = metadata._encoding || null;
        
        if (metadata.tEXt && metadata.tEXt.Comment) {
            let _metadata = JSON.parse(metadata.tEXt.Comment);
            let expansionData = null;
            
            // If this is an expanded image, load the original image's metadata
            if (_metadata.forge_data?.expansion_source) {
                const originalFilename = _metadata.forge_data.expansion_source;
                const imagesDir = path.dirname(filePath);
                const originalPath = path.join(imagesDir, originalFilename);
                
                // Store expansion data
                expansionData = {
                    expansion_source: _metadata.forge_data.expansion_source,
                    expansion_mode: _metadata.forge_data.expansion_mode || 'unknown',
                    expansion_resolution: _metadata.forge_data.expansion_resolution,
                    expansion_bias: _metadata.forge_data.expansion_bias,
                    expansion_direction: _metadata.forge_data.expansion_direction,
                    expansion_percentages: _metadata.forge_data.expansion_percentages,
                    expansion_prompt: _metadata.forge_data.expansion_prompt,
                    expansion_reason: _metadata.forge_data.expansion_reason,
                    expansion_params: _metadata.forge_data.expansion_params,
                    generation_type: 'expanded',
                    expansion_requested_content: _metadata.forge_data.expansion_requested_content
                };
                
                console.log(`📋 Detected expanded image, loading original: ${originalFilename}`);
                
                if (fs.existsSync(originalPath)) {
                    try {
                        const originalBuffer = fs.readFileSync(originalPath);
                        const originalMetadata = await this.readAnyMetadata(originalBuffer);
                        if (originalMetadata.tEXt && originalMetadata.tEXt.Comment) {
                            _metadata = JSON.parse(originalMetadata.tEXt.Comment);
                            console.log(`✅ Loaded original metadata from: ${originalFilename}`);
                        }
                    } catch (error) {
                        console.error(`❌ Error loading original metadata: ${error.message}`);
                    }
                }
            }
            
            const result = {
                ..._metadata,
                source: metadata.tEXt.Source,
                software: metadata.tEXt.Software ? `${metadata.tEXt.Software} (${metadata.tEXt.Source})` : metadata.tEXt.Source,
                _encoding: sourceEncoding
            };
            
            // Extract forge_data if it exists, filtering to known fields
            if (_metadata.forge_data) {
                const knownForgeDataFields = [
                    'date_generated',
                    'request_type',
                    'generation_type',
                    'upscale_ratio',
                    'upscaled_at',
                    'preset_name',
                    'layer1_seed',
                    'image_source',
                    'image_bias',
                    'mask_compressed',
                    'mask_bias',
                    'img2img_strength',
                    'img2img_noise',
                    'input_prompt',
                    'input_uc',
                    'input_prompt_negative',
                    'dataset_config',
                    'append_quality',
                    'append_uc',
                    'quality_preset_bias',
                    'vibe_transfer',
                    'normalize_vibes',
                    'allCharacters',
                    'use_coords',
                    'disabledCharacters',
                    'characterNames',
                    'chara_reference_source',
                    'chara_reference_with_style',
                    'chara_reference_type',
                    'chara_reference_strength',
                    'chara_reference_fidelity',
                    'chara_reference_image',
                    'director_session_id',
                    'director_message_id',
                    'software',
                    'history',
                    'dynamic_generation',
                    'text_replacements_seed',
                    'expansion_source',
                    'expansion_mode',
                    'expansion_resolution',
                    'expansion_bias',
                    'expansion_direction',
                    'expansion_percentages',
                    'expansion_prompt',
                    'expansion_reason',
                    'expansion_params',
                    'generation_type',
                    'expansion_requested_content',
                    'stage_index',
                    'stage_type',
                    'stage_seeds',
                    'pipeline',
                    'text_replacements',
                    'text_overlays',
                    'save_base_output',
                    'skip_pipeline_stages',
                    'auto_clean_uc',
                    'keep_newlines',
                    'auto_char_numerize',
                    'prompt_normalize',
                    'deduplicate_tags',
                    'emphasis_normalization',
                    'novel_note_id',
                    'novel_story_cursor_line',
                    'blurhash'
                ];
                
                const filteredForgeData = {};
                for (const [key, value] of Object.entries(_metadata.forge_data)) {
                    if (knownForgeDataFields.includes(key)) {
                        filteredForgeData[key] = value;
                    }
                }
                result.forge_data = filteredForgeData;
            }
            
            // If this was an expanded image, merge expansion data back into forge_data
            if (expansionData) {
                result.forge_data = result.forge_data || {};
                Object.assign(result.forge_data, expansionData);
                console.log(`📋 Merged expansion metadata into forge_data`);
            }

            delete result.reference_image_multiple;
            
            return result;
        }
        return null;
    } catch (error) {
        console.error('Error extracting metadata:', error.message);
        return null;
        }
    }

    // Helper: Extract relevant fields from metadata
    // blurhashFromDb: images.blurhash column (backfill is DB-only — not rewritten into PNG)
    async extractRelevantFields(meta, filename, blurhashFromDb) {
        if (!meta) return null;
        
        const model = this.determineModelFromMetadata(meta);
        const modelDisplayName = this.getModelDisplayName(model);
    
        // Check if dimensions match a known resolution
        const resolution = getResolutionFromDimensions(meta.width, meta.height);
        
        // Extract metadata from forge_data only
        const forgeData = meta.forge_data || {};
        const upscaled = forgeData.upscale_ratio !== null && forgeData.upscale_ratio !== undefined;
        const hasBaseImage = forgeData.image_source !== undefined && forgeData.image_source !== 'data:base64';
        
        // Extract character prompts from forge_data (includes disabled characters and character names)
        let characterPrompts = [];
        let compiledCharacterPrompts = [];

        if (meta.v4_prompt && meta.v4_prompt.caption.char_captions && Array.isArray(meta.v4_prompt.caption.char_captions) && meta.v4_prompt.caption.char_captions.length > 0) {
            const positiveCaptions = meta.v4_prompt.caption.char_captions;
            const negativeCaptions = meta.v4_negative_prompt && meta.v4_negative_prompt.caption.char_captions ? meta.v4_negative_prompt.caption.char_captions : [];
            
            // Process positive captions by index
            positiveCaptions.forEach((caption, index) => {
                compiledCharacterPrompts.push({
                    prompt: caption.char_caption,
                    uc: '',
                    center: caption.centers && Array.isArray(caption.centers) && caption.centers.length > 0
                        ? caption.centers[0]
                        : null,
                    enabled: true,
                    chara_name: ''
                });
            });
            
            // Process negative captions by index and merge with positive ones
            negativeCaptions.forEach((caption, index) => {
                if (caption.char_caption && compiledCharacterPrompts[index]) {
                    compiledCharacterPrompts[index].uc = caption.char_caption;
                }
            });
            if (forgeData.disabledCharacters && Array.isArray(forgeData.disabledCharacters)) {
                // Insert disabled characters at their correct indices
                forgeData.disabledCharacters.forEach(disabledChar => {
                    compiledCharacterPrompts.splice(disabledChar.index, 0, {
                        prompt: disabledChar.prompt,
                        uc: disabledChar.uc,
                        center: disabledChar.center,
                        enabled: false,
                        chara_name: disabledChar.chara_name
                    });
                });
            }
            if (forgeData.characterNames && Array.isArray(forgeData.characterNames)) {
                compiledCharacterPrompts.forEach((char, index) => {
                    if (forgeData.characterNames[index]) {
                        compiledCharacterPrompts[index].chara_name = forgeData.characterNames[index];
                    }
                });
            }
        }
        
        // First, process v4_prompt character data if available
        let hasCharacterPrompts = false;
        if (forgeData.allCharacters) {
            characterPrompts = forgeData.allCharacters;
        } else if (meta.v4_prompt && meta.v4_prompt.caption.char_captions && Array.isArray(meta.v4_prompt.caption.char_captions) && meta.v4_prompt.caption.char_captions.length > 0) {
            hasCharacterPrompts = true;
            if (forgeData.allCharacters) {
                characterPrompts = forgeData.allCharacters;
            } else {
                const positiveCaptions = meta.v4_prompt.caption.char_captions;
                const negativeCaptions = meta.v4_negative_prompt && meta.v4_negative_prompt.caption.char_captions ? meta.v4_negative_prompt.caption.char_captions : [];
                
                // Process characters by index - simple and straightforward
                characterPrompts = [];
                
                // Process positive captions by index
                positiveCaptions.forEach((caption, index) => {
                    if (caption.char_caption) {
                        // Only use actual coordinates if they exist and are valid
                        const center = caption.centers && Array.isArray(caption.centers) && caption.centers.length > 0
                            ? caption.centers[0]
                            : null;
                        
                        characterPrompts.push({
                            prompt: caption.char_caption,
                            uc: '',
                            center: center,
                            enabled: true,
                            chara_name: ''
                        });
                    }
                });
                
                // Process negative captions by index and merge with positive ones
                negativeCaptions.forEach((caption, index) => {
                    if (caption.char_caption && characterPrompts[index]) {
                        characterPrompts[index].uc = caption.char_caption;
                    }
                });
                if (forgeData.disabledCharacters && Array.isArray(forgeData.disabledCharacters)) {
                    // Insert disabled characters at their correct indices
                    forgeData.disabledCharacters.forEach(disabledChar => {
                        characterPrompts.splice(disabledChar.index, 0, {
                            prompt: disabledChar.prompt,
                            uc: disabledChar.uc,
                            center: disabledChar.center,
                            enabled: false,
                            chara_name: disabledChar.chara_name
                        });
                    });
                }
                if (forgeData.characterNames && Array.isArray(forgeData.characterNames)) {
                    characterPrompts.forEach((char, index) => {
                        if (forgeData.characterNames[index]) {
                            characterPrompts[index].chara_name = forgeData.characterNames[index];
                        }
                    });
                }
            }
        } else if (forgeData.disabledCharacters && Array.isArray(forgeData.disabledCharacters)) {
            // Fallback: only forge data available (no API character data)
            characterPrompts = forgeData.disabledCharacters.map(disabledChar => ({
                prompt: disabledChar.prompt,
                uc: disabledChar.uc,
                center: disabledChar.center,
                enabled: false,
                chara_name: disabledChar.chara_name
            }));
            
            // Apply character names if available
            if (forgeData.characterNames && Array.isArray(forgeData.characterNames)) {
                characterPrompts.forEach((char, index) => {
                    if (forgeData.characterNames[index]) {
                        char.chara_name = forgeData.characterNames[index];
                    }
                });
            }
            
            // Apply use_coords setting to all characters if available
            if (forgeData.use_coords !== undefined) {
                characterPrompts.forEach((char) => {
                    char.use_coords = forgeData.use_coords;
                });
            }
            
        }
        
        const resultPrompt = forgeData.input_prompt !== undefined ? forgeData.input_prompt : meta.prompt;
        const resultUc = forgeData.input_prompt !== undefined ? (forgeData?.input_uc || '') : meta.uc;
        const resultPromptNegative = forgeData.input_prompt_negative !== undefined ? forgeData.input_prompt_negative : '';
        const result = {
            prompt: resultPrompt,
            uc: resultUc,
            input_prompt_negative: resultPromptNegative,
            model: model,
            model_display_name: modelDisplayName,
            steps: meta.steps,
            scale: meta.scale,
            cfg_rescale: meta.cfg_rescale,
            skip_cfg_above_sigma: meta.skip_cfg_above_sigma,
            sampler: meta.sampler,
            noise_schedule: meta.noise_schedule,
            characterPrompts: characterPrompts,
            upscaled: upscaled,
            base_image: hasBaseImage,
            history: forgeData.history,
            request_type: forgeData.request_type,
            image_source: forgeData.image_source !== 'data:base64' ? forgeData.image_source : undefined,
            image_bias: forgeData.image_bias,
            preset_name: forgeData.preset_name,
            use_coords: hasCharacterPrompts ? (
                characterPrompts.some(char => 
                    char.center && 
                    char.center.x !== null && 
                    char.center.y !== null && 
                    (char.center.x !== 0.5 || char.center.y !== 0.5)
                )
            ) : forgeData.use_coords || false,
            strength: meta.strength || forgeData.img2img_strength,
            noise: meta.noise || forgeData.img2img_noise,
            dynamic_generation: forgeData.dynamic_generation,
            // Store the final compiled prompts (what was actually sent to generation)
            compiled_prompt: meta.prompt || '',
            compiled_uc: meta.uc || '',
            compiled_characterPrompts: compiledCharacterPrompts
        };

        // If image_source is present, resolve source dimensions without reading the whole file
        if (result.image_source) {
            try {
                const storedSourceWidth = Number(forgeData.image_source_width);
                const storedSourceHeight = Number(forgeData.image_source_height);
                if (Number.isFinite(storedSourceWidth) && storedSourceWidth > 0
                    && Number.isFinite(storedSourceHeight) && storedSourceHeight > 0) {
                    result.image_source_width = storedSourceWidth;
                    result.image_source_height = storedSourceHeight;
                } else {
                    const imagesDir = this.globalResources.getPath('images');
                    const uploadCacheDir = this.globalResources.getPath('uploadCache');
                    const imagePath = result.image_source.startsWith('file:')
                        ? path.join(imagesDir, result.image_source.replace('file:', ''))
                        : result.image_source.startsWith('cache:')
                            ? path.join(uploadCacheDir, result.image_source.replace('cache:', ''))
                            : null;
                    // sharp(path).metadata() reads headers only — never fs.readFileSync the whole PNG
                    if (imagePath && fs.existsSync(imagePath)) {
                        const dims = await sharp(imagePath).metadata();
                        if (dims.width && dims.height) {
                            result.image_source_width = dims.width;
                            result.image_source_height = dims.height;
                        }
                    }
                }

                // Add mask bias if present in forge data
                if (forgeData.mask_bias !== undefined) {
                    result.mask_bias = forgeData.mask_bias;
                }
                if (forgeData.mask_compressed !== undefined) {
                    result.mask_compressed = forgeData.mask_compressed;
                } else if (forgeData.mask !== undefined) {
                    result.mask = forgeData.mask;
                }
            } catch (e) {
                // Ignore errors, do not set width/height
            }
        } else {
            delete result.image_source_width;
            delete result.image_source_height;
            delete result.image_source;
            delete result.image_source_seed;
            delete result.image_bias;
            delete result.mask_compressed;
            delete result.mask;
            delete result.mask_bias;
            delete result.strength;
            delete result.noise;
        }
        
        if (forgeData.layer1_seed !== undefined) {
            result.layer1Seed = forgeData.layer1_seed;
            result.layer2Seed = meta.seed;
        } else if (meta.seed !== undefined) {
            result.seed = meta.seed;
        }
        
        // Add resolution if it matches, otherwise add height and width
        if (resolution) {
            result.resolution = resolution.toUpperCase();
        }
        result.height = meta.height;
        result.width = meta.width;

        // Add actual dimensions if available (from stored metadata)
        if (meta.actual_width && meta.actual_height) {
            result.actual_width = meta.actual_width;
            result.actual_height = meta.actual_height;
        }

        // Add actual resolution if available
        if (meta.actual_resolution) {
            result.actual_resolution = meta.actual_resolution;
        }
        
        // Handle detection and removal of append_quality and append_uc
        // Only apply this logic if we're using extracted values, not saved input values
        const currentPromptConfig = this.globalResources.getPromptConfig();
        let detectedAppendQuality = false;
        let detectedAppendUc = 0;
        
        // If we have saved values in forge data, use those append flags directly
        if (forgeData.append_quality !== undefined) {
            detectedAppendQuality = forgeData.append_quality;
        } else {
            // Detect and remove quality preset from prompt (only for extracted values)
            if (result.prompt && currentPromptConfig.quality_presets) {
                const modelKey = model.toLowerCase();
                const qualityValue = currentPromptConfig.quality_presets[modelKey];
                const qualityCandidates = qualityPresetStripCandidates(qualityValue);
                const groups = result.prompt.split('|').map(group => group.trim());
                for (let qi = 0; qi < qualityCandidates.length && !detectedAppendQuality; qi++) {
                    const candidate = qualityCandidates[qi];
                    if (!candidate || !result.prompt.includes(candidate)) continue;
                    const qualityPattern = ', ' + candidate;
                    if (groups.length > 0 && groups[0].endsWith(qualityPattern)) {
                        groups[0] = groups[0].slice(0, -qualityPattern.length);
                        result.prompt = groups.join(' | ');
                        detectedAppendQuality = true;
                    } else if (result.prompt.endsWith(qualityPattern)) {
                        result.prompt = result.prompt.slice(0, -qualityPattern.length);
                        detectedAppendQuality = true;
                    }
                }
            }
        }
        
        if (forgeData.append_uc !== undefined) {
            detectedAppendUc = forgeData.append_uc;
        } else {
            // Detect and remove UC preset from negative prompt (only for extracted values)
            if (result.uc && currentPromptConfig.uc_presets) {
                const modelKey = model.toLowerCase();
                const ucPresets = currentPromptConfig.uc_presets[modelKey];
                if (ucPresets && Array.isArray(ucPresets)) {
                    for (let i = ucPresets.length - 1; i >= 0; i--) {
                        const ucValue = ucPresets[i];
                        if (result.uc.startsWith(ucValue)) {
                            // Check if it's at the start with ", " separator
                            const ucPattern = ucValue + ', ';
                            if (result.uc.startsWith(ucPattern)) {
                                result.uc = result.uc.slice(ucPattern.length);
                                detectedAppendUc = i + 1; // 1-based index
                                break;
                            } else if (result.uc === ucValue) {
                                // UC preset is the entire UC
                                result.uc = '';
                                detectedAppendUc = i + 1;
                                break;
                            }
                        }
                    }
                }
            }
        }

        if (forgeData.vibe_transfer !== undefined) {
            result.vibe_transfer = forgeData.vibe_transfer;
        }
        if (forgeData.normalize_vibes !== undefined) {
            result.normalize_vibes = forgeData.normalize_vibes;
        }
        
        // Add new metadata fields
        result.append_quality = detectedAppendQuality;
        result.append_uc = detectedAppendUc;
        result.append_transparency = forgeData.append_transparency === true;
        result.append_quality_id = forgeData.append_quality_id || null;
        result.append_uc_id = forgeData.append_uc_id || null;
        if (forgeData.quality_preset_bias !== undefined) {
            result.quality_preset_bias = forgeData.quality_preset_bias;
        }
        if (forgeData.transparency_bias !== undefined) {
            result.transparency_bias = forgeData.transparency_bias;
        }
        result.dataset_config = forgeData.dataset_config || { include: [] }; // Default to empty array

        // Add precise reference fields
        if (forgeData.chara_reference_source) {
            result.chara_reference_source = forgeData.chara_reference_source;
            if (Array.isArray(forgeData.chara_reference_source)) {
                if (forgeData.chara_reference_type !== undefined) {
                    result.chara_reference_type = forgeData.chara_reference_type;
                }
                if (forgeData.chara_reference_strength !== undefined) {
                    result.chara_reference_strength = forgeData.chara_reference_strength;
                }
                if (forgeData.chara_reference_fidelity !== undefined) {
                    result.chara_reference_fidelity = forgeData.chara_reference_fidelity;
                }
            } else {
                result.chara_reference_with_style = forgeData.chara_reference_with_style || false;
            }
        }

        // Add director session and message IDs
        if (forgeData.director_session_id) {
            result.director_session_id = forgeData.director_session_id;
        }
        if (forgeData.director_message_id) {
            result.director_message_id = forgeData.director_message_id;
        }
        if (forgeData.novel_note_id) {
            result.novel_note_id = forgeData.novel_note_id;
        }
        if (forgeData.novel_story_cursor_line !== undefined) {
            result.novel_story_cursor_line = forgeData.novel_story_cursor_line;
        }

        // Add image source seed for preset-based img2img
        if (forgeData.image_source_seed !== undefined) {
            result.image_source_seed = forgeData.image_source_seed;
        }

        // Add dynamic generation data
        if (forgeData.dynamic_generation) {
            result.dynamic_generation = forgeData.dynamic_generation;
        }

        // Add text replacement seed data
        if (forgeData.text_replacements_seed) {
            result.text_replacements_seed = forgeData.text_replacements_seed;
        }

        // Add precise reference strength/fidelity (v1 scalar handled above when not array source)
        if (forgeData.chara_reference_fidelity !== undefined && !result.chara_reference_fidelity) {
            result.chara_reference_fidelity = forgeData.chara_reference_fidelity;
        }
        if (forgeData.chara_reference_strength !== undefined && result.chara_reference_strength === undefined) {
            result.chara_reference_strength = forgeData.chara_reference_strength;
        }
        
        // Add expansion data if present
        if (forgeData.expansion_source) {
            result.expansion_source = forgeData.expansion_source;
            result.expansion_mode = forgeData.expansion_mode;
            result.expansion_resolution = forgeData.expansion_resolution;
            result.expansion_bias = forgeData.expansion_bias;
            result.expansion_direction = forgeData.expansion_direction;
            result.expansion_percentages = forgeData.expansion_percentages;
            result.expansion_prompt = forgeData.expansion_prompt;
            result.expansion_reason = forgeData.expansion_reason;
            result.expansion_params = forgeData.expansion_params;
            result.expansion_requested_content = forgeData.expansion_requested_content;
        }

        // Add stage data if present
        if (forgeData.pipeline !== undefined) {
            result.pipeline = forgeData.pipeline;
            result.save_base_output = forgeData.save_base_output;
            result.skip_pipeline_stages = forgeData.skip_pipeline_stages;
        }
        if (forgeData.stage_index !== undefined) {
            result.stage_index = forgeData.stage_index;
        }
        if (forgeData.stage_type !== undefined) {
            result.stage_type = forgeData.stage_type;
        }
        if (forgeData.stage_seeds !== undefined) {
            result.stage_seeds = forgeData.stage_seeds;
        }
        if (forgeData.text_replacements !== undefined) {
            result.text_replacements = forgeData.text_replacements;
        }

        if (forgeData.text_overlays !== undefined) {
            result.text_overlays = forgeData.text_overlays;
        }
        
        // Add auto_clean_uc if available
        if (forgeData.auto_clean_uc !== undefined) {
            result.auto_clean_uc = forgeData.auto_clean_uc;
        }

        // Add keep_newlines if available
        if (forgeData.keep_newlines !== undefined) {
            result.keep_newlines = forgeData.keep_newlines;
        }

        // Add auto_char_numerize if available
        if (forgeData.auto_char_numerize !== undefined) {
            result.auto_char_numerize = forgeData.auto_char_numerize;
        }

        // Add prompt_normalize if available
        if (forgeData.prompt_normalize !== undefined) {
            result.prompt_normalize = forgeData.prompt_normalize;
        }

        // Add deduplicate_tags if available
        if (forgeData.deduplicate_tags !== undefined) {
            result.deduplicate_tags = forgeData.deduplicate_tags;
        }
        
        // Include forge_data in result
        result.forge_data = forgeData;
        const hash = blurhashFromDb || forgeData.blurhash || null;
        result.blurhash = hash;
        if (hash) {
            result.forge_data.blurhash = hash;
        }

        return result;
    }


    // Helper: Determine model from metadata using exact hash matching (from NovelAI inspect page)
    determineModelFromMetadata(meta) {
        if (!meta || !meta.source) {
            return "unknown";
        }
        
        const source = meta.source;

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
        if (source.includes("NovelAI Diffusion V4") || source.includes("NovelAI Diffusion V4.5")) {
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
                return "unknown";
        }
    }

    // Helper: Get model display name
    getModelDisplayName(model) {
        return model === "V5" ? "V5" : model === "V5_CUR" ? "V5 (Curated)" : model === "V4_5" ? "V4.5" : model === "V4_5_CUR" ? "V4.5 (Curated)" : model === "V4" ? "V4" : model === "V4_CUR" ? "V4 (Curated)" : model === "V3" ? "V3" : "Unknown";
    }

    // Helper: get base name for pairing
    getBaseName(filename) {
        if (typeof filename !== 'string' || !filename) {
            return '';
        }
        return filename
            .replace(/_upscaled(?=\.)/, '')  // Remove _upscaled suffix
            .replace(/@blur(?=\.)/, '')  // Remove @blur suffix
            .replace(/@lq(?=\.)/, '')  // Remove @lq suffix
            .replace(/@2x(?=\.)/, '')  // Remove @2x suffix
                .replace(/\.(png|jpg|jpeg)$/i, '');  // Remove file extension
    }

    // New comprehensive metadata extraction function for download URL functionality
    async extractMetadataSummary(buffer, filename = null) {
        try {
            const metadata = await this.readAnyMetadata(buffer);
        
        if (!metadata.tEXt || !metadata.tEXt.Comment) {
            return {
                success: false,
                error: 'No metadata found in PNG file',
                isBlueprint: false
            };
        }
        
        let parsedMetadata;
        try {
            parsedMetadata = JSON.parse(metadata.tEXt.Comment);
        } catch (e) {
            return {
                success: false,
                error: 'Invalid JSON metadata in PNG file',
                isBlueprint: false
            };
        }
        
        // Check if this is a NovelAI or StaticForge image
        const isNovelAI = metadata.tEXt.Source && metadata.tEXt.Source.includes('NovelAI');
        const isBlueprint = isNovelAI || (parsedMetadata.forge_data && parsedMetadata.forge_data.software);
        
        if (!isBlueprint) {
            return {
                success: false,
                error: 'Not a NovelAI or StaticForge image',
                isBlueprint: false
            };
        }
        
        // Condense large data fields to booleans to reduce payload size
        const condensedMetadata = { ...parsedMetadata };
        
        // Convert forge_data fields to booleans where the frontend only needs to know if they exist
        if (condensedMetadata.forge_data) {
            if (condensedMetadata.forge_data.image_source) {
                condensedMetadata.forge_data.image_source = true;
            }
            if (condensedMetadata.forge_data.mask_compressed) {
                condensedMetadata.forge_data.mask_compressed = true;
            }
        }
        
        // Convert reference_image_multiple to just the length if it's an array
        if (condensedMetadata.reference_image_multiple && Array.isArray(condensedMetadata.reference_image_multiple)) {
            condensedMetadata.reference_image_multiple = condensedMetadata.reference_image_multiple.length;
        }
        
        // Extract actual PNG dimensions from the image data using Sharp for safety
        let actualWidth, actualHeight;
        try {

            const imageInfo = await sharp(buffer).metadata();
            actualWidth = imageInfo.width;
            actualHeight = imageInfo.height;
        } catch (e) {
            console.log('⚠️ Could not extract PNG dimensions using Sharp:', e.message);
        }
        
        // Add actual dimensions to the response for fallback use
        if (actualWidth && actualHeight) {
            condensedMetadata.actual_width = actualWidth;
            condensedMetadata.actual_height = actualHeight;
            
            // Use actual dimensions for resolution detection as fallback
            const actualResolution = getResolutionFromDimensions(actualWidth, actualHeight);
            if (actualResolution) {
                condensedMetadata.actual_resolution = actualResolution;
                condensedMetadata.actual_resolution_display = this.formatResolution(actualResolution, actualWidth, actualHeight);
            } else {
                condensedMetadata.actual_resolution_display = `${actualWidth} × ${actualHeight}`;
            }
            
            // Calculate scale ratio if both embedded and actual dimensions are present
            if (condensedMetadata.width && condensedMetadata.height) {
                const embeddedWidth = condensedMetadata.width;
                const embeddedHeight = condensedMetadata.height;
                
                // Check if image was scaled up (both dimensions increased)
                if (actualWidth > embeddedWidth && actualHeight > embeddedHeight) {
                    const scaleX = (actualWidth / embeddedWidth).toFixed(2);
                    const scaleY = (actualHeight / embeddedHeight).toFixed(2);
                    
                    // Use the smaller scale factor for display (more conservative)
                    const displayScale = Math.min(parseFloat(scaleX), parseFloat(scaleY));
                    
                    // Add scale ratio information
                    condensedMetadata.scale_ratio = {
                        x: parseFloat(scaleX),
                        y: parseFloat(scaleY),
                        display: `${displayScale % 1 === 0 ? displayScale : displayScale.toFixed(1)}×`,
                        original_dimensions: `${embeddedWidth}×${embeddedHeight}`,
                        current_dimensions: `${actualWidth}×${actualHeight}`
                    };
                }
            }
            
            // Calculate if upscaling is available for this image
            const MAX_UPSCALE_PIXELS = 3145728; // Official tooLargeForUpscale / P.xM (3MP)
            const totalPixels = actualWidth * actualHeight;
            condensedMetadata.canUpscale = totalPixels <= MAX_UPSCALE_PIXELS;
        }
        
        // Return the condensed metadata with source/software info added
        return {
            success: true,
            isBlueprint: true,
            ...condensedMetadata,
            source: metadata.tEXt.Source,
            software: metadata.tEXt.Software ? `${metadata.tEXt.Software} (${metadata.tEXt.Source})` : metadata.tEXt.Source,
            _encoding: metadata._encoding || 'JtEXt',
            filename: filename,
            file_size: buffer.length,
            content_type: 'image/png'
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message,
            isBlueprint: false
        };
        }
    }

    // Helper function to format resolution with aspect ratio matching (ported from frontend)
    formatResolution(resolution, width, height) {
        if (!resolution && !width && !height) return '';
        
        // If we have a resolution string, try to match it first
        if (resolution) {
            const RESOLUTIONS = [
                { value: 'small_portrait', display: 'Small Portrait', width: 512, height: 768, aspect: 0.667 },
                { value: 'small_landscape', display: 'Small Landscape', width: 768, height: 512, aspect: 1.5 },
                { value: 'small_square', display: 'Small Square', width: 640, height: 640, aspect: 1.0 },
                { value: 'normal_portrait', display: 'Normal Portrait', width: 832, height: 1216, aspect: 0.684 },
                { value: 'normal_landscape', display: 'Normal Landscape', width: 1216, height: 832, aspect: 1.462 },
                { value: 'normal_square', display: 'Normal Square', width: 1024, height: 1024, aspect: 1.0 },
                { value: 'large_portrait', display: 'Large Portrait', width: 1024, height: 1536, aspect: 0.667 },
                { value: 'large_landscape', display: 'Large Landscape', width: 1536, height: 1024, aspect: 1.5 },
                { value: 'large_square', display: 'Large Square', width: 1472, height: 1472, aspect: 1.0 },
                { value: 'xlarge_portrait', display: 'Max Portrait', width: 1408, height: 2112, aspect: 0.667 },
                { value: 'xlarge_landscape', display: 'Max Landscape', width: 2112, height: 1408, aspect: 1.5 },
                { value: 'xlarge_square', display: 'Max Square', width: 1728, height: 1728, aspect: 1.0 },
                { value: 'wallpaper_portrait', display: 'Wallpaper Portrait', width: 1088, height: 1920, aspect: 0.567 },
                { value: 'wallpaper_landscape', display: 'Wallpaper Widescreen', width: 1920, height: 1088, aspect: 1.765 }
            ];
            
            // Handle custom resolution format: custom_1024x768
            if (resolution.startsWith('custom_')) {
                const dimensions = resolution.replace('custom_', '');
                const [w, h] = dimensions.split('x').map(Number);
                if (w && h) {
                    return `Custom ${w}×${h}`;
                }
            }
            
            // Try to find the resolution in our array first
            const res = RESOLUTIONS.find(r => r.value.toLowerCase() === resolution.toLowerCase());
            if (res) {
                return res.display;
            }
            
            // Fallback: Convert snake_case to Title Case
            return resolution
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }
        
        // If no resolution string but we have dimensions, match by aspect ratio
        if (width && height) {
            const aspect = width / height;
            const tolerance = 0.05; // 5% tolerance for aspect ratio matching
            
            const RESOLUTIONS = [
            { value: 'small_portrait', display: 'Small Portrait', width: 512, height: 768, aspect: 0.667 },
            { value: 'small_landscape', display: 'Small Landscape', width: 768, height: 512, aspect: 1.5 },
            { value: 'small_square', display: 'Small Square', width: 640, height: 640, aspect: 1.0 },
            { value: 'normal_portrait', display: 'Normal Portrait', width: 832, height: 1216, aspect: 0.684 },
            { value: 'normal_landscape', display: 'Normal Landscape', width: 1216, height: 832, aspect: 1.462 },
            { value: 'normal_square', display: 'Normal Square', width: 1024, height: 1024, aspect: 1.0 },
            { value: 'large_portrait', display: 'Large Portrait', width: 1024, height: 1536, aspect: 0.667 },
            { value: 'large_landscape', display: 'Large Landscape', width: 1536, height: 1024, aspect: 1.5 },
            { value: 'large_square', display: 'Large Square', width: 1472, height: 1472, aspect: 1.0 },
            { value: 'xlarge_portrait', display: 'Max Portrait', width: 1408, height: 2112, aspect: 0.667 },
            { value: 'xlarge_landscape', display: 'Max Landscape', width: 2112, height: 1408, aspect: 1.5 },
            { value: 'xlarge_square', display: 'Max Square', width: 1728, height: 1728, aspect: 1.0 },
            { value: 'wallpaper_portrait', display: 'Wallpaper Portrait', width: 1088, height: 1920, aspect: 0.567 },
            { value: 'wallpaper_landscape', display: 'Wallpaper Widescreen', width: 1920, height: 1088, aspect: 1.765 }
            ];
            
            // Find resolution by aspect ratio with tolerance
            const matchedResolution = RESOLUTIONS.find(r => 
                Math.abs(r.aspect - aspect) < tolerance
            );
            
            if (matchedResolution) {
                return matchedResolution.display;
            }
            
            // If no match found, return dimensions
            return `${width} × ${height}`;
        }
        
        return '';
    }

    // Helper: Copy metadata from source image to target image buffer
    copyMetadataToImage(sourceBuffer, targetBuffer, additionalForgeData = {}) {
        try {
            // Read metadata from source image
            const sourceMetadata = this.readMetadata(sourceBuffer);

            // Extract the Comment metadata (which contains forge_data)
            let existingMetadata = {};
            if (sourceMetadata.tEXt && sourceMetadata.tEXt.Comment) {
                try {
                    existingMetadata = JSON.parse(sourceMetadata.tEXt.Comment);
                } catch (e) {
                    console.error('Error parsing source metadata:', e.message);
                    existingMetadata = {};
                }
            }

            // Update the forge_data with upscaling information
            if (!existingMetadata.forge_data) {
                existingMetadata.forge_data = {};
            }

            // Merge additional forge data (like upscaling info)
            existingMetadata.forge_data = { ...existingMetadata.forge_data, ...additionalForgeData };
            existingMetadata.forge_data.software = 'StaticForge v1.0';

            // Ensure history array exists
            if (!existingMetadata.forge_data.history) {
                existingMetadata.forge_data.history = [];
            }

            // Add history entry for the upscaling operation
            if (additionalForgeData.generation_type === 'upscaled') {
                const historyEntry = {
                    generation_type: 'upscaled',
                    upscaled_at: additionalForgeData.upscaled_at,
                    upscaler_provider: additionalForgeData.upscaler_provider,
                    upscale_ratio: additionalForgeData.upscale_ratio
                };
                existingMetadata.forge_data.history.push(historyEntry);
            }

            // Apply Comment (+ Title via insertTextChunk); restore Source/Software/Description from source
            let out = this.updateMetadataWithExisting(targetBuffer, existingMetadata);
            const srcText = sourceMetadata.tEXt || {};
            if (srcText.Source) {
                out = this.insertTextChunk(out, 'Source', srcText.Source);
            }
            if (srcText.Software) {
                out = this.insertTextChunk(out, 'Software', srcText.Software);
            }
            if (srcText.Description) {
                out = this.insertTextChunk(out, 'Description', srcText.Description);
            }
            return out;

        } catch (error) {
            console.error('Error copying metadata:', error.message);
            // Fallback: just add the additional forge data to the target
            return this.updateMetadata(targetBuffer, additionalForgeData);
        }
    }

    // Helper: Update metadata with existing metadata object (internal function)
    updateMetadataWithExisting(imageBuffer, existingMetadata) {
        try {
            // Create new Comment chunk with the merged metadata
            const commentText = JSON.stringify(existingMetadata);

            // Title set via insertTextChunk on Comment
            return this.insertTextChunk(imageBuffer, 'Comment', commentText);

        } catch (error) {
            console.error('Error updating metadata with existing data:', error.message);
            return imageBuffer;
        }
    }

    /**
     * Row-major RGB bytes (H×W×3) matching numpy image_array[:,:,:3].tobytes().
     */
    async extractRgbBytes(buffer) {
        const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const { width, height, channels } = info;
        const rgb = Buffer.alloc(width * height * 3);
        let o = 0;
        for (let i = 0; i < width * height; i++) {
            const p = i * channels;
            rgb[o++] = data[p];
            rgb[o++] = data[p + 1];
            rgb[o++] = data[p + 2];
        }
        return rgb;
    }

    /**
     * Write stealth_pngcomp into alpha LSB. Returns a new PNG buffer (text chunks are not preserved).
     * @param {Buffer} buffer
     * @param {object} outer - { Description, Software, Source, 'Generation time', Comment: string }
     */
    async writeStealthPngComp(buffer, outer) {
        const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const { width, height, channels } = info;
        if (channels < 4) {
            throw new Error('writeStealthPngComp requires an alpha channel');
        }

        // Preserve NovelAI outer key order
        const ordered = {
            Description: outer.Description != null ? outer.Description : '',
            Software: outer.Software != null ? outer.Software : 'NovelAI',
            Source: outer.Source != null ? outer.Source : '',
            'Generation time': outer['Generation time'] != null ? outer['Generation time'] : 0,
            Comment: typeof outer.Comment === 'string' ? outer.Comment : JSON.stringify(outer.Comment || {})
        };
        const jsonStr = stringifyNaiStyle(ordered);
        const compressed = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'));
        const magic = Buffer.from('stealth_pngcomp', 'ascii');
        const lenBits = compressed.length * 8;
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(lenBits >>> 0, 0);

        const bitStream = [];
        const pushByte = (b) => {
            for (let i = 7; i >= 0; i--) bitStream.push((b >> i) & 1);
        };
        for (let i = 0; i < magic.length; i++) pushByte(magic[i]);
        for (let i = 0; i < 4; i++) pushByte(lenBuf[i]);
        for (let i = 0; i < compressed.length; i++) pushByte(compressed[i]);

        const maxBits = width * height;
        if (bitStream.length > maxBits) {
            throw new Error(`Stealth payload too large (${bitStream.length} bits > ${maxBits} alpha capacity)`);
        }

        const pixels = Buffer.from(data);
        for (let index = 0; index < bitStream.length; index++) {
            const x = Math.floor(index / height);
            const y = index % height;
            const pi = (y * width + x) * channels + 3;
            pixels[pi] = (pixels[pi] & 0xfe) | bitStream[index];
        }

        return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    }

    /**
     * Ensure original NAI Comment is present in stealth. Does not rewrite if already present.
     * @returns {{ buffer: Buffer, originComment: string, embedded: boolean, wroteStealth: boolean, textMeta: object }}
     */
    async ensureOriginCommentInStealth(imageBuffer) {
        const textMeta = this.readMetadata(imageBuffer);
        const textComment = textMeta?.tEXt?.Comment || '';

        const stealth = await this.readStealthMetadata(imageBuffer);
        if (stealth?.tEXt?.Comment) {
            return {
                buffer: imageBuffer,
                originComment: stealth.tEXt.Comment,
                embedded: true,
                wroteStealth: false,
                textMeta,
                stealthMeta: stealth
            };
        }

        // No stealth — embed origin Comment from tEXt (strip forge_data if present)
        let originComment = textComment;
        try {
            const parsed = JSON.parse(textComment);
            if (parsed && typeof parsed === 'object' && parsed.forge_data) {
                const stripped = { ...parsed };
                delete stripped.forge_data;
                originComment = stringifyNaiStyle(stripped);
            }
        } catch (_) { /* keep raw tEXt Comment string */ }

        const outer = {
            Description: textMeta?.tEXt?.Description || '',
            Software: textMeta?.tEXt?.Software || 'NovelAI',
            Source: textMeta?.tEXt?.Source || '',
            'Generation time': textMeta?.tEXt?.['Generation time'] != null
                ? (isNaN(Number(textMeta.tEXt['Generation time']))
                    ? textMeta.tEXt['Generation time']
                    : Number(textMeta.tEXt['Generation time']))
                : 0,
            Comment: originComment
        };

        // Preserve existing non-text chunks' pixels via raw rewrite; caller re-applies tEXt
        const stegaBuffer = await this.writeStealthPngComp(imageBuffer, outer);
        return {
            buffer: stegaBuffer,
            originComment,
            embedded: true,
            wroteStealth: true,
            textMeta,
            stealthMeta: null
        };
    }

    /**
     * Replace tEXt Comment with stealth origin Comment (exact string). For clipboard / export.
     */
    async restoreOriginCommentFromStealth(imageBuffer) {
        const stealth = await this.readStealthMetadata(imageBuffer);
        if (!stealth?.tEXt?.Comment) {
            return { buffer: imageBuffer, restored: false };
        }

        const textMeta = this.readMetadata(imageBuffer);
        let cleaned = this.stripPngTextChunks(imageBuffer);
        cleaned = this.insertTextChunk(cleaned, 'Comment', stealth.tEXt.Comment);

        const source = stealth.tEXt.Source || textMeta?.tEXt?.Source;
        const software = stealth.tEXt.Software || textMeta?.tEXt?.Software;
        const description = stealth.tEXt.Description || textMeta?.tEXt?.Description;
        if (description) cleaned = this.insertTextChunk(cleaned, 'Description', description);
        if (software) cleaned = this.insertTextChunk(cleaned, 'Software', software);
        if (source) cleaned = this.insertTextChunk(cleaned, 'Source', source);
        // Title via Comment insert side-effect → set Explore-aligned title
        cleaned = this.insertTextChunk(cleaned, 'Title', STANDARD_PNG_TITLE);

        const genTime = textMeta?.tEXt?.['Generation time'] || textMeta?.tEXt?.Generation_time;
        if (genTime != null && genTime !== '') {
            cleaned = this.insertTextChunk(cleaned, 'Generation time', String(genTime));
        }

        return { buffer: cleaned, restored: true, originComment: stealth.tEXt.Comment };
    }

    /**
     * Embed/confirm origin Comment in stealth, write forge_data, then attest with forge_signed_hash.
     */
    async finalizeWithForgeData(imageBuffer, forgeData) {
        const ensured = await this.ensureOriginCommentInStealth(imageBuffer);
        let buffer = ensured.buffer;
        const originComment = ensured.originComment || '';

        // If we rewrote pixels for stealth, re-apply prior tEXt (sans forge) before merging forge_data
        if (ensured.wroteStealth && ensured.textMeta?.tEXt) {
            const t = ensured.textMeta.tEXt;
            if (t.Comment) buffer = this.insertTextChunk(buffer, 'Comment', t.Comment);
            if (t.Description) buffer = this.insertTextChunk(buffer, 'Description', t.Description);
            if (t.Software) buffer = this.insertTextChunk(buffer, 'Software', t.Software);
            if (t.Source) buffer = this.insertTextChunk(buffer, 'Source', t.Source);
            if (t['Generation time']) buffer = this.insertTextChunk(buffer, 'Generation time', t['Generation time']);
            else if (t.Generation_time) buffer = this.insertTextChunk(buffer, 'Generation time', t.Generation_time);
        }

        const nextForge = { ...(forgeData || {}) };
        nextForge.origin_response_embedded = !!ensured.embedded;
        delete nextForge.forge_signed_hash;

        // Merge forge_data first (adds software/history/etc.) then sign the final shape
        buffer = this.updateMetadata(buffer, nextForge);
        try {
            const meta = this.readMetadata(buffer);
            const comment = JSON.parse(meta.tEXt.Comment);
            const finalForge = comment.forge_data || {};
            delete finalForge.forge_signed_hash;
            finalForge.origin_response_embedded = !!ensured.embedded;
            const rgb = await this.extractRgbBytes(buffer);
            this.attestForgeData(rgb, originComment, finalForge);
            comment.forge_data = finalForge;
            buffer = this.insertTextChunk(buffer, 'Comment', JSON.stringify(comment));
        } catch (e) {
            console.error('Forge image signing failed:', e.message);
        }
        return buffer;
    }

    /**
     * Verify NovelAI Comment.signed_hash (Ed25519 over RGB + comment JSON sans signed_hash).
     * Prefers stealth origin Comment (exact bytes); falls back to tEXt Comment.
     * @returns {{ ok: boolean, reason: string|null, source: 'stealth'|'text'|null }}
     */
    async verifyNovelAiSignature(imageBuffer) {
        let rgb;
        try {
            rgb = await this.extractRgbBytes(imageBuffer);
        } catch (e) {
            return { ok: false, reason: 'rgb_extract_failed', source: null };
        }

        const tryComment = (commentStr, source) => {
            if (!commentStr || typeof commentStr !== 'string') {
                return { ok: false, reason: 'no_comment', source };
            }
            let c = commentStr;
            try {
                const parsed = JSON.parse(c);
                // Outer stealth wrapper may nest Comment
                if (parsed && typeof parsed.Comment === 'string' && parsed.Comment.includes('signed_hash')) {
                    c = parsed.Comment;
                }
            } catch (_) { /* use raw string */ }

            const { commentWithoutSig, signatureB64 } = stripSignedHashFromCommentJson(c);
            if (!signatureB64) {
                return { ok: false, reason: 'no_signed_hash', source };
            }
            try {
                const payload = Buffer.concat([rgb, Buffer.from(commentWithoutSig, 'utf8')]);
                const ok = crypto.verify(null, payload, NAI_VERIFY_PUBKEY, Buffer.from(signatureB64, 'base64'));
                return { ok, reason: ok ? null : 'bad_signature', source };
            } catch (_) {
                return { ok: false, reason: 'verify_error', source };
            }
        };

        const stealth = await this.readStealthMetadata(imageBuffer);
        if (stealth?.tEXt?.Comment) {
            const stealthResult = tryComment(stealth.tEXt.Comment, 'stealth');
            if (stealthResult.ok || stealthResult.reason !== 'no_signed_hash') {
                return stealthResult;
            }
        }

        const textMeta = this.readMetadata(imageBuffer);
        if (textMeta?.tEXt?.Comment) {
            return tryComment(textMeta.tEXt.Comment, 'text');
        }

        return { ok: false, reason: 'no_signed_hash', source: null };
    }

    /**
     * Sign forge_data for an image (mutates forgeData with forge_signed_hash).
     */
    attestForgeData(rgbBuffer, originComment, forgeData) {
        if (!this.globalResources || !forgeData) return forgeData;
        try {
            forgeData.forge_signed_hash = signGeneratedImage(
                this.globalResources,
                rgbBuffer,
                originComment || '',
                forgeData
            );
        } catch (e) {
            console.error('Forge image signing failed:', e.message);
        }
        return forgeData;
    }

    /**
     * Verify forge_signed_hash on an image buffer.
     */
    async verifyForgeSignature(imageBuffer) {
        const textMeta = this.readMetadata(imageBuffer);
        if (!textMeta?.tEXt?.Comment) return { ok: false, reason: 'no_comment' };
        let comment;
        try {
            comment = JSON.parse(textMeta.tEXt.Comment);
        } catch (_) {
            return { ok: false, reason: 'bad_comment' };
        }
        const forgeData = comment.forge_data;
        const sig = forgeData?.forge_signed_hash;
        if (!sig) return { ok: false, reason: 'no_forge_signed_hash' };

        const stealth = await this.readStealthMetadata(imageBuffer);
        const originComment = stealth?.tEXt?.Comment || '';
        if (!originComment) return { ok: false, reason: 'no_origin_comment' };

        const rgb = await this.extractRgbBytes(imageBuffer);
        // verifyGeneratedImage: modules/forgeSigning.js
        const ok = this.globalResources
            ? verifyGeneratedImage(this.globalResources, rgb, originComment, forgeData, sig)
            : false;
        return { ok, reason: ok ? null : 'bad_signature' };
    }
}

module.exports = PngMetadata; 