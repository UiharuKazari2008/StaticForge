/**
 * Autofill tag search backed by the unified tag wiki database (TagLookup).
 * Prompt autocomplete local results — does not use animeTagSearch/furryTagSearch JSON indexes.
 */

const ANIME_LOCAL_SERVICE = 'anime-local';
const FURRY_LOCAL_SERVICE = 'furry-local';
const DEFAULT_SEARCH_LIMIT = 35;

class TagAutofillSearch {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('TagAutofillSearch requires globalResources instance and should only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
    }

    getTagLookup() {
        return this.globalResources.getTagDatabase();
    }

    getDatasetSources(tag) {
        const sources = [];
        if (tag.d_count > 0) sources.push('danbooru');
        if (tag.e_count > 0) sources.push('e621');
        if (tag.n_count > 0) sources.push('novelai');
        return sources;
    }

    normalizeAutofillScore(tag, index) {
        if (typeof tag.searchScore === 'number' && Number.isFinite(tag.searchScore)) {
            return Math.min(100, Math.max(40, Math.round(tag.searchScore / 6)));
        }
        return Math.max(100 - index * 3, 40);
    }

    async searchTags(query, options = {}) {
        const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
        const trimmed = (query || '').trim();
        if (trimmed.length < 2) {
            return [];
        }

        const tagLookup = this.getTagLookup();
        const rows = await tagLookup.searchTags(trimmed, { limit });
        await tagLookup.attachPrimaryBodyPreviews(rows);

        return rows.map((tag, index) => this.buildAutofillTag(tag, index));
    }

    buildAutofillTag(tag, index) {
        const datasets = this.getDatasetSources(tag);
        const score = this.normalizeAutofillScore(tag, index);
        const matchTier = typeof tag.matchTier === 'number' ? tag.matchTier : 0;
        const matchCoverage = typeof tag.matchCoverage === 'number' ? tag.matchCoverage : 0;

        return {
            type: 'tag',
            id: tag.id,
            title: tag.title,
            name: tag.name,
            category: tag.category,
            categoryName: tag.categoryName,
            d_count: tag.d_count,
            e_count: tag.e_count,
            n_count: tag.n_count,
            n: tag.n,
            datasets,
            hasWiki: !!tag.hasWiki,
            wikiSources: tag.wikiSources || [],
            primaryBody: tag.primaryBody || '',
            rank: index,
            score,
            matchTier,
            matchCoverage,
            textMatchInfo: {
                tier: matchTier,
                matchCoverage,
                isExactMatch: matchTier === 4,
                isPrefixMatch: matchTier >= 3
            }
        };
    }

    /**
     * Split unified TagLookup results into anime-local / furry-local WS streams.
     * Tags with both d_count and e_count appear in both lists.
     * NovelAI-only tags (no d/e counts) go to the anime stream (legacy JSON behavior).
     */
    splitLocalServices(tags) {
        const anime = [];
        const furry = [];

        for (const tag of tags) {
            const dCount = tag.d_count || 0;
            const eCount = tag.e_count || 0;

            if (dCount > 0 || (dCount === 0 && eCount === 0)) {
                anime.push(this.formatLocalServiceTag(tag, ANIME_LOCAL_SERVICE, anime.length));
            }
            if (eCount > 0) {
                furry.push(this.formatLocalServiceTag(tag, FURRY_LOCAL_SERVICE, furry.length));
            }
        }

        return { anime, furry };
    }

    formatLocalServiceTag(tag, serviceName, index) {
        return {
            ...tag,
            type: 'tag',
            source: serviceName,
            serviceName,
            model: serviceName,
            rank: index,
            score: tag.score || Math.max(100 - index * 3, 40)
        };
    }

    formatWebSocketResult(tag, index, searchModel) {
        return {
            ...tag,
            searchModel,
            serviceOrder: 0,
            resultOrder: index
        };
    }

    getAnimeLocalServiceName() {
        return ANIME_LOCAL_SERVICE;
    }

    getFurryLocalServiceName() {
        return FURRY_LOCAL_SERVICE;
    }
}

module.exports = TagAutofillSearch;
module.exports.ANIME_LOCAL_SERVICE = ANIME_LOCAL_SERVICE;
module.exports.FURRY_LOCAL_SERVICE = FURRY_LOCAL_SERVICE;
module.exports.DEFAULT_SEARCH_LIMIT = DEFAULT_SEARCH_LIMIT;
