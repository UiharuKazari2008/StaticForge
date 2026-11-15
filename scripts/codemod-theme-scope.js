#!/usr/bin/env node
/**
 * Codemod: the Vista scope by its name (docs/design/ui-standard.md section 1, Yozora #851 / #864).
 *
 *   body:not(.windows-classic-theme) ...              ->  body.theme-vista ...
 *   body.desktop-mode:not(.windows-classic-theme) ... ->  body.desktop-mode.theme-vista ...
 *
 * A text swap on the same element: `:not(.windows-classic-theme)` and `.theme-vista` are one class
 * of specificity each, and public/scripts/comp/uiTheme.js keeps body.theme-vista on exactly while
 * body.windows-classic-theme is off, so every rule matches what it matched before. Nothing else
 * in a selector moves.
 *
 * Only run this after every client has taken uiTheme.js (the phase before): a client whose page
 * has no body.theme-vista would lose every Vista rule.
 *
 *   node scripts/codemod-theme-scope.js --dry-run     per-file counts and the skipped sites
 *   node scripts/codemod-theme-scope.js --write       rewrite the files
 *   node scripts/codemod-theme-scope.js --check       exit 1 while anything is left to rewrite
 *   --root <dir>                                      another checkout (a worktree)
 *
 * What it rewrites:
 *   CSS    every .css under public/css and apps/<id>/ (not node_modules, not *.min.css).
 *          A site is rewritten when the :not() sits on a compound whose type selector is `body`,
 *          at any nesting (inside :is() / :where() / :not() / :has() the swap is still the same
 *          test on the same element). A site is SKIPPED and listed, never guessed, when the
 *          compound is not `body` (html:not(...), .modal:not(...), :is(body, x):not(...)) or
 *          the class shares its :not() with other arguments. Comments are left as they are.
 *   JS     the generators that emit the scope and the tests that assert on it (GENERATORS and
 *          every scripts/test-*.js): the same swap inside string, template and regex text
 *          (`:not\(\.windows-classic-theme\)` and its doubly escaped form keep their escaping).
 *          After --write run the generators; their output must equal the rewritten CSS:
 *              node scripts/build-vista-scrollbars.js && node scripts/generate-vista-fa-icons.js
 *              git diff --stat   (no further change to vista-scrollbars.css / vista-fa-icons.css)
 *
 * Idempotent: a second run finds nothing. scripts/check-ui-standard.js keeps its own pattern for
 * the old scope (rule theme-negative) and is never rewritten.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OLD_CLASS = 'windows-classic-theme';
const NEW_CLASS = 'theme-vista';

// Scripts that write the scope into generated CSS.
const GENERATORS = [
    'scripts/build-vista-scrollbars.js',      // public/css/vista-scrollbars.css (+ -frame.css)
    'scripts/generate-vista-fa-icons.js'      // public/css/vista-fa-icons.css
];
// Never rewritten: they name the old scope on purpose.
const KEEP = new Set(['scripts/codemod-theme-scope.js', 'scripts/check-ui-standard.js']);

const SITE = /:not\(\s*\.windows-classic-theme\s*\)/g;

/** Comments blanked (same length), so offsets in the result are offsets in the text. */
function maskCssComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Start of the compound selector that ends just before `at` (walks back over simple selectors). */
function compoundStart(text, at) {
    let i = at;
    while (i > 0) {
        const c = text[i - 1];
        if (c === ')' || c === ']') {
            const open = c === ')' ? '(' : '[';
            let depth = 0;
            let j = i - 1;
            for (; j >= 0; j--) {
                if (text[j] === c) depth++;
                else if (text[j] === open && --depth === 0) break;
            }
            if (j < 0) return -1;
            i = j;
            continue;
        }
        if (/[A-Za-z0-9_\-.#:*\\&|]/.test(c)) { i--; continue; }
        break;
    }
    return i;
}

function lineOf(text, at) {
    let n = 1;
    for (let i = 0; i < at; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
}

function excerpt(text, at) {
    const a = text.lastIndexOf('\n', at) + 1;
    let b = text.indexOf('\n', at);
    if (b < 0) b = text.length;
    return text.slice(a, b).trim().slice(0, 160);
}

/**
 * Rewrite one stylesheet's text.
 * @returns {{ text: string, changed: number, nested: number, skipped: Array<{line:number, why:string, text:string}>, inComments: number }}
 */
function transformCss(text) {
    const masked = maskCssComments(text);
    const skipped = [];
    const edits = [];
    let nested = 0;
    let m;
    SITE.lastIndex = 0;
    while ((m = SITE.exec(masked))) {
        const at = m.index;
        const start = compoundStart(masked, at);
        const compound = start < 0 ? '' : masked.slice(start, at);
        if (!/^body(?![A-Za-z0-9_-])/.test(compound)) {
            skipped.push({ line: lineOf(text, at), why: 'the :not() is not on a body compound (' + (compound || 'no type selector') + ')', text: excerpt(text, at) });
            continue;
        }
        // nesting is reported, not refused: the swap is the same test on the same element
        let depth = 0;
        for (let i = start - 1; i >= 0; i--) {
            const c = masked[i];
            if (c === '{' || c === '}' || c === ';') break;
            if (c === ')') depth--;
            else if (c === '(') depth++;
        }
        if (depth > 0) nested++;
        edits.push({ at, len: m[0].length });
    }
    // the class inside a :not() with other arguments, or any other spelling this does not know
    const OTHER = /:not\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
    while ((m = OTHER.exec(masked))) {
        if (m[1].indexOf('.' + OLD_CLASS) === -1) continue;
        if (/^\s*\.windows-classic-theme\s*$/.test(m[1])) continue;
        skipped.push({ line: lineOf(text, m.index), why: 'the class shares its :not() with other arguments', text: excerpt(text, m.index) });
    }
    let out = text;
    for (let i = edits.length - 1; i >= 0; i--) {
        out = out.slice(0, edits[i].at) + '.' + NEW_CLASS + out.slice(edits[i].at + edits[i].len);
    }
    const all = (text.match(SITE) || []).length;
    const live = (masked.match(SITE) || []).length;
    return { text: out, changed: edits.length, nested, skipped, inComments: all - live };
}

/**
 * Rewrite a generator's or a test's source: the scope inside string, template and regex text.
 * `body...:not(.windows-classic-theme)` with the backslashes of a regex literal (one) or of a
 * regex built from a string (two) in front of ( . ) kept on the new class's dot.
 */
function transformJs(text) {
    const JS_SITE = /(body(?:\\{0,2}\.[A-Za-z0-9_-]+)*):not(\\{0,2})\((\\{0,2})\.windows-classic-theme(\\{0,2})\)/g;
    let changed = 0;
    const out = text.replace(JS_SITE, (whole, body, e1, e2) => { changed++; return body + e2 + '.' + NEW_CLASS; });
    const left = [];
    const LEFT = /not\\{0,2}\(\\{0,2}\.windows-classic-theme/g;
    let m;
    while ((m = LEFT.exec(out))) left.push({ line: lineOf(out, m.index), why: 'old scope not on a literal body compound (edit by hand)', text: excerpt(out, m.index) });
    return { text: out, changed, skipped: left };
}

function walk(root, dir, test, out) {
    let list;
    try { list = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch (e) { return out; }
    list.forEach((d) => {
        const rel = dir + '/' + d.name;
        if (d.isDirectory()) {
            if (/^(node_modules|vendor|\.cache|\.git|server)$/.test(d.name)) return;
            walk(root, rel, test, out);
        } else if (test(d.name)) out.push(rel);
    });
    return out;
}

function main() {
    const args = process.argv.slice(2);
    const flag = (name) => args.indexOf(name) !== -1;
    const rootAt = args.indexOf('--root');
    const root = path.resolve(rootAt !== -1 ? args[rootAt + 1] : path.join(__dirname, '..'));
    const write = flag('--write');
    const check = flag('--check');
    if (!write && !check && !flag('--dry-run')) {
        console.log('usage: node scripts/codemod-theme-scope.js --dry-run | --write | --check  [--root <dir>]');
        process.exit(2);
    }

    const isCss = (n) => /\.css$/.test(n) && !/\.min\.css$/.test(n);
    const cssFiles = walk(root, 'public/css', isCss, []).concat(walk(root, 'apps', isCss, [])).sort();
    const jsFiles = GENERATORS.concat(walk(root, 'scripts', (n) => /^test-.*\.js$/.test(n), []).sort())
        .filter((f) => !KEEP.has(f) && fs.existsSync(path.join(root, f)));

    let total = 0;
    let files = 0;
    let nested = 0;
    let inComments = 0;
    const skipped = [];
    const rows = [];
    const run = (file, transform, kind) => {
        const full = path.join(root, file);
        const text = fs.readFileSync(full, 'utf8');
        if (text.indexOf(OLD_CLASS) === -1) return;
        const r = transform(text);
        (r.skipped || []).forEach((s) => skipped.push(Object.assign({ file }, s)));
        nested += r.nested || 0;
        inComments += r.inComments || 0;
        if (!r.changed) return;
        total += r.changed;
        files += 1;
        rows.push(String(r.changed).padStart(6) + '  ' + file + (kind ? '  [' + kind + ']' : ''));
        if (write) fs.writeFileSync(full, r.text);
    };
    cssFiles.forEach((f) => run(f, transformCss, ''));
    const cssTotal = total;
    const cssFilesChanged = files;
    jsFiles.forEach((f) => run(f, transformJs, GENERATORS.indexOf(f) !== -1 ? 'generator' : 'test'));

    rows.forEach((r) => console.log(r));
    console.log('');
    console.log((write ? 'Rewrote ' : 'Would rewrite ') + total + ' site(s) in ' + files + ' file(s): '
        + cssTotal + ' in ' + cssFilesChanged + ' stylesheet(s), ' + (total - cssTotal) + ' in ' + (files - cssFilesChanged) + ' generator / test script(s).');
    if (nested) console.log(nested + ' of them sit inside :is() / :where() / :not() / :has() (same test on body, rewritten).');
    if (inComments) console.log(inComments + ' mention(s) inside CSS comments left as they are.');
    if (skipped.length) {
        console.log('');
        console.log('Skipped, to edit by hand (' + skipped.length + '):');
        skipped.forEach((s) => console.log('  ' + s.file + ':' + s.line + '  ' + s.why + '\n      ' + s.text));
    }
    if (write && total) {
        console.log('');
        console.log('Now run the generators and see that they change nothing further:');
        console.log('  node scripts/build-vista-scrollbars.js && node scripts/generate-vista-fa-icons.js && git status --short public/css');
    }
    if (check && (total || skipped.length)) process.exit(1);
}

module.exports = { transformCss, transformJs, GENERATORS };

if (require.main === module) main();
