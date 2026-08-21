/**
 * SQLite character prompt database (copyrights / characters / enhancer overloads).
 * Built from characters.json via scripts/import-characters-json.js → .cache/characters.db
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const logger = require('./logger');
const { attachLegacyDatabaseCheckpoint } = require('./legacyDatabaseCheckpoint');

class CharactersDatabase {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('CharactersDatabase requires globalResources and should only be instantiated by bootstrap');
        }
        this.globalResources = globalResources;
        this.db = null;
        this.dbPath = path.join(globalResources.getPath('databases'), 'characters.db');
        this.init();
    }

    init() {
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        attachLegacyDatabaseCheckpoint(this, this.dbPath, () => this.db, this.globalResources);
        this.createTables();
        logger.bootSubStep('Characters database initialized');
    }

    createTables() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS copyrights (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE
            );

            CREATE TABLE IF NOT EXISTS characters (
                id INTEGER PRIMARY KEY,
                copyright_id INTEGER NOT NULL REFERENCES copyrights(id) ON DELETE CASCADE,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                prompt TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS enhancers (
                id INTEGER PRIMARY KEY,
                character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
                group_index INTEGER NOT NULL,
                tags_json TEXT NOT NULL,
                UNIQUE(character_id, group_index)
            );

            CREATE INDEX IF NOT EXISTS idx_characters_copyright ON characters(copyright_id);
        `);
    }

    getDb() {
        return this.db;
    }

    countCharacters() {
        const row = this.db.prepare('SELECT COUNT(*) AS c FROM characters').get();
        return row ? row.c : 0;
    }

    ensureCopyright(name, existingStmt = null) {
        const trimmed = typeof name === 'string' ? name.trim() : '';
        const copyrightName = trimmed || 'Original';
        const select = existingStmt || this.db.prepare('SELECT id FROM copyrights WHERE name = ? COLLATE NOCASE');
        let row = select.get(copyrightName);
        if (row) return row.id;
        const info = this.db.prepare('INSERT INTO copyrights (name) VALUES (?)').run(copyrightName);
        return Number(info.lastInsertRowid);
    }

    parseEnhancers(raw) {
        if (!Array.isArray(raw)) return [];
        return raw
            .map((group) => {
                if (!Array.isArray(group)) return null;
                const tags = group
                    .filter((t) => typeof t === 'string' && t.trim())
                    .map((t) => t.trim());
                return tags.length ? tags : null;
            })
            .filter(Boolean);
    }

    setEnhancers(characterId, enhancers) {
        this.db.prepare('DELETE FROM enhancers WHERE character_id = ?').run(characterId);
        const insert = this.db.prepare(
            'INSERT INTO enhancers (character_id, group_index, tags_json) VALUES (?, ?, ?)'
        );
        const groups = this.parseEnhancers(enhancers);
        for (let i = 0; i < groups.length; i++) {
            insert.run(characterId, i, JSON.stringify(groups[i]));
        }
        return groups.length;
    }

    getEnhancersForCharacter(characterId) {
        const rows = this.db.prepare(
            'SELECT tags_json FROM enhancers WHERE character_id = ? ORDER BY group_index ASC'
        ).all(characterId);
        return rows.map((row) => {
            try {
                const parsed = JSON.parse(row.tags_json);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }).filter((g) => g.length > 0);
    }

    rowToCharacter(row) {
        if (!row) return null;
        return {
            name: row.name,
            copyright: row.copyright_name || 'Original',
            prompt: row.prompt || '',
            enhancers: this.getEnhancersForCharacter(row.id)
        };
    }

    listAllAsArray() {
        const rows = this.db.prepare(`
            SELECT c.id, c.name, c.prompt, cp.name AS copyright_name
            FROM characters c
            JOIN copyrights cp ON cp.id = c.copyright_id
            ORDER BY cp.name COLLATE NOCASE ASC, c.name COLLATE NOCASE ASC
        `).all();
        return rows.map((row) => this.rowToCharacter(row));
    }

    listCopyrights() {
        return this.db.prepare(`
            SELECT cp.id, cp.name, COUNT(c.id) AS character_count
            FROM copyrights cp
            LEFT JOIN characters c ON c.copyright_id = cp.id
            GROUP BY cp.id
            ORDER BY cp.name COLLATE NOCASE ASC
        `).all().map((row) => ({
            id: row.id,
            name: row.name,
            characterCount: row.character_count
        }));
    }

    getCharacterByName(name) {
        if (!name || typeof name !== 'string') return null;
        const row = this.db.prepare(`
            SELECT c.id, c.name, c.prompt, cp.name AS copyright_name
            FROM characters c
            JOIN copyrights cp ON cp.id = c.copyright_id
            WHERE c.name = ? COLLATE NOCASE
        `).get(name.trim());
        return this.rowToCharacter(row);
    }

    /**
     * @param {object} character - { name, copyright, prompt, enhancers }
     * @param {{ oldName?: string }} options
     */
    upsertCharacter(character, options = {}) {
        if (!character || typeof character !== 'object') {
            throw new Error('character object is required');
        }
        const name = typeof character.name === 'string' ? character.name.trim() : '';
        if (!name) throw new Error('Character name is required');
        const prompt = typeof character.prompt === 'string' ? character.prompt : '';
        const copyrightName = typeof character.copyright === 'string' ? character.copyright.trim() : 'Original';
        const oldName = typeof options.oldName === 'string' && options.oldName.trim()
            ? options.oldName.trim()
            : null;

        const run = this.db.transaction(() => {
            const copyrightId = this.ensureCopyright(copyrightName || 'Original');
            let existing = null;
            if (oldName) {
                existing = this.db.prepare('SELECT id, name FROM characters WHERE name = ? COLLATE NOCASE').get(oldName);
                if (!existing) {
                    throw new Error(`Character "${oldName}" not found`);
                }
                if (name.toLowerCase() !== oldName.toLowerCase()) {
                    const clash = this.db.prepare('SELECT id FROM characters WHERE name = ? COLLATE NOCASE').get(name);
                    if (clash && clash.id !== existing.id) {
                        throw new Error(`Character "${name}" already exists`);
                    }
                }
                this.db.prepare(
                    'UPDATE characters SET copyright_id = ?, name = ?, prompt = ? WHERE id = ?'
                ).run(copyrightId, name, prompt, existing.id);
                this.setEnhancers(existing.id, character.enhancers);
                this.pruneEmptyCopyrights();
                return this.getCharacterByName(name);
            }

            existing = this.db.prepare('SELECT id FROM characters WHERE name = ? COLLATE NOCASE').get(name);
            if (existing) {
                this.db.prepare(
                    'UPDATE characters SET copyright_id = ?, name = ?, prompt = ? WHERE id = ?'
                ).run(copyrightId, name, prompt, existing.id);
                this.setEnhancers(existing.id, character.enhancers);
                this.pruneEmptyCopyrights();
                return this.getCharacterByName(name);
            }

            const info = this.db.prepare(
                'INSERT INTO characters (copyright_id, name, prompt) VALUES (?, ?, ?)'
            ).run(copyrightId, name, prompt);
            this.setEnhancers(Number(info.lastInsertRowid), character.enhancers);
            return this.getCharacterByName(name);
        });

        const result = run();
        if (typeof this._scheduleLegacyDbCheckpoint === 'function') {
            this._scheduleLegacyDbCheckpoint();
        }
        return result;
    }

    deleteCharacter(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Character name is required');
        }
        const run = this.db.transaction(() => {
            const row = this.db.prepare('SELECT id FROM characters WHERE name = ? COLLATE NOCASE').get(name.trim());
            if (!row) return false;
            this.db.prepare('DELETE FROM characters WHERE id = ?').run(row.id);
            this.pruneEmptyCopyrights();
            return true;
        });
        const deleted = run();
        if (deleted && typeof this._scheduleLegacyDbCheckpoint === 'function') {
            this._scheduleLegacyDbCheckpoint();
        }
        return deleted;
    }

    renameCopyright(oldCopyright, newCopyright) {
        const oldName = typeof oldCopyright === 'string' ? oldCopyright.trim() : '';
        const newName = typeof newCopyright === 'string' ? newCopyright.trim() : '';
        if (!oldName) throw new Error('oldCopyright is required');
        if (!newName) throw new Error('newCopyright is required');

        const run = this.db.transaction(() => {
            const oldRow = this.db.prepare('SELECT id FROM copyrights WHERE name = ? COLLATE NOCASE').get(oldName);
            if (!oldRow) throw new Error(`Copyright "${oldName}" not found`);
            if (oldName.toLowerCase() === newName.toLowerCase()) {
                this.db.prepare('UPDATE copyrights SET name = ? WHERE id = ?').run(newName, oldRow.id);
                return newName;
            }
            const clash = this.db.prepare('SELECT id FROM copyrights WHERE name = ? COLLATE NOCASE').get(newName);
            if (clash) {
                // Move characters onto existing copyright, drop old
                this.db.prepare('UPDATE characters SET copyright_id = ? WHERE copyright_id = ?').run(clash.id, oldRow.id);
                this.db.prepare('DELETE FROM copyrights WHERE id = ?').run(oldRow.id);
                return newName;
            }
            this.db.prepare('UPDATE copyrights SET name = ? WHERE id = ?').run(newName, oldRow.id);
            return newName;
        });

        const result = run();
        if (typeof this._scheduleLegacyDbCheckpoint === 'function') {
            this._scheduleLegacyDbCheckpoint();
        }
        return result;
    }

    deleteCopyright(copyrightName) {
        const name = typeof copyrightName === 'string' ? copyrightName.trim() : '';
        if (!name) throw new Error('copyright name is required');
        const run = this.db.transaction(() => {
            const row = this.db.prepare('SELECT id FROM copyrights WHERE name = ? COLLATE NOCASE').get(name);
            if (!row) return { deleted: false, charactersRemoved: 0 };
            const countRow = this.db.prepare(
                'SELECT COUNT(*) AS c FROM characters WHERE copyright_id = ?'
            ).get(row.id);
            this.db.prepare('DELETE FROM copyrights WHERE id = ?').run(row.id);
            return { deleted: true, charactersRemoved: countRow ? countRow.c : 0 };
        });
        const result = run();
        if (result.deleted && typeof this._scheduleLegacyDbCheckpoint === 'function') {
            this._scheduleLegacyDbCheckpoint();
        }
        return result;
    }

    pruneEmptyCopyrights() {
        this.db.prepare(`
            DELETE FROM copyrights
            WHERE id NOT IN (SELECT DISTINCT copyright_id FROM characters)
        `).run();
    }

    clearAll() {
        this.db.exec(`
            DELETE FROM enhancers;
            DELETE FROM characters;
            DELETE FROM copyrights;
        `);
    }

    /**
     * @param {{ data?: object[] } | object[]} jsonData
     * @param {{ replace?: boolean }} options - replace defaults true; false = merge/upsert by name
     */
    importFromJsonData(jsonData, options = {}) {
        const replace = options.replace !== false;
        const list = Array.isArray(jsonData)
            ? jsonData
            : (jsonData && Array.isArray(jsonData.data) ? jsonData.data : null);
        if (!list) {
            throw new Error('Invalid JSON: expected { data: [...] } or an array');
        }

        const selectCopyright = this.db.prepare('SELECT id FROM copyrights WHERE name = ? COLLATE NOCASE');
        const insertCopyright = this.db.prepare('INSERT INTO copyrights (name) VALUES (?)');
        const selectChar = this.db.prepare('SELECT id FROM characters WHERE name = ? COLLATE NOCASE');
        const insertChar = this.db.prepare(
            'INSERT INTO characters (copyright_id, name, prompt) VALUES (?, ?, ?)'
        );
        const updateChar = this.db.prepare(
            'UPDATE characters SET copyright_id = ?, name = ?, prompt = ? WHERE id = ?'
        );

        const ensureCopyrightId = (rawName) => {
            const copyrightName = (typeof rawName === 'string' && rawName.trim()) ? rawName.trim() : 'Original';
            let row = selectCopyright.get(copyrightName);
            if (row) return row.id;
            return Number(insertCopyright.run(copyrightName).lastInsertRowid);
        };

        const run = this.db.transaction(() => {
            if (replace) {
                this.clearAll();
            }
            let characters = 0;
            let enhancerGroups = 0;
            for (const entry of list) {
                if (!entry || typeof entry !== 'object') continue;
                const name = typeof entry.name === 'string' ? entry.name.trim() : '';
                if (!name) continue;
                const prompt = typeof entry.prompt === 'string' ? entry.prompt : '';
                const copyrightId = ensureCopyrightId(entry.copyright);
                const existing = selectChar.get(name);
                let characterId;
                if (existing) {
                    updateChar.run(copyrightId, name, prompt, existing.id);
                    characterId = existing.id;
                } else {
                    characterId = Number(insertChar.run(copyrightId, name, prompt).lastInsertRowid);
                }
                enhancerGroups += this.setEnhancers(characterId, entry.enhancers || []);
                characters += 1;
            }
            if (!replace) {
                this.pruneEmptyCopyrights();
            }
            return {
                characters,
                enhancerGroups,
                copyrights: this.listCopyrights().length
            };
        });

        const stats = run();
        if (typeof this._scheduleLegacyDbCheckpoint === 'function') {
            this._scheduleLegacyDbCheckpoint();
        }
        return stats;
    }

    close() {
        if (this.db) {
            try {
                this.db.close();
            } catch {
                // ignore
            }
            this.db = null;
        }
    }
}

module.exports = CharactersDatabase;
