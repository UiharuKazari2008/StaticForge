// Chat System JavaScript

const CHAT_VERBOSITY_OPTIONS = [
    { value: 'auto', name: 'Auto' },
    { value: '1', name: 'Brief' },
    { value: '2', name: 'Direct' },
    { value: '3', name: 'Expressive' },
    { value: '4', name: 'Elaborate' },
    { value: '5', name: 'Poetic' }
];

function chatVerbosityOptionLabel(value) {
    const v = String(value ?? '3');
    const hit = CHAT_VERBOSITY_OPTIONS.find((o) => o.value === v);
    return hit ? hit.name : 'Expressive';
}

function setChatVerbosityField(hiddenId, selectedId, value) {
    const v = value != null && value !== '' ? String(value) : '3';
    const hidden = document.getElementById(hiddenId);
    const selected = document.getElementById(selectedId);
    if (hidden) hidden.value = v;
    if (selected) selected.textContent = chatVerbosityOptionLabel(v);
}

function wireChatVerbosityDropdown(config) {
    const container = document.getElementById(config.containerId);
    const btn = document.getElementById(config.btnId);
    const menu = document.getElementById(config.menuId);
    const selectedEl = document.getElementById(config.selectedId);
    const hidden = document.getElementById(config.hiddenId);
    if (!container || !btn || !menu || !selectedEl || !hidden) return;
    if (container.dataset.wired === '1') return;
    container.dataset.wired = '1';

    if (!hidden.value) hidden.value = '3';
    selectedEl.textContent = chatVerbosityOptionLabel(hidden.value);

    const renderMenu = (selectedVal) => {
        // renderSimpleDropdown: public/scripts/comp/manualDropdownManager.js
        renderSimpleDropdown(
            menu,
            CHAT_VERBOSITY_OPTIONS,
            'value',
            'name',
            (value) => {
                hidden.value = String(value);
                selectedEl.textContent = chatVerbosityOptionLabel(value);
            },
            () => closeDropdown(menu, btn), // closeDropdown: public/scripts/comp/dropdown.js
            selectedVal,
            { preventFocusTransfer: true }
        );
    };

    // setupDropdown: public/scripts/comp/dropdown.js
    setupDropdown(container, btn, menu, renderMenu, () => hidden.value, { preventFocusTransfer: true });
}

class ChatSystem {
    constructor() {
        this.currentChatId = null;
        this.pendingChatId = null; // Track chatId being created to handle streaming events early
        this.currentFilename = null;
        this.personaSettings = null;
        this.chatSessions = [];
        this.messages = [];
        this.isLoading = false;
        this.isLoadingMore = false;
        this.hasMoreMessages = true;
        this.messagesOffset = 0;
        this.messagesLimit = 50;
        this.sentinelObserver = null;
        
        this.initializeWithPersonaSettings();
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        if (this._listenersWired) {
            return;
        }
        this._listenersWired = true;

        // Chat modal events
        document.getElementById('closeChatBtn')?.addEventListener('click', () => this.closeChatModal());
        document.getElementById('startChatBtn')?.addEventListener('click', () => this.startChat());
        
        // Chat interface modal events
        document.getElementById('closeChatInterfaceBtn')?.addEventListener('click', () => this.closeChatInterfaceModal());
        document.getElementById('chatSendBtn')?.addEventListener('click', () => this.sendMessage());
        document.getElementById('chatMessageInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Ensure send button is enabled when typing in the input and handle auto-height
        const chatInput = document.getElementById('chatMessageInput');
        chatInput?.addEventListener('input', (e) => {
            this.ensureSendButtonEnabled();
            this.autoResizeTextarea(e.target);
        });
        
        // Persona settings modal events
        document.getElementById('closePersonaSettingsBtn')?.addEventListener('click', () => this.closePersonaSettingsModal());
        document.getElementById('savePersonaSettingsBtn')?.addEventListener('click', () => this.savePersonaSettings());
        document.getElementById('personaProfilePhoto')?.addEventListener('change', (e) => this.handleProfilePhotoUpload(e));
        document.getElementById('personaProfilePhotoPreview')?.addEventListener('click', () => {
            document.getElementById('personaProfilePhoto').click();
        });
        
        // Persona settings button
        document.getElementById('personaSettingsBtn')?.addEventListener('click', () => this.openPersonaSettingsModal());

        wireChatVerbosityDropdown({
            containerId: 'chatVerbosityDropdown',
            btnId: 'chatVerbosityBtn',
            menuId: 'chatVerbosityMenu',
            selectedId: 'chatVerbositySelected',
            hiddenId: 'chatVerbosityHidden'
        });
        wireChatVerbosityDropdown({
            containerId: 'personaDefaultVerbosityDropdown',
            btnId: 'personaDefaultVerbosityBtn',
            menuId: 'personaDefaultVerbosityMenu',
            selectedId: 'personaDefaultVerbositySelected',
            hiddenId: 'personaDefaultVerbosityHidden'
        });

        this.wireKeyboardOverlayEntries();
    }

    wireKeyboardOverlayEntries() {
        if (this._keyboardOverlayWired) return;
        this._keyboardOverlayWired = true;
        // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        registerKeyboardListener({
            id: 'overlay.chatInterfaceModal.send',
            type: 'whenFocused',
            modalId: 'chatInterfaceModal',
            label: 'Send message',
            keys: 'Enter',
            overlayIcon: 'fas fa-paper-plane',
            overlayGroup: 'Chat',
            overlayOnly: true,
            priority: -10
        });
        registerKeyboardListener({
            id: 'personaSettingsModal.keydown',
            handler: (e) => {
                const modal = document.getElementById('personaSettingsModal');
                if (!modal || modal.classList.contains('hidden')) return;

                if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.savePersonaSettings();
                    return true;
                }
            },
            type: 'whenFocused',
            modalId: 'personaSettingsModal',
            priority: 78,
            critical: true,
            showInOverlay: false
        });
        registerModalOverlayEntries('chatInterfaceModal', 'Chat', [
            { id: 'overlay.chatInterfaceModal.close', label: 'Close', keys: 'Alt+Q', icon: 'fas fa-times' }
        ]);
        registerModalOverlayEntries('personaSettingsModal', 'Chat', [
            { id: 'overlay.personaSettings.save', label: 'Save', keys: 'Ctrl+S', icon: 'fas fa-save' },
            { id: 'overlay.personaSettings.close', label: 'Close', keys: 'Alt+Q', icon: 'fas fa-times' }
        ]);
    }

    async initializeWithPersonaSettings() {
        try {
            // Ensure WebSocket client is ready before attempting to load settings
            if (!window.wsClient) {
                console.warn('⚠️ WebSocket client not available, deferring persona settings loading');
                // Retry after a short delay
                setTimeout(() => this.initializeWithPersonaSettings(), 1000);
                return;
            }

            // Wait for WebSocket to be connected
            if (!window.wsClient.isConnected()) {
                console.warn('⚠️ WebSocket not connected, waiting...');
                // Wait for connection with timeout
                let attempts = 0;
                const maxAttempts = 30; // 30 seconds max
                while (!window.wsClient.isConnected() && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    attempts++;
                }
                
                if (!window.wsClient.isConnected()) {
                    console.error('❌ WebSocket not connected after waiting, proceeding without persona settings');
                    return;
                }
            }

            // Load persona settings first
            await this.loadPersonaSettings();
        } catch (error) {
            console.error('❌ Failed to initialize with persona settings:', error);
        }
    }

    async loadPersonaSettings() {
        try {
            if (!window.wsClient || !window.wsClient.isConnected()) {
                console.warn('⚠️ Cannot load persona settings: WebSocket not connected');
                return;
            }

            const response = await window.wsClient.getPersonaSettings();
            if (response && response.success) {
                this.personaSettings = response.settings || {};
                this.populatePersonaSettingsForm();
            } else {
                console.warn('⚠️ Failed to load persona settings: response was not successful');
                // Initialize with empty settings
                this.personaSettings = {};
            }
        } catch (error) {
            console.error('❌ Failed to load persona settings:', error);
            // Initialize with empty settings instead of leaving it null
            this.personaSettings = {};
        }
    }

    populatePersonaSettingsForm() {
        if (!this.personaSettings) return;
        
        document.getElementById('personaUserName').value = this.personaSettings.user_name || '';
        document.getElementById('personaBackstory').value = this.personaSettings.backstory || '';
        setChatVerbosityField('personaDefaultVerbosityHidden', 'personaDefaultVerbositySelected', this.personaSettings.default_verbosity || 3);
        
        // Set profile photo if exists
        if (this.personaSettings.profile_photo_base64) {
            const preview = document.getElementById('personaProfilePhotoPreview');
            preview.innerHTML = `<img src="data:image/jpeg;base64,${this.personaSettings.profile_photo_base64}" alt="Profile Photo">`;
        }
    }

    async openChatModal(filename, characterName = null) {
        this.currentFilename = filename;
        
        // Set the background image
        const backgroundImage = document.getElementById('chatBackgroundImage');
        backgroundImage.src = `/images/${filename}`;
        
        // Update modal info
        document.getElementById('chatCharacterName').textContent = characterName || 'Unknown';
        document.getElementById('chatFilename').textContent = filename;
        
        // Reset form
        document.getElementById('chatName').value = characterName || '';
        document.getElementById('chatMindSeed').value = '';
        document.getElementById('chatStoryContext').value = '';
        document.getElementById('chatViewerContext').value = '';
        setChatVerbosityField('chatVerbosityHidden', 'chatVerbositySelected', this.personaSettings?.default_verbosity || 3);
        
        // Fetch image metadata to extract creative directive if dynamic generation was enabled
        try {
            if (window.wsClient && window.wsClient.isConnected()) {
                const metadata = await window.wsClient.sendMessage('request_image_metadata', {
                    filename: filename
                });
                
                // The response is the metadata object directly
                if (metadata && metadata.dynamic_generation && metadata.dynamic_generation.directive) {
                    const directive = metadata.dynamic_generation.directive.trim();
                    if (directive) {
                        document.getElementById('chatMindSeed').value = directive;
                        console.log('✅ Copied creative directive from image metadata:', directive);
                    }
                }
            }
        } catch (error) {
            console.warn('⚠️ Could not fetch image metadata for creative directive:', error);
            // Non-critical error, continue without directive
        }
        
        
        // Fetch image metadata to extract creative directive if dynamic generation was enabled
        try {
            if (window.wsClient && window.wsClient.isConnected()) {
                const metadata = await window.wsClient.sendMessage('request_image_metadata', {
                    filename: filename
                });
                
                // The response is the metadata object directly
                if (metadata && metadata.dynamic_generation && metadata.dynamic_generation.directive) {
                    const directive = metadata.dynamic_generation.directive.trim();
                    if (directive) {
                        document.getElementById('chatMindSeed').value = directive;
                        console.log('✅ Copied creative directive from image metadata:', directive);
                    }
                }
            }
        } catch (error) {
            console.warn('⚠️ Could not fetch image metadata for creative directive:', error);
            // Non-critical error, continue without directive
        }
        
        // Open modal
        openModal(document.getElementById('chatModal'));
    }

    async closeChatModal() {
        this.currentFilename = null;
        this.currentChatId = null;
        this.messages = [];
        this.messagesOffset = 0;
        this.hasMoreMessages = true;    
        this.chatSessions = [];
        this.chatSessionsOffset = 0;
        this.chatSessionsHasMore = true;

        
        await closeModal(document.getElementById('chatModal'));
    }

    async startChat() {
        if (this.isLoading) return;
        
        // Ensure WebSocket is connected
        if (!window.wsClient || !window.wsClient.isConnected()) {
            if (window.showToast) {
                window.showToast('WebSocket not connected. Please wait for connection to be established.', 'error');
            }
            console.error('❌ Cannot start chat: WebSocket not connected');
            return;
        }
        
        this.isLoading = true;
        const startBtn = document.getElementById('startChatBtn');
        startBtn.disabled = true;
        startBtn.innerHTML = '<i class="fas fa-spinner-third fa-spin"></i> Starting...';
        
        // Clear any pending chat ID
        this.pendingChatId = null;
        
        try {
            const defaultGrok = window.optionsData?.defaultGrokModel || 'grok-4-fast-reasoning';
            const chatData = {
                filename: this.currentFilename,
                characterName: document.getElementById('chatName').value || null,
                textContextInfo: document.getElementById('chatMindSeed').value || null,
                textViewerInfo: document.getElementById('chatViewerContext').value || null,
                storyContext: document.getElementById('chatStoryContext').value || null,
                verbosityLevel: parseInt(document.getElementById('chatVerbosityHidden').value, 10) || 3,
                provider: 'grok',
                model: defaultGrok
            };
            
            // Open chat interface modal BEFORE sending request so we can receive streaming events
            // We'll set the actual chatId when the response arrives
            this.closeChatModal();
            this.openChatInterfaceModal();
            
            // Send the create request (this will trigger persona establishment which streams)
            const response = await window.wsClient.createChatSession(chatData);
            
            if (response && response.success) {
                // Set both currentChatId and clear pendingChatId
                this.currentChatId = response.chatId;
                this.pendingChatId = null;
                
                await this.loadAllChatSessions();
                
                // Load initial messages (streaming events may have already arrived)
                await this.loadChatMessages();
                
                // Show typing indicator while waiting for AI response
                this.showTypingIndicator();
                
                // Ensure send button is ready after chat creation
                this.resetSendButton();
            } else {
                const errorMsg = response?.message || response?.error || 'Failed to create chat session';
                // Close the modal if creation failed
                this.closeChatInterfaceModal();
                throw new Error(errorMsg);
            }
        } catch (error) {
            console.error('❌ Failed to start chat:', error);
            // Close the modal if creation failed
            this.closeChatInterfaceModal();
            this.pendingChatId = null;
            // Show error toast
            if (window.showToast) {
                const errorMsg = error.message || 'Failed to start chat';
                window.showToast('Failed to start chat: ' + errorMsg, 'error');
            }
        } finally {
            this.isLoading = false;
            startBtn.disabled = false;
            startBtn.innerHTML = '<span>Create Persona</span><i class="fas fa-person-to-portal"></i>';
        }
    }

    openChatInterfaceModal() {
        const modal = document.getElementById('chatInterfaceModal');
        openModal(modal);
        
        // Initialize metadata toggle functionality
        this.initializeMetadataToggle();
        
        // Reset send button state when opening modal
        this.resetSendButton();
    }

    closeChatInterfaceModal() {
        if (this.sentinelObserver) {
            this.sentinelObserver.disconnect();
            this.sentinelObserver = null;
        }
        const modal = document.getElementById('chatInterfaceModal');
        closeModal(modal);
    }

    async loadChatSessions() {
        try {
            const response = await window.wsClient.getChatSessions(this.currentFilename);
            if (response.success) {
                this.chatSessions = response.sessions;
                this.renderChatSessions();
            }
        } catch (error) {
            console.error('Failed to load chat sessions:', error);
        }
    }

    renderChatSessions() {
        const container = document.getElementById('chatSessionsList');
        container.innerHTML = '';
        
        this.chatSessions.forEach(session => {
            const sessionElement = document.createElement('div');
            sessionElement.className = 'chat-session-item';
            if (session.id === this.currentChatId) {
                sessionElement.classList.add('active');
            }
            
            sessionElement.innerHTML = `
                <div class="chat-session-preview">
                    <img src="/previews/${encodeURIComponent(session.filename.replace(/\.(jpg|jpeg|png|webp)$/i, ''))}.webp" alt="Character" class="chat-session-avatar" 
                         onerror="this.src='/static_images/icon-96x96.png'">
                    <div class="chat-session-info">
                        <div class="chat-session-name">${session.chat_name || session.character_name || 'Unnamed Chat'}</div>
                        <div class="chat-session-last-message">Click to open conversation</div>
                    </div>
                    <div class="chat-session-time">${this.formatTime(session.updated_at)}</div>
                </div>
            `;
            
            sessionElement.addEventListener('click', (e) => {
                // Only select the chat if not opening context menu
                if (!sessionElement.classList.contains('context-open')) {
                    this.selectChatSession(session.id);
                }
            });
            
            // Add context menu to the session element
            if (contextMenu) {
                contextMenu.attachToElement(sessionElement, {
                    sections: [
                        {
                            type: 'list',
                            items: [
                                {
                                    icon: 'mdi mdi-1-5 mdi-refresh',
                                    text: 'Reset Chat',
                                    action: 'reset-chat',
                                    data: { chatId: session.id }
                                },
                                {
                                    icon: 'mdi mdi-1-5 mdi-delete',
                                    text: 'Delete Chat',
                                    action: 'delete-chat',
                                    className: 'danger',
                                    data: { chatId: session.id }
                                }
                            ]
                        }
                    ],
                    onAction: (action, target, item) => {
                        if (action === 'reset-chat') {
                            this.handleContextMenuResetChat(item.data.chatId);
                        } else if (action === 'delete-chat') {
                            this.handleContextMenuDeleteChat(item.data.chatId);
                        }
                    }
                });
            }
            
            container.appendChild(sessionElement);
        });
    }

    async selectChatSession(chatId) {
        this.currentChatId = chatId;
        
        // Reset pagination state
        this.messagesOffset = 0;
        this.hasMoreMessages = true;
        this.messages = [];
        
        // Find the selected session to get its filename
        const selectedSession = this.chatSessions.find(session => session.id === chatId);
        if (selectedSession) {
            // Set the current filename for image display
            this.currentFilename = selectedSession.filename;
        }
        
        await this.loadChatMessages();
        this.renderChatSessions(); // Re-render to update active state
        
        // Reset send button state when selecting a chat session
        this.resetSendButton();
    }

    async loadChatMessages(append = false) {
        if (!this.currentChatId) return;
        
        try {
            const offset = append ? this.messagesOffset : 0;
            const response = await window.wsClient.getChatMessages(this.currentChatId, this.messagesLimit, offset);
            
            if (response.success) {
                const newMessages = response.messages.reverse(); // Reverse to show oldest first
                
                if (append) {
                    // Prepend older messages
                    this.messages = [...newMessages, ...this.messages];
                    this.messagesOffset += newMessages.length;
                } else {
                    // Initial load
                    this.messages = newMessages;
                    this.messagesOffset = newMessages.length;
                }
                
                // Check if there are more messages to load
                this.hasMoreMessages = newMessages.length === this.messagesLimit;
                
                this.renderChatMessages();
                
                if (!append) {
                    this.scrollToBottom();
                    this.setupSentinelObserver();
                }
                
                // Ensure send button is enabled after loading messages
                this.resetSendButton();
            }
        } catch (error) {
            console.error('Failed to load chat messages:', error);
            // Reset button state even on error
            this.resetSendButton();
        }
    }

    renderChatMessages() {
        const container = document.getElementById('chatMessagesList');
        container.innerHTML = '';
        
        // Set background image for chat messages panel
        const panelContainer = document.querySelector('.chat-messages-panel');
        if (panelContainer) {
            if (this.currentFilename) {
                panelContainer.style.backgroundImage = `url("/images/${this.currentFilename}")`;
                panelContainer.classList.add('has-background');
            } else {
                panelContainer.style.backgroundImage = '';
                panelContainer.classList.remove('has-background');
            }
        }
        
        // Add sentinel at the top (oldest messages) for loading more
        if (this.hasMoreMessages) {
            const sentinel = document.createElement('div');
            sentinel.className = 'chat-sentinel';
            sentinel.id = 'chatLoadMoreSentinel';
            sentinel.innerHTML = '<div class="chat-loading-indicator">Loading older messages...</div>';
            container.appendChild(sentinel);
        }
        
        // Group messages by response_id first, then by timestamp within each response
        const responseGroups = [];
        let currentResponseGroup = [];
        
        for (let i = 0; i < this.messages.length; i++) {
            const message = this.messages[i];
            
            if (message.message_type === 'user') {
                // Flush any pending assistant response group
                if (currentResponseGroup.length > 0) {
                    responseGroups.push({ type: 'assistant_response', messages: currentResponseGroup });
                    currentResponseGroup = [];
                }
                responseGroups.push({ type: 'user', message });
            } else if (message.message_type === 'assistant') {
                const lastMessage = currentResponseGroup[currentResponseGroup.length - 1];
                
                // If this is the first assistant message or has same response_id as last, add to current group
                if (currentResponseGroup.length === 0 || (message.response_id && lastMessage?.response_id === message.response_id)) {
                    currentResponseGroup.push(message);
                } else {
                    // Different response_id, flush current group and start new one
                    if (currentResponseGroup.length > 0) {
                        responseGroups.push({ type: 'assistant_response', messages: currentResponseGroup });
                    }
                    currentResponseGroup = [message];
                }
            }
        }
        
        // Flush any remaining group
        if (currentResponseGroup.length > 0) {
            responseGroups.push({ type: 'assistant_response', messages: currentResponseGroup });
        }
        
        // Render grouped messages (CSS column-reverse handles visual order)
        responseGroups.forEach(group => {
            if (group.type === 'user') {
                // Render user message directly
                const messageElement = document.createElement('div');
                messageElement.className = `chat-message user`;
                messageElement.dataset.messageId = group.message.id; // Store message ID for deletion
            
                let avatarSrc = '/static_images/icon-96x96.png';
                if (this.personaSettings?.profile_photo_base64) {
                    avatarSrc = `data:image/jpeg;base64,${this.personaSettings.profile_photo_base64}`;
                }
                
                messageElement.innerHTML = `
                    <img src="${avatarSrc}" alt="Avatar" class="chat-message-avatar">
                    <div class="chat-message-content">
                        <div class="chat-message-text">${this.escapeHtml(group.message.content)}</div>
                    </div>
                `;
                
                // Add context menu for message deletion
                this.attachMessageContextMenu(messageElement, group.message.id);
                
                container.appendChild(messageElement);
            } else if (group.type === 'assistant_response') {
                // Group by timestamp and render each timestamp as a separate message
                this.renderAssistantResponse(group.messages);
            }
        });
        
        // Update custom scrollbar after rendering
        if (window.customScrollbar) {
            const contentElement = document.querySelector('.chat-messages-content');
            if (contentElement) {
                // Small delay to ensure DOM is fully updated
                setTimeout(() => {
                    window.customScrollbar.updateScrollbar(contentElement);
                }, 10);
            }
        }
    }
    
    renderAssistantResponse(eventMessages) {
        const container = document.getElementById('chatMessagesList');
        const avatarSrc = `/images/${encodeURIComponent(this.currentFilename)}`;
        
        // Group events by timestamp
        const timestampGroups = {};
        eventMessages.forEach(eventMsg => {
            // Parse event metadata to get timestamp
            let timestamp = 0;
            if (eventMsg.event_metadata) {
                try {
                    const metadata = JSON.parse(eventMsg.event_metadata);
                    timestamp = metadata.timestamp !== undefined ? metadata.timestamp : 0;
                } catch (e) {
                    timestamp = 0;
                }
            }
            
            if (!timestampGroups[timestamp]) {
                timestampGroups[timestamp] = [];
            }
            timestampGroups[timestamp].push(eventMsg);
        });
        
        // Sort timestamps in chronological order (column-reverse CSS will flip visually)
        const sortedTimestamps = Object.keys(timestampGroups).map(Number).sort((a, b) => a - b);
        
        sortedTimestamps.forEach(timestamp => {
            const eventsAtTime = timestampGroups[timestamp];
            this.renderEventGroup(eventsAtTime, avatarSrc, container);
        });
    }
    
    renderEventGroup(events, avatarSrc, container) {
        // Define which events are "4th wall metadata"
        const metadataEventTypes = ['memory', 'environment', 'sensory', 'emotion', 'location', 'timeofday', 'innerspeech', 'currplan', 'futureplans', 'trustlevel', 'inventory', 'offlinemessage'];
        const visibleEventTypes = ['speechdirect', 'speech', 'reply', 'actions', 'sfx', 'myname'];
        
        // Separate events into visible and metadata
        const visibleEvents = events.filter(e => visibleEventTypes.includes(e.event_type));
        const metadataEvents = events.filter(e => metadataEventTypes.includes(e.event_type));
        
        // Render visible events as a single message bubble if present
        if (visibleEvents.length > 0) {
            let messageContent = '';
            let actions = '';
            let sfx = '';
            
            visibleEvents.forEach(event => {
                const eventType = event.event_type;
                const content = event.content;
                
                if (!content) return;
                
                switch(eventType) {
                    case 'speechdirect':
                        if (!messageContent) messageContent = content;
                        break;
                    case 'speech':
                        if (!messageContent) messageContent = content;
                        break;
                    case 'reply':
                        if (!messageContent) messageContent = content;
                        break;
                    case 'actions':
                        actions = content;
                        break;
                    case 'sfx':
                        sfx = content;
                        break;
                    case 'myname':
                        // Handle name introduction specially
                        if (!messageContent) messageContent = `My name is ${content}`;
                        break;
                }
            });
            
            // Check if actions and sfx should be visible
            const showActionsSfx = container && container.classList.contains('show-actions-sfx');
            
            // Only create message if there's actual content
            if (messageContent || (showActionsSfx && (actions || sfx))) {
                const messageElement = document.createElement('div');
                messageElement.className = 'chat-message assistant';
                
                // Find the latest message ID from this group (for deletion)
                // Sort events by ID (assuming higher ID = newer message)
                const sortedEvents = [...visibleEvents].sort((a, b) => (b.id || 0) - (a.id || 0));
                const latestMessageId = sortedEvents[0]?.id || null;
                
                if (latestMessageId) {
                    messageElement.dataset.messageId = latestMessageId;
                }
                
                messageElement.innerHTML = `
                    <div class="chat-message-content">
                        ${messageContent ? `<div class="chat-message-text">${this.escapeHtml(messageContent)}</div>` : ''}
                        ${(showActionsSfx && actions) ? `<div class="chat-message-actions">*${this.escapeHtml(actions)}*</div>` : ''}
                        ${(showActionsSfx && sfx) ? `<div class="chat-message-sfx">~${this.escapeHtml(sfx)}~</div>` : ''}
                    </div>
                `;
                
                // Add context menu for message deletion
                if (latestMessageId) {
                    this.attachMessageContextMenu(messageElement, latestMessageId);
                }
                
                container.appendChild(messageElement);
            }
        }
        
        // Render each metadata event as its own separate message with metadata class
        metadataEvents.forEach(event => {
            const messageElement = document.createElement('div');
            messageElement.className = `chat-message assistant metadata-message ${event.event_type}`;
            
            // Store message ID for deletion
            if (event.id) {
                messageElement.dataset.messageId = event.id;
            }
            
            // Get event display name
            const eventDisplayNames = {
                'memory': '🧠 Memory',
                'environment': '🌍 Environment',
                'sensory': '👁️ Sensory',
                'emotion': '💭 Emotion',
                'location': '📍 Location',
                'timeofday': '🕐 Time',
                'innerspeech': '💬 Inner Thought',
                'currplan': '📋 Current Plan',
                'futureplans': '🔮 Future Plans',
                'trustlevel': '🤝 Trust',
                'inventory': '🎒 Inventory',
                'offlinemessage': '📱 Message'
            };
            
            const eventLabel = eventDisplayNames[event.event_type] || event.event_type;
            
            messageElement.innerHTML = `
                <div class="chat-message-content">
                    <div class="metadata-label">${eventLabel}</div>
                    <div class="chat-message-text">${this.escapeHtml(event.content)}</div>
                </div>
            `;
            
            // Add context menu for message deletion
            if (event.id) {
                this.attachMessageContextMenu(messageElement, event.id);
            }
            
            container.appendChild(messageElement);
        });
    }

    toggleMetadataVisibility() {
        const container = document.getElementById('chatMessagesList');
        if (container) {
            container.classList.toggle('show-metadata');
            
            // Save preference to localStorage
            const isShowing = container.classList.contains('show-metadata');
            localStorage.setItem('chat-show-metadata', isShowing);
        }
    }

    toggleActionsSfxVisibility() {
        const container = document.getElementById('chatMessagesList');
        if (container) {
            container.classList.toggle('show-actions-sfx');
            
            // Save preference to localStorage
            const isShowing = container.classList.contains('show-actions-sfx');
            localStorage.setItem('chat-show-actions-sfx', isShowing);
            
            // Re-render messages to apply the toggle
            if (this.currentChatId) {
                this.renderChatMessages();
            }
        }
    }

    attachMessageContextMenu(messageElement, messageId) {
        if (!contextMenu || !messageId) return;
        
        contextMenu.attachToElement(messageElement, {
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            icon: 'mdi mdi-1-5 mdi-delete',
                            text: 'Delete',
                            action: 'delete-message',
                            className: 'danger',
                            data: { messageId: messageId }
                        }
                    ]
                }
            ],
            onAction: (action, target, item) => {
                if (action === 'delete-message') {
                    this.handleDeleteMessage(item.data.messageId);
                }
            }
        });
    }

    async handleDeleteMessage(messageId) {
        if (!messageId) return;
        
        // Confirm deletion
        const confirmed = await showConfirmationDialog(
            'Are you sure you want to delete this message? This action cannot be undone.',
            [
                { text: 'Delete', value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );
        
        if (!confirmed) return;
        
        try {
            const response = await window.wsClient.deleteChatMessage(messageId);
            
            if (response && response.success) {
                if (window.showToast) {
                    window.showToast('Message deleted successfully', 'success');
                }
                
                // Reload messages to reflect the deletion
                if (this.currentChatId) {
                    await this.loadChatMessages();
                }
            } else {
                const errorMsg = response?.message || response?.error || 'Failed to delete message';
                throw new Error(errorMsg);
            }
        } catch (error) {
            console.error('Failed to delete message:', error);
            if (window.showToast) {
                const errorMsg = error.message || 'Failed to delete message';
                window.showToast('Failed to delete message: ' + errorMsg, 'error');
            }
        }
    }
    
    initializeMetadataToggle() {
        // Restore preference from localStorage
        const showMetadata = localStorage.getItem('chat-show-metadata') === 'true';
        const showActionsSfx = localStorage.getItem('chat-show-actions-sfx') === 'true';
        const container = document.getElementById('chatMessagesList');
        if (container) {
            if (showMetadata) {
                container.classList.add('show-metadata');
            }
            if (showActionsSfx) {
                container.classList.add('show-actions-sfx');
            }
        }
        
        // Add context menu to chat messages container
        if (contextMenu) {
            contextMenu.attachToElement(container, {
                sections: [
                    {
                        type: 'list',
                        items: [
                            {
                                icon: 'mdi mdi-1-5 mdi-eye',
                                text: 'Toggle 4th Wall Events',
                                action: 'toggle-metadata'
                            },
                            {
                                icon: 'mdi mdi-1-5 mdi-eye',
                                text: 'Toggle Actions & SFX',
                                action: 'toggle-actions-sfx'
                            }
                        ]
                    }
                ],
                onAction: (action, target, item) => {
                    if (action === 'toggle-metadata') {
                        this.toggleMetadataVisibility();
                    } else if (action === 'toggle-actions-sfx') {
                        this.toggleActionsSfxVisibility();
                    }
                }
            });
        }
        
        // Force scrollbar update after initialization
        if (window.customScrollbar) {
            const contentElement = document.querySelector('.chat-messages-content');
            if (contentElement) {
                window.customScrollbar.forceReinit(contentElement);
            }
        }
    }

    async sendMessage() {
        const input = document.getElementById('chatMessageInput');
        const message = input.value.trim();
        
        if (!message || !this.currentChatId || this.isLoading) return;
        
        this.isLoading = true;
        const sendBtn = document.getElementById('chatSendBtn');
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fas fa-spinner-third fa-spin"></i>';
        
        // Add user message to UI immediately
        this.addMessageToUI('user', message);
        input.value = '';
        
        // Reset textarea height
        input.style.height = 'auto';
        
        this.scrollToBottom();
        
        try {
            // Ensure WebSocket is connected
            if (!window.wsClient || !window.wsClient.isConnected()) {
                throw new Error('WebSocket not connected');
            }

            // Send the message
            const response = await window.wsClient.sendChatMessage(this.currentChatId, message);
            
            if (response && response.success) {
                // If streaming is disabled, add the response directly to UI
                // If streaming is enabled, the streaming events will handle the UI updates
                if (!response.streaming) {
                    // Reset loading state for non-streaming mode
                    this.isLoading = false;
                    sendBtn.disabled = false;
                    sendBtn.innerHTML = '<i class="mdi mdi-1-5 mdi-send"></i>';
                    this.scrollToBottom();
                }
                // For streaming mode, the loading state will be reset by handleStreamingComplete
            } else {
                const errorMsg = response?.error || response?.message || 'Failed to send message';
                throw new Error(errorMsg);
            }
        } catch (error) {
            console.error('❌ Failed to send message:', error);
            // Show error message
            const errorMessage = error.message || 'I apologize, but I encountered an error processing your message.';
            this.addMessageToUI('assistant', errorMessage);
            
            // Reset loading state on error
            this.isLoading = false;
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="mdi mdi-1-5 mdi-send"></i>';
            
            // Show toast notification
            if (window.showToast) {
                window.showToast('Failed to send message: ' + errorMessage, 'error');
            }
        }
    }

    addMessageToUI(messageType, content, jsonData = null) {
        const container = document.getElementById('chatMessagesList');
        const messageElement = document.createElement('div');
        messageElement.className = `chat-message ${messageType}`;
        
        let avatarSrc = '/static_images/icon-96x96.png';
        if (messageType === 'user' && this.personaSettings?.profile_photo_base64) {
            avatarSrc = `data:image/jpeg;base64,${this.personaSettings.profile_photo_base64}`;
        } else if (messageType === 'assistant') {
            avatarSrc = `/images/${this.currentFilename}`;
        }
        
        let messageContent = content;
        let actions = '';
        let sfx = '';
        
        // Try to parse content as JSON if it looks like JSON and jsonData is null
        if (!jsonData && content && typeof content === 'string' && (content.trim().startsWith('{') || content.trim().startsWith('['))) {
            try {
                let parsed;
                let cleanedContent = content.trim();
                
                // Handle malformed JSON - multiple objects separated by commas (not wrapped in array)
                if (cleanedContent.startsWith('{') && !cleanedContent.startsWith('[{') && cleanedContent.includes('},')) {
                    // Try to wrap in array brackets
                    cleanedContent = '[' + cleanedContent + ']';
                }
                
                // Remove trailing commas before closing brackets/braces
                cleanedContent = cleanedContent.replace(/,(\s*[}\]])/g, '$1');
                
                parsed = JSON.parse(cleanedContent);
                
                // Handle simple response objects
                if (parsed.message && typeof parsed.message === 'string') {
                    messageContent = parsed.message;
                } else if (parsed.response && typeof parsed.response === 'string') {
                    messageContent = parsed.response;
                } else if (Array.isArray(parsed)) {
                    // Array of events - extract the most important content
                    // Priority: speechdirect > speech > innerspeech > reply > actions
                    const speechdirectEvents = parsed.filter(e => e.type === 'speechdirect');
                    const speechEvents = parsed.filter(e => e.type === 'speech');
                    const innerspeechEvents = parsed.filter(e => e.type === 'innerspeech');
                    const replyEvents = parsed.filter(e => e.type === 'reply');
                    const actionEvents = parsed.filter(e => e.type === 'actions');
                    
                    if (speechdirectEvents.length > 0) {
                        messageContent = speechdirectEvents.map(e => e.content || e.text || '').join(' ');
                    } else if (speechEvents.length > 0) {
                        messageContent = speechEvents.map(e => e.content || e.text || '').join(' ');
                    } else if (innerspeechEvents.length > 0) {
                        messageContent = innerspeechEvents.map(e => e.content || e.text || '').join(' ');
                    } else if (replyEvents.length > 0) {
                        messageContent = replyEvents.map(e => e.content || e.text || '').join(' ');
                    } else if (actionEvents.length > 0) {
                        messageContent = actionEvents.map(e => e.content || e.text || '').join(' ');
                    } else if (parsed.length > 0 && parsed[0].content) {
                        messageContent = parsed[0].content;
                    }
                    
                    // Extract actions and sfx for display
                    if (actionEvents.length > 0) {
                        actions = actionEvents.map(e => e.content || '').join(', ');
                    }
                    const sfxEvents = parsed.filter(e => e.type === 'sfx');
                    if (sfxEvents.length > 0) {
                        sfx = sfxEvents.map(e => e.content || '').join(', ');
                    }
                } else if (parsed.type === 'myname' && parsed.content) {
                    messageContent = `My name is ${parsed.content}`;
                } else if (parsed.type === 'speechdirect' && parsed.content) {
                    messageContent = parsed.content;
                } else if (parsed.type === 'speech' && parsed.content) {
                    messageContent = parsed.content;
                } else if (parsed.type === 'innerspeech' && parsed.content) {
                    messageContent = parsed.content;
                } else if (parsed.type && parsed.content) {
                    messageContent = parsed.content;
                }
            } catch (e) {
                // Not valid JSON, use content as-is
                console.warn('Failed to parse message content as JSON:', e);
            }
        }
        
        if (jsonData) {
            // Priority: speechdirect > speech > innerspeech > reply > Description
            if (jsonData.speechdirect && jsonData.speechdirect.length > 0) {
                messageContent = jsonData.speechdirect.join(' ');
            } else if (jsonData.speech && jsonData.speech.length > 0) {
                messageContent = jsonData.speech.join(' ');
            } else if (jsonData.innerspeech && jsonData.innerspeech.length > 0) {
                messageContent = jsonData.innerspeech.join(' ');
            } else if (jsonData.reply && jsonData.reply.length > 0) {
                messageContent = jsonData.reply.join(' ');
            } else if (jsonData.Description) {
                messageContent = jsonData.Description;
            } else if (jsonData.myname && jsonData.myname.length > 0) {
                messageContent = `My name is ${jsonData.myname.join(' ')}`;
            }
            if (jsonData.actions && jsonData.actions.length > 0) {
                actions = jsonData.actions.join(', ');
            }
            if (jsonData.sfx && jsonData.sfx.length > 0) {
                sfx = jsonData.sfx.join(', ');
            }
        }
        
        // Check if actions and sfx should be visible
        const messagesContainer = document.getElementById('chatMessagesList');
        const showActionsSfx = messagesContainer && messagesContainer.classList.contains('show-actions-sfx');
        
        messageElement.innerHTML = `
            <img src="${avatarSrc}" alt="Avatar" class="chat-message-avatar">
            <div class="chat-message-content">
                <div class="chat-message-text">${this.escapeHtml(messageContent)}</div>
                ${(showActionsSfx && actions) ? `<div class="chat-message-actions">*${this.escapeHtml(actions)}*</div>` : ''}
                ${(showActionsSfx && sfx) ? `<div class="chat-message-sfx">~${this.escapeHtml(sfx)}~</div>` : ''}
            </div>
        `;
        
        container.appendChild(messageElement);
    }

    scrollToBottom() {
        const container = document.querySelector('.chat-messages-content .scrollable-content');
        if (container) {
            // With column-reverse, scrollTop 0 is the "bottom" (newest messages)
            container.scrollTop = 0;
        }
    }
    
    setupSentinelObserver() {
        // Clean up existing observer
        if (this.sentinelObserver) {
            this.sentinelObserver.disconnect();
        }
        
        // Create new observer for the sentinel
        this.sentinelObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && this.hasMoreMessages && !this.isLoadingMore) {
                    this.loadMoreMessages();
                }
            });
        }, {
            root: document.querySelector('.chat-messages-content .scrollable-content'),
            rootMargin: '100px', // Start loading 100px before sentinel is visible
            threshold: 0
        });
        
        // Observe the sentinel
        const sentinel = document.getElementById('chatLoadMoreSentinel');
        if (sentinel) {
            this.sentinelObserver.observe(sentinel);
        }
    }
    
    async loadMoreMessages() {
        if (this.isLoadingMore || !this.hasMoreMessages || !this.currentChatId) return;
        
        this.isLoadingMore = true;
        
        // Show loading state on sentinel
        const sentinel = document.getElementById('chatLoadMoreSentinel');
        if (sentinel) {
            sentinel.classList.add('loading');
        }
        
        try {
            // Get a reference message ID to track position
            const container = document.querySelector('.chat-messages-content .scrollable-content');
            const messageElements = container.querySelectorAll('.chat-message');
            let referenceMessageId = null;
            
            if (messageElements.length > 0) {
                // Get the first visible message's ID (or use a stable reference)
                const firstMessage = messageElements[messageElements.length - 1]; // Last in DOM (due to column-reverse)
                referenceMessageId = firstMessage.dataset.messageIndex || 0;
            }
            
            const oldScrollHeight = container.scrollHeight;
            const oldScrollTop = container.scrollTop;
            
            await this.loadChatMessages(true);
            
            // Restore scroll position (adjust for new content added)
            // With column-reverse, new content at DOM start increases scrollHeight
            const newScrollHeight = container.scrollHeight;
            const scrollDiff = newScrollHeight - oldScrollHeight;
            
            // Adjust scroll to maintain position
            container.scrollTop = oldScrollTop + scrollDiff;
            
            // Re-observe the new sentinel
            this.setupSentinelObserver();
        } catch (error) {
            console.error('Failed to load more messages:', error);
        } finally {
            this.isLoadingMore = false;
            if (sentinel) {
                sentinel.classList.remove('loading');
            }
        }
    }

    openPersonaSettingsModal() {
        if (typeof openLinkXiPersonaDsap === 'function') {
            openLinkXiPersonaDsap();
            return;
        }
        const modal = document.getElementById('personaSettingsModal');
        openModal(modal);
    }

    closePersonaSettingsModal() {
        const modal = document.getElementById('personaSettingsModal');
        closeModal(modal);
    }

    async savePersonaSettings() {
        const settings = {
            user_name: document.getElementById('personaUserName').value,
            backstory: document.getElementById('personaBackstory').value,
            default_verbosity: parseInt(document.getElementById('personaDefaultVerbosityHidden').value, 10) || 3,
            profile_photo_base64: this.personaSettings?.profile_photo_base64 || ''
        };
        
        try {
            const response = await window.wsClient.savePersonaSettings(settings);
            if (response.success) {
                this.personaSettings = settings;
                this.closePersonaSettingsModal();
                if (window.showToast) {
                    window.showToast('Persona settings saved successfully', 'success');
                }
            } else {
                throw new Error(response.message || 'Failed to save settings');
            }
        } catch (error) {
            console.error('Failed to save persona settings:', error);
            if (window.showToast) {
                window.showToast('Failed to save settings: ' + error.message, 'error');
            }
        }
    }

    handleProfilePhotoUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result.split(',')[1]; // Remove data:image/jpeg;base64, prefix
            this.personaSettings = this.personaSettings || {};
            this.personaSettings.profile_photo_base64 = base64;
            
            const preview = document.getElementById('personaProfilePhotoPreview');
            preview.innerHTML = `<img src="${e.target.result}" alt="Profile Photo">`;
        };
        reader.readAsDataURL(file);
    }

    async deleteChat() {
        if (!this.currentChatId) return;
        
        try {
            const response = await window.wsClient.deleteChatSession(this.currentChatId);
            if (response.success) {
                this.closeChatInterfaceModal();
                await this.loadChatSessions();
                if (window.showToast) {
                    window.showToast('Chat deleted successfully', 'success');
                }
            } else {
                throw new Error(response.message || 'Failed to delete chat');
            }
        } catch (error) {
            console.error('Failed to delete chat:', error);
            if (window.showToast) {
                window.showToast('Failed to delete chat: ' + error.message, 'error');
            }
        }
    }

    async restartChat() {
        if (!this.currentChatId) return;
        
        try {
            const response = await window.wsClient.restartChatSession(this.currentChatId);
            if (response.success) {
                // Clear current messages and reset pagination state
                this.messages = [];
                this.messagesOffset = 0;
                this.hasMoreMessages = true;
                await this.loadChatMessages();
                if (window.showToast) {
                    window.showToast('Chat restarted successfully', 'success');
                }
            } else {
                throw new Error(response.message || 'Failed to restart chat');
            }
        } catch (error) {
            console.error('Failed to restart chat:', error);
            if (window.showToast) {
                window.showToast('Failed to restart chat: ' + error.message, 'error');
            }
        }
    }

    formatTime(timestamp) {
        const date = new Date(timestamp * 1000);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return date.toLocaleDateString();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    autoResizeTextarea(textarea) {
        if (!textarea) return;
        
        // Reset height to auto to get the correct scrollHeight
        textarea.style.height = 'auto';
        
        // Set height to scrollHeight (content height)
        const newHeight = Math.min(textarea.scrollHeight, 200); // Max 200px
        textarea.style.height = newHeight + 'px';
    }

    formatStreamingActions(parsedContent) {
        let actionsHtml = '';
        
        if (parsedContent.actions && parsedContent.actions.length > 0) {
            actionsHtml += `<div class="chat-message-actions">*${this.escapeHtml(parsedContent.actions.join(', '))}*</div>`;
        }
        
        if (parsedContent.sfx && parsedContent.sfx.length > 0) {
            actionsHtml += `<div class="chat-message-sfx">~${this.escapeHtml(parsedContent.sfx.join(', '))}~</div>`;
        }
        
        return actionsHtml;
    }

    handleChatMessageResponse(message) {
        // Check if modal is open and this is the active chat
        if (!this.isChatInterfaceModalOpen() || !message.data || !message.data.success || message.data.chatId !== this.currentChatId) {
            return;
        }
        
        // Add the AI response to the UI
        this.addMessageToUI('assistant', message.data.rawResponse, message.data.response);
        this.scrollToBottom();
        
        // Reset loading state and send button
        this.resetSendButton();
        
        // Reload chat messages to ensure consistency
        this.loadChatMessages();
    }
    
    handleStreamingStart(message) {
        // Check if modal is open
        if (!this.isChatInterfaceModalOpen()) {
            return;
        }
        
        // Handle streaming for current chat OR pending chat (being created)
        const isCurrentChat = message.chatId && message.chatId === this.currentChatId;
        const isPendingChat = message.chatId && message.chatId === this.pendingChatId;
        
        // If this is a new chat being created, store the chatId and use it
        if (message.chatId && !this.currentChatId && !this.pendingChatId) {
            console.log(`✅ New chat detected from streaming start: ${message.chatId}`);
            this.pendingChatId = message.chatId;
        }
        
        // Only process if it's for the current or pending chat
        if (!isCurrentChat && !isPendingChat && message.chatId !== this.pendingChatId) {
            return;
        }
        
        // Use the chatId from the message (could be currentChatId or pendingChatId)
        const activeChatId = message.chatId;

        // Hide typing indicator if it's showing
        this.hideTypingIndicator();
        
        // Add a placeholder message for streaming
        const messagesContainer = document.getElementById('chatMessagesList');
        if (!messagesContainer) {
            console.error('❌ Chat messages container not found');
            return;
        }
        
        // Remove any existing streaming message for this chat
        const existingStreaming = document.getElementById(`streaming-${activeChatId}`);
        if (existingStreaming) {
            existingStreaming.remove();
        }
        
        const streamingMessage = document.createElement('div');
        streamingMessage.className = 'chat-message assistant streaming';
        streamingMessage.id = `streaming-${activeChatId}`;
        streamingMessage.dataset.accumulatedEvents = JSON.stringify([]); // Store accumulated events
        
        // For reasoning models, show live typing with thought process
        streamingMessage.innerHTML = `
            <div class="chat-message-content">
                <div class="chat-message-text">
                    <div class="director-typing-dots">
                        <div class="director-typing-dot"></div>
                        <div class="director-typing-dot"></div>
                        <div class="director-typing-dot"></div>
                    </div>
                </div>
            </div>
        `;
        
        messagesContainer.appendChild(streamingMessage);
        this.scrollToBottom();
    }
    
    handleStreamingUpdate(message) {
        // Check if modal is open
        if (!this.isChatInterfaceModalOpen()) {
            return;
        }
        
        // Handle streaming for current chat OR pending chat (being created)
        const isCurrentChat = message.chatId && message.chatId === this.currentChatId;
        const isPendingChat = message.chatId && message.chatId === this.pendingChatId;
        
        // If this is a new chat being created, store the chatId and use it
        if (message.chatId && !this.currentChatId && !this.pendingChatId) {
            console.log(`✅ New chat detected from streaming update: ${message.chatId}`);
            this.pendingChatId = message.chatId;
        }
        
        // Only process if it's for the current or pending chat
        if (!isCurrentChat && !isPendingChat && message.chatId !== this.pendingChatId) {
            return;
        }
        
        // Use the chatId from the message
        const activeChatId = message.chatId;
        
        let streamingElement = document.getElementById(`streaming-${activeChatId}`);
        if (!streamingElement) {
            // Streaming message not found, try to create it (streaming start might have been missed)
            console.log('⚠️ Streaming message not found, creating it from update');
            this.handleStreamingStart(message);
            // Re-fetch the element after creating it
            streamingElement = document.getElementById(`streaming-${activeChatId}`);
            if (!streamingElement) {
                console.error('❌ Failed to create streaming message');
                return;
            }
        }
        
        // Get accumulated events
        let accumulatedEvents = [];
        try {
            const stored = streamingElement.dataset.accumulatedEvents;
            if (stored) {
                accumulatedEvents = JSON.parse(stored);
            }
        } catch (e) {
            console.error('Failed to parse accumulated events:', e);
            accumulatedEvents = [];
        }
        
        // Add new events from this update
        if (message.events && Array.isArray(message.events)) {
            // Define visible event types (events that should be displayed)
            const visibleEventTypes = ['speechdirect', 'speech', 'reply', 'actions', 'sfx', 'myname'];
            
            // Check if this is the first update with displayable events
            const hasVisibleEvents = message.events.some(e => visibleEventTypes.includes(e.type) && e.content);
            const wasEmpty = accumulatedEvents.length === 0;
            
            // Hide typing indicator when first displayable content arrives
            if (hasVisibleEvents && wasEmpty) {
                this.hideTypingIndicator();
            }
            
            // Merge new events, avoiding duplicates based on timestamp and type
            message.events.forEach(newEvent => {
                const existingIndex = accumulatedEvents.findIndex(
                    e => e.timestamp === newEvent.timestamp && e.type === newEvent.type
                );
                if (existingIndex >= 0) {
                    // Update existing event
                    accumulatedEvents[existingIndex] = newEvent;
                } else {
                    // Add new event
                    accumulatedEvents.push(newEvent);
                }
            });
            
            // Sort by timestamp
            accumulatedEvents.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            
            // Update stored events
            streamingElement.dataset.accumulatedEvents = JSON.stringify(accumulatedEvents);
            
            // Render the accumulated events
            this.renderStreamingEvents(streamingElement, accumulatedEvents);
            
            // Scroll to bottom as content updates
            this.scrollToBottom();
        }
    }
    
    renderStreamingEvents(streamingMessage, events) {
        if (!events || events.length === 0) {
            // Show typing indicator if no events yet
            streamingMessage.innerHTML = `
                <div class="chat-message-content">
                    <div class="chat-message-text">
                        <div class="director-typing-dots">
                            <div class="director-typing-dot"></div>
                            <div class="director-typing-dot"></div>
                            <div class="director-typing-dot"></div>
                        </div>
                    </div>
                </div>
            `;
            return;
        }
        
        // Define which events are "4th wall metadata" (same as in renderEventGroup)
        const metadataEventTypes = ['memory', 'environment', 'sensory', 'emotion', 'location', 'timeofday', 'innerspeech', 'currplan', 'futureplans', 'trustlevel', 'inventory', 'offlinemessage'];
        const visibleEventTypes = ['speechdirect', 'speech', 'reply', 'actions', 'sfx', 'myname'];
        
        // Separate events into visible and metadata
        const visibleEvents = events.filter(e => visibleEventTypes.includes(e.type));
        const metadataEvents = events.filter(e => metadataEventTypes.includes(e.type));
        
        let contentHtml = '';
        
        // Render visible events as a single message bubble if present
        if (visibleEvents.length > 0) {
            let messageContent = '';
            let actions = '';
            let sfx = '';
            
            visibleEvents.forEach(event => {
                const eventType = event.type;
                const content = event.content;
                
                if (!content) return;
                
                switch(eventType) {
                    case 'speechdirect':
                        if (!messageContent) messageContent = content;
                        break;
                    case 'speech':
                        if (!messageContent) messageContent = content;
                        break;
                    case 'reply':
                        if (!messageContent) messageContent = content;
                        break;
                    case 'actions':
                        actions = content;
                        break;
                    case 'sfx':
                        sfx = content;
                        break;
                    case 'myname':
                        if (!messageContent) messageContent = `My name is ${content}`;
                        break;
                }
            });
            
            // Check if actions and sfx should be visible
            const messagesContainer = document.getElementById('chatMessagesList');
            const showActionsSfx = messagesContainer && messagesContainer.classList.contains('show-actions-sfx');
            
            // Only create message if there's actual content
            if (messageContent || (showActionsSfx && (actions || sfx))) {
                contentHtml += '<div class="chat-message-content">';
                if (messageContent) {
                    contentHtml += `<div class="chat-message-text">${this.escapeHtml(messageContent)}</div>`;
                }
                if (showActionsSfx && actions) {
                    contentHtml += `<div class="chat-message-actions">*${this.escapeHtml(actions)}*</div>`;
                }
                if (showActionsSfx && sfx) {
                    contentHtml += `<div class="chat-message-sfx">~${this.escapeHtml(sfx)}~</div>`;
                }
                contentHtml += '</div>';
            }
        }
        
        // Render metadata events (if metadata is visible)
        const messagesContainer = document.getElementById('chatMessagesList');
        const showMetadata = messagesContainer && messagesContainer.classList.contains('show-metadata');
        
        if (showMetadata && metadataEvents.length > 0) {
            const eventDisplayNames = {
                'memory': '🧠 Memory',
                'environment': '🌍 Environment',
                'sensory': '👁️ Sensory',
                'emotion': '💭 Emotion',
                'location': '📍 Location',
                'timeofday': '🕐 Time',
                'innerspeech': '💬 Inner Thought',
                'currplan': '📋 Current Plan',
                'futureplans': '🔮 Future Plans',
                'trustlevel': '🤝 Trust',
                'inventory': '🎒 Inventory',
                'offlinemessage': '📱 Message'
            };
            
            metadataEvents.forEach(event => {
                const eventLabel = eventDisplayNames[event.type] || event.type;
                contentHtml += `<div class="chat-message-content metadata-message ${event.type}">`;
                contentHtml += `<div class="metadata-label">${eventLabel}</div>`;
                contentHtml += `<div class="chat-message-text">${this.escapeHtml(event.content || '')}</div>`;
                contentHtml += '</div>';
            });
        }
        
        // If we have content, show it; otherwise show typing indicator
        if (contentHtml) {
            streamingMessage.innerHTML = contentHtml;
        } else {
            // Still processing, show typing indicator
            streamingMessage.innerHTML = `
                <div class="chat-message-content">
                    <div class="chat-message-text">
                        <div class="director-typing-dots">
                            <div class="director-typing-dot"></div>
                            <div class="director-typing-dot"></div>
                            <div class="director-typing-dot"></div>
                        </div>
                    </div>
                </div>
            `;
        }
    }
    
    handleStreamingComplete(message) {
        // Check if modal is open
        if (!this.isChatInterfaceModalOpen()) {
            return;
        }
        
        // Handle streaming for current chat OR pending chat (being created)
        const isCurrentChat = message.chatId && message.chatId === this.currentChatId;
        const isPendingChat = message.chatId && message.chatId === this.pendingChatId;
        
        // Only process if it's for the current or pending chat
        if (!isCurrentChat && !isPendingChat && message.chatId !== this.pendingChatId) {
            return;
        }
        
        // Clear pendingChatId once we have currentChatId
        if (this.pendingChatId && this.currentChatId) {
            this.pendingChatId = null;
        }

        
        const streamingMessage = document.getElementById(`streaming-${message.chatId}`);
        if (streamingMessage) {
            // Remove streaming indicator and reload messages to show final content
            streamingMessage.remove();
            this.loadChatMessages();
        }
        
        // Hide typing indicator
        this.hideTypingIndicator();
        
        // Reset loading state and send button
        this.resetSendButton();
    }
    
    showTypingIndicator() {
        const messagesContainer = document.getElementById('chatMessagesList');
        if (!messagesContainer) return;
        
        // Remove any existing typing indicator
        this.hideTypingIndicator();
        
        const typingMessage = document.createElement('div');
        typingMessage.className = 'chat-message assistant typing-indicator';
        typingMessage.id = 'typing-indicator';
        
        typingMessage.innerHTML = `
            <div class="chat-message-content">
                <div class="chat-message-text">
                    <div class="director-typing-dots">
                        <div class="director-typing-dot"></div>
                        <div class="director-typing-dot"></div>
                        <div class="director-typing-dot"></div>
                    </div>
                </div>
            </div>
        `;
        
        messagesContainer.appendChild(typingMessage);
        this.scrollToBottom();
    }
    
    hideTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
    
    showAllChats() {
        // Open the chat interface modal to show all chats
        this.openChatInterfaceModal();
        // Load all chat sessions (not filtered by filename)
        this.loadAllChatSessions();
    }

    async loadAllChatSessions() {
        try {
            const response = await window.wsClient.getChatSessions(); // No filename filter
            if (response.success) {
                this.chatSessions = response.sessions;
                this.renderChatSessions();
            }
        } catch (error) {
            console.error('Failed to load all chat sessions:', error);
        }
    }

    async handleContextMenuResetChat(chatId) {
        const restartConfirmed = await showConfirmationDialog(
            'Are you sure you want to restart this chat? This will clear all messages.',
            [
                { text: 'Restart Chat', value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ],
            null,
            { title: 'Restart Chat', icon: 'fas fa-redo' }
        );
        
        if (restartConfirmed) {
            try {
                const response = await window.wsClient.restartChatSession(chatId);
                if (response.success) {
                    if (window.showToast) {
                        window.showToast('Chat restarted successfully', 'success');
                    }
                    
                    // If this is the current chat, reload messages
                    if (chatId === this.currentChatId) {
                        this.messages = [];
                        this.messagesOffset = 0;
                        this.hasMoreMessages = true;
                        await this.loadChatMessages();
                    }
                    
                    // Reload chat sessions to update UI
                    await this.loadAllChatSessions();
                } else {
                    throw new Error(response.message || 'Failed to restart chat');
                }
            } catch (error) {
                console.error('Failed to restart chat:', error);
                if (window.showToast) {
                    window.showToast('Failed to restart chat: ' + error.message, 'error');
                }
            }
        }
    }

    async handleContextMenuDeleteChat(chatId) {
        const deleteConfirmed = await showConfirmationDialog(
            'Are you sure you want to delete this chat? This action cannot be undone.',
            [
                { text: 'Delete Chat', value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );
        
        if (deleteConfirmed) {
            try {
                const response = await window.wsClient.deleteChatSession(chatId);
                
                if (response.success) {
                    if (window.showToast) {
                        window.showToast('Chat deleted successfully', 'success');
                    }
                    
                    // If this was the current chat, clear it
                    if (chatId === this.currentChatId) {
                        this.currentChatId = null;
                        this.currentFilename = null;
                        this.messages = [];
                        
                        // Clear messages list
                        const messagesList = document.getElementById('chatMessagesList');
                        if (messagesList) {
                            messagesList.innerHTML = '';
                        }
                    }
                    
                    // Reload chat sessions
                    await this.loadAllChatSessions();
                } else {
                    throw new Error(response.message || 'Failed to delete chat');
                }
            } catch (error) {
                console.error('Failed to delete chat:', error);
                if (window.showToast) {
                    window.showToast('Failed to delete chat: ' + error.message, 'error');
                }
            }
        }
    }

    // Helper method to check if chat interface modal is open
    isChatInterfaceModalOpen() {
        const modal = document.getElementById('chatInterfaceModal');
        return modal && !modal.classList.contains('hidden');
    }

    // Helper method to reset send button and loading state
    resetSendButton() {
        this.isLoading = false;
        const sendBtn = document.getElementById('chatSendBtn');
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="mdi mdi-1-5 mdi-send"></i>';
        }
    }

    // Helper method to ensure send button is enabled when user is typing
    ensureSendButtonEnabled() {
        // Only enable if we have a current chat and we're not loading
        if (this.currentChatId && !this.isLoading) {
            const sendBtn = document.getElementById('chatSendBtn');
            if (sendBtn && sendBtn.disabled) {
                sendBtn.disabled = false;
                sendBtn.innerHTML = '<i class="mdi mdi-1-5 mdi-send"></i>';
            }
        }
    }
}

if (window.wsClient) {
    window.wsClient.registerInitStep(88, 'Setting up chat system', async () => {
        try {
            // Ensure WebSocket is connected before initializing
            if (!window.wsClient.isConnected()) {
                console.warn('⚠️ WebSocket not connected when initializing chat system, waiting...');
                // Wait up to 10 seconds for connection
                let attempts = 0;
                while (!window.wsClient.isConnected() && attempts < 10) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    attempts++;
                }
            }

            // Create chat system instance
            if (!window.chatSystem) {
                window.chatSystem = new ChatSystem();
                console.log('✅ Chat system initialized');
            } else {
                console.log('ℹ️ Chat system already exists, skipping re-initialization');
            }
        } catch (error) {
            console.error('❌ Failed to initialize chat system:', error);
            // Still create the instance so the UI doesn't break
            if (!window.chatSystem) {
                window.chatSystem = new ChatSystem();
            }
        }
    });
} else {
    console.error('❌ WebSocket client not available when chatSystem.js loaded');
    // Try to initialize later when wsClient becomes available
    const initInterval = setInterval(() => {
        if (window.wsClient) {
            clearInterval(initInterval);
            window.wsClient.registerInitStep(88, 'Setting up chat system', async () => {
                if (!window.chatSystem) {
                    window.chatSystem = new ChatSystem();
                }
            });
        }
    }, 500);
    
    // Give up after 30 seconds
    setTimeout(() => clearInterval(initInterval), 30000);
}

// Export for use in other scripts
window.ChatSystem = ChatSystem;
