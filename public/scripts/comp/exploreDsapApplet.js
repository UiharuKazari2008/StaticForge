/**
 * Agora — NovelAI Explore community gallery DSAP at explore.novelai.net
 * Depends on: dsapRegistry.js, dropdown.js / manualDropdownManager.js, websocket.js,
 *             referenceManager.js (transformMetadataForEditor), utilities.js (getSamplerMeta)
 */

const EXPLORE_DSAP_URL = 'explore.novelai.net';
const EXPLORE_SORT_OPTIONS = [
    { value: 'new', label: 'New' },
    { value: 'top', label: 'Top' },
    { value: 'hot', label: 'Hot' }
];
const EXPLORE_PERIOD_OPTIONS = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' }
];
const EXPLORE_CREATOR_ROW_MAX = 10;
const EXPLORE_CREATOR_CARD_W = 148;

function exploreEscapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function exploreParseState(host) {
    const segments = host.getPathSegments() || [];
    const sort = (host.getQueryParam('sort') || 'new').toLowerCase();
    const period = (host.getQueryParam('period') || 'day').toLowerCase();
    const search = host.getQueryParam('q') || host.getQueryParam('search') || '';
    const pageParam = parseInt(host.getQueryParam('page') || '1', 10) || 1;
    const offsetParam = host.getQueryParam('offset');
    const offsetParsed = offsetParam != null && offsetParam !== ''
        ? Math.max(0, parseInt(offsetParam, 10) || 0)
        : null;
    let detailId = null;
    let creatorId = host.getQueryParam('creator_id') || '';
    let creatorName = host.getQueryParam('creator_name') || '';
    let likesMode = false;
    if (segments[0] === 'image' && segments[1]) {
        detailId = decodeURIComponent(segments[1]);
    } else if (segments[0] === 'creator' && segments[1]) {
        creatorId = decodeURIComponent(segments[1]);
        if (!creatorName) creatorName = host.getQueryParam('name') || '';
    } else if (segments[0] === 'likes') {
        likesMode = true;
    }
    return {
        sort: ['new', 'top', 'hot'].includes(sort) ? sort : 'new',
        period: ['day', 'week', 'month'].includes(period) ? period : 'day',
        search: String(search || '').trim(),
        page: Math.max(1, pageParam),
        offset: offsetParsed,
        detailId,
        creatorId: String(creatorId || '').trim(),
        creatorName: String(creatorName || '').trim(),
        likesMode
    };
}

function exploreBuildGalleryUrl({ sort = 'new', period = 'day', search = '', page = 1, offset = null } = {}) {
    const q = new URLSearchParams();
    if (sort && sort !== 'new') q.set('sort', sort);
    if (sort !== 'new' && period && period !== 'day') q.set('period', period);
    if (search) q.set('q', search);
    const pg = parseInt(page, 10) || 1;
    if (pg > 1) q.set('page', String(pg));
    const off = offset == null ? null : Math.max(0, parseInt(offset, 10) || 0);
    if (off != null && off > 0) q.set('offset', String(off));
    const qs = q.toString();
    return qs ? `dsap://${EXPLORE_DSAP_URL}/?${qs}` : `dsap://${EXPLORE_DSAP_URL}/`;
}

function exploreBuildDetailUrl(id, backState) {
    const base = `dsap://${EXPLORE_DSAP_URL}/image/${encodeURIComponent(id)}`;
    const q = new URLSearchParams();
    if (backState?.likesMode) {
        q.set('from', 'likes');
        const pg = parseInt(backState?.page, 10) || 1;
        if (pg > 1) q.set('page', String(pg));
    } else if (backState?.creatorId) {
        q.set('from', 'creator');
        q.set('creator_id', backState.creatorId);
        if (backState.creatorName) q.set('creator_name', backState.creatorName);
        const pg = parseInt(backState?.page, 10) || 1;
        if (pg > 1) q.set('page', String(pg));
    } else {
        if (backState?.sort && backState.sort !== 'new') q.set('sort', backState.sort);
        if (backState?.sort !== 'new' && backState?.period) q.set('period', backState.period);
        if (backState?.search) q.set('q', backState.search);
        const pg = parseInt(backState?.page, 10) || 1;
        if (pg > 1) q.set('page', String(pg));
    }
    const qs = q.toString();
    return qs ? `${base}?${qs}` : base;
}

function exploreBuildCreatorUrl({ creatorId, creatorName = '', page = 1, offset = null } = {}) {
    if (!creatorId) return exploreBuildGalleryUrl({});
    const base = `dsap://${EXPLORE_DSAP_URL}/creator/${encodeURIComponent(creatorId)}`;
    const q = new URLSearchParams();
    if (creatorName) q.set('name', creatorName);
    const pg = parseInt(page, 10) || 1;
    if (pg > 1) q.set('page', String(pg));
    const off = offset == null ? null : Math.max(0, parseInt(offset, 10) || 0);
    if (off != null && off > 0) q.set('offset', String(off));
    const qs = q.toString();
    return qs ? `${base}?${qs}` : base;
}

function exploreBuildLikesUrl({ page = 1, offset = null } = {}) {
    const base = `dsap://${EXPLORE_DSAP_URL}/likes`;
    const q = new URLSearchParams();
    const pg = parseInt(page, 10) || 1;
    if (pg > 1) q.set('page', String(pg));
    const off = offset == null ? null : Math.max(0, parseInt(offset, 10) || 0);
    if (off != null && off > 0) q.set('offset', String(off));
    const qs = q.toString();
    return qs ? `${base}?${qs}` : base;
}

const EXPLORE_REGISTER_URL = 'https://novelai.net/explore/register';

function exploreOpenExternal(url) {
    // Browser Window.open — system tab outside Grimoire
    open(url, '_blank', 'noopener,noreferrer');
}

function exploreDetailReactIconsHtml(post, state) {
    const liked = !!post?.liked_by_self;
    const count = Number.isFinite(Number(post?.like_count)) ? Number(post.like_count) : 0;
    const canLike = !!(state?.exploreUser?.registered);
    return `
      <button type="button" class="ex-detail-btn icon-only ex-like-btn${liked ? ' is-on' : ''}${canLike ? '' : ' is-disabled'}"
        data-ex-like ${canLike ? '' : 'disabled'}
        title="${canLike ? 'Like' : 'Like (Explore registration required)'}"
        aria-label="Like">
        <i class="${liked ? 'fas' : 'far'} fa-heart"></i>
        <span class="ex-like-count">${count}</span>
      </button>
      <button type="button" class="ex-detail-btn icon-only ex-down-btn" data-ex-down
        title="Hide from Agora" aria-label="Hide">
        <i class="fas fa-ban"></i>
      </button>
      <span class="ex-actions-divider" aria-hidden="true"></span>`;
}

function exploreHeroChromeHtml(state, { registration = false } = {}) {
    const registered = !!state?.exploreUser?.registered;
    const known = !!state?.exploreUser;
    const user = state?.exploreUser?.user;
    const showReg = registration && known && !registered;
    const showProfile = registration && known && registered && !!(user?.id);
    const showLikes = known && registered;
    const profileName = user?.name || 'Profile';
    return `
      <div class="ex-hero-top">
        <h1 class="ex-hero-title-bar">The Image Gallery</h1>
        <div class="ex-hero-actions">
          <button type="button" class="ex-chrome-btn${showLikes ? '' : ' hidden'}" id="exLikesBtn" title="Posts you liked">
            <i class="fas fa-heart"></i> Likes
          </button>
          <button type="button" class="ex-chrome-btn${showReg ? '' : ' hidden'}" id="exRegBtn" title="Register on NovelAI Explore">
            Registration
          </button>
          <button type="button" class="ex-chrome-btn ex-profile-btn${showProfile ? '' : ' hidden'}" id="exProfileBtn"
            data-ex-creator-id="${exploreEscapeHtml(user?.id || '')}"
            data-ex-creator-name="${exploreEscapeHtml(user?.name || '')}"
            title="Your Explore posts">
            ${exploreEscapeHtml(profileName)}
          </button>
        </div>
        <div class="ex-brand" aria-label="Explorer">
          <i class="nai-pen-tip-light" aria-hidden="true"></i>
          <span class="ex-brand-text">Explorer</span>
        </div>
      </div>`;
}

function exploreDetailNavHtml(state) {
    const registered = !!state?.exploreUser?.registered;
    const known = !!state?.exploreUser;
    const showLikes = known && registered;
    return `
      <div class="ex-detail-nav">
        <button type="button" class="ex-back-link" id="exBackBtn">
          <i class="fas fa-chevron-left"></i> Image Gallery
        </button>
        <div class="ex-detail-nav-right">
          <button type="button" class="ex-chrome-btn${showLikes ? '' : ' hidden'}" id="exLikesBtn" title="Posts you liked">
            <i class="fas fa-heart"></i> My Likes
          </button>
          <div class="ex-brand" aria-label="Explorer">
            <i class="nai-pen-tip-light" aria-hidden="true"></i>
            <span class="ex-brand-text">Explorer</span>
          </div>
        </div>
      </div>`;
}

function exploreSortLabel(sort) {
    return EXPLORE_SORT_OPTIONS.find((o) => o.value === sort)?.label || 'New';
}

function explorePeriodLabel(period) {
    return EXPLORE_PERIOD_OPTIONS.find((o) => o.value === period)?.label || 'Day';
}

function exploreParseNaiMetadata(raw) {
    if (!raw) return null;
    let meta = raw;
    if (typeof raw === 'string') {
        try {
            meta = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!meta || typeof meta !== 'object') return null;

    let comment = meta.Comment || meta.comment;
    if (typeof comment === 'string') {
        try {
            comment = JSON.parse(comment);
        } catch {
            comment = null;
        }
    }

    const out = {
        ...(comment && typeof comment === 'object' ? comment : {}),
        Title: meta.Title,
        Description: meta.Description,
        Software: meta.Software,
        Source: meta.Source,
        source: meta.Source || meta.source || comment?.source,
        width: (comment && comment.width) || meta.width,
        height: (comment && comment.height) || meta.height
    };

    if (!out.prompt) {
        out.prompt = comment?.v4_prompt?.caption?.base_caption || meta.Description || '';
    }
    if (!out.uc) {
        out.uc = comment?.v4_negative_prompt?.caption?.base_caption || '';
    }
    return out;
}

function exploreCharacterPromptLines(parsed) {
    const caps = parsed?.v4_prompt?.caption?.char_captions;
    if (!Array.isArray(caps) || !caps.length) return [];
    const neg = parsed?.v4_negative_prompt?.caption?.char_captions || [];
    return caps.map((cap, i) => {
        const prompt = cap?.char_caption || '';
        const uc = neg[i]?.char_caption || '';
        return { prompt, uc, center: Array.isArray(cap?.centers) ? cap.centers[0] : null };
    }).filter((c) => c.prompt || c.uc);
}

function exploreCopyAttr(text) {
    return exploreEscapeHtml(encodeURIComponent(text || ''));
}

/** Read-only prompt display with emphasis highlighting (manual modal inspector pattern). */
function exploreRenderEmphasisPrompt(text) {
    const value = text == null ? '' : String(text);
    if (!value.trim()) return '<span class="ex-tag-empty">—</span>';
    // highlightEmphasisInText: public/scripts/comp/emphasisHighlight.js
    const overlayHtml = highlightEmphasisInText(value);
    return `<div class="compiled-prompt-display-wrapper ex-prompt-display">
      <div class="compiled-prompt-display">${exploreEscapeHtml(value)}</div>
      <div class="emphasis-highlight-overlay">${overlayHtml}</div>
    </div>`;
}

function exploreFormatModelLabel(parsed) {
    const src = parsed?.Source || parsed?.source || '';
    if (!src) return '';
    // determineModelFromMetadata: public/scripts/comp/utilities.js
    const detected = determineModelFromMetadata({ source: src, Source: src });
    const map = {
        V4_5: 'NAI Diffusion V4.5 Full',
        V4_5_CUR: 'NAI Diffusion V4.5 Curated',
        V4: 'NAI Diffusion V4 Full',
        V4_CUR: 'NAI Diffusion V4 Curated',
        V3: 'NAI Diffusion V3',
        FURRY: 'NAI Diffusion Furry'
    };
    if (detected && map[detected]) return map[detected];
    return String(src).replace(/^stable-diffusion_/i, '').replace(/_/g, ' ');
}

function exploreFormatSampler(sampler) {
    if (!sampler) return '—';
    // getSamplerMeta: public/scripts/comp/utilities.js
    const meta = getSamplerMeta(sampler);
    return meta?.display || sampler;
}

function exploreFormatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function exploreCreatorRowVisibleCount(widthPx) {
    const w = Math.max(0, widthPx || 0);
    const n = Math.floor((w + 12) / (EXPLORE_CREATOR_CARD_W + 12));
    return Math.max(1, Math.min(EXPLORE_CREATOR_ROW_MAX, n || 1));
}

/** NovelAI Explore scalloped “star gear” path (from explore UI). */
const EXPLORE_GEAR_PATH = 'M58.5915 8.78681C63.5475 4.96997 70.4525 4.96997 75.4085 8.78681C80.1184 12.4142 86.0161 14.1459 91.9394 13.6407C98.1721 13.1092 103.981 16.8424 106.087 22.7327C108.088 28.3305 112.113 32.9759 117.369 35.7533C122.9 38.6758 125.768 44.9569 124.355 51.0506C123.012 56.8417 123.887 62.9258 126.807 68.104C129.88 73.5527 128.897 80.3875 124.414 84.7498C120.153 88.8955 117.6 94.4868 117.257 100.422C116.896 106.667 112.374 111.885 106.244 113.131C100.418 114.315 95.2473 117.638 91.7502 122.446C88.0703 127.504 81.4449 129.45 75.6144 127.184C70.0733 125.03 63.9267 125.03 58.3856 127.184C52.5551 129.45 45.9297 127.504 42.2498 122.446C38.7527 117.638 33.5817 114.315 27.756 113.131C21.626 111.885 17.1041 106.667 16.7433 100.422C16.4003 94.4868 13.8469 88.8955 9.58617 84.7498C5.10287 80.3875 4.12018 73.5527 7.19286 68.104C10.113 62.9258 10.9878 56.8417 9.64478 51.0506C8.23163 44.9569 11.1001 38.6758 16.6308 35.7533C21.8869 32.9759 25.9121 28.3305 27.9133 22.7327C30.0189 16.8424 35.8279 13.1092 42.0606 13.6407C47.9839 14.1459 53.8816 12.4142 58.5915 8.78681Z';

/* Mask only — color comes from CSS background (encodeURIComponent('#…') was double-encoded before). */
const EXPLORE_WAVE_MASK_SVG = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="12" viewBox="0 0 48 12"><path fill="white" d="M0 12V6a6 6 0 0 1 12 0 6 6 0 0 1 12 0 6 6 0 0 1 12 0 6 6 0 0 1 12 0V12z"/></svg>'
);

/** NovelAI Explore card footer base (#151c36) — tinted ~10% with image dominant hue. */
const EXPLORE_CARD_FOOTER_RGB = { r: 21, g: 28, b: 54 };
const EXPLORE_CARD_TINT_AMOUNT = 0.1;
const EXPLORE_CARD_TINT_SIZE = 32;
let _exploreTintCanvas = null;
let _exploreTintCtx = null;

function exploreHslToRgb(h, s, l) {
    const hh = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((hh / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (hh < 60) { r = c; g = x; }
    else if (hh < 120) { r = x; g = c; }
    else if (hh < 180) { g = c; b = x; }
    else if (hh < 240) { g = x; b = c; }
    else if (hh < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}

/** Dominant mid-lightness hue from RGBA pixels — same idea as NovelAI Explore `$e(blurhash)`. */
function exploreDominantOverlayFromRgba(data) {
    if (!data || data.length < 4) return null;
    const bins = Array(24).fill(0);
    const sinBins = Array(24).fill(0);
    const cosBins = Array(24).fill(0);
    const satBins = Array(24).fill(0);
    let weightSum = 0;
    for (let i = 0; i < data.length; i += 4) {
        const rn = data[i] / 255;
        const gn = data[i + 1] / 255;
        const bn = data[i + 2] / 255;
        const max = Math.max(rn, gn, bn);
        const min = Math.min(rn, gn, bn);
        const chroma = max - min;
        if (chroma === 0) continue;
        const light = (max + min) / 2;
        const sat = chroma / (1 - Math.abs(2 * light - 1));
        let hue = (max === rn
            ? ((gn - bn) / chroma) % 6
            : max === gn
                ? (bn - rn) / chroma + 2
                : (rn - gn) / chroma + 4) * 60;
        if (hue < 0) hue += 360;
        const w = sat * (1 - Math.abs(2 * light - 1));
        if (w <= 0) continue;
        const bin = Math.floor(hue / 15) % 24;
        const rad = hue * Math.PI / 180;
        bins[bin] += w;
        sinBins[bin] += w * Math.sin(rad);
        cosBins[bin] += w * Math.cos(rad);
        satBins[bin] += w * sat;
        weightSum += w;
    }
    const colorfulness = weightSum / (data.length / 4);
    if (colorfulness < 0.03) return null;
    const colorScale = Math.min(1, (colorfulness - 0.03) / 0.17);
    let peak = 0;
    let peakScore = -1;
    for (let i = 0; i < 24; i++) {
        const score = bins[(i + 23) % 24] + bins[i] + bins[(i + 1) % 24];
        if (score > peakScore) {
            peakScore = score;
            peak = i;
        }
    }
    const neighbors = [(peak + 23) % 24, peak, (peak + 1) % 24];
    const neighWeight = neighbors.reduce((sum, i) => sum + bins[i], 0);
    if (neighWeight <= 0) return null;
    let hue = 180 * Math.atan2(
        neighbors.reduce((sum, i) => sum + sinBins[i], 0),
        neighbors.reduce((sum, i) => sum + cosBins[i], 0)
    ) / Math.PI;
    if (hue < 0) hue += 360;
    const sat = neighbors.reduce((sum, i) => sum + satBins[i], 0) / neighWeight;
    return exploreHslToRgb(hue, sat * colorScale, 0.5);
}

function exploreMixFooterTint(overlayRgb, amount = EXPLORE_CARD_TINT_AMOUNT) {
    if (!overlayRgb) return null;
    const a = Math.max(0, Math.min(1, amount));
    const { r: br, g: bg, b: bb } = EXPLORE_CARD_FOOTER_RGB;
    const r = Math.round(br * (1 - a) + overlayRgb.r * a);
    const g = Math.round(bg * (1 - a) + overlayRgb.g * a);
    const b = Math.round(bb * (1 - a) + overlayRgb.b * a);
    return `rgb(${r}, ${g}, ${b})`;
}

function exploreApplyCardImageTint(cardEl, imgEl) {
    if (!cardEl || !imgEl || !imgEl.naturalWidth) return;
    try {
        if (!_exploreTintCanvas) {
            _exploreTintCanvas = document.createElement('canvas');
            _exploreTintCanvas.width = EXPLORE_CARD_TINT_SIZE;
            _exploreTintCanvas.height = EXPLORE_CARD_TINT_SIZE;
            _exploreTintCtx = _exploreTintCanvas.getContext('2d', { willReadFrequently: true });
        }
        if (!_exploreTintCtx) return;
        _exploreTintCtx.clearRect(0, 0, EXPLORE_CARD_TINT_SIZE, EXPLORE_CARD_TINT_SIZE);
        _exploreTintCtx.drawImage(imgEl, 0, 0, EXPLORE_CARD_TINT_SIZE, EXPLORE_CARD_TINT_SIZE);
        const { data } = _exploreTintCtx.getImageData(0, 0, EXPLORE_CARD_TINT_SIZE, EXPLORE_CARD_TINT_SIZE);
        const mixed = exploreMixFooterTint(exploreDominantOverlayFromRgba(data));
        if (mixed) cardEl.style.setProperty('--ex-footer', mixed);
    } catch (_) {
        /* tainted canvas / decode race — keep default navy footer */
    }
}

function exploreWireCardTint(cardEl) {
    const img = cardEl?.querySelector?.('.ex-card-media img');
    if (!img) return;
    const apply = () => exploreApplyCardImageTint(cardEl, img);
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener('load', apply, { once: true });
}

function explorePresetModelKey(model) {
    const m = String(model || 'v4_5').toLowerCase();
    if (m === 'v3_furry' || m === 'furry') return 'furry';
    return m;
}

/** Map NAI Source / determineModelFromMetadata result → Studio model key (v4_5, …). */
function exploreResolveEditorModel(parsed) {
    if (parsed?.model) {
        const existing = explorePresetModelKey(parsed.model);
        if (['v4_5', 'v4_5_cur', 'v4_5_mod', 'v4', 'v4_cur', 'v3', 'furry'].includes(existing)) {
            return existing;
        }
    }
    const source = parsed?.source || parsed?.Source || '';
    // determineModelFromMetadata: public/scripts/comp/referenceManager.js
    const detected = determineModelFromMetadata({ source });
    const map = {
        V4_5: 'v4_5',
        V4_5_CUR: 'v4_5_cur',
        V4: 'v4',
        V4_CUR: 'v4_cur',
        V3: 'v3',
        FURRY: 'furry'
    };
    if (map[detected]) return map[detected];
    return 'v4_5';
}

function exploreQualityPresetsMap() {
    // optionsData: populated with prompt config (quality_presets) for the session
    return (typeof optionsData !== 'undefined' && optionsData?.quality_presets)
        || window.optionsData?.quality_presets
        || null;
}

function exploreResolveQualityPresetText(model) {
    const key = explorePresetModelKey(model);
    const presets = exploreQualityPresetsMap();
    const raw = presets?.[key];
    if (!raw) return '';
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw) && raw.length) {
        const first = raw[0];
        if (typeof first === 'string') return first.trim();
        if (first?.value) return String(first.value).trim();
    }
    return '';
}

/** All quality strings to try (primary model first, longest match wins). From optionsData.quality_presets. */
function exploreCollectQualityCandidates(model) {
    const presets = exploreQualityPresetsMap() || {};
    const ordered = [];
    const keys = [explorePresetModelKey(model), 'v4_5', 'v4_5_mod', 'v4_5_cur', 'v4', 'v4_cur', 'v3', 'furry'];
    for (let i = 0; i < keys.length; i++) {
        const raw = presets[keys[i]];
        const text = typeof raw === 'string' ? raw.trim() : '';
        if (text && ordered.indexOf(text) === -1) ordered.push(text);
    }
    ordered.sort((a, b) => b.length - a.length);
    return ordered;
}

function exploreResolveUcPresets(model) {
    const key = explorePresetModelKey(model);
    const presets = (typeof optionsData !== 'undefined' && optionsData?.uc_presets)
        || window.optionsData?.uc_presets
        || null;
    const raw = presets?.[key];
    return Array.isArray(raw) ? raw : [];
}

/** Try strip one quality string from the end of a prompt (handles ", ," glue). */
function exploreTryStripQualitySuffix(prompt, qualityValue) {
    if (!qualityValue || !prompt) return null;
    const trimmed = String(prompt).replace(/\s+$/, '');
    const candidates = [
        ', , ' + qualityValue,
        ', ' + qualityValue,
        ',' + qualityValue,
        qualityValue
    ];
    for (let i = 0; i < candidates.length; i++) {
        const suf = candidates[i];
        if (trimmed === suf || trimmed.endsWith(suf)) {
            if (trimmed === suf) return '';
            return trimmed.slice(0, -suf.length).replace(/,\s*$/, '').trim();
        }
    }
    return null;
}

/**
 * Strip quality/UC preset strings from prompt text; enable matching editor toggles.
 * Matches modules/pngMetadata.js, plus optional leading "nsfw, " on UC (common on Explore).
 * Neutral NSFW removes "nsfw" from UC on generate — strip that prefix with the UC preset match.
 */
function exploreStripAndFlagPresets(metadata) {
    const model = metadata.model || 'v4_5';
    let prompt = String(metadata.prompt || '');
    let uc = String(metadata.uc || '');
    let appendQuality = false;
    let appendUc = 0;

    const qualityCandidates = exploreCollectQualityCandidates(model);
    for (let qi = 0; qi < qualityCandidates.length && !appendQuality; qi++) {
        const qualityValue = qualityCandidates[qi];
        const groups = prompt.split('|').map((g) => g.trim());
        if (groups.length > 0) {
            const stripped = exploreTryStripQualitySuffix(groups[0], qualityValue);
            if (stripped !== null) {
                groups[0] = stripped;
                prompt = groups.filter((g) => g !== '').join(' | ');
                appendQuality = true;
                break;
            }
        }
        const whole = exploreTryStripQualitySuffix(prompt, qualityValue);
        if (whole !== null) {
            prompt = whole;
            appendQuality = true;
        }
    }

    const ucPresets = exploreResolveUcPresets(model);
    for (let i = ucPresets.length - 1; i >= 0; i--) {
        const ucValue = String(ucPresets[i] || '').trim();
        if (!ucValue || !uc) continue;

        // Explore often prefixes UC with "nsfw, " (NAI NSFW tag). Neutral NSFW strips it on generate.
        let body = uc;
        if (body.toLowerCase().startsWith('nsfw, ')) {
            body = body.slice(6).trimStart();
        }

        if (body.startsWith(ucValue + ', ')) {
            uc = body.slice(ucValue.length + 2).trim();
            appendUc = i + 1;
            break;
        }
        if (body === ucValue) {
            uc = '';
            appendUc = i + 1;
            break;
        }
    }

    metadata.prompt = prompt;
    metadata.uc = uc;
    metadata.append_quality = appendQuality;
    metadata.append_uc = appendUc;
    return metadata;
}

/** Enable furry dataset when the Explore model is furry — no sub-toggles. */
function exploreApplyFurryDatasetIfNeeded(metadata) {
    if (!metadata || metadata.model !== 'furry') return metadata;
    metadata.dataset_config = {
        ...(metadata.dataset_config && typeof metadata.dataset_config === 'object' ? metadata.dataset_config : {}),
        include: ['furry dataset'],
        nsfw: metadata.dataset_config?.nsfw != null ? metadata.dataset_config.nsfw : 0
    };
    // Do not enable furry sub_toggles (human, etc.)
    if (metadata.dataset_config.settings) {
        delete metadata.dataset_config.settings['furry dataset'];
    }
    return metadata;
}

async function exploreEnsureBlobUrl(post) {
    let url = post?.blobUrl || post?.thumbnailUrl;
    if (post?.id && wsClient) {
        try {
            const ensured = await wsClient.sendMessage('ensure_novelai_explore_image', {
                id: post.id,
                kind: 'blob'
            }, false);
            if (ensured?.publicUrl) {
                url = ensured.publicUrl;
                post.blobUrl = ensured.publicUrl;
                post.blobReady = true;
            }
            if (ensured?.post) Object.assign(post, ensured.post);
        } catch (err) {
            console.warn('Agora ensure blob', err);
        }
    }
    return url;
}

/** PNG with NovelAI tEXt metadata (server converts webp → png). */
async function exploreEnsurePngUrl(post) {
    if (!post?.id || !wsClient) throw new Error('No image id');
    const ensured = await wsClient.sendMessage('ensure_novelai_explore_image', {
        id: post.id,
        kind: 'png',
        // Prefer live post metadata — page-cache lookup alone often misses detail opens
        naiMetadata: post.image?.nai_metadata || null
    }, false);
    if (ensured?.post) Object.assign(post, ensured.post);
    if (!ensured?.publicUrl) throw new Error('Failed to prepare PNG');
    post.pngUrl = ensured.publicUrl;
    return ensured.publicUrl;
}

async function exploreFetchRawBlob(post) {
    const url = await exploreEnsureBlobUrl(post);
    if (!url) throw new Error('No image URL');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
    return res.blob();
}

async function exploreFetchPngBlob(post) {
    const url = await exploreEnsurePngUrl(post);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch PNG (${res.status})`);
    const blob = await res.blob();
    // Clipboard / uploads require image/png — normalize MIME if the server omitted it.
    if (blob.type && blob.type !== 'image/png') {
        return new Blob([blob], { type: 'image/png' });
    }
    return blob.type ? blob : new Blob([blob], { type: 'image/png' });
}

function explorePngFilename(post) {
    const base = (post?.title || post?.id || 'agora').replace(/[^\w\-]+/g, '_').slice(0, 80);
    return `${base || 'agora'}.png`;
}

async function exploreCopyRawImage(post) {
    try {
        const blob = await exploreFetchPngBlob(post);
        const name = explorePngFilename(post);
        // copyBlobToClipboard: public/scripts/utils/dreamscapeClipboard.js
        await copyBlobToClipboard(blob, { name });
        showGlassToast('success', 'Agora', `Image copied (${formatClipboardBlobSize(blob)})`, false, 3000, '<i class="fas fa-clipboard-check"></i>');
    } catch (err) {
        console.error('Agora copy image', err);
        showGlassToast('error', 'Agora', err.message || 'Failed to copy image', false, 4000);
    }
}

async function exploreDownloadRawImage(post) {
    try {
        const blob = await exploreFetchPngBlob(post);
        const name = explorePngFilename(post);
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    } catch (err) {
        console.error('Agora download image', err);
        showGlassToast('error', 'Agora', err.message || 'Failed to download image', false, 4000);
    }
}

async function exploreImportToWorkspace(post) {
    const toastId = showGlassToast('info', 'Agora', 'Importing PNG to workspace…', true, false, '<i class="fas fa-file-import"></i>');
    try {
        const blob = await exploreFetchPngBlob(post);
        const name = explorePngFilename(post);
        const file = new File([blob], name, { type: 'image/png' });
        // fileToBase64: public/scripts/utils/referenceUtils.js
        const base64 = await fileToBase64(file);
        const workspaceId = activeWorkspace || 'default';
        const batchInfo = { currentIndex: 0, totalCount: 1 };
        const uploadResponse = await wsClient.uploadWorkspaceImage(base64, workspaceId, name, batchInfo);
        if (!uploadResponse?.success) {
            throw new Error(uploadResponse?.message || 'Upload failed');
        }
        updateGlassToastComplete(toastId, {
            type: 'success',
            title: 'Imported',
            message: 'PNG imported to workspace (metadata preserved)',
            customIcon: '<i class="nai-check"></i>',
            showProgress: false
        });
        // loadGallery: public/scripts/comp/galleryView.js
        loadGallery(true);
    } catch (err) {
        console.error('Agora import workspace', err);
        updateGlassToastComplete(toastId, {
            type: 'error',
            title: 'Import failed',
            message: err.message || 'Import failed',
            customIcon: '<i class="nai-cross"></i>',
            showProgress: false
        });
    }
}

function exploreLockSeedInEditor(seed) {
    if (seed == null || seed === '') return;
    // manualSeed / sproutSeedBtn: public/scripts/comp/manualModalManager.js
    // toggleSproutSeed lock pattern: public/scripts/comp/seedSproutManager.js
    window.lastGeneratedSeed = seed;
    window.lastLoadedSeed = seed;
    if (manualSeed) {
        manualSeed.value = String(seed);
        manualSeed.disabled = true;
        manualSeed.placeholder = String(seed);
    }
    if (sproutSeedBtn) {
        sproutSeedBtn.classList.remove('hidden');
        sproutSeedBtn.classList.add('available');
        sproutSeedBtn.setAttribute('data-state', 'on');
    }
    // addSeedToHistory: public/scripts/comp/manualModalManager.js
    addSeedToHistory(seed);
    // updateSproutSeedButtonFromPreviewSeed: public/scripts/comp/seedSproutManager.js
    updateSproutSeedButtonFromPreviewSeed();
}

/**
 * Convert classic N:: weight groups → managed ids + forge bags before editor load.
 * Without this, Studio can leave classic syntax in the fields; generate expands managed-only
 * and missing bags strip weights to bare text (NovelAI sees no emphasis).
 * importClassicEmphasisIntoManagedText / getGlobalEmphasisSyntaxMode:
 *   public/scripts/comp/emphasisGroupIdCodec.js
 */
function exploreConvertMetadataEmphasisToManaged(metadata) {
    if (typeof convertMetadataEmphasisToManaged === 'function') {
        return convertMetadataEmphasisToManaged(metadata);
    }
    if (!metadata || typeof metadata !== 'object') return metadata;
    const mode = getGlobalEmphasisSyntaxMode() === 'visible' ? 'visible' : 'hidden';
    const bags = {};

    const convertField = (text, keys) => {
        const value = text == null ? '' : String(text);
        if (!value.includes('::')) return text;
        const imported = importClassicEmphasisIntoManagedText(value, {}, mode);
        if (!imported.imported) return text;
        keys.forEach((key) => {
            bags[key] = {
                syntaxMode: mode,
                groupsById: { ...imported.groupsById }
            };
        });
        return imported.text;
    };

    metadata.prompt = convertField(metadata.prompt, ['manualPrompt', 'prompt']);
    metadata.uc = convertField(metadata.uc, ['manualUc', 'uc']);
    if (metadata.input_prompt_negative != null || metadata.prompt_negative != null) {
        const pn = metadata.input_prompt_negative ?? metadata.prompt_negative ?? '';
        const next = convertField(pn, ['manualPromptNegative', 'prompt_negative']);
        metadata.input_prompt_negative = next;
        metadata.prompt_negative = next;
    }

    if (Array.isArray(metadata.allCharacterPrompts)) {
        metadata.allCharacterPrompts.forEach((ch, index) => {
            if (!ch || typeof ch !== 'object') return;
            ch.prompt = convertField(ch.prompt, [`character_${index}`, `character_${index}_prompt`]);
            ch.uc = convertField(ch.uc, [`character_${index}_uc`]);
            if (ch.input_prompt_negative != null || ch.prompt_negative != null) {
                const pn = ch.input_prompt_negative ?? ch.prompt_negative ?? '';
                const next = convertField(pn, [`character_${index}_prompt_negative`]);
                ch.input_prompt_negative = next;
                ch.prompt_negative = next;
            }
        });
    }

    if (Object.keys(bags).length) {
        metadata.forge_data = {
            ...(metadata.forge_data && typeof metadata.forge_data === 'object' ? metadata.forge_data : {}),
            emphasis_normalization: {
                ...(metadata.forge_data?.emphasis_normalization || {}),
                ...bags
            }
        };
    }
    return metadata;
}

/**
 * After editor open: re-seed forge bags, remap character keys, convert any leftover classic
 * BEFORE applyFormattedText (comma format can tear unprotected auto-term N:: groups).
 * Missing bags + managed markers → server strips weights to bare text.
 */
function exploreFinalizeEmphasisAfterEditorOpen(metadata) {
    // loadEmphasisNormalizationFromForgeData / getEmphasisNormalizationFieldStore /
    // syncEmphasisNormalizationPreviewMetadata: public/scripts/comp/emphasisGroupsToolManager.js
    if (metadata?.forge_data?.emphasis_normalization) {
        loadEmphasisNormalizationFromForgeData(metadata.forge_data);
    }

    const store = getEmphasisNormalizationFieldStore();
    const items = characterPromptsContainer
        ? characterPromptsContainer.querySelectorAll('.character-prompt-item')
        : [];
    items.forEach((item, index) => {
        const characterId = item.id;
        if (!characterId) return;
        const pairs = [
            [`${characterId}_prompt`, [`character_${index}`, `character_${index}_prompt`]],
            [`${characterId}_uc`, [`character_${index}_uc`]],
            [`${characterId}_promptNegative`, [`character_${index}_prompt_negative`]]
        ];
        pairs.forEach(([taId, semanticKeys]) => {
            let bag = null;
            for (let i = 0; i < semanticKeys.length; i++) {
                if (store[semanticKeys[i]]) {
                    bag = store[semanticKeys[i]];
                    break;
                }
            }
            if (!bag) return;
            store[taId] = {
                ...bag,
                groupsById: { ...(bag.groupsById || {}) }
            };
        });
    });

    // collectManualEditorEmphasisTextareas / importUnmanagedEmphasisGroupsForTextarea /
    // convertClassicEmphasisTextToManaged / getEmphasisNormalizationDualWriteKeys /
    // hasManagedEmphasisGroupIds / getEmphasisSyntaxModeForTextarea:
    //   public/scripts/comp/emphasisGroupIdCodec.js
    collectManualEditorEmphasisTextareas().forEach((textarea) => {
        const raw = textarea.value || '';
        // Classic first — import while N:: is still intact
        if (raw.includes('::') && !hasManagedEmphasisGroupIds(raw)) {
            importUnmanagedEmphasisGroupsForTextarea(textarea);
        }

        // applyFormattedText: public/scripts/comp/utilities.js
        applyFormattedText(textarea, true);
        importUnmanagedEmphasisGroupsForTextarea(textarea);

        let bag = resolveEmphasisBagForTextarea(textarea);
        const stillClassic = (textarea.value || '').includes('::')
            && !hasManagedEmphasisGroupIds(textarea.value || '');
        if (stillClassic) {
            const converted = convertClassicEmphasisTextToManaged(textarea.value);
            if (converted.groups.length) {
                const mode = getEmphasisSyntaxModeForTextarea(textarea) === 'visible' ? 'visible' : 'hidden';
                // Rewrite with mode-aware managed delimiters
                const imported = importClassicEmphasisIntoManagedText(textarea.value, {}, mode);
                if (imported.imported) {
                    textarea.value = imported.text;
                    bag = { syntaxMode: mode, groupsById: { ...imported.groupsById } };
                } else {
                    textarea.value = converted.text;
                    bag = { syntaxMode: mode, groupsById: { ...converted.groupsById } };
                }
            }
        }

        if (bag?.groupsById && Object.keys(bag.groupsById).length) {
            getEmphasisNormalizationDualWriteKeys(textarea.id).forEach((key) => {
                store[key] = {
                    ...bag,
                    groupsById: { ...bag.groupsById }
                };
            });
        }

        // updateEmphasisHighlighting: public/scripts/comp/emphasisHighlight.js
        updateEmphasisHighlighting(textarea);
    });
    syncEmphasisNormalizationPreviewMetadata();

    if (metadata) {
        if (!metadata.forge_data || typeof metadata.forge_data !== 'object') {
            metadata.forge_data = {};
        }
        metadata.forge_data.emphasis_normalization = { ...store };
    }
    if (window.currentEditMetadata && window.currentEditMetadata !== metadata) {
        if (!window.currentEditMetadata.forge_data || typeof window.currentEditMetadata.forge_data !== 'object') {
            window.currentEditMetadata.forge_data = {};
        }
        window.currentEditMetadata.forge_data.emphasis_normalization = { ...store };
    }
}

async function exploreOpenInEditor(post) {
    const parsed = exploreParseNaiMetadata(post?.image?.nai_metadata);
    if (!parsed) {
        showGlassToast('error', 'Agora', 'No generation metadata to open in the editor', false, 4000);
        return;
    }
    if (post?.image?.width && !parsed.width) parsed.width = post.image.width;
    if (post?.image?.height && !parsed.height) parsed.height = post.image.height;

    parsed.model = exploreResolveEditorModel(parsed);

    // transformMetadataForEditor: public/scripts/comp/referenceManager.js
    // Maps v4 char_captions (+ centers) → allCharacterPrompts; keeps sampler / noise_schedule / seed.
    const metadata = transformMetadataForEditor(parsed);
    metadata.model = parsed.model;
    if (!metadata.resolution) metadata.resolution = 'custom';

    // Prefer explicit noise_schedule → noiseScheduler (getNoiseMeta: public/scripts/comp/utilities.js)
    if (metadata.noise_schedule && !metadata.noiseScheduler) {
        const noiseObj = getNoiseMeta(metadata.noise_schedule);
        metadata.noiseScheduler = noiseObj ? noiseObj.meta : metadata.noise_schedule;
    }
    if (metadata.sampler) {
        // getSamplerMeta: public/scripts/comp/utilities.js
        const samplerObj = getSamplerMeta(metadata.sampler);
        if (samplerObj) metadata.sampler = samplerObj.meta;
    }

    // Variety+ from skip_cfg_above_sigma (Studio sends fixed sigma when variety=true)
    if (metadata.skip_cfg_above_sigma != null && metadata.skip_cfg_above_sigma !== undefined) {
        metadata.variety = true;
    } else {
        metadata.variety = false;
    }

    // Character coords: only real non-default placements (not 0.5 placeholders / null).
    // Do not honor bare v4 use_coords — NAI auto-position stores false with 0.5 centers;
    // collapsed gens can wrongly store true with all centers at 0.5.
    if (metadata.allCharacterPrompts && Array.isArray(metadata.allCharacterPrompts)) {
        metadata.use_coords = characterPromptsHaveCustomCoords(metadata.allCharacterPrompts);
    }

    exploreStripAndFlagPresets(metadata);

    // Always Neutral NSFW — avoid Studio NSFW presets further rewriting the original prompt/UC.
    // Do not invent include:[] (empty array is truthy and would clear selectedDatasets).
    metadata.dataset_config = {
        ...(metadata.dataset_config && typeof metadata.dataset_config === 'object' ? metadata.dataset_config : {}),
        nsfw: 0
    };
    if (!Array.isArray(metadata.dataset_config.include)) {
        delete metadata.dataset_config.include;
    }
    // Furry model → enable "furry dataset" only (no sub-toggles).
    exploreApplyFurryDatasetIfNeeded(metadata);

    // Classic N:: → managed ids + forge bags (must happen before loadIntoManualForm).
    exploreConvertMetadataEmphasisToManaged(metadata);

    // Agora import defaults (Studio clear defaults differ): Keep Newlines on;
    // Auto Char Number / Prompt Normalize / Deduplicate off.
    metadata.forge_data = {
        ...(metadata.forge_data && typeof metadata.forge_data === 'object' ? metadata.forge_data : {}),
        keep_newlines: true,
        auto_char_numerize: false,
        prompt_normalize: false,
        deduplicate_tags: false
    };

    // Cache HTTP URL — avoid createObjectURL; loadTempImagePreview revokes pending blob URLs
    // before setting img.src (manualPreviewManager.js releaseManualPreviewImageSrc).
    const previewUrl = await exploreEnsureBlobUrl(post);

    // openManualModalWithContent: public/scripts/comp/manualModalManager.js
    await openManualModalWithContent({
        type: 'metadata',
        data: metadata,
        title: post.title || 'Agora'
    });

    if (previewUrl) {
        // loadTempImagePreview: public/scripts/comp/manualPreviewManager.js
        await loadTempImagePreview(previewUrl, {
            filename: `${(post?.title || post?.id || 'agora').replace(/[^\w\-]+/g, '_').slice(0, 80) || 'agora'}.webp`,
            width: metadata.width || post?.image?.width || 1024,
            height: metadata.height || post?.image?.height || 1024
        });
    }

    // loadIntoManualForm clears the seed field for metadata loads — lock original seed after.
    exploreLockSeedInEditor(metadata.seed);

    // After openManualModalWithContent awaits splash dismiss + window open.
    // showShortcutActionToast: public/scripts/comp/keyboardShortcuts.js
    const manualModalEl = document.getElementById('manualModal');
    requestAnimationFrame(() => {
        showShortcutActionToast(
            'Keep Newlines: On\nAuto Char Number: Off\nPrompt Normalize: Off\nDeduplicate: Off',
            {
                centerOn: manualModalEl,
                durationMs: 3200,
                icon: '<i class="fas fa-sliders"></i>'
            }
        );
    });

    // Finalize after autoResizeTextareasAfterModalShow (applyFormattedText) from openManualModalWithContent.
    const runEmphasisFinalize = () => exploreFinalizeEmphasisAfterEditorOpen(metadata);
    setTimeout(runEmphasisFinalize, 0);
    requestAnimationFrame(() => {
        requestAnimationFrame(runEmphasisFinalize);
    });
}

function exploreGearSvg(extraClass) {
    return `<svg class="ex-gear ${extraClass || ''}" viewBox="0 0 134 134" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path vector-effect="non-scaling-stroke" d="${EXPLORE_GEAR_PATH}"></path>
    </svg>`;
}

const exploreDsapScopedCss = `
@import url('https://fonts.googleapis.com/css2?family=Eczar:wght@400;600;700&family=Exo:wght@300;400;500&display=swap');

[data-dsap="explore-gallery"] {
  --ex-bg: #0c1224;
  --ex-bg2: #283059;
  --ex-card: #151c36;
  --ex-footer: #151c36;
  --ex-text: #ffffff;
  --ex-muted: #9aa3b5;
  --ex-input: #121a32;
  --ex-border: rgba(255,255,255,0.08);
  --ex-cream: #e8dfc8;
  --ex-gear: #283059;
  --ex-tag: #1a2444;
  --ex-link: #7eb6ff;
  /* --ex-frame-h: px from Grimoire scrollport via ResizeObserver (never vh / %) */
  --ex-frame-h: 0px;
  font-family: "Exo", "Segoe UI", sans-serif;
  color: var(--ex-text);
  background: transparent;
  min-height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  position: relative;
  overflow: visible;
  container-type: inline-size;
  container-name: ex-gallery;
}
[data-dsap="explore-gallery"] * { box-sizing: border-box; }

/* Sticky to Grimoire scrollport — never position:fixed (that is the real browser viewport) */
[data-dsap="explore-gallery"] .ex-bg-layer {
  position: sticky;
  top: 0;
  left: 0;
  width: 100%;
  height: var(--ex-frame-h);
  margin-bottom: calc(0px - var(--ex-frame-h));
  flex-shrink: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
  background:
    radial-gradient(ellipse 80% 50% at 20% 0%, rgba(60,88,195,0.25), transparent 55%),
    radial-gradient(ellipse 60% 40% at 90% 10%, rgba(40,48,90,0.5), transparent 50%),
    linear-gradient(180deg, var(--ex-bg2) 0%, var(--ex-bg) 40%, #080c18 100%);
}
[data-dsap="explore-gallery"] .ex-dot-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px);
  background-size: 20px 20px;
  opacity: 0.45;
}
[data-dsap="explore-gallery"] .ex-gear {
  position: absolute;
  fill: none;
  stroke: var(--ex-gear);
  stroke-opacity: 0.35;
  overflow: visible;
  pointer-events: none;
}
/* Gallery page gears — sized vs DSAP width (cqi), not browser vw */
[data-dsap="explore-gallery"] .ex-gear-gallery-lg {
  width: min(492px, 70cqi);
  height: min(492px, 70cqi);
  top: -120px;
  left: max(-40px, 2%);
  stroke-width: 20px;
}
[data-dsap="explore-gallery"] .ex-gear-gallery-sm {
  width: min(170px, 28cqi);
  height: min(170px, 28cqi);
  top: 40px;
  left: min(482px, 55%);
  stroke-width: 10px;
}
[data-dsap="explore-gallery"] .ex-view {
  position: relative;
  z-index: 1;
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* Parent Grimoire .scrollable-content scrolls — do not nest a second scroller */
  overflow: visible;
}

[data-dsap="explore-gallery"] .ex-ban-banner {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  padding: 0.65rem 1rem;
  background: #5a1520;
  color: #ffd0d6;
  font-size: 0.92rem;
  font-weight: 500;
  border-bottom: 1px solid rgba(255,120,140,0.35);
  text-align: center;
}
[data-dsap="explore-gallery"] .ex-ban-banner.hidden {
  display: none !important;
}
[data-dsap="explore-gallery"] .ex-profile-btn {
  font-weight: 600;
  background: transparent;
  border-color: transparent;
  border-radius: 0;
  padding: 0.2rem 0.15rem;
  box-shadow: none;
  color: var(--ex-cream);
}
[data-dsap="explore-gallery"] .ex-profile-btn:hover {
  background: transparent;
  border-color: transparent;
  color: var(--ex-text);
}
[data-dsap="explore-gallery"] .ex-block-creator-btn.is-blocked {
  border-color: rgba(255,107,138,0.45);
  color: #ffb3c3;
}

[data-dsap="explore-gallery"] .ex-hero-top {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
  flex-wrap: wrap;
}
[data-dsap="explore-gallery"] .ex-hero-top .ex-hero-actions {
  flex: 0 0 auto;
}
[data-dsap="explore-gallery"] .ex-hero-title-bar {
  flex: 1 1 auto;
  min-width: 8rem;
  margin: 0;
  font-family: "Eczar", Georgia, serif;
  font-size: clamp(1.35rem, 3.2cqi, 1.9rem);
  font-weight: 700;
  line-height: 1.15;
  color: var(--ex-text);
  text-align: left;
}
[data-dsap="explore-gallery"] .ex-hero-top .ex-brand {
  margin-left: auto;
}
[data-dsap="explore-gallery"] .ex-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--ex-cream);
  font-family: "Eczar", Georgia, serif;
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1;
  height: 1.35em;
  flex-shrink: 0;
}
[data-dsap="explore-gallery"] .ex-brand .nai-pen-tip-light {
  width: 1.15em;
  height: 1.15em;
  background: currentColor;
  flex: 0 0 auto;
  display: block;
  vertical-align: unset;
  position: relative;
  top: 0;
}
[data-dsap="explore-gallery"] .ex-brand-text {
  display: block;
  line-height: 1.15em;
  height: 1.15em;
  /* Optical center with Eczar + mask icon */
  padding-top: 0.08em;
  box-sizing: border-box;
}
[data-dsap="explore-gallery"] .ex-hero-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
}
[data-dsap="explore-gallery"] .ex-chrome-btn {
  border: 1px solid var(--ex-border);
  background: rgba(21, 28, 54, 0.92);
  color: var(--ex-cream);
  border-radius: 999px;
  padding: 0.35rem 0.85rem;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
[data-dsap="explore-gallery"] .ex-chrome-btn:hover {
  background: #1a2444;
  border-color: rgba(255,255,255,0.2);
}
[data-dsap="explore-gallery"] .ex-chrome-btn.hidden { display: none !important; }
[data-dsap="explore-gallery"] .ex-chrome-btn.is-active {
  border-color: rgba(255,107,138,0.45);
  color: #ffb3c3;
}

[data-dsap="explore-gallery"] .ex-actions-divider {
  width: 1px;
  height: 1.45rem;
  background: rgba(255,255,255,0.18);
  flex: 0 0 auto;
  margin: 0 0.2rem;
}
[data-dsap="explore-gallery"] .ex-hero {
  padding: 2rem 1.5rem 1rem;
  max-width: 1100px;
  width: 100%;
  margin: 0 auto;
  position: relative;
}
[data-dsap="explore-gallery"]:not(.ex-layout-wide) .ex-hero {
  padding: 1.25rem 1rem 0.75rem;
}
[data-dsap="explore-gallery"] .ex-hero-title {
  font-family: "Eczar", Georgia, serif;
  font-size: clamp(2rem, 4cqi, 2.75rem);
  font-weight: 700;
  margin: 0 0 0.35rem;
}
[data-dsap="explore-gallery"] .ex-hero-sub {
  font-family: "Eczar", Georgia, serif;
  font-weight: 400;
  font-size: 1.05rem;
  color: rgba(255,255,255,0.75);
  margin: 0 0 1.5rem;
}

[data-dsap="explore-gallery"] .ex-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: stretch;
}
[data-dsap="explore-gallery"] .ex-search-wrap {
  flex: 1 1 220px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--ex-input);
  border: 1px solid var(--ex-border);
  border-radius: 6px;
  padding: 0 0.75rem;
  min-height: 40px;
}
[data-dsap="explore-gallery"] .ex-search-wrap i { color: var(--ex-muted); opacity: 0.8; }
[data-dsap="explore-gallery"] .ex-search-wrap input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--ex-text);
  font-size: 0.95rem;
  outline: none;
  width: 100%;
  padding: 0.55rem 0;
}
[data-dsap="explore-gallery"] .ex-search-wrap input::placeholder { color: rgba(255,255,255,0.35); }
[data-dsap="explore-gallery"] .ex-toolbar .custom-dropdown { min-width: 88px; }
[data-dsap="explore-gallery"] .ex-toolbar .custom-dropdown-btn {
  min-height: 40px;
  background: var(--ex-input) !important;
  border: 1px solid var(--ex-border) !important;
  border-radius: 6px !important;
  color: var(--ex-text) !important;
  padding: 0 0.85rem !important;
  width: 100%;
}
[data-dsap="explore-gallery"] .ex-period-wrap.is-disabled {
  opacity: 0.4;
  pointer-events: none;
}
[data-dsap="explore-gallery"] .ex-refresh-btn {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  border: 1px solid var(--ex-border);
  background: var(--ex-input);
  color: var(--ex-text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
[data-dsap="explore-gallery"] .ex-refresh-btn:hover { background: #1a2444; }
[data-dsap="explore-gallery"] .ex-refresh-btn.is-spinning i { animation: ex-spin 0.8s linear infinite; }
@keyframes ex-spin { to { transform: rotate(360deg); } }

[data-dsap="explore-gallery"] .ex-meta-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.65rem 1.5rem 0;
  max-width: 1100px;
  width: 100%;
  margin: 0 auto;
  font-size: 0.8rem;
  color: var(--ex-muted);
}
[data-dsap="explore-gallery"] .ex-pager {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
[data-dsap="explore-gallery"] .ex-page-btn {
  min-width: 34px;
  min-height: 30px;
  border-radius: 6px;
  border: 1px solid var(--ex-border);
  background: var(--ex-input);
  color: var(--ex-text);
  cursor: pointer;
  font-size: 0.85rem;
}
[data-dsap="explore-gallery"] .ex-page-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
[data-dsap="explore-gallery"] .ex-page-indicator {
  min-width: 4.5rem;
  text-align: center;
  font-size: 0.78rem;
  color: var(--ex-muted);
}

[data-dsap="explore-gallery"] .ex-body {
  flex: 1;
  padding: 1rem 1.25rem 2rem;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
}
[data-dsap="explore-gallery"] .ex-bottom-pager {
  display: flex;
  justify-content: center;
  padding: 1.75rem 0 0.5rem;
}
[data-dsap="explore-gallery"] .ex-bottom-pager.hidden {
  display: none !important;
}
[data-dsap="explore-gallery"] .ex-next-page-btn {
  width: min(100%, 28rem);
  border: 1px solid rgba(255,255,255,0.16);
  background: rgba(21, 28, 54, 0.95);
  color: var(--ex-cream);
  border-radius: 12px;
  padding: 1.05rem 1.5rem;
  font-family: "Eczar", Georgia, serif;
  font-size: 1.25rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
}
[data-dsap="explore-gallery"] .ex-next-page-btn:hover {
  background: #1a2444;
  border-color: rgba(255,255,255,0.28);
}
[data-dsap="explore-gallery"] .ex-next-page-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
[data-dsap="explore-gallery"] .ex-grid {
  column-count: 1;
  column-gap: 1.25rem;
}
[data-dsap="explore-gallery"].ex-cols-2 .ex-grid {
  column-count: 2;
}
[data-dsap="explore-gallery"].ex-cols-3 .ex-grid {
  column-count: 3;
}
[data-dsap="explore-gallery"].ex-cols-4 .ex-grid {
  column-count: 4;
}

[data-dsap="explore-gallery"] .ex-card {
  break-inside: avoid;
  margin: 0 0 1.25rem;
  background: var(--ex-card);
  border: none;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  display: inline-block;
  width: 100%;
  vertical-align: top;
  text-decoration: none;
  color: inherit;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.12);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
[data-dsap="explore-gallery"] .ex-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.22);
}
[data-dsap="explore-gallery"] .ex-card-media {
  position: relative;
  background: #0a0e1c;
  line-height: 0;
}
[data-dsap="explore-gallery"] .ex-card-media img {
  display: block;
  width: 100%;
  height: auto;
}
[data-dsap="explore-gallery"] .ex-card-wave {
  display: block;
  width: 100%;
  height: 12px;
  margin-top: -12px;
  position: relative;
  z-index: 1;
  background-color: var(--ex-footer);
  -webkit-mask-image: url("data:image/svg+xml,${EXPLORE_WAVE_MASK_SVG}");
  mask-image: url("data:image/svg+xml,${EXPLORE_WAVE_MASK_SVG}");
  -webkit-mask-repeat: repeat-x;
  mask-repeat: repeat-x;
  -webkit-mask-size: 48px 12px;
  mask-size: 48px 12px;
  -webkit-mask-position: left bottom;
  mask-position: left bottom;
}
[data-dsap="explore-gallery"] .ex-card-footer {
  background: var(--ex-footer);
  padding: 0.85rem 1rem 1.15rem;
  text-align: center;
}
[data-dsap="explore-gallery"] .ex-card-title {
  font-family: "Eczar", Georgia, serif;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--ex-cream);
  margin: 0 0 0.3rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
[data-dsap="explore-gallery"] .ex-card-creator {
  font-family: "Exo", "Segoe UI", sans-serif;
  font-size: 0.88rem;
  font-weight: 400;
  color: var(--ex-muted);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

[data-dsap="explore-gallery"] .ex-empty,
[data-dsap="explore-gallery"] .ex-loading {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--ex-muted);
}

/* —— Detail / image page (NAI Explore layout) —— */
[data-dsap="explore-gallery"] .ex-detail-page {
  width: 100%;
  max-width: 1000px;
  margin: 0 auto;
  padding: 1.25rem 1rem 2.5rem;
}
[data-dsap="explore-gallery"].ex-layout-wide .ex-detail-page {
  max-width: 1450px;
}
[data-dsap="explore-gallery"] .ex-detail-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.35rem 0 1.1rem;
}
[data-dsap="explore-gallery"] .ex-detail-nav-right {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-left: auto;
  flex-shrink: 0;
}
[data-dsap="explore-gallery"] .ex-detail-nav .ex-brand {
  margin-left: 0;
}
[data-dsap="explore-gallery"] .ex-back-link {
  border: none;
  background: transparent;
  color: var(--ex-text);
  cursor: pointer;
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.35rem 0.25rem;
  opacity: 0.9;
}
[data-dsap="explore-gallery"] .ex-back-link:hover { opacity: 1; }

[data-dsap="explore-gallery"] .ex-detail-card {
  position: relative;
  width: 100%;
  border-radius: 12px;
  background: var(--ex-card);
  box-shadow: 0 0 0 1px var(--ex-input);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-height: min(640px, calc(var(--ex-frame-h) * 0.7));
}
[data-dsap="explore-gallery"] .ex-detail-media {
  flex: 0 0 auto;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem;
  background: #0a0e1c;
}
[data-dsap="explore-gallery"] .ex-detail-media img {
  display: block;
  max-width: 100%;
  max-height: min(900px, calc(var(--ex-frame-h) * 0.78));
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
  cursor: zoom-in;
}
[data-dsap="explore-gallery"] .ex-detail-side {
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  max-width: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
/* Side-by-side when Grimoire modal / DSAP root is wide (ResizeObserver → .ex-layout-wide) */
[data-dsap="explore-gallery"].ex-layout-wide .ex-detail-card {
  flex-direction: row;
  flex-wrap: nowrap;
}
[data-dsap="explore-gallery"].ex-layout-wide .ex-detail-media {
  flex: 1 1 40%;
  width: auto;
  min-width: 40%;
}
[data-dsap="explore-gallery"].ex-layout-wide .ex-detail-side {
  flex: 0 1 60%;
  width: auto;
  max-width: min(800px, 60%);
  min-width: min(320px, 60%);
}
[data-dsap="explore-gallery"] .ex-detail-side-gears {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: visible;
}
/* Image-page gears — NAI sc-f25e1a0d placement (anchored to meta panel) */
[data-dsap="explore-gallery"] .ex-gear-detail-lg {
  width: 492px;
  height: 492px;
  top: -290px;
  right: -150px;
  left: auto;
  stroke-width: 10px;
}
[data-dsap="explore-gallery"] .ex-gear-detail-sm {
  width: 144px;
  height: 144px;
  top: 86px;
  right: 420px;
  left: auto;
  stroke-width: 10px;
}
[data-dsap="explore-gallery"]:not(.ex-layout-wide) .ex-detail-side-gears {
  display: none;
}

[data-dsap="explore-gallery"] .ex-detail-side-inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
[data-dsap="explore-gallery"] .ex-detail-header {
  padding: 1rem 1.1rem 0.75rem;
  flex-shrink: 0;
}
[data-dsap="explore-gallery"] .ex-detail-title {
  font-family: "Eczar", Georgia, serif;
  font-size: 1.55rem;
  font-weight: 700;
  margin: 0 0 0.35rem;
  line-height: 1.2;
  color: var(--ex-cream);
}
[data-dsap="explore-gallery"] .ex-detail-byline {
  margin: 0 0 0.85rem;
  font-size: 0.9rem;
  color: var(--ex-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  align-items: baseline;
}
[data-dsap="explore-gallery"] .ex-detail-byline .ex-creator-link {
  color: var(--ex-link);
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
[data-dsap="explore-gallery"] .ex-detail-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
[data-dsap="explore-gallery"] .ex-detail-actions-icons {
  margin-left: auto;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}
[data-dsap="explore-gallery"] .ex-detail-btn {
  border-radius: 6px;
  border: 1px solid var(--ex-border);
  background: var(--ex-input);
  color: var(--ex-text);
  padding: 0.5rem 0.9rem;
  cursor: pointer;
  font-size: 0.9rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
[data-dsap="explore-gallery"] .ex-detail-btn.primary {
  background: var(--ex-cream);
  color: #1a1a1a;
  border-color: transparent;
  font-weight: 600;
}
[data-dsap="explore-gallery"] .ex-detail-btn.icon-only {
  width: 2.35rem;
  height: 2.35rem;
  padding: 0;
  justify-content: center;
  gap: 0;
}
[data-dsap="explore-gallery"] .ex-detail-btn-icon {
  width: 1.15rem;
  height: 1.15rem;
  object-fit: contain;
  flex-shrink: 0;
  display: block;
}

[data-dsap="explore-gallery"] .ex-detail-scroll {
  flex: 1 1 auto;
  overflow: auto;
  padding: 0.5rem 1.1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
[data-dsap="explore-gallery"] .ex-prompt-block { display: flex; flex-direction: column; gap: 0.45rem; }
[data-dsap="explore-gallery"] .ex-prompt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
[data-dsap="explore-gallery"] .ex-prompt-label {
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.45);
  font-weight: 600;
}
[data-dsap="explore-gallery"] .ex-copy-btn {
  border: none;
  background: transparent;
  color: var(--ex-muted);
  cursor: pointer;
  padding: 0.2rem 0.35rem;
  border-radius: 4px;
}
[data-dsap="explore-gallery"] .ex-copy-btn:hover { color: var(--ex-text); background: rgba(255,255,255,0.06); }
[data-dsap="explore-gallery"] .ex-detail-btn.ex-like-btn {
  width: auto;
  min-width: 2.35rem;
  padding: 0.5rem;
  gap: 0.3rem;
}
[data-dsap="explore-gallery"] .ex-detail-btn.ex-like-btn .ex-like-count {
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  margin-left: var(--spacing-sm);
}
[data-dsap="explore-gallery"] .ex-detail-btn.ex-like-btn.is-on,
[data-dsap="explore-gallery"] .ex-detail-btn.ex-like-btn.is-on i {
  color: #ff6b8a;
}
[data-dsap="explore-gallery"] .ex-detail-btn.is-disabled,
[data-dsap="explore-gallery"] .ex-detail-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

[data-dsap="explore-gallery"] .ex-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
[data-dsap="explore-gallery"] .ex-prompt-display.compiled-prompt-display-wrapper {
  background: rgba(0, 0, 0, 0.35);
  border-color: var(--ex-border);
  min-height: 52px;
  max-height: none;
  height: auto;
  overflow: visible;
}
[data-dsap="explore-gallery"] .ex-prompt-display .compiled-prompt-display,
[data-dsap="explore-gallery"] .ex-prompt-display .emphasis-highlight-overlay {
  font-size: 0.88rem;
  line-height: 1.45;
  padding: 0.5rem 0.65rem;
}
[data-dsap="explore-gallery"] .ex-prompt-display .compiled-prompt-display {
  color: var(--ex-text);
  height: auto;
  min-height: 0;
  overflow: visible;
}
[data-dsap="explore-gallery"] .ex-prompt-display .emphasis-highlight-overlay {
  color: transparent;
  /* Match text layer exactly — no scroll; grow with content */
  position: absolute;
  inset: 0;
  height: auto;
  overflow: visible;
}
/* Edge caret spans drift wrap alignment in read-only displays */
[data-dsap="explore-gallery"] .ex-prompt-display .emphasis-group-edge {
  display: none !important;
}
[data-dsap="explore-gallery"] .ex-uc-block.ex-prompt-display {
  max-height: none;
}
[data-dsap="explore-gallery"] .ex-tag {
  display: inline-flex;
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 9999px;
  background: var(--ex-tag);
  color: rgba(255,255,255,0.92);
  border: 1px solid rgba(255,255,255,0.06);
  max-width: 100%;
  word-break: break-word;
}
[data-dsap="explore-gallery"] .ex-tag-empty { color: var(--ex-muted); font-size: 0.9rem; }
[data-dsap="explore-gallery"] .ex-uc-block[hidden],
[data-dsap="explore-gallery"] .ex-char-uc[hidden] { display: none !important; }
[data-dsap="explore-gallery"] .ex-expand-btn {
  align-self: flex-start;
  border: none;
  background: transparent;
  color: var(--ex-link);
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
  padding: 0.15rem 0;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
[data-dsap="explore-gallery"] .ex-char-block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(255,255,255,0.08);
}
[data-dsap="explore-gallery"] .ex-char-title {
  font-size: 0.95rem;
  color: rgba(255,255,255,0.7);
  margin: 0;
}

[data-dsap="explore-gallery"] .ex-stats-bar {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 1.5rem;
  padding: 0.75rem 1.1rem;
  border-radius: 0 0 12px 12px;
  background: rgba(0,0,0,0.22);
  border-top: 1px solid rgba(255,255,255,0.06);
}
[data-dsap="explore-gallery"] .ex-stat {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 4.5rem;
}
[data-dsap="explore-gallery"] .ex-stat-label {
  font-size: 0.75rem;
  color: rgba(255,255,255,0.45);
}
[data-dsap="explore-gallery"] .ex-stat-value {
  font-size: 0.95rem;
  white-space: nowrap;
}

[data-dsap="explore-gallery"] .ex-more-section {
  width: 100%;
  margin-top: 2.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
[data-dsap="explore-gallery"] .ex-more-section[hidden] {
  display: none !important;
}
[data-dsap="explore-gallery"] .ex-more-title {
  font-family: "Eczar", Georgia, serif;
  font-size: 1.15rem;
  margin: 0;
  font-weight: 600;
}
[data-dsap="explore-gallery"] .ex-more-row {
  display: flex;
  gap: 0.75rem;
  overflow: hidden;
  width: 100%;
}
[data-dsap="explore-gallery"] .ex-more-card {
  flex: 0 0 ${EXPLORE_CREATOR_CARD_W}px;
  width: ${EXPLORE_CREATOR_CARD_W}px;
  text-decoration: none;
  color: inherit;
  background: var(--ex-card);
  border: 1px solid var(--ex-border);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
}
[data-dsap="explore-gallery"] .ex-more-card img {
  display: block;
  width: 100%;
  height: 180px;
  object-fit: cover;
  background: #0a0e1c;
}
[data-dsap="explore-gallery"] .ex-more-card-cap {
  padding: 0.45rem 0.55rem 0.65rem;
  font-size: 0.78rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}
[data-dsap="explore-gallery"] .ex-show-all-wrap {
  display: flex;
  justify-content: center;
  margin-top: 0.5rem;
}
[data-dsap="explore-gallery"] .ex-show-all-btn {
  min-height: 42px;
  padding: 0.45rem 1.25rem;
  border-radius: 6px;
  border: 1px solid var(--ex-border);
  background: var(--ex-input);
  color: var(--ex-text);
  cursor: pointer;
  font: inherit;
  font-size: 0.95rem;
}
[data-dsap="explore-gallery"] .ex-show-all-btn:hover { background: #1a2444; }
`;

function exploreBuildShellHtml() {
    return `
<div data-dsap="explore-gallery" class="dsap-root explore-gallery-root">
  <div class="ex-bg-layer" id="exBgLayer" aria-hidden="true">
    <div class="ex-dot-grid"></div>
    ${exploreGearSvg('ex-gear-gallery-lg')}
    ${exploreGearSvg('ex-gear-gallery-sm')}
  </div>
  <div class="ex-ban-banner hidden" id="exBanBanner" role="alert">
    <i class="fas fa-ban" aria-hidden="true"></i>
    Your NovelAI Explore account is currently banned.
  </div>
  <div id="exViewRoot" class="ex-view"></div>
</div>`;
}

const exploreDsapDriver = {
    _state: null,

    init(host) {
        this.destroy(host);
        this._state = {
            host,
            sort: 'new',
            period: 'day',
            search: '',
            results: [],
            page: 1,
            total: 0,
            limit: 50,
            loading: false,
            hasMore: false,
            forceNext: false,
            lastMeta: null,
            byId: new Map(),
            detailId: null,
            creatorId: '',
            creatorName: '',
            likesMode: false,
            exploreUser: null,
            blockedCreatorIds: new Set(),
            pageOffset: 0,
            nextOffset: null,
            offsetByPage: { 1: 0 },
            backCreatorId: '',
            backCreatorName: '',
            backLikesMode: false,
            creatorRowObserver: null,
            layoutObserver: null
        };
        this._applyUrlState(host);
        this._wireLayoutObserver(host);
        this._wireChrome(host);
        this._wireGrimoireContextMenus(host);
        this._refreshExploreUser(host);
        this._refreshBlockedCreators();
        this._render(host);
    },

    refresh(host) {
        if (!this._state) {
            this.init(host);
            return;
        }
        this._state.forceNext = true;
        this._applyUrlState(host);
        this._wireLayoutObserver(host);
        this._refreshExploreUser(host);
        this._refreshBlockedCreators();
        this._render(host);
    },

    destroy(host) {
        const state = this._state;
        if (state?.creatorRowObserver) {
            try { state.creatorRowObserver.disconnect(); } catch (_) { /* ignore */ }
        }
        if (state?.layoutObserver) {
            try { state.layoutObserver.disconnect(); } catch (_) { /* ignore */ }
            state.layoutObserver = null;
        }
        const root = host?.getRoot?.();
        if (root) {
            root.classList.remove('ex-layout-wide', 'ex-cols-2', 'ex-cols-3', 'ex-cols-4');
            root.style.removeProperty('--ex-frame-h');
            // teardownDsapDropdownsInRoot: public/scripts/comp/dsapRegistry.js
            teardownDsapDropdownsInRoot(root);
        }
        this._state = null;
    },

    _applyUrlState(host) {
        const parsed = exploreParseState(host);
        Object.assign(this._state, {
            sort: parsed.sort,
            period: parsed.period,
            search: parsed.search,
            detailId: parsed.detailId,
            creatorId: parsed.detailId ? '' : parsed.creatorId,
            creatorName: parsed.detailId ? '' : parsed.creatorName,
            likesMode: !!(parsed.likesMode && !parsed.detailId),
            page: parsed.page,
            pageOffset: parsed.offset != null
                ? parsed.offset
                : Math.max(0, (parsed.page - 1) * (this._state.limit || 50)),
            results: [],
            hasMore: false
        });
        if (!this._state.offsetByPage) this._state.offsetByPage = { 1: 0 };
        this._state.offsetByPage[parsed.page] = this._state.pageOffset;
        // Preserve back-context on detail (creator page or My Likes)
        if (parsed.detailId) {
            const from = host.getQueryParam('from');
            if (from === 'likes') {
                this._state.backLikesMode = true;
                this._state.backCreatorId = '';
                this._state.backCreatorName = '';
            } else if (from === 'creator') {
                this._state.backLikesMode = false;
                this._state.backCreatorId = host.getQueryParam('creator_id') || '';
                this._state.backCreatorName = host.getQueryParam('creator_name') || '';
            } else {
                this._state.backLikesMode = false;
                this._state.backCreatorId = '';
                this._state.backCreatorName = '';
            }
        } else {
            this._state.backLikesMode = false;
            this._state.backCreatorId = '';
            this._state.backCreatorName = '';
        }
    },

    _wireChrome(host) {
        const root = host?.getRoot?.();
        if (!root || root.dataset.exChromeWired === '1') return;
        root.dataset.exChromeWired = '1';
        // Buttons are recreated with each hero render — delegate from root
        root.addEventListener('click', (e) => {
            if (e.target.closest('#exRegBtn')) {
                exploreOpenExternal(EXPLORE_REGISTER_URL);
                return;
            }
            const profileBtn = e.target.closest('#exProfileBtn');
            if (profileBtn) {
                const id = profileBtn.getAttribute('data-ex-creator-id') || '';
                const name = profileBtn.getAttribute('data-ex-creator-name') || '';
                if (id) {
                    host.navigate(exploreBuildCreatorUrl({ creatorId: id, creatorName: name }));
                }
                return;
            }
            if (e.target.closest('#exLikesBtn')) {
                host.navigate(exploreBuildLikesUrl({}));
            }
        });
        this._syncChromeButtons();
    },

    _wireGrimoireContextMenus(host) {
        if (!host || typeof host.registerContextMenuItems !== 'function') return;

        const resolvePostFromEl = (el) => {
            const card = el?.closest?.('[data-ex-id]');
            const id = card?.dataset?.exId || this._state?.detailId;
            if (!id || !this._state?.byId) return null;
            return this._state.byId.get(id) || null;
        };

        host.registerContextMenuItems('.ex-card, .ex-more-card', (el) => {
            const post = resolvePostFromEl(el);
            if (!post) return [];
            return [
                { text: 'Open Details', icon: 'fas fa-magnifying-glass', action: 'ex-open-detail', data: { id: post.id } },
                { text: 'Download PNG', icon: 'fas fa-download', action: 'ex-download', data: { id: post.id } },
                { text: 'Copy Image', icon: 'fas fa-clipboard', action: 'ex-copy-image', data: { id: post.id } },
                { text: 'Open in Studio', icon: 'fas fa-compass-drafting', action: 'ex-open-studio', data: { id: post.id } },
                { text: 'Import to Workspace', icon: 'fas fa-file-import', action: 'ex-import-ws', data: { id: post.id } }
            ];
        });

        host.registerContextMenuItems('.ex-detail-media img', () => {
            const post = this._state?.detailId && this._state.byId?.get(this._state.detailId);
            if (!post) return [];
            return [
                { text: 'Download PNG', icon: 'fas fa-download', action: 'ex-download-detail' },
                { text: 'Copy Image', icon: 'fas fa-clipboard', action: 'ex-copy-detail' },
                { text: 'Open in Studio', icon: 'fas fa-compass-drafting', action: 'ex-open-studio-detail' },
                { text: 'Import to Workspace', icon: 'fas fa-file-import', action: 'ex-import-detail' }
            ];
        });

        const postFromItem = (el, item) => {
            const id = item?.data?.id || el?.closest?.('[data-ex-id]')?.dataset?.exId || this._state?.detailId;
            return id && this._state?.byId ? this._state.byId.get(id) : null;
        };

        host.registerContextMenuAction('ex-open-detail', (el, item) => {
            const id = item?.data?.id || el?.closest?.('[data-ex-id]')?.dataset?.exId;
            if (!id || !this._state?.host) return;
            this._state.host.navigate(exploreBuildDetailUrl(id, this._state));
        });
        host.registerContextMenuAction('ex-download', (el, item) => {
            const post = postFromItem(el, item);
            if (post) void exploreDownloadRawImage(post);
        });
        host.registerContextMenuAction('ex-copy-image', (el, item) => {
            const post = postFromItem(el, item);
            if (post) void exploreCopyRawImage(post);
        });
        host.registerContextMenuAction('ex-open-studio', (el, item) => {
            const post = postFromItem(el, item);
            if (post) void exploreOpenInEditor(post);
        });
        host.registerContextMenuAction('ex-import-ws', (el, item) => {
            const post = postFromItem(el, item);
            if (post) void exploreImportToWorkspace(post);
        });
        host.registerContextMenuAction('ex-download-detail', () => {
            const post = this._state?.detailId && this._state.byId?.get(this._state.detailId);
            if (post) void exploreDownloadRawImage(post);
        });
        host.registerContextMenuAction('ex-copy-detail', () => {
            const post = this._state?.detailId && this._state.byId?.get(this._state.detailId);
            if (post) void exploreCopyRawImage(post);
        });
        host.registerContextMenuAction('ex-open-studio-detail', () => {
            const post = this._state?.detailId && this._state.byId?.get(this._state.detailId);
            if (post) void exploreOpenInEditor(post);
        });
        host.registerContextMenuAction('ex-import-detail', () => {
            const post = this._state?.detailId && this._state.byId?.get(this._state.detailId);
            if (post) void exploreImportToWorkspace(post);
        });
    },

    _syncChromeButtons() {
        const state = this._state;
        const root = state?.host?.getRoot?.();
        if (!root) return;
        const regBtn = root.querySelector('#exRegBtn');
        const profileBtn = root.querySelector('#exProfileBtn');
        const likesBtn = root.querySelector('#exLikesBtn');
        const banBanner = root.querySelector('#exBanBanner');
        const registered = !!state.exploreUser?.registered;
        const known = !!state.exploreUser;
        const user = state.exploreUser?.user;
        const onMainGallery = !state.detailId && !state.likesMode && !state.creatorId;
        if (regBtn) {
            regBtn.classList.toggle('hidden', !onMainGallery || !known || registered);
        }
        if (profileBtn) {
            const show = onMainGallery && registered && !!user?.id;
            profileBtn.classList.toggle('hidden', !show);
            if (user?.name) profileBtn.textContent = user.name;
            if (user?.id) {
                profileBtn.setAttribute('data-ex-creator-id', user.id);
                profileBtn.setAttribute('data-ex-creator-name', user.name || '');
            }
        }
        if (likesBtn) {
            likesBtn.classList.toggle('hidden', !known || !registered);
            likesBtn.classList.toggle('is-active', !!(state.likesMode || state.backLikesMode));
        }
        if (banBanner) {
            banBanner.classList.toggle('hidden', !user?.is_currently_banned);
        }
        this._syncLikeButtons();
        this._syncBlockCreatorButton();
    },

    _syncLikeButtons() {
        const state = this._state;
        const root = state?.host?.getRoot?.();
        if (!root) return;
        const canLike = !!state.exploreUser?.registered;
        root.querySelectorAll('[data-ex-like]').forEach((btn) => {
            btn.disabled = !canLike;
            btn.classList.toggle('is-disabled', !canLike);
            btn.title = canLike ? 'Like' : 'Like (Explore registration required)';
        });
    },

    _syncBlockCreatorButton() {
        const state = this._state;
        const root = state?.host?.getRoot?.();
        const btn = root?.querySelector('#exBlockCreatorBtn');
        if (!btn || !state?.creatorId) return;
        const selfId = state.exploreUser?.user?.id;
        const isSelf = !!(selfId && String(selfId) === String(state.creatorId));
        btn.classList.toggle('hidden', isSelf);
        if (isSelf) return;
        const blocked = state.blockedCreatorIds?.has(String(state.creatorId));
        btn.classList.toggle('is-blocked', !!blocked);
        btn.innerHTML = blocked
            ? '<i class="fas fa-ban"></i> Unblock'
            : '<i class="fas fa-ban"></i> Block';
        btn.title = blocked
            ? 'Show this creator’s posts in Agora again'
            : 'Hide all posts from this creator in Agora';
    },

    async _refreshExploreUser(host) {
        const state = this._state;
        if (!state || !wsClient) return;
        try {
            const data = await wsClient.sendMessage('get_novelai_explore_user', {}, false);
            state.exploreUser = data || null;
        } catch (err) {
            console.warn('Agora explore user/self', err);
            state.exploreUser = null;
        }
        this._syncChromeButtons();
    },

    async _refreshBlockedCreators() {
        const state = this._state;
        if (!state || !wsClient) return;
        try {
            const data = await wsClient.sendMessage('list_novelai_explore_blocked_creators', {}, false);
            state.blockedCreatorIds = new Set((data?.ids || []).map(String));
        } catch (err) {
            console.warn('Agora blocked creators', err);
            state.blockedCreatorIds = state.blockedCreatorIds || new Set();
        }
        this._syncBlockCreatorButton();
    },

    async _toggleBlockCreator(creatorId, creatorName) {
        const state = this._state;
        if (!creatorId || !wsClient) return;
        const id = String(creatorId);
        const blocked = state.blockedCreatorIds?.has(id);
        await wsClient.sendMessage('block_novelai_explore_creator', {
            id,
            name: creatorName || '',
            undo: !!blocked
        }, false);
        if (!state.blockedCreatorIds) state.blockedCreatorIds = new Set();
        if (blocked) state.blockedCreatorIds.delete(id);
        else state.blockedCreatorIds.add(id);
        this._syncBlockCreatorButton();
        showGlassToast(
            'info',
            'Agora',
            blocked ? 'Creator unblocked' : 'Creator blocked — their posts are hidden',
            false,
            2500
        );
        if (!blocked) {
            state.host.navigate(exploreBuildGalleryUrl({
                sort: state.sort,
                period: state.period,
                search: state.search
            }));
        }
    },

    async _toggleLike(postId, currentlyLiked) {
        const state = this._state;
        if (!postId || !wsClient) return null;
        // Not clickable until we know the user is Explore-registered
        if (!state.exploreUser?.registered) return null;
        const res = await wsClient.sendMessage('set_novelai_explore_post_like', {
            id: postId,
            like: !currentlyLiked
        }, false);
        if (res?.error || res?.code === 'EXPLORE_NOT_REGISTERED') {
            state.exploreUser = { registered: false, registerUrl: res.registerUrl || EXPLORE_REGISTER_URL };
            this._syncChromeButtons();
            return null;
        }
        const post = state.byId.get(postId);
        if (post) {
            const prev = !!post.liked_by_self;
            post.liked_by_self = !prev;
            const n = Number(post.like_count) || 0;
            post.like_count = Math.max(0, n + (post.liked_by_self ? 1 : -1));
            state.byId.set(postId, post);
        }
        return post || { id: postId, liked_by_self: !currentlyLiked };
    },

    async _downvotePost(postId) {
        const state = this._state;
        if (!postId || !wsClient) return;
        await wsClient.sendMessage('downvote_novelai_explore_post', { id: postId }, false);
        state.byId.delete(postId);
        state.results = (state.results || []).filter((p) => p.id !== postId);
        const root = state.host.getRoot();
        root.querySelectorAll(`[data-ex-id="${CSS.escape(postId)}"], [data-ex-react="${CSS.escape(postId)}"]`).forEach((el) => {
            const card = el.closest('.ex-card, .ex-more-card') || (el.classList.contains('ex-card') ? el : null);
            if (card) card.remove();
        });
        if (state.detailId === postId) {
            const host = state.host;
            if (state.backLikesMode || state.likesMode) host.navigate(exploreBuildLikesUrl({}));
            else if (state.backCreatorId) {
                host.navigate(exploreBuildCreatorUrl({
                    creatorId: state.backCreatorId,
                    creatorName: state.backCreatorName || ''
                }));
            } else {
                host.navigate(exploreBuildGalleryUrl({
                    sort: state.sort,
                    period: state.period,
                    search: state.search,
                    page: state.page
                }));
            }
        }
        showGlassToast('info', 'Agora', 'Hidden from Agora results', false, 2000);
    },

    _paintReactBar(barEl, post) {
        if (!barEl || !post) return;
        const likeBtn = barEl.querySelector('.ex-like-btn') || (barEl.classList?.contains('ex-like-btn') ? barEl : null);
        const scope = likeBtn?.closest('[data-ex-react]') || barEl;
        const btn = scope.querySelector('.ex-like-btn');
        const countEl = scope.querySelector('.ex-like-count');
        const icon = btn?.querySelector('i');
        const liked = !!post.liked_by_self;
        if (btn) btn.classList.toggle('is-on', liked);
        if (icon) icon.className = `${liked ? 'fas' : 'far'} fa-heart`;
        if (countEl) countEl.textContent = String(Number(post.like_count) || 0);
        this._syncLikeButtons();
    },

    _wireReactDelegation(root) {
        if (!root || root.dataset.exReactWired === '1') return;
        root.dataset.exReactWired = '1';
        root.addEventListener('click', async (e) => {
            const likeBtn = e.target.closest('[data-ex-like]');
            const downBtn = e.target.closest('[data-ex-down]');
            if (!likeBtn && !downBtn) return;
            e.preventDefault();
            e.stopPropagation();
            if (likeBtn && (likeBtn.disabled || likeBtn.classList.contains('is-disabled'))) return;
            const bar = e.target.closest('[data-ex-react]');
            const postId = bar?.getAttribute('data-ex-react');
            if (!postId) return;
            if (downBtn) {
                await this._downvotePost(postId);
                return;
            }
            const post = this._state?.byId.get(postId);
            const currentlyLiked = !!post?.liked_by_self;
            try {
                const updated = await this._toggleLike(postId, currentlyLiked);
                if (updated) {
                    root.querySelectorAll(`[data-ex-react="${CSS.escape(postId)}"]`).forEach((el) => {
                        this._paintReactBar(el, updated);
                    });
                }
            } catch (err) {
                showGlassToast('error', 'Agora', err.message || 'Like failed', false, 3500);
            }
        });
    },

    _setGalleryGearsVisible(visible) {
        const root = this._state?.host?.getRoot?.();
        const layer = root?.querySelector('#exBgLayer');
        if (!layer) return;
        // Keep gradient/dot background; only toggle gallery hero gears
        layer.querySelectorAll('.ex-gear-gallery-lg, .ex-gear-gallery-sm').forEach((el) => {
            el.style.display = visible ? '' : 'none';
        });
    },

    /** Grimoire virtual-browser scrollport (customScrollbar inner), never the real window. */
    _resolveScrollPort(host) {
        const displayArea = host?.shell?.displayArea;
        const scrollHost = displayArea?.closest('.form-section-scroll')
            || host?.getRoot?.()?.closest('.form-section-scroll');
        if (!scrollHost) return null;
        // customScrollbar: public/scripts/comp/customScrollbar.js
        const entry = customScrollbar?.scrollbars?.get(scrollHost);
        return entry?.scrollableContent || scrollHost;
    },

    /** Pin --ex-frame-h + .ex-layout-wide from Grimoire frame size (not browser viewport). */
    _wireLayoutObserver(host) {
        const state = this._state;
        if (!state) return;
        const root = host?.getRoot?.();
        if (!root) return;
        if (state.layoutObserver) {
            try { state.layoutObserver.disconnect(); } catch (_) { /* ignore */ }
            state.layoutObserver = null;
        }
        const scrollPort = this._resolveScrollPort(host);
        const apply = () => {
            const frameH = (scrollPort && scrollPort.clientHeight) || root.clientHeight || 0;
            if (frameH > 0) {
                root.style.setProperty('--ex-frame-h', `${frameH}px`);
            }
            const w = root.clientWidth || 0;
            root.classList.toggle('ex-layout-wide', w >= 960);
            root.classList.remove('ex-cols-2', 'ex-cols-3', 'ex-cols-4');
            if (w >= 1280) root.classList.add('ex-cols-4');
            else if (w >= 900) root.classList.add('ex-cols-3');
            else if (w >= 560) root.classList.add('ex-cols-2');
        };
        apply();
        if (typeof ResizeObserver === 'function') {
            state.layoutObserver = new ResizeObserver(() => apply());
            state.layoutObserver.observe(root);
            if (scrollPort && scrollPort !== root) {
                state.layoutObserver.observe(scrollPort);
            }
        }
    },

    _render(host) {
        const state = this._state;
        if (!state) return;
        this._wireReactDelegation(host.getRoot());
        this._syncChromeButtons();
        if (state.detailId) {
            this._setGalleryGearsVisible(false);
            this._renderDetail(host);
            return;
        }
        this._setGalleryGearsVisible(true);
        if (state.likesMode) {
            this._renderLikesGallery(host);
            return;
        }
        if (state.creatorId) {
            this._renderCreatorGallery(host);
            return;
        }
        this._renderGallery(host);
    },

    _renderGallery(host) {
        const state = this._state;
        const root = host.getRoot();
        const view = root.querySelector('#exViewRoot') || root;
        const periodDisabled = state.sort === 'new' ? 'is-disabled' : '';

        view.innerHTML = `
          <div class="ex-hero">
            ${exploreHeroChromeHtml(state, { registration: true })}
            <p class="ex-hero-sub">See what the NovelAI Community is dreaming up.</p>
            <div class="ex-toolbar">
              <div class="ex-search-wrap">
                <i class="fas fa-magnifying-glass"></i>
                <input type="text" id="exSearchInput" placeholder="Search for a tag" value="${exploreEscapeHtml(state.search)}" autocomplete="off">
              </div>
              <div class="custom-dropdown" id="exSortDropdown">
                <button type="button" class="custom-dropdown-btn hover-show colored" id="exSortBtn">
                  <span id="exSortSelected">${exploreEscapeHtml(exploreSortLabel(state.sort))}</span>
                </button>
                <div id="exSortMenu" class="custom-dropdown-menu hidden"></div>
              </div>
              <input type="hidden" id="exSortHidden" value="${exploreEscapeHtml(state.sort)}">
              <div class="custom-dropdown ex-period-wrap ${periodDisabled}" id="exPeriodDropdown">
                <button type="button" class="custom-dropdown-btn hover-show colored" id="exPeriodBtn">
                  <span id="exPeriodSelected">${exploreEscapeHtml(explorePeriodLabel(state.period))}</span>
                </button>
                <div id="exPeriodMenu" class="custom-dropdown-menu hidden"></div>
              </div>
              <input type="hidden" id="exPeriodHidden" value="${exploreEscapeHtml(state.period)}">
              <button type="button" class="ex-refresh-btn" id="exRefreshBtn" title="Refresh from NovelAI">
                <i class="fas fa-arrows-rotate"></i>
              </button>
            </div>
          </div>
          <div class="ex-meta-bar">
            <span id="exStatusText">Loading…</span>
            <div class="ex-pager" id="exPager">
              <button type="button" class="ex-page-btn" id="exPrevBtn" title="Previous page" disabled>◀</button>
              <span class="ex-page-indicator" id="exPageIndicator">—</span>
              <button type="button" class="ex-page-btn" id="exNextBtn" title="Next page" disabled>▶</button>
            </div>
            <span id="exCacheNote"></span>
          </div>
          <div class="ex-body">
            <div id="exGrid" class="ex-grid"></div>
            <div id="exLoading" class="ex-loading hidden">Loading community images…</div>
            <div id="exEmpty" class="ex-empty hidden">No posts match these filters.</div>
            <div class="ex-bottom-pager hidden" id="exBottomPager">
              <button type="button" class="ex-next-page-btn" id="exBottomNextBtn">
                Next page <i class="fas fa-chevron-right"></i>
              </button>
            </div>
          </div>`;

        setTimeout(() => {
            this._wireGalleryControls(host, { mode: 'gallery' });
            this._loadPage({ mode: 'gallery' });
        }, 0);
    },

    _renderLikesGallery(host) {
        const state = this._state;
        const root = host.getRoot();
        const view = root.querySelector('#exViewRoot') || root;

        view.innerHTML = `
          <div class="ex-detail-page" style="padding-top:0.5rem;">
            ${exploreDetailNavHtml(state)}
            <div class="ex-hero" style="padding:0 0 1rem;max-width:none;">
              <h1 class="ex-hero-title">My Likes</h1>
              <p class="ex-hero-sub">Posts you liked on NovelAI Explore.</p>
            </div>
            <div class="ex-meta-bar" style="max-width:none;padding:0 0 0.75rem;">
              <span id="exStatusText">Loading…</span>
              <div class="ex-pager">
                <button type="button" class="ex-page-btn" id="exPrevBtn" disabled>◀</button>
                <span class="ex-page-indicator" id="exPageIndicator">—</span>
                <button type="button" class="ex-page-btn" id="exNextBtn" disabled>▶</button>
              </div>
              <span id="exCacheNote"></span>
            </div>
            <div id="exGrid" class="ex-grid"></div>
            <div id="exLoading" class="ex-loading hidden">Loading…</div>
            <div id="exEmpty" class="ex-empty hidden">No liked posts yet.</div>
          </div>`;

        root.querySelector('#exBackBtn')?.addEventListener('click', () => {
            host.navigate(exploreBuildGalleryUrl({}));
        });

        setTimeout(() => {
            this._wireGalleryControls(host, { mode: 'likes' });
            this._loadPage({ mode: 'likes' });
        }, 0);
    },

    _renderCreatorGallery(host) {
        const state = this._state;
        const root = host.getRoot();
        const view = root.querySelector('#exViewRoot') || root;
        const name = state.creatorName || 'this creator';

        view.innerHTML = `
          <div class="ex-detail-page" style="padding-top:0.5rem;">
            ${exploreDetailNavHtml(state)}
            <div class="ex-hero" style="padding:0 0 1rem;max-width:none;">
              <div class="ex-hero-top" style="margin-bottom:0.5rem;">
                <h1 class="ex-hero-title" style="flex:1;margin:0;font-size:clamp(1.5rem,3.2cqi,2.25rem);">Posts by ${exploreEscapeHtml(name)}</h1>
                <button type="button" class="ex-chrome-btn ex-block-creator-btn" id="exBlockCreatorBtn">
                  <i class="fas fa-ban"></i> Block
                </button>
              </div>
              <p class="ex-hero-sub">All uploads from this creator.</p>
            </div>
            <div class="ex-meta-bar" style="max-width:none;padding:0 0 0.75rem;">
              <span id="exStatusText">Loading…</span>
              <div class="ex-pager">
                <button type="button" class="ex-page-btn" id="exPrevBtn" disabled>◀</button>
                <span class="ex-page-indicator" id="exPageIndicator">—</span>
                <button type="button" class="ex-page-btn" id="exNextBtn" disabled>▶</button>
              </div>
              <span id="exCacheNote"></span>
            </div>
            <div id="exGrid" class="ex-grid"></div>
            <div id="exLoading" class="ex-loading hidden">Loading…</div>
            <div id="exEmpty" class="ex-empty hidden">No posts from this creator.</div>
          </div>`;

        root.querySelector('#exBackBtn')?.addEventListener('click', () => {
            host.navigate(exploreBuildGalleryUrl({}));
        });
        root.querySelector('#exBlockCreatorBtn')?.addEventListener('click', () => {
            this._toggleBlockCreator(state.creatorId, state.creatorName);
        });
        this._syncBlockCreatorButton();

        setTimeout(() => {
            this._wireGalleryControls(host, { mode: 'creator' });
            this._loadPage({ mode: 'creator' });
        }, 0);
    },

    _wireGalleryControls(host, { mode }) {
        const state = this._state;
        if (!state) return;
        const root = host.getRoot();
        const prevBtn = root.querySelector('#exPrevBtn');
        const nextBtn = root.querySelector('#exNextBtn');
        const refreshBtn = root.querySelector('#exRefreshBtn');

        if (mode === 'gallery') {
            const sortHidden = root.querySelector('#exSortHidden');
            const periodHidden = root.querySelector('#exPeriodHidden');
            const sortSelected = root.querySelector('#exSortSelected');
            const periodSelected = root.querySelector('#exPeriodSelected');
            const periodWrap = root.querySelector('#exPeriodDropdown');
            const searchInput = root.querySelector('#exSearchInput');

            const navigateWith = (patch) => {
                const next = {
                    sort: state.sort,
                    period: state.period,
                    search: state.search,
                    page: state.page,
                    offset: state.pageOffset,
                    ...patch
                };
                if (patch.sort != null || patch.period != null || patch.search != null) {
                    if (patch.page == null) next.page = 1;
                    if (patch.offset == null) next.offset = 0;
                    state.offsetByPage = { 1: 0 };
                }
                if (patch.page === 1 && patch.offset == null) next.offset = 0;
                host.navigate(exploreBuildGalleryUrl(next));
            };

            // setupDropdown: public/scripts/comp/dropdown.js
            // renderSimpleDropdown: public/scripts/comp/manualDropdownManager.js
            setupDropdown(
                root.querySelector('#exSortDropdown'),
                root.querySelector('#exSortBtn'),
                root.querySelector('#exSortMenu'),
                (selectedVal) => renderSimpleDropdown(
                    root.querySelector('#exSortMenu'),
                    EXPLORE_SORT_OPTIONS,
                    'value',
                    'label',
                    (item) => {
                        sortHidden.value = item.value;
                        sortSelected.textContent = item.label;
                        navigateWith({ sort: item.value, page: 1, offset: 0 });
                    },
                    closeDropdown,
                    selectedVal
                ),
                () => sortHidden.value
            );

            setupDropdown(
                root.querySelector('#exPeriodDropdown'),
                root.querySelector('#exPeriodBtn'),
                root.querySelector('#exPeriodMenu'),
                (selectedVal) => renderSimpleDropdown(
                    root.querySelector('#exPeriodMenu'),
                    EXPLORE_PERIOD_OPTIONS,
                    'value',
                    'label',
                    (item) => {
                        periodHidden.value = item.value;
                        periodSelected.textContent = item.label;
                        navigateWith({ period: item.value, page: 1, offset: 0 });
                    },
                    closeDropdown,
                    selectedVal
                ),
                () => periodHidden.value
            );

            if (periodWrap) periodWrap.classList.toggle('is-disabled', state.sort === 'new');

            searchInput?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    navigateWith({ search: (searchInput.value || '').trim(), page: 1, offset: 0 });
                }
            });

            refreshBtn?.addEventListener('click', async () => {
                refreshBtn.classList.add('is-spinning');
                try {
                    if (wsClient) {
                        await wsClient.sendMessage('clear_novelai_explore_gallery_cache', {}, false);
                    }
                    state.forceNext = true;
                    await this._loadPage({ mode: 'gallery' });
                } catch (err) {
                    console.error('Agora refresh failed', err);
                } finally {
                    refreshBtn.classList.remove('is-spinning');
                }
            });

            prevBtn?.addEventListener('click', () => {
                if (state.page <= 1 || state.loading) return;
                const prevPage = state.page - 1;
                const prevOffset = state.offsetByPage?.[prevPage];
                navigateWith({
                    page: prevPage,
                    offset: prevOffset != null ? prevOffset : Math.max(0, (prevPage - 1) * (state.limit || 50))
                });
            });
            const goNextPage = () => {
                if (!state.hasMore || state.loading) return;
                const nextOff = state.nextOffset;
                if (nextOff == null) return;
                navigateWith({ page: state.page + 1, offset: nextOff });
            };
            nextBtn?.addEventListener('click', goNextPage);
            root.querySelector('#exBottomNextBtn')?.addEventListener('click', goNextPage);
        } else if (mode === 'likes') {
            prevBtn?.addEventListener('click', () => {
                if (state.page <= 1 || state.loading) return;
                const prevPage = state.page - 1;
                const prevOffset = state.offsetByPage?.[prevPage];
                host.navigate(exploreBuildLikesUrl({
                    page: prevPage,
                    offset: prevOffset != null ? prevOffset : Math.max(0, (prevPage - 1) * (state.limit || 50))
                }));
            });
            nextBtn?.addEventListener('click', () => {
                if (!state.hasMore || state.loading || state.nextOffset == null) return;
                host.navigate(exploreBuildLikesUrl({
                    page: state.page + 1,
                    offset: state.nextOffset
                }));
            });
        } else {
            prevBtn?.addEventListener('click', () => {
                if (state.page <= 1 || state.loading) return;
                const prevPage = state.page - 1;
                const prevOffset = state.offsetByPage?.[prevPage];
                host.navigate(exploreBuildCreatorUrl({
                    creatorId: state.creatorId,
                    creatorName: state.creatorName,
                    page: prevPage,
                    offset: prevOffset != null ? prevOffset : Math.max(0, (prevPage - 1) * (state.limit || 50))
                }));
            });
            nextBtn?.addEventListener('click', () => {
                if (!state.hasMore || state.loading || state.nextOffset == null) return;
                host.navigate(exploreBuildCreatorUrl({
                    creatorId: state.creatorId,
                    creatorName: state.creatorName,
                    page: state.page + 1,
                    offset: state.nextOffset
                }));
            });
        }

        const grid = root.querySelector('#exGrid');
        grid?.addEventListener('click', (e) => {
            if (e.target.closest('[data-ex-like], [data-ex-down], [data-ex-react]')) return;
            const card = e.target.closest('[data-ex-id]');
            if (!card) return;
            e.preventDefault();
            host.navigate(exploreBuildDetailUrl(card.dataset.exId, state));
        });
    },

    _updatePager() {
        const state = this._state;
        if (!state) return;
        const root = state.host.getRoot();
        const prevBtn = root.querySelector('#exPrevBtn');
        const nextBtn = root.querySelector('#exNextBtn');
        const bottomPager = root.querySelector('#exBottomPager');
        const bottomNext = root.querySelector('#exBottomNextBtn');
        const indicator = root.querySelector('#exPageIndicator');
        const canNext = !!state.hasMore && !state.loading && state.nextOffset != null;
        if (prevBtn) prevBtn.disabled = state.page <= 1 || state.loading;
        if (nextBtn) nextBtn.disabled = !canNext;
        if (bottomNext) bottomNext.disabled = !canNext;
        if (bottomPager) bottomPager.classList.toggle('hidden', !state.hasMore);
        if (indicator) {
            indicator.textContent = `Page ${state.page}`;
        }
    },

    async _loadPage({ mode }) {
        const state = this._state;
        if (!state || state.loading) return;

        state.loading = true;
        this._updatePager();
        const root = state.host.getRoot();
        const loadingEl = root.querySelector('#exLoading');
        const emptyEl = root.querySelector('#exEmpty');
        const statusEl = root.querySelector('#exStatusText');
        const cacheEl = root.querySelector('#exCacheNote');
        const grid = root.querySelector('#exGrid');

        if (loadingEl) loadingEl.classList.remove('hidden');
        if (statusEl) statusEl.textContent = 'Loading…';
        if (grid) grid.innerHTML = '';

        try {
            if (!wsClient) throw new Error('WebSocket not connected');
            const payload = {
                offset: state.pageOffset || 0,
                page: state.page,
                forceRefresh: !!state.forceNext
            };
            if (mode === 'creator') {
                payload.creatorId = state.creatorId;
                payload.sort = 'new';
            } else if (mode === 'likes') {
                payload.likedBySelf = true;
            } else {
                payload.sort = state.sort;
                payload.period = state.period;
                payload.search = state.search;
            }
            state.forceNext = false;
            const data = await wsClient.sendMessage('get_novelai_explore_gallery', payload, false);
            const results = data?.results || [];
            const total = data?.pagination?.total ?? 0;
            const limit = data?.pagination?.limit || 50;
            const startOffset = data?.pagination?.offset != null
                ? data.pagination.offset
                : (state.pageOffset || 0);
            const nextOffset = data?.pagination?.nextOffset;
            const hasMore = data?.pagination?.hasMore != null
                ? !!data.pagination.hasMore
                : (results.length >= limit && (total <= 0 || nextOffset < total));

            state.results = results;
            state.byId = new Map(results.map((r) => [r.id, r]));
            state.total = total;
            state.limit = limit;
            state.pageOffset = startOffset;
            state.nextOffset = nextOffset != null ? nextOffset : null;
            state.hasMore = hasMore;
            if (!state.offsetByPage) state.offsetByPage = {};
            state.offsetByPage[state.page] = startOffset;
            state.lastMeta = data;

            if (grid) {
                for (const post of state.results) {
                    grid.appendChild(this._buildCard(post));
                }
            }

            if (emptyEl) emptyEl.classList.toggle('hidden', state.results.length > 0);
            if (statusEl) {
                statusEl.textContent = total
                    ? `${results.length} posts · page ${state.page}`
                    : `${results.length} posts`;
            }
            if (cacheEl) {
                if (data?.fromCache && data.cachedAt) {
                    const mins = Math.round((Date.now() - data.cachedAt) / 60000);
                    cacheEl.textContent = mins < 1 ? 'Cached just now' : `Cached ${mins}m ago`;
                } else {
                    cacheEl.textContent = data?.backfillPages > 1
                        ? `Live · filled ${data.backfillPages} pages`
                        : 'Live';
                }
            }
        } catch (err) {
            console.error('Agora load failed', err);
            if (statusEl) statusEl.textContent = err.message || 'Failed to load';
            if (emptyEl) emptyEl.classList.remove('hidden');
            if (mode === 'likes' && /not registered/i.test(String(err.message || ''))) {
                state.exploreUser = { registered: false, registerUrl: EXPLORE_REGISTER_URL };
                this._syncChromeButtons();
                showGlassToast('info', 'Agora', 'Register on NovelAI Explore to view likes', false, 4000);
            }
        } finally {
            state.loading = false;
            if (loadingEl) loadingEl.classList.add('hidden');
            this._updatePager();
        }
    },

    _buildCard(post) {
        const a = document.createElement('a');
        a.href = exploreBuildDetailUrl(post.id, this._state);
        a.className = 'ex-card';
        a.dataset.exId = post.id;
        const w = post.image?.width || 1;
        const h = post.image?.height || 1;
        const aspect = Math.max(0.5, Math.min(2.2, h / w));
        a.innerHTML = `
          <div class="ex-card-media" style="min-height:${Math.round(240 * aspect)}px">
            <img src="${exploreEscapeHtml(post.thumbnailUrl)}" alt="" loading="lazy" decoding="async"
              width="${w}" height="${h}">
            <div class="ex-card-wave" aria-hidden="true"></div>
          </div>
          <div class="ex-card-footer">
            <p class="ex-card-title">${exploreEscapeHtml(post.title || 'Untitled')}</p>
            <p class="ex-card-creator">${exploreEscapeHtml(post.creator?.name || 'unknown')}</p>
          </div>`;
        // NovelAI Explore tints footer/wave from image dominant hue (blurhash overlay on real site)
        exploreWireCardTint(a);
        // Prefer upstream blurhash for loading placeholder (public/scripts/comp/blurhashUtil.js)
        if (post.image?.blurhash) {
            applyBlurhashPlaceholder(a.querySelector('.ex-card-media'), post.image.blurhash);
        }
        return a;
    },

    _buildMoreCard(post) {
        const a = document.createElement('a');
        a.href = exploreBuildDetailUrl(post.id, this._state);
        a.className = 'ex-more-card';
        a.dataset.exId = post.id;
        a.innerHTML = `
          <img src="${exploreEscapeHtml(post.thumbnailUrl)}" alt="" loading="lazy" decoding="async">
          <div class="ex-more-card-cap">${exploreEscapeHtml(post.title || 'Untitled')}</div>`;
        return a;
    },

    async _fetchCreatorPosts(creatorId, { excludeId, limit = EXPLORE_CREATOR_ROW_MAX } = {}) {
        if (!creatorId || !wsClient) return [];
        const data = await wsClient.sendMessage('get_novelai_explore_gallery', {
            creatorId,
            sort: 'new',
            page: 1,
            limit
        }, false);
        const results = data?.results || [];
        return results.filter((r) => r.id !== excludeId).slice(0, limit);
    },

    _wireCreatorRow(host, rowEl, posts, creator) {
        const state = this._state;
        if (!rowEl) return;
        if (state.creatorRowObserver) {
            try { state.creatorRowObserver.disconnect(); } catch (_) { /* ignore */ }
        }

        const paint = () => {
            const n = exploreCreatorRowVisibleCount(rowEl.clientWidth);
            rowEl.innerHTML = '';
            for (const post of posts.slice(0, n)) {
                rowEl.appendChild(this._buildMoreCard(post));
            }
        };
        paint();
        if (typeof ResizeObserver === 'function') {
            state.creatorRowObserver = new ResizeObserver(() => paint());
            state.creatorRowObserver.observe(rowEl);
        }

        rowEl.addEventListener('click', (e) => {
            const card = e.target.closest('[data-ex-id]');
            if (!card) return;
            e.preventDefault();
            host.navigate(exploreBuildDetailUrl(card.dataset.exId, {
                ...state,
                creatorId: creator?.id || state.creatorId,
                creatorName: creator?.name || state.creatorName
            }));
        });
    },

    async _renderDetail(host) {
        const state = this._state;
        const root = host.getRoot();
        const view = root.querySelector('#exViewRoot') || root;
        const id = state.detailId;

        view.innerHTML = `
          <div class="ex-detail-page">
            ${exploreDetailNavHtml(state)}
            <div class="ex-loading" id="exDetailLoading">Loading image…</div>
            <div id="exDetailContent" class="hidden"></div>
          </div>`;

        root.querySelector('#exBackBtn')?.addEventListener('click', () => {
            if (state.backLikesMode) {
                host.navigate(exploreBuildLikesUrl({ page: state.page }));
            } else if (state.backCreatorId) {
                host.navigate(exploreBuildCreatorUrl({
                    creatorId: state.backCreatorId,
                    creatorName: state.backCreatorName,
                    page: state.page
                }));
            } else {
                host.navigate(exploreBuildGalleryUrl(state));
            }
        });

        let post = state.byId.get(id) || null;
        try {
            if (wsClient) {
                const ensured = await wsClient.sendMessage('ensure_novelai_explore_image', {
                    id,
                    kind: 'blob'
                }, false);
                if (ensured?.post) post = ensured.post;
                if (ensured?.publicUrl && post) {
                    post.blobUrl = ensured.publicUrl;
                    post.blobReady = true;
                }
            }
        } catch (err) {
            console.warn('Agora ensure blob', err);
        }

        // Like counts work without Explore registration (GET /post/:id)
        try {
            if (wsClient) {
                const live = await wsClient.sendMessage('get_novelai_explore_post', { id }, false);
                if (live?.id) {
                    const prev = post || {};
                    post = {
                        ...prev,
                        ...live,
                        thumbnailUrl: prev.thumbnailUrl || live.thumbnailUrl,
                        blobUrl: prev.blobUrl || live.blobUrl,
                        thumbReady: prev.thumbReady || live.thumbReady,
                        blobReady: prev.blobReady || live.blobReady,
                        like_count: live.like_count,
                        liked_by_self: live.liked_by_self
                    };
                }
            }
        } catch (err) {
            console.warn('Agora post like_count', err);
        }

        const loading = root.querySelector('#exDetailLoading');
        const content = root.querySelector('#exDetailContent');
        if (!post) {
            if (loading) loading.textContent = 'Post not found. Go back and open again.';
            return;
        }

        state.byId.set(post.id, post);
        const parsed = exploreParseNaiMetadata(post.image?.nai_metadata);
        const promptText = parsed?.prompt || '';
        const ucText = parsed?.uc || '';
        const charLines = exploreCharacterPromptLines(parsed);
        const modelLabel = exploreFormatModelLabel(parsed);
        const dateLabel = exploreFormatDate(post.created_at);
        const byBits = [
            post.creator?.name
                ? `by <button type="button" class="ex-creator-link" id="exCreatorLink">${exploreEscapeHtml(post.creator.name)}</button>`
                : null,
            modelLabel ? exploreEscapeHtml(modelLabel) : null,
            dateLabel ? exploreEscapeHtml(dateLabel) : null
        ].filter(Boolean);

        const charHtml = charLines.map((c, i) => `
          <div class="ex-char-block">
            <p class="ex-char-title">Character ${i + 1}</p>
            <div class="ex-prompt-block">
              <div class="ex-prompt-head">
                <span class="ex-prompt-label">Prompt</span>
                <button type="button" class="ex-copy-btn" data-copy="${exploreCopyAttr(c.prompt)}" title="Copy"><i class="fas fa-copy"></i></button>
              </div>
              ${exploreRenderEmphasisPrompt(c.prompt)}
            </div>
            ${c.uc ? `
            <div class="ex-prompt-block">
              <div class="ex-prompt-head">
                <span class="ex-prompt-label">Undesired Content</span>
                <button type="button" class="ex-copy-btn" data-copy="${exploreCopyAttr(c.uc)}" title="Copy"><i class="fas fa-copy"></i></button>
              </div>
              ${exploreRenderEmphasisPrompt(c.uc)}
            </div>` : `
            <div class="ex-prompt-block">
              <span class="ex-prompt-label">Undesired Content</span>
              <span class="ex-tag-empty">—</span>
            </div>`}
          </div>`).join('');

        if (loading) loading.classList.add('hidden');
        if (content) {
            content.classList.remove('hidden');
            content.innerHTML = `
              <div class="ex-detail-card">
                <div class="ex-detail-media">
                  <img src="${exploreEscapeHtml(post.blobUrl || post.thumbnailUrl)}" alt="${exploreEscapeHtml(post.title || '')}">
                </div>
                <div class="ex-detail-side">
                  <div class="ex-detail-side-gears" aria-hidden="true">
                    ${exploreGearSvg('ex-gear-detail-lg')}
                    ${exploreGearSvg('ex-gear-detail-sm')}
                  </div>
                  <div class="ex-detail-side-inner">
                    <div class="ex-detail-header">
                      <h2 class="ex-detail-title">${exploreEscapeHtml(post.title || 'Untitled')}</h2>
                      <p class="ex-detail-byline">${byBits.join('<span>·</span>')}</p>
                      <div class="ex-detail-actions">
                        <button type="button" class="ex-detail-btn primary" id="exOpenEditorBtn">
                          <i class="fas fa-compass-drafting"></i> Open in Studio
                        </button>
                        <div class="ex-detail-actions-icons" data-ex-react="${exploreEscapeHtml(post.id)}">
                          ${exploreDetailReactIconsHtml(post, state)}
                          <button type="button" class="ex-detail-btn icon-only" id="exImportWorkspaceBtn" title="Import PNG (with metadata) to active workspace" aria-label="Import to Workspace">
                            <i class="fas fa-file-import"></i>
                          </button>
                          <button type="button" class="ex-detail-btn icon-only" id="exCopyImageBtn" title="Copy PNG to clipboard" aria-label="Copy Image">
                            <i class="fas fa-copy"></i>
                          </button>
                          <button type="button" class="ex-detail-btn icon-only" id="exDownloadImageBtn" title="Download PNG with metadata" aria-label="Download">
                            <i class="fas fa-download"></i>
                          </button>
                        </div>
                      </div>
                    </div>
                    <div class="ex-detail-scroll">
                      <div class="ex-prompt-block">
                        <div class="ex-prompt-head">
                          <span class="ex-prompt-label">Prompt</span>
                          <button type="button" class="ex-copy-btn" data-copy="${exploreCopyAttr(promptText)}" title="Copy"><i class="fas fa-copy"></i></button>
                        </div>
                        ${exploreRenderEmphasisPrompt(promptText)}
                      </div>
                      <div class="ex-prompt-block">
                        <div class="ex-prompt-head">
                          <span class="ex-prompt-label">Undesired Content</span>
                          <button type="button" class="ex-copy-btn" data-copy="${exploreCopyAttr(ucText)}" title="Copy"><i class="fas fa-copy"></i></button>
                        </div>
                        <button type="button" class="ex-expand-btn" id="exUcExpand" ${ucText ? '' : 'hidden'}>
                          <i class="fas fa-chevron-down"></i> Expand
                        </button>
                        <div class="ex-uc-block" id="exUcTags" hidden>${exploreRenderEmphasisPrompt(ucText)}</div>
                        ${ucText ? '' : '<span class="ex-tag-empty">—</span>'}
                      </div>
                      ${charHtml}
                    </div>
                    <div class="ex-stats-bar">
                      <div class="ex-stat"><span class="ex-stat-label">Steps</span><span class="ex-stat-value">${exploreEscapeHtml(parsed?.steps ?? '—')}</span></div>
                      <div class="ex-stat"><span class="ex-stat-label">Guidance</span><span class="ex-stat-value">${exploreEscapeHtml(parsed?.scale ?? '—')}</span></div>
                      <div class="ex-stat"><span class="ex-stat-label">Seed</span><span class="ex-stat-value">${exploreEscapeHtml(parsed?.seed ?? '—')}</span></div>
                      <div class="ex-stat"><span class="ex-stat-label">Sampler</span><span class="ex-stat-value">${exploreEscapeHtml(exploreFormatSampler(parsed?.sampler))}</span></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="ex-more-section" id="exMoreBySection" hidden>
                <h3 class="ex-more-title">More by this creator</h3>
                <div class="ex-more-row" id="exMoreByRow"></div>
                <div class="ex-show-all-wrap">
                  <button type="button" class="ex-show-all-btn" id="exShowAllCreator">Show all</button>
                </div>
              </div>`;
        }

        root.querySelector('#exOpenEditorBtn')?.addEventListener('click', () => {
            exploreOpenInEditor(post);
        });
        root.querySelector('#exImportWorkspaceBtn')?.addEventListener('click', () => {
            exploreImportToWorkspace(post);
        });
        root.querySelector('#exCopyImageBtn')?.addEventListener('click', () => {
            exploreCopyRawImage(post);
        });
        root.querySelector('#exDownloadImageBtn')?.addEventListener('click', () => {
            exploreDownloadRawImage(post);
        });

        // openImageInViewer: public/scripts/comp/imageViewer.js (Lumen)
        root.querySelector('.ex-detail-media img')?.addEventListener('click', () => {
            const src = post.blobUrl || post.thumbnailUrl;
            if (!src) return;
            openImageInViewer(src, post.title || 'Agora', {
                url: src,
                genericExternalImage: true
            });
        });

        root.querySelector('#exCreatorLink')?.addEventListener('click', () => {
            if (!post.creator?.id) return;
            host.navigate(exploreBuildCreatorUrl({
                creatorId: post.creator.id,
                creatorName: post.creator.name || ''
            }));
        });

        root.querySelector('#exUcExpand')?.addEventListener('click', (e) => {
            const tags = root.querySelector('#exUcTags');
            const btn = e.currentTarget;
            if (!tags) return;
            const open = tags.hasAttribute('hidden');
            if (open) tags.removeAttribute('hidden');
            else tags.setAttribute('hidden', '');
            btn.innerHTML = open
                ? '<i class="fas fa-chevron-up"></i> Collapse'
                : '<i class="fas fa-chevron-down"></i> Expand';
        });

        content?.querySelectorAll('[data-copy]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const enc = btn.getAttribute('data-copy') || '';
                let text = '';
                try { text = decodeURIComponent(enc); } catch (_) { text = enc; }
                try {
                    await navigator.clipboard.writeText(text);
                    showGlassToast('success', 'Agora', 'Copied', false, 1500);
                } catch (_) {
                    showGlassToast('error', 'Agora', 'Copy failed', false, 2500);
                }
            });
        });

        // More by this creator — only when there is at least one other post
        const moreSection = root.querySelector('#exMoreBySection');
        if (moreSection) moreSection.hidden = true;
        if (post.creator?.id) {
            try {
                const more = await this._fetchCreatorPosts(post.creator.id, {
                    excludeId: post.id,
                    limit: EXPLORE_CREATOR_ROW_MAX
                });
                const section = root.querySelector('#exMoreBySection');
                const row = root.querySelector('#exMoreByRow');
                const showAll = root.querySelector('#exShowAllCreator');
                if (more.length > 0 && section && row) {
                    section.hidden = false;
                    this._wireCreatorRow(host, row, more, post.creator);
                    showAll?.addEventListener('click', () => {
                        host.navigate(exploreBuildCreatorUrl({
                            creatorId: post.creator.id,
                            creatorName: post.creator.name || ''
                        }));
                    });
                    if (showAll) {
                        showAll.textContent = `Show all from ${post.creator.name || 'creator'}`;
                    }
                }
            } catch (err) {
                console.warn('Agora more-by-creator', err);
            }
        }
    }
};

(function registerExploreDsap() {
    if (typeof registerDsap !== 'function') return;
    registerDsap({
        url: EXPLORE_DSAP_URL,
        aliases: [
            `dsap://${EXPLORE_DSAP_URL}`,
            'novelai.net/explore/gallery',
            'novelai.net/explore',
            'applet.novelai.net/explore',
            'en.grimoire.jp/applets/explore',
            'applet.grimoire.jp/explore'
        ],
        title: 'Agora',
        getContent() {
            return {
                html: exploreBuildShellHtml(),
                css: exploreDsapScopedCss,
                baseBackground: '#0c1224',
                drivers: {
                    init(host) { exploreDsapDriver.init(host); },
                    refresh(host) { exploreDsapDriver.refresh(host); },
                    destroy(host) { exploreDsapDriver.destroy(host); }
                }
            };
        }
    });
})();
