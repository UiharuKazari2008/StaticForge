/**
 * Novel manager — Enshutsuka story notes tied to image generation.
 * Depends on: websocket.js, modalUtils.js, notes via wsClient
 */

const NOVEL_DEFAULT_SETTINGS = {
    tone: 'neutral',
    style: 'literary',
    explicitness: 'moderate',
    persuasiveness: 'neutral',
    auto_generate: true
};

const NOVEL_TONE_OPTIONS = [
    { value: 'neutral', label: 'Neutral' },
    { value: 'intimate', label: 'Intimate' },
    { value: 'dramatic', label: 'Dramatic' },
    { value: 'playful', label: 'Playful' },
    { value: 'melancholic', label: 'Melancholic' }
];

const NOVEL_STYLE_OPTIONS = [
    { value: 'literary', label: 'Literary' },
    { value: 'pulpy', label: 'Pulpy' },
    { value: 'diary', label: 'Diary' },
    { value: 'screenplay', label: 'Screenplay' },
    { value: 'neutral', label: 'Neutral' }
];

const NOVEL_EXPLICITNESS_OPTIONS = [
    { value: 'sfw', label: 'SFW' },
    { value: 'mild', label: 'Mild' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'explicit', label: 'Explicit' }
];

const NOVEL_PERSUASIVENESS_OPTIONS = [
    { value: 'subtle', label: 'Subtle' },
    { value: 'neutral', label: 'Neutral' },
    { value: 'forceful', label: 'Forceful' }
];

function novelCountStoryLines(content) {
    if (!content || typeof content !== 'string') return 0;
    const lines = content.split('\n');
    if (lines.length === 1 && lines[0] === '') return 0;
    return lines.length;
}

function novelGetStorySegmentAfterCursor(content, cursorLine) {
    if (!content || typeof content !== 'string') return '';
    const lines = content.split('\n');
    if (lines.length === 1 && lines[0] === '') return '';
    const cursor = Math.max(0, parseInt(cursorLine, 10) || 0);
    return lines.slice(cursor).join('\n').trim();
}

function novelNormalizeMetadata(metadata) {
    const meta = metadata && typeof metadata === 'object' ? { ...metadata } : {};
    meta.settings = { ...NOVEL_DEFAULT_SETTINGS, ...(meta.settings || {}) };
    if (!Array.isArray(meta.linked_images)) meta.linked_images = [];
    if (!Array.isArray(meta.undo_stack)) meta.undo_stack = [];
    if (typeof meta.story_cursor_line !== 'number') meta.story_cursor_line = 0;
    return meta;
}

function novelGetBtn() {
    return document.getElementById('novelBtn');
}

function novelIsEnabled() {
    const btn = novelGetBtn();
    return btn && btn.dataset.state === 'on';
}

function novelIsAdvanceResumed() {
    const btn = novelGetBtn();
    return btn && btn.dataset.resumeAdvancement === 'true';
}

function novelResetAdvanceResume() {
    const btn = novelGetBtn();
    if (btn) btn.dataset.resumeAdvancement = 'false';
}

function novelGetCreativeDirective() {
    const el = document.getElementById('creativeDirectiveInput');
    const inputVal = el && el.value ? el.value.trim() : '';
    if (inputVal) return inputVal;

    // Fall back to directive stored in the active image metadata (older images may not hydrate the input)
    const meta = novelGetActiveImageMetadata?.() || null;
    const fromDynamic = meta?.dynamic_generation?.directive || meta?.forge_data?.dynamic_generation?.directive;
    if (fromDynamic && String(fromDynamic).trim()) return String(fromDynamic).trim();

    const fromSnapshot = meta?.directive_snapshot || meta?.forge_data?.directive_snapshot;
    if (fromSnapshot && String(fromSnapshot).trim()) return String(fromSnapshot).trim();

    const fromRuntimeDynamic = window.dynamicGenerationData?.directive;
    if (fromRuntimeDynamic && String(fromRuntimeDynamic).trim()) return String(fromRuntimeDynamic).trim();

    return '';
}

function novelCanEnable() {
    if (novelGetCreativeDirective()) return true;

    // Enable if the loaded image already contains compiled prompt data
    const meta = novelGetActiveImageMetadata?.() || null;
    const compiled = meta?.dynamic_generation?.compiled_prompt || meta?.forge_data?.dynamic_generation?.compiled_prompt;
    if (compiled && typeof compiled === 'object' && Object.keys(compiled).length > 0) return true;

    const dgDirective = window.dynamicGenerationData?.directive;
    if (dgDirective && String(dgDirective).trim()) return true;

    const session = window.novelSession;
    if (session && session.note && session.note.content && session.note.content.trim()) return true;
    if (session?.note?.metadata?.directive_snapshot?.trim()) return true;
    return false;
}

function novelRefreshEnableState() {
    const btn = novelGetBtn();
    if (!btn) return;
    const canEnable = novelCanEnable();
    if (!canEnable && btn.dataset.state === 'on') {
        btn.dataset.state = 'off';
        btn.classList.remove('active');
    }
    btn.disabled = !canEnable;
    btn.title = canEnable ? 'Novel' : 'Novel — add a creative directive or load an existing novel';
}

function novelGetSessionSettings() {
    const btn = novelGetBtn();
    const session = window.novelSession || {};
    const fromMeta = session.note?.metadata?.settings || {};
    return {
        tone: btn?.dataset.tone || fromMeta.tone || NOVEL_DEFAULT_SETTINGS.tone,
        style: btn?.dataset.style || fromMeta.style || NOVEL_DEFAULT_SETTINGS.style,
        explicitness: btn?.dataset.explicitness || fromMeta.explicitness || NOVEL_DEFAULT_SETTINGS.explicitness,
        persuasiveness: btn?.dataset.persuasiveness || fromMeta.persuasiveness || NOVEL_DEFAULT_SETTINGS.persuasiveness,
        auto_generate: btn?.dataset.autoGenerate !== 'false' && fromMeta.auto_generate !== false
    };
}

function novelApplySettingsToBtn(settings) {
    const btn = novelGetBtn();
    if (!btn || !settings) return;
    btn.dataset.tone = settings.tone || NOVEL_DEFAULT_SETTINGS.tone;
    btn.dataset.style = settings.style || NOVEL_DEFAULT_SETTINGS.style;
    btn.dataset.explicitness = settings.explicitness || NOVEL_DEFAULT_SETTINGS.explicitness;
    btn.dataset.persuasiveness = settings.persuasiveness || NOVEL_DEFAULT_SETTINGS.persuasiveness;
    btn.dataset.autoGenerate = settings.auto_generate === false ? 'false' : 'true';
}

async function novelEnsureNote(workspaceId) {
    if (!wsClient || !wsClient.isConnected()) return null;
    if (window.novelSession?.noteId && window.novelSession.note) {
        return window.novelSession.note;
    }
    const id = crypto.randomUUID();
    const ws = workspaceId || (typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default');
    const directive = novelGetCreativeDirective();
    const generatedImageName = window.lastGeneratedImageName || null;
    const noteData = {
        id,
        workspaceId: ws,
        note_kind: 'novel',
        icon: 'fas fa-book-open',
        color: '#9c27b0',
        content: '',
        metadata: { settings: novelGetSessionSettings() },
        directive,
        generatedImageName
    };
    const result = await wsClient.createNote(noteData);
    const note = result?.note || result?.data?.note;
    if (note) {
        window.novelSession = {
            noteId: note.id,
            note: note,
            metadata: novelNormalizeMetadata(note.metadata)
        };
    }
    return note;
}

function novelHydrateSession(note) {
    if (!note) return;
    const metadata = novelNormalizeMetadata(note.metadata);
    window.novelSession = {
        noteId: note.id,
        note: { ...note, metadata },
        metadata
    };
    if (metadata.settings) novelApplySettingsToBtn(metadata.settings);
    novelRefreshEnableState();
}

async function novelLoadNote(noteId) {
    if (!wsClient || !noteId) return null;
    const result = await wsClient.novelGet(noteId);
    const note = result?.note || result?.data?.note;
    if (note) novelHydrateSession(note);
    return note;
}

function novelApplySegmentToDynamicData(fullDynamicData) {
    if (!novelIsEnabled()) return;
    const session = window.novelSession;
    if (!session?.note) return;
    const content = session.note.content || '';
    const cursor = session.metadata?.story_cursor_line ?? session.note.metadata?.story_cursor_line ?? 0;
    const segment = novelGetStorySegmentAfterCursor(content, cursor);
    if (segment) {
        fullDynamicData.novel_segment = segment;
    }
}

function novelApplyBodyFields(requestBody) {
    if (!novelIsEnabled()) return;
    const session = window.novelSession;
    if (!session?.noteId) return;
    requestBody.novel_note_id = session.noteId;
    const meta = session.metadata || novelNormalizeMetadata(session.note?.metadata);
    requestBody.novel_story_cursor_line = meta.story_cursor_line ?? 0;
}

function novelGetActiveImageFilename() {
    const preview = window.currentManualPreviewImage;
    if (preview) {
        return preview.original || preview.filename || preview.upscaled || null;
    }
    return window.lastGeneration?.filename || null;
}

function novelGetActiveImageMetadata() {
    const preview = window.currentManualPreviewImage;
    if (preview?.metadata) {
        const filename = preview.original || preview.filename || preview.upscaled;
        return { ...preview.metadata, filename };
    }
    if (window.lastGeneration) {
        return window.lastGeneration;
    }
    return null;
}

function novelGetActiveCompiledPrompts() {
    return novelBuildCompiledPromptsPayload(novelGetActiveImageMetadata() || {});
}

function novelClearSession() {
    window.novelSession = null;
    const btn = novelGetBtn();
    if (btn) {
        btn.dataset.state = 'off';
        btn.classList.remove('active');
        btn.dataset.resumeAdvancement = 'false';
    }
    novelRefreshEnableState();
}

function novelBuildCompiledPromptsPayload(metadata) {
    if (!metadata || typeof metadata !== 'object') return {};
    const forge = metadata.forge_data || {};
    const dg = metadata.dynamic_generation || forge.dynamic_generation || {};
    const compiled = dg.compiled_prompt || {};
    const chars = forge.allCharacters
        || metadata.characterPrompts
        || metadata.compiled_characterPrompts
        || compiled.character_prompts
        || [];
    const inputPrompt = forge.input_prompt
        || metadata.prompt
        || metadata.input_prompt
        || compiled.prompt
        || compiled.text_prompt
        || '';
    const inputUc = forge.input_uc
        || metadata.uc
        || metadata.input_uc
        || compiled.uc
        || '';
    const inputPromptNegative = forge.input_prompt_negative
        || metadata.input_prompt_negative
        || compiled.input_prompt_negative
        || '';
    return {
        input_prompt: inputPrompt,
        input_uc: inputUc,
        input_prompt_negative: inputPromptNegative,
        character_prompts: (Array.isArray(chars) ? chars : []).map((c) => ({
            prompt: c.prompt || c.input_prompt || '',
            uc: c.uc || c.input_uc || ''
        })).filter((c) => c.prompt || c.uc)
    };
}

async function novelOnImageGenerated(filename, metadata) {
    if (!novelIsEnabled() || !window.novelSession?.noteId) return;
    const session = window.novelSession;
    const lineCount = novelCountStoryLines(session.note?.content || '');
    const settings = novelGetSessionSettings();
    const resumeAdvancement = novelIsAdvanceResumed();
    if (resumeAdvancement && !settings.auto_generate) {
        session.metadata = session.metadata || novelNormalizeMetadata(session.note?.metadata);
        session.metadata.story_cursor_line = lineCount;
        if (session.note) {
            session.note.metadata = novelNormalizeMetadata(session.note.metadata);
            session.note.metadata.story_cursor_line = lineCount;
        }
        if (wsClient) {
            await wsClient.novelUpdate(session.noteId, { metadata: session.metadata });
        }
    }
    if (settings.auto_generate) {
        await novelRunGenerate({
            noteId: session.noteId,
            filename,
            directive: novelGetCreativeDirective() || session.metadata?.directive_snapshot,
            compiledPrompts: novelBuildCompiledPromptsPayload(metadata),
            resumeAdvancement
        });
    }
    novelResetAdvanceResume();
}

async function novelRunGenerate(options = {}) {
    if (!wsClient || novelGenerateInFlight) return null;
    const noteId = options.noteId || window.novelSession?.noteId;
    if (!noteId) return null;

    const session = window.novelSession || {};
    const sessionMeta = session.metadata || session.note?.metadata || {};
    const payload = { ...options, noteId };

    if (!payload.filename) {
        payload.filename = novelGetActiveImageFilename();
    }
    if (!payload.compiledPrompts) {
        payload.compiledPrompts = novelGetActiveCompiledPrompts();
    }
    if (!payload.directive) {
        payload.directive = novelGetCreativeDirective() || sessionMeta.directive_snapshot || '';
    }
    if (payload.resumeAdvancement === undefined) {
        payload.resumeAdvancement = novelIsAdvanceResumed();
    }

    novelGenerateInFlight = true;
    setNovelEditorGenerateDisabled(true);
    openNovelProgressTool();
    try {
        return await wsClient.novelGenerate(payload);
    } catch (error) {
        novelGenerateInFlight = false;
        setNovelEditorGenerateDisabled(false);
        throw error;
    }
}

async function novelRunUndo() {
    const noteId = window.novelSession?.noteId;
    if (!noteId || !wsClient) return null;
    const result = await wsClient.novelUndo(noteId);
    const note = result?.note || result?.data?.note;
    if (note) {
        novelHydrateSession(note);
        refreshNovelEditorContent(note);
    }
    return result;
}

function novelMergeForgeNovelFields(data) {
    if (!data || typeof data !== 'object') return null;
    const fd = data.forge_data || {};
    const novelNoteId = data.novel_note_id || fd.novel_note_id;
    if (!novelNoteId) return null;
    return {
        novel_note_id: novelNoteId,
        novel_story_cursor_line: data.novel_story_cursor_line ?? fd.novel_story_cursor_line
    };
}

function novelRestoreFromForgeData(forgeData) {
    const merged = novelMergeForgeNovelFields(forgeData) || forgeData;
    if (!merged?.novel_note_id) return;
    novelLoadNote(merged.novel_note_id).then((note) => {
        if (!note) return;
        const btn = novelGetBtn();
        if (btn) {
            btn.dataset.state = 'on';
            btn.classList.add('active');
        }
        if (typeof merged.novel_story_cursor_line === 'number') {
            window.novelSession.metadata.story_cursor_line = merged.novel_story_cursor_line;
            if (window.novelSession.note?.metadata) {
                window.novelSession.note.metadata.story_cursor_line = merged.novel_story_cursor_line;
            }
        }
        refreshNovelEditorContent(window.novelSession.note);
        novelRefreshEnableState();
    });
}

// --- Tool windows ---

let novelEditorSaveTimer = null;
let novelGenerateInFlight = false;

function setNovelEditorGenerateDisabled(disabled) {
    const genBtn = document.getElementById('novelEditorGenerateBtn');
    if (genBtn) genBtn.disabled = disabled;
}

function openNovelEditorTool() {
    const manualModal = document.getElementById('manualModal');
    const tool = document.getElementById('novelEditorTool');
    if (!tool) return;
    const note = window.novelSession?.note;
    const titleEl = document.getElementById('novelEditorToolTitle');
    if (titleEl) {
        titleEl.textContent = note?.name ? `Novel — ${note.name}` : 'Novel';
    }
    if (typeof linkToolWindowToParent === 'function' && manualModal) {
        linkToolWindowToParent(tool, manualModal);
    }
    refreshNovelEditorContent(note);
    openModal(tool);
}

function openNovelProgressTool() {
    const manualModal = document.getElementById('manualModal');
    const tool = document.getElementById('novelProgressTool');
    if (!tool) return;
    const note = window.novelSession?.note;
    const titleEl = document.getElementById('novelProgressToolTitle');
    if (titleEl) {
        titleEl.textContent = note?.name ? `Novel — ${note.name}` : 'Novel Generation';
    }
    const log = document.getElementById('novelProgressLog');
    if (log) log.innerHTML = '';
    novelSetProgressStatus('Preparing…');
    if (typeof linkToolWindowToParent === 'function' && manualModal) {
        linkToolWindowToParent(tool, manualModal);
    }
    openModal(tool);
    // customScrollbar.forceReinit: public/scripts/comp/customScrollbar.js
    const scrollShell = tool.querySelector('[data-custom-scrollbar]');
    if (scrollShell && typeof customScrollbar !== 'undefined' && customScrollbar.forceReinit) {
        requestAnimationFrame(() => customScrollbar.forceReinit(scrollShell));
    }
}

function novelSetProgressStatus(text) {
    const el = document.getElementById('novelProgressStatus');
    if (el) el.textContent = text || '';
}

function novelScrollProgressLogToEnd() {
    const log = document.getElementById('novelProgressLog');
    if (!log) return;
    const scrollable = log.closest('.novel-progress-log-scrollable');
    if (scrollable) {
        scrollable.scrollTop = scrollable.scrollHeight;
    }
}

function refreshNovelEditorContent(note) {
    const textarea = document.getElementById('novelEditorTextarea');
    const cursorLabel = document.getElementById('novelEditorCursorLine');
    if (!textarea) return;
    textarea.value = note?.content || '';
    const meta = novelNormalizeMetadata(note?.metadata);
    if (cursorLabel) {
        cursorLabel.textContent = meta.story_cursor_line > 0
            ? `Story cursor: line ${meta.story_cursor_line}`
            : 'Story cursor: start';
    }
    const undoBtn = document.getElementById('novelEditorUndoBtn');
    if (undoBtn) {
        undoBtn.disabled = !(meta.undo_stack && meta.undo_stack.length > 0);
    }
}

function scheduleNovelEditorSave() {
    if (novelEditorSaveTimer) clearTimeout(novelEditorSaveTimer);
    novelEditorSaveTimer = setTimeout(async () => {
        const noteId = window.novelSession?.noteId;
        const textarea = document.getElementById('novelEditorTextarea');
        if (!noteId || !textarea || !wsClient) return;
        const content = textarea.value;
        await wsClient.novelUpdate(noteId, { content });
        if (window.novelSession?.note) {
            window.novelSession.note.content = content;
        }
    }, 1500);
}

function novelAddProgressReasoning(reason, toolName, toolState) {
    if (!reason) return;
    const log = document.getElementById('novelProgressLog');
    if (!log) return;
    const item = document.createElement('div');
    item.className = 'novel-progress-log-entry';
    if (toolState === 'running') item.classList.add('novel-progress-log-active');
    if (toolState === 'error') item.classList.add('novel-progress-log-error');
    if (toolState === 'completed' || toolState === 'done') item.classList.add('novel-progress-log-done');
    const label = toolName ? `${toolName}: ${reason}` : reason;
    item.textContent = label;
    log.appendChild(item);
    novelScrollProgressLogToEnd();
}

function handleNovelProgressUpdate(data) {
    const phase = data?.phase;
    if (phase === 'starting') {
        novelSetProgressStatus('Starting…');
        return;
    }
    if (phase === 'streaming') {
        novelSetProgressStatus('Writing…');
        if (data?.reason || data?.reasoning) {
            novelAddProgressReasoning(data.reason || data.reasoning, data.toolName, data.toolState || 'running');
        }
        return;
    }
    if (phase === 'completion') {
        novelSetProgressStatus('Complete');
        if (data?.reason || data?.reasoning) {
            novelAddProgressReasoning(data.reason || data.reasoning, null, 'done');
        }
        return;
    }
    if (phase === 'error') {
        novelSetProgressStatus('Failed');
        novelAddProgressReasoning(data.reason || 'Generation failed', null, 'error');
        novelGenerateInFlight = false;
        setNovelEditorGenerateDisabled(false);
        return;
    }
    if (data?.reason || data?.reasoning) {
        novelAddProgressReasoning(data.reason || data.reasoning, data.toolName, data.toolState || 'running');
    }
}

function novelClearGenerateInFlight() {
    novelGenerateInFlight = false;
    setNovelEditorGenerateDisabled(false);
}

function handleNovelClientUpdate(data) {
    if (data?.note && window.novelSession?.noteId === data.note.id) {
        novelHydrateSession(data.note);
        refreshNovelEditorContent(data.note);
    }
}

function handleNovelGenerateComplete(data) {
    if (data?.note) {
        novelHydrateSession(data.note);
        refreshNovelEditorContent(data.note);
    }
    if (data?.success === false) {
        novelSetProgressStatus('Failed');
        novelAddProgressReasoning(data.error || 'Generation failed', null, 'error');
    } else if (data?.success !== false) {
        novelSetProgressStatus('Complete');
    }
    novelClearGenerateInFlight();
    novelResetAdvanceResume();
}

function wireNovelToolWindowControls() {
    ['novelEditorTool', 'novelProgressTool'].forEach((id) => {
        const tool = document.getElementById(id);
        if (!tool || tool.dataset.novelControlsWired) return;
        tool.dataset.novelControlsWired = '1';
        const closeBtn = tool.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                // closeModal: public/scripts/comp/modalUtils.js
                closeModal(tool);
            });
        }
    });
}

async function novelPersistSettings() {
    const noteId = window.novelSession?.noteId;
    if (!noteId || !wsClient) return;
    const settings = novelGetSessionSettings();
    const metadata = novelNormalizeMetadata(window.novelSession?.metadata || window.novelSession?.note?.metadata);
    metadata.settings = settings;
    await wsClient.novelUpdate(noteId, { metadata });
    if (window.novelSession) window.novelSession.metadata = metadata;
}

function setupNovelUi() {
    wireNovelToolWindowControls();

    const btn = novelGetBtn();
    if (!btn || btn.dataset.novelWired) return;
    btn.dataset.novelWired = '1';

    if (!btn.dataset.resumeAdvancement) btn.dataset.resumeAdvancement = 'false';
    if (!btn.dataset.autoGenerate) btn.dataset.autoGenerate = 'true';
    if (!btn.dataset.tone) btn.dataset.tone = NOVEL_DEFAULT_SETTINGS.tone;
    if (!btn.dataset.style) btn.dataset.style = NOVEL_DEFAULT_SETTINGS.style;
    if (!btn.dataset.explicitness) btn.dataset.explicitness = NOVEL_DEFAULT_SETTINGS.explicitness;
    if (!btn.dataset.persuasiveness) btn.dataset.persuasiveness = NOVEL_DEFAULT_SETTINGS.persuasiveness;
    delete btn.dataset.advancePaused;

    btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        if (btn.dataset.state !== 'on') {
            btn.dataset.state = 'on';
            btn.classList.add('active');
            const ws = typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default';
            await novelEnsureNote(ws);
            await novelPersistSettings();
            openNovelEditorTool();
        } else {
            openNovelEditorTool();
        }
    });

    const directive = document.getElementById('creativeDirectiveInput');
    if (directive && !directive.dataset.novelWatcher) {
        directive.dataset.novelWatcher = '1';
        // scheduleTextInputSideEffect: public/scripts/comp/textareaUtils.js
        addTextareaInputSideEffect(directive, novelRefreshEnableState, 'novelEnable');
    }

    // Re-check enable state when Enshutsuka panel becomes visible (directive tab may already have content)
    const dynamicGroup = document.getElementById('dynamicGenerationGroup');
    if (dynamicGroup && !dynamicGroup.dataset.novelWatcher) {
        dynamicGroup.dataset.novelWatcher = '1';
        const observer = new MutationObserver(() => {
            if (!dynamicGroup.classList.contains('hidden')) {
                novelRefreshEnableState();
            }
        });
        observer.observe(dynamicGroup, { attributes: true, attributeFilter: ['class'] });
    }

    // If directive already populated before this script wired (e.g. fast restore), refresh now
    if (novelGetCreativeDirective()) {
        novelRefreshEnableState();
    }

    const editorTextarea = document.getElementById('novelEditorTextarea');
    if (editorTextarea && !editorTextarea.dataset.novelSaveWired) {
        editorTextarea.dataset.novelSaveWired = '1';
        // scheduleTextInputSideEffect: public/scripts/comp/textareaUtils.js
        addTextareaInputSideEffect(editorTextarea, scheduleNovelEditorSave, 'novelSave');
    }

    const genBtn = document.getElementById('novelEditorGenerateBtn');
    if (genBtn && !genBtn.dataset.novelGenWired) {
        genBtn.dataset.novelGenWired = '1';
        genBtn.addEventListener('click', async () => {
            const session = window.novelSession;
            if (!session?.noteId) return;
            await novelRunGenerate({ noteId: session.noteId });
        });
    }

    const undoBtn = document.getElementById('novelEditorUndoBtn');
    if (undoBtn && !undoBtn.dataset.novelUndoWired) {
        undoBtn.dataset.novelUndoWired = '1';
        undoBtn.addEventListener('click', () => novelRunUndo());
    }

    novelRefreshEnableState();
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(setupNovelUi, 0);
});
