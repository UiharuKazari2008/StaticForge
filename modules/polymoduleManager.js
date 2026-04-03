/**
 * Polymorphic Module Manager
 * Manages persistent services for modules not written in Node.js
 * Handles process lifecycle, communication, and error recovery
 */

const { spawn } = require('child_process');
const path = require('path');
const logger = require('./logger');

class PolymoduleManager {
    constructor() {
        this.modules = new Map(); // moduleName -> { process, queue, isReady, config }
        this.requestIdCounter = 0;
        this.sleepCheckInterval = null;
        this.sleepCheckIntervalMs = 5000; // Check every 5 seconds
        this.startSleepCheck();
    }

    /**
     * Register a polymorphic module
     * @param {string} name - Module name
     * @param {Object} config - Module configuration
     * @param {string} config.command - Command to run (e.g., 'ruby')
     * @param {Array} config.args - Command arguments (e.g., ['script.rb'])
     * @param {string} config.scriptPath - Path to the script file
     * @param {number} config.maxQueueSize - Maximum queue size (default: 100)
     * @param {number} config.restartDelay - Delay before restart on crash (ms, default: 5000)
     * @param {number} config.timeout - Request timeout (ms, default: 30000)
     * @param {number} config.sleepTimeout - Auto-sleep after inactivity (ms, null = disabled, default: null)
     * @param {boolean} config.startAsleep - Start module in sleep state (default: false)
     */
    registerModule(name, config) {
        if (this.modules.has(name)) {
            logger.warn(`Polymodule ${name} is already registered`);
            return;
        }

        const moduleState = {
            name,
            config,
            process: null,
            queue: [],
            isReady: false,
            maxQueueSize: config.maxQueueSize || 100,
            restartDelay: config.restartDelay || 5000,
            timeout: config.timeout || 30000,
            sleepTimeout: config.sleepTimeout || null, // null = disabled
            startAsleep: config.startAsleep || false,
            pendingRequests: new Map(), // requestId -> { resolve, reject, timeout, data }
            failedWork: [], // Requests that failed due to module exit and need retry after restart
            maxRetries: config.maxRetries || 3, // Maximum retry attempts for failed work
            restartCount: 0,
            lastError: null,
            lastActivityTime: null // Track last activity for sleep
        };

        this.modules.set(name, moduleState);
        
        // Start module unless it should start asleep
        if (!moduleState.startAsleep) {
        this.startModule(name);
        } else {
            logger.info(`Polymodule ${name} registered (will start on first request)`);
        }
    }

    /**
     * Start a polymorphic module process
     * @param {string} name - Module name
     */
    startModule(name) {
        const moduleState = this.modules.get(name);
        if (!moduleState) {
            logger.error(`Cannot start module ${name}: not registered`);
            return;
        }

        if (moduleState.process && !moduleState.process.killed) {
            logger.warn(`Module ${name} is already running`);
            return;
        }

        const { command, args, scriptPath } = moduleState.config;
        const fullScriptPath = path.isAbsolute(scriptPath) 
            ? scriptPath 
            : path.join(__dirname, '..', scriptPath);

        logger.info(`Starting polymorphic module: ${name} (${command} ${args.join(' ')})`);

        const childProcess = spawn(command, args.map(arg => 
            arg === '{script}' ? fullScriptPath : arg
        ), {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: path.dirname(fullScriptPath)
        });

        moduleState.process = childProcess;
        moduleState.isReady = false;
        moduleState.lastError = null;

        // Handle stdout (responses)
        // Only start processing responses after the module is marked as ready
        // This prevents startup messages from being interpreted as responses
        let buffer = '';
        childProcess.stdout.on('data', (data) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.trim()) {
                    // Only process responses if module is ready (prevents startup noise)
                    if (moduleState.isReady) {
                        this.handleResponse(name, line.trim());
                    } else {
                        // Log startup output for debugging
                        logger.debug(`Polymodule ${name} startup output: ${line.trim()}`);
                    }
                }
            }
        });

        // Handle stderr (errors)
        childProcess.stderr.on('data', (data) => {
            const errorText = data.toString();
            logger.warn(`Polymodule ${name} stderr:`, errorText);
            moduleState.lastError = errorText;
        });

        // Handle process exit
        childProcess.on('exit', (code, signal) => {
            logger.warn(`Polymodule ${name} exited with code ${code}, signal ${signal}`);
            moduleState.isReady = false;
            moduleState.process = null;

            // Determine if this is an unexpected exit (needs restart and retry)
            // SIGTERM during active work (pending requests) is treated as unexpected
            // SIGTERM with no pending work is likely a graceful sleep
            const hasActiveWork = moduleState.pendingRequests.size > 0 || moduleState.queue.length > 0;
            const isUnexpectedExit = code !== 0 || (signal !== 'SIGTERM' && signal !== null) || (signal === 'SIGTERM' && hasActiveWork);
            const isGracefulSleep = code === 0 && (signal === 'SIGTERM' || signal === null) && !hasActiveWork;

            if (isUnexpectedExit && moduleState.pendingRequests.size > 0) {
                // Move pending requests to failedWork queue for retry after restart
                logger.info(`Polymodule ${name} exited unexpectedly with ${moduleState.pendingRequests.size} pending requests, queuing for retry after restart`);
                for (const [requestId, requestInfo] of moduleState.pendingRequests) {
                    clearTimeout(requestInfo.timeout);
                    const retryCount = (requestInfo.retryCount || 0) + 1;
                    
                    if (retryCount <= moduleState.maxRetries) {
                        // Add to failedWork queue with retry count
                        moduleState.failedWork.push({
                            ...requestInfo,
                            requestId,
                            retryCount
                        });
                    } else {
                        // Max retries exceeded, reject the request
                        logger.warn(`Polymodule ${name} request ${requestId} exceeded max retries (${moduleState.maxRetries}), rejecting`);
                        requestInfo.reject(new Error(`Module ${name} process exited after ${moduleState.maxRetries} retry attempts`));
                    }
                }
                moduleState.pendingRequests.clear();
            } else {
                // Graceful exit or no pending requests - reject normally
                for (const [requestId, { reject, timeout }] of moduleState.pendingRequests) {
                    clearTimeout(timeout);
                    reject(new Error(`Module ${name} process exited`));
                }
                moduleState.pendingRequests.clear();
            }

            // Auto-restart if not intentionally stopped (or if we have failed work to retry)
            if (isUnexpectedExit || (!isGracefulSleep && moduleState.failedWork.length > 0)) {
                moduleState.restartCount++;
                logger.info(`Restarting polymorphic module ${name} in ${moduleState.restartDelay}ms (restart #${moduleState.restartCount})${moduleState.failedWork.length > 0 ? `, ${moduleState.failedWork.length} request(s) queued for retry` : ''}`);
                setTimeout(() => {
                    if (this.modules.has(name)) {
                        this.startModule(name);
                    }
                }, moduleState.restartDelay);
            }
        });

        // Handle spawn errors
        childProcess.on('error', (error) => {
            logger.error(`Failed to spawn polymorphic module ${name}:`, error);
            moduleState.isReady = false;
            moduleState.lastError = error.message;

            // Reject all pending requests
            for (const [requestId, { reject }] of moduleState.pendingRequests) {
                reject(error);
            }
            moduleState.pendingRequests.clear();
        });

        // Mark as ready after a short delay (allow process to initialize)
        setTimeout(() => {
            if (childProcess && !childProcess.killed) {
                moduleState.isReady = true;
                moduleState.lastActivityTime = Date.now(); // Mark as active
                logger.info(`Polymodule ${name} is ready`);
                // Process queued requests
                this.processQueue(name);
                // Retry failed work from previous crash/restart
                this.retryFailedWork(name);
            }
        }, 1000);
    }

    /**
     * Handle response from polymorphic module
     * @param {string} name - Module name
     * @param {string} responseLine - JSON response line
     */
    handleResponse(name, responseLine) {
        const moduleState = this.modules.get(name);
        if (!moduleState) return;

        try {
            const response = JSON.parse(responseLine);
            const requestId = response.request_id;

            if (requestId && moduleState.pendingRequests.has(requestId)) {
                const { resolve, reject, timeout } = moduleState.pendingRequests.get(requestId);
                clearTimeout(timeout);
                moduleState.pendingRequests.delete(requestId);
                
                // Update activity time on response
                moduleState.lastActivityTime = Date.now();

                if (response.success) {
                    resolve(response);
                } else {
                    reject(new Error(response.error || 'Unknown error'));
                }
            } else {
                logger.warn(`Polymodule ${name}: Received response without matching request_id`);
            }
        } catch (error) {
            logger.error(`Polymodule ${name}: Failed to parse response:`, error);
        }
    }

    /**
     * Wait for module to be ready
     * @param {string} name - Module name
     * @param {number} maxWait - Maximum wait time in ms (default: 10000)
     * @param {number} checkInterval - Check interval in ms (default: 200)
     * @returns {Promise<boolean>} - True if ready, false if timeout
     */
    async waitForModuleReady(name, maxWait = 10000, checkInterval = 200) {
        const startTime = Date.now();
        while (Date.now() - startTime < maxWait) {
            const status = this.getModuleStatus(name);
            if (status && status.isReady && status.isRunning) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
        return false;
    }

    /**
     * Send request to polymorphic module with automatic crash recovery
     * @param {string} name - Module name
     * @param {Object} data - Request data
     * @param {boolean} isRetry - Internal flag to prevent infinite retry loops
     * @returns {Promise<Object>} - Response from module
     */
    async sendRequest(name, data, isRetry = false) {
        const moduleState = this.modules.get(name);
        if (!moduleState) {
            throw new Error(`Polymodule ${name} is not registered`);
        }

        // Generate unique request ID
        const requestId = `req_${++this.requestIdCounter}_${Date.now()}`;
        const request = {
            ...data,
            request_id: requestId
        };

        // If module is sleeping (not running), start it
        if (!moduleState.process || moduleState.process.killed) {
            logger.info(`Polymodule ${name} is sleeping, starting...`);
            // Queue the request first, then start the module
            // This ensures the request is queued and will be processed when module becomes ready
            return new Promise((resolve, reject) => {
                if (moduleState.queue.length >= moduleState.maxQueueSize) {
                    reject(new Error(`Polymodule ${name} queue is full`));
                    return;
                }
                // Update activity time when waking module
                moduleState.lastActivityTime = Date.now();
                moduleState.queue.push({ request, resolve, reject, requestId });
                // Start the module - it will process the queue when ready
                this.startModule(name);
            });
        }

        try {
            // Update activity time before sending request
            moduleState.lastActivityTime = Date.now();
            return await this._sendRequestInternal(name, request, requestId);
        } catch (error) {
            // Check if this is a crash-related error
            const isCrashError = error.message.includes('timeout') || 
                               error.message.includes('exited') || 
                               error.message.includes('process') ||
                               error.message.includes('queue is full') ||
                               error.message.includes('killed');

            // If it's a crash and we haven't retried yet, restart and retry
            if (isCrashError && !isRetry) {
                logger.warn(`Polymodule ${name} appears to have crashed, restarting...`);
                const status = this.getModuleStatus(name);
                
                // If process is still running but not responding, stop it first
                if (status && status.isRunning && !status.isReady) {
                    logger.info(`Stopping unresponsive ${name} process...`);
                    this.stopModule(name);
                    // Wait a moment for process to stop
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                // Restart the module
                this.startModule(name);
                
                // Wait for module to be ready
                const isReady = await this.waitForModuleReady(name);
                if (isReady) {
                    logger.info(`Polymodule ${name} restarted, retrying request...`);
                    // Retry the request once
                    return await this.sendRequest(name, data, true);
                } else {
                    throw new Error(`Polymodule ${name} failed to become ready after restart`);
                }
            } else {
                // Re-throw the error (either not a crash, or retry also failed)
                throw error;
            }
        }
    }

    /**
     * Internal method to send request (without crash recovery)
     * @param {string} name - Module name
     * @param {Object} request - Request object with request_id
     * @param {string} requestId - Request ID
     * @returns {Promise<Object>} - Response from module
     * @private
     */
    _sendRequestInternal(name, request, requestId) {
        const moduleState = this.modules.get(name);
        if (!moduleState) {
            throw new Error(`Polymodule ${name} is not registered`);
        }

        return new Promise((resolve, reject) => {
            // Check if module is ready
            if (!moduleState.isReady || !moduleState.process || moduleState.process.killed) {
                // Queue the request
                if (moduleState.queue.length >= moduleState.maxQueueSize) {
                    reject(new Error(`Polymodule ${name} queue is full`));
                    return;
                }
                moduleState.queue.push({ request, resolve, reject, requestId });
                return;
            }

            // Set timeout
            const timeout = setTimeout(() => {
                moduleState.pendingRequests.delete(requestId);
                reject(new Error(`Polymodule ${name} request timeout`));
            }, moduleState.timeout);

            // Store request (include data for potential retry)
            moduleState.pendingRequests.set(requestId, { resolve, reject, timeout, data: request });

            // Send request
            try {
                const requestLine = JSON.stringify(request) + '\n';
                moduleState.process.stdin.write(requestLine, 'utf8');
                // Update activity time when sending request
                moduleState.lastActivityTime = Date.now();
            } catch (error) {
                clearTimeout(timeout);
                moduleState.pendingRequests.delete(requestId);
                reject(error);
            }
        });
    }

    /**
     * Process queued requests for a module
     * @param {string} name - Module name
     */
    async processQueue(name) {
        const moduleState = this.modules.get(name);
        if (!moduleState || !moduleState.isReady) return;

        while (moduleState.queue.length > 0 && moduleState.isReady) {
            const { request, resolve, reject, requestId } = moduleState.queue.shift();

            // Use internal method to send (no crash recovery needed here, already queued)
            this._sendRequestInternal(name, request, requestId)
                .then(resolve)
                .catch(reject);
        }
    }

    /**
     * Retry failed work after module restart
     * @param {string} name - Module name
     */
    async retryFailedWork(name) {
        const moduleState = this.modules.get(name);
        if (!moduleState || !moduleState.isReady || moduleState.failedWork.length === 0) return;

        logger.info(`Polymodule ${name}: Retrying ${moduleState.failedWork.length} failed request(s) after restart`);

        // Process all failed work
        while (moduleState.failedWork.length > 0 && moduleState.isReady) {
            const failedRequest = moduleState.failedWork.shift();
            const { requestId, resolve, reject, data, retryCount } = failedRequest;

            if (!data) {
                logger.error(`Polymodule ${name}: Failed request ${requestId} missing data, rejecting`);
                reject(new Error(`Module ${name} request data lost during retry`));
                continue;
            }

            logger.debug(`Polymodule ${name}: Retrying request ${requestId} (attempt ${retryCount}/${moduleState.maxRetries})`);

            try {
                // Retry using internal method (with new request ID to avoid conflicts)
                // Preserve all original request data, only override request_id
                const newRequestId = `req_${++this.requestIdCounter}_${Date.now()}`;
                const retryRequest = { ...data, request_id: newRequestId };
                
                // Store the retry request with original resolve/reject
                const timeout = setTimeout(() => {
                    moduleState.pendingRequests.delete(newRequestId);
                    reject(new Error(`Polymodule ${name} request timeout (retry attempt ${retryCount})`));
                }, moduleState.timeout);

                moduleState.pendingRequests.set(newRequestId, { 
                    resolve, 
                    reject, 
                    timeout, 
                    data: retryRequest,
                    retryCount 
                });

                // Send the retry request
                const requestLine = JSON.stringify(retryRequest) + '\n';
                moduleState.process.stdin.write(requestLine, 'utf8');
                moduleState.lastActivityTime = Date.now();
            } catch (error) {
                // If retry fails, check if we should try again or reject
                if (retryCount < moduleState.maxRetries) {
                    // Put back in failedWork queue for next restart
                    failedRequest.retryCount = retryCount + 1;
                    moduleState.failedWork.unshift(failedRequest);
                } else {
                    // Max retries exceeded
                    reject(new Error(`Polymodule ${name} request failed after ${moduleState.maxRetries} retry attempts: ${error.message}`));
                }
            }
        }
    }

    /**
     * Stop a polymorphic module
     * @param {string} name - Module name
     * @param {boolean} isSleep - Whether this is a sleep (not a crash/stop)
     */
    stopModule(name, isSleep = false) {
        const moduleState = this.modules.get(name);
        if (!moduleState) return;

        if (moduleState.process && !moduleState.process.killed) {
            if (isSleep) {
                logger.info(`Polymodule ${name} sleeping due to inactivity`);
            } else {
            logger.info(`Stopping polymorphic module: ${name}`);
            }
            // Close stdin first to signal EOF, then send SIGTERM if needed
            if (moduleState.process.stdin && !moduleState.process.stdin.destroyed) {
                moduleState.process.stdin.end();
            }
            // Give it a moment to exit gracefully, then force kill if needed
            setTimeout(() => {
                if (moduleState.process && !moduleState.process.killed) {
                    moduleState.process.kill('SIGTERM');
                }
            }, 1000);
        }

        // Only reject pending requests if not sleeping (sleep is graceful)
        if (!isSleep) {
        // Reject all pending requests (intentional stop, don't retry)
        for (const [requestId, { reject, timeout }] of moduleState.pendingRequests) {
            clearTimeout(timeout);
            reject(new Error(`Module ${name} stopped`));
        }
        moduleState.pendingRequests.clear();

        // Reject queued requests
        for (const { reject } of moduleState.queue) {
            reject(new Error(`Module ${name} stopped`));
        }
        moduleState.queue = [];

        // Clear failed work on intentional stop
        for (const { reject } of moduleState.failedWork) {
            reject(new Error(`Module ${name} stopped`));
        }
        moduleState.failedWork = [];
        } else {
            // For sleep, just clear pending requests (they'll be retried on wake)
            moduleState.pendingRequests.clear();
            moduleState.queue = [];
            // Keep failedWork for retry after wake
        }
        
        // Clear activity time when sleeping
        if (isSleep) {
            moduleState.lastActivityTime = null;
        }
    }

    /**
     * Stop all polymorphic modules
     */
    stopAll() {
        this.stopSleepCheck();
        for (const name of this.modules.keys()) {
            this.stopModule(name);
        }
    }

    /**
     * Get module status
     * @param {string} name - Module name
     * @returns {Object} - Module status
     */
    getModuleStatus(name) {
        const moduleState = this.modules.get(name);
        if (!moduleState) return null;

        return {
            name,
            isReady: moduleState.isReady,
            isRunning: moduleState.process && !moduleState.process.killed,
            queueSize: moduleState.queue.length,
            pendingRequests: moduleState.pendingRequests.size,
            restartCount: moduleState.restartCount,
            lastError: moduleState.lastError,
            sleepTimeout: moduleState.sleepTimeout,
            isAsleep: !moduleState.process || moduleState.process.killed,
            lastActivityTime: moduleState.lastActivityTime
        };
    }

    /**
     * Start the sleep check interval
     * @private
     */
    startSleepCheck() {
        if (this.sleepCheckInterval) {
            clearInterval(this.sleepCheckInterval);
        }
        
        this.sleepCheckInterval = setInterval(() => {
            this.checkSleepModules();
        }, this.sleepCheckIntervalMs);
    }

    /**
     * Check all modules for sleep timeout
     * @private
     */
    checkSleepModules() {
        const now = Date.now();
        
        for (const [name, moduleState] of this.modules) {
            // Skip if sleep is disabled or module is not running
            if (!moduleState.sleepTimeout || !moduleState.process || moduleState.process.killed) {
                continue;
            }

            // Skip if there are pending requests or queued requests
            if (moduleState.pendingRequests.size > 0 || moduleState.queue.length > 0) {
                continue;
            }

            // Check if timeout has been reached
            if (moduleState.lastActivityTime && (now - moduleState.lastActivityTime) >= moduleState.sleepTimeout) {
                this.stopModule(name, true); // Sleep gracefully
            }
        }
    }

    /**
     * Stop sleep check interval (cleanup)
     */
    stopSleepCheck() {
        if (this.sleepCheckInterval) {
            clearInterval(this.sleepCheckInterval);
            this.sleepCheckInterval = null;
        }
    }
}

// Export singleton instance
module.exports = new PolymoduleManager();

