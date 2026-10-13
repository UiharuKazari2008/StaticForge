/**
 * Uploaded wallpaper history (Control Panel's Desktop Background, Yukimi 2026-10-13: "if possible
 * store previous uploads with option to delete from history"). Every upload (upload_wallpaper,
 * referencesWebSocketHandlers.js) is kept as a copy beside the per-workspace file, so it can be
 * chosen again after the next upload replaces that file:
 *
 *   <cache>/wallpapers/history/<id>.png     served as /cache/wallpapers/history/<id>.png
 *   <cache>/wallpapers/history/index.json   [{ id, name, addedAt }], newest first
 *
 * The id is the PNG's content hash, so uploading the same picture again moves it to the top.
 * At most MAX_ITEMS are kept; the oldest go first.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_ITEMS = 40;
const ID_RE = /^[a-f0-9]{16}$/;

function historyDir(cacheDir) {
    return path.join(cacheDir, 'wallpapers', 'history');
}

function readIndex(cacheDir) {
    try {
        const list = JSON.parse(fs.readFileSync(path.join(historyDir(cacheDir), 'index.json'), 'utf8'));
        return Array.isArray(list) ? list.filter((e) => e && ID_RE.test(e.id)) : [];
    } catch (_err) {
        return [];
    }
}

function writeIndex(cacheDir, list) {
    const dir = historyDir(cacheDir);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `index.json.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, path.join(dir, 'index.json'));
}

function toItem(entry) {
    return { id: entry.id, name: entry.name || 'Wallpaper', addedAt: entry.addedAt || 0, url: `/cache/wallpapers/history/${entry.id}.png` };
}

/** Keep a copy of a saved wallpaper (the PNG at sourcePath); returns the history item. */
function remember(cacheDir, sourcePath, name) {
    const buf = fs.readFileSync(sourcePath);
    const id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
    const dir = historyDir(cacheDir);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${id}.png`);
    if (!fs.existsSync(target)) fs.writeFileSync(target, buf);
    const clean = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) || 'Wallpaper';
    let list = readIndex(cacheDir).filter((e) => e.id !== id);
    list.unshift({ id, name: clean, addedAt: Date.now() });
    const dropped = list.slice(MAX_ITEMS);
    list = list.slice(0, MAX_ITEMS);
    dropped.forEach((e) => {
        try { fs.unlinkSync(path.join(dir, `${e.id}.png`)); } catch (_err) { /* already gone */ }
    });
    writeIndex(cacheDir, list);
    return toItem(list[0]);
}

function list(cacheDir) {
    return readIndex(cacheDir).map(toItem);
}

/** Remove one upload from the history (and its file); false when it was not there. */
function remove(cacheDir, id) {
    if (!ID_RE.test(String(id || ''))) return false;
    const before = readIndex(cacheDir);
    const after = before.filter((e) => e.id !== id);
    if (after.length === before.length) return false;
    try { fs.unlinkSync(path.join(historyDir(cacheDir), `${id}.png`)); } catch (_err) { /* already gone */ }
    writeIndex(cacheDir, after);
    return true;
}

module.exports = { MAX_ITEMS, remember, list, remove, historyDir };
