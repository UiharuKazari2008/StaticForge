const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class DevBridgeDatabase {
    constructor() {
        this.db = null;
        this.dbPath = path.join(__dirname, '..', '.cache', 'dev_bridge.db');
        this.init();
    }

    init() {
        try {
            // Ensure cache directory exists
            const cacheDir = path.dirname(this.dbPath);
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }

            this.db = new sqlite3.Database(this.dbPath);
            this.createTables();
        } catch (error) {
            console.error('❌ Failed to initialize dev bridge database:', error);
        }
    }

    createTables() {
        const createLogsTable = `
            CREATE TABLE IF NOT EXISTS dev_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                type TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                stack_trace TEXT,
                url TEXT,
                user_agent TEXT,
                session_id TEXT,
                client_id TEXT,
                data TEXT
            )
        `;

        const createNetworkLogsTable = `
            CREATE TABLE IF NOT EXISTS network_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                type TEXT NOT NULL,
                url TEXT NOT NULL,
                method TEXT,
                status_code INTEGER,
                response_time INTEGER,
                request_size INTEGER,
                response_size INTEGER,
                user_agent TEXT,
                session_id TEXT,
                client_id TEXT,
                headers TEXT,
                body TEXT
            )
        `;

        const createScreenshotsTable = `
            CREATE TABLE IF NOT EXISTS screenshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                client_id TEXT NOT NULL,
                session_id TEXT,
                url TEXT,
                screenshot_data TEXT NOT NULL,
                element_selector TEXT,
                width INTEGER,
                height INTEGER
            )
        `;

        const createExecutionsTable = `
            CREATE TABLE IF NOT EXISTS code_executions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                client_id TEXT NOT NULL,
                session_id TEXT,
                code TEXT NOT NULL,
                result TEXT,
                error TEXT,
                execution_time INTEGER
            )
        `;

        this.db.serialize(() => {
            this.db.run(createLogsTable);
            this.db.run(createNetworkLogsTable);
            this.db.run(createScreenshotsTable);
            this.db.run(createExecutionsTable);
            
            // Create indexes for better performance
            this.db.run('CREATE INDEX IF NOT EXISTS idx_dev_logs_timestamp ON dev_logs(timestamp)');
            this.db.run('CREATE INDEX IF NOT EXISTS idx_dev_logs_type ON dev_logs(type)');
            this.db.run('CREATE INDEX IF NOT EXISTS idx_dev_logs_client_id ON dev_logs(client_id)');
            this.db.run('CREATE INDEX IF NOT EXISTS idx_network_logs_timestamp ON network_logs(timestamp)');
            this.db.run('CREATE INDEX IF NOT EXISTS idx_network_logs_client_id ON network_logs(client_id)');
            this.db.run('CREATE INDEX IF NOT EXISTS idx_screenshots_timestamp ON screenshots(timestamp)');
            this.db.run('CREATE INDEX IF NOT EXISTS idx_screenshots_client_id ON screenshots(client_id)');
            this.db.run('CREATE INDEX IF NOT EXISTS idx_executions_timestamp ON code_executions(timestamp)');
            this.db.run('CREATE INDEX IF NOT EXISTS idx_executions_client_id ON code_executions(client_id)');
        });
    }

    logMessage(logData) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(`
                INSERT INTO dev_logs 
                (timestamp, type, level, message, stack_trace, url, user_agent, session_id, client_id, data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            stmt.run([
                logData.timestamp || Date.now(),
                logData.type || 'log',
                logData.level || 'info',
                logData.message || '',
                logData.stackTrace || null,
                logData.url || null,
                logData.userAgent || null,
                logData.sessionId || null,
                logData.clientId || null,
                logData.data ? JSON.stringify(logData.data) : null
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
            
            stmt.finalize();
        });
    }

    logNetworkRequest(networkData) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(`
                INSERT INTO network_logs 
                (timestamp, type, url, method, status_code, response_time, request_size, response_size, user_agent, session_id, client_id, headers, body)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            stmt.run([
                networkData.timestamp || Date.now(),
                networkData.type || 'request',
                networkData.url || '',
                networkData.method || null,
                networkData.statusCode || null,
                networkData.responseTime || null,
                networkData.requestSize || null,
                networkData.responseSize || null,
                networkData.userAgent || null,
                networkData.sessionId || null,
                networkData.clientId || null,
                networkData.headers ? JSON.stringify(networkData.headers) : null,
                networkData.body || null
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
            
            stmt.finalize();
        });
    }

    saveScreenshot(screenshotData) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(`
                INSERT INTO screenshots 
                (timestamp, client_id, session_id, url, screenshot_data, element_selector, width, height)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            stmt.run([
                screenshotData.timestamp || Date.now(),
                screenshotData.clientId || '',
                screenshotData.sessionId || null,
                screenshotData.url || null,
                screenshotData.screenshotData || '',
                screenshotData.elementSelector || null,
                screenshotData.width || null,
                screenshotData.height || null
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
            
            stmt.finalize();
        });
    }

    logCodeExecution(executionData) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(`
                INSERT INTO code_executions 
                (timestamp, client_id, session_id, code, result, error, execution_time)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            stmt.run([
                executionData.timestamp || Date.now(),
                executionData.clientId || '',
                executionData.sessionId || null,
                executionData.code || '',
                executionData.result ? JSON.stringify(executionData.result) : null,
                executionData.error || null,
                executionData.executionTime || null
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
            
            stmt.finalize();
        });
    }

    getLogs(options = {}) {
        return new Promise((resolve, reject) => {
            const {
                type = null,
                level = null,
                clientId = null,
                limit = 100,
                offset = 0,
                startTime = null,
                endTime = null
            } = options;

            let query = 'SELECT * FROM dev_logs WHERE 1=1';
            const params = [];

            if (type) {
                query += ' AND type = ?';
                params.push(type);
            }

            if (level) {
                query += ' AND level = ?';
                params.push(level);
            }

            if (clientId) {
                query += ' AND client_id = ?';
                params.push(clientId);
            }

            if (startTime) {
                query += ' AND timestamp >= ?';
                params.push(startTime);
            }

            if (endTime) {
                query += ' AND timestamp <= ?';
                params.push(endTime);
            }

            query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            this.db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    getNetworkLogs(options = {}) {
        return new Promise((resolve, reject) => {
            const {
                type = null,
                clientId = null,
                limit = 100,
                offset = 0,
                startTime = null,
                endTime = null
            } = options;

            let query = 'SELECT * FROM network_logs WHERE 1=1';
            const params = [];

            if (type) {
                query += ' AND type = ?';
                params.push(type);
            }

            if (clientId) {
                query += ' AND client_id = ?';
                params.push(clientId);
            }

            if (startTime) {
                query += ' AND timestamp >= ?';
                params.push(startTime);
            }

            if (endTime) {
                query += ' AND timestamp <= ?';
                params.push(endTime);
            }

            query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            this.db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    getScreenshots(options = {}) {
        return new Promise((resolve, reject) => {
            const {
                clientId = null,
                limit = 50,
                offset = 0,
                startTime = null,
                endTime = null
            } = options;

            let query = 'SELECT * FROM screenshots WHERE 1=1';
            const params = [];

            if (clientId) {
                query += ' AND client_id = ?';
                params.push(clientId);
            }

            if (startTime) {
                query += ' AND timestamp >= ?';
                params.push(startTime);
            }

            if (endTime) {
                query += ' AND timestamp <= ?';
                params.push(endTime);
            }

            query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            this.db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    getCodeExecutions(options = {}) {
        return new Promise((resolve, reject) => {
            const {
                clientId = null,
                limit = 100,
                offset = 0,
                startTime = null,
                endTime = null
            } = options;

            let query = 'SELECT * FROM code_executions WHERE 1=1';
            const params = [];

            if (clientId) {
                query += ' AND client_id = ?';
                params.push(clientId);
            }

            if (startTime) {
                query += ' AND timestamp >= ?';
                params.push(startTime);
            }

            if (endTime) {
                query += ' AND timestamp <= ?';
                params.push(endTime);
            }

            query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            this.db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    getLogCount(options = {}) {
        return new Promise((resolve, reject) => {
            const {
                type = null,
                level = null,
                clientId = null,
                startTime = null,
                endTime = null
            } = options;

            let query = 'SELECT COUNT(*) as count FROM dev_logs WHERE 1=1';
            const params = [];

            if (type) {
                query += ' AND type = ?';
                params.push(type);
            }

            if (level) {
                query += ' AND level = ?';
                params.push(level);
            }

            if (clientId) {
                query += ' AND client_id = ?';
                params.push(clientId);
            }

            if (startTime) {
                query += ' AND timestamp >= ?';
                params.push(startTime);
            }

            if (endTime) {
                query += ' AND timestamp <= ?';
                params.push(endTime);
            }

            this.db.get(query, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.count);
                }
            });
        });
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = DevBridgeDatabase;
