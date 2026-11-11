#!/usr/bin/env node
/**
 * Generate a Windows Mobile 6.1 style program icon for Melaton Mobile.
 *
 *   node scripts/generate-wm-icon.js --input "film clapperboard" --from "Director" --name director --small
 *   node scripts/generate-wm-icon.js --resave director          (re-render sizes from the stored master)
 *   node scripts/generate-wm-icon.js --help
 */

const fs = require('fs');
const path = require('path');
const wmIconGenerator = require('../modules/wmIconGenerator');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function printHelp() {
    console.log(`Generate a transparent WM 6.1 style program icon (GPT Image, transparent models only).

Writes public/static_images/wm61/app-<name>.png (16), @2x (32), @4x (64), -lg (32), -lg@2x (64),
-lg@4x (128) and their manifest.json entries. The 1024 px master stays in .cache/wm-icons/originals.
Style: docs/design/wm61-icon-style.md

Options:
  --input <text>     Physical subject of the icon (required to generate)
  --from <text>      Program the icon stands for (optional)
  --extra <text>     Required extra direction (optional, overrides the defaults)
  --ref <path>       Reference image, repeat up to 8 times (for example the desktop icon)
  --name <name>      Art name: teleport -> app-teleport (required)
  --small            Also generate the separately simplified 16 px frame (a second request)
  --small-only       Only (re)generate the 16 px frame from the stored master
  --model <id>       Transparent GPT Image model (default ${wmIconGenerator.DEFAULT_MODEL})
  --quality <level>  low, medium, high (2.5 also xhigh, max; default ${wmIconGenerator.DEFAULT_QUALITY})
  --inset <0-0.2>    Margin around the body (default ${wmIconGenerator.WM_INSET})
  --resave <name>    Re-render the sizes from the stored master(s); no API call
  --force            Replace an existing master
  --no-save          Store the master only (frame it later in scripts/wm-icon-studio.js)
  --dry-run          Print the prompt(s) and do not call the API
  --json             Print one JSON object on success
  --help             Show this help

Key: OPENAI_API_KEY, otherwise the OpenAI key in secure.config.json.
`);
}

function parseArgs(argv) {
    const opts = { refs: [], small: false, smallOnly: false, force: false, save: true, dryRun: false, json: false, help: false };
    const valued = { '--input': 'input', '--from': 'from', '--extra': 'extra', '--name': 'name', '--model': 'model', '--quality': 'quality', '--inset': 'inset', '--ref': 'ref', '--resave': 'resave' };
    const flags = { '--small': 'small', '--small-only': 'smallOnly', '--force': 'force', '--dry-run': 'dryRun', '--json': 'json', '--help': 'help', '-h': 'help' };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (flags[arg]) { opts[flags[arg]] = true; continue; }
        if (arg === '--no-save') { opts.save = false; continue; }
        const eq = arg.indexOf('=');
        const flag = eq > 0 ? arg.slice(0, eq) : arg;
        const key = valued[flag];
        if (!key) throw new wmIconGenerator.AppIconError(`Unknown argument "${arg}".`);
        let value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
        if (value === undefined || (eq < 0 && String(value).startsWith('--'))) throw new wmIconGenerator.AppIconError(`${flag} needs a value.`);
        if (key === 'ref') opts.refs.push(value);
        else opts[key] = value;
    }
    if (opts.inset !== undefined) {
        const n = Number(opts.inset);
        if (!Number.isFinite(n) || n < 0 || n > 0.2) throw new wmIconGenerator.AppIconError('--inset must be from 0 to 0.2.');
        opts.inset = n;
    }
    return opts;
}

async function main() {
    const argv = process.argv.slice(2);
    const opts = parseArgs(argv);
    if (opts.help || argv.length === 0) {
        printHelp();
        process.exit(opts.help ? 0 : 2);
    }
    if (opts.resave) {
        const saved = await wmIconGenerator.saveWmIcon({ projectRoot: PROJECT_ROOT, name: opts.resave, inset: opts.inset, input: opts.input, from: opts.from, model: opts.model });
        if (opts.json) console.log(JSON.stringify({ name: saved.name, hasSmall: saved.hasSmall, crop: saved.crop, written: saved.written.map((f) => path.relative(PROJECT_ROOT, f)) }));
        else saved.written.forEach((f) => console.log(path.relative(PROJECT_ROOT, f)));
        return;
    }
    if (!opts.name) throw new wmIconGenerator.AppIconError('--name is required, for example --name teleport.');
    const result = await wmIconGenerator.generateWmIcon({
        projectRoot: PROJECT_ROOT,
        input: opts.input,
        from: opts.from,
        extra: opts.extra,
        name: opts.name,
        model: opts.model,
        quality: opts.quality,
        inset: opts.inset,
        small: opts.small,
        smallOnly: opts.smallOnly,
        force: opts.force,
        save: opts.save,
        dryRun: opts.dryRun,
        references: opts.refs.map((file) => {
            const abs = path.resolve(file);
            if (!fs.existsSync(abs)) throw new wmIconGenerator.AppIconError(`Reference not found: ${file}`);
            return { buffer: fs.readFileSync(abs), name: path.basename(abs) };
        })
    });
    if (opts.json) {
        console.log(JSON.stringify({
            dryRun: result.dryRun, name: result.name, model: result.model, quality: result.quality,
            prompt: result.prompt, smallPrompt: result.smallPrompt || null,
            master: path.relative(PROJECT_ROOT, result.masterPath),
            small: result.smallPath ? path.relative(PROJECT_ROOT, result.smallPath) : null,
            transparentRatio: result.alpha ? result.alpha.transparentRatio : null,
            written: result.saved ? result.saved.written.map((f) => path.relative(PROJECT_ROOT, f)) : []
        }));
        return;
    }
    if (result.dryRun) {
        console.log(result.prompt);
        if (result.smallPrompt) console.log(`\n--- 16 px frame ---\n${result.smallPrompt}`);
        console.log(`\ndry-run: no request sent (${result.model}, ${result.quality})`);
        return;
    }
    console.log(`master: ${path.relative(PROJECT_ROOT, result.masterPath)}`);
    if (result.smallPath) console.log(`16 px master: ${path.relative(PROJECT_ROOT, result.smallPath)}`);
    if (result.alpha && result.alpha.transparentRatio < 0.05) console.error('Warning: almost no transparent pixels; the model may have painted a backdrop.');
    if (result.saved) result.saved.written.forEach((f) => console.log(path.relative(PROJECT_ROOT, f)));
}

main().catch((err) => {
    console.error(`Error: ${err && err.message ? err.message : err}`);
    process.exit(err && err.code === 'USAGE' ? 2 : 1);
});
