// Animate (Ruiko) dialog: motion prompt + frames/fps/loop + backend picker.
// Reuses creditCostDialog.js's DOM-building style, classes, custom-dropdown
// helpers (dropdown.js), and positioning/modal plumbing — no native <select>,
// no new ad-hoc styles.

let animateImageDialogActive = false;

const LOCAL_ANIMATE_BACKENDS = [
    { id: 'animatediff', name: 'AnimateDiff (SD1.5)' },
    { id: 'wan', name: 'Wan 2.1 1.3B (480p, experimental)' }
];

let localAnimateBackendCache = null;

function knownLocalAnimateBackends() {
    if (localAnimateBackendCache && Array.isArray(localAnimateBackendCache.backends) && localAnimateBackendCache.backends.length) {
        return localAnimateBackendCache.backends;
    }
    return LOCAL_ANIMATE_BACKENDS.slice();
}

async function fetchLocalAnimateStatus() {
    const fallback = {
        online: false,
        configured: false,
        backends: LOCAL_ANIMATE_BACKENDS.slice(),
        reason: 'Ruiko is offline or not configured.'
    };
    if (!window.wsClient || typeof window.wsClient.isConnected !== 'function' || !window.wsClient.isConnected()) {
        return fallback;
    }
    try {
        const pending = window.wsClient.sendMessage('local_animate_status', {}, false);
        const data = await Promise.race([
            pending,
            new Promise((resolve) => setTimeout(() => resolve(null), 1200))
        ]);
        if (!data || !Array.isArray(data.backends) || !data.backends.length) {
            return localAnimateBackendCache || fallback;
        }
        localAnimateBackendCache = {
            online: !!data.online,
            configured: !!data.configured,
            backends: data.backends,
            reason: data.reason || null,
            gpu: data.gpu || null
        };
        return localAnimateBackendCache;
    } catch (err) {
        return {
            ...fallback,
            reason: err && err.message ? err.message : fallback.reason
        };
    }
}

function cleanupAnimateImageDialog(dialog) {
    animateImageDialogActive = false;
    if (dialog) {
        // teardownDropdown: public/scripts/comp/dropdown.js
        dialog.querySelectorAll('.custom-dropdown').forEach((dropdown) => {
            teardownDropdown(dropdown);
        });
        // closeModal — public/scripts/comp/modalUtils.js
        closeModal(dialog).then(() => {
            if (dialog.parentNode) {
                dialog.parentNode.removeChild(dialog);
            }
        });
    }
}

// Shows the Animate (Ruiko) dialog and resolves to
// {confirmed, motionPrompt, frames, fps, loop, backend} or false on cancel.
async function showAnimateImageDialog(event = null) {
    await fetchLocalAnimateStatus();

    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.id = 'animateImageDialog';
        dialog.className = 'modal hidden transient tool-window on-top credit-cost-dialog';

        const content = document.createElement('div');
        content.className = 'credit-cost-content';

        const header = document.createElement('div');
        header.className = 'credit-cost-header';
        const icon = document.createElement('i');
        icon.className = 'fas fa-film';
        header.appendChild(icon);
        const title = document.createElement('span');
        title.textContent = 'Animate (Ruiko)';
        header.appendChild(title);

        const message = document.createElement('div');
        message.className = 'credit-cost-message';

        const promptLabel = document.createElement('div');
        promptLabel.textContent = 'Motion prompt:';
        message.appendChild(promptLabel);

        const promptInput = document.createElement('textarea');
        promptInput.id = 'animateMotionPrompt';
        promptInput.className = 'form-control hover-show colored';
        promptInput.rows = 2;
        promptInput.style.width = '100%';
        promptInput.placeholder = 'e.g. hair and clothing sway in the wind, slow blink';
        message.appendChild(promptInput);

        // Backend picker — custom-dropdown (dropdown.js), not a native <select>.
        let selectedBackend = 'animatediff';
        const backends = knownLocalAnimateBackends();
        if (backends.length && !backends.some((b) => b.id === selectedBackend)) {
            selectedBackend = backends[0].id;
        }

        const backendLabel = document.createElement('div');
        backendLabel.textContent = 'Backend:';
        backendLabel.style.marginTop = '8px';
        message.appendChild(backendLabel);

        const backendDropdown = document.createElement('div');
        backendDropdown.id = 'animateBackendDropdown';
        backendDropdown.className = 'custom-dropdown dropup dark';

        const backendBtn = document.createElement('button');
        backendBtn.type = 'button';
        backendBtn.id = 'animateBackendDropdownBtn';
        backendBtn.className = 'custom-dropdown-btn hover-show colored';
        backendBtn.style.width = '100%';
        backendBtn.style.maxWidth = '300px';
        backendDropdown.appendChild(backendBtn);

        const backendMenu = document.createElement('div');
        backendMenu.id = 'animateBackendDropdownMenu';
        backendMenu.className = 'custom-dropdown-menu hidden';

        function renderBackendLabel() {
            const match = backends.find((b) => b.id === selectedBackend);
            backendBtn.textContent = match ? match.name : selectedBackend;
        }

        backends.forEach((backendOpt) => {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (backendOpt.id === selectedBackend ? ' selected' : '');
            option.dataset.backend = backendOpt.id;
            option.textContent = backendOpt.name;
            option.addEventListener('click', () => {
                selectedBackend = backendOpt.id;
                renderBackendLabel();
                backendMenu.querySelectorAll('.custom-dropdown-option').forEach((opt) => {
                    opt.classList.toggle('selected', opt.dataset.backend === selectedBackend);
                });
                closeDropdown(backendMenu, backendBtn);
            });
            backendMenu.appendChild(option);
        });
        renderBackendLabel();
        backendDropdown.appendChild(backendMenu);
        message.appendChild(backendDropdown);

        // setupDropdown: public/scripts/comp/dropdown.js
        setupDropdown(backendDropdown, backendBtn, backendMenu, () => {}, () => ({ backend: selectedBackend }), { preventFocusTransfer: true });

        const optionsRow = document.createElement('div');
        optionsRow.className = 'credit-cost-options-row';
        optionsRow.style.display = 'flex';
        optionsRow.style.gap = '12px';
        optionsRow.style.marginTop = '8px';
        optionsRow.style.alignItems = 'center';

        const framesLabel = document.createElement('label');
        framesLabel.appendChild(document.createTextNode('Frames '));
        const framesInput = document.createElement('input');
        framesInput.type = 'number';
        framesInput.min = '8';
        framesInput.max = '32';
        framesInput.value = '16';
        framesInput.className = 'form-control hover-show colored';
        framesInput.style.width = '64px';
        framesLabel.appendChild(framesInput);

        const fpsLabel = document.createElement('label');
        fpsLabel.appendChild(document.createTextNode('FPS '));
        const fpsInput = document.createElement('input');
        fpsInput.type = 'number';
        fpsInput.min = '4';
        fpsInput.max = '24';
        fpsInput.value = '8';
        fpsInput.className = 'form-control hover-show colored';
        fpsInput.style.width = '64px';
        fpsLabel.appendChild(fpsInput);

        const loopLabel = document.createElement('label');
        const loopInput = document.createElement('input');
        loopInput.type = 'checkbox';
        loopInput.checked = true;
        loopLabel.appendChild(loopInput);
        loopLabel.appendChild(document.createTextNode(' Loop'));

        optionsRow.appendChild(framesLabel);
        optionsRow.appendChild(fpsLabel);
        optionsRow.appendChild(loopLabel);
        message.appendChild(optionsRow);

        const buttons = document.createElement('div');
        buttons.className = 'credit-cost-buttons';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'credit-cost-cancel-btn btn-secondary';
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'credit-cost-confirm-btn btn-primary';
        confirmBtn.type = 'button';
        confirmBtn.setAttribute('data-dialog-primary', '1');
        confirmBtn.textContent = 'Animate ';
        const arrowIcon = document.createElement('i');
        arrowIcon.className = 'fas fa-arrow-right';
        confirmBtn.appendChild(arrowIcon);

        buttons.appendChild(cancelBtn);
        buttons.appendChild(confirmBtn);

        content.appendChild(header);
        content.appendChild(message);
        content.appendChild(buttons);
        dialog.appendChild(content);
        document.body.appendChild(dialog);

        const handleConfirm = (e) => {
            e.preventDefault();
            const motionPrompt = promptInput.value.trim();
            if (!motionPrompt) {
                promptInput.focus();
                return;
            }
            cleanupAnimateImageDialog(dialog);
            resolve({
                confirmed: true,
                motionPrompt,
                frames: parseInt(framesInput.value, 10) || 16,
                fps: parseInt(fpsInput.value, 10) || 8,
                loop: !!loopInput.checked,
                backend: selectedBackend
            });
        };

        const handleCancel = (e) => {
            e.preventDefault();
            cleanupAnimateImageDialog(dialog);
            resolve(false);
        };

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);

        // positionCreditCostDialog: public/scripts/comp/creditCostDialog.js (generic, dialog passed in)
        positionCreditCostDialog(event, dialog);

        dialog.dataset.windowPositionMode = 'manual-only';
        // openModal, assignModalZIndex — public/scripts/comp/modalUtils.js
        openModal(dialog);
        assignModalZIndex(dialog);
        animateImageDialogActive = true;
    });
}
