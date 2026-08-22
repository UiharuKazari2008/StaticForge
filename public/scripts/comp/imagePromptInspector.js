/**
 * Clonable image prompt and generation metadata inspector.
 *
 * Dependencies:
 * - public/scripts/comp/modalUtils.js
 * - public/scripts/comp/customScrollbar.js
 * - public/scripts/comp/galleryView.js (getImageMetadata)
 */

class ImagePromptInspectorManager {
    constructor() {
        this.template = null;
        this.instances = new Map();
        this.instancesByKey = new Map();
        this.nextId = 1;
    }

    init() {
        this.template = document.getElementById('imagePromptInspectorTemplate');
        if (!this.template) {
            console.error('Image prompt inspector template not found');
        }
    }

    getImageKey(image) {
        const filename = image?.filename || image?.upscaled || image?.original || image?.base;
        if (filename) return `filename:${filename}`;
        if (image?.hash) return `hash:${image.hash}`;
        if (image?.id) return `id:${image.id}`;
        return null;
    }

    hasPromptMetadata(metadata) {
        if (!metadata || typeof metadata !== 'object') return false;
        return metadata.prompt !== undefined
            || metadata.compiled_prompt !== undefined
            || metadata.uc !== undefined
            || metadata.dynamic_generation !== undefined
            || metadata.text_replacements !== undefined
            || metadata.forge_data?.input_prompt !== undefined;
    }

    async resolveMetadata(image) {
        const source = image && typeof image === 'object' ? image : {};
        const embedded = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
        let resolved = { ...source, ...embedded };
        const filename = source.filename || source.upscaled || source.original || source.base;

        if (filename && !this.hasPromptMetadata(resolved)) {
            const loaded = await getImageMetadata(filename);
            if (loaded && typeof loaded === 'object') {
                resolved = { ...source, ...embedded, ...loaded };
            }
        }

        if (!resolved.filename && filename) resolved.filename = filename;
        if (!resolved.image_url && source.url) resolved.image_url = source.url;
        return resolved;
    }

    async open(image) {
        const source = image && typeof image === 'object' ? image : {};
        const sourceKey = this.getImageKey(source);
        if (sourceKey && this.instancesByKey.has(sourceKey)) {
            const existing = this.instancesByKey.get(sourceKey);
            bringModalToFront(existing.element);
            return existing;
        }

        const metadata = await this.resolveMetadata(source);
        const key = sourceKey || this.getImageKey(metadata);
        if (key && this.instancesByKey.has(key)) {
            const existing = this.instancesByKey.get(key);
            bringModalToFront(existing.element);
            return existing;
        }
        return this.createInspector(metadata, key);
    }

    createInspector(metadata, key = null) {
        if (!this.template) this.init();
        if (!this.template) return null;

        const id = `imagePromptInspector_${this.nextId++}`;
        const element = this.template.cloneNode(true);
        element.id = id;
        this.updateElementIds(element, id);

        const stableKey = key || this.getImageKey(metadata) || id;
        const windowIdentifier = `imagePromptInspector:${stableKey}`;
        element.dataset.windowIdentifier = windowIdentifier;
        transientWindowsWithPositions.add(windowIdentifier);

        const hasSavedPosition = typeof globalWindowPositions !== 'undefined'
            && globalWindowPositions[windowIdentifier]?.topLeft;
        if (!hasSavedPosition) {
            const offset = this.instances.size * 36;
            element.style.setProperty('--modal-offset-x', `${offset}px`);
            element.style.setProperty('--modal-offset-y', `${offset}px`);
        }

        document.body.appendChild(element);
        const instance = new ImagePromptInspector(id, element, metadata, stableKey, this);
        this.instances.set(id, instance);
        if (key) this.instancesByKey.set(key, instance);
        return instance;
    }

    updateElementIds(element, instanceId) {
        element.querySelectorAll('[id]').forEach((child) => {
            child.id = `${child.id}_${instanceId}`;
        });
    }

    removeInstance(id) {
        const instance = this.instances.get(id);
        if (!instance) return;
        this.instances.delete(id);
        if (this.instancesByKey.get(instance.key) === instance) {
            this.instancesByKey.delete(instance.key);
        }
        instance.destroy();
    }
}

class ImagePromptInspector {
    constructor(id, element, metadata, key, manager) {
        this.id = id;
        this.element = element;
        this.metadata = metadata || {};
        this.key = key;
        this.manager = manager;
        this.promptType = 'prompt';
        this.promptLane = 'input';
        this.jsonWindow = null;
        this.init();
    }

    find(baseId) {
        return this.element.querySelector(`#${baseId}_${this.id}`);
    }

    init() {
        this.cacheElements();
        this.renderSummary();
        this.configureDirectorTab();
        this.wireControls();
        this.renderAll();
        openModal(this.element);
        onModalOpened(this.element);
        setTimeout(() => customScrollbar.forceReinit(this.scrollShell), 0);
    }

    cacheElements() {
        this.title = this.find('imagePromptInspectorTitle');
        this.thumb = this.find('imagePromptInspectorThumb');
        this.filename = this.find('imagePromptInspectorFilename');
        this.subtitle = this.find('imagePromptInspectorSubtitle');
        this.promptTabs = this.find('imagePromptInspectorPromptTabs');
        this.laneToggle = this.find('imagePromptInspectorLaneToggle');
        this.jsonBtn = this.find('imagePromptInspectorJsonBtn');
        this.promptHeading = this.find('imagePromptInspectorPromptHeading');
        this.prompt = this.find('imagePromptInspectorPrompt');
        this.characters = this.find('imagePromptInspectorCharacters');
        this.parameters = this.find('imagePromptInspectorParameters');
        this.expanders = this.find('imagePromptInspectorExpanders');
        this.dynamic = this.find('imagePromptInspectorDynamic');
        this.scrollShell = this.find('imagePromptInspectorScrollShell');
    }

    getDisplayFilename() {
        return this.metadata.filename
            || this.metadata.upscaled
            || this.metadata.original
            || this.metadata.base
            || this.metadata.hash
            || 'Image';
    }

    getImageSource() {
        if (this.metadata.image_url) return this.metadata.image_url;
        if (this.metadata.url) return this.metadata.url;
        const filename = this.metadata.upscaled || this.metadata.original || this.metadata.filename;
        // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        return localGalleryImageUrl(filename);
    }

    renderSummary() {
        const displayName = this.getDisplayFilename();
        this.title.textContent = `Properties [${displayName}]`;
        this.filename.textContent = displayName;

        const dimensions = this.getDimensionsLabel();
        const model = this.getModelDisplayName();
        this.subtitle.textContent = [model, dimensions].filter(Boolean).join(' · ');

        const imageSource = this.getImageSource();
        if (imageSource) {
            this.thumb.src = imageSource;
            this.thumb.classList.remove('hidden');
        }
    }

    getDynamicGeneration() {
        return this.metadata.dynamic_generation
            || this.metadata.forge_data?.dynamic_generation
            || {};
    }

    getDirectorPrompt() {
        const dynamicGeneration = this.getDynamicGeneration();
        return dynamicGeneration.directive
            || dynamicGeneration.compiled_prompt?.directive
            || '';
    }

    configureDirectorTab() {
        const directorButton = this.promptTabs.querySelector('[data-prompt-type="director"]');
        const hasDirector = Boolean(this.getDirectorPrompt().trim());
        directorButton.classList.toggle('hidden', !hasDirector);
        this.promptTabs.classList.toggle('three-tabs', hasDirector);
    }

    wireControls() {
        this.promptTabs.querySelectorAll('[data-prompt-type]').forEach((button) => {
            button.addEventListener('click', () => {
                this.promptType = button.dataset.promptType;
                this.updateToggle(this.promptTabs, 'promptType', this.promptType);
                this.renderPrompt();
            });
        });

        this.laneToggle.addEventListener('click', () => {
            this.promptLane = this.promptLane === 'input' ? 'computed' : 'input';
            this.updateLaneToggle();
            this.renderPrompt();
        });

        this.jsonBtn.addEventListener('click', () => this.showMetadataJson());

        this.element.addEventListener('focusin', (event) => {
            if (!event.target.matches('textarea[readonly]')) return;
            const container = event.target.closest(
                '.prompt-textarea-container, .character-prompt-textarea-container'
            );
            container?.classList.remove('textarea-focused');
        });

        this.element.querySelector('.close-btn').addEventListener('click', () => this.close());
    }

    updateToggle(group, datasetKey, value) {
        group.dataset.active = value;
        group.querySelectorAll(`[data-${datasetKey.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}]`)
            .forEach((button) => {
                const active = button.dataset[datasetKey] === value;
                button.classList.toggle('active', active);
                button.setAttribute('aria-selected', String(active));
            });
    }

    updateLaneToggle() {
        const computed = this.promptLane === 'computed';
        this.laneToggle.dataset.promptLane = this.promptLane;
        this.laneToggle.dataset.state = computed ? 'on' : 'off';
        this.laneToggle.setAttribute('aria-pressed', String(computed));
        this.laneToggle.title = computed
            ? 'Showing computed prompt; click for input prompt'
            : 'Showing input prompt; click for computed prompt';
    }

    getPromptFields(lane) {
        const forge = this.metadata.forge_data || {};
        const dynamicCompiled = this.getDynamicGeneration().compiled_prompt || {};

        if (lane === 'computed') {
            const compiledPrompt = typeof this.metadata.compiled_prompt === 'string'
                ? this.metadata.compiled_prompt
                : this.metadata.compiled_prompt?.prompt;
            let characters = this.metadata.compiled_characterPrompts
                || this.metadata.compiledCharacterPrompts
                || dynamicCompiled.character_prompts
                || dynamicCompiled.characterPrompts
                || [];
            if (!Array.isArray(characters)) characters = [];
            return {
                prompt: compiledPrompt
                    || dynamicCompiled.prompt
                    || dynamicCompiled.text_prompt
                    || this.metadata.prompt
                    || '',
                uc: this.metadata.compiled_uc
                    ?? dynamicCompiled.uc
                    ?? this.metadata.uc
                    ?? '',
                characters
            };
        }

        let characters = forge.allCharacters || this.metadata.characterPrompts || [];
        if (!Array.isArray(characters)) characters = [];
        return {
            prompt: forge.input_prompt
                ?? this.metadata.input_prompt
                ?? this.metadata.prompt
                ?? '',
            uc: forge.input_uc
                ?? this.metadata.input_uc
                ?? this.metadata.uc
                ?? '',
            characters
        };
    }

    renderAll() {
        this.renderPrompt();
        this.renderParameters();
        this.renderExpanders();
        this.renderDynamicGeneration();
    }

    renderPrompt() {
        const labels = {
            prompt: 'Prompt',
            director: 'Director',
            uc: 'Undesired Content'
        };
        this.promptHeading.lastChild.textContent = ` ${labels[this.promptType]}`;

        const fields = this.getPromptFields(this.promptLane);
        let value = '';
        let characters = [];
        if (this.promptType === 'director') {
            value = this.getDirectorPrompt();
        } else if (this.promptType === 'uc') {
            value = fields.uc;
            characters = fields.characters;
        } else {
            value = fields.prompt;
            characters = fields.characters;
        }

        this.prompt.value = value || 'No prompt data stored for this view.';
        this.prompt.classList.toggle('image-prompt-inspector-empty', !value);
        this.resizeReadonlyTextarea(this.prompt);
        const fieldHint = this.promptType === 'prompt'
            ? 'prompt'
            : (this.promptType === 'uc' ? 'uc' : null);
        this.renderTextareaEmphasis(this.prompt, fieldHint);
        this.renderCharacters(characters, this.promptType);
        customScrollbar.forceReinit(this.scrollShell);
    }

    renderCharacters(characters, promptType) {
        this.characters.replaceChildren();
        if (promptType === 'director' || !characters.length) {
            this.characters.classList.add('hidden');
            return;
        }

        characters.forEach((character, index) => {
            const value = promptType === 'uc'
                ? (character.uc ?? character.input_uc ?? '')
                : (character.prompt ?? character.input_prompt ?? '');
            if (!value) return;

            const item = document.createElement('div');
            item.className = 'image-prompt-inspector-character';
            const name = document.createElement('strong');
            name.textContent = character.chara_name || character.name || `Character ${index + 1}`;
            const field = document.createElement('div');
            field.className = 'character-prompt-textarea-container';
            const background = document.createElement('div');
            background.className = 'character-prompt-textarea-background';
            const wrap = document.createElement('div');
            wrap.className = 'prompt-textarea-emphasis-wrap';
            const textarea = document.createElement('textarea');
            textarea.className = 'form-control character-prompt-textarea prompt-textarea textarea-inset';
            textarea.readOnly = true;
            textarea.tabIndex = -1;
            textarea.spellcheck = false;
            textarea.value = value;
            textarea.setAttribute('aria-label', `${name.textContent} ${promptType === 'uc' ? 'undesired content' : 'prompt'}`);
            wrap.appendChild(textarea);
            field.append(background, wrap);
            item.append(name, field);
            this.characters.appendChild(item);
            this.resizeReadonlyTextarea(textarea);
            const fieldHint = promptType === 'uc'
                ? `character_${index}_uc`
                : `character_${index}_prompt`;
            this.renderTextareaEmphasis(textarea, fieldHint);
        });

        this.characters.classList.toggle('hidden', !this.characters.childElementCount);
    }

    resizeReadonlyTextarea(textarea) {
        // autoResizeTextarea: public/scripts/comp/utilities.js
        autoResizeTextarea(textarea, 80, 0, true);
    }

    renderTextareaEmphasis(textarea, fieldHint) {
        // coalesceEmphasisWeightSource / ensurePromptEmphasisHighlightOverlay:
        // public/scripts/comp/emphasisGroupIdCodec.js / emphasisParse.js
        const normalization = this.metadata.emphasis_normalization
            || this.metadata.forge_data?.emphasis_normalization
            || null;
        let weightSource = null;
        if (fieldHint && normalization) {
            const characterMatch = /^character_(\d+)_(prompt|uc)$/.exec(fieldHint);
            if (characterMatch) {
                const candidates = characterMatch[2] === 'prompt'
                    ? [fieldHint, `character_${characterMatch[1]}`]
                    : [fieldHint];
                const stored = candidates.map((key) => normalization[key]).find(Boolean);
                weightSource = stored ? coalesceEmphasisWeightSource(stored, null) : null;
            } else {
                weightSource = coalesceEmphasisWeightSource(normalization, fieldHint);
            }
        }
        const overlay = ensurePromptEmphasisHighlightOverlay(textarea);
        if (!overlay) return;
        overlay.innerHTML = highlightEmphasisInText(textarea.value, weightSource);
        overlay.scrollTop = textarea.scrollTop;
        overlay.scrollLeft = textarea.scrollLeft;
    }

    getDimensionsLabel() {
        const width = this.metadata.actual_width || this.metadata.width;
        const height = this.metadata.actual_height || this.metadata.height;
        return width && height ? `${width} × ${height}` : (this.metadata.resolution || '');
    }

    getModelDisplayName() {
        const modelKey = this.getModelKey();
        return modelNames[modelKey]
            || this.metadata.model_display_name
            || this.metadata.model
            || '';
    }

    getModelKey() {
        const rawModel = String(this.metadata.model || '').toLowerCase();
        const modelAliases = {
            furry: 'v3_furry',
            v5: 'v5',
            v5_cur: 'v5_cur',
            v4_5_cur: 'v4_5_cur',
            v4_cur: 'v4_cur'
        };
        return modelAliases[rawModel] || rawModel;
    }

    renderParameters() {
        const hasParams = this.metadata.steps
            || this.metadata.sampler
            || this.metadata.source
            || this.metadata.forge_data
            || this.metadata._encoding
            || this.metadata.resolution
            || this.metadata.width
            || this.metadata.seed !== undefined
            || this.metadata.scale !== undefined;
        if (!hasParams) {
            this.parameters.replaceChildren();
            this.renderEmpty(this.parameters, 'No generation parameters stored.');
            return;
        }
        // buildBlueprintInfoHtml: public/scripts/comp/referenceManager.js
        this.parameters.innerHTML = buildBlueprintInfoHtml(this.metadata);
    }

    renderExpanders() {
        this.expanders.replaceChildren();
        const seeds = this.metadata.text_replacements_seed
            || this.metadata.forge_data?.text_replacements_seed
            || [];
        const definitions = this.metadata.text_replacements
            || this.metadata.forge_data?.text_replacements
            || [];
        const resolvedKeys = new Set();

        if (Array.isArray(seeds)) {
            seeds.forEach((seed, index) => {
                const key = seed.key || seed.name || `Replacement ${index + 1}`;
                resolvedKeys.add(key);
                this.expanders.appendChild(this.buildExpanderLockItem(seed, index));
            });
        }

        if (Array.isArray(definitions)) {
            definitions.forEach((definition, index) => {
                const key = definition.name || definition.key || `Expander ${index + 1}`;
                if (resolvedKeys.has(key)) return;
                this.expanders.appendChild(this.buildExpanderLockItem({
                    key,
                    value: definition.value ?? definition,
                    type: definition.type || 'regular',
                    source: definition.source || ''
                }, index));
            });
        }

        const dynamicTr = this.getDynamicGeneration()?.compiled_prompt?.text_replacements;
        if (dynamicTr && typeof dynamicTr === 'object') {
            this.appendDynamicTendaiRows(dynamicTr);
        }

        if (!this.expanders.childElementCount) {
            this.renderEmpty(this.expanders, 'No text expanders stored.');
        }
    }

    buildExpanderLockItem(seed, index) {
        // getLocationIcon / getReplacementTypeIcon / getLocationColor / getReplacementTypeColor /
        // escapeHtml: public/scripts/comp/textReplacementManager.js
        const item = document.createElement('div');
        item.className = 'text-replacement-lock-item';
        const source = seed.source || '';
        if (source === 'negative_prompt' || source === 'input_prompt_negative'
            || (source.startsWith('character_')
                && (source.endsWith('_uc') || source.endsWith('_input_prompt_negative')))) {
            item.classList.add('negative-prompt');
        }
        if (seed.locked) item.classList.add('selected');

        let characterIndex = null;
        if (source.startsWith('character_')) {
            const parsedIndex = parseInt(source.split('_')[1], 10);
            if (!Number.isNaN(parsedIndex)) characterIndex = parsedIndex;
        }

        const key = seed.key || seed.name || `Replacement ${index + 1}`;
        const isStatic = seed.type === 'regular' || !seed.type;
        const indexDisplay = seed.index !== null && seed.index !== undefined
            ? `<span class="text-replacement-index">${seed.index}</span>`
            : '';
        let originalPattern = seed.pattern;
        if (!originalPattern) {
            originalPattern = `!${key}${seed.type === 'combine_incrementing' ? '~+#'
                : seed.type === 'pick_incrementing' ? '~#'
                    : seed.type === 'combine' ? '~+' : '~'}`;
        }

        const characterBadge = characterIndex !== null
            ? `<span class="text-replacement-badge text-replacement-badge-character">
                <i class="fas fa-person"></i>
                <span style="font-size: 0.75em;">${characterIndex + 1}</span>
            </span>`
            : '';

        const patternHtml = isStatic
            ? `<span class="text-replacement-original">!${escapeHtml(String(key))}</span>`
            : `<span class="text-replacement-original">${escapeHtml(String(originalPattern))}</span>
                <i class="fas fa-arrow-right text-replacement-arrow"></i>
                <span class="text-replacement-selected">!${escapeHtml(String(key))}${indexDisplay}</span>`;

        item.innerHTML = `
            <div class="text-replacement-lock-content">
                <div class="text-replacement-lock-info">
                    <div class="text-replacement-full-value">${escapeHtml(this.formatValue(seed.value))}</div>
                </div>
                <div class="text-replacement-lock-row">
                    <div class="text-replacement-lock-badges">
                        <span class="text-replacement-badge text-replacement-badge-combined">
                            <span class="badge-icon-location" style="color: ${getLocationColor(source)};">${getLocationIcon(source)}</span>
                            ${characterBadge}
                            <span class="badge-icon-type" style="color: ${getReplacementTypeColor(seed.type)};">${getReplacementTypeIcon(seed.type)}</span>
                        </span>
                    </div>
                    <div class="text-replacement-lock-pattern">
                        ${patternHtml}
                    </div>
                </div>
            </div>
        `;
        return item;
    }

    appendDynamicTendaiRows(textReplacements) {
        const replacements = [];
        (textReplacements.prompt || []).forEach((rep, index) => {
            replacements.push({ ...rep, targetType: 'prompt', targetSource: 'base', index });
        });
        (textReplacements.uc || []).forEach((rep, index) => {
            replacements.push({ ...rep, targetType: 'uc', targetSource: 'base', index });
        });
        (textReplacements.character_prompts || []).forEach((character, charIndex) => {
            (character?.prompt || []).forEach((rep, index) => {
                replacements.push({
                    ...rep,
                    targetType: 'character',
                    targetSource: charIndex,
                    targetField: 'prompt',
                    index
                });
            });
            (character?.uc || []).forEach((rep, index) => {
                replacements.push({
                    ...rep,
                    targetType: 'character',
                    targetSource: charIndex,
                    targetField: 'uc',
                    index
                });
            });
        });

        replacements.forEach((replacement, globalIndex) => {
            // createTendaiReplacementRow: public/scripts/comp/textReplacementManager.js
            const row = createTendaiReplacementRow(replacement, globalIndex, { mode: 'view' });
            row.querySelectorAll('.text-replacement-lock-actions, .text-replacement-lock-btn').forEach((el) => {
                el.remove();
            });
            this.expanders.appendChild(row);
        });
    }

    renderDynamicGeneration() {
        this.dynamic.replaceChildren();
        const dynamicGeneration = this.getDynamicGeneration();
        const compiled = dynamicGeneration.compiled_prompt || {};
        const omitted = new Set([
            'compiled_prompt', 'text_replacements', 'prompt', 'uc',
            'character_prompts', 'characterPrompts', 'directive'
        ]);
        const rows = [];

        if (this.getDirectorPrompt()) rows.push(['Directive', this.getDirectorPrompt(), 'fas fa-scroll']);
        [
            ['Cache Locked', dynamicGeneration.cache_locked ?? compiled.cache_locked, 'fas fa-lock'],
            ['Context Locked', dynamicGeneration.context_locked ?? compiled.context_locked, 'fas fa-lock'],
            ['Generated Name', compiled.generated_image_name, 'fas fa-file-signature'],
            ['Timestamp', compiled.timestamp, 'fas fa-clock'],
            ['Prompt Hash', compiled.prompt_hash, 'fas fa-hashtag'],
            ['Request Hash', compiled.request_hash, 'fas fa-hashtag'],
            ['Directive Hash', compiled.directive_hash, 'fas fa-hashtag'],
            ['Usage', compiled.usage, 'fas fa-chart-simple'],
            ['Context', compiled.context, 'fas fa-globe']
        ].forEach(([label, value, icon]) => {
            if (value !== undefined && value !== null && value !== '') {
                rows.push([label, value, icon]);
            }
        });

        Object.entries(dynamicGeneration).forEach(([key, value]) => {
            if (omitted.has(key) || value === undefined || value === null || value === '') return;
            if (rows.some(([label]) => label.toLowerCase().replaceAll(' ', '_') === key.toLowerCase())) return;
            rows.push([this.formatLabel(key), value, 'fas fa-circle-info']);
        });

        if (!rows.length) {
            this.renderEmpty(this.dynamic, 'No dynamic generation data stored.');
            return;
        }

        rows.forEach(([label, value, icon]) => {
            this.dynamic.appendChild(this.buildInfoItem(label, value, icon));
        });
    }

    buildInfoItem(label, value, iconClass = 'fas fa-circle-info') {
        const item = document.createElement('div');
        const isComplex = value !== null && typeof value === 'object';
        item.className = `info-item${isComplex ? ' monospace' : ''}`;
        const labelEl = document.createElement('span');
        labelEl.className = 'info-label';
        labelEl.innerHTML = `<i class="${iconClass}"></i> ${escapeHtml(label)}`;
        const valueEl = document.createElement('span');
        valueEl.textContent = this.formatValue(value);
        item.append(labelEl, valueEl);
        return item;
    }

    renderEmpty(container, message) {
        const empty = document.createElement('span');
        empty.className = 'image-prompt-inspector-empty';
        empty.textContent = message;
        container.appendChild(empty);
    }

    showMetadataJson() {
        if (this.jsonWindow && document.body.contains(this.jsonWindow)) {
            bringModalToFront(this.jsonWindow);
            return;
        }

        const template = document.getElementById('imagePromptInspectorJsonTemplate');
        if (!template) {
            console.error('Image prompt inspector JSON template not found');
            return;
        }

        const jsonId = `imagePromptInspectorJson_${this.id}`;
        const element = template.cloneNode(true);
        element.id = jsonId;
        element.querySelectorAll('[id]').forEach((child) => {
            child.id = `${child.id}_${this.id}`;
        });
        element.setAttribute('data-parent-modal-id', this.element.id);

        const windowIdentifier = `imagePromptInspectorJson:${this.key}`;
        element.dataset.windowIdentifier = windowIdentifier;
        transientWindowsWithPositions.add(windowIdentifier);

        const hasSavedPosition = typeof globalWindowPositions !== 'undefined'
            && globalWindowPositions[windowIdentifier]?.topLeft;
        if (!hasSavedPosition) {
            element.style.setProperty('--modal-offset-x', '48px');
            element.style.setProperty('--modal-offset-y', '48px');
        }

        document.body.appendChild(element);
        this.jsonWindow = element;

        const body = element.querySelector(`#imagePromptInspectorJsonBody_${this.id}`);
        const scrollShell = element.querySelector(`#imagePromptInspectorJsonScrollShell_${this.id}`);
        body.textContent = this.formatValue(this.metadata);

        element.querySelector('.close-btn').addEventListener('click', () => {
            this.closeJsonWindow();
        });

        openModal(element);
        onModalOpened(element);
        setTimeout(() => customScrollbar.forceReinit(scrollShell), 0);
    }

    closeJsonWindow() {
        if (!this.jsonWindow) return;
        const element = this.jsonWindow;
        this.jsonWindow = null;
        closeModal(element).then(() => {
            onModalClosed(element);
            const scrollShell = element.querySelector('[data-custom-scrollbar]');
            if (scrollShell) customScrollbar.destroy(scrollShell);
            element.remove();
        });
    }

    formatValue(value) {
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        try {
            return JSON.stringify(value, null, 2);
        } catch (_) {
            return String(value);
        }
    }

    formatLabel(value) {
        return value
            .replaceAll('_', ' ')
            .replace(/\b\w/g, (character) => character.toUpperCase());
    }

    close() {
        this.closeJsonWindow();
        closeModal(this.element).then(() => this.manager.removeInstance(this.id));
    }

    destroy() {
        if (this.jsonWindow) {
            const element = this.jsonWindow;
            this.jsonWindow = null;
            onModalClosed(element);
            const scrollShell = element.querySelector('[data-custom-scrollbar]');
            if (scrollShell) customScrollbar.destroy(scrollShell);
            element.remove();
        }
        onModalClosed(this.element);
        customScrollbar.destroy(this.scrollShell);
        this.element.remove();
    }
}

const imagePromptInspectorManager = new ImagePromptInspectorManager();

function openImagePromptInspector(imageOrMetadata) {
    return imagePromptInspectorManager.open(imageOrMetadata).catch((error) => {
        console.error('Failed to open image properties:', error);
        showGlassToast(
            'error',
            'Properties',
            'Could not load image metadata.',
            false,
            4000,
            '<i class="fas fa-exclamation-triangle"></i>'
        );
        return null;
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => imagePromptInspectorManager.init());
} else {
    imagePromptInspectorManager.init();
}
