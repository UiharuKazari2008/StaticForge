'use strict';
// Builds the two sets of client files for the old-vs-new runs, with the server's own compiler functions, without
// writing anything the server reads. old = git HEAD, new = a snapshot of the working tree taken now.
// Proof that the build is faithful: the old build equals the file the server has compiled in everything but the
// header's compile date, and the ?sha= its /app names is the hash of that file. The old set is the server's own
// bytes.   node build.js   (CDP_PORT = the installed old-code browser)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const ROOT = '/home/kanmi/staticforge';
const compiler = require(`${ROOT}/modules/runtimeAssetCompiler.js`);
const { connect, evaluate, sleep, newPhoneTab, BASE_INIT } = require('./cdp');
const BUILD = `${process.env.HOME}/.cache/claude-run/1408/build`;
const FILES = ['public/scripts/comp/wmShell.js', 'public/css/wm-shell.css', 'public/css/wm-programs.css'];
const ANCHOR = '            if (wmBars) document.documentElement.dataset.wmBars = wmBars;\n';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const head = (rel) => cp.execFileSync('git', ['-C', ROOT, 'show', `HEAD:${rel}`], { maxBuffer: 1 << 27 }).toString('utf8');

(async () => {
    const manifest = { builtAt: new Date().toISOString(), headCommit: cp.execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim(), files: {} };
    for (const v of ['old', 'new']) fs.mkdirSync(path.join(BUILD, v), { recursive: true });
    for (const rel of FILES) {
        const web = rel.replace(/^public/, '');
        const src = { old: head(rel), new: fs.readFileSync(path.join(ROOT, rel), 'utf8') };
        const entry = { treeSourceSha: sha(src.new).slice(0, 16), headSourceSha: sha(src.old).slice(0, 16) };
        for (const v of ['old', 'new']) {
            const fn = rel.endsWith('.css') ? compiler.compileCss : compiler.compileJs;
            const out = await fn(src[v], rel, compiler.hashSource(src[v]));
            fs.writeFileSync(path.join(BUILD, v, path.basename(rel)), out);
            entry[v] = sha(Buffer.from(out, 'utf8'));
        }
        // the header carries the compile's date and time: the one part that may differ
        const undated = (t) => t.replace(/\| Compiled on [^|]+\|/, '| Compiled on - |');
        const served = fs.readFileSync(compiler.webPathToCompiledPath(ROOT, web), 'utf8');
        entry.oldBuildEqualsServersCompiledFileApartFromTheDate = undated(served) === undated(fs.readFileSync(path.join(BUILD, 'old', path.basename(rel)), 'utf8'));
        // old = the server's own bytes
        fs.writeFileSync(path.join(BUILD, 'old', path.basename(rel)), served);
        entry.old = sha(Buffer.from(served, 'utf8'));
        manifest.files[web] = entry;
    }
    // app.html: the tree must be HEAD plus one block behind the anchor line, nothing else
    const headHtml = head('public/app.html');
    const treeHtml = fs.readFileSync(`${ROOT}/public/app.html`, 'utf8');
    const at = headHtml.indexOf(ANCHOR) + ANCHOR.length;
    const block = treeHtml.slice(at, at + (treeHtml.length - headHtml.length));
    manifest.appHtml = { oneBlockIsTheWholeDiff: headHtml.slice(0, at) + block + headHtml.slice(at) === treeHtml, blockBytes: Buffer.byteLength(block), blockSha: sha(block).slice(0, 16) };
    fs.writeFileSync(path.join(BUILD, 'preload-block.html'), block);

    // the /app the server rendered for this browser (the old code), kept pristine
    const cdp = await connect();
    const tab = await newPhoneTab(cdp, BASE_INIT);
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:9220/status' }, tab.sessionId);
    await sleep(1200);
    const app = await evaluate(cdp, tab.sessionId, `(async () => { const r = await (await caches.open('melaton-launch-shell-v1')).match('/app'); return r ? await r.text() : null; })()`);
    await cdp.send('Target.closeTarget', { targetId: tab.targetId });
    cdp.close();
    fs.writeFileSync(path.join(BUILD, 'served-app.html'), app);
    manifest.servedApp = { anchorCount: app.split(ANCHOR).length - 1, alreadyHasBlock: app.includes('splashArt') };
    for (const [web, e] of Object.entries(manifest.files)) {
        const refs = [...app.matchAll(new RegExp(`${web.replace(/[.]/g, '\\.')}\\?sha=([0-9a-f]+)`, 'g'))].map((m) => m[1]);
        e.refsInServedApp = refs.length;
        e.servedAppNamesOldBuild = refs.length > 0 && refs.every((h) => h === e.old);
    }
    fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(manifest, null, 1));
    fs.writeFileSync(path.join(__dirname, 'newcode-build.json'), JSON.stringify(manifest, null, 1));
    console.log(JSON.stringify(manifest, null, 1));
    process.exit(0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
