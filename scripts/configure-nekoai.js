#!/usr/bin/env node
/**
 * Select nekoai-js from npm (default) or a local checkout before pnpm install.
 *
 * Environment:
 *   NEKOAI_JS_SOURCE   registry | local   (default: registry)
 *   NEKOAI_JS_PATH     path to local repo when source=local (default: ../NekoAI-JS)
 *   NEKOAI_JS_VERSION  semver/range for registry (default: ^1.2.5)
 *
 * Usage:
 *   node scripts/configure-nekoai.js
 *   NEKOAI_JS_SOURCE=local NEKOAI_JS_PATH=/path/to/NekoAI-JS node scripts/configure-nekoai.js && pnpm install
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');

const SOURCE = (process.env.NEKOAI_JS_SOURCE || 'registry').toLowerCase();
const LOCAL_PATH = process.env.NEKOAI_JS_PATH || '../NekoAI-JS';
const REGISTRY_VERSION = process.env.NEKOAI_JS_VERSION || '^1.2.5';

function toFileSpec(absPath) {
    let rel = path.relative(ROOT, absPath);
    if (!rel.startsWith('.')) {
        rel = './' + rel;
    }
    return 'file:' + rel.split(path.sep).join('/');
}

function resolveNekoaiSpec() {
    if (SOURCE === 'local') {
        const abs = path.isAbsolute(LOCAL_PATH)
            ? LOCAL_PATH
            : path.resolve(ROOT, LOCAL_PATH);
        if (!fs.existsSync(abs)) {
            console.error(`NEKOAI_JS_SOURCE=local but path does not exist: ${abs}`);
            process.exit(1);
        }
        const pkgJson = path.join(abs, 'package.json');
        if (!fs.existsSync(pkgJson)) {
            console.error(`NEKOAI_JS_SOURCE=local but ${pkgJson} is missing`);
            process.exit(1);
        }
        return toFileSpec(abs);
    }

    if (SOURCE === 'registry') {
        return REGISTRY_VERSION;
    }

    console.error(`Unknown NEKOAI_JS_SOURCE="${SOURCE}" (use registry or local)`);
    process.exit(1);
}

function main() {
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
    const next = resolveNekoaiSpec();
    const prev = pkg.dependencies['nekoai-js'];

    if (prev === next) {
        console.log(`nekoai-js unchanged (${next})`);
        return;
    }

    pkg.dependencies['nekoai-js'] = next;
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`nekoai-js: ${prev || '(missing)'} -> ${next}`);
    console.log('Run pnpm install to refresh the lockfile.');
}

main();
