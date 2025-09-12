/**
 * Development Bridge Client
 * Provides live debugging capabilities for development environments
 */

class DevBridgeClient {
    constructor() {
        this.ws = null;
        this.clientId = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        this.originalConsole = {
            log: console.log,
            warn: console.warn,
            error: console.error,
            info: console.info,
            debug: console.debug
        };
        this.originalErrorHandler = window.onerror;
        this.originalUnhandledRejection = window.onunhandledrejection;
        this.messageQueue = [];
        this.isActive = false;
        
        this.init();
    }

    init() {
        // Only initialize if we're in development mode
        if (this.isDevelopmentMode()) {
            this.connect();
            this.setupConsoleOverride();
            this.setupErrorHandlers();
            this.setupGlobalCommands();
            this.setupMessageHandlers();
        }
    }

    isDevelopmentMode() {
        // Check localStorage for dev mode flag
        const devMode = localStorage.getItem('staticforge_dev_mode');
        return devMode === 'true';
    }

    connect() {
        try {
            // Get dev host and port from localStorage, fallback to defaults from loadOptions
            let devHost = localStorage.getItem('staticforge_dev_host');
            let devPort = localStorage.getItem('staticforge_dev_port');
            
            // If not set in localStorage, use defaults from window.optionsData (set by loadOptions)
            if (!devHost && window.optionsData && window.optionsData.devHost) {
                devHost = window.optionsData.devHost;
            } else if (!devHost) {
                devHost = window.location.hostname;
            }
            
            if (!devPort && window.optionsData && window.optionsData.devPort) {
                devPort = window.optionsData.devPort.toString();
            } else if (!devPort) {
                console.error('🔧 Dev port not found in localStorage or options. Please refresh the page.');
                return;
            }
            
            const wsUrl = `ws://${devHost}:${devPort}`;
            
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('🔧 Dev Bridge connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.flushMessageQueue();
                
                // Emit connection event for developer modal
                window.dispatchEvent(new CustomEvent('devBridgeConnected', {
                    detail: { clientId: this.clientId }
                }));
            };
            
            this.ws.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };
            
            this.ws.onclose = () => {
                console.log('🔧 Dev Bridge disconnected');
                this.isConnected = false;
                
                // Emit disconnection event for developer modal
                window.dispatchEvent(new CustomEvent('devBridgeDisconnected', {
                    detail: { clientId: this.clientId }
                }));
                
                this.attemptReconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('🔧 Dev Bridge error:', error);
            };
            
        } catch (error) {
            console.error('🔧 Failed to connect to Dev Bridge:', error);
            this.attemptReconnect();
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            
            setTimeout(() => {
                console.log(`🔧 Attempting to reconnect to Dev Bridge (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                this.connect();
            }, delay);
        }
    }

    sendMessage(message) {
        if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            this.messageQueue.push(message);
        }
    }

    flushMessageQueue() {
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            this.sendMessage(message);
        }
    }

    setupConsoleOverride() {
        const self = this;
        
        console.log = function(...args) {
            self.originalConsole.log.apply(console, args);
            self.logMessage('log', 'info', args.join(' '));
        };
        
        console.warn = function(...args) {
            self.originalConsole.warn.apply(console, args);
            self.logMessage('warn', 'warn', args.join(' '));
        };
        
        console.error = function(...args) {
            self.originalConsole.error.apply(console, args);
            self.logMessage('error', 'error', args.join(' '));
        };
        
        console.info = function(...args) {
            self.originalConsole.info.apply(console, args);
            self.logMessage('info', 'info', args.join(' '));
        };
        
        console.debug = function(...args) {
            self.originalConsole.debug.apply(console, args);
            self.logMessage('debug', 'debug', args.join(' '));
        };
    }

    setupErrorHandlers() {
        const self = this;
        
        // Global error handler
        window.onerror = function(message, source, lineno, colno, error) {
            if (self.originalErrorHandler) {
                self.originalErrorHandler.apply(window, arguments);
            }
            
            self.logMessage('error', 'error', message, {
                source: source,
                line: lineno,
                column: colno,
                stack: error ? error.stack : null
            });
        };
        
        // Unhandled promise rejection handler
        window.onunhandledrejection = function(event) {
            if (self.originalUnhandledRejection) {
                self.originalUnhandledRejection.apply(window, arguments);
            }
            
            const reason = event.reason;
            const message = reason instanceof Error ? reason.message : String(reason);
            const stack = reason instanceof Error ? reason.stack : null;
            
            self.logMessage('unhandledRejection', 'error', message, {
                stack: stack,
                reason: reason
            });
        };
    }

    setupGlobalCommands() {
        const self = this;
        
        // Global command to take ownership
        window.mcpTakeOwnership = function(sessionId, url) {
            self.takeOwnership(sessionId, url);
        };
        
        // Global command to take screenshot
        window.mcpScreenshot = function(selector) {
            return self.takeScreenshot(selector);
        };
        
        // Global command to execute code
        window.mcpExecute = function(code) {
            return self.executeCode(code);
        };
        
        // Global command to query elements
        window.mcpQuery = function(selector) {
            return self.queryElements(selector);
        };
        
        // Global command to trigger events
        window.mcpTrigger = function(selector, eventType, eventData) {
            return self.triggerEvent(selector, eventType, eventData);
        };
    }

    setupMessageHandlers() {
        const self = this;
        
        this.messageHandlers = {
            welcome: (data) => {
                self.clientId = data.clientId;
                self.sessionId = data.sessionId;
                console.log('🔧 Dev Bridge client ID:', self.clientId);
                
                // Update global variables for developer modal
                window.devBridgeClientId = self.clientId;
                window.devBridgeSessionId = self.sessionId;
                
                // Emit session info event for developer modal
                window.dispatchEvent(new CustomEvent('devBridgeSessionChanged', {
                    detail: { clientId: self.clientId, sessionId: self.sessionId }
                }));
            },
            
            ownership_granted: (data) => {
                self.isActive = true;
                console.log('🔧 Dev Bridge: Ownership granted');
            },
            
            ownership_released: (data) => {
                self.isActive = false;
                console.log('🔧 Dev Bridge: Ownership released');
            },
            
            execute_code_request: (data) => {
                self.handleCodeExecutionRequest(data);
            },
            
            query_elements_request: (data) => {
                self.handleElementQueryRequest(data);
            },
            
            trigger_event_request: (data) => {
                self.handleEventTriggerRequest(data);
            },
            
            pong: (data) => {
                // Handle pong response
            }
        };
    }

    handleMessage(data) {
        const handler = this.messageHandlers[data.type];
        if (handler) {
            handler(data);
        } else {
            console.log('🔧 Unknown Dev Bridge message type:', data.type);
        }
    }

    logMessage(type, level, message, data = null) {
        this.sendMessage({
            type: 'log',
            logType: type,
            level: level,
            message: message,
            url: window.location.href,
            data: data,
            timestamp: Date.now()
        });
    }

    takeOwnership(sessionId, url) {
        this.sendMessage({
            type: 'take_ownership',
            sessionId: sessionId || null,
            url: url || window.location.href,
            timestamp: Date.now()
        });
    }

    takeScreenshot(selector = null) {
        return new Promise((resolve, reject) => {
            try {
                let element = null;
                if (selector) {
                    element = document.querySelector(selector);
                    if (!element) {
                        reject(new Error(`Element not found: ${selector}`));
                        return;
                    }
                }

                // Use html2canvas if available, otherwise fallback to basic screenshot
                if (window.html2canvas) {
                    const target = element || document.body;
                    html2canvas(target, {
                        useCORS: true,
                        allowTaint: true,
                        scale: 0.5 // Reduce size for performance
                    }).then(canvas => {
                        const dataUrl = canvas.toDataURL('image/png');
                        this.sendMessage({
                            type: 'screenshot',
                            screenshotData: dataUrl,
                            elementSelector: selector,
                            width: canvas.width,
                            height: canvas.height,
                            url: window.location.href,
                            timestamp: Date.now()
                        });
                        resolve(dataUrl);
                    }).catch(reject);
                } else {
                    // Fallback: create a basic representation
                    const target = element || document.body;
                    const rect = target.getBoundingClientRect();
                    const screenshotData = {
                        type: 'fallback',
                        selector: selector,
                        width: rect.width,
                        height: rect.height,
                        url: window.location.href,
                        timestamp: Date.now()
                    };
                    
                    this.sendMessage({
                        type: 'screenshot',
                        screenshotData: JSON.stringify(screenshotData),
                        elementSelector: selector,
                        width: rect.width,
                        height: rect.height,
                        url: window.location.href,
                        timestamp: Date.now()
                    });
                    
                    resolve(screenshotData);
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    executeCode(code) {
        return new Promise((resolve, reject) => {
            try {
                const startTime = Date.now();
                const result = eval(code);
                const executionTime = Date.now() - startTime;
                
                this.sendMessage({
                    type: 'code_execution_result',
                    code: code,
                    result: result,
                    executionTime: executionTime,
                    timestamp: Date.now()
                });
                
                resolve(result);
            } catch (error) {
                this.sendMessage({
                    type: 'code_execution_error',
                    code: code,
                    error: error.message,
                    stack: error.stack,
                    timestamp: Date.now()
                });
                reject(error);
            }
        });
    }

    queryElements(selector) {
        try {
            const elements = Array.from(document.querySelectorAll(selector));
            const elementData = elements.map((el, index) => ({
                index: index,
                tagName: el.tagName,
                id: el.id,
                className: el.className,
                textContent: el.textContent ? el.textContent.substring(0, 100) : '',
                attributes: Array.from(el.attributes).reduce((acc, attr) => {
                    acc[attr.name] = attr.value;
                    return acc;
                }, {}),
                boundingRect: el.getBoundingClientRect()
            }));
            
            this.sendMessage({
                type: 'element_query_result',
                selector: selector,
                elements: elementData,
                count: elements.length,
                timestamp: Date.now()
            });
            
            return elementData;
        } catch (error) {
            this.sendMessage({
                type: 'element_query_error',
                selector: selector,
                error: error.message,
                timestamp: Date.now()
            });
            throw error;
        }
    }

    triggerEvent(selector, eventType, eventData = {}) {
        try {
            const element = document.querySelector(selector);
            if (!element) {
                throw new Error(`Element not found: ${selector}`);
            }
            
            const event = new Event(eventType, {
                bubbles: true,
                cancelable: true,
                ...eventData
            });
            
            element.dispatchEvent(event);
            
            this.sendMessage({
                type: 'event_trigger_result',
                selector: selector,
                eventType: eventType,
                eventData: eventData,
                success: true,
                timestamp: Date.now()
            });
            
            return true;
        } catch (error) {
            this.sendMessage({
                type: 'event_trigger_error',
                selector: selector,
                eventType: eventType,
                eventData: eventData,
                error: error.message,
                timestamp: Date.now()
            });
            throw error;
        }
    }

    handleCodeExecutionRequest(data) {
        this.executeCode(data.code).then(result => {
            this.sendMessage({
                type: 'code_execution_response',
                requestId: data.requestId,
                result: result,
                timestamp: Date.now()
            });
        }).catch(error => {
            this.sendMessage({
                type: 'code_execution_response',
                requestId: data.requestId,
                error: error.message,
                stack: error.stack,
                timestamp: Date.now()
            });
        });
    }

    handleElementQueryRequest(data) {
        try {
            const elements = this.queryElements(data.selector);
            this.sendMessage({
                type: 'element_query_response',
                requestId: data.requestId,
                elements: elements,
                timestamp: Date.now()
            });
        } catch (error) {
            this.sendMessage({
                type: 'element_query_response',
                requestId: data.requestId,
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    handleEventTriggerRequest(data) {
        try {
            this.triggerEvent(data.selector, data.eventType, data.eventData);
            this.sendMessage({
                type: 'event_trigger_response',
                requestId: data.requestId,
                success: true,
                timestamp: Date.now()
            });
        } catch (error) {
            this.sendMessage({
                type: 'event_trigger_response',
                requestId: data.requestId,
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    // Network monitoring (will be enhanced by service worker)
    logNetworkRequest(requestData) {
        this.sendMessage({
            type: 'network',
            networkType: 'request',
            ...requestData,
            timestamp: Date.now()
        });
    }

    logNetworkResponse(responseData) {
        this.sendMessage({
            type: 'network',
            networkType: 'response',
            ...responseData,
            timestamp: Date.now()
        });
    }

    // Cleanup method
    destroy() {
        if (this.ws) {
            this.ws.close();
        }
        
        // Restore original console methods
        Object.assign(console, this.originalConsole);
        
        // Restore original error handlers
        window.onerror = this.originalErrorHandler;
        window.onunhandledrejection = this.originalUnhandledRejection;
        
        // Remove global commands
        delete window.mcpTakeOwnership;
        delete window.mcpScreenshot;
        delete window.mcpExecute;
        delete window.mcpQuery;
        delete window.mcpTrigger;
    }
}

// Initialize the Dev Bridge Client
if (typeof window !== 'undefined') {
    window.devBridgeClient = new DevBridgeClient();
    
    // Make it globally accessible
    window.DevBridgeClient = DevBridgeClient;
}
