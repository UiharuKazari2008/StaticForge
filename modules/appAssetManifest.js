/**
 * Application asset manifest (Yozora #518): which pictures and fonts each application paints,
 * so the client can decode them before the application opens (assetPreload.warmLaunch /
 * warmWindow) instead of the first paint fetching them.
 *
 * Groups, scanned from source:
 *   feature:<name>  featureLoader FEATURE_MANIFEST styles, scripts and template
 *   app:<name>      css/desktop-apps/<name>.css + scripts/comp/desktop-apps/<name>.js
 *   window:<id>     CSS rules in any stylesheet whose selector names #<id> (a window)
 * plus two indexes into them: launch (start menu / desktop shortcut launchId) and windows
 * (modal element id). Sidebar gadgets are not here: the boot draws them hidden and decodes
 * what they painted (assetPreload.js preloadGadgetsStage, #521).
 *
 * Output: public/data/app-assets.json, rewritten by the runtime compile only when it changes
 * (modules/runtimeAssetCompiler.js). Build by hand: node scripts/build-app-asset-manifest.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const OUTPUT_REL = 'public/data/app-assets.json';
const VERSION = 1;

// Start menu launchables (public/scripts/comp/modalUtils.js startMenuLaunchables) → groups.
// windows ending in * match every window id with that prefix. sheets: whole stylesheets in
// public/css (name prefixes) for applications whose art is scoped by class, not by window id.
const LAUNCH_GROUPS = {
    workspace: { windows: ['workspaceManageModal', 'workspaceEditModal'] },
    studio: { windows: ['manualModal'], sheets: ['manual-modal', 'studio-'] },
    spellbook: { features: ['spellbook'], windows: ['spellbook*'] },
    reference: { windows: ['cacheManagerModal'] },
    'bracket-generation': { features: ['bracket_gen'], windows: ['bracketGenerationModal'] },
    director: { windows: ['director*'], sheets: ['director'] },
    encyclopedia: { features: ['grimoire'], windows: ['tagWikiSearchModal'] },
    alchemy: { features: ['grimoire'], windows: ['tagWikiSearchModal'] },
    naxt: { features: ['naxt'], windows: ['naxtModal'] },
    notebook: { features: ['notepad'], windows: ['notebookModal'] },
    chat: { features: ['chat'], windows: ['chat*'] },
    explorer: { features: ['explorer'], windows: ['explorerModal'] },
    'remote-desktop': { apps: ['guacRemote', 'guacFrameMirror'], windows: ['desktopGuac*'] },
    dovecote: { apps: ['dovecote'], windows: ['desktopDovecote*', 'dovecote*'] },
    'planet-switcher': { features: ['planet_switcher'], windows: ['planetSwitcher*'] },
    run: { features: ['run'], windows: ['runModal'] }
};

// Shell and logon sheets: preloaded by the boot stages, not by an application
const SKIP_STYLESHEETS = new Set([
    'fonts.css', 'desktop-boot.css', 'launch-boot.css', 'launch-install.css',
    'vista-sidebar.css', 'desktop-shell.css', 'vista-glass-controls.css', 'vista-scrollbars.css',
    'vista-scrollbars-frame.css', 'desktopAppWindows.css'
]);

const WINDOW_ID_RE = /#([A-Za-z][\w-]*(?:Modal|Window|Dialog))\b/g;
const ASSET_LITERAL_RE = /['"`](\/(?:static_images|dist\/fonts|images\/vista)[^'"`$\s]*?\.(?:png|jpe?g|gif|webp|svg|avif|ico|bmp))['"`]/g;
const BITMAP_RE = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)(\?|$)/i;

function readText(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch (_err) {
        return '';
    }
}

function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Leaf rules { selector, body } (declarations only), inside @media / @supports too. */
function cssLeafRules(css) {
    const out = [];
    const text = stripComments(css);
    const stack = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' || ch === "'") {
            const end = text.indexOf(ch, i + 1);
            if (end > i) i = end;
            continue;
        }
        if (ch === '{') {
            stack.push({ prelude: text.slice(start, i).trim(), bodyStart: i + 1, hasChild: false });
            if (stack.length > 1) stack[stack.length - 2].hasChild = true;
            start = i + 1;
        } else if (ch === '}') {
            const frame = stack.pop();
            if (frame && !frame.hasChild && !frame.prelude.startsWith('@font-face')) {
                out.push({ selector: frame.prelude, body: text.slice(frame.bodyStart, i) });
            }
            start = i + 1;
        } else if (ch === ';' && stack.length === 0) {
            start = i + 1;
        }
    }
    return out;
}

function unquote(value) {
    return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function absoluteAssetPath(raw, cssWebPath) {
    const value = unquote(raw);
    if (!value || value.startsWith('data:') || /^[a-z]+:\/\//i.test(value) || value.startsWith('//')) return '';
    try {
        const url = new URL(value, `http://local${cssWebPath || '/'}`);
        return url.pathname;
    } catch (_err) {
        return '';
    }
}

/** Split at commas that are not inside parentheses. */
function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) {
            parts.push(text.slice(from, i));
            from = i + 1;
        }
    }
    parts.push(text.slice(from));
    return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Pictures a declaration block paints: plain url()s as paths, image-set()s as
 * [[path, density], ...] so the client holds only the one the screen picks.
 */
function blockImages(body, cssWebPath) {
    const images = [];
    let rest = body;
    let at = rest.search(/(?:-webkit-)?image-set\(/);
    while (at !== -1) {
        const open = rest.indexOf('(', at);
        let depth = 0;
        let close = -1;
        for (let i = open; i < rest.length; i++) {
            if (rest[i] === '(') depth++;
            else if (rest[i] === ')' && --depth === 0) { close = i; break; }
        }
        if (close === -1) break;
        const set = [];
        splitTopLevel(rest.slice(open + 1, close)).forEach((candidate) => {
            const m = /^(?:url\(\s*([^)]+?)\s*\)|(['"][^'"]+['"]))\s*(.*)$/.exec(candidate);
            if (!m) return;
            const file = absoluteAssetPath(m[1] || m[2], cssWebPath);
            if (!file || !BITMAP_RE.test(file)) return;
            const density = /([\d.]+)x\b/.exec(m[3] || '');
            set.push([file, density ? Number(density[1]) : 1]);
        });
        if (set.length === 1) images.push(set[0][0]);
        else if (set.length > 1) images.push(set);
        rest = rest.slice(0, at) + rest.slice(close + 1);
        at = rest.search(/(?:-webkit-)?image-set\(/);
    }
    const urlRe = /url\(\s*([^)]+?)\s*\)/g;
    let m;
    while ((m = urlRe.exec(rest))) {
        const file = absoluteAssetPath(m[1], cssWebPath);
        if (file && BITMAP_RE.test(file)) images.push(file);
    }
    return images;
}

/** @font-face families in css/fonts.css (the ones a font spec can load). */
function knownFontFamilies(publicDir) {
    const families = new Set();
    const css = stripComments(readText(path.join(publicDir, 'css', 'fonts.css')));
    const re = /@font-face\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
        const fam = /font-family\s*:\s*([^;]+)/.exec(m[1]);
        if (fam) families.add(unquote(fam[1]));
    }
    return families;
}

function blockFonts(body, families) {
    const out = [];
    const fam = /font-family\s*:\s*([^;]+)/i.exec(body);
    if (!fam) return out;
    const weightMatch = /font-weight\s*:\s*([^;]+)/i.exec(body);
    let weight = weightMatch ? weightMatch[1].trim() : '400';
    if (weight === 'bold') weight = '700';
    if (!/^\d+$/.test(weight)) weight = '400';
    splitTopLevel(fam[1]).forEach((name) => {
        const family = unquote(name);
        if (families.has(family)) out.push(`${weight} 16px "${family}"`);
    });
    return out;
}

function scriptAssets(text) {
    const out = [];
    let m;
    ASSET_LITERAL_RE.lastIndex = 0;
    while ((m = ASSET_LITERAL_RE.exec(text))) out.push(m[1].split('?')[0]);
    return out;
}

function readFeatureManifest(publicDir) {
    const src = readText(path.join(publicDir, 'scripts', 'comp', 'featureLoader.js'));
    const at = src.indexOf('const FEATURE_MANIFEST = ');
    if (at === -1) return {};
    const open = src.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) {
            try {
                return vm.runInNewContext(`(${src.slice(open, i + 1)})`, {}, { timeout: 1000 }) || {};
            } catch (_err) {
                return {};
            }
        }
    }
    return {};
}

function newGroup() {
    return { images: [], fonts: [] };
}

function addUnique(list, value) {
    const key = JSON.stringify(value);
    if (!list.some((v) => JSON.stringify(v) === key)) list.push(value);
}

function addStylesheet(group, publicDir, rel, families) {
    const webPath = `/${rel.replace(/^\/+/, '')}`;
    cssLeafRules(readText(path.join(publicDir, rel))).forEach((rule) => {
        blockImages(rule.body, webPath).forEach((img) => addUnique(group.images, img));
        blockFonts(rule.body, families).forEach((spec) => addUnique(group.fonts, spec));
    });
}

function addScript(group, publicDir, rel) {
    scriptAssets(readText(path.join(publicDir, rel))).forEach((img) => addUnique(group.images, img));
}

function listFiles(dir, ext) {
    try {
        return fs.readdirSync(dir).filter((name) => name.endsWith(ext)).sort();
    } catch (_err) {
        return [];
    }
}

function walkCss(dir, relBase, out) {
    let items = [];
    try {
        items = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_err) {
        return;
    }
    items.sort((a, b) => a.name.localeCompare(b.name)).forEach((item) => {
        const rel = `${relBase}/${item.name}`;
        if (item.isDirectory()) walkCss(path.join(dir, item.name), rel, out);
        else if (item.name.endsWith('.css') && !item.name.endsWith('.min.css') && !item.name.includes('.scoped.')) out.push(rel);
    });
}

function buildAppAssetManifest(projectRoot) {
    const publicDir = path.join(projectRoot, 'public');
    const families = knownFontFamilies(publicDir);
    const groups = {};
    const group = (id) => (groups[id] = groups[id] || newGroup());

    // featureLoader features
    const features = readFeatureManifest(publicDir);
    Object.keys(features).sort().forEach((name) => {
        const def = features[name] || {};
        const g = group(`feature:${name}`);
        (def.styles || []).forEach((rel) => addStylesheet(g, publicDir, rel, families));
        (def.scripts || []).forEach((rel) => addScript(g, publicDir, rel));
        if (def.html) addScript(g, publicDir, def.html);
    });

    // desktop apps
    const appNames = new Set([
        ...listFiles(path.join(publicDir, 'css', 'desktop-apps'), '.css').map((f) => f.replace(/\.css$/, '')),
        ...listFiles(path.join(publicDir, 'scripts', 'comp', 'desktop-apps'), '.js').map((f) => f.replace(/\.js$/, ''))
    ]);
    [...appNames].sort().forEach((name) => {
        if (SKIP_STYLESHEETS.has(`${name}.css`)) return;
        const g = group(`app:${name}`);
        const css = `css/desktop-apps/${name}.css`;
        if (fs.existsSync(path.join(publicDir, css))) addStylesheet(g, publicDir, css, families);
        const js = `scripts/comp/desktop-apps/${name}.js`;
        if (fs.existsSync(path.join(publicDir, js))) addScript(g, publicDir, js);
    });

    // windows: rules that name a window id, in every application stylesheet
    const sheets = [];
    walkCss(path.join(publicDir, 'css'), 'css', sheets);
    sheets.forEach((rel) => {
        if (SKIP_STYLESHEETS.has(path.basename(rel))) return;
        const webPath = `/${rel}`;
        cssLeafRules(readText(path.join(publicDir, rel))).forEach((rule) => {
            const ids = new Set();
            let m;
            WINDOW_ID_RE.lastIndex = 0;
            while ((m = WINDOW_ID_RE.exec(rule.selector))) ids.add(m[1]);
            if (!ids.size) return;
            const images = blockImages(rule.body, webPath);
            const fonts = blockFonts(rule.body, families);
            if (!images.length && !fonts.length) return;
            ids.forEach((id) => {
                const g = group(`window:${id}`);
                images.forEach((img) => addUnique(g.images, img));
                fonts.forEach((spec) => addUnique(g.fonts, spec));
            });
        });
    });

    // whole stylesheets named by a launcher (sheets)
    const sheetPrefixes = new Set();
    Object.values(LAUNCH_GROUPS).forEach((def) => (def.sheets || []).forEach((p) => sheetPrefixes.add(p)));
    sheets.forEach((rel) => {
        const name = path.basename(rel);
        if (SKIP_STYLESHEETS.has(name) || ![...sheetPrefixes].some((p) => name.startsWith(p))) return;
        addStylesheet(group(`sheet:${name.replace(/\.css$/, '')}`), publicDir, rel, families);
    });

    // drop empty groups
    Object.keys(groups).forEach((id) => {
        if (!groups[id].images.length && !groups[id].fonts.length) delete groups[id];
    });

    const windowIds = Object.keys(groups).filter((id) => id.startsWith('window:')).map((id) => id.slice(7));
    const windows = {};
    windowIds.sort().forEach((id) => { windows[id] = [`window:${id}`]; });

    const launch = {};
    Object.keys(LAUNCH_GROUPS).sort().forEach((launchId) => {
        const def = LAUNCH_GROUPS[launchId];
        const ids = [];
        (def.features || []).forEach((n) => { if (groups[`feature:${n}`]) ids.push(`feature:${n}`); });
        (def.apps || []).forEach((n) => { if (groups[`app:${n}`]) ids.push(`app:${n}`); });
        (def.sheets || []).forEach((prefix) => {
            Object.keys(groups).forEach((id) => {
                if (id.startsWith('sheet:') && id.slice(6).startsWith(prefix)) addUnique(ids, id);
            });
        });
        (def.windows || []).forEach((pattern) => {
            const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : null;
            windowIds.forEach((id) => {
                if (prefix ? id.startsWith(prefix) : id === pattern) addUnique(ids, `window:${id}`);
            });
        });
        if (ids.length) launch[launchId] = ids;
    });
    // A window opened directly (not from a launcher) also warms its application's groups
    Object.keys(launch).forEach((launchId) => {
        launch[launchId].filter((g) => g.startsWith('window:')).forEach((g) => {
            const id = g.slice(7);
            launch[launchId].forEach((other) => addUnique(windows[id], other));
        });
    });

    return { version: VERSION, groups: sortKeys(groups), windows: sortKeys(windows), launch };
}

function sortKeys(obj) {
    return Object.keys(obj).sort().reduce((acc, key) => { acc[key] = obj[key]; return acc; }, {});
}

/** Write public/data/app-assets.json when its content changed. Returns { changed, path, groups }. */
function writeAppAssetManifest(projectRoot) {
    const manifest = buildAppAssetManifest(projectRoot);
    const file = path.join(projectRoot, OUTPUT_REL);
    const text = `${JSON.stringify(manifest, null, 1)}\n`;
    if (readText(file) === text) return { changed: false, path: file, groups: Object.keys(manifest.groups).length };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
    return { changed: true, path: file, groups: Object.keys(manifest.groups).length };
}

module.exports = {
    OUTPUT_REL,
    LAUNCH_GROUPS,
    buildAppAssetManifest,
    writeAppAssetManifest,
    cssLeafRules,
    blockImages,
    blockFonts
};
