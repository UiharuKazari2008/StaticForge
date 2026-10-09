const assert = require('assert');
const explore = require('../modules/novelaiExploreGallery');
const { _test } = require('../modules/mcpAgentFacade');

const QUERIES = [
    ['mutual hug', 'mutual_hug'],
    ['double hand grab', 'double_hand_grab'],
    ['fingers interlaced', 'fingers_interlaced'],
    ['cicada', 'cicada'],
    ['clinging', 'clinging'],
    ['arms around neck', 'arms_around_neck']
];

assert.deepStrictEqual(explore.EXPLORE_TEXT_QUERY_CASES, QUERIES.map((pair) => pair[0]));

QUERIES.forEach(([query, wire]) => {
    const body = explore.buildSearchBody({
        sort: 'new',
        period: 'week',
        search: query,
        honorPeriod: true,
        offset: 0,
        limit: 50
    });
    const tags = body.selectors.filter((row) => row.field === 'tag').map((row) => row.value);
    assert.deepStrictEqual(tags, [wire], query);
    assert.ok(body.selectors.some((row) => row.field === 'top' && row.value === 'week'), query);
    assert.strictEqual(body.orderers[0].field, 'top', query);
    assert.ok(!JSON.stringify(body).includes('  '), query);
    tags.forEach((tag) => assert.ok(!/\s/.test(tag), query));
});

const ignored = explore.buildSearchBody({
    sort: 'new',
    period: 'week',
    search: 'mutual hug',
    honorPeriod: false,
    offset: 0,
    limit: 10
});
assert.ok(!ignored.selectors.some((row) => row.field === 'top' || row.field === 'hot'));
assert.strictEqual(ignored.periodApplied, false);

const top = explore.buildSearchBody({
    sort: 'top',
    period: 'month',
    search: 'cicada',
    offset: 0,
    limit: 10
});
assert.ok(top.selectors.some((row) => row.field === 'top' && row.value === 'month'));

const hot = explore.buildSearchBody({
    sort: 'hot',
    period: 'day',
    offset: 0,
    limit: 10
});
assert.ok(hot.selectors.some((row) => row.field === 'hot' && row.value === 'day'));
assert.ok(!hot.selectors.some((row) => row.field === 'top'));

const modelBody = explore.buildSearchBody({
    sort: 'new',
    period: 'day',
    model: 'nai-diffusion-v4',
    offset: 0,
    limit: 10
});
const modelTag = modelBody.selectors.find((row) => String(row.value).startsWith('system:model:'));
assert.strictEqual(modelTag.value, 'system:model:nai-diffusion-4-5-full');
assert.ok(!modelBody.selectors.some((row) => row.value === 'system:model:nai-diffusion-v4'));
assert.strictEqual(explore.normalizeExploreModel('nai-diffusion-v4-curated'), 'nai-diffusion-4-5-curated');
assert.strictEqual(explore.normalizeExploreModel('nai-diffusion-5-full'), 'nai-diffusion-5-full');

assert.strictEqual(explore.readExploreLikeCount({ likes: 9 }), 9);
assert.strictEqual(explore.readExploreLikeCount({ like_count: 4 }), 4);
assert.strictEqual(explore.readExploreLikeCount({ like_count: 0, likes: 3 }), 3);
assert.strictEqual(explore.readExploreLikeCount({ stats: { likeCount: 8 } }), 8);

const meta = {
    sampler: 'k_euler_ancestral',
    steps: 28,
    scale: 5,
    cfg_rescale: 0.3,
    seed: 42,
    qualityToggle: true,
    ucPreset: 2,
    prompt: 'base prompt',
    uc: 'base uc',
    model: 'nai-diffusion-4-5-full',
    hash: 'abc123',
    v4_prompt: {
        caption: {
            base_caption: 'base prompt',
            char_captions: [{ char_caption: 'char prompt', centers: [{ x: 0.2, y: 0.8 }] }]
        }
    },
    v4_negative_prompt: {
        caption: { base_caption: 'base uc', char_captions: [{ char_caption: 'char uc' }] }
    },
    reference_strength_multiple: [0.6]
};
const bulky = 'BULKYPAYLOAD'.repeat(40);
const post = explore.compactExplorePost({
    id: 'post-1',
    created_at: '2026-10-09T00:00:00.000Z',
    creator: { id: 'c1', name: 'Ada' },
    likes: 11,
    title: 'Hello',
    image: { width: 832, height: 1216, nai_metadata: JSON.stringify(meta), blob: bulky }
}, { fields: ['title', 'width'] });
assert.strictEqual(post.id, 'post-1');
assert.strictEqual(post.creator.name, 'Ada');
assert.strictEqual(post.timestamp, '2026-10-09T00:00:00.000Z');
assert.strictEqual(post.model, 'nai-diffusion-4-5-full');
assert.strictEqual(post.hash, 'abc123');
assert.strictEqual(post.sampler, 'k_euler_ancestral');
assert.strictEqual(post.steps, 28);
assert.strictEqual(post.guidance, 5);
assert.strictEqual(post.rescale, 0.3);
assert.strictEqual(post.seed, 42);
assert.strictEqual(post.quality, true);
assert.strictEqual(post.ucPreset, 2);
assert.strictEqual(post.prompt, 'base prompt');
assert.strictEqual(post.uc, 'base uc');
assert.deepStrictEqual(post.characters, [{ prompt: 'char prompt', uc: 'char uc', x: 0.2, y: 0.8 }]);
assert.strictEqual(post.vt, true);
assert.strictEqual(post.likes, 11);
assert.strictEqual(post.thumbnailId, 'post-1');
assert.ok(String(post.previewUrl).includes('thumb_post-1'));
assert.ok(!String(post.previewUrl).includes('blob_'));
    assert.strictEqual(post.title, 'Hello');
    assert.strictEqual(post.width, 832);
assert.ok(!Object.prototype.hasOwnProperty.call(post, 'nai_metadata'));
assert.ok(!Object.prototype.hasOwnProperty.call(post, 'imageUrl'));
assert.ok(!JSON.stringify(post).includes(bulky));

const withMeta = explore.compactExplorePost({
    id: 'post-2',
    image: { nai_metadata: JSON.stringify({ prompt: 'p' }) }
}, { fields: ['nai_metadata'] });
assert.ok(withMeta.nai_metadata);

const cursor = explore.encodeExploreCursor(50);
assert.deepStrictEqual(explore.decodeExploreCursor(cursor), { offset: 50 });
assert.strictEqual(explore.decodeExploreCursor('nope'), null);

const shaped = explore.shapeExploreSearchForAgent({
    results: [{ id: 'post-1', likes: 2, prompt: 'p' }],
    pagination: { limit: 50, offset: 0, total: 2, hasMore: true, nextOffset: 50 },
    sort: 'top',
    period: 'week',
    periodApplied: true,
    search: 'cicada'
}, { mode: 'compact' });
assert.strictEqual(shaped.mode, 'compact');
assert.strictEqual(shaped.posts.length, 1);
assert.strictEqual(shaped.nextCursor, cursor);
assert.strictEqual(shaped.period, 'week');

(async () => {
    const counts = await explore.countExplore({
        tags: ['mutual hug', 'cicada'],
        period: 'week'
    }, {
        search: async (opts) => {
            assert.strictEqual(opts.honorPeriod, true);
            assert.strictEqual(opts.period, 'week');
            assert.deepStrictEqual(explore.exploreSearchTags(opts.search), [opts.search.replace(/ /g, '_')]);
            return {
                results: [
                    { id: 'a', creator: { id: 'c1' }, created_at: new Date().toISOString() },
                    { id: 'b', creator: { id: 'c2' }, created_at: new Date().toISOString() }
                ],
                pagination: { total: 4, hasMore: false, limit: 50, offset: 0 }
            };
        }
    });
    assert.strictEqual(counts.success, true);
    assert.strictEqual(counts.counts.length, 2);
    assert.strictEqual(counts.counts[0].tag, 'mutual hug');
    assert.strictEqual(counts.counts[0].posts, 4);
    assert.strictEqual(counts.counts[0].creators, 2);
    assert.strictEqual(counts.counts[1].tag, 'cicada');

    const byCreator = await explore.countExplore({
        creators: ['creator-9'],
        period: 'week'
    }, {
        search: async () => ({
            results: [
                { id: 'new', creator: { id: 'creator-9' }, created_at: new Date().toISOString() },
                { id: 'old', creator: { id: 'creator-9' }, created_at: '2020-01-01T00:00:00.000Z' }
            ],
            pagination: { total: 99, hasMore: false, limit: 50, offset: 0 }
        })
    });
    assert.strictEqual(byCreator.counts[0].creator, 'creator-9');
    assert.strictEqual(byCreator.counts[0].posts, 1);
    assert.strictEqual(byCreator.counts[0].creators, 1);

    await assert.rejects(() => explore.countExplore({}), /tags or creators/);

    await assert.rejects(
        () => explore.getExploreGallery({ cursor: 'nope' }),
        (err) => err && err.status === 400
    );

    const exploreScope = _test.listToolsForScopes(['explore']).map((tool) => tool.name);
    assert.ok(exploreScope.includes('search_explore'));
    assert.ok(exploreScope.includes('count_explore'));
    assert.ok(exploreScope.includes('get_explore_post'));
    assert.ok(exploreScope.includes('get_explore_image'));

    const searchScope = _test.listToolsForScopes(['search']).map((tool) => tool.name);
    ['search_explore', 'count_explore', 'get_explore_post', 'get_explore_image'].forEach((name) => {
        assert.ok(searchScope.includes(name), name);
    });
    const generationScope = _test.listToolsForScopes(['generation']).map((tool) => tool.name);
    assert.ok(!generationScope.includes('search_explore'));
    assert.ok(!generationScope.includes('count_explore'));

    const imageCall = await _test.callTool(
        {
            getNovelaiExploreGallery: () => ({
                ensureExploreImage: async (id) => {
                    assert.strictEqual(id, 'post-1');
                    return { publicUrl: '/cache/explore_files/blob_post-1.webp' };
                }
            })
        },
        { applicationAuth: { applicationScopes: ['search'] } },
        'get_explore_image',
        { postId: 'post-1' }
    );
    const imagePayload = JSON.parse(imageCall.content[0].text);
    assert.strictEqual(imagePayload.success, true);
    assert.strictEqual(imagePayload.url, '/cache/explore_files/blob_post-1.webp');
    assert.ok(!imagePayload.bytes);

    const postCall = await _test.callTool(
        {
            getNovelaiExploreGallery: () => ({
                getExplorePost: async () => ({
                    id: 'post-1',
                    prompt: 'only text',
                    image: { nai_metadata: bulky }
                }),
                ensureExploreImage: async () => ({ publicUrl: '/cache/explore_files/blob_post-1.webp' })
            })
        },
        { applicationAuth: { applicationScopes: ['explore'] } },
        'get_explore_post',
        { postId: 'post-1', includeImage: true }
    );
    const postPayload = JSON.parse(postCall.content[0].text);
    assert.strictEqual(postPayload.post.prompt, 'only text');
    assert.strictEqual(postPayload.post.imageUrl, '/cache/explore_files/blob_post-1.webp');
    assert.ok(!JSON.stringify(postPayload).includes(bulky));

    console.log('test-explore-search: ok');
    process.exit(0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
