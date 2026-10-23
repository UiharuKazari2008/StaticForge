/**
 * 7-Zip in the VFS (Yozora #626): Explorer opens an archive as a folder, extracts all of it or a
 * selection into a VFS folder, streams one entry (an image preview, a download), packs a selection
 * for download, tests it, takes checksums, and creates archives from VFS files and folders.
 * Everything runs the host's 7-Zip (`7z`, 7-Zip 25 on the Dreamscape box); the client side is
 * public/scripts/comp/explorerArchive.js with 7-Zip's own dialogs and progress window.
 *
 * Paths: an archive opened as a folder is `<folder path>/~archive.<fileId>` and its folders follow
 * as URI-encoded name segments (`.../~archive.<id>/docs/2026%2F10`), so Explorer's Up, Back and the
 * address bar keep working. vfsManager.listDirectory / getPathStats / getPathDisplayInfo /
 * resolvePathInput hand these paths here; parsePath types them 'archive' (read-only).
 *
 * Work files live in <.cache>/7zip (same volume as userFiles, so extracted files are hard-linked
 * into the store instead of copied): links/ names each archive blob with its extension for 7-Zip,
 * tar/ holds the inner .tar of a .tar.gz-style archive, work/<op>/ is one operation's scratch.
 */
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const vfsDatabase = require('./vfsDatabase');

const SEGMENT = '~archive.';

function resolveSevenZip() {
    const candidates = [process.env.SEVEN_ZIP_BIN, '/usr/bin/7z', '/usr/bin/7zz', '/usr/local/bin/7z', '/usr/bin/7za'];
    for (const c of candidates) {
        if (c && fs.existsSync(c)) return c;
    }
    return '7z';
}
const SEVEN_ZIP = resolveSevenZip();

// extension -> format key; the key names the icon (public/static_images/vista-7zip/archive-<key>-*.png,
// 7z.dll's icons on the Vista VM, zip keeps Vista's compressed folder from zipfldr.dll)
const FORMAT_BY_EXT = {
    '7z': '7z', zip: 'zip', rar: 'rar', tar: 'tar', gz: 'gz', tgz: 'gz', gzip: 'gz', bz2: 'bz2', bzip2: 'bz2',
    tbz: 'bz2', tbz2: 'bz2', xz: 'xz', txz: 'xz', lzma: 'lzma', tlz: 'lzma', zst: 'zst', tzst: 'zst', z: 'z', taz: 'z',
    cab: 'cab', iso: 'iso', wim: 'wim', swm: 'wim', esd: 'wim', arj: 'arj', lzh: 'lzh', lha: 'lzh', cpio: 'cpio',
    rpm: 'rpm', deb: 'deb', dmg: 'dmg', xar: 'xar', pkg: 'xar', vhd: 'vhd', vhdx: 'vhd', squashfs: 'squashfs',
    '001': 'split'
};
// a compressor around a tar: the tar inside is unpacked once (tar/) and browsed like a .tar
const TAR_WRAPPER_SUFFIXES = ['.tar.gz', '.tgz', '.tar.bz2', '.tbz', '.tbz2', '.tar.xz', '.txz', '.tar.zst', '.tzst', '.tar.lzma', '.tlz', '.tar.z', '.taz'];

// formats Add to Archive writes, as 7-Zip names them -> 7z -t switch
const CREATE_TYPES = { '7z': '7z', zip: 'zip', tar: 'tar', wim: 'wim', gzip: 'gzip', bzip2: 'bzip2', xz: 'xz' };
const CREATE_EXT = { '7z': '7z', zip: 'zip', tar: 'tar', wim: 'wim', gzip: 'gz', bzip2: 'bz2', xz: 'xz' };
const SINGLE_FILE_TYPES = new Set(['gzip', 'bzip2', 'xz']);
const METHODS = {
    '7z': ['LZMA2', 'LZMA', 'PPMd', 'BZip2'],
    zip: ['Deflate', 'Deflate64', 'BZip2', 'LZMA', 'PPMd'],
    xz: ['LZMA2']
};
// Update mode (7-Zip's -u state actions: p q r x y z w)
const UPDATE_SWITCHES = {
    add: 'p1q1r2x2y2z2w2',
    update: 'p1q1r2x1y2z1w2',
    fresh: 'p1q1r0x1y2z1w2',
    sync: 'p1q0r2x1y2z1w2'
};
const HASH_METHODS = { 'CRC-32': 'CRC32', 'CRC-64': 'CRC64', 'XXH64': 'XXH64', 'SHA-1': 'SHA1', 'SHA-256': 'SHA256', 'BLAKE2sp': 'BLAKE2sp', '*': '*' };

const MIME_BY_EXT = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', log: 'text/plain', ini: 'text/plain', xml: 'text/xml',
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json',
    pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
    zip: 'application/zip', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar', tar: 'application/x-tar',
    gz: 'application/gzip', tgz: 'application/gzip', bz2: 'application/x-bzip2', xz: 'application/x-xz',
    iso: 'application/x-iso9660-image', wim: 'application/x-ms-wim'
};

const INFO_CACHE_MAX = 32;
const PASSWORD_TTL_MS = 60 * 60 * 1000;
const TAR_CACHE_MAX_BYTES = 8 * 1024 * 1024 * 1024;
const DOWNLOAD_TTL_MS = 15 * 60 * 1000;
// entries streamed as image previews: only from archives 7-Zip can seek in cheaply
const PREVIEW_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const PREVIEW_MAX_SOLID_ARCHIVE_BYTES = 64 * 1024 * 1024;
const STREAM_CONCURRENCY = 4;
const EMIT_EVERY_MS = 200;

function extOf(name) {
    const m = /\.([^./\\]+)$/.exec(String(name || '').toLowerCase());
    return m ? m[1] : '';
}

function mimeForName(name) {
    return MIME_BY_EXT[extOf(name)] || 'application/octet-stream';
}

function isTarWrapped(name) {
    const lower = String(name || '').toLowerCase();
    return TAR_WRAPPER_SUFFIXES.some((s) => lower.endsWith(s));
}

/** "name_1.ext": 7-Zip's Auto Rename. */
function autoRename(name, taken) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 1; i < 100000; i++) {
        const next = `${stem}_${i}${ext}`;
        if (!taken(next)) return next;
    }
    return `${stem}_${Date.now()}${ext}`;
}

function safeName(name) {
    const cleaned = String(name || '').replace(/[\u0000-\u001f]/g, '').replace(/[\\/]/g, '_').trim();
    if (!cleaned || cleaned === '.' || cleaned === '..') return '_';
    return cleaned.slice(0, 255);
}

function cleanEntryPath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function parseModified(value) {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(value);
    if (!m) return null;
    return Math.floor(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() / 1000);
}

/** 7z -slt output -> { props, entries } */
function parseTechnicalListing(stdout) {
    const lines = String(stdout || '').split(/\r?\n/);
    const props = {};
    const entries = [];
    let i = lines.findIndex((l) => l === '--');
    if (i >= 0) {
        for (i += 1; i < lines.length && lines[i] !== '----------'; i++) {
            const m = /^([^=]+?) = (.*)$/.exec(lines[i]);
            if (m && props[m[1]] === undefined) props[m[1]] = m[2];
        }
    } else {
        i = lines.findIndex((l) => l === '----------');
    }
    let cur = null;
    for (i += 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) {
            if (cur) entries.push(cur);
            cur = null;
            continue;
        }
        const m = /^([^=]+?) = (.*)$/.exec(line);
        if (!m) continue;
        if (!cur) cur = {};
        cur[m[1]] = m[2];
    }
    if (cur) entries.push(cur);
    return { props, entries };
}

function classifyError(text) {
    const t = String(text || '');
    if (/Wrong password|Can ?not open encrypted archive|Data Error in encrypted file/i.test(t)) return 'PASSWORD';
    if (/Can ?not open the file as archive|Cannot open the file as archive|Is not archive/i.test(t)) return 'NOT_ARCHIVE';
    if (/No space left|not enough space/i.test(t)) return 'DISK_FULL';
    return 'ERROR';
}

function archiveError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

/** Bytes as 7-Zip prints them in messages: "279 bytes (1 KiB)". */
function sizeText(bytes) {
    const n = Math.max(0, Number(bytes) || 0);
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let v = n;
    let u = -1;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
    const short = u < 0 ? `${Math.max(1, Math.ceil(n / 1024))} KiB` : `${Math.round(v)} ${units[u]}`;
    return `${n.toLocaleString('en-US')} bytes (${short})`;
}

class Semaphore {
    constructor(n) { this.n = n; this.q = []; }
    async acquire() {
        if (this.n > 0) { this.n -= 1; return; }
        await new Promise((r) => this.q.push(r));
    }
    release() {
        const next = this.q.shift();
        if (next) next(); else this.n += 1;
    }
}

class VfsArchive {
    constructor(vfsManager) {
        this.vfs = vfsManager;
        this.gr = vfsManager.globalResources;
        this._root = null;
        this.infoCache = new Map();
        this.passwords = new Map();
        this.ops = new Map();
        this.downloads = new Map();
        this.streamGate = new Semaphore(STREAM_CONCURRENCY);
        this._tarJobs = new Map();
    }

    /** <.cache>/7zip, resolved on first use (a restart's leftover work/ is cleared then). */
    get root() {
        if (!this._root) {
            this._root = path.join(this.gr.getPath('cache'), '7zip');
            try { fs.rmSync(path.join(this._root, 'work'), { recursive: true, force: true }); } catch (_) { /* none */ }
        }
        return this._root;
    }

    // ---- paths ------------------------------------------------------------------------------

    isArchivePath(vfsPath) {
        return typeof vfsPath === 'string' && vfsPath.includes(`/${SEGMENT}`);
    }

    /** { parentPath, fileId, inner: [segments] } or null */
    splitArchivePath(vfsPath) {
        if (!this.isArchivePath(vfsPath)) return null;
        const parts = String(vfsPath).split('/').filter(Boolean);
        const at = parts.findIndex((p) => p.startsWith(SEGMENT));
        if (at < 0) return null;
        const fileId = parts[at].slice(SEGMENT.length);
        if (!fileId) return null;
        let inner;
        try {
            inner = parts.slice(at + 1).map((s) => decodeURIComponent(s));
        } catch (_) {
            inner = parts.slice(at + 1);
        }
        return {
            parentPath: at === 0 ? '/' : `/${parts.slice(0, at).join('/')}`,
            archiveRoot: `/${parts.slice(0, at + 1).join('/')}`,
            fileId,
            inner
        };
    }

    buildArchivePath(parentPath, fileId, inner = []) {
        const base = String(parentPath || '/').replace(/\/+$/, '');
        const tail = inner.filter(Boolean).map((s) => `/${encodeURIComponent(s)}`).join('');
        return `${base}/${SEGMENT}${fileId}${tail}`;
    }

    archiveFormatForName(name) {
        const lower = String(name || '').toLowerCase();
        if (isTarWrapped(lower)) return FORMAT_BY_EXT[extOf(lower)] || 'tar';
        return FORMAT_BY_EXT[extOf(lower)] || null;
    }

    typeLabelForName(name) {
        const fmt = this.archiveFormatForName(name);
        if (fmt === 'zip') return 'Compressed (zipped) Folder';
        if (fmt) return `${extOf(name)} Archive`;
        return null;
    }

    // ---- 7-Zip ------------------------------------------------------------------------------

    /**
     * Run 7z. onProgress(percent, count, name) follows -bsp1; onSpawn(child) for pause / cancel.
     * Resolves { code, stdout, stderr } (never rejects on a non-zero exit).
     */
    run7z(args, { cwd, onProgress, onSpawn, stdout: stdoutSink } = {}) {
        return new Promise((resolve, reject) => {
            let child;
            try {
                child = spawn(SEVEN_ZIP, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
            } catch (err) {
                reject(err);
                return;
            }
            if (onSpawn) onSpawn(child);
            const out = [];
            const errs = [];
            let outLen = 0;
            child.stdout.on('data', (chunk) => {
                if (stdoutSink) { stdoutSink(chunk); return; }
                if (onProgress) {
                    for (const piece of chunk.toString('utf8').split(/[\b\r\n]+/)) {
                        const m = /^\s*(\d{1,3})%(?:\s+(\d+))?(?:\s+[-+=UAR]?\s*(.*))?$/.exec(piece);
                        if (m) onProgress(Number(m[1]), m[2] != null ? Number(m[2]) : null, (m[3] || '').trim());
                    }
                    return;
                }
                if (outLen < 64 * 1024 * 1024) { out.push(chunk); outLen += chunk.length; }
            });
            child.stderr.on('data', (chunk) => errs.push(chunk));
            child.on('error', reject);
            child.on('close', (code, signal) => resolve({
                code: code == null ? (signal ? 255 : 0) : code,
                signal,
                stdout: Buffer.concat(out).toString('utf8'),
                stderr: Buffer.concat(errs).toString('utf8')
            }));
        });
    }

    passwordArg(password) {
        return `-p${password || ''}`;
    }

    cachedPassword(hash) {
        const hit = this.passwords.get(hash);
        if (!hit) return '';
        if (Date.now() - hit.at > PASSWORD_TTL_MS) { this.passwords.delete(hash); return ''; }
        hit.at = Date.now();
        return hit.password;
    }

    rememberPassword(hash, password) {
        if (password) this.passwords.set(hash, { password, at: Date.now() });
    }

    async ensureDir(dir) {
        await fsp.mkdir(dir, { recursive: true });
        return dir;
    }

    async freeBytes(dir) {
        try {
            if (typeof fsp.statfs !== 'function') return Infinity;
            const st = await fsp.statfs(dir);
            return Number(st.bavail) * Number(st.bsize);
        } catch (_) {
            return Infinity;
        }
    }

    async getFile(fileId) {
        const file = await vfsDatabase.getUserFileById(String(fileId || ''));
        if (!file || file.trashed_at) throw archiveError('NOT_FOUND', 'The archive is no longer available.');
        return file;
    }

    /** The path 7-Zip opens for a stored archive (its blob, named with its extension). */
    async sourcePath(file) {
        const blob = this.vfs.getFileBlobPath(file.content_hash);
        if (!fs.existsSync(blob)) throw archiveError('NOT_FOUND', 'The archive file is missing.');
        const lower = String(file.original_name || '').toLowerCase();
        const linkDir = await this.ensureDir(path.join(this.root, 'links'));
        const suffix = isTarWrapped(lower)
            ? TAR_WRAPPER_SUFFIXES.find((s) => lower.endsWith(s))
            : (extOf(lower) ? `.${extOf(lower)}` : '');
        const link = path.join(linkDir, `${file.content_hash}${suffix}`);
        try {
            await fsp.lstat(link);
        } catch (_) {
            try { await fsp.symlink(blob, link); } catch (err) { if (err.code !== 'EEXIST') throw err; }
        }
        if (!isTarWrapped(lower)) return link;
        return this.innerTar(file, link);
    }

    /** A .tar.gz-style archive's tar, unpacked once into tar/ (7-Zip browses it as Vista would the .tar). */
    async innerTar(file, link) {
        const dir = await this.ensureDir(path.join(this.root, 'tar'));
        const target = path.join(dir, `${file.content_hash}.tar`);
        try {
            const st = await fsp.stat(target);
            const now = new Date();
            fsp.utimes(target, now, st.mtime).catch(() => {});
            return target;
        } catch (_) { /* unpack */ }
        if (this._tarJobs.has(target)) return this._tarJobs.get(target);
        const job = (async () => {
            const tmp = `${target}.${process.pid}.part`;
            const outStream = fs.createWriteStream(tmp);
            let failed = null;
            outStream.on('error', (err) => { failed = err; });
            const r = await this.run7z(['e', '-so', '-bd', this.passwordArg(''), '--', link], {
                stdout: (chunk) => { if (!failed) outStream.write(chunk); }
            });
            await new Promise((res) => outStream.end(res));
            if (failed || r.code > 1) {
                await fsp.rm(tmp, { force: true });
                throw archiveError(classifyError(r.stderr), failed ? failed.message : (r.stderr.trim() || 'Cannot open the file as archive.'));
            }
            await fsp.rename(tmp, target);
            this.pruneTarCache(dir).catch(() => {});
            return target;
        })();
        this._tarJobs.set(target, job);
        try {
            return await job;
        } finally {
            this._tarJobs.delete(target);
        }
    }

    async pruneTarCache(dir) {
        const names = await fsp.readdir(dir);
        const files = [];
        for (const n of names) {
            if (!n.endsWith('.tar')) continue;
            const st = await fsp.stat(path.join(dir, n)).catch(() => null);
            if (st) files.push({ p: path.join(dir, n), size: st.size, at: st.atimeMs });
        }
        let total = files.reduce((s, f) => s + f.size, 0);
        files.sort((a, b) => a.at - b.at);
        while (total > TAR_CACHE_MAX_BYTES && files.length > 1) {
            const f = files.shift();
            await fsp.rm(f.p, { force: true });
            total -= f.size;
        }
    }

    // ---- listing ----------------------------------------------------------------------------

    /** The archive's entries as a tree (cached by content). Throws code PASSWORD when locked. */
    async getInfo(file, password) {
        const key = file.content_hash;
        const cached = this.infoCache.get(key);
        if (cached) {
            this.infoCache.delete(key);
            this.infoCache.set(key, cached);
            return cached;
        }
        const src = await this.sourcePath(file);
        const pw = password != null ? password : this.cachedPassword(key);
        const r = await this.run7z(['l', '-slt', '-sccUTF-8', this.passwordArg(pw), '--', src]);
        if (r.code > 1) {
            const code = classifyError(`${r.stderr}\n${r.stdout}`);
            const msg = code === 'PASSWORD'
                ? 'Can not open encrypted archive. Wrong password?'
                : code === 'NOT_ARCHIVE'
                    ? `Can not open the file as archive: ${file.original_name}`
                    : (r.stderr.trim().split(/\r?\n/).pop() || 'Cannot open the archive.');
            throw archiveError(code, msg);
        }
        const { props, entries } = parseTechnicalListing(r.stdout);
        const info = this.buildTree(file, props, entries);
        if (pw) this.rememberPassword(key, pw);
        this.infoCache.set(key, info);
        while (this.infoCache.size > INFO_CACHE_MAX) this.infoCache.delete(this.infoCache.keys().next().value);
        return info;
    }

    buildTree(file, props, rawEntries) {
        const root = { name: '', path: '', isDir: true, children: new Map(), size: 0, packed: 0, mtime: null };
        const byPath = new Map([['', root]]);
        let unpacked = 0;
        let packed = 0;
        let fileCount = 0;
        let encrypted = false;
        const ensureDir = (dirPath) => {
            if (byPath.has(dirPath)) return byPath.get(dirPath);
            const parentPath = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '';
            const parent = ensureDir(parentPath);
            const node = { name: dirPath.slice(dirPath.lastIndexOf('/') + 1), path: dirPath, isDir: true, children: new Map(), size: 0, packed: 0, mtime: null };
            parent.children.set(node.name, node);
            byPath.set(dirPath, node);
            return node;
        };
        const fallbackName = String(file.original_name || 'file').replace(/\.[^.]+$/, '') || 'file';
        for (const e of rawEntries) {
            let p = cleanEntryPath(e.Path);
            if (!p) p = fallbackName;
            if (p.split('/').some((s) => s === '..')) continue;
            const isDir = e.Folder === '+' || /^D/.test(e.Attributes || '');
            const size = Number(e.Size) || 0;
            const pk = Number(e['Packed Size']) || 0;
            const enc = e.Encrypted === '+';
            if (enc) encrypted = true;
            if (isDir) {
                const node = ensureDir(p);
                node.mtime = parseModified(e.Modified) || node.mtime;
                continue;
            }
            const parentPath = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
            const parent = ensureDir(parentPath);
            const node = { name: p.slice(p.lastIndexOf('/') + 1), path: p, isDir: false, size, packed: pk, mtime: parseModified(e.Modified), encrypted: enc, crc: e.CRC || '', method: e.Method || '' };
            parent.children.set(node.name, node);
            byPath.set(p, node);
            unpacked += size;
            packed += pk;
            fileCount += 1;
        }
        // folder sizes, as 7-Zip's file manager sums them
        const sum = (node) => {
            if (!node.isDir) return [node.size, node.packed, 1];
            let s = 0; let k = 0; let n = 0;
            for (const c of node.children.values()) {
                const [cs, ck, cn] = sum(c);
                s += cs; k += ck; n += cn;
            }
            node.size = s; node.packed = k; node.fileCount = n;
            return [s, k, n];
        };
        sum(root);
        const physical = Number(props['Physical Size']) || Number(file.size) || 0;
        return {
            fileId: file.id,
            name: file.original_name,
            hash: file.content_hash,
            type: props.Type || '',
            solid: props.Solid === '+',
            physicalSize: physical,
            unpackedSize: unpacked,
            packedSize: packed,
            fileCount,
            encrypted,
            root,
            byPath
        };
    }

    entryIcon(name, isDir) {
        if (isDir) return 'fas fa-folder';
        const fmt = this.archiveFormatForName(name);
        if (fmt) return `fas fa-file-zipper ex-archive-${fmt}`;
        const mime = mimeForName(name);
        if (mime.startsWith('image/')) return 'fas fa-file-image';
        if (mime.startsWith('text/') || mime === 'application/json') return 'fas fa-file-lines';
        return 'fas fa-file';
    }

    entryUrl(fileId, entryPath, inline = false) {
        const uuid = this.gr.getVfsPathUuid();
        return `/${uuid}/archive/${encodeURIComponent(fileId)}/entry?path=${encodeURIComponent(entryPath)}${inline ? '&inline=1' : ''}`;
    }

    entryToItem(info, node, loc) {
        const mime = node.isDir ? null : mimeForName(node.name);
        const canPreview = !node.isDir && mime.startsWith('image/') && !node.encrypted
            && node.size > 0 && node.size <= PREVIEW_MAX_ENTRY_BYTES
            && (!info.solid || info.physicalSize <= PREVIEW_MAX_SOLID_ARCHIVE_BYTES);
        const item = {
            id: `arc:${info.fileId}:${node.path}`,
            name: node.name,
            kind: node.isDir ? 'folder' : 'file',
            targetKind: 'archive-entry',
            targetId: node.path,
            archiveFileId: info.fileId,
            archiveEntryPath: node.path,
            archiveName: info.name,
            icon: this.entryIcon(node.name, node.isDir),
            system: false,
            protected: true,
            importable: false,
            size: node.size,
            sizeBytes: node.size,
            packedSize: node.packed,
            modifiedAt: node.mtime,
            typeLabel: node.isDir ? 'File Folder' : undefined,
            encrypted: !!node.encrypted
        };
        if (node.isDir) {
            item.navPath = this.buildArchivePath(loc.parentPath, info.fileId, node.path.split('/'));
        } else {
            item.mimeType = mime;
            item.downloadUrl = this.entryUrl(info.fileId, node.path, false);
            item.viewUrl = this.entryUrl(info.fileId, node.path, true);
            const fmt = this.archiveFormatForName(node.name);
            if (fmt) item.archiveFormat = fmt;
            if (canPreview) item.archivePreviewUrl = item.viewUrl;
        }
        return item;
    }

    async resolveLocation(vfsPath) {
        const loc = this.splitArchivePath(this.vfs.normalizePath(vfsPath));
        if (!loc) throw archiveError('NOT_FOUND', 'Not an archive path');
        const file = await this.getFile(loc.fileId);
        const info = await this.getInfo(file);
        const node = info.byPath.get(loc.inner.join('/'));
        if (!node || !node.isDir) throw archiveError('NOT_FOUND', 'The folder does not exist in the archive.');
        return { loc, file, info, node };
    }

    archiveSummary(info) {
        return {
            fileId: info.fileId,
            name: info.name,
            format: this.archiveFormatForName(info.name),
            type: info.type,
            solid: info.solid,
            encrypted: info.encrypted,
            unlocked: !!this.cachedPassword(info.hash),
            physicalSize: info.physicalSize,
            unpackedSize: info.unpackedSize,
            packedSize: info.packedSize,
            fileCount: info.fileCount
        };
    }

    async listDirectory(vfsPath, options = {}) {
        const { offset = 0, limit = 300, sortField = 'name', sortDirection = 'asc', search = '' } = options;
        const { loc, info, node } = await this.resolveLocation(vfsPath);
        let items = [...node.children.values()].map((c) => this.entryToItem(info, c, loc));
        items = this.vfs.filterItems(items, search);
        items = this.vfs.sortItems(items, sortField, sortDirection);
        const page = this.vfs.paginateItems(items, offset, limit);
        return {
            path: this.vfs.normalizePath(vfsPath),
            items: page.items,
            totalCount: items.length,
            totalSizeBytes: node.size,
            hasMore: page.hasMore,
            emptyMessage: 'This folder is empty.',
            archive: this.archiveSummary(info)
        };
    }

    async getPathDisplayInfo(vfsPath) {
        const loc = this.splitArchivePath(vfsPath);
        const file = await this.getFile(loc.fileId);
        const parent = await this.vfs.getPathDisplayInfo(loc.parentPath);
        const segments = [...(parent.segments || [])];
        segments.push({ label: file.original_name, canonical: loc.archiveRoot });
        let canonical = loc.archiveRoot;
        for (const seg of loc.inner) {
            canonical = `${canonical}/${encodeURIComponent(seg)}`;
            segments.push({ label: seg, canonical });
        }
        const last = segments[segments.length - 1];
        return {
            displayName: last.label,
            displayPath: this.vfs._buildDisplayPathFromSegments(segments),
            segments
        };
    }

    async getPathStats(vfsPath) {
        const normalized = this.vfs.normalizePath(vfsPath);
        const [{ info, node }, display] = await Promise.all([
            this.resolveLocation(normalized),
            this.getPathDisplayInfo(normalized)
        ]);
        return {
            path: normalized,
            displayName: display.displayName,
            displayPath: display.displayPath,
            itemCount: node.children.size,
            totalSizeBytes: node.size,
            selectedCount: 0,
            archive: this.archiveSummary(info)
        };
    }

    /**
     * Opening an archive: its summary, or needsPassword when 7-Zip cannot open it without one.
     * A password given is checked (on the smallest encrypted entry when the names are readable)
     * and kept for an hour, so previews and downloads work without asking again.
     */
    async describe(fileId, password) {
        const file = await this.getFile(fileId);
        if (password) this.infoCache.delete(file.content_hash);
        let info;
        try {
            info = await this.getInfo(file, password || undefined);
        } catch (err) {
            if (err.code === 'PASSWORD') return { needsPassword: true, wrongPassword: !!password, name: file.original_name };
            throw err;
        }
        if (info.encrypted && password) {
            const ok = await this.checkPassword(file, info, password);
            if (!ok) {
                this.passwords.delete(file.content_hash);
                return { needsPassword: true, wrongPassword: true, name: file.original_name, archive: this.archiveSummary(info) };
            }
            this.rememberPassword(file.content_hash, password);
        }
        return { archive: this.archiveSummary(info), name: file.original_name };
    }

    async checkPassword(file, info, password) {
        let smallest = null;
        for (const node of info.byPath.values()) {
            if (!node.isDir && node.encrypted && (!smallest || node.size < smallest.size)) smallest = node;
        }
        if (!smallest) return true;
        const src = await this.sourcePath(file);
        const r = await this.run7z(['t', '-bso0', '-bse2', '-bd', '-spd', this.passwordArg(password), '--', src, smallest.path]);
        return r.code === 0;
    }

    // ---- entry streaming (GET /<vfs>/archive/<fileId>/entry?path=) ----------------------------

    async streamEntry(req, res, file, entryPath, { inline = false } = {}) {
        const info = await this.getInfo(file);
        const node = info.byPath.get(cleanEntryPath(entryPath));
        if (!node || node.isDir) {
            res.status(404).send('Not found');
            return;
        }
        const src = await this.sourcePath(file);
        await this.streamGate.acquire();
        let released = false;
        const release = () => { if (!released) { released = true; this.streamGate.release(); } };
        const child = spawn(SEVEN_ZIP, ['e', '-so', '-bd', '-spd', this.passwordArg(this.cachedPassword(file.content_hash)), '--', src, node.path], { stdio: ['ignore', 'pipe', 'pipe'] });
        let started = false;
        let errText = '';
        child.stderr.on('data', (c) => { errText += c.toString('utf8'); });
        const type = mimeForName(node.name);
        res.setHeader('Content-Type', type);
        const disposition = inline ? 'inline' : 'attachment';
        res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(node.name)}`);
        if (node.size > 0) res.setHeader('Content-Length', String(node.size));
        res.setHeader('Cache-Control', 'private, max-age=300');
        // the headers go out with the first bytes, so a 7-Zip failure can still answer with an error
        child.stdout.once('data', (first) => {
            started = true;
            res.write(first);
            child.stdout.pipe(res);
        });
        const kill = () => { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } };
        res.on('close', () => { if (!res.writableFinished) kill(); release(); });
        child.on('error', () => { release(); if (!res.headersSent) res.status(500).end(); else res.destroy(); });
        child.on('close', (code) => {
            release();
            if (started) return;
            if (code > 1) {
                res.removeHeader('Content-Length');
                res.removeHeader('Content-Disposition');
                res.status(classifyError(errText) === 'PASSWORD' ? 403 : 500).type('text/plain').send(errText.trim() || 'Extraction failed');
            } else {
                res.end();
            }
        });
    }

    /**
     * One entry's bytes (Melaton apps read their data next to the launched file, Yozora #638).
     * Throws NOT_FOUND for a missing entry and TOO_LARGE past maxBytes.
     */
    async readEntry(file, entryPath, maxBytes = 64 * 1024 * 1024) {
        const info = await this.getInfo(file);
        const node = info.byPath.get(cleanEntryPath(entryPath));
        if (!node || node.isDir) throw archiveError('NOT_FOUND', `${entryPath} is not in the archive.`);
        if (node.size > maxBytes) throw archiveError('TOO_LARGE', `${node.name} is too large.`);
        const src = await this.sourcePath(file);
        await this.streamGate.acquire();
        try {
            return await new Promise((resolve, reject) => {
                const child = spawn(SEVEN_ZIP, ['e', '-so', '-bd', '-spd', this.passwordArg(this.cachedPassword(file.content_hash)), '--', src, node.path], { stdio: ['ignore', 'pipe', 'pipe'] });
                const chunks = [];
                let total = 0;
                let errText = '';
                child.stdout.on('data', (c) => {
                    total += c.length;
                    if (total > maxBytes) { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } return; }
                    chunks.push(c);
                });
                child.stderr.on('data', (c) => { errText += c.toString('utf8'); });
                child.on('error', reject);
                child.on('close', (code) => {
                    if (total > maxBytes) reject(archiveError('TOO_LARGE', `${node.name} is too large.`));
                    else if (code > 1) reject(archiveError(classifyError(errText), errText.trim() || 'Extraction failed'));
                    else resolve(Buffer.concat(chunks));
                });
            });
        } finally {
            this.streamGate.release();
        }
    }

    // ---- packed downloads (GET /<vfs>/archive-download/<token>) --------------------------------

    registerDownload(filePath, name, cleanupDir) {
        const token = crypto.randomBytes(18).toString('base64url');
        const entry = { filePath, name, cleanupDir, at: Date.now() };
        entry.timer = setTimeout(() => this.dropDownload(token), DOWNLOAD_TTL_MS);
        if (entry.timer.unref) entry.timer.unref();
        this.downloads.set(token, entry);
        return `/${this.gr.getVfsPathUuid()}/archive-download/${token}`;
    }

    dropDownload(token) {
        const entry = this.downloads.get(token);
        if (!entry) return;
        this.downloads.delete(token);
        clearTimeout(entry.timer);
        if (entry.cleanupDir) fsp.rm(entry.cleanupDir, { recursive: true, force: true }).catch(() => {});
    }

    async sendDownload(req, res, token) {
        const entry = this.downloads.get(token);
        if (!entry) {
            res.status(404).send('This download has expired.');
            return;
        }
        const st = await fsp.stat(entry.filePath).catch(() => null);
        if (!st) {
            this.dropDownload(token);
            res.status(404).send('Not found');
            return;
        }
        res.setHeader('Content-Type', mimeForName(entry.name));
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(entry.name)}`);
        res.setHeader('Content-Length', String(st.size));
        const stream = fs.createReadStream(entry.filePath);
        stream.pipe(res);
        res.on('finish', () => this.dropDownload(token));
    }

    // ---- operations -------------------------------------------------------------------------

    /**
     * Start an operation; progress goes to `send` as vfs_archive_progress payloads.
     * kind: extract | create | test | hash | pack
     */
    start(kind, params, { send, broadcast, session }) {
        const op = {
            id: crypto.randomUUID(),
            kind,
            send,
            broadcast,
            session,
            child: null,
            paused: false,
            background: false,
            cancelled: false,
            started: Date.now(),
            stats: { total: 0, processed: 0, files: 0, filesTotal: 0, packed: 0, errors: 0, current: '', status: '' },
            messages: [],
            ask: null,
            lastEmit: 0,
            pauseWaiters: []
        };
        this.ops.set(op.id, op);
        const runners = { extract: 'runExtract', create: 'runCreate', test: 'runTest', hash: 'runHash', pack: 'runPack' };
        const fn = runners[kind];
        if (!fn) throw new Error(`Unknown archive operation: ${kind}`);
        setImmediate(async () => {
            const work = path.join(this.root, 'work', op.id);
            op.work = work;
            try {
                await this.ensureDir(work);
                const result = await this[fn](op, params || {});
                if (op.cancelled) this.emit(op, { state: 'cancelled' }, true);
                else this.emit(op, { state: op.messages.length && op.stats.errors ? 'error' : 'done', result: result || null }, true);
            } catch (err) {
                if (op.cancelled) {
                    this.emit(op, { state: 'cancelled' }, true);
                } else {
                    op.stats.errors += 1;
                    op.messages.push(err.message || String(err));
                    this.emit(op, { state: 'error', code: err.code || 'ERROR' }, true);
                }
            } finally {
                this.ops.delete(op.id);
                if (!op.keepWork) fsp.rm(work, { recursive: true, force: true }).catch(() => {});
            }
        });
        return op.id;
    }

    emit(op, extra = {}, force = false) {
        const now = Date.now();
        if (!force && now - op.lastEmit < EMIT_EVERY_MS) return;
        op.lastEmit = now;
        try {
            op.send({
                opId: op.id,
                kind: op.kind,
                state: 'running',
                elapsedMs: now - op.started,
                paused: op.paused,
                background: op.background,
                ...op.stats,
                messages: op.messages.slice(-200),
                ask: op.ask ? op.ask.question : null,
                ...extra
            });
        } catch (_) { /* the window is gone; the operation still finishes */ }
    }

    control(opId, action, answer) {
        const op = this.ops.get(String(opId || ''));
        if (!op) return false;
        const sig = (s) => { if (op.child && op.child.exitCode == null) { try { op.child.kill(s); } catch (_) { /* gone */ } } };
        switch (action) {
            case 'pause':
                op.paused = true;
                sig('SIGSTOP');
                break;
            case 'resume':
                op.paused = false;
                sig('SIGCONT');
                op.pauseWaiters.splice(0).forEach((r) => r());
                break;
            case 'background':
            case 'foreground':
                op.background = action === 'background';
                // a raised niceness cannot be lowered again without CAP_SYS_NICE; Foreground just tries
                if (op.child && op.child.pid) {
                    try { os.setPriority(op.child.pid, op.background ? 10 : 0); } catch (_) { /* not allowed */ }
                }
                break;
            case 'cancel':
                op.cancelled = true;
                sig('SIGCONT');
                sig('SIGTERM');
                op.pauseWaiters.splice(0).forEach((r) => r());
                if (op.ask) op.ask.resolve('cancel');
                break;
            case 'answer':
                if (op.ask) op.ask.resolve(String(answer || 'no'));
                break;
            default:
                return false;
        }
        this.emit(op, {}, true);
        return true;
    }

    async checkpoint(op) {
        if (op.cancelled) throw archiveError('CANCELLED', 'Operation was cancelled');
        while (op.paused && !op.cancelled) {
            await new Promise((r) => op.pauseWaiters.push(r));
        }
        if (op.cancelled) throw archiveError('CANCELLED', 'Operation was cancelled');
    }

    async askUser(op, question) {
        const answer = await new Promise((resolve) => {
            op.ask = { question, resolve };
            this.emit(op, {}, true);
        });
        op.ask = null;
        return answer;
    }

    /** 7z under an operation: pause / cancel reach the process, its stderr becomes the error list. */
    async runOp7z(op, args, { cwd, weight = 1, base = 0, total = 0 } = {}) {
        const r = await this.run7z(args, {
            cwd,
            onSpawn: (child) => {
                op.child = child;
                if (op.background) { try { os.setPriority(child.pid, 10); } catch (_) { /* not allowed */ } }
                if (op.paused) { try { child.kill('SIGSTOP'); } catch (_) { /* gone */ } }
            },
            onProgress: (pct, count, name) => {
                op.stats.processed = Math.round(base + (total * weight * Math.min(100, pct)) / 100);
                if (name) op.stats.current = name;
                if (count != null && op.kind !== 'extract') op.stats.files = count;
                this.emit(op);
            }
        });
        op.child = null;
        if (op.cancelled) throw archiveError('CANCELLED', 'Operation was cancelled');
        const lines = r.stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
            .filter((l) => !/^(ERRORS?|WARNINGS?):?$/.test(l));
        if (r.code > 1) {
            const code = classifyError(r.stderr);
            const msgs = lines.map((l) => l.replace(/^(ERROR|WARNING):\s*/, '')).filter((l) => !/^Headers Error$/.test(l) || lines.length === 1);
            const err = archiveError(code, msgs[0] || (code === 'DISK_FULL' ? 'There is not enough space on the disk.' : `7-Zip failed (${r.code})`));
            err.lines = msgs;
            throw err;
        }
        if (r.code === 1) {
            for (const l of lines) {
                op.messages.push(l.replace(/^(ERROR|WARNING):\s*/, ''));
                op.stats.errors += 1;
            }
        }
        return r;
    }

    /** A VFS folder path as { scope, workspaceId, folderId } for new files (refuses the Desktop and system folders). */
    async targetLocation(vfsPath) {
        const resolved = await this.vfs.resolvePathInput(vfsPath || '/');
        const parsed = this.vfs.parsePath(resolved);
        if (parsed.type === 'system-folder') throw new Error(`Cannot extract files to the ${parsed.systemName} folder.`);
        const location = this.vfs.resolveLocationFromPath(resolved);
        return { ...location, path: resolved, context: parsed.type === 'root' ? 'root' : parsed.type === 'workspace-home' ? 'workspace-home' : null };
    }

    async childFolders(loc) {
        return vfsDatabase.getFoldersByParent(loc.scope, loc.workspaceId, loc.folderId);
    }

    async childFiles(loc) {
        return vfsDatabase.getUserFilesByLocation(loc.scope, loc.workspaceId, loc.folderId);
    }

    /** The child folder of that name (reused, as extracting over a folder merges into it), or a new one. */
    async ensureFolder(loc, rawName) {
        let name = safeName(rawName);
        if (loc.context && this.vfs.isReservedFolderName(name, loc.context)) name = `${name} (2)`;
        const folders = await this.childFolders(loc);
        const hit = folders.find((f) => String(f.name).toLowerCase() === name.toLowerCase());
        const folder = hit || await vfsDatabase.createFolder({ scope: loc.scope, workspaceId: loc.workspaceId, parentId: loc.folderId, name });
        return { scope: loc.scope, workspaceId: loc.workspaceId, folderId: folder.id, context: null, folder };
    }

    async recordReplication(file, loc) {
        if (!file || !file.content_hash) return;
        try {
            // modules/replicationJournal.js (as vfs_upload_file records a stored file)
            await require('./replicationJournal').recordVfsFile(file.content_hash, {
                operation: 'INSERT',
                payload: { fileId: file.id, originalName: file.original_name, scope: loc.scope, workspaceId: loc.workspaceId }
            });
        } catch (_) { /* replication optional */ }
    }

    /**
     * Copy an extracted tree into a VFS location. names limits the top level (a selection);
     * symlinks in the archive are skipped (they could point outside the work folder).
     */
    async importTree(op, srcDir, loc, names, state) {
        let entries = await fsp.readdir(srcDir, { withFileTypes: true });
        if (names) {
            const wanted = new Set(names);
            entries = entries.filter((e) => wanted.has(e.name));
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const e of entries) {
            await this.checkpoint(op);
            const full = path.join(srcDir, e.name);
            const st = await fsp.lstat(full);
            if (st.isSymbolicLink()) {
                op.messages.push(`Symbolic link skipped: ${e.name}`);
                continue;
            }
            if (st.isDirectory()) {
                const child = await this.ensureFolder(loc, e.name);
                state.folders += 1;
                await this.importTree(op, full, child, null, state);
            } else if (st.isFile()) {
                await this.importFile(op, full, e.name, loc, st, state);
            }
        }
    }

    async importFile(op, full, rawName, loc, st, state) {
        let name = safeName(rawName);
        const key = `${loc.scope}:${loc.workspaceId || ''}:${loc.folderId || ''}`;
        if (!state.listings.has(key)) state.listings.set(key, await this.childFiles(loc));
        const files = state.listings.get(key);
        const taken = (n) => files.some((f) => String(f.original_name || '').toLowerCase() === n.toLowerCase());
        const existing = files.find((f) => String(f.original_name || '').toLowerCase() === name.toLowerCase());
        let overwrite = false;
        if (existing) {
            let mode = state.overwrite;
            if (mode === 'ask') {
                const answer = await this.askUser(op, {
                    type: 'replace',
                    name,
                    existing: { size: existing.size, modifiedAt: existing.updated_at || existing.created_at },
                    incoming: { size: st.size, modifiedAt: Math.floor(st.mtimeMs / 1000) }
                });
                if (answer === 'cancel') { op.cancelled = true; throw archiveError('CANCELLED', 'Operation was cancelled'); }
                if (answer === 'yesAll') state.overwrite = 'overwrite';
                if (answer === 'noAll') state.overwrite = 'skip';
                mode = { yes: 'overwrite', yesAll: 'overwrite', no: 'skip', noAll: 'skip', rename: 'rename' }[answer] || 'skip';
            }
            if (mode === 'skip') {
                state.skipped += 1;
                state.done += st.size;
                return;
            }
            if (mode === 'rename') name = autoRename(name, taken);
            else if (mode === 'renameExisting') {
                const renamed = autoRename(existing.original_name, taken);
                await vfsDatabase.updateUserFile(existing.id, { original_name: renamed });
                existing.original_name = renamed;
            } else {
                overwrite = true;
            }
        }
        const stored = await this.vfs.saveUserFileFromPath(full, {
            originalName: name,
            mimeType: mimeForName(name),
            scope: loc.scope,
            workspaceId: loc.workspaceId,
            folderId: loc.folderId,
            overwrite
        });
        await this.recordReplication(stored, loc);
        if (!overwrite) files.push(stored);
        state.files += 1;
        state.done += st.size;
        state.stored.push({ id: stored.id, name: stored.original_name });
        op.stats.files = state.files;
        op.stats.current = name;
        op.stats.processed = Math.round(state.base + state.weight * state.done);
        this.emit(op);
    }

    /** The entries a request names, checked against the listing (all of them when none). */
    selectEntries(info, entries) {
        if (!Array.isArray(entries) || !entries.length) return null;
        const out = [];
        for (const raw of entries) {
            const p = cleanEntryPath(raw);
            const node = info.byPath.get(p);
            if (node && p) out.push(node);
        }
        if (!out.length) throw new Error('None of the selected items are in the archive.');
        return out;
    }

    /** Extract to a temp folder: 7z x (or e, No pathnames) for the selection. Returns the out folder. */
    async extractToWork(op, file, info, nodes, { password, pathMode = 'full', weight = 1 } = {}) {
        const src = await this.sourcePath(file);
        const total = nodes ? nodes.reduce((s, n) => s + n.size, 0) : info.unpackedSize;
        const fileCount = nodes ? nodes.reduce((s, n) => s + (n.isDir ? (n.fileCount || 0) : 1), 0) : info.fileCount;
        op.stats.total = Math.max(op.stats.total, total);
        op.stats.filesTotal = fileCount;
        const free = await this.freeBytes(this.root);
        if (total * 1.05 + 256 * 1024 * 1024 > free) throw archiveError('DISK_FULL', 'There is not enough space on the disk.');
        const out = await this.ensureDir(path.join(op.work, 'out'));
        const pw = password || this.cachedPassword(file.content_hash);
        const args = [pathMode === 'none' ? 'e' : 'x', '-y', '-aou', '-bso0', '-bse2', '-bsp1', '-spd', this.passwordArg(pw), `-o${out}`, '--', src];
        if (nodes) args.push(...nodes.map((n) => n.path));
        op.stats.status = 'Extracting';
        this.emit(op, {}, true);
        await this.runOp7z(op, args, { weight, total });
        if (password) this.rememberPassword(file.content_hash, password);
        return { out, total };
    }

    async runExtract(op, p) {
        const file = await this.getFile(p.fileId);
        const info = await this.getInfo(file, p.password || undefined);
        const nodes = this.selectEntries(info, p.entries);
        const base = cleanEntryPath(p.base || '');
        const pathMode = p.pathMode === 'none' ? 'none' : 'full';
        const weight = 0.8;
        const { out, total } = await this.extractToWork(op, file, info, nodes, { password: p.password, pathMode, weight });
        op.stats.status = 'Extracting';
        let loc = await this.targetLocation(p.targetPath);
        // the "name\" box: into a subfolder of the target
        const sub = String(p.subfolder || '').replace(/[\\/]+$/, '').trim();
        let srcDir = out;
        let names = null;
        if (pathMode === 'full') {
            if (base) srcDir = path.join(out, ...base.split('/'));
            if (nodes) names = nodes.map((n) => n.name);
        }
        if (sub) {
            loc = await this.ensureFolder(loc, sub);
            // Eliminate duplication of root folder: archive/sample/... into sample\ lands as sample\...
            if (p.eliminateRoot) {
                const top = (await fsp.readdir(srcDir, { withFileTypes: true })).filter((e) => !names || names.includes(e.name));
                if (top.length === 1 && top[0].isDirectory() && top[0].name.toLowerCase() === sub.toLowerCase()) {
                    srcDir = path.join(srcDir, top[0].name);
                    names = null;
                }
            }
        }
        const state = {
            overwrite: ['ask', 'overwrite', 'skip', 'rename', 'renameExisting'].includes(p.overwrite) ? p.overwrite : 'ask',
            files: 0, folders: 0, skipped: 0, done: 0, stored: [], listings: new Map(),
            base: total * weight, weight: 1 - weight
        };
        op.stats.total = total;
        await this.importTree(op, srcDir, loc, names, state);
        op.stats.processed = total;
        op.stats.files = state.files;
        this.emit(op, {}, true);
        this.vfsUpdated(op, loc.path || p.targetPath);
        return { targetPath: p.targetPath, folderId: sub ? loc.folderId : null, files: state.files, skipped: state.skipped, stored: state.stored.slice(0, 50) };
    }

    vfsUpdated(op, pathHint) {
        this.vfs.invalidatePathStatsCache && this.vfs.invalidatePathStatsCache();
        if (op.broadcast) op.broadcast(pathHint || null);
    }

    async runTest(op, p) {
        const file = await this.getFile(p.fileId);
        const info = await this.getInfo(file, p.password || undefined);
        const nodes = this.selectEntries(info, p.entries);
        const src = await this.sourcePath(file);
        op.stats.total = nodes ? nodes.reduce((s, n) => s + n.size, 0) : info.unpackedSize;
        op.stats.filesTotal = nodes ? nodes.reduce((s, n) => s + (n.isDir ? (n.fileCount || 0) : 1), 0) : info.fileCount;
        op.stats.packed = info.physicalSize;
        op.stats.status = 'Testing';
        const pw = p.password || this.cachedPassword(file.content_hash);
        const args = ['t', '-bso0', '-bse2', '-bsp1', '-spd', this.passwordArg(pw), '--', src];
        if (nodes) args.push(...nodes.map((n) => n.path));
        try {
            await this.runOp7z(op, args, { total: op.stats.total });
        } catch (err) {
            if (err.code === 'CANCELLED') throw err;
            for (const l of (err.lines && err.lines.length ? err.lines : [err.message])) op.messages.push(l);
            op.stats.errors = Math.max(1, op.messages.length);
            return null;
        }
        op.stats.processed = op.stats.total;
        op.stats.files = op.stats.filesTotal;
        if (!op.stats.errors) op.messages.push('There are no errors');
        return { ok: !op.stats.errors };
    }

    /** Hard links (symlinks across volumes) of VFS files and folders under a staging folder. */
    async stageItems(op, items, stageRoot) {
        const stats = { total: 0, files: 0, top: [] };
        const used = new Map();
        const unique = (dir, name) => {
            const key = dir;
            if (!used.has(key)) used.set(key, new Set());
            const set = used.get(key);
            let n = safeName(name);
            if (set.has(n.toLowerCase())) {
                const dot = n.lastIndexOf('.');
                const stem = dot > 0 ? n.slice(0, dot) : n;
                const ext = dot > 0 ? n.slice(dot) : '';
                let i = 2;
                while (set.has(`${stem} (${i})${ext}`.toLowerCase())) i += 1;
                n = `${stem} (${i})${ext}`;
            }
            set.add(n.toLowerCase());
            return n;
        };
        const linkFile = async (row, dir) => {
            const blob = this.vfs.getFileBlobPath(row.content_hash);
            if (!fs.existsSync(blob)) {
                op.messages.push(`File is missing: ${row.original_name}`);
                op.stats.errors += 1;
                return null;
            }
            const name = unique(dir, row.original_name);
            const dest = path.join(dir, name);
            try {
                await fsp.link(blob, dest);
            } catch (_) {
                await fsp.symlink(blob, dest);
            }
            stats.total += Number(row.size) || 0;
            stats.files += 1;
            return name;
        };
        const stageFolder = async (folder, dir, depth) => {
            if (depth > 64) return;
            await this.checkpoint(op);
            const name = unique(dir, folder.name);
            const sub = path.join(dir, name);
            await fsp.mkdir(sub, { recursive: true });
            const files = await vfsDatabase.getUserFilesByLocation(folder.scope, folder.workspace_id, folder.id);
            for (const f of files) await linkFile(f, sub);
            const kids = await vfsDatabase.getFoldersByParent(folder.scope, folder.workspace_id, folder.id);
            for (const k of kids) await stageFolder(k, sub, depth + 1);
            return name;
        };
        for (const item of items || []) {
            const kind = item.targetKind;
            const id = String(item.targetId || item.id || '');
            if (kind === 'user-file' && !item.isUserFileLink) {
                const row = await vfsDatabase.getUserFileById(id);
                if (!row || row.trashed_at) continue;
                const name = await linkFile(row, stageRoot);
                if (name) stats.top.push(name);
            } else if (kind === 'vfs-folder' || (item.kind === 'folder' && !item.isShortcut && kind !== 'system-folder' && kind !== 'workspace')) {
                const folder = await vfsDatabase.getFolderById(id);
                if (!folder || folder.trashed_at) continue;
                const name = await stageFolder(folder, stageRoot, 0);
                if (name) stats.top.push(name);
            }
        }
        return stats;
    }

    compressionSwitches(p, type) {
        const sw = [];
        const level = Math.max(0, Math.min(9, Number.isFinite(Number(p.level)) ? Number(p.level) : 5));
        if (type !== 'tar' && type !== 'wim') sw.push(`-mx=${level}`);
        const methods = METHODS[type];
        const method = methods && methods.includes(p.method) ? p.method : null;
        if (method && level > 0) sw.push(type === 'zip' ? `-mm=${method}` : `-m0=${method}`);
        const lzma = !method || /^LZMA/.test(method);
        const dict = Number(p.dictionary);
        if (dict > 0 && level > 0 && (type === '7z' || type === 'xz' || (type === 'zip' && method && method !== 'Deflate' && method !== 'Deflate64'))) {
            sw.push(`-md=${Math.round(dict)}b`);
        }
        const word = Number(p.wordSize);
        if (word > 0 && level > 0) {
            if (method === 'PPMd') sw.push(type === 'zip' ? `-mo=${word}` : `-m0=PPMd:o=${word}`);
            else if (lzma || /^Deflate/.test(method || '')) sw.push(`-mfb=${word}`);
        }
        if (type === '7z' && p.solid) {
            if (p.solid === 'off') sw.push('-ms=off');
            else if (p.solid === 'on') sw.push('-ms=on');
            else if (/^\d+[kmgt]?$/i.test(String(p.solid))) sw.push(`-ms=${p.solid}`);
            else if (/^\d+f$/i.test(String(p.solid))) sw.push(`-ms=${p.solid}`);
        }
        const threads = Number(p.threads);
        if (threads > 0) sw.push(`-mmt=${Math.min(64, Math.round(threads))}`);
        if (/^\d{1,3}$/.test(String(p.memoryPercent || ''))) sw.push(`-mmemuse=p${p.memoryPercent}`);
        if (p.password && (type === '7z' || type === 'zip')) {
            sw.push(this.passwordArg(p.password));
            if (type === '7z' && p.encryptNames) sw.push('-mhe=on');
            if (type === 'zip' && p.encryptionMethod === 'AES-256') sw.push('-mem=AES256');
        }
        const vol = /^\s*(\d+(?:\.\d+)?)\s*([bkmgt])?/i.exec(String(p.volumes || ''));
        if (vol && Number(vol[1]) > 0) {
            const mult = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }[(vol[2] || 'b').toLowerCase()];
            sw.push(`-v${Math.max(1024, Math.round(Number(vol[1]) * mult))}b`);
        }
        for (const token of String(p.parameters || '').split(/\s+/).filter(Boolean).slice(0, 16)) {
            if (/^[A-Za-z0-9]+(=[A-Za-z0-9.:+\-]*)?$/.test(token)) sw.push(`-m${token}`);
            else throw new Error(`Unsupported parameter: ${token}`);
        }
        return sw;
    }

    async runCreate(op, p) {
        const type = CREATE_TYPES[p.format] || '7z';
        let archiveName = safeName(p.archiveName || '');
        if (!archiveName || archiveName === '_') throw new Error('Specify an archive name.');
        const targetLoc = await this.targetLocation(p.targetPath || p.sourcePath);
        const stage = await this.ensureDir(path.join(op.work, 'src'));
        let stageRoot = stage;
        // Full / Absolute pathnames: the items keep the folders above them (the address bar's names)
        if (p.pathMode === 'full' || p.pathMode === 'absolute') {
            const display = await this.vfs.getPathDisplayInfo(p.sourcePath || '/').catch(() => null);
            const segs = ((display && display.segments) || []).map((s) => safeName(s.label)).filter((s) => s && s !== 'Root');
            if (segs.length) stageRoot = await this.ensureDir(path.join(stage, ...segs));
        }
        op.stats.status = 'Scanning';
        this.emit(op, {}, true);
        const staged = await this.stageItems(op, p.items, stageRoot);
        if (!staged.top.length) throw new Error('There are no files to add.');
        if (SINGLE_FILE_TYPES.has(p.format) && (staged.files !== 1 || staged.top.length !== 1 || !fs.statSync(path.join(stageRoot, staged.top[0])).isFile())) {
            throw new Error(`The ${p.format} format can hold one file only.`);
        }
        op.stats.total = staged.total;
        op.stats.filesTotal = staged.files;
        const outDir = await this.ensureDir(path.join(op.work, 'out'));
        const outPath = path.join(outDir, archiveName);
        // Add and replace / Update / Freshen / Synchronize work on an archive of that name already there
        const existing = (await this.childFiles(targetLoc)).find((f) => String(f.original_name).toLowerCase() === archiveName.toLowerCase());
        const mode = UPDATE_SWITCHES[p.updateMode] ? p.updateMode : 'add';
        if (existing) {
            archiveName = existing.original_name;
            await fsp.copyFile(this.vfs.getFileBlobPath(existing.content_hash), outPath);
            if (p.password) this.rememberPassword(existing.content_hash, p.password);
        }
        const topNames = p.pathMode === 'full' || p.pathMode === 'absolute'
            ? [path.relative(stage, stageRoot).split(path.sep)[0] || staged.top[0]]
            : staged.top;
        const cmd = mode === 'add' ? 'a' : 'u';
        const args = [cmd, `-t${type}`, ...this.compressionSwitches(p, type), '-bso0', '-bse2', '-bsp1', '-spd'];
        if (mode !== 'add') args.push(`-u${UPDATE_SWITCHES[mode]}`);
        args.push('--', outPath, ...topNames);
        op.stats.status = existing ? 'Updating' : 'Adding';
        this.emit(op, {}, true);
        const poll = setInterval(async () => {
            try {
                let size = 0;
                for (const n of await fsp.readdir(outDir)) size += (await fsp.stat(path.join(outDir, n))).size;
                op.stats.packed = size;
            } catch (_) { /* written as we look */ }
        }, 500);
        try {
            await this.runOp7z(op, args, { cwd: p.pathMode === 'full' || p.pathMode === 'absolute' ? stage : stageRoot, total: staged.total });
        } finally {
            clearInterval(poll);
        }
        op.stats.status = 'Adding';
        const outputs = (await fsp.readdir(outDir)).sort();
        const stored = [];
        let packed = 0;
        for (const n of outputs) {
            await this.checkpoint(op);
            const full = path.join(outDir, n);
            const st = await fsp.stat(full);
            packed += st.size;
            const row = await this.vfs.saveUserFileFromPath(full, {
                originalName: n,
                mimeType: mimeForName(n),
                scope: targetLoc.scope,
                workspaceId: targetLoc.workspaceId,
                folderId: targetLoc.folderId,
                overwrite: true
            });
            await this.recordReplication(row, targetLoc);
            stored.push({ id: row.id, name: row.original_name });
        }
        op.stats.packed = packed;
        op.stats.processed = staged.total;
        op.stats.files = staged.files;
        if (p.password && stored.length) {
            const first = await vfsDatabase.getUserFileById(stored[0].id);
            if (first) this.rememberPassword(first.content_hash, p.password);
        }
        if (p.deleteAfter && Array.isArray(p.items) && p.items.length && !op.stats.errors) {
            try {
                await this.vfs.moveItemsToTrash(p.items, p.sourcePath);
            } catch (err) {
                op.messages.push(`Cannot delete the files: ${err.message}`);
                op.stats.errors += 1;
            }
        }
        this.emit(op, {}, true);
        this.vfsUpdated(op, targetLoc.path);
        return { targetPath: targetLoc.path, stored };
    }

    /** CRC SHA: checksums of VFS files (folders: every file inside). */
    async runHash(op, p) {
        const method = HASH_METHODS[p.method] || 'CRC32';
        const stage = await this.ensureDir(path.join(op.work, 'src'));
        op.stats.status = 'Checksum calculation';
        const staged = await this.stageItems(op, p.items, stage);
        if (!staged.top.length) throw new Error('There are no files.');
        op.stats.total = staged.total;
        op.stats.filesTotal = staged.files;
        const r = await this.run7z(['h', `-scrc${method}`, '-bse2', '-spd', '--', ...staged.top], {
            cwd: stage,
            onSpawn: (child) => { op.child = child; }
        });
        op.child = null;
        if (op.cancelled) throw archiveError('CANCELLED', 'Operation was cancelled');
        if (r.code > 1) throw new Error(r.stderr.trim().split(/\r?\n/).pop() || 'Checksum calculation failed');
        const rows = this.parseHashTable(r.stdout);
        op.stats.processed = staged.total;
        op.stats.files = staged.files;
        const lines = [];
        const fileRows = rows.files.filter((row) => Object.values(row.hashes).some(Boolean));
        if (fileRows.length === 1 && staged.files === 1) {
            const row = fileRows[0];
            lines.push(`Name: ${row.name}`, `Size: ${sizeText(row.size)}`);
            for (const [k, v] of Object.entries(row.hashes)) lines.push(`${k}: ${v}`);
        } else {
            for (const row of fileRows) {
                lines.push(row.name);
                for (const [k, v] of Object.entries(row.hashes)) lines.push(`    ${k}: ${v}`);
            }
            lines.push('', `Files: ${staged.files}`, `Size: ${sizeText(staged.total)}`);
            for (const [k, v] of Object.entries(rows.summary)) lines.push(`${k} for data: ${v}`);
            for (const [k, v] of Object.entries(rows.summaryNames)) lines.push(`${k} for data and names: ${v}`);
        }
        op.messages.push(...lines);
        return { method, lines };
    }

    /** 7z h's table: the dashed line gives the columns. */
    parseHashTable(stdout) {
        const lines = String(stdout || '').split(/\r?\n/);
        const dashAt = lines.findIndex((l) => /^-+( +-+)+\s*$/.test(l));
        const result = { files: [], summary: {}, summaryNames: {} };
        if (dashAt < 1) return result;
        const header = lines[dashAt - 1];
        const cols = [];
        const re = /-+/g;
        let m;
        while ((m = re.exec(lines[dashAt]))) cols.push({ start: m.index, end: m.index + m[0].length });
        const names = cols.map((c, i) => header.slice(c.start, i + 1 < cols.length ? cols[i + 1].start : undefined).trim());
        const nameCol = names.length - 1;
        const sizeCol = names.indexOf('Size');
        const slice = (line, i) => line.slice(cols[i].start, i + 1 < cols.length ? cols[i + 1].start : undefined).trim();
        for (let i = dashAt + 1; i < lines.length; i++) {
            const line = lines[i];
            if (/^-+( +-+)+\s*$/.test(line)) break;
            if (!line.trim()) continue;
            const hashes = {};
            names.forEach((n, ci) => { if (ci !== nameCol && ci !== sizeCol) hashes[n] = slice(line, ci); });
            result.files.push({ name: line.slice(cols[nameCol].start).trim(), size: Number(slice(line, sizeCol)) || 0, hashes });
        }
        for (const line of lines) {
            const a = /^(\S+) for data:\s+(\S+)/.exec(line);
            if (a) result.summary[a[1]] = a[2];
            const b = /^(\S+) for data and names:\s+(\S+)/.exec(line);
            if (b) result.summaryNames[b[1]] = b[2];
        }
        return result;
    }

    /** Extract and download: one file as itself, several packed into a .zip. */
    async runPack(op, p) {
        const file = await this.getFile(p.fileId);
        const info = await this.getInfo(file, p.password || undefined);
        const nodes = this.selectEntries(info, p.entries) || [...info.root.children.values()];
        const base = cleanEntryPath(p.base || '');
        const { out } = await this.extractToWork(op, file, info, nodes, { password: p.password, weight: 0.85 });
        const srcDir = base ? path.join(out, ...base.split('/')) : out;
        op.keepWork = true;
        if (nodes.length === 1 && !nodes[0].isDir) {
            const filePath = path.join(srcDir, nodes[0].name);
            const st = await fsp.lstat(filePath);
            if (!st.isFile()) throw new Error('Cannot download this item.');
            op.stats.processed = op.stats.total;
            return { downloadUrl: this.registerDownload(filePath, nodes[0].name, op.work), name: nodes[0].name };
        }
        const stem = String(file.original_name || 'archive').replace(/(\.tar)?\.[^.]+$/i, '') || 'archive';
        const zipName = nodes.length === 1 ? `${nodes[0].name}.zip` : `${stem}.zip`;
        const zipPath = path.join(op.work, zipName);
        op.stats.status = 'Adding';
        await this.runOp7z(op, ['a', '-tzip', '-mx=1', '-bso0', '-bse2', '-bsp1', '-spd', '-snl', '--', zipPath, ...nodes.map((n) => n.name)], {
            cwd: srcDir, base: op.stats.total * 0.85, weight: 0.15, total: op.stats.total
        });
        op.stats.processed = op.stats.total;
        return { downloadUrl: this.registerDownload(zipPath, zipName, op.work), name: zipName };
    }
}

/**
 * HTTP: one entry streamed (image previews, Open, a single-file download) and a packed download.
 * Same access rule as /<vfs>/files/:fileId (vfsDatabase.canSessionAccessVfsFile).
 */
function registerArchiveRoutes(app, { vfsPath, authMiddleware, globalResources, buildVfsSession, workspaceExists }) {
    const archive = () => globalResources.getVfsManager().getArchive();
    app.get(`${vfsPath}/archive/:fileId/entry`, authMiddleware, async (req, res) => {
        try {
            const file = await vfsDatabase.getUserFileById(req.params.fileId);
            if (!file || file.trashed_at) return res.status(404).send('Not found');
            if (!vfsDatabase.canSessionAccessVfsFile(buildVfsSession(req), file, { workspaceExists })) {
                return res.status(403).send('Access denied');
            }
            await archive().streamEntry(req, res, file, String(req.query.path || ''), { inline: req.query.inline === '1' });
        } catch (e) {
            if (!res.headersSent) res.status(e.code === 'PASSWORD' ? 403 : 500).send(e.message);
        }
    });
    app.get(`${vfsPath}/archive-download/:token`, authMiddleware, async (req, res) => {
        try {
            await archive().sendDownload(req, res, String(req.params.token || ''));
        } catch (e) {
            if (!res.headersSent) res.status(500).send(e.message);
        }
    });
}

module.exports = {
    VfsArchive,
    registerArchiveRoutes,
    SEGMENT,
    _test: { parseTechnicalListing, autoRename, cleanEntryPath, classifyError, sizeText, extOf }
};
