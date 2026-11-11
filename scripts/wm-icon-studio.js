#!/usr/bin/env node
/**
 * Local studio for Windows Mobile 6.1 style program icons (Melaton Mobile, Yozora #732).
 * The WM copy of scripts/app-icon-studio.js: generate a master, frame it, preview it at the
 * phone's sizes, and write app-<name> 16/32/64 + -lg 32/64/128 into public/static_images/wm61.
 *
 *   node scripts/wm-icon-studio.js
 *   node scripts/wm-icon-studio.js --port 9331
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const wmIconGenerator = require('../modules/wmIconGenerator');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(__dirname, 'wm-icon-studio.html');
const ART_DIR = wmIconGenerator.wmArtDir(PROJECT_ROOT);
const ORIG_DIR = wmIconGenerator.originalsDir(PROJECT_ROOT);

function printHelp() {
    console.log(`WM icon studio

  node scripts/wm-icon-studio.js [--port 9331]

Opens a local page to generate a WM 6.1 style program icon, frame it, preview it at
16/32/64 px on the phone's backgrounds, and write the wm61 app-<name> sizes + manifest entries.
`);
}

function parseArgs(argv) {
    let port = 9331;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') return { help: true, port };
        if (arg === '--port') port = Number(argv[++i]);
        else if (arg.startsWith('--port=')) port = Number(arg.slice('--port='.length));
        else throw new Error(`Unknown argument "${arg}".`);
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 to 65535.');
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
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

function sendFile(res, filePath, type) {
    const buf = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': buf.length });
    res.end(buf);
}

/** Art names of the WM app icons on disk (app-<x> with an -lg@2x frame). */
function listIcons() {
    const names = fs.readdirSync(ART_DIR).filter((n) => /^app-[a-z0-9-]+-lg@2x\.png$/.test(n)).map((n) => n.replace(/-lg@2x\.png$/, ''));
    return names.map((name) => {
        const lg = path.join(ART_DIR, `${name}-lg@2x.png`);
        const master = path.join(ORIG_DIR, `${name}.png`);
        return {
            name,
            mtime: fs.statSync(lg).mtimeMs,
            hasMaster: fs.existsSync(master),
            hasSmall: fs.existsSync(path.join(ORIG_DIR, `${name}-16.png`))
        };
    }).sort((a, b) => (b.hasMaster - a.hasMaster) || (b.mtime - a.mtime));
}

/** The image to frame: the stored master, else the largest frame on disk (ROM art: view only). */
function resolveSource(name, small) {
    const art = wmIconGenerator.artName(name);
    const master = path.join(ORIG_DIR, `${art}${small ? '-16' : ''}.png`);
    if (fs.existsSync(master)) return { kind: 'master', file: master, art };
    if (small) return null;
    for (const suffix of ['-lg@4x', '-lg@2x', '@4x', '@2x', '']) {
        const file = path.join(ART_DIR, `${art}${suffix}.png`);
        if (fs.existsSync(file)) return { kind: 'art', file, art };
    }
    return null;
}

async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        sendFile(res, PAGE, 'text/html; charset=utf-8');
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
        sendJson(res, 200, {
            models: wmIconGenerator.TRANSPARENT_MODELS,
            defaultModel: wmIconGenerator.DEFAULT_MODEL,
            qualities: ['low', 'medium', 'high'],
            qualities25: ['low', 'medium', 'high', 'xhigh', 'max'],
            inset: wmIconGenerator.WM_INSET,
            sizes: wmIconGenerator.SIZES
        });
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/icons') {
        sendJson(res, 200, { icons: listIcons() });
        return;
    }
    const artMatch = url.pathname.match(/^\/art\/(app-[a-z0-9-]+(?:-lg)?(?:@[24]x)?\.png)$/);
    if (req.method === 'GET' && artMatch) {
        const file = path.join(ART_DIR, artMatch[1]);
        if (!fs.existsSync(file)) {
            sendJson(res, 404, { error: 'Not found.' });
            return;
        }
        sendFile(res, file, 'image/png');
        return;
    }
    const sourceMatch = url.pathname.match(/^\/icon\/source\/(app-[a-z0-9-]+)\.png$/);
    if ((req.method === 'GET' || req.method === 'HEAD') && sourceMatch) {
        const source = resolveSource(sourceMatch[1], url.searchParams.get('small') === '1');
        if (!source) {
            sendJson(res, 404, { error: 'Icon not found.' });
            return;
        }
        res.setHeader('X-Source-Kind', source.kind);
        sendFile(res, source.file, 'image/png');
        return;
    }
    if (req.method === 'POST' && url.pathname === '/api/generate') {
        const body = JSON.parse(await readBody(req, 40 * 1024 * 1024));
        const references = [];
        for (const ref of Array.isArray(body.references) ? body.references : []) {
            if (ref && ref.icon) {
                const source = resolveSource(ref.icon, false);
                if (!source) throw new wmIconGenerator.AppIconError(`Reference icon ${ref.icon} was not found.`);
                references.push({ buffer: fs.readFileSync(source.file), name: `${source.art}.png` });
            } else if (ref && ref.data) {
                references.push({ buffer: Buffer.from(String(ref.data), 'base64'), name: ref.name || 'reference.png' });
            }
        }
        const result = await wmIconGenerator.generateWmIcon({
            projectRoot: PROJECT_ROOT,
            input: body.input,
            from: body.from,
            extra: body.extra,
            name: body.name,
            model: body.model,
            quality: body.quality,
            small: body.small === true,
            smallOnly: body.smallOnly === true,
            references,
            force: body.force === true,
            save: true
        });
        sendJson(res, 200, {
            name: result.name,
            hasSmall: !!(result.saved && result.saved.hasSmall),
            crop: result.saved ? result.saved.crop : null,
            transparentRatio: result.alpha ? result.alpha.transparentRatio : 0
        });
        return;
    }
    if (req.method === 'POST' && url.pathname === '/api/save') {
        const body = JSON.parse(await readBody(req, 1000000));
        const crop = (c) => (c && Number.isFinite(Number(c.size)) ? { x: c.x, y: c.y, size: c.size } : undefined);
        const saved = await wmIconGenerator.saveWmIcon({
            projectRoot: PROJECT_ROOT,
            name: body.name,
            crop: crop(body.crop),
            smallCrop: crop(body.smallCrop),
            useSmall: body.useSmall !== false,
            input: body.input,
            from: body.from
        });
        sendJson(res, 200, {
            name: saved.name,
            hasSmall: saved.hasSmall,
            written: saved.written.map((f) => path.relative(PROJECT_ROOT, f))
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
            if (!res.headersSent) sendJson(res, status, { error: err && err.message ? err.message : String(err) });
            else res.end();
        });
    });
    server.requestTimeout = 600000;
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port, '127.0.0.1', resolve);
    });
    console.log(`WM icon studio: http://127.0.0.1:${opts.port}`);
}

main().catch((err) => {
    console.error(`Error: ${err.message}`);
    console.error('  node scripts/wm-icon-studio.js --port 9331');
    process.exit(1);
});
