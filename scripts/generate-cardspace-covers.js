#!/usr/bin/env node
/**
 * Card covers for Dreamscape CardSpace (Yozora #781): the faces of cards that have no logo of
 * their own, drawn like Windows CardSpace's Personal card picture (a single glossy Vista-era
 * 3D object on a soft light gradient). No brand marks: each cover shows what the key is for.
 * The OpenAI key resolves like the app icons: OPENAI_API_KEY, otherwise secure.config.json.
 *
 *   node scripts/generate-cardspace-covers.js                 # every cover
 *   node scripts/generate-cardspace-covers.js openai exa      # some
 *   node scripts/generate-cardspace-covers.js --dry-run
 *
 * Writes public/static_images/vista-cardspace/covers/<name>.webp at 240 x 160 (the 120 x 80
 * card picture at 2x), cover-cropped from the model's 1536 x 1024.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const OpenAI = require('openai');
const { resolveOpenAiKey } = require('../modules/appIconGenerator');

const OUT_DIR = path.join(__dirname, '..', 'public', 'static_images', 'vista-cardspace', 'covers');
const MODEL = process.env.CARDSPACE_COVER_MODEL || 'gpt-image-2.5-sunburst';

const STYLE = [
    'Card artwork for a Windows Vista (2007) identity card, in the exact style of the Windows CardSpace',
    'personal card picture: one glossy, softly lit 3D object, centred and slightly to the right,',
    'rendered like a Vista Aero icon (smooth plastic and glass, gentle specular highlights, soft',
    'contact shadow). The background is a calm smooth gradient filling the whole frame, no border,',
    'no frame, no card outline. Wide 3:2 composition with generous empty space around the object.',
    'No text, no letters, no numbers, no logos, no brand marks, no watermark, no people.'
].join(' ');

const COVERS = {
    openai: 'The object: an abstract glossy knot of six interlocking soft white and graphite loops, like a woven ribbon flower, suggesting an artificial intelligence. Background: pale grey to soft silver gradient.',
    openweather: 'The object: a glossy white cloud with a bright yellow-orange sun peeking out behind it and two small blue raindrops. Background: light sky blue to pale cyan gradient.',
    exa: 'The object: a glossy blue glass magnifying glass with a chrome rim, lying over a small translucent globe made of thin light-blue meridian lines. Background: pale blue-grey gradient.',
    runpod: 'The object: a glossy graphics card (GPU) seen at an angle, dark grey with two fans and a soft violet glow along its edge. Background: pale lavender to light grey gradient.',
    'model-provider': 'The object: a glossy glass server tower with softly glowing teal light seams, a small speech bubble floating beside it. Background: pale mint to light grey gradient.',
    'service-key': 'The object: a glossy golden key with a round bow, lying diagonally on a small blue glass plate. Background: pale warm grey to light green-grey gradient.',
    'mcp-agent': 'The object: a friendly glossy white and blue toy robot head with round glowing cyan eyes and a small antenna. Background: light blue-grey to pale green-grey gradient.',
    application: 'The object: a glossy program window (a small blue Aero window with a title bar) with a silver plug and cable connected to its side. Background: pale grey-green gradient, like the CardSpace personal card.'
};

async function main() {
    const args = process.argv.slice(2);
    const dry = args.includes('--dry-run');
    const names = args.filter((a) => !a.startsWith('--'));
    const pick = names.length ? names : Object.keys(COVERS);
    const unknown = pick.filter((n) => !COVERS[n]);
    if (unknown.length) throw new Error(`Unknown cover(s): ${unknown.join(', ')}. Known: ${Object.keys(COVERS).join(', ')}`);
    if (dry) {
        pick.forEach((n) => console.log(`${n}: ${STYLE} ${COVERS[n]}\n`));
        return;
    }
    const resolved = resolveOpenAiKey(path.join(__dirname, '..'));
    const apiKey = resolved && (resolved.apiKey || resolved);
    if (!apiKey || typeof apiKey !== 'string') throw new Error('No OpenAI key (OPENAI_API_KEY or secure.config.json)');
    const client = new OpenAI({ apiKey, timeout: 300000 });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await Promise.all(pick.map(async (name) => {
        const result = await client.images.generate({ model: MODEL, prompt: `${STYLE} ${COVERS[name]}`, size: '1536x1024', quality: 'high', n: 1 });
        const b64 = result && result.data && result.data[0] && result.data[0].b64_json;
        if (!b64) throw new Error(`${name}: the response had no image data`);
        const out = path.join(OUT_DIR, `${name}.webp`);
        await sharp(Buffer.from(b64, 'base64')).resize(240, 160, { fit: 'cover', kernel: 'lanczos3' }).webp({ quality: 90 }).toFile(out);
        console.log(`wrote ${path.relative(process.cwd(), out)}`);
    }));
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
