/**
 * Replication tar cargo — pack, stream, and extract for tape-stream / compressed / blocks modes.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable, PassThrough, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');
const { REPLICATION_TAR_ENTRIES, REPLICATION_TRANSFER_MODES, BLOCKS_SLOW_PATH_CONFIRMATION } = require('./replication/replicationContracts');

const TAR_BLOCK = 512;

const PEER_FRAME = Object.freeze({
    TAR_BEGIN: 'REPL_TAR_BEGIN',
    TAR_END: 'REPL_TAR_END',
    BLOCK_FILE: 'REPL_BLOCK_FILE',
    BLOCK_END: 'REPL_BLOCK_END',
    MAINT_ACK: 'REPL_MAINT_ACK'
});

function isTransferMode(value) {
    return REPLICATION_TRANSFER_MODES.includes(value);
}

function normalizeTarPath(entryPath) {
    let p = String(entryPath || '').replace(/\\/g, '/');
    if (!p.startsWith('/')) p = `/${p}`;
    return p.replace(/\/+/g, '/');
}

function padTarName(name) {
    const buf = Buffer.alloc(100, 0);
    const bytes = Buffer.from(name.slice(0, 99), 'utf8');
    bytes.copy(buf);
    return buf;
}

function writeTarHeader(name, size, typeflag = '0') {
    const header = Buffer.alloc(TAR_BLOCK, 0);
    padTarName(normalizeTarPath(name)).copy(header, 0);
    Buffer.from(String(size).padStart(11, '0'), 'utf8').copy(header, 124);
    Buffer.from('0000000', 'utf8').copy(header, 136);
    Buffer.from('0000000', 'utf8').copy(header, 148);
    Buffer.from('        ', 'utf8').copy(header, 148 + 8);
    header[156] = typeflag.charCodeAt(0);
    Buffer.from('ustar\x00', 'utf8').copy(header, 257);
    Buffer.from('00', 'utf8').copy(header, 263);
    let sum = 0;
    for (let i = 0; i < TAR_BLOCK; i++) sum += header[i];
    Buffer.from(String(sum).padStart(6, '0') + '\0 ', 'utf8').copy(header, 148);
    return header;
}

function computeTarChecksum(header) {
    let sum = 0;
    for (let i = 0; i < TAR_BLOCK; i++) sum += header[i];
    return sum;
}

function parseTarHeader(buf) {
    if (!buf || buf.length < TAR_BLOCK) return null;
    const allZero = buf.every((b) => b === 0);
    if (allZero) return { end: true };
    const name = buf.slice(0, 100).toString('utf8').replace(/\0.*$/, '').trim();
    const sizeOct = buf.slice(124, 136).toString('utf8').replace(/\0/g, '').trim();
    const size = parseInt(sizeOct, 8) || 0;
    const typeflag = String.fromCharCode(buf[156] || 0x30);
    return {
        end: false,
        name: normalizeTarPath(name),
        size,
        typeflag
    };
}

async function sha256Buffer(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

async function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const rs = fs.createReadStream(filePath);
        rs.on('data', (chunk) => hash.update(chunk));
        rs.on('error', reject);
        rs.on('end', () => resolve(hash.digest('hex')));
    });
}

async function sha256Stream(readable) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        readable.on('data', (chunk) => hash.update(chunk));
        readable.on('error', reject);
        readable.on('end', () => resolve(hash.digest('hex')));
    });
}

function getContentTypeForMode(transferMode) {
    if (transferMode === 'tape-stream-compressed') {
        return 'application/zstd';
    }
    if (transferMode === 'blocks') {
        return 'application/json';
    }
    return 'application/x-tar';
}

function createCompressTransform(transferMode) {
    if (transferMode !== 'tape-stream-compressed') {
        return new PassThrough();
    }
    const zstd = spawn('zstd', ['-c', '-T0', '-3'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const out = new PassThrough();
    zstd.stdout.pipe(out);
    zstd.on('error', (err) => out.destroy(err));
    zstd.stdin.on('error', () => {});
    return {
        writable: zstd.stdin,
        readable: out,
        process: zstd
    };
}

function createDecompressTransform(transferMode) {
    if (transferMode !== 'tape-stream-compressed') {
        return new PassThrough();
    }
    const zstd = spawn('zstd', ['-d', '-c'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const out = new PassThrough();
    zstd.stdout.pipe(out);
    zstd.on('error', (err) => out.destroy(err));
    zstd.stdin.on('error', () => {});
    return {
        writable: zstd.stdin,
        readable: out,
        process: zstd
    };
}

class TarEntryWriter {
    constructor() {
        this._chunks = [];
    }

    addBuffer(entryPath, buffer) {
        const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
        const header = writeTarHeader(entryPath, data.length);
        this._chunks.push(header, data);
        const pad = TAR_BLOCK - (data.length % TAR_BLOCK);
        if (pad < TAR_BLOCK) {
            this._chunks.push(Buffer.alloc(pad, 0));
        }
    }

    async addFile(entryPath, filePath) {
        const st = await fs.promises.stat(filePath);
        const header = writeTarHeader(entryPath, st.size);
        this._chunks.push(header);
        const data = await fs.promises.readFile(filePath);
        this._chunks.push(data);
        const pad = TAR_BLOCK - (data.length % TAR_BLOCK);
        if (pad < TAR_BLOCK) {
            this._chunks.push(Buffer.alloc(pad, 0));
        }
        return { bytes: st.size, sha256: await sha256Buffer(data) };
    }

    finish() {
        this._chunks.push(Buffer.alloc(TAR_BLOCK * 2, 0));
        return Buffer.concat(this._chunks);
    }

    createReadable() {
        const chunks = [...this._chunks, Buffer.alloc(TAR_BLOCK * 2, 0)];
        let idx = 0;
        return new Readable({
            read() {
                if (idx >= chunks.length) {
                    this.push(null);
                    return;
                }
                this.push(chunks[idx++]);
            }
        });
    }
}

async function packCargoEntries({ rootDir, manifest, changelogSql, fileEntries, onProgress }) {
    const writer = new TarEntryWriter();
    const manifestJson = JSON.stringify(manifest, null, 2);
    writer.addBuffer(REPLICATION_TAR_ENTRIES.MANIFEST, manifestJson);

    const sqlText = changelogSql || '-- no changelog rows\n';
    writer.addBuffer(REPLICATION_TAR_ENTRIES.CHANGELOG_SQL, sqlText);

    const manifestEntries = [];
    let current = 0;
    const total = fileEntries.length;

    for (const entry of fileEntries) {
        const rel = entry.tarPath || entry.path;
        const abs = path.join(rootDir, entry.path);
        if (!fs.existsSync(abs)) {
            if (onProgress) {
                onProgress({ phase: 'pack', current, total, path: rel, skipped: true });
            }
            current++;
            continue;
        }
        const meta = await writer.addFile(rel, abs);
        manifestEntries.push({
            path: rel,
            sourcePath: entry.path,
            bytes: meta.bytes,
            sha256: meta.sha256
        });
        current++;
        if (onProgress) {
            onProgress({ phase: 'pack', current, total, path: rel });
        }
    }

    manifest.entries = manifestEntries;
    manifest.totalBytes = manifestEntries.reduce((s, e) => s + (e.bytes || 0), 0);
    manifest.updatedAt = new Date().toISOString();

    const finalWriter = new TarEntryWriter();
    finalWriter.addBuffer(REPLICATION_TAR_ENTRIES.MANIFEST, JSON.stringify(manifest, null, 2));
    finalWriter.addBuffer(REPLICATION_TAR_ENTRIES.CHANGELOG_SQL, sqlText);
    for (const entry of manifestEntries) {
        const abs = path.join(rootDir, entry.sourcePath);
        await finalWriter.addFile(entry.path, abs);
    }
    return { manifest, tarReadable: finalWriter.createReadable() };
}

function createPackedStream(tarReadable, transferMode) {
    if (transferMode === 'blocks') {
        throw new Error('Use packBlocksCargo for blocks transfer mode');
    }
    if (transferMode === 'tape-stream-compressed') {
        const compress = createCompressTransform(transferMode);
        tarReadable.pipe(compress.writable);
        return compress.readable;
    }
    return tarReadable;
}

async function extractTarBuffer(tarBuffer, { destRoot, onEntry, onProgress } = {}) {
    let offset = 0;
    const entries = [];
    let entryIndex = 0;

    while (offset + TAR_BLOCK <= tarBuffer.length) {
        const headerBuf = tarBuffer.slice(offset, offset + TAR_BLOCK);
        const header = parseTarHeader(headerBuf);
        offset += TAR_BLOCK;
        if (!header || header.end) break;

        const dataEnd = offset + header.size;
        const fileData = tarBuffer.slice(offset, dataEnd);
        offset = dataEnd + (TAR_BLOCK - (header.size % TAR_BLOCK)) % TAR_BLOCK;

        if (header.typeflag !== '0' && header.typeflag !== '\0') continue;

        entries.push({ path: header.name, size: header.size });

        if (onEntry) {
            await onEntry(header.name, fileData);
        }

        if (destRoot && header.name !== REPLICATION_TAR_ENTRIES.MANIFEST && header.name !== REPLICATION_TAR_ENTRIES.CHANGELOG_SQL) {
            const rel = header.name.replace(/^\//, '');
            const outPath = path.join(destRoot, rel);
            await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
            await fs.promises.writeFile(outPath, fileData);
        }

        entryIndex++;
        if (onProgress) {
            onProgress({ phase: 'extract', current: entryIndex, total: null, path: header.name });
        }
    }

    return entries;
}

class TarExtractStream extends Transform {
    constructor(options = {}) {
        super();
        this._buffer = Buffer.alloc(0);
        this._destRoot = options.destRoot || null;
        this._onEntry = options.onEntry || null;
        this._onProgress = options.onProgress || null;
        this._pendingHeader = null;
        this._pendingRemaining = 0;
        this._entryIndex = 0;
        this._manifest = null;
        this._changelogSql = '';
    }

    getManifest() {
        return this._manifest;
    }

    getChangelogSql() {
        return this._changelogSql;
    }

    async _handleEntry(name, data) {
        if (name === REPLICATION_TAR_ENTRIES.MANIFEST) {
            try {
                this._manifest = JSON.parse(data.toString('utf8'));
            } catch (_e) {
                this._manifest = null;
            }
        } else if (name === REPLICATION_TAR_ENTRIES.CHANGELOG_SQL) {
            this._changelogSql = data.toString('utf8');
        }

        if (this._onEntry) {
            await this._onEntry(name, data);
        }

        if (this._destRoot && name !== REPLICATION_TAR_ENTRIES.MANIFEST && name !== REPLICATION_TAR_ENTRIES.CHANGELOG_SQL) {
            const rel = name.replace(/^\//, '');
            const outPath = path.join(this._destRoot, rel);
            await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
            await fs.promises.writeFile(outPath, data);
        }

        this._entryIndex++;
        if (this._onProgress) {
            this._onProgress({ phase: 'extract', current: this._entryIndex, total: null, path: name });
        }
    }

    async _transformBuffer() {
        while (true) {
            if (this._pendingHeader) {
                if (this._buffer.length < this._pendingRemaining) return;
                const data = this._buffer.slice(0, this._pendingRemaining);
                this._buffer = this._buffer.slice(this._pendingRemaining);
                const pad = (TAR_BLOCK - (this._pendingHeader.size % TAR_BLOCK)) % TAR_BLOCK;
                if (this._buffer.length < pad) return;
                this._buffer = this._buffer.slice(pad);
                const header = this._pendingHeader;
                this._pendingHeader = null;
                this._pendingRemaining = 0;
                await this._handleEntry(header.name, data);
                continue;
            }

            if (this._buffer.length < TAR_BLOCK) return;
            const headerBuf = this._buffer.slice(0, TAR_BLOCK);
            this._buffer = this._buffer.slice(TAR_BLOCK);
            const header = parseTarHeader(headerBuf);
            if (!header || header.end) {
                this._buffer = Buffer.alloc(0);
                return;
            }
            this._pendingHeader = header;
            this._pendingRemaining = header.size;
        }
    }

    _transform(chunk, _enc, cb) {
        this._buffer = Buffer.concat([this._buffer, chunk]);
        this._transformBuffer()
            .then(() => cb())
            .catch((err) => cb(err));
    }

    _flush(cb) {
        this._transformBuffer()
            .then(() => cb())
            .catch((err) => cb(err));
    }
}

async function extractCargoFromStream(sourceStream, { transferMode, destRoot, onProgress, onEntry, bytesToSkip = 0 } = {}) {
    let input = sourceStream;
    if (bytesToSkip > 0 && transferMode !== 'tape-stream-compressed') {
        let skipped = 0;
        input = sourceStream.pipe(new Transform({
            transform(chunk, _enc, cb) {
                if (skipped >= bytesToSkip) {
                    this.push(chunk);
                    return cb();
                }
                const remain = bytesToSkip - skipped;
                if (chunk.length <= remain) {
                    skipped += chunk.length;
                    return cb();
                }
                skipped += remain;
                this.push(chunk.slice(remain));
                cb();
            }
        }));
    }

    if (transferMode === 'tape-stream-compressed') {
        const decompress = createDecompressTransform(transferMode);
        input.pipe(decompress.writable);
        input = decompress.readable;
    }

    const extractor = new TarExtractStream({ destRoot, onProgress, onEntry });
    await pipeline(input, extractor);
    return {
        manifest: extractor.getManifest(),
        changelogSql: extractor.getChangelogSql()
    };
}

async function extractCargoFromFile(filePath, options = {}) {
    const st = await fs.promises.stat(filePath);
    const rs = fs.createReadStream(filePath);
    return extractCargoFromStream(rs, { ...options, bytesToSkip: options.bytesToSkip || 0 });
}

async function packBlocksCargo({ rootDir, manifest, changelogSql, fileEntries, onProgress }) {
    const blocks = [];
    const manifestEntries = [];
    let current = 0;
    const total = fileEntries.length;

    for (const entry of fileEntries) {
        const rel = entry.tarPath || entry.path;
        const abs = path.join(rootDir, entry.path);
        if (!fs.existsSync(abs)) {
            current++;
            if (onProgress) onProgress({ phase: 'pack', current, total, path: rel, skipped: true });
            continue;
        }
        const data = await fs.promises.readFile(abs);
        const sha256 = await sha256Buffer(data);
        blocks.push({
            type: PEER_FRAME.BLOCK_FILE,
            path: rel,
            bytes: data.length,
            sha256,
            dataBase64: data.toString('base64')
        });
        manifestEntries.push({ path: rel, sourcePath: entry.path, bytes: data.length, sha256 });
        current++;
        if (onProgress) onProgress({ phase: 'pack', current, total, path: rel });
    }

    manifest.entries = manifestEntries;
    manifest.totalBytes = manifestEntries.reduce((s, e) => s + (e.bytes || 0), 0);
    manifest.updatedAt = new Date().toISOString();

    return {
        manifest,
        blocks,
        endFrame: { type: PEER_FRAME.BLOCK_END, manifestId: manifest.manifestId, entryCount: blocks.length }
    };
}

function encodePeerFrame(obj) {
    return `${JSON.stringify(obj)}\n`;
}

module.exports = {
    BLOCKS_SLOW_PATH_CONFIRMATION,
    PEER_FRAME,
    TAR_BLOCK,
    isTransferMode,
    normalizeTarPath,
    getContentTypeForMode,
    createCompressTransform,
    createDecompressTransform,
    packCargoEntries,
    createPackedStream,
    extractTarBuffer,
    extractCargoFromStream,
    extractCargoFromFile,
    packBlocksCargo,
    encodePeerFrame,
    sha256File,
    sha256Stream,
    sha256Buffer,
    TarEntryWriter,
    TarExtractStream
};
