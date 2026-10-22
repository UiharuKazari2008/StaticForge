/**
 * NAX.moe community vibes browser: the hosted page dsap://vibes.novelai.net (below). The old
 * standalone window (#naxVibesModal) is gone; these model helpers serve the page.
 */

/** NAX gallery filter keys mapped to manual modal model values */
const NAX_VIBES_MODEL_FILTERS = [
    { key: 'filter45Curated', forgeKey: 'v4_5_cur' },
    { key: 'filter45Full', forgeKey: 'v4_5' },
    { key: 'filter4Curated', forgeKey: 'v4_cur' },
    { key: 'filter4Full', forgeKey: 'v4' }
];

function naxVibeGetModelOption(forgeKey) {
    if (!forgeKey || typeof modelGroups === 'undefined') return null;
    for (const g of modelGroups) {
        const opt = g.options.find((o) => o.value === forgeKey);
        if (opt) return opt;
    }
    return null;
}

/** Map nax.moe encoding model slug to StaticForge model key */
function naxVibeNaxModelToForgeKey(naxModel) {
    const m = String(naxModel || '').toLowerCase().replace(/[-_\s]/g, '');
    if (m === 'v5full' || m === 'v5f') return 'v5';
    if (m === 'v5curated' || m === 'v5c') return 'v5_cur';
    if (m === 'v45full' || m === 'v45f') return 'v4_5';
    if (m === 'v45curated' || m === 'v45c') return 'v4_5_cur';
    if (m === 'v4full' || m === 'v4f') return 'v4';
    if (m === 'v4curated' || m === 'v4c') return 'v4_cur';
    return null;
}

function naxVibeEncodingDisplayModel(enc) {
    const forgeKey = enc.forgeKey || naxVibeNaxModelToForgeKey(enc.model);
    const opt = naxVibeGetModelOption(forgeKey);
    if (opt) return opt.display;
    if (forgeKey && typeof modelBadges !== 'undefined' && modelBadges[forgeKey]) {
        return modelBadges[forgeKey].display;
    }
    return enc.modelShort || enc.model || '';
}

/* ============================================================
   NAX Vibes as the hosted page vibes.novelai.net
   Early 2010s Web 2.0 aesthetic (glossy bevels, embossed headers,
   inset panels, chrome buttons, saturated badges, status bar).
   ============================================================ */

const NAX_VIBES_DSAP_URL = 'vibes.novelai.net';
const NAX_VIBES_DSAP_TITLE = 'NAX Vibes';

function naxVibesDsapEscapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

function naxVibesDsapResolvePreviewUrl(url) {
    if (!url) return '';
    const s = String(url).trim();
    if (!s) return '';
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    if (s.startsWith('//')) return `https:${s}`;
    if (s.startsWith('/')) return `https://nax.moe${s}`;
    return s;
}

function naxVibesDsapFormatCacheAge(cachedAt) {
    if (!cachedAt) return '';
    const mins = Math.round((Date.now() - cachedAt) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m ago` : `${h}h ago`;
}

/** Build a canonical dsap:// URL that encodes the full UI state (for app browser history + deep links) */
function naxVibesBuildDsapUrl({ preset = 'top', page = 1, search = '', filters = null } = {}) {
    const base = `dsap://${NAX_VIBES_DSAP_URL}`;
    const q = new URLSearchParams();
    let pathPart = '';

    const cleanSearch = (search || '').trim();
    const p = String(preset || 'top').toLowerCase();

    if (cleanSearch) {
        pathPart = '/search';
        q.set('q', cleanSearch);
    } else if (p && p !== 'top') {
        pathPart = `/${p}`;
    }

    const pg = parseInt(page, 10);
    if (pg && pg > 1) q.set('page', String(pg));

    // Serialize active model filters compactly (only include non-defaults or a list)
    const f = filters || {};
    const active = [];
    if (f.filter45Curated) active.push('v45c');
    if (f.filter45Full) active.push('v45f');
    if (f.filter4Curated) active.push('v4c');
    if (f.filter4Full) active.push('v4f');
    // Only add ?m if not the common default (both 4.5 enabled)
    if (active.length && !(active.length === 2 && active.includes('v45c') && active.includes('v45f'))) {
        q.set('m', active.join(','));
    }

    const qs = q.toString();
    return qs ? `${base}${pathPart}?${qs}` : `${base}${pathPart || ''}`;
}

/** Parse current DSAP host URL into UI state (preset | browse + search, page, filters) */
function naxVibesParseDsapState(host) {
    if (!host || typeof host.getPathSegments !== 'function') {
        return { preset: 'top', page: 1, search: '', filters: { filter45Curated: true, filter45Full: true, filter4Curated: false, filter4Full: false } };
    }
    const segments = host.getPathSegments().map((s) => String(s || '').toLowerCase());
    const first = segments[0] || '';
    const qParam = host.getQueryParam('q') || host.getQueryParam('search') || '';
    const pageParam = parseInt(host.getQueryParam('page') || '1', 10) || 1;

    let preset = 'top';
    let search = (qParam || '').trim();

    if (first === 'search' || first === 'browse') {
        preset = 'browse';
    } else if (['top', 'hot', 'gems', 'debated'].indexOf(first) !== -1) {
        preset = first;
    } else if (search) {
        preset = 'browse';
    }

    // Filters from ?m= v45c,v45f,v4c or fallback to defaults
    let filters = { filter45Curated: true, filter45Full: true, filter4Curated: false, filter4Full: false };
    const m = (host.getQueryParam('m') || host.getQueryParam('models') || host.getQueryParam('filter') || '').toLowerCase();
    if (m) {
        filters = { filter45Curated: false, filter45Full: false, filter4Curated: false, filter4Full: false };
        if (m.indexOf('45c') !== -1 || m.indexOf('v45_cur') !== -1) filters.filter45Curated = true;
        if (m.indexOf('45f') !== -1 || m.indexOf('v45f') !== -1 || m.indexOf('v45') !== -1) filters.filter45Full = true;
        if (m.indexOf('4c') !== -1 || m.indexOf('v4_cur') !== -1) filters.filter4Curated = true;
        if (m.indexOf('4f') !== -1 || (m.indexOf('v4') !== -1 && m.indexOf('45') === -1)) filters.filter4Full = true;
    }

    return {
        preset,
        page: Math.max(1, pageParam),
        search,
        filters
    };
}

/* ---------- Early 2010 Web 2.0 HTML shell ---------- */
function naxVibesBuildDsapHtml() {
    return `
<div data-dsap="nax-vibes" class="dsap-root naxvibes-dsap">
  <div class="nv-chrome">
    <!-- Glossy Web 2.0 header bar -->
    <div class="nv-header">
      <div class="nv-brand">
        <span class="nv-brand-main">NAX Vibes</span>
        <span class="nv-brand-sub">community encodings • nax.moe</span>
      </div>

      <!-- Preset tabs (2010 segmented / beveled tabs) -->
      <div class="nv-presets" role="tablist" aria-label="Vibe presets">
        <button type="button" class="nv-tab" data-preset="top" data-state="on" title="Highest voted community vibes">Top Votes</button>
        <button type="button" class="nv-tab" data-preset="hot" data-state="off" title="Currently hot">Hot</button>
        <button type="button" class="nv-tab" data-preset="gems" data-state="off" title="Hidden gems">Gems</button>
        <button type="button" class="nv-tab" data-preset="debated" data-state="off" title="Most debated">Debated</button>
      </div>

      <div class="nv-toolbar">
        <!-- Classic inset search -->
        <div class="nv-search">
          <i class="fas fa-search nv-search-ico"></i>
          <input type="text" id="nvSearchInput" class="nv-search-input" placeholder="Search vibes…" aria-label="Search vibes">
        </div>

        <!-- Model filter button (click menu) -->
        <button type="button" id="nvModelBtn" class="nv-btn nv-btn-chrome" title="Model filters">
          <i class="fas fa-filter"></i>
          <span id="nvModelLabel">Models</span>
          <i class="fas fa-caret-down"></i>
        </button>

        <!-- Page nav (URL-driven, works for presets + search). Hidden when only one page and no more results. -->
        <div class="nv-pager" id="nvPager">
          <button type="button" id="nvPrevBtn" class="nv-btn nv-btn-chrome nv-btn-small" disabled title="Previous page">◀</button>
          <span id="nvPageIndicator" class="nv-page-indicator" style="font-size:10px;color:#6b768c;padding:0 4px;min-width:34px;text-align:center;">—</span>
          <button type="button" id="nvNextBtn" class="nv-btn nv-btn-chrome nv-btn-small" disabled title="Next page">▶</button>
        </div>
      </div>
    </div>

    <!-- Secondary info bar -->
    <div class="nv-infobar">
      <div class="nv-infobar-left">
        <span id="nvActivePreset">Top Votes</span>
        <span class="nv-sep">•</span>
        <span id="nvResultCount">0 vibes</span>
      </div>
      <div class="nv-infobar-right" id="nvCacheNote"></div>
    </div>
  </div>

  <!-- The grid (2010 thumbnail gallery style) -->
  <div class="nv-body" id="nvBody">
    <div id="nvGrid" class="nv-grid"></div>

    <div id="nvEmpty" class="nv-empty hidden">
      <div class="nv-empty-icon"><i class="fas fa-images"></i></div>
      <div class="nv-empty-text">No vibes match your search or filters.</div>
      <div class="nv-empty-hint">Try clearing filters or searching for something else.</div>
    </div>

    <div id="nvLoading" class="nv-loading hidden">
      <div class="nv-loading-bar"><div class="nv-loading-fill"></div></div>
      <div class="nv-loading-text">Loading vibes from the community…</div>
    </div>
  </div>

  <!-- Classic Web 2.0 status bar -->
  <div class="nv-statusbar" id="nvStatusBar">
    <span id="nvStatusText">Ready</span>
  </div>
</div>
`;
}

/* ---------- Early 2010s Web 2.0 scoped CSS (glossy, beveled, embossed) ---------- */
const naxVibesDsapScopedCss = `
.naxvibes-dsap {
  --nv-bg: #0f1116;
  --nv-panel: #161a22;
  --nv-header-top: #2f3f5a;
  --nv-header-bot: #1c2538;
  --nv-accent: #4a8fd9;
  --nv-accent2: #e07a3d;
  --nv-text: #e6e9f0;
  --nv-text-dim: #9aa3b5;
  --nv-border: #2a3344;
  --nv-inset: #0a0c11;
  --nv-gloss: linear-gradient(to bottom, rgba(255,255,255,0.18), rgba(255,255,255,0.02));
  font-family: "Segoe UI", Tahoma, Arial, Helvetica, sans-serif;
  font-size: 13px;
  color: var(--nv-text);
  background: var(--nv-bg);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 420px;
  border: 1px solid #1f2533;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}

/* Glossy 2010 header */
.naxvibes-dsap .nv-header {
  background: linear-gradient(to bottom, var(--nv-header-top), var(--nv-header-bot));
  border-bottom: 1px solid #11161f;
  box-shadow: 0 1px 0 rgba(255,255,255,0.08) inset,
              0 2px 6px rgba(0,0,0,0.5);
  padding: 8px 10px 6px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.naxvibes-dsap .nv-brand {
  display: flex;
  flex-direction: column;
  line-height: 1.05;
  margin-right: 4px;
  min-width: 118px;
}
.naxvibes-dsap .nv-brand-main {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: .3px;
  color: #f0f4ff;
  text-shadow: 0 1px 1px rgba(0,0,0,0.6);
}
.naxvibes-dsap .nv-brand-sub {
  font-size: 10px;
  color: #8fa3c2;
  text-transform: uppercase;
  letter-spacing: .6px;
}

.naxvibes-dsap .nv-presets {
  display: flex;
  background: #11161f;
  border: 1px solid #0c1018;
  border-radius: 4px;
  padding: 2px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.5) inset;
}
.naxvibes-dsap .nv-tab {
  appearance: none;
  background: linear-gradient(to bottom, #2a3242, #1b2230);
  color: #c5d0e3;
  border: 1px solid #3a4357;
  border-radius: 3px;
  padding: 4px 11px 3px;
  font-size: 11px;
  font-weight: 600;
  margin: 0 1px;
  cursor: var(--c-pointer);
  box-shadow: 0 1px 0 rgba(255,255,255,0.08) inset;
  transition: all .05s ease;
}
.naxvibes-dsap .nv-tab[data-state="on"] {
  background: linear-gradient(to bottom, #4a8fd9, #2f5d9c);
  color: #fff;
  border-color: #1f4d85;
  box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset,
              0 1px 3px rgba(0,0,0,0.3);
  text-shadow: 0 1px 1px rgba(0,0,0,0.4);
}
.naxvibes-dsap .nv-tab:active {
  transform: translateY(1px);
  box-shadow: 0 1px 3px rgba(0,0,0,0.4) inset;
}

.naxvibes-dsap .nv-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 220px;
  justify-content: flex-end;
}

.naxvibes-dsap .nv-pager {
  display: flex;
  align-items: center;
  gap: 1px;
}
.naxvibes-dsap .nv-page-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  padding-top: 1px; /* small optical adjustment for visual center with small arrow buttons */
}

.naxvibes-dsap .nv-search {
  position: relative;
  flex: 1;
  max-width: 260px;
  display: flex;
  align-items: center;
}
.naxvibes-dsap .nv-search-input {
  flex: 1;
  min-width: 0;
  background: var(--nv-inset);
  color: var(--nv-text);
  border: 1px solid #2a3344;
  border-radius: 3px;
  padding: 5px 8px 5px 4px;
  font-size: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.5) inset;
  outline: none;
  line-height: 1.2;
}
.naxvibes-dsap .nv-search-input:focus {
  border-color: var(--nv-accent);
  box-shadow: 0 0 0 1px rgba(74,143,217,0.4) inset;
}
.naxvibes-dsap .nv-search-ico {
  flex-shrink: 0;
  margin-left: 8px;
  margin-right: 6px;
  color: #5f6d85;
  font-size: 11px;
  pointer-events: none;
  line-height: 1;
  display: flex;
  align-items: center;
}

/* Chrome / beveled buttons (classic Web 2.0) */
.naxvibes-dsap .nv-btn {
  appearance: none;
  background: linear-gradient(to bottom, #e6ebf5, #b8c4d8);
  color: #1e2533;
  border: 1px solid #5f6f8a;
  border-radius: 3px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: var(--c-pointer);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  box-shadow: 0 1px 0 #fff inset,
              0 1px 2px rgba(0,0,0,0.35);
  text-shadow: 0 1px 0 rgba(255,255,255,0.6);
  white-space: nowrap;
}
.naxvibes-dsap .nv-btn:hover {
  background: linear-gradient(to bottom, #f0f4fc, #c4d0e6);
}
.naxvibes-dsap .nv-btn:active {
  background: linear-gradient(to bottom, #a8b4cc, #c8d4e8);
  box-shadow: 0 2px 3px rgba(0,0,0,0.4) inset;
  transform: translateY(1px);
}
.naxvibes-dsap .nv-btn-chrome {
  background: linear-gradient(to bottom, #3a455c, #242d40);
  color: #d8e0f0;
  border-color: #1b2230;
  text-shadow: 0 1px 1px rgba(0,0,0,0.5);
  box-shadow: 0 1px 0 rgba(255,255,255,0.1) inset,
              0 1px 2px rgba(0,0,0,0.5);
}
.naxvibes-dsap .nv-btn-chrome:hover {
  background: linear-gradient(to bottom, #46516b, #2a3348);
}
.naxvibes-dsap .nv-btn-chrome:active {
  background: linear-gradient(to bottom, #1f2636, #2a3348);
  color: #b8c4d8;
}
.naxvibes-dsap .nv-btn-small {
  padding: 2px 7px;
  font-size: 10px;
}

.naxvibes-dsap .nv-pager {
  display: flex;
  gap: 3px;
  margin-left: 2px;
}

/* Info bar */
.naxvibes-dsap .nv-infobar {
  background: #12161f;
  border-bottom: 1px solid #1f2533;
  padding: 3px 10px;
  font-size: 11px;
  color: var(--nv-text-dim);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.naxvibes-dsap .nv-infobar-left { display: flex; align-items: center; gap: 6px; }
.naxvibes-dsap .nv-sep { color: #3a4357; }
.naxvibes-dsap .nv-infobar-right { font-size: 10px; color: #6b768c; }

/* Body / grid */
.naxvibes-dsap .nv-body {
  flex: 1;
  overflow: auto;
  padding: 10px;
  background: #0c0e14;
  position: relative;
}
.naxvibes-dsap .nv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 10px;
}
.naxvibes-dsap .nv-grid.nv-loading { opacity: .65; pointer-events: none; }

/* 2010-style cards */
.naxvibes-dsap .nv-card {
  background: #1a1f2a;
  border: 1px solid #2a3344;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 2px 5px rgba(0,0,0,0.55),
              0 0 0 1px #222a38 inset;
  display: flex;
  flex-direction: column;
  cursor: var(--c-pointer);
  transition: box-shadow .08s ease, transform .04s ease;
}
.naxvibes-dsap .nv-card:hover {
  box-shadow: 0 3px 9px rgba(0,0,0,0.65),
              0 0 0 1px #3a4a66 inset;
  transform: translateY(-1px);
}
.naxvibes-dsap .nv-card[data-nsfw="1"] {
  box-shadow: 0 2px 5px rgba(0,0,0,0.55), 0 0 0 1px #4a2f2f inset;
}

.naxvibes-dsap .nv-card-img-wrap {
  position: relative;
  background: #11151d;
  aspect-ratio: 1 / 1;
  overflow: hidden;
}
.naxvibes-dsap .nv-card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  image-rendering: -webkit-optimize-contrast;
}
.naxvibes-dsap .nv-card-votes {
  position: absolute;
  top: 5px;
  right: 5px;
  background: rgba(12,14,20,0.92);
  border: 1px solid #2f3749;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  line-height: 1;
  display: flex;
  gap: 4px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.6);
}
.naxvibes-dsap .nv-card-votes span {
  color: #a8b6d4;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.naxvibes-dsap .nv-card-votes i { font-size: 9px; }

.naxvibes-dsap .nv-card-badges {
  position: absolute;
  bottom: 4px;
  left: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

/* Glossy model badges (little metal tags) */
.naxvibes-dsap .nv-badge {
  font-size: 9px;
  line-height: 1;
  padding: 2px 5px 1px;
  border-radius: 2px;
  background: linear-gradient(to bottom, #3f4c64, #252d3e);
  color: #c8d4ec;
  border: 1px solid #1f2635;
  box-shadow: 0 1px 0 rgba(255,255,255,0.1) inset;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.naxvibes-dsap .nv-badge .nv-ie {
  background: #1c2331;
  padding: 0 3px;
  border-radius: 1px;
  font-weight: 700;
  color: #9fb3d9;
}

.naxvibes-dsap .nv-card-caption {
  background: linear-gradient(to bottom, #202632, #181d28);
  border-top: 1px solid #2a3344;
  padding: 5px 6px 4px;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.naxvibes-dsap .nv-card-caption .nv-name {
  color: #e6e9f0;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.naxvibes-dsap .nv-card-caption .nv-sub {
  color: #78869f;
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Empty + loading states (retro) */
.naxvibes-dsap .nv-empty {
  text-align: center;
  padding: 60px 20px 70px;
  color: #6b768c;
}
.naxvibes-dsap .nv-empty-icon { font-size: 42px; opacity: .5; margin-bottom: 10px; }
.naxvibes-dsap .nv-empty-text { font-size: 13px; margin-bottom: 4px; }
.naxvibes-dsap .nv-empty-hint { font-size: 11px; opacity: .7; }

.naxvibes-dsap .nv-loading {
  position: absolute;
  inset: 0;
  background: rgba(12,14,20,0.75);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  z-index: 5;
}
.naxvibes-dsap .nv-loading-bar {
  width: 160px;
  height: 8px;
  background: #1a1f2a;
  border: 1px solid #2a3344;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0,0,0,0.5) inset;
}
.naxvibes-dsap .nv-loading-fill {
  height: 100%;
  width: 38%;
  background: linear-gradient(to right, #4a8fd9, #7ab0f0, #4a8fd9);
  background-size: 180% 100%;
  animation: nv-marquee 1.1s linear infinite;
}
@keyframes nv-marquee {
  0% { background-position: 200% 0; }
  100% { background-position: -100% 0; }
}
.naxvibes-dsap .nv-loading-text {
  font-size: 11px;
  color: #7c8aa4;
  letter-spacing: .3px;
}

/* Classic status bar */
.naxvibes-dsap .nv-statusbar {
  background: #0b0d13;
  border-top: 1px solid #1f2533;
  padding: 2px 10px;
  font-size: 10px;
  color: #5f6d85;
  display: flex;
  align-items: center;
  min-height: 20px;
  box-shadow: 0 -1px 0 rgba(255,255,255,0.03) inset;
}
.naxvibes-dsap .nv-statusbar #nvStatusText {
  font-family: monospace, monospace;
}

/* Encoding picker inside DSAP (simple grid overlay) */
.naxvibes-dsap .nv-picker {
  position: absolute;
  inset: 8px;
  background: rgba(15,17,22,0.97);
  border: 2px solid #2a3344;
  border-radius: 5px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.7);
  z-index: 40;
  padding: 8px;
  display: none;
  flex-direction: column;
}
.naxvibes-dsap .nv-picker.open { display: flex; }
.naxvibes-dsap .nv-picker-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 6px;
  border-bottom: 1px solid #222a38;
  margin-bottom: 6px;
}
.naxvibes-dsap .nv-picker-head .nv-picker-title { font-weight: 700; font-size: 12px; }
.naxvibes-dsap .nv-picker-close {
  background: #3a2a2a;
  color: #f0a0a0;
  border: 1px solid #5a3a3a;
  padding: 1px 7px;
  border-radius: 2px;
  cursor: var(--c-pointer);
  font-size: 11px;
}
.naxvibes-dsap .nv-enc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 6px;
  overflow: auto;
  flex: 1;
}
.naxvibes-dsap .nv-enc-cell {
  background: #161a22;
  border: 1px solid #2a3344;
  border-radius: 3px;
  overflow: hidden;
  cursor: var(--c-pointer);
  font-size: 10px;
}
.naxvibes-dsap .nv-enc-cell:hover { border-color: var(--nv-accent); }
.naxvibes-dsap .nv-enc-thumb { aspect-ratio: 1.2 / 1; background: #11151d; overflow: hidden; }
.naxvibes-dsap .nv-enc-thumb img { width: 100%; height: 100%; object-fit: cover; }
.naxvibes-dsap .nv-enc-meta { padding: 3px 5px 4px; line-height: 1.15; }
.naxvibes-dsap .nv-enc-meta .nv-enc-model { font-weight: 600; color: #c8d4ec; }
.naxvibes-dsap .nv-enc-meta .nv-enc-ie { color: #78869f; font-size: 9px; }

/* Responsive tweaks */
@media (max-width: 620px) {
  .naxvibes-dsap .nv-grid { grid-template-columns: repeat(auto-fill, minmax(126px, 1fr)); }
  .naxvibes-dsap .nv-header { flex-direction: column; align-items: stretch; }
  .naxvibes-dsap .nv-toolbar { justify-content: flex-start; }
}
`;

/* ---------- The DSAP driver (init + behavior) ---------- */
function naxVibesDsapDriver(host) {
    const root = host.getRoot();
    if (!root) return {};

    // Current UI state (always kept in sync with the parsed URI)
    let vibes = [];
    let lastMeta = null;
    let preset = 'top';
    let page = 1;
    let search = '';
    let filters = { filter45Curated: true, filter45Full: true, filter4Curated: false, filter4Full: false };
    let loading = false;
    let requestGen = 0;
    let importInProgress = false;
    let currentHost = host;

    // Element refs (scoped to this DSAP root)
    const grid = root.querySelector('#nvGrid');
    const emptyEl = root.querySelector('#nvEmpty');
    const loadingEl = root.querySelector('#nvLoading');
    const statusBar = root.querySelector('#nvStatusBar');
    const statusText = root.querySelector('#nvStatusText');
    const searchInput = root.querySelector('#nvSearchInput');
    const modelBtn = root.querySelector('#nvModelBtn');
    const modelLabel = root.querySelector('#nvModelLabel');
    const prevBtn = root.querySelector('#nvPrevBtn');
    const nextBtn = root.querySelector('#nvNextBtn');
    const pagerWrap = root.querySelector('#nvPager');
    const resultCount = root.querySelector('#nvResultCount');
    const activePresetLabel = root.querySelector('#nvActivePreset');
    const cacheNote = root.querySelector('#nvCacheNote');
    const bodyEl = root.querySelector('#nvBody');

    // Encoding picker (in-root overlay)
    let pickerEl = null;

    function setStatus(text) {
        if (statusText) statusText.textContent = text || 'Ready';
    }

    function updateInfoBar() {
        if (activePresetLabel) {
            const map = { top: 'Top Votes', hot: 'Hot', gems: 'Hidden Gems', debated: 'Debated', browse: 'Browse' };
            if (search) {
                activePresetLabel.textContent = `Search: “${search}”`;
            } else {
                activePresetLabel.textContent = map[preset] || preset;
            }
        }
        if (resultCount) {
            const n = vibes.length;
            const pageBit = (page > 1 || (lastMeta && lastMeta.hasMore)) ? ` · page ${page}` : '';
            resultCount.textContent = `${n} vibes${pageBit}`;
        }
        const pageInd = root.querySelector('#nvPageIndicator');
        if (pageInd) {
            pageInd.textContent = (page > 1 || (lastMeta && lastMeta.hasMore)) ? String(page) : '—';
        }
        if (cacheNote) {
            cacheNote.textContent = lastMeta && lastMeta.fromCache
                ? `cached ${naxVibesDsapFormatCacheAge(lastMeta.cachedAt)}`
                : '';
        }
    }

    function syncPresetTabs() {
        const browse = (preset === 'browse' || !!search);
        root.querySelectorAll('.nv-tab[data-preset]').forEach((btn) => {
            const btnPreset = btn.dataset.preset;
            const isActive = !browse && btnPreset === preset;
            btn.setAttribute('data-state', isActive ? 'on' : 'off');
        });

        // Hide pager entirely when we are on the first (and only) page with no more results.
        const hasPagination = page > 1 || (lastMeta && lastMeta.hasMore);
        if (pagerWrap) pagerWrap.style.display = hasPagination ? 'flex' : 'none';

        if (prevBtn) prevBtn.disabled = page <= 1;
        if (nextBtn) nextBtn.disabled = !(lastMeta && lastMeta.hasMore);
    }

    function isBrowseMode() {
        return preset === 'browse' || !!search;
    }

    /** Apply a parsed state object to closure + sync visible controls (no data load) */
    function applyState(state) {
        preset = state.preset || 'top';
        page = Math.max(1, parseInt(state.page, 10) || 1);
        search = (state.search || '').trim();
        if (state.filters) filters = { ...state.filters };

        if (searchInput) searchInput.value = search;
        updateModelFilterButton();
        syncPresetTabs();
        updateInfoBar();
    }

    /** Navigate the *app browser* (Grimoire shell) so back/forward, address bar, and history are correct */
    function navigateToState(newState) {
        if (!currentHost || typeof currentHost.navigate !== 'function') {
            // Fallback: mutate + reload locally (should rarely happen)
            applyState(newState);
            void loadData(false);
            return;
        }
        const url = naxVibesBuildDsapUrl({
            preset: newState.preset,
            page: newState.page || 1,
            search: newState.search || '',
            filters: newState.filters || filters
        });
        currentHost.navigate(url);
        // The shell will re-activate the driver with the new URL → init() will parse + load
    }

    function setPreset(id) {
        navigateToState({ preset: id, page: 1, search: '', filters });
    }

    function buildPayload(forceRefresh) {
        const p = {
            ...filters,
            forceRefresh: !!forceRefresh
        };
        if (search) p.search = search;

        const isPresetHome = !search && ['top', 'hot', 'gems', 'debated'].indexOf(preset) !== -1 && page <= 1;

        if (isPresetHome) {
            // Classic preset mode: do not send page so backend uses the special negative page for "Hot", "Gems" etc.
            p.preset = preset;
        } else {
            // Browse/search or paged preset view: send positive page for pagination
            p.page = page;
            if (!search && ['top', 'hot', 'gems', 'debated'].indexOf(preset) !== -1) {
                p.preset = preset; // still send for meta / "more of this feed"
            }
        }
        return p;
    }

    async function loadData(forceRefresh = false) {
        const h = currentHost || host;
        const safeToast = (kind, title, msg, sticky, dur, icon) => {
            try {
                if (h && typeof h.showToast === 'function') {
                    h.showToast(kind, title, msg, sticky, dur, icon);
                } else if (typeof showGlassToast === 'function') {
                    showGlassToast(kind, title, msg, sticky, dur, icon);
                }
            } catch (e) { /* never let a toast kill the applet */ }
        };

        if (typeof wsClient === 'undefined' || !wsClient || !wsClient.isConnected()) {
            safeToast('error', null, 'WebSocket not connected', false, 4000, '<i class="fas fa-plug"></i>');
            // Make failure visible + retry (common when first opening Grimoire panes)
            if (emptyEl) emptyEl.classList.remove('hidden');
            if (grid) grid.innerHTML = '<div style="padding:20px;color:#6b768c;font-size:12px;text-align:center;">Waiting for WebSocket… <button onclick="this.closest(\'.naxvibes-dsap\') && location.reload()" style="margin-left:6px;font-size:10px;">Retry</button></div>';
            setStatus('Waiting for connection…');
            setTimeout(() => { try { loadData(forceRefresh); } catch (e) {} }, 900);
            return;
        }
        // ensure at least one model filter is active
        const any = Object.values(filters).some(Boolean);
        if (!any) { filters.filter45Curated = true; filters.filter45Full = true; }

        const gen = ++requestGen;
        loading = true;
        if (grid) grid.classList.add('nv-loading');
        if (loadingEl) loadingEl.classList.remove('hidden');
        setStatus('Loading…');

        try {
            const payload = buildPayload(forceRefresh);
            const data = await wsClient.sendMessage('get_nax_vibes_gallery', payload, false);
            if (gen !== requestGen) return;

            vibes = (data && data.vibes) || [];
            vibes.forEach((v) => {
                (v.encodings || []).forEach((enc) => {
                    const m = String(enc.model || '').toLowerCase().replace(/[-_\s]/g, '');
                    enc.forgeKey = (m === 'v5full' || m === 'v5f') ? 'v5'
                        : (m === 'v5curated' || m === 'v5c') ? 'v5_cur'
                        : (m === 'v45full' || m === 'v45f') ? 'v4_5'
                        : (m === 'v45curated' || m === 'v45c') ? 'v4_5_cur'
                        : (m === 'v4full' || m === 'v4f') ? 'v4'
                        : (m === 'v4curated' || m === 'v4c') ? 'v4_cur'
                        : null;
                });
            });
            lastMeta = data;
            renderGrid();
            syncPresetTabs();
            updateInfoBar();
            setStatus('');
        } catch (e) {
            if (gen !== requestGen) return;
            console.error('nax-vibes dsap load', e);
            vibes = [];
            renderGrid();
            safeToast('error', null, e.message || 'Failed to load vibes', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            setStatus('Load failed');
        } finally {
            if (gen === requestGen) {
                loading = false;
                if (grid) grid.classList.remove('nv-loading');
                if (loadingEl) loadingEl.classList.add('hidden');
            }
        }
    }

    // Back-compat alias used by a couple of buttons
    async function reload(forceRefresh = false) {
        return loadData(forceRefresh);
    }

    function getActiveEncoding(vibe, card) {
        const encId = card && card.dataset.activeEncodingId
            ? parseInt(card.dataset.activeEncodingId, 10)
            : vibe.activeEncodingId;
        return (vibe.encodings || []).find((e) => e.id === encId)
            || (vibe.encodings || []).find((e) => e.primary)
            || (vibe.encodings || [])[0];
    }

    function buildBadgeHtml(enc) {
        const name = (typeof naxVibeEncodingDisplayModel === 'function')
            ? naxVibeEncodingDisplayModel(enc)
            : (enc.modelShort || enc.model || '');
        const ieRaw = parseFloat(enc.infoExtracted);
        const ie = Number.isFinite(ieRaw) && ieRaw <= 1 ? (ieRaw * 100).toFixed(0) : (enc.infoExtracted || '');
        return `<div class="nv-badge"><span>${naxVibesDsapEscapeHtml(name)}</span><span class="nv-ie">${ie}%</span></div>`;
    }

    function createCard(vibe) {
        const card = document.createElement('div');
        card.className = 'nv-card';
        card.dataset.vibeId = String(vibe.id);
        if (vibe.nsfw) card.dataset.nsfw = '1';

        const active = getActiveEncoding(vibe, null);
        if (active) card.dataset.activeEncodingId = String(active.id);
        card._vibeData = vibe;

        const wrap = document.createElement('div');
        wrap.className = 'nv-card-img-wrap';

        const img = document.createElement('img');
        img.className = 'nv-card-img';
        img.alt = vibe.name || 'vibe';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = naxVibesDsapResolvePreviewUrl((active && active.thumbnailUrl) || vibe.thumbnailUrl || '');

        const votes = document.createElement('div');
        votes.className = 'nv-card-votes';
        votes.innerHTML = `<span><i class="fas fa-arrow-up"></i>${vibe.upvotes || 0}</span><span><i class="fas fa-arrow-down"></i>${vibe.downvotes || 0}</span>`;

        const badges = document.createElement('div');
        badges.className = 'nv-card-badges';
        (vibe.encodings || []).forEach((enc) => {
            const b = document.createElement('div');
            b.innerHTML = buildBadgeHtml(enc);
            if (b.firstElementChild) badges.appendChild(b.firstElementChild);
        });

        wrap.appendChild(img);
        wrap.appendChild(votes);
        wrap.appendChild(badges);

        const cap = document.createElement('div');
        cap.className = 'nv-card-caption';
        const nameEl = document.createElement('div');
        nameEl.className = 'nv-name';
        nameEl.textContent = vibe.name || `Vibe ${vibe.id}`;
        cap.appendChild(nameEl);

        if (active) {
            const sub = document.createElement('div');
            sub.className = 'nv-sub';
            const disp = (typeof naxVibeEncodingDisplayModel === 'function') ? naxVibeEncodingDisplayModel(active) : (active.modelShort || '');
            sub.textContent = `${disp} ${active.infoExtracted || ''}`;
            cap.appendChild(sub);
        }

        card.appendChild(wrap);
        card.appendChild(cap);

        card.addEventListener('click', (e) => {
            if (e.target.closest('.nv-card-badges')) return;
            openVibePreview(vibe, card);
        });

        // Context menu (global contextMenu works inside DSAP root)
        attachContextMenu(card, vibe);

        return card;
    }

    function renderGrid() {
        if (!grid) return;
        grid.innerHTML = '';

        if (!vibes.length) {
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');

        const frag = document.createDocumentFragment();
        vibes.forEach((v) => frag.appendChild(createCard(v)));
        grid.appendChild(frag);
    }

    function openVibePreview(vibe, card) {
        const enc = getActiveEncoding(vibe, card);
        const src = naxVibesDsapResolvePreviewUrl((enc && enc.thumbnailUrl) || vibe.thumbnailUrl);
        if (!src || typeof openImageInViewer !== 'function') return;
        openImageInViewer(src, vibe.name, {
            url: src,
            genericExternalImage: true,
            naxVibeId: vibe.id,
            naxEncodingId: enc && enc.id
        });
    }

    function attachContextMenu(card, vibe) {
        if (!card || !contextMenu || !vibe) return;

        const buildSub = (items) => items;

        const cfg = {
            onAction: (action, target, item) => {
                const data = card._vibeData;
                if (!data) return;
                if (action === 'naxv-import-full') {
                    importVibe(data, false);
                } else if (action === 'naxv-import-select') {
                    showEncodingPicker(data);
                } else if (action === 'naxv-import-enc' && item && item.encodingId) {
                    importVibe(data, true, item.encodingId, item.previewUrl);
                } else if (action === 'naxv-preview-enc' && item && item.encodingId) {
                    const enc = (data.encodings || []).find((x) => x.id === item.encodingId);
                    if (enc) setCardActiveEncoding(card, enc);
                }
            },
            sections: [{
                type: 'list',
                items: [
                    {
                        text: 'Import…',
                        icon: 'nai-import',
                        openOnHover: true,
                        submenu: [
                            { text: 'Import All Encodings', icon: 'nai-import', action: 'naxv-import-full' },
                            { text: 'Select Encoding…', icon: 'fas fa-grid-2', action: 'naxv-import-select' },
                            { separator: true, text: 'By Model' },
                            ...((vibe.encodings || []).map((enc) => ({
                                text: ((typeof naxVibeEncodingDisplayModel === 'function') ? naxVibeEncodingDisplayModel(enc) : enc.model) + ' · ' + (enc.infoExtracted || ''),
                                icon: 'nai-vibe-transfer',
                                action: 'naxv-import-enc',
                                encodingId: enc.id,
                                previewUrl: enc.thumbnailUrl || vibe.thumbnailUrl
                            })))
                        ]
                    },
                    {
                        text: 'Preview encodings',
                        icon: 'fas fa-eye',
                        openOnHover: true,
                        submenu: (vibe.encodings || []).map((enc) => ({
                            text: ((typeof naxVibeEncodingDisplayModel === 'function') ? naxVibeEncodingDisplayModel(enc) : enc.model) + ' · ' + (enc.infoExtracted || ''),
                            icon: 'fas fa-eye',
                            action: 'naxv-preview-enc',
                            encodingId: enc.id
                        }))
                    }
                ]
            }]
        };

        try {
            if (typeof contextMenu.detachFromElement === 'function') contextMenu.detachFromElement(card);
            contextMenu.attachToElement(card, cfg);
        } catch (e) { /* ignore */ }
    }

    function setCardActiveEncoding(card, enc) {
        if (!card || !enc) return;
        card.dataset.activeEncodingId = String(enc.id);
        const img = card.querySelector('.nv-card-img');
        if (img) img.src = naxVibesDsapResolvePreviewUrl(enc.thumbnailUrl || '');
        const sub = card.querySelector('.nv-sub');
        if (sub) {
            const disp = (typeof naxVibeEncodingDisplayModel === 'function') ? naxVibeEncodingDisplayModel(enc) : (enc.modelShort || '');
            sub.textContent = `${disp} ${enc.infoExtracted || ''}`;
        }
    }

    function showEncodingPicker(vibe) {
        // Create or show in-root picker
        if (!pickerEl) {
            pickerEl = document.createElement('div');
            pickerEl.className = 'nv-picker';
            bodyEl.appendChild(pickerEl);
        }
        pickerEl.innerHTML = `
            <div class="nv-picker-head">
                <div class="nv-picker-title">Choose encoding — ${naxVibesDsapEscapeHtml(vibe.name)}</div>
                <button type="button" class="nv-picker-close">Close</button>
            </div>
            <div class="nv-enc-grid"></div>
        `;
        const gridEnc = pickerEl.querySelector('.nv-enc-grid');
        const closeBtn = pickerEl.querySelector('.nv-picker-close');

        (vibe.encodings || []).forEach((enc) => {
            const cell = document.createElement('div');
            cell.className = 'nv-enc-cell';
            const disp = (typeof naxVibeEncodingDisplayModel === 'function') ? naxVibeEncodingDisplayModel(enc) : (enc.modelShort || enc.model || '');
            cell.innerHTML = `
                <div class="nv-enc-thumb"><img src="${naxVibesDsapResolvePreviewUrl(enc.thumbnailUrl || '')}" loading="lazy"></div>
                <div class="nv-enc-meta">
                    <div class="nv-enc-model">${naxVibesDsapEscapeHtml(disp)}</div>
                    <div class="nv-enc-ie">IE ${enc.infoExtracted || ''}</div>
                </div>
            `;
            cell.addEventListener('click', () => {
                hidePicker();
                importVibe(vibe, true, enc.id, enc.thumbnailUrl || vibe.thumbnailUrl);
            });
            gridEnc.appendChild(cell);
        });

        closeBtn.onclick = () => hidePicker();
        pickerEl.classList.add('open');
    }

    function hidePicker() {
        if (pickerEl) pickerEl.classList.remove('open');
    }

    async function importVibe(vibe, single = false, encodingId = null, previewOverride = '') {
        if (importInProgress) return;
        if (typeof wsClient === 'undefined' || !wsClient || !wsClient.isConnected()) {
            (currentHost || host).showToast('error', null, 'WebSocket not connected', false, 4000, '<i class="fas fa-plug"></i>');
            return;
        }

        importInProgress = true;

        // Use the global confirmation progress if available (matches old behavior)
        let progressModal = null;
        if (typeof showConfirmationDialog === 'function') {
            const label = naxVibesDsapEscapeHtml(vibe.name || 'Vibe');
            progressModal = showConfirmationDialog(
                `<div style="text-align:left;display:flex;flex-direction:column;gap:8px;">
                    <div role="progressbar" class="marquee animate"><div></div></div>
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:var(--text-accent);">${label}</span>
                        <span style="color:var(--text-accent-tinted);">Downloading…</span>
                    </div>
                 </div>`,
                [], null, { title: 'Import Vibe', icon: 'nai-import', showCloseButton: false, width: 380, manualPosition: true }
            );
        }

        try {
            let downloadUrl = vibe.downloadFullUrl;
            let previewUrl = previewOverride || vibe.thumbnailUrl || '';
            let encoding = null;

            if (single && encodingId) {
                const enc = (vibe.encodings || []).find((e) => e.id === encodingId);
                if (enc) {
                    if (!previewUrl) previewUrl = enc.thumbnailUrl || '';
                    encoding = enc;
                    downloadUrl = `https://nax.moe/partials/api/vibe-download.php?id=${vibe.id}&single=true&encoding_id=${encodingId}`;
                }
            }

            previewUrl = naxVibesDsapResolvePreviewUrl(previewUrl);

            // workspace resolution (same as old)
            let workspaceId = 'default';
            if (typeof cacheManagerCurrentWorkspace !== 'undefined' && cacheManagerCurrentWorkspace) workspaceId = cacheManagerCurrentWorkspace;
            else if (typeof activeWorkspace !== 'undefined' && activeWorkspace) workspaceId = activeWorkspace;

            const meta = {
                displayName: (vibe && vibe.name) ? String(vibe.name).trim() : `Vibe ${vibe && vibe.id ? vibe.id : ''}`,
                description: [
                    'Imported from NAX.moe community gallery.',
                    vibe && vibe.id ? `NAX vibe ID: ${vibe.id}` : '',
                    vibe && vibe.nsfw ? 'Content: NSFW' : '',
                    (vibe && (vibe.upvotes != null || vibe.downvotes != null)) ? `Votes: ↑${vibe.upvotes || 0} ↓${vibe.downvotes || 0}` : '',
                    encoding ? `Imported encoding: ${ (typeof naxVibeEncodingDisplayModel === 'function' ? naxVibeEncodingDisplayModel(encoding) : encoding.model) } · IE ${encoding.infoExtracted}` : ''
                ].filter(Boolean).join('\n'),
                forceLocked: true
            };

            const resp = await wsClient.importVibeFromUrl(downloadUrl, previewUrl, workspaceId, '', meta);
            if (!resp || !resp.success) throw new Error((resp && resp.message) || 'Import failed');

            (currentHost || host).showToast('success', 'Vibe Imported', `Imported to workspace`, false, 3800, '<i class="nai-check"></i>');

            // Refresh downstream UIs
            if (typeof refreshReferenceManagerAfterVibeOperation === 'function') {
                await refreshReferenceManagerAfterVibeOperation();
            }
            if (typeof loadCacheManagerImages === 'function') {
                const mgrOpen = typeof cacheManagerModal !== 'undefined' && cacheManagerModal && cacheManagerModal.classList.contains('modal-open');
                if (mgrOpen) await loadCacheManagerImages();
            } else if (typeof loadCacheImages === 'function') {
                await loadCacheImages();
            }
            if (typeof refreshReferenceBrowserIfOpen === 'function') {
                await refreshReferenceBrowserIfOpen();
            }
        } catch (e) {
            console.error('DSAP vibe import', e);
            (currentHost || host).showToast('error', null, e.message || 'Import failed', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        } finally {
            importInProgress = false;
            if (typeof hideConfirmationDialog === 'function') hideConfirmationDialog();
            if (pickerEl) pickerEl.classList.remove('open');
        }
    }

    function updateModelFilterButton() {
        if (!modelBtn || !modelLabel) return;
        const defaults = { filter45Curated: true, filter45Full: true, filter4Curated: false, filter4Full: false };
        const customized = Object.keys(filters).some((k) => !!filters[k] !== !!defaults[k]);
        modelBtn.setAttribute('data-state', customized ? 'open' : 'off');
        modelLabel.textContent = customized ? 'Models*' : 'Models';
    }

    function setupModelMenu() {
        if (!modelBtn || !contextMenu) return;

        const refreshItems = () => {
            const items = [];
            const pushFilter = (key, label) => {
                items.push({
                    text: label,
                    action: 'toggle-model-filter',
                    keepMenuOpen: true,
                    filterKey: key,
                    loadfn: (it) => { it.checked = !!filters[key]; }
                });
            };

            // Prefer current model group if available
            const currentGroup = (typeof modelGroups !== 'undefined')
                ? modelGroups.find((g) => g.group === 'Current Model') : null;

            if (currentGroup) {
                currentGroup.options.forEach((opt) => {
                    const f = (typeof NAX_VIBES_MODEL_FILTERS !== 'undefined')
                        ? NAX_VIBES_MODEL_FILTERS.find((ff) => ff.forgeKey === opt.value) : null;
                    if (f) pushFilter(f.key, opt.name || f.key);
                });
            } else {
                pushFilter('filter45Curated', 'NAI V4.5 Curated');
                pushFilter('filter45Full', 'NAI V4.5 Full');
                pushFilter('filter4Curated', 'NAI V4 Curated');
                pushFilter('filter4Full', 'NAI V4 Full');
            }
            return items;
        };

        const menuCfg = {
            position: 'anchor',
            anchorAlign: 'end',
            beforeShow: () => { /* items rebuilt below */ },
            sections: [{ type: 'list', items: refreshItems() }],
            onAction: (action, t, item) => {
                if (action !== 'toggle-model-filter' || !item.filterKey) return;
                filters[item.filterKey] = !filters[item.filterKey];
                updateModelFilterButton();
                // Drive through app browser nav so ?m= is in the URI and history works
                navigateToState({ preset, page: 1, search, filters });
                // re-render the open menu (will be re-created on next open after nav, but keep UI consistent)
                if (contextMenu.isOpen && contextMenu.currentTarget === modelBtn) {
                    menuCfg.sections[0].items = refreshItems();
                    contextMenu.renderMenu(menuCfg, modelBtn);
                    contextMenu.executeLoadFunctions(menuCfg, modelBtn);
                }
            }
        };
        contextMenu.attachClickMenuToElement(modelBtn, menuCfg);
        updateModelFilterButton();
    }

    function wireEvents() {
        if (root.dataset.nvEventsWired === 'true') {
            return;
        }
        root.dataset.nvEventsWired = 'true';

        // Presets — all go through app browser navigation so URI + history are updated
        root.querySelectorAll('.nv-tab[data-preset]').forEach((btn) => {
            btn.addEventListener('click', () => setPreset(btn.dataset.preset));
        });

        if (searchInput) {
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = (searchInput.value || '').trim();
                    navigateToState({ preset: 'browse', page: 1, search: val, filters });
                }
            });
        }

        // Pagination is now available for all views (presets + search). We drive it via the URI.
        if (prevBtn) prevBtn.addEventListener('click', () => {
            if (page <= 1) return;
            navigateToState({ preset, page: page - 1, search, filters });
        });
        if (nextBtn) nextBtn.addEventListener('click', () => {
            if (!(lastMeta && lastMeta.hasMore)) return;
            navigateToState({ preset, page: page + 1, search, filters });
        });

        setupModelMenu();

        // Click anywhere in body to close picker (outside cards)
        if (bodyEl) {
            bodyEl.addEventListener('click', (e) => {
                if (pickerEl && pickerEl.classList.contains('open') && !e.target.closest('.nv-enc-cell') && !e.target.closest('.nv-picker')) {
                    pickerEl.classList.remove('open');
                }
            });
        }
    }

    // Public driver surface — the shell calls this on every navigation (including intra-applet URL changes)
    function init(h) {
        if (h) currentHost = h;

        // Parse state from the current dsap:// URI (path + query params)
        const state = naxVibesParseDsapState(currentHost);
        applyState(state);

        wireEvents();           // idempotent enough; re-attaches are cheap

        // Show loading state immediately so the UI doesn't look dead
        if (loadingEl) loadingEl.classList.remove('hidden');
        if (grid) grid.classList.add('nv-loading');
        setStatus('Loading community vibes…');

        // Load data for whatever the URL says (this makes direct links, back/forward, and preset clicks work)
        // Small delay helps when the Grimoire pane has just been populated
        setTimeout(() => {
            loadData(false);
        }, 60);
    }

    function refresh() {
        // Re-parse in case the host URL changed, then reload data
        const state = naxVibesParseDsapState(currentHost);
        applyState(state);
        loadData(true);
    }

    return { init, refresh };
}

/* ---------- Register the real DSAP applet on the NovelAI domain ---------- */
(function registerNaxVibesDsap() {
    if (typeof registerDsap !== 'function') return;

    // Full hosted applet (replaces the old shim that just opened the modal)
    registerDsap({
        url: NAX_VIBES_DSAP_URL,
        aliases: [
            'vibes.novelai.jp',
            'naxt-vibes.novelai.net',
            'nax-vibes.novelai.net',
            'applet.novelai.net/vibes',
            'vibes.dyna.novelai.net',
            'applet.grimoire.jp/nax-vibes', // compat with old links / toolbox
            'nax-vibes'
        ],
        title: NAX_VIBES_DSAP_TITLE,
        // No toolbox entry — do not auto-add a link to the start menu / toolbox.
        // Still reachable via Cache Manager button, Run ("vibe browser", "nax vibes", etc.), or typing the dsap:// URL in Grimoire.
        getContent(match) {
            return {
                html: naxVibesBuildDsapHtml(),
                css: naxVibesDsapScopedCss,
                drivers: {
                    // The shell expects { init(host), refresh(host?) }.
                    // Our naxVibesDsapDriver is a factory that sets up the scoped elements/state
                    // and returns its own {init, refresh}. We bridge it here.
                    init(host) {
                        try {
                            const instance = naxVibesDsapDriver(host);
                            if (instance && typeof instance.init === 'function') {
                                instance.init(host);
                            }
                        } catch (e) {
                            console.error('NAX Vibes DSAP init failed:', e);
                            if (typeof showGlassToast === 'function') {
                                showGlassToast('error', 'Vibes', 'Failed to initialize browser', false, 4000);
                            }
                        }
                    },
                    refresh(host) {
                        try {
                            // On refresh we can construct a fresh one (URL driven) or try previous.
                            // For robustness on same-host refresh, we call the factory again.
                            const instance = naxVibesDsapDriver(host);
                            if (instance && typeof instance.refresh === 'function') {
                                instance.refresh();
                            }
                        } catch (e) {
                            console.warn('NAX Vibes DSAP refresh failed:', e);
                        }
                    },
                    destroy(host) {
                        const rootEl = host?.getRoot?.()?.querySelector('[data-dsap]') || host?.getRoot?.();
                        if (rootEl) {
                            delete rootEl.dataset.nvEventsWired;
                        }
                    }
                }
            };
        }
    });
})();
