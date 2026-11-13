/**
 * Recordings attached to notes (#785): the phone's Notes voice bar and Melaton Journal's voice clips.
 * One folder per note under .cache/notes-audio/<noteId>/, one file per recording (<audioId>.<ext>).
 * The note's metadata.audio lists them ({ id, name, ms, mime, bytes, at }); the files follow the
 * note through rename, move and the Recycle Bin (the note row stays) and go when the note is purged
 * (notesDatabase.deleteNote -> removeAll).
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT = process.env.NOTES_AUDIO_DIR || path.join(__dirname, '..', '.cache', 'notes-audio');
const MAX_BYTES = 40 * 1024 * 1024;
const MIME_EXT = {
    'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav'
};
const EXT_MIME = { webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav' };

const ID = /^[A-Za-z0-9_-]{1,80}$/;

function checkId(id, what) {
    if (!ID.test(String(id || ''))) throw new Error(`Invalid ${what}`);
    return String(id);
}

function dirOf(noteId) {
    return path.join(ROOT, checkId(noteId, 'note id'));
}

/** The plain mime type (no codecs) and its extension; unknown types are refused. */
function typeOf(mime) {
    const base = String(mime || '').split(';')[0].trim().toLowerCase();
    const ext = MIME_EXT[base];
    if (!ext) throw new Error(`Unsupported audio type: ${base || '(none)'}`);
    return { mime: EXT_MIME[ext], ext };
}

async function findFile(noteId, audioId) {
    checkId(audioId, 'recording id');
    const dir = dirOf(noteId);
    let names = [];
    try { names = await fsp.readdir(dir); } catch (_) { return null; }
    const hit = names.find((n) => n.slice(0, n.lastIndexOf('.')) === audioId);
    return hit ? path.join(dir, hit) : null;
}

async function put(noteId, audioId, base64, mime) {
    const { mime: type, ext } = typeOf(mime);
    const buf = Buffer.from(String(base64 || ''), 'base64');
    if (!buf.length) throw new Error('The recording is empty.');
    if (buf.length > MAX_BYTES) throw new Error('The recording is too large.');
    const dir = dirOf(noteId);
    await fsp.mkdir(dir, { recursive: true });
    const old = await findFile(noteId, audioId);
    const file = path.join(dir, `${checkId(audioId, 'recording id')}.${ext}`);
    const tmp = `${file}.part`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, file);
    if (old && old !== file) await fsp.unlink(old).catch(() => {});
    return { mime: type, bytes: buf.length };
}

async function read(noteId, audioId) {
    const file = await findFile(noteId, audioId);
    if (!file) throw new Error('The recording was not found.');
    const ext = file.slice(file.lastIndexOf('.') + 1);
    return { buffer: await fsp.readFile(file), mime: EXT_MIME[ext] || 'application/octet-stream' };
}

async function remove(noteId, audioId) {
    const file = await findFile(noteId, audioId);
    if (file) await fsp.unlink(file).catch(() => {});
    return !!file;
}

async function removeAll(noteId) {
    await fsp.rm(dirOf(noteId), { recursive: true, force: true });
}

/** Create Copy: the copy gets its own files (same recording ids, so the copied metadata matches). */
async function copyAll(fromNoteId, toNoteId) {
    const from = dirOf(fromNoteId);
    const to = dirOf(toNoteId);
    let names = [];
    try { names = await fsp.readdir(from); } catch (_) { return 0; }
    names = names.filter((n) => !n.endsWith('.part'));
    if (!names.length) return 0;
    await fsp.mkdir(to, { recursive: true });
    for (const n of names) await fsp.copyFile(path.join(from, n), path.join(to, n));
    return names.length;
}

module.exports = { ROOT, MAX_BYTES, put, read, remove, removeAll, copyAll, typeOf };
