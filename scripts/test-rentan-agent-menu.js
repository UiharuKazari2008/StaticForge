'use strict';
// Rentan system menu (#409): the Wren block picks engine / model / reasoning /
// fast for this Studio, Save as Default sends director_rentan_agent_set_default and
// follows it, and Use Default drops the Studio choice.
//   node scripts/test-rentan-agent-menu.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const directorSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/director.js'), 'utf8');
const start = directorSrc.indexOf('class Director {');
const classSrc = directorSrc.slice(start, directorSrc.indexOf('\n}\n', start) + 2);
const managerSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/dynamicGenerationManager.js'), 'utf8');

const store = new Map();
const sent = [];
const handlers = {};
const toasts = [];
const carousel = { dataset: {} };
const wsClient = {
    isConnected: () => true,
    send: (m) => sent.push(m),
    on: (type, fn) => { handlers[type] = fn; }
};
const ctx = {
    console,
    localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v))
    },
    document: {
        getElementById: (id) => (id === 'dynamicCarousel' ? carousel : null),
        querySelectorAll: () => [],
        createElement: () => {
            const el = { _text: '' };
            Object.defineProperty(el, 'textContent', { set(v) { el._text = String(v); }, get() { return el._text; } });
            Object.defineProperty(el, 'innerHTML', { get() { return el._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } });
            return el;
        }
    },
    showGlassToast: (...args) => toasts.push(args)
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(`${classSrc}\nthis.Director = Director;`, ctx);
vm.runInContext(managerSrc, ctx);
ctx.wsClient = wsClient;

const director = Object.create(ctx.Director.prototype);
Object.assign(director, {
    PREFS_KEY: 'staticforge_director_chat_prefs',
    ENGINE_KEY: 'staticforge_director_engine',
    engine: 'cursor',
    persona: 'wren',
    modelCatalogs: {},
    modelCatalog: [],
    currentSession: null,
    paintModelPick() {},
    paintMessageFilter() {},
    requestDirectorModels(engine) { sent.push({ type: 'director_get_models', engine }); }
});
director.loadChatPrefs();
director.modelCatalogs = {
    cursor: [
        { id: 'auto', name: 'Auto', provider: 'Cursor', efforts: [] },
        { id: 'grok-4.7', name: 'Grok 4.7', provider: 'Cursor', efforts: [{ id: 'low', name: 'Low', fast: true }, { id: 'medium', name: 'Medium', fast: true }] }
    ],
    claude: [
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', short: 'Opus 5.5', provider: 'Anthropic', default: true, efforts: [{ id: 'medium', name: 'Medium', fast: true }, { id: 'high', name: 'High', fast: true }] }
    ],
    tokenrouter: [
        { id: 'moonshotai/kimi-k3', name: 'Kimi K3', provider: 'Moonshot', default: true, efforts: [{ id: 'low', name: 'Low', fast: false }, { id: 'medium', name: 'Medium', fast: false }, { id: 'high', name: 'High', fast: false }] },
        { id: 'z-ai/glm-5.3', name: 'GLM 5.3', provider: 'Z.ai', efforts: [{ id: 'low', name: 'Low', fast: true }, { id: 'medium', name: 'Medium', fast: true }] }
    ]
};
ctx.directorInstance = director;

const act = (action, value) => ctx.handleDynamicGenerationContextMenuAction({ detail: { action, item: { value } } });
const items = ctx.rentanAgentMenuItems();
const byText = (text) => items.find((item) => item.text === text);

// Reduced Prompt Context (#432): first item, Disabled / Indoor / Outdoor.
const reduced = byText('Reduced Prompt Context');
assert.ok(reduced && items.indexOf(reduced) === 0);
assert.deepStrictEqual(Array.from(reduced.submenu, (s) => s.value), ['off', 'indoor', 'outdoor']);
assert.strictEqual(reduced.valueDisplay(), 'Disabled');
act('setRentanReducedContext', 'indoor');
assert.strictEqual(carousel.dataset.reducedContext, 'indoor');
assert.strictEqual(reduced.valueDisplay(), 'Indoor');
assert.strictEqual(ctx.getRentanReducedContext(), 'indoor');
act('setRentanReducedContext', 'off');
assert.strictEqual(carousel.dataset.reducedContext, undefined);
assert.strictEqual(ctx.getRentanReducedContext(), null);
ctx.setRentanReducedContext('basement');
assert.strictEqual(ctx.getRentanReducedContext(), null, 'only indoor / outdoor');

// Wiring asks the server for the saved default; none yet.
ctx.wireRentanAgentDefaults();
assert.ok(sent.some((m) => m.type === 'director_rentan_agent_get'));
handlers.director_rentan_agent_get_response({ data: { success: true, default: null } });

// No Studio choice and no default: Cursor at medium, as before #409.
assert.strictEqual(ctx.getRentanAgentOverride(), null);
assert.strictEqual(byText('Engine').valueDisplay(), 'Cursor');
assert.strictEqual(byText('Model').valueDisplay(), 'Grok 4.7');
assert.strictEqual(byText('Save as Default').disabled(), true, 'nothing to save without a Studio choice');
assert.strictEqual(byText('Use Default').hidden(), true);

// Pick TokenRouter: Kimi K3 at medium, request the catalog.
assert.strictEqual(act('setRentanAgentEngine', 'tokenrouter'), true);
assert.deepStrictEqual({ ...ctx.getRentanAgentOverride() }, { engine: 'tokenrouter', model: 'moonshotai/kimi-k3', effort: 'medium', fast: false });
assert.ok(sent.some((m) => m.type === 'director_get_models' && m.engine === 'tokenrouter'));
assert.strictEqual(byText('Engine').valueDisplay(), 'TokenRouter');
assert.strictEqual(byText('Fast').disabled(), true, 'Kimi K3 has no fast sibling');
const modelOptions = byText('Model').optionsfn();
assert.deepStrictEqual(Array.from(modelOptions.filter((o) => !o.separator), (o) => o.value), ['moonshotai/kimi-k3', 'z-ai/glm-5.3']);
assert.deepStrictEqual(Array.from(modelOptions.filter((o) => o.separator), (o) => o.text), ['Moonshot', 'Z.ai']);
assert.deepStrictEqual(Array.from(byText('Reasoning').optionsfn(), (o) => o.value), ['low', 'medium', 'high']);

// Effort and a model with a fast sibling.
act('setRentanAgentEffort', 'high');
assert.strictEqual(ctx.getRentanAgentOverride().effort, 'high');
act('setRentanAgentModel', 'z-ai/glm-5.3');
assert.strictEqual(ctx.getRentanAgentOverride().effort, 'medium', 'GLM has no High, so effort falls back');
assert.strictEqual(byText('Fast').disabled(), false);
act('toggleRentanAgentFast');
assert.strictEqual(ctx.getRentanAgentOverride().fast, true);
assert.strictEqual(carousel.dataset.agentFast, 'true');
assert.strictEqual(byText('Use Default').hidden(), false);

// Save as Default: one packet with the choice, then the Studio follows the default.
sent.length = 0;
assert.strictEqual(byText('Save as Default').disabled(), false);
act('saveRentanAgentDefault');
const save = sent.find((m) => m.type === 'director_rentan_agent_set_default');
assert.deepStrictEqual({ ...save.agent }, { engine: 'tokenrouter', model: 'z-ai/glm-5.3', effort: 'medium', fast: true });
assert.strictEqual(ctx.getRentanAgentOverride(), null, 'saved default replaces the Studio choice');
assert.strictEqual(byText('Model').valueDisplay(), 'GLM 5.3', 'menu shows the default');
assert.strictEqual(byText('Save as Default').subtext(), 'Default: TokenRouter / GLM 5.3 / Medium / Fast');
handlers.director_rentan_agent_set_default_response({ data: { success: true, default: { engine: 'tokenrouter', model: 'z-ai/glm-5.3', effort: 'medium', fast: true } } });

// A Studio choice on top of the default, then Use Default drops it.
act('setRentanAgentEngine', 'claude');
assert.deepStrictEqual({ ...ctx.getRentanAgentOverride() }, { engine: 'claude', model: 'claude-opus-5-5', effort: 'medium', fast: false });
act('useRentanAgentDefault');
assert.strictEqual(ctx.getRentanAgentOverride(), null);
assert.strictEqual(carousel.dataset.agentEngine, undefined);

// Picking the default's engine starts from the default's model.
act('setRentanAgentEngine', 'tokenrouter');
assert.strictEqual(ctx.getRentanAgentOverride().model, 'z-ai/glm-5.3');

// Another tab saved a new default.
handlers.director_rentan_agent_default_changed({ data: { default: { engine: 'claude', model: 'claude-opus-5-5', effort: 'high', fast: false } } });
ctx.setRentanAgentOverride(null);
assert.strictEqual(byText('Engine').valueDisplay(), 'Claude');

// Prints and Change JSON restore through setRentanAgentOverride; junk clears it.
ctx.setRentanAgentOverride({ engine: 'tokenrouter', model: 'moonshotai/kimi-k3', effort: 'low', fast: false });
assert.strictEqual(ctx.getRentanAgentOverride().effort, 'low');
ctx.setRentanAgentOverride({ engine: 'nope' });
assert.strictEqual(ctx.getRentanAgentOverride(), null);

// valueDisplay is HTML: names are escaped.
director.modelCatalogs.tokenrouter.push({ id: 'x/evil', name: '<img src=x>', provider: 'Other', efforts: [] });
ctx.setRentanAgentOverride({ engine: 'tokenrouter', model: 'x/evil', effort: 'medium', fast: false });
assert.ok(!byText('Model').valueDisplay().includes('<img'), 'model name is escaped');

console.log('rentan agent menu: ok');
