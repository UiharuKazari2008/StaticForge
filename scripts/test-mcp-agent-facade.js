const assert = require('assert');
const crypto = require('crypto');
const { createMcpAuthMiddleware } = require('../modules/auth');
const { _test, McpOAuthProvider } = require('../modules/mcpAgentFacade');
const { validateRedirectUri, verifyPkceChallenge, parseScopes, ALLOWED_REDIRECT_URI_HOSTS } = require('../modules/mcpOAuthProvider');

assert.strictEqual(_test.isAllowedMcpOrigin(undefined), true);
assert.strictEqual(_test.isAllowedMcpOrigin(''), true);
assert.strictEqual(_test.isAllowedMcpOrigin('https://grok.com'), true);
assert.strictEqual(_test.isAllowedMcpOrigin('https://console.x.ai'), true);
assert.strictEqual(_test.isAllowedMcpOrigin('https://evil.example'), false);
assert.strictEqual(_test.isAllowedMcpOrigin('https://cursor.com'), false);
assert.strictEqual(_test.isAllowedMcpOrigin('https://staticforge.737.jp.net'), false);

const oauthReq = { protocol: 'https', get: (name) => name === 'host' ? 'staticforge.737.jp.net' : undefined };
const oauthProviderForCors = { getMcpBaseUrl: () => 'https://staticforge.737.jp.net' };
assert.strictEqual(_test.isAllowedOAuthOrigin(undefined), true);
assert.strictEqual(_test.isAllowedOAuthOrigin('https://grok.com', oauthReq, oauthProviderForCors), true);
assert.strictEqual(_test.isAllowedOAuthOrigin('https://cursor.com', oauthReq, oauthProviderForCors), true);
assert.strictEqual(_test.isAllowedOAuthOrigin('https://staticforge.737.jp.net', oauthReq, oauthProviderForCors), true);
assert.strictEqual(_test.isAllowedOAuthOrigin('http://127.0.0.1:9220', oauthReq, oauthProviderForCors), true);
assert.strictEqual(_test.isAllowedOAuthOrigin('https://evil.example', oauthReq, oauthProviderForCors), false);
assert.strictEqual(_test.isAllowedOAuthOrigin('null', oauthReq, oauthProviderForCors), true);
assert.strictEqual(_test.isAbsentOrigin('null'), true);
assert.strictEqual(_test.isAllowedOAuthOrigin('https://evil.example', {
    protocol: 'https',
    get: () => 'staticforge.737.jp.net',
    headers: { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin' }
}, oauthProviderForCors), true);

assert.strictEqual(_test.sanitizeGalleryFilename('shot.png'), 'shot.png');
assert.strictEqual(_test.sanitizeGalleryFilename('  shot.png  '), 'shot.png');
assert.strictEqual(_test.sanitizeGalleryFilename('../etc/passwd'), null);
assert.strictEqual(_test.sanitizeGalleryFilename('a/b.png'), null);
assert.strictEqual(_test.sanitizeGalleryFilename(''), null);
assert.strictEqual(_test.isCheapMcpRequest({ body: { method: 'tools/list' } }), true);
assert.strictEqual(_test.isCheapMcpRequest({ body: { method: 'ping' } }), true);
assert.strictEqual(_test.isCheapMcpRequest({ body: { method: 'initialize' } }), true);
assert.strictEqual(_test.isCheapMcpRequest({ body: { method: 'tools/call' } }), false);
assert.strictEqual(_test.rateGroupForTool('get_workspaces'), 'free');
assert.strictEqual(_test.rateGroupForTool('get_generated_image'), 'gallery');
assert.strictEqual(_test.rateGroupForTool('generate_image'), 'generate');
assert.strictEqual(_test.rateGroupForTool('get_studio_state'), 'studio');
assert.strictEqual(_test.rateGroupForTool('advanced_tools'), 'free');
assert.strictEqual(_test.rateGroupForCall('advanced_tools', { query: 'bind' }), 'free');
assert.strictEqual(_test.rateGroupForCall('advanced_tools', { name: 'generate_preset' }), 'generate');
assert.strictEqual(_test.rateGroupForCall('advanced_tools', { name: 'get_images' }), 'gallery');
assert.strictEqual(_test.rateGroupForCall('generate_image', {}), 'generate');
assert.strictEqual(_test.MCP_RATE_GROUP_LIMITS.free.max, 0);
assert.ok(_test.MCP_RATE_GROUP_LIMITS.generate.max < _test.MCP_RATE_GROUP_LIMITS.gallery.max);
const RATE_MAP_GAPS_ON_MAIN = new Set([
    'publish_apocrypha', 'revoke_apocrypha', 'get_apocrypha',
    'deliver_cake', 'feed_cake', 'inspect_pantry', 'consume_cake',
    'get_work_pile', 'add_work_item', 'complete_work_item', 'remove_work_item',
    'report_issue', 'get_usage'
]);
_test.TOOL_DEFS.forEach((tool) => {
    if (RATE_MAP_GAPS_ON_MAIN.has(tool.name)) return;
    assert.ok(_test.TOOL_RATE_GROUPS[tool.name], `missing rate group for ${tool.name}`);
});
_test.resetRateGroupHits();
const first = _test.consumeRateGroup('test-key', 'generate');
assert.strictEqual(first.ok, true);
_test.resetRateGroupHits();
const genLimit = _test.MCP_RATE_GROUP_LIMITS.generate.max;
for (let i = 0; i < genLimit; i += 1) {
    assert.strictEqual(_test.consumeRateGroup('test-key', 'generate').ok, true);
}
const denied = _test.consumeRateGroup('test-key', 'generate');
assert.strictEqual(denied.ok, false);
assert.strictEqual(denied.group, 'generate');
assert.ok(denied.retryAfterSec >= 1);
assert.strictEqual(_test.consumeRateGroup('test-key', 'free').ok, true);
_test.resetRateGroupHits();

const generatedImageTool = _test.TOOL_DEFS.find((t) => t.name === 'get_generated_image');
assert.ok(generatedImageTool.description.includes('Grok-sized webp'));
assert.ok(generatedImageTool.description.includes('Do not page get_images'));
assert.ok(_test.TOOL_DEFS.some((t) => t.name === 'get_latest_image'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('get_generated_image'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('advanced_tools'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('save_preset'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('apply_studio_changes'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('get_session_state view=live'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('studioReachable'));
const wikiHandler = require('../modules/ws/handlers/110-wikiHandler');
assert.strictEqual(wikiHandler.postProcessWikiHtml({}), '');
assert.strictEqual(wikiHandler.postProcessWikiHtml('<p>ok</p>'), '<p>ok</p>');
assert.strictEqual(wikiHandler.coerceWikiBodyText({}), '');
assert.strictEqual(wikiHandler.coerceWikiBodyText(''), '');
assert.strictEqual(wikiHandler.coerceWikiBodyText({ body: 'noir has silver hair' }), 'noir has silver hair');
assert.strictEqual(wikiHandler.coerceWikiBodyText({ html: {} }), '');
assert.strictEqual(JSON.stringify({ html: Promise.resolve('x') }), '{"html":{}}');
assert.deepStrictEqual(_test.reshapeWikiPageForMcp({
    success: true,
    tagName: 'noir (nikke)',
    bodies: [{ source: 'danbooru', html: {}, fetchedOnline: false }]
}), {
    success: true,
    tagName: 'noir (nikke)',
    text: '',
    markdown: '',
    bodySource: undefined,
    fetchedOnline: false,
    empty: true,
    next: 'Wiki body is empty. Try search_wiki aliases, the last Studio character box, or generate and write what the pixels did. A missing wiki is not a ban.'
});
assert.strictEqual(_test.reshapeWikiPageForMcp({
    success: true,
    tagName: 'alice (nikke)',
    bodies: [{ source: 'danbooru', html: 'Alice is a Nikke with ...' }]
}).text.includes('Alice is a Nikke'), true);

const characterCardTool = _test.TOOL_DEFS.find((t) => t.name === 'get_character_card');
assert.ok(characterCardTool);
assert.ok(characterCardTool.core);
assert.strictEqual(characterCardTool.scope, 'wiki');
assert.deepStrictEqual(characterCardTool.inputSchema.required, ['name']);
assert.strictEqual(_test.rateGroupForTool('get_character_card'), 'search');
assert.strictEqual(_test.TOOL_RATE_GROUPS.get_character_card, 'search');

const emptyCard = _test.assembleCharacterCard({
    name: 'velvet (sensual rabbit) (nikke)',
    wiki: { tagName: 'velvet (sensual rabbit) (nikke)', text: '', markdown: '', empty: true },
    aliases: ['velvet (nikke)'],
    expander: null,
    studioBox: { action: 'replace', index: 0, name: 'Velvet', prompt: '!velvet_base, smile', uc: '' },
    naxChara: { tag: 'velvet_(sensual_rabbit)_(nikke)', prompt: 'velvet (sensual rabbit) (nikke)', score: 12 }
});
assert.strictEqual(emptyCard.success, true);
assert.strictEqual(emptyCard.wiki.empty, true);
assert.strictEqual(emptyCard.wiki.text, '');
assert.strictEqual(emptyCard.wiki.markdown, '');
assert.ok(!String(emptyCard.wiki.text || '').includes('silver'));
assert.ok(!String(emptyCard.wiki.markdown || '').includes(emptyCard.naxChara.prompt));
assert.strictEqual(emptyCard.franchise, 'nikke');
assert.ok(emptyCard.aliases.includes('velvet (nikke)'));
assert.strictEqual(emptyCard.studioBox.action, 'replace');
assert.strictEqual(emptyCard.studioBox.index, 0);
assert.strictEqual(emptyCard.naxChara.prompt, 'velvet (sensual rabbit) (nikke)');
assert.strictEqual(emptyCard.next, _test.WIKI_EMPTY_NEXT);

const filledCard = _test.assembleCharacterCard({
    name: 'alice (nikke)',
    wiki: { tagName: 'alice (nikke)', text: 'Alice is a Nikke.', markdown: 'Alice is a Nikke.' },
    expander: { prefix: 'alice_base', value: 'long shared appearance, hair, body' }
});
assert.strictEqual(filledCard.wiki.empty, false);
assert.strictEqual(filledCard.wiki.text, 'Alice is a Nikke.');
assert.strictEqual(filledCard.expander.value, 'long shared appearance, hair, body');
assert.ok(!filledCard.next);

assert.deepStrictEqual(_test.matchRequestExpander([
    { prefix: 'alice_base', value: 'long shared appearance, hair, body' }
], 'alice (nikke)'), { prefix: 'alice_base', value: 'long shared appearance, hair, body' });
assert.strictEqual(_test.matchRequestExpander([{ prefix: 'other', value: 'nope' }], 'alice'), null);
assert.deepStrictEqual(_test.pickStudioCharacterBox([
    { name: 'Other', prompt: 'unrelated' },
    { name: 'Alice', prompt: '!alice_base, smile', uc: 'ganyu' }
], 'alice'), {
    action: 'replace',
    index: 1,
    name: 'Alice',
    prompt: '!alice_base, smile',
    uc: 'ganyu'
});
assert.strictEqual(_test.parseCharacterFranchise('rapi (nikke)'), 'nikke');
assert.strictEqual(_test.normalizeCharacterKey('rapi_(nikke)'), 'rapi (nikke)');
assert.strictEqual(_test.pickPaidApproval({ userApprovedPaidRequest: true }), true);
assert.strictEqual(_test.pickPaidApproval({ allow_paid: true }), true);
assert.strictEqual(_test.pickPaidApproval({}), false);
assert.strictEqual(_test.wouldSpendPaidCredits('upscale_image', {}), true);
assert.strictEqual(_test.wouldSpendPaidCredits('expand_image', {}), true);
assert.strictEqual(_test.wouldSpendPaidCredits('generate_image', { resolution: 'normal_portrait' }), false);
assert.strictEqual(_test.wouldSpendPaidCredits('generate_image', { resolution: 'xlarge_portrait' }), true);
assert.strictEqual(_test.wouldSpendPaidCredits('generate_image', { upscale: true }), true);
assert.ok(_test.MCP_INSTRUCTIONS.includes('userApprovedPaidRequest'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('html as {}'));
assert.strictEqual(_test.resolveWorkspaceId(''), 'default');
assert.strictEqual(_test.resolveWorkspaceId('default'), 'default');
assert.strictEqual(_test.resolveWorkspaceId('other'), 'other');
assert.strictEqual(_test.flattenPacket({
    success: true,
    type: 'image_generation_response',
    data: { filename: 'a.png', image: 'HUGE', seed: 1 }
}).image, undefined);
assert.strictEqual(_test.flattenPacket({
    success: true,
    type: 'image_generation_response',
    data: { filename: 'a.png', image: 'HUGE', seed: 1 }
}).filename, 'a.png');
assert.strictEqual(_test.pickFocusedWindowFilename([
    { active: false, data: { filename: 'other.png' } },
    { active: true, data: { selected: ['focus.png', 'b.png'] } }
]), 'focus.png');
assert.strictEqual(_test.pickFocusedWindowFilename([
    { active: true, data: { filename: 'lumen.png' } }
]), 'lumen.png');
const listImagesTool = _test.TOOL_DEFS.find((t) => t.name === 'get_images');
assert.ok(listImagesTool.description.includes('get_generated_image'));

const genOnly = _test.listToolsForScopes(['generation']);
assert.ok(genOnly.some((t) => t.name === 'generate_image'));
assert.ok(genOnly.some((t) => t.name === 'get_generation_job'));
assert.ok(genOnly.some((t) => t.name === 'await_generation_job'));
assert.ok(genOnly.some((t) => t.name === 'get_open_windows'));
assert.ok(genOnly.some((t) => t.name === 'get_session_state'));
assert.ok(genOnly.some((t) => t.name === 'get_prompt_guide'));
assert.ok(genOnly.some((t) => t.name === 'save_memory'));
assert.ok(genOnly.some((t) => t.name === 'apply_studio_changes'));
const generateImageTool = _test.TOOL_DEFS.find((t) => t.name === 'generate_image');
assert.ok(generateImageTool.inputSchema.properties.async);
assert.ok(_test.MCP_INSTRUCTIONS.includes('await_generation_job'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('get_open_windows'));
assert.strictEqual(_test.rateGroupForTool('get_open_windows'), 'studio');
assert.strictEqual(_test.rateGroupForTool('get_generation_job'), 'free');
assert.strictEqual(_test.rateGroupForTool('await_generation_job'), 'free');
assert.ok(genOnly.some((t) => t.name === 'advanced_tools'));
assert.ok(genOnly.some((t) => t.name === 'bind_session'));
assert.ok(genOnly.some((t) => t.name === 'list_clients'));
assert.ok(genOnly.some((t) => t.name === 'get_client_physics'));
assert.ok(genOnly.some((t) => t.name === 'get_linkxi_persona'));
assert.ok(genOnly.some((t) => t.name === 'save_linkxi_persona'));
assert.ok(!genOnly.some((t) => t.name === 'get_images'));
assert.ok(!genOnly.some((t) => t.name === 'generate_preset'));

const galleryOnly = _test.listToolsForScopes(['gallery']);
assert.ok(galleryOnly.some((t) => t.name === 'get_generated_image'));
assert.ok(galleryOnly.some((t) => t.name === 'advanced_tools'));
assert.ok(!galleryOnly.some((t) => t.name === 'get_images'));
assert.ok(!galleryOnly.some((t) => t.name === 'get_latest_image'));
assert.ok(!galleryOnly.some((t) => t.name === 'generate_image'));

const workspaceOnly = _test.listToolsForScopes(['workspace']);
assert.ok(workspaceOnly.some((t) => t.name === 'get_workspaces'));
assert.ok(workspaceOnly.some((t) => t.name === 'advanced_tools'));
assert.ok(!workspaceOnly.some((t) => t.name === 'generate_image'));

const autofillOnly = _test.listToolsForScopes(['autofill']);
assert.ok(autofillOnly.some((t) => t.name === 'search_autofill'));
assert.ok(autofillOnly.some((t) => t.name === 'search_wiki'), 'autofill keys already include wiki packets');
assert.ok(autofillOnly.some((t) => t.name === 'get_wiki_page'));
assert.ok(autofillOnly.some((t) => t.name === 'get_character_card'));
assert.ok(autofillOnly.some((t) => t.name === 'search_nax'), 'autofill keys also get NAX search');
assert.ok(autofillOnly.some((t) => t.name === 'list_nax_galleries'));
assert.ok(autofillOnly.some((t) => t.name === 'advanced_tools'));
assert.ok(!autofillOnly.some((t) => t.name === 'generate_image'));
assert.ok(!autofillOnly.some((t) => t.name === 'list_static_wiki_sites'));

const wikiOnly = _test.listToolsForScopes(['wiki']);
assert.ok(wikiOnly.some((t) => t.name === 'search_wiki'));
assert.ok(wikiOnly.some((t) => t.name === 'get_wiki_page'));
assert.ok(wikiOnly.some((t) => t.name === 'get_character_card'));
assert.ok(wikiOnly.some((t) => t.name === 'advanced_tools'));
assert.ok(!wikiOnly.some((t) => t.name === 'list_static_wiki_sites'));
assert.ok(!wikiOnly.some((t) => t.name === 'search_static_wiki'));
assert.ok(!wikiOnly.some((t) => t.name === 'get_static_wiki_page'));
assert.ok(!wikiOnly.some((t) => t.name === 'search_autofill'));

const presetsOnly = _test.listToolsForScopes(['presets']);
assert.ok(presetsOnly.some((t) => t.name === 'save_preset'));
assert.ok(presetsOnly.some((t) => t.name === 'apply_preset_to_studio'));
assert.ok(presetsOnly.some((t) => t.name === 'advanced_tools'));
assert.ok(!presetsOnly.some((t) => t.name === 'list_presets'));
assert.ok(!presetsOnly.some((t) => t.name === 'generate_preset'));

const generationTools = _test.listToolsForScopes(['generation']);
assert.ok(generationTools.some((t) => t.name === 'upscale_image'));
assert.ok(generationTools.some((t) => t.name === 'expand_image'));
assert.ok(generationTools.some((t) => t.name === 'get_studio_state'));
assert.ok(generationTools.some((t) => t.name === 'get_client_physics'));
assert.ok(!generationTools.some((t) => t.name === 'generate_preset'));

const refsOnly = _test.listToolsForScopes(['references']);
assert.deepStrictEqual(refsOnly.map((t) => t.name), ['advanced_tools']);

const searchOnly = _test.listToolsForScopes(['search']);
assert.ok(searchOnly.some((t) => t.name === 'omegasearch'));
assert.ok(searchOnly.some((t) => t.name === 'search_nax'));
assert.ok(searchOnly.some((t) => t.name === 'list_nax_galleries'));
assert.ok(searchOnly.some((t) => t.name === 'advanced_tools'));
assert.ok(!searchOnly.some((t) => t.name === 'search_autofill'));
assert.ok(!genOnly.some((t) => t.name === 'search_nax'));
assert.strictEqual(_test.rateGroupForTool('search_nax'), 'search');
assert.strictEqual(_test.rateGroupForTool('list_nax_galleries'), 'free');
assert.ok(_test.MCP_INSTRUCTIONS.includes('search_nax'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('top votes'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('get_session_state'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('view=live'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('search_autofill'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('get_wiki_page'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('get_character_card'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('get_prompt_guide'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('not laws'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('working notes'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('Do not use a grok.com project file'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('save_memory'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('saveKnowledgeMemory'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('Grok Memory'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('MUST call save_memory'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('Do not treat a memory as fact'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('upsert related memories'));
assert.strictEqual(_test.rateGroupForTool('get_session_state'), 'studio');
assert.strictEqual(_test.rateGroupForTool('save_memory'), 'write');
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'save_memory').inputSchema.properties.observations.description.includes('Strings are fine'));
assert.strictEqual(_test.rateGroupForTool('get_prompt_guide'), 'free');
assert.strictEqual(_test.normalizeNaxKind(''), 'ARTIST');
assert.strictEqual(_test.normalizeNaxKind('character'), 'CHARA');
assert.strictEqual(_test.normalizeNaxKind('artists'), 'ARTIST');

const mockNax = {
    getGalleries: () => [
        { slug: 'danbooru-artist-tags-v4.5', title: 'Artists 4.5', version: 'v4.5', tag_count: 2 }
    ],
    NAX_EXPANDER_PRESETS: [{ id: 'ARTIST', label: 'Artist', description: 'artists' }],
    getNaxExpanderPreset: (id) => (id === 'ARTIST' ? {
        id: 'ARTIST',
        resolveSlugs: () => ['danbooru-artist-tags-v4.5']
    } : null),
    artistGallerySlugsForModel: () => ['danbooru-artist-tags-v4.5'],
    formatTagForPrompt: (tag, slug) => (String(slug || '').includes('artist') ? `artist:${tag}` : tag),
    queryTags: ({ query, sort }) => {
        const all = [
            {
                tag: 'kago_shintaro',
                gallerySlug: 'danbooru-artist-tags-v4.5',
                score: 90,
                upvotes: 100,
                downvotes: 10,
                favorite: true,
                tryMark: false
            },
            {
                tag: 'low_vote',
                gallerySlug: 'danbooru-artist-tags-v4.5',
                score: 1,
                upvotes: 1,
                downvotes: 20,
                favorite: false,
                tryMark: false
            }
        ];
        const items = query ? all.filter((row) => row.tag.includes(query)) : all.slice();
        if (sort === 'score') items.sort((a, b) => b.score - a.score);
        if (sort === 'ratio') {
            items.sort((a, b) => (b.upvotes / (b.upvotes + b.downvotes)) - (a.upvotes / (a.upvotes + a.downvotes)));
        }
        return { items, total: items.length, hasMore: false };
    }
};
const topVotes = _test.searchNaxTags(mockNax, { sort: 'score' });
assert.strictEqual(topVotes.success, true);
assert.strictEqual(topVotes.items[0].tag, 'kago_shintaro');
assert.strictEqual(topVotes.items[0].prompt, 'artist:kago_shintaro');
assert.ok(topVotes.next.includes('top votes'));
const namedNax = _test.searchNaxTags(mockNax, { query: 'kago' });
assert.strictEqual(namedNax.items.length, 1);
const naxGalleries = _test.listNaxGalleries(mockNax);
assert.strictEqual(naxGalleries.galleries.length, 1);
assert.ok(naxGalleries.next.includes('top votes'));
const naxMiss = _test.searchNaxTags({
    getNaxExpanderPreset: () => null,
    artistGallerySlugsForModel: () => [],
    getGalleries: () => []
}, {});
assert.strictEqual(naxMiss.success, false);

const savedMemory = _test.runMemoryTool({
    getKnowledgeMemoryDb: () => ({
        listKnowledgeMemoriesPaged: () => ({ items: [{ name: 'a', description: 'b', confidence: 0.1, model: 'v4_5' }], total: 1 }),
        searchKnowledgeMemories: () => [{ name: 'a' }],
        getKnowledgeMemory: () => null,
        saveKnowledgeMemory: (name, description, category, entities, relations, observations, confidence, model) => ({
            name, description, category: category || 'mcp', confidence, model
        })
    })
}, 'save_memory', { name: 'artist-tip', description: 'use item.prompt' });
assert.strictEqual(savedMemory.success, true);
assert.strictEqual(savedMemory.memory.name, 'artist-tip');
assert.strictEqual(savedMemory.refined, false);
assert.strictEqual(savedMemory.confidence, 0.1);
assert.strictEqual(savedMemory.model, 'v4_5');

let store = {
    name: 'artist-tip',
    description: 'old',
    category: 'mcp',
    confidence: 0.1,
    model: 'v4_5',
    entities: [{ id: 'e1', name: 'keep' }],
    relations: [],
    observations: []
};
const refinedMemory = _test.runMemoryTool({
    getKnowledgeMemoryDb: () => ({
        getKnowledgeMemory: () => store,
        saveKnowledgeMemory: (name, description, category, entities, relations, observations, confidence, model) => {
            store = { name, description, category, entities, relations, observations, confidence, model };
            return store;
        }
    })
}, 'save_memory', { name: 'artist-tip', description: 'new desc' });
assert.strictEqual(refinedMemory.refined, true);
assert.strictEqual(refinedMemory.confidence, 0.35);
assert.strictEqual(refinedMemory.memory.entities.length, 1);
assert.strictEqual(refinedMemory.needsRefinement, true);

const gotMemory = _test.runMemoryTool({
    getKnowledgeMemoryDb: () => ({
        getKnowledgeMemory: () => ({ name: 'a', confidence: 0.2, entities: [] })
    })
}, 'get_memory', { name: 'a' });
assert.strictEqual(gotMemory.needsRefinement, true);

const aliasSaved = _test.runMemoryTool({
    getKnowledgeMemoryDb: () => ({
        getKnowledgeMemory: () => null,
        saveKnowledgeMemory: (name, description, category, entities, relations, observations, confidence, model) => ({
            name, description, category: category || 'mcp', confidence, model
        })
    })
}, 'saveKnowledgeMemory', { name: 'old-api', description: 'from saveKnowledgeMemory', reason: 'prove it' });
assert.strictEqual(aliasSaved.success, true);
assert.strictEqual(aliasSaved.memory.name, 'old-api');
assert.strictEqual(aliasSaved.refined, false);

const aliasGot = _test.runMemoryTool({
    getKnowledgeMemoryDb: () => ({
        getKnowledgeMemory: (n) => (n === 'a' ? { name: 'a', confidence: 0.2, entities: [] } : null)
    })
}, 'retrieveKnowledgeMemory', { names: ['a'], reason: 'old retrieve' });
assert.strictEqual(aliasGot.success, true);
assert.strictEqual(aliasGot.memories.length, 1);

const { resolveRefinementConfidence, normalizeMemoryModel } = require('../modules/knowledgeMemoryDatabase');
assert.strictEqual(resolveRefinementConfidence(0.1, undefined), 0.35);
assert.strictEqual(resolveRefinementConfidence(0.9, 0.25), 1);
assert.strictEqual(resolveRefinementConfidence(0.4, 0), 0.4);
assert.strictEqual(normalizeMemoryModel(''), 'v4_5');
assert.strictEqual(normalizeMemoryModel('v5'), 'v5');

const noMemDb = _test.runMemoryTool({}, 'list_memories', {});
assert.strictEqual(noMemDb.success, false);

const notesOnly = _test.listToolsForScopes(['notes']);
assert.ok(notesOnly.some((t) => t.name === 'list_notes'));
assert.ok(notesOnly.some((t) => t.name === 'get_note'));
assert.ok(notesOnly.some((t) => t.name === 'save_note_content'));
assert.ok(notesOnly.some((t) => t.name === 'advanced_tools'));
assert.ok(!notesOnly.some((t) => t.name === 'create_note'));
assert.ok(!notesOnly.some((t) => t.name === 'omegasearch'));

const hiddenBind = _test.listAdvancedToolDefs(['generation'], 'bind');
assert.ok(!hiddenBind.some((t) => t.name === 'bind_session'));
assert.ok(!hiddenBind.some((t) => t.name === 'list_clients'));
assert.ok(!hiddenBind.some((t) => t.name === 'generate_image'));
assert.strictEqual(_test.rateGroupForTool('get_client_physics'), 'studio');
assert.ok(_test.MCP_INSTRUCTIONS.includes('needsClientChoice'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('get_client_physics'));

const hiddenPreset = _test.listAdvancedToolDefs(['presets', 'generation'], 'preset');
assert.ok(hiddenPreset.some((t) => t.name === 'list_presets'));
assert.ok(hiddenPreset.some((t) => t.name === 'generate_preset'));
assert.ok(!hiddenPreset.some((t) => t.name === 'save_preset'));

const coreNames = _test.TOOL_DEFS.filter((t) => t.core).map((t) => t.name);
assert.ok(coreNames.includes('get_workspaces'));
assert.ok(coreNames.includes('save_preset'));
assert.ok(coreNames.includes('get_generated_image'));
assert.ok(coreNames.includes('delete_images'));
assert.ok(coreNames.includes('scrap_images'));
assert.ok(coreNames.includes('toggle_favorite'));
assert.ok(coreNames.includes('open_in_lumen'));
assert.ok(coreNames.includes('open_in_glancewell'));
assert.ok(coreNames.includes('compare_images'));
assert.ok(coreNames.includes('evaluate_workspace_themes'));
assert.ok(coreNames.includes('vfs_list'));
assert.ok(coreNames.includes('vfs_read'));
assert.ok(coreNames.includes('bind_session'));
assert.ok(coreNames.includes('list_clients'));
assert.ok(coreNames.includes('get_client_physics'));
assert.ok(coreNames.includes('get_linkxi_persona'));
assert.ok(coreNames.includes('save_linkxi_persona'));
assert.ok(coreNames.includes('get_generation_job'));
assert.ok(coreNames.includes('await_generation_job'));
assert.ok(coreNames.includes('get_open_windows'));
assert.ok(coreNames.includes('search_nax'));
assert.ok(coreNames.includes('get_character_card'));
assert.ok(coreNames.includes('list_nax_galleries'));
assert.ok(coreNames.includes('get_session_state'));
assert.ok(coreNames.includes('get_prompt_guide'));
assert.ok(coreNames.includes('list_memories'));
assert.ok(coreNames.includes('search_memories'));
assert.ok(coreNames.includes('get_memory'));
assert.ok(coreNames.includes('save_memory'));
assert.ok(coreNames.includes('saveKnowledgeMemory'));
assert.ok(coreNames.includes('searchKnowledgeMemories'));
assert.ok(coreNames.includes('retrieveKnowledgeMemory'));
assert.strictEqual(_test.rateGroupForTool('saveKnowledgeMemory'), 'write');
assert.strictEqual(_test.canonMemoryTool('saveKnowledgeMemory'), 'save_memory');
assert.strictEqual(coreNames.length, 59);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'generate_image').inputSchema.properties.pipeline);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'generate_image').inputSchema.properties.rescale);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'generate_image').inputSchema.properties.noiseScheduler);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'generate_image').inputSchema.properties.characters);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'generate_image').inputSchema.properties.params);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'generate_image').inputSchema.properties.append_uc);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'apply_studio_changes').inputSchema.properties.params);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'apply_studio_changes').inputSchema.properties.characters);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'apply_studio_changes').inputSchema.properties.steps);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'expand_image').inputSchema.properties.overrideParams);
assert.ok(_test.MCP_INSTRUCTIONS.includes('append_quality / append_uc'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('turn that preset off'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('no_text'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('Enshutsuka'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('MUST integrate'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('get_linkxi_persona'));
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'apply_studio_changes').inputSchema.properties.dynamicGeneration);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'apply_studio_changes').inputSchema.properties.director);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'apply_studio_changes').inputSchema.properties.nsfw);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'apply_studio_changes').inputSchema.properties.dataset_config);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'apply_studio_changes').inputSchema.properties.append_transparency);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'apply_studio_changes').inputSchema.properties.n);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'apply_studio_changes').inputSchema.properties.dataset_config.properties.settings);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'apply_studio_changes').inputSchema.properties.dataset_config.description.includes('no_text'));
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'generate_image').inputSchema.properties.dynamicGeneration);
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'generate_image').inputSchema.properties.director);
assert.strictEqual(_test.rateGroupForTool('get_linkxi_persona'), 'free');
assert.strictEqual(_test.rateGroupForTool('save_linkxi_persona'), 'write');
assert.deepStrictEqual(
    _test.collectEnshutsukaMustAct({ dynamicGeneration: { enabled: true } }).reasons,
    ['dynamicGeneration']
);
assert.deepStrictEqual(
    _test.collectEnshutsukaMustAct({ director_session_id: 'sess-1' }).reasons,
    ['director']
);
assert.strictEqual(_test.collectEnshutsukaMustAct({}), null);
assert.strictEqual(_test.collectEnshutsukaMustAct({
    dynamicGeneration: { enabled: true, integrated: true }
}), null);
assert.strictEqual(_test.collectEnshutsukaMustAct({
    dynamicGeneration: { enabled: true, compiled_prompt: { success: false, error: 'Dynamic generation processing failed' } }
}), null);
assert.strictEqual(_test.pickAgentPacketReply([
    { type: 'image_generation_progress', data: { phase: 'queued', jobId: 'j1' } },
    { type: 'request_keep_alive', requestId: 'r1' },
    { type: 'dynamic_generation_progress_update', data: { weather: 'clear' } },
    { type: 'image_generation_response', data: { filename: 'a.png', seed: 7 } }
]).data.filename, 'a.png');
assert.strictEqual(_test.pickAgentPacketReply([
    { type: 'request_keep_alive' },
    { type: 'dynamic_generation_progress_update', data: { error: 'Dynamic generation processing failed' } }
]), null);
assert.strictEqual(_test.sanitizeLinkXiPersona({
    user_name: 'Yukimi',
    backstory: 'x',
    default_verbosity: 4,
    profile_photo_base64: 'HUGE'
}).hasPhoto, true);
assert.ok(!_test.sanitizeLinkXiPersona({
    user_name: 'Yukimi',
    profile_photo_base64: 'HUGE'
}).profile_photo_base64);
const listedGen = _test.listToolsForScopes(['generation'], {
    getPromptConfig: () => ({
        quality_presets: { v5: 'very aesthetic, masterpiece, no text' },
        uc_presets: { v5: ['human-focus-uc', 'light-uc', 'heavy-uc'] },
        nsfw_presets: { 3: { add: { base: 'nsfw, nude' } } }
    })
}).find((t) => t.name === 'generate_image');
assert.ok(listedGen.inputSchema.properties.append_quality.description.includes('very aesthetic, masterpiece, no text'));
assert.ok(listedGen.inputSchema.properties.append_uc.description.includes('heavy-uc'));
assert.ok(listedGen.inputSchema.properties.sampler.enum.includes('k_euler_ancestral'));
assert.ok(listedGen.inputSchema.properties.dataset_config.properties.nsfw.description.includes('Nude'));
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'get_studio_state').description.includes('settings'));
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'get_studio_state').description.includes('nooped'));
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'get_session_state').description.includes('resolved'));
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'generate_image').description.includes('needsIntegration'));
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'generate_image').inputSchema.properties.workspace.description.includes('bound Studio tab'));
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'generate_image').inputSchema.properties.dynamicGeneration.description.includes('integrated=true'));
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'get_client_physics').description.includes('Works without a Studio bind'));
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'get_client_physics').inputSchema.properties.location);
assert.ok(_test.MCP_INSTRUCTIONS.includes('needsIntegration'));
assert.ok(_test.MCP_INSTRUCTIONS.includes('integrated=true'));

assert.deepStrictEqual(_test.collectFilenames({ filename: 'a.png', filenames: ['b.png', '../x'] }), ['b.png', 'a.png']);
assert.strictEqual(_test.rateGroupForTool('delete_images'), 'write');
assert.strictEqual(_test.rateGroupForTool('compare_images'), 'gallery');
assert.strictEqual(_test.rateGroupForTool('vfs_list'), 'free');

const galleryOnlyTools = _test.listToolsForScopes(['gallery']);
assert.ok(galleryOnlyTools.some((t) => t.name === 'delete_images'));
assert.ok(galleryOnlyTools.some((t) => t.name === 'compare_images'));
assert.ok(galleryOnlyTools.some((t) => t.name === 'open_in_glancewell'));

const vfsOnly = _test.listToolsForScopes(['vfs']);
assert.ok(vfsOnly.some((t) => t.name === 'vfs_list'));
assert.ok(vfsOnly.some((t) => t.name === 'vfs_read'));
assert.ok(!vfsOnly.some((t) => t.name === 'vfs_write'));

assert.deepStrictEqual(_test.collectOmegasearchBlocks({ query: '1girl sunset' }), ['1girl sunset']);
assert.deepStrictEqual(
    _test.collectOmegasearchBlocks({ terms: ['asuka', 'rei'] }),
    [{ terms: ['asuka', 'rei'], matchMode: 'substring', orWithinBlock: true }]
);
assert.deepStrictEqual(_test.collectOmegasearchBlocks({ blocks: ['keep'] }), ['keep']);

const presetChange = _test.studioChangeFromPreset({
    preset_name: 'test-spell',
    prompt: '1girl',
    negative_prompt: 'blurry',
    model: 'v5',
    steps: 28
});
assert.strictEqual(presetChange.dreamscape, 'change');
assert.strictEqual(presetChange.params.model, 'v5');
assert.ok(presetChange.fields.some((f) => f.id === 'prompt' && f.chunks[0].text === '1girl'));
assert.ok(presetChange.fields.some((f) => f.id === 'uc' && f.chunks[0].text === 'blurry'));

assert.deepStrictEqual(_test.collectAutofillTerms({ query: '  asuka  ' }), ['asuka']);
assert.deepStrictEqual(_test.collectAutofillTerms({ terms: ['rei', 'asuka', 'rei', ''] }), ['rei', 'asuka']);
assert.deepStrictEqual(_test.collectAutofillTerms({ terms: ['rei'], query: 'asuka' }), ['rei', 'asuka']);
assert.strictEqual(_test.collectAutofillTerms({ terms: Array.from({ length: 30 }, (_, i) => `t${i}`) }).length, 8);
assert.deepStrictEqual(_test.collectAutofillTerms({}), []);
const fetal = _test.trimAutofillBatch('fetal monitor', true, {
    results: [
        { name: 'flora (nikke)', type: 'character', matchScore: 40 },
        { name: 'pregnant', type: 'tag', matchScore: 30 }
    ]
});
assert.strictEqual(fetal.untrained, true);
assert.strictEqual(fetal.results.length, 0);
assert.ok(String(fetal.next || '').includes('You may still try it'));
const rapi = _test.trimAutofillBatch('rapi (nikke)', true, {
    results: [
        { name: 'rapi (nikke)', type: 'character', matchScore: 99 },
        { name: 'rapi (nikke) (old)', type: 'character', matchScore: 80 },
        { name: 'unrelated', type: 'tag', matchScore: 10 }
    ]
});
assert.strictEqual(rapi.trained, true);
assert.strictEqual(rapi.results.length, 2);
assert.strictEqual(rapi.results[0].tag, 'rapi (nikke)');
assert.strictEqual(rapi.results[0].exact, true);
const aliceExact = _test.trimAutofillBatch('alice', true, {
    results: [
        { name: 'alice (nikke)', type: 'character', matchScore: 90 },
        { name: 'alice margatroid', type: 'character', matchScore: 80 }
    ]
});
assert.strictEqual(aliceExact.results.length, 1);
assert.strictEqual(aliceExact.results[0].tag, 'alice (nikke)');
const aliceFuzzy = _test.trimAutofillBatch('alice', true, {
    results: [
        { name: 'alice (nikke)', type: 'character', matchScore: 90 },
        { name: 'alice margatroid', type: 'character', matchScore: 80 }
    ]
}, { exactOnly: false });
assert.strictEqual(aliceFuzzy.results.length, 2);

assert.ok(_test.TOOL_DEFS.every((t) => t.scope !== 'universal'));

async function runMcpAuth(options) {
    const seen = [];
    const manager = options.manager || {
        extractAuthFromRequest: (req) => {
            const header = req.headers['x-staticforge-app-key'] || '';
            const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
            const token = header || bearer;
            if (token && token.startsWith('sfapp_')) return { type: 'application_key', token };
            return null;
        },
        async validateApplicationKey(rawKey, userAgent, opts) {
            if (rawKey !== 'sfapp_testkey') {
                return { valid: false, code: 'INVALID_KEY', message: 'Invalid or revoked application key' };
            }
            const matched = String(userAgent || '').trim() === 'DreamscapeTest/1.0';
            if (opts && opts.unknownUserAgentBypass) {
                seen.push({ userAgent, matched, bypass: true });
            }
            if (!matched && !(opts && opts.unknownUserAgentBypass)) {
                return { valid: false, code: 'USER_AGENT_MISMATCH', message: 'User-Agent does not match registered application' };
            }
            return {
                valid: true,
                userType: 'admin',
                applicationKeyId: 'key-1',
                scopes: ['generation', 'gallery', 'workspace'],
                userAgentMatched: matched,
                userAgentBypassed: !matched
            };
        }
    };
    const globalResources = {
        getApplicationAuthManager: () => manager
    };
    const req = {
        headers: {
            ...(options.authorization ? { authorization: options.authorization } : {}),
            ...(options.appKey ? { 'x-staticforge-app-key': options.appKey } : {}),
            ...(options.userAgent ? { 'user-agent': options.userAgent } : {})
        },
        query: options.query || {},
        session: {}
    };
    const response = {
        statusCode: 200,
        body: null,
        setHeader() {},
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
    let continued = false;
    await createMcpAuthMiddleware(globalResources)(req, response, () => {
        continued = true;
    });
    return { req, response, continued, seen };
}

async function main() {
    const wikiMd = await wikiHandler.formatWikiBody(
        {},
        { convertWikiMarkupToMarkdown: async (text) => `# ${text}` },
        'hello',
        'markdown',
        null,
        1
    );
    assert.strictEqual(wikiMd, '# hello');
    const wikiEmpty = await wikiHandler.formatWikiBody(
        {},
        { convertWikiMarkupToMarkdown: async () => 'nope' },
        {},
        'markdown',
        null,
        1
    );
    assert.strictEqual(wikiEmpty, '');
    assert.strictEqual(await wikiHandler.convertWikiMarkupToHtml({}, {}), '');

    const noKey = await runMcpAuth({});
    assert.strictEqual(noKey.continued, false);
    assert.strictEqual(noKey.response.statusCode, 401);
    assert.strictEqual(noKey.response.body.code, 'APP_KEY_REQUIRED');

    const queryAuth = await runMcpAuth({
        appKey: 'sfapp_testkey',
        userAgent: 'DreamscapeTest/1.0',
        query: { auth: 'sfapp_testkey' }
    });
    assert.strictEqual(queryAuth.continued, false);
    assert.strictEqual(queryAuth.response.statusCode, 400);
    assert.strictEqual(queryAuth.response.body.code, 'QUERY_AUTH_FORBIDDEN');

    const matched = await runMcpAuth({
        authorization: 'Bearer sfapp_testkey',
        userAgent: 'DreamscapeTest/1.0'
    });
    assert.strictEqual(matched.continued, true);
    assert.strictEqual(matched.req.authMethod, 'application_key');
    assert.strictEqual(matched.req.applicationAuth.userAgentMatched, true);
    assert.strictEqual(matched.req.applicationAuth.userAgentBypassed, false);
    assert.strictEqual(matched.seen.length, 1);
    assert.strictEqual(matched.seen[0].matched, true);

    const unknownUa = await runMcpAuth({
        authorization: 'Bearer sfapp_testkey',
        userAgent: 'Grok-Connector/0.0'
    });
    assert.strictEqual(unknownUa.continued, true, 'unknown UA must bypass, not 403');
    assert.strictEqual(unknownUa.req.applicationAuth.userAgentBypassed, true);
    assert.strictEqual(unknownUa.seen.length, 1);
    assert.strictEqual(unknownUa.seen[0].matched, false);
    assert.strictEqual(unknownUa.seen[0].userAgent, 'Grok-Connector/0.0');

    const init = await _test.handleJsonRpc(
        {},
        { applicationAuth: { applicationScopes: ['generation'] } },
        { jsonrpc: '2.0', id: 1, method: 'initialize' }
    );
    assert.strictEqual(init.status, 200);
    assert.strictEqual(init.body.result.protocolVersion, _test.MCP_PROTOCOL_VERSION);
    const rev = _test.currentMcpToolsRevision();
    assert.ok(/^[0-9a-f]{8}$/.test(rev));
    assert.strictEqual(init.body.result.serverInfo.name, `DreamScape r${rev}`);
    assert.strictEqual(init.body.result.serverInfo.title, `DreamScape r${rev}`);
    assert.strictEqual(init.body.result.serverInfo.version, rev);
    assert.strictEqual(init.body.result.serverInfo.description, 'Academy City Research P.S.R.');
    assert.strictEqual(init.body.result.serverInfo.websiteUrl, 'http://localhost:9220');
    assert.strictEqual(init.body.result.serverInfo.icons[0].src, 'http://localhost:9220/static_images/apple-touch-icon.png');
    assert.strictEqual(init.body.result.serverInfo.icons[0].mimeType, 'image/png');
    assert.deepStrictEqual(init.body.result.serverInfo.icons[0].sizes, ['180x180']);

    const initHosted = await _test.handleJsonRpc(
        { getConfig: ({ path }) => (path === 'public_hostname' ? 'staticforge.737.jp.net' : null) },
        { applicationAuth: { applicationScopes: ['generation'] } },
        { jsonrpc: '2.0', id: 11, method: 'initialize' }
    );
    assert.strictEqual(initHosted.body.result.serverInfo.name, `DreamScape r${rev}`);
    assert.strictEqual(initHosted.body.result.serverInfo.websiteUrl, 'https://staticforge.737.jp.net');
    assert.strictEqual(
        initHosted.body.result.serverInfo.icons[0].src,
        'https://staticforge.737.jp.net/static_images/apple-touch-icon.png'
    );

    const { hashMcpToolsRevision, buildMcpConnectorGrimPage, ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS } = require('../modules/mcpServerInfo');
    const grimPage = buildMcpConnectorGrimPage({
        getConfig: ({ path }) => (path === 'public_hostname' ? 'staticforge.737.jp.net' : null),
        getMcpPathUuid: () => 'mcp-test-uuid'
    });
    assert.strictEqual(grimPage.data.connectorUrl, 'https://staticforge.737.jp.net/mcp-test-uuid');
    assert.strictEqual(grimPage.data.mcpUrl, 'https://staticforge.737.jp.net/mcp-test-uuid/mcp');
    assert.ok(grimPage.data.oauthAuthorize.includes('/oauth/authorize'));
    assert.ok(grimPage.data.projectInstructions.includes('MUST integrate'));
    assert.ok(ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS.includes('get_linkxi_persona'));
    assert.ok(ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS.includes('search_memories'));
    assert.ok(ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS.includes('saveKnowledgeMemory'));
    assert.ok(ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS.includes('Grok Memory'));
    assert.ok(ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS.includes('MUST call save_memory'));
    assert.ok(ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS.includes('Do not keep a copy'));
    assert.ok(ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS.includes('get_prompt_guide'));
    assert.ok(ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS.includes('get_session_state'));
    assert.ok(ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS.includes(_test.MCP_INSTRUCTIONS));
    assert.notStrictEqual(
        hashMcpToolsRevision([{ name: 'a', description: 'one' }]),
        hashMcpToolsRevision([{ name: 'a', description: 'two' }])
    );

    const { createGenerationJobQueue } = require('../modules/generationJobQueue');
    const jobQueue = createGenerationJobQueue({ delayMinMs: 0, delayMaxMs: 0 });
    const submitted = jobQueue.submit({
        type: 'generate_image',
        source: 'test',
        run: async () => ({ success: true, flat: { filename: null, seed: 7 } })
    });
    await submitted.promise;
    const jobPoll = await _test.handleJsonRpc(
        { getGenerationJobQueue: () => jobQueue },
        { applicationAuth: { applicationScopes: ['generation'] }, authMethod: 'application_key' },
        {
            jsonrpc: '2.0',
            id: 21,
            method: 'tools/call',
            params: { name: 'get_generation_job', arguments: { jobId: submitted.id } }
        }
    );
    assert.strictEqual(jobPoll.status, 200);
    const jobMeta = JSON.parse(jobPoll.body.result.content[0].text);
    assert.strictEqual(jobMeta.jobId, submitted.id);
    assert.strictEqual(jobMeta.status, 'completed');
    assert.strictEqual(jobMeta.seed, 7);

    const listed = await _test.handleJsonRpc(
        {},
        { applicationAuth: { applicationScopes: ['gallery'] }, authMethod: 'application_key' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' }
    );
    const names = listed.body.result.tools.map((t) => t.name);
    assert.ok(names.includes('get_generated_image'));
    assert.ok(names.includes('advanced_tools'));
    assert.ok(!names.includes('get_images'));
    assert.ok(!names.includes('generate_image'));

    const autofillListed = await _test.handleJsonRpc(
        {},
        { applicationAuth: { applicationScopes: ['autofill'] }, authMethod: 'application_key' },
        { jsonrpc: '2.0', id: 3, method: 'tools/list' }
    );
    const autofillNames = autofillListed.body.result.tools.map((t) => t.name);
    assert.ok(autofillNames.includes('search_autofill'));
    assert.ok(autofillNames.includes('get_wiki_page'));
    assert.ok(autofillNames.includes('get_character_card'));
    assert.ok(autofillNames.includes('search_nax'));
    assert.ok(autofillNames.includes('advanced_tools'));
    assert.ok(!autofillNames.includes('generate_image'));
    assert.ok(!autofillNames.includes('list_static_wiki_sites'));

    const naxCall = await _test.callTool(
        { getNaxTagsDatabase: () => mockNax },
        { applicationAuth: { applicationScopes: ['search'] } },
        'search_nax',
        { sort: 'score', limit: 10 }
    );
    const naxPayload = JSON.parse(naxCall.content[0].text);
    assert.strictEqual(naxPayload.success, true);
    assert.strictEqual(naxPayload.items[0].tag, 'kago_shintaro');
    assert.strictEqual(naxPayload.items[0].prompt, 'artist:kago_shintaro');
    assert.ok(naxPayload.next.includes('top votes'));

    const wikiListed = await _test.handleJsonRpc(
        {},
        { applicationAuth: { applicationScopes: ['wiki'] }, authMethod: 'application_key' },
        { jsonrpc: '2.0', id: 31, method: 'tools/list' }
    );
    const wikiListNames = wikiListed.body.result.tools.map((t) => t.name);
    assert.ok(wikiListNames.includes('get_character_card'));
    assert.ok(wikiListNames.includes('get_wiki_page'));

    const mockCharaNax = {
        getGalleries: () => [{ slug: 'danbooru-character-tags-v4.5', title: 'Characters 4.5', version: 'v4.5', tag_count: 1 }],
        getNaxExpanderPreset: (id) => (id === 'CHARA' ? {
            id: 'CHARA',
            resolveSlugs: () => ['danbooru-character-tags-v4.5']
        } : null),
        formatTagForPrompt: (tag) => String(tag).replace(/_/g, ' '),
        queryTags: ({ query }) => {
            const all = [{
                tag: 'alice_(nikke)',
                gallerySlug: 'danbooru-character-tags-v4.5',
                score: 80,
                upvotes: 80,
                downvotes: 2,
                favorite: false,
                tryMark: false
            }];
            const needle = String(query || '').toLowerCase().replace(/ /g, '_');
            const items = needle ? all.filter((row) => row.tag.toLowerCase().includes(needle)) : all;
            return { items, total: items.length, hasMore: false };
        }
    };
    const cardCall = await _test.callTool(
        {
            getNaxTagsDatabase: () => mockCharaNax,
            getPromptConfig: () => ({ alice_base: 'long shared appearance, hair, body' })
        },
        { applicationAuth: { applicationScopes: ['wiki'] } },
        'get_character_card',
        { name: 'alice (nikke)' }
    );
    const cardPayload = JSON.parse(cardCall.content[0].text);
    assert.strictEqual(cardPayload.success, true);
    assert.strictEqual(cardPayload.name, 'alice (nikke)');
    assert.strictEqual(cardPayload.wiki.empty, true);
    assert.strictEqual(cardPayload.wiki.text, '');
    assert.ok(!String(cardPayload.wiki.markdown || '').includes('silver'));
    assert.ok(!String(cardPayload.wiki.text || '').includes('invent'));
    assert.strictEqual(cardPayload.expander.prefix, 'alice_base');
    assert.strictEqual(cardPayload.expander.value, 'long shared appearance, hair, body');
    assert.strictEqual(cardPayload.naxChara.prompt, 'alice (nikke)');
    assert.strictEqual(cardPayload.next, _test.WIKI_EMPTY_NEXT);

    const advancedListed = await _test.handleJsonRpc(
        {},
        { applicationAuth: { applicationScopes: ['generation'] }, authMethod: 'application_key' },
        {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: { name: 'advanced_tools', arguments: { query: 'preset' } }
        }
    );
    const advancedPayload = JSON.parse(advancedListed.body.result.content[0].text);
    assert.strictEqual(advancedPayload.success, true);
    assert.ok(advancedPayload.tools.some((t) => t.name === 'generate_preset'));
    assert.ok(advancedPayload.next.includes('name and arguments'));

    const memoryQuery = await _test.handleJsonRpc(
        {},
        { applicationAuth: { applicationScopes: ['generation'] }, authMethod: 'application_key' },
        {
            jsonrpc: '2.0',
            id: 41,
            method: 'tools/call',
            params: { name: 'advanced_tools', arguments: { query: 'create memory list memories by model v5' } }
        }
    );
    const memoryPayload = JSON.parse(memoryQuery.body.result.content[0].text);
    assert.ok(memoryPayload.core.some((t) => t.name === 'list_memories'));
    assert.ok(memoryPayload.core.some((t) => t.name === 'save_memory'));
    assert.ok(memoryPayload.next.includes('list_memories'));
    assert.ok(memoryPayload.next.includes('v5'));
    assert.ok(memoryPayload.core.find((t) => t.name === 'list_memories').inputSchema.properties.model);

    const missQuery = await _test.handleJsonRpc(
        {},
        { applicationAuth: { applicationScopes: ['generation'] }, authMethod: 'application_key' },
        {
            jsonrpc: '2.0',
            id: 42,
            method: 'tools/call',
            params: { name: 'advanced_tools', arguments: { query: 'zzzz-no-such-tool-xyz' } }
        }
    );
    const missPayload = JSON.parse(missQuery.body.result.content[0].text);
    assert.strictEqual(missPayload.fallback, true);
    assert.ok(missPayload.core.some((t) => t.name === 'list_memories'));
    assert.ok(missPayload.core.some((t) => t.name === 'save_memory'));
    assert.ok(missPayload.core.length > 10);
    assert.ok(missPayload.tools.length > 0);

    assert.strictEqual(_test.guessModelFromQuery('list memories by model v5'), 'v5');
    const { memoryModelQuery } = require('../modules/knowledgeMemoryDatabase');
    assert.strictEqual(memoryModelQuery('v4.5'), 'v4_5');

    const advancedCoreReject = await _test.handleJsonRpc(
        {},
        { applicationAuth: { applicationScopes: ['generation'] }, authMethod: 'application_key' },
        {
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: { name: 'advanced_tools', arguments: { name: 'generate_image', arguments: {} } }
        }
    );
    const coreRejectPayload = JSON.parse(advancedCoreReject.body.result.content[0].text);
    assert.strictEqual(coreRejectPayload.success, false);
    assert.ok(coreRejectPayload.error.includes('core tool'));
    assert.strictEqual(advancedCoreReject.body.result.isError, true);

    const noClientSession = await _test.collectSessionState({
        getPath: () => require('path').join(__dirname, '..', '.cache'),
        getPromptConfig: () => ({ quality_presets: { v5: 'best quality' }, uc_presets: {}, nsfw_presets: {} }),
        getWebSocketServer: () => ({ clients: new Map() })
    }, { applicationAuth: { applicationScopes: ['generation'] } }, {});
    const noClientPayload = JSON.parse(noClientSession.content[0].text);
    assert.strictEqual(noClientPayload.success, true);
    assert.strictEqual(noClientPayload.view, 'live');
    assert.strictEqual(noClientPayload.hasClients, false);
    assert.ok(!noClientPayload.settings);
    assert.ok(noClientPayload.next.includes('generate_image'));
    const fullSession = await _test.collectSessionState({
        getPath: () => require('path').join(__dirname, '..', '.cache'),
        getPromptConfig: () => ({
            quality_presets: { v5: 'best quality', v4: 'old quality' },
            uc_presets: {},
            nsfw_presets: { 3: { add: { base: 'nsfw, nude' } } }
        }),
        getWebSocketServer: () => ({ clients: new Map() })
    }, { applicationAuth: { applicationScopes: ['generation'] } }, { view: 'full' });
    const fullPayload = JSON.parse(fullSession.content[0].text);
    assert.strictEqual(fullPayload.view, 'full');
    assert.ok(fullPayload.settings);
    assert.ok(!fullPayload.settings.quality.byModel);
    assert.strictEqual(fullPayload.settings.quality.catalog, 'slim');
    const catalogSession = await _test.collectSessionState({
        getPath: () => require('path').join(__dirname, '..', '.cache'),
        getPromptConfig: () => ({ quality_presets: { v5: 'best quality' }, uc_presets: {}, nsfw_presets: {} }),
        getWebSocketServer: () => ({ clients: new Map() })
    }, { applicationAuth: { applicationScopes: ['generation'] } }, { view: 'catalog' });
    const catalogPayload = JSON.parse(catalogSession.content[0].text);
    assert.strictEqual(catalogPayload.view, 'catalog');
    assert.ok(catalogPayload.settings);
    assert.ok(!catalogPayload.settings.uc.byModel);
    const liveSession = await _test.collectSessionState({
        getPath: () => require('path').join(__dirname, '..', '.cache'),
        getPromptConfig: () => ({ quality_presets: { v5: 'best quality' }, uc_presets: {}, nsfw_presets: {} }),
        getWebSocketServer: () => ({ clients: new Map() })
    }, { applicationAuth: { applicationScopes: ['generation'] } }, { view: 'live' });
    const livePayload = JSON.parse(liveSession.content[0].text);
    assert.strictEqual(livePayload.view, 'live');
    assert.ok(!livePayload.settings);

    const lumenSkip = await _test.maybeOpenGeneratedInLumen({
        getWebSocketServer: () => ({ clients: new Map() })
    }, { applicationAuth: { applicationScopes: ['generation'] } }, ['shot.png']);
    assert.strictEqual(lumenSkip.opened, false);
    assert.strictEqual(lumenSkip.reason, 'no-client');

    // OAuth 2.1 tests
    // modules/mcpOAuthProvider.js
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('grok.com'));
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('x.ai'));
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('127.0.0.1'));
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('localhost'));
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('cursor.com'));

    assert.deepStrictEqual(validateRedirectUri('https://grok.com/callback'), { valid: true });
    assert.deepStrictEqual(validateRedirectUri('https://x.ai/oauth'), { valid: true });
    assert.deepStrictEqual(validateRedirectUri('http://127.0.0.1:39123/callback'), { valid: true });
    assert.deepStrictEqual(validateRedirectUri('http://localhost:8080/cb'), { valid: true });
    assert.strictEqual(validateRedirectUri('https://evil.example/cb').valid, false);
    assert.strictEqual(validateRedirectUri('http://grok.com/cb').valid, false);
    assert.strictEqual(validateRedirectUri('ftp://grok.com/cb').valid, false);

    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
    assert.strictEqual(verifyPkceChallenge(verifier, challenge), true);
    assert.strictEqual(verifyPkceChallenge('wrongverifier', challenge), false);

    assert.deepStrictEqual(parseScopes('generation gallery'), ['generation', 'gallery']);
    assert.deepStrictEqual(parseScopes('  generation   gallery  workspace '), ['generation', 'gallery', 'workspace']);
    assert.deepStrictEqual(parseScopes(''), []);
    assert.deepStrictEqual(parseScopes(null), []);

    const mockGlobalResources = {
        getMcpPathUuid: () => 'test-uuid-1234',
        getConfig: ({ path }) => path === 'public_hostname' ? 'staticforge.737.jp.net' : null,
        getApplicationAuthManager: () => ({
            validateApplicationKey: async () => ({ valid: true, applicationKeyId: 'key-1', scopes: ['generation', 'gallery'] })
        })
    };
    const oauthProvider = new McpOAuthProvider(mockGlobalResources);

    const protectedMeta = oauthProvider.getProtectedResourceMetadata();
    assert.strictEqual(protectedMeta.resource, 'https://staticforge.737.jp.net/test-uuid-1234');
    assert.ok(Array.isArray(protectedMeta.authorization_servers));
    assert.ok(protectedMeta.authorization_servers.includes('https://staticforge.737.jp.net'));
    assert.ok(Array.isArray(protectedMeta.scopes_supported));
    assert.ok(protectedMeta.scopes_supported.includes('generation'));
    assert.ok(protectedMeta.scopes_supported.includes('notes'));
    assert.ok(Array.isArray(protectedMeta.recommended_scopes));
    assert.ok(protectedMeta.recommended_scopes.includes('notes'));
    assert.ok(protectedMeta.recommended_scopes.includes('generation'));
    assert.strictEqual(protectedMeta.resource_name, 'DreamScape');

    const asMeta = oauthProvider.getAuthorizationServerMetadata();
    assert.strictEqual(asMeta.issuer, 'https://staticforge.737.jp.net');
    assert.strictEqual(asMeta.authorization_endpoint, 'https://staticforge.737.jp.net/test-uuid-1234/oauth/authorize');
    assert.strictEqual(asMeta.token_endpoint, 'https://staticforge.737.jp.net/test-uuid-1234/oauth/token');
    assert.strictEqual(asMeta.registration_endpoint, 'https://staticforge.737.jp.net/test-uuid-1234/oauth/register');
    assert.deepStrictEqual(asMeta.response_types_supported, ['code']);
    assert.deepStrictEqual(asMeta.code_challenge_methods_supported, ['S256']);
    assert.deepStrictEqual(asMeta.token_endpoint_auth_methods_supported, ['none']);

    const sharp = require('sharp');
    const source = await sharp({
        create: { width: 2000, height: 1000, channels: 3, background: '#334455' }
    }).png().toBuffer();
    const resized = await _test.resizeImageForGrok(source);
    assert.ok(resized);
    assert.strictEqual(resized.mimeType, 'image/webp');
    assert.ok(resized.bytes.length < source.length);
    const resizedMeta = await sharp(resized.bytes).metadata();
    assert.ok(resizedMeta.width <= _test.GROK_IMAGE_MAX_EDGE);
    assert.ok(resizedMeta.height <= _test.GROK_IMAGE_MAX_EDGE);
    assert.strictEqual(resizedMeta.format, 'webp');

    const naiPromptGuideSync = require('../modules/naiPromptGuideSync');
    assert.strictEqual(naiPromptGuideSync.SITE_ID, 'docubase');
    assert.ok(naiPromptGuideSync.isDocubaseSiteId('nai-prompt-guide'));
    assert.strictEqual(
        naiPromptGuideSync.titleFromSource('prompt-guide.md', '# Living Guide\n\nbody'),
        'prompt-guide.md (Living Guide)'
    );
    assert.strictEqual(
        naiPromptGuideSync.titleFromSource('constraints/v5.yaml', '# not a heading\nkey: 1'),
        'constraints/v5.yaml'
    );
    const docHtml = naiPromptGuideSync.wrapPromptGuideHtml({
        title: 'Hard syntax',
        file: 'prompt-guide.md',
        text: '## Hard syntax\n\n- lowercase\n- weights\n'
    }, new Set());
    assert.ok(docHtml.includes('<h4>'));
    assert.ok(docHtml.includes('tag-wiki-list'));
    assert.ok(!docHtml.includes('<article'));
    assert.ok(!/^\s*<pre>/.test(docHtml));

    console.log('test-mcp-agent-facade: ok');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
