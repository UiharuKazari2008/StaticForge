// modules/planetSheets.js
// Sprite sheets for the planet switcher (public/scripts/comp/planetSwitcher.js).
//
// One strip per workspace: every slide is resized to a square tile, desaturated, tinted with the
// workspace colour, vignetted and glossed with sharp, then laid out left to right in a single webp.
// The client shows the strip as one background image per planet and crossfades by shifting
// background-position, so it never decodes or draws the pictures itself.
//
// Flow: the workspace_preview_samples handler registers a recipe (rows + colour + tile) and hands
// the client a URL under /planet-sheets/<key>.webp. The route builds the strip on first request and
// caches it under .cache/planet-sheets/. Keys are content hashes, so unchanged samples reuse files.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const SHEET_ROUTE = '/planet-sheets';
const TILE_MIN = 128;
const TILE_MAX = 256;
const TILE_DEFAULT = 192;
const SLIDES_MAX = 12;
const RECIPE_TTL_MS = 30 * 60 * 1000;
const RECIPES_MAX = 600;
const FILES_MAX = 400;

function clampTile(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return TILE_DEFAULT;
    return Math.max(TILE_MIN, Math.min(TILE_MAX, n));
}

/** #rrggbb only; anything else falls back to the default planet colour (the value lands inside an SVG). */
function sanitizeColor(value) {
    const raw = String(value || '').trim();
    const long = raw.match(/^#([0-9a-f]{6})$/i);
    if (long) return `#${long[1].toLowerCase()}`;
    const short = raw.match(/^#([0-9a-f]{3})$/i);
    if (short) return `#${short[1].split('').map((c) => c + c).join('').toLowerCase()}`;
    return '#6366f1';
}

/** Tint, edge veil, dark rim and glass highlight for one tile (mirrors planetSwitcherTileCache.bake). */
function overlaySvg(tile, color) {
    const t = tile;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${t}" viewBox="0 0 ${t} ${t}">
<defs>
<radialGradient id="veil" cx="50%" cy="45%" r="56%"><stop offset="0.28" stop-color="${color}" stop-opacity="0"/><stop offset="1" stop-color="${color}" stop-opacity="0.6"/></radialGradient>
<radialGradient id="rim" cx="50%" cy="50%" r="50%"><stop offset="0.56" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.5"/></radialGradient>
<radialGradient id="gloss" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${(t * 0.42).toFixed(1)}" gradientTransform="translate(${(t * 0.32).toFixed(1)} ${(t * 0.2).toFixed(1)}) scale(1 0.66)"><stop offset="0" stop-color="#ffffff" stop-opacity="0.58"/><stop offset="0.52" stop-color="#ffffff" stop-opacity="0.1"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${t}" height="${t}" fill="${color}" fill-opacity="0.36"/>
<rect width="${t}" height="${t}" fill="url(#veil)"/>
<rect width="${t}" height="${t}" fill="url(#rim)"/>
<rect width="${t}" height="${t}" fill="url(#gloss)"/>
</svg>`;
}

class PlanetSheetService {
    constructor(globalResources) {
        this.globalResources = globalResources;
        this.recipes = new Map();
        this.building = new Map();
    }

    dir() {
        return path.join(this.globalResources.getPath('cache'), 'planet-sheets');
    }

    previewsDir() {
        return this.globalResources.getPath('previews');
    }

    /**
     * Remember a recipe and describe the sheet the client should load.
     * @param {string} workspaceId
     * @param {Array<{base: string}>} rows newest-first slide rows (base names without extension)
     * @param {string} color workspace colour
     * @param {number} tile tile edge in px
     */
    register(workspaceId, rows, color, tile) {
        const safeColor = sanitizeColor(color);
        const size = clampTile(tile);
        const bases = (Array.isArray(rows) ? rows : [])
            .map((row) => (row && typeof row.base === 'string' ? row.base : ''))
            .filter((base) => base && !base.includes('/') && !base.includes('..'))
            .slice(0, SLIDES_MAX);
        if (!bases.length) return null;
        const key = crypto.createHash('sha1')
            .update(`${workspaceId}|${safeColor}|${size}|${bases.join(',')}`)
            .digest('hex')
            .slice(0, 20);
        this.recipes.set(key, { workspaceId, bases, color: safeColor, tile: size, at: Date.now() });
        this.pruneRecipes();
        return {
            key,
            url: `${SHEET_ROUTE}/${key}.webp`,
            tile: size,
            count: bases.length,
            width: size * bases.length,
            height: size,
            bases
        };
    }

    pruneRecipes() {
        const now = Date.now();
        for (const [key, recipe] of this.recipes) {
            if (now - recipe.at > RECIPE_TTL_MS) this.recipes.delete(key);
        }
        while (this.recipes.size > RECIPES_MAX) {
            this.recipes.delete(this.recipes.keys().next().value);
        }
    }

    filePath(key) {
        return path.join(this.dir(), `${key}.webp`);
    }

    /** Resolve the strip file, building it on first use. Returns null when the key is unknown and no file exists. */
    async ensure(key) {
        if (!/^[a-f0-9]{20}$/.test(String(key || ''))) return null;
        const file = this.filePath(key);
        if (fs.existsSync(file)) {
            try { fs.utimesSync(file, new Date(), new Date()); } catch (error) { /* touch is best effort */ }
            return file;
        }
        const recipe = this.recipes.get(key);
        if (!recipe) return null;
        if (!this.building.has(key)) {
            const job = this.build(recipe, file)
                .then(() => file)
                .catch((error) => {
                    console.warn('[planet-sheets] build failed:', error && error.message ? error.message : error);
                    return null;
                })
                .finally(() => this.building.delete(key));
            this.building.set(key, job);
        }
        return this.building.get(key);
    }

    previewFileFor(base) {
        const dir = this.previewsDir();
        for (const ext of ['.webp', '.jpg', '.jpeg', '.png']) {
            const candidate = path.join(dir, `${base}${ext}`);
            if (fs.existsSync(candidate)) return candidate;
        }
        return null;
    }

    async build(recipe, file) {
        const { bases, color, tile } = recipe;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const overlay = await sharp(Buffer.from(overlaySvg(tile, color))).png().toBuffer();
        const tiles = [];
        for (const base of bases) {
            const source = this.previewFileFor(base);
            if (!source) continue;
            try {
                const buffer = await sharp(source)
                    .resize(tile, tile, { fit: 'cover', position: 'centre' })
                    .modulate({ saturation: 0.3, brightness: 0.96 })
                    .png()
                    .toBuffer();
                tiles.push(buffer);
            } catch (error) {
                console.warn('[planet-sheets] skipped', base, error && error.message ? error.message : error);
            }
        }
        if (!tiles.length) throw new Error('no usable slides');
        const composite = [];
        tiles.forEach((buffer, i) => {
            composite.push({ input: buffer, left: i * tile, top: 0 });
            composite.push({ input: overlay, left: i * tile, top: 0 });
        });
        const tmp = `${file}.${process.pid}.tmp`;
        await sharp({
            create: { width: tile * tiles.length, height: tile, channels: 4, background: { r: 5, g: 7, b: 14, alpha: 1 } }
        })
            .composite(composite)
            .webp({ quality: 78, effort: 4 })
            .toFile(tmp);
        fs.renameSync(tmp, file);
        this.pruneFiles();
        return { file, count: tiles.length };
    }

    pruneFiles() {
        try {
            const dir = this.dir();
            const files = fs.readdirSync(dir)
                .filter((name) => name.endsWith('.webp'))
                .map((name) => {
                    const full = path.join(dir, name);
                    return { full, mtime: fs.statSync(full).mtimeMs };
                })
                .sort((a, b) => b.mtime - a.mtime);
            files.slice(FILES_MAX).forEach((entry) => {
                try { fs.unlinkSync(entry.full); } catch (error) { /* already gone */ }
            });
        } catch (error) {
            /* nothing to prune yet */
        }
    }

    /** Express handler for GET /planet-sheets/:key.webp (auth applied by the caller). */
    async serve(req, res) {
        const key = String(req.params.key || '');
        const file = await this.ensure(key);
        if (!file) {
            res.status(404).json({ success: false, error: 'Sheet not found' });
            return;
        }
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.setHeader('Content-Type', 'image/webp');
        res.sendFile(file, (err) => {
            if (!err || res.writableEnded) return;
            if (res.headersSent) {
                res.destroy();
                return;
            }
            res.status(err.code === 'ENOENT' ? 404 : 500).end();
        });
    }
}

let singleton = null;
function getPlanetSheetService(globalResources) {
    if (!singleton) singleton = new PlanetSheetService(globalResources);
    return singleton;
}

module.exports = {
    SHEET_ROUTE,
    TILE_MIN,
    TILE_MAX,
    TILE_DEFAULT,
    SLIDES_MAX,
    PlanetSheetService,
    getPlanetSheetService,
    clampTile,
    sanitizeColor,
    overlaySvg
};
