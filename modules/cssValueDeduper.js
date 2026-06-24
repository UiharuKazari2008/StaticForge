/**
 * Conservative CSS literal deduplication pre-pass for workspace/static CSS.
 * Groups semantically equivalent or near-identical color/spacing literals into
 * shared custom properties before Lightning CSS minification.
 *
 * Limitations:
 * - Only processes declaration values (not at-rules, selectors, or url()/var() contents).
 * - Colors: exact match after normalization, or RGB distance within tolerance (default 2%).
 * - Spacing: exact match only (px/rem/em/%); no cross-unit merging.
 * - Requires 3+ occurrences before replacing (avoids noise on one-off values).
 * - Skips values inside existing var(), calc(), or custom-property definitions.
 * - May change cascade if identical literals were intentionally distinct (rare).
 */

const COLOR_PATTERNS = [
    /#[0-9a-fA-F]{3,8}\b/g,
    /\brgba?\([^)]+\)/gi,
    /\bhsla?\([^)]+\)/gi
];

const SPACING_PATTERN = /\b\d*\.?\d+(?:px|rem|em|%)\b/g;

const DEFAULT_COLOR_TOLERANCE = 0.02;

function normalizeHex(hex) {
    let h = hex.replace('#', '').toLowerCase();
    if (h.length === 3) {
        h = h.split('').map((c) => c + c).join('');
    }
    if (h.length === 8) {
        h = h.slice(0, 6);
    }
    return h;
}

function hexToRgb(hex) {
    const n = normalizeHex(hex);
    if (n.length !== 6) return null;
    return {
        r: parseInt(n.slice(0, 2), 16),
        g: parseInt(n.slice(2, 4), 16),
        b: parseInt(n.slice(4, 6), 16)
    };
}

function parseSimpleRgb(str) {
    const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
}

function colorKey(value) {
    const v = value.trim();
    if (v.startsWith('#')) {
        const rgb = hexToRgb(v);
        return rgb ? `hex:${normalizeHex(v)}` : null;
    }
    const rgb = parseSimpleRgb(v);
    if (rgb) {
        return `rgb:${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)}`;
    }
    return `raw:${v.toLowerCase()}`;
}

function rgbDistance(a, b) {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return Math.sqrt(dr * dr + dg * dg + db * db) / 441.67295593;
}

function colorsSimilar(a, b, tolerance) {
    const ka = colorKey(a);
    const kb = colorKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    const ra = a.startsWith('#') ? hexToRgb(a) : parseSimpleRgb(a);
    const rb = b.startsWith('#') ? hexToRgb(b) : parseSimpleRgb(b);
    if (!ra || !rb) return false;
    return rgbDistance(ra, rb) <= tolerance;
}

function collectLiterals(source, pattern, normalizeFn) {
    const counts = new Map();
    let match;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((match = re.exec(source)) !== null) {
        const raw = match[0];
        if (raw.includes('var(')) continue;
        const key = normalizeFn ? normalizeFn(raw) : raw;
        if (!counts.has(key)) {
            counts.set(key, { canonical: raw, count: 0, variants: new Set() });
        }
        const entry = counts.get(key);
        entry.count++;
        entry.variants.add(raw);
    }
    return counts;
}

function clusterColors(source, tolerance) {
    const re = new RegExp(
        `${COLOR_PATTERNS.map((p) => p.source).join('|')}`,
        'gi'
    );
    const seen = new Map();
    const literals = [];
    let match;
    while ((match = re.exec(source)) !== null) {
        const raw = match[0];
        if (raw.includes('var(')) continue;
        literals.push(raw);
    }

    const clusters = [];
    for (const literal of literals) {
        let placed = false;
        for (const cluster of clusters) {
            if (colorsSimilar(literal, cluster.canonical, tolerance)) {
                cluster.count++;
                cluster.variants.add(literal);
                placed = true;
                break;
            }
        }
        if (!placed) {
            clusters.push({
                canonical: literal,
                count: 1,
                variants: new Set([literal])
            });
        }
    }
    return clusters.filter((c) => c.count >= 3);
}

function clusterSpacing(source) {
    const counts = collectLiterals(source, SPACING_PATTERN, (v) => v);
    return [...counts.values()].filter((entry) => entry.count >= 3);
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace literals only inside `{...}` rule bodies — never in @media preludes or selectors. */
function replaceLiteralsInStyleBlocks(source, variant, varName) {
    const replacement = `var(${varName})`;
    const variantRe = new RegExp(escapeRegExp(variant), 'g');
    let result = '';
    let i = 0;

    while (i < source.length) {
        const open = source.indexOf('{', i);
        if (open === -1) {
            result += source.slice(i);
            break;
        }
        result += source.slice(i, open + 1);
        let depth = 1;
        let j = open + 1;
        while (j < source.length && depth > 0) {
            const ch = source[j];
            if (ch === '{') {
                depth++;
            } else if (ch === '}') {
                depth--;
            }
            j++;
        }
        const body = source.slice(open + 1, j - 1);
        result += body.replace(variantRe, replacement);
        result += '}';
        i = j;
    }
    return result;
}

function applyDedupClusters(source, clusters, prefix) {
    if (!clusters.length) {
        return { css: source, variables: [] };
    }

    const variables = [];
    let output = source;
    let index = 0;

    for (const cluster of clusters) {
        const varName = `--${prefix}-${index++}`;
        variables.push(`${varName}: ${cluster.canonical};`);
        for (const variant of cluster.variants) {
            output = replaceLiteralsInStyleBlocks(output, variant, varName);
        }
    }

    if (!variables.length) {
        return { css: source, variables: [] };
    }

    const block = `:root {\n  ${variables.join('\n  ')}\n}\n\n`;
    return { css: block + output, variables };
}

function dedupeCssLiterals(source, options = {}) {
    if (!source || typeof source !== 'string') {
        return { css: source || '', dedupedCount: 0 };
    }

    const tolerance = options.colorTolerance != null
        ? options.colorTolerance
        : DEFAULT_COLOR_TOLERANCE;
    const enableColors = options.colors !== false;
    const enableSpacing = options.spacing !== false;

    let css = source;
    let dedupedCount = 0;

    if (enableColors) {
        const colorClusters = clusterColors(css, tolerance);
        const colorResult = applyDedupClusters(css, colorClusters, 'sf-color');
        css = colorResult.css;
        dedupedCount += colorResult.variables.length;
    }

    if (enableSpacing) {
        const spacingClusters = clusterSpacing(css);
        const spacingResult = applyDedupClusters(css, spacingClusters, 'sf-space');
        css = spacingResult.css;
        dedupedCount += spacingResult.variables.length;
    }

    return { css, dedupedCount };
}

module.exports = {
    dedupeCssLiterals,
    DEFAULT_COLOR_TOLERANCE
};
