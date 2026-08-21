const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const SQLiteAsyncWrapper = require('./sqliteAsyncWrapper');

let dbPath = null;
let db = null;

async function initializeTelemetryDatabase(databasesPath) {
    try {
        dbPath = path.join(databasesPath, 'telemetry.db');
        const cacheDir = path.dirname(dbPath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        db = new SQLiteAsyncWrapper(dbPath, 'telemetry', 30);
        await db.initialize();
        await createTelemetryTables();
        logger.bootSubStep('Telemetry database ready');
        return true;
    } catch (error) {
        logger.error('Error initializing telemetry database:', error);
        console.error('Full error stack:', error.stack);
        return false;
    }
}

async function createTelemetryTables() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS telemetry_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL DEFAULT 'login',
            recorded_at INTEGER NOT NULL,
            client_timestamp INTEGER,
            ip TEXT,
            user_agent TEXT,
            platform TEXT,
            language TEXT,
            timezone TEXT,
            screen_width INTEGER,
            screen_height INTEGER,
            cookie_enabled INTEGER,
            on_line INTEGER,
            user_type TEXT,
            session_id TEXT,
            route TEXT,
            payload_json TEXT NOT NULL
        )
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_recorded_at ON telemetry_events (recorded_at DESC)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_event_type ON telemetry_events (event_type)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_ip ON telemetry_events (ip)`);
}

function getDb() {
    if (!db) {
        throw new Error('Telemetry database not initialized');
    }
    return db;
}

function getCheckpointManager() {
    return db ? db.getCheckpointManager() : null;
}

function normalizeEventType(value) {
    const t = String(value || 'login').toLowerCase();
    if (t === 'app' || t === 'login' || t === 'client_perf') return t;
    return 'login';
}

async function recordTelemetryEvent(meta = {}) {
    if (!db) return false;

    const recordedAt = Date.now();
    const eventType = normalizeEventType(meta.eventType);
    const payload = meta.payload && typeof meta.payload === 'object' ? meta.payload : {};

    await db.run(
        `INSERT INTO telemetry_events (
            event_type, recorded_at, client_timestamp, ip, user_agent, platform, language, timezone,
            screen_width, screen_height, cookie_enabled, on_line, user_type, session_id, route, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            eventType,
            recordedAt,
            meta.clientTimestamp || null,
            meta.ip || null,
            meta.userAgent || null,
            meta.platform || null,
            meta.language || null,
            meta.timezone || null,
            meta.screenWidth || null,
            meta.screenHeight || null,
            meta.cookieEnabled ? 1 : 0,
            meta.onLine ? 1 : 0,
            meta.userType || null,
            meta.sessionId || null,
            meta.route || null,
            JSON.stringify(payload)
        ]
    );

    return true;
}

async function listTelemetryEvents({ page = 1, limit = 15, search = '', eventType = '' } = {}) {
    if (!db) {
        return { events: [], pagination: { currentPage: page, totalPages: 1, totalCount: 0, limit } };
    }

    const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 15));
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const offset = (safePage - 1) * safeLimit;

    const where = [];
    const params = [];

    const normalizedType = eventType ? normalizeEventType(eventType) : '';
    if (normalizedType) {
        where.push('event_type = ?');
        params.push(normalizedType);
    }

    const q = String(search || '').trim().toLowerCase();
    if (q) {
        where.push(`(
            LOWER(COALESCE(ip, '')) LIKE ?
            OR LOWER(COALESCE(user_agent, '')) LIKE ?
            OR LOWER(COALESCE(platform, '')) LIKE ?
            OR LOWER(COALESCE(route, '')) LIKE ?
            OR LOWER(COALESCE(user_type, '')) LIKE ?
        )`);
        const like = `%${q}%`;
        params.push(like, like, like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await db.get(
        `SELECT COUNT(*) AS total FROM telemetry_events ${whereSql}`,
        params
    );
    const totalCount = countRow?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalCount / safeLimit));
    const currentPage = Math.min(safePage, totalPages);

    const rows = await db.all(
        `SELECT id, event_type, recorded_at, client_timestamp, ip, user_agent, platform, language,
                timezone, screen_width, screen_height, cookie_enabled, on_line, user_type, session_id,
                route, payload_json
         FROM telemetry_events
         ${whereSql}
         ORDER BY recorded_at DESC
         LIMIT ? OFFSET ?`,
        [...params, safeLimit, (currentPage - 1) * safeLimit]
    );

    const events = (rows || []).map((row) => {
        let payload = {};
        try {
            payload = row.payload_json ? JSON.parse(row.payload_json) : {};
        } catch (_) {
            payload = {};
        }
        return {
            id: row.id,
            eventType: row.event_type,
            recordedAt: row.recorded_at,
            clientTimestamp: row.client_timestamp,
            ip: row.ip,
            userAgent: row.user_agent,
            platform: row.platform,
            language: row.language,
            timezone: row.timezone,
            screen: {
                width: row.screen_width,
                height: row.screen_height
            },
            cookieEnabled: !!row.cookie_enabled,
            onLine: !!row.on_line,
            userType: row.user_type,
            sessionId: row.session_id,
            route: row.route,
            payload,
            connection: payload.connection || null,
            serviceWorker: payload.serviceWorker || {},
            storage: payload.storage || {},
            features: payload.features || {}
        };
    });

    return {
        events,
        pagination: {
            currentPage,
            totalPages,
            totalCount,
            limit: safeLimit
        }
    };
}

module.exports = {
    initializeTelemetryDatabase,
    getDb,
    getCheckpointManager,
    recordTelemetryEvent,
    listTelemetryEvents
};
