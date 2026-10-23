#!/usr/bin/env node
/**
 * Build a Melaton app (Yozora #638, #640) from a source tree (apps/<id>/ or any folder with a
 * manifest.json) into a distributable:
 *
 *   node scripts/build-melaton-app.js <src> --exe <out.exe>   a Windows EXE carrying the package
 *   node scripts/build-melaton-app.js <src> --zip <out.msaz>  the plain package zip
 *
 * The .exe is a real Windows program (shows "This application can only run on Melaton OS." on a
 * normal PC) with the app's package appended (modules/melatonApps/exeContainer.js). The stub is
 * compiled per app so it carries the app's icon, title and version:
 *
 *   --stub-on-vm        compile the stub on the Vista VM (csc; ~/.config/vista-vm/vm.sh), default
 *                       for --exe. The app's icon.png -> .ico (modules/melatonApps/ico.js), the
 *                       title / publisher / version substituted into apps/_stub/MelatonStub.cs.tmpl.
 *   --stub <file.exe>   use a prebuilt stub instead (no VM; the stub's own generic icon is kept)
 *
 * The package follows the manifest contract (docs/client-api/melaton-apps.md); the manifest is
 * validated before anything is built.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const { validateManifest } = require('../modules/melatonPackageStore');
const { buildIco } = require('../modules/melatonApps/ico');
const { wrapPackageExe, isMelatonExe, exeOverlayOffset } = require('../modules/melatonApps/exeContainer');

const REPO = path.resolve(__dirname, '..');
const STUB_DIR = path.join(REPO, 'apps/_stub');
const VM = path.join(os.homedir(), '.config/vista-vm/vm.sh');

function arg(name) {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : null;
}
const has = (name) => process.argv.includes(name);

/** The package zip from a source tree: every file under src, manifest.json at the root. */
function packZip(src) {
    const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')));
    const zip = new AdmZip();
    const walk = (rel) => {
        for (const ent of fs.readdirSync(path.join(src, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const r = rel ? `${rel}/${ent.name}` : ent.name;
            if (ent.isDirectory()) walk(r);
            else if (ent.isFile()) zip.addFile(r, fs.readFileSync(path.join(src, r)));
        }
    };
    walk('');
    return { manifest, zip: zip.toBuffer() };
}

async function iconFromManifest(src, manifest) {
    if (!manifest.icon) return null;
    const sharp = require('sharp');
    const master = path.join(src, manifest.icon);
    const imgs = [];
    for (const size of [16, 32, 48]) {
        imgs.push({ size, rgba: await sharp(master).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().raw().toBuffer() });
    }
    imgs.push({ size: 256, png: await sharp(master).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer() });
    return buildIco(imgs);
}

function versionQuad(version) {
    return String(version || '1.0.0.0').split(/[.\s]+/).map((p) => Math.min(65535, parseInt(p, 10) || 0)).concat([0, 0, 0, 0]).slice(0, 4).join('.');
}

/** Compile the per-app stub on the Vista VM; returns its bytes. */
function compileStubOnVm(src, manifest, ico) {
    if (!fs.existsSync(VM)) throw new Error('the Vista VM helper is not set up; pass --stub <file.exe>');
    const work = `C:\\\\agent\\\\melaton-build`;
    const tmpl = fs.readFileSync(path.join(STUB_DIR, 'MelatonStub.cs.tmpl'), 'utf8');
    const esc = (s) => String(s || '').replace(/"/g, '').replace(/[\r\n]/g, ' ');
    const cs = tmpl
        .replace(/@@TITLE@@/g, esc(manifest.title))
        .replace(/@@PUBLISHER@@/g, esc(manifest.publisher || 'Xyridian'))
        .replace(/@@VERSION@@/g, versionQuad(manifest.version));
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'melaton-stub-'));
    try {
        fs.writeFileSync(path.join(stage, 'MelatonStub.cs'), cs);
        fs.copyFileSync(path.join(STUB_DIR, 'app.manifest'), path.join(stage, 'app.manifest'));
        if (ico) fs.writeFileSync(path.join(stage, 'app.ico'), ico);
        const vm = (args, t = 60) => execFileSync('bash', [VM, ...args], { timeout: (t + 15) * 1000 }).toString();
        vm(['run', 'rmdir /s /q C:\\agent\\melaton-build 2>nul & mkdir C:\\agent\\melaton-build', 20]);
        for (const f of ['MelatonStub.cs', 'app.manifest'].concat(ico ? ['app.ico'] : [])) {
            vm(['put', path.join(stage, f), `${work}\\${f}`]);
        }
        // /win32manifest needs the 3.5 compiler (the 2.0 one rejects it); 3.5 ships on Vista
        const csc = 'C:\\Windows\\Microsoft.NET\\Framework\\v3.5\\csc.exe';
        const iconArg = ico ? '/win32icon:app.ico ' : '';
        const out = vm(['run', `cd /d C:\\agent\\melaton-build && ${csc} /nologo /target:winexe ${iconArg}/win32manifest:app.manifest MelatonStub.cs`, 90]);
        if (/error CS\d/.test(out)) throw new Error(`csc failed:\n${out}`);
        const local = path.join(stage, 'stub.exe');
        vm(['get', `${work}\\MelatonStub.exe`, local]);
        const buf = fs.readFileSync(local);
        if (exeOverlayOffset(buf) !== buf.length) throw new Error('the compiled stub is not a clean PE');
        return buf;
    } finally {
        fs.rmSync(stage, { recursive: true, force: true });
    }
}

async function main() {
    const src = path.resolve(process.argv[2] || '');
    if (!src || !fs.existsSync(path.join(src, 'manifest.json'))) {
        console.error('usage: node scripts/build-melaton-app.js <src> --exe <out.exe> | --zip <out.msaz>');
        process.exit(2);
    }
    const { manifest, zip } = packZip(src);
    const outZip = arg('--zip');
    const outExe = arg('--exe');
    if (!outZip && !outExe) { console.error('pass --exe <out.exe> or --zip <out.msaz>'); process.exit(2); }

    if (outZip) {
        fs.writeFileSync(outZip, zip);
        console.log(`${manifest.id} ${manifest.version}: ${outZip} (${zip.length} bytes)`);
    }
    if (outExe) {
        const prebuilt = arg('--stub');
        let stub;
        if (prebuilt) {
            stub = fs.readFileSync(prebuilt);
            if (exeOverlayOffset(stub) !== stub.length) throw new Error(`${prebuilt} is not a clean PE stub`);
        } else {
            const ico = await iconFromManifest(src, manifest);
            stub = compileStubOnVm(src, manifest, ico);
        }
        const exe = wrapPackageExe(stub, zip);
        fs.writeFileSync(outExe, exe);
        if (!isMelatonExe(exe)) throw new Error('the built EXE did not read back as a Melaton app');
        console.log(`${manifest.id} ${manifest.version}: ${outExe} (${exe.length} bytes, stub ${stub.length}, package ${zip.length})`);
    }
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
