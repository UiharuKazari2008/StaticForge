'use strict';
// Files rackd makes (screenshots, exports): DATA/files/<kind>/<unique name>. Old ones are pruned when a new one is made.
const fs = require('fs');
const path = require('path');
const { DATA, rid, RackError } = require('./util');

const ROOT = path.join(DATA, 'files');
const KINDS = new Set(['shots', 'exports', 'artifacts', 'ca']);
const CA_DIR = '/etc/rackd/ca';   // kind `ca`: only the public certificates (ca.crt, dreamscape-client-ca.crt), never a key
const ARTIFACTS = '/srv/rack/artifacts';
const KEEP_MS = 7 * 86400e3;
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.ppm': 'image/x-portable-pixmap', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.crt': 'application/x-x509-ca-cert' };

function newPath(kind, base, ext) {
  if (!KINDS.has(kind)) throw new Error('bad kind');
  const dir = path.join(ROOT, kind); fs.mkdirSync(dir, { recursive: true });
  prune(dir);
  const name = `${base.replace(/[^A-Za-z0-9._-]/g, '_')}-${Date.now().toString(36)}${rid(2)}.${ext}`;
  return { abs: path.join(dir, name), file: `${kind}/${name}` };
}
function prune(dir) {
  const now = Date.now();
  try { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (now - fs.statSync(p).mtimeMs > KEEP_MS) fs.unlinkSync(p); } } catch { /* ignore */ }
}
function resolve(kind, name) {
  if (!KINDS.has(kind) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(name)) throw new RackError('no such file', 'NOT_FOUND', 404);
  let p = path.join(ROOT, kind, name);
  if (kind === 'ca') { if (!/^[A-Za-z0-9._-]+\.crt$/.test(name)) throw new RackError('no such file', 'NOT_FOUND', 404); p = path.join(CA_DIR, name); }
  if (kind === 'artifacts') { const i = name.indexOf('__'); if (i < 1) throw new RackError('no such file', 'NOT_FOUND', 404); p = path.join(ARTIFACTS, name.slice(0, i), 'out', name.slice(i + 2)); }
  if (!fs.existsSync(p)) throw new RackError('no such file', 'NOT_FOUND', 404);
  return { abs: p, type: TYPES[path.extname(name)] || 'application/octet-stream' };
}
module.exports = { newPath, resolve };
