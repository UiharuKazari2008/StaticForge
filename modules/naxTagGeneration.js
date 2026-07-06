/**
 * Standalone NAX preview generation (not imageGeneration pipeline).
 * Config: nax_generation_config.json at repo root.
 * Instantiated only from globalResources.js with globalResources pointer.
 */

const fs = require('fs');
const path = require('path');

const TAG_PLACEHOLDER = '<INPUT_VALUE>';

class NaxTagGenerationService {
    constructor(globalResources) {
        if (!globalResources) {
            throw new Error('NaxTagGenerationService requires globalResources instance and should only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
        this.configCache = null;
    }

    get configPath() {
        return this.globalResources.getPath('naxGenerationConfig');
    }

    get naxImagesDir() {
        return this.globalResources.getPath('naxImages');
    }

    loadConfig() {
        if (this.configCache) return this.configCache;
        if (!fs.existsSync(this.configPath)) {
            throw new Error('nax_generation_config.json not found');
        }
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed.galleries || typeof parsed.galleries !== 'object') {
            throw new Error('nax_generation_config.json: missing galleries object');
        }
        this.configCache = parsed;
        return this.configCache;
    }

    getGenerationSlugs() {
        try {
            const cfg = this.loadConfig();
            return Object.keys(cfg.galleries);
        } catch {
            return [];
        }
    }

    getGalleryGenerationConfig(gallerySlug) {
        const cfg = this.loadConfig();
        const entry = cfg.galleries[gallerySlug];
        if (!entry) {
            throw new Error(`No generation config for gallery: ${gallerySlug}`);
        }
        return entry;
    }

    /** Trim only — preserve case and spaces for prompt/DB tag value. */
    prepareTagInput(tag) {
        return String(tag || '').trim();
    }

    getCustomTagValidationError(tag) {
        const t = this.prepareTagInput(tag);
        if (!t.length) return 'Enter a tag name';
        if (t.length > 120) return 'Tag name is too long';
        if (t.includes(',')) return 'Enter a single tag only (no commas)';
        if (t.includes('..') || /[\x00-\x1f\/\\]/.test(t)) return 'Invalid tag';
        return null;
    }

    isValidCustomTag(tag) {
        return this.getCustomTagValidationError(tag) === null;
    }

    applyInputValueToTemplate(template, tag) {
        if (typeof template !== 'string' || !template.length) return template;
        const token = this.prepareTagInput(tag);
        if (!template.includes(TAG_PLACEHOLDER)) {
            return template;
        }
        return template.split(TAG_PLACEHOLDER).join(token);
    }

    buildMainPrompt(genCfg, tag) {
        const template = genCfg.promptTemplate || '';
        const characterTemplate = genCfg.characterPrompt || '';
        const tagInMain = template.includes(TAG_PLACEHOLDER);
        const tagInCharacter = characterTemplate.includes(TAG_PLACEHOLDER);
        if (!tagInMain && !tagInCharacter) {
            throw new Error(`Generation config must contain ${TAG_PLACEHOLDER} in promptTemplate or characterPrompt`);
        }
        return tagInMain ? this.applyInputValueToTemplate(template, tag) : template;
    }

    naxFilenameForTag(tag) {
        const token = this.prepareTagInput(tag);
        return `${encodeURIComponent(token)}.png`;
    }

    naxImageDirForSlug(gallerySlug) {
        return path.join(this.naxImagesDir, gallerySlug);
    }

    /**
     * @param {string} gallerySlug
     * @param {string} tag
     * @returns {Promise<{ filename: string, absPath: string }>}
     */
    async generateNaxTagImage(gallerySlug, tag) {
        const genCfg = this.getGalleryGenerationConfig(gallerySlug);
        const client = this.globalResources.getNovelAiClient();
        if (!client) {
            throw new Error('NovelAI client is not available. Configure API key in secure.config.json.');
        }

        const prompt = this.buildMainPrompt(genCfg, tag);
        const filename = this.naxFilenameForTag(tag);
        const outDir = this.naxImageDirForSlug(gallerySlug);
        const absPath = path.join(outDir, filename);

        fs.mkdirSync(outDir, { recursive: true });

        const opts = {
            prompt,
            negative_prompt: this.applyInputValueToTemplate(genCfg.negativePrompt || '', tag),
            model: genCfg.model || 'nai-diffusion-4-5-full',
            resPreset: genCfg.resPreset || 'normal_portrait',
            steps: Number(genCfg.steps) || 28,
            scale: Number(genCfg.scale) || 4,
            sampler: genCfg.sampler || 'k_euler_ancestral',
            seed: Number(genCfg.seed) || Math.floor(Math.random() * 2147483647),
            qualityToggle: genCfg.qualityToggle !== false,
            ucPreset: genCfg.ucPreset !== undefined ? genCfg.ucPreset : 3
        };

        if (genCfg.characterPrompt) {
            opts.characterPrompts = [{
                prompt: this.applyInputValueToTemplate(genCfg.characterPrompt, tag),
                uc: this.applyInputValueToTemplate(genCfg.characterUc || '', tag),
                center: { x: 0.5, y: 0.5 },
                enabled: true
            }];
        }

        // Tripwire: fast-fail when locked, and record success/failure outcomes.
        const images = await this.globalResources.guardServiceCall('novelai', () => client.generateImage(opts, false, false));
        if (!images || !images.length) {
            throw new Error('NovelAI returned no images');
        }

        const image = images[0];
        fs.writeFileSync(absPath, Buffer.from(image.data));

        return { filename, absPath };
    }
}

NaxTagGenerationService.TAG_PLACEHOLDER = TAG_PLACEHOLDER;

module.exports = NaxTagGenerationService;
