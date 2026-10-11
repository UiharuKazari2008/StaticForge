// Global dryrun variable - set to true in console to enable dryrun mode
// Usage: window.directorDryrun = true;
// This will make all director requests use dryrun mode, saving request data to dryrun_output.json
// and returning mock responses without making actual API calls
window.directorDryrun = false;

const DIRECTOR_MAX_SESSION_MESSAGES = 200;
const DIRECTOR_ROW_PAGE = 40;
const DIRECTOR_TRAY_SESSIONS = 3;
// director_computer_status state -> the words in the tray title and tray menu.
// The keys double as the classes on #directorTrayIcon (public/css/director.css).
const DIRECTOR_TRAY_STATES = {
    idle: 'Dreamspace ready',
    working: 'Working',
    interrupted: 'Interrupted',
    failed: 'Last turn failed',
    offline: 'Dreamspace offline'
};
const DIRECTOR_TRAY_ICONS = {
    idle: 'fas fa-circle-check',
    working: 'fas fa-spinner',
    interrupted: 'fas fa-circle-pause',
    failed: 'fas fa-circle-exclamation',
    offline: 'fas fa-plug-circle-xmark'
};

const DIRECTOR_QUICK_STARTS = [
    {
        id: 'high-five',
        label: 'High Five',
        v45Only: true,
        title: 'Rewrite this V4.5 prompt for V5',
        prompt: 'This session is V4.5. Rewrite the prompt for V5 and set the Studio model to V5. Keep the same subject and scene. Use visual description V5 understands, and drop V4.5-only wording that does not carry over. Update the open Studio. Then call print_studio and wait for the new print. Look at that image and say what changed and whether it matches. Do not stop after the rewrite.'
    },
    {
        id: 'optimise',
        label: 'Optimise',
        title: 'Cohesion, duplicates, trained tags, and missing appearance',
        prompt: 'Optimise this prompt. Do a full pass on the session: make it cohesive, merge and remove duplicate descriptions, and switch vague wording to more direct visual terms when you can. If a character is only a name tag, add the appearance that is missing. Expand descriptions of things that are not showing up or do not match the picture. A low autofill count, or untrained:true, only means NovelAI autofill did not expose the tag. It is not proof the model never learned it. Test it before you drop it. Artist tags: try them before you drop them, and if search misses the name, look it up because the Danbooru tag may differ. Update the open Studio.'
    },
    {
        id: 'throwback',
        label: 'Throwback',
        title: 'Bring back an older idea from this workspace',
        prompt: 'Review previous generations in this workspace from oldest to newest. Find concepts that were used before and have not been done recently, then update the current prompt to try one of those older ideas again. Update the open Studio.'
    },
    {
        id: 'vacation',
        label: 'Vacation',
        title: 'Change the place and make the scene more interesting',
        prompt: 'Creatively change the prompt by changing the environment. Vividly update the scene so it is more interesting. Keep the characters. Update the open Studio.'
    },
    {
        id: 'makeover',
        label: 'Makeover',
        title: 'Change hair, clothes, and styling',
        prompt: 'Creatively change the prompt by updating the characters\' hair, clothes, and styling. Keep who they are and where they are. Update the open Studio.'
    },
    {
        id: 'friend',
        label: 'Friend',
        title: 'Add a related character',
        prompt: 'Add another character who is related to the current character, and update the prompt so they are in the picture together. Update the open Studio.'
    },
    {
        id: 'walk-forward',
        label: 'Walk Forward',
        existingOnly: true,
        title: 'Take the scene to the next moment',
        prompt: 'Walk the scene forward. Use this chat, the current picture, and what is already in Studio. Decide the next action, event, or scene yourself and make that picture. Do not ask what they want, do not offer choices, and do not wait. Apply the change and generate.'
    },
    {
        id: 'bbq',
        label: 'BBQ',
        needsSubject: true,
        title: 'Grill the prompt for everything this picture still leaves out',
        prompt: 'Grill this prompt against the picture. Use the open Studio, and if a picture is open or this chat already has one, use that generation too. Read the image and the current prompt. List every part of the picture the prompt does not cover: who is there, body, clothes, pose, expression, props, place, light, time, text, and what the scene is doing. Research what you can settle (character, series, look, tags) and write those into Studio. Do not spend a generation to discover a design. Then ask them the gaps that need their input: context, intent, and anything you cannot tell from the picture or the research. Ask those as direct questions. Do not generate until they answer.'
    }
];

// Xi is the repo agent, so its list is dev work, not picture work.
const DIRECTOR_XI_QUICK_STARTS = [
    {
        id: 'xi-ingest',
        label: 'Ingest Sweep',
        title: 'Pick up assigned Yozora issues',
        prompt: 'Run a Yozora ingest sweep. Pick up the open issues assigned to grok.cursor or labelled cursor-agent / cursor-take. Plan first, then work them inline or multitask. Follow the repo rules for locks, timers, labels, and Done comments. Stay off greg.'
    },
    {
        id: 'xi-fix-error',
        label: 'Fix Last Error',
        title: 'Find the newest error, fix it, and verify',
        prompt: 'Find the most recent error. Check the PM2 logs of the Dreamscape services and the bound client if it is reachable. Trace the cause in the code, fix it, verify the fix, and file or update the Yozora issue.'
    },
    {
        id: 'xi-test-client',
        label: 'Test on Client',
        title: 'Exercise the uncommitted client changes on the bound tab',
        prompt: 'Test the uncommitted client changes on the bound tab. Notify the service worker, call update_client, and restart only when it says readyForRestart. Then exercise each changed feature with inspect_elements and run_client_js. Report what passed and fix what failed.'
    },
    {
        id: 'xi-review-diff',
        label: 'Review Diff',
        title: 'Review the uncommitted diff for bugs and rule breaks',
        prompt: 'Review the uncommitted diff (git status, git diff). Look for bugs, broken callers, repo rule violations (keyboard characters, window. prefix, typeof function checks, retyped moves, copied CSS), dead code, and missing docs. Fix clear defects and ask about anything that needs a decision.'
    },
    {
        id: 'xi-ship',
        label: 'Ship Full Cycle',
        title: 'Commit, push, Done comments, close',
        prompt: 'Full cycle. Commit and push the finished work (take the already-dirty files too, never stash), post the Done comments with line counts, and close the Yozora issues this work covers. Stay off greg.'
    },
    {
        id: 'xi-review-wren',
        label: 'Review Wren',
        title: 'Fix what went wrong in Wren sessions and update the prompt guide',
        prompt: 'Review Wren\'s recent Director sessions. Find bugs, tool failures, and errors, trace each one in the code, fix it, and file or update a Yozora issue. Then update the prompt guide drafts from what worked and what failed in those sessions.'
    }
];

const DIRECTOR_REOPEN_KEY = 'staticforge_director_reopen';

const DIRECTOR_WELCOME_QUIPS = [
    'What are we making?',
    'Tell me the picture you want.',
    'A look, a change, or a new idea.',
    'Show me what to try next.'
];

function directorModelIsV45() {
    const selected = typeof getCurrentSelectedModel === 'function' ? getCurrentSelectedModel() : '';
    // normalizeStudioModelToken / resolveStudioModelKey: public/scripts/comp/utilities.js
    const known = typeof normalizeStudioModelToken === 'function' ? normalizeStudioModelToken(selected) : '';
    const meta = window.currentEditMetadata || {};
    const model = known || (typeof resolveStudioModelKey === 'function'
        ? resolveStudioModelKey({
            model: selected,
            source: meta.source || meta.Source || ''
        }, '')
        : String(selected || '').toLowerCase());
    return model === 'v4_5' || model.startsWith('v4_5');
}

function trimDirectorSessionMessages(messages, max = DIRECTOR_MAX_SESSION_MESSAGES) {
    if (!Array.isArray(messages) || messages.length <= max) {
        return messages;
    }
    return messages.slice(messages.length - max);
}

function assignTrimmedDirectorSessionMessages(session, messages) {
    if (!session || !Array.isArray(messages)) {
        return messages;
    }
    const beforeLen = messages.length;
    const capped = trimDirectorSessionMessages(messages);
    if (capped.length < beforeLen) {
        showGlassToast(
            'info',
            'Director',
            `Older messages were removed to keep this session at ${DIRECTOR_MAX_SESSION_MESSAGES} messages.`,
            false,
            6000
        );
    }
    session.messages = capped;
    return capped;
}

// Director Class - Encapsulates all director functionality
class Director {
    constructor() {
        // Director state
        this.directorSessions = [];
        this.currentSession = null;
        this.currentView = 'sessionChat';
        this.autoGenerateEnabled = false;
        this.messageFilter = 'all'; // 'chat', 'chat-tools', 'all'
        this._visibleRowCount = DIRECTOR_ROW_PAGE;
        this._hiddenOlderRows = 0;
        this._windowSessionId = null;
        this._expandedTrace = new Set();
        this._scrollAfterLoad = false;
        this._stickBottom = true;

        // Live search configuration
        this.enableLiveSearch = true; // Enable live search for character/series identification

        // Performance optimization: Cache DOM elements
        this._domCache = {};
        this._cacheDOMElements();

        // Performance optimization: Cache expensive objects
        this._dateFormatter = null;
        this._htmlEncoder = null;

        // Performance optimization: Debouncing with requestAnimationFrame
        this._renderSessionsFrameId = null;
        this._renderMessagesFrameId = null;

        // localStorage keys
        this.LAST_SESSION_KEY = 'staticforge_director_last_session';

        this.selectedEffort = 'medium';
        this.effortLevels = [
            { value: 'low', name: 'Low' },
            { value: 'medium', name: 'Medium' },
            { value: 'high', name: 'High' },
            { value: 'xhigh', name: 'Extra' }
        ];
        this.selectedModel = 'grok-4.7';
        this.modelCatalog = [];
        this._modelsRequested = 0;
        this.fast = false;
        this.sendOnEnter = false;
        this._running = false;
        this._runningSessionId = null;
        this._settledSessionId = null;
        this._outgoingQueue = [];
        this._steer = null;
        this.SESSION_MODEL_KEY = 'staticforge_director_session_models';
        // director_computer_status (modules/cursorDirector.js): tray icon state,
        // tray menu status line, and the computer's CPU / memory
        this._status = null;
        this.PREFS_KEY = 'staticforge_director_chat_prefs';
        this.loadChatPrefs();
        this.paintChatPrefs();
        this.loadModelCache();
        this.pendingAttachments = [];
        this._openPreferredId = null;
        this._xiEnabled = false;
        this._reopenAfterReload = this.takeReopenState();
        window.addEventListener('pagehide', () => this.saveReopenState());
        this.persona = 'wren';
        this._personaSession = { wren: null, xi: null };
    }

    // Cache DOM elements for better performance
    _cacheDOMElements() {
        const elements = {
            // Main director elements
            directorBtn: 'directorBtn',
            directorContainer: 'directorContainer',
            directorSessionList: 'directorSessionList',
            directorNewSession: 'directorNewSession',
            directorSessionChat: 'directorSessionChat',

            // Session list elements
            directorSessionsList: 'directorSessionsList',
            directorNewSessionBtn: 'directorNewSessionBtn',

            // New session elements
            directorMenuBtn: 'directorMenuBtn',
            directorModeSliderContainer: 'directorModeSliderContainer',
            directorUserIntent: 'directorUserIntent',
            directorImageSelectBtn: 'directorImageSelectBtn',
            directorImageRemoveBtn: 'directorImageRemoveBtn',
            directorImageFileInput: 'directorImageFileInput',
            directorMaxResolutionBtn: 'directorMaxResolutionBtn',
            directorCreateSessionBtn: 'directorCreateSessionBtn',
            directorNewSessionMessages: 'directorNewSessionMessages',

            // Chat elements
            directorSessionTitle: 'directorSessionTitle',
            directorTaskList: 'directorTaskList',
            directorMessageFilterGroup: 'directorMessageFilterGroup',
            directorPersonaGroup: 'directorPersonaGroup',
            directorModelPick: 'directorModelPick',
            directorRuntimePick: 'directorRuntimePick',
            directorModelPickName: 'directorModelPickName',
            directorModelPickEffort: 'directorModelPickEffort',
            directorAutoGenerateBtn: 'directorAutoGenerateBtn',
            directorChatMessages: 'directorChatMessages',
            directorToolsBtn: 'directorToolsBtn',
            directorAttachDropdown: 'directorAttachDropdown',
            directorAttachDropdownBtn: 'directorAttachDropdownBtn',
            directorAttachDropdownMenu: 'directorAttachDropdownMenu',
            directorAttachFileInput: 'directorAttachFileInput',
            directorAttachChips: 'directorAttachChips',
            directorChatInput: 'directorChatInput',
            directorComposerWelcome: 'directorComposerWelcome',
            directorSendBtn: 'directorSendBtn',

            // Preview elements
            directorSessionPreview: 'directorSessionPreview',
            directorSessionPreviewExpanded: 'directorSessionPreviewExpanded',
            directorSessionPreviewLarge: 'directorSessionPreviewLarge',

            // Common header elements
            directorCommonHeader: 'directorCommonHeader',
            directorHeaderTitle: 'directorHeaderTitle',
            directorHeaderTitleSessions: 'directorHeaderTitleSessions',
            directorSessionPreviewContainer: 'directorSessionPreviewContainer',
            directorSessionOverlayActions: 'directorSessionOverlayActions',

            // Desktop window + tray (public/app.html #directorWindow / #directorTrayIcon)
            directorWindow: 'directorWindow',
            directorWindowChat: 'directorWindowChat',
            directorWindowTitle: 'directorWindowTitle',
            directorBrowserPane: 'directorBrowserPane',
            directorBrowserPreview: 'directorBrowserPreview',
            directorSessionImagesPane: 'directorSessionImagesPane',
            directorSessionImages: 'directorSessionImages',
            directorTrayIcon: 'directorTrayIcon'
        };

        // Cache all elements
        Object.keys(elements).forEach(key => {
            this._domCache[key] = document.getElementById(elements[key]);
            // Create direct property for backward compatibility
            this[key] = this._domCache[key];
        });
    }

    // Optimized DOM query with caching
    _getCachedElement(id) {
        if (!this._domCache[id]) {
            this._domCache[id] = document.getElementById(id);
        }
        return this._domCache[id];
    }

    // Initialize Director
    async init() {
        this.setupDirectorDropdowns();
        this.setupDirectorEventListeners();
        this.setupDirectorContextMenus();
        this.setupDirectorWebSocketHandlers();
        this.setupDirectorWindow();
        initializeDirectorTray();
        this.requestDirectorModels();
        // public/scripts/websocket.js — runs after a dropped socket comes back, not on the first connect
        if (window.wsClient && window.wsClient.registerRefreshCallback) {
            window.wsClient.registerRefreshCallback('director_resume', 40, async () => {
                if (!window.directorInstance) return;
                await window.directorInstance.resumeAfterReconnect();
            });
        }
    }

    chatPrefsKey() {
        return this.persona === 'xi' ? `${this.PREFS_KEY}_xi` : this.PREFS_KEY;
    }

    // Setup dropdowns
    loadChatPrefs() {
        this.selectedEffort = 'medium';
        this.selectedModel = 'grok-4.7';
        this.selectedContext = '';
        this.thinking = false;
        this.fast = false;
        this.sendOnEnter = false;
        this.messageFilter = 'all';
        try {
            const raw = JSON.parse(localStorage.getItem(this.chatPrefsKey()) || '{}');
            if (typeof raw.effort === 'string' && raw.effort.trim()) this.selectedEffort = raw.effort.trim();
            if (typeof raw.model === 'string' && raw.model.trim()) this.selectedModel = raw.model.trim();
            if (typeof raw.context === 'string') this.selectedContext = raw.context;
            this.thinking = raw.thinking === true;
            this.fast = raw.fast === true;
            this.sendOnEnter = raw.sendOnEnter === true;
            if (raw.messageFilter === 'chat' || raw.messageFilter === 'chat-tools' || raw.messageFilter === 'all') {
                this.messageFilter = raw.messageFilter;
            }
        } catch (_err) { /* keep defaults */ }
    }

    saveChatPrefs() {
        try {
            localStorage.setItem(this.chatPrefsKey(), JSON.stringify({
                effort: this.selectedEffort,
                model: this.selectedModel,
                context: this.selectedContext || '',
                thinking: this.thinking === true,
                fast: this.fast === true,
                sendOnEnter: this.sendOnEnter === true,
                messageFilter: this.messageFilter || 'all'
            }));
        } catch (_err) { /* storage can be full */ }
        this.paintModelPick();
    }

    paintChatPrefs() {
        this.paintModelPick();
        this.paintMessageFilter();
    }

    modelSupportsFast() {
        return this.fastAvailable();
    }

    selectedFamily() {
        return this.modelCatalog.find((item) => item.id === this.selectedModel) || null;
    }

    effortsForSelected() {
        const family = this.selectedFamily();
        if (family) return Array.isArray(family.efforts) ? family.efforts : [];
        if (!this.modelCatalog.length) {
            return [
                { id: 'low', name: 'Low', fast: true },
                { id: 'medium', name: 'Medium', fast: true },
                { id: 'high', name: 'High', fast: true },
                { id: 'xhigh', name: 'Extra', fast: true }
            ];
        }
        return [];
    }

    contextsForSelected() {
        const family = this.selectedFamily();
        return family && Array.isArray(family.contexts) ? family.contexts : [];
    }

    thinkingToggle() {
        const family = this.selectedFamily();
        return !!(family && family.thinkingToggle && !this.effortsForSelected().length);
    }

    fastAvailable() {
        const family = this.modelCatalog.find((item) => item.id === this.selectedModel);
        const efforts = this.effortsForSelected();
        if (family && efforts.length) {
            const row = efforts.find((item) => item.id === this.selectedEffort) || efforts[0];
            return !!(row && row.fast);
        }
        if (family) return family.fast === true;
        return !this.modelCatalog.length;
    }

    modelProvider(model) {
        if (model && model.provider) return model.provider;
        const id = (model && model.id) || '';
        if (id === 'auto' || id.startsWith('grok') || id.startsWith('cursor-grok') || id.startsWith('composer')) return 'Cursor';
        if (id.startsWith('claude')) return 'Anthropic';
        if (id.startsWith('gpt') || id.indexOf('codex') !== -1) return 'OpenAI';
        if (id.startsWith('gemini')) return 'Google';
        if (id.startsWith('kimi')) return 'Moonshot';
        if (id.startsWith('muse')) return 'Meta';
        if (id.startsWith('glm')) return 'Z.ai';
        return 'Other';
    }

    modelMenuItems() {
        if (this.modelCatalog.length && !this.modelCatalog[0].provider) this._modelsRequested = 0;
        this.requestDirectorModels();
        const order = ['Cursor', 'Anthropic', 'OpenAI', 'Google', 'Moonshot', 'Meta', 'Z.ai', 'Other'];
        const models = (this.modelCatalog.length
            ? this.modelCatalog.slice()
            : [{ id: this.selectedModel || 'grok-4.7', name: this.selectedModelName(), provider: 'Cursor', cost: 2, price: '' }]
        ).sort((a, b) => {
            const ap = order.indexOf(this.modelProvider(a));
            const bp = order.indexOf(this.modelProvider(b));
            const ai = ap < 0 ? order.length : ap;
            const bi = bp < 0 ? order.length : bp;
            if (ai !== bi) return ai - bi;
            const released = (Number(b.released) || 0) - (Number(a.released) || 0);
            if (released) return released;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });
        const items = [];
        let provider = '';
        models.forEach((model) => {
            const group = this.modelProvider(model);
            if (group !== provider) {
                items.push({ separator: true, text: group });
                provider = group;
            }
            items.push({
                text: model.name,
                action: `director-tools-model-${model.id}`,
                dots: model.cost || 0,
                tooltip: model.price || '',
                showIndicator: true,
                loadfn: (item) => { item.checked = this.selectedModel === model.id; }
            });
        });
        return items;
    }

    selectedModelName() {
        const family = this.modelCatalog.find((item) => item.id === this.selectedModel);
        return family ? family.name : (this.selectedModel || 'Grok 4.7');
    }

    roundModelName(model) {
        if (!model) return '';
        const id = typeof model === 'string' ? model : (model.id || model.run || '');
        if (!id) return '';
        const family = this.modelCatalog.find((item) => item.id === id);
        return family ? family.name : id;
    }

    paintModelPick() {
        const auto = String(this.selectedModel || '').toLowerCase() === 'auto'
            || this.selectedModelName().trim().toLowerCase() === 'auto';
        if (this.directorModelPickName) {
            const family = this.modelCatalog.find((item) => item.id === this.selectedModel);
            this.directorModelPickName.textContent = auto ? 'Auto' : ((family && family.short) || this.selectedModelName());
            if (this.directorModelPick) this.directorModelPick.title = auto ? 'Model' : this.selectedModelName();
        }
        const effort = this.directorModelPickEffort;
        if (!effort) return;
        effort.className = 'uc-boxes';
        effort.textContent = '';
        effort.removeAttribute('data-uc-level');
        if (auto || this.thinkingToggle() || !this.effortsForSelected().length) {
            effort.classList.add('hidden');
            return;
        }
        const levels = this.effortsForSelected().filter((level) => level.id !== 'none');
        if (!levels.length) {
            effort.classList.add('hidden');
            return;
        }
        effort.classList.remove('hidden');
        const rank = this.selectedEffort === 'none'
            ? 0
            : Math.max(0, levels.findIndex((level) => level.id === this.selectedEffort) + 1);
        effort.dataset.ucLevel = String(rank);
        effort.title = this.selectedEffortName();
        levels.forEach((level, index) => {
            const dot = document.createElement('span');
            dot.className = 'uc-box';
            if (index < rank) dot.classList.add('on');
            dot.dataset.level = String(index + 1);
            effort.appendChild(dot);
        });
        if (this.fast === true && this.fastAvailable()) {
            const bolt = document.createElement('i');
            bolt.className = 'fas fa-bolt';
            bolt.setAttribute('aria-hidden', 'true');
            effort.appendChild(bolt);
        }
    }

    headerShowsControl(id) {
        const el = document.getElementById(id);
        if (!el || el.classList.contains('hidden')) return false;
        return getComputedStyle(el).display !== 'none';
    }

    modelPrefItems() {
        const director = this;
        return [
            {
                icon: 'fas fa-microchip',
                text: 'Model',
                valueDisplay: () => director.selectedModelName(),
                optionsfn: () => director.modelMenuItems()
            },
            {
                icon: 'fas fa-lightbulb',
                text: 'Thinking',
                hidden: () => director.effortsForSelected().length === 0,
                valueDisplay: () => director.selectedEffortName(),
                optionsfn: () => director.effortsForSelected().map((level) => ({
                    text: level.name,
                    action: `director-tools-effort-${level.id}`,
                    loadfn: (item) => { item.checked = director.selectedEffort === level.id; }
                }))
            },
            {
                icon: 'fas fa-lightbulb',
                text: 'Thinking',
                action: 'director-tools-thinking',
                keepMenuOpen: true,
                hidden: () => !director.thinkingToggle(),
                loadfn: (item) => { item.checked = director.thinking === true; }
            },
            {
                icon: 'fas fa-arrows-left-right',
                text: 'Context',
                hidden: () => director.contextsForSelected().length < 2,
                valueDisplay: () => director.selectedContextLabel(),
                optionsfn: () => director.contextsForSelected().map((slot) => ({
                    text: slot.label || slot.id,
                    action: `director-tools-context-${slot.id}`,
                    loadfn: (item) => { item.checked = (director.selectedContext || 'default') === slot.id; }
                }))
            },
            {
                icon: 'fas fa-bolt',
                text: 'Fast',
                action: 'director-tools-fast',
                keepMenuOpen: true,
                hidden: () => !director.modelSupportsFast(),
                loadfn: (item) => { item.checked = director.fast === true; }
            }
        ];
    }

    selectedEffortName() {
        const level = this.effortsForSelected().find((item) => item.id === this.selectedEffort);
        return level ? level.name : 'Medium';
    }

    selectedContextLabel() {
        const slots = this.contextsForSelected();
        const current = slots.find((slot) => slot.id === (this.selectedContext || 'default'));
        return current ? (current.label || current.id) : (slots[0] ? (slots[0].label || slots[0].id) : '');
    }

    composerIsFocused() {
        return !!(document.activeElement && this.directorChatInput && document.activeElement === this.directorChatInput);
    }

    stepEffort(direction) {
        const efforts = this.effortsForSelected();
        if (!efforts.length) return;
        let index = efforts.findIndex((level) => level.id === this.selectedEffort);
        if (index < 0) index = 0;
        const next = Math.max(0, Math.min(efforts.length - 1, index + direction));
        if (efforts[next].id === this.selectedEffort) return;
        this.selectedEffort = efforts[next].id;
        if (!this.fastAvailable()) this.fast = false;
        this.saveChatPrefs();
        this.rememberSessionModel();
        showGlassToast('info', 'Director', this.selectedEffortName(), false, 900, '<i class="fas fa-lightbulb"></i>');
    }

    handleComposerHotkey(event) {
        if (!event || event.isComposing || event.defaultPrevented) return false;
        if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === 'KeyN') {
            const node = event.target;
            const inDirector = !!(node && node.closest && node.closest('#directorWindow, #directorContainer'));
            const typingElsewhere = !!(node && (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT' || node.isContentEditable) && !inDirector);
            if (typingElsewhere || !this.directorSurfaceOpen()) return false;
            event.preventDefault();
            event.stopPropagation();
            void this.openNewSession();
            return true;
        }
        if (!this.composerIsFocused()) return false;
        const key = event.key;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            this.sendMessage();
            return true;
        }
        if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
            event.preventDefault();
            event.stopPropagation();
            this.stepEffort(key === 'ArrowUp' ? 1 : -1);
            return true;
        }
        return false;
    }

    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerComposerHotkeys() {
        const director = this;
        const active = () => director.composerIsFocused();
        registerKeyboardListener({
            id: 'director.composerHotkeys',
            handler: (event) => director.handleComposerHotkey(event),
            type: 'global',
            priority: 40,
            showInOverlay: false
        });
        [
            { id: 'director.hotkey.send', label: 'Send', keys: 'Ctrl+Enter', icon: 'fas fa-paper-plane' },
            { id: 'director.hotkey.newSession', label: 'New session', keys: 'Alt+N', icon: 'fas fa-plus', valid: () => director.directorSurfaceOpen() },
            { id: 'director.hotkey.reasoningUp', label: 'More reasoning', keys: 'Alt+Up', icon: 'fas fa-lightbulb' },
            { id: 'director.hotkey.reasoningDown', label: 'Less reasoning', keys: 'Alt+Down', icon: 'fas fa-lightbulb' }
        ].forEach((item) => {
            registerKeyboardListener({
                id: item.id,
                type: 'global',
                label: item.label,
                keys: item.keys,
                overlayIcon: item.icon,
                overlayOnly: true,
                overlayValid: item.valid || active
            });
        });
    }

    loadModelCache() {
        try {
            const raw = JSON.parse(localStorage.getItem('staticforge_director_models') || 'null');
            if (raw && Array.isArray(raw.models) && raw.models.length) this.modelCatalog = raw.models;
        } catch (_err) { /* keep the empty catalog */ }
    }

    saveModelCache() {
        try {
            localStorage.setItem('staticforge_director_models', JSON.stringify({
                at: Date.now(),
                models: this.modelCatalog
            }));
        } catch (_err) { /* storage can be full */ }
    }

    applyModelCatalog(models) {
        if (!Array.isArray(models) || !models.length) return;
        this.modelCatalog = models;
        this.saveModelCache();
        if (this.selectedModel !== 'auto' && !this.modelCatalog.some((item) => item.id === this.selectedModel)) {
            const grok = this.modelCatalog.find((item) => item.id === 'grok-4.7');
            this.selectedModel = grok ? grok.id : this.modelCatalog[0].id;
        }
        const efforts = this.effortsForSelected();
        if (efforts.length && !efforts.some((item) => item.id === this.selectedEffort)) {
            const medium = efforts.find((item) => item.id === 'medium');
            this.selectedEffort = medium ? medium.id : efforts[0].id;
        }
        if (!this.fastAvailable()) this.fast = false;
        this.saveChatPrefs();
    }

    requestDirectorModels() {
        if (!window.wsClient || !window.wsClient.isConnected()) return;
        if (this._modelsRequested && (Date.now() - this._modelsRequested) < 60000 && this.modelCatalog.length) return;
        this._modelsRequested = Date.now();
        window.wsClient.send({
            type: 'director_get_models',
            requestId: Date.now().toString()
        });
    }

    setupDirectorDropdowns() {
        setupDropdown(
            this.directorAttachDropdown,
            this.directorAttachDropdownBtn,
            this.directorAttachDropdownMenu,
            () => this.renderAttachDropdown(),
            () => null,
            { preventFocusTransfer: true }
        );
    }

    appendAttachMenuRow(label, iconClass, onRemove, item) {
        const row = document.createElement('div');
        row.className = 'custom-dropdown-option';
        const text = document.createElement('span');
        if (!item || !this.appendAttachmentPreview(text, item)) {
            const icon = document.createElement('i');
            icon.className = iconClass;
            text.appendChild(icon);
            text.appendChild(document.createTextNode(' '));
        }
        const name = document.createElement('span');
        name.textContent = label;
        text.appendChild(name);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-secondary btn-small';
        remove.title = 'Remove';
        remove.innerHTML = '<i class="fas fa-times"></i>';
        remove.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
        });
        row.appendChild(text);
        row.appendChild(remove);
        this.directorAttachDropdownMenu.appendChild(row);
    }

    renderAttachDropdown() {
        if (!this.directorAttachDropdownMenu) return;
        const options = [
            { id: 'computer', name: 'This computer', icon: 'fas fa-laptop' },
            { id: 'studio', name: 'Current image', icon: 'fas fa-image' },
            { id: 'explorer', name: 'Explorer selection', icon: 'fas fa-folder-open' }
        ];
        const lookbacks = this.lookbacksInComposer();
        this.directorAttachDropdownMenu.innerHTML = '';
        if (this.pendingAttachments.length || lookbacks.length) {
            const header = document.createElement('div');
            header.className = 'custom-dropdown-header';
            header.textContent = 'On this message';
            this.directorAttachDropdownMenu.appendChild(header);
            this.pendingAttachments.forEach((item, index) => {
                const label = item.name || item.filename || item.hash || 'file';
                this.appendAttachMenuRow(label, 'fas fa-paperclip', () => {
                    this.pendingAttachments.splice(index, 1);
                    this.renderAttachChips();
                    this.renderAttachDropdown();
                }, item);
            });
            lookbacks.forEach((item) => {
                this.appendAttachMenuRow(item.label || 'lookback', 'fas fa-link', () => {
                    this.removeLookback(item.markdown);
                });
            });
            const rule = document.createElement('div');
            rule.className = 'custom-dropdown-separator';
            this.directorAttachDropdownMenu.appendChild(rule);
        }
        options.forEach((option) => {
            const optionElement = document.createElement('div');
            optionElement.className = 'custom-dropdown-option';
            optionElement.innerHTML = `<i class="${option.icon}"></i> ${option.name}`;
            optionElement.addEventListener('click', () => {
                closeDropdown(this.directorAttachDropdownMenu, this.directorAttachDropdownBtn);
                this.chooseAttachmentSource(option.id);
            });
            this.directorAttachDropdownMenu.appendChild(optionElement);
        });
    }
    
    // Render functions

    setupDirectorContextMenus() {
        // Menus dispatch through config.onAction so they work in both hosts
        // (Studio panel and #directorWindow), not only while manualModal is open.
        this.directorSessionContextConfig = {
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            text: 'Fork',
                            icon: 'fas fa-code-branch',
                            action: 'director-fork-session'
                        },
                        {
                            icon: 'fas fa-planet-ringed',
                            text: 'Move to workspace',
                            optionsfn: (target) => this.sessionMoveWorkspaceOptions(target),
                            handlerfn: (option, target) => this.moveSessionToWorkspace(option, target)
                        },
                        {
                            text: 'Nuke session',
                            icon: 'fas fa-bomb',
                            action: 'director-nuke-session',
                            className: 'text-danger',
                            hidden: () => this.persona === 'xi'
                        },
                        {
                            text: 'Delete Session',
                            icon: 'fas fa-trash-alt',
                            action: 'director-delete-session',
                            className: 'text-danger'
                        }
                    ]
                }
            ],
            onAction: (action, target) => this.handleSessionContextAction(action, target)
        };
        this.directorMessageContextConfig = {
            sections: [
                {
                    type: 'list',
                    items: [
                        { text: 'Retry', icon: 'fas fa-rotate-right', action: 'director-message-retry' },
                        { text: 'Revert', icon: 'fas fa-undo', action: 'director-message-revert' },
                        { text: 'Fork', icon: 'fas fa-code-branch', action: 'director-message-fork' }
                    ]
                }
            ],
            onAction: (action, target) => this.handleMessageContextAction(action, target)
        };

        // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
        if (this.directorToolsBtn) {
            contextMenu.attachClickMenuToElement(this.directorToolsBtn, this.toolsMenuConfig());
        }
        if (this.directorModelPick) {
            // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
            contextMenu.attachClickMenuToElement(this.directorModelPick, {
                onAction: (action) => this.handleToolsAction(action),
                sections: [{ type: 'list', items: this.modelPrefItems() }]
            });
        }
        this.paintModelPick();
        if (this.directorRuntimePick) {
            this.directorRuntimePick.addEventListener('change', () => {
                this._nextXiRuntime = this.directorRuntimePick.value === 'claude' ? 'claude' : 'cursor';
            });
        }
    }

    sessionFromMenuTarget(target) {
        const sessionItem = target && target.closest ? target.closest('.director-session-item') : null;
        if (!sessionItem || !sessionItem.dataset.sessionId) return null;
        const sessionId = sessionItem.dataset.sessionId;
        let session = (this.directorSessions || []).find(s => s.id === sessionId);
        if (!session) {
            const numericSessionId = parseInt(sessionId, 10);
            session = (this.directorSessions || []).find(s => s.id === numericSessionId);
        }
        return session || null;
    }

    handleSessionContextAction(action, target) {
        const session = this.sessionFromMenuTarget(target);
        if (!session) return;
        this._suppressSessionOpenUntil = Date.now() + 400;
        if (action === 'director-fork-session') {
            this.forkSession(session);
            return;
        }
        if (action === 'director-nuke-session') {
            this.nukeSessionFromContextMenu(session);
            return;
        }
        if (action === 'director-delete-session') {
            this.deleteSessionFromContextMenu(session);
        }
    }

    async nukeSessionFromContextMenu(session) {
        if (!session || !session.id || typeof showConfirmationDialog !== 'function') return;
        if (this._running && this.currentSession && String(this.currentSession.id) === String(session.id)) {
            showGlassToast('error', 'Director', 'Director is still working on that chat');
            return;
        }
        try {
            const result = await showConfirmationDialog(
                `Nuke the context for "${session.name}"? The chat stays. The model starts blank and will not remember this conversation.`,
                [
                    { text: 'Nuke', value: true, className: 'btn-danger', icon: 'fas fa-bomb' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ]
            );
            if (!result) return;
            const body = await this.directorRequest('director_nuke_session', { sessionId: session.id });
            if (this.currentSession && String(body.sessionId) === String(this.currentSession.id)) {
                this.currentSession.contextPercent = 0;
                this.currentSession.contextTokens = 0;
            }
            showGlassToast('info', null, 'Session nuked', false, 2400, '<i class="fas fa-bomb"></i>');
        } catch (err) {
            showGlassToast('error', 'Director', err.message || 'Could not nuke the session');
        }
    }

    sessionMoveWorkspaceOptions(target) {
        const session = this.sessionFromMenuTarget(target);
        if (!session || typeof workspaces === 'undefined' || !workspaces) return [];
        const current = session.workspaceId || '';
        return Object.values(workspaces).filter((workspace) => workspace && workspace.id && workspace.id !== current).map((workspace) => {
            const color = /^#[0-9a-fA-F]{3,8}$/.test(workspace.color || '') ? workspace.color : '#6366f1';
            const name = this.escapeHtml(workspace.name || workspace.id);
            return {
                content: `<div class="workspace-option-content"><div class="workspace-color-indicator" style="background-color: ${color}"></div><div class="workspace-name">${name}</div></div>`,
                value: workspace.id,
                className: 'custom-dropdown-option'
            };
        });
    }

    moveSessionToWorkspace(option, target) {
        const session = this.sessionFromMenuTarget(target);
        const workspaceId = option && option.value;
        if (!session || !workspaceId) return;
        if (!window.wsClient || !window.wsClient.isConnected()) {
            showGlassToast('error', 'Director', 'WebSocket not connected');
            return;
        }
        window.wsClient.send({
            type: 'director_move_session',
            requestId: Date.now().toString(),
            persona: this.persona || 'wren',
            sessionId: session.id,
            workspaceId
        });
    }

    forkSession(session) {
        if (!session || !session.id) return;
        if (!window.wsClient || !window.wsClient.isConnected()) {
            showGlassToast('error', 'Director', 'WebSocket not connected');
            return;
        }
        window.wsClient.send({
            type: 'director_fork_session',
            requestId: Date.now().toString(),
            persona: this.persona || 'wren',
            sessionId: session.id
        });
    }

    handleMessageContextAction(action, target) {
        const row = target && target.closest ? target.closest('[data-message-key]') : null;
        const messageKey = row && row.dataset.messageKey;
        if (!messageKey) return;
        if (action === 'director-message-retry') {
            this.rollbackToMessage(messageKey, { retry: true, skipConfirm: true });
            return;
        }
        if (action === 'director-message-revert') {
            this.rollbackToMessage(messageKey, { retry: false, skipConfirm: false });
            return;
        }
        if (action === 'director-message-fork') this.forkFromMessage(messageKey);
    }

    attachMessageMenu(element) {
        if (!element || !contextMenu || !this.directorMessageContextConfig) return;
        contextMenu.attachToElement(element, this.directorMessageContextConfig);
    }

    forkFromMessage(messageKey) {
        if (!this.currentSession || !this.currentSession.id || !messageKey) return;
        if (!window.wsClient || !window.wsClient.isConnected()) {
            showGlassToast('error', 'Director', 'WebSocket not connected');
            return;
        }
        window.wsClient.send({
            type: 'director_fork_session',
            requestId: Date.now().toString(),
            persona: this.persona || 'wren',
            sessionId: this.currentSession.id,
            messageId: String(messageKey)
        });
    }

    // Cleanup / Reinstall / Prompt guide — shared by the session tools menu and the tray menu
    computerMenuItems() {
        return [
            { icon: 'fas fa-broom', text: 'Cleanup', action: 'director-tools-cleanup' },
            { icon: 'fas fa-arrows-rotate', text: 'Reinstall', action: 'director-tools-reinstall' },
            {
                icon: 'fas fa-book',
                text: 'Prompt guide',
                submenu: [
                    { icon: 'fas fa-code-compare', text: 'Review', action: 'director-tools-guide-review' },
                    { icon: 'fas fa-code-branch', text: 'Extract', action: 'director-tools-guide-extract' },
                    { icon: 'fas fa-code-commit', text: 'Commit', action: 'director-tools-guide-commit' },
                    { icon: 'fas fa-cloud-arrow-up', text: 'Push', action: 'director-tools-guide-push' }
                ]
            }
        ];
    }

    toolsMenuConfig() {
        const director = this;
        return {
            onAction: (action) => director.handleToolsAction(action),
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            icon: 'fas fa-plus',
                            text: 'New Session',
                            action: 'director-tools-new-session'
                        },
                        {
                            icon: 'fas fa-book-open',
                            text: 'Open Full History',
                            action: 'director-tools-history',
                            disabled: () => !director.currentSession
                        },
                        {
                            icon: 'fas fa-clapperboard',
                            text: 'Open Director',
                            action: 'director-tools-open-window',
                            hidden: () => !window.isDesktop || director.directorWindowIsOpen()
                        },
                        { separator: true },
                        ...director.computerMenuItems(),
                        { separator: true },
                        ...director.modelPrefItems().map((item) => {
                            const ownHidden = item.hidden;
                            return {
                                ...item,
                                hidden: () => director.headerShowsControl('directorModelPick') || (typeof ownHidden === 'function' && ownHidden())
                            };
                        }),
                        {
                            icon: 'fas fa-comments',
                            text: 'Show',
                            valueDisplay: () => {
                                if (director.messageFilter === 'chat') return 'Chat';
                                if (director.messageFilter === 'chat-tools') return 'Chat and tools';
                                return 'All';
                            },
                            submenu: [
                                {
                                    text: 'Chat',
                                    action: 'director-tools-filter-chat',
                                    loadfn: (item) => { item.checked = director.messageFilter === 'chat'; }
                                },
                                {
                                    text: 'Chat and tools',
                                    action: 'director-tools-filter-chat-tools',
                                    loadfn: (item) => { item.checked = director.messageFilter === 'chat-tools'; }
                                },
                                {
                                    text: 'All',
                                    action: 'director-tools-filter-all',
                                    loadfn: (item) => { item.checked = director.messageFilter === 'all'; }
                                }
                            ]
                        },
                        {
                            icon: 'fas fa-list',
                            text: 'Quick Tasks',
                            submenu: DIRECTOR_QUICK_STARTS.map((task) => ({
                                text: task.label,
                                action: `director-tools-task-${task.id}`,
                                hidden: () => director.persona === 'xi' || (task.v45Only && !directorModelIsV45()) || (task.existingOnly && !director.sessionHasHistory()) || (task.needsSubject && !director.hasGrillSubject())
                            })).concat(DIRECTOR_XI_QUICK_STARTS.map((task) => ({
                                text: task.label,
                                action: `director-tools-task-${task.id}`,
                                hidden: () => director.persona !== 'xi'
                            })))
                        },
                        { separator: true },
                        {
                            icon: 'fas fa-level-down-alt',
                            text: 'Send on Enter',
                            action: 'director-tools-send-enter',
                            keepMenuOpen: true,
                            loadfn: (item) => { item.checked = director.sendOnEnter === true; }
                        },
                        { separator: true },
                        {
                            icon: 'fas fa-rotate-right',
                            text: 'Retry',
                            action: 'director-tools-retry',
                            disabled: () => director._running || !director.lastUserMessageKey()
                        },
                        {
                            icon: 'fas fa-undo',
                            text: 'Revert',
                            action: 'director-tools-revert',
                            disabled: () => director._running || !director.lastUserMessageKey()
                        },
                        {
                            icon: 'fas fa-stop',
                            text: 'Abort',
                            action: 'director-tools-abort',
                            hidden: () => !director._running
                        },
                        {
                            icon: 'fas fa-trash',
                            text: 'Delete Chat',
                            action: 'director-tools-delete',
                            className: 'text-danger',
                            disabled: () => !director.currentSession || !director.currentSession.id
                        }
                    ]
                }
            ]
        };
    }

    handleToolsAction(action) {
        if (action.startsWith('director-tools-filter-')) {
            const filter = action.slice('director-tools-filter-'.length);
            if (filter === 'chat' || filter === 'chat-tools' || filter === 'all') this.setMessageFilter(filter);
            return;
        }
        if (action.startsWith('director-tools-model-')) {
            const id = action.slice('director-tools-model-'.length);
            if (!this.modelCatalog.some((model) => model.id === id) && id !== this.selectedModel) return;
            this.selectedModel = id;
            const efforts = this.effortsForSelected();
            if (efforts.length && !efforts.some((level) => level.id === this.selectedEffort)) {
                const medium = efforts.find((level) => level.id === 'medium') || efforts.find((level) => level.id === 'none');
                this.selectedEffort = medium ? medium.id : efforts[0].id;
            }
            if (!efforts.length) this.selectedEffort = 'medium';
            const contexts = this.contextsForSelected();
            if (contexts.length && !contexts.some((slot) => slot.id === this.selectedContext)) {
                this.selectedContext = contexts[0].id;
            }
            if (!contexts.length) this.selectedContext = '';
            if (!this.thinkingToggle()) this.thinking = this.selectedEffort !== 'none';
            if (!this.fastAvailable()) this.fast = false;
            this.saveChatPrefs();
            this.rememberSessionModel();
            return;
        }
        if (action.startsWith('director-tools-effort-')) {
            const value = action.slice('director-tools-effort-'.length);
            if (this.effortsForSelected().some((level) => level.id === value)) {
                this.selectedEffort = value;
                this.thinking = value !== 'none';
                if (!this.fastAvailable()) this.fast = false;
                this.saveChatPrefs();
                this.rememberSessionModel();
            }
            return;
        }
        if (action === 'director-tools-thinking') {
            this.thinking = this.thinking !== true;
            this.saveChatPrefs();
            this.rememberSessionModel();
            return;
        }
        if (action.startsWith('director-tools-context-')) {
            const value = action.slice('director-tools-context-'.length);
            if (this.contextsForSelected().some((slot) => slot.id === value)) {
                this.selectedContext = value;
                this.saveChatPrefs();
                this.rememberSessionModel();
            }
            return;
        }
        if (action.startsWith('director-tools-task-')) {
            const id = action.slice('director-tools-task-'.length);
            const task = this.quickStarts().find((item) => item.id === id);
            if (!task) return;
            if (!this.currentSession || this.currentSession.draft) {
                if (!this.currentSession) this.showNewSessionDraft();
                this.toggleQuickTask(task.id);
                return;
            }
            this.sendMessage(task.prompt);
            return;
        }
        if (action.startsWith('director-tray-session-')) {
            void this.openSessionInWindow(action.slice('director-tray-session-'.length));
            return;
        }
        switch (action) {
            case 'director-tray-open-running':
                void this.openSessionInWindow(this._runningSessionId || (this._status && this._status.sessionId));
                break;
            case 'director-tools-new-session':
                void this.openNewSession();
                break;
            case 'director-tools-history':
                this.openFullHistory();
                break;
            case 'director-tools-open-window':
                void this.openDirectorWindow();
                break;
            case 'director-tools-cleanup':
                void this.cleanupComputer();
                break;
            case 'director-tools-reinstall':
                void this.reinstallComputer();
                break;
            case 'director-tools-guide-review':
                void this.promptGuideReview();
                break;
            case 'director-tools-guide-extract':
                void this.promptGuideExtract();
                break;
            case 'director-tools-guide-commit':
                void this.promptGuideCommit();
                break;
            case 'director-tools-guide-push':
                void this.promptGuidePush();
                break;
            case 'director-tools-fast':
                if (!this.modelSupportsFast()) return;
                this.fast = !this.fast;
                this.saveChatPrefs();
                this.rememberSessionModel();
                break;
            case 'director-tools-send-enter':
                this.sendOnEnter = !this.sendOnEnter;
                this.saveChatPrefs();
                break;
            case 'director-tools-retry': {
                const retryKey = this.lastUserMessageKey();
                if (retryKey && this.revealMessageKey(retryKey)) this.retryMessage(retryKey);
                break;
            }
            case 'director-tools-revert': {
                const revertKey = this.lastUserMessageKey();
                if (revertKey && this.revealMessageKey(revertKey)) this.rollbackToMessage(revertKey);
                break;
            }
            case 'director-tools-abort':
                this.abortTurn();
                break;
            case 'director-tools-delete':
                this.deleteSession();
                break;
            default:
                break;
        }
    }

    lastUserMessageKey() {
        const messages = this.currentSession && Array.isArray(this.currentSession.messages) ? this.currentSession.messages : [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i];
            if (message && message.role === 'user') return String(message.id || message.timestamp || '');
        }
        return null;
    }

    revealMessageKey(messageKey) {
        if (!messageKey || !this.directorChatMessages) return false;
        if (this.directorChatMessages.querySelector(`[data-message-key="${messageKey}"]`)) return true;
        this._visibleRowCount = Math.max(this._visibleRowCount, 10000);
        this._doRenderSessionMessages(this._renderedMessages || (this.currentSession && this.currentSession.messages) || []);
        return !!this.directorChatMessages.querySelector(`[data-message-key="${messageKey}"]`);
    }

    abortTurn(keepRunning, options) {
        const sessionId = this.currentSession && this.currentSession.id;
        const steer = !!(options && options.steer);
        if (!sessionId || !this._running || this._runningSessionId !== sessionId) return;
        if (steer) this.freezeLiveTurn();
        if (!keepRunning) {
            this._running = false;
            this.updateTrayChrome();
        }
        if (!window.wsClient || !window.wsClient.isConnected()) return;
        // Server had no live run (director_abort_response aborted:false): nothing will end the turn, so end it here.
        this.directorRequest('director_abort', { sessionId, steer }).then((result) => {
            if (result && result.aborted === false && !steer) this.finishTurn(sessionId);
        }).catch(() => {
            if (!steer) this.finishTurn(sessionId);
        });
    }

    // Keep the in-progress rows where they are so the next turn appends under them.
    freezeLiveTurn() {
        const live = this.directorChatMessages && this.directorChatMessages.querySelector('.director-live-turn');
        if (!live) return;
        live.classList.remove('director-live-turn');
        live.classList.add('director-settled-turn');
        delete live.dataset.liveTurn;
    }

    readSessionModel(sessionId) {
        if (!sessionId) return null;
        try {
            const all = JSON.parse(localStorage.getItem(this.SESSION_MODEL_KEY) || '{}');
            const row = all[sessionId];
            if (!row || typeof row.model !== 'string' || !row.model.trim()) return null;
            return {
                id: row.model.trim(),
                effort: row.effort || 'medium',
                fast: row.fast === true,
                context: row.context || '',
                thinking: row.thinking === true
            };
        } catch (_err) {
            return null;
        }
    }

    rememberSessionModel(sessionId) {
        const id = sessionId || (this.currentSession && this.currentSession.id);
        if (!id) return;
        const choice = {
            id: this.selectedModel || 'auto',
            effort: this.selectedEffort || 'medium',
            fast: this.fast === true,
            context: this.selectedContext || '',
            thinking: this.thinking === true
        };
        if (this.currentSession && this.currentSession.id === id) this.currentSession.choice = choice;
        try {
            const all = JSON.parse(localStorage.getItem(this.SESSION_MODEL_KEY) || '{}');
            all[id] = {
                model: choice.id,
                effort: choice.effort,
                fast: choice.fast,
                context: choice.context || '',
                thinking: choice.thinking === true
            };
            localStorage.setItem(this.SESSION_MODEL_KEY, JSON.stringify(all));
        } catch (_err) { /* storage can be full */ }
    }

    choiceFromMessages(messages) {
        const list = Array.isArray(messages) ? messages : [];
        for (let i = list.length - 1; i >= 0; i--) {
            const model = list[i] && list[i].model;
            if (model && typeof model === 'object' && model.id) {
                return {
                    id: String(model.id),
                    effort: model.effort || 'medium',
                    fast: model.fast === true,
                    context: model.context || '',
                    thinking: model.thinking === true
                };
            }
        }
        return null;
    }

    applySessionModel(session) {
        if (!session || session.draft || !session.id) {
            this.selectedModel = 'auto';
            this.selectedEffort = 'medium';
            this.selectedContext = '';
            this.thinking = false;
            this.fast = false;
            this.paintModelPick();
            return;
        }
        const choice = this.readSessionModel(session.id) || session.choice || this.choiceFromMessages(session.messages);
        this.selectedModel = choice && choice.id ? choice.id : 'auto';
        this.selectedEffort = choice && choice.effort ? choice.effort : 'medium';
        this.selectedContext = choice && choice.context ? choice.context : '';
        this.thinking = !!(choice && choice.thinking);
        this.fast = !!(choice && choice.fast);
        if (!this.fastAvailable()) this.fast = false;
        this.paintModelPick();
    }

    takeComposerAttachments() {
        const attachments = this.pendingAttachments.map((item) => {
            const copy = { ...item };
            delete copy.preview;
            return copy;
        });
        this.pendingAttachments = [];
        return attachments;
    }

    clearComposer() {
        if (this.directorChatInput) {
            this.directorChatInput.value = '';
            this.autoExpandTextarea(this.directorChatInput);
        }
        this.pendingAttachments = [];
        this._selectedQuickTaskId = null;
        this.renderAttachChips();
    }

    queuedForSession(sessionId) {
        return (this._outgoingQueue || []).filter((item) => item && item.sessionId === sessionId);
    }

    renderQueueChip() {
        if (!this.directorAttachChips) return;
        this.directorAttachChips.querySelectorAll('[data-queue-chip]').forEach((el) => el.remove());
        const sessionId = this.currentSession && this.currentSession.id;
        const rows = sessionId ? this.queuedForSession(sessionId) : [];
        if (!rows.length) return;
        const chip = document.createElement('div');
        chip.className = 'director-attach-chip';
        chip.dataset.queueChip = '1';
        chip.title = rows.length === 1 ? 'Queued' : `Queued ${rows.length}`;
        const icon = document.createElement('i');
        icon.className = 'fas fa-layer-group';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-secondary btn-small';
        remove.title = 'Clear queued messages';
        remove.innerHTML = '<i class="fas fa-times"></i>';
        remove.addEventListener('click', () => {
            this._outgoingQueue = (this._outgoingQueue || []).filter((item) => item.sessionId !== sessionId);
            this.renderQueueChip();
        });
        chip.appendChild(icon);
        chip.appendChild(remove);
        this.directorAttachChips.appendChild(chip);
    }

    afterTurn(sessionId) {
        if (!sessionId) return;
        if (this._steer && this._steer.sessionId === sessionId) {
            const job = this._steer;
            this._steer = null;
            if (this.currentSession && this.currentSession.id === sessionId) this.dispatchOutgoing(job);
            return;
        }
        const next = (this._outgoingQueue || []).find((item) => item && item.sessionId === sessionId);
        if (!next) return;
        this._outgoingQueue = this._outgoingQueue.filter((item) => item !== next);
        this.renderQueueChip();
        if (this.currentSession && this.currentSession.id === sessionId) this.dispatchOutgoing(next);
    }

    lastSessionStorageKey() {
        return this.persona === 'xi' ? 'staticforge_director_last_session_xi' : this.LAST_SESSION_KEY;
    }

    packetPersona(body) {
        return (body && body.persona) || 'wren';
    }

    paintPersonaToggle() {
        const group = this.directorPersonaGroup;
        const persona = this.persona === 'xi' ? 'xi' : 'wren';
        const showXi = this._xiEnabled === true && this.directorWindowIsOpen();
        if (group) {
            group.classList.toggle('hidden', !showXi);
            group.dataset.persona = persona;
            group.querySelectorAll('.gallery-toggle-btn').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.persona === persona);
            });
        }
        [this.directorCommonHeader, this.directorContainer, this.directorWindow].forEach((el) => {
            if (el) el.dataset.persona = persona;
        });
        if (persona !== 'xi') return;
        this._selectedQuickTaskId = null;
        this.removeQuickStart();
        this.hideBrowserPreview();
        if (this.directorSessionPreviewExpanded) this.directorSessionPreviewExpanded.classList.add('hidden');
        if (this.directorSessionPreviewContainer) this.directorSessionPreviewContainer.classList.add('hidden');
        if (this.directorSessionImagesPane) {
            this.directorSessionImagesPane.classList.add('hidden');
            if (this.directorSessionImages) this.directorSessionImages.innerHTML = '';
        }
    }

    noteXiEnabled(enabled) {
        const on = enabled === true;
        this._xiEnabled = on;
        if (!on && this.persona === 'xi') this.setPersona('wren');
        this.paintPersonaToggle();
        return false;
    }

    // Studio always opens Wren. Xi is only the desktop Director window.
    resetToWren() {
        if (this.persona !== 'xi') {
            this.paintPersonaToggle();
            return;
        }
        this.saveChatPrefs();
        if (this.currentSession && !this.currentSession.draft && this.currentSession.id) {
            this._personaSession.xi = this.currentSession.id;
        }
        this.persona = 'wren';
        this.loadChatPrefs();
        this.paintChatPrefs();
        this.currentSession = null;
        window.currentSession = null;
        this.paintPersonaToggle();
    }

    async setPersona(name) {
        if (name === 'xi' && (!this._xiEnabled || !this.directorWindowIsOpen())) return;
        const next = name === 'xi' ? 'xi' : 'wren';
        if (next === this.persona) {
            this.paintPersonaToggle();
            return;
        }
        this.saveChatPrefs();
        this._personaSession[this.persona] = this.currentSession && !this.currentSession.draft ? this.currentSession.id : null;
        this.persona = next;
        this.loadChatPrefs();
        this.paintChatPrefs();
        this.paintPersonaToggle();
        this.currentSession = null;
        window.currentSession = null;
        try { await this.loadDirectorSessions(); } catch (_) { /* list refresh is best effort */ }
        const remembered = this._personaSession[next];
        const found = remembered && (this.directorSessions || []).find((item) => item.id === remembered);
        if (found) await this.showSessionChat(found);
        else this.showNewSessionDraft();
    }

    async openToolPayload(row) {
        const title = (row && (row.label || row.name)) || 'Tool';
        const local = [];
        if (row && row.args) local.push(`Parameters\n${row.args}`);
        if (row && row.result) local.push(`Result\n${row.result}`);
        const id = row && (row.payloadId || row.diffId);
        const sessionId = this.currentSession && this.currentSession.id;
        if (id && sessionId) {
            try {
                const result = await this.directorRequest('director_tool_payload', { sessionId, payloadId: id, diffId: row.diffId || '' });
                const parts = [];
                if (result.args) parts.push(`Parameters\n${result.args}`);
                if (result.result) parts.push(`Result\n${result.result}`);
                if (!parts.length && result.text) parts.push(result.text);
                this.showDirectorText(result.name || title, parts.join('\n\n') || '(empty)', result.detail || 'Read-only');
                return;
            } catch (err) {
                if (!local.length) {
                    showGlassToast('error', 'Director', err.message || 'Could not open that tool');
                    return;
                }
            }
        }
        this.showDirectorText(title, local.join('\n\n') || '(empty)', 'Read-only');
    }

    async openToolDiff(sessionId, diffId, title) {
        try {
            const result = await this.directorRequest('director_tool_diff', { sessionId, diffId });
            this.showDirectorText(title || 'Change', result.text || '(empty)', result.detail || 'Read-only');
        } catch (err) {
            showGlassToast('error', 'Director', err.message || 'Could not open that change');
        }
    }

    finishTurn(sessionId) {
        if (sessionId && this._runningSessionId && sessionId !== this._runningSessionId) return;
        this._settledSessionId = sessionId || this._runningSessionId;
        this._turnPrints = 0;
        this._running = false;
        this._runningSessionId = null;
        // First-send handoff is over: an empty reload can replace the local bubble.
        this._skipQuickStart = false;
        this.updateTrayChrome();
        this.setImagePending(false);
        this.afterTurn(sessionId);
    }

    historyEntries() {
        const messages = this.currentSession && Array.isArray(this.currentSession.messages) ? this.currentSession.messages : [];
        const entries = [];
        messages.forEach((message) => {
            if (!message) return;
            if (message.role === 'user') {
                entries.push({ kind: 'You', text: String(message.user_input || message.content || '') });
                return;
            }
            if (Array.isArray(message.trace) && message.trace.length) {
                message.trace.forEach((row) => {
                    if (!row) return;
                    const kind = row.type === 'thinking' ? 'Thinking' : (row.type === 'tool' ? (row.label || row.name || 'Tool') : 'Director');
                    const text = row.type === 'tool'
                        ? [row.label || row.name, row.detail || row.text].filter(Boolean).join('\n')
                        : String(row.text || '');
                    if (text) entries.push({ kind, text: String(text) });
                });
                return;
            }
            const description = message.data && message.data.Description;
            const text = description || message.content || '';
            if (text) entries.push({ kind: 'Director', text: String(text) });
        });
        const live = this.directorChatMessages && this.directorChatMessages.querySelector('.director-live-turn');
        if (live) {
            live.querySelectorAll('.director-message').forEach((row) => {
                const badge = row.querySelector('.director-request-type-badge');
                const body = row.querySelector('.director-message-content');
                const text = body ? body.textContent.trim() : '';
                if (!text) return;
                entries.push({ kind: badge ? badge.textContent.trim() : 'Live', text });
            });
        }
        return entries;
    }

    createHistoryWindow() {
        const modal = document.createElement('div');
        modal.id = 'directorHistoryWindow';
        modal.className = 'modal hidden transient resizeable-window';
        modal.dataset.windowIdentifier = 'directorHistory';
        modal.dataset.windowDefaultWidth = '980';
        modal.dataset.windowDefaultHeight = '720';
        modal.dataset.windowMinWidth = '640';
        modal.dataset.windowMinHeight = '420';
        modal.dataset.windowMaxWidth = '1400';
        modal.dataset.windowMaxHeight = '1000';
        // transientWindowsWithPositions: public/scripts/comp/modalUtils.js
        transientWindowsWithPositions.add('directorHistory');
        modal.innerHTML = `
            <div class="modal-window-title">
                <div class="modal-window-title-main">
                    <i class="fas fa-book-open"></i>
                    <span class="director-history-title">Director History</span>
                </div>
            </div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize">
                    <i class="fa-regular fa-window-minimize"></i>
                </button>
                <button type="button" class="btn-danger close-btn btn-small" title="Close">
                    <i class="fa-regular fa-xmark-large"></i>
                </button>
            </div>
            <div class="modal-content dark">
                <div class="director-history-list form-section-scroll"></div>
                <div class="director-history-reader form-section-scroll"></div>
            </div>
        `;
        modal.querySelector('.close-btn').addEventListener('click', () => {
            // closeModal: public/scripts/comp/modalUtils.js
            closeModal(modal);
        });
        modal.querySelector('.minimize-btn').addEventListener('click', () => {
            // minimizeModalProgrammatically: public/scripts/comp/modalUtils.js
            minimizeModalProgrammatically(modal);
        });
        return modal;
    }

    historyHost(pane) {
        return pane.querySelector('.scrollable-content') || pane;
    }

    showHistoryEntry(modal, entries, index) {
        const listHost = this.historyHost(modal.querySelector('.director-history-list'));
        const readHost = this.historyHost(modal.querySelector('.director-history-reader'));
        const chosen = entries[index] || null;
        listHost.querySelectorAll('.director-history-item').forEach((button, itemIndex) => {
            button.dataset.selected = itemIndex === index ? '1' : '0';
        });
        readHost.innerHTML = '';
        if (!chosen) {
            const empty = document.createElement('div');
            empty.className = 'director-message-content';
            empty.textContent = 'This chat has no messages yet.';
            readHost.appendChild(empty);
            return;
        }
        const badge = document.createElement('span');
        badge.className = 'director-request-type-badge';
        badge.textContent = chosen.kind;
        const body = document.createElement('div');
        body.className = 'director-message-content director-history-text';
        body.textContent = chosen.text;
        readHost.appendChild(badge);
        readHost.appendChild(body);
    }

    fillHistoryWindow(modal) {
        const entries = this.historyEntries();
        const listHost = this.historyHost(modal.querySelector('.director-history-list'));
        listHost.innerHTML = '';
        let selected = Math.max(0, entries.length - 1);
        for (let i = entries.length - 1; i >= 0; i--) {
            if (entries[i].kind === 'Thinking') {
                selected = i;
                break;
            }
        }
        entries.forEach((entry, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-secondary director-history-item';
            button.dataset.selected = index === selected ? '1' : '0';
            const kind = document.createElement('span');
            kind.className = 'director-request-type-badge';
            kind.textContent = entry.kind;
            const preview = document.createElement('span');
            preview.className = 'director-history-preview';
            const line = entry.text.replace(/\s+/g, ' ').trim();
            preview.textContent = line.length > 90 ? `${line.slice(0, 87)}…` : line;
            button.appendChild(kind);
            button.appendChild(preview);
            button.addEventListener('click', () => this.showHistoryEntry(modal, entries, index));
            listHost.appendChild(button);
        });
        this.showHistoryEntry(modal, entries, entries.length ? selected : -1);
    }

    openFullHistory() {
        if (!this.currentSession) return;
        let modal = document.getElementById('directorHistoryWindow');
        if (!modal) {
            modal = this.createHistoryWindow();
            document.body.appendChild(modal);
        }
        const title = modal.querySelector('.director-history-title');
        if (title) title.textContent = this.currentSession.name || 'Director History';
        this.fillHistoryWindow(modal);
        // openModal: public/scripts/comp/modalUtils.js
        openModal(modal);
        modal.querySelectorAll('.form-section-scroll').forEach((pane) => {
            // updateScrollbar: public/scripts/comp/customScrollbar.js
            window.customScrollbar.updateScrollbar(pane);
        });
    }

    // Delete session (context menu version)
    async deleteSessionFromContextMenu(session) {
        if (typeof showConfirmationDialog !== 'function') {
            return;
        }

        try {
            const wasCurrent = !!(this.currentSession && this.currentSession.id && this.currentSession.id === session.id);
            const result = await showConfirmationDialog(
                `Are you sure you want to delete the session "${session.name}"?`,
                [
                    { text: 'Delete', value: true, className: 'btn-danger', icon: 'fas fa-trash' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ]
            );
            if (result) {
                this._deleteWasCurrent = wasCurrent;
                this._deleteTargetId = session.id;
                if (wasCurrent) {
                    const lastSessionId = localStorage.getItem(this.lastSessionStorageKey());
                    if (lastSessionId === session.id) localStorage.removeItem(this.lastSessionStorageKey());
                }
                if (window.wsClient && window.wsClient.isConnected()) {
                    window.wsClient.send({
                        type: 'director_delete_session',
                        requestId: Date.now().toString(),
                        sessionId: session.id,
                        persona: this.persona || 'wren'
                    });
                }
            }
        } catch (error) {
            return;
        }
    }

    // Set message filter
    setMessageFilter(filter) {
        this.messageFilter = filter;
        this.paintMessageFilter();
        this.saveChatPrefs();
    }

    paintMessageFilter() {
        const filter = this.messageFilter || 'all';
        if (this.directorMessageFilterGroup) {
            this.directorMessageFilterGroup.dataset.filter = filter;
        }
        const buttons = this.directorMessageFilterGroup?.querySelectorAll('.gallery-toggle-btn');
        if (buttons) {
            buttons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.filter === filter);
            });
        }
        this.applyMessageFilter();
    }

    // Apply message filter to current messages
    applyMessageFilter() {
        if (!this.directorChatMessages) return;
        const messages = this.directorChatMessages.querySelectorAll('.director-message, .director-message-captions');
        
        messages.forEach(message => {
            let shouldShow = true;
            const isThinking = message.classList.contains('thinking');
            const isTool = message.classList.contains('tool');
            const pinned = message.dataset.quickStart === '1' || message.dataset.older === '1';
            switch (this.messageFilter) {
                case 'chat':
                    shouldShow = pinned || (!isThinking && !isTool);
                    break;
                case 'chat-tools':
                    shouldShow = pinned || !isThinking;
                    break;
                case 'all':
                default:
                    shouldShow = true;
                    break;
            }
            
            if (shouldShow) {
                message.classList.remove('hidden');
            } else {
                message.classList.add('hidden');
            }
        });
    }

    // Setup event listeners
    setupDirectorEventListeners() {
        if (this._directorEventsWired) {
            return;
        }
        this._directorEventsWired = true;

        // Director toggle button
        if (this.directorBtn) {
        this.directorBtn.addEventListener('click', () => this.toggleDirector());
        }


        // Menu buttons
        if (this.directorMenuBtn) {
            this.directorMenuBtn.addEventListener('click', () => this.toggleSessionOverlay());
        }
        const printsToggle = document.getElementById('directorSessionImagesToggle');
        if (printsToggle) {
            printsToggle.addEventListener('click', () => this.togglePrintsPane());
        }

        // New session button in overlay
        if (this.directorNewSessionBtn) {
            this.directorNewSessionBtn.addEventListener('click', () => {
                this.closeSessionOverlay();
                void this.openNewSession();
            });
        }

        // Chat buttons
        if (this.directorSendBtn) {
            this.directorSendBtn.addEventListener('click', () => this.sendMessage());
        }

        this.registerComposerHotkeys();

        const workspaceSwitchBtn = document.getElementById('directorWorkspaceSwitchBtn');
        if (workspaceSwitchBtn) {
            workspaceSwitchBtn.addEventListener('click', () => {
                const meta = this.sessionWorkspaceMeta(this.currentSession);
                if (!meta) return;
                this.jumpToWorkspace(meta.id).then(() => this.paintWorkspaceBanner());
            });
        }

        // Auto-generate toggle button
        if (this.directorAutoGenerateBtn) {
            this.directorAutoGenerateBtn.addEventListener('click', () => this.toggleAutoGenerate());
        }


        // Max resolution toggle
        if (this.directorMaxResolutionBtn) {
        this.directorMaxResolutionBtn.addEventListener('click', () => {
            const isActive = this.directorMaxResolutionBtn.getAttribute('data-state') === 'on';
            this.updateIndicator(this.directorMaxResolutionBtn, !isActive);
        });
        }

        // Add base image toggle
        if (this.directorAddBaseImageToggleBtn) {
        this.directorAddBaseImageToggleBtn.addEventListener('click', () => {
            const isActive = this.directorAddBaseImageToggleBtn.getAttribute('data-state') === 'on';
            this.updateIndicator(this.directorAddBaseImageToggleBtn, !isActive);
        });
        }

        // Add high thinking toggle
        if (this.directorHighThinkingToggleBtn) {
            this.directorHighThinkingToggleBtn.addEventListener('click', () => {
                const isActive = this.directorHighThinkingToggleBtn.getAttribute('data-state') === 'on';
                this.updateIndicator(this.directorHighThinkingToggleBtn, !isActive);
            });
        }

        // Message filter toggle
        if (this.directorMessageFilterGroup) {
            this.directorMessageFilterGroup.addEventListener('click', (e) => {
                const button = e.target.closest('.gallery-toggle-btn');
                if (button) {
                    this.setMessageFilter(button.dataset.filter);
                }
            });
        }

        if (this.directorPersonaGroup) {
            this.directorPersonaGroup.addEventListener('click', (e) => {
                const button = e.target.closest('.gallery-toggle-btn');
                if (!button || !button.dataset.persona) return;
                this.setPersona(button.dataset.persona);
            });
            this.paintPersonaToggle();
        }

        if (this.directorSessionChat) {
            this.directorSessionChat.addEventListener('animationend', (e) => {
                if (e.animationName === 'director-composer-fade-in') this.directorSessionChat.classList.remove('director-composer-fade');
            });
        }

        // Auto-expand textarea
        if (this.directorChatInput) {
        this.directorChatInput.addEventListener('input', (e) => {
            this.autoExpandTextarea(e.target);
            this.renderAttachChips();
            if (this.directorAttachDropdownMenu && !this.directorAttachDropdownMenu.classList.contains('hidden')) {
                this.renderAttachDropdown();
            }
        });
        this.directorChatInput.addEventListener('focus', (e) => this.autoExpandTextarea(e.target));
        this.directorChatInput.addEventListener('keydown', (e) => {
            if (this.handleComposerHotkey(e)) return;
            if (!this.sendOnEnter || e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
            e.preventDefault();
            this.sendMessage();
        });
        }
        if (this.directorAttachFileInput) {
            this.directorAttachFileInput.addEventListener('change', (e) => {
                this.addComputerFiles(e.target.files);
                e.target.value = '';
            });
        }

        // One listener for every compact log row, live and replayed (createTraceRow)
        if (this.directorChatMessages) {
            this.directorChatMessages.addEventListener('click', (e) => {
                const link = e.target.closest('a[href^="http://"], a[href^="https://"]');
                if (link && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                    e.preventDefault();
                    // openGrimoireUrl: public/scripts/comp/featureLoader.js
                    void openGrimoireUrl(link.href);
                    return;
                }
                const toggle = e.target.closest('.director-compact-toggle');
                if (!toggle) return;
                const row = toggle.closest('.director-message');
                if (!row) return;
                row.classList.toggle('expanded');
                row.dataset.autoOpen = '0';
                const key = row.dataset.expandKey;
                if (!key) return;
                if (row.classList.contains('expanded')) this._expandedTrace.add(key);
                else this._expandedTrace.delete(key);
            });
        }
    }

    autoExpandTextarea(targetTextarea = null) {
        // Handle both directorChatInput and directorUserIntent
        const textareas = [];

        if (targetTextarea) {
            textareas.push(targetTextarea);
        } else {
            if (this.directorChatInput) textareas.push(this.directorChatInput);
            if (this.directorUserIntent) textareas.push(this.directorUserIntent);
        }

        textareas.forEach(textarea => {
            if (!textarea) return;
            const chat = textarea.id === 'directorChatInput';
            // A stretched flex height makes scrollHeight the panel, not the text.
            textarea.style.height = '0px';
            const scrollHeight = textarea.scrollHeight;
            const minHeight = chat ? 36 : 32;
            const maxHeight = chat ? 120 : 320;
            const next = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
            textarea.style.height = next + 'px';
            textarea.style.overflowY = next >= maxHeight ? 'auto' : 'hidden';
        });
    }

    // Studio Director button: focus the desktop window when it is open, otherwise toggle the panel
    toggleDirector() {
        if (this.directorWindowIsOpen()) {
            this.focusDirectorWindow();
            return;
        }
        const isVisible = !this.directorContainer.classList.contains('hidden');
        if (isVisible) {
            this.hideDirector();
        } else {
            this.showDirector();
        }
    }

    // ---- Desktop window host (#directorWindow) ----

    directorWindowIsOpen() {
        return !!(this.directorWindow
            && !this.directorWindow.classList.contains('hidden')
            && !this.directorWindow.classList.contains('closing'));
    }

    directorDockedInWindow() {
        return !!(this.directorWindowChat && this.directorContainer
            && this.directorContainer.parentNode === this.directorWindowChat);
    }

    // Wide #directorWindow keeps the session list open as a static left panel.
    // The breakpoint lives in the director-window container query (public/css/director.css).
    staticSessionPanel() {
        if (!this.directorContainer || !this.directorDockedInWindow()) return false;
        return getComputedStyle(this.directorContainer).getPropertyValue('--director-static-sessions').trim() === '1';
    }

    focusDirectorWindow() {
        if (!this.directorWindow) return;
        if (this.directorWindow.classList.contains('minimised')) {
            // restoreMinimizedModal: public/scripts/comp/modalUtils.js
            restoreMinimizedModal(this.directorWindow, null);
        }
        // bringModalToFront: public/scripts/comp/modalUtils.js
        bringModalToFront(this.directorWindow);
    }

    setupDirectorWindow() {
        if (!this.directorWindow || this._directorWindowWired) return;
        this._directorWindowWired = true;
        const closeBtn = this.directorWindow.querySelector('.modal-window-controls .close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeDirectorWindow());
        }
    }

    mountDirectorInWindow() {
        if (!this.directorWindowChat || !this.directorContainer || this.directorDockedInWindow()) return;
        if (this._hideTimer) {
            clearTimeout(this._hideTimer);
            this._hideTimer = null;
        }
        if (this.directorCommonHeader) {
            this.directorWindowChat.appendChild(this.directorCommonHeader);
            this.directorCommonHeader.classList.remove('hidden');
        }
        this.directorWindowChat.appendChild(this.directorContainer);
        this.directorContainer.classList.remove('hidden', 'director-closed');
        this.directorContainer.classList.add('director-open');
        this.updateHeaderForView(this.currentView);
        this.renderSessionImages();
    }

    mountDirectorInStudio() {
        if (!this.directorDockedInWindow()) return;
        // #manualPresetGroup follows the Director block in the Studio form column (public/app.html)
        const anchor = document.getElementById('manualPresetGroup');
        if (!anchor || !anchor.parentNode) return;
        if (this.directorCommonHeader) {
            anchor.parentNode.insertBefore(this.directorCommonHeader, anchor);
            this.directorCommonHeader.classList.add('hidden');
        }
        anchor.parentNode.insertBefore(this.directorContainer, anchor);
        // The Studio panel stays closed until the Director button opens it again
        this.directorContainer.classList.remove('director-open');
        this.directorContainer.classList.add('director-closed', 'hidden');
        if (this.directorAutoGenerateBtn) {
            this.directorAutoGenerateBtn.classList.add('hidden');
        }
        this.updateIndicator(this.directorBtn, false);
        this.hideBrowserPreview();
        this.renderSessionImages();
    }

    async openDirectorWindow() {
        if (!this.directorWindow) return;
        if (this.directorWindowIsOpen()) {
            this.focusDirectorWindow();
            this.paintPersonaToggle();
            if (this._resumeImage || this._lookupImageChat || this._openPreferredId) await this.openCurrentSession();
            return;
        }
        this.resetToWren();
        const panelOpen = this.directorContainer && !this.directorContainer.classList.contains('hidden')
            && !this.directorDockedInWindow();
        if (panelOpen) {
            this.hideDirector();
        }
        this.mountDirectorInWindow();
        this._windowOpenedOnce = true;
        this.fadeInComposer();
        // openModal: public/scripts/comp/modalUtils.js
        openModal(this.directorWindow);
        this.paintPersonaToggle();
        this.requestDirectorModels();
        this.updateTrayChrome();
        // The wide layout shows the session list without the hamburger, so it has to be filled
        this.loadDirectorSessions();
        await this.openCurrentSession();
        this.initializeScrollbars();
        this.scrollToBottom();
    }

    // A reload of this tab (restart_client, Update, F5) reopens the window in the same persona and chat.
    // sessionStorage is per tab, so other tabs and a fresh login start closed.
    saveReopenState() {
        if (!this.directorWindowIsOpen()) {
            sessionStorage.removeItem(DIRECTOR_REOPEN_KEY);
            return;
        }
        const sessionId = this.currentSession && !this.currentSession.draft ? this.currentSession.id : null;
        sessionStorage.setItem(DIRECTOR_REOPEN_KEY, JSON.stringify({ persona: this.persona, sessionId }));
    }

    takeReopenState() {
        const raw = sessionStorage.getItem(DIRECTOR_REOPEN_KEY);
        sessionStorage.removeItem(DIRECTOR_REOPEN_KEY);
        try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
    }

    // Runs on the first director status, once Xi is known to be on or off.
    async reopenAfterReload(saved) {
        if (saved.persona === 'xi' && this._xiEnabled) {
            this._personaSession.xi = saved.sessionId || null;
            await this.openDirectorWindow();
            await this.setPersona('xi');
            return;
        }
        if (saved.persona !== 'xi' && saved.sessionId) this._openPreferredId = saved.sessionId;
        await this.openDirectorWindow();
    }

    // Close hides the window only. The agent keeps running and the session stays loaded.
    closeDirectorWindow() {
        if (!this.directorWindow) return;
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(this.directorWindow);
        this.mountDirectorInStudio();
        this.resetToWren();
        this.updateTrayChrome();
    }

    // ---- Tray icon (#directorTrayIcon), same pattern as Phasewalker ----

    // idle | working | interrupted | failed | offline, as the server named it.
    // A local turn always wins so the icon moves before the push lands.
    trayState() {
        if (this._running) return 'working';
        const state = this._status && this._status.state;
        return DIRECTOR_TRAY_STATES[state] ? state : 'idle';
    }

    trayStateLabel() {
        const state = this.trayState();
        const words = DIRECTOR_TRAY_STATES[state];
        if (state === 'working') {
            const name = (this._status && this._status.sessionName) || this.runningSessionName();
            return name ? `${words} · ${name}` : words;
        }
        if (state === 'offline') {
            const computer = this._status && this._status.computer;
            return computer && computer.error ? `${words} · ${computer.error}` : words;
        }
        const last = this._status && this._status.last;
        return last && last.error ? `${words} · ${last.error}` : words;
    }

    runningSessionName() {
        const id = this._runningSessionId || (this._status && this._status.sessionId);
        if (!id) return '';
        const session = (this.directorSessions || []).find((item) => String(item.id) === String(id));
        return session ? (session.name || 'Director') : '';
    }

    // Three most recent chats, server order, with the running one marked
    trayRecentSessions() {
        const fromStatus = this._status && Array.isArray(this._status.sessions) ? this._status.sessions : null;
        const rows = fromStatus && fromStatus.length
            ? fromStatus
            : (this.directorSessions || []).slice(0, DIRECTOR_TRAY_SESSIONS);
        const currentId = this.currentSession && this.currentSession.id;
        return rows.slice(0, DIRECTOR_TRAY_SESSIONS).map((row) => ({
            id: row.id,
            name: row.name || 'Director',
            current: String(row.id) === String(currentId)
        }));
    }

    // formatBytes: public/scripts/comp/systemTrayManager.js
    trayResourceLine() {
        const resources = this._status && this._status.resources;
        if (!resources) return 'Dreamspace idle';
        const cpu = Number.isFinite(Number(resources.cpu)) ? `${Number(resources.cpu).toFixed(0)}% CPU` : 'CPU unknown';
        const rss = Number.isFinite(Number(resources.rss)) ? formatBytes(Number(resources.rss)) : 'unknown';
        return resources.live ? `${cpu} · ${rss}` : `${cpu} · ${rss} (last run)`;
    }

    trayResourceBreakdown() {
        const resources = this._status && this._status.resources;
        const rows = resources && Array.isArray(resources.processes) ? resources.processes : [];
        if (!rows.length) {
            return [{ text: 'No agent processes', disabled: true }];
        }
        const items = rows.map((row) => ({
            text: `${row.name || 'process'} · ${Number(row.cpu || 0).toFixed(0)}% · ${formatBytes(Number(row.rss) || 0)}`,
            disabled: true
        }));
        if (Number(resources.count) > rows.length) {
            items.push({ text: `+${Number(resources.count) - rows.length} more`, disabled: true });
        }
        return items;
    }

    buildTrayMenuItems() {
        const director = this;
        const state = this.trayState();
        const items = [
            { icon: DIRECTOR_TRAY_ICONS[state], text: this.trayStateLabel(), disabled: true },
            { separator: true },
            { icon: 'fas fa-clapperboard', text: 'Open', action: 'director-tools-open-window' }
        ];
        if (state === 'working') {
            items.push({
                icon: 'fas fa-person-running',
                text: 'Open current session',
                action: 'director-tray-open-running'
            });
        }
        const recent = this.trayRecentSessions();
        if (recent.length) {
            items.push({ separator: true, text: 'Recent' });
            recent.forEach((session) => {
                items.push({
                    icon: session.current ? 'fas fa-circle-dot' : 'fas fa-comment',
                    text: session.name,
                    action: `director-tray-session-${session.id}`,
                    loadfn: (item) => { item.checked = session.current; }
                });
            });
        }
        items.push({ separator: true });
        items.push({
            icon: 'fas fa-microchip',
            text: 'Resources',
            valueDisplay: () => director.trayResourceLine(),
            submenu: this.trayResourceBreakdown()
        });
        items.push({ separator: true });
        items.push(...this.computerMenuItems());
        return items;
    }

    buildTrayMenuConfig() {
        const director = this;
        return {
            maxHeight: 460,
            beforeShow: () => {
                director.refreshTrayMenuItems();
                // One read per open. No interval anywhere.
                director.requestDirectorStatus();
            },
            sections: [{ type: 'list', title: 'Director', items: [] }],
            onAction: (action) => director.handleToolsAction(action)
        };
    }

    refreshTrayMenuItems() {
        if (!this.trayMenuConfig || !this.trayMenuConfig.sections[0]) return;
        this.trayMenuConfig.sections[0].items = this.buildTrayMenuItems();
    }

    reRenderTrayMenuIfOpen() {
        // contextMenu.renderMenu: public/scripts/comp/contextMenu.js
        if (!contextMenu || !contextMenu.isOpen || contextMenu.currentTarget !== this.directorTrayIcon) return;
        this.refreshTrayMenuItems();
        contextMenu.renderMenu(this.trayMenuConfig, this.directorTrayIcon);
        contextMenu.executeLoadFunctions(this.trayMenuConfig, this.directorTrayIcon);
        contextMenu.updateIndicatorDots(this.trayMenuConfig);
    }

    setupTray() {
        // contextMenu.attachToElement: public/scripts/comp/contextMenu.js
        if (!this.directorTrayIcon) return;
        this.trayMenuConfig = this.buildTrayMenuConfig();
        contextMenu.attachToElement(this.directorTrayIcon, this.trayMenuConfig);
        this.directorTrayIcon.addEventListener('click', (e) => {
            e.preventDefault();
            void this.openDirectorWindow();
        });
        this.directorTrayIcon.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            void this.openDirectorWindow();
        });
        this.requestDirectorStatus();
        this.updateTrayChrome();
    }

    updateTrayChrome() {
        if (!this.directorTrayIcon || !window.isDesktop) return;
        // Stays hidden while the Studio panel is the only UI; shows once the window
        // opened, a run started, or a turn left something for the user to look at.
        // An offline computer stays hidden — hosts without bubblewrap never use it.
        const reported = this._status && this._status.state;
        if (this._windowOpenedOnce || this._running
            || reported === 'working' || reported === 'interrupted' || reported === 'failed') {
            this._trayRevealed = true;
        }
        // isDesktopTrayBootPending: public/scripts/comp/trayIndicators.js
        if (this._trayRevealed && !isDesktopTrayBootPending()) {
            this.directorTrayIcon.classList.remove('hidden');
        } else if (!this._trayRevealed) {
            this.directorTrayIcon.classList.add('hidden');
        }
        const state = this.trayState();
        Object.keys(DIRECTOR_TRAY_STATES).forEach((name) => {
            this.directorTrayIcon.classList.toggle(name, name !== 'idle' && name === state);
        });
        this.directorTrayIcon.title = `Director — ${this.trayStateLabel()}`;
        this.reRenderTrayMenuIfOpen();
    }

    requestDirectorStatus() {
        if (!window.wsClient || !window.wsClient.isConnected()) return;
        window.wsClient.send({
            type: 'director_computer_status',
            requestId: Date.now().toString()
        });
    }

    // Push (director_computer_status) and read (…_response) land here. It never
    // clears _running — director_message_response / _error own the local turn.
    applyDirectorStatus(status) {
        if (!status || typeof status !== 'object') return;
        this._status = status;
        this.updateTrayChrome();
        this.noteCursorLogin(status.cursorLogin);
        const personaChanged = !!(status.xi && typeof status.xi.enabled === 'boolean' && this.noteXiEnabled(status.xi.enabled));
        if (this._reopenAfterReload) {
            const saved = this._reopenAfterReload;
            this._reopenAfterReload = null;
            void this.reopenAfterReload(saved);
        }
        if (this._resumeFromStatus) {
            this._resumeFromStatus = false;
            if (personaChanged) {
                this.loadDirectorSessions().then(() => this.continueAfterReconnect(status)).catch(() => this.continueAfterReconnect(status));
            } else {
                this.continueAfterReconnect(status);
            }
            return;
        }
        if (personaChanged) {
            this.currentSession = null;
            window.currentSession = null;
            this.loadDirectorSessions().then(() => {
                const xiRunning = status.xi && status.xi.running && status.xi.sessionId;
                if (this.persona === 'xi' && xiRunning) {
                    this.showSessionChat({
                        id: status.xi.sessionId,
                        name: status.xi.sessionName || 'Xi',
                        messages: [],
                        tasks: []
                    });
                    return;
                }
                const remembered = this._personaSession[this.persona];
                const found = remembered && (this.directorSessions || []).find((item) => item.id === remembered);
                if (found) this.showSessionChat(found);
                else if (this.directorSurfaceOpen()) this.showNewSessionDraft();
            }).catch(() => {});
        }
        const openId = this.currentSession && !this.currentSession.draft ? this.currentSession.id : null;
        const xiRunningId = status.xi && status.xi.running ? status.xi.sessionId : null;
        const runningHere = (status.running && status.sessionId && openId === status.sessionId)
            || (xiRunningId && openId === xiRunningId);
        if (runningHere) this._settledSessionId = null;
        if (runningHere && !this._running) {
            this._running = true;
            this._runningSessionId = xiRunningId && openId === xiRunningId ? xiRunningId : status.sessionId;
            this.updateTrayChrome();
            this.showTypingIndicator();
        }
    }

    // Dropped socket: the first-send guard would ignore the reload, and a live
    // turn's completion was sent to the old socket. Pull sessions and messages,
    // then let the status packet decide whether the turn is still going.
    async resumeAfterReconnect() {
        this._skipQuickStart = false;
        this._resumeFromStatus = true;
        try {
            await this.loadDirectorSessions();
        } catch (_err) { /* list refresh is best effort */ }
        const openId = this.currentSession && !this.currentSession.draft ? this.currentSession.id : null;
        if (openId) this.loadSessionMessages(openId);
        this.requestDirectorStatus();
        this.requestCursorUsage();
    }

    continueAfterReconnect(status) {
        const useXi = this.persona === 'xi';
        const xi = status && status.xi;
        const runningId = useXi
            ? (xi && xi.running && xi.sessionId ? xi.sessionId : null)
            : (status && status.running && status.sessionId ? status.sessionId : null);
        const runningName = useXi ? (xi && xi.sessionName) : (status && status.sessionName);
        const openId = this.currentSession && !this.currentSession.draft ? this.currentSession.id : null;
        const unsentDraft = !!(this._pendingOutgoing && !openId);
        if (runningId) {
            this._creatingChat = false;
            this._running = true;
            this._runningSessionId = runningId;
            this._settledSessionId = null;
            this.updateTrayChrome();
            if (unsentDraft || openId === runningId) {
                this._pendingOutgoing = null;
                if (openId !== runningId) {
                    this.showSessionChat({
                        id: runningId,
                        name: runningName || (useXi ? 'Xi' : 'Director'),
                        messages: [],
                        tasks: []
                    }, { skipLoad: true });
                }
                this.loadSessionMessages(runningId);
                this.showTypingIndicator();
            }
            return;
        }
        this._creatingChat = false;
        if (this._running) this.finishTurn(this._runningSessionId);
        this.hideTypingIndicator();
        if (unsentDraft) {
            this.restorePendingOutgoing();
            return;
        }
        if (openId) this.loadSessionMessages(openId);
    }

    // The jail copies the host Cursor login at server startup. When that login
    // is missing or a turn comes back unauthorized, ask them to log in on the host.
    noteCursorLogin(login) {
        if (!login || login.ok !== false) {
            this._loginNotice = null;
            return;
        }
        if (this._loginNotice === login.reason) return;
        this._loginNotice = login.reason;
        const text = login.reason === 'expired'
            ? 'Cursor login expired. On this machine run cursor-agent login, then try again.'
            : 'Cursor is not logged in. On this machine run cursor-agent login, then try again.';
        showGlassToast('error', 'Director', text, false, 8000);
    }

    // Tray session rows and "Open current session" both land in #directorWindow,
    // never in the Studio panel. openCurrentSession consumes _openPreferredId.
    async openSessionInWindow(sessionId) {
        if (!sessionId) return;
        this._openPreferredId = sessionId;
        if (this.directorWindowIsOpen()) {
            this.focusDirectorWindow();
            await this.openCurrentSession();
            return;
        }
        await this.openDirectorWindow();
    }

    // ---- Browser pane (desktop window only) ----

    showBrowserPreview(payload) {
        if (this.persona === 'xi') return;
        if (!payload || !this.directorBrowserPane || !this.directorBrowserPreview) return;
        if (!this.directorWindowIsOpen() || !this.directorDockedInWindow()) return;
        const chatId = payload.chatId || payload.sessionId;
        if (!chatId || !this.currentSession || String(chatId) !== String(this.currentSession.id)) return;
        const filename = payload.filename || '';
        const src = payload.url || `/director/browser/${encodeURIComponent(chatId)}/${encodeURIComponent(filename)}`;
        this.directorBrowserPreview.src = src;
        this.directorBrowserPane.classList.remove('hidden');
    }

    hideBrowserPreview() {
        if (!this.directorBrowserPane) return;
        this.directorBrowserPane.classList.add('hidden');
        if (this.directorBrowserPreview) this.directorBrowserPreview.removeAttribute('src');
    }

    // ---- Session prints (desktop window only) ----

    // chat.images on the Director session (modules/cursorDirector.js), oldest first
    sessionImageFilenames() {
        const images = this.currentSession && this.currentSession.images;
        return Array.isArray(images) ? images.filter((name) => typeof name === 'string' && name) : [];
    }

    sessionPrints() {
        const prints = this.currentSession && this.currentSession.prints;
        if (Array.isArray(prints) && prints.length) {
            return prints.map((item) => {
                if (typeof item === 'string') return { filename: item, messageId: '' };
                return item && item.filename ? { filename: item.filename, messageId: item.messageId || '' } : null;
            }).filter(Boolean);
        }
        return this.sessionImageFilenames().map((filename) => ({ filename, messageId: '' }));
    }

    markPrintMessage(messageId, on) {
        if (!messageId || !this.directorChatMessages) return;
        this.directorChatMessages.querySelectorAll(`[data-message-key="${CSS.escape(String(messageId))}"]`).forEach((node) => {
            if (on) node.dataset.linked = '1';
            else delete node.dataset.linked;
        });
    }

    attachPrintToComposer(filename) {
        if (!filename) return;
        if (!this.pendingAttachments.some((item) => item && item.filename === filename)) {
            this.pendingAttachments.push({ source: 'workspace', filename, name: filename });
            this.renderAttachChips();
        }
        if (this.directorChatInput) this.directorChatInput.focus();
    }

    wirePrintMenu(element, filename, messageId) {
        if (!element || !filename || !contextMenu) return;
        const director = this;
        contextMenu.attachToElement(element, {
            sections: [{
                type: 'list',
                items: [
                    { text: 'Open', icon: 'fas fa-images', action: 'open-print' },
                    { text: 'Show on message', icon: 'fas fa-comment', action: 'show-print', disabled: !messageId },
                    { text: 'Attach to message', icon: 'fas fa-paperclip', action: 'attach-print' },
                    { separator: true },
                    { text: 'Recycle session', icon: 'fas fa-recycle', action: 'recycle-session', disabled: () => director._running }
                ]
            }],
            onAction: (action) => {
                if (action === 'open-print') director.openSessionImage(filename);
                if (action === 'attach-print') director.attachPrintToComposer(filename);
                if (action === 'recycle-session') director.recycleSession(filename);
                if (action === 'show-print' && messageId) {
                    const node = director.directorChatMessages
                        && director.directorChatMessages.querySelector(`[data-message-key="${CSS.escape(String(messageId))}"]`);
                    if (node) {
                        node.scrollIntoView({ block: 'nearest' });
                        director.markPrintMessage(messageId, true);
                    }
                }
            }
        });
    }

    ensurePrintBubble(host, filename, messageId) {
        if (!host || !filename) return;
        let row = host.querySelector('.director-message-actions[data-prints]');
        if (!row) {
            row = document.createElement('div');
            row.className = 'director-message-actions';
            row.dataset.prints = '1';
            host.appendChild(row);
        }
        if (row.querySelector(`[data-filename="${CSS.escape(filename)}"]`)) return;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'director-attach-chip';
        chip.dataset.filename = filename;
        chip.title = filename;
        const preview = document.createElement('img');
        preview.className = 'director-session-preview';
        preview.alt = filename;
        preview.src = this.getSessionPreviewImage({ filename, image_type: 'generated' });
        preview.addEventListener('error', () => {
            // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
            const full = localGalleryImageUrl(filename);
            if (preview.dataset.fullTried === '1' || !full) return;
            preview.dataset.fullTried = '1';
            preview.src = full;
        });
        chip.appendChild(preview);
        chip.addEventListener('click', (event) => {
            event.stopPropagation();
            this.openSessionImage(filename);
        });
        this.wirePrintMenu(chip, filename, messageId);
        row.appendChild(chip);
    }

    mountPrintBubble(messageId, filename) {
        if (!this.directorChatMessages || !filename) return;
        let host = null;
        if (messageId) {
            const nodes = this.directorChatMessages.querySelectorAll(`[data-message-key="${CSS.escape(String(messageId))}"]`);
            host = nodes.length ? nodes[nodes.length - 1] : null;
        }
        if (!host) host = this.directorChatMessages.querySelector('.director-live-turn');
        if (!host) return;
        if (messageId && host.classList.contains('director-live-turn')) host.dataset.messageKey = messageId;
        this.ensurePrintBubble(host, filename, messageId);
    }

    paintMessagePrints(messages) {
        const groups = new Map();
        (messages || []).forEach((message) => {
            if (!message || !message.id || !Array.isArray(message.prints)) return;
            groups.set(String(message.id), message.prints.filter((name) => typeof name === 'string' && name));
        });
        this.sessionPrints().forEach((print) => {
            if (!print.messageId) return;
            const list = groups.get(String(print.messageId)) || [];
            if (!list.includes(print.filename)) list.push(print.filename);
            groups.set(String(print.messageId), list);
        });
        groups.forEach((files, id) => {
            files.forEach((filename) => this.mountPrintBubble(id, filename));
        });
    }

    mountInlineForm(spec) {
        if (!this.directorChatMessages || !spec || !spec.id) return null;
        if (this.directorChatMessages.querySelector(`[data-form-id="${CSS.escape(spec.id)}"]`)) {
            return this.directorChatMessages.querySelector(`[data-form-id="${CSS.escape(spec.id)}"]`);
        }
        const host = document.createElement('div');
        host.className = 'director-message director-row-arrive';
        host.dataset.formId = spec.id;
        const live = this.directorChatMessages.querySelector('.director-live-turn');
        const typing = this.directorChatMessages.querySelector('.director-typing-indicator');
        const before = typing || live;
        if (before) this.directorChatMessages.insertBefore(host, before);
        else this.directorChatMessages.appendChild(host);
        this.scrollToBottom();
        return host;
    }

    setImagePending(pending) {
        const next = pending === true;
        if (this._imagePending === next) return;
        this._imagePending = next;
        this.renderSessionImages();
    }

    togglePrintsPane() {
        if (!this.directorSessionImagesPane) return;
        this.directorSessionImagesPane.classList.toggle('is-collapsed');
        this.paintPrintsToggle();
    }

    paintPrintsToggle() {
        const btn = document.getElementById('directorSessionImagesToggle');
        const pane = this.directorSessionImagesPane;
        if (!btn || !pane) return;
        const collapsed = pane.classList.contains('is-collapsed');
        const icon = btn.querySelector('i');
        if (icon) icon.className = collapsed ? 'fas fa-chevron-left' : 'fas fa-chevron-right';
        btn.title = collapsed ? 'Show prints' : 'Hide prints';
    }

    renderSessionImages() {
        if (this.persona === 'xi') {
            if (this.directorSessionImagesPane) this.directorSessionImagesPane.classList.add('hidden');
            if (this.directorSessionImages) this.directorSessionImages.innerHTML = '';
            return;
        }
        if (!this.directorSessionImagesPane || !this.directorSessionImages) return;
        if (window.customScrollbar && window.customScrollbar.scrollbars && window.customScrollbar.scrollbars.has(this.directorSessionImages)) {
            window.customScrollbar.destroy(this.directorSessionImages);
        }
        const filenames = this.directorDockedInWindow() ? this.sessionImageFilenames() : [];
        const pending = this._imagePending === true && this.directorDockedInWindow();
        if (!filenames.length && !pending) {
            this.directorSessionImagesPane.classList.add('hidden');
            this.directorSessionImages.innerHTML = '';
            return;
        }
        this.directorSessionImagesPane.classList.remove('hidden');
        this.directorSessionImages.innerHTML = '';
        const fragment = document.createDocumentFragment();
        if (pending) {
            const waiting = document.createElement('div');
            waiting.className = 'director-session-preview pending';
            waiting.title = 'Waiting for the print';
            waiting.innerHTML = '<i class="fas fa-spinner-third fa-spin"></i>';
            fragment.appendChild(waiting);
        }
        const prints = this.sessionPrints().slice().reverse();
        prints.forEach((print) => {
            const filename = print.filename;
            const thumb = document.createElement('img');
            thumb.className = 'director-session-preview';
            thumb.alt = filename;
            thumb.title = filename;
            if (print.messageId) thumb.dataset.messageKey = print.messageId;
            thumb.src = this.getSessionPreviewImage({ filename, image_type: 'generated' });
            // The preview webp is written after the print, so fall back to the full file
            thumb.addEventListener('error', () => {
                // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
                const full = localGalleryImageUrl(filename);
                if (thumb.dataset.fullTried === '1' || !full) return;
                thumb.dataset.fullTried = '1';
                thumb.src = full;
            });
            thumb.addEventListener('click', () => this.openSessionImage(filename));
            thumb.addEventListener('mouseenter', () => this.markPrintMessage(print.messageId, true));
            thumb.addEventListener('mouseleave', () => this.markPrintMessage(print.messageId, false));
            this.wirePrintMenu(thumb, filename, print.messageId);
            fragment.appendChild(thumb);
        });
        this.directorSessionImages.appendChild(fragment);
        this.paintPrintsToggle();
        this.initializeScrollbars();
    }

    // director_recycle_session: next turn is a fresh Cursor chat from this print (modules/cursorDirector.js)
    async recycleSession(filename) {
        const sessionId = this.currentSession && this.currentSession.id;
        if (!sessionId || this._running) return;
        try {
            const result = await this.directorRequest('director_recycle_session', { sessionId, filename });
            this.noteSessionRecycled({ sessionId, filename: result.filename });
        } catch (err) {
            showGlassToast('error', 'Director', err.message || 'Could not recycle the session');
        }
    }

    // director_recycle_session_response
    noteSessionRecycled(payload) {
        if (!payload || !this.currentSession || String(payload.sessionId) !== String(this.currentSession.id)) return;
        this.currentSession.contextPercent = 0;
        this.currentSession.contextTokens = 0;
        if (payload.filename) this.currentSession.filename = payload.filename;
        showGlassToast('info', null, 'Session recycled', false, 2400, '<i class="fas fa-recycle"></i>');
    }

    openSessionImage(filename) {
        if (!filename) return;
        const names = this.sessionImageFilenames();
        const list = names.indexOf(filename) >= 0 ? names.slice() : names.concat(filename);
        const index = Math.max(0, list.indexOf(filename));
        // openGlancewellForFilenames: public/scripts/comp/mcpActivityClient.js
        openGlancewellForFilenames(list, index);
    }

    // director_session_image: the turn saved a print (modules/cursorDirector.js)
    noteSessionImage(payload) {
        const chatId = payload && (payload.chatId || payload.sessionId);
        const filename = payload && payload.filename;
        if (!chatId || !filename || !this.currentSession || String(chatId) !== String(this.currentSession.id)) return;
        const images = this.sessionImageFilenames();
        if (!images.includes(filename)) images.push(filename);
        this.currentSession.images = images;
        const messageId = payload.messageId || '';
        const prints = Array.isArray(this.currentSession.prints) ? this.currentSession.prints : [];
        if (!prints.some((item) => item && item.filename === filename)) {
            prints.push({ filename, messageId });
        }
        this.currentSession.prints = prints;
        if (messageId && Array.isArray(this.currentSession.messages)) {
            const message = this.currentSession.messages.find((item) => item && String(item.id) === String(messageId));
            if (message) {
                const list = Array.isArray(message.prints) ? message.prints : [];
                if (!list.includes(filename)) message.prints = list.concat(filename);
            }
        }
        this.currentSession.filename = filename;
        this.currentSession.image_type = 'generated';
        const sessionIdx = this.directorSessions.findIndex((s) => s.id === this.currentSession.id);
        if (sessionIdx !== -1) {
            this.directorSessions[sessionIdx].images = images;
            this.directorSessions[sessionIdx].filename = filename;
            this.directorSessions[sessionIdx].image_type = 'generated';
        }
        this.paintSessionPreview(this.currentSession);
        this.renderDirectorSessions();
        this._turnPrints = (this._turnPrints || 0) + 1;
        this.setImagePending(false);
        this.renderSessionImages();
        this.mountPrintBubble(payload.messageId || '', filename);
        // syncDirectorGlancewell: public/scripts/comp/mcpActivityClient.js
        if (typeof syncDirectorGlancewell === 'function') syncDirectorGlancewell(this.sessionImageFilenames());
    }

    // ---- Agent task list (#directorTaskList, above the messages in both hosts) ----

    sessionTasks() {
        const tasks = this.currentSession && this.currentSession.tasks;
        return Array.isArray(tasks) ? tasks : [];
    }

    renderSessionTasks() {
        if (!this.directorTaskList) return;
        const tasks = this.sessionTasks();
        this.directorTaskList.classList.toggle('hidden', tasks.length === 0);
        this.directorTaskList.innerHTML = '';
        if (!tasks.length) return;
        const fragment = document.createDocumentFragment();
        tasks.forEach((task) => {
            const row = document.createElement('div');
            row.className = 'director-task-row';
            row.dataset.done = task.done ? '1' : '0';
            const mark = document.createElement('i');
            mark.className = task.done ? 'fas fa-check' : 'fa-regular fa-square';
            const text = document.createElement('span');
            text.textContent = task.title || '';
            row.appendChild(mark);
            row.appendChild(text);
            fragment.appendChild(row);
        });
        this.directorTaskList.appendChild(fragment);
    }

    // director_session_tasks, plus the tasks that ride along on a session read
    applySessionTasks(sessionId, tasks) {
        if (!Array.isArray(tasks)) return;
        const rows = tasks.slice();
        const at = this.directorSessions.findIndex((item) => String(item.id) === String(sessionId));
        if (at !== -1) this.directorSessions[at].tasks = rows;
        if (!this.currentSession || String(this.currentSession.id) !== String(sessionId)) return;
        this.currentSession.tasks = rows;
        this.renderSessionTasks();
    }

    // set_session_title renamed the chat: header, window title, and the list row
    applySessionName(sessionId, name) {
        if (!sessionId || !name) return;
        const at = this.directorSessions.findIndex((item) => String(item.id) === String(sessionId));
        if (at !== -1) this.directorSessions[at].name = name;
        if (this.currentSession && String(this.currentSession.id) === String(sessionId)) {
            this.currentSession.name = name;
            if (this.directorSessionTitle) {
                const titleText = this.directorSessionTitle.querySelector('.director-title-text');
                if (titleText) titleText.textContent = name;
                else this.directorSessionTitle.textContent = name;
            }
            if (this.directorWindowTitle) this.directorWindowTitle.textContent = `Director — ${name}`;
        }
        this.renderDirectorSessions();
        this.updateTrayChrome();
    }

    // Header thumbnail plus its expanded copy — the latest print is the session image
    bindSessionPreviewFallback(img, filename) {
        if (!img) return;
        img.dataset.fullTried = '';
        img.onerror = () => {
            // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
            const full = filename ? localGalleryImageUrl(filename) : '';
            if (!full || img.dataset.fullTried === '1') {
                img.onerror = null;
                img.src = '/static_images/background.jpg';
                return;
            }
            img.dataset.fullTried = '1';
            img.src = full;
        };
    }

    paintSessionPreview(session) {
        if (this.persona === 'xi') {
            if (this.directorSessionPreviewContainer) this.directorSessionPreviewContainer.classList.add('hidden');
            return;
        }
        if (!session || !this.directorSessionPreview || !this.directorSessionPreviewLarge) return;
        const previewImageSrc = this.getSessionPreviewImage(session);
        const filename = session.filename || '';
        this.bindSessionPreviewFallback(this.directorSessionPreview, filename);
        this.bindSessionPreviewFallback(this.directorSessionPreviewLarge, filename);
        this.directorSessionPreview.src = previewImageSrc;
        this.directorSessionPreviewLarge.src = previewImageSrc;
    }

    // ---- Computer maintenance and prompt guide (WS to modules/, confirmed by the user) ----

    // wsClient.sendMessage (public/scripts/websocket.js) resolves director_*_response with the whole
    // packet and rejects on the server's `error` packet for the same requestId.
    async directorRequest(type, payload) {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        const message = await window.wsClient.sendMessage(type, Object.assign({ persona: this.persona || 'wren' }, payload || {}), false);
        const body = message && message.data ? message.data : {};
        if (body.success === false || body.error) {
            throw new Error(body.error || `${type} failed`);
        }
        return body;
    }

    // director_computer_size_response: { computer: { bytes, home, path }, promptGuide } (modules/cursorDirector.js)
    formatComputerSize(size) {
        const computer = size && size.computer ? size.computer : size;
        const bytes = Number(computer && computer.bytes);
        // formatBytes: public/scripts/comp/systemTrayManager.js
        return Number.isFinite(bytes) ? formatBytes(bytes) : 'unknown';
    }

    async requestComputerSize() {
        try {
            return await this.directorRequest('director_computer_size', {});
        } catch (err) {
            showGlassToast('error', 'Director', err.message || 'Could not read the Dreamspace size');
            return null;
        }
    }

    async cleanupComputer() {
        const size = await this.requestComputerSize();
        if (!size) return;
        const ok = await showConfirmationDialog(
            `Clean up Dreamspace?\n\nRemoves temp files, pip and npm caches, __pycache__, and incomplete downloads. Installed tools, chats, and the prompt guide clone stay.\n\nCurrent size: ${this.formatComputerSize(size)}`,
            [
                { text: 'Cancel', value: false, className: 'btn-secondary' },
                { text: 'Cleanup', value: true, className: 'btn-primary', icon: 'fas fa-broom' }
            ],
            null,
            { title: 'Director', icon: 'fas fa-clapperboard' }
        );
        if (!ok) return;
        try {
            // { freed, size }
            const result = await this.directorRequest('director_cleanup', {});
            const freed = Number(result.freed);
            showGlassToast('success', 'Director', Number.isFinite(freed) ? `Freed ${formatBytes(freed)}` : 'Cleanup finished');
        } catch (err) {
            showGlassToast('error', 'Director', err.message || 'Cleanup failed');
        }
    }

    async reinstallComputer() {
        const size = await this.requestComputerSize();
        if (!size) return;
        const ok = await showConfirmationDialog(
            `Reinstall Dreamspace?\n\nThis aborts a running turn and deletes the whole of Dreamspace, including installed tools and the browser profile. Chats, sessions, the MCP key, and the prompt guide clone stay.\n\nCurrent size: ${this.formatComputerSize(size)}`,
            [
                { text: 'Cancel', value: false, className: 'btn-secondary' },
                { text: 'Reinstall', value: true, className: 'btn-danger', icon: 'fas fa-arrows-rotate' }
            ],
            null,
            { title: 'Director', icon: 'fas fa-clapperboard' }
        );
        if (!ok) return;
        showGlassToast('info', 'Director', 'Reinstalling Dreamspace…', false, 6000);
        try {
            await this.directorRequest('director_reinstall', {});
            showGlassToast('success', 'Director', 'Dreamspace reinstalled');
        } catch (err) {
            showGlassToast('error', 'Director', err.message || 'Reinstall failed');
        }
    }

    showDirectorText(title, text, status) {
        // Existing read-only system text viewer: public/scripts/comp/vfsSystemOpenRouter.js
        vfsSystemOpenRouter._ensureTextModal();
        vfsSystemOpenRouter._textTitleEl.textContent = title;
        vfsSystemOpenRouter._textContentEl.textContent = text;
        vfsSystemOpenRouter._textStatusEl.textContent = status || 'Read-only';
        // openModal: public/scripts/comp/modalUtils.js
        openModal(vfsSystemOpenRouter._textModal);
        setTimeout(() => {
            const wrap = vfsSystemOpenRouter._textModal.querySelector('.log-viewer-body-scroll');
            // customScrollbar.forceReinit: public/scripts/comp/customScrollbar.js
            if (wrap) customScrollbar.forceReinit(wrap);
        }, 80);
    }

    async promptGuideReview() {
        try {
            // { base, baseSha, diff, truncated, empty }
            const result = await this.directorRequest('director_prompt_guide_diff', {});
            const status = ['Read-only', `prompt-guide-work vs ${result.base || 'origin/main'}`];
            if (result.truncated) status.push('diff truncated');
            this.showDirectorText(
                'Prompt guide review',
                result.empty ? `No changes against ${result.base || 'origin/main'}.` : String(result.diff || ''),
                status.join(' · ')
            );
        } catch (err) {
            showGlassToast('error', 'Prompt guide', err.message || 'Review failed');
        }
    }

    async promptGuideExtract() {
        try {
            // { tree, parent, branch, files, extractedAt, changed }
            const result = await this.directorRequest('director_prompt_guide_extract', {});
            const count = Array.isArray(result.files) ? result.files.length : 0;
            showGlassToast(
                result.changed === false ? 'info' : 'success',
                'Prompt guide',
                result.changed === false
                    ? 'No changes to extract'
                    : `${count} file${count === 1 ? '' : 's'} staged onto ${result.branch || 'director-draft'}`
            );
        } catch (err) {
            showGlassToast('error', 'Prompt guide', err.message || 'Extract failed');
        }
    }

    async promptGuideCommit() {
        // showInputDialog: public/scripts/comp/confirmationDialog.js
        const message = await showInputDialog(
            'Commit the director-draft branch of the prompt guide.\n\nCommit message:',
            '',
            'Describe the change',
            [
                { text: 'Cancel', value: null, className: 'btn-secondary' },
                { text: 'Commit', value: true, className: 'btn-primary', icon: 'fas fa-code-commit' }
            ],
            null,
            { title: 'Prompt guide', icon: 'fas fa-book' }
        );
        if (message == null) return;
        if (!message) {
            showGlassToast('error', 'Prompt guide', 'A commit message is required');
            return;
        }
        try {
            // { commit, branch, files, message }
            const result = await this.directorRequest('director_prompt_guide_commit', { message });
            const sha = result.commit ? ` ${String(result.commit).slice(0, 8)}` : '';
            showGlassToast('success', 'Prompt guide', `Committed${sha} on ${result.branch || 'director-draft'}`);
        } catch (err) {
            showGlassToast('error', 'Prompt guide', err.message || 'Commit failed');
        }
    }

    async promptGuidePush() {
        const ok = await showConfirmationDialog(
            'Push director-draft to DreamScape/nai-prompt-guide?\n\nUntil this push the draft is only local.',
            [
                { text: 'Cancel', value: false, className: 'btn-secondary' },
                { text: 'Push', value: true, className: 'btn-primary', icon: 'fas fa-cloud-arrow-up' }
            ],
            null,
            { title: 'Prompt guide', icon: 'fas fa-book' }
        );
        if (!ok) return;
        try {
            // { branch, commit, output }
            const result = await this.directorRequest('director_prompt_guide_push', {});
            showGlassToast('success', 'Prompt guide', `Pushed ${result.branch || 'director-draft'}`);
        } catch (err) {
            showGlassToast('error', 'Prompt guide', err.message || 'Push failed');
        }
    }

    // Load the current chat (or the picture's chat) into whichever host is showing.
    // An empty draft is not written until the first message starts the agent.
    async openCurrentSession() {
        const lookup = !!(this._lookupImageChat || this._resumeImage);
        this._lookupImageChat = false;
        const resumeName = this._resumeImage && this._resumeImage.filename;
        let previewFilename = resumeName || this.openImageFilename();
        this.requestCursorUsage();
        const preferredChatId = this._openPreferredId || null;
        this._openPreferredId = null;
        // Reopening the panel, or a chat the user already picked, must not snap back to the latest chat.
        if (!lookup && !preferredChatId && this.currentSession && (this.currentSession.draft || this.currentSession.id)) {
            if (!previewFilename || this.sessionOwnsFilename(this.currentSession, previewFilename)) {
                this._pendingWorkspaceToken = null;
                return;
            }
        }
        if (preferredChatId) previewFilename = null;
        if (window.wsClient && window.wsClient.isConnected()) {
            this._navToken = (this._navToken || 0) + 1;
            this._pendingWorkspaceToken = this._navToken;
            window.wsClient.send({
                type: 'director_open_workspace',
                requestId: Date.now().toString(),
                persona: this.persona || 'wren',
                workspaceId: window.currentWorkspace || null,
                previewFilename: previewFilename,
                directorSessionId: previewFilename ? this.openImageSessionId(previewFilename) : null,
                preferredChatId: preferredChatId
            });
        } else {
            showGlassToast('error', null, 'WebSocket not connected');
        }
    }

    async showDirector(options) {
        const skipSession = !!(options && options.skipSession);
        if (this.directorWindowIsOpen()) {
            this.focusDirectorWindow();
            if (!skipSession) await this.openCurrentSession();
            return;
        }
        // Studio has no Xi. The desktop window is the only place that toggle exists.
        this.resetToWren();
        // Window was hidden without its close button (e.g. a close-all sweep): take the chat back first
        this.mountDirectorInStudio();
        if (this.directorContainer) {
            if (!this.directorContainer.classList.contains('director-open')) this.fadeInComposer();
            // First remove hidden class to make element visible
            this.directorContainer.classList.remove('hidden');
            this.directorContainer.classList.remove('director-closed');
            this.requestDirectorModels();

            // Show common header
            if (this.directorCommonHeader) {
                this.directorCommonHeader.classList.remove('hidden');
            }

            // Show auto generate button when director is open
            if (this.directorAutoGenerateBtn) {
                this.directorAutoGenerateBtn.classList.remove('hidden');
            }

            // Small delay to allow browser to process display change
            await new Promise(resolve => setTimeout(resolve, 10));

            // Then add open class to start animation
            this.directorContainer.classList.add('director-open');
        }
        this.currentView = 'sessionChat';
        this.updateHeaderForView('sessionChat');
        this.updateIndicator(this.directorBtn, true);
        this.paintPersonaToggle();
        if (!skipSession) await this.openCurrentSession();
    }

    hideDirector() {
        // Studio close used to collapse the shared chat even while it was hosted
        // in #directorWindow, which left that window blank.
        if (this.directorDockedInWindow()) {
            if (this._hideTimer) {
                clearTimeout(this._hideTimer);
                this._hideTimer = null;
            }
            if (this.directorContainer) {
                this.directorContainer.classList.remove('director-closed', 'hidden');
                this.directorContainer.classList.add('director-open');
            }
            if (this.directorCommonHeader) this.directorCommonHeader.classList.remove('hidden');
            this.updateIndicator(this.directorBtn, false);
            this.paintPersonaToggle();
            return;
        }
        if (this.directorContainer) {
            // Start the closing animation
            this.directorContainer.classList.remove('director-open');
            this.directorContainer.classList.add('director-closed');

            // Add hidden class after animation completes (mountDirectorInWindow cancels this)
            if (this._hideTimer) clearTimeout(this._hideTimer);
            this._hideTimer = setTimeout(() => {
                this._hideTimer = null;
                if (!this.directorDockedInWindow()) {
                    this.directorContainer.classList.add('hidden');
                }
            }, 400); // Match the CSS transition duration
        }
        
        // Hide common header
        if (this.directorCommonHeader) {
            this.directorCommonHeader.classList.add('hidden');
        }

        // Hide auto generate button when director is closed
        if (this.directorAutoGenerateBtn) {
            this.directorAutoGenerateBtn.classList.add('hidden');
        }
        
        this.updateIndicator(this.directorBtn, false);
    }
    
    async showSessionList() {
        // The static left panel is already the session list, so the chat view stays put
        if (this.staticSessionPanel()) {
            await this.loadDirectorSessions();
            this.initializeScrollbars();
            return;
        }
        this.currentView = 'sessionList';
        // Show overlay instead of switching views
        if (this.directorSessionList) {
            this.directorSessionList.classList.remove('hidden');
        }
        await this.loadDirectorSessions();
        this.initializeScrollbars();
    }
    
    async showSessionChat(session, options) {
        this._pendingWorkspaceToken = null;
        if (this.currentSession && this.currentSession !== session && Array.isArray(this.currentSession.messages)) {
            assignTrimmedDirectorSessionMessages(this.currentSession, this.currentSession.messages);
            const prevIdx = this.directorSessions.findIndex(s => s.id === this.currentSession.id);
            if (prevIdx !== -1) {
                this.directorSessions[prevIdx].messages = this.currentSession.messages;
            }
        }

        if (!this.currentSession || !session || this.currentSession.id !== session.id) {
            this.hideBrowserPreview();
        }
        this.currentView = 'sessionChat';
        this.currentSession = session;
        window.currentSession = session; // Keep global reference for compatibility
        if (session && session.id) this._welcomeQuip = null;

        // Store the last opened session in localStorage
        if (session && session.id) {
            localStorage.setItem(this.lastSessionStorageKey(), session.id);
        }

        this.hideAllViews();
        this.closeSessionOverlay(); // Close overlay when switching views
        if (this.directorSessionChat) {
            this.directorSessionChat.classList.remove('hidden');
        }
        this.placeComposer(false, true);
        this._scrollAfterLoad = true;
        const liveKeys = [];
        this._expandedTrace.forEach((key) => {
            if (String(key).startsWith('live:')) liveKeys.push(key);
        });
        liveKeys.forEach((key) => this._expandedTrace.delete(key));
        this.updateHeaderForView('sessionChat');
        if (this.directorSessionTitle) {
            const titleText = this.directorSessionTitle.querySelector('.director-title-text');
            if (titleText) {
                titleText.textContent = session.name;
            } else {
                this.directorSessionTitle.textContent = session.name;
            }
        }
        if (this.directorWindowTitle) {
            this.directorWindowTitle.textContent = session.name ? `Director — ${session.name}` : 'Director';
        }

        // Set the preview images
        this.paintSessionPreview(session);
        this._imagePending = false;
        this.renderSessionImages();
        this.renderSessionTasks();

        if (!(options && options.skipLoad)) {
            if (Array.isArray(session.messages)) {
                this.renderSessionMessages(session.messages);
            }
            await this.loadSessionMessages(session.id);
        } else {
            if (this._renderMessagesTimeout) {
                clearTimeout(this._renderMessagesTimeout);
                this._renderMessagesTimeout = null;
            }
            this._doRenderSessionMessages(session.messages || []);
        }
        this.initializeScrollbars();

        // Ensure scroll to bottom after loading messages
        this.scrollToBottom();
        this.paintWorkspaceBanner();
        this.applySessionModel(session);
        if (this._focusComposer && this.directorChatInput) {
            this.directorChatInput.focus();
            this._focusComposer = false;
            this._askWrenOpening = false;
        }
    }


    toggleSessionOverlay() {
        if (!this.directorSessionList || this.staticSessionPanel()) return;

        const isVisible = !this.directorSessionList.classList.contains('hidden');
        if (isVisible) {
            this.closeSessionOverlay();
        } else {
            this.openSessionOverlay();
        }
    }

    openSessionOverlay() {
        if (!this.directorSessionList) return;

        this.directorSessionList.classList.remove('hidden');

        // Always load fresh sessions from server when opening overlay
        // This ensures the session list is fully up-to-date
        this.loadDirectorSessions();

        // A static left panel is never dismissed by a click elsewhere
        if (this.staticSessionPanel()) return;

        // Add click-outside listener
        this.addClickOutsideListener();
    }

    closeSessionOverlay() {
        if (!this.directorSessionList) return;

        this.directorSessionList.classList.add('hidden');
        // Restore header for current view
        this.updateHeaderForView(this.currentView);
        // Remove click-outside listener
        this.removeClickOutsideListener();
    }

    addClickOutsideListener() {
        if (this._clickOutsideHandler) return;

        this._clickOutsideHandler = (event) => {
            // Check if click is outside the overlay
            if (this.directorSessionList && !this.directorSessionList.contains(event.target)) {
                // Check if click is not on a menu button that opens the overlay
                const menuButtons = [this.directorMenuBtn].filter(btn => btn);
                const clickedOnMenuButton = menuButtons.some(btn => btn.contains(event.target));

                if (!clickedOnMenuButton) {
                    this.closeSessionOverlay();
                }
            }
        };

        if (this._clickOutsideScope) {
            this._clickOutsideScope.abort();
        }
        this._clickOutsideScope = new AbortController();
        document.addEventListener('click', this._clickOutsideHandler, { signal: this._clickOutsideScope.signal });
    }

    removeClickOutsideListener() {
        if (this._clickOutsideScope) {
            this._clickOutsideScope.abort();
            this._clickOutsideScope = null;
        }
        this._clickOutsideHandler = null;
    }

    hideAllViews() {
        if (this.directorSessionList) {
            this.directorSessionList.classList.add('hidden');
        }
        if (this.directorNewSession) {
            this.directorNewSession.classList.add('hidden');
        }
        if (this.directorSessionChat) {
            this.directorSessionChat.classList.add('hidden');
        }
    }

    // Toggle header elements based on current view
    updateHeaderForView(view) {
        if (!this.directorCommonHeader) return;

        // For sessionList view, hide the common header since it has its own header
        if (view === 'sessionList') {
            this.directorCommonHeader.classList.add('hidden');
            return;
        }

        // Show common header for other views
        this.directorCommonHeader.classList.remove('hidden');

        // Get all header elements with data-view attributes
        const headerElements = this.directorCommonHeader.querySelectorAll('[data-view]');
        
        // Hide all elements first
        headerElements.forEach(element => {
            element.classList.add('hidden');
        });

        // Show elements for the current view
        const viewElements = this.directorCommonHeader.querySelectorAll(`[data-view="${view}"]`);
        viewElements.forEach(element => {
            element.classList.remove('hidden');
        });
        if (this.persona === 'xi') {
            if (this.directorSessionPreviewContainer) this.directorSessionPreviewContainer.classList.add('hidden');
            const fresh = document.getElementById('directorHeaderActionsNewSession');
            if (fresh) fresh.classList.add('hidden');
            this.paintRuntimePicker();
        } else if (this.directorRuntimePick) {
            this.directorRuntimePick.classList.add('hidden');
        }
    }

    // Shown enabled on a draft (choice still open), then locked once the session
    // exists — the runtime is picked once, at creation, and cannot change after.
    paintRuntimePicker() {
        if (!this.directorRuntimePick) return;
        const session = this.currentSession;
        const isDraft = !session || session.draft || !session.id;
        this.directorRuntimePick.classList.remove('hidden');
        if (isDraft) {
            this.directorRuntimePick.disabled = false;
            this.directorRuntimePick.value = this._nextXiRuntime || 'cursor';
            this.directorRuntimePick.title = 'Runtime (fixed once the session starts)';
        } else {
            this.directorRuntimePick.value = session.runtime === 'claude' ? 'claude' : 'cursor';
            this.directorRuntimePick.disabled = true;
            this.directorRuntimePick.title = 'Runtime (fixed for this session)';
        }
    }

    async loadDirectorSessions() {
        return new Promise((resolve, reject) => {
            // Send WebSocket request to load sessions
            if (window.wsClient && window.wsClient.isConnected()) {
                const asked = this.persona || 'wren';
                window.wsClient.send({
                    type: 'director_get_sessions',
                    requestId: Date.now().toString(),
                    persona: asked
                });

                // Set up a one-time listener for the response
                let settled = false;
                const timer = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    window.wsClient.off('director_get_sessions_response', handleResponse);
                    reject(new Error('Timeout loading director sessions'));
                }, 10000);
                const handleResponse = (data) => {
                    const body = data && data.data;
                    if (body && this.packetPersona(body) !== asked) return;
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    window.wsClient.off('director_get_sessions_response', handleResponse);
                    if (body && typeof body.xiEnabled === 'boolean' && this.noteXiEnabled(body.xiEnabled)) {
                        this.loadDirectorSessions().then(resolve).catch(reject);
                        return;
                    }
                    if (this.persona !== asked) {
                        resolve();
                        return;
                    }
                    if (body && body.success) {
                        this.directorSessions = body.sessions || [];
                        this.activeAccountId = body.activeAccountId || 'default';
                        this.cursorAccounts = body.accounts || [];
                        this.paintAccountBadge();
                        this.renderDirectorSessions();
                        resolve();
                    } else {
                        reject(new Error('Failed to load director sessions'));
                    }
                };

                window.wsClient.on('director_get_sessions_response', handleResponse);
            } else {
                console.warn('WebSocket not connected, using mock data');
                this.directorSessions = [];
                window.directorSessions = this.directorSessions;
                this.renderDirectorSessions();
                resolve();
            }
        });
    }
    
    renderDirectorSessions() {
        // Debounce rapid successive calls
        if (this._renderSessionsTimeout) {
            clearTimeout(this._renderSessionsTimeout);
        }

        this._renderSessionsTimeout = setTimeout(() => {
            this._doRenderDirectorSessions();
        }, 16); // ~60fps
    }

    _doRenderDirectorSessions() {
        // Ensure session data is synchronized - always sync from global if available
        if (window.directorSessions && Array.isArray(window.directorSessions)) {
            // Always sync from global to ensure we have the latest data
            this.directorSessions = [...window.directorSessions];
        }

        // Safely clear content while preserving scrollbar structure
        this.clearDirectorSessionsList();

        const sessions = this.directorSessions || [];

        if (sessions.length === 0) {
            const fragment = document.createDocumentFragment();
            fragment.appendChild(this.createNoSessionsItem());
            this.addSessionItemsBatch(fragment);
        } else {
            // Use document fragment for batch DOM operations
            const fragment = document.createDocumentFragment();
            const eventListeners = [];

            const active = sessions.filter((session) => !session.archived);
            const archived = sessions.filter((session) => session.archived);
            active.forEach(session => {
                const sessionItem = this.createSessionItem(session, eventListeners);
                fragment.appendChild(sessionItem);
            });
            if (!active.length && !archived.length) fragment.appendChild(this.createNoSessionsItem());
            if (archived.length) {
                fragment.appendChild(this.createArchiveHeader());
                archived.forEach(session => {
                    const sessionItem = this.createSessionItem(session, eventListeners);
                    fragment.appendChild(sessionItem);
                });
            }

            // Batch add all items at once
            this.addSessionItemsBatch(fragment);

            // Batch add event listeners
            this.attachEventListenersBatch(eventListeners);
        }

        // Reinitialize scrollbars after content is rendered
        this.safeReinitializeScrollbars();
    }

    createNoSessionsItem() {
        const item = document.createElement('div');
        item.className = 'director-session-item';
        item.innerHTML = '<div class="director-session-info"><div class="director-session-name">No sessions yet</div></div>';
        return item;
    }

    createArchiveHeader() {
        const item = document.createElement('div');
        item.className = 'director-session-item';
        item.innerHTML = '<div class="director-session-info"><div class="director-session-name">Archives</div></div>';
        return item;
    }

    createSessionItem(session, eventListeners) {
        const item = document.createElement('div');
        item.className = 'director-session-item';
        item.dataset.sessionId = session.id; // Add data attribute for easier identification
        if (session.archived) item.dataset.archived = '1';

        const activeAccId = this.activeAccountId || 'default';
        const sessionAccId = session.accountId || 'default';
        const isInactiveAccount = sessionAccId !== activeAccId;

        if (isInactiveAccount) {
            item.dataset.inactiveAccount = '1';
            item.classList.add('inactive-account');
            const accounts = this.cursorAccounts || [];
            const accProfile = accounts.find((a) => a.id === sessionAccId);
            const accName = accProfile ? accProfile.name : sessionAccId;
            item.title = `Paired with inactive account: ${accName}`;
        }

        const formattedDate = session.archived
            ? `Archived ${this.formatSessionDate(session.archived_at || session.updated_at || session.created_at)}`
            : this.formatSessionDate(session.updated_at || session.created_at);

        const preview = this.persona === 'xi'
            ? ''
            : `<img class="director-session-preview" src="${this.getSessionPreviewImage(session)}" alt="Session preview" loading="lazy">`;

        const accountBadge = this.accountBadgeHtml(sessionAccId, isInactiveAccount);

        item.innerHTML = `
            ${preview}
            <div class="director-session-info">
                <div class="director-session-name"><span>${this.escapeHtml(session.name)}</span>${accountBadge}${this.workspaceDot(session)}</div>
                <div class="director-session-date">${formattedDate}</div>
            </div>
        `;
        if (this.persona !== 'xi') this.bindSessionPreviewFallback(item.querySelector('.director-session-preview'), session.filename || '');

        // Attach context menu to this session item
        if (contextMenu && this.directorSessionContextConfig) {
            contextMenu.attachToElement(item, this.directorSessionContextConfig);
        }

        // Store event listener for batch attachment
        eventListeners.push({
            element: item,
            type: 'click',
            handler: (event) => {
                if (Date.now() < (this._suppressSessionOpenUntil || 0)) return;
                if (event && event.button) return;
                this.showSessionChat(session);
            }
        });

        return item;
    }

    accountPalette() {
        return ['#5b8def', '#e06c75', '#98c379', '#e5c07b', '#c678dd', '#56b6c2', '#d19a66', '#61afef'];
    }

    accountProfile(accountId) {
        const id = accountId || 'default';
        return (this.cursorAccounts || []).find((acc) => acc && acc.id === id) || { id, name: 'Account' };
    }

    accountColor(account) {
        const given = account && typeof account.color === 'string' ? account.color : '';
        if (/^#[0-9a-fA-F]{6}$/.test(given)) return given;
        const palette = this.accountPalette();
        const id = String((account && account.id) || 'default');
        let n = 0;
        for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i)) % palette.length;
        return palette[n];
    }

    accountLetter(account) {
        const name = String((account && account.name) || '?').trim();
        const match = name.match(/[A-Za-z0-9]/);
        return (match ? match[0] : (name.charAt(0) || '?')).toUpperCase();
    }

    accountBadgeHtml(accountId, inactive) {
        const account = this.accountProfile(accountId);
        const letter = this.accountLetter(account);
        const color = this.accountColor(account);
        const name = account.name || accountId || 'Account';
        const title = inactive ? `${name} (not the active profile)` : name;
        return `<span class="director-account-badge" style="background:${this.escapeHtml(color)}" title="${this.escapeHtml(title)}">${this.escapeHtml(letter)}</span>`;
    }

    paintAccountBadge() {
        const el = document.getElementById('directorAccountBadge');
        if (!el) return;
        const account = this.accountProfile(this.activeAccountId || 'default');
        el.textContent = this.accountLetter(account);
        el.style.background = this.accountColor(account);
        el.title = account.name || 'Active profile';
        el.classList.remove('hidden');
    }

    formatSessionDate(timestamp) {
        if (!this._dateFormatter) {
            this._dateFormatter = new Intl.DateTimeFormat('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }
        let ms = NaN;
        if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
            ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
        } else if (typeof timestamp === 'string' && timestamp) {
            if (/^\d+$/.test(timestamp)) {
                const asNum = Number(timestamp);
                ms = asNum < 1e12 ? asNum * 1000 : asNum;
            } else {
                ms = Date.parse(timestamp);
            }
        }
        if (!Number.isFinite(ms)) return '';
        return this._dateFormatter.format(new Date(ms));
    }

    escapeHtml(text) {
        // Cache the encoder element for better performance
        if (!this._htmlEncoder) {
            this._htmlEncoder = document.createElement('div');
        }
        this._htmlEncoder.textContent = text;
        return this._htmlEncoder.innerHTML;
    }

    addSessionItemsBatch(fragment) {
        // Cache scrollable content reference to avoid repeated DOM queries
        if (!this._scrollableContent) {
            // Check if scrollbar is already initialized
            if (window.customScrollbar && window.customScrollbar.scrollbars.has(this.directorSessionsList)) {
                this._scrollableContent = this.directorSessionsList.querySelector('.scrollable-content');
            }
        }

        if (this._scrollableContent) {
            this._scrollableContent.appendChild(fragment);
        } else {
            // Fallback: add to the main element
            this.directorSessionsList.appendChild(fragment);
        }
    }

    attachEventListenersBatch(listeners) {
        listeners.forEach(({ element, type, handler }) => {
            element.addEventListener(type, handler);
        });
    }

    safeReinitializeScrollbars() {
        try {
            if (window.customScrollbar && typeof window.customScrollbar.forceReinit === 'function') {
                window.customScrollbar.forceReinit(this.directorSessionsList);
                // Clear cached scrollable content reference since DOM structure may have changed
                this._scrollableContent = null;
            } else {
                this.initializeScrollbars();
            }
        } catch (error) {
            console.warn('Error initializing scrollbars for session list:', error);
            try {
                this.initializeScrollbars();
            } catch (fallbackError) {
                console.warn('Fallback scrollbar initialization also failed:', fallbackError);
            }
        }
    }

    // Safely clear the director sessions list content
    clearDirectorSessionsList() {
        if (!this.directorSessionsList) return;

        // Check if scrollbar is already initialized
        if (window.customScrollbar && window.customScrollbar.scrollbars.has(this.directorSessionsList)) {
            // Use cached reference if available
            const scrollableContent = this._scrollableContent || this.directorSessionsList.querySelector('.scrollable-content');
            if (scrollableContent) {
                scrollableContent.innerHTML = '';
                return;
            }
        }

        // Fallback: clear the main element
        this.directorSessionsList.innerHTML = '';
    }

    // Cleanup method to prevent memory leaks
    cleanup() {
        // Clear any pending timeouts
        if (this._renderSessionsTimeout) {
            clearTimeout(this._renderSessionsTimeout);
            this._renderSessionsTimeout = null;
        }

        if (this._renderMessagesTimeout) {
            clearTimeout(this._renderMessagesTimeout);
            this._renderMessagesTimeout = null;
        }

        // Remove click-outside listener
        this.removeClickOutsideListener();

        // Clear cached formatters
        this._dateFormatter = null;

        // Clear session references
        this.currentSession = null;
        this.directorSessions = [];
    }
    
    async deleteSession() {
        if (!this.currentSession || !this.currentSession.id) return;        
        // Check if showConfirmationDialog is available
        if (typeof showConfirmationDialog !== 'function') {
            return;
        }

        const result = await showConfirmationDialog(
            `Are you sure you want to delete the session "${this.currentSession.name}"?`,
            [
                { text: 'Delete', value: true, className: 'btn-danger', icon: 'fas fa-trash' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );

        if (result) {
            const sessionId = this.currentSession.id;
            this._deleteWasCurrent = true;
            this._deleteTargetId = sessionId;
            if (this._runningSessionId === sessionId) {
                this._running = false;
                this._runningSessionId = null;
                this._steer = null;
                this.hideTypingIndicator();
                this.updateTrayChrome();
            }
            const lastSessionId = localStorage.getItem(this.lastSessionStorageKey());
            if (lastSessionId === sessionId) {
                localStorage.removeItem(this.lastSessionStorageKey());
            }

            if (window.wsClient && window.wsClient.isConnected()) {
                window.wsClient.send({
                    type: 'director_delete_session',
                    requestId: Date.now().toString(),
                    sessionId,
                    persona: this.persona || 'wren'
                });
            } else {
                this.directorSessions = this.directorSessions.filter(s => s.id !== sessionId);
                window.directorSessions = this.directorSessions;
                this.renderDirectorSessions();
                this.showNewSessionDraft();
            }
        }
    }
    
    loadSessionMessages(sessionId) {
        this._messagesSessionId = sessionId;
        // Send WebSocket request to load messages
        if (window.wsClient && window.wsClient.isConnected()) {
            window.wsClient.send({
                type: 'director_get_messages',
                requestId: Date.now().toString(),
                sessionId: sessionId,
                limit: DIRECTOR_MAX_SESSION_MESSAGES,
                persona: this.persona || 'wren'
            });
        } else {
            console.warn('WebSocket not connected, using mock data');
            const session = (this.directorSessions || []).find(s => s.id === sessionId);
            if (session) {
                this.renderSessionMessages(session.messages || []);
            }
        }
    }
    
    renderSessionMessages(messages) {
        // Debounce rapid successive calls
        if (this._renderMessagesTimeout) {
            clearTimeout(this._renderMessagesTimeout);
        }

        this._renderMessagesTimeout = setTimeout(() => {
            this._doRenderSessionMessages(messages);
        }, 16); // ~60fps
    }

    directorScrollEl() {
        if (!this.directorChatMessages) return null;
        return this.directorChatMessages.closest('.scrollable-content') || this.directorChatMessages.parentElement;
    }

    wireDirectorRowScroll() {
        if (this._rowScrollWired || !this.directorChatMessages) return;
        const root = this.directorChatMessages.closest('.director-chat-messages-container');
        if (!root) return;
        this._rowScrollWired = true;
        root.addEventListener('scroll', (event) => this.onDirectorRowsScroll(event.target), true);
        new ResizeObserver(() => {
            if (!this._stickBottom) return;
            const el = this.directorScrollEl();
            if (el) el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        }).observe(this.directorChatMessages);
    }

    onDirectorRowsScroll(target) {
        const scroller = this.directorScrollEl();
        if (target === scroller) {
            this._stickBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 64;
        }
        if (this._expandingRows || !this._hiddenOlderRows) return;
        const el = target && target.classList && target.classList.contains('scrollable-content')
            ? target
            : this.directorScrollEl();
        if (!el) return;
        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        if (max < 48) return;
        if (el.scrollTop > 80) return;
        this._expandingRows = true;
        this._visibleRowCount += DIRECTOR_ROW_PAGE;
        this._doRenderSessionMessages(this._renderedMessages || [], { keepPlace: true });
        this._expandingRows = false;
    }

    flattenDirectorUnits(messages) {
        const units = [];
        messages.forEach((message) => {
            // appendSessionCard rows (modules/cursorDirector.js): a workspace jump or a picture
            if (message.role === 'event') {
                units.push({ type: 'card', message });
                return;
            }
            const structuredData = message.data || null;
            const captions = structuredData && Array.isArray(structuredData.Caption) ? structuredData.Caption : [];
            captions.forEach((caption) => units.push({ type: 'caption', caption }));
            if (Array.isArray(message.trace) && message.trace.length) {
                message.trace.forEach((row, index) => {
                    units.push({
                        type: 'trace',
                        row,
                        expandKey: `${message.id || message.timestamp}:${index}`,
                        model: message.model || null
                    });
                });
            } else {
                units.push({ type: 'message', message });
            }
        });
        return units;
    }

    _unitPlain(unit) {
        if (!unit) return '';
        if (unit.type === 'trace') {
            const row = unit.row || {};
            return String(row.text || row.detail || row.label || row.name || '').replace(/\s+/g, ' ').trim();
        }
        if (unit.type === 'caption') return String(unit.caption || '').replace(/\s+/g, ' ').trim();
        const message = unit.message || {};
        return String(message.user_input || message.content || '').replace(/\s+/g, ' ').trim();
    }

    _extendRenderedRows(visible) {
        const chat = this.directorChatMessages;
        if (!chat) return false;
        const nodes = [...chat.children].filter((node) => {
            return !node.classList.contains('director-live-turn')
                && !node.classList.contains('director-typing-indicator')
                && !node.dataset.older
                && !node.dataset.quickStart;
        });
        if (!nodes.length || nodes.length > visible.length) return false;
        for (let i = 0; i < nodes.length; i++) {
            const have = (nodes[i].innerText || '').replace(/\s+/g, ' ').trim().slice(0, 180);
            const want = this._unitPlain(visible[i]).slice(0, 180);
            if (have && want && have !== want) return false;
        }
        const live = chat.querySelector('.director-live-turn');
        // Rows the live turn already showed come back without the arrive animation
        const shown = live ? [...live.children] : [];
        let carry = 0;
        for (let i = nodes.length; i < visible.length; i++) {
            const unit = visible[i];
            let el = null;
            const held = unit.type === 'trace' ? shown[carry] : null;
            const seen = !!held && held.dataset.traceKind === this.traceKind(unit.row);
            if (seen) carry++;
            this._animateRows = !seen;
            if (unit.type === 'caption') el = this.createQuoteMessageElement(unit.caption);
            else if (unit.type === 'card') el = this.createDirectorCardElement(unit.message);
            else if (unit.type === 'trace') el = this.createTraceRow(unit.row, unit.expandKey, unit.model);
            else el = this.createMessageElement(unit.message);
            if (!el) continue;
            if (live) chat.insertBefore(el, live);
            else chat.appendChild(el);
        }
        this._animateRows = false;
        if (live) live.remove();
        const typing = chat.querySelector('.director-typing-indicator');
        if (typing) typing.remove();
        return true;
    }

    _doRenderSessionMessages(messages, options) {
        if (!this.directorChatMessages || !Array.isArray(messages)) return;
        const keepPlace = options && options.keepPlace;
        const firstPaint = !!this.currentSession && this._windowSessionId !== this.currentSession.id;
        if (firstPaint) this._stickBottom = true;
        const follow = !keepPlace && (firstPaint || (options && options.scroll) || this._scrollAfterLoad || this._stickBottom);
        if (!keepPlace) this._scrollAfterLoad = false;
        this.promoteLiveTraceKeys(messages);
        const cappedMessages = this.currentSession
            ? assignTrimmedDirectorSessionMessages(this.currentSession, messages)
            : trimDirectorSessionMessages(messages);
        messages = cappedMessages;
        this._renderedMessages = messages;

        if (this.currentSession) {
            const sessionIdx = this.directorSessions.findIndex(s => s.id === this.currentSession.id);
            if (sessionIdx !== -1) {
                this.directorSessions[sessionIdx].messages = this.currentSession.messages;
            }
            if (this._windowSessionId !== this.currentSession.id) {
                this._windowSessionId = this.currentSession.id;
                this._visibleRowCount = DIRECTOR_ROW_PAGE;
            }
        }

        const units = this.flattenDirectorUnits(messages);
        const start = Math.max(0, units.length - this._visibleRowCount);
        this._hiddenOlderRows = start;
        const visible = units.slice(start);
        const scroller = this.directorScrollEl();
        const place = scroller ? scroller.scrollTop : 0;
        if (this._settleTurn && this._extendRenderedRows(visible)) {
            this._settleTurn = false;
            this.applyMessageFilter();
            this.paintMessagePrints(messages);
            this.paintContext();
            this.wireDirectorRowScroll();
            if (follow) this.scrollToBottom();
            return;
        }
        this._settleTurn = false;

        const fragment = document.createDocumentFragment();
        if (start > 0) {
            const older = document.createElement('div');
            older.className = 'director-message';
            older.dataset.older = '1';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-secondary';
            button.textContent = 'Older';
            button.addEventListener('click', () => {
                this._visibleRowCount += DIRECTOR_ROW_PAGE;
                this._doRenderSessionMessages(this._renderedMessages || [], { keepPlace: true });
            });
            older.appendChild(button);
            fragment.appendChild(older);
        }
        visible.forEach((unit) => {
            let el = null;
            if (unit.type === 'caption') el = this.createQuoteMessageElement(unit.caption);
            else if (unit.type === 'card') el = this.createDirectorCardElement(unit.message);
            else if (unit.type === 'trace') el = this.createTraceRow(unit.row, unit.expandKey, unit.model);
            else el = this.createMessageElement(unit.message);
            if (el) fragment.appendChild(el);
        });
        if (!messages.length && !this._skipQuickStart) this.paintComposerWelcome();
        else this.clearComposerWelcome();
        this.directorChatMessages.replaceChildren(fragment);
        this.applyMessageFilter();
        this.paintMessagePrints(messages);
        this.paintContext();
        this.wireDirectorRowScroll();
        if (follow) {
            this.scrollToBottom();
        } else if (scroller) {
            scroller.scrollTop = place;
            setTimeout(() => {
                const again = this.directorScrollEl();
                if (again) again.scrollTop = place;
            }, 30);
        }
        this.initializeScrollbars();
    }

    // Live rows use live:N. Once that turn is saved, the same index belongs to the message.
    promoteLiveTraceKeys(messages) {
        if (!this._expandedTrace.size) return;
        let live = false;
        this._expandedTrace.forEach((key) => {
            if (String(key).startsWith('live:')) live = true;
        });
        if (!live) return;
        let messageId = '';
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i];
            if (message && Array.isArray(message.trace) && message.trace.length && (message.id || message.timestamp)) {
                messageId = message.id || message.timestamp;
                break;
            }
        }
        if (!messageId) return;
        const next = new Set();
        this._expandedTrace.forEach((key) => {
            const text = String(key);
            if (!text.startsWith('live:')) {
                next.add(text);
                return;
            }
            const index = text.slice(5);
            if (index === 'open') return;
            next.add(`${messageId}:${index}`);
        });
        this._expandedTrace = next;
    }

    createQuoteMessageElement(caption) {
        // Handle both string and object formats for caption
        const captionText = typeof caption === 'string' ? caption : caption.text || caption;
        const captionType = caption.type || 'self'; // Default to self if no type specified

        // Use the type from JSON to determine styling (same as original)
        const captionClass = `director-message-caption ${captionType}-caption`;

        const quoteDiv = document.createElement('div');
        quoteDiv.className = `director-message-captions ${captionType}-type`;

        // Create content using original styling format
        quoteDiv.innerHTML = `<div class="${captionClass}"><i class="fas fa-quote-left"></i><span>${captionText}</span><i class="fas fa-quote-right"></i></div>`;

        return quoteDiv;
    }

    parseTextContent(textContent) {
        // Check if the text content is a JSON string that should be parsed
        if (typeof textContent === 'string' && textContent.trim().startsWith('{')) {
            try {
                const parsedObject = JSON.parse(textContent);
                
                // Extract the main content from SI response object
                if (parsedObject.Description) {
                    return parsedObject.Description;
                } else if (parsedObject.message) {
                    return parsedObject.message;
                } else if (parsedObject.content) {
                    return parsedObject.content;
                }
                
                // If no recognized key, return original text
                return textContent;
            } catch (e) {
                // Not valid JSON, return as is
                return textContent;
            }
        }
        
        // Not a JSON string, return as is
        return textContent;
    }
    
    createMessageElement(message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `director-message ${message.role || message.message_type}`;
        if (this._animateRows) messageDiv.classList.add('director-row-arrive');
        
        // Add message key for button functionality
        const messageKey = message.id || message.timestamp || Date.now();
        messageDiv.dataset.messageKey = messageKey.toString();

        // Store the raw message data as-is
        try {
            messageDiv.dataset.messageData = JSON.stringify(message);
        } catch (e) {
            console.warn('❌ Failed to serialize message data, skipping message:', e);
            return null;
        }
        
        let content = '';
        
        // Parse content - it might be a JSON string or object
        let messageContent = message.content;
        if (typeof messageContent === 'string') {
            try {
                messageContent = JSON.parse(messageContent);
            } catch (e) {
                // If it's not JSON, use as string
            }
        }
        
        // Handle OpenAI format content (array of objects with type and text)
        if (Array.isArray(messageContent)) {
            messageContent = messageContent.map(item => {
                if (item.type === 'text') {
                    return this.parseTextContent(item.text);
                } else if (item.type === 'image_url') {
                    return '[Image]';
                }
                return '';
            }).join(' ');
        } else if (typeof messageContent === 'object' && messageContent !== null) {
            // Handle object content
            if (messageContent.text) {
                messageContent = this.parseTextContent(messageContent.text);
            } else if (messageContent.message) {
                messageContent = messageContent.message;
            } else {
                messageContent = JSON.stringify(messageContent);
            }
        }
        
        // Handle assistant messages using server-processed data
        let structuredData = null;
        if (message.role === 'assistant' || message.message_type === 'assistant') {
            structuredData = message.data || null;

            // Build content using server-processed structured data
            if (structuredData && !structuredData.error) {
                content = '';
                
                // Add SuggestedName as header if available
                if (structuredData.SuggestedName) {
                    content = `<div class="director-message-suggested-name">${structuredData.SuggestedName}</div>`;
                }

                // Add PrimaryFocus as subtitle if available
                if (structuredData.Description) {
                    content += `<div class="director-message-primary-focus">${this.processMarkdown(structuredData.Description)}</div>`;
                }

                // Add expandable sections for different content types
                let hasExpandableContent = false;

                // Add Description as expandable if available
                if (structuredData.PrimaryFocus) {
                    content += `
                        <div class="director-message-expandable">
                            <button type="button" class="director-expand-button" onclick="window.directorInstance.toggleExpandable(this, 'description')">
                                <i class="fas fa-chevron-down"></i> Show Description
                            </button>
                            <div class="director-expandable-content hidden">
                                <div class="director-message-primary-focus">${this.processMarkdown(structuredData.PrimaryFocus)}</div>
                            </div>
                        </div>
                    `;
                    hasExpandableContent = true;
                }

                // Add ImageDescription as expandable if available
                if (structuredData.ImageDescription) {
                    content += `
                        <div class="director-message-expandable">
                            <button type="button" class="director-expand-button" onclick="window.directorInstance.toggleExpandable(this, 'imageDescription')">
                                <i class="fas fa-chevron-down"></i> Show Image Description
                            </button>
                            <div class="director-expandable-content hidden">
                                <div class="director-message-image-description">${this.processMarkdown(structuredData.ImageDescription)}</div>
                            </div>
                        </div>
                    `;
                    hasExpandableContent = true;
                }

                // Add Issues as expandable if available
                if (structuredData.Issues) {
                    content += `
                        <div class="director-message-expandable">
                            <button type="button" class="director-expand-button" onclick="window.directorInstance.toggleExpandable(this, 'issues')">
                                <i class="fas fa-exclamation-triangle"></i> Show Issues
                            </button>
                            <div class="director-expandable-content hidden">
                                <div class="director-message-issues">${this.processMarkdown(structuredData.Issues)}</div>
                            </div>
                        </div>
                    `;
                    hasExpandableContent = true;
                }

                // Add Suggestions as expandable if available
                if (structuredData.Suggested && Array.isArray(structuredData.Suggested) && structuredData.Suggested.length > 0) {
                    content += `
                        <div class="director-message-expandable">
                            <button type="button" class="director-expand-button" onclick="window.directorInstance.toggleExpandable(this, 'suggestions')">
                                <i class="fas fa-lightbulb"></i> Show Suggestions
                            </button>
                            <div class="director-expandable-content hidden">
                                <div class="director-message-suggestions">
                                    ${structuredData.Suggested.map((suggestion) => {
                                        const text = typeof suggestion === 'string' ? suggestion : '';
                                        return `<div class="director-suggestion-item clickable" onclick="window.directorInstance.useSuggestion('${text.replace(/'/g, "\\'")}')">
                                            <i class="fas fa-arrow-right"></i> ${text}
                                        </div>`;
                                    }).join('')}
                                </div>
                            </div>
                        </div>
                    `;
                    hasExpandableContent = true;
                }

                // If no expandable content, show basic content
                if (!hasExpandableContent) {
                    content += `<div class="director-message-content">${messageContent}</div>`;
                }

                // Add Character and Series in a row
                if (structuredData.Character || structuredData.Series) {
                    content += `<div class="director-message-character-series">`;
                    if (structuredData.Character) {
                        content += `<span class="director-message-character">${structuredData.Character}</span>`;
                    }
                    if (structuredData.Series) {
                        content += `<span class="director-message-series">${structuredData.Series}</span>`;
                    }
                    content += `</div>`;
                }

                // Captions are now displayed as separate quote messages above this message
            } else {
                // Server couldn't process - show error message from server
                content = `<div class="director-message-content">${message.content || 'Invalid Response from SI'}</div>`;
            }
        } else {
            // For user messages, show message_type and user_input in 2-row layout
            const requestType = message.message_type || 'Text';
            
            // Extract user input from various possible formats
            let userInput = 'No Preference Provided';
            
            if (message.user_input) {
                userInput = message.user_input;
            } else if (message.content) {
                // Handle content array format (OpenAI format)
                if (Array.isArray(message.content)) {
                    const textContent = message.content
                        .filter(item => item.type === 'text' && item.text && item.text.trim())
                        .map(item => item.text)
                        .join(' ');
                    if (textContent.trim()) {
                        userInput = textContent;
                    }
                } else if (typeof message.content === 'string' && message.content.trim()) {
                    userInput = message.content;
                }
            }
            
            content = `<div class="director-message-content">
                <div class="director-user-message-header">
                    <span class="director-request-type-badge">${requestType}</span>
                    <button type="button" class="director-rollback-btn" onclick="window.directorInstance.retryMessage('${messageKey}')">
                        <i class="fas fa-rotate-right"></i> Retry
                    </button>
                    <button type="button" class="director-rollback-btn" onclick="window.directorInstance.rollbackToMessage('${messageKey}')">
                        <i class="nai-dot-reset"></i> Rollback
                    </button>
                </div>
                <div class="director-user-message-input">${userInput}</div>
            </div>`;
        }
        
        // Parse json_data for rating and buttons (for assistant messages)
        let rating = null;
        let buttons = null;
        let nsfwHeat = null;
        
        if (message.role === 'assistant' || message.message_type === 'assistant') {
            if (message.json_data) {
                try {
                    const jsonData = typeof message.json_data === 'string' ? JSON.parse(message.json_data) : message.json_data;
                    buttons = jsonData.buttons;
                } catch (e) {
                    console.warn('Failed to parse json_data:', e);
                }
            }
            
            // Get Rating from data if available
            if (structuredData && structuredData.Score !== undefined && structuredData.Score !== null) {
                rating = structuredData.Score;
            }

            // Get NSFWHeat from data if available
            if (structuredData && structuredData.NSFWHeat !== undefined && structuredData.NSFWHeat !== null) {
                nsfwHeat = structuredData.NSFWHeat;
            }
            
            
            if (buttons && buttons.length > 0) {
                const buttonsHtml = buttons.map(btn => 
                    `<button class="btn-secondary btn-small">${btn}</button>`
                ).join('');
                content += `<div class="director-message-actions">${buttonsHtml}</div>`;
            }
            
            // Create action buttons and indicators
            const actionButtons = [];
            const indicators = [];
            
            // Add rating indicator if present
            if (rating !== undefined && rating !== null) {
                indicators.push(`<div class="director-message-rating-small">
                    <div class="director-rating-circle-small" style="--rating: ${rating}">
                    </div>
                </div>`);
            }
            
            // Add heat indicator if present
            if (nsfwHeat !== null) {
                indicators.push(`<div class="director-nsfw-heat-small">
                    <div class="director-heat-circle-small" style="--heat: ${nsfwHeat}">
                    </div>
                </div>`);
            }
            
            // Add NSFW indicator if present
            if (structuredData && structuredData.isNSFW) {
                indicators.push(`<span class="director-nsfw-indicator">NSFW</span>`);
            }
            
            // Add Stale indicator if present
            if (structuredData && structuredData.isStale) {
                indicators.push(`<span class="director-stale-indicator">Stale</span>`);
            }
            
            // Add action buttons and indicators if any exist
            if (actionButtons.length > 0 || indicators.length > 0) {
                const actionButtonsHtml = actionButtons.join('');
                const indicatorsHtml = indicators.join('');
                
                if (buttons && buttons.length > 0) {
                    // Add to existing actions
                    content = content.replace('</div>', actionButtonsHtml + '</div>');
                } else {
                    // Create new actions section with flex layout
                    content += `<div class="director-message-actions">
                        <div class="director-message-indicators">${indicatorsHtml}</div>
                        <div class="director-message-buttons">${actionButtonsHtml}</div>
                    </div>`;
                }
            }
        }
        
        messageDiv.innerHTML = content;
        this.attachMessageMenu(messageDiv);
        return messageDiv;
    }
    
    // While the open fade runs, a placement jumps instead of sliding.
    placeComposer(centered, animate) {
        const chat = this.directorSessionChat;
        if (!chat) return;
        const want = centered === true;
        if (chat.classList.contains('director-composer-center') === want) return;
        const slide = animate && !chat.classList.contains('director-composer-fade');
        if (!slide) chat.classList.add('director-composer-instant');
        chat.classList.toggle('director-composer-center', want);
        if (!slide) {
            void chat.offsetWidth;
            chat.classList.remove('director-composer-instant');
        }
    }

    fadeInComposer() {
        const chat = this.directorSessionChat;
        if (!chat) return;
        chat.classList.remove('director-composer-fade');
        void chat.offsetWidth;
        chat.classList.add('director-composer-fade');
    }

    showNewSessionDraft() {
        if (!this._welcomeQuip) {
            this._welcomeQuip = DIRECTOR_WELCOME_QUIPS[Math.floor(Math.random() * DIRECTOR_WELCOME_QUIPS.length)];
        }
        // A workspace open already in flight must not replace this draft with a server chat.
        this._pendingWorkspaceToken = null;
        const draft = {
            draft: true,
            id: null,
            name: 'New session',
            messages: []
        };
        this.currentSession = draft;
        window.currentSession = draft;
        this._windowSessionId = null;
        this.currentView = 'sessionChat';
        this.hideAllViews();
        this.closeSessionOverlay();
        if (this.directorSessionChat) this.directorSessionChat.classList.remove('hidden');
        this.placeComposer(true, true);
        this.updateHeaderForView('sessionChat');
        if (this.directorSessionTitle) {
            const titleText = this.directorSessionTitle.querySelector('.director-title-text');
            if (titleText) titleText.textContent = 'New session';
            else this.directorSessionTitle.textContent = 'New session';
        }
        if (this.directorWindowTitle) this.directorWindowTitle.textContent = 'Director';
        this._imagePending = false;
        this.renderSessionImages();
        this.renderSessionTasks();
        if (this._renderMessagesTimeout) {
            clearTimeout(this._renderMessagesTimeout);
            this._renderMessagesTimeout = null;
        }
        this._doRenderSessionMessages([]);
        this.paintContext();
        this.paintWorkspaceBanner();
        this.applySessionModel(draft);
        this.requestDirectorModels();
        return true;
    }

    async openNewSession() {
        this._selectedQuickTaskId = null;
        this._welcomeQuip = null;
        this._pendingWorkspaceToken = null;
        this._nextXiRuntime = null;
        if (this.directorWindowIsOpen()) {
            this.showNewSessionDraft();
            if (this.directorChatInput) this.directorChatInput.focus();
            return;
        }
        if (!this.studioIsOpen()) {
            await openManualModalWithContent({ type: 'none', skipPreviewRestore: true });
        }
        if (this.directorBtn && this.directorBtn.disabled) {
            this.directorBtn.disabled = false;
            this.directorBtn.classList.remove('disabled');
        }
        await this.showDirector({ skipSession: true });
        this.showNewSessionDraft();
        if (this.directorChatInput) this.directorChatInput.focus();
    }

    beginServerChat() {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            showGlassToast('error', null, 'WebSocket not connected');
            return false;
        }
        window.wsClient.send({
            type: 'director_create_session',
            requestId: Date.now().toString(),
            workspaceId: window.currentWorkspace || null,
            persona: this.persona || 'wren',
            sessionType: this._nextSessionType || null,
            runtime: this.persona === 'xi' ? (this._nextXiRuntime || 'cursor') : undefined
        });
        this._nextSessionType = null;
        return true;
    }

    directorSurfaceOpen() {
        if (this.directorWindowIsOpen()) return true;
        return !!(this.directorContainer
            && !this.directorContainer.classList.contains('hidden')
            && !this.directorContainer.classList.contains('director-closed'));
    }

    hasGrillSubject() {
        if (this.studioIsOpen()) return true;
        if (this.openImageFilename()) return true;
        return this.sessionHasHistory();
    }

    studioIsOpen() {
        const studioModal = document.getElementById('manualModal');
        return !!(studioModal
            && !studioModal.classList.contains('hidden')
            && !studioModal.classList.contains('hidden-alt'));
    }

    // Gallery, Studio preview, image viewer, and Explorer call this.
    async askWrenAboutImage(filename, name) {
        const base = String(filename || '').trim().replace(/\\/g, '/').split('/').pop();
        if (!base || base === '.' || base === '..' || base.indexOf('..') !== -1) {
            showGlassToast('error', null, 'No image to attach');
            return;
        }
        const wrenLive = this.directorSurfaceOpen()
            && this.persona === 'wren'
            && this.currentSession
            && this.currentSession.id
            && !this.currentSession.draft;
        if (wrenLive) {
            if (!this.pendingAttachments.some((item) => item && item.filename === base)) {
                this.pendingAttachments.push({ source: 'workspace', filename: base, name: name || base });
                this.renderAttachChips();
            }
            if (this.directorWindowIsOpen()) this.focusDirectorWindow();
            if (this.directorChatInput) this.directorChatInput.focus();
            return;
        }
        if (this.persona !== 'wren') await this.setPersona('wren');
        if (this.sessionOwnsFilename(this.currentSession, base)) {
            if (this.directorWindowIsOpen()) this.focusDirectorWindow();
            else this.openDirectorWindow();
            if (this.directorChatInput) this.directorChatInput.focus();
            return;
        }
        const known = (this.directorSessions || []).find((session) => this.sessionOwnsFilename(session, base));
        if (known && known.id) {
            this._resumeImage = null;
            this._openPreferredId = known.id;
            const reveal = this.directorWindowIsOpen() ? this.showSessionChat(known) : this.openDirectorWindow();
            Promise.resolve(reveal).then(() => {
                if (this.directorChatInput) this.directorChatInput.focus();
            });
            return;
        }
        this._resumeImage = { filename: base, name: name || base };
        this._lookupImageChat = true;
        this._openPreferredId = null;
        const reveal = this.directorWindowIsOpen() ? this.openCurrentSession() : this.openDirectorWindow();
        Promise.resolve(reveal).then(() => {
            if (this.directorChatInput) this.directorChatInput.focus();
        });
    }

    // Expand Canvas Director toggle (imageExpansion.js): new Wren chat, auto-sent brief
    async startExpandCanvasChat(content, attachments) {
        if (this._creatingChat) {
            showGlassToast('error', null, 'Director is still starting a chat');
            return;
        }
        if (this.directorWindow) await this.openDirectorWindow();
        if (this.persona !== 'wren') await this.setPersona('wren');
        await this.openNewSession();
        this.pendingAttachments = attachments || [];
        this.renderAttachChips();
        this._nextSessionType = 'utility';
        await this.sendMessage(content);
        this._nextSessionType = null;
    }

    lookbacksInComposer() {
        const text = this.directorChatInput ? this.directorChatInput.value : '';
        const found = [];
        const seen = new Set();
        const linked = /\[([^\]]*)\]\((dsap:\/\/lookback\/[^)\s]+)\)/gi;
        let match;
        while ((match = linked.exec(text))) {
            const href = match[2];
            if (seen.has(href)) continue;
            seen.add(href);
            found.push({ label: match[1] || 'lookback', href: href, markdown: match[0] });
        }
        const bare = /dsap:\/\/lookback\/[^\s)]+/gi;
        while ((match = bare.exec(text))) {
            const href = match[0];
            if (seen.has(href)) continue;
            seen.add(href);
            const type = href.split('/')[3] || 'lookback';
            found.push({ label: type, href: href, markdown: href });
        }
        return found;
    }

    removeLookback(markdown) {
        if (!this.directorChatInput || !markdown) return;
        const text = this.directorChatInput.value;
        const at = text.indexOf(markdown);
        if (at < 0) return;
        const next = (text.slice(0, at) + text.slice(at + markdown.length)).replace(/[ \t]{2,}/, ' ');
        this.directorChatInput.value = next;
        this.autoExpandTextarea(this.directorChatInput);
        this.renderAttachChips();
        if (this.directorAttachDropdownMenu && !this.directorAttachDropdownMenu.classList.contains('hidden')) {
            this.renderAttachDropdown();
        }
    }

    chooseAttachmentSource(source) {
        if (source === 'computer') {
            if (this.directorAttachFileInput) this.directorAttachFileInput.click();
            return;
        }
        if (source === 'studio') {
            const image = window.currentManualPreviewImage;
            const filename = image && (image.filename || image.original || image.upscaled);
            if (!filename) {
                showGlassToast('error', null, 'No studio image is open');
                return;
            }
            this.pendingAttachments.push({ source: 'workspace', filename, name: filename });
            this.renderAttachChips();
            return;
        }
        if (source === 'explorer') {
            const found = this.collectExplorerAttachments();
            if (!found.length) {
                showGlassToast('error', null, 'Select a file in Explorer first');
                return;
            }
            found.forEach((item) => this.pendingAttachments.push(item));
            this.renderAttachChips();
        }
    }

    collectExplorerAttachments() {
        if (typeof explorerApplet === 'undefined' || !explorerApplet || !explorerApplet.grid) return [];
        const grid = explorerApplet.grid;
        let items = [];
        if (typeof grid.getSelectedItems === 'function') items = grid.getSelectedItems() || [];
        else if (grid.selectedIds && grid.items) {
            items = grid.items.filter((row) => grid.selectedIds.has(row.id));
        }
        const out = [];
        items.forEach((item) => {
            if (!item) return;
            if (item.targetKind === 'image' || item.targetKind === 'scrap') {
                const filename = item.previewImageFilename || item.targetId;
                if (filename) out.push({ source: 'workspace', filename, name: item.name || filename });
            } else if (item.targetKind === 'reference') {
                const hash = item.targetId || item.previewHash;
                if (hash) out.push({ source: 'reference', hash, name: item.name || hash });
            } else if (item.targetKind === 'user-file') {
                const fileId = item.targetId || item.id;
                if (fileId) out.push({ source: 'vfs', fileId, name: item.name || 'file' });
            }
        });
        return out;
    }

    addComputerFiles(fileList) {
        const files = Array.from(fileList || []);
        files.forEach((file) => {
            if (file.size > 8 * 1024 * 1024) {
                showGlassToast('error', null, `${file.name} is too large`);
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const raw = String(reader.result || '');
                const data = raw.includes(',') ? raw.split(',')[1] : raw;
                const image = (file.type || '').startsWith('image/');
                this.pendingAttachments.push({
                    source: 'client',
                    name: file.name,
                    data,
                    preview: image ? raw : ''
                });
                this.renderAttachChips();
            };
            reader.readAsDataURL(file);
        });
    }

    isImageAttachment(item) {
        if (!item) return false;
        if (item.source === 'workspace' || item.source === 'reference') return true;
        const name = item.name || item.filename || '';
        return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(name);
    }

    // Gallery and cache previews, or the data URL kept on a file picked from this computer.
    attachmentPreviewUrl(item) {
        if (!item) return '';
        if (item.preview) return item.preview;
        if (!this.isImageAttachment(item)) return '';
        if (item.source === 'workspace' && item.filename) {
            // getGalleryPreviewUrl: public/scripts/utils/deviceUtils.js
            // localGalleryPreviewUrl: public/scripts/comp/assetUrlResolver.js
            return localGalleryPreviewUrl(getGalleryPreviewUrl(item.filename));
        }
        if (item.source === 'reference' && item.hash) {
            // localCachePreviewUrl: public/scripts/comp/assetUrlResolver.js
            return localCachePreviewUrl(`${item.hash}.webp`);
        }
        return '';
    }

    // Thumbnail in the composer chip and the attachments menu. Gallery previews
    // fall back to the full file if the preview name does not match.
    appendAttachmentPreview(parent, item) {
        const url = this.attachmentPreviewUrl(item);
        if (!url) return null;
        const caption = item.name || item.filename || item.hash || 'file';
        const preview = document.createElement('img');
        preview.className = 'director-session-preview';
        preview.alt = caption;
        preview.title = caption;
        preview.src = url;
        preview.addEventListener('error', () => {
            if (item.source === 'workspace' && item.filename && preview.dataset.full !== '1') {
                preview.dataset.full = '1';
                // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
                preview.src = localGalleryImageUrl(item.filename);
                return;
            }
            preview.remove();
            if (!parent.querySelector('span')) {
                const label = document.createElement('span');
                label.textContent = caption;
                parent.insertBefore(label, parent.firstChild);
            }
        });
        parent.appendChild(preview);
        return preview;
    }

    renderAttachChips() {
        if (!this.directorAttachChips) return;
        this.directorAttachChips.innerHTML = '';
        this.pendingAttachments.forEach((item, index) => {
            const caption = item.name || item.filename || item.hash || 'file';
            const chip = document.createElement('div');
            chip.className = 'director-attach-chip';
            chip.title = caption;
            if (!this.appendAttachmentPreview(chip, item)) {
                const icon = document.createElement('i');
                icon.className = this.attachmentIconClass(item);
                chip.appendChild(icon);
            }
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn-secondary btn-small';
            remove.title = 'Remove';
            remove.innerHTML = '<i class="fas fa-times"></i>';
            remove.addEventListener('click', () => {
                this.pendingAttachments.splice(index, 1);
                this.renderAttachChips();
            });
            chip.appendChild(remove);
            this.directorAttachChips.appendChild(chip);
        });
        this.lookbacksInComposer().forEach((item) => {
            const chip = document.createElement('div');
            chip.className = 'director-attach-chip';
            chip.title = item.label || 'lookback';
            const icon = document.createElement('i');
            icon.className = this.attachmentIconClass(item);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn-secondary btn-small';
            remove.title = 'Remove';
            remove.innerHTML = '<i class="fas fa-times"></i>';
            remove.addEventListener('click', () => this.removeLookback(item.markdown));
            chip.appendChild(icon);
            chip.appendChild(remove);
            this.directorAttachChips.appendChild(chip);
        });
        this.renderQueueChip();
    }

    attachmentIconClass(item) {
        const href = item && item.href ? String(item.href) : '';
        if (href.indexOf('dsap://lookback/') === 0) {
            const type = href.split('/')[3] || '';
            if (type === 'wiki' || type === 'page') return 'fas fa-book';
            if (type === 'note') return 'fas fa-note-sticky';
            if (type === 'nax' || type === 'tag') return 'fas fa-tags';
            if (type === 'preset') return 'fas fa-bookmark';
            return 'fas fa-link';
        }
        const name = (item && (item.name || item.filename)) || '';
        const ext = name.indexOf('.') >= 0 ? name.split('.').pop().toLowerCase() : '';
        if (ext === 'pdf') return 'fas fa-file-pdf';
        if (ext === 'zip' || ext === '7z' || ext === 'rar') return 'fas fa-file-zipper';
        if (ext === 'mp3' || ext === 'wav' || ext === 'ogg' || ext === 'flac') return 'fas fa-file-audio';
        if (ext === 'mp4' || ext === 'webm' || ext === 'mov') return 'fas fa-file-video';
        if (ext === 'json' || ext === 'js' || ext === 'txt' || ext === 'md' || ext === 'csv') return 'fas fa-file-lines';
        return 'fas fa-file';
    }

    createTraceRow(row, expandKey, model) {
        if (!row) return null;
        const messageDiv = document.createElement('div');
        const kind = row.type === 'thinking' || row.type === 'tool' || row.type === 'assistant' ? row.type : 'assistant';
        messageDiv.className = `director-message ${kind}`;
        messageDiv.dataset.traceKind = kind;
        if (this._animateRows) messageDiv.classList.add('director-row-arrive');
        if (expandKey) {
            messageDiv.dataset.expandKey = expandKey;
            if (!String(expandKey).startsWith('live:')) {
                const key = String(expandKey).split(':')[0];
                if (key) messageDiv.dataset.messageKey = key;
            }
            if (this._expandedTrace.has(expandKey)) messageDiv.classList.add('expanded');
        }
        messageDiv.dataset.traceExtras = this.traceExtras(row);
        const header = document.createElement('div');
        header.className = 'director-user-message-header';
        const label = document.createElement('span');
        label.className = 'director-request-type-badge';
        const toolLabel = this.prettyToolLabel(row);
        label.textContent = kind === 'thinking' ? 'Thinking' : (kind === 'tool' ? toolLabel : 'Director');
        header.appendChild(label);
        if (messageDiv.dataset.traceExtras.includes('g')) {
            const glasses = document.createElement('button');
            glasses.type = 'button';
            glasses.className = 'btn-secondary btn-small';
            glasses.title = 'Parameters and result';
            glasses.innerHTML = '<i class="fas fa-glasses"></i>';
            glasses.addEventListener('click', (event) => {
                event.stopPropagation();
                this.openToolPayload(row);
            });
            header.appendChild(glasses);
        }
        if (messageDiv.dataset.traceExtras.includes('a')) {
            const applyBtn = document.createElement('button');
            applyBtn.type = 'button';
            applyBtn.className = 'btn-secondary btn-small';
            applyBtn.textContent = 'Apply';
            applyBtn.title = 'Apply these Studio changes again';
            applyBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.reapplyStudioChange(row.replay);
            });
            header.appendChild(applyBtn);
        }
        const body = document.createElement('div');
        body.className = 'director-message-content';
        if (kind === 'assistant') {
            body.dataset.raw = row.text || '';
            body.innerHTML = this.processMarkdown(row.text || '');
        } else if (kind === 'tool') {
            const detail = row.detail || (row.text && row.text !== 'tool' && row.text !== toolLabel ? row.text : '');
            const line = document.createElement('div');
            line.className = 'director-tool-detail';
            line.textContent = detail;
            body.appendChild(line);
            if (!detail) body.classList.add('hidden');
        } else {
            const text = row.text || row.name || '';
            const line = document.createElement('div');
            line.className = 'director-thinking-line';
            line.textContent = text;
            const full = document.createElement('div');
            full.className = 'director-thinking-full';
            full.dataset.raw = text;
            full.innerHTML = this.processMarkdown(text);
            body.append(line, full);
        }
        const plain = kind === 'thinking' ? (row.text || '') : (body.textContent || '');
        const expandable = kind === 'thinking' ? plain.length > 0 : (kind === 'tool' && plain.length > 0);
        if (expandable) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'director-expand-button director-compact-toggle';
            toggle.title = 'Show all of this row';
            toggle.innerHTML = '<i class="fas fa-chevron-down"></i>';
            header.appendChild(toggle);
        }
        if (kind === 'assistant') {
            const used = this.roundModelName(model);
            if (used) {
                const badge = document.createElement('span');
                badge.className = 'director-request-type-badge';
                badge.textContent = used;
                header.appendChild(badge);
            }
        }
        messageDiv.appendChild(header);
        messageDiv.appendChild(body);
        this.attachMessageMenu(messageDiv);
        return messageDiv;
    }

    appendToolTracePayload(body, row) {
        const args = row && row.args ? String(row.args) : '';
        const result = row && row.result ? String(row.result) : '';
        let replay = '';
        if (!args && row && row.replay) {
            try {
                replay = JSON.stringify(row.replay, null, 2);
            } catch (_) {
                replay = '';
            }
        }
        let added = false;
        const add = (title, text) => {
            if (!text) return;
            added = true;
            const heading = document.createElement('div');
            heading.textContent = title;
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.textContent = text;
            pre.appendChild(code);
            body.appendChild(heading);
            body.appendChild(pre);
        };
        add('Parameters', args || replay);
        add('Result', result);
        return added;
    }

    // show_chat_image / offer_workspace_switch cards, live and replayed. Same markup as
    // a trace row so the message filter and the compact styling already cover them.
    createDirectorCardElement(message) {
        const data = (message && message.data) || {};
        const kind = message && message.message_type;
        if (kind !== 'chat-image' && kind !== 'workspace-offer' && kind !== 'workspace-switch') return null;
        const card = document.createElement('div');
        card.className = 'director-message event';
        card.dataset.messageKey = String(message.id || message.timestamp || Date.now());
        const header = document.createElement('div');
        header.className = 'director-user-message-header';
        const badge = document.createElement('span');
        badge.className = 'director-request-type-badge';
        header.appendChild(badge);
        const body = document.createElement('div');
        body.className = 'director-message-content';
        if (kind === 'chat-image') {
            badge.textContent = 'Image';
            const picture = document.createElement('img');
            picture.className = 'director-chat-image';
            picture.src = data.src || '';
            picture.alt = data.caption || data.filename || 'Image';
            if (data.filename) {
                picture.title = data.filename;
                picture.addEventListener('click', () => this.openSessionImage(data.filename));
            }
            body.appendChild(picture);
            if (data.caption) {
                const caption = document.createElement('span');
                caption.textContent = data.caption;
                body.appendChild(caption);
            }
        } else if (kind === 'workspace-offer') {
            badge.textContent = 'Workspace';
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'btn-secondary btn-small';
            open.innerHTML = '<i class="fas fa-folder-open"></i>';
            const label = document.createElement('span');
            label.textContent = `Open ${this.workspaceCardName(data)}`;
            open.appendChild(label);
            open.addEventListener('click', () => this.jumpToWorkspace(data.workspaceId));
            header.appendChild(open);
            body.textContent = data.reason || '';
            if (!data.reason) body.classList.add('hidden');
        } else {
            badge.textContent = 'Switch';
            const remain = document.createElement('span');
            remain.className = 'director-switch-countdown';
            remain.dataset.remain = '1';
            remain.textContent = '90s';
            header.appendChild(remain);
            const accept = document.createElement('button');
            accept.type = 'button';
            accept.className = 'btn-primary btn-small';
            accept.textContent = 'Switch';
            const decline = document.createElement('button');
            decline.type = 'button';
            decline.className = 'btn-secondary btn-small';
            decline.textContent = 'Stay';
            accept.addEventListener('click', () => this.settleWorkspaceSwitch(card, data, 'accepted'));
            decline.addEventListener('click', () => this.settleWorkspaceSwitch(card, data, 'declined'));
            header.appendChild(accept);
            header.appendChild(decline);
            body.textContent = data.reason || `Switch to ${this.workspaceCardName(data)}?`;
            this.armWorkspaceSwitch(card, data);
        }
        card.appendChild(header);
        card.appendChild(body);
        this.attachMessageMenu(card);
        return card;
    }

    // workspaces / activeWorkspace: public/scripts/comp/workspaceUtils.js
    currentWorkspaceId() {
        return (typeof activeWorkspace !== 'undefined' && activeWorkspace) || window.currentWorkspace || '';
    }

    sessionWorkspaceMeta(session) {
        const id = session && session.workspaceId;
        if (!id) return null;
        const live = (typeof workspaces !== 'undefined' && workspaces) ? workspaces[id] : null;
        const color = live && typeof live.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(live.color)
            ? live.color
            : '#6366f1';
        return { id, name: (live && live.name) || id, color };
    }

    workspaceDot(session) {
        const meta = this.sessionWorkspaceMeta(session);
        if (!meta) return '';
        return `<div class="workspace-color-indicator" style="background-color: ${meta.color}" title="${this.escapeHtml(meta.name)}"></div>`;
    }

    paintWorkspaceBanner() {
        const banner = document.getElementById('directorWorkspaceBanner');
        const text = document.getElementById('directorWorkspaceBannerText');
        const chat = this.directorSessionChat;
        const session = this.currentSession;
        const meta = session && !session.draft ? this.sessionWorkspaceMeta(session) : null;
        // Compiled workspace CSS is [data-workspace] on the app root. The same
        // attribute on the chat root themes this scroll area, glass included.
        if (chat) {
            if (meta && meta.id) chat.setAttribute('data-workspace', meta.id);
            else chat.removeAttribute('data-workspace');
        }
        if (!banner || !text) return;
        if (!meta || meta.id === this.currentWorkspaceId()) {
            banner.classList.add('hidden');
            return;
        }
        text.textContent = `This session belongs to ${meta.name}`;
        banner.classList.remove('hidden');
    }

    // Sending does not re-pair the session. A chat with no workspace yet takes the one you are in.
    sessionWorkspaceIdForSend() {
        const session = this.currentSession;
        const paired = session && typeof session.workspaceId === 'string' ? session.workspaceId.trim() : '';
        if (paired) return paired;
        return this.currentWorkspaceId();
    }

    armWorkspaceSwitch(card, data) {
        if (!card || !data) return;
        const deadline = Number(data.deadline) || 0;
        const remain = card.querySelector('[data-remain]');
        if (!deadline || deadline <= Date.now()) {
            this.paintWorkspaceSwitchOutcome(card, 'timeout');
            return;
        }
        const tick = () => {
            const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            if (remain) remain.textContent = `${left}s`;
            if (left <= 0) {
                this.settleWorkspaceSwitch(card, data, 'timeout');
                return;
            }
            card._switchTimer = setTimeout(tick, 250);
        };
        tick();
    }

    paintWorkspaceSwitchOutcome(card, status) {
        if (!card) return;
        if (card._switchTimer) {
            clearTimeout(card._switchTimer);
            card._switchTimer = null;
        }
        card.querySelectorAll('button').forEach((button) => {
            button.disabled = true;
        });
        const remain = card.querySelector('[data-remain]');
        if (remain) {
            remain.textContent = status === 'accepted' ? 'Switched' : (status === 'timeout' ? 'Timed out' : 'Stayed');
        }
    }

    settleWorkspaceSwitch(card, data, status) {
        const id = data && (data.switchId || data.requestId);
        if (!id) return;
        if (!this._switchSettled) this._switchSettled = new Set();
        if (this._switchSettled.has(id)) return;
        this._switchSettled.add(id);
        this.paintWorkspaceSwitchOutcome(card, status);
        const send = (result) => {
            if (!window.wsClient || !window.wsClient.isConnected()) return;
            window.wsClient.send({
                type: 'director_workspace_switch_result',
                requestId: Date.now().toString(),
                id,
                switchId: id,
                status: result
            });
        };
        if (status === 'accepted' && data.workspaceId) {
            Promise.resolve(this.jumpToWorkspace(data.workspaceId)).then(() => {
                if (this.currentWorkspaceId() === data.workspaceId) {
                    send('accepted');
                    return;
                }
                this.paintWorkspaceSwitchOutcome(card, 'declined');
                send('declined');
            }, () => {
                this.paintWorkspaceSwitchOutcome(card, 'declined');
                send('declined');
            });
            return;
        }
        send(status);
    }

    // workspaces: public/scripts/comp/workspaceUtils.js — the card carries the name the
    // server saw, and the live map covers a rename since then.
    workspaceCardName(data) {
        const id = data && data.workspaceId;
        const live = id && workspaces ? workspaces[id] : null;
        return (live && live.name) || (data && data.workspaceName) || id || 'workspace';
    }

    async jumpToWorkspace(workspaceId) {
        if (!workspaceId) return;
        if (activeWorkspace === workspaceId) {
            showGlassToast('info', 'Director', `Already in ${this.workspaceCardName({ workspaceId })}`);
            return;
        }
        // setActiveWorkspace: public/scripts/comp/workspaceUtils.js
        await setActiveWorkspace(workspaceId);
    }

    // director_chat_image / director_workspace_offer arrive mid-turn; the card is already
    // saved on the chat, so a later reload renders the same row from the messages.
    appendChatCard(kind, payload) {
        const chatId = payload && (payload.chatId || payload.sessionId);
        if (!chatId || !this.directorChatMessages) return;
        if (!this.currentSession || String(chatId) !== String(this.currentSession.id)) return;
        const el = this.createDirectorCardElement({
            id: payload.cardId,
            role: 'event',
            message_type: kind,
            timestamp: new Date().toISOString(),
            data: payload
        });
        if (!el) return;
        const live = this.directorChatMessages.querySelector('.director-live-turn');
        const typing = this.directorChatMessages.querySelector('.director-typing-indicator');
        if (live) {
            el.dataset.liveCard = '1';
            live.appendChild(el);
        } else if (typing) {
            this.directorChatMessages.insertBefore(el, typing);
        } else {
            this.directorChatMessages.appendChild(el);
        }
        this.applyMessageFilter();
    }

    async reapplyStudioChange(payload) {
        // applyStudioChangePayloadSilent: public/scripts/comp/studioChangeJson.js
        try {
            const applied = await applyStudioChangePayloadSilent(payload);
            showGlassToast(applied ? 'success' : 'error', null, applied ? 'Studio changes applied' : 'Studio changes were not applied');
        } catch (err) {
            showGlassToast('error', null, err && err.message ? err.message : 'Studio changes were not applied');
        }
    }

    traceKind(row) {
        if (!row) return 'assistant';
        return row.type === 'thinking' || row.type === 'tool' || row.type === 'assistant' ? row.type : 'assistant';
    }

    // Header buttons patchTraceRow cannot add: g glasses, a apply, t expand toggle
    traceExtras(row) {
        const kind = this.traceKind(row);
        if (kind === 'thinking') return row.text ? 't' : '';
        if (kind !== 'tool') return '';
        let extras = '';
        if (row.hasPayload || row.hasDiff || row.args || row.result || row.payloadId || row.diffId) extras += 'g';
        if (row.name === 'apply_studio_changes' && row.replay) extras += 'a';
        if (row.detail || (row.text && row.text !== 'tool')) extras += 't';
        return extras;
    }

    patchTraceRow(el, row) {
        if (!el || !row || el.dataset.traceKind !== this.traceKind(row)) return false;
        const kind = el.dataset.traceKind;
        if (kind === 'thinking') {
            const text = row.text || '';
            const line = el.querySelector('.director-thinking-line');
            const full = el.querySelector('.director-thinking-full');
            if (line && line.textContent !== text) line.textContent = text;
            if (full && full.dataset.raw !== text) {
                full.dataset.raw = text;
                full.innerHTML = this.processMarkdown(text);
            }
            return true;
        }
        if (kind === 'assistant') {
            const body = el.querySelector('.director-message-content');
            const text = row.text || '';
            if (body && body.dataset.raw !== text) {
                body.dataset.raw = text;
                body.innerHTML = this.processMarkdown(text);
            }
            return true;
        }
        if (kind === 'tool') {
            const badge = el.querySelector('.director-request-type-badge');
            const labelText = this.prettyToolLabel(row);
            if (badge && badge.textContent !== labelText) badge.textContent = labelText;
            const detail = el.querySelector('.director-tool-detail');
            const text = row.detail || '';
            if (detail && detail.textContent !== text) detail.textContent = text;
            return true;
        }
        return false;
    }

    renderLiveTrace(payload) {
        if (!this.directorChatMessages) return;
        let host = this.directorChatMessages.querySelector('.director-live-turn');
        if (!host) {
            host = document.createElement('div');
            host.className = 'director-live-turn';
            this.directorChatMessages.appendChild(host);
        }
        const roundModel = (payload && payload.model) || this._turnModel || null;
        const rows = (payload.rows || []).slice();
        const streaming = !!(payload.live && (payload.live.text || payload.live.name));
        if (streaming) rows.push(payload.live);
        const existing = [...host.children].filter((el) => el.dataset.liveCard !== '1');
        rows.forEach((row, index) => {
            const held = existing[index];
            const sameKind = held && held.dataset.traceKind === this.traceKind(row);
            if (sameKind && held.dataset.traceExtras === this.traceExtras(row)) {
                this.patchTraceRow(held, row);
                return;
            }
            this._animateRows = !sameKind;
            const el = this.createTraceRow(row, `live:${index}`, roundModel);
            this._animateRows = false;
            if (!el) return;
            if (sameKind) {
                if (held.classList.contains('expanded')) el.classList.add('expanded');
                if (held.dataset.autoOpen) el.dataset.autoOpen = held.dataset.autoOpen;
                held.replaceWith(el);
            } else if (held) {
                held.replaceWith(el);
            } else {
                host.appendChild(el);
            }
        });
        existing.slice(rows.length).forEach((el) => el.remove());
        // The streaming thinking row stays open; it folds once the next row takes over unless the user toggled it
        const last = streaming ? rows.length - 1 : -1;
        [...host.children].forEach((el, index) => {
            if (index === last && el.dataset.traceKind === 'thinking') {
                if (!el.dataset.autoOpen) {
                    el.dataset.autoOpen = '1';
                    el.classList.add('expanded');
                }
            } else if (el.dataset.autoOpen === '1') {
                el.dataset.autoOpen = '';
                if (!this._expandedTrace.has(el.dataset.expandKey)) el.classList.remove('expanded');
            }
        });
        this.applyMessageFilter();
        this.notePendingPrint(payload.rows, payload.live);
        this.showTypingIndicator();
    }

    // A generation tool in the live trace means a print is on the way, until that many prints have landed this turn.
    // The trace is cumulative, so a finished generate row is still in it after its print arrives.
    notePendingPrint(rows, live) {
        if (this._imagePending === true) return;
        const generators = ['print_studio', 'generate_image', 'generate_preset'];
        const rowGenerates = (row) => {
            if (!row || row.type !== 'tool') return false;
            if (generators.includes(row.name)) return true;
            return row.name === 'apply_studio_changes' && String(row.detail || '').includes('generate');
        };
        const asked = (rows || []).filter(rowGenerates).length + (rowGenerates(live) ? 1 : 0);
        if (asked > (this._turnPrints || 0)) this.setImagePending(true);
    }

    requestCursorUsage() {
        if (!window.wsClient || !window.wsClient.isConnected()) return;
        window.wsClient.send({
            type: 'director_get_cursor_usage',
            requestId: Date.now().toString(),
            persona: this.persona || 'wren'
        });
    }

    estimateContextTokens(session) {
        const messages = session && Array.isArray(session.messages) ? session.messages : [];
        let chars = 0;
        messages.forEach((message) => {
            chars += String(message.user_input || message.content || '').length;
            const description = message.data && message.data.Description;
            if (description) chars += String(description).length;
            (message.trace || []).forEach((row) => {
                chars += String(row && row.text || '').length;
            });
        });
        return Math.round(chars / 4);
    }

    paintContext(source, approximate) {
        const host = document.getElementById('directorContextDisplay');
        const valueEl = document.getElementById('directorContextPercent');
        if (!host || !valueEl) return;
        const windowSize = 256000;
        const pastWindow = (pct, count) => (pct != null && pct > 100) || (count != null && count > windowSize);
        let percent = source && Number.isFinite(Number(source.percent)) ? Math.round(Number(source.percent)) : null;
        let tokens = source && Number.isFinite(Number(source.tokens)) ? Math.round(Number(source.tokens)) : null;
        let approx = approximate === true;
        if (pastWindow(percent, tokens)) {
            percent = null;
            tokens = null;
            approx = false;
        }
        if (percent == null && this.currentSession && Number.isFinite(Number(this.currentSession.contextPercent))) {
            percent = Math.round(Number(this.currentSession.contextPercent));
            tokens = Number.isFinite(Number(this.currentSession.contextTokens)) ? Math.round(Number(this.currentSession.contextTokens)) : null;
            approx = false;
            if (pastWindow(percent, tokens)) {
                percent = null;
                tokens = null;
            }
        }
        if ((percent == null || (percent === 0 && (tokens == null || tokens < 1000))) && this.currentSession) {
            tokens = this.estimateContextTokens(this.currentSession);
            if (!tokens) {
                valueEl.textContent = '—';
                host.title = 'Context window';
                return;
            }
            percent = Math.min(100, Math.round((tokens / windowSize) * 100));
            approx = true;
        }
        if (percent == null) {
            valueEl.textContent = '—';
            host.title = 'Context window';
            return;
        }
        valueEl.textContent = `${Math.min(100, percent)}%`;
        const tokenLabel = tokens != null ? `${tokens.toLocaleString()} tokens of 256k` : '256k window';
        host.title = approx ? `About ${tokenLabel}, estimated from this chat` : tokenLabel;
    }

    paintCursorUsage(usage) {
        const host = document.getElementById('directorUsageDisplay');
        const autoEl = document.getElementById('directorUsageAuto');
        const iconEl = document.getElementById('directorUsageIcon');
        if (!host || !autoEl) return;
        const data = usage || {};
        const auto = Number.isFinite(Number(data.autoPercent)) ? Math.round(Number(data.autoPercent)) : null;
        const other = Number.isFinite(Number(data.apiPercent)) ? Math.round(Number(data.apiPercent)) : null;
        const split = document.getElementById('directorUsageSplit');
        const otherEl = document.getElementById('directorUsageOther');
        const showSplit = auto != null || other != null;
        if (split) split.classList.toggle('hidden', !showSplit);
        autoEl.textContent = auto == null ? '—' : `${auto}%`;
        if (otherEl) otherEl.textContent = other == null ? '—' : `${other}%`;
        host.title = data.title || 'Cursor usage';
        host.classList.toggle('low-credits', data.limited === true);
        this.paintAccountBadge();
        if (iconEl) {
            iconEl.className = data.limited ? 'fas fa-battery-empty' : 'fas fa-battery-three-quarters';
        }
    }

    sessionIsListed(session) {
        if (!session) return false;
        if (session.cursorId) return true;
        const messages = session.messages;
        return Array.isArray(messages) && messages.some((item) => item && item.role === 'user' && item.message_type !== 'Attachment');
    }

    rememberListedSession(session) {
        if (!this.sessionIsListed(session)) return;
        this.directorSessions = [session].concat(
            (this.directorSessions || []).filter((item) => item.id !== session.id)
        );
        window.directorSessions = this.directorSessions;
        this.renderDirectorSessions();
    }

    sessionHasHistory() {
        const messages = this.currentSession && this.currentSession.messages;
        if (!Array.isArray(messages)) return false;
        return messages.some((item) => item && (item.role === 'user' || item.role === 'assistant') && item.message_type !== 'Attachment');
    }

    sessionOwnsFilename(session, filename) {
        const base = String(filename || '').trim().replace(/\\/g, '/').split('/').pop();
        if (!base || !session) return false;
        const names = [session.filename].concat(Array.isArray(session.images) ? session.images : []);
        return names.some((name) => String(name || '').replace(/\\/g, '/').split('/').pop() === base);
    }

    // The picture on screen: the top image viewer, otherwise the Studio preview.
    openImageFilename() {
        // imageViewerManager: public/scripts/comp/imageViewer.js
        let best = null;
        let bestZ = -1;
        if (typeof imageViewerManager !== 'undefined' && imageViewerManager.viewers) {
            imageViewerManager.viewers.forEach((viewer) => {
                const el = viewer && viewer.element;
                if (!el || el.classList.contains('hidden')) return;
                const z = parseInt(el.style.zIndex, 10) || 0;
                if (z < bestZ) return;
                const name = viewer.getImageFilename && viewer.getImageFilename();
                if (!name) return;
                bestZ = z;
                best = name;
            });
        }
        if (best) return best;
        const img = window.currentManualPreviewImage;
        if (!img) return null;
        return img.filename || img.original || img.upscaled || null;
    }

    openImageSessionId(filename) {
        const preview = window.currentManualPreviewImage;
        const previewName = preview && (preview.filename || preview.original || preview.upscaled);
        if (filename && previewName && previewName !== filename) return null;
        const meta = window.currentEditMetadata;
        if (meta && meta.director_session_id) return meta.director_session_id;
        const forge = preview && preview.metadata && preview.metadata.forge_data;
        if (forge && forge.director_session_id) return forge.director_session_id;
        return null;
    }

    snapshotStudioChange() {
        // buildStudioChangeSnapshot: public/scripts/comp/studioChangeJson.js
        if (typeof buildStudioChangeSnapshot !== 'function') return null;
        try {
            return buildStudioChangeSnapshot();
        } catch (_err) {
            return null;
        }
    }

    prettyToolLabel(row) {
        const given = row && typeof row === 'object' ? (row.label || row.name) : row;
        const raw = String(given || 'Tool').trim();
        const key = raw
            .replace(/^mcp__/i, '')
            .split('__')
            .pop()
            .replace(/[-\s]+/g, '_')
            .replace(/_+/g, '_')
            .toLowerCase();
        const named = {
            await_generation_job: 'Wait for print',
            get_generation_job: 'Print job',
            list_generation_requests: 'Print history',
            expand_image: 'Expand',
            expand: 'Expand',
            upscale_image: 'Upscale',
            generate_image: 'Generate',
            apply_studio_changes: 'Update Studio',
            print_studio: 'Print',
            get_session_state: 'Session',
            get_studio_state: 'Studio',
            search_explore: 'Explore',
            count_explore: 'Explore counts',
            get_explore_post: 'Explore post',
            get_explore_image: 'Explore image',
            request_form: 'Form',
            request_workspace_switch: 'Switch workspace',
            AskQuestion: 'Form',
            ledge: 'Ledge',
            show_chat_image: 'Show image',
            open_in_studio: 'Open in Studio',
            open_in_lumen: 'Lumen',
            open_in_glancewell: 'Glancewell',
            read_image_metadata: 'Metadata',
            count_prompt_tokens: 'Tokens',
            search_autofill: 'Tags',
            search_wiki: 'Wiki search',
            search_nax: 'NAX',
            omegasearch: 'Search',
            ensure_artifact: 'Artifact',
            resolve_lookback: 'Lookback'
        };
        if (named[key]) return named[key];
        if (row && row.label && row.label !== row.name && row.label.indexOf('_') === -1) return row.label;
        if (!key || key === 'tool') return 'Tool';
        return key.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
    }

    paintComposerWelcome() {
        const host = this.directorComposerWelcome;
        if (!host) return;
        const xi = this.persona === 'xi';
        const tasks = xi ? DIRECTOR_XI_QUICK_STARTS : DIRECTOR_QUICK_STARTS.filter((task) => !task.existingOnly && (!task.needsSubject || this.hasGrillSubject()) && (!task.v45Only || directorModelIsV45()));
        host.replaceChildren();
        const logo = document.createElement('div');
        logo.className = 'logo-text';
        logo.textContent = 'Director';
        const quip = document.createElement('h3');
        quip.textContent = this._welcomeQuip || DIRECTOR_WELCOME_QUIPS[0];
        const group = document.createElement('div');
        group.className = 'btn-group-compact';
        tasks.forEach((task) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-secondary btn-toggle';
            button.dataset.task = task.id;
            button.dataset.state = this._selectedQuickTaskId === task.id ? 'on' : 'off';
            button.textContent = task.label;
            button.addEventListener('click', () => this.toggleQuickTask(task.id));
            group.appendChild(button);
        });
        const note = document.createElement('p');
        note.dataset.quickNote = '1';
        const selected = tasks.find((task) => task.id === this._selectedQuickTaskId);
        note.textContent = selected ? selected.title : '';
        if (xi) host.append(group, note);
        else host.append(logo, quip, group, note);
    }

    quickStarts() {
        return this.persona === 'xi' ? DIRECTOR_XI_QUICK_STARTS : DIRECTOR_QUICK_STARTS;
    }

    // Off-center, director.css fades the welcome out. Emptying it there would cut the fade.
    clearComposerWelcome() {
        if (!this.directorComposerWelcome || !this.directorSessionChat) return;
        if (this.directorSessionChat.classList.contains('director-composer-center')) this.directorComposerWelcome.replaceChildren();
    }

    createQuickStartRow() {
        this.paintComposerWelcome();
        return null;
    }

    toggleQuickTask(id) {
        this._selectedQuickTaskId = this._selectedQuickTaskId === id ? null : id;
        const row = this.directorComposerWelcome;
        if (!row) return;
        row.querySelectorAll('button[data-task]').forEach((button) => {
            button.dataset.state = button.dataset.task === this._selectedQuickTaskId ? 'on' : 'off';
        });
        const note = row.querySelector('[data-quick-note]');
        const task = this.quickStarts().find((item) => item.id === this._selectedQuickTaskId);
        if (note) note.textContent = task ? task.title : '';
    }

    outgoingText(presetContent) {
        if (typeof presetContent === 'string') return presetContent.trim();
        const typed = (this.directorChatInput ? this.directorChatInput.value : '').trim();
        const task = this.quickStarts().find((item) => item.id === this._selectedQuickTaskId);
        if (!task) return typed;
        if (!typed) return task.prompt;
        return `${task.prompt}\n\n${typed}`;
    }

    removeQuickStart() {
        if (!this.directorChatMessages) return;
        const row = this.directorChatMessages.querySelector('[data-quick-start]');
        if (row) row.remove();
    }

    async sendMessage(presetContent) {
        const fromPreset = typeof presetContent === 'string';
        const typed = fromPreset ? '' : (this.directorChatInput ? this.directorChatInput.value : '').trim();
        const content = this.outgoingText(presetContent);
        const busyHere = this._running && this.currentSession && this._runningSessionId === this.currentSession.id;
        if (this._creatingChat) {
            showGlassToast('error', null, 'Director is still starting this chat');
            return;
        }
        if (!content && !this.pendingAttachments.length) return;
        if (busyHere && this.currentSession && this.currentSession.id) {
            const choice = await showConfirmationDialog(
                'Director is still working on this chat.',
                [
                    { text: 'Steer', value: 'steer', className: 'btn-primary', icon: 'fas fa-hand' },
                    { text: 'Queue', value: 'queue', className: 'btn-secondary', icon: 'fas fa-list' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ],
                null,
                { title: 'Director', icon: 'fas fa-clapperboard' }
            );
            if (choice !== 'steer' && choice !== 'queue') return;
            const sessionId = this.currentSession.id;
            const attachments = this.takeComposerAttachments();
            const job = { content, attachments, steer: choice === 'steer' };
            this.clearComposer();
            if (choice === 'steer') {
                this._outgoingQueue = (this._outgoingQueue || []).filter((item) => item.sessionId !== sessionId);
                this._steer = Object.assign({ sessionId }, job);
                this.renderQueueChip();
                showGlassToast('info', 'Director', 'Sent without interrupting.');
                this.abortTurn(true, { steer: true });
                return;
            }
            this._outgoingQueue = this._outgoingQueue || [];
            this._outgoingQueue.push(Object.assign({ sessionId }, job));
            this.renderQueueChip();
            showGlassToast('info', 'Director', 'Queued. It sends when this turn finishes.');
            return;
        }
        const needsChat = !this.currentSession || this.currentSession.draft || !this.currentSession.id;
        if (needsChat) {
            const attachments = this.pendingAttachments.map((item) => {
                const copy = { ...item };
                delete copy.preview;
                return copy;
            });
            this._pendingOutgoing = {
                content,
                typed,
                quickTaskId: fromPreset ? null : this._selectedQuickTaskId,
                attachments,
                handoff: true
            };
            this.pendingAttachments = [];
            this.renderAttachChips();
            this._selectedQuickTaskId = null;
            if (this.directorChatInput) {
                this.directorChatInput.value = '';
                this.autoExpandTextarea(this.directorChatInput);
            }
            this._skipQuickStart = true;
            this.removeQuickStart();
            this.placeComposer(false, true);
            this.showTypingIndicator();
            this._creatingChat = true;
            if (!this.beginServerChat()) {
                this._creatingChat = false;
                this.restorePendingOutgoing();
            }
            return;
        }
        this.dispatchOutgoing({
            content,
            attachments: null
        });
    }

    restorePendingOutgoing() {
        const pending = this._pendingOutgoing;
        this._pendingOutgoing = null;
        this._skipQuickStart = false;
        this.hideTypingIndicator();
        if (!pending) return;
        this.pendingAttachments = pending.attachments || [];
        this._selectedQuickTaskId = pending.quickTaskId || null;
        if (this.directorChatInput) {
            this.directorChatInput.value = pending.typed || '';
            this.autoExpandTextarea(this.directorChatInput);
        }
        this.renderAttachChips();
        if (!this.currentSession || this.currentSession.draft) this.showNewSessionDraft();
    }

    dispatchOutgoing(pending) {
        const content = (pending && pending.content ? pending.content : '').trim();
        const attachments = pending && pending.attachments
            ? pending.attachments
            : this.pendingAttachments.map((item) => {
                const copy = { ...item };
                delete copy.preview;
                return copy;
            });
        const handoff = !!(pending && pending.handoff);
        if (!this.currentSession || !this.currentSession.id || (!content && !attachments.length)) {
            if (handoff) this._skipQuickStart = false;
            return;
        }
        // Keep the first-send flag until the turn ends so a late empty
        // get_messages does not wipe the optimistic bubble. A normal send clears it.
        if (!handoff) this._skipQuickStart = false;
        if (this._renderMessagesTimeout) {
            clearTimeout(this._renderMessagesTimeout);
            this._renderMessagesTimeout = null;
        }
        this._selectedQuickTaskId = null;
        this.removeQuickStart();
        if (this.directorSessionChat && this.directorSessionChat.classList.contains('director-composer-center')) {
            this.placeComposer(false, true);
        }

        const userMessage = {
            role: 'user',
            content: content,
            user_input: content,
            message_type: 'Ask',
            timestamp: new Date().toISOString()
        };
        this.currentSession.messages = this.currentSession.messages || [];
        this.currentSession.messages.push(userMessage);
        this._animateRows = true;
        const messageElement = this.createMessageElement(userMessage);
        this._animateRows = false;
        if (messageElement && this.directorChatMessages) {
            this.directorChatMessages.appendChild(messageElement);
        }
        if (!pending || !pending.attachments) {
            if (this.directorChatInput) this.directorChatInput.value = '';
            this.autoExpandTextarea(this.directorChatInput);
            this.pendingAttachments = [];
            this.renderAttachChips();
        }
        this.scrollToBottom();
        this.showTypingIndicator();

        const changeJson = this.snapshotStudioChange();
        if (window.wsClient && window.wsClient.isConnected()) {
            this._running = true;
            this._runningSessionId = this.currentSession.id;
            this._settledSessionId = null;
            this._turnPrints = 0;
            this._turnModel = {
                id: this.selectedModel || 'grok-4.7',
                effort: this.selectedEffort || 'medium',
                fast: this.fast === true
            };
            this.updateTrayChrome();
            const stayWorkspace = this.sessionWorkspaceIdForSend();
            window.wsClient.send({
                type: 'director_send_message',
                requestId: Date.now().toString(),
                persona: this.persona || 'wren',
                sessionId: this.currentSession.id,
                content: content,
                effort: this.selectedEffort || 'medium',
                fast: this.fast === true,
                model: this.selectedModel || 'grok-4.7',
                context: this.selectedContext || '',
                thinking: this.thinkingToggle() ? this.thinking === true : this.selectedEffort !== 'none',
                attachments: attachments,
                changeJson: changeJson,
                workspaceId: stayWorkspace,
                steer: !!(pending && pending.steer),
                // WebSocketClient: public/scripts/websocket.js
                clientId: WebSocketClient.readStoredAgentClientId()
            });
        } else if (handoff) {
            this._skipQuickStart = false;
        }
    }

    // Get precise reference data for director messages
    showTypingIndicator(content = null) {
        if (!this.directorChatMessages) return;
        let typingDiv = this.directorChatMessages.querySelector('.director-typing-indicator');
        if (!typingDiv) {
            typingDiv = document.createElement('div');
            typingDiv.className = 'director-typing-indicator';
            typingDiv.innerHTML = `
                <div class="director-typing-dots" title="Working">
                    <div class="director-typing-dot"></div>
                    <div class="director-typing-dot"></div>
                    <div class="director-typing-dot"></div>
                </div>
                <div class="director-streaming-content"></div>
            `;
        }
        if (typingDiv.parentNode !== this.directorChatMessages || typingDiv !== this.directorChatMessages.lastElementChild) {
            this.directorChatMessages.appendChild(typingDiv);
        }
        if (content) this.updateTypingIndicator(content);
    }
    
    hideTypingIndicator() {
        if (!this.directorChatMessages) return;
        const typingIndicator = this.directorChatMessages.querySelector('.director-typing-indicator');
        if (typingIndicator) typingIndicator.remove();
    }

    updateTypingIndicator(content) {
        const typingIndicator = this.directorChatMessages.querySelector('.director-typing-indicator');
        if (typingIndicator) {
            const contentDiv = typingIndicator.querySelector('.director-streaming-content');
            if (contentDiv) {
                const textDiv = contentDiv.querySelector('.director-streaming-text');
                // Show only the last 200 characters of the content
                const displayContent = content.length > 200 ? content.slice(-200) : content;
                if (textDiv) {
                    textDiv.textContent = this.formatStreamingContent(displayContent);
                } else {
                    // Create text div if it doesn't exist
                    const textDiv = document.createElement('div');
                    textDiv.className = 'director-streaming-text';
                    textDiv.textContent = this.formatStreamingContent(displayContent);
                    contentDiv.appendChild(textDiv);
                }
            }
        } else {
            // If typing indicator doesn't exist, create it with content
            this.showTypingIndicator(content);
        }
    }

    formatStreamingContent(content) {
        // Clean up the streaming content for display
        let formatted = content
            .replace(/\n/g, ' ') // Replace newlines with spaces
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .trim();

        // Limit length to prevent overflow
        if (formatted.length > 200) {
            formatted = formatted.substring(0, 200) + '...';
        }

        return formatted;
    }
    
    addMessageToChat(data, role) {
        // Extract the actual message content from the response
        let messageContent = data.clientResponse?.Description || data.clientResponse?.message || data.clientResponse?.content || data?.clientResponse || data;

        // If response is an object with Description field (SI analysis response)
        if (typeof messageContent === 'object' && messageContent !== null) {
            messageContent = JSON.stringify(messageContent, null, 2);
        } else {
            messageContent = messageContent || data;
        }

        // Create a message object in the expected format
        const message = {
            role: role,
            content: messageContent,
            timestamp: new Date().toISOString(),
            data: data.data || null
        };

        // Add message to current session data
        if (window.currentSession) {
            window.currentSession.messages = window.currentSession.messages || [];
            window.currentSession.messages.push(message);
            assignTrimmedDirectorSessionMessages(window.currentSession, window.currentSession.messages);
        }

        // Create and append the message element with optimized DOM operations
        const messageElement = this.createMessageElement(message);
        if (messageElement) {
            // Use document fragment for better performance
            const fragment = document.createDocumentFragment();
            fragment.appendChild(messageElement);
            this.directorChatMessages.appendChild(fragment);
        }

        // Scroll to bottom
        this.scrollToBottom();

        // Auto-apply prompt if auto-generate is enabled and message contains a prompt
    }

    // Check and auto-apply prompt if conditions are met
    getSessionPreviewImage(session) {
        // Generate preview image path based on image type
        if (session.filename) {
            if (session.image_type === 'cache' || session.image_type === 'sessions') {
                // For cache images, use cache preview
                return localCachePreviewUrl(`${session.filename}.webp`);
            } else {
                // For generated images, use previews directory
                const baseName = session.filename.split('.').slice(0, -1).join('.');
                // localGalleryPreviewUrl: public/scripts/comp/assetUrlResolver.js
                return localGalleryPreviewUrl(`${baseName}.webp`);
            }
        }
        return '/static_images/background.jpg';
    }
    
    updateIndicator(button, isActive) {
        if (!button) return;
        if (isActive) {
            button.setAttribute('data-state', 'on');
        } else {
            button.setAttribute('data-state', 'off');
        }
    }

    // Toggle auto-generate functionality
    toggleAutoGenerate() {
        this.autoGenerateEnabled = !this.autoGenerateEnabled;
        this.updateIndicator(this.directorAutoGenerateBtn, this.autoGenerateEnabled);

        const status = this.autoGenerateEnabled ? 'enabled' : 'disabled';
        showGlassToast('info', null, `Auto-generate ${status}`);
    }

    // Toggle session preview expansion
    toggleSessionPreview() {
        if (!this.directorSessionPreviewExpanded) return;

        const isExpanded = !this.directorSessionPreviewExpanded.classList.contains('hidden');

        if (isExpanded) {
            // Slide up - hide the expanded preview
            this.directorSessionPreviewExpanded.classList.add('hidden');
            this.removePreviewClickOutsideHandler();
        } else {
            // Slide down - show the expanded preview
            this.directorSessionPreviewExpanded.classList.remove('hidden');
            this.addPreviewClickOutsideHandler();
        }
    }

    // Add click outside handler to close expanded preview
    addPreviewClickOutsideHandler() {
        if (this.previewClickOutsideHandler) return;

        this.previewClickOutsideHandler = (event) => {
            const container = this.directorSessionPreview.closest('.director-session-preview-container');
            if (!container.contains(event.target)) {
                this.toggleSessionPreview();
            }
        };

        if (this._previewClickOutsideScope) {
            this._previewClickOutsideScope.abort();
        }
        this._previewClickOutsideScope = new AbortController();
        document.addEventListener('click', this.previewClickOutsideHandler, { signal: this._previewClickOutsideScope.signal });
    }

    // Remove click outside handler
    removePreviewClickOutsideHandler() {
        if (this._previewClickOutsideScope) {
            this._previewClickOutsideScope.abort();
            this._previewClickOutsideScope = null;
        }
        this.previewClickOutsideHandler = null;
    }

    // Director WebSocket message handlers
    setupDirectorWebSocketHandlers() {
        if (this._directorWsHandlersWired) return;
        this._directorWsHandlersWired = true;

        // Handle Director sessions response
        window.wsClient.on('director_get_models_response', (data) => {
            if (window.directorInstance && data.data && Array.isArray(data.data.models)) {
                window.directorInstance.applyModelCatalog(data.data.models);
            }
        });

        window.wsClient.on('director_get_cursor_usage_response', (data) => {
            const director = window.directorInstance;
            if (!director) return;
            const body = data.data || {};
            const asked = director.persona || 'wren';
            if (body.persona && body.persona !== asked) return;
            director.paintCursorUsage(body);
        });

        // Tray state + the computer's CPU / memory. Pushed on turn start, turn
        // end, abort and error; the response is the tray menu's own read.
        const applyStatus = (data) => {
            if (window.directorInstance) {
                window.directorInstance.applyDirectorStatus(data.data || data);
            }
        };
        window.wsClient.on('director_computer_status', applyStatus);
        window.wsClient.on('director_computer_status_response', applyStatus);

        // set_session_tasks / set_session_task / close_session_tasks saved the list
        window.wsClient.on('director_session_tasks', (data) => {
            const body = data.data || data;
            if (window.directorInstance) {
                window.directorInstance.applySessionTasks(body.sessionId, body.tasks);
            }
        });

        // set_session_title named the chat
        window.wsClient.on('director_session_renamed', (data) => {
            const body = data.data || data;
            if (window.directorInstance) {
                window.directorInstance.applySessionName(body.sessionId, body.name);
            }
        });

        window.wsClient.on('director_open_workspace_response', (data) => {
            const director = window.directorInstance;
            if (!director || director._pendingWorkspaceToken == null) return;
            if (data.data && director.packetPersona(data.data) !== director.persona) {
                director._pendingWorkspaceToken = null;
                return;
            }
            director._pendingWorkspaceToken = null;
            const resume = director._resumeImage;
            director._resumeImage = null;
            if (data.data && data.data.success && data.data.session) {
                director.showSessionChat(data.data.session);
                return;
            }
            director.showNewSessionDraft();
            if (resume && resume.filename) {
                const already = director.pendingAttachments.some((item) => item.source === 'workspace' && item.filename === resume.filename);
                if (!already) {
                    director.pendingAttachments.push({ source: 'workspace', filename: resume.filename, name: resume.name || resume.filename });
                    director.renderAttachChips();
                }
            }
        });

        window.wsClient.on('director_get_sessions_response', (data) => {
            const director = window.directorInstance;
            if (!director || !data.data || !data.data.success) return;
            if (director.packetPersona(data.data) !== director.persona) return;
            director.directorSessions = data.data.sessions || [];
            window.directorSessions = director.directorSessions;
            if (data.data.activeAccountId) director.activeAccountId = data.data.activeAccountId;
            if (Array.isArray(data.data.accounts)) director.cursorAccounts = data.data.accounts;
            director.paintAccountBadge();
            director.renderDirectorSessions();
        });

        // Handle Director create session response
        window.wsClient.on('director_create_session_response', async (data) => {
            const director = window.directorInstance;
            if (!director) return;
            const body = data && data.data;
            if (body && director.packetPersona(body) !== director.persona) {
                director._creatingChat = false;
                return;
            }
            if (!body || !body.success || !body.session) {
                director._creatingChat = false;
                director._askWrenOpening = false;
                director._focusComposer = false;
                director._askWrenApplet = false;
                if (director._pendingOutgoing) director.restorePendingOutgoing();
                showGlassToast('error', null, (data && data.message) || 'Could not start a new session');
                return;
            }
            const newSession = body.session;
            director.rememberSessionModel(newSession.id);
            const pending = director._pendingOutgoing;
            director._pendingOutgoing = null;
            director._creatingChat = false;
            if (!pending) {
                const keepDraft = director._focusComposer === true;
                if (!keepDraft) {
                    director.pendingAttachments = [];
                    if (director.directorChatInput) {
                        director.directorChatInput.value = '';
                        director.autoExpandTextarea(director.directorChatInput);
                    }
                    director.renderAttachChips();
                }
            }
            if (pending) {
                director._skipQuickStart = true;
                await director.showSessionChat(newSession, { skipLoad: true });
                director.dispatchOutgoing(pending);
                director.rememberListedSession(newSession);
                return;
            }
            if (director.sessionIsListed(newSession)) director.rememberListedSession(newSession);
            const askApplet = director._askWrenApplet === true;
            director._askWrenApplet = false;
            const studioAlreadyOpen = director.studioIsOpen();
            if (askApplet && !studioAlreadyOpen) {
                director._openPreferredId = newSession.id;
                await director.openDirectorWindow();
                await director.showSessionChat(newSession);
                director.loadDirectorSessions();
                return;
            }
            if (!studioAlreadyOpen && !director.directorWindowIsOpen()) {
                await openManualModalWithContent({ type: 'none', skipPreviewRestore: true });
            }
            if (director.directorBtn && director.directorBtn.disabled) {
                director.directorBtn.disabled = false;
                director.directorBtn.classList.remove('disabled');
            }
            await director.showDirector({ skipSession: true });
            await director.showSessionChat(newSession);
            director.loadDirectorSessions();
        });

        // Handle Director send message response
        window.wsClient.on('director_send_message_response', (data) => {
            const director = window.directorInstance;
            const sessionId = data && data.data && data.data.sessionId;
            if (sessionId && window.currentSession && sessionId !== window.currentSession.id) return;
            if (director && window.currentSession && window.currentSession.id) {
                director.requestCursorUsage();
            }
        });
        
        // Handle Director get messages response
        window.wsClient.on('director_get_messages_response', (data) => {
            if (data.data && data.data.success) {
                const director = window.directorInstance;
                const sessionId = data.data.sessionId;
                if (director && sessionId && director.currentSession && sessionId !== director.currentSession.id) {
                    return;
                }
                if (director && sessionId && director._messagesSessionId && sessionId !== director._messagesSessionId) {
                    return;
                }
                const messages = data.data.messages || [];
                if (director) {
                    // Only while the first send is still handing off. A later empty
                    // list is a real reload (failed send, or the chat is empty).
                    if (!messages.length && (director._creatingChat || director._pendingOutgoing || director._skipQuickStart)) {
                        return;
                    }
                    // chat.images is authoritative on the server; a reopen resyncs the strip
                    if (director.currentSession && Array.isArray(data.data.prints)) {
                        director.currentSession.prints = data.data.prints;
                    }
                    if (Array.isArray(data.data.images) && director.currentSession) {
                        director.currentSession.images = data.data.images;
                        director.renderSessionImages();
                    }
                    // Same for chat.tasks, so a reopened chat shows the saved list
                    if (data.data.name) director.applySessionName(sessionId, data.data.name);
                    director.applySessionTasks(sessionId, data.data.tasks);
                    if (director.currentSession) director.currentSession.messages = messages;
                    if (director._expectSettle) {
                        director._settleTurn = true;
                        director._expectSettle = false;
                    }
                    director.renderSessionMessages(messages);
                    if (director.currentSession && director.currentSession.id === sessionId) {
                        director.applySessionModel(director.currentSession);
                    }
                }
            } else {
                console.warn('❌ director_get_messages_response failed:', data);
            }
        });
        
        // Handle Director delete session response
        window.wsClient.on('director_delete_session_response', async (data) => {
            const director = window.directorInstance;
            if (!director || !data.data || !data.data.success) return;
            const wasCurrent = director._deleteWasCurrent === true;
            director._deleteWasCurrent = false;
            try {
                await director.loadDirectorSessions();
            } catch (_err) {
                director.renderDirectorSessions();
            }
            if (!wasCurrent) return;
            director._selectedQuickTaskId = null;
            director._welcomeQuip = null;
            director.showNewSessionDraft();
        });
        
        // Handle Director typing start
        window.wsClient.on('director_typing_start', (data) => {
            if (data.data && data.data.sessionId === window.currentSession?.id) {
                if (window.directorInstance) {
                    window.directorInstance.showTypingIndicator();
                }
            }
        });
        
        // Handle Director typing stop
        window.wsClient.on('director_typing_stop', (data) => {
            if (data.data && data.data.sessionId === window.currentSession?.id) {
                if (window.directorInstance) {
                    window.directorInstance.hideTypingIndicator();
                }
            }
        });

        // Handle Director streaming updates
        window.wsClient.on('director_streaming_update', (data) => {
            const payload = data && data.data;
            if (payload && payload.seq != null && window.wsClient.isConnected()) {
                window.wsClient.send({
                    type: 'director_streaming_ack',
                    sessionId: payload.sessionId,
                    seq: payload.seq
                });
            }
            // A late flush for a turn that already ended must not re-arm "running".
            if (payload && window.directorInstance && payload.sessionId === window.directorInstance._settledSessionId) return;
            if (payload && window.directorInstance && window.directorInstance._steer && payload.sessionId === window.directorInstance._steer.sessionId) return;
            if (payload && payload.sessionId === window.currentSession?.id && window.directorInstance) {
                if (!window.directorInstance._running || window.directorInstance._runningSessionId !== payload.sessionId) {
                    window.directorInstance._running = true;
                    window.directorInstance._runningSessionId = payload.sessionId;
                    window.directorInstance.updateTrayChrome();
                }
                if (payload.context && window.currentSession) {
                    window.currentSession.contextTokens = payload.context.tokens;
                    window.currentSession.contextPercent = payload.context.percent;
                    window.directorInstance.paintContext(payload.context, false);
                }
                if (payload.rows || payload.live) {
                    window.directorInstance.renderLiveTrace(payload);
                } else {
                    window.directorInstance.updateTypingIndicator(payload.fullContent);
                }
            }
        });
        
        // Handle Director message response
        window.wsClient.on('director_message_response', (data) => {
            if (data.data && data.data.steer && window.directorInstance) {
                window.directorInstance.finishTurn(data.data.sessionId);
                return;
            }
            if (data.data && window.directorInstance) {
                window.directorInstance.finishTurn(data.data.sessionId);
                if (data.data.context && window.currentSession && data.data.sessionId === window.currentSession.id) {
                    window.currentSession.contextTokens = data.data.context.tokens;
                    window.currentSession.contextPercent = data.data.context.percent;
                    window.directorInstance.paintContext(data.data.context, false);
                }
            }
            if (data.data && data.data.success && data.data.sessionId === window.currentSession?.id) {
                if (window.directorInstance && window.currentSession) {
                    window.directorInstance._expectSettle = true;
                    window.directorInstance.hideTypingIndicator();
                    window.directorInstance.loadSessionMessages(window.currentSession.id);
                }
                
                // Same rename path as set_session_title (director_session_renamed)
                if (data.data.response && data.data.response.SuggestedName && window.directorInstance) {
                    window.directorInstance.applySessionName(data.data.sessionId, data.data.response.SuggestedName);
                }
                
                if (window.directorInstance) {
                    window.directorInstance.hideTypingIndicator();
                }
                
                // Reload session messages to ensure we have the latest data from the server
                // This ensures any server-side processing or updates are reflected in the UI
                //if (window.directorInstance && window.currentSession) {
                //    window.directorInstance.loadSessionMessages(window.currentSession.id);
                //}
            }
        });
        
        // Handle Director message error
        window.wsClient.on('director_message_error', (data) => {
            const director = window.directorInstance;
            if (director && data.data && director._deleteTargetId && data.data.sessionId === director._deleteTargetId) return;
            const steering = !!(director && director._steer && data.data && director._steer.sessionId === data.data.sessionId);
            if (data.data && director) {
                director.finishTurn(data.data.sessionId);
                if (steering) return;
                if (data.data.context && window.currentSession && data.data.sessionId === window.currentSession.id) {
                    window.currentSession.contextTokens = data.data.context.tokens;
                    window.currentSession.contextPercent = data.data.context.percent;
                    window.directorInstance.paintContext(data.data.context, false);
                }
            }
            if (data.data && data.data.sessionId === window.currentSession?.id) {
                console.error('Director message error:', data.data.error);
                if (window.directorInstance) {
                    window.directorInstance._skipQuickStart = false;
                    window.directorInstance.hideTypingIndicator();
                    if (window.currentSession) {
                        window.directorInstance.loadSessionMessages(window.currentSession.id);
                    }
                }
                showGlassToast('error', null, data.data.error || 'Failed to send message');
            }
        });

        // Handle Director rollback message response
        window.wsClient.on('director_fork_session_response', async (data) => {
            const director = window.directorInstance;
            const body = data && data.data;
            if (!director || !body || !body.success || !body.session) {
                showGlassToast('error', 'Director', (body && body.message) || 'Could not fork that chat');
                return;
            }
            if (director.packetPersona(body) !== director.persona) return;
            director.directorSessions = [body.session].concat(
                (director.directorSessions || []).filter((item) => item.id !== body.session.id)
            );
            window.directorSessions = director.directorSessions;
            director.renderDirectorSessions();
            showGlassToast('success', 'Director', body.fullCopy
                ? 'Copied the session. The original chat is unchanged.'
                : 'Forked from that message. The original chat is unchanged.');
            await director.showSessionChat(body.session, { skipLoad: true });
        });

        window.wsClient.on('director_rollback_message_response', async (data) => {
            if (data.data && data.data.success) {
                showGlassToast('success', null, data.data.message || 'Messages rolled back successfully');
                if (data.data.changeJson && typeof applyStudioChangePayloadSilent === 'function') {
                    // applyStudioChangePayloadSilent: public/scripts/comp/studioChangeJson.js
                    await applyStudioChangePayloadSilent(data.data.changeJson);
                }
                if (window.directorInstance && window.currentSession) {
                    window.directorInstance.loadSessionMessages(window.currentSession.id);
                    setTimeout(() => window.directorInstance.scrollToBottom(), 100);
                }
                if (data.data.retryText && window.directorInstance) {
                    window.directorInstance.directorChatInput.value = data.data.retryText;
                    window.directorInstance.sendMessage();
                }
            }
        });

        // Latest headless-browser screenshot for a chat — shown only in #directorWindow for the current session
        window.wsClient.on('director_browser_preview', (data) => {
            if (window.directorInstance) {
                window.directorInstance.showBrowserPreview(data.data || data);
            }
        });

        // show_chat_image put a picture in the thread (modules/mcpAgentFacade.js)
        window.wsClient.on('director_chat_image', (data) => {
            if (window.directorInstance) {
                window.directorInstance.appendChatCard('chat-image', data.data || data);
            }
        });

        // offer_workspace_switch offered a jump; the button uses setActiveWorkspace
        window.wsClient.on('director_workspace_offer', (data) => {
            if (window.directorInstance) {
                window.directorInstance.appendChatCard('workspace-offer', data.data || data);
            }
        });

        // request_workspace_switch: 90s card. Accept switches the open workspace.
        window.wsClient.on('director_workspace_switch', (data) => {
            if (window.directorInstance) {
                window.directorInstance.appendChatCard('workspace-switch', data.data || data);
            }
        });

        window.wsClient.on('director_move_session_response', (data) => {
            const director = window.directorInstance;
            const body = data && data.data;
            if (!director || !body || !body.success || !body.session) {
                showGlassToast('error', 'Director', (body && (body.message || body.error)) || 'Could not move that session');
                return;
            }
            if (director.packetPersona(body) !== director.persona) return;
            const session = body.session;
            const listed = (director.directorSessions || []).find((item) => item.id === session.id);
            if (listed) listed.workspaceId = session.workspaceId;
            if (director.currentSession && director.currentSession.id === session.id) {
                director.currentSession.workspaceId = session.workspaceId;
                director.paintWorkspaceBanner();
            }
            director.renderDirectorSessions();
            const meta = director.sessionWorkspaceMeta(session);
            showGlassToast('success', 'Director', meta ? `Session now belongs to ${meta.name}` : 'Session moved');
        });

        // A print this turn saved — becomes the session thumbnail and joins the session strip
        window.wsClient.on('director_session_image', (data) => {
            if (window.directorInstance) {
                window.directorInstance.noteSessionImage(data.data || data);
            }
        });

        // Handle Director messages updated (for rollback notifications)
        window.wsClient.on('director_messages_updated', (data) => {
            if (data.data && data.data.sessionId === window.currentSession?.id) {
                if (data.data.action === 'rollback' && window.directorInstance && window.currentSession) {
                    window.directorInstance.loadSessionMessages(window.currentSession.id);
                    // Ensure scroll to bottom after rollback
                    setTimeout(() => window.directorInstance.scrollToBottom(), 100);
                }
            }
        });
    }

    toggleExpandable(button) {
        const content = button && button.nextElementSibling;
        if (!content) return;
        content.classList.toggle('hidden');
    }

    useSuggestion(suggestionText) {
        // Get the chat input and send button
        const directorChatInput = this.directorChatInput;
        const directorSendBtn = this.directorSendBtn;
        
        if (!directorChatInput || !directorSendBtn) {
            console.warn('❌ Chat input or send button not found');
            return;
        }
        
        // Set the input text with the suggestion
        const currentText = this.directorChatInput.value.trim();
        let messageText;

        if (currentText) {
            // If there's existing text, append the suggestion with ", and "
            if (currentText.includes('Lets execute your suggestion')) {
                messageText = `${currentText}, and "${suggestionText}"`;
            } else {
                messageText = `${currentText}, and lets execute your suggestion: "${suggestionText}"`;
            }
        } else {
            // If no existing text, use the original format with quotes
            messageText = `Lets execute your suggestion: "${suggestionText}"`;
        }

        this.directorChatInput.value = messageText;

        // Auto-expand textarea to fit new content
        this.autoExpandTextarea(this.directorUserInput);

        // Focus on the input
        this.directorChatInput.focus();
        
        // Show a toast notification
        showGlassToast('info', null, 'Suggestion added to input. Click send to apply.');
    }

    // Initialize custom scrollbars for director content
    initializeScrollbars() {
        try {
            // Trigger CustomScrollbar to check for new scrollable elements
            if (window.customScrollbar && typeof window.customScrollbar.initExistingElements === 'function') {
                // Small delay to ensure DOM is updated
                setTimeout(() => {
                    try {
                        window.customScrollbar.initExistingElements();
                    } catch (error) {
                        console.warn('Error in customScrollbar.initExistingElements():', error);
                    }
                }, 10);
            }
        } catch (error) {
            console.warn('Error initializing scrollbars:', error);
        }
    }

    // Rollback to a specific message
    dropFromMessage(messageKey) {
        const root = this.directorChatMessages;
        const node = root && root.querySelector(`[data-message-key="${CSS.escape(String(messageKey))}"]`);
        if (node) {
            let el = node;
            while (el) {
                const next = el.nextElementSibling;
                el.remove();
                el = next;
            }
        }
        const messages = this.currentSession && this.currentSession.messages;
        if (!Array.isArray(messages)) return;
        const index = messages.findIndex((item) => String(item && (item.id || item.timestamp)) === String(messageKey));
        if (index >= 0) messages.splice(index);
    }

    retryMessage(messageKey) {
        this._rollbackRetry = true;
        this.rollbackToMessage(messageKey);
    }

    async rollbackToMessage(messageKey, options) {
        const retry = (options && options.retry === true) || this._rollbackRetry === true;
        const skipConfirm = !!(options && options.skipConfirm);
        this._rollbackRetry = false;
        if (!this.currentSession) return;

        const key = String(messageKey || '');
        if (key.startsWith('live:')) {
            showGlassToast('error', null, 'That row is still streaming');
            return;
        }
        const colon = key.indexOf(':');
        const messageId = colon > 0 ? key.slice(0, colon) : key;
        if (!messageId) return;

        const messageElement = this.directorChatMessages && this.directorChatMessages.querySelector(`[data-message-key="${CSS.escape(key)}"]`);
        if (!messageElement) {
            showGlassToast('error', null, 'Message not found');
            return;
        }

        if (!skipConfirm) {
            const choice = await showConfirmationDialog(
                retry
                    ? 'Keep this reply, revert to this message and ask again, or cancel.'
                    : 'Keep this reply, revert to this message, or cancel.',
                [
                    { text: 'Keep', value: 'keep', className: 'btn-primary' },
                    { text: 'Revert', value: 'revert', className: 'btn-danger' },
                    { text: 'Cancel', value: 'cancel', className: 'btn-secondary' }
                ],
                null,
                { title: retry ? 'Restart message' : 'Revert message', icon: 'fas fa-undo' }
            );
            if (choice !== 'revert') return;
        }
        this.dropFromMessage(key);

        // Send rollback request
        if (window.wsClient && window.wsClient.isConnected()) {
            window.wsClient.send({
                type: 'director_rollback_message',
                requestId: Date.now().toString(),
                persona: this.persona || 'wren',
                sessionId: this.currentSession.id,
                messageId: messageId,
                retry: retry
            });

            showGlassToast('info', null, 'Rolling back messages...');
        } else {
            showGlassToast('error', null, 'WebSocket not connected');
        }
    }

    // Scroll to bottom of chat messages
    scrollToBottom(onlyIfNear) {
        const el = this.directorScrollEl();
        if (!el) return;
        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        if (onlyIfNear && max - el.scrollTop > 64) return;
        setTimeout(() => {
            const scroller = this.directorScrollEl();
            if (!scroller) return;
            scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        }, 10);
    }

    // Markdown to HTML. Code is pulled out before italics so underscores inside snippets stay.
    processMarkdown(markdownText) {
        if (!markdownText || typeof markdownText !== 'string') {
            return markdownText;
        }
        const stash = [];
        const hold = (html) => {
            const mark = `\uE000${stash.length}\uE001`;
            stash.push(html);
            return mark;
        };
        let text = markdownText.replace(/\r\n/g, '\n');
        text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
            const body = this.escapeHtml(String(code).replace(/^\n|\n$/g, ''));
            return hold(`<pre><code>${body}</code></pre>`);
        });
        text = text.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${this.escapeHtml(code)}</code>`));
        text = this.escapeHtml(text);
        text = text.replace(/^### (.*)$/gim, '<h3>$1</h3>');
        text = text.replace(/^## (.*)$/gim, '<h2>$1</h2>');
        text = text.replace(/^# (.*)$/gim, '<h1>$1</h1>');
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
        text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>');
        text = text.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>');
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        const lines = text.split('\n');
        const out = [];
        let list = null;
        const closeList = () => {
            if (!list) return;
            out.push(list === 'ol' ? '</ol>' : '</ul>');
            list = null;
        };
        lines.forEach((line, index) => {
            const bullet = /^(?:[-*])\s+(.*)$/.exec(line);
            const numbered = /^\d+\.\s+(.*)$/.exec(line);
            if (bullet || numbered) {
                const kind = numbered ? 'ol' : 'ul';
                if (list !== kind) {
                    closeList();
                    out.push(kind === 'ol' ? '<ol>' : '<ul>');
                    list = kind;
                }
                out.push(`<li>${(numbered || bullet)[1]}</li>`);
                return;
            }
            closeList();
            if (index > 0) out.push('<br>');
            out.push(line);
        });
        closeList();
        let html = out.join('');
        stash.forEach((chunk, index) => {
            html = html.split(`\uE000${index}\uE001`).join(chunk);
        });
        return html;
    }
}

function askWrenAboutImage(filename, name) {
    // Director.askWrenAboutImage: this file
    if (!directorInstance) return;
    directorInstance.askWrenAboutImage(filename, name);
}

async function startExpandCanvasChat(content, attachments) {
    // Director.startExpandCanvasChat: this file
    if (!window.directorInstance) await initializeDirector();
    return window.directorInstance.startExpandCanvasChat(content, attachments);
}

// Global Director instance
window.directorInstance = null;

// Initialize the Director

function initializeDirector() {
    if (!window.directorInstance) {
        window.directorInstance = new Director();
    }
    return window.directorInstance.init();
}

// Start menu launchId `director` (modalUtils.js), tray Open, and agent open_application land here
async function openDirectorWindow() {
    if (!window.directorInstance) {
        await initializeDirector();
    }
    return window.directorInstance.openDirectorWindow();
}

// Called from startBackgroundTrayServices (systemTrayManager.js) and Director.init
function initializeDirectorTray() {
    const director = window.directorInstance;
    if (!director || !director.directorTrayIcon || director._trayInitialized) return;
    if (!window.isDesktop) {
        director.directorTrayIcon.classList.add('hidden');
        return;
    }
    director.setupTray();
    director._trayInitialized = true;
}

// Try to register immediately, or wait for wsClient to be available
if (window.wsClient) {
    window.wsClient.registerInitStep(60, 'Initializing Director System', async () => {
        await initializeDirector();
    });
}