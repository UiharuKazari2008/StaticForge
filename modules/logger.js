const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config.json');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Verbosity levels
const VERBOSITY_LEVELS = {
    MINIMAL: 0,    // Only essential messages
    NORMAL: 1,     // Standard messages (default)
    DETAILED: 2,   // Detailed messages
    VERBOSE: 3     // Full verbose output (current behavior)
};

// Current verbosity level (can be set via env or config)
let currentVerbosity = VERBOSITY_LEVELS.NORMAL;

// Load from config.json first
try {
    const appConfig = require('../config.json');
    if (appConfig.log_verbosity) {
        const level = VERBOSITY_LEVELS[appConfig.log_verbosity.toUpperCase()];
        if (level !== undefined) {
            currentVerbosity = level;
            console.log(`📊 Verbosity loaded from config: ${appConfig.log_verbosity}`);
        }
    }
} catch (error) {
    // Config not found, use default
}

// Environment variable overrides config
const envVerbosity = process.env.LOG_VERBOSITY;
if (envVerbosity) {
    const level = VERBOSITY_LEVELS[envVerbosity.toUpperCase()];
    if (level !== undefined) {
        currentVerbosity = level;
        console.log(`📊 Verbosity overridden by env: ${envVerbosity}`);
    }
}

// Detailed generation logger - separate stream for detailed generation logs
const generationLogPath = path.join(logsDir, 'generation-detailed.log');
let generationLogStream = null;

// Boot tree state
const bootState = {
    isBooting: false,
    startTime: null,
    steps: [],
    currentStep: null,
    currentSubSteps: []
};

// Custom format for console output with colors
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp }) => {
        return `${timestamp} ${level}: ${message}`;
    })
);

// Format for file output without colors
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp }) => {
        return `${timestamp} [${level.toUpperCase()}] ${message}`;
    })
);

// Create the logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports: [
        // Console transport
        new winston.transports.Console({
            format: consoleFormat
        }),
        // General log file
        new winston.transports.File({
            filename: path.join(logsDir, 'server.log'),
            format: fileFormat,
            maxsize: 10485760, // 10MB
            maxFiles: 14,
            tailable: true
        }),
        // Error log file
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: 10485760, // 10MB
            maxFiles: 14,
            tailable: true
        })
    ]
});

// Tree drawing characters
const TREE_CHARS = {
    branch: '├──',
    branchLast: '└──',
    branchParent: '├─┬─',
    branchParentLast: '└─┬─',
    vertical: '│',
    corner: '└──',
    tee: '├──'
};

// Boot process methods
logger.startBoot = function() {
    bootState.isBooting = true;
    bootState.startTime = Date.now();
    bootState.steps = [];
    bootState.currentStep = null;
    bootState.currentSubSteps = [];
};

logger.bootStep = async function(name, callback) {
    const stepStartTime = Date.now();
    
    // Add the step to our tracking
    const step = {
        name,
        subSteps: [],
        startTime: stepStartTime,
        endTime: null
    };
    
    bootState.steps.push(step);
    bootState.currentStep = step;
    bootState.currentSubSteps = step.subSteps;
    
    try {
        // Execute the callback
        if (callback) {
            await callback();
        }
        
        step.endTime = Date.now();
        return true;
    } catch (error) {
        step.endTime = Date.now();
        step.error = error;
        throw error;
    }
};

logger.bootSubStep = function(name, data = null) {
    if (bootState.currentStep) {
        bootState.currentSubSteps.push({
            name,
            data,
            timestamp: Date.now()
        });
    }
};

logger.endBoot = function() {
    if (!bootState.isBooting) return;
    
    const totalTime = Date.now() - bootState.startTime;
    const totalSeconds = (totalTime / 1000).toFixed(1);
    
    // Build the tree output
    const lines = [];
    lines.push('Server Initialization');
    
    bootState.steps.forEach((step, stepIndex) => {
        const isLastStep = stepIndex === bootState.steps.length - 1;
        const stepTime = step.endTime ? `(${step.endTime - step.startTime}ms)` : '';
        
        if (step.subSteps.length > 0) {
            // Step with sub-steps
            lines.push(`${isLastStep ? TREE_CHARS.branchParentLast : TREE_CHARS.branchParent} ${step.name} ${stepTime}`);
            
            step.subSteps.forEach((subStep, subIndex) => {
                const isLastSubStep = subIndex === step.subSteps.length - 1;
                const prefix = isLastStep ? ' ' : TREE_CHARS.vertical;
                const branch = isLastSubStep ? TREE_CHARS.branchLast : TREE_CHARS.branch;
                const dataStr = subStep.data ? `: ${subStep.data}` : '';
                lines.push(`${prefix} ${branch} ${subStep.name}${dataStr}`);
            });
        } else {
            // Step without sub-steps
            lines.push(`${isLastStep ? TREE_CHARS.branchLast : TREE_CHARS.branch} ${step.name} ${stepTime}`);
        }
    });
    
    // Output the tree
    console.log('\n' + lines.join('\n'));
    console.log(`\nServer ready (${totalSeconds}s)\n`);
    
    bootState.isBooting = false;
};

// Override info method during boot to capture messages
const originalInfo = logger.info.bind(logger);
logger.info = function(message, ...args) {
    if (bootState.isBooting && bootState.currentStep) {
        // During boot, capture as substep
        logger.bootSubStep(message);
    } else {
        // Normal info logging
        originalInfo(message, ...args);
    }
};

// Convenience methods for common patterns
logger.success = function(message) {
    logger.info(message);
};

logger.security = function(message, data) {
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    logger.warn(`SECURITY: ${message}${dataStr}`);
};

// Verbosity control methods
logger.setVerbosity = function(level) {
    if (typeof level === 'string') {
        level = VERBOSITY_LEVELS[level.toUpperCase()];
    }
    if (level !== undefined && level >= 0 && level <= 3) {
        currentVerbosity = level;
        console.log(`📊 Verbosity set to: ${Object.keys(VERBOSITY_LEVELS).find(k => VERBOSITY_LEVELS[k] === level)}`);
    }
};

logger.getVerbosity = function() {
    return currentVerbosity;
};

logger.shouldLog = function(requiredLevel) {
    return currentVerbosity >= requiredLevel;
};

// Detailed generation logging
logger.initGenerationLog = function(requestId) {
    if (!generationLogStream) {
        generationLogStream = fs.createWriteStream(generationLogPath, { flags: 'a' });
    }
    
    const separator = '\n' + '='.repeat(80) + '\n';
    const header = `${separator}NEW GENERATION REQUEST: ${requestId}\n` +
                  `Timestamp: ${new Date().toISOString()}\n` +
                  `${separator}\n`;
    generationLogStream.write(header);
    
    return requestId;
};

// Helper function to check if a string is valid JSON
function isJSON(str) {
    if (typeof str !== 'string') return false;
    try {
        JSON.parse(str);
        return true;
    } catch (e) {
        return false;
    }
}

function isXML(str) {
    if (typeof str !== 'string') return false;
    const trimmed = str.trim();
    return trimmed.startsWith('<') && trimmed.endsWith('>') && 
           (trimmed.includes('<?xml') || /^<[a-zA-Z][^>]*>/.test(trimmed));
}

function prettifyXML(str) {
    if (typeof str !== 'string') return str;
    // Simple XML prettification - add indentation
    let formatted = '';
    let indent = 0;
    const indentSize = 2;
    const tokens = str.match(/<[^>]+>|[^<]+/g) || [];
    
    tokens.forEach(token => {
        if (token.startsWith('</')) {
            indent = Math.max(0, indent - indentSize);
            formatted += ' '.repeat(indent) + token + '\n';
        } else if (token.startsWith('<')) {
            formatted += ' '.repeat(indent) + token + '\n';
            if (!token.endsWith('/>') && !token.includes('</')) {
                indent += indentSize;
            }
        } else {
            const trimmed = token.trim();
            if (trimmed) {
                formatted += ' '.repeat(indent) + trimmed + '\n';
            }
        }
    });
    
    return formatted || str;
}

// Helper function to process objects and extract text/JSON content
function processObjectForLogging(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => processObjectForLogging(item));
    }
    
    const processed = {};
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' && (value.includes('\\n') || isJSON(value))) {
            // Store as-is, we'll format it in the output
            processed[key] = value;
        } else if (typeof value === 'object' && value !== null) {
            processed[key] = processObjectForLogging(value);
        } else {
            processed[key] = value;
        }
    }
    return processed;
}

logger.logGeneration = function(section, data, requestId = null) {
    if (!generationLogStream) {
        generationLogStream = fs.createWriteStream(generationLogPath, { flags: 'a' });
    }
    
    const timestamp = new Date().toISOString();
    const header = requestId ? `[${requestId}] ` : '';
    
    generationLogStream.write(`\n--- ${header}${section} (${timestamp}) ---\n`);
    
    // Only apply detailed formatting for AI message sections
    const isAIMessageSection = section.startsWith('AI_') || 
                                section === 'DIRECTOR_AI_CALL' ||
                                section === 'AI_MESSAGES_SENT' ||
                                section === 'AI_MESSAGES_RESPONSE' ||
                                section === 'AI_RESPONSE_PARSED';
    
    // Handle different data types
    if (typeof data === 'string') {
        if (isAIMessageSection) {
            // String data - check if JSON or text
            if (isJSON(data)) {
                try {
                    const parsed = JSON.parse(data);
                    generationLogStream.write('=== JSON CONTENT ===\n');
                    generationLogStream.write(JSON.stringify(parsed, null, 2) + '\n');
                } catch (e) {
                    // If parsing fails, treat as text
                    generationLogStream.write('=== TEXT CONTENT ===\n');
                    generationLogStream.write(data.replace(/\\n/g, '\n') + '\n');
                }
            } else {
                // Regular text - convert \n to actual newlines
                generationLogStream.write('=== TEXT CONTENT ===\n');
                generationLogStream.write(data.replace(/\\n/g, '\n') + '\n');
            }
        } else {
            // Non-AI sections: just write the string
            generationLogStream.write(data + '\n');
        }
    } else if (typeof data === 'object' && data !== null) {
        if (isAIMessageSection) {
            // Special formatting for AI_MESSAGES_SENT
            if (section === 'AI_MESSAGES_SENT') {
                const model = data.model || 'unknown';
                const mode = data.hasTools ? 'TOOL MODE' : 'TEXT MODE';
                const iteration = data.iteration || 1;
                const maxLoops = data.maxLoops || 1;
                const messageCount = data.messageCount || data.messages?.length || 0;
                const totalChars = data.totalChars || 0;
                const stateful = data.isStateful ? 'stateful' : 'completion';
                const maxRetries = data.maxRetries || 3;
                
                // Write header
                generationLogStream.write(`\n---\n${model} | ${mode} ${iteration}/${maxLoops} | ${messageCount} msg | ${totalChars} char | ${stateful}\n\n`);
                
                // Process each message
                if (data.messages && Array.isArray(data.messages)) {
                    data.messages.forEach((msg) => {
                        const index = msg.index !== undefined ? msg.index : 0;
                        const attempt = 1; // Always 1 since we log before retries
                        const role = msg.role || 'unknown';
                        const content = msg.fullContent !== undefined ? msg.fullContent : msg.contentPreview || '';
                        
                        // Write message header
                        generationLogStream.write(`[${index}|${attempt}/${maxRetries}] ${role} Message\n\n`);
                        
                        // Format content
                        if (typeof content === 'string') {
                            // Check if JSON
                            if (isJSON(content)) {
                                try {
                                    const parsed = JSON.parse(content);
                                    generationLogStream.write(JSON.stringify(parsed, null, 2) + '\n');
                                } catch (e) {
                                    generationLogStream.write(content.replace(/\\n/g, '\n') + '\n');
                                }
                            } else if (isXML(content)) {
                                // XML content - prettify it
                                generationLogStream.write(prettifyXML(content));
                            } else {
                                // Regular text - convert \n escape sequences
                                generationLogStream.write(content.replace(/\\n/g, '\n') + '\n');
                            }
                        } else if (Array.isArray(content)) {
                            // Handle array content (e.g., OpenAI format with text/image_url)
                            content.forEach((item, itemIdx) => {
                                if (item.type === 'text' && typeof item.text === 'string') {
                                    if (isJSON(item.text)) {
                                        try {
                                            const parsed = JSON.parse(item.text);
                                            generationLogStream.write(JSON.stringify(parsed, null, 2) + '\n');
                                        } catch (e) {
                                            generationLogStream.write(item.text.replace(/\\n/g, '\n') + '\n');
                                        }
                                    } else if (isXML(item.text)) {
                                        // XML content - prettify it
                                        generationLogStream.write(prettifyXML(item.text));
                                    } else {
                                        generationLogStream.write(item.text.replace(/\\n/g, '\n') + '\n');
                                    }
                                } else if (item.type === 'input_text' && typeof item.text === 'string') {
                                    // Handle input_text type (Responses API format)
                                    if (isJSON(item.text)) {
                                        try {
                                            const parsed = JSON.parse(item.text);
                                            generationLogStream.write(JSON.stringify(parsed, null, 2) + '\n');
                                        } catch (e) {
                                            generationLogStream.write(item.text.replace(/\\n/g, '\n') + '\n');
                                        }
                                    } else if (isXML(item.text)) {
                                        // XML content - prettify it
                                        generationLogStream.write(prettifyXML(item.text));
                                    } else {
                                        generationLogStream.write(item.text.replace(/\\n/g, '\n') + '\n');
                                    }
                                } else if (item.type === 'image_url') {
                                    const url = item.image_url?.url || '';
                                    if (url.startsWith('data:')) {
                                        const base64Part = url.split(',')[1] || '';
                                        const sizeKB = Math.round(base64Part.length * 0.75 / 1024);
                                        generationLogStream.write(`IMAGE DATA at ${sizeKB}KB\n`);
                                    } else {
                                        generationLogStream.write(`IMAGE URL: ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}\n`);
                                    }
                                } else {
                                    generationLogStream.write(JSON.stringify(item, null, 2) + '\n');
                                }
                                if (itemIdx < content.length - 1) {
                                    generationLogStream.write('\n');
                                }
                            });
                        } else if (typeof content === 'object' && content !== null) {
                            // Handle object content - check if it's a message content object
                            if (content.type === 'text' && typeof content.text === 'string') {
                                if (isJSON(content.text)) {
                                    try {
                                        const parsed = JSON.parse(content.text);
                                        generationLogStream.write(JSON.stringify(parsed, null, 2) + '\n');
                                    } catch (e) {
                                        generationLogStream.write(content.text.replace(/\\n/g, '\n') + '\n');
                                    }
                                } else if (isXML(content.text)) {
                                    generationLogStream.write(prettifyXML(content.text));
                                } else {
                                    generationLogStream.write(content.text.replace(/\\n/g, '\n') + '\n');
                                }
                            } else if (content.type === 'input_text' && typeof content.text === 'string') {
                                // Handle input_text type (Responses API format)
                                if (isJSON(content.text)) {
                                    try {
                                        const parsed = JSON.parse(content.text);
                                        generationLogStream.write(JSON.stringify(parsed, null, 2) + '\n');
                                    } catch (e) {
                                        generationLogStream.write(content.text.replace(/\\n/g, '\n') + '\n');
                                    }
                                } else if (isXML(content.text)) {
                                    generationLogStream.write(prettifyXML(content.text));
                                } else {
                                    generationLogStream.write(content.text.replace(/\\n/g, '\n') + '\n');
                                }
                            } else if (content.type === 'image_url') {
                                const url = content.image_url?.url || '';
                                if (url.startsWith('data:')) {
                                    const base64Part = url.split(',')[1] || '';
                                    const sizeKB = Math.round(base64Part.length * 0.75 / 1024);
                                    generationLogStream.write(`IMAGE DATA at ${sizeKB}KB\n`);
                                } else {
                                    generationLogStream.write(`IMAGE URL: ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}\n`);
                                }
                            } else {
                                // Format as JSON for other object types
                                generationLogStream.write(JSON.stringify(content, null, 2) + '\n');
                            }
                        } else {
                            generationLogStream.write(String(content) + '\n');
                        }
                        
                        generationLogStream.write('\n---\n\n');
                    });
                }
                
                return; // Skip default AI section formatting
            }
            
            // Special formatting for AI_MESSAGES_RESPONSE
            if (section === 'AI_MESSAGES_RESPONSE') {
                const model = data.model || 'unknown';
                const mode = data.hasTools ? 'TOOL MODE' : 'TEXT MODE';
                const iteration = data.iteration || 1;
                const maxLoops = data.maxLoops || 1;
                const responseLength = data.responseLength || 0;
                const toolCallCount = data.toolCallCount || 0;
                const stateful = data.isStateful ? 'stateful' : 'completion';
                const responseId = data.responseId || null;
                
                // Write header
                generationLogStream.write(`\n---\n${model} | ${mode} ${iteration}/${maxLoops} | ${toolCallCount} tool call${toolCallCount !== 1 ? 's' : ''} | ${responseLength} char | ${stateful}\n`);
                
                // Add usage row if available from completionObject
                if (data.completionObject?.usage) {
                    const usage = data.completionObject.usage;
                    const totalTokens = usage.total_tokens || usage.input_tokens + usage.output_tokens || 0;
                    const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
                    const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
                    const cachedTokens = usage.input_tokens_details?.cached_tokens || usage.prompt_tokens_details?.cached_tokens || 0;
                    const reasoningTokens = usage.output_tokens_details?.reasoning_tokens || usage.completion_tokens_details?.reasoning_tokens || 0;
                    
                    let usageLine = `Usage: ${totalTokens} tokens [INPUT: ${inputTokens} | OUTPUT: ${outputTokens}`;
                    if (cachedTokens > 0) {
                        usageLine += ` | CACHED: ${cachedTokens}`;
                    }
                    if (reasoningTokens > 0) {
                        usageLine += ` | REASONING: ${reasoningTokens}`;
                    }
                    generationLogStream.write(`${usageLine}]\n\n`);
                } else {
                    generationLogStream.write('\n');
                }
                
                // Format fullResponse
                const fullResponse = data.fullResponse || '';
                if (typeof fullResponse === 'string' && fullResponse.length > 0) {
                    // Check if JSON
                    if (isJSON(fullResponse)) {
                        try {
                            const parsed = JSON.parse(fullResponse);
                            generationLogStream.write(JSON.stringify(parsed, null, 2) + '\n');
                        } catch (e) {
                            generationLogStream.write(fullResponse.replace(/\\n/g, '\n') + '\n');
                        }
                    } else if (isXML(fullResponse)) {
                        // XML content - prettify it
                        generationLogStream.write(prettifyXML(fullResponse));
                    } else {
                        // Regular text - convert \n escape sequences
                        generationLogStream.write(fullResponse.replace(/\\n/g, '\n') + '\n');
                    }
                } else if (Array.isArray(fullResponse)) {
                    // Handle array content (e.g., OpenAI format with text/image_url)
                    fullResponse.forEach((item, itemIdx) => {
                        if (item.type === 'text' && typeof item.text === 'string') {
                            if (isJSON(item.text)) {
                                try {
                                    const parsed = JSON.parse(item.text);
                                    generationLogStream.write(JSON.stringify(parsed, null, 2) + '\n');
                                } catch (e) {
                                    generationLogStream.write(item.text.replace(/\\n/g, '\n') + '\n');
                                }
                            } else if (isXML(item.text)) {
                                // XML content - prettify it
                                generationLogStream.write(prettifyXML(item.text));
                            } else {
                                generationLogStream.write(item.text.replace(/\\n/g, '\n') + '\n');
                            }
                        } else if (item.type === 'input_text' && typeof item.text === 'string') {
                            // Handle input_text type (Responses API format)
                            if (isJSON(item.text)) {
                                try {
                                    const parsed = JSON.parse(item.text);
                                    generationLogStream.write(JSON.stringify(parsed, null, 2) + '\n');
                                } catch (e) {
                                    generationLogStream.write(item.text.replace(/\\n/g, '\n') + '\n');
                                }
                            } else if (isXML(item.text)) {
                                // XML content - prettify it
                                generationLogStream.write(prettifyXML(item.text));
                            } else {
                                generationLogStream.write(item.text.replace(/\\n/g, '\n') + '\n');
                            }
                        } else if (item.type === 'image_url') {
                            const url = item.image_url?.url || '';
                            if (url.startsWith('data:')) {
                                const base64Part = url.split(',')[1] || '';
                                const sizeKB = Math.round(base64Part.length * 0.75 / 1024);
                                generationLogStream.write(`IMAGE DATA at ${sizeKB}KB\n`);
                            } else {
                                generationLogStream.write(`IMAGE URL: ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}\n`);
                            }
                        } else {
                            generationLogStream.write(JSON.stringify(item, null, 2) + '\n');
                        }
                        if (itemIdx < fullResponse.length - 1) {
                            generationLogStream.write('\n');
                        }
                    });
                } else if (typeof fullResponse === 'object' && fullResponse !== null) {
                    // Format as JSON
                    generationLogStream.write(JSON.stringify(fullResponse, null, 2) + '\n');
                }
                
                // Format tool calls from completionObject if available
                if (data.completionObject?.output) {
                    const toolCalls = data.completionObject.output.filter(item => 
                        item.type === 'function_call' || item.type === 'tool_call'
                    );
                    
                    if (toolCalls.length > 0) {
                        generationLogStream.write('---\n\n');
                        toolCalls.forEach((toolCall, index) => {
                            const toolName = toolCall.name || 'unknown';
                            const callId = toolCall.call_id || toolCall.id || 'unknown';
                            const status = toolCall.status || 'unknown';
                            
                            // Write tool call header
                            generationLogStream.write(`Tool Call #${index + 1} -> [${toolName}|${callId}|${status}]\n\n`);
                            
                            // Format arguments
                            let argumentsStr = toolCall.arguments || '';
                            if (typeof argumentsStr === 'string') {
                                // Try to parse as JSON
                                if (isJSON(argumentsStr)) {
                                    try {
                                        const parsed = JSON.parse(argumentsStr);
                                        generationLogStream.write(JSON.stringify(parsed, null, 2) + '\n');
                                    } catch (e) {
                                        generationLogStream.write(argumentsStr.replace(/\\n/g, '\n') + '\n');
                                    }
                                } else if (isXML(argumentsStr)) {
                                    // XML content - prettify it
                                    generationLogStream.write(prettifyXML(argumentsStr));
                                } else {
                                    // Regular text - convert \n escape sequences
                                    generationLogStream.write(argumentsStr.replace(/\\n/g, '\n') + '\n');
                                }
                            } else if (typeof argumentsStr === 'object' && argumentsStr !== null) {
                                // Already an object - format as JSON
                                generationLogStream.write(JSON.stringify(argumentsStr, null, 2) + '\n');
                            }
                            
                            if (index < toolCalls.length - 1) {
                                generationLogStream.write('\n---\n\n');
                            }
                        });
                    }
                }
                
                // Format full completionObject if needed (for debugging, but tool calls are more important)
                if (data.completionObject && (!data.completionObject.output || data.completionObject.output.filter(item => item.type === 'function_call' || item.type === 'tool_call').length === 0)) {
                    generationLogStream.write('\n--- Completion Object ---\n');
                    generationLogStream.write(JSON.stringify(data.completionObject, null, 2) + '\n');
                }
                
                // Add response ID if available
                if (responseId) {
                    generationLogStream.write(`\n--- Response ID: ${responseId} ---\n`);
                }
                
                // Add citations if available (for non-tool responses)
                if (data.citations && Array.isArray(data.citations) && data.citations.length > 0) {
                    generationLogStream.write(`\n--- Citations (${data.citations.length}) ---\n`);
                    generationLogStream.write(JSON.stringify(data.citations, null, 2) + '\n');
                }
                
                generationLogStream.write('\n---\n\n');
                return; // Skip default AI section formatting
            }
            
            // First, write the structured data as JSON
            generationLogStream.write('=== STRUCTURED DATA ===\n');
            generationLogStream.write(JSON.stringify(data, null, 2) + '\n');
            
            // Then extract and format inner text/JSON content from nested objects
            function extractAndFormatContent(obj, prefix = '') {
                if (typeof obj === 'string') {
                    // Found a string value - check if it needs formatting
                    // Check for common content field names or significant length
                    const isContentField = prefix && (
                        prefix.includes('fullContent') || 
                        prefix.includes('text') || 
                        prefix.includes('response') || 
                        prefix.includes('message') ||
                        prefix.includes('content')
                    );
                    
                    if (isJSON(obj)) {
                        generationLogStream.write(`\n--- ${prefix || 'root'} (JSON) ---\n`);
                        try {
                            const parsed = JSON.parse(obj);
                            generationLogStream.write(JSON.stringify(parsed, null, 2) + '\n');
                        } catch (e) {
                            generationLogStream.write(obj + '\n');
                        }
                    } else if (isContentField || obj.includes('\\n') || obj.includes('\n') || obj.length > 100) {
                        // Format text content - convert \n escape sequences to actual newlines
                        generationLogStream.write(`\n--- ${prefix || 'root'} (TEXT) ---\n`);
                        // Replace both \\n (escape sequence) and preserve actual newlines
                        const formatted = obj.replace(/\\n/g, '\n');
                        generationLogStream.write(formatted + '\n');
                    }
                } else if (typeof obj === 'object' && obj !== null) {
                    if (Array.isArray(obj)) {
                        obj.forEach((item, idx) => {
                            const newPrefix = prefix ? `${prefix}[${idx}]` : `[${idx}]`;
                            extractAndFormatContent(item, newPrefix);
                        });
                    } else {
                        for (const [key, value] of Object.entries(obj)) {
                            const newPrefix = prefix ? `${prefix}.${key}` : key;
                            extractAndFormatContent(value, newPrefix);
                        }
                    }
                }
            }
            
            // Extract and format all text/JSON content from the object
            extractAndFormatContent(data);
        } else {
            // Non-AI sections: just write the JSON
            generationLogStream.write(JSON.stringify(data, null, 2) + '\n');
        }
    } else {
        // Primitive types
        generationLogStream.write(String(data) + '\n');
    }
};

logger.logGenerationSummary = function(summary, requestId = null) {
    if (!generationLogStream) {
        generationLogStream = fs.createWriteStream(generationLogPath, { flags: 'a' });
    }
    
    const timestamp = new Date().toISOString();
    const header = requestId ? `[${requestId}] ` : '';
    
    generationLogStream.write(`\n${header}=== SUMMARY (${timestamp}) ===\n`);
    generationLogStream.write(summary + '\n');
};

// Conditional console logging based on verbosity
logger.verbose = function(message, ...args) {
    if (currentVerbosity >= VERBOSITY_LEVELS.VERBOSE) {
        console.log(message, ...args);
    }
};

logger.detailed = function(message, ...args) {
    if (currentVerbosity >= VERBOSITY_LEVELS.DETAILED) {
        console.log(message, ...args);
    }
};

logger.normal = function(message, ...args) {
    if (currentVerbosity >= VERBOSITY_LEVELS.NORMAL) {
        console.log(message, ...args);
    }
};

logger.minimal = function(message, ...args) {
    console.log(message, ...args);
};

// Rotate generation log on startup
logger.rotateGenerationLog = function() {
    try {
        // Close existing stream if open
        if (generationLogStream) {
            generationLogStream.end();
            generationLogStream = null;
        }
        
        // Check if log file exists
        if (fs.existsSync(generationLogPath)) {
            // Generate timestamp for the archived log
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
            const archivedLogPath = path.join(logsDir, `generation-detailed-${timestamp}.log`);
            
            // Rename the existing log file
            fs.renameSync(generationLogPath, archivedLogPath);
            logger.info(`Rotated generation log: ${path.basename(archivedLogPath)}`);
        }
        
        // Create new log file immediately
        generationLogStream = fs.createWriteStream(generationLogPath, { flags: 'w' });
        logger.info('Created new generation log file');
    } catch (error) {
        logger.warn(`Failed to rotate generation log: ${error.message}`);
    }
};

// Clean shutdown
logger.shutdown = function() {
    logger.info('Logger shutting down...');
    if (generationLogStream) {
        generationLogStream.end();
        generationLogStream = null;
    }
    // Winston handles cleanup automatically
};

// Export verbosity levels for use in other modules
logger.VERBOSITY_LEVELS = VERBOSITY_LEVELS;

module.exports = logger;

