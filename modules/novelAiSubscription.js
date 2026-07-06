/**
 * NovelAI subscription normalization for account data used by pricing UI.
 * image.novelai.net /user/data and /user/subscription omit image-generation perk
 * fields (unlimitedImageGenerationLimits) that api.novelai.net used to return.
 */

/** @type {Record<number, Array<{ resolution: number, maxPrompts: number }>>} */
const IMAGE_GEN_FREE_LIMITS_BY_TIER = {
    // Paper free trial — 30 images up to 1024×1024 (docs.novelai.net/en/subscription/)
    0: [{ resolution: 1048576, maxPrompts: 30 }],
    // Opus — unlimited single images ≤ Normal size (1MP) at ≤28 steps
    3: [{ resolution: 1048576, maxPrompts: 999999 }],
};

/**
 * Ensure subscription.perks.unlimitedImageGenerationLimits exists when tier entitles free gens.
 * @param {object|null|undefined} subscription
 * @returns {object|null|undefined}
 */
function normalizeNovelAiSubscription(subscription) {
    if (!subscription || typeof subscription !== 'object') {
        return subscription;
    }

    const sub = { ...subscription };
    const perks = sub.perks && typeof sub.perks === 'object' ? { ...sub.perks } : {};
    const existing = perks.unlimitedImageGenerationLimits;

    if (Array.isArray(existing) && existing.length > 0) {
        return { ...sub, perks };
    }

    const tier = sub.tier;
    const tierLimits = tier != null ? IMAGE_GEN_FREE_LIMITS_BY_TIER[tier] : null;
    if (tierLimits && sub.active !== false) {
        perks.unlimitedImageGenerationLimits = tierLimits.map(entry => ({ ...entry }));
    }

    return { ...sub, perks };
}

module.exports = {
    normalizeNovelAiSubscription,
    IMAGE_GEN_FREE_LIMITS_BY_TIER,
};
