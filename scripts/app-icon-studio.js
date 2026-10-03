#!/usr/bin/env node
/**
 * Local crop studio for start-menu icons.
 *
 *   node scripts/app-icon-studio.js
 *   node scripts/app-icon-studio.js --port 9330
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const appIconRuntimeAssets = require('../modules/appIconRuntimeAssets');
const appIconGenerator = require('../modules/appIconGenerator');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(__dirname, 'app-icon-studio.html');

function printHelp() {
    console.log(`App icon studio

  node scripts/app-icon-studio.js [--port 9330]

Opens a local page to generate a transparent icon, frame it against a safe area,
keep the original, and write a ${appIconGenerator.ICON_OUTPUT_SIZE}px master.
`);
}

function parseArgs(argv) {
    let port = 9330;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') return { help: true, port };
        if (arg === '--port') {
            port = Number(argv[++i]);
        } else if (arg.startsWith('--port=')) {
            port = Number(arg.slice('--port='.length));
        } else {
            throw new Error(`Unknown argument "${arg}".`);
        }
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('--port must be an integer from 1 to 65535.');
    }
    return { help: false, port };
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                reject(new Error('Request body is too large.'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function sendFile(res, filePath, type) {
    const buf = fs.readFileSync(filePath);
    res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'Content-Length': buf.length
    });
    res.end(buf);
}

function minSide(box) {
    return Math.min(box.left, box.top, box.right, box.bottom);
}

function resolveSource(name) {
    const filename = appIconGenerator.iconBasename(name);
    const original = path.join(appIconGenerator.originalsDirFor(PROJECT_ROOT), filename);
    const master = path.join(appIconRuntimeAssets.getPublicIconsDir(PROJECT_ROOT), filename);
    if (fs.existsSync(original)) return { kind: 'original', file: original, filename };
    if (fs.existsSync(master)) return { kind: 'master', file: master, filename };
    return null;
}

const paddingCache = new Map();

async function listIcons() {
    const dir = appIconRuntimeAssets.getPublicIconsDir(PROJECT_ROOT);
    const names = fs.readdirSync(dir).filter((name) => /\.png$/i.test(name) && !name.startsWith('.')).sort();
    const icons = [];
    for (const name of names) {
        const filePath = path.join(dir, name);
        const stat = fs.statSync(filePath);
        const key = `${stat.mtimeMs}:${stat.size}`;
        let measured = paddingCache.get(name);
        if (!measured || measured.key !== key) {
            const padding = await appIconGenerator.measurePadding(fs.readFileSync(filePath));
            measured = { key, padding };
            paddingCache.set(name, measured);
        }
        const original = path.join(appIconGenerator.originalsDirFor(PROJECT_ROOT), name);
        icons.push({
            name,
            width: measured.padding.width,
            height: measured.padding.height,
            mtime: stat.mtimeMs,
            hasOriginal: fs.existsSync(original),
            body: measured.padding.body,
            edge: measured.padding.edge,
            minBody: minSide(measured.padding.body)
        });
    }
    icons.sort((a, b) => b.mtime - a.mtime);
    const tight = icons.filter((icon) => icon.minBody < appIconGenerator.SAFE_INSET).length;
    return { icons, tight, total: icons.length };
}

async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        sendFile(res, PAGE, 'text/html; charset=utf-8');
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
        sendJson(res, 200, {
            models: appIconGenerator.TRANSPARENT_MODELS,
            defaultModel: appIconGenerator.DEFAULT_MODEL,
            qualities: ['low', 'medium', 'high'],
            qualities25: ['low', 'medium', 'high', 'xhigh', 'max'],
            safeInset: appIconGenerator.SAFE_INSET,
            outputSize: appIconGenerator.ICON_OUTPUT_SIZE,
            displaySizes: [28, 64]
        });
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/icons') {
        sendJson(res, 200, await listIcons());
        return;
    }
    const sourceMatch = url.pathname.match(/^\/icon\/source\/([^/]+\.png)$/);
    if (req.method === 'GET' && sourceMatch) {
        const source = resolveSource(sourceMatch[1]);
        if (!source) {
            sendJson(res, 404, { error: 'Icon not found.' });
            return;
        }
        sendFile(res, source.file, 'image/png');
        return;
    }
    if (req.method === 'POST' && url.pathname === '/api/generate') {
        const body = JSON.parse(await readBody(req, 40 * 1024 * 1024));
        const references = [];
        for (const ref of Array.isArray(body.references) ? body.references : []) {
            if (ref && ref.icon) {
                const source = resolveSource(ref.icon);
                if (!source) {
                    throw new appIconGenerator.AppIconError(`Reference icon ${ref.icon} was not found.`);
                }
                references.push({ buffer: fs.readFileSync(source.file), name: source.filename });
            } else if (ref && ref.data) {
                references.push({
                    buffer: Buffer.from(String(ref.data), 'base64'),
                    name: ref.name || 'reference.png'
                });
            }
        }
        const result = await appIconGenerator.generateAppIcon({
            projectRoot: PROJECT_ROOT,
            input: body.input,
            from: body.from,
            extra: body.extra,
            name: body.name,
            model: body.model,
            quality: body.quality,
            references,
            outDir: appIconGenerator.originalsDirFor(PROJECT_ROOT),
            compile: false,
            force: body.force === true
        });
        sendJson(res, 200, {
            name: result.filename,
            path: path.relative(PROJECT_ROOT, result.path),
            bytes: result.bytes,
            model: result.model,
            referenceCount: result.referenceCount || 0,
            background: result.background,
            transparentRatio: result.alpha ? result.alpha.transparentRatio : 0
        });
        return;
    }
    if (req.method === 'POST' && url.pathname === '/api/save') {
        const body = JSON.parse(await readBody(req, 1000000));
        const source = resolveSource(body.name);
        if (!source) {
            sendJson(res, 404, { error: 'Nothing to crop yet. Generate an icon or pick one from the list.' });
            return;
        }
        const saved = await appIconGenerator.saveFinalIcon({
            projectRoot: PROJECT_ROOT,
            name: source.filename,
            sourceBuffer: fs.readFileSync(source.file),
            crop: { x: body.x, y: body.y, size: body.size }
        });
        paddingCache.delete(source.filename);
        sendJson(res, 200, {
            name: saved.filename,
            original: path.relative(PROJECT_ROOT, saved.originalPath),
            master: path.relative(PROJECT_ROOT, saved.masterPath),
            outputSize: saved.outputSize,
            storedOriginal: saved.storedOriginal,
            compiled: saved.compiled,
            source: source.kind
        });
        return;
    }
    sendJson(res, 404, { error: 'Not found.' });
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        printHelp();
        return;
    }
    const server = http.createServer((req, res) => {
        handle(req, res).catch((err) => {
            const status = err && err.code === 'USAGE' ? 400 : 500;
            const message = err && err.message ? err.message : String(err);
            if (!res.headersSent) sendJson(res, status, { error: message });
            else res.end();
        });
    });
    server.requestTimeout = 300000;
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port, '127.0.0.1', resolve);
    });
    console.log(`App icon studio: http://127.0.0.1:${opts.port}`);
}

main().catch((err) => {
    console.error(`Error: ${err.message}`);
    console.error('  node scripts/app-icon-studio.js --port 9330');
    process.exit(1);
});
