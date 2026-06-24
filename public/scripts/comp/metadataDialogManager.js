/**
 * Metadata dialog show/hide, table population, and expansion toggles.
 * DOM refs: manualModalManager.js. Wired via registerInitStep 47.6.
 */

// Metadata dialog functions
function showMetadataDialog() {
    if (currentImage && currentImage.metadata && metadataDialog) {
        populateDialogMetadataTable(currentImage.metadata);
        openModal(metadataDialog);
    }
}

function hideMetadataDialog() {
    if (metadataDialog) {
        metadataDialog.classList.add('hidden');
    }

    // Hide expanded sections
    if (dialogPromptExpanded) dialogPromptExpanded.classList.add('hidden');
    if (dialogUcExpanded) dialogUcExpanded.classList.add('hidden');
}

function populateDialogMetadataTable(metadata) {
    // Type and Name
    const typeElement = document.getElementById('dialogMetadataType');
    const nameElement = document.getElementById('dialogMetadataName');

    if (typeElement && nameElement) {
        if (metadata.request_type) {
            // formatRequestType: websocket.js RequestBannerManager
            typeElement.textContent = wsClient.bannerManager.formatRequestType(metadata.request_type) || metadata.request_type;

            // Show/hide name field based on preset_name availability
            const nameCell = nameElement.closest('.metadata-cell');
            if (metadata.preset_name) {
                nameElement.textContent = metadata.preset_name;
                if (nameCell) nameCell.classList.remove('hidden');
            } else {
                if (nameCell) nameCell.classList.add('hidden');
            }
        } else {
            typeElement.textContent = '-';
            const nameCell = nameElement.closest('.metadata-cell');
            if (nameCell) nameCell.classList.add('hidden');
        }
    }

    // Model
    const modelElement = document.getElementById('dialogMetadataModel');
    if (modelElement) {
        modelElement.textContent = metadata.model_display_name || metadata.model || '-';
    }

    // Resolution
    const resolutionElement = document.getElementById('dialogMetadataResolution');
    if (resolutionElement) {
        if (metadata.resolution) {
            let resolutionText = formatResolution(metadata.resolution);
            if (metadata.upscaled) {
                resolutionElement.innerHTML = `${resolutionText} <span class="badge upscaled-badge">Upscaled</span>`;
            } else {
                resolutionElement.textContent = resolutionText;
            }
        } else if (metadata.width && metadata.height) {
            let dimensionText = `${metadata.width} × ${metadata.height}`;
            if (metadata.upscaled) {
                resolutionElement.innerHTML = `${dimensionText} <span class="badge upscaled-badge">Upscaled</span>`;
            } else {
                resolutionElement.textContent = dimensionText;
            }
        } else {
            resolutionElement.textContent = '-';
        }
    }

    // Steps
    const stepsElement = document.getElementById('dialogMetadataSteps');
    if (stepsElement) {
        const stepsText = metadata.steps || '-';
        if (metadata.skip_cfg_above_sigma !== null && metadata.skip_cfg_above_sigma !== undefined) {
            stepsElement.innerHTML = `${stepsText} <i class="fas fa-tint variety-icon" title="Variety+ enabled"></i>`;
        } else {
            stepsElement.textContent = stepsText;
        }
    }

    // Seeds - Handle display logic
    const seed1Element = document.getElementById('dialogMetadataSeed1');
    const seed2Element = document.getElementById('dialogMetadataSeed2');

    if (seed1Element && seed2Element) {
        const seed1Cell = seed1Element.closest('.metadata-cell');
        const seed2Cell = seed2Element.closest('.metadata-cell');
        const seed1Label = seed1Cell ? seed1Cell.querySelector('.metadata-label') : null;
        const seed2Label = seed2Cell ? seed2Cell.querySelector('.metadata-label') : null;

        if (seed1Label && seed2Label) {
            const hasLayer2Seed = metadata.layer2Seed !== undefined;

            if (hasLayer2Seed) {
                seed1Label.textContent = 'Seed 1';
                seed2Label.textContent = 'Seed 2';
                seed1Element.textContent = metadata.layer1Seed || '-';
                seed2Element.textContent = metadata.layer2Seed || '-';
                seed1Cell.classList.remove('hidden');
                seed2Cell.classList.remove('hidden');
            } else {
                seed1Label.textContent = 'Seed';
                seed1Element.textContent = metadata.layer1Seed || metadata.seed || '-';
                seed1Cell.classList.remove('hidden');
                seed2Cell.classList.add('hidden');
            }
        }
    }

    // Guidance
    const guidanceElement = document.getElementById('dialogMetadataGuidance');
    if (guidanceElement) {
        guidanceElement.textContent = metadata.scale || '-';
    }

    // Rescale
    const rescaleElement = document.getElementById('dialogMetadataRescale');
    if (rescaleElement) {
        rescaleElement.textContent = metadata.cfg_rescale || '-';
    }

    // Sampler
    const samplerElement = document.getElementById('dialogMetadataSampler');
    if (samplerElement) {
        const samplerObj = getSamplerMeta(metadata.sampler);
        samplerElement.textContent = samplerObj ? samplerObj.display : (metadata.sampler || '-');
    }

    // Noise Schedule
    const noiseScheduleElement = document.getElementById('dialogMetadataNoiseSchedule');
    if (noiseScheduleElement) {
        const noiseObj = getNoiseMeta(metadata.noise_schedule);
        noiseScheduleElement.textContent = noiseObj ? noiseObj.display : (metadata.noise_schedule || '-');
    }

    // Store prompt and UC content for expandable sections
    if (dialogPromptContent) {
        dialogPromptContent.textContent = metadata.prompt || 'No prompt available';
    }
    if (dialogUcContent) {
        dialogUcContent.textContent = metadata.uc || 'No undesired content specified';
    }
}

function toggleDialogExpanded(type) {
    if (type === 'prompt' && dialogPromptExpanded && dialogUcExpanded) {
        if (dialogPromptExpanded.classList.contains('hidden')) {
            dialogPromptExpanded.classList.remove('hidden');
            dialogUcExpanded.classList.add('hidden');
        } else {
            dialogPromptExpanded.classList.add('hidden');
        }
    } else if (type === 'uc' && dialogUcExpanded && dialogPromptExpanded) {
        if (dialogUcExpanded.classList.contains('hidden')) {
            dialogUcExpanded.classList.remove('hidden');
            dialogPromptExpanded.classList.add('hidden');
        } else {
            dialogUcExpanded.classList.add('hidden');
        }
    }
}

function wireMetadataDialogListeners() {
    if (document.body.dataset.metadataDialogWired === 'true') return;
    document.body.dataset.metadataDialogWired = 'true';

    if (closeMetadataDialog && closeMetadataDialog.dataset.wired !== 'true') {
        closeMetadataDialog.dataset.wired = 'true';
        closeMetadataDialog.addEventListener('click', (e) => {
            e.preventDefault();
            hideMetadataDialog();
        });
    }

    if (dialogPromptBtn && dialogPromptBtn.dataset.wired !== 'true') {
        dialogPromptBtn.dataset.wired = 'true';
        dialogPromptBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleDialogExpanded('prompt');
        });
    }

    if (dialogUcBtn && dialogUcBtn.dataset.wired !== 'true') {
        dialogUcBtn.dataset.wired = 'true';
        dialogUcBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleDialogExpanded('uc');
        });
    }

    if (document.body.dataset.metadataExpandedCloseWired !== 'true') {
        document.body.dataset.metadataExpandedCloseWired = 'true';
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('close-expanded')) {
                const expandedSection = e.target.closest('.metadata-expanded');
                if (expandedSection) {
                    expandedSection.classList.add('hidden');
                }
            }
        });
    }
}

if (typeof wsClient !== 'undefined' && wsClient) {
    wsClient.registerInitStep(47.6, 'Metadata dialog listeners', async () => {
        wireMetadataDialogListeners();
    });
}
