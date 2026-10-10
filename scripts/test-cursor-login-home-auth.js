#!/usr/bin/env node
// Regression: cursor-agent login writes auth under $HOME/.config/cursor (ignores CURSOR_CONFIG_DIR)
// and may flush after exit. The login job must still capture it.
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-login-'));
const fake = path.join(tmp, 'agent');
fs.writeFileSync(fake, `#!/bin/sh
echo "https://cursor.com/loginDeepControl?challenge=x"
sleep 0.3
mkdir -p "$HOME/.config/cursor"
(sleep 1; printf '{"accessToken":"a.b.c"}' > "$HOME/.config/cursor/auth.json") &
exit 0
`, { mode: 0o755 });
const dirPath = require.resolve(path.join(root, 'modules/cursorDirector'));
require.cache[dirPath] = { id: dirPath, filename: dirPath, loaded: true, exports: { findAgent: () => fake } };
const store = require(path.join(root, 'modules/cursorAccountAuthStore'));
const id = `zz-login-test-${process.pid}`;
let url = '';
const t = setTimeout(() => { console.error('FAIL: timeout'); process.exit(1); }, 15000);
store.beginCursorAccountLogin(id, {
  onUrl: (u) => { url = u; },
  onDone: (r) => {
    clearTimeout(t);
    assert.ok(url.startsWith('https://cursor.com/loginDeepControl'));
    assert.strictEqual(r.accessToken, 'a.b.c');
    try { fs.rmSync(store.getAccountDir(id), { recursive: true, force: true }); } catch (_) {}
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('PASS cursor login captures HOME/.config/cursor auth after exit');
    process.exit(0);
  },
  onFail: (e) => { console.error('FAIL:', e.message); process.exit(1); }
});
