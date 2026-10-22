#!/usr/bin/env node
/**
 * Import Windows Sidebar gadgets (.gadget packages) for the gadget host (Yozora #629).
 *
 *   node scripts/import-vista-gadget.js --root ~/.cache/gadget-review [--only id,id] [--dry]
 *
 * scripts/assets/vista-gadgets/gadgets.json lists the gadgets: { id, src, title?, author?, desc?, ... }
 * where src is a .gadget file (zip or cab) or an unpacked gadget folder, relative to --root.
 * Each one is unpacked to public/static_images/vista-gadgets/<id>/ with:
 *   - every path lowercased (gadgets were written for a case-insensitive file system; the server
 *     folds request paths to lowercase and, like the Sidebar, looks in the gadget's root when a file
 *     is not in its locale folder: modules/vistaGadgetStatic.js)
 *   - html / js / css / xml re-encoded as UTF-8 (they ship as UTF-16, UTF-8 or Windows-1252)
 *   - every page given the host shim and a CSP as the first thing in <head>
 * and described in public/static_images/vista-gadgets/catalog.json, which the Sidebar (vistaSidebar.js) and the
 * server's state filter (modules/sidebarGadgets.js) read. <id>/__install.json lists the package's
 * files and sizes: adding the gadget the first time downloads them (vistaGadgetHost.js vghInstall).
 *
 * Gadget code is kept as shipped. Fixes for one gadget go in scripts/assets/vista-gadgets/patches/<id>/
 * (files copied over the unpacked ones, same lowercase paths) so a re-import keeps them.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const CONFIG = path.join(REPO, 'scripts/assets/vista-gadgets/gadgets.json');
const PATCHES = path.join(REPO, 'scripts/assets/vista-gadgets/patches');
const OUT_ROOT = path.join(REPO, 'public/static_images/vista-gadgets');
const CATALOG = path.join(REPO, 'public/static_images/vista-gadgets/catalog.json');
const WEB_ROOT = '/static_images/vista-gadgets';
const SHIM = '/scripts/comp/sidebar-gadgets/gadgetShim.js';
const TEXT_EXT = new Set(['.html', '.htm', '.js', '.css', '.xml', '.vbs', '.txt', '.ini']);
const PAGE_EXT = new Set(['.html', '.htm']);
// Gadgets reach nothing outside Dreamscape: remote data comes through the host (System.* shims)
const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'self'"
].join('; ');
const HEAD_TAGS = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><script src="${SHIM}"></script>`;

function args() {
    const out = { root: '', only: null, dry: false };
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--root') out.root = argv[++i];
        else if (argv[i] === '--only') out.only = new Set(argv[++i].split(',').map((s) => s.trim()).filter(Boolean));
        else if (argv[i] === '--dry') out.dry = true;
    }
    if (!out.root) throw new Error('--root is required');
    out.root = path.resolve(out.root.replace(/^~(?=$|\/)/, os.homedir()));
    return out;
}

/** Unpack a .gadget (zip or cab) or copy a gadget folder into dir. */
function unpack(src, dir) {
    if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dir, { recursive: true });
        return;
    }
    try {
        execFileSync('unzip', ['-qq', '-o', src, '-d', dir], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (_err) {
        execFileSync('7z', ['x', '-y', '-o' + dir, src], { stdio: ['ignore', 'ignore', 'pipe'] });
    }
}

function walk(dir, base = dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full, base, out);
        else out.push(path.relative(base, full));
    }
    return out;
}

/** The folder that holds gadget.xml: some packages wrap everything in one more "<name>.gadget" folder. */
function gadgetRoot(dir) {
    const files = walk(dir).map((f) => f.split(path.sep).join('/'));
    const manifests = files.filter((f) => /(^|\/)gadget\.xml$/i.test(f)).sort((a, b) => a.split('/').length - b.split('/').length);
    if (!manifests.length) throw new Error('no gadget.xml');
    const first = manifests[0].split('/');
    // gadget.xml in a locale folder (en-US/gadget.xml) means the root is one level up
    const isLocale = (seg) => /^[a-z]{2}(-[a-z]{2,4})?$/i.test(seg);
    let depth = first.length - 1;
    if (depth > 0 && isLocale(first[depth - 1])) depth -= 1;
    return path.join(dir, ...first.slice(0, depth));
}

function decodeText(buf) {
    if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
    if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
    // UTF-16 without a BOM: every other byte of ASCII text is 0
    if (buf.length > 3 && buf[1] === 0 && buf[3] === 0) return new TextDecoder('utf-16le').decode(buf);
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (_err) {
        return new TextDecoder('windows-1252').decode(buf);
    }
}

/** Shim and CSP first in <head>; the page keeps its own doctype (or none: quirks mode, as the Sidebar drew it). */
function patchPage(html) {
    let out = html.replace(/<meta[^>]+charset\s*=\s*["']?[\w-]+["']?[^>]*>/gi, '');
    out = out.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]*>/gi, '');
    // <g:background ... /> is a void tag to IE's XML namespaces; to the HTML parser it stays open and swallows the page
    out = out.replace(/<((?:g|v):[a-z]+)\b([^>]*?)\/\s*>/gi, '<$1$2></$1>');
    const tags = '<meta charset="utf-8">' + HEAD_TAGS;
    if (/<head[^>]*>/i.test(out)) return out.replace(/<head[^>]*>/i, (m) => m + tags);
    if (/<html[^>]*>/i.test(out)) return out.replace(/<html[^>]*>/i, (m) => m + '<head>' + tags + '</head>');
    return tags + out;
}

/** Root-absolute url(/x), src="/x" and href="/x" (not //host) resolve inside the gadget's folder. */
function rootPaths(text, id) {
    const base = `${WEB_ROOT}/${id}/`;
    return text
        .replace(/url\(\s*(['"]?)\/(?!\/|static_images\/vista-gadgets\/|scripts\/comp\/sidebar-gadgets\/)/gi, (_m, q) => `url(${q}${base}`)
        .replace(/\b(src|href)\s*=\s*(['"])\/(?!\/|static_images\/vista-gadgets\/|scripts\/comp\/sidebar-gadgets\/)/gi, (_m, attr, q) => `${attr}=${q}${base}`);
}

function xmlText(xml, tag) {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
    return m ? m[1].replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}

function xmlAttr(xml, tag, attr) {
    const m = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
    return m ? m[1].trim() : '';
}

const entities = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));

// copyrights-not-1to1.mdc: Microsoft's lines read Xyridian
const rehold = (s) => s.replace(/Microsoft Corporation/g, 'Xyridian Corporation').replace(/Microsoft Corp\./g, 'Xyridian Corp.').replace(/\bMicrosoft\b/g, 'Xyridian');

function importOne(entry, opts) {
    const src = path.resolve(opts.root, entry.src);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vgadget-'));
    try {
        unpack(src, tmp);
        const root = gadgetRoot(tmp);
        const files = walk(root);
        const out = path.join(OUT_ROOT, entry.id);
        const lowered = new Map();
        for (const rel of files) {
            const key = rel.split(path.sep).join('/').toLowerCase();
            if (lowered.has(key)) console.warn(`  ${entry.id}: ${rel} and ${lowered.get(key)} fold to the same path; keeping the first`);
            else lowered.set(key, rel);
        }
        // locale folder that carries the gadget's pages: en-US first, then the root
        const keys = [...lowered.keys()];
        const locale = keys.includes('en-us/gadget.xml') ? 'en-us/' : (keys.includes('gadget.xml') ? '' : (keys.find((k) => /^[a-z]{2}-[a-z]{2}\/gadget\.xml$/.test(k)) || '').replace('gadget.xml', ''));
        const manifestKey = keys.includes(locale + 'gadget.xml') ? locale + 'gadget.xml' : 'gadget.xml';
        const xml = decodeText(fs.readFileSync(path.join(root, lowered.get(manifestKey))));
        const baseSrc = (xmlAttr(xml, 'base', 'src') || 'gadget.html').replace(/\\/g, '/').toLowerCase();
        // the page sits beside gadget.xml, or in en-US / another locale folder when the manifest is at the root
        const pageDir = [locale, '', 'en-us/', ...keys.filter((k) => /^[a-z]{2}-[a-z]{2}\/gadget\.xml$/.test(k)).map((k) => k.replace('gadget.xml', '')),
            ...keys.filter((k) => k.endsWith('/' + baseSrc) && k.split('/').length === 2).map((k) => k.replace(baseSrc, ''))]
            .find((d) => keys.includes(d + baseSrc)) || '';
        const iconSrc = (xmlAttr(xml, 'icon', 'src') || '').replace(/\\/g, '/').toLowerCase();
        const iconKey = [pageDir + iconSrc, iconSrc, locale + iconSrc].find((k) => k && lowered.has(k)) || '';
        let usesSettings = false;
        let usesShellFs = false;
        if (!opts.dry) {
            fs.rmSync(out, { recursive: true, force: true });
            fs.mkdirSync(out, { recursive: true });
        }
        for (const [key, rel] of lowered) {
            const ext = path.extname(key);
            const dest = path.join(out, ...key.split('/'));
            let body = fs.readFileSync(path.join(root, rel));
            if (TEXT_EXT.has(ext)) {
                let text = decodeText(body);
                // "/images/x.png" meant the gadget's root to the Sidebar: point it at the package
                if (ext === '.css' || PAGE_EXT.has(ext)) text = rootPaths(text, entry.id);
                if (/settingsUI/.test(text)) usesSettings = true;
                if (/itemFromPath|SHFolder|chooseFolder/.test(text)) usesShellFs = true;
                if (PAGE_EXT.has(ext)) text = patchPage(text);
                body = Buffer.from(text, 'utf8');
            }
            if (!opts.dry) {
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.writeFileSync(dest, body);
            }
        }
        // extras: archives that belong in the gadget's folder (System Animator's animation packs)
        for (const extra of opts.dry ? [] : (entry.extras || [])) {
            const xtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vgadget-x-'));
            try {
                unpack(path.resolve(opts.root, extra.zip), xtmp);
                for (const rel of walk(xtmp)) {
                    const key = rel.split(path.sep).join('/').toLowerCase();
                    const dest = path.join(out, ...(extra.to || '').toLowerCase().split('/').filter(Boolean), ...key.split('/'));
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    let body = fs.readFileSync(path.join(xtmp, rel));
                    if (TEXT_EXT.has(path.extname(key))) body = Buffer.from(decodeText(body), 'utf8');
                    fs.writeFileSync(dest, body);
                }
            } finally {
                fs.rmSync(xtmp, { recursive: true, force: true });
            }
        }
        const patchDir = path.join(PATCHES, entry.id);
        if (!opts.dry && fs.existsSync(patchDir)) {
            for (const rel of walk(patchDir)) {
                const dest = path.join(out, rel.toLowerCase());
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                let body = fs.readFileSync(path.join(patchDir, rel));
                if (PAGE_EXT.has(path.extname(rel).toLowerCase()) && !body.includes(SHIM)) body = Buffer.from(patchPage(decodeText(body)), 'utf8');
                fs.writeFileSync(dest, body);
            }
        }
        const installed = opts.dry ? [] : walk(out).map((rel) => {
            const key = rel.split(path.sep).join('/');
            return [`${WEB_ROOT}/${entry.id}/${key}`, fs.statSync(path.join(out, rel)).size];
        }).filter(([url]) => !/\.(log|txt|ini)$/i.test(url));
        if (!opts.dry) fs.writeFileSync(path.join(out, '__install.json'), JSON.stringify(installed));
        const author = entities(xmlAttr(xml, 'author', 'name'));
        const logoSrc = (xmlAttr(xml, 'logo', 'src') || '').replace(/\\/g, '/').toLowerCase();
        const logoKey = [pageDir + logoSrc, logoSrc, locale + logoSrc].find((k) => k && lowered.has(k)) || '';
        const site = xmlAttr(xml, 'info', 'url');
        const copyright = entities(xmlText(xml, 'copyright'));
        const holder = rehold(entry.author || author || 'Unknown');
        // Microsoft's gadgets carry Windows' logo and a microsoft.com link: Xyridian's logo, no link
        const oem = holder === 'Xyridian Corporation';
        return {
            id: entry.id,
            title: entry.title || entities(xmlText(xml, 'name')) || entry.id,
            version: entry.version || xmlText(xml, 'version') || '1.0',
            author: holder,
            desc: rehold(entry.desc || entities(xmlText(xml, 'description'))),
            icon: iconKey ? `${WEB_ROOT}/${entry.id}/${iconKey}` : '',
            page: `${WEB_ROOT}/${entry.id}/${pageDir}${baseSrc}`,
            path: `${WEB_ROOT}/${entry.id}`,
            logo: oem ? '/static_images/xyridian/xyridian-logo-light.png' : (logoKey ? `${WEB_ROOT}/${entry.id}/${logoKey}` : ''),
            copyright: rehold(entry.copyright || copyright),
            url: !oem && /^https?:\/\//i.test(site) ? site : '',
            settings: entry.settings != null ? !!entry.settings : usesSettings,
            // the page browses its own folders (System.Shell.itemFromPath): the host loads the file list first
            ...(usesShellFs ? { fs: true } : {}),
            // shows a workspace picture until one is dropped on it (System.Gadget.picture, vistaGadgetHost.js)
            ...(entry.picture ? { picture: true } : {}),
            group: entry.group || 'other',
            size: installed.reduce((n, [, size]) => n + size, 0),
            ...(entry.host ? { host: entry.host } : {}),
            // hosts whose text the gadget may fetch through /gadget-proxy (modules/vistaGadgetProxy.js)
            ...(Array.isArray(entry.web) && entry.web.length ? { web: entry.web } : {})
        };
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function main() {
    const opts = args();
    const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    const catalog = fs.existsSync(CATALOG) ? JSON.parse(fs.readFileSync(CATALOG, 'utf8')) : { version: 1, gadgets: [] };
    const byId = new Map(catalog.gadgets.map((g) => [g.id, g]));
    let failed = 0;
    for (const entry of config.gadgets) {
        if (opts.only && !opts.only.has(entry.id)) continue;
        // skip: kept in the list (its source and why) but not in the gallery; its files go
        if (entry.skip) {
            if (!opts.dry) fs.rmSync(path.join(OUT_ROOT, entry.id), { recursive: true, force: true });
            byId.delete(entry.id);
            console.log(`skip ${entry.id.padEnd(18)} ${entry.skip}`);
            continue;
        }
        try {
            const item = importOne(entry, opts);
            byId.set(entry.id, item);
            console.log(`ok   ${entry.id.padEnd(18)} ${item.title} ${item.version} (${item.author})`);
        } catch (err) {
            failed += 1;
            console.error(`FAIL ${entry.id}: ${err.message}`);
        }
    }
    // catalog order follows the config
    const order = config.gadgets.filter((g) => !g.skip).map((g) => g.id);
    catalog.gadgets = order.filter((id) => byId.has(id)).map((id) => byId.get(id));
    if (!opts.dry) fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 1) + '\n');
    if (failed) process.exitCode = 1;
}

main();
