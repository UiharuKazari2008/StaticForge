// Credit Cost Confirmation Dialog System
// Shows cost confirmation for paid requests

let creditCostDialogActive = false;
let creditCostDialogKeyboardRegistered = false;
let creditCostDialogConfirmHandler = null;
let creditCostDialogCancelHandler = null;

function handleCreditCostDialogKeydown(e) {
    if (!creditCostDialogActive) return;
    const dialog = document.getElementById('creditCostDialog');
    if (!dialog || dialog.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        if (creditCostDialogCancelHandler) {
            creditCostDialogCancelHandler(e);
        }
        return true;
    }
    if (e.key === 'Enter') {
        if (e.target.closest('.credit-cost-buttons') && e.target.tagName === 'BUTTON') {
            return;
        }
        e.preventDefault();
        if (creditCostDialogConfirmHandler) {
            creditCostDialogConfirmHandler(e);
        }
        return true;
    }
}

function ensureCreditCostDialogKeyboardRegistered() {
    if (creditCostDialogKeyboardRegistered) return;
    creditCostDialogKeyboardRegistered = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'creditCostDialog.keydown',
        handler: handleCreditCostDialogKeydown,
        type: 'whenOpen',
        modalId: 'creditCostDialog',
        priority: 85,
        critical: true,
        showInOverlay: false
    });
    registerKeyboardListener({
        id: 'overlay.creditCost.escape',
        type: 'whenOpen',
        modalId: 'creditCostDialog',
        label: 'Cancel',
        keys: 'Esc',
        overlayIcon: 'fas fa-times',
        overlayGroup: 'Dialog',
        overlayOnly: true,
        priority: -10
    });
    registerKeyboardListener({
        id: 'overlay.creditCost.enter',
        type: 'whenOpen',
        modalId: 'creditCostDialog',
        label: 'Confirm',
        keys: 'Enter',
        overlayIcon: 'fas fa-check',
        overlayGroup: 'Dialog',
        overlayOnly: true,
        priority: -10
    });
}

// Create and show credit cost confirmation dialog
function showCreditCostDialog(cost, event = null, outputResolution = null, isUpscaling = false, imageWidth = null, imageHeight = null, isFreeUpscaling = false) {
    return new Promise((resolve, reject) => {
        ensureCreditCostDialogKeyboardRegistered();

        // Create fresh dialog elements each time
        const dialog = document.createElement('div');
        dialog.id = 'creditCostDialog';
        dialog.className = 'modal hidden transient tool-window on-top credit-cost-dialog';
        if (isUpscaling) dialog.style.width = '420px';

        // Build content programmatically
        const content = document.createElement('div');
        content.className = 'credit-cost-content';

        const header = document.createElement('div');
        header.className = 'credit-cost-header';

        const icon = document.createElement('i');
        icon.className = isUpscaling ? 'nai-upscale' : 'nai-anla';
        header.appendChild(icon);

        const title = document.createElement('span');
        title.textContent = isUpscaling ? 'Upscale Image' : 'Payment Required';
        header.appendChild(title);

        const message = document.createElement('div');
        message.className = 'credit-cost-message';

        // ESRGAN options for upscaling
        let selectedUpscaler = 'novelai';
        let selectedScale = 4;
        let selectedLocalModel = null;
        let selectedSpeed = 'instant';
        let applyUpscaleChoice = null;

        if (isUpscaling) {
            let novelaiAvailable = false;
            if (imageWidth && imageHeight) {
                novelaiAvailable = !!calculateUpscaleInfo(imageWidth, imageHeight).available;
            }
            if (!novelaiAvailable) {
                selectedUpscaler = 'local';
                selectedSpeed = 'fast';
            }
            message.textContent = 'Choose scale and delivery:';
            message.style.flexDirection = 'column';
            message.style.alignItems = 'stretch';

            const panel = document.createElement('div');
            panel.className = 'director-expandable-content';
            const choiceState = { scale: selectedScale, speed: selectedSpeed };
            const scaleBtn = document.createElement('button');
            scaleBtn.type = 'button';
            scaleBtn.className = 'custom-dropdown-btn hover-show colored indicator';
            scaleBtn.setAttribute('data-state', 'on');
            const scaleLabel = document.createElement('span');
            scaleLabel.textContent = '4x';
            scaleBtn.appendChild(scaleLabel);
            const speedBtn = document.createElement('button');
            speedBtn.type = 'button';
            speedBtn.className = 'custom-dropdown-btn hover-show colored indicator';
            speedBtn.setAttribute('data-state', novelaiAvailable ? 'on' : 'off');
            const speedLabel = document.createElement('span');
            speedLabel.textContent = upscaleSpeedLabel(selectedSpeed);
            speedBtn.appendChild(speedLabel);

            function choiceRow(caption, button) {
                const row = document.createElement('div');
                row.className = 'form-group';
                const label = document.createElement('label');
                label.textContent = caption;
                row.appendChild(label);
                row.appendChild(button);
                return row;
            }
            panel.appendChild(choiceRow('Scale', scaleBtn));
            panel.appendChild(choiceRow('Delivery', speedBtn));
            message.appendChild(panel);

            applyUpscaleChoice = () => {
                selectedScale = choiceState.scale;
                selectedSpeed = choiceState.speed;
                selectedUpscaler = selectedSpeed === 'instant' ? 'novelai' : 'local';
                selectedLocalModel = null;
                scaleLabel.textContent = selectedScale + 'x';
                speedLabel.textContent = upscaleSpeedLabel(selectedSpeed);
                speedBtn.setAttribute('data-state', upscaleDeliveryIndicator(selectedSpeed, () => novelaiAvailable, knownLocalUpscaleStatus()));
                if (!confirmBtn) return;
                confirmBtn.textContent = '';
                if (selectedSpeed === 'instant' && !isFreeUpscaling) {
                    confirmBtn.appendChild(document.createTextNode('Upscale (' + cost + ' credits) '));
                } else {
                    confirmBtn.appendChild(document.createTextNode('Upscale '));
                }
                const arrowIcon = document.createElement('i');
                arrowIcon.className = 'fas fa-arrow-right';
                confirmBtn.appendChild(arrowIcon);
            };

            // wireUpscaleChoiceMenus: public/scripts/comp/creditCostDialog.js
            wireUpscaleChoiceMenus(scaleBtn, speedBtn, choiceState, {
                novelaiAvailable: () => novelaiAvailable,
                getStatus: () => knownLocalUpscaleStatus(),
                labels: { scale: scaleLabel, speed: speedLabel },
                onChange: () => applyUpscaleChoice()
            });
        } else {
            // Normal cost dialog for non-upscaling requests
            message.textContent = 'This will cost ';

            const costContainer = document.createElement('div');
            costContainer.className = 'credit-cost-cost';

            const costIcon = document.createElement('i');
            costIcon.className = 'nai-anla';
            costContainer.appendChild(costIcon);

            const costText = document.createElement('strong');
            costText.textContent = cost;
            costContainer.appendChild(costText);

            message.appendChild(costContainer);

            // Add output resolution if provided
            if (outputResolution && outputResolution.width && outputResolution.height) {
                message.appendChild(document.createTextNode(' to generate (→ '));
                const resolutionSpan = document.createElement('strong');
                resolutionSpan.textContent = `${outputResolution.width}×${outputResolution.height}`;
                message.appendChild(resolutionSpan);
                message.appendChild(document.createTextNode(')'));
            } else {
                message.appendChild(document.createTextNode(' to generate'));
            }
        }

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

        if (isUpscaling) {
            // Button text depends on selected upscaler
            // Calculate upscale info to determine NovelAI availability
            let novelaiAvailableForButton = false;
            if (imageWidth && imageHeight) {
                const upscaleInfoForButton = calculateUpscaleInfo(imageWidth, imageHeight);
                novelaiAvailableForButton = upscaleInfoForButton.available;
            }

            if (applyUpscaleChoice) {
                applyUpscaleChoice();
            } else if (novelaiAvailableForButton) {
                const buttonText = isFreeUpscaling ? 'Upscale ' : `Upscale (${cost} credits) `;
                confirmBtn.textContent = buttonText;
                const arrowIcon = document.createElement('i');
                arrowIcon.className = 'fas fa-arrow-right';
                confirmBtn.appendChild(arrowIcon);
            } else {
                confirmBtn.textContent = 'Upscale ';
                const arrowIcon = document.createElement('i');
                arrowIcon.className = 'fas fa-arrow-right';
                confirmBtn.appendChild(arrowIcon);
            }
        } else {
            confirmBtn.textContent = 'Generate ';
            const arrowIcon = document.createElement('i');
            arrowIcon.className = 'fas fa-arrow-right';
            confirmBtn.appendChild(arrowIcon);
        }

        buttons.appendChild(cancelBtn);
        buttons.appendChild(confirmBtn);

        content.appendChild(header);
        content.appendChild(message);
        content.appendChild(buttons);
        dialog.appendChild(content);

        document.body.appendChild(dialog);

        // Add event listeners with current promise resolve/reject
        const handleConfirm = (e) => {
            e.preventDefault();
            cleanupCreditCostDialog(dialog);
            if (isUpscaling) {
                resolve({
                    confirmed: true,
                    upscaler: selectedUpscaler,
                    scale: selectedScale,
                    speed: selectedSpeed,
                    model: selectedLocalModel
                });
            } else {
                resolve(true);
            }
        };

        const handleCancel = (e) => {
            e.preventDefault();
            cleanupCreditCostDialog(dialog);
            resolve(false);
        };

        creditCostDialogConfirmHandler = handleConfirm;
        creditCostDialogCancelHandler = handleCancel;

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);

        // Position dialog near mouse or button
        positionCreditCostDialog(event, dialog);

        dialog.dataset.windowPositionMode = 'manual-only';
        // openModal, assignModalZIndex — public/scripts/comp/modalUtils.js
        openModal(dialog);
        assignModalZIndex(dialog);
        creditCostDialogActive = true;
    });
}

// Clean up and remove credit cost dialog
function cleanupCreditCostDialog(dialog) {
    creditCostDialogActive = false;
    creditCostDialogConfirmHandler = null;
    creditCostDialogCancelHandler = null;
    if (dialog) {
        // teardownDropdown: public/scripts/comp/dropdown.js
        dialog.querySelectorAll('.custom-dropdown').forEach((dropdown) => {
            teardownDropdown(dropdown);
        });
        // contextMenu.detachClickMenuFromElement: public/scripts/comp/contextMenu.js
        dialog.querySelectorAll('[data-click-menu]').forEach((el) => {
            contextMenu.detachClickMenuFromElement(el);
        });
        // closeModal — public/scripts/comp/modalUtils.js
        closeModal(dialog).then(() => {
            if (dialog.parentNode) {
                dialog.parentNode.removeChild(dialog);
            }
        });
    }
}

// Hide credit cost dialog (legacy function for compatibility)
function hideCreditCostDialog() {
    const dialog = document.getElementById('creditCostDialog');
    if (dialog) {
        cleanupCreditCostDialog(dialog);
    }
}

// Position dialog near mouse or button
function positionCreditCostDialog(event, dialog) {
    if (!dialog) return;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // Get dialog dimensions (use a reasonable default if not yet rendered)
    const dialogWidth = 420; // Match the wider upscale method list
    const dialogHeight = 150; // Approximate height
    
    let x, y;
    
    if (event && event.clientX !== undefined && event.clientY !== undefined) {
        // Position near mouse/button
        x = event.clientX - dialogWidth / 2;
        y = event.clientY - dialogHeight - 10;
        
        // If dialog would go above the mouse, position it below instead
        if (y < 10) {
            y = event.clientY + 10;
        }
    } else if (event && event.submitter) {
        // Position near the submitter button for form submissions
        const submitter = event.submitter;
        const rect = submitter.getBoundingClientRect();
        x = rect.left + rect.width / 2 - dialogWidth / 2;
        y = rect.top - dialogHeight - 10;
        
        // If dialog would go above the button, position it below instead
        if (y < 10) {
            y = rect.bottom + 10;
        }
    } else {
        // Center on screen
        x = (windowWidth - dialogWidth) / 2;
        y = (windowHeight - dialogHeight) / 2;
    }
    
    // Ensure dialog doesn't go off screen
    if (x < 10) x = 10;
    if (y < 10) y = 10;
    if (x + dialogWidth > windowWidth - 10) x = windowWidth - dialogWidth - 10;
    if (y + dialogHeight > windowHeight - 10) y = windowHeight - dialogHeight - 10;
    
    // Ensure we have valid coordinates
    if (isNaN(x) || isNaN(y)) {
        x = (windowWidth - dialogWidth) / 2;
        y = (windowHeight - dialogHeight) / 2;
    }
    
    dialog.style.left = x + 'px';
    dialog.style.top = y + 'px';
    
    // Debug: Log positioning calculations
    console.log('🎯 Dialog positioned:', {
        calculatedX: x,
        calculatedY: y,
        appliedLeft: dialog.style.left,
        appliedTop: dialog.style.top,
        windowDimensions: { width: windowWidth, height: windowHeight },
        dialogDimensions: { width: dialogWidth, height: dialogHeight },
        event: event ? { clientX: event.clientX, clientY: event.clientY } : 'no event'
    });   
}


// Check if a request requires paid credits
function requiresPaidCredits(requestBody) {    
    // Check for upscaling. Local Ruiko upscale does not spend Anlas.
    const localUpscale = requestBody && (requestBody.upscaler === 'local' || requestBody.backend === 'local');
    if (requestBody.upscale && requestBody.upscale > 1 && !localUpscale) return true;
    
    // Check for large resolutions
    if (requestBody.resolution) {
        if (requestBody.resolution.toLowerCase().startsWith('large_') || requestBody.resolution.toLowerCase().startsWith('xlarge_') || requestBody.resolution.toLowerCase().startsWith('wallpaper_')) {
            return true;
        }
        
        // Check custom dimensions
        if (requestBody.resolution.includes('x')) {
            const [width, height] = requestBody.resolution.split('x').map(Number);
            if (width > 1024 || height > 1024) {
                return true;
            }
        }
    }
    
    // Check for high steps
    if (requestBody.steps && requestBody.steps > 28) {
        return true;
    }
    
    return false;
}

function upscaleSpeedLabel(speed) {
    if (speed === 'instant') return 'Instant';
    if (speed === 'slow') return 'Slow';
    return 'Fast';
}

function upscaleScaleChoices(status) {
    const scales = [2, 4];
    const workers = status && Array.isArray(status.workers) ? status.workers : [];
    workers.forEach((worker) => {
        const max = Number(worker.maxScale);
        if (max === 8 && scales.indexOf(8) === -1) scales.push(8);
    });
    return scales;
}

function slowDeliveryHint(status) {
    const workers = status && Array.isArray(status.workers) ? status.workers : [];
    const g10 = workers.find((worker) => worker.role === 'g10' || worker.id === 'g10');
    const max = g10 && Number(g10.maxScale) > 0 ? Number(g10.maxScale) : 4;
    return 'G10 up to ' + max + 'x, Ruiko beyond';
}

function novelaiAvailableNow(flag) {
    // Callers pass a function. Studio: public/scripts/comp/manualGenerationParams.js
    return !!flag();
}

function upscaleDeliveryIndicator(speed, novelaiFlag, status) {
    const novelaiOk = novelaiAvailableNow(novelaiFlag);
    const workers = status && Array.isArray(status.workers) ? status.workers : [];
    if (speed === 'instant') return novelaiOk ? 'on' : 'off';
    if (speed === 'slow') {
        const g10 = workers.find((worker) => (worker.role === 'g10' || worker.id === 'g10') && worker.online);
        if (g10) return 'on';
        const ruiko = workers.find((worker) => (worker.role === 'ruiko' || worker.id === 'ruiko') && worker.online);
        if (ruiko) return 'partial';
        return status && status.online ? 'partial' : 'off';
    }
    if (workers.some((worker) => worker.online) || (status && status.online)) return 'on';
    return 'off';
}

function knownLocalUpscaleStatus() {
    return localUpscaleModelCache;
}

function wireUpscaleChoiceMenus(scaleBtn, speedBtn, state, options) {
    if (!scaleBtn || !speedBtn || !state) return;
    const opts = options || {};
    function status() {
        return opts.getStatus ? opts.getStatus() : knownLocalUpscaleStatus();
    }
    function novelaiOk() {
        return novelaiAvailableNow(opts.novelaiAvailable);
    }
    function paint() {
        const scaleText = state.scale + 'x';
        const speedText = upscaleSpeedLabel(state.speed);
        if (opts.labels && opts.labels.scale) opts.labels.scale.textContent = scaleText;
        else {
            const scaleSpan = scaleBtn.querySelector('span');
            if (scaleSpan) scaleSpan.textContent = scaleText;
        }
        if (opts.labels && opts.labels.speed) opts.labels.speed.textContent = speedText;
        else {
            const speedSpan = speedBtn.querySelector('span');
            if (speedSpan) speedSpan.textContent = speedText;
        }
        speedBtn.setAttribute('data-state', upscaleDeliveryIndicator(state.speed, novelaiOk(), status()));
        scaleBtn.setAttribute('data-state', 'on');
    }
    // contextMenu.attachPickerMenu: public/scripts/comp/contextMenu.js
    contextMenu.attachPickerMenu(scaleBtn, {
        items: () => upscaleScaleChoices(status()).map((scale) => ({
            value: scale,
            text: scale + 'x'
        })),
        value: () => state.scale,
        onSelect: (value) => {
            const n = Number(value);
            state.scale = (n === 2 || n === 3 || n === 8) ? n : 4;
            paint();
            if (opts.onChange) opts.onChange(state);
        }
    });
    contextMenu.attachPickerMenu(speedBtn, {
        items: () => ([
            { value: 'instant', text: 'Instant', subtext: 'NovelAI', disabled: !novelaiOk() },
            { value: 'fast', text: 'Fast', subtext: 'Ruiko or G10, whichever handles this scale' },
            { value: 'slow', text: 'Slow', subtext: slowDeliveryHint(status()) }
        ]),
        value: () => state.speed,
        onSelect: (value) => {
            if (value === 'instant' && novelaiOk()) state.speed = 'instant';
            else if (value === 'slow') state.speed = 'slow';
            else state.speed = 'fast';
            paint();
            if (opts.onChange) opts.onChange(state);
        }
    });
    paint();
}

const LOCAL_UPSCALE_MODELS = [
    { id: 'RealESRGAN_x4plus', name: 'RealESRGAN x4plus' },
    { id: 'RealESRGAN_x4plus_anime_6B', name: 'RealESRGAN anime 6B' },
    { id: '4x-UltraSharp', name: '4x-UltraSharp' }
];

let localUpscaleModelCache = null;

function knownLocalUpscaleModels() {
    if (localUpscaleModelCache && Array.isArray(localUpscaleModelCache.models) && localUpscaleModelCache.models.length) {
        return localUpscaleModelCache.models;
    }
    return LOCAL_UPSCALE_MODELS.slice();
}

function isLocalWorkerOfflineError(error) {
    const message = error && error.message ? String(error.message) : String(error || '');
    return message.indexOf('backend="nai"') !== -1 || message.indexOf('LOCAL_WORKER_OFFLINE') !== -1;
}

async function fetchLocalUpscaleModels() {
    const fallback = {
        online: false,
        configured: false,
        models: LOCAL_UPSCALE_MODELS.slice(),
        reason: 'The local worker is offline or not configured.'
    };
    if (!window.wsClient || typeof window.wsClient.isConnected !== 'function' || !window.wsClient.isConnected()) {
        return fallback;
    }
    try {
        const pending = window.wsClient.sendMessage('local_upscale_status', {}, false);
        const data = await Promise.race([
            pending,
            new Promise((resolve) => setTimeout(() => resolve(null), 1200))
        ]);
        if (!data || !Array.isArray(data.models) || !data.models.length) {
            return localUpscaleModelCache || fallback;
        }
        localUpscaleModelCache = {
            online: !!data.online,
            configured: !!data.configured,
            models: data.models,
            reason: data.reason || null,
            gpu: data.gpu || null,
            workers: Array.isArray(data.workers) ? data.workers : []
        };
        return localUpscaleModelCache;
    } catch (err) {
        return {
            ...fallback,
            reason: err && err.message ? err.message : fallback.reason
        };
    }
}

async function confirmNaiUpscaleFallback(error) {
    const detail = error && error.message ? error.message : 'The local worker is offline.';
    const choice = await showConfirmationDialog(
        detail + ' Use NovelAI upscale instead? This spends Anlas.',
        [
            { text: 'Use NovelAI', value: 'nai', className: 'btn-primary' },
            { text: 'Cancel', value: 'cancel', className: 'btn-secondary' }
        ]
    );
    return choice === 'nai';
}

function fillLocalUpscaleSelect(select, includeNovelAi) {
    if (!select || String(select.tagName || '').toLowerCase() !== 'select') return;
    const previous = select.value || (includeNovelAi ? 'novelai' : '');
    select.textContent = '';
    if (includeNovelAi) {
        const nai = document.createElement('option');
        nai.value = 'novelai';
        nai.textContent = 'NovelAI';
        select.appendChild(nai);
    }
    knownLocalUpscaleModels().forEach((model) => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = 'Local ' + (model.name || model.id);
        select.appendChild(option);
    });
    const values = Array.from(select.options).map((option) => option.value);
    select.value = values.indexOf(previous) !== -1 ? previous : (includeNovelAi ? 'novelai' : (values[0] || ''));
}

async function refreshLocalUpscaleSelects() {
    await fetchLocalUpscaleModels();
    fillLocalUpscaleSelect(document.getElementById('manualUpscaleModel'), true);
    fillLocalUpscaleSelect(document.getElementById('enhanceUpscaleModel'), true);
    fillLocalUpscaleSelect(document.getElementById('enhanceMiniUpscaleModel'), true);
}
