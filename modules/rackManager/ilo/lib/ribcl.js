'use strict';
// RIBCL XML API over HTTPS, for iLO 2 (raw XML on the TLS socket) and iLO 3 (HTTP POST /ribcl).
const tls = require('tls');
const crypto = require('crypto');

const TLSOPT = {
  2: { minVersion: 'TLSv1', maxVersion: 'TLSv1' },
  3: { minVersion: 'TLSv1', maxVersion: 'TLSv1.1' },
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function raw(host, gen, payload) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({
      host, port: 443, rejectUnauthorized: false, ciphers: 'AES128-SHA:AES256-SHA:@SECLEVEL=0',
      secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT, ...TLSOPT[gen],
    }, () => s.write(payload));
    let d = '', idle = null;
    s.setEncoding('latin1');
    const done = () => { clearTimeout(idle); s.destroy(); resolve(d); };
    s.setTimeout(45000, () => { if (/<\/RIBCL>/.test(d)) done(); else s.destroy(new Error('RIBCL timeout')); });
    // some iLOs keep the connection open after replying: finish 1.5 s after the last </RIBCL>
    s.on('data', x => { d += x; clearTimeout(idle); if (/<\/RIBCL>\s*(\r?\n0\r?\n\r?\n)?$/.test(d)) idle = setTimeout(done, 1500); });
    s.on('end', () => resolve(d)); s.on('close', () => resolve(d));
    s.on('error', reject);
  });
}

function dechunk(http) {
  const i = http.indexOf('\r\n\r\n'); if (i < 0) return http;
  const head = http.slice(0, i), b = http.slice(i + 4);
  if (!/transfer-encoding:\s*chunked/i.test(head)) return b;
  let o = '', p = 0;
  for (;;) {
    const e = b.indexOf('\r\n', p); if (e < 0) break;
    const n = parseInt(b.slice(p, e), 16); if (!(n > 0)) break;
    o += b.slice(e + 2, e + 2 + n); p = e + 2 + n + 2;
  }
  return o;
}

async function ribcl({ host, gen }, user, password, inner) {
  const xml = `<?xml version="1.0"?><RIBCL VERSION="2.0"><LOGIN USER_LOGIN="${esc(user)}" PASSWORD="${esc(password)}">${inner}</LOGIN></RIBCL>\r\n`;
  const payload = gen === 2 ? xml
    : `POST /ribcl HTTP/1.1\r\nHost: ${host}\r\nContent-Type: text/xml\r\nContent-Length: ${Buffer.byteLength(xml)}\r\nConnection: close\r\n\r\n${xml}`;
  let out = await raw(host, gen, payload);
  if (gen !== 2) out = dechunk(out);
  for (const m of out.matchAll(/<RESPONSE\s+STATUS="(0x[0-9A-Fa-f]+)"\s+MESSAGE='([^']*)'/g)) {
    if (m[1] !== '0x0000') throw new Error(`RIBCL: ${m[2]} (${m[1]})`);
  }
  return out;
}

// Tiny XML -> JSON for RIBCL replies. <A><B VALUE="x"/><B VALUE="y"/></A> -> {A:{B:["x","y"]}}
function parse(xml) {
  // text-content elements (<POWER_CAP>"OFF"</POWER_CAP>) -> <POWER_CAP VALUE="OFF"/>
  xml = xml.replace(/<([A-Z_0-9]+)>\s*"?([^<"]*?)"?\s*<\/\1>/gi, (_, n, v) => `<${n} VALUE="${v}"/>`);
  const root = {}, stack = [root];
  const add = (obj, k, v) => { if (k in obj) { if (!Array.isArray(obj[k]) || obj[k].__single) obj[k] = [obj[k]]; obj[k].push(v); } else obj[k] = v; };
  const re = /<(\/?)([A-Z_0-9]+)((?:\s+[A-Z_0-9]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const [, close, name, attrs, self] = m;
    if (name === 'RIBCL' || name === 'RESPONSE' || name === 'xml') continue;
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const a = {};
    for (const x of attrs.matchAll(/([A-Z_0-9]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) a[x[1]] = x[2] !== undefined ? x[2] : x[3];
    const keys = Object.keys(a);
    let v;
    if (self && keys.length === 1 && keys[0] === 'VALUE') v = a.VALUE;
    else if (self && keys.length === 2 && 'VALUE' in a && 'UNIT' in a) v = { value: a.VALUE, unit: a.UNIT };
    else v = { ...a };
    add(stack[stack.length - 1], name, v);
    if (!self) stack.push(v);
  }
  return root;
}

const R = s => `<SERVER_INFO MODE="read">${s}</SERVER_INFO>`;
const W = s => `<SERVER_INFO MODE="write">${s}</SERVER_INFO>`;

class Ribcl {
  constructor(cfg, user, passwordFn) { this.cfg = cfg; this.user = user; this.pw = passwordFn; }
  async call(inner) { return parse(await ribcl(this.cfg, this.user, this.pw(), inner)); }
  health() { return this.call(R('<GET_EMBEDDED_HEALTH/>')); }
  powerReadings() { return this.call(R('<GET_POWER_READINGS/>')); }
  hostPower() { return this.call(R('<GET_HOST_POWER_STATUS/>')); }
  powerCap() { return this.call(R('<GET_POWER_CAP/>')); }
  setPowerCap(watts) { return this.call(W(`<SET_POWER_CAP POWER_CAP="${Math.max(0, Math.round(Number(watts) || 0))}"/>`)); }
  powerSaver() { return this.call(R('<GET_HOST_POWER_SAVER_STATUS/>')); }
  setPowerSaver(v) { return this.call(W(`<SET_HOST_POWER_SAVER HOST_POWER_SAVER="${Number(v) | 0}"/>`)); }
  iml() { return this.call(R('<GET_SERVER_EVENT_LOG/>')); }
  ilolog() { return this.call('<RIB_INFO MODE="read"><GET_EVENT_LOG/></RIB_INFO>'); }
  fw() { return this.call('<RIB_INFO MODE="read"><GET_FW_VERSION/></RIB_INFO>'); }
  // Virtual media from a URL (works on iLO 2 and iLO 3). Returns {options:[{device,image_inserted,vm_url_connected,image_url,boot_option}]}
  async vmStatus() {
    const out = [];
    for (const dev of ['FLOPPY', 'CDROM']) {
      try {
        const r = await this.call(`<RIB_INFO MODE="read"><GET_VM_STATUS DEVICE="${dev}"/></RIB_INFO>`);
        const s = r.GET_VM_STATUS || {};
        const ins = /yes/i.test(s.IMAGE_INSERTED || '');
        out.push({ device: dev, image_inserted: ins ? 1 : 0, vm_url_connected: ins ? 1 : 0, image_url: s.IMAGE_URL || '', boot_option: s.BOOT_OPTION || '' });
      } catch (e) { out.push({ device: dev, error: e.message }); }
    }
    return { options: out };
  }
  vmInsert(device, url, bootOnce) {
    const d = device === 'FLOPPY' ? 'FLOPPY' : 'CDROM';
    // CONNECT attaches the disc but also leaves the boot option at BOOT_ALWAYS, so set the boot option after it
    return this.call(`<RIB_INFO MODE="write"><INSERT_VIRTUAL_MEDIA DEVICE="${d}" IMAGE_URL="${esc(url)}"/>` +
      `<SET_VM_STATUS DEVICE="${d}"><VM_BOOT_OPTION VALUE="CONNECT"/><VM_WRITE_PROTECT VALUE="YES"/></SET_VM_STATUS>` +
      `<SET_VM_STATUS DEVICE="${d}"><VM_BOOT_OPTION VALUE="${bootOnce ? 'BOOT_ONCE' : 'NO_BOOT'}"/></SET_VM_STATUS></RIB_INFO>`);
  }
  vmEject(device) { return this.call(`<RIB_INFO MODE="write"><EJECT_VIRTUAL_MEDIA DEVICE="${device === 'FLOPPY' ? 'FLOPPY' : 'CDROM'}"/></RIB_INFO>`); }
  // iLO users and settings (read); user changes take a password typed by the person in the page
  async users() {   // GET_ALL_USERS_INFO is not supported on iLO 2 2.33 / iLO 3 1.94
    const all = await this.call('<USER_INFO MODE="read"><GET_ALL_USERS/></USER_INFO>');
    let logins = (all.GET_ALL_USERS || {}).USER_LOGIN; logins = (Array.isArray(logins) ? logins : logins ? [logins] : []).filter(Boolean);
    const out = [];
    for (const l of logins) {
      try { out.push((await this.call(`<USER_INFO MODE="read"><GET_USER USER_LOGIN="${esc(l)}"/></USER_INFO>`)).GET_USER || { USER_LOGIN: l }); }
      catch (e) { out.push({ USER_LOGIN: l, error: e.message }); }
    }
    return out;
  }
  network() { return this.call('<RIB_INFO MODE="read"><GET_NETWORK_SETTINGS/></RIB_INFO>'); }
  globalSettings() { return this.call('<RIB_INFO MODE="read"><GET_GLOBAL_SETTINGS/></RIB_INFO>'); }
  addUser(u) {
    const priv = ['ADMIN_PRIV', 'REMOTE_CONS_PRIV', 'RESET_SERVER_PRIV', 'VIRTUAL_MEDIA_PRIV', 'CONFIG_ILO_PRIV'].map(p => `<${p} value="${u.privs && u.privs.includes(p) ? 'Y' : 'N'}"/>`).join('');
    return this.call(`<USER_INFO MODE="write"><ADD_USER USER_NAME="${esc(u.name || u.login)}" USER_LOGIN="${esc(u.login)}" PASSWORD="${esc(u.password)}">${priv}</ADD_USER></USER_INFO>`);
  }
  modUser(login, { password, privs }) {
    const parts = [];
    if (password) parts.push(`<PASSWORD value="${esc(password)}"/>`);
    if (privs) for (const p of ['ADMIN_PRIV', 'REMOTE_CONS_PRIV', 'RESET_SERVER_PRIV', 'VIRTUAL_MEDIA_PRIV', 'CONFIG_ILO_PRIV']) parts.push(`<${p} value="${privs.includes(p) ? 'Y' : 'N'}"/>`);
    return this.call(`<USER_INFO MODE="write"><MOD_USER USER_LOGIN="${esc(login)}">${parts.join('')}</MOD_USER></USER_INFO>`);
  }
  deleteUser(login) { return this.call(`<USER_INFO MODE="write"><DELETE_USER USER_LOGIN="${esc(login)}"/></USER_INFO>`); }
  // 0 momentary press, 1 press and hold, 2 cold boot, 3 reset
  powerOp(op) { return this.call(W(['<PRESS_PWR_BTN/>', '<HOLD_PWR_BTN/>', '<COLD_BOOT_SERVER/>', '<RESET_SERVER/>'][op] || '<PRESS_PWR_BTN/>')); }
}

module.exports = { Ribcl, ribcl, parse };
