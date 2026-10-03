#!/usr/bin/env node
/**
 * Generate a transparent Windows Vista / Frutiger Aero start-menu icon.
 *
 *   node scripts/generate-app-icon.js --input "leather notebook with sticky notes and a pen" --from "Notepad" --name notebook
 *   node scripts/generate-app-icon.js --help
 */

const fs = require('fs');
const path = require('path');
const appIconGenerator = require('../modules/appIconGenerator');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function printHelp() {
    const models = appIconGenerator.TRANSPARENT_MODELS.join(', ');
    console.log(`Generate a transparent start-menu app icon (GPT Image, transparent models only).

Options:
  --input <text>     Physical subject of the icon (required)
  --from <text>      Job the icon is doing or replacing (optional)
  --extra <text>     Required extra direction (optional, overrides the default palette)
  --ref <path>       Reference image, repeat up to 8 times (png, jpg, webp)
  --name <file>      Master filename without .png (required)
  --model <id>       Transparent GPT Image model (default ${appIconGenerator.DEFAULT_MODEL})
  --quality <level>  low, medium, or high (2.5 also allows xhigh and max; default ${appIconGenerator.DEFAULT_QUALITY})
  --size <WxH>       Square master size (only ${appIconGenerator.DEFAULT_SIZE})
  --out-dir <path>   Write here instead of public/static_images/app_icons
  --force            Replace an existing master
  --no-compile       Skip the runtime size variants
  --dry-run          Print the prompt and do not call the API
  --json             Print one JSON object on success
  --help             Show this help

Models:
  ${models}
  Default is gpt-image-2.5-sunburst. gpt-image-2.5-flare is the faster 2.5 model.
  gpt-image-2 is omitted. The API rejects background=transparent for it.

Key:
  OPENAI_API_KEY, otherwise the OpenAI key in secure.config.json.

Examples:
  node scripts/generate-app-icon.js --input "leather notebook with sticky notes and a pen" --from "Notepad" --extra "yellow, cyan, and green notes" --name notebook
  node scripts/generate-app-icon.js --input "brass weather vane" --from "Weather" --name weather --dry-run
  node scripts/generate-app-icon.js --input "glass calculator" --from "Calculator" --name calc --ref ./photo.png --quality low --json
`);
}

function takeValue(argv, index, flag) {
    const arg = argv[index];
    if (arg === flag) {
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            throw new appIconGenerator.AppIconError(`${flag} needs a value.`);
        }
        return { value: next, consumed: 2 };
    }
    const prefix = `${flag}=`;
    if (arg.startsWith(prefix)) {
        return { value: arg.slice(prefix.length), consumed: 1 };
    }
    return null;
}

function parseArgs(argv) {
    const opts = {
        input: '',
        from: '',
        extra: '',
        refs: [],
        name: '',
        model: appIconGenerator.DEFAULT_MODEL,
        quality: appIconGenerator.DEFAULT_QUALITY,
        size: appIconGenerator.DEFAULT_SIZE,
        outDir: '',
        force: false,
        compile: true,
        dryRun: false,
        json: false,
        help: false
    };
    const valued = {
        '--input': 'input',
        '--from': 'from',
        '--extra': 'extra',
        '--name': 'name',
        '--model': 'model',
        '--quality': 'quality',
        '--size': 'size',
        '--out-dir': 'outDir',
        '--ref': 'ref'
    };
    for (let i = 0; i < argv.length;) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            opts.help = true;
            i += 1;
            continue;
        }
        if (arg === '--force') {
            opts.force = true;
            i += 1;
            continue;
        }
        if (arg === '--dry-run') {
            opts.dryRun = true;
            i += 1;
            continue;
        }
        if (arg === '--json') {
            opts.json = true;
            i += 1;
            continue;
        }
        if (arg === '--no-compile') {
            opts.compile = false;
            i += 1;
            continue;
        }
        let matched = false;
        for (const [flag, key] of Object.entries(valued)) {
            const taken = takeValue(argv, i, flag);
            if (!taken) continue;
            if (key === 'ref') opts.refs.push(taken.value);
            else opts[key] = taken.value;
            i += taken.consumed;
            matched = true;
            break;
        }
        if (!matched) {
            throw new appIconGenerator.AppIconError(`Unknown argument "${arg}".`);
        }
    }
    return opts;
}

function printResult(result, asJson) {
    if (asJson) {
        const payload = {
            dryRun: result.dryRun === true,
            path: result.path,
            model: result.model,
            quality: result.quality,
            size: result.size,
            prompt: result.prompt
        };
        if (!result.dryRun) {
            payload.bytes = result.bytes;
            payload.background = result.background;
            payload.transparentRatio = result.alpha ? result.alpha.transparentRatio : 0;
            payload.width = result.alpha ? result.alpha.width : null;
            payload.height = result.alpha ? result.alpha.height : null;
            payload.compiled = result.compiled === true;
            payload.keySource = result.keySource;
        }
        console.log(JSON.stringify(payload));
        return;
    }
    if (result.dryRun) {
        console.log(result.prompt);
        console.log('');
        console.log(`dry-run: no request sent`);
        console.log(`model: ${result.model}`);
        console.log(`path: ${result.path}`);
        return;
    }
    const ratio = result.alpha ? (result.alpha.transparentRatio * 100).toFixed(1) : '0.0';
    console.log(`path: ${result.path}`);
    console.log(`model: ${result.model}`);
    console.log(`bytes: ${result.bytes}`);
    console.log(`transparent: ${ratio}%`);
    console.log(`compiled: ${result.compiled ? 'yes' : 'no'}`);
    if (result.alpha && result.alpha.transparentRatio < 0.05) {
        console.error(`Warning: almost no transparent pixels. The model may have painted a backdrop. Try again or switch --model ${appIconGenerator.DEFAULT_MODEL}.`);
    }
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help || process.argv.slice(2).length === 0) {
        printHelp();
        process.exit(opts.help ? 0 : 2);
    }
    if (!opts.name) {
        throw new appIconGenerator.AppIconError('--name is required, for example --name notebook.');
    }
    const result = await appIconGenerator.generateAppIcon({
        projectRoot: PROJECT_ROOT,
        input: opts.input,
        from: opts.from,
        extra: opts.extra,
        references: opts.refs.map((file) => {
            const abs = path.resolve(file);
            if (!fs.existsSync(abs)) {
                throw new appIconGenerator.AppIconError(`Reference not found: ${file}`);
            }
            return { buffer: fs.readFileSync(abs), name: path.basename(abs) };
        }),
        name: opts.name,
        model: opts.model,
        quality: opts.quality,
        size: opts.size,
        outDir: opts.outDir || undefined,
        force: opts.force,
        compile: opts.compile,
        dryRun: opts.dryRun
    });
    printResult(result, opts.json);
}

main().catch((err) => {
    const message = err && err.message ? err.message : String(err);
    console.error(`Error: ${message}`);
    if (!err || err.code === 'USAGE') {
        console.error('  node scripts/generate-app-icon.js --input "leather notebook with sticky notes and a pen" --from "Notepad" --name notebook');
        process.exit(2);
    }
    process.exit(1);
});
