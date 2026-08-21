/**
 * Grimoire Domain Registry (server)
 *
 * Primary goal: domain name (with aliases) resolves to a registered "applet" / handler
 * so that:
 *  - Routing decisions are centralized and not scattered in client if-chains or handlers.
 *  - New "pseudo-sites" (en.grimoire.jp, docs.novelai.jp, *.dyna.dreamscape.jp, wiki.danbooru.jp, etc.)
 *    can be added by registration instead of hard-coded strings.
 *  - Domains/applets can declare ownership of their own WebSocket packet types.
 *
 * This complements (and will eventually drive) the client-side dsapRegistry / Grimoire router.
 *
 * Registration example (in a feature module loaded at startup):
 *   const gr = require('./grimoireDomainRegistry');
 *   gr.registerDomain({
 *     domain: 'quips.dyna.dreamscape.jp',
 *     aliases: ['applet.grimoire.jp/quips', 'en.grimoire.jp/applets/quips'],
 *     title: 'Dynamic Quips',
 *     packets: {
 *       'get_generation_quips_status': 'handleGetQuipsStatus', // or a function
 *       'start_generation_quips_scan': myHandlerFn
 *     }
 *   });
 *
 * The central websocketHandlers will consult this for delegation of packets
 * and (in future) for resolve_grimoire_url to return server-prebuilt page shells.
 */

const wsPacketRegistry = require('./ws/wsPacketRegistry');

const registeredDomains = [];
let domainHostCache = null; // normalized hosts for fast prefix matching

function invalidateCache() {
  domainHostCache = null;
}

function normalizeDomainInput(input) {
  if (!input) return '';
  let raw = String(input).trim().toLowerCase();
  raw = raw.replace(/^(edtx|rdf|dsap):\/\//i, '');
  raw = raw.replace(/^\/+/, '');
  // Take only host + optional path prefix for alias matching
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    let p = u.pathname.replace(/\/+$/, '');
    return p ? `${u.hostname}${p}` : u.hostname;
  } catch {
    // fallback for bare "host/path"
    const [hostPart, ...rest] = raw.split('/');
    if (!hostPart) return raw;
    return rest.length ? `${hostPart}/${rest.join('/')}`.replace(/\/+$/, '') : hostPart;
  }
}

function domainMatches(entry, normalized) {
  const candidates = [entry.domain, ...(entry.aliases || [])]
    .map(normalizeDomainInput)
    .filter(Boolean);

  for (const c of candidates) {
    if (normalized === c) return true;
    if (normalized.startsWith(c + '/')) return true;
  }
  return false;
}

function collectHostRoots() {
  if (domainHostCache) return domainHostCache;
  const roots = new Set();
  for (const entry of registeredDomains) {
    [entry.domain, ...(entry.aliases || [])].forEach((cand) => {
      const n = normalizeDomainInput(cand);
      if (!n) return;
      const host = n.split('/')[0];
      roots.add(host);
      roots.add(n);
    });
  }
  domainHostCache = roots;
  return roots;
}

/**
 * Register a Grimoire pseudo-domain / applet.
 * @param {object} config
 *   domain: primary (e.g. 'en.grimoire.jp' or 'quips.dyna.dreamscape.jp')
 *   aliases: string[]
 *   title?: string
 *   packets?: { [messageType: string]: string | function }  // string = method name on WebsocketHandlers, fn = direct handler
 *   resolve?: (rawUrl) => object | null   // optional custom resolver
 *   getPage?: (match, context) => object | null   // future: server can return prebuilt { html, data, title, ... }
 */
function registerDomain(config) {
  if (!config || !config.domain) {
    console.warn('[grimoireDomainRegistry] registerDomain: missing domain');
    return;
  }
  // de-dupe by primary domain
  const existingIdx = registeredDomains.findIndex((e) => e.domain === config.domain);
  if (existingIdx >= 0) {
    const target = registeredDomains[existingIdx];
    if (config.aliases) target.aliases = [...new Set([...(target.aliases || []), ...config.aliases])];
    if (config.title) target.title = config.title;
    if (config.packets) target.packets = { ...(target.packets || {}), ...config.packets };
    if (typeof config.resolve === 'function') target.resolve = config.resolve;
    if (typeof config.getPage === 'function') target.getPage = config.getPage;
  } else {
    registeredDomains.push({
      domain: config.domain,
      aliases: config.aliases || [],
      title: config.title || config.domain,
      packets: config.packets || {},
      resolve: typeof config.resolve === 'function' ? config.resolve : null,
      getPage: typeof config.getPage === 'function' ? config.getPage : null
    });
  }
  invalidateCache();
}

/** Resolve a raw pseudo-URL (edtx://..., bare host/path, etc.) to a registered domain entry + match info. */
function resolvePseudoUrl(rawUrl) {
  const val = String(rawUrl || '').trim();
  if (!val) return null;

  // Strip known pseudo protocols for matching
  const stripped = val.replace(/^(edtx|rdf|dsap):\/\//i, '');
  const normalized = normalizeDomainInput(stripped || val);

  if (!normalized) return null;

  for (const entry of registeredDomains) {
    if (domainMatches(entry, normalized)) {
      const canonicalHost = normalizeDomainInput(entry.domain).split('/')[0];
      const suffix = normalized.startsWith(canonicalHost)
        ? normalized.slice(canonicalHost.length).replace(/^\//, '')
        : '';
      const displayPath = suffix ? `${canonicalHost}/${suffix}` : canonicalHost;

      return {
        entry,
        normalized,
        displayPath,
        canonicalUrl: `edtx://${displayPath}`, // default to edtx for most things; callers can adjust
        protocol: val.match(/^(edtx|rdf|dsap):/i)?.[1]?.toLowerCase() || 'edtx'
      };
    }
  }

  // Also allow direct host match even without a registration (for future dynamic ones)
  const host = normalized.split('/')[0];
  if (host) {
    // unknown but looks like a grimoire-style host
    if (/^(en\.|wiki\.|applet\.|docs\.|grimoire\.|\w+\.dyna\.dreamscape)/i.test(host)) {
      return {
        entry: null,
        normalized,
        displayPath: normalized,
        canonicalUrl: `edtx://${normalized}`,
        protocol: 'edtx',
        unknown: true
      };
    }
  }

  return null;
}

/** True if the url matches any registered domain (or known grimoire-style host). */
function isGrimoirePseudoUrl(url) {
  if (!url) return false;
  if (/^(edtx|rdf|dsap):\/\//i.test(url)) return true;
  const n = normalizeDomainInput(url);
  if (!n) return false;
  for (const root of collectHostRoots()) {
    if (n === root || n.startsWith(root + '/')) return true;
  }
  // loose heuristic for the known families
  return /^(en\.|wiki\.|applet\.|docs\.|grimoire\.|\w+\.dyna\.dreamscape)/i.test(n.split('/')[0]);
}

/**
 * Register a direct packet handler for a message type.
 * Preferred for applets that want to own specific packets without touching the central switch.
 * Legacy handlers are wrapped for wsPacketRegistry context dispatch.
 */
function registerPacketHandler(type, handler) {
  if (!type || typeof handler !== 'function') {
    console.warn('[grimoireDomainRegistry] registerPacketHandler: bad args', type);
    return;
  }
  wsPacketRegistry.registerWsPacket(String(type), async (ctx) => {
    await handler.call(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
  }, { owner: 'grimoireDomainRegistry' });
}

function getPacketHandler(type) {
  return wsPacketRegistry.getWsPacketHandler(String(type));
}

/**
 * From a domain registration's .packets map, bind the declared handlers.
 * Called by websocketHandlers after it has a reference to itself.
 * Supports:
 *   packets: { 'foo_bar': 'handleFooBar' }  // will call this.handleFooBar(...)
 *   packets: { 'foo_bar': actualFunction }
 */
function bindDomainPackets(handlersInstance, entry) {
  if (!entry || !entry.packets) return;
  for (const [type, target] of Object.entries(entry.packets)) {
    if (typeof target === 'function') {
      registerPacketHandler(type, target);
    } else if (typeof target === 'string' && typeof handlersInstance[target] === 'function') {
      // bind so 'this' inside the method is correct
      registerPacketHandler(type, handlersInstance[target].bind(handlersInstance));
    } else {
      console.warn('[grimoireDomainRegistry] Could not bind packet', type, 'from', entry.domain);
    }
  }
}

/** Convenience to bind all currently registered domains' packets (call once at WS init). */
function bindAllDomainPackets(handlersInstance) {
  for (const entry of registeredDomains) {
    bindDomainPackets(handlersInstance, entry);
  }
}

function getRegisteredDomains() {
  return registeredDomains.slice();
}

// --- Default core domain registrations (server side) ---
// Feature modules and applets can call registerDomain() later to add/override packets + getPage.
registerDomain({
  domain: 'en.grimoire.jp',
  aliases: ['en.grimoire.jp/search', 'en.grimoire.jp/index', 'grimoire.jp', 'en.grimoire.jp/home'],
  title: 'Grimoire'
});

registerDomain({
  domain: 'wiki.danbooru.jp',
  aliases: ['wiki.danbooru.jp/tag', 'danbooru.jp/tag'],
  title: 'Danbooru Wiki'
});

registerDomain({
  domain: 'wiki.e621.com',
  aliases: ['wiki.e621.com/tag', 'e621.com/tag'],
  title: 'e621 Wiki'
});

registerDomain({
  domain: 'docs.novelai.jp',
  aliases: ['novelai.jp/docs'],
  title: 'NovelAI Docs'
});

// NAX.moe community vibes browser as a first-class NovelAI-domain DSAP applet (early 2010s Web 2.0)
registerDomain({
  domain: 'vibes.novelai.net',
  aliases: [
    'vibes.novelai.jp',
    'naxt-vibes.novelai.net',
    'nax-vibes.novelai.net',
    'applet.novelai.net/vibes',
    'applet.grimoire.jp/nax-vibes', // legacy alias for old links
    'vibes.dyna.novelai.net'
  ],
  title: 'NAX Vibes'
});

// NovelAI Explore community gallery (Agora)
registerDomain({
  domain: 'explore.novelai.net',
  aliases: [
    'novelai.net/explore/gallery',
    'novelai.net/explore',
    'applet.novelai.net/explore',
    'dsap://explore.novelai.net',
    'en.grimoire.jp/applets/explore',
    'applet.grimoire.jp/explore'
  ],
  title: 'Agora'
});

registerDomain({
  domain: 'novels.dyna.dreamscape.jp',
  aliases: [
    'dsap://novels.dyna.dreamscape.jp',
    'en.grimoire.jp/applets/novels',
    'applet.grimoire.jp/novels'
  ],
  title: 'Novels',
  packets: {
    novel_list: 'handleNovelList',
    novel_get: 'handleNovelGet',
    novel_update: 'handleNovelUpdate',
    novel_generate: 'handleNovelGenerate',
    novel_undo: 'handleNovelUndo',
    novel_resolve_image: 'handleNovelResolveImage'
  }
});

registerDomain({
  domain: 'security.dreamscape.jp',
  aliases: [
    'security.dyna.dreamscape.jp',
    'dsap://security.dreamscape.jp',
    'dsap://security.dyna.dreamscape.jp',
    'en.grimoire.jp/applets/security',
    'applet.grimoire.jp/security'
  ],
  title: 'Security Center'
});

registerDomain({
  domain: 'dreamscape.jp',
  aliases: [
    'dreamscape.jp/',
    'www.dreamscape.jp',
    'dyna.dreamscape.jp',
    'dsap://dreamscape.jp',
    'dsap://dreamscape.jp/'
  ],
  title: 'Dreamscape'
});

registerDomain({
  domain: 'memories.dyna.dreamscape.jp',
  aliases: [
    'dsap://memories.dyna.dreamscape.jp',
    'en.grimoire.jp/applets/memories',
    'applet.grimoire.jp/memories',
    'xi.dyna.dreamscape.jp/persona',
    'dsap://xi.dyna.dreamscape.jp/persona',
    'en.grimoire.jp/applets/linkxi',
    'applet.grimoire.jp/linkxi'
  ],
  title: 'Knowledge Memories'
});

module.exports = {
  registerDomain,
  resolvePseudoUrl,
  isGrimoirePseudoUrl,
  normalizeDomainInput,
  registerPacketHandler,
  getPacketHandler,
  bindDomainPackets,
  bindAllDomainPackets,
  getRegisteredDomains,
  // For future server-driven prebuilt pages:
  // getPageForUrl(rawUrl, context) { ... using entry.getPage if present }
};
