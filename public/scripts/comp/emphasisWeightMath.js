// Emphasis weight/share constants and math

const EMPHASIS_WEIGHT_MIN = -6;
const EMPHASIS_WEIGHT_MAX = 6;
const EMPHASIS_WEIGHT_STEP = 0.1;
const EMPHASIS_WEIGHT_FINE_STEP = 0.01;
const EMPHASIS_NORMALIZE_WEIGHT_STEP = 0.001;
const EMPHASIS_NORMALIZE_WEIGHT_FINE_STEP = 0.0001;
const DISABLE_SYNTAX_HIGHLIGHT = {
    background: 'rgba(175, 175, 175, 0.92)',
    border: 'rgba(231, 231, 231, 0.95)'
};
const NSFW_TAG_HIGHLIGHT = {
    background: 'transparent',
    ring: 'rgba(255, 73, 221, 0.88)'
};

function clampEmphasisWeight(value) {
    const n = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(n)) return 1.0;
    const clamped = Math.max(EMPHASIS_WEIGHT_MIN, Math.min(EMPHASIS_WEIGHT_MAX, n));
    return Math.round(clamped * 100) / 100;
}

function formatEmphasisWeight(value) {
    if (value === '---') return '---';
    // Auto precision up to 2 decimals: 1, 1.3, 1.54 (not 1.00, 1.30)
    return String(parseFloat(clampEmphasisWeight(value).toFixed(2)));
}

/** Toolbar display: always 1 decimal; 2 when value uses 0.01 precision. */
function formatEmphasisWeightDisplay(value) {
    if (value === '---') return '---';
    const n = clampEmphasisWeight(value);
    const oneDecimal = Math.round(n * 10) / 10;
    const twoDecimal = Math.round(n * 100) / 100;
    if (Math.abs(twoDecimal - oneDecimal) > 0.0001) {
        return twoDecimal.toFixed(2);
    }
    return oneDecimal.toFixed(1);
}

function clampEmphasisWeightNormalize(value) {
    const n = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(n)) return 1.0;
    const clamped = Math.max(EMPHASIS_WEIGHT_MIN, Math.min(EMPHASIS_WEIGHT_MAX, n));
    return Math.round(clamped * 10000) / 10000;
}

function formatEmphasisWeightNormalize(value) {
    if (value === '---') return '---';
    return String(parseFloat(clampEmphasisWeightNormalize(value).toFixed(4)));
}

function isEligibleForEmphasisNormalize(weight) {
    if (weight === '---') return false;
    const w = typeof weight === 'number' ? weight : parseFloat(weight);
    return !isNaN(w) && w >= 1;
}

function formatEmphasisNormalizeDisplay(share, weight) {
    const shareText = formatEmphasisShareDisplay(share);
    return `${shareText}% (${formatEmphasisWeightNormalize(weight)})`;
}

function clampEmphasisShare(share) {
    const n = typeof share === 'string' ? parseFloat(share) : share;
    if (!Number.isFinite(n)) return 0;
    return Math.round(Math.max(0, Math.min(100, n)) * 1000000) / 1000000;
}

function formatEmphasisShareDisplay(share) {
    const n = clampEmphasisShare(share);
    const oneDecimal = Math.round(n * 10) / 10;
    if (Math.abs(n - Math.round(n)) < 0.000001) {
        return String(Math.round(n));
    }
    return oneDecimal.toFixed(1);
}

/**
 * Attention-equalizing Weight Rack math.
 *
 * Background (A1111 #2905, Apatero/AI Wiki 2025, Tensor.Art, mean-normalize embed pipelines):
 * - Emphasis multiplies token embeddings; every token in a long group already claims budget.
 * - Mapping share ∝ token% therefore double-boosts long phrases and starves short anchors.
 * - NovelAI numeric emphasis is comfortable around 2–3; higher still risks muddling when
 *   many groups compete. Auto Band targets that NAI-safe working band.
 * - Auto shares (Attention Rescale) use soft inverse-√length so short concepts keep a floor;
 *   top weight (Auto Band) widens gently with group count / length skew / prompt coverage.
 */
const EMPHASIS_AUTO_TOP_MIN = 2.0;
const EMPHASIS_AUTO_TOP_MAX = 3.0;
/** Blend: equal prior vs soft inverse-√tokens (higher = more length compensation). */
const EMPHASIS_AUTO_LENGTH_COMPENSATION = 0.62;
/** Keep every group at least this fraction of an equal share before renorm. */
const EMPHASIS_AUTO_SHARE_FLOOR_FRAC = 0.42;

function normalizeEmphasisShareArray(scores) {
    const safe = (scores || []).map((v) => Math.max(0, Number(v) || 0));
    const sum = safe.reduce((s, v) => s + v, 0);
    if (sum <= 0) {
        const n = safe.length;
        if (!n) return [];
        const each = 100 / n;
        return safe.map(() => clampEmphasisShare(each));
    }
    return safe.map((v) => clampEmphasisShare((v / sum) * 100));
}

/**
 * Soft-equalize group importance so short concept anchors are not forgotten.
 * Returns relative shares among the active groups (sum ≈ 100).
 */
function computeAttentionEqualizedRelativeImportances(groupTokenCounts) {
    const counts = (groupTokenCounts || []).map((n) => Math.max(1, Number(n) || 1));
    const n = counts.length;
    if (!n) return [];

    const invSqrt = counts.map((c) => 1 / Math.sqrt(c));
    const lengthShares = normalizeEmphasisShareArray(invSqrt);
    const equalShare = 100 / n;
    const blended = lengthShares.map((lenShare) =>
        (1 - EMPHASIS_AUTO_LENGTH_COMPENSATION) * equalShare
        + EMPHASIS_AUTO_LENGTH_COMPENSATION * lenShare
    );

    const floor = equalShare * EMPHASIS_AUTO_SHARE_FLOOR_FRAC;
    const floored = blended.map((s) => Math.max(floor, s));
    return normalizeEmphasisShareArray(floored);
}

/**
 * Ideal top weight for auto wand / rebalance — keeps peak emphasis in a safe working band.
 */
function computeIdealMaxWeightForEmphasisGroups(relativeImportances, activeIndices, groupTokenCounts, globalTokens) {
    const active = activeIndices && activeIndices.length ? activeIndices : [];
    const n = active.length;
    if (!n) return 1;

    const counts = Array.isArray(groupTokenCounts) && groupTokenCounts.length === n
        ? groupTokenCounts.map((c) => Math.max(1, Number(c) || 1))
        : null;
    const global = Math.max(1, Number(globalTokens) || 1);
    const groupTokenTotal = counts
        ? counts.reduce((s, c) => s + c, 0)
        : 0;
    const coverage = Math.min(1, groupTokenTotal / global);

    if (n === 1) {
        const frac = counts ? Math.min(1, counts[0] / global) : 0.2;
        // Lone short group in a long prompt needs a bit more lift vs dense clause.
        const ideal = 2.05 + Math.min(0.55, (1 - frac) * 0.7);
        return clampEmphasisWeightNormalize(
            Math.max(EMPHASIS_AUTO_TOP_MIN, Math.min(EMPHASIS_AUTO_TOP_MAX, ideal))
        );
    }

    // NAI-safe expansion with competing groups — room to rank without overcooking.
    let ideal = 2.1 + Math.min(0.55, (n - 1) * 0.12);

    if (counts) {
        const maxC = Math.max(...counts);
        const minC = Math.min(...counts);
        if (maxC > minC) {
            const skew = maxC / minC;
            // log2 grows slowly: 2× → ~0.12, 8× → ~0.3, 32× → ~0.45
            ideal += Math.min(0.45, Math.log2(skew) * 0.14);
        }
    }

    // Dense weighted coverage: short anchors need slightly higher peak to punch through.
    ideal += Math.min(0.25, coverage * 0.25);

    // Soften when shares are nearly flat (little ranking work needed).
    if (Array.isArray(relativeImportances) && relativeImportances.length === n) {
        const sum = relativeImportances.reduce((s, v) => s + (Number(v) || 0), 0);
        if (sum > 0) {
            const maxShare = Math.max(...relativeImportances.map((v) => ((Number(v) || 0) / sum) * 100));
            const equal = 100 / n;
            const spread = Math.max(0, maxShare - equal);
            ideal -= Math.min(0.2, (1 - Math.min(1, spread / equal)) * 0.15);
        }
    }

    return clampEmphasisWeightNormalize(
        Math.max(EMPHASIS_AUTO_TOP_MIN, Math.min(EMPHASIS_AUTO_TOP_MAX, ideal))
    );
}

/** Canonical ideal max for auto wand / rebalance — always from distribution when present. */
function resolveIdealMaxWeightFromDistribution(dist, activeIndices) {
    const active = activeIndices && activeIndices.length ? activeIndices : [];
    if (!active.length) return 1;
    if (Array.isArray(dist?.relativeImportances) && dist.relativeImportances.length === active.length) {
        const counts = Array.isArray(dist.groupTokenCounts) && dist.groupTokenCounts.length === active.length
            ? dist.groupTokenCounts
            : null;
        return computeIdealMaxWeightForEmphasisGroups(
            dist.relativeImportances,
            active,
            counts,
            dist.globalTokens
        );
    }
    const fallback = Number(dist?.idealMaxWeight);
    return Number.isFinite(fallback)
        ? Math.max(EMPHASIS_AUTO_TOP_MIN, Math.min(EMPHASIS_AUTO_TOP_MAX, fallback))
        : 2.5;
}

/**
 * Token-count distribution for Weight Rack auto-calculate / rebalance.
 * importances = each group's % of full prompt (diagnostic / coverage).
 * relativeImportances = attention-equalized ranks among weighted groups (sum ~100).
 */
function computeEmphasisDistributionFromTokenCounts(groupTokenCounts, globalTokens, options = {}) {
    const active = options.activeIndices && options.activeIndices.length
        ? options.activeIndices
        : (groupTokenCounts || []).map((_, i) => i);
    if (!active.length) {
        return {
            globalTokens: 1,
            groupTokenCounts: [],
            groupTokenTotal: 0,
            importances: [],
            relativeImportances: [],
            idealMaxWeight: 1
        };
    }

    const global = Math.max(1, globalTokens);
    const counts = (groupTokenCounts || []).map((n) => Math.max(1, Number(n) || 1));
    const groupTokenTotal = counts.reduce((sum, n) => sum + n, 0);

    const importances = counts.map((n) => clampEmphasisShare((n / global) * 100));
    // Attention-equalized ranks (not raw token%) — prevents long groups from starving short ones.
    const relativeImportances = computeAttentionEqualizedRelativeImportances(counts);
    const idealMaxWeight = computeIdealMaxWeightForEmphasisGroups(
        relativeImportances,
        active,
        counts,
        global
    );

    return {
        globalTokens: global,
        groupTokenCounts: counts,
        groupTokenTotal,
        importances,
        relativeImportances,
        idealMaxWeight
    };
}

/** Map relative importance (0–100 among groups) to weight in [1, topWeight]. */
function emphasisWeightFromRelativeImportance(relativeImportance, topWeight) {
    const top = clampEmphasisWeightNormalize(Math.max(1, topWeight));
    const rel = clampEmphasisShare(relativeImportance);
    return clampEmphasisWeightNormalize(1 + (rel / 100) * (top - 1));
}

function getEmphasisAdjustStep(shiftKey) {
    return shiftKey ? EMPHASIS_WEIGHT_FINE_STEP : EMPHASIS_WEIGHT_STEP;
}
