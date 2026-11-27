'use strict';

// The iLO service's LAN listener allowlist (server.js lanGate).

const LAN_HOSTS = new Set(['192.168.100.40', '192.168.100.41', '192.168.100.42', '192.168.100.43']);
function lanAllowed(method, url, ip) {
  let p; try { p = new URL(url, 'http://x').pathname; } catch (_) { return false; }
  if (/^\/iso\/[^/]+$/.test(p)) return method === 'GET' || method === 'HEAD';
  if (method === 'GET' && /^\/api\/(\w+)\/(health|history|power)$/.test(p)) return LAN_HOSTS.has(String(ip || '').replace(/^::ffff:/, ''));
  return false;
}

module.exports = { lanAllowed, LAN_HOSTS };
