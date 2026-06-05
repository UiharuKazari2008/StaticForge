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
