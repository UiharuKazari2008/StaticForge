// Director Class - Encapsulates all director functionality
class Director {
    constructor() {
        // Director state
        this.directorSessions = [];
        this.currentSession = null;
        this.currentView = 'newSession';
        this.autoGenerateEnabled = false;

        // Performance optimization: Cache DOM elements
        this._domCache = {};
        this._cacheDOMElements();

        // Performance optimization: Cache expensive objects
        this._dateFormatter = null;
        this._htmlEncoder = null;

        // Performance optimization: Debouncing timeouts
        this._renderSessionsTimeout = null;
        this._renderMessagesTimeout = null;

        // Director actions
        this.directorActions = [
            { value: 'change', name: 'Change', icon: 'fas fa-edit', placeholder: 'Modify aspects of the prompt' },
            { value: 'efficiency', name: 'Efficiency', icon: 'fas fa-chart-line', placeholder: 'Analyze and fix the prompt for efficiency (add original intent)' },
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
            directorMenuBtnChat: 'directorMenuBtnChat',
            directorCloseOverlayBtn: 'directorCloseOverlayBtn',
            directorModeSliderContainer: 'directorModeSliderContainer',
            directorUserIntent: 'directorUserIntent',
            directorMaxResolutionBtn: 'directorMaxResolutionBtn',
            directorCreateSessionBtn: 'directorCreateSessionBtn',
            directorNewSessionMessages: 'directorNewSessionMessages',

            // Chat elements
            directorSessionTitle: 'directorSessionTitle',
            directorDeleteSessionBtn: 'directorDeleteSessionBtn',
            directorAutoGenerateBtn: 'directorAutoGenerateBtn',
            directorChatMessages: 'directorChatMessages',
            directorActionsDropdown: 'directorActionsDropdown',
            directorActionsDropdownBtn: 'directorActionsDropdownBtn',
            directorActionsDropdownMenu: 'directorActionsDropdownMenu',
            directorActionsSelected: 'directorActionsSelected',
            directorAddBaseImageToggleBtn: 'directorAddBaseImageToggleBtn',
            directorChatInput: 'directorChatInput',
            directorSendBtn: 'directorSendBtn',

            // Preview elements
            directorSessionPreview: 'directorSessionPreview',
            directorSessionPreviewExpanded: 'directorSessionPreviewExpanded',
            directorSessionPreviewLarge: 'directorSessionPreviewLarge',

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
    
    // Setup event listeners
    setupDirectorEventListeners() {
        // Director toggle button
        if (this.directorBtn) {
        this.directorBtn.addEventListener('click', () => this.toggleDirector());
        }


        // Menu buttons
        if (this.directorMenuBtn) {
        this.directorMenuBtn.addEventListener('click', () => this.toggleSessionOverlay());
        }
        if (this.directorMenuBtnChat) {
            this.directorMenuBtnChat.addEventListener('click', () => this.toggleSessionOverlay());
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
        if (this.directorDeleteSessionBtn) {
        this.directorDeleteSessionBtn.addEventListener('click', () => this.deleteSession());
        }
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
        }

        // Auto-expand textarea
        if (this.directorChatInput) {
        this.directorChatInput.addEventListener('input', () => this.autoExpandTextarea());
        this.directorChatInput.addEventListener('focus', () => this.autoExpandTextarea());
        }
        if (this.directorUserIntent) {
            this.directorUserIntent.addEventListener('input', () => this.autoExpandTextarea());
            this.directorUserIntent.addEventListener('focus', () => this.autoExpandTextarea());
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

        // Re-render welcome message with updated mode content
        this.renderWelcomeMessage();
    }

    // Auto-expand textarea as content grows
    autoExpandTextarea() {
        const textarea = this.directorChatInput;
        if (!textarea) return;

        // Reset height to auto to get the correct scrollHeight
        textarea.style.height = 'auto';

        // Set height to scrollHeight to fit all content
        const scrollHeight = textarea.scrollHeight;
        const minHeight = 32; // Minimum height in pixels (matches min-height from HTML)
        const maxHeight = 320; // Maximum height to prevent excessive growth

        textarea.style.height = Math.min(Math.max(scrollHeight, minHeight), maxHeight) + 'px';
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
            this.directorContainer.classList.remove('hidden');
        }
        this.updateIndicator(this.directorBtn, true);
        await this.showNewSession();
    }

    hideDirector() {
        if (this.directorContainer) {
            this.directorContainer.classList.add('hidden');
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
        this.updateIndicator(this.directorMaxResolutionBtn, false);
        this.renderWelcomeMessage();
        this.initializeScrollbars();
    }
    
    async showSessionChat(session) {
        this.currentView = 'sessionChat';
        this.currentSession = session;
        window.currentSession = session; // Keep global reference for compatibility
        this.hideAllViews();
        this.closeSessionOverlay(); // Close overlay when switching views
        if (this.directorSessionChat) {
            this.directorSessionChat.classList.remove('hidden');
        }
        if (this.directorSessionTitle) {
            this.directorSessionTitle.textContent = session.name;
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
        // Remove click-outside listener
        this.removeClickOutsideListener();
    }

    addClickOutsideListener() {
        if (this._clickOutsideHandler) return;

        this._clickOutsideHandler = (event) => {
            // Check if click is outside the overlay
            if (this.directorSessionList && !this.directorSessionList.contains(event.target)) {
                // Check if click is not on a menu button that opens the overlay
                const menuButtons = [this.directorMenuBtn, this.directorMenuBtnChat].filter(btn => btn);
                const clickedOnMenuButton = menuButtons.some(btn => btn.contains(event.target));

                if (!clickedOnMenuButton) {
                    this.closeSessionOverlay();
                }
            }
        };

        document.addEventListener('click', this._clickOutsideHandler);
    }

    removeClickOutsideListener() {
        if (this._clickOutsideHandler) {
            document.removeEventListener('click', this._clickOutsideHandler);
            this._clickOutsideHandler = null;
        }
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

    renderWelcomeMessage() {
        if (!this.directorNewSessionMessages) return;

        // Get current mode for dynamic content (find container dynamically if cached one doesn't exist)
        const modeSliderContainer = this.directorModeSliderContainer ||
                                   document.getElementById('directorModeSliderContainer');
        const currentMode = modeSliderContainer?.getAttribute('data-active') || 'analyse';

        // Define mode-specific content
        const modeContent = {
            analyse: {
                title: 'Welcome to Image Director!',
                description: 'I\'ll analyze this image to craft the perfect prompt.',
                tips: [
                    'Be specific about the subject, style, and mood you want',
                    'Mention any important details like lighting, composition, or colors',
                    'Describe the overall atmosphere or feeling you want to achieve',
                    'I\'ll extract comprehensive visual details to create an effective prompt'
                ]
            },
            efficiency: {
                title: 'Welcome to Image Director!',
                description: 'I\'ll analyze this image and your existing prompt to optimize accuracy.',
                tips: [
                    'Describe what aspects of the current result you want improved',
                    'Mention any specific elements that aren\'t working as expected',
                    'Specify the mood or style changes you want to achieve',
                    'I\'ll identify gaps, optimize weights, and enhance prompt effectiveness'
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
        const model = 'grok-4';
        const maxResolution = this.directorMaxResolutionBtn.getAttribute('data-state') === 'on';
        const modeSliderContainer = this.directorModeSliderContainer ||
                                   document.getElementById('directorModeSliderContainer');
        const sessionMode = modeSliderContainer?.getAttribute('data-active') || 'analyse';
        const description = this.directorUserIntent ? this.directorUserIntent.value.trim() : '';
        const prompts = this.getInputPrompt();
        let imageFilename = null;

        if (window.currentManualPreviewImage) {
            imageFilename = window.currentManualPreviewImage.filename ||
                           window.currentManualPreviewImage.original ||
                           window.currentManualPreviewImage.upscaled;
        }

        if (!imageFilename) {
            showGlassToast('error', null, 'No image available for session creation');
            return;
        }

        // Send WebSocket request to create session
        if (window.wsClient && window.wsClient.isConnected()) {
            window.wsClient.send({
                type: 'director_create_session',
                requestId: Date.now().toString(),
                model: model,
                maxResolution: maxResolution,
                sessionMode: sessionMode,
                description: description,
                inputPrompt: prompts.prompts,
                inputUc: prompts.ucs,
                imageFilename // Get actual filename
            });
        } else {
            console.warn('WebSocket not connected, using mock data');
            // For now, create a mock session
            const newSession = {
                id: Date.now().toString(),
                name: `Session ${this.directorSessions.length + 1}`,
                model: model,
                maxResolution: maxResolution,
                previewImage: imageFilename,
                createdAt: new Date().toISOString(),
                messages: []
            };

            this.directorSessions = this.directorSessions || [];
            window.directorSessions = this.directorSessions;
            this.directorSessions.push(newSession);
            this.renderDirectorSessions();
            this.showSessionChat(newSession);
        }

        // Reset input after successful session creation
        if (this.directorUserIntent) {
            this.directorUserIntent.value = '';
            this.autoExpandTextarea(); // Reset to minimum height
        }
    }
    
    async deleteSession() {
        if (!this.currentSession) return;
        
        if (confirm('Are you sure you want to delete this session?')) {
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
                sessionId: sessionId
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
                if (structuredData.PrimaryFocus) {
                    content += `<div class="director-message-primary-focus">${this.processMarkdown(structuredData.PrimaryFocus)}</div>`;
                }

                // Add Issues as subtitle if available
                if (structuredData.Issues) {
                    content += `<div class="director-message-issues">${this.processMarkdown(structuredData.Issues)}</div>`;
                }

                // Add expandable sections for different content types
                let hasExpandableContent = false;

                // Add Description as expandable if available
                if (structuredData.Description) {
                    content += `
                        <div class="director-message-expandable">
                            <button type="button" class="director-expand-button" onclick="window.directorInstance.toggleExpandable(this)">
                                <i class="fas fa-chevron-down"></i> Show Description
                            </button>
                            <div class="director-expandable-content hidden">
                                <div class="director-message-content">${this.processMarkdown(structuredData.Description)}</div>
                            </div>
                        </div>
                    `;
                    hasExpandableContent = true;
                }

                // Add ImageDescription as expandable if available
                if (structuredData.ImageDescription) {
                    content += `
                        <div class="director-message-expandable">
                            <button type="button" class="director-expand-button" onclick="window.directorInstance.toggleExpandable(this)">
                                <i class="fas fa-chevron-down"></i> Show Image Description
                            </button>
                            <div class="director-expandable-content hidden">
                                <div class="director-message-image-description">${this.processMarkdown(structuredData.ImageDescription)}</div>
                            </div>
                        </div>
                    `;
                    hasExpandableContent = true;
                }

                // Add Suggestions as expandable if available
                if (structuredData.Suggested && Array.isArray(structuredData.Suggested) && structuredData.Suggested.length > 0) {
                    content += `
                        <div class="director-message-expandable">
                            <button type="button" class="director-expand-button" onclick="window.directorInstance.toggleExpandable(this, true)">
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
                        <i class="fas fa-undo"></i> Rollback
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
                hasMeasurements = true;
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
        this.autoExpandTextarea();

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
            window.wsClient.send({
                type: 'director_send_message',
                requestId: Date.now().toString(),
                sessionId: this.currentSession.id,
                content: content,
                messageType: action,
                vibeTransfers: includeBaseImage ? this.getVibeTransfers() : null,
                baseImageData: includeBaseImage ? this.getBaseImageData() : null,
                lastGeneratedImageFilename: lastGeneratedImageFilename,
                inputPrompt: prompts.prompts,
                inputUc: prompts.ucs
            });
        }
    }
    
    showTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'director-typing-indicator';
        typingDiv.innerHTML = `
            <div class="director-typing-dots">
                <div class="director-typing-dot"></div>
                <div class="director-typing-dot"></div>
                <div class="director-typing-dot"></div>
            </div>
        `;
        this.directorChatMessages.appendChild(typingDiv);
    }
    
    hideTypingIndicator() {
        const typingIndicator = this.directorChatMessages.querySelector('.director-typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
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
            data: data.data || null // Store preprocessed data from server
        };

        // Add message to current session data
        if (window.currentSession) {
            window.currentSession.messages = window.currentSession.messages || [];
            window.currentSession.messages.push(message);
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

        // All conditions met - auto-apply the prompt
        console.log('🔧 Auto-applying prompt from received message');
        this.applyPromptFromMessage(prompt);
    }

    // Apply prompt from message data
    applyPromptFromMessage(prompt) {
        // Handle different prompt formats (same logic as applyPrompt method)
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
                    addCharacterPrompt(prompt[i]);
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
        // Get base prompt and character prompts as an array from the current modal
        const prompts = [];
        const ucs = [];
        
        // Add main prompt if available
        const manualPrompt = document.getElementById('manualPrompt');
        if (manualPrompt && manualPrompt.value.trim()) {
            prompts.push(manualPrompt.value.trim());
        }
        
        // Add main UC if available
        const manualUc = document.getElementById('manualUc');
        if (manualUc && manualUc.value.trim()) {
            ucs.push(manualUc.value.trim());
        }
        
        // Add character prompts if available
        const characterItems = document.querySelectorAll('.character-prompt-item');
        characterItems.forEach(characterItem => {
            const characterId = characterItem.id;
            
            // Add character prompt
            const characterPrompt = document.getElementById(`${characterId}_prompt`);
            if (characterPrompt && characterPrompt.value.trim()) {
                prompts.push(characterPrompt.value.trim());
            }
            
            // Add character UC
            const characterUc = document.getElementById(`${characterId}_uc`);
            if (characterUc && characterUc.value.trim()) {
                ucs.push(characterUc.value.trim());
            }
        });
        
        return {
            prompts: prompts.length > 0 ? prompts : null,
            ucs: ucs.length > 0 ? ucs : null
        };
    }
    
    getSessionPreviewImage(session) {
        // Generate preview image path based on image type
        if (session.filename) {
            if (session.image_type === 'cache') {
                // For cache images, use cache preview
                return `/cache/preview/${session.filename}.webp`;
            } else {
                // For generated images, use previews directory
                const baseName = session.filename.split('.').slice(0, -1).join('.');
                return `/previews/${baseName}.jpg`;
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

        document.addEventListener('click', this.previewClickOutsideHandler);
    }

    // Remove click outside handler
    removePreviewClickOutsideHandler() {
        if (this.previewClickOutsideHandler) {
            document.removeEventListener('click', this.previewClickOutsideHandler);
            this.previewClickOutsideHandler = null;
        }
    }

    // Director WebSocket message handlers
    setupDirectorWebSocketHandlers() {
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
                const manualModal = document.getElementById('manualModal');
                if (manualModal && manualModal.classList.contains('hidden')) {
                    if (window.showManualModal) {
                        window.showManualModal();
                    }
                }

                // Enable director button if disabled
                if (window.directorInstance.directorBtn && window.directorInstance.directorBtn.disabled) {
                    window.directorInstance.directorBtn.disabled = false;
                    window.directorInstance.directorBtn.classList.remove('disabled');
                }

                // Show director interface and wait for it to complete
                await window.directorInstance.showDirector();

                // Reload all sessions from server to ensure session list is fully up-to-date
                await window.directorInstance.loadDirectorSessions();

                await window.directorInstance.showSessionChat(newSession);
            }
        });

        // Handle Director send message response
        window.wsClient.on('director_send_message_response', (data) => {
            console.log('📨 Director send message response received:', data);

            // Hide typing indicator
            if (window.directorInstance) {
                window.directorInstance.hideTypingIndicator();
            }

            // Note: Don't reload messages here - let director_message_response handle the actual message content
            // This prevents blank states and unnecessary API calls
        });
        
        // Handle Director get messages response
        window.wsClient.on('director_get_messages_response', (data) => {
            if (data.data && data.data.success) {
                const messages = data.data.messages || [];
                if (window.directorInstance) {
                    window.directorInstance.renderSessionMessages(messages);
                }
            }
        });
        
        // Handle Director delete session response
        window.wsClient.on('director_delete_session_response', async (data) => {
            if (data.data && data.data.success) {
                if (window.directorInstance) {
                    // Reload all sessions from server to ensure accurate list
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
                        window.directorInstance.directorSessionTitle.textContent = suggestedName;
                    }
                    
                    // Re-render the sessions list to show updated name
                    if (window.directorInstance) {
                        window.directorInstance.renderDirectorSessions();
                    }
                }
                
                if (window.directorInstance) {
                    window.directorInstance.hideTypingIndicator();
                }
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
                console.log('✅ Director rollback successful:', data.data);
                showGlassToast('success', null, data.data.message || 'Messages rolled back successfully');

                // Reload messages to reflect the changes
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
                console.log('📨 Director messages updated:', data.data);

                // Reload messages if this is a rollback action
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
        
        if (!measurements) {
            console.warn('No measurements found for message:', message.id);
            return;
        }
        const measurementsContent = document.getElementById('measurementsContent');
        
        // Clear previous content
        measurementsContent.innerHTML = '';
        
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
        
        measurementsContent.appendChild(measurementsGrid);
        
        // Show modal
        const measurementsModal = document.getElementById('measurementsModal');
        measurementsModal.classList.remove('hidden');
    }
    
    hideMeasurements() {
        const measurementsModal = document.getElementById('measurementsModal');
        measurementsModal.classList.add('hidden');
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
        }
    }
                
    // Toggle expandable content function
    toggleExpandable(buttonElement, isSuggestions = false) {
        // Find the expandable content within the same parent container
        const parent = buttonElement.parentElement;
        const content = parent.querySelector('.director-expandable-content');
        
        if (!content) {
            console.warn('Expandable content not found for button:', buttonElement);
            return;
        }
        
        if (content.classList.contains('hidden')) {
            content.classList.remove('hidden');
            buttonElement.innerHTML = (isSuggestions ? '<i class="fas fa-chevron-up"></i> Hide Suggestions' : '<i class="fas fa-chevron-up"></i> Hide Description');
        } else {
            content.classList.add('hidden');
            buttonElement.innerHTML = (isSuggestions ? '<i class="fas fa-lightbulb"></i> Show Suggestions' : '<i class="fas fa-chevron-down"></i> Show Description');
        }
    }
    
    // Copy prompt function
    applyPrompt(buttonElement) {
        console.log('🔧 applyPrompt called with button element:', buttonElement);
        
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
                console.log('✅ Base prompt applied successfully');
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
                    addCharacterPrompt(prompt[i]);
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
        setTimeout(() => {
        const manualGenerateBtn = document.getElementById('manualGenerateBtn');
            if (manualGenerateBtn && !manualGenerateBtn.disabled) {
                manualGenerateBtn.click();
            }
        }, 1000);
    }
        
    // Use suggestion function
    useSuggestion(suggestionText) {
        console.log('💡 Using suggestion:', suggestionText);
        
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
        this.autoExpandTextarea();

        // Focus on the input
        this.directorChatInput.focus();
        
        // Show a toast notification
        showGlassToast('info', null, 'Suggestion added to input. Click send to apply.');
        
        console.log('✅ Suggestion added to input:', messageText);
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
function initializeDirector() {
    if (!window.directorInstance) {
        window.directorInstance = new Director();
    }
    return window.directorInstance.init();
}

// Try to register immediately, or wait for wsClient to be available
if (window.wsClient) {
    window.wsClient.registerInitStep(60, 'Initializing Director System', async () => {
        console.log('🎬 Initializing Director System...');
        await initializeDirector();
        console.log('✅ Director System initialized successfully');
    });
}