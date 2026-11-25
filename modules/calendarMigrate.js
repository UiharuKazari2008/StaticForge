'use strict';

/**
 * One-time move of the other workspaces' Calendars into the host's one set (#1157): the Default
 * workspace's Calendars folder (see calendarMcp.js). Before the change every workspace had its own
 * Calendars folder; Calendar, Tasks, Today and the reminders now read only Default's.
 *
 * For each non-trashed .ics in a non-Default workspace's Calendars folder (planMigration decides):
 *   - a phone mirror (X-MELATON-SOURCE:phone:...): to the trash; the phone sync rewrites Default's copy.
 *   - a subscription (another X-MELATON-SOURCE): to the trash when Default has a calendar of the same
 *     source, else moved to Default.
 *   - anything else (a user calendar, the agents' X-MELATON-OWNER): never trashed except as an identical
 *     twin of Default's file of the same name; else moved. A name clash with different text moves it as
 *     "<name> (<workspace name>).ics".
 * Trashing is the VFS's own trash (vfsManager.moveItemsToTrash), restorable. Folders are never deleted.
 *
 * Run once: start() runs after the VFS is up, with one short timer (no polling), and records
 * <data dir>/calendar-migrated.json; later boots read that file and stop. One log line with the counts.
 */

const fs = require('fs');
const path = require('path');

const MARKER = 'calendar-migrated.json';
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_ID = 'default';

const isDefault = (id) => String(id || '').toLowerCase() === DEFAULT_ID;

/** The header lines of an .ics (before its first component), unfolded values not needed for X- lines. */
function headerOf(text) {
    const lines = String(text || '').split(/\r?\n/);
    const out = [];
    for (const l of lines) {
        if (/^BEGIN:V(EVENT|TODO|JOURNAL|FREEBUSY)\b/i.test(l)) break;
        out.push(l);
    }
    return out;
}
function headerValue(text, name) {
    const re = new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, 'i');
    for (const l of headerOf(text)) {
        const m = re.exec(l);
        if (m) return m[1].trim();
    }
    return '';
}
const sourceOf = (text) => headerValue(text, 'X-MELATON-SOURCE');
const stem = (name) => String(name || '').replace(/\.ics$/i, '');
const safeWs = (n) => String(n || '').replace(/[\\/:*?"<>|\r\n]/g, ' ').replace(/\s+/g, ' ').trim() || 'workspace';

/**
 * Pure: the actions for a list of calendar files.
 * files: [{ id, name, workspaceId, workspaceName?, text, trashed? }] - Default's own files are included (they
 * say what is there already); the other workspaces' files are the ones to place.
 * Answers [{ action: 'trash'|'move', id, name, workspaceId, reason, toName? }] (toName: the file's name in Default).
 */
function planMigration(files) {
    const list = (Array.isArray(files) ? files : []).filter((f) => f && f.id && /\.ics$/i.test(f.name || '') && !f.trashed);
    const have = new Map(); // lower-case name -> text, what Default holds (and what has been moved there so far)
    const sources = new Set(); // lower-case sources Default holds
    for (const f of list) {
        if (!isDefault(f.workspaceId)) continue;
        have.set(String(f.name).toLowerCase(), f.text == null ? null : String(f.text));
        const s = f.text ? sourceOf(f.text) : '';
        if (s) sources.add(s.toLowerCase());
    }
    const others = list.filter((f) => !isDefault(f.workspaceId))
        .sort((a, b) => String(a.workspaceId).localeCompare(String(b.workspaceId)) || String(a.name).localeCompare(String(b.name)));
    const actions = [];
    const place = (f, reason) => {
        let toName = f.name;
        if (have.has(toName.toLowerCase())) {
            const base = `${stem(f.name)} (${safeWs(f.workspaceName || f.workspaceId)})`;
            toName = `${base}.ics`;
            for (let n = 2; have.has(toName.toLowerCase()); n += 1) toName = `${base} ${n}.ics`;
        }
        have.set(toName.toLowerCase(), f.text == null ? null : String(f.text));
        const s = f.text ? sourceOf(f.text) : '';
        if (s) sources.add(s.toLowerCase());
        actions.push({ action: 'move', id: f.id, name: f.name, workspaceId: f.workspaceId, reason, ...(toName !== f.name ? { toName } : {}) });
    };
    for (const f of others) {
        const text = f.text == null ? null : String(f.text);
        const source = text ? sourceOf(text) : '';
        const twin = have.has(f.name.toLowerCase()) && text != null && have.get(f.name.toLowerCase()) === text;
        if (/^phone:/i.test(source)) {
            actions.push({ action: 'trash', id: f.id, name: f.name, workspaceId: f.workspaceId, reason: 'phone-mirror' });
        } else if (source) {
            if (sources.has(source.toLowerCase())) actions.push({ action: 'trash', id: f.id, name: f.name, workspaceId: f.workspaceId, reason: 'subscription-in-default' });
            else place(f, 'subscription');
        } else if (twin) {
            actions.push({ action: 'trash', id: f.id, name: f.name, workspaceId: f.workspaceId, reason: 'identical-duplicate' });
        } else {
            place(f, 'calendar'); // a user calendar or the agents' own: never trashed
        }
    }
    return actions;
}

// ---------------------------------------------------------------- the one-time run

const markerPath = (gr) => path.join(gr.getPath('databases'), MARKER);

async function readMarker(gr) {
    try { return JSON.parse(await fs.promises.readFile(markerPath(gr), 'utf8')); } catch (_e) { return null; }
}

async function readText(gr, file) {
    if (!file.content_hash || Number(file.size) > MAX_BYTES) return null;
    try { return await fs.promises.readFile(path.join(gr.getPath('userFiles'), file.content_hash), 'utf8'); } catch (_e) { return null; }
}

const calendarsFolders = async (vdb, workspaceId) => ((await vdb.getFoldersByParent('workspace', workspaceId, null)) || [])
    .filter((f) => String(f.name || '').toLowerCase() === 'calendars');

/** Does the move now; answers { trashed, moved, skipped } (and writes the marker unless `dry`). */
async function run(gr, { vdb = require('./vfsDatabase'), vfs, lock } = {}) {
    if (await readMarker(gr)) return { skipped: 'done' };
    const wsm = gr.getWorkspaceManager ? gr.getWorkspaceManager() : null;
    const workspaces = (wsm && wsm.getWorkspaces && wsm.getWorkspaces()) || {};
    const defId = Object.keys(workspaces).find(isDefault);
    if (!defId) return { skipped: 'no-default-workspace' }; // try again next boot
    vfs = vfs || gr.getVfsManager();
    const cm = require('./calendarMcp');
    const withLock = lock || ((fn) => cm.withLock(cm.CAL_LOCK, fn));

    return withLock(async () => {
        const files = [];
        let defFolder = null;
        const collect = async (id, ws) => {
            for (const folder of await calendarsFolders(vdb, id)) {
                if (isDefault(id) && !defFolder) defFolder = folder;
                for (const f of (await vdb.getUserFilesByLocation('workspace', id, folder.id)) || []) {
                    if (!/\.ics$/i.test(f.original_name || '') || f.trashed_at) continue;
                    files.push({ id: f.id, name: f.original_name, workspaceId: id, workspaceName: (ws && ws.name) || id, text: await readText(gr, f) });
                }
            }
        };
        for (const [id, ws] of Object.entries(workspaces)) await collect(id, ws);
        const actions = planMigration(files);
        const counts = { trashed: 0, moved: 0, failed: 0 };
        for (const a of actions) {
            try {
                if (a.action === 'trash') {
                    await vfs.moveItemsToTrash([{ targetKind: 'user-file', targetId: a.id, name: a.name, workspaceId: a.workspaceId }], `/Workspaces/${a.workspaceId}/Calendars`);
                    counts.trashed += 1;
                } else {
                    if (!defFolder) defFolder = await vdb.createFolder({ scope: 'workspace', workspaceId: defId, parentId: null, name: 'Calendars' });
                    await vdb.updateUserFile(a.id, { folder_id: defFolder.id, scope: 'workspace', workspace_id: defId, ...(a.toName ? { original_name: a.toName } : {}) });
                    counts.moved += 1;
                }
            } catch (e) {
                counts.failed += 1;
                console.warn(`[calendar-migrate] ${a.action} ${a.workspaceId}/${a.name} failed: ${e.message}`);
            }
        }
        if (typeof vfs.invalidatePathStatsCache === 'function') vfs.invalidatePathStatsCache();
        console.log(`[calendar-migrate] other workspaces' calendars: ${files.length - files.filter((f) => isDefault(f.workspaceId)).length} found, ${counts.moved} moved to Default, ${counts.trashed} trashed${counts.failed ? `, ${counts.failed} failed (will retry next boot)` : ''}`);
        if (!counts.failed) {
            await fs.promises.writeFile(markerPath(gr), JSON.stringify({ at: new Date().toISOString(), moved: counts.moved, trashed: counts.trashed }), 'utf8');
        }
        return counts;
    });
}

let started = false;

/** Once per boot (and once ever, by the marker): a single delayed run after the VFS is up. */
function start(gr, { delayMs = 20000 } = {}) {
    if (started || process.env.CALENDAR_MIGRATE_OFF) return;
    started = true;
    const t = setTimeout(() => { run(gr).catch((e) => console.warn(`[calendar-migrate] failed: ${e.message}`)); }, delayMs);
    if (t.unref) t.unref();
}

module.exports = { planMigration, run, start, sourceOf, MARKER };
