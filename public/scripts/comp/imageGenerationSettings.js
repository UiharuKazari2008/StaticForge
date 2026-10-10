/**
 * Studio Image Generation prefs + Quickstart Gallery empty state.
 * Server twin: modules/imageGenerationSettings.js
 * Persist: persistUserGlobalSettingsPatch — public/scripts/comp/modalUtils.js
 */

const DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT = {
    streamImageGeneration: true,
    showStreamedImagesUnprocessed: true,
    simpleOutputViewer: false,
    lockOutputViewerCamera: false,
    reducedMotion: false,
    transparencyBackground: 'checker-dark',
    transparencyCustomColor: '#808080',
    hideQuickstartGallery: false,
    persistHistory: true,
    imageFormat: 'png',
    automaticDownload: false,
    alphaMode: 'straight'
};

const IMAGE_GENERATION_TRANSPARENCY_BACKGROUNDS = new Set([
    'checker-dark',
    'checker-light',
    'white',
    'black',
    'gray',
    'red',
    'green',
    'blue',
    'custom'
]);

let imageGenerationSettingsState = { ...DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT };
let imageGenerationSettingsWired = false;
let quickstartGalleryLoadPromise = null;
let quickstartGalleryItems = null;
let quickstartApplyInFlight = false;
let studioGalleryMode = 'quickstart';
let studioGalleryRefreshSeq = 0;
let studioGalleryRevealPending = false;
let explorerGalleryItems = null;
let explorerGalleryLoadPromise = null;

const NAI_QUICKSTART_CATALOG_URL = '/data/nai-quickstart-v5.json';
const QUICKSTART_CACHE_BASE = '/cache/quickstart/';
let studioPreviewRestoreInFlight = false;

function normalizeImageGenerationBooleanClient(value, fallback) {
    if (typeof value === 'boolean') return value;
    return fallback;
}

function normalizeImageGenerationTransparencyBackgroundClient(raw) {
    const value = String(raw || '').toLowerCase().replace(/[\s_]+/g, '-');
    if (IMAGE_GENERATION_TRANSPARENCY_BACKGROUNDS.has(value)) return value;
    if (value === 'checker' || value === 'checkerboard') return 'checker-dark';
    return DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT.transparencyBackground;
}

function normalizeImageGenerationCustomColorClient(raw) {
    const value = String(raw || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(value)) {
        return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
    }
    return DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT.transparencyCustomColor;
}

function normalizeImageGenerationFormatClient(raw) {
    const value = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (value === 'webp' || value === 'webplossless') return 'webp';
    if (value === 'png') return 'png';
    return DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT.imageFormat;
}

function normalizeImageGenerationAlphaModeClient(raw) {
    const value = String(raw || '').toLowerCase();
    if (value === 'premultiplied' || value === 'straight') return value;
    return DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT.alphaMode;
}

function normalizeImageGenerationSettingsClient(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const defaults = DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT;
    return {
        streamImageGeneration: normalizeImageGenerationBooleanClient(src.streamImageGeneration, defaults.streamImageGeneration),
        showStreamedImagesUnprocessed: normalizeImageGenerationBooleanClient(
            src.showStreamedImagesUnprocessed,
            defaults.showStreamedImagesUnprocessed
        ),
        simpleOutputViewer: normalizeImageGenerationBooleanClient(src.simpleOutputViewer, defaults.simpleOutputViewer),
        lockOutputViewerCamera: normalizeImageGenerationBooleanClient(src.lockOutputViewerCamera, defaults.lockOutputViewerCamera),
        reducedMotion: normalizeImageGenerationBooleanClient(src.reducedMotion, defaults.reducedMotion),
        transparencyBackground: normalizeImageGenerationTransparencyBackgroundClient(src.transparencyBackground),
        transparencyCustomColor: normalizeImageGenerationCustomColorClient(src.transparencyCustomColor),
        hideQuickstartGallery: normalizeImageGenerationBooleanClient(src.hideQuickstartGallery, defaults.hideQuickstartGallery),
        persistHistory: normalizeImageGenerationBooleanClient(src.persistHistory, defaults.persistHistory),
        imageFormat: normalizeImageGenerationFormatClient(src.imageFormat),
        automaticDownload: normalizeImageGenerationBooleanClient(src.automaticDownload, defaults.automaticDownload),
        alphaMode: normalizeImageGenerationAlphaModeClient(src.alphaMode)
    };
}

function getImageGenerationSettings() {
    return imageGenerationSettingsState;
}

function isManualPreviewImageLoaded() {
    const img = document.getElementById('manualPreviewImage');
    if (!img || img.classList.contains('hidden')) return false;
    const src = img.currentSrc || img.src || '';
    return src !== '' && src !== window.location.href;
}

function shouldShowManualQuickstartGallery() {
    if (imageGenerationSettingsState.hideQuickstartGallery) return false;
    if (isManualPreviewImageLoaded()) return false;
    const form = document.getElementById('manualForm');
    if (form && form.classList.contains('generating')) return false;
    if (form && form.classList.contains('streaming')) return false;
    return true;
}

function applyImageGenerationPreviewChrome() {
    const root = document.documentElement;
    const settings = imageGenerationSettingsState;
    root.classList.toggle('studio-simple-output', settings.simpleOutputViewer === true);
    root.classList.toggle('studio-lock-viewer-camera', settings.lockOutputViewerCamera === true);
    root.classList.toggle('studio-reduced-preview', settings.reducedMotion === true);
    root.dataset.studioTransparencyBg = settings.transparencyBackground;
    root.dataset.studioAlphaMode = settings.alphaMode;
    if (settings.transparencyBackground === 'custom') {
        root.style.setProperty('--studio-transparency-custom', settings.transparencyCustomColor);
    } else {
        root.style.removeProperty('--studio-transparency-custom');
    }
    if (settings.lockOutputViewerCamera) {
        // destroyManualPreviewImageLoupe: public/scripts/comp/manualModalManager.js
        destroyManualPreviewImageLoupe();
    } else {
        // refreshManualPreviewImageLoupe: public/scripts/comp/manualModalManager.js
        refreshManualPreviewImageLoupe();
    }
}

function syncImageGenerationSettingsUI() {
    const s = imageGenerationSettingsState;
    const hideGalleryBtn = document.getElementById('manualQuickstartHideBtn');
    if (hideGalleryBtn) {
        hideGalleryBtn.dataset.state = s.hideQuickstartGallery ? 'on' : 'off';
    }
    const custom = document.getElementById('studioTransparencyCustomColor');
    if (custom) custom.value = s.transparencyCustomColor;
}

function applyImageGenerationSettingsToClient(settings) {
    imageGenerationSettingsState = normalizeImageGenerationSettingsClient(settings);
    applyImageGenerationPreviewChrome();
    syncImageGenerationSettingsUI();
    refreshManualQuickstartGallery();
}

async function persistImageGenerationSettingsPatch(patch) {
    applyImageGenerationSettingsToClient({ ...imageGenerationSettingsState, ...patch });
    // persistUserGlobalSettingsPatch: public/scripts/comp/modalUtils.js
    await persistUserGlobalSettingsPatch({ imageGeneration: { ...imageGenerationSettingsState } });
}

function quickstartFileId(id) {
    return String(id).padStart(4, '0');
}

async function loadQuickstartPresets() {
    if (quickstartGalleryItems) return quickstartGalleryItems;
    if (quickstartGalleryLoadPromise) return quickstartGalleryLoadPromise;
    quickstartGalleryLoadPromise = (async () => {
        const response = await fetch(NAI_QUICKSTART_CATALOG_URL);
        if (!response.ok) throw new Error('Quickstart catalog ' + response.status);
        const catalog = await response.json();
        const requests = catalog.requests || {};
        const ids = Array.isArray(catalog.ids) ? catalog.ids : [];
        const rows = [];
        ids.forEach((id) => {
            const file = quickstartFileId(id);
            const body = requests[file];
            if (!body) return;
            rows.push({
                file,
                src: QUICKSTART_CACHE_BASE + file + '.webp',
                tiny: QUICKSTART_CACHE_BASE + file + '_tiny.webp',
                prompt: body.prompt || '',
                body
            });
        });
        quickstartGalleryItems = rows;
        return rows;
    })().finally(() => {
        quickstartGalleryLoadPromise = null;
    });
    return quickstartGalleryLoadPromise;
}

function studioNormalizePromptTag(tag) {
    return String(tag || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function studioSplitPromptTags(text) {
    const source = String(text || '');
    // listEmphasisBlocks: public/scripts/comp/emphasisParse.js
    const blocks = source.includes('::') ? listEmphasisBlocks(source) : [];
    const tags = [];
    let cursor = 0;
    const pushSlice = (slice) => {
        String(slice || '').split(/[,|]/).forEach((part) => {
            const tag = part.trim();
            if (tag) tags.push(tag);
        });
    };
    blocks.forEach((block) => {
        if (block.start > cursor) pushSlice(source.slice(cursor, block.start));
        const tag = source.slice(block.start, block.end).trim().replace(/,\s*$/, '');
        if (tag) tags.push(tag);
        cursor = block.end;
    });
    if (cursor < source.length) pushSlice(source.slice(cursor));
    return tags;
}

function studioCleanPromptDelimiters(text) {
    return String(text || '')
        .replace(/(?:\s*(?:,|\|)\s*){2,}/g, ', ')
        .replace(/^\s*(?:,|\|)\s*/, '')
        .replace(/\s*(?:,|\|)\s*$/, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function studioPresetValue(preset) {
    if (typeof preset === 'string') return preset.trim();
    if (preset && typeof preset.value === 'string') return preset.value.trim();
    return '';
}

function studioRemovePromptTags(text, removeTags) {
    const remove = new Set((removeTags || []).map(studioNormalizePromptTag));
    const source = String(text || '');
    if (!remove.size) return studioCleanPromptDelimiters(source);
    // listEmphasisBlocks: public/scripts/comp/emphasisParse.js
    const blocks = source.includes('::') ? listEmphasisBlocks(source) : [];
    let out = '';
    let cursor = 0;
    const consume = (slice) => {
        const parts = String(slice || '').split(/(\s*(?:,|\|)\s*)/);
        const kept = parts.filter((part, index) => {
            if (index % 2 === 1) return true;
            return !remove.has(studioNormalizePromptTag(part));
        });
        return kept.join('');
    };
    blocks.forEach((block) => {
        if (block.start > cursor) out += consume(source.slice(cursor, block.start));
        const blockText = source.slice(block.start, block.end);
        if (!remove.has(studioNormalizePromptTag(blockText))) out += blockText;
        cursor = block.end;
    });
    if (cursor < source.length) out += consume(source.slice(cursor));
    return studioCleanPromptDelimiters(out);
}

function studioPresetTagsPresent(text, presetText) {
    const needed = studioSplitPromptTags(presetText).map(studioNormalizePromptTag).filter(Boolean);
    if (!needed.length) return false;
    const have = new Set(studioSplitPromptTags(text).map(studioNormalizePromptTag));
    return needed.every((tag) => have.has(tag));
}

function studioPositiveEmphasisWeight(weight) {
    const abs = Math.abs(Number(weight));
    if (!Number.isFinite(abs) || abs === 0) return '1';
    return String(Math.round(abs * 1000) / 1000);
}

function studioLiftNegativeEmphasis(text) {
    const source = String(text || '');
    if (!source.includes('::')) return { text: source.trim(), lifted: [] };
    // listEmphasisBlocks: public/scripts/comp/emphasisParse.js
    const blocks = listEmphasisBlocks(source);
    const lifted = [];
    let next = source;
    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        if (!(block.weight < 0)) continue;
        const inner = String(block.innerText || '').trim().replace(/,\s*$/, '');
        if (!inner) continue;
        lifted.unshift(`${studioPositiveEmphasisWeight(block.weight)}::${inner}::`);
        next = next.slice(0, block.start) + next.slice(block.end);
    }
    return { text: studioRemovePromptTags(next, []), lifted };
}

function studioAppendPromptPieces(existing, pieces) {
    const parts = [];
    const base = String(existing || '').trim();
    if (base) parts.push(base);
    (pieces || []).forEach((piece) => {
        const text = String(piece || '').trim();
        if (text) parts.push(text);
    });
    return parts.join(', ');
}

function studioQualityPresetText(model) {
    const table = window.optionsData?.quality_presets;
    if (!table) return '';
    // resolvePresetTableForModel: public/scripts/comp/utilities.js
    const raw = resolvePresetTableForModel(table, model || 'v5');
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw) && raw.length) {
        const first = raw[0];
        if (typeof first === 'string') return first.trim();
        if (first && first.value) return String(first.value).trim();
    }
    return '';
}

function studioUcPresetList(model) {
    const table = window.optionsData?.uc_presets;
    if (!table) return [];
    // resolvePresetTableForModel: public/scripts/comp/utilities.js
    const raw = resolvePresetTableForModel(table, model || 'v5');
    return Array.isArray(raw) ? raw : [];
}

function studioSetNoTextToggle(metadata, enabled) {
    const dataset = metadata.dataset_config && typeof metadata.dataset_config === 'object'
        ? { ...metadata.dataset_config }
        : {};
    const settings = { ...(dataset.settings || {}) };
    const quality = { ...(settings.__quality__ || {}) };
    const current = quality.no_text && typeof quality.no_text === 'object' ? quality.no_text : {};
    quality.no_text = {
        ...current,
        enabled: !!enabled,
        bias: current.bias != null ? current.bias : 1,
        value: current.value || 'no text'
    };
    settings.__quality__ = quality;
    dataset.settings = settings;
    metadata.dataset_config = dataset;
}

function studioLiftFieldNegativeEmphasis(text, into) {
    const lifted = studioLiftNegativeEmphasis(text);
    return {
        text: lifted.text,
        into: studioAppendPromptPieces(into, lifted.lifted)
    };
}

/**
 * Drop quality / UC preset tags so generate can compile them again, and move
 * negative N:: groups onto the negative prompt with the weight flipped positive.
 */
function studioPrepareImportedPrompt(metadata) {
    if (!metadata || typeof metadata !== 'object') return metadata;
    const model = metadata.model || 'v5';
    const qualityText = studioQualityPresetText(model);
    const qualityTags = studioSplitPromptTags(qualityText);
    const ucPresets = studioUcPresetList(model);

    const applyPrompt = (text, negative) => {
        const hadNoText = studioSplitPromptTags(text).some((tag) => studioNormalizePromptTag(tag) === 'no text');
        const qualityHit = qualityText ? studioPresetTagsPresent(text, qualityText) : false;
        const lifted = studioLiftFieldNegativeEmphasis(text, negative);
        let next = lifted.text;
        if (qualityHit) next = studioRemovePromptTags(next, qualityTags);
        if (hadNoText) next = studioRemovePromptTags(next, ['no text']);
        return { text: next, negative: lifted.into, hadNoText, qualityHit };
    };

    const base = applyPrompt(metadata.prompt || '', metadata.input_prompt_negative || metadata.prompt_negative || '');
    metadata.prompt = base.text;
    metadata.input_prompt_negative = base.negative;
    metadata.prompt_negative = base.negative;
    metadata.append_quality = !!base.qualityHit;
    studioSetNoTextToggle(metadata, base.hadNoText);

    let uc = String(metadata.uc || '');
    const ucLift = studioLiftFieldNegativeEmphasis(uc, metadata.input_prompt_negative);
    uc = ucLift.text;
    metadata.input_prompt_negative = ucLift.into;
    metadata.prompt_negative = ucLift.into;

    uc = studioRemovePromptTags(uc, ['nsfw']);
    let appendUc = 0;
    let bestCount = 0;
    ucPresets.forEach((preset, index) => {
        const presetText = studioPresetValue(preset);
        if (!presetText || !studioPresetTagsPresent(uc, presetText)) return;
        const count = studioSplitPromptTags(presetText).length;
        if (count >= bestCount) {
            bestCount = count;
            appendUc = index + 1;
        }
    });
    if (appendUc) {
        const presetText = studioPresetValue(ucPresets[appendUc - 1]);
        uc = studioRemovePromptTags(uc, studioSplitPromptTags(presetText));
    }
    metadata.uc = uc;
    metadata.append_uc = appendUc;

    if (Array.isArray(metadata.allCharacterPrompts)) {
        metadata.allCharacterPrompts.forEach((ch) => {
            if (!ch || typeof ch !== 'object') return;
            const promptLift = studioLiftFieldNegativeEmphasis(ch.prompt || '', ch.input_prompt_negative || ch.prompt_negative || '');
            ch.prompt = promptLift.text;
            const ucLifted = studioLiftFieldNegativeEmphasis(ch.uc || '', promptLift.into);
            ch.uc = ucLifted.text;
            ch.input_prompt_negative = ucLifted.into;
            ch.prompt_negative = ucLifted.into;
        });
    }
    return metadata;
}

async function applyQuickstartRequestBody(row) {
    const body = row && row.body ? row.body : row;
    if (quickstartApplyInFlight || !body) return;
    quickstartApplyInFlight = true;
    // showManualPreviewNavigationLoading: public/scripts/comp/manualModalManager.js
    showManualPreviewNavigationLoading(true, 'Opening in Studio');
    try {
        const raw = { ...body, model: 'v5' };
        delete raw.seed;
        // transformMetadataForEditor: public/scripts/comp/referenceManager.js
        let data = transformMetadataForEditor(raw);
        delete data.seed;
        studioPrepareImportedPrompt(data);
        // applyForgeEditorInputToMetadata: public/scripts/comp/manualModalManager.js
        data = applyForgeEditorInputToMetadata(data);
        // convertMetadataEmphasisToManaged: public/scripts/comp/emphasisGroupIdCodec.js
        data = convertMetadataEmphasisToManaged(data);
        // loadIntoManualForm: public/scripts/comp/manualModalManager.js
        await loadIntoManualForm('metadata', data, null);
        const src = row && row.src;
        if (src) {
            // loadTempImagePreview: public/scripts/comp/manualPreviewManager.js
            await loadTempImagePreview(src, {
                filename: `${(row.file || 'quickstart')}.webp`,
                width: body.width || 1024,
                height: body.height || 1024
            });
        }
    } catch (error) {
        console.warn('Quickstart prompt load failed', error);
        showGlassToast('error', 'Quick Start', 'Could not open this image in Studio', false, 4000);
    } finally {
        showManualPreviewNavigationLoading(false);
        quickstartApplyInFlight = false;
    }
}

async function loadExplorerFeed() {
    if (explorerGalleryItems && explorerGalleryItems.length) return explorerGalleryItems;
    if (explorerGalleryLoadPromise) return explorerGalleryLoadPromise;
    explorerGalleryLoadPromise = (async () => {
        // wsClient.sendMessage: public/scripts/websocket.js
        const data = await wsClient.sendMessage('get_studio_explore_feed', {}, false);
        const rows = Array.isArray(data?.results) ? data.results : [];
        if (rows.length) explorerGalleryItems = rows;
        return rows;
    })().finally(() => {
        explorerGalleryLoadPromise = null;
    });
    return explorerGalleryLoadPromise;
}

function syncStudioGalleryModeToggle() {
    const group = document.getElementById('manualQuickstartModeToggle');
    const bar = document.getElementById('manualQuickstartModebar');
    if (group) {
        group.dataset.active = studioGalleryMode;
        group.querySelectorAll('[data-mode]').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.mode === studioGalleryMode);
        });
    }
    if (bar) bar.dataset.mode = studioGalleryMode;
    const launch = document.getElementById('manualQuickstartExploreLaunch');
    if (launch) launch.classList.toggle('hidden', studioGalleryMode !== 'explorer');
}

function studioGalleryRevealReduced() {
    return document.documentElement.classList.contains('studio-reduced-preview')
        || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function clearStudioGalleryReveal(gallery) {
    gallery.classList.remove('is-revealing', 'is-reveal-from', 'is-title-in', 'is-title-from');
}

function holdStudioGalleryReveal(gallery, withTitle) {
    if (studioGalleryRevealReduced()) {
        gallery.classList.remove('is-revealing', 'is-reveal-from', 'is-title-from');
        return;
    }
    gallery.classList.add('is-reveal-from');
    gallery.classList.remove('is-revealing');
    if (withTitle) {
        gallery.classList.remove('is-title-in');
        gallery.classList.add('is-title-from');
    }
}

function playStudioGalleryReveal(gallery, withTitle) {
    if (studioGalleryRevealReduced()) {
        gallery.classList.remove('is-revealing', 'is-reveal-from', 'is-title-from');
        return;
    }
    void gallery.offsetWidth;
    gallery.classList.remove('is-reveal-from');
    gallery.classList.add('is-revealing');
    if (withTitle) {
        gallery.classList.remove('is-title-from');
        gallery.classList.add('is-title-in');
    }
}

function resetStudioGalleryScroll(gallery) {
    const scroller = gallery.querySelector('.scrollable-content');
    if (scroller) scroller.scrollTop = 0;
}

function syncStudioGalleryModebarStuck() {
    const gallery = document.getElementById('manualQuickstartGallery');
    const bar = document.getElementById('manualQuickstartModebar');
    if (!gallery || !bar) return;
    const scroller = gallery.querySelector('.scrollable-content') || gallery;
    const stuck = scroller.scrollTop > 0
        && bar.getBoundingClientRect().top <= scroller.getBoundingClientRect().top + 1;
    bar.classList.toggle('is-stuck', stuck);
}

function wireStudioGalleryModebarStuck() {
    const gallery = document.getElementById('manualQuickstartGallery');
    if (!gallery) return;
    const scroller = gallery.querySelector('.scrollable-content');
    if (!scroller || scroller.dataset.modebarStuck) return;
    scroller.dataset.modebarStuck = '1';
    scroller.addEventListener('scroll', syncStudioGalleryModebarStuck);
}

function renderExplorerEmpty(message) {
    const grid = document.getElementById('manualQuickstartGrid');
    if (!grid) return;
    grid.replaceChildren();
    const note = document.createElement('p');
    note.textContent = message;
    grid.appendChild(note);
}

function studioGalleryRowsReady(mode) {
    if (mode === 'explorer') return !!(explorerGalleryItems && explorerGalleryItems.length);
    return !!(quickstartGalleryItems && quickstartGalleryItems.length);
}

function renderStudioGalleryLoading(label) {
    const gallery = document.getElementById('manualQuickstartGallery');
    const grid = document.getElementById('manualQuickstartGrid');
    if (!grid) return;
    if (gallery) gallery.classList.remove('is-revealing');
    grid.replaceChildren();
    const note = document.createElement('p');
    const icon = document.createElement('i');
    icon.className = 'fas fa-spinner-third fa-spin fa-2x';
    icon.setAttribute('aria-hidden', 'true');
    note.appendChild(icon);
    note.appendChild(document.createTextNode(' ' + label));
    grid.appendChild(note);
}

async function loadExplorerPostIntoStudio(id) {
    if (!id || quickstartApplyInFlight) return;
    quickstartApplyInFlight = true;
    // showManualPreviewNavigationLoading: public/scripts/comp/manualModalManager.js
    showManualPreviewNavigationLoading(true, 'Opening in Studio');
    try {
        const match = resolveDsap('dsap://explore.novelai.net/');
        // wsClient.sendMessage: public/scripts/websocket.js
        const postPromise = wsClient.sendMessage('get_novelai_explore_post', { id }, false);
        // ensureDsapEntryReady: public/scripts/comp/dsapRegistry.js
        const readyPromise = ensureDsapEntryReady(match ? match.entry : null);
        const [post, ready] = await Promise.all([postPromise, readyPromise]);
        if (!ready || !post) {
            showGlassToast('error', 'Explorer', 'Could not open this post in Studio', false, 4000);
            return;
        }
        // exploreOpenInEditor: public/scripts/comp/exploreDsapApplet.js
        await exploreOpenInEditor(post);
    } catch (error) {
        console.warn('Explorer prompt load failed', error);
        showGlassToast('error', 'Explorer', 'Could not open this post in Studio', false, 4000);
    } finally {
        showManualPreviewNavigationLoading(false);
        quickstartApplyInFlight = false;
    }
}

function appendExplorerSectionLabel(grid, text) {
    const note = document.createElement('p');
    note.dataset.explorerSection = '1';
    note.textContent = text;
    grid.appendChild(note);
}

function renderExplorerCards(rows) {
    const grid = document.getElementById('manualQuickstartGrid');
    if (!grid) return;
    grid.replaceChildren();
    const groups = [];
    let current = null;
    rows.forEach((row) => {
        const period = row.period === 'month' ? 'month' : (row.period === 'week' ? 'week' : '');
        if (!current || current.period !== period) {
            current = { period, rows: [] };
            groups.push(current);
        }
        current.rows.push(row);
    });
    const labels = { month: 'Top for Month' };
    const showLabels = groups.some((group) => group.period);
    let index = 0;
    groups.forEach((group) => {
        if (showLabels && labels[group.period]) appendExplorerSectionLabel(grid, labels[group.period]);
        group.rows.forEach((row) => {
        const card = document.createElement('div');
        card.className = 'manual-quickstart-card';
        card.dataset.exploreId = row.id || '';
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', row.title ? `Load ${row.title} into Studio` : 'Load into Studio');

        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.loading = index < 6 ? 'eager' : 'lazy';
        index += 1;
        img.src = row.thumbnailUrl || '';
        card.appendChild(img);

        const launch = document.createElement('button');
        launch.type = 'button';
        launch.className = 'btn-secondary round-button';
        launch.title = 'Open in Agora';
        launch.setAttribute('aria-label', 'Open in Agora');
        const icon = document.createElement('i');
        icon.className = 'mdi mdi-1-25 mdi-launch';
        launch.appendChild(icon);
        launch.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const postId = row.id || '';
            if (!postId) return;
            // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
            void openDsapInGrimoire(`dsap://explore.novelai.net/image/${encodeURIComponent(postId)}`);
        });
        card.appendChild(launch);

        const openInStudio = () => {
            void loadExplorerPostIntoStudio(row.id || '');
        };
        card.addEventListener('click', (ev) => {
            if (ev.target.closest('button')) return;
            openInStudio();
        });
        card.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            if (ev.target !== card) return;
            ev.preventDefault();
            openInStudio();
        });
        grid.appendChild(card);
        });
    });
}

// image-cache-v1 / dynamic-cache-v1: public/sw.js
const STUDIO_GALLERY_IMAGE_CACHE = 'image-cache-v1';
const STUDIO_GALLERY_DYNAMIC_CACHE = 'dynamic-cache-v1';

async function studioGalleryImageCached(url) {
    if (!url) return false;
    try {
        const imageCache = await caches.open(STUDIO_GALLERY_IMAGE_CACHE);
        if (await imageCache.match(url, { ignoreSearch: true })) return true;
        const dynamicCache = await caches.open(STUDIO_GALLERY_DYNAMIC_CACHE);
        return !!(await dynamicCache.match(url, { ignoreSearch: true }));
    } catch (_err) {
        return false;
    }
}

function promoteDeferredQuickstartImages() {
    document.querySelectorAll('#manualQuickstartGrid img[data-full]').forEach((img) => {
        const full = img.dataset.full;
        if (!full || img.getAttribute('src') === full) {
            img.dataset.full = '';
            return;
        }
        img.dataset.full = '';
        img.src = full;
    });
}

function warmVisibleStudioGalleryImages() {
    const imgs = [...document.querySelectorAll('#manualQuickstartGrid .manual-quickstart-card img')].slice(0, 6);
    return Promise.all(imgs.map((img) => {
        if (!img.getAttribute('src') || (img.complete && img.naturalWidth)) return Promise.resolve();
        // img.decode: HTMLImageElement
        const decode = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
        return Promise.race([
            decode,
            new Promise((resolve) => setTimeout(resolve, 120))
        ]);
    }));
}

async function renderManualQuickstartCards(rows) {
    const grid = document.getElementById('manualQuickstartGrid');
    if (!grid) return;
    const cached = await Promise.all(rows.map((row) => studioGalleryImageCached(row.src)));
    grid.replaceChildren();
    rows.forEach((row, index) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'manual-quickstart-card';
        card.dataset.quickstartFile = row.file;
        const label = row.prompt ? row.prompt.slice(0, 140) : 'Load quickstart prompt';
        card.setAttribute('aria-label', label);

        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.loading = index < 6 ? 'eager' : 'lazy';
        img.referrerPolicy = 'no-referrer';
        if (cached[index]) {
            img.src = row.src;
        } else {
            img.dataset.full = row.src;
            img.addEventListener('error', () => {
                if (!img.dataset.full || img.getAttribute('src') === row.src) return;
                img.dataset.full = '';
                img.src = row.src;
            });
            img.src = row.tiny;
        }

        card.appendChild(img);
        card.addEventListener('click', () => {
            void applyQuickstartRequestBody(row);
        });
        grid.appendChild(card);
    });
}

async function refreshManualQuickstartGallery() {
    const seq = ++studioGalleryRefreshSeq;
    const placeholder = document.getElementById('manualPreviewPlaceholder');
    const gallery = document.getElementById('manualQuickstartGallery');
    const fallback = document.getElementById('manualQuickstartFallback');
    if (!placeholder || !gallery || !fallback) return;

    const showGallery = shouldShowManualQuickstartGallery();
    const hideGalleryBtn = document.getElementById('manualQuickstartHideBtn');
    if (!showGallery) {
        gallery.classList.add('hidden');
        clearStudioGalleryReveal(gallery);
        if (hideGalleryBtn) hideGalleryBtn.classList.add('hidden');
        fallback.classList.remove('hidden');
        placeholder.classList.remove('has-quickstart');
        return;
    }

    syncStudioGalleryModeToggle();

    let rows = [];
    let explorerNote = '';
    const loadingLabel = studioGalleryMode === 'explorer' ? 'Loading Explorer' : 'Loading Quick Start';
    if (!studioGalleryRowsReady(studioGalleryMode)) renderStudioGalleryLoading(loadingLabel);
    try {
        if (studioGalleryMode === 'explorer') {
            rows = await loadExplorerFeed();
            if (!rows.length) explorerNote = 'Explorer is still collecting the latest posts.';
        } else {
            rows = await loadQuickstartPresets();
        }
    } catch (error) {
        console.warn('Studio gallery list failed', error);
        rows = [];
        if (studioGalleryMode === 'explorer') explorerNote = 'Explorer could not load the latest posts.';
    }

    if (seq !== studioGalleryRefreshSeq) return;

    if (!shouldShowManualQuickstartGallery()) {
        gallery.classList.add('hidden');
        clearStudioGalleryReveal(gallery);
        if (hideGalleryBtn) hideGalleryBtn.classList.add('hidden');
        fallback.classList.remove('hidden');
        placeholder.classList.remove('has-quickstart');
        return;
    }

    if (!rows.length && studioGalleryMode !== 'explorer') {
        gallery.classList.add('hidden');
        clearStudioGalleryReveal(gallery);
        if (hideGalleryBtn) hideGalleryBtn.classList.add('hidden');
        fallback.classList.remove('hidden');
        placeholder.classList.remove('has-quickstart');
        return;
    }

    const wasHidden = gallery.classList.contains('hidden');
    const reveal = wasHidden || studioGalleryRevealPending;
    if (reveal) holdStudioGalleryReveal(gallery, wasHidden);
    if (studioGalleryMode === 'explorer' && !rows.length) {
        renderExplorerEmpty(explorerNote || 'Explorer is still collecting the latest posts.');
    } else if (studioGalleryMode === 'explorer') {
        renderExplorerCards(rows);
    } else {
        await renderManualQuickstartCards(rows);
    }
    if (seq !== studioGalleryRefreshSeq) return;
    if (reveal) {
        resetStudioGalleryScroll(gallery);
        await warmVisibleStudioGalleryImages();
        if (seq !== studioGalleryRefreshSeq) return;
    }
    gallery.classList.remove('hidden');
    if (hideGalleryBtn) hideGalleryBtn.classList.remove('hidden');
    fallback.classList.add('hidden');
    placeholder.classList.add('has-quickstart');
    if (reveal) {
        playStudioGalleryReveal(gallery, wasHidden);
        if (gallery.classList.contains('is-revealing')) {
            const onListSettled = (event) => {
                if (event.animationName !== 'manual-quickstart-list-slide') return;
                gallery.removeEventListener('animationend', onListSettled);
                promoteDeferredQuickstartImages();
            };
            gallery.addEventListener('animationend', onListSettled);
        } else {
            promoteDeferredQuickstartImages();
        }
        studioGalleryRevealPending = false;
    } else {
        promoteDeferredQuickstartImages();
    }
    wireStudioGalleryModebarStuck();
    syncStudioGalleryModebarStuck();
}

function invalidateManualQuickstartGallery() {
    quickstartGalleryItems = null;
}

const STUDIO_LAST_PREVIEW_LS = 'studioLastPreviewFilename';

function rememberLastStudioPreview(filename) {
    if (!filename || !imageGenerationSettingsState.persistHistory) return;
    try {
        localStorage.setItem(STUDIO_LAST_PREVIEW_LS, String(filename));
    } catch (_err) { /* */ }
}

function readLastStudioPreviewFilename() {
    try {
        return localStorage.getItem(STUDIO_LAST_PREVIEW_LS) || '';
    } catch (_err) {
        return '';
    }
}

function forgetLastStudioPreview() {
    try {
        localStorage.removeItem(STUDIO_LAST_PREVIEW_LS);
    } catch (_err) { /* */ }
}

function isStudioStreamEnabled() {
    return imageGenerationSettingsState.streamImageGeneration !== false;
}

function isStudioStreamUnprocessed() {
    return imageGenerationSettingsState.showStreamedImagesUnprocessed === true
        || imageGenerationSettingsState.reducedMotion === true;
}

function isStudioViewerCameraLocked() {
    return imageGenerationSettingsState.lockOutputViewerCamera === true;
}

function isStudioReducedPreview() {
    return imageGenerationSettingsState.reducedMotion === true;
}

function studioPreviewDownloadName(filename, format) {
    const base = String(filename || `generated-image-${Date.now()}`).replace(/\.(png|webp|jpe?g)$/i, '');
    return `${base}.${format === 'webp' ? 'webp' : 'png'}`;
}

function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch (_err) { /* */ }
    }, 1000);
}

function premultiplyImageData(imageData) {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255;
        d[i] = Math.round(d[i] * a);
        d[i + 1] = Math.round(d[i + 1] * a);
        d[i + 2] = Math.round(d[i + 2] * a);
    }
    return imageData;
}

async function convertStudioDownloadBlob(blob, settings) {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { alpha: true });
    ctx.drawImage(bitmap, 0, 0);
    if (settings.alphaMode === 'premultiplied') {
        ctx.putImageData(premultiplyImageData(ctx.getImageData(0, 0, canvas.width, canvas.height)), 0, 0);
    }
    const mime = settings.imageFormat === 'webp' ? 'image/webp' : 'image/png';
    const quality = settings.imageFormat === 'webp' ? 1 : undefined;
    const out = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
    return out || blob;
}

async function downloadStudioPreviewWithPrefs(imageLike) {
    const settings = imageGenerationSettingsState;
    const previewImage = document.getElementById('manualPreviewImage');
    let filename = '';
    let url = '';
    if (imageLike && typeof imageLike === 'object') {
        filename = imageLike.filename || imageLike.upscaled || imageLike.original || '';
        url = imageLike.url || '';
    } else if (typeof imageLike === 'string') {
        filename = imageLike;
    }
    if (!url && previewImage && previewImage.dataset.blobUrl) {
        url = previewImage.dataset.blobUrl;
        if (!filename) filename = studioPreviewDownloadName('generated-image', settings.imageFormat);
    }
    if (!url && filename) {
        // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        url = `${localGalleryImageUrl(filename)}?download=true`;
    }
    if (!url) return false;
    const response = await fetch(url);
    if (!response.ok) return false;
    let blob = await response.blob();
    const needsConvert = settings.imageFormat === 'webp' || settings.alphaMode === 'premultiplied';
    if (needsConvert) {
        blob = await convertStudioDownloadBlob(blob, settings);
    }
    triggerBlobDownload(blob, studioPreviewDownloadName(filename || 'generated-image', settings.imageFormat));
    return true;
}

async function maybeAutoDownloadStudioPreview(imageLike) {
    if (!imageGenerationSettingsState.automaticDownload) return;
    try {
        await downloadStudioPreviewWithPrefs(imageLike);
    } catch (error) {
        console.warn('Automatic Studio download failed', error);
    }
}

async function maybeRestoreLastStudioPreview() {
    if (studioPreviewRestoreInFlight) return false;
    if (!imageGenerationSettingsState.persistHistory) return false;
    if (isManualPreviewImageLoaded()) return false;
    const filename = readLastStudioPreviewFilename();
    if (!filename) return false;
    const images = allImages || [];
    const image = images.find((img) =>
        img.filename === filename || img.original === filename || img.upscaled === filename
    ) || { filename, original: filename };
    studioPreviewRestoreInFlight = true;
    try {
        // openManualModalWithContent: public/scripts/comp/manualModalManager.js
        await openManualModalWithContent({ type: 'image', image });
        return true;
    } finally {
        studioPreviewRestoreInFlight = false;
    }
}

const IMAGE_GENERATION_BOOLEAN_MENU_ITEMS = [
    { key: 'streamImageGeneration', text: 'Stream Image Generation', icon: 'fa-regular fa-wave-pulse' },
    { key: 'showStreamedImagesUnprocessed', text: 'Show Streamed Images Unprocessed', icon: 'fa-regular fa-layer-group' },
    { key: 'simpleOutputViewer', text: 'Simple Output Viewer', icon: 'fa-regular fa-image' },
    { key: 'lockOutputViewerCamera', text: 'Lock Output Viewer Camera', icon: 'fa-regular fa-lock' },
    { key: 'reducedMotion', text: 'Reduced Preview Animation', icon: 'fa-regular fa-ban' },
    { key: 'hideQuickstartGallery', text: 'Hide Quickstart Gallery', icon: 'fa-regular fa-images' },
    { key: 'persistHistory', text: 'Persist Image Generation History', icon: 'fa-regular fa-clock-rotate-left' }
];

const IMAGE_GENERATION_TRANSPARENCY_SWATCHES = [
    { value: 'checker-dark', tooltip: 'Dark checker', swatchColor: '#1c1c1c', className: 'imggen-transparency-checker-dark' },
    { value: 'checker-light', tooltip: 'Light checker', swatchColor: '#c8c8c8', className: 'imggen-transparency-checker-light' },
    { value: 'white', tooltip: 'White', swatchColor: '#ffffff' },
    { value: 'gray', tooltip: 'Gray', swatchColor: '#808080' },
    { value: 'black', tooltip: 'Black', swatchColor: '#111111' },
    { value: 'red', tooltip: 'Red', swatchColor: '#c62828' },
    { value: 'green', tooltip: 'Green', swatchColor: '#2e7d32' },
    { value: 'blue', tooltip: 'Blue', swatchColor: '#1565c0' },
    { value: 'custom', tooltip: 'Custom color', swatchColor: null }
];

function buildImageGenerationBooleanMenuItem(spec) {
    return {
        icon: spec.icon,
        text: spec.text,
        action: 'imggen-toggle',
        key: spec.key,
        keepMenuOpen: true,
        showIndicator: true,
        loadfn: function (item) {
            item.checked = getImageGenerationSettings()[spec.key] === true;
        }
    };
}

function getImageGenerationTransparencySubmenu() {
    return [{
        type: 'grid',
        items: IMAGE_GENERATION_TRANSPARENCY_SWATCHES.map((spec) => ({
            action: 'imggen-transparency',
            value: spec.value,
            swatchColor: spec.value === 'custom'
                ? imageGenerationSettingsState.transparencyCustomColor
                : spec.swatchColor,
            className: spec.className,
            tooltip: spec.tooltip,
            keepMenuOpen: true,
            showIndicator: true,
            loadfn: function (item) {
                const s = getImageGenerationSettings();
                item.checked = s.transparencyBackground === spec.value;
                if (spec.value === 'custom') item.swatchColor = s.transparencyCustomColor;
            }
        }))
    }];
}

function getImageGenerationFormatMenuItems() {
    return [
        { text: 'PNG', value: 'png' },
        { text: 'WebP', value: 'webp' }
    ].map((spec) => ({
        icon: 'fa-regular fa-file-image',
        text: spec.text,
        action: 'imggen-format',
        value: spec.value,
        keepMenuOpen: true,
        showIndicator: true,
        loadfn: function (item) {
            item.checked = getImageGenerationSettings().imageFormat === spec.value;
        }
    }));
}

function getImageGenerationAlphaMenuItems() {
    return [
        { text: 'Straight', value: 'straight' },
        { text: 'Premultiplied', value: 'premultiplied' }
    ].map((spec) => ({
        text: spec.text,
        action: 'imggen-alpha',
        value: spec.value,
        keepMenuOpen: true,
        showIndicator: true,
        loadfn: function (item) {
            item.checked = getImageGenerationSettings().alphaMode === spec.value;
        }
    }));
}

function getImageGenerationAutomaticDownloadMenuItem() {
    return {
        icon: 'fa-regular fa-download',
        text: 'Automatic Download',
        action: 'imggen-toggle',
        key: 'automaticDownload',
        keepMenuOpen: true,
        showIndicator: true,
        loadfn: function (item) {
            item.checked = getImageGenerationSettings().automaticDownload === true;
        }
    };
}

const ENHANCE_PRESET_STORAGE_KEY = 'enhancePreset';
const DEFAULT_ENHANCE_PRESET = { magnitude: 3.0, scale: '1' };
const ENHANCE_PRESET_SCALE_OPTIONS = [
    { value: '1', text: '1×' },
    { value: '1.5', text: '1.5×' },
    { value: '2', text: '2×' }
];

function normalizeEnhancePresetMagnitude(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_ENHANCE_PRESET.magnitude;
    const stepped = Math.round(n * 2) / 2;
    return Math.max(1.0, Math.min(5.5, stepped));
}

function normalizeEnhancePresetScale(raw) {
    const value = String(raw == null ? '' : raw);
    for (let i = 0; i < ENHANCE_PRESET_SCALE_OPTIONS.length; i++) {
        if (ENHANCE_PRESET_SCALE_OPTIONS[i].value === value) return value;
    }
    return DEFAULT_ENHANCE_PRESET.scale;
}

function normalizeEnhancePreset(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
        magnitude: normalizeEnhancePresetMagnitude(src.magnitude),
        scale: normalizeEnhancePresetScale(src.scale)
    };
}

function getEnhancePreset() {
    try {
        const raw = localStorage.getItem(ENHANCE_PRESET_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_ENHANCE_PRESET };
        return normalizeEnhancePreset(JSON.parse(raw));
    } catch (_err) {
        return { ...DEFAULT_ENHANCE_PRESET };
    }
}

function persistEnhancePreset(patch) {
    const next = normalizeEnhancePreset({ ...getEnhancePreset(), ...(patch || {}) });
    try {
        localStorage.setItem(ENHANCE_PRESET_STORAGE_KEY, JSON.stringify(next));
    } catch (_err) { /* ignore quota / private mode */ }
    return next;
}

function getEnhancePresetMagnitudeMenuItems() {
    const items = [];
    for (let m = 1.0; m <= 5.5 + 1e-9; m += 0.5) {
        const value = Number(m.toFixed(1));
        items.push({
            text: value.toFixed(1),
            action: 'enhance-preset-magnitude',
            value,
            keepMenuOpen: true,
            showIndicator: true,
            loadfn: function (item) {
                item.checked = Math.abs(getEnhancePreset().magnitude - value) < 1e-9;
            }
        });
    }
    return items;
}

function getEnhancePresetScaleMenuItems() {
    return ENHANCE_PRESET_SCALE_OPTIONS.map((spec) => ({
        text: spec.text,
        action: 'enhance-preset-scale',
        value: spec.value,
        keepMenuOpen: true,
        showIndicator: true,
        loadfn: function (item) {
            item.checked = getEnhancePreset().scale === spec.value;
        }
    }));
}

function getImageGenerationGenerateMenuSections() {
    return [
        {
            type: 'list',
            title: 'Image Format',
            items: getImageGenerationFormatMenuItems()
        },
        {
            type: 'list',
            items: [getImageGenerationAutomaticDownloadMenuItem()]
        }
    ];
}

function studioEditPromptTarget() {
    const active = document.activeElement;
    if (active && active.matches && active.matches('textarea.prompt-textarea, textarea.character-prompt-textarea')) {
        return active;
    }
    return document.getElementById('manualPrompt');
}

function studioNoiseScheduleDisabled() {
    // getForgeModelFeatures: public/scripts/comp/utilities.js
    const caps = getForgeModelFeatures();
    return !!(caps && caps.noiseScheduleUi === false);
}

function studioCurrentModelLabel() {
    const value = String(manualSelectedModel || '').toLowerCase();
    return modelNames[value] || value || 'Model';
}

function studioCurrentSamplerLabel() {
    const sampler = SAMPLER_MAP.find((row) => row.meta === manualSelectedSampler);
    return sampler ? sampler.display : (manualSelectedSampler || 'Sampler');
}

function studioCurrentNoiseLabel() {
    if (studioNoiseScheduleDisabled()) return 'Fixed';
    const noise = NOISE_MAP.find((row) => row.meta === manualSelectedNoiseScheduler);
    return noise ? noise.display : (manualSelectedNoiseScheduler || 'Noise');
}

function studioCurrentResolutionLabel() {
    const res = RESOLUTION_CACHE.get(manualSelectedResolution);
    return res ? res.display : (manualSelectedResolution || 'Resolution');
}

function getStudioModelMenuItems() {
    const current = String(manualSelectedModel || '').toLowerCase();
    const items = [];
    modelGroups.forEach((group) => {
        items.push({ separator: true, text: group.group });
        group.options.forEach((opt) => {
            items.push({
                text: opt.name,
                action: 'studio-select-model',
                value: opt.value,
                groupName: group.group,
                showIndicator: true,
                checked: current === opt.value
            });
        });
    });
    return items;
}

function getStudioSamplerMenuItems() {
    return SAMPLER_MAP.map((sampler) => ({
        text: sampler.display,
        action: 'studio-select-sampler',
        value: sampler.meta,
        showIndicator: true,
        checked: manualSelectedSampler === sampler.meta
    }));
}

function getStudioNoiseMenuItems() {
    return NOISE_MAP.map((noise) => ({
        text: noise.display,
        action: 'studio-select-noise',
        value: noise.meta,
        showIndicator: true,
        checked: manualSelectedNoiseScheduler === noise.meta
    }));
}

function getStudioResolutionMenuItems() {
    const items = [];
    RESOLUTION_GROUPS.forEach((group) => {
        items.push({ separator: true, text: group.group });
        group.options.forEach((opt) => {
            items.push({
                text: opt.name,
                subtext: opt.dims,
                action: 'studio-select-resolution',
                value: opt.value,
                groupName: group.group,
                showIndicator: true,
                checked: manualSelectedResolution === opt.value
            });
        });
    });
    return items;
}

function getStudioPreferencesMenuItems() {
    return [
        ...IMAGE_GENERATION_BOOLEAN_MENU_ITEMS.map(buildImageGenerationBooleanMenuItem),
        { separator: true, text: 'Image Format' },
        ...getImageGenerationFormatMenuItems(),
        getImageGenerationAutomaticDownloadMenuItem(),
        { separator: true, text: 'Enhance Preset' },
        {
            icon: 'fas fa-gauge-high',
            text: 'Magnitude',
            optionsfn: getEnhancePresetMagnitudeMenuItems,
            valueDisplay: function () {
                return getEnhancePreset().magnitude.toFixed(1);
            }
        },
        {
            icon: 'nai-upscale',
            text: 'Upscale',
            optionsfn: getEnhancePresetScaleMenuItems,
            valueDisplay: function () {
                const scale = getEnhancePreset().scale;
                const spec = ENHANCE_PRESET_SCALE_OPTIONS.find((option) => option.value === scale);
                return spec ? spec.text : scale;
            }
        }
    ];
}

function studioDatasetStatusLabel() {
    const furry = selectedDatasets.some((dataset) => dataset === 'fur dataset' || dataset === 'furry dataset');
    return furry ? 'Furry' : 'Anime';
}

function studioNsfwBiasLabel() {
    const names = { 3: 'Nude', 2: 'Skimpy', 1: 'Allow', 0: 'Neutral', '-1': 'Remove', '-2': 'Clense' };
    return names[String(selectedNsfwValue)] || '';
}

function studioVarietyAvailable() {
    const btn = document.getElementById('varietyBtn');
    if (!btn || btn.classList.contains('hidden') || btn.disabled) return false;
    // getForgeModelFeatures / isV5Model: public/scripts/comp/utilities.js
    const caps = getForgeModelFeatures();
    return !(isV5Model() || (caps && caps.varietyPlus === false));
}

function studioToggleVariety() {
    const btn = document.getElementById('varietyBtn');
    if (!studioVarietyAvailable() || !btn) return;
    varietyEnabled = !varietyEnabled;
    btn.setAttribute('data-state', varietyEnabled ? 'on' : 'off');
    // updateAllStagesInheritedValues: public/scripts/comp/pipelineStageManager.js
    updateAllStagesInheritedValues();
}

function studioPaintParamLabel(param, text) {
    document.querySelectorAll('.dataset-bias-value[data-param="' + param + '"]').forEach((el) => {
        el.textContent = text;
    });
}

function studioReadParamLabel(param) {
    if (param === 'steps') {
        const input = document.getElementById('manualSteps');
        const value = input ? parseInt(input.value, 10) : 25;
        return String(Number.isFinite(value) ? value : 25);
    }
    if (param === 'guidance') {
        const input = document.getElementById('manualGuidance');
        const value = input ? parseFloat(input.value) : 5;
        return (Number.isFinite(value) ? value : 5).toFixed(2);
    }
    const input = document.getElementById('manualRescale');
    const value = input ? parseFloat(input.value) : 0;
    return Math.round((Number.isFinite(value) ? value : 0) * 100) + '%';
}

function studioNudgeManualInput(input, deltaY, shiftKey) {
    if (!input) return;
    input.dispatchEvent(new WheelEvent('wheel', {
        deltaY: deltaY,
        shiftKey: !!shiftKey,
        bubbles: true,
        cancelable: true
    }));
}

const STUDIO_MEDIUM_LOCKED_TIP = 'Locked while Medium effort is on. Switch Effort to High to change it.';

// mediumControlIsLocked: public/scripts/comp/utilities.js
function studioMediumLocked(control) {
    return typeof mediumControlIsLocked === 'function' && mediumControlIsLocked(control);
}

function studioEffortMenuDisabled() {
    // Enabled on V5 Full (effort toggle) and on v5_medium (setManualEffort maps it back to Full).
    const caps = typeof getForgeModelFeatures === 'function' ? getForgeModelFeatures() : null;
    return !(caps && ((caps.effort && caps.effort.medium) || caps.fixedSettings));
}

function getStudioEffortMenuItems() {
    const current = typeof activeMediumLock === 'function' && activeMediumLock() ? 'medium' : 'high';
    return [
        { text: 'High', action: 'studio-select-effort', value: 'high', showIndicator: true, checked: current === 'high' },
        { text: 'Medium', action: 'studio-select-effort', value: 'medium', showIndicator: true, checked: current === 'medium' }
    ];
}

function studioParamScrubRow(param, label, iconClass) {
    const inputId = param === 'steps' ? 'manualSteps' : (param === 'guidance' ? 'manualGuidance' : 'manualRescale');
    const locked = () => studioMediumLocked(param);
    return {
        disabled: locked,
        tooltip: () => (locked() ? STUDIO_MEDIUM_LOCKED_TIP : ''),
        content: function () {
            const wrap = document.createElement('div');
            wrap.className = 'dataset-option-content';
            const left = document.createElement('div');
            left.className = 'dataset-option-left';
            const icon = document.createElement('i');
            icon.className = iconClass;
            const name = document.createElement('span');
            name.className = 'dataset-name';
            name.textContent = label;
            left.appendChild(icon);
            left.appendChild(name);
            const controls = document.createElement('div');
            controls.className = 'dataset-bias-controls';
            const decrease = document.createElement('button');
            decrease.type = 'button';
            decrease.className = 'dataset-bias-decrease';
            decrease.dataset.biasStep = '-1';
            decrease.innerHTML = '<i class="fas fa-minus"></i>';
            const value = document.createElement('span');
            value.className = 'dataset-bias-value';
            value.dataset.param = param;
            value.textContent = studioReadParamLabel(param);
            const increase = document.createElement('button');
            increase.type = 'button';
            increase.className = 'dataset-bias-increase';
            increase.dataset.biasStep = '1';
            increase.innerHTML = '<i class="fas fa-plus"></i>';
            controls.appendChild(decrease);
            controls.appendChild(value);
            controls.appendChild(increase);
            wrap.appendChild(left);
            wrap.appendChild(controls);
            const paint = () => studioPaintParamLabel(param, studioReadParamLabel(param));
            controls.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (locked()) return;
                const stepEl = e.target.closest('[data-bias-step]');
                if (!stepEl) return;
                const dir = Number(stepEl.dataset.biasStep);
                studioNudgeManualInput(document.getElementById(inputId), dir < 0 ? 1 : -1, e.shiftKey);
                paint();
            });
            controls.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            // bindStudioRowWheel: public/scripts/comp/manualDropdownManager.js
            bindStudioRowWheel(wrap, (e) => {
                if (locked()) return;
                studioNudgeManualInput(document.getElementById(inputId), e.deltaY, e.shiftKey);
                paint();
            });
            return wrap;
        }
    };
}

function studioPaintCompareParentIndicator() {
    const parent = contextMenu.currentSubmenuState && contextMenu.currentSubmenuState.parentItem;
    if (!parent) return;
    const text = parent.querySelector('.context-menu-item-text');
    if (!text || text.textContent !== 'Comparison') return;
    const btn = document.getElementById('manualPreviewUseAsSourceBtn');
    const state = btn ? (btn.getAttribute('data-state') || 'off') : 'off';
    const dot = parent.querySelector('.context-menu-item-indicator');
    if (!dot) return;
    const on = state !== 'off';
    dot.classList.toggle('checked', on);
    if (on) dot.setAttribute('data-state', state);
    else dot.removeAttribute('data-state');
}

function getStudioCompareMenuItems() {
    // getCompareContextMenuConfig: public/scripts/comp/compareViewManager.js
    const config = getCompareContextMenuConfig();
    const items = [];
    (config.sections || []).forEach((section) => {
        if (typeof section.hidden === 'function' && section.hidden()) return;
        if (section.type === 'custom' && section.content) {
            items.push({ content: section.content, keepMenuOpen: true });
            return;
        }
        if (section.title) items.push({ separator: true, text: section.title });
        (section.items || []).forEach((item) => items.push(item));
    });
    return items;
}

function studioNormalizePreviewItem(item) {
    if (!item || item.separator) return item;
    const copy = Object.assign({}, item);
    copy.icon = studioNormalizeMenuIcon(copy.icon);
    if (Array.isArray(item.submenu)) copy.submenu = item.submenu.map(studioNormalizePreviewItem);
    return copy;
}

function studioNormalizeMenuIcon(icon) {
    if (typeof icon !== 'string') return icon;
    return icon.replace(/\bmdi-1-\d+\b/g, '').replace(/\s+/g, ' ').trim();
}

function studioPreviewMenuIndex() {
    // createManualPreviewImageContextMenuConfig: public/scripts/comp/manualModalManager.js
    const config = createManualPreviewImageContextMenuConfig();
    const byAction = {};
    const visit = (item) => {
        if (!item || item.separator) return;
        if (item.action && !byAction[item.action]) byAction[item.action] = item;
        (item.icons || []).forEach(visit);
        (item.items || []).forEach(visit);
        if (Array.isArray(item.submenu)) item.submenu.forEach(visit);
    };
    (config.sections || []).forEach(visit);
    return byAction;
}

function studioPreviewListItem(action, text) {
    const source = studioPreviewMenuIndex()[action];
    if (!source) return null;
    return {
        icon: studioNormalizeMenuIcon(source.icon),
        text: text || source.text || source.tooltip,
        action: source.action,
        disabled: source.disabled,
        loadfn: source.loadfn,
        hidden: source.hidden
    };
}

const STUDIO_IMAGE_MENU_SKIP = {
    copy: true,
    download: true,
    'view-image-data': true,
    'scrap-preview': true,
    'delete-preview': true,
    'copy-lookback': true,
    'open-in-window': true
};

function getStudioImageMenuItems() {
    // createManualPreviewImageContextMenuConfig: public/scripts/comp/manualModalManager.js
    const config = createManualPreviewImageContextMenuConfig();
    const items = [];
    const pushBatch = (batch) => {
        const visible = [];
        batch.forEach((item) => {
            if (!item) return;
            if (item.separator) {
                if (!visible.length || visible[visible.length - 1].separator) return;
                visible.push(item);
                return;
            }
            visible.push(item);
        });
        while (visible.length && visible[visible.length - 1].separator) visible.pop();
        if (!visible.length) return;
        if (items.length && !items[items.length - 1].separator) items.push({ separator: true });
        visible.forEach((item) => items.push(item));
    };
    (config.sections || []).forEach((section) => {
        const batch = [];
        if (section.type === 'icons' && Array.isArray(section.icons)) {
            section.icons.forEach((icon) => {
                if (!icon || icon.separator || STUDIO_IMAGE_MENU_SKIP[icon.action]) return;
                batch.push({
                    icon: studioNormalizeMenuIcon(icon.icon),
                    text: icon.tooltip,
                    action: icon.action,
                    loadfn: icon.loadfn,
                    disabled: icon.disabled
                });
            });
            pushBatch(batch);
            return;
        }
        if (section.title) batch.push({ separator: true, text: section.title });
        (section.items || []).forEach((item) => {
            if (item.separator) {
                batch.push(item);
                return;
            }
            if (STUDIO_IMAGE_MENU_SKIP[item.action]) return;
            if (item.text === 'Transparent Background') return;
            batch.push(studioNormalizePreviewItem(item));
        });
        pushBatch(batch);
    });
    return items;
}

function getStudioAddComponentMenuItems() {
    const items = [
        { separator: true, text: 'Component' },
        { icon: 'fas fa-user', text: 'Character', action: 'studio-add-character' },
        { icon: 'fas fa-text', text: 'Text Overlay', action: 'studio-add-text-overlay' },
        { separator: true, text: 'Reference' },
        { icon: 'nai-img2img', text: 'Base Image', action: 'studio-add-transform', value: 'base-image' },
        { icon: 'nai-vibe-transfer', text: 'Vibe Transfer', action: 'studio-add-transform', value: 'vibe-transfer' },
        { icon: 'nai-precise-reference-style-and-character', text: 'Character / Style', action: 'studio-add-transform', value: 'character-reference' }
    ];
    const hasValidImage = window.currentEditImage && window.currentEditMetadata;
    const hasBaseImage = hasValidImage && (
        window.currentEditMetadata.original_filename ||
        (window.currentEditImage.filename || window.currentEditImage.original)
    );
    const isImg2Img = hasValidImage && window.currentEditMetadata.base_image === true;
    if (hasValidImage && isImg2Img) {
        items.push({ icon: 'fas fa-history', text: 'Previous Image', action: 'studio-add-transform', value: 'reroll' });
    }
    if (hasBaseImage) {
        items.push({ icon: 'fa-regular fa-image', text: 'Current Image', action: 'studio-add-transform', value: 'variation' });
    }
    items.push({ icon: 'nai-import', text: 'Upload', action: 'studio-add-transform', value: 'upload' });
    items.push({ separator: true, text: 'Pipeline Stage' });
    items.push({
        icon: 'mdi mdi-relative-scale',
        text: 'Expand Canvas',
        action: 'studio-add-stage',
        stageType: STAGE_TYPES.EXPAND_CANVAS
    });
    if (getForgeModelFeatures()?.maxEnhance) {
        items.push({
            icon: 'fas fa-wand-magic-sparkles',
            text: 'Max Enhance',
            action: 'studio-add-stage',
            stageType: STAGE_TYPES.VARIATION,
            useBaseImage: true,
            maxEnhance: true
        });
    }
    items.push({
        icon: 'fas fa-diagram-venn',
        text: 'Enhance',
        action: 'studio-add-stage',
        stageType: STAGE_TYPES.VARIATION,
        useBaseImage: true
    });
    items.push({
        icon: 'ri-image-ai-fill',
        text: 'Variation',
        action: 'studio-add-stage',
        stageType: STAGE_TYPES.VARIATION,
        useBaseImage: false
    });
    return items;
}

function getStudioGenerationToggleIcons() {
    return [
        {
            icon: 'fas fa-sparkle',
            tooltip: 'Variation plus',
            action: 'studio-toggle-variety',
            keepMenuOpen: true,
            disabled: function () {
                return !studioVarietyAvailable();
            },
            loadfn: (item) => {
                const btn = document.getElementById('varietyBtn');
                item.checked = !!(btn && btn.getAttribute('data-state') === 'on');
            }
        },
        {
            icon: 'fas fa-seedling',
            tooltip: 'Lock Seed',
            action: 'studio-toggle-seed-lock',
            keepMenuOpen: true,
            disabled: function () {
                return !window.lastLoadedSeed;
            },
            loadfn: (item) => {
                const btn = document.getElementById('sproutSeedBtn');
                item.checked = !!(btn && btn.getAttribute('data-state') === 'on');
            }
        },
        {
            icon: 'nai-upscale',
            tooltip: 'Upscale',
            action: 'studio-toggle-upscale',
            keepMenuOpen: true,
            disabled: function () {
                const btn = document.getElementById('manualUpscale');
                return !btn || btn.disabled;
            },
            loadfn: (item) => {
                const btn = document.getElementById('manualUpscale');
                item.checked = !!(btn && btn.getAttribute('data-state') === 'on');
            }
        },
        {
            icon: 'fas fa-dollar-sign',
            tooltip: 'Allow Paid',
            action: 'studio-toggle-paid',
            keepMenuOpen: true,
            loadfn: (item) => {
                item.checked = !!forcePaidRequest;
            }
        },
        {
            icon: 'nai-dot-reset',
            tooltip: 'Reset to Free Limits',
            action: 'studio-free-limits'
        },
        {
            icon: 'fas fa-bolt',
            tooltip: 'Maximum Quality',
            action: 'studio-maximum-quality'
        }
    ];
}

function getStudioViewMenuItems() {
    const openResult = studioPreviewListItem('open-in-window', 'Open Result in Window');
    return [
        openResult || {
            icon: 'fas fa-external-link-alt',
            text: 'Open Result in Window',
            action: 'open-in-window'
        },
        {
            icon: 'fas fa-layer-group',
            text: 'Stage Results',
            action: 'studio-stage-results',
            disabled: function () {
                // stageResultsReviewManager: public/scripts/comp/stageResultsReview.js
                if (stageResultsReviewManager.previewChainFilename()) return false;
                return !stageResultsReviewManager.hasResults();
            }
        },
        {
            icon: 'fas fa-image-slash',
            text: 'Clear Preview',
            action: 'studio-clear-preview'
        },
        {
            icon: 'fas fa-columns',
            text: 'Show Both Prompt/UC',
            action: 'studio-show-both',
            keepMenuOpen: true,
            showIndicator: true,
            loadfn: (item) => {
                const btn = document.getElementById('showBothBtn');
                item.checked = !!(btn && (btn.dataset.state === 'on' || btn.classList.contains('active')));
            }
        },
        {
            icon: 'fas fa-wand-magic-sparkles',
            text: 'Show SmartText Window',
            action: 'studio-autofill-window'
        },
        {
            icon: 'fas fa-glasses-round',
            text: 'Inspector',
            action: 'showInspector',
            disabled: function () {
                return !window.dynamicGenerationData || !window.dynamicGenerationData.compiled_prompt;
            }
        },
        { separator: true },
        {
            icon: 'fa-regular fa-chess-board',
            text: 'Transparent Background',
            optionsfn: getImageGenerationTransparencySubmenu
        },
        {
            icon: 'fa-regular fa-circle-half-stroke',
            text: 'Alpha Mode',
            optionsfn: getImageGenerationAlphaMenuItems
        }
    ];
}

function getStudioFileMenuItems() {
    return [
        {
            icon: 'fa-regular fa-file',
            text: 'New Session',
            action: 'studio-new-session'
        },
        {
            icon: 'fa-regular fa-folder-open',
            text: 'Open Session',
            optionsfn: function () {
                return [
                    {
                        icon: 'fas fa-images',
                        text: 'Gallery Image',
                        action: 'studio-open-gallery'
                    },
                    {
                        icon: 'fas fa-folder-tree',
                        text: 'VFS File',
                        action: 'studio-open-vfs'
                    },
                    {
                        icon: 'fas fa-book-sparkles',
                        text: 'Preset',
                        action: 'studio-open-preset'
                    }
                ];
            }
        },
        {
            icon: 'fas fa-floppy-disk',
            text: 'Save',
            action: 'studio-save-current',
            disabled: function () {
                // studioSessionPresetName: public/scripts/comp/studioSession.js
                return !studioSessionPresetName();
            }
        },
        {
            icon: 'fa-regular fa-floppy-disk',
            text: 'Save As',
            // getStudioSaveAsMenuItems: public/scripts/comp/studioSession.js
            optionsfn: getStudioSaveAsMenuItems
        },
        {
            icon: 'fas fa-pen',
            text: 'Session Name',
            action: 'studio-rename-preset'
        },
        { separator: true },
        studioPreviewListItem('copy'),
        studioPreviewListItem('download'),
        studioPreviewListItem('view-image-data'),
        studioPreviewListItem('scrap-preview'),
        studioPreviewListItem('delete-preview')
    ].filter(Boolean);
}

function getStudioSmartTextMenuItems() {
    if (!autofillSearchSettingsDraft) beginAutofillSettingsDraft();
    const sections = buildAutofillSettingsMenuSections();
    return (sections[0] && sections[0].items) ? sections[0].items : [];
}

function getStudioEditMenuItems() {
    return [
        {
            icon: 'fas fa-lightbulb',
            text: 'SmartText',
            optionsfn: getStudioSmartTextMenuItems
        },
        {
            icon: 'fas fa-broom-wide',
            text: 'Clear Emphasis Weights',
            action: 'studio-clear-emphasis'
        },
        {
            icon: 'fas fa-font-case',
            text: 'Convert to Lower Case',
            action: 'studio-lowercase'
        },
        {
            icon: 'fas fa-trash-can',
            text: 'Remove Disabled Blocks',
            action: 'studio-remove-disabled',
            disabled: function () {
                // promptCtxHasDisabledBlocks: public/scripts/comp/promptTextareaContextMenu.js
                return !promptCtxHasDisabledBlocks(studioEditPromptTarget());
            }
        },
        {
            icon: 'fas fa-list-ol',
            text: 'Reset Emphasis Group IDs',
            action: 'studio-reindex-groups',
            disabled: function () {
                const textarea = studioEditPromptTarget();
                // countEmphasisGroupsForIdReindex: public/scripts/comp/emphasisGroupIdCodec.js
                return !textarea || countEmphasisGroupsForIdReindex(textarea.value || '') === 0;
            }
        },
        {
            icon: 'fas fa-seedling',
            text: 'Recent Seeds',
            // getRecentSeedMenuItems: public/scripts/comp/manualModalManager.js
            optionsfn: getRecentSeedMenuItems
        },
        {
            icon: 'fas fa-location-crosshairs',
            text: 'Apply Character Positions',
            action: 'studio-apply-character-positions',
            disabled: function () {
                const btn = document.getElementById('characterPositionsToolBtn');
                if (!btn || btn.classList.contains('hidden')) return true;
                // characterPositionToolManager: public/scripts/comp/characterPositionToolManager.js
                return !characterPositionToolManager._hasReturnedCenters();
            }
        },
        {
            icon: 'fas fa-brackets-curly',
            text: 'Copy Change JSON',
            action: 'studio-copy-change-json'
        },
        studioPreviewListItem('copy-lookback') || {
            icon: 'fas fa-link',
            text: 'Copy Lookback',
            action: 'copy-lookback'
        },
        {
            icon: 'fas fa-trash',
            text: 'Remove All Stages',
            action: 'studio-remove-all-stages',
            disabled: function () {
                // studioHasRemovableStages: public/scripts/comp/pipelineStageManager.js
                return !studioHasRemovableStages();
            }
        }
    ];
}

function studioDatasetsMenuDisabled() {
    const el = document.getElementById('datasetDropdown');
    return !el || el.classList.contains('hidden');
}

function getStudioImageGenerationSettingsMenuConfig() {
    return {
        openSubmenusOnHover: true,
        sections: [
            {
                type: 'list',
                items: [
                    {
                        icon: 'fa-regular fa-folder-open',
                        text: 'File',
                        optionsfn: getStudioFileMenuItems
                    },
                    {
                        icon: 'fas fa-pen-to-square',
                        text: 'Edit',
                        optionsfn: getStudioEditMenuItems
                    },
                    {
                        icon: 'fas fa-eye',
                        text: 'View',
                        optionsfn: getStudioViewMenuItems
                    },
                    {
                        icon: 'fas fa-image',
                        text: 'Image',
                        optionsfn: getStudioImageMenuItems
                    },
                    {
                        icon: 'fas fa-eye-dropper',
                        text: 'Comparison',
                        optionsfn: getStudioCompareMenuItems,
                        showIndicator: true,
                        loadfn: (item) => {
                            const btn = document.getElementById('manualPreviewUseAsSourceBtn');
                            const state = btn ? (btn.getAttribute('data-state') || 'off') : 'off';
                            item.dataState = state;
                            item.checked = state !== 'off';
                        }
                    }
                ]
            },
            {
                type: 'list',
                items: [
                    {
                        icon: 'fas fa-book-font',
                        text: 'Text Expanders',
                        action: 'studio-text-expanders'
                    },
                    {
                        icon: 'fas fa-layer-group',
                        text: 'Phasewalker',
                        action: 'studio-phasewalker'
                    },
                    {
                        icon: 'fas fa-weight-scale',
                        text: 'Weight Rack',
                        action: 'studio-weight-rack'
                    },
                    {
                        icon: 'fas fa-sliders',
                        text: 'vSlider',
                        action: 'studio-vslider'
                    },
                    {
                        icon: 'ri-pencil-ai-2-fill',
                        text: 'Rentan',
                        // getRentanSystemSubmenuItems: public/scripts/comp/dynamicGenerationManager.js
                        optionsfn: getRentanSystemSubmenuItems,
                        disabled: function () {
                            // isDynamicGenerationEnabled: public/scripts/comp/dynamicGenerationLockState.js
                            return !isDynamicGenerationEnabled();
                        }
                    }
                ]
            },
            {
                type: 'list',
                items: [
                    {
                        icon: 'nai-sakura',
                        text: 'Datasets',
                        // getStudioDatasetMenuItems: public/scripts/comp/manualDropdownManager.js
                        optionsfn: getStudioDatasetMenuItems,
                        disabled: studioDatasetsMenuDisabled,
                        valueDisplay: studioDatasetStatusLabel
                    },
                    {
                        icon: 'fas fa-diamond-half-stroke',
                        text: 'Adjustments',
                        // getStudioAdjustmentMenuItems: public/scripts/comp/manualDropdownManager.js
                        optionsfn: getStudioAdjustmentMenuItems
                    },
                    {
                        icon: 'fas fa-ban',
                        text: 'UC Preset',
                        // getStudioUcPresetMenuItems: public/scripts/comp/manualDropdownManager.js
                        optionsfn: getStudioUcPresetMenuItems,
                        disabled: () => studioMediumLocked('uc'),
                        tooltip: () => (studioMediumLocked('uc') ? STUDIO_MEDIUM_LOCKED_TIP : ''),
                        valueDisplay: function () {
                            return UC_PRESET_LEVEL_LABELS[selectedUcPreset] || '';
                        }
                    },
                    {
                        icon: 'fas fa-shield',
                        text: 'NSFW Bias',
                        // getStudioNsfwBiasMenuItems: public/scripts/comp/manualDropdownManager.js
                        optionsfn: getStudioNsfwBiasMenuItems,
                        valueDisplay: studioNsfwBiasLabel
                    },
                    { separator: true },
                    {
                        icon: 'fas fa-grid-round-2-plus',
                        text: 'Add Component',
                        optionsfn: getStudioAddComponentMenuItems
                    },
                    {
                        icon: 'fas fa-cube',
                        text: 'Model',
                        optionsfn: getStudioModelMenuItems,
                        valueDisplay: studioCurrentModelLabel
                    },
                    {
                        icon: 'fas fa-gauge-high',
                        text: 'Effort',
                        optionsfn: getStudioEffortMenuItems,
                        valueDisplay: () => (studioEffortMenuDisabled() ? '' : (typeof activeMediumLock === 'function' && activeMediumLock() ? 'Medium' : 'High')),
                        disabled: studioEffortMenuDisabled,
                        tooltip: () => (studioEffortMenuDisabled() ? 'Effort is only available on V5 Full.' : '')
                    },
                    studioParamScrubRow('steps', 'Steps', 'fas fa-shoe-prints'),
                    studioParamScrubRow('guidance', 'Guidance', 'fas fa-compass'),
                    studioParamScrubRow('rescale', 'Rescale', 'fas fa-arrows-left-right'),
                    {
                        icon: 'fas fa-shuffle',
                        text: 'Sampler',
                        optionsfn: getStudioSamplerMenuItems,
                        valueDisplay: studioCurrentSamplerLabel,
                        disabled: () => studioMediumLocked('sampler'),
                        tooltip: () => (studioMediumLocked('sampler') ? STUDIO_MEDIUM_LOCKED_TIP : '')
                    },
                    {
                        icon: 'fas fa-wave-square',
                        text: 'Noise Schedule',
                        optionsfn: getStudioNoiseMenuItems,
                        valueDisplay: studioCurrentNoiseLabel,
                        disabled: studioNoiseScheduleDisabled
                    },
                    {
                        icon: 'fas fa-expand',
                        text: 'Resolution',
                        optionsfn: getStudioResolutionMenuItems,
                        valueDisplay: studioCurrentResolutionLabel
                    },
                    {
                        icon: 'nai-sparkles',
                        text: 'Generate Stage',
                        // getGenerateStageMenuItems: public/scripts/comp/manualModalManager.js
                        optionsfn: getGenerateStageMenuItems,
                        hidden: function () {
                            const stages = getPipelineStages();
                            return !stages || stages.length === 0;
                        }
                    },
                    {
                        icon: 'fas fa-paragraph',
                        text: 'Syntax Options',
                        // getDatasetPromptSyntaxMenuItems: public/scripts/comp/manualDropdownManager.js
                        optionsfn: getDatasetPromptSyntaxMenuItems
                    }
                ]
            },
            {
                type: 'icons',
                icons: getStudioGenerationToggleIcons()
            },
            {
                type: 'list',
                items: [
                    {
                        icon: 'fas fa-wrench',
                        text: 'Preferences',
                        optionsfn: getStudioPreferencesMenuItems
                    },
                    {
                        icon: 'fas fa-circle-info',
                        text: 'About',
                        action: 'studio-about'
                    }
                ]
            }
        ],
        onAction: handleImageGenerationSettingsMenuAction,
        onHide: function () {
            // flushAutofillSettingsDraftIfDirty: public/scripts/comp/autofillSettings.js
            void flushAutofillSettingsDraftIfDirty();
        }
    };
}

function openStudioTransparencyCustomColorPicker() {
    const input = document.getElementById('studioTransparencyCustomColor');
    if (!input) return;
    input.value = imageGenerationSettingsState.transparencyCustomColor;
    if (input.showPicker) {
        try {
            input.showPicker();
            return;
        } catch (_err) { /* native picker unavailable */ }
    }
    input.click();
}

let studioMenuActionDepth = 0;

function studioIsPreviewMenuAction(action) {
    return action === 'modify-preview'
        || action === 'load-base-image'
        || action === 'toggle-favorite'
        || action === 'copy'
        || action === 'download'
        || action === 'open-in-window'
        || action === 'view-image-data'
        || action === 'expand-canvas'
        || action === 'enhance'
        || action === 'upscale'
        || action === 'start-chat'
        || action === 'copy-lookback'
        || action === 'ask-wren'
        || action === 'set-wallpaper'
        || action === 'create-desktop-shortcut'
        || action === 'scrap-preview'
        || action === 'delete-preview'
        || action === 'copy-original'
        || action === 'download-original'
        || action === 'expand-canvas-original'
        || action === 'delete-original';
}

function handleImageGenerationSettingsMenuAction(action, target, item) {
    if (studioMenuActionDepth > 0) return false;
    const row = item || target;
    // handleDynamicGenerationContextMenuAction: public/scripts/comp/dynamicGenerationManager.js
    if (handleDynamicGenerationContextMenuAction({
        detail: {
            action: action,
            target: document.getElementById('dynamicCarousel') || target,
            item: row
        }
    })) return true;
    if (action && (action.indexOf('compare') === 0 || action.indexOf('setCompare') === 0)) {
        // handleCompareContextMenuAction: public/scripts/comp/compareViewManager.js
        handleCompareContextMenuAction(action, target, row);
        studioPaintCompareParentIndicator();
        return true;
    }
    if (action === 'studio-show-both') {
        // toggleManualShowBoth: public/scripts/comp/manualTabManager.js
        toggleManualShowBoth();
        return true;
    }
    if (action === 'studio-toggle-variety') {
        studioToggleVariety();
        return true;
    }
    if (action === 'studio-toggle-upscale') {
        // toggleManualUpscale: public/scripts/comp/manualFormHelpers.js
        toggleManualUpscale();
        return true;
    }
    if (action === 'studio-toggle-seed-lock') {
        // toggleSproutSeed: public/scripts/comp/seedSproutManager.js
        toggleSproutSeed();
        return true;
    }
    if (action === 'studio-toggle-paid') {
        forcePaidRequest = !forcePaidRequest;
        const next = forcePaidRequest ? 'on' : 'off';
        // paidRequestToggle, windowPaidToggle: public/scripts/comp/manualModalManager.js
        if (paidRequestToggle) paidRequestToggle.setAttribute('data-state', next);
        if (windowPaidToggle) windowPaidToggle.setAttribute('data-state', next);
        return true;
    }
    if (action === 'studio-add-character') {
        // addCharacterPrompt: public/scripts/comp/characterPromptManager.js
        addCharacterPrompt();
        return true;
    }
    if (action === 'studio-add-text-overlay') {
        // addTextOverlay: public/scripts/comp/textOverlayManager.js
        addTextOverlay();
        return true;
    }
    if (action === 'studio-add-transform' && row && row.value) {
        // selectTransformation: public/scripts/comp/manualDropdownManager.js
        selectTransformation(row.value);
        return true;
    }
    if (action === 'studio-add-stage' && row && row.stageType) {
        // addPipelineStage: public/scripts/comp/pipelineStageManager.js
        addPipelineStage(row.stageType, { useBaseImage: !!row.useBaseImage, maxEnhance: row.maxEnhance === true });
        return true;
    }
    if (action === 'studio-new-session') {
        // startStudioNewSession: public/scripts/comp/studioSession.js
        startStudioNewSession();
        return true;
    }
    if (action === 'studio-open-gallery') {
        // studioOpenFolderDialog: public/scripts/comp/studioSession.js
        void studioOpenFolderDialog('open-gallery');
        return true;
    }
    if (action === 'studio-open-vfs') {
        void studioOpenFolderDialog('open-vfs');
        return true;
    }
    if (action === 'studio-open-preset') {
        // openStudioSaveNameDialog: public/scripts/comp/studioSession.js
        openStudioSaveNameDialog('load-preset');
        return true;
    }
    if (action === 'studio-save-current') {
        // studioSaveCurrentPreset: public/scripts/comp/studioSession.js
        void studioSaveCurrentPreset();
        return true;
    }
    if (action === 'studio-rename-preset') {
        openStudioSaveNameDialog('rename');
        return true;
    }
    if (action === 'studio-about') {
        // showStudioAboutSplash: public/scripts/comp/studioSession.js
        showStudioAboutSplash();
        return true;
    }
    if (action && action.startsWith('select-seed-')) {
        // handleSproutSeedContextMenuAction: public/scripts/comp/manualModalManager.js
        handleSproutSeedContextMenuAction(action, target, row);
        return true;
    }
    if (action && action.startsWith('generate-stage-')) {
        const stageIndex = parseInt(action.replace('generate-stage-', ''), 10);
        if (!isNaN(stageIndex)) {
            // handleManualGeneration: public/scripts/comp/manualModalManager.js
            handleManualGeneration(new Event('submit'), { targetStageIndex: stageIndex });
        }
        return true;
    }
    if (action === 'studio-select-model' && row && row.value) {
        // selectManualModel: public/scripts/comp/manualDropdownManager.js
        selectManualModel(row.value, row.groupName);
        return true;
    }
    if (action === 'studio-select-sampler' && row && row.value) {
        // selectManualSampler: public/scripts/comp/manualDropdownManager.js
        selectManualSampler(row.value);
        return true;
    }
    if (action === 'studio-select-effort' && row && row.value) {
        // setManualEffort: public/scripts/comp/manualModalManager.js
        setManualEffort(row.value);
        return true;
    }
    if (action === 'studio-select-noise' && row && row.value) {
        // selectManualNoiseScheduler: public/scripts/comp/manualDropdownManager.js
        selectManualNoiseScheduler(row.value);
        return true;
    }
    if (action === 'studio-select-resolution' && row && row.value) {
        // selectManualResolution: public/scripts/comp/manualDropdownManager.js
        selectManualResolution(row.value, row.groupName);
        return true;
    }
    if (action === 'studio-clear-emphasis') {
        const textarea = studioEditPromptTarget();
        if (textarea && removeAllEmphasisFromSelection) {
            removeAllEmphasisFromSelection(textarea);
            if (updateEmphasisHighlighting) updateEmphasisHighlighting(textarea);
        }
        return true;
    }
    if (action === 'studio-lowercase') {
        const textarea = studioEditPromptTarget();
        // promptTextareaToolbar.lowercasePromptText: public/scripts/comp/promptTextareaToolbar.js
        if (textarea && promptTextareaToolbar) promptTextareaToolbar.lowercasePromptText(textarea);
        return true;
    }
    if (action === 'studio-remove-disabled') {
        // promptCtxDeleteAllDisabledBlocks: public/scripts/comp/promptTextareaContextMenu.js
        promptCtxDeleteAllDisabledBlocks(studioEditPromptTarget());
        return true;
    }
    if (action === 'studio-reindex-groups') {
        const textarea = studioEditPromptTarget();
        if (textarea && promptTextareaToolbar) {
            promptTextareaToolbar.reindexEmphasisGroupIds(textarea, promptTextareaToolbar.getToolbarFromTextarea(textarea));
        }
        return true;
    }
    if (action === 'studio-apply-character-positions') {
        characterPositionToolManager._applyReturnedCenters();
        return true;
    }
    if (action === 'studio-copy-change-json') {
        // openStudioChangeExportDialog: public/scripts/comp/studioChangeJson.js
        openStudioChangeExportDialog();
        return true;
    }
    if (action === 'studio-remove-all-stages') {
        // studioRemoveAllStages: public/scripts/comp/pipelineStageManager.js
        studioRemoveAllStages();
        return true;
    }
    if (action === 'studio-clear-preview') {
        // resetManualPreview: public/scripts/comp/manualPreviewManager.js
        resetManualPreview();
        return true;
    }
    if (action === 'studio-maximum-quality') {
        // applyStudioMaximumQuality: public/scripts/comp/keyboardShortcuts.js
        applyStudioMaximumQuality();
        return true;
    }
    if (action === 'studio-free-limits') {
        // applyStudioFreeLimits: public/scripts/comp/keyboardShortcuts.js
        applyStudioFreeLimits();
        return true;
    }
    if (action === 'studio-autofill-window') {
        // openAutofillToolWindow: public/scripts/comp/autocompleteUtils.js
        openAutofillToolWindow(studioEditPromptTarget());
        return true;
    }
    if (action === 'studio-dataset-row') {
        if (row.datasetKind === 'quality') toggleStudioQualityPreset(false);
        else if (row.datasetKind === 'transparency') toggleStudioQualityPreset(true);
        else if (row.datasetConfig) toggleDataset(row.datasetConfig.value, row.datasetConfig);
        return true;
    }
    if (action === 'studio-subtoggle-row' && row && row.subToggle) {
        toggleSubToggle(row.datasetValue, row.subToggle.id, row.subToggle);
        return true;
    }
    if (action && action.indexOf('studio-uc-select-') === 0) {
        selectUcPreset(parseInt(action.slice('studio-uc-select-'.length), 10));
        renderUcPresetsDropdown();
        return true;
    }
    if (action === 'studio-nsfw-select' && row && row.value != null) {
        selectNsfwValue(row.value);
        return true;
    }
    if (runDatasetContextAction(action)) return true;
    if (runUcContextAction(action)) return true;
    if (action && action.indexOf('autofill-') === 0) {
        // handleAutofillSettingsMenuAction: public/scripts/comp/autofillSettings.js
        return handleAutofillSettingsMenuAction(action, row);
    }
    if (studioIsPreviewMenuAction(action)) {
        const preview = document.getElementById('manualPreviewImage');
        studioMenuActionDepth += 1;
        try {
            // handleManualPreviewImageContextMenuAction: public/scripts/comp/manualModalManager.js
            handleManualPreviewImageContextMenuAction({
                detail: { action: action, target: preview, item: row }
            });
        } finally {
            studioMenuActionDepth -= 1;
        }
        return true;
    }
    if (action === 'studio-stage-results') {
        // stageResultsReviewManager: public/scripts/comp/stageResultsReview.js
        void stageResultsReviewManager.openFromStudio();
        return true;
    }
    if (action === 'studio-text-expanders') {
        // showRequestBodyReplacementsModal: public/scripts/comp/requestBodyReplacementsModal.js
        showRequestBodyReplacementsModal();
        return true;
    }
    if (action === 'studio-phasewalker') {
        // openPhasewalkerEditor: public/scripts/comp/runCommandIndex.js
        openPhasewalkerEditor();
        return true;
    }
    if (action === 'studio-weight-rack') {
        const textarea = studioEditPromptTarget();
        if (textarea && emphasisGroupsToolManager) emphasisGroupsToolManager.openForTextarea(textarea);
        return true;
    }
    if (action === 'studio-vslider') {
        // openStudioVSliderTool: public/scripts/comp/studioVSlider.js
        openStudioVSliderTool();
        return true;
    }
    if (action === 'studio-save-preset-current' || action === 'studio-save-preset-new' || action === 'studio-save-desktop') {
        // openStudioSaveNameDialog: public/scripts/comp/studioSession.js
        const mode = action === 'studio-save-desktop'
            ? 'desktop'
            : (action === 'studio-save-preset-current' ? 'preset-current' : 'preset-new');
        openStudioSaveNameDialog(mode);
        return true;
    }
    if (action === 'studio-save-folder') {
        // openStudioSaveFolderDialog: public/scripts/comp/studioSession.js
        openStudioSaveFolderDialog();
        return true;
    }
    if (action === 'imggen-toggle' && row && row.key) {
        const next = getImageGenerationSettings()[row.key] !== true;
        void persistImageGenerationSettingsPatch({ [row.key]: next });
        return true;
    }
    if (action === 'imggen-format' && row && row.value != null) {
        void persistImageGenerationSettingsPatch({
            imageFormat: normalizeImageGenerationFormatClient(row.value)
        });
        return true;
    }
    if (action === 'imggen-alpha' && row && row.value != null) {
        void persistImageGenerationSettingsPatch({
            alphaMode: normalizeImageGenerationAlphaModeClient(row.value)
        });
        return true;
    }
    if (action === 'imggen-transparency' && row && row.value != null) {
        const bg = normalizeImageGenerationTransparencyBackgroundClient(row.value);
        void persistImageGenerationSettingsPatch({ transparencyBackground: bg });
        if (bg === 'custom') openStudioTransparencyCustomColorPicker();
        return true;
    }
    if (action === 'enhance-preset-magnitude' && row && row.value != null) {
        persistEnhancePreset({ magnitude: row.value });
        return true;
    }
    if (action === 'enhance-preset-scale' && row && row.value != null) {
        persistEnhancePreset({ scale: row.value });
        return true;
    }
    return false;
}

function wireStudioImageGenerationSettingsMenu() {
    const btn = document.getElementById('studioImageGenSettingsBtn');
    if (!btn || !contextMenu) return;
    if (btn.dataset.imggenSettingsMenuWired === 'true') return;
    btn.dataset.imggenSettingsMenuWired = 'true';
    // attachClickMenuToElement: public/scripts/comp/contextMenu.js
    contextMenu.attachClickMenuToElement(btn, getStudioImageGenerationSettingsMenuConfig());
}

function wireImageGenerationSettingsControls() {
    if (imageGenerationSettingsWired) return;
    imageGenerationSettingsWired = true;

    const hideGalleryBtn = document.getElementById('manualQuickstartHideBtn');
    if (hideGalleryBtn) {
        hideGalleryBtn.addEventListener('click', () => {
            void persistImageGenerationSettingsPatch({ hideQuickstartGallery: true });
        });
    }

    const modeToggle = document.getElementById('manualQuickstartModeToggle');
    if (modeToggle) {
        modeToggle.querySelectorAll('[data-mode]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode === 'explorer' ? 'explorer' : 'quickstart';
                const grid = document.getElementById('manualQuickstartGrid');
                const hasCards = !!(grid && grid.querySelector('.manual-quickstart-card'));
                if (mode === studioGalleryMode && hasCards) return;
                studioGalleryMode = mode;
                studioGalleryRevealPending = true;
                syncStudioGalleryModeToggle();
                if (!studioGalleryRowsReady(mode)) {
                    renderStudioGalleryLoading(mode === 'explorer' ? 'Loading Explorer' : 'Loading Quick Start');
                }
                void refreshManualQuickstartGallery();
            });
        });
    }

    const launchBtn = document.getElementById('manualQuickstartExploreLaunch');
    if (launchBtn) {
        launchBtn.addEventListener('click', () => {
            // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
            void openDsapInGrimoire('dsap://explore.novelai.net/');
        });
    }

    wireStudioGalleryModebarStuck();

    const custom = document.getElementById('studioTransparencyCustomColor');
    if (custom) {
        custom.addEventListener('input', () => {
            void persistImageGenerationSettingsPatch({
                transparencyBackground: 'custom',
                transparencyCustomColor: normalizeImageGenerationCustomColorClient(custom.value)
            });
        });
    }

    wireStudioImageGenerationSettingsMenu();
}

function initImageGenerationSettings() {
    wireImageGenerationSettingsControls();
    applyImageGenerationPreviewChrome();
    syncImageGenerationSettingsUI();
    if (wsClient && wsClient.on) {
        wsClient.on('preset_updated', () => {
            refreshManualQuickstartGallery();
        });
    }
    refreshManualQuickstartGallery();
}

if (typeof wsClient !== 'undefined' && wsClient) {
    wsClient.registerInitStep(471.5, 'Studio quickstart gallery', async () => {
        initImageGenerationSettings();
    });
}
