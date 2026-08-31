/**
 * MCP image compare (same-seed pixel diff) and workspace theme frequency.
 */

const sharp = require('sharp');

const DIFF_THRESHOLD = 12;
const AMPLIFY = 3;
const THEME_SAMPLE_MAX = 120;
const OVERUSED_SHARE = 0.25;

async function compareImageFiles(pathA, pathB) {
    const metaA = await sharp(pathA).metadata();
    const metaB = await sharp(pathB).metadata();
    const width = Math.min(metaA.width || 0, metaB.width || 0);
    const height = Math.min(metaA.height || 0, metaB.height || 0);
    if (!width || !height) {
        const err = new Error('Could not read image dimensions');
        err.status = 400;
        throw err;
    }

    const rawA = await sharp(pathA).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
    const rawB = await sharp(pathB).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
    const diff = Buffer.alloc(rawA.length);
    let changed = 0;
    let sum = 0;
    const pixels = width * height;
    for (let i = 0; i < rawA.length; i += 4) {
        const dr = Math.abs(rawA[i] - rawB[i]);
        const dg = Math.abs(rawA[i + 1] - rawB[i + 1]);
        const db = Math.abs(rawA[i + 2] - rawB[i + 2]);
        const mag = Math.max(dr, dg, db);
        const amplified = Math.min(255, mag * AMPLIFY);
        diff[i] = amplified;
        diff[i + 1] = 0;
        diff[i + 2] = amplified;
        diff[i + 3] = 255;
        if (mag > DIFF_THRESHOLD) changed += 1;
        sum += (dr + dg + db) / 3;
    }

    const bytes = await sharp(diff, { raw: { width, height, channels: 4 } })
        .webp({ quality: 72 })
        .toBuffer();

    return {
        width,
        height,
        pixels,
        changedPixels: changed,
        changedPercent: Number(((100 * changed) / pixels).toFixed(2)),
        meanDelta: Number((sum / pixels).toFixed(2)),
        image: { mimeType: 'image/webp', bytes, filename: 'mcp-diff.webp' }
    };
}

function splitPromptTags(text) {
    return String(text || '')
        .split(/[,\n]/)
        .map((part) => part.replace(/[{}[\]()]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
        .filter((part) => part.length >= 3 && part.length <= 80);
}

function metadataPromptBlob(row) {
    const meta = row && (row.metadata || row);
    const forge = (meta && meta.forge_data) || {};
    const parts = [
        meta && meta.prompt,
        forge.input_prompt,
        Array.isArray(forge.characterNames) ? forge.characterNames.join(', ') : '',
        Array.isArray(forge.allCharacters)
            ? forge.allCharacters.map((ch) => (ch && (ch.chara_name || ch.prompt)) || '').join(', ')
            : ''
    ];
    return parts.filter(Boolean).join(', ');
}

function countFrequencies(items) {
    const counts = new Map();
    items.forEach((item) => {
        counts.set(item, (counts.get(item) || 0) + 1);
    });
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({ value, count }));
}

function evaluateThemeRows(rows) {
    const sample = Array.isArray(rows) ? rows.slice(0, THEME_SAMPLE_MAX) : [];
    const n = sample.length;
    const characterHits = [];
    const tagHits = [];

    sample.forEach((row) => {
        const meta = row && (row.metadata || row);
        const forge = (meta && meta.forge_data) || {};
        const names = Array.isArray(forge.characterNames) ? forge.characterNames : [];
        names.forEach((name) => {
            const cleaned = String(name || '').trim().toLowerCase();
            if (cleaned) characterHits.push(cleaned);
        });
        splitPromptTags(metadataPromptBlob(row)).forEach((tag) => tagHits.push(tag));
    });

    const characters = countFrequencies(characterHits);
    const tags = countFrequencies(tagHits);
    const overusedCharacters = characters.filter((row) => n > 0 && row.count / n >= OVERUSED_SHARE);
    const overusedTags = tags.filter((row) => n > 0 && row.count / n >= OVERUSED_SHARE).slice(0, 16);

    return {
        success: true,
        sample: n,
        overusedCharacters,
        overusedTags,
        topCharacters: characters.slice(0, 12),
        topTags: tags.slice(0, 20),
        suggestions: {
            characters: overusedCharacters.length
                ? 'Those character names dominate this folder. Try a new subject or swap the lead.'
                : 'No single character is dominating. You can still introduce a new lead.',
            scenes: 'If backgrounds and locations repeat in the overused tags, change the setting (indoors/outdoors, time of day, weather).',
            kinks: 'If the same pose / clothing / fetish tags sit in the overused list, drop two of them and add one you have not used in this sample.'
        }
    };
}

module.exports = {
    DIFF_THRESHOLD,
    compareImageFiles,
    splitPromptTags,
    evaluateThemeRows,
    metadataPromptBlob
};
