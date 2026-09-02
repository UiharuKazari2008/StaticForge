'use strict';

/**
 * MCP Report Issue Module
 * 
 * Development QA reporting for Grok and other agents.
 * Reports: tool failures, taking too long, too much data, too bloated / hard to understand.
 * 
 * Config report levels:
 * - 0: Critical only (recurring failure/confusion)
 * - 1: Any misunderstandings and errors
 * - 2: More detailed level 1
 * - 3: All good and bad reviews of tools and guides
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.join(__dirname, '..');
const ISSUES_DIR = path.join(WORKSPACE_ROOT, '.issues');
const ISSUES_LOG_FILE = path.join(ISSUES_DIR, 'reports.jsonl');
const CONFIG_FILE = path.join(ISSUES_DIR, 'config.json');

const REPORT_LEVELS = {
    0: {
        name: 'critical',
        label: 'Critical Only',
        description: 'Recurring failure/confusion only',
        accepts: ['critical', 'recurring_failure', 'recurring_confusion']
    },
    1: {
        name: 'errors',
        label: 'Errors',
        description: 'Any misunderstandings and errors',
        accepts: ['critical', 'recurring_failure', 'recurring_confusion', 'error', 'misunderstanding', 'failure']
    },
    2: {
        name: 'detailed',
        label: 'Detailed',
        description: 'More detailed level 1 (includes warnings, slow, bloat)',
        accepts: ['critical', 'recurring_failure', 'recurring_confusion', 'error', 'misunderstanding', 'failure', 'warning', 'slow', 'too_much_data', 'bloated', 'hard_to_understand']
    },
    3: {
        name: 'all',
        label: 'All',
        description: 'All good and bad reviews of tools and guides',
        accepts: ['critical', 'recurring_failure', 'recurring_confusion', 'error', 'misunderstanding', 'failure', 'warning', 'slow', 'too_much_data', 'bloated', 'hard_to_understand', 'review', 'suggestion', 'good', 'bad', 'info']
    }
};

const DEFAULT_LEVEL = 1;

function ensureIssuesDir() {
    if (!fs.existsSync(ISSUES_DIR)) {
        fs.mkdirSync(ISSUES_DIR, { recursive: true });
    }
}

function readJsonFile(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return fallback;
    }
}

function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function appendJsonlFile(filePath, entry) {
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

function readJsonlFile(filePath, limit = 0) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
        const entries = lines.map((line) => {
            try { return JSON.parse(line); }
            catch (_) { return null; }
        }).filter(Boolean);
        return limit > 0 ? entries.slice(-limit) : entries;
    } catch (_) {
        return [];
    }
}

/**
 * Get current report level configuration
 */
function getReportConfig() {
    ensureIssuesDir();
    const config = readJsonFile(CONFIG_FILE, { level: DEFAULT_LEVEL });
    const level = Number(config.level);
    const levelDef = REPORT_LEVELS[level] || REPORT_LEVELS[DEFAULT_LEVEL];
    return {
        level,
        levelName: levelDef.name,
        levelLabel: levelDef.label,
        description: levelDef.description,
        accepts: levelDef.accepts
    };
}

/**
 * Set report level
 */
function setReportLevel(level) {
    ensureIssuesDir();
    const numLevel = Number(level);
    if (!(numLevel in REPORT_LEVELS)) {
        return {
            success: false,
            error: 'Invalid level',
            validLevels: Object.entries(REPORT_LEVELS).map(([l, def]) => ({
                level: Number(l),
                name: def.name,
                description: def.description
            }))
        };
    }
    const config = readJsonFile(CONFIG_FILE, {});
    config.level = numLevel;
    config.updated_at = new Date().toISOString();
    writeJsonFile(CONFIG_FILE, config);
    return {
        success: true,
        level: numLevel,
        levelName: REPORT_LEVELS[numLevel].name,
        description: REPORT_LEVELS[numLevel].description
    };
}

/**
 * Check if a report type is accepted at the current level
 */
function shouldAcceptReport(reportType) {
    const config = getReportConfig();
    const type = String(reportType || '').toLowerCase().replace(/[\s-]+/g, '_');
    return config.accepts.includes(type);
}

/**
 * Normalize report type to canonical form
 */
function normalizeReportType(reportType) {
    const type = String(reportType || '').toLowerCase().replace(/[\s-]+/g, '_');
    // Map common variations
    const typeMap = {
        'tool_failure': 'failure',
        'tool_failing': 'failure',
        'takes_too_long': 'slow',
        'taking_too_long': 'slow',
        'timeout': 'slow',
        'too_slow': 'slow',
        'data_overload': 'too_much_data',
        'overwhelming': 'too_much_data',
        'confusing': 'hard_to_understand',
        'unclear': 'hard_to_understand',
        'complex': 'hard_to_understand',
        'repeat_failure': 'recurring_failure',
        'keep_failing': 'recurring_failure',
        'keeps_failing': 'recurring_failure',
        'repeat_confusion': 'recurring_confusion',
        'still_confused': 'recurring_confusion',
        'positive': 'good',
        'negative': 'bad',
        'feedback': 'review',
        'improvement': 'suggestion',
        'idea': 'suggestion'
    };
    return typeMap[type] || type;
}

/**
 * report_issue - Report a development QA issue
 * 
 * @param {object} params
 * @param {string} params.type - Issue type (failure, slow, too_much_data, bloated, etc.)
 * @param {string} params.tool - Tool name that caused the issue (optional)
 * @param {string} params.message - Description of the issue
 * @param {string} [params.context] - Additional context
 * @param {string} [params.reporter] - Who is reporting (grok, cursor, etc.)
 * @param {number} [params.severity] - Severity 1-5 (optional, inferred from type)
 * @param {object} [params.metadata] - Additional metadata
 */
function reportIssue(params) {
    ensureIssuesDir();

    const config = getReportConfig();
    const rawType = params.type || 'info';
    const normalizedType = normalizeReportType(rawType);

    // Check if this report type is accepted at current level
    if (!config.accepts.includes(normalizedType)) {
        return {
            success: false,
            filtered: true,
            reason: 'Report type not accepted at current level',
            currentLevel: config.level,
            levelName: config.levelName,
            reportType: normalizedType,
            acceptedTypes: config.accepts
        };
    }

    // Infer severity from type if not provided
    let severity = params.severity;
    if (severity == null) {
        const severityMap = {
            'critical': 5,
            'recurring_failure': 5,
            'recurring_confusion': 4,
            'error': 4,
            'failure': 4,
            'misunderstanding': 3,
            'slow': 3,
            'too_much_data': 3,
            'bloated': 2,
            'hard_to_understand': 2,
            'warning': 2,
            'bad': 2,
            'review': 1,
            'suggestion': 1,
            'good': 1,
            'info': 1
        };
        severity = severityMap[normalizedType] || 2;
    }

    const now = new Date().toISOString();
    const report = {
        id: `issue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        at: now,
        type: normalizedType,
        rawType,
        tool: params.tool || null,
        message: params.message || '',
        context: params.context || null,
        reporter: params.reporter || 'unknown',
        severity,
        metadata: params.metadata || null,
        level_recorded_at: config.level
    };

    appendJsonlFile(ISSUES_LOG_FILE, report);

    return {
        success: true,
        report,
        currentLevel: config.level,
        levelName: config.levelName
    };
}

/**
 * List recent issues
 */
function listIssues(params = {}) {
    ensureIssuesDir();
    const limit = Number(params.limit) || 50;
    const issues = readJsonlFile(ISSUES_LOG_FILE, limit);

    // Filter by type if requested
    let filtered = issues;
    if (params.type) {
        const wantType = normalizeReportType(params.type);
        filtered = issues.filter((i) => i.type === wantType);
    }
    if (params.tool) {
        filtered = filtered.filter((i) => i.tool === params.tool);
    }
    if (params.min_severity) {
        const minSev = Number(params.min_severity);
        filtered = filtered.filter((i) => (i.severity || 0) >= minSev);
    }

    return {
        success: true,
        issues: filtered.slice(-limit),
        total: filtered.length,
        config: getReportConfig()
    };
}

/**
 * Get issue statistics
 */
function getIssueStats() {
    ensureIssuesDir();
    const issues = readJsonlFile(ISSUES_LOG_FILE);
    
    const byType = {};
    const byTool = {};
    const bySeverity = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    
    for (const issue of issues) {
        const type = issue.type || 'unknown';
        byType[type] = (byType[type] || 0) + 1;
        
        if (issue.tool) {
            byTool[issue.tool] = (byTool[issue.tool] || 0) + 1;
        }
        
        const sev = issue.severity || 2;
        bySeverity[sev] = (bySeverity[sev] || 0) + 1;
    }

    return {
        success: true,
        total: issues.length,
        byType,
        byTool,
        bySeverity,
        config: getReportConfig()
    };
}

/**
 * List available report levels
 */
function listReportLevels() {
    return {
        success: true,
        levels: Object.entries(REPORT_LEVELS).map(([level, def]) => ({
            level: Number(level),
            name: def.name,
            label: def.label,
            description: def.description,
            acceptedTypes: def.accepts
        })),
        currentLevel: getReportConfig().level
    };
}

module.exports = {
    REPORT_LEVELS,
    DEFAULT_LEVEL,
    getReportConfig,
    setReportLevel,
    shouldAcceptReport,
    normalizeReportType,
    reportIssue,
    listIssues,
    getIssueStats,
    listReportLevels
};
