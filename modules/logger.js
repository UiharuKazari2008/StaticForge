const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

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

// Clean shutdown
logger.shutdown = function() {
    logger.info('Logger shutting down...');
    // Winston handles cleanup automatically
};

module.exports = logger;

