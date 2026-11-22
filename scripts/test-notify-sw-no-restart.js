const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const script = path.join(__dirname, 'notify-service-worker-update.sh');
execFileSync('bash', ['-n', script], { stdio: 'pipe' });
execFileSync('bash', ['-n', path.join(__dirname, 'host-deploy.sh')], { stdio: 'pipe' });

const src = fs.readFileSync(script, 'utf8');
assert.ok(!src.includes('pm2'));
assert.ok(!src.includes('--restart'));
assert.ok(!src.includes('DO_RESTART'));

let failed = false;
try {
    execFileSync('bash', [script, '--restart'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
    failed = true;
    const text = `${err.stdout || ''}\n${err.stderr || ''}`;
    assert.ok(text.includes('Unknown option'), text);
    assert.ok(!text.toLowerCase().includes('pm2'), text);
}
assert.strictEqual(failed, true);

// .cursor/rules is gitignored (host-local); check it only where it exists.
const rules = process.env.SF_RULES_DIR || path.join(__dirname, '..', '.cursor', 'rules');
if (fs.existsSync(path.join(rules, 'director-idle-before-restart.mdc'))) {
    const director = fs.readFileSync(path.join(rules, 'director-idle-before-restart.mdc'), 'utf8');
    assert.match(director, /never restart/i);
    assert.ok(director.includes('Yukimi'));
    assert.ok(director.includes('Sala'));
    assert.ok(director.includes('Then stop'));
    assert.ok(!director.includes('Before `pm2 restart`'));

    const noRestart = fs.readFileSync(path.join(rules, 'no-dreamscape-restart.mdc'), 'utf8');
    assert.ok(noRestart.includes('Yukimi'));
    assert.ok(noRestart.includes('Sala'));
    assert.ok(!noRestart.includes('notify-service-worker-update.sh --restart'));
}

const deploy = fs.readFileSync(path.join(__dirname, 'host-deploy.sh'), 'utf8');
assert.ok(!deploy.includes('notify-service-worker-update.sh --restart'));

const hostDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'local-host.md'), 'utf8');
assert.ok(hostDoc.includes('ask Yukimi or Sala'));

// A recompile broadcast applies: the handler tells the manager this is an install, and the manager
// threads that through the full-manifest fallbacks too. Notify mode must not just count these files.
const inbound = fs.readFileSync(path.join(__dirname, '..', 'public', 'scripts', 'ws', 'handlers', '10-systemInbound.js'), 'utf8');
assert.ok(inbound.includes('const cacheOptions = { runtimeAssetsRecompiled: true, install: true };'));
assert.ok(inbound.includes('checkStaticFileUpdates(silent, cacheOptions)'));

const manager = fs.readFileSync(path.join(__dirname, '..', 'public', 'scripts', 'comp', 'serviceWorkerManager.js'), 'utf8');
assert.ok(manager.includes('async checkStaticFileUpdates(noToast = false, cacheOptions = null)'));
assert.ok(manager.includes('async _staticFilesUnchanged(noToast, swState, cacheOptions = null)'));
assert.ok(manager.includes('await this.updateStaticCache(result.rows, noToast, cacheOptions)'));

const server = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
assert.ok(server.includes('runtimeAssetsRecompiled: true'));

console.log('test-notify-sw-no-restart: ok');
