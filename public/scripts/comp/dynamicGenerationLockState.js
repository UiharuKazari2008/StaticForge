/**
 * Freeze Changes (cache_locked) and Freeze Context (context_locked) for dynamic generation.
 * Carousel #dynamicCarousel is the runtime source of truth; compiled_prompt mirrors for session persistence.
 * addSharedFieldsToRequestBody: public/scripts/comp/manualModalManager.js
 * updateCarouselIndicators: public/scripts/app.js
 */

function getDynamicCarouselElement() {
    return document.getElementById('dynamicCarousel');
}

function getDynamicGenerationLockState() {
    const dc = getDynamicCarouselElement();
    return {
        cacheLocked: dc?.getAttribute('data-state') === 'on',
        contextLocked: dc?.dataset?.contextLocked === 'true'
    };
}

function setDynamicGenerationLockState(patch) {
    if (!patch || (patch.cacheLocked === undefined && patch.contextLocked === undefined)) {
        return getDynamicGenerationLockState();
    }

    const current = getDynamicGenerationLockState();
    const next = {
        cacheLocked: patch.cacheLocked !== undefined ? !!patch.cacheLocked : current.cacheLocked,
        contextLocked: patch.contextLocked !== undefined ? !!patch.contextLocked : current.contextLocked
    };

    const dc = getDynamicCarouselElement();
    if (dc) {
        dc.setAttribute('data-state', next.cacheLocked ? 'on' : 'off');
        dc.setAttribute('data-context-locked', next.contextLocked ? 'true' : 'false');
    }

    const compiledPrompt = window.dynamicGenerationData?.compiled_prompt;
    if (compiledPrompt) {
        compiledPrompt.cache_locked = next.cacheLocked;
        compiledPrompt.context_locked = next.contextLocked;
    }

    if (window.updateCarouselIndicators) {
        window.updateCarouselIndicators();
    }

    return next;
}

function applyDynamicGenerationLockStateFromCompiledPrompt(compiledPrompt) {
    if (!compiledPrompt) return getDynamicGenerationLockState();
    const patch = {};
    if (compiledPrompt.cache_locked !== undefined) patch.cacheLocked = !!compiledPrompt.cache_locked;
    if (compiledPrompt.context_locked !== undefined) patch.contextLocked = !!compiledPrompt.context_locked;
    return Object.keys(patch).length ? setDynamicGenerationLockState(patch) : getDynamicGenerationLockState();
}

function clearDynamicGenerationLockState() {
    return setDynamicGenerationLockState({ cacheLocked: false, contextLocked: false });
}

function dynamicGenerationHasCompileCache() {
    const dc = getDynamicCarouselElement();
    return !!(window.dynamicGenerationData?.compiled_prompt)
        && dc && dc.getAttribute('data-has-cache') === 'true';
}

function dynamicGenerationNeedsTendaiLockChoice() {
    if (!dynamicGenerationHasCompileCache()) return false;
    const locks = getDynamicGenerationLockState();
    return !(locks.cacheLocked && locks.contextLocked);
}

/** True when the Enshutsuka panel is open and requests should include dynamic_generation. */
function isDynamicGenerationEnabled() {
    const group = document.getElementById('dynamicGenerationGroup');
    const toggle = document.getElementById('dynamicGenerationToggleBtn');
    return !!(group && !group.classList.contains('hidden') && toggle?.getAttribute('data-state') === 'open');
}

function setDynamicGenerationEnabled(enabled) {
    const group = document.getElementById('dynamicGenerationGroup');
    const toggle = document.getElementById('dynamicGenerationToggleBtn');
    if (!group || !toggle) return isDynamicGenerationEnabled();
    if (enabled) {
        group.classList.remove('hidden');
        toggle.setAttribute('data-state', 'open');
    } else {
        group.classList.add('hidden');
        toggle.setAttribute('data-state', 'off');
    }
    return isDynamicGenerationEnabled();
}

function readDirectorAttachSnapshot() {
    const directorBtn = document.getElementById('directorBtn');
    const directiveEl = document.getElementById('creativeDirectiveInput');
    const sessionId = directorBtn?.dataset?.directorSessionId || '';
    const messageId = directorBtn?.dataset?.directorMessageId || '';
    const prompt = (directiveEl && directiveEl.value && directiveEl.value.trim()) || '';
    if (!sessionId && !messageId && !prompt) return null;
    const out = {};
    if (sessionId) out.sessionId = sessionId;
    if (messageId) out.messageId = messageId;
    if (prompt) out.prompt = prompt;
    return out;
}

function applyStudioDirectorAttach(director) {
    if (!director || typeof director !== 'object' || Array.isArray(director)) return false;
    let changed = false;
    const directorBtn = document.getElementById('directorBtn');
    if (directorBtn) {
        if (director.sessionId != null || director.session_id != null) {
            const id = String(director.sessionId != null ? director.sessionId : director.session_id);
            if (id) directorBtn.dataset.directorSessionId = id;
            else delete directorBtn.dataset.directorSessionId;
            changed = true;
        }
        if (director.messageId != null || director.message_id != null) {
            const id = String(director.messageId != null ? director.messageId : director.message_id);
            if (id) directorBtn.dataset.directorMessageId = id;
            else delete directorBtn.dataset.directorMessageId;
            changed = true;
        }
    }
    const prompt = director.prompt != null ? director.prompt : director.directive;
    if (prompt != null) {
        const directiveEl = document.getElementById('creativeDirectiveInput');
        if (directiveEl) {
            directiveEl.value = String(prompt);
            directiveEl.dispatchEvent(new Event('input', { bubbles: true }));
            changed = true;
        }
    }
    return changed;
}

function readDynamicGenerationSnapshot() {
    const todBtn = document.getElementById('todBtn');
    const weatherBtn = document.getElementById('weatherBtn');
    const seasonBtn = document.getElementById('seasonBtn');
    const carousel = document.getElementById('dynamicCarousel');
    const directiveEl = document.getElementById('creativeDirectiveInput');
    const locks = getDynamicGenerationLockState();
    const compiled = window.dynamicGenerationData?.compiled_prompt || null;
    const snapshot = {
        enabled: isDynamicGenerationEnabled(),
        cacheLocked: !!locks.cacheLocked,
        contextLocked: !!locks.contextLocked
    };
    if (typeof collectDynamicButtonState === 'function') {
        snapshot.tod = collectDynamicButtonState(todBtn);
        snapshot.weather = collectDynamicButtonState(weatherBtn);
        snapshot.season = collectDynamicButtonState(seasonBtn);
    }
    const loc = weatherBtn && weatherBtn.getAttribute('data-location');
    if (loc) snapshot.location = loc;
    const directive = (directiveEl && directiveEl.value && directiveEl.value.trim()) || '';
    if (directive) snapshot.directive = directive;
    if (carousel) {
        if (carousel.dataset.creativeDirectiveStrategy) snapshot.force_strategy = carousel.dataset.creativeDirectiveStrategy;
        if (carousel.dataset.creativeDirectiveToolPasses) snapshot.tool_passes = parseInt(carousel.dataset.creativeDirectiveToolPasses, 10);
        if (carousel.dataset.creativeDirectiveDialogs !== undefined && carousel.dataset.creativeDirectiveDialogs !== '') {
            snapshot.dialogs_count = parseInt(carousel.dataset.creativeDirectiveDialogs, 10);
        }
    }
    if (compiled && compiled.context) snapshot.hasCompiledContext = true;
    if (compiled && compiled.previousResponseId) snapshot.hasPreviousResponse = true;
    return snapshot;
}

function applyStudioDynamicGenerationConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
    let changed = false;
    if (config.enabled !== undefined) {
        setDynamicGenerationEnabled(!!config.enabled);
        changed = true;
    }
    if (config.cacheLocked !== undefined || config.contextLocked !== undefined
        || config.cache_locked !== undefined || config.context_locked !== undefined) {
        setDynamicGenerationLockState({
            cacheLocked: config.cacheLocked !== undefined ? config.cacheLocked : config.cache_locked,
            contextLocked: config.contextLocked !== undefined ? config.contextLocked : config.context_locked
        });
        changed = true;
    }
    const todBtn = document.getElementById('todBtn');
    const weatherBtn = document.getElementById('weatherBtn');
    const seasonBtn = document.getElementById('seasonBtn');
    const carousel = document.getElementById('dynamicCarousel');
    if (config.tod !== undefined && todBtn && typeof setDynamicOverride === 'function') {
        if (config.tod === false || config.tod === null) {
            todBtn.removeAttribute('data-override');
            todBtn.dataset.state = 'off';
        } else {
            setDynamicOverride(todBtn, config.tod === true ? 'auto' : String(config.tod));
        }
        changed = true;
    }
    if (config.weather !== undefined && weatherBtn && typeof setDynamicOverride === 'function') {
        if (config.weather === false || config.weather === null) {
            weatherBtn.removeAttribute('data-override');
            weatherBtn.dataset.state = 'off';
        } else {
            setDynamicOverride(weatherBtn, config.weather === true ? 'auto' : String(config.weather));
        }
        changed = true;
    }
    if (config.season !== undefined && seasonBtn && typeof setSeasonOverride === 'function') {
        setSeasonOverride(seasonBtn, config.season);
        changed = true;
    }
    if (config.location != null && weatherBtn) {
        weatherBtn.setAttribute('data-location', String(config.location));
        changed = true;
    }
    if (config.directive != null) {
        const directiveEl = document.getElementById('creativeDirectiveInput');
        if (directiveEl) {
            directiveEl.value = String(config.directive);
            directiveEl.dispatchEvent(new Event('input', { bubbles: true }));
            changed = true;
        }
    }
    if (carousel) {
        if (config.force_strategy != null) {
            carousel.dataset.creativeDirectiveStrategy = String(config.force_strategy);
            changed = true;
        }
        if (config.tool_passes != null) {
            carousel.dataset.creativeDirectiveToolPasses = String(config.tool_passes);
            changed = true;
        }
        if (config.dialogs_count != null) {
            carousel.dataset.creativeDirectiveDialogs = String(config.dialogs_count);
            changed = true;
        }
    }
    return changed;
}
