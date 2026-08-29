/** Seed sprout / Genso lock helpers (Phase 2 batch 13). */
function clearSeed() {
    if (manualSeed && manualSeed.value) {
        manualSeed.value = '';
        manualSeed.focus();

        // Reset sprout seed button state if it was active
        if (sproutSeedBtn && sproutSeedBtn.getAttribute('data-state') === 'on') {
            sproutSeedBtn.setAttribute('data-state', 'off');
            manualSeed.disabled = false;
        }

        // Update placeholder to show the seed value if available, or "Random" if not
        if (window.lastLoadedSeed) {
            manualSeed.placeholder = window.lastLoadedSeed || 'Randomize';
        } else {
            manualSeed.placeholder = 'Randomize';
        }
    }
    manualSeed.dispatchEvent(new Event('input', { bubbles: true }));
}

function updateSproutSeedButton() {
    if (sproutSeedBtn) {
        if (window.lastLoadedSeed) {
            sproutSeedBtn.classList.remove('hidden');
            // Update placeholder to show the seed value
            if (manualSeed) {
                manualSeed.placeholder = window.lastLoadedSeed || 'Randomize';
            }
        } else {
            sproutSeedBtn.classList.add('hidden');
            // Reset toggle state when no seed is available
            sproutSeedBtn.setAttribute('data-state', 'off');
            // Update placeholder to show "Random"
            if (manualSeed) {
                manualSeed.placeholder = 'Randomize';
            }
        }
    }
}

function updateSproutSeedButtonFromPreviewSeed() {
    if (sproutSeedBtn) {
        const seedValue = window.lastGeneratedSeed || window.lastLoadedSeed;
        if (seedValue !== null && seedValue !== undefined) {
            // Enable the sprout seed button and show it
            sproutSeedBtn.classList.remove('hidden');
            // Set the lastLoadedSeed so the button can function
            window.lastLoadedSeed = seedValue;

            if (manualSeed) {
                manualSeed.placeholder = seedValue.toString() || 'Randomize';
            }

            // Check if the button is currently in 'on' state
            const currentState = sproutSeedBtn.getAttribute('data-state');
            if (currentState === 'on') {
                // If randomize seed is off, check if current input value matches preview seed
                const currentInputValue = manualSeed ? parseInt(manualSeed.value) || '' : '';

                if (currentInputValue !== seedValue) {
                    loadSeedBtn.classList.remove('hidden');
                } else {
                    loadSeedBtn.classList.add('hidden');
                }
                // Don't auto-update the input field when there's a mismatch
            } else {
                // Reset button state to off initially and hide load seed button
                sproutSeedBtn.setAttribute('data-state', 'off');
                loadSeedBtn.classList.add('hidden');
            }
        } else {
            // Hide the buttons when no seed is available
            sproutSeedBtn.classList.add('hidden');
            sproutSeedBtn.setAttribute('data-state', 'off');
            loadSeedBtn.classList.add('hidden');
            // Clear the lastLoadedSeed
            window.lastLoadedSeed = null;

            // Update placeholder to show "Random"
            if (manualSeed) {
                manualSeed.placeholder = 'Randomize';
            }
        }
    }
}

function loadSeedFromPreview() {
    if (!loadSeedBtn || !window.lastGeneratedSeed) return;

    // Load the seed from the preview into the manual seed input
    if (manualSeed) {
        manualSeed.value = window.lastGeneratedSeed.toString();
        manualSeed.disabled = false; // Keep the field enabled for editing
    }

    // Hide the load seed button since the seed has been loaded
    loadSeedBtn.classList.add('hidden');

    // Set the sprout seed button to "on" state (unlocked) since we loaded a specific seed
    if (sproutSeedBtn) {
        sproutSeedBtn.setAttribute('data-state', 'on');
    }

    // Update the sprout seed button to reflect the new state
    updateSproutSeedButtonFromPreviewSeed();
    manualSeed.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Genso seeds present (whether or not they're already locked). */
function sproutHasGensoSeedList() {
    return Array.isArray(window.lastGenerationTextReplacements) && window.lastGenerationTextReplacements.length > 0;
}


/** At least one lockable expander is still unlocked — "Text Expanders +" still does something. */
function sproutNeedsExpandersLockChoice() {
    const seeds = window.lastGenerationTextReplacements;
    if (!Array.isArray(seeds) || seeds.length === 0) return false;
    const lockable = seeds.filter(r => (r.can_lock !== undefined ? r.can_lock !== false : true));
    if (lockable.length === 0) return false;
    return lockable.some(r => r.locked !== true);
}

function loadSproutExpandersFromPreviewMetadata() {
    if (!window.currentManualPreviewImage || !window.currentManualPreviewImage.metadata) return;
    const metadata = window.currentManualPreviewImage.metadata;
    if (!metadata.text_replacements_seed || !Array.isArray(metadata.text_replacements_seed)) return;

    const replacementsWithLockStatus = metadata.text_replacements_seed
        .filter(r => r.can_lock !== undefined ? r.can_lock !== false : true)
        .map(replacement => ({
            ...replacement,
            locked: true
        }));

    window.lastGenerationTextReplacements = replacementsWithLockStatus;
    window.lockedTextReplacements = replacementsWithLockStatus;
    updateMainLockButtonState();
}

function applySproutExpandersLockFromMemoryOrMetadata() {
    if (window.lastGenerationTextReplacements && window.lastGenerationTextReplacements.length > 0) {
        window.lastGenerationTextReplacements = window.lastGenerationTextReplacements.map(r => ({
            ...r,
            locked: (r.can_lock !== undefined ? r.can_lock !== false : true)
        }));
        window.lockedTextReplacements = window.lastGenerationTextReplacements.filter(s => s.locked);
        updateMainLockButtonState();
        return;
    }
    loadSproutExpandersFromPreviewMetadata();
}

async function toggleSproutSeed() {
    if (!sproutSeedBtn || !window.lastLoadedSeed) return;

    const currentState = sproutSeedBtn.getAttribute('data-state');
    const turningOff = currentState === 'on';

    if (turningOff) {
        sproutSeedBtn.setAttribute('data-state', 'off');
        manualSeed.value = '';
        manualSeed.disabled = false;
        if (manualSeed) {
            manualSeed.placeholder = window.lastLoadedSeed || 'Randomize';
        }
        manualSeed.dispatchEvent(new Event('input', { bubbles: true }));
        return;
    }

    const wantsExpanders = sproutNeedsExpandersLockChoice();
    const wantsTendai = dynamicGenerationNeedsTendaiLockChoice();
    /** No extra pinning exists beyond the seed → lock seed without a dialog */
    let scope = 'seed';
    if (wantsExpanders || wantsTendai) {
        const dialogButtons = [];
        if (wantsTendai) {
            dialogButtons.push({ text: 'Tendai +', value: 'tendai', className: 'btn-secondary' });
        }
        if (wantsExpanders) {
            dialogButtons.push({ text: 'Text Expanders +', value: 'expanders', className: 'btn-secondary' });
        }
        dialogButtons.push({ text: 'Seed', value: 'seed', className: 'btn-secondary' });
        const maxIdx = dialogButtons.findIndex(b => b.value === 'tendai');
        const primaryIdx = maxIdx !== -1 ? maxIdx : dialogButtons.findIndex(b => b.value === 'expanders');
        const pinIdx = primaryIdx !== -1 ? primaryIdx : dialogButtons.length - 1;
        dialogButtons.forEach((b, i) => {
            if (i === pinIdx) {
                b.className = 'btn-primary';
                b.primary = true;
            }
        });

        let msgParts = [];
        if (wantsTendai && wantsExpanders) {
            msgParts.push('Pinned Tendai output and unlocked Genso expanders are mixed with this seed.');
        } else if (wantsTendai) {
            msgParts.push('A cached Tendai compile can still be pinned.');
        } else {
            msgParts.push('Genso expanders can still be fully locked.');
        }
        msgParts.push('Pick what to pin with this seed.');
        const choice = await showConfirmationDialog(
            msgParts.join(' '),
            dialogButtons,
            null,
            { title: 'Lock seed scope', icon: 'fas fa-dice' }
        );
        if (choice === null || choice === undefined) return;
        scope = choice;
    }

    sproutSeedBtn.setAttribute('data-state', 'on');
    manualSeed.value = window.lastLoadedSeed;
    if (window.lastLoadedSeed) {
        sproutSeedBtn?.classList.remove('hidden');
    }

    manualSeed.disabled = true;
    if (manualSeed) {
        manualSeed.placeholder = window.lastLoadedSeed || 'Randomize';
    }

    if (scope === 'seed') {
        // Seed only — keep in-memory Genso locks. If there is no list yet, match older behavior: pull from preview metadata when nothing else is in play.
        if (!sproutHasGensoSeedList() && !dynamicGenerationHasCompileCache()) {
            loadSproutExpandersFromPreviewMetadata();
        }
    } else if (scope === 'expanders') {
        applySproutExpandersLockFromMemoryOrMetadata();
    } else if (scope === 'tendai') {
        if (sproutNeedsExpandersLockChoice()) {
            applySproutExpandersLockFromMemoryOrMetadata();
        }
        setDynamicGenerationLockState({ cacheLocked: true, contextLocked: true });
    }

    manualSeed.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Drive the existing Studio sprout seed lock without the expander/Tendai dialog.
 * Change JSON / GET /agent/session/state only — seed-only, no new chrome.
 * Called from public/scripts/comp/studioChangeJson.js
 */
function setSproutSeedLocked(locked, seedValue) {
    const seedEl = document.getElementById('manualSeed');
    const resolved = (seedValue != null && seedValue !== '')
        ? seedValue
        : (window.lastGeneratedSeed != null && window.lastGeneratedSeed !== ''
            ? window.lastGeneratedSeed
            : window.lastLoadedSeed);
    if (resolved != null && resolved !== '') {
        window.lastLoadedSeed = resolved;
    }

    if (locked) {
        if (resolved == null || resolved === '') return;
        if (sproutSeedBtn) {
            sproutSeedBtn.setAttribute('data-state', 'on');
            sproutSeedBtn.classList.remove('hidden');
        }
        if (seedEl) {
            seedEl.value = String(resolved);
            seedEl.disabled = true;
            seedEl.placeholder = String(resolved);
            seedEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return;
    }

    if (sproutSeedBtn) {
        sproutSeedBtn.setAttribute('data-state', 'off');
    }
    if (seedEl) {
        seedEl.value = '';
        seedEl.disabled = false;
        seedEl.placeholder = (window.lastLoadedSeed || window.lastGeneratedSeed || 'Randomize').toString();
        seedEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

