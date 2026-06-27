/**
 * API key manager modal — full logic (Phase 2 batch 12).
 * Wired via registerInitStep 485.
 */

const apiKeyModalState = {
    services: [],
    originalSelections: {},
    pendingSelections: {},
    dom: new Map(),
    isLoading: false
};

// API KEY MANAGER MODAL
function resetApiKeyModalState() {
    apiKeyModalState.services = [];
    apiKeyModalState.originalSelections = {};
    apiKeyModalState.pendingSelections = {};
    apiKeyModalState.dom = new Map();
}

function openApiKeyModal() {
    const modal = document.getElementById('apiKeyModal');
    if (!modal) return;

    apiKeyModalState.isLoading = true;
    updateApiKeyModalStatus('Loading services...');
    updateApiKeySaveButtonState();
    openModal(modal);
    loadApiKeyModalData(true);
}

async function loadApiKeyModalData(showToastOnError = true) {
    apiKeyModalState.isLoading = true;
    updateApiKeySaveButtonState();

    try {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected. Please reconnect and try again.');
        }

        const data = await window.wsClient.sendMessage('get_api_key_services', {});
        resetApiKeyModalState();
        apiKeyModalState.services = Array.isArray(data?.services) ? data.services : [];

        apiKeyModalState.services.forEach(service => {
            const hasKeys = Array.isArray(service.keys) && service.keys.length > 0;
            const fallbackIndex = hasKeys && Number.isInteger(service.selectedIndex) ? service.selectedIndex : 0;
            if (!hasKeys) {
                service.missingKeys = true;
            }
            apiKeyModalState.originalSelections[service.id] = hasKeys ? fallbackIndex : null;
            apiKeyModalState.pendingSelections[service.id] = hasKeys ? fallbackIndex : null;
        });

        renderApiKeyServices();

        if (apiKeyModalState.services.length === 0) {
            updateApiKeyModalStatus('No Services Available.');
        } else {
            updateApiKeyModalStatus('Service Keys are stored in `secure.config.json`, Select the active key for each service.');
        }
    } catch (error) {
        console.error('Service Key modal load error:', error);
        const message = error.message || 'Failed to load services.';
        updateApiKeyModalStatus(message);
        if (showToastOnError) {
            showGlassToast('error', null, message, false, undefined, '<i class="fas fa-key-skeleton-left-right"></i>');
        }
    } finally {
        apiKeyModalState.isLoading = false;
        updateApiKeySaveButtonState();
    }
}

function renderApiKeyServices() {
    const container = document.getElementById('apiKeyServicesContainer');
    if (!container) return;

    container.innerHTML = '';
    apiKeyModalState.dom = new Map();

    if (!apiKeyModalState.services.length) {
        const empty = document.createElement('p');
        empty.className = 'text-muted';
        empty.textContent = 'No services available.';
        container.appendChild(empty);
        return;
    }

    apiKeyModalState.services.forEach(service => {
        const card = document.createElement('div');
        card.className = 'manual-modal-form-section';

        const title = document.createElement('label');
        const iconClass = escapeHtmlAttribute(service.icon || 'fas fa-key-skeleton-left-right');
        title.innerHTML = `<i class="${iconClass}"></i> ${escapeHtml(service.label || service.id)}`;
        card.appendChild(title);

        if (service.description) {
            const description = document.createElement('p');
            description.className = 'text-muted';
            description.textContent = service.description;
            card.appendChild(description);
        }

        const dropdown = document.createElement('div');
        dropdown.className = 'custom-dropdown dark';

        const dropdownButton = document.createElement('button');
        dropdownButton.type = 'button';
        dropdownButton.className = 'btn-secondary';
        dropdownButton.id = `apiKeyDropdownBtn-${service.id}`;

        const selectedLabel = document.createElement('span');
        selectedLabel.id = `apiKeyDropdownSelected-${service.id}`;
        selectedLabel.textContent = getServiceDisplayName(service);
        dropdownButton.appendChild(selectedLabel);

        const chevron = document.createElement('i');
        chevron.className = 'fas fa-chevron-down';
        dropdownButton.appendChild(chevron);

        const dropdownMenu = document.createElement('div');
        dropdownMenu.id = `apiKeyDropdownMenu-${service.id}`;
        dropdownMenu.className = 'custom-dropdown-menu hidden';

        dropdown.appendChild(dropdownButton);
        dropdown.appendChild(dropdownMenu);
        card.appendChild(dropdown);

        const fingerprint = document.createElement('div');
        fingerprint.className = 'text-muted';
        fingerprint.id = `apiKeyFingerprint-${service.id}`;
        fingerprint.textContent = getServiceFingerprintText(service);
        card.appendChild(fingerprint);

        if (service.requiresRestart) {
            const restartNote = document.createElement('div');
            restartNote.className = 'text-muted';
            restartNote.innerHTML = '<i class="fas fa-arrows-rotate"></i> Service restarts after saving changes.';
            card.appendChild(restartNote);
        }

        if (service.missingKeys) {
            const warning = document.createElement('div');
            warning.className = 'text-muted';
            warning.textContent = 'No Service keys configured for this service.';
            card.appendChild(warning);
            dropdownButton.disabled = true;
        } else {
            setupDropdown(
                dropdown,
                dropdownButton,
                dropdownMenu,
                () => renderApiKeyDropdownOptions(service.id),
                () => apiKeyModalState.pendingSelections[service.id],
                { preventFocusTransfer: true }
            );
        }

        apiKeyModalState.dom.set(service.id, {
            selectedLabel,
            fingerprint,
            dropdownButton,
            dropdownMenu
        });

        container.appendChild(card);
    });
}

function getServiceDisplayName(service) {
    if (service.missingKeys) {
        return 'No Service Keys configured';
    }

    const selection = apiKeyModalState.pendingSelections[service.id];
    if (selection === null || selection === undefined) {
        return 'Select a key';
    }

    const key = service.keys?.find(k => k.index === selection);
    if (key && key.name) {
        return key.name;
    }

    return `Key ${selection + 1}`;
}

function getServiceFingerprintText(service) {
    if (service.missingKeys) {
        return 'Active key: —';
    }

    const selection = apiKeyModalState.pendingSelections[service.id];
    if (selection === null || selection === undefined) {
        return 'Active key: —';
    }

    const key = service.keys?.find(k => k.index === selection);
    if (key && key.fingerprint) {
        return `Active key: ${key.fingerprint}`;
    }

    return 'Active key: —';
}

function renderApiKeyDropdownOptions(serviceId) {
    const service = apiKeyModalState.services.find(s => s.id === serviceId);
    const refs = apiKeyModalState.dom.get(serviceId);
    if (!service || !refs || !refs.dropdownMenu) return;

    const menu = refs.dropdownMenu;
    menu.innerHTML = '';

    if (!Array.isArray(service.keys) || service.keys.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'custom-dropdown-option';
        empty.textContent = 'No keys configured';
        menu.appendChild(empty);

        // Add "Add new Key" option even when no keys exist
        const addOption = document.createElement('div');
        addOption.className = 'custom-dropdown-option';
        addOption.innerHTML = '<i class="fas fa-plus"></i> Add new Key';
        addOption.addEventListener('click', (e) => {
            e.preventDefault();
            closeDropdown(menu, refs.dropdownButton);
            showGlassToast('info', null, 'Add new keys manually in secure.config.json', false, undefined, '<i class="fas fa-key"></i>');
        });
        menu.appendChild(addOption);
        return;
    }

    const current = apiKeyModalState.pendingSelections[serviceId];
    service.keys.forEach(key => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (current === key.index ? ' selected' : '');
        option.dataset.value = key.index;

        const nameLine = document.createElement('div');
        nameLine.textContent = key.name || `Key ${key.index + 1}`;
        option.appendChild(nameLine);

        if (key.fingerprint) {
            const fpLine = document.createElement('div');
            fpLine.className = 'text-muted';
            fpLine.textContent = key.fingerprint;
            option.appendChild(fpLine);
        }

        const handler = (e) => {
            e.preventDefault();
            selectApiKeyOption(serviceId, key.index);
            closeDropdown(menu, refs.dropdownButton);
        };

        option.addEventListener('click', handler);
        option.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                handler(e);
            }
        });

        menu.appendChild(option);
    });

    // Add separator and "Add new Key" option
    const separator = document.createElement('div');
    separator.className = 'custom-dropdown-separator';
    menu.appendChild(separator);

    const addOption = document.createElement('div');
    addOption.className = 'custom-dropdown-option';
    addOption.innerHTML = '<i class="fas fa-plus"></i> Add new Key';
    addOption.addEventListener('click', (e) => {
        e.preventDefault();
        closeDropdown(menu, refs.dropdownButton);
        openAddApiKeyModal(serviceId);
    });
    menu.appendChild(addOption);
}

function selectApiKeyOption(serviceId, index) {
    const service = apiKeyModalState.services.find(s => s.id === serviceId);
    if (!service || service.missingKeys) return;

    const normalizedIndex = Number(index);
    if (!Number.isInteger(normalizedIndex)) return;

    apiKeyModalState.pendingSelections[serviceId] = normalizedIndex;
    service.selectedIndex = normalizedIndex;

    const key = service.keys?.find(k => k.index === normalizedIndex);
    if (key) {
        service.selectedName = key.name;
        service.selectedFingerprint = key.fingerprint;
    }

    const refs = apiKeyModalState.dom.get(serviceId);
    if (refs?.selectedLabel) {
        refs.selectedLabel.textContent = key?.name || `Key ${normalizedIndex + 1}`;
    }
    if (refs?.fingerprint) {
        refs.fingerprint.textContent = key?.fingerprint ? `Active key: ${key.fingerprint}` : 'Active key: —';
    }

    updateApiKeySaveButtonState();
}

function getApiKeyModalChanges() {
    return Object.entries(apiKeyModalState.pendingSelections)
        .filter(([serviceId, index]) => {
            const original = apiKeyModalState.originalSelections[serviceId];
            return index !== null && index !== undefined && original !== index;
        })
        .map(([serviceId, index]) => ({ serviceId, index }));
}

function updateApiKeySaveButtonState() {
    const refreshBtn = document.getElementById('refreshApiKeyModalBtn');
    if (refreshBtn) {
        refreshBtn.disabled = apiKeyModalState.isLoading;
    }
}

function updateApiKeyModalStatus(message) {
    const status = document.getElementById('apiKeyModalStatus');
    if (!status) return;

    if (message) {
        status.textContent = message;
        status.classList.remove('hidden');
    } else {
        status.textContent = '';
        status.classList.add('hidden');
    }
}

async function handleApiKeyModalClose() {
    const changes = getApiKeyModalChanges();
    if (changes.length === 0) {
        const modal = document.getElementById('apiKeyModal');
        if (modal) {
            closeModal(modal);
        }
        return;
    }

    // Build confirmation dialog message
    const changeList = changes.map(change => {
        const service = apiKeyModalState.services.find(s => s.id === change.serviceId);
        const serviceLabel = service?.label || change.serviceId;
        const key = service?.keys?.find(k => k.index === change.index);
        const keyName = key?.name || `Key ${change.index + 1}`;
        const fingerprint = key?.fingerprint || '••••';
        const requiresRestart = service?.requiresRestart === true;

        return {
            serviceLabel,
            keyName,
            fingerprint,
            requiresRestart
        };
    });

    const servicesNeedingRestart = changeList.filter(c => c.requiresRestart);
    const needsRestart = servicesNeedingRestart.length > 0;

    let message = 'Do you want to apply changes to the Keychain:<br><br>';
    changeList.forEach(change => {
        const restartMarker = change.requiresRestart ? ' <span style="color: #ff8c00;">(requires reload)</span>' : '';
        message += `  • ${escapeHtml(change.serviceLabel)} → ${escapeHtml(change.keyName)} (${escapeHtml(change.fingerprint)})${restartMarker}<br>`;
    });

    if (needsRestart) {
        const serviceNames = servicesNeedingRestart.map(c => escapeHtml(c.serviceLabel)).join(', ');
        message += `<br><br><span style="color: #ff8c00;">* ${serviceNames} will reload its client and any active tasks will be halted!</span>`;
    }

    // Show confirmation dialog
    const result = await showConfirmationDialog(message, [
        {
            text: needsRestart ? 'Apply & Reload' : 'Apply',
            value: 'apply',
            className: 'btn-primary',
            icon: needsRestart ? 'fas fa-arrows-rotate' : 'fas fa-save'
        },
        {
            text: 'Revert',
            value: 'revert',
            className: 'btn-secondary',
            icon: 'fas fa-undo'
        }
    ]);

    if (result === 'apply') {
        await saveApiKeySelections();
        const modal = document.getElementById('apiKeyModal');
        if (modal) {
            closeModal(modal);
        }
    } else if (result === 'revert') {
        // Revert pending selections to original
        Object.keys(apiKeyModalState.originalSelections).forEach(serviceId => {
            apiKeyModalState.pendingSelections[serviceId] = apiKeyModalState.originalSelections[serviceId];
        });
        renderApiKeyServices();
        updateApiKeySaveButtonState();
    }
    // If result is null (cancelled), do nothing
}

async function saveApiKeySelections() {
    const changes = getApiKeyModalChanges();
    if (changes.length === 0) {
        showGlassToast('info', null, 'No Keychain changes to save.', false, undefined, '<i class="fas fa-key-skeleton-left-right"></i>');
        return;
    }

    apiKeyModalState.isLoading = true;
    updateApiKeyModalStatus('Saving Keychain...');
    updateApiKeySaveButtonState();

    try {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected. Please reconnect and try again.');
        }

        const updatesPayload = changes.map(change => ({
            service: change.serviceId,
            index: change.index
        }));

        const data = await window.wsClient.sendMessage('update_api_key_selections', {
            updates: updatesPayload
        });

        if (Array.isArray(data?.restartedServices)) {
            data.restartedServices.forEach(serviceId => {
                const service = apiKeyModalState.services.find(s => s.id === serviceId);
                const label = service?.label || serviceId;
                showGlassToast('success', null, `${label} Service was restarted (Updated Keychain)`, false, undefined, '<i class="fas fa-arrows-rotate"></i>');
            });
        }

        showGlassToast('success', null, 'keychain was updated.', false, undefined, '<i class="fas fa-key-skeleton-left-right"></i>');
        await loadApiKeyModalData(false);
        updateApiKeyModalStatus('Keychain was saved.');
    } catch (error) {
        console.error('Keychain save error:', error);
        const message = error.message || 'Failed to save service keychain.';
        updateApiKeyModalStatus(message);
        showGlassToast('error', null, message, false, undefined, '<i class="fas fa-key-skeleton-left-right"></i>');
    } finally {
        apiKeyModalState.isLoading = false;
        updateApiKeySaveButtonState();
    }
}

// ADD NEW API KEY MODAL FUNCTIONS
let addApiKeyModalState = {
    serviceId: null,
    isLoading: false
};

function openAddApiKeyModal(serviceId) {
    const modal = document.getElementById('addApiKeyModal');
    if (!modal) return;

    addApiKeyModalState.serviceId = serviceId;
    addApiKeyModalState.isLoading = false;

    const nameInput = document.getElementById('addApiKeyNameInput');
    const valueInput = document.getElementById('addApiKeyValueInput');
    const statusEl = document.getElementById('addApiKeyModalStatus');

    if (nameInput) nameInput.value = '';
    if (valueInput) valueInput.value = '';
    if (statusEl) {
        statusEl.textContent = '';
        statusEl.classList.add('hidden');
    }

    const service = apiKeyModalState.services.find(s => s.id === serviceId);
    if (service) {
        const modalTitle = modal.querySelector('.modal-window-title-main span');
        if (modalTitle) {
            modalTitle.textContent = `Add New Key - ${service.label}`;
        }
    }

    updateAddApiKeyButtonState();
    openModal(modal);

    // Focus on name input
    if (nameInput) {
        setTimeout(() => nameInput.focus(), 100);
    }
}

function closeAddApiKeyModal() {
    const modal = document.getElementById('addApiKeyModal');
    if (modal) {
        closeModal(modal);
    }
    addApiKeyModalState.serviceId = null;
    addApiKeyModalState.isLoading = false;
}

function updateAddApiKeyModalStatus(message, isError = false) {
    const status = document.getElementById('addApiKeyModalStatus');
    if (!status) return;

    if (message) {
        status.textContent = message;
        status.className = isError ? 'text-danger' : 'text-muted';
        status.classList.remove('hidden');
    } else {
        status.textContent = '';
        status.classList.add('hidden');
    }
}

function updateAddApiKeyButtonState() {
    const saveBtn = document.getElementById('saveNewApiKeyBtn');
    if (saveBtn) {
        const nameInput = document.getElementById('addApiKeyNameInput');
        const valueInput = document.getElementById('addApiKeyValueInput');
        const hasName = nameInput && nameInput.value.trim().length > 0;
        const hasValue = valueInput && valueInput.value.trim().length > 0;
        saveBtn.disabled = addApiKeyModalState.isLoading || !hasName || !hasValue;
    }
}

async function saveNewApiKey() {
    const nameInput = document.getElementById('addApiKeyNameInput');
    const valueInput = document.getElementById('addApiKeyValueInput');

    if (!nameInput || !valueInput) return;

    const name = nameInput.value.trim();
    const apiKey = valueInput.value.trim();

    if (!name) {
        updateAddApiKeyModalStatus('Service Key Name is required.', true);
        nameInput.focus();
        return;
    }

    if (!apiKey) {
        updateAddApiKeyModalStatus('Service Key is required.', true);
        valueInput.focus();
        return;
    }

    if (!addApiKeyModalState.serviceId) {
        updateAddApiKeyModalStatus('Service ID is missing.', true);
        return;
    }

    addApiKeyModalState.isLoading = true;
    updateAddApiKeyModalStatus('Adding new Key to keychain...');
    updateAddApiKeyButtonState();

    try {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected. Please reconnect and try again.');
        }

        const data = await window.wsClient.sendMessage('add_api_key', {
            service: addApiKeyModalState.serviceId,
            name: name,
            apiKey: apiKey
        });

        if (data?.success) {
            showGlassToast('success', null, 'New Service Key added successfully', false, undefined, '<i class="fas fa-key-skeleton-left-right"></i>');
            closeAddApiKeyModal();
            // Reload the API key modal data to show the new key
            await loadApiKeyModalData(false);
        } else {
            throw new Error(data?.error || 'Failed to add new key');
        }
    } catch (error) {
        console.error('Add API key error:', error);
        const message = error.message || 'Failed to add new key.';
        updateAddApiKeyModalStatus(message, true);
        showGlassToast('error', null, message, false, undefined, '<i class="fas fa-key-skeleton-left-right"></i>');
    } finally {
        addApiKeyModalState.isLoading = false;
        updateAddApiKeyButtonState();
    }
}

function wireApiKeyModalListenerScope() {
    const apiKeyModal = document.getElementById('apiKeyModal');
    if (apiKeyModal && apiKeyModal.dataset.listenerScopeWired !== 'true') {
        apiKeyModal.dataset.listenerScopeWired = 'true';
        // attachModalListeners — modalListenerScope.js; closeAllDropdownsInRoot — dropdown.js
        attachModalListeners(apiKeyModal, (signal) => {
            signal.addEventListener('abort', () => {
                closeAllDropdownsInRoot(apiKeyModal);
            }, { once: true });
        });
    }

    const addApiKeyModal = document.getElementById('addApiKeyModal');
    if (addApiKeyModal && addApiKeyModal.dataset.listenerScopeWired !== 'true') {
        addApiKeyModal.dataset.listenerScopeWired = 'true';
        attachModalListeners(addApiKeyModal, (signal) => {
            signal.addEventListener('abort', () => {
                closeAllDropdownsInRoot(addApiKeyModal);
            }, { once: true });
        });
    }
}

function wireApiKeyModalKeyboard() {
    if (document.body.dataset.apiKeyModalKeyboardWired === 'true') return;
    document.body.dataset.apiKeyModalKeyboardWired = 'true';

    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'apiKeyModal.keydown',
        handler: (e) => {
            const modal = document.getElementById('apiKeyModal');
            if (!modal || modal.classList.contains('hidden')) return;

            if (e.key === 'F5') {
                e.preventDefault();
                e.stopPropagation();
                loadApiKeyModalData(true);
                return true;
            }
        },
        type: 'whenFocused',
        modalId: 'apiKeyModal',
        priority: 78,
        critical: true,
        showInOverlay: false
    });
    registerKeyboardListener({
        id: 'addApiKeyModal.keydown',
        handler: (e) => {
            const modal = document.getElementById('addApiKeyModal');
            if (!modal || modal.classList.contains('hidden')) return;

            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeAddApiKeyModal();
                return true;
            }

            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                e.stopPropagation();
                saveNewApiKey();
                return true;
            }
        },
        type: 'whenFocused',
        modalId: 'addApiKeyModal',
        priority: 85,
        critical: true,
        showInOverlay: false
    });
    registerModalOverlayEntries('apiKeyModal', 'API Keys', [
        { id: 'overlay.apiKeyModal.refresh', label: 'Refresh', keys: 'F5', icon: 'fas fa-rotate' },
        { id: 'overlay.apiKeyModal.close', label: 'Close', keys: 'Alt+Q', icon: 'fas fa-times' }
    ]);
    registerModalOverlayEntries('addApiKeyModal', 'API Keys', [
        { id: 'overlay.addApiKey.save', label: 'Save', keys: 'Ctrl+S', icon: 'fas fa-save' },
        { id: 'overlay.addApiKey.close', label: 'Close', keys: 'Esc', icon: 'fas fa-times' }
    ]);
}

function wireApiKeyModalListeners() {
    if (document.body.dataset.apiKeyModalWired === 'true') return;
    document.body.dataset.apiKeyModalWired = 'true';

    wireApiKeyModalListenerScope();
    wireApiKeyModalKeyboard();

    const apiKeyModal = document.getElementById('apiKeyModal');
    const closeApiKeyModalBtn = document.getElementById('closeApiKeyModalBtn');
    const refreshApiKeyModalBtn = document.getElementById('refreshApiKeyModalBtn');

    if (closeApiKeyModalBtn && closeApiKeyModalBtn.dataset.wired !== 'true') {
        closeApiKeyModalBtn.dataset.wired = 'true';
        closeApiKeyModalBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (apiKeyModal) {
                await handleApiKeyModalClose();
            }
        });
    }

    if (refreshApiKeyModalBtn && refreshApiKeyModalBtn.dataset.wired !== 'true') {
        refreshApiKeyModalBtn.dataset.wired = 'true';
        refreshApiKeyModalBtn.addEventListener('click', (e) => {
            e.preventDefault();
            loadApiKeyModalData(true);
        });
    }

    const closeAddApiKeyModalBtn = document.getElementById('closeAddApiKeyModalBtn');
    if (closeAddApiKeyModalBtn && closeAddApiKeyModalBtn.dataset.wired !== 'true') {
        closeAddApiKeyModalBtn.dataset.wired = 'true';
        closeAddApiKeyModalBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeAddApiKeyModal();
        });
    }

    const saveNewApiKeyBtn = document.getElementById('saveNewApiKeyBtn');
    if (saveNewApiKeyBtn && saveNewApiKeyBtn.dataset.wired !== 'true') {
        saveNewApiKeyBtn.dataset.wired = 'true';
        saveNewApiKeyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            saveNewApiKey();
        });
    }

    const addApiKeyNameInput = document.getElementById('addApiKeyNameInput');
    const addApiKeyValueInput = document.getElementById('addApiKeyValueInput');
    if (addApiKeyNameInput && addApiKeyNameInput.dataset.wired !== 'true') {
        addApiKeyNameInput.dataset.wired = 'true';
        addApiKeyNameInput.addEventListener('input', updateAddApiKeyButtonState);
    }
    if (addApiKeyValueInput && addApiKeyValueInput.dataset.wired !== 'true') {
        addApiKeyValueInput.dataset.wired = 'true';
        addApiKeyValueInput.addEventListener('input', updateAddApiKeyButtonState);
    }
}

if (typeof wsClient !== 'undefined' && wsClient) {
    wsClient.registerInitStep(485, 'API key modal listeners', async () => {
        wireApiKeyModalListeners();
    });
}
