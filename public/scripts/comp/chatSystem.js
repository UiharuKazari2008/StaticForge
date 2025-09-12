// Chat System JavaScript
class ChatSystem {
    constructor() {
        this.currentChatId = null;
        this.currentFilename = null;
        this.personaSettings = null;
        this.chatSessions = [];
        this.messages = [];
        this.isLoading = false;
        
        this.initializeWithPersonaSettings();
        this.initializeEventListeners();
    }

    initializeEventListeners() {
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
        
        // Ensure send button is enabled when typing in the input
        document.getElementById('chatMessageInput')?.addEventListener('input', () => {
            this.ensureSendButtonEnabled();
        });
        
        // Persona settings modal events
        document.getElementById('closePersonaSettingsBtn')?.addEventListener('click', () => this.closePersonaSettingsModal());
        document.getElementById('savePersonaSettingsBtn')?.addEventListener('click', () => this.savePersonaSettings());
        document.getElementById('personaProfilePhoto')?.addEventListener('change', (e) => this.handleProfilePhotoUpload(e));
        document.getElementById('personaProfilePhotoPreview')?.addEventListener('click', () => {
            document.getElementById('personaProfilePhoto').click();
        });
        
        // Chat history button
        document.getElementById('chatHistoryBtn')?.addEventListener('click', () => this.showChatHistory());
        
        // Chat restart button
        document.getElementById('chatRestartBtn')?.addEventListener('click', () => this.handleRestartButtonClick());
        
        // Chat delete button
        document.getElementById('chatDeleteBtn')?.addEventListener('click', () => this.handleDeleteButtonClick());
        
        // Persona settings button
        document.getElementById('personaSettingsBtn')?.addEventListener('click', () => this.openPersonaSettingsModal());
        
        // All chats button
        document.getElementById('allChatsBtn')?.addEventListener('click', () => this.showAllChats());
        
        // Temperature slider handler
        document.getElementById('chatTemperature')?.addEventListener('input', (e) => {
            document.getElementById('chatTemperatureValue').textContent = e.target.value;
        });
        
        // Persona default temperature slider handler
        document.getElementById('personaDefaultTemperature')?.addEventListener('input', (e) => {
            document.getElementById('personaDefaultTemperatureValue').textContent = e.target.value;
        });
    }

    async initializeWithPersonaSettings() {
        try {
            // Load persona settings first
            await this.loadPersonaSettings();
            
            // Then initialize model dropdowns with the correct default
            await this.initializeModelDropdowns();
        } catch (error) {
            console.error('Failed to initialize with persona settings:', error);
            // Fallback to basic initialization
            await this.initializeModelDropdowns();
        }
    }

    async loadPersonaSettings() {
        try {
            const response = await window.wsClient.getPersonaSettings();
            if (response.success) {
                this.personaSettings = response.settings;
                this.populatePersonaSettingsForm();
            }
        } catch (error) {
            console.error('Failed to load persona settings:', error);
        }
    }

    populatePersonaSettingsForm() {
        if (!this.personaSettings) return;
        
        document.getElementById('personaUserName').value = this.personaSettings.user_name || '';
        document.getElementById('personaBackstory').value = this.personaSettings.backstory || '';
        document.getElementById('personaDefaultVerbosity').value = this.personaSettings.default_verbosity || 3;
        // Set the selected model in the dropdown
        const selectedElement = document.getElementById('personaDefaultAIEngineSelected');
        if (selectedElement) {
            // Use new provider/model structure if available, fallback to legacy
            const provider = this.personaSettings.default_ai_provider || 'grok';
            const model = this.personaSettings.default_ai_model || this.personaSettings.default_ai_engine || 'grok-2';
            const modelId = this.personaSettings.default_ai_engine || 'grok-2';
            
            selectedElement.dataset.value = modelId;
            selectedElement.dataset.provider = provider;
            selectedElement.dataset.model = model;
            
            // Update the display using the new method
            this.selectPersonaDefaultAIEngine(modelId);
        }
        document.getElementById('personaDefaultTemperature').value = this.personaSettings.default_temperature || 0.8;
        document.getElementById('personaDefaultTemperatureValue').textContent = this.personaSettings.default_temperature || 0.8;
        document.getElementById('personaDefaultReasoningLevel').value = this.personaSettings.default_reasoning_level || 'medium';
        
        // Set profile photo if exists
        if (this.personaSettings.profile_photo_base64) {
            const preview = document.getElementById('personaProfilePhotoPreview');
            preview.innerHTML = `<img src="data:image/jpeg;base64,${this.personaSettings.profile_photo_base64}" alt="Profile Photo">`;
        }
    }

    openChatModal(filename, characterName = null) {
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
        document.getElementById('chatViewerContext').value = '';
        document.getElementById('chatVerbosity').value = this.personaSettings?.default_verbosity || 3;
        
        // AI model dropdown should already be initialized with the correct default
        
        document.getElementById('chatTemperature').value = this.personaSettings?.default_temperature || 0.8;
        document.getElementById('chatTemperatureValue').textContent = this.personaSettings?.default_temperature || 0.8;
        document.getElementById('chatThoughtLevel').value = this.personaSettings?.default_reasoning_level || 'medium';
        
        // Initialize model-specific controls
        this.handleAIModelChange();
        
        // Temperature control is now always visible for all models
        
        // Open modal
        const modal = document.getElementById('chatModal');
        modal.classList.remove('hidden');
        document.body.classList.add('modal-open');
    }

    closeChatModal() {
        const modal = document.getElementById('chatModal');
        modal.classList.add('hidden');
        document.body.classList.remove('modal-open');
    }

    async startChat() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        const startBtn = document.getElementById('startChatBtn');
        startBtn.disabled = true;
        startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';
        
        try {
            // Use the chat interface model dropdown if available, otherwise fall back to chat creation modal
            let selectedElement = document.getElementById('chatModelSelected');
            let selectedModel, provider, model;
            
            if (selectedElement && selectedElement.dataset.value) {
                // Use chat interface model dropdown
                selectedModel = selectedElement.dataset.value;
                provider = selectedElement.dataset.provider || 'grok';
                model = selectedElement.dataset.model || selectedModel;
            } else {
                // Fall back to chat creation modal dropdown
                selectedElement = document.getElementById('chatAIModelSelected');
                selectedModel = selectedElement?.dataset.value || 'grok-2';
                provider = selectedElement?.dataset.provider || 'grok';
                model = selectedElement?.dataset.model || selectedModel;
            }
            
            const chatData = {
                filename: this.currentFilename,
                characterName: document.getElementById('chatName').value || null,
                textContextInfo: document.getElementById('chatMindSeed').value || null,
                textViewerInfo: document.getElementById('chatViewerContext').value || null,
                verbosityLevel: parseInt(document.getElementById('chatVerbosity').value) || 3,
                provider: provider,
                model: model
            };
            
            // Add appropriate parameter based on model
            if (selectedModel === 'gpt-5-nano' || selectedModel === 'gpt-5') {
                chatData.thoughtLevel = document.getElementById('chatThoughtLevel').value || 'minimal';
            } else {
                chatData.temperature = parseFloat(document.getElementById('chatTemperature').value) || 0.8;
            }
            
            const response = await window.wsClient.createChatSession(chatData);
            
            if (response.success) {
                this.currentChatId = response.chatId;
                this.closeChatModal();
                this.openChatInterfaceModal();
                await this.loadAllChatSessions();
                
                // Update the chat name display
                const chatNameElement = document.getElementById('currentChatName');
                if (chatNameElement) {
                    const chatName = document.getElementById('chatName').value || 
                                   document.getElementById('chatCharacterName').textContent || 
                                   'New Chat';
                    chatNameElement.textContent = chatName;
                }
                
                // Load initial messages and wait for AI response
                await this.loadChatMessages();
                
                // Show typing indicator while waiting for AI response
                this.showTypingIndicator();
                
                // Ensure send button is ready after chat creation
                this.resetSendButton();
            } else {
                throw new Error(response.message || 'Failed to create chat session');
            }
        } catch (error) {
            console.error('Failed to start chat:', error);
            // Show error toast
            if (window.showToast) {
                window.showToast('Failed to start chat: ' + error.message, 'error');
            }
        } finally {
            this.isLoading = false;
            startBtn.disabled = false;
            startBtn.innerHTML = '<span>Start Conversation</span><i class="mdi mdi-1-5 mdi-chat"></i>';
        }
    }

    openChatInterfaceModal() {
        const modal = document.getElementById('chatInterfaceModal');
        modal.classList.remove('hidden');
        document.body.classList.add('modal-open');
        
        // Reset send button state when opening modal
        this.resetSendButton();
        
        // If no chat is selected, set the model dropdown to show all models
        if (!this.currentChatId) {
            const defaultModel = this.personaSettings?.default_ai_engine || 'grok-2';
            this.selectChatInterfaceModel(defaultModel);
        }
    }

    closeChatInterfaceModal() {
        const modal = document.getElementById('chatInterfaceModal');
        modal.classList.add('hidden');
        document.body.classList.remove('modal-open');
        this.currentChatId = null;
        this.messages = [];
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
                    <img src="/previews/${encodeURIComponent(session.filename.replace(/\.(jpg|jpeg|png|webp)$/i, ''))}.jpg" alt="Character" class="chat-session-avatar" 
                         onerror="this.src='/static_images/icon-96x96.png'">
                    <div class="chat-session-info">
                        <div class="chat-session-name">${session.chat_name || session.character_name || 'Unnamed Chat'}</div>
                        <div class="chat-session-last-message">Click to open conversation</div>
                    </div>
                    <div class="chat-session-time">${this.formatTime(session.updated_at)}</div>
                </div>
            `;
            
            sessionElement.addEventListener('click', () => this.selectChatSession(session.id));
            container.appendChild(sessionElement);
        });
    }

    async selectChatSession(chatId) {
        this.currentChatId = chatId;
        
        // Find the selected session to get its name and filename
        const selectedSession = this.chatSessions.find(session => session.id === chatId);
        if (selectedSession) {
            // Update the chat name display
            const chatNameElement = document.getElementById('currentChatName');
            if (chatNameElement) {
                chatNameElement.textContent = selectedSession.chat_name || selectedSession.character_name || 'Unnamed Chat';
            }
            
            // Set the current filename for image display
            this.currentFilename = selectedSession.filename;

            // Update the model dropdown to show the current chat's model
            // This will also refresh the dropdown to only show models from the current provider
            if (selectedSession.model) {
                this.selectChatInterfaceModel(selectedSession.model);
            } else {
                // If no model is set, use the provider to set a default model
                const defaultModel = this.getDefaultModelForProvider(selectedSession.provider);
                if (defaultModel) {
                    this.selectChatInterfaceModel(defaultModel);
                }
            }
        }
        
        await this.loadChatMessages();
        this.renderChatSessions(); // Re-render to update active state
        
        // Reset send button state when selecting a chat session
        this.resetSendButton();
    }

    async loadChatMessages() {
        if (!this.currentChatId) return;
        
        try {
            const response = await window.wsClient.getChatMessages(this.currentChatId, 50, 0);
            
            if (response.success) {
                this.messages = response.messages.reverse(); // Reverse to show oldest first
                this.renderChatMessages();
                this.scrollToBottom();
                
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
        
        this.messages.forEach(message => {
            const messageElement = document.createElement('div');
            messageElement.className = `chat-message ${message.message_type}`;
            
            let avatarSrc = '/static_images/icon-96x96.png';
            if (message.message_type === 'user' && this.personaSettings?.profile_photo_base64) {
                avatarSrc = `data:image/jpeg;base64,${this.personaSettings.profile_photo_base64}`;
            } else if (message.message_type === 'assistant') {
                avatarSrc = `/images/${this.currentFilename}`;
            }
            
            let messageContent = message.content;
            let actions = '';
            let sfx = '';
            
            // Parse JSON data if available
            if (message.json_data) {
                try {
                    const jsonData = JSON.parse(message.json_data);
                    
                    // Handle new response structure with individual object keys
                    if (jsonData.Description) {
                        messageContent = jsonData.Description;
                    } else if (jsonData.reply && jsonData.reply.length > 0) {
                        // Fallback to old structure for backward compatibility
                        messageContent = jsonData.reply.join(' ');
                    }
                    if (jsonData.actions && jsonData.actions.length > 0) {
                        actions = jsonData.actions.join(', ');
                    }
                    if (jsonData.sfx && jsonData.sfx.length > 0) {
                        sfx = jsonData.sfx.join(', ');
                    }
                } catch (e) {
                    // Use raw content if JSON parsing fails
                }
            }
            
            messageElement.innerHTML = `
                <img src="${avatarSrc}" alt="Avatar" class="chat-message-avatar">
                <div class="chat-message-content">
                    <div class="chat-message-text">${this.escapeHtml(messageContent)}</div>
                    ${actions ? `<div class="chat-message-actions">*${this.escapeHtml(actions)}*</div>` : ''}
                    ${sfx ? `<div class="chat-message-sfx">~${this.escapeHtml(sfx)}~</div>` : ''}
                </div>
            `;
            
            container.appendChild(messageElement);
        });
    }

    async sendMessage() {
        const input = document.getElementById('chatMessageInput');
        const message = input.value.trim();
        
        if (!message || !this.currentChatId || this.isLoading) return;
        
        this.isLoading = true;
        const sendBtn = document.getElementById('chatSendBtn');
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        // Add user message to UI immediately
        this.addMessageToUI('user', message);
        input.value = '';
        this.scrollToBottom();
        
        try {
            // Send the message
            const response = await window.wsClient.sendChatMessage(this.currentChatId, message);
            
            if (response.success) {
                // If streaming is disabled, add the response directly to UI
                // If streaming is enabled, the streaming events will handle the UI updates
                if (!response.streaming) {
                    // Add AI response to UI for non-streaming mode
                    this.addMessageToUI('assistant', response.rawResponse, response.response);
                    
                    // Reset loading state for non-streaming mode
                    this.isLoading = false;
                    sendBtn.disabled = false;
                    sendBtn.innerHTML = '<i class="mdi mdi-1-5 mdi-send"></i>';
                    this.scrollToBottom();
                }
                // For streaming mode, the loading state will be reset by handleStreamingComplete
            } else {
                throw new Error(response.error || 'Failed to send message');
            }
        } catch (error) {
            console.error('Failed to send message:', error);
            // Show error message
            this.addMessageToUI('assistant', 'I apologize, but I encountered an error processing your message.');
            
            // Reset loading state on error
            this.isLoading = false;
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="mdi mdi-1-5 mdi-send"></i>';
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
        
        if (jsonData) {
            if (jsonData.reply && jsonData.reply.length > 0) {
                messageContent = jsonData.reply.join(' ');
            }
            if (jsonData.actions && jsonData.actions.length > 0) {
                actions = jsonData.actions.join(', ');
            }
            if (jsonData.sfx && jsonData.sfx.length > 0) {
                sfx = jsonData.sfx.join(', ');
            }
        }
        
        messageElement.innerHTML = `
            <img src="${avatarSrc}" alt="Avatar" class="chat-message-avatar">
            <div class="chat-message-content">
                <div class="chat-message-text">${this.escapeHtml(messageContent)}</div>
                ${actions ? `<div class="chat-message-actions">*${this.escapeHtml(actions)}*</div>` : ''}
                ${sfx ? `<div class="chat-message-sfx">~${this.escapeHtml(sfx)}~</div>` : ''}
            </div>
        `;
        
        container.appendChild(messageElement);
    }

    scrollToBottom() {
        const container = document.getElementById('chatMessagesList');
        container.scrollTop = container.scrollHeight;
    }

    openPersonaSettingsModal() {
        const modal = document.getElementById('personaSettingsModal');
        modal.classList.remove('hidden');
        document.body.classList.add('modal-open');
    }

    closePersonaSettingsModal() {
        const modal = document.getElementById('personaSettingsModal');
        modal.classList.add('hidden');
        document.body.classList.remove('modal-open');
    }

    async savePersonaSettings() {
        const selectedElement = document.getElementById('personaDefaultAIEngineSelected');
        const selectedModel = selectedElement?.dataset.value || 'grok-2';
        const provider = selectedElement?.dataset.provider || 'grok';
        const model = selectedElement?.dataset.model || selectedModel;
        
        const settings = {
            user_name: document.getElementById('personaUserName').value,
            backstory: document.getElementById('personaBackstory').value,
            default_verbosity: parseInt(document.getElementById('personaDefaultVerbosity').value),
            default_ai_engine: selectedModel, // Keep for backward compatibility
            default_ai_provider: provider,
            default_ai_model: model,
            default_temperature: parseFloat(document.getElementById('personaDefaultTemperature').value),
            default_reasoning_level: document.getElementById('personaDefaultReasoningLevel').value,
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
    
    handleAIModelChange(selectedModel = null) {
        // Get selected model from parameter or from dropdown
        if (!selectedModel) {
            const selectedElement = document.getElementById('chatAIModelSelected');
            selectedModel = selectedElement?.dataset.value || 'grok-2';
        }
        
        const temperatureGroup = document.getElementById('chatTemperatureGroup');
        const thoughtLevelGroup = document.getElementById('chatThoughtLevelGroup');
        
        // Show/hide appropriate controls based on model
        if (selectedModel === 'gpt-5-nano' || selectedModel === 'gpt-5') {
            // GPT-5 models use thought level instead of temperature
            temperatureGroup.style.display = 'none';
            thoughtLevelGroup.style.display = 'block';
        } else {
            // Other models use temperature
            temperatureGroup.style.display = 'block';
            thoughtLevelGroup.style.display = 'none';
        }
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
                // Clear current messages and reload
                this.messages = [];
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

        // Check if modal is open and this is the active chat
        if (!this.isChatInterfaceModalOpen() || message.chatId !== this.currentChatId) {
            return;
        }

        // Hide typing indicator if it's showing
        this.hideTypingIndicator();
        
        // Determine if this is a reasoning model
        const isReasoning = this.isCurrentModelReasoning();
        
        // Add a placeholder message for streaming
        const messagesContainer = document.getElementById('chatMessagesList');
        if (!messagesContainer) {
            console.error('❌ Chat messages container not found');
            return;
        }
        
        const streamingMessage = document.createElement('div');
        streamingMessage.className = 'chat-message assistant streaming';
        streamingMessage.id = `streaming-${message.chatId}`;
        streamingMessage.dataset.isReasoning = isReasoning;
                
        let avatarSrc = '/static_images/icon-96x96.png';
        if (this.currentFilename) {
            avatarSrc = `/previews/${encodeURIComponent(this.currentFilename.replace(/\.(jpg|jpeg|png|webp)$/i, ''))}.jpg`;
        }
        
        if (isReasoning) {
            // For reasoning models, show live typing with thought process
            streamingMessage.innerHTML = `
                <img src="${avatarSrc}" alt="Avatar" class="chat-message-avatar">
                <div class="chat-message-content">
                    <div class="chat-message-text">
                        <div class="reasoning-header">
                            <i class="fa-light fa-head-side-brain reasoning-icon"></i>
                            <span class="reasoning-label">AI is thinking...</span>
                        </div>
                        <div class="reasoning-content">
                            <div class="reasoning-text">${message.message || 'Processing your request...'}</div>
                            <div class="streaming-indicator">
                                <span class="streaming-cursor">|</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // For non-reasoning models, show bouncing dots
            streamingMessage.innerHTML = `
                <img src="${avatarSrc}" alt="Avatar" class="chat-message-avatar">
                <div class="chat-message-content">
                    <div class="chat-message-text">
                        <div class="streaming-content">
                            <div class="streaming-text">${message.message || 'Generating response...'}</div>
                        </div>
                        <div class="streaming-indicator">
                            <div class="bouncing-dots">
                                <div class="bouncing-dot"></div>
                                <div class="bouncing-dot"></div>
                                <div class="bouncing-dot"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        messagesContainer.appendChild(streamingMessage);
        this.scrollToBottom();
    }
    
    handleStreamingUpdate(message) {
        // Check if modal is open and this is the active chat
        if (!this.isChatInterfaceModalOpen() || message.chatId !== this.currentChatId) {
            return;
        }

        const streamingMessage = document.getElementById(`streaming-${message.chatId}`);
        
        if (!streamingMessage) {
            return;
        }

        const isReasoning = streamingMessage.dataset.isReasoning === 'true';
        
        if (isReasoning) {
            // For reasoning models, show the thought process
            const reasoningText = streamingMessage.querySelector('.reasoning-text');
            if (reasoningText) {
                // Show the raw response as it streams (thought process)
                reasoningText.textContent = message.fullResponse || message.chunk || 'Processing...';
            }
        } else {
            // For non-reasoning models, show formatted content
            const messageText = streamingMessage.querySelector('.chat-message-text');
            
            // Try to parse the JSON response to show formatted content
            let displayContent = message.fullResponse;
            let parsedContent = null;
            
            try {
                parsedContent = JSON.parse(message.fullResponse);
                if (parsedContent.reply && parsedContent.reply.length > 0) {
                    displayContent = parsedContent.reply.join(' ');
                }
            } catch (e) {
                console.warn('⚠️ JSON parse failed, using raw content');
            }
            
            const streamingContent = messageText.querySelector('.streaming-content');
            if (streamingContent) {
                streamingContent.innerHTML = `
                    <div class="streaming-text">${this.escapeHtml(displayContent)}</div>
                    ${parsedContent ? this.formatStreamingActions(parsedContent) : ''}
                `;
            }
        }
        
        this.scrollToBottom();
    }
    
    handleStreamingComplete(message) {
        // Check if modal is open and this is the active chat
        if (!this.isChatInterfaceModalOpen() || message.chatId !== this.currentChatId) {
            return;
        }

        
        const streamingMessage = document.getElementById(`streaming-${message.chatId}`);
        if (streamingMessage) {
            const isReasoning = streamingMessage.dataset.isReasoning === 'true';
            
            if (isReasoning) {
                // For reasoning models, show a brief "Processing complete" message
                const reasoningText = streamingMessage.querySelector('.reasoning-text');
                if (reasoningText) {
                    reasoningText.textContent = 'Processing complete... Generating final response...';
                }
                
                // Wait a moment then replace with final message
                setTimeout(() => {
                    streamingMessage.remove();
                    this.loadChatMessages();
                }, 1000);
            } else {
                // For non-reasoning models, remove immediately and reload
                streamingMessage.remove();
                this.loadChatMessages();
            }
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
        
        let avatarSrc = '/static_images/icon-96x96.png';
        if (this.currentFilename) {
            avatarSrc = `/previews/${encodeURIComponent(this.currentFilename.replace(/\.(jpg|jpeg|png|webp)$/i, ''))}.jpg`;
        }
        
        typingMessage.innerHTML = `
            <div class="chat-message-avatar">
                <img src="${avatarSrc}" alt="AI Avatar" onerror="this.src='/static_images/icon-96x96.png'">
            </div>
            <div class="chat-message-content">
                <div class="chat-message-text">
                    <div class="typing-dots">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                    <span class="typing-text">AI is thinking...</span>
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
    
    isCurrentModelReasoning() {
        // Get the current model from the dropdown
        const selectedElement = document.getElementById('chatAIModelSelected');
        if (!selectedElement) return false;
        
        const modelId = selectedElement.dataset.value;
        if (!modelId) return false;
        
        // Use model manager if available
        if (window.modelManager && window.modelManager.isReasoningModel) {
            return window.modelManager.isReasoningModel(modelId);
        }
        
        // Fallback: check against known reasoning models
        const reasoningModels = [
            'gpt-5-nano',
            'gpt-5',
            'o1-preview',
            'o1-mini',
            'o4-high',
            'gpt-o4'
        ];
        return reasoningModels.includes(modelId);
    }

    showChatHistory() {
        // Show all chat sessions in a modal or expand the chat list panel
        if (window.showToast) {
            window.showToast('Chat history feature coming soon!', 'info');
        }
        // TODO: Implement chat history modal or expand chat list
        console.log('Chat history requested');
    }

    async handleRestartButtonClick() {
        if (!this.currentChatId) {
            if (window.showToast) {
                window.showToast('No active chat to restart', 'warning');
            }
            return;
        }

        const restartConfirmed = await showConfirmationDialog(
            'Are you sure you want to restart this chat? This will clear all messages.',
            [
                { text: 'Restart Chat', value: true, className: 'btn-primary' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );
        
        if (restartConfirmed) {
            await this.restartChat();
        }
    }
    
    async handleDeleteButtonClick() {
        if (!this.currentChatId) {
            if (window.showToast) {
                window.showToast('No active chat to delete', 'warning');
            }
            return;
        }
        
        const deleteConfirmed = await showConfirmationDialog(
            'Are you sure you want to delete this chat? This action cannot be undone.',
            [
                { text: 'Delete Chat', value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );
        
        if (deleteConfirmed) {
            try {
                const response = await window.wsClient.deleteChatSession(this.currentChatId);
                
                if (response.success) {
                    if (window.showToast) {
                        window.showToast('Chat deleted successfully', 'success');
                    }
                    
                    // Clear current chat and reload sessions
                    this.currentChatId = null;
                    this.currentFilename = null;
                    this.messages = [];
                    
                    // Update UI
                    const chatNameElement = document.getElementById('currentChatName');
                    if (chatNameElement) {
                        chatNameElement.textContent = 'Select a conversation';
                    }
                    
                    // Clear messages list
                    const messagesList = document.getElementById('chatMessagesList');
                    if (messagesList) {
                        messagesList.innerHTML = '';
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

    showAllChats() {
        // Open the chat interface modal to show all chats
        this.openChatInterfaceModal();
        // Load all chat sessions (not filtered by filename)
        this.loadAllChatSessions();
    }

    async initializeModelDropdowns() {
        try {            
            // Wait for model manager to be available
            if (!window.modelManager) {
                return;
            }

            // Get available models
            const models = await window.modelManager.getAvailableModels();
            
            // Get default model from persona settings
            const defaultModel = this.personaSettings?.default_ai_engine || 'grok-2';

            // Setup chat AI model dropdown using standard system
            this.setupChatAIModelDropdown(models, defaultModel);

            // Setup chat interface model dropdown using standard system
            this.setupChatInterfaceModelDropdown(models, defaultModel);

            // Setup persona default AI engine dropdown using standard system
            this.setupPersonaDefaultAIEngineDropdown(models, defaultModel);
        } catch (error) {
            console.error('Failed to initialize model dropdowns:', error);
        }
    }

    setupChatAIModelDropdown(models, defaultValue) {
        const container = document.getElementById('chatAIModelDropdown');
        const button = document.getElementById('chatAIModelBtn');
        const menu = document.getElementById('chatAIModelMenu');
        
        if (!container || !button || !menu) {
            console.error('Chat AI model dropdown elements not found');
            return;
        }

        // Get model groups
        const modelGroups = this.getModelGroups();
        
        // Render function for grouped dropdown
        const renderChatAIModelDropdown = (selectedValue) => {
            renderGroupedDropdown(
                menu,
                modelGroups,
                this.selectChatAIModel.bind(this),
                this.closeChatAIModelDropdown.bind(this),
                selectedValue,
                this.renderModelOptionContent.bind(this)
            );
        };

        // Get selected value function
        const getSelectedValue = () => {
            const selectedElement = document.getElementById('chatAIModelSelected');
            return selectedElement?.dataset.value || defaultValue;
        };

        // Setup dropdown
        setupDropdown(container, button, menu, renderChatAIModelDropdown, getSelectedValue, {
            preventFocusTransfer: true
        });

        // Set initial value
        this.selectChatAIModel(defaultValue);
    }

    setupChatInterfaceModelDropdown(models, defaultValue) {
        const container = document.getElementById('chatModelDropdown');
        const button = document.getElementById('chatModelBtn');
        const menu = document.getElementById('chatModelMenu');
        
        if (!container || !button || !menu) {
            console.error('Chat interface model dropdown elements not found');
            return;
        }

        // Render function for grouped dropdown - will be updated when chat is selected
        const renderChatInterfaceModelDropdown = (selectedValue) => {
            // Get filtered model groups based on current chat's provider
            const modelGroups = this.getFilteredModelGroups();
            renderGroupedDropdown(
                menu,
                modelGroups,
                this.selectChatInterfaceModel.bind(this),
                this.closeChatInterfaceModelDropdown.bind(this),
                selectedValue,
                this.renderModelOptionContent.bind(this)
            );
        };

        // Get selected value function
        const getSelectedValue = () => {
            const selectedElement = document.getElementById('chatModelSelected');
            return selectedElement?.dataset.value || defaultValue;
        };

        // Setup dropdown
        setupDropdown(container, button, menu, renderChatInterfaceModelDropdown, getSelectedValue, {
            preventFocusTransfer: true
        });

        // Set initial value
        this.selectChatInterfaceModel(defaultValue);
    }

    setupPersonaDefaultAIEngineDropdown(models, defaultValue) {
        const container = document.getElementById('personaDefaultAIEngineDropdown');
        const button = document.getElementById('personaDefaultAIEngineBtn');
        const menu = document.getElementById('personaDefaultAIEngineMenu');
        
        if (!container || !button || !menu) {
            console.error('Persona default AI engine dropdown elements not found');
            return;
        }

        // Get model groups
        const modelGroups = this.getModelGroups();
        
        // Render function for grouped dropdown
        const renderPersonaDefaultAIEngineDropdown = (selectedValue) => {
            renderGroupedDropdown(
                menu,
                modelGroups,
                this.selectPersonaDefaultAIEngine.bind(this),
                this.closePersonaDefaultAIEngineDropdown.bind(this),
                selectedValue,
                this.renderModelOptionContent.bind(this)
            );
        };

        // Get selected value function
        const getSelectedValue = () => {
            const selectedElement = document.getElementById('personaDefaultAIEngineSelected');
            return selectedElement?.dataset.value || defaultValue;
        };

        // Setup dropdown
        setupDropdown(container, button, menu, renderPersonaDefaultAIEngineDropdown, getSelectedValue, {
            preventFocusTransfer: true
        });

        // Set initial value
        this.selectPersonaDefaultAIEngine(defaultValue);
    }

    selectChatAIModel(value) {
        const selected = document.getElementById('chatAIModelSelected');
        const hidden = document.getElementById('chatAIModel');
        
        if (!selected || !hidden) return;

        // Find the model object from groups
        const modelGroups = this.getModelGroups();
        let model = null;
        for (const group of modelGroups) {
            model = group.options.find(m => m.value === value);
            if (model) break;
        }
        
        if (!model) return;

        // Update display with model information
        const brainIcon = model.isReasoning ? '<i class="fa-light fa-head-side-brain model-reasoning-icon"></i>' : '';
        const serviceBadge = model.service === 'OpenAI' ? 
            '<span class="model-service-badge openai">OpenAI</span>' : 
            '<span class="model-service-badge grok">xAI</span>';
        
        selected.innerHTML = `
            <div class="model-option-content">
                <div class="model-option-left">
                    <span class="model-name">${model.name}</span>
                    ${brainIcon}
                </div>
                <div class="model-option-right">
                    ${serviceBadge}
                </div>
            </div>
        `;
        selected.dataset.value = model.value;
        selected.dataset.provider = model.provider;
        selected.dataset.model = model.model;

        // Update hidden input
        hidden.value = model.value;

        // Handle model-specific controls
        this.handleAIModelChange(model.value);
    }

    selectChatInterfaceModel(value) {
        const selected = document.getElementById('chatModelSelected');
        const hidden = document.getElementById('chatModel');
        
        if (!selected || !hidden) return;

        // Find the model object from filtered groups (only current provider)
        const modelGroups = this.getFilteredModelGroups();
        let model = null;
        for (const group of modelGroups) {
            model = group.options.find(m => m.value === value);
            if (model) break;
        }
        
        if (!model) return;

        // If we have a current chat, validate that the new model is from the same provider
        if (this.currentChatId) {
            const currentSession = this.chatSessions.find(session => session.id === this.currentChatId);
            if (currentSession && currentSession.provider && model.provider !== currentSession.provider) {
                console.warn('Cannot switch to model from different provider:', model.provider, 'vs', currentSession.provider);
                if (window.showToast) {
                    window.showToast('Cannot switch to a model from a different provider', 'warning');
                }
                return;
            }
        }

        // Update display with model information
        const brainIcon = model.isReasoning ? '<i class="fa-light fa-head-side-brain model-reasoning-icon"></i>' : '';
        const serviceBadge = model.service === 'OpenAI' ? 
            '<span class="model-service-badge openai">OpenAI</span>' : 
            '<span class="model-service-badge grok">xAI</span>';
        
        selected.innerHTML = `
            <div class="model-option-content">
                <div class="model-option-left">
                    <span class="model-name">${model.name}</span>
                    ${brainIcon}
                </div>
                <div class="model-option-right">
                    ${serviceBadge}
                </div>
            </div>
        `;
        selected.dataset.value = model.value;
        selected.dataset.provider = model.provider;
        selected.dataset.model = model.model;
        
        // Update hidden input
        hidden.value = model.value;

        // Update the current chat session's model if we have an active chat
        if (this.currentChatId) {
            this.updateChatModel(this.currentChatId, model);
        }
    }

    selectPersonaDefaultAIEngine(value) {
        const selected = document.getElementById('personaDefaultAIEngineSelected');
        const hidden = document.getElementById('personaDefaultAIEngine');
        
        if (!selected || !hidden) return;

        // Find the model object from groups
        const modelGroups = this.getModelGroups();
        let model = null;
        for (const group of modelGroups) {
            model = group.options.find(m => m.value === value);
            if (model) break;
        }
        
        if (!model) return;

        // Update display with model information
        const brainIcon = model.isReasoning ? '<i class="fa-light fa-head-side-brain model-reasoning-icon"></i>' : '';
        const serviceBadge = model.service === 'OpenAI' ? 
            '<span class="model-service-badge openai">OpenAI</span>' : 
            '<span class="model-service-badge grok">xAI</span>';
        
        selected.innerHTML = `
            <div class="model-option-content">
                <div class="model-option-left">
                    <span class="model-name">${model.name}</span>
                    ${brainIcon}
                </div>
                <div class="model-option-right">
                    ${serviceBadge}
                </div>
            </div>
        `;
        selected.dataset.value = model.value;
        selected.dataset.provider = model.provider;
        selected.dataset.model = model.model;
        
        // Update hidden input
        hidden.value = model.value;
    }

    // Helper function to render model option content for grouped dropdown
    renderModelOptionContent(option, group) {
        const brainIcon = option.isReasoning ? '<i class="fa-light fa-head-side-brain model-reasoning-icon"></i>' : '';
        
        return `
            <div class="model-option-content">
                <div class="model-option-left">
                    <span class="model-name">${option.name}</span>
                    ${brainIcon}
                </div>
            </div>
        `;
    }

    // Close handlers for dropdowns
    closeChatAIModelDropdown() {
        const menu = document.getElementById('chatAIModelMenu');
        const button = document.getElementById('chatAIModelBtn');
        closeDropdown(menu, button);
    }

    closeChatInterfaceModelDropdown() {
        const menu = document.getElementById('chatModelMenu');
        const button = document.getElementById('chatModelBtn');
        closeDropdown(menu, button);
    }

    closePersonaDefaultAIEngineDropdown() {
        const menu = document.getElementById('personaDefaultAIEngineMenu');
        const button = document.getElementById('personaDefaultAIEngineBtn');
        closeDropdown(menu, button);
    }

    getFallbackModels() {
        return [
            { id: 'grok-2', name: 'Grok-2', provider: 'grok', model: 'grok-2', service: 'Grok', isReasoning: false },
            { id: 'gpt-5-nano', name: 'GPT-5 Nano', provider: 'openai', model: 'gpt-5-nano', service: 'OpenAI', isReasoning: true },
            { id: 'gpt-5', name: 'GPT-5', provider: 'openai', model: 'gpt-5', service: 'OpenAI', isReasoning: true },
            { id: 'o4-high', name: 'O4 High', provider: 'openai', model: 'o4-high', service: 'OpenAI', isReasoning: true },
            { id: 'gpt-o4', name: 'GPT O4', provider: 'openai', model: 'gpt-o4', service: 'OpenAI', isReasoning: true }
        ];
    }

    getModelGroups() {
        return [
            {
                group: 'xAI',
                options: [
                    { value: 'grok-2', name: 'Grok-2', provider: 'grok', model: 'grok-2', service: 'Grok', isReasoning: false },
                    { value: 'grok-2-1212', name: 'Grok-2-1212', provider: 'grok', model: 'grok-2-1212', service: 'Grok', isReasoning: false },
                    { value: 'grok-2-vision-1212', name: 'Grok-2-Vision-1212', provider: 'grok', model: 'grok-2-vision-1212', service: 'Grok', isReasoning: false }
                ]
            },
            {
                group: 'OpenAI',
                options: [
                    { value: 'gpt-5-nano', name: 'GPT-5 Nano', provider: 'openai', model: 'gpt-5-nano', service: 'OpenAI', isReasoning: true },
                    { value: 'gpt-5', name: 'GPT-5', provider: 'openai', model: 'gpt-5', service: 'OpenAI', isReasoning: true },
                    { value: 'gpt-4o', name: 'GPT-4o', provider: 'openai', model: 'gpt-4o', service: 'OpenAI', isReasoning: false },
                    { value: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', model: 'gpt-4o-mini', service: 'OpenAI', isReasoning: false },
                    { value: 'o1-preview', name: 'O1 Preview', provider: 'openai', model: 'o1-preview', service: 'OpenAI', isReasoning: true },
                    { value: 'o1-mini', name: 'O1 Mini', provider: 'openai', model: 'o1-mini', service: 'OpenAI', isReasoning: true }
                ]
            }
        ];
    }

    getFilteredModelGroups() {
        // If no current chat, return all model groups
        if (!this.currentChatId) {
            return this.getModelGroups();
        }

        // Find the current chat session to get its provider
        const currentSession = this.chatSessions.find(session => session.id === this.currentChatId);
        if (!currentSession || !currentSession.provider) {
            return this.getModelGroups();
        }

        // Filter model groups to only show models from the current chat's provider
        const allModelGroups = this.getModelGroups();
        const currentProvider = currentSession.provider;
        
        return allModelGroups.filter(group => {
            // Check if any model in this group matches the current provider
            return group.options.some(option => option.provider === currentProvider);
        }).map(group => ({
            ...group,
            options: group.options.filter(option => option.provider === currentProvider)
        }));
    }

    getDefaultModelForProvider(provider) {
        const allModelGroups = this.getModelGroups();
        for (const group of allModelGroups) {
            const model = group.options.find(option => option.provider === provider);
            if (model) {
                return model.value;
            }
        }
        return null;
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

    // Update the chat session's model
    async updateChatModel(chatId, model) {
        try {
            const response = await window.wsClient.updateChatModel(chatId, {
                provider: model.provider,
                model: model.model
            });
            
            if (response.success) {
                if (window.showToast) {
                    window.showToast(`Model changed to ${model.name}`, 'success');
                }
            } else {
                throw new Error(response.message || 'Failed to update chat model');
            }
        } catch (error) {
            console.error('Failed to update chat model:', error);
            if (window.showToast) {
                window.showToast('Failed to update model: ' + error.message, 'error');
            }
        }
    }

}

if (window.wsClient) {
    window.wsClient.registerInitStep(99, 'Setting up chat system', async () => {
        // Chat system is already initialized, just ensure listeners are registered
        window.chatSystem = new ChatSystem();
    });
}

// Export for use in other scripts
window.ChatSystem = ChatSystem;
