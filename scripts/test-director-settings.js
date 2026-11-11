// Director Settings and the Kabuki tab (#687 slices 2 and 3): settings validation and save,
// new-chat defaults, chat memoryStore (Kabuki) classification and backfill, list filtering.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'director-settings-'));
require('../modules/directorLearned')._test.setStorePath(path.join(tmp, 'learned-rules.json'));
const director = require('../modules/cursorDirector');
const t = director._test;
const custom = require('../modules/customModelProviders');
custom._test.setLogoDir(path.join(tmp, 'logos'));

// One normal provider, one with Obliterated Memories. getConfig({ path }) reads one block, as the real one does.
const providers = [
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
    { id: 'abl', name: 'Abliterated', baseUrl: 'https://abl.example.com', obliteratedMemories: true }
];
function makeGr(initialDirector) {
    const config = { director: initialDirector || {}, customModelProviders: providers };
    const writes = [];
    return {
        config,
        writes,
        getConfig: (opts) => (opts && opts.path ? config[opts.path] : config),
        getSecureConfig: () => ({ keys: [] }),
        updateConfigValue: async (type, keyPath, value) => {
            writes.push({ type, keyPath, value });
            config[keyPath[0]] = JSON.parse(JSON.stringify(value));
            return true;
        }
    };
}

(async () => {
    // ---- the client engine list carries each provider's memory store ----
    const listed = custom.publicList(makeGr());
    assert.strictEqual(listed.find((row) => row.id === 'abl').memoryStore, 'obliterated');
    assert.strictEqual(listed.find((row) => row.id === 'deepseek').memoryStore, null);
    const engines = t.settingsEngines(makeGr());
    assert.deepStrictEqual(engines.map((row) => row.engine), ['cursor', 'claude', 'tokenrouter', 'custom:deepseek', 'custom:abl']);

    // ---- validation: engine / model / effort shape, store per lane, threshold bounds ----
    const gr = makeGr({ idleShutdownMinutes: 15 });
    const ok = t.normalizeDirectorSettings(gr, {
        defaults: { wren: { engine: 'Claude', model: 'claude-opus-5-5', effort: 'High' }, kabuki: { engine: 'custom:abl', model: 'org/model-x:free' } },
        autoRepair: { enabled: false, threshold: 70 },
        repair: { normal: { engine: 'tokenrouter', model: 'deepseek/deepseek-v4.1-flash', effort: 'xhigh' }, obliterated: null }
    });
    assert.deepStrictEqual(ok.defaults.wren, { engine: 'claude', model: 'claude-opus-5-5', effort: 'high' });
    assert.deepStrictEqual(ok.defaults.kabuki, { engine: 'custom:abl', model: 'org/model-x:free', effort: null });
    assert.deepStrictEqual(ok.autoRepair, { enabled: false, threshold: 70 });
    assert.strictEqual(ok.repair.obliterated, null, 'null clears a pick');
    assert.deepStrictEqual(t.normalizeDirectorSettings(gr, { repair: { normal: { engine: '' } } }).repair.normal, null, 'no engine is unset');
    assert.deepStrictEqual(Object.keys(t.normalizeDirectorSettings(gr, { autoRepair: { threshold: 90 } })), ['autoRepair'], 'only given parts');
    const bad = (input, re) => assert.throws(() => t.normalizeDirectorSettings(gr, input), (err) => err.code === 'INVALID_DIRECTOR_SETTINGS' && re.test(err.message));
    bad(null, /must be an object/);
    bad({ defaults: [] }, /defaults must be an object/);
    bad({ defaults: { wren: 'claude' } }, /must be \{ engine, model, effort \}/);
    bad({ defaults: { wren: { engine: 'gemini' } } }, /unknown engine/);
    bad({ defaults: { wren: { engine: 'custom:gone' } } }, /no custom model provider/);
    bad({ defaults: { wren: { engine: 'custom:abl' } } }, /not turned on for Yumiya/);
    bad({ defaults: { kabuki: { engine: 'claude' } } }, /not turned on for Chiyo/);

    // ---- Model Availability and Chiyo's memory stores (#742) ----
    {
        const g = makeGr();
        // unset: an Obliterated Memories engine is Chiyo's, the others Yumiya's, Yozora may use any
        assert.deepStrictEqual(t.readDirectorSettings(g).availability, {
            wren: { cursor: true, claude: true, tokenrouter: true, 'custom:deepseek': true, 'custom:abl': false },
            kabuki: { cursor: false, claude: false, tokenrouter: false, 'custom:deepseek': false, 'custom:abl': true },
            xi: { cursor: true, claude: true, tokenrouter: true, 'custom:deepseek': true, 'custom:abl': true }
        });
        assert.deepStrictEqual(t.readDirectorSettings(g).kabukiMemory.claude, { obliterated: true, studio: false, primary: 'obliterated' });
        assert.deepStrictEqual(director.turnMemoryStores(g, true, 'claude'), { primary: 'obliterated', alternate: undefined });
        assert.deepStrictEqual(director.turnMemoryStores(g, false, 'custom:abl'), { primary: 'obliterated', alternate: undefined }, 'another persona keeps the engine\'s own store');
        assert.deepStrictEqual(director.turnMemoryStores(g, false, 'claude'), { primary: '', alternate: undefined });
        // Chiyo on Claude with both stores, Studio first; the same save may set her default to it
        const saved2 = await t.saveDirectorSettings(g, {
            availability: { kabuki: { claude: true }, xi: { cursor: false }, wren: { 'custom:deepseek': false } },
            kabukiMemory: { claude: { obliterated: true, studio: true, primary: 'studio' } },
            defaults: { kabuki: { engine: 'claude' } }
        });
        assert.strictEqual(saved2.availability.kabuki.claude, true);
        assert.strictEqual(saved2.availability.kabuki['custom:abl'], true, 'rows not sent keep their rule');
        assert.strictEqual(saved2.availability.xi.cursor, false);
        assert.deepStrictEqual(saved2.defaults.kabuki, { engine: 'claude', model: null, effort: null });
        assert.strictEqual(director.engineAvailable(g, 'wren', 'custom:deepseek'), false);
        assert.deepStrictEqual(director.turnMemoryStores(g, true, 'claude'), { primary: '', alternate: 'obliterated' });
        assert.deepStrictEqual(director.turnMemoryStores(g, true, 'custom:abl'), { primary: 'obliterated', alternate: undefined });
        const badA = async (settings, re) => assert.rejects(() => t.saveDirectorSettings(g, settings), re);
        await badA({ availability: { kabuki: { nope: true } } }, /unknown engine/);
        await badA({ availability: { kabuki: { claude: 'yes' } } }, /true or false/);
        await badA({ kabukiMemory: { claude: { obliterated: false, studio: false } } }, /at least one memory store/);
        await badA({ kabukiMemory: { claude: { obliterated: true, studio: false, primary: 'studio' } } }, /primary store must be one that is on/);
        // turning Chiyo off for an engine un-fits her default
        await t.saveDirectorSettings(g, { availability: { kabuki: { claude: false } } });
        assert.strictEqual(t.readDirectorSettings(g).defaults.kabuki, null);
    }
    bad({ repair: { obliterated: { engine: 'custom:deepseek' } } }, /does not use Obliterated Memories/);
    bad({ repair: { normal: { engine: 'custom:abl' } } }, /uses Obliterated Memories/);
    bad({ defaults: { wren: { engine: 'claude', model: 'two words' } } }, /not a model id/);
    bad({ defaults: { wren: { engine: 'claude', model: 'x'.repeat(201) } } }, /not a model id/);
    bad({ defaults: { wren: { engine: 'claude', effort: 'turbo-max-9' } } }, /not a reasoning level/);
    bad({ autoRepair: { threshold: 29 } }, /30 to 100/);
    bad({ autoRepair: { threshold: 101 } }, /30 to 100/);
    bad({ autoRepair: { threshold: 85.5 } }, /30 to 100/);
    bad({ autoRepair: { threshold: '90%' } }, /30 to 100/);
    bad({ autoRepair: true }, /must be \{ enabled, threshold \}/);
    assert.deepStrictEqual(t.normalizeDirectorSettings(gr, { autoRepair: { threshold: 30 } }).autoRepair, { enabled: true, threshold: 30 });
    assert.deepStrictEqual(t.normalizeDirectorSettings(gr, { autoRepair: { threshold: 100 } }).autoRepair, { enabled: true, threshold: 100 });

    // ---- save: one write of the director block, other keys kept; partial updates merge ----
    const saved = await t.saveDirectorSettings(gr, {
        defaults: { wren: { engine: 'claude', model: 'claude-opus-5-5', effort: 'high' }, kabuki: { engine: 'custom:abl' } },
        autoRepair: { enabled: false, threshold: 70 },
        repair: { obliterated: { engine: 'custom:abl', model: 'org/big', effort: 'high' } }
    });
    assert.strictEqual(gr.writes.length, 1);
    assert.deepStrictEqual(gr.writes[0].keyPath, ['director']);
    assert.strictEqual(gr.config.director.idleShutdownMinutes, 15, 'other director keys survive');
    assert.deepStrictEqual(saved.autoRepair, { enabled: false, threshold: 70 });
    assert.deepStrictEqual(saved.repair, { normal: null, obliterated: { engine: 'custom:abl', model: 'org/big', effort: 'high' } });
    assert.deepStrictEqual(t.autoRepairSettings(gr), { enabled: false, threshold: 70 }, 'Auto-Repair reads what was saved');
    await t.saveDirectorSettings(gr, { defaults: { kabuki: null } });
    assert.deepStrictEqual(gr.config.director.defaults, { wren: { engine: 'claude', model: 'claude-opus-5-5', effort: 'high' } }, 'clearing one keeps the other');
    await t.saveDirectorSettings(gr, { defaults: { wren: null }, autoRepair: null });
    assert.ok(!('defaults' in gr.config.director) && !('autoRepair' in gr.config.director), 'empty blocks are dropped');
    assert.deepStrictEqual(t.readDirectorSettings(gr).autoRepair, { enabled: true, threshold: 85 }, 'cleared Auto-Repair is the default again');
    await assert.rejects(() => t.saveDirectorSettings(gr, { autoRepair: { threshold: 5 } }), /30 to 100/);
    assert.strictEqual(gr.writes.length, 3, 'a bad save writes nothing');
    await assert.rejects(() => t.saveDirectorSettings({ getConfig: () => ({}) }, { autoRepair: { threshold: 50 } }), (err) => err.code === 'CONFIG_READONLY');

    // A saved pick that stopped fitting (provider lost Obliterated Memories) reads as unset.
    const drift = makeGr({ defaults: { kabuki: { engine: 'custom:deepseek' }, wren: { engine: 'nope' } }, repair: { normal: { engine: 'cursor', model: 'gpt-5' } } });
    const read = t.readDirectorSettings(drift);
    assert.strictEqual(read.defaults.kabuki, null);
    assert.strictEqual(read.defaults.wren, null);
    assert.deepStrictEqual(read.repair.normal, { engine: 'cursor', model: 'gpt-5', effort: null });

    // ---- defaults applied to new chats ----
    const withDefaults = makeGr({ defaults: { wren: { engine: 'tokenrouter', model: 'deepseek/deepseek-v4.1-flash', effort: 'low' }, kabuki: { engine: 'custom:abl', model: 'org/big' } } });
    assert.deepStrictEqual(t.directorDefaultsFor(withDefaults, 'wren'), { engine: 'tokenrouter', model: 'deepseek/deepseek-v4.1-flash', effort: 'low' });
    assert.deepStrictEqual(t.directorDefaultsFor(withDefaults, 'kabuki'), { engine: 'custom:abl', model: 'org/big', effort: null });
    assert.strictEqual(t.directorDefaultsFor(makeGr(), 'wren'), null, 'unset: the client keeps its last-used engine');

    // ---- Kabuki classification: the marker, else the engine's store; backfill stamps it ----
    const ask = [{ role: 'user', message_type: 'Ask', content: 'hi' }];
    const plain = makeGr();
    const chats = [
        { id: 'w1', name: 'Wren chat', lastEngine: 'claude', messages: ask },
        { id: 'w2', name: 'DeepSeek chat', choice: { engine: 'custom:deepseek' }, messages: ask },
        { id: 'k1', name: 'Old back room', lastEngine: 'custom:abl', messages: ask },
        { id: 'k2', name: 'Picked in Kabuki', choice: { engine: 'custom:abl' }, messages: ask },
        { id: 'k3', name: 'New Kabuki draft', memoryStore: 'obliterated', cursorId: null, messages: ask },
        { id: 'h1', name: 'Rentan', dynagen: true, lastEngine: 'custom:abl', messages: ask }
    ];
    assert.strictEqual(t.chatMemoryStore(plain, chats[0]), '');
    assert.strictEqual(t.chatMemoryStore(plain, chats[2]), 'obliterated', 'derived from lastEngine');
    assert.strictEqual(t.chatMemoryStore(plain, chats[3]), 'obliterated', 'derived from choice.engine');
    assert.strictEqual(t.chatMemoryStore(plain, { memoryStore: 'obliterated', lastEngine: 'claude' }), 'obliterated', 'the marker wins');
    assert.strictEqual(t.chatMemoryStore(plain, { memoryStore: 'studio', lastEngine: 'claude' }), '', 'only obliterated means anything');
    assert.strictEqual(t.chatPersona(plain, chats[1]), 'wren');
    assert.strictEqual(t.chatPersona(plain, chats[4]), 'kabuki');
    assert.strictEqual(t.stampMemoryStore(plain, chats[2]), true);
    assert.strictEqual(chats[2].memoryStore, 'obliterated', 'backfill persists the field');
    assert.strictEqual(t.stampMemoryStore(plain, chats[2]), false, 'stamped once');
    assert.strictEqual(t.stampMemoryStore(plain, chats[0]), false, 'normal chats stay unmarked');
    assert.ok(!('memoryStore' in chats[0]));
    assert.strictEqual(t.publicSession(chats[2]).memoryStore, 'obliterated');
    assert.strictEqual(t.publicSession(chats[0]).memoryStore, null);
    assert.strictEqual(t.listPersona({ persona: 'kabuki' }), 'kabuki');
    assert.strictEqual(t.listPersona({ persona: 'xi' }), 'wren', 'xi never reaches this server; anything else is Wren');
    assert.strictEqual(t.listPersona({}), 'wren');

    // ---- director_get_sessions: Wren lists the others, Kabuki the obliterated ones, and stamps the index ----
    const indexPath = path.join(tmp, 'index.json');
    const index = { chats: chats.map((chat) => { const copy = { ...chat }; delete copy.memoryStore; if (chat.id === 'k3') copy.memoryStore = 'obliterated'; return copy; }) };
    t.writeIndex(indexPath, index);
    const listedNow = t.listedChatsByActivity(t.readIndex(indexPath));
    assert.deepStrictEqual(listedNow.filter((chat) => t.chatPersona(plain, chat) === 'kabuki').map((chat) => chat.id).sort(), ['k1', 'k2', 'k3']);
    assert.deepStrictEqual(listedNow.filter((chat) => t.chatPersona(plain, chat) === 'wren').map((chat) => chat.id).sort(), ['w1', 'w2']);
    assert.ok(!listedNow.some((chat) => chat.id === 'h1'), 'hidden chats are in neither tab');

    // ---- open workspace: the latest-chat fallback stays in the asking tab ----
    const ws = { chats: [
        { id: 'a', workspaceId: 'w', lastEngine: 'claude', messages: ask },
        { id: 'b', workspaceId: 'w', memoryStore: 'obliterated', messages: ask },
        { id: 'c', workspaceId: 'w', lastEngine: 'cursor', cursorId: 'x', messages: ask }
    ] };
    const kabukiOnly = (chat) => t.chatPersona(plain, chat) === 'kabuki';
    const wrenOnly = (chat) => t.chatPersona(plain, chat) === 'wren';
    assert.strictEqual(t.pickOpenWorkspaceChat(ws, {}, 'w', kabukiOnly).id, 'b');
    assert.strictEqual(t.pickOpenWorkspaceChat(ws, {}, 'w', wrenOnly).id, 'c');
    assert.strictEqual(t.pickOpenWorkspaceChat(ws, { preferredChatId: 'b' }, 'w', wrenOnly).id, 'b', 'an explicit open still opens it');
    assert.strictEqual(t.latestForWorkspace(ws, 'w').id, 'c', 'no filter: as before');

    // ---- Auto-Repair lane follows chat.memoryStore ----
    const lane = t.repairAgentFor(makeGr({ repair: { obliterated: { engine: 'custom:abl', model: 'org/big' } } }), { memoryStore: 'obliterated', lastEngine: 'claude' });
    assert.deepStrictEqual([lane.lane, lane.engine, lane.model], ['obliterated', 'custom:abl', 'org/big']);
    assert.strictEqual(t.repairAgentFor(makeGr(), { lastEngine: 'custom:abl' }).lane, 'obliterated', 'engine store still decides for unmarked chats');
    assert.strictEqual(t.repairAgentFor(makeGr(), { lastEngine: 'claude' }).lane, 'normal');

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('test-director-settings: ok');
    process.exit(0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
