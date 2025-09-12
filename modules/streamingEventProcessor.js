/**
 * Streaming Event Processor
 * Handles real-time processing of event-based AI responses
 */

class StreamingEventProcessor {
    constructor() {
        this.eventHandlers = new Map();
        this.setupDefaultHandlers();
    }

    /**
     * Setup default event handlers
     */
    setupDefaultHandlers() {
        // Speech events
        this.eventHandlers.set('speechdirect', (event, context) => {
            return {
                type: 'speech',
                content: event.content,
                timestamp: event.timestamp,
                target: 'viewer'
            };
        });

        this.eventHandlers.set('speech', (event, context) => {
            return {
                type: 'speech',
                content: event.content,
                timestamp: event.timestamp,
                target: 'others'
            };
        });

        this.eventHandlers.set('innerspeech', (event, context) => {
            return {
                type: 'thought',
                content: event.content,
                timestamp: event.timestamp,
                target: 'internal'
            };
        });

        // Action events
        this.eventHandlers.set('actions', (event, context) => {
            return {
                type: 'action',
                content: event.content,
                timestamp: event.timestamp
            };
        });

        // Sound events
        this.eventHandlers.set('sfx', (event, context) => {
            return {
                type: 'sound',
                content: event.content,
                timestamp: event.timestamp
            };
        });

        // Emotion events
        this.eventHandlers.set('emotion', (event, context) => {
            return {
                type: 'emotion',
                content: event.content,
                intensity: event.intensity || 50,
                timestamp: event.timestamp
            };
        });

        // Memory events
        this.eventHandlers.set('memory', (event, context) => {
            return {
                type: 'memory',
                content: event.content,
                weight: event.weight || 50,
                timestamp: event.timestamp
            };
        });

        // Environment events
        this.eventHandlers.set('environment', (event, context) => {
            return {
                type: 'environment',
                content: event.content,
                timestamp: event.timestamp
            };
        });

        // Planning events
        this.eventHandlers.set('currplan', (event, context) => {
            return {
                type: 'current_plan',
                content: event.content,
                timestamp: event.timestamp
            };
        });

        this.eventHandlers.set('futureplans', (event, context) => {
            return {
                type: 'future_plan',
                content: event.content,
                timestamp: event.timestamp
            };
        });

        // Trust events
        this.eventHandlers.set('trustlevel', (event, context) => {
            return {
                type: 'trust_change',
                content: event.content,
                level: event.level || 50,
                timestamp: event.timestamp
            };
        });

        // Inventory events
        this.eventHandlers.set('inventory', (event, context) => {
            return {
                type: 'inventory_change',
                content: event.content,
                action: event.action || 'unknown', // gained, lost, changed
                timestamp: event.timestamp
            };
        });

        // Sensory events
        this.eventHandlers.set('sensory', (event, context) => {
            return {
                type: 'sensory',
                content: event.content,
                sense: event.sense || 'general', // sight, sound, touch, smell, taste
                timestamp: event.timestamp
            };
        });

        // Offline message events
        this.eventHandlers.set('offlinemessage', (event, context) => {
            return {
                type: 'offline_message',
                content: event.content,
                timestamp: event.timestamp
            };
        });

        // Time events
        this.eventHandlers.set('timeofday', (event, context) => {
            return {
                type: 'time_update',
                content: event.content,
                timestamp: event.timestamp
            };
        });

        // Location events
        this.eventHandlers.set('location', (event, context) => {
            return {
                type: 'location_change',
                content: event.content,
                timestamp: event.timestamp
            };
        });
    }

    /**
     * Process a single event
     */
    processEvent(event, context = {}) {
        const handler = this.eventHandlers.get(event.type);
        if (handler) {
            return handler(event, context);
        }
        
        // Default handler for unknown event types
        return {
            type: 'unknown',
            content: event.content || '',
            timestamp: event.timestamp || Date.now(),
            originalType: event.type
        };
    }

    /**
     * Process an array of events
     */
    processEvents(events, context = {}) {
        if (!Array.isArray(events)) {
            return [];
        }

        return events.map(event => this.processEvent(event, context));
    }

    /**
     * Extract events from streaming response
     */
    extractEventsFromStream(streamChunk, accumulatedResponse) {
        try {
            // Try to parse the accumulated response as JSON
            const parsed = JSON.parse(accumulatedResponse);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        } catch (e) {
            // If parsing fails, try to extract partial events
            return this.extractPartialEvents(accumulatedResponse);
        }
        return [];
    }

    /**
     * Extract partial events from incomplete JSON
     */
    extractPartialEvents(response) {
        const events = [];
        
        // Look for complete event objects in the response
        const eventRegex = /\{[^}]*"type"[^}]*\}/g;
        const matches = response.match(eventRegex);
        
        if (matches) {
            matches.forEach(match => {
                try {
                    const event = JSON.parse(match);
                    if (event.type && event.content) {
                        events.push(event);
                    }
                } catch (e) {
                    // Skip invalid JSON
                }
            });
        }
        
        return events;
    }

    /**
     * Format events for display
     */
    formatEventsForDisplay(events) {
        return events.map(event => {
            switch (event.type) {
                case 'speech':
                    return {
                        type: 'speech',
                        content: event.content,
                        target: event.target,
                        timestamp: event.timestamp
                    };
                case 'thought':
                    return {
                        type: 'thought',
                        content: event.content,
                        timestamp: event.timestamp
                    };
                case 'action':
                    return {
                        type: 'action',
                        content: event.content,
                        timestamp: event.timestamp
                    };
                case 'emotion':
                    return {
                        type: 'emotion',
                        content: event.content,
                        intensity: event.intensity,
                        timestamp: event.timestamp
                    };
                default:
                    return event;
            }
        });
    }

    /**
     * Get event statistics
     */
    getEventStats(events) {
        const stats = {};
        events.forEach(event => {
            stats[event.type] = (stats[event.type] || 0) + 1;
        });
        return stats;
    }

    /**
     * Register custom event handler
     */
    registerEventHandler(eventType, handler) {
        this.eventHandlers.set(eventType, handler);
    }

    /**
     * Get available event types
     */
    getAvailableEventTypes() {
        return Array.from(this.eventHandlers.keys());
    }
}

// Create singleton instance
const streamingEventProcessor = new StreamingEventProcessor();

module.exports = streamingEventProcessor;

