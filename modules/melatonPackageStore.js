/**
 * Melaton package store — install .mapz / .msaz into .cache/packages, and unpack a .msaz to run it
 * from the VFS (.cache/packages/.run/<sha256>/, Yozora #638).
 * Contract: docs/client-api/melaton-packages.md, apps: docs/client-api/melaton-apps.md
 * WS: modules/ws/handlers/240-melatonPackageHandler.js, 245-melatonAppsHandler.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { packageZipFromExe } = require('./melatonApps/exeContainer');

const INDEX_VERSION = 1;
const MAX_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_FILES = 400;
const ID_RE = /^[a-z][a-z0-9-]{1,62}$/;
const LAUNCH_ID_RE = /^[a-z][a-z0-9-]{1,62}$/;
const PACKET_SUFFIX_RE = /^[a-z][a-z0-9_]*$/;

const SURFACES = new Set(['controlPanel', 'launcher', 'domain', 'shortcut']);
const START_MENU_LOCATIONS = new Set(['all-apps', 'tools']);
const FORMATS = new Set(['mapz', 'msaz']);
const TYPES = new Set(['dsap', 'native']);
const LOAD_MODES = new Set(['onDemand', 'startup']);
// server halves run in their own sandboxed process (modules/melatonApps/runner.js): one per launch
// ('session', ended on close) or one per package that outlives its windows ('service')
const RUNNERS = new Set(['session', 'service']);
const MAX_OPENS = 32;
const RUN_DIR = '.run';
const DATA_DIR = '.data';

/** Builtin Start / VFS launchIds — install must not steal these. */
const RESERVED_LAUNCH_IDS = new Set([
    'workspace', 'studio', 'spellbook', 'reference', 'bracket-generation',
    'encyclopedia', 'alchemy', 'naxt', 'notebook', 'chat', 'chat-persona', 'explorer',
    'run', 'import', 'presets', 'expanders', 'memories', 'config-editor',
    'character-db', 'event-viewer', 'explore-gallery', 'dynamic-quips',
    'novels', 'security-center', 'data-management', 'autofill-ranking',
    'ispy', 'menma', 'pantry', 'wiki-manager', 'zanzou', 'control-panel', 'keychain',
    'nax-vibes', 'favorites', 'desktop-settings'
]);

/** Builtin DSAP hosts (no scheme). */
const RESERVED_DSAP_HOSTS = new Set([
    'dreamscape.jp', 'www.dreamscape.jp', 'dyna.dreamscape.jp',
    'quips.dyna.dreamscape.jp', 'memories.dyna.dreamscape.jp',
    'xi.dyna.dreamscape.jp', 'novels.dyna.dreamscape.jp',
    'security.dreamscape.jp', 'security.dyna.dreamscape.jp',
    'data.dreamscape.jp', 'autofill.dreamscape.jp',
    'ispy.dreamscape.jp', 'omegasearch.dyna.dreamscape.jp',
    'explore.novelai.net', 'pantry.dyna.dreamscape.jp', 'menma.dyna.dreamscape.jp',
    'pantry.nyti.ne.jp',
    'wiki.dyna.dreamscape.jp', 'mcp.dreamscape.jp',
    'zanzou.dyna.dreamscape.jp', 'similar.dyna.dreamscape.jp',
    'review.dyna.dreamscape.jp', 'vibes.novelai.net',
    'en.grimoire.jp',
    'exchange.dreamscape.jp'
]);

class MelatonPackageError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'MelatonPackageError';
        this.code = code || 'PACKAGE_INVALID';
    }
}

function normalizeDsapHost(url) {
    let raw = String(url || '').trim().toLowerCase();
    raw = raw.replace(/^(edtx|rdf|dsap):\/\//, '');
    raw = raw.replace(/^\/+/, '').split('/')[0].split('?')[0];
    return raw;
}

function assertSafeRelPath(rel) {
    const n = String(rel || '').replace(/\\/g, '/');
    if (!n || n.includes('\0') || n.startsWith('/') || n.split('/').some((p) => p === '..' || p === '')) {
        throw new MelatonPackageError(`Unsafe zip path: ${rel}`, 'PACKAGE_PATH');
    }
    return n;
}

function readJsonFile(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonAtomic(filePath, value) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, filePath);
}

function rmrf(target) {
    fs.rmSync(target, { recursive: true, force: true });
}

function validateManifest(raw, options) {
    const opts = options || {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new MelatonPackageError('manifest.json must be an object', 'PACKAGE_MANIFEST');
    }

    const id = String(raw.id || '').trim();
    if (!ID_RE.test(id)) {
        throw new MelatonPackageError('manifest.id must match [a-z][a-z0-9-]{1,62}', 'PACKAGE_ID');
    }

    const version = String(raw.version || '').trim();
    if (!version || version.length > 64) {
        throw new MelatonPackageError('manifest.version is required (max 64)', 'PACKAGE_VERSION');
    }

    const title = String(raw.title || '').trim();
    if (!title || title.length > 80) {
        throw new MelatonPackageError('manifest.title is required (max 80)', 'PACKAGE_TITLE');
    }

    const launchId = String(raw.launchId || (raw.format === 'msaz' ? id : '')).trim();
    if (!LAUNCH_ID_RE.test(launchId)) {
        throw new MelatonPackageError('manifest.launchId must match [a-z][a-z0-9-]{1,62}', 'PACKAGE_LAUNCH_ID');
    }
    if (RESERVED_LAUNCH_IDS.has(launchId) && opts.allowReservedLaunchId !== launchId) {
        throw new MelatonPackageError(`launchId is reserved: ${launchId}`, 'PACKAGE_LAUNCH_RESERVED');
    }

    const format = String(raw.format || '').trim();
    if (!FORMATS.has(format)) {
        throw new MelatonPackageError('manifest.format must be mapz or msaz', 'PACKAGE_FORMAT');
    }
    if (opts.expectedFormat && opts.expectedFormat !== format) {
        throw new MelatonPackageError(
            `Archive extension ${opts.expectedFormat} does not match manifest.format ${format}`,
            'PACKAGE_FORMAT_MISMATCH'
        );
    }

    const type = String(raw.type || '').trim();
    if (!TYPES.has(type)) {
        throw new MelatonPackageError('manifest.type is required: dsap or native', 'PACKAGE_TYPE');
    }

    const cssPolicy = raw.cssPolicy == null || raw.cssPolicy === ''
        ? 'locked'
        : String(raw.cssPolicy).trim();
    if (cssPolicy !== 'locked') {
        throw new MelatonPackageError('cssPolicy must be locked until the store is opened', 'PACKAGE_CSS_POLICY');
    }

    const client = raw.client && typeof raw.client === 'object' ? raw.client : {};
    // Package CSS stays locked for uploaded / third-party packages (#179). A system package (one we
    // ship in apps/, installed with trusted: true) may declare its own stylesheets (#642).
    let clientStyles = [];
    if (client.styles != null) {
        if (!opts.trusted) {
            throw new MelatonPackageError('client.styles is only allowed for system packages', 'PACKAGE_CSS');
        }
        const list = Array.isArray(client.styles) ? client.styles : [client.styles];
        if (list.length > 16) throw new MelatonPackageError('too many client.styles', 'PACKAGE_CSS');
        clientStyles = list.map((rel) => {
            const r = assertSafeRelPath(String(rel).trim());
            if (!/\.css$/i.test(r)) throw new MelatonPackageError(`client.styles must be .css: ${r}`, 'PACKAGE_CSS');
            return r;
        });
    }
    const clientEntry = String(client.entry || 'client/index.js').trim();
    const clientHtml = String(client.html || 'client/index.html').trim();
    assertSafeRelPath(clientEntry);
    assertSafeRelPath(clientHtml);

    const load = raw.load == null || raw.load === ''
        ? 'onDemand'
        : String(raw.load).trim();
    if (!LOAD_MODES.has(load)) {
        throw new MelatonPackageError('manifest.load must be onDemand or startup', 'PACKAGE_LOAD');
    }

    let url = '';
    let aliases = [];
    let surfaces = [];
    if (type === 'dsap') {
        url = normalizeDsapHost(raw.url);
        if (!url) {
            throw new MelatonPackageError('type dsap requires manifest.url', 'PACKAGE_URL');
        }
        if (RESERVED_DSAP_HOSTS.has(url)) {
            throw new MelatonPackageError(`DSAP host is reserved: ${url}`, 'PACKAGE_URL_RESERVED');
        }
        aliases = Array.isArray(raw.aliases)
            ? raw.aliases.map((a) => String(a || '').trim()).filter(Boolean).slice(0, 24)
            : [];
        surfaces = Array.isArray(raw.surfaces)
            ? raw.surfaces.map((s) => String(s || '').trim()).filter(Boolean)
            : [];
        for (const surface of surfaces) {
            if (!SURFACES.has(surface)) {
                throw new MelatonPackageError(`Unknown surface: ${surface}`, 'PACKAGE_SURFACE');
            }
        }
    } else if (raw.surfaces && raw.surfaces.length) {
        throw new MelatonPackageError('type native cannot declare DSAP surfaces', 'PACKAGE_SURFACE');
    }

    let startMenuLocation = 'all-apps';
    if (raw.startMenuLocation != null && raw.startMenuLocation !== '') {
        startMenuLocation = String(raw.startMenuLocation).trim();
        if (!START_MENU_LOCATIONS.has(startMenuLocation)) {
            throw new MelatonPackageError('startMenuLocation must be all-apps or tools', 'PACKAGE_MENU');
        }
    }

    const server = raw.server && typeof raw.server === 'object' ? raw.server : null;
    let serverEntry = '';
    let serverPackets = [];
    let serverRunner = '';
    let serverMemoryMB = 0;
    // a runner server half (every .msaz; a .mapz that names server.runner) instead of v1 packets
    const runnerMode = !!server && (format === 'msaz' || server.runner != null);
    if (server && runnerMode) {
        serverEntry = String(server.entry || '').trim();
        if (!serverEntry) throw new MelatonPackageError('server.entry is required with a server half', 'PACKAGE_SERVER');
        assertSafeRelPath(serverEntry);
        serverRunner = String(server.runner || 'session').trim();
        if (!RUNNERS.has(serverRunner)) {
            throw new MelatonPackageError('server.runner must be session or service', 'PACKAGE_RUNNER');
        }
        if (server.packets != null) {
            throw new MelatonPackageError('server.packets belongs to v1 packages; a runner talks over app_message', 'PACKAGE_PACKETS');
        }
        if (server.memoryMB != null) {
            serverMemoryMB = Math.round(Number(server.memoryMB));
            if (!Number.isFinite(serverMemoryMB) || serverMemoryMB < 16 || serverMemoryMB > 512) {
                throw new MelatonPackageError('server.memoryMB must be 16..512', 'PACKAGE_MEMORY');
            }
        }
    } else if (server) {
        if (server.entry) {
            serverEntry = String(server.entry).trim();
            assertSafeRelPath(serverEntry);
        }
        if (Array.isArray(server.packets)) {
            serverPackets = server.packets.map((p) => String(p || '').trim()).filter(Boolean);
        }
        if (serverEntry && !serverPackets.length) {
            throw new MelatonPackageError('server.entry requires server.packets[]', 'PACKAGE_PACKETS');
        }
        const prefix = `pkg.${id}.`;
        const reservedPackets = new Set(opts.reservedPacketTypes || []);
        for (const packet of serverPackets) {
            if (!packet.startsWith(prefix)) {
                throw new MelatonPackageError(
                    `server.packets must be prefixed ${prefix}: ${packet}`,
                    'PACKAGE_PACKET_PREFIX'
                );
            }
            const suffix = packet.slice(prefix.length);
            if (!PACKET_SUFFIX_RE.test(suffix)) {
                throw new MelatonPackageError(`Invalid packet name: ${packet}`, 'PACKAGE_PACKET');
            }
            if (reservedPackets.has(packet)) {
                throw new MelatonPackageError(`Packet already registered: ${packet}`, 'PACKAGE_PACKET_COLLISION');
            }
        }
    }

    return {
        id,
        version,
        title,
        launchId,
        format,
        type,
        cssPolicy,
        url,
        aliases,
        surfaces,
        startMenuLocation,
        client: Object.assign({ entry: clientEntry, html: clientHtml }, clientStyles.length ? { styles: clientStyles } : {}),
        server: !serverEntry ? null : (runnerMode
            ? Object.assign({ entry: serverEntry, runner: serverRunner }, serverMemoryMB ? { memoryMB: serverMemoryMB } : {})
            : { entry: serverEntry, packets: serverPackets }),
        load,
        publisher: String(raw.publisher || '').trim().slice(0, 80),
        icon: validateIcon(raw.icon),
        opens: validateOpens(raw.opens)
    };
}

function validateIcon(icon) {
    if (icon == null || icon === '') return '';
    const rel = assertSafeRelPath(String(icon).trim());
    if (!/\.(png|webp|ico)$/i.test(rel)) throw new MelatonPackageError('icon must be a .png, .webp or .ico', 'PACKAGE_ICON');
    return rel;
}

/** opens[]: VFS files the app runs for, by exact name (case-insensitive) and byte size. */
function validateOpens(opens) {
    if (opens == null) return [];
    if (!Array.isArray(opens) || opens.length > MAX_OPENS) {
        throw new MelatonPackageError(`opens must be a list of at most ${MAX_OPENS}`, 'PACKAGE_OPENS');
    }
    return opens.map((o) => {
        const name = String(o && o.name || '').trim();
        const size = Number(o && o.size);
        if (!name || name.length > 128 || /[\\/]/.test(name) || !Number.isInteger(size) || size < 0) {
            throw new MelatonPackageError('opens[] entries need a file name and an exact size', 'PACKAGE_OPENS');
        }
        return { name, size };
    });
}

/** A Melaton app EXE carries its package as the overlay; a plain zip is itself (Yozora #640). */
function packageBytesOf(buffer) {
    if (Buffer.isBuffer(buffer) && buffer.length > 2 && buffer.readUInt16LE(0) === 0x5a4d) {
        const zip = packageZipFromExe(buffer);
        if (zip) return zip;
    }
    return buffer;
}

function inferFormatFromName(fileName) {
    const lower = String(fileName || '').toLowerCase();
    if (lower.endsWith('.mapz')) return 'mapz';
    if (lower.endsWith('.msaz')) return 'msaz';
    return '';
}

class MelatonPackageStore {
    constructor(options) {
        const opts = options || {};
        if (!opts.rootDir) {
            throw new MelatonPackageError('rootDir is required', 'PACKAGE_ROOT');
        }
        this.rootDir = path.resolve(opts.rootDir);
        this.indexPath = path.join(this.rootDir, 'index.json');
        this.getReservedPacketTypes = opts.getReservedPacketTypes || (() => []);
    }

    _ensureRoot() {
        fs.mkdirSync(this.rootDir, { recursive: true });
    }

    readIndex() {
        this._ensureRoot();
        const raw = readJsonFile(this.indexPath, { version: INDEX_VERSION, packages: {} });
        if (!raw.packages || typeof raw.packages !== 'object') {
            raw.packages = {};
        }
        raw.version = INDEX_VERSION;
        return raw;
    }

    _writeIndex(index) {
        writeJsonAtomic(this.indexPath, index);
    }

    list() {
        const index = this.readIndex();
        return Object.keys(index.packages)
            .sort()
            .map((id) => index.packages[id]);
    }

    get(id) {
        return this.readIndex().packages[id] || null;
    }

    _assertUnique(manifest, replacingId) {
        const index = this.readIndex();
        for (const row of Object.values(index.packages)) {
            if (replacingId && row.id === replacingId) continue;
            if (row.launchId === manifest.launchId) {
                throw new MelatonPackageError(
                    `launchId already installed: ${manifest.launchId}`,
                    'PACKAGE_LAUNCH_TAKEN'
                );
            }
            if (manifest.type === 'dsap' && row.url && row.url === manifest.url) {
                throw new MelatonPackageError(`DSAP host already installed: ${manifest.url}`, 'PACKAGE_URL_TAKEN');
            }
        }
    }

    _extractZip(buffer, destDir) {
        if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
            throw new MelatonPackageError('Package bytes missing', 'PACKAGE_BYTES');
        }
        if (buffer.length > MAX_ZIP_BYTES) {
            throw new MelatonPackageError(`Package larger than ${MAX_ZIP_BYTES} bytes`, 'PACKAGE_TOO_LARGE');
        }

        let zip;
        try {
            zip = new AdmZip(buffer);
        } catch (err) {
            throw new MelatonPackageError(`Not a zip archive: ${err.message}`, 'PACKAGE_ZIP');
        }

        const entries = zip.getEntries();
        if (!entries.length) {
            throw new MelatonPackageError('Empty archive', 'PACKAGE_EMPTY');
        }
        if (entries.length > MAX_ZIP_FILES) {
            throw new MelatonPackageError(`Too many zip entries (${entries.length})`, 'PACKAGE_TOO_MANY_FILES');
        }

        let sawManifest = false;
        for (const entry of entries) {
            const rawName = String(entry.entryName || '').replace(/\\/g, '/').replace(/\/+$/, '');
            if (!rawName) continue;
            const name = assertSafeRelPath(rawName);
            if (name === 'manifest.json') sawManifest = true;
        }
        if (!sawManifest) {
            throw new MelatonPackageError('manifest.json missing at archive root', 'PACKAGE_MANIFEST_MISSING');
        }

        rmrf(destDir);
        fs.mkdirSync(destDir, { recursive: true });
        zip.extractAllTo(destDir, true);

        const manifestPath = path.join(destDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            rmrf(destDir);
            throw new MelatonPackageError('manifest.json missing after extract', 'PACKAGE_MANIFEST_MISSING');
        }
        return manifestPath;
    }

    installFromBuffer(buffer, options) {
        const opts = options || {};
        const reservedPackets = this.getReservedPacketTypes();
        const staging = path.join(this.rootDir, `.staging-${process.pid}-${Date.now()}`);
        let manifestPath;
        try {
            manifestPath = this._extractZip(packageBytesOf(buffer), staging);
            const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const manifest = validateManifest(raw, {
                expectedFormat: opts.expectedFormat || '',
                reservedPacketTypes: reservedPackets
            });

            this._assertTree(staging, manifest);

            this._assertUnique(manifest, manifest.id);

            const dest = path.join(this.rootDir, manifest.id);
            if (fs.existsSync(dest)) rmrf(dest);
            fs.renameSync(staging, dest);

            const now = new Date().toISOString();
            const index = this.readIndex();
            const previous = index.packages[manifest.id] || null;
            const record = {
                id: manifest.id,
                version: manifest.version,
                title: manifest.title,
                launchId: manifest.launchId,
                format: manifest.format,
                type: manifest.type,
                enabled: previous ? previous.enabled !== false : true,
                installedAt: previous && previous.installedAt ? previous.installedAt : now,
                updatedAt: now,
                dir: `packages/${manifest.id}`,
                manifest
            };
            index.packages[manifest.id] = record;
            this._writeIndex(index);
            return record;
        } catch (err) {
            rmrf(staging);
            if (err instanceof MelatonPackageError) throw err;
            if (err instanceof SyntaxError) {
                throw new MelatonPackageError('manifest.json is not valid JSON', 'PACKAGE_MANIFEST');
            }
            throw err;
        }
    }

    /** Files a manifest names must be in the tree. */
    _assertTree(dir, manifest) {
        const need = [['client.entry', manifest.client.entry]];
        if (manifest.server) need.push(['server.entry', manifest.server.entry]);
        if (manifest.icon) need.push(['icon', manifest.icon]);
        for (const style of manifest.client.styles || []) need.push(['client.styles', style]);
        for (const [what, rel] of need) {
            if (!fs.existsSync(path.join(dir, rel))) {
                throw new MelatonPackageError(`Missing ${what}: ${rel}`, what === 'client.entry' ? 'PACKAGE_CLIENT' : 'PACKAGE_FILE');
            }
        }
    }

    get runRoot() {
        return path.join(this.rootDir, RUN_DIR);
    }

    /** Per-package data dirs (the only place a server half may write). */
    get dataRoot() {
        return path.join(this.rootDir, DATA_DIR);
    }

    /**
     * Unpack a .msaz to run it from the VFS: .cache/packages/.run/<sha256>/, shared by every launch
     * of the same bytes. Returns { sha, dir, base, manifest } (base: the /cache path of the tree).
     */
    prepareRun(buffer) {
        if (!Buffer.isBuffer(buffer)) throw new MelatonPackageError('Package bytes missing', 'PACKAGE_BYTES');
        buffer = packageBytesOf(buffer);
        const sha = crypto.createHash('sha256').update(buffer).digest('hex');
        const dir = path.join(this.runRoot, sha);
        const readyMark = path.join(dir, '.melaton-run');
        if (!fs.existsSync(readyMark)) {
            const staging = path.join(this.runRoot, `.staging-${process.pid}-${Date.now()}`);
            try {
                this._extractZip(buffer, staging);
                const raw = JSON.parse(fs.readFileSync(path.join(staging, 'manifest.json'), 'utf8'));
                const manifest = validateManifest(raw, { expectedFormat: 'msaz' });
                this._assertTree(staging, manifest);
                fs.writeFileSync(path.join(staging, '.melaton-run'), new Date().toISOString());
                rmrf(dir);
                fs.renameSync(staging, dir);
            } catch (err) {
                rmrf(staging);
                if (err instanceof SyntaxError) throw new MelatonPackageError('manifest.json is not valid JSON', 'PACKAGE_MANIFEST');
                throw err;
            }
        }
        const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')), { expectedFormat: 'msaz' });
        try { fs.utimesSync(readyMark, new Date(), new Date()); } catch (_) { /* best effort */ }
        return { sha, dir, base: `packages/${RUN_DIR}/${sha}`, manifest };
    }

    /** Drop run trees nobody launched for maxAgeMs, except the ones in use. */
    sweepRuns(inUse, maxAgeMs) {
        const keep = new Set(inUse || []);
        const limit = Date.now() - (maxAgeMs == null ? 24 * 3600 * 1000 : maxAgeMs);
        let removed = 0;
        if (!fs.existsSync(this.runRoot)) return removed;
        for (const name of fs.readdirSync(this.runRoot)) {
            if (keep.has(name)) continue;
            const dir = path.join(this.runRoot, name);
            let at = 0;
            try { at = fs.statSync(path.join(dir, '.melaton-run')).mtimeMs; } catch (_) { at = 0; }
            if (at < limit) { rmrf(dir); removed++; }
        }
        return removed;
    }

    /** The enabled installed package whose opens[] lists this file (name case-insensitive, exact size). */
    findOpener(name, size) {
        const lower = String(name || '').toLowerCase();
        const bytes = Number(size);
        for (const row of this.list()) {
            if (row.enabled === false) continue;
            const opens = (row.manifest && row.manifest.opens) || [];
            if (opens.some((o) => o.name.toLowerCase() === lower && o.size === bytes)) return row;
        }
        return null;
    }

    /**
     * Install (or refresh) a package from an unpacked source tree, e.g. a system package shipped in
     * the repo (apps/<id>/). Skips the copy when the tree is unchanged.
     */
    installFromDirectory(srcDir, options) {
        const opts = options || {};
        const src = path.resolve(srcDir);
        const raw = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
        // installFromDirectory ships our own packages (apps/<id>), so they are trusted: a system
        // package may declare its own stylesheets (#642), unlike an uploaded one.
        const manifest = validateManifest(raw, { reservedPacketTypes: this.getReservedPacketTypes(), trusted: opts.system !== false });
        this._assertTree(src, manifest);
        const files = [];
        const walk = (rel) => {
            for (const ent of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
                const r = rel ? `${rel}/${ent.name}` : ent.name;
                if (ent.isDirectory()) walk(r);
                else if (ent.isFile()) files.push(r);
            }
        };
        walk('');
        files.sort();
        if (files.length > MAX_ZIP_FILES) throw new MelatonPackageError('Too many files', 'PACKAGE_TOO_MANY_FILES');
        const hash = crypto.createHash('sha256');
        for (const f of files) hash.update(f).update('\0').update(fs.readFileSync(path.join(src, f)));
        const treeHash = hash.digest('hex');

        const index = this.readIndex();
        const previous = index.packages[manifest.id] || null;
        const dest = path.join(this.rootDir, manifest.id);
        if (previous && previous.treeHash === treeHash && fs.existsSync(dest)) return previous;
        this._assertUnique(manifest, manifest.id);

        const staging = path.join(this.rootDir, `.staging-${process.pid}-${Date.now()}`);
        try {
            for (const f of files) {
                const to = path.join(staging, f);
                fs.mkdirSync(path.dirname(to), { recursive: true });
                fs.copyFileSync(path.join(src, f), to);
            }
            rmrf(dest);
            fs.renameSync(staging, dest);
        } catch (err) {
            rmrf(staging);
            throw err;
        }
        const now = new Date().toISOString();
        const record = {
            id: manifest.id,
            version: manifest.version,
            title: manifest.title,
            launchId: manifest.launchId,
            format: manifest.format,
            type: manifest.type,
            enabled: previous ? previous.enabled !== false : true,
            installedAt: previous && previous.installedAt ? previous.installedAt : now,
            updatedAt: now,
            dir: `packages/${manifest.id}`,
            system: !!opts.system,
            treeHash,
            manifest
        };
        index.packages[manifest.id] = record;
        this._writeIndex(index);
        return record;
    }

    setEnabled(id, enabled) {
        const index = this.readIndex();
        const row = index.packages[id];
        if (!row) {
            throw new MelatonPackageError(`Package not installed: ${id}`, 'PACKAGE_NOT_FOUND');
        }
        row.enabled = !!enabled;
        row.updatedAt = new Date().toISOString();
        this._writeIndex(index);
        return row;
    }

    uninstall(id) {
        const index = this.readIndex();
        const row = index.packages[id];
        if (!row) {
            throw new MelatonPackageError(`Package not installed: ${id}`, 'PACKAGE_NOT_FOUND');
        }
        rmrf(path.join(this.rootDir, id));
        delete index.packages[id];
        this._writeIndex(index);
        return { id, removed: true };
    }
}

function createMelatonPackageStore(globalResources, extra) {
    const cacheDir = globalResources.getPath('cache');
    return new MelatonPackageStore({
        rootDir: path.join(cacheDir, 'packages'),
        getReservedPacketTypes: extra && extra.getReservedPacketTypes
            ? extra.getReservedPacketTypes
            : () => []
    });
}

module.exports = {
    MelatonPackageStore,
    MelatonPackageError,
    validateManifest,
    normalizeDsapHost,
    inferFormatFromName,
    packageBytesOf,
    createMelatonPackageStore,
    RESERVED_LAUNCH_IDS,
    RESERVED_DSAP_HOSTS,
    MAX_ZIP_BYTES
};
