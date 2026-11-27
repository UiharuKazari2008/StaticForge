'use strict';
// Shared helpers: errors, validators, small fs helpers.
const fs = require('fs');
const path = require('path');

const DATA = process.env.RACKD_DATA || '/var/lib/rackd';

class RackError extends Error {
  constructor(msg, code = 'BAD_REQUEST', status = 400) { super(msg); this.code = code; this.status = status; }
}
const bad = (msg, code) => new RackError(msg, code || 'BAD_REQUEST', 400);

const RE = {
  name: /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/,
  tmux: /^[A-Za-z0-9_-]{1,40}$/,
  user: /^[a-z_][a-z0-9_-]{0,31}$/,
  host: /^[A-Za-z0-9][A-Za-z0-9.:_-]{0,252}$/,
  unit: /^[A-Za-z0-9@:._\\-]{1,200}\.(service|socket|timer|target|mount|path)$/,
  pkg: /^[a-z0-9][a-z0-9+.:_-]{0,100}$/,
  sdkpkg: /^[A-Za-z0-9][A-Za-z0-9;._-]{0,200}$/,
  lv: /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/,
  envName: /^[A-Za-z_][A-Za-z0-9_]{0,63}$/,
};

function str(v, what, re, max = 256) {
  if (typeof v !== 'string' || !v || v.length > max || v.includes('\0')) throw bad(`${what} is required`);
  if (re && !re.test(v)) throw bad(`${what} is not valid`);
  return v;
}
function num(v, what, min, max, def) {
  if (v === undefined || v === null || v === '') { if (def !== undefined) return def; throw bad(`${what} is required`); }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${what} must be a number from ${min} to ${max}`);
  return n;
}
function absPath(v, what) {
  str(v, what, null, 1024);
  if (!path.isAbsolute(v) || v.split('/').includes('..') || /[\n\r]/.test(v)) throw bad(`${what} must be an absolute path without ..`);
  return path.normalize(v);
}
const bool = (v, def) => (v === undefined || v === null ? def : v === true || v === 'true' || v === 1);

function readJson(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; } }
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const t = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(t, JSON.stringify(obj, null, 1), { mode: 0o600 });
  fs.renameSync(t, file);
}
const rid = (n = 3) => require('crypto').randomBytes(n).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };

module.exports = { DATA, RackError, bad, RE, str, num, absPath, bool, readJson, writeJson, rid, sleep, exists };
