const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const { attachLegacyDatabaseCheckpoint } = require('./legacyDatabaseCheckpoint');

const SHARED_QUIPS_WORKSPACE_ID = '_shared';

function normalizeQuipTerm(term) {
    if (!term || typeof term !== 'string') return '';
    return term.toLowerCase().trim();
}

function dedupeQuipEntries(entries) {
    const byTerm = new Map();

    for (const entry of entries || []) {
        const key = normalizeQuipTerm(entry?.term);
        if (!key || !Array.isArray(entry.phrases) || entry.phrases.length === 0) continue;

        const phrases = entry.phrases
            .filter((p) => typeof p === 'string' && p.trim())
            .map((p) => p.trim());

        if (phrases.length === 0) continue;

        const existing = byTerm.get(key);
        if (!existing) {
            byTerm.set(key, { term: key, phrases: [...phrases] });
            continue;
        }

        const merged = new Set(existing.phrases);
        for (const phrase of phrases) merged.add(phrase);
        existing.phrases = [...merged];
    }

    return [...byTerm.values()];
}

class GenerationQuipsDatabase {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('GenerationQuipsDatabase requires globalResources instance and should only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
        this.db = null;
        this.dbPath = path.join(globalResources.getPath('databases'), 'generation_quips.db');
        this.init();
    }

    init() {
        try {
            const dataDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('foreign_keys = ON');
            attachLegacyDatabaseCheckpoint(this, this.dbPath, () => this.db, this.globalResources);
            this.createTables();
            logger.bootSubStep('Generation quips database initialized');
        } catch (error) {
            logger.error('Error initializing generation quips database:', error);
            throw error;
        }
    }

    createTables() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS dynamic_quips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id TEXT,
                match_term TEXT NOT NULL,
                phrases TEXT NOT NULL,
                generated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                UNIQUE(workspace_id, match_term)
            )
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS extracted_terms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id TEXT NOT NULL,
                term TEXT NOT NULL,
                occurrence_count INTEGER NOT NULL DEFAULT 0,
                avg_weight REAL NOT NULL DEFAULT 0,
                category TEXT,
                extracted_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                UNIQUE(workspace_id, term)
            )
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS quip_manifest (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                version_hash TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            )
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS quip_generation_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                status TEXT NOT NULL DEFAULT 'idle',
                phase TEXT,
                workspace_id TEXT,
                workspace_name TEXT,
                workspace_index INTEGER DEFAULT 0,
                workspace_total INTEGER DEFAULT 0,
                batch_index INTEGER DEFAULT 0,
                batch_total INTEGER DEFAULT 0,
                terms_complete INTEGER DEFAULT 0,
                terms_total INTEGER DEFAULT 0,
                message TEXT,
                error TEXT,
                started_at INTEGER,
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            )
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS quip_auto_update_state (
                workspace_id TEXT PRIMARY KEY,
                last_run_at INTEGER,
                last_run_schedule TEXT,
                image_count INTEGER DEFAULT 0,
                last_count_check_at INTEGER,
                enabled INTEGER NOT NULL DEFAULT 0,
                schedule TEXT NOT NULL DEFAULT 'disabled',
                term_limit INTEGER NOT NULL DEFAULT 50,
                grok_batch_size INTEGER NOT NULL DEFAULT 3,
                phrases_per_term INTEGER NOT NULL DEFAULT 15
            )
        `);

        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_dynamic_quips_workspace ON dynamic_quips(workspace_id)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_dynamic_quips_term ON dynamic_quips(match_term)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_extracted_terms_workspace ON extracted_terms(workspace_id)`);
    }

    getDefaultWorkspaceQuipSettingsRow(workspaceId = 'default') {
        return {
            workspace_id: workspaceId,
            last_run_at: null,
            last_run_schedule: null,
            image_count: 0,
            last_count_check_at: null,
            enabled: 0,
            schedule: 'disabled',
            term_limit: 50,
            grok_batch_size: 3,
            phrases_per_term: 15
        };
    }

    getAutoUpdateState(workspaceId = 'default') {
        const row = this.db.prepare('SELECT * FROM quip_auto_update_state WHERE workspace_id = ?').get(workspaceId);
        return row || this.getDefaultWorkspaceQuipSettingsRow(workspaceId);
    }

    getWorkspaceQuipSettingsRaw(workspaceId = 'default') {
        const row = this.getAutoUpdateState(workspaceId);
        return {
            enabled: row.enabled === 1,
            schedule: row.schedule || 'disabled',
            termLimit: row.term_limit ?? 50,
            grokBatchSize: row.grok_batch_size ?? 3,
            phrasesPerTerm: row.phrases_per_term ?? 15
        };
    }

    persistWorkspaceQuipSettings(workspaceId, settings) {
        const current = this.getAutoUpdateState(workspaceId);
        this.db.prepare(`
            INSERT INTO quip_auto_update_state (
                workspace_id, last_run_at, last_run_schedule, image_count, last_count_check_at,
                enabled, schedule, term_limit, grok_batch_size, phrases_per_term
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
                enabled = excluded.enabled,
                schedule = excluded.schedule,
                term_limit = excluded.term_limit,
                grok_batch_size = excluded.grok_batch_size,
                phrases_per_term = excluded.phrases_per_term
        `).run(
            workspaceId,
            current.last_run_at,
            current.last_run_schedule,
            current.image_count || 0,
            current.last_count_check_at,
            settings.enabled ? 1 : 0,
            settings.schedule,
            settings.termLimit,
            settings.grokBatchSize,
            settings.phrasesPerTerm
        );

        return this.getWorkspaceQuipSettingsRaw(workspaceId);
    }

    getCheckpointManager() {
        return this.checkpointManager || null;
    }

    getAllAutoUpdateStates() {
        return this.db.prepare('SELECT * FROM quip_auto_update_state').all();
    }

    updateAutoUpdateState(workspaceId, patch) {
        const current = this.getAutoUpdateState(workspaceId);
        const merged = {
            last_run_at: patch.last_run_at !== undefined ? patch.last_run_at : current.last_run_at,
            last_run_schedule: patch.last_run_schedule !== undefined ? patch.last_run_schedule : current.last_run_schedule,
            image_count: patch.image_count !== undefined ? patch.image_count : (current.image_count || 0),
            last_count_check_at: patch.last_count_check_at !== undefined
                ? patch.last_count_check_at
                : current.last_count_check_at
        };

        const settings = this.getWorkspaceQuipSettingsRaw(workspaceId);

        this.db.prepare(`
            INSERT INTO quip_auto_update_state (
                workspace_id, last_run_at, last_run_schedule, image_count, last_count_check_at,
                enabled, schedule, term_limit, grok_batch_size, phrases_per_term
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
                last_run_at = excluded.last_run_at,
                last_run_schedule = excluded.last_run_schedule,
                image_count = excluded.image_count,
                last_count_check_at = excluded.last_count_check_at
        `).run(
            workspaceId,
            merged.last_run_at,
            merged.last_run_schedule,
            merged.image_count,
            merged.last_count_check_at,
            settings.enabled ? 1 : 0,
            settings.schedule,
            settings.termLimit,
            settings.grokBatchSize,
            settings.phrasesPerTerm
        );

        return { workspace_id: workspaceId, ...merged, ...settings };
    }

    replaceWorkspaceQuips(workspaceId, quipEntries) {
        const deleteStmt = this.db.prepare('DELETE FROM dynamic_quips WHERE workspace_id IS ?');
        const insertStmt = this.db.prepare(`
            INSERT INTO dynamic_quips (workspace_id, match_term, phrases, generated_at)
            VALUES (?, ?, ?, strftime('%s', 'now'))
            ON CONFLICT(workspace_id, match_term) DO UPDATE SET
                phrases = excluded.phrases,
                generated_at = excluded.generated_at
        `);

        const run = this.db.transaction((entries) => {
            deleteStmt.run(workspaceId);
            const deduped = dedupeQuipEntries(entries);
            for (const entry of deduped) {
                insertStmt.run(workspaceId, entry.term, JSON.stringify(entry.phrases));
            }
        });
        run(quipEntries);
        this._scheduleLegacyDbCheckpoint?.();
    }

    replaceGlobalQuips(quipEntries) {
        this.replaceWorkspaceQuips(null, quipEntries);
    }

    clearWorkspaceData(workspaceId) {
        const run = this.db.transaction(() => {
            this.db.prepare('DELETE FROM dynamic_quips WHERE workspace_id IS ?').run(workspaceId);
            this.db.prepare('DELETE FROM extracted_terms WHERE workspace_id = ?').run(workspaceId);
        });
        run();
        this._scheduleLegacyDbCheckpoint?.();
        return this.bumpVersionHash();
    }

    replaceExtractedTerms(workspaceId, terms) {
        const deleteStmt = this.db.prepare('DELETE FROM extracted_terms WHERE workspace_id = ?');
        const insertStmt = this.db.prepare(`
            INSERT INTO extracted_terms (workspace_id, term, occurrence_count, avg_weight, category, extracted_at)
            VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
        `);

        const run = this.db.transaction((rows) => {
            deleteStmt.run(workspaceId);
            for (const row of rows) {
                insertStmt.run(
                    workspaceId,
                    row.term,
                    row.occurrenceCount || 0,
                    row.avgWeight || 0,
                    row.category || null
                );
            }
        });
        run(terms);
        this._scheduleLegacyDbCheckpoint?.();
    }

    getAllQuipsForClient() {
        const rows = this.db.prepare(`
            SELECT workspace_id, match_term, phrases
            FROM dynamic_quips
            ORDER BY workspace_id, match_term
        `).all();

        const byWorkspace = {};
        let totalPhrases = 0;

        for (const row of rows) {
            const wsKey = row.workspace_id || '_global';
            if (!byWorkspace[wsKey]) {
                byWorkspace[wsKey] = [];
            }
            let phrases;
            try {
                phrases = JSON.parse(row.phrases);
            } catch {
                continue;
            }
            if (!Array.isArray(phrases) || phrases.length === 0) continue;
            totalPhrases += phrases.length;
            byWorkspace[wsKey].push({
                term: row.match_term,
                phrases
            });
        }

        return {
            byWorkspace,
            termCount: rows.length,
            phraseCount: totalPhrases,
            versionHash: this.getVersionHash()
        };
    }

    getVersionHash() {
        const row = this.db.prepare('SELECT version_hash FROM quip_manifest WHERE id = 1').get();
        return row ? row.version_hash : '';
    }

    bumpVersionHash() {
        const hash = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        this.db.prepare(`
            INSERT INTO quip_manifest (id, version_hash, updated_at)
            VALUES (1, ?, strftime('%s', 'now'))
            ON CONFLICT(id) DO UPDATE SET
                version_hash = excluded.version_hash,
                updated_at = excluded.updated_at
        `).run(hash);
        return hash;
    }

    getStats() {
        const quipCount = this.db.prepare('SELECT COUNT(*) AS c FROM dynamic_quips').get().c;
        const workspaceCount = this.db.prepare('SELECT COUNT(DISTINCT workspace_id) AS c FROM dynamic_quips WHERE workspace_id IS NOT NULL').get().c;
        const termRows = this.db.prepare('SELECT COUNT(*) AS c FROM extracted_terms').get().c;
        return { quipCount, workspaceCount, extractedTermRows: termRows, versionHash: this.getVersionHash() };
    }

    getWorkspaceQuipStats(workspaceId) {
        const termCount = this.db.prepare(`
            SELECT COUNT(*) AS c FROM dynamic_quips WHERE workspace_id IS ?
        `).get(workspaceId).c;

        const phraseRow = this.db.prepare(`
            SELECT phrases FROM dynamic_quips WHERE workspace_id IS ?
        `).all(workspaceId);

        let phraseCount = 0;
        let minPhrases = null;
        let maxPhrases = 0;
        for (const row of phraseRow) {
            try {
                const phrases = JSON.parse(row.phrases);
                if (!Array.isArray(phrases)) continue;
                phraseCount += phrases.length;
                if (minPhrases === null || phrases.length < minPhrases) minPhrases = phrases.length;
                if (phrases.length > maxPhrases) maxPhrases = phrases.length;
            } catch {
                continue;
            }
        }

        const extractedCount = this.db.prepare(`
            SELECT COUNT(*) AS c FROM extracted_terms WHERE workspace_id = ?
        `).get(workspaceId).c;

        const lastGenRow = this.db.prepare(`
            SELECT MAX(generated_at) AS ts FROM dynamic_quips WHERE workspace_id IS ?
        `).get(workspaceId);

        return {
            termCount,
            phraseCount,
            extractedTermCount: extractedCount,
            minPhrasesPerTerm: minPhrases,
            maxPhrasesPerTerm: maxPhrases,
            lastGeneratedAt: lastGenRow?.ts || null
        };
    }

    getWorkspaceQuipEntries(workspaceId) {
        const rows = this.db.prepare(`
            SELECT match_term, phrases FROM dynamic_quips
            WHERE workspace_id IS ?
            ORDER BY match_term
        `).all(workspaceId);

        return rows.map((row) => {
            let phrases = [];
            try {
                phrases = JSON.parse(row.phrases);
            } catch {
                phrases = [];
            }
            return { term: row.match_term, phrases };
        }).filter((e) => e.phrases.length > 0);
    }

    getGenerationState() {
        return this.db.prepare('SELECT * FROM quip_generation_state WHERE id = 1').get() || {
            status: 'idle',
            phase: null,
            message: 'Idle'
        };
    }

    /** Clear orphaned "running" rows after a crash or hung pipeline. */
    reconcileStaleGenerationState(options = {}) {
        const {
            forceIfRunning = false,
            maxRunningIdleSec = 180
        } = options;

        const state = this.getGenerationState();
        if (state.status !== 'running') return state;

        const nowSec = Math.floor(Date.now() / 1000);
        const updatedAt = state.updated_at || state.started_at || 0;
        const idleSec = updatedAt > 0 ? nowSec - updatedAt : maxRunningIdleSec + 1;

        if (!forceIfRunning && idleSec <= maxRunningIdleSec) {
            return state;
        }

        const interruptedMessage = forceIfRunning
            ? 'Generation interrupted — server restarted during quip scan'
            : 'Generation interrupted — no progress detected';

        return this.updateGenerationState({
            status: 'error',
            phase: null,
            message: interruptedMessage,
            error: 'interrupted',
            batch_index: 0,
            batch_total: 0
        });
    }

    updateGenerationState(patch) {
        const current = this.getGenerationState();
        const merged = {
            status: patch.status ?? current.status ?? 'idle',
            phase: patch.phase !== undefined ? patch.phase : current.phase,
            workspace_id: patch.workspace_id !== undefined ? patch.workspace_id : current.workspace_id,
            workspace_name: patch.workspace_name !== undefined ? patch.workspace_name : current.workspace_name,
            workspace_index: patch.workspace_index ?? current.workspace_index ?? 0,
            workspace_total: patch.workspace_total ?? current.workspace_total ?? 0,
            batch_index: patch.batch_index ?? current.batch_index ?? 0,
            batch_total: patch.batch_total ?? current.batch_total ?? 0,
            terms_complete: patch.terms_complete ?? current.terms_complete ?? 0,
            terms_total: patch.terms_total ?? current.terms_total ?? 0,
            message: patch.message !== undefined ? patch.message : current.message,
            error: patch.error !== undefined ? patch.error : current.error,
            started_at: patch.started_at !== undefined ? patch.started_at : current.started_at,
            updated_at: Math.floor(Date.now() / 1000)
        };

        this.db.prepare(`
            INSERT INTO quip_generation_state (
                id, status, phase, workspace_id, workspace_name,
                workspace_index, workspace_total, batch_index, batch_total,
                terms_complete, terms_total, message, error, started_at, updated_at
            ) VALUES (
                1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                phase = excluded.phase,
                workspace_id = excluded.workspace_id,
                workspace_name = excluded.workspace_name,
                workspace_index = excluded.workspace_index,
                workspace_total = excluded.workspace_total,
                batch_index = excluded.batch_index,
                batch_total = excluded.batch_total,
                terms_complete = excluded.terms_complete,
                terms_total = excluded.terms_total,
                message = excluded.message,
                error = excluded.error,
                started_at = excluded.started_at,
                updated_at = excluded.updated_at
        `).run(
            merged.status,
            merged.phase,
            merged.workspace_id,
            merged.workspace_name,
            merged.workspace_index,
            merged.workspace_total,
            merged.batch_index,
            merged.batch_total,
            merged.terms_complete,
            merged.terms_total,
            merged.message,
            merged.error,
            merged.started_at,
            merged.updated_at
        );

        return merged;
    }

    getExtractedTermCount(workspaceId) {
        const row = this.db.prepare('SELECT COUNT(*) AS c FROM extracted_terms WHERE workspace_id = ?').get(workspaceId);
        return row ? row.c : 0;
    }

    getAllWorkspaceIdsWithData() {
        const quipIds = this.db.prepare('SELECT DISTINCT workspace_id FROM dynamic_quips WHERE workspace_id IS NOT NULL').all();
        const termIds = this.db.prepare('SELECT DISTINCT workspace_id FROM extracted_terms').all();
        const ids = new Set();
        for (const row of quipIds) ids.add(row.workspace_id);
        for (const row of termIds) ids.add(row.workspace_id);
        return [...ids];
    }

    getExtractedTermRows(workspaceFilter = null) {
        let query = 'SELECT workspace_id, term, occurrence_count, avg_weight, category FROM extracted_terms';
        const params = [];
        if (workspaceFilter) {
            query += ' WHERE workspace_id = ?';
            params.push(workspaceFilter);
        }
        query += ' ORDER BY workspace_id, occurrence_count DESC';
        return this.db.prepare(query).all(...params);
    }

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}

module.exports = GenerationQuipsDatabase;
module.exports.SHARED_QUIPS_WORKSPACE_ID = SHARED_QUIPS_WORKSPACE_ID;
module.exports.dedupeQuipEntries = dedupeQuipEntries;
