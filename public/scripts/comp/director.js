// Global dryrun variable - set to true in console to enable dryrun mode
// Usage: window.directorDryrun = true;
// This will make all director requests use dryrun mode, saving request data to dryrun_output.json
// and returning mock responses without making actual API calls
window.directorDryrun = false;

const DIRECTOR_MAX_SESSION_MESSAGES = 200;

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
        this.currentView = 'newSession';
        this.autoGenerateEnabled = false;
        this.messageFilter = 'all'; // 'all', 'messages', 'quotes'

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

        // Director actions
        this.directorActions = [
            { value: 'change', name: 'Edit', icon: 'fas fa-edit', placeholder: 'Modify aspects of the prompt' },
            { value: 'efficiency', name: 'Analyse', icon: 'fas fa-chart-line', placeholder: 'Analyse the prompt for effectiveness' },
            { value: 'dialog', name: 'Dialog', icon: 'fas fa-comments', placeholder: 'Listen in to the image (enter desires)' },
           /*  { value: 'conversation', name: 'Conversation', icon: 'fas fa-comment-dots', placeholder: 'Start a conversation with the character' }, */
        ];
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
            directorCloseOverlayBtn: 'directorCloseOverlayBtn',
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
            directorMessageFilterGroup: 'directorMessageFilterGroup',
            directorAutoGenerateBtn: 'directorAutoGenerateBtn',
            directorChatMessages: 'directorChatMessages',
            directorActionsDropdown: 'directorActionsDropdown',
            directorActionsDropdownBtn: 'directorActionsDropdownBtn',
            directorActionsDropdownMenu: 'directorActionsDropdownMenu',
            directorActionsSelected: 'directorActionsSelected',
            directorAddBaseImageToggleBtn: 'directorAddBaseImageToggleBtn',
            directorHighThinkingToggleBtn: 'directorHighThinkingToggleBtn',
            directorChatInput: 'directorChatInput',
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

        // Set initial action state
        this.selectDirectorAction('change');
        this.setupMeasurementsModal();
        this.setupDirectorWebSocketHandlers();
    }

    // Setup dropdowns
    setupDirectorDropdowns() {
        // Actions dropdown
        setupDropdown(
            this.directorActionsDropdown,
            this.directorActionsDropdownBtn,
            this.directorActionsDropdownMenu,
            (selectedValue) => this.renderDirectorActionsDropdown(selectedValue),
            () => this.getSelectedDirectorAction(),
            { preventFocusTransfer: true }
        );
    }
    
    // Render functions

    renderDirectorActionsDropdown(selectedValue) {
        this.directorActionsDropdownMenu.innerHTML = '';
        this.directorActions.forEach(action => {
            const optionElement = document.createElement('div');
            optionElement.className = 'custom-dropdown-option' +
                (selectedValue === action.value ? ' selected' : '');
            optionElement.dataset.value = action.value;
            optionElement.innerHTML = `<i class="${action.icon}"></i> ${action.name}`;

            optionElement.addEventListener('click', () => {
                this.selectDirectorAction(action.value);
                this.closeDirectorActionsDropdown();
            });

            this.directorActionsDropdownMenu.appendChild(optionElement);
        });
    }
    
    // Selection handlers

    selectDirectorAction(value) {
        const action = this.directorActions.find(a => a.value === value);
        if (action) {
            if (this.directorActionsSelected) {
            this.directorActionsSelected.innerHTML = `<i class="${action.icon}"></i> ${action.name}`;
            }
            if (this.directorChatInput) {
            this.directorChatInput.placeholder = action.placeholder;
            }

            // Auto-enable base image for efficiency if last response was stale
            if (value === 'efficiency' && this.currentSession && this.currentSession.messages) {
                const lastAssistantMessage = this.currentSession.messages
                    .filter(msg => msg.role === 'assistant')
                    .pop();

                if (lastAssistantMessage && lastAssistantMessage.data && lastAssistantMessage.data.isStale) {
                    const isCurrentlyOn = this.directorAddBaseImageToggleBtn.getAttribute('data-state') === 'on';
                    if (!isCurrentlyOn) {
                        this.updateIndicator(this.directorAddBaseImageToggleBtn, true);
                        showGlassToast('info', null, 'Switching to efficiency mode. Base image enabled due to stale data.');
                    }
                }
            }
        } else {
            this.directorActionsSelected.innerHTML = '<i class="fas fa-edit"></i> Change';
            this.directorChatInput.placeholder = 'What changes do you want to make to the prompt?';
        }
    }

    // Close handlers

    closeDirectorActionsDropdown() {
        closeDropdown(this.directorActionsDropdownMenu, this.directorActionsDropdownBtn);
    }

    // Get selected values

    getSelectedDirectorAction() {
        if (!this.directorActionsSelected) return 'change';
        const selectedText = this.directorActionsSelected.textContent.trim();
        return this.directorActions.find(a => a.name === selectedText)?.value || 'change';
    }
    
    // Setup context menus
    setupDirectorContextMenus() {
        // Create context menu configuration for director sessions
        const directorSessionContextConfig = {
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            text: 'Delete Session',
                            icon: 'fas fa-trash-alt',
                            action: 'director-delete-session',
                            className: 'danger'
                        }
                    ]
                }
            ]
        };

        // Store context menu configuration for later use
        this.directorSessionContextConfig = directorSessionContextConfig;

        // Set up action handlers
        this.setupDirectorContextMenuHandlers();
    }

    // Setup context menu action handlers
    setupDirectorContextMenuHandlers() {
        if (this._directorContextMenuWired) {
            return;
        }
        this._directorContextMenuWired = true;

        this._directorContextMenuHandler = (event) => {
            const { action, target } = event.detail;
            
            // Find the session item that was right-clicked
            const sessionItem = target.closest('.director-session-item');
            if (!sessionItem) {
                return;
            }

            const sessionId = sessionItem.dataset.sessionId;
            let session = this.directorSessions.find(s => s.id === sessionId);
            if (!session) {
                // Try converting sessionId to number
                const numericSessionId = parseInt(sessionId);
                session = this.directorSessions.find(s => s.id === numericSessionId);
            }
            
            if (!session) {
                return;
            }

            switch (action) {
                case 'director-delete-session':
                    this.deleteSessionFromContextMenu(session);
                    break;
            }
        };

        const manualModal = document.getElementById('manualModal');
        if (manualModal) {
            // attachModalListeners: public/scripts/comp/modalListenerScope.js
            attachModalListeners(manualModal, (signal) => {
                document.addEventListener('contextMenuAction', this._directorContextMenuHandler, { signal });
            });
        }
    }

    // Delete session (context menu version)
    async deleteSessionFromContextMenu(session) {
        if (typeof showConfirmationDialog !== 'function') {
            return;
        }

        try {
            const result = await showConfirmationDialog(
                `Are you sure you want to delete the session "${session.name}"?`,
                [
                    { text: 'Delete', value: true, className: 'btn-danger', icon: 'fas fa-trash' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ]
            );
            const isCurrentSession = this.currentSession && this.currentSession.id === session.id;

            if (result) {
                if (isCurrentSession) {
                    this.showNewSession();
                }

                // Send WebSocket request to delete session
                if (window.wsClient && window.wsClient.isConnected()) {
                    window.wsClient.send({
                        type: 'director_delete_session',
                        requestId: Date.now().toString(),
                        sessionId: session.id
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
        
        // Update the filter group data attribute
        if (this.directorMessageFilterGroup) {
            this.directorMessageFilterGroup.dataset.filter = filter;
        }
        
        // Update active button
        const buttons = this.directorMessageFilterGroup?.querySelectorAll('.gallery-toggle-btn');
        if (buttons) {
            buttons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.filter === filter);
            });
        }
        
        // Apply filter to current messages
        this.applyMessageFilter();
    }

    // Apply message filter to current messages
    applyMessageFilter() {
        if (!this.directorChatMessages) return;
        const messages = this.directorChatMessages.querySelectorAll('.director-message, .director-message-captions');
        
        messages.forEach(message => {
            let shouldShow = true;
            
            switch (this.messageFilter) {
                case 'messages':
                    shouldShow = message.classList.contains('director-message');
                    break;
                case 'quotes':
                    shouldShow = message.classList.contains('director-message-captions') || message.classList.contains('user');
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

        // Close overlay button
        if (this.directorCloseOverlayBtn) {
            this.directorCloseOverlayBtn.addEventListener('click', () => this.closeSessionOverlay());
        }

        // New session button in overlay
        if (this.directorNewSessionBtn) {
            this.directorNewSessionBtn.addEventListener('click', () => {
                this.closeSessionOverlay();
                this.showNewSession();
            });
        }

        // New session buttons
        if (this.directorCreateSessionBtn) {
            this.directorCreateSessionBtn.addEventListener('click', () => this.createSession());
        }


        // Chat buttons
        if (this.directorSendBtn) {
            this.directorSendBtn.addEventListener('click', () => this.sendMessage());
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
        }

        // Auto-expand textarea
        if (this.directorChatInput) {
        this.directorChatInput.addEventListener('input', (e) => this.autoExpandTextarea(e.target));
        this.directorChatInput.addEventListener('focus', (e) => this.autoExpandTextarea(e.target));
        }
        if (this.directorUserIntent) {
            this.directorUserIntent.addEventListener('input', (e) => this.autoExpandTextarea(e.target));
            this.directorUserIntent.addEventListener('focus', (e) => this.autoExpandTextarea(e.target));
        }

        // Image selection functionality
        if (this.directorImageSelectBtn) {
            this.directorImageSelectBtn.addEventListener('click', () => {
                this.directorImageFileInput.click();
            });
        }

        if (this.directorImageRemoveBtn) {
            this.directorImageRemoveBtn.addEventListener('click', () => {
                this.removeSelectedImage();
            });
        }

        if (this.directorImageFileInput) {
            this.directorImageFileInput.addEventListener('change', (e) => {
                this.handleImageSelection(e);
            });
        }

        // Attach mode selection event listeners
        this.attachModeSelectionListeners();
    }

    // Set active mode for the slider
    setActiveMode(mode) {
        // Find the mode slider container (it might be newly created in welcome message)
        const modeSliderContainer = this.directorModeSliderContainer ||
                                   document.getElementById('directorModeSliderContainer');

        if (!modeSliderContainer) return;

        // Update button disabled states based on image selection
        this.updateModeButtonStates();

        // Update data attribute
        modeSliderContainer.setAttribute('data-active', mode);

        // Update button active states
        const buttons = modeSliderContainer.querySelectorAll('.mode-slider-btn');
        buttons.forEach(button => {
            if (button.getAttribute('data-mode') === mode) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });

        // Show/hide image selection button based on mode
        this.updateImageSelectionVisibility(mode);

        // Re-render welcome message with updated mode content
        this.renderWelcomeMessage();
    }

    // Auto-expand textarea as content grows
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

            // Reset height to auto to get the correct scrollHeight
            textarea.style.height = 'auto';

            // Set height to scrollHeight to fit all content
            const scrollHeight = textarea.scrollHeight;
            const minHeight = 32; // Minimum height in pixels (matches min-height from HTML)
            const maxHeight = 320; // Maximum height to prevent excessive growth

            let calculatedHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
            // Round up to even number
            const newHeight = Math.ceil(calculatedHeight / 2) * 2;
            textarea.style.height = newHeight + 'px';
        });
    }

    // Update image selection button visibility based on mode
    updateImageSelectionVisibility(mode) {
        if (this.directorImageSelectBtn) {
            if (mode === 'analyse') {
                this.directorImageSelectBtn.classList.remove('hidden');
            } else {
                this.directorImageSelectBtn.classList.add('hidden');
            }
        }
        
        // Only hide remove button if no image is selected
        if (this.directorImageRemoveBtn && !this.selectedImageData) {
            this.directorImageRemoveBtn.classList.add('hidden');
        }
    }

    // Update mode button disabled states based on image selection
    updateModeButtonStates() {
        const modeSliderContainer = this.directorModeSliderContainer ||
                                   document.getElementById('directorModeSliderContainer');
        
        if (!modeSliderContainer) return;

        const buttons = modeSliderContainer.querySelectorAll('.mode-slider-btn');
        buttons.forEach(button => {
            const mode = button.getAttribute('data-mode');
            
            if (this.selectedImageData) {
                // When image is selected, disable all buttons except Analyse
                if (mode === 'analyse') {
                    button.disabled = false;
                } else {
                    button.disabled = true;
                }
            } else {
                // When no image is selected, enable all buttons
                button.disabled = false;
            }
        });
    }

    // Handle image selection for Create mode
    async handleImageSelection(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            showGlassToast('error', null, 'Please select a valid image file.');
            return;
        }

        // Validate file size (max 10MB)
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
            showGlassToast('error', null, 'Image file is too large. Maximum size is 10MB.');
            return;
        }

        try {
            // Show loading state
            showGlassToast('info', null, 'Processing image...');

            // Convert to base64
            const base64 = await this.fileToBase64(file);
            
            // Store the selected image data
            this.selectedImageData = {
                file: file,
                base64: base64,
                filename: file.name,
                mimeType: file.type
            };

            // Update button to show image is selected using indicator system
            if (this.directorImageSelectBtn) {
                this.updateIndicator(this.directorImageSelectBtn, true);
                this.directorImageSelectBtn.title = `Selected: ${file.name}`;
            }

            // Show remove button
            if (this.directorImageRemoveBtn) {
                this.directorImageRemoveBtn.classList.remove('hidden');
                this.directorImageRemoveBtn.title = `Remove: ${file.name}`;
            }

            // Automatically switch to Analyse mode when image is selected
            this.setActiveMode('analyse');

            showGlassToast('success', null, `Image "${file.name}" selected. Switched to Analyse mode.`);

        } catch (error) {
            console.error('Error processing image:', error);
            showGlassToast('error', null, 'Failed to process image. Please try again.');
        }
    }

    // Convert file to base64
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                // Remove the data URL prefix to get just the base64 data
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = error => reject(error);
        });
    }

    // Remove selected image
    removeSelectedImage() {
        // Clear selected image data
        this.selectedImageData = null;

        // Reset image selection button indicator
        if (this.directorImageSelectBtn) {
            this.updateIndicator(this.directorImageSelectBtn, false);
            this.directorImageSelectBtn.title = '';
        }

        // Hide remove button
        if (this.directorImageRemoveBtn) {
            this.directorImageRemoveBtn.classList.add('hidden');
            this.directorImageRemoveBtn.title = '';
        }

        // Clear file input
        if (this.directorImageFileInput) {
            this.directorImageFileInput.value = '';
        }

        // Update mode button states to re-enable all buttons
        this.updateModeButtonStates();

        showGlassToast('info', null, 'Image removed. You can now switch to other modes.');
    }

    // View management
    toggleDirector() {
        const isVisible = !this.directorContainer.classList.contains('hidden');
        if (isVisible) {
            this.hideDirector();
        } else {
            this.showDirector();
        }
    }

    async showDirector() {
        if (this.directorContainer) {
            // First remove hidden class to make element visible
            this.directorContainer.classList.remove('hidden');
            this.directorContainer.classList.remove('director-closed');

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
        this.updateIndicator(this.directorBtn, true);

        // Check for director session ID in button dataset first
        const directorBtn = document.getElementById('directorBtn');
        if (directorBtn && directorBtn.dataset.directorSessionId) {
            const directorSessionId = directorBtn.dataset.directorSessionId;
            
            // Try to find the session in current sessions list first
            let targetSession = this.directorSessions.find(session => session.id === directorSessionId);
            
            if (targetSession) {
                await this.showSessionChat(targetSession);
                return;
            } else {
                // Session not in current list, try to load it from server
                try {
                    // Send WebSocket request to get the director session
                    if (window.wsClient && window.wsClient.isConnected()) {
                        const requestId = Date.now().toString();
                        window.wsClient.send({
                            type: 'director_get_session',
                            requestId: requestId,
                            sessionId: directorSessionId
                        });

                        // Set up a one-time listener for the response
                        const handleResponse = (responseData) => {
                            if (responseData.data && responseData.data.success) {
                                const session = responseData.data.session;
                                // Show the director interface with the session
                                this.showSessionChat(session);
                            } else {
                                // Fallback to new session
                                this.showNewSession();
                            }
                            // Remove the listener after handling the response
                            window.wsClient.off('director_get_session_response', handleResponse);
                        };

                        // Listen for the response
                        window.wsClient.on('director_get_session_response', handleResponse);
                        return;
                    }
                } catch (error) {
                    console.error('❌ Error loading director session from server:', error);
                }
            }
        }

        // Try to load the last opened session, fallback to new session
        const lastSessionId = localStorage.getItem(this.LAST_SESSION_KEY);
        if (lastSessionId) {
            const lastSession = this.directorSessions.find(session => session.id === lastSessionId);
            if (lastSession) {
                await this.showSessionChat(lastSession);
                return;
            }
        }

        // Fallback to new session if no valid last session found
        await this.showNewSession();
    }

    hideDirector() {
        if (this.directorContainer) {
            // Start the closing animation
            this.directorContainer.classList.remove('director-open');
            this.directorContainer.classList.add('director-closed');

            // Add hidden class after animation completes
            setTimeout(() => {
                this.directorContainer.classList.add('hidden');
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
        this.currentView = 'sessionList';
        // Show overlay instead of switching views
        if (this.directorSessionList) {
            this.directorSessionList.classList.remove('hidden');
        }
        await this.loadDirectorSessions();
        this.initializeScrollbars();
    }
    
    showNewSession() {
        this.currentView = 'newSession';
        this.hideAllViews();
        this.closeSessionOverlay(); // Close overlay when switching views
        if (this.directorNewSession) {
            this.directorNewSession.classList.remove('hidden');
        }
        this.updateHeaderForView('newSession');
        this.updateIndicator(this.directorMaxResolutionBtn, false);
        this.updateIndicator(this.directorAddBaseImageToggleBtn, true);
        this.updateIndicator(this.directorHighThinkingToggleBtn, true);
        this.renderWelcomeMessage();
        this.initializeScrollbars();
    }
    
    async showSessionChat(session) {
        if (this.currentSession && this.currentSession !== session && Array.isArray(this.currentSession.messages)) {
            assignTrimmedDirectorSessionMessages(this.currentSession, this.currentSession.messages);
            const prevIdx = this.directorSessions.findIndex(s => s.id === this.currentSession.id);
            if (prevIdx !== -1) {
                this.directorSessions[prevIdx].messages = this.currentSession.messages;
            }
        }

        this.currentView = 'sessionChat';
        this.currentSession = session;
        window.currentSession = session; // Keep global reference for compatibility

        // Store the last opened session in localStorage
        if (session && session.id) {
            localStorage.setItem(this.LAST_SESSION_KEY, session.id);
        }

        this.hideAllViews();
        this.closeSessionOverlay(); // Close overlay when switching views
        if (this.directorSessionChat) {
            this.directorSessionChat.classList.remove('hidden');
        }
        this.updateHeaderForView('sessionChat');
        if (this.directorSessionTitle) {
            const titleText = this.directorSessionTitle.querySelector('.director-title-text');
            if (titleText) {
                titleText.textContent = session.name;
            } else {
                this.directorSessionTitle.textContent = session.name;
            }
        }

        // Set the preview images
        if (this.directorSessionPreview && this.directorSessionPreviewLarge) {
            const previewImageSrc = this.getSessionPreviewImage(session);
            this.directorSessionPreview.src = previewImageSrc;
            this.directorSessionPreviewLarge.src = previewImageSrc;
        }

        await this.loadSessionMessages(session.id);
        this.initializeScrollbars();

        // Ensure scroll to bottom after loading messages
        this.scrollToBottom();
    }


    toggleSessionOverlay() {
        if (!this.directorSessionList) return;

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
    }

    renderWelcomeMessage() {
        if (!this.directorNewSessionMessages) return;

        // Get current mode for dynamic content (find container dynamically if cached one doesn't exist)
        const modeSliderContainer = this.directorModeSliderContainer ||
                                   document.getElementById('directorModeSliderContainer');
        const currentMode = modeSliderContainer?.getAttribute('data-active') || 'analyse';

        // Define mode-specific content
        const modeContent = {
            analyse: {
                title: 'Welcome to Enshutsuka!',
                description: 'I\'ll analyze this image to craft the perfect prompt.',
                tips: [
                    'Be specific about the subject, style, and mood you want',
                    'Mention any important details like lighting, composition, or colors',
                    'Describe the overall atmosphere or feeling you want to achieve',
                    'I\'ll extract comprehensive visual details to create an effective prompt'
                ]
            },
            efficiency: {
                title: 'Welcome to Enshutsuka!',
                description: 'I\'ll analyze this image and your existing prompt to optimize accuracy.',
                tips: [
                    'Describe what aspects of the current result you want improved',
                    'Mention any specific elements that aren\'t working as expected',
                    'Specify the mood or style changes you want to achieve',
                    'I\'ll identify gaps, optimize weights, and enhance prompt effectiveness'
                ]
            },
            create: {
                title: 'Welcome to Enshutsuka!',
                description: 'I\'ll help you create a creative prompt from your text input.',
                tips: [
                    'Just enter your ideas or concepts in text form',
                    'I\'ll expand and enhance your input with creative details',
                    'I\'ll fill in missing information to create a complete prompt',
                    'I\'ll generate an optimized prompt ready for image generation'
                ]
            }
        };

        const content = modeContent[currentMode] || modeContent.analyse;

        // Check if welcome message already exists
        let welcomeMessage = this.directorNewSessionMessages.querySelector('.director-message.assistant.welcome');

        if (!welcomeMessage) {
            // Create new message if it doesn't exist
            welcomeMessage = document.createElement('div');
            welcomeMessage.className = 'director-message assistant welcome';
        welcomeMessage.innerHTML = `
                <div class="director-message-content">
                    <div class="director-welcome-message">
                        <h3></h3>
                        <p></p>

                        <!-- Mode Selection inside welcome message -->
                        <div class="director-welcome-mode-selection">
                            <div class="mode-slider-container" id="directorModeSliderContainer" data-active="${currentMode}">
                                <button type="button" class="mode-slider-btn ${currentMode === 'create' ? 'active' : ''}" data-mode="create">
                                    <i class="fas fa-pen-alt"></i> Create
                                </button>
                                <button type="button" class="mode-slider-btn ${currentMode === 'analyse' ? 'active' : ''}" data-mode="analyse">
                                    <i class="fas fa-search"></i> Analyse
                                </button>
                                <button type="button" class="mode-slider-btn ${currentMode === 'efficiency' ? 'active' : ''}" data-mode="efficiency">
                                    <i class="fas fa-bolt"></i> Efficiency
                                </button>
                                <div class="mode-slider-track"></div>
                            </div>
                        </div>

                        <div class="director-welcome-tips">
                            <p><strong>Tips:</strong></p>
                            <ul></ul>
                        </div>
                    </div>
            </div>
        `;

            this.directorNewSessionMessages.appendChild(welcomeMessage);
        }

        // Update content dynamically (preserves animations)
        const titleElement = welcomeMessage.querySelector('h3');
        const descriptionElement = welcomeMessage.querySelector('p');
        const tipsList = welcomeMessage.querySelector('ul');

        if (titleElement) titleElement.textContent = content.title;
        if (descriptionElement) descriptionElement.textContent = content.description;

        if (tipsList) {
            tipsList.innerHTML = content.tips.map(tip => `<li>${tip}</li>`).join('');
        }

        // Update mode selection state
        if (modeSliderContainer) {
            modeSliderContainer.setAttribute('data-active', currentMode);

            const modeButtons = modeSliderContainer.querySelectorAll('.mode-slider-btn');
            modeButtons.forEach(button => {
                const buttonMode = button.getAttribute('data-mode');
                if (buttonMode === currentMode) {
                    button.classList.add('active');
        } else {
                    button.classList.remove('active');
                }
            });
        }

        // Update image selection visibility and button states based on current mode
        this.updateImageSelectionVisibility(currentMode);
        this.updateModeButtonStates();

        // Re-attach mode selection event listeners after rendering
        this.attachModeSelectionListeners();
    }

    // Attach mode selection event listeners
    attachModeSelectionListeners() {
        // Find the mode slider container (it might be newly created in welcome message)
        const modeSliderContainer = this.directorModeSliderContainer ||
                                   document.getElementById('directorModeSliderContainer');

        if (!modeSliderContainer) return;

        const modeButtons = modeSliderContainer.querySelectorAll('.mode-slider-btn');
        modeButtons.forEach(button => {
            // Remove existing listeners to avoid duplicates
            button.removeEventListener('click', this._modeClickHandler);
        });

        // Create the click handler
        this._modeClickHandler = (e) => {
            const mode = e.target.closest('.mode-slider-btn').getAttribute('data-mode');
            this.setActiveMode(mode);
        };

        // Add new listeners
        modeButtons.forEach(button => {
            button.addEventListener('click', this._modeClickHandler);
        });
    }
    
    // Session management
    async loadDirectorSessions() {
        return new Promise((resolve, reject) => {
            // Send WebSocket request to load sessions
            if (window.wsClient && window.wsClient.isConnected()) {
                window.wsClient.send({
                    type: 'director_get_sessions',
                    requestId: Date.now().toString()
                });

                // Set up a one-time listener for the response
                const handleResponse = (data) => {
                    if (data.data && data.data.success) {
                        this.directorSessions = data.data.sessions || [];
                        this.renderDirectorSessions();
                        resolve();
                    } else {
                        reject(new Error('Failed to load director sessions'));
                    }
                    // Remove the listener after handling the response
                    window.wsClient.off('director_get_sessions_response', handleResponse);
                };

                window.wsClient.on('director_get_sessions_response', handleResponse);

                // Timeout after 10 seconds
                setTimeout(() => {
                    window.wsClient.off('director_get_sessions_response', handleResponse);
                    reject(new Error('Timeout loading director sessions'));
                }, 10000);
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
            const noSessionsItem = this.createNoSessionsItem();
            this.addSessionItemToList(noSessionsItem);
        } else {
            // Use document fragment for batch DOM operations
            const fragment = document.createDocumentFragment();
            const eventListeners = [];

            sessions.forEach(session => {
                const sessionItem = this.createSessionItem(session, eventListeners);
                fragment.appendChild(sessionItem);
            });

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

    createSessionItem(session, eventListeners) {
        const item = document.createElement('div');
        item.className = 'director-session-item';
        item.dataset.sessionId = session.id; // Add data attribute for easier identification

        // Cache expensive computations
        const previewSrc = this.getSessionPreviewImage(session);
        const formattedDate = this.formatSessionDate(session.created_at);

        item.innerHTML = `
            <img class="director-session-preview" src="${previewSrc}" alt="Session preview" loading="lazy">
            <div class="director-session-info">
                <div class="director-session-name">${this.escapeHtml(session.name)}</div>
                <div class="director-session-date">${formattedDate}</div>
            </div>
        `;

        // Attach context menu to this session item
        if (contextMenu && this.directorSessionContextConfig) {
            contextMenu.attachToElement(item, this.directorSessionContextConfig);
        }

        // Store event listener for batch attachment
        eventListeners.push({
            element: item,
            type: 'click',
            handler: () => this.showSessionChat(session)
        });

        return item;
    }

    formatSessionDate(timestamp) {
        // Cache date formatting to avoid repeated computations
        if (!this._dateFormatter) {
            this._dateFormatter = new Intl.DateTimeFormat('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }
        return this._dateFormatter.format(new Date(timestamp * 1000));
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
    
    async createSession() {
        const maxResolution = this.directorMaxResolutionBtn.getAttribute('data-state') === 'on';
        const modeSliderContainer = this.directorModeSliderContainer ||
                                   document.getElementById('directorModeSliderContainer');
        const sessionMode = modeSliderContainer?.getAttribute('data-active') || 'analyse';
        let imageFilename = null;

        if (window.currentManualPreviewImage) {
            imageFilename = window.currentManualPreviewImage.filename ||
                           window.currentManualPreviewImage.original ||
                           window.currentManualPreviewImage.upscaled;
        }

        // Check if we have an image for session creation
        if (!imageFilename && !this.selectedImageData && sessionMode !== 'create') {
            showGlassToast('error', null, 'No image available for session creation');
            return;
        }

        // Send WebSocket request to create session
        if (window.wsClient && window.wsClient.isConnected()) {
            const message = {
                type: 'director_create_session',
                requestId: Date.now().toString(),
                model: (sessionMode !== 'create' && maxResolution) ? 'grok-4' : (window.optionsData?.defaultGrokModel || 'grok-4-fast-reasoning'),
                highReason: maxResolution,
                maxResolution: (sessionMode === 'create') ? false : maxResolution,
                sessionMode: sessionMode,
                description: this.directorUserIntent ? this.directorUserIntent.value.trim() : '',
                inputPrompt: (sessionMode === 'create' || this.selectedImageData) ? false : this.getInputPrompt(),
                imageFilename: (sessionMode === 'create' || this.selectedImageData) ? false : imageFilename, // Get actual filename
                vibeTransfers: (sessionMode === 'create' || this.selectedImageData) ? false : this.getVibeTransfers(),
                baseImageData: (sessionMode === 'create' || this.selectedImageData) ? false : this.getBaseImageData(),
                characterReference: (sessionMode === 'create' || this.selectedImageData) ? false : this.getCharacterReferenceData(),
                dryrun: window.directorDryrun
            };

            // Add selected image data for Analyse mode
            if (sessionMode === 'analyse' && this.selectedImageData) {
                message.selectedImageData = this.selectedImageData;
            }

            window.wsClient.send(message);
        }
        // Reset input after successful session creation
        if (this.directorUserIntent) {
            this.directorUserIntent.value = '';
            this.autoExpandTextarea(this.directorUserIntent); // Reset to minimum height
        }

        // Reset selected image data
        if (this.selectedImageData) {
            this.removeSelectedImage();
        }
    }
    
    async deleteSession() {
        if (!this.currentSession) return;        
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
            // Clear localStorage if this is the stored last session
            const lastSessionId = localStorage.getItem(this.LAST_SESSION_KEY);
            if (lastSessionId === this.currentSession.id) {
                localStorage.removeItem(this.LAST_SESSION_KEY);
            }

            // Send WebSocket request to delete session
            if (window.wsClient && window.wsClient.isConnected()) {
                window.wsClient.send({
                    type: 'director_delete_session',
                    requestId: Date.now().toString(),
                    sessionId: this.currentSession.id
                });
            } else {
                console.warn('WebSocket not connected, using mock data');
                this.directorSessions = this.directorSessions.filter(s => s.id !== this.currentSession.id);
                window.directorSessions = this.directorSessions;
                this.renderDirectorSessions();
                this.showSessionList();
            }
        }
    }
    
    loadSessionMessages(sessionId) {
        // Send WebSocket request to load messages
        if (window.wsClient && window.wsClient.isConnected()) {
            window.wsClient.send({
                type: 'director_get_messages',
                requestId: Date.now().toString(),
                sessionId: sessionId,
                limit: DIRECTOR_MAX_SESSION_MESSAGES
            });
        } else {
            console.warn('WebSocket not connected, using mock data');
            const session = directorSessions.find(s => s.id === sessionId);
            if (session) {
                renderSessionMessages(session.messages || []);
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

    _doRenderSessionMessages(messages) {
        const cappedMessages = this.currentSession
            ? assignTrimmedDirectorSessionMessages(this.currentSession, messages)
            : trimDirectorSessionMessages(messages);
        messages = cappedMessages;

        if (this.currentSession) {
            const sessionIdx = this.directorSessions.findIndex(s => s.id === this.currentSession.id);
            if (sessionIdx !== -1) {
                this.directorSessions[sessionIdx].messages = this.currentSession.messages;
            }
        }

        this.directorChatMessages.innerHTML = '';

        // Use document fragment for batch DOM operations
        const fragment = document.createDocumentFragment();

        messages.forEach(message => {
            // Check if this message has captions/quotes that should be separated
            const structuredData = message.data || null;
            const hasCaptions = structuredData && structuredData.Caption &&
                              Array.isArray(structuredData.Caption) &&
                              structuredData.Caption.length > 0;

            if (hasCaptions) {
                // Create separate quote messages for each caption
                structuredData.Caption.forEach((caption, index) => {
                    const quoteMessage = this.createQuoteMessageElement(caption, message, index);
                    if (quoteMessage) {
                        fragment.appendChild(quoteMessage);
                    }
                });
            }

            // Create the main message element
            const messageElement = this.createMessageElement(message);
            if (messageElement) {
                fragment.appendChild(messageElement);
            }
        });

        // Batch add all messages at once
        this.directorChatMessages.appendChild(fragment);
        
        // Apply current message filter
        this.applyMessageFilter();

        // Scroll to bottom
        this.scrollToBottom();

        // Update scrollbars after content changes
        this.initializeScrollbars();
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
                
                // Extract the main content from AI response object
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
                                    ${structuredData.Suggested.map((suggestion, index) =>
                                        `<div class="director-suggestion-item clickable" onclick="window.directorInstance.useSuggestion('${suggestion.replace(/'/g, "\\'")}')">
                                            <i class="fas fa-arrow-right"></i> ${suggestion}
                                        </div>`
                                    ).join('')}
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
                content = `<div class="director-message-content">${message.content || 'Invalid Response from AI'}</div>`;
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
            
            // Add measurements button if measurements are available
            // Check both preprocessed parsed fields and on-the-fly parsed fields
            let hasMeasurements = false;
            if (message.data && message.data.Measurements) {
                // Handle both old single object format and new array format
                if (Array.isArray(message.data.Measurements)) {
                    hasMeasurements = message.data.Measurements.length > 0;
                } else {
                    hasMeasurements = true;
                }
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
            
            // Add measurements button if measurements are available
            if (hasMeasurements) {
                actionButtons.push(`<button type="button" class="btn-secondary btn-small" onclick="window.directorInstance.showMeasurements(this)"><i class="fas fa-ruler-triangle"></i></button>`);
            }
            
            // Add prompt button if prompt is available
            if (structuredData && structuredData.Prompt) {
                actionButtons.push(`<button type="button" class="btn-danger btn-small" onclick="window.directorInstance.applyPrompt(this)">Apply Prompt</button>`);
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
        return messageDiv;
    }
    
    async sendMessage() {
        const content = this.directorChatInput.value.trim();
        if (!this.currentSession) return;

        const action = this.getSelectedDirectorAction();
        const includeBaseImage = this.directorAddBaseImageToggleBtn.getAttribute('data-state') === 'on';
        const fastResponse = this.directorHighThinkingToggleBtn.getAttribute('data-state') === 'on';
        const highThinking = !fastResponse; // When fast response is OFF, use grok-4 (highReason = true)

        // Add user message
        const userMessage = {
            role: 'user',
            timestamp: new Date().toISOString()
        };
        if (content) {
            userMessage.content = content;
        }

        this.currentSession.messages = this.currentSession.messages || [];
        this.currentSession.messages.push(userMessage);
        assignTrimmedDirectorSessionMessages(this.currentSession, this.currentSession.messages);

        // Update UI with optimized DOM operations
        const messageElement = this.createMessageElement(userMessage);
        if (messageElement) {
            // Use document fragment for better performance
            const fragment = document.createDocumentFragment();
            fragment.appendChild(messageElement);
            this.directorChatMessages.appendChild(fragment);
        }
        this.directorChatInput.value = '';

        // Auto-expand textarea to reset to minimum height
        this.autoExpandTextarea(this.directorUserInput);

        // Scroll to bottom after adding user message
        this.scrollToBottom();

        // Show typing indicator
        this.showTypingIndicator();

        const prompts = this.getInputPrompt();

        // Get last generated image filename for efficiency requests only when includeBaseImage is set
        let lastGeneratedImageFilename = undefined;
        if (includeBaseImage && window.currentManualPreviewImage) {
            lastGeneratedImageFilename = window.currentManualPreviewImage.filename ||
                                       window.currentManualPreviewImage.original ||
                                       window.currentManualPreviewImage.upscaled;
        }

        // Send WebSocket request
        if (window.wsClient && window.wsClient.isConnected()) {
            const message = {
                type: 'director_send_message',
                requestId: Date.now().toString(),
                sessionId: this.currentSession.id,
                content: content,
                messageType: action,
                vibeTransfers: includeBaseImage ? this.getVibeTransfers() : null,
                baseImageData: includeBaseImage ? this.getBaseImageData() : null,
                lastGeneratedImageFilename: lastGeneratedImageFilename,
                inputPrompt: prompts,
                highReason: highThinking,
                characterReference: includeBaseImage ? this.getCharacterReferenceData() : null,
                dryrun: window.directorDryrun,
                enableLiveSearch: this.enableLiveSearch
            };

            window.wsClient.send(message);
        }
    }

    // Get precise reference data for director messages
    getCharacterReferenceData() {
        // collectPreciseReferenceData: referenceManager.js
        if (typeof collectPreciseReferenceData === 'function') {
            const data = collectPreciseReferenceData();
            if (data && data.chara_reference_source && data.chara_reference_source.length) {
                const first = data.chara_reference_source[0];
                const [type, id] = first.split(':', 2);
                return {
                    type,
                    id,
                    with_style: data.chara_reference_type ? data.chara_reference_type[0] === 1 : true
                };
            }
        }
        return null;
    }

    showTypingIndicator(content = null) {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'director-typing-indicator';
        // Show only the last 200 characters of the content
        const displayContent = content && content.length > 200 ? content.slice(-200) : content;
        typingDiv.innerHTML = `
            <div class="director-typing-dots">
                <div class="director-typing-dot"></div>
                <div class="director-typing-dot"></div>
                <div class="director-typing-dot"></div>
            </div>
            <div class="director-streaming-content">
                ${displayContent ? `<div class="director-streaming-text">${this.formatStreamingContent(displayContent)}</div>` : ''}
            </div>
        `;
        this.directorChatMessages.appendChild(typingDiv);
        this.scrollToBottom();
    }
    
    hideTypingIndicator() {
        const typingIndicator = this.directorChatMessages.querySelector('.director-typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
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

        // If response is an object with Description field (AI analysis response)
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
        this.checkAndAutoApplyPrompt(message);
    }

    // Check and auto-apply prompt if conditions are met
    checkAndAutoApplyPrompt(message) {
        // Check if auto-generate is enabled
        if (!this.autoGenerateEnabled) {
            return;
        }

        // Check if manual model is open
        const manualModal = document.getElementById('manualModal');
        if (!manualModal || manualModal.classList.contains('hidden')) {
            return;
        }

        // Check if director session is open (we're in sessionChat view)
        if (this.currentView !== 'sessionChat') {
            return;
        }

        // Check if message contains a Prompt
        let prompt = null;
        if (message.data && message.data.Prompt) {
            prompt = message.data.Prompt;
        }

        if (!prompt) {
            return;
        }

        this.applyPromptFromMessage(prompt, message.id);
    }

    // Apply prompt from message data
    applyPromptFromMessage(prompt, messageId = null) {
        // Store director session and message IDs for tracking on director button
        if (this.currentSession && messageId) {
            // Store the IDs as dataset values on the director button
            const directorBtn = document.getElementById('directorBtn');
            if (directorBtn) {
                directorBtn.dataset.directorSessionId = this.currentSession.id;
                directorBtn.dataset.directorMessageId = messageId;
            }
        }

        // Handle different prompt formats (same logic as applyPrompt method)

        // Handle new JSON format with base_input, base_uc, and chara
        if (prompt && typeof prompt === 'object' && !Array.isArray(prompt)) {
            if (prompt.base_input !== undefined || prompt.base_uc !== undefined || prompt.chara) {
                // Apply base prompt
                const manualPrompt = document.getElementById('manualPrompt');
                if (manualPrompt && prompt.base_input) {
                    manualPrompt.value = prompt.base_input;

                    // Call normal update functions that handle reflow and highlighting
                    applyFormattedText(manualPrompt, true);
                    updateEmphasisHighlighting(manualPrompt);
                    stopEmphasisHighlighting();
                    autoResizeTextarea(manualPrompt);
                }

                // Apply base UC
                const manualUc = document.getElementById('manualUc');
                if (manualUc && prompt.base_uc) {
                    manualUc.value = prompt.base_uc;

                    // Call normal update functions that handle reflow and highlighting
                    applyFormattedText(manualUc, true);
                    updateEmphasisHighlighting(manualUc);
                    stopEmphasisHighlighting();
                    autoResizeTextarea(manualUc);
                }

                const manualPromptNegativeDir = document.getElementById('manualPromptNegative');
                const pn = prompt.input_prompt_negative ?? prompt.base_prompt_negative;
                if (manualPromptNegativeDir && pn) {
                    manualPromptNegativeDir.value = pn;
                    applyFormattedText(manualPromptNegativeDir, true);
                    updateEmphasisHighlighting(manualPromptNegativeDir);
                    stopEmphasisHighlighting();
                    autoResizeTextarea(manualPromptNegativeDir);
                }

                // Apply quality preset setting
                if (prompt.apply_quality_preset !== undefined) {
                    appendQuality = prompt.apply_quality_preset;
                }

                // Apply UC preset setting
                if (prompt.apply_uc_preset !== undefined) {
                    selectUcPreset(prompt.apply_uc_preset);
                }

                // Smart character management - update existing, remove unused, add new
                if (prompt.chara && Array.isArray(prompt.chara)) {
                    const characterItems = document.querySelectorAll('.character-prompt-item');
                    const newCharacterCount = prompt.chara.length;

                    // Remove characters beyond the new count
                    if (characterItems.length > newCharacterCount) {
                        for (let i = characterItems.length - 1; i >= newCharacterCount; i--) {
                            characterItems[i].remove();
                        }
                    }

                    // Add/update character prompts from JSON structure
                    prompt.chara.forEach((character, index) => {
                        if (character && (character.name || character.input || character.uc)) {
                            this.addCharacterPromptFromData(character, index);
                        }
                    });
                } else {
                    // No characters in new prompt, remove all existing
                    document.querySelectorAll('.character-prompt-item').forEach(item => {
                        item.remove();
                    });
                }

                const characterCount = prompt.chara ? prompt.chara.length : 0;
                showGlassToast('success', null, `Prompt${characterCount > 0 ? ` and ${characterCount} character(s)` : ''} Auto-Applied`);
                return;
            }
        }

        if (Array.isArray(prompt)) {
            if (prompt.length === 1) {
                // Single prompt: replace base prompt
                const manualPrompt = document.getElementById('manualPrompt');
                if (manualPrompt) {
                    manualPrompt.value = prompt[0];

                    // Call normal update functions that handle reflow and highlighting
                    applyFormattedText(manualPrompt, true);
                    updateEmphasisHighlighting(manualPrompt);
                    stopEmphasisHighlighting();
                    autoResizeTextarea(manualPrompt);
                }

                // Remove all character prompts
                const characterItems = document.querySelectorAll('.character-prompt-item');
                characterItems.forEach(item => {
                    item.remove();
                });

                showGlassToast('success', null, 'Prompt Auto-Applied');
            } else if (prompt.length > 1) {
                // Multiple prompts: first is base, rest are character prompts
                const manualPrompt = document.getElementById('manualPrompt');
                if (manualPrompt) {
                    manualPrompt.value = prompt[0];

                    // Call normal update functions that handle reflow and highlighting
                    applyFormattedText(manualPrompt, true);
                    updateEmphasisHighlighting(manualPrompt);
                    stopEmphasisHighlighting();
                    autoResizeTextarea(manualPrompt);
                }

                // Remove existing character prompts
                document.querySelectorAll('.character-prompt-item').forEach(item => {
                    item.remove();
                });

                // Add character prompts (skip first one as it's the base)
                for (let i = 1; i < prompt.length; i++) {
                    this.addCharacterPromptFromData({ input: prompt[i] }, i - 1);
                }

                showGlassToast('success', null, `Prompt and ${prompt.length - 1} character(s) Auto-Applied`);
            }
        } else if (typeof prompt === 'string') {
            // Single string prompt: replace base prompt
            const manualPrompt = document.getElementById('manualPrompt');
            if (manualPrompt) {
                manualPrompt.value = prompt;

                // Call normal update functions that handle reflow and highlighting
                applyFormattedText(manualPrompt, true);
                updateEmphasisHighlighting(manualPrompt);
                stopEmphasisHighlighting();
                autoResizeTextarea(manualPrompt);
            }

            // Remove all character prompts
            document.querySelectorAll('.character-prompt-item').forEach(item => {
                item.remove();
            });

            showGlassToast('success', null, 'Prompt Auto-Applied');
        }
    }

    // Add character prompt from data object with index-based matching
    addCharacterPromptFromData(characterData, characterIndex = -1) {
        if (!characterData || (!characterData.name && !characterData.input && !characterData.uc)) {
            return;
        }

        // Get all existing character items
        const characterItems = document.querySelectorAll('.character-prompt-item');

        // Use index to match existing character, or create new if index is beyond existing items
        let targetCharacterItem = null;
        let targetCharacterId = null;

        if (characterIndex >= 0 && characterIndex < characterItems.length) {
            // Update existing character at the specified index
            targetCharacterItem = characterItems[characterIndex];
            targetCharacterId = targetCharacterItem.id;
        } else {
            // Index is beyond existing items, create new character
            addCharacterPrompt();

            // Get the newly created character prompt element
            const updatedCharacterItems = document.querySelectorAll('.character-prompt-item');
            targetCharacterItem = updatedCharacterItems[updatedCharacterItems.length - 1];
            targetCharacterId = targetCharacterItem.id;
        }

        if (targetCharacterItem && targetCharacterId) {
            // Update character name if provided
            if (characterData.name) {
                const nameInput = targetCharacterItem.querySelector('.character-name-input');
                if (nameInput) {
                    nameInput.value = characterData.name;
                    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
                const placeholderElement = targetCharacterItem.querySelector('.character-name-input-placeholder');
                if (placeholderElement) {
                    placeholderElement.textContent = characterData.name;
                }
                targetCharacterItem.dataset.charaName = characterData.name;
            }

            // Update character prompt if provided
            if (characterData.input) {
                const promptTextarea = document.getElementById(`${targetCharacterId}_prompt`);
                if (promptTextarea) {
                    promptTextarea.value = characterData.input;
                    // Apply formatting
                    applyFormattedText(promptTextarea, true);
                    updateEmphasisHighlighting(promptTextarea);
                }
            }

            // Update character UC if provided
            if (characterData.uc) {
                const ucTextarea = document.getElementById(`${targetCharacterId}_uc`);
                if (ucTextarea) {
                    ucTextarea.value = characterData.uc;
                    // Apply formatting
                    applyFormattedText(ucTextarea, true);
                    updateEmphasisHighlighting(ucTextarea);
                }
            }

            // Update preview
            const previewInput = document.getElementById(`${targetCharacterId}_preview`);
            if (previewInput) {
                const promptValue = characterData.input || '';
                previewInput.value = promptValue.length > 50 ? promptValue.substring(0, 50) : promptValue;
            }
        }
    }

    getVibeTransfers() {
        // Get vibe transfer settings from the current generation data
        if (window.lastGeneration && window.lastGeneration.vibe_transfers) {
            return window.lastGeneration.vibe_transfers;
        }
        
        // Check if there are any active vibe transfers in the UI
        const vibeElements = document.querySelectorAll('[data-vibe-id]');
        if (vibeElements.length > 0) {
            const vibeTransfers = Array.from(vibeElements)
                .filter(el => {
                    // Only include enabled vibe transfers
                    const enabledButton = el.querySelector('.vibe-reference-controls button[data-state="on"]');
                    return enabledButton !== null;
                })
                .map(el => {
                    const settings = el.getAttribute('data-vibe-settings') ? 
                        JSON.parse(el.getAttribute('data-vibe-settings')) : null;
                    
                    return {
                        id: el.getAttribute('data-vibe-id'),
                        strength: settings?.strength || 0.5,
                        ie: settings?.ie || 50
                    };
                });
            
            return vibeTransfers.length > 0 ? vibeTransfers : null;
        }
        
        return null;
    }
    
    getBaseImageData() {
        // Get base image data from the current generation
        if (window.lastGeneration && window.lastGeneration.image_source) {
            return {
                image_source: window.lastGeneration.image_source,
                mask_compressed: window.lastGeneration.mask_compressed || null,
                isBiasMode: window.lastGeneration.isBiasMode || false,
                bias_settings: window.lastGeneration.bias_settings || null
            };
        }
        
        // Check if there's uploaded image data
        if (window.uploadedImageData && window.uploadedImageData.image_source) {
            return {
                image_source: window.uploadedImageData.image_source,
                mask_compressed: window.uploadedImageData.mask_compressed || null,
                isBiasMode: window.uploadedImageData.isBiasMode || false,
                bias_settings: window.uploadedImageData.bias_settings || null
            };
        }
        
        return null;
    }
    
    getInputPrompt() {
        // Get prompts in new JSON structure
        let baseInput = '';
        let baseUc = '';
        let basePromptNegative = '';
        const chara = [];

        // Add main/base prompt if available
        const manualPrompt = document.getElementById('manualPrompt');
        if (manualPrompt && manualPrompt.value.trim()) {
            baseInput = normalizePromptNewlines(manualPrompt.value).trim();
        }

        // Add main/base UC if available
        const manualUc = document.getElementById('manualUc');
        if (manualUc && manualUc.value.trim()) {
            baseUc = normalizePromptNewlines(manualUc.value).trim();
        }

        const manualPromptNegativeCollect = document.getElementById('manualPromptNegative');
        if (manualPromptNegativeCollect && manualPromptNegativeCollect.value.trim()) {
            basePromptNegative = normalizePromptNewlines(manualPromptNegativeCollect.value).trim();
        }

        // Add character prompts if available
        const characterItems = document.querySelectorAll('.character-prompt-item');
        characterItems.forEach(characterItem => {
            const characterId = characterItem.id;

            // Get character name
            const characterNameElement = document.getElementById(`${characterId}_name`);
            let characterName = '';
            if (characterNameElement && characterNameElement.value.trim()) {
                characterName = characterNameElement.value.trim();
            }

            // Get character prompt
            const characterPrompt = document.getElementById(`${characterId}_prompt`);
            let characterInput = '';
            if (characterPrompt && characterPrompt.value.trim()) {
                characterInput = normalizePromptNewlines(characterPrompt.value).trim();
            }

            // Get character UC
            const characterUc = document.getElementById(`${characterId}_uc`);
            let characterUcValue = '';
            if (characterUc && characterUc.value.trim()) {
                characterUcValue = normalizePromptNewlines(characterUc.value).trim();
            }

            // Only add character if they have some content
            if (characterName || characterInput || characterUcValue) {
                chara.push({
                    name: characterName,
                    input: characterInput,
                    uc: characterUcValue
                });
            }
        });

        // Return raw prompts with compilation flags for server-side processing
        return {
            base_input: baseInput,
            base_uc: baseUc,
            input_prompt_negative: basePromptNegative,
            chara: chara,
            // Include compilation flags so server knows to compile using buildOptions logic
            append_quality: appendQuality || false,
            quality_preset_bias: (typeof qualityPresetBias !== 'undefined' && qualityPresetBias !== 1.0) ? qualityPresetBias : undefined,
            append_uc: selectedUcPreset || 0,
            model: window.manualSelectedModel || 'v4_5'
        };
    }
    
    getSessionPreviewImage(session) {
        // Generate preview image path based on image type
        if (session.filename) {
            if (session.image_type === 'cache' || session.image_type === 'sessions') {
                // For cache images, use cache preview
                return `/cache/preview/${session.filename}.webp`;
            } else {
                // For generated images, use previews directory
                const baseName = session.filename.split('.').slice(0, -1).join('.');
                return `/previews/${baseName}.webp`;
            }
        }
        return '/static_images/background.jpg';
    }
    
    updateIndicator(button, isActive) {
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
        window.wsClient.on('director_get_sessions_response', (data) => {
            if (data.data && data.data.success) {
                window.directorInstance.directorSessions = data.data.sessions || [];
                window.directorSessions = window.directorInstance.directorSessions;
                window.directorInstance.renderDirectorSessions();
            }
        });

        // Handle Director create session response
        window.wsClient.on('director_create_session_response', async (data) => {
            if (data.data && data.data.success) {
                const newSession = data.data.session;
                // Note: Don't manually add session here - loadDirectorSessions() will get all sessions including the new one

                // Open manual modal if not already open
                await openManualModalWithContent();

                // Enable director button if disabled
                if (window.directorInstance.directorBtn && window.directorInstance.directorBtn.disabled) {
                    window.directorInstance.directorBtn.disabled = false;
                    window.directorInstance.directorBtn.classList.remove('disabled');
                }

                // Show director interface and wait for it to complete
                await window.directorInstance.showDirector();

                // Reload all sessions from server to ensure session list is fully up-to-date
                await window.directorInstance.loadDirectorSessions();

                await window.directorInstance.loadSessionMessages(newSession);
            }
        });

        // Handle Director send message response
        window.wsClient.on('director_send_message_response', (data) => {
            if (window.directorInstance) {
                window.directorInstance.hideTypingIndicator();
            }

            if (window.directorInstance && window.currentSession) {
                setTimeout(() => {window.directorInstance.loadSessionMessages(window.currentSession.id);}, 100);
            }
        });
        
        // Handle Director get messages response
        window.wsClient.on('director_get_messages_response', (data) => {
            if (data.data && data.data.success) {
                const messages = data.data.messages || [];
                if (window.directorInstance) {
                    window.directorInstance.renderSessionMessages(messages);
                }
            } else {
                console.warn('❌ director_get_messages_response failed:', data);
            }
        });
        
        // Handle Director delete session response
        window.wsClient.on('director_delete_session_response', async (data) => {
            if (data.data && data.data.success) {
                if (window.directorInstance) {
                    await window.directorInstance.loadDirectorSessions();
                    window.directorInstance.showSessionList();
                }
            }
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
            if (data.data && data.data.sessionId === window.currentSession?.id) {
                if (window.directorInstance) {
                    window.directorInstance.updateTypingIndicator(data.data.fullContent);
                }
            }
        });
        
        // Handle Director message response
        window.wsClient.on('director_message_response', (data) => {
            if (data.data && data.data.success && data.data.sessionId === window.currentSession?.id) {
                if (window.directorInstance) {
                    window.directorInstance.addMessageToChat(data.data, 'assistant');
                }
                
                // Check if response contains SuggestedName and update session title
                if (data.data.response && data.data.response.SuggestedName) {
                    const suggestedName = data.data.response.SuggestedName;
                    
                    // Update current session name
                    if (window.currentSession) {
                        window.currentSession.name = suggestedName;
                    }
                    
                    // Update session in the sessions list
                    const sessionIndex = window.directorSessions.findIndex(s => s.id === data.data.sessionId);
                    if (sessionIndex !== -1) {
                        window.directorSessions[sessionIndex].name = suggestedName;
                    }
                    
                    // Update the session title in the UI
                    if (window.directorInstance && window.directorInstance.directorSessionTitle) {
                        const titleText = window.directorInstance.directorSessionTitle.querySelector('.director-title-text');
                        if (titleText) {
                            titleText.textContent = suggestedName;
                        } else {
                            window.directorInstance.directorSessionTitle.textContent = suggestedName;
                        }
                    }
                    
                    // Re-render the sessions list to show updated name
                    if (window.directorInstance) {
                        window.directorInstance.renderDirectorSessions();
                    }
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
            if (data.data && data.data.sessionId === window.currentSession?.id) {
                console.error('Director message error:', data.data.error);
                if (window.directorInstance) {
                    window.directorInstance.hideTypingIndicator();
                }
                showGlassToast('error', null, data.data.error || 'Failed to send message');
            }
        });

        // Handle Director rollback message response
        window.wsClient.on('director_rollback_message_response', (data) => {
            if (data.data && data.data.success) {
                showGlassToast('success', null, data.data.message || 'Messages rolled back successfully');
                
                if (window.directorInstance && window.currentSession) {
                    window.directorInstance.loadSessionMessages(window.currentSession.id);
                    // Ensure scroll to bottom after rollback
                    setTimeout(() => window.directorInstance.scrollToBottom(), 100);
                }
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

    // Measurements modal functions
    showMeasurements(buttonElement) {
        // Find the message element by traversing up the DOM
        const messageElement = buttonElement.closest('.director-message');
        if (!messageElement) {
            console.warn('❌ No message element found');
            return;
        }
        
        // Get message data from the HTML element
        const messageData = messageElement.dataset.messageData;
        if (!messageData) {
            console.warn('❌ No message data found in element');
            return;
        }
        
        let message;
        try {
            message = JSON.parse(messageData);
        } catch (e) {
            console.warn('❌ Failed to parse message data from DOM:', e);
            return;
        }
        
        // Get measurements from server-processed data
        let measurements = null;
        if (message.data && message.data.Measurements) {
            measurements = message.data.Measurements;
        }

        if (!measurements || (Array.isArray(measurements) && measurements.length === 0)) {
            console.warn('No measurements found for message:', message.id);
            return;
        }

        const measurementsContent = document.getElementById('measurementsContent');

        // Clear previous content
        measurementsContent.innerHTML = '';

        // Handle array of character measurements
        let characterMeasurements = measurements;
        let allMeasurements = measurements;
        let selectedCharacterIndex = 0;

        if (Array.isArray(measurements)) {
            // Create tabs for multiple characters
            this.createCharacterTabs(measurements, message.data);
            characterMeasurements = measurements[0];
            selectedCharacterIndex = 0;
            console.log(`📏 Showing measurements for character 0 of ${measurements.length} total characters`);
        } else {
            // Single character - hide tabs
            const tabsContainer = document.getElementById('measurementsTabs');
            if (tabsContainer) {
                tabsContainer.classList.add('hidden');
            }
        }

        // Check if we should use advanced handling (EmotionState present)
        const useAdvancedHandling = characterMeasurements.EmotionState !== undefined;

        if (useAdvancedHandling) {
            // Use new advanced handling with sections
            this.renderAdvancedMeasurements(characterMeasurements, message.data, measurementsContent, selectedCharacterIndex, allMeasurements);
        } else {
            // Use old handling for backwards compatibility
            this.renderLegacyMeasurements(characterMeasurements, measurementsContent);
        }

        // Show modal
        const measurementsModal = document.getElementById('measurementsModal');
        openModal(measurementsModal);
    }

    // Create character tabs for multiple character measurements
    createCharacterTabs(measurementsArray, fullData) {
        const tabsContainer = document.getElementById('measurementsTabs');
        if (!tabsContainer) return;

        // Clear existing tabs
        tabsContainer.innerHTML = '';

        // Show tabs if we have multiple characters
        if (measurementsArray.length > 1) {
            tabsContainer.classList.remove('hidden');

            measurementsArray.forEach((characterMeasurements, index) => {
                const tab = document.createElement('div');
                tab.className = 'measurements-tab';
                tab.dataset.characterIndex = index;

                // Try to get character name from full data or measurements
                let characterLabel = `Character ${index + 1}`;

                // Check if full data has Character field (could be array or string)
                if (fullData && fullData.Character) {
                    if (Array.isArray(fullData.Character)) {
                        characterLabel = fullData.Character[index] || characterLabel;
                    } else if (index === 0) {
                        characterLabel = fullData.Character;
                    }
                }

                // Fallback: try to extract from character name if it contains series info
                if (characterLabel === `Character ${index + 1}` && characterMeasurements.Character) {
                    characterLabel = characterMeasurements.Character.split(' (')[0]; // Remove series info
                }

                tab.textContent = characterLabel;
                tab.addEventListener('click', () => this.switchToCharacter(index, measurementsArray, fullData));

                // Set first tab as active
                if (index === 0) {
                    tab.classList.add('active');
                }

                tabsContainer.appendChild(tab);
            });
        } else {
            tabsContainer.classList.add('hidden');
        }
    }

    // Switch to display measurements for a specific character
    switchToCharacter(characterIndex, measurementsArray, fullData) {
        // Update active tab
        const tabs = document.querySelectorAll('.measurements-tab');
        tabs.forEach((tab, index) => {
            if (index === characterIndex) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // Get the measurements for the selected character
        const characterMeasurements = measurementsArray[characterIndex];
        const measurementsContent = document.getElementById('measurementsContent');

        // Clear previous content
        measurementsContent.innerHTML = '';

        // Check if we should use advanced handling
        const useAdvancedHandling = characterMeasurements.EmotionState !== undefined;

        if (useAdvancedHandling) {
            // Re-render measurements for the selected character
            this.renderAdvancedMeasurements(characterMeasurements, fullData, measurementsContent, characterIndex, measurementsArray);
        } else {
            // Use old handling for backwards compatibility
            this.renderLegacyMeasurements(characterMeasurements, measurementsContent);
        }
    }

    // Legacy measurements rendering for backwards compatibility
    renderLegacyMeasurements(measurements, container) {
        // Create measurements grid
        const measurementsGrid = document.createElement('div');
        measurementsGrid.className = 'measurements-grid';
        
        // Add each measurement with proper formatting
        Object.entries(measurements).forEach(([key, value]) => {
            const measurementItem = document.createElement('div');
            measurementItem.className = 'measurement-item';
            
            let displayValue = value;
            let dataType = 'default';
            
            // Handle different value types
            if (typeof value === 'object' && value !== null) {
                if (value.imperial && value.metric) {
                    // Imperial/Metric measurements
                    displayValue = `${value.imperial} / ${value.metric}`;
                    dataType = 'measurement';
                } else if (value.cup && value.size) {
                    // Breast measurements
                    displayValue = `${value.cup} (${value.size})`;
                    dataType = 'measurement';
                } else if (value.us && value.eu) {
                    // Alternative measurement format
                    displayValue = `${value.us.join('x')} / ${value.eu.join('x')}`;
                    dataType = 'measurement';
                } else {
                    // Other objects - stringify
                    displayValue = JSON.stringify(value, null, 2);
                    dataType = 'object';
                }
            } else if (Array.isArray(value)) {
                // Arrays (like Medical Conditions)
                if (value.length === 0) {
                    displayValue = 'None detected';
                } else {
                    displayValue = value.join(', ');
                }
                dataType = 'array';
            } else if (typeof value === 'number') {
                // Numbers (ratios, etc.)
                displayValue = value.toFixed(2);
                dataType = 'ratio';
            } else if (typeof value === 'string') {
                // Strings (Age, Species, etc.)
                displayValue = value;
                dataType = 'string';
            }
            
            // Set data type for styling
            measurementItem.setAttribute('data-type', dataType);
            
            // Special handling for specific keys
            if (key === 'Medical Conditions') {
                measurementItem.setAttribute('data-type', 'medical');
            } else if (key === 'Species') {
                measurementItem.setAttribute('data-type', 'species');
            } else if (key.includes('Ratio')) {
                measurementItem.setAttribute('data-type', 'ratio');
            } else if (key === 'Age') {
                measurementItem.setAttribute('data-type', 'age');
            } else if (key === 'Height' || key === 'Weight') {
                measurementItem.setAttribute('data-type', 'measurement');
            } else if (key === 'Breast') {
                measurementItem.setAttribute('data-type', 'measurement');
            } else if (key === 'Humanoid Ratio') {
                measurementItem.setAttribute('data-type', 'ratio');
            }
            
            measurementItem.innerHTML = `
                <div class="measurement-label">${key}</div>
                <div class="measurement-value">${displayValue}</div>
            `;
            measurementsGrid.appendChild(measurementItem);
        });
        
        container.appendChild(measurementsGrid);
    }

    // Advanced measurements rendering with sections and scale badges
    renderAdvancedMeasurements(measurements, fullData, container, characterIndex = 0, allMeasurements = null) {
        // Define measurement sections/groups
        const sections = {
            'Patient Information': {
                items: ['Character', 'Age', 'Height', 'Weight', 'Species', 'HumanoidRatio'],
                renderFunction: (data) => this.renderBasicMeasurementsSection(data)
            },
            'Mental State': {
                items: ['EmotionState'],
                renderFunction: (data) => this.renderMentalStateSection(data)
            },
            'Emotions': {
                items: ['EmotionState'],
                renderFunction: (data) => this.renderEmotionsSection(data)
            },
            'Physical State': {
                items: ['Posture'],
                renderFunction: (data) => this.renderPhysicalStateSection(data)
            },
            'Clothing': {
                items: ['Clothing'],
                renderFunction: (data) => this.renderClothingSection(data)
            },
            'Breasts': {
                items: ['Breast'],
                renderFunction: (data) => this.renderBreastsSection(data)
            },
            'Arms': {
                items: ['Arm'],
                renderFunction: (data) => this.renderArmsSection(data)
            },
            'Torso': {
                items: ['Torso'],
                renderFunction: (data) => this.renderTorsoSection(data)
            },
            'Head': {
                items: ['Head'],
                renderFunction: (data) => this.renderHeadSection(data)
            },
            'Hips': {
                items: ['Hips'],
                renderFunction: (data) => this.renderHipsSection(data)
            },
            'Legs': {
                items: ['Legs'],
                renderFunction: (data) => this.renderLegsSection(data)
            },
            'Stomach': {
                items: ['Weight'], // Stomach data is nested in Weight
                renderFunction: (data) => this.renderStomachSection(data)
            },
            'Reproductive System': {
                items: ['ReproductiveSystem'],
                renderFunction: (data) => this.renderReproductiveSystemSection(data)
            },
            'Pregnancy': {
                items: ['ReproductiveSystem'], // Pregnancy data is nested in ReproductiveSystem
                renderFunction: (data) => this.renderPregnancySection(data)
            },
            'Medical Conditions': {
                items: ['MedicalConditions'],
                renderFunction: (data) => this.renderMedicalConditionsSection(data)
            },
            'Progression': {
                items: ['Progression'],
                renderFunction: (data) => this.renderProgressionSection(data)
            }
        };

        // Render each section
        Object.entries(sections).forEach(([sectionName, sectionConfig]) => {
            const sectionData = {};
            sectionConfig.items.forEach(item => {
                // Special handling for Character field which is at the top level
                if (item === 'Character') {
                    if (fullData && fullData[item]) {
                        sectionData[item] = fullData[item];
                    }
                } else if (measurements[item]) {
                    sectionData[item] = measurements[item];
                }
            });

            // Only render section if it has data
            if (Object.keys(sectionData).length > 0) {
                const sectionElement = sectionConfig.renderFunction(sectionData);
                if (sectionElement) {
                    container.appendChild(sectionElement);
                }
            }
        });
    }

    // Helper function to create scale badge with background color/opacity
    createScaleBadge(scale, label = 'Scale') {
        if (scale === undefined || scale === null) return '';

        // Scale ranges from 0 to some max (typically 1.0 for "largest realistic")
        // Convert to opacity: higher scale = more opaque/red
        const opacity = Math.min(scale, 1.0);
        const backgroundColor = `rgba(220, 53, 69, ${opacity * 0.6})`; // Red with opacity based on scale

        return `<span class="measurement-scale-badge" style="background-color: ${backgroundColor};" title="${label}: ${scale.toFixed(2)}">${scale.toFixed(2)}</span>`;
    }

    // Helper function to format measurement values with unit conversion
    formatMeasurementValue(value, unit, scale = null, label = '') {
        // Handle undefined/null values
        if (value === undefined || value === null || isNaN(value)) {
            return 'N/A';
        }

        let imperialValue = '';
        let metricValue = '';

        if (unit === 'cm') {
            metricValue = `${value.toFixed(1)} cm`;
            // Convert cm to feet and inches
            const totalInches = value / 2.54;
            const feet = Math.floor(totalInches / 12);
            const inches = Math.round(totalInches % 12);
            imperialValue = `${feet}'${inches}"`;
        } else if (unit === 'kg') {
            metricValue = `${value.toFixed(1)} kg`;
            // Convert kg to lbs
            const lbs = value * 2.20462;
            imperialValue = `${lbs.toFixed(1)} lbs`;
        } else {
            return `${value} ${unit}`;
        }

        const scaleBadge = scale !== null ? this.createScaleBadge(scale, label) : '';

        return `<span class="measurement-value-toggle" data-unit="imperial" data-imperial="${imperialValue}" data-metric="${metricValue}">${imperialValue}</span>${scaleBadge}`;
    }

    // Individual section renderers
    renderEmotionsSection(data) {
        if (!data.EmotionState || !data.EmotionState.emotions || data.EmotionState.emotions.length === 0) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-smile"></i> Emotions</h3>';

        const emotions = data.EmotionState.emotions;
        const intensities = data.EmotionState.emotion_scale || [];

        emotions.forEach((emotion, index) => {
            const intensity = intensities[index] || 0;
            const intensityPercent = (intensity / 10) * 100;

            const emotionItem = document.createElement('div');
            emotionItem.className = 'measurement-emotion-item';
            emotionItem.innerHTML = `
                <div class="emotion-label">${emotion}</div>
                <div class="emotion-bar-container">
                    <div class="emotion-bar" style="width: ${intensityPercent}%"></div>
                </div>
                <div class="emotion-value">${intensity}/10</div>
            `;
            section.appendChild(emotionItem);
        });

        return section;
    }

    renderMentalStateSection(data) {
        if (!data.EmotionState) return null;

        const sanity = data.EmotionState.sanity_level;
        const willpower = data.EmotionState.willpower_level;
        const pain = data.EmotionState.pain_level;
        const libido = data.EmotionState.libido_level;
        const arousalFactors = data.EmotionState.arousal_factors;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-brain"></i> Mental State</h3>';

        // Mental state items with small inline gauges
        if (sanity !== undefined) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">
                        <i class="fas fa-brain"></i> Sanity Level
                    </div>
                    <div class="measurement-value">
                        ${sanity.toFixed(1)}/10 ${this.createSmallGauge(sanity, 10, 'gauge-success')}
                    </div>
                </div>
            `;
        }

        if (willpower !== undefined) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">
                        <i class="fas fa-fist-raised"></i> Willpower Level
                    </div>
                    <div class="measurement-value">
                        ${willpower.toFixed(1)}/10 ${this.createSmallGauge(willpower, 10, 'gauge-primary')}
                    </div>
                </div>
            `;
        }

        if (pain !== undefined) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">
                        <i class="fas fa-exclamation-triangle"></i> Pain Level
                    </div>
                    <div class="measurement-value">
                        ${pain.toFixed(1)}/10 ${this.createSmallGauge(pain, 10, 'gauge-danger')}
                    </div>
                </div>
            `;
        }

        if (libido !== undefined) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">
                        <i class="fas fa-heart"></i> Libido Level
                    </div>
                    <div class="measurement-value">
                        ${libido.toFixed(1)}/10 ${this.createSmallGauge(libido, 10, 'gauge-warning')}
                    </div>
                </div>
            `;
        }

        // Arousal factors
        if (arousalFactors && arousalFactors.length > 0) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">
                        <i class="fas fa-fire"></i> Arousal Factors
                    </div>
                    <div class="measurement-value">
                        ${arousalFactors.join(', ')}
                    </div>
                </div>
            `;
        }

        return section;
    }

    renderBasicMeasurementsSection(data) {
        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-user"></i> Patient Information</h3>';

        let hasContent = false;

        // Character Name
        if (data.Character) {
            section.innerHTML += `
                <div class="measurement-character-name">${data.Character}</div>
            `;
            hasContent = true;
        }

        // Age
        if (data.Age) {
            const ageYears = data.Age.years;
            const ageQuestionable = data.Age.questionable;
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">Age</div>
                    <div class="measurement-value">${ageYears} years${ageQuestionable ? ' (estimated)' : ''}</div>
                </div>
            `;
            hasContent = true;
        }

        // Species
        if (data.Species) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">Species</div>
                    <div class="measurement-value">${data.Species}</div>
                </div>
            `;
            hasContent = true;
        }

        // Humanoid Ratio
        if (data.HumanoidRatio !== undefined) {
            const humanoidPercent = (data.HumanoidRatio * 100).toFixed(1);
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">Humanoid Ratio</div>
                    <div class="measurement-value">${humanoidPercent}% ${this.createSmallGauge(data.HumanoidRatio * 10, 10, 'gauge-info')}</div>
                </div>
            `;
            hasContent = true;
        }

        // Height
        if (data.Height) {
            const heightCm = data.Height.cm;
            const heightScale = data.Height.scale;
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">Height</div>
                    <div class="measurement-value">${this.formatMeasurementValue(heightCm, 'cm', heightScale, 'Height Scale')}</div>
                </div>
            `;
            hasContent = true;
        }

        // Body Weight
        if (data.Weight && data.Weight.body_kg !== undefined) {
            const bodyKg = data.Weight.body_kg;
            const bodyScale = data.Weight.body_scale;
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">Weight</div>
                    <div class="measurement-value">${this.formatMeasurementValue(bodyKg, 'kg', bodyScale, 'Body Scale')}</div>
                </div>
            `;
            hasContent = true;
        }

        return hasContent ? section : null;
    }

    renderPhysicalStateSection(data) {
        let section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-running"></i> Physical State</h3>';

        let hasContent = false;

        // Posture
        if (data.Posture) {
            const posture = data.Posture;
            
            // Posture description
            if (posture.description) {
                section.innerHTML += `
                    <div class="measurement-description-row">
                        <div class="measurement-description-label">Posture</div>
                        <div class="measurement-description-text">${posture.description}</div>
                    </div>
                `;
                hasContent = true;
            }
            
            // Posture measurements in column layout
            const postureContainer = document.createElement('div');
            postureContainer.className = 'measurement-column-container';

            const postureHeader = document.createElement('div');
            postureHeader.className = 'measurement-group-header';
            postureHeader.innerHTML = '<i class="fas fa-user"></i> Posture Details';
            postureContainer.appendChild(postureHeader);

            const postureRow = document.createElement('div');
            postureRow.className = 'measurement-column-row';

            const postureColumns = document.createElement('div');
            postureColumns.className = 'measurement-column-items';

            // Spine Curvature Column
            if (posture.spine_curvature_degrees !== undefined && posture.spine_curvature_degrees !== null) {
                const spineColumn = document.createElement('div');
                spineColumn.className = 'measurement-column-item';
                spineColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-arrow-up" title="Spine Curvature"></i>
                        <span>Spine Curvature</span>
                    </div>
                    <div class="measurement-column-value">${posture.spine_curvature_degrees.toFixed(1)}°</div>
                `;
                postureColumns.appendChild(spineColumn);
            }
            
            // Balance Level Column
            if (posture.balance_level !== undefined && posture.balance_level !== null) {
                const balanceColumn = document.createElement('div');
                balanceColumn.className = 'measurement-column-item';
                balanceColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-balance-scale" title="Balance Level"></i>
                        <span>Balance Level</span>
                    </div>
                    <div class="measurement-column-value">
                        ${posture.balance_level.toFixed(1)}/10 ${this.createSmallGauge(posture.balance_level, 10, 'gauge-info')}
                    </div>
                `;
                postureColumns.appendChild(balanceColumn);
            }

            if (postureColumns.children.length > 0) {
                postureRow.appendChild(postureColumns);
                postureContainer.appendChild(postureRow);
                section.appendChild(postureContainer);
                hasContent = true;
            }
        }

        return hasContent ? section : null;
    }

    renderClothingSection(data) {
        if (!data.Clothing) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-tshirt"></i> Clothing</h3>';

        let hasContent = false;
        const clothing = data.Clothing;
        
        // Clothing state description
        if (clothing.state) {
            section.innerHTML += `
                <div class="measurement-description-row">
                    <div class="measurement-description-label">Clothing State</div>
                    <div class="measurement-description-text">${clothing.state}</div>
                </div>
            `;
            hasContent = true;
        }
        
        // Clothing details in column layout
        const clothingContainer = document.createElement('div');
        clothingContainer.className = 'measurement-column-container';

        const clothingHeader = document.createElement('div');
        clothingHeader.className = 'measurement-group-header';
        clothingHeader.innerHTML = '<i class="fas fa-tshirt"></i> Clothing Details';
        clothingContainer.appendChild(clothingHeader);

        const clothingRow = document.createElement('div');
        clothingRow.className = 'measurement-column-row';

        const clothingColumns = document.createElement('div');
        clothingColumns.className = 'measurement-column-items';

        // Coverage Level Column
        if (clothing.coverage_level !== undefined && clothing.coverage_level !== null) {
            const coveragePercent = (clothing.coverage_level * 100).toFixed(1);
            const coverageColumn = document.createElement('div');
            coverageColumn.className = 'measurement-column-item';
            coverageColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-percentage" title="Coverage Level"></i>
                    <span>Coverage Level</span>
                </div>
                <div class="measurement-column-value">
                    ${coveragePercent}% ${this.createSmallGauge(clothing.coverage_level * 10, 10, 'gauge-secondary')}
                </div>
            `;
            clothingColumns.appendChild(coverageColumn);
        }
        
        // Items Column
        if (clothing.items && clothing.items.length > 0) {
            const itemsColumn = document.createElement('div');
            itemsColumn.className = 'measurement-column-item';
            itemsColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-list" title="Clothing Items"></i>
                    <span>Items</span>
                </div>
                <div class="measurement-column-value">${clothing.items.join(', ')}</div>
            `;
            clothingColumns.appendChild(itemsColumn);
        }

        if (clothingColumns.children.length > 0) {
            clothingRow.appendChild(clothingColumns);
            clothingContainer.appendChild(clothingRow);
            section.appendChild(clothingContainer);
            hasContent = true;
        }

        return hasContent ? section : null;
    }

    renderBreastsSection(data) {
        if (!data.Breast || data.Breast === null) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-female"></i> Breasts</h3>';

        let hasContent = false;
        const breast = data.Breast;

        // Breast description (full width row)
        if (breast.description) {
            section.innerHTML += `
                <div class="measurement-description-row">
                    <div class="measurement-description-label">Breast Description</div>
                    <div class="measurement-description-text">${breast.description}</div>
                </div>
            `;
            hasContent = true;
        }

        // Breast measurements (column layout)
        const breastContainer = document.createElement('div');
        breastContainer.className = 'measurement-column-container';

        // Add header for breast group
        const breastHeader = document.createElement('div');
        breastHeader.className = 'measurement-group-header';
        breastHeader.innerHTML = '<i class="fas fa-female"></i> Breasts';
        breastContainer.appendChild(breastHeader);

        // Create breast row with column layout
        const breastRow = document.createElement('div');
        breastRow.className = 'measurement-column-row';

        const breastColumns = document.createElement('div');
        breastColumns.className = 'measurement-column-items';

        // Cup Size Column
        if (breast.cup_size) {
            const cupColumn = document.createElement('div');
            cupColumn.className = 'measurement-column-item';
            cupColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-tag" title="Cup Size"></i>
                    <span>Cup Size</span>
                </div>
                <div class="measurement-column-value">${breast.cup_size}</div>
            `;
            breastColumns.appendChild(cupColumn);
        }

        // Protrusion Column
        if (breast.protrusion_cm !== undefined && breast.protrusion_cm !== null) {
            const protrusionColumn = document.createElement('div');
            protrusionColumn.className = 'measurement-column-item';
            protrusionColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-arrow-up-to-arc" title="Protrusion"></i>
                    <span>Protrusion</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(breast.protrusion_cm, 'cm')}
                    ${breast.scale !== undefined && breast.scale !== null ? this.createScaleBadge(breast.scale, 'Breast Scale') : ''}
                </div>
            `;
            breastColumns.appendChild(protrusionColumn);
        }

        if (breastColumns.children.length > 0) {
            breastRow.appendChild(breastColumns);
            breastContainer.appendChild(breastRow);
            section.appendChild(breastContainer);
            hasContent = true;
        }

        return hasContent ? section : null;
    }

    renderArmsSection(data) {
        if (!data.Arm) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-hand-paper"></i> Arms</h3>';

        let hasContent = false;
        const arm = data.Arm;

        // Arm measurements (column layout)
        const armContainer = document.createElement('div');
        armContainer.className = 'measurement-column-container';

        // Add header for arm group
        const armHeader = document.createElement('div');
        armHeader.className = 'measurement-group-header';
        armHeader.innerHTML = '<i class="fas fa-hand-paper"></i> Arms';
        armContainer.appendChild(armHeader);

        const armRow = document.createElement('div');
        armRow.className = 'measurement-column-row';

        const armColumns = document.createElement('div');
        armColumns.className = 'measurement-column-items';

        // Circumference Column
        if (arm.circumference_cm !== undefined && arm.circumference_cm !== null) {
            const circColumn = document.createElement('div');
            circColumn.className = 'measurement-column-item';
            circColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fa-regular fa-circle" title="Circumference"></i>
                    <span>Arm</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(arm.circumference_cm, 'cm')}
                    ${arm.scale !== undefined && arm.scale !== null ? this.createScaleBadge(arm.scale, 'Arm Scale') : ''}
                </div>
            `;
            armColumns.appendChild(circColumn);
        }

        // Length Column
        if (arm.length_cm !== undefined && arm.length_cm !== null) {
            const lengthColumn = document.createElement('div');
            lengthColumn.className = 'measurement-column-item';
            lengthColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-ruler-vertical" title="Length"></i>
                    <span>Length</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(arm.length_cm, 'cm')}
                </div>
            `;
            armColumns.appendChild(lengthColumn);
        }

        // Shoulder Width Column
        if (arm.shoulder_width_cm !== undefined && arm.shoulder_width_cm !== null) {
            const shoulderColumn = document.createElement('div');
            shoulderColumn.className = 'measurement-column-item';
            shoulderColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-ruler-horizontal" title="Shoulder Width"></i>
                    <span>Shoulders</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(arm.shoulder_width_cm, 'cm')}
                </div>
            `;
            armColumns.appendChild(shoulderColumn);
        }

        if (armColumns.children.length > 0) {
            armRow.appendChild(armColumns);
            armContainer.appendChild(armRow);
            section.appendChild(armContainer);
            hasContent = true;
        }

        return hasContent ? section : null;
    }

    renderTorsoSection(data) {
        if (!data.Torso) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-ribbon"></i> Torso</h3>';

        let hasContent = false;
        const torso = data.Torso;

        const torsoContainer = document.createElement('div');
        torsoContainer.className = 'measurement-column-container';

        const torsoHeader = document.createElement('div');
        torsoHeader.className = 'measurement-group-header';
        torsoHeader.innerHTML = '<i class="fas fa-ribbon"></i> Torso';
        torsoContainer.appendChild(torsoHeader);

        const torsoRow = document.createElement('div');
        torsoRow.className = 'measurement-column-row';

        const torsoColumns = document.createElement('div');
        torsoColumns.className = 'measurement-column-items';

        // Length Column
        if (torso.length_cm !== undefined && torso.length_cm !== null) {
            const lengthColumn = document.createElement('div');
            lengthColumn.className = 'measurement-column-item';
            lengthColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-ruler-vertical" title="Length"></i>
                    <span>Length</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(torso.length_cm, 'cm')}
                </div>
            `;
            torsoColumns.appendChild(lengthColumn);
        }

        // Width Column
        if (torso.width_cm !== undefined && torso.width_cm !== null) {
            const widthColumn = document.createElement('div');
            widthColumn.className = 'measurement-column-item';
            widthColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-ruler-horizontal" title="Width"></i>
                    <span>Width</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(torso.width_cm, 'cm')}
                </div>
            `;
            torsoColumns.appendChild(widthColumn);
        }

        // Depth Column
        if (torso.depth_cm !== undefined && torso.depth_cm !== null) {
            const depthColumn = document.createElement('div');
            depthColumn.className = 'measurement-column-item';
            depthColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-arrows-alt" title="Depth"></i>
                    <span>Depth</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(torso.depth_cm, 'cm')}
                    ${torso.scale !== undefined && torso.scale !== null ? this.createScaleBadge(torso.scale, 'Torso Scale') : ''}
                </div>
            `;
            torsoColumns.appendChild(depthColumn);
        }

        if (torsoColumns.children.length > 0) {
            torsoRow.appendChild(torsoColumns);
            torsoContainer.appendChild(torsoRow);
            section.appendChild(torsoContainer);
            hasContent = true;
        }

        return hasContent ? section : null;
    }

    renderHeadSection(data) {
        if (!data.Head) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-head-side-brain"></i> Head</h3>';

        let hasContent = false;
        const head = data.Head;

        const headContainer = document.createElement('div');
        headContainer.className = 'measurement-column-container';

        const headHeader = document.createElement('div');
        headHeader.className = 'measurement-group-header';
        headHeader.innerHTML = '<i class="fas fa-head-side-brain"></i> Head';
        headContainer.appendChild(headHeader);

        const headRow = document.createElement('div');
        headRow.className = 'measurement-column-row';

        const headColumns = document.createElement('div');
        headColumns.className = 'measurement-column-items';

        // Ear Type Column
        if (head.ear_type) {
            const earTypeColumn = document.createElement('div');
            earTypeColumn.className = 'measurement-column-item';
            earTypeColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-ear-listen" title="Ear Type"></i>
                    <span>Ear Type</span>
                </div>
                <div class="measurement-column-value">${head.ear_type}</div>
            `;
            headColumns.appendChild(earTypeColumn);
        }

        // Hair Color Column
        if (head.hair_color) {
            const hairColorColumn = document.createElement('div');
            hairColorColumn.className = 'measurement-column-item';
            hairColorColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-palette" title="Hair Color"></i>
                    <span>Hair Color</span>
                </div>
                <div class="measurement-column-value">${head.hair_color}</div>
            `;
            headColumns.appendChild(hairColorColumn);
        }

        // Eye Color Column
        if (head.eye_color) {
            const eyeColorColumn = document.createElement('div');
            eyeColorColumn.className = 'measurement-column-item';
            eyeColorColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-eye" title="Eye Color"></i>
                    <span>Eye Color</span>
                </div>
                <div class="measurement-column-value">${head.eye_color}</div>
            `;
            headColumns.appendChild(eyeColorColumn);
        }

        // Face Shape Column
        if (head.face_shape) {
            const faceShapeColumn = document.createElement('div');
            faceShapeColumn.className = 'measurement-column-item';
            faceShapeColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-user-circle" title="Face Shape"></i>
                    <span>Face Shape</span>
                </div>
                <div class="measurement-column-value">${head.face_shape}</div>
            `;
            headColumns.appendChild(faceShapeColumn);
        }

        // Hair Length Column
        if (head.hair_length_cm !== undefined && head.hair_length_cm !== null) {
            const hairLengthColumn = document.createElement('div');
            hairLengthColumn.className = 'measurement-column-item';
            hairLengthColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-ruler-vertical" title="Hair Length"></i>
                    <span>Hair Length</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(head.hair_length_cm, 'cm')}
                </div>
            `;
            headColumns.appendChild(hairLengthColumn);
        }

        // Ear Length Column
        if (head.ear_length_cm !== undefined && head.ear_length_cm !== null) {
            const earLengthColumn = document.createElement('div');
            earLengthColumn.className = 'measurement-column-item';
            earLengthColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-ruler-vertical" title="Ear Length"></i>
                    <span>Ear Length</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(head.ear_length_cm, 'cm')}
                </div>
            `;
            headColumns.appendChild(earLengthColumn);
        }

        // Neck Length Column
        if (head.neck_length_cm !== undefined && head.neck_length_cm !== null) {
            const neckLengthColumn = document.createElement('div');
            neckLengthColumn.className = 'measurement-column-item';
            neckLengthColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-ruler-vertical" title="Neck Length"></i>
                    <span>Neck Length</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(head.neck_length_cm, 'cm')}
                </div>
            `;
            headColumns.appendChild(neckLengthColumn);
        }

        if (headColumns.children.length > 0) {
            headRow.appendChild(headColumns);
            headContainer.appendChild(headRow);
            section.appendChild(headContainer);
            hasContent = true;
        }

        return hasContent ? section : null;
    }

    renderHeightSection(data) {
        if (!data.Height) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title">Height</h3>';

        const heightCm = data.Height.cm;
        const heightScale = data.Height.scale;

        section.innerHTML += `
            <div class="measurement-item">
                <div class="measurement-label">Height</div>
                <div class="measurement-value">${this.formatMeasurementValue(heightCm, 'cm', heightScale, 'Height Scale')}</div>
            </div>
        `;

        return section;
    }

    renderBodyWeightSection(data) {
        if (!data.Weight) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title">Body Weight</h3>';

        const weight = data.Weight;
        let hasContent = false;

        // Body weight
        if (weight.body_kg !== undefined) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">Body Weight</div>
                    <div class="measurement-value">${this.formatMeasurementValue(weight.body_kg, 'kg', weight.body_scale, 'Body Scale')}</div>
                </div>
            `;
            hasContent = true;
        }

        // Body description
        if (weight.body_description) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">Body Description</div>
                    <div class="measurement-value">${weight.body_description}</div>
                </div>
            `;
            hasContent = true;
        }

        return hasContent ? section : null;
    }

    renderStomachSection(data) {
        if (!data.Weight) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-utensils"></i> Stomach</h3>';

        const weight = data.Weight;
        let hasContent = false;

        // Stomach weight
        if (weight.stomach_kg !== undefined) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">Stomach Weight</div>
                    <div class="measurement-value">${this.formatMeasurementValue(weight.stomach_kg, 'kg', weight.stomach_scale, 'Stomach Scale')}</div>
                </div>
            `;
            hasContent = true;
        }

        // Stomach fullness
        if (weight.stomach_fullness_level !== undefined) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">Stomach Fullness</div>
                    <div class="measurement-value">${(weight.stomach_fullness_level * 100).toFixed(0)}%</div>
                </div>
            `;
            hasContent = true;
        }

        // Stomach contents
        if (weight.stomach_contents) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">Stomach Contents</div>
                    <div class="measurement-value">${weight.stomach_contents}</div>
                </div>
            `;
            hasContent = true;
        }

        return hasContent ? section : null;
    }

    renderBreastSection(data) {
        // Handle nullable Breast field
        if (!data.Breast || data.Breast === null) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-female"></i> Breast</h3>';

        const cupSize = data.Breast.cup_size;
        const protrusion = data.Breast.protrusion_cm;
        const scale = data.Breast.scale;
        const description = data.Breast.description;

        let hasContent = false;

        // Only show cup size if it exists
        if (cupSize !== undefined && cupSize !== null) {
        section.innerHTML += `
            <div class="measurement-item">
                    <div class="measurement-label">Breast Size</div>
                    <div class="measurement-value">${cupSize}</div>
            </div>
            `;
            hasContent = true;
        }

        // Only show protrusion if it exists
        if (protrusion !== undefined && protrusion !== null) {
            section.innerHTML += `
            <div class="measurement-item">
                <div class="measurement-label">Protrusion</div>
                <div class="measurement-value">${this.formatMeasurementValue(protrusion, 'cm', scale, 'Breast Scale')}</div>
            </div>
            `;
            hasContent = true;
        }

        // Show description if it exists
        if (description) {
            section.innerHTML += `
                <div class="measurement-item">
                <div class="measurement-label">Description</div>
                <div class="measurement-value">${description}</div>
                </div>
        `;
            hasContent = true;
        }

        return hasContent ? section : null;
    }

    renderArmsSection(data) {
        if (!data.Arm) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-hand-paper"></i> Arms</h3>';

        const arm = data.Arm;

        // Create compact measurement row
        const measurementRow = document.createElement('div');
        measurementRow.className = 'measurement-compact-row';

        // Arm circumference
        if (arm.circumference_cm !== undefined) {
            const item = document.createElement('div');
            item.className = 'measurement-compact-item';
            item.innerHTML = `
                <i class="fas fa-circle" title="Arm"></i>
                <span class="measurement-compact-value">${this.formatMeasurementValue(arm.circumference_cm, 'cm')}</span>
                ${arm.scale !== undefined ? this.createScaleBadge(arm.scale, 'Arm Scale') : ''}
            `;
            measurementRow.appendChild(item);
        }

        // Arm length
        if (arm.length_cm !== undefined) {
            const item = document.createElement('div');
            item.className = 'measurement-compact-item';
            item.innerHTML = `
                <i class="fas fa-ruler-vertical" title="Length"></i>
                <span class="measurement-compact-value">${this.formatMeasurementValue(arm.length_cm, 'cm')}</span>
            `;
            measurementRow.appendChild(item);
        }

        // Shoulder width
        if (arm.shoulder_width_cm !== undefined) {
            const item = document.createElement('div');
            item.className = 'measurement-compact-item';
            item.innerHTML = `
                <i class="fas fa-ruler-horizontal" title="Shoulders"></i>
                <span class="measurement-compact-value">${this.formatMeasurementValue(arm.shoulder_width_cm, 'cm')}</span>
            `;
            measurementRow.appendChild(item);
        }

        if (measurementRow.children.length > 0) {
            section.appendChild(measurementRow);
            return section;
        }

        return null;
    }

    renderIndividualHipsSection(data) {
        if (!data.Hips) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-bone"></i> Hips</h3>';

        const hips = data.Hips;

        // Create compact measurement row
        const measurementRow = document.createElement('div');
        measurementRow.className = 'measurement-compact-row';

        // Hips measurements
        if (hips.hips_circumference_cm !== undefined) {
            const item = document.createElement('div');
            item.className = 'measurement-compact-item';
            item.innerHTML = `
                <i class="fas fa-circle" title="Circumference"></i>
                <span class="measurement-compact-value">${this.formatMeasurementValue(hips.hips_circumference_cm, 'cm')}</span>
                ${hips.hips_scale !== undefined ? this.createScaleBadge(hips.hips_scale, 'Hips Scale') : ''}
            `;
            measurementRow.appendChild(item);
        }

        if (hips.hips_width_cm !== undefined) {
            const item = document.createElement('div');
            item.className = 'measurement-compact-item';
            item.innerHTML = `
                <i class="fas fa-ruler-horizontal" title="Width"></i>
                <span class="measurement-compact-value">${this.formatMeasurementValue(hips.hips_width_cm, 'cm')}</span>
            `;
            measurementRow.appendChild(item);
        }

        if (hips.hips_depth_cm !== undefined) {
            const item = document.createElement('div');
            item.className = 'measurement-compact-item';
            item.innerHTML = `
                <i class="fas fa-arrow-up-to-line" title="Depth"></i>
                <span class="measurement-compact-value">${this.formatMeasurementValue(hips.hips_depth_cm, 'cm')}</span>
            `;
            measurementRow.appendChild(item);
        }

        // Waist measurements
        if (hips.waist_circumference_cm !== undefined) {
            const item = document.createElement('div');
            item.className = 'measurement-compact-item';
            item.innerHTML = `
                <i class="fas fa-circle" title="Waist"></i>
                <span class="measurement-compact-value">${this.formatMeasurementValue(hips.waist_circumference_cm, 'cm')}</span>
                ${hips.waist_scale !== undefined ? this.createScaleBadge(hips.waist_scale, 'Waist Scale') : ''}
            `;
            measurementRow.appendChild(item);
        }

        // Ass measurements
        if (hips.ass_circumference_cm !== undefined) {
            const item = document.createElement('div');
            item.className = 'measurement-compact-item';
            item.innerHTML = `
                <i class="fas fa-circle" title="Ass"></i>
                <span class="measurement-compact-value">${this.formatMeasurementValue(hips.ass_circumference_cm, 'cm')}</span>
                ${hips.ass_scale !== undefined ? this.createScaleBadge(hips.ass_scale, 'Ass Scale') : ''}
            `;
            measurementRow.appendChild(item);
        }

        // Ratios
        if (hips.chest_to_waist_ratio !== undefined || hips.waist_to_hip_ratio !== undefined) {
            const ratioItem = document.createElement('div');
            ratioItem.className = 'measurement-ratio-item';
            let ratioText = '';
            if (hips.chest_to_waist_ratio !== undefined) {
                ratioText += `C/W: ${hips.chest_to_waist_ratio.toFixed(2)}`;
            }
            if (hips.waist_to_hip_ratio !== undefined) {
                if (ratioText) ratioText += ' | ';
                ratioText += `W/H: ${hips.waist_to_hip_ratio.toFixed(2)}`;
            }
            ratioItem.innerHTML = `<i class="fas fa-balance-scale" title="Ratios"></i> <span>${ratioText}</span>`;
            measurementRow.appendChild(ratioItem);
        }

        if (measurementRow.children.length > 0) {
            section.appendChild(measurementRow);
            return section;
        }

        return null;
    }

    renderIndividualLegsSection(data) {
        if (!data.Legs) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-running"></i> Legs</h3>';

        const legs = data.Legs;

        // Create compact measurement row
        const measurementRow = document.createElement('div');
        measurementRow.className = 'measurement-compact-row';

        // Leg measurements
        if (legs.leg_length_cm !== undefined) {
            const item = document.createElement('div');
            item.className = 'measurement-compact-item';
            item.innerHTML = `
                <i class="fas fa-ruler-vertical" title="Length"></i>
                <span class="measurement-compact-value">${this.formatMeasurementValue(legs.leg_length_cm, 'cm')}</span>
            `;
            measurementRow.appendChild(item);
        }

        // Thigh measurements
        if (legs.thigh_circumference_cm !== undefined) {
            const item = document.createElement('div');
            item.className = 'measurement-compact-item';
            item.innerHTML = `
                <i class="fas fa-circle" title="Thigh"></i>
                <span class="measurement-compact-value">${this.formatMeasurementValue(legs.thigh_circumference_cm, 'cm')}</span>
                ${legs.thigh_scale !== undefined ? this.createScaleBadge(legs.thigh_scale, 'Thigh Scale') : ''}
            `;
            measurementRow.appendChild(item);
        }

        // Calf measurements
        if (legs.calf_circumference_cm !== undefined) {
            const item = document.createElement('div');
            item.className = 'measurement-compact-item';
            item.innerHTML = `
                <i class="fas fa-circle" title="Calf"></i>
                <span class="measurement-compact-value">${this.formatMeasurementValue(legs.calf_circumference_cm, 'cm')}</span>
                ${legs.calf_scale !== undefined ? this.createScaleBadge(legs.calf_scale, 'Calf Scale') : ''}
            `;
            measurementRow.appendChild(item);
        }


        if (measurementRow.children.length > 0) {
            section.appendChild(measurementRow);
            return section;
        }

        return null;
    }

    renderUpperBodySection(data) {
        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-skeleton-ribs"></i> Upper Body</h3>';

        let hasContent = false;

        // Arm data
        if (data.Arm) {
            const arm = data.Arm;

            // Arm measurements (column layout)
            const armContainer = document.createElement('div');
            armContainer.className = 'measurement-column-container';

            // Add header for arm group
            const armHeader = document.createElement('div');
            armHeader.className = 'measurement-group-header';
            armHeader.innerHTML = '<i class="fas fa-hand-paper"></i> Arms';
            armContainer.appendChild(armHeader);

            const armRow = document.createElement('div');
            armRow.className = 'measurement-column-row';

            const armColumns = document.createElement('div');
            armColumns.className = 'measurement-column-items';

            // Circumference Column
            if (arm.circumference_cm !== undefined && arm.circumference_cm !== null) {
                const circColumn = document.createElement('div');
                circColumn.className = 'measurement-column-item';
                circColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fa-regular fa-circle" title="Circumference"></i>
                        <span>Arm</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(arm.circumference_cm, 'cm')}
                        ${arm.scale !== undefined && arm.scale !== null ? this.createScaleBadge(arm.scale, 'Arm Scale') : ''}
                    </div>
                `;
                armColumns.appendChild(circColumn);
            }

            // Length Column
            if (arm.length_cm !== undefined && arm.length_cm !== null) {
                const lengthColumn = document.createElement('div');
                lengthColumn.className = 'measurement-column-item';
                lengthColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-ruler-vertical" title="Length"></i>
                        <span>Length</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(arm.length_cm, 'cm')}
                    </div>
                `;
                armColumns.appendChild(lengthColumn);
            }

            // Shoulder Width Column
            if (arm.shoulder_width_cm !== undefined && arm.shoulder_width_cm !== null) {
                const shoulderColumn = document.createElement('div');
                shoulderColumn.className = 'measurement-column-item';
                shoulderColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-ruler-horizontal" title="Shoulder Width"></i>
                        <span>Shoulders</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(arm.shoulder_width_cm, 'cm')}
                    </div>
                `;
                armColumns.appendChild(shoulderColumn);
            }

            if (armColumns.children.length > 0) {
                armRow.appendChild(armColumns);
                armContainer.appendChild(armRow);
                section.appendChild(armContainer);
                hasContent = true;
            }
        }

        // Torso data
        if (data.Torso) {
            const torso = data.Torso;

            const torsoContainer = document.createElement('div');
            torsoContainer.className = 'measurement-column-container';

            const torsoHeader = document.createElement('div');
            torsoHeader.className = 'measurement-group-header';
            torsoHeader.innerHTML = '<i class="fas fa-ribbon"></i> Torso';
            torsoContainer.appendChild(torsoHeader);

            const torsoRow = document.createElement('div');
            torsoRow.className = 'measurement-column-row';

            const torsoColumns = document.createElement('div');
            torsoColumns.className = 'measurement-column-items';

            // Length Column
            if (torso.length_cm !== undefined && torso.length_cm !== null) {
                const lengthColumn = document.createElement('div');
                lengthColumn.className = 'measurement-column-item';
                lengthColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-ruler-vertical" title="Length"></i>
                        <span>Length</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(torso.length_cm, 'cm')}
                    </div>
                `;
                torsoColumns.appendChild(lengthColumn);
            }

            // Width Column
            if (torso.width_cm !== undefined && torso.width_cm !== null) {
                const widthColumn = document.createElement('div');
                widthColumn.className = 'measurement-column-item';
                widthColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-ruler-horizontal" title="Width"></i>
                        <span>Width</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(torso.width_cm, 'cm')}
                    </div>
                `;
                torsoColumns.appendChild(widthColumn);
            }

            // Depth Column
            if (torso.depth_cm !== undefined && torso.depth_cm !== null) {
                const depthColumn = document.createElement('div');
                depthColumn.className = 'measurement-column-item';
                depthColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-arrows-alt" title="Depth"></i>
                        <span>Depth</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(torso.depth_cm, 'cm')}
                        ${torso.scale !== undefined && torso.scale !== null ? this.createScaleBadge(torso.scale, 'Torso Scale') : ''}
                    </div>
                `;
                torsoColumns.appendChild(depthColumn);
            }

            if (torsoColumns.children.length > 0) {
                torsoRow.appendChild(torsoColumns);
                torsoContainer.appendChild(torsoRow);
                section.appendChild(torsoContainer);
                hasContent = true;
            }
        }

        // Head data
        if (data.Head) {
            const head = data.Head;

            const headContainer = document.createElement('div');
            headContainer.className = 'measurement-column-container';

            const headHeader = document.createElement('div');
            headHeader.className = 'measurement-group-header';
            headHeader.innerHTML = '<i class="fas fa-head-side-brain"></i> Head';
            headContainer.appendChild(headHeader);

            const headRow = document.createElement('div');
            headRow.className = 'measurement-column-row';

            const headColumns = document.createElement('div');
            headColumns.className = 'measurement-column-items';

            // Ear Type Column
            if (head.ear_type) {
                const earTypeColumn = document.createElement('div');
                earTypeColumn.className = 'measurement-column-item';
                earTypeColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-ear-listen" title="Ear Type"></i>
                        <span>Ear Type</span>
                    </div>
                    <div class="measurement-column-value">${head.ear_type}</div>
                `;
                headColumns.appendChild(earTypeColumn);
            }

            // Hair Color Column
            if (head.hair_color) {
                const hairColorColumn = document.createElement('div');
                hairColorColumn.className = 'measurement-column-item';
                hairColorColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-palette" title="Hair Color"></i>
                        <span>Hair Color</span>
                    </div>
                    <div class="measurement-column-value">${head.hair_color}</div>
                `;
                headColumns.appendChild(hairColorColumn);
            }

            // Eye Color Column
            if (head.eye_color) {
                const eyeColorColumn = document.createElement('div');
                eyeColorColumn.className = 'measurement-column-item';
                eyeColorColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-eye" title="Eye Color"></i>
                        <span>Eye Color</span>
                    </div>
                    <div class="measurement-column-value">${head.eye_color}</div>
                `;
                headColumns.appendChild(eyeColorColumn);
            }

            // Face Shape Column
            if (head.face_shape) {
                const faceShapeColumn = document.createElement('div');
                faceShapeColumn.className = 'measurement-column-item';
                faceShapeColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-user-circle" title="Face Shape"></i>
                        <span>Face Shape</span>
                    </div>
                    <div class="measurement-column-value">${head.face_shape}</div>
                `;
                headColumns.appendChild(faceShapeColumn);
            }

            // Hair Length Column
            if (head.hair_length_cm !== undefined) {
                const hairLengthColumn = document.createElement('div');
                hairLengthColumn.className = 'measurement-column-item';
                hairLengthColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-ruler-vertical" title="Hair Length"></i>
                        <span>Hair Length</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(head.hair_length_cm, 'cm')}
                    </div>
                `;
                headColumns.appendChild(hairLengthColumn);
            }

            // Ear Length Column
            if (head.ear_length_cm !== undefined) {
                const earLengthColumn = document.createElement('div');
                earLengthColumn.className = 'measurement-column-item';
                earLengthColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-ruler-vertical" title="Ear Length"></i>
                        <span>Ear Length</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(head.ear_length_cm, 'cm')}
                    </div>
                `;
                headColumns.appendChild(earLengthColumn);
            }

            // Neck Length Column
            if (head.neck_length_cm !== undefined) {
                const neckLengthColumn = document.createElement('div');
                neckLengthColumn.className = 'measurement-column-item';
                neckLengthColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-ruler-vertical" title="Neck Length"></i>
                        <span>Neck Length</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(head.neck_length_cm, 'cm')}
                    </div>
                `;
                headColumns.appendChild(neckLengthColumn);
            }

            if (headColumns.children.length > 0) {
                headRow.appendChild(headColumns);
                headContainer.appendChild(headRow);
                section.appendChild(headContainer);
                hasContent = true;
            }
        }

        return hasContent ? section : null;
    }

    renderHipsSection(data) {
        if (!data.Hips) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-bone"></i> Hips</h3>';

        let hasContent = false;

        // Individual body part measurements
        if (data.Hips) {
            const hips = data.Hips;

            // Hips measurements - column layout
            const hipsContainer = document.createElement('div');
            hipsContainer.className = 'measurement-column-container';

            // Add header for hips group
            const hipsHeader = document.createElement('div');
            hipsHeader.className = 'measurement-group-header';
            hipsHeader.innerHTML = '<i class="fas fa-bone" title="Hips"></i> Hips';
            hipsContainer.appendChild(hipsHeader);

                const hipsRow = document.createElement('div');
            hipsRow.className = 'measurement-column-row';

            const hipsColumns = document.createElement('div');
            hipsColumns.className = 'measurement-column-items';

            // Circumference Column
            if (hips.hips_circumference_cm !== undefined && hips.hips_circumference_cm !== null) {
                const circColumn = document.createElement('div');
                circColumn.className = 'measurement-column-item';
                circColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fa-regular fa-circle" title="Circumference"></i>
                        <span>Hips</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(hips.hips_circumference_cm, 'cm')}
                        ${hips.hips_scale !== undefined && hips.hips_scale !== null ? this.createScaleBadge(hips.hips_scale, 'Hips Scale') : ''}
                    </div>
                `;
                hipsColumns.appendChild(circColumn);
            }

            // Width Column
            if (hips.hips_width_cm !== undefined && hips.hips_width_cm !== null) {
                const widthColumn = document.createElement('div');
                widthColumn.className = 'measurement-column-item';
                widthColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-ruler-horizontal" title="Width"></i>
                        <span>Width</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(hips.hips_width_cm, 'cm')}
                    </div>
                `;
                hipsColumns.appendChild(widthColumn);
            }

            // Depth Column
            if (hips.hips_depth_cm !== undefined && hips.hips_depth_cm !== null) {
                const depthColumn = document.createElement('div');
                depthColumn.className = 'measurement-column-item';
                depthColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-arrow-up-to-line" title="Depth"></i>
                        <span>Depth</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(hips.hips_depth_cm, 'cm')}
                    </div>
                `;
                hipsColumns.appendChild(depthColumn);
            }

            if (hipsColumns.children.length > 0) {
                hipsRow.appendChild(hipsColumns);
                hipsContainer.appendChild(hipsRow);
                section.appendChild(hipsContainer);
                hasContent = true;
            }

            // Waist measurements - column layout
            const waistContainer = document.createElement('div');
            waistContainer.className = 'measurement-column-container';

            // Add header for waist group
            const waistHeader = document.createElement('div');
            waistHeader.className = 'measurement-group-header';
            waistHeader.innerHTML = '<i class="fas fa-circle" title="Waist"></i> Waist';
            waistContainer.appendChild(waistHeader);

                const waistRow = document.createElement('div');
            waistRow.className = 'measurement-column-row';

            const waistColumns = document.createElement('div');
            waistColumns.className = 'measurement-column-items';

            // Circumference Column
            if (hips.waist_circumference_cm !== undefined && hips.waist_circumference_cm !== null) {
                const circColumn = document.createElement('div');
                circColumn.className = 'measurement-column-item';
                circColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fa-regular fa-circle" title="Circumference"></i>
                        <span>Size</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(hips.waist_circumference_cm, 'cm')}
                        ${hips.waist_scale !== undefined && hips.waist_scale !== null ? this.createScaleBadge(hips.waist_scale, 'Waist Scale') : ''}
                    </div>
                `;
                waistColumns.appendChild(circColumn);
            }

            // Width Column
            if (hips.waist_width_cm !== undefined && hips.waist_width_cm !== null) {
                const widthColumn = document.createElement('div');
                widthColumn.className = 'measurement-column-item';
                widthColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-ruler-horizontal" title="Width"></i>
                        <span>Width</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(hips.waist_width_cm, 'cm')}
                    </div>
                `;
                waistColumns.appendChild(widthColumn);
            }

            // Depth Column
            if (hips.waist_depth_cm !== undefined && hips.waist_depth_cm !== null) {
                const depthColumn = document.createElement('div');
                depthColumn.className = 'measurement-column-item';
                depthColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-arrow-up-to-line" title="Depth"></i>
                        <span>Depth</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(hips.waist_depth_cm, 'cm')}
                    </div>
                `;
                waistColumns.appendChild(depthColumn);
            }

            if (waistColumns.children.length > 0) {
                waistRow.appendChild(waistColumns);
                waistContainer.appendChild(waistRow);
                section.appendChild(waistContainer);
                hasContent = true;
            }

            // Ass measurements - column layout
            const assContainer = document.createElement('div');
            assContainer.className = 'measurement-column-container';

            // Add header for ass group
            const assHeader = document.createElement('div');
            assHeader.className = 'measurement-group-header';
            assHeader.innerHTML = '<i class="fas fa-circle" title="Ass"></i> Ass';
            assContainer.appendChild(assHeader);

                const assRow = document.createElement('div');
            assRow.className = 'measurement-column-row';

            const assColumns = document.createElement('div');
            assColumns.className = 'measurement-column-items';

            // Circumference Column
            if (hips.ass_circumference_cm !== undefined && hips.ass_circumference_cm !== null) {
                const circColumn = document.createElement('div');
                circColumn.className = 'measurement-column-item';
                circColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fa-regular fa-circle" title="Circumference"></i>
                        <span>Size</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(hips.ass_circumference_cm, 'cm')}
                        ${hips.ass_scale !== undefined && hips.ass_scale !== null ? this.createScaleBadge(hips.ass_scale, 'Ass Scale') : ''}
                    </div>
                `;
                assColumns.appendChild(circColumn);
            }

            // Width Column
            if (hips.ass_width_cm !== undefined && hips.ass_width_cm !== null) {
                const widthColumn = document.createElement('div');
                widthColumn.className = 'measurement-column-item';
                widthColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-ruler-horizontal" title="Width"></i>
                        <span>Width</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(hips.ass_width_cm, 'cm')}
                    </div>
                `;
                assColumns.appendChild(widthColumn);
            }

            // Depth Column
            if (hips.ass_depth_cm !== undefined && hips.ass_depth_cm !== null) {
                const depthColumn = document.createElement('div');
                depthColumn.className = 'measurement-column-item';
                depthColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-arrow-up-to-line" title="Depth"></i>
                        <span>Depth</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(hips.ass_depth_cm, 'cm')}
                    </div>
                `;
                assColumns.appendChild(depthColumn);
            }

            if (assColumns.children.length > 0) {
                assRow.appendChild(assColumns);
                assContainer.appendChild(assRow);
                section.appendChild(assContainer);
                hasContent = true;
            }

            // Ratios row
            if ((hips.chest_to_waist_ratio !== undefined && hips.chest_to_waist_ratio !== null) || 
                (hips.waist_to_hip_ratio !== undefined && hips.waist_to_hip_ratio !== null)) {
                const ratioRow = document.createElement('div');
                ratioRow.className = 'measurement-compact-row';
                ratioRow.innerHTML = '<div class="measurement-row-header">Ratios</div>';

                const ratioItems = document.createElement('div');
                ratioItems.className = 'measurement-row-items';

                let ratioText = '';
                if (hips.chest_to_waist_ratio !== undefined && hips.chest_to_waist_ratio !== null) {
                    ratioText += `C/W: ${hips.chest_to_waist_ratio.toFixed(2)}`;
                }
                if (hips.waist_to_hip_ratio !== undefined && hips.waist_to_hip_ratio !== null) {
                    if (ratioText) ratioText += ' | ';
                    ratioText += `W/H: ${hips.waist_to_hip_ratio.toFixed(2)}`;
                }

                const ratioItem = document.createElement('div');
                ratioItem.className = 'measurement-compact-item';
                ratioItem.innerHTML = `
                    <i class="fas fa-balance-scale" title="Body Ratios"></i>
                    <span class="measurement-compact-value">${ratioText}</span>
                `;
                ratioItems.appendChild(ratioItem);

                ratioRow.appendChild(ratioItems);
                section.appendChild(ratioRow);
                hasContent = true;
            }
        }

        // Legs data
        if (data.Legs) {
            const legs = data.Legs;

            // Combined Leg measurements - single row with all measurements
            const legContainer = document.createElement('div');
            legContainer.className = 'measurement-column-container';

            // Add header for legs group
            const legHeader = document.createElement('div');
            legHeader.className = 'measurement-group-header';
            legHeader.innerHTML = '<i class="fas fa-running"></i> Legs';
            legContainer.appendChild(legHeader);

                const legRow = document.createElement('div');
            legRow.className = 'measurement-column-row';

            const legColumns = document.createElement('div');
            legColumns.className = 'measurement-column-items';

            // Leg Length Column
            if (legs.leg_length_cm !== undefined) {
                const lengthColumn = document.createElement('div');
                lengthColumn.className = 'measurement-column-item';
                lengthColumn.innerHTML = `
                    <div class="measurement-column-label">
                    <i class="fas fa-ruler-vertical" title="Length"></i>
                        <span>Length</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(legs.leg_length_cm, 'cm')}
                    </div>
                `;
                legColumns.appendChild(lengthColumn);
            }

            // Thigh Circumference Column
            if (legs.thigh_circumference_cm !== undefined) {
                const thighCircColumn = document.createElement('div');
                thighCircColumn.className = 'measurement-column-item';
                thighCircColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fa-regular fa-circle" title="Thigh Circumference"></i>
                        <span>Thigh</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(legs.thigh_circumference_cm, 'cm')}
                        ${legs.thigh_scale !== undefined ? this.createScaleBadge(legs.thigh_scale, 'Thigh Scale') : ''}
                    </div>
                `;
                legColumns.appendChild(thighCircColumn);
            }

            // Calf Circumference Column
            if (legs.calf_circumference_cm !== undefined) {
                const calfCircColumn = document.createElement('div');
                calfCircColumn.className = 'measurement-column-item';
                calfCircColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fa-regular fa-circle" title="Calf Circumference"></i>
                        <span>Calf</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(legs.calf_circumference_cm, 'cm')}
                        ${legs.calf_scale !== undefined ? this.createScaleBadge(legs.calf_scale, 'Calf Scale') : ''}
                    </div>
                `;
                legColumns.appendChild(calfCircColumn);
            }

            // Thigh Separation Column
            if (legs.thigh_separation_cm !== undefined) {
                const sepColumn = document.createElement('div');
                sepColumn.className = 'measurement-column-item';
                sepColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-ruler-horizontal" title="Separation"></i>
                        <span>Separation</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(legs.thigh_separation_cm, 'cm')}
                    </div>
                `;
                legColumns.appendChild(sepColumn);
            }

            if (legColumns.children.length > 0) {
                legRow.appendChild(legColumns);
                legContainer.appendChild(legRow);
                section.appendChild(legContainer);
                hasContent = true;
            }
        }

        return hasContent ? section : null;
    }

    renderLegsSection(data) {
        if (!data.Legs) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-running"></i> Legs</h3>';

        let hasContent = false;
        const legs = data.Legs;

        // Leg measurements - column layout
        const legContainer = document.createElement('div');
        legContainer.className = 'measurement-column-container';

        // Add header for leg group
        const legHeader = document.createElement('div');
        legHeader.className = 'measurement-group-header';
        legHeader.innerHTML = '<i class="fas fa-running" title="Legs"></i> Legs';
        legContainer.appendChild(legHeader);

        const legRow = document.createElement('div');
        legRow.className = 'measurement-column-row';

        const legColumns = document.createElement('div');
        legColumns.className = 'measurement-column-items';

        // Leg Length Column
        if (legs.leg_length_cm !== undefined && legs.leg_length_cm !== null) {
            const lengthColumn = document.createElement('div');
            lengthColumn.className = 'measurement-column-item';
            lengthColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-ruler-vertical" title="Leg Length"></i>
                    <span>Length</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(legs.leg_length_cm, 'cm')}
                    ${legs.leg_scale !== undefined && legs.leg_scale !== null ? this.createScaleBadge(legs.leg_scale, 'Leg Scale') : ''}
                </div>
            `;
            legColumns.appendChild(lengthColumn);
        }

        // Thigh Circumference Column
        if (legs.thigh_circumference_cm !== undefined && legs.thigh_circumference_cm !== null) {
            const thighColumn = document.createElement('div');
            thighColumn.className = 'measurement-column-item';
            thighColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fa-regular fa-circle" title="Thigh Circumference"></i>
                    <span>Thigh</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(legs.thigh_circumference_cm, 'cm')}
                    ${legs.thigh_scale !== undefined && legs.thigh_scale !== null ? this.createScaleBadge(legs.thigh_scale, 'Thigh Scale') : ''}
                </div>
            `;
            legColumns.appendChild(thighColumn);
        }

        // Thigh Separation Column
        if (legs.thigh_separation_cm !== undefined && legs.thigh_separation_cm !== null) {
            const separationColumn = document.createElement('div');
            separationColumn.className = 'measurement-column-item';
            separationColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-arrows-alt-h" title="Thigh Separation"></i>
                    <span>Separation</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(legs.thigh_separation_cm, 'cm')}
                </div>
            `;
            legColumns.appendChild(separationColumn);
        }

        // Calf Circumference Column
        if (legs.calf_circumference_cm !== undefined && legs.calf_circumference_cm !== null) {
            const calfColumn = document.createElement('div');
            calfColumn.className = 'measurement-column-item';
            calfColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fa-regular fa-circle" title="Calf Circumference"></i>
                    <span>Calf</span>
                </div>
                <div class="measurement-column-value">
                    ${this.formatMeasurementValue(legs.calf_circumference_cm, 'cm')}
                    ${legs.calf_scale !== undefined && legs.calf_scale !== null ? this.createScaleBadge(legs.calf_scale, 'Calf Scale') : ''}
                </div>
            `;
            legColumns.appendChild(calfColumn);
        }

        if (legColumns.children.length > 0) {
            legRow.appendChild(legColumns);
            legContainer.appendChild(legRow);
            section.appendChild(legContainer);
            hasContent = true;
        }

        return hasContent ? section : null;
    }

    renderPregnancySection(data) {
        if (!data.ReproductiveSystem || !data.ReproductiveSystem.reproductive_state) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section pregnancy-section';
        section.innerHTML = '<h3 class="measurement-section-title pregnancy-title"><i class="fas fa-baby-carriage"></i> Pregnancy</h3>';

        const repro = data.ReproductiveSystem;
        const state = repro.reproductive_state;
        let hasContent = false;

        // Check if this is a pregnancy-related state
        const pregnancyStates = [
            'early_trimester_pregnancy',
            'active_pregnancy',
            'final_trimester_pregnancy',
            'impending_labor',
            'active_labor',
            'active_birthing',
            'blocked_birthing',
            'postpartum',
            'unbirthing',
            'vore_pregnancy'
        ];

        const isPregnancyState = pregnancyStates.includes(state.state) ||
                                state.pregnancy_count > 0 ||
                                state.pregnancy_scale > 0;

        if (!isPregnancyState) return null;

        // Reproductive state description
        if (state.description) {
            section.innerHTML += `
                <div class="measurement-description-row">
                    <div class="measurement-description-label">Reproductive State</div>
                    <div class="measurement-description-text">${state.description}</div>
                </div>
            `;
            hasContent = true;
        }

        // Pregnancy details in column layout
        const pregnancyContainer = document.createElement('div');
        pregnancyContainer.className = 'measurement-column-container';

        // Add header for pregnancy details
        const pregnancyHeader = document.createElement('div');
        pregnancyHeader.className = 'measurement-group-header';
        pregnancyHeader.innerHTML = '<i class="fas fa-info-circle"></i> Pregnancy Details';
        pregnancyContainer.appendChild(pregnancyHeader);

        const pregnancyRow = document.createElement('div');
        pregnancyRow.className = 'measurement-column-row';

        const pregnancyColumns = document.createElement('div');
        pregnancyColumns.className = 'measurement-column-items';

        // Pregnancy State Column
        const stateDescriptions = {
            'early_trimester_pregnancy': 'Early Pregnancy',
            'active_pregnancy': 'Active Pregnancy',
            'final_trimester_pregnancy': 'Final Trimester',
            'impending_labor': 'Impending Labor',
            'active_labor': 'Active Labor',
            'active_birthing': 'Active Birthing',
            'blocked_birthing': 'Blocked Birthing',
            'postpartum': 'Postpartum',
            'unbirthing': 'Unbirthing',
            'vore_pregnancy': 'Vore Pregnancy'
        };

        if (state.state && pregnancyStates.includes(state.state)) {
            const stateColumn = document.createElement('div');
            stateColumn.className = 'measurement-column-item';
            stateColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-heartbeat" title="Pregnancy State"></i>
                    <span>State</span>
                </div>
                <div class="measurement-column-value">
                    ${stateDescriptions[state.state] || state.state}
                </div>
            `;
            pregnancyColumns.appendChild(stateColumn);
        }

        // Baby Count Column (with womb scale)
        if (state.pregnancy_count !== undefined && state.pregnancy_count !== null) {
            const countColumn = document.createElement('div');
            countColumn.className = 'measurement-column-item';
            const wombScaleHtml = state.pregnancy_scale !== undefined && state.pregnancy_scale !== null
                ? ` <span class="measurement-scale-badge" style="background-color: rgba(220, 53, 69, ${Math.min(state.pregnancy_scale, 1.0) * 0.6});" title="Womb Scale: ${state.pregnancy_scale.toFixed(2)}">${state.pregnancy_scale.toFixed(2)}</span>`
                : '';
            countColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-baby" title="Baby Count"></i>
                    <span>Babies</span>
                </div>
                <div class="measurement-column-value">
                    ${state.pregnancy_count}${wombScaleHtml}
                </div>
            `;
            pregnancyColumns.appendChild(countColumn);
        }

        // Pregnancy Scale is now shown next to baby count (above)

        // Trimester Column
        if (state.pregnancy_trimester !== undefined && state.pregnancy_trimester !== null) {
            const trimesterColumn = document.createElement('div');
            trimesterColumn.className = 'measurement-column-item';
            trimesterColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-calendar-alt" title="Trimester"></i>
                    <span>Trimester</span>
                </div>
                <div class="measurement-column-value">
                    ${state.pregnancy_trimester}${state.pregnancy_trimester === 1 ? 'st' : state.pregnancy_trimester === 2 ? 'nd' : state.pregnancy_trimester === 3 ? 'rd' : 'th'}
                </div>
            `;
            pregnancyColumns.appendChild(trimesterColumn);
        }

        // Weeks Column
        if (state.pregnancy_weeks !== undefined && state.pregnancy_weeks !== null) {
            const weeksColumn = document.createElement('div');
            weeksColumn.className = 'measurement-column-item';
            weeksColumn.innerHTML = `
                <div class="measurement-column-label">
                    <i class="fas fa-clock" title="Weeks"></i>
                    <span>Weeks</span>
                </div>
                <div class="measurement-column-value">
                    ${state.pregnancy_weeks}
                </div>
            `;
            pregnancyColumns.appendChild(weeksColumn);
        }

        if (pregnancyColumns.children.length > 0) {
            pregnancyRow.appendChild(pregnancyColumns);
            pregnancyContainer.appendChild(pregnancyRow);
            section.appendChild(pregnancyContainer);
                hasContent = true;
            }

        // Baby details as badges
        if (state.pregnancy_names && state.pregnancy_names.length > 0) {
            const babyContainer = document.createElement('div');
            babyContainer.className = 'measurement-description-row';

            const babyLabel = document.createElement('div');
            babyLabel.className = 'measurement-description-label';
            babyLabel.textContent = 'Baby Names';
            babyContainer.appendChild(babyLabel);

            const babyBadges = document.createElement('div');
            babyBadges.className = 'baby-badges-container';

            state.pregnancy_names.forEach((name, index) => {
                const gender = state.pregnancy_genders && state.pregnancy_genders[index] ? state.pregnancy_genders[index] : 'other';

                let genderIcon = 'fas fa-genderless';
                let badgeClass = 'baby-badge-neutral';

                if (gender === 'female') {
                    genderIcon = 'fas fa-venus';
                    badgeClass = 'baby-badge-female';
                } else if (gender === 'male') {
                    genderIcon = 'fas fa-mars';
                    badgeClass = 'baby-badge-male';
                }

                const badge = document.createElement('div');
                badge.className = `baby-badge ${badgeClass}`;
                badge.innerHTML = `
                    <i class="${genderIcon}"></i>
                    <span class="baby-name">${name}</span>
                `;
                babyBadges.appendChild(badge);
            });

            babyContainer.appendChild(babyBadges);
            section.appendChild(babyContainer);
            hasContent = true;
        }

        return hasContent ? section : null;
    }

    renderReproductiveSystemSection(data) {
        if (!data.ReproductiveSystem) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section reproductive-section';
        section.innerHTML = '<h3 class="measurement-section-title reproductive-title"><i class="fas fa-venus-mars"></i> Reproductive System</h3>';

        const repro = data.ReproductiveSystem;
        let hasContent = false;

        // General description (full width row)
        if (repro.description) {
            section.innerHTML += `
                <div class="measurement-description-row">
                    <div class="measurement-description-label">Description</div>
                    <div class="measurement-description-text">${repro.description}</div>
                </div>
            `;
            hasContent = true;
        }

        // Biological sex type
        if (repro.type) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">Biological Sex</div>
                    <div class="measurement-value">${repro.type.charAt(0).toUpperCase() + repro.type.slice(1)}</div>
                </div>
            `;
            hasContent = true;
        }

        // Fetish names
        if (repro.fetish_names && Array.isArray(repro.fetish_names) && repro.fetish_names.length > 0) {
            section.innerHTML += `
                <div class="measurement-description-row">
                    <div class="measurement-description-label">Fetishes</div>
                    <div class="measurement-description-text">${repro.fetish_names.join(', ')}</div>
                </div>
            `;
            hasContent = true;
        }

        // Pleasure level with small inline gauge
        if (repro.pleaseure_level !== undefined && repro.pleaseure_level !== null) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">
                        <i class="fas fa-heart"></i> Pleasure Level
                    </div>
                    <div class="measurement-value">
                        ${repro.pleaseure_level.toFixed(1)}/10 ${this.createSmallGauge(repro.pleaseure_level, 10, 'gauge-pleasure')}
                    </div>
                </div>
            `;
            hasContent = true;
        }

        // Male Anatomy - column layout (show if has values)
        if (repro.penis_length_cm !== undefined || repro.penis_erectness !== undefined || repro.genital_size !== undefined || repro.genital_scale !== undefined) {
            const maleContainer = document.createElement('div');
            maleContainer.className = 'measurement-column-container';

            // Add header for male anatomy group
            const maleHeader = document.createElement('div');
            maleHeader.className = 'measurement-group-header';
            maleHeader.innerHTML = '<i class="fas fa-mars"></i> Male Anatomy';
            maleContainer.appendChild(maleHeader);

            const maleRow = document.createElement('div');
            maleRow.className = 'measurement-column-row';

            const maleColumns = document.createElement('div');
            maleColumns.className = 'measurement-column-items';

            // Penis Length Column
            if (repro.penis_length_cm !== undefined) {
                const lengthColumn = document.createElement('div');
                lengthColumn.className = 'measurement-column-item';
                lengthColumn.innerHTML = `
                    <div class="measurement-column-label">
                    <i class="fas fa-ruler-vertical" title="Penis Length"></i>
                        <span>Length</span>
                    </div>
                    <div class="measurement-column-value">
                        ${this.formatMeasurementValue(repro.penis_length_cm, 'cm')}
                    </div>
                `;
                maleColumns.appendChild(lengthColumn);
            }

            // Erection Level Column
            if (repro.penis_erectness !== undefined && repro.penis_erectness !== null) {
                const erectionColumn = document.createElement('div');
                erectionColumn.className = 'measurement-column-item';
                erectionColumn.innerHTML = `
                    <div class="measurement-column-label">
                    <i class="fas fa-thermometer-half" title="Erection Level"></i>
                        <span>Erection</span>
                    </div>
                    <div class="measurement-column-value">
                        ${(repro.penis_erectness * 100).toFixed(0)}%
                    </div>
                `;
                maleColumns.appendChild(erectionColumn);
            }

            // Genital Size Column
            if (repro.genital_size !== undefined && repro.genital_size !== null) {
                const sizeColumn = document.createElement('div');
                sizeColumn.className = 'measurement-column-item';
                sizeColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-info-circle" title="Genital Size"></i>
                        <span>Genital Size</span>
                    </div>
                    <div class="measurement-column-value">
                        ${repro.genital_size}
                    </div>
                `;
                maleColumns.appendChild(sizeColumn);
            }

            // Genital Scale Column
            if (repro.genital_scale !== undefined && repro.genital_scale !== null) {
                const scaleColumn = document.createElement('div');
                scaleColumn.className = 'measurement-column-item';
                scaleColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-circle" title="Genital Scale"></i>
                        <span>Genital Scale</span>
                    </div>
                    <div class="measurement-column-value">
                        <span class="measurement-scale-badge" style="background-color: rgba(220, 53, 69, ${Math.min(repro.genital_scale, 1.0) * 0.6});" title="Genital Scale: ${repro.genital_scale.toFixed(2)}">${repro.genital_scale.toFixed(2)}</span>
                    </div>
                `;
                maleColumns.appendChild(scaleColumn);
            }

            if (maleColumns.children.length > 0) {
                maleRow.appendChild(maleColumns);
                maleContainer.appendChild(maleRow);
                section.appendChild(maleContainer);
                hasContent = true;
            }
        }

        // Female Anatomy - column layout (show if has values)
        if (repro.vagina_size || repro.vagina_scale !== undefined || repro.vaginal_openness !== undefined || (repro.genital_size !== undefined && repro.genital_size !== null) || (repro.genital_scale !== undefined && repro.genital_scale !== null)) {
            const femaleContainer = document.createElement('div');
            femaleContainer.className = 'measurement-column-container';

            // Add header for female anatomy group
            const femaleHeader = document.createElement('div');
            femaleHeader.className = 'measurement-group-header';
            femaleHeader.innerHTML = '<i class="fas fa-venus"></i> Female Anatomy';
            femaleContainer.appendChild(femaleHeader);

            const femaleRow = document.createElement('div');
            femaleRow.className = 'measurement-column-row';

            const femaleColumns = document.createElement('div');
            femaleColumns.className = 'measurement-column-items';

            // Vagina Size Column
            if (repro.vagina_size) {
                const vaginaSizeColumn = document.createElement('div');
                vaginaSizeColumn.className = 'measurement-column-item';
                vaginaSizeColumn.innerHTML = `
                    <div class="measurement-column-label">
                    <i class="fas fa-info-circle" title="Vagina Size"></i>
                        <span>Vagina Size</span>
                    </div>
                    <div class="measurement-column-value">
                        ${repro.vagina_size}
                    </div>
                `;
                femaleColumns.appendChild(vaginaSizeColumn);
            }

            // Vagina Scale Column
            if (repro.vagina_scale !== undefined && repro.vagina_scale !== null) {
                const vaginaScaleColumn = document.createElement('div');
                vaginaScaleColumn.className = 'measurement-column-item';
                vaginaScaleColumn.innerHTML = `
                    <div class="measurement-column-label">
                    <i class="fas fa-circle" title="Vagina Scale"></i>
                        <span>Vagina Scale</span>
                    </div>
                    <div class="measurement-column-value">
                        <span class="measurement-scale-badge" style="background-color: rgba(220, 53, 69, ${Math.min(repro.vagina_scale, 1.0) * 0.6});" title="Vagina Scale: ${repro.vagina_scale.toFixed(2)}">${repro.vagina_scale.toFixed(2)}</span>
                    </div>
                `;
                femaleColumns.appendChild(vaginaScaleColumn);
            }

            // Vaginal Openness Column
            if (repro.vaginal_openness !== undefined && repro.vaginal_openness !== null) {
                const opennessColumn = document.createElement('div');
                opennessColumn.className = 'measurement-column-item';
                opennessColumn.innerHTML = `
                    <div class="measurement-column-label">
                    <i class="fas fa-expand-arrows-alt" title="Vaginal Openness"></i>
                        <span>Vaginal Openness</span>
                    </div>
                    <div class="measurement-column-value">
                        ${(repro.vaginal_openness * 100).toFixed(0)}%
                    </div>
                `;
                femaleColumns.appendChild(opennessColumn);
            }

            // Genital Size Column
            if (repro.genital_size !== undefined && repro.genital_size !== null) {
                const genitalSizeColumn = document.createElement('div');
                genitalSizeColumn.className = 'measurement-column-item';
                genitalSizeColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-info-circle" title="Genital Size"></i>
                        <span>Genital Size</span>
                    </div>
                    <div class="measurement-column-value">
                        ${repro.genital_size}
                    </div>
                `;
                femaleColumns.appendChild(genitalSizeColumn);
            }

            // Genital Scale Column
            if (repro.genital_scale !== undefined && repro.genital_scale !== null) {
                const genitalScaleColumn = document.createElement('div');
                genitalScaleColumn.className = 'measurement-column-item';
                genitalScaleColumn.innerHTML = `
                    <div class="measurement-column-label">
                        <i class="fas fa-circle" title="Genital Scale"></i>
                        <span>Genital Scale</span>
                    </div>
                    <div class="measurement-column-value">
                        <span class="measurement-scale-badge" style="background-color: rgba(220, 53, 69, ${Math.min(repro.genital_scale, 1.0) * 0.6});" title="Genital Scale: ${repro.genital_scale.toFixed(2)}">${repro.genital_scale.toFixed(2)}</span>
                    </div>
                `;
                femaleColumns.appendChild(genitalScaleColumn);
            }

            if (femaleColumns.children.length > 0) {
                femaleRow.appendChild(femaleColumns);
                femaleContainer.appendChild(femaleRow);
                section.appendChild(femaleContainer);
                hasContent = true;
            }
        }

        // Reproductive State (non-pregnancy states only)
        if (repro.reproductive_state) {
            const state = repro.reproductive_state;
            const stateDescriptions = {
                'inactive': 'Inactive',
                'masturbating': 'Masturbating',
                'active_sexual_intercourse': 'Active Sexual Intercourse',
                'fertilized': 'Fertilized'
            };

            // Only show non-pregnancy states here
            if (state.state && stateDescriptions[state.state]) {
                section.innerHTML += `
                    <div class="measurement-item">
                        <div class="measurement-label">Reproductive State</div>
                        <div class="measurement-value">${stateDescriptions[state.state] || state.state}</div>
                    </div>
                `;
                hasContent = true;
            }
        }

        return hasContent ? section : null;
    }

    renderMedicalConditionsSection(data) {
        if (!data.MedicalConditions || data.MedicalConditions.length === 0) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-stethoscope"></i> Medical Conditions</h3>';

        let hasContent = false;

        data.MedicalConditions.forEach((condition, index) => {
            const conditionItem = document.createElement('div');
            conditionItem.className = 'measurement-item medical-condition-item';
            
            const severityGauge = this.createSmallGauge(condition.severity, 10, 'gauge-danger');
            
            conditionItem.innerHTML = `
                <div class="measurement-label">
                    <i class="fas fa-exclamation-triangle"></i> ${condition.name}
                </div>
                <div class="measurement-value">
                    ${condition.severity.toFixed(1)}/10 ${severityGauge}
                </div>
                <div class="measurement-description">
                    ${condition.description}
                </div>
            `;
            
            section.appendChild(conditionItem);
            hasContent = true;
        });

        return hasContent ? section : null;
    }

    renderProgressionSection(data) {
        if (!data.Progression) return null;

        const section = document.createElement('div');
        section.className = 'measurement-section';
        section.innerHTML = '<h3 class="measurement-section-title"><i class="fas fa-chart-line"></i> Progression</h3>';

        let hasContent = false;

        // Changes from previous
        if (data.Progression.changes_from_previous && data.Progression.changes_from_previous.length > 0) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">
                        <i class="fas fa-history"></i> Changes from Previous
                    </div>
                    <div class="measurement-value">
                        <ul class="progression-list">
                            ${data.Progression.changes_from_previous.map(change => `<li>${change}</li>`).join('')}
                        </ul>
                    </div>
                </div>
            `;
            hasContent = true;
        }

        // Progression indicators
        if (data.Progression.progression_indicators && data.Progression.progression_indicators.length > 0) {
            section.innerHTML += `
                <div class="measurement-item">
                    <div class="measurement-label">
                        <i class="fas fa-trending-up"></i> Progression Indicators
                    </div>
                    <div class="measurement-value">
                        <ul class="progression-list">
                            ${data.Progression.progression_indicators.map(indicator => `<li>${indicator}</li>`).join('')}
                        </ul>
                    </div>
                </div>
            `;
            hasContent = true;
        }

        return hasContent ? section : null;
    }
    
    hideMeasurements() {
        const measurementsModal = document.getElementById('measurementsModal');
        closeModal(measurementsModal);
    }
    
    // Setup measurements modal event listeners
    setupMeasurementsModal() {
        const closeMeasurementsBtn = document.getElementById('closeMeasurementsBtn');
        const measurementsModal = document.getElementById('measurementsModal');
        
        if (closeMeasurementsBtn) {
            closeMeasurementsBtn.addEventListener('click', () => this.hideMeasurements());
        }
        
        if (measurementsModal) {
            measurementsModal.addEventListener('click', (e) => {
                if (e.target === measurementsModal) {
                    this.hideMeasurements();
                }
            });

            // Add unit toggle functionality
            measurementsModal.addEventListener('click', (e) => {
                if (e.target.classList.contains('measurement-value-toggle')) {
                    this.toggleMeasurementUnit(e.target);
                }
            });
        }

        wireMeasurementsModalKeyboard(this);
    }

    // Create a small inline bar gauge for 0-10 values
    createSmallGauge(value, maxValue = 10, colorClass = 'gauge-primary') {
        const percentage = Math.min((value / maxValue) * 100, 100);

        return `
            <div class="small-gauge ${colorClass}" title="${value.toFixed(1)}/${maxValue}">
                <div class="small-gauge-bar" style="width: ${percentage}%"></div>
            </div>
        `;
    }

    // Toggle between imperial and metric units for measurement values
    toggleMeasurementUnit(element) {
        const currentUnit = element.dataset.unit;
        const imperialValue = element.dataset.imperial;
        const metricValue = element.dataset.metric;

        if (currentUnit === 'imperial') {
            element.textContent = metricValue;
            element.dataset.unit = 'metric';
        } else {
            element.textContent = imperialValue;
            element.dataset.unit = 'imperial';
        }
    }
                
    // Toggle expandable content function
    toggleExpandable(buttonElement, type = 'description') {
        // Find the expandable content within the same parent container
        const parent = buttonElement.parentElement;
        const content = parent.querySelector('.director-expandable-content');
        
        if (!content) {
            console.warn('Expandable content not found for button:', buttonElement);
            return;
        }
        
        // Define button content for different types
        const buttonConfigs = {
            'description': {
                show: '<i class="fas fa-chevron-down"></i> Show Description',
                hide: '<i class="fas fa-chevron-up"></i> Hide Description',
                icon: 'chevron-down'
            },
            'imageDescription': {
                show: '<i class="fas fa-chevron-down"></i> Show Image Description',
                hide: '<i class="fas fa-chevron-up"></i> Hide Image Description',
                icon: 'chevron-down'
            },
            'issues': {
                show: '<i class="fas fa-exclamation-triangle"></i> Show Issues',
                hide: '<i class="fas fa-exclamation-triangle"></i> Hide Issues',
                icon: 'exclamation-triangle'
            },
            'suggestions': {
                show: '<i class="fas fa-lightbulb"></i> Show Suggestions',
                hide: '<i class="fas fa-lightbulb"></i> Hide Suggestions',
                icon: 'lightbulb'
            }
        };
        
        const config = buttonConfigs[type] || buttonConfigs['description'];
        
        if (content.classList.contains('hidden')) {
            content.classList.remove('hidden');
            buttonElement.innerHTML = config.hide;
        } else {
            content.classList.add('hidden');
            buttonElement.innerHTML = config.show;
        }
    }
    
    // Copy prompt function
    applyPrompt(buttonElement) {
        // Find the message element by traversing up the DOM
        const messageElement = buttonElement.closest('.director-message');
        if (!messageElement) {
            console.warn('❌ No message element found');
            return;
        }
        
        // Get message data from the HTML element
        const messageData = messageElement.dataset.messageData;
        if (!messageData) {
            console.warn('❌ No message data found in element');
            return;
        }
        
        let message;
        try {
            message = JSON.parse(messageData);
        } catch (e) {
            console.warn('❌ Failed to parse message data from DOM:', e);
            return;
        }

        // Use server-processed prompt directly
        let prompt = null;
        if (message.data && message.data.Prompt) {
            prompt = message.data.Prompt;
        }
        
        if (!prompt) {
            console.warn('No prompt found for message:', message.id);
            showGlassToast('error', null, 'No prompt found in this message');
            return;
        }
        
        // Handle different prompt formats

        // Handle new JSON format with base_input, base_uc, and chara
        if (prompt && typeof prompt === 'object' && !Array.isArray(prompt)) {
            if (prompt.base_input !== undefined || prompt.base_uc !== undefined || prompt.chara) {
                // Apply base prompt
                const manualPrompt = document.getElementById('manualPrompt');
                if (manualPrompt && prompt.base_input) {
                    manualPrompt.value = prompt.base_input;

                    // Call normal update functions that handle reflow and highlighting
                    applyFormattedText(manualPrompt, true);
                    updateEmphasisHighlighting(manualPrompt);
                    stopEmphasisHighlighting();
                    setTimeout(() => autoResizeTextarea(manualPrompt), 10);
                }

                // Apply base UC
                const manualUc = document.getElementById('manualUc');
                if (manualUc && prompt.base_uc) {
                    manualUc.value = prompt.base_uc;

                    // Call normal update functions that handle reflow and highlighting
                    applyFormattedText(manualUc, true);
                    updateEmphasisHighlighting(manualUc);
                    stopEmphasisHighlighting();
                }

                const manualPromptNegativeMsg2 = document.getElementById('manualPromptNegative');
                const pnMsg = prompt.input_prompt_negative ?? prompt.base_prompt_negative;
                if (manualPromptNegativeMsg2 && pnMsg) {
                    manualPromptNegativeMsg2.value = pnMsg;
                    applyFormattedText(manualPromptNegativeMsg2, true);
                    updateEmphasisHighlighting(manualPromptNegativeMsg2);
                    stopEmphasisHighlighting();
                    setTimeout(() => autoResizeTextarea(manualPromptNegativeMsg2), 10);
                }

                // Apply quality preset setting
                if (prompt.apply_quality_preset !== undefined) {
                    appendQuality = prompt.apply_quality_preset;
                }

                // Apply UC preset setting
                if (prompt.apply_uc_preset !== undefined) {
                    selectUcPreset(prompt.apply_uc_preset);
                }

                // Smart character management - update existing, remove unused, add new
                if (prompt.chara && Array.isArray(prompt.chara)) {
                    const characterItems = document.querySelectorAll('.character-prompt-item');
                    const newCharacterCount = prompt.chara.length;

                    // Remove characters beyond the new count
                    if (characterItems.length > newCharacterCount) {
                        for (let i = characterItems.length - 1; i >= newCharacterCount; i--) {
                            characterItems[i].remove();
                        }
                    }

                    // Add/update character prompts from JSON structure
                    prompt.chara.forEach((character, index) => {
                        if (character && (character.name || character.input || character.uc)) {
                            this.addCharacterPromptFromData(character, index);
                        }
                    });
                } else {
                    // No characters in new prompt, remove all existing
                    document.querySelectorAll('.character-prompt-item').forEach(item => {
                        item.remove();
                    });
                }

                if (this.currentSession && message.id) {
                    const directorBtn = document.getElementById('directorBtn');
                    if (directorBtn) {
                        directorBtn.dataset.directorSessionId = this.currentSession.id;
                        directorBtn.dataset.directorMessageId = message.id;
                    }
                }

                const characterCount = prompt.chara ? prompt.chara.length : 0;
                showGlassToast('success', null, `Prompt${characterCount > 0 ? ` and ${characterCount} character(s)` : ''} Updated`);                
                return;
            }
        }

        if (Array.isArray(prompt)) {
            if (prompt.length === 1) {
                // Single prompt: replace base prompt
                const manualPrompt = document.getElementById('manualPrompt');
                if (manualPrompt) {
                    manualPrompt.value = prompt[0];

                    // Call normal update functions that handle reflow and highlighting
                    applyFormattedText(manualPrompt, true);
                    updateEmphasisHighlighting(manualPrompt);
                    stopEmphasisHighlighting();
                    setTimeout(() => autoResizeTextarea(manualPrompt), 10);
                }

                // Remove all character prompts
                const characterItems = document.querySelectorAll('.character-prompt-item');
                characterItems.forEach(item => {
                    item.remove();
                });

                showGlassToast('success', null, 'Prompt Updated');
            } else if (prompt.length > 1) {
                // Multiple prompts: first is base, rest are character prompts
                const manualPrompt = document.getElementById('manualPrompt');
                if (manualPrompt) {
                    manualPrompt.value = prompt[0];

                    // Call normal update functions that handle reflow and highlighting
                    applyFormattedText(manualPrompt, true);
                    updateEmphasisHighlighting(manualPrompt);
                    stopEmphasisHighlighting();
                    setTimeout(() => autoResizeTextarea(manualPrompt), 10);
                }
                
                // Remove existing character prompts
                document.querySelectorAll('.character-prompt-item').forEach(item => {
                    item.remove();
                });
                
                // Add character prompts (skip first one as it's the base)
                for (let i = 1; i < prompt.length; i++) {
                    this.addCharacterPromptFromData({ input: prompt[i] }, i - 1);
                }
                
                showGlassToast('success', null, `Prompt and ${prompt.length - 1} character(s) Updated`);
            }
        } else if (typeof prompt === 'string') {
            // Single string prompt: replace base prompt
            const manualPrompt = document.getElementById('manualPrompt');
            if (manualPrompt) {
                manualPrompt.value = prompt;

                // Call normal update functions that handle reflow and highlighting
                applyFormattedText(manualPrompt, true);
                updateEmphasisHighlighting(manualPrompt);
                stopEmphasisHighlighting();
            }

            // Remove all character prompts
            document.querySelectorAll('.character-prompt-item').forEach(item => {
                item.remove();
            });

            showGlassToast('success', null, 'Prompt Updated');
        }
        
        // Only auto-run if auto-generate is enabled
        if (this.autoGenerateEnabled) {
            setTimeout(() => {
                const manualGenerateBtn = document.getElementById('manualGenerateBtn');
                if (manualGenerateBtn && !manualGenerateBtn.disabled) {
                    manualGenerateBtn.click();
                }
            }, 1000);
        }
    }
        
    // Use suggestion function
    useSuggestion(suggestionText) {
        // Get the chat input and send button
        const directorChatInput = this.directorChatInput;
        const directorSendBtn = this.directorSendBtn;
        
        if (!directorChatInput || !directorSendBtn) {
            console.warn('❌ Chat input or send button not found');
            return;
        }
        
        // Set the action to 'change' if not already
        const directorActionsSelected = this.directorActionsSelected;
        if (directorActionsSelected) {
            const currentAction = this.getSelectedDirectorAction();
            if (currentAction !== 'change') {
                // Switch to change action
                const changeAction = { value: 'change', name: 'Change', icon: 'fas fa-edit' };
                this.directorActionsSelected.innerHTML = `<i class="${changeAction.icon}"></i> ${changeAction.name}`;
                this.directorChatInput.placeholder = 'Modify aspects of the prompt';
            }
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
    async rollbackToMessage(messageKey) {
        if (!this.currentSession) return;

        // Find the message element
        const messageElement = document.querySelector(`[data-message-key="${messageKey}"]`);
        if (!messageElement) {
            showGlassToast('error', null, 'Message not found');
            return;
        }

        // Get message data
        const messageData = messageElement.dataset.messageData;
        if (!messageData) {
            showGlassToast('error', null, 'Message data not found');
            return;
        }

        let message;
        try {
            message = JSON.parse(messageData);
        } catch (e) {
            showGlassToast('error', null, 'Failed to parse message data');
            return;
        }

        // Show confirmation dialog
        const confirmed = await showConfirmationDialog(
            'This will permanently delete this message and all messages after it. This action cannot be undone.',
            [
                { text: 'Cancel', value: false, className: 'btn-secondary' },
                { text: 'Rollback', value: true, className: 'btn-danger' }
            ]
        );

        if (!confirmed) return;

        // Send rollback request
        if (window.wsClient && window.wsClient.isConnected()) {
            window.wsClient.send({
                type: 'director_rollback_message',
                requestId: Date.now().toString(),
                sessionId: this.currentSession.id,
                messageId: message.id || message.timestamp
            });

            showGlassToast('info', null, 'Rolling back messages...');
        } else {
            showGlassToast('error', null, 'WebSocket not connected');
        }
    }

    // Scroll to bottom of chat messages
    scrollToBottom() {
        if (this.directorChatMessages) {
            // Use setTimeout to ensure DOM has been updated
            setTimeout(() => {
                this.directorChatMessages.scrollTop = 0;
            }, 10);
        }
    }

    // Markdown to HTML processor
    processMarkdown(markdownText) {
        if (!markdownText || typeof markdownText !== 'string') {
            return markdownText;
        }

        return markdownText
            // Headers
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            // Bold
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/__(.*?)__/g, '<strong>$1</strong>')
            // Italic
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/_(.*?)_/g, '<em>$1</em>')
            // Code
            .replace(/`(.*?)`/g, '<code>$1</code>')
            // Links
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
            // Line breaks
            .replace(/\n/g, '<br>')
            // Lists
            .replace(/^\* (.*$)/gim, '<li>$1</li>')
            .replace(/^- (.*$)/gim, '<li>$1</li>')
            .replace(/^(\d+)\. (.*$)/gim, '<li>$1. $2</li>')
            // Wrap consecutive list items in ul/ol
            .replace(/(<li>.*<\/li>)/gs, (match) => {
                const listItems = match.match(/<li>.*?<\/li>/g);
                if (listItems && listItems.length > 0) {
                    return `<ul>${match}</ul>`;
                }
                return match;
            });
    }
}

// Global Director instance
window.directorInstance = null;

// Initialize the Director
let measurementsModalKeyboardWired = false;

function wireMeasurementsModalKeyboard(director) {
    if (measurementsModalKeyboardWired) return;
    measurementsModalKeyboardWired = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'overlay.measurementsModal.close',
        type: 'whenFocused',
        modalId: 'measurementsModal',
        label: 'Close',
        keys: 'Alt+Q',
        overlayIcon: 'fas fa-times',
        overlayGroup: 'Director',
        overlayOnly: true,
        priority: -10
    });
}

function initializeDirector() {
    if (!window.directorInstance) {
        window.directorInstance = new Director();
    }
    return window.directorInstance.init();
}

// Try to register immediately, or wait for wsClient to be available
if (window.wsClient) {
    window.wsClient.registerInitStep(60, 'Initializing Director System', async () => {
        await initializeDirector();
    });
}