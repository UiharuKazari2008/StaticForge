// eMotion desktop app: image-to-video via the Ruiko animate backend (same wire path as the
// Studio animate dialog / MCP animate_image — public/scripts/comp/animateImageDialog.js,
// public/scripts/websocket.js animateImage(), modules/ws/handlers/generationImpl.js
// handleImageAnimation). Reuses LOCAL_ANIMATE_BACKENDS / knownLocalAnimateBackends /
// fetchLocalAnimateStatus from animateImageDialog.js (loaded earlier in app.html) instead of
// redefining the backend catalog.
// openModal / closeModal / bringModalToFront / restoreMinimizedModal / assignModalZIndex:
// public/scripts/comp/modalUtils.js
// contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
// createWheelTickGate / guardWheelTick: public/scripts/utils/wheelTickGate.js
// Layout: public/css/desktop-apps/emotion.css

const DESKTOP_EMOTION_MODAL_ID = 'desktopEmotionModal';

const desktopEmotion = {
    sourceFilename: null,
    sourceWorkspace: null,
    mode: 'ltx',
    frames: 16,
    fps: 8,
    loop: true,
    autoPromptViaDirector: false,
    running: false,
    requestId: null,
    result: null // { filename, formats: {gif, mp4, webp} }
};

let desktopEmotionEls = null;

function openDesktopEmotion() {
    const modal = ensureDesktopEmotionModal();
    if (modal.classList.contains('minimised')) {
        restoreMinimizedModal(modal);
    }
    if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt')) {
        openModal(modal);
    }
    bringModalToFront(modal);
}

const emotionCreateButton = function (className, title, iconClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = title;
    if (iconClass) {
        const icon = document.createElement('i');
        icon.className = iconClass;
        icon.setAttribute('aria-hidden', 'true');
        button.appendChild(icon);
    }
    return button;
};

// ---- Load image source: Gallery selection / Studio's current image ----------------------

function emotionReadStudioCurrentFilename() {
    // Mirrors readOpenFilename() in public/scripts/comp/agentClientBridge.js: the manual
    // preview is what the editor is actually showing; currentEditMetadata/uploadedImageData
    // are img2img sources and often carry no filename of their own.
    const fromImageLike = (img) => (img && typeof img === 'object')
        ? (img.filename || img.original || img.upscaled || img.sourceFilename || null)
        : null;
    const showing = fromImageLike(window.currentManualPreviewImage);
    if (showing) return showing;
    const loaded = fromImageLike(window.currentEditImage);
    if (loaded) return loaded;
    const meta = window.currentEditMetadata;
    if (meta) {
        if (meta.sourceFilename) return meta.sourceFilename;
        if (meta.filename) return meta.filename;
    }
    const uploaded = window.uploadedImageData;
    if (uploaded && uploaded.filename) return uploaded.filename;
    return null;
}

function emotionLoadFromGallery() {
    // getSelectedFilenames: public/scripts/comp/galleryView.js
    const selected = typeof getSelectedFilenames === 'function' ? getSelectedFilenames() : [];
    const filename = Array.isArray(selected) && selected.length ? selected[0] : null;
    if (!filename) {
        showGlassToast('info', 'eMotion LIVE', 'Select an image in the Gallery first.', false, 4000);
        return;
    }
    emotionSetSourceImage(filename, typeof activeWorkspace !== 'undefined' ? activeWorkspace : null);
}

function emotionLoadFromStudio() {
    const filename = emotionReadStudioCurrentFilename();
    if (!filename) {
        showGlassToast('info', 'eMotion LIVE', "Studio doesn't have an image loaded right now.", false, 4000);
        return;
    }
    emotionSetSourceImage(filename, typeof activeWorkspace !== 'undefined' ? activeWorkspace : null);
}

const emotionLoadImageMenuConfig = {
    onAction: (action) => {
        if (action === 'emotion-load-gallery') emotionLoadFromGallery();
        else if (action === 'emotion-load-studio') emotionLoadFromStudio();
    },
    sections: [{
        type: 'list',
        initfn: (section) => {
            section.items = [
                { text: 'From Gallery selection', icon: 'fas fa-images', action: 'emotion-load-gallery' },
                { text: "From Studio's current image", icon: 'fas fa-compass-drafting', action: 'emotion-load-studio' }
            ];
        }
    }]
};

function emotionSetSourceImage(filename, workspace) {
    desktopEmotion.sourceFilename = filename;
    desktopEmotion.sourceWorkspace = workspace || null;
    desktopEmotion.result = null;
    emotionRenderPreview();
    if (desktopEmotion.autoPromptViaDirector) {
        emotionRunAutoPrompt();
    }
}

// ---- Auto prompt via Director -------------------------------------------------------------
// director.sendMessage/pendingAttachments/_running: public/scripts/comp/director.js. Creating
// a session surfaces the Director window by design (same as createDirectorSessionWithImage in
// public/scripts/comp/referenceManager.js) — there is no headless Director call in this
// codebase, every Director turn runs through a visible session.

const EMOTION_DIRECTOR_INSTRUCTION = 'Write a short, vivid motion prompt (one or two sentences) '
    + 'describing how this image should animate for an image-to-video model. Reply with ONLY '
    + 'the motion prompt text — no preamble, no quotes, no formatting.';

function emotionWaitForNewDirectorSession(timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            window.wsClient.off('director_create_session_response', handler);
            reject(new Error('Timed out waiting for Director to start a session'));
        }, timeoutMs);
        function handler(data) {
            const body = data && data.data;
            if (body && body.success && body.session && body.session.id) {
                clearTimeout(timer);
                window.wsClient.off('director_create_session_response', handler);
                resolve(body.session.id);
            }
        }
        window.wsClient.on('director_create_session_response', handler);
    });
}

function emotionWaitForDirectorReply(sessionId, timeoutMs) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const tick = () => {
            const director = window.directorInstance;
            const session = director && director.currentSession;
            if (session && session.id === sessionId && Array.isArray(session.messages) && !director._running) {
                const reply = session.messages.find((m) => m && (m.role === 'assistant' || m.message_type === 'assistant') && m.content);
                if (reply) {
                    const text = Array.isArray(reply.content)
                        ? reply.content.map((part) => (typeof part === 'string' ? part : (part && part.text) || '')).join(' ')
                        : String(reply.content);
                    resolve(text.trim());
                    return;
                }
            }
            if (Date.now() - startedAt > timeoutMs) {
                reject(new Error('Director did not reply in time'));
                return;
            }
            setTimeout(tick, 750);
        };
        tick();
    });
}

async function emotionRunAutoPrompt() {
    if (!desktopEmotion.sourceFilename) return;
    if (!window.wsClient || !window.wsClient.isConnected()) {
        showGlassToast('error', 'eMotion LIVE', 'WebSocket not connected', false, 4000);
        return;
    }
    if (typeof initializeDirector === 'function' && !window.directorInstance) {
        await initializeDirector();
    }
    const director = window.directorInstance;
    if (!director) {
        showGlassToast('error', 'eMotion LIVE', 'Director is not available', false, 4000);
        return;
    }

    emotionSetPromptBusy(true);
    try {
        const sessionPromise = emotionWaitForNewDirectorSession(15000);
        director.pendingAttachments = [{
            source: 'workspace',
            filename: desktopEmotion.sourceFilename,
            name: desktopEmotion.sourceFilename
        }];
        await director.sendMessage(EMOTION_DIRECTOR_INSTRUCTION);
        const sessionId = await sessionPromise;
        const reply = await emotionWaitForDirectorReply(sessionId, 90000);
        if (reply && desktopEmotionEls && desktopEmotionEls.promptInput) {
            desktopEmotionEls.promptInput.value = reply;
        }
    } catch (err) {
        showGlassToast('error', 'eMotion LIVE', (err && err.message) || 'Director prompt failed', false, 5000);
    } finally {
        emotionSetPromptBusy(false);
    }
}

function emotionSetPromptBusy(busy) {
    if (!desktopEmotionEls) return;
    desktopEmotionEls.promptInput.disabled = busy;
    desktopEmotionEls.promptInput.classList.toggle('emotion-prompt-busy', busy);
}

// ---- Animate job: start/stop via the same animate_image path as Studio/MCP ---------------

function emotionBuildAnimateParams() {
    return {
        filename: desktopEmotion.sourceFilename,
        workspace: desktopEmotion.sourceWorkspace || (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null),
        motion_prompt: desktopEmotionEls.promptInput.value.trim(),
        frames: desktopEmotion.frames,
        fps: desktopEmotion.fps,
        loop: desktopEmotion.loop,
        backend: desktopEmotion.mode
    };
}

function emotionStartJob() {
    if (desktopEmotion.running) return;
    if (!desktopEmotion.sourceFilename) {
        showGlassToast('info', 'eMotion LIVE', 'Load a source image first.', false, 4000);
        return;
    }
    const motionPrompt = desktopEmotionEls.promptInput.value.trim();
    if (!motionPrompt) {
        showGlassToast('info', 'eMotion LIVE', 'Write a motion prompt first.', false, 4000);
        desktopEmotionEls.promptInput.focus();
        return;
    }
    if (!window.wsClient || !window.wsClient.isConnected()) {
        showGlassToast('error', 'eMotion LIVE', 'WebSocket not connected', false, 4000);
        return;
    }

    const ws = window.wsClient;
    const params = emotionBuildAnimateParams();

    // sendMessage()/animateImage() generate their own requestId internally and never return
    // it — the Promise executor runs synchronously on construction, so the new pendingRequests
    // entry already exists the instant animateImage() returns. Diffing the key set here is the
    // only way to learn the requestId for progress/cancel correlation.
    const beforeKeys = new Set(ws.pendingRequests ? ws.pendingRequests.keys() : []);
    const resultPromise = ws.animateImage(params);
    let requestId = null;
    if (ws.pendingRequests) {
        for (const key of ws.pendingRequests.keys()) {
            if (!beforeKeys.has(key)) { requestId = key; break; }
        }
    }

    desktopEmotion.running = true;
    desktopEmotion.requestId = requestId;
    emotionSetProgress(0, 'Starting…');
    emotionRenderStartStop();

    // Compare against desktopEmotion.requestId (not a shared "abandoned" flag) when the
    // promise settles: a shared flag would get reset by a job started after Stop, which
    // could then wrongly apply to this stale job's result/error.
    const onKeepAlive = (data) => {
        if (!data || data.requestId !== requestId) return;
        emotionSetProgress(Number(data.progress) || 0, data.message || '');
    };
    ws.on('request_keep_alive', onKeepAlive);

    resultPromise.then((result) => {
        if (desktopEmotion.requestId !== requestId) return;
        desktopEmotion.result = result && result.formats ? { filename: result.filename, formats: result.formats } : null;
    }).catch((err) => {
        if (desktopEmotion.requestId !== requestId) return;
        showGlassToast('error', 'eMotion LIVE', (err && err.message) || 'Animate failed', false, 6000);
    }).finally(() => {
        ws.off('request_keep_alive', onKeepAlive);
        if (desktopEmotion.requestId !== requestId) return;
        desktopEmotion.running = false;
        desktopEmotion.requestId = null;
        emotionRenderStartStop();
        emotionRenderPreview();
    });
}

function emotionStopJob() {
    if (!desktopEmotion.running) return;
    const requestId = desktopEmotion.requestId;
    desktopEmotion.running = false;
    desktopEmotion.requestId = null;
    if (requestId && window.wsClient && typeof window.wsClient.sendAcklessMessage === 'function') {
        try {
            window.wsClient.sendAcklessMessage('cancel_generation', { cancelledRequestIds: [requestId] });
        } catch (_err) {
            // Best-effort — Ruiko animate jobs aren't server-cancellable yet, this just
            // stops the client from waiting on/applying the eventual result.
        }
    }
    emotionRenderStartStop();
    emotionRenderPreview();
}

function emotionHandleStartStopClick() {
    if (desktopEmotion.running) emotionStopJob();
    else emotionStartJob();
}

// ---- Rendering -----------------------------------------------------------------------------

function emotionRenderStartStop() {
    if (!desktopEmotionEls) return;
    const btn = desktopEmotionEls.startStopBtn;
    btn.classList.toggle('btn-primary', !desktopEmotion.running);
    btn.classList.toggle('btn-danger', desktopEmotion.running);
    btn.innerHTML = '';
    const icon = document.createElement('i');
    icon.className = desktopEmotion.running ? 'fas fa-stop' : 'fas fa-play';
    const label = document.createElement('span');
    label.textContent = desktopEmotion.running ? ' Stop' : ' Start';
    btn.appendChild(icon);
    btn.appendChild(label);
}

function emotionSetProgress(progress, message) {
    if (!desktopEmotionEls) return;
    const pct = Math.max(0, Math.min(100, Math.round(progress)));
    desktopEmotionEls.progressFill.style.width = pct + '%';
    desktopEmotionEls.progressLabel.textContent = message || (pct + '%');
    emotionRenderPreview();
}

function emotionRenderPreview() {
    if (!desktopEmotionEls) return;
    const { previewImg, placeholder, progressOverlay, resultBadge } = desktopEmotionEls;

    progressOverlay.classList.toggle('hidden', !desktopEmotion.running);

    if (desktopEmotion.running) {
        placeholder.classList.add('hidden');
        if (desktopEmotion.sourceFilename) {
            previewImg.src = localGalleryImageUrl(desktopEmotion.sourceFilename);
            previewImg.classList.remove('hidden');
        }
        resultBadge.classList.add('hidden');
        return;
    }

    if (desktopEmotion.result && desktopEmotion.result.formats) {
        const gif = desktopEmotion.result.formats.gif || desktopEmotion.result.filename;
        previewImg.src = localGalleryImageUrl(gif);
        previewImg.classList.remove('hidden');
        placeholder.classList.add('hidden');
        resultBadge.classList.remove('hidden');
        resultBadge.dataset.mp4 = desktopEmotion.result.formats.mp4 || '';
        return;
    }

    resultBadge.classList.add('hidden');
    if (desktopEmotion.sourceFilename) {
        previewImg.src = localGalleryImageUrl(desktopEmotion.sourceFilename);
        previewImg.classList.remove('hidden');
        placeholder.classList.add('hidden');
    } else {
        previewImg.classList.add('hidden');
        placeholder.classList.remove('hidden');
    }
}

// ---- Mode button (loop/wan/ltx) — toolbar button + contextMenu click-menu ----------------
// LOCAL_ANIMATE_BACKENDS / knownLocalAnimateBackends / fetchLocalAnimateStatus:
// public/scripts/comp/animateImageDialog.js

const EMOTION_MODE_LABELS = { ltx: 'LTX', loop: 'Loop', wan: 'Wan' };

// Backends may arrive as {id,name}, {id,label}, {backend} or plain strings from the worker.
function emotionModeId(b) {
    if (typeof b === 'string') return b;
    return (b && (b.id || b.backend || b.key)) || '';
}

function emotionModeLabel(id) {
    return EMOTION_MODE_LABELS[id] || String(id || '').toUpperCase() || 'Mode';
}

function emotionModeList() {
    const ids = knownLocalAnimateBackends().map(emotionModeId).filter(Boolean);
    return ids.length ? ids : ['ltx', 'loop', 'wan'];
}

function emotionRenderModeButton() {
    const btn = document.getElementById('emotionModeBtn');
    if (!btn) return;
    const ids = emotionModeList();
    if (!ids.includes(desktopEmotion.mode)) desktopEmotion.mode = ids.includes('ltx') ? 'ltx' : ids[0];
    btn.querySelector('.emotion-mode-btn-label').textContent = emotionModeLabel(desktopEmotion.mode);
}

// Standard toolbar click-menu (same pattern as Dovecote's Folder button) — no custom dropdown.
const emotionModeMenuConfig = {
    onAction: (action, target, item) => {
        desktopEmotion.mode = item.emotionModeId;
        emotionRenderModeButton();
    },
    sections: [{
        type: 'list',
        initfn: (section) => {
            section.items = emotionModeList().map((id) => ({
                text: emotionModeLabel(id),
                icon: id === 'loop' ? 'fas fa-repeat' : 'fas fa-film',
                action: 'emotion-mode-pick',
                emotionModeId: id,
                showIndicator: true,
                loadfn: (it) => { it.checked = desktopEmotion.mode === id; }
            }));
        }
    }]
};

function emotionBuildModeButton() {
    const btn = emotionCreateButton('btn-secondary', 'Mode', 'fas fa-film');
    btn.id = 'emotionModeBtn';
    const label = document.createElement('span');
    label.className = 'emotion-mode-btn-label';
    btn.appendChild(label);
    contextMenu.attachClickMenuToElement(btn, emotionModeMenuConfig);
    setTimeout(emotionRenderModeButton, 0);
    fetchLocalAnimateStatus().then(emotionRenderModeButton);
    return btn;
}

// ---- Scroll-wheel adjustable number inputs (frames/fps) — <=200ms debounce ----------------
// createWheelTickGate / guardWheelTick: public/scripts/utils/wheelTickGate.js

function emotionWireWheelNumberInput(input, { min, max, step, onChange }) {
    const allowTick = createWheelTickGate(150);
    input.addEventListener('wheel', (e) => {
        if (!guardWheelTick(e, allowTick)) return;
        const delta = e.deltaY > 0 ? -step : step;
        const current = parseInt(input.value, 10) || min;
        const next = Math.max(min, Math.min(max, current + delta));
        input.value = String(next);
        onChange(next);
    }, { passive: false });
    input.addEventListener('change', () => {
        const clamped = Math.max(min, Math.min(max, parseInt(input.value, 10) || min));
        input.value = String(clamped);
        onChange(clamped);
    });
}

// ---- Modal construction --------------------------------------------------------------------

const ensureDesktopEmotionModal = function () {
    let modal = document.getElementById(DESKTOP_EMOTION_MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = DESKTOP_EMOTION_MODAL_ID;
    modal.className = 'modal resizeable-window toolbar-visible hidden';
    modal.dataset.windowIdentifier = 'desktopEmotion';
    modal.dataset.windowDefaultWidth = '860';
    modal.dataset.windowDefaultHeight = '560';
    modal.dataset.windowMinWidth = '640';
    modal.dataset.windowMinHeight = '420';
    modal.dataset.windowMaxWidth = '1400';
    modal.dataset.windowMaxHeight = '1100';

    // ---- Title bar ----
    const title = document.createElement('div');
    title.className = 'modal-window-title';
    const titleMain = document.createElement('div');
    titleMain.className = 'modal-window-title-main';
    const titleIcon = document.createElement('i');
    titleIcon.className = 'fas fa-photo-film';
    const titleText = document.createElement('span');
    titleText.textContent = 'eMotion LIVE';
    titleMain.appendChild(titleIcon);
    titleMain.appendChild(titleText);
    title.appendChild(titleMain);

    const toolbar = document.createElement('div');
    toolbar.className = 'modal-window-title-toolbar';

    const loadBtn = emotionCreateButton('btn-secondary', 'Open image', 'fas fa-folder-open');
    const loadLabel = document.createElement('span');
    loadLabel.textContent = ' Open Image';
    loadBtn.appendChild(loadLabel);
    contextMenu.attachClickMenuToElement(loadBtn, emotionLoadImageMenuConfig);
    toolbar.appendChild(loadBtn);

    const divider = document.createElement('div');
    divider.className = 'emotion-toolbar-divider';
    toolbar.appendChild(divider);

    // Compact number inputs like Studio's #manualPrintsCount, with a muted FA icon to the left
    // so Frames vs FPS stay readable without a text label in the toolbar.
    const emotionBuildNumberGroup = (labelText, id, min, max, value, iconClass) => {
        const icon = document.createElement('i');
        icon.className = iconClass + ' emotion-toolbar-number-icon';
        icon.setAttribute('aria-hidden', 'true');
        const input = document.createElement('input');
        input.type = 'number';
        input.id = id;
        input.min = String(min);
        input.max = String(max);
        input.step = '1';
        input.value = String(value);
        input.inputMode = 'numeric';
        input.title = labelText + ' (hover + scroll to adjust)';
        input.setAttribute('aria-label', labelText);
        input.className = 'form-control hover-show colored';
        toolbar.appendChild(icon);
        toolbar.appendChild(input);
        return input;
    };
    const framesInput = emotionBuildNumberGroup('Frames', 'emotionFramesInput', 8, 32, desktopEmotion.frames, 'fas fa-film');
    const fpsInput = emotionBuildNumberGroup('FPS', 'emotionFpsInput', 4, 24, desktopEmotion.fps, 'fas fa-gauge-high');

    toolbar.appendChild(emotionBuildModeButton());

    const loopToggle = emotionCreateButton('btn-secondary icon-only indicator', 'Loop', 'fas fa-repeat');
    loopToggle.id = 'emotionLoopToggle';
    loopToggle.dataset.state = desktopEmotion.loop ? 'on' : 'off';
    loopToggle.setAttribute('aria-pressed', String(desktopEmotion.loop));
    loopToggle.addEventListener('click', () => {
        desktopEmotion.loop = !desktopEmotion.loop;
        loopToggle.dataset.state = desktopEmotion.loop ? 'on' : 'off';
        loopToggle.setAttribute('aria-pressed', String(desktopEmotion.loop));
    });
    toolbar.appendChild(loopToggle);

    const spacer = document.createElement('div');
    spacer.className = 'emotion-toolbar-spacer';
    toolbar.appendChild(spacer);

    const directorToggle = emotionCreateButton('btn-secondary icon-only indicator', 'Auto prompt via Director', 'fas fa-wand-magic-sparkles');
    directorToggle.dataset.state = 'off';
    directorToggle.setAttribute('aria-pressed', 'false');
    directorToggle.addEventListener('click', () => {
        desktopEmotion.autoPromptViaDirector = !desktopEmotion.autoPromptViaDirector;
        directorToggle.dataset.state = desktopEmotion.autoPromptViaDirector ? 'on' : 'off';
        directorToggle.setAttribute('aria-pressed', String(desktopEmotion.autoPromptViaDirector));
        if (desktopEmotion.autoPromptViaDirector && desktopEmotion.sourceFilename) {
            emotionRunAutoPrompt();
        }
    });
    toolbar.appendChild(directorToggle);

    // Content (icon + label) is owned entirely by emotionRenderStartStop() below.
    const startStopBtn = emotionCreateButton('btn-primary emotion-start-stop-btn', 'Start', null);
    startStopBtn.addEventListener('click', emotionHandleStartStopClick);
    toolbar.appendChild(startStopBtn);

    title.appendChild(toolbar);

    const focusOverlay = document.createElement('div');
    focusOverlay.className = 'modal-focus-overlay';

    const controls = document.createElement('div');
    controls.className = 'modal-window-controls';
    const minimizeBtn = emotionCreateButton('btn-secondary minimize-btn btn-small', 'Minimize', 'fa-regular fa-window-minimize');
    const maximizeBtn = emotionCreateButton('btn-secondary btn-small modal-work-area-maximize', 'Maximize', 'fa-regular fa-window-maximize');
    const closeBtn = emotionCreateButton('btn-danger close-btn btn-small', 'Close', 'fa-regular fa-xmark-large');
    controls.appendChild(minimizeBtn);
    controls.appendChild(maximizeBtn);
    controls.appendChild(closeBtn);
    closeBtn.addEventListener('click', () => {
        closeModal(modal);
    });

    // ---- Body: left preview panel, right prompt + controls column ----
    const content = document.createElement('div');
    content.className = 'modal-content modal-padding dark';
    const body = document.createElement('div');
    body.className = 'modal-body emotion-body';

    const previewPanel = document.createElement('div');
    previewPanel.className = 'emotion-preview-panel emotion-inset-panel';

    const placeholder = document.createElement('div');
    placeholder.className = 'emotion-preview-placeholder';
    const placeholderIcon = document.createElement('i');
    placeholderIcon.className = 'fas fa-photo-film';
    const placeholderText = document.createElement('span');
    placeholderText.textContent = 'Load an image to begin';
    placeholder.appendChild(placeholderIcon);
    placeholder.appendChild(placeholderText);

    const previewImg = document.createElement('img');
    previewImg.className = 'emotion-preview-image hidden';
    previewImg.alt = 'Source / result preview';

    const progressOverlay = document.createElement('div');
    progressOverlay.className = 'emotion-progress-overlay hidden';
    const progressTrack = document.createElement('div');
    progressTrack.className = 'emotion-progress-track';
    const progressFill = document.createElement('div');
    progressFill.className = 'emotion-progress-fill';
    progressTrack.appendChild(progressFill);
    const progressLabel = document.createElement('div');
    progressLabel.className = 'emotion-progress-label';
    progressOverlay.appendChild(progressTrack);
    progressOverlay.appendChild(progressLabel);

    const resultBadge = document.createElement('button');
    resultBadge.type = 'button';
    resultBadge.className = 'btn-secondary btn-small emotion-result-badge hidden';
    resultBadge.title = 'Open MP4';
    resultBadge.innerHTML = '<i class="fas fa-film"></i> MP4';
    resultBadge.addEventListener('click', () => {
        if (resultBadge.dataset.mp4) {
            window.open(localGalleryImageUrl(resultBadge.dataset.mp4), '_blank', 'noopener');
        }
    });

    previewPanel.appendChild(previewImg);
    previewPanel.appendChild(placeholder);
    previewPanel.appendChild(progressOverlay);
    previewPanel.appendChild(resultBadge);

    const promptInput = document.createElement('textarea');
    promptInput.id = 'emotionPromptInput';
    promptInput.className = 'form-control prompt-textarea textarea-inset emotion-prompt-input';
    promptInput.placeholder = 'Motion prompt, e.g. hair and clothing sway in the wind, camera gently pushes in';

    body.appendChild(previewPanel);
    body.appendChild(promptInput);
    content.appendChild(body);

    modal.appendChild(title);
    modal.appendChild(focusOverlay);
    modal.appendChild(controls);
    modal.appendChild(content);
    document.body.appendChild(modal);

    desktopEmotionEls = {
        modal,
        previewImg,
        placeholder,
        progressOverlay,
        progressFill,
        progressLabel,
        resultBadge,
        promptInput,
        framesInput,
        fpsInput,
        loopToggle,
        startStopBtn
    };

    emotionWireWheelNumberInput(framesInput, {
        min: 8, max: 32, step: 1,
        onChange: (value) => { desktopEmotion.frames = value; }
    });
    emotionWireWheelNumberInput(fpsInput, {
        min: 4, max: 24, step: 1,
        onChange: (value) => { desktopEmotion.fps = value; }
    });
    emotionRenderStartStop();
    emotionRenderPreview();

    return modal;
};
