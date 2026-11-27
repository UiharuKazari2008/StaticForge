'use strict';
const { run } = require('./exec');

// Names from `pkgs` that are not installed.
async function missing(pkgs) {
  if (!pkgs.length) return [];
  const r = await run(['dpkg-query', '-W', '-f', '${Package} ${db:Status-Abbrev}\n', ...pkgs], { timeoutMs: 15000 });
  const have = new Set();
  for (const l of r.stdout.split('\n')) { const m = l.match(/^(\S+) ii/); if (m) have.add(m[1].split(':')[0]); }
  return pkgs.filter(p => !have.has(p));
}
async function install(ctx, pkgs) {
  const env = { DEBIAN_FRONTEND: 'noninteractive' };
  const miss = await missing(pkgs);
  if (!miss.length) { ctx.log('packages already installed'); return; }
  await ctx.exec(['apt-get', 'update'], { env });
  await ctx.exec(['apt-get', 'install', '-y', '--no-install-recommends', ...miss], { env });
}
module.exports = { missing, install };
