/**
 * Clonable image prompt and generation metadata inspector.
 *
 * Dependencies:
 * - public/scripts/comp/modalUtils.js
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

        const embedded = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
        const preview = { ...source, ...embedded };
        const filename = source.filename || source.upscaled || source.original || source.base;
        if (!preview.filename && filename) preview.filename = filename;
        if (!preview.image_url && source.url) preview.image_url = source.url;

        const needsServer = !!(filename && !this.hasPromptMetadata(preview));
        if (!needsServer) {
            const metadata = await this.resolveMetadata(source);
            const key = sourceKey || this.getImageKey(metadata);
            if (key && this.instancesByKey.has(key)) {
                const existing = this.instancesByKey.get(key);
                bringModalToFront(existing.element);
                return existing;
            }
            return this.createInspector(metadata, key);
        }

        const instance = this.createInspector(preview, sourceKey, { loading: true });
        if (!instance) return null;
        try {
            const metadata = await this.resolveMetadata(source);
            instance.applyMetadata(metadata);
            return instance;
        } finally {
            instance.setLoading(false);
        }
    }

    createInspector(metadata, key = null, options = null) {
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
        const instance = new ImagePromptInspector(id, element, metadata, stableKey, this, options);
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
    constructor(id, element, metadata, key, manager, options) {
        this.id = id;
        this.element = element;
        this.metadata = metadata || {};
        this.key = key;
        this.manager = manager;
        this.promptType = 'prompt';
        this.promptLane = 'input';
        this.jsonWindow = null;
        this.startLoading = !!(options && options.loading);
        this.init();
    }

    find(baseId) {
        return this.element.querySelector(`#${baseId}_${this.id}`);
    }

    init() {
        this.cacheElements();
        if (this.startLoading) this.setLoading(true);
        this.renderSummary();
        this.configureDirectorTab();
        this.wireControls();
        this.renderAll();
        openModal(this.element);
        onModalOpened(this.element);
        this.observePromptWidth();
    }

    // Boxes are measured before the window opens; the scrollbar, maximize, resize and the late prompt font change the wrap later.
    observePromptWidth() {
        this.promptWidth = 0;
        this.promptWidthObserver = new ResizeObserver((entries) => {
            const width = entries[0].contentRect.width;
            if (!width || width === this.promptWidth) return;
            this.promptWidth = width;
            this.resizePromptTextareas();
        });
        this.promptWidthObserver.observe(this.prompt);
        document.fonts.ready.then(() => this.resizePromptTextareas());
    }

    resizePromptTextareas() {
        this.element.querySelectorAll('textarea.prompt-textarea').forEach((textarea) => this.resizeReadonlyTextarea(textarea));
    }

    setLoading(loading) {
        const cover = this.element.querySelector('.gallery-move-right-panel-cover');
        if (cover) cover.classList.toggle('show', !!loading);
    }

    applyMetadata(metadata) {
        this.metadata = metadata || {};
        this.renderSummary();
        this.configureDirectorTab();
        this.renderAll();
    }

    cacheElements() {
        this.title = this.find('imagePromptInspectorTitle');
        this.thumb = this.find('imagePromptInspectorThumb');
        this.filename = this.find('imagePromptInspectorFilename');
        this.subtitle = this.find('imagePromptInspectorSubtitle');
        this.promptTabs = this.find('imagePromptInspectorPromptTabs');
        this.laneToggle = this.find('imagePromptInspectorLaneToggle');
        this.copyBtn = this.find('imagePromptInspectorCopyBtn');
        this.findBar = this.find('imagePromptInspectorFindBar');
        this.findInput = this.find('imagePromptInspectorFindInput');
        this.findCount = this.find('imagePromptInspectorFindCount');
        this.scrollShell = this.find('imagePromptInspectorScrollShell');
        this.menuTitles = this.element.querySelectorAll('[data-inspector-menu]');
        this.promptHeading = this.find('imagePromptInspectorPromptHeading');
        this.prompt = this.find('imagePromptInspectorPrompt');
        this.characters = this.find('imagePromptInspectorCharacters');
        this.parameters = this.find('imagePromptInspectorParameters');
        this.expanders = this.find('imagePromptInspectorExpanders');
        this.expandersSection = this.find('imagePromptInspectorExpandersSection')
            || this.expanders?.closest('.image-prompt-inspector-section');
        this.dynamic = this.find('imagePromptInspectorDynamic');
        this.dynamicContext = this.find('imagePromptInspectorDynamicContext');
        this.dynamicSection = this.find('imagePromptInspectorDynamicSection')
            || this.dynamic?.closest('.image-prompt-inspector-section');
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
        this.element.querySelector('[data-inspector-action="studio"]').disabled = !this.hasImageFile();
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
        directorButton.classList.toggle('hidden', !this.hasDirectorPrompt());
    }

    hasDirectorPrompt() {
        return Boolean(this.getDirectorPrompt().trim());
    }

    wireControls() {
        this.promptTabs.querySelectorAll('[data-prompt-type]').forEach((button) => {
            button.addEventListener('click', () => this.setPromptType(button.dataset.promptType));
        });

        this.laneToggle.addEventListener('click', () => this.toggleLane());
        this.findInput.addEventListener('input', () => this.runFind());
        this.registerFindKeys();

        this.element.querySelectorAll('[data-inspector-action]').forEach((button) => {
            button.addEventListener('click', () => this.runAction(button.dataset.inspectorAction));
        });

        // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
        const onAction = (action) => this.runAction(action);
        contextMenu.attachClickMenuToElement(this.copyBtn, {
            onAction,
            sections: [{ type: 'list', items: this.copyMenuItems('') }]
        });
        this.menuTitles.forEach((title) => {
            contextMenu.attachClickMenuToElement(title, {
                onAction,
                sections: [{
                    type: 'list',
                    initfn: (section) => { section.items = this.menuItems(title.dataset.inspectorMenu); }
                }]
            });
        });

        this.element.addEventListener('focusin', (event) => {
            if (!event.target.matches('textarea[readonly]')) return;
            const container = event.target.closest(
                '.prompt-textarea-container, .character-prompt-textarea-container'
            );
            container?.classList.remove('textarea-focused');
        });

        this.element.addEventListener('contextmenu', (event) => {
            const textarea = event.target.closest('textarea');
            if (!textarea || !textarea.readOnly) return;
            if (!textarea.closest('.prompt-textarea-container, .character-prompt-textarea-container')) return;
            event.preventDefault();
            event.stopPropagation();
        }, true);

        this.element.querySelector('.close-btn').addEventListener('click', () => this.close());

        const copyValueWithToast = async (value, label = 'Copied') => {
            const cleanText = (value || '').trim();
            if (!cleanText) return;
            // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
            await copyTextToClipboard(cleanText);
            if (typeof showGlassToast === 'function') {
                const preview = cleanText.length > 32 ? `${cleanText.slice(0, 32)}…` : cleanText;
                showGlassToast('success', label, `"${preview}" copied to clipboard`, false, 2000, '<i class="fas fa-copy"></i>');
            }
        };

        this.filename?.addEventListener('dblclick', async () => {
            await copyValueWithToast(this.getDisplayFilename(), 'Filename Copied');
        });

        this.subtitle?.addEventListener('dblclick', async () => {
            const text = this.subtitle?.innerText || this.subtitle?.textContent;
            await copyValueWithToast(text, 'Model / Dimensions Copied');
        });

        this.parameters?.addEventListener('dblclick', async (event) => {
            const spanOrLabel = event.target.closest('span, label, .meta-value');
            const target = spanOrLabel || event.target.closest('.form-group');
            if (!target) return;
            const text = (target.innerText || target.textContent || '').trim();
            await copyValueWithToast(text, 'Parameter Copied');
        });

        this.expanders?.addEventListener('dblclick', async (event) => {
            const target = event.target.closest(
                '.text-replacement-full-value, .text-replacement-original, .text-replacement-selected, .text-replacement-badge, .text-replacement-lock-item'
            );
            if (!target) return;
            const text = (target.innerText || target.textContent || '').trim();
            await copyValueWithToast(text, 'Expander Copied');
        });

        this.dynamic?.addEventListener('dblclick', async (event) => {
            const target = event.target.closest('span, label, .info-item');
            if (!target) return;
            const text = (target.innerText || target.textContent || '').trim();
            await copyValueWithToast(text, 'Dynamic Info Copied');
        });
    }

    setPromptType(promptType) {
        this.promptType = promptType;
        this.updateToggle(this.promptTabs, 'promptType', promptType);
        this.renderPrompt();
    }

    toggleLane() {
        this.promptLane = this.promptLane === 'input' ? 'computed' : 'input';
        this.updateLaneToggle();
        this.renderPrompt();
    }

    hasImageFile() {
        return Boolean(this.metadata.filename || this.metadata.upscaled || this.metadata.original);
    }

    copyMenuItems(prefix) {
        return [
            { text: `${prefix}Filename`, icon: 'fas fa-file-signature', action: 'copy-filename' },
            { text: `${prefix}Input Prompt`, icon: 'fas fa-align-left', action: 'copy-prompt-input' },
            { text: `${prefix}Compiled Prompt`, icon: 'fas fa-hammer', action: 'copy-prompt-compiled' },
            { separator: true },
            { text: `${prefix}Change JSON`, icon: 'fas fa-code-compare', action: 'copy-change-json' },
            { text: `${prefix}Raw Metadata JSON`, icon: 'fas fa-brackets-curly', action: 'copy-raw-json' },
            { separator: true },
            { text: `${prefix}Image with Metadata`, icon: 'fas fa-image', action: 'copy-image' }
        ];
    }

    menuItems(menu) {
        const noFile = !this.hasImageFile();
        if (menu === 'file') {
            return [
                { text: 'Open Image', icon: 'fas fa-image', action: 'view-image' },
                { text: 'Edit in DreamStudio', icon: 'fas fa-compass-drafting', action: 'studio', disabled: noFile },
                { separator: true },
                { text: 'Close', action: 'close' }
            ];
        }
        if (menu === 'edit') {
            return [
                ...this.copyMenuItems('Copy '),
                { separator: true },
                { text: 'Find...', icon: 'fas fa-magnifying-glass', action: 'find' }
            ];
        }
        const radio = (text, promptType, extra) => ({
            text,
            action: `prompt-${promptType}`,
            showIndicator: true,
            indicatorMark: 'radio',
            checked: this.promptType === promptType,
            ...extra
        });
        return [
            radio('Prompt', 'prompt'),
            radio('Director', 'director', { hidden: !this.hasDirectorPrompt() }),
            radio('Undesired Content', 'uc'),
            { separator: true },
            { text: 'Computed Prompt', action: 'lane', showIndicator: true, checked: this.promptLane === 'computed' },
            { separator: true },
            { text: 'Metadata JSON', icon: 'fas fa-brackets-curly', action: 'json' }
        ];
    }

    runAction(action) {
        switch (action) {
            case 'copy-filename': return this.copyFilename();
            case 'copy-prompt-input': return this.copyPrompt('input');
            case 'copy-prompt-compiled': return this.copyPrompt('computed');
            case 'copy-change-json':
                return this.copyText(JSON.stringify(this.buildChangeJson(), null, 2), 'Change JSON copied to clipboard', 'fas fa-code-compare');
            case 'copy-raw-json':
                return this.copyText(JSON.stringify(this.metadata, null, 2), 'Raw metadata JSON copied to clipboard', 'fas fa-brackets-curly');
            // copyImageToClipboard: public/scripts/comp/galleryView.js
            case 'copy-image': return copyImageToClipboard(this.metadata);
            // openGalleryImageInViewer: public/scripts/comp/imageViewer.js
            case 'view-image': return openGalleryImageInViewer(this.metadata);
            case 'studio': return this.openInStudio();
            case 'json': return this.showMetadataJson();
            case 'prompt-prompt':
            case 'prompt-director':
            case 'prompt-uc':
                return this.setPromptType(action.slice('prompt-'.length));
            case 'lane': return this.toggleLane();
            case 'find': return this.openFind();
            case 'find-prev': return this.stepFind(-1);
            case 'find-next': return this.stepFind(1);
            case 'find-close': return this.closeFind();
            case 'close': return this.close();
            default: return undefined;
        }
    }

    registerFindKeys() {
        // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        registerKeyboardListener({
            id: `imagePromptInspector.find.${this.id}`,
            type: 'whenFocused',
            modalId: this.id,
            eventType: 'keydown',
            label: 'Find',
            keys: 'Ctrl+F',
            overlayIcon: 'fas fa-magnifying-glass',
            overlayGroup: 'Properties',
            priority: 80,
            critical: true,
            handler: (event) => {
                if ((event.ctrlKey || event.metaKey) && (event.key || '').toLowerCase() === 'f') {
                    event.preventDefault();
                    this.openFind();
                    return true;
                }
                if (event.target !== this.findInput) return false;
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this.stepFind(event.shiftKey ? -1 : 1);
                    return true;
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    this.closeFind();
                    return true;
                }
                return false;
            }
        });
    }

    isFindOpen() {
        return !this.findBar.classList.contains('hidden');
    }

    openFind() {
        this.findBar.classList.remove('hidden');
        this.findInput.focus();
        this.findInput.select();
        this.runFind();
    }

    closeFind() {
        this.findBar.classList.add('hidden');
        this.findMatches = [];
        this.clearFindHighlights();
    }

    // Matches every prompt box in the current view; reruns when the view changes (renderPrompt).
    runFind() {
        this.clearFindHighlights();
        const query = this.findInput.value.toLowerCase();
        this.findMatches = [];
        if (query) {
            this.element.querySelectorAll('textarea.prompt-textarea').forEach((textarea) => {
                // findSearchMatchesInText: public/scripts/comp/promptTextareaToolbar.js
                promptTextareaToolbar.findSearchMatchesInText(textarea.value, query).forEach((match) => {
                    this.findMatches.push({ ...match, textarea });
                });
            });
        }
        this.findIndex = this.findMatches.length ? 0 : -1;
        this.paintFind();
    }

    stepFind(direction) {
        const count = this.findMatches?.length;
        if (!count) return;
        this.findIndex = (this.findIndex + direction + count) % count;
        this.paintFind();
    }

    paintFind() {
        const byTextarea = new Map();
        this.findMatches.forEach((match) => {
            if (!byTextarea.has(match.textarea)) byTextarea.set(match.textarea, []);
            byTextarea.get(match.textarea).push(match);
        });
        byTextarea.forEach((matches, textarea) => {
            // ensurePromptSearchHighlightOverlay: public/scripts/comp/emphasisParse.js
            // buildSearchHighlightHtml: public/scripts/comp/promptTextareaToolbar.js
            ensurePromptSearchHighlightOverlay(textarea).innerHTML = promptTextareaToolbar
                .buildSearchHighlightHtml(textarea.value, matches, this.findIndex, this.findMatches);
        });

        const total = this.findMatches.length;
        this.findCount.textContent = !this.findInput.value ? ''
            : (total ? `${this.findIndex + 1} of ${total}` : 'No matches');

        const selected = this.element.querySelector('.search-highlight-selected');
        if (!selected) return;
        const box = selected.getBoundingClientRect();
        const view = this.scrollShell.getBoundingClientRect();
        if (box.top < view.top || box.bottom > view.bottom) {
            this.scrollShell.scrollTop += box.top - view.top - view.height / 3;
        }
    }

    clearFindHighlights() {
        this.element.querySelectorAll('.search-highlight-overlay').forEach((overlay) => {
            overlay.textContent = '';
        });
        this.findCount.textContent = '';
    }

    async copyText(text, message, iconClass) {
        // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
        await copyTextToClipboard(text);
        showGlassToast('success', 'Copied', message, false, 2500, `<i class="${iconClass}"></i>`);
    }

    copyFilename() {
        const name = this.getDisplayFilename();
        if (!name) return undefined;
        return this.copyText(name, 'Filename copied to clipboard', 'fas fa-file-signature');
    }

    copyPrompt(lane) {
        const computed = lane === 'computed';
        const fields = this.getPromptFields(lane);
        const compiledPrompt = typeof this.metadata.compiled_prompt === 'string'
            ? this.metadata.compiled_prompt
            : this.metadata.compiled_prompt?.prompt;
        const text = fields.prompt
            || (computed ? compiledPrompt : this.metadata.input_prompt)
            || this.metadata.prompt
            || '';
        const label = computed ? 'Compiled' : 'Input';
        const iconClass = computed ? 'fas fa-hammer' : 'fas fa-align-left';
        if (!text) {
            showGlassToast('info', 'Prompt', `No ${label.toLowerCase()} prompt available`, false, 2500, `<i class="${iconClass}"></i>`);
            return undefined;
        }
        return this.copyText(this.promptTextWithVisibleEmphasis(text, 'prompt'), `${label} prompt copied to clipboard`, iconClass);
    }

    openInStudio() {
        if (!this.hasImageFile()) return undefined;
        // openManualModalWithContent: public/scripts/comp/manualModalManager.js
        return openManualModalWithContent({ type: 'image', image: this.metadata, metadata: null });
    }

    buildChangeJson() {
        const metadata = this.metadata || {};
        const forge = metadata.forge_data || {};
        const title = this.getDisplayFilename();

        const params = {};
        const paramKeys = [
            'steps', 'sampler', 'model', 'resolution', 'width', 'height',
            'variety', 'strength', 'noise', 'nsfw'
        ];
        paramKeys.forEach((key) => {
            if (metadata[key] !== undefined && metadata[key] !== null) {
                params[key] = metadata[key];
            }
        });
        if (metadata.scale !== undefined && metadata.scale !== null) {
            params.guidance = metadata.scale;
        } else if (metadata.guidance !== undefined && metadata.guidance !== null) {
            params.guidance = metadata.guidance;
        }
        if (metadata.rescale !== undefined && metadata.rescale !== null) {
            params.rescale = metadata.rescale;
        } else if (metadata.cfg_rescale !== undefined && metadata.cfg_rescale !== null) {
            params.rescale = metadata.cfg_rescale;
        }
        if (metadata.noise_schedule !== undefined && metadata.noise_schedule !== null) {
            params.noiseScheduler = metadata.noise_schedule;
        } else if (metadata.noiseScheduler !== undefined && metadata.noiseScheduler !== null) {
            params.noiseScheduler = metadata.noiseScheduler;
        }
        if (metadata.seed !== undefined && metadata.seed !== null) {
            params.seed = metadata.seed;
        }
        if (metadata.append_uc !== undefined && metadata.append_uc !== null) {
            params.append_uc = metadata.append_uc;
        }
        if (metadata.append_quality !== undefined && metadata.append_quality !== null) {
            params.append_quality = metadata.append_quality;
        }

        const inputFields = this.getPromptFields('input');
        const promptText = inputFields.prompt || '';
        const ucText = inputFields.uc || '';
        const fields = [
            {
                id: 'prompt',
                action: 'replace',
                chunks: [{ name: 'Prompt', text: promptText }]
            },
            {
                id: 'uc',
                action: 'replace',
                chunks: [{ name: 'UC', text: ucText }]
            }
        ];

        let characters = [];
        if (Array.isArray(inputFields.characters) && inputFields.characters.length) {
            characters = inputFields.characters.map((char, index) => {
                const entry = {
                    index,
                    action: 'replace',
                    name: char.chara_name || char.name || `Character ${index + 1}`,
                    prompt: char.input_prompt ?? char.prompt ?? '',
                    uc: char.input_uc ?? char.uc ?? ''
                };
                if (char.position) {
                    entry.position = char.position;
                } else if (Array.isArray(char.center)) {
                    entry.position = { x: char.center[0], y: char.center[1] };
                }
                return entry;
            });
        }

        const rawExpanders = metadata.text_replacements
            || forge.text_replacements
            || [];
        let expanders = [];
        if (Array.isArray(rawExpanders) && rawExpanders.length) {
            expanders = rawExpanders.map((exp) => ({
                prefix: exp.name || exp.prefix || exp.key || '',
                value: exp.value != null ? String(exp.value) : ''
            })).filter((exp) => Boolean(exp.prefix));
        }

        const dynamicGeneration = metadata.dynamic_generation || forge.dynamic_generation || null;

        const rawVibes = metadata.vibes || forge.vibes || null;
        let vibes = [];
        if (Array.isArray(rawVibes) && rawVibes.length) {
            vibes = rawVibes.map((v) => ({
                id: v.id || v.vibeId,
                ...(v.ie ? { ie: v.ie } : {}),
                ...(v.strength != null ? { strength: v.strength } : {}),
                ...(v.inject_text != null ? { inject_text: v.inject_text } : {})
            }));
        }

        const payload = {
            dreamscape: 'change',
            v: 1,
            title,
            params,
            fields,
            ...(characters.length ? { characters } : {}),
            ...(expanders.length ? { expanders } : {}),
            ...(vibes.length ? { vibes } : {}),
            ...(dynamicGeneration ? { dynamicGeneration } : {})
        };

        return payload;
    }

    updateToggle(group, datasetKey, value) {
        group.dataset.active = value;
        group.querySelectorAll(`[data-${datasetKey.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}]`)
            .forEach((button) => {
                const active = button.dataset[datasetKey] === value;
                button.classList.toggle('active', active);
                button.dataset.state = active ? 'on' : 'off';
                button.setAttribute('aria-selected', String(active));
            });
    }

    updateLaneToggle() {
        const computed = this.promptLane === 'computed';
        this.laneToggle.dataset.promptLane = this.promptLane;
        this.laneToggle.dataset.state = computed ? 'on' : 'off';
        this.laneToggle.classList.toggle('active', computed);
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

        const fieldHint = this.promptType === 'prompt'
            ? 'prompt'
            : (this.promptType === 'uc' ? 'uc' : null);
        const displayValue = value
            ? this.promptTextWithVisibleEmphasis(value, fieldHint)
            : 'No prompt data stored for this view.';
        this.prompt.value = displayValue;
        this.prompt.classList.toggle('image-prompt-inspector-empty', !value);
        this.resizeReadonlyTextarea(this.prompt);
        this.renderTextareaEmphasis(this.prompt, fieldHint);
        this.renderCharacters(characters, this.promptType);
        if (this.isFindOpen()) this.runFind();
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
            const fieldHint = promptType === 'uc'
                ? `character_${index}_uc`
                : `character_${index}_prompt`;
            textarea.value = this.promptTextWithVisibleEmphasis(value, fieldHint);
            textarea.setAttribute('aria-label', `${name.textContent} ${promptType === 'uc' ? 'undesired content' : 'prompt'}`);
            wrap.appendChild(textarea);
            field.append(background, wrap);
            item.append(name, field);
            this.characters.appendChild(item);
            this.resizeReadonlyTextarea(textarea);
            this.renderTextareaEmphasis(textarea, fieldHint);
        });

        this.characters.classList.toggle('hidden', !this.characters.childElementCount);
    }

    resizeReadonlyTextarea(textarea) {
        // autoResizeTextarea: public/scripts/comp/utilities.js
        autoResizeTextarea(textarea, 80, 0, true);
    }

    resolveEmphasisWeightSource(fieldHint) {
        // coalesceEmphasisWeightSource: public/scripts/comp/emphasisGroupIdCodec.js
        const normalization = this.metadata.emphasis_normalization
            || this.metadata.forge_data?.emphasis_normalization
            || null;
        if (!fieldHint || !normalization) return null;
        const characterMatch = /^character_(\d+)_(prompt|uc)$/.exec(fieldHint);
        if (characterMatch) {
            const candidates = characterMatch[2] === 'prompt'
                ? [fieldHint, `character_${characterMatch[1]}`]
                : [fieldHint];
            const stored = candidates.map((key) => normalization[key]).find(Boolean);
            return stored ? coalesceEmphasisWeightSource(stored, null) : null;
        }
        return coalesceEmphasisWeightSource(normalization, fieldHint);
    }

    promptTextWithVisibleEmphasis(text, fieldHint) {
        const value = text == null ? '' : String(text);
        // expandEmphasisGroupIds / hasManagedEmphasisGroupIds: public/scripts/comp/emphasisGroupIdCodec.js
        if (!value || typeof expandEmphasisGroupIds !== 'function' || typeof hasManagedEmphasisGroupIds !== 'function') {
            return value;
        }
        if (!hasManagedEmphasisGroupIds(value)) return value;
        return expandEmphasisGroupIds(value, this.resolveEmphasisWeightSource(fieldHint)).text;
    }

    renderTextareaEmphasis(textarea, fieldHint) {
        // ensurePromptEmphasisHighlightOverlay / highlightEmphasisForTextarea:
        // public/scripts/comp/emphasisHighlight.js
        const overlay = ensurePromptEmphasisHighlightOverlay(textarea);
        if (!overlay) return;
        overlay.innerHTML = highlightEmphasisForTextarea(textarea, textarea.value, this.resolveEmphasisWeightSource(fieldHint));
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
        const compiled = this.getDynamicGeneration().compiled_prompt;
        // buildRentanExpanderRowParts: public/scripts/comp/textReplacementManager.js
        const rentanFor = (key) => ({ rentanParts: buildRentanExpanderRowParts(key, compiled) });

        if (Array.isArray(seeds)) {
            seeds.forEach((seed, index) => {
                const key = seed.key || seed.name || `Replacement ${index + 1}`;
                resolvedKeys.add(key);
                this.expanders.appendChild(this.buildExpanderLockItem({ ...seed, ...rentanFor(key) }, index));
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
                    source: definition.source || '',
                    ...rentanFor(key)
                }, index));
            });
        }

        const dynamicTr = this.getDynamicGeneration()?.compiled_prompt?.text_replacements;
        if (dynamicTr && typeof dynamicTr === 'object') {
            this.appendDynamicTendaiRows(dynamicTr);
        }

        const hasExpanders = this.expanders.childElementCount > 0;
        const section = this.expandersSection || this.expanders?.closest('.image-prompt-inspector-section');
        if (section) {
            section.classList.toggle('hidden', !hasExpanders);
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
        const rentanParts = seed.rentanParts;
        if (rentanParts) item.classList.add('dynamic-replacement-type');

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
                ${rentanParts ? rentanParts.reasonHtml : ''}
            </div>
            <div class="text-replacement-lock-row">
                <div class="text-replacement-lock-badges">
                    <span class="text-replacement-badge text-replacement-badge-combined">
                        <span class="badge-icon-location" style="color: ${getLocationColor(source)};">${getLocationIcon(source)}</span>
                        ${characterBadge}
                        <span class="badge-icon-type" style="color: ${getReplacementTypeColor(seed.type)};">${getReplacementTypeIcon(seed.type)}</span>
                    </span>
                    ${rentanParts ? rentanParts.expiryHtml : ''}
                </div>
                <div class="text-replacement-lock-pattern">
                    ${rentanParts ? rentanParts.categoryHtml : ''}
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
            ['Source', compiled.source, 'fas fa-feather'],
            ['Summary', compiled.summary, 'fas fa-quote-left'],
            ...Object.entries(compiled.applied || {}).map(([control, line]) => [`Applied: ${this.formatLabel(control)}`, line, 'fas fa-check']),
            ['Expires', compiled.expiresAt ? new Date(compiled.expiresAt).toLocaleString() : null, 'fas fa-hourglass-half'],
            ['Wren Session', compiled.wren_session_id, 'fas fa-comments'],
            ['Generated Name', compiled.generated_image_name, 'fas fa-file-signature'],
            ['Timestamp', compiled.timestamp, 'fas fa-clock'],
            ['Prompt Hash', compiled.prompt_hash, 'fas fa-hashtag'],
            ['Request Hash', compiled.request_hash, 'fas fa-hashtag'],
            ['Directive Hash', compiled.directive_hash, 'fas fa-hashtag'],
            ['Usage', compiled.usage, 'fas fa-chart-simple']
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

        const context = compiled.context && typeof compiled.context === 'object' ? compiled.context : null;
        this.dynamicContext.replaceChildren();
        this.dynamicContext.classList.toggle('hidden', !context);
        if (context) {
            const metadata = this.metadata;
            // buildCompiledContextHtml: public/scripts/comp/compiledPromptInspector.js
            void featureLoader.loadFeature('compiled_prompt_inspector').then(() => {
                if (this.metadata !== metadata) return;
                this.dynamicContext.innerHTML = buildCompiledContextHtml(compiled);
            });
        }

        const hasDynamic = rows.length > 0 || !!context;
        const section = this.dynamicSection || this.dynamic?.closest('.image-prompt-inspector-section');
        if (section) {
            section.classList.toggle('hidden', !hasDynamic);
        }
        if (!hasDynamic) {
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
        body.textContent = this.formatValue(this.metadata);

        element.querySelector('.close-btn').addEventListener('click', () => {
            this.closeJsonWindow();
        });

        openModal(element);
        onModalOpened(element);
    }

    closeJsonWindow() {
        if (!this.jsonWindow) return;
        const element = this.jsonWindow;
        this.jsonWindow = null;
        closeModal(element).then(() => {
            onModalClosed(element);
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
            element.remove();
        }
        contextMenu.detachClickMenuFromElement(this.copyBtn);
        this.menuTitles.forEach((title) => contextMenu.detachClickMenuFromElement(title));
        this.promptWidthObserver.disconnect();
        // deregisterKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        deregisterKeyboardListener(`imagePromptInspector.find.${this.id}`);
        onModalClosed(this.element);
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
