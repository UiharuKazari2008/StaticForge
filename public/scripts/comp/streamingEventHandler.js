/**
 * Streaming Event Handler
 * Handles real-time processing and display of AI character events
 */

class StreamingEventHandler {
    constructor() {
        this.eventQueue = [];
        this.isProcessing = false;
        this.currentEvents = [];
        this.eventCallbacks = new Map();
        this.setupDefaultCallbacks();
    }

    /**
     * Setup default event callbacks
     */
    setupDefaultCallbacks() {
        // Speech events
        this.eventCallbacks.set('speech', (event) => {
            this.displaySpeech(event);
        });

        this.eventCallbacks.set('thought', (event) => {
            this.displayThought(event);
        });

        // Action events
        this.eventCallbacks.set('action', (event) => {
            this.displayAction(event);
        });

        // Emotion events
        this.eventCallbacks.set('emotion', (event) => {
            this.displayEmotion(event);
        });

        // Memory events
        this.eventCallbacks.set('memory', (event) => {
            this.displayMemory(event);
        });

        // Environment events
        this.eventCallbacks.set('environment', (event) => {
            this.displayEnvironment(event);
        });

        // Planning events
        this.eventCallbacks.set('current_plan', (event) => {
            this.displayCurrentPlan(event);
        });

        this.eventCallbacks.set('future_plan', (event) => {
            this.displayFuturePlan(event);
        });

        // Trust events
        this.eventCallbacks.set('trust_change', (event) => {
            this.displayTrustChange(event);
        });

        // Inventory events
        this.eventCallbacks.set('inventory_change', (event) => {
            this.displayInventoryChange(event);
        });

        // Sensory events
        this.eventCallbacks.set('sensory', (event) => {
            this.displaySensory(event);
        });

        // Offline message events
        this.eventCallbacks.set('offline_message', (event) => {
            this.displayOfflineMessage(event);
        });

        // Time events
        this.eventCallbacks.set('time_update', (event) => {
            this.displayTimeUpdate(event);
        });

        // Location events
        this.eventCallbacks.set('location_change', (event) => {
            this.displayLocationChange(event);
        });

        // Character name events
        this.eventCallbacks.set('myname', (event) => {
            this.displayCharacterName(event);
        });
    }

    /**
     * Process streaming events
     */
    processEvents(events) {
        if (!Array.isArray(events)) {
            return;
        }

        events.forEach(event => {
            this.eventQueue.push(event);
        });

        if (!this.isProcessing) {
            this.processEventQueue();
        }
    }

    /**
     * Process event queue
     */
    async processEventQueue() {
        this.isProcessing = true;

        while (this.eventQueue.length > 0) {
            const event = this.eventQueue.shift();
            await this.processEvent(event);
            
            // Small delay to prevent overwhelming the UI
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        this.isProcessing = false;
    }

    /**
     * Process a single event
     */
    async processEvent(event) {
        const callback = this.eventCallbacks.get(event.type);
        if (callback) {
            try {
                await callback(event);
            } catch (error) {
                console.error('Error processing event:', error);
            }
        } else {
            console.warn('Unknown event type:', event.type);
        }

        this.currentEvents.push(event);
    }

    /**
     * Display speech event
     */
    displaySpeech(event) {
        const speechElement = this.createEventElement('speech', event);
        speechElement.innerHTML = `
            <div class="speech-bubble">
                <div class="speech-content">${event.content}</div>
                <div class="speech-target">${event.target === 'viewer' ? 'To you' : 'To others'}</div>
            </div>
        `;
        this.appendToChat(speechElement);
    }

    /**
     * Display thought event
     */
    displayThought(event) {
        const thoughtElement = this.createEventElement('thought', event);
        thoughtElement.innerHTML = `
            <div class="thought-bubble">
                <div class="thought-content">${event.content}</div>
            </div>
        `;
        this.appendToChat(thoughtElement);
    }

    /**
     * Display action event
     */
    displayAction(event) {
        const actionElement = this.createEventElement('action', event);
        actionElement.innerHTML = `
            <div class="action-display">
                <span class="action-icon">🎭</span>
                <span class="action-content">${event.content}</span>
            </div>
        `;
        this.appendToChat(actionElement);
    }

    /**
     * Display emotion event
     */
    displayEmotion(event) {
        const emotionElement = this.createEventElement('emotion', event);
        const intensity = event.intensity || 50;
        const intensityClass = intensity > 75 ? 'high' : intensity > 25 ? 'medium' : 'low';
        
        emotionElement.innerHTML = `
            <div class="emotion-display ${intensityClass}">
                <span class="emotion-content">${event.content}</span>
                <div class="emotion-intensity">
                    <div class="intensity-bar" style="width: ${intensity}%"></div>
                </div>
            </div>
        `;
        this.appendToChat(emotionElement);
    }

    /**
     * Display memory event
     */
    displayMemory(event) {
        const memoryElement = this.createEventElement('memory', event);
        const weight = event.weight || 50;
        const weightClass = weight > 75 ? 'high' : weight > 25 ? 'medium' : 'low';
        
        memoryElement.innerHTML = `
            <div class="memory-display ${weightClass}">
                <span class="memory-icon">🧠</span>
                <span class="memory-content">${event.content}</span>
                <span class="memory-weight">${weight}%</span>
            </div>
        `;
        this.appendToChat(memoryElement);
    }

    /**
     * Display environment event
     */
    displayEnvironment(event) {
        const envElement = this.createEventElement('environment', event);
        envElement.innerHTML = `
            <div class="environment-display">
                <span class="env-icon">🌍</span>
                <span class="env-content">${event.content}</span>
            </div>
        `;
        this.appendToChat(envElement);
    }

    /**
     * Display current plan event
     */
    displayCurrentPlan(event) {
        const planElement = this.createEventElement('current-plan', event);
        planElement.innerHTML = `
            <div class="plan-display current">
                <span class="plan-icon">📋</span>
                <span class="plan-content">${event.content}</span>
            </div>
        `;
        this.appendToChat(planElement);
    }

    /**
     * Display future plan event
     */
    displayFuturePlan(event) {
        const planElement = this.createEventElement('future-plan', event);
        planElement.innerHTML = `
            <div class="plan-display future">
                <span class="plan-icon">🔮</span>
                <span class="plan-content">${event.content}</span>
            </div>
        `;
        this.appendToChat(planElement);
    }

    /**
     * Display trust change event
     */
    displayTrustChange(event) {
        const trustElement = this.createEventElement('trust-change', event);
        const level = event.level || 50;
        const trustClass = level > 75 ? 'high' : level > 25 ? 'medium' : 'low';
        
        trustElement.innerHTML = `
            <div class="trust-display ${trustClass}">
                <span class="trust-icon">🤝</span>
                <span class="trust-content">${event.content}</span>
                <div class="trust-level">
                    <div class="trust-bar" style="width: ${level}%"></div>
                </div>
            </div>
        `;
        this.appendToChat(trustElement);
    }

    /**
     * Display inventory change event
     */
    displayInventoryChange(event) {
        const inventoryElement = this.createEventElement('inventory-change', event);
        const action = event.action || 'unknown';
        const actionIcon = action === 'gained' ? '➕' : action === 'lost' ? '➖' : '🔄';
        
        inventoryElement.innerHTML = `
            <div class="inventory-display">
                <span class="inventory-icon">${actionIcon}</span>
                <span class="inventory-content">${event.content}</span>
            </div>
        `;
        this.appendToChat(inventoryElement);
    }

    /**
     * Display sensory event
     */
    displaySensory(event) {
        const sensoryElement = this.createEventElement('sensory', event);
        const sense = event.sense || 'general';
        const senseIcon = this.getSenseIcon(sense);
        
        sensoryElement.innerHTML = `
            <div class="sensory-display">
                <span class="sensory-icon">${senseIcon}</span>
                <span class="sensory-content">${event.content}</span>
            </div>
        `;
        this.appendToChat(sensoryElement);
    }

    /**
     * Display offline message event
     */
    displayOfflineMessage(event) {
        const messageElement = this.createEventElement('offline-message', event);
        messageElement.innerHTML = `
            <div class="offline-message">
                <span class="message-icon">📱</span>
                <span class="message-content">${event.content}</span>
            </div>
        `;
        this.appendToChat(messageElement);
    }

    /**
     * Display time update event
     */
    displayTimeUpdate(event) {
        const timeElement = this.createEventElement('time-update', event);
        timeElement.innerHTML = `
            <div class="time-display">
                <span class="time-icon">🕐</span>
                <span class="time-content">${event.content}</span>
            </div>
        `;
        this.appendToChat(timeElement);
    }

    /**
     * Display location change event
     */
    displayLocationChange(event) {
        const locationElement = this.createEventElement('location-change', event);
        locationElement.innerHTML = `
            <div class="location-display">
                <span class="location-icon">📍</span>
                <span class="location-content">${event.content}</span>
            </div>
        `;
        this.appendToChat(locationElement);
    }

    /**
     * Display character name event
     */
    displayCharacterName(event) {
        const nameElement = this.createEventElement('character-name', event);
        nameElement.innerHTML = `
            <div class="character-name-display">
                <span class="name-icon">👤</span>
                <span class="name-content">Character name: <strong>${event.content}</strong></span>
            </div>
        `;
        this.appendToChat(nameElement);
        
        // Update chat title if possible
        this.updateChatTitle(event.content);
    }

    /**
     * Update chat title with character name
     */
    updateChatTitle(characterName) {
        // Try to update various possible title elements
        const titleSelectors = [
            '.chat-title',
            '#chatTitle',
            '.conversation-title',
            'h1',
            'title'
        ];
        
        for (const selector of titleSelectors) {
            const titleElement = document.querySelector(selector);
            if (titleElement) {
                titleElement.textContent = `Chat with ${characterName}`;
                break;
            }
        }
        
        // Also try to update the page title
        if (document.title && !document.title.includes(characterName)) {
            document.title = `Chat with ${characterName} - StaticForge`;
        }
    }

    /**
     * Create event element
     */
    createEventElement(type, event) {
        const element = document.createElement('div');
        element.className = `event-item event-${type}`;
        element.dataset.eventType = type;
        element.dataset.timestamp = event.timestamp || Date.now();
        return element;
    }

    /**
     * Append to chat container
     */
    appendToChat(element) {
        const chatContainer = document.querySelector('.chat-messages') || document.querySelector('#chatMessages');
        if (chatContainer) {
            chatContainer.appendChild(element);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }

    /**
     * Get sense icon
     */
    getSenseIcon(sense) {
        const icons = {
            sight: '👁️',
            sound: '👂',
            touch: '✋',
            smell: '👃',
            taste: '👅',
            general: '🧠'
        };
        return icons[sense] || icons.general;
    }

    /**
     * Register custom event callback
     */
    registerCallback(eventType, callback) {
        this.eventCallbacks.set(eventType, callback);
    }

    /**
     * Get current events
     */
    getCurrentEvents() {
        return this.currentEvents;
    }

    /**
     * Clear events
     */
    clearEvents() {
        this.currentEvents = [];
        this.eventQueue = [];
    }

    /**
     * Get event statistics
     */
    getEventStats() {
        const stats = {};
        this.currentEvents.forEach(event => {
            stats[event.type] = (stats[event.type] || 0) + 1;
        });
        return stats;
    }
}

// Create global instance
window.streamingEventHandler = new StreamingEventHandler();

module.exports = StreamingEventHandler;
