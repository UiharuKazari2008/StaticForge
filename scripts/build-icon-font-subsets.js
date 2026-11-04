#!/usr/bin/env node
/**
 * Icon font subsets (idle perf pass, 2026-11-04). Font Awesome, Material Design Icons and Remix
 * Icon put ~21,000 one-icon rules into every page (10,559 + 7,474 + 3,153 of the page's ~34,800)
 * while the app names ~650 of their icons. This writes subset sheets that keep every rule except
 * the one-icon `:before` / `:after` content rules nobody names: @font-face, the base and style
 * classes and the helpers (sizes, spin, rotate, stacks) stay. An alias list keeps only the names used.
 *
 * Icon names come from public/ (scripts, pages, CSS; dist/ left out), modules/ (server data such
 * as apiKeyManager's provider icons), apps/ (bundled Melaton packages) and data/, including the
 * quoted words of a `fa-${cond ? 'a' : 'b'}` template. Rerun after using a new icon:
 *   node scripts/build-icon-font-subsets.js           write the subsets
 *   node scripts/build-icon-font-subsets.js --check   exit 1 when a subset is stale
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SETS = [
    {
        prefix: 'fa',
        from: 'public/dist/fontawesome/css/all.min.css',
        to: 'public/dist/fontawesome/css/all.subset.css'
    },
    {
        prefix: 'mdi',
        from: 'public/dist/mdi/materialdesignicons.min.css',
        to: 'public/dist/mdi/materialdesignicons.subset.css'
    },
    {
        prefix: 'ri',
        from: 'public/dist/remixicon/remixicon.css',
        to: 'public/dist/remixicon/remixicon.subset.css'
    }
];
const SCAN = ['public', 'modules', 'apps', 'data'];
const SKIP_DIRS = new Set(['dist', 'node_modules', '.git', 'static_images', 'fonts', 'melaton-mockups']);
const EXTS = new Set(['.js', '.mjs', '.html', '.css', '.json']);

function walk(dir, out) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) {
            if (!SKIP_DIRS.has(ent.name)) walk(path.join(dir, ent.name), out);
        } else if (EXTS.has(path.extname(ent.name)) && !/\.min\./.test(ent.name) && !/\.subset\.css$/.test(ent.name)) {
            out.push(path.join(dir, ent.name));
        }
    }
    return out;
}

function usedNames(prefix) {
    const re = new RegExp(`(?:^|[^\\w-])${prefix}-([a-z0-9]+(?:-[a-z0-9]+)*)`, 'g');
    const names = new Set();
    const templ = new RegExp(`${prefix}-\\$\\{([^}]*)\\}`, 'g');
    for (const root of SCAN) {
        if (!fs.existsSync(path.join(ROOT, root))) continue;
        for (const file of walk(path.join(ROOT, root), [])) {
            const text = fs.readFileSync(file, 'utf8');
            let m;
            while ((m = re.exec(text))) names.add(m[1]);
            while ((m = templ.exec(text))) {
                for (const q of m[1].matchAll(/['"]([a-z0-9-]+)['"]/g)) names.add(q[1]);
            }
        }
    }
    return names;
}

/** Top-level rules of a stylesheet (comments dropped), brace-matched. */
function splitRules(css) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    let depth = 0;
    let start = 0;
    let quote = null;
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'") quote = c;
        else if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) {
                rules.push(css.slice(start, i + 1).trim());
                start = i + 1;
            }
        }
    }
    return rules.filter(Boolean);
}

// Font Awesome styles whose faces go only when no scanned file uses the style's class (as a whole
// word in markup or a class string): thin is Pro weight 100, sharp the two Sharp families.
const FA_OPTIONAL_STYLES = [
    { name: 'thin', classes: ['fa-thin', 'fat'], face: (family, weight) => family === 'Font Awesome 6 Pro' && weight === '100' },
    { name: 'sharp', classes: ['fa-sharp', 'fass', 'fasr', 'fasl', 'fast'], face: (family) => family === 'Font Awesome 6 Sharp' },
    { name: 'sharp duotone', classes: ['fa-sharp-duotone', 'fasds'], face: (family) => family === 'Font Awesome 6 Sharp Duotone' }
];

function styleUsed(classes) {
    // a class token next to fa-<icon>, e.g. class="fa-thin fa-house" or 'fast fa-house'
    const re = new RegExp(`(?:^|[\\s"'\`])(?:${classes.join('|')})\\s+fa-[a-z0-9-]+`);
    for (const root of SCAN) {
        if (!fs.existsSync(path.join(ROOT, root))) continue;
        for (const file of walk(path.join(ROOT, root), [])) {
            // the boot's font preload lists name every style on purpose
            if (/assetPreload\.js$|modalUtils\.js$/.test(file)) continue;
            if (re.test(fs.readFileSync(file, 'utf8'))) return true;
        }
    }
    return false;
}

function buildSubset(set) {
    const css = fs.readFileSync(path.join(ROOT, set.from), 'utf8');
    const used = usedNames(set.prefix);
    // one icon: `.mdi-name::before{content:"\F0001"}`, `.ri-name:before { content: "\eaf1"; }`,
    // `.fa-a:before,.fa-b:before{content:""}`, `.fa-duotone.fa-0:after,.fad.fa-0:after{content:"00"}`:
    // every selector ends in the icon class and a :before / :after, and the only declaration is content
    const selectorRe = new RegExp(`^(?:\\.[a-z0-9-]+)*?\\.${set.prefix}-([a-z0-9-]+)::?(?:before|after)$`);
    const bodyRe = /^\{\s*content\s*:[^;{}]*;?\s*\}$/;
    const kept = [];
    let dropped = 0;
    let icons = 0;
    const dropFaces = set.prefix === 'fa' ? FA_OPTIONAL_STYLES.filter((st) => !styleUsed(st.classes)) : [];
    let facesDropped = 0;
    for (const rule of splitRules(css)) {
        if (dropFaces.length && rule.startsWith('@font-face')) {
            const family = (/font-family:\s*"([^"]+)"/.exec(rule) || [])[1] || '';
            const weight = (/font-weight:\s*(\d+)/.exec(rule) || [])[1] || '';
            if (dropFaces.some((st) => st.face(family, weight))) {
                facesDropped++;
                continue;
            }
        }
        const brace = rule.indexOf('{');
        const selectors = rule.slice(0, brace).split(',').map((sel) => sel.trim());
        const body = rule.slice(brace);
        const parsed = bodyRe.test(body) ? selectors.map((sel) => selectorRe.exec(sel)) : [];
        if (!parsed.length || parsed.some((m) => !m)) {
            kept.push(rule);
            continue;
        }
        const keep = selectors.filter((sel, i) => used.has(parsed[i][1]));
        if (!keep.length) {
            dropped++;
            continue;
        }
        icons++;
        kept.push(keep.join(',') + body);
    }
    const header = `/* Generated by scripts/build-icon-font-subsets.js from ${path.basename(set.from)}: ` +
        `${icons} named icons kept, ${dropped} unused icon rules dropped` +
        (dropFaces.length ? `, ${facesDropped} faces of unused styles (${dropFaces.map((st) => st.name).join(', ')}) dropped` : '') +
        '. Do not edit. */\n';
    return { text: header + kept.join('\n') + '\n', icons, dropped, facesDropped };
}

function main() {
    const check = process.argv.includes('--check');
    let stale = false;
    for (const set of SETS) {
        const { text, icons, dropped, facesDropped } = buildSubset(set);
        const target = path.join(ROOT, set.to);
        const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
        if (check) {
            if (current !== text) {
                stale = true;
                console.error(`[icon-subsets] ${set.to} is stale: run node scripts/build-icon-font-subsets.js`);
            }
            continue;
        }
        if (current !== text) fs.writeFileSync(target, text);
        console.log(`[icon-subsets] ${set.to}: ${icons} icons, ${dropped} unused icon rules dropped` +
            (facesDropped ? `, ${facesDropped} unused style faces dropped` : ''));
    }
    if (stale) process.exit(1);
}

main();
