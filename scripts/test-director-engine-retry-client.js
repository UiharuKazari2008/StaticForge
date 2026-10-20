'use strict';
// Director client: Wren engine switch keeps each engine's last config and
// catalog; the Retry choice menu picks engine/model/reasoning/fast.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/director.js'), 'utf8');
const start = src.indexOf('class Director {');
assert.ok(start >= 0, 'Director class');
// Class body ends at the first top-level closing brace line after start.
const end = src.indexOf('\n}\n', start);
const classSrc = src.slice(start, end + 2);

const store = new Map();
// Title marks (#directorSessionTitle .xai-icon) that syncEngineChrome flips.
const titleClasses = new Set(['xai-icon']);
const titleIcons = [{ classList: { toggle: (c, on) => (on ? titleClasses.add(c) : titleClasses.delete(c)) }, title: '' }];
const sent = [];
const ctx = {
    localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v))
    },
    window: { wsClient: { isConnected: () => true, send: (m) => sent.push(m) } },
    document: {
        getElementById: () => null,
        querySelectorAll: () => titleIcons
    },
    showGlassToast: () => {},
    console
};
vm.createContext(ctx);
vm.runInContext(`${classSrc}\nthis.Director = Director;`, ctx);
const D = ctx.Director;

function make() {
    const d = Object.create(D.prototype);
    Object.assign(d, {
        PREFS_KEY: 'staticforge_director_chat_prefs',
        ENGINE_KEY: 'staticforge_director_engine',
        SESSION_MODEL_KEY: 'staticforge_director_session_models',
        engine: 'cursor',
        persona: 'wren',
        modelCatalogs: {},
        modelCatalog: [],
        currentSession: null,
        paintModelPick() {},
        paintMessageFilter() {}
    });
    d.loadChatPrefs();
    return d;
}

const cursorCatalog = [
    { id: 'auto', name: 'Auto', provider: 'Cursor', efforts: [] },
    { id: 'grok-4.7', name: 'Grok 4.7', provider: 'Cursor', efforts: [{ id: 'low', name: 'Low', fast: true }, { id: 'medium', name: 'Medium', fast: true }] }
];
const claudeCatalog = [
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', short: 'Opus 5.5', provider: 'Anthropic', efforts: [{ id: 'medium', name: 'Medium', fast: true }, { id: 'high', name: 'High', fast: true }] },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', provider: 'Anthropic', efforts: [{ id: 'medium', name: 'Medium', fast: false }, { id: 'high', name: 'High', fast: false }] }
];

const d = make();
d.applyModelCatalog(cursorCatalog, 'cursor');
d.applyModelCatalog(claudeCatalog, 'claude');
assert.strictEqual(d.modelCatalog, cursorCatalog, 'claude catalog does not replace the cursor one');
assert.strictEqual(d.selectedModel, 'grok-4.7');
d.selectedEffort = 'low';
d.saveChatPrefs();

// Switch to Claude: Claude defaults, Claude catalog, request tagged with engine.
sent.length = 0;
assert.strictEqual(d.setEngine('claude'), true);
assert.strictEqual(d.activeEngine(), 'claude');
assert.strictEqual(d.modelCatalog, claudeCatalog);
assert.strictEqual(d.selectedModel, 'claude-opus-5-5');
assert.strictEqual(store.get('staticforge_director_engine'), 'claude');
assert.ok(titleClasses.has('engine-claude-mark'), 'title mark shows Claude');
assert.ok(sent.some((m) => m.type === 'director_get_models' && m.engine === 'claude'));
assert.ok(sent.some((m) => m.type === 'director_get_cursor_usage' && m.engine === 'claude'), 'usage follows the engine');
d.selectedModel = 'claude-sonnet-5-5';
d.selectedEffort = 'high';
d.saveChatPrefs();

// Back to Cursor restores Cursor's last config; Claude's is kept for next time.
d.setEngine('cursor');
assert.ok(!titleClasses.has('engine-claude-mark'), 'title mark back to Cursor');
assert.strictEqual(d.selectedModel, 'grok-4.7');
assert.strictEqual(d.selectedEffort, 'low');
d.setEngine('claude');
assert.strictEqual(d.selectedModel, 'claude-sonnet-5-5');
assert.strictEqual(d.selectedEffort, 'high');

// Xi uses its own runtime picker, not Wren's engine switcher. New drafts
// default to TokenRouter (DeepSeek); setEngine stays a no-op.
d.persona = 'xi';
d.currentSession = null;
assert.strictEqual(d.nextXiRuntime(), 'tokenrouter');
assert.strictEqual(d.activeEngine(), 'tokenrouter');
assert.strictEqual(d.displayEngine(), 'tokenrouter');
assert.strictEqual(d.defaultModel(), 'deepseek/deepseek-v4.1-flash');
assert.strictEqual(d.setEngine('cursor'), false);
assert.strictEqual(d.sessionEngine({ runtime: 'cursor' }), 'cursor');
assert.strictEqual(d.sessionEngine({ runtime: 'claude' }), 'claude');
assert.strictEqual(d.sessionEngine({ runtime: 'tokenrouter' }), 'tokenrouter');
d._nextXiRuntime = 'cursor';
assert.strictEqual(d.nextXiRuntime(), 'cursor');
assert.strictEqual(d.activeEngine(), 'cursor');
d._nextXiRuntime = null;
d.persona = 'wren';

// Retry choice: fast is only offered where the model has it.
const choice = d.normalizeRetryChoice({ engine: 'claude', model: 'claude-sonnet-5-5', effort: 'high', fast: true });
assert.strictEqual(choice.fast, false, 'Sonnet has no fast');
const config = d.retryMenuConfig(choice, () => {});
const fastItem = config.sections[0].items.find((i) => i.text === 'Fast');
assert.strictEqual(fastItem.disabled(), true);
config.onAction('retry-model-claude-opus-5-5');
assert.strictEqual(fastItem.disabled(), false);
config.onAction('retry-fast');
assert.strictEqual(choice.fast, true);
assert.strictEqual(d.retryChoiceLabel(choice), 'Claude / Opus 5.5 / High / Fast');

// Engine switch in the retry menu loads that engine's saved config.
config.onAction('retry-engine-cursor');
assert.deepStrictEqual({ ...choice }, { engine: 'cursor', model: 'grok-4.7', effort: 'low', fast: false });
const effortItem = config.sections[0].items.find((i) => i.text === 'Reasoning');
assert.deepStrictEqual(Array.from(effortItem.optionsfn(), (i) => i.action), ['retry-effort-low', 'retry-effort-medium']);

// Confirming applies the retry choice to the composer (and its engine).
d.applyRetryChoice({ engine: 'cursor', model: 'grok-4.7', effort: 'medium', fast: true });
assert.strictEqual(d.activeEngine(), 'cursor');
assert.strictEqual(d.selectedEffort, 'medium');
assert.strictEqual(d.fast, true);

// Engine menu item in the Tools menu.
const engineItem = d.engineMenuItem();
assert.deepStrictEqual(Array.from(engineItem.submenu, (i) => i.action), ['director-tools-engine-cursor', 'director-tools-engine-claude', 'director-tools-engine-tokenrouter']);
assert.strictEqual(engineItem.valueDisplay(), 'Cursor');
// Session list / reply marks.
assert.strictEqual(d.sessionEngine({ engine: 'claude' }), 'claude');
assert.strictEqual(d.sessionEngine({}), 'cursor');
assert.ok(d.engineIconHtml('claude').includes('engine-claude'));
assert.strictEqual(d.roundModelName({ id: 'claude-opus-5-5', engine: 'claude' }), 'Claude Opus 5.5');
assert.strictEqual(d.engineForModelId({ id: 'claude-opus-5-5' }), 'claude', 'Claude-only id infers Claude');
assert.strictEqual(d.engineForModelId({ id: 'grok-4.7' }), 'cursor');
// An id both catalogs have: bare run in a Claude chat is Claude; a Cursor variant run is Cursor.
d.modelCatalogs.cursor = cursorCatalog.concat([{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5 1M', provider: 'Anthropic', efforts: [] }]);
assert.strictEqual(d.engineForModelId({ id: 'claude-opus-5-5', run: 'claude-opus-5-5' }, { engine: 'claude' }), 'claude');
assert.strictEqual(d.engineForModelId({ id: 'claude-opus-5-5', run: 'claude-opus-5-5-high-thinking' }, { engine: 'claude' }), 'cursor');
d.modelCatalogs.cursor = cursorCatalog;

// TokenRouter (#409): its own prefs, catalog cache, default (DeepSeek V4.1 Flash), and mark.
const routerCatalog = [
    { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', provider: 'DeepSeek', default: true, efforts: [{ id: 'none', name: 'None', fast: false }, { id: 'low', name: 'Low', fast: false }, { id: 'medium', name: 'Medium', fast: false }, { id: 'high', name: 'High', fast: false }] },
    { id: 'moonshotai/kimi-k3', name: 'Kimi K3', provider: 'Moonshot', efforts: [{ id: 'low', name: 'Low', fast: false }, { id: 'medium', name: 'Medium', fast: false }, { id: 'high', name: 'High', fast: false }] },
    { id: 'z-ai/glm-5.3', name: 'GLM 5.3', provider: 'Z.ai', efforts: [{ id: 'low', name: 'Low', fast: true }, { id: 'medium', name: 'Medium', fast: true }] }
];
d.applyModelCatalog(routerCatalog, 'tokenrouter');
assert.ok(store.has('staticforge_director_models_tokenrouter'), 'TokenRouter catalog has its own cache key');
sent.length = 0;
assert.strictEqual(d.setEngine('tokenrouter'), true);
assert.strictEqual(d.activeEngine(), 'tokenrouter');
assert.strictEqual(d.modelCatalog, routerCatalog);
assert.strictEqual(d.selectedModel, 'deepseek/deepseek-v4.1-flash');
assert.ok(titleClasses.has('engine-tokenrouter-mark') && !titleClasses.has('engine-claude-mark'), 'title mark shows TokenRouter');
assert.ok(sent.some((m) => m.type === 'director_get_models' && m.engine === 'tokenrouter'));
assert.strictEqual(d.engineName('tokenrouter'), 'TokenRouter');
d.selectedModel = 'z-ai/glm-5.3';
d.fast = true;
d.saveChatPrefs();
assert.ok(JSON.parse(store.get('staticforge_director_chat_prefs_tokenrouter')).fast, 'TokenRouter prefs key');
assert.strictEqual(d.engineForModelId({ id: 'moonshotai/kimi-k3' }), 'tokenrouter', 'vendor/model ids are TokenRouter');
assert.strictEqual(d.sessionEngine({ engine: 'tokenrouter' }), 'tokenrouter');
assert.ok(d.engineIconHtml('tokenrouter').includes('engine-tokenrouter'));
const routerChoice = d.normalizeRetryChoice({ engine: 'tokenrouter', model: 'moonshotai/kimi-k3', effort: 'high', fast: true });
assert.strictEqual(routerChoice.fast, false, 'Kimi K3 has no fast sibling');
assert.strictEqual(d.retryChoiceLabel(routerChoice), 'TokenRouter / Kimi K3 / High');
d.setEngine('cursor');
assert.ok(!titleClasses.has('engine-tokenrouter-mark'));
assert.strictEqual(d.savedEngineChoice('tokenrouter').model, 'z-ai/glm-5.3');

// Usage badge: TokenRouter shows one balance (top-up plus vouchers), no percent split.
const badge = {};
['directorUsageDisplay', 'directorUsageAuto', 'directorUsageIcon', 'directorUsageSplit', 'directorUsageOther'].forEach((id) => {
    const classes = new Set();
    badge[id] = { id, textContent: '', title: '', className: '', classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: (c) => classes.has(c) } };
});
const realGet = ctx.document.getElementById;
ctx.document.getElementById = (id) => badge[id] || null;
d.paintAccountBadge = () => {};
d.engine = 'tokenrouter';
d.paintCursorUsage({ engine: 'tokenrouter', balanceText: '$150.50', balance: 150.5, limited: false, title: 'TokenRouter balance: $150.50' });
assert.strictEqual(badge.directorUsageAuto.textContent, '$150.50');
assert.ok(badge.directorUsageSplit.classList.has('hidden'), 'no second figure');
assert.strictEqual(badge.directorUsageIcon.className, 'fas fa-wallet');
assert.strictEqual(badge.directorUsageDisplay.title, 'TokenRouter balance: $150.50');
d.paintCursorUsage({ engine: 'tokenrouter', balanceText: null, title: 'TokenRouter balance: add the management key to the TokenRouter key' });
assert.strictEqual(badge.directorUsageAuto.textContent, '\u2014');
assert.strictEqual(badge.directorUsageIcon.className, 'fas fa-wallet');
d.paintCursorUsage({ engine: 'claude', autoPercent: 40, apiPercent: 12 });
assert.strictEqual(badge.directorUsageAuto.textContent, '40%');
assert.ok(!badge.directorUsageSplit.classList.has('hidden'));
assert.strictEqual(badge.directorUsageIcon.className, 'fas fa-chart-pie');
ctx.document.getElementById = realGet;
d.engine = 'cursor';
delete d.paintAccountBadge;

// Restore source: a retry on a reply cuts at the ask before it.
d.currentSession = { messages: [
    { id: 'u1', role: 'user', changeJson: { prompt: 'a' } },
    { id: 'a1', role: 'assistant' },
    { id: 'u2', role: 'user', changeJson: null }
] };
assert.strictEqual(d.rollbackSourceMessage('a1', true).id, 'u1');
assert.strictEqual(d.rollbackSourceMessage('u2', false).changeJson, null);
assert.strictEqual(d.rollbackSourceMessage('nope', true), null);
// Tools menu: Restart Session / Retry Last / Undo Last (skips steers).
d.currentSession = { messages: [
    { id: 'u1', role: 'user' },
    { id: 'a1', role: 'assistant' },
    { id: 'u2', role: 'user' },
    { id: 'u3', role: 'user', steer: true },
    { id: 'a2', role: 'assistant' }
] };
assert.strictEqual(d.firstUserMessageKey(), 'u1');
assert.strictEqual(d.lastUserMessageKey(), 'u3');
assert.strictEqual(d.lastUserMessageKey({ skipSteers: true }), 'u2');
console.log('director engine + retry client: ok');
