'use strict';
// Director client (#687 slices 2 and 3): Wren | Kabuki | Xi engines per tab, the Kabuki toggle,
// a chat opened from the other tab, new drafts on director.defaults, and the settings pickers.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/director.js'), 'utf8');
const start = src.indexOf('class Director {');
const end = src.indexOf('\n}\n', start);
assert.ok(start >= 0 && end > start, 'Director class');

const store = new Map();
const sent = [];
const ctx = {
    localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v))
    },
    window: { wsClient: { isConnected: () => true, send: (m) => sent.push(m) } },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    showGlassToast: () => {},
    console
};
vm.createContext(ctx);
vm.runInContext(`${src.slice(start, end + 2)}\nthis.Director = Director;`, ctx);
const D = ctx.Director;

const providers = [
    { id: 'deepseek', engine: 'custom:deepseek', name: 'DeepSeek', memoryStore: null },
    { id: 'abl', engine: 'custom:abl', name: 'Abliterated', memoryStore: 'obliterated' }
];

function make() {
    const d = Object.create(D.prototype);
    Object.assign(d, {
        PREFS_KEY: 'staticforge_director_chat_prefs',
        ENGINE_KEY: 'staticforge_director_engine',
        SESSION_MODEL_KEY: 'staticforge_director_session_models',
        engine: 'tokenrouter',
        persona: 'wren',
        customProviders: providers,
        modelCatalogs: {},
        modelCatalog: [],
        currentSession: null,
        directorSettings: null,
        _personaSession: { wren: null, kabuki: null, xi: null },
        effortLevels: [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }, { value: 'xhigh', name: 'Extra' }],
        paintModelPick() {},
        paintMessageFilter() {},
        syncEngineChrome() {},
        directorWindowIsOpen: () => true
    });
    d.loadChatPrefs();
    return d;
}

// ---- engines per tab ----
const d = make();
assert.deepStrictEqual(Array.from(d.engineChoices()), ['cursor', 'claude', 'tokenrouter', 'custom:deepseek'], 'Wren hides obliterated engines');
assert.deepStrictEqual(Array.from(d.engineChoices('kabuki')), ['custom:abl'], 'Kabuki offers only obliterated engines');
assert.deepStrictEqual(Array.from(d.engineChoices('xi')), ['cursor', 'claude', 'tokenrouter', 'custom:deepseek', 'custom:abl'], 'Xi keeps them all');
assert.strictEqual(d.kabukiAvailable(), true);
assert.strictEqual(d.engineStorageKey('kabuki'), 'staticforge_director_engine_kabuki');
assert.strictEqual(d.engineStorageKey('wren'), 'staticforge_director_engine');
assert.strictEqual(d.personaEngine('kabuki'), 'custom:abl', 'first fitting engine');
store.set('staticforge_director_engine', 'custom:abl');
assert.strictEqual(d.personaEngine('wren'), 'tokenrouter', 'a saved obliterated engine does not open Wren');
store.set('staticforge_director_engine', 'claude');
assert.strictEqual(d.personaEngine('wren'), 'claude');

// ---- packets: Kabuki shares Wren's server ----
d.persona = 'kabuki';
assert.strictEqual(d.packetFromOtherServer({}), false, 'a Wren-server packet is Kabuki\'s too');
assert.strictEqual(d.packetFromOtherServer({ persona: 'xi' }), true);
assert.strictEqual(d.lastSessionStorageKey(), 'staticforge_director_last_session_kabuki');

// ---- the toggle: Wren | Kabuki | Xi ----
function fakeGroup() {
    const btn = (persona) => {
        const classes = new Set();
        return { dataset: { persona }, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: (c) => classes.has(c) } };
    };
    const buttons = [btn('wren'), btn('kabuki'), btn('xi')];
    const classes = new Set(['hidden']);
    return {
        buttons,
        dataset: {},
        classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: (c) => classes.has(c) },
        querySelectorAll: () => buttons
    };
}
d.directorPersonaGroup = fakeGroup();
d._xiEnabled = false;
d.paintPersonaToggle();
let group = d.directorPersonaGroup;
assert.strictEqual(group.classList.has('hidden'), false, 'Kabuki shows even with Xi off');
assert.deepStrictEqual([group.dataset.count, group.dataset.index, group.dataset.persona], ['2', '1', 'kabuki']);
assert.strictEqual(group.buttons[2].classList.has('hidden'), true, 'Xi hidden');
d._xiEnabled = true;
d.paintPersonaToggle();
assert.deepStrictEqual([group.dataset.count, group.dataset.index], ['3', '1'], 'Kabuki sits between Wren and Xi');
d.persona = 'wren';
d.customProviders = providers.filter((row) => !row.memoryStore);
d._xiEnabled = false;
d.paintPersonaToggle();
assert.strictEqual(group.classList.has('hidden'), true, 'no obliterated engine and no Xi: no toggle');
d.customProviders = providers;

// ---- a chat opened from the other tab moves the toggle ----
const w = make();
let listed = 0;
w.loadDirectorSessions = () => { listed += 1; return Promise.resolve(); };
w.paintPersonaToggle = () => {};
w.adoptSessionPersona({ id: 'k1', memoryStore: 'obliterated' });
assert.strictEqual(w.persona, 'kabuki');
assert.strictEqual(w.engine, 'custom:abl', 'Kabuki opens on its own engine');
assert.strictEqual(listed, 1, 'the Kabuki list loads');
w.adoptSessionPersona({ id: 'w1', memoryStore: null });
assert.strictEqual(w.persona, 'wren');
assert.notStrictEqual(w.engine, 'custom:abl');
w.adoptSessionPersona({ id: 'x1' });
assert.strictEqual(w.persona, 'wren', 'rows without memoryStore (Xi, status stubs) change nothing');
w.persona = 'xi';
w.adoptSessionPersona({ id: 'k1', memoryStore: 'obliterated' });
assert.strictEqual(w.persona, 'xi', 'Xi never adopts');

// ---- a new draft starts on director.defaults for its tab ----
const n = make();
n.modelCatalogs.claude = [
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', efforts: [{ id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }] },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', efforts: [{ id: 'medium', name: 'Medium' }] }
];
assert.strictEqual(n.applyNewSessionDefaults(), false, 'no settings: the last-used engine stays');
n.directorSettings = { defaults: { wren: { engine: 'claude', model: 'claude-sonnet-5-5', effort: 'high' }, kabuki: { engine: 'custom:abl', model: 'org/big', effort: null } } };
assert.strictEqual(n.applyNewSessionDefaults(), true);
assert.deepStrictEqual([n.engine, n.selectedModel, n.selectedEffort], ['claude', 'claude-sonnet-5-5', 'medium'], 'an effort the model lacks falls back to medium');
n.directorSettings.defaults.wren.model = 'claude-opus-5-5';
n.applyNewSessionDefaults();
assert.deepStrictEqual([n.selectedModel, n.selectedEffort], ['claude-opus-5-5', 'high']);
n.persona = 'kabuki';
n.applySessionModel({ draft: true });
assert.deepStrictEqual([n.engine, n.selectedModel, n.selectedEffort], ['custom:abl', 'org/big', 'medium']);
n.persona = 'wren';
n.directorSettings.defaults.wren = { engine: 'custom:abl', model: null, effort: null };
assert.strictEqual(n.applyNewSessionDefaults(), false, 'a default that does not fit the tab is ignored');
n.persona = 'xi';
assert.strictEqual(n.applyNewSessionDefaults(), false, 'Xi keeps its runtime picker');

// ---- a remembered per-session choice still wins over the defaults ----
const r = make();
r.directorSettings = { defaults: { wren: { engine: 'claude', model: 'claude-opus-5-5', effort: 'high' } } };
r.applySessionModel({ id: 'dirc_1', engine: 'tokenrouter', choice: { engine: 'tokenrouter', id: 'deepseek/deepseek-v4.1-flash', effort: 'low' } });
assert.deepStrictEqual([r.engine, r.selectedModel, r.selectedEffort], ['tokenrouter', 'deepseek/deepseek-v4.1-flash', 'low']);
// A Kabuki chat that never ran records no engine (cursor): it opens on a Kabuki engine.
r.persona = 'kabuki';
r.applySessionModel({ id: 'dirc_2', engine: 'cursor', memoryStore: 'obliterated', messages: [] });
assert.strictEqual(r.engine, 'custom:abl');

// ---- settings pickers: engines by store, saved model kept, efforts from the family ----
const values = (list) => Array.from(list, (o) => o.value);
function fakeCtx() {
    const values = {};
    const lists = {};
    const enabled = {};
    return {
        values, lists, enabled,
        get: (id) => values[id],
        set: (id, v) => { values[id] = v; },
        options: (id, list, value) => {
            lists[id] = list;
            values[id] = list.some((o) => o.value === String(value == null ? '' : value)) ? String(value == null ? '' : value) : '';
        },
        enable: (id, on) => { enabled[id] = on; }
    };
}
const s = make();
s.directorSettingsEngines = [
    { engine: 'cursor', name: 'Cursor', memoryStore: null },
    { engine: 'claude', name: 'Claude', memoryStore: null },
    { engine: 'custom:abl', name: 'Abliterated', memoryStore: 'obliterated' }
];
s.modelCatalogs.claude = n.modelCatalogs.claude;
const c = fakeCtx();
const normalRow = { ids: [1, 2, 3], obliterated: false, blank: '(Last used)' };
s.fillSettingsPicker(c, normalRow, { engine: 'claude', model: 'claude-opus-5-5', effort: 'high' });
assert.deepStrictEqual(values(c.lists[1]), ['', 'cursor', 'claude']);
assert.deepStrictEqual([c.values[1], c.values[2], c.values[3]], ['claude', 'claude-opus-5-5', 'high']);
assert.deepStrictEqual(values(c.lists[3]), ['', 'medium', 'high']);
assert.deepStrictEqual(JSON.parse(JSON.stringify(s.readSettingsPicker(c, normalRow))), { engine: 'claude', model: 'claude-opus-5-5', effort: 'high' });
const kRow = { ids: [11, 12, 13], obliterated: true, blank: '(Same as the chat)' };
s.fillSettingsPicker(c, kRow, { engine: 'custom:abl', model: 'org/big', effort: null });
assert.deepStrictEqual(values(c.lists[11]), ['', 'custom:abl']);
assert.strictEqual(c.values[12], 'org/big', 'a saved model the catalog does not list yet stays');
c.values[11] = '';
s.fillSettingsModels(c, kRow, '', '');
assert.strictEqual(c.enabled[12], false, 'no engine: model and reasoning are greyed');
assert.strictEqual(s.readSettingsPicker(c, kRow), null);
s.directorSettingsEngines = s.directorSettingsEngines.filter((row) => !row.memoryStore);
s.fillSettingsPicker(c, kRow, null);
assert.strictEqual(c.enabled[11], false, 'no obliterated engine: the Kabuki row is greyed');

console.log('test-director-kabuki-client: ok');
